import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Eye, Plus, RotateCcw, Search, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  CustomerReceivableSummary,
  Invoice,
  InvoicePayment,
} from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface AccountantPaymentsViewProps {
  invoices: Invoice[];
  payments: InvoicePayment[];
  receivables: CustomerReceivableSummary[];
  initialInvoiceForPayment?: Invoice | null;
  initialCustomerForPayment?: string | null;
  onClearInitialTargets?: () => void;
  onRefresh: () => Promise<void>;
}

const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other'] as const;

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function AccountantPaymentsView({
  invoices,
  payments,
  receivables,
  initialInvoiceForPayment = null,
  initialCustomerForPayment = null,
  onClearInitialTargets,
  onRefresh,
}: AccountantPaymentsViewProps) {
  const today = new Date().toISOString().slice(0, 10);

  // Payment History filters
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'POSTED' | 'REVERSED'>('ALL');

  // Entry A: Single Invoice Payment Modal
  const [invoiceModal, setInvoiceModal] = useState<Invoice | null>(null);
  const [invPayAmount, setInvPayAmount] = useState('');
  const [invPayMethod, setInvPayMethod] = useState<string>('UPI');
  const [invPayDate, setInvPayDate] = useState(today);
  const [invPayRef, setInvPayRef] = useState('');
  const [invPayNotes, setInvPayNotes] = useState('');

  // Entry B: Customer-Based Multi-Invoice Allocation Panel/Modal
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [selectedCustId, setSelectedCustId] = useState('');
  const [custPayAmount, setCustPayAmount] = useState('');
  const [custPayMethod, setCustPayMethod] = useState<string>('Bank Transfer');
  const [custPayDate, setCustPayDate] = useState(today);
  const [custPayRef, setCustPayRef] = useState('');
  const [custPayNotes, setCustPayNotes] = useState('');
  const [allocMap, setAllocMap] = useState<Record<string, string>>({});

  // Inspect & Reverse Payment Modals
  const [detailPayment, setDetailPayment] = useState<InvoicePayment | null>(null);
  const [reverseModal, setReverseModal] = useState<InvoicePayment | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const openInvoicePaymentModal = (inv: Invoice) => {
    setInvoiceModal(inv);
    setInvPayAmount(String(inv.outstandingBalance));
    setInvPayMethod('UPI');
    setInvPayDate(today);
    setInvPayRef('');
    setInvPayNotes('');
    setFeedback(null);
  };

  const openCustomerPaymentModal = (custId?: string) => {
    const customersWithBal = receivables.filter((r) => r.outstandingAmount > 0);
    const chosenId = custId || customersWithBal[0]?.customerId || receivables[0]?.customerId || '';
    setSelectedCustId(chosenId);
    setCustSearch('');
    setCustPayAmount('');
    setCustPayMethod('Bank Transfer');
    setCustPayDate(today);
    setCustPayRef('');
    setCustPayNotes('');
    setAllocMap({});
    setCustModalOpen(true);
    setFeedback(null);
  };

  useEffect(() => {
    if (initialInvoiceForPayment) {
      openInvoicePaymentModal(initialInvoiceForPayment);
      onClearInitialTargets?.();
    } else if (initialCustomerForPayment) {
      openCustomerPaymentModal(initialCustomerForPayment);
      onClearInitialTargets?.();
    }
  }, [initialInvoiceForPayment, initialCustomerForPayment]);

  const unpaidInvoices = useMemo(
    () =>
      invoices.filter(
        (i) => i.outstandingBalance > 0 && i.paymentStatus !== 'CANCELLED'
      ),
    [invoices]
  );

  const filteredCustomersForSelect = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    return receivables.filter(
      (r) =>
        r.outstandingAmount > 0 &&
        (!q ||
          r.customerName.toLowerCase().includes(q) ||
          r.customerCode.toLowerCase().includes(q))
    );
  }, [receivables, custSearch]);

  const selectedCustRec = useMemo(
    () => receivables.find((r) => r.customerId === selectedCustId) ?? null,
    [receivables, selectedCustId]
  );

  const selectedCustOpenInvoices = useMemo(
    () =>
      selectedCustRec
        ? selectedCustRec.invoices
            .filter((i) => i.outstandingBalance > 0 && i.paymentStatus !== 'CANCELLED')
            .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))
        : [],
    [selectedCustRec]
  );

  const totalAllocated = useMemo(
    () =>
      Object.values(allocMap).reduce((s, val) => {
        const n = Number(val);
        return s + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [allocMap]
  );

  const custAmountNum = Number(custPayAmount) || 0;
  const remainingUnallocated = Number((custAmountNum - totalAllocated).toFixed(2));

  const autoAllocateFifo = () => {
    let rem = Number(custPayAmount) || 0;
    const next: Record<string, string> = {};
    for (const inv of selectedCustOpenInvoices) {
      if (rem <= 0) break;
      const take = Math.min(rem, inv.outstandingBalance);
      next[inv.id] = take.toFixed(2);
      rem = Number((rem - take).toFixed(2));
    }
    setAllocMap(next);
  };

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      if (methodFilter !== 'ALL' && p.paymentMode !== methodFilter) return false;
      if (statusFilter !== 'ALL' && (p.status || 'POSTED') !== statusFilter) return false;
      if (!q) return true;
      return (
        p.paymentNumber.toLowerCase().includes(q) ||
        (p.customerName ?? '').toLowerCase().includes(q) ||
        (p.invoiceNumber ?? '').toLowerCase().includes(q) ||
        (p.referenceNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [payments, search, methodFilter, statusFilter]);

  const handleSaveInvoicePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceModal) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.recordPayment({
        invoiceId: invoiceModal.id,
        amount: Number(invPayAmount),
        paymentMode: invPayMethod,
        paymentDate: invPayDate,
        referenceNumber: invPayRef,
        notes: invPayNotes,
        idempotencyKey: `pay-inv-${invoiceModal.id}-${invPayAmount}-${Date.now()}`,
      });
      setInvoiceModal(null);
      setFeedback({
        type: 'ok',
        text: `Recorded payment ${res.paymentNumber} (${res.paymentStatus}).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to record payment.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCustomerPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustId) return;
    const allocations = Object.entries(allocMap)
      .map(([invoiceId, val]) => ({ invoiceId, amount: Number(val) }))
      .filter((a) => Number.isFinite(a.amount) && a.amount > 0);

    if (allocations.length === 0) {
      setFeedback({ type: 'err', text: 'Allocate the payment to at least one invoice.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.recordCustomerPayment({
        customerId: selectedCustId,
        amount: Number(custPayAmount),
        allocations,
        paymentMode: custPayMethod,
        paymentDate: custPayDate,
        referenceNumber: custPayRef,
        notes: custPayNotes,
        idempotencyKey: `pay-cust-${selectedCustId}-${custPayAmount}-${Date.now()}`,
      });
      setCustModalOpen(false);
      setFeedback({
        type: 'ok',
        text: `Recorded customer payment ${res.paymentNumber}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save customer payment.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReversePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseModal) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.reversePayment(reverseModal.id, reverseReason);
      setReverseModal(null);
      setReverseReason('');
      setDetailPayment(null);
      setFeedback({
        type: 'ok',
        text: `Payment ${res.paymentNumber} reversed with audit trail. Linked invoice balances updated.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to reverse payment.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-xs font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Record Customer Collections</h2>
          <p className="text-xs text-slate-500">
            Record payments against an individual invoice or allocate across multiple invoices of a
            customer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCustomerPaymentModal()}
          disabled={receivables.every((r) => r.outstandingAmount <= 0)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Record Customer Payment
        </button>
      </div>

      {/* Outstanding Invoices Quick Collect */}
      <Card
        title={`Outstanding Invoices (${unpaidInvoices.length})`}
        subtitle="Click Record Payment to settle full or partial balance for an invoice"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Invoice #</th>
                <th className="px-4 py-2 text-left font-semibold">Customer</th>
                <th className="px-4 py-2 text-left font-semibold">Date</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
                <th className="px-4 py-2 text-right font-semibold">Paid</th>
                <th className="px-4 py-2 text-right font-semibold">Outstanding</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {unpaidInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-5 text-center text-slate-500">
                    All issued invoices are fully settled.
                  </td>
                </tr>
              ) : (
                unpaidInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-semibold text-blue-900">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{inv.customerName}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{inv.invoiceDate}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatInr(inv.totalAmount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                      {formatInr(inv.amountReceived)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-rose-700">
                      {formatInr(inv.outstandingBalance)}
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        tone={inv.paymentStatus === 'PARTIALLY_PAID' ? 'warning' : 'danger'}
                      >
                        {inv.paymentStatus === 'PARTIALLY_PAID' ? 'Partially Paid' : 'Unpaid'}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openInvoicePaymentModal(inv)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-50 cursor-pointer"
                      >
                        <CreditCard className="h-3 w-3" />
                        Record Payment
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Payment History */}
      <Card
        title="Payment History"
        subtitle="Recorded customer receipts and invoice allocations; corrections use auditable reversals"
        noPadding
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Payment #, customer, invoice, ref..."
                className="w-48 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs"
              />
            </div>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
            >
              <option value="ALL">All Methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="UPI / Campus Transfer">UPI / Campus Transfer</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | 'POSTED' | 'REVERSED')
              }
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
            >
              <option value="ALL">All Statuses</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Payment ID</th>
                <th className="px-4 py-2.5 text-left font-semibold">Customer</th>
                <th className="px-4 py-2.5 text-left font-semibold">Invoice References</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 text-left font-semibold">Method</th>
                <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                <th className="px-4 py-2.5 text-left font-semibold">Recorded By</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No payments match your search.
                  </td>
                </tr>
              ) : (
                filteredPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-semibold text-blue-900">
                      {p.paymentNumber}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{p.customerName}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-700">
                      {p.invoiceNumber || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                      {formatInr(p.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {p.paymentMode}
                      {p.referenceNumber ? ` · ${p.referenceNumber}` : ''}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{p.paymentDate}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.recordedBy}</td>
                    <td className="px-4 py-2.5">
                      <ToneBadge tone={p.status === 'REVERSED' ? 'neutral' : 'success'}>
                        {p.status || 'POSTED'}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={() => setDetailPayment(p)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Eye className="h-3 w-3" />
                        Details
                      </button>
                      {p.status !== 'REVERSED' && (
                        <button
                          type="button"
                          onClick={() => {
                            setReverseModal(p);
                            setReverseReason('');
                          }}
                          className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Entry A Modal: Invoice-based Payment */}
      {invoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <form
            onSubmit={(e) => void handleSaveInvoicePayment(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Record Payment — {invoiceModal.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {invoiceModal.customerName} · Outstanding:{' '}
                  <strong>{formatInr(invoiceModal.outstandingBalance)}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInvoiceModal(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Amount Received (₹)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={invoiceModal.outstandingBalance}
                    value={invPayAmount}
                    onChange={(e) => setInvPayAmount(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Date</label>
                  <input
                    required
                    type="date"
                    value={invPayDate}
                    onChange={(e) => setInvPayDate(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={invPayMethod}
                    onChange={(e) => setInvPayMethod(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Reference Number
                  </label>
                  <input
                    type="text"
                    value={invPayRef}
                    onChange={(e) => setInvPayRef(e.target.value)}
                    placeholder="UTR / Cheque #"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Remarks</label>
                <textarea
                  rows={2}
                  value={invPayNotes}
                  onChange={(e) => setInvPayNotes(e.target.value)}
                  placeholder="Optional payment notes..."
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setInvoiceModal(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Entry B Modal: Customer-Based Multi-Invoice Allocation Payment */}
      {custModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSaveCustomerPayment(e)}
            className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Customer Payment &amp; Invoice Allocation
                </h3>
                <p className="text-xs text-slate-500">
                  Allocate a receipt across one or more open invoices for a customer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Search &amp; Select Customer
                  </label>
                  <input
                    type="text"
                    value={custSearch}
                    onChange={(e) => setCustSearch(e.target.value)}
                    placeholder="Filter customer name..."
                    className="w-full rounded-t border border-b-0 border-slate-300 px-2.5 py-1 text-xs"
                  />
                  <select
                    required
                    value={selectedCustId}
                    onChange={(e) => {
                      setSelectedCustId(e.target.value);
                      setAllocMap({});
                    }}
                    className="w-full rounded-b border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  >
                    {filteredCustomersForSelect.map((c) => (
                      <option key={c.customerId} value={c.customerId}>
                        {c.customerName} (Due: {formatInr(c.outstandingAmount)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Amount Received (₹)
                    </label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={selectedCustRec?.outstandingAmount || undefined}
                      value={custPayAmount}
                      onChange={(e) => setCustPayAmount(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Payment Date</label>
                    <input
                      required
                      type="date"
                      value={custPayDate}
                      onChange={(e) => setCustPayDate(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Method</label>
                    <select
                      value={custPayMethod}
                      onChange={(e) => setCustPayMethod(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Reference #</label>
                    <input
                      type="text"
                      value={custPayRef}
                      onChange={(e) => setCustPayRef(e.target.value)}
                      placeholder="UTR / Cheque #"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Open Invoices Allocation Table */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-slate-800">
                    Outstanding Invoices ({selectedCustOpenInvoices.length})
                  </span>
                  <button
                    type="button"
                    onClick={autoAllocateFifo}
                    className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
                  >
                    Auto-Allocate Oldest First
                  </button>
                </div>

                <div className="overflow-x-auto rounded border border-slate-200 max-h-52 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Invoice #</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Outstanding</th>
                        <th className="px-3 py-2 text-right">Allocate (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedCustOpenInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-3 py-2 font-mono font-medium text-blue-900">
                            {inv.invoiceNumber}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-600">
                            {inv.invoiceDate}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatInr(inv.totalAmount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-700">
                            {formatInr(inv.outstandingBalance)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={inv.outstandingBalance}
                              value={allocMap[inv.id] ?? ''}
                              onChange={(e) =>
                                setAllocMap((prev) => ({ ...prev, [inv.id]: e.target.value }))
                              }
                              placeholder="0.00"
                              className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 border border-slate-200 px-3 py-2">
                  <span>
                    Allocated: <strong>{formatInr(totalAllocated)}</strong>
                  </span>
                  <span
                    className={
                      remainingUnallocated < 0
                        ? 'text-rose-700 font-semibold'
                        : 'text-slate-700'
                    }
                  >
                    Remaining Unallocated: <strong>{formatInr(remainingUnallocated)}</strong>
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={custPayNotes}
                  onChange={(e) => setCustPayNotes(e.target.value)}
                  placeholder="Optional remarks..."
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setCustModalOpen(false)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || remainingUnallocated < 0 || totalAllocated <= 0}
                className="rounded bg-blue-950 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Customer Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Payment Details & Allocations Modal */}
      {detailPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl space-y-3 text-xs">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Payment {detailPayment.paymentNumber}
                </h3>
                <p className="text-slate-500">{detailPayment.customerName}</p>
              </div>
              <button type="button" onClick={() => setDetailPayment(null)}>
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-1">
              <p>
                <strong>Amount:</strong> {formatInr(detailPayment.amount)}
              </p>
              <p>
                <strong>Date:</strong> {detailPayment.paymentDate} · <strong>Mode:</strong>{' '}
                {detailPayment.paymentMode}
              </p>
              <p>
                <strong>Reference:</strong> {detailPayment.referenceNumber || '—'}
              </p>
              <p>
                <strong>Recorded By:</strong> {detailPayment.recordedBy}
              </p>
              {detailPayment.notes && (
                <p>
                  <strong>Notes:</strong> {detailPayment.notes}
                </p>
              )}
              {detailPayment.status === 'REVERSED' && (
                <p className="text-rose-700 font-medium">
                  Reversed by {detailPayment.reversedBy}: {detailPayment.reversalReason}
                </p>
              )}
            </div>
            {detailPayment.allocations && detailPayment.allocations.length > 0 && (
              <div>
                <p className="font-semibold text-slate-700 mb-1">Invoice Allocations:</p>
                <ul className="divide-y divide-slate-100 rounded border border-slate-200">
                  {detailPayment.allocations.map((a) => (
                    <li key={a.invoiceId} className="flex justify-between px-3 py-1.5">
                      <span className="font-mono text-blue-900">{a.invoiceNumber}</span>
                      <span className="font-semibold tabular-nums">{formatInr(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auditable Payment Reversal Modal */}
      {reverseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => void handleReversePayment(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Reverse Payment {reverseModal.paymentNumber}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Reversing {formatInr(reverseModal.amount)} preserves the payment record as REVERSED
                and restores outstanding balances on linked invoices.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reversal Reason *
              </label>
              <textarea
                rows={3}
                required
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="e.g., Cheque dishonoured / wrong reference..."
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReverseModal(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-rose-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
              >
                Confirm Reversal
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
