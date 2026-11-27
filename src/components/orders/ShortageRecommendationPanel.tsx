import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Factory,
  PackageCheck,
  ShoppingCart,
  XCircle,
} from 'lucide-react';
import type {
  AdminOrderDecision,
  Order,
  OrderShortageAnalysis,
  ProductionRequest,
} from '../../types/orderAudit';
import { ProductionStatusBadge, ToneBadge } from '../ui/Badge';

interface ShortageRecommendationPanelProps {
  order: Order;
  analysis: OrderShortageAnalysis;
  existingProductionRequest?: ProductionRequest;
  onDecision: (decision: AdminOrderDecision, note?: string) => Promise<void>;
  submitting: boolean;
  errorMessage: string | null;
}

export function ShortageRecommendationPanel({
  order,
  analysis,
  existingProductionRequest,
  onDecision,
  submitting,
  errorMessage,
}: ShortageRecommendationPanelProps) {
  const [decisionNote, setDecisionNote] = useState('');

  const isTerminal =
    order.status === 'REJECTED' || order.status === 'DISPATCHED';
  const isAlreadyApproved = order.status === 'APPROVED';

  const handleAction = async (decision: AdminOrderDecision) => {
    await onDecision(decision, decisionNote);
    setDecisionNote('');
  };

  const overallBadge = (() => {
    if (!analysis.productionRequired) {
      return { tone: 'success' as const, label: 'Stock Available' };
    }
    if (analysis.rawMaterialAvailability === 'MISSING_BOM') {
      return { tone: 'danger' as const, label: 'Missing Approved BOM' };
    }
    if (analysis.rawMaterialAvailability === 'SUFFICIENT') {
      return { tone: 'navy' as const, label: 'Ready for Production' };
    }
    return { tone: 'danger' as const, label: 'Material Shortage' };
  })();

  return (
    <div className="space-y-4">
      {/* 1. Overall Status & Finished-Goods Availability Summary */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            C. Overall Order &amp; Production Status
          </h3>
          <div className="flex items-center gap-2">
            {analysis.productionRequired && (
              <ToneBadge tone="warning">Production Required</ToneBadge>
            )}
            <ToneBadge tone={overallBadge.tone}>{overallBadge.label}</ToneBadge>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">Requested quantity</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
              {analysis.requestedQuantity} {analysis.unit}
            </dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">Available finished stock</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
              {analysis.availableFinishedStock} {analysis.unit}
            </dd>
          </div>
          <div
            className={`rounded-md border px-3 py-2 ${
              analysis.shortageQuantity > 0
                ? 'border-amber-200 bg-amber-50'
                : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <dt className="text-xs text-slate-600">Shortage</dt>
            <dd
              className={`mt-0.5 text-base font-semibold tabular-nums ${
                analysis.shortageQuantity > 0
                  ? 'text-amber-900'
                  : 'text-emerald-800'
              }`}
            >
              {analysis.shortageQuantity} {analysis.unit}
            </dd>
          </div>
        </dl>

        {analysis.itemAnalyses && analysis.itemAnalyses.length > 1 && (
          <div className="mt-3 overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-1.5">Product</th>
                  <th className="px-3 py-1.5 text-right">Requested</th>
                  <th className="px-3 py-1.5 text-right">FG Stock</th>
                  <th className="px-3 py-1.5 text-right">Shortage</th>
                  <th className="px-3 py-1.5">Materials</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysis.itemAnalyses.map((item) => (
                  <tr key={item.orderItemId}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">
                      {item.productName}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {item.requestedQuantity} {item.unit}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {item.availableFinishedStock} {item.unit}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                      {item.shortageQuantity} {item.unit}
                    </td>
                    <td className="px-3 py-1.5">
                      <ToneBadge
                        tone={
                          !item.productionRequired
                            ? 'success'
                            : item.rawMaterialAvailability === 'SUFFICIENT'
                              ? 'navy'
                              : 'danger'
                        }
                      >
                        {!item.productionRequired
                          ? 'In Stock'
                          : item.rawMaterialAvailability === 'SUFFICIENT'
                            ? 'Sufficient'
                            : 'Insufficient'}
                      </ToneBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Production & BOM Recommendation (Option A) */}
      {analysis.productionRequired ? (
        <div className="rounded-lg border border-amber-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Factory className="h-4 w-4 text-amber-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Production Recommendation
              </h3>
            </div>
            <ToneBadge
              tone={
                analysis.rawMaterialAvailability === 'SUFFICIENT'
                  ? 'success'
                  : 'danger'
              }
            >
              Materials:{' '}
              {analysis.rawMaterialAvailability === 'SUFFICIENT'
                ? 'Ready for Production'
                : analysis.rawMaterialAvailability === 'MISSING_BOM'
                  ? 'Approved BOM Missing'
                  : 'Material Shortage'}
            </ToneBadge>
          </div>

          {analysis.missingBomProducts && analysis.missingBomProducts.length > 0 && (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900">
              <p className="font-semibold">Approved Predefined BOM Required</p>
              <p className="mt-0.5">
                Missing or unapproved BOM for:{' '}
                <strong>
                  {analysis.missingBomProducts.map((p) => p.productName).join(', ')}
                </strong>
                . Configure and approve the BOM in Product Catalogue before creating a
                Production Request.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm sm:grid-cols-2">
            <div>
              <span className="text-slate-500">Production required: </span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {analysis.shortageQuantity} {analysis.unit}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Raw-material availability: </span>
              <span
                className={`font-semibold ${
                  analysis.rawMaterialAvailability === 'SUFFICIENT'
                    ? 'text-emerald-700'
                    : 'text-rose-700'
                }`}
              >
                {analysis.rawMaterialAvailability === 'SUFFICIENT'
                  ? 'Sufficient'
                  : 'Insufficient'}
              </span>
            </div>
          </div>

          {/* Materials Requiring Purchase — shown ONLY when insufficient */}
          {analysis.materialsRequiringPurchase.length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50/70 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-900 mb-2">
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>Materials Requiring Purchase</span>
              </div>
              <ul className="space-y-1 text-xs text-rose-900">
                {analysis.materialsRequiringPurchase.map((item) => (
                  <li
                    key={item.rawMaterialId}
                    className="flex items-center justify-between border-b border-rose-200/70 pb-1 last:border-none last:pb-0"
                  >
                    <span className="font-medium">
                      {item.materialName} ({item.materialCode})
                    </span>
                    <span className="tabular-nums font-semibold">
                      Purchase {item.shortfallQuantity} {item.unit}{' '}
                      <span className="font-normal text-rose-700">
                        (Need {item.requiredQuantity}, Have {item.availableStock})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* B. BOM Requirements Table */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              B. BOM Requirements ({analysis.shortageQuantity} {analysis.unit} production needed)
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 text-right font-medium">Required</th>
                    <th className="px-3 py-2 text-right font-medium">Available</th>
                    <th className="px-3 py-2 text-right font-medium">Shortage</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analysis.bomBreakdown.map((line) => (
                    <tr key={line.rawMaterialId}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800">{line.materialName}</p>
                        <p className="text-[11px] text-slate-500">
                          {line.materialCode}
                          {line.category === 'PACKAGING_MATERIAL' ? ' · Packaging' : ' · Raw Material'}
                          {line.isMaterialActive === false && (
                            <span className="ml-1 text-rose-700 font-medium">(Inactive Material)</span>
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                        {line.requiredQuantity} {line.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {line.availableStock} {line.unit}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-semibold ${
                          line.shortfallQuantity > 0 ? 'text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {line.shortfallQuantity} {line.unit}
                      </td>
                      <td className="px-3 py-2">
                        <ToneBadge tone={line.isSufficient ? 'success' : 'danger'}>
                          {line.isSufficient ? 'Available' : 'Shortage'}
                        </ToneBadge>
                      </td>
                    </tr>
                  ))}
                  {analysis.bomBreakdown.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-3 text-center text-slate-500"
                      >
                        No approved BOM items configured for this product.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 flex items-start gap-2.5">
          <PackageCheck className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-900">
            <p className="font-semibold">
              Sufficient finished-goods stock available
            </p>
            <p className="mt-0.5">
              Approving this order authorizes it for fulfillment without deducting
              finished-goods stock. Inventory is reduced only when actual dispatch
              is recorded.
            </p>
          </div>
        </div>
      )}

      {/* Linked Production Request Banner (if already created) */}
      {existingProductionRequest && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3.5 text-xs text-blue-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              Production Request: {existingProductionRequest.requestNumber}
            </span>
            <ProductionStatusBadge status={existingProductionRequest.status} />
          </div>
          <p className="mt-1 text-blue-900">
            Requested {existingProductionRequest.requestedQuantity}{' '}
            {existingProductionRequest.unit} for supervisor review. No stock has
            been deducted and no production run has been auto-posted.
          </p>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 3. Admin Decision Controls */}
      {!isTerminal && !isAlreadyApproved && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Admin Decision
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Order remains unfulfilled until sufficient finished goods are
              available and dispatch is recorded.
            </p>
          </div>

          <div>
            <label
              htmlFor="decision-note"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Audit Note / Reason (optional)
            </label>
            <input
              id="decision-note"
              type="text"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="e.g., Prioritise for Friday hostel delivery or state rejection reason"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
            />
          </div>

          {analysis.productionRequired ? (
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={
                  submitting ||
                  Boolean(existingProductionRequest) ||
                  analysis.rawMaterialAvailability === 'MISSING_BOM'
                }
                onClick={() => handleAction('SEND_FOR_PRODUCTION')}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Factory className="h-3.5 w-3.5" />
                {existingProductionRequest
                  ? 'Production Request Already Sent'
                  : 'Send for Production'}
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => handleAction('WAIT_KEEP_PENDING')}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Clock className="h-3.5 w-3.5" />
                Wait / Keep Pending
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => handleAction('REJECT_ORDER')}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject Order
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleAction('APPROVE_ORDER')}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve Order
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => handleAction('REJECT_ORDER')}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject Order
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
