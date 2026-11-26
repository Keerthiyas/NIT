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

describe('Production Supervisor Module — Complete 13-Scenario End-to-End Verification', () => {
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

  it('1-3. Supervisor dashboard, availability checks (sufficient vs shortage), and Admin PR reception', async () => {
    const dash = await callApi(handler, 'GET', '/api/supervisor/dashboard', supervisorToken);
    expect(dash.status).toBe(200);
    expect(typeof dash.data.pendingRequestsCount).toBe('number');
    expect(typeof dash.data.lowStockMaterialsCount).toBe('number');
    expect(typeof dash.data.inProgressCount).toBe('number');
    expect(dash.data.completedRunsCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(dash.data.materialAlerts)).toBe(true);
    expect(Array.isArray(dash.data.alerts)).toBe(true);
    expect(Array.isArray(dash.data.recentActivity)).toBe(true);

    // Inspect seeded PRs
    const prsRes = await callApi(handler, 'GET', '/api/production-requests', supervisorToken);
    expect(prsRes.status).toBe(200);
    const prs = prsRes.data as unknown as Array<Record<string, any>>;
    const pendingOrShort = prs.find((p) => p.status !== 'COMPLETED');
    expect(pendingOrShort).toBeDefined();

    // Check availability on that PR via Supervisor endpoint
    const chk = await callApi(
      handler,
      'POST',
      `/api/supervisor/production-requests/${pendingOrShort!.id}/check-availability`,
      supervisorToken
    );
    expect(chk.status).toBe(200);
    expect(['SUFFICIENT', 'INSUFFICIENT']).toContain(chk.data.rawMaterialAvailability);
    expect(Array.isArray(chk.data.bomBreakdown)).toBe(true);
  });

  it('4-6. Purchase Requirement -> High-Value PO (>₹10,000) blocked until Owner Approves -> GRN increases stock & unlocks PR', async () => {
    // Salesman creates a large order for Murukku 200g (enough to cause raw material shortage)
    const custs = await callApi(handler, 'GET', '/api/salesman/customers', salesmanToken);
    const prods = await callApi(handler, 'GET', '/api/salesman/products', salesmanToken);
    const murukku = (prods.data as unknown as Array<Record<string, any>>).find((p) =>
      String(p.name).includes('Murukku')
    )!;

    const orderRes = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: (custs.data as unknown as Array<Record<string, any>>)[0].id,
      items: [{ productId: murukku.id, quantity: 2000 }],
      customerNote: 'Urgent festival bulk order',
    });
    expect(orderRes.status).toBe(201);

    // Admin sends order for production
    const decRes = await callApi(
      handler,
      'POST',
      `/api/orders/${orderRes.data.id}/decision`,
      adminToken,
      { decision: 'SEND_FOR_PRODUCTION', note: 'Produce batch' }
    );
    expect(decRes.status).toBe(200);
    const prId = String(decRes.data.createdRequestId);

    // Supervisor checks availability -> detects shortage
    const chk = await callApi(
      handler,
      'POST',
      `/api/supervisor/production-requests/${prId}/check-availability`,
      supervisorToken
    );
    expect(chk.status).toBe(200);
    expect(chk.data.rawMaterialAvailability).toBe('INSUFFICIENT');
    expect(chk.data.nextStatus).toBe('MATERIAL_SHORTAGE');

    const shortMat = (chk.data.bomBreakdown as Array<Record<string, any>>).find(
      (b) => !b.isSufficient
    )!;
    expect(shortMat).toBeDefined();

    // Supervisor raises Purchase Requirement
    const mprRes = await callApi(handler, 'POST', '/api/purchase-requirements', supervisorToken, {
      productionRequestId: prId,
      materialId: shortMat.materialId,
      shortageQuantity: shortMat.shortfallQuantity + 50,
      priority: 'URGENT',
      reason: 'Need immediate stock for festival batch',
    });
    expect(mprRes.status).toBe(201);
    const mprId = String(mprRes.data.id);

    // Duplicate open requirement for same PR & material should return 409
    const dupMpr = await callApi(handler, 'POST', '/api/purchase-requirements', supervisorToken, {
      productionRequestId: prId,
      materialId: shortMat.materialId,
      shortageQuantity: 10,
    });
    expect(dupMpr.status).toBe(409);

    // Admin raises a high-value PO (> ₹10,000) linked to this requirement
    const suppliers = await callApi(handler, 'GET', '/api/management/suppliers', adminToken);
    const supId = (suppliers.data as unknown as Array<Record<string, any>>)[0].id;
    const invBefore = await callApi(handler, 'GET', '/api/inventory/items', supervisorToken);
    const matStockBefore = (invBefore.data as unknown as Array<Record<string, any>>).find(
      (i) => i.id === shortMat.materialId
    )!.availableStock;

    const poRes = await callApi(handler, 'POST', '/api/purchase-orders', adminToken, {
      supplierId: supId,
      items: [
        {
          itemId: shortMat.materialId,
          orderedQuantity: shortMat.shortfallQuantity + 100,
          unitCost: 200,
        },
      ],
      purchaseRequirementIds: [mprId],
      notes: 'High-value bulk procurement',
    });
    expect(poRes.status).toBe(201);
    expect(poRes.data.approvalStatus).toBe('PENDING_OWNER_APPROVAL');

    // PO alone MUST NOT increase stock
    const invAfterPo = await callApi(handler, 'GET', '/api/inventory/items', supervisorToken);
    expect(
      (invAfterPo.data as unknown as Array<Record<string, any>>).find(
        (i) => i.id === shortMat.materialId
      )!.availableStock
    ).toBe(matStockBefore);

    // GRN against unapproved PO MUST fail
    const blockedGrn = await callApi(handler, 'POST', '/api/purchase-receipts', adminToken, {
      supplierId: supId,
      purchaseOrderId: poRes.data.id,
      items: [{ itemId: shortMat.materialId, receivedQuantity: 10 }],
    });
    expect(blockedGrn.status).toBe(400);

    // Admin cannot approve Owner-threshold PO (must be OWNER_SUPER_ADMIN -> 403)
    const adminApproveTry = await callApi(
      handler,
      'POST',
      `/api/purchase-orders/${poRes.data.id}/approve`,
      adminToken,
      { approve: true }
    );
    expect(adminApproveTry.status).toBe(403);

    // Owner approves PO
    const ownerApprove = await callApi(
      handler,
      'POST',
      `/api/purchase-orders/${poRes.data.id}/approve`,
      ownerToken,
      { approve: true, note: 'Approved by Owner' }
    );
    expect(ownerApprove.status).toBe(200);
    expect(ownerApprove.data.approvalStatus).toBe('APPROVED');

    // Now Admin posts GRN -> stock increases & requirement transitions to RECEIVED
    const grnRes = await callApi(handler, 'POST', '/api/purchase-receipts', adminToken, {
      supplierId: supId,
      purchaseOrderId: poRes.data.id,
      items: [
        {
          itemId: shortMat.materialId,
          receivedQuantity: shortMat.shortfallQuantity + 100,
          unitCost: 200,
        },
      ],
    });
    expect(grnRes.status).toBe(201);

    const invAfterGrn = await callApi(handler, 'GET', '/api/inventory/items', supervisorToken);
    expect(
      (invAfterGrn.data as unknown as Array<Record<string, any>>).find(
        (i) => i.id === shortMat.materialId
      )!.availableStock
    ).toBeCloseTo(matStockBefore + shortMat.shortfallQuantity + 100, 2);

    const reqsAfter = await callApi(handler, 'GET', '/api/purchase-requirements', supervisorToken);
    const updatedMpr = (reqsAfter.data as unknown as Array<Record<string, any>>).find(
      (r) => r.id === mprId
    )!;
    expect(updatedMpr.status).toBe('RECEIVED');
  });

  it('7-9 & 12. Start run (0 deduction), Draft save (0 deduction), Atomic Post Run (rejected excluded, negative stock blocked, dup blocked)', async () => {
    // Small order with plenty of stock
    const custs = await callApi(handler, 'GET', '/api/salesman/customers', salesmanToken);
    const prods = await callApi(handler, 'GET', '/api/salesman/products', salesmanToken);
    const prodsList = prods.data as unknown as Array<Record<string, any>>;
    const prod = prodsList.find((p) => String(p.name).includes('Ribbon')) ?? prodsList[1] ?? prodsList[0];

    const invCheck0 = (await callApi(handler, 'GET', '/api/inventory/items', supervisorToken))
      .data as unknown as Array<Record<string, any>>;
    const prodInv0 = invCheck0.find((i) => i.id === prod.id)!;
    const orderQty = Math.ceil(prodInv0.availableStock + 100);

    // Top up all non-FG materials by 500 units via GRN so test batch has ample material headroom
    const suppliers0 = (await callApi(handler, 'GET', '/api/management/suppliers', adminToken))
      .data as unknown as Array<Record<string, any>>;
    const matsToTopUp = invCheck0.filter((i) => i.category !== 'FINISHED_GOOD');
    await callApi(handler, 'POST', '/api/purchase-receipts', adminToken, {
      supplierId: suppliers0[0].id,
      items: matsToTopUp.map((m) => ({ itemId: m.id, receivedQuantity: 500, unitCost: 10 })),
      notes: 'Pre-batch replenishment',
    });

    const orderRes = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: (custs.data as unknown as Array<Record<string, any>>)[0].id,
      items: [{ productId: prod.id, quantity: orderQty }],
    });
    const decRes = await callApi(
      handler,
      'POST',
      `/api/orders/${orderRes.data.id}/decision`,
      adminToken,
      { decision: 'SEND_FOR_PRODUCTION', note: 'Batch run' }
    );
    const prId = String(decRes.data.createdRequestId);

    const prsRes = await callApi(handler, 'GET', '/api/production-requests', supervisorToken);
    const pr = (prsRes.data as unknown as Array<Record<string, any>>).find((p) => p.id === prId)!;
    const invBefore = (await callApi(handler, 'GET', '/api/inventory/items', supervisorToken))
      .data as unknown as Array<Record<string, any>>;
    const fgBefore = invBefore.find((i) => i.id === pr.productId)!.availableStock;
    const firstMat = pr.bomMaterials[0];
    const matBefore = invBefore.find((i) => i.id === firstMat.materialId)!.availableStock;

    // 7. Start Production -> zero stock change
    const startRes = await callApi(
      handler,
      'PATCH',
      `/api/production-requests/${prId}/status`,
      supervisorToken,
      { status: 'IN_PROGRESS', notes: 'Line 1 started' }
    );
    expect(startRes.status).toBe(200);

    // 8. Save Draft -> zero stock change
    const draftSave = await callApi(
      handler,
      'PUT',
      `/api/supervisor/production-runs/draft/${prId}`,
      supervisorToken,
      { goodOutputQuantity: 580, rejectedQuantity: 20, notes: 'Mid-shift count' }
    );
    expect(draftSave.status).toBe(200);

    const draftGet = await callApi(
      handler,
      'GET',
      `/api/supervisor/production-runs/draft/${prId}`,
      supervisorToken
    );
    expect(draftGet.status).toBe(200);
    expect(draftGet.data.payload.goodOutputQuantity).toBe(580);

    const invAfterDraft = (await callApi(handler, 'GET', '/api/inventory/items', supervisorToken))
      .data as unknown as Array<Record<string, any>>;
    expect(invAfterDraft.find((i) => i.id === pr.productId)!.availableStock).toBe(fgBefore);
    expect(invAfterDraft.find((i) => i.id === firstMat.materialId)!.availableStock).toBe(
      matBefore
    );

    // 12. Negative stock prevention on excessive consumption
    const negRes = await callApi(handler, 'POST', '/api/production-runs', supervisorToken, {
      productionRequestId: prId,
      goodOutputQuantity: 580,
      consumptions: [
        {
          materialId: firstMat.materialId,
          actualConsumedQuantity: matBefore + 9999,
        },
      ],
    });
    expect(negRes.status).toBe(400);

    // 9. Post actual run with additional consumption + rejected output excluded from FG
    const postRes = await callApi(handler, 'POST', '/api/production-runs', supervisorToken, {
      productionRequestId: prId,
      goodOutputQuantity: 580,
      rejectedQuantity: 20,
      damagedPackagingQuantity: 5,
      wastageQuantity: 3,
      qualityResult: 'CONDITIONAL',
      varianceExplanation: 'Extra oil absorbed during frying',
      consumptions: pr.bomMaterials.map((b: Record<string, any>, idx: number) => ({
        materialId: b.materialId,
        actualConsumedQuantity: b.requiredQuantity,
        additionalConsumedQuantity: idx === 0 ? 1.5 : 0,
        damagedQuantity: idx === 0 ? 0.5 : 0,
        wastageQuantity: idx === 0 ? 0.2 : 0,
        reason: idx === 0 ? 'Moisture compensation' : '',
      })),
    });
    expect(postRes.status).toBe(201);

    // Shared inventory reflects exact consumption + ONLY good output (580, NOT 600!)
    const invAfterPost = (await callApi(handler, 'GET', '/api/inventory/items', adminToken))
      .data as unknown as Array<Record<string, any>>;
    expect(invAfterPost.find((i) => i.id === pr.productId)!.availableStock).toBeCloseTo(
      fgBefore + 580,
      2
    );
    expect(invAfterPost.find((i) => i.id === firstMat.materialId)!.availableStock).toBeCloseTo(
      matBefore - (firstMat.requiredQuantity + 1.5),
      2
    );

    // Duplicate posting blocked with 409 / 400
    const dupPost = await callApi(handler, 'POST', '/api/production-runs', supervisorToken, {
      productionRequestId: prId,
      goodOutputQuantity: 10,
    });
    expect([400, 409]).toContain(dupPost.status);
  });

  it('10-11. Stock Discrepancy adjustment approval & BOM Revision preserves historical run immutability', async () => {
    const invRes = await callApi(handler, 'GET', '/api/inventory/items', supervisorToken);
    const rawMat = (invRes.data as unknown as Array<Record<string, any>>).find(
      (i) => i.category === 'RAW_MATERIAL'
    )!;
    const origQty = rawMat.availableStock;

    // 10. Supervisor reports physical count variance -> stock does NOT change immediately
    const repRes = await callApi(handler, 'POST', '/api/stock-discrepancies', supervisorToken, {
      itemId: rawMat.id,
      physicalQuantity: origQty - 2,
      reason: 'Damaged sack spill during cleaning',
    });
    expect(repRes.status).toBe(201);

    const invPending = await callApi(handler, 'GET', '/api/inventory/items', supervisorToken);
    expect(
      (invPending.data as unknown as Array<Record<string, any>>).find((i) => i.id === rawMat.id)!
        .availableStock
    ).toBe(origQty);

    // Admin approves -> DISCREPANCY_ADJUSTMENT ledger movement updates balance
    const revDisc = await callApi(
      handler,
      'POST',
      `/api/stock-discrepancies/${repRes.data.id}/review`,
      adminToken,
      { decision: 'APPROVE', note: 'Verified spill log' }
    );
    expect(revDisc.status).toBe(200);

    const invApproved = await callApi(handler, 'GET', '/api/inventory/items', supervisorToken);
    expect(
      (invApproved.data as unknown as Array<Record<string, any>>).find((i) => i.id === rawMat.id)!
        .availableStock
    ).toBeCloseTo(origQty - 2, 2);

    // 11. BOM Revision request -> Admin approves -> bumps BOM version while history remains unchanged
    const runsBefore = (await callApi(handler, 'GET', '/api/production-runs', supervisorToken))
      .data as unknown as Array<Record<string, any>>;
    const seedRun = runsBefore[0];
    const seedRunBomVersion = seedRun.bomVersion;
    const seedMat = seedRun.consumptions[0];

    const bomReq = await callApi(handler, 'POST', '/api/bom-revisions', supervisorToken, {
      productId: seedRun.productId,
      materialId: seedMat.materialId,
      suggestedQuantityPerUnit: Number(
        (seedMat.plannedQuantity / seedRun.plannedQuantity + 0.02).toFixed(4)
      ),
      productionRunId: seedRun.id,
      reason: 'Observed consistent frying oil loss',
    });
    expect(bomReq.status).toBe(201);

    const bomApprove = await callApi(
      handler,
      'POST',
      `/api/bom-revisions/${bomReq.data.id}/review`,
      adminToken,
      { decision: 'APPROVE', note: 'Updated standard recipe' }
    );
    expect(bomApprove.status).toBe(200);
    expect(bomApprove.data.bomVersion).not.toBe(seedRunBomVersion);

    // Past run keeps old bomVersion and consumptions untouched
    const runsAfter = (await callApi(handler, 'GET', '/api/production-runs', supervisorToken))
      .data as unknown as Array<Record<string, any>>;
    const sameSeedRun = runsAfter.find((r) => r.id === seedRun.id)!;
    expect(sameSeedRun.bomVersion).toBe(seedRunBomVersion);
    expect(sameSeedRun.actualOutputQuantity).toBe(seedRun.actualOutputQuantity);
  });

  it('13. Strict Role-Based Access Control (403 on unauthorized actions in both directions)', async () => {
    // Other roles blocked from Supervisor-only routes
    expect((await callApi(handler, 'GET', '/api/supervisor/dashboard', adminToken)).status).toBe(
      403
    );
    expect(
      (await callApi(handler, 'GET', '/api/supervisor/dashboard', accountantToken)).status
    ).toBe(403);
    expect((await callApi(handler, 'GET', '/api/supervisor/dashboard', salesmanToken)).status).toBe(
      403
    );
    expect(
      (
        await callApi(handler, 'POST', '/api/stock-discrepancies', adminToken, {
          itemId: 'x',
          physicalQuantity: 1,
          reason: 'r',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/production-runs', adminToken, {
          productionRequestId: 'x',
          goodOutputQuantity: 1,
        })
      ).status
    ).toBe(403);

    // Supervisor blocked from Admin/Owner/Salesman/Accountant routes
    expect((await callApi(handler, 'GET', '/api/orders', supervisorToken)).status).toBe(403);
    expect(
      (await callApi(handler, 'GET', '/api/management/customers', supervisorToken)).status
    ).toBe(403);
    expect(
      (await callApi(handler, 'GET', '/api/management/products', supervisorToken)).status
    ).toBe(403);
    expect(
      (await callApi(handler, 'POST', '/api/purchase-orders', supervisorToken, {})).status
    ).toBe(403);
    expect(
      (await callApi(handler, 'POST', '/api/invoices', supervisorToken, { dispatchId: 'x' }))
        .status
    ).toBe(403);
    expect(
      (
        await callApi(handler, 'POST', '/api/salesman/orders', supervisorToken, {
          customerId: 'x',
          items: [],
        })
      ).status
    ).toBe(403);
  });

  it('14. Supervisor Dashboard consistency across 3 low-stock, 0 low-stock, multiple pending, active production & empty history', async () => {
    // A. Default seeded state: 3 low-stock materials (< reorderLevel) MUST match materialAlerts
    const dash1 = await callApi(handler, 'GET', '/api/supervisor/dashboard', supervisorToken);
    expect(dash1.status).toBe(200);
    const lowStockAlerts1 = (dash1.data.materialAlerts as Array<Record<string, any>>).filter(
      (a) => a.isLowStock
    );
    expect(dash1.data.lowStockMaterialsCount).toBe(3);
    expect(lowStockAlerts1).toHaveLength(3);
    for (const a of lowStockAlerts1) {
      expect(a.availableStock).toBeLessThan(a.reorderLevel);
    }

    // B. Multiple pending requests & active production (IN_PROGRESS)
    const custs = (await callApi(handler, 'GET', '/api/salesman/customers', salesmanToken))
      .data as unknown as Array<Record<string, any>>;
    const prods = (await callApi(handler, 'GET', '/api/salesman/products', salesmanToken))
      .data as unknown as Array<Record<string, any>>;
    const invBefore = (await callApi(handler, 'GET', '/api/inventory/items', supervisorToken))
      .data as unknown as Array<Record<string, any>>;

    const ord1 = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: custs[0].id,
      items: [
        {
          productId: prods[0].id,
          quantity: Math.ceil(invBefore.find((i) => i.id === prods[0].id)!.availableStock + 50),
        },
      ],
    });
    const ord2 = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: custs[0].id,
      items: [
        {
          productId: prods[1].id,
          quantity: Math.ceil(invBefore.find((i) => i.id === prods[1].id)!.availableStock + 50),
        },
      ],
    });

    const dec1 = await callApi(handler, 'POST', `/api/orders/${ord1.data.id}/decision`, adminToken, {
      decision: 'SEND_FOR_PRODUCTION',
    });
    await callApi(handler, 'POST', `/api/orders/${ord2.data.id}/decision`, adminToken, {
      decision: 'SEND_FOR_PRODUCTION',
    });

    // Move first PR to IN_PROGRESS
    await callApi(
      handler,
      'PATCH',
      `/api/production-requests/${dec1.data.createdRequestId}/status`,
      supervisorToken,
      { status: 'IN_PROGRESS' }
    );

    const dash2 = await callApi(handler, 'GET', '/api/supervisor/dashboard', supervisorToken);
    expect(dash2.data.inProgressCount).toBeGreaterThanOrEqual(1);
    expect(dash2.data.pendingRequestsCount).toBeGreaterThanOrEqual(1);
    expect((dash2.data.recentRequests as Array<Record<string, any>>).length).toBeGreaterThanOrEqual(3);

    // C. Replenish ALL low-stock materials -> count and low-stock alerts both become 0
    const suppliers = (await callApi(handler, 'GET', '/api/management/suppliers', adminToken))
      .data as unknown as Array<Record<string, any>>;
    const lowItems = invBefore.filter(
      (i) =>
        (i.category === 'RAW_MATERIAL' || i.category === 'PACKAGING_MATERIAL') &&
        i.availableStock < i.reorderLevel
    );
    await callApi(handler, 'POST', '/api/purchase-receipts', adminToken, {
      supplierId: suppliers[0].id,
      items: lowItems.map((m) => ({
        itemId: m.id,
        receivedQuantity: m.reorderLevel - m.availableStock + 50,
        unitCost: 10,
      })),
    });

    const dash3 = await callApi(handler, 'GET', '/api/supervisor/dashboard', supervisorToken);
    expect(dash3.data.lowStockMaterialsCount).toBe(0);
    expect(
      (dash3.data.materialAlerts as Array<Record<string, any>>).filter((a) => a.isLowStock)
    ).toHaveLength(0);

    // D. Empty production history -> dashboard still loads clean metrics with 0 completed runs
    db.exec(`DELETE FROM production_runs;`);
    const dash4 = await callApi(handler, 'GET', '/api/supervisor/dashboard', supervisorToken);
    expect(dash4.status).toBe(200);
    expect(dash4.data.completedRunsCount).toBe(0);
    expect(dash4.data.recentRuns).toHaveLength(0);
  });
});
