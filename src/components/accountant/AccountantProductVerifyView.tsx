import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { ProductProposal } from '../../types/orderAudit';
import { ProposalStatusBadge } from '../proposals/ProposalStatusBadge';
import { Card } from '../ui/Card';

export function AccountantProductVerifyView() {
  const [proposals, setProposals] = useState<ProductProposal[]>([]);
  const [selected, setSelected] = useState<ProductProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [hsnCode, setHsnCode] = useState('21069099');
  const [gstRate, setGstRate] = useState('5');
  const [taxClass, setTaxClass] = useState('GST 5% Prepared Food');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [costingNotes, setCostingNotes] = useState('');
  const [remarks, setRemarks] = useState('');

  const hydrate = (p: ProductProposal) => {
    setSelected(p);
    setHsnCode(p.hsnCode || '');
    setGstRate(String(p.gstRate ?? 5));
    setTaxClass(p.taxClassification || '');
    setEstimatedCost(p.estimatedCost ? String(p.estimatedCost) : '');
    setCostingNotes(p.costingNotes || '');
    setRemarks(p.accountantRemarks || '');
  };

  const loadProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await orderAuditService.listProductProposals();
      setProposals(list);
      if (selected) {
        const match = list.find((p) => p.id === selected.id) ?? null;
        if (match) hydrate(match);
      } else {
        const firstPending =
          list.find((p) => p.status === 'PENDING_ACCOUNTANT_VERIFICATION') ?? list[0] ?? null;
        if (firstPending) hydrate(firstPending);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proposals.');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const handleSubmit = async (decision: 'VERIFY' | 'RETURN') => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await orderAuditService.verifyProductProposalAccountant(selected.id, {
        decision,
        hsnCode,
        gstRate: Number(gstRate),
        taxClassification: taxClass,
        estimatedCost: Number(estimatedCost || 0),
        costingNotes,
        remarks,
      });
      hydrate(updated);
      setNotice(
        decision === 'VERIFY'
          ? `${updated.proposalNumber} tax & costing verified and routed to Owner for launch approval.`
          : `${updated.proposalNumber} returned to Production Supervisor for correction.`
      );
      await loadProposals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit verification.');
    } finally {
      setBusy(false);
    }
  };

  const canVerify = Boolean(
    selected &&
      selected.productionVerificationStatus === 'VERIFIED' &&
      (selected.status === 'PENDING_ACCOUNTANT_VERIFICATION' ||
        (selected.status === 'RETURNED_FOR_CORRECTION' &&
          selected.returnedToStage === 'ACCOUNTANT'))
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5">
          <Card
            title="Product Tax & Costing Queue"
            subtitle="Proposals verified by Production Supervisor awaiting HSN, GST & costing review"
            noPadding
          >
            {loading && proposals.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">Loading proposals...</div>
            ) : proposals.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No product proposals submitted yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {proposals.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => hydrate(p)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer ${
                      selected?.id === p.id ? 'bg-blue-50/70' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-semibold text-blue-900">
                        {p.proposalNumber}
                      </span>
                      <ProposalStatusBadge status={p.status} />
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {p.productName} ({p.packSize})
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Production: {p.productionVerificationStatus} · Accountant:{' '}
                      {p.accountantVerificationStatus}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="xl:col-span-7">
          {selected ? (
            <Card
              title={`${selected.proposalNumber} · ${selected.productName}`}
              subtitle={`Pack: ${selected.packSize} (${selected.unit}) · Verified by ${
                selected.productionVerifiedByName || 'Pending Production'
              }`}
              action={<ProposalStatusBadge status={selected.status} />}
            >
              <div className="space-y-4 text-xs">
                {/* Read-only Production BOM Summary */}
                <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                  <p className="font-semibold text-slate-800">
                    Production-Verified BOM (Read-Only) · Yield {selected.expectedYieldPercent}%
                  </p>
                  <ul className="space-y-0.5 text-slate-600">
                    {selected.bomItems.map((b) => (
                      <li key={b.id}>
                        • {b.materialName} ({b.materialCategory === 'PACKAGING_MATERIAL' ? 'Pkg' : 'Raw'}):{' '}
                        <strong>
                          {b.quantityPerUnit} {b.unit}
                        </strong>{' '}
                        {b.itemType === 'NEW_MATERIAL' ? '(New material requirement)' : ''}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Accountant HSN / GST / Costing Form */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">HSN Code</label>
                    <input
                      disabled={!canVerify}
                      value={hsnCode}
                      onChange={(e) => setHsnCode(e.target.value)}
                      placeholder="e.g., 21069099"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Applicable GST Rate (%)
                    </label>
                    <input
                      disabled={!canVerify}
                      type="number"
                      step="0.5"
                      min="0"
                      max="28"
                      value={gstRate}
                      onChange={(e) => setGstRate(e.target.value)}
                      placeholder="e.g., 5 or 12"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Tax Classification
                    </label>
                    <input
                      disabled={!canVerify}
                      value={taxClass}
                      onChange={(e) => setTaxClass(e.target.value)}
                      placeholder="e.g., GST 5% Prepared Sweet"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Estimated Production Cost (₹ / {selected.unit})
                    </label>
                    <input
                      disabled={!canVerify}
                      type="number"
                      step="0.01"
                      min="0"
                      value={estimatedCost}
                      onChange={(e) => setEstimatedCost(e.target.value)}
                      placeholder="e.g., 42.50"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Costing Breakdown Notes
                    </label>
                    <textarea
                      disabled={!canVerify}
                      rows={2}
                      value={costingNotes}
                      onChange={(e) => setCostingNotes(e.target.value)}
                      placeholder="Raw material + packaging + overhead margin summary..."
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Verification / Return Remarks
                    </label>
                    <input
                      disabled={!canVerify}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Mandatory if returning for correction..."
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                </div>

                {canVerify && (
                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSubmit('RETURN')}
                      className="inline-flex items-center gap-1 rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Return for Correction
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSubmit('VERIFY')}
                      className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verify Tax &amp; Costing
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="py-10 text-center text-xs text-slate-500">
                Select a product proposal to verify HSN, GST, and costing.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
