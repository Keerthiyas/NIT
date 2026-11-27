import { PassThrough } from 'node:stream';
import type http from 'node:http';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import { createApiHandler } from './index';
import { seedDatabaseIfEmpty } from './seed';

async function callApi(
  handler: ReturnType<typeof createApiHandler>,
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; data: Record<string, any> }> {
  const stream = new PassThrough();
  const req = stream as unknown as http.IncomingMessage;
  req.url = path;
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }

  let status = 200;
  const chunks: Buffer[] = [];
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    },
  } as unknown as http.ServerResponse;

  if (body !== undefined) {
    stream.write(Buffer.from(JSON.stringify(body)));
  }
  stream.end();

  await handler(req, res);

  const raw = Buffer.concat(chunks).toString('utf8');
  return { status, data: raw ? (JSON.parse(raw) as Record<string, any>) : {} };
}

describe('Owner Module — Executive Visibility, Approvals, Threshold & Strict RBAC', () => {
  let db: ReturnType<typeof openDatabase>;
  let handler: ReturnType<typeof createApiHandler>;
  let ownerToken: string;
  let adminToken: string;
  let supervisorToken: string;
  let accountantToken: string;
  let salesmanToken: string;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    seedDatabaseIfEmpty(db);
    handler = createApiHandler(db);

    const login = async (email: string) =>
      String(
        (
          await callApi(handler, 'POST', '/api/auth/login', undefined, {
            email,
            password: 'password123',
          })
        ).data.token
      );

    ownerToken = await login('owner@nitt.local');
    adminToken = await login('admin@nitt.local');
    supervisorToken = await login('supervisor@nitt.local');
    accountantToken = await login('accountant@nitt.local');
    salesmanToken = await login('salesman@nitt.local');
  });

  it('Owner Dashboard, Business Overview, Inventory Overview & Financial Overview match live backend records', async () => {
    const [dashRes, bizRes, invRes, finRes, ordersRes] = await Promise.all([
      callApi(handler, 'GET', '/api/owner/dashboard', ownerToken),
      callApi(handler, 'GET', '/api/owner/business-overview', ownerToken),
      callApi(handler, 'GET', '/api/owner/inventory', ownerToken),
      callApi(handler, 'GET', '/api/owner/financial', ownerToken),
      callApi(handler, 'GET', '/api/orders', adminToken),
    ]);

    expect(dashRes.status).toBe(200);
    expect(bizRes.status).toBe(200);
    expect(invRes.status).toBe(200);
    expect(finRes.status).toBe(200);

    const allOrders = ordersRes.data as unknown as Array<Record<string, any>>;
    expect(dashRes.data.totalOrdersCount).toBe(allOrders.length);
    expect(bizRes.data.salesPerformance.totalOrdersReceived).toBe(allOrders.length);
    expect(dashRes.data.salesTrend).toHaveProperty('currentMonthSales');
    expect(dashRes.data.salesTrend).toHaveProperty('previousMonthSales');
    expect(dashRes.data.productionOverview).toHaveProperty('plannedQuantity');
    expect(dashRes.data.productionOverview).toHaveProperty('actualGoodOutput');

    // Inventory categories present & accurately classified
    expect(Array.isArray(invRes.data.rawMaterials)).toBe(true);
    expect(Array.isArray(invRes.data.packagingMaterials)).toBe(true);
    expect(Array.isArray(invRes.data.finishedProducts)).toBe(true);
    expect(invRes.data.rawMaterials.length).toBeGreaterThan(0);
    expect(invRes.data.finishedProducts.length).toBeGreaterThan(0);
    for (const item of [
      ...invRes.data.rawMaterials,
      ...invRes.data.packagingMaterials,
      ...invRes.data.finishedProducts,
    ]) {
      if (item.availableStock <= 0) {
        expect(item.stockStatus).toBe('OUT_OF_STOCK');
      } else if (item.availableStock < item.reorderLevel) {
        expect(item.stockStatus).toBe('LOW_STOCK');
      } else {
        expect(item.stockStatus).toBe('IN_STOCK');
      }
    }

    // Financial overview exposes invoiced, collected, outstanding & GRN expenditure (no fabricated profitability)
    expect(typeof finRes.data.totalInvoicedAmount).toBe('number');
    expect(typeof finRes.data.totalAmountCollected).toBe('number');
    expect(typeof finRes.data.outstandingAmount).toBe('number');
    expect(typeof finRes.data.purchaseExpenditure).toBe('number');
    expect(finRes.data).not.toHaveProperty('netProfit');
  });

  it('Purchase Approvals: configurable limit, mandatory rejection reason, prevents duplicate decision, and does not alter inventory', async () => {
    // 1. Owner lowers approval threshold to ₹5,000 so a ₹6,000 PO requires approval
    const limitRes = await callApi(handler, 'PUT', '/api/owner/settings/approval-limit', ownerToken, {
      approvalLimitRupees: 5000,
    });
    expect(limitRes.status).toBe(200);
    expect(limitRes.data.approvalLimitRupees).toBe(5000);

    // 2. Admin creates two POs exceeding ₹5,000
    const suppliersRes = await callApi(handler, 'GET', '/api/management/suppliers', adminToken);
    const supplier = (suppliersRes.data as unknown as Array<Record<string, any>>)[0];
    const invBeforeRes = await callApi(handler, 'GET', '/api/inventory/items', adminToken);
    const rawItem = (invBeforeRes.data as unknown as Array<Record<string, any>>).find(
      (i) => i.category === 'RAW_MATERIAL'
    )!;
    const stockBefore = rawItem.availableStock;

    const poApproveCreate = await callApi(handler, 'POST', '/api/purchase-orders', adminToken, {
      supplierId: supplier.id,
      items: [{ itemId: rawItem.id, orderedQuantity: 100, unitCost: 60 }], // ₹6,000
      notes: 'Urgent raw material replenishment',
    });
    expect(poApproveCreate.status).toBe(201);
    expect(poApproveCreate.data.approvalStatus).toBe('PENDING_OWNER_APPROVAL');

    const poRejectCreate = await callApi(handler, 'POST', '/api/purchase-orders', adminToken, {
      supplierId: supplier.id,
      items: [{ itemId: rawItem.id, orderedQuantity: 200, unitCost: 60 }], // ₹12,000
      notes: 'Excess stock request',
    });
    expect(poRejectCreate.status).toBe(201);
    expect(poRejectCreate.data.approvalStatus).toBe('PENDING_OWNER_APPROVAL');

    // 3. Owner Approvals API lists both pending POs with live stock & supplier details
    const approvalsRes = await callApi(handler, 'GET', '/api/owner/approvals', ownerToken);
    expect(approvalsRes.status).toBe(200);
    expect(approvalsRes.data.approvalLimitRupees).toBe(5000);
    const pendingIds = (approvalsRes.data.approvals as Array<Record<string, any>>).map((a) => a.id);
    expect(pendingIds).toContain(poApproveCreate.data.id);
    expect(pendingIds).toContain(poRejectCreate.data.id);

    // 4. Owner cannot reject without a reason
    const rejectNoReason = await callApi(
      handler,
      'POST',
      `/api/purchase-orders/${poRejectCreate.data.id}/approve`,
      ownerToken,
      { approve: false, note: '   ' }
    );
    expect(rejectNoReason.status).toBe(400);

    // 5. Owner rejects second PO with mandatory reason
    const rejectOk = await callApi(
      handler,
      'POST',
      `/api/purchase-orders/${poRejectCreate.data.id}/approve`,
      ownerToken,
      { approve: false, note: 'Quantity exceeds monthly requirement' }
    );
    expect(rejectOk.status).toBe(200);
    expect(rejectOk.data.approvalStatus).toBe('REJECTED');
    expect(rejectOk.data.rejectionReason).toBe('Quantity exceeds monthly requirement');

    // 6. Owner approves first PO; inventory must remain unchanged until Admin posts GRN receipt
    const approveOk = await callApi(
      handler,
      'POST',
      `/api/purchase-orders/${poApproveCreate.data.id}/approve`,
      ownerToken,
      { approve: true }
    );
    expect(approveOk.status).toBe(200);
    expect(approveOk.data.approvalStatus).toBe('APPROVED');

    // 7. Duplicate approval/rejection is rejected
    const duplicateRes = await callApi(
      handler,
      'POST',
      `/api/purchase-orders/${poApproveCreate.data.id}/approve`,
      ownerToken,
      { approve: true }
    );
    expect(duplicateRes.status).toBe(400);

    // Verify stock was NOT altered by approval alone
    const invAfterRes = await callApi(handler, 'GET', '/api/inventory/items', adminToken);
    const rawItemAfter = (invAfterRes.data as unknown as Array<Record<string, any>>).find(
      (i) => i.id === rawItem.id
    )!;
    expect(rawItemAfter.availableStock).toBe(stockBefore);
  });

  it('Owner Reports API returns all 6 categories & respects filters', async () => {
    const reportsRes = await callApi(
      handler,
      'GET',
      '/api/owner/reports?category=RAW_MATERIAL',
      ownerToken
    );
    expect(reportsRes.status).toBe(200);
    expect(reportsRes.data).toHaveProperty('salesReport');
    expect(reportsRes.data).toHaveProperty('productionReport');
    expect(reportsRes.data).toHaveProperty('inventoryReport');
    expect(reportsRes.data).toHaveProperty('purchaseReport');
    expect(reportsRes.data).toHaveProperty('outstandingPaymentsReport');
    expect(reportsRes.data).toHaveProperty('financialSummary');

    for (const row of reportsRes.data.inventoryReport.rows as Array<Record<string, any>>) {
      expect(row.category).toBe('RAW_MATERIAL');
    }
  });

  it('Strict Role-Based Access Control: Owner blocked from Admin/Accountant/Supervisor/Salesman mutations; other roles blocked from /api/owner/*', async () => {
    // 1. Other roles blocked from Owner endpoints
    for (const token of [adminToken, supervisorToken, accountantToken, salesmanToken]) {
      expect((await callApi(handler, 'GET', '/api/owner/dashboard', token)).status).toBe(403);
      expect((await callApi(handler, 'GET', '/api/owner/business-overview', token)).status).toBe(403);
      expect((await callApi(handler, 'GET', '/api/owner/inventory', token)).status).toBe(403);
      expect((await callApi(handler, 'GET', '/api/owner/financial', token)).status).toBe(403);
      expect((await callApi(handler, 'GET', '/api/owner/approvals', token)).status).toBe(403);
      expect(
        (
          await callApi(handler, 'PUT', '/api/owner/settings/approval-limit', token, {
            limitRupees: 1000,
          })
        ).status
      ).toBe(403);
      expect((await callApi(handler, 'GET', '/api/owner/reports', token)).status).toBe(403);
    }

    // 2. Owner blocked from employee/user management & operational writes
    expect((await callApi(handler, 'GET', '/api/management/users', ownerToken)).status).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/management/users', ownerToken, {
          username: 'hacker',
          fullName: 'Hacker',
          email: 'h@nitt.local',
          role: 'SALESMAN',
          password: 'password123',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/orders/ord-1001/decision', ownerToken, {
          action: 'APPROVE',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/dispatches', ownerToken, {
          orderId: 'ord-1001',
          quantity: 1,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/purchase-orders', ownerToken, {
          supplierId: 'sup-1',
          items: [{ itemId: 'rm-besan', orderedQuantity: 10, unitCost: 50 }],
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/purchase-receipts', ownerToken, {
          supplierId: 'sup-1',
          items: [{ itemId: 'rm-besan', receivedQuantity: 10, unitCost: 50 }],
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/production-runs', ownerToken, {
          productionRequestId: 'pr-1',
          actualOutputQuantity: 10,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/invoices', ownerToken, {
          dispatchId: 'disp-1',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/accountant/payments/customer', ownerToken, {
          customerId: 'cust-1',
          amount: 100,
          allocations: [],
          paymentMode: 'CASH',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/stock-discrepancies/disc-1/review', ownerToken, {
          decision: 'APPROVE',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/bom-revisions/rev-1/review', ownerToken, {
          decision: 'APPROVE',
        })
      ).status
    ).toBe(403);
  });
});
