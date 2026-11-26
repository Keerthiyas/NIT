import { useMemo, useState } from 'react';
import { ClipboardEdit, Eye, Search } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { ProductionRun } from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface SupervisorHistoryViewProps {
  runs: ProductionRun[];
  onRefresh: () => Promise<void>;
}

export function SupervisorHistoryView({ runs, onRefresh }: SupervisorHistoryViewProps) {
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [explanationText, setExplanationText] = useState('');
  const [editingExpRunId, setEditingExpRunId] = useState<string | null>(null);
  const [bomModal, setBomModal] = useState<{
    runId: string;
    productId: string;
    productName: string;
    bomVersion: string;
    materialId: string;
    materialName: string;
    unit: string;
    suggestedQuantityPerUnit: number;
    reason: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const products = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of runs) {
      map.set(r.productId, r.productName);
    }
    return Array.from(map.entries());
  }, [runs]);

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (productFilter !== 'ALL' && r.productId !== productFilter) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      const dateStr = r.postedAt.slice(0, 10);
      if (fromDate && dateStr < fromDate) return false;
      if (toDate && dateStr > toDate) return false;
      if (!q) return true;
      return (
        r.runNumber.toLowerCase().includes(q) ||
        r.requestNumber.toLowerCase().includes(q) ||
        r.orderNumber.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q)
      );
    });
  }, [runs, search, productFilter, statusFilter, fromDate, toDate]);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? filteredRuns[0] ?? null,
    [runs, selectedRunId, filteredRuns]
  );

  const handleSaveExplanation = async (runId: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await orderAuditService.updateRunVarianceExplanation(runId, explanationText);
      setEditingExpRunId(null);
      setFeedback({
        type: 'ok',
        text: 'Variance explanation recorded. Posted run figures & stock movements remain locked and immutable.',
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update variance explanation.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitBomRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bomModal) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.createBomRevisionRequest({
        productId: bomModal.productId,
        materialId: bomModal.materialId,
        suggestedQuantityPerUnit: bomModal.suggestedQuantityPerUnit,
        productionRunId: bomModal.runId,
        reason: bomModal.reason,
      });
      setBomModal(null);
      setFeedback({
        type: 'ok',
        text: `BOM revision request ${res.requestNumber} sent to Admin for review.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to request BOM revision.',
      });
    } finally {
      setBusy(false);
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search run #, request #, order #, product..."
            className="w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-sm"
          />
        </div>
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="ALL">All Products</option>
          {products.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="ALL">All Statuses</option>
          <option value="POSTED">Posted</option>
          <option value="PARTIALLY_COMPLETED">Partially Completed</option>
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
        />
      </div>

      {/* Runs Table */}
      <Card
        title="Posted Production History"
        subtitle="Immutable production runs, yields, and variances. Posted figures cannot be altered."
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Run #</th>
                <th className="px-4 py-2.5 text-left font-semibold">Product & BOM</th>
                <th className="px-4 py-2.5 text-left font-semibold">Order / Req</th>
                <th className="px-4 py-2.5 text-right font-semibold">Planned</th>
                <th className="px-4 py-2.5 text-right font-semibold">Good Output</th>
                <th className="px-4 py-2.5 text-right font-semibold">Rejected</th>
                <th className="px-4 py-2.5 text-right font-semibold">Yield %</th>
                <th className="px-4 py-2.5 text-left font-semibold">Quality / Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredRuns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                    No posted production runs match the filters.
                  </td>
                </tr>
              ) : (
                filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    className={
                      selectedRun?.id === run.id ? 'bg-blue-50/70' : 'hover:bg-slate-50/70'
                    }
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-mono font-semibold text-slate-900">{run.runNumber}</p>
                      <p className="text-[11px] text-slate-400">{run.postedAt.slice(0, 10)}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{run.productName}</p>
                      <p className="text-[11px] text-slate-500">
                        BOM {run.bomVersion || 'v1.0'}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-700">
                      <p>{run.orderNumber}</p>
                      <p className="text-[11px] text-slate-400">{run.requestNumber}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {run.plannedQuantity} {run.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">
                      {run.actualOutputQuantity} {run.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right text-rose-700">
                      {run.rejectedQuantity ?? 0}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {run.yieldPercent ?? 100}%
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        tone={
                          run.qualityResult === 'FAILED'
                            ? 'red'
                            : run.qualityResult === 'CONDITIONAL'
                              ? 'amber'
                              : 'green'
                        }
                      >
                        {run.qualityResult || 'PASSED'} · {run.status}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRunId(run.id);
                          setEditingExpRunId(null);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                      >
                        <Eye className="h-3 w-3" />
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Run Detail & Variance Analysis Inspector */}
      {selectedRun && (
        <Card
          title={`${selectedRun.runNumber} · Detailed Run & Material Variance Report`}
          subtitle={`BOM ${selectedRun.bomVersion || 'v1.0'} · Completed by ${selectedRun.supervisorName} on ${new Date(selectedRun.postedAt).toLocaleString()} (Read-Only)`}
        >
          <div className="space-y-5">
            {/* Material Consumption Variance Table */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Planned vs Actual Material Consumption & Variance
              </h4>
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Material</th>
                      <th className="px-3 py-2 text-right font-semibold">Planned</th>
                      <th className="px-3 py-2 text-right font-semibold">Actual + Addl</th>
                      <th className="px-3 py-2 text-right font-semibold">Damaged / Waste</th>
                      <th className="px-3 py-2 text-right font-semibold">Variance</th>
                      <th className="px-3 py-2 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {selectedRun.consumptions.map((c) => {
                      const totalActual =
                        c.actualConsumedQuantity + (c.additionalConsumedQuantity ?? 0);
                      const varQty =
                        c.varianceQuantity ?? Number((totalActual - c.plannedQuantity).toFixed(3));
                      const varPct =
                        c.variancePercent ??
                        (c.plannedQuantity > 0
                          ? Number(((varQty / c.plannedQuantity) * 100).toFixed(1))
                          : 0);
                      return (
                        <tr key={c.id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-900">{c.materialName}</p>
                            {c.reason && (
                              <p className="text-[11px] text-slate-500">Note: {c.reason}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {c.plannedQuantity} {c.unit}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {totalActual} {c.unit}
                            {(c.additionalConsumedQuantity ?? 0) > 0 && (
                              <span className="block text-[10px] text-amber-700">
                                (+{c.additionalConsumedQuantity} extra)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {c.damagedQuantity ?? 0} dmg / {c.wastageQuantity} waste
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-semibold ${
                              varQty > 0
                                ? 'text-rose-700'
                                : varQty < 0
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                            }`}
                          >
                            {varQty > 0 ? `+${varQty}` : varQty} {c.unit} ({varPct}%)
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setBomModal({
                                  runId: selectedRun.id,
                                  productId: selectedRun.productId,
                                  productName: selectedRun.productName,
                                  bomVersion: selectedRun.bomVersion || 'v1.0',
                                  materialId: c.materialId,
                                  materialName: c.materialName,
                                  unit: c.unit,
                                  suggestedQuantityPerUnit:
                                    selectedRun.actualOutputQuantity > 0
                                      ? Number(
                                          (totalActual / selectedRun.actualOutputQuantity).toFixed(4)
                                        )
                                      : 0.1,
                                  reason: `Observed consumption in ${selectedRun.runNumber}`,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <ClipboardEdit className="h-3 w-3" />
                              Request BOM Rev
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Variance Explanation */}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">Supervisor Variance Explanation</span>
                {editingExpRunId !== selectedRun.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingExpRunId(selectedRun.id);
                      setExplanationText(selectedRun.varianceExplanation || '');
                    }}
                    className="text-xs font-medium text-blue-900 hover:underline"
                  >
                    {selectedRun.varianceExplanation ? 'Edit Explanation' : 'Add Explanation'}
                  </button>
                )}
              </div>
              {editingExpRunId === selectedRun.id ? (
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={explanationText}
                    onChange={(e) => setExplanationText(e.target.value)}
                    placeholder="Document root cause of material/output variance..."
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingExpRunId(null)}
                      className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveExplanation(selectedRun.id)}
                      className="rounded bg-blue-900 px-3 py-1 text-xs font-medium text-white"
                    >
                      Save Explanation
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-slate-700">
                  {selectedRun.varianceExplanation ||
                    'No variance explanation recorded for this run.'}
                </p>
              )}
            </div>

            {/* Linked Stock Movements */}
            {selectedRun.linkedMovements && selectedRun.linkedMovements.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Linked Stock Ledger Movements ({selectedRun.linkedMovements.length})
                </h4>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Item</th>
                        <th className="px-3 py-2 text-left font-semibold">Movement</th>
                        <th className="px-3 py-2 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold">Balance After</th>
                        <th className="px-3 py-2 text-left font-semibold">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {selectedRun.linkedMovements.map((m) => (
                        <tr key={m.id}>
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {m.itemName} <span className="text-slate-400">({m.sku})</span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {m.movementType.replace(/_/g, ' ')}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-semibold ${
                              m.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {m.direction === 'IN' ? '+' : '-'}
                            {m.quantity} {m.unit}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {m.balanceAfter} {m.unit}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{m.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Modal: Request BOM Revision from History */}
      {bomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleSubmitBomRevision(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Request BOM Revision</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {bomModal.productName} ({bomModal.bomVersion}) · {bomModal.materialName}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Suggested Quantity per Unit ({bomModal.unit})
              </label>
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                required
                value={bomModal.suggestedQuantityPerUnit}
                onChange={(e) =>
                  setBomModal({ ...bomModal, suggestedQuantityPerUnit: Number(e.target.value) })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reason for Admin Approval
              </label>
              <textarea
                rows={3}
                required
                value={bomModal.reason}
                onChange={(e) => setBomModal({ ...bomModal, reason: e.target.value })}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBomModal(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white"
              >
                Submit Revision Request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
