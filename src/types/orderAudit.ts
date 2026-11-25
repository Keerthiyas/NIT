export type AdminNavSection =
  | 'dashboard'
  | 'orders'
  | 'production-stock'
  | 'billing-payments'
  | 'management';

export type UserRole =
  | 'OWNER_SUPER_ADMIN'
  | 'ADMIN'
  | 'PRODUCTION_SUPERVISOR'
  | 'ACCOUNTANT';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustResetPassword: boolean;
}

export type OrderStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'PRODUCTION_REQUIRED'
  | 'AWAITING_STOCK'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARTIALLY_DISPATCHED'
  | 'DISPATCHED';

export interface Product {
  id: string;
  sku: string;
  name: string;
  unit: string;
  imageUrl?: string;
  availableStock: number;
  reorderLevel: number;
}

export interface RawMaterial {
  id: string;
  code: string;
  name: string;
  unit: string;
  availableStock: number;
  reorderLevel: number;
  category?: InventoryCategory;
}

export interface BomItem {
  productId: string;
  rawMaterialId: string;
  quantityPerUnit: number;
}

export interface OrderAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  note?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerName: string;
  customerCode: string;
  customerState?: string;
  productId: string;
  productName?: string;
  productSku?: string;
  unit?: string;
  requestedQuantity: number;
  dispatchedQuantity: number;
  orderDate: string;
  status: OrderStatus;
  notes?: string;
  auditTrail: OrderAuditEntry[];
}

export interface BomRequirementLine {
  rawMaterialId: string;
  materialCode: string;
  materialName: string;
  category?: InventoryCategory;
  unit: string;
  quantityPerUnit: number;
  requiredQuantity: number;
  availableStock: number;
  shortfallQuantity: number;
  isSufficient: boolean;
}

export type RawMaterialAvailability =
  | 'SUFFICIENT'
  | 'INSUFFICIENT'
  | 'NOT_APPLICABLE';

export interface OrderShortageAnalysis {
  orderId: string;
  productId: string;
  productName: string;
  unit: string;
  requestedQuantity: number;
  remainingToFulfill: number;
  availableFinishedStock: number;
  shortageQuantity: number;
  productionRequired: boolean;
  rawMaterialAvailability: RawMaterialAvailability;
  bomBreakdown: BomRequirementLine[];
  materialsRequiringPurchase: BomRequirementLine[];
  checkedAt: string;
}

export type ProductionRequestStatus =
  | 'PENDING_SUPERVISOR_REVIEW'
  | 'AWAITING_MATERIALS'
  | 'READY_FOR_PRODUCTION'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ProductionRequest {
  id: string;
  requestNumber: string;
  orderId: string;
  orderNumber: string;
  customerName?: string;
  productId: string;
  productName: string;
  productSku?: string;
  unit: string;
  requestedQuantity: number;
  rawMaterialAvailability: 'SUFFICIENT' | 'INSUFFICIENT';
  materialsToPurchase: Array<{
    rawMaterialId: string;
    materialName: string;
    unit: string;
    shortfallQuantity: number;
  }>;
  bomMaterials?: Array<{
    materialId: string;
    materialCode: string;
    materialName: string;
    category: InventoryCategory;
    unit: string;
    quantityPerUnit: number;
    requiredQuantity: number;
    availableStock: number;
    isSufficient: boolean;
  }>;
  status: ProductionRequestStatus;
  assignedSupervisorId?: string;
  assignedSupervisorName?: string;
  supervisorStatus?: string;
  createdAt: string;
  createdBy: string;
  notes?: string;
  updatedAt?: string;
}

export type AdminOrderDecision =
  | 'SEND_FOR_PRODUCTION'
  | 'WAIT_KEEP_PENDING'
  | 'APPROVE_ORDER'
  | 'REJECT_ORDER';

export interface OrderDecisionPayload {
  orderId: string;
  decision: AdminOrderDecision;
  note?: string;
  actor?: string;
}

export interface StockOrProductionAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'FINISHED_GOODS' | 'RAW_MATERIAL' | 'PRODUCTION';
  title: string;
  detail: string;
}

export interface DashboardSummary {
  pendingOrdersCount: number;
  productionRequiredCount: number;
  awaitingStockCount: number;
  approvedPendingDispatchCount: number;
  finishedGoodsStock: Product[];
  productionRequests: ProductionRequest[];
  alerts: StockOrProductionAlert[];
  recentOrders: Array<Order & { productName: string; unit: string }>;
  dataSourceMode: 'BACKEND_API' | 'SAMPLE_DATA';
}

// --- Production & Stock ---

export type InventoryCategory =
  | 'RAW_MATERIAL'
  | 'PACKAGING_MATERIAL'
  | 'FINISHED_GOOD';

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  unit: string;
  packSize: string;
  sellingPrice: number;
  gstRate: number;
  hsnCode: string;
  imageUrl?: string;
  availableStock: number;
  reorderLevel: number;
  isActive: boolean;
  movementCount: number;
  lastUpdatedAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  category: InventoryCategory;
  movementType:
    | 'OPENING_BALANCE'
    | 'PURCHASE_RECEIPT'
    | 'PRODUCTION_CONSUMPTION'
    | 'PRODUCTION_OUTPUT'
    | 'DISPATCH';
  direction: 'IN' | 'OUT';
  quantity: number;
  balanceAfter: number;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  reason: string;
  actorName: string;
  createdAt: string;
}

export interface MaterialShortageQuery {
  id: string;
  queryNumber: string;
  productionRequestId: string;
  requestNumber: string;
  orderId: string;
  orderNumber: string;
  materialId: string;
  materialName: string;
  materialSku: string;
  category: InventoryCategory;
  unit: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  status: 'OPEN' | 'PROCUREMENT_REQUESTED' | 'RESOLVED';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  status: 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  orderDate: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  items: Array<{
    id: string;
    itemId: string;
    itemName: string;
    sku: string;
    unit: string;
    category: InventoryCategory;
    orderedQuantity: number;
    receivedQuantity: number;
    unitCost: number;
  }>;
}

export interface PurchaseReceipt {
  id: string;
  receiptNumber: string;
  purchaseOrderId?: string;
  poNumber?: string;
  supplierId: string;
  supplierName: string;
  receivedDate: string;
  receivedBy: string;
  notes?: string;
  createdAt: string;
  items: Array<{
    id: string;
    itemId: string;
    itemName: string;
    sku: string;
    unit: string;
    receivedQuantity: number;
    unitCost: number;
  }>;
}

export interface ProductionRun {
  id: string;
  runNumber: string;
  productionRequestId: string;
  requestNumber: string;
  orderId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productSku: string;
  unit: string;
  plannedQuantity: number;
  actualOutputQuantity: number;
  wastageQuantity: number;
  varianceQuantity: number;
  status: 'POSTED';
  supervisorName: string;
  postedAt: string;
  notes?: string;
  consumptions: Array<{
    id: string;
    materialId: string;
    materialName: string;
    sku: string;
    unit: string;
    category: InventoryCategory;
    plannedQuantity: number;
    actualConsumedQuantity: number;
    wastageQuantity: number;
  }>;
}

// --- Dispatches, Billing & Payments ---

export interface DispatchRecord {
  id: string;
  dispatchNumber: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerState: string;
  productId: string;
  productName: string;
  unit: string;
  unitPrice: number;
  gstRate: number;
  dispatchedQuantity: number;
  invoicedQuantity: number;
  isInvoiced: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  dispatchedAt: string;
  dispatchedBy: string;
  notes?: string;
}

export interface BusinessProfile {
  name: string;
  address: string;
  gstin: string;
  state: string;
  stateCode: string;
  phone: string;
  email: string;
}

export interface InvoicePayment {
  id: string;
  paymentNumber: string;
  invoiceId: string;
  invoiceNumber?: string;
  customerId?: string;
  customerName?: string;
  paymentDate: string;
  amount: number;
  paymentMode: string;
  referenceNumber: string;
  recordedBy: string;
  notes?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  orderNumber: string;
  dispatchId: string;
  dispatchNumber: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerGstin: string;
  billingAddress: string;
  deliveryAddress: string;
  customerState: string;
  customerStateCode: string;
  invoiceDate: string;
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  placeOfSupplyState: string;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalGstAmount: number;
  totalAmount: number;
  amountReceived: number;
  outstandingBalance: number;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  createdBy: string;
  createdAt: string;
  businessProfile: BusinessProfile;
  lines: Array<{
    id: string;
    productId: string;
    productName: string;
    sku: string;
    hsnCode: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    gstRate: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
  }>;
  payments: InvoicePayment[];
}

export interface BillingWorkspaceData {
  businessProfile: BusinessProfile;
  invoices: Invoice[];
  payments: InvoicePayment[];
  dispatchesReadyForInvoicing: DispatchRecord[];
}

// --- Management Master Data ---

export interface CatalogueProduct extends InventoryItem {
  bomItems: Array<{
    id: string;
    materialId: string;
    materialName: string;
    materialSku: string;
    unit: string;
    category: InventoryCategory;
    quantityPerUnit: number;
  }>;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  billingAddress: string;
  deliveryAddress: string;
  state: string;
  stateCode: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  state: string;
  isActive: boolean;
  suppliedMaterials: Array<{
    id: string;
    sku: string;
    name: string;
    category: InventoryCategory;
    unit: string;
  }>;
  purchaseOrders: Array<{
    id: string;
    po_number: string;
    status: string;
    order_date: string;
  }>;
  purchaseReceipts: Array<{
    id: string;
    receipt_number: string;
    received_date: string;
  }>;
}

export interface ManagedUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustResetPassword: boolean;
  createdAt: string;
  updatedAt: string;
}
