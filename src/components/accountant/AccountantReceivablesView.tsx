import { useMemo, useState } from 'react';
import { CreditCard, Download, Eye, Printer, Search, X } from 'lucide-react';
import type { CustomerReceivableSummary } from '../../types/orderAudit';
import { downloadCustomerStatementPdf } from '../../utils/pdfExport';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface AccountantReceivablesViewProps {
  receivables: CustomerReceivableSummary[];
  onCollectPaymentForCustomer: (customerId: string) => void;
}

type ReceivableFilter = 'ALL' | 'OUTSTANDING' | 'PARTIALLY_PAID' | 'OVERDUE';

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const STATUS_BADGE: Record<
  CustomerReceivableSummary['status'],
  { label: string; tone: 'success' | 'danger' | 'warning' | 'navy' }
> = {
  SETTLED: { label: 'Settled', tone: 'success' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  PARTIALLY_PAID: { label: 'Partially Paid', tone: 'warning' },
  OUTSTANDING: { label: 'Outstanding', tone: 'navy' },
};

export function AccountantReceivablesView({
  receivables,
  onCollectPaymentForCustomer,
}: AccountantReceivablesViewProps) {
  const [filter, setFilter] = useState<ReceivableFilter>('ALL');
  const [search, setSearch] = useState('');
  const [statementCustomer, setStatementCustomer] =
    useState<CustomerReceivableSummary | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return receivables.filter((r) => {
      if (filter === 'OUTSTANDING' && r.outstandingAmount <= 0) return false;
      if (filter === 'PARTIALLY_PAID' && r.status !== 'PARTIALLY_PAID') return false;
      if (filter === 'OVERDUE' && r.overdueAmount <= 0) return false;
      if (!q) return true;
      return (
        r.customerName.toLowerCase().includes(q) ||
        r.customerCode.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q)
      );
    });
  }, [receivables, filter, search]);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name, code, or state..."
            className="w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: 'All Customers' },
              { id: 'OUTSTANDING', label: 'Outstanding' },
              { id: 'PARTIALLY_PAID', label: 'Partially Paid' },
              { id: 'OVERDUE', label: 'Overdue' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                filter === f.id
                  ? 'bg-blue-950 text-white border-blue-950'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Receivables Table */}
      <Card
        title="Customer Receivables Ledger"
        subtitle="Automatically derived from issued invoices and payment allocations"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Customer Name</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total Invoiced</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total Paid</th>
                <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
                <th className="px-4 py-2.5 text-left font-semibold">Oldest Unpaid Invoice</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No customer receivables match the selected filter.
                  </td>
                </tr>
              ) : (
                filtered.map((rec) => {
                  const st = STATUS_BADGE[rec.status];
                  return (
                    <tr key={rec.customerId} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{rec.customerName}</p>
                        <p className="text-[11px] text-slate-500">
                          {rec.customerCode} · {rec.state}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatInr(rec.totalInvoiced)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                        {formatInr(rec.totalPaid)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                          rec.outstandingAmount > 0 ? 'text-rose-700' : 'text-slate-700'
                        }`}
                      >
                        {formatInr(rec.outstandingAmount)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 tabular-nums">
                        {rec.oldestUnpaidInvoiceNumber ? (
                          <span>
                            <span className="font-mono">{rec.oldestUnpaidInvoiceNumber}</span> (
                            {rec.oldestUnpaidInvoiceDate})
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => setStatementCustomer(rec)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-50 cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          Statement
                        </button>
                        {rec.outstandingAmount > 0 && (
                          <button
                            type="button"
                            onClick={() => onCollectPaymentForCustomer(rec.customerId)}
                            className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                          >
                            <CreditCard className="h-3 w-3" />
                            Collect
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

      {/* Customer Statement Modal */}
      {statementCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Customer Account Statement — {statementCustomer.customerName}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadCustomerStatementPdf(statementCustomer)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 rounded bg-blue-950 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-900 cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setStatementCustomer(null)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div id="printable-invoice-document" className="p-6 space-y-5 text-xs">
              <div className="flex flex-wrap justify-between gap-4 border-b border-slate-200 pb-3">
                <div>
                  <h4 className="text-base font-bold text-slate-900">
                    {statementCustomer.customerName} ({statementCustomer.customerCode})
                  </h4>
                  <p className="text-slate-600 mt-0.5">{statementCustomer.billingAddress}</p>
                  <p className="mt-0.5">
                    GSTIN: {statementCustomer.customerGstin || 'Unregistered'} · State:{' '}
                    {statementCustomer.state}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p>
                    Total Invoiced: <strong>{formatInr(statementCustomer.totalInvoiced)}</strong>
                  </p>
                  <p className="text-emerald-700">
                    Total Paid: <strong>{formatInr(statementCustomer.totalPaid)}</strong>
                  </p>
                  <p className="text-rose-700 font-semibold text-sm">
                    Balance Due: {formatInr(statementCustomer.outstandingAmount)}
                  </p>
                </div>
              </div>

              <div>
                <p className="font-semibold text-slate-800 mb-1.5">Invoices</p>
                <table className="w-full border-collapse border border-slate-200 text-left">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="border border-slate-200 px-2.5 py-1.5">Invoice #</th>
                      <th className="border border-slate-200 px-2.5 py-1.5">Date</th>
                      <th className="border border-slate-200 px-2.5 py-1.5 text-right">Amount</th>
                      <th className="border border-slate-200 px-2.5 py-1.5 text-right">Paid</th>
                      <th className="border border-slate-200 px-2.5 py-1.5 text-right">Balance</th>
                      <th className="border border-slate-200 px-2.5 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementCustomer.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-mono">
                          {inv.invoiceNumber}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 tabular-nums">
                          {inv.invoiceDate}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 text-right tabular-nums">
                          {formatInr(inv.totalAmount)}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 text-right tabular-nums">
                          {formatInr(inv.amountReceived)}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 text-right tabular-nums font-semibold">
                          {formatInr(inv.outstandingBalance)}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5">
                          {inv.paymentStatus}
                        </td>
                      </tr>
                    ))}
                    {statementCustomer.invoices.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                          No invoices recorded for this customer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="font-semibold text-slate-800 mb-1.5">
                  Payment &amp; Allocation History
                </p>
                <table className="w-full border-collapse border border-slate-200 text-left">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="border border-slate-200 px-2.5 py-1.5">Payment #</th>
                      <th className="border border-slate-200 px-2.5 py-1.5">Date</th>
                      <th className="border border-slate-200 px-2.5 py-1.5">Method</th>
                      <th className="border border-slate-200 px-2.5 py-1.5">Allocated Invoices</th>
                      <th className="border border-slate-200 px-2.5 py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementCustomer.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-mono">
                          {p.paymentNumber}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 tabular-nums">
                          {p.paymentDate}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5">
                          {p.paymentMode}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-mono">
                          {p.invoiceNumber || '—'}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 text-right tabular-nums font-semibold">
                          {formatInr(p.amount)}
                        </td>
                      </tr>
                    ))}
                    {statementCustomer.payments.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                          No payments recorded for this customer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
