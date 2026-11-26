import { ArrowRight, ClipboardList, Clock, PlusCircle } from 'lucide-react';
import type { AuthUser, SalesmanDashboardData, SalesmanOrder } from '../../types/orderAudit';
import { OrderStatusBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface SalesmanDashboardViewProps {
  user: AuthUser;
  data: SalesmanDashboardData;
  onCreateNewOrder: () => void;
  onViewOrder: (order: SalesmanOrder) => void;
  onViewAllOrders: () => void;
}

export function SalesmanDashboardView({
  user,
  data,
  onCreateNewOrder,
  onViewOrder,
  onViewAllOrders,
}: SalesmanDashboardViewProps) {
  return (
    <div className="space-y-5 anim-fade-in-up">
      {/* Welcome Section */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-blue-700">
            Welcome back
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            {user.fullName}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Browse products, build customer orders, and track fulfillment status.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateNewOrder}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-blue-800 active:scale-[0.99] transition-all"
        >
          <PlusCircle className="h-4 w-4" />
          Create New Order
        </button>
      </div>

      {/* Minimal Summary: Strictly 2 KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Total Orders Submitted</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {data.totalOrdersCount}
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
            <ClipboardList className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Pending Orders</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-700">
              {data.pendingOrdersCount}
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
            <Clock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <Card
        title="Recent Orders"
        subtitle="Latest customer orders you submitted"
        noPadding
        action={
          <button
            type="button"
            onClick={onViewAllOrders}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Order ID</th>
                <th className="px-4 py-2.5">Customer Name</th>
                <th className="px-4 py-2.5">Order Date</th>
                <th className="px-4 py-2.5">Order Status</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recentOrders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => onViewOrder(order)}
                  className="cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-blue-700 tabular-nums whitespace-nowrap">
                    {order.orderNumber}
                  </td>
                  <td className="px-4 py-3 text-slate-800">{order.customerName}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                    {order.orderDate}
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewOrder(order);
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
              {data.recentOrders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                    You have not submitted any orders yet. Click Create New Order to get started.
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

