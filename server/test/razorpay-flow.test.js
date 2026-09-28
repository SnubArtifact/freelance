import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// End to end with Razorpay: the real server, its real database, and a fake
// Razorpay API. Everything a browser could lie about is tried here.

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEY_ID = "rzp_test_fake";
const KEY_SECRET = "fake-key-secret";
const WEBHOOK_SECRET = "fake-webhook-secret";
const STOREFRONT = "https://www.shophaveliwale.com";

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// ---- Fake Razorpay ----------------------------------------------------------
const razorpay = { orders: new Map(), payments: new Map(), nextId: 1 };
let razorpayServer;

// Adds a payment to an order, the way Razorpay would once a shopper pays.
function addPayment(razorpayOrderId, fields = {}) {
  const payment = {
    id: `pay_${razorpay.nextId++}`,
    entity: "payment",
    amount: razorpay.orders.get(razorpayOrderId)?.amount ?? 0,
    currency: "INR",
    status: "captured",
    order_id: razorpayOrderId,
    method: "card",
    captured: true,
    ...fields,
  };
  razorpay.payments.set(payment.id, payment);
  return payment;
}

async function startRazorpay() {
  razorpayServer = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const url = req.url;

    if (req.method === "POST" && url === "/v1/orders") {
      const asked = JSON.parse(body);
      const order = { id: `order_${razorpay.nextId++}`, entity: "order", status: "created", ...asked };
      razorpay.orders.set(order.id, order);
      return reply(200, order);
    }
    const forOrder = url.match(/^\/v1\/orders\/([^/]+)\/payments$/);
    if (req.method === "GET" && forOrder) {
      const orderId = decodeURIComponent(forOrder[1]);
      if (!razorpay.orders.has(orderId)) {
        return reply(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
      }
      const items = [...razorpay.payments.values()].filter((p) => p.order_id === orderId);
      return reply(200, { entity: "collection", count: items.length, items });
    }
    const one = url.match(/^\/v1\/payments\/([^/]+)$/);
    if (req.method === "GET" && one) {
      const payment = razorpay.payments.get(decodeURIComponent(one[1]));
      return payment
        ? reply(200, payment)
        : reply(400, { error: { description: "The id provided does not exist" } });
    }
    const capture = url.match(/^\/v1\/payments\/([^/]+)\/capture$/);
    if (req.method === "POST" && capture) {
      const payment = razorpay.payments.get(decodeURIComponent(capture[1]));
      if (!payment) return reply(400, { error: { description: "The id provided does not exist" } });
      payment.status = "captured";
      payment.captured = true;
      return reply(200, payment);
    }
    reply(404, { error: { description: "unknown route" } });
  });
  await new Promise((resolve) => razorpayServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${razorpayServer.address().port}`;
}

// ---- The shop's server ------------------------------------------------------
let base;
let child;
let dataDir;
let output = "";

before(async () => {
  const apiBase = await startRazorpay();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-rzp-"));
  child = spawn(process.execPath, ["index.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DATABASE_URL: "",
      SUPABASE_URL: "",
      ADMIN_PASSWORD: "admin-pw",
      HDFC_API_KEY: "",
      HDFC_MERCHANT_ID: "",
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RAZORPAY_API_BASE: apiBase,
      PUBLIC_SERVER_URL: base,
      CLIENT_URL: STOREFRONT,
      RECEIPT_RECHECK_MS: "0",
      SMTP_HOST: "",
    },
  });
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  for (let i = 0; i < 400; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start:\n${output}`);
});

after(async () => {
  child?.kill();
  razorpayServer?.close();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---- Helpers ----------------------------------------------------------------
const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const post = (route, body, headers = {}) =>
  fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const customer = { name: "Test Buyer", email: "buyer@example.com", phone: "9876543210", address: "1 MG Road", city: "Indore", pincode: "452001" };

let adminToken;
const admin = async () => {
  adminToken ??= (await json(await post("/api/login", { password: "admin-pw" }))).body.token;
  return { Authorization: `Bearer ${adminToken}` };
};
const products = async () => (await json(await fetch(`${base}/api/products`))).body;
const events = async (orderNo) =>
  (await json(await fetch(`${base}/api/admin/orders/${orderNo}/events`, { headers: await admin() }))).body;
const sign = (orderId, paymentId, secret = KEY_SECRET) =>
  crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

// Starts a checkout and returns what the browser would receive.
async function startCheckout(items, extra = {}) {
  return json(await post("/api/payments/razorpay/order", { items, customer, ...extra }));
}

async function buyOne(fields = {}) {
  const [p] = await products();
  const { body: session } = await startCheckout([{ id: p.id, qty: 1 }]);
  const payment = addPayment(session.razorpayOrderId, fields);
  return { session, payment, product: p };
}

// ---- Tests -------------------------------------------------------------------
describe("Razorpay checkout", () => {
  test("the gateway in use is reported to the storefront", async () => {
    const { body } = await json(await fetch(`${base}/api/payments/config`));
    assert.deepEqual(body, { configured: true, provider: "razorpay" });
  });

  test("the amount charged comes from the database, not the browser", async () => {
    const [p] = await products();
    const { status, body } = await startCheckout([{ id: p.id, qty: 2, price: 1, name: "cheap" }]);
    assert.equal(status, 200);
    const expected = p.price * 2 + (p.price * 2 > 4999 ? 0 : 99);
    assert.equal(body.amount, expected * 100, "paise, from the catalog price");
    assert.equal(razorpay.orders.get(body.razorpayOrderId).amount, expected * 100);
    assert.equal(razorpay.orders.get(body.razorpayOrderId).receipt, body.orderNo);
    assert.equal(body.keyId, KEY_ID, "the public key id, never the secret");
    assert.ok(!JSON.stringify(body).includes(KEY_SECRET));
  });

  test("a genuine payment is confirmed with Razorpay and marked paid once", async () => {
    const { session, payment } = await buyOne();
    const verify = {
      orderNo: session.orderNo,
      token: session.token,
      razorpay_order_id: session.razorpayOrderId,
      razorpay_payment_id: payment.id,
      razorpay_signature: sign(session.razorpayOrderId, payment.id),
    };
    const first = await json(await post("/api/payments/razorpay/verify", verify));
    assert.equal(first.status, 200);
    assert.equal(first.body.outcome, "paid");
    assert.equal(first.body.paymentId, payment.id);
    assert.equal(first.body.isTest, true, "test keys mark the order as a test");

    // The same answer sent twice must not pay twice.
    const second = await json(await post("/api/payments/razorpay/verify", verify));
    assert.equal(second.body.outcome, "paid");
    const log = await events(session.orderNo);
    assert.equal(log.filter((e) => e.kind === "marked_paid").length, 1);
  });

  test("a forged signature is refused and the order stays unpaid", async () => {
    // Nothing has been paid at Razorpay; only the browser claims otherwise.
    const [p] = await products();
    const { body: session } = await startCheckout([{ id: p.id, qty: 1 }]);
    const { status, body } = await json(
      await post("/api/payments/razorpay/verify", {
        orderNo: session.orderNo,
        token: session.token,
        razorpay_order_id: session.razorpayOrderId,
        razorpay_payment_id: "pay_forged",
        razorpay_signature: sign(session.razorpayOrderId, "pay_forged", "wrong-secret"),
      })
    );
    assert.equal(status, 400);
    assert.match(body.error, /couldn't verify/i);

    const { body: rec } = await json(await fetch(`${base}/api/orders/${session.orderNo}?t=${session.token}`));
    assert.notEqual(rec.outcome, "paid");
    const log = await events(session.orderNo);
    assert.ok(log.some((e) => e.kind === "shopper_returned" && e.detail.signature === "INVALID"));
    assert.ok(log.some((e) => e.kind === "tamper_suspected"));
  });

  test("even a valid signature can't pay for a payment Razorpay says failed", async () => {
    const { session, payment } = await buyOne({ status: "failed", captured: false, error_description: "card declined" });
    const { body } = await json(
      await post("/api/payments/razorpay/verify", {
        orderNo: session.orderNo,
        token: session.token,
        razorpay_order_id: session.razorpayOrderId,
        razorpay_payment_id: payment.id,
        razorpay_signature: sign(session.razorpayOrderId, payment.id),
      })
    );
    assert.equal(body.outcome, "failed");
    assert.match(body.paymentStatus, /card declined/);
  });

  test("a payment from someone else's order is refused", async () => {
    const mine = await buyOne();
    const theirs = await buyOne();
    const { status } = await json(
      await post("/api/payments/razorpay/verify", {
        orderNo: mine.session.orderNo,
        token: mine.session.token,
        razorpay_order_id: theirs.session.razorpayOrderId,
        razorpay_payment_id: theirs.payment.id,
        razorpay_signature: sign(theirs.session.razorpayOrderId, theirs.payment.id),
      })
    );
    assert.equal(status, 409);
    assert.ok((await events(mine.session.orderNo)).some((e) => e.kind === "tamper_suspected"));
  });

  test("the receipt code is required, and belongs to one order", async () => {
    const mine = await buyOne();
    const other = await buyOne();
    const withoutToken = await post("/api/payments/razorpay/verify", {
      orderNo: mine.session.orderNo,
      razorpay_order_id: mine.session.razorpayOrderId,
      razorpay_payment_id: mine.payment.id,
      razorpay_signature: sign(mine.session.razorpayOrderId, mine.payment.id),
    });
    assert.equal(withoutToken.status, 404);
    const wrongToken = await post("/api/payments/razorpay/verify", {
      orderNo: mine.session.orderNo,
      token: other.session.token,
      razorpay_order_id: mine.session.razorpayOrderId,
      razorpay_payment_id: mine.payment.id,
      razorpay_signature: sign(mine.session.razorpayOrderId, mine.payment.id),
    });
    assert.equal(wrongToken.status, 404);
  });

  test("a payment for the wrong amount is held for review, not paid", async () => {
    const { session, payment } = await buyOne({ amount: 100 });
    const { body } = await json(
      await post("/api/payments/razorpay/verify", {
        orderNo: session.orderNo,
        token: session.token,
        razorpay_order_id: session.razorpayOrderId,
        razorpay_payment_id: payment.id,
        razorpay_signature: sign(session.razorpayOrderId, payment.id),
      })
    );
    assert.equal(body.outcome, "pending");
    assert.match(body.paymentStatus, /^Needs review/);
    assert.ok((await events(session.orderNo)).some((e) => e.kind === "tamper_suspected"));
  });

  test("a payment the bank has only authorised is captured, then paid", async () => {
    const { session, payment } = await buyOne({ status: "authorized", captured: false });
    const { body } = await json(
      await post("/api/payments/razorpay/verify", {
        orderNo: session.orderNo,
        token: session.token,
        razorpay_order_id: session.razorpayOrderId,
        razorpay_payment_id: payment.id,
        razorpay_signature: sign(session.razorpayOrderId, payment.id),
      })
    );
    assert.equal(body.outcome, "paid");
    assert.equal(razorpay.payments.get(payment.id).status, "captured");
  });

  test("closing the window records a failure, unless the payment did go through", async () => {
    const abandoned = await buyOne({ status: "failed", captured: false, error_description: "card declined" });
    const closed = await json(
      await post("/api/payments/razorpay/cancel", {
        orderNo: abandoned.session.orderNo,
        token: abandoned.session.token,
        reason: "the payment window was closed",
      })
    );
    assert.equal(closed.body.outcome, "failed");

    // Paid, but the shopper closed the tab before the browser could report it.
    const quiet = await buyOne();
    const stillPaid = await json(
      await post("/api/payments/razorpay/cancel", {
        orderNo: quiet.session.orderNo,
        token: quiet.session.token,
        reason: "the payment window was closed",
      })
    );
    assert.equal(stillPaid.body.outcome, "paid", "Razorpay is asked, not the browser");
  });

  test("a webhook confirms a payment the browser never reported", async () => {
    const { session, payment } = await buyOne();
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: payment } } });

    const unsigned = await fetch(`${base}/api/payments/razorpay/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Razorpay-Signature": "nonsense" },
      body,
    });
    assert.equal(unsigned.status, 400, "an unsigned webhook is ignored");

    const signed = await fetch(`${base}/api/payments/razorpay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex"),
      },
      body,
    });
    assert.equal(signed.status, 200);

    // The webhook is handled after answering Razorpay, so give it a moment.
    for (let i = 0; i < 40; i++) {
      const { body: rec } = await json(await fetch(`${base}/api/orders/${session.orderNo}?t=${session.token}`));
      if (rec.outcome === "paid") {
        assert.ok((await events(session.orderNo)).some((e) => e.kind === "webhook_received"));
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail("the webhook did not mark the order paid");
  });

  test("the admin can fetch Razorpay's own record of an order", async () => {
    const { session, payment } = await buyOne();
    const { status, body } = await json(
      await fetch(`${base}/api/admin/orders/${session.orderNo}/check`, {
        method: "POST",
        headers: await admin(),
      })
    );
    assert.equal(status, 200);
    assert.equal(body.response.items[0].id, payment.id);
    assert.equal(body.order.paymentStatus, "Paid");
  });

  test("the admin's gateway check confirms the keys without taking money", async () => {
    const { body } = await json(
      await fetch(`${base}/api/admin/payments/diagnose`, { headers: await admin() })
    );
    assert.equal(body.provider, "razorpay");
    assert.equal(body.ok, true);
    assert.match(body.verdict, /accepted these test keys/);
    assert.ok(body.facts.some(([label, value]) => label === "Key id" && value === KEY_ID));
    assert.ok(!JSON.stringify(body).includes(KEY_SECRET));
  });

  test("the key secret is never written to the log", () => {
    assert.ok(!output.includes(KEY_SECRET));
    assert.ok(!output.includes(WEBHOOK_SECRET));
  });
});
