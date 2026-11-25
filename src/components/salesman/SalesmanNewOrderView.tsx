import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Minus,
  Phone,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type {
  SalesmanCustomer,
  SalesmanOrder,
  SalesmanProduct,
} from '../../types/orderAudit';
import { ProductImage } from '../ui/ProductImage';

export interface CartItem {
  product: SalesmanProduct;
  quantity: number;
}

interface SalesmanNewOrderViewProps {
  cart: CartItem[];
  onSetCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  onOrderCreated: (order: SalesmanOrder) => void;
  onViewOrder: (order: SalesmanOrder) => void;
}

type OrderFlowStep = 'browse' | 'review' | 'success';

function formatInr(val: number): string {
  return `₹${val.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function SalesmanNewOrderView({
  cart,
  onSetCart,
  onOrderCreated,
  onViewOrder,
}: SalesmanNewOrderViewProps) {
  const [step, setStep] = useState<OrderFlowStep>('browse');
  const [products, setProducts] = useState<SalesmanProduct[]>([]);
  const [customers, setCustomers] = useState<SalesmanCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [packFilter, setPackFilter] = useState<string>('ALL');

  // Mobile cart drawer
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Customer & Note
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerNote, setCustomerNote] = useState('');

  // Submit & Confirmation
  const [submitting, setSubmitting] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<SalesmanOrder | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      orderAuditService.listSalesmanProducts(),
      orderAuditService.listSalesmanCustomers(),
    ])
      .then(([prods, custs]) => {
        if (!active) return;
        setProducts(prods);
        setCustomers(custs);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load catalogue.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const packSizeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.packSize.trim()) set.add(p.packSize.trim());
    }
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (packFilter !== 'ALL' && p.packSize.trim() !== packFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.packSize.toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery, packFilter]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.contactPerson.toLowerCase().includes(q) ||
        c.deliveryAddress.toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const cartMap = useMemo(
    () => new Map(cart.map((c) => [c.product.id, c])),
    [cart]
  );

  const totalUnits = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const subtotal = useMemo(
    () =>
      Math.round(
        cart.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0) * 100
      ) / 100,
    [cart]
  );

  const addToCart = (product: SalesmanProduct) => {
    onSetCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, nextQty: number) => {
    if (!Number.isFinite(nextQty)) return;
    if (nextQty <= 0) {
      onSetCart((prev) => prev.filter((i) => i.product.id !== productId));
      return;
    }
    const clamped = Math.max(1, Math.round(nextQty));
    onSetCart((prev) =>
      prev.map((i) => (i.product.id === productId ? { ...i, quantity: clamped } : i))
    );
  };

  const removeFromCart = (productId: string) => {
    onSetCart((prev) => prev.filter((i) => i.product.id !== productId));
  };

  const handleSubmitOrder = async () => {
    if (!selectedCustomerId) {
      setError('Please select a customer before submitting.');
      return;
    }
    if (cart.length === 0) {
      setError('Please add at least one product to the order.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await orderAuditService.createSalesmanOrder({
        customerId: selectedCustomerId,
        items: cart.map((c) => ({
          productId: c.product.id,
          quantity: c.quantity,
        })),
        customerNote,
      });
      setSubmittedOrder(created);
      onSetCart([]);
      setCustomerNote('');
      setSelectedCustomerId('');
      onOrderCreated(created);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit order.');
    } finally {
      setSubmitting(false);
    }
  };

  const startAnotherOrder = () => {
    setSubmittedOrder(null);
    setError(null);
    setStep('browse');
  };

  // --- STEP 3: SUCCESS CONFIRMATION ---
  if (step === 'success' && submittedOrder) {
    return (
      <div className="mx-auto max-w-xl py-8 anim-scale-pop">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Order Submitted Successfully
            </p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {submittedOrder.orderNumber}
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Submitted for <strong>{submittedOrder.customerName}</strong> •{' '}
              {submittedOrder.items.length} product
              {submittedOrder.items.length > 1 ? 's' : ''} ({submittedOrder.requestedQuantity}{' '}
              total units) • Subtotal{' '}
              <strong>{formatInr(submittedOrder.subtotal)}</strong>
            </p>
          </div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            Order status is <strong>SUBMITTED</strong> and has been routed to the Admin team for stock availability and fulfillment review.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onViewOrder(submittedOrder)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 transition-colors"
            >
              View Order
            </button>
            <button
              type="button"
              onClick={startAnotherOrder}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Create Another Order
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- STEP 2: CUSTOMER SELECTION & ORDER REVIEW ---
  if (step === 'review') {
    return (
      <div className="space-y-5 anim-fade-in-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep('browse');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Edit Order / Back to Products
          </button>
          <span className="text-xs font-medium text-slate-500">
            Step 2 of 2 • Select Customer &amp; Confirm Order
          </span>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Customer Selection */}
          <div className="lg:col-span-6 space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  1. Select Customer
                </h2>
                <p className="text-xs text-slate-500">
                  Choose an active customer account from the directory.
                </p>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search customer by name, code, contact, or address..."
                  className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {filteredCustomers.map((cust) => {
                  const isSelected = cust.id === selectedCustomerId;
                  return (
                    <button
                      key={cust.id}
                      type="button"
                      onClick={() => {
                        setSelectedCustomerId(cust.id);
                        setError(null);
                      }}
                      className={`w-full text-left rounded-lg border p-3 transition-all ${
                        isSelected
                          ? 'border-blue-700 bg-blue-50/70 ring-1 ring-blue-700'
                          : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {cust.name}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {cust.code} • {cust.state}
                          </p>
                        </div>
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-700 px-2 py-0.5 text-[10px] font-semibold text-white">
                            <UserCheck className="h-3 w-3" />
                            Selected
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                        <p className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {cust.contactPerson} • {cust.phone}
                        </p>
                        <p className="flex items-start gap-1.5">
                          <MapPin className="h-3 w-3 text-slate-400 shrink-0 mt-0.5" />
                          <span>{cust.deliveryAddress}</span>
                        </p>
                      </div>
                    </button>
                  );
                })}
                {filteredCustomers.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No customers match your search.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Order Review Before Submission */}
          <div className="lg:col-span-6 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  2. Review Order Before Submission
                </h2>
                <p className="text-xs text-slate-500">
                  Verify customer, product quantities, and optional note.
                </p>
              </div>

              {selectedCustomer ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs">
                  <p className="font-semibold text-slate-900">
                    {selectedCustomer.name} ({selectedCustomer.code})
                  </p>
                  <p className="text-slate-600 mt-0.5">
                    {selectedCustomer.contactPerson} • {selectedCustomer.phone}
                  </p>
                  <p className="text-slate-600 mt-0.5">
                    Delivery: {selectedCustomer.deliveryAddress}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-800">
                  Please select a customer on the left to enable submission.
                </div>
              )}

              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {cart.map((item) => (
                  <div key={item.product.id} className="py-2.5 flex items-center gap-3">
                    <ProductImage
                      src={item.product.imageUrl}
                      alt={item.product.name}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {item.product.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {item.product.packSize || item.product.unit} •{' '}
                        {formatInr(item.product.sellingPrice)} × {item.quantity}{' '}
                        {item.product.unit}
                      </p>
                    </div>
                    <p className="text-xs font-semibold text-slate-900 tabular-nums">
                      {formatInr(item.product.sellingPrice * item.quantity)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Total Item Quantity</span>
                  <span className="font-medium tabular-nums">{totalUnits} units</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900">
                  <span>Order Subtotal</span>
                  <span className="tabular-nums">{formatInr(subtotal)}</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="salesman-order-note"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Customer Note (optional)
                </label>
                <textarea
                  id="salesman-order-note"
                  rows={2}
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                  placeholder="Delivery timing, packaging preference, or event note..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <button
                type="button"
                disabled={submitting || !selectedCustomer || cart.length === 0}
                onClick={() => void handleSubmitOrder()}
                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
              >
                {submitting ? 'Submitting Order...' : 'Confirm & Submit Order'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Shared Cart Summary Panel content
  const cartSummaryContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-blue-700" />
          <h2 className="text-sm font-semibold text-slate-900">Order Summary</h2>
        </div>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 tabular-nums">
          {cart.length} item{cart.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-4">
        {cart.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            Select products from the catalogue to build a customer order.
          </div>
        ) : (
          cart.map((item) => (
            <div key={item.product.id} className="py-3 space-y-2 anim-fade-in-up">
              <div className="flex items-start gap-2.5">
                <ProductImage
                  src={item.product.imageUrl}
                  alt={item.product.name}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {item.product.name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {item.product.packSize || item.product.unit} •{' '}
                    {formatInr(item.product.sellingPrice)}/{item.product.unit}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromCart(item.product.id)}
                  aria-label={`Remove ${item.product.name}`}
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50">
                  <button
                    type="button"
                    onClick={() =>
                      updateQuantity(item.product.id, item.quantity - 1)
                    }
                    aria-label={`Decrease quantity for ${item.product.name}`}
                    className="px-2 py-1 text-slate-600 hover:bg-white hover:text-slate-900 rounded-l-md transition-colors"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    aria-label={`Quantity for ${item.product.name}`}
                    value={item.quantity}
                    onChange={(e) => {
                      const val = Number.parseInt(e.target.value, 10);
                      if (!Number.isNaN(val) && val > 0) {
                        updateQuantity(item.product.id, val);
                      }
                    }}
                    className="w-12 bg-white py-0.5 text-center text-xs font-semibold tabular-nums text-slate-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateQuantity(item.product.id, item.quantity + 1)
                    }
                    aria-label={`Increase quantity for ${item.product.name}`}
                    className="px-2 py-1 text-slate-600 hover:bg-white hover:text-slate-900 rounded-r-md transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                <p className="text-xs font-bold text-slate-900 tabular-nums">
                  {formatInr(item.product.sellingPrice * item.quantity)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50/70 p-4 space-y-3">
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Total Units</span>
            <span className="font-semibold tabular-nums">{totalUnits}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-slate-900">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatInr(subtotal)}</span>
          </div>
        </div>
        <button
          type="button"
          disabled={cart.length === 0}
          onClick={() => {
            setMobileCartOpen(false);
            setError(null);
            setStep('review');
          }}
          className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
        >
          Select Customer &amp; Review Order
        </button>
      </div>
    </div>
  );

  // --- STEP 1: FLIPKART-INSPIRED PRODUCT BROWSING + PERSISTENT CART ---
  return (
    <div className="flex flex-col lg:flex-row gap-5 items-start anim-fade-in-up">
      {/* Left: Search, Filters & Product Grid */}
      <div className="flex-1 min-w-0 w-full space-y-4">
        {/* Search & Filter Bar */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[210px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Murukku, Mixture, SKU, or pack size..."
                className="w-full rounded-lg border border-slate-300 bg-slate-50/50 pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-700 focus:outline-none transition-colors"
              />
            </div>

            {(searchQuery || packFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setPackFilter('ALL');
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear Filters
              </button>
            )}
          </div>

          {packSizeOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPackFilter('ALL')}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  packFilter === 'ALL'
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                All Pack Sizes
              </button>
              {packSizeOptions.map((pack) => (
                <button
                  key={pack}
                  type="button"
                  onClick={() => setPackFilter(pack)}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                    packFilter === pack
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {pack}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Loading Skeletons */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 animate-pulse"
              >
                <div className="aspect-square w-full rounded-lg bg-slate-200" />
                <div className="h-4 w-3/4 rounded bg-slate-200" />
                <div className="h-3 w-1/2 rounded bg-slate-100" />
                <div className="h-9 w-full rounded-lg bg-slate-200" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProducts.map((product, idx) => {
              const inCart = cartMap.get(product.id);
              return (
                <article
                  key={product.id}
                  style={{ animationDelay: `${Math.min(idx, 8) * 45}ms` }}
                  className="group anim-stagger-card rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs hover:-translate-y-0.5 hover:shadow-md hover:border-blue-200 transition-all duration-200 flex flex-col"
                >
                  {/* Large Product Image */}
                  <div className="aspect-square w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
                    <ProductImage
                      src={product.imageUrl}
                      alt={product.name}
                      size="lg"
                      className="!h-full !w-full !rounded-none !border-0 transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>

                  {/* Product Info */}
                  <div className="mt-3 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                        {product.name}
                      </h3>
                      {product.packSize && (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {product.packSize}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] font-mono text-slate-400">
                      SKU: {product.sku}
                    </p>

                    <div className="mt-2.5 flex items-baseline justify-between">
                      <p className="text-base font-bold text-slate-900 tabular-nums">
                        {formatInr(product.sellingPrice)}
                        <span className="text-[11px] font-normal text-slate-500">
                          {' '}
                          / {product.unit}
                        </span>
                      </p>
                    </div>

                    {/* Add to Order / Quantity Stepper */}
                    <div className="mt-3 pt-1">
                      {!inCart ? (
                        <button
                          type="button"
                          onClick={() => addToCart(product)}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 active:scale-[0.98] transition-all"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add to Order
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/70 p-1 anim-scale-pop">
                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(product.id, inCart.quantity - 1)
                            }
                            aria-label={`Decrease ${product.name}`}
                            className="rounded-md bg-white p-1.5 text-blue-700 shadow-2xs hover:bg-blue-100 transition-colors"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Order quantity for ${product.name}`}
                            value={inCart.quantity}
                            onChange={(e) => {
                              const val = Number.parseInt(e.target.value, 10);
                              if (!Number.isNaN(val) && val > 0) {
                                updateQuantity(product.id, val);
                              }
                            }}
                            className="w-16 rounded border border-blue-200 bg-white py-1 text-center text-xs font-bold tabular-nums text-slate-900 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(product.id, inCart.quantity + 1)
                            }
                            aria-label={`Increase ${product.name}`}
                            className="rounded-md bg-white p-1.5 text-blue-700 shadow-2xs hover:bg-blue-100 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {filteredProducts.length === 0 && (
              <div className="col-span-full rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                No products match your search or pack-size filter.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Persistent Order Summary Panel */}
      <aside className="hidden lg:block w-80 shrink-0 sticky top-5 rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden max-h-[calc(100vh-7rem)]">
        {cartSummaryContent}
      </aside>

      {/* Mobile Floating Order Summary Bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-4 inset-x-4 z-30 lg:hidden anim-fade-in-up">
          <button
            type="button"
            onClick={() => setMobileCartOpen(true)}
            className="w-full flex items-center justify-between rounded-xl bg-blue-700 px-4 py-3 text-white shadow-lg"
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              <ShoppingCart className="h-4 w-4" />
              {cart.length} item{cart.length === 1 ? '' : 's'} ({totalUnits} units)
            </span>
            <span className="text-sm font-bold tabular-nums">
              {formatInr(subtotal)} • Review →
            </span>
          </button>
        </div>
      )}

      {/* Mobile Slide-Over Cart Drawer */}
      {mobileCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 lg:hidden">
          <div className="h-full w-full max-w-sm bg-white shadow-xl flex flex-col anim-slide-in-right">
            <div className="flex justify-end p-2 border-b border-slate-100">
              <button
                type="button"
                onClick={() => setMobileCartOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0">{cartSummaryContent}</div>
          </div>
        </div>
      )}
    </div>
  );
}
