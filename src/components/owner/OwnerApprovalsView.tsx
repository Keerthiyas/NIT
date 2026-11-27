import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, Settings, X } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { OwnerApprovalItem, OwnerApprovalsData } from '../../types/orderAudit';
import { ToneBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { formatInr } from './OwnerCharts';

interface OwnerApprovalsViewProps {
  initialSelectedPoId?: string | null;
  onApprovalsChanged: () => void;
}

type ApprovalFilter = 'PENDING_OWNER_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ALL';

export function OwnerApprovalsView({
  initialSelectedPoId,
  onApprovalsChanged,
}: OwnerApprovalsViewProps) {
  const [data, setData] = useState<OwnerApprovalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<ApprovalFilter>('PENDING_OWNER_APPROVAL');
  const [selectedPo, setSelectedPo] = useState<OwnerApprovalItem | null>(null);

  const [limitInput, setLimitInput] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);

  const [decisionBusy, setDecisionBusy] = useState(false);
  const [rejectModalPo, setRejectModalPo] = useState<OwnerApprovalItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.loadOwnerApprovals();
      setData(res);
      setLimitInput(String(res.approvalLimitRupees));
      if (initialSelectedPoId) {
        const match = res.approvals.find((a) => a.id === initialSelectedPoId);
        if (match) setSelectedPo(match);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals.');
    } finally {
      setLoading(false);
    }
  }, [initialSelectedPoId]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  const handleSaveLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Number(limitInput);
    if (!Number.isFinite(numeric) || numeric < 0) {
      setError('Please enter a valid non-negative approval limit.');
      return;
    }
    setSavingLimit(true);
    setError(null);
    setNotice(null);
    try {
      const res = await orderAuditService.updateOwnerApprovalLimit(numeric);
      setNotice(
        `Purchase approval threshold updated to ${formatInr(res.approvalLimitRupees, 0)}.`
      );
      await loadApprovals();
      onApprovalsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update threshold.');
    } finally {
      setSavingLimit(false);
    }
  };

  const handleApprove = async (po: OwnerApprovalItem) => {
    setDecisionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await orderAuditService.approvePurchaseOrderByOwner(po.id, true);
      setNotice(`Purchase Order ${res.poNumber} approved for procurement.`);
      setSelectedPo(null);
      await loadApprovals();
      onApprovalsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve purchase order.');
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalPo) return;
    if (!rejectionReason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    setDecisionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await orderAuditService.approvePurchaseOrderByOwner(
        rejectModalPo.id,
        false,
        rejectionReason.trim()
      );
      setNotice(`Purchase Order ${res.poNumber} rejected: "${res.rejectionReason ?? rejectionReason.trim()}".`);
      setRejectModalPo(null);
      setRejectionReason('');
      setSelectedPo(null);
      await loadApprovals();
      onApprovalsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject purchase order.');
    } finally {
      setDecisionBusy(false);
    }
  };

  const filtered = (data?.approvals ?? []).filter((po) =>
    statusFilter === 'ALL' ? true : po.approvalStatus === statusFilter
  );

  return (
    <div className="space-y-5">
      {/* Configurable Approval Limit Card */}
      <Card
        title="Approval Threshold Configuration"
        subtitle="Purchase orders with estimated value above this amount require Owner authorization before receipt"
      >
        <form onSubmit={(e) => void handleSaveLimit(e)} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Threshold Amount (INR)
            </label>
            <input
              type="number"
              min="0"
              step="100"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              className="w-48 rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={savingLimit}
            className="inline-flex items-center gap-1.5 rounded bg-blue-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" />
            {savingLimit ? 'Saving...' : 'Update Threshold'}
          </button>
          <button
            type="button"
            onClick={() => void loadApprovals()}
            className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer ml-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </form>
      </Card>

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

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { id: 'PENDING_OWNER_APPROVAL', label: 'Pending Approval' },
          { id: 'APPROVED', label: 'Approved' },
          { id: 'REJECTED', label: 'Rejected' },
          { id: 'ALL', label: 'All High-Value POs' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id as ApprovalFilter)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              statusFilter === tab.id
                ? 'bg-blue-950 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Purchase Approvals Table */}
      <Card title="Purchase Approvals Queue" noPadding>
        {loading && !data ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading purchase approvals...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No purchase orders found under this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">PO #</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Supplier</th>
                  <th className="px-4 py-2.5 font-medium">Items Summary</th>
                  <th className="px-4 py-2.5 font-medium text-right">Estimated Total</th>
                  <th className="px-4 py-2.5 font-medium">Decision Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                      {po.poNumber}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                      {po.orderDate.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">{po.supplierName}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {po.items
                        .map((i) => `${i.itemName} (${i.orderedQuantity} ${i.unit})`)
                        .join(', ')}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                      {formatInr(po.estimatedTotal ?? 0)}
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        tone={
                          po.approvalStatus === 'APPROVED'
                            ? 'green'
                            : po.approvalStatus === 'REJECTED'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {po.approvalStatus === 'PENDING_OWNER_APPROVAL'
                          ? 'Pending'
                          : po.approvalStatus}
                      </ToneBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedPo(po)}
                        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Details
                      </button>
                      {po.approvalStatus === 'PENDING_OWNER_APPROVAL' && (
                        <>
                          <button
                            type="button"
                            disabled={decisionBusy}
                            onClick={() => void handleApprove(po)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="h-3 w-3" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={decisionBusy}
                            onClick={() => {
                              setRejectModalPo(po);
                              setRejectionReason('');
                            }}
                            className="inline-flex items-center gap-1 rounded bg-rose-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detailed PO Approval Modal */}
      {selectedPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Purchase Approval Detail — {selectedPo.poNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Requested by {selectedPo.createdBy} on {selectedPo.orderDate.slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPo(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3.5">
                <div>
                  <p className="text-[11px] font-medium text-slate-500">Supplier Details</p>
                  <p className="font-semibold text-slate-900 mt-0.5">{selectedPo.supplierName}</p>
                  <p className="text-slate-600">
                    Code: {selectedPo.supplierCode} · {selectedPo.supplierState || '-'}
                  </p>
                  {selectedPo.supplierPhone && (
                    <p className="text-slate-600">Phone: {selectedPo.supplierPhone}</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-500">Reason / Request Context</p>
                  <p className="text-slate-800 mt-0.5">{selectedPo.reason}</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    Total Estimated Cost: {formatInr(selectedPo.estimatedTotal ?? 0)}
                  </p>
                  {selectedPo.rejectionReason && (
                    <p className="mt-1 text-rose-700 font-medium">
                      Rejection Reason: {selectedPo.rejectionReason}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="font-semibold text-slate-900 mb-2">
                  Materials, Live Stock vs Reorder Level &amp; Cost
                </p>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Material</th>
                        <th className="px-3 py-2 font-medium text-right">Available</th>
                        <th className="px-3 py-2 font-medium text-right">Reorder</th>
                        <th className="px-3 py-2 font-medium text-right">Requested Qty</th>
                        <th className="px-3 py-2 font-medium text-right">Unit Cost</th>
                        <th className="px-3 py-2 font-medium text-right">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedPo.items.map((it) => (
                        <tr key={it.id}>
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {it.itemName}{' '}
                            <span className="text-slate-500 font-normal">({it.unit})</span>
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums font-medium ${
                              it.currentAvailableStock < it.reorderLevel
                                ? 'text-rose-700'
                                : 'text-slate-700'
                            }`}
                          >
                            {it.currentAvailableStock}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                            {it.reorderLevel}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                            {it.orderedQuantity}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {formatInr(it.unitCost)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                            {formatInr(it.lineEstimatedCost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedPo.linkedRequirements.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-900 mb-1.5">
                    Linked Production Shortage Requests
                  </p>
                  <ul className="space-y-1 text-slate-600">
                    {selectedPo.linkedRequirements.map((r) => (
                      <li key={r.id}>
                        <span className="font-medium text-slate-800">{r.requirementNumber}</span> ·
                        PR {r.requestNumber} · Order {r.orderNumber} ({r.priority}) —{' '}
                        {r.reason || 'Shortage procurement'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setSelectedPo(null)}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
              {selectedPo.approvalStatus === 'PENDING_OWNER_APPROVAL' && (
                <>
                  <button
                    type="button"
                    disabled={decisionBusy}
                    onClick={() => {
                      setRejectModalPo(selectedPo);
                      setRejectionReason('');
                    }}
                    className="inline-flex items-center gap-1 rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={decisionBusy}
                    onClick={() => void handleApprove(selectedPo)}
                    className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve Purchase Order
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Rejection Reason Modal */}
      {rejectModalPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleConfirmReject(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
          >
            <div className="border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Reject Purchase Order {rejectModalPo.poNumber}
              </h3>
              <p className="text-xs text-slate-500">
                Supplier: {rejectModalPo.supplierName} · Value:{' '}
                {formatInr(rejectModalPo.estimatedTotal ?? 0)}
              </p>
            </div>
            <div className="p-5 space-y-2">
              <label className="block text-xs font-medium text-slate-700">
                Rejection Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this purchase order is rejected..."
                className="w-full rounded border border-slate-200 px-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setRejectModalPo(null)}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={decisionBusy}
                className="rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50 cursor-pointer"
              >
                {decisionBusy ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
