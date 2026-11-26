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
  {
    method: 'GET',
    path: '/api/salesman/dashboard',
    purpose: 'Salesman only: fetch total/pending order counts and recent orders owned by the salesman.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/salesman/products',
    purpose: 'Salesman only: fetch active product catalogue without inventory balances or BOM.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/salesman/customers',
    purpose: 'Salesman only: fetch read-only active customer directory.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/salesman/customers',
    purpose: 'Salesman only: register a new customer during order creation with duplicate checks.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/salesman/orders',
    purpose: 'Salesman only: submit single or multi-product order without stock-availability blocking.',
    implemented: true,
  },
  {
    method: 'GET',
    path: '/api/supervisor/dashboard',
    purpose: 'Production Supervisor only: metrics, shortage alerts, and recent production activity.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/supervisor/production-requests/:id/check-availability',
    purpose: 'Production Supervisor only: check BOM material stock availability against request.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/purchase-requirements',
    purpose: 'Production Supervisor only: raise material purchase requirement for procurement review.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/purchase-orders/:id/approve',
    purpose: 'Owner/Super Admin only: approve or reject high-value Purchase Orders.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/stock-discrepancies',
    purpose: 'Production Supervisor only: report physical vs system stock variance without modifying balance.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/stock-discrepancies/:id/review',
    purpose: 'Admin/Owner only: approve or reject discrepancy adjustment with ledger movement.',
    implemented: true,
  },
  {
    method: 'POST',
    path: '/api/bom-revisions',
    purpose: 'Production Supervisor only: submit BOM adjustment suggestion to Admin for review.',
    implemented: true,
  },
];
