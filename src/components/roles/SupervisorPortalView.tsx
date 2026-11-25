import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Factory, LogOut, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { AuthUser, ProductionRequest, ProductionRun } from '../../types/orderAudit';
import { Card } from '../ui/Card';
import { ProductionStatusBadge } from '../ui/Badge';

export function SupervisorPortalView({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  const [requests, setRequests] = useState<ProductionRequest[]>([]);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [postingReq, setPostingReq] = useState<ProductionRequest | null>(null);
  const [actualOutput, setActualOutput] = useState('');
  const [wastageQty, setWastageQty] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqs, pruns] = await Promise.all([
        orderAuditService.listProductionRequests(),
        orderAuditService.listProductionRuns(),
      ]);
      setRequests(reqs);
      setRuns(pruns);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supervisor workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleStatusChange = async (
    reqId: string,
    status: 'READY_FOR_PRODUCTION' | 'IN_PROGRESS' | 'CANCELLED'
  ) => {
    setError(null);
    try {
      await orderAuditService.updateProductionRequestStatus(reqId, status);
      setBanner(`Production request updated to ${status}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update status.');
    }
  };

  const handlePostRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postingReq) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await orderAuditService.postProductionRun({
        productionRequestId: postingReq.id,
        actualOutputQuantity: Number(actualOutput),
        wastageQuantity: Number(wastageQty || 0),
        notes,
      });
      setPostingReq(null);
      setBanner(
        `Production run ${res.runNumber} posted. Raw/packaging materials deducted and finished-goods stock credited.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post production run.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-900">
            NIT Trichy Order-to-Audit • Production Supervisor
          </p>
          <h1 className="text-base font-semibold text-slate-900">
            Production Execution &amp; Run Posting
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-600">
            Signed in as <strong>{user.fullName}</strong>
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-5">
        {banner && (
          <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading production requests...
          </div>
        ) : (
          <>
            <Card
              title="Shared Production Requests"
              subtitle="Posting a production run consumes BOM raw/packaging materials and credits finished goods in shared inventory"
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Request #</th>
                      <th className="px-4 py-2.5">Order #</th>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">Planned Qty</th>
                      <th className="px-4 py-2.5">Materials</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Supervisor Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requests.map((req) => (
                      <tr key={req.id}>
                        <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                          {req.requestNumber}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-700">
                          {req.orderNumber}
                        </td>
                        <td className="px-4 py-2.5 text-slate-800">{req.productName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                          {req.requestedQuantity} {req.unit}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span
                            className={
                              req.rawMaterialAvailability === 'SUFFICIENT'
                                ? 'text-emerald-700 font-medium'
                                : 'text-rose-700 font-medium'
                            }
                          >
                            {req.rawMaterialAvailability}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <ProductionStatusBadge status={req.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                          {req.status !== 'COMPLETED' && req.status !== 'CANCELLED' && (
                            <>
                              {req.status !== 'IN_PROGRESS' && (
                                <button
                                  type="button"
                                  onClick={() => void handleStatusChange(req.id, 'IN_PROGRESS')}
                                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Start Run
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setPostingReq(req);
                                  setActualOutput(String(req.requestedQuantity));
                                  setWastageQty('0');
                                  setNotes('');
                                }}
                                className="inline-flex items-center gap-1 rounded bg-blue-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-900"
                              >
                                <Factory className="h-3 w-3" />
                                Post Production Run
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Posted Production Runs" noPadding>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Run #</th>
                      <th className="px-4 py-2.5">Request #</th>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">Planned</th>
                      <th className="px-4 py-2.5 text-right">Actual Output</th>
                      <th className="px-4 py-2.5 text-right">Wastage</th>
                      <th className="px-4 py-2.5">Posted At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 font-medium text-blue-900">{r.runNumber}</td>
                        <td className="px-4 py-2.5">{r.requestNumber}</td>
                        <td className="px-4 py-2.5">{r.productName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.plannedQuantity}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{r.actualOutputQuantity}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.wastageQuantity}</td>
                        <td className="px-4 py-2.5 text-slate-500">{new Date(r.postedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </main>

      {postingReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handlePostRun(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Post Production Run — {postingReq.requestNumber}
              </h3>
              <button
                type="button"
                onClick={() => setPostingReq(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">
                Product: <strong>{postingReq.productName}</strong> • Planned:{' '}
                <strong>{postingReq.requestedQuantity} {postingReq.unit}</strong>
              </p>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Actual Output ({postingReq.unit})
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={actualOutput}
                  onChange={(e) => setActualOutput(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Wastage ({postingReq.unit})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={wastageQty}
                  onChange={(e) => setWastageQty(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Batch remarks or QC variance note"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setPostingReq(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1 rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Post &amp; Update Stock
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

