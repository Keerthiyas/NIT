import { useMemo, useState } from 'react';
import {
  Check,
  Eye,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { InventoryItem, MaterialProposal } from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface MaterialCatalogueSectionProps {
  materials: InventoryItem[];
  proposals: MaterialProposal[];
  onRefresh: () => Promise<void>;
  onBanner: (msg: string) => void;
  onError: (msg: string) => void;
}

const COMMON_UNITS = ['kg', 'g', 'litre', 'ml', 'pcs', 'box', 'pack'];

export function MaterialCatalogueSection({
  materials,
  proposals,
  onRefresh,
  onBanner,
  onError,
}: MaterialCatalogueSectionProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'RAW_MATERIAL' | 'PACKAGING_MATERIAL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const [detailMaterial, setDetailMaterial] = useState<InventoryItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [mSku, setMSku] = useState('');
  const [mName, setMName] = useState('');
  const [mCategory, setMCategory] = useState<'RAW_MATERIAL' | 'PACKAGING_MATERIAL'>('RAW_MATERIAL');
  const [mUnit, setMUnit] = useState('kg');
  const [mReorder, setMReorder] = useState('25');
  const [mActive, setMActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [reviewModal, setReviewModal] = useState<{
    proposal: MaterialProposal;
    sku: string;
    reorderLevel: string;
    note: string;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      if (categoryFilter !== 'ALL' && m.category !== categoryFilter) return false;
      if (statusFilter === 'ACTIVE' && !m.isActive) return false;
      if (statusFilter === 'INACTIVE' && m.isActive) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.sku.toLowerCase().includes(q) ||
        m.unit.toLowerCase().includes(q)
      );
    });
  }, [materials, search, categoryFilter, statusFilter]);

  const pendingProposals = useMemo(
    () => proposals.filter((p) => p.status === 'PENDING_ADMIN_REVIEW'),
    [proposals]
  );

  const openModal = (mat?: InventoryItem) => {
    if (mat) {
      setEditingId(mat.id);
      setMSku(mat.sku);
      setMName(mat.name);
      setMCategory(
        mat.category === 'PACKAGING_MATERIAL' ? 'PACKAGING_MATERIAL' : 'RAW_MATERIAL'
      );
      setMUnit(mat.unit);
      setMReorder(String(mat.reorderLevel));
      setMActive(mat.isActive);
    } else {
      setEditingId(undefined);
      setMSku('');
      setMName('');
      setMCategory('RAW_MATERIAL');
      setMUnit('kg');
      setMReorder('25');
      setMActive(true);
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onError('');
    try {
      await orderAuditService.saveMaterial({
        id: editingId,
        sku: mSku,
        name: mName,
        category: mCategory,
        unit: mUnit,
        reorderLevel: Number(mReorder || 0),
        isActive: mActive,
      });
      setModalOpen(false);
      onBanner(
        editingId
          ? 'Material catalogue record updated (inventory stock balance unchanged).'
          : 'Material added to Material Catalogue with 0 initial stock (stock changes only via GRN/ledger transactions).'
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save material.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (mat: InventoryItem) => {
    try {
      await orderAuditService.toggleMaterialStatus(mat.id, !mat.isActive);
      onBanner(`Material ${mat.name} marked ${mat.isActive ? 'Inactive' : 'Active'}.`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update material status.');
    }
  };

  const handleDelete = async (mat: InventoryItem) => {
    try {
      await orderAuditService.deleteMaterial(mat.id);
      onBanner(`Material ${mat.name} removed from catalogue.`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Cannot delete referenced material.');
    }
  };

  const handleReviewProposal = async (decision: 'APPROVE' | 'REJECT') => {
    if (!reviewModal) return;
    setSubmitting(true);
    try {
      const res = await orderAuditService.reviewMaterialProposal(
        reviewModal.proposal.id,
        decision,
        {
          sku: reviewModal.sku,
          reorderLevel: Number(reviewModal.reorderLevel || 0),
          note: reviewModal.note,
        }
      );
      setReviewModal(null);
      onBanner(
        decision === 'APPROVE'
          ? `Proposal ${res.proposalNumber} approved and registered in Material Catalogue with 0 initial stock.`
          : `Proposal ${res.proposalNumber} rejected.`
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to review material proposal.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Supervisor Material Proposals Queue (if any pending) */}
      {pendingProposals.length > 0 && (
        <Card
          title={`Supervisor Material Proposals (${pendingProposals.length} Pending)`}
          subtitle="Production Supervisor suggested new materials awaiting Admin registration into the official Material Catalogue"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-amber-50/60 text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Proposal #</th>
                  <th className="px-4 py-2 font-medium">Material Name</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingProposals.map((prop) => (
                  <tr key={prop.id}>
                    <td className="px-4 py-2 font-mono font-semibold text-slate-800">
                      {prop.proposalNumber}
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-900">{prop.name}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {prop.category === 'PACKAGING_MATERIAL' ? 'Packaging Material' : 'Raw Material'}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{prop.unit}</td>
                    <td className="px-4 py-2 text-slate-600">{prop.reason}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setReviewModal({
                            proposal: prop,
                            sku: prop.suggestedSku || '',
                            reorderLevel: String(prop.suggestedReorderLevel),
                            note: '',
                          })
                        }
                        className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-900 hover:bg-blue-100 cursor-pointer"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Material Catalogue Main Table */}
      <Card
        title="Material Catalogue (Raw & Packaging Materials)"
        subtitle="Approved raw and packaging master list. Adding a material initializes 0 inventory stock; stock updates come only from GRN receipts or ledger transactions."
        noPadding
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search material name or SKU..."
                className="w-48 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(
                  e.target.value as 'ALL' | 'RAW_MATERIAL' | 'PACKAGING_MATERIAL'
                )
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs"
            >
              <option value="ALL">All Categories</option>
              <option value="RAW_MATERIAL">Raw Materials</option>
              <option value="PACKAGING_MATERIAL">Packaging Materials</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No materials match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Material</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Unit</th>
                  <th className="px-4 py-2.5 text-right">Ledger Stock</th>
                  <th className="px-4 py-2.5 text-right">Reorder Level</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((mat) => (
                  <tr key={mat.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{mat.name}</p>
                      <p className="text-[11px] font-mono text-slate-500">{mat.sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">
                      <ToneBadge
                        tone={mat.category === 'PACKAGING_MATERIAL' ? 'navy' : 'slate'}
                      >
                        {mat.category === 'PACKAGING_MATERIAL'
                          ? 'Packaging Material'
                          : 'Raw Material'}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">{mat.unit}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs font-semibold text-slate-900">
                      {mat.availableStock} {mat.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-600">
                      {mat.reorderLevel} {mat.unit}
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge tone={mat.isActive ? 'success' : 'neutral'}>
                        {mat.isActive ? 'Active' : 'Inactive'}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setDetailMaterial(mat)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Eye className="h-3 w-3" />
                        Details
                      </button>
                      <button
                        type="button"
                        onClick={() => openModal(mat)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleStatus(mat)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {mat.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        title="Delete (only allowed if unused in BOMs and transactions)"
                        onClick={() => void handleDelete(mat)}
                        className="inline-flex items-center rounded border border-rose-200 bg-white p-1 text-rose-700 hover:bg-rose-50 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Material Detail Modal */}
      {detailMaterial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {detailMaterial.name}
                </h3>
                <p className="text-xs font-mono text-slate-500">{detailMaterial.sku}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailMaterial(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-500">Category</p>
                <p className="font-medium text-slate-900">
                  {detailMaterial.category === 'PACKAGING_MATERIAL'
                    ? 'Packaging Material'
                    : 'Raw Material'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Unit of Measure</p>
                <p className="font-medium text-slate-900">{detailMaterial.unit}</p>
              </div>
              <div>
                <p className="text-slate-500">Ledger Available Stock</p>
                <p className="font-semibold text-slate-900 tabular-nums">
                  {detailMaterial.availableStock} {detailMaterial.unit}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Reorder Level</p>
                <p className="font-medium text-slate-900 tabular-nums">
                  {detailMaterial.reorderLevel} {detailMaterial.unit}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-slate-500 mb-1">Used in Approved Product BOMs</p>
                {detailMaterial.usedInProducts && detailMaterial.usedInProducts.length > 0 ? (
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                    {detailMaterial.usedInProducts.map((u, idx) => (
                      <li key={idx}>{u}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-400">Not linked to any active BOM.</p>
                )}
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setDetailMaterial(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Add / Edit Material Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleSave(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingId ? 'Edit Material' : 'Add Material to Catalogue'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              {!editingId && (
                <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
                  Registering a material initializes <strong>0 stock</strong>. Inventory increases only via verified purchase receipts or opening stock transactions.
                </p>
              )}
              <div>
                <label className="block font-medium text-slate-700 mb-1">Material SKU (Unique)</label>
                <input
                  required
                  value={mSku}
                  onChange={(e) => setMSku(e.target.value)}
                  placeholder="RM-201"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Material Name (Verified)</label>
                <input
                  required
                  disabled={Boolean(editingId)}
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  placeholder="Cardamom Powder"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <select
                    disabled={Boolean(editingId)}
                    value={mCategory}
                    onChange={(e) =>
                      setMCategory(e.target.value as 'RAW_MATERIAL' | 'PACKAGING_MATERIAL')
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                  >
                    <option value="RAW_MATERIAL">Raw Material</option>
                    <option value="PACKAGING_MATERIAL">Packaging Material</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit of Measure</label>
                  <input
                    required
                    disabled={Boolean(editingId)}
                    list="nitt-material-units"
                    value={mUnit}
                    onChange={(e) => setMUnit(e.target.value)}
                    placeholder="kg"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                  />
                  <datalist id="nitt-material-units">
                    {COMMON_UNITS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reorder Level</label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={mReorder}
                    onChange={(e) => setMReorder(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="inline-flex items-center gap-2 text-slate-700 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mActive}
                      onChange={(e) => setMActive(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Active Status
                  </label>
                </div>
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Material'}
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Supervisor Proposal Review Modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Review Proposal {reviewModal.proposal.proposalNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Proposed by {reviewModal.proposal.proposedByName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-700">
                <strong>{reviewModal.proposal.name}</strong> ({reviewModal.proposal.category},{' '}
                {reviewModal.proposal.unit})
              </p>
              <p className="text-slate-600">{reviewModal.proposal.reason}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Assign Unique SKU
                  </label>
                  <input
                    value={reviewModal.sku}
                    onChange={(e) =>
                      setReviewModal({ ...reviewModal, sku: e.target.value })
                    }
                    placeholder="Auto-generate if empty"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Reorder Level ({reviewModal.proposal.unit})
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={reviewModal.reorderLevel}
                    onChange={(e) =>
                      setReviewModal({ ...reviewModal, reorderLevel: e.target.value })
                    }
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Admin Review Note
                </label>
                <input
                  value={reviewModal.note}
                  onChange={(e) =>
                    setReviewModal({ ...reviewModal, note: e.target.value })
                  }
                  placeholder="Optional approval or rejection note"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleReviewProposal('REJECT')}
                className="rounded border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleReviewProposal('APPROVE')}
                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                Approve &amp; Add Material
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
