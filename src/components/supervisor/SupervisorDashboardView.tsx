import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Factory, Layers } from 'lucide-react';
import { Card } from '../ui/Card';
import { ProductionStatusBadge } from '../ui/Badge';
import type { SupervisorDashboardData, SupervisorNavSection } from '../../types/orderAudit';

interface SupervisorDashboardViewProps {
  data: SupervisorDashboardData;
  onNavigate: (section: SupervisorNavSection) => void;
  onInspectRequest: (requestId: string) => void;
}

export function SupervisorDashboardView({
  data,
  onNavigate,
  onInspectRequest,
}: SupervisorDashboardViewProps) {
  return (
    <div className="space-y-5">
      {/* Compact Operational Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => onNavigate('requests')}
          className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Pending Requests</span>
            <ClipboardList className="h-4 w-4 text-blue-700" />
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">
            {data.pendingRequestsCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Ready or awaiting check</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('requests')}
          className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-rose-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Material Shortages</span>
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-rose-700">
            {data.materialShortageRequestsCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {data.lowStockMaterialsCount} low-stock materials · {data.pendingPurchaseRequirementsCount} open reqs
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('execution')}
          className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-indigo-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">In Production</span>
            <Factory className="h-4 w-4 text-indigo-700" />
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">
            {data.inProgressCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Active batches running</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('history')}
          className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Completed Runs</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-700" />
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">
            {data.completedRunsCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Posted & audited runs</p>
        </button>
      </div>

      {/* Material Shortage Alerts & Recent Production Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card
          title="Material & Procurement Alerts"
          subtitle="Live shortages and low-stock items impacting scheduled production"
          action={
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-blue-800 hover:underline"
            >
              Open Inventory
            </button>
          }
        >
          {data.alerts.length === 0 ? (
            <p className="text-sm text-slate-500 py-3">
              No active material shortages or low-stock warnings.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-md border px-3 py-2.5 flex items-start justify-between gap-3 ${
                    alert.severity === 'critical'
                      ? 'bg-rose-50/70 border-rose-200'
                      : alert.severity === 'warning'
                        ? 'bg-amber-50/70 border-amber-200'
                        : 'bg-blue-50/70 border-blue-200'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900">{alert.title}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{alert.detail}</p>
                  </div>
                  {alert.relatedRequestId && (
                    <button
                      type="button"
                      onClick={() => onInspectRequest(alert.relatedRequestId!)}
                      className="shrink-0 text-xs font-medium text-blue-900 hover:underline inline-flex items-center gap-0.5"
                    >
                      Inspect <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Recent Production & Material Activity"
          subtitle="Audit-logged events across production requests, receipts, and runs"
          action={
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Layers className="h-3.5 w-3.5" />
              {data.openDiscrepanciesCount} open discrepancies · {data.openBomRevisionsCount} BOM revs
            </span>
          }
        >
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-500 py-3">No recent activity logged yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto pr-1">
              {data.recentActivity.map((act) => (
                <li key={act.id} className="py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {act.action.replace(/_/g, ' ')}
                    </span>
                    <span className="text-slate-400">
                      {new Date(act.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-0.5">{act.details}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">By {act.actorName}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Compact Recent Production Requests Table */}
      <Card
        title="Recent Production Requests"
        subtitle="Requests dispatched from Admin order review"
        action={
          <button
            type="button"
            onClick={() => onNavigate('requests')}
            className="text-xs font-medium text-blue-800 hover:underline inline-flex items-center gap-1"
          >
            View All Requests <ArrowRight className="h-3.5 w-3.5" />
          </button>
        }
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Request ID</th>
                <th className="px-4 py-2.5 text-left font-semibold">Product</th>
                <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-4 py-2.5 text-left font-semibold">Customer Order</th>
                <th className="px-4 py-2.5 text-left font-semibold">Materials</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {data.recentRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    No production requests available.
                  </td>
                </tr>
              ) : (
                data.recentRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-900">
                      {req.requestNumber}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{req.productName}</p>
                      <p className="text-[11px] text-slate-500">{req.productSku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                      {req.requestedQuantity} {req.unit}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      <span className="font-mono">{req.orderNumber}</span>
                      {req.customerName ? ` · ${req.customerName}` : ''}
                    </td>
                    <td className="px-4 py-2.5">
                      {req.rawMaterialAvailability === 'SUFFICIENT' ? (
                        <span className="text-emerald-700 font-medium">Sufficient</span>
                      ) : (
                        <span className="text-rose-700 font-medium">
                          {req.materialsToPurchase.length} short
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <ProductionStatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onInspectRequest(req.id)}
                        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
