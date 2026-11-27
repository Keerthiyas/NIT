import http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import {
  authenticateToken,
  createSession,
  HttpError,
  requireAuth,
  requireRole,
  verifyPassword,
  type AuthUser,
} from './auth.ts';
import { openDatabase } from './db.ts';
import {
  readStoredProductImage,
  validateAndSaveProductImage,
} from './productImages.ts';
import { seedDatabaseIfEmpty } from './seed.ts';
import {
  createInvoiceFromDispatchByAccountant,
  createPurchaseOrder,
  createSalesmanCustomer,
  createSalesmanOrder,
  createUserByOwner,
  evaluateOrderAvailability,
  getAdminDashboardSummary,
  getSalesmanDashboard,
  getSalesmanOrderDetail,
  listCustomers,
  listDispatches,
  listInventoryItems,
  listInvoicesAndPayments,
  listMaterialShortageQueries,
  listOrders,
  listProductionRequests,
  listProductionRuns,
  listProductsWithBom,
  listPurchaseOrders,
  listPurchaseReceipts,
  listSalesmanCatalogue,
  listSalesmanCustomers,
  listSalesmanOrders,
  listStockMovements,
  listSuppliers,
  listUsers,
  postProductionRunBySupervisor,
  postPurchaseReceipt,
  recordDispatch,
  recordPaymentByAccountant,
  resetUserAccessByOwner,
  setCustomerActiveStatus,
  setProductActiveStatus,
  submitOrderDecision,
  updateProductionRequestStatusBySupervisor,
  updateUserByOwner,
  upsertCustomer,
  upsertProductAndBom,
  upsertSupplier,
} from './services.ts';
import {
  getOwnerBusinessOverview,
  getOwnerDashboard,
  getOwnerFinancialOverview,
  getOwnerInventoryOverview,
  getOwnerReports,
  listOwnerPurchaseApprovals,
  updateOwnerApprovalLimit,
} from './ownerServices.ts';
import {
  cancelInvoiceByAccountant,
  getAccountantDashboard,
  getFinancialReports,
  listCustomerReceivables,
  previewDispatchInvoiceByAccountant,
  recordCustomerPaymentByAccountant,
  reversePaymentByAccountant,
} from './accountantServices.ts';
import {
  approvePurchaseOrderByOwner,
  checkProductionRequestAvailability,
  createBomRevisionRequest,
  createMaterialPurchaseRequirement,
  createStockDiscrepancyReport,
  getProductionRunDraft,
  getSupervisorDashboard,
  listBomRevisionRequests,
  listMaterialPurchaseRequirements,
  listStockDiscrepancyReports,
  reviewBomRevisionRequest,
  reviewStockDiscrepancyReport,
  saveProductionRunDraft,
  updateRunVarianceExplanation,
} from './supervisorServices.ts';

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON request body.');
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

export function createApiHandler(db: DatabaseSync) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      const authHeader = req.headers.authorization;
      const token =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : undefined;
      const actor: AuthUser | null = authenticateToken(db, token);

      // --- Health ---
      if (method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true });
      }

      // --- Authentication ---
      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        const identifier = String(body.email || body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!identifier || !password) {
          throw new HttpError(400, 'Email/username and password are required.');
        }

        const userRow = db
          .prepare(
            `SELECT * FROM users WHERE lower(email) = ? OR lower(username) = ?`
          )
          .get(identifier, identifier) as
          | {
              id: string;
              username: string;
              full_name: string;
              email: string;
              role: AuthUser['role'];
              password_hash: string;
              is_active: number;
              must_reset_password: number;
            }
          | undefined;

        if (!userRow || !verifyPassword(password, userRow.password_hash)) {
          throw new HttpError(401, 'Invalid credentials.');
        }
        if (!userRow.is_active) {
          throw new HttpError(403, 'This account has been deactivated. Contact Owner/Super Admin.');
        }

        const session = createSession(db, userRow.id);
        return sendJson(res, 200, {
          token: session.token,
          expiresAt: session.expiresAt,
          user: {
            id: userRow.id,
            username: userRow.username,
            fullName: userRow.full_name,
            email: userRow.email,
            role: userRow.role,
            isActive: Boolean(userRow.is_active),
            mustResetPassword: Boolean(userRow.must_reset_password),
          },
        });
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        if (token) {
          db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
        }
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && pathname === '/api/auth/me') {
        const authed = requireAuth(actor);
        return sendJson(res, 200, { user: authed });
      }

      // --- Admin Dashboard & Orders ---
      if (method === 'GET' && pathname === '/api/admin/dashboard') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
        return sendJson(res, 200, getAdminDashboardSummary(db));
      }

      if (method === 'GET' && pathname === '/api/orders') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);
        return sendJson(res, 200, listOrders(db));
      }

      const availMatch = /^\/api\/orders\/([^/]+)\/availability$/.exec(pathname);
      if (method === 'GET' && availMatch) {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
        const analysis = evaluateOrderAvailability(db, decodeURIComponent(availMatch[1]));
        if ('_internalBom' in analysis) {
          const { _internalBom, _internalItemAnalyses, ...publicAnalysis } = analysis;
          return sendJson(res, 200, publicAnalysis);
        }
        return sendJson(res, 200, analysis);
      }

      const decisionMatch = /^\/api\/orders\/([^/]+)\/decision$/.exec(pathname);
      if (method === 'POST' && decisionMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = submitOrderDecision(
          db,
          authed,
          decodeURIComponent(decisionMatch[1]),
          body.decision as Parameters<typeof submitOrderDecision>[3],
          body.note as string | undefined
        );
        return sendJson(res, 200, result);
      }

      // --- Production & Stock (Shared Inventory, Requests, Shortages, Procurement, Runs) ---
      if (method === 'GET' && pathname === '/api/inventory/items') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, listInventoryItems(db));
      }

      if (method === 'GET' && pathname === '/api/inventory/movements') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        const itemId = url.searchParams.get('itemId') || undefined;
        return sendJson(res, 200, listStockMovements(db, itemId));
      }

      if (method === 'GET' && pathname === '/api/production-requests') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, listProductionRequests(db));
      }

      const prStatusMatch = /^\/api\/production-requests\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && prStatusMatch) {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        const body = await readJsonBody(req);
        const result = updateProductionRequestStatusBySupervisor(
          db,
          authed,
          decodeURIComponent(prStatusMatch[1]),
          body.status as
            | 'PENDING_MATERIAL_CHECK'
            | 'MATERIAL_SHORTAGE'
            | 'READY_FOR_PRODUCTION'
            | 'IN_PROGRESS'
            | 'CANCELLED',
          body.notes as string | undefined
        );
        return sendJson(res, 200, result);
      }

      if (method === 'GET' && pathname === '/api/supervisor/dashboard') {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, getSupervisorDashboard(db, authed));
      }

      const supCheckMatch = /^\/api\/supervisor\/production-requests\/([^/]+)\/check-availability$/.exec(
        pathname
      );
      if (method === 'POST' && supCheckMatch) {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        return sendJson(
          res,
          200,
          checkProductionRequestAvailability(db, authed, decodeURIComponent(supCheckMatch[1]))
        );
      }

      if (method === 'GET' && pathname === '/api/purchase-requirements') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, listMaterialPurchaseRequirements(db, authed));
      }

      if (method === 'POST' && pathname === '/api/purchase-requirements') {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          201,
          createMaterialPurchaseRequirement(
            db,
            authed,
            body as Parameters<typeof createMaterialPurchaseRequirement>[2]
          )
        );
      }

      if (method === 'GET' && pathname === '/api/stock-discrepancies') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, listStockDiscrepancyReports(db, authed));
      }

      if (method === 'POST' && pathname === '/api/stock-discrepancies') {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          201,
          createStockDiscrepancyReport(
            db,
            authed,
            body as Parameters<typeof createStockDiscrepancyReport>[2]
          )
        );
      }

      const discReviewMatch = /^\/api\/stock-discrepancies\/([^/]+)\/review$/.exec(pathname);
      if (method === 'POST' && discReviewMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          reviewStockDiscrepancyReport(
            db,
            authed,
            decodeURIComponent(discReviewMatch[1]),
            body.decision as 'APPROVE' | 'REJECT',
            body.note as string | undefined
          )
        );
      }

      if (method === 'GET' && pathname === '/api/bom-revisions') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, listBomRevisionRequests(db, authed));
      }

      if (method === 'POST' && pathname === '/api/bom-revisions') {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          201,
          createBomRevisionRequest(
            db,
            authed,
            body as Parameters<typeof createBomRevisionRequest>[2]
          )
        );
      }

      const bomReviewMatch = /^\/api\/bom-revisions\/([^/]+)\/review$/.exec(pathname);
      if (method === 'POST' && bomReviewMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          reviewBomRevisionRequest(
            db,
            authed,
            decodeURIComponent(bomReviewMatch[1]),
            body.decision as 'APPROVE' | 'REJECT',
            body.note as string | undefined
          )
        );
      }

      const runDraftMatch = /^\/api\/supervisor\/production-runs\/draft\/([^/]+)$/.exec(pathname);
      if (runDraftMatch && method === 'GET') {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        return sendJson(
          res,
          200,
          getProductionRunDraft(db, authed, decodeURIComponent(runDraftMatch[1]))
        );
      }
      if (runDraftMatch && method === 'PUT') {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          saveProductionRunDraft(db, authed, decodeURIComponent(runDraftMatch[1]), body)
        );
      }

      const runExpMatch = /^\/api\/supervisor\/production-runs\/([^/]+)\/explanation$/.exec(pathname);
      if (method === 'PATCH' && runExpMatch) {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          updateRunVarianceExplanation(
            db,
            authed,
            decodeURIComponent(runExpMatch[1]),
            String(body.varianceExplanation || '')
          )
        );
      }

      if (method === 'GET' && pathname === '/api/material-shortages') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, listMaterialShortageQueries(db));
      }

      if (method === 'GET' && pathname === '/api/purchase-orders') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
        return sendJson(res, 200, listPurchaseOrders(db));
      }

      if (method === 'POST' && pathname === '/api/purchase-orders') {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = createPurchaseOrder(
          db,
          authed,
          body as Parameters<typeof createPurchaseOrder>[2]
        );
        return sendJson(res, 201, result);
      }

      const poApproveMatch = /^\/api\/purchase-orders\/([^/]+)\/approve$/.exec(pathname);
      if (method === 'POST' && poApproveMatch) {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          approvePurchaseOrderByOwner(
            db,
            authed,
            decodeURIComponent(poApproveMatch[1]),
            Boolean(body.approve),
            body.note as string | undefined
          )
        );
      }

      if (method === 'GET' && pathname === '/api/purchase-receipts') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
        return sendJson(res, 200, listPurchaseReceipts(db));
      }

      if (method === 'POST' && pathname === '/api/purchase-receipts') {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = postPurchaseReceipt(
          db,
          authed,
          body as Parameters<typeof postPurchaseReceipt>[2]
        );
        return sendJson(res, 201, result);
      }

      if (method === 'GET' && pathname === '/api/production-runs') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR']);
        return sendJson(res, 200, listProductionRuns(db));
      }

      if (method === 'POST' && pathname === '/api/production-runs') {
        const authed = requireRole(actor, ['PRODUCTION_SUPERVISOR']);
        const body = await readJsonBody(req);
        const result = postProductionRunBySupervisor(
          db,
          authed,
          body as Parameters<typeof postProductionRunBySupervisor>[2]
        );
        return sendJson(res, 201, result);
      }

      // --- Dispatches ---
      if (method === 'GET' && pathname === '/api/dispatches') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);
        return sendJson(res, 200, listDispatches(db));
      }

      if (method === 'POST' && pathname === '/api/dispatches') {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = recordDispatch(
          db,
          authed,
          body as Parameters<typeof recordDispatch>[2]
        );
        return sendJson(res, 201, result);
      }

      // --- Billing & Payments (Admin read-only visibility; Accountant creates invoices & records payments) ---
      if (method === 'GET' && pathname === '/api/billing') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);
        return sendJson(res, 200, listInvoicesAndPayments(db));
      }

      if (method === 'POST' && pathname === '/api/invoices') {
        const authed = requireRole(actor, ['ACCOUNTANT']);
        const body = await readJsonBody(req);
        const result = createInvoiceFromDispatchByAccountant(db, authed, {
          dispatchId: String(body.dispatchId || ''),
          quantity: body.quantity !== undefined ? Number(body.quantity) : undefined,
          placeOfSupplyState:
            typeof body.placeOfSupplyState === 'string' ? body.placeOfSupplyState : undefined,
          dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
          notes: typeof body.notes === 'string' ? body.notes : undefined,
          idempotencyKey:
            typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
        });
        return sendJson(res, 201, result);
      }

      if (method === 'GET' && pathname === '/api/accountant/dashboard') {
        const authed = requireRole(actor, ['ACCOUNTANT']);
        return sendJson(res, 200, getAccountantDashboard(db, authed));
      }

      const dispPreviewMatch = /^\/api\/accountant\/dispatches\/([^/]+)\/preview$/.exec(pathname);
      if (method === 'GET' && dispPreviewMatch) {
        const authed = requireRole(actor, ['ACCOUNTANT']);
        const qtyParam = url.searchParams.get('quantity');
        const posParam = url.searchParams.get('placeOfSupplyState');
        return sendJson(
          res,
          200,
          previewDispatchInvoiceByAccountant(db, authed, decodeURIComponent(dispPreviewMatch[1]), {
            quantity: qtyParam !== null && qtyParam !== '' ? Number(qtyParam) : undefined,
            placeOfSupplyState: posParam || undefined,
          })
        );
      }

      const invCancelMatch = /^\/api\/accountant\/invoices\/([^/]+)\/cancel$/.exec(pathname);
      if (method === 'POST' && invCancelMatch) {
        const authed = requireRole(actor, ['ACCOUNTANT']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          cancelInvoiceByAccountant(
            db,
            authed,
            decodeURIComponent(invCancelMatch[1]),
            String(body.reason || '')
          )
        );
      }

      if (method === 'POST' && pathname === '/api/accountant/payments/customer') {
        const authed = requireRole(actor, ['ACCOUNTANT']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          201,
          recordCustomerPaymentByAccountant(
            db,
            authed,
            body as Parameters<typeof recordCustomerPaymentByAccountant>[2]
          )
        );
      }

      const payRevMatch = /^\/api\/accountant\/payments\/([^/]+)\/reverse$/.exec(pathname);
      if (method === 'POST' && payRevMatch) {
        const authed = requireRole(actor, ['ACCOUNTANT']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          reversePaymentByAccountant(
            db,
            authed,
            decodeURIComponent(payRevMatch[1]),
            String(body.reason || '')
          )
        );
      }

      if (method === 'GET' && pathname === '/api/accountant/receivables') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);
        return sendJson(res, 200, listCustomerReceivables(db, authed));
      }

      if (method === 'GET' && pathname === '/api/accountant/reports') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']);
        return sendJson(
          res,
          200,
          getFinancialReports(db, authed, {
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
            customerId: url.searchParams.get('customerId') || undefined,
            status: url.searchParams.get('status') || undefined,
          })
        );
      }

      if (method === 'POST' && pathname === '/api/payments') {
        const authed = requireRole(actor, ['ACCOUNTANT']);
        const body = await readJsonBody(req);
        const result = recordPaymentByAccountant(
          db,
          authed,
          body as Parameters<typeof recordPaymentByAccountant>[2]
        );
        return sendJson(res, 201, result);
      }

      // --- Product Image Upload & Secure Serving ---
      const imgServeMatch = /^\/api\/uploads\/products\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && imgServeMatch) {
        const file = readStoredProductImage(decodeURIComponent(imgServeMatch[1]));
        res.writeHead(200, {
          'Content-Type': file.contentType,
          'Content-Length': file.buffer.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(file.buffer);
        return;
      }

      if (method === 'POST' && pathname === '/api/management/products/image') {
        requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const saved = validateAndSaveProductImage({
          mimeType: String(body.mimeType || ''),
          dataBase64: String(body.dataBase64 || ''),
        });
        return sendJson(res, 201, saved);
      }

      // --- Management: Product Catalogue + BOM ---
      if (method === 'GET' && pathname === '/api/management/products') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
        return sendJson(res, 200, listProductsWithBom(db));
      }

      if (method === 'POST' && pathname === '/api/management/products') {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = upsertProductAndBom(
          db,
          authed,
          body as Parameters<typeof upsertProductAndBom>[2]
        );
        return sendJson(res, 201, result);
      }

      const prodMatch = /^\/api\/management\/products\/([^/]+)$/.exec(pathname);
      if (method === 'PUT' && prodMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = upsertProductAndBom(db, authed, {
          ...(body as Parameters<typeof upsertProductAndBom>[2]),
          id: decodeURIComponent(prodMatch[1]),
        });
        return sendJson(res, 200, result);
      }

      const prodStatusMatch = /^\/api\/management\/products\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && prodStatusMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = setProductActiveStatus(
          db,
          authed,
          decodeURIComponent(prodStatusMatch[1]),
          Boolean(body.isActive)
        );
        return sendJson(res, 200, result);
      }

      // --- Management: Customers ---
      if (method === 'GET' && pathname === '/api/management/customers') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
        return sendJson(res, 200, listCustomers(db));
      }

      if (method === 'POST' && pathname === '/api/management/customers') {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = upsertCustomer(
          db,
          authed,
          body as Parameters<typeof upsertCustomer>[2]
        );
        return sendJson(res, 201, result);
      }

      const custMatch = /^\/api\/management\/customers\/([^/]+)$/.exec(pathname);
      if (method === 'PUT' && custMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = upsertCustomer(db, authed, {
          ...(body as Parameters<typeof upsertCustomer>[2]),
          id: decodeURIComponent(custMatch[1]),
        });
        return sendJson(res, 200, result);
      }

      const custStatusMatch = /^\/api\/management\/customers\/([^/]+)\/status$/.exec(pathname);
      if (method === 'PATCH' && custStatusMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = setCustomerActiveStatus(
          db,
          authed,
          decodeURIComponent(custStatusMatch[1]),
          Boolean(body.isActive)
        );
        return sendJson(res, 200, result);
      }

      // --- Management: Suppliers ---
      if (method === 'GET' && pathname === '/api/management/suppliers') {
        requireRole(actor, ['OWNER_SUPER_ADMIN', 'ADMIN']);
        return sendJson(res, 200, listSuppliers(db));
      }

      if (method === 'POST' && pathname === '/api/management/suppliers') {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = upsertSupplier(
          db,
          authed,
          body as Parameters<typeof upsertSupplier>[2]
        );
        return sendJson(res, 201, result);
      }

      const supMatch = /^\/api\/management\/suppliers\/([^/]+)$/.exec(pathname);
      if (method === 'PUT' && supMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = upsertSupplier(db, authed, {
          ...(body as Parameters<typeof upsertSupplier>[2]),
          id: decodeURIComponent(supMatch[1]),
        });
        return sendJson(res, 200, result);
      }

      // --- Management: User Management (ADMIN ONLY; Owner blocked) ---
      if (method === 'GET' && pathname === '/api/management/users') {
        const authed = requireRole(actor, ['ADMIN']);
        return sendJson(res, 200, listUsers(db, authed));
      }

      if (method === 'POST' && pathname === '/api/management/users') {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = createUserByOwner(
          db,
          authed,
          body as Parameters<typeof createUserByOwner>[2]
        );
        return sendJson(res, 201, result);
      }

      const userMatch = /^\/api\/management\/users\/([^/]+)$/.exec(pathname);
      if (method === 'PATCH' && userMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = updateUserByOwner(
          db,
          authed,
          decodeURIComponent(userMatch[1]),
          body as Parameters<typeof updateUserByOwner>[3]
        );
        return sendJson(res, 200, result);
      }

      const userResetMatch = /^\/api\/management\/users\/([^/]+)\/reset-access$/.exec(pathname);
      if (method === 'POST' && userResetMatch) {
        const authed = requireRole(actor, ['ADMIN']);
        const body = await readJsonBody(req);
        const result = resetUserAccessByOwner(
          db,
          authed,
          decodeURIComponent(userResetMatch[1]),
          body.temporaryPassword as string | undefined
        );
        return sendJson(res, 200, result);
      }

      // --- Owner Module Routes (OWNER_SUPER_ADMIN ONLY) ---
      if (method === 'GET' && pathname === '/api/owner/dashboard') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        return sendJson(
          res,
          200,
          getOwnerDashboard(db, authed, {
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
          })
        );
      }

      if (method === 'GET' && pathname === '/api/owner/business-overview') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        return sendJson(
          res,
          200,
          getOwnerBusinessOverview(db, authed, {
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
          })
        );
      }

      if (method === 'GET' && pathname === '/api/owner/inventory') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        return sendJson(res, 200, getOwnerInventoryOverview(db, authed));
      }

      if (method === 'GET' && pathname === '/api/owner/financial') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        return sendJson(
          res,
          200,
          getOwnerFinancialOverview(db, authed, {
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
          })
        );
      }

      if (method === 'GET' && pathname === '/api/owner/approvals') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        return sendJson(res, 200, listOwnerPurchaseApprovals(db, authed));
      }

      if (method === 'PUT' && pathname === '/api/owner/settings/approval-limit') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        const body = await readJsonBody(req);
        return sendJson(
          res,
          200,
          updateOwnerApprovalLimit(
            db,
            authed,
            Number(body.approvalLimitRupees ?? body.limitRupees)
          )
        );
      }

      if (method === 'GET' && pathname === '/api/owner/reports') {
        const authed = requireRole(actor, ['OWNER_SUPER_ADMIN']);
        return sendJson(
          res,
          200,
          getOwnerReports(db, authed, {
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
            category: url.searchParams.get('category') || undefined,
            status: url.searchParams.get('status') || undefined,
          })
        );
      }

      // --- Salesman Dashboard & Ordering (Strictly SALESMAN Role; Zero Stock Exposure) ---
      if (method === 'GET' && pathname === '/api/salesman/dashboard') {
        const authed = requireRole(actor, ['SALESMAN']);
        return sendJson(res, 200, getSalesmanDashboard(db, authed));
      }

      if (method === 'GET' && pathname === '/api/salesman/products') {
        const authed = requireRole(actor, ['SALESMAN']);
        return sendJson(res, 200, listSalesmanCatalogue(db, authed));
      }

      if (method === 'GET' && pathname === '/api/salesman/customers') {
        const authed = requireRole(actor, ['SALESMAN']);
        return sendJson(res, 200, listSalesmanCustomers(db, authed));
      }

      if (method === 'POST' && pathname === '/api/salesman/customers') {
        const authed = requireRole(actor, ['SALESMAN']);
        const body = await readJsonBody(req);
        const created = createSalesmanCustomer(
          db,
          authed,
          body as Parameters<typeof createSalesmanCustomer>[2]
        );
        return sendJson(res, 201, created);
      }

      if (method === 'GET' && pathname === '/api/salesman/orders') {
        const authed = requireRole(actor, ['SALESMAN']);
        return sendJson(res, 200, listSalesmanOrders(db, authed));
      }

      if (method === 'POST' && pathname === '/api/salesman/orders') {
        const authed = requireRole(actor, ['SALESMAN']);
        const body = await readJsonBody(req);
        const created = createSalesmanOrder(
          db,
          authed,
          body as Parameters<typeof createSalesmanOrder>[2]
        );
        return sendJson(res, 201, created);
      }

      const salesmanOrderMatch = /^\/api\/salesman\/orders\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && salesmanOrderMatch) {
        const authed = requireRole(actor, ['SALESMAN']);
        return sendJson(
          res,
          200,
          getSalesmanOrderDetail(db, authed, decodeURIComponent(salesmanOrderMatch[1]))
        );
      }

      return sendJson(res, 404, { error: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message });
      }
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        return sendJson(res, 409, { error: `Duplicate record: ${err.message}` });
      }
      const message = err instanceof Error ? err.message : 'Internal server error';
      return sendJson(res, 500, { error: message });
    }
  };
}

// Start HTTP server when executed directly
const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() || '');

if (isMain) {
  const port = Number(process.env.PORT || 3001);
  const db = openDatabase();
  seedDatabaseIfEmpty(db);
  const handler = createApiHandler(db);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Order-to-Audit API listening on http://127.0.0.1:${port}`);
  });
}

