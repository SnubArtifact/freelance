import express from "express";
import cors from "cors";
import multer from "multer";
import nodemailer from "nodemailer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyStockChange, hasTrackedStock, normalizeProduct } from "./catalog.js";
import { openDatabase } from "./db/connect.js";
import { diagnoseHdfc } from "./hdfcDiagnose.js";
import {
  hdfcClient,
  interpretStatus,
  isGatewayUrl,
  newOrderNo,
  verifyReturnSignature,
} from "./hdfc.js";
import { openImageStore } from "./images.js";
import { razorpayClient } from "./razorpay.js";
import { razorpayPayments } from "./razorpayRoutes.js";
import {
  allowedOrigins,
  escapeHtml,
  loginLimiter,
  orderTokens,
  securityHeaders,
} from "./security.js";
import { isUniqueViolation, openShop } from "./shop.js";
import { checkStorage } from "./storage.js";

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
//   HDFC_RESPONSE_KEY   — the dashboard's Response Key; used to check the
//                         signature HDFC puts on the return redirect
// Public URLs, used to build the redirect return_url and to send the shopper
// back to the storefront afterwards:
//   PUBLIC_SERVER_URL   — this server's public https origin (return_url host)
//   CLIENT_URL          — the storefront origin to return the shopper to
// Trimmed because a space or newline pasted into a dashboard field is
// invisible there, but makes HDFC reject the key as invalid.
const HDFC_API_KEY = (process.env.HDFC_API_KEY || "").trim();
const HDFC_MERCHANT_ID = (process.env.HDFC_MERCHANT_ID || "").trim();
const HDFC_CLIENT_ID =
  (process.env.HDFC_CLIENT_ID || "").trim() || HDFC_MERCHANT_ID || "";
const HDFC_ENV = (process.env.HDFC_ENV || "production").trim().toLowerCase();
const HDFC_RESELLER_ID =
  (process.env.HDFC_RESELLER_ID || "").trim() || "hdfc_reseller";
const HDFC_RESPONSE_KEY = (process.env.HDFC_RESPONSE_KEY || "").trim();
const HDFC_BASE_URL =
  process.env.HDFC_BASE_URL ||
  (HDFC_ENV === "sandbox"
    ? "https://smartgateway.hdfcuat.bank.in"
    : "https://smartgateway.hdfc.bank.in");
// ---- Razorpay ---------------------------------------------------------------
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET come from the Razorpay dashboard (test
// keys start with rzp_test_). RAZORPAY_WEBHOOK_SECRET is the secret of the
// webhook added there, pointing at
// PUBLIC_SERVER_URL/api/payments/razorpay/webhook.
const RAZORPAY_KEY_ID = (process.env.RAZORPAY_KEY_ID || "").trim();
const RAZORPAY_KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || "").trim();
const RAZORPAY_WEBHOOK_SECRET = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();

// Test orders are marked as such everywhere so they are never shipped: HDFC's
// auditors place them with test cards, and Razorpay's test keys take no real
// money.
const TEST_ORDERS = HDFC_ENV === "sandbox" || RAZORPAY_KEY_ID.startsWith("rzp_test");

const PUBLIC_SERVER_URL = (
  process.env.PUBLIC_SERVER_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");
const CLIENT_URL = (
  process.env.CLIENT_URL || "http://localhost:5173"
).replace(/\/$/, "");

const hdfcConfigured = () => Boolean(HDFC_API_KEY && HDFC_MERCHANT_ID);
const gateway = hdfcClient({
  apiKey: HDFC_API_KEY,
  merchantId: HDFC_MERCHANT_ID,
  clientId: HDFC_CLIENT_ID,
  resellerId: HDFC_RESELLER_ID,
  baseUrl: HDFC_BASE_URL,
  shopName: SHOP_NAME,
});

const razorpay =
  RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET
    ? razorpayClient({
        keyId: RAZORPAY_KEY_ID,
        keySecret: RAZORPAY_KEY_SECRET,
        apiBase: process.env.RAZORPAY_API_BASE,
      })
    : null;

// Which gateway takes the money: Razorpay when its keys are set, otherwise HDFC
// SmartGateway, otherwise the demo screen. PAYMENT_PROVIDER overrides it.
const PROVIDER =
  (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase() ||
  (razorpay ? "razorpay" : hdfcConfigured() ? "hdfc" : "demo");
const paymentsLive = () =>
  PROVIDER === "razorpay" ? Boolean(razorpay) : PROVIDER === "hdfc" ? hdfcConfigured() : false;

// Most recent session failure, shown in the admin panel's payment check.
let lastHdfcError = null;

// ----- Signing keys ----------------------------------------------------------
// Admin sessions are signed tokens, not a list held in memory, so they survive
// restarts. The key is derived from the admin password unless
// ADMIN_TOKEN_SECRET is set, so changing the password signs everyone out.
const TOKEN_SECRET =
  process.env.ADMIN_TOKEN_SECRET ||
  crypto.createHash("sha256").update(`admin-token:${ADMIN_PASSWORD}`).digest("hex");
// Receipt links and return references (see security.js).
const tokens = orderTokens(
  process.env.ORDER_TOKEN_SECRET ||
    crypto.createHash("sha256").update(`order-token:${TOKEN_SECRET}`).digest("hex")
);

// ----- Where sarees, orders and photos are kept -----------------------------
//   DATABASE_URL          — Postgres for sarees, stock, orders and the payment
//                           log. In production: Supabase's "Session pooler"
//                           connection string. Without it, an embedded
//                           Postgres saves everything in DATA_DIR/pgdata.
//   SUPABASE_URL,
//   SUPABASE_SERVICE_KEY  — photos go to Supabase Storage. Without them they
//                           are files in UPLOAD_DIR, served at /uploads.
// Render's free plan erases its disk on every restart, deploy and wake-up from
// sleep, so all three must be set there.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// A database that can't be reached stops the server rather than quietly
// falling back to the disk, where everything would be lost on the next restart.
let shop;
try {
  const db = await openDatabase({
    url: (process.env.DATABASE_URL || "").trim(),
    dataDir: path.join(DATA_DIR, "pgdata"),
  });
  shop = await openShop(db, { legacyDir: DATA_DIR });
} catch (err) {
  console.error(`[db] Could not open the database: ${err.message}`);
  process.exit(1);
}
const images = openImageStore({
  uploadDir: UPLOAD_DIR,
  supabaseUrl: (process.env.SUPABASE_URL || "").trim(),
  supabaseKey: (process.env.SUPABASE_SERVICE_KEY || "").trim(),
});
images.ping().catch((err) => console.error(`[photos] ${err.message}`));

// What survives a restart, for the admin panel's warning banner. Anything kept
// on this server's own disk only survives if the disk does.
const diskKept = checkStorage(DATA_DIR, __dirname).persistent;
const STORAGE = {
  dataKept: shop.kind === "postgres" || diskKept,
  photosKept: images.kind === "supabase" || diskKept,
  database: shop.kind,
  photos: images.kind,
};
STORAGE.persistent = STORAGE.dataKept && STORAGE.photosKept;
console.log(`[storage] sarees and orders: ${shop.kind} database; photos: ${images.kind}`);
console.log(
  `[payments] gateway: ${PROVIDER}${TEST_ORDERS ? " (test mode — orders are marked TEST)" : ""}`
);
if (!STORAGE.persistent) {
  const lost = [
    !STORAGE.dataKept && "sarees, stock and orders (set DATABASE_URL)",
    !STORAGE.photosKept && "photos (set SUPABASE_URL and SUPABASE_SERVICE_KEY)",
  ].filter(Boolean);
  console.warn(`[storage] Not kept across restarts: ${lost.join("; ")}.`);
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

// Everything the shopper typed is escaped: it goes into HTML.
function orderEmailHtml(order) {
  const e = escapeHtml;
  const rows = order.items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;color:#2a2024">${e(i.name)} &times; ${e(i.qty)}</td>
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
      ${order.isTest ? '<p style="color:#b3401f;font-weight:bold">TEST ORDER — will not be shipped.</p>' : ""}
      <p>Hi ${e(c.name) || "there"},</p>
      <p>Your order <strong>#${e(order.orderNo)}</strong> is confirmed. Here's a summary:</p>
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
        ${e(c.name)}<br/>${e(c.address)}<br/>${e(c.city)} — ${e(c.pincode)}<br/>${e(c.phone)}
      </p>
      <p style="margin:20px 0 0;color:#8a7d82;font-size:13px">
        Payment: ${e(order.paymentStatus)}${order.paymentId ? ` · Transaction ${e(order.paymentId)}` : ""}
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
    subject: `${order.isTest ? "[TEST] " : ""}Your Pankaj Enterprises order #${order.orderNo} is confirmed`,
    html: orderEmailHtml(order),
  };
  const tx = getTransporter();
  if (!tx) {
    console.log(`[email demo] Confirmation for order #${order.orderNo} — set SMTP_* to send for real.`);
    return { sent: false, reason: "demo" };
  }
  try {
    await tx.sendMail(mail);
    console.log(`[email] Sent confirmation for order #${order.orderNo}`);
    return { sent: true };
  } catch (err) {
    console.error(`[email] Failed for order #${order.orderNo}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// ----- App ----------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
// Render sits in front of this server; trust its forwarded address and
// protocol so rate limiting sees real visitors and HTTPS is recognised.
app.set("trust proxy", 1);
app.use(securityHeaders);
const origins = allowedOrigins(CLIENT_URL, process.env.ALLOWED_ORIGINS);
app.use(cors({ origin: (origin, done) => done(null, !origin || origins.has(origin)) }));
// The raw body is kept so Razorpay's webhook signature can be checked against
// exactly the bytes that arrived.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static(UPLOAD_DIR));

// Express 4 doesn't catch errors thrown by async handlers; this hands them to
// the error handler at the bottom instead of leaving the request hanging.
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// ----- Admin sessions --------------------------------------------------------
// A token is base64url({ exp }) + "." + an HMAC of that, so the server can
// check it without remembering anything.
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

const logins = loginLimiter();

// ----- Image upload -------------------------------------------------------
// Held in memory only until the image store has saved it.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error("Only image files are allowed"), { status: 400 }));
  },
});

// Deletes uploaded photos that no saree uses any more, so they don't take up
// the free plan's storage. Runs after the response; a failure only leaves a
// stray file behind.
function forgetImages(urls) {
  if (!urls.length) return;
  (async () => {
    const inUse = new Set((await shop.listProducts()).flatMap((p) => p.images || []));
    for (const url of urls) {
      if (inUse.has(url)) continue;
      try {
        await images.remove(url);
      } catch (err) {
        console.error(`[photos] Could not delete ${url}: ${err.message}`);
      }
    }
  })().catch((err) => console.error(`[photos] Cleanup failed: ${err.message}`));
}

// ----- Routes -------------------------------------------------------------
// ?deep=1 also touches the database and photo storage. A daily call keeps a
// free Supabase project from pausing after a quiet week (see the README).
app.get("/api/health", wrap(async (req, res) => {
  if (!req.query.deep) return res.json({ ok: true });
  const check = (p) => p.then(() => "ok", (err) => `error: ${err.message}`);
  const [database, photos] = await Promise.all([check(shop.ping()), check(images.ping())]);
  const ok = database === "ok" && photos === "ok";
  res.status(ok ? 200 : 503).json({ ok, database, photos });
}));

app.post("/api/login", (req, res) => {
  const ip = req.ip;
  if (logins.blocked(ip)) {
    return res
      .status(429)
      .json({ error: "Too many sign-in attempts. Please wait 15 minutes and try again." });
  }
  const { password } = req.body || {};
  if (typeof password === "string" && crypto.timingSafeEqual(
    crypto.createHash("sha256").update(password).digest(),
    crypto.createHash("sha256").update(ADMIN_PASSWORD).digest()
  )) {
    logins.succeed(ip);
    return res.json({ token: issueToken() });
  }
  logins.fail(ip);
  return res.status(401).json({ error: "Incorrect password" });
});

// Lets the admin panel confirm on load that its saved session is still
// accepted, so an expired one is caught before the admin types anything. It
// also reports whether data is on permanent storage, for the warning banner.
app.get("/api/admin/session", requireAuth, (_req, res) => {
  res.json({ ok: true, storage: STORAGE });
});

// ----- Payments (HDFC SmartGateway) ---------------------------------------
app.get("/api/payments/config", (_req, res) => {
  res.json({ configured: paymentsLive(), provider: PROVIDER });
});

// Admin-only: explains in plain words why the gateway is refusing payments,
// without exposing the API key. Makes no payment and creates no order.
app.get("/api/admin/payments/diagnose", requireAuth, wrap(async (_req, res) => {
  if (PROVIDER === "razorpay" && razorpayRoutes) {
    return res.json({
      ...(await razorpayRoutes.diagnose()),
      publicServerUrl: PUBLIC_SERVER_URL,
      clientUrl: CLIENT_URL,
      testOrders: TEST_ORDERS,
      lastError: lastHdfcError,
    });
  }
  const report = await diagnoseHdfc({
    apiKey: HDFC_API_KEY,
    merchantId: HDFC_MERCHANT_ID,
    clientId: HDFC_CLIENT_ID,
    resellerId: HDFC_RESELLER_ID,
    env: HDFC_ENV,
  });
  // HDFC sends the shopper back to PUBLIC_SERVER_URL, and requires https.
  const returnUrlOk =
    /^https:\/\//.test(PUBLIC_SERVER_URL) &&
    !/localhost|127\.0\.0\.1/.test(PUBLIC_SERVER_URL);
  if (report.configured && !returnUrlOk) {
    report.steps.push(
      `PUBLIC_SERVER_URL is "${PUBLIC_SERVER_URL}". HDFC needs this server's public https address to send shoppers back to — set it and redeploy.`
    );
  }
  if (report.configured && !HDFC_RESPONSE_KEY) {
    report.steps.push(
      "Set HDFC_RESPONSE_KEY (the Response Key from the SmartGateway dashboard) so the signature on every payment return is checked."
    );
  }
  res.json({
    ...report,
    ok: report.ok && returnUrlOk,
    baseUrl: HDFC_BASE_URL,
    publicServerUrl: PUBLIC_SERVER_URL,
    returnUrlOk,
    responseKeySet: Boolean(HDFC_RESPONSE_KEY),
    testOrders: TEST_ORDERS,
    clientUrl: CLIENT_URL,
    lastError: lastHdfcError,
  });
}));

// Normalises + validates the checkout customer. Returns { customer } or
// { error } so callers can respond consistently.
function readCustomer(body) {
  const c = body?.customer || {};
  const customer = {
    name: String(c.name || "").trim().slice(0, 120),
    email: String(c.email || "").trim().slice(0, 200),
    phone: String(c.phone || "").trim().slice(0, 30),
    address: String(c.address || "").trim().slice(0, 500),
    city: String(c.city || "").trim().slice(0, 100),
    pincode: String(c.pincode || "").trim().slice(0, 12),
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
 * Rebuilds the cart from the database. The browser only gets to say WHICH
 * product and HOW MANY — the price, name and image always come from the
 * catalog, never from the request, so a shopper can't change what they pay.
 *
 * Also enforces availability. Returns { items } or { error }.
 */
async function resolveCartItems(rawItems) {
  const found = await shop.getProducts(rawItems.map((raw) => String(raw?.id ?? "")));
  const catalog = new Map(found.map((p) => [p.id, p]));
  const resolved = [];

  for (const raw of rawItems) {
    const product = catalog.get(String(raw?.id ?? ""));
    if (!product) {
      return { error: `"${String(raw?.name || "An item").slice(0, 80)}" is no longer available.` };
    }

    const qty = Math.min(100, Math.max(1, Math.floor(Number(raw.qty) || 1)));

    if (product.inStock === false) {
      return { error: `${product.name} is sold out.` };
    }
    // An untracked stock count means availability rests on inStock alone.
    if (hasTrackedStock(product)) {
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
    payment: PROVIDER,
    createdAt: Date.now(),
    isTest: TEST_ORDERS,
    ...extra,
  };
}

// What the shopper's receipt page may see — no address, phone or internals.
function publicReceipt(order) {
  const outcome = order.paymentStatus.startsWith("Paid")
    ? "paid"
    : /^(Pending|Needs review)/.test(order.paymentStatus)
      ? "pending"
      : "failed";
  return {
    orderNo: order.orderNo,
    outcome,
    customer: { name: order.customer.name, email: order.customer.email },
    items: order.items,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    paymentStatus: order.paymentStatus,
    status: order.status,
    paymentId: order.paymentId,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    isTest: order.isTest,
  };
}

/**
 * Applies HDFC's Order Status answer to an order: paid only if HDFC says
 * CHARGED for this exact order and amount. Safe to run any number of times:
 * an order is completed once, and a paid order is never downgraded.
 */
async function applyGatewayStatus(order, statusData, { source, reportedStatus } = {}) {
  const verdict = interpretStatus(statusData, order);
  await shop.logEvent(order.orderNo, "status_checked", {
    source,
    status: verdict.status,
    amount: statusData?.amount ?? null,
    txn_id: statusData?.txn_id ?? null,
    outcome: verdict.outcome,
  });
  if (reportedStatus && String(reportedStatus).toUpperCase() !== verdict.status) {
    await shop.logEvent(order.orderNo, "tamper_suspected", {
      reason: "the status in the return redirect differs from HDFC's own answer",
      reported: String(reportedStatus),
      actual: verdict.status,
    });
  }

  if (verdict.outcome === "paid") {
    const completed = await shop.completePayment(order.orderNo, {
      paymentId: statusData.txn_id || statusData.txn_uuid || order.orderNo,
      gatewayStatus: verdict.status,
      gatewayResponse: statusData,
    });
    if (completed) {
      await shop.logEvent(order.orderNo, "marked_paid", { source });
      await sendOrderEmail(completed);
      return { outcome: "paid", order: completed };
    }
    // Another confirmation got there first; nothing more to do.
    return { outcome: "paid", order: await shop.getOrderByOrderNo(order.orderNo) };
  }

  if (verdict.outcome === "review") {
    await shop.logEvent(order.orderNo, "tamper_suspected", { reason: verdict.reason });
  }
  const unpaid =
    verdict.outcome === "failed"
      ? { paymentStatus: `Not paid (${verdict.status})`, status: "Payment Failed" }
      : verdict.outcome === "review"
        ? { paymentStatus: `Needs review (${verdict.reason})`, status: "Payment Review" }
        : { paymentStatus: `Pending (${verdict.status})`, status: "Payment Pending" };
  const updated = await shop.recordUnpaid(order.orderNo, {
    ...unpaid,
    gatewayStatus: verdict.status,
    gatewayResponse: statusData,
  });
  return {
    outcome: verdict.outcome === "failed" ? "failed" : "pending",
    order: updated || (await shop.getOrderByOrderNo(order.orderNo)),
  };
}

// The dual inquiry: whatever the browser brings back, ask HDFC directly.
async function confirmWithGateway(order, options) {
  if (order.paymentStatus.startsWith("Paid")) return { outcome: "paid", order };
  const statusData = await gateway.getOrderStatus(order.orderNo, order.customer.customerId);
  return applyGatewayStatus(order, statusData, options);
}

// Asks whichever gateway took this order what actually happened to it.
async function confirmOrder(order, options) {
  if (order.paymentStatus.startsWith("Paid")) return { outcome: "paid", order };
  if (order.payment === "razorpay" && razorpayRoutes) {
    return razorpayRoutes.confirmOrder(order, options);
  }
  if (order.payment === "hdfc" && hdfcConfigured() && order.customer?.customerId) {
    return confirmWithGateway(order, options);
  }
  return { outcome: "pending", order };
}

/**
 * The first half of checkout, shared by both gateways: check the customer's
 * details, rebuild the cart from the database, reuse an earlier submission of
 * the same checkout, and record a pending order with a unique number.
 *
 * Returns the order, or null when it has already answered the request.
 * `resume(earlier)` lets the caller hand back the payment details of an order
 * that is already waiting to be paid.
 */
async function prepareOrder(req, res, { resume } = {}) {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
  if (!rawItems.length) {
    res.status(400).json({ error: "Your cart is empty" });
    return null;
  }
  const { customer, error } = readCustomer(req.body);
  if (error) {
    res.status(400).json({ error });
    return null;
  }

  // Prices and availability come from the catalog, never from the browser.
  const { items, error: cartError } = await resolveCartItems(rawItems);
  if (cartError) {
    res.status(409).json({ error: cartError });
    return null;
  }

  if (!paymentsLive()) {
    // No keys → tell the client to fall back to the demo flow.
    res.json({ configured: false });
    return null;
  }

  const reuse = (earlier) => {
    const again = earlier && resume?.(earlier);
    if (again) res.json(again);
    else {
      res.status(409).json({
        error: "This checkout was already submitted. Please refresh the page and try again.",
      });
    }
    return null;
  };

  // One id per checkout submission, from the browser, so a repeated request
  // can't create a second order.
  const attemptId = /^[A-Za-z0-9-]{8,64}$/.test(String(req.body?.attemptId || ""))
    ? String(req.body.attemptId)
    : null;
  if (attemptId) {
    const earlier = await shop.findOrderByAttempt(attemptId);
    if (earlier) return reuse(earlier);
  }

  // HDFC's x-customerid is reused on its status check, so it is stored with
  // the order either way.
  const customerWithId = {
    ...customer,
    customerId: "CUST" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
  };
  for (let attempt = 1; ; attempt++) {
    const order = buildOrder(items, customerWithId, {
      orderNo: newOrderNo(),
      attemptId,
      paymentStatus: "Pending",
      status: "Payment Pending",
      paymentId: null,
    });
    try {
      await shop.insertOrder(order);
      await shop.logEvent(order.orderNo, "order_created", {
        total: order.total,
        items: items.length,
      });
      return order;
    } catch (err) {
      if (attemptId && isUniqueViolation(err, "attempt_id")) {
        return reuse(await shop.findOrderByAttempt(attemptId));
      }
      if (isUniqueViolation(err, "order_no") && attempt < 3) continue;
      throw err;
    }
  }
}

// Create a SmartGateway payment session for the current cart: the amount comes
// from the database, and the shopper is sent the hosted payment-page link.
app.post("/api/payments/hdfc/session", wrap(async (req, res) => {
  const order = await prepareOrder(req, res, {
    resume: (earlier) =>
      earlier.paymentLink && earlier.paymentStatus.startsWith("Pending")
        ? {
            configured: true,
            provider: "hdfc",
            paymentLink: earlier.paymentLink,
            orderNo: earlier.orderNo,
            token: tokens.receipt(earlier.orderNo),
          }
        : null,
  });
  if (!order) return;
  const { orderNo } = order;

  // The return URL carries a code tied to this order (see security.js).
  const returnUrl = `${PUBLIC_SERVER_URL}/api/payments/hdfc/return/${tokens.returnRef(orderNo)}`;
  try {
    const { paymentLink, response } = await gateway.createSession({
      orderNo,
      amount: order.total,
      customer: order.customer,
      returnUrl,
    });
    if (!isGatewayUrl(paymentLink)) {
      throw new Error(`SmartGateway returned a payment page outside its own site: ${paymentLink}`);
    }
    await shop.setPaymentLink(orderNo, paymentLink);
    await shop.logEvent(orderNo, "session_created", {
      session_id: response?.id ?? null,
      amount: order.total,
      payment_page_host: new URL(paymentLink).hostname,
    });
    res.json({
      configured: true,
      provider: "hdfc",
      paymentLink,
      orderNo,
      token: tokens.receipt(orderNo),
    });
  } catch (err) {
    // Log the gateway's own message for us, but never show it to the shopper —
    // it can contain merchant ids and key diagnostics. The admin panel's
    // payment check shows the most recent one.
    console.error(`[hdfc] session failed for ${orderNo}:`, err.message);
    lastHdfcError = { at: Date.now(), orderNo, message: err.message };
    await shop.logEvent(orderNo, "session_failed", { message: err.message.slice(0, 500) });
    await shop.recordUnpaid(orderNo, { paymentStatus: "Failed", status: "Payment Failed" });
    res.status(502).json({
      error: "We couldn't reach the payment gateway. Please try again in a moment.",
    });
  }
}));

// How a return's signature is recorded in the payment log. HDFC only sends one
// when "Use signed response" is switched on in the dashboard.
function signatureNote(signature) {
  if (!signature.checked) return "not checked (HDFC_RESPONSE_KEY not set)";
  if (signature.valid) return `valid (${signature.variant})`;
  if (signature.reason === "no signature") {
    return 'not sent by HDFC (switch on "Use signed response" in the dashboard)';
  }
  return `INVALID (${signature.reason})`;
}

// Return URL — the shopper lands here after HDFC's hosted payment page. The
// redirect itself is never trusted: its signature and return code are checked
// and logged, and the outcome comes from the server-to-server Order Status
// call. Then the browser goes back to the storefront's receipt page.
app.all(
  ["/api/payments/hdfc/return", "/api/payments/hdfc/return/:ref"],
  async (req, res) => {
    const params = {};
    for (const [k, v] of Object.entries({ ...req.query, ...(req.body || {}) })) {
      if (typeof v === "string") params[k] = v;
    }
    const orderNo = String(params.order_id || params.orderId || "").trim();
    const ref = req.params.ref;
    // A receipt link is only handed out on a return whose code matches the
    // order, so this URL can't be used to read other people's orders.
    const back = (status, withReceipt) =>
      res.redirect(
        303,
        `${CLIENT_URL}/checkout?${new URLSearchParams({
          status,
          ...(orderNo ? { order: orderNo } : {}),
          ...(withReceipt ? { t: tokens.receipt(orderNo) } : {}),
        })}`
      );

    if (!/^[A-Za-z0-9_-]{1,40}$/.test(orderNo)) return back("failed", false);
    const refMatches = ref ? tokens.check("return", orderNo, ref) : null;
    try {
      const order = await shop.getOrderByOrderNo(orderNo);
      if (!order) {
        console.warn(`[hdfc] return for unknown order ${orderNo}`);
        return back("failed", false);
      }
      const signature = verifyReturnSignature(params, HDFC_RESPONSE_KEY);
      const { signature: _sig, ...shownParams } = params;
      await shop.logEvent(orderNo, "shopper_returned", {
        method: req.method,
        params: shownParams,
        signature: signatureNote(signature),
        return_code: ref === undefined ? "absent" : refMatches ? "matches order" : "DOES NOT MATCH",
      });

      if (ref !== undefined && !refMatches) {
        await shop.logEvent(orderNo, "tamper_suspected", {
          reason: "the return URL's code belongs to a different order",
        });
        return back("failed", false);
      }
      // A missing signature means signed responses are switched off in the
      // HDFC dashboard — a setting to fix, not an attack. A wrong one is not.
      if (signature.checked && !signature.valid && signature.reason !== "no signature") {
        await shop.logEvent(orderNo, "tamper_suspected", {
          reason: `return signature ${signature.reason}; relying on HDFC's Order Status answer`,
        });
      }

      const result = await confirmWithGateway(order, {
        source: "shopper return",
        reportedStatus: params.status,
      });
      return back(result.outcome === "paid" ? "success" : result.outcome, Boolean(refMatches));
    } catch (err) {
      console.error(`[hdfc] return handling failed for ${orderNo}:`, err.message);
      // We don't know yet: show "confirming", which re-checks with HDFC.
      return back("pending", Boolean(refMatches));
    }
  }
);

// Re-checks a pending order with HDFC at most this often per order, so the
// receipt page updates in real time without hammering the gateway.
const lastLiveCheck = new Map();
const RECHECK_MS = Number(process.env.RECEIPT_RECHECK_MS ?? 5000);

// The shopper's receipt. Needs the receipt code from the checkout flow; order
// numbers alone reveal nothing.
app.get("/api/orders/:orderNo", wrap(async (req, res) => {
  const { orderNo } = req.params;
  if (!tokens.check("receipt", orderNo, req.query.t)) {
    return res.status(404).json({ error: "Order not found" });
  }
  let order = await shop.getOrderByOrderNo(orderNo);
  if (!order) return res.status(404).json({ error: "Order not found" });

  if (
    /^Pending/.test(order.paymentStatus) &&
    Date.now() - (lastLiveCheck.get(orderNo) || 0) > RECHECK_MS
  ) {
    lastLiveCheck.set(orderNo, Date.now());
    try {
      order = (await confirmOrder(order, { source: "receipt page" })).order;
    } catch (err) {
      console.error(`[payments] live check failed for ${orderNo}:`, err.message);
    }
  }
  res.json(publicReceipt(order));
}));

// ----- Razorpay ---------------------------------------------------------------
// Its routes live in razorpayRoutes.js, and are only added when keys are set.
const razorpayRoutes = razorpay
  ? razorpayPayments({
      shop,
      tokens,
      client: razorpay,
      keyId: RAZORPAY_KEY_ID,
      keySecret: RAZORPAY_KEY_SECRET,
      webhookSecret: RAZORPAY_WEBHOOK_SECRET,
      shopName: SHOP_NAME,
      sendOrderEmail,
      prepareOrder,
      publicReceipt,
      wrap,
    })
  : null;
razorpayRoutes?.register(app);

// ----- Orders (demo checkout) ---------------------------------------------
// Used only when the real gateway is NOT configured, to simulate a paid order.
// When HDFC keys are present, real payments must go through the session +
// return flow above, so this endpoint refuses to record an order directly.
app.post("/api/orders", wrap(async (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
  if (!rawItems.length) return res.status(400).json({ error: "Your cart is empty" });

  const { customer, error } = readCustomer(req.body);
  if (error) return res.status(400).json({ error });

  if (paymentsLive()) {
    return res.status(400).json({
      error: "Please complete payment through the secure gateway.",
    });
  }

  // Prices and availability come from the catalog, never from the browser.
  const { items, error: cartError } = await resolveCartItems(rawItems);
  if (cartError) return res.status(409).json({ error: cartError });

  const now = Date.now();
  const order = buildOrder(items, customer, {
    orderNo: newOrderNo(),
    paymentStatus: "Paid (demo)",
    paymentId: null,
    status: "Confirmed",
    isTest: true,
    createdAt: now,
    paidAt: now,
  });
  await shop.insertPaidOrder(order);

  const emailResult = await sendOrderEmail(order);
  res.status(201).json({
    ...publicReceipt(order),
    token: tokens.receipt(order.orderNo),
    emailSent: emailResult.sent,
  });
}));

// ----- Admin: orders and the payment log -------------------------------------
app.get("/api/admin/orders", requireAuth, wrap(async (_req, res) => {
  res.json(await shop.listOrders());
}));

app.get("/api/admin/orders/:orderNo/events", requireAuth, wrap(async (req, res) => {
  res.json(await shop.listEvents(req.params.orderNo));
}));

// Asks HDFC for this order's status right now, applies the answer, and shows
// HDFC's full reply (what the bank's audit asks to see).
app.post("/api/admin/orders/:orderNo/check", requireAuth, wrap(async (req, res) => {
  const order = await shop.getOrderByOrderNo(req.params.orderNo);
  if (!order) return res.status(404).json({ error: "Order not found" });
  try {
    if (order.payment === "razorpay" && razorpayRoutes && order.gatewayRef) {
      const response = await razorpay.paymentsForOrder(order.gatewayRef);
      const result = await razorpayRoutes.confirmOrder(order, { source: "admin check" });
      return res.json({ order: result.order, response });
    }
    if (order.payment === "hdfc" && hdfcConfigured() && order.customer?.customerId) {
      const statusData = await gateway.getOrderStatus(order.orderNo, order.customer.customerId);
      const result = await applyGatewayStatus(order, statusData, { source: "admin check" });
      return res.json({ order: result.order, response: statusData });
    }
    return res.status(400).json({ error: "This order didn't go through a payment gateway." });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}));

// ----- Catalog ---------------------------------------------------------------
app.get("/api/products", wrap(async (_req, res) => {
  res.json(await shop.listProducts());
}));

app.get("/api/products/:id", wrap(async (req, res) => {
  const product = await shop.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: "Not found" });
  res.json(product);
}));

app.post("/api/upload", requireAuth, upload.array("images", 6), wrap(async (req, res) => {
  try {
    const urls = await Promise.all((req.files || []).map((file) => images.save(file)));
    res.json({ urls });
  } catch (err) {
    console.error(`[photos] Upload failed: ${err.message}`);
    res.status(502).json({ error: "The photo could not be saved. Please try again." });
  }
}));

app.post("/api/products", requireAuth, wrap(async (req, res) => {
  const data = normalizeProduct(req.body);
  if (!data.name || !data.price) {
    return res.status(400).json({ error: "Name and price are required" });
  }
  const product = { id: crypto.randomUUID(), createdAt: Date.now(), ...data };
  await shop.createProduct(product);
  res.status(201).json(product);
}));

app.put("/api/products/:id", requireAuth, wrap(async (req, res) => {
  const existing = await shop.getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updated = await shop.replaceProduct({ ...existing, ...normalizeProduct(req.body) });
  forgetImages((existing.images || []).filter((url) => !updated.images.includes(url)));
  res.json(updated);
}));

// Restock: add (or remove, with a negative delta) units without touching the
// rest of the product. Sending { stock: n } instead sets an absolute count.
app.post("/api/products/:id/stock", requireAuth, wrap(async (req, res) => {
  const product = await shop.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: "Not found" });

  let change;
  if (req.body?.stock !== undefined) {
    change = { stock: req.body.stock };
  } else {
    const delta = Math.floor(Number(req.body?.delta));
    if (!Number.isFinite(delta)) {
      return res.status(400).json({ error: "Send a numeric delta or stock" });
    }
    change = { delta };
  }

  res.json(await shop.replaceProduct(applyStockChange(product, change)));
}));

app.delete("/api/products/:id", requireAuth, wrap(async (req, res) => {
  const removed = await shop.deleteProduct(req.params.id);
  if (removed) forgetImages(removed.images || []);
  res.json({ ok: true });
}));

// Upload and request problems are the sender's to fix (400). Anything else is
// ours (500); its details stay in the server log.
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err.status === 400 || err.type === "entity.parse.failed") {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

app.listen(PORT, () => {
  console.log(`Saree server running on http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[security] ADMIN_PASSWORD is not set; the default "saree-admin" is in use.');
  }
});
