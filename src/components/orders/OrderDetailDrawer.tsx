import { X } from 'lucide-react';
import type {
  AdminOrderDecision,
  Order,
  OrderShortageAnalysis,
  Product,
  ProductionRequest,
} from '../../types/orderAudit';
import { OrderStatusBadge } from '../ui/Badge';
import { ShortageRecommendationPanel } from './ShortageRecommendationPanel';

interface OrderDetailDrawerProps {
  order: Order;
  product: Product | undefined;
  analysis: OrderShortageAnalysis;
  existingProductionRequest?: ProductionRequest;
  onClose: () => void;
  onDecision: (
    orderId: string,
    decision: AdminOrderDecision,
    note?: string
  ) => Promise<void>;
  submitting: boolean;
  errorMessage: string | null;
}

export function OrderDetailDrawer({
  order,
  product,
  analysis,
  existingProductionRequest,
  onClose,
  onDecision,
  submitting,
  errorMessage,
}: OrderDetailDrawerProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-detail-heading"
    >
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl flex flex-col">
        {/* Drawer Header */}
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2
                id="order-detail-heading"
                className="text-base font-semibold text-slate-900 tabular-nums"
              >
                {order.orderNumber}
              </h2>
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {order.customerName} ({order.customerCode}) • Ordered{' '}
              {order.orderDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order details"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Drawer Body */}
        <div className="flex-1 space-y-5 p-5">
          {/* Order Metadata Summary */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Product</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {product?.name ?? order.productId}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">SKU</p>
              <p className="mt-0.5 font-medium text-slate-700 tabular-nums">
                {product?.sku ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Requested Qty</p>
              <p className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                {order.requestedQuantity} {product?.unit ?? 'units'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Dispatched Qty</p>
              <p className="mt-0.5 font-medium text-slate-700 tabular-nums">
                {order.dispatchedQuantity} {product?.unit ?? 'units'}
              </p>
            </div>
            {order.notes && (
              <div className="col-span-2 sm:col-span-4 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
                <span className="font-medium text-slate-700">Customer Note: </span>
                {order.notes}
              </div>
            )}
          </div>

          {/* Availability Check + Shortage Recommendation + Decision Panel */}
          <ShortageRecommendationPanel
            order={order}
            analysis={analysis}
            existingProductionRequest={existingProductionRequest}
            onDecision={(decision, note) => onDecision(order.id, decision, note)}
            submitting={submitting}
            errorMessage={errorMessage}
          />

          {/* Audit Trail */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-3">
              Order Audit Trail
            </h3>
            <ol className="space-y-2.5 text-xs">
              {order.auditTrail.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-0.5 border-l-2 border-slate-200 pl-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {entry.action}
                    </span>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <span className="text-slate-500">
                    Actor: {entry.actor}
                    {entry.note ? ` — "${entry.note}"` : ''}
                  </span>
                </li>
              ))}
              {order.auditTrail.length === 0 && (
                <li className="text-slate-500">No audit entries recorded yet.</li>
              )}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
