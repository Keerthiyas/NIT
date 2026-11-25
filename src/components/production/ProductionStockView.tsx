import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardCheck,
  Eye,
  History,
  PackagePlus,
  Search,
  ShoppingBag,
  Truck,
  X,
} from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  InventoryCategory,
  InventoryItem,
  MaterialShortageQuery,
  Order,
  ProductionRequest,
  ProductionRequestStatus,
  ProductionRun,
  PurchaseOrder,
  PurchaseReceipt,
  StockMovement,
  Supplier,
} from '../../types/orderAudit';
import { Card } from '../ui/Card';
import { OrderStatusBadge, ProductionStatusBadge, ToneBadge } from '../ui/Badge';

type SubTab = 'stock' | 'requests' | 'shortages' | 'monitoring' | 'dispatch';

const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  RAW_MATERIAL: 'Raw Material',
  PACKAGING_MATERIAL: 'Packaging Material',
  FINISHED_GOOD: 'Finished Good',
};

const SHORTAGE_STATUS_TONES: Record<
  MaterialShortageQuery['status'],
  { label: string; tone: 'danger' | 'warning' | 'success' }
> = {
  OPEN: { label: 'Open Shortage', tone: 'danger' },
  PROCUREMENT_REQUESTED: { label: 'PO Raised', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
};

export function ProductionStockView({ onDataChanged }: { onDataChanged?: () => void }) {
  const [subTab, setSubTab] = useState<SubTab>('stock');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [requests, setRequests] = useState<ProductionRequest[]>([]);
  const [shortages, setShortages] = useState<MaterialShortageQuery[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseReceipts, setPurchaseReceipts] = useState<PurchaseReceipt[]>([]);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  // Stock filters
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | InventoryCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Monitoring status filter
  const [monitoringFilter, setMonitoringFilter] = useState<'ALL' | ProductionRequestStatus>('ALL');

  // Modals
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const [selectedRequest, setSelectedRequest] = useState<ProductionRequest | null>(null);
  const [selectedRun, setSelectedRun] = useState<ProductionRun | null>(null);

  // PO Modal
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poItemId, setPoItemId] = useState('');
  const [poQty, setPoQty] = useState('');
  const [poUnitCost, setPoUnitCost] = useState('');
  const [poShortageId, setPoShortageId] = useState<string | undefined>(undefined);
  const [poNotes, setPoNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Purchase Receipt (GRN) Modal
  const [grnModalOpen, setGrnModalOpen] = useState(false);
  const [grnPoId, setGrnPoId] = useState('');
  const [grnSupplierId, setGrnSupplierId] = useState('');
  const [grnItemId, setGrnItemId] = useState('');
  const [grnQty, setGrnQty] = useState('');
  const [grnNotes, setGrnNotes] = useState('');

  // Dispatch Modal
  const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
  const [dispatchQty, setDispatchQty] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [inv, reqs, sh, pos, grns, pruns, sups, ords] = await Promise.all([
        orderAuditService.listInventoryItems(),
        orderAuditService.listProductionRequests(),
        orderAuditService.listMaterialShortages(),
        orderAuditService.listPurchaseOrders(),
        orderAuditService.listPurchaseReceipts(),
        orderAuditService.listProductionRuns(),
        orderAuditService.listSuppliers(),
        orderAuditService.listOrdersOnly(),
      ]);
      setItems(inv);
      setRequests(reqs);
      setShortages(sh);
      setPurchaseOrders(pos);
      setPurchaseReceipts(grns);
      setRuns(pruns);
      setSuppliers(sups.filter((s) => s.isActive));
      setOrders(ords);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Production & Stock data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openMovementModal = async (item: InventoryItem) => {
    setMovementItem(item);
    setMovementsLoading(true);
    try {
      const rows = await orderAuditService.listStockMovements(item.id);
      setMovements(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock movements.');
    } finally {
      setMovementsLoading(false);
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q)
      );
    });
  }, [items, categoryFilter, searchQuery]);

  const materialItems = useMemo(
    () => items.filter((i) => i.category !== 'FINISHED_GOOD' && i.isActive),
    [items]
  );

  const openPoForShortage = (shortage?: MaterialShortageQuery) => {
    const matchingSupplier = shortage
      ? suppliers.find((s) => s.suppliedMaterials.some((m) => m.id === shortage.materialId))
      : suppliers[0];
    setPoSupplierId(matchingSupplier?.id ?? suppliers[0]?.id ?? '');
    setPoItemId(shortage?.materialId ?? materialItems[0]?.id ?? '');
    setPoQty(shortage ? String(shortage.shortageQuantity) : '');
    setPoUnitCost('');
    setPoShortageId(shortage?.id);
    setPoNotes(
      shortage
        ? `Procurement for ${shortage.requestNumber} (${shortage.orderNumber})`
        : ''
    );
    setPoModalOpen(true);
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await orderAuditService.createPurchaseOrder({
        supplierId: poSupplierId,
        items: [
          {
            itemId: poItemId,
            orderedQuantity: Number(poQty),
            unitCost: poUnitCost ? Number(poUnitCost) : 0,
          },
        ],
        shortageQueryIds: poShortageId ? [poShortageId] : undefined,
        notes: poNotes,
      });
      setPoModalOpen(false);
      setBannerMsg(
        `Purchase Order ${res.poNumber} created. Stock remains unchanged until goods receipt is recorded.`
      );
      await loadAll();
      onDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Purchase Order.');
    } finally {
      setSubmitting(false);
    }
  };

  const openGrnModal = (po?: PurchaseOrder) => {
    if (po) {
      const pendingLine =
        po.items.find((i) => i.orderedQuantity > i.receivedQuantity) ?? po.items[0];
      setGrnPoId(po.id);
      setGrnSupplierId(po.supplierId);
      setGrnItemId(pendingLine?.itemId ?? '');
      setGrnQty(
        pendingLine
          ? String(Math.max(0, pendingLine.orderedQuantity - pendingLine.receivedQuantity))
          : ''
      );
      setGrnNotes(`Goods receipt against ${po.poNumber}`);
    } else {
      setGrnPoId('');
      setGrnSupplierId(suppliers[0]?.id ?? '');
      setGrnItemId(materialItems[0]?.id ?? '');
      setGrnQty('');
      setGrnNotes('');
    }
    setGrnModalOpen(true);
  };

  const handlePostGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await orderAuditService.postPurchaseReceipt({
        supplierId: grnSupplierId,
        purchaseOrderId: grnPoId || undefined,
        items: [{ itemId: grnItemId, receivedQuantity: Number(grnQty) }],
        notes: grnNotes,
      });
      setGrnModalOpen(false);
      setBannerMsg(
        `Purchase Receipt ${res.receiptNumber} posted. Stock updated and open shortage queries recalculated.`
      );
      await loadAll();
      onDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post Purchase Receipt.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchOrder) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await orderAuditService.recordDispatch({
        orderId: dispatchOrder.id,
        quantity: Number(dispatchQty),
        notes: dispatchNotes,
      });
      setDispatchOrder(null);
      setBannerMsg(
        `Dispatch ${res.dispatchNumber} recorded. Finished-goods stock updated (${res.status}).`
      );
      await loadAll();
      onDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record dispatch.');
    } finally {
      setSubmitting(false);
    }
  };

  const dispatchableOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.status === 'APPROVED' || o.status === 'PARTIALLY_DISPATCHED'
      ),
    [orders]
  );

  const openShortageCount = shortages.filter((s) => s.status !== 'RESOLVED').length;

  const monitoringRequests = useMemo(() => {
    if (monitoringFilter === 'ALL') return requests;
    return requests.filter((r) => r.status === monitoringFilter);
  }, [requests, monitoringFilter]);

  return (
    <div className="space-y-4">
      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2.5">
        {(
          [
            { id: 'stock', label: 'Stock Overview' },
            { id: 'requests', label: `Production Requests (${requests.length})` },
            {
              id: 'shortages',
              label: `Material Shortages (${openShortageCount})`,
            },
            { id: 'monitoring', label: 'Production Monitoring' },
            {
              id: 'dispatch',
              label: `Dispatch Release (${dispatchableOrders.length})`,
            },
          ] as Array<{ id: SubTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === tab.id
                ? 'bg-blue-950 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {bannerMsg && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">
          <span>{bannerMsg}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="text-emerald-700 hover:text-emerald-950"
          >
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
          Loading Production &amp; Stock workspace...
        </div>
      ) : (
        <>
          {/* A. STOCK OVERVIEW */}
          {subTab === 'stock' && (
            <Card
              title="Shared Inventory Overview"
              subtitle="Live ledger balances across Raw Materials, Packaging Materials, and Finished Goods"
              noPadding
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search item name or SKU..."
                      className="w-52 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                  <select
                    aria-label="Filter inventory by category"
                    value={categoryFilter}
                    onChange={(e) =>
                      setCategoryFilter(e.target.value as 'ALL' | InventoryCategory)
                    }
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-800 focus:outline-none"
                  >
                    <option value="ALL">All Categories</option>
                    <option value="RAW_MATERIAL">Raw Materials</option>
                    <option value="PACKAGING_MATERIAL">Packaging Materials</option>
                    <option value="FINISHED_GOOD">Finished Goods</option>
                  </select>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Item Name</th>
                      <th className="px-4 py-2.5">SKU</th>
                      <th className="px-4 py-2.5">Category</th>
                      <th className="px-4 py-2.5 text-right">Available Qty</th>
                      <th className="px-4 py-2.5">Unit</th>
                      <th className="px-4 py-2.5 text-right">Movements</th>
                      <th className="px-4 py-2.5">Last Updated</th>
                      <th className="px-4 py-2.5 text-right">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item) => {
                      const isLow = item.availableStock <= item.reorderLevel;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-900">{item.name}</p>
                            {!item.isActive && (
                              <span className="text-[11px] text-rose-600">Inactive</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs font-mono text-slate-600">
                            {item.sku}
                          </td>
                          <td className="px-4 py-2.5">
                            <ToneBadge
                              tone={
                                item.category === 'FINISHED_GOOD'
                                  ? 'navy'
                                  : item.category === 'PACKAGING_MATERIAL'
                                    ? 'neutral'
                                    : 'warning'
                              }
                            >
                              {CATEGORY_LABELS[item.category]}
                            </ToneBadge>
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                              item.availableStock === 0
                                ? 'text-rose-700'
                                : isLow
                                  ? 'text-amber-700'
                                  : 'text-slate-900'
                            }`}
                          >
                            {item.availableStock}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">{item.unit}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-600">
                            {item.movementCount}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                            {new Date(item.lastUpdatedAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => void openMovementModal(item)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                            >
                              <History className="h-3 w-3" />
                              Movements
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                          No inventory items match the selected filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* B. PRODUCTION REQUESTS */}
          {subTab === 'requests' && (
            <Card
              title="Production Requests"
              subtitle="Created from Order Review; shared with Production Supervisor (Admin cannot execute or complete production)"
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Request ID</th>
                      <th className="px-4 py-2.5">Linked Order</th>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">Required Qty</th>
                      <th className="px-4 py-2.5">Request Date</th>
                      <th className="px-4 py-2.5">Request Status</th>
                      <th className="px-4 py-2.5">Supervisor Status</th>
                      <th className="px-4 py-2.5 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                          {req.requestNumber}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 tabular-nums">
                          {req.orderNumber}
                        </td>
                        <td className="px-4 py-2.5 text-slate-800">{req.productName}</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                          {req.requestedQuantity} {req.unit}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 tabular-nums">
                          {new Date(req.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <ProductionStatusBadge status={req.status} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {req.assignedSupervisorName
                            ? `${req.assignedSupervisorName} — ${req.supervisorStatus}`
                            : req.supervisorStatus ?? 'Unassigned'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedRequest(req)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="h-3 w-3" />
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                    {requests.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                          No production requests created yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* C. MATERIAL SHORTAGES & PROCUREMENT */}
          {subTab === 'shortages' && (
            <div className="space-y-5">
              <Card
                title="Material Shortage Queries"
                subtitle="Raw & packaging shortages from production requests. Only received purchases increase stock."
                noPadding
                action={
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openPoForShortage(undefined)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ShoppingBag className="h-3.5 w-3.5" />
                      New Purchase Order
                    </button>
                    <button
                      type="button"
                      onClick={() => openGrnModal(undefined)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-950 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
                    >
                      <PackagePlus className="h-3.5 w-3.5" />
                      Record Purchase Receipt
                    </button>
                  </div>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Material</th>
                        <th className="px-4 py-2.5 text-right">Required</th>
                        <th className="px-4 py-2.5 text-right">Available</th>
                        <th className="px-4 py-2.5 text-right">Shortage</th>
                        <th className="px-4 py-2.5">Linked Request / Order</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Coordinate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shortages.map((sq) => {
                        const badge = SHORTAGE_STATUS_TONES[sq.status];
                        return (
                          <tr key={sq.id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-900">{sq.materialName}</p>
                              <p className="text-[11px] text-slate-500">
                                {sq.materialSku} • {CATEGORY_LABELS[sq.category]}
                              </p>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {sq.requiredQuantity} {sq.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                              {sq.availableQuantity} {sq.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-rose-700">
                              {sq.shortageQuantity} {sq.unit}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-700 tabular-nums">
                              <span className="font-medium text-blue-900">{sq.requestNumber}</span>
                              <span className="block text-slate-500">Order {sq.orderNumber}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {sq.status !== 'RESOLVED' ? (
                                <button
                                  type="button"
                                  onClick={() => openPoForShortage(sq)}
                                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                                >
                                  Raise PO
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400">Sufficient</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {shortages.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                            No material shortage queries currently recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card
                  title="Purchase Orders"
                  subtitle="Purchase orders do not increase stock until a receipt is posted"
                  noPadding
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                        <tr>
                          <th className="px-3.5 py-2">PO #</th>
                          <th className="px-3.5 py-2">Supplier</th>
                          <th className="px-3.5 py-2">Items</th>
                          <th className="px-3.5 py-2">Status</th>
                          <th className="px-3.5 py-2 text-right">Receipt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {purchaseOrders.map((po) => (
                          <tr key={po.id}>
                            <td className="px-3.5 py-2.5 font-medium text-blue-900 tabular-nums">
                              {po.poNumber}
                            </td>
                            <td className="px-3.5 py-2.5 text-slate-700">{po.supplierName}</td>
                            <td className="px-3.5 py-2.5 text-slate-600">
                              {po.items
                                .map((i) => `${i.itemName} (${i.receivedQuantity}/${i.orderedQuantity} ${i.unit})`)
                                .join(', ')}
                            </td>
                            <td className="px-3.5 py-2.5">
                              <ToneBadge
                                tone={
                                  po.status === 'RECEIVED'
                                    ? 'success'
                                    : po.status === 'PARTIALLY_RECEIVED'
                                      ? 'warning'
                                      : 'neutral'
                                }
                              >
                                {po.status}
                              </ToneBadge>
                            </td>
                            <td className="px-3.5 py-2.5 text-right">
                              {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                                <button
                                  type="button"
                                  onClick={() => openGrnModal(po)}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-50"
                                >
                                  Receive Goods
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {purchaseOrders.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3.5 py-6 text-center text-slate-500">
                              No purchase orders raised yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card
                  title="Purchase Receipts (GRN)"
                  subtitle="Authorized goods receipts that credited inventory"
                  noPadding
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                        <tr>
                          <th className="px-3.5 py-2">GRN #</th>
                          <th className="px-3.5 py-2">Supplier</th>
                          <th className="px-3.5 py-2">Received Items</th>
                          <th className="px-3.5 py-2">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {purchaseReceipts.map((grn) => (
                          <tr key={grn.id}>
                            <td className="px-3.5 py-2.5 font-medium text-emerald-800 tabular-nums">
                              {grn.receiptNumber}
                            </td>
                            <td className="px-3.5 py-2.5 text-slate-700">{grn.supplierName}</td>
                            <td className="px-3.5 py-2.5 text-slate-600">
                              {grn.items
                                .map((i) => `${i.itemName} (+${i.receivedQuantity} ${i.unit})`)
                                .join(', ')}
                            </td>
                            <td className="px-3.5 py-2.5 text-slate-500 tabular-nums">
                              {grn.receivedDate}
                            </td>
                          </tr>
                        ))}
                        {purchaseReceipts.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-3.5 py-6 text-center text-slate-500">
                              No purchase receipts posted yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* D. PRODUCTION MONITORING */}
          {subTab === 'monitoring' && (
            <div className="space-y-5">
              <Card
                title="Production Queue & Status"
                subtitle="Read-only monitoring across all production request lifecycle stages"
                noPadding
                action={
                  <select
                    aria-label="Filter production status"
                    value={monitoringFilter}
                    onChange={(e) =>
                      setMonitoringFilter(e.target.value as 'ALL' | ProductionRequestStatus)
                    }
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-800 focus:outline-none"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PENDING_SUPERVISOR_REVIEW">Pending Review</option>
                    <option value="AWAITING_MATERIALS">Awaiting Materials</option>
                    <option value="READY_FOR_PRODUCTION">Ready for Production</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Request #</th>
                        <th className="px-4 py-2.5">Order #</th>
                        <th className="px-4 py-2.5">Product</th>
                        <th className="px-4 py-2.5 text-right">Planned Qty</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Supervisor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monitoringRequests.map((req) => (
                        <tr key={req.id}>
                          <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                            {req.requestNumber}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700 tabular-nums">
                            {req.orderNumber}
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">{req.productName}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {req.requestedQuantity} {req.unit}
                          </td>
                          <td className="px-4 py-2.5">
                            <ProductionStatusBadge status={req.status} />
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            {req.assignedSupervisorName ?? req.supervisorStatus ?? '—'}
                          </td>
                        </tr>
                      ))}
                      {monitoringRequests.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-500">
                            No production requests match this status.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card
                title="Completed Production Runs (Supervisor Submissions)"
                subtitle="Planned vs actual output, material consumption, wastage, and variance (read-only for Admin)"
                noPadding
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Run #</th>
                        <th className="px-4 py-2.5">Request / Order</th>
                        <th className="px-4 py-2.5">Product</th>
                        <th className="px-4 py-2.5 text-right">Planned</th>
                        <th className="px-4 py-2.5 text-right">Actual Output</th>
                        <th className="px-4 py-2.5 text-right">Wastage</th>
                        <th className="px-4 py-2.5 text-right">Variance</th>
                        <th className="px-4 py-2.5">Supervisor</th>
                        <th className="px-4 py-2.5 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {runs.map((run) => (
                        <tr key={run.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                            {run.runNumber}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 tabular-nums">
                            {run.requestNumber} / {run.orderNumber}
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">{run.productName}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {run.plannedQuantity} {run.unit}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                            {run.actualOutputQuantity} {run.unit}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                            {run.wastageQuantity} {run.unit}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                              run.varianceQuantity < 0 ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {run.varianceQuantity > 0 ? `+${run.varianceQuantity}` : run.varianceQuantity}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            {run.supervisorName}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedRun(run)}
                              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              View Consumption
                            </button>
                          </td>
                        </tr>
                      ))}
                      {runs.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                            No completed production runs posted by Production Supervisor yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* DISPATCH RELEASE (Approved Orders -> Stock Deduction on Dispatch Only) */}
          {subTab === 'dispatch' && (
            <Card
              title="Approved Orders Ready for Dispatch"
              subtitle="Only recording an actual dispatch deducts finished-goods stock and unlocks Accountant invoicing"
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Order #</th>
                      <th className="px-4 py-2.5">Customer</th>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">Requested</th>
                      <th className="px-4 py-2.5 text-right">Dispatched</th>
                      <th className="px-4 py-2.5 text-right">Remaining</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dispatchableOrders.map((ord) => {
                      const remaining = Math.max(0, ord.requestedQuantity - ord.dispatchedQuantity);
                      return (
                        <tr key={ord.id}>
                          <td className="px-4 py-2.5 font-medium text-blue-900 tabular-nums">
                            {ord.orderNumber}
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">{ord.customerName}</td>
                          <td className="px-4 py-2.5 text-slate-700">{ord.productName}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {ord.requestedQuantity} {ord.unit}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {ord.dispatchedQuantity} {ord.unit}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {remaining} {ord.unit}
                          </td>
                          <td className="px-4 py-2.5">
                            <OrderStatusBadge status={ord.status} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setDispatchOrder(ord);
                                setDispatchQty(String(remaining));
                                setDispatchNotes('');
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-blue-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-900"
                            >
                              <Truck className="h-3.5 w-3.5" />
                              Record Dispatch
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {dispatchableOrders.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                          No approved orders awaiting dispatch.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Stock Movement History Modal */}
      {movementItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl max-h-[85vh] flex flex-col">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Stock Movements — {movementItem.name} ({movementItem.sku})
                </h3>
                <p className="text-xs text-slate-500">
                  Current balance: {movementItem.availableStock} {movementItem.unit}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMovementItem(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="overflow-y-auto p-4">
              {movementsLoading ? (
                <p className="py-6 text-center text-xs text-slate-500">Loading movements...</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Change</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">Reason &amp; Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2 text-slate-500 tabular-nums whitespace-nowrap">
                          {new Date(m.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-700">
                          {m.movementType}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${
                            m.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          <span className="inline-flex items-center gap-0.5">
                            {m.direction === 'IN' ? (
                              <ArrowDownLeft className="h-3 w-3" />
                            ) : (
                              <ArrowUpRight className="h-3 w-3" />
                            )}
                            {m.direction === 'IN' ? '+' : '-'}
                            {m.quantity} {m.unit}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900 font-medium">
                          {m.balanceAfter} {m.unit}
                        </td>
                        <td className="px-3 py-2 font-mono text-blue-900">
                          {m.referenceNumber}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <p>{m.reason}</p>
                          <p className="text-[11px] text-slate-400">By {m.actorName}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Production Request Details Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {selectedRequest.requestNumber} — {selectedRequest.productName}
                </h3>
                <p className="text-xs text-slate-500">
                  Linked Order: {selectedRequest.orderNumber} • Required: {selectedRequest.requestedQuantity} {selectedRequest.unit}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRequest(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                <div>
                  <span className="text-slate-500">Request Status: </span>
                  <ProductionStatusBadge status={selectedRequest.status} />
                </div>
                <div>
                  <span className="text-slate-500">Supervisor Progress: </span>
                  <span className="font-medium text-slate-900">
                    {selectedRequest.assignedSupervisorName
                      ? `${selectedRequest.assignedSupervisorName} (${selectedRequest.supervisorStatus})`
                      : selectedRequest.supervisorStatus}
                  </span>
                </div>
              </div>

              {selectedRequest.bomMaterials && (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-left">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">BOM Material</th>
                        <th className="px-3 py-2 text-right">Required</th>
                        <th className="px-3 py-2 text-right">Available</th>
                        <th className="px-3 py-2">Readiness</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedRequest.bomMaterials.map((m) => (
                        <tr key={m.materialId}>
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {m.materialName} ({m.materialCode})
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {m.requiredQuantity} {m.unit}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {m.availableStock} {m.unit}
                          </td>
                          <td className="px-3 py-2">
                            <ToneBadge tone={m.isSufficient ? 'success' : 'danger'}>
                              {m.isSufficient ? 'Sufficient' : 'Shortage'}
                            </ToneBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-slate-500 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                Only the Production Supervisor can execute and post completion for this request.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Completed Production Run Modal */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {selectedRun.runNumber} — {selectedRun.productName}
                </h3>
                <p className="text-xs text-slate-500">
                  Posted by {selectedRun.supervisorName} on{' '}
                  {new Date(selectedRun.postedAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRun(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-4 gap-2.5">
                <div className="rounded border border-slate-200 p-2.5">
                  <p className="text-slate-500">Planned Output</p>
                  <p className="font-semibold text-sm tabular-nums">{selectedRun.plannedQuantity} {selectedRun.unit}</p>
                </div>
                <div className="rounded border border-slate-200 p-2.5">
                  <p className="text-slate-500">Actual Output</p>
                  <p className="font-semibold text-sm tabular-nums text-emerald-700">{selectedRun.actualOutputQuantity} {selectedRun.unit}</p>
                </div>
                <div className="rounded border border-slate-200 p-2.5">
                  <p className="text-slate-500">Wastage</p>
                  <p className="font-semibold text-sm tabular-nums text-amber-700">{selectedRun.wastageQuantity} {selectedRun.unit}</p>
                </div>
                <div className="rounded border border-slate-200 p-2.5">
                  <p className="text-slate-500">Variance</p>
                  <p className="font-semibold text-sm tabular-nums">{selectedRun.varianceQuantity} {selectedRun.unit}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Material Consumed</th>
                      <th className="px-3 py-2 text-right">Planned</th>
                      <th className="px-3 py-2 text-right">Actual Consumed</th>
                      <th className="px-3 py-2 text-right">Wastage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedRun.consumptions.map((c) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {c.materialName} ({c.sku})
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.plannedQuantity} {c.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {c.actualConsumedQuantity} {c.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {c.wastageQuantity} {c.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedRun.notes && (
                <p className="text-slate-600">
                  <span className="font-medium">Supervisor Note: </span>
                  {selectedRun.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Purchase Order Modal */}
      {poModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleCreatePo(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Create Purchase Order
              </h3>
              <button
                type="button"
                onClick={() => setPoModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
                Creating a Purchase Order coordinates procurement and does not increase stock until a Purchase Receipt is recorded.
              </p>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Supplier</label>
                <select
                  required
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Material</label>
                <select
                  required
                  value={poItemId}
                  onChange={(e) => setPoItemId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  {materialItems.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku}) — {m.unit}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Order Quantity</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={poQty}
                    onChange={(e) => setPoQty(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit Cost (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={poUnitCost}
                    onChange={(e) => setPoUnitCost(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setPoModalOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Save Purchase Order
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Post Purchase Receipt (GRN) Modal */}
      {grnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handlePostGrn(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Record Purchase Receipt (GRN)
              </h3>
              <button
                type="button"
                onClick={() => setGrnModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                Posting a Purchase Receipt adds stock via ledger movement and automatically recalculates open shortage queries.
              </p>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Supplier</label>
                <select
                  required
                  value={grnSupplierId}
                  onChange={(e) => setGrnSupplierId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Material Received</label>
                <select
                  required
                  value={grnItemId}
                  onChange={(e) => setGrnItemId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  {materialItems.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku}) — {m.unit}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Received Quantity</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={grnQty}
                  onChange={(e) => setGrnQty(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Receipt Note</label>
                <input
                  type="text"
                  value={grnNotes}
                  onChange={(e) => setGrnNotes(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setGrnModalOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1 rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                Post Purchase Receipt
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Dispatch Modal */}
      {dispatchOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleRecordDispatch(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Record Dispatch — {dispatchOrder.orderNumber}
              </h3>
              <button
                type="button"
                onClick={() => setDispatchOrder(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">
                Customer: <strong>{dispatchOrder.customerName}</strong> • Product:{' '}
                <strong>{dispatchOrder.productName}</strong>
              </p>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Quantity to Dispatch ({dispatchOrder.unit})
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={dispatchOrder.requestedQuantity - dispatchOrder.dispatchedQuantity}
                  value={dispatchQty}
                  onChange={(e) => setDispatchQty(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Gate Pass / Dispatch Note
                </label>
                <input
                  type="text"
                  value={dispatchNotes}
                  onChange={(e) => setDispatchNotes(e.target.value)}
                  placeholder="e.g., Gate Pass GP-901"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setDispatchOrder(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Confirm Dispatch &amp; Deduct FG Stock
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

