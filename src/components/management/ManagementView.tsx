import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Eye,
  KeyRound,
  Lock,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  AuthUser,
  CatalogueProduct,
  Customer,
  InventoryItem,
  ManagedUser,
  Supplier,
  UserRole,
} from '../../types/orderAudit';
import { Card } from '../ui/Card';
import { ToneBadge } from '../ui/Badge';
import { ProductImage } from '../ui/ProductImage';

type ManagementTab = 'products' | 'customers' | 'suppliers' | 'users';

const INDIAN_STATES = [
  'Tamil Nadu',
  'Karnataka',
  'Kerala',
  'Andhra Pradesh',
  'Telangana',
  'Maharashtra',
  'Gujarat',
  'Delhi',
  'West Bengal',
  'Uttar Pradesh',
  'Rajasthan',
  'Puducherry',
];

export function ManagementView({
  currentUser,
  onDataChanged,
}: {
  currentUser: AuthUser;
  onDataChanged?: () => void;
}) {
  const [subTab, setSubTab] = useState<ManagementTab>('products');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [materials, setMaterials] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);

  // Product modal state
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<CatalogueProduct | null>(null);
  const [editingProdId, setEditingProdId] = useState<string | undefined>(undefined);
  const [pSku, setPSku] = useState('');
  const [pName, setPName] = useState('');
  const [pPackSize, setPPackSize] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pGst, setPGst] = useState('5');
  const [pHsn, setPHsn] = useState('21069099');
  const [pUnit, setPUnit] = useState('packets');
  const [pReorder, setPReorder] = useState('40');
  const [pImageUrl, setPImageUrl] = useState('');
  const [pImageUploading, setPImageUploading] = useState(false);
  const [pImageError, setPImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [pBom, setPBom] = useState<Array<{ materialId: string; quantityPerUnit: string }>>([]);

  // Customer modal state
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [editingCustId, setEditingCustId] = useState<string | undefined>(undefined);
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cContact, setCContact] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cGstin, setCGstin] = useState('');
  const [cBilling, setCBilling] = useState('');
  const [cDelivery, setCDelivery] = useState('');
  const [cState, setCState] = useState('Tamil Nadu');

  // Supplier modal state
  const [supModalOpen, setSupModalOpen] = useState(false);
  const [editingSupId, setEditingSupId] = useState<string | undefined>(undefined);
  const [sCode, setSCode] = useState('');
  const [sName, setSName] = useState('');
  const [sContact, setSContact] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sGstin, setSGstin] = useState('');
  const [sAddress, setSAddress] = useState('');
  const [sState, setSState] = useState('Tamil Nadu');
  const [sMaterials, setSMaterials] = useState<string[]>([]);
  const [historySupplier, setHistorySupplier] = useState<Supplier | null>(null);

  // User modal state (Owner/Super Admin only)
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [uUsername, setUUsername] = useState('');
  const [uFullName, setUFullName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uRole, setURole] = useState<UserRole>('ADMIN');
  const [uPassword, setUPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const isOwner = currentUser.role === 'OWNER_SUPER_ADMIN';

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prods, inv, custs, sups] = await Promise.all([
        orderAuditService.listCatalogueProducts(),
        orderAuditService.listInventoryItems(),
        orderAuditService.listCustomers(),
        orderAuditService.listSuppliers(),
      ]);
      setProducts(prods);
      setMaterials(inv.filter((i) => i.category !== 'FINISHED_GOOD'));
      setCustomers(custs);
      setSuppliers(sups);

      if (isOwner) {
        const uList = await orderAuditService.listUsers();
        setUsers(uList);
      } else {
        setUsers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load management data.');
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const activeMaterials = useMemo(() => materials.filter((m) => m.isActive), [materials]);

  // --- Product Handlers ---
  const openProductModal = (prod?: CatalogueProduct) => {
    setPImageError(null);
    if (prod) {
      setEditingProdId(prod.id);
      setPSku(prod.sku);
      setPName(prod.name);
      setPPackSize(prod.packSize);
      setPPrice(String(prod.sellingPrice));
      setPGst(String(prod.gstRate));
      setPHsn(prod.hsnCode);
      setPUnit(prod.unit);
      setPReorder(String(prod.reorderLevel));
      setPImageUrl(prod.imageUrl ?? '');
      setPBom(
        prod.bomItems.map((b) => ({
          materialId: b.materialId,
          quantityPerUnit: String(b.quantityPerUnit),
        }))
      );
    } else {
      setEditingProdId(undefined);
      setPSku('');
      setPName('');
      setPPackSize('');
      setPPrice('');
      setPGst('5');
      setPHsn('21069099');
      setPUnit('packets');
      setPReorder('40');
      setPImageUrl('');
      setPBom([]);
    }
    setProdModalOpen(true);
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPImageError(null);
    setPImageUploading(true);
    try {
      const uploaded = await orderAuditService.uploadProductImage(file);
      setPImageUrl(uploaded.imageUrl);
    } catch (err) {
      setPImageError(
        err instanceof Error ? err.message : 'Unable to upload product image.'
      );
    } finally {
      setPImageUploading(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await orderAuditService.saveCatalogueProduct({
        id: editingProdId,
        sku: pSku,
        name: pName,
        packSize: pPackSize,
        sellingPrice: Number(pPrice),
        gstRate: Number(pGst),
        hsnCode: pHsn,
        imageUrl: pImageUrl,
        unit: pUnit,
        reorderLevel: Number(pReorder || 0),
        bomItems: pBom
          .filter((b) => b.materialId && Number(b.quantityPerUnit) > 0)
          .map((b) => ({
            materialId: b.materialId,
            quantityPerUnit: Number(b.quantityPerUnit),
          })),
      });
      setProdModalOpen(false);
      setBannerMsg(
        editingProdId
          ? 'Product catalogue and BOM updated.'
          : 'Product added to catalogue with 0 initial inventory (no stock auto-created).'
      );
      await loadAll();
      onDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleProduct = async (prod: CatalogueProduct) => {
    setError(null);
    try {
      await orderAuditService.toggleProductStatus(prod.id, !prod.isActive);
      await loadAll();
      onDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update product status.');
    }
  };

  // --- Customer Handlers ---
  const openCustomerModal = (cust?: Customer) => {
    if (cust) {
      setEditingCustId(cust.id);
      setCCode(cust.code);
      setCName(cust.name);
      setCContact(cust.contactPerson);
      setCPhone(cust.phone);
      setCEmail(cust.email);
      setCGstin(cust.gstin);
      setCBilling(cust.billingAddress);
      setCDelivery(cust.deliveryAddress);
      setCState(cust.state);
    } else {
      setEditingCustId(undefined);
      setCCode('');
      setCName('');
      setCContact('');
      setCPhone('');
      setCEmail('');
      setCGstin('');
      setCBilling('');
      setCDelivery('');
      setCState('Tamil Nadu');
    }
    setCustModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await orderAuditService.saveCustomer({
        id: editingCustId,
        code: cCode,
        name: cName,
        contactPerson: cContact,
        phone: cPhone,
        email: cEmail,
        gstin: cGstin,
        billingAddress: cBilling,
        deliveryAddress: cDelivery || cBilling,
        state: cState,
      });
      setCustModalOpen(false);
      setBannerMsg(editingCustId ? 'Customer record updated.' : 'Customer added.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleCustomer = async (cust: Customer) => {
    setError(null);
    try {
      await orderAuditService.toggleCustomerStatus(cust.id, !cust.isActive);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update customer status.');
    }
  };

  // --- Supplier Handlers ---
  const openSupplierModal = (sup?: Supplier) => {
    if (sup) {
      setEditingSupId(sup.id);
      setSCode(sup.code);
      setSName(sup.name);
      setSContact(sup.contactPerson);
      setSPhone(sup.phone);
      setSEmail(sup.email);
      setSGstin(sup.gstin);
      setSAddress(sup.address);
      setSState(sup.state);
      setSMaterials(sup.suppliedMaterials.map((m) => m.id));
    } else {
      setEditingSupId(undefined);
      setSCode('');
      setSName('');
      setSContact('');
      setSPhone('');
      setSEmail('');
      setSGstin('');
      setSAddress('');
      setSState('Tamil Nadu');
      setSMaterials([]);
    }
    setSupModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await orderAuditService.saveSupplier({
        id: editingSupId,
        code: sCode,
        name: sName,
        contactPerson: sContact,
        phone: sPhone,
        email: sEmail,
        gstin: sGstin,
        address: sAddress,
        state: sState,
        materialIds: sMaterials,
      });
      setSupModalOpen(false);
      setBannerMsg(editingSupId ? 'Supplier updated.' : 'Supplier added.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save supplier.');
    } finally {
      setSubmitting(false);
    }
  };

  // --- User Handlers (Owner / Super Admin only) ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await orderAuditService.createUser({
        username: uUsername,
        fullName: uFullName,
        email: uEmail,
        role: uRole,
        password: uPassword,
      });
      setUserModalOpen(false);
      setUUsername('');
      setUFullName('');
      setUEmail('');
      setUPassword('');
      setBannerMsg('User account created.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateUser = async (
    userId: string,
    payload: { role?: UserRole; isActive?: boolean }
  ) => {
    setError(null);
    try {
      await orderAuditService.updateUser(userId, payload);
      setBannerMsg('User account updated.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    }
  };

  const handleResetAccess = async (user: ManagedUser) => {
    setError(null);
    try {
      const res = await orderAuditService.resetUserAccess(user.id);
      setBannerMsg(
        `Access reset for ${user.email}. Temporary password: ${res.temporaryPassword}`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset access.');
    }
  };

  return (
    <div className="space-y-4">
      {/* 4 Management Subsections */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2.5">
        {(
          [
            { id: 'products', label: 'Product Catalogue' },
            { id: 'customers', label: 'Customers' },
            { id: 'suppliers', label: 'Suppliers' },
            { id: 'users', label: 'User Management' },
          ] as Array<{ id: ManagementTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
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
          <button type="button" onClick={() => setBannerMsg(null)}>
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
          Loading Master Data...
        </div>
      ) : (
        <>
          {/* A. PRODUCT CATALOGUE */}
          {subTab === 'products' && (
            <Card
              title="Product Catalogue & Bill of Materials (BOM)"
              subtitle="Adding a product registers SKU, GST, HSN, and BOM without creating stock"
              noPadding
              action={
                <button
                  type="button"
                  onClick={() => openProductModal()}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Product
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5">Pack Size</th>
                      <th className="px-4 py-2.5 text-right">Selling Price</th>
                      <th className="px-4 py-2.5 text-right">GST %</th>
                      <th className="px-4 py-2.5">HSN</th>
                      <th className="px-4 py-2.5">BOM</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.map((prod) => (
                      <tr key={prod.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <ProductImage
                              src={prod.imageUrl}
                              alt={prod.name}
                              size="sm"
                            />
                            <div>
                              <p className="font-medium text-slate-900">{prod.name}</p>
                              <p className="text-[11px] font-mono text-slate-500">{prod.sku}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {prod.packSize || '—'} ({prod.unit})
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          ₹{prod.sellingPrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{prod.gstRate}%</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                          {prod.hsnCode}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {prod.bomItems.length} component{prod.bomItems.length === 1 ? '' : 's'}
                        </td>
                        <td className="px-4 py-2.5">
                          <ToneBadge tone={prod.isActive ? 'success' : 'neutral'}>
                            {prod.isActive ? 'Active' : 'Inactive'}
                          </ToneBadge>
                        </td>
                        <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(prod)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="h-3 w-3" />
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={() => openProductModal(prod)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                          >
                            Edit / BOM
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleProduct(prod)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {prod.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* B. CUSTOMERS */}
          {subTab === 'customers' && (
            <Card
              title="Customers & Place-of-Supply Directory"
              subtitle="Customer state determines intra-state (CGST+SGST) vs inter-state (IGST) tax treatment"
              noPadding
              action={
                <button
                  type="button"
                  onClick={() => openCustomerModal()}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Customer
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Code / Customer</th>
                      <th className="px-4 py-2.5">Contact</th>
                      <th className="px-4 py-2.5">GSTIN</th>
                      <th className="px-4 py-2.5">State / Place of Supply</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-900">{c.name}</p>
                          <p className="text-[11px] font-mono text-slate-500">{c.code}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          <p>{c.contactPerson}</p>
                          <p>{c.phone}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                          {c.gstin || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-700">
                          {c.state} ({c.stateCode})
                        </td>
                        <td className="px-4 py-2.5">
                          <ToneBadge tone={c.isActive ? 'success' : 'neutral'}>
                            {c.isActive ? 'Active' : 'Inactive'}
                          </ToneBadge>
                        </td>
                        <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openCustomerModal(c)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleCustomer(c)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {c.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* C. SUPPLIERS */}
          {subTab === 'suppliers' && (
            <Card
              title="Suppliers & Supplied Materials"
              subtitle="Associate raw and packaging materials with authorized suppliers and review purchase history"
              noPadding
              action={
                <button
                  type="button"
                  onClick={() => openSupplierModal()}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Supplier
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Code / Supplier</th>
                      <th className="px-4 py-2.5">Contact</th>
                      <th className="px-4 py-2.5">GSTIN</th>
                      <th className="px-4 py-2.5">Supplied Materials</th>
                      <th className="px-4 py-2.5">Purchase History</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-900">{s.name}</p>
                          <p className="text-[11px] font-mono text-slate-500">{s.code}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          <p>{s.contactPerson}</p>
                          <p>{s.phone}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                          {s.gstin || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 max-w-xs">
                          {s.suppliedMaterials.map((m) => m.name).join(', ') || 'None linked'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {s.purchaseOrders.length} PO / {s.purchaseReceipts.length} GRN
                        </td>
                        <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openSupplierModal(s)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setHistorySupplier(s)}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            History
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* D. USER MANAGEMENT (OWNER / SUPER ADMIN ONLY) */}
          {subTab === 'users' && (
            <>
              {!isOwner ? (
                <Card title="User Management (Restricted)">
                  <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">
                        Owner / Super Admin Authorization Required
                      </p>
                      <p className="mt-1">
                        Your current role is <strong>{currentUser.role}</strong>. Creating users,
                        assigning roles, toggling account status, and resetting access are
                        enforced exclusively for <strong>OWNER_SUPER_ADMIN</strong> on the backend.
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card
                  title="User Accounts & Role-Based Access"
                  subtitle="Enforced on backend API routes for Owner/Super Admin only"
                  noPadding
                  action={
                    <button
                      type="button"
                      onClick={() => setUserModalOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create User
                    </button>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5">User</th>
                          <th className="px-4 py-2.5">Email</th>
                          <th className="px-4 py-2.5">Role</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {users.map((u) => (
                          <tr key={u.id}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-900">{u.fullName}</p>
                              <p className="text-[11px] font-mono text-slate-500">@{u.username}</p>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">{u.email}</td>
                            <td className="px-4 py-2.5">
                              <select
                                aria-label={`Role for ${u.username}`}
                                value={u.role}
                                onChange={(e) =>
                                  void handleUpdateUser(u.id, {
                                    role: e.target.value as UserRole,
                                  })
                                }
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                              >
                                <option value="OWNER_SUPER_ADMIN">OWNER_SUPER_ADMIN</option>
                                <option value="ADMIN">ADMIN</option>
                                <option value="PRODUCTION_SUPERVISOR">PRODUCTION_SUPERVISOR</option>
                                <option value="ACCOUNTANT">ACCOUNTANT</option>
                                <option value="SALESMAN">SALESMAN</option>
                              </select>
                            </td>
                            <td className="px-4 py-2.5">
                              <ToneBadge tone={u.isActive ? 'success' : 'danger'}>
                                {u.isActive ? 'Active' : 'Deactivated'}
                              </ToneBadge>
                            </td>
                            <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateUser(u.id, { isActive: !u.isActive })
                                }
                                disabled={u.id === currentUser.id}
                                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                              >
                                {u.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleResetAccess(u)}
                                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50"
                              >
                                <KeyRound className="h-3 w-3" />
                                Reset Access
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Product Details Modal (Larger Image + Full Specs + BOM) */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {detailProduct.name}
                </h3>
                <p className="text-xs font-mono text-slate-500">{detailProduct.sku}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailProduct(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-4 text-xs">
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <ProductImage
                  src={detailProduct.imageUrl}
                  alt={detailProduct.name}
                  size="lg"
                />
                <dl className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <div>
                    <dt className="text-slate-500">Pack Size</dt>
                    <dd className="font-medium text-slate-900">
                      {detailProduct.packSize || '—'} ({detailProduct.unit})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Status</dt>
                    <dd className="mt-0.5">
                      <ToneBadge tone={detailProduct.isActive ? 'success' : 'neutral'}>
                        {detailProduct.isActive ? 'Active' : 'Inactive'}
                      </ToneBadge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Selling Price</dt>
                    <dd className="font-semibold text-slate-900 tabular-nums">
                      ₹{detailProduct.sellingPrice.toFixed(2)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">GST Rate / HSN</dt>
                    <dd className="font-medium text-slate-900 tabular-nums">
                      {detailProduct.gstRate}% • {detailProduct.hsnCode}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Current Stock</dt>
                    <dd className="font-medium text-slate-900 tabular-nums">
                      {detailProduct.availableStock} {detailProduct.unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Reorder Level</dt>
                    <dd className="font-medium text-slate-900 tabular-nums">
                      {detailProduct.reorderLevel} {detailProduct.unit}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <p className="font-semibold text-slate-800 mb-2">
                  Bill of Materials (per 1 {detailProduct.unit})
                </p>
                {detailProduct.bomItems.length === 0 ? (
                  <p className="text-slate-500">No BOM components linked.</p>
                ) : (
                  <div className="overflow-x-auto rounded border border-slate-200">
                    <table className="w-full text-left">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-1.5">Material</th>
                          <th className="px-3 py-1.5">SKU</th>
                          <th className="px-3 py-1.5 text-right">Qty / Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailProduct.bomItems.map((b) => (
                          <tr key={b.id}>
                            <td className="px-3 py-1.5 font-medium text-slate-800">
                              {b.materialName}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-500">
                              {b.materialSku}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {b.quantityPerUnit} {b.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setDetailProduct(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = detailProduct;
                  setDetailProduct(null);
                  openProductModal(target);
                }}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
              >
                Edit Product &amp; Image
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Product + BOM Modal */}
      {prodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSaveProduct(e)}
            className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl my-auto"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingProdId ? 'Edit Product & BOM' : 'Add Product to Catalogue'}
              </h3>
              <button
                type="button"
                onClick={() => setProdModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              {!editingProdId && (
                <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
                  Adding a product creates a catalogue definition with <strong>0 stock</strong>. Stock increases only via posted production runs.
                </p>
              )}

              {/* Product Image Upload / Preview */}
              <div className="flex flex-wrap items-center gap-4 rounded-md border border-slate-200 bg-slate-50/70 p-3">
                <ProductImage
                  src={pImageUrl || undefined}
                  alt={pName || 'Product preview'}
                  size="md"
                />
                <div className="flex-1 min-w-[200px] space-y-2">
                  <div>
                    <p className="font-semibold text-slate-800">Product Image</p>
                    <p className="text-[11px] text-slate-500">
                      JPG, JPEG, PNG, or WEBP • Max 2 MB • Aspect-square cover
                    </p>
                  </div>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    onChange={(e) => void handleImageFileSelect(e)}
                    className="hidden"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={pImageUploading}
                      onClick={() => imageInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {pImageUploading
                        ? 'Uploading...'
                        : pImageUrl
                          ? 'Replace Image'
                          : 'Upload Image'}
                    </button>
                    {pImageUrl && (
                      <button
                        type="button"
                        disabled={pImageUploading}
                        onClick={() => {
                          setPImageUrl('');
                          setPImageError(null);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove Image
                      </button>
                    )}
                  </div>
                  {pImageError && (
                    <p className="text-[11px] font-medium text-rose-700">{pImageError}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">SKU</label>
                  <input
                    required
                    value={pSku}
                    onChange={(e) => setPSku(e.target.value)}
                    placeholder="NITT-THP-200"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Product Name</label>
                  <input
                    required
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="Thattai 200 g"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pack Size</label>
                  <input
                    value={pPackSize}
                    onChange={(e) => setPPackSize(e.target.value)}
                    placeholder="200 g"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit of Measure</label>
                  <input
                    required
                    value={pUnit}
                    onChange={(e) => setPUnit(e.target.value)}
                    placeholder="packets"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Selling Price (₹)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={pPrice}
                    onChange={(e) => setPPrice(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">GST Rate (%)</label>
                  <input
                    required
                    type="number"
                    step="0.5"
                    min="0"
                    max="28"
                    value={pGst}
                    onChange={(e) => setPGst(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">HSN Code</label>
                  <input
                    required
                    value={pHsn}
                    onChange={(e) => setPHsn(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reorder Level</label>
                  <input
                    type="number"
                    min="0"
                    value={pReorder}
                    onChange={(e) => setPReorder(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-800">
                    Bill of Materials (per 1 {pUnit || 'unit'})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPBom([
                        ...pBom,
                        { materialId: activeMaterials[0]?.id ?? '', quantityPerUnit: '0.1' },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-50"
                  >
                    <Plus className="h-3 w-3" />
                    Add Material
                  </button>
                </div>
                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {pBom.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={line.materialId}
                        onChange={(e) => {
                          const next = [...pBom];
                          next[idx] = { ...next[idx], materialId: e.target.value };
                          setPBom(next);
                        }}
                        className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        {activeMaterials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.unit})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        value={line.quantityPerUnit}
                        onChange={(e) => {
                          const next = [...pBom];
                          next[idx] = { ...next[idx], quantityPerUnit: e.target.value };
                          setPBom(next);
                        }}
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-xs text-right"
                      />
                      <button
                        type="button"
                        onClick={() => setPBom(pBom.filter((_, i) => i !== idx))}
                        className="rounded p-1 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {pBom.length === 0 && (
                    <p className="text-slate-400">No BOM materials linked yet.</p>
                  )}
                </div>
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setProdModalOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Save Product
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Customer Modal */}
      {custModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSaveCustomer(e)}
            className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl my-auto"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingCustId ? 'Edit Customer' : 'Add Customer'}
              </h3>
              <button
                type="button"
                onClick={() => setCustModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Customer Code</label>
                <input
                  required
                  value={cCode}
                  onChange={(e) => setCCode(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Customer Name</label>
                <input
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Contact Person</label>
                <input
                  required
                  value={cContact}
                  onChange={(e) => setCContact(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Phone</label>
                <input
                  required
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">GSTIN (optional)</label>
                <input
                  value={cGstin}
                  onChange={(e) => setCGstin(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm uppercase"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">
                  State / Place of Supply
                </label>
                <select
                  value={cState}
                  onChange={(e) => setCState(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st} {st === 'Tamil Nadu' ? '(Intra-State: CGST+SGST)' : '(Inter-State: IGST)'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Billing Address</label>
                <input
                  required
                  value={cBilling}
                  onChange={(e) => setCBilling(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Delivery Address</label>
                <input
                  required
                  value={cDelivery}
                  onChange={(e) => setCDelivery(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setCustModalOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Save Customer
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Supplier Modal */}
      {supModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSaveSupplier(e)}
            className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl my-auto"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingSupId ? 'Edit Supplier' : 'Add Supplier'}
              </h3>
              <button
                type="button"
                onClick={() => setSupModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Supplier Code</label>
                <input
                  required
                  value={sCode}
                  onChange={(e) => setSCode(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Supplier Name</label>
                <input
                  required
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Contact Person</label>
                <input
                  required
                  value={sContact}
                  onChange={(e) => setSContact(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Phone</label>
                <input
                  required
                  value={sPhone}
                  onChange={(e) => setSPhone(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={sEmail}
                  onChange={(e) => setSEmail(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">GSTIN</label>
                <input
                  value={sGstin}
                  onChange={(e) => setSGstin(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm uppercase"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Address</label>
                <input
                  required
                  value={sAddress}
                  onChange={(e) => setSAddress(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium text-slate-700 mb-1">
                  Supplied Raw &amp; Packaging Materials
                </label>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto rounded border border-slate-200 p-2">
                  {activeMaterials.map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={sMaterials.includes(m.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSMaterials([...sMaterials, m.id]);
                          } else {
                            setSMaterials(sMaterials.filter((id) => id !== m.id));
                          }
                        }}
                      />
                      <span>{m.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setSupModalOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Save Supplier
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Supplier Purchase History Modal */}
      {historySupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Purchase History — {historySupplier.name}
              </h3>
              <button
                type="button"
                onClick={() => setHistorySupplier(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <p className="font-semibold text-slate-700 mb-1">Purchase Orders</p>
                {historySupplier.purchaseOrders.length === 0 ? (
                  <p className="text-slate-400">No purchase orders recorded.</p>
                ) : (
                  <ul className="space-y-1">
                    {historySupplier.purchaseOrders.map((po) => (
                      <li key={po.id} className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="font-medium text-blue-900">{po.po_number}</span>
                        <span>{po.order_date} • {po.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Purchase Receipts (GRN)</p>
                {historySupplier.purchaseReceipts.length === 0 ? (
                  <p className="text-slate-400">No receipts posted yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {historySupplier.purchaseReceipts.map((grn) => (
                      <li key={grn.id} className="flex justify-between border-b border-slate-100 pb-1">
                        <span className="font-medium text-emerald-800">{grn.receipt_number}</span>
                        <span>{grn.received_date}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal (Owner Only) */}
      {userModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void handleCreateUser(e)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-blue-900" />
                <h3 className="text-sm font-semibold text-slate-900">Create User Account</h3>
              </div>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Username</label>
                <input
                  required
                  value={uUsername}
                  onChange={(e) => setUUsername(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  required
                  value={uFullName}
                  onChange={(e) => setUFullName(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Email</label>
                <input
                  required
                  type="email"
                  value={uEmail}
                  onChange={(e) => setUEmail(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Role</label>
                <select
                  value={uRole}
                  onChange={(e) => setURole(e.target.value as UserRole)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="PRODUCTION_SUPERVISOR">PRODUCTION_SUPERVISOR</option>
                  <option value="ACCOUNTANT">ACCOUNTANT</option>
                  <option value="SALESMAN">SALESMAN</option>
                  <option value="OWNER_SUPER_ADMIN">OWNER_SUPER_ADMIN</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Initial Password</label>
                <input
                  required
                  type="password"
                  value={uPassword}
                  onChange={(e) => setUPassword(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                Create Account
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

