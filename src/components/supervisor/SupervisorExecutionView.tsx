import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, Save, ShieldCheck } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { InventoryItem, ProductionRequest } from '../../types/orderAudit';
import { ProductionStatusBadge, ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface SupervisorExecutionViewProps {
  requests: ProductionRequest[];
  inventoryItems: InventoryItem[];
  initialRequestId: string | null;
  onRefresh: () => Promise<void>;
  onPostedSuccess: () => void;
}

interface MaterialDraftLine {
  materialId: string;
  materialName: string;
  materialCode: string;
  category: string;
  unit: string;
  plannedQuantity: number;
  availableStock: number;
  actualConsumedQuantity: number;
  additionalConsumedQuantity: number;
  damagedQuantity: number;
  wastageQuantity: number;
  reason: string;
}

export function SupervisorExecutionView({
  requests,
  inventoryItems,
  initialRequestId,
  onRefresh,
  onPostedSuccess,
}: SupervisorExecutionViewProps) {
  const executableRequests = useMemo(
    () =>
      requests.filter(
        (r) =>
          !['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'].includes(r.status)
      ),
    [requests]
  );

  const [selectedRequestId, setSelectedRequestId] = useState<string>(
    initialRequestId ||
      executableRequests.find((r) => r.status === 'IN_PROGRESS')?.id ||
      executableRequests[0]?.id ||
      ''
  );

  useEffect(() => {
    if (
      initialRequestId &&
      executableRequests.some((r) => r.id === initialRequestId)
    ) {
      setSelectedRequestId(initialRequestId);
    } else if (
      !executableRequests.some((r) => r.id === selectedRequestId) &&
      executableRequests.length > 0
    ) {
      setSelectedRequestId(executableRequests[0].id);
    }
  }, [initialRequestId, executableRequests, selectedRequestId]);

  const selectedRequest = useMemo(
    () => executableRequests.find((r) => r.id === selectedRequestId) ?? null,
    [executableRequests, selectedRequestId]
  );

  const stockMap = useMemo(
    () => new Map(inventoryItems.map((it) => [it.id, it.availableStock])),
    [inventoryItems]
  );

  const [lines, setLines] = useState<MaterialDraftLine[]>([]);
  const [goodOutputQty, setGoodOutputQty] = useState<number>(0);
  const [rejectedQty, setRejectedQty] = useState<number>(0);
  const [damagedPkgQty, setDamagedPkgQty] = useState<number>(0);
  const [wastageQty, setWastageQty] = useState<number>(0);
  const [qualityResult, setQualityResult] = useState<'PASSED' | 'CONDITIONAL' | 'FAILED'>('PASSED');
  const [completionStatus, setCompletionStatus] = useState<'COMPLETED' | 'PARTIALLY_COMPLETED'>(
    'COMPLETED'
  );
  const [notes, setNotes] = useState('');
  const [varianceExplanation, setVarianceExplanation] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Initialize form from request BOM + any saved draft
  useEffect(() => {
    if (!selectedRequest) return;
    let cancelled = false;

    const baseLines: MaterialDraftLine[] = (selectedRequest.bomMaterials ?? []).map((b) => ({
      materialId: b.materialId,
      materialName: b.materialName,
      materialCode: b.materialCode,
      category: b.category,
      unit: b.unit,
      plannedQuantity: b.requiredQuantity,
      availableStock: stockMap.get(b.materialId) ?? b.availableStock,
      actualConsumedQuantity: b.requiredQuantity,
      additionalConsumedQuantity: 0,
      damagedQuantity: 0,
      wastageQuantity: 0,
      reason: '',
    }));

    setLines(baseLines);
    setGoodOutputQty(selectedRequest.requestedQuantity);
    setRejectedQty(0);
    setDamagedPkgQty(0);
    setWastageQty(0);
    setQualityResult('PASSED');
    setCompletionStatus('COMPLETED');
    setNotes('');
    setVarianceExplanation('');
    setDraftSavedAt(null);
    setFeedback(null);

    void (async () => {
      try {
        const draft = await orderAuditService.getProductionRunDraft(selectedRequest.id);
        if (cancelled || !draft) return;
        const p = draft.payload;
        if (p.goodOutputQuantity !== undefined) setGoodOutputQty(p.goodOutputQuantity);
        if (p.rejectedQuantity !== undefined) setRejectedQty(p.rejectedQuantity);
        if (p.damagedPackagingQuantity !== undefined)
          setDamagedPkgQty(p.damagedPackagingQuantity);
        if (p.wastageQuantity !== undefined) setWastageQty(p.wastageQuantity);
        if (p.qualityResult) setQualityResult(p.qualityResult);
        if (p.completionStatus) setCompletionStatus(p.completionStatus);
        if (p.notes !== undefined) setNotes(p.notes);
        if (p.varianceExplanation !== undefined) setVarianceExplanation(p.varianceExplanation);
        if (p.consumptions && p.consumptions.length > 0) {
          const consMap = new Map(p.consumptions.map((c) => [c.materialId, c]));
          setLines(
            baseLines.map((ln) => {
              const saved = consMap.get(ln.materialId);
              if (!saved) return ln;
              return {
                ...ln,
                actualConsumedQuantity: saved.actualConsumedQuantity,
                additionalConsumedQuantity: saved.additionalConsumedQuantity ?? 0,
                damagedQuantity: saved.damagedQuantity ?? 0,
                wastageQuantity: saved.wastageQuantity ?? 0,
                reason: saved.reason ?? '',
              };
            })
          );
        }
        setDraftSavedAt(draft.updatedAt);
      } catch {
        // ignore if no draft
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRequest?.id, stockMap]);

  const anyNegativeStockRisk = useMemo(
    () =>
      lines.some(
        (ln) =>
          ln.actualConsumedQuantity + ln.additionalConsumedQuantity > ln.availableStock
      ),
    [lines]
  );

  const yieldPercent = useMemo(() => {
    if (!selectedRequest || selectedRequest.requestedQuantity <= 0) return 100;
    return Number(((goodOutputQty / selectedRequest.requestedQuantity) * 100).toFixed(1));
  }, [selectedRequest, goodOutputQty]);

  const outputVariance = useMemo(() => {
    if (!selectedRequest) return 0;
    return Number((goodOutputQty - selectedRequest.requestedQuantity).toFixed(3));
  }, [selectedRequest, goodOutputQty]);

  const handleStartRun = async () => {
    if (!selectedRequest) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await orderAuditService.updateProductionRequestStatus(
        selectedRequest.id,
        'IN_PROGRESS',
        'Started execution run'
      );
      setFeedback({
        type: 'ok',
        text: `${selectedRequest.requestNumber} started (In Progress). Inventory remains unchanged until posted.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to start production run.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedRequest) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.saveProductionRunDraft(selectedRequest.id, {
        goodOutputQuantity: goodOutputQty,
        rejectedQuantity: rejectedQty,
        damagedPackagingQuantity: damagedPkgQty,
        wastageQuantity: wastageQty,
        qualityResult,
        completionStatus,
        notes,
        varianceExplanation,
        consumptions: lines.map((ln) => ({
          materialId: ln.materialId,
          actualConsumedQuantity: ln.actualConsumedQuantity,
          additionalConsumedQuantity: ln.additionalConsumedQuantity,
          damagedQuantity: ln.damagedQuantity,
          wastageQuantity: ln.wastageQuantity,
          reason: ln.reason,
        })),
      });
      setDraftSavedAt(res.updatedAt);
      setFeedback({
        type: 'ok',
        text: `Draft saved (${new Date(res.updatedAt).toLocaleTimeString()}). Stock ledger was NOT modified.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save production draft.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPost = async () => {
    if (!selectedRequest) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await orderAuditService.postProductionRun({
        productionRequestId: selectedRequest.id,
        goodOutputQuantity: goodOutputQty,
        rejectedQuantity: rejectedQty,
        damagedPackagingQuantity: damagedPkgQty,
        wastageQuantity: wastageQty,
        qualityResult,
        completionStatus,
        notes,
        varianceExplanation,
        consumptions: lines.map((ln) => ({
          materialId: ln.materialId,
          actualConsumedQuantity: ln.actualConsumedQuantity,
          additionalConsumedQuantity: ln.additionalConsumedQuantity,
          damagedQuantity: ln.damagedQuantity,
          wastageQuantity: ln.wastageQuantity,
          reason: ln.reason,
        })),
        idempotencyKey: `run-${selectedRequest.id}-${Date.now()}`,
      });
      setConfirmOpen(false);
      setFeedback({
        type: 'ok',
        text: `Production Run ${res.runNumber} posted! Material consumption deducted and ${goodOutputQty} good ${selectedRequest.unit} added to Finished Goods stock.`,
      });
      await onRefresh();
      onPostedSuccess();
    } catch (err) {
      setConfirmOpen(false);
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to post production run.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (executableRequests.length === 0) {
    return (
      <Card title="Production Execution">
        <p className="text-sm text-slate-500 py-6 text-center">
          No active or pending production requests available for execution right now.
        </p>
      </Card>
    );
  }

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

      {/* Section 1: Production Plan */}
      <Card
        title="1. Production Plan"
        subtitle="Select a scheduled production request. Starting a run records execution start without touching stock."
        action={
          draftSavedAt && (
            <span className="text-[11px] text-slate-500">
              Draft saved at {new Date(draftSavedAt).toLocaleTimeString()}
            </span>
          )
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Production Request
            </label>
            <select
              value={selectedRequestId}
              onChange={(e) => setSelectedRequestId(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            >
              {executableRequests.map((req) => (
                <option key={req.id} value={req.id}>
                  {req.requestNumber} · {req.productName} ({req.requestedQuantity} {req.unit}) —{' '}
                  {req.status.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {selectedRequest && (
            <div className="md:col-span-7 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
              <div>
                <p className="text-slate-500">Order & Customer</p>
                <p className="font-semibold text-slate-900">
                  {selectedRequest.orderNumber} · {selectedRequest.customerName || 'Customer'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Planned Qty · BOM</p>
                <p className="font-semibold text-slate-900">
                  {selectedRequest.requestedQuantity} {selectedRequest.unit} ·{' '}
                  {selectedRequest.bomVersion || 'v1.0'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ProductionStatusBadge status={selectedRequest.status} />
                {selectedRequest.status !== 'IN_PROGRESS' && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleStartRun()}
                    className="inline-flex items-center gap-1 rounded bg-blue-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" />
                    Start Production
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Section 2: Actual Material Consumption */}
      {selectedRequest && (
        <Card
          title="2. Actual Material Consumption"
          subtitle="Record actual raw & packaging materials used, additional extra consumption, damaged packs, and compare against BOM standard."
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">Material</th>
                  <th className="px-3 py-2.5 text-right font-semibold">BOM Std</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Available</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Actual Used</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Additional</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Damaged</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Wastage</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Variance vs Std</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {lines.map((ln, idx) => {
                  const totalUsed =
                    Number(ln.actualConsumedQuantity || 0) +
                    Number(ln.additionalConsumedQuantity || 0);
                  const variance = Number((totalUsed - ln.plannedQuantity).toFixed(3));
                  const exceedsStock = totalUsed > ln.availableStock;
                  return (
                    <tr key={ln.materialId} className={exceedsStock ? 'bg-rose-50/50' : ''}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{ln.materialName}</p>
                        <p className="text-[11px] text-slate-500">
                          {ln.materialCode} · {ln.unit}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">
                        {ln.plannedQuantity}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          exceedsStock ? 'text-rose-700' : 'text-slate-700'
                        }`}
                      >
                        {ln.availableStock}
                        {exceedsStock && <span className="block text-[10px]">Insufficient</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={ln.actualConsumedQuantity}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value));
                            setLines((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, actualConsumedQuantity: val } : row
                              )
                            );
                          }}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={ln.additionalConsumedQuantity}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value));
                            setLines((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, additionalConsumedQuantity: val } : row
                              )
                            );
                          }}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={ln.damagedQuantity}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value));
                            setLines((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, damagedQuantity: val } : row
                              )
                            );
                          }}
                          className="w-18 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={ln.wastageQuantity}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value));
                            setLines((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, wastageQuantity: val } : row
                              )
                            );
                          }}
                          className="w-18 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          variance > 0
                            ? 'text-amber-700'
                            : variance < 0
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {variance > 0 ? `+${variance}` : variance} {ln.unit}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          placeholder="Reason if varied..."
                          value={ln.reason}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLines((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, reason: val } : row))
                            );
                          }}
                          className="w-36 rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Section 3: Production Output & Completion */}
      {selectedRequest && (
        <Card
          title="3. Production Output, Quality & Posting"
          subtitle="Only Good Finished Output is added to Finished Goods inventory. Rejected/damaged output is audited separately."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Good Output ({selectedRequest.unit}) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={goodOutputQty}
                onChange={(e) => setGoodOutputQty(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Rejected / Damaged FG ({selectedRequest.unit})
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={rejectedQty}
                onChange={(e) => setRejectedQty(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-rose-700 font-medium"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Damaged Packaging (units)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={damagedPkgQty}
                onChange={(e) => setDamagedPkgQty(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Process Wastage ({selectedRequest.unit})
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={wastageQty}
                onChange={(e) => setWastageQty(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Quality Result</label>
              <select
                value={qualityResult}
                onChange={(e) =>
                  setQualityResult(e.target.value as 'PASSED' | 'CONDITIONAL' | 'FAILED')
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="PASSED">PASSED</option>
                <option value="CONDITIONAL">CONDITIONAL</option>
                <option value="FAILED">FAILED</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Completion Status</label>
              <select
                value={completionStatus}
                onChange={(e) =>
                  setCompletionStatus(e.target.value as 'COMPLETED' | 'PARTIALLY_COMPLETED')
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="COMPLETED">COMPLETED</option>
                <option value="PARTIALLY_COMPLETED">PARTIALLY COMPLETED</option>
              </select>
            </div>

            <div className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2 flex items-center justify-between">
              <div>
                <p className="text-slate-500">Yield Percentage</p>
                <p className="text-sm font-semibold text-slate-900">{yieldPercent}%</p>
              </div>
              <div>
                <p className="text-slate-500">Output Variance vs Planned</p>
                <p
                  className={`text-sm font-semibold ${
                    outputVariance < 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {outputVariance > 0 ? `+${outputVariance}` : outputVariance}{' '}
                  {selectedRequest.unit}
                </p>
              </div>
              <ToneBadge tone={anyNegativeStockRisk ? 'red' : 'green'}>
                {anyNegativeStockRisk ? 'Stock Insufficient' : 'Stock Validated'}
              </ToneBadge>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Production Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Shift notes, batch temperatures, machine details..."
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Variance Explanation (if actual differs from plan)
              </label>
              <textarea
                rows={2}
                value={varianceExplanation}
                onChange={(e) => setVarianceExplanation(e.target.value)}
                placeholder="Reason for extra oil consumption, pouch breakage, or shortfall..."
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSaveDraft()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              Save Draft (No Stock Impact)
            </button>

            <button
              type="button"
              disabled={submitting || anyNegativeStockRisk}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-4 py-2 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              Review & Post Production
            </button>
          </div>
        </Card>
      )}

      {/* Review & Confirm Modal */}
      {confirmOpen && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Confirm & Post Production Run
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Posting is atomic and permanent. Shared inventory will be updated via ledger
                  movements for {selectedRequest.requestNumber}.
                </p>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
              <p className="font-semibold text-slate-800">Stock Deductions (Raw & Packaging):</p>
              <ul className="space-y-1 text-slate-700">
                {lines.map((ln) => {
                  const total = ln.actualConsumedQuantity + ln.additionalConsumedQuantity;
                  return (
                    <li key={ln.materialId} className="flex justify-between">
                      <span>{ln.materialName}</span>
                      <span className="font-mono font-medium text-rose-700">
                        -{total} {ln.unit}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="pt-2 border-t border-slate-200 flex justify-between font-semibold text-emerald-800">
                <span>Good Finished Output Added ({selectedRequest.productName}):</span>
                <span className="font-mono">
                  +{goodOutputQty} {selectedRequest.unit}
                </span>
              </div>
              {rejectedQty > 0 && (
                <p className="text-[11px] text-rose-700">
                  Rejected units ({rejectedQty} {selectedRequest.unit}) are logged in quality
                  audit and NOT added to finished goods inventory.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Back to Edit
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleConfirmPost()}
                className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {submitting ? 'Posting...' : 'Post Production Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
