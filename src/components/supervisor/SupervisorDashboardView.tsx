import { AlertTriangle, ClipboardList, Factory } from 'lucide-react';
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
  const topMaterialAlerts = (data.materialAlerts ?? []).slice(0, 3);
  const latestRequests = data.recentRequests.slice(0, 3);

  return (
    <div className="space-y-4">
      {/* 1. Summary — Strictly 3 compact statistic cards in one row on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('requests')}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 transition-colors"
        >
          <div>
            <p className="text-xs font-medium text-slate-500">Pending Requests</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {data.pendingRequestsCount}
            </p>
          </div>
          <div className="rounded-md bg-blue-50 p-2 text-blue-800">
            <ClipboardList className="h-4 w-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-amber-300 transition-colors"
        >
          <div>
            <p className="text-xs font-medium text-slate-500">Low Stock Materials</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                data.lowStockMaterialsCount > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {data.lowStockMaterialsCount}
            </p>
          </div>
          <div className="rounded-md bg-amber-50 p-2 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('execution')}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-indigo-300 transition-colors"
        >
          <div>
            <p className="text-xs font-medium text-slate-500">In Progress</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {data.inProgressCount}
            </p>
          </div>
          <div className="rounded-md bg-indigo-50 p-2 text-indigo-700">
            <Factory className="h-4 w-4" />
          </div>
        </button>
      </div>

      {/* 2. Material Alerts & 3. Recent Production */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Material Alerts — Top 3 most important low-stock / shortage materials */}
        <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Material Alerts</h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-blue-800 hover:underline"
            >
              View Inventory
            </button>
          </div>

          {topMaterialAlerts.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No low-stock or material shortage alerts.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topMaterialAlerts.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{item.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                      Available: <span className="font-medium text-slate-700">{item.availableStock} {item.unit}</span>
                      {' · '}
                      Reorder: {item.reorderLevel} {item.unit}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                      item.affectsProduction
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {item.affectsProduction ? 'Shortage' : 'Low Stock'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent Production — Latest 3 requests; clicking opens corresponding request */}
        <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Recent Production</h2>
            <button
              type="button"
              onClick={() => onNavigate('requests')}
              className="text-xs font-medium text-blue-800 hover:underline"
            >
              View All
            </button>
          </div>

          {latestRequests.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No pending or recent production requests.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Product</th>
                    <th className="px-4 py-2 text-left font-medium">Request ID</th>
                    <th className="px-4 py-2 text-right font-medium">Planned Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {latestRequests.map((req) => (
                    <tr
                      key={req.id}
                      onClick={() => onInspectRequest(req.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onInspectRequest(req.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      className="cursor-pointer hover:bg-slate-50 transition-colors focus:bg-blue-50/50 focus:outline-none"
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900">{req.productName}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{req.requestNumber}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">
                        {req.requestedQuantity} {req.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ProductionStatusBadge status={req.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
