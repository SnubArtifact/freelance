import fs from "node:fs";
import path from "node:path";
import { sampleProducts } from "./catalog.js";
import { SCHEMA } from "./db/schema.js";

// Postgres returns money (numeric) and big numbers as text.
const num = (value) => (value === null || value === undefined ? null : Number(value));

function toProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: num(row.price),
    originalPrice: num(row.original_price),
    category: row.category,
    fabric: row.fabric,
    color: row.color,
    images: row.images || [],
    featured: row.featured,
    inStock: row.in_stock,
    stock: num(row.stock),
    createdAt: num(row.created_at),
  };
}

function toOrder(row) {
  return {
    id: row.id,
    orderNo: row.order_no,
    attemptId: row.attempt_id,
    customer: row.customer,
    items: row.items,
    subtotal: num(row.subtotal),
    shippingFee: num(row.shipping_fee),
    total: num(row.total),
    payment: row.payment,
    paymentStatus: row.payment_status,
    paymentId: row.payment_id,
    status: row.status,
    isTest: row.is_test,
    paymentLink: row.payment_link,
    gatewayRef: row.gateway_ref,
    gatewayStatus: row.gateway_status,
    gatewayResponse: row.gateway_response,
    paidAt: num(row.paid_at),
    createdAt: num(row.created_at),
  };
}

// Postgres reports a broken unique rule as error 23505. `column` narrows it to
// one rule (e.g. "order_no").
export function isUniqueViolation(err, column) {
  if (err?.code !== "23505") return false;
  const where = `${err.constraint || ""} ${err.detail || ""} ${err.message || ""}`;
  return !column || where.includes(column);
}

const PRODUCT_COLUMNS =
  "id, name, description, price, original_price, category, fabric, color, images, featured, in_stock, stock, created_at";

const productParams = (p) => [
  String(p.id),
  String(p.name ?? ""),
  p.description ?? "",
  Number(p.price) || 0,
  p.originalPrice ?? null,
  p.category || "Uncategorized",
  p.fabric ?? "",
  p.color ?? "",
  JSON.stringify(p.images || []),
  Boolean(p.featured),
  p.inStock !== false,
  p.stock ?? null,
  Number(p.createdAt) || Date.now(),
];

function insertProduct(run, product) {
  return run(
    `insert into shop.products (${PRODUCT_COLUMNS})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)`,
    productParams(product)
  );
}

// Takes paid-for units off tracked stock; a saree that reaches zero is sold
// out. Untracked stock (null) is left alone. The SET clause reads the row's
// values from before the update.
async function takeStock(run, items) {
  for (const { id, qty } of items) {
    await run(
      `update shop.products
          set stock = greatest(0, stock - $2),
              in_stock = case when stock - $2 <= 0 then false else in_stock end
        where id = $1 and stock is not null`,
      [String(id), Number(qty)]
    );
  }
}

// A brand-new local database starts with the sarees from an old
// products.json if there is one, otherwise a few samples.
async function fillNewLocalDatabase(run, legacyDir) {
  let products = null;
  const file = legacyDir && path.join(legacyDir, "products.json");
  if (file && fs.existsSync(file)) {
    try {
      products = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      products = null;
    }
  }
  const list = Array.isArray(products) ? products : sampleProducts();
  for (const product of list) await insertProduct(run, product);
  console.log(
    `[db] New local database: added ${list.length} saree(s) from ${products ? "products.json" : "the samples"}.`
  );
}

/**
 * The shop's data — sarees, orders and the payment log — in Postgres. Creates
 * its tables on first use. Only a brand-new *local* database gets sample
 * sarees (seed: false turns that off); a real shop database never does.
 */
export async function openShop(db, { seed = true, legacyDir = null } = {}) {
  await db.exec(SCHEMA);
  if (seed && db.kind === "embedded" && db.fresh) await fillNewLocalDatabase(db.query, legacyDir);

  const q = db.query;
  const one = async (sql, params, map) => {
    const [row] = await q(sql, params);
    return row ? map(row) : null;
  };

  return {
    kind: db.kind,

    // ----- Sarees ----------------------------------------------------------
    async listProducts() {
      return (await q("select * from shop.products order by created_at desc")).map(toProduct);
    },
    getProduct: (id) =>
      one("select * from shop.products where id = $1", [String(id)], toProduct),
    async getProducts(ids) {
      const rows = await q("select * from shop.products where id = any($1::text[])", [
        ids.map(String),
      ]);
      return rows.map(toProduct);
    },
    async createProduct(product) {
      await insertProduct(q, product);
      return product;
    },
    replaceProduct: (p) =>
      one(
        `update shop.products
            set name = $2, description = $3, price = $4, original_price = $5,
                category = $6, fabric = $7, color = $8, images = $9::jsonb,
                featured = $10, in_stock = $11, stock = $12, created_at = $13
          where id = $1
        returning *`,
        productParams(p),
        toProduct
      ),
    deleteProduct: (id) =>
      one("delete from shop.products where id = $1 returning *", [String(id)], toProduct),

    // ----- Orders ------------------------------------------------------------
    async insertOrder(o) {
      await q(
        `insert into shop.orders
           (id, order_no, attempt_id, customer, items, subtotal, shipping_fee, total,
            payment, payment_status, payment_id, status, is_test, created_at)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          o.id,
          o.orderNo,
          o.attemptId ?? null,
          JSON.stringify(o.customer),
          JSON.stringify(o.items),
          o.subtotal,
          o.shippingFee,
          o.total,
          o.payment,
          o.paymentStatus,
          o.paymentId ?? null,
          o.status,
          Boolean(o.isTest),
          o.createdAt,
        ]
      );
      return o;
    },
    getOrderByOrderNo: (orderNo) =>
      one("select * from shop.orders where order_no = $1", [String(orderNo)], toOrder),
    findOrderByAttempt: (attemptId) =>
      one("select * from shop.orders where attempt_id = $1", [String(attemptId)], toOrder),
    async listOrders() {
      return (await q("select * from shop.orders order by created_at desc")).map(toOrder);
    },
    setPaymentLink: (orderNo, link) =>
      one(
        "update shop.orders set payment_link = $2, updated_at = now() where order_no = $1 returning *",
        [orderNo, link],
        toOrder
      ),
    setGatewayRef: (orderNo, ref) =>
      one(
        "update shop.orders set gateway_ref = $2, updated_at = now() where order_no = $1 returning *",
        [orderNo, ref],
        toOrder
      ),
    findOrderByGatewayRef: (ref) =>
      one("select * from shop.orders where gateway_ref = $1", [String(ref)], toOrder),

    // Records a gateway outcome that isn't a payment. Never touches an order
    // that is already paid, so a late or replayed failure can't undo it.
    recordUnpaid: (orderNo, { paymentStatus, status, gatewayStatus = null, gatewayResponse = null }) =>
      one(
        `update shop.orders
            set payment_status = $2, status = $3,
                gateway_status = coalesce($4, gateway_status),
                gateway_response = coalesce($5::jsonb, gateway_response),
                updated_at = now()
          where order_no = $1 and payment_status not like 'Paid%'
        returning *`,
        [
          orderNo,
          paymentStatus,
          status,
          gatewayStatus,
          gatewayResponse === null ? null : JSON.stringify(gatewayResponse),
        ],
        toOrder
      ),

    // Marks an order paid and takes its stock in one transaction, and only
    // once: of two confirmations arriving together, one gets the order back
    // and the other gets null. So stock, and the email the caller sends,
    // happen exactly once.
    completePayment: (orderNo, { paymentId, gatewayStatus, gatewayResponse }) =>
      db.transaction(async (tx) => {
        const [row] = await tx(
          `update shop.orders
              set payment_status = 'Paid', status = 'Confirmed', payment_id = $2,
                  gateway_status = $3, gateway_response = $4::jsonb, paid_at = $5,
                  updated_at = now()
            where order_no = $1 and payment_status not like 'Paid%'
          returning *`,
          [orderNo, paymentId, gatewayStatus, JSON.stringify(gatewayResponse ?? null), Date.now()]
        );
        if (!row) return null;
        const order = toOrder(row);
        await takeStock(tx, order.items);
        return order;
      }),

    // Demo checkout only (no gateway configured): paid as soon as recorded.
    insertPaidOrder: (order) =>
      db.transaction(async (tx) => {
        await tx(
          `insert into shop.orders
             (id, order_no, customer, items, subtotal, shipping_fee, total, payment,
              payment_status, payment_id, status, is_test, paid_at, created_at)
           values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            order.id,
            order.orderNo,
            JSON.stringify(order.customer),
            JSON.stringify(order.items),
            order.subtotal,
            order.shippingFee,
            order.total,
            order.payment,
            order.paymentStatus,
            order.paymentId ?? null,
            order.status,
            Boolean(order.isTest),
            order.createdAt,
            order.createdAt,
          ]
        );
        await takeStock(tx, order.items);
        return order;
      }),

    // ----- Payment log -------------------------------------------------------
    async logEvent(orderNo, kind, detail = {}) {
      await q("insert into shop.payment_events (order_no, kind, detail) values ($1, $2, $3::jsonb)", [
        orderNo,
        kind,
        JSON.stringify(detail),
      ]);
    },
    async listEvents(orderNo) {
      const rows = await q(
        "select kind, detail, created_at from shop.payment_events where order_no = $1 order by id",
        [String(orderNo)]
      );
      return rows.map((r) => ({ kind: r.kind, detail: r.detail, at: new Date(r.created_at).getTime() }));
    },

    async ping() {
      await q("select 1");
    },
    close: () => db.close(),
  };
}
