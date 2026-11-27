import { useCallback, useEffect, useState } from 'react';
import { Check, Plus, RotateCcw, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { ProductProposal } from '../../types/orderAudit';
import { ProposalStatusBadge } from '../proposals/ProposalStatusBadge';
import { Card } from '../ui/Card';
import { formatInr } from './OwnerCharts';

export function OwnerProductProposalsPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [proposals, setProposals] = useState<ProductProposal[]>([]);
  const [selected, setSelected] = useState<ProductProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New Proposal modal (Owner initiates launch proposal)
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPackSize, setNewPackSize] = useState('');
  const [newUnit, setNewUnit] = useState('packets');
  const [newPrice, setNewPrice] = useState('');
  const [newReorder, setNewReorder] = useState('30');
  const [newDesc, setNewDesc] = useState('');

  // Approval decision inputs
  const [sellPrice, setSellPrice] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');
  const [remarks, setRemarks] = useState('');
  const [returnTarget, setReturnTarget] = useState<'PRODUCTION' | 'ACCOUNTANT'>('PRODUCTION');

  const hydrate = (p: ProductProposal) => {
    setSelected(p);
    setSellPrice(
      p.approvedSellingPrice > 0
        ? String(p.approvedSellingPrice)
        : p.proposedSellingPrice > 0
          ? String(p.proposedSellingPrice)
          : p.estimatedCost > 0
            ? String((p.estimatedCost * 1.35).toFixed(2))
            : ''
    );
    setReorderLevel(
      String(
        p.approvedReorderLevel > 0
          ? p.approvedReorderLevel
          : p.proposedReorderLevel > 0
            ? p.proposedReorderLevel
            : 30
      )
    );
    setRemarks('');
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
          list.find((p) => p.status === 'PENDING_OWNER_APPROVAL') ?? list[0] ?? null;
        if (firstPending) hydrate(firstPending);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load product proposals.');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await orderAuditService.createProductProposal({
        productName: newName,
        packSize: newPackSize,
        unit: newUnit,
        description: newDesc,
        proposedSellingPrice: Number(newPrice || 0),
        proposedReorderLevel: Number(newReorder || 0),
        submitForProductionVerification: true,
      });
      setNewOpen(false);
      setNewName('');
      setNewPackSize('');
      setNewPrice('');
      setNewDesc('');
      setNotice(
        `Proposal ${created.proposalNumber} submitted to Production Supervisor for recipe & BOM verification.`
      );
      await loadProposals();
      hydrate(created);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate proposal.');
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async (decision: 'APPROVE' | 'REJECT' | 'RETURN') => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await orderAuditService.submitOwnerProductDecision(selected.id, {
        decision,
        sellingPrice: decision === 'APPROVE' ? Number(sellPrice) : undefined,
        reorderLevel: decision === 'APPROVE' ? Number(reorderLevel) : undefined,
        targetStage: decision === 'RETURN' ? returnTarget : undefined,
        remarks,
      });
      hydrate(updated);
      setNotice(
        decision === 'APPROVE'
          ? `${updated.proposalNumber} approved for Admin catalogue registration (₹${updated.approvedSellingPrice.toFixed(
              2
            )}, Reorder ${updated.approvedReorderLevel}).`
          : decision === 'REJECT'
            ? `${updated.proposalNumber} rejected.`
            : `${updated.proposalNumber} returned to ${returnTarget} for correction.`
      );
      await loadProposals();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit Owner decision.');
    } finally {
      setBusy(false);
    }
  };

  const canDecide = Boolean(
    selected &&
      selected.status === 'PENDING_OWNER_APPROVAL' &&
      selected.productionVerificationStatus === 'VERIFIED' &&
      selected.accountantVerificationStatus === 'VERIFIED'
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
            title="New Product Launch Approvals"
            subtitle="Initiate new launches or approve Production + Accountant verified products"
            noPadding
            action={
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="inline-flex items-center gap-1 rounded bg-blue-950 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-900 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Propose Product
              </button>
            }
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
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 cursor-pointer ${
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
                      Prod: {p.productionVerificationStatus} · Acct: {p.accountantVerificationStatus}
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
              subtitle={`Pack: ${selected.packSize} (${selected.unit}) · Initiated by ${selected.initiatedByName}`}
              action={<ProposalStatusBadge status={selected.status} />}
            >
              <div className="space-y-4 text-xs">
                {/* Department Verification Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-1">
                    <p className="font-semibold text-slate-800">
                      Production Verification: {selected.productionVerificationStatus}
                    </p>
                    <p className="text-slate-600">
                      Feasibility: {selected.productionFeasibility || 'Pending'} · Yield:{' '}
                      {selected.expectedYieldPercent}%
                    </p>
                    {selected.productionVerifiedByName && (
                      <p className="text-slate-500">
                        Verified by {selected.productionVerifiedByName}
                      </p>
                    )}
                    {selected.productionRemarks && (
                      <p className="text-slate-600 italic">&ldquo;{selected.productionRemarks}&rdquo;</p>
                    )}
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-1">
                    <p className="font-semibold text-slate-800">
                      Accountant Verification: {selected.accountantVerificationStatus}
                    </p>
                    <p className="text-slate-600">
                      HSN: {selected.hsnCode || '—'} · GST: {selected.gstRate}% · Est Cost:{' '}
                      {formatInr(selected.estimatedCost)}
                    </p>
                    {selected.accountantVerifiedByName && (
                      <p className="text-slate-500">
                        Verified by {selected.accountantVerifiedByName}
                      </p>
                    )}
                    {selected.accountantRemarks && (
                      <p className="text-slate-600 italic">&ldquo;{selected.accountantRemarks}&rdquo;</p>
                    )}
                  </div>
                </div>

                {/* Recipe & Packaging BOM Summary */}
                <div>
                  <p className="font-semibold text-slate-800 mb-1.5">
                    Recipe &amp; Packaging BOM Summary (per 1 {selected.unit})
                  </p>
                  <div className="rounded border border-slate-200 divide-y divide-slate-100">
                    {selected.bomItems.length === 0 ? (
                      <p className="p-3 text-slate-400">BOM pending Production Supervisor entry.</p>
                    ) : (
                      selected.bomItems.map((b) => (
                        <div key={b.id} className="flex items-center justify-between px-3 py-1.5">
                          <span className="text-slate-800">
                            {b.materialName}{' '}
                            <span className="text-slate-500">
                              ({b.materialCategory === 'PACKAGING_MATERIAL' ? 'Packaging' : 'Raw'}
                              {b.itemType === 'NEW_MATERIAL' ? ' · New Material Required' : ''})
                            </span>
                          </span>
                          <span className="font-medium tabular-nums">
                            {b.quantityPerUnit} {b.unit}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Owner Business Decision Form */}
                <div className="border-t border-slate-200 pt-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Official Selling Price (₹)
                      </label>
                      <input
                        disabled={!canDecide}
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={sellPrice}
                        onChange={(e) => setSellPrice(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Official Reorder Level ({selected.unit})
                      </label>
                      <input
                        disabled={!canDecide}
                        type="number"
                        min="0"
                        value={reorderLevel}
                        onChange={(e) => setReorderLevel(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Return Target (if returning)
                      </label>
                      <select
                        disabled={!canDecide}
                        value={returnTarget}
                        onChange={(e) =>
                          setReturnTarget(e.target.value as 'PRODUCTION' | 'ACCOUNTANT')
                        }
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                      >
                        <option value="PRODUCTION">Production Supervisor</option>
                        <option value="ACCOUNTANT">Accountant</option>
                      </select>
                    </div>
                  </div>

                  {canDecide && (
                    <>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">
                          Owner Decision Remarks
                        </label>
                        <input
                          value={remarks}
                          onChange={(e) => setRemarks(e.target.value)}
                          placeholder="Approval note or mandatory reason for rejection/return..."
                          className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecision('RETURN')}
                          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Return for Correction
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecision('REJECT')}
                          className="inline-flex items-center gap-1 rounded bg-rose-700 px-3 py-1.5 font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecision('APPROVE')}
                          className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve Product Launch
                        </button>
                      </div>
                    </>
                  )}

                  {!canDecide && selected.status !== 'APPROVED_PENDING_REGISTRATION' && (
                    <p className="text-[11px] text-slate-500">
                      Owner approval is enabled once both Production Supervisor and Accountant complete verification.
                    </p>
                  )}
                </div>

                {/* Compact Audit Trail */}
                {selected.auditTrail.length > 0 && (
                  <div className="border-t border-slate-200 pt-3">
                    <p className="font-semibold text-slate-800 mb-1.5">Audit Trail</p>
                    <ul className="space-y-1 text-[11px] text-slate-600 max-h-36 overflow-y-auto">
                      {selected.auditTrail.map((a) => (
                        <li key={a.id} className="flex justify-between gap-2">
                          <span>
                            <strong>{a.action}</strong> by {a.userName} ({a.userRole})
                            {a.remarks ? ` — ${a.remarks}` : ''}
                          </span>
                          <span className="text-slate-400 whitespace-nowrap">
                            {a.timestamp.slice(0, 16).replace('T', ' ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="py-10 text-center text-xs text-slate-500">
                Select a product proposal on the left or click &ldquo;Propose Product&rdquo;.
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Modal: Owner Propose New Product */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleCreateProposal(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Initiate New Product Launch Proposal
              </h3>
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Product Name</label>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Gulab Jamun 250 g"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pack Size</label>
                  <input
                    required
                    value={newPackSize}
                    onChange={(e) => setNewPackSize(e.target.value)}
                    placeholder="250 g"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit</label>
                  <input
                    required
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Target Selling Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Target Reorder Level
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newReorder}
                    onChange={(e) => setNewReorder(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-blue-950 px-3.5 py-1.5 font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Send to Production
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
