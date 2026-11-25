import { describe, expect, it } from 'vitest';
import {
  applyAdminOrderDecision,
  calculateOrderShortage,
  hasActiveProductionRequest,
  sanitizeNonNegativeStock,
} from './shortageCalculator';
import type { BomItem, Order, Product, ProductionRequest, RawMaterial } from '../types/orderAudit';

const murukkuProduct: Product = {
  id: 'prod-murukku-200',
  sku: 'NITT-MRK-200',
  name: 'Murukku 200 g',
  unit: 'packets',
  availableStock: 100,
  reorderLevel: 40,
};

const rawMaterialsSufficient: RawMaterial[] = [
  { id: 'rm-rice', code: 'RM-01', name: 'Rice Flour', unit: 'kg', availableStock: 25, reorderLevel: 10 },
  { id: 'rm-urad', code: 'RM-02', name: 'Urad Dal Flour', unit: 'kg', availableStock: 8, reorderLevel: 4 },
  { id: 'rm-oil', code: 'RM-03', name: 'Groundnut Oil', unit: 'L', availableStock: 12, reorderLevel: 5 },
];

const murukkuBom: BomItem[] = [
  { productId: 'prod-murukku-200', rawMaterialId: 'rm-rice', quantityPerUnit: 0.12 },
  { productId: 'prod-murukku-200', rawMaterialId: 'rm-urad', quantityPerUnit: 0.04 },
  { productId: 'prod-murukku-200', rawMaterialId: 'rm-oil', quantityPerUnit: 0.05 },
];

const sampleOrder: Order = {
  id: 'ord-142',
  orderNumber: 'ORD-2026-0142',
  customerName: 'NITT Hostels – Amber Mess',
  customerCode: 'CUST-004',
  productId: 'prod-murukku-200',
  requestedQuantity: 150,
  dispatchedQuantity: 0,
  orderDate: '2026-11-24',
  status: 'SUBMITTED',
  auditTrail: [],
};

describe('shortageCalculator', () => {
  it('computes shortage dynamically from finished-goods stock and confirms sufficient BOM materials', () => {
    const analysis = calculateOrderShortage(
      sampleOrder,
      murukkuProduct,
      murukkuBom,
      rawMaterialsSufficient
    );

    expect(analysis.requestedQuantity).toBe(150);
    expect(analysis.availableFinishedStock).toBe(100);
    expect(analysis.shortageQuantity).toBe(50);
    expect(analysis.productionRequired).toBe(true);
    expect(analysis.rawMaterialAvailability).toBe('SUFFICIENT');
    expect(analysis.materialsRequiringPurchase).toHaveLength(0);
    expect(analysis.bomBreakdown.find((b) => b.rawMaterialId === 'rm-rice')?.requiredQuantity).toBe(6);
    expect(analysis.bomBreakdown.find((b) => b.rawMaterialId === 'rm-urad')?.requiredQuantity).toBe(2);
    expect(analysis.bomBreakdown.find((b) => b.rawMaterialId === 'rm-oil')?.requiredQuantity).toBe(2.5);
  });

  it('identifies insufficient raw materials and calculates exact purchase quantities', () => {
    const lowRawMaterials: RawMaterial[] = [
      { id: 'rm-rice', code: 'RM-01', name: 'Rice Flour', unit: 'kg', availableStock: 4, reorderLevel: 10 },
      { id: 'rm-urad', code: 'RM-02', name: 'Urad Dal Flour', unit: 'kg', availableStock: 1.5, reorderLevel: 4 },
      { id: 'rm-oil', code: 'RM-03', name: 'Groundnut Oil', unit: 'L', availableStock: 12, reorderLevel: 5 },
    ];

    const analysis = calculateOrderShortage(
      sampleOrder,
      murukkuProduct,
      murukkuBom,
      lowRawMaterials
    );

    expect(analysis.rawMaterialAvailability).toBe('INSUFFICIENT');
    expect(analysis.materialsRequiringPurchase).toHaveLength(2);
    expect(analysis.materialsRequiringPurchase[0]).toMatchObject({
      materialName: 'Rice Flour',
      requiredQuantity: 6,
      availableStock: 4,
      shortfallQuantity: 2,
    });
    expect(analysis.materialsRequiringPurchase[1]).toMatchObject({
      materialName: 'Urad Dal Flour',
      requiredQuantity: 2,
      availableStock: 1.5,
      shortfallQuantity: 0.5,
    });
  });

  it('prevents negative stock values from propagating into shortage calculations', () => {
    expect(sanitizeNonNegativeStock(-15)).toBe(0);
    const analysis = calculateOrderShortage(
      sampleOrder,
      { ...murukkuProduct, availableStock: -10 },
      murukkuBom,
      rawMaterialsSufficient
    );
    expect(analysis.availableFinishedStock).toBe(0);
    expect(analysis.shortageQuantity).toBe(150);
  });

  it('creates a supervisor production request on SEND_FOR_PRODUCTION and blocks duplicates', () => {
    const analysis = calculateOrderShortage(
      sampleOrder,
      murukkuProduct,
      murukkuBom,
      rawMaterialsSufficient
    );

    const outcome = applyAdminOrderDecision(
      sampleOrder,
      analysis,
      { orderId: sampleOrder.id, decision: 'SEND_FOR_PRODUCTION', actor: 'Admin' },
      []
    );

    expect(outcome.updatedOrder.status).toBe('PRODUCTION_REQUIRED');
    expect(outcome.createdProductionRequest).toBeDefined();
    expect(outcome.createdProductionRequest?.status).toBe('PENDING_SUPERVISOR_REVIEW');
    expect(outcome.createdProductionRequest?.requestedQuantity).toBe(50);

    const existing: ProductionRequest[] = [outcome.createdProductionRequest!];
    expect(hasActiveProductionRequest(sampleOrder.id, existing)).toBe(true);
    expect(() =>
      applyAdminOrderDecision(
        outcome.updatedOrder,
        analysis,
        { orderId: sampleOrder.id, decision: 'SEND_FOR_PRODUCTION' },
        existing
      )
    ).toThrow(/Duplicate requests are blocked/);
  });

  it('blocks order approval when shortage exists, and allows approval without stock deduction when stock is sufficient', () => {
    const shortageAnalysis = calculateOrderShortage(
      sampleOrder,
      murukkuProduct,
      murukkuBom,
      rawMaterialsSufficient
    );

    expect(() =>
      applyAdminOrderDecision(
        sampleOrder,
        shortageAnalysis,
        { orderId: sampleOrder.id, decision: 'APPROVE_ORDER' },
        []
      )
    ).toThrow(/Cannot approve order with a shortage/);

    const stockedProduct: Product = { ...murukkuProduct, availableStock: 200 };
    const sufficientAnalysis = calculateOrderShortage(
      sampleOrder,
      stockedProduct,
      murukkuBom,
      rawMaterialsSufficient
    );
    expect(sufficientAnalysis.shortageQuantity).toBe(0);

    const approved = applyAdminOrderDecision(
      sampleOrder,
      sufficientAnalysis,
      { orderId: sampleOrder.id, decision: 'APPROVE_ORDER' },
      []
    );
    expect(approved.updatedOrder.status).toBe('APPROVED');
    expect(approved.createdProductionRequest).toBeUndefined();
    expect(stockedProduct.availableStock).toBe(200);
  });

  it('supports WAIT_KEEP_PENDING and REJECT_ORDER decisions cleanly', () => {
    const analysis = calculateOrderShortage(
      sampleOrder,
      murukkuProduct,
      murukkuBom,
      rawMaterialsSufficient
    );

    const waitOutcome = applyAdminOrderDecision(
      sampleOrder,
      analysis,
      { orderId: sampleOrder.id, decision: 'WAIT_KEEP_PENDING', note: 'Hold until next batch' },
      []
    );
    expect(waitOutcome.updatedOrder.status).toBe('AWAITING_STOCK');

    const rejectOutcome = applyAdminOrderDecision(
      waitOutcome.updatedOrder,
      analysis,
      { orderId: sampleOrder.id, decision: 'REJECT_ORDER', note: 'Duplicate campus indent' },
      []
    );
    expect(rejectOutcome.updatedOrder.status).toBe('REJECTED');
  });
});
