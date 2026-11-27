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

describe('Product Catalogue, Predefined Versioned BOM & Automatic Order Requirement Checking', () => {
  let db: ReturnType<typeof openDatabase>;
  let handler: ReturnType<typeof createApiHandler>;
  let ownerToken: string;
  let adminToken: string;
  let supervisorToken: string;
  let accountantToken: string;
  let salesmanToken: string;

  const createVerifiedMaterial = async (input: {
    sku: string;
    name: string;
    category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
    unit: string;
    reorderLevel: number;
  }): Promise<string> => {
    const prop = await callApi(handler, 'POST', '/api/material-proposals', supervisorToken, {
      name: input.name,
      suggestedSku: input.sku,
      category: input.category,
      unit: input.unit,
      suggestedReorderLevel: input.reorderLevel,
      reason: 'Approved material for catalogue',
    });
    expect(prop.status).toBe(201);
    const rev = await callApi(
      handler,
      'POST',
      `/api/material-proposals/${String(prop.data.id)}/review`,
      adminToken,
      { decision: 'APPROVE', sku: input.sku, reorderLevel: input.reorderLevel }
    );
    expect(rev.status).toBe(200);
    return String(rev.data.createdMaterialId);
  };

  const registerApprovedProduct = async (input: {
    sku: string;
    name: string;
    packSize: string;
    sellingPrice: number;
    gstRate: number;
    hsnCode: string;
    unit: string;
    reorderLevel: number;
    bomItems: Array<{ materialId: string; quantityPerUnit: number }>;
  }): Promise<string> => {
    const prop = await callApi(handler, 'POST', '/api/product-proposals', ownerToken, {
      productName: input.name,
      packSize: input.packSize,
      unit: input.unit,
      proposedSellingPrice: input.sellingPrice,
      proposedReorderLevel: input.reorderLevel,
    });
    expect(prop.status).toBe(201);
    const pv = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${String(prop.data.id)}/production-verify`,
      supervisorToken,
      {
        productionFeasibility: 'FEASIBLE',
        expectedYieldPercent: 95,
        bomItems: input.bomItems.map((b) => ({
          itemType: 'EXISTING_MATERIAL' as const,
          materialId: b.materialId,
          quantityPerUnit: b.quantityPerUnit,
        })),
        verify: true,
      }
    );
    expect(pv.status).toBe(200);
    const av = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${String(prop.data.id)}/accountant-verify`,
      accountantToken,
      {
        decision: 'VERIFY',
        hsnCode: input.hsnCode,
        gstRate: input.gstRate,
        taxClassification: `GST ${input.gstRate}% Food`,
        estimatedCost: Number((input.sellingPrice * 0.6).toFixed(2)),
      }
    );
    expect(av.status).toBe(200);
    const oa = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${String(prop.data.id)}/owner-decision`,
      ownerToken,
      {
        decision: 'APPROVE',
        sellingPrice: input.sellingPrice,
        reorderLevel: input.reorderLevel,
      }
    );
    expect(oa.status).toBe(200);
    const reg = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${String(prop.data.id)}/register-product`,
      adminToken,
      { sku: input.sku, activateImmediately: true }
    );
    expect(reg.status).toBe(201);
    return String(reg.data.registeredProductId);
  };

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

  it('1-6: Material Catalogue CRUD (0 initial stock, duplicate SKU & delete protection), Versioned BOM & duplicate rejection', async () => {
    const movementsBefore = (
      await callApi(handler, 'GET', '/api/inventory/movements', adminToken)
    ).data as unknown as Array<Record<string, any>>;

    // 1. Create raw material via Supervisor proposal -> Admin register (verified stock = 0)
    const rmId = await createVerifiedMaterial({
      sku: 'RM-901',
      name: 'Jaggery Powder',
      category: 'RAW_MATERIAL',
      unit: 'kg',
      reorderLevel: 15,
    });

    // 2. Create packaging material (verified stock = 0)
    const pkgId = await createVerifiedMaterial({
      sku: 'PKG-901',
      name: 'Thattai Tray 250g',
      category: 'PACKAGING_MATERIAL',
      unit: 'pcs',
      reorderLevel: 50,
    });

    // 3. Duplicate SKU blocked (case-insensitive)
    const propDup = await callApi(handler, 'POST', '/api/material-proposals', supervisorToken, {
      name: 'Duplicate Jaggery',
      suggestedSku: 'rm-901',
      category: 'RAW_MATERIAL',
      unit: 'kg',
      suggestedReorderLevel: 10,
      reason: 'Test duplicate',
    });
    const dupSkuRes = await callApi(
      handler,
      'POST',
      `/api/material-proposals/${String(propDup.data.id)}/review`,
      adminToken,
      { decision: 'APPROVE', sku: 'rm-901' }
    );
    expect(dupSkuRes.status).toBe(409);

    // Verify materials list & zero stock / zero stock movements created
    const matsRes = await callApi(handler, 'GET', '/api/management/materials', adminToken);
    expect(matsRes.status).toBe(200);
    const mats = matsRes.data as unknown as Array<Record<string, any>>;
    const jaggery = mats.find((m) => m.id === rmId)!;
    const tray = mats.find((m) => m.id === pkgId)!;
    expect(jaggery.availableStock).toBe(0);
    expect(tray.availableStock).toBe(0);

    // Create & deactivate an unused material -> cannot be linked to BOM, CAN be deleted cleanly
    const inactiveMatId = await createVerifiedMaterial({
      sku: 'RM-902',
      name: 'Unused Spice',
      category: 'RAW_MATERIAL',
      unit: 'kg',
      reorderLevel: 5,
    });
    await callApi(handler, 'PATCH', `/api/management/materials/${inactiveMatId}/status`, adminToken, {
      isActive: false,
    });

    // 4. Reject duplicate material and inactive material during Production Supervisor BOM entry
    const propBad = await callApi(handler, 'POST', '/api/product-proposals', ownerToken, {
      productName: 'Sweet Adhirasam 250 g',
      packSize: '250 g',
      unit: 'packets',
      proposedSellingPrice: 80,
      proposedReorderLevel: 25,
    });
    const dupBomAttempt = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${String(propBad.data.id)}/production-verify`,
      supervisorToken,
      {
        productionFeasibility: 'FEASIBLE',
        bomItems: [
          { itemType: 'EXISTING_MATERIAL', materialId: rmId, quantityPerUnit: 0.1 },
          { itemType: 'EXISTING_MATERIAL', materialId: rmId, quantityPerUnit: 0.2 },
        ],
        verify: true,
      }
    );
    expect(dupBomAttempt.status).toBe(400);

    const inactiveBomAttempt = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${String(propBad.data.id)}/production-verify`,
      supervisorToken,
      {
        productionFeasibility: 'FEASIBLE',
        bomItems: [{ itemType: 'EXISTING_MATERIAL', materialId: inactiveMatId, quantityPerUnit: 0.1 }],
        verify: true,
      }
    );
    expect(inactiveBomAttempt.status).toBe(400);

    // Unused inactive material CAN be deleted cleanly
    const deleteUnused = await callApi(
      handler,
      'DELETE',
      `/api/management/materials/${inactiveMatId}`,
      adminToken
    );
    expect(deleteUnused.status).toBe(200);

    // 5. Register approved finished product linking Rice Flour, Jaggery, and Tray
    const prodId = await registerApprovedProduct({
      sku: 'NITT-ADH-250',
      name: 'Adhirasam 250 g',
      packSize: '250 g',
      sellingPrice: 80,
      gstRate: 5,
      hsnCode: '21069099',
      unit: 'packets',
      reorderLevel: 30,
      bomItems: [
        { materialId: 'rm-rice-flour', quantityPerUnit: 0.1 },
        { materialId: rmId, quantityPerUnit: 0.15 },
        { materialId: pkgId, quantityPerUnit: 1 },
      ],
    });

    // Referenced material CANNOT be deleted (409)
    const deleteUsed = await callApi(
      handler,
      'DELETE',
      `/api/management/materials/${rmId}`,
      adminToken
    );
    expect(deleteUsed.status).toBe(409);

    // Retrieve Product Catalogue + BOM from SQLite and check 0 stock
    const catalogueRes = await callApi(handler, 'GET', '/api/management/products', adminToken);
    const createdProd = (catalogueRes.data as unknown as Array<Record<string, any>>).find(
      (p) => p.id === prodId
    )!;
    expect(createdProd.availableStock).toBe(0);
    expect(createdProd.bomApprovalStatus).toBe('APPROVED');
    const riceLine = createdProd.bomItems.find((b: Record<string, any>) => b.materialId === 'rm-rice-flour');
    expect(riceLine.quantityPerUnit).toBe(0.1);
    expect(riceLine.unit).toBe('kg');

    // No stock movements occurred during material/product creation
    const movementsAfter = (
      await callApi(handler, 'GET', '/api/inventory/movements', adminToken)
    ).data as unknown as Array<Record<string, any>>;
    expect(movementsAfter.length).toBe(movementsBefore.length);
  });

  it('7-14: End-to-End Order -> Automatic FG & Multi-Product BOM Check -> PR -> Supervisor -> Governed BOM Versioning Safety', async () => {
    const rmSugarId = await createVerifiedMaterial({
      sku: 'RM-950',
      name: 'Organic Sugar',
      category: 'RAW_MATERIAL',
      unit: 'kg',
      reorderLevel: 20,
    });

    // Give Organic Sugar 5 kg via verified GRN receipt
    const suppliersRes = await callApi(handler, 'GET', '/api/management/suppliers', adminToken);
    const supId = (suppliersRes.data as unknown as Array<Record<string, any>>)[0].id;
    const grnRes = await callApi(handler, 'POST', '/api/purchase-receipts', adminToken, {
      supplierId: supId,
      items: [{ itemId: rmSugarId, receivedQuantity: 5, unitCost: 50 }],
      notes: 'Opening sugar receipt',
    });
    expect(grnRes.status).toBe(201);

    const prodAId = await registerApprovedProduct({
      sku: 'NITT-LAD-200',
      name: 'Besan Laddu 200 g',
      packSize: '200 g',
      sellingPrice: 70,
      gstRate: 5,
      hsnCode: '21069099',
      unit: 'packets',
      reorderLevel: 25,
      bomItems: [
        { materialId: rmSugarId, quantityPerUnit: 0.2 },
        { materialId: 'rm-besan', quantityPerUnit: 0.1 },
      ],
    });

    const prodBId = await registerApprovedProduct({
      sku: 'NITT-MYS-200',
      name: 'Mysore Pak 200 g',
      packSize: '200 g',
      sellingPrice: 90,
      gstRate: 5,
      hsnCode: '21069099',
      unit: 'packets',
      reorderLevel: 20,
      bomItems: [
        { materialId: rmSugarId, quantityPerUnit: 0.1 },
        { materialId: 'rm-besan', quantityPerUnit: 0.15 },
      ],
    });

    // Salesman submits multi-product order: 20 Laddu + 30 Mysore Pak
    // Organic Sugar needed = 20*0.2 (4 kg) + 30*0.1 (3 kg) = 7 kg total; stock = 5 kg -> shortage = 2 kg!
    const customersRes = await callApi(handler, 'GET', '/api/salesman/customers', salesmanToken);
    const custId = (customersRes.data as unknown as Array<Record<string, any>>)[0].id;
    const invBeforeOrder = (
      await callApi(handler, 'GET', '/api/inventory/items', adminToken)
    ).data as unknown as Array<Record<string, any>>;

    const orderRes = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: custId,
      items: [
        { productId: prodAId, quantity: 20 },
        { productId: prodBId, quantity: 30 },
      ],
      customerNote: 'Multi-sweet bulk order',
    });
    expect(orderRes.status).toBe(201);

    // Admin opens order -> automatic BOM & FG evaluation
    const availRes = await callApi(
      handler,
      'GET',
      `/api/orders/${orderRes.data.id}/availability`,
      adminToken
    );
    expect(availRes.status).toBe(200);
    expect(availRes.data.productionRequired).toBe(true);
    expect(availRes.data.shortageQuantity).toBe(50);
    expect(availRes.data.overallReviewStatus).toBe('MATERIAL_SHORTAGE');

    const sugarAgg = (availRes.data.bomBreakdown as Array<Record<string, any>>).find(
      (b) => b.rawMaterialId === rmSugarId
    )!;
    expect(sugarAgg.requiredQuantity).toBe(7);
    expect(sugarAgg.availableStock).toBe(5);
    expect(sugarAgg.shortfallQuantity).toBe(2);
    expect(sugarAgg.isSufficient).toBe(false);

    // Admin sends for production -> creates Production Requests & preserves historical BOM
    const prDecision = await callApi(
      handler,
      'POST',
      `/api/orders/${orderRes.data.id}/decision`,
      adminToken,
      { decision: 'SEND_FOR_PRODUCTION', note: 'Produce both batches' }
    );
    expect(prDecision.status).toBe(200);

    const prsRes = await callApi(handler, 'GET', '/api/production-requests', supervisorToken);
    const ladduPr = (prsRes.data as unknown as Array<Record<string, any>>).find(
      (p) => p.orderId === orderRes.data.id && p.productId === prodAId
    )!;
    expect(ladduPr).toBeTruthy();
    expect(ladduPr.requestedQuantity).toBe(20);
    expect(ladduPr.bomVersion).toBe('v1.0');

    // Verify NO inventory balances changed
    const invAfterPr = (
      await callApi(handler, 'GET', '/api/inventory/items', adminToken)
    ).data as unknown as Array<Record<string, any>>;
    expect(invAfterPr.find((i) => i.id === rmSugarId)!.availableStock).toBe(
      invBeforeOrder.find((i) => i.id === rmSugarId)!.availableStock
    );

    // Supervisor requests BOM Revision -> Owner approves -> Admin registers v1.1 while preserving v1.0 on ladduPr!
    const revReq = await callApi(handler, 'POST', '/api/bom-revisions', supervisorToken, {
      productId: prodAId,
      materialId: rmSugarId,
      suggestedQuantityPerUnit: 0.25,
      reason: 'Sweetness balance adjustment',
    });
    expect(revReq.status).toBe(201);
    await callApi(
      handler,
      'POST',
      `/api/bom-revisions/${String(revReq.data.id)}/owner-approve`,
      ownerToken,
      { approve: true }
    );
    const revApprove = await callApi(
      handler,
      'POST',
      `/api/bom-revisions/${String(revReq.data.id)}/review`,
      adminToken,
      { decision: 'APPROVE' }
    );
    expect(revApprove.status).toBe(200);
    expect(revApprove.data.bomVersion).toBe('v1.1');

    const bomHistoryRes = await callApi(
      handler,
      'GET',
      `/api/management/products/${prodAId}/boms`,
      adminToken
    );
    expect(bomHistoryRes.status).toBe(200);
    expect(bomHistoryRes.data.length).toBe(2);
    expect(bomHistoryRes.data.some((b: Record<string, any>) => b.bomVersion === 'v1.0' && b.approvalStatus === 'ARCHIVED')).toBe(true);
    expect(bomHistoryRes.data.some((b: Record<string, any>) => b.bomVersion === 'v1.1' && b.approvalStatus === 'APPROVED')).toBe(true);

    // Existing production request keeps its historical v1.0 quantity (0.2)
    const prsAfterBomEdit = await callApi(handler, 'GET', '/api/production-requests', supervisorToken);
    const ladduPrAfter = (prsAfterBomEdit.data as unknown as Array<Record<string, any>>).find(
      (p) => p.id === ladduPr.id
    )!;
    expect(ladduPrAfter.bomVersion).toBe('v1.0');
    const sugarInHistPr = ladduPrAfter.bomMaterials.find((m: Record<string, any>) => m.materialId === rmSugarId);
    expect(sugarInHistPr.quantityPerUnit).toBe(0.2);
  });

  it('Missing / Unapproved BOM blocking & Supervisor Material Proposals + RBAC', async () => {
    const draftProdId = await registerApprovedProduct({
      sku: 'NITT-DRF-100',
      name: 'Draft Recipe Snack',
      packSize: '100 g',
      sellingPrice: 40,
      gstRate: 5,
      hsnCode: '21069099',
      unit: 'packets',
      reorderLevel: 10,
      bomItems: [{ materialId: 'rm-besan', quantityPerUnit: 0.08 }],
    });
    // Mark its BOM as DRAFT in DB to simulate an unapproved BOM check
    db.prepare(`UPDATE boms SET approval_status = 'DRAFT' WHERE product_id = ?`).run(draftProdId);

    const customersRes = await callApi(handler, 'GET', '/api/salesman/customers', salesmanToken);
    const custId = (customersRes.data as unknown as Array<Record<string, any>>)[0].id;
    const ordDraft = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: custId,
      items: [{ productId: draftProdId, quantity: 10 }],
    });
    expect(ordDraft.status).toBe(201);

    const availDraft = await callApi(
      handler,
      'GET',
      `/api/orders/${ordDraft.data.id}/availability`,
      adminToken
    );
    expect(availDraft.status).toBe(200);
    expect(availDraft.data.overallReviewStatus).toBe('MISSING_BOM');
    expect(availDraft.data.rawMaterialAvailability).toBe('MISSING_BOM');

    const blockedPr = await callApi(
      handler,
      'POST',
      `/api/orders/${ordDraft.data.id}/decision`,
      adminToken,
      { decision: 'SEND_FOR_PRODUCTION' }
    );
    expect(blockedPr.status).toBe(400);

    // 2. Production Supervisor cannot edit Material/Product Catalogue directly (403)
    expect(
      (
        await callApi(handler, 'POST', '/api/management/materials', supervisorToken, {
          sku: 'RM-HACK',
          name: 'Blocked',
          category: 'RAW_MATERIAL',
          unit: 'kg',
          reorderLevel: 1,
        })
      ).status
    ).toBe(403);

    // 3. Supervisor CAN propose a new material -> Admin approves -> registered at 0 stock
    const propRes = await callApi(handler, 'POST', '/api/material-proposals', supervisorToken, {
      name: 'Black Pepper Powder',
      suggestedSku: 'RM-990',
      category: 'RAW_MATERIAL',
      unit: 'kg',
      suggestedReorderLevel: 5,
      reason: 'Required for Pepper Sev batch',
    });
    expect(propRes.status).toBe(201);

    const approveProp = await callApi(
      handler,
      'POST',
      `/api/material-proposals/${propRes.data.id}/review`,
      adminToken,
      { decision: 'APPROVE', sku: 'RM-990', reorderLevel: 5 }
    );
    expect(approveProp.status).toBe(200);
    expect(approveProp.data.createdMaterialId).toBeTruthy();

    const matsAfter = (
      await callApi(handler, 'GET', '/api/management/materials', adminToken)
    ).data as unknown as Array<Record<string, any>>;
    const pepper = matsAfter.find((m) => m.id === approveProp.data.createdMaterialId)!;
    expect(pepper.name).toBe('Black Pepper Powder');
    expect(pepper.availableStock).toBe(0);
  });
});
