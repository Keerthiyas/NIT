import { ArrowRight } from 'lucide-react';
import type { OwnerDashboardData } from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import {
  ComparisonBarChart,
  SimpleTrendChart,
  formatCompactInr,
  formatInr,
} from './OwnerCharts';

interface OwnerDashboardViewProps {
  data: OwnerDashboardData;
  onNavigateBusiness: () => void;
  onNavigateFinancial: () => void;
  onNavigateApprovals: (poId?: string) => void;
}

export function OwnerDashboardView({
  data,
  onNavigateBusiness,
  onNavigateFinancial,
  onNavigateApprovals,
}: OwnerDashboardViewProps) {
  const cards = [
    {
      label: 'Total Sales',
      value: formatInr(data.totalSalesAmount),
      sub: `${data.salesTrend.currentMonth}: ${formatInr(data.salesTrend.currentMonthSales)}`,
      onClick: onNavigateBusiness,
      accent: 'text-slate-900',
    },
    {
      label: 'Total Orders',
      value: String(data.totalOrdersCount),
      sub: 'Non-cancelled & active orders',
      onClick: onNavigateBusiness,
      accent: 'text-slate-900',
    },
    {
      label: 'Pending Orders',
      value: String(data.pendingOrdersCount),
      sub: 'Awaiting fulfillment or dispatch',
      onClick: onNavigateBusiness,
      accent: data.pendingOrdersCount > 0 ? 'text-amber-700' : 'text-slate-900',
    },
    {
      label: 'Production In Progress',
      value: String(data.productionInProgressCount),
      sub: `${data.productionOverview.completedCount} completed · ${data.productionOverview.pendingCount} open`,
      onClick: onNavigateBusiness,
      accent: 'text-blue-800',
    },
    {
      label: 'Outstanding Payments',
      value: formatInr(data.outstandingPaymentsAmount),
      sub: 'Pending customer receivables',
      onClick: onNavigateFinancial,
      accent: data.outstandingPaymentsAmount > 0 ? 'text-rose-700' : 'text-emerald-700',
    },
    {
      label: 'Pending Approvals',
      value: String(data.pendingApprovalsCount),
      sub: `Threshold: ${formatInr(data.approvalLimitRupees, 0)}`,
      onClick: () => onNavigateApprovals(),
      accent: data.pendingApprovalsCount > 0 ? 'text-amber-700' : 'text-emerald-700',
    },
  ];

  const monthDelta =
    data.salesTrend.previousMonthSales > 0
      ? ((data.salesTrend.currentMonthSales - data.salesTrend.previousMonthSales) /
          data.salesTrend.previousMonthSales) *
        100
      : null;

  return (
    <div className="space-y-5">
      {/* 1. Six Executive KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {cards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50/20 transition-colors cursor-pointer group"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">{card.label}</p>
              <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-700 transition-colors" />
            </div>
            <p className={`mt-1.5 text-xl font-bold tracking-tight tabular-nums ${card.accent}`}>
              {card.value}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 truncate">{card.sub}</p>
          </button>
        ))}
      </div>

      {/* 2. Two Compact Executive Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="Sales Trend"
          subtitle={`${data.salesTrend.currentMonth} (${formatInr(
            data.salesTrend.currentMonthSales
          )}) vs ${data.salesTrend.previousMonth} (${formatInr(
            data.salesTrend.previousMonthSales
          )})${
            monthDelta !== null
              ? ` · ${monthDelta >= 0 ? '+' : ''}${monthDelta.toFixed(1)}%`
              : ''
          }`}
          action={
            <button
              type="button"
              onClick={onNavigateBusiness}
              className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
            >
              Details
            </button>
          }
        >
          <SimpleTrendChart
            seriesName="Sales Trend"
            points={data.salesTrend.points.map((p) => ({
              label: p.label,
              value: p.salesAmount,
              meta: `${p.orderCount} orders`,
            }))}
            valueFormatter={(v) => formatCompactInr(v)}
          />
        </Card>

        <Card
          title="Production Overview"
          subtitle={`Planned: ${data.productionOverview.plannedQuantity.toLocaleString(
            'en-IN'
          )} vs Good Output: ${data.productionOverview.actualGoodOutput.toLocaleString(
            'en-IN'
          )} · ${data.productionOverview.completedCount} completed / ${
            data.productionOverview.pendingCount
          } pending`}
          action={
            <button
              type="button"
              onClick={onNavigateBusiness}
              className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
            >
              Details
            </button>
          }
        >
          <ComparisonBarChart
            items={data.productionOverview.byProduct.slice(0, 6).map((p) => ({
              label: p.productName,
              primaryValue: p.plannedQuantity,
              secondaryValue: p.actualGoodOutput,
            }))}
            primaryName="Planned Qty"
            secondaryName="Good Output"
            primaryColor="#1e3a8a"
            secondaryColor="#059669"
            emptyText="No production requests recorded yet."
          />
        </Card>
      </div>

      {/* 3. Pending Approvals Table */}
      <Card
        title="Pending Approvals"
        subtitle={`High-value purchase orders above ₹${data.approvalLimitRupees.toLocaleString(
          'en-IN'
        )} requiring Owner decision`}
        action={
          <button
            type="button"
            onClick={() => onNavigateApprovals()}
            className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
          >
            View All →
          </button>
        }
        noPadding
      >
        {data.pendingApprovals.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            No purchase orders are currently pending Owner approval.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">PO #</th>
                  <th className="px-4 py-2.5 font-medium">Supplier</th>
                  <th className="px-4 py-2.5 font-medium">Materials</th>
                  <th className="px-4 py-2.5 font-medium text-right">Estimated Cost</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.pendingApprovals.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                      {po.poNumber}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{po.supplierName}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {po.items.map((it) => `${it.itemName} (${it.orderedQuantity} ${it.unit})`).join(', ')}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                      {formatInr(po.estimatedTotal ?? 0)}
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge tone="amber">Pending Approval</ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onNavigateApprovals(po.id)}
                        className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-100 cursor-pointer"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
