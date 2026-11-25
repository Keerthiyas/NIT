import { AlertTriangle, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import type { DashboardSummary } from '../../types/orderAudit';
import { Card } from '../ui/Card';
import { OrderStatusBadge, ProductionStatusBadge, ToneBadge } from '../ui/Badge';

interface AdminDashboardViewProps {
  summary: DashboardSummary;
  onOpenOrders: () => void;
  onOpenOrderDetail: (orderId: string) => void;
}

export function AdminDashboardView({
  summary,
  onOpenOrders,
  onOpenOrderDetail,
}: AdminDashboardViewProps) {
  return (
    <div className="space-y-5">
      {/* Compact Order & Production Status Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Pending Orders</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {summary.pendingOrdersCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Submitted or under review
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Production Required</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">
            {summary.productionRequiredCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Sent for supervisor review
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Awaiting Stock</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {summary.awaitingStockCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Held pending replenishment
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Approved (Unfulfilled)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-900">
            {summary.approvedPendingDispatchCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Stock deducted on dispatch only
          </p>
        </div>
      </div>

      {/* Main Two-Column Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Recent Order Activity */}
        <div className="lg:col-span-7">
          <Card
            title="Recent Order Activity"
            subtitle="Click an order to check availability and review shortage decisions"
            noPadding
            action={
              <button
                type="button"
                onClick={onOpenOrders}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-800 hover:text-blue-950"
              >
                View all orders
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Order #</th>
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5 text-right">Qty</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.recentOrders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => onOpenOrderDetail(order.id)}
                      className="cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums whitespace-nowrap">
                        {order.orderNumber}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 max-w-[160px] truncate">
                        {order.customerName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                        {order.productName}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 whitespace-nowrap">
                        {order.requestedQuantity} {order.unit}
                      </td>
                      <td className="px-4 py-2.5">
                        <OrderStatusBadge status={order.status} />
                      </td>
                    </tr>
                  ))}
                  {summary.recentOrders.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-xs text-slate-500"
                      >
                        No recent orders found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Stock & Production Alerts */}
        <div className="lg:col-span-5">
          <Card
            title="Stock & Production Alerts"
            subtitle="Derived from current inventory thresholds and production requests"
          >
            {summary.alerts.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>All stock levels and production queues are healthy.</span>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {summary.alerts.map((alert) => {
                  const style =
                    alert.severity === 'critical'
                      ? 'border-rose-200 bg-rose-50/70 text-rose-900'
                      : alert.severity === 'warning'
                        ? 'border-amber-200 bg-amber-50/70 text-amber-900'
                        : 'border-blue-200 bg-blue-50/60 text-blue-950';

                  const Icon =
                    alert.severity === 'info' ? Info : AlertTriangle;

                  return (
                    <li
                      key={alert.id}
                      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs ${style}`}
                    >
                      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">{alert.title}</p>
                        <p className="mt-0.5 opacity-90">{alert.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Finished Goods Stock + Production Status */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Card
            title="Current Finished-Goods Stock"
            subtitle="Live sellable balance (deducted only upon actual dispatch)"
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5 text-right">Available</th>
                    <th className="px-4 py-2.5 text-right">Reorder At</th>
                    <th className="px-4 py-2.5">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.finishedGoodsStock.map((product) => {
                    const isLow = product.availableStock <= product.reorderLevel;
                    return (
                      <tr key={product.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-900">{product.name}</p>
                          <p className="text-[11px] text-slate-500">{product.sku}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-900">
                          {product.availableStock} {product.unit}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                          {product.reorderLevel} {product.unit}
                        </td>
                        <td className="px-4 py-2.5">
                          <ToneBadge tone={isLow ? 'warning' : 'success'}>
                            {isLow ? 'Low Stock' : 'Adequate'}
                          </ToneBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-6">
          <Card
            title="Production Status"
            subtitle="Requests queued for supervisor review and execution"
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Request #</th>
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5 text-right">Shortage Qty</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.productionRequests.map((req) => (
                    <tr
                      key={req.id}
                      onClick={() => onOpenOrderDetail(req.orderId)}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-blue-900 tabular-nums">
                          {req.requestNumber}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Order {req.orderNumber}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {req.productName}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                        {req.requestedQuantity} {req.unit}
                      </td>
                      <td className="px-4 py-2.5">
                        <ProductionStatusBadge status={req.status} />
                      </td>
                    </tr>
                  ))}
                  {summary.productionRequests.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center text-xs text-slate-500"
                      >
                        No production requests currently queued.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
