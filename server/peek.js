/**
 * Read-only look at everything the backend has stored.
 *
 *   cd server && node peek.js              # catalog + recent orders
 *   cd server && node peek.js --orders 50  # more orders
 *   cd server && node peek.js --json       # raw JSON, for piping
 *
 * Respects DATA_DIR, so on a server you can point it at the real data:
 *   DATA_DIR=/var/data node peek.js
 *
 * This opens the database read-only and never writes anything.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PRODUCTS = path.join(DATA_DIR, "products.json");
const DB = path.join(DATA_DIR, "haveli.db");
const UPLOADS = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const limit = Number(args[args.indexOf("--orders") + 1]) || 15;

const rupees = (n) => "Rs " + new Intl.NumberFormat("en-IN").format(n || 0);

/* ---------- catalog ---------- */
let products = [];
try {
  products = JSON.parse(fs.readFileSync(PRODUCTS, "utf-8"));
} catch {
  /* file may not exist yet */
}

/* ---------- orders ---------- */
let orders = [];
let orderCount = 0;
try {
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  orderCount = db.prepare("SELECT COUNT(*) c FROM orders").get().c;
  orders = db
    .prepare("SELECT * FROM orders ORDER BY createdAt DESC LIMIT ?")
    .all(limit)
    .map((r) => ({ ...r, customer: JSON.parse(r.customer || "{}"), items: JSON.parse(r.items || "[]") }));
  db.close();
} catch {
  /* database may not exist yet */
}

if (asJson) {
  console.log(JSON.stringify({ dataDir: DATA_DIR, products, orderCount, orders }, null, 2));
  process.exit(0);
}

/* ---------- report ---------- */
console.log(`\nDATA_DIR  ${DATA_DIR}`);
for (const [label, p] of [["catalog ", PRODUCTS], ["orders  ", DB], ["images  ", UPLOADS]]) {
  const exists = fs.existsSync(p);
  const size = exists && fs.statSync(p).isFile() ? ` (${fs.statSync(p).size} bytes)` : "";
  console.log(`${label}  ${exists ? "✓" : "✗ missing"}  ${p}${size}`);
}

console.log(`\n── CATALOG (${products.length}) ─────────────────────────────`);
if (!products.length) console.log("  (empty)");
for (const p of products) {
  const stock =
    p.stock === null || p.stock === undefined
      ? "stock not tracked"
      : `${p.stock} in stock`;
  const flags = [p.featured && "featured", p.inStock === false && "SOLD OUT"]
    .filter(Boolean)
    .join(", ");
  console.log(
    `  ${p.name}\n    ${rupees(p.price)} · ${p.category} · ${stock}${flags ? " · " + flags : ""}`
  );
}

console.log(`\n── ORDERS (${orderCount} total, showing ${orders.length}) ──────────`);
if (!orders.length) console.log("  (none)");
for (const o of orders) {
  const when = new Date(o.createdAt).toISOString().slice(0, 16).replace("T", " ");
  console.log(
    `  #${o.orderNo}  ${when}  ${rupees(o.total)}  [${o.paymentStatus}]\n` +
      `    ${o.customer.name || "?"} · ${o.customer.email || "?"} · ${o.customer.phone || "?"}\n` +
      `    ${o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}`
  );
}

const paid = orders.filter((o) => (o.paymentStatus || "").startsWith("Paid"));
console.log(
  `\n  ${paid.length} of the ${orders.length} shown are paid · ` +
    `revenue shown: ${rupees(paid.reduce((s, o) => s + o.total, 0))}\n`
);
