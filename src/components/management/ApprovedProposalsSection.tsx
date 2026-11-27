import { useRef, useState } from 'react';
import { CheckCircle2, RotateCcw, Upload, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { ProductProposal } from '../../types/orderAudit';
import { ProposalStatusBadge } from '../proposals/ProposalStatusBadge';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { ProductImage } from '../ui/ProductImage';

interface ApprovedProposalsSectionProps {
  proposals: ProductProposal[];
  onRefresh: () => Promise<void>;
  onBanner: (msg: string) => void;
  onError: (msg: string) => void;
}

export function ApprovedProposalsSection({
  proposals,
  onRefresh,
  onBanner,
  onError,
}: ApprovedProposalsSectionProps) {
  const [selected, setSelected] = useState<ProductProposal | null>(null);
  const [sku, setSku] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [activateImmediately, setActivateImmediately] = useState(true);
  const [materialSkus, setMaterialSkus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [corrTarget, setCorrTarget] = useState<'PRODUCTION' | 'ACCOUNTANT' | 'OWNER'>('PRODUCTION');
  const [corrRemarks, setCorrRemarks] = useState('');

  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const pendingRegistration = proposals.filter(
    (p) => p.status === 'APPROVED_PENDING_REGISTRATION'
  );
  const registeredHistory = proposals.filter(
    (p) => p.status === 'CATALOGUE_REGISTERED' || p.status === 'ACTIVE'
  );

  const openRegistrationModal = (p: ProductProposal) => {
    setSelected(p);
    setSku('');
    setImageUrl('');
    setActivateImmediately(true);
    setMaterialSkus({});
    setCorrectionOpen(false);
    setCorrRemarks('');
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageUploading(true);
    onError('');
    try {
      const uploaded = await orderAuditService.uploadProductImage(file);
      setImageUrl(uploaded.imageUrl);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload product image.');
    } finally {
      setImageUploading(false);
    }
  };

  const handleRegisterMaterial = async (bomLineId: string) => {
    if (!selected) return;
    const matSku = (materialSkus[bomLineId] ?? '').trim();
    if (!matSku) {
      onError('Enter a unique Material SKU before registering.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      const updated = await orderAuditService.registerMissingMaterialFromProposal(
        selected.id,
        bomLineId,
        matSku
      );
      setSelected(updated);
      onBanner(`Verified material registered with SKU ${matSku} and 0 initial stock.`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to register missing material.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    onError('');
    try {
      const updated = await orderAuditService.registerProductFromProposal(selected.id, {
        sku,
        imageUrl,
        activateImmediately,
      });
      setSelected(null);
      onBanner(
        `Product ${updated.productName} (${updated.registeredSku}) registered from ${updated.proposalNumber} with 0 stock${
          activateImmediately ? ' and activated for ordering' : ''
        }.`
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to register product.');
    } finally {
      setBusy(false);
    }
  };

  const handleRaiseCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    onError('');
    try {
      const updated = await orderAuditService.raiseAdminProposalCorrection(selected.id, {
        targetDepartment: corrTarget,
        remarks: corrRemarks,
      });
      setSelected(null);
      onBanner(
        `${updated.proposalNumber} returned to ${corrTarget} for verification correction.`
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to submit correction request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        title="Approved - Pending Catalogue Registration"
        subtitle="Owner-approved products verified by Production & Accountant. Admin assigns SKU/image and registers exact approved specifications."
        noPadding
      >
        {pendingRegistration.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No Owner-approved product proposals are pending catalogue registration.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Proposal ID</th>
                  <th className="px-4 py-2.5 font-medium">Product Name</th>
                  <th className="px-4 py-2.5 font-medium">Approved By &amp; Date</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price / Reorder</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingRegistration.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-mono font-semibold text-blue-900">
                      {p.proposalNumber}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {p.productName} ({p.packSize})
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {p.approvedByName || 'Owner'} · {p.approvedAt?.slice(0, 10) || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">
                      ₹{p.approvedSellingPrice.toFixed(2)} · Min {p.approvedReorderLevel} {p.unit}
                    </td>
                    <td className="px-4 py-2.5">
                      <ProposalStatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openRegistrationModal(p)}
                        className="rounded bg-blue-950 px-3 py-1 font-semibold text-white hover:bg-blue-900 cursor-pointer"
                      >
                        Register Product
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {registeredHistory.length > 0 && (
        <Card title="Registered Proposal History" noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Proposal ID</th>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium">Owner Approval</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registeredHistory.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-mono text-slate-700">{p.proposalNumber}</td>
                    <td className="px-4 py-2 font-mono font-semibold text-slate-900">
                      {p.registeredSku}
                    </td>
                    <td className="px-4 py-2 text-slate-800">{p.productName}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {p.approvedByName} ({p.approvedAt?.slice(0, 10)})
                    </td>
                    <td className="px-4 py-2">
                      <ProposalStatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Structured Read-Only Registration Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Register Approved Product — {selected.proposalNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Owner Approved by {selected.approvedByName} ({selected.approvedAt?.slice(0, 10)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {correctionOpen ? (
              <form onSubmit={(e) => void handleRaiseCorrection(e)} className="p-5 space-y-3 text-xs">
                <p className="font-semibold text-slate-900">
                  Raise Correction Request to Responsible Department
                </p>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Responsible Department
                  </label>
                  <select
                    value={corrTarget}
                    onChange={(e) =>
                      setCorrTarget(e.target.value as 'PRODUCTION' | 'ACCOUNTANT' | 'OWNER')
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  >
                    <option value="PRODUCTION">Production Supervisor (Recipe / BOM / Pack Specs)</option>
                    <option value="ACCOUNTANT">Accountant (GST Rate / HSN Code / Costing)</option>
                    <option value="OWNER">Owner (Selling Price / Reorder Level / Launch Decision)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Issue Description <span className="text-rose-600">*</span>
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={corrRemarks}
                    onChange={(e) => setCorrRemarks(e.target.value)}
                    placeholder="Specify what approved detail needs correction..."
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCorrectionOpen(false)}
                    className="rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-rose-700 px-3.5 py-1.5 font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
                  >
                    Send Back for Correction
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={(e) => void handleRegisterProduct(e)} className="p-5 space-y-4 text-xs max-h-[78vh] overflow-y-auto">
                {/* Verified Read-Only Specifications */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3.5">
                  <div className="col-span-2">
                    <p className="text-[11px] text-slate-500">Approved Product Name (Read-Only)</p>
                    <p className="font-semibold text-slate-900">{selected.productName}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Pack Size / Unit</p>
                    <p className="font-medium text-slate-800">
                      {selected.packSize} ({selected.unit})
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Owner Selling Price</p>
                    <p className="font-semibold text-slate-900 tabular-nums">
                      ₹{selected.approvedSellingPrice.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Accountant HSN / GST</p>
                    <p className="font-medium text-slate-900">
                      {selected.hsnCode} · {selected.gstRate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500">Owner Reorder Level</p>
                    <p className="font-medium text-slate-900 tabular-nums">
                      {selected.approvedReorderLevel} {selected.unit}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[11px] text-slate-500">Verifiers</p>
                    <p className="text-slate-700">
                      Prod: {selected.productionVerifiedByName} · Acct: {selected.accountantVerifiedByName}
                    </p>
                  </div>
                </div>

                {/* Missing New Materials Registration (if any) */}
                {selected.bomItems.some((b) => b.itemType === 'NEW_MATERIAL') && (
                  <div className="rounded border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                    <p className="font-semibold text-amber-900">
                      Missing Materials Required Before Product Registration
                    </p>
                    {selected.bomItems
                      .filter((b) => b.itemType === 'NEW_MATERIAL')
                      .map((b) => (
                        <div
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white px-3 py-2"
                        >
                          <div>
                            <span className="font-medium text-slate-900">{b.materialName}</span>{' '}
                            <span className="text-slate-500">
                              ({b.materialCategory}, {b.unit}, Reorder {b.suggestedReorderLevel})
                            </span>
                          </div>
                          {b.createdMaterialId ? (
                            <ToneBadge tone="success">
                              Registered ({b.materialSku})
                            </ToneBadge>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <input
                                placeholder="Assign SKU (e.g. RM-205)"
                                value={materialSkus[b.id] ?? ''}
                                onChange={(e) =>
                                  setMaterialSkus({ ...materialSkus, [b.id]: e.target.value })
                                }
                                className="w-36 rounded border border-slate-300 px-2 py-1 text-xs"
                              />
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleRegisterMaterial(b.id)}
                                className="rounded bg-amber-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                              >
                                Register (0 Stock)
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}

                {/* Read-Only Verified BOM Preview */}
                <div>
                  <p className="font-semibold text-slate-800 mb-1.5">
                    Official Verified BOM (per 1 {selected.unit})
                  </p>
                  <div className="rounded border border-slate-200 divide-y divide-slate-100">
                    {selected.bomItems.map((b) => (
                      <div key={b.id} className="flex items-center justify-between px-3 py-1.5">
                        <span className="text-slate-800">
                          {b.materialName}{' '}
                          <span className="text-slate-400 font-mono">
                            {b.materialSku ? `(${b.materialSku})` : '(pending SKU)'}
                          </span>
                        </span>
                        <span className="font-medium tabular-nums">
                          {b.quantityPerUnit} {b.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Admin Entry: Unique SKU + Product Image */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Assign Unique Product SKU <span className="text-rose-600">*</span>
                    </label>
                    <input
                      required
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      placeholder="NITT-GLB-250"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div className="flex items-end pb-1.5">
                    <label className="inline-flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activateImmediately}
                        onChange={(e) => setActivateImmediately(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      Activate product in Salesman catalogue immediately
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-4 rounded border border-slate-200 bg-slate-50/70 p-3">
                  <ProductImage
                    src={imageUrl || undefined}
                    alt={selected.productName}
                    size="md"
                  />
                  <div className="space-y-1.5">
                    <p className="font-semibold text-slate-800">Product Image (Admin Upload)</p>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      onChange={(e) => void handleImageFileSelect(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={imageUploading}
                      onClick={() => imageInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {imageUploading ? 'Uploading...' : imageUrl ? 'Replace Image' : 'Upload Image'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                  <button
                    type="button"
                    onClick={() => setCorrectionOpen(true)}
                    className="inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Raise Correction Request
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded bg-blue-950 px-4 py-1.5 font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {busy ? 'Registering...' : 'Register Product (0 Stock)'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
