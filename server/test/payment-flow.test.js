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

// End to end: the real server, its real (embedded) database, and a fake HDFC
// SmartGateway. Each test is one of the checks in HDFC's security audit
// checklist, tried the way an auditor would.

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESPONSE_KEY = "test-response-key";
const STOREFRONT = "https://www.shophaveliwale.com";

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// ---- Fake SmartGateway ------------------------------------------------------
const gateway = {
  sessions: [], // bodies of /session requests
  status: new Map(), // order_id → Order Status reply
  paymentHost: "https://smartgateway.hdfcuat.bank.in",
};
let gatewayServer;

async function startGateway() {
  gatewayServer = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.method === "POST" && req.url === "/session") {
      const session = JSON.parse(body);
      gateway.sessions.push(session);
      return reply(200, {
        id: `sess_${session.order_id}`,
        payment_links: { web: `${gateway.paymentHost}/payment-page/order/${session.order_id}` },
      });
    }
    const match = req.url.match(/^\/orders\/(.+)$/);
    if (req.method === "GET" && match) {
      const orderId = decodeURIComponent(match[1]);
      return reply(200, gateway.status.get(orderId) || { order_id: orderId, status: "PENDING_VBV" });
    }
    reply(404, {});
  });
  await new Promise((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${gatewayServer.address().port}`;
}

// ---- The shop's server ------------------------------------------------------
let base;
let child;
let dataDir;
let output = "";

before(async () => {
  const gatewayUrl = await startGateway();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-flow-"));
  child = spawn(process.execPath, ["index.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DATABASE_URL: "",
      SUPABASE_URL: "",
      ADMIN_PASSWORD: "admin-pw",
      HDFC_API_KEY: "test-key",
      HDFC_MERCHANT_ID: "TESTMERCHANT",
      HDFC_ENV: "sandbox",
      HDFC_BASE_URL: gatewayUrl,
      HDFC_RESPONSE_KEY: RESPONSE_KEY,
      PUBLIC_SERVER_URL: base,
      CLIENT_URL: STOREFRONT,
      RECEIPT_RECHECK_MS: "0",
      SMTP_HOST: "",
    },
  });
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  // The embedded database takes a few seconds to create on first start.
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
  gatewayServer?.close();
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

async function products() {
  return (await json(await fetch(`${base}/api/products`))).body;
}

async function checkout(items, extra = {}) {
  return json(await post("/api/payments/hdfc/session", { items, customer, ...extra }));
}

function signed(params) {
  const joined = Object.entries(params)
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const signature = crypto
    .createHmac("sha256", RESPONSE_KEY)
    .update(encodeURIComponent(joined))
    .digest("base64");
  return { ...params, signature, signature_algorithm: "HMAC-SHA256" };
}

// What HDFC does after the payment page: send the browser to our return URL.
async function returnFromGateway(orderNo, params, { returnUrl } = {}) {
  const url = returnUrl || gateway.sessions.find((s) => s.order_id === orderNo).return_url;
  const res = await fetch(`${url}?${new URLSearchParams(params)}`, { redirect: "manual" });
  assert.equal(res.status, 303);
  return new URL(res.headers.get("location"));
}

const events = async (orderNo) =>
  (await json(await fetch(`${base}/api/admin/orders/${orderNo}/events`, { headers: await admin() }))).body;

// ---- The audit checklist -----------------------------------------------------
describe("HDFC security audit checklist", () => {
  test("1. unique order ids: dated, random, alphanumeric, under 21 characters", async () => {
    const [p] = await products();
    const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const { status, body } = await checkout([{ id: p.id, qty: 1 }]);
      assert.equal(status, 200);
      assert.match(body.orderNo, /^PE\d{6}[0-9A-Z]{8}$/);
      ids.add(body.orderNo);
    }
    assert.equal(ids.size, 5);
  });

  test("2. request tampering: the amount sent to HDFC comes from the database", async () => {
    const [p] = await products();
    const { body } = await checkout([{ id: p.id, qty: 2, price: 1, name: "cheap" }]);
    const session = gateway.sessions.find((s) => s.order_id === body.orderNo);
    const expected = p.price * 2; // shipping is free
    assert.equal(session.amount, expected.toFixed(2));
  });

  test("3. response tampering: a forged CHARGED return doesn't mark an unpaid order paid", async () => {
    const [p] = await products();
    const { body } = await checkout([{ id: p.id, qty: 1 }]);
    gateway.status.set(body.orderNo, { order_id: body.orderNo, status: "AUTHORIZATION_FAILED", amount: 1 });

    const forged = { order_id: body.orderNo, status: "CHARGED", status_id: "21", signature: "Zm9yZ2Vk", signature_algorithm: "HMAC-SHA256" };
    const back = await returnFromGateway(body.orderNo, forged);
    assert.equal(back.searchParams.get("status"), "failed");

    const receipt = (await json(await fetch(`${base}/api/orders/${body.orderNo}?t=${body.token}`))).body;
    assert.equal(receipt.outcome, "failed");
    const log = await events(body.orderNo);
    assert.ok(log.some((e) => e.kind === "shopper_returned" && /INVALID/.test(e.detail.signature)));
    assert.ok(log.some((e) => e.kind === "tamper_suspected" && e.detail.reported === "CHARGED"));
  });

  test("3. response tampering: a return relabelled as another order is refused", async () => {
    const [p] = await products();
    const a = (await checkout([{ id: p.id, qty: 1 }])).body;
    const b = (await checkout([{ id: p.id, qty: 1 }])).body;
    gateway.status.set(b.orderNo, { order_id: b.orderNo, status: "CHARGED", amount: 999999 });
    const aReturnUrl = gateway.sessions.find((s) => s.order_id === a.orderNo).return_url;

    const back = await returnFromGateway(b.orderNo, signed({ order_id: b.orderNo, status: "CHARGED", status_id: "21" }), {
      returnUrl: aReturnUrl,
    });
    assert.equal(back.searchParams.get("status"), "failed");
    assert.equal(back.searchParams.get("t"), null, "no receipt link for the relabelled order");
    assert.ok((await events(b.orderNo)).some((e) => e.kind === "tamper_suspected"));
  });

  test("3. response tampering: HDFC charging a different amount is held for review, not paid", async () => {
    const [p] = await products();
    const { body } = await checkout([{ id: p.id, qty: 1 }]);
    gateway.status.set(body.orderNo, { order_id: body.orderNo, status: "CHARGED", amount: 1 });
    const back = await returnFromGateway(body.orderNo, signed({ order_id: body.orderNo, status: "CHARGED", status_id: "21" }));
    assert.equal(back.searchParams.get("status"), "pending");
    const receipt = (await json(await fetch(`${base}/api/orders/${body.orderNo}?t=${body.token}`))).body;
    assert.equal(receipt.outcome, "pending");
    assert.match(receipt.paymentStatus, /^Needs review/);
  });

  test("4. URL redirection: a payment page outside SmartGateway is never used", async () => {
    const [p] = await products();
    gateway.paymentHost = "https://evil.example.com";
    try {
      const { status, body } = await checkout([{ id: p.id, qty: 1 }]);
      assert.equal(status, 502);
      assert.equal(body.paymentLink, undefined);
    } finally {
      gateway.paymentHost = "https://smartgateway.hdfcuat.bank.in";
    }
    const back = await fetch(`${base}/api/payments/hdfc/return?order_id=../../evil`, { redirect: "manual" });
    assert.ok(back.headers.get("location").startsWith(`${STOREFRONT}/checkout?`), "always back to the storefront");
  });

  test("5. duplicates: five simultaneous confirmations complete the order once", async () => {
    const h = await admin();
    const saree = (await products())[1];
    await post(`/api/products/${saree.id}/stock`, { stock: 5 }, h);

    const { body } = await checkout([{ id: saree.id, qty: 2 }]);
    const session = gateway.sessions.find((s) => s.order_id === body.orderNo);
    gateway.status.set(body.orderNo, { order_id: body.orderNo, status: "CHARGED", amount: Number(session.amount), txn_id: "txn_dup" });

    const params = signed({ order_id: body.orderNo, status: "CHARGED", status_id: "21" });
    const results = await Promise.all(Array.from({ length: 5 }, () => returnFromGateway(body.orderNo, params)));
    assert.ok(results.every((u) => u.searchParams.get("status") === "success"));

    const after = (await json(await fetch(`${base}/api/products/${saree.id}`))).body;
    assert.equal(after.stock, 3, "2 units taken once, not five times");
    const log = await events(body.orderNo);
    assert.equal(log.filter((e) => e.kind === "marked_paid").length, 1);
  });

  test("5. duplicates: the same checkout submitted twice makes one order", async () => {
    const [p] = await products();
    const attemptId = crypto.randomUUID();
    const [first, second] = await Promise.all([
      checkout([{ id: p.id, qty: 1 }], { attemptId }),
      checkout([{ id: p.id, qty: 1 }], { attemptId }),
    ]);
    const ok = [first, second].filter((r) => r.status === 200);
    assert.ok(ok.length >= 1);
    assert.equal(new Set(ok.map((r) => r.body.orderNo)).size, 1);
    const orders = (await json(await fetch(`${base}/api/admin/orders`, { headers: await admin() }))).body;
    assert.equal(orders.filter((o) => o.attemptId === attemptId).length, 1);
  });

  test("6. receipt: shows order number, amount and success in real time; only to the buyer", async () => {
    const [p] = await products();
    const { body } = await checkout([{ id: p.id, qty: 1 }]);
    const session = gateway.sessions.find((s) => s.order_id === body.orderNo);

    // The bank is still processing when the shopper comes back…
    const back = await returnFromGateway(body.orderNo, signed({ order_id: body.orderNo, status: "PENDING_VBV", status_id: "23" }));
    assert.equal(back.searchParams.get("status"), "pending");
    const t = back.searchParams.get("t");
    assert.equal((await json(await fetch(`${base}/api/orders/${body.orderNo}?t=${t}`))).body.outcome, "pending");

    // …then confirms; the receipt page's next refresh picks it up.
    gateway.status.set(body.orderNo, { order_id: body.orderNo, status: "CHARGED", amount: Number(session.amount), txn_id: "txn_42" });
    const receipt = (await json(await fetch(`${base}/api/orders/${body.orderNo}?t=${t}`))).body;
    assert.equal(receipt.outcome, "paid");
    assert.equal(receipt.orderNo, body.orderNo);
    assert.equal(receipt.total, Number(session.amount));
    assert.equal(receipt.paymentId, "txn_42");
    assert.equal(receipt.isTest, true, "sandbox orders are marked as tests");
    assert.equal(receipt.customer.address, undefined, "no address on the public receipt");

    assert.equal((await fetch(`${base}/api/orders/${body.orderNo}`)).status, 404, "no code, no receipt");
    const other = (await checkout([{ id: p.id, qty: 1 }])).body;
    assert.equal((await fetch(`${base}/api/orders/${body.orderNo}?t=${other.token}`)).status, 404);
  });

  test("dual inquiry: the admin can fetch HDFC's Order Status reply for any order", async () => {
    const [p] = await products();
    const { body } = await checkout([{ id: p.id, qty: 1 }]);
    const session = gateway.sessions.find((s) => s.order_id === body.orderNo);
    gateway.status.set(body.orderNo, { order_id: body.orderNo, status: "CHARGED", amount: Number(session.amount), txn_id: "txn_admin" });

    const { status, body: checked } = await json(await fetch(`${base}/api/admin/orders/${body.orderNo}/check`, { method: "POST", headers: await admin() }));
    assert.equal(status, 200);
    assert.equal(checked.response.status, "CHARGED");
    assert.equal(checked.order.paymentStatus, "Paid");
    assert.equal((await fetch(`${base}/api/admin/orders/${body.orderNo}/check`, { method: "POST" })).status, 401);
  });
});

describe("general web security", () => {
  test("security headers are sent", async () => {
    const res = await fetch(`${base}/api/products`);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("only the storefront may call the API from a browser", async () => {
    const ours = await fetch(`${base}/api/products`, { headers: { Origin: STOREFRONT } });
    assert.equal(ours.headers.get("access-control-allow-origin"), STOREFRONT);
    const theirs = await fetch(`${base}/api/products`, { headers: { Origin: "https://evil.example.com" } });
    assert.equal(theirs.headers.get("access-control-allow-origin"), null);
  });

  test("password guessing is cut off", async () => {
    const headers = { "X-Forwarded-For": "203.0.113.9" };
    for (let i = 0; i < 10; i++) {
      assert.equal((await post("/api/login", { password: `guess-${i}` }, headers)).status, 401);
    }
    assert.equal((await post("/api/login", { password: "admin-pw" }, headers)).status, 429);
  });

  test("the admin password is never written to the log", () => {
    assert.ok(!output.includes("admin-pw"));
  });
});

describe("colours and categories", () => {
  test("a saree is bought in a colour it comes in; colours share its stock", async () => {
    const h = await admin();
    const created = await json(
      await post(
        "/api/products",
        {
          name: "Two-tone silk",
          price: 1500,
          category: "Silk",
          stock: 3,
          images: ["main.jpg"],
          colors: [
            { name: "Maroon", hex: "#6d1f3a", images: ["maroon.jpg"] },
            { name: "Teal", hex: "#1f6d6a", images: [] },
          ],
        },
        h
      )
    );
    assert.equal(created.status, 201);
    const id = created.body.id;

    const { status, body } = await checkout([{ id, qty: 1, color: "maroon" }]);
    assert.equal(status, 200);
    const orders = (await json(await fetch(`${base}/api/admin/orders`, { headers: h }))).body;
    const [item] = orders.find((o) => o.orderNo === body.orderNo).items;
    assert.deepEqual([item.color, item.image], ["Maroon", "maroon.jpg"]);

    const noColor = await checkout([{ id, qty: 1 }]);
    const first = (await json(await fetch(`${base}/api/admin/orders`, { headers: h }))).body.find(
      (o) => o.orderNo === noColor.body.orderNo
    );
    assert.equal(first.items[0].color, "Maroon", "no colour given means the first one");

    const unknown = await checkout([{ id, qty: 1, color: "Pink" }]);
    assert.equal(unknown.status, 409);
    assert.match(unknown.body.error, /no longer available in Pink/);

    const tooMany = await checkout([
      { id, qty: 2, color: "Maroon" },
      { id, qty: 2, color: "Teal" },
    ]);
    assert.equal(tooMany.status, 409);
    assert.match(tooMany.body.error, /Only 3 left/);

    await fetch(`${base}/api/products/${id}`, { method: "DELETE", headers: h });
  });

  test("the admin can rename categories, and their sarees move with them", async () => {
    const h = await admin();
    const start = (await json(await fetch(`${base}/api/categories`))).body;
    assert.ok(start.length > 0);

    const put = (categories, headers = h) =>
      fetch(`${base}/api/categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ categories }),
      });
    assert.equal((await put([{ name: "X" }], {})).status, 401);
    assert.equal((await put([{ name: "" }])).status, 400);

    const saree = (await products()).find((p) => p.category === "Kanjivaram");
    const renamed = start.map((c) =>
      c.name === "Kanjivaram" ? { ...c, name: "Kanchipuram", was: "Kanjivaram" } : { ...c, was: c.name }
    );
    assert.equal((await put(renamed)).status, 200);
    const now = (await json(await fetch(`${base}/api/categories`))).body;
    assert.ok(now.some((c) => c.name === "Kanchipuram"));
    assert.ok(!now.some((c) => c.name === "Kanjivaram"));
    assert.equal((await json(await fetch(`${base}/api/products/${saree.id}`))).body.category, "Kanchipuram");
  });
});
