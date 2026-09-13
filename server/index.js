import express from "express";
import cors from "cors";
import multer from "multer";
import nodemailer from "nodemailer";
import {
  insertOrder,
  listOrders,
  migrateFromJson,
  getOrderByOrderNo,
  updateOrderPayment,
} from "./db.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5050;

// Change this to your own secret password. Logging into the admin panel uses it.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "saree-admin";

// Email (SMTP) for order confirmations. Set these in server/.env to send real
// mail; leave unset to run in "demo mode" (the email is logged, not sent).
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SHOP_EMAIL = process.env.SHOP_EMAIL || SMTP_USER || "orders@haveliwale.com";
const SHOP_NAME = "Pankaj Enterprises";
const emailConfigured = () => Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

// ---- HDFC SmartGateway payment config ------------------------------------
// Get these from the HDFC SmartGateway dashboard. Set them in server/.env.
// Leave HDFC_API_KEY unset to run checkout in demo mode (no real charge).
//   HDFC_API_KEY        — Base64 is applied for you; paste the raw API key
//   HDFC_MERCHANT_ID    — your merchant id (x-merchantid)
//   HDFC_CLIENT_ID      — payment_page_client_id (defaults to the merchant id
//                         in production; use "hdfcmaster" for sandbox)
//   HDFC_ENV            — "production" (default) or "sandbox"
//   HDFC_RESELLER_ID    — x-resellerid (defaults to "hdfc_reseller")
// Public URLs, used to build the redirect return_url and to send the shopper
// back to the storefront afterwards:
//   PUBLIC_SERVER_URL   — this server's public https origin (return_url host)
//   CLIENT_URL          — the storefront origin to return the shopper to
const HDFC_API_KEY = process.env.HDFC_API_KEY || "";
const HDFC_MERCHANT_ID = process.env.HDFC_MERCHANT_ID || "";
const HDFC_CLIENT_ID =
  process.env.HDFC_CLIENT_ID || HDFC_MERCHANT_ID || "";
const HDFC_ENV = (process.env.HDFC_ENV || "production").toLowerCase();
const HDFC_RESELLER_ID = process.env.HDFC_RESELLER_ID || "hdfc_reseller";
const HDFC_BASE_URL =
  process.env.HDFC_BASE_URL ||
  (HDFC_ENV === "sandbox"
    ? "https://smartgateway.hdfcuat.bank.in"
    : "https://smartgateway.hdfc.bank.in");

const PUBLIC_SERVER_URL = (
  process.env.PUBLIC_SERVER_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");
const CLIENT_URL = (
  process.env.CLIENT_URL || "http://localhost:5173"
).replace(/\/$/, "");

const hdfcConfigured = () => Boolean(HDFC_API_KEY && HDFC_MERCHANT_ID);

// Basic-auth header: base64 of "<api_key>:" (API key as username, no password).
function hdfcAuthHeaders(customerId) {
  return {
    Authorization: `Basic ${Buffer.from(`${HDFC_API_KEY}:`).toString("base64")}`,
    "Content-Type": "application/json",
    "x-merchantid": HDFC_MERCHANT_ID,
    "x-customerid": customerId,
    "x-resellerid": HDFC_RESELLER_ID,
  };
}

/**
 * Creates a SmartGateway payment session and returns the hosted payment-page
 * URL the shopper must be redirected to. `amountRupees` is a number in INR.
 */
async function createHdfcSession(orderId, amountRupees, customer, returnUrl) {
  const [firstName, ...rest] = (customer.name || "").trim().split(" ");
  const body = {
    order_id: orderId,
    amount: amountRupees.toFixed(2),
    customer_id: customer.customerId,
    customer_email: customer.email || "",
    customer_phone: (customer.phone || "").replace(/\D/g, "").slice(-10),
    payment_page_client_id: HDFC_CLIENT_ID,
    action: "paymentPage",
    currency: "INR",
    return_url: returnUrl,
    description: `${SHOP_NAME} order ${orderId}`,
    first_name: firstName || "",
    last_name: rest.join(" "),
  };
  const res = await fetch(`${HDFC_BASE_URL}/session`, {
    method: "POST",
    headers: hdfcAuthHeaders(customer.customerId),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SmartGateway session error: ${text}`);
  }
  const data = await res.json();
  const link = data?.payment_links?.web;
  if (!link) {
    throw new Error("SmartGateway did not return a payment link");
  }
  return { paymentLink: link, raw: data };
}

/**
 * Authoritative server-to-server check of an order's final status. Returns the
 * SmartGateway order object ({ status, amount, ... }). `status === "CHARGED"`
 * means the payment succeeded.
 */
async function getHdfcOrderStatus(orderId, customerId) {
  const res = await fetch(
    `${HDFC_BASE_URL}/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      headers: hdfcAuthHeaders(customerId),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SmartGateway order-status error: ${text}`);
  }
  return res.json();
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "products.json");

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ----- Tiny JSON "database" -----------------------------------------------
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readProducts() {
  const data = readJSON(DB_FILE, null);
  return data;
}
function writeProducts(products) {
  writeJSON(DB_FILE, products);
}
// ----- Order confirmation email -------------------------------------------
let transporter = null;
function getTransporter() {
  if (!emailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

const inr = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);

function orderEmailHtml(order) {
  const rows = order.items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;color:#2a2024">${i.name} &times; ${i.qty}</td>
        <td style="padding:8px 0;text-align:right;color:#6d1f3a">${inr(i.price * i.qty)}</td>
      </tr>`
    )
    .join("");
  const c = order.customer;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2a2024">
    <div style="background:#6d1f3a;color:#fbf6f0;padding:24px 28px;border-radius:14px 14px 0 0">
      <h1 style="margin:0;font-family:Georgia,serif">Pankaj Enterprises</h1>
      <p style="margin:6px 0 0;opacity:.85">Thank you for your order!</p>
    </div>
    <div style="border:1px solid #e8ddd2;border-top:none;padding:24px 28px;border-radius:0 0 14px 14px">
      <p>Hi ${c.name || "there"},</p>
      <p>Your order <strong>#${order.orderNo}</strong> is confirmed. Here's a summary:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        ${rows}
        <tr><td colspan="2" style="border-top:1px solid #e8ddd2;padding-top:10px"></td></tr>
        <tr><td style="color:#8a7d82">Shipping</td><td style="text-align:right">${
          order.shippingFee ? inr(order.shippingFee) : "Free"
        }</td></tr>
        <tr><td style="font-weight:bold">Total</td><td style="text-align:right;font-weight:bold;color:#6d1f3a">${inr(
          order.total
        )}</td></tr>
      </table>
      <p style="margin:0 0 4px;font-weight:bold">Delivering to</p>
      <p style="margin:0;color:#5c5055;line-height:1.6">
        ${c.name}<br/>${c.address}<br/>${c.city} — ${c.pincode}<br/>${c.phone}
      </p>
      <p style="margin:20px 0 0;color:#8a7d82;font-size:13px">
        Payment: Paid online ·
        ${order.paymentStatus}
      </p>
      <p style="margin:18px 0 0">With love,<br/>Team Pankaj Enterprises</p>
    </div>
  </div>`;
}

async function sendOrderEmail(order) {
  const to = order.customer.email;
  if (!to) return { sent: false, reason: "no email" };
  const mail = {
    from: `${SHOP_NAME} <${SHOP_EMAIL}>`,
    to,
    subject: `Your Pankaj Enterprises order #${order.orderNo} is confirmed`,
    html: orderEmailHtml(order),
  };
  const tx = getTransporter();
  if (!tx) {
    console.log(`[email demo] Confirmation for ${to} (order #${order.orderNo}) — set SMTP_* to send for real.`);
    return { sent: false, reason: "demo" };
  }
  try {
    await tx.sendMail(mail);
    console.log(`[email] Sent confirmation to ${to} for order #${order.orderNo}`);
    return { sent: true };
  } catch (err) {
    console.error(`[email] Failed for ${to}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// Seed a few sarees on first run so the storefront isn't empty.
function seed() {
  if (readProducts()) return;
  const now = Date.now();
  const sample = [
    {
      id: crypto.randomUUID(),
      name: "Royal Kanjivaram Silk",
      description:
        "Handwoven pure Kanjivaram silk with a contrast border and intricate gold zari motifs. A timeless heirloom piece for weddings and grand occasions.",
      price: 12999,
      originalPrice: 16999,
      category: "Kanjivaram",
      fabric: "Pure Silk",
      color: "Maroon & Gold",
      images: [
        "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=900&q=80",
      ],
      featured: true,
      inStock: true,
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      name: "Banarasi Festive Drape",
      description:
        "Lustrous Banarasi silk with delicate floral jaal weaving throughout the body. Lightweight, elegant, and perfect for festive evenings.",
      price: 8499,
      originalPrice: 10999,
      category: "Banarasi",
      fabric: "Silk Blend",
      color: "Emerald Green",
      images: [
        "https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=900&q=80",
      ],
      featured: true,
      inStock: true,
      createdAt: now - 1000,
    },
    {
      id: crypto.randomUUID(),
      name: "Soft Cotton Handloom",
      description:
        "Breathable handloom cotton saree with a minimal temple border. An everyday classic that stays comfortable from morning to night.",
      price: 2499,
      originalPrice: 2999,
      category: "Cotton",
      fabric: "Handloom Cotton",
      color: "Indigo Blue",
      images: [
        "https://images.unsplash.com/photo-1617059998515-3c0e2b4f9aa1?w=900&q=80",
      ],
      featured: false,
      inStock: true,
      createdAt: now - 2000,
    },
    {
      id: crypto.randomUUID(),
      name: "Georgette Pastel Charm",
      description:
        "Flowy georgette saree in a soft pastel tone with a subtle sequin border. Designer drape that's easy to carry for parties and receptions.",
      price: 5999,
      originalPrice: 7499,
      category: "Georgette",
      fabric: "Georgette",
      color: "Blush Pink",
      images: [
        "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=900&q=80",
      ],
      featured: true,
      inStock: true,
      createdAt: now - 3000,
    },
  ];
  writeProducts(sample);
  console.log("Seeded sample sarees.");
}
seed();
migrateFromJson();

// ----- App ----------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static(UPLOAD_DIR));

// Admin sessions are signed tokens, not a list held in memory. The old
// in-memory list was wiped by every restart (so by every Render deploy), which
// signed the admin out on the server while the browser still looked signed
// in, and every upload or save then failed with "Unauthorized".
//
// A token is base64url({ exp }) + "." + an HMAC of that, so the server can
// check it without remembering anything. The key is derived from the admin
// password unless ADMIN_TOKEN_SECRET is set, so changing the password signs
// everyone out.
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOKEN_SECRET =
  process.env.ADMIN_TOKEN_SECRET ||
  crypto.createHash("sha256").update(`admin-token:${ADMIN_PASSWORD}`).digest("hex");

function signToken(payload) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
}

function issueToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })
  ).toString("base64url");
  return `${payload}.${signToken(payload)}`;
}

function verifyToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(signToken(payload));
  const given = Buffer.from(sig);
  if (given.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(given, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Number(exp) > Date.now();
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "").trim();
  if (verifyToken(token)) return next();
  return res
    .status(401)
    .json({ error: "Your admin session has expired. Please sign in again." });
}

// ----- Image upload -------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// ----- Routes -------------------------------------------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ token: issueToken() });
  }
  return res.status(401).json({ error: "Incorrect password" });
});

// Lets the admin panel confirm on load that its saved session is still
// accepted, so an expired one is caught before the admin types anything.
app.get("/api/admin/session", requireAuth, (_req, res) => {
  res.json({ ok: true });
});

// ----- Payments (HDFC SmartGateway) ---------------------------------------
app.get("/api/payments/config", (_req, res) => {
  res.json({ configured: hdfcConfigured() });
});

// Normalises + validates the checkout customer. Returns { customer } or
// { error } so callers can respond consistently.
function readCustomer(body) {
  const c = body?.customer || {};
  const customer = {
    name: String(c.name || "").trim(),
    email: String(c.email || "").trim(),
    phone: String(c.phone || "").trim(),
    address: String(c.address || "").trim(),
    city: String(c.city || "").trim(),
    pincode: String(c.pincode || "").trim(),
  };
  if (!customer.name || !customer.email || !customer.phone || !customer.address) {
    return { error: "Please fill in your contact and address details" };
  }
  if (!/^\S+@\S+\.\S+$/.test(customer.email)) {
    return { error: "Please enter a valid email address" };
  }
  return { customer };
}

/**
 * Rebuilds the cart from the catalog on disk. The browser only gets to say
 * WHICH product and HOW MANY — the price, name and image always come from the
 * admin's catalog, never from the request. Without this a shopper could edit
 * the request and pay any amount they liked.
 *
 * Also enforces availability. Returns { items } or { error }.
 */
function resolveCartItems(rawItems) {
  const catalog = readProducts() || [];
  const resolved = [];

  for (const raw of rawItems) {
    const product = catalog.find((p) => p.id === raw.id);
    if (!product) {
      return { error: `"${raw.name || "An item"}" is no longer available.` };
    }

    const qty = Math.max(1, Math.floor(Number(raw.qty) || 1));

    if (product.inStock === false) {
      return { error: `${product.name} is sold out.` };
    }
    // stock === null/undefined means "not tracked" — availability is governed
    // by the inStock flag alone, which is how older products behave.
    if (product.stock !== null && product.stock !== undefined) {
      if (product.stock <= 0) {
        return { error: `${product.name} is sold out.` };
      }
      if (qty > product.stock) {
        return {
          error:
            product.stock === 1
              ? `Only 1 left of ${product.name}.`
              : `Only ${product.stock} left of ${product.name}.`,
        };
      }
    }

    resolved.push({
      id: product.id,
      name: product.name,
      price: Number(product.price) || 0,
      qty,
      image: product.images?.[0] || "",
    });
  }

  return { items: resolved };
}

/**
 * Reduces tracked stock once an order is actually paid for. Products with an
 * untracked stock level (null) are left alone. An item that reaches zero is
 * flipped to sold out so it stops appearing as buyable.
 */
function decrementStock(items) {
  const catalog = readProducts() || [];
  let changed = false;

  for (const item of items) {
    const product = catalog.find((p) => p.id === item.id);
    if (!product) continue;
    if (product.stock === null || product.stock === undefined) continue;
    product.stock = Math.max(0, product.stock - item.qty);
    if (product.stock === 0) product.inStock = false;
    changed = true;
  }

  if (changed) writeProducts(catalog);
}

// Builds the order object stored in the database. `items` must already have
// been through resolveCartItems, so the prices here are the catalog's.
function buildOrder(items, customer, extra) {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shippingFee = subtotal > 4999 ? 0 : 99;
  return {
    id: crypto.randomUUID(),
    customer,
    items,
    subtotal,
    shippingFee,
    total: subtotal + shippingFee,
    payment: "online",
    createdAt: Date.now(),
    ...extra,
  };
}

// Create a SmartGateway payment session for the current cart. The amount is
// computed server-side, a pending order is recorded, and the shopper is sent
// the hosted payment-page link to redirect to.
app.post("/api/payments/hdfc/session", async (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) return res.status(400).json({ error: "Your cart is empty" });
  const { customer, error } = readCustomer(req.body);
  if (error) return res.status(400).json({ error });

  // Prices and availability come from the catalog, never from the browser.
  const { items, error: cartError } = resolveCartItems(rawItems);
  if (cartError) return res.status(409).json({ error: cartError });

  if (!hdfcConfigured()) {
    // No keys → tell the client to fall back to the demo flow.
    return res.json({ configured: false });
  }

  // order_id must be unique, alphanumeric, < 21 chars.
  const orderNo = "PE" + Date.now().toString();
  // x-customerid is reused on the return status-check, so persist it with the
  // order (inside the customer JSON column).
  const customerId = "CUST" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const customerWithId = { ...customer, customerId };
  const order = buildOrder(items, customerWithId, {
    orderNo,
    paymentStatus: "Pending",
    status: "Payment Pending",
    paymentId: null,
  });
  insertOrder(order);

  const returnUrl = `${PUBLIC_SERVER_URL}/api/payments/hdfc/return`;
  try {
    const { paymentLink } = await createHdfcSession(
      orderNo,
      order.total,
      customerWithId,
      returnUrl
    );
    res.json({ configured: true, paymentLink, orderNo });
  } catch (err) {
    updateOrderPayment(orderNo, {
      paymentStatus: "Failed",
      status: "Payment Failed",
    });
    // Log the gateway's own message for us, but never show it to the shopper —
    // it can contain merchant ids and key diagnostics.
    console.error(`[hdfc] session failed for ${orderNo}:`, err.message);
    res.status(502).json({
      error: "We couldn't reach the payment gateway. Please try again in a moment.",
    });
  }
});

// Return URL — the shopper lands here after HDFC's hosted payment page. We do
// the mandatory server-to-server Order Status check to decide the outcome,
// then redirect the browser back to the storefront.
app.all("/api/payments/hdfc/return", async (req, res) => {
  const orderNo = String(
    req.query.order_id || req.body?.order_id || req.query.orderId || ""
  ).trim();
  const back = (status) =>
    res.redirect(
      `${CLIENT_URL}/checkout?status=${status}` +
        (orderNo ? `&order=${encodeURIComponent(orderNo)}` : "")
    );

  if (!orderNo) return back("failed");
  const order = getOrderByOrderNo(orderNo);
  if (!order) return back("failed");
  // Already finalised (e.g. duplicate return / webhook race) — don't re-charge.
  if (order.paymentStatus && order.paymentStatus.startsWith("Paid")) {
    return back("success");
  }

  try {
    const statusData = await getHdfcOrderStatus(orderNo, order.customer.customerId);
    const paid =
      statusData.status === "CHARGED" &&
      Math.abs(Number(statusData.amount) - Number(order.total)) < 0.01;
    if (paid) {
      const updated = updateOrderPayment(orderNo, {
        paymentStatus: "Paid",
        status: "Confirmed",
        paymentId: statusData.txn_id || statusData.txn_uuid || orderNo,
      });
      // Only now, once the money is actually taken, does stock come down. The
      // early return above for already-Paid orders keeps a duplicate return
      // from decrementing twice.
      decrementStock(updated.items);
      await sendOrderEmail(updated);
      return back("success");
    }
    updateOrderPayment(orderNo, {
      paymentStatus: `Not paid (${statusData.status || "unknown"})`,
      status: "Payment Failed",
    });
    return back("failed");
  } catch (err) {
    console.error(`[hdfc] status check failed for ${orderNo}:`, err.message);
    return back("failed");
  }
});

// Public: fetch a single order by its order number (used by the storefront to
// show the confirmation screen after returning from the gateway).
app.get("/api/orders/:orderNo", (req, res) => {
  const order = getOrderByOrderNo(req.params.orderNo);
  if (!order) return res.status(404).json({ error: "Order not found" });
  // Return only what the confirmation screen needs.
  res.json({
    orderNo: order.orderNo,
    customer: { name: order.customer.name, email: order.customer.email },
    items: order.items,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    paymentStatus: order.paymentStatus,
    status: order.status,
    createdAt: order.createdAt,
  });
});

// ----- Orders (demo checkout) ---------------------------------------------
// Used only when the real gateway is NOT configured, to simulate a paid order.
// When HDFC keys are present, real payments must go through the session +
// return flow above, so this endpoint refuses to record an order directly.
app.post("/api/orders", async (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) return res.status(400).json({ error: "Your cart is empty" });

  const { customer, error } = readCustomer(req.body);
  if (error) return res.status(400).json({ error });

  if (hdfcConfigured()) {
    return res.status(400).json({
      error: "Please complete payment through the secure gateway.",
    });
  }

  // Prices and availability come from the catalog, never from the browser.
  const { items, error: cartError } = resolveCartItems(rawItems);
  if (cartError) return res.status(409).json({ error: cartError });

  const order = buildOrder(items, customer, {
    orderNo: "PE" + Date.now().toString().slice(-8),
    paymentStatus: "Paid (demo)",
    paymentId: null,
    status: "Confirmed",
  });
  insertOrder(order);
  decrementStock(order.items);

  const emailResult = await sendOrderEmail(order);
  res.status(201).json({ ...order, emailSent: emailResult.sent });
});

// Admin: view all orders (from the SQLite database)
app.get("/api/admin/orders", requireAuth, (_req, res) => {
  res.json(listOrders());
});

app.get("/api/products", (_req, res) => {
  const products = readProducts() || [];
  res.json(products.sort((a, b) => b.createdAt - a.createdAt));
});

app.get("/api/products/:id", (req, res) => {
  const products = readProducts() || [];
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Not found" });
  res.json(product);
});

app.post("/api/upload", requireAuth, upload.array("images", 6), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/${f.filename}`);
  res.json({ urls });
});

function normalizeProduct(body) {
  return {
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    price: Number(body.price) || 0,
    originalPrice: body.originalPrice ? Number(body.originalPrice) : null,
    category: String(body.category || "Uncategorized").trim(),
    fabric: String(body.fabric || "").trim(),
    color: String(body.color || "").trim(),
    images: Array.isArray(body.images) ? body.images.filter(Boolean) : [],
    featured: Boolean(body.featured),
    inStock: body.inStock === undefined ? true : Boolean(body.inStock),
    // How many are physically in hand. null means "don't track a count for
    // this one" — availability then rests on the inStock flag alone, which is
    // how every product created before this field existed behaves.
    stock: normalizeStock(body.stock),
  };
}

function normalizeStock(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

app.post("/api/products", requireAuth, (req, res) => {
  const data = normalizeProduct(req.body);
  if (!data.name || !data.price) {
    return res.status(400).json({ error: "Name and price are required" });
  }
  const products = readProducts() || [];
  const product = { id: crypto.randomUUID(), createdAt: Date.now(), ...data };
  products.push(product);
  writeProducts(products);
  res.status(201).json(product);
});

app.put("/api/products/:id", requireAuth, (req, res) => {
  const products = readProducts() || [];
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const data = normalizeProduct(req.body);
  products[idx] = { ...products[idx], ...data };
  writeProducts(products);
  res.json(products[idx]);
});

// Restock: add (or remove, with a negative delta) units without touching the
// rest of the product. Sending { stock: n } instead sets an absolute count.
app.post("/api/products/:id/stock", requireAuth, (req, res) => {
  const products = readProducts() || [];
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Not found" });

  if (req.body?.stock !== undefined) {
    product.stock = normalizeStock(req.body.stock);
  } else {
    const delta = Math.floor(Number(req.body?.delta));
    if (!Number.isFinite(delta)) {
      return res.status(400).json({ error: "Send a numeric delta or stock" });
    }
    // Adding to an untracked product starts tracking it from zero.
    product.stock = Math.max(0, (product.stock ?? 0) + delta);
  }

  // Restocking something that sold out puts it back on sale.
  if (product.stock === null) {
    // untracked again — leave inStock as the admin set it
  } else if (product.stock > 0) {
    product.inStock = true;
  } else {
    product.inStock = false;
  }

  writeProducts(products);
  res.json(product);
});

app.delete("/api/products/:id", requireAuth, (req, res) => {
  const products = readProducts() || [];
  const next = products.filter((p) => p.id !== req.params.id);
  writeProducts(next);
  res.json({ ok: true });
});

// Multer / generic error handler
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Saree server running on http://localhost:${PORT}`);
  console.log(`Admin password: "${ADMIN_PASSWORD}" (set ADMIN_PASSWORD to change)`);
});
