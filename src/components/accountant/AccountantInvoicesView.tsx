import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CreditCard,
  Download,
  FilePlus2,
  FileText,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  DispatchInvoicePreview,
  DispatchRecord,
  Invoice,
} from '../../types/orderAudit';
import { downloadInvoicePdf } from '../../utils/pdfExport';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface AccountantInvoicesViewProps {
  dispatchesReady: DispatchRecord[];
  invoices: Invoice[];
  initialFilterPending?: boolean;
  initialPreviewDispatch?: DispatchRecord | null;
  onClearInitialDispatch?: () => void;
  onRecordPaymentForInvoice: (invoice: Invoice) => void;
  onRefresh: () => Promise<void>;
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const STATUS_STYLE: Record<
  Invoice['paymentStatus'],
  { label: string; tone: 'danger' | 'warning' | 'success' | 'neutral' }
> = {
  UNPAID: { label: 'Unpaid', tone: 'danger' },
  PARTIALLY_PAID: { label: 'Partially Paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export function AccountantInvoicesView({
  dispatchesReady,
  invoices,
  initialFilterPending = false,
  initialPreviewDispatch = null,
  onClearInitialDispatch,
  onRecordPaymentForInvoice,
  onRefresh,
}: AccountantInvoicesViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | Invoice['paymentStatus']>('ALL');
  const [customerFilter, setCustomerFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showPendingOnly, setShowPendingOnly] = useState(initialFilterPending);

  // Invoice Preview / Generation Modal
  const [previewDispatch, setPreviewDispatch] = useState<DispatchRecord | null>(null);
  const [previewData, setPreviewData] = useState<DispatchInvoicePreview | null>(null);
  const [invoiceQtyInput, setInvoiceQtyInput] = useState<string>('');
  const [dueDateInput, setDueDateInput] = useState<string>('');
  const [invoiceNotesInput, setInvoiceNotesInput] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // View Issued Invoice Modal & Cancel Modal
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [cancelModalInv, setCancelModalInv] = useState<Invoice | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setShowPendingOnly(initialFilterPending);
  }, [initialFilterPending]);

  const openDispatchPreview = async (dispatch: DispatchRecord, customQty?: number) => {
    setPreviewDispatch(dispatch);
    setPreviewLoading(true);
    setFeedback(null);
    if (customQty === undefined) {
      const rem = dispatch.remainingQuantity ?? dispatch.dispatchedQuantity;
      setInvoiceQtyInput(String(rem));
      const d = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setDueDateInput(d);
      setInvoiceNotesInput('');
    }
    try {
      const prev = await orderAuditService.previewDispatchInvoice(dispatch.id, {
        quantity: customQty,
      });
      setPreviewData(prev);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to compute GST invoice preview.',
      });
      setPreviewDispatch(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (initialPreviewDispatch) {
      void openDispatchPreview(initialPreviewDispatch);
      onClearInitialDispatch?.();
    }
  }, [initialPreviewDispatch]);

  const customersList = useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of invoices) {
      map.set(inv.customerId, inv.customerName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.paymentStatus !== statusFilter) return false;
      if (customerFilter !== 'ALL' && inv.customerId !== customerFilter) return false;
      if (fromDate && inv.invoiceDate < fromDate) return false;
      if (toDate && inv.invoiceDate > toDate) return false;
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        inv.orderNumber.toLowerCase().includes(q) ||
        inv.dispatchNumber.toLowerCase().includes(q)
      );
    });
  }, [invoices, search, statusFilter, customerFilter, fromDate, toDate]);

  const handleConfirmGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewDispatch || !previewData) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const qtyNum = Number(invoiceQtyInput);
      const res = await orderAuditService.createInvoice({
        dispatchId: previewDispatch.id,
        quantity: qtyNum,
        dueDate: dueDateInput || undefined,
        notes: invoiceNotesInput || undefined,
        idempotencyKey: `inv-${previewDispatch.id}-${qtyNum}-${Date.now()}`,
      });
      setPreviewDispatch(null);
      setPreviewData(null);
      setShowPendingOnly(false);
      setFeedback({
        type: 'ok',
        text: `GST Invoice ${res.invoiceNumber} generated against ${previewDispatch.dispatchNumber}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to generate invoice.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalInv) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.cancelInvoice(cancelModalInv.id, cancelReason);
      setCancelModalInv(null);
      setCancelReason('');
      setActiveInvoice(null);
      setFeedback({
        type: 'ok',
        text: `Invoice ${res.invoiceNumber} cancelled. Dispatch quantity is now available for re-invoicing.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to cancel invoice.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-xs font-medium no-print ${
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

      {/* Dispatches Eligible for GST Invoicing */}
      <Card
        title={`Dispatches Eligible for Invoicing (${dispatchesReady.length})`}
        subtitle="Invoices can only be generated from actual dispatched quantities"
        action={
          dispatchesReady.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPendingOnly((v) => !v)}
              className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
            >
              {showPendingOnly ? 'Show All Invoices Below' : 'Focus Pending Dispatches'}
            </button>
          )
        }
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Dispatch #</th>
                <th className="px-4 py-2 text-left font-semibold">Order #</th>
                <th className="px-4 py-2 text-left font-semibold">Customer (State)</th>
                <th className="px-4 py-2 text-left font-semibold">Product</th>
                <th className="px-4 py-2 text-right font-semibold">Dispatched</th>
                <th className="px-4 py-2 text-right font-semibold">Uninvoiced</th>
                <th className="px-4 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {dispatchesReady.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-5 text-center text-slate-500">
                    All dispatched quantities have been invoiced.
                  </td>
                </tr>
              ) : (
                dispatchesReady.map((d) => {
                  const uninvoiced = d.remainingQuantity ?? d.dispatchedQuantity - d.invoicedQuantity;
                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-blue-900">
                        {d.dispatchNumber}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">{d.orderNumber}</td>
                      <td className="px-4 py-2.5 text-slate-800">
                        {d.customerName} <span className="text-slate-500">({d.customerState})</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">{d.productName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {d.dispatchedQuantity} {d.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-800">
                        {uninvoiced} {d.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void openDispatchPreview(d)}
                          className="inline-flex items-center gap-1 rounded bg-blue-950 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-900 cursor-pointer"
                        >
                          <FilePlus2 className="h-3.5 w-3.5" />
                          Preview &amp; Invoice
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Issued Invoices List */}
      {!showPendingOnly && (
        <Card
          title="GST Invoices"
          subtitle="Immutable issued tax invoices; corrections require auditable cancellation"
          noPadding
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Invoice #, order #, customer..."
                  className="w-44 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs"
                />
              </div>
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                <option value="ALL">All Customers</option>
                {customersList.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'ALL' | Invoice['paymentStatus'])
                }
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="UNPAID">Unpaid</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
                <option value="PAID">Paid</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Invoice #</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Customer</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Order / Dispatch</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Invoice Amt</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Paid Amt</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      No invoices match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const st = STATUS_STYLE[inv.paymentStatus];
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono font-semibold text-blue-900">
                          {inv.invoiceNumber}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-900">{inv.customerName}</p>
                          <p className="text-[11px] text-slate-500">
                            {inv.placeOfSupplyState} ·{' '}
                            {inv.supplyType === 'INTRA_STATE' ? 'CGST+SGST' : 'IGST'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">
                          <p>{inv.orderNumber}</p>
                          <p className="text-[11px] text-slate-400">{inv.dispatchNumber}</p>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-600">
                          {inv.invoiceDate}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                          {formatInr(inv.totalAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                          {formatInr(inv.amountReceived)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-rose-700">
                          {formatInr(inv.outstandingBalance)}
                        </td>
                        <td className="px-4 py-2.5">
                          <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1">
                          <button
                            type="button"
                            onClick={() => setActiveInvoice(inv)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-50 cursor-pointer"
                          >
                            <FileText className="h-3 w-3" />
                            View / PDF
                          </button>
                          {inv.outstandingBalance > 0 && inv.paymentStatus !== 'CANCELLED' && (
                            <button
                              type="button"
                              onClick={() => onRecordPaymentForInvoice(inv)}
                              className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                            >
                              <CreditCard className="h-3 w-3" />
                              Pay
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal: Preview & Generate GST Invoice */}
      {previewDispatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleConfirmGenerate(e)}
            className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  GST Invoice Preview — {previewDispatch.dispatchNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Order {previewDispatch.orderNumber} · Dispatched on{' '}
                  {previewDispatch.dispatchedAt.slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreviewDispatch(null);
                  setPreviewData(null);
                }}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {previewLoading || !previewData ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Calculating GST breakdown from dispatched quantities...
              </div>
            ) : (
              <div className="p-5 space-y-4 text-xs">
                {/* Business & Customer Header */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-500">
                      Supplier Details
                    </p>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {previewData.businessProfile.name}
                    </p>
                    <p className="text-slate-600 mt-0.5">{previewData.businessProfile.address}</p>
                    <p className="mt-1">
                      <strong>GSTIN:</strong> {previewData.businessProfile.gstin} ·{' '}
                      <strong>State:</strong> {previewData.businessProfile.state}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-500">
                      Customer &amp; Place of Supply
                    </p>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {previewData.customerName} ({previewData.customerCode})
                    </p>
                    <p className="text-slate-600 mt-0.5">{previewData.billingAddress}</p>
                    <p className="mt-1">
                      <strong>GSTIN:</strong> {previewData.customerGstin || 'Unregistered'} ·{' '}
                      <strong>Supply:</strong> {previewData.placeOfSupplyState} (
                      {previewData.supplyType === 'INTRA_STATE' ? 'CGST + SGST' : 'IGST'})
                    </p>
                  </div>
                </div>

                {/* Partial/Full Dispatch Qty & Due Date Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Invoice Quantity (Max: {previewData.uninvoicedQuantity})
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        step="0.001"
                        min="0.001"
                        max={previewData.uninvoicedQuantity}
                        value={invoiceQtyInput}
                        onChange={(e) => setInvoiceQtyInput(e.target.value)}
                        onBlur={() => {
                          const q = Number(invoiceQtyInput);
                          if (q > 0 && q <= previewData.uninvoicedQuantity) {
                            void openDispatchPreview(previewDispatch, q);
                          }
                        }}
                        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={dueDateInput}
                      onChange={(e) => setDueDateInput(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Notes</label>
                    <input
                      type="text"
                      value={invoiceNotesInput}
                      onChange={(e) => setInvoiceNotesInput(e.target.value)}
                      placeholder="Optional invoice notes..."
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                  </div>
                </div>

                {/* Items Table */}
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Product &amp; SKU</th>
                        <th className="px-3 py-2">HSN</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Taxable</th>
                        <th className="px-3 py-2 text-right">GST %</th>
                        <th className="px-3 py-2 text-right">Tax</th>
                        <th className="px-3 py-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.lines.map((ln) => (
                        <tr key={ln.productId}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-900">{ln.productName}</p>
                            <p className="text-[11px] text-slate-500">{ln.sku}</p>
                          </td>
                          <td className="px-3 py-2 font-mono">{ln.hsnCode}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {ln.quantity} {ln.unit}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatInr(ln.unitPrice)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatInr(ln.taxableAmount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{ln.gstRate}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatInr(ln.taxAmount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {formatInr(ln.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-72 rounded border border-slate-200 bg-slate-50 p-3 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Taxable Subtotal</span>
                      <span className="font-medium tabular-nums">
                        {formatInr(previewData.taxableAmount)}
                      </span>
                    </div>
                    {previewData.supplyType === 'INTRA_STATE' ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-600">CGST</span>
                          <span className="tabular-nums">{formatInr(previewData.cgstAmount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">SGST</span>
                          <span className="tabular-nums">{formatInr(previewData.sgstAmount)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-slate-600">IGST</span>
                        <span className="tabular-nums">{formatInr(previewData.igstAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900">
                      <span>Grand Total</span>
                      <span className="tabular-nums">{formatInr(previewData.totalAmount)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setPreviewDispatch(null);
                  setPreviewData(null);
                }}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || previewLoading || !previewData}
                className="rounded bg-blue-950 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'Issuing Invoice...' : 'Issue GST Invoice'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Issued Invoice Detail / PDF / Print Modal */}
      {activeInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Tax Invoice — {activeInvoice.invoiceNumber}
                </h3>
                <ToneBadge tone={STATUS_STYLE[activeInvoice.paymentStatus].tone}>
                  {STATUS_STYLE[activeInvoice.paymentStatus].label}
                </ToneBadge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeInvoice.outstandingBalance > 0 &&
                  activeInvoice.paymentStatus !== 'CANCELLED' && (
                    <button
                      type="button"
                      onClick={() => {
                        const inv = activeInvoice;
                        setActiveInvoice(null);
                        onRecordPaymentForInvoice(inv);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      Record Payment
                    </button>
                  )}
                {activeInvoice.amountReceived === 0 &&
                  activeInvoice.paymentStatus !== 'CANCELLED' && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelModalInv(activeInvoice);
                        setCancelReason('');
                      }}
                      className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 cursor-pointer"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Cancel Invoice
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => downloadInvoicePdf(activeInvoice)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setActiveInvoice(null)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div id="printable-invoice-document" className="p-6 space-y-5 text-xs text-slate-800">
              <div className="flex flex-wrap justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-900">
                    Tax Invoice
                  </p>
                  <h4 className="text-base font-bold text-slate-900 mt-0.5">
                    {activeInvoice.businessProfile.name}
                  </h4>
                  <p className="text-slate-600 mt-1 max-w-sm">
                    {activeInvoice.businessProfile.address}
                  </p>
                  <p className="mt-1">
                    <strong>GSTIN:</strong> {activeInvoice.businessProfile.gstin} ·{' '}
                    <strong>State:</strong> {activeInvoice.businessProfile.state} (
                    {activeInvoice.businessProfile.stateCode})
                  </p>
                </div>

                <div className="text-right space-y-1">
                  <p>
                    <span className="text-slate-500">Invoice #: </span>
                    <strong className="text-sm text-slate-900">
                      {activeInvoice.invoiceNumber}
                    </strong>
                  </p>
                  <p>
                    <span className="text-slate-500">Invoice Date: </span>
                    <strong>{activeInvoice.invoiceDate}</strong>
                  </p>
                  <p>
                    <span className="text-slate-500">Order #: </span>
                    <strong>{activeInvoice.orderNumber}</strong>
                  </p>
                  <p>
                    <span className="text-slate-500">Dispatch #: </span>
                    <strong>{activeInvoice.dispatchNumber}</strong>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded border border-slate-200 bg-slate-50/70 p-3.5">
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-500">Bill To</p>
                  <p className="font-semibold text-slate-900 mt-0.5">
                    {activeInvoice.customerName} ({activeInvoice.customerCode})
                  </p>
                  <p className="text-slate-600 mt-0.5">{activeInvoice.billingAddress}</p>
                  <p className="mt-1">
                    <strong>GSTIN:</strong>{' '}
                    {activeInvoice.customerGstin || 'Unregistered / Consumer'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-500">
                    Place of Supply
                  </p>
                  <p className="text-slate-700 mt-0.5">{activeInvoice.deliveryAddress}</p>
                  <p className="mt-1">
                    <strong>State:</strong> {activeInvoice.placeOfSupplyState} (
                    {activeInvoice.customerStateCode}) —{' '}
                    <strong>
                      {activeInvoice.supplyType === 'INTRA_STATE'
                        ? 'Intra-State (CGST + SGST)'
                        : 'Inter-State (IGST)'}
                    </strong>
                  </p>
                </div>
              </div>

              <table className="w-full border-collapse border border-slate-200 text-left">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="border border-slate-200 px-3 py-2">Product</th>
                    <th className="border border-slate-200 px-3 py-2">HSN</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Qty</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Rate</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Taxable</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">GST %</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Tax</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {activeInvoice.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="border border-slate-200 px-3 py-2">
                        <p className="font-medium text-slate-900">{line.productName}</p>
                        <p className="text-[11px] text-slate-500">{line.sku}</p>
                      </td>
                      <td className="border border-slate-200 px-3 py-2 font-mono">
                        {line.hsnCode}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">
                        {line.quantity} {line.unit}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">
                        {formatInr(line.unitPrice)}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">
                        {formatInr(line.taxableAmount)}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">
                        {line.gstRate}%
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">
                        {formatInr(line.cgstAmount + line.sgstAmount + line.igstAmount)}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums font-semibold">
                        {formatInr(line.totalAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex flex-wrap justify-between gap-4 pt-2">
                <div className="text-slate-500 max-w-sm space-y-1">
                  <p>Generated against dispatch {activeInvoice.dispatchNumber}.</p>
                  <p>Issued by: {activeInvoice.createdBy}</p>
                  {activeInvoice.paymentStatus === 'CANCELLED' && (
                    <p className="text-rose-700 font-medium">
                      Cancelled by {activeInvoice.cancelledBy}: {activeInvoice.cancellationReason}
                    </p>
                  )}
                </div>
                <div className="w-64 space-y-1.5 rounded border border-slate-200 p-3">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Taxable Amount</span>
                    <span className="tabular-nums font-medium">
                      {formatInr(activeInvoice.taxableAmount)}
                    </span>
                  </div>
                  {activeInvoice.supplyType === 'INTRA_STATE' ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-500">CGST</span>
                        <span className="tabular-nums">
                          {formatInr(activeInvoice.cgstAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">SGST</span>
                        <span className="tabular-nums">
                          {formatInr(activeInvoice.sgstAmount)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-slate-500">IGST</span>
                      <span className="tabular-nums">
                        {formatInr(activeInvoice.igstAmount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900">
                    <span>Grand Total</span>
                    <span className="tabular-nums">{formatInr(activeInvoice.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700">
                    <span>Paid</span>
                    <span className="tabular-nums">
                      {formatInr(activeInvoice.amountReceived)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold text-rose-700">
                    <span>Outstanding</span>
                    <span className="tabular-nums">
                      {formatInr(activeInvoice.outstandingBalance)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Invoice Confirmation Modal */}
      {cancelModalInv && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => void handleCancelInvoice(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Cancel Invoice {cancelModalInv.invoiceNumber}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Cancelling preserves the audit record and frees {cancelModalInv.dispatchNumber} for
                corrected invoicing.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cancellation Reason *
              </label>
              <textarea
                rows={3}
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="State reason for invoice cancellation..."
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelModalInv(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Keep Invoice
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-rose-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
              >
                Confirm Cancellation
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
