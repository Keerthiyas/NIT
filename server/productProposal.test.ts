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

describe('Verified Product Proposal, Approval & Governed Catalogue Registration (Gulab Jamun + Security)', () => {
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

  it('Complete End-to-End Gulab Jamun Launch (Proposal -> Supervisor Technical/BOM -> Accountant HSN/GST/Cost -> Owner Approve -> Admin Register Missing Materials & Product -> Activate -> Salesman Order -> Admin BOM Check)', async () => {
    // 1. Production Supervisor submits a Gulab Jamun product proposal
    const propRes = await callApi(handler, 'POST', '/api/product-proposals', supervisorToken, {
      productName: 'Gulab Jamun 250 g',
      packSize: '250 g',
      unit: 'packets',
      productCategory: 'Traditional Sweets',
      description: 'Soft khoya gulab jamun in cardamom sugar syrup.',
    });
    expect(propRes.status).toBe(201);
    const proposalId = String(propRes.data.id);
    expect(propRes.data.proposalNumber).toMatch(/^NP-2026-/);
    expect(propRes.data.status).toBe('PENDING_PRODUCTION_VERIFICATION');

    // Product must NOT be visible in Salesman catalogue yet!
    const salesBefore = (
      await callApi(handler, 'GET', '/api/salesman/products', salesmanToken)
    ).data as unknown as Array<Record<string, any>>;
    expect(salesBefore.some((p) => p.name === 'Gulab Jamun 250 g')).toBe(false);

    // Owner cannot approve incomplete proposal
    const earlyOwnerApprove = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/owner-decision`,
      ownerToken,
      { decision: 'APPROVE', sellingPrice: 95, reorderLevel: 30 }
    );
    expect(earlyOwnerApprove.status).toBe(400);

    // 2-3. Production Supervisor enters recipe, existing & missing materials, and verifies technical details
    const prodVerifyRes = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/production-verify`,
      supervisorToken,
      {
        productionFeasibility: 'FEASIBLE',
        expectedYieldPercent: 96,
        productionInstructions: 'Fry balls at 150C until golden; soak 2h in 55 Brix syrup.',
        productionRemarks: 'Needs Khoya Milk Solids & Tin Cup Pack registered as new materials.',
        bomItems: [
          { itemType: 'EXISTING_MATERIAL', materialId: 'rm-groundnut-oil', quantityPerUnit: 0.04 },
          {
            itemType: 'NEW_MATERIAL',
            materialName: 'Khoya Milk Solids',
            materialCategory: 'RAW_MATERIAL',
            unit: 'kg',
            suggestedReorderLevel: 15,
            quantityPerUnit: 0.12,
          },
          {
            itemType: 'NEW_MATERIAL',
            materialName: 'Tin Cup Pack 250 g',
            materialCategory: 'PACKAGING_MATERIAL',
            unit: 'pcs',
            suggestedReorderLevel: 100,
            quantityPerUnit: 1,
          },
        ],
        verify: true,
      }
    );
    expect(prodVerifyRes.status).toBe(200);
    expect(prodVerifyRes.data.productionVerificationStatus).toBe('VERIFIED');
    expect(prodVerifyRes.data.status).toBe('PENDING_ACCOUNTANT_VERIFICATION');

    // Locked after production verification: Supervisor cannot modify BOM again without return!
    const lockedProdEdit = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/production-verify`,
      supervisorToken,
      {
        productionFeasibility: 'FEASIBLE',
        bomItems: [{ itemType: 'EXISTING_MATERIAL', materialId: 'rm-besan', quantityPerUnit: 0.1 }],
        verify: true,
      }
    );
    expect(lockedProdEdit.status).toBe(403);

    // 4. Accountant verifies costing, HSN and GST details
    const accVerifyRes = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/accountant-verify`,
      accountantToken,
      {
        decision: 'VERIFY',
        hsnCode: '21069099',
        gstRate: 5,
        taxClassification: 'GST 5% Indian Traditional Sweets',
        estimatedCost: 52.5,
        costingNotes: 'Khoya ₹38 + Syrup/Oil ₹9 + Tin ₹5.50',
        remarks: 'Verified under HSN 21069099 @ 5% GST.',
      }
    );
    expect(accVerifyRes.status).toBe(200);
    expect(accVerifyRes.data.accountantVerificationStatus).toBe('VERIFIED');
    expect(accVerifyRes.data.status).toBe('PENDING_OWNER_APPROVAL');

    // 5-6. Owner reviews complete proposal and approves launch with official selling price & reorder level
    const ownerApproveRes = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/owner-decision`,
      ownerToken,
      {
        decision: 'APPROVE',
        sellingPrice: 95,
        reorderLevel: 30,
        remarks: 'Approved for festive launch.',
      }
    );
    expect(ownerApproveRes.status).toBe(200);
    expect(ownerApproveRes.data.status).toBe('APPROVED_PENDING_REGISTRATION');
    expect(ownerApproveRes.data.approvedSellingPrice).toBe(95);
    expect(ownerApproveRes.data.approvedReorderLevel).toBe(30);

    // 7-8. Admin registers missing materials from verified proposal details (must be 0 initial stock!)
    const newMatLines = (ownerApproveRes.data.bomItems as Array<Record<string, any>>).filter(
      (b) => b.itemType === 'NEW_MATERIAL'
    );
    expect(newMatLines.length).toBe(2);

    // Attempting to register product BEFORE missing materials are registered fails (400)
    const regBeforeMats = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/register-product`,
      adminToken,
      { sku: 'NITT-GLB-250', activateImmediately: false }
    );
    expect(regBeforeMats.status).toBe(400);

    const regMat1 = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/register-material`,
      adminToken,
      { bomLineId: newMatLines[0].id, sku: 'RM-KHOYA-1' }
    );
    expect(regMat1.status).toBe(200);

    const regMat2 = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/register-material`,
      adminToken,
      { bomLineId: newMatLines[1].id, sku: 'PKG-TIN-250' }
    );
    expect(regMat2.status).toBe(200);

    // Verify new materials start with strictly 0 stock
    const matsAfter = (
      await callApi(handler, 'GET', '/api/management/materials', adminToken)
    ).data as unknown as Array<Record<string, any>>;
    const khoya = matsAfter.find((m) => m.sku === 'RM-KHOYA-1')!;
    const tin = matsAfter.find((m) => m.sku === 'PKG-TIN-250')!;
    expect(khoya.availableStock).toBe(0);
    expect(tin.availableStock).toBe(0);

    // 9. Admin registers finished product (initially inactive -> NOT yet in Salesman catalogue, 0 FG stock!)
    const regProdRes = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${proposalId}/register-product`,
      adminToken,
      { sku: 'NITT-GLB-250', activateImmediately: false }
    );
    expect(regProdRes.status).toBe(201);
    expect(regProdRes.data.status).toBe('CATALOGUE_REGISTERED');
    const productId = String(regProdRes.data.registeredProductId);

    // Not yet active -> Salesman still cannot see it
    const salesWhileInactive = (
      await callApi(handler, 'GET', '/api/salesman/products', salesmanToken)
    ).data as unknown as Array<Record<string, any>>;
    expect(salesWhileInactive.some((p) => p.id === productId)).toBe(false);

    // Product starts with strictly 0 FG stock
    const invBeforeOrder = (
      await callApi(handler, 'GET', '/api/inventory/items', adminToken)
    ).data as unknown as Array<Record<string, any>>;
    expect(invBeforeOrder.find((i) => i.id === productId)!.availableStock).toBe(0);

    // 10. Admin activates product -> moves proposal to ACTIVE & product enters Salesman catalogue
    const actRes = await callApi(
      handler,
      'PATCH',
      `/api/management/products/${productId}/status`,
      adminToken,
      { isActive: true }
    );
    expect(actRes.status).toBe(200);

    const salesActive = (
      await callApi(handler, 'GET', '/api/salesman/products', salesmanToken)
    ).data as unknown as Array<Record<string, any>>;
    const gulabForSales = salesActive.find((p) => p.id === productId);
    expect(gulabForSales).toBeTruthy();
    expect(gulabForSales!.sellingPrice).toBe(95);

    // 11-13. Salesman creates customer order -> Admin checks predefined BOM & shortages -> stock untouched!
    const customers = (
      await callApi(handler, 'GET', '/api/salesman/customers', salesmanToken)
    ).data as unknown as Array<Record<string, any>>;
    const ordRes = await callApi(handler, 'POST', '/api/salesman/orders', salesmanToken, {
      customerId: customers[0].id,
      items: [{ productId, quantity: 40 }],
    });
    expect(ordRes.status).toBe(201);

    const availRes = await callApi(
      handler,
      'GET',
      `/api/orders/${ordRes.data.id}/availability`,
      adminToken
    );
    expect(availRes.status).toBe(200);
    expect(availRes.data.availableFinishedStock).toBe(0);
    expect(availRes.data.shortageQuantity).toBe(40);
    expect(availRes.data.overallReviewStatus).toBe('MATERIAL_SHORTAGE');
    const khoyaReq = (availRes.data.bomBreakdown as Array<Record<string, any>>).find(
      (b) => b.rawMaterialId === khoya.id
    )!;
    expect(khoyaReq.requiredQuantity).toBeCloseTo(4.8, 3); // 40 * 0.12 kg
    expect(khoyaReq.availableStock).toBe(0);
    expect(khoyaReq.shortfallQuantity).toBeCloseTo(4.8, 3);
  });

  it('Rejections, Return for Correction, Accountant Return Tax, Production Revision & Unauthorized Action Enforcement', async () => {
    // A. Owner initiates proposal -> Supervisor verifies -> Accountant returns incorrect tax/cost -> Supervisor amends -> Accountant verifies -> Owner returns to Production -> Supervisor amends -> Re-verified -> Owner rejects
    const p1 = await callApi(handler, 'POST', '/api/product-proposals', ownerToken, {
      productName: 'Karasev 200 g',
      packSize: '200 g',
      unit: 'packets',
      proposedSellingPrice: 55,
      proposedReorderLevel: 30,
    });
    expect(p1.status).toBe(201);

    // Production verifies
    await callApi(handler, 'POST', `/api/product-proposals/${p1.data.id}/production-verify`, supervisorToken, {
      productionFeasibility: 'FEASIBLE',
      expectedYieldPercent: 95,
      bomItems: [{ itemType: 'EXISTING_MATERIAL', materialId: 'rm-besan', quantityPerUnit: 0.14 }],
      verify: true,
    });

    // Accountant returns for correction (incorrect pack weight / besan recipe clarification)
    const accReturn = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${p1.data.id}/accountant-verify`,
      accountantToken,
      {
        decision: 'RETURN',
        remarks: 'Clarify net gram weight before HSN 1905 vs 2106 slab verification.',
      }
    );
    expect(accReturn.status).toBe(200);
    expect(accReturn.data.status).toBe('RETURNED_FOR_CORRECTION');

    // Supervisor re-verifies -> Accountant verifies
    await callApi(handler, 'POST', `/api/product-proposals/${p1.data.id}/production-verify`, supervisorToken, {
      productionFeasibility: 'FEASIBLE',
      expectedYieldPercent: 94,
      bomItems: [{ itemType: 'EXISTING_MATERIAL', materialId: 'rm-besan', quantityPerUnit: 0.15 }],
      verify: true,
    });
    await callApi(handler, 'POST', `/api/product-proposals/${p1.data.id}/accountant-verify`, accountantToken, {
      decision: 'VERIFY',
      hsnCode: '21069099',
      gstRate: 5,
      taxClassification: 'GST 5% Namkeen',
      estimatedCost: 30,
    });

    // Owner returns to Production for recipe revision
    const ownerReturn = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${p1.data.id}/owner-decision`,
      ownerToken,
      { decision: 'RETURN', targetStage: 'PRODUCTION', remarks: 'Add packaging pouch to BOM.' }
    );
    expect(ownerReturn.status).toBe(200);
    expect(ownerReturn.data.status).toBe('RETURNED_FOR_CORRECTION');
    expect(ownerReturn.data.returnedToStage).toBe('PRODUCTION');

    // Supervisor revises recipe adding pouch -> Accountant re-verifies -> Owner rejects
    await callApi(handler, 'POST', `/api/product-proposals/${p1.data.id}/production-verify`, supervisorToken, {
      productionFeasibility: 'FEASIBLE',
      bomItems: [
        { itemType: 'EXISTING_MATERIAL', materialId: 'rm-besan', quantityPerUnit: 0.15 },
        { itemType: 'EXISTING_MATERIAL', materialId: 'pkg-pouch-200', quantityPerUnit: 1 },
      ],
      verify: true,
    });
    await callApi(handler, 'POST', `/api/product-proposals/${p1.data.id}/accountant-verify`, accountantToken, {
      decision: 'VERIFY',
      hsnCode: '21069099',
      gstRate: 5,
      taxClassification: 'GST 5% Namkeen',
      estimatedCost: 33,
    });
    const ownerReject = await callApi(
      handler,
      'POST',
      `/api/product-proposals/${p1.data.id}/owner-decision`,
      ownerToken,
      { decision: 'REJECT', remarks: 'Deferred to next quarter launch.' }
    );
    expect(ownerReject.status).toBe(200);
    expect(ownerReject.data.status).toBe('REJECTED');

    // B. Admin tries to register an UNAPPROVED product (both direct POST and unapproved proposal) -> 403!
    expect(
      (
        await callApi(handler, 'POST', '/api/management/products', adminToken, {
          sku: 'NITT-ROGUE-1',
          name: 'Rogue Snack',
          packSize: '100 g',
          sellingPrice: 50,
          gstRate: 5,
          hsnCode: '21069099',
          unit: 'packets',
          reorderLevel: 10,
          bomItems: [{ materialId: 'rm-besan', quantityPerUnit: 0.1 }],
        })
      ).status
    ).toBe(403);

    expect(
      (
        await callApi(
          handler,
          'POST',
          `/api/product-proposals/${p1.data.id}/register-product`,
          adminToken,
          { sku: 'NITT-REJECTED-1' }
        )
      ).status
    ).toBe(403);

    // Admin tries to add an unverified raw material independently -> 403!
    expect(
      (
        await callApi(handler, 'POST', '/api/management/materials', adminToken, {
          sku: 'RM-UNVERIFIED',
          name: 'Unverified Spice',
          category: 'RAW_MATERIAL',
          unit: 'kg',
          reorderLevel: 10,
        })
      ).status
    ).toBe(403);

    // Admin tries to modify approved price/GST/BOM on an existing registered product -> 403!
    const seededProds = (
      await callApi(handler, 'GET', '/api/management/products', adminToken)
    ).data as unknown as Array<Record<string, any>>;
    const mrk = seededProds.find((p) => p.id === 'prod-mrk-200')!;

    expect(
      (
        await callApi(handler, 'PUT', `/api/management/products/${mrk.id}`, adminToken, {
          sku: mrk.sku,
          name: mrk.name,
          packSize: mrk.packSize,
          sellingPrice: 999, // Admin attempts unauthorized price override!
          gstRate: mrk.gstRate,
          hsnCode: mrk.hsnCode,
          unit: mrk.unit,
          reorderLevel: mrk.reorderLevel,
          bomItems: mrk.bomItems.map((b: Record<string, any>) => ({
            materialId: b.materialId,
            quantityPerUnit: b.quantityPerUnit,
          })),
        })
      ).status
    ).toBe(403);

    expect(
      (
        await callApi(handler, 'PUT', `/api/management/products/${mrk.id}`, adminToken, {
          sku: mrk.sku,
          name: mrk.name,
          packSize: mrk.packSize,
          sellingPrice: mrk.sellingPrice,
          gstRate: mrk.gstRate,
          hsnCode: mrk.hsnCode,
          unit: mrk.unit,
          reorderLevel: mrk.reorderLevel,
          bomItems: [{ materialId: 'rm-besan', quantityPerUnit: 0.9 }], // Admin attempts BOM tamper!
        })
      ).status
    ).toBe(403);

    // Unauthorized role actions rejected (403):
    // Admin cannot initiate proposal or approve launch; Salesman has 403 everywhere; Supervisor cannot verify tax or approve launch; Accountant cannot verify production or approve launch
    expect(
      (
        await callApi(handler, 'POST', '/api/product-proposals', adminToken, {
          productName: 'Blocked',
          packSize: '100 g',
        })
      ).status
    ).toBe(403);
    expect(
      (await callApi(handler, 'GET', '/api/product-proposals', salesmanToken)).status
    ).toBe(403);
    expect(
      (
        await callApi(
          handler,
          'POST',
          `/api/product-proposals/${p1.data.id}/accountant-verify`,
          supervisorToken,
          { decision: 'VERIFY', hsnCode: '21069099', gstRate: 5, taxClassification: 'Food', estimatedCost: 10 }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await callApi(
          handler,
          'POST',
          `/api/product-proposals/${p1.data.id}/owner-decision`,
          accountantToken,
          { decision: 'APPROVE', sellingPrice: 50, reorderLevel: 10 }
        )
      ).status
    ).toBe(403);
  });
});
