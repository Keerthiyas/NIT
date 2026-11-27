import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  OwnerInventoryItem,
  OwnerInventoryOverviewData,
  OwnerStockStatus,
} from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

function StockStatusBadge({ status }: { status: OwnerStockStatus }) {
  if (status === 'OUT_OF_STOCK') {
    return <ToneBadge tone="red">Out of Stock</ToneBadge>;
  }
  if (status === 'LOW_STOCK') {
    return <ToneBadge tone="amber">Low Stock</ToneBadge>;
  }
  return <ToneBadge tone="green">In Stock</ToneBadge>;
}

function CategoryInventoryTable({
  title,
  items,
}: {
  title: string;
  items: OwnerInventoryItem[];
}) {
  return (
    <Card
      title={title}
      subtitle={`${items.length} items · ${
        items.filter((i) => i.stockStatus !== 'IN_STOCK').length
      } below reorder / out of stock`}
      noPadding
    >
      {items.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-500">No items in {title}.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Item Name</th>
                <th className="px-4 py-2 font-medium text-right">Available</th>
                <th className="px-4 py-2 font-medium text-right">Reorder Level</th>
                <th className="px-4 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-600">{item.sku}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">{item.name}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {item.availableStock.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {item.reorderLevel.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{item.unit}</td>
                  <td className="px-4 py-2">
                    <StockStatusBadge status={item.stockStatus} />
                  </td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                    {item.lastUpdatedAt.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function OwnerInventoryOverviewView() {
  const [data, setData] = useState<OwnerInventoryOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<
    'ALL' | 'RAW' | 'PACKAGING' | 'FINISHED'
  >('ALL');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.loadOwnerInventoryOverview();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Inventory Overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading && !data) {
    return (
      <Card>
        <div className="py-8 text-center text-xs text-slate-500">
          Loading read-only inventory snapshot...
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'ALL', label: 'All Categories' },
            { id: 'RAW', label: `Raw Materials (${data?.rawMaterials.length ?? 0})` },
            {
              id: 'PACKAGING',
              label: `Packaging Materials (${data?.packagingMaterials.length ?? 0})`,
            },
            {
              id: 'FINISHED',
              label: `Finished Products (${data?.finishedProducts.length ?? 0})`,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCategory(tab.id as typeof activeCategory)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                activeCategory === tab.id
                  ? 'bg-blue-950 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          {error}
        </div>
      )}

      {data && (
        <>
          {(activeCategory === 'ALL' || activeCategory === 'RAW') && (
            <CategoryInventoryTable title="Raw Materials" items={data.rawMaterials} />
          )}
          {(activeCategory === 'ALL' || activeCategory === 'PACKAGING') && (
            <CategoryInventoryTable
              title="Packaging Materials"
              items={data.packagingMaterials}
            />
          )}
          {(activeCategory === 'ALL' || activeCategory === 'FINISHED') && (
            <CategoryInventoryTable
              title="Finished Products"
              items={data.finishedProducts}
            />
          )}

          {/* Low-Stock Alerts vs Production Shortages (Distinct Sections) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="Low-Stock Items (Below Reorder Level)"
              subtitle="Inventory items whose available stock is below configured reorder threshold"
              noPadding
            >
              {data.lowStockItems.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-500">
                  All materials and finished products are at or above reorder level.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="px-4 py-2 font-medium text-right">Available</th>
                        <th className="px-4 py-2 font-medium text-right">Reorder</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.lowStockItems.map((it) => (
                        <tr key={it.id}>
                          <td className="px-4 py-2 font-medium text-slate-900">
                            {it.name} <span className="text-slate-500">({it.unit})</span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-rose-700">
                            {it.availableStock}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                            {it.reorderLevel}
                          </td>
                          <td className="px-4 py-2">
                            <StockStatusBadge status={it.stockStatus} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Production Shortages (Request-Specific)"
              subtitle="Materials short against active production requests"
              noPadding
            >
              {data.productionShortages.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-500">
                  No open production shortage queries.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 font-medium">Material</th>
                        <th className="px-4 py-2 font-medium">Request #</th>
                        <th className="px-4 py-2 font-medium text-right">Shortage</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.productionShortages.map((s) => (
                        <tr key={s.id}>
                          <td className="px-4 py-2 font-medium text-slate-900">
                            {s.materialName}
                          </td>
                          <td className="px-4 py-2 text-slate-600">{s.requestNumber}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-rose-700">
                            {s.shortageQuantity} {s.unit}
                          </td>
                          <td className="px-4 py-2">
                            <ToneBadge tone="amber">{s.status}</ToneBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Discrepancy Reports & Recent Stock Movements */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="Stock Discrepancy Reports"
              subtitle="Reported physical vs system variance (read-only executive visibility)"
              noPadding
            >
              {data.discrepancyReports.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-500">
                  No stock discrepancy reports filed.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 font-medium">Report #</th>
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="px-4 py-2 font-medium text-right">Variance</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.discrepancyReports.slice(0, 10).map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 py-2 font-medium text-slate-900">
                            {d.reportNumber}
                          </td>
                          <td className="px-4 py-2 text-slate-700">{d.itemName}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">
                            {d.differenceQuantity > 0 ? '+' : ''}
                            {d.differenceQuantity} {d.unit}
                          </td>
                          <td className="px-4 py-2">
                            <ToneBadge
                              tone={
                                d.status === 'APPROVED'
                                  ? 'green'
                                  : d.status === 'REJECTED'
                                    ? 'red'
                                    : 'amber'
                              }
                            >
                              {d.status}
                            </ToneBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Recent Stock Movements"
              subtitle="Latest audited inventory ledger entries (read-only)"
              noPadding
            >
              {data.recentMovements.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-500">
                  No stock movements recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="px-4 py-2 font-medium">Type</th>
                        <th className="px-4 py-2 font-medium text-right">Qty</th>
                        <th className="px-4 py-2 font-medium text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recentMovements.slice(0, 10).map((m) => (
                        <tr key={m.id}>
                          <td className="px-4 py-2 font-medium text-slate-900">{m.itemName}</td>
                          <td className="px-4 py-2 text-slate-600">{m.movementType}</td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums font-semibold ${
                              m.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {m.direction === 'IN' ? '+' : '-'}
                            {m.quantity} {m.unit}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                            {m.balanceAfter}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
