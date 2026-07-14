import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "haveli.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id            TEXT PRIMARY KEY,
    orderNo       TEXT,
    customerName  TEXT,
    customerEmail TEXT,
    customerPhone TEXT,
    customer      TEXT,   -- full customer object as JSON
    items         TEXT,   -- line items as JSON
    subtotal      INTEGER,
    shippingFee   INTEGER,
    total         INTEGER,
    payment       TEXT,
    paymentStatus TEXT,
    paymentId     TEXT,
    status        TEXT,
    createdAt     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders(createdAt);
`);

const insertStmt = db.prepare(`
  INSERT INTO orders (
    id, orderNo, customerName, customerEmail, customerPhone, customer, items,
    subtotal, shippingFee, total, payment, paymentStatus, paymentId, status, createdAt
  ) VALUES (
    @id, @orderNo, @customerName, @customerEmail, @customerPhone, @customer, @items,
    @subtotal, @shippingFee, @total, @payment, @paymentStatus, @paymentId, @status, @createdAt
  )
`);

// Convert a stored row back into the nested order object the app/API uses.
function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.orderNo,
    customer: JSON.parse(row.customer || "{}"),
    items: JSON.parse(row.items || "[]"),
    subtotal: row.subtotal,
    shippingFee: row.shippingFee,
    total: row.total,
    payment: row.payment,
    paymentStatus: row.paymentStatus,
    paymentId: row.paymentId,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export function insertOrder(order) {
  insertStmt.run({
    id: order.id,
    orderNo: order.orderNo,
    customerName: order.customer?.name || "",
    customerEmail: order.customer?.email || "",
    customerPhone: order.customer?.phone || "",
    customer: JSON.stringify(order.customer || {}),
    items: JSON.stringify(order.items || []),
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    payment: order.payment,
    paymentStatus: order.paymentStatus,
    paymentId: order.paymentId || null,
    status: order.status,
    createdAt: order.createdAt,
  });
  return order;
}

export function listOrders() {
  const rows = db.prepare("SELECT * FROM orders ORDER BY createdAt DESC").all();
  return rows.map(rowToOrder);
}

export function getOrder(id) {
  return rowToOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
}

export function countOrders() {
  return db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
}

// One-time migration: if an old orders.json exists, import its rows into SQLite.
export function migrateFromJson() {
  const jsonPath = path.join(DATA_DIR, "orders.json");
  if (!fs.existsSync(jsonPath)) return;
  if (countOrders() > 0) return;
  let legacy = [];
  try {
    legacy = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch {
    return;
  }
  if (!Array.isArray(legacy) || !legacy.length) return;
  const tx = db.transaction((orders) => {
    for (const o of orders) {
      // Old orders may have used `shipping` instead of `customer`.
      const customer = o.customer || o.shipping || {};
      insertOrder({ ...o, customer });
    }
  });
  tx(legacy);
  console.log(`Migrated ${legacy.length} order(s) from orders.json into SQLite.`);
  fs.renameSync(jsonPath, jsonPath + ".bak");
}

export default db;
