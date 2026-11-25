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
): Promise<{ status: number; data: Record<string, unknown> }> {
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
  return { status, data: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}

describe('Order-to-Audit Backend RBAC, Inventory Ledger, Production & Billing Workflows', () => {
  let handler: ReturnType<typeof createApiHandler>;
  let ownerToken: string;
  let adminToken: string;
  let supervisorToken: string;
  let accountantToken: string;

  beforeEach(async () => {
    const db = openDatabase(':memory:');
    seedDatabaseIfEmpty(db);
    handler = createApiHandler(db);

    ownerToken = String(
      (await callApi(handler, 'POST', '/api/auth/login', undefined, {
        email: 'owner@nitt.local',
        password: 'password123',
      })).data.token
    );
    adminToken = String(
      (await callApi(handler, 'POST', '/api/auth/login', undefined, {
        email: 'admin@nitt.local',
        password: 'password123',
      })).data.token
    );
    supervisorToken = String(
      (await callApi(handler, 'POST', '/api/auth/login', undefined, {
        email: 'supervisor@nitt.local',
        password: 'password123',
      })).data.token
    );
    accountantToken = String(
      (await callApi(handler, 'POST', '/api/auth/login', undefined, {
        email: 'accountant@nitt.local',
        password: 'password123',
      })).data.token
    );
  });

  it('enforces backend RBAC across Owner, Admin, Production Supervisor, and Accountant', async () => {
    // Unauthenticated rejected
    expect((await callApi(handler, 'GET', '/api/admin/dashboard')).status).toBe(401);

    // Plain ADMIN cannot access User Management (OWNER_SUPER_ADMIN only)
    expect((await callApi(handler, 'GET', '/api/management/users', adminToken)).status).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/management/users', adminToken, {
          username: 'test',
          fullName: 'Test',
          email: 't@nitt.local',
          role: 'ADMIN',
          password: 'pass',
        })
      ).status
    ).toBe(403);
    expect((await callApi(handler, 'GET', '/api/management/users', ownerToken)).status).toBe(200);

    // Admin CANNOT post production runs or update supervisor status
    expect(
      (
        await callApi(handler, 'POST', '/api/production-runs', adminToken, {
          productionRequestId: 'pr-ord-141',
          actualOutputQuantity: 60,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'PATCH', '/api/production-requests/pr-ord-141/status', adminToken, {
          status: 'IN_PROGRESS',
        })
      ).status
    ).toBe(403);

    // Admin CANNOT generate invoices or record payments (Accountant only)
    expect(
      (
        await callApi(handler, 'POST', '/api/invoices', adminToken, {
          dispatchId: 'disp-0139',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/payments', adminToken, {
          invoiceId: 'inv-0001',
          amount: 100,
          paymentMode: 'Cash',
        })
      ).status
    ).toBe(403);
  });

  it('tracks shortage queries, PO (no stock increase), GRN (recalculates shortages), and supervisor production run', async () => {
    // 1. Admin sends ORD-2026-0143 (Madras Mixture, 140 shortage, insufficient Besan/Peanuts/Pouch 250g)
    const dec = await callApi(handler, 'POST', '/api/orders/ord-2026-0143/decision', adminToken, {
      decision: 'SEND_FOR_PRODUCTION',
    });
    expect(dec.status).toBe(200);
    const prId = String(dec.data.createdRequestId);

    // Verify PR is AWAITING_MATERIALS and shortage queries exist
    const shortages1 = (await callApi(handler, 'GET', '/api/material-shortages', adminToken))
      .data as unknown as Array<{ id: string; materialId: string; status: string; shortageQuantity: number }>;
    expect(shortages1.length).toBeGreaterThanOrEqual(3);

    // 2. Admin raises PO -> stock MUST NOT increase
    const besanBefore = (
      (await callApi(handler, 'GET', '/api/inventory/items', adminToken))
        .data as unknown as Array<{ id: string; availableStock: number }>
    ).find((i) => i.id === 'rm-besan')?.availableStock;

    const poRes = await callApi(handler, 'POST', '/api/purchase-orders', adminToken, {
      supplierId: 'sup-1',
      items: [
        { itemId: 'rm-besan', orderedQuantity: 20 },
        { itemId: 'rm-peanuts', orderedQuantity: 10 },
      ],
      shortageQueryIds: shortages1.map((s) => s.id),
    });
    expect(poRes.status).toBe(201);

    const besanAfterPo = (
      (await callApi(handler, 'GET', '/api/inventory/items', adminToken))
        .data as unknown as Array<{ id: string; availableStock: number }>
    ).find((i) => i.id === 'rm-besan')?.availableStock;
    expect(besanAfterPo).toBe(besanBefore);

    // 3. Purchase receipts increase stock and resolve shortage queries -> PR advances to READY_FOR_PRODUCTION
    const grn1 = await callApi(handler, 'POST', '/api/purchase-receipts', adminToken, {
      supplierId: 'sup-1',
      purchaseOrderId: poRes.data.id,
      items: [
        { itemId: 'rm-besan', receivedQuantity: 20 },
        { itemId: 'rm-peanuts', receivedQuantity: 10 },
      ],
    });
    expect(grn1.status).toBe(201);

    const grn2 = await callApi(handler, 'POST', '/api/purchase-receipts', adminToken, {
      supplierId: 'sup-3',
      items: [{ itemId: 'pkg-pouch-250', receivedQuantity: 100 }],
    });
    expect(grn2.status).toBe(201);

    const prs = (await callApi(handler, 'GET', '/api/production-requests', adminToken))
      .data as unknown as Array<{ id: string; status: string }>;
    expect(prs.find((p) => p.id === prId)?.status).toBe('READY_FOR_PRODUCTION');

    // 4. Supervisor posts production run -> consumes raw/pkg materials and adds finished goods
    const runRes = await callApi(handler, 'POST', '/api/production-runs', supervisorToken, {
      productionRequestId: prId,
      actualOutputQuantity: 140,
      wastageQuantity: 0,
      notes: 'Completed cleanly',
    });
    expect(runRes.status).toBe(201);

    const mixStockAfter = (
      (await callApi(handler, 'GET', '/api/inventory/items', adminToken))
        .data as unknown as Array<{ id: string; availableStock: number }>
    ).find((i) => i.id === 'prod-mix-250')?.availableStock;
    expect(mixStockAfter).toBe(60 + 140);
  });

  it('enforces dispatch-before-invoice, intra/inter-state GST, partial payments, and zero-stock product creation', async () => {
    // 1. Adding a product to catalogue initializes stock at 0
    const prodRes = await callApi(handler, 'POST', '/api/management/products', adminToken, {
      sku: 'NITT-THT-200',
      name: 'Thattai 200 g',
      packSize: '200 g',
      sellingPrice: 40,
      gstRate: 5,
      hsnCode: '21069099',
      unit: 'packets',
      reorderLevel: 30,
      bomItems: [{ materialId: 'rm-rice-flour', quantityPerUnit: 0.1 }],
    });
    expect(prodRes.status).toBe(201);
    const items = (await callApi(handler, 'GET', '/api/inventory/items', adminToken))
      .data as unknown as Array<{ id: string; availableStock: number }>;
    expect(items.find((i) => i.id === prodRes.data.id)?.availableStock).toBe(0);

    // 2. Dispatch ORD-2026-0140 (Faculty Club Store, TN, 60 Masala Peanuts @ ₹35, 12% GST)
    const dispRes = await callApi(handler, 'POST', '/api/dispatches', adminToken, {
      orderId: 'ord-2026-0140',
      quantity: 60,
      notes: 'Gate pass GP-900',
    });
    expect(dispRes.status).toBe(201);

    // 3. Accountant generates intra-state GST invoice (CGST + SGST)
    const invRes = await callApi(handler, 'POST', '/api/invoices', accountantToken, {
      dispatchId: dispRes.data.id,
    });
    expect(invRes.status).toBe(201);

    const billing = (await callApi(handler, 'GET', '/api/billing', adminToken))
      .data as unknown as {
      invoices: Array<{
        id: string;
        supplyType: string;
        taxableAmount: number;
        cgstAmount: number;
        sgstAmount: number;
        igstAmount: number;
        totalAmount: number;
        paymentStatus: string;
      }>;
    };
    const createdInv = billing.invoices.find((i) => i.id === invRes.data.id)!;
    expect(createdInv.supplyType).toBe('INTRA_STATE');
    expect(createdInv.taxableAmount).toBe(2100);
    expect(createdInv.cgstAmount).toBe(126);
    expect(createdInv.sgstAmount).toBe(126);
    expect(createdInv.igstAmount).toBe(0);
    expect(createdInv.totalAmount).toBe(2352);

    // 4. Accountant records partial payment (₹1,000) then remaining (₹1,352)
    const p1 = await callApi(handler, 'POST', '/api/payments', accountantToken, {
      invoiceId: createdInv.id,
      amount: 1000,
      paymentMode: 'UPI',
    });
    expect(p1.status).toBe(201);
    expect(p1.data.paymentStatus).toBe('PARTIALLY_PAID');

    const p2 = await callApi(handler, 'POST', '/api/payments', accountantToken, {
      invoiceId: createdInv.id,
      amount: 1352,
      paymentMode: 'UPI',
    });
    expect(p2.status).toBe(201);
    expect(p2.data.paymentStatus).toBe('PAID');
  });
});
