import type {
  AccountantDashboardData,
  AuthUser,
  BillingWorkspaceData,
  BomRevisionRequest,
  CatalogueProduct,
  Customer,
  CustomerReceivableSummary,
  DashboardSummary,
  DispatchInvoicePreview,
  DispatchRecord,
  FinancialReportsData,
  InventoryItem,
  ManagedUser,
  MaterialPurchaseRequirement,
  MaterialShortageQuery,
  Order,
  OrderDecisionPayload,
  OrderShortageAnalysis,
  Product,
  ProductionRequest,
  ProductionRun,
  ProductionRunDraftPayload,
  PurchaseOrder,
  PurchaseReceipt,
  SalesmanCustomer,
  SalesmanDashboardData,
  SalesmanOrder,
  SalesmanProduct,
  StockDiscrepancyReport,
  StockMovement,
  SupervisorDashboardData,
  Supplier,
  UserRole,
} from '../types/orderAudit';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';
const TOKEN_STORAGE_KEY = 'nitt_order_audit_token';

export interface OrderAuditSnapshot {
  orders: Order[];
  products: Product[];
  productionRequests: ProductionRequest[];
  dashboardSummary: DashboardSummary;
}

let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  if (typeof window !== 'undefined' && window.localStorage) {
    memoryToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return memoryToken;
  }
  return null;
}

export function setAuthToken(token: string | null): void {
  memoryToken = token;
  if (typeof window !== 'undefined' && window.localStorage) {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `API request failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) errorMsg = data.error;
    } catch {
      const text = await response.text();
      if (text) errorMsg = text;
    }
    throw new Error(errorMsg);
  }

  return (await response.json()) as T;
}

export const orderAuditService = {
  // --- Auth ---
  async login(identifier: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const res = await fetchJson<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, password }),
    });
    setAuthToken(res.token);
    return res;
  },

  async logout(): Promise<void> {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
    }
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!getAuthToken()) return null;
    try {
      const res = await fetchJson<{ user: AuthUser }>('/api/auth/me');
      return res.user;
    } catch {
      setAuthToken(null);
      return null;
    }
  },

  // --- Dashboard & Orders ---
  async loadWorkspaceState(): Promise<OrderAuditSnapshot> {
    const [dashboardSummary, orders] = await Promise.all([
      fetchJson<DashboardSummary>('/api/admin/dashboard'),
      fetchJson<Order[]>('/api/orders'),
    ]);
    return {
      orders,
      products: dashboardSummary.finishedGoodsStock,
      productionRequests: dashboardSummary.productionRequests,
      dashboardSummary: { ...dashboardSummary, dataSourceMode: 'BACKEND_API' },
    };
  },

  async checkOrderAvailability(orderId: string): Promise<OrderShortageAnalysis> {
    return fetchJson<OrderShortageAnalysis>(
      `/api/orders/${encodeURIComponent(orderId)}/availability`
    );
  },

  async submitOrderDecision(payload: OrderDecisionPayload): Promise<{
    snapshot: OrderAuditSnapshot;
    createdRequestId?: string;
  }> {
    const res = await fetchJson<{ orderId: string; status: string; createdRequestId?: string }>(
      `/api/orders/${encodeURIComponent(payload.orderId)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: payload.decision, note: payload.note }),
      }
    );
    const snapshot = await this.loadWorkspaceState();
    return { snapshot, createdRequestId: res.createdRequestId };
  },

  // --- Production & Stock ---
  async listInventoryItems(): Promise<InventoryItem[]> {
    return fetchJson<InventoryItem[]>('/api/inventory/items');
  },

  async listStockMovements(itemId?: string): Promise<StockMovement[]> {
    const query = itemId ? `?itemId=${encodeURIComponent(itemId)}` : '';
    return fetchJson<StockMovement[]>(`/api/inventory/movements${query}`);
  },

  async listProductionRequests(): Promise<ProductionRequest[]> {
    return fetchJson<ProductionRequest[]>('/api/production-requests');
  },

  async listMaterialShortages(): Promise<MaterialShortageQuery[]> {
    return fetchJson<MaterialShortageQuery[]>('/api/material-shortages');
  },

  async listPurchaseOrders(): Promise<PurchaseOrder[]> {
    return fetchJson<PurchaseOrder[]>('/api/purchase-orders');
  },

  async createPurchaseOrder(payload: {
    supplierId: string;
    items: Array<{ itemId: string; orderedQuantity: number; unitCost?: number }>;
    shortageQueryIds?: string[];
    purchaseRequirementIds?: string[];
    notes?: string;
  }): Promise<{ id: string; poNumber: string; approvalStatus?: string }> {
    return fetchJson('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async approvePurchaseOrderByOwner(
    poId: string,
    approve: boolean,
    note?: string
  ): Promise<{ id: string; poNumber: string; approvalStatus: string }> {
    return fetchJson(`/api/purchase-orders/${encodeURIComponent(poId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approve, note }),
    });
  },

  async listPurchaseReceipts(): Promise<PurchaseReceipt[]> {
    return fetchJson<PurchaseReceipt[]>('/api/purchase-receipts');
  },

  async postPurchaseReceipt(payload: {
    supplierId: string;
    purchaseOrderId?: string;
    items: Array<{ itemId: string; receivedQuantity: number; unitCost?: number }>;
    idempotencyKey?: string;
    notes?: string;
  }): Promise<{ id: string; receiptNumber: string }> {
    return fetchJson('/api/purchase-receipts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listProductionRuns(): Promise<ProductionRun[]> {
    return fetchJson<ProductionRun[]>('/api/production-runs');
  },

  async updateProductionRequestStatus(
    requestId: string,
    status:
      | 'PENDING_MATERIAL_CHECK'
      | 'MATERIAL_SHORTAGE'
      | 'READY_FOR_PRODUCTION'
      | 'IN_PROGRESS'
      | 'CANCELLED',
    notes?: string
  ): Promise<{ id: string; status: string }> {
    return fetchJson(`/api/production-requests/${encodeURIComponent(requestId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes }),
    });
  },

  async postProductionRun(payload: {
    productionRequestId: string;
    actualOutputQuantity?: number;
    goodOutputQuantity?: number;
    rejectedQuantity?: number;
    damagedPackagingQuantity?: number;
    wastageQuantity?: number;
    qualityResult?: 'PASSED' | 'CONDITIONAL' | 'FAILED';
    completionStatus?: 'COMPLETED' | 'PARTIALLY_COMPLETED';
    consumptions?: Array<{
      materialId: string;
      actualConsumedQuantity: number;
      additionalConsumedQuantity?: number;
      damagedQuantity?: number;
      wastageQuantity?: number;
      reason?: string;
    }>;
    notes?: string;
    varianceExplanation?: string;
    idempotencyKey?: string;
  }): Promise<{ id: string; runNumber: string; status?: string }> {
    return fetchJson('/api/production-runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // --- Production Supervisor & Material/BOM Review Workflows ---
  async loadSupervisorDashboard(): Promise<SupervisorDashboardData> {
    return fetchJson<SupervisorDashboardData>('/api/supervisor/dashboard');
  },

  async checkProductionRequestAvailability(requestId: string): Promise<{
    productionRequestId: string;
    requestNumber: string;
    bomVersion: string;
    rawMaterialAvailability: 'SUFFICIENT' | 'INSUFFICIENT';
    nextStatus: string;
    bomBreakdown: Array<{
      materialId: string;
      materialCode: string;
      materialName: string;
      category: string;
      unit: string;
      quantityPerUnit: number;
      requiredQuantity: number;
      availableStock: number;
      shortfallQuantity: number;
      isSufficient: boolean;
    }>;
  }> {
    return fetchJson(
      `/api/supervisor/production-requests/${encodeURIComponent(requestId)}/check-availability`,
      { method: 'POST' }
    );
  },

  async listMaterialPurchaseRequirements(): Promise<MaterialPurchaseRequirement[]> {
    return fetchJson<MaterialPurchaseRequirement[]>('/api/purchase-requirements');
  },

  async createMaterialPurchaseRequirement(payload: {
    productionRequestId: string;
    materialId: string;
    requiredQuantity?: number;
    shortageQuantity?: number;
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    reason?: string;
  }): Promise<{ id: string; requirementNumber: string }> {
    return fetchJson('/api/purchase-requirements', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listStockDiscrepancies(): Promise<StockDiscrepancyReport[]> {
    return fetchJson<StockDiscrepancyReport[]>('/api/stock-discrepancies');
  },

  async createStockDiscrepancy(payload: {
    itemId: string;
    physicalQuantity: number;
    reason: string;
  }): Promise<{ id: string; reportNumber: string; differenceQuantity: number }> {
    return fetchJson('/api/stock-discrepancies', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async reviewStockDiscrepancy(
    reportId: string,
    decision: 'APPROVE' | 'REJECT',
    note?: string
  ): Promise<{ id: string; reportNumber: string; status: string }> {
    return fetchJson(`/api/stock-discrepancies/${encodeURIComponent(reportId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
  },

  async listBomRevisionRequests(): Promise<BomRevisionRequest[]> {
    return fetchJson<BomRevisionRequest[]>('/api/bom-revisions');
  },

  async createBomRevisionRequest(payload: {
    productId: string;
    materialId: string;
    suggestedQuantityPerUnit: number;
    productionRunId?: string;
    reason: string;
  }): Promise<{ id: string; requestNumber: string }> {
    return fetchJson('/api/bom-revisions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async reviewBomRevisionRequest(
    revisionId: string,
    decision: 'APPROVE' | 'REJECT',
    note?: string
  ): Promise<{ id: string; requestNumber: string; status: string; bomVersion: string }> {
    return fetchJson(`/api/bom-revisions/${encodeURIComponent(revisionId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
  },

  async getProductionRunDraft(requestId: string): Promise<ProductionRunDraftPayload | null> {
    return fetchJson<ProductionRunDraftPayload | null>(
      `/api/supervisor/production-runs/draft/${encodeURIComponent(requestId)}`
    );
  },

  async saveProductionRunDraft(
    requestId: string,
    payload: ProductionRunDraftPayload['payload']
  ): Promise<{ productionRequestId: string; updatedAt: string }> {
    return fetchJson(
      `/api/supervisor/production-runs/draft/${encodeURIComponent(requestId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  },

  async updateRunVarianceExplanation(
    runId: string,
    varianceExplanation: string
  ): Promise<{ id: string; varianceExplanation: string }> {
    return fetchJson(
      `/api/supervisor/production-runs/${encodeURIComponent(runId)}/explanation`,
      {
        method: 'PATCH',
        body: JSON.stringify({ varianceExplanation }),
      }
    );
  },

  // --- Dispatches, Billing & Payments ---
  async listOrdersOnly(): Promise<Order[]> {
    return fetchJson<Order[]>('/api/orders');
  },

  async listDispatches(): Promise<DispatchRecord[]> {
    return fetchJson<DispatchRecord[]>('/api/dispatches');
  },

  async recordDispatch(payload: {
    orderId: string;
    quantity: number;
    notes?: string;
    idempotencyKey?: string;
  }): Promise<{ id: string; dispatchNumber: string; status: string }> {
    return fetchJson('/api/dispatches', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async loadBillingWorkspace(): Promise<BillingWorkspaceData> {
    return fetchJson<BillingWorkspaceData>('/api/billing');
  },

  async createInvoice(
    dispatchIdOrPayload:
      | string
      | {
          dispatchId: string;
          quantity?: number;
          placeOfSupplyState?: string;
          dueDate?: string;
          notes?: string;
          idempotencyKey?: string;
        }
  ): Promise<{ id: string; invoiceNumber: string }> {
    const payload =
      typeof dispatchIdOrPayload === 'string'
        ? { dispatchId: dispatchIdOrPayload }
        : dispatchIdOrPayload;
    return fetchJson('/api/invoices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async loadAccountantDashboard(): Promise<AccountantDashboardData> {
    return fetchJson<AccountantDashboardData>('/api/accountant/dashboard');
  },

  async previewDispatchInvoice(
    dispatchId: string,
    options?: { quantity?: number; placeOfSupplyState?: string }
  ): Promise<DispatchInvoicePreview> {
    const qs = new URLSearchParams();
    if (options?.quantity !== undefined) qs.set('quantity', String(options.quantity));
    if (options?.placeOfSupplyState) qs.set('placeOfSupplyState', options.placeOfSupplyState);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return fetchJson<DispatchInvoicePreview>(
      `/api/accountant/dispatches/${encodeURIComponent(dispatchId)}/preview${suffix}`
    );
  },

  async cancelInvoice(
    invoiceId: string,
    reason: string
  ): Promise<{ id: string; invoiceNumber: string; status: string }> {
    return fetchJson(`/api/accountant/invoices/${encodeURIComponent(invoiceId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async recordPayment(payload: {
    invoiceId: string;
    amount: number;
    paymentMode: string;
    referenceNumber?: string;
    paymentDate?: string;
    notes?: string;
    idempotencyKey?: string;
  }): Promise<{ id: string; paymentNumber: string; paymentStatus: string }> {
    return fetchJson('/api/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async recordCustomerPayment(payload: {
    customerId: string;
    amount: number;
    allocations: Array<{ invoiceId: string; amount: number }>;
    paymentMode: string;
    referenceNumber?: string;
    paymentDate?: string;
    notes?: string;
    idempotencyKey?: string;
  }): Promise<{ id: string; paymentNumber: string; unallocatedAmount: number }> {
    return fetchJson('/api/accountant/payments/customer', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async reversePayment(
    paymentId: string,
    reason: string
  ): Promise<{ id: string; paymentNumber: string; status: string }> {
    return fetchJson(`/api/accountant/payments/${encodeURIComponent(paymentId)}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async listCustomerReceivables(): Promise<CustomerReceivableSummary[]> {
    return fetchJson<CustomerReceivableSummary[]>('/api/accountant/receivables');
  },

  async getFinancialReports(filters?: {
    from?: string;
    to?: string;
    customerId?: string;
    status?: string;
  }): Promise<FinancialReportsData> {
    const qs = new URLSearchParams();
    if (filters?.from) qs.set('from', filters.from);
    if (filters?.to) qs.set('to', filters.to);
    if (filters?.customerId) qs.set('customerId', filters.customerId);
    if (filters?.status) qs.set('status', filters.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return fetchJson<FinancialReportsData>(`/api/accountant/reports${suffix}`);
  },

  // --- Management ---
  async uploadProductImage(file: File): Promise<{ imageUrl: string; filename: string }> {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      throw new Error('Unsupported image format. Allowed formats: JPG, JPEG, PNG, and WEBP.');
    }
    const maxBytes = 2 * 1024 * 1024;
    if (file.size <= 0) {
      throw new Error('Selected image file is empty.');
    }
    if (file.size > maxBytes) {
      throw new Error('Image file exceeds maximum allowed size of 2 MB.');
    }

    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected image file.'));
      reader.readAsDataURL(file);
    });

    return fetchJson<{ imageUrl: string; filename: string }>('/api/management/products/image', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        dataBase64,
      }),
    });
  },

  async listCatalogueProducts(): Promise<CatalogueProduct[]> {
    return fetchJson<CatalogueProduct[]>('/api/management/products');
  },

  async saveCatalogueProduct(payload: {
    id?: string;
    sku: string;
    name: string;
    packSize: string;
    sellingPrice: number;
    gstRate: number;
    hsnCode: string;
    imageUrl?: string;
    unit: string;
    reorderLevel: number;
    isActive?: boolean;
    bomItems: Array<{ materialId: string; quantityPerUnit: number }>;
  }): Promise<{ id: string }> {
    if (payload.id) {
      return fetchJson(`/api/management/products/${encodeURIComponent(payload.id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    return fetchJson('/api/management/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async toggleProductStatus(productId: string, isActive: boolean): Promise<{ id: string }> {
    return fetchJson(`/api/management/products/${encodeURIComponent(productId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },

  async listCustomers(): Promise<Customer[]> {
    return fetchJson<Customer[]>('/api/management/customers');
  },

  async saveCustomer(payload: {
    id?: string;
    code: string;
    name: string;
    contactPerson: string;
    phone: string;
    email?: string;
    gstin?: string;
    billingAddress: string;
    deliveryAddress: string;
    state: string;
    stateCode?: string;
    isActive?: boolean;
  }): Promise<{ id: string }> {
    if (payload.id) {
      return fetchJson(`/api/management/customers/${encodeURIComponent(payload.id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    return fetchJson('/api/management/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async toggleCustomerStatus(customerId: string, isActive: boolean): Promise<{ id: string }> {
    return fetchJson(`/api/management/customers/${encodeURIComponent(customerId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },

  async listSuppliers(): Promise<Supplier[]> {
    return fetchJson<Supplier[]>('/api/management/suppliers');
  },

  async saveSupplier(payload: {
    id?: string;
    code: string;
    name: string;
    contactPerson: string;
    phone: string;
    email?: string;
    gstin?: string;
    address: string;
    state: string;
    isActive?: boolean;
    materialIds: string[];
  }): Promise<{ id: string }> {
    if (payload.id) {
      return fetchJson(`/api/management/suppliers/${encodeURIComponent(payload.id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    return fetchJson('/api/management/suppliers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listUsers(): Promise<ManagedUser[]> {
    return fetchJson<ManagedUser[]>('/api/management/users');
  },

  async createUser(payload: {
    username: string;
    fullName: string;
    email: string;
    role: UserRole;
    password: string;
  }): Promise<{ id: string }> {
    return fetchJson('/api/management/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateUser(
    userId: string,
    payload: { role?: UserRole; isActive?: boolean; fullName?: string }
  ): Promise<{ id: string }> {
    return fetchJson(`/api/management/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async resetUserAccess(
    userId: string,
    temporaryPassword?: string
  ): Promise<{ id: string; temporaryPassword: string }> {
    return fetchJson(`/api/management/users/${encodeURIComponent(userId)}/reset-access`, {
      method: 'POST',
      body: JSON.stringify({ temporaryPassword }),
    });
  },

  // --- Salesman Portal ---
  async loadSalesmanDashboard(): Promise<SalesmanDashboardData> {
    return fetchJson<SalesmanDashboardData>('/api/salesman/dashboard');
  },

  async listSalesmanProducts(): Promise<SalesmanProduct[]> {
    return fetchJson<SalesmanProduct[]>('/api/salesman/products');
  },

  async listSalesmanCustomers(): Promise<SalesmanCustomer[]> {
    return fetchJson<SalesmanCustomer[]>('/api/salesman/customers');
  },

  async createSalesmanCustomer(payload: {
    name: string;
    contactPerson?: string;
    phone: string;
    email?: string;
    address: string;
    state: string;
    gstin?: string;
  }): Promise<SalesmanCustomer> {
    return fetchJson<SalesmanCustomer>('/api/salesman/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listSalesmanOrders(): Promise<SalesmanOrder[]> {
    return fetchJson<SalesmanOrder[]>('/api/salesman/orders');
  },

  async getSalesmanOrderDetail(orderId: string): Promise<SalesmanOrder> {
    return fetchJson<SalesmanOrder>(
      `/api/salesman/orders/${encodeURIComponent(orderId)}`
    );
  },

  async createSalesmanOrder(payload: {
    customerId: string;
    items: Array<{ productId: string; quantity: number }>;
    customerNote?: string;
  }): Promise<SalesmanOrder> {
    return fetchJson<SalesmanOrder>('/api/salesman/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
