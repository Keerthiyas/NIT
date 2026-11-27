import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { OwnerFinancialOverviewData } from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { ComparisonBarChart, formatCompactInr, formatInr } from './OwnerCharts';

export function OwnerFinancialOverviewView() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<OwnerFinancialOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.loadOwnerFinancialOverview({
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Financial Overview.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="space-y-5">
      {/* Date Filter */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
              />
            </div>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className="rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Clear Range
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </Card>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <Card>
          <div className="py-8 text-center text-xs text-slate-500">
            Loading read-only financial overview...
          </div>
        </Card>
      ) : (
        data && (
          <>
            {/* 4 Financial KPIs (exact billed, collected, outstanding, verified GRN expenditure) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">Total Invoiced Amount</p>
                <p className="mt-1.5 text-xl font-bold text-slate-900 tabular-nums">
                  {formatInr(data.totalInvoicedAmount)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Active GST invoices (incl. tax)</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">Total Amount Collected</p>
                <p className="mt-1.5 text-xl font-bold text-emerald-700 tabular-nums">
                  {formatInr(data.totalAmountCollected)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Posted customer payments</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">Outstanding Amount</p>
                <p className="mt-1.5 text-xl font-bold text-rose-700 tabular-nums">
                  {formatInr(data.outstandingAmount)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Pending receivable balance</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">Purchase Expenditure</p>
                <p className="mt-1.5 text-xl font-bold text-blue-900 tabular-nums">
                  {formatInr(data.purchaseExpenditure)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Verified GRN purchase receipts</p>
              </div>
            </div>

            {/* Revenue vs Collections Chart + Purchase Expenditure Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card
                title="Revenue vs Collections"
                subtitle="Monthly invoiced total vs customer cash collected"
              >
                <ComparisonBarChart
                  items={data.revenueVsCollections.map((r) => ({
                    label: r.month,
                    primaryValue: r.invoicedAmount,
                    secondaryValue: r.collectedAmount,
                  }))}
                  primaryName="Invoiced"
                  secondaryName="Collected"
                  primaryColor="#1e3a8a"
                  secondaryColor="#059669"
                  valueFormatter={(v) => formatCompactInr(v)}
                />
              </Card>

              <Card
                title="Purchase Expenditure Breakdown"
                subtitle="By month and inventory material category"
              >
                <div className="space-y-4">
                  <ComparisonBarChart
                    items={data.purchaseExpenditureByMonth.map((m) => ({
                      label: m.month,
                      primaryValue: m.amount,
                    }))}
                    primaryName="GRN Expenditure"
                    primaryColor="#334155"
                    valueFormatter={(v) => formatCompactInr(v)}
                    emptyText="No GRN purchase receipts recorded in this range."
                  />
                  {data.purchaseExpenditureByCategory.length > 0 && (
                    <div className="border-t border-slate-100 pt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {data.purchaseExpenditureByCategory.map((c) => (
                        <div
                          key={c.category}
                          className="rounded border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          <p className="text-[11px] text-slate-500">{c.category}</p>
                          <p className="text-xs font-semibold text-slate-900 tabular-nums mt-0.5">
                            {formatInr(c.amount)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Customer-wise Pending & Overdue Receivables (Read-Only) */}
            <Card
              title="Customer Outstanding Receivables"
              subtitle="Read-only receivable ageing & collection status across customers"
              noPadding
            >
              {data.customerOutstanding.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No invoiced receivables found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Code</th>
                        <th className="px-4 py-2.5 font-medium">Customer</th>
                        <th className="px-4 py-2.5 font-medium text-right">Total Invoiced</th>
                        <th className="px-4 py-2.5 font-medium text-right">Paid</th>
                        <th className="px-4 py-2.5 font-medium text-right">Pending</th>
                        <th className="px-4 py-2.5 font-medium text-right">Overdue</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.customerOutstanding.map((c) => (
                        <tr key={c.customerId} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">
                            {c.customerCode}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-slate-900">
                            {c.customerName}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                            {formatInr(c.totalInvoiced)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                            {formatInr(c.totalPaid)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                            {formatInr(c.pendingAmount)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-rose-700">
                            {formatInr(c.overdueAmount)}
                          </td>
                          <td className="px-4 py-2.5">
                            <ToneBadge
                              tone={
                                c.status === 'SETTLED'
                                  ? 'green'
                                  : c.status === 'OVERDUE'
                                    ? 'red'
                                    : c.status === 'PARTIALLY_PAID'
                                      ? 'blue'
                                      : 'amber'
                              }
                            >
                              {c.status}
                            </ToneBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )
      )}
    </div>
  );
}
