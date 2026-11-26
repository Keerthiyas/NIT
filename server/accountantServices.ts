import type { DatabaseSync } from 'node:sqlite';
import { HttpError, requireRole, type AuthUser } from './auth.ts';
import { BUSINESS_PROFILE, runInTransaction } from './db.ts';
import { fromPaise, fromScaledQty, toPaise } from './moneyQty.ts';
import {
  buildDispatchInvoiceComputation,
  listInvoicesAndPayments,
  nextSequenceNumber,
  recordAuditLog,
  uid,
} from './services.ts';

function toRupeesFixed(paise: number): number {
  return Math.round(paise) / 100;
}

// ---------------------------------------------------------------------------
// 1. Accountant Dashboard
// ---------------------------------------------------------------------------

export function getAccountantDashboard(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['ACCOUNTANT']);

  const workspace = listInvoicesAndPayments(db);
  const activeInvoices = workspace.invoices.filter((i) => i.paymentStatus !== 'CANCELLED');
  const postedPayments = workspace.payments.filter((p) => p.status !== 'REVERSED');

  const totalInvoicedPaise = activeInvoices.reduce((s, i) => s + toPaise(i.totalAmount), 0);
  const collectedPaise = postedPayments.reduce((s, p) => s + toPaise(p.amount), 0);
  const outstandingPaise = activeInvoices.reduce(
    (s, i) => s + toPaise(i.outstandingBalance),
    0
  );

  return {
    pendingInvoicesCount: workspace.dispatchesReadyForInvoicing.length,
    totalInvoicedAmount: fromPaise(totalInvoicedPaise),
    amountCollected: fromPaise(collectedPaise),
    outstandingAmount: fromPaise(outstandingPaise),
    pendingDispatches: workspace.dispatchesReadyForInvoicing,
    recentPayments: postedPayments.slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// 2. Dispatch Invoice Preview & Cancellation
// ---------------------------------------------------------------------------

export function previewDispatchInvoiceByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  dispatchId: string,
  options?: { quantity?: number; placeOfSupplyState?: string }
) {
  requireRole(actor, ['ACCOUNTANT']);

  const comp = buildDispatchInvoiceComputation(db, dispatchId, options);
  const {
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
  } = comp;

  return {
    businessProfile: BUSINESS_PROFILE,
    dispatchId: dispatch.id,
    dispatchNumber: dispatch.dispatch_number,
    dispatchedAt: dispatch.dispatched_at,
    orderId: dispatch.order_id,
    orderNumber: dispatch.order_number,
    customerId: dispatch.customer_id,
    customerName: dispatch.customer_name,
    customerCode: dispatch.customer_code,
    customerGstin: dispatch.customer_gstin,
    billingAddress: dispatch.billing_address,
    deliveryAddress: dispatch.delivery_address,
    customerState: dispatch.customer_state,
    customerStateCode: pos.placeOfSupplyCode,
    supplyType: pos.supplyType,
    placeOfSupplyState: pos.placeOfSupplyState,
    uninvoicedQuantity: fromScaledQty(remainingScaled),
    invoiceQuantity: fromScaledQty(requestedInvoiceScaled),
    subtotal: fromPaise(taxablePaise),
    taxableAmount: fromPaise(taxablePaise),
    cgstAmount: fromPaise(cgstTotalPaise),
    sgstAmount: fromPaise(sgstTotalPaise),
    igstAmount: fromPaise(igstTotalPaise),
    totalGstAmount: fromPaise(totalGstPaise),
    totalAmount: fromPaise(totalPaise),
    lines: lineSpecs.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      sku: l.sku,
      hsnCode: l.hsnCode,
      unit: l.unit,
      quantity: fromScaledQty(l.qtyScaled),
      unitPrice: fromPaise(l.unitPricePaise),
      gstRate: Number((l.gstRateBps / 100).toFixed(2)),
      taxableAmount: fromPaise(l.taxablePaise),
      cgstAmount: fromPaise(l.cgstPaise),
      sgstAmount: fromPaise(l.sgstPaise),
      igstAmount: fromPaise(l.igstPaise),
      taxAmount: fromPaise(l.totalGstPaise),
      totalAmount: fromPaise(l.totalPaise),
    })),
  };
}

export function cancelInvoiceByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  invoiceId: string,
  reason: string
) {
  requireRole(actor, ['ACCOUNTANT']);

  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    throw new HttpError(400, 'Please provide a cancellation reason for audit logging.');
  }

  return runInTransaction(db, () => {
    const inv = db
      .prepare(`SELECT * FROM invoices WHERE id = ?`)
      .get(invoiceId) as
      | {
          id: string;
          invoice_number: string;
          dispatch_id: string;
          invoiced_qty_scaled: number;
          paid_amount_paise: number;
          payment_status: string;
        }
      | undefined;

    if (!inv) {
      throw new HttpError(404, `Invoice ${invoiceId} not found.`);
    }
    if (inv.payment_status === 'CANCELLED') {
      throw new HttpError(400, `Invoice ${inv.invoice_number} is already cancelled.`);
    }
    if (inv.paid_amount_paise > 0) {
      throw new HttpError(
        400,
        `Cannot cancel ${inv.invoice_number} because ₹${fromPaise(inv.paid_amount_paise)} has already been paid. Reverse linked payments first.`
      );
    }

    const invLines = db
      .prepare(`SELECT product_id, quantity_scaled FROM invoice_lines WHERE invoice_id = ?`)
      .all(inv.id) as Array<{ product_id: string; quantity_scaled: number }>;

    const qtyToRestore =
      inv.invoiced_qty_scaled > 0
        ? inv.invoiced_qty_scaled
        : invLines.reduce((s, l) => s + l.quantity_scaled, 0);

    const nowIso = new Date().toISOString();

    db.prepare(
      `UPDATE invoices
       SET payment_status = 'CANCELLED', cancelled_by = ?, cancelled_at = ?, cancellation_reason = ?
       WHERE id = ?`
    ).run(actor.fullName, nowIso, cleanReason, inv.id);

    db.prepare(
      `UPDATE dispatches
       SET invoiced_qty_scaled = MAX(0, invoiced_qty_scaled - ?)
       WHERE id = ?`
    ).run(qtyToRestore, inv.dispatch_id);

    const updDispItem = db.prepare(
      `UPDATE dispatch_items
       SET invoiced_qty_scaled = MAX(0, invoiced_qty_scaled - ?)
       WHERE dispatch_id = ? AND product_id = ?`
    );
    for (const line of invLines) {
      updDispItem.run(line.quantity_scaled, inv.dispatch_id, line.product_id);
    }

    recordAuditLog(
      db,
      actor,
      'INVOICE',
      inv.id,
      'CANCEL_INVOICE',
      `${inv.invoice_number} cancelled: ${cleanReason}`
    );

    return { id: inv.id, invoiceNumber: inv.invoice_number, status: 'CANCELLED' };
  });
}

// ---------------------------------------------------------------------------
// 3. Customer-Allocated Payments & Auditable Payment Reversals
// ---------------------------------------------------------------------------

export function recordCustomerPaymentByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  input: {
    customerId: string;
    amount: number;
    allocations: Array<{ invoiceId: string; amount: number }>;
    paymentMode: string;
    referenceNumber?: string;
    paymentDate?: string;
    notes?: string;
    idempotencyKey?: string;
  }
) {
  requireRole(actor, ['ACCOUNTANT']);

  if (!input.customerId?.trim()) {
    throw new HttpError(400, 'Customer selection is required.');
  }
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new HttpError(400, 'Select at least one invoice allocation.');
  }

  return runInTransaction(db, () => {
    if (input.idempotencyKey) {
      const existing = db
        .prepare(`SELECT id, payment_number FROM payments WHERE idempotency_key = ?`)
        .get(input.idempotencyKey) as { id: string; payment_number: string } | undefined;
      if (existing) {
        return {
          id: existing.id,
          paymentNumber: existing.payment_number,
          deduplicated: true,
        };
      }
    }

    const cust = db
      .prepare(`SELECT id, name FROM customers WHERE id = ?`)
      .get(input.customerId) as { id: string; name: string } | undefined;
    if (!cust) {
      throw new HttpError(404, `Customer ${input.customerId} not found.`);
    }

    const amountPaise = toPaise(input.amount);
    if (amountPaise <= 0) {
      throw new HttpError(400, 'Payment amount must be greater than zero.');
    }

    const totalCustOutstandingRow = db
      .prepare(
        `SELECT COALESCE(SUM(MAX(0, total_amount_paise - paid_amount_paise)), 0) AS total_out
         FROM invoices
         WHERE customer_id = ? AND payment_status != 'CANCELLED'`
      )
      .get(cust.id) as { total_out: number };

    if (amountPaise > totalCustOutstandingRow.total_out) {
      throw new HttpError(
        400,
        `Payment ₹${fromPaise(amountPaise)} exceeds customer total outstanding ₹${fromPaise(totalCustOutstandingRow.total_out)}.`
      );
    }

    const seenInvoices = new Set<string>();
    const resolvedAllocs: Array<{
      invoiceId: string;
      invoiceNumber: string;
      amountPaise: number;
      currentPaidPaise: number;
      totalAmountPaise: number;
    }> = [];

    let allocatedTotalPaise = 0;
    for (const alloc of input.allocations) {
      if (seenInvoices.has(alloc.invoiceId)) {
        throw new HttpError(400, 'Duplicate invoice allocation entry.');
      }
      seenInvoices.add(alloc.invoiceId);

      const allocPaise = toPaise(alloc.amount);
      if (allocPaise <= 0) {
        throw new HttpError(400, 'Allocated invoice amount must be greater than zero.');
      }

      const inv = db
        .prepare(
          `SELECT id, invoice_number, customer_id, total_amount_paise, paid_amount_paise, payment_status
           FROM invoices WHERE id = ?`
        )
        .get(alloc.invoiceId) as
        | {
            id: string;
            invoice_number: string;
            customer_id: string;
            total_amount_paise: number;
            paid_amount_paise: number;
            payment_status: string;
          }
        | undefined;

      if (!inv || inv.customer_id !== cust.id) {
        throw new HttpError(400, `Invoice ${alloc.invoiceId} does not belong to ${cust.name}.`);
      }
      if (inv.payment_status === 'CANCELLED') {
        throw new HttpError(400, `Invoice ${inv.invoice_number} is cancelled.`);
      }

      const invOutstanding = Math.max(0, inv.total_amount_paise - inv.paid_amount_paise);
      if (allocPaise > invOutstanding) {
        throw new HttpError(
          400,
          `Allocated ₹${fromPaise(allocPaise)} exceeds ${inv.invoice_number} outstanding balance ₹${fromPaise(invOutstanding)}.`
        );
      }

      allocatedTotalPaise += allocPaise;
      resolvedAllocs.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        amountPaise: allocPaise,
        currentPaidPaise: inv.paid_amount_paise,
        totalAmountPaise: inv.total_amount_paise,
      });
    }

    if (allocatedTotalPaise > amountPaise) {
      throw new HttpError(
        400,
        `Total allocated amount (₹${fromPaise(allocatedTotalPaise)}) cannot exceed payment amount (₹${fromPaise(amountPaise)}).`
      );
    }

    const unallocatedPaise = amountPaise - allocatedTotalPaise;
    const nowIso = new Date().toISOString();
    const paymentNumber = nextSequenceNumber(db, 'payments', 'payment_number', 'PAY-2026-');
    const paymentId = uid('pay');
    const singleInvoiceId = resolvedAllocs.length === 1 ? resolvedAllocs[0].invoiceId : null;

    db.prepare(
      `INSERT INTO payments (
        id, payment_number, invoice_id, customer_id, payment_date, amount_paise, unallocated_paise,
        payment_mode, reference_number, status, recorded_by, notes, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?)`
    ).run(
      paymentId,
      paymentNumber,
      singleInvoiceId,
      cust.id,
      input.paymentDate || nowIso.slice(0, 10),
      amountPaise,
      unallocatedPaise,
      input.paymentMode.trim() || 'Bank Transfer',
      input.referenceNumber?.trim() || '',
      actor.fullName,
      input.notes?.trim() || '',
      input.idempotencyKey || null,
      nowIso
    );

    const insAlloc = db.prepare(
      `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const updInv = db.prepare(
      `UPDATE invoices SET paid_amount_paise = ?, payment_status = ? WHERE id = ?`
    );

    for (const a of resolvedAllocs) {
      insAlloc.run(uid('pal'), paymentId, a.invoiceId, a.amountPaise, nowIso);
      const nextPaid = a.currentPaidPaise + a.amountPaise;
      const nextStatus = nextPaid >= a.totalAmountPaise ? 'PAID' : 'PARTIALLY_PAID';
      updInv.run(nextPaid, nextStatus, a.invoiceId);
    }

    recordAuditLog(
      db,
      actor,
      'PAYMENT',
      paymentId,
      'RECORD_CUSTOMER_PAYMENT',
      `${paymentNumber} for ${cust.name}: ₹${fromPaise(amountPaise)} allocated across ${resolvedAllocs.map((a) => `${a.invoiceNumber} (₹${fromPaise(a.amountPaise)})`).join(', ')}`
    );

    return {
      id: paymentId,
      paymentNumber,
      unallocatedAmount: fromPaise(unallocatedPaise),
      deduplicated: false,
    };
  });
}

export function reversePaymentByAccountant(
  db: DatabaseSync,
  actor: AuthUser,
  paymentId: string,
  reason: string
) {
  requireRole(actor, ['ACCOUNTANT']);

  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    throw new HttpError(400, 'Please enter a reason to reverse this payment.');
  }

  return runInTransaction(db, () => {
    const pay = db
      .prepare(`SELECT * FROM payments WHERE id = ?`)
      .get(paymentId) as
      | {
          id: string;
          payment_number: string;
          invoice_id: string | null;
          amount_paise: number;
          status: string;
        }
      | undefined;

    if (!pay) {
      throw new HttpError(404, `Payment ${paymentId} not found.`);
    }
    if (pay.status === 'REVERSED') {
      throw new HttpError(400, `Payment ${pay.payment_number} is already reversed.`);
    }

    let allocs = db
      .prepare(`SELECT invoice_id, amount_paise FROM payment_allocations WHERE payment_id = ?`)
      .all(pay.id) as Array<{ invoice_id: string; amount_paise: number }>;

    if (allocs.length === 0 && pay.invoice_id) {
      allocs = [{ invoice_id: pay.invoice_id, amount_paise: pay.amount_paise }];
    }

    for (const a of allocs) {
      const inv = db
        .prepare(`SELECT id, total_amount_paise, paid_amount_paise, payment_status FROM invoices WHERE id = ?`)
        .get(a.invoice_id) as
        | {
            id: string;
            total_amount_paise: number;
            paid_amount_paise: number;
            payment_status: string;
          }
        | undefined;

      if (!inv || inv.payment_status === 'CANCELLED') continue;
      const nextPaid = Math.max(0, inv.paid_amount_paise - a.amount_paise);
      const nextStatus =
        nextPaid === 0 ? 'UNPAID' : nextPaid >= inv.total_amount_paise ? 'PAID' : 'PARTIALLY_PAID';
      db.prepare(`UPDATE invoices SET paid_amount_paise = ?, payment_status = ? WHERE id = ?`).run(
        nextPaid,
        nextStatus,
        inv.id
      );
    }

    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE payments
       SET status = 'REVERSED', reversed_by = ?, reversed_at = ?, reversal_reason = ?
       WHERE id = ?`
    ).run(actor.fullName, nowIso, cleanReason, pay.id);

    recordAuditLog(
      db,
      actor,
      'PAYMENT',
      pay.id,
      'REVERSE_PAYMENT',
      `${pay.payment_number} (₹${fromPaise(pay.amount_paise)}) reversed: ${cleanReason}`
    );

    return { id: pay.id, paymentNumber: pay.payment_number, status: 'REVERSED' };
  });
}

// ---------------------------------------------------------------------------
// 4. Customer Receivables & Financial Reports (Accountant, Admin & Owner read)
// ---------------------------------------------------------------------------

export function listCustomerReceivables(db: DatabaseSync, actor: AuthUser) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);

  const workspace = listInvoicesAndPayments(db);
  const customers = db
    .prepare(`SELECT * FROM customers ORDER BY name ASC`)
    .all() as Array<{
    id: string;
    code: string;
    name: string;
    contact_person: string;
    phone: string;
    email: string;
    gstin: string;
    billing_address: string;
    state: string;
  }>;

  const today = new Date().toISOString().slice(0, 10);

  return customers.map((c) => {
    const custInvoices = workspace.invoices.filter(
      (i) => i.customerId === c.id && i.paymentStatus !== 'CANCELLED'
    );
    const custPayments = workspace.payments.filter(
      (p) => p.customerId === c.id && p.status !== 'REVERSED'
    );

    const totalInvoicedPaise = custInvoices.reduce((s, i) => s + toPaise(i.totalAmount), 0);
    const totalPaidPaise = custInvoices.reduce((s, i) => s + toPaise(i.amountReceived), 0);
    const outstandingPaise = Math.max(0, totalInvoicedPaise - totalPaidPaise);

    const unpaidInvoices = custInvoices
      .filter((i) => i.outstandingBalance > 0)
      .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));

    const oldestUnpaid = unpaidInvoices[0];
    const overduePaise = unpaidInvoices
      .filter((inv) => {
        const due = inv.dueDate || inv.invoiceDate;
        return due < today;
      })
      .reduce((s, i) => s + toPaise(i.outstandingBalance), 0);

    let status: 'SETTLED' | 'OVERDUE' | 'PARTIALLY_PAID' | 'OUTSTANDING' = 'SETTLED';
    if (outstandingPaise > 0) {
      if (overduePaise > 0) status = 'OVERDUE';
      else if (totalPaidPaise > 0) status = 'PARTIALLY_PAID';
      else status = 'OUTSTANDING';
    }

    return {
      customerId: c.id,
      customerCode: c.code,
      customerName: c.name,
      contactPerson: c.contact_person,
      phone: c.phone,
      email: c.email,
      customerGstin: c.gstin,
      billingAddress: c.billing_address,
      state: c.state,
      totalInvoiced: fromPaise(totalInvoicedPaise),
      totalPaid: fromPaise(totalPaidPaise),
      outstandingAmount: fromPaise(outstandingPaise),
      overdueAmount: fromPaise(overduePaise),
      oldestUnpaidInvoiceId: oldestUnpaid?.id,
      oldestUnpaidInvoiceNumber: oldestUnpaid?.invoiceNumber,
      oldestUnpaidInvoiceDate: oldestUnpaid?.invoiceDate,
      status,
      invoices: custInvoices,
      payments: custPayments,
    };
  });
}

export function getFinancialReports(
  db: DatabaseSync,
  actor: AuthUser,
  filters: {
    from?: string;
    to?: string;
    customerId?: string;
    status?: string;
  }
) {
  requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);

  const workspace = listInvoicesAndPayments(db);
  const receivables = listCustomerReceivables(db, actor);

  const fromDate = (filters.from ?? '').trim();
  const toDate = (filters.to ?? '').trim();
  const custId = (filters.customerId ?? '').trim();
  const invStatus = (filters.status ?? '').trim();

  const filteredInvoices = workspace.invoices.filter((inv) => {
    if (fromDate && inv.invoiceDate < fromDate) return false;
    if (toDate && inv.invoiceDate > toDate) return false;
    if (custId && custId !== 'ALL' && inv.customerId !== custId) return false;
    if (invStatus && invStatus !== 'ALL' && inv.paymentStatus !== invStatus) return false;
    return true;
  });

  const nonCancelledInvoices = filteredInvoices.filter((i) => i.paymentStatus !== 'CANCELLED');

  const salesTaxablePaise = nonCancelledInvoices.reduce(
    (s, i) => s + toPaise(i.taxableAmount),
    0
  );
  const salesGstPaise = nonCancelledInvoices.reduce(
    (s, i) => s + toPaise(i.totalGstAmount),
    0
  );
  const salesTotalPaise = nonCancelledInvoices.reduce((s, i) => s + toPaise(i.totalAmount), 0);
  const salesPaidPaise = nonCancelledInvoices.reduce(
    (s, i) => s + toPaise(i.amountReceived),
    0
  );

  // GST Summary grouped by rate & supply type
  const gstMap = new Map<
    string,
    {
      gstRate: number;
      supplyType: 'INTRA_STATE' | 'INTER_STATE';
      invoiceCount: number;
      taxablePaise: number;
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
      totalGstPaise: number;
    }
  >();

  for (const inv of nonCancelledInvoices) {
    const invSeenKeys = new Set<string>();
    for (const line of inv.lines) {
      const key = `${line.gstRate}|${inv.supplyType}`;
      let bucket = gstMap.get(key);
      if (!bucket) {
        bucket = {
          gstRate: line.gstRate,
          supplyType: inv.supplyType,
          invoiceCount: 0,
          taxablePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          totalGstPaise: 0,
        };
        gstMap.set(key, bucket);
      }
      if (!invSeenKeys.has(key)) {
        bucket.invoiceCount += 1;
        invSeenKeys.add(key);
      }
      bucket.taxablePaise += toPaise(line.taxableAmount);
      bucket.cgstPaise += toPaise(line.cgstAmount);
      bucket.sgstPaise += toPaise(line.sgstAmount);
      bucket.igstPaise += toPaise(line.igstAmount);
      bucket.totalGstPaise += toPaise(line.cgstAmount + line.sgstAmount + line.igstAmount);
    }
  }

  const gstBreakdown = Array.from(gstMap.values())
    .sort((a, b) => a.gstRate - b.gstRate || a.supplyType.localeCompare(b.supplyType))
    .map((b) => ({
      gstRate: b.gstRate,
      supplyType: b.supplyType,
      invoiceCount: b.invoiceCount,
      taxableAmount: toRupeesFixed(b.taxablePaise),
      cgstAmount: toRupeesFixed(b.cgstPaise),
      sgstAmount: toRupeesFixed(b.sgstPaise),
      igstAmount: toRupeesFixed(b.igstPaise),
      totalGstAmount: toRupeesFixed(b.totalGstPaise),
    }));

  // Payment Collection Report
  const filteredPayments = workspace.payments.filter((p) => {
    if (p.status === 'REVERSED') return false;
    if (fromDate && p.paymentDate < fromDate) return false;
    if (toDate && p.paymentDate > toDate) return false;
    if (custId && custId !== 'ALL' && p.customerId !== custId) return false;
    return true;
  });

  const modeMap = new Map<string, { paymentMode: string; count: number; totalPaise: number }>();
  for (const p of filteredPayments) {
    const mode = p.paymentMode || 'Other';
    const b = modeMap.get(mode) ?? { paymentMode: mode, count: 0, totalPaise: 0 };
    b.count += 1;
    b.totalPaise += toPaise(p.amount);
    modeMap.set(mode, b);
  }

  const filteredReceivables = receivables.filter((r) => {
    if (custId && custId !== 'ALL' && r.customerId !== custId) return false;
    return r.totalInvoiced > 0 || r.outstandingAmount > 0;
  });

  return {
    salesAndInvoices: {
      invoiceCount: filteredInvoices.length,
      activeInvoiceCount: nonCancelledInvoices.length,
      taxableTotal: toRupeesFixed(salesTaxablePaise),
      gstTotal: toRupeesFixed(salesGstPaise),
      grandTotal: toRupeesFixed(salesTotalPaise),
      collectedTotal: toRupeesFixed(salesPaidPaise),
      outstandingTotal: toRupeesFixed(Math.max(0, salesTotalPaise - salesPaidPaise)),
      rows: filteredInvoices,
    },
    gstSummary: {
      taxableTotal: toRupeesFixed(salesTaxablePaise),
      cgstTotal: toRupeesFixed(
        gstBreakdown.reduce((s, b) => s + toPaise(b.cgstAmount), 0)
      ),
      sgstTotal: toRupeesFixed(
        gstBreakdown.reduce((s, b) => s + toPaise(b.sgstAmount), 0)
      ),
      igstTotal: toRupeesFixed(
        gstBreakdown.reduce((s, b) => s + toPaise(b.igstAmount), 0)
      ),
      totalGst: toRupeesFixed(salesGstPaise),
      rows: gstBreakdown,
    },
    paymentCollection: {
      totalCollected: toRupeesFixed(
        filteredPayments.reduce((s, p) => s + toPaise(p.amount), 0)
      ),
      paymentCount: filteredPayments.length,
      byMode: Array.from(modeMap.values()).map((m) => ({
        paymentMode: m.paymentMode,
        count: m.count,
        totalAmount: toRupeesFixed(m.totalPaise),
      })),
      rows: filteredPayments,
    },
    outstandingReceivables: {
      totalOutstanding: toRupeesFixed(
        filteredReceivables.reduce((s, r) => s + toPaise(r.outstandingAmount), 0)
      ),
      totalOverdue: toRupeesFixed(
        filteredReceivables.reduce((s, r) => s + toPaise(r.overdueAmount), 0)
      ),
      customerCount: filteredReceivables.filter((r) => r.outstandingAmount > 0).length,
      rows: filteredReceivables,
    },
  };
}
