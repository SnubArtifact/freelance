import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { openDatabase } from "../db/connect.js";
import { isUniqueViolation, openShop } from "../shop.js";

// The same checks run twice: against embedded PGlite (local development), and
// through the `pg` driver over a network socket — the exact code path used with
// Supabase in production.

const product = (fields = {}) => ({
  id: crypto.randomUUID(),
  name: "Test saree",
  description: "",
  price: 1000,
  originalPrice: null,
  category: "Silk",
  fabric: "",
  color: "",
  images: [],
  colors: [],
  featured: false,
  inStock: true,
  stock: null,
  createdAt: Date.now(),
  ...fields,
});

const order = (fields = {}) => ({
  id: crypto.randomUUID(),
  orderNo: `PE${crypto.randomInt(1e9, 9e9)}`,
  attemptId: null,
  customer: { name: "Asha", email: "asha@example.com", phone: "9876543210", address: "1 Road", customerId: "CUST1" },
  items: [{ id: "p1", name: "Silk", price: 500, qty: 2, image: "" }],
  subtotal: 1000,
  shippingFee: 99,
  total: 1099,
  payment: "online",
  paymentStatus: "Pending",
  paymentId: null,
  status: "Payment Pending",
  isTest: false,
  createdAt: Date.now(),
  ...fields,
});

// Fields the database adds that a freshly built order doesn't have yet.
const stored = (o) => ({
  ...o,
  paymentLink: null,
  gatewayRef: null,
  gatewayStatus: null,
  gatewayResponse: null,
  paidAt: null,
});

const stockOf = ({ stock, inStock }) => ({ stock, inStock });

let socketServer;
let socketDb;
let socketUrl;
before(async () => {
  socketDb = await PGlite.create();
  socketServer = new PGLiteSocketServer({ db: socketDb, port: 0, host: "127.0.0.1" });
  await socketServer.start();
  const port = socketServer.getServerConn().split(":").pop();
  socketUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
});
after(async () => {
  await socketServer.stop();
  await socketDb.close();
});

const backends = {
  "embedded (PGlite)": () => openDatabase({ url: "", dataDir: null }),
  "pg driver over the network": async () => {
    // Each test starts from an empty shop schema on the shared socket server.
    await socketDb.exec("drop schema if exists shop cascade");
    // The stand-in server takes one connection at a time, and needs a moment
    // to let go of the previous test's.
    for (let attempt = 1; ; attempt++) {
      try {
        return await openDatabase({ url: socketUrl, maxConnections: 1 });
      } catch (err) {
        if (attempt === 10) throw err;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  },
};

for (const [name, open] of Object.entries(backends)) {
  describe(name, () => {
    let shop;
    beforeEach(async () => {
      shop = await openShop(await open(), { seed: false });
    });
    afterEach(async () => {
      await shop.close();
    });

    test("sarees can be added, read, listed newest first, replaced and deleted", async () => {
      const older = product({ name: "Older", createdAt: 1000, price: 12999.5, originalPrice: 16999 });
      const newer = product({ name: "Newer", createdAt: 2000, stock: 4 });
      await shop.createProduct(older);
      await shop.createProduct(newer);

      assert.deepEqual((await shop.listProducts()).map((p) => p.name), ["Newer", "Older"]);
      assert.deepEqual(await shop.getProduct(older.id), older);
      assert.equal(await shop.getProduct("missing"), null);
      assert.deepEqual((await shop.getProducts([newer.id, "missing"])).map((p) => p.id), [newer.id]);

      const renamed = { ...older, name: "Renamed", images: ["a.jpg"] };
      assert.deepEqual(await shop.replaceProduct(renamed), renamed);
      assert.equal(await shop.replaceProduct(product()), null);

      assert.deepEqual(await shop.deleteProduct(older.id), renamed);
      assert.equal(await shop.deleteProduct(older.id), null);
      assert.deepEqual((await shop.listProducts()).map((p) => p.id), [newer.id]);
    });

    test("a saree's colours are saved with it", async () => {
      const colors = [
        { name: "Maroon", hex: "#6d1f3a", images: ["m1.jpg", "m2.jpg"] },
        { name: "Teal", hex: "", images: [] },
      ];
      const saree = product({ colors });
      await shop.createProduct(saree);
      assert.deepEqual((await shop.getProduct(saree.id)).colors, colors);
      const updated = await shop.replaceProduct({ ...saree, colors: colors.slice(1) });
      assert.deepEqual(updated.colors, colors.slice(1));
    });

    test("categories: defaults until saved; renames move their sarees", async () => {
      await shop.createProduct(product({ category: "Tussar" }));
      const start = await shop.listCategories();
      assert.equal(start[0].name, "Kanjivaram");
      assert.ok(start.some((c) => c.name === "Tussar"), "a category already in use is listed");

      const a = product({ category: "Silk" });
      const b = product({ category: "Cotton" });
      await shop.createProduct(a);
      await shop.createProduct(b);
      // Swap two names in one save.
      const saved = [
        { name: "Cotton", tagline: "", home: true },
        { name: "Silk", tagline: "Soft", home: false },
      ];
      await shop.saveCategories(saved, [
        { from: "Silk", to: "Cotton" },
        { from: "Cotton", to: "Silk" },
      ]);
      assert.deepEqual(await shop.listCategories(), saved);
      assert.equal((await shop.getProduct(a.id)).category, "Cotton");
      assert.equal((await shop.getProduct(b.id)).category, "Silk");

      await shop.saveCategories([]);
      assert.deepEqual(await shop.listCategories(), [], "an emptied list stays empty");
    });

    test("ids that aren't plain strings match nothing", async () => {
      await shop.createProduct(product());
      assert.deepEqual(await shop.getProducts([{ $ne: null }]), []);
    });

    test("orders can be saved, found, listed newest first", async () => {
      const first = order({ createdAt: 1000, attemptId: "attempt-1234" });
      const second = order({ createdAt: 2000 });
      await shop.insertOrder(first);
      await shop.insertOrder(second);

      assert.deepEqual(await shop.getOrderByOrderNo(first.orderNo), stored(first));
      assert.deepEqual(await shop.findOrderByAttempt("attempt-1234"), stored(first));
      assert.equal(await shop.getOrderByOrderNo("PE-none"), null);
      assert.deepEqual(
        (await shop.listOrders()).map((o) => o.orderNo),
        [second.orderNo, first.orderNo]
      );
    });

    test("order numbers and checkout attempts can't be used twice", {
      // The stand-in server drops the connection when a statement fails,
      // instead of returning the error as real Postgres (Supabase) does. The
      // embedded run and the end-to-end payment tests cover this rule.
      skip: name === "pg driver over the network" && "the stand-in server drops the connection on errors",
    }, async () => {
      const first = order({ attemptId: "attempt-5678" });
      await shop.insertOrder(first);
      await assert.rejects(shop.insertOrder(order({ orderNo: first.orderNo })), (err) =>
        isUniqueViolation(err, "order_no")
      );
      await assert.rejects(shop.insertOrder(order({ attemptId: "attempt-5678" })), (err) =>
        isUniqueViolation(err, "attempt_id")
      );
    });

    test("a payment is completed once: stock and the paid mark happen exactly once", async () => {
      const saree = product({ stock: 3 });
      await shop.createProduct(saree);
      const o = order({ items: [{ id: saree.id, name: saree.name, price: 1000, qty: 2, image: "" }] });
      await shop.insertOrder(o);

      const payment = { paymentId: "txn_1", gatewayStatus: "CHARGED", gatewayResponse: { status: "CHARGED" } };
      const [a, b] = await Promise.all([
        shop.completePayment(o.orderNo, payment),
        shop.completePayment(o.orderNo, payment),
      ]);
      assert.equal([a, b].filter(Boolean).length, 1, "exactly one confirmation wins");
      const paid = a || b;
      assert.equal(paid.paymentStatus, "Paid");
      assert.equal(paid.paymentId, "txn_1");
      assert.deepEqual(paid.gatewayResponse, { status: "CHARGED" });
      assert.ok(paid.paidAt > 0);
      assert.deepEqual(stockOf(await shop.getProduct(saree.id)), { stock: 1, inStock: true });
    });

    test("a paid order is never downgraded by a late failure", async () => {
      const o = order();
      await shop.insertOrder(o);
      await shop.completePayment(o.orderNo, { paymentId: "t", gatewayStatus: "CHARGED", gatewayResponse: {} });
      const late = await shop.recordUnpaid(o.orderNo, { paymentStatus: "Not paid (X)", status: "Payment Failed" });
      assert.equal(late, null);
      assert.equal((await shop.getOrderByOrderNo(o.orderNo)).paymentStatus, "Paid");
    });

    test("stock: tracked counts fall and sell out at zero; untracked are left alone", async () => {
      const tracked = product({ stock: 1 });
      const untracked = product({ stock: null });
      await shop.createProduct(tracked);
      await shop.createProduct(untracked);
      const o = order({
        items: [
          { id: tracked.id, name: "a", price: 1, qty: 5, image: "" },
          { id: untracked.id, name: "b", price: 1, qty: 5, image: "" },
          { id: "missing", name: "c", price: 1, qty: 1, image: "" },
        ],
      });
      await shop.insertOrder(o);
      await shop.completePayment(o.orderNo, { paymentId: "t", gatewayStatus: "CHARGED", gatewayResponse: {} });
      assert.deepEqual(stockOf(await shop.getProduct(tracked.id)), { stock: 0, inStock: false });
      assert.deepEqual(stockOf(await shop.getProduct(untracked.id)), { stock: null, inStock: true });
    });

    test("the payment log keeps every step in order", async () => {
      await shop.logEvent("PE1", "order_created", { total: 10 });
      await shop.logEvent("PE1", "status_checked", { status: "CHARGED" });
      await shop.logEvent("PE2", "order_created", {});
      const events = await shop.listEvents("PE1");
      assert.deepEqual(events.map((e) => e.kind), ["order_created", "status_checked"]);
      assert.deepEqual(events[1].detail, { status: "CHARGED" });
      assert.ok(events[0].at > 0);
    });
  });
}

describe("a local database on disk", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("keeps everything across restarts, and only a brand-new one gets samples", async () => {
    const pgdata = path.join(dir, "pgdata");
    let shop = await openShop(await openDatabase({ dataDir: pgdata }), { legacyDir: dir });
    const samples = await shop.listProducts();
    assert.equal(samples.length, 4);
    for (const p of samples) await shop.deleteProduct(p.id);
    const mine = product({ name: "Mine", stock: 2 });
    await shop.createProduct(mine);
    await shop.close();

    shop = await openShop(await openDatabase({ dataDir: pgdata }), { legacyDir: dir });
    assert.deepEqual(await shop.listProducts(), [mine]);
    await shop.close();
  });

  test("a new local database takes its sarees from an old products.json", async () => {
    const legacy = [{ ...product({ name: "From JSON" }) }];
    delete legacy[0].stock; // written before stock counts existed
    fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify(legacy));
    const shop = await openShop(await openDatabase({ dataDir: path.join(dir, "pgdata") }), {
      legacyDir: dir,
    });
    const [imported] = await shop.listProducts();
    assert.equal(imported.name, "From JSON");
    assert.equal(imported.stock, null);
    await shop.close();
  });
});
