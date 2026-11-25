import type {
  BomItem,
  BomRequirementLine,
  Order,
  OrderDecisionPayload,
  OrderShortageAnalysis,
  OrderStatus,
  Product,
  ProductionRequest,
  RawMaterial,
  StockOrProductionAlert,
} from '../types/orderAudit';

/**
 * Ensures stock quantities can never go below zero.
 */
export function sanitizeNonNegativeStock(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

/**
 * Rounds BOM arithmetic to 4 decimal places to avoid IEEE-754 drift.
 */
export function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Checks finished-goods stock for an order, computes shortage dynamically,
 * and evaluates raw-material availability against the product's BOM.
 */
export function calculateOrderShortage(
  order: Order,
  product: Product,
  bomItems: BomItem[],
  rawMaterials: RawMaterial[],
  checkedAt: string = new Date().toISOString()
): OrderShortageAnalysis {
  const requestedQuantity = Math.max(0, order.requestedQuantity);
  const dispatchedQuantity = Math.max(0, order.dispatchedQuantity);
  const remainingToFulfill = Math.max(0, requestedQuantity - dispatchedQuantity);
  const availableFinishedStock = sanitizeNonNegativeStock(product.availableStock);
  const shortageQuantity = Math.max(0, remainingToFulfill - availableFinishedStock);
  const productionRequired = shortageQuantity > 0;

  if (!productionRequired) {
    return {
      orderId: order.id,
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      requestedQuantity,
      remainingToFulfill,
      availableFinishedStock,
      shortageQuantity: 0,
      productionRequired: false,
      rawMaterialAvailability: 'NOT_APPLICABLE',
      bomBreakdown: [],
      materialsRequiringPurchase: [],
      checkedAt,
    };
  }

  const materialMap = new Map(rawMaterials.map((m) => [m.id, m]));
  const productBom = bomItems.filter((item) => item.productId === product.id);

  const bomBreakdown: BomRequirementLine[] = productBom.map((item) => {
    const material = materialMap.get(item.rawMaterialId);
    const availableStock = sanitizeNonNegativeStock(material?.availableStock ?? 0);
    const requiredQuantity = roundQty(shortageQuantity * item.quantityPerUnit);
    const shortfallQuantity = roundQty(Math.max(0, requiredQuantity - availableStock));

    return {
      rawMaterialId: item.rawMaterialId,
      materialCode: material?.code ?? item.rawMaterialId,
      materialName: material?.name ?? `Unknown Material (${item.rawMaterialId})`,
      unit: material?.unit ?? 'units',
      quantityPerUnit: item.quantityPerUnit,
      requiredQuantity,
      availableStock,
      shortfallQuantity,
      isSufficient: shortfallQuantity === 0,
    };
  });

  const materialsRequiringPurchase = bomBreakdown.filter((line) => !line.isSufficient);
  const rawMaterialAvailability =
    materialsRequiringPurchase.length === 0 ? 'SUFFICIENT' : 'INSUFFICIENT';

  return {
    orderId: order.id,
    productId: product.id,
    productName: product.name,
    unit: product.unit,
    requestedQuantity,
    remainingToFulfill,
    availableFinishedStock,
    shortageQuantity,
    productionRequired: true,
    rawMaterialAvailability,
    bomBreakdown,
    materialsRequiringPurchase,
    checkedAt,
  };
}

/**
 * Prevents duplicate production requests for the same order.
 */
export function hasActiveProductionRequest(
  orderId: string,
  existingRequests: ProductionRequest[]
): boolean {
  return existingRequests.some(
    (req) => req.orderId === orderId && req.status !== 'CANCELLED'
  );
}

const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'REJECTED',
  'DISPATCHED',
]);

export interface DecisionOutcome {
  updatedOrder: Order;
  createdProductionRequest?: ProductionRequest;
}

/**
 * Applies an admin decision to an order without modifying any inventory balances.
 * Stock deductions occur exclusively on dispatch (finished goods) or posted
 * production runs (raw materials).
 */
export function applyAdminOrderDecision(
  order: Order,
  analysis: OrderShortageAnalysis,
  payload: OrderDecisionPayload,
  existingRequests: ProductionRequest[],
  nowIso: string = new Date().toISOString()
): DecisionOutcome {
  if (TERMINAL_ORDER_STATUSES.has(order.status)) {
    throw new Error(`Order ${order.orderNumber} is already ${order.status} and cannot be modified.`);
  }

  const actor = payload.actor?.trim() || 'Admin';
  let nextStatus: OrderStatus;
  let actionLabel: string;
  let createdProductionRequest: ProductionRequest | undefined;

  switch (payload.decision) {
    case 'SEND_FOR_PRODUCTION': {
      if (analysis.shortageQuantity <= 0) {
        throw new Error('Cannot send for production when there is no finished-goods shortage.');
      }
      if (hasActiveProductionRequest(order.id, existingRequests)) {
        throw new Error(
          `A production request already exists for order ${order.orderNumber}. Duplicate requests are blocked.`
        );
      }

      const nextSeq = existingRequests.length + 1;
      const requestNumber = `PR-2026-${String(nextSeq).padStart(4, '0')}`;

      createdProductionRequest = {
        id: `pr-${order.id}-${Date.now()}`,
        requestNumber,
        orderId: order.id,
        orderNumber: order.orderNumber,
        productId: analysis.productId,
        productName: analysis.productName,
        unit: analysis.unit,
        requestedQuantity: analysis.shortageQuantity,
        rawMaterialAvailability:
          analysis.rawMaterialAvailability === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'SUFFICIENT',
        materialsToPurchase: analysis.materialsRequiringPurchase.map((m) => ({
          rawMaterialId: m.rawMaterialId,
          materialName: m.materialName,
          unit: m.unit,
          shortfallQuantity: m.shortfallQuantity,
        })),
        status: 'PENDING_SUPERVISOR_REVIEW',
        createdAt: nowIso,
        createdBy: actor,
        notes: payload.note?.trim() || undefined,
      };

      nextStatus = 'PRODUCTION_REQUIRED';
      actionLabel = `Sent shortage (${analysis.shortageQuantity} ${analysis.unit}) for production (${requestNumber})`;
      break;
    }

    case 'WAIT_KEEP_PENDING': {
      nextStatus = analysis.shortageQuantity > 0 ? 'AWAITING_STOCK' : 'UNDER_REVIEW';
      actionLabel =
        analysis.shortageQuantity > 0
          ? 'Marked as Awaiting Stock (kept pending)'
          : 'Kept pending under review';
      break;
    }

    case 'APPROVE_ORDER': {
      if (analysis.shortageQuantity > 0) {
        throw new Error(
          `Cannot approve order with a shortage of ${analysis.shortageQuantity} ${analysis.unit}. Send for production or keep pending.`
        );
      }
      nextStatus = 'APPROVED';
      actionLabel = 'Approved order (inventory unchanged until dispatch)';
      break;
    }

    case 'REJECT_ORDER': {
      nextStatus = 'REJECTED';
      actionLabel = 'Rejected order';
      break;
    }

    default: {
      const exhaustive: never = payload.decision;
      throw new Error(`Unsupported decision: ${String(exhaustive)}`);
    }
  }

  const updatedOrder: Order = {
    ...order,
    status: nextStatus,
    auditTrail: [
      {
        id: `audit-${order.id}-${Date.now()}`,
        timestamp: nowIso,
        actor,
        action: actionLabel,
        fromStatus: order.status,
        toStatus: nextStatus,
        note: payload.note?.trim() || undefined,
      },
      ...order.auditTrail,
    ],
  };

  return { updatedOrder, createdProductionRequest };
}

/**
 * Generates real-time stock and production alerts from current inventory and requests.
 */
export function buildStockAndProductionAlerts(
  products: Product[],
  rawMaterials: RawMaterial[],
  productionRequests: ProductionRequest[]
): StockOrProductionAlert[] {
  const alerts: StockOrProductionAlert[] = [];

  for (const product of products) {
    const stock = sanitizeNonNegativeStock(product.availableStock);
    if (stock === 0) {
      alerts.push({
        id: `alert-fg-zero-${product.id}`,
        severity: 'critical',
        category: 'FINISHED_GOODS',
        title: `${product.name} out of stock`,
        detail: `0 ${product.unit} available (reorder threshold: ${product.reorderLevel} ${product.unit}).`,
      });
    } else if (stock <= product.reorderLevel) {
      alerts.push({
        id: `alert-fg-low-${product.id}`,
        severity: 'warning',
        category: 'FINISHED_GOODS',
        title: `Low finished stock: ${product.name}`,
        detail: `${stock} ${product.unit} on hand (threshold: ${product.reorderLevel} ${product.unit}).`,
      });
    }
  }

  for (const material of rawMaterials) {
    const stock = sanitizeNonNegativeStock(material.availableStock);
    if (stock <= material.reorderLevel) {
      alerts.push({
        id: `alert-rm-low-${material.id}`,
        severity: stock === 0 ? 'critical' : 'warning',
        category: 'RAW_MATERIAL',
        title: `Low raw material: ${material.name}`,
        detail: `${stock} ${material.unit} remaining (threshold: ${material.reorderLevel} ${material.unit}).`,
      });
    }
  }

  const pendingReview = productionRequests.filter(
    (r) => r.status === 'PENDING_SUPERVISOR_REVIEW'
  );
  if (pendingReview.length > 0) {
    alerts.push({
      id: `alert-pr-pending`,
      severity: 'info',
      category: 'PRODUCTION',
      title: `${pendingReview.length} production request${pendingReview.length > 1 ? 's' : ''} awaiting supervisor`,
      detail: pendingReview
        .map((r) => `${r.requestNumber} (${r.productName}: ${r.requestedQuantity} ${r.unit})`)
        .join(' • '),
    });
  }

  return alerts;
}
