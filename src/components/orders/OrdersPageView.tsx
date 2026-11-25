import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Order, OrderStatus, Product } from '../../types/orderAudit';
import { Card } from '../ui/Card';
import { OrderStatusBadge } from '../ui/Badge';

interface OrdersPageViewProps {
  orders: Order[];
  products: Product[];
  onOpenOrder: (orderId: string) => void;
}

const STATUS_FILTER_OPTIONS: Array<{ value: 'ALL' | OrderStatus; label: string }> = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'PRODUCTION_REQUIRED', label: 'Production Required' },
  { value: 'AWAITING_STOCK', label: 'Awaiting Stock' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PARTIALLY_DISPATCHED', label: 'Partially Dispatched' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'REJECTED', label: 'Rejected' },
];

export function OrdersPageView({
  orders,
  products,
  onOpenOrder,
}: OrdersPageViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== 'ALL' && order.status !== statusFilter) {
        return false;
      }
      if (!query) return true;
      const productName = productMap.get(order.productId)?.name ?? '';
      return (
        order.orderNumber.toLowerCase().includes(query) ||
        order.customerName.toLowerCase().includes(query) ||
        productName.toLowerCase().includes(query)
      );
    });
  }, [orders, productMap, searchQuery, statusFilter]);

  return (
    <div className="space-y-4">
      <Card
        title="Customer Orders"
        subtitle="Open an order to check finished-goods availability, evaluate BOM shortages, and decide next steps"
        noPadding
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search order #, customer, product..."
                className="w-56 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter orders by status"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | OrderStatus)
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-800 focus:outline-none"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
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
                <th className="px-4 py-2.5">Order #</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5 text-right">Quantity</th>
                <th className="px-4 py-2.5 text-right">FG Stock</th>
                <th className="px-4 py-2.5">Order Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map((order) => {
                const product = productMap.get(order.productId);
                const availableStock = product?.availableStock ?? 0;
                const unit = product?.unit ?? 'units';
                const hasShortage =
                  order.status !== 'DISPATCHED' &&
                  order.status !== 'REJECTED' &&
                  order.requestedQuantity - order.dispatchedQuantity > availableStock;

                return (
                  <tr key={order.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-blue-900 tabular-nums whitespace-nowrap">
                      {order.orderNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <p className="font-medium">{order.customerName}</p>
                      <p className="text-[11px] text-slate-500">
                        {order.customerCode}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {product?.name ?? order.productId}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900 whitespace-nowrap">
                      {order.requestedQuantity} {unit}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${
                        hasShortage
                          ? 'font-medium text-amber-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {availableStock} {unit}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums whitespace-nowrap">
                      {order.orderDate}
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenOrder(order.id)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50 hover:border-blue-300"
                      >
                        Check &amp; Review
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredOrders.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-xs text-slate-500"
                  >
                    No orders match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
