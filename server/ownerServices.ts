import type { DatabaseSync } from 'node:sqlite';
import { HttpError, requireRole, type AuthUser } from './auth.ts';
import { runInTransaction } from './db.ts';
import { calcTaxablePaise, fromPaise, fromScaledQty, toPaise } from './moneyQty.ts';
import {
  getFinancialReports,
  listCustomerReceivables,
} from './accountantServices.ts';
import {
  getPurchaseApprovalLimitPaise,
  listInventoryItems,
  listInvoicesAndPayments,
  listMaterialShortageQueries,
  listOrders,
  listProductionRequests,
  listProductionRuns,
  listPurchaseOrders,
  listStockMovements,
  recordAuditLog,
} from './services.ts';
import {
  listMaterialPurchaseRequirements,
  listStockDiscrepancyReports,
} from './supervisorServices.ts';

function inDateRange(dateStr: string, from?: string, to?: string): boolean {
  const d = (dateStr || '').slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function getMonthKeys(): { currentMonth: string; previousMonth: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const currentMonth = `${y}-${String(m + 1).padStart(2, '0')}`;
  const prevDate = new Date(Date.UTC(y, m - 1, 1));
  const previousMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
  return { currentMonth, previousMonth };
}

// ---------------------------------------------------------------------------
// 1. Owner Executive Dashboard
// ---------------------------------------------------------------------------

export function getOwnerDashboard(
  db: DatabaseSync,
  actor: AuthUser,
  filters?: { from?: string; to?: string }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  const allOrders = listOrders(db);
  const allPrs = listProductionRequests(db);
  const allRuns = listProductionRuns(db);
  const billing = listInvoicesAndPayments(db);
  const approvalData = listOwnerPurchaseApprovals(db, actor);

  const from = filters?.from?.trim() || undefined;
  const to = filters?.to?.trim() || undefined;

  const orders = allOrders.filter((o) => inDateRange(o.orderDate, from, to));
  const runs = allRuns.filter((r) => inDateRange(r.postedAt, from, to));
  const prs = allPrs.filter((p) => inDateRange(p.createdAt, from, to));
  const activeInvoices = billing.invoices.filter(
    (i) => i.paymentStatus !== 'CANCELLED' && inDateRange(i.invoiceDate, from, to)
  );

  const nonRejectedOrders = orders.filter((o) => o.status !== 'REJECTED');
  const totalSalesPaise = nonRejectedOrders.reduce(
    (s, o) => s + toPaise(o.subtotal ?? 0),
    0
  );
  const pendingOrdersCount = orders.filter((o) =>
    [
      'SUBMITTED',
      'UNDER_REVIEW',
      'PRODUCTION_REQUIRED',
      'AWAITING_STOCK',
      'APPROVED',
      'PARTIALLY_DISPATCHED',
    ].includes(o.status)
  ).length;
  const productionInProgressCount = allPrs.filter((p) => p.status === 'IN_PROGRESS').length;
  const outstandingPaise = activeInvoices.reduce(
    (s, i) => s + toPaise(i.outstandingBalance),
    0
  );
  const pendingApprovals = approvalData.approvals.filter(
    (a) => a.approvalStatus === 'PENDING_OWNER_APPROVAL'
  );

  // Current vs Previous Month Sales Trend (always computed from live orders)
  const { currentMonth, previousMonth } = getMonthKeys();
  const activeAllOrders = allOrders.filter((o) => o.status !== 'REJECTED');
  let currentMonthPaise = 0;
  let previousMonthPaise = 0;
  const trendMap = new Map<string, { label: string; salesPaise: number; orderCount: number }>();

  for (const o of activeAllOrders) {
    const monthKey = o.orderDate.slice(0, 7);
    const valPaise = toPaise(o.subtotal ?? 0);
    if (monthKey === currentMonth) currentMonthPaise += valPaise;
    if (monthKey === previousMonth) previousMonthPaise += valPaise;
  }

  // Group chart points by day if narrow range (<= 45 days or current month), else by month
  const useDaily = Boolean(from && to);
  for (const o of nonRejectedOrders) {
    const key = useDaily ? o.orderDate.slice(0, 10) : o.orderDate.slice(0, 7);
    const cur = trendMap.get(key) ?? { label: key, salesPaise: 0, orderCount: 0 };
    cur.salesPaise += toPaise(o.subtotal ?? 0);
    cur.orderCount += 1;
    trendMap.set(key, cur);
  }

  const trendPoints = Array.from(trendMap.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((p) => ({
      label: p.label,
      salesAmount: fromPaise(p.salesPaise),
      orderCount: p.orderCount,
    }));

  // Production Overview
  const plannedQty = prs.reduce((s, p) => s + p.requestedQuantity, 0);
  const actualGoodQty = runs.reduce((s, r) => s + r.actualOutputQuantity, 0);
  const rejectedQty = runs.reduce((s, r) => s + (r.rejectedQuantity ?? 0), 0);
  const completedCount = prs.filter((p) =>
    ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(p.status)
  ).length;
  const pendingProdCount = prs.filter(
    (p) => !['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'].includes(p.status)
  ).length;

  const prodByProductMap = new Map<
    string,
    { productName: string; plannedQuantity: number; actualGoodOutput: number }
  >();
  for (const p of prs.filter((x) => x.status !== 'CANCELLED')) {
    const cur = prodByProductMap.get(p.productId) ?? {
      productName: p.productName,
      plannedQuantity: 0,
      actualGoodOutput: 0,
    };
    cur.plannedQuantity = Number((cur.plannedQuantity + p.requestedQuantity).toFixed(3));
    prodByProductMap.set(p.productId, cur);
  }
  for (const r of runs) {
    const cur = prodByProductMap.get(r.productId) ?? {
      productName: r.productName,
      plannedQuantity: 0,
      actualGoodOutput: 0,
    };
    cur.actualGoodOutput = Number((cur.actualGoodOutput + r.actualOutputQuantity).toFixed(3));
    prodByProductMap.set(r.productId, cur);
  }

  return {
    totalSalesAmount: fromPaise(totalSalesPaise),
    totalOrdersCount: orders.length,
    pendingOrdersCount,
    productionInProgressCount,
    outstandingPaymentsAmount: fromPaise(outstandingPaise),
    pendingApprovalsCount: pendingApprovals.length,
    salesTrend: {
      currentMonth,
      previousMonth,
      currentMonthSales: fromPaise(currentMonthPaise),
      previousMonthSales: fromPaise(previousMonthPaise),
      points: trendPoints,
    },
    productionOverview: {
      plannedQuantity: Number(plannedQty.toFixed(3)),
      actualGoodOutput: Number(actualGoodQty.toFixed(3)),
      rejectedQuantity: Number(rejectedQty.toFixed(3)),
      completedCount,
      pendingCount: pendingProdCount,
      byProduct: Array.from(prodByProductMap.values()),
    },
    pendingApprovals: pendingApprovals.slice(0, 5),
    approvalLimitRupees: approvalData.approvalLimitRupees,
  };
}

// ---------------------------------------------------------------------------
// 2. Owner Business Overview (Sales & Production Performance)
// ---------------------------------------------------------------------------

export function getOwnerBusinessOverview(
  db: DatabaseSync,
  actor: AuthUser,
  filters?: { from?: string; to?: string }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  const from = filters?.from?.trim() || undefined;
  const to = filters?.to?.trim() || undefined;

  const allOrders = listOrders(db);
  const orders = allOrders.filter((o) => inDateRange(o.orderDate, from, to));
  const prs = listProductionRequests(db).filter((p) => inDateRange(p.createdAt, from, to));
  const runs = listProductionRuns(db).filter((r) => inDateRange(r.postedAt, from, to));

  const { currentMonth, previousMonth } = getMonthKeys();
  let currentMonthSalesPaise = 0;
  let previousMonthSalesPaise = 0;
  for (const o of allOrders.filter((x) => x.status !== 'REJECTED')) {
    const mk = o.orderDate.slice(0, 7);
    if (mk === currentMonth) currentMonthSalesPaise += toPaise(o.subtotal ?? 0);
    if (mk === previousMonth) previousMonthSalesPaise += toPaise(o.subtotal ?? 0);
  }

  const approvedOrders = orders.filter((o) =>
    ['APPROVED', 'PARTIALLY_DISPATCHED', 'DISPATCHED'].includes(o.status)
  ).length;
  const dispatchedOrders = orders.filter((o) =>
    ['PARTIALLY_DISPATCHED', 'DISPATCHED'].includes(o.status)
  ).length;
  const cancelledOrders = orders.filter((o) => o.status === 'REJECTED').length;
  const totalSalesPaise = orders
    .filter((o) => o.status !== 'REJECTED')
    .reduce((s, o) => s + toPaise(o.subtotal ?? 0), 0);

  const monthlySalesMap = new Map<
    string,
    { month: string; salesValuePaise: number; orderCount: number }
  >();
  const statusMap = new Map<string, { status: string; count: number; valuePaise: number }>();

  for (const o of orders) {
    const st = statusMap.get(o.status) ?? { status: o.status, count: 0, valuePaise: 0 };
    st.count += 1;
    st.valuePaise += toPaise(o.subtotal ?? 0);
    statusMap.set(o.status, st);

    if (o.status !== 'REJECTED') {
      const m = o.orderDate.slice(0, 7);
      const cur = monthlySalesMap.get(m) ?? { month: m, salesValuePaise: 0, orderCount: 0 };
      cur.salesValuePaise += toPaise(o.subtotal ?? 0);
      cur.orderCount += 1;
      monthlySalesMap.set(m, cur);
    }
  }

  // Production Metrics
  const completedRequests = prs.filter((p) =>
    ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(p.status)
  ).length;
  const pendingRequests = prs.filter(
    (p) => !['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'].includes(p.status)
  ).length;
  const totalPlannedQuantity = prs
    .filter((p) => p.status !== 'CANCELLED')
    .reduce((s, p) => s + p.requestedQuantity, 0);
  const actualGoodOutput = runs.reduce((s, r) => s + r.actualOutputQuantity, 0);
  const rejectedOutput = runs.reduce((s, r) => s + (r.rejectedQuantity ?? 0), 0);

  const prodCompareMap = new Map<
    string,
    { productName: string; plannedQuantity: number; actualGoodOutput: number; rejectedQuantity: number }
  >();
  for (const p of prs.filter((x) => x.status !== 'CANCELLED')) {
    const cur = prodCompareMap.get(p.productId) ?? {
      productName: p.productName,
      plannedQuantity: 0,
      actualGoodOutput: 0,
      rejectedQuantity: 0,
    };
    cur.plannedQuantity = Number((cur.plannedQuantity + p.requestedQuantity).toFixed(3));
    prodCompareMap.set(p.productId, cur);
  }
  for (const r of runs) {
    const cur = prodCompareMap.get(r.productId) ?? {
      productName: r.productName,
      plannedQuantity: 0,
      actualGoodOutput: 0,
      rejectedQuantity: 0,
    };
    cur.actualGoodOutput = Number((cur.actualGoodOutput + r.actualOutputQuantity).toFixed(3));
    cur.rejectedQuantity = Number((cur.rejectedQuantity + (r.rejectedQuantity ?? 0)).toFixed(3));
    prodCompareMap.set(r.productId, cur);
  }

  const completionTrendMap = new Map<
    string,
    { month: string; completedRuns: number; plannedQuantity: number; actualGoodOutput: number }
  >();
  for (const r of runs) {
    const m = r.postedAt.slice(0, 7);
    const cur = completionTrendMap.get(m) ?? {
      month: m,
      completedRuns: 0,
      plannedQuantity: 0,
      actualGoodOutput: 0,
    };
    cur.completedRuns += 1;
    cur.plannedQuantity = Number((cur.plannedQuantity + r.plannedQuantity).toFixed(3));
    cur.actualGoodOutput = Number((cur.actualGoodOutput + r.actualOutputQuantity).toFixed(3));
    completionTrendMap.set(m, cur);
  }

  const matConsMap = new Map<
    string,
    {
      materialId: string;
      materialName: string;
      unit: string;
      plannedQuantity: number;
      actualConsumedQuantity: number;
      wastageQuantity: number;
    }
  >();
  for (const r of runs) {
    for (const c of r.consumptions) {
      const cur = matConsMap.get(c.materialId) ?? {
        materialId: c.materialId,
        materialName: c.materialName,
        unit: c.unit,
        plannedQuantity: 0,
        actualConsumedQuantity: 0,
        wastageQuantity: 0,
      };
      cur.plannedQuantity = Number((cur.plannedQuantity + c.plannedQuantity).toFixed(3));
      cur.actualConsumedQuantity = Number(
        (
          cur.actualConsumedQuantity +
          c.actualConsumedQuantity +
          (c.additionalConsumedQuantity ?? 0)
        ).toFixed(3)
      );
      cur.wastageQuantity = Number((cur.wastageQuantity + c.wastageQuantity).toFixed(3));
      matConsMap.set(c.materialId, cur);
    }
  }

  return {
    salesPerformance: {
      totalOrdersReceived: orders.length,
      approvedOrders,
      dispatchedOrders,
      cancelledOrders,
      totalSalesValue: fromPaise(totalSalesPaise),
      currentMonth,
      previousMonth,
      currentMonthSales: fromPaise(currentMonthSalesPaise),
      previousMonthSales: fromPaise(previousMonthSalesPaise),
      monthlyTrend: Array.from(monthlySalesMap.values())
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((m) => ({
          month: m.month,
          salesValue: fromPaise(m.salesValuePaise),
          orderCount: m.orderCount,
        })),
      statusDistribution: Array.from(statusMap.values()).map((s) => ({
        status: s.status,
        count: s.count,
        value: fromPaise(s.valuePaise),
      })),
    },
    productionPerformance: {
      totalRequests: prs.length,
      completedRequests,
      pendingRequests,
      totalPlannedQuantity: Number(totalPlannedQuantity.toFixed(3)),
      actualGoodOutput: Number(actualGoodOutput.toFixed(3)),
      rejectedOutput: Number(rejectedOutput.toFixed(3)),
      plannedVsActualByProduct: Array.from(prodCompareMap.values()),
      completionTrend: Array.from(completionTrendMap.values()).sort((a, b) =>
        a.month.localeCompare(b.month)
      ),
      materialConsumption: Array.from(matConsMap.values()).map((m) => ({
        ...m,
        varianceQuantity: Number((m.actualConsumedQuantity - m.plannedQuantity).toFixed(3)),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Owner Inventory Overview (Strictly Read-Only)
// ---------------------------------------------------------------------------

export function getOwnerInventoryOverview(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  const items = listInventoryItems(db);
  const shortages = listMaterialShortageQueries(db).filter((s) => s.status !== 'RESOLVED');
  const discrepancies = listStockDiscrepancyReports(db, actor);
  const recentMovements = listStockMovements(db).slice(0, 20);

  const annotate = (item: (typeof items)[number]) => ({
    ...item,
    stockStatus:
      item.availableStock <= 0
        ? ('OUT_OF_STOCK' as const)
        : item.availableStock < item.reorderLevel
          ? ('LOW_STOCK' as const)
          : ('IN_STOCK' as const),
  });

  const annotated = items.map(annotate);
  return {
    rawMaterials: annotated.filter((i) => i.category === 'RAW_MATERIAL'),
    packagingMaterials: annotated.filter((i) => i.category === 'PACKAGING_MATERIAL'),
    finishedProducts: annotated.filter((i) => i.category === 'FINISHED_GOOD'),
    lowStockItems: annotated.filter(
      (i) => i.availableStock < i.reorderLevel
    ),
    productionShortages: shortages,
    discrepancyReports: discrepancies,
    recentMovements,
  };
}

// ---------------------------------------------------------------------------
// 4. Owner Financial Overview (Strictly Read-Only; Exact Decimal Arithmetic)
// ---------------------------------------------------------------------------

export function getOwnerFinancialOverview(
  db: DatabaseSync,
  actor: AuthUser,
  filters?: { from?: string; to?: string }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  const from = filters?.from?.trim() || undefined;
  const to = filters?.to?.trim() || undefined;

  const billing = listInvoicesAndPayments(db);
  const receivables = listCustomerReceivables(db, actor);

  const activeInvoices = billing.invoices.filter(
    (i) => i.paymentStatus !== 'CANCELLED' && inDateRange(i.invoiceDate, from, to)
  );
  const postedPayments = billing.payments.filter(
    (p) => p.status !== 'REVERSED' && inDateRange(p.paymentDate, from, to)
  );

  // Actual Purchase Expenditure from verified Goods Receipts (GRNs)
  const receiptLines = db
    .prepare(
      `SELECT pr.received_date, pri.received_qty_scaled, pri.unit_cost_paise,
              ii.id AS item_id, ii.name AS item_name, ii.category
       FROM purchase_receipt_items pri
       JOIN purchase_receipts pr ON pr.id = pri.receipt_id
       JOIN inventory_items ii ON ii.id = pri.item_id
       ORDER BY pr.received_date ASC`
    )
    .all() as Array<{
    received_date: string;
    received_qty_scaled: number;
    unit_cost_paise: number;
    item_id: string;
    item_name: string;
    category: string;
  }>;

  let purchaseExpPaise = 0;
  const purchaseByMonthMap = new Map<string, number>();
  const purchaseByCatMap = new Map<string, number>();

  for (const line of receiptLines) {
    if (!inDateRange(line.received_date, from, to)) continue;
    const costPaise = calcTaxablePaise(line.received_qty_scaled, line.unit_cost_paise);
    purchaseExpPaise += costPaise;
    const mk = line.received_date.slice(0, 7);
    purchaseByMonthMap.set(mk, (purchaseByMonthMap.get(mk) ?? 0) + costPaise);
    purchaseByCatMap.set(
      line.category,
      (purchaseByCatMap.get(line.category) ?? 0) + costPaise
    );
  }

  const totalInvoicedPaise = activeInvoices.reduce((s, i) => s + toPaise(i.totalAmount), 0);
  const totalCollectedPaise = postedPayments.reduce((s, p) => s + toPaise(p.amount), 0);
  const totalOutstandingPaise = activeInvoices.reduce(
    (s, i) => s + toPaise(i.outstandingBalance),
    0
  );

  // Monthly Revenue vs Collections
  const revColMap = new Map<
    string,
    { month: string; invoicedPaise: number; collectedPaise: number }
  >();
  for (const inv of activeInvoices) {
    const mk = inv.invoiceDate.slice(0, 7);
    const cur = revColMap.get(mk) ?? { month: mk, invoicedPaise: 0, collectedPaise: 0 };
    cur.invoicedPaise += toPaise(inv.totalAmount);
    revColMap.set(mk, cur);
  }
  for (const p of postedPayments) {
    const mk = p.paymentDate.slice(0, 7);
    const cur = revColMap.get(mk) ?? { month: mk, invoicedPaise: 0, collectedPaise: 0 };
    cur.collectedPaise += toPaise(p.amount);
    revColMap.set(mk, cur);
  }

  return {
    totalInvoicedAmount: fromPaise(totalInvoicedPaise),
    totalAmountCollected: fromPaise(totalCollectedPaise),
    outstandingAmount: fromPaise(totalOutstandingPaise),
    purchaseExpenditure: fromPaise(purchaseExpPaise),
    revenueVsCollections: Array.from(revColMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({
        month: r.month,
        invoicedAmount: fromPaise(r.invoicedPaise),
        collectedAmount: fromPaise(r.collectedPaise),
      })),
    customerOutstanding: receivables
      .filter((r) => r.totalInvoiced > 0 || r.outstandingAmount > 0)
      .map((r) => ({
        customerId: r.customerId,
        customerCode: r.customerCode,
        customerName: r.customerName,
        totalInvoiced: r.totalInvoiced,
        totalPaid: r.totalPaid,
        pendingAmount: r.outstandingAmount,
        overdueAmount: r.overdueAmount,
        status: r.status,
      })),
    purchaseExpenditureByMonth: Array.from(purchaseByMonthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, paise]) => ({ month, amount: fromPaise(paise) })),
    purchaseExpenditureByCategory: Array.from(purchaseByCatMap.entries()).map(
      ([category, paise]) => ({ category, amount: fromPaise(paise) })
    ),
  };
}

// ---------------------------------------------------------------------------
// 5. Owner Purchase Approvals & Configurable Approval Limit
// ---------------------------------------------------------------------------

export function listOwnerPurchaseApprovals(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  const limitPaise = getPurchaseApprovalLimitPaise(db);
  const pos = listPurchaseOrders(db).filter((po) => po.approvalStatus !== 'NOT_REQUIRED');
  const invMap = new Map(listInventoryItems(db).map((i) => [i.id, i]));
  const suppliers = db
    .prepare(`SELECT id, name, code, phone, email, state, address FROM suppliers`)
    .all() as Array<{
    id: string;
    name: string;
    code: string;
    phone: string;
    email: string;
    state: string;
    address: string;
  }>;
  const supMap = new Map(suppliers.map((s) => [s.id, s]));
  const allReqs = listMaterialPurchaseRequirements(db, actor);

  return {
    approvalLimitRupees: fromPaise(limitPaise),
    approvals: pos.map((po) => {
      const sup = supMap.get(po.supplierId);
      const linkedReqs = allReqs.filter((r) => r.purchaseOrderId === po.id);
      return {
        ...po,
        supplierPhone: sup?.phone || '',
        supplierEmail: sup?.email || '',
        supplierState: sup?.state || '',
        supplierAddress: sup?.address || '',
        reason:
          linkedReqs.map((r) => r.reason).filter(Boolean).join('; ') ||
          po.notes ||
          'Procurement request requiring Owner approval',
        linkedRequirements: linkedReqs.map((r) => ({
          id: r.id,
          requirementNumber: r.requirementNumber,
          requestNumber: r.requestNumber,
          orderNumber: r.orderNumber,
          priority: r.priority,
          reason: r.reason,
          requestedByName: r.requestedByName,
        })),
        items: po.items.map((it) => {
          const live = invMap.get(it.itemId);
          return {
            ...it,
            lineEstimatedCost: Number((it.orderedQuantity * it.unitCost).toFixed(2)),
            currentAvailableStock: live?.availableStock ?? 0,
            reorderLevel: live?.reorderLevel ?? 0,
          };
        }),
      };
    }),
  };
}

export function updateOwnerApprovalLimit(
  db: DatabaseSync,
  actor: AuthUser,
  limitRupees: number
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);
  if (!Number.isFinite(limitRupees) || limitRupees < 0) {
    throw new HttpError(400, 'Approval limit must be zero or a positive amount.');
  }

  return runInTransaction(db, () => {
    const limitPaise = toPaise(limitRupees);
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('purchase_approval_limit_paise', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    ).run(String(limitPaise), actor.fullName, nowIso);

    recordAuditLog(
      db,
      actor,
      'SETTINGS',
      'purchase_approval_limit_paise',
      'UPDATE_APPROVAL_LIMIT',
      `Purchase approval threshold updated to ₹${fromPaise(limitPaise)}`
    );

    return { approvalLimitRupees: fromPaise(limitPaise) };
  });
}

// ---------------------------------------------------------------------------
// 6. Owner Comprehensive Reports (All 6 Report Categories)
// ---------------------------------------------------------------------------

export function getOwnerReports(
  db: DatabaseSync,
  actor: AuthUser,
  filters: {
    from?: string;
    to?: string;
    category?: string;
    status?: string;
  }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN']);

  const from = filters.from?.trim() || undefined;
  const to = filters.to?.trim() || undefined;
  const category = filters.category?.trim() || 'ALL';
  const status = filters.status?.trim() || 'ALL';

  const orders = listOrders(db).filter((o) => {
    if (!inDateRange(o.orderDate, from, to)) return false;
    if (status !== 'ALL' && o.status !== status) return false;
    return true;
  });

  const runs = listProductionRuns(db).filter((r) => {
    if (!inDateRange(r.postedAt, from, to)) return false;
    if (status !== 'ALL' && r.status !== status) return false;
    return true;
  });

  const invOverview = getOwnerInventoryOverview(db, actor);
  const allInventory = [
    ...invOverview.rawMaterials,
    ...invOverview.packagingMaterials,
    ...invOverview.finishedProducts,
  ].filter((it) => {
    if (category !== 'ALL' && it.category !== category) return false;
    if (status !== 'ALL' && it.stockStatus !== status) return false;
    return true;
  });

  const pos = listPurchaseOrders(db).filter((po) => {
    if (!inDateRange(po.orderDate, from, to)) return false;
    if (status !== 'ALL' && po.status !== status && po.approvalStatus !== status) return false;
    return true;
  });

  const finReports = getFinancialReports(db, actor, { from, to });
  const finOverview = getOwnerFinancialOverview(db, actor, { from, to });

  return {
    salesReport: {
      totalOrders: orders.length,
      totalSalesValue: fromPaise(
        orders.filter((o) => o.status !== 'REJECTED').reduce((s, o) => s + toPaise(o.subtotal ?? 0), 0)
      ),
      rows: orders,
    },
    productionReport: {
      totalRuns: runs.length,
      totalPlanned: Number(runs.reduce((s, r) => s + r.plannedQuantity, 0).toFixed(3)),
      totalGoodOutput: Number(runs.reduce((s, r) => s + r.actualOutputQuantity, 0).toFixed(3)),
      totalRejected: Number(runs.reduce((s, r) => s + (r.rejectedQuantity ?? 0), 0).toFixed(3)),
      totalWastage: Number(runs.reduce((s, r) => s + r.wastageQuantity, 0).toFixed(3)),
      rows: runs,
    },
    inventoryReport: {
      totalItems: allInventory.length,
      lowStockCount: allInventory.filter((i) => i.stockStatus === 'LOW_STOCK').length,
      outOfStockCount: allInventory.filter((i) => i.stockStatus === 'OUT_OF_STOCK').length,
      rows: allInventory,
    },
    purchaseReport: {
      totalOrders: pos.length,
      totalEstimatedValue: fromPaise(
        pos.reduce((s, po) => s + toPaise(po.estimatedTotal ?? 0), 0)
      ),
      rows: pos,
    },
    outstandingPaymentsReport: {
      totalOutstanding: finReports.outstandingReceivables.totalOutstanding,
      totalOverdue: finReports.outstandingReceivables.totalOverdue,
      rows: finReports.outstandingReceivables.rows,
    },
    financialSummary: {
      totalInvoicedAmount: finOverview.totalInvoicedAmount,
      totalAmountCollected: finOverview.totalAmountCollected,
      outstandingAmount: finOverview.outstandingAmount,
      purchaseExpenditure: finOverview.purchaseExpenditure,
      gstCollected: finReports.gstSummary.totalGst,
      cgstTotal: finReports.gstSummary.cgstTotal,
      sgstTotal: finReports.gstSummary.sgstTotal,
      igstTotal: finReports.gstSummary.igstTotal,
      revenueVsCollections: finOverview.revenueVsCollections,
    },
  };
}
