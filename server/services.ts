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

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function nextSequenceNumber(
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

function recordAuditLog(
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

interface StockMovementParams {
  itemId: string;
  movementType:
    | 'OPENING_BALANCE'
    | 'PURCHASE_RECEIPT'
    | 'PRODUCTION_CONSUMPTION'
    | 'PRODUCTION_OUTPUT'
    | 'DISPATCH';
  direction: 'IN' | 'OUT';
  qtyScaled: number;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  reason: string;
  actor: AuthUser;
  nowIso: string;
}

function applyStockMovement(db: DatabaseSync, params: StockMovementParams): number {
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
 * Evaluates shortage for a customer order using live stock_balances and BOM.
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

  const remainingScaled = Math.max(
    0,
    orderRow.requested_qty_scaled - orderRow.dispatched_qty_scaled
  );
  const availableScaled = Math.max(0, orderRow.fg_stock_scaled);
  const shortageScaled = Math.max(0, remainingScaled - availableScaled);
  const productionRequired = shortageScaled > 0;
  const checkedAt = new Date().toISOString();

  if (!productionRequired) {
    return {
      orderId: orderRow.id,
      productId: orderRow.product_id,
      productName: orderRow.product_name,
      unit: orderRow.product_unit,
      requestedQuantity: fromScaledQty(orderRow.requested_qty_scaled),
      remainingToFulfill: fromScaledQty(remainingScaled),
      availableFinishedStock: fromScaledQty(availableScaled),
      shortageQuantity: 0,
      productionRequired: false,
      rawMaterialAvailability: 'NOT_APPLICABLE' as const,
      bomBreakdown: [],
      materialsRequiringPurchase: [],
      checkedAt,
    };
  }

  const bomRows = db
    .prepare(
      `SELECT b.material_id, b.quantity_per_unit_scaled,
              m.sku AS material_code, m.name AS material_name, m.unit, m.category,
              sb.quantity_scaled AS available_scaled
       FROM bom_items b
       JOIN inventory_items m ON m.id = b.material_id
       JOIN stock_balances sb ON sb.item_id = m.id
       WHERE b.product_id = ?
       ORDER BY m.category, m.name`
    )
    .all(orderRow.product_id) as Array<{
    material_id: string;
    quantity_per_unit_scaled: number;
    material_code: string;
    material_name: string;
    unit: string;
    category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
    available_scaled: number;
  }>;

  const bomBreakdown = bomRows.map((row) => {
    // shortageScaled and quantity_per_unit_scaled are both scaled by 10000
    const requiredScaled = Math.round(
      (shortageScaled * row.quantity_per_unit_scaled) / 10000
    );
    const matAvailableScaled = Math.max(0, row.available_scaled);
    const shortfallScaled = Math.max(0, requiredScaled - matAvailableScaled);
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

  const materialsRequiringPurchase = bomBreakdown.filter((b) => !b.isSufficient);
  const rawMaterialAvailability =
    materialsRequiringPurchase.length === 0 ? ('SUFFICIENT' as const) : ('INSUFFICIENT' as const);

  return {
    orderId: orderRow.id,
    productId: orderRow.product_id,
    productName: orderRow.product_name,
    unit: orderRow.product_unit,
    requestedQuantity: fromScaledQty(orderRow.requested_qty_scaled),
    remainingToFulfill: fromScaledQty(remainingScaled),
    availableFinishedStock: fromScaledQty(availableScaled),
    shortageQuantity: fromScaledQty(shortageScaled),
    productionRequired: true,
    rawMaterialAvailability,
    bomBreakdown: bomBreakdown.map(({ _requiredScaled, _availableScaled, _shortfallScaled, ...rest }) => rest),
    materialsRequiringPurchase: materialsRequiringPurchase.map(
      ({ _requiredScaled, _availableScaled, _shortfallScaled, ...rest }) => rest
    ),
    checkedAt,
    _internalBom: bomBreakdown,
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
    if (!pr || pr.status !== 'AWAITING_MATERIALS') continue;

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
              p.selling_price_paise, p.gst_rate_bps, p.hsn_code
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN inventory_items p ON p.id = o.product_id
       ORDER BY o.order_date DESC, o.order_number DESC`
    )
    .all() as Array<{
    id: string;
    order_number: string;
    customer_id: string;
    customer_name: string;
    customer_code: string;
    customer_state: string;
    product_id: string;
    product_name: string;
    product_sku: string;
    product_unit: string;
    requested_qty_scaled: number;
    dispatched_qty_scaled: number;
    order_date: string;
    status: string;
    notes: string;
  }>;

  const auditStmt = db.prepare(
    `SELECT id, timestamp, actor_name, action, from_status, to_status, note
     FROM order_audit_trail
     WHERE order_id = ?
     ORDER BY timestamp DESC`
  );

  return rows.map((row) => {
    const audits = auditStmt.all(row.id) as Array<{
      id: string;
      timestamp: string;
      actor_name: string;
      action: string;
      from_status: string | null;
      to_status: string;
      note: string;
    }>;

    return {
      id: row.id,
      orderNumber: row.order_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerCode: row.customer_code,
      customerState: row.customer_state,
      productId: row.product_id,
      productName: row.product_name,
      productSku: row.product_sku,
      unit: row.product_unit,
      requestedQuantity: fromScaledQty(row.requested_qty_scaled),
      dispatchedQuantity: fromScaledQty(row.dispatched_qty_scaled),
      orderDate: row.order_date,
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
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);

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

      const existingPr = db
        .prepare(
          `SELECT request_number FROM production_requests
           WHERE order_id = ? AND status != 'CANCELLED'`
        )
        .get(orderId) as { request_number: string } | undefined;

      if (existingPr) {
        throw new HttpError(
          409,
          `Production request ${existingPr.request_number} already exists for order ${order.order_number}. Duplicate requests are blocked.`
        );
      }

      const requestNumber = nextSequenceNumber(
        db,
        'production_requests',
        'request_number',
        'PR-2026-'
      );
      createdRequestId = uid('pr');

      const hasShortages = analysis.materialsRequiringPurchase.length > 0;
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
        createdRequestId,
        requestNumber,
        order.id,
        analysis.productId,
        toScaledQty(analysis.shortageQuantity),
        prStatus,
        supStatus,
        nowIso,
        actor.fullName,
        note?.trim() || '',
        nowIso
      );

      // Create material shortage queries for any insufficient raw/packaging materials
      if (hasShortages && '_internalBom' in analysis && analysis._internalBom) {
        const insertQuery = db.prepare(
          `INSERT INTO material_shortage_queries (
            id, query_number, production_request_id, order_id, material_id,
            required_qty_scaled, available_qty_scaled, shortage_qty_scaled,
            status, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
        );
        for (const line of analysis._internalBom) {
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
              createdRequestId,
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

      nextStatus = 'PRODUCTION_REQUIRED';
      actionLabel = `Sent shortage (${analysis.shortageQuantity} ${analysis.unit}) for production (${requestNumber})`;
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
    reorder_level_scaled: number;
    is_active: number;
    quantity_scaled: number;
    stock_updated_at: string;
    movement_count: number;
    created_at: string;
    updated_at: string;
  }>;

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
              p.name AS product_name, p.sku AS product_sku, p.unit,
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
    requested_qty_scaled: number;
    status: string;
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
      requestedQuantity: fromScaledQty(r.requested_qty_scaled),
      rawMaterialAvailability: hasInsufficientLive ? ('INSUFFICIENT' as const) : ('SUFFICIENT' as const),
      materialsToPurchase,
      bomMaterials,
      status: r.status,
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
    notes?: string;
  }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);

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

    db.prepare(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, status, order_date, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'ORDERED', ?, ?, ?, ?, ?)`
    ).run(poId, poNumber, sup.id, nowIso.slice(0, 10), input.notes?.trim() || '', actor.fullName, nowIso, nowIso);

    const insertLine = db.prepare(
      `INSERT INTO purchase_order_items (id, purchase_order_id, item_id, ordered_qty_scaled, received_qty_scaled, unit_cost_paise)
       VALUES (?, ?, ?, ?, 0, ?)`
    );

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
      insertLine.run(uid('poi'), poId, item.id, qtyScaled, toPaise(line.unitCost ?? 0));
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

    recordAuditLog(
      db,
      actor,
      'PURCHASE_ORDER',
      poId,
      'CREATE_PO',
      `${poNumber} raised to ${sup.name} (no inventory change until receipt)`
    );

    return { id: poId, poNumber };
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
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);

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
    }

    // Recalculate open shortage queries and advance AWAITING_MATERIALS production requests
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
              p.name AS product_name, p.sku AS product_sku, p.unit
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
    planned_qty_scaled: number;
    actual_output_qty_scaled: number;
    wastage_qty_scaled: number;
    variance_qty_scaled: number;
    status: string;
    supervisor_user_id: string;
    supervisor_name: string;
    posted_at: string;
    notes: string;
  }>;

  const consStmt = db.prepare(
    `SELECT prc.*, ii.name AS material_name, ii.sku, ii.unit, ii.category
     FROM production_run_consumptions prc
     JOIN inventory_items ii ON ii.id = prc.material_id
     WHERE prc.production_run_id = ?`
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
    plannedQuantity: fromScaledQty(r.planned_qty_scaled),
    actualOutputQuantity: fromScaledQty(r.actual_output_qty_scaled),
    wastageQuantity: fromScaledQty(r.wastage_qty_scaled),
    varianceQuantity: fromScaledQty(r.variance_qty_scaled),
    status: r.status,
    supervisorName: r.supervisor_name,
    postedAt: r.posted_at,
    notes: r.notes || undefined,
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
        wastage_qty_scaled: number;
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
      wastageQuantity: fromScaledQty(c.wastage_qty_scaled),
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
  nextStatus: 'READY_FOR_PRODUCTION' | 'IN_PROGRESS' | 'CANCELLED',
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
    if (pr.status === 'COMPLETED' || pr.status === 'CANCELLED') {
      throw new HttpError(400, `Production request ${pr.request_number} is already ${pr.status}.`);
    }

    const nowIso = new Date().toISOString();
    const labelMap: Record<typeof nextStatus, string> = {
      READY_FOR_PRODUCTION: 'Ready for Production',
      IN_PROGRESS: 'In Progress',
      CANCELLED: 'Cancelled by Supervisor',
    };

    db.prepare(
      `UPDATE production_requests
       SET status = ?, assigned_supervisor_id = ?, supervisor_status = ?, notes = COALESCE(NULLIF(?, ''), notes), updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, actor.id, labelMap[nextStatus], notes?.trim() || '', nowIso, pr.id);

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
 * and adding finished-goods stock atomically.
 */
export function postProductionRunBySupervisor(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    productionRequestId: string;
    actualOutputQuantity: number;
    wastageQuantity?: number;
    consumptions?: Array<{
      materialId: string;
      actualConsumedQuantity: number;
      wastageQuantity?: number;
    }>;
    notes?: string;
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
        }
      | undefined;

    if (!pr) {
      throw new HttpError(404, `Production request ${input.productionRequestId} not found.`);
    }
    if (pr.status === 'COMPLETED' || pr.status === 'CANCELLED') {
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

    const actualOutputScaled = toScaledQty(input.actualOutputQuantity);
    const wastageScaled = toScaledQty(input.wastageQuantity ?? 0);
    const varianceScaled = actualOutputScaled - pr.requested_qty_scaled;
    const nowIso = new Date().toISOString();
    const runNumber = nextSequenceNumber(db, 'production_runs', 'run_number', 'RUN-2026-');
    const runId = uid('run');

    db.prepare(
      `INSERT INTO production_runs (
        id, run_number, production_request_id, product_id,
        planned_qty_scaled, actual_output_qty_scaled, wastage_qty_scaled, variance_qty_scaled,
        status, supervisor_user_id, supervisor_name, posted_at, notes, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?)`
    ).run(
      runId,
      runNumber,
      pr.id,
      pr.product_id,
      pr.requested_qty_scaled,
      actualOutputScaled,
      wastageScaled,
      varianceScaled,
      actor.id,
      actor.fullName,
      nowIso,
      input.notes?.trim() || '',
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
        id, production_run_id, material_id, planned_qty_scaled, actual_consumed_qty_scaled, wastage_qty_scaled
      ) VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const bom of bomRows) {
      const plannedScaled = Math.round(
        (pr.requested_qty_scaled * bom.quantity_per_unit_scaled) / 10000
      );
      const override = overrideMap.get(bom.material_id);
      const actualConsScaled = override
        ? toScaledQty(override.actualConsumedQuantity)
        : plannedScaled;
      const matWastageScaled = override ? toScaledQty(override.wastageQuantity ?? 0) : 0;

      insertCons.run(
        uid('rc'),
        runId,
        bom.material_id,
        plannedScaled,
        actualConsScaled,
        matWastageScaled
      );

      if (actualConsScaled > 0) {
        applyStockMovement(db, {
          itemId: bom.material_id,
          movementType: 'PRODUCTION_CONSUMPTION',
          direction: 'OUT',
          qtyScaled: actualConsScaled,
          referenceType: 'PRODUCTION_RUN',
          referenceId: runId,
          referenceNumber: runNumber,
          reason: `Consumed in ${runNumber} (${pr.request_number})`,
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
        reason: `Finished goods output posted from ${runNumber}`,
        actor,
        nowIso,
      });
    }

    db.prepare(
      `UPDATE production_requests
       SET status = 'COMPLETED', assigned_supervisor_id = ?, supervisor_status = 'Completed & Posted', updated_at = ?
       WHERE id = ?`
    ).run(actor.id, nowIso, pr.id);

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
      `${runNumber} posted: output ${fromScaledQty(actualOutputScaled)} (planned ${fromScaledQty(pr.requested_qty_scaled)})`
    );

    return { id: runId, runNumber, deduplicated: false };
  });
}

export function listDispatches(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT d.*, o.order_number, o.customer_id, c.name AS customer_name, c.state AS customer_state,
              p.id AS product_id, p.name AS product_name, p.unit, p.selling_price_paise, p.gst_rate_bps,
              inv.id AS invoice_id, inv.invoice_number
       FROM dispatches d
       JOIN orders o ON o.id = d.order_id
       JOIN customers c ON c.id = o.customer_id
       JOIN inventory_items p ON p.id = o.product_id
       LEFT JOIN invoices inv ON inv.dispatch_id = d.id
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

  return rows.map((r) => ({
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
    isInvoiced: Boolean(r.invoice_id),
    invoiceId: r.invoice_id || undefined,
    invoiceNumber: r.invoice_number || undefined,
    dispatchedAt: r.dispatched_at,
    dispatchedBy: r.dispatched_by,
    notes: r.notes || undefined,
  }));
}

export function recordDispatch(
  db: DatabaseSync,
  actor: AuthUser,
  input: { orderId: string; quantity: number; notes?: string; idempotencyKey?: string }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);

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
    invoice_date: string;
    supply_type: 'INTRA_STATE' | 'INTER_STATE';
    place_of_supply_state: string;
    taxable_amount_paise: number;
    cgst_amount_paise: number;
    sgst_amount_paise: number;
    igst_amount_paise: number;
    total_gst_paise: number;
    total_amount_paise: number;
    paid_amount_paise: number;
    payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
    created_by: string;
    created_at: string;
  }>;

  const lineStmt = db.prepare(`SELECT * FROM invoice_lines WHERE invoice_id = ?`);
  const payStmt = db.prepare(
    `SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, created_at DESC`
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

    const payments = payStmt.all(inv.id) as Array<{
      id: string;
      payment_number: string;
      invoice_id: string;
      payment_date: string;
      amount_paise: number;
      payment_mode: string;
      reference_number: string;
      recorded_by: string;
      notes: string;
      created_at: string;
    }>;

    const outstandingPaise = Math.max(0, inv.total_amount_paise - inv.paid_amount_paise);

    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      orderId: inv.order_id,
      orderNumber: inv.order_number,
      dispatchId: inv.dispatch_id,
      dispatchNumber: inv.dispatch_number,
      customerId: inv.customer_id,
      customerName: inv.customer_name,
      customerCode: inv.customer_code,
      customerGstin: inv.customer_gstin,
      billingAddress: inv.billing_address,
      deliveryAddress: inv.delivery_address,
      customerState: inv.customer_state,
      customerStateCode: inv.customer_state_code,
      invoiceDate: inv.invoice_date,
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
      createdBy: inv.created_by,
      createdAt: inv.created_at,
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
        invoiceId: p.invoice_id,
        paymentDate: p.payment_date,
        amount: fromPaise(p.amount_paise),
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
       JOIN invoices inv ON inv.id = p.invoice_id
       JOIN customers c ON c.id = p.customer_id
       ORDER BY p.payment_date DESC, p.created_at DESC`
    )
    .all() as Array<{
    id: string;
    payment_number: string;
    invoice_id: string;
    invoice_number: string;
    customer_id: string;
    customer_name: string;
    payment_date: string;
    amount_paise: number;
    payment_mode: string;
    reference_number: string;
    recorded_by: string;
    notes: string;
    created_at: string;
  }>;

  return {
    businessProfile: BUSINESS_PROFILE,
    invoices: mappedInvoices,
    payments: allPayments.map((p) => ({
      id: p.id,
      paymentNumber: p.payment_number,
      invoiceId: p.invoice_id,
      invoiceNumber: p.invoice_number,
      customerId: p.customer_id,
      customerName: p.customer_name,
      paymentDate: p.payment_date,
      amount: fromPaise(p.amount_paise),
      paymentMode: p.payment_mode,
      referenceNumber: p.reference_number,
      recordedBy: p.recorded_by,
      notes: p.notes || undefined,
      createdAt: p.created_at,
    })),
    dispatchesReadyForInvoicing: listDispatches(db).filter((d) => !d.isInvoiced),
  };
}

/**
 * Accountant ONLY: Generate GST invoice strictly from actual dispatched quantity.
 */
export function createInvoiceFromDispatchByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  input: { dispatchId: string }
) {
  requireRole(actor, ['ACCOUNTANT']);

  return runInTransaction(db, () => {
    const dispatch = db
      .prepare(
        `SELECT d.*, o.customer_id, o.product_id, o.order_number,
                c.state AS customer_state, c.state_code AS customer_state_code,
                p.name AS product_name, p.sku, p.hsn_code, p.unit, p.selling_price_paise, p.gst_rate_bps
         FROM dispatches d
         JOIN orders o ON o.id = d.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN inventory_items p ON p.id = o.product_id
         WHERE d.id = ?`
      )
      .get(input.dispatchId) as
      | {
          id: string;
          dispatch_number: string;
          order_id: string;
          order_number: string;
          customer_id: string;
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
        }
      | undefined;

    if (!dispatch) {
      throw new HttpError(404, `Dispatch ${input.dispatchId} not found.`);
    }
    if (dispatch.dispatched_qty_scaled <= 0) {
      throw new HttpError(400, 'Cannot generate invoice for unfulfilled or zero-dispatch quantities.');
    }

    const existingInv = db
      .prepare(`SELECT id, invoice_number FROM invoices WHERE dispatch_id = ?`)
      .get(dispatch.id) as { id: string; invoice_number: string } | undefined;
    if (existingInv) {
      throw new HttpError(
        409,
        `Invoice ${existingInv.invoice_number} is already generated for dispatch ${dispatch.dispatch_number}.`
      );
    }

    const supplyType: 'INTRA_STATE' | 'INTER_STATE' =
      dispatch.customer_state.trim().toLowerCase() === 'tamil nadu' ||
      dispatch.customer_state_code === '33'
        ? 'INTRA_STATE'
        : 'INTER_STATE';

    const taxablePaise = calcTaxablePaise(
      dispatch.dispatched_qty_scaled,
      dispatch.selling_price_paise
    );
    const gst = calcGstPaise(taxablePaise, dispatch.gst_rate_bps, supplyType);
    const totalPaise = taxablePaise + gst.totalGstPaise;

    const nowIso = new Date().toISOString();
    const invoiceNumber = nextSequenceNumber(db, 'invoices', 'invoice_number', 'INV-2026-');
    const invoiceId = uid('inv');

    db.prepare(
      `INSERT INTO invoices (
        id, invoice_number, order_id, customer_id, dispatch_id, invoice_date,
        supply_type, place_of_supply_state, taxable_amount_paise,
        cgst_amount_paise, sgst_amount_paise, igst_amount_paise, total_gst_paise, total_amount_paise,
        paid_amount_paise, payment_status, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UNPAID', ?, ?)`
    ).run(
      invoiceId,
      invoiceNumber,
      dispatch.order_id,
      dispatch.customer_id,
      dispatch.id,
      nowIso.slice(0, 10),
      supplyType,
      dispatch.customer_state,
      taxablePaise,
      gst.cgstPaise,
      gst.sgstPaise,
      gst.igstPaise,
      gst.totalGstPaise,
      totalPaise,
      actor.fullName,
      nowIso
    );

    db.prepare(
      `INSERT INTO invoice_lines (
        id, invoice_id, product_id, product_name, sku, hsn_code, unit,
        quantity_scaled, unit_price_paise, gst_rate_bps,
        taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid('invl'),
      invoiceId,
      dispatch.product_id,
      dispatch.product_name,
      dispatch.sku,
      dispatch.hsn_code,
      dispatch.unit,
      dispatch.dispatched_qty_scaled,
      dispatch.selling_price_paise,
      dispatch.gst_rate_bps,
      taxablePaise,
      gst.cgstPaise,
      gst.sgstPaise,
      gst.igstPaise,
      totalPaise
    );

    db.prepare(`UPDATE dispatches SET invoiced_qty_scaled = ? WHERE id = ?`).run(
      dispatch.dispatched_qty_scaled,
      dispatch.id
    );

    recordAuditLog(
      db,
      actor,
      'INVOICE',
      invoiceId,
      'GENERATE_INVOICE',
      `${invoiceNumber} generated for ${dispatch.order_number} (${supplyType})`
    );

    return { id: invoiceId, invoiceNumber };
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
        }
      | undefined;

    if (!inv) {
      throw new HttpError(404, `Invoice ${input.invoiceId} not found.`);
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
        id, payment_number, invoice_id, customer_id, payment_date, amount_paise,
        payment_mode, reference_number, recorded_by, notes, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);

  if (!input.sku?.trim() || !input.name?.trim() || !input.unit?.trim() || !input.hsnCode?.trim()) {
    throw new HttpError(400, 'SKU, product name, unit of measurement, and HSN code are required.');
  }

  const normalizedImageUrl = normalizeProductImageUrl(input.imageUrl);

  return runInTransaction(db, () => {
    const nowIso = new Date().toISOString();
    const productId = input.id || uid('prod');
    const isEdit = Boolean(input.id);
    let previousImageUrl = '';

    if (isEdit) {
      const existing = db
        .prepare(
          `SELECT id, image_url FROM inventory_items WHERE id = ? AND category = 'FINISHED_GOOD'`
        )
        .get(productId) as { id: string; image_url: string } | undefined;
      if (!existing) {
        throw new HttpError(404, `Product ${productId} not found.`);
      }
      previousImageUrl = existing.image_url || '';
      db.prepare(
        `UPDATE inventory_items
         SET sku = ?, name = ?, pack_size = ?, selling_price_paise = ?, gst_rate_bps = ?,
             hsn_code = ?, image_url = ?, unit = ?, reorder_level_scaled = ?, is_active = ?, updated_at = ?
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
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
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
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
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
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
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
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
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
  requireRole(actor, ['OWNER_SUPER_ADMIN']);
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
  requireRole(actor, ['OWNER_SUPER_ADMIN']);
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
  requireRole(actor, ['OWNER_SUPER_ADMIN']);
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
  requireRole(actor, ['OWNER_SUPER_ADMIN']);
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
