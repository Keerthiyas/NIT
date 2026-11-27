import type { DatabaseSync } from 'node:sqlite';
import { HttpError, requireRole, type AuthUser } from './auth.ts';
import { runInTransaction } from './db.ts';
import {
  fromGstBps,
  fromPaise,
  fromScaledQty,
  toGstBps,
  toPaise,
  toScaledQty,
} from './moneyQty.ts';
import { normalizeProductImageUrl } from './productImages.ts';
import {
  nextSequenceNumber,
  recordAuditLog,
  uid,
} from './services.ts';

function recordProposalAudit(
  db: DatabaseSync,
  proposalId: string,
  actor: AuthUser,
  action: string,
  previousValue: string,
  newValue: string,
  remarks: string = '',
  relatedEntityType: string = 'PRODUCT_PROPOSAL',
  relatedEntityId: string = proposalId
): void {
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO product_proposal_audit_trail (
      id, proposal_id, user_id, user_role, user_name, action,
      previous_value, new_value, related_entity_type, related_entity_id, remarks, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('ppaud'),
    proposalId,
    actor.id,
    actor.role,
    actor.fullName,
    action,
    previousValue,
    newValue,
    relatedEntityType,
    relatedEntityId,
    remarks.trim(),
    nowIso
  );

  recordAuditLog(
    db,
    actor,
    relatedEntityType,
    relatedEntityId,
    action,
    `${previousValue ? `${previousValue} -> ` : ''}${newValue}${remarks.trim() ? ` (${remarks.trim()})` : ''}`
  );
}

interface ProposalRow {
  id: string;
  proposal_number: string;
  product_name: string;
  description: string;
  pack_size: string;
  unit: string;
  product_category: string;
  status: string;
  initiated_by_user_id: string;
  initiated_by_name: string;
  initiated_by_role: string;
  submitted_at: string;
  production_verification_status: string;
  production_feasibility: string;
  expected_yield_percent_bps: number;
  production_instructions: string;
  production_remarks: string;
  production_verified_by_user_id: string | null;
  production_verified_by_name: string;
  production_verified_at: string;
  accountant_verification_status: string;
  hsn_code: string;
  gst_rate_bps: number;
  tax_classification: string;
  estimated_cost_paise: number;
  costing_notes: string;
  accountant_remarks: string;
  accountant_verified_by_user_id: string | null;
  accountant_verified_by_name: string;
  accountant_verified_at: string;
  owner_decision: string;
  proposed_selling_price_paise: number;
  proposed_reorder_level_scaled: number;
  approved_selling_price_paise: number;
  approved_reorder_level_scaled: number;
  owner_remarks: string;
  approved_by_user_id: string | null;
  approved_by_name: string;
  approved_at: string;
  returned_to_stage: string;
  returned_reason: string;
  returned_by_name: string;
  registered_product_id: string | null;
  registered_sku: string;
  registered_by_user_id: string | null;
  registered_by_name: string;
  registered_at: string;
  activated_at: string;
  created_at: string;
  updated_at: string;
}

function mapProposal(db: DatabaseSync, r: ProposalRow) {
  const bomRows = db
    .prepare(
      `SELECT b.*, m.sku AS existing_material_sku, m.is_active AS existing_material_active,
              cm.sku AS created_material_sku
       FROM product_proposal_bom_items b
       LEFT JOIN inventory_items m ON m.id = b.material_id
       LEFT JOIN inventory_items cm ON cm.id = b.created_material_id
       WHERE b.proposal_id = ?
       ORDER BY b.rowid ASC`
    )
    .all(r.id) as Array<{
    id: string;
    proposal_id: string;
    item_type: 'EXISTING_MATERIAL' | 'NEW_MATERIAL';
    material_id: string | null;
    material_name: string;
    material_category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
    unit: string;
    suggested_reorder_level_scaled: number;
    quantity_per_unit_scaled: number;
    notes: string;
    created_material_id: string | null;
    existing_material_sku: string | null;
    existing_material_active: number | null;
    created_material_sku: string | null;
  }>;

  const auditRows = db
    .prepare(
      `SELECT * FROM product_proposal_audit_trail
       WHERE proposal_id = ?
       ORDER BY timestamp DESC, rowid DESC`
    )
    .all(r.id) as Array<{
    id: string;
    proposal_id: string;
    user_id: string;
    user_role: string;
    user_name: string;
    action: string;
    previous_value: string;
    new_value: string;
    related_entity_type: string;
    related_entity_id: string;
    remarks: string;
    timestamp: string;
  }>;

  return {
    id: r.id,
    proposalNumber: r.proposal_number,
    productName: r.product_name,
    description: r.description,
    packSize: r.pack_size,
    unit: r.unit,
    productCategory: r.product_category,
    status: r.status,
    initiatedByUserId: r.initiated_by_user_id,
    initiatedByName: r.initiated_by_name,
    initiatedByRole: r.initiated_by_role,
    submittedAt: r.submitted_at || undefined,
    productionVerificationStatus: r.production_verification_status,
    productionFeasibility: r.production_feasibility || undefined,
    expectedYieldPercent: fromGstBps(r.expected_yield_percent_bps),
    productionInstructions: r.production_instructions || undefined,
    productionRemarks: r.production_remarks || undefined,
    productionVerifiedByName: r.production_verified_by_name || undefined,
    productionVerifiedAt: r.production_verified_at || undefined,
    accountantVerificationStatus: r.accountant_verification_status,
    hsnCode: r.hsn_code || undefined,
    gstRate: fromGstBps(r.gst_rate_bps),
    taxClassification: r.tax_classification || undefined,
    estimatedCost: fromPaise(r.estimated_cost_paise),
    costingNotes: r.costing_notes || undefined,
    accountantRemarks: r.accountant_remarks || undefined,
    accountantVerifiedByName: r.accountant_verified_by_name || undefined,
    accountantVerifiedAt: r.accountant_verified_at || undefined,
    ownerDecision: r.owner_decision,
    proposedSellingPrice: fromPaise(r.proposed_selling_price_paise),
    proposedReorderLevel: fromScaledQty(r.proposed_reorder_level_scaled),
    approvedSellingPrice: fromPaise(r.approved_selling_price_paise),
    approvedReorderLevel: fromScaledQty(r.approved_reorder_level_scaled),
    ownerRemarks: r.owner_remarks || undefined,
    approvedByName: r.approved_by_name || undefined,
    approvedAt: r.approved_at || undefined,
    returnedToStage: r.returned_to_stage || undefined,
    returnedReason: r.returned_reason || undefined,
    returnedByName: r.returned_by_name || undefined,
    registeredProductId: r.registered_product_id || undefined,
    registeredSku: r.registered_sku || undefined,
    registeredByName: r.registered_by_name || undefined,
    registeredAt: r.registered_at || undefined,
    activatedAt: r.activated_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    bomItems: bomRows.map((b) => ({
      id: b.id,
      itemType: b.item_type,
      materialId: b.material_id || undefined,
      materialSku: b.existing_material_sku || b.created_material_sku || undefined,
      materialName: b.material_name,
      materialCategory: b.material_category,
      unit: b.unit,
      suggestedReorderLevel: fromScaledQty(b.suggested_reorder_level_scaled),
      quantityPerUnit: fromScaledQty(b.quantity_per_unit_scaled),
      notes: b.notes || undefined,
      createdMaterialId: b.created_material_id || undefined,
      isExistingMaterialActive:
        b.item_type === 'EXISTING_MATERIAL' ? b.existing_material_active === 1 : true,
    })),
    auditTrail: auditRows.map((a) => ({
      id: a.id,
      userId: a.user_id,
      userRole: a.user_role,
      userName: a.user_name,
      action: a.action,
      previousValue: a.previous_value || undefined,
      newValue: a.new_value || undefined,
      relatedEntityType: a.related_entity_type,
      relatedEntityId: a.related_entity_id,
      remarks: a.remarks || undefined,
      timestamp: a.timestamp,
    })),
  };
}

export function listProductProposals(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, [
    'OWNER_SUPER_ADMIN',
    'ADMIN',
    'PRODUCTION_SUPERVISOR',
    'ACCOUNTANT',
  ]);
  const rows = db
    .prepare(`SELECT * FROM product_proposals ORDER BY created_at DESC, rowid DESC`)
    .all() as ProposalRow[];
  return rows.map((r) => mapProposal(db, r));
}

export function getProductProposalDetail(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string
) {
  requireRole(actor, [
    'OWNER_SUPER_ADMIN',
    'ADMIN',
    'PRODUCTION_SUPERVISOR',
    'ACCOUNTANT',
  ]);
  const row = db
    .prepare(`SELECT * FROM product_proposals WHERE id = ?`)
    .get(proposalId) as ProposalRow | undefined;
  if (!row) throw new HttpError(404, `Product proposal ${proposalId} not found.`);
  return mapProposal(db, row);
}

export function createProductProposal(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    productName: string;
    description?: string;
    packSize: string;
    unit?: string;
    productCategory?: string;
    proposedSellingPrice?: number;
    proposedReorderLevel?: number;
    submitForProductionVerification?: boolean;
  }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'PRODUCTION_SUPERVISOR']);

  const productName = (input.productName ?? '').trim();
  const packSize = (input.packSize ?? '').trim();
  const unit = (input.unit ?? 'packets').trim() || 'packets';
  if (!productName || !packSize) {
    throw new HttpError(400, 'Product name and proposed pack size are required.');
  }

  return runInTransaction(db, () => {
    const duplicate = db
      .prepare(
        `SELECT proposal_number FROM product_proposals
         WHERE LOWER(TRIM(product_name)) = LOWER(?)
           AND LOWER(TRIM(pack_size)) = LOWER(?)
           AND status NOT IN ('REJECTED', 'ACTIVE')`
      )
      .get(productName, packSize) as { proposal_number: string } | undefined;
    if (duplicate) {
      throw new HttpError(
        409,
        `Active proposal ${duplicate.proposal_number} already exists for ${productName} (${packSize}).`
      );
    }

    const existingCatalogue = db
      .prepare(
        `SELECT sku FROM inventory_items
         WHERE category = 'FINISHED_GOOD'
           AND LOWER(TRIM(name)) = LOWER(?)
           AND LOWER(TRIM(pack_size)) = LOWER(?)`
      )
      .get(productName, packSize) as { sku: string } | undefined;
    if (existingCatalogue) {
      throw new HttpError(
        409,
        `${productName} (${packSize}) already exists in Product Catalogue (${existingCatalogue.sku}).`
      );
    }

    const id = uid('np');
    const proposalNumber = nextSequenceNumber(
      db,
      'product_proposals',
      'proposal_number',
      'NP-2026-'
    );
    const nowIso = new Date().toISOString();
    const initialStatus =
      input.submitForProductionVerification === false
        ? 'DRAFT'
        : 'PENDING_PRODUCTION_VERIFICATION';

    const proposedPricePaise =
      actor.role === 'OWNER_SUPER_ADMIN' &&
      input.proposedSellingPrice !== undefined &&
      Number.isFinite(input.proposedSellingPrice) &&
      input.proposedSellingPrice >= 0
        ? toPaise(input.proposedSellingPrice)
        : 0;
    const proposedReorderScaled =
      actor.role === 'OWNER_SUPER_ADMIN' &&
      input.proposedReorderLevel !== undefined &&
      Number.isFinite(input.proposedReorderLevel) &&
      input.proposedReorderLevel >= 0
        ? toScaledQty(input.proposedReorderLevel)
        : 0;

    db.prepare(
      `INSERT INTO product_proposals (
        id, proposal_number, product_name, description, pack_size, unit, product_category,
        status, initiated_by_user_id, initiated_by_name, initiated_by_role, submitted_at,
        proposed_selling_price_paise, proposed_reorder_level_scaled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      proposalNumber,
      productName,
      (input.description ?? '').trim(),
      packSize,
      unit,
      (input.productCategory ?? 'Snacks & Savouries').trim() || 'Snacks & Savouries',
      initialStatus,
      actor.id,
      actor.fullName,
      actor.role,
      initialStatus === 'DRAFT' ? '' : nowIso,
      proposedPricePaise,
      proposedReorderScaled,
      nowIso,
      nowIso
    );

    recordProposalAudit(
      db,
      id,
      actor,
      'INITIATE_PRODUCT_PROPOSAL',
      '',
      initialStatus,
      `${proposalNumber}: ${productName} (${packSize})`
    );

    return getProductProposalDetail(db, actor, id);
  });
}

export function saveOrVerifyProductionTechnicalDetails(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string,
  input: {
    productName?: string;
    packSize?: string;
    unit?: string;
    productCategory?: string;
    productionFeasibility: 'FEASIBLE' | 'REQUIRES_EQUIPMENT' | 'NOT_FEASIBLE';
    expectedYieldPercent?: number;
    productionInstructions?: string;
    productionRemarks?: string;
    bomItems: Array<{
      itemType: 'EXISTING_MATERIAL' | 'NEW_MATERIAL';
      materialId?: string;
      materialName?: string;
      materialCategory?: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
      unit?: string;
      suggestedReorderLevel?: number;
      quantityPerUnit: number;
      notes?: string;
    }>;
    verify: boolean;
  }
) {
  requireRole(actor, ['PRODUCTION_SUPERVISOR']);

  return runInTransaction(db, () => {
    const prop = db
      .prepare(`SELECT * FROM product_proposals WHERE id = ?`)
      .get(proposalId) as ProposalRow | undefined;
    if (!prop) throw new HttpError(404, `Product proposal ${proposalId} not found.`);

    const canEdit =
      prop.status === 'DRAFT' ||
      prop.status === 'PENDING_PRODUCTION_VERIFICATION' ||
      (prop.status === 'RETURNED_FOR_CORRECTION' &&
        (prop.returned_to_stage === 'PRODUCTION' || prop.returned_to_stage === 'INITIATOR'));
    if (!canEdit || prop.production_verification_status === 'VERIFIED') {
      throw new HttpError(
        403,
        `Technical details are locked (${prop.status}). Cannot modify after Production Verification.`
      );
    }

    if (!['FEASIBLE', 'REQUIRES_EQUIPMENT', 'NOT_FEASIBLE'].includes(input.productionFeasibility)) {
      throw new HttpError(400, 'Valid production feasibility selection is required.');
    }
    const yieldPct = input.expectedYieldPercent ?? 95;
    if (!Number.isFinite(yieldPct) || yieldPct <= 0 || yieldPct > 100) {
      throw new HttpError(400, 'Expected production yield must be between 1% and 100%.');
    }

    const bomList = input.bomItems ?? [];
    if (bomList.length === 0) {
      throw new HttpError(400, 'At least one raw or packaging material BOM component is required.');
    }

    const seenExisting = new Set<string>();
    const seenNew = new Set<string>();
    const resolvedBomLines: Array<{
      itemType: 'EXISTING_MATERIAL' | 'NEW_MATERIAL';
      materialId: string | null;
      materialName: string;
      materialCategory: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
      unit: string;
      suggestedReorderScaled: number;
      qtyScaled: number;
      notes: string;
    }> = [];

    for (const line of bomList) {
      if (!Number.isFinite(line.quantityPerUnit) || line.quantityPerUnit <= 0) {
        throw new HttpError(400, 'All BOM material quantities must be greater than zero.');
      }
      const qtyScaled = toScaledQty(line.quantityPerUnit);
      if (qtyScaled <= 0) {
        throw new HttpError(400, 'BOM quantity per unit is too small.');
      }

      if (line.itemType === 'EXISTING_MATERIAL') {
        const matId = (line.materialId ?? '').trim();
        if (!matId) {
          throw new HttpError(400, 'Existing BOM line must reference a Material Catalogue ID.');
        }
        if (seenExisting.has(matId)) {
          throw new HttpError(400, 'Duplicate material entry in proposal BOM is not allowed.');
        }
        seenExisting.add(matId);

        const mat = db
          .prepare(
            `SELECT id, name, category, unit, is_active FROM inventory_items WHERE id = ?`
          )
          .get(matId) as
          | {
              id: string;
              name: string;
              category: string;
              unit: string;
              is_active: number;
            }
          | undefined;
        if (!mat || (mat.category !== 'RAW_MATERIAL' && mat.category !== 'PACKAGING_MATERIAL')) {
          throw new HttpError(400, `Invalid material reference: ${matId}`);
        }
        if (mat.is_active !== 1) {
          throw new HttpError(400, `Inactive material '${mat.name}' cannot be linked to a new BOM.`);
        }

        resolvedBomLines.push({
          itemType: 'EXISTING_MATERIAL',
          materialId: mat.id,
          materialName: mat.name,
          materialCategory: mat.category,
          unit: mat.unit,
          suggestedReorderScaled: 0,
          qtyScaled,
          notes: (line.notes ?? '').trim(),
        });
      } else if (line.itemType === 'NEW_MATERIAL') {
        const matName = (line.materialName ?? '').trim();
        const matUnit = (line.unit ?? '').trim();
        const matCat = line.materialCategory;
        if (!matName || !matUnit || (matCat !== 'RAW_MATERIAL' && matCat !== 'PACKAGING_MATERIAL')) {
          throw new HttpError(
            400,
            'Missing material requirements must specify Material Name, Category (Raw/Packaging), and Unit.'
          );
        }
        const newKey = `${matName.toLowerCase()}::${matCat}`;
        if (seenNew.has(newKey)) {
          throw new HttpError(400, `Duplicate new material entry: ${matName}`);
        }
        seenNew.add(newKey);

        resolvedBomLines.push({
          itemType: 'NEW_MATERIAL',
          materialId: null,
          materialName: matName,
          materialCategory: matCat,
          unit: matUnit,
          suggestedReorderScaled: toScaledQty(Math.max(0, line.suggestedReorderLevel ?? 20)),
          qtyScaled,
          notes: (line.notes ?? '').trim(),
        });
      } else {
        throw new HttpError(400, 'Invalid BOM item type.');
      }
    }

    if (input.verify && input.productionFeasibility === 'NOT_FEASIBLE') {
      throw new HttpError(
        400,
        'Cannot mark technical verification complete when Production Feasibility is NOT_FEASIBLE.'
      );
    }

    const nowIso = new Date().toISOString();
    const prevStatus = prop.status;
    const nextName = (input.productName ?? prop.product_name).trim() || prop.product_name;
    const nextPack = (input.packSize ?? prop.pack_size).trim() || prop.pack_size;
    const nextUnit = (input.unit ?? prop.unit).trim() || prop.unit;
    const nextCategory =
      (input.productCategory ?? prop.product_category).trim() || prop.product_category;

    const nextStatus = input.verify
      ? 'PENDING_ACCOUNTANT_VERIFICATION'
      : prop.status === 'DRAFT'
        ? 'PENDING_PRODUCTION_VERIFICATION'
        : prop.status;

    db.prepare(`DELETE FROM product_proposal_bom_items WHERE proposal_id = ?`).run(prop.id);
    const insertBom = db.prepare(
      `INSERT INTO product_proposal_bom_items (
        id, proposal_id, item_type, material_id, material_name, material_category,
        unit, suggested_reorder_level_scaled, quantity_per_unit_scaled, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const b of resolvedBomLines) {
      insertBom.run(
        uid('ppbom'),
        prop.id,
        b.itemType,
        b.materialId,
        b.materialName,
        b.materialCategory,
        b.unit,
        b.suggestedReorderScaled,
        b.qtyScaled,
        b.notes
      );
    }

    db.prepare(
      `UPDATE product_proposals
       SET product_name = ?, pack_size = ?, unit = ?, product_category = ?,
           production_feasibility = ?, expected_yield_percent_bps = ?,
           production_instructions = ?, production_remarks = ?,
           production_verification_status = ?,
           production_verified_by_user_id = ?, production_verified_by_name = ?, production_verified_at = ?,
           returned_to_stage = CASE WHEN ? THEN '' ELSE returned_to_stage END,
           status = ?, submitted_at = COALESCE(NULLIF(submitted_at, ''), ?), updated_at = ?
       WHERE id = ?`
    ).run(
      nextName,
      nextPack,
      nextUnit,
      nextCategory,
      input.productionFeasibility,
      toGstBps(yieldPct),
      (input.productionInstructions ?? '').trim(),
      (input.productionRemarks ?? '').trim(),
      input.verify ? 'VERIFIED' : 'PENDING',
      input.verify ? actor.id : null,
      input.verify ? actor.fullName : '',
      input.verify ? nowIso : '',
      input.verify ? 1 : 0,
      nextStatus,
      nowIso,
      nowIso,
      prop.id
    );

    if (input.verify) {
      recordProposalAudit(
        db,
        prop.id,
        actor,
        'PRODUCTION_VERIFIED',
        prevStatus,
        'PRODUCTION_VERIFIED',
        input.productionRemarks ?? `${resolvedBomLines.length} BOM components verified`
      );
      recordProposalAudit(
        db,
        prop.id,
        actor,
        'ROUTE_TO_ACCOUNTANT_VERIFICATION',
        'PRODUCTION_VERIFIED',
        'PENDING_ACCOUNTANT_VERIFICATION',
        'Routed to Accountant for HSN, GST, and Costing verification'
      );
    } else {
      recordProposalAudit(
        db,
        prop.id,
        actor,
        'SAVE_PRODUCTION_TECHNICAL_DETAILS',
        prevStatus,
        nextStatus,
        `${resolvedBomLines.length} BOM components saved`
      );
    }

    return getProductProposalDetail(db, actor, prop.id);
  });
}

export function submitAccountantVerification(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string,
  input: {
    decision: 'VERIFY' | 'RETURN';
    hsnCode?: string;
    gstRate?: number;
    taxClassification?: string;
    estimatedCost?: number;
    costingNotes?: string;
    remarks?: string;
  }
) {
  requireRole(actor, ['ACCOUNTANT']);

  return runInTransaction(db, () => {
    const prop = db
      .prepare(`SELECT * FROM product_proposals WHERE id = ?`)
      .get(proposalId) as ProposalRow | undefined;
    if (!prop) throw new HttpError(404, `Product proposal ${proposalId} not found.`);

    const canAct =
      prop.production_verification_status === 'VERIFIED' &&
      (prop.status === 'PENDING_ACCOUNTANT_VERIFICATION' ||
        (prop.status === 'RETURNED_FOR_CORRECTION' && prop.returned_to_stage === 'ACCOUNTANT'));
    if (!canAct) {
      throw new HttpError(
        400,
        `Proposal ${prop.proposal_number} is not awaiting Accountant verification (${prop.status}).`
      );
    }

    const nowIso = new Date().toISOString();
    const prevStatus = prop.status;

    if (input.decision === 'RETURN') {
      const reason = (input.remarks ?? '').trim();
      if (!reason) {
        throw new HttpError(400, 'Remarks are required when returning a proposal for correction.');
      }

      db.prepare(
        `UPDATE product_proposals
         SET accountant_verification_status = 'RETURNED',
             production_verification_status = 'PENDING',
             accountant_remarks = ?,
             returned_to_stage = 'PRODUCTION',
             returned_reason = ?,
             returned_by_name = ?,
             status = 'RETURNED_FOR_CORRECTION',
             updated_at = ?
         WHERE id = ?`
      ).run(reason, reason, actor.fullName, nowIso, prop.id);

      recordProposalAudit(
        db,
        prop.id,
        actor,
        'ACCOUNTANT_RETURN_FOR_CORRECTION',
        prevStatus,
        'RETURNED_FOR_CORRECTION',
        reason
      );
      return getProductProposalDetail(db, actor, prop.id);
    }

    if (input.decision !== 'VERIFY') {
      throw new HttpError(400, 'Invalid Accountant decision. Expected VERIFY or RETURN.');
    }

    const hsnCode = (input.hsnCode ?? '').trim();
    const taxClass = (input.taxClassification ?? '').trim();
    if (!/^\d{4,8}$/.test(hsnCode)) {
      throw new HttpError(400, 'Valid numeric HSN code (4 to 8 digits) is required.');
    }
    if (
      input.gstRate === undefined ||
      !Number.isFinite(input.gstRate) ||
      input.gstRate < 0 ||
      input.gstRate > 28
    ) {
      throw new HttpError(400, 'Verified GST rate must be specified between 0% and 28%.');
    }
    if (!taxClass) {
      throw new HttpError(400, 'Tax classification is required (e.g., GST 5% Food Slab).');
    }
    if (
      input.estimatedCost === undefined ||
      !Number.isFinite(input.estimatedCost) ||
      input.estimatedCost < 0
    ) {
      throw new HttpError(400, 'Estimated unit cost must be zero or positive.');
    }

    db.prepare(
      `UPDATE product_proposals
       SET hsn_code = ?, gst_rate_bps = ?, tax_classification = ?,
           estimated_cost_paise = ?, costing_notes = ?, accountant_remarks = ?,
           accountant_verification_status = 'VERIFIED',
           accountant_verified_by_user_id = ?, accountant_verified_by_name = ?, accountant_verified_at = ?,
           returned_to_stage = '',
           status = 'PENDING_OWNER_APPROVAL',
           updated_at = ?
       WHERE id = ?`
    ).run(
      hsnCode,
      toGstBps(input.gstRate),
      taxClass,
      toPaise(input.estimatedCost),
      (input.costingNotes ?? '').trim(),
      (input.remarks ?? '').trim(),
      actor.id,
      actor.fullName,
      nowIso,
      nowIso,
      prop.id
    );

    recordProposalAudit(
      db,
      prop.id,
      actor,
      'ACCOUNTANT_VERIFIED',
      prevStatus,
      'ACCOUNTANT_VERIFIED',
      `HSN ${hsnCode}, GST ${input.gstRate}%, Est Cost ₹${input.estimatedCost}`
    );
    recordProposalAudit(
      db,
      prop.id,
      actor,
      'ROUTE_TO_OWNER_APPROVAL',
      'ACCOUNTANT_VERIFIED',
      'PENDING_OWNER_APPROVAL',
      'Ready for final Owner business approval'
    );

    return getProductProposalDetail(db, actor, prop.id);
  });
}

export function submitOwnerProductDecision(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string,
  input: {
    decision: 'APPROVE' | 'REJECT' | 'RETURN';
    sellingPrice?: number;
    reorderLevel?: number;
    targetStage?: 'PRODUCTION' | 'ACCOUNTANT';
    remarks?: string;
  }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  return runInTransaction(db, () => {
    const prop = db
      .prepare(`SELECT * FROM product_proposals WHERE id = ?`)
      .get(proposalId) as ProposalRow | undefined;
    if (!prop) throw new HttpError(404, `Product proposal ${proposalId} not found.`);

    if (
      prop.status === 'REJECTED' ||
      prop.status === 'APPROVED_PENDING_REGISTRATION' ||
      prop.status === 'CATALOGUE_REGISTERED' ||
      prop.status === 'ACTIVE'
    ) {
      throw new HttpError(400, `Proposal ${prop.proposal_number} is already ${prop.status}.`);
    }

    const nowIso = new Date().toISOString();
    const prevStatus = prop.status;

    if (input.decision === 'REJECT') {
      const reason = (input.remarks ?? '').trim();
      if (!reason) {
        throw new HttpError(400, 'Rejection remarks are required.');
      }
      db.prepare(
        `UPDATE product_proposals
         SET owner_decision = 'REJECTED', owner_remarks = ?,
             approved_by_user_id = ?, approved_by_name = ?, approved_at = ?,
             status = 'REJECTED', updated_at = ?
         WHERE id = ?`
      ).run(reason, actor.id, actor.fullName, nowIso, nowIso, prop.id);

      recordProposalAudit(
        db,
        prop.id,
        actor,
        'OWNER_REJECT_PRODUCT_PROPOSAL',
        prevStatus,
        'REJECTED',
        reason
      );
      return getProductProposalDetail(db, actor, prop.id);
    }

    if (input.decision === 'RETURN') {
      const reason = (input.remarks ?? '').trim();
      if (!reason) {
        throw new HttpError(400, 'Remarks are required when returning a proposal for correction.');
      }
      const targetStage = input.targetStage === 'ACCOUNTANT' ? 'ACCOUNTANT' : 'PRODUCTION';

      if (targetStage === 'PRODUCTION') {
        db.prepare(
          `UPDATE product_proposals
           SET owner_decision = 'RETURNED', owner_remarks = ?,
               production_verification_status = 'PENDING',
               accountant_verification_status = 'PENDING',
               returned_to_stage = 'PRODUCTION', returned_reason = ?, returned_by_name = ?,
               status = 'RETURNED_FOR_CORRECTION', updated_at = ?
           WHERE id = ?`
        ).run(reason, reason, actor.fullName, nowIso, prop.id);
      } else {
        db.prepare(
          `UPDATE product_proposals
           SET owner_decision = 'RETURNED', owner_remarks = ?,
               accountant_verification_status = 'PENDING',
               returned_to_stage = 'ACCOUNTANT', returned_reason = ?, returned_by_name = ?,
               status = 'RETURNED_FOR_CORRECTION', updated_at = ?
           WHERE id = ?`
        ).run(reason, reason, actor.fullName, nowIso, prop.id);
      }

      recordProposalAudit(
        db,
        prop.id,
        actor,
        'OWNER_RETURN_FOR_CORRECTION',
        prevStatus,
        'RETURNED_FOR_CORRECTION',
        `Returned to ${targetStage}: ${reason}`
      );
      return getProductProposalDetail(db, actor, prop.id);
    }

    if (input.decision !== 'APPROVE') {
      throw new HttpError(400, 'Invalid Owner decision. Expected APPROVE, REJECT, or RETURN.');
    }

    if (
      prop.status !== 'PENDING_OWNER_APPROVAL' ||
      prop.production_verification_status !== 'VERIFIED' ||
      prop.accountant_verification_status !== 'VERIFIED'
    ) {
      throw new HttpError(
        400,
        'Owner cannot approve an incomplete proposal. Production and Accountant verifications must be completed first.'
      );
    }

    if (
      input.sellingPrice === undefined ||
      !Number.isFinite(input.sellingPrice) ||
      input.sellingPrice <= 0
    ) {
      throw new HttpError(400, 'Owner must confirm an official selling price greater than zero.');
    }
    if (
      input.reorderLevel === undefined ||
      !Number.isFinite(input.reorderLevel) ||
      input.reorderLevel < 0
    ) {
      throw new HttpError(400, 'Owner must confirm a non-negative reorder level.');
    }

    db.prepare(
      `UPDATE product_proposals
       SET owner_decision = 'APPROVED',
           approved_selling_price_paise = ?, approved_reorder_level_scaled = ?,
           owner_remarks = ?,
           approved_by_user_id = ?, approved_by_name = ?, approved_at = ?,
           status = 'APPROVED_PENDING_REGISTRATION', updated_at = ?
       WHERE id = ?`
    ).run(
      toPaise(input.sellingPrice),
      toScaledQty(input.reorderLevel),
      (input.remarks ?? '').trim(),
      actor.id,
      actor.fullName,
      nowIso,
      nowIso,
      prop.id
    );

    recordProposalAudit(
      db,
      prop.id,
      actor,
      'OWNER_APPROVE_PRODUCT_LAUNCH',
      prevStatus,
      'APPROVED_PENDING_REGISTRATION',
      `Approved Price ₹${input.sellingPrice}, Reorder ${input.reorderLevel}${input.remarks?.trim() ? ` — ${input.remarks.trim()}` : ''}`
    );

    return getProductProposalDetail(db, actor, prop.id);
  });
}

export function registerMissingMaterialFromProposal(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string,
  bomLineId: string,
  input: { sku: string; isActive?: boolean }
) {
  requireRole(actor, ['ADMIN']);

  const sku = (input.sku ?? '').trim();
  if (!sku) {
    throw new HttpError(400, 'A unique SKU is required to register the verified material.');
  }

  return runInTransaction(db, () => {
    const prop = db
      .prepare(`SELECT * FROM product_proposals WHERE id = ?`)
      .get(proposalId) as ProposalRow | undefined;
    if (!prop) throw new HttpError(404, `Product proposal ${proposalId} not found.`);
    if (prop.status !== 'APPROVED_PENDING_REGISTRATION') {
      throw new HttpError(
        403,
        `Missing materials can only be registered for Owner-approved proposals (${prop.status}).`
      );
    }

    const bomLine = db
      .prepare(
        `SELECT * FROM product_proposal_bom_items WHERE id = ? AND proposal_id = ?`
      )
      .get(bomLineId, prop.id) as
      | {
          id: string;
          item_type: string;
          material_name: string;
          material_category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
          unit: string;
          suggested_reorder_level_scaled: number;
          created_material_id: string | null;
        }
      | undefined;
    if (!bomLine || bomLine.item_type !== 'NEW_MATERIAL') {
      throw new HttpError(404, 'New material requirement line not found in this proposal.');
    }
    if (bomLine.created_material_id) {
      throw new HttpError(
        409,
        `Material '${bomLine.material_name}' is already registered for this proposal.`
      );
    }

    const dupSku = db
      .prepare(`SELECT id, name FROM inventory_items WHERE LOWER(TRIM(sku)) = LOWER(TRIM(?))`)
      .get(sku) as { id: string; name: string } | undefined;
    if (dupSku) {
      throw new HttpError(409, `SKU '${sku}' is already used by ${dupSku.name}.`);
    }

    const nowIso = new Date().toISOString();
    const materialId = uid(
      bomLine.material_category === 'RAW_MATERIAL' ? 'rm' : 'pkg'
    );

    db.prepare(
      `INSERT INTO inventory_items (
        id, sku, name, category, unit, pack_size, selling_price_paise,
        gst_rate_bps, hsn_code, image_url, reorder_level_scaled, is_active,
        source_proposal_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', 0, 0, '', '', ?, ?, ?, ?, ?)`
    ).run(
      materialId,
      sku,
      bomLine.material_name,
      bomLine.material_category,
      bomLine.unit,
      bomLine.suggested_reorder_level_scaled,
      input.isActive === false ? 0 : 1,
      prop.id,
      nowIso,
      nowIso
    );

    db.prepare(
      `INSERT INTO stock_balances (item_id, quantity_scaled, updated_at) VALUES (?, 0, ?)`
    ).run(materialId, nowIso);

    db.prepare(
      `UPDATE product_proposal_bom_items SET created_material_id = ? WHERE id = ?`
    ).run(materialId, bomLine.id);

    recordProposalAudit(
      db,
      prop.id,
      actor,
      'ADMIN_REGISTER_VERIFIED_MATERIAL',
      bomLine.material_name,
      `${sku} (${bomLine.material_name}, 0 stock)`,
      `Registered missing ${bomLine.material_category} from ${prop.proposal_number}`,
      'MATERIAL',
      materialId
    );

    return getProductProposalDetail(db, actor, prop.id);
  });
}

export function registerProductFromApprovedProposal(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string,
  input: {
    sku: string;
    imageUrl?: string;
    activateImmediately?: boolean;
  }
) {
  requireRole(actor, ['ADMIN']);

  const sku = (input.sku ?? '').trim();
  if (!sku) {
    throw new HttpError(400, 'Unique product SKU is required for catalogue registration.');
  }
  const normalizedImageUrl = normalizeProductImageUrl(input.imageUrl);

  return runInTransaction(db, () => {
    const prop = db
      .prepare(`SELECT * FROM product_proposals WHERE id = ?`)
      .get(proposalId) as ProposalRow | undefined;
    if (!prop) throw new HttpError(404, `Product proposal ${proposalId} not found.`);

    if (prop.registered_product_id) {
      throw new HttpError(
        409,
        `Proposal ${prop.proposal_number} is already registered as product ${prop.registered_sku}.`
      );
    }
    if (
      prop.status !== 'APPROVED_PENDING_REGISTRATION' ||
      prop.production_verification_status !== 'VERIFIED' ||
      prop.accountant_verification_status !== 'VERIFIED' ||
      prop.owner_decision !== 'APPROVED'
    ) {
      throw new HttpError(
        403,
        `Proposal ${prop.proposal_number} is not approved for catalogue registration (${prop.status}).`
      );
    }

    const bomRows = db
      .prepare(`SELECT * FROM product_proposal_bom_items WHERE proposal_id = ?`)
      .all(prop.id) as Array<{
      id: string;
      item_type: 'EXISTING_MATERIAL' | 'NEW_MATERIAL';
      material_id: string | null;
      material_name: string;
      unit: string;
      quantity_per_unit_scaled: number;
      created_material_id: string | null;
    }>;

    if (bomRows.length === 0) {
      throw new HttpError(400, 'Cannot register a product without a verified BOM.');
    }

    const unregisteredNew = bomRows.filter(
      (b) => b.item_type === 'NEW_MATERIAL' && !b.created_material_id
    );
    if (unregisteredNew.length > 0) {
      throw new HttpError(
        400,
        `Register all missing materials first before creating the product: ${unregisteredNew
          .map((u) => u.material_name)
          .join(', ')}`
      );
    }

    const dupSku = db
      .prepare(`SELECT id, name FROM inventory_items WHERE LOWER(TRIM(sku)) = LOWER(TRIM(?))`)
      .get(sku) as { id: string; name: string } | undefined;
    if (dupSku) {
      throw new HttpError(409, `Product SKU '${sku}' is already assigned to ${dupSku.name}.`);
    }

    const nowIso = new Date().toISOString();
    const productId = uid('prod');
    const bomId = uid('bomhdr');
    const activateNow = Boolean(input.activateImmediately);
    const nextProposalStatus = activateNow ? 'ACTIVE' : 'CATALOGUE_REGISTERED';

    // Strictly uses verified/approved values from Production, Accountant, and Owner — stock initializes at 0!
    db.prepare(
      `INSERT INTO inventory_items (
        id, sku, name, category, unit, pack_size, selling_price_paise,
        gst_rate_bps, hsn_code, image_url, bom_version, reorder_level_scaled,
        is_active, source_proposal_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'FINISHED_GOOD', ?, ?, ?, ?, ?, ?, 'v1.0', ?, ?, ?, ?, ?)`
    ).run(
      productId,
      sku,
      prop.product_name,
      prop.unit,
      prop.pack_size,
      prop.approved_selling_price_paise,
      prop.gst_rate_bps,
      prop.hsn_code,
      normalizedImageUrl,
      prop.approved_reorder_level_scaled,
      activateNow ? 1 : 0,
      prop.id,
      nowIso,
      nowIso
    );

    db.prepare(
      `INSERT INTO stock_balances (item_id, quantity_scaled, updated_at) VALUES (?, 0, ?)`
    ).run(productId, nowIso);

    db.prepare(
      `INSERT INTO boms (
        id, product_id, bom_version, approval_status, quantity_basis,
        effective_date, notes, approved_by, created_by, source_proposal_id, created_at, updated_at
      ) VALUES (?, ?, 'v1.0', 'APPROVED', 'PER_UNIT', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      bomId,
      productId,
      nowIso.slice(0, 10),
      `Registered from approved proposal ${prop.proposal_number}`,
      `${prop.production_verified_by_name} / ${prop.approved_by_name}`,
      actor.fullName,
      prop.id,
      nowIso,
      nowIso
    );

    const insertBomItem = db.prepare(
      `INSERT INTO bom_items (
        id, bom_id, product_id, material_id, quantity_per_unit_scaled, unit, quantity_basis
      ) VALUES (?, ?, ?, ?, ?, ?, 'PER_UNIT')`
    );

    for (const line of bomRows) {
      const targetMatId =
        line.item_type === 'NEW_MATERIAL' ? line.created_material_id! : line.material_id!;
      insertBomItem.run(
        uid('bom'),
        bomId,
        productId,
        targetMatId,
        line.quantity_per_unit_scaled,
        line.unit
      );
    }

    db.prepare(
      `UPDATE product_proposals
       SET registered_product_id = ?, registered_sku = ?,
           registered_by_user_id = ?, registered_by_name = ?, registered_at = ?,
           activated_at = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      productId,
      sku,
      actor.id,
      actor.fullName,
      nowIso,
      activateNow ? nowIso : '',
      nextProposalStatus,
      nowIso,
      prop.id
    );

    recordProposalAudit(
      db,
      prop.id,
      actor,
      activateNow ? 'ADMIN_REGISTER_AND_ACTIVATE_PRODUCT' : 'ADMIN_REGISTER_PRODUCT',
      'APPROVED_PENDING_REGISTRATION',
      nextProposalStatus,
      `SKU ${sku}, Price ₹${fromPaise(prop.approved_selling_price_paise)}, GST ${fromGstBps(prop.gst_rate_bps)}%, HSN ${prop.hsn_code}, 0 stock`,
      'PRODUCT',
      productId
    );

    return getProductProposalDetail(db, actor, prop.id);
  });
}

export function raiseAdminCorrectionRequest(
  db: DatabaseSync,
  actor: AuthUser,
  proposalId: string,
  input: {
    targetDepartment: 'PRODUCTION' | 'ACCOUNTANT' | 'OWNER';
    remarks: string;
  }
) {
  requireRole(actor, ['ADMIN']);

  const remarks = (input.remarks ?? '').trim();
  if (!remarks) {
    throw new HttpError(400, 'Correction remarks are required to send a proposal back.');
  }
  if (!['PRODUCTION', 'ACCOUNTANT', 'OWNER'].includes(input.targetDepartment)) {
    throw new HttpError(400, 'Target department must be PRODUCTION, ACCOUNTANT, or OWNER.');
  }

  return runInTransaction(db, () => {
    const prop = db
      .prepare(`SELECT * FROM product_proposals WHERE id = ?`)
      .get(proposalId) as ProposalRow | undefined;
    if (!prop) throw new HttpError(404, `Product proposal ${proposalId} not found.`);
    if (prop.status !== 'APPROVED_PENDING_REGISTRATION') {
      throw new HttpError(
        400,
        `Correction requests from Admin registration apply to Approved - Pending Registration proposals (${prop.status}).`
      );
    }

    const nowIso = new Date().toISOString();
    const prevStatus = prop.status;

    if (input.targetDepartment === 'PRODUCTION') {
      db.prepare(
        `UPDATE product_proposals
         SET production_verification_status = 'PENDING',
             accountant_verification_status = 'PENDING',
             owner_decision = 'PENDING',
             returned_to_stage = 'PRODUCTION',
             returned_reason = ?, returned_by_name = ?,
             status = 'RETURNED_FOR_CORRECTION', updated_at = ?
         WHERE id = ?`
      ).run(remarks, actor.fullName, nowIso, prop.id);
    } else if (input.targetDepartment === 'ACCOUNTANT') {
      db.prepare(
        `UPDATE product_proposals
         SET accountant_verification_status = 'PENDING',
             owner_decision = 'PENDING',
             returned_to_stage = 'ACCOUNTANT',
             returned_reason = ?, returned_by_name = ?,
             status = 'RETURNED_FOR_CORRECTION', updated_at = ?
         WHERE id = ?`
      ).run(remarks, actor.fullName, nowIso, prop.id);
    } else {
      db.prepare(
        `UPDATE product_proposals
         SET owner_decision = 'PENDING',
             returned_to_stage = 'OWNER',
             returned_reason = ?, returned_by_name = ?,
             status = 'PENDING_OWNER_APPROVAL', updated_at = ?
         WHERE id = ?`
      ).run(remarks, actor.fullName, nowIso, prop.id);
    }

    recordProposalAudit(
      db,
      prop.id,
      actor,
      'ADMIN_REQUEST_CORRECTION',
      prevStatus,
      input.targetDepartment === 'OWNER' ? 'PENDING_OWNER_APPROVAL' : 'RETURNED_FOR_CORRECTION',
      `Admin raised correction to ${input.targetDepartment}: ${remarks}`
    );

    return getProductProposalDetail(db, actor, prop.id);
  });
}
