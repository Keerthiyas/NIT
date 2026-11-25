import type { OrderStatus, ProductionRequestStatus } from '../../types/orderAudit';

const ORDER_STATUS_STYLES: Record<
  OrderStatus,
  { label: string; className: string }
> = {
  SUBMITTED: {
    label: 'Submitted',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  UNDER_REVIEW: {
    label: 'Under Review',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  PRODUCTION_REQUIRED: {
    label: 'Production Required',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  AWAITING_STOCK: {
    label: 'Awaiting Stock',
    className: 'bg-orange-50 text-orange-800 border-orange-200',
  },
  APPROVED: {
    label: 'Approved',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  REJECTED: {
    label: 'Rejected',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  PARTIALLY_DISPATCHED: {
    label: 'Partially Dispatched',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  DISPATCHED: {
    label: 'Dispatched',
    className: 'bg-slate-800 text-white border-slate-800',
  },
};

const PRODUCTION_STATUS_STYLES: Record<
  ProductionRequestStatus,
  { label: string; className: string }
> = {
  PENDING_SUPERVISOR_REVIEW: {
    label: 'Pending Supervisor Review',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  AWAITING_MATERIALS: {
    label: 'Awaiting Materials',
    className: 'bg-orange-50 text-orange-800 border-orange-200',
  },
  READY_FOR_PRODUCTION: {
    label: 'Ready for Production',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  IN_PROGRESS: {
    label: 'In Production',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config = ORDER_STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${config.className}`}
    >
      {config.label}
    </span>
  );
}

export function ProductionStatusBadge({ status }: { status: ProductionRequestStatus }) {
  const config = PRODUCTION_STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${config.className}`}
    >
      {config.label}
    </span>
  );
}

export function ToneBadge({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'navy';
  children: React.ReactNode;
}) {
  const styles: Record<typeof tone, string> = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    navy: 'bg-blue-50 text-blue-900 border-blue-200',
  };

  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${styles[tone]}`}
    >
      {children}
    </span>
  );
}
