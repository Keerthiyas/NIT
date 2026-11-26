import { useMemo } from 'react';
import { AlertTriangle, ChevronRight, ClipboardList, Factory } from 'lucide-react';
import { ProductionStatusBadge } from '../ui/Badge';
import type {
  InventoryItem,
  ProductionRequest,
  SupervisorDashboardData,
  SupervisorNavSection,
} from '../../types/orderAudit';

interface SupervisorDashboardViewProps {
  data: SupervisorDashboardData;
  inventoryItems: InventoryItem[];
  requests: ProductionRequest[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onNavigate: (section: SupervisorNavSection) => void;
  onOpenPendingRequests: () => void;
  onOpenLowStockInventory: () => void;
  onOpenActiveProduction: () => void;
  onOpenAllRequests: () => void;
  onOpenMaterialDetail: (itemId: string) => void;
  onInspectRequest: (requestId: string) => void;
}

const PENDING_STATUSES = new Set([
  'PENDING_SUPERVISOR_REVIEW',
  'PENDING_MATERIAL_CHECK',
  'AWAITING_MATERIALS',
  'MATERIAL_SHORTAGE',
  'READY_FOR_PRODUCTION',
]);

export function SupervisorDashboardView({
  data,
  inventoryItems,
  requests,
  loading = false,
  error = null,
  onRetry,
  onOpenPendingRequests,
  onOpenLowStockInventory,
  onOpenActiveProduction,
  onOpenAllRequests,
  onOpenMaterialDetail,
  onInspectRequest,
}: SupervisorDashboardViewProps) {
  // Derive consistent metrics & alerts directly from live shared backend inventory + requests
  // (using data.materialAlerts when present, and falling back identically from inventoryItems)
  const { pendingCount, lowStockCount, inProgressCount, allAlerts } = useMemo(() => {
    const activeRequests = requests.length > 0 ? requests : data.recentRequests;
    const pending = activeRequests.filter((r) => PENDING_STATUSES.has(r.status)).length;
    const active = activeRequests.filter((r) => r.status === 'IN_PROGRESS').length;

    const shortfallMap = new Map<string, number>();
    for (const req of activeRequests) {
      if (['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'].includes(req.status)) continue;
      for (const mat of req.materialsToPurchase ?? []) {
        if (mat.shortfallQuantity > 0) {
          shortfallMap.set(
            mat.rawMaterialId,
            (shortfallMap.get(mat.rawMaterialId) ?? 0) + mat.shortfallQuantity
          );
        }
      }
    }

    const materialItems = inventoryItems.filter(
      (i) => i.category === 'RAW_MATERIAL' || i.category === 'PACKAGING_MATERIAL'
    );

    const lowCountFromInv = materialItems.filter(
      (i) => i.availableStock < i.reorderLevel
    ).length;

    const computedAlerts =
      data.materialAlerts && data.materialAlerts.length > 0
        ? data.materialAlerts
        : materialItems
            .filter(
              (i) => i.availableStock < i.reorderLevel || shortfallMap.has(i.id)
            )
            .map((i) => {
              const isLowStock = i.availableStock < i.reorderLevel;
              const shortfallQuantity = shortfallMap.get(i.id) ?? 0;
              return {
                id: i.id,
                name: i.name,
                unit: i.unit,
                availableStock: i.availableStock,
                reorderLevel: i.reorderLevel,
                isLowStock,
                affectsProduction: shortfallQuantity > 0,
                shortfallQuantity,
                alertType: (shortfallQuantity > 0
                  ? 'PRODUCTION_SHORTAGE'
                  : 'LOW_STOCK') as 'PRODUCTION_SHORTAGE' | 'LOW_STOCK',
              };
            })
            .sort((a, b) => {
              if (a.isLowStock !== b.isLowStock) return a.isLowStock ? -1 : 1;
              if (a.affectsProduction !== b.affectsProduction) {
                return a.affectsProduction ? -1 : 1;
              }
              return (
                a.availableStock / Math.max(a.reorderLevel, 1) -
                b.availableStock / Math.max(b.reorderLevel, 1)
              );
            });

    return {
      pendingCount: inventoryItems.length > 0 || requests.length > 0 ? pending : data.pendingRequestsCount,
      lowStockCount: materialItems.length > 0 ? lowCountFromInv : data.lowStockMaterialsCount,
      inProgressCount: inventoryItems.length > 0 || requests.length > 0 ? active : data.inProgressCount,
      allAlerts: computedAlerts,
    };
  }, [data, inventoryItems, requests]);

  const topMaterialAlerts = allAlerts.slice(0, 3);
  const hasMoreAlerts = allAlerts.length > 3;
  const latestRequests = (requests.length > 0 ? requests : data.recentRequests).slice(0, 3);

  if (loading && inventoryItems.length === 0 && requests.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
        Loading production summary...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-800">
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-rose-300 bg-white px-2 py-0.5 font-medium text-rose-800 hover:bg-rose-50"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* 1. Summary — 3 Interactive Compact Cards in One Row on Desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={onOpenPendingRequests}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-xs transition-all duration-150 hover:border-blue-400 hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <div>
            <p className="text-xs font-medium text-slate-500 group-hover:text-blue-900 transition-colors">
              Pending Requests
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {pendingCount}
            </p>
          </div>
          <div className="rounded-md bg-blue-50 p-2 text-blue-800 group-hover:bg-blue-100 transition-colors">
            <ClipboardList className="h-4 w-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenLowStockInventory}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-xs transition-all duration-150 hover:border-amber-400 hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <div>
            <p className="text-xs font-medium text-slate-500 group-hover:text-amber-800 transition-colors">
              Low Stock Materials
            </p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                lowStockCount > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {lowStockCount}
            </p>
          </div>
          <div className="rounded-md bg-amber-50 p-2 text-amber-700 group-hover:bg-amber-100 transition-colors">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenActiveProduction}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-xs transition-all duration-150 hover:border-indigo-400 hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <div>
            <p className="text-xs font-medium text-slate-500 group-hover:text-indigo-900 transition-colors">
              In Progress
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {inProgressCount}
            </p>
          </div>
          <div className="rounded-md bg-indigo-50 p-2 text-indigo-700 group-hover:bg-indigo-100 transition-colors">
            <Factory className="h-4 w-4" />
          </div>
        </button>
      </div>

      {/* 2. Material Alerts & 3. Recent Production — Balanced Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Material Alerts */}
        <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Material Alerts</h2>
            <div className="flex items-center gap-3">
              {hasMoreAlerts && (
                <button
                  type="button"
                  onClick={onOpenLowStockInventory}
                  className="text-xs font-medium text-amber-800 hover:underline cursor-pointer"
                >
                  View All ({allAlerts.length})
                </button>
              )}
              <button
                type="button"
                onClick={onOpenLowStockInventory}
                className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
              >
                View Inventory
              </button>
            </div>
          </div>

          {topMaterialAlerts.length === 0 ? (
            <p className="px-4 py-4 text-center text-xs text-slate-500">
              All raw and packaging materials are above reorder level.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topMaterialAlerts.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMaterialDetail(item.id)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-xs hover:bg-slate-50 active:bg-slate-100/70 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 truncate">{item.name}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                        Available:{' '}
                        <span className="font-medium text-slate-800">
                          {item.availableStock} {item.unit}
                        </span>
                        {' · '}
                        Reorder: {item.reorderLevel} {item.unit}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.isLowStock !== false && (
                        <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 whitespace-nowrap">
                          Low Stock
                        </span>
                      )}
                      {item.affectsProduction && (
                        <span className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 whitespace-nowrap">
                          Shortage
                        </span>
                      )}
                      <span className="inline-flex items-center text-[11px] font-medium text-blue-800">
                        Details
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent Production */}
        <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Recent Production</h2>
            <button
              type="button"
              onClick={onOpenAllRequests}
              className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>

          {latestRequests.length === 0 ? (
            <p className="px-4 py-4 text-center text-xs text-slate-500">
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
                      className="cursor-pointer hover:bg-slate-50 active:bg-slate-100/70 transition-colors focus:bg-blue-50/50 focus:outline-none"
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
