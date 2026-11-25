import type {
  BomItem,
  Order,
  Product,
  ProductionRequest,
  RawMaterial,
} from '../types/orderAudit';

/**
 * SAMPLE DATA FOR UI DEVELOPMENT ONLY
 * ---------------------------------------------------------------------------
 * Kept strictly separate from backend API integration. Once the backend
 * endpoints in `src/services/apiContract.ts` are implemented and
 * `VITE_API_BASE_URL` is configured, live database records replace this module.
 */

export const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'prod-mrk-200',
    sku: 'NITT-MRK-200',
    name: 'Murukku 200 g',
    unit: 'packets',
    availableStock: 100,
    reorderLevel: 50,
  },
  {
    id: 'prod-mix-250',
    sku: 'NITT-MIX-250',
    name: 'Madras Mixture 250 g',
    unit: 'packets',
    availableStock: 60,
    reorderLevel: 50,
  },
  {
    id: 'prod-pnt-150',
    sku: 'NITT-PNT-150',
    name: 'Masala Peanuts 150 g',
    unit: 'packets',
    availableStock: 120,
    reorderLevel: 40,
  },
  {
    id: 'prod-rib-200',
    sku: 'NITT-RIB-200',
    name: 'Ribbon Pakoda 200 g',
    unit: 'packets',
    availableStock: 25,
    reorderLevel: 40,
  },
];

export const SAMPLE_RAW_MATERIALS: RawMaterial[] = [
  {
    id: 'rm-rice-flour',
    code: 'RM-101',
    name: 'Rice Flour',
    unit: 'kg',
    availableStock: 28,
    reorderLevel: 15,
  },
  {
    id: 'rm-urad-flour',
    code: 'RM-102',
    name: 'Urad Dal Flour',
    unit: 'kg',
    availableStock: 10,
    reorderLevel: 5,
  },
  {
    id: 'rm-besan',
    code: 'RM-103',
    name: 'Besan (Gram Flour)',
    unit: 'kg',
    availableStock: 14,
    reorderLevel: 15,
  },
  {
    id: 'rm-peanuts',
    code: 'RM-104',
    name: 'Raw Peanuts',
    unit: 'kg',
    availableStock: 5,
    reorderLevel: 8,
  },
  {
    id: 'rm-groundnut-oil',
    code: 'RM-105',
    name: 'Groundnut Oil',
    unit: 'L',
    availableStock: 18,
    reorderLevel: 10,
  },
  {
    id: 'rm-spice-mix',
    code: 'RM-106',
    name: 'Sesame & Spice Mix',
    unit: 'kg',
    availableStock: 4.5,
    reorderLevel: 3,
  },
];

export const SAMPLE_BOM_ITEMS: BomItem[] = [
  // Murukku 200 g
  { productId: 'prod-mrk-200', rawMaterialId: 'rm-rice-flour', quantityPerUnit: 0.12 },
  { productId: 'prod-mrk-200', rawMaterialId: 'rm-urad-flour', quantityPerUnit: 0.04 },
  { productId: 'prod-mrk-200', rawMaterialId: 'rm-groundnut-oil', quantityPerUnit: 0.05 },
  { productId: 'prod-mrk-200', rawMaterialId: 'rm-spice-mix', quantityPerUnit: 0.01 },

  // Madras Mixture 250 g
  { productId: 'prod-mix-250', rawMaterialId: 'rm-besan', quantityPerUnit: 0.15 },
  { productId: 'prod-mix-250', rawMaterialId: 'rm-peanuts', quantityPerUnit: 0.05 },
  { productId: 'prod-mix-250', rawMaterialId: 'rm-groundnut-oil', quantityPerUnit: 0.06 },
  { productId: 'prod-mix-250', rawMaterialId: 'rm-spice-mix', quantityPerUnit: 0.015 },

  // Masala Peanuts 150 g
  { productId: 'prod-pnt-150', rawMaterialId: 'rm-peanuts', quantityPerUnit: 0.12 },
  { productId: 'prod-pnt-150', rawMaterialId: 'rm-besan', quantityPerUnit: 0.03 },
  { productId: 'prod-pnt-150', rawMaterialId: 'rm-groundnut-oil', quantityPerUnit: 0.03 },
  { productId: 'prod-pnt-150', rawMaterialId: 'rm-spice-mix', quantityPerUnit: 0.01 },

  // Ribbon Pakoda 200 g
  { productId: 'prod-rib-200', rawMaterialId: 'rm-rice-flour', quantityPerUnit: 0.11 },
  { productId: 'prod-rib-200', rawMaterialId: 'rm-besan', quantityPerUnit: 0.07 },
  { productId: 'prod-rib-200', rawMaterialId: 'rm-groundnut-oil', quantityPerUnit: 0.05 },
  { productId: 'prod-rib-200', rawMaterialId: 'rm-spice-mix', quantityPerUnit: 0.01 },
];

export const SAMPLE_ORDERS: Order[] = [
  {
    id: 'ord-2026-0142',
    orderNumber: 'ORD-2026-0142',
    customerName: 'NITT Hostels – Amber Mess',
    customerCode: 'CUST-NITT-04',
    productId: 'prod-mrk-200',
    requestedQuantity: 150,
    dispatchedQuantity: 0,
    orderDate: '2026-11-25',
    status: 'SUBMITTED',
    notes: 'Weekly student hostel canteen indent.',
    auditTrail: [
      {
        id: 'aud-142-1',
        timestamp: '2026-11-25T09:15:00.000Z',
        actor: 'Customer Portal',
        action: 'Order submitted by NITT Hostels – Amber Mess',
        toStatus: 'SUBMITTED',
      },
    ],
  },
  {
    id: 'ord-2026-0143',
    orderNumber: 'ORD-2026-0143',
    customerName: 'NITT Central Canteen',
    customerCode: 'CUST-NITT-01',
    productId: 'prod-mix-250',
    requestedQuantity: 200,
    dispatchedQuantity: 0,
    orderDate: '2026-11-25',
    status: 'UNDER_REVIEW',
    notes: 'Symposium refreshment requirement.',
    auditTrail: [
      {
        id: 'aud-143-2',
        timestamp: '2026-11-25T10:10:00.000Z',
        actor: 'Admin',
        action: 'Opened for availability review',
        fromStatus: 'SUBMITTED',
        toStatus: 'UNDER_REVIEW',
      },
      {
        id: 'aud-143-1',
        timestamp: '2026-11-25T09:40:00.000Z',
        actor: 'Customer Portal',
        action: 'Order submitted by NITT Central Canteen',
        toStatus: 'SUBMITTED',
      },
    ],
  },
  {
    id: 'ord-2026-0144',
    orderNumber: 'ORD-2026-0144',
    customerName: 'Orion Student Cooperative',
    customerCode: 'CUST-NITT-09',
    productId: 'prod-pnt-150',
    requestedQuantity: 50,
    dispatchedQuantity: 0,
    orderDate: '2026-11-24',
    status: 'SUBMITTED',
    notes: 'Standard shelf replenishment.',
    auditTrail: [
      {
        id: 'aud-144-1',
        timestamp: '2026-11-24T16:20:00.000Z',
        actor: 'Customer Portal',
        action: 'Order submitted by Orion Student Cooperative',
        toStatus: 'SUBMITTED',
      },
    ],
  },
  {
    id: 'ord-2026-0141',
    orderNumber: 'ORD-2026-0141',
    customerName: 'Aquamarine Mess Committee',
    customerCode: 'CUST-NITT-06',
    productId: 'prod-rib-200',
    requestedQuantity: 85,
    dispatchedQuantity: 0,
    orderDate: '2026-11-24',
    status: 'PRODUCTION_REQUIRED',
    notes: '60 packets queued for production batch.',
    auditTrail: [
      {
        id: 'aud-141-2',
        timestamp: '2026-11-24T14:05:00.000Z',
        actor: 'Admin',
        action: 'Sent shortage (60 packets) for production (PR-2026-0001)',
        fromStatus: 'SUBMITTED',
        toStatus: 'PRODUCTION_REQUIRED',
      },
      {
        id: 'aud-141-1',
        timestamp: '2026-11-24T11:30:00.000Z',
        actor: 'Customer Portal',
        action: 'Order submitted by Aquamarine Mess Committee',
        toStatus: 'SUBMITTED',
      },
    ],
  },
  {
    id: 'ord-2026-0140',
    orderNumber: 'ORD-2026-0140',
    customerName: 'Faculty Club Store',
    customerCode: 'CUST-NITT-03',
    productId: 'prod-pnt-150',
    requestedQuantity: 60,
    dispatchedQuantity: 0,
    orderDate: '2026-11-23',
    status: 'APPROVED',
    notes: 'Approved; awaiting dispatch voucher.',
    auditTrail: [
      {
        id: 'aud-140-2',
        timestamp: '2026-11-23T15:00:00.000Z',
        actor: 'Admin',
        action: 'Approved order (inventory unchanged until dispatch)',
        fromStatus: 'SUBMITTED',
        toStatus: 'APPROVED',
      },
    ],
  },
  {
    id: 'ord-2026-0139',
    orderNumber: 'ORD-2026-0139',
    customerName: 'Diamond Hostel Canteen',
    customerCode: 'CUST-NITT-02',
    productId: 'prod-mrk-200',
    requestedQuantity: 80,
    dispatchedQuantity: 80,
    orderDate: '2026-11-22',
    status: 'DISPATCHED',
    notes: 'Dispatched via Gate Pass GP-884.',
    auditTrail: [
      {
        id: 'aud-139-2',
        timestamp: '2026-11-22T17:10:00.000Z',
        actor: 'Dispatch Desk',
        action: 'Full quantity (80 packets) dispatched; stock updated',
        fromStatus: 'APPROVED',
        toStatus: 'DISPATCHED',
      },
    ],
  },
];

export const SAMPLE_PRODUCTION_REQUESTS: ProductionRequest[] = [
  {
    id: 'pr-ord-141',
    requestNumber: 'PR-2026-0001',
    orderId: 'ord-2026-0141',
    orderNumber: 'ORD-2026-0141',
    productId: 'prod-rib-200',
    productName: 'Ribbon Pakoda 200 g',
    unit: 'packets',
    requestedQuantity: 60,
    rawMaterialAvailability: 'SUFFICIENT',
    materialsToPurchase: [],
    status: 'PENDING_SUPERVISOR_REVIEW',
    createdAt: '2026-11-24T14:05:00.000Z',
    createdBy: 'Admin',
    notes: 'Awaiting supervisor batch scheduling.',
  },
];
