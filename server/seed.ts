import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.ts';
import { runInTransaction } from './db.ts';
import {
  calcGstPaise,
  calcTaxablePaise,
  toGstBps,
  toPaise,
  toScaledQty,
} from './moneyQty.ts';

export function seedDatabaseIfEmpty(db: DatabaseSync): void {
  const existingUsers = db
    .prepare(`SELECT COUNT(*) AS cnt FROM users`)
    .get() as { cnt: number };
  if (existingUsers.cnt > 0) {
    // Backfill seeded product images only if none of the 4 seeded products have images yet
    const seededWithImg = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM inventory_items
         WHERE id IN ('prod-mrk-200', 'prod-mix-250', 'prod-pnt-150', 'prod-rib-200')
           AND image_url != ''`
      )
      .get() as { cnt: number };
    if (seededWithImg.cnt === 0) {
      const upd = db.prepare(`UPDATE inventory_items SET image_url = ? WHERE id = ?`);
      upd.run('/api/uploads/products/murukku-200g.png', 'prod-mrk-200');
      upd.run('/api/uploads/products/madras-mixture-250g.png', 'prod-mix-250');
      upd.run('/api/uploads/products/masala-peanuts-150g.png', 'prod-pnt-150');
      upd.run('/api/uploads/products/ribbon-pakoda-200g.png', 'prod-rib-200');
    }

    // Backfill Salesman users into existing databases if missing
    const hasSalesman = db
      .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'SALESMAN'`)
      .get() as { cnt: number };
    if (hasSalesman.cnt === 0) {
      const now = '2026-11-25T09:00:00.000Z';
      const defaultPasswordHash = hashPassword('password123');
      const ins = db.prepare(`
        INSERT OR IGNORE INTO users (id, username, full_name, email, role, password_hash, is_active, must_reset_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'SALESMAN', ?, 1, 0, ?, ?)
      `);
      ins.run('usr-salesman', 'salesman', 'Arun Kumar (Salesman)', 'salesman@nitt.local', defaultPasswordHash, now, now);
      ins.run('usr-salesman-2', 'salesman2', 'Priya Dharshini (Salesman)', 'salesman2@nitt.local', defaultPasswordHash, now, now);

      db.prepare(`UPDATE orders SET salesman_user_id = 'usr-salesman' WHERE id IN ('ord-2026-0142', 'ord-2026-0143', 'ord-2026-0144') AND salesman_user_id IS NULL`).run();
      db.prepare(`UPDATE orders SET salesman_user_id = 'usr-salesman-2' WHERE id = 'ord-2026-0141' AND salesman_user_id IS NULL`).run();
    }
    return;
  }

  runInTransaction(db, () => {
    const now = '2026-11-25T09:00:00.000Z';
    const defaultPasswordHash = hashPassword('password123');

    // 1. Seed Users across all 5 roles
    const insertUser = db.prepare(`
      INSERT INTO users (id, username, full_name, email, role, password_hash, is_active, must_reset_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `);
    insertUser.run('usr-owner', 'owner', 'Dr. R. Subramanian (Owner)', 'owner@nitt.local', 'OWNER_SUPER_ADMIN', defaultPasswordHash, now, now);
    insertUser.run('usr-admin', 'admin', 'Meenakshi Sundaram (Admin)', 'admin@nitt.local', 'ADMIN', defaultPasswordHash, now, now);
    insertUser.run('usr-supervisor', 'supervisor', 'Karthik Raja (Supervisor)', 'supervisor@nitt.local', 'PRODUCTION_SUPERVISOR', defaultPasswordHash, now, now);
    insertUser.run('usr-accountant', 'accountant', 'Lakshmi Narayanan (Accountant)', 'accountant@nitt.local', 'ACCOUNTANT', defaultPasswordHash, now, now);
    insertUser.run('usr-salesman', 'salesman', 'Arun Kumar (Salesman)', 'salesman@nitt.local', 'SALESMAN', defaultPasswordHash, now, now);
    insertUser.run('usr-salesman-2', 'salesman2', 'Priya Dharshini (Salesman)', 'salesman2@nitt.local', 'SALESMAN', defaultPasswordHash, now, now);

    // 2. Seed Customers (Tamil Nadu intra-state + Karnataka inter-state)
    const insertCust = db.prepare(`
      INSERT INTO customers (id, code, name, contact_person, phone, email, gstin, billing_address, delivery_address, state, state_code, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertCust.run('cust-04', 'CUST-NITT-04', 'NITT Hostels – Amber Mess', 'S. Venkatesh', '+91-98421-10004', 'amber.mess@nitt.edu', '33AAACN1234A1Z5', 'Amber Hostel Block, NIT Trichy, TN - 620015', 'Amber Mess Store Room, NIT Trichy', 'Tamil Nadu', '33', now, now);
    insertCust.run('cust-01', 'CUST-NITT-01', 'NITT Central Canteen', 'P. Aravind', '+91-98421-10001', 'canteen@nitt.edu', '33AAACN5678B1Z2', 'Central Canteen Complex, NIT Trichy, TN - 620015', 'Central Canteen Kitchen, NIT Trichy', 'Tamil Nadu', '33', now, now);
    insertCust.run('cust-09', 'CUST-NITT-09', 'Orion Student Cooperative', 'K. Divya', '+91-98421-10009', 'orion.coop@nitt.edu', '', 'Orion Shopping Arcade, NIT Trichy, TN - 620015', 'Orion Co-op Counter, NIT Trichy', 'Tamil Nadu', '33', now, now);
    insertCust.run('cust-06', 'CUST-NITT-06', 'Aquamarine Mess Committee', 'M. Praveen', '+91-98421-10006', 'aqua.mess@nitt.edu', '', 'Aquamarine Hostel, NIT Trichy, TN - 620015', 'Aquamarine Hostel Mess, NIT Trichy', 'Tamil Nadu', '33', now, now);
    insertCust.run('cust-03', 'CUST-NITT-03', 'Faculty Club Store', 'R. Anitha', '+91-98421-10003', 'faculty.club@nitt.edu', '33AAACN9012C1Z9', 'Faculty Quarters Avenue, NIT Trichy, TN - 620015', 'Faculty Club Store, NIT Trichy', 'Tamil Nadu', '33', now, now);
    insertCust.run('cust-02', 'CUST-NITT-02', 'Diamond Hostel Canteen', 'V. Ganesh', '+91-98421-10002', 'diamond@nitt.edu', '33AAACD3344E1Z1', 'Diamond Hostel, NIT Trichy, TN - 620015', 'Diamond Canteen, NIT Trichy', 'Tamil Nadu', '33', now, now);
    insertCust.run('cust-10', 'CUST-EXT-10', 'Bengaluru Alumni Store', 'N. Deepa', '+91-98801-44210', 'store@nittalumni-blr.in', '29AABCB7711K1Z6', '14 Indiranagar 100ft Rd, Bengaluru, KA - 560038', '14 Indiranagar 100ft Rd, Bengaluru, KA - 560038', 'Karnataka', '29', now, now);

    // 3. Seed Suppliers
    const insertSup = db.prepare(`
      INSERT INTO suppliers (id, code, name, contact_person, phone, email, gstin, address, state, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertSup.run('sup-1', 'SUP-001', 'Cauvery Agro Mills', 'T. Murugan', '+91-94431-21001', 'sales@cauveryagro.in', '33AAACC1122D1Z4', '42 Gandhi Market Road, Tiruchirappalli, TN', 'Tamil Nadu', now, now);
    insertSup.run('sup-2', 'SUP-002', 'Kaveri Cold-Pressed Oils', 'S. Natarajan', '+91-94431-22002', 'orders@kaverioils.in', '33AAACK4455M1Z8', '18 Big Bazaar Street, Thanjavur, TN', 'Tamil Nadu', now, now);
    insertSup.run('sup-3', 'SUP-003', 'Trichy FlexiPack Industries', 'A. Selvam', '+91-94431-23003', 'billing@trichyflexipack.in', '33AAACT8899P1Z3', 'Plot 7, Thuvakudi SIDCO Industrial Estate, Trichy, TN', 'Tamil Nadu', now, now);

    // 4. Seed Inventory Items + Opening Stock Balances + OPENING_BALANCE Movements
    const insertItem = db.prepare(`
      INSERT INTO inventory_items (id, sku, name, category, unit, pack_size, selling_price_paise, gst_rate_bps, hsn_code, image_url, reorder_level_scaled, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const insertBalance = db.prepare(`
      INSERT INTO stock_balances (item_id, quantity_scaled, updated_at) VALUES (?, ?, ?)
    `);
    const insertMove = db.prepare(`
      INSERT INTO stock_movements (id, item_id, movement_type, direction, quantity_scaled, balance_after_scaled, reference_type, reference_id, reference_number, reason, actor_user_id, actor_name, created_at)
      VALUES (?, ?, 'OPENING_BALANCE', 'IN', ?, ?, 'OPENING', ?, ?, 'Initial opening stock balance', 'usr-owner', 'System Seed', ?)
    `);

    const seedItem = (
      id: string,
      sku: string,
      name: string,
      category: 'RAW_MATERIAL' | 'PACKAGING_MATERIAL' | 'FINISHED_GOOD',
      unit: string,
      packSize: string,
      priceRupees: number,
      gstPercent: number,
      hsn: string,
      stockQty: number,
      reorderQty: number,
      imageUrl: string = ''
    ) => {
      const stockScaled = toScaledQty(stockQty);
      insertItem.run(
        id,
        sku,
        name,
        category,
        unit,
        packSize,
        toPaise(priceRupees),
        toGstBps(gstPercent),
        hsn,
        imageUrl,
        toScaledQty(reorderQty),
        now,
        now
      );
      insertBalance.run(id, stockScaled, now);
      if (stockScaled > 0) {
        insertMove.run(`mov-open-${id}`, id, stockScaled, stockScaled, id, `OPEN-${sku}`, now);
      }
    };

    // Raw Materials
    seedItem('rm-rice-flour', 'RM-101', 'Rice Flour', 'RAW_MATERIAL', 'kg', '25 kg bag', 0, 0, '1102', 28, 15);
    seedItem('rm-urad-flour', 'RM-102', 'Urad Dal Flour', 'RAW_MATERIAL', 'kg', '10 kg bag', 0, 0, '1106', 10, 5);
    seedItem('rm-besan', 'RM-103', 'Besan (Gram Flour)', 'RAW_MATERIAL', 'kg', '25 kg bag', 0, 0, '1106', 14, 15);
    seedItem('rm-peanuts', 'RM-104', 'Raw Peanuts', 'RAW_MATERIAL', 'kg', '25 kg bag', 0, 0, '1202', 5, 8);
    seedItem('rm-groundnut-oil', 'RM-105', 'Groundnut Oil', 'RAW_MATERIAL', 'L', '15 L tin', 0, 0, '1508', 18, 10);
    seedItem('rm-spice-mix', 'RM-106', 'Sesame & Spice Mix', 'RAW_MATERIAL', 'kg', '5 kg pack', 0, 0, '0910', 4.5, 3);

    // Packaging Materials
    seedItem('pkg-pouch-200', 'PKG-201', 'Printed Pouch 200 g', 'PACKAGING_MATERIAL', 'pcs', '200 g laminate', 0, 0, '3923', 250, 100);
    seedItem('pkg-pouch-250', 'PKG-202', 'Printed Pouch 250 g', 'PACKAGING_MATERIAL', 'pcs', '250 g laminate', 0, 0, '3923', 90, 100);
    seedItem('pkg-pouch-150', 'PKG-203', 'Printed Pouch 150 g', 'PACKAGING_MATERIAL', 'pcs', '150 g laminate', 0, 0, '3923', 300, 100);
    seedItem('pkg-carton', 'PKG-204', 'Corrugated Carton Box', 'PACKAGING_MATERIAL', 'pcs', '20-packet master carton', 0, 0, '4819', 40, 20);

    // Finished Goods (with selling price, GST rate, HSN, and distinct product images)
    seedItem('prod-mrk-200', 'NITT-MRK-200', 'Murukku 200 g', 'FINISHED_GOOD', 'packets', '200 g', 45, 5, '21069099', 100, 50, '/api/uploads/products/murukku-200g.png');
    seedItem('prod-mix-250', 'NITT-MIX-250', 'Madras Mixture 250 g', 'FINISHED_GOOD', 'packets', '250 g', 60, 5, '21069099', 60, 50, '/api/uploads/products/madras-mixture-250g.png');
    seedItem('prod-pnt-150', 'NITT-PNT-150', 'Masala Peanuts 150 g', 'FINISHED_GOOD', 'packets', '150 g', 35, 12, '20081100', 120, 40, '/api/uploads/products/masala-peanuts-150g.png');
    seedItem('prod-rib-200', 'NITT-RIB-200', 'Ribbon Pakoda 200 g', 'FINISHED_GOOD', 'packets', '200 g', 50, 5, '21069099', 25, 40, '/api/uploads/products/ribbon-pakoda-200g.png');

    // Supplier -> Material Associations
    const insertSupMat = db.prepare(`INSERT INTO supplier_materials (supplier_id, item_id) VALUES (?, ?)`);
    for (const rm of ['rm-rice-flour', 'rm-urad-flour', 'rm-besan', 'rm-peanuts']) {
      insertSupMat.run('sup-1', rm);
    }
    for (const rm of ['rm-groundnut-oil', 'rm-spice-mix']) {
      insertSupMat.run('sup-2', rm);
    }
    for (const pkg of ['pkg-pouch-200', 'pkg-pouch-250', 'pkg-pouch-150', 'pkg-carton']) {
      insertSupMat.run('sup-3', pkg);
    }

    // 5. Seed BOM Items (both Raw Materials + Packaging Materials)
    const insertBom = db.prepare(`
      INSERT INTO bom_items (id, product_id, material_id, quantity_per_unit_scaled)
      VALUES (?, ?, ?, ?)
    `);
    const seedBom = (productId: string, materialId: string, qty: number) => {
      insertBom.run(`bom-${productId}-${materialId}`, productId, materialId, toScaledQty(qty));
    };

    // Murukku 200 g
    seedBom('prod-mrk-200', 'rm-rice-flour', 0.12);
    seedBom('prod-mrk-200', 'rm-urad-flour', 0.04);
    seedBom('prod-mrk-200', 'rm-groundnut-oil', 0.05);
    seedBom('prod-mrk-200', 'rm-spice-mix', 0.01);
    seedBom('prod-mrk-200', 'pkg-pouch-200', 1);

    // Madras Mixture 250 g
    seedBom('prod-mix-250', 'rm-besan', 0.15);
    seedBom('prod-mix-250', 'rm-peanuts', 0.05);
    seedBom('prod-mix-250', 'rm-groundnut-oil', 0.06);
    seedBom('prod-mix-250', 'rm-spice-mix', 0.015);
    seedBom('prod-mix-250', 'pkg-pouch-250', 1);

    // Masala Peanuts 150 g
    seedBom('prod-pnt-150', 'rm-peanuts', 0.12);
    seedBom('prod-pnt-150', 'rm-besan', 0.03);
    seedBom('prod-pnt-150', 'rm-groundnut-oil', 0.03);
    seedBom('prod-pnt-150', 'rm-spice-mix', 0.01);
    seedBom('prod-pnt-150', 'pkg-pouch-150', 1);

    // Ribbon Pakoda 200 g
    seedBom('prod-rib-200', 'rm-rice-flour', 0.11);
    seedBom('prod-rib-200', 'rm-besan', 0.07);
    seedBom('prod-rib-200', 'rm-groundnut-oil', 0.05);
    seedBom('prod-rib-200', 'rm-spice-mix', 0.01);
    seedBom('prod-rib-200', 'pkg-pouch-200', 1);

    // 6. Seed Orders (plus order_items snapshots)
    const insertOrder = db.prepare(`
      INSERT INTO orders (id, order_number, customer_id, salesman_user_id, product_id, requested_qty_scaled, dispatched_qty_scaled, subtotal_paise, order_date, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrderItem = db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, sku, pack_size, unit, image_url,
        unit_price_paise, gst_rate_bps, requested_qty_scaled, dispatched_qty_scaled
      )
      SELECT ?, ?, id, name, sku, pack_size, unit, image_url, selling_price_paise, gst_rate_bps, ?, ?
      FROM inventory_items WHERE id = ?
    `);
    const insertOrderAudit = db.prepare(`
      INSERT INTO order_audit_trail (id, order_id, timestamp, actor_user_id, actor_name, action, from_status, to_status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // ORD-2026-0142: Murukku 200 g, 150 requested, 100 in stock -> 50 shortage (raw/pkg sufficient)
    insertOrder.run('ord-2026-0142', 'ORD-2026-0142', 'cust-04', 'usr-salesman', 'prod-mrk-200', toScaledQty(150), 0, toPaise(150 * 45), '2026-11-25', 'SUBMITTED', 'Weekly student hostel canteen indent.', '2026-11-25T09:15:00.000Z', '2026-11-25T09:15:00.000Z');
    insertOrderItem.run('oi-142-1', 'ord-2026-0142', toScaledQty(150), 0, 'prod-mrk-200');
    insertOrderAudit.run('aud-142-1', 'ord-2026-0142', '2026-11-25T09:15:00.000Z', 'usr-salesman', 'Arun Kumar (Salesman)', 'Order submitted by Arun Kumar (Salesman)', null, 'SUBMITTED', '');

    // ORD-2026-0143: Madras Mixture 250 g, 200 requested, 60 in stock -> 140 shortage (Besan, Peanuts, Pouch 250g insufficient!)
    insertOrder.run('ord-2026-0143', 'ORD-2026-0143', 'cust-01', 'usr-salesman', 'prod-mix-250', toScaledQty(200), 0, toPaise(200 * 60), '2026-11-25', 'UNDER_REVIEW', 'Symposium refreshment requirement.', '2026-11-25T09:40:00.000Z', '2026-11-25T10:10:00.000Z');
    insertOrderItem.run('oi-143-1', 'ord-2026-0143', toScaledQty(200), 0, 'prod-mix-250');
    insertOrderAudit.run('aud-143-2', 'ord-2026-0143', '2026-11-25T10:10:00.000Z', 'usr-admin', 'Admin', 'Opened for availability review', 'SUBMITTED', 'UNDER_REVIEW', '');
    insertOrderAudit.run('aud-143-1', 'ord-2026-0143', '2026-11-25T09:40:00.000Z', 'usr-salesman', 'Arun Kumar (Salesman)', 'Order submitted by Arun Kumar (Salesman)', null, 'SUBMITTED', '');

    // ORD-2026-0144: Masala Peanuts 150 g, 50 requested, 120 in stock -> sufficient
    insertOrder.run('ord-2026-0144', 'ORD-2026-0144', 'cust-09', 'usr-salesman', 'prod-pnt-150', toScaledQty(50), 0, toPaise(50 * 35), '2026-11-24', 'SUBMITTED', 'Standard shelf replenishment.', '2026-11-24T16:20:00.000Z', '2026-11-24T16:20:00.000Z');
    insertOrderItem.run('oi-144-1', 'ord-2026-0144', toScaledQty(50), 0, 'prod-pnt-150');
    insertOrderAudit.run('aud-144-1', 'ord-2026-0144', '2026-11-24T16:20:00.000Z', 'usr-salesman', 'Arun Kumar (Salesman)', 'Order submitted by Arun Kumar (Salesman)', null, 'SUBMITTED', '');

    // ORD-2026-0141: Ribbon Pakoda 200 g, 85 requested, 25 in stock -> 60 PR-2026-0001 (belongs to usr-salesman-2)
    insertOrder.run('ord-2026-0141', 'ORD-2026-0141', 'cust-06', 'usr-salesman-2', 'prod-rib-200', toScaledQty(85), 0, toPaise(85 * 50), '2026-11-24', 'PRODUCTION_REQUIRED', '60 packets queued for production batch.', '2026-11-24T11:30:00.000Z', '2026-11-24T14:05:00.000Z');
    insertOrderItem.run('oi-141-1', 'ord-2026-0141', toScaledQty(85), 0, 'prod-rib-200');
    insertOrderAudit.run('aud-141-2', 'ord-2026-0141', '2026-11-24T14:05:00.000Z', 'usr-admin', 'Admin', 'Sent shortage (60 packets) for production (PR-2026-0001)', 'SUBMITTED', 'PRODUCTION_REQUIRED', '');
    insertOrderAudit.run('aud-141-1', 'ord-2026-0141', '2026-11-24T11:30:00.000Z', 'usr-salesman-2', 'Priya Dharshini (Salesman)', 'Order submitted by Priya Dharshini (Salesman)', null, 'SUBMITTED', '');

    // ORD-2026-0140: Faculty Club Store, Masala Peanuts 150 g, 60 packets, APPROVED (awaiting dispatch)
    insertOrder.run('ord-2026-0140', 'ORD-2026-0140', 'cust-03', null, 'prod-pnt-150', toScaledQty(60), 0, toPaise(60 * 35), '2026-11-23', 'APPROVED', 'Approved; awaiting dispatch voucher.', '2026-11-23T12:00:00.000Z', '2026-11-23T15:00:00.000Z');
    insertOrderItem.run('oi-140-1', 'ord-2026-0140', toScaledQty(60), 0, 'prod-pnt-150');
    insertOrderAudit.run('aud-140-2', 'ord-2026-0140', '2026-11-23T15:00:00.000Z', 'usr-admin', 'Admin', 'Approved order (inventory unchanged until dispatch)', 'SUBMITTED', 'APPROVED', '');

    // ORD-2026-0139: Diamond Hostel Canteen, Murukku 200 g, 80 packets, DISPATCHED + Invoiced (CGST+SGST) + Partial Payment
    insertOrder.run('ord-2026-0139', 'ORD-2026-0139', 'cust-02', null, 'prod-mrk-200', toScaledQty(80), toScaledQty(80), toPaise(80 * 45), '2026-11-22', 'DISPATCHED', 'Dispatched via Gate Pass GP-884.', '2026-11-22T10:00:00.000Z', '2026-11-22T17:10:00.000Z');
    insertOrderItem.run('oi-139-1', 'ord-2026-0139', toScaledQty(80), toScaledQty(80), 'prod-mrk-200');
    insertOrderAudit.run('aud-139-2', 'ord-2026-0139', '2026-11-22T17:10:00.000Z', 'usr-admin', 'Dispatch Desk', 'Full quantity (80 packets) dispatched; stock updated', 'APPROVED', 'DISPATCHED', '');

    // ORD-2026-0138: Bengaluru Alumni Store, Masala Peanuts 150 g, 40 packets, DISPATCHED + Invoiced (IGST)
    insertOrder.run('ord-2026-0138', 'ORD-2026-0138', 'cust-10', null, 'prod-pnt-150', toScaledQty(40), toScaledQty(40), toPaise(40 * 35), '2026-11-21', 'DISPATCHED', 'Inter-state dispatch via parcel courier.', '2026-11-21T09:00:00.000Z', '2026-11-21T16:30:00.000Z');
    insertOrderItem.run('oi-138-1', 'ord-2026-0138', toScaledQty(40), toScaledQty(40), 'prod-pnt-150');
    insertOrderAudit.run('aud-138-2', 'ord-2026-0138', '2026-11-21T16:30:00.000Z', 'usr-admin', 'Dispatch Desk', 'Full quantity (40 packets) dispatched; stock updated', 'APPROVED', 'DISPATCHED', '');

    // ORD-2026-0137: Historical completed production + dispatched order for Production Monitoring visibility
    insertOrder.run('ord-2026-0137', 'ORD-2026-0137', 'cust-01', null, 'prod-mrk-200', toScaledQty(100), toScaledQty(100), toPaise(100 * 45), '2026-11-20', 'DISPATCHED', 'Prior batch completed and dispatched.', '2026-11-20T09:00:00.000Z', '2026-11-20T18:00:00.000Z');
    insertOrderItem.run('oi-137-1', 'ord-2026-0137', toScaledQty(100), toScaledQty(100), 'prod-mrk-200');

    // 7. Seed Production Requests (1 active pending, 1 completed)
    const insertPr = db.prepare(`
      INSERT INTO production_requests (id, request_number, order_id, product_id, requested_qty_scaled, status, assigned_supervisor_id, supervisor_status, created_at, created_by, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPr.run('pr-ord-141', 'PR-2026-0001', 'ord-2026-0141', 'prod-rib-200', toScaledQty(60), 'PENDING_SUPERVISOR_REVIEW', null, 'Pending Supervisor Review', '2026-11-24T14:05:00.000Z', 'Admin', 'Awaiting supervisor batch scheduling.', '2026-11-24T14:05:00.000Z');
    insertPr.run('pr-ord-137', 'PR-2026-0000', 'ord-2026-0137', 'prod-mrk-200', toScaledQty(50), 'COMPLETED', 'usr-supervisor', 'Completed & Posted', '2026-11-20T10:00:00.000Z', 'Admin', 'Batch completed by supervisor.', '2026-11-20T15:30:00.000Z');

    // 8. Seed 1 Completed Production Run for PR-2026-0000 (planned 50, actual 48, wastage 2, variance -2)
    db.prepare(`
      INSERT INTO production_runs (id, run_number, production_request_id, product_id, planned_qty_scaled, actual_output_qty_scaled, wastage_qty_scaled, variance_qty_scaled, status, supervisor_user_id, supervisor_name, posted_at, notes, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?)
    `).run(
      'run-2026-0001',
      'RUN-2026-0001',
      'pr-ord-137',
      'prod-mrk-200',
      toScaledQty(50),
      toScaledQty(48),
      toScaledQty(2),
      -toScaledQty(2),
      'usr-supervisor',
      'Karthik Raja (Supervisor)',
      '2026-11-20T15:30:00.000Z',
      '2 packets rejected during sealing QC.',
      'seed-run-1'
    );

    const insertRunCons = db.prepare(`
      INSERT INTO production_run_consumptions (id, production_run_id, material_id, planned_qty_scaled, actual_consumed_qty_scaled, wastage_qty_scaled)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertRunCons.run('rc-1', 'run-2026-0001', 'rm-rice-flour', toScaledQty(6), toScaledQty(6.2), toScaledQty(0.2));
    insertRunCons.run('rc-2', 'run-2026-0001', 'rm-urad-flour', toScaledQty(2), toScaledQty(2.0), 0);
    insertRunCons.run('rc-3', 'run-2026-0001', 'rm-groundnut-oil', toScaledQty(2.5), toScaledQty(2.6), toScaledQty(0.1));
    insertRunCons.run('rc-4', 'run-2026-0001', 'rm-spice-mix', toScaledQty(0.5), toScaledQty(0.5), 0);
    insertRunCons.run('rc-5', 'run-2026-0001', 'pkg-pouch-200', toScaledQty(50), toScaledQty(50), toScaledQty(2));

    // 9. Seed Dispatches, Invoices (Intra-State CGST+SGST & Inter-State IGST), and Partial Payment
    const insertDisp = db.prepare(`
      INSERT INTO dispatches (id, dispatch_number, order_id, dispatched_qty_scaled, invoiced_qty_scaled, dispatched_at, dispatched_by, idempotency_key, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertDisp.run('disp-0139', 'DISP-2026-0001', 'ord-2026-0139', toScaledQty(80), toScaledQty(80), '2026-11-22T17:10:00.000Z', 'Admin', 'seed-disp-139', 'Gate Pass GP-884');
    insertDisp.run('disp-0138', 'DISP-2026-0002', 'ord-2026-0138', toScaledQty(40), toScaledQty(40), '2026-11-21T16:30:00.000Z', 'Admin', 'seed-disp-138', 'Inter-state parcel');

    // Invoice 1: Diamond Hostel Canteen (Tamil Nadu -> CGST 2.5% + SGST 2.5%) for 80 * ₹45 = ₹3,600 + ₹180 GST = ₹3,780
    const inv1Taxable = calcTaxablePaise(toScaledQty(80), toPaise(45));
    const inv1Gst = calcGstPaise(inv1Taxable, toGstBps(5), 'INTRA_STATE');
    const inv1Total = inv1Taxable + inv1Gst.totalGstPaise;
    const inv1Paid = toPaise(2000);

    db.prepare(`
      INSERT INTO invoices (id, invoice_number, order_id, customer_id, dispatch_id, invoice_date, supply_type, place_of_supply_state, taxable_amount_paise, cgst_amount_paise, sgst_amount_paise, igst_amount_paise, total_gst_paise, total_amount_paise, paid_amount_paise, payment_status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('inv-0001', 'INV-2026-0001', 'ord-2026-0139', 'cust-02', 'disp-0139', '2026-11-22', 'INTRA_STATE', 'Tamil Nadu', inv1Taxable, inv1Gst.cgstPaise, inv1Gst.sgstPaise, 0, inv1Gst.totalGstPaise, inv1Total, inv1Paid, 'PARTIALLY_PAID', 'Lakshmi Narayanan (Accountant)', '2026-11-22T18:00:00.000Z');

    db.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, product_name, sku, hsn_code, unit, quantity_scaled, unit_price_paise, gst_rate_bps, taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('invl-1', 'inv-0001', 'prod-mrk-200', 'Murukku 200 g', 'NITT-MRK-200', '21069099', 'packets', toScaledQty(80), toPaise(45), toGstBps(5), inv1Taxable, inv1Gst.cgstPaise, inv1Gst.sgstPaise, 0, inv1Total);

    db.prepare(`
      INSERT INTO payments (id, payment_number, invoice_id, customer_id, payment_date, amount_paise, payment_mode, reference_number, recorded_by, notes, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('pay-0001', 'PAY-2026-0001', 'inv-0001', 'cust-02', '2026-11-23', inv1Paid, 'UPI / Campus Transfer', 'UTR-NITT-77412', 'Lakshmi Narayanan (Accountant)', 'First installment received; balance pending', 'seed-pay-1', '2026-11-23T11:20:00.000Z');

    // Invoice 2: Bengaluru Alumni Store (Karnataka -> IGST 12%) for 40 * ₹35 = ₹1,400 + ₹168 IGST = ₹1,568
    const inv2Taxable = calcTaxablePaise(toScaledQty(40), toPaise(35));
    const inv2Gst = calcGstPaise(inv2Taxable, toGstBps(12), 'INTER_STATE');
    const inv2Total = inv2Taxable + inv2Gst.totalGstPaise;

    db.prepare(`
      INSERT INTO invoices (id, invoice_number, order_id, customer_id, dispatch_id, invoice_date, supply_type, place_of_supply_state, taxable_amount_paise, cgst_amount_paise, sgst_amount_paise, igst_amount_paise, total_gst_paise, total_amount_paise, paid_amount_paise, payment_status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('inv-0002', 'INV-2026-0002', 'ord-2026-0138', 'cust-10', 'disp-0138', '2026-11-21', 'INTER_STATE', 'Karnataka', inv2Taxable, 0, 0, inv2Gst.igstPaise, inv2Gst.totalGstPaise, inv2Total, 0, 'UNPAID', 'Lakshmi Narayanan (Accountant)', '2026-11-21T17:45:00.000Z');

    db.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, product_name, sku, hsn_code, unit, quantity_scaled, unit_price_paise, gst_rate_bps, taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('invl-2', 'inv-0002', 'prod-pnt-150', 'Masala Peanuts 150 g', 'NITT-PNT-150', '20081100', 'packets', toScaledQty(40), toPaise(35), toGstBps(12), inv2Taxable, 0, 0, inv2Gst.igstPaise, inv2Total);
  });
}

