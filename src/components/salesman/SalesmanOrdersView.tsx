import { useMemo, useState } from 'react';
import { MapPin, Phone, Search, X } from 'lucide-react';
import type { OrderStatus, SalesmanOrder } from '../../types/orderAudit';
import { OrderStatusBadge, ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { ProductImage } from '../ui/ProductImage';

interface SalesmanOrdersViewProps {
  orders: SalesmanOrder[];
  selectedOrder: SalesmanOrder | null;
  onSelectOrder: (order: SalesmanOrder | null) => void;
}

const STATUS_OPTIONS: Array<{ value: 'ALL' | OrderStatus; label: string }> = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'PRODUCTION_REQUIRED', label: 'Production Required' },
  { value: 'AWAITING_STOCK', label: 'Awaiting Stock' },
  { value: 'APPROVED', label: 'Ready for Dispatch' },
  { value: 'PARTIALLY_DISPATCHED', label: 'Partially Dispatched' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'REJECTED', label: 'Rejected' },
];

const PRODUCTION_STAGE_LABELS: Record<
  NonNullable<SalesmanOrder['productionStage']>,
  { label: string; tone: 'warning' | 'navy' | 'success' }
> = {
  AWAITING_MATERIALS: { label: 'Awaiting Materials', tone: 'warning' },
  IN_PROGRESS: { label: 'In Progress', tone: 'navy' },
  READY_FOR_DISPATCH: { label: 'Ready for Dispatch', tone: 'success' },
};

function formatInr(val: number): string {
  return `₹${val.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function SalesmanOrdersView({
  orders,
  selectedOrder,
  onSelectOrder,
}: SalesmanOrdersViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== 'ALL' && order.status !== statusFilter) return false;
      if (!q) return true;
      return (
        order.orderNumber.toLowerCase().includes(q) ||
        order.customerName.toLowerCase().includes(q) ||
        order.items.some((it) => it.productName.toLowerCase().includes(q))
      );
    });
  }, [orders, searchQuery, statusFilter]);

  return (
    <div className="space-y-4 anim-fade-in-up">
      <Card
        title="My Submitted Orders"
        subtitle="Order history and fulfillment tracking for orders you submitted"
        noPadding
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search order ID, customer, product..."
                className="w-56 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter orders by status"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | OrderStatus)
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-700 focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Order ID</th>
                <th className="px-4 py-2.5">Customer Name</th>
                <th className="px-4 py-2.5">Order Date</th>
                <th className="px-4 py-2.5 text-right">Requested Qty</th>
                <th className="px-4 py-2.5 text-right">Dispatched Qty</th>
                <th className="px-4 py-2.5">Order Status</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map((order) => {
                const stageBadge = order.productionStage
                  ? PRODUCTION_STAGE_LABELS[order.productionStage]
                  : null;
                return (
                  <tr
                    key={order.id}
                    onClick={() => onSelectOrder(order)}
                    className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-blue-700 tabular-nums whitespace-nowrap">
                      {order.orderNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <p className="font-medium">{order.customerName}</p>
                      <p className="text-[11px] text-slate-500">
                        {order.items.length} item{order.items.length > 1 ? 's' : ''} •{' '}
                        {formatInr(order.subtotal)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {order.orderDate}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                      {order.requestedQuantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {order.dispatchedQuantity}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <OrderStatusBadge status={order.status} />
                        {stageBadge && (
                          <ToneBadge tone={stageBadge.tone}>
                            {stageBadge.label}
                          </ToneBadge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectOrder(order);
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                    No orders match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Salesman Order Details Drawer (No internal Admin/stock/costing details) */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/35"
          role="dialog"
          aria-modal="true"
          aria-labelledby="salesman-order-detail-heading"
        >
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl flex flex-col anim-slide-in-right">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="salesman-order-detail-heading"
                    className="text-base font-semibold text-slate-900 tabular-nums"
                  >
                    {selectedOrder.orderNumber}
                  </h2>
                  <OrderStatusBadge status={selectedOrder.status} />
                  {selectedOrder.productionStage && (
                    <ToneBadge
                      tone={PRODUCTION_STAGE_LABELS[selectedOrder.productionStage].tone}
                    >
                      {PRODUCTION_STAGE_LABELS[selectedOrder.productionStage].label}
                    </ToneBadge>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Submitted {selectedOrder.orderDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelectOrder(null)}
                aria-label="Close order details"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 p-5 space-y-5 text-xs">
              {/* Customer Info */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-1">
                <p className="font-semibold text-slate-900 text-sm">
                  {selectedOrder.customerName} ({selectedOrder.customerCode})
                </p>
                <p className="flex items-center gap-1.5 text-slate-600">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  {selectedOrder.customerContact} • {selectedOrder.customerPhone}
                </p>
                <p className="flex items-start gap-1.5 text-slate-600">
                  <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>{selectedOrder.deliveryAddress}</span>
                </p>
              </div>

              {/* Ordered Products */}
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2 font-semibold text-slate-700">
                  Ordered Products ({selectedOrder.items.length})
                </div>
                <div className="divide-y divide-slate-100">
                  {selectedOrder.items.map((item) => (
                    <div key={item.id} className="p-3.5 flex items-center gap-3">
                      <ProductImage
                        src={item.imageUrl}
                        alt={item.productName}
                        size="sm"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900">
                          {item.productName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {item.packSize || item.unit} • {formatInr(item.unitPrice)} /{' '}
                          {item.unit}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600 tabular-nums">
                          Requested: <strong>{item.requestedQuantity}</strong> •
                          Dispatched: <strong>{item.dispatchedQuantity}</strong>
                        </p>
                      </div>
                      <p className="font-semibold text-slate-900 tabular-nums">
                        {formatInr(item.lineTotal)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-200 bg-slate-50 px-3.5 py-2.5 flex justify-between text-sm font-bold text-slate-900">
                  <span>Order Subtotal</span>
                  <span className="tabular-nums">
                    {formatInr(selectedOrder.subtotal)}
                  </span>
                </div>
              </div>

              {selectedOrder.customerNote && (
                <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                  <p className="font-semibold text-slate-700 mb-1">Customer Note</p>
                  <p className="text-slate-600">{selectedOrder.customerNote}</p>
                </div>
              )}

              {/* Permitted Order Progress */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-3">
                  Order Progress Updates
                </h3>
                <ol className="space-y-2.5">
                  {selectedOrder.progressUpdates.map((upd) => (
                    <li
                      key={upd.id}
                      className="flex flex-col gap-0.5 border-l-2 border-blue-200 pl-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">
                          {upd.action}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {new Date(upd.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
