import { Clock, CreditCard, FileText, IndianRupee } from 'lucide-react';
import type { AccountantDashboardData, DispatchRecord } from '../../types/orderAudit';

interface AccountantDashboardViewProps {
  data: AccountantDashboardData;
  onOpenPendingInvoices: () => void;
  onOpenInvoices: () => void;
  onOpenPayments: () => void;
  onOpenReceivables: () => void;
  onGenerateFromDispatch: (dispatch: DispatchRecord) => void;
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function AccountantDashboardView({
  data,
  onOpenPendingInvoices,
  onOpenInvoices,
  onOpenPayments,
  onOpenReceivables,
  onGenerateFromDispatch,
}: AccountantDashboardViewProps) {
  return (
    <div className="space-y-4">
      {/* 4 Compact Clickable Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={onOpenPendingInvoices}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-amber-400 hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <div>
            <p className="text-xs font-medium text-slate-500">Pending Invoices</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {data.pendingInvoicesCount}
            </p>
          </div>
          <div className="rounded-md bg-amber-50 p-2 text-amber-700 group-hover:bg-amber-100">
            <Clock className="h-4 w-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenInvoices}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-blue-400 hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <div>
            <p className="text-xs font-medium text-slate-500">Total Invoiced</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
              {formatInr(data.totalInvoicedAmount)}
            </p>
          </div>
          <div className="rounded-md bg-blue-50 p-2 text-blue-800 group-hover:bg-blue-100">
            <FileText className="h-4 w-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenPayments}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-emerald-400 hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <div>
            <p className="text-xs font-medium text-slate-500">Amount Collected</p>
            <p className="mt-1 text-xl font-semibold text-emerald-700 tabular-nums">
              {formatInr(data.amountCollected)}
            </p>
          </div>
          <div className="rounded-md bg-emerald-50 p-2 text-emerald-700 group-hover:bg-emerald-100">
            <CreditCard className="h-4 w-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenReceivables}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-rose-400 hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <div>
            <p className="text-xs font-medium text-slate-500">Outstanding Amount</p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                data.outstandingAmount > 0 ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {formatInr(data.outstandingAmount)}
            </p>
          </div>
          <div className="rounded-md bg-rose-50 p-2 text-rose-700 group-hover:bg-rose-100">
            <IndianRupee className="h-4 w-4" />
          </div>
        </button>
      </div>

      {/* Pending Invoices & Recent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Pending Invoices</h2>
            <button
              type="button"
              onClick={onOpenPendingInvoices}
              className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>

          {data.pendingDispatches.length === 0 ? (
            <p className="px-4 py-5 text-center text-xs text-slate-500">
              No dispatched orders awaiting GST invoicing.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Customer</th>
                    <th className="px-4 py-2 text-left font-medium">Order / Dispatch</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.pendingDispatches.slice(0, 5).map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {d.customerName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 tabular-nums">
                        <span className="font-mono text-slate-800">{d.orderNumber}</span>
                        {' · '}
                        <span className="font-mono">{d.dispatchNumber}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">
                        {d.remainingQuantity ?? d.dispatchedQuantity} {d.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onGenerateFromDispatch(d)}
                          className="rounded bg-blue-950 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-900 cursor-pointer"
                        >
                          Generate Invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Recent Payments</h2>
            <button
              type="button"
              onClick={onOpenPayments}
              className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
            >
              View Payments
            </button>
          </div>

          {data.recentPayments.length === 0 ? (
            <p className="px-4 py-5 text-center text-xs text-slate-500">
              No customer payments recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentPayments.slice(0, 5).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{p.customerName}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {p.paymentDate} · {p.paymentMode}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold text-emerald-700 tabular-nums">
                    {formatInr(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
