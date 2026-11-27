import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { OwnerBusinessOverviewData } from '../../types/orderAudit';
import { Card } from '../ui/Card';
import {
  ComparisonBarChart,
  SimpleTrendChart,
  formatCompactInr,
  formatInr,
} from './OwnerCharts';

export function OwnerBusinessOverviewView() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<OwnerBusinessOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.loadOwnerBusinessOverview({
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Business Overview.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const sp = data?.salesPerformance;
  const pp = data?.productionPerformance;

  return (
    <div className="space-y-5">
      {/* Date Range Filter */}
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
            Loading Sales &amp; Production performance metrics...
          </div>
        </Card>
      ) : (
        sp &&
        pp && (
          <>
            {/* Sales Performance */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Sales Performance</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Orders Received</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                    {sp.totalOrdersReceived}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Approved</p>
                  <p className="mt-1 text-lg font-bold text-blue-900 tabular-nums">
                    {sp.approvedOrders}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Dispatched</p>
                  <p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
                    {sp.dispatchedOrders}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Rejected / Cancelled</p>
                  <p className="mt-1 text-lg font-bold text-rose-700 tabular-nums">
                    {sp.cancelledOrders}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5 col-span-2 sm:col-span-1">
                  <p className="text-[11px] font-medium text-slate-500">Total Sales Value</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                    {formatInr(sp.totalSalesValue)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card
                  title="Monthly Sales Trend"
                  subtitle={`Current (${sp.currentMonth}): ${formatInr(
                    sp.currentMonthSales
                  )} · Previous (${sp.previousMonth}): ${formatInr(sp.previousMonthSales)}`}
                >
                  <SimpleTrendChart
                    seriesName="Monthly Sales"
                    points={sp.monthlyTrend.map((m) => ({
                      label: m.month,
                      value: m.salesValue,
                      meta: `${m.orderCount} orders`,
                    }))}
                    valueFormatter={(v) => formatCompactInr(v)}
                  />
                </Card>

                <Card title="Order Status Distribution" noPadding>
                  {sp.statusDistribution.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      No orders in selected date range.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium text-right">Orders</th>
                            <th className="px-4 py-2 font-medium text-right">Order Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sp.statusDistribution.map((s) => (
                            <tr key={s.status}>
                              <td className="px-4 py-2 font-medium text-slate-800">{s.status}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {s.count}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">
                                {formatInr(s.value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>

            {/* Production Performance */}
            <div className="space-y-3 pt-2">
              <h2 className="text-sm font-semibold text-slate-900">Production Performance</h2>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Total Requests</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                    {pp.totalRequests}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Completed</p>
                  <p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
                    {pp.completedRequests}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Pending</p>
                  <p className="mt-1 text-lg font-bold text-amber-700 tabular-nums">
                    {pp.pendingRequests}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Planned Qty</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                    {pp.totalPlannedQuantity.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Good Output</p>
                  <p className="mt-1 text-lg font-bold text-blue-900 tabular-nums">
                    {pp.actualGoodOutput.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Rejected Output</p>
                  <p className="mt-1 text-lg font-bold text-rose-700 tabular-nums">
                    {pp.rejectedOutput.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Planned vs Actual Good Output (by Product)">
                  <ComparisonBarChart
                    items={pp.plannedVsActualByProduct.map((p) => ({
                      label: p.productName,
                      primaryValue: p.plannedQuantity,
                      secondaryValue: p.actualGoodOutput,
                    }))}
                    primaryName="Planned Qty"
                    secondaryName="Actual Good Output"
                    primaryColor="#1e3a8a"
                    secondaryColor="#059669"
                  />
                </Card>

                <Card title="Production Completion Trend">
                  <ComparisonBarChart
                    items={pp.completionTrend.map((c) => ({
                      label: c.month,
                      primaryValue: c.plannedQuantity,
                      secondaryValue: c.actualGoodOutput,
                    }))}
                    primaryName="Planned Qty"
                    secondaryName="Good Output"
                    primaryColor="#475569"
                    secondaryColor="#2563eb"
                  />
                </Card>
              </div>

              <Card
                title="Material Consumption vs Wastage Comparison"
                subtitle="Planned BOM consumption compared against actual usage, wastage, and variance"
                noPadding
              >
                {pp.materialConsumption.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No completed production runs with material consumption records in this range.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Material</th>
                          <th className="px-4 py-2.5 font-medium">Unit</th>
                          <th className="px-4 py-2.5 font-medium text-right">Planned</th>
                          <th className="px-4 py-2.5 font-medium text-right">Actual Consumed</th>
                          <th className="px-4 py-2.5 font-medium text-right">Wastage</th>
                          <th className="px-4 py-2.5 font-medium text-right">Variance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pp.materialConsumption.map((m) => (
                          <tr key={m.materialId}>
                            <td className="px-4 py-2.5 font-medium text-slate-900">
                              {m.materialName}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">{m.unit}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                              {m.plannedQuantity.toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                              {m.actualConsumedQuantity.toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                              {m.wastageQuantity.toLocaleString('en-IN')}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                                m.varianceQuantity > 0
                                  ? 'text-rose-700'
                                  : m.varianceQuantity < 0
                                    ? 'text-emerald-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              {m.varianceQuantity > 0 ? '+' : ''}
                              {m.varianceQuantity.toLocaleString('en-IN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          </>
        )
      )}
    </div>
  );
}
