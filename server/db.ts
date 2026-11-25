import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

export const BUSINESS_PROFILE = {
  name: 'NIT Trichy Food Production & Audit Unit',
  address: 'Campus Food Processing Park, NIT Tiruchirappalli, Tamil Nadu - 620015',
  gstin: '33AAAAN0123F1Z8',
  state: 'Tamil Nadu',
  stateCode: '33',
  phone: '+91-431-2503000',
  email: 'audit-unit@nitt.edu',
} as const;

export function openDatabase(dbPath?: string): DatabaseSync {
  const resolvedPath =
    dbPath ?? path.resolve(process.cwd(), 'data', 'order-to-audit.db');

  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (resolvedPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  initializeSchema(db);
  return db;
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('OWNER_SUPER_ADMIN', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'ACCOUNTANT')),
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      must_reset_password INTEGER NOT NULL DEFAULT 0 CHECK(must_reset_password IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',
      billing_address TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      state TEXT NOT NULL,
      state_code TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL,
      state TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('RAW_MATERIAL', 'PACKAGING_MATERIAL', 'FINISHED_GOOD')),
      unit TEXT NOT NULL,
      pack_size TEXT NOT NULL DEFAULT '',
      selling_price_paise INTEGER NOT NULL DEFAULT 0 CHECK(selling_price_paise >= 0),
      gst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_bps >= 0),
      hsn_code TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      reorder_level_scaled INTEGER NOT NULL DEFAULT 0 CHECK(reorder_level_scaled >= 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_balances (
      item_id TEXT PRIMARY KEY REFERENCES inventory_items(id) ON DELETE CASCADE,
      quantity_scaled INTEGER NOT NULL DEFAULT 0 CHECK(quantity_scaled >= 0),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES inventory_items(id),
      movement_type TEXT NOT NULL CHECK(movement_type IN (
        'OPENING_BALANCE',
        'PURCHASE_RECEIPT',
        'PRODUCTION_CONSUMPTION',
        'PRODUCTION_OUTPUT',
        'DISPATCH'
      )),
      direction TEXT NOT NULL CHECK(direction IN ('IN', 'OUT')),
      quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled > 0),
      balance_after_scaled INTEGER NOT NULL CHECK(balance_after_scaled >= 0),
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      reference_number TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(reference_type, reference_id, item_id, direction)
    );

    CREATE TABLE IF NOT EXISTS supplier_materials (
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      PRIMARY KEY (supplier_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      material_id TEXT NOT NULL REFERENCES inventory_items(id),
      quantity_per_unit_scaled INTEGER NOT NULL CHECK(quantity_per_unit_scaled > 0),
      UNIQUE(product_id, material_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES inventory_items(id),
      requested_qty_scaled INTEGER NOT NULL CHECK(requested_qty_scaled > 0),
      dispatched_qty_scaled INTEGER NOT NULL DEFAULT 0 CHECK(dispatched_qty_scaled >= 0),
      order_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN (
        'SUBMITTED',
        'UNDER_REVIEW',
        'PRODUCTION_REQUIRED',
        'AWAITING_STOCK',
        'APPROVED',
        'REJECTED',
        'PARTIALLY_DISPATCHED',
        'DISPATCHED'
      )),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_audit_trail (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_requests (
      id TEXT PRIMARY KEY,
      request_number TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_id TEXT NOT NULL REFERENCES inventory_items(id),
      requested_qty_scaled INTEGER NOT NULL CHECK(requested_qty_scaled > 0),
      status TEXT NOT NULL CHECK(status IN (
        'PENDING_SUPERVISOR_REVIEW',
        'AWAITING_MATERIALS',
        'READY_FOR_PRODUCTION',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED'
      )),
      assigned_supervisor_id TEXT REFERENCES users(id),
      supervisor_status TEXT NOT NULL DEFAULT 'Unassigned',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_pr_per_order
      ON production_requests(order_id)
      WHERE status != 'CANCELLED';

    CREATE TABLE IF NOT EXISTS material_shortage_queries (
      id TEXT PRIMARY KEY,
      query_number TEXT NOT NULL UNIQUE,
      production_request_id TEXT NOT NULL REFERENCES production_requests(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id),
      material_id TEXT NOT NULL REFERENCES inventory_items(id),
      required_qty_scaled INTEGER NOT NULL CHECK(required_qty_scaled > 0),
      available_qty_scaled INTEGER NOT NULL CHECK(available_qty_scaled >= 0),
      shortage_qty_scaled INTEGER NOT NULL CHECK(shortage_qty_scaled >= 0),
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'PROCUREMENT_REQUESTED', 'RESOLVED')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(production_request_id, material_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL CHECK(status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
      order_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES inventory_items(id),
      ordered_qty_scaled INTEGER NOT NULL CHECK(ordered_qty_scaled > 0),
      received_qty_scaled INTEGER NOT NULL DEFAULT 0 CHECK(received_qty_scaled >= 0),
      unit_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_paise >= 0)
    );

    CREATE TABLE IF NOT EXISTS purchase_receipts (
      id TEXT PRIMARY KEY,
      receipt_number TEXT NOT NULL UNIQUE,
      purchase_order_id TEXT REFERENCES purchase_orders(id),
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      received_date TEXT NOT NULL,
      received_by TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES inventory_items(id),
      received_qty_scaled INTEGER NOT NULL CHECK(received_qty_scaled > 0),
      unit_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_paise >= 0)
    );

    CREATE TABLE IF NOT EXISTS production_runs (
      id TEXT PRIMARY KEY,
      run_number TEXT NOT NULL UNIQUE,
      production_request_id TEXT NOT NULL UNIQUE REFERENCES production_requests(id),
      product_id TEXT NOT NULL REFERENCES inventory_items(id),
      planned_qty_scaled INTEGER NOT NULL CHECK(planned_qty_scaled > 0),
      actual_output_qty_scaled INTEGER NOT NULL CHECK(actual_output_qty_scaled >= 0),
      wastage_qty_scaled INTEGER NOT NULL DEFAULT 0 CHECK(wastage_qty_scaled >= 0),
      variance_qty_scaled INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('POSTED')),
      supervisor_user_id TEXT NOT NULL REFERENCES users(id),
      supervisor_name TEXT NOT NULL,
      posted_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS production_run_consumptions (
      id TEXT PRIMARY KEY,
      production_run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
      material_id TEXT NOT NULL REFERENCES inventory_items(id),
      planned_qty_scaled INTEGER NOT NULL CHECK(planned_qty_scaled >= 0),
      actual_consumed_qty_scaled INTEGER NOT NULL CHECK(actual_consumed_qty_scaled >= 0),
      wastage_qty_scaled INTEGER NOT NULL DEFAULT 0 CHECK(wastage_qty_scaled >= 0)
    );

    CREATE TABLE IF NOT EXISTS dispatches (
      id TEXT PRIMARY KEY,
      dispatch_number TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL REFERENCES orders(id),
      dispatched_qty_scaled INTEGER NOT NULL CHECK(dispatched_qty_scaled > 0),
      invoiced_qty_scaled INTEGER NOT NULL DEFAULT 0 CHECK(invoiced_qty_scaled >= 0),
      dispatched_at TEXT NOT NULL,
      dispatched_by TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL REFERENCES orders(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      dispatch_id TEXT NOT NULL UNIQUE REFERENCES dispatches(id),
      invoice_date TEXT NOT NULL,
      supply_type TEXT NOT NULL CHECK(supply_type IN ('INTRA_STATE', 'INTER_STATE')),
      place_of_supply_state TEXT NOT NULL,
      taxable_amount_paise INTEGER NOT NULL CHECK(taxable_amount_paise >= 0),
      cgst_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK(cgst_amount_paise >= 0),
      sgst_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK(sgst_amount_paise >= 0),
      igst_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK(igst_amount_paise >= 0),
      total_gst_paise INTEGER NOT NULL CHECK(total_gst_paise >= 0),
      total_amount_paise INTEGER NOT NULL CHECK(total_amount_paise >= 0),
      paid_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount_paise >= 0),
      payment_status TEXT NOT NULL CHECK(payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES inventory_items(id),
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      hsn_code TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled > 0),
      unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0),
      gst_rate_bps INTEGER NOT NULL CHECK(gst_rate_bps >= 0),
      taxable_amount_paise INTEGER NOT NULL CHECK(taxable_amount_paise >= 0),
      cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(cgst_paise >= 0),
      sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(sgst_paise >= 0),
      igst_paise INTEGER NOT NULL DEFAULT 0 CHECK(igst_paise >= 0),
      total_paise INTEGER NOT NULL CHECK(total_paise >= 0)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      payment_number TEXT NOT NULL UNIQUE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      payment_date TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      payment_mode TEXT NOT NULL,
      reference_number TEXT NOT NULL DEFAULT '',
      recorded_by TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );
  `);

  // Safe migration for existing databases adding product image_url
  const itemColumns = db
    .prepare(`PRAGMA table_info(inventory_items)`)
    .all() as Array<{ name: string }>;
  if (!itemColumns.some((c) => c.name === 'image_url')) {
    db.exec(`ALTER TABLE inventory_items ADD COLUMN image_url TEXT NOT NULL DEFAULT ''`);
  }
}

export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors if connection already rolled back
    }
    throw err;
  }
}
