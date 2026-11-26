import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardEdit,
  Play,
  RefreshCw,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  BomRevisionRequest,
  MaterialPurchaseRequirement,
  ProductionRequest,
} from '../../types/orderAudit';
import { ProductionStatusBadge, ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

interface SupervisorRequestsViewProps {
  requests: ProductionRequest[];
  purchaseRequirements: MaterialPurchaseRequirement[];
  bomRevisions: BomRevisionRequest[];
  selectedRequestId: string | null;
  initialStatusFilter?: string;
  onSelectRequest: (id: string | null) => void;
  onStartExecution: (requestId: string) => void;
  onRefresh: () => Promise<void>;
}

const PENDING_GROUP_STATUSES = new Set([
  'PENDING_SUPERVISOR_REVIEW',
  'PENDING_MATERIAL_CHECK',
  'AWAITING_MATERIALS',
  'MATERIAL_SHORTAGE',
  'READY_FOR_PRODUCTION',
]);

export function SupervisorRequestsView({
  requests,
  purchaseRequirements,
  bomRevisions,
  selectedRequestId,
  initialStatusFilter,
  onSelectRequest,
  onStartExecution,
  onRefresh,
}: SupervisorRequestsViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || 'ALL');

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Modal: Raise Purchase Requirement
  const [prModal, setPrModal] = useState<{
    productionRequestId: string;
    requestNumber: string;
    materialId: string;
    materialName: string;
    unit: string;
    requiredQuantity: number;
    shortageQuantity: number;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    reason: string;
  } | null>(null);

  // Modal: Request BOM Revision
  const [bomModal, setBomModal] = useState<{
    productId: string;
    productName: string;
    bomVersion: string;
    materialId: string;
    materialName: string;
    unit: string;
    currentQuantityPerUnit: number;
    suggestedQuantityPerUnit: number;
    reason: string;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter === 'PENDING_GROUP') {
        if (!PENDING_GROUP_STATUSES.has(r.status)) return false;
      } else if (statusFilter !== 'ALL' && r.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        r.requestNumber.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        (r.productSku ?? '').toLowerCase().includes(q) ||
        r.orderNumber.toLowerCase().includes(q) ||
        (r.customerName ?? '').toLowerCase().includes(q)
      );
    });
  }, [requests, search, statusFilter]);

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedRequestId) ?? filtered[0] ?? null,
    [requests, selectedRequestId, filtered]
  );

  const selectedReqs = useMemo(
    () =>
      selected
        ? purchaseRequirements.filter((p) => p.productionRequestId === selected.id)
        : [],
    [selected, purchaseRequirements]
  );

  const handleCheckAvailability = async (reqId: string) => {
    setBusyId(reqId);
    setMessage(null);
    try {
      const res = await orderAuditService.checkProductionRequestAvailability(reqId);
      setMessage({
        type: res.rawMaterialAvailability === 'SUFFICIENT' ? 'ok' : 'err',
        text:
          res.rawMaterialAvailability === 'SUFFICIENT'
            ? `${res.requestNumber}: All BOM materials available. Marked READY FOR PRODUCTION.`
            : `${res.requestNumber}: Material shortage detected. Status set to MATERIAL SHORTAGE.`,
      });
      await onRefresh();
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to check material availability.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleStartProduction = async (req: ProductionRequest) => {
    setBusyId(req.id);
    setMessage(null);
    try {
      await orderAuditService.updateProductionRequestStatus(
        req.id,
        'IN_PROGRESS',
        'Started by Production Supervisor'
      );
      setMessage({
        type: 'ok',
        text: `${req.requestNumber} started (In Progress). No inventory deducted until batch completion is posted.`,
      });
      await onRefresh();
      onStartExecution(req.id);
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to start production.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitPurchaseReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prModal) return;
    setBusyId(prModal.productionRequestId);
    setMessage(null);
    try {
      const created = await orderAuditService.createMaterialPurchaseRequirement({
        productionRequestId: prModal.productionRequestId,
        materialId: prModal.materialId,
        requiredQuantity: prModal.requiredQuantity,
        shortageQuantity: prModal.shortageQuantity,
        priority: prModal.priority,
        reason: prModal.reason,
      });
      setPrModal(null);
      setMessage({
        type: 'ok',
        text: `Purchase requirement ${created.requirementNumber} submitted to Procurement/Admin.`,
      });
      await onRefresh();
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to submit purchase requirement.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitBomRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bomModal) return;
    setBusyId(bomModal.productId);
    setMessage(null);
    try {
      const created = await orderAuditService.createBomRevisionRequest({
        productId: bomModal.productId,
        materialId: bomModal.materialId,
        suggestedQuantityPerUnit: bomModal.suggestedQuantityPerUnit,
        reason: bomModal.reason,
      });
      setBomModal(null);
      setMessage({
        type: 'ok',
        text: `BOM revision request ${created.requestNumber} sent to Admin for review. Official BOM unchanged until approved.`,
      });
      await onRefresh();
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to submit BOM revision request.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {message && (
        <div
          className={`rounded-md border px-4 py-2.5 text-xs font-medium ${
            message.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search request ID, product, SKU, customer order..."
            className="w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:border-blue-600 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING_GROUP">Pending Requests</option>
            <option value="PENDING_SUPERVISOR_REVIEW">Pending Supervisor Review</option>
            <option value="PENDING_MATERIAL_CHECK">Pending Material Check</option>
            <option value="MATERIAL_SHORTAGE">Material Shortage</option>
            <option value="AWAITING_MATERIALS">Awaiting Materials</option>
            <option value="READY_FOR_PRODUCTION">Ready for Production</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="PARTIALLY_COMPLETED">Partially Completed</option>
          </select>
        </div>
      </div>

      {/* Main Split: Requests List & Selected BOM/Availability Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-6">
          <Card
            title="Production Requests"
            subtitle="Select a request to inspect its official BOM, materials, and procurement progress"
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold">Request ID</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Product & Qty</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Order / Reason</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Priority</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        No production requests match your filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((req) => {
                      const isSel = selected?.id === req.id;
                      return (
                        <tr
                          key={req.id}
                          onClick={() => onSelectRequest(req.id)}
                          className={`cursor-pointer transition-colors ${
                            isSel ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <p className="font-mono font-semibold text-slate-900">
                              {req.requestNumber}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {req.createdAt.slice(0, 10)}
                            </p>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-slate-900">{req.productName}</p>
                            <p className="text-[11px] text-slate-500">
                              {req.requestedQuantity} {req.unit} · {req.productSku}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            <p className="font-mono">{req.orderNumber}</p>
                            <p className="text-[11px] text-slate-500 truncate max-w-[140px]">
                              {req.reason || 'Customer Order Shortage'}
                            </p>
                          </td>
                          <td className="px-3 py-2.5">
                            <ToneBadge
                              tone={
                                req.priority === 'URGENT' || req.priority === 'HIGH'
                                  ? 'red'
                                  : req.priority === 'LOW'
                                    ? 'slate'
                                    : 'blue'
                              }
                            >
                              {req.priority || 'NORMAL'}
                            </ToneBadge>
                          </td>
                          <td className="px-3 py-2.5">
                            <ProductionStatusBadge status={req.status} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right: BOM & Availability Inspector */}
        <div className="xl:col-span-6 space-y-4">
          {selected ? (
            <Card
              title={`${selected.requestNumber} · ${selected.productName}`}
              subtitle={`Order ${selected.orderNumber} (${selected.customerName || 'Customer'}) · Required ${selected.requestedQuantity} ${selected.unit} · BOM ${selected.bomVersion || 'v1.0'} (Read-Only)`}
              action={<ProductionStatusBadge status={selected.status} />}
            >
              <div className="space-y-4">
                {/* Action Bar */}
                {!['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'].includes(selected.status) && (
                  <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
                    <button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void handleCheckAvailability(selected.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${busyId === selected.id ? 'animate-spin' : ''}`}
                      />
                      Check / Recheck Availability
                    </button>

                    {(selected.status === 'READY_FOR_PRODUCTION' ||
                      (selected.status === 'PENDING_SUPERVISOR_REVIEW' &&
                        selected.rawMaterialAvailability === 'SUFFICIENT')) && (
                      <button
                        type="button"
                        disabled={busyId === selected.id}
                        onClick={() => void handleStartProduction(selected)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Start Production (No Stock Deduction)
                      </button>
                    )}

                    {selected.status === 'IN_PROGRESS' && (
                      <button
                        type="button"
                        onClick={() => onStartExecution(selected.id)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Open Execution Sheet
                      </button>
                    )}
                  </div>
                )}

                {/* BOM Breakdown */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Official Bill of Materials vs Live Shared Stock
                  </h4>
                  <div className="overflow-x-auto rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Material</th>
                          <th className="px-3 py-2 text-right font-semibold">Per Unit</th>
                          <th className="px-3 py-2 text-right font-semibold">Required</th>
                          <th className="px-3 py-2 text-right font-semibold">Available</th>
                          <th className="px-3 py-2 text-right font-semibold">Shortfall</th>
                          <th className="px-3 py-2 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {(selected.bomMaterials ?? []).map((mat) => {
                          const shortfall = Math.max(
                            0,
                            Number((mat.requiredQuantity - mat.availableStock).toFixed(3))
                          );
                          const existingReq = selectedReqs.find(
                            (p) =>
                              p.materialId === mat.materialId &&
                              p.status !== 'RECEIVED' &&
                              p.status !== 'CANCELLED'
                          );
                          return (
                            <tr key={mat.materialId}>
                              <td className="px-3 py-2">
                                <p className="font-medium text-slate-900">{mat.materialName}</p>
                                <p className="text-[11px] text-slate-500">
                                  {mat.materialCode} · {mat.category === 'PACKAGING_MATERIAL' ? 'Packaging' : 'Raw'}
                                </p>
                              </td>
                              <td className="px-3 py-2 text-right text-slate-600">
                                {mat.quantityPerUnit} {mat.unit}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-slate-900">
                                {mat.requiredQuantity} {mat.unit}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-800">
                                {mat.availableStock} {mat.unit}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {shortfall > 0 ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                                    <AlertTriangle className="h-3 w-3" />
                                    {shortfall} {mat.unit}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                    <CheckCircle2 className="h-3 w-3" />
                                    OK
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                                {shortfall > 0 &&
                                  !['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'].includes(
                                    selected.status
                                  ) &&
                                  (existingReq ? (
                                    <span className="inline-block rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                                      {existingReq.requirementNumber}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPrModal({
                                          productionRequestId: selected.id,
                                          requestNumber: selected.requestNumber,
                                          materialId: mat.materialId,
                                          materialName: mat.materialName,
                                          unit: mat.unit,
                                          requiredQuantity: mat.requiredQuantity,
                                          shortageQuantity: shortfall,
                                          priority: selected.priority || 'NORMAL',
                                          reason: `Shortage for ${selected.requestNumber} (${selected.productName})`,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                                    >
                                      <ShoppingCart className="h-3 w-3" />
                                      Raise Req
                                    </button>
                                  ))}
                                <button
                                  type="button"
                                  title="Suggest BOM Revision to Admin"
                                  onClick={() =>
                                    setBomModal({
                                      productId: selected.productId,
                                      productName: selected.productName,
                                      bomVersion: selected.bomVersion || 'v1.0',
                                      materialId: mat.materialId,
                                      materialName: mat.materialName,
                                      unit: mat.unit,
                                      currentQuantityPerUnit: mat.quantityPerUnit,
                                      suggestedQuantityPerUnit: mat.quantityPerUnit,
                                      reason: '',
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <ClipboardEdit className="h-3 w-3" />
                                  BOM Rev
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Request Inspector">
              <p className="text-sm text-slate-500">Select a production request to view its BOM.</p>
            </Card>
          )}
        </div>
      </div>

      {/* Procurement Progress Tracker (Purchase Requirements Raised by Supervisor) */}
      <Card
        title="Material Purchase Requirements & Procurement Progress"
        subtitle="Supervisor cannot create POs directly; requirements flow to Procurement/Admin, Owner (if > ₹10,000), and GRN stock receipt."
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Requirement #</th>
                <th className="px-4 py-2.5 text-left font-semibold">Material</th>
                <th className="px-4 py-2.5 text-left font-semibold">Linked Request</th>
                <th className="px-4 py-2.5 text-right font-semibold">Shortfall</th>
                <th className="px-4 py-2.5 text-left font-semibold">Priority</th>
                <th className="px-4 py-2.5 text-left font-semibold">Procurement Stage</th>
                <th className="px-4 py-2.5 text-left font-semibold">Linked PO / Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {purchaseRequirements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-5 text-center text-slate-500">
                    No material purchase requirements submitted yet.
                  </td>
                </tr>
              ) : (
                purchaseRequirements.map((req) => (
                  <tr key={req.id}>
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-900">
                      {req.requirementNumber}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{req.materialName}</p>
                      <p className="text-[11px] text-slate-500">{req.materialSku}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono">{req.requestNumber}</span> · {req.orderNumber}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-700">
                      {req.shortageQuantity} {req.unit}
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        tone={
                          req.priority === 'URGENT' || req.priority === 'HIGH'
                            ? 'red'
                            : 'blue'
                        }
                      >
                        {req.priority}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        tone={
                          req.status === 'RECEIVED'
                            ? 'green'
                            : req.status === 'AWAITING_OWNER_APPROVAL'
                              ? 'amber'
                              : req.status === 'CANCELLED'
                                ? 'slate'
                                : 'blue'
                        }
                      >
                        {req.status.replace(/_/g, ' ')}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {req.poNumber ? (
                        <span>
                          <strong className="font-mono text-slate-900">{req.poNumber}</strong> (
                          {req.poApprovalStatus?.replace(/_/g, ' ') || req.poStatus})
                        </span>
                      ) : (
                        'Pending Admin PO'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* BOM Revision Requests Submitted by Supervisor */}
      {bomRevisions.length > 0 && (
        <Card
          title="BOM Revision Requests"
          subtitle="Suggested BOM updates awaiting Admin/Owner approval"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Revision #</th>
                  <th className="px-4 py-2 text-left font-semibold">Product (Version)</th>
                  <th className="px-4 py-2 text-left font-semibold">Material</th>
                  <th className="px-4 py-2 text-right font-semibold">Current → Suggested</th>
                  <th className="px-4 py-2 text-left font-semibold">Reason</th>
                  <th className="px-4 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {bomRevisions.map((rev) => (
                  <tr key={rev.id}>
                    <td className="px-4 py-2 font-mono font-medium">{rev.requestNumber}</td>
                    <td className="px-4 py-2">
                      {rev.productName} <span className="text-slate-400">({rev.bomVersion})</span>
                    </td>
                    <td className="px-4 py-2">{rev.materialName}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {rev.currentQuantityPerUnit} → {rev.suggestedQuantityPerUnit} {rev.materialUnit}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{rev.reason}</td>
                    <td className="px-4 py-2">
                      <ToneBadge
                        tone={
                          rev.status === 'APPROVED'
                            ? 'green'
                            : rev.status === 'REJECTED'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {rev.status.replace(/_/g, ' ')}
                      </ToneBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal: Raise Material Purchase Requirement */}
      {prModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleSubmitPurchaseReq(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Raise Material Purchase Requirement
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {prModal.requestNumber} · {prModal.materialName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrModal(null)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Shortfall Qty ({prModal.unit})
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  value={prModal.shortageQuantity}
                  onChange={(e) =>
                    setPrModal({ ...prModal, shortageQuantity: Number(e.target.value) })
                  }
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Priority</label>
                <select
                  value={prModal.priority}
                  onChange={(e) =>
                    setPrModal({
                      ...prModal,
                      priority: e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="LOW">LOW</option>
                  <option value="NORMAL">NORMAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="URGENT">URGENT</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Reason / Notes</label>
              <textarea
                rows={2}
                required
                value={prModal.reason}
                onChange={(e) => setPrModal({ ...prModal, reason: e.target.value })}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPrModal(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId !== null}
                className="rounded bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                Submit Requirement
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Request BOM Revision */}
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

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Current ({bomModal.unit}/unit)
                </label>
                <input
                  type="text"
                  disabled
                  value={bomModal.currentQuantityPerUnit}
                  className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Suggested ({bomModal.unit}/unit)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  required
                  value={bomModal.suggestedQuantityPerUnit}
                  onChange={(e) =>
                    setBomModal({
                      ...bomModal,
                      suggestedQuantityPerUnit: Number(e.target.value),
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Justification for Admin Review
              </label>
              <textarea
                rows={3}
                required
                placeholder="Explain observed shop-floor yield/consumption reason..."
                value={bomModal.reason}
                onChange={(e) => setBomModal({ ...bomModal, reason: e.target.value })}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBomModal(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId !== null}
                className="rounded bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
              >
                Submit to Admin
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
