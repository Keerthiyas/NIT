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

  it('validates, stores, replaces, and removes product images securely in Product Catalogue', async () => {
    // 1. Seeded products each have distinct corresponding images
    const seededProds = (
      await callApi(handler, 'GET', '/api/management/products', adminToken)
    ).data as unknown as Array<{ id: string; name: string; imageUrl?: string }>;
    const urls = seededProds.map((p) => p.imageUrl).filter(Boolean);
    expect(urls.length).toBe(4);
    expect(new Set(urls).size).toBe(4);

    // 2. Rejects unsupported MIME type and mismatched magic bytes
    const badMime = await callApi(
      handler,
      'POST',
      '/api/management/products/image',
      adminToken,
      { mimeType: 'image/svg+xml', dataBase64: Buffer.from('<svg></svg>').toString('base64') }
    );
    expect(badMime.status).toBe(400);

    const spoofedPng = await callApi(
      handler,
      'POST',
      '/api/management/products/image',
      adminToken,
      { mimeType: 'image/png', dataBase64: Buffer.from('not-a-real-png-header').toString('base64') }
    );
    expect(spoofedPng.status).toBe(400);

    // 3. Rejects oversized upload (> 2 MB)
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
      Buffer.alloc(2 * 1024 * 1024 + 64),
    ]);
    const bigRes = await callApi(
      handler,
      'POST',
      '/api/management/products/image',
      adminToken,
      { mimeType: 'image/png', dataBase64: oversized.toString('base64') }
    );
    expect(bigRes.status).toBe(400);

    // 4. Valid PNG upload -> saved with product -> replaced -> removed
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    const up1 = await callApi(
      handler,
      'POST',
      '/api/management/products/image',
      adminToken,
      { mimeType: 'image/png', dataBase64: validPng.toString('base64') }
    );
    expect(up1.status).toBe(201);
    const imgUrl1 = String(up1.data.imageUrl);
    expect(imgUrl1).toMatch(/^\/api\/uploads\/products\/prod-[a-f0-9-]+\.png$/);

    const createRes = await callApi(handler, 'POST', '/api/management/products', adminToken, {
      sku: 'NITT-THP-200',
      name: 'Thattai 200 g',
      packSize: '200 g',
      sellingPrice: 42,
      gstRate: 5,
      hsnCode: '21069099',
      imageUrl: imgUrl1,
      unit: 'packets',
      reorderLevel: 30,
      bomItems: [{ materialId: 'rm-rice-flour', quantityPerUnit: 0.1 }],
    });
    expect(createRes.status).toBe(201);
    const createdId = String(createRes.data.id);

    // Remove image cleanly on update
    const updRes = await callApi(
      handler,
      'PUT',
      `/api/management/products/${createdId}`,
      adminToken,
      {
        sku: 'NITT-THP-200',
        name: 'Thattai 200 g',
        packSize: '200 g',
        sellingPrice: 42,
        gstRate: 5,
        hsnCode: '21069099',
        imageUrl: '',
        unit: 'packets',
        reorderLevel: 30,
        bomItems: [{ materialId: 'rm-rice-flour', quantityPerUnit: 0.1 }],
      }
    );
    expect(updRes.status).toBe(200);

    const afterList = (
      await callApi(handler, 'GET', '/api/management/products', adminToken)
    ).data as unknown as Array<{ id: string; imageUrl?: string }>;
    expect(afterList.find((p) => p.id === createdId)?.imageUrl).toBeUndefined();
  });

  it('supports Salesman multi-product ordering, zero stock exposure, strict RBAC, and Admin Order Review integration', async () => {
    const salesmanToken = String(
      (
        await callApi(handler, 'POST', '/api/auth/login', undefined, {
          email: 'salesman@nitt.local',
          password: 'password123',
        })
      ).data.token
    );

    // 1. Salesman product catalogue exposes product details & images but ZERO stock/reorder/BOM fields
    const catRes = await callApi(handler, 'GET', '/api/salesman/products', salesmanToken);
    expect(catRes.status).toBe(200);
    const catProducts = catRes.data as unknown as Array<Record<string, unknown>>;
    expect(catProducts.length).toBe(4);
    for (const p of catProducts) {
      expect(p).not.toHaveProperty('availableStock');
      expect(p).not.toHaveProperty('reorderLevel');
      expect(p).not.toHaveProperty('movementCount');
      expect(p).not.toHaveProperty('bomItems');
      expect(p.imageUrl).toBeTruthy();
    }

    // 2. Salesman is strictly blocked (403) from Admin, Supervisor, Accountant, Inventory, and Customer write endpoints
    expect((await callApi(handler, 'GET', '/api/admin/dashboard', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/orders', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/inventory/items', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/production-requests', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/billing', salesmanToken)).status).toBe(403);
    expect((await callApi(handler, 'GET', '/api/management/users', salesmanToken)).status).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/management/customers', salesmanToken, {
          code: 'CUST-X',
          name: 'Blocked',
          contactPerson: 'X',
          phone: '1',
          billingAddress: 'A',
          deliveryAddress: 'A',
          state: 'Tamil Nadu',
        })
      ).status
    ).toBe(403);
    expect(
      (await callApi(handler, 'GET', '/api/orders/ord-2026-0142/availability', salesmanToken)).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/orders/ord-2026-0142/decision', salesmanToken, {
          decision: 'APPROVE_ORDER',
        })
      ).status
    ).toBe(403);

    // 3. Salesman cannot view another salesman's order (ord-2026-0141 belongs to usr-salesman-2)
    const otherOrders = (await callApi(handler, 'GET', '/api/salesman/orders', salesmanToken))
      .data as unknown as Array<{ id: string }>;
    expect(otherOrders.some((o) => o.id === 'ord-2026-0141')).toBe(false);
    expect(
      (await callApi(handler, 'GET', '/api/salesman/orders/ord-2026-0141', salesmanToken)).status
    ).toBe(403);

    // 4. Salesman submits a multi-product order exceeding finished stock -> NOT blocked by stock!
    const createOrderRes = await callApi(
      handler,
      'POST',
      '/api/salesman/orders',
      salesmanToken,
      {
        customerId: 'cust-04',
        items: [
          { productId: 'prod-mrk-200', quantity: 150 }, // FG stock 100 -> shortage 50
          { productId: 'prod-mix-250', quantity: 80 },  // FG stock 60 -> shortage 20
        ],
        customerNote: 'Deliver before 4 PM to Amber Mess',
      }
    );
    expect(createOrderRes.status).toBe(201);
    const createdOrder = createOrderRes.data as unknown as {
      id: string;
      orderNumber: string;
      status: string;
      requestedQuantity: number;
      subtotal: number;
      items: Array<{ productId: string; requestedQuantity: number; lineTotal: number }>;
    };
    expect(createdOrder.status).toBe('SUBMITTED');
    expect(createdOrder.requestedQuantity).toBe(230);
    expect(createdOrder.subtotal).toBe(150 * 45 + 80 * 60);
    expect(createdOrder.items).toHaveLength(2);

    // 5. Appears in Admin Orders & evaluates multi-product availability + Send for Production
    const adminOrders = (await callApi(handler, 'GET', '/api/orders', adminToken))
      .data as unknown as Array<{ id: string; orderNumber: string; items: unknown[] }>;
    const adminView = adminOrders.find((o) => o.id === createdOrder.id);
    expect(adminView).toBeDefined();
    expect(adminView?.items).toHaveLength(2);

    const availRes = await callApi(
      handler,
      'GET',
      `/api/orders/${createdOrder.id}/availability`,
      adminToken
    );
    expect(availRes.status).toBe(200);
    const avail = availRes.data as unknown as {
      shortageQuantity: number;
      productionRequired: boolean;
      itemAnalyses: Array<{ productId: string; shortageQuantity: number }>;
    };
    expect(avail.productionRequired).toBe(true);
    expect(avail.shortageQuantity).toBe(70);
    expect(avail.itemAnalyses).toHaveLength(2);

    const decisionRes = await callApi(
      handler,
      'POST',
      `/api/orders/${createdOrder.id}/decision`,
      adminToken,
      {
        decision: 'SEND_FOR_PRODUCTION',
        note: 'INTERNAL ADMIN NOTE: high priority',
      }
    );
    expect(decisionRes.status).toBe(200);

    // 6. Salesman sees updated status & milestone without seeing internal Admin note
    const salesmanDetailRes = await callApi(
      handler,
      'GET',
      `/api/salesman/orders/${createdOrder.id}`,
      salesmanToken
    );
    expect(salesmanDetailRes.status).toBe(200);
    const detailText = JSON.stringify(salesmanDetailRes.data);
    expect(detailText).toContain('PRODUCTION_REQUIRED');
    expect(detailText).not.toContain('INTERNAL ADMIN NOTE');
  });

  it('allows Salesman to register a new customer during order creation with duplicate & RBAC validation', async () => {
    const salesmanToken = String(
      (
        await callApi(handler, 'POST', '/api/auth/login', undefined, {
          email: 'salesman@nitt.local',
          password: 'password123',
        })
      ).data.token
    );

    // 1. Rejects missing required fields and invalid mobile format
    const badMobile = await callApi(
      handler,
      'POST',
      '/api/salesman/customers',
      salesmanToken,
      {
        name: 'Bad Mobile Store',
        phone: '12345',
        address: 'Trichy',
        state: 'Tamil Nadu',
      }
    );
    expect(badMobile.status).toBe(400);

    // 2. Rejects duplicate mobile number against existing seeded customer (+91-98421-10004)
    const dupMobile = await callApi(
      handler,
      'POST',
      '/api/salesman/customers',
      salesmanToken,
      {
        name: 'Duplicate Mobile Store',
        phone: '9842110004',
        address: 'Trichy',
        state: 'Tamil Nadu',
      }
    );
    expect(dupMobile.status).toBe(409);

    // 3. Rejects duplicate GSTIN against existing seeded customer (33AAACN1234A1Z5)
    const dupGstin = await callApi(
      handler,
      'POST',
      '/api/salesman/customers',
      salesmanToken,
      {
        name: 'Duplicate GSTIN Store',
        phone: '9876501234',
        address: 'Trichy',
        state: 'Tamil Nadu',
        gstin: '33AAACN1234A1Z5',
      }
    );
    expect(dupGstin.status).toBe(409);

    // 4. Registers a valid new customer and immediately places an order for them
    const createCust = await callApi(
      handler,
      'POST',
      '/api/salesman/customers',
      salesmanToken,
      {
        name: 'Thillai Nagar Provision Mart',
        contactPerson: 'S. Karthikeyan',
        phone: '9876543210',
        email: 'mart@thillainagar.in',
        address: '12 Salai Road, Thillai Nagar, Trichy - 620018',
        state: 'Tamil Nadu',
        gstin: '33AABCT5566K1Z9',
      }
    );
    expect(createCust.status).toBe(201);
    const newCustId = String(createCust.data.id);
    expect(createCust.data.code).toMatch(/^CUST-REG-\d+/);

    const newOrder = await callApi(
      handler,
      'POST',
      '/api/salesman/orders',
      salesmanToken,
      {
        customerId: newCustId,
        items: [{ productId: 'prod-mrk-200', quantity: 25 }],
        customerNote: 'First order for new customer',
      }
    );
    expect(newOrder.status).toBe(201);
    expect(newOrder.data.customerName).toBe('Thillai Nagar Provision Mart');

    // 5. Admin sees the new customer in Management -> Customers and cannot be edited/deleted by Salesman
    const adminCusts = (
      await callApi(handler, 'GET', '/api/management/customers', adminToken)
    ).data as unknown as Array<{ id: string; name: string }>;
    expect(adminCusts.some((c) => c.id === newCustId)).toBe(true);

    expect(
      (
        await callApi(handler, 'PUT', `/api/management/customers/${newCustId}`, salesmanToken, {
          code: 'HACK',
          name: 'Hacked',
          contactPerson: 'X',
          phone: '9876543210',
          billingAddress: 'A',
          deliveryAddress: 'A',
          state: 'Tamil Nadu',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(
          handler,
          'PATCH',
          `/api/management/customers/${newCustId}/status`,
          salesmanToken,
          { isActive: false }
        )
      ).status
    ).toBe(403);
  });
});
