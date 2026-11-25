export interface ApiEndpointSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  purpose: string;
  implemented: boolean;
}

/**
 * Documents the backend API contract implemented by the Node + SQLite server.
 */
export const REQUIRED_BACKEND_APIS: ApiEndpointSpec[] = [
  {
    method: 'POST',
    path: '/api/auth/login',
    purpose: 'Authenticate user and issue bearer session token with role enforcement.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/admin/dashboard',
    purpose: 'Fetch pending order counts, finished-goods stock, production status, alerts, and recent order activity.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/orders',
    purpose: 'List submitted and historical customer orders with audit trail.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/orders/:orderId/availability',
    purpose: 'Query live finished-goods stock, calculate shortage, and evaluate BOM raw & packaging availability.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/orders/:orderId/decision',
    purpose: 'Persist admin decision (Send for Production, Wait/Keep Pending, Approve, Reject) with audit trail.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/inventory/items',
    purpose: 'Fetch shared inventory across Raw Materials, Packaging Materials, and Finished Goods.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/inventory/movements',
    purpose: 'Inspect ledger stock movement history with item, actor, and reference details.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/production-requests',
    purpose: 'List production requests and BOM readiness shared with Production Supervisor.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/material-shortages',
    purpose: 'List material shortage queries linked to production requests and orders.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/purchase-orders',
    purpose: 'Coordinate procurement by creating a Purchase Order without increasing stock.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/purchase-receipts',
    purpose: 'Post goods receipt, increment stock via ledger, and recalculate open shortage queries.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/production-runs',
    purpose: 'Production Supervisor only: post actual output, material consumption, and wastage.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/dispatches',
    purpose: 'Record actual dispatch and deduct finished-goods stock atomically.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/billing',
    purpose: 'Fetch GST invoices, payments, outstanding balances, and unbilled dispatches.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/invoices',
    purpose: 'Accountant only: generate GST invoice (CGST+SGST or IGST) from dispatched quantity.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/payments',
    purpose: 'Accountant only: record full or partial customer payments against an invoice.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/management/users',
    purpose: 'Owner/Super Admin only: manage user accounts, roles, status, and access resets.',
    implemented: true,
  },
];
