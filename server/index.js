import express from "express";
import cors from "cors";
import multer from "multer";
import nodemailer from "nodemailer";
import { insertOrder, listOrders, migrateFromJson } from "./db.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PaytmChecksum from "paytmchecksum";

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
const SHOP_NAME = "Haveli Wale";
const emailConfigured = () => Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

// Paytm payment keys. Get test credentials from https://business.paytm.com
// Leave unset to run checkout in demo mode (no real charge).
const PAYTM_MID = process.env.PAYTM_MID || "";
const PAYTM_MERCHANT_KEY = process.env.PAYTM_MERCHANT_KEY || "";
const PAYTM_WEBSITE = process.env.PAYTM_WEBSITE || "WEBSTAGING";
const PAYTM_CHANNEL_ID = process.env.PAYTM_CHANNEL_ID || "WEB";
const PAYTM_INDUSTRY_TYPE = process.env.PAYTM_INDUSTRY_TYPE || "Retail";
const paytmConfigured = () => Boolean(PAYTM_MID && PAYTM_MERCHANT_KEY);

// Returns true for staging/test MIDs so we hit the right Paytm endpoint.
const isPaytmStaging = () =>
  !PAYTM_MID ||
  PAYTM_MID.toLowerCase().includes("staging") ||
  PAYTM_MID.toLowerCase().includes("test");

const PAYTM_API_BASE = () =>
  isPaytmStaging()
    ? "https://securegw-stage.paytm.in"
    : "https://securegw.paytm.in";

/**
 * Calls Paytm's initiateTransaction API and returns a txnToken.
 * amountPaise is the amount in paise (₹1 = 100 paise).
 */
async function initiatePaytmTransaction(orderId, amountPaise, customer) {
  const amountINR = (amountPaise / 100).toFixed(2);
  const paytmParams = {
    body: {
      requestType: "Payment",
      mid: PAYTM_MID,
      websiteName: PAYTM_WEBSITE,
      orderId,
      callbackUrl: `${PAYTM_API_BASE()}/theia/paytmCallback?ORDER_ID=${orderId}`,
      txnAmount: { value: amountINR, currency: "INR" },
      userInfo: {
        custId: customer.email || customer.phone || orderId,
        email: customer.email || "",
        mobile: customer.phone || "",
        firstName: (customer.name || "").split(" ")[0],
        lastName: (customer.name || "").split(" ").slice(1).join(" "),
      },
    },
  };

  const checksum = await PaytmChecksum.generateSignature(
    JSON.stringify(paytmParams.body),
    PAYTM_MERCHANT_KEY
  );
  paytmParams.head = { signature: checksum };

  const url = `${PAYTM_API_BASE()}/theia/api/v1/initiateTransaction?mid=${PAYTM_MID}&orderId=${orderId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paytmParams),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Paytm initiate error: ${text}`);
  }
  const data = await res.json();
  if (data?.body?.resultInfo?.resultStatus !== "S") {
    throw new Error(
      `Paytm error: ${data?.body?.resultInfo?.resultMsg || "Transaction initiation failed"}`
    );
  }
  return data.body.txnToken;
}

/**
 * Verifies the Paytm checksum sent in the payment callback.
 */
async function verifyPaytmChecksum(body, checksumHash) {
  return PaytmChecksum.verifySignature(
    JSON.stringify(body),
    PAYTM_MERCHANT_KEY,
    checksumHash
  );
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
      <h1 style="margin:0;font-family:Georgia,serif">Haveli Wale</h1>
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
      <p style="margin:18px 0 0">With love,<br/>Team Haveli Wale</p>
    </div>
  </div>`;
}

async function sendOrderEmail(order) {
  const to = order.customer.email;
  if (!to) return { sent: false, reason: "no email" };
  const mail = {
    from: `${SHOP_NAME} <${SHOP_EMAIL}>`,
    to,
    subject: `Your Haveli Wale order #${order.orderNo} is confirmed`,
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
app.use("/uploads", express.static(UPLOAD_DIR));

// Very small token-based auth. For a single-owner shop this is enough; for a
// public deployment, move to real auth + HTTPS.
const tokens = new Set();

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "").trim();
  if (token && tokens.has(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
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
    const token = crypto.randomUUID();
    tokens.add(token);
    return res.json({ token });
  }
  return res.status(401).json({ error: "Incorrect password" });
});

// ----- Payments (Paytm) ---------------------------------------------------
app.get("/api/payments/config", (_req, res) => {
  res.json({ configured: paytmConfigured(), mid: PAYTM_MID });
});

// Initiate a Paytm transaction for the current cart. Amount is computed
// server-side so it can't be tampered with from the client.
app.post("/api/payments/paytm/initiate", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "Your cart is empty" });
  const subtotal = items.reduce(
    (s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0),
    0
  );
  const shippingFee = subtotal > 4999 ? 0 : 99;
  const amountPaise = Math.round((subtotal + shippingFee) * 100);
  if (!paytmConfigured()) {
    return res.json({ configured: false, amount: amountPaise });
  }
  const orderId = "HW" + Date.now().toString();
  const customer = req.body?.customer || {};
  try {
    const txnToken = await initiatePaytmTransaction(orderId, amountPaise, customer);
    res.json({
      configured: true,
      mid: PAYTM_MID,
      txnToken,
      orderId,
      amount: amountPaise,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ----- Orders (guest checkout) --------------------------------------------
app.post("/api/orders", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "Your cart is empty" });

  const c = req.body?.customer || {};
  const customer = {
    name: String(c.name || "").trim(),
    email: String(c.email || "").trim(),
    phone: String(c.phone || "").trim(),
    address: String(c.address || "").trim(),
    city: String(c.city || "").trim(),
    pincode: String(c.pincode || "").trim(),
  };
  if (!customer.name || !customer.email || !customer.phone || !customer.address) {
    return res.status(400).json({ error: "Please fill in your contact and address details" });
  }
  if (!/^\S+@\S+\.\S+$/.test(customer.email)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }

  const payment = "upi";

  // For online payments, verify the Paytm checksum before recording.
  let paymentStatus = "Paid";
  const pt = req.body?.paytm || null;
  if (payment === "upi" && paytmConfigured()) {
    if (!pt || !pt.CHECKSUMHASH) {
      return res.status(400).json({ error: "Payment verification failed: missing checksum" });
    }
    // Build the body to verify — exclude CHECKSUMHASH itself
    const { CHECKSUMHASH, ...verifyBody } = pt;
    const isValid = await verifyPaytmChecksum(verifyBody, CHECKSUMHASH);
    if (!isValid || pt.STATUS !== "TXN_SUCCESS") {
      return res.status(400).json({ error: "Payment verification failed" });
    }
  } else if (payment === "upi") {
    // Demo mode (no keys configured) — accept without a real charge.
    paymentStatus = "Paid (demo)";
  }

  const subtotal = items.reduce(
    (s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0),
    0
  );
  const shippingFee = subtotal > 4999 ? 0 : 99;
  const order = {
    id: crypto.randomUUID(),
    orderNo: "HW" + Date.now().toString().slice(-8),
    customer,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      price: Number(i.price) || 0,
      qty: Number(i.qty) || 1,
      image: i.image || "",
    })),
    subtotal,
    shippingFee,
    total: subtotal + shippingFee,
    payment,
    paymentStatus,
    paymentId: pt?.TXNID || null,
    status: "Confirmed",
    createdAt: Date.now(),
  };
  insertOrder(order);

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
  };
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
