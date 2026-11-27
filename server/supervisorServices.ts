import type { DatabaseSync } from 'node:sqlite';
import { HttpError, requireRole, type AuthUser } from './auth.ts';
import { runInTransaction } from './db.ts';
import { fromPaise, fromScaledQty, toScaledQty } from './moneyQty.ts';
import {
  applyStockMovement,
  bumpBomVersion,
  getProductBomSnapshot,
  listInventoryItems,
  listProductionRequests,
  listProductionRuns,
  nextSequenceNumber,
  recalculateOpenShortageQueries,
  recordAuditLog,
  uid,
} from './services.ts';

// ---------------------------------------------------------------------------
// 1. Production Supervisor Dashboard
// ---------------------------------------------------------------------------

export function getSupervisorDashboard(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  const requests = listProductionRequests(db);
  const runs = listProductionRuns(db);
  const inventory = listInventoryItems(db);
  const purchaseReqs = listMaterialPurchaseRequirements(db, actor);
  const openDiscrepancies = listStockDiscrepancyReports(db, actor).filter(
    (d) => d.status === 'OPEN'
  );
  const openBomRevisions = listBomRevisionRequests(db, actor).filter(
    (b) => b.status === 'PENDING_ADMIN_REVIEW'
  );

  const pendingRequests = requests.filter((r) =>
    [
      'PENDING_SUPERVISOR_REVIEW',
      'PENDING_MATERIAL_CHECK',
      'AWAITING_MATERIALS',
      'MATERIAL_SHORTAGE',
      'READY_FOR_PRODUCTION',
    ].includes(r.status)
  );
  const shortageRequests = requests.filter((r) =>
    ['AWAITING_MATERIALS', 'MATERIAL_SHORTAGE'].includes(r.status)
  );
  const inProgressRequests = requests.filter((r) => r.status === 'IN_PROGRESS');
  const completedRequests = requests.filter((r) =>
    ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(r.status)
  );

  // Track materials actively causing shortages in open/pending production requests
  const productionShortfallByMaterial = new Map<string, number>();
  for (const req of requests) {
    if (['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'].includes(req.status)) continue;
    for (const mat of req.materialsToPurchase) {
      if (mat.shortfallQuantity > 0) {
        productionShortfallByMaterial.set(
          mat.rawMaterialId,
          (productionShortfallByMaterial.get(mat.rawMaterialId) ?? 0) + mat.shortfallQuantity
        );
      }
    }
  }

  const lowStockMaterials = inventory.filter(
    (item) =>
      (item.category === 'RAW_MATERIAL' || item.category === 'PACKAGING_MATERIAL') &&
      item.availableStock < item.reorderLevel
  );

  const materialAlerts = inventory
    .filter(
      (item) =>
        (item.category === 'RAW_MATERIAL' || item.category === 'PACKAGING_MATERIAL') &&
        (item.availableStock < item.reorderLevel || productionShortfallByMaterial.has(item.id))
    )
    .map((item) => {
      const isLowStock = item.availableStock < item.reorderLevel;
      const shortfallQuantity = productionShortfallByMaterial.get(item.id) ?? 0;
      const affectsProduction = shortfallQuantity > 0;
      return {
        id: item.id,
        name: item.name,
        unit: item.unit,
        availableStock: item.availableStock,
        reorderLevel: item.reorderLevel,
        isLowStock,
        affectsProduction,
        shortfallQuantity,
        alertType: (affectsProduction && !isLowStock
          ? 'PRODUCTION_SHORTAGE'
          : affectsProduction
            ? 'PRODUCTION_SHORTAGE'
            : 'LOW_STOCK') as 'PRODUCTION_SHORTAGE' | 'LOW_STOCK',
      };
    })
    .sort((a, b) => {
      if (a.isLowStock !== b.isLowStock) {
        return a.isLowStock ? -1 : 1;
      }
      if (a.affectsProduction !== b.affectsProduction) {
        return a.affectsProduction ? -1 : 1;
      }
      if ((a.availableStock === 0) !== (b.availableStock === 0)) {
        return a.availableStock === 0 ? -1 : 1;
      }
      const aRatio = a.availableStock / Math.max(a.reorderLevel, 1);
      const bRatio = b.availableStock / Math.max(b.reorderLevel, 1);
      if (aRatio !== bRatio) return aRatio - bRatio;
      return b.shortfallQuantity - a.shortfallQuantity;
    });

  const activePurchaseReqs = purchaseReqs.filter(
    (p) => p.status !== 'RECEIVED' && p.status !== 'CANCELLED'
  );

  const alerts: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    category: 'SHORTAGE' | 'LOW_STOCK' | 'PROCUREMENT' | 'PRODUCTION';
    title: string;
    detail: string;
    relatedRequestId?: string;
  }> = [];

  for (const req of shortageRequests) {
    const missingSummary =
      req.materialsToPurchase.length > 0
        ? req.materialsToPurchase
            .map((m) => `${m.materialName} (-${m.shortfallQuantity} ${m.unit})`)
            .join(', ')
        : 'Raw material shortage pending procurement';
    alerts.push({
      id: `alt-shortage-${req.id}`,
      severity: 'critical',
      category: 'SHORTAGE',
      title: `${req.requestNumber} · ${req.productName} Material Shortage`,
      detail: `${missingSummary} for ${req.orderNumber} (${req.requestedQuantity} ${req.unit})`,
      relatedRequestId: req.id,
    });
  }

  for (const mat of lowStockMaterials) {
    alerts.push({
      id: `alt-low-${mat.id}`,
      severity: mat.availableStock === 0 ? 'critical' : 'warning',
      category: 'LOW_STOCK',
      title: `Low Stock: ${mat.name} (${mat.sku})`,
      detail: `Available ${mat.availableStock} ${mat.unit} vs reorder level ${mat.reorderLevel} ${mat.unit}.`,
    });
  }

  for (const prReq of activePurchaseReqs.filter((p) => p.status === 'AWAITING_OWNER_APPROVAL')) {
    alerts.push({
      id: `alt-po-${prReq.id}`,
      severity: 'info',
      category: 'PROCUREMENT',
      title: `${prReq.requirementNumber} awaiting Owner PO approval`,
      detail: `${prReq.materialName} (${prReq.shortageQuantity} ${prReq.unit}) linked to ${prReq.poNumber || 'PO'}.`,
    });
  }

  const recentActivityRows = db
    .prepare(
      `SELECT id, timestamp, actor_name, actor_role, entity_type, entity_id, action, details
       FROM audit_logs
       WHERE entity_type IN (
         'PRODUCTION_REQUEST', 'PRODUCTION_RUN', 'PURCHASE_REQUIREMENT',
         'STOCK_DISCREPANCY', 'BOM_REVISION', 'PURCHASE_RECEIPT'
       )
       ORDER BY timestamp DESC
       LIMIT 10`
    )
    .all() as Array<{
    id: string;
    timestamp: string;
    actor_name: string;
    actor_role: string;
    entity_type: string;
    entity_id: string;
    action: string;
    details: string;
  }>;

  return {
    pendingRequestsCount: pendingRequests.length,
    materialShortageRequestsCount: shortageRequests.length,
    inProgressCount: inProgressRequests.length,
    completedRunsCount: runs.length,
    completedRequestsCount: completedRequests.length,
    lowStockMaterialsCount: lowStockMaterials.length,
    pendingPurchaseRequirementsCount: activePurchaseReqs.length,
    openDiscrepanciesCount: openDiscrepancies.length,
    openBomRevisionsCount: openBomRevisions.length,
    materialAlerts,
    alerts,
    recentActivity: recentActivityRows.map((a) => ({
      id: a.id,
      timestamp: a.timestamp,
      actorName: a.actor_name,
      actorRole: a.actor_role,
      entityType: a.entity_type,
      entityId: a.entity_id,
      action: a.action,
      details: a.details,
    })),
    recentRequests: requests.slice(0, 8),
    recentRuns: runs.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// 2. Check / Recheck BOM & Material Availability for a Production Request
// ---------------------------------------------------------------------------

export function checkProductionRequestAvailability(
  db: DatabaseSync,
  actor: AuthUser,
  requestId: string
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  return runInTransaction(db, () => {
    const pr = db
      .prepare(
        `SELECT pr.id, pr.request_number, pr.order_id, pr.product_id, pr.bom_id, pr.requested_qty_scaled,
                pr.status, p.name AS product_name, COALESCE(bm.bom_version, p.bom_version) AS bom_version
         FROM production_requests pr
         JOIN inventory_items p ON p.id = pr.product_id
         LEFT JOIN boms bm ON bm.id = pr.bom_id
         WHERE pr.id = ?`
      )
      .get(requestId) as
      | {
          id: string;
          request_number: string;
          order_id: string;
          product_id: string;
          bom_id: string | null;
          requested_qty_scaled: number;
          status: string;
          product_name: string;
          bom_version: string;
        }
      | undefined;

    if (!pr) {
      throw new HttpError(404, `Production request ${requestId} not found.`);
    }
    if (
      pr.status === 'COMPLETED' ||
      pr.status === 'PARTIALLY_COMPLETED' ||
      pr.status === 'CANCELLED'
    ) {
      throw new HttpError(400, `Cannot check availability on ${pr.status} request.`);
    }

    const { bomHeader, lines: rawBomLines } = getProductBomSnapshot(
      db,
      pr.product_id,
      pr.bom_id
    );
    const effectiveBomVersion = bomHeader?.bom_version || pr.bom_version || 'v1.0';
    const bomLines = rawBomLines.map((l) => ({
      material_id: l.material_id,
      quantity_per_unit_scaled: l.quantity_per_unit_scaled,
      sku: l.material_code,
      name: l.material_name,
      unit: l.material_unit,
      category: l.category,
      available_scaled: l.available_scaled,
    }));

    const nowIso = new Date().toISOString();
    let hasShortage = false;
    const bomBreakdown: Array<{
      materialId: string;
      materialCode: string;
      materialName: string;
      category: string;
      unit: string;
      quantityPerUnit: number;
      requiredQuantity: number;
      availableStock: number;
      shortfallQuantity: number;
      isSufficient: boolean;
    }> = [];

    for (const line of bomLines) {
      const reqScaled = Math.round(
        (pr.requested_qty_scaled * line.quantity_per_unit_scaled) / 10000
      );
      const availScaled = Math.max(0, line.available_scaled);
      const shortfallScaled = Math.max(0, reqScaled - availScaled);
      const isSufficient = shortfallScaled === 0;
      if (!isSufficient) {
        hasShortage = true;
      }

      const existingQuery = db
        .prepare(
          `SELECT id, status FROM material_shortage_queries
           WHERE production_request_id = ? AND material_id = ?`
        )
        .get(pr.id, line.material_id) as { id: string; status: string } | undefined;

      if (!isSufficient) {
        if (existingQuery) {
          const nextQStatus =
            existingQuery.status === 'RESOLVED' ? 'OPEN' : existingQuery.status;
          db.prepare(
            `UPDATE material_shortage_queries
             SET required_qty_scaled = ?, available_qty_scaled = ?, shortage_qty_scaled = ?,
                 status = ?, updated_at = ?
             WHERE id = ?`
          ).run(reqScaled, availScaled, shortfallScaled, nextQStatus, nowIso, existingQuery.id);
        } else {
          db.prepare(
            `INSERT INTO material_shortage_queries (
              id, query_number, production_request_id, order_id, material_id,
              required_qty_scaled, available_qty_scaled, shortage_qty_scaled, status, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
          ).run(
            uid('msq'),
            nextSequenceNumber(db, 'material_shortage_queries', 'query_number', 'MSQ-2026-'),
            pr.id,
            pr.order_id,
            line.material_id,
            reqScaled,
            availScaled,
            shortfallScaled,
            `Detected by ${actor.fullName} during availability check`,
            nowIso,
            nowIso
          );
        }
      } else if (existingQuery && existingQuery.status !== 'RESOLVED') {
        db.prepare(
          `UPDATE material_shortage_queries
           SET available_qty_scaled = ?, shortage_qty_scaled = 0, status = 'RESOLVED', updated_at = ?
           WHERE id = ?`
        ).run(availScaled, nowIso, existingQuery.id);
      }

      bomBreakdown.push({
        materialId: line.material_id,
        materialCode: line.sku,
        materialName: line.name,
        category: line.category,
        unit: line.unit,
        quantityPerUnit: fromScaledQty(line.quantity_per_unit_scaled),
        requiredQuantity: fromScaledQty(reqScaled),
        availableStock: fromScaledQty(availScaled),
        shortfallQuantity: fromScaledQty(shortfallScaled),
        isSufficient,
      });
    }

    let nextStatus = pr.status;
    let supervisorStatus = 'Checked';
    if (hasShortage) {
      if (pr.status !== 'IN_PROGRESS') {
        nextStatus = 'MATERIAL_SHORTAGE';
        supervisorStatus = 'Material Shortage';
      }
    } else if (pr.status !== 'IN_PROGRESS') {
      nextStatus = 'READY_FOR_PRODUCTION';
      supervisorStatus = 'Ready for Production';
    } else {
      supervisorStatus = 'In Progress';
    }

    db.prepare(
      `UPDATE production_requests
       SET status = ?, assigned_supervisor_id = ?, supervisor_status = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, actor.id, supervisorStatus, nowIso, pr.id);

    recordAuditLog(
      db,
      actor,
      'PRODUCTION_REQUEST',
      pr.id,
      'CHECK_MATERIAL_AVAILABILITY',
      `${pr.request_number} (${pr.product_name}, BOM ${pr.bom_version}): ${
        hasShortage ? 'MATERIAL_SHORTAGE' : 'SUFFICIENT -> READY_FOR_PRODUCTION'
      }`
    );

    return {
      productionRequestId: pr.id,
      requestNumber: pr.request_number,
      bomVersion: effectiveBomVersion,
      rawMaterialAvailability: hasShortage ? ('INSUFFICIENT' as const) : ('SUFFICIENT' as const),
      nextStatus,
      bomBreakdown,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Material Purchase Requirements & Owner PO Approval
// ---------------------------------------------------------------------------

export function listMaterialPurchaseRequirements(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);

  const rows = db
    .prepare(
      `SELECT mpr.*, m.name AS material_name, m.sku AS material_sku, m.unit, m.category,
              sb.quantity_scaled AS current_stock_scaled,
              pr.request_number, pr.order_id, o.order_number,
              po.po_number, po.status AS po_status, po.approval_status AS po_approval_status,
              po.estimated_total_paise AS po_estimated_total_paise
       FROM material_purchase_requirements mpr
       JOIN inventory_items m ON m.id = mpr.material_id
       JOIN stock_balances sb ON sb.item_id = m.id
       JOIN production_requests pr ON pr.id = mpr.production_request_id
       JOIN orders o ON o.id = pr.order_id
       LEFT JOIN purchase_orders po ON po.id = mpr.purchase_order_id
       ORDER BY mpr.created_at DESC`
    )
    .all() as Array<{
    id: string;
    requirement_number: string;
    material_id: string;
    material_name: string;
    material_sku: string;
    unit: string;
    category: string;
    current_stock_scaled: number;
    production_request_id: string;
    request_number: string;
    order_id: string;
    order_number: string;
    required_qty_scaled: number;
    available_qty_scaled: number;
    shortage_qty_scaled: number;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    reason: string;
    status: string;
    purchase_order_id: string | null;
    po_number: string | null;
    po_status: string | null;
    po_approval_status: string | null;
    po_estimated_total_paise: number | null;
    requested_by_name: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    requirementNumber: r.requirement_number,
    materialId: r.material_id,
    materialName: r.material_name,
    materialSku: r.material_sku,
    unit: r.unit,
    category: r.category,
    currentStock: fromScaledQty(r.current_stock_scaled),
    productionRequestId: r.production_request_id,
    requestNumber: r.request_number,
    orderId: r.order_id,
    orderNumber: r.order_number,
    requiredQuantity: fromScaledQty(r.required_qty_scaled),
    availableQuantity: fromScaledQty(r.available_qty_scaled),
    shortageQuantity: fromScaledQty(r.shortage_qty_scaled),
    priority: r.priority,
    reason: r.reason || undefined,
    status: r.status,
    purchaseOrderId: r.purchase_order_id || undefined,
    poNumber: r.po_number || undefined,
    poStatus: r.po_status || undefined,
    poApprovalStatus: r.po_approval_status || undefined,
    poEstimatedTotal:
      r.po_estimated_total_paise !== null ? fromPaise(r.po_estimated_total_paise) : undefined,
    requestedByName: r.requested_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function createMaterialPurchaseRequirement(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    productionRequestId: string;
    materialId: string;
    requiredQuantity?: number;
    shortageQuantity?: number;
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    reason?: string;
  }
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  const priority = input.priority || 'NORMAL';
  if (!['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority)) {
    throw new HttpError(400, 'Invalid priority level.');
  }

  return runInTransaction(db, () => {
    const pr = db
      .prepare(
        `SELECT id, request_number, order_id, product_id, bom_id, requested_qty_scaled, status
         FROM production_requests WHERE id = ?`
      )
      .get(input.productionRequestId) as
      | {
          id: string;
          request_number: string;
          order_id: string;
          product_id: string;
          bom_id: string | null;
          requested_qty_scaled: number;
          status: string;
        }
      | undefined;

    if (!pr) {
      throw new HttpError(404, `Production request ${input.productionRequestId} not found.`);
    }

    const mat = db
      .prepare(
        `SELECT ii.id, ii.name, ii.sku, ii.category, sb.quantity_scaled AS available_scaled
         FROM inventory_items ii
         JOIN stock_balances sb ON sb.item_id = ii.id
         WHERE ii.id = ?`
      )
      .get(input.materialId) as
      | {
          id: string;
          name: string;
          sku: string;
          category: string;
          available_scaled: number;
        }
      | undefined;

    if (!mat || mat.category === 'FINISHED_GOOD') {
      throw new HttpError(400, 'Purchase requirements can only be raised for raw or packaging materials.');
    }

    const dup = db
      .prepare(
        `SELECT id, requirement_number FROM material_purchase_requirements
         WHERE production_request_id = ? AND material_id = ? AND status NOT IN ('RECEIVED', 'CANCELLED')`
      )
      .get(pr.id, mat.id) as { id: string; requirement_number: string } | undefined;

    if (dup) {
      throw new HttpError(
        409,
        `Active purchase requirement ${dup.requirement_number} already exists for ${mat.name} on ${pr.request_number}.`
      );
    }

    const { lines: bomSnapshotLines } = getProductBomSnapshot(db, pr.product_id, pr.bom_id);
    const bomLine = bomSnapshotLines.find((l) => l.material_id === mat.id);

    const bomReqScaled = bomLine
      ? Math.round((pr.requested_qty_scaled * bomLine.quantity_per_unit_scaled) / 10000)
      : 0;
    const availScaled = Math.max(0, mat.available_scaled);

    let requiredScaled =
      input.requiredQuantity && input.requiredQuantity > 0
        ? toScaledQty(input.requiredQuantity)
        : bomReqScaled;
    let shortageScaled =
      input.shortageQuantity && input.shortageQuantity > 0
        ? toScaledQty(input.shortageQuantity)
        : Math.max(0, requiredScaled - availScaled);

    if (requiredScaled <= 0 && shortageScaled > 0) {
      requiredScaled = availScaled + shortageScaled;
    }
    if (shortageScaled <= 0) {
      throw new HttpError(
        400,
        `${mat.name} currently has sufficient stock (${fromScaledQty(availScaled)}) or requested shortfall must be greater than zero.`
      );
    }

    const nowIso = new Date().toISOString();
    const id = uid('mpr');
    const reqNum = nextSequenceNumber(
      db,
      'material_purchase_requirements',
      'requirement_number',
      'MPR-2026-'
    );

    db.prepare(
      `INSERT INTO material_purchase_requirements (
        id, requirement_number, material_id, production_request_id,
        required_qty_scaled, available_qty_scaled, shortage_qty_scaled,
        priority, reason, status, purchase_order_id,
        requested_by_user_id, requested_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED_TO_PROCUREMENT', NULL, ?, ?, ?, ?)`
    ).run(
      id,
      reqNum,
      mat.id,
      pr.id,
      requiredScaled,
      availScaled,
      shortageScaled,
      priority,
      input.reason?.trim() || `Required for ${pr.request_number}`,
      actor.id,
      actor.fullName,
      nowIso,
      nowIso
    );

    // Sync material_shortage_queries -> PROCUREMENT_REQUESTED
    const existingMsq = db
      .prepare(
        `SELECT id FROM material_shortage_queries WHERE production_request_id = ? AND material_id = ?`
      )
      .get(pr.id, mat.id) as { id: string } | undefined;

    if (existingMsq) {
      db.prepare(
        `UPDATE material_shortage_queries
         SET required_qty_scaled = ?, available_qty_scaled = ?, shortage_qty_scaled = ?,
             status = 'PROCUREMENT_REQUESTED', updated_at = ?
         WHERE id = ?`
      ).run(requiredScaled, availScaled, shortageScaled, nowIso, existingMsq.id);
    } else {
      db.prepare(
        `INSERT INTO material_shortage_queries (
          id, query_number, production_request_id, order_id, material_id,
          required_qty_scaled, available_qty_scaled, shortage_qty_scaled, status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROCUREMENT_REQUESTED', ?, ?, ?)`
      ).run(
        uid('msq'),
        nextSequenceNumber(db, 'material_shortage_queries', 'query_number', 'MSQ-2026-'),
        pr.id,
        pr.order_id,
        mat.id,
        requiredScaled,
        availScaled,
        shortageScaled,
        `Purchase requirement ${reqNum} raised by ${actor.fullName}`,
        nowIso,
        nowIso
      );
    }

    if (
      pr.status === 'PENDING_SUPERVISOR_REVIEW' ||
      pr.status === 'PENDING_MATERIAL_CHECK'
    ) {
      db.prepare(
        `UPDATE production_requests
         SET status = 'MATERIAL_SHORTAGE', supervisor_status = 'Material Shortage · Procurement Requested', updated_at = ?
         WHERE id = ?`
      ).run(nowIso, pr.id);
    }

    recordAuditLog(
      db,
      actor,
      'PURCHASE_REQUIREMENT',
      id,
      'RAISE_PURCHASE_REQUIREMENT',
      `${reqNum} for ${mat.name} (shortfall ${fromScaledQty(shortageScaled)}, priority ${priority}) on ${pr.request_number}`
    );

    return { id, requirementNumber: reqNum };
  });
}

export function approvePurchaseOrderByOwner(
  db: DatabaseSync,
  actor: AuthUser,
  poId: string,
  approve: boolean,
  note?: string
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  const cleanNote = (note ?? '').trim();
  if (!approve && !cleanNote) {
    throw new HttpError(400, 'Rejection reason is required when rejecting a purchase request.');
  }

  return runInTransaction(db, () => {
    const po = db
      .prepare(`SELECT * FROM purchase_orders WHERE id = ?`)
      .get(poId) as
      | {
          id: string;
          po_number: string;
          approval_status: string;
          estimated_total_paise: number;
          status: string;
        }
      | undefined;

    if (!po) {
      throw new HttpError(404, `Purchase order ${poId} not found.`);
    }
    if (po.approval_status !== 'PENDING_OWNER_APPROVAL') {
      throw new HttpError(
        400,
        `Purchase order ${po.po_number} is already ${po.approval_status} and cannot be re-processed.`
      );
    }

    const nowIso = new Date().toISOString();
    const nextApprovalStatus = approve ? 'APPROVED' : 'REJECTED';

    db.prepare(
      `UPDATE purchase_orders
       SET approval_status = ?, approved_by = ?, approved_at = ?,
           rejection_reason = ?,
           status = CASE WHEN ? = 0 THEN 'CANCELLED' ELSE status END,
           notes = CASE WHEN ? != '' THEN notes || ' | Owner: ' || ? ELSE notes END,
           updated_at = ?
       WHERE id = ?`
    ).run(
      nextApprovalStatus,
      actor.fullName,
      nowIso,
      approve ? '' : cleanNote,
      approve ? 1 : 0,
      cleanNote,
      cleanNote,
      nowIso,
      po.id
    );

    if (approve) {
      db.prepare(
        `UPDATE material_purchase_requirements
         SET status = 'APPROVED_FOR_PURCHASE', updated_at = ?
         WHERE purchase_order_id = ? AND status = 'AWAITING_OWNER_APPROVAL'`
      ).run(nowIso, po.id);
    } else {
      db.prepare(
        `UPDATE material_purchase_requirements
         SET status = 'SUBMITTED_TO_PROCUREMENT', purchase_order_id = NULL, updated_at = ?
         WHERE purchase_order_id = ? AND status = 'AWAITING_OWNER_APPROVAL'`
      ).run(nowIso, po.id);
    }

    recordAuditLog(
      db,
      actor,
      'PURCHASE_ORDER',
      po.id,
      approve ? 'OWNER_APPROVE_PO' : 'OWNER_REJECT_PO',
      `${po.po_number} (₹${fromPaise(po.estimated_total_paise)}): ${nextApprovalStatus}${cleanNote ? ` — ${cleanNote}` : ''}`
    );

    return {
      id: po.id,
      poNumber: po.po_number,
      approvalStatus: nextApprovalStatus,
      approvedBy: actor.fullName,
      approvedAt: nowIso,
      rejectionReason: approve ? undefined : cleanNote,
    };
  });
}

// ---------------------------------------------------------------------------
// 4. Stock Discrepancy Reporting (Supervisor submits; Admin/Owner approves)
// ---------------------------------------------------------------------------

export function listStockDiscrepancyReports(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);

  const rows = db
    .prepare(
      `SELECT sdr.*, ii.name AS item_name, ii.sku, ii.unit, ii.category
       FROM stock_discrepancy_reports sdr
       JOIN inventory_items ii ON ii.id = sdr.item_id
       ORDER BY sdr.created_at DESC`
    )
    .all() as Array<{
    id: string;
    report_number: string;
    item_id: string;
    item_name: string;
    sku: string;
    unit: string;
    category: string;
    system_qty_scaled: number;
    physical_qty_scaled: number;
    difference_scaled: number;
    reason: string;
    status: 'OPEN' | 'APPROVED' | 'REJECTED';
    reported_by_name: string;
    reviewed_by_name: string;
    review_note: string;
    created_at: string;
    reviewed_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    reportNumber: r.report_number,
    itemId: r.item_id,
    itemName: r.item_name,
    sku: r.sku,
    unit: r.unit,
    category: r.category,
    systemQuantity: fromScaledQty(r.system_qty_scaled),
    physicalQuantity: fromScaledQty(r.physical_qty_scaled),
    differenceQuantity: fromScaledQty(r.difference_scaled),
    reason: r.reason,
    status: r.status,
    reportedByName: r.reported_by_name,
    reviewedByName: r.reviewed_by_name || undefined,
    reviewNote: r.review_note || undefined,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at || undefined,
  }));
}

export function createStockDiscrepancyReport(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    itemId: string;
    physicalQuantity: number;
    reason: string;
  }
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  if (!input.itemId?.trim()) {
    throw new HttpError(400, 'Material or product item is required.');
  }
  if (!Number.isFinite(input.physicalQuantity) || input.physicalQuantity < 0) {
    throw new HttpError(400, 'Physical count must be zero or greater.');
  }
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    throw new HttpError(400, 'Please provide a reason for the stock discrepancy.');
  }

  return runInTransaction(db, () => {
    const item = db
      .prepare(
        `SELECT ii.id, ii.name, ii.sku, sb.quantity_scaled AS system_qty_scaled
         FROM inventory_items ii
         JOIN stock_balances sb ON sb.item_id = ii.id
         WHERE ii.id = ?`
      )
      .get(input.itemId) as
      | { id: string; name: string; sku: string; system_qty_scaled: number }
      | undefined;

    if (!item) {
      throw new HttpError(404, `Inventory item ${input.itemId} not found.`);
    }

    const physicalScaled = toScaledQty(input.physicalQuantity);
    const diffScaled = physicalScaled - item.system_qty_scaled;
    const nowIso = new Date().toISOString();
    const id = uid('sdr');
    const reportNumber = nextSequenceNumber(
      db,
      'stock_discrepancy_reports',
      'report_number',
      'SDR-2026-'
    );

    db.prepare(
      `INSERT INTO stock_discrepancy_reports (
        id, report_number, item_id, system_qty_scaled, physical_qty_scaled,
        difference_scaled, reason, status, reported_by_user_id, reported_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
    ).run(
      id,
      reportNumber,
      item.id,
      item.system_qty_scaled,
      physicalScaled,
      diffScaled,
      reason,
      actor.id,
      actor.fullName,
      nowIso
    );

    recordAuditLog(
      db,
      actor,
      'STOCK_DISCREPANCY',
      id,
      'REPORT_STOCK_DISCREPANCY',
      `${reportNumber} on ${item.name}: system ${fromScaledQty(item.system_qty_scaled)} vs physical ${fromScaledQty(physicalScaled)}`
    );

    return { id, reportNumber, differenceQuantity: fromScaledQty(diffScaled) };
  });
}

export function reviewStockDiscrepancyReport(
  db: DatabaseSync,
  actor: AuthUser,
  reportId: string,
  decision: 'APPROVE' | 'REJECT',
  note?: string
) {
  requireRole(actor, ['ADMIN']);

  return runInTransaction(db, () => {
    const rep = db
      .prepare(
        `SELECT sdr.*, ii.name AS item_name, sb.quantity_scaled AS live_qty_scaled
         FROM stock_discrepancy_reports sdr
         JOIN inventory_items ii ON ii.id = sdr.item_id
         JOIN stock_balances sb ON sb.item_id = sdr.item_id
         WHERE sdr.id = ?`
      )
      .get(reportId) as
      | {
          id: string;
          report_number: string;
          item_id: string;
          item_name: string;
          system_qty_scaled: number;
          physical_qty_scaled: number;
          difference_scaled: number;
          live_qty_scaled: number;
          reason: string;
          status: string;
        }
      | undefined;

    if (!rep) {
      throw new HttpError(404, `Stock discrepancy report ${reportId} not found.`);
    }
    if (rep.status !== 'OPEN') {
      throw new HttpError(400, `Report ${rep.report_number} is already ${rep.status}.`);
    }

    const nowIso = new Date().toISOString();
    const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    if (decision === 'APPROVE') {
      const deltaScaled = rep.physical_qty_scaled - rep.live_qty_scaled;
      if (deltaScaled !== 0) {
        applyStockMovement(db, {
          itemId: rep.item_id,
          movementType: 'DISCREPANCY_ADJUSTMENT',
          direction: deltaScaled > 0 ? 'IN' : 'OUT',
          qtyScaled: Math.abs(deltaScaled),
          referenceType: 'DISCREPANCY_REPORT',
          referenceId: rep.id,
          referenceNumber: rep.report_number,
          reason: `Approved discrepancy ${rep.report_number}: ${rep.reason}`,
          actor,
          nowIso,
        });
        recalculateOpenShortageQueries(db, nowIso);
      }
    }

    db.prepare(
      `UPDATE stock_discrepancy_reports
       SET status = ?, reviewed_by_user_id = ?, reviewed_by_name = ?, review_note = ?, reviewed_at = ?
       WHERE id = ?`
    ).run(nextStatus, actor.id, actor.fullName, note?.trim() || '', nowIso, rep.id);

    recordAuditLog(
      db,
      actor,
      'STOCK_DISCREPANCY',
      rep.id,
      `DISCREPANCY_${nextStatus}`,
      `${rep.report_number} (${rep.item_name}): ${nextStatus}${note ? ` — ${note}` : ''}`
    );

    return { id: rep.id, reportNumber: rep.report_number, status: nextStatus };
  });
}

// ---------------------------------------------------------------------------
// 5. BOM Revision Requests (Supervisor submits; Admin/Owner approves & bumps version)
// ---------------------------------------------------------------------------

export function listBomRevisionRequests(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);

  const rows = db
    .prepare(
      `SELECT brr.*, p.name AS product_name, p.sku AS product_sku, p.unit AS product_unit,
              m.name AS material_name, m.sku AS material_sku, m.unit AS material_unit,
              prun.run_number
       FROM bom_revision_requests brr
       JOIN inventory_items p ON p.id = brr.product_id
       JOIN inventory_items m ON m.id = brr.material_id
       LEFT JOIN production_runs prun ON prun.id = brr.production_run_id
       ORDER BY brr.created_at DESC`
    )
    .all() as Array<{
    id: string;
    request_number: string;
    product_id: string;
    product_name: string;
    product_sku: string;
    product_unit: string;
    bom_version: string;
    material_id: string;
    material_name: string;
    material_sku: string;
    material_unit: string;
    current_qty_per_unit_scaled: number;
    suggested_qty_per_unit_scaled: number;
    production_run_id: string | null;
    run_number: string | null;
    reason: string;
    status: 'PENDING_ADMIN_REVIEW' | 'APPROVED' | 'REJECTED';
    affects_costing_or_tax: number;
    accountant_verification_status: string;
    accountant_verified_by: string;
    owner_approval_status: string;
    owner_approved_by: string;
    owner_approved_at: string;
    requested_by_name: string;
    reviewed_by_name: string;
    review_note: string;
    created_at: string;
    reviewed_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    requestNumber: r.request_number,
    productId: r.product_id,
    productName: r.product_name,
    productSku: r.product_sku,
    productUnit: r.product_unit,
    bomVersion: r.bom_version,
    materialId: r.material_id,
    materialName: r.material_name,
    materialSku: r.material_sku,
    materialUnit: r.material_unit,
    currentQuantityPerUnit: fromScaledQty(r.current_qty_per_unit_scaled),
    suggestedQuantityPerUnit: fromScaledQty(r.suggested_qty_per_unit_scaled),
    productionRunId: r.production_run_id || undefined,
    runNumber: r.run_number || undefined,
    reason: r.reason,
    status: r.status,
    affectsCostingOrTax: r.affects_costing_or_tax === 1,
    accountantVerificationStatus: r.accountant_verification_status || 'NOT_REQUIRED',
    accountantVerifiedBy: r.accountant_verified_by || undefined,
    ownerApprovalStatus: r.owner_approval_status || 'PENDING_OWNER_APPROVAL',
    ownerApprovedBy: r.owner_approved_by || undefined,
    ownerApprovedAt: r.owner_approved_at || undefined,
    requestedByName: r.requested_by_name,
    reviewedByName: r.reviewed_by_name || undefined,
    reviewNote: r.review_note || undefined,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at || undefined,
  }));
}

export function createBomRevisionRequest(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    productId: string;
    materialId: string;
    suggestedQuantityPerUnit: number;
    productionRunId?: string;
    affectsCostingOrTax?: boolean;
    reason: string;
  }
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  if (!input.productId?.trim() || !input.materialId?.trim()) {
    throw new HttpError(400, 'Product and material are required.');
  }
  if (!Number.isFinite(input.suggestedQuantityPerUnit) || input.suggestedQuantityPerUnit <= 0) {
    throw new HttpError(400, 'Suggested quantity per unit must be greater than zero.');
  }
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    throw new HttpError(400, 'Please explain why this BOM revision is needed.');
  }

  return runInTransaction(db, () => {
    const product = db
      .prepare(`SELECT id, name, bom_version FROM inventory_items WHERE id = ? AND category = 'FINISHED_GOOD'`)
      .get(input.productId) as { id: string; name: string; bom_version: string } | undefined;
    if (!product) {
      throw new HttpError(404, `Finished good ${input.productId} not found.`);
    }

    const { bomHeader, lines: approvedBomLines } = getProductBomSnapshot(db, product.id);
    const bomLine = approvedBomLines.find((l) => l.material_id === input.materialId);
    if (!bomLine) {
      throw new HttpError(404, 'Specified material is not part of the product official BOM.');
    }

    const nowIso = new Date().toISOString();
    const id = uid('bomr');
    const requestNumber = nextSequenceNumber(
      db,
      'bom_revision_requests',
      'request_number',
      'BOMR-2026-'
    );
    const affectsCostTax = input.affectsCostingOrTax ? 1 : 0;

    db.prepare(
      `INSERT INTO bom_revision_requests (
        id, request_number, product_id, bom_version, material_id,
        current_qty_per_unit_scaled, suggested_qty_per_unit_scaled,
        production_run_id, reason, status,
        affects_costing_or_tax, accountant_verification_status, owner_approval_status,
        requested_by_user_id, requested_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_ADMIN_REVIEW', ?, ?, 'PENDING_OWNER_APPROVAL', ?, ?, ?)`
    ).run(
      id,
      requestNumber,
      product.id,
      bomHeader?.bom_version || product.bom_version || 'v1.0',
      input.materialId,
      bomLine.quantity_per_unit_scaled,
      toScaledQty(input.suggestedQuantityPerUnit),
      input.productionRunId || null,
      reason,
      affectsCostTax,
      affectsCostTax ? 'PENDING_ACCOUNTANT_REVIEW' : 'NOT_REQUIRED',
      actor.id,
      actor.fullName,
      nowIso
    );

    recordAuditLog(
      db,
      actor,
      'BOM_REVISION',
      id,
      'REQUEST_BOM_REVISION',
      `${requestNumber} for ${product.name} (${bomHeader?.bom_version || product.bom_version || 'v1.0'}): suggested ${input.suggestedQuantityPerUnit} per unit`
    );

    return { id, requestNumber };
  });
}

export function verifyBomRevisionCostingByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  revisionId: string,
  approve: boolean,
  note?: string
) {
  requireRole(actor, ['ACCOUNTANT']);
  return runInTransaction(db, () => {
    const reqRow = db
      .prepare(`SELECT id, request_number, status FROM bom_revision_requests WHERE id = ?`)
      .get(revisionId) as { id: string; request_number: string; status: string } | undefined;
    if (!reqRow) throw new HttpError(404, 'BOM revision request not found.');
    if (reqRow.status !== 'PENDING_ADMIN_REVIEW') {
      throw new HttpError(400, `BOM revision ${reqRow.request_number} is already ${reqRow.status}.`);
    }
    const status = approve ? 'VERIFIED' : 'RETURNED';
    db.prepare(
      `UPDATE bom_revision_requests
       SET accountant_verification_status = ?, accountant_verified_by = ?, review_note = COALESCE(NULLIF(?, ''), review_note)
       WHERE id = ?`
    ).run(status, actor.fullName, note?.trim() || '', revisionId);
    recordAuditLog(db, actor, 'BOM_REVISION', revisionId, `BOM_REVISION_ACCOUNTANT_${status}`, reqRow.request_number);
    return { id: revisionId, requestNumber: reqRow.request_number, accountantVerificationStatus: status };
  });
}

export function approveBomRevisionByOwner(
  db: DatabaseSync,
  actor: AuthUser,
  revisionId: string,
  approve: boolean,
  note?: string
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);
  return runInTransaction(db, () => {
    const reqRow = db
      .prepare(
        `SELECT id, request_number, status, affects_costing_or_tax, accountant_verification_status
         FROM bom_revision_requests WHERE id = ?`
      )
      .get(revisionId) as
      | {
          id: string;
          request_number: string;
          status: string;
          affects_costing_or_tax: number;
          accountant_verification_status: string;
        }
      | undefined;
    if (!reqRow) throw new HttpError(404, 'BOM revision request not found.');
    if (reqRow.status !== 'PENDING_ADMIN_REVIEW') {
      throw new HttpError(400, `BOM revision ${reqRow.request_number} is already ${reqRow.status}.`);
    }
    if (
      approve &&
      reqRow.affects_costing_or_tax === 1 &&
      reqRow.accountant_verification_status !== 'VERIFIED'
    ) {
      throw new HttpError(
        400,
        'Accountant costing/tax verification is required before Owner approval for this BOM revision.'
      );
    }

    const nowIso = new Date().toISOString();
    const nextOwnerStatus = approve ? 'APPROVED' : 'REJECTED';
    if (!approve) {
      if (!note?.trim()) {
        throw new HttpError(400, 'Rejection remarks are required.');
      }
      db.prepare(
        `UPDATE bom_revision_requests
         SET owner_approval_status = 'REJECTED', owner_approved_by = ?, owner_approved_at = ?,
             status = 'REJECTED', review_note = ?, reviewed_by_name = ?, reviewed_at = ?
         WHERE id = ?`
      ).run(actor.fullName, nowIso, note.trim(), actor.fullName, nowIso, revisionId);
    } else {
      db.prepare(
        `UPDATE bom_revision_requests
         SET owner_approval_status = 'APPROVED', owner_approved_by = ?, owner_approved_at = ?
         WHERE id = ?`
      ).run(actor.fullName, nowIso, revisionId);
    }

    recordAuditLog(
      db,
      actor,
      'BOM_REVISION',
      revisionId,
      `BOM_REVISION_OWNER_${nextOwnerStatus}`,
      `${reqRow.request_number}${note?.trim() ? `: ${note.trim()}` : ''}`
    );
    return { id: revisionId, requestNumber: reqRow.request_number, ownerApprovalStatus: nextOwnerStatus };
  });
}

export function reviewBomRevisionRequest(
  db: DatabaseSync,
  actor: AuthUser,
  revisionId: string,
  decision: 'APPROVE' | 'REJECT',
  note?: string
) {
  requireRole(actor, ['ADMIN']);

  return runInTransaction(db, () => {
    const reqRow = db
      .prepare(
        `SELECT brr.*, p.name AS product_name, p.bom_version AS live_bom_version
         FROM bom_revision_requests brr
         JOIN inventory_items p ON p.id = brr.product_id
         WHERE brr.id = ?`
      )
      .get(revisionId) as
      | {
          id: string;
          request_number: string;
          product_id: string;
          product_name: string;
          live_bom_version: string;
          material_id: string;
          suggested_qty_per_unit_scaled: number;
          status: string;
          owner_approval_status: string;
          affects_costing_or_tax: number;
          accountant_verification_status: string;
        }
      | undefined;

    if (!reqRow) {
      throw new HttpError(404, `BOM revision request ${revisionId} not found.`);
    }
    if (reqRow.status !== 'PENDING_ADMIN_REVIEW') {
      throw new HttpError(400, `BOM revision ${reqRow.request_number} is already ${reqRow.status}.`);
    }
    if (decision === 'APPROVE') {
      if (reqRow.owner_approval_status !== 'APPROVED') {
        throw new HttpError(
          403,
          `BOM revision ${reqRow.request_number} requires Owner approval before Admin can register the new BOM version.`
        );
      }
      if (
        reqRow.affects_costing_or_tax === 1 &&
        reqRow.accountant_verification_status !== 'VERIFIED'
      ) {
        throw new HttpError(
          403,
          `BOM revision ${reqRow.request_number} requires Accountant costing/tax verification first.`
        );
      }
    }

    const nowIso = new Date().toISOString();
    const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const { bomHeader: currentHeader, lines: currentLines } = getProductBomSnapshot(
      db,
      reqRow.product_id
    );
    let newVersion = currentHeader?.bom_version || reqRow.live_bom_version || 'v1.0';

    if (decision === 'APPROVE') {
      newVersion = bumpBomVersion(newVersion);
      while (
        db
          .prepare(`SELECT 1 FROM boms WHERE product_id = ? AND bom_version = ?`)
          .get(reqRow.product_id, newVersion)
      ) {
        newVersion = bumpBomVersion(newVersion);
      }

      if (currentHeader) {
        db.prepare(
          `UPDATE boms SET approval_status = 'ARCHIVED', updated_at = ? WHERE id = ?`
        ).run(nowIso, currentHeader.id);
      }

      const newBomId = uid('bomhdr');
      db.prepare(
        `INSERT INTO boms (
          id, product_id, bom_version, approval_status, quantity_basis,
          effective_date, notes, approved_by, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 'APPROVED', 'PER_UNIT', ?, ?, ?, ?, ?, ?)`
      ).run(
        newBomId,
        reqRow.product_id,
        newVersion,
        nowIso.slice(0, 10),
        `Approved BOM revision ${reqRow.request_number}`,
        actor.fullName,
        actor.fullName,
        nowIso,
        nowIso
      );

      const insertItem = db.prepare(
        `INSERT INTO bom_items (id, bom_id, product_id, material_id, quantity_per_unit_scaled, unit, quantity_basis)
         VALUES (?, ?, ?, ?, ?, ?, 'PER_UNIT')`
      );
      for (const line of currentLines) {
        const qtyScaled =
          line.material_id === reqRow.material_id
            ? reqRow.suggested_qty_per_unit_scaled
            : line.quantity_per_unit_scaled;
        insertItem.run(
          uid('bom'),
          newBomId,
          reqRow.product_id,
          line.material_id,
          qtyScaled,
          line.material_unit
        );
      }

      db.prepare(
        `UPDATE inventory_items SET bom_version = ?, updated_at = ? WHERE id = ?`
      ).run(newVersion, nowIso, reqRow.product_id);
    }

    db.prepare(
      `UPDATE bom_revision_requests
       SET status = ?, reviewed_by_name = ?, review_note = ?, reviewed_at = ?
       WHERE id = ?`
    ).run(nextStatus, actor.fullName, note?.trim() || '', nowIso, reqRow.id);

    recordAuditLog(
      db,
      actor,
      'BOM_REVISION',
      reqRow.id,
      `BOM_REVISION_${nextStatus}`,
      `${reqRow.request_number} (${reqRow.product_name}): ${nextStatus}${decision === 'APPROVE' ? ` -> BOM ${newVersion}` : ''}`
    );

    return { id: reqRow.id, requestNumber: reqRow.request_number, status: nextStatus, bomVersion: newVersion };
  });
}

// ---------------------------------------------------------------------------
// 6. Unposted Production Run Drafts & Variance Explanation
// ---------------------------------------------------------------------------

export function getProductionRunDraft(
  db: DatabaseSync,
  actor: AuthUser,
  requestId: string
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);
  const row = db
    .prepare(`SELECT * FROM production_run_drafts WHERE production_request_id = ?`)
    .get(requestId) as
    | {
        production_request_id: string;
        payload_json: string;
        updated_by_name: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;
  try {
    return {
      productionRequestId: row.production_request_id,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      updatedByName: row.updated_by_name,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function saveProductionRunDraft(
  db: DatabaseSync,
  actor: AuthUser,
  requestId: string,
  payload: Record<string, unknown>
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  const pr = db
    .prepare(`SELECT id, request_number, status FROM production_requests WHERE id = ?`)
    .get(requestId) as { id: string; request_number: string; status: string } | undefined;

  if (!pr) {
    throw new HttpError(404, `Production request ${requestId} not found.`);
  }
  if (pr.status === 'COMPLETED' || pr.status === 'PARTIALLY_COMPLETED' || pr.status === 'CANCELLED') {
    throw new HttpError(400, `Cannot save draft for ${pr.status} request.`);
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO production_run_drafts (
      production_request_id, payload_json, updated_by_user_id, updated_by_name, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(production_request_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_by_name = excluded.updated_by_name,
      updated_at = excluded.updated_at`
  ).run(pr.id, JSON.stringify(payload ?? {}), actor.id, actor.fullName, nowIso);

  return { productionRequestId: pr.id, updatedAt: nowIso };
}

export function updateRunVarianceExplanation(
  db: DatabaseSync,
  actor: AuthUser,
  runId: string,
  explanation: string
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);
  const run = db
    .prepare(`SELECT id, run_number FROM production_runs WHERE id = ?`)
    .get(runId) as { id: string; run_number: string } | undefined;
  if (!run) {
    throw new HttpError(404, `Production run ${runId} not found.`);
  }
  db.prepare(`UPDATE production_runs SET variance_explanation = ? WHERE id = ?`).run(
    (explanation ?? '').trim(),
    runId
  );
  recordAuditLog(
    db,
    actor,
    'PRODUCTION_RUN',
    runId,
    'UPDATE_VARIANCE_EXPLANATION',
    `${run.run_number}: ${(explanation ?? '').trim().slice(0, 120)}`
  );
  return { id: runId, varianceExplanation: (explanation ?? '').trim() };
}

// ---------------------------------------------------------------------------
// 7. New Material Proposals (Production Supervisor -> Admin Catalogue Review)
// ---------------------------------------------------------------------------

export function listMaterialProposals(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
  const rows = db
    .prepare(`SELECT * FROM material_proposals ORDER BY created_at DESC`)
    .all() as Array<{
    id: string;
    proposal_number: string;
    name: string;
    suggested_sku: string;
    category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
    unit: string;
    suggested_reorder_level_scaled: number;
    reason: string;
    status: 'PENDING_ADMIN_REVIEW' | 'APPROVED' | 'REJECTED';
    proposed_by_name: string;
    reviewed_by_name: string;
    review_note: string;
    created_material_id: string | null;
    created_at: string;
    reviewed_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    proposalNumber: r.proposal_number,
    name: r.name,
    suggestedSku: r.suggested_sku || undefined,
    category: r.category,
    unit: r.unit,
    suggestedReorderLevel: fromScaledQty(r.suggested_reorder_level_scaled),
    reason: r.reason,
    status: r.status,
    proposedByName: r.proposed_by_name,
    reviewedByName: r.reviewed_by_name || undefined,
    reviewNote: r.review_note || undefined,
    createdMaterialId: r.created_material_id || undefined,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at || undefined,
  }));
}

export function createMaterialProposal(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    name: string;
    suggestedSku?: string;
    category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
    unit: string;
    suggestedReorderLevel?: number;
    reason: string;
  }
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);
  const name = (input.name ?? '').trim();
  const unit = (input.unit ?? '').trim();
  const reason = (input.reason ?? '').trim();
  if (!name || !unit || !reason) {
    throw new HttpError(400, 'Material name, unit of measure, and justification reason are required.');
  }
  if (input.category !== 'RAW_MATERIAL' && input.category !== 'PACKAGING_MATERIAL') {
    throw new HttpError(400, 'Category must be RAW_MATERIAL or PACKAGING_MATERIAL.');
  }
  const reorderLevel = input.suggestedReorderLevel ?? 0;
  if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
    throw new HttpError(400, 'Suggested reorder level cannot be negative.');
  }

  return runInTransaction(db, () => {
    const id = uid('matp');
    const proposalNumber = nextSequenceNumber(
      db,
      'material_proposals',
      'proposal_number',
      'MATP-2026-'
    );
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO material_proposals (
        id, proposal_number, name, suggested_sku, category, unit,
        suggested_reorder_level_scaled, reason, status,
        proposed_by_user_id, proposed_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_ADMIN_REVIEW', ?, ?, ?)`
    ).run(
      id,
      proposalNumber,
      name,
      (input.suggestedSku ?? '').trim(),
      input.category,
      unit,
      toScaledQty(reorderLevel),
      reason,
      actor.id,
      actor.fullName,
      nowIso
    );

    recordAuditLog(
      db,
      actor,
      'MATERIAL_PROPOSAL',
      id,
      'PROPOSE_MATERIAL',
      `${proposalNumber}: ${name} (${input.category}, ${unit})`
    );

    return { id, proposalNumber };
  });
}

export function reviewMaterialProposal(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string,
  decision: 'APPROVE' | 'REJECT',
  input?: { sku?: string; reorderLevel?: number; note?: string }
) {
  requireRole(actor, ['ADMIN']);

  return runInTransaction(db, () => {
    const row = db
      .prepare(`SELECT * FROM material_proposals WHERE id = ?`)
      .get(proposalId) as
      | {
          id: string;
          proposal_number: string;
          name: string;
          suggested_sku: string;
          category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
          unit: string;
          suggested_reorder_level_scaled: number;
          status: string;
        }
      | undefined;
    if (!row) {
      throw new HttpError(404, `Material proposal ${proposalId} not found.`);
    }
    if (row.status !== 'PENDING_ADMIN_REVIEW') {
      throw new HttpError(400, `Proposal ${row.proposal_number} is already ${row.status}.`);
    }

    const nowIso = new Date().toISOString();
    const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    let createdMaterialId: string | null = null;

    if (decision === 'APPROVE') {
      const sku =
        (input?.sku ?? '').trim() ||
        row.suggested_sku.trim() ||
        nextSequenceNumber(
          db,
          'inventory_items',
          'sku',
          row.category === 'RAW_MATERIAL' ? 'RM-' : 'PKG-'
        );
      const dupSku = db
        .prepare(`SELECT id, name FROM inventory_items WHERE LOWER(TRIM(sku)) = LOWER(TRIM(?))`)
        .get(sku) as { id: string; name: string } | undefined;
      if (dupSku) {
        throw new HttpError(
          409,
          `Material SKU '${sku}' already exists for ${dupSku.name}. Provide a unique SKU to approve.`
        );
      }

      createdMaterialId = uid(row.category === 'RAW_MATERIAL' ? 'rm' : 'pkg');
      const reorderScaled =
        input?.reorderLevel !== undefined && Number.isFinite(input.reorderLevel)
          ? toScaledQty(Math.max(0, input.reorderLevel))
          : row.suggested_reorder_level_scaled;

      db.prepare(
        `INSERT INTO inventory_items (
          id, sku, name, category, unit, pack_size, selling_price_paise,
          gst_rate_bps, hsn_code, image_url, reorder_level_scaled, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, '', 0, 0, '', '', ?, 1, ?, ?)`
      ).run(createdMaterialId, sku, row.name, row.category, row.unit, reorderScaled, nowIso, nowIso);

      db.prepare(
        `INSERT INTO stock_balances (item_id, quantity_scaled, updated_at) VALUES (?, 0, ?)`
      ).run(createdMaterialId, nowIso);
    }

    db.prepare(
      `UPDATE material_proposals
       SET status = ?, reviewed_by_name = ?, review_note = ?, created_material_id = ?, reviewed_at = ?
       WHERE id = ?`
    ).run(
      nextStatus,
      actor.fullName,
      input?.note?.trim() || '',
      createdMaterialId,
      nowIso,
      row.id
    );

    recordAuditLog(
      db,
      actor,
      'MATERIAL_PROPOSAL',
      row.id,
      `MATERIAL_PROPOSAL_${nextStatus}`,
      `${row.proposal_number} (${row.name}): ${nextStatus}`
    );

    return {
      id: row.id,
      proposalNumber: row.proposal_number,
      status: nextStatus,
      createdMaterialId: createdMaterialId || undefined,
    };
  });
}
