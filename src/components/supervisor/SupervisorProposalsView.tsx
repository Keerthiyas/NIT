import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, Plus, Trash2, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { InventoryItem, ProductProposal } from '../../types/orderAudit';
import { ProposalStatusBadge } from '../proposals/ProposalStatusBadge';
import { Card } from '../ui/Card';

interface SupervisorProposalsViewProps {
  inventoryItems: InventoryItem[];
  onRefresh: () => Promise<void>;
}

interface DraftBomRow {
  itemType: 'EXISTING_MATERIAL' | 'NEW_MATERIAL';
  materialId: string;
  materialName: string;
  materialCategory: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL';
  unit: string;
  suggestedReorderLevel: string;
  quantityPerUnit: string;
  notes: string;
}

export function SupervisorProposalsView({
  inventoryItems,
  onRefresh,
}: SupervisorProposalsViewProps) {
  const [proposals, setProposals] = useState<ProductProposal[]>([]);
  const [selected, setSelected] = useState<ProductProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New proposal modal
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPackSize, setNewPackSize] = useState('');
  const [newUnit, setNewUnit] = useState('packets');
  const [newCategory, setNewCategory] = useState('Sweets & Snacks');
  const [newDescription, setNewDescription] = useState('');

  // Technical & BOM verification form for selected proposal
  const [pName, setPName] = useState('');
  const [pPack, setPPack] = useState('');
  const [pUnit, setPUnit] = useState('packets');
  const [pCategory, setPCategory] = useState('Snacks & Savouries');
  const [feasibility, setFeasibility] = useState<'FEASIBLE' | 'REQUIRES_EQUIPMENT' | 'NOT_FEASIBLE'>('FEASIBLE');
  const [expectedYield, setExpectedYield] = useState('95');
  const [instructions, setInstructions] = useState('');
  const [remarks, setRemarks] = useState('');
  const [bomRows, setBomRows] = useState<DraftBomRow[]>([]);

  const activeMaterials = inventoryItems.filter(
    (i) => (i.category === 'RAW_MATERIAL' || i.category === 'PACKAGING_MATERIAL') && i.isActive
  );

  const loadProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await orderAuditService.listProductProposals();
      setProposals(list);
      if (selected) {
        const refreshed = list.find((p) => p.id === selected.id) ?? null;
        if (refreshed) hydrateForm(refreshed);
      } else if (list.length > 0) {
        hydrateForm(list[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load product proposals.');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hydrateForm = (p: ProductProposal) => {
    setSelected(p);
    setPName(p.productName);
    setPPack(p.packSize);
    setPUnit(p.unit);
    setPCategory(p.productCategory);
    setFeasibility(p.productionFeasibility || 'FEASIBLE');
    setExpectedYield(String(p.expectedYieldPercent || 95));
    setInstructions(p.productionInstructions || '');
    setRemarks(p.productionRemarks || '');
    setBomRows(
      p.bomItems.map((b) => ({
        itemType: b.itemType,
        materialId: b.materialId || '',
        materialName: b.materialName,
        materialCategory: b.materialCategory,
        unit: b.unit,
        suggestedReorderLevel: String(b.suggestedReorderLevel || 20),
        quantityPerUnit: String(b.quantityPerUnit),
        notes: b.notes || '',
      }))
    );
  };

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
        productCategory: newCategory,
        description: newDescription,
        submitForProductionVerification: true,
      });
      setNewOpen(false);
      setNewName('');
      setNewPackSize('');
      setNewDescription('');
      setNotice(`Proposal ${created.proposalNumber} created. Complete recipe & BOM details to verify.`);
      await loadProposals();
      hydrateForm(created);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create proposal.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveOrVerify = async (verify: boolean) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await orderAuditService.verifyProductProposalProduction(selected.id, {
        productName: pName,
        packSize: pPack,
        unit: pUnit,
        productCategory: pCategory,
        productionFeasibility: feasibility,
        expectedYieldPercent: Number(expectedYield || 95),
        productionInstructions: instructions,
        productionRemarks: remarks,
        bomItems: bomRows.map((b) => ({
          itemType: b.itemType,
          materialId: b.itemType === 'EXISTING_MATERIAL' ? b.materialId : undefined,
          materialName: b.itemType === 'NEW_MATERIAL' ? b.materialName : undefined,
          materialCategory: b.itemType === 'NEW_MATERIAL' ? b.materialCategory : undefined,
          unit: b.itemType === 'NEW_MATERIAL' ? b.unit : undefined,
          suggestedReorderLevel:
            b.itemType === 'NEW_MATERIAL' ? Number(b.suggestedReorderLevel || 0) : undefined,
          quantityPerUnit: Number(b.quantityPerUnit),
          notes: b.notes || undefined,
        })),
        verify,
      });
      hydrateForm(updated);
      setNotice(
        verify
          ? `${updated.proposalNumber} technically verified and routed to Accountant for HSN/GST & costing.`
          : `${updated.proposalNumber} technical draft saved.`
      );
      await loadProposals();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit technical verification.');
    } finally {
      setBusy(false);
    }
  };

  const canEditSelected = Boolean(
    selected &&
      selected.productionVerificationStatus !== 'VERIFIED' &&
      (selected.status === 'DRAFT' ||
        selected.status === 'PENDING_PRODUCTION_VERIFICATION' ||
        (selected.status === 'RETURNED_FOR_CORRECTION' &&
          (selected.returnedToStage === 'PRODUCTION' ||
            selected.returnedToStage === 'INITIATOR')))
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
        {/* Left: Product Proposals Queue */}
        <div className="xl:col-span-5">
          <Card
            title="New Product Proposals"
            subtitle="Submit new products or verify technical feasibility & BOM"
            noPadding
            action={
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="inline-flex items-center gap-1 rounded bg-blue-950 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-900 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                New Product Proposal
              </button>
            }
          >
            {loading && proposals.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">Loading proposals...</div>
            ) : proposals.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No product proposals yet. Click &ldquo;New Product Proposal&rdquo; to initiate one.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {proposals.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => hydrateForm(p)}
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
                      Initiated by {p.initiatedByName} · BOM: {p.bomItems.length} item(s)
                    </p>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right: Technical Verification & BOM Builder */}
        <div className="xl:col-span-7">
          {selected ? (
            <Card
              title={`${selected.proposalNumber} · ${selected.productName}`}
              subtitle={`Initiated by ${selected.initiatedByName} · Production Verification: ${selected.productionVerificationStatus}`}
              action={<ProposalStatusBadge status={selected.status} />}
            >
              <div className="space-y-4 text-xs">
                {selected.status === 'RETURNED_FOR_CORRECTION' && selected.returnedReason && (
                  <div className="rounded border border-rose-200 bg-rose-50 p-3 text-rose-900">
                    <strong>Returned for Correction ({selected.returnedByName}):</strong>{' '}
                    {selected.returnedReason}
                  </div>
                )}

                {!canEditSelected && (
                  <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                    <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span>
                      Production technical details &amp; BOM are locked ({selected.status}).
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Product Name</label>
                    <input
                      disabled={!canEditSelected}
                      value={pName}
                      onChange={(e) => setPName(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Pack Size</label>
                    <input
                      disabled={!canEditSelected}
                      value={pPack}
                      onChange={(e) => setPPack(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Unit</label>
                    <input
                      disabled={!canEditSelected}
                      value={pUnit}
                      onChange={(e) => setPUnit(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Category</label>
                    <input
                      disabled={!canEditSelected}
                      value={pCategory}
                      onChange={(e) => setPCategory(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Feasibility</label>
                    <select
                      disabled={!canEditSelected}
                      value={feasibility}
                      onChange={(e) =>
                        setFeasibility(
                          e.target.value as 'FEASIBLE' | 'REQUIRES_EQUIPMENT' | 'NOT_FEASIBLE'
                        )
                      }
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    >
                      <option value="FEASIBLE">Feasible</option>
                      <option value="REQUIRES_EQUIPMENT">Requires Setup</option>
                      <option value="NOT_FEASIBLE">Not Feasible</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Expected Yield (%)
                    </label>
                    <input
                      disabled={!canEditSelected}
                      type="number"
                      min="1"
                      max="100"
                      step="0.5"
                      value={expectedYield}
                      onChange={(e) => setExpectedYield(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                </div>

                {/* BOM Entry Section */}
                <div className="border-t border-slate-200 pt-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-slate-800">
                        Verified Recipe &amp; Packaging BOM (per 1 {pUnit || 'unit'})
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Select existing materials or declare missing materials for Admin registration after Owner approval.
                      </p>
                    </div>
                    {canEditSelected && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setBomRows([
                              ...bomRows,
                              {
                                itemType: 'EXISTING_MATERIAL',
                                materialId: activeMaterials[0]?.id ?? '',
                                materialName: '',
                                materialCategory: 'RAW_MATERIAL',
                                unit: activeMaterials[0]?.unit ?? 'kg',
                                suggestedReorderLevel: '20',
                                quantityPerUnit: '0.1',
                                notes: '',
                              },
                            ])
                          }
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-50"
                        >
                          <Plus className="h-3 w-3" />
                          Existing Material
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setBomRows([
                              ...bomRows,
                              {
                                itemType: 'NEW_MATERIAL',
                                materialId: '',
                                materialName: '',
                                materialCategory: 'RAW_MATERIAL',
                                unit: 'kg',
                                suggestedReorderLevel: '20',
                                quantityPerUnit: '0.1',
                                notes: '',
                              },
                            ])
                          }
                          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                        >
                          <Plus className="h-3 w-3" />
                          Missing New Material
                        </button>
                      </div>
                    )}
                  </div>

                  {bomRows.length === 0 ? (
                    <p className="text-slate-400">No BOM materials added yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {bomRows.map((row, idx) => (
                        <div
                          key={idx}
                          className="rounded border border-slate-200 bg-slate-50/70 p-2.5 flex flex-wrap items-center gap-2"
                        >
                          {row.itemType === 'EXISTING_MATERIAL' ? (
                            <select
                              disabled={!canEditSelected}
                              value={row.materialId}
                              onChange={(e) => {
                                const next = [...bomRows];
                                const m = activeMaterials.find((x) => x.id === e.target.value);
                                next[idx] = {
                                  ...next[idx],
                                  materialId: e.target.value,
                                  unit: m?.unit ?? next[idx].unit,
                                };
                                setBomRows(next);
                              }}
                              className="flex-1 min-w-[200px] rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                            >
                              {activeMaterials.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({m.sku} · {m.category === 'PACKAGING_MATERIAL' ? 'Pkg' : 'Raw'} · {m.unit})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                                NEW
                              </span>
                              <input
                                disabled={!canEditSelected}
                                placeholder="Material name"
                                value={row.materialName}
                                onChange={(e) => {
                                  const next = [...bomRows];
                                  next[idx] = { ...next[idx], materialName: e.target.value };
                                  setBomRows(next);
                                }}
                                className="flex-1 min-w-[140px] rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                              />
                              <select
                                disabled={!canEditSelected}
                                value={row.materialCategory}
                                onChange={(e) => {
                                  const next = [...bomRows];
                                  next[idx] = {
                                    ...next[idx],
                                    materialCategory: e.target.value as
                                      | 'RAW_MATERIAL'
                                      | 'PACKAGING_MATERIAL',
                                  };
                                  setBomRows(next);
                                }}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                              >
                                <option value="RAW_MATERIAL">Raw Material</option>
                                <option value="PACKAGING_MATERIAL">Packaging</option>
                              </select>
                              <input
                                disabled={!canEditSelected}
                                placeholder="Unit"
                                value={row.unit}
                                onChange={(e) => {
                                  const next = [...bomRows];
                                  next[idx] = { ...next[idx], unit: e.target.value };
                                  setBomRows(next);
                                }}
                                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                              />
                            </>
                          )}
                          <input
                            disabled={!canEditSelected}
                            type="number"
                            step="0.0001"
                            min="0.0001"
                            placeholder="Qty / unit"
                            value={row.quantityPerUnit}
                            onChange={(e) => {
                              const next = [...bomRows];
                              next[idx] = { ...next[idx], quantityPerUnit: e.target.value };
                              setBomRows(next);
                            }}
                            className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right"
                          />
                          {canEditSelected && (
                            <button
                              type="button"
                              onClick={() => setBomRows(bomRows.filter((_, i) => i !== idx))}
                              className="rounded p-1 text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Production Instructions
                    </label>
                    <textarea
                      disabled={!canEditSelected}
                      rows={2}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="Cooking temperature, syrup brix, sealing QC..."
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Verification Remarks
                    </label>
                    <textarea
                      disabled={!canEditSelected}
                      rows={2}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Technical feasibility summary for Accountant & Owner..."
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                </div>

                {canEditSelected && (
                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveOrVerify(false)}
                      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Save Technical Draft
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveOrVerify(true)}
                      className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verify Technical &amp; Route to Accountant
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="py-10 text-center text-xs text-slate-500">
                Select a product proposal on the left or initiate a new one.
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Modal: Propose New Product */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleCreateProposal(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Submit New Product Proposal
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
                <label className="block font-medium text-slate-700 mb-1">Proposed Product Name</label>
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
                  <label className="block font-medium text-slate-700 mb-1">Proposed Pack Size</label>
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
                    placeholder="packets"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Category</label>
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Traditional milk-solid gulab jamun in sealed syrup pack..."
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-blue-950 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Create Proposal
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
