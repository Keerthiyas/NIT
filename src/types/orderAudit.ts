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
  | 'ACCOUNTANT'
  | 'SALESMAN';

export type SalesmanNavSection = 'dashboard' | 'new-order' | 'my-orders';

export type SupervisorNavSection =
  | 'dashboard'
  | 'requests'
  | 'inventory'
  | 'execution'
  | 'history';

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

export interface OrderLineItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  packSize: string;
  unit: string;
  imageUrl?: string;
  unitPrice: number;
  gstRate: number;
  requestedQuantity: number;
  dispatchedQuantity: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerName: string;
  customerCode: string;
  customerState?: string;
  salesmanUserId?: string;
  salesmanName?: string;
  productId: string;
  productName?: string;
  productSku?: string;
  unit?: string;
  requestedQuantity: number;
  dispatchedQuantity: number;
  subtotal?: number;
  items?: OrderLineItem[];
  orderDate: string;
  createdAt?: string;
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

export interface OrderItemShortageAnalysis {
  orderItemId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  imageUrl?: string;
  requestedQuantity: number;
  remainingToFulfill: number;
  availableFinishedStock: number;
  shortageQuantity: number;
  productionRequired: boolean;
  rawMaterialAvailability: RawMaterialAvailability;
  bomBreakdown: BomRequirementLine[];
  materialsRequiringPurchase: BomRequirementLine[];
}

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
  itemAnalyses?: OrderItemShortageAnalysis[];
  checkedAt: string;
}

export type ProductionRequestStatus =
  | 'PENDING_SUPERVISOR_REVIEW'
  | 'PENDING_MATERIAL_CHECK'
  | 'AWAITING_MATERIALS'
  | 'MATERIAL_SHORTAGE'
  | 'READY_FOR_PRODUCTION'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
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
  bomVersion?: string;
  unit: string;
  requestedQuantity: number;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  reason?: string;
  startedAt?: string;
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
  bomVersion?: string;
  usedInProducts?: string[];
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
    | 'DISPATCH'
    | 'DISCREPANCY_ADJUSTMENT';
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
  estimatedTotal?: number;
  approvalStatus?: 'NOT_REQUIRED' | 'PENDING_OWNER_APPROVAL' | 'APPROVED' | 'REJECTED';
  approvedBy?: string;
  approvedAt?: string;
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

export interface MaterialPurchaseRequirement {
  id: string;
  requirementNumber: string;
  materialId: string;
  materialName: string;
  materialSku: string;
  unit: string;
  category: InventoryCategory;
  currentStock: number;
  productionRequestId: string;
  requestNumber: string;
  orderId: string;
  orderNumber: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  reason?: string;
  status:
    | 'SUBMITTED_TO_PROCUREMENT'
    | 'PO_PREPARED'
    | 'AWAITING_OWNER_APPROVAL'
    | 'APPROVED_FOR_PURCHASE'
    | 'PARTIALLY_RECEIVED'
    | 'RECEIVED'
    | 'CANCELLED';
  purchaseOrderId?: string;
  poNumber?: string;
  poStatus?: string;
  poApprovalStatus?: string;
  poEstimatedTotal?: number;
  requestedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockDiscrepancyReport {
  id: string;
  reportNumber: string;
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  category: InventoryCategory;
  systemQuantity: number;
  physicalQuantity: number;
  differenceQuantity: number;
  reason: string;
  status: 'OPEN' | 'APPROVED' | 'REJECTED';
  reportedByName: string;
  reviewedByName?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface BomRevisionRequest {
  id: string;
  requestNumber: string;
  productId: string;
  productName: string;
  productSku: string;
  productUnit: string;
  bomVersion: string;
  materialId: string;
  materialName: string;
  materialSku: string;
  materialUnit: string;
  currentQuantityPerUnit: number;
  suggestedQuantityPerUnit: number;
  productionRunId?: string;
  runNumber?: string;
  reason: string;
  status: 'PENDING_ADMIN_REVIEW' | 'APPROVED' | 'REJECTED';
  requestedByName: string;
  reviewedByName?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
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
  bomVersion?: string;
  plannedQuantity: number;
  actualOutputQuantity: number;
  rejectedQuantity?: number;
  wastageQuantity: number;
  damagedPackagingQuantity?: number;
  varianceQuantity: number;
  yieldPercent?: number;
  qualityResult?: 'PASSED' | 'CONDITIONAL' | 'FAILED';
  status: 'POSTED' | 'PARTIALLY_COMPLETED';
  supervisorName: string;
  createdByName?: string;
  startedAt?: string;
  completedAt?: string;
  postedAt: string;
  notes?: string;
  varianceExplanation?: string;
  consumptions: Array<{
    id: string;
    materialId: string;
    materialName: string;
    sku: string;
    unit: string;
    category: InventoryCategory;
    plannedQuantity: number;
    actualConsumedQuantity: number;
    additionalConsumedQuantity?: number;
    damagedQuantity?: number;
    wastageQuantity: number;
    varianceQuantity?: number;
    variancePercent?: number;
    reason?: string;
  }>;
  linkedMovements?: Array<{
    id: string;
    itemName: string;
    sku: string;
    unit: string;
    movementType: string;
    direction: 'IN' | 'OUT';
    quantity: number;
    balanceAfter: number;
    reason: string;
    actorName: string;
    createdAt: string;
  }>;
}

export interface SupervisorDashboardData {
  pendingRequestsCount: number;
  materialShortageRequestsCount: number;
  inProgressCount: number;
  completedRunsCount: number;
  completedRequestsCount: number;
  lowStockMaterialsCount: number;
  pendingPurchaseRequirementsCount: number;
  openDiscrepanciesCount: number;
  openBomRevisionsCount: number;
  materialAlerts?: Array<{
    id: string;
    name: string;
    unit: string;
    availableStock: number;
    reorderLevel: number;
    affectsProduction: boolean;
    shortfallQuantity: number;
    alertType: 'PRODUCTION_SHORTAGE' | 'LOW_STOCK';
  }>;
  alerts: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    category: 'SHORTAGE' | 'LOW_STOCK' | 'PROCUREMENT' | 'PRODUCTION';
    title: string;
    detail: string;
    relatedRequestId?: string;
  }>;
  recentActivity: Array<{
    id: string;
    timestamp: string;
    actorName: string;
    actorRole: string;
    entityType: string;
    entityId: string;
    action: string;
    details: string;
  }>;
  recentRequests: ProductionRequest[];
  recentRuns: ProductionRun[];
}

export interface ProductionRunDraftPayload {
  productionRequestId: string;
  payload: {
    goodOutputQuantity?: number;
    rejectedQuantity?: number;
    damagedPackagingQuantity?: number;
    wastageQuantity?: number;
    qualityResult?: 'PASSED' | 'CONDITIONAL' | 'FAILED';
    completionStatus?: 'COMPLETED' | 'PARTIALLY_COMPLETED';
    notes?: string;
    varianceExplanation?: string;
    consumptions?: Array<{
      materialId: string;
      actualConsumedQuantity: number;
      additionalConsumedQuantity?: number;
      damagedQuantity?: number;
      wastageQuantity?: number;
      reason?: string;
    }>;
  };
  updatedByName: string;
  updatedAt: string;
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

// --- Salesman Portal (Zero Inventory / BOM / Costing Exposure) ---

export interface SalesmanProduct {
  id: string;
  sku: string;
  name: string;
  packSize: string;
  unit: string;
  sellingPrice: number;
  gstRate: number;
  hsnCode: string;
  imageUrl?: string;
}

export interface SalesmanCustomer {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  billingAddress: string;
  deliveryAddress: string;
  state: string;
}

export interface SalesmanOrderProgress {
  id: string;
  timestamp: string;
  action: string;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
}

export interface SalesmanOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerContact: string;
  customerPhone: string;
  deliveryAddress: string;
  customerState: string;
  requestedQuantity: number;
  dispatchedQuantity: number;
  subtotal: number;
  orderDate: string;
  createdAt: string;
  status: OrderStatus;
  productionStage?: 'AWAITING_MATERIALS' | 'IN_PROGRESS' | 'READY_FOR_DISPATCH';
  customerNote?: string;
  items: OrderLineItem[];
  progressUpdates: SalesmanOrderProgress[];
}

export interface SalesmanDashboardData {
  totalOrdersCount: number;
  pendingOrdersCount: number;
  recentOrders: SalesmanOrder[];
}
