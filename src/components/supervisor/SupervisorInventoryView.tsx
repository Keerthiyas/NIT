import { useMemo, useState } from 'react';
import { AlertCircle, History, Search } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  InventoryCategory,
  InventoryItem,
  StockDiscrepancyReport,
  StockMovement,
} from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface SupervisorInventoryViewProps {
  items: InventoryItem[];
  movements: StockMovement[];
  discrepancies: StockDiscrepancyReport[];
  onRefresh: () => Promise<void>;
}

const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  RAW_MATERIAL: 'Raw Material',
  PACKAGING_MATERIAL: 'Packaging Material',
  FINISHED_GOOD: 'Finished Good',
};

export function SupervisorInventoryView({
  items,
  movements,
  discrepancies,
  onRefresh,
}: SupervisorInventoryViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | InventoryCategory>('ALL');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [discrepancyModal, setDiscrepancyModal] = useState<{
    item: InventoryItem;
    physicalQuantity: number;
    reason: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (categoryFilter !== 'ALL' && it.category !== categoryFilter) return false;
      if (lowStockOnly && it.availableStock > it.reorderLevel) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.sku.toLowerCase().includes(q) ||
        (it.usedInProducts ?? []).some((p) => p.toLowerCase().includes(q))
      );
    });
  }, [items, search, categoryFilter, lowStockOnly]);

  const itemMovements = useMemo(
    () => (historyItem ? movements.filter((m) => m.itemId === historyItem.id) : []),
    [historyItem, movements]
  );

  const handleReportDiscrepancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discrepancyModal) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.createStockDiscrepancy({
        itemId: discrepancyModal.item.id,
        physicalQuantity: discrepancyModal.physicalQuantity,
        reason: discrepancyModal.reason,
      });
      setDiscrepancyModal(null);
      setFeedback({
        type: 'ok',
        text: `Discrepancy report ${res.reportNumber} submitted for Admin review. Stock balance stays unchanged until Admin approves.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to submit discrepancy report.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          className={`rounded-md border px-4 py-2.5 text-xs font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search material name, SKU, or product used in..."
            className="w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'RAW_MATERIAL', 'PACKAGING_MATERIAL', 'FINISHED_GOOD'] as const).map(
            (cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                  categoryFilter === cat
                    ? 'bg-blue-950 text-white border-blue-950'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {cat === 'ALL' ? 'All Categories' : CATEGORY_LABELS[cat]}
              </button>
            )
          )}

          <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            Low Stock Only
          </label>
        </div>
      </div>

      {/* Shared Inventory Table */}
      <Card
        title="Shared Material & Product Inventory"
        subtitle="Read-only balances from the central stock ledger. Report physical variances for Admin/Owner approval."
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Item & SKU</th>
                <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                <th className="px-4 py-2.5 text-left font-semibold">Used In Products</th>
                <th className="px-4 py-2.5 text-right font-semibold">Available</th>
                <th className="px-4 py-2.5 text-right font-semibold">Reorder Level</th>
                <th className="px-4 py-2.5 text-left font-semibold">Last Updated</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredItems.map((item) => {
                const isLow = item.availableStock <= item.reorderLevel;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="text-[11px] font-mono text-slate-500">{item.sku}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        tone={
                          item.category === 'RAW_MATERIAL'
                            ? 'blue'
                            : item.category === 'PACKAGING_MATERIAL'
                              ? 'amber'
                              : 'green'
                        }
                      >
                        {CATEGORY_LABELS[item.category]}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 max-w-xs">
                      {item.category === 'FINISHED_GOOD'
                        ? `FG (${item.packSize || item.unit}) · BOM ${item.bomVersion || 'v1.0'}`
                        : (item.usedInProducts ?? []).length > 0
                          ? item.usedInProducts!.join(', ')
                          : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`font-semibold ${
                          isLow ? 'text-rose-700' : 'text-slate-900'
                        }`}
                      >
                        {item.availableStock} {item.unit}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {item.reorderLevel} {item.unit}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {item.lastUpdatedAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => setHistoryItem(item)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <History className="h-3 w-3" />
                        Movements ({item.movementCount})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDiscrepancyModal({
                            item,
                            physicalQuantity: item.availableStock,
                            reason: '',
                          })
                        }
                        className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                      >
                        <AlertCircle className="h-3 w-3" />
                        Report Discrepancy
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Stock Discrepancy Reports Table */}
      <Card
        title="Stock Discrepancy Reports"
        subtitle="Physical count variances submitted for Admin/Owner verification"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Report #</th>
                <th className="px-4 py-2.5 text-left font-semibold">Item</th>
                <th className="px-4 py-2.5 text-right font-semibold">System</th>
                <th className="px-4 py-2.5 text-right font-semibold">Physical</th>
                <th className="px-4 py-2.5 text-right font-semibold">Diff</th>
                <th className="px-4 py-2.5 text-left font-semibold">Reason</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-left font-semibold">Review Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {discrepancies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-5 text-center text-slate-500">
                    No stock discrepancy reports submitted yet.
                  </td>
                </tr>
              ) : (
                discrepancies.map((rep) => (
                  <tr key={rep.id}>
                    <td className="px-4 py-2.5 font-mono font-medium">{rep.reportNumber}</td>
                    <td className="px-4 py-2.5">
                      {rep.itemName} <span className="text-slate-400">({rep.sku})</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {rep.systemQuantity} {rep.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {rep.physicalQuantity} {rep.unit}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold ${
                        rep.differenceQuantity < 0 ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {rep.differenceQuantity > 0 ? `+${rep.differenceQuantity}` : rep.differenceQuantity}{' '}
                      {rep.unit}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{rep.reason}</td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        tone={
                          rep.status === 'APPROVED'
                            ? 'green'
                            : rep.status === 'REJECTED'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {rep.status}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {rep.reviewedByName ? `${rep.reviewedByName}: ${rep.reviewNote || 'Reviewed'}` : 'Awaiting Admin'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal: Item Stock Movements */}
      {historyItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Stock Movements · {historyItem.name} ({historyItem.sku})
                </h3>
                <p className="text-xs text-slate-500">
                  Current Balance: {historyItem.availableStock} {historyItem.unit}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryItem(null)}
                className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Date</th>
                    <th className="px-4 py-2 text-left font-semibold">Type / Ref</th>
                    <th className="px-4 py-2 text-right font-semibold">Qty</th>
                    <th className="px-4 py-2 text-right font-semibold">Balance After</th>
                    <th className="px-4 py-2 text-left font-semibold">Reason & Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {itemMovements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2 text-slate-500">
                        {new Date(m.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <p className="font-medium text-slate-900">
                          {m.movementType.replace(/_/g, ' ')}
                        </p>
                        <p className="font-mono text-[11px] text-slate-500">{m.referenceNumber}</p>
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-semibold ${
                          m.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {m.direction === 'IN' ? '+' : '-'}
                        {m.quantity} {m.unit}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {m.balanceAfter} {m.unit}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        <p>{m.reason}</p>
                        <p className="text-[11px] text-slate-400">By {m.actorName}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Report Stock Discrepancy */}
      {discrepancyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleReportDiscrepancy(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Report Stock Discrepancy</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {discrepancyModal.item.name} ({discrepancyModal.item.sku}) · Submitting does NOT alter stock directly.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  System Stock ({discrepancyModal.item.unit})
                </label>
                <input
                  type="text"
                  disabled
                  value={discrepancyModal.item.availableStock}
                  className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Physical Count ({discrepancyModal.item.unit})
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  required
                  value={discrepancyModal.physicalQuantity}
                  onChange={(e) =>
                    setDiscrepancyModal({
                      ...discrepancyModal,
                      physicalQuantity: Number(e.target.value),
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Explanation / Physical Audit Reason
              </label>
              <textarea
                rows={3}
                required
                placeholder="e.g., Moisture loss, torn pouch batch, physical bin count mismatch..."
                value={discrepancyModal.reason}
                onChange={(e) =>
                  setDiscrepancyModal({ ...discrepancyModal, reason: e.target.value })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDiscrepancyModal(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
