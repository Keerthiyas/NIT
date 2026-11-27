import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  HttpError,
  hashPassword,
  requireRole,
  type AuthUser,
  type UserRole,
} from './auth.ts';
import { BUSINESS_PROFILE, runInTransaction } from './db.ts';
import {
  cleanupUnreferencedUploadedImage,
  normalizeProductImageUrl,
} from './productImages.ts';
import {
  calcGstPaise,
  calcTaxablePaise,
  fromGstBps,
  fromPaise,
  fromScaledQty,
  toGstBps,
  toPaise,
  toScaledQty,
} from './moneyQty.ts';

const INDIAN_STATE_CODES: Record<string, string> = {
  'Tamil Nadu': '33',
  Karnataka: '29',
  Kerala: '32',
  'Andhra Pradesh': '37',
  Telangana: '36',
  Maharashtra: '27',
  Gujarat: '24',
  Delhi: '07',
  'West Bengal': '19',
  'Uttar Pradesh': '09',
  Rajasthan: '08',
  Puducherry: '34',
};

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function normalizeMobileDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

function validateMobileNumber(phone: string): string {
  const normalized = normalizeMobileDigits(phone);
  if (!/^[6-9]\d{9}$/.test(normalized)) {
    throw new HttpError(
      400,
      'Please enter a valid 10-digit Indian mobile number (starting with 6-9).'
    );
  }
  return normalized;
}

function validateAndNormalizeGstin(gstin?: string): string {
  const trimmed = (gstin ?? '').trim().toUpperCase();
  if (!trimmed) return '';
  if (!GSTIN_REGEX.test(trimmed)) {
    throw new HttpError(
      400,
      'Invalid GSTIN format. Expected 15-character GSTIN (e.g., 33AAACN1234A1Z5).'
    );
  }
  return trimmed;
}

function assertNoDuplicateCustomer(
  db: DatabaseSync,
  normalizedMobile: string,
  normalizedGstin: string,
  excludeCustomerId?: string
): void {
  const existing = db
    .prepare(`SELECT id, code, name, phone, gstin FROM customers`)
    .all() as Array<{
    id: string;
    code: string;
    name: string;
    phone: string;
    gstin: string;
  }>;

  for (const row of existing) {
    if (excludeCustomerId && row.id === excludeCustomerId) continue;
    if (normalizedMobile && normalizeMobileDigits(row.phone) === normalizedMobile) {
      throw new HttpError(
        409,
        `A customer with mobile number ${row.phone} already exists (${row.name} - ${row.code}).`
      );
    }
    if (normalizedGstin && row.gstin.trim().toUpperCase() === normalizedGstin) {
      throw new HttpError(
        409,
        `A customer with GSTIN ${normalizedGstin} already exists (${row.name} - ${row.code}).`
      );
    }
  }
}

export function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function nextSequenceNumber(
  db: DatabaseSync,
  table: string,
  column: string,
  prefix: string
): string {
  const rows = db.prepare(`SELECT ${column} AS num FROM ${table}`).all() as Array<{
    num: string;
  }>;
  let maxSeq = 0;
  for (const r of rows) {
    const match = /(\d+)$/.exec(r.num);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

export function recordAuditLog(
  db: DatabaseSync,
  actor: AuthUser,
  entityType: string,
  entityId: string,
  action: string,
  details: string = ''
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, timestamp, actor_user_id, actor_name, actor_role, entity_type, entity_id, action, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('alog'),
    new Date().toISOString(),
    actor.id,
    actor.fullName,
    actor.role,
    entityType,
    entityId,
    action,
    details
  );
}

export interface StockMovementParams {
  itemId: string;
  movementType:
    | 'OPENING_BALANCE'
    | 'PURCHASE_RECEIPT'
    | 'PRODUCTION_CONSUMPTION'
    | 'PRODUCTION_OUTPUT'
    | 'DISPATCH'
    | 'DISCREPANCY_ADJUSTMENT';
  direction: 'IN' | 'OUT';
  qtyScaled: number;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  reason: string;
  actor: AuthUser;
  nowIso: string;
}

export function applyStockMovement(db: DatabaseSync, params: StockMovementParams): number {
  if (params.qtyScaled <= 0) {
    throw new HttpError(400, 'Stock movement quantity must be greater than zero.');
  }

  const existingDup = db
    .prepare(
      `SELECT id FROM stock_movements
       WHERE reference_type = ? AND reference_id = ? AND item_id = ? AND direction = ?`
    )
    .get(
      params.referenceType,
      params.referenceId,
      params.itemId,
      params.direction
    ) as { id: string } | undefined;

  if (existingDup) {
    throw new HttpError(
      409,
      `Duplicate stock posting blocked for ${params.referenceNumber} (${params.itemId}).`
    );
  }

  const balRow = db
    .prepare(
      `SELECT sb.quantity_scaled, ii.name, ii.unit
       FROM stock_balances sb
       JOIN inventory_items ii ON ii.id = sb.item_id
       WHERE sb.item_id = ?`
    )
    .get(params.itemId) as
    | { quantity_scaled: number; name: string; unit: string }
    | undefined;

  if (!balRow) {
    throw new HttpError(404, `Inventory item ${params.itemId} not found.`);
  }

  const nextBalance =
    params.direction === 'IN'
      ? balRow.quantity_scaled + params.qtyScaled
      : balRow.quantity_scaled - params.qtyScaled;

  if (nextBalance < 0) {
    throw new HttpError(
      400,
      `Insufficient stock for ${balRow.name}: available ${fromScaledQty(
        balRow.quantity_scaled
      )} ${balRow.unit}, attempted deduction ${fromScaledQty(params.qtyScaled)} ${balRow.unit}. Negative stock is not allowed.`
    );
  }

  db.prepare(
    `UPDATE stock_balances SET quantity_scaled = ?, updated_at = ? WHERE item_id = ?`
  ).run(nextBalance, params.nowIso, params.itemId);

  db.prepare(
    `INSERT INTO stock_movements (
      id, item_id, movement_type, direction, quantity_scaled, balance_after_scaled,
      reference_type, reference_id, reference_number, reason, actor_user_id, actor_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('mov'),
    params.itemId,
    params.movementType,
    params.direction,
    params.qtyScaled,
    nextBalance,
    params.referenceType,
    params.referenceId,
    params.referenceNumber,
    params.reason,
    params.actor.id,
    params.actor.fullName,
    params.nowIso
  );

  return nextBalance;
}

/**
 * Evaluates shortage for a customer order (single or multi-product) using live stock_balances and BOM.
 */
export function evaluateOrderAvailability(db: DatabaseSync, orderId: string) {
  const orderRow = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.code AS customer_code,
              p.name AS product_name, p.sku AS product_sku, p.unit AS product_unit,
              sb.quantity_scaled AS fg_stock_scaled
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN inventory_items p ON p.id = o.product_id
       JOIN stock_balances sb ON sb.item_id = p.id
       WHERE o.id = ?`
    )
    .get(orderId) as
    | {
        id: string;
        order_number: string;
        product_id: string;
        product_name: string;
        product_unit: string;
        requested_qty_scaled: number;
        dispatched_qty_scaled: number;
        fg_stock_scaled: number;
      }
    | undefined;

  if (!orderRow) {
    throw new HttpError(404, `Order ${orderId} not found.`);
  }

  const itemRows = db
    .prepare(
      `SELECT oi.id, oi.product_id, oi.product_name, oi.sku, oi.unit, oi.image_url,
              oi.requested_qty_scaled, oi.dispatched_qty_scaled,
              sb.quantity_scaled AS fg_stock_scaled
       FROM order_items oi
       JOIN stock_balances sb ON sb.item_id = oi.product_id
       WHERE oi.order_id = ?
       ORDER BY oi.rowid ASC`
    )
    .all(orderId) as Array<{
    id: string;
    product_id: string;
    product_name: string;
    sku: string;
    unit: string;
    image_url: string;
    requested_qty_scaled: number;
    dispatched_qty_scaled: number;
    fg_stock_scaled: number;
  }>;

  const effectiveItems =
    itemRows.length > 0
      ? itemRows
      : [
          {
            id: `oi-${orderRow.id}`,
            product_id: orderRow.product_id,
            product_name: orderRow.product_name,
            sku: '',
            unit: orderRow.product_unit,
            image_url: '',
            requested_qty_scaled: orderRow.requested_qty_scaled,
            dispatched_qty_scaled: orderRow.dispatched_qty_scaled,
            fg_stock_scaled: orderRow.fg_stock_scaled,
          },
        ];

  const bomStmt = db.prepare(
    `SELECT b.material_id, b.quantity_per_unit_scaled,
            m.sku AS material_code, m.name AS material_name, m.unit, m.category,
            sb.quantity_scaled AS available_scaled
     FROM bom_items b
     JOIN inventory_items m ON m.id = b.material_id
     JOIN stock_balances sb ON sb.item_id = m.id
     WHERE b.product_id = ?
     ORDER BY m.category, m.name`
  );

  const checkedAt = new Date().toISOString();

  // Track aggregated BOM demand across all shortage items in the order
  const aggregatedBomMap = new Map<
    string,
    {
      rawMaterialId: string;
      materialCode: string;
      materialName: string;
      category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
      unit: string;
      quantityPerUnit: number;
      requiredScaled: number;
      availableScaled: number;
    }
  >();

  const itemAnalyses = effectiveItems.map((item) => {
    const remainingScaled = Math.max(0, item.requested_qty_scaled - item.dispatched_qty_scaled);
    const availableScaled = Math.max(0, item.fg_stock_scaled);
    const shortageScaled = Math.max(0, remainingScaled - availableScaled);
    const productionRequired = shortageScaled > 0;

    if (!productionRequired) {
      return {
        orderItemId: item.id,
        productId: item.product_id,
        productName: item.product_name,
        sku: item.sku,
        unit: item.unit,
        imageUrl: item.image_url || undefined,
        requestedQuantity: fromScaledQty(item.requested_qty_scaled),
        remainingToFulfill: fromScaledQty(remainingScaled),
        availableFinishedStock: fromScaledQty(availableScaled),
        shortageQuantity: 0,
        productionRequired: false,
        rawMaterialAvailability: 'NOT_APPLICABLE' as const,
        bomBreakdown: [],
        materialsRequiringPurchase: [],
        _internalBom: [] as Array<{
          rawMaterialId: string;
          materialCode: string;
          materialName: string;
          category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
          unit: string;
          quantityPerUnit: number;
          requiredQuantity: number;
          availableStock: number;
          shortfallQuantity: number;
          isSufficient: boolean;
          _requiredScaled: number;
          _availableScaled: number;
          _shortfallScaled: number;
        }>,
      };
    }

    const bomRows = bomStmt.all(item.product_id) as Array<{
      material_id: string;
      quantity_per_unit_scaled: number;
      material_code: string;
      material_name: string;
      unit: string;
      category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
      available_scaled: number;
    }>;

    const itemBom = bomRows.map((row) => {
      const requiredScaled = Math.round(
        (shortageScaled * row.quantity_per_unit_scaled) / 10000
      );
      const matAvailableScaled = Math.max(0, row.available_scaled);
      const shortfallScaled = Math.max(0, requiredScaled - matAvailableScaled);

      const existingAgg = aggregatedBomMap.get(row.material_id);
      if (existingAgg) {
        existingAgg.requiredScaled += requiredScaled;
      } else {
        aggregatedBomMap.set(row.material_id, {
          rawMaterialId: row.material_id,
          materialCode: row.material_code,
          materialName: row.material_name,
          category: row.category,
          unit: row.unit,
          quantityPerUnit: fromScaledQty(row.quantity_per_unit_scaled),
          requiredScaled,
          availableScaled: matAvailableScaled,
        });
      }

      return {
        rawMaterialId: row.material_id,
        materialCode: row.material_code,
        materialName: row.material_name,
        category: row.category,
        unit: row.unit,
        quantityPerUnit: fromScaledQty(row.quantity_per_unit_scaled),
        requiredQuantity: fromScaledQty(requiredScaled),
        availableStock: fromScaledQty(matAvailableScaled),
        shortfallQuantity: fromScaledQty(shortfallScaled),
        isSufficient: shortfallScaled === 0,
        _requiredScaled: requiredScaled,
        _availableScaled: matAvailableScaled,
        _shortfallScaled: shortfallScaled,
      };
    });

    const itemPurchase = itemBom.filter((b) => !b.isSufficient);
    return {
      orderItemId: item.id,
      productId: item.product_id,
      productName: item.product_name,
      sku: item.sku,
      unit: item.unit,
      imageUrl: item.image_url || undefined,
      requestedQuantity: fromScaledQty(item.requested_qty_scaled),
      remainingToFulfill: fromScaledQty(remainingScaled),
      availableFinishedStock: fromScaledQty(availableScaled),
      shortageQuantity: fromScaledQty(shortageScaled),
      productionRequired: true,
      rawMaterialAvailability:
        itemPurchase.length === 0 ? ('SUFFICIENT' as const) : ('INSUFFICIENT' as const),
      bomBreakdown: itemBom.map(
        ({ _requiredScaled, _availableScaled, _shortfallScaled, ...rest }) => rest
      ),
      materialsRequiringPurchase: itemPurchase.map(
        ({ _requiredScaled, _availableScaled, _shortfallScaled, ...rest }) => rest
      ),
      _internalBom: itemBom,
    };
  });

  const totalRequested = itemAnalyses.reduce((sum, i) => sum + i.requestedQuantity, 0);
  const totalRemaining = itemAnalyses.reduce((sum, i) => sum + i.remainingToFulfill, 0);
  const totalAvailable = itemAnalyses.reduce((sum, i) => sum + i.availableFinishedStock, 0);
  const totalShortage = itemAnalyses.reduce((sum, i) => sum + i.shortageQuantity, 0);
  const anyProductionRequired = itemAnalyses.some((i) => i.productionRequired);

  const aggregatedBom = Array.from(aggregatedBomMap.values()).map((agg) => {
    const shortfallScaled = Math.max(0, agg.requiredScaled - agg.availableScaled);
    return {
      rawMaterialId: agg.rawMaterialId,
      materialCode: agg.materialCode,
      materialName: agg.materialName,
      category: agg.category,
      unit: agg.unit,
      quantityPerUnit: agg.quantityPerUnit,
      requiredQuantity: fromScaledQty(agg.requiredScaled),
      availableStock: fromScaledQty(agg.availableScaled),
      shortfallQuantity: fromScaledQty(shortfallScaled),
      isSufficient: shortfallScaled === 0,
      _requiredScaled: agg.requiredScaled,
      _availableScaled: agg.availableScaled,
      _shortfallScaled: shortfallScaled,
    };
  });

  const aggregatedPurchase = aggregatedBom.filter((b) => !b.isSufficient);
  const overallRawAvailability = !anyProductionRequired
    ? ('NOT_APPLICABLE' as const)
    : aggregatedPurchase.length === 0
      ? ('SUFFICIENT' as const)
      : ('INSUFFICIENT' as const);

  const summaryProductName =
    itemAnalyses.length > 1
      ? `${itemAnalyses[0].productName} (+${itemAnalyses.length - 1} more)`
      : orderRow.product_name;

  return {
    orderId: orderRow.id,
    productId: orderRow.product_id,
    productName: summaryProductName,
    unit: orderRow.product_unit,
    requestedQuantity: totalRequested,
    remainingToFulfill: totalRemaining,
    availableFinishedStock: totalAvailable,
    shortageQuantity: totalShortage,
    productionRequired: anyProductionRequired,
    rawMaterialAvailability: overallRawAvailability,
    bomBreakdown: aggregatedBom.map(
      ({ _requiredScaled, _availableScaled, _shortfallScaled, ...rest }) => rest
    ),
    materialsRequiringPurchase: aggregatedPurchase.map(
      ({ _requiredScaled, _availableScaled, _shortfallScaled, ...rest }) => rest
    ),
    itemAnalyses: itemAnalyses.map(({ _internalBom, ...rest }) => rest),
    checkedAt,
    _internalBom: aggregatedBom,
    _internalItemAnalyses: itemAnalyses,
  };
}

/**
 * Recalculates open shortage queries against current stock_balances and updates
 * AWAITING_MATERIALS production requests to READY_FOR_PRODUCTION when satisfied.
 */
export function recalculateOpenShortageQueries(
  db: DatabaseSync,
  nowIso: string = new Date().toISOString()
): void {
  const openQueries = db
    .prepare(
      `SELECT q.id, q.production_request_id, q.material_id, q.required_qty_scaled, q.status,
              sb.quantity_scaled AS live_available_scaled
       FROM material_shortage_queries q
       JOIN stock_balances sb ON sb.item_id = q.material_id
       WHERE q.status IN ('OPEN', 'PROCUREMENT_REQUESTED')`
    )
    .all() as Array<{
    id: string;
    production_request_id: string;
    material_id: string;
    required_qty_scaled: number;
    status: string;
    live_available_scaled: number;
  }>;

  const affectedPrIds = new Set<string>();
  const updateQuery = db.prepare(
    `UPDATE material_shortage_queries
     SET available_qty_scaled = ?, shortage_qty_scaled = ?, status = ?, updated_at = ?
     WHERE id = ?`
  );

  for (const q of openQueries) {
    const available = Math.max(0, q.live_available_scaled);
    const shortage = Math.max(0, q.required_qty_scaled - available);
    const nextStatus = shortage === 0 ? 'RESOLVED' : q.status;
    updateQuery.run(available, shortage, nextStatus, nowIso, q.id);
    affectedPrIds.add(q.production_request_id);
  }

  for (const prId of affectedPrIds) {
    const pr = db
      .prepare(`SELECT id, status, product_id, requested_qty_scaled FROM production_requests WHERE id = ?`)
      .get(prId) as
      | { id: string; status: string; product_id: string; requested_qty_scaled: number }
      | undefined;
    if (
      !pr ||
      (pr.status !== 'AWAITING_MATERIALS' &&
        pr.status !== 'MATERIAL_SHORTAGE' &&
        pr.status !== 'PENDING_MATERIAL_CHECK')
    ) {
      continue;
    }

    const remainingShortages = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM material_shortage_queries
         WHERE production_request_id = ? AND status != 'RESOLVED'`
      )
      .get(prId) as { cnt: number };

    if (remainingShortages.cnt === 0) {
      // Double check live BOM stocks
      const bomCheck = db
        .prepare(
          `SELECT b.quantity_per_unit_scaled, sb.quantity_scaled AS available_scaled
           FROM bom_items b
           JOIN stock_balances sb ON sb.item_id = b.material_id
           WHERE b.product_id = ?`
        )
        .all(pr.product_id) as Array<{
        quantity_per_unit_scaled: number;
        available_scaled: number;
      }>;

      const allSufficient = bomCheck.every((line) => {
        const reqScaled = Math.round(
          (pr.requested_qty_scaled * line.quantity_per_unit_scaled) / 10000
        );
        return line.available_scaled >= reqScaled;
      });

      if (allSufficient) {
        db.prepare(
          `UPDATE production_requests
           SET status = 'READY_FOR_PRODUCTION', supervisor_status = 'Ready for Production', updated_at = ?
           WHERE id = ?`
        ).run(nowIso, prId);
      }
    }
  }
}

export function getAdminDashboardSummary(db: DatabaseSync) {
  const orders = listOrders(db);
  const items = listInventoryItems(db);
  const finishedGoods = items.filter((i) => i.category === 'FINISHED_GOOD' && i.isActive);
  const productionRequests = listProductionRequests(db);

  const pendingOrdersCount = orders.filter(
    (o) => o.status === 'SUBMITTED' || o.status === 'UNDER_REVIEW'
  ).length;
  const productionRequiredCount = orders.filter(
    (o) => o.status === 'PRODUCTION_REQUIRED'
  ).length;
  const awaitingStockCount = orders.filter(
    (o) => o.status === 'AWAITING_STOCK'
  ).length;
  const approvedPendingDispatchCount = orders.filter(
    (o) => o.status === 'APPROVED' || o.status === 'PARTIALLY_DISPATCHED'
  ).length;

  const alerts: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    category: 'FINISHED_GOODS' | 'RAW_MATERIAL' | 'PRODUCTION';
    title: string;
    detail: string;
  }> = [];

  for (const fg of finishedGoods) {
    if (fg.availableStock === 0) {
      alerts.push({
        id: `alert-fg-zero-${fg.id}`,
        severity: 'critical',
        category: 'FINISHED_GOODS',
        title: `${fg.name} out of stock`,
        detail: `0 ${fg.unit} available (reorder threshold: ${fg.reorderLevel} ${fg.unit}).`,
      });
    } else if (fg.availableStock <= fg.reorderLevel) {
      alerts.push({
        id: `alert-fg-low-${fg.id}`,
        severity: 'warning',
        category: 'FINISHED_GOODS',
        title: `Low finished stock: ${fg.name}`,
        detail: `${fg.availableStock} ${fg.unit} on hand (threshold: ${fg.reorderLevel} ${fg.unit}).`,
      });
    }
  }

  for (const mat of items.filter((i) => i.category !== 'FINISHED_GOOD' && i.isActive)) {
    if (mat.availableStock <= mat.reorderLevel) {
      alerts.push({
        id: `alert-mat-low-${mat.id}`,
        severity: mat.availableStock === 0 ? 'critical' : 'warning',
        category: 'RAW_MATERIAL',
        title: `Low ${mat.category === 'PACKAGING_MATERIAL' ? 'packaging' : 'raw material'}: ${mat.name}`,
        detail: `${mat.availableStock} ${mat.unit} remaining (threshold: ${mat.reorderLevel} ${mat.unit}).`,
      });
    }
  }

  const pendingReview = productionRequests.filter(
    (r) => r.status === 'PENDING_SUPERVISOR_REVIEW' || r.status === 'AWAITING_MATERIALS'
  );
  if (pendingReview.length > 0) {
    alerts.push({
      id: 'alert-pr-pending',
      severity: 'info',
      category: 'PRODUCTION',
      title: `${pendingReview.length} active production request${pendingReview.length > 1 ? 's' : ''}`,
      detail: pendingReview
        .map((r) => `${r.requestNumber} (${r.productName}: ${r.requestedQuantity} ${r.unit})`)
        .join(' • '),
    });
  }

  const recentOrders = [...orders]
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate))
    .slice(0, 6)
    .map((o) => ({
      ...o,
      productName: o.productName,
      unit: o.unit,
    }));

  return {
    pendingOrdersCount,
    productionRequiredCount,
    awaitingStockCount,
    approvedPendingDispatchCount,
    finishedGoodsStock: finishedGoods.map((fg) => ({
      id: fg.id,
      sku: fg.sku,
      name: fg.name,
      unit: fg.unit,
      availableStock: fg.availableStock,
      reorderLevel: fg.reorderLevel,
    })),
    productionRequests,
    alerts,
    recentOrders,
    dataSourceMode: 'BACKEND_API' as const,
  };
}

export function listOrders(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.code AS customer_code, c.state AS customer_state,
              p.name AS product_name, p.sku AS product_sku, p.unit AS product_unit,
              u.full_name AS salesman_name
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN inventory_items p ON p.id = o.product_id
       LEFT JOIN users u ON u.id = o.salesman_user_id
       ORDER BY o.order_date DESC, o.order_number DESC`
    )
    .all() as Array<{
    id: string;
    order_number: string;
    customer_id: string;
    customer_name: string;
    customer_code: string;
    customer_state: string;
    salesman_user_id: string | null;
    salesman_name: string | null;
    product_id: string;
    product_name: string;
    product_sku: string;
    product_unit: string;
    requested_qty_scaled: number;
    dispatched_qty_scaled: number;
    subtotal_paise: number;
    order_date: string;
    status: string;
    notes: string;
    created_at: string;
  }>;

  const itemStmt = db.prepare(
    `SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC`
  );

  const auditStmt = db.prepare(
    `SELECT id, timestamp, actor_name, action, from_status, to_status, note
     FROM order_audit_trail
     WHERE order_id = ?
     ORDER BY timestamp DESC`
  );

  return rows.map((row) => {
    const items = (
      itemStmt.all(row.id) as Array<{
        id: string;
        product_id: string;
        product_name: string;
        sku: string;
        pack_size: string;
        unit: string;
        image_url: string;
        unit_price_paise: number;
        gst_rate_bps: number;
        requested_qty_scaled: number;
        dispatched_qty_scaled: number;
      }>
    ).map((it) => {
      const qty = fromScaledQty(it.requested_qty_scaled);
      const unitPrice = fromPaise(it.unit_price_paise);
      return {
        id: it.id,
        productId: it.product_id,
        productName: it.product_name,
        sku: it.sku,
        packSize: it.pack_size,
        unit: it.unit,
        imageUrl: it.image_url || undefined,
        unitPrice,
        gstRate: fromGstBps(it.gst_rate_bps),
        requestedQuantity: qty,
        dispatchedQuantity: fromScaledQty(it.dispatched_qty_scaled),
        lineTotal: Math.round(qty * unitPrice * 100) / 100,
      };
    });

    const audits = auditStmt.all(row.id) as Array<{
      id: string;
      timestamp: string;
      actor_name: string;
      action: string;
      from_status: string | null;
      to_status: string;
      note: string;
    }>;

    const displayProductName =
      items.length > 1
        ? `${items[0].productName} (+${items.length - 1} more)`
        : row.product_name;

    return {
      id: row.id,
      orderNumber: row.order_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerCode: row.customer_code,
      customerState: row.customer_state,
      salesmanUserId: row.salesman_user_id || undefined,
      salesmanName: row.salesman_name || undefined,
      productId: row.product_id,
      productName: displayProductName,
      productSku: row.product_sku,
      unit: row.product_unit,
      requestedQuantity: fromScaledQty(row.requested_qty_scaled),
      dispatchedQuantity: fromScaledQty(row.dispatched_qty_scaled),
      subtotal: fromPaise(row.subtotal_paise),
      items,
      orderDate: row.order_date,
      createdAt: row.created_at,
      status: row.status,
      notes: row.notes || undefined,
      auditTrail: audits.map((a) => ({
        id: a.id,
        timestamp: a.timestamp,
        actor: a.actor_name,
        action: a.action,
        fromStatus: a.from_status || undefined,
        toStatus: a.to_status,
        note: a.note || undefined,
      })),
    };
  });
}

export function submitOrderDecision(
  db: DatabaseSync,
  actor: AuthUser,
  orderId: string,
  decision: 'SEND_FOR_PRODUCTION' | 'WAIT_KEEP_PENDING' | 'APPROVE_ORDER' | 'REJECT_ORDER',
  note?: string
) {
  requireRole(actor, ['ADMIN']);

  return runInTransaction(db, () => {
    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ?`)
      .get(orderId) as
      | {
          id: string;
          order_number: string;
          product_id: string;
          status: string;
        }
      | undefined;

    if (!order) {
      throw new HttpError(404, `Order ${orderId} not found.`);
    }
    if (order.status === 'REJECTED' || order.status === 'DISPATCHED') {
      throw new HttpError(
        400,
        `Order ${order.order_number} is already ${order.status} and cannot be modified.`
      );
    }

    const analysis = evaluateOrderAvailability(db, orderId);

    const nowIso = new Date().toISOString();
    let nextStatus = order.status;
    let actionLabel = '';
    let createdRequestId: string | undefined;

    if (decision === 'SEND_FOR_PRODUCTION') {
      if (analysis.shortageQuantity <= 0) {
        throw new HttpError(
          400,
          'Cannot send for production when there is no finished-goods shortage.'
        );
      }

      const shortageItems = (analysis._internalItemAnalyses ?? []).filter(
        (ia) => ia.shortageQuantity > 0
      );

      const createdRequestNumbers: string[] = [];
      const createdRequestIds: string[] = [];

      for (const item of shortageItems) {
        const existingPr = db
          .prepare(
            `SELECT request_number FROM production_requests
             WHERE order_id = ? AND product_id = ? AND status != 'CANCELLED'`
          )
          .get(orderId, item.productId) as { request_number: string } | undefined;

        if (existingPr) {
          throw new HttpError(
            409,
            `Production request ${existingPr.request_number} already exists for order ${order.order_number} (${item.productName}). Duplicate requests are blocked.`
          );
        }

        const requestNumber = nextSequenceNumber(
          db,
          'production_requests',
          'request_number',
          'PR-2026-'
        );
        const prId = uid('pr');
        if (!createdRequestId) createdRequestId = prId;
        createdRequestIds.push(prId);
        createdRequestNumbers.push(requestNumber);

        const hasShortages = item.materialsRequiringPurchase.length > 0;
        const prStatus = hasShortages ? 'AWAITING_MATERIALS' : 'PENDING_SUPERVISOR_REVIEW';
        const supStatus = hasShortages
          ? 'Awaiting Materials'
          : 'Pending Supervisor Review';

        db.prepare(
          `INSERT INTO production_requests (
            id, request_number, order_id, product_id, requested_qty_scaled,
            status, assigned_supervisor_id, supervisor_status, created_at, created_by, notes, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
        ).run(
          prId,
          requestNumber,
          order.id,
          item.productId,
          toScaledQty(item.shortageQuantity),
          prStatus,
          supStatus,
          nowIso,
          actor.fullName,
          note?.trim() || '',
          nowIso
        );

        if (hasShortages && item._internalBom) {
          const insertQuery = db.prepare(
            `INSERT INTO material_shortage_queries (
              id, query_number, production_request_id, order_id, material_id,
              required_qty_scaled, available_qty_scaled, shortage_qty_scaled,
              status, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
          );
          for (const line of item._internalBom) {
            if (!line.isSufficient) {
              const qNum = nextSequenceNumber(
                db,
                'material_shortage_queries',
                'query_number',
                'MSQ-2026-'
              );
              insertQuery.run(
                uid('msq'),
                qNum,
                prId,
                order.id,
                line.rawMaterialId,
                line._requiredScaled,
                line._availableScaled,
                line._shortfallScaled,
                `Shortage detected for ${order.order_number} / ${requestNumber}`,
                nowIso,
                nowIso
              );
            }
          }
        }
      }

      nextStatus = 'PRODUCTION_REQUIRED';
      actionLabel = `Sent shortage (${analysis.shortageQuantity} ${analysis.unit}) for production (${createdRequestNumbers.join(', ')})`;
    } else if (decision === 'WAIT_KEEP_PENDING') {
      nextStatus = analysis.shortageQuantity > 0 ? 'AWAITING_STOCK' : 'UNDER_REVIEW';
      actionLabel =
        analysis.shortageQuantity > 0
          ? 'Marked as Awaiting Stock (kept pending)'
          : 'Kept pending under review';
    } else if (decision === 'APPROVE_ORDER') {
      if (analysis.shortageQuantity > 0) {
        throw new HttpError(
          400,
          `Cannot approve order with a shortage of ${analysis.shortageQuantity} ${analysis.unit}.`
        );
      }
      nextStatus = 'APPROVED';
      actionLabel = 'Approved order (inventory unchanged until dispatch)';
    } else if (decision === 'REJECT_ORDER') {
      nextStatus = 'REJECTED';
      actionLabel = 'Rejected order';
    } else {
      throw new HttpError(400, `Unsupported decision: ${String(decision)}`);
    }

    db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(
      nextStatus,
      nowIso,
      order.id
    );

    db.prepare(
      `INSERT INTO order_audit_trail (id, order_id, timestamp, actor_user_id, actor_name, action, from_status, to_status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid('aud'),
      order.id,
      nowIso,
      actor.id,
      actor.fullName,
      actionLabel,
      order.status,
      nextStatus,
      note?.trim() || ''
    );

    recordAuditLog(db, actor, 'ORDER', order.id, decision, actionLabel);

    return {
      orderId: order.id,
      status: nextStatus,
      createdRequestId,
    };
  });
}

export function listInventoryItems(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT ii.*, sb.quantity_scaled, sb.updated_at AS stock_updated_at,
              (SELECT COUNT(*) FROM stock_movements sm WHERE sm.item_id = ii.id) AS movement_count
       FROM inventory_items ii
       JOIN stock_balances sb ON sb.item_id = ii.id
       ORDER BY ii.category, ii.name`
    )
    .all() as Array<{
    id: string;
    sku: string;
    name: string;
    category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL' | 'FINISHED_GOOD';
    unit: string;
    pack_size: string;
    selling_price_paise: number;
    gst_rate_bps: number;
    hsn_code: string;
    image_url: string;
    bom_version: string;
    reorder_level_scaled: number;
    is_active: number;
    quantity_scaled: number;
    stock_updated_at: string;
    movement_count: number;
    created_at: string;
    updated_at: string;
  }>;

  const usedInRows = db
    .prepare(
      `SELECT b.material_id, p.id AS product_id, p.name AS product_name, p.sku AS product_sku, b.quantity_per_unit_scaled, p.unit AS product_unit
       FROM bom_items b
       JOIN inventory_items p ON p.id = b.product_id
       WHERE p.is_active = 1
       ORDER BY p.name`
    )
    .all() as Array<{
    material_id: string;
    product_id: string;
    product_name: string;
    product_sku: string;
    quantity_per_unit_scaled: number;
    product_unit: string;
  }>;

  const usedInMap = new Map<
    string,
    Array<{ productId: string; productName: string; productSku: string; quantityPerUnit: number; productUnit: string }>
  >();
  for (const row of usedInRows) {
    const arr = usedInMap.get(row.material_id) ?? [];
    arr.push({
      productId: row.product_id,
      productName: row.product_name,
      productSku: row.product_sku,
      quantityPerUnit: fromScaledQty(row.quantity_per_unit_scaled),
      productUnit: row.product_unit,
    });
    usedInMap.set(row.material_id, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit,
    packSize: r.pack_size,
    sellingPrice: fromPaise(r.selling_price_paise),
    gstRate: fromGstBps(r.gst_rate_bps),
    hsnCode: r.hsn_code,
    imageUrl: r.image_url || undefined,
    bomVersion: r.bom_version || 'v1.0',
    usedInProducts: usedInMap.get(r.id) ?? [],
    availableStock: fromScaledQty(r.quantity_scaled),
    reorderLevel: fromScaledQty(r.reorder_level_scaled),
    isActive: Boolean(r.is_active),
    movementCount: r.movement_count,
    lastUpdatedAt: r.stock_updated_at || r.updated_at,
  }));
}

export function listStockMovements(db: DatabaseSync, itemId?: string) {
  const sql = itemId
    ? `SELECT sm.*, ii.sku, ii.name AS item_name, ii.unit, ii.category
       FROM stock_movements sm
       JOIN inventory_items ii ON ii.id = sm.item_id
       WHERE sm.item_id = ?
       ORDER BY sm.created_at DESC, sm.rowid DESC`
    : `SELECT sm.*, ii.sku, ii.name AS item_name, ii.unit, ii.category
       FROM stock_movements sm
       JOIN inventory_items ii ON ii.id = sm.item_id
       ORDER BY sm.created_at DESC, sm.rowid DESC
       LIMIT 200`;

  const rows = (itemId
    ? db.prepare(sql).all(itemId)
    : db.prepare(sql).all()) as Array<{
    id: string;
    item_id: string;
    sku: string;
    item_name: string;
    unit: string;
    category: string;
    movement_type: string;
    direction: 'IN' | 'OUT';
    quantity_scaled: number;
    balance_after_scaled: number;
    reference_type: string;
    reference_id: string;
    reference_number: string;
    reason: string;
    actor_name: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    sku: r.sku,
    itemName: r.item_name,
    unit: r.unit,
    category: r.category,
    movementType: r.movement_type,
    direction: r.direction,
    quantity: fromScaledQty(r.quantity_scaled),
    balanceAfter: fromScaledQty(r.balance_after_scaled),
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    referenceNumber: r.reference_number,
    reason: r.reason,
    actorName: r.actor_name,
    createdAt: r.created_at,
  }));
}

export function listProductionRequests(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT pr.*, o.order_number, c.name AS customer_name,
              p.name AS product_name, p.sku AS product_sku, p.unit, p.bom_version,
              u.full_name AS assigned_supervisor_name
       FROM production_requests pr
       JOIN orders o ON o.id = pr.order_id
       JOIN customers c ON c.id = o.customer_id
       JOIN inventory_items p ON p.id = pr.product_id
       LEFT JOIN users u ON u.id = pr.assigned_supervisor_id
       ORDER BY pr.created_at DESC`
    )
    .all() as Array<{
    id: string;
    request_number: string;
    order_id: string;
    order_number: string;
    customer_name: string;
    product_id: string;
    product_name: string;
    product_sku: string;
    unit: string;
    bom_version: string;
    requested_qty_scaled: number;
    status: string;
    priority: string;
    reason: string;
    started_at: string;
    assigned_supervisor_id: string | null;
    assigned_supervisor_name: string | null;
    supervisor_status: string;
    created_at: string;
    created_by: string;
    notes: string;
    updated_at: string;
  }>;

  const queryStmt = db.prepare(
    `SELECT q.*, m.name AS material_name, m.unit AS material_unit
     FROM material_shortage_queries q
     JOIN inventory_items m ON m.id = q.material_id
     WHERE q.production_request_id = ?`
  );

  const bomStmt = db.prepare(
    `SELECT b.material_id, b.quantity_per_unit_scaled,
            m.name AS material_name, m.sku AS material_code, m.unit, m.category,
            sb.quantity_scaled AS available_scaled
     FROM bom_items b
     JOIN inventory_items m ON m.id = b.material_id
     JOIN stock_balances sb ON sb.item_id = m.id
     WHERE b.product_id = ?
     ORDER BY m.category, m.name`
  );

  return rows.map((r) => {
    const queries = queryStmt.all(r.id) as Array<{
      id: string;
      material_id: string;
      material_name: string;
      material_unit: string;
      shortage_qty_scaled: number;
      status: string;
    }>;

    const bomRows = bomStmt.all(r.product_id) as Array<{
      material_id: string;
      quantity_per_unit_scaled: number;
      material_name: string;
      material_code: string;
      unit: string;
      category: string;
      available_scaled: number;
    }>;

    const materialsToPurchase = queries
      .filter((q) => q.status !== 'RESOLVED' && q.shortage_qty_scaled > 0)
      .map((q) => ({
        rawMaterialId: q.material_id,
        materialName: q.material_name,
        unit: q.material_unit,
        shortfallQuantity: fromScaledQty(q.shortage_qty_scaled),
      }));

    const bomMaterials = bomRows.map((b) => {
      const reqScaled = Math.round(
        (r.requested_qty_scaled * b.quantity_per_unit_scaled) / 10000
      );
      return {
        materialId: b.material_id,
        materialCode: b.material_code,
        materialName: b.material_name,
        category: b.category,
        unit: b.unit,
        quantityPerUnit: fromScaledQty(b.quantity_per_unit_scaled),
        requiredQuantity: fromScaledQty(reqScaled),
        availableStock: fromScaledQty(b.available_scaled),
        isSufficient: b.available_scaled >= reqScaled,
      };
    });

    const hasInsufficientLive = bomMaterials.some((b) => !b.isSufficient);

    return {
      id: r.id,
      requestNumber: r.request_number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      productId: r.product_id,
      productName: r.product_name,
      productSku: r.product_sku,
      unit: r.unit,
      bomVersion: r.bom_version || 'v1.0',
      requestedQuantity: fromScaledQty(r.requested_qty_scaled),
      rawMaterialAvailability: hasInsufficientLive ? ('INSUFFICIENT' as const) : ('SUFFICIENT' as const),
      materialsToPurchase,
      bomMaterials,
      status: r.status,
      priority: r.priority || 'NORMAL',
      reason: r.reason || 'Customer Order Shortage',
      startedAt: r.started_at || undefined,
      assignedSupervisorId: r.assigned_supervisor_id || undefined,
      assignedSupervisorName: r.assigned_supervisor_name || undefined,
      supervisorStatus: r.supervisor_status,
      createdAt: r.created_at,
      createdBy: r.created_by,
      notes: r.notes || undefined,
      updatedAt: r.updated_at,
    };
  });
}

export function listMaterialShortageQueries(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT q.*, m.name AS material_name, m.sku AS material_sku, m.unit, m.category,
              sb.quantity_scaled AS live_available_scaled,
              pr.request_number, o.order_number
       FROM material_shortage_queries q
       JOIN inventory_items m ON m.id = q.material_id
       JOIN stock_balances sb ON sb.item_id = q.material_id
       JOIN production_requests pr ON pr.id = q.production_request_id
       JOIN orders o ON o.id = q.order_id
       ORDER BY
         CASE q.status WHEN 'OPEN' THEN 0 WHEN 'PROCUREMENT_REQUESTED' THEN 1 ELSE 2 END,
         q.created_at DESC`
    )
    .all() as Array<{
    id: string;
    query_number: string;
    production_request_id: string;
    request_number: string;
    order_id: string;
    order_number: string;
    material_id: string;
    material_name: string;
    material_sku: string;
    unit: string;
    category: string;
    required_qty_scaled: number;
    available_qty_scaled: number;
    live_available_scaled: number;
    shortage_qty_scaled: number;
    status: string;
    notes: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => {
    const liveAvailable = fromScaledQty(r.live_available_scaled);
    const required = fromScaledQty(r.required_qty_scaled);
    const liveShortage =
      r.status === 'RESOLVED' ? 0 : Math.max(0, Math.round((required - liveAvailable) * 10000) / 10000);
    return {
      id: r.id,
      queryNumber: r.query_number,
      productionRequestId: r.production_request_id,
      requestNumber: r.request_number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      materialId: r.material_id,
      materialName: r.material_name,
      materialSku: r.material_sku,
      category: r.category,
      unit: r.unit,
      requiredQuantity: required,
      availableQuantity: liveAvailable,
      shortageQuantity: liveShortage,
      status: r.status,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export const PURCHASE_OWNER_APPROVAL_LIMIT_PAISE = 1000000; // ₹10,000.00 default

export function getPurchaseApprovalLimitPaise(db: DatabaseSync): number {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'purchase_approval_limit_paise'`)
    .get() as { value: string } | undefined;
  const parsed = row ? Number.parseInt(row.value, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return PURCHASE_OWNER_APPROVAL_LIMIT_PAISE;
}

export function listPurchaseOrders(db: DatabaseSync) {
  const pos = db
    .prepare(
      `SELECT po.*, s.name AS supplier_name, s.code AS supplier_code
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       ORDER BY po.created_at DESC`
    )
    .all() as Array<{
    id: string;
    po_number: string;
    supplier_id: string;
    supplier_name: string;
    supplier_code: string;
    status: string;
    order_date: string;
    estimated_total_paise: number;
    approval_status: string;
    approved_by: string;
    approved_at: string;
    rejection_reason: string;
    notes: string;
    created_by: string;
    created_at: string;
  }>;

  const itemStmt = db.prepare(
    `SELECT poi.*, ii.name AS item_name, ii.sku, ii.unit, ii.category
     FROM purchase_order_items poi
     JOIN inventory_items ii ON ii.id = poi.item_id
     WHERE poi.purchase_order_id = ?`
  );

  return pos.map((po) => {
    const items = itemStmt.all(po.id) as Array<{
      id: string;
      item_id: string;
      item_name: string;
      sku: string;
      unit: string;
      category: string;
      ordered_qty_scaled: number;
      received_qty_scaled: number;
      unit_cost_paise: number;
    }>;

    return {
      id: po.id,
      poNumber: po.po_number,
      supplierId: po.supplier_id,
      supplierName: po.supplier_name,
      supplierCode: po.supplier_code,
      status: po.status,
      orderDate: po.order_date,
      estimatedTotal: fromPaise(po.estimated_total_paise ?? 0),
      approvalStatus: po.approval_status || 'NOT_REQUIRED',
      approvedBy: po.approved_by || undefined,
      approvedAt: po.approved_at || undefined,
      rejectionReason: po.rejection_reason || undefined,
      notes: po.notes || undefined,
      createdBy: po.created_by,
      createdAt: po.created_at,
      items: items.map((i) => ({
        id: i.id,
        itemId: i.item_id,
        itemName: i.item_name,
        sku: i.sku,
        unit: i.unit,
        category: i.category,
        orderedQuantity: fromScaledQty(i.ordered_qty_scaled),
        receivedQuantity: fromScaledQty(i.received_qty_scaled),
        unitCost: fromPaise(i.unit_cost_paise),
      })),
    };
  });
}

export function createPurchaseOrder(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    supplierId: string;
    items: Array<{ itemId: string; orderedQuantity: number; unitCost?: number }>;
    shortageQueryIds?: string[];
    purchaseRequirementIds?: string[];
    notes?: string;
  }
) {
  requireRole(actor, ['ADMIN']);

  if (!input.supplierId || !input.items?.length) {
    throw new HttpError(400, 'Supplier and at least one material line item are required.');
  }

  return runInTransaction(db, () => {
    const sup = db
      .prepare(`SELECT id, name, is_active FROM suppliers WHERE id = ?`)
      .get(input.supplierId) as { id: string; name: string; is_active: number } | undefined;
    if (!sup || !sup.is_active) {
      throw new HttpError(400, 'Active supplier is required.');
    }

    const nowIso = new Date().toISOString();
    const poNumber = nextSequenceNumber(db, 'purchase_orders', 'po_number', 'PO-2026-');
    const poId = uid('po');

    let estimatedTotalPaise = 0;
    const preparedLines: Array<{ itemId: string; qtyScaled: number; unitCostPaise: number }> = [];
    for (const line of input.items) {
      const item = db
        .prepare(`SELECT id, category FROM inventory_items WHERE id = ?`)
        .get(line.itemId) as { id: string; category: string } | undefined;
      if (!item || item.category === 'FINISHED_GOOD') {
        throw new HttpError(400, 'Purchase orders can only be raised for raw or packaging materials.');
      }
      const qtyScaled = toScaledQty(line.orderedQuantity);
      if (qtyScaled <= 0) {
        throw new HttpError(400, 'Ordered quantity must be greater than zero.');
      }
      const unitCostPaise = toPaise(line.unitCost ?? 0);
      estimatedTotalPaise += calcTaxablePaise(qtyScaled, unitCostPaise);
      preparedLines.push({ itemId: item.id, qtyScaled, unitCostPaise });
    }

    const approvalLimitPaise = getPurchaseApprovalLimitPaise(db);
    const requiresOwnerApproval = estimatedTotalPaise > approvalLimitPaise;
    const approvalStatus = requiresOwnerApproval ? 'PENDING_OWNER_APPROVAL' : 'NOT_REQUIRED';

    db.prepare(
      `INSERT INTO purchase_orders (
        id, po_number, supplier_id, status, order_date, estimated_total_paise, approval_status,
        notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'ORDERED', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      poId,
      poNumber,
      sup.id,
      nowIso.slice(0, 10),
      estimatedTotalPaise,
      approvalStatus,
      input.notes?.trim() || '',
      actor.fullName,
      nowIso,
      nowIso
    );

    const insertLine = db.prepare(
      `INSERT INTO purchase_order_items (id, purchase_order_id, item_id, ordered_qty_scaled, received_qty_scaled, unit_cost_paise)
       VALUES (?, ?, ?, ?, 0, ?)`
    );

    for (const line of preparedLines) {
      insertLine.run(uid('poi'), poId, line.itemId, line.qtyScaled, line.unitCostPaise);
    }

    // Mark linked shortage queries as PROCUREMENT_REQUESTED (stock unchanged!)
    if (input.shortageQueryIds?.length) {
      const markStmt = db.prepare(
        `UPDATE material_shortage_queries
         SET status = 'PROCUREMENT_REQUESTED', notes = ?, updated_at = ?
         WHERE id = ? AND status = 'OPEN'`
      );
      for (const qId of input.shortageQueryIds) {
        markStmt.run(`PO ${poNumber} raised with ${sup.name}`, nowIso, qId);
      }
    }

    if (input.purchaseRequirementIds?.length) {
      const nextReqStatus = requiresOwnerApproval ? 'AWAITING_OWNER_APPROVAL' : 'PO_PREPARED';
      const updReq = db.prepare(
        `UPDATE material_purchase_requirements
         SET status = ?, purchase_order_id = ?, updated_at = ?
         WHERE id = ? AND status IN ('SUBMITTED_TO_PROCUREMENT', 'PO_PREPARED')`
      );
      for (const reqId of input.purchaseRequirementIds) {
        updReq.run(nextReqStatus, poId, nowIso, reqId);
      }
    }

    recordAuditLog(
      db,
      actor,
      'PURCHASE_ORDER',
      poId,
      'CREATE_PO',
      `${poNumber} raised to ${sup.name} (${approvalStatus}; no inventory change until receipt)`
    );

    return { id: poId, poNumber, approvalStatus, estimatedTotal: fromPaise(estimatedTotalPaise) };
  });
}

export function listPurchaseReceipts(db: DatabaseSync) {
  const receipts = db
    .prepare(
      `SELECT pr.*, s.name AS supplier_name, po.po_number
       FROM purchase_receipts pr
       JOIN suppliers s ON s.id = pr.supplier_id
       LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id
       ORDER BY pr.created_at DESC`
    )
    .all() as Array<{
    id: string;
    receipt_number: string;
    purchase_order_id: string | null;
    po_number: string | null;
    supplier_id: string;
    supplier_name: string;
    received_date: string;
    received_by: string;
    notes: string;
    created_at: string;
  }>;

  const itemStmt = db.prepare(
    `SELECT pri.*, ii.name AS item_name, ii.sku, ii.unit
     FROM purchase_receipt_items pri
     JOIN inventory_items ii ON ii.id = pri.item_id
     WHERE pri.receipt_id = ?`
  );

  return receipts.map((r) => ({
    id: r.id,
    receiptNumber: r.receipt_number,
    purchaseOrderId: r.purchase_order_id || undefined,
    poNumber: r.po_number || undefined,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    receivedDate: r.received_date,
    receivedBy: r.received_by,
    notes: r.notes || undefined,
    createdAt: r.created_at,
    items: (
      itemStmt.all(r.id) as Array<{
        id: string;
        item_id: string;
        item_name: string;
        sku: string;
        unit: string;
        received_qty_scaled: number;
        unit_cost_paise: number;
      }>
    ).map((i) => ({
      id: i.id,
      itemId: i.item_id,
      itemName: i.item_name,
      sku: i.sku,
      unit: i.unit,
      receivedQuantity: fromScaledQty(i.received_qty_scaled),
      unitCost: fromPaise(i.unit_cost_paise),
    })),
  }));
}

export function postPurchaseReceipt(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    supplierId: string;
    purchaseOrderId?: string;
    items: Array<{ itemId: string; receivedQuantity: number; unitCost?: number }>;
    idempotencyKey?: string;
    notes?: string;
  }
) {
  requireRole(actor, ['ADMIN']);

  if (!input.supplierId || !input.items?.length) {
    throw new HttpError(400, 'Supplier and received items are required.');
  }

  return runInTransaction(db, () => {
    if (input.idempotencyKey) {
      const existing = db
        .prepare(`SELECT id, receipt_number FROM purchase_receipts WHERE idempotency_key = ?`)
        .get(input.idempotencyKey) as { id: string; receipt_number: string } | undefined;
      if (existing) {
        return { id: existing.id, receiptNumber: existing.receipt_number, deduplicated: true };
      }
    }

    if (input.purchaseOrderId) {
      const poRow = db
        .prepare(`SELECT id, po_number, approval_status FROM purchase_orders WHERE id = ?`)
        .get(input.purchaseOrderId) as
        | { id: string; po_number: string; approval_status: string }
        | undefined;
      if (!poRow) {
        throw new HttpError(404, `Purchase order ${input.purchaseOrderId} not found.`);
      }
      if (poRow.approval_status === 'PENDING_OWNER_APPROVAL') {
        throw new HttpError(
          400,
          `Purchase order ${poRow.po_number} requires Owner approval before posting goods receipt.`
        );
      }
      if (poRow.approval_status === 'REJECTED') {
        throw new HttpError(
          400,
          `Purchase order ${poRow.po_number} was rejected and cannot receive goods.`
        );
      }
    }

    const nowIso = new Date().toISOString();
    const receiptNumber = nextSequenceNumber(db, 'purchase_receipts', 'receipt_number', 'GRN-2026-');
    const receiptId = uid('grn');

    db.prepare(
      `INSERT INTO purchase_receipts (id, receipt_number, purchase_order_id, supplier_id, received_date, received_by, idempotency_key, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      receiptId,
      receiptNumber,
      input.purchaseOrderId || null,
      input.supplierId,
      nowIso.slice(0, 10),
      actor.fullName,
      input.idempotencyKey || null,
      input.notes?.trim() || '',
      nowIso
    );

    const insertLine = db.prepare(
      `INSERT INTO purchase_receipt_items (id, receipt_id, item_id, received_qty_scaled, unit_cost_paise)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const line of input.items) {
      const item = db
        .prepare(`SELECT id, name, category FROM inventory_items WHERE id = ?`)
        .get(line.itemId) as { id: string; name: string; category: string } | undefined;

      if (!item || item.category === 'FINISHED_GOOD') {
        throw new HttpError(400, 'Purchase receipts can only receive raw or packaging materials.');
      }

      const qtyScaled = toScaledQty(line.receivedQuantity);
      if (qtyScaled <= 0) {
        throw new HttpError(400, 'Received quantity must be greater than zero.');
      }

      insertLine.run(uid('grni'), receiptId, item.id, qtyScaled, toPaise(line.unitCost ?? 0));

      applyStockMovement(db, {
        itemId: item.id,
        movementType: 'PURCHASE_RECEIPT',
        direction: 'IN',
        qtyScaled,
        referenceType: 'PURCHASE_RECEIPT',
        referenceId: receiptId,
        referenceNumber: receiptNumber,
        reason: `Purchase receipt ${receiptNumber}${input.purchaseOrderId ? ' against PO' : ''}`,
        actor,
        nowIso,
      });

      if (input.purchaseOrderId) {
        db.prepare(
          `UPDATE purchase_order_items
           SET received_qty_scaled = received_qty_scaled + ?
           WHERE purchase_order_id = ? AND item_id = ?`
        ).run(qtyScaled, input.purchaseOrderId, item.id);
      }
    }

    if (input.purchaseOrderId) {
      const poLines = db
        .prepare(
          `SELECT ordered_qty_scaled, received_qty_scaled FROM purchase_order_items WHERE purchase_order_id = ?`
        )
        .all(input.purchaseOrderId) as Array<{
        ordered_qty_scaled: number;
        received_qty_scaled: number;
      }>;
      const allReceived = poLines.every((l) => l.received_qty_scaled >= l.ordered_qty_scaled);
      const poStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      db.prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`).run(
        poStatus,
        nowIso,
        input.purchaseOrderId
      );
      db.prepare(
        `UPDATE material_purchase_requirements
         SET status = ?, updated_at = ?
         WHERE purchase_order_id = ? AND status NOT IN ('RECEIVED', 'CANCELLED')`
      ).run(allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED', nowIso, input.purchaseOrderId);
    }

    // Recalculate open shortage queries and advance AWAITING_MATERIALS / MATERIAL_SHORTAGE production requests
    recalculateOpenShortageQueries(db, nowIso);

    recordAuditLog(
      db,
      actor,
      'PURCHASE_RECEIPT',
      receiptId,
      'POST_PURCHASE_RECEIPT',
      `${receiptNumber} posted; stock updated and shortage queries recalculated`
    );

    return { id: receiptId, receiptNumber, deduplicated: false };
  });
}

export function listProductionRuns(db: DatabaseSync) {
  const runs = db
    .prepare(
      `SELECT prun.*, preq.request_number, preq.order_id, o.order_number,
              p.name AS product_name, p.sku AS product_sku, p.unit, p.bom_version AS current_bom_version
       FROM production_runs prun
       JOIN production_requests preq ON preq.id = prun.production_request_id
       JOIN orders o ON o.id = preq.order_id
       JOIN inventory_items p ON p.id = prun.product_id
       ORDER BY prun.posted_at DESC`
    )
    .all() as Array<{
    id: string;
    run_number: string;
    production_request_id: string;
    request_number: string;
    order_id: string;
    order_number: string;
    product_id: string;
    product_name: string;
    product_sku: string;
    unit: string;
    current_bom_version: string;
    bom_version: string;
    planned_qty_scaled: number;
    actual_output_qty_scaled: number;
    rejected_qty_scaled: number;
    wastage_qty_scaled: number;
    damaged_packaging_qty_scaled: number;
    variance_qty_scaled: number;
    yield_percent_bps: number;
    quality_result: string;
    status: string;
    supervisor_user_id: string;
    supervisor_name: string;
    created_by_name: string;
    started_at: string;
    completed_at: string;
    posted_at: string;
    notes: string;
    variance_explanation: string;
  }>;

  const consStmt = db.prepare(
    `SELECT prc.*, ii.name AS material_name, ii.sku, ii.unit, ii.category
     FROM production_run_consumptions prc
     JOIN inventory_items ii ON ii.id = prc.material_id
     WHERE prc.production_run_id = ?`
  );

  const movStmt = db.prepare(
    `SELECT sm.id, sm.movement_type, sm.direction, sm.quantity_scaled, sm.balance_after_scaled,
            sm.reason, sm.created_at, sm.actor_name, ii.name AS item_name, ii.sku, ii.unit
     FROM stock_movements sm
     JOIN inventory_items ii ON ii.id = sm.item_id
     WHERE sm.reference_type = 'PRODUCTION_RUN' AND sm.reference_id = ?
     ORDER BY sm.created_at ASC`
  );

  return runs.map((r) => ({
    id: r.id,
    runNumber: r.run_number,
    productionRequestId: r.production_request_id,
    requestNumber: r.request_number,
    orderId: r.order_id,
    orderNumber: r.order_number,
    productId: r.product_id,
    productName: r.product_name,
    productSku: r.product_sku,
    unit: r.unit,
    bomVersion: r.bom_version || r.current_bom_version || 'v1.0',
    plannedQuantity: fromScaledQty(r.planned_qty_scaled),
    actualOutputQuantity: fromScaledQty(r.actual_output_qty_scaled),
    rejectedQuantity: fromScaledQty(r.rejected_qty_scaled ?? 0),
    wastageQuantity: fromScaledQty(r.wastage_qty_scaled),
    damagedPackagingQuantity: fromScaledQty(r.damaged_packaging_qty_scaled ?? 0),
    varianceQuantity: fromScaledQty(r.variance_qty_scaled),
    yieldPercent: Number(((r.yield_percent_bps ?? 10000) / 100).toFixed(2)),
    qualityResult: r.quality_result || 'PASSED',
    status: r.status,
    supervisorName: r.supervisor_name,
    createdByName: r.created_by_name || r.supervisor_name,
    startedAt: r.started_at || undefined,
    completedAt: r.completed_at || r.posted_at,
    postedAt: r.posted_at,
    notes: r.notes || undefined,
    varianceExplanation: r.variance_explanation || undefined,
    consumptions: (
      consStmt.all(r.id) as Array<{
        id: string;
        material_id: string;
        material_name: string;
        sku: string;
        unit: string;
        category: string;
        planned_qty_scaled: number;
        actual_consumed_qty_scaled: number;
        additional_consumed_qty_scaled: number;
        damaged_qty_scaled: number;
        wastage_qty_scaled: number;
        variance_qty_scaled: number;
        variance_percent_bps: number;
        reason: string;
      }>
    ).map((c) => ({
      id: c.id,
      materialId: c.material_id,
      materialName: c.material_name,
      sku: c.sku,
      unit: c.unit,
      category: c.category,
      plannedQuantity: fromScaledQty(c.planned_qty_scaled),
      actualConsumedQuantity: fromScaledQty(c.actual_consumed_qty_scaled),
      additionalConsumedQuantity: fromScaledQty(c.additional_consumed_qty_scaled ?? 0),
      damagedQuantity: fromScaledQty(c.damaged_qty_scaled ?? 0),
      wastageQuantity: fromScaledQty(c.wastage_qty_scaled),
      varianceQuantity: fromScaledQty(
        c.variance_qty_scaled ??
          c.actual_consumed_qty_scaled + (c.additional_consumed_qty_scaled ?? 0) - c.planned_qty_scaled
      ),
      variancePercent: Number(((c.variance_percent_bps ?? 0) / 100).toFixed(2)),
      reason: c.reason || undefined,
    })),
    linkedMovements: (
      movStmt.all(r.id) as Array<{
        id: string;
        movement_type: string;
        direction: string;
        quantity_scaled: number;
        balance_after_scaled: number;
        reason: string;
        created_at: string;
        actor_name: string;
        item_name: string;
        sku: string;
        unit: string;
      }>
    ).map((m) => ({
      id: m.id,
      itemName: m.item_name,
      sku: m.sku,
      unit: m.unit,
      movementType: m.movement_type,
      direction: m.direction,
      quantity: fromScaledQty(m.quantity_scaled),
      balanceAfter: fromScaledQty(m.balance_after_scaled),
      reason: m.reason,
      actorName: m.actor_name,
      createdAt: m.created_at,
    })),
  }));
}

/**
 * Production Supervisor ONLY: Update production request status (cannot mark COMPLETED directly).
 */
export function updateProductionRequestStatusBySupervisor(
  db: DatabaseSync,
  actor: AuthUser,
  requestId: string,
  nextStatus:
    | 'PENDING_MATERIAL_CHECK'
    | 'MATERIAL_SHORTAGE'
    | 'READY_FOR_PRODUCTION'
    | 'IN_PROGRESS'
    | 'CANCELLED',
  notes?: string
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  return runInTransaction(db, () => {
    const pr = db
      .prepare(`SELECT * FROM production_requests WHERE id = ?`)
      .get(requestId) as
      | {
          id: string;
          request_number: string;
          order_id: string;
          status: string;
        }
      | undefined;

    if (!pr) {
      throw new HttpError(404, `Production request ${requestId} not found.`);
    }
    if (pr.status === 'COMPLETED' || pr.status === 'PARTIALLY_COMPLETED' || pr.status === 'CANCELLED') {
      throw new HttpError(400, `Production request ${pr.request_number} is already ${pr.status}.`);
    }

    const nowIso = new Date().toISOString();
    const labelMap: Record<typeof nextStatus, string> = {
      PENDING_MATERIAL_CHECK: 'Pending Material Check',
      MATERIAL_SHORTAGE: 'Material Shortage',
      READY_FOR_PRODUCTION: 'Ready for Production',
      IN_PROGRESS: 'In Progress',
      CANCELLED: 'Cancelled by Supervisor',
    };

    db.prepare(
      `UPDATE production_requests
       SET status = ?, assigned_supervisor_id = ?, supervisor_status = ?,
           started_at = CASE WHEN ? = 'IN_PROGRESS' THEN COALESCE(NULLIF(started_at, ''), ?) ELSE started_at END,
           notes = COALESCE(NULLIF(?, ''), notes), updated_at = ?
       WHERE id = ?`
    ).run(
      nextStatus,
      actor.id,
      labelMap[nextStatus],
      nextStatus,
      nowIso,
      notes?.trim() || '',
      nowIso,
      pr.id
    );

    if (nextStatus === 'CANCELLED') {
      db.prepare(
        `UPDATE material_shortage_queries SET status = 'RESOLVED', updated_at = ?
         WHERE production_request_id = ? AND status != 'RESOLVED'`
      ).run(nowIso, pr.id);
    }

    recordAuditLog(
      db,
      actor,
      'PRODUCTION_REQUEST',
      pr.id,
      `SUPERVISOR_STATUS_${nextStatus}`,
      `${pr.request_number} -> ${nextStatus}`
    );

    return { id: pr.id, status: nextStatus };
  });
}

/**
 * Production Supervisor ONLY: Post actual production run, deducting raw/packaging materials
 * and adding ONLY good finished-goods stock atomically.
 */
export function postProductionRunBySupervisor(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    productionRequestId: string;
    actualOutputQuantity?: number;
    goodOutputQuantity?: number;
    rejectedQuantity?: number;
    damagedPackagingQuantity?: number;
    wastageQuantity?: number;
    qualityResult?: 'PASSED' | 'CONDITIONAL' | 'FAILED';
    completionStatus?: 'COMPLETED' | 'PARTIALLY_COMPLETED';
    startedAt?: string;
    completedAt?: string;
    consumptions?: Array<{
      materialId: string;
      actualConsumedQuantity: number;
      additionalConsumedQuantity?: number;
      damagedQuantity?: number;
      wastageQuantity?: number;
      reason?: string;
    }>;
    notes?: string;
    varianceExplanation?: string;
    idempotencyKey?: string;
  }
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  return runInTransaction(db, () => {
    if (input.idempotencyKey) {
      const existingRun = db
        .prepare(`SELECT id, run_number FROM production_runs WHERE idempotency_key = ?`)
        .get(input.idempotencyKey) as { id: string; run_number: string } | undefined;
      if (existingRun) {
        return { id: existingRun.id, runNumber: existingRun.run_number, deduplicated: true };
      }
    }

    const pr = db
      .prepare(`SELECT * FROM production_requests WHERE id = ?`)
      .get(input.productionRequestId) as
      | {
          id: string;
          request_number: string;
          order_id: string;
          product_id: string;
          requested_qty_scaled: number;
          status: string;
          started_at: string;
        }
      | undefined;

    if (!pr) {
      throw new HttpError(404, `Production request ${input.productionRequestId} not found.`);
    }
    if (pr.status === 'COMPLETED' || pr.status === 'PARTIALLY_COMPLETED' || pr.status === 'CANCELLED') {
      throw new HttpError(400, `Cannot post production for ${pr.status} request.`);
    }

    const dupRun = db
      .prepare(`SELECT run_number FROM production_runs WHERE production_request_id = ?`)
      .get(pr.id) as { run_number: string } | undefined;
    if (dupRun) {
      throw new HttpError(
        409,
        `Production run ${dupRun.run_number} already posted for ${pr.request_number}.`
      );
    }

    const prodRow = db
      .prepare(`SELECT name, bom_version FROM inventory_items WHERE id = ?`)
      .get(pr.product_id) as { name: string; bom_version: string } | undefined;

    const goodOutputValue = input.goodOutputQuantity ?? input.actualOutputQuantity ?? 0;
    if (goodOutputValue < 0 || (input.rejectedQuantity ?? 0) < 0 || (input.wastageQuantity ?? 0) < 0) {
      throw new HttpError(400, 'Output, rejected, and wastage quantities cannot be negative.');
    }
    const actualOutputScaled = toScaledQty(goodOutputValue);
    const rejectedScaled = toScaledQty(input.rejectedQuantity ?? 0);
    const wastageScaled = toScaledQty(input.wastageQuantity ?? 0);
    const damagedPkgScaled = toScaledQty(input.damagedPackagingQuantity ?? 0);
    const varianceScaled = actualOutputScaled - pr.requested_qty_scaled;
    const totalProducedAttempt = actualOutputScaled + rejectedScaled;
    const yieldPercentBps =
      pr.requested_qty_scaled > 0
        ? Math.round((actualOutputScaled / pr.requested_qty_scaled) * 10000)
        : totalProducedAttempt > 0
          ? Math.round((actualOutputScaled / totalProducedAttempt) * 10000)
          : 10000;

    const nowIso = new Date().toISOString();
    const runNumber = nextSequenceNumber(db, 'production_runs', 'run_number', 'RUN-2026-');
    const runId = uid('run');
    const finalStatus =
      input.completionStatus === 'PARTIALLY_COMPLETED' ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
    const qualityResult = input.qualityResult || (rejectedScaled > 0 ? 'CONDITIONAL' : 'PASSED');
    const startedAt = input.startedAt?.trim() || pr.started_at || nowIso;
    const completedAt = input.completedAt?.trim() || nowIso;

    db.prepare(
      `INSERT INTO production_runs (
        id, run_number, production_request_id, product_id, bom_version,
        planned_qty_scaled, actual_output_qty_scaled, rejected_qty_scaled,
        wastage_qty_scaled, damaged_packaging_qty_scaled, variance_qty_scaled,
        yield_percent_bps, quality_result, status, supervisor_user_id, supervisor_name,
        created_by_name, started_at, completed_at, posted_at, notes, variance_explanation, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      runId,
      runNumber,
      pr.id,
      pr.product_id,
      prodRow?.bom_version || 'v1.0',
      pr.requested_qty_scaled,
      actualOutputScaled,
      rejectedScaled,
      wastageScaled,
      damagedPkgScaled,
      varianceScaled,
      yieldPercentBps,
      qualityResult,
      finalStatus === 'PARTIALLY_COMPLETED' ? 'PARTIALLY_COMPLETED' : 'POSTED',
      actor.id,
      actor.fullName,
      actor.fullName,
      startedAt,
      completedAt,
      nowIso,
      input.notes?.trim() || '',
      input.varianceExplanation?.trim() || '',
      input.idempotencyKey || null
    );

    const bomRows = db
      .prepare(
        `SELECT material_id, quantity_per_unit_scaled FROM bom_items WHERE product_id = ?`
      )
      .all(pr.product_id) as Array<{
      material_id: string;
      quantity_per_unit_scaled: number;
    }>;

    const overrideMap = new Map(
      (input.consumptions ?? []).map((c) => [c.materialId, c])
    );

    const insertCons = db.prepare(
      `INSERT INTO production_run_consumptions (
        id, production_run_id, material_id, planned_qty_scaled,
        actual_consumed_qty_scaled, additional_consumed_qty_scaled,
        damaged_qty_scaled, wastage_qty_scaled, variance_qty_scaled, variance_percent_bps, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const bom of bomRows) {
      const plannedScaled = Math.round(
        (pr.requested_qty_scaled * bom.quantity_per_unit_scaled) / 10000
      );
      const override = overrideMap.get(bom.material_id);
      const baseActualScaled = override
        ? toScaledQty(override.actualConsumedQuantity)
        : plannedScaled;
      const additionalScaled = override ? toScaledQty(override.additionalConsumedQuantity ?? 0) : 0;
      const damagedScaled = override ? toScaledQty(override.damagedQuantity ?? 0) : 0;
      const matWastageScaled = override ? toScaledQty(override.wastageQuantity ?? 0) : 0;
      if (baseActualScaled < 0 || additionalScaled < 0 || damagedScaled < 0 || matWastageScaled < 0) {
        throw new HttpError(400, 'Material consumption and damage quantities cannot be negative.');
      }
      const totalConsumedScaled = baseActualScaled + additionalScaled;
      const matVarianceScaled = totalConsumedScaled - plannedScaled;
      const matVariancePctBps =
        plannedScaled > 0 ? Math.round((matVarianceScaled / plannedScaled) * 10000) : 0;

      insertCons.run(
        uid('rc'),
        runId,
        bom.material_id,
        plannedScaled,
        baseActualScaled,
        additionalScaled,
        damagedScaled,
        matWastageScaled,
        matVarianceScaled,
        matVariancePctBps,
        override?.reason?.trim() || ''
      );

      if (totalConsumedScaled > 0) {
        applyStockMovement(db, {
          itemId: bom.material_id,
          movementType: 'PRODUCTION_CONSUMPTION',
          direction: 'OUT',
          qtyScaled: totalConsumedScaled,
          referenceType: 'PRODUCTION_RUN',
          referenceId: runId,
          referenceNumber: runNumber,
          reason: `Consumed in ${runNumber} (${pr.request_number})${override?.reason ? `: ${override.reason}` : ''}`,
          actor,
          nowIso,
        });
      }
    }

    if (actualOutputScaled > 0) {
      applyStockMovement(db, {
        itemId: pr.product_id,
        movementType: 'PRODUCTION_OUTPUT',
        direction: 'IN',
        qtyScaled: actualOutputScaled,
        referenceType: 'PRODUCTION_RUN',
        referenceId: runId,
        referenceNumber: runNumber,
        reason: `Good finished goods posted from ${runNumber}${rejectedScaled > 0 ? ` (${fromScaledQty(rejectedScaled)} rejected excluded)` : ''}`,
        actor,
        nowIso,
      });
    }

    db.prepare(
      `UPDATE production_requests
       SET status = ?, assigned_supervisor_id = ?, supervisor_status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      finalStatus,
      actor.id,
      finalStatus === 'PARTIALLY_COMPLETED' ? 'Partially Completed' : 'Completed & Posted',
      nowIso,
      pr.id
    );

    db.prepare(`DELETE FROM production_run_drafts WHERE production_request_id = ?`).run(pr.id);

    db.prepare(
      `UPDATE material_shortage_queries SET status = 'RESOLVED', updated_at = ?
       WHERE production_request_id = ? AND status != 'RESOLVED'`
    ).run(nowIso, pr.id);

    recordAuditLog(
      db,
      actor,
      'PRODUCTION_RUN',
      runId,
      'POST_PRODUCTION_RUN',
      `${runNumber} posted: good output ${fromScaledQty(actualOutputScaled)} (planned ${fromScaledQty(pr.requested_qty_scaled)}, rejected ${fromScaledQty(rejectedScaled)}, yield ${(yieldPercentBps / 100).toFixed(1)}%)`
    );

    recordAuditLog(
      db,
      actor,
      'ORDER',
      pr.order_id,
      'FINISHED_STOCK_AVAILABLE',
      `${prodRow?.name || pr.product_id}: ${fromScaledQty(actualOutputScaled)} units posted by ${actor.fullName} (${runNumber}) — ready for Admin order review & dispatch`
    );

    return { id: runId, runNumber, deduplicated: false, status: finalStatus };
  });
}

export function listDispatches(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT d.*, o.order_number, o.customer_id, c.name AS customer_name, c.state AS customer_state,
              p.id AS product_id, p.name AS product_name, p.unit, p.selling_price_paise, p.gst_rate_bps,
              (SELECT inv.id FROM invoices inv WHERE inv.dispatch_id = d.id AND inv.payment_status != 'CANCELLED' ORDER BY inv.created_at DESC LIMIT 1) AS invoice_id,
              (SELECT inv.invoice_number FROM invoices inv WHERE inv.dispatch_id = d.id AND inv.payment_status != 'CANCELLED' ORDER BY inv.created_at DESC LIMIT 1) AS invoice_number
       FROM dispatches d
       JOIN orders o ON o.id = d.order_id
       JOIN customers c ON c.id = o.customer_id
       JOIN inventory_items p ON p.id = o.product_id
       ORDER BY d.dispatched_at DESC`
    )
    .all() as Array<{
    id: string;
    dispatch_number: string;
    order_id: string;
    order_number: string;
    customer_id: string;
    customer_name: string;
    customer_state: string;
    product_id: string;
    product_name: string;
    unit: string;
    selling_price_paise: number;
    gst_rate_bps: number;
    dispatched_qty_scaled: number;
    invoiced_qty_scaled: number;
    dispatched_at: string;
    dispatched_by: string;
    invoice_id: string | null;
    invoice_number: string | null;
    notes: string;
  }>;

  return rows.map((r) => {
    const remainingScaled = Math.max(0, r.dispatched_qty_scaled - r.invoiced_qty_scaled);
    return {
      id: r.id,
      dispatchNumber: r.dispatch_number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerState: r.customer_state,
      productId: r.product_id,
      productName: r.product_name,
      unit: r.unit,
      unitPrice: fromPaise(r.selling_price_paise),
      gstRate: fromGstBps(r.gst_rate_bps),
      dispatchedQuantity: fromScaledQty(r.dispatched_qty_scaled),
      invoicedQuantity: fromScaledQty(r.invoiced_qty_scaled),
      remainingQuantity: fromScaledQty(remainingScaled),
      isInvoiced: remainingScaled === 0,
      invoiceId: r.invoice_id || undefined,
      invoiceNumber: r.invoice_number || undefined,
      dispatchedAt: r.dispatched_at,
      dispatchedBy: r.dispatched_by,
      notes: r.notes || undefined,
    };
  });
}

export function recordDispatch(
  db: DatabaseSync,
  actor: AuthUser,
  input: { orderId: string; quantity: number; notes?: string; idempotencyKey?: string }
) {
  requireRole(actor, ['ADMIN']);

  return runInTransaction(db, () => {
    if (input.idempotencyKey) {
      const existing = db
        .prepare(`SELECT id, dispatch_number FROM dispatches WHERE idempotency_key = ?`)
        .get(input.idempotencyKey) as { id: string; dispatch_number: string } | undefined;
      if (existing) {
        return { id: existing.id, dispatchNumber: existing.dispatch_number, deduplicated: true };
      }
    }

    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ?`)
      .get(input.orderId) as
      | {
          id: string;
          order_number: string;
          product_id: string;
          requested_qty_scaled: number;
          dispatched_qty_scaled: number;
          status: string;
        }
      | undefined;

    if (!order) {
      throw new HttpError(404, `Order ${input.orderId} not found.`);
    }
    if (order.status !== 'APPROVED' && order.status !== 'PARTIALLY_DISPATCHED') {
      throw new HttpError(
        400,
        `Order ${order.order_number} must be APPROVED before recording dispatch (current status: ${order.status}).`
      );
    }

    const qtyScaled = toScaledQty(input.quantity);
    const remainingScaled = order.requested_qty_scaled - order.dispatched_qty_scaled;
    if (qtyScaled <= 0 || qtyScaled > remainingScaled) {
      throw new HttpError(
        400,
        `Dispatch quantity must be between 0 and remaining quantity (${fromScaledQty(remainingScaled)}).`
      );
    }

    const nowIso = new Date().toISOString();
    const dispatchNumber = nextSequenceNumber(db, 'dispatches', 'dispatch_number', 'DISP-2026-');
    const dispatchId = uid('disp');

    const orderItems = db
      .prepare(
        `SELECT id, product_id, requested_qty_scaled, dispatched_qty_scaled
         FROM order_items WHERE order_id = ? ORDER BY rowid ASC`
      )
      .all(order.id) as Array<{
      id: string;
      product_id: string;
      requested_qty_scaled: number;
      dispatched_qty_scaled: number;
    }>;

    const dispatchLineInserts: Array<{
      orderItemId: string | null;
      productId: string;
      qtyScaled: number;
    }> = [];

    if (orderItems.length > 1) {
      let remainingToAllocate = qtyScaled;
      for (const item of orderItems) {
        if (remainingToAllocate <= 0) break;
        const itemRemaining = item.requested_qty_scaled - item.dispatched_qty_scaled;
        if (itemRemaining <= 0) continue;
        const itemDispatch = Math.min(remainingToAllocate, itemRemaining);
        applyStockMovement(db, {
          itemId: item.product_id,
          movementType: 'DISPATCH',
          direction: 'OUT',
          qtyScaled: itemDispatch,
          referenceType: 'DISPATCH',
          referenceId: dispatchId,
          referenceNumber: dispatchNumber,
          reason: `Dispatched for order ${order.order_number}`,
          actor,
          nowIso,
        });
        db.prepare(
          `UPDATE order_items SET dispatched_qty_scaled = dispatched_qty_scaled + ? WHERE id = ?`
        ).run(itemDispatch, item.id);
        dispatchLineInserts.push({
          orderItemId: item.id,
          productId: item.product_id,
          qtyScaled: itemDispatch,
        });
        remainingToAllocate -= itemDispatch;
      }
    } else {
      applyStockMovement(db, {
        itemId: order.product_id,
        movementType: 'DISPATCH',
        direction: 'OUT',
        qtyScaled,
        referenceType: 'DISPATCH',
        referenceId: dispatchId,
        referenceNumber: dispatchNumber,
        reason: `Dispatched for order ${order.order_number}`,
        actor,
        nowIso,
      });
      if (orderItems.length === 1) {
        db.prepare(
          `UPDATE order_items SET dispatched_qty_scaled = dispatched_qty_scaled + ? WHERE id = ?`
        ).run(qtyScaled, orderItems[0].id);
      }
      dispatchLineInserts.push({
        orderItemId: orderItems[0]?.id ?? null,
        productId: order.product_id,
        qtyScaled,
      });
    }

    db.prepare(
      `INSERT INTO dispatches (id, dispatch_number, order_id, dispatched_qty_scaled, invoiced_qty_scaled, dispatched_at, dispatched_by, idempotency_key, notes)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(
      dispatchId,
      dispatchNumber,
      order.id,
      qtyScaled,
      nowIso,
      actor.fullName,
      input.idempotencyKey || null,
      input.notes?.trim() || ''
    );

    const insDispItem = db.prepare(
      `INSERT INTO dispatch_items (id, dispatch_id, order_item_id, product_id, dispatched_qty_scaled, invoiced_qty_scaled)
       VALUES (?, ?, ?, ?, ?, 0)`
    );
    for (const dl of dispatchLineInserts) {
      insDispItem.run(uid('di'), dispatchId, dl.orderItemId, dl.productId, dl.qtyScaled);
    }

    const newDispatchedTotal = order.dispatched_qty_scaled + qtyScaled;
    const nextOrderStatus =
      newDispatchedTotal >= order.requested_qty_scaled ? 'DISPATCHED' : 'PARTIALLY_DISPATCHED';

    db.prepare(
      `UPDATE orders SET dispatched_qty_scaled = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(newDispatchedTotal, nextOrderStatus, nowIso, order.id);

    db.prepare(
      `INSERT INTO order_audit_trail (id, order_id, timestamp, actor_user_id, actor_name, action, from_status, to_status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid('aud'),
      order.id,
      nowIso,
      actor.id,
      actor.fullName,
      `Dispatched ${fromScaledQty(qtyScaled)} units (${dispatchNumber}); finished-goods stock deducted`,
      order.status,
      nextOrderStatus,
      input.notes?.trim() || ''
    );

    recordAuditLog(
      db,
      actor,
      'DISPATCH',
      dispatchId,
      'RECORD_DISPATCH',
      `${dispatchNumber} dispatched ${fromScaledQty(qtyScaled)} for ${order.order_number}`
    );

    return { id: dispatchId, dispatchNumber, status: nextOrderStatus, deduplicated: false };
  });
}

export function resolveGstSupplyType(params: {
  customerState: string;
  customerStateCode?: string;
  customerGstin?: string;
  placeOfSupplyState?: string;
}): { supplyType: 'INTRA_STATE' | 'INTER_STATE'; placeOfSupplyState: string; placeOfSupplyCode: string } {
  const supplierStateCode =
    BUSINESS_PROFILE.gstin.slice(0, 2) || BUSINESS_PROFILE.stateCode || '33';
  const targetState = (params.placeOfSupplyState || params.customerState || '').trim();
  const mappedCodeFromState =
    Object.entries(INDIAN_STATE_CODES).find(
      ([name]) => name.toLowerCase() === targetState.toLowerCase()
    )?.[1] || '';

  const gstinPrefix =
    params.customerGstin && params.customerGstin.trim().length >= 2
      ? params.customerGstin.trim().slice(0, 2)
      : '';

  const effectiveCode =
    (params.placeOfSupplyState ? mappedCodeFromState : '') ||
    (gstinPrefix && /^\d{2}$/.test(gstinPrefix) ? gstinPrefix : '') ||
    (params.customerStateCode && params.customerStateCode !== '99' ? params.customerStateCode : '') ||
    mappedCodeFromState ||
    '99';

  const supplyType: 'INTRA_STATE' | 'INTER_STATE' =
    effectiveCode !== '99'
      ? effectiveCode === supplierStateCode
        ? 'INTRA_STATE'
        : 'INTER_STATE'
      : targetState.toLowerCase() === BUSINESS_PROFILE.state.toLowerCase()
        ? 'INTRA_STATE'
        : 'INTER_STATE';

  return {
    supplyType,
    placeOfSupplyState: targetState || BUSINESS_PROFILE.state,
    placeOfSupplyCode: effectiveCode,
  };
}

export function listInvoicesAndPayments(db: DatabaseSync) {
  const invoices = db
    .prepare(
      `SELECT inv.*, o.order_number, d.dispatch_number,
              c.name AS customer_name, c.code AS customer_code, c.gstin AS customer_gstin,
              c.billing_address, c.delivery_address, c.state AS customer_state, c.state_code AS customer_state_code
       FROM invoices inv
       JOIN orders o ON o.id = inv.order_id
       JOIN dispatches d ON d.id = inv.dispatch_id
       JOIN customers c ON c.id = inv.customer_id
       ORDER BY inv.invoice_date DESC, inv.invoice_number DESC`
    )
    .all() as Array<{
    id: string;
    invoice_number: string;
    order_id: string;
    order_number: string;
    customer_id: string;
    customer_name: string;
    customer_code: string;
    customer_gstin: string;
    billing_address: string;
    delivery_address: string;
    customer_state: string;
    customer_state_code: string;
    dispatch_id: string;
    dispatch_number: string;
    invoiced_qty_scaled: number;
    invoice_date: string;
    due_date: string;
    supply_type: 'INTRA_STATE' | 'INTER_STATE';
    place_of_supply_state: string;
    taxable_amount_paise: number;
    cgst_amount_paise: number;
    sgst_amount_paise: number;
    igst_amount_paise: number;
    total_gst_paise: number;
    total_amount_paise: number;
    paid_amount_paise: number;
    payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
    notes: string;
    created_by: string;
    created_at: string;
    cancelled_by: string;
    cancelled_at: string;
    cancellation_reason: string;
  }>;

  const lineStmt = db.prepare(`SELECT * FROM invoice_lines WHERE invoice_id = ?`);
  const payStmt = db.prepare(
    `SELECT p.*, COALESCE(pa.amount_paise, p.amount_paise) AS allocated_paise
     FROM payments p
     LEFT JOIN payment_allocations pa ON pa.payment_id = p.id AND pa.invoice_id = ?
     WHERE (pa.invoice_id = ? OR p.invoice_id = ?) AND COALESCE(p.status, 'POSTED') = 'POSTED'
     ORDER BY p.payment_date DESC, p.created_at DESC`
  );
  const allocStmt = db.prepare(
    `SELECT pa.invoice_id, pa.amount_paise, inv.invoice_number
     FROM payment_allocations pa
     JOIN invoices inv ON inv.id = pa.invoice_id
     WHERE pa.payment_id = ?`
  );

  const mappedInvoices = invoices.map((inv) => {
    const lines = lineStmt.all(inv.id) as Array<{
      id: string;
      product_id: string;
      product_name: string;
      sku: string;
      hsn_code: string;
      unit: string;
      quantity_scaled: number;
      unit_price_paise: number;
      gst_rate_bps: number;
      taxable_amount_paise: number;
      cgst_paise: number;
      sgst_paise: number;
      igst_paise: number;
      total_paise: number;
    }>;

    const payments = payStmt.all(inv.id, inv.id, inv.id) as Array<{
      id: string;
      payment_number: string;
      invoice_id: string | null;
      payment_date: string;
      allocated_paise: number;
      payment_mode: string;
      reference_number: string;
      recorded_by: string;
      notes: string;
      created_at: string;
    }>;

    const outstandingPaise =
      inv.payment_status === 'CANCELLED'
        ? 0
        : Math.max(0, inv.total_amount_paise - inv.paid_amount_paise);

    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      orderId: inv.order_id,
      orderNumber: inv.order_number,
      dispatchId: inv.dispatch_id,
      dispatchNumber: inv.dispatch_number,
      invoicedQuantity: fromScaledQty(
        inv.invoiced_qty_scaled > 0
          ? inv.invoiced_qty_scaled
          : lines.reduce((s, l) => s + l.quantity_scaled, 0)
      ),
      customerId: inv.customer_id,
      customerName: inv.customer_name,
      customerCode: inv.customer_code,
      customerGstin: inv.customer_gstin,
      billingAddress: inv.billing_address,
      deliveryAddress: inv.delivery_address,
      customerState: inv.customer_state,
      customerStateCode: inv.customer_state_code,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date || undefined,
      supplyType: inv.supply_type,
      placeOfSupplyState: inv.place_of_supply_state,
      taxableAmount: fromPaise(inv.taxable_amount_paise),
      cgstAmount: fromPaise(inv.cgst_amount_paise),
      sgstAmount: fromPaise(inv.sgst_amount_paise),
      igstAmount: fromPaise(inv.igst_amount_paise),
      totalGstAmount: fromPaise(inv.total_gst_paise),
      totalAmount: fromPaise(inv.total_amount_paise),
      amountReceived: fromPaise(inv.paid_amount_paise),
      outstandingBalance: fromPaise(outstandingPaise),
      paymentStatus: inv.payment_status,
      notes: inv.notes || undefined,
      createdBy: inv.created_by,
      createdAt: inv.created_at,
      cancelledBy: inv.cancelled_by || undefined,
      cancelledAt: inv.cancelled_at || undefined,
      cancellationReason: inv.cancellation_reason || undefined,
      businessProfile: BUSINESS_PROFILE,
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        productName: l.product_name,
        sku: l.sku,
        hsnCode: l.hsn_code,
        unit: l.unit,
        quantity: fromScaledQty(l.quantity_scaled),
        unitPrice: fromPaise(l.unit_price_paise),
        gstRate: fromGstBps(l.gst_rate_bps),
        taxableAmount: fromPaise(l.taxable_amount_paise),
        cgstAmount: fromPaise(l.cgst_paise),
        sgstAmount: fromPaise(l.sgst_paise),
        igstAmount: fromPaise(l.igst_paise),
        totalAmount: fromPaise(l.total_paise),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        paymentNumber: p.payment_number,
        invoiceId: inv.id,
        paymentDate: p.payment_date,
        amount: fromPaise(p.allocated_paise),
        paymentMode: p.payment_mode,
        referenceNumber: p.reference_number,
        recordedBy: p.recorded_by,
        notes: p.notes || undefined,
        createdAt: p.created_at,
      })),
    };
  });

  const allPayments = db
    .prepare(
      `SELECT p.*, inv.invoice_number, c.name AS customer_name
       FROM payments p
       LEFT JOIN invoices inv ON inv.id = p.invoice_id
       JOIN customers c ON c.id = p.customer_id
       ORDER BY p.payment_date DESC, p.created_at DESC`
    )
    .all() as Array<{
    id: string;
    payment_number: string;
    invoice_id: string | null;
    invoice_number: string | null;
    customer_id: string;
    customer_name: string;
    payment_date: string;
    amount_paise: number;
    unallocated_paise: number;
    payment_mode: string;
    reference_number: string;
    status: 'POSTED' | 'REVERSED';
    recorded_by: string;
    notes: string;
    created_at: string;
    reversed_by: string;
    reversed_at: string;
    reversal_reason: string;
  }>;

  return {
    businessProfile: BUSINESS_PROFILE,
    invoices: mappedInvoices,
    payments: allPayments.map((p) => {
      const allocs = allocStmt.all(p.id) as Array<{
        invoice_id: string;
        amount_paise: number;
        invoice_number: string;
      }>;
      const invoiceNumbers =
        allocs.length > 0
          ? allocs.map((a) => a.invoice_number).join(', ')
          : p.invoice_number || '';
      return {
        id: p.id,
        paymentNumber: p.payment_number,
        invoiceId: p.invoice_id || allocs[0]?.invoice_id || '',
        invoiceNumber: invoiceNumbers,
        customerId: p.customer_id,
        customerName: p.customer_name,
        paymentDate: p.payment_date,
        amount: fromPaise(p.amount_paise),
        unallocatedAmount: fromPaise(p.unallocated_paise ?? 0),
        paymentMode: p.payment_mode,
        referenceNumber: p.reference_number,
        status: p.status || 'POSTED',
        recordedBy: p.recorded_by,
        notes: p.notes || undefined,
        createdAt: p.created_at,
        reversedBy: p.reversed_by || undefined,
        reversedAt: p.reversed_at || undefined,
        reversalReason: p.reversal_reason || undefined,
        allocations: allocs.map((a) => ({
          invoiceId: a.invoice_id,
          invoiceNumber: a.invoice_number,
          amount: fromPaise(a.amount_paise),
        })),
      };
    }),
    dispatchesReadyForInvoicing: listDispatches(db).filter((d) => !d.isInvoiced),
  };
}

/**
 * Accountant ONLY: Compute invoice lines & GST breakdown for a dispatch without creating the invoice.
 */
export function buildDispatchInvoiceComputation(
  db: DatabaseSync,
  dispatchId: string,
  options?: { quantity?: number; placeOfSupplyState?: string }
) {
  const dispatch = db
    .prepare(
      `SELECT d.*, o.customer_id, o.product_id, o.order_number,
              c.name AS customer_name, c.code AS customer_code, c.gstin AS customer_gstin,
              c.billing_address, c.delivery_address,
              c.state AS customer_state, c.state_code AS customer_state_code,
              p.name AS product_name, p.sku, p.hsn_code, p.unit, p.selling_price_paise, p.gst_rate_bps
       FROM dispatches d
       JOIN orders o ON o.id = d.order_id
       JOIN customers c ON c.id = o.customer_id
       JOIN inventory_items p ON p.id = o.product_id
       WHERE d.id = ?`
    )
    .get(dispatchId) as
    | {
        id: string;
        dispatch_number: string;
        order_id: string;
        order_number: string;
        customer_id: string;
        customer_name: string;
        customer_code: string;
        customer_gstin: string;
        billing_address: string;
        delivery_address: string;
        customer_state: string;
        customer_state_code: string;
        product_id: string;
        product_name: string;
        sku: string;
        hsn_code: string;
        unit: string;
        selling_price_paise: number;
        gst_rate_bps: number;
        dispatched_qty_scaled: number;
        invoiced_qty_scaled: number;
        dispatched_at: string;
      }
    | undefined;

  if (!dispatch) {
    throw new HttpError(404, `Dispatch ${dispatchId} not found.`);
  }

  const remainingScaled = Math.max(0, dispatch.dispatched_qty_scaled - dispatch.invoiced_qty_scaled);
  if (remainingScaled <= 0) {
    throw new HttpError(
      409,
      `Dispatch ${dispatch.dispatch_number} has already been fully invoiced.`
    );
  }

  const requestedInvoiceScaled =
    options?.quantity !== undefined ? toScaledQty(options.quantity) : remainingScaled;
  if (requestedInvoiceScaled <= 0 || requestedInvoiceScaled > remainingScaled) {
    throw new HttpError(
      400,
      `Invoice quantity must be between 0 and uninvoiced dispatch quantity (${fromScaledQty(remainingScaled)}).`
    );
  }

  const pos = resolveGstSupplyType({
    customerState: dispatch.customer_state,
    customerStateCode: dispatch.customer_state_code,
    customerGstin: dispatch.customer_gstin,
    placeOfSupplyState: options?.placeOfSupplyState,
  });

  const dispatchLines = db
    .prepare(
      `SELECT di.id, di.product_id, di.dispatched_qty_scaled, di.invoiced_qty_scaled,
              p.name AS product_name, p.sku, p.hsn_code, p.unit, p.selling_price_paise, p.gst_rate_bps
       FROM dispatch_items di
       JOIN inventory_items p ON p.id = di.product_id
       WHERE di.dispatch_id = ? AND (di.dispatched_qty_scaled - di.invoiced_qty_scaled) > 0
       ORDER BY di.rowid ASC`
    )
    .all(dispatch.id) as Array<{
    id: string;
    product_id: string;
    dispatched_qty_scaled: number;
    invoiced_qty_scaled: number;
    product_name: string;
    sku: string;
    hsn_code: string;
    unit: string;
    selling_price_paise: number;
    gst_rate_bps: number;
  }>;

  const lineSpecs: Array<{
    dispatchItemId?: string;
    productId: string;
    productName: string;
    sku: string;
    hsnCode: string;
    unit: string;
    qtyScaled: number;
    unitPricePaise: number;
    gstRateBps: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalGstPaise: number;
    totalPaise: number;
  }> = [];

  if (dispatchLines.length > 0) {
    let remainingToAllocate = requestedInvoiceScaled;
    for (const dl of dispatchLines) {
      if (remainingToAllocate <= 0) break;
      const lineRem = dl.dispatched_qty_scaled - dl.invoiced_qty_scaled;
      if (lineRem <= 0) continue;
      const takeScaled = Math.min(remainingToAllocate, lineRem);
      const taxable = calcTaxablePaise(takeScaled, dl.selling_price_paise);
      const gstLine = calcGstPaise(taxable, dl.gst_rate_bps, pos.supplyType);
      lineSpecs.push({
        dispatchItemId: dl.id,
        productId: dl.product_id,
        productName: dl.product_name,
        sku: dl.sku,
        hsnCode: dl.hsn_code,
        unit: dl.unit,
        qtyScaled: takeScaled,
        unitPricePaise: dl.selling_price_paise,
        gstRateBps: dl.gst_rate_bps,
        taxablePaise: taxable,
        ...gstLine,
        totalPaise: taxable + gstLine.totalGstPaise,
      });
      remainingToAllocate -= takeScaled;
    }
  } else {
    const taxable = calcTaxablePaise(requestedInvoiceScaled, dispatch.selling_price_paise);
    const gstLine = calcGstPaise(taxable, dispatch.gst_rate_bps, pos.supplyType);
    lineSpecs.push({
      productId: dispatch.product_id,
      productName: dispatch.product_name,
      sku: dispatch.sku,
      hsnCode: dispatch.hsn_code,
      unit: dispatch.unit,
      qtyScaled: requestedInvoiceScaled,
      unitPricePaise: dispatch.selling_price_paise,
      gstRateBps: dispatch.gst_rate_bps,
      taxablePaise: taxable,
      ...gstLine,
      totalPaise: taxable + gstLine.totalGstPaise,
    });
  }

  const taxablePaise = lineSpecs.reduce((s, l) => s + l.taxablePaise, 0);
  const cgstTotalPaise = lineSpecs.reduce((s, l) => s + l.cgstPaise, 0);
  const sgstTotalPaise = lineSpecs.reduce((s, l) => s + l.sgstPaise, 0);
  const igstTotalPaise = lineSpecs.reduce((s, l) => s + l.igstPaise, 0);
  const totalGstPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise;
  const totalPaise = taxablePaise + totalGstPaise;

  return {
    dispatch,
    pos,
    remainingScaled,
    requestedInvoiceScaled,
    lineSpecs,
    taxablePaise,
    cgstTotalPaise,
    sgstTotalPaise,
    igstTotalPaise,
    totalGstPaise,
    totalPaise,
  };
}

/**
 * Accountant ONLY: Generate GST invoice strictly from uninvoiced dispatched quantity.
 */
export function createInvoiceFromDispatchByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    dispatchId: string;
    quantity?: number;
    placeOfSupplyState?: string;
    dueDate?: string;
    notes?: string;
    idempotencyKey?: string;
  }
) {
  requireRole(actor, ['ACCOUNTANT']);

  return runInTransaction(db, () => {
    if (input.idempotencyKey) {
      const dupKey = db
        .prepare(`SELECT id, invoice_number FROM invoices WHERE idempotency_key = ?`)
        .get(input.idempotencyKey) as { id: string; invoice_number: string } | undefined;
      if (dupKey) {
        return { id: dupKey.id, invoiceNumber: dupKey.invoice_number, deduplicated: true };
      }
    }

    const comp = buildDispatchInvoiceComputation(db, input.dispatchId, {
      quantity: input.quantity,
      placeOfSupplyState: input.placeOfSupplyState,
    });
    const {
      dispatch,
      pos,
      requestedInvoiceScaled,
      lineSpecs,
      taxablePaise,
      cgstTotalPaise,
      sgstTotalPaise,
      igstTotalPaise,
      totalGstPaise,
      totalPaise,
    } = comp;

    const nowIso = new Date().toISOString();
    const invoiceDate = nowIso.slice(0, 10);
    const defaultDue = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const invoiceNumber = nextSequenceNumber(db, 'invoices', 'invoice_number', 'INV-2026-');
    const invoiceId = uid('inv');

    db.prepare(
      `INSERT INTO invoices (
        id, invoice_number, order_id, customer_id, dispatch_id, invoiced_qty_scaled,
        invoice_date, due_date, supply_type, place_of_supply_state, taxable_amount_paise,
        cgst_amount_paise, sgst_amount_paise, igst_amount_paise, total_gst_paise, total_amount_paise,
        paid_amount_paise, payment_status, notes, idempotency_key, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UNPAID', ?, ?, ?, ?)`
    ).run(
      invoiceId,
      invoiceNumber,
      dispatch.order_id,
      dispatch.customer_id,
      dispatch.id,
      requestedInvoiceScaled,
      invoiceDate,
      input.dueDate?.trim() || defaultDue,
      pos.supplyType,
      pos.placeOfSupplyState,
      taxablePaise,
      cgstTotalPaise,
      sgstTotalPaise,
      igstTotalPaise,
      totalGstPaise,
      totalPaise,
      input.notes?.trim() || '',
      input.idempotencyKey || null,
      actor.fullName,
      nowIso
    );

    const insertInvLine = db.prepare(
      `INSERT INTO invoice_lines (
        id, invoice_id, product_id, product_name, sku, hsn_code, unit,
        quantity_scaled, unit_price_paise, gst_rate_bps,
        taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updDispLine = db.prepare(
      `UPDATE dispatch_items SET invoiced_qty_scaled = invoiced_qty_scaled + ? WHERE id = ?`
    );

    for (const line of lineSpecs) {
      insertInvLine.run(
        uid('invl'),
        invoiceId,
        line.productId,
        line.productName,
        line.sku,
        line.hsnCode,
        line.unit,
        line.qtyScaled,
        line.unitPricePaise,
        line.gstRateBps,
        line.taxablePaise,
        line.cgstPaise,
        line.sgstPaise,
        line.igstPaise,
        line.totalPaise
      );
      if (line.dispatchItemId) {
        updDispLine.run(line.qtyScaled, line.dispatchItemId);
      }
    }

    db.prepare(`UPDATE dispatches SET invoiced_qty_scaled = invoiced_qty_scaled + ? WHERE id = ?`).run(
      requestedInvoiceScaled,
      dispatch.id
    );

    recordAuditLog(
      db,
      actor,
      'INVOICE',
      invoiceId,
      'GENERATE_INVOICE',
      `${invoiceNumber} generated for ${dispatch.order_number} / ${dispatch.dispatch_number} (${fromScaledQty(requestedInvoiceScaled)} units, ${pos.supplyType})`
    );

    return { id: invoiceId, invoiceNumber, deduplicated: false };
  });
}

/**
 * Accountant ONLY: Record full or partial payment against an invoice.
 */
export function recordPaymentByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    invoiceId: string;
    amount: number;
    paymentMode: string;
    referenceNumber?: string;
    paymentDate?: string;
    notes?: string;
    idempotencyKey?: string;
  }
) {
  requireRole(actor, ['ACCOUNTANT']);

  return runInTransaction(db, () => {
    if (input.idempotencyKey) {
      const existing = db
        .prepare(`SELECT id, payment_number FROM payments WHERE idempotency_key = ?`)
        .get(input.idempotencyKey) as { id: string; payment_number: string } | undefined;
      if (existing) {
        return { id: existing.id, paymentNumber: existing.payment_number, deduplicated: true };
      }
    }

    const inv = db
      .prepare(`SELECT * FROM invoices WHERE id = ?`)
      .get(input.invoiceId) as
      | {
          id: string;
          invoice_number: string;
          customer_id: string;
          total_amount_paise: number;
          paid_amount_paise: number;
          payment_status: string;
        }
      | undefined;

    if (!inv) {
      throw new HttpError(404, `Invoice ${input.invoiceId} not found.`);
    }
    if (inv.payment_status === 'CANCELLED') {
      throw new HttpError(400, `Cannot record payment against cancelled invoice ${inv.invoice_number}.`);
    }

    const amountPaise = toPaise(input.amount);
    const outstandingPaise = inv.total_amount_paise - inv.paid_amount_paise;
    if (amountPaise <= 0) {
      throw new HttpError(400, 'Payment amount must be greater than zero.');
    }
    if (amountPaise > outstandingPaise) {
      throw new HttpError(
        400,
        `Payment ₹${fromPaise(amountPaise)} exceeds outstanding balance ₹${fromPaise(outstandingPaise)}.`
      );
    }

    const nowIso = new Date().toISOString();
    const paymentNumber = nextSequenceNumber(db, 'payments', 'payment_number', 'PAY-2026-');
    const paymentId = uid('pay');

    db.prepare(
      `INSERT INTO payments (
        id, payment_number, invoice_id, customer_id, payment_date, amount_paise, unallocated_paise,
        payment_mode, reference_number, status, recorded_by, notes, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'POSTED', ?, ?, ?, ?)`
    ).run(
      paymentId,
      paymentNumber,
      inv.id,
      inv.customer_id,
      input.paymentDate || nowIso.slice(0, 10),
      amountPaise,
      input.paymentMode.trim() || 'Bank Transfer',
      input.referenceNumber?.trim() || '',
      actor.fullName,
      input.notes?.trim() || '',
      input.idempotencyKey || null,
      nowIso
    );

    db.prepare(
      `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uid('pal'), paymentId, inv.id, amountPaise, nowIso);

    const newPaidPaise = inv.paid_amount_paise + amountPaise;
    const nextStatus =
      newPaidPaise >= inv.total_amount_paise ? 'PAID' : 'PARTIALLY_PAID';

    db.prepare(
      `UPDATE invoices SET paid_amount_paise = ?, payment_status = ? WHERE id = ?`
    ).run(newPaidPaise, nextStatus, inv.id);

    recordAuditLog(
      db,
      actor,
      'PAYMENT',
      paymentId,
      'RECORD_PAYMENT',
      `${paymentNumber} recorded ₹${fromPaise(amountPaise)} for ${inv.invoice_number} (${nextStatus})`
    );

    return { id: paymentId, paymentNumber, paymentStatus: nextStatus, deduplicated: false };
  });
}

// ---------------------------------------------------------------------------
// Management Master Data (Product Catalogue + BOM, Customers, Suppliers, Users)
// ---------------------------------------------------------------------------

export function listProductsWithBom(db: DatabaseSync) {
  const products = listInventoryItems(db).filter((i) => i.category === 'FINISHED_GOOD');
  const bomStmt = db.prepare(
    `SELECT b.id, b.material_id, b.quantity_per_unit_scaled,
            m.name AS material_name, m.sku AS material_sku, m.unit, m.category
     FROM bom_items b
     JOIN inventory_items m ON m.id = b.material_id
     WHERE b.product_id = ?
     ORDER BY m.category, m.name`
  );

  return products.map((p) => ({
    ...p,
    bomItems: (
      bomStmt.all(p.id) as Array<{
        id: string;
        material_id: string;
        material_name: string;
        material_sku: string;
        unit: string;
        category: string;
        quantity_per_unit_scaled: number;
      }>
    ).map((b) => ({
      id: b.id,
      materialId: b.material_id,
      materialName: b.material_name,
      materialSku: b.material_sku,
      unit: b.unit,
      category: b.category,
      quantityPerUnit: fromScaledQty(b.quantity_per_unit_scaled),
    })),
  }));
}

export function upsertProductAndBom(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    id?: string;
    sku: string;
    name: string;
    packSize: string;
    sellingPrice: number;
    gstRate: number;
    hsnCode: string;
    imageUrl?: string;
    unit: string;
    reorderLevel: number;
    isActive?: boolean;
    bomItems: Array<{ materialId: string; quantityPerUnit: number }>;
  }
) {
  requireRole(actor, ['ADMIN']);

  if (!input.sku?.trim() || !input.name?.trim() || !input.unit?.trim() || !input.hsnCode?.trim()) {
    throw new HttpError(400, 'SKU, product name, unit of measurement, and HSN code are required.');
  }

  const normalizedImageUrl = normalizeProductImageUrl(input.imageUrl);

  return runInTransaction(db, () => {
    const nowIso = new Date().toISOString();
    const productId = input.id || uid('prod');
    const isEdit = Boolean(input.id);
    let previousImageUrl = '';
    let nextBomVersion = 'v1.0';

    if (isEdit) {
      const existing = db
        .prepare(
          `SELECT id, image_url, bom_version FROM inventory_items WHERE id = ? AND category = 'FINISHED_GOOD'`
        )
        .get(productId) as { id: string; image_url: string; bom_version: string } | undefined;
      if (!existing) {
        throw new HttpError(404, `Product ${productId} not found.`);
      }
      previousImageUrl = existing.image_url || '';

      const existingBom = db
        .prepare(`SELECT material_id, quantity_per_unit_scaled FROM bom_items WHERE product_id = ? ORDER BY material_id`)
        .all(productId) as Array<{ material_id: string; quantity_per_unit_scaled: number }>;
      const nextBomComparable = (input.bomItems ?? [])
        .map((b) => `${b.materialId}:${toScaledQty(b.quantityPerUnit)}`)
        .sort()
        .join('|');
      const prevBomComparable = existingBom
        .map((b) => `${b.material_id}:${b.quantity_per_unit_scaled}`)
        .sort()
        .join('|');
      nextBomVersion = existing.bom_version || 'v1.0';
      if (nextBomComparable !== prevBomComparable) {
        const match = /^v(\d+)\.(\d+)$/.exec(nextBomVersion);
        if (match) {
          nextBomVersion = `v${match[1]}.${Number(match[2]) + 1}`;
        } else {
          nextBomVersion = `${nextBomVersion}.1`;
        }
      }

      db.prepare(
        `UPDATE inventory_items
         SET sku = ?, name = ?, pack_size = ?, selling_price_paise = ?, gst_rate_bps = ?,
             hsn_code = ?, image_url = ?, unit = ?, reorder_level_scaled = ?, bom_version = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        input.sku.trim(),
        input.name.trim(),
        input.packSize.trim(),
        toPaise(input.sellingPrice),
        toGstBps(input.gstRate),
        input.hsnCode.trim(),
        normalizedImageUrl,
        input.unit.trim(),
        toScaledQty(input.reorderLevel),
        nextBomVersion,
        input.isActive === false ? 0 : 1,
        nowIso,
        productId
      );
    } else {
      // Adding a product MUST NOT create inventory or stock; balance initializes at 0!
      db.prepare(
        `INSERT INTO inventory_items (
          id, sku, name, category, unit, pack_size, selling_price_paise,
          gst_rate_bps, hsn_code, image_url, reorder_level_scaled, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, 'FINISHED_GOOD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        productId,
        input.sku.trim(),
        input.name.trim(),
        input.unit.trim(),
        input.packSize.trim(),
        toPaise(input.sellingPrice),
        toGstBps(input.gstRate),
        input.hsnCode.trim(),
        normalizedImageUrl,
        toScaledQty(input.reorderLevel),
        input.isActive === false ? 0 : 1,
        nowIso,
        nowIso
      );

      db.prepare(
        `INSERT INTO stock_balances (item_id, quantity_scaled, updated_at) VALUES (?, 0, ?)`
      ).run(productId, nowIso);
    }

    // Replace BOM items
    db.prepare(`DELETE FROM bom_items WHERE product_id = ?`).run(productId);
    const insertBom = db.prepare(
      `INSERT INTO bom_items (id, product_id, material_id, quantity_per_unit_scaled) VALUES (?, ?, ?, ?)`
    );
    for (const line of input.bomItems ?? []) {
      const mat = db
        .prepare(`SELECT id, category FROM inventory_items WHERE id = ?`)
        .get(line.materialId) as { id: string; category: string } | undefined;
      if (!mat || mat.category === 'FINISHED_GOOD') {
        throw new HttpError(400, 'BOM components must be raw or packaging materials.');
      }
      const qScaled = toScaledQty(line.quantityPerUnit);
      if (qScaled <= 0) {
        throw new HttpError(400, 'BOM quantity per unit must be greater than zero.');
      }
      insertBom.run(uid('bom'), productId, mat.id, qScaled);
    }

    if (previousImageUrl && previousImageUrl !== normalizedImageUrl) {
      cleanupUnreferencedUploadedImage(db, previousImageUrl);
    }

    recordAuditLog(
      db,
      actor,
      'PRODUCT',
      productId,
      isEdit ? 'UPDATE_PRODUCT' : 'CREATE_PRODUCT',
      `${input.sku.trim()} (${input.name.trim()})`
    );

    return { id: productId };
  });
}

export function setProductActiveStatus(
  db: DatabaseSync,
  actor: AuthUser,
  productId: string,
  isActive: boolean
) {
  requireRole(actor, ['ADMIN']);
  const nowIso = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE inventory_items SET is_active = ?, updated_at = ? WHERE id = ? AND category = 'FINISHED_GOOD'`
    )
    .run(isActive ? 1 : 0, nowIso, productId);
  if (res.changes === 0) throw new HttpError(404, 'Product not found.');
  recordAuditLog(db, actor, 'PRODUCT', productId, isActive ? 'ACTIVATE' : 'DEACTIVATE', '');
  return { id: productId, isActive };
}

export function listCustomers(db: DatabaseSync) {
  const rows = db
    .prepare(`SELECT * FROM customers ORDER BY is_active DESC, name`)
    .all() as Array<{
    id: string;
    code: string;
    name: string;
    contact_person: string;
    phone: string;
    email: string;
    gstin: string;
    billing_address: string;
    delivery_address: string;
    state: string;
    state_code: string;
    is_active: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    contactPerson: c.contact_person,
    phone: c.phone,
    email: c.email,
    gstin: c.gstin,
    billingAddress: c.billing_address,
    deliveryAddress: c.delivery_address,
    state: c.state,
    stateCode: c.state_code,
    isActive: Boolean(c.is_active),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
}

export function upsertCustomer(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    id?: string;
    code: string;
    name: string;
    contactPerson: string;
    phone: string;
    email?: string;
    gstin?: string;
    billingAddress: string;
    deliveryAddress: string;
    state: string;
    stateCode?: string;
    isActive?: boolean;
  }
) {
  requireRole(actor, ['ADMIN']);
  if (!input.code?.trim() || !input.name?.trim() || !input.state?.trim()) {
    throw new HttpError(400, 'Customer code, name, and state are required.');
  }

  const stateTrimmed = input.state.trim();
  const stateCode = input.stateCode?.trim() || INDIAN_STATE_CODES[stateTrimmed] || '99';
  const nowIso = new Date().toISOString();
  const id = input.id || uid('cust');
  const isEdit = Boolean(input.id);

  if (isEdit) {
    const res = db
      .prepare(
        `UPDATE customers
         SET code = ?, name = ?, contact_person = ?, phone = ?, email = ?, gstin = ?,
             billing_address = ?, delivery_address = ?, state = ?, state_code = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.code.trim(),
        input.name.trim(),
        input.contactPerson.trim(),
        input.phone.trim(),
        input.email?.trim() || '',
        input.gstin?.trim().toUpperCase() || '',
        input.billingAddress.trim(),
        input.deliveryAddress.trim(),
        stateTrimmed,
        stateCode,
        input.isActive === false ? 0 : 1,
        nowIso,
        id
      );
    if (res.changes === 0) throw new HttpError(404, 'Customer not found.');
  } else {
    db.prepare(
      `INSERT INTO customers (
        id, code, name, contact_person, phone, email, gstin,
        billing_address, delivery_address, state, state_code, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.code.trim(),
      input.name.trim(),
      input.contactPerson.trim(),
      input.phone.trim(),
      input.email?.trim() || '',
      input.gstin?.trim().toUpperCase() || '',
      input.billingAddress.trim(),
      input.deliveryAddress.trim(),
      stateTrimmed,
      stateCode,
      input.isActive === false ? 0 : 1,
      nowIso,
      nowIso
    );
  }

  recordAuditLog(
    db,
    actor,
    'CUSTOMER',
    id,
    isEdit ? 'UPDATE_CUSTOMER' : 'CREATE_CUSTOMER',
    `${input.code.trim()} (${input.name.trim()})`
  );
  return { id };
}

export function setCustomerActiveStatus(
  db: DatabaseSync,
  actor: AuthUser,
  customerId: string,
  isActive: boolean
) {
  requireRole(actor, ['ADMIN']);
  const res = db
    .prepare(`UPDATE customers SET is_active = ?, updated_at = ? WHERE id = ?`)
    .run(isActive ? 1 : 0, new Date().toISOString(), customerId);
  if (res.changes === 0) throw new HttpError(404, 'Customer not found.');
  recordAuditLog(db, actor, 'CUSTOMER', customerId, isActive ? 'ACTIVATE' : 'DEACTIVATE', '');
  return { id: customerId, isActive };
}

export function listSuppliers(db: DatabaseSync) {
  const rows = db
    .prepare(`SELECT * FROM suppliers ORDER BY is_active DESC, name`)
    .all() as Array<{
    id: string;
    code: string;
    name: string;
    contact_person: string;
    phone: string;
    email: string;
    gstin: string;
    address: string;
    state: string;
    is_active: number;
    created_at: string;
    updated_at: string;
  }>;

  const matStmt = db.prepare(
    `SELECT ii.id, ii.sku, ii.name, ii.category, ii.unit
     FROM supplier_materials sm
     JOIN inventory_items ii ON ii.id = sm.item_id
     WHERE sm.supplier_id = ?
     ORDER BY ii.name`
  );
  const poStmt = db.prepare(
    `SELECT id, po_number, status, order_date FROM purchase_orders WHERE supplier_id = ? ORDER BY order_date DESC`
  );
  const grnStmt = db.prepare(
    `SELECT id, receipt_number, received_date FROM purchase_receipts WHERE supplier_id = ? ORDER BY received_date DESC`
  );

  return rows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    contactPerson: s.contact_person,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    address: s.address,
    state: s.state,
    isActive: Boolean(s.is_active),
    suppliedMaterials: matStmt.all(s.id) as Array<{
      id: string;
      sku: string;
      name: string;
      category: string;
      unit: string;
    }>,
    purchaseOrders: poStmt.all(s.id) as Array<{
      id: string;
      po_number: string;
      status: string;
      order_date: string;
    }>,
    purchaseReceipts: grnStmt.all(s.id) as Array<{
      id: string;
      receipt_number: string;
      received_date: string;
    }>,
  }));
}

export function upsertSupplier(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    id?: string;
    code: string;
    name: string;
    contactPerson: string;
    phone: string;
    email?: string;
    gstin?: string;
    address: string;
    state: string;
    isActive?: boolean;
    materialIds: string[];
  }
) {
  requireRole(actor, ['ADMIN']);
  if (!input.code?.trim() || !input.name?.trim()) {
    throw new HttpError(400, 'Supplier code and name are required.');
  }

  return runInTransaction(db, () => {
    const nowIso = new Date().toISOString();
    const id = input.id || uid('sup');
    const isEdit = Boolean(input.id);

    if (isEdit) {
      const res = db
        .prepare(
          `UPDATE suppliers
           SET code = ?, name = ?, contact_person = ?, phone = ?, email = ?, gstin = ?, address = ?, state = ?, is_active = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.code.trim(),
          input.name.trim(),
          input.contactPerson.trim(),
          input.phone.trim(),
          input.email?.trim() || '',
          input.gstin?.trim().toUpperCase() || '',
          input.address.trim(),
          input.state.trim(),
          input.isActive === false ? 0 : 1,
          nowIso,
          id
        );
      if (res.changes === 0) throw new HttpError(404, 'Supplier not found.');
    } else {
      db.prepare(
        `INSERT INTO suppliers (
          id, code, name, contact_person, phone, email, gstin, address, state, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.code.trim(),
        input.name.trim(),
        input.contactPerson.trim(),
        input.phone.trim(),
        input.email?.trim() || '',
        input.gstin?.trim().toUpperCase() || '',
        input.address.trim(),
        input.state.trim(),
        input.isActive === false ? 0 : 1,
        nowIso,
        nowIso
      );
    }

    db.prepare(`DELETE FROM supplier_materials WHERE supplier_id = ?`).run(id);
    const insMat = db.prepare(
      `INSERT INTO supplier_materials (supplier_id, item_id) VALUES (?, ?)`
    );
    for (const matId of input.materialIds ?? []) {
      const item = db
        .prepare(`SELECT id, category FROM inventory_items WHERE id = ?`)
        .get(matId) as { id: string; category: string } | undefined;
      if (!item || item.category === 'FINISHED_GOOD') {
        throw new HttpError(400, 'Suppliers can only be linked to raw or packaging materials.');
      }
      insMat.run(id, matId);
    }

    recordAuditLog(
      db,
      actor,
      'SUPPLIER',
      id,
      isEdit ? 'UPDATE_SUPPLIER' : 'CREATE_SUPPLIER',
      `${input.code.trim()} (${input.name.trim()})`
    );

    return { id };
  });
}

// ---------------------------------------------------------------------------
// User Management (STRICTLY OWNER_SUPER_ADMIN ONLY)
// ---------------------------------------------------------------------------

export function listUsers(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['ADMIN']);
  const rows = db
    .prepare(
      `SELECT id, username, full_name, email, role, is_active, must_reset_password, created_at, updated_at
       FROM users
       ORDER BY created_at ASC`
    )
    .all() as Array<{
    id: string;
    username: string;
    full_name: string;
    email: string;
    role: UserRole;
    is_active: number;
    must_reset_password: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    isActive: Boolean(u.is_active),
    mustResetPassword: Boolean(u.must_reset_password),
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  }));
}

export function createUserByOwner(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    username: string;
    fullName: string;
    email: string;
    role: UserRole;
    password: string;
  }
) {
  requireRole(actor, ['ADMIN']);
  if (!input.username?.trim() || !input.fullName?.trim() || !input.email?.trim() || !input.password) {
    throw new HttpError(400, 'Username, full name, email, and initial password are required.');
  }
  const nowIso = new Date().toISOString();
  const id = uid('usr');
  db.prepare(
    `INSERT INTO users (id, username, full_name, email, role, password_hash, is_active, must_reset_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  ).run(
    id,
    input.username.trim().toLowerCase(),
    input.fullName.trim(),
    input.email.trim().toLowerCase(),
    input.role,
    hashPassword(input.password),
    nowIso,
    nowIso
  );

  recordAuditLog(db, actor, 'USER', id, 'CREATE_USER', `${input.email} (${input.role})`);
  return { id };
}

export function updateUserByOwner(
  db: DatabaseSync,
  actor: AuthUser,
  userId: string,
  input: { role?: UserRole; isActive?: boolean; fullName?: string }
) {
  requireRole(actor, ['ADMIN']);
  const target = db
    .prepare(`SELECT id, role, is_active, full_name FROM users WHERE id = ?`)
    .get(userId) as
    | { id: string; role: UserRole; is_active: number; full_name: string }
    | undefined;
  if (!target) throw new HttpError(404, 'User not found.');
  if (target.id === actor.id && input.isActive === false) {
    throw new HttpError(400, 'You cannot deactivate your own Owner account.');
  }

  const nextRole = input.role ?? target.role;
  const nextActive = input.isActive === undefined ? Boolean(target.is_active) : input.isActive;
  const nextName = input.fullName?.trim() || target.full_name;
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE users SET role = ?, is_active = ?, full_name = ?, updated_at = ? WHERE id = ?`
  ).run(nextRole, nextActive ? 1 : 0, nextName, nowIso, userId);

  if (!nextActive) {
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }

  recordAuditLog(
    db,
    actor,
    'USER',
    userId,
    'UPDATE_USER',
    `role=${nextRole}, active=${nextActive}`
  );
  return { id: userId, role: nextRole, isActive: nextActive };
}

export function resetUserAccessByOwner(
  db: DatabaseSync,
  actor: AuthUser,
  userId: string,
  temporaryPassword?: string
) {
  requireRole(actor, ['ADMIN']);
  const target = db.prepare(`SELECT id, email FROM users WHERE id = ?`).get(userId) as
    | { id: string; email: string }
    | undefined;
  if (!target) throw new HttpError(404, 'User not found.');

  const tempPass = temporaryPassword?.trim() || `Nitt@${crypto.randomInt(1000, 9999)}`;
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE users SET password_hash = ?, must_reset_password = 1, updated_at = ? WHERE id = ?`
  ).run(hashPassword(tempPass), nowIso, userId);
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);

  recordAuditLog(db, actor, 'USER', userId, 'RESET_ACCESS', `Sessions cleared for ${target.email}`);
  return { id: userId, temporaryPassword: tempPass };
}

// ---------------------------------------------------------------------------
// Salesman Dashboard & Order Creation (Strictly Scoped; Zero Stock Visibility)
// ---------------------------------------------------------------------------

/**
 * Returns active finished-goods catalogue for Salesmen WITHOUT any inventory balances,
 * reorder levels, movement counts, or BOM/raw-material information.
 */
export function listSalesmanCatalogue(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['SALESMAN']);
  const rows = db
    .prepare(
      `SELECT id, sku, name, pack_size, unit, selling_price_paise, gst_rate_bps, hsn_code, image_url
       FROM inventory_items
       WHERE category = 'FINISHED_GOOD' AND is_active = 1
       ORDER BY name ASC`
    )
    .all() as Array<{
    id: string;
    sku: string;
    name: string;
    pack_size: string;
    unit: string;
    selling_price_paise: number;
    gst_rate_bps: number;
    hsn_code: string;
    image_url: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    packSize: r.pack_size,
    unit: r.unit,
    sellingPrice: fromPaise(r.selling_price_paise),
    gstRate: fromGstBps(r.gst_rate_bps),
    hsnCode: r.hsn_code,
    imageUrl: r.image_url || undefined,
  }));
}

/**
 * Read-only active customer list for Salesman customer selection.
 */
export function listSalesmanCustomers(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['SALESMAN']);
  const rows = db
    .prepare(
      `SELECT id, code, name, contact_person, phone, email, billing_address, delivery_address, state
       FROM customers
       WHERE is_active = 1
       ORDER BY name ASC`
    )
    .all() as Array<{
    id: string;
    code: string;
    name: string;
    contact_person: string;
    phone: string;
    email: string;
    billing_address: string;
    delivery_address: string;
    state: string;
  }>;

  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    contactPerson: c.contact_person,
    phone: c.phone,
    email: c.email,
    billingAddress: c.billing_address,
    deliveryAddress: c.delivery_address,
    state: c.state,
  }));
}

/**
 * Allows an authenticated Salesman to register a new customer during order creation.
 * Validates required fields, mobile format, optional GSTIN, and checks duplicates.
 */
export function createSalesmanCustomer(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    name: string;
    contactPerson?: string;
    phone: string;
    email?: string;
    address: string;
    state: string;
    gstin?: string;
  }
) {
  requireRole(actor, ['SALESMAN']);

  const name = (input.name ?? '').trim();
  const phoneRaw = (input.phone ?? '').trim();
  const address = (input.address ?? '').trim();
  const state = (input.state ?? '').trim();
  const contactPerson = (input.contactPerson ?? '').trim() || name;
  const email = (input.email ?? '').trim();

  if (!name || !phoneRaw || !address || !state) {
    throw new HttpError(
      400,
      'Customer / Business Name, Mobile Number, Address, and State are required.'
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }

  const normalizedMobile = validateMobileNumber(phoneRaw);
  const normalizedGstin = validateAndNormalizeGstin(input.gstin);
  const stateCode = INDIAN_STATE_CODES[state] || '99';

  return runInTransaction(db, () => {
    assertNoDuplicateCustomer(db, normalizedMobile, normalizedGstin);

    const nowIso = new Date().toISOString();
    const id = uid('cust');
    const code = nextSequenceNumber(db, 'customers', 'code', 'CUST-REG-');

    db.prepare(
      `INSERT INTO customers (
        id, code, name, contact_person, phone, email, gstin,
        billing_address, delivery_address, state, state_code, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      id,
      code,
      name,
      contactPerson,
      phoneRaw,
      email,
      normalizedGstin,
      address,
      address,
      state,
      stateCode,
      nowIso,
      nowIso
    );

    recordAuditLog(
      db,
      actor,
      'CUSTOMER',
      id,
      'SALESMAN_CREATE_CUSTOMER',
      `${code} (${name}) registered during order creation`
    );

    return {
      id,
      code,
      name,
      contactPerson,
      phone: phoneRaw,
      email,
      billingAddress: address,
      deliveryAddress: address,
      state,
    };
  });
}

function sanitizeAuditActionForSalesman(toStatus: string): string {
  switch (toStatus) {
    case 'SUBMITTED':
      return 'Order submitted for review';
    case 'UNDER_REVIEW':
      return 'Order is under Admin review';
    case 'PRODUCTION_REQUIRED':
      return 'Queued for production fulfillment';
    case 'AWAITING_STOCK':
      return 'Pending stock availability';
    case 'APPROVED':
      return 'Order approved and ready for dispatch';
    case 'PARTIALLY_DISPATCHED':
      return 'Order partially dispatched';
    case 'DISPATCHED':
      return 'Order dispatched';
    case 'REJECTED':
      return 'Order rejected';
    default:
      return `Status updated to ${toStatus}`;
  }
}

function mapSalesmanOrderRow(
  db: DatabaseSync,
  row: {
    id: string;
    order_number: string;
    customer_id: string;
    customer_name: string;
    customer_code: string;
    contact_person: string;
    phone: string;
    delivery_address: string;
    customer_state: string;
    requested_qty_scaled: number;
    dispatched_qty_scaled: number;
    subtotal_paise: number;
    order_date: string;
    status: string;
    notes: string;
    created_at: string;
  }
) {
  const items = (
    db
      .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC`)
      .all(row.id) as Array<{
      id: string;
      product_id: string;
      product_name: string;
      sku: string;
      pack_size: string;
      unit: string;
      image_url: string;
      unit_price_paise: number;
      gst_rate_bps: number;
      requested_qty_scaled: number;
      dispatched_qty_scaled: number;
    }>
  ).map((it) => {
    const qty = fromScaledQty(it.requested_qty_scaled);
    const unitPrice = fromPaise(it.unit_price_paise);
    return {
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      sku: it.sku,
      packSize: it.pack_size,
      unit: it.unit,
      imageUrl: it.image_url || undefined,
      unitPrice,
      gstRate: fromGstBps(it.gst_rate_bps),
      requestedQuantity: qty,
      dispatchedQuantity: fromScaledQty(it.dispatched_qty_scaled),
      lineTotal: Math.round(qty * unitPrice * 100) / 100,
    };
  });

  // Derive high-level production stage only when PRODUCTION_REQUIRED, without exposing raw stock/costs
  let productionStage: string | undefined;
  if (row.status === 'PRODUCTION_REQUIRED') {
    const prStatuses = db
      .prepare(
        `SELECT status FROM production_requests WHERE order_id = ? AND status != 'CANCELLED'`
      )
      .all(row.id) as Array<{ status: string }>;
    if (prStatuses.some((p) => p.status === 'IN_PROGRESS')) {
      productionStage = 'IN_PROGRESS';
    } else if (prStatuses.some((p) => p.status === 'AWAITING_MATERIALS')) {
      productionStage = 'AWAITING_MATERIALS';
    } else if (prStatuses.length > 0 && prStatuses.every((p) => p.status === 'COMPLETED')) {
      productionStage = 'READY_FOR_DISPATCH';
    }
  }

  const audits = (
    db
      .prepare(
        `SELECT id, timestamp, to_status, from_status
         FROM order_audit_trail
         WHERE order_id = ?
         ORDER BY timestamp DESC`
      )
      .all(row.id) as Array<{
      id: string;
      timestamp: string;
      to_status: string;
      from_status: string | null;
    }>
  ).map((a) => ({
    id: a.id,
    timestamp: a.timestamp,
    action: sanitizeAuditActionForSalesman(a.to_status),
    fromStatus: a.from_status || undefined,
    toStatus: a.to_status,
  }));

  const computedSubtotal =
    row.subtotal_paise > 0
      ? fromPaise(row.subtotal_paise)
      : Math.round(items.reduce((s, it) => s + it.lineTotal, 0) * 100) / 100;

  return {
    id: row.id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerCode: row.customer_code,
    customerContact: row.contact_person,
    customerPhone: row.phone,
    deliveryAddress: row.delivery_address,
    customerState: row.customer_state,
    requestedQuantity: fromScaledQty(row.requested_qty_scaled),
    dispatchedQuantity: fromScaledQty(row.dispatched_qty_scaled),
    subtotal: computedSubtotal,
    orderDate: row.order_date,
    createdAt: row.created_at,
    status: row.status,
    productionStage,
    customerNote: row.notes || undefined,
    items,
    progressUpdates: audits,
  };
}

export function listSalesmanOrders(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['SALESMAN']);
  const rows = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.code AS customer_code, c.contact_person,
              c.phone, c.delivery_address, c.state AS customer_state
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.salesman_user_id = ?
       ORDER BY o.created_at DESC, o.order_number DESC`
    )
    .all(actor.id) as Array<Parameters<typeof mapSalesmanOrderRow>[1]>;

  return rows.map((row) => mapSalesmanOrderRow(db, row));
}

export function getSalesmanOrderDetail(db: DatabaseSync, actor: AuthUser, orderId: string) {
  requireRole(actor, ['SALESMAN']);
  const row = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.code AS customer_code, c.contact_person,
              c.phone, c.delivery_address, c.state AS customer_state
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`
    )
    .get(orderId) as
    | (Parameters<typeof mapSalesmanOrderRow>[1] & { salesman_user_id: string | null })
    | undefined;

  if (!row) {
    throw new HttpError(404, `Order ${orderId} not found.`);
  }
  if (row.salesman_user_id !== actor.id) {
    throw new HttpError(403, 'Access denied: you can only view orders you submitted.');
  }

  return mapSalesmanOrderRow(db, row);
}

export function getSalesmanDashboard(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['SALESMAN']);
  const orders = listSalesmanOrders(db, actor);
  const totalOrdersCount = orders.length;
  const pendingOrdersCount = orders.filter(
    (o) => o.status !== 'DISPATCHED' && o.status !== 'REJECTED'
  ).length;
  return {
    totalOrdersCount,
    pendingOrdersCount,
    recentOrders: orders.slice(0, 6),
  };
}

/**
 * Creates a customer order (single or multi-product) submitted by a Salesman.
 * Never checks or blocks on finished-goods or raw-material stock.
 */
export function createSalesmanOrder(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    customerId: string;
    items: Array<{ productId: string; quantity: number }>;
    customerNote?: string;
  }
) {
  requireRole(actor, ['SALESMAN']);

  if (!input.customerId?.trim()) {
    throw new HttpError(400, 'Please select a customer before submitting the order.');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new HttpError(400, 'Please add at least one product to the order.');
  }

  // Merge duplicate product lines safely
  const mergedItems = new Map<string, number>();
  for (const line of input.items) {
    if (!line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new HttpError(400, 'Every order item must have a valid product and quantity greater than zero.');
    }
    mergedItems.set(line.productId, (mergedItems.get(line.productId) ?? 0) + line.quantity);
  }

  return runInTransaction(db, () => {
    const customer = db
      .prepare(`SELECT id, name, is_active FROM customers WHERE id = ?`)
      .get(input.customerId) as { id: string; name: string; is_active: number } | undefined;
    if (!customer || !customer.is_active) {
      throw new HttpError(400, 'Selected customer is invalid or inactive.');
    }

    const resolvedLines: Array<{
      productId: string;
      name: string;
      sku: string;
      packSize: string;
      unit: string;
      imageUrl: string;
      unitPricePaise: number;
      gstRateBps: number;
      qtyScaled: number;
      lineSubtotalPaise: number;
    }> = [];

    const prodStmt = db.prepare(
      `SELECT id, sku, name, pack_size, unit, image_url, selling_price_paise, gst_rate_bps, category, is_active
       FROM inventory_items WHERE id = ?`
    );

    for (const [productId, quantity] of mergedItems.entries()) {
      const prod = prodStmt.get(productId) as
        | {
            id: string;
            sku: string;
            name: string;
            pack_size: string;
            unit: string;
            image_url: string;
            selling_price_paise: number;
            gst_rate_bps: number;
            category: string;
            is_active: number;
          }
        | undefined;

      if (!prod || prod.category !== 'FINISHED_GOOD' || !prod.is_active) {
        throw new HttpError(400, `Product ${productId} is unavailable in the catalogue.`);
      }

      const qtyScaled = toScaledQty(quantity);
      const lineSubtotalPaise = calcTaxablePaise(qtyScaled, prod.selling_price_paise);
      resolvedLines.push({
        productId: prod.id,
        name: prod.name,
        sku: prod.sku,
        packSize: prod.pack_size,
        unit: prod.unit,
        imageUrl: prod.image_url || '',
        unitPricePaise: prod.selling_price_paise,
        gstRateBps: prod.gst_rate_bps,
        qtyScaled,
        lineSubtotalPaise,
      });
    }

    const nowIso = new Date().toISOString();
    const orderNumber = nextSequenceNumber(db, 'orders', 'order_number', 'ORD-2026-');
    const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
    const totalRequestedScaled = resolvedLines.reduce((s, l) => s + l.qtyScaled, 0);
    const subtotalPaise = resolvedLines.reduce((s, l) => s + l.lineSubtotalPaise, 0);
    const primaryProductId = resolvedLines[0].productId;
    const noteTrimmed = input.customerNote?.trim() || '';

    db.prepare(
      `INSERT INTO orders (
        id, order_number, customer_id, salesman_user_id, product_id,
        requested_qty_scaled, dispatched_qty_scaled, subtotal_paise,
        order_date, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'SUBMITTED', ?, ?, ?)`
    ).run(
      orderId,
      orderNumber,
      customer.id,
      actor.id,
      primaryProductId,
      totalRequestedScaled,
      subtotalPaise,
      nowIso.slice(0, 10),
      noteTrimmed,
      nowIso,
      nowIso
    );

    const insertLine = db.prepare(
      `INSERT INTO order_items (
        id, order_id, product_id, product_name, sku, pack_size, unit, image_url,
        unit_price_paise, gst_rate_bps, requested_qty_scaled, dispatched_qty_scaled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    );
    for (const line of resolvedLines) {
      insertLine.run(
        uid('oi'),
        orderId,
        line.productId,
        line.name,
        line.sku,
        line.packSize,
        line.unit,
        line.imageUrl,
        line.unitPricePaise,
        line.gstRateBps,
        line.qtyScaled
      );
    }

    db.prepare(
      `INSERT INTO order_audit_trail (
        id, order_id, timestamp, actor_user_id, actor_name, action, from_status, to_status, note
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'SUBMITTED', ?)`
    ).run(
      uid('aud'),
      orderId,
      nowIso,
      actor.id,
      actor.fullName,
      `Order submitted by ${actor.fullName} for ${customer.name} (${resolvedLines.length} item${resolvedLines.length > 1 ? 's' : ''})`,
      noteTrimmed
    );

    recordAuditLog(
      db,
      actor,
      'ORDER',
      orderId,
      'SALESMAN_SUBMIT_ORDER',
      `${orderNumber} submitted for ${customer.name}`
    );

    return getSalesmanOrderDetail(db, actor, orderId);
  });
}
