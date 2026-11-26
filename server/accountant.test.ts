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

describe('Accountant Module — GST Invoicing, Partial Dispatches, Allocations, Receivables & Reports', () => {
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

  it('Section 8 + 11: Murukku ₹75 (150 ordered -> dispatch 100 -> GST ₹7,875 -> partial ₹4,000 -> dispatch 50 -> separate invoice -> full settle)', async () => {
    // Update Murukku price to ₹75 so Taxable = 100 * 75 = ₹7,500, CGST 2.5% = ₹187.50, SGST 2.5% = ₹187.50, Total = ₹7,875
    const products = (await callApi(handler, 'GET', '/api/management/products', adminToken))
      .data as unknown as Array<Record<string, any>>;
    const murukku = products.find((p) => p.id === 'prod-mrk-200')!;

    await callApi(handler, 'PUT', `/api/management/products/${murukku.id}`, adminToken, {
      sku: murukku.sku,
      name: murukku.name,
      packSize: murukku.packSize,
      sellingPrice: 75,
      gstRate: 5,
      hsnCode: murukku.hsnCode,
      imageUrl: murukku.imageUrl,
      unit: murukku.unit,
      reorderLevel: murukku.reorderLevel,
      isActive: true,
      bomItems: murukku.bomItems.map((b: Record<string, any>) => ({
        materialId: b.materialId,
        quantityPerUnit: b.quantityPerUnit,
      })),
    });

    // Ensure enough Murukku FG stock & approve a 150-packet Tamil Nadu order
    const inv = (await callApi(handler, 'GET', '/api/inventory/items', adminToken))
      .data as unknown as Array<Record<string, any>>;
    const mrkInv = inv.find((i) => i.id === murukku.id)!;
    // Top up FG stock indirectly by producing a small run on a side order or updating stock via approved discrepancy
    // First order 150 packets for Tamil Nadu customer
    const custs = (await callApi(handler, 'GET', '/api/salesman/customers', salesmanToken))
      .data as unknown as Array<Record<string, any>>;
    const tnCust = custs.find((c) => String(c.state).toLowerCase() === 'tamil nadu')!;

    const orderRes = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: tnCust.id,
      items: [{ productId: murukku.id, quantity: 150 }],
    });
    expect(orderRes.status).toBe(201);

    // Top up Murukku FG stock via production run if below 150 so Admin can APPROVE_ORDER cleanly
    if (mrkInv.availableStock < 150) {
      db.prepare(`UPDATE stock_balances SET quantity_scaled = ? WHERE item_id = ?`).run(
        200 * 10000,
        murukku.id
      );
    }

    const decRes = await callApi(
      handler,
      'POST',
      `/api/orders/${orderRes.data.id}/decision`,
      adminToken,
      { decision: 'APPROVE_ORDER' }
    );
    expect(decRes.status).toBe(200);

    // Accountant dashboard initially has 0 pending dispatches
    const dashBefore = await callApi(handler, 'GET', '/api/accountant/dashboard', accountantToken);
    expect(dashBefore.status).toBe(200);
    expect(dashBefore.data.pendingInvoicesCount).toBe(0);

    // 1. Admin dispatches 100 packets first
    const disp1 = await callApi(handler, 'POST', '/api/dispatches', adminToken, {
      orderId: orderRes.data.id,
      quantity: 100,
      notes: 'First partial dispatch',
    });
    expect(disp1.status).toBe(201);
    expect(disp1.data.status).toBe('PARTIALLY_DISPATCHED');

    // 2. Accountant sees eligible dispatch and previews GST
    const preview1 = await callApi(
      handler,
      'GET',
      `/api/accountant/dispatches/${disp1.data.id}/preview`,
      accountantToken
    );
    expect(preview1.status).toBe(200);
    expect(preview1.data.supplyType).toBe('INTRA_STATE');
    expect(preview1.data.taxableAmount).toBe(7500);
    expect(preview1.data.cgstAmount).toBe(187.5);
    expect(preview1.data.sgstAmount).toBe(187.5);
    expect(preview1.data.igstAmount).toBe(0);
    expect(preview1.data.totalAmount).toBe(7875);

    // Attempting to invoice > uninvoiced quantity (e.g. 120 > 100) must fail
    const overInv = await callApi(handler, 'POST', '/api/invoices', accountantToken, {
      dispatchId: disp1.data.id,
      quantity: 120,
    });
    expect(overInv.status).toBe(400);

    // 3-4. Accountant generates invoice for Dispatch 1 (100 packets -> ₹7,875)
    const inv1 = await callApi(handler, 'POST', '/api/invoices', accountantToken, {
      dispatchId: disp1.data.id,
    });
    expect(inv1.status).toBe(201);

    // Duplicate invoice attempt on fully invoiced dispatch is blocked (409)
    const dupInv = await callApi(handler, 'POST', '/api/invoices', accountantToken, {
      dispatchId: disp1.data.id,
    });
    expect(dupInv.status).toBe(409);

    // 6-7. Record partial payment of ₹4,000 -> outstanding becomes ₹3,875
    const pay1 = await callApi(handler, 'POST', '/api/payments', accountantToken, {
      invoiceId: inv1.data.id,
      amount: 4000,
      paymentMode: 'UPI',
      referenceNumber: 'UTR-1001',
    });
    expect(pay1.status).toBe(201);
    expect(pay1.data.paymentStatus).toBe('PARTIALLY_PAID');

    const bill1 = await callApi(handler, 'GET', '/api/billing', accountantToken);
    const inv1Record = (bill1.data.invoices as Array<Record<string, any>>).find(
      (i) => i.id === inv1.data.id
    )!;
    expect(inv1Record.totalAmount).toBe(7875);
    expect(inv1Record.amountReceived).toBe(4000);
    expect(inv1Record.outstandingBalance).toBe(3875);

    // Overpayment (> ₹3,875) rejected
    const overPay = await callApi(handler, 'POST', '/api/payments', accountantToken, {
      invoiceId: inv1.data.id,
      amount: 4000,
      paymentMode: 'Cash',
    });
    expect(overPay.status).toBe(400);

    // 8-9. Record second payment ₹3,875 -> status becomes PAID
    const pay2 = await callApi(handler, 'POST', '/api/payments', accountantToken, {
      invoiceId: inv1.data.id,
      amount: 3875,
      paymentMode: 'Bank Transfer',
      referenceNumber: 'NEFT-2002',
    });
    expect(pay2.status).toBe(201);
    expect(pay2.data.paymentStatus).toBe('PAID');

    // 10. Second dispatch for remaining 50 packets -> creates separate eligible invoice for same order
    const disp2 = await callApi(handler, 'POST', '/api/dispatches', adminToken, {
      orderId: orderRes.data.id,
      quantity: 50,
      notes: 'Second partial dispatch',
    });
    expect(disp2.status).toBe(201);
    expect(disp2.data.status).toBe('DISPATCHED');

    const inv2 = await callApi(handler, 'POST', '/api/invoices', accountantToken, {
      dispatchId: disp2.data.id,
    });
    expect(inv2.status).toBe(201);
    expect(inv2.data.invoiceNumber).not.toBe(inv1.data.invoiceNumber);

    const bill2 = await callApi(handler, 'GET', '/api/billing', accountantToken);
    const inv1After = (bill2.data.invoices as Array<Record<string, any>>).find(
      (i) => i.id === inv1.data.id
    )!;
    const inv2After = (bill2.data.invoices as Array<Record<string, any>>).find(
      (i) => i.id === inv2.data.id
    )!;
    expect(inv1After.totalAmount).toBe(7875);
    expect(inv1After.paymentStatus).toBe('PAID');
    expect(inv2After.orderId).toBe(orderRes.data.id);
    expect(inv2After.taxableAmount).toBe(3750);
    expect(inv2After.totalAmount).toBe(3937.5);
  });

  it('Customer-based multi-invoice payment allocation, auditable reversal, invoice cancellation, receivables & reports', async () => {
    // Bengaluru Alumni Store (Karnataka, IGST 12%) already has inv-0002 unpaid; add a second invoice for same customer
    const custId = 'cust-10';
    const invRes0 = (await callApi(handler, 'GET', '/api/billing', accountantToken)).data;
    const seedInv2 = (invRes0.invoices as Array<Record<string, any>>).find(
      (i) => i.id === 'inv-0002'
    )!;
    expect(seedInv2.customerId).toBe(custId);

    // Create & approve another order for cust-10 and dispatch it
    db.prepare(`UPDATE stock_balances SET quantity_scaled = ? WHERE item_id = 'prod-pnt-150'`).run(
      500 * 10000
    );
    const ord = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: custId,
      items: [{ productId: 'prod-pnt-150', quantity: 20 }],
    });
    await callApi(handler, 'POST', `/api/orders/${ord.data.id}/decision`, adminToken, {
      decision: 'APPROVE_ORDER',
    });
    const disp = await callApi(handler, 'POST', '/api/dispatches', adminToken, {
      orderId: ord.data.id,
      quantity: 20,
    });
    const newInv = await callApi(handler, 'POST', '/api/invoices', accountantToken, {
      dispatchId: disp.data.id,
    });
    expect(newInv.status).toBe(201);

    // Test Invoice Cancellation & Re-Invoicing
    const cancelRes = await callApi(
      handler,
      'POST',
      `/api/accountant/invoices/${newInv.data.id}/cancel`,
      accountantToken,
      { reason: 'Billing note correction' }
    );
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.data.status).toBe('CANCELLED');

    // Re-issue corrected invoice on the same dispatch cleanly
    const reInv = await callApi(handler, 'POST', '/api/invoices', accountantToken, {
      dispatchId: disp.data.id,
    });
    expect(reInv.status).toBe(201);

    // Customer-based payment allocated across BOTH inv-0002 (₹1,568) and reInv (partial ₹500)
    const custPay = await callApi(
      handler,
      'POST',
      '/api/accountant/payments/customer',
      accountantToken,
      {
        customerId: custId,
        amount: 2068,
        allocations: [
          { invoiceId: 'inv-0002', amount: 1568 },
          { invoiceId: reInv.data.id, amount: 500 },
        ],
        paymentMode: 'Bank Transfer',
        referenceNumber: 'NEFT-MULTI-1',
      }
    );
    expect(custPay.status).toBe(201);
    expect(custPay.data.unallocatedAmount).toBe(0);

    // Cannot cancel an invoice that has payments recorded
    const blockedCancel = await callApi(
      handler,
      'POST',
      `/api/accountant/invoices/${reInv.data.id}/cancel`,
      accountantToken,
      { reason: 'Should fail' }
    );
    expect(blockedCancel.status).toBe(400);

    // Auditable payment reversal restores invoice balances cleanly
    const revRes = await callApi(
      handler,
      'POST',
      `/api/accountant/payments/${custPay.data.id}/reverse`,
      accountantToken,
      { reason: 'Bank bounce' }
    );
    expect(revRes.status).toBe(200);
    expect(revRes.data.status).toBe('REVERSED');

    const recs = await callApi(handler, 'GET', '/api/accountant/receivables', accountantToken);
    expect(recs.status).toBe(200);
    const blrRec = (recs.data as unknown as Array<Record<string, any>>).find(
      (r) => r.customerId === custId
    )!;
    expect(blrRec.outstandingAmount).toBeGreaterThan(1568);

    const reports = await callApi(handler, 'GET', '/api/accountant/reports', accountantToken);
    expect(reports.status).toBe(200);
    expect(reports.data.salesAndInvoices.activeInvoiceCount).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(reports.data.gstSummary.rows)).toBe(true);
    expect(reports.data.paymentCollection.totalCollected).toBeGreaterThan(0);
    expect(reports.data.outstandingReceivables.totalOutstanding).toBeGreaterThan(0);
  });

  it('Section 11 (11-13): Admin/Owner read financial views; Salesman 403; Accountant 403 on orders/stock/dispatch/master data', async () => {
    // 11 & 13: Admin and Owner can view read-only billing, receivables, and financial reports
    expect((await callApi(handler, 'GET', '/api/billing', adminToken)).status).toBe(200);
    expect((await callApi(handler, 'GET', '/api/accountant/receivables', adminToken)).status).toBe(200);
    expect((await callApi(handler, 'GET', '/api/accountant/reports', adminToken)).status).toBe(200);
    expect((await callApi(handler, 'GET', '/api/billing', ownerToken)).status).toBe(200);
    expect((await callApi(handler, 'GET', '/api/accountant/receivables', ownerToken)).status).toBe(200);
    expect((await callApi(handler, 'GET', '/api/accountant/reports', ownerToken)).status).toBe(200);

    // Admin/Owner/Supervisor/Salesman cannot mutate Accountant invoices or payments (403)
    expect((await callApi(handler, 'POST', '/api/invoices', adminToken, { dispatchId: 'x' })).status).toBe(403);
    expect((await callApi(handler, 'POST', '/api/payments', ownerToken, { invoiceId: 'x', amount: 10 })).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/accountant/dashboard', supervisorToken)).status).toBe(403);

    // 12: Salesman blocked from ALL Accountant endpoints
    expect((await callApi(handler, 'GET', '/api/accountant/dashboard', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/billing', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/accountant/receivables', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/accountant/reports', salesmanToken)).status).toBe(403);

    // Accountant blocked from Admin/Stock/Dispatch/Production/Customer master data mutations
    expect((await callApi(handler, 'POST', '/api/orders/ord-1/decision', accountantToken, { decision: 'APPROVE_ORDER' })).status).toBe(403);
    expect((await callApi(handler, 'POST', '/api/dispatches', accountantToken, { orderId: 'ord-1', quantity: 1 })).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/inventory/items', accountantToken)).status).toBe(403);
    expect((await callApi(handler, 'POST', '/api/management/products', accountantToken, {})).status).toBe(403);
    expect((await callApi(handler, 'POST', '/api/management/customers', accountantToken, {})).status).toBe(403);
    expect((await callApi(handler, 'POST', '/api/production-runs', accountantToken, {})).status).toBe(403);
  });
});
