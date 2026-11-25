import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileText, Lock, Printer, Search, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { BillingWorkspaceData, Invoice } from '../../types/orderAudit';
import { Card } from '../ui/Card';
import { ToneBadge } from '../ui/Badge';

type BillingSubTab = 'invoices' | 'payments';

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const PAYMENT_STATUS_BADGE: Record<
  Invoice['paymentStatus'],
  { label: string; tone: 'danger' | 'warning' | 'success' }
> = {
  UNPAID: { label: 'Unpaid', tone: 'danger' },
  PARTIALLY_PAID: { label: 'Partially Paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
};

export function BillingPaymentsView() {
  const [subTab, setSubTab] = useState<BillingSubTab>('invoices');
  const [data, setData] = useState<BillingWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | Invoice['paymentStatus']>('ALL');
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.loadBillingWorkspace();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Billing & Payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const filteredInvoices = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.paymentStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        inv.orderNumber.toLowerCase().includes(q)
      );
    });
  }, [data, searchQuery, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('invoices')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              subTab === 'invoices'
                ? 'bg-blue-950 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Invoice Overview ({data?.invoices.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('payments')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              subTab === 'payments'
                ? 'bg-blue-950 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Payments &amp; Outstanding
          </button>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600">
          <Lock className="h-3 w-3 text-slate-400" />
          Invoice generation &amp; payment recording are restricted to the Accountant role
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading || !data ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading Billing &amp; Payments...
        </div>
      ) : (
        <>
          {data.dispatchesReadyForInvoicing.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              <strong>{data.dispatchesReadyForInvoicing.length}</strong> fulfilled dispatch
              {data.dispatchesReadyForInvoicing.length > 1 ? 'es' : ''} awaiting Accountant
              invoicing (
              {data.dispatchesReadyForInvoicing
                .map((d) => `${d.dispatchNumber} for ${d.orderNumber}`)
                .join(', ')}
              ).
            </div>
          )}

          {subTab === 'invoices' && (
            <Card
              title="Invoices (Dispatched Quantities Only)"
              subtitle="Intra-state Tamil Nadu supplies apply CGST + SGST; inter-state supplies apply IGST"
              noPadding
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search invoice #, customer, order..."
                      className="w-52 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                  <select
                    aria-label="Filter invoices by payment status"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as 'ALL' | Invoice['paymentStatus'])
                    }
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-800 focus:outline-none"
                  >
                    <option value="ALL">All Payment Statuses</option>
                    <option value="UNPAID">Unpaid</option>
                    <option value="PARTIALLY_PAID">Partially Paid</option>
                    <option value="PAID">Paid</option>
                  </select>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Invoice #</th>
                      <th className="px-4 py-2.5">Customer</th>
                      <th className="px-4 py-2.5">Order ID</th>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Supply / GST</th>
                      <th className="px-4 py-2.5 text-right">Taxable</th>
                      <th className="px-4 py-2.5 text-right">GST</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Document</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map((inv) => {
                      const badge = PAYMENT_STATUS_BADGE[inv.paymentStatus];
                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums whitespace-nowrap">
                            {inv.invoiceNumber}
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">
                            <p className="font-medium">{inv.customerName}</p>
                            <p className="text-[11px] text-slate-500">
                              {inv.placeOfSupplyState}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 text-slate-700 tabular-nums whitespace-nowrap">
                            {inv.orderNumber}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            {inv.invoiceDate}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                            {inv.supplyType === 'INTRA_STATE' ? 'CGST + SGST' : 'IGST'}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatInr(inv.taxableAmount)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                            {formatInr(inv.totalGstAmount)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                            {formatInr(inv.totalAmount)}
                          </td>
                          <td className="px-4 py-2.5">
                            <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setActiveInvoice(inv)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              View / PDF
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredInvoices.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                          No invoices found matching the filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {subTab === 'payments' && (
            <div className="space-y-5">
              <Card
                title="Customer Invoice Balances"
                subtitle="Tracks total invoiced, received payments, and outstanding receivables"
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Customer</th>
                        <th className="px-4 py-2.5">Invoice #</th>
                        <th className="px-4 py-2.5 text-right">Invoice Amount</th>
                        <th className="px-4 py-2.5 text-right">Amount Received</th>
                        <th className="px-4 py-2.5 text-right">Outstanding</th>
                        <th className="px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.invoices.map((inv) => {
                        const badge = PAYMENT_STATUS_BADGE[inv.paymentStatus];
                        return (
                          <tr key={inv.id}>
                            <td className="px-4 py-2.5 font-medium text-slate-800">
                              {inv.customerName}
                            </td>
                            <td className="px-4 py-2.5 text-blue-900 font-medium tabular-nums">
                              {inv.invoiceNumber}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {formatInr(inv.totalAmount)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                              {formatInr(inv.amountReceived)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                                inv.outstandingBalance > 0 ? 'text-rose-700' : 'text-slate-600'
                              }`}
                            >
                              {formatInr(inv.outstandingBalance)}
                            </td>
                            <td className="px-4 py-2.5">
                              <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card
                title="Payment History"
                subtitle="Receipts recorded by the Accountant"
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Payment #</th>
                        <th className="px-4 py-2.5">Date</th>
                        <th className="px-4 py-2.5">Customer</th>
                        <th className="px-4 py-2.5">Invoice #</th>
                        <th className="px-4 py-2.5">Mode / Reference</th>
                        <th className="px-4 py-2.5 text-right">Amount</th>
                        <th className="px-4 py-2.5">Recorded By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                            {p.paymentNumber}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-600">
                            {p.paymentDate}
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">{p.customerName}</td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-700">
                            {p.invoiceNumber}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {p.paymentMode}
                            {p.referenceNumber ? ` (${p.referenceNumber})` : ''}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                            {formatInr(p.amount)}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{p.recordedBy}</td>
                        </tr>
                      ))}
                      {data.payments.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                            No payments recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Printable Tax Invoice Document Modal */}
      {activeInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto">
            <div className="no-print flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Tax Invoice — {activeInvoice.invoiceNumber}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print / Save PDF
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
                    <strong>GSTIN:</strong> {activeInvoice.businessProfile.gstin} •{' '}
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
                  <p className="text-[11px] font-semibold uppercase text-slate-500">
                    Bill To
                  </p>
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
                    Ship To &amp; Place of Supply
                  </p>
                  <p className="text-slate-700 mt-0.5">{activeInvoice.deliveryAddress}</p>
                  <p className="mt-1">
                    <strong>Place of Supply:</strong> {activeInvoice.placeOfSupplyState} (
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
                      <td className="border border-slate-200 px-3 py-2 tabular-nums">
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
                <div className="text-slate-500 max-w-sm">
                  <p>
                    Generated on fulfilled dispatch quantity only ({activeInvoice.dispatchNumber}).
                  </p>
                  <p className="mt-1">Issued by: {activeInvoice.createdBy}</p>
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
                    <span>Received</span>
                    <span className="tabular-nums">
                      {formatInr(activeInvoice.amountReceived)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold text-rose-700">
                    <span>Balance Due</span>
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
    </div>
  );
}

