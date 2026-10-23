import crypto from "node:crypto";
import { safeEqual } from "./security.js";

/**
 * Razorpay Hosted Checkout: creating the order the hosted gateway pays
 * against, and the server-side checks that decide whether it was really paid.
 *
 * Razorpay counts money in paise (₹1 = 100), so amounts here are whole paise.
 */
export function razorpayClient({ keyId, keySecret, apiBase = "https://api.razorpay.com" }) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    "Content-Type": "application/json",
  };

  async function call(method, route, body) {
    const res = await fetch(`${apiBase}/v1${route}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      throw new Error(
        `Razorpay ${route} failed: ${data?.error?.description || data?.error?.code || `HTTP ${res.status}`}`
      );
    }
    return data;
  }

  return {
    // The order the hosted gateway pays against. `receipt` is our own order
    // number, so the two can always be matched up.
    createOrder: ({ orderNo, amountPaise, notes }) =>
      call("POST", "/orders", {
        amount: amountPaise,
        currency: "INR",
        receipt: orderNo,
        notes,
      }),
    paymentsForOrder: (razorpayOrderId) =>
      call("GET", `/orders/${encodeURIComponent(razorpayOrderId)}/payments`),
    getPayment: (paymentId) => call("GET", `/payments/${encodeURIComponent(paymentId)}`),
    capture: (paymentId, amountPaise) =>
      call("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, {
        amount: amountPaise,
        currency: "INR",
      }),
  };
}

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/**
 * HDFC's Ecom Security Policy requires four User Defined Fields on every
 * transaction, so any payment can be traced back to what was bought and by
 * whom. Razorpay carries them in the order's notes. HDFC's list skips UDF2.
 *
 * Notes are capped at 15 pairs, and a value that is too long is refused, so
 * each one is trimmed.
 */
export function udfNotes(order, shopName = "") {
  const customer = order.customer || {};
  const items = (order.items || []).map((i) => `${i.name} x${i.qty}`).join(", ");
  const address = [customer.address, customer.city, customer.pincode].filter(Boolean).join(", ");
  const clip = (value, limit = 250) => String(value ?? "").slice(0, limit);
  return {
    order_no: order.orderNo,
    udf1: clip(items ? `Saree order: ${items}` : "Saree order"),
    udf3: clip(customer.phone),
    udf4: clip(address),
    udf5: clip(`${shopName} order ${order.orderNo}`.trim()),
  };
}

/**
 * Checkout hands the browser three values when a payment succeeds. This proves
 * they came from Razorpay and belong together: HMAC-SHA256 of
 * "<order_id>|<payment_id>" with the key secret, as hex. Razorpay documents it
 * exactly, so anything that doesn't match is refused outright.
 */
export function verifyCheckoutSignature({ orderId, paymentId, signature }, keySecret) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqual(String(signature), expected);
}

// Webhooks are signed over the request body exactly as it arrived, so the raw
// bytes must be used — not a re-serialised copy.
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(String(signature), expected);
}

/**
 * What Razorpay's own record of a payment means for the shop. Only a captured
 * payment, against this Razorpay order, for this exact amount, is a payment.
 * "authorized" means the bank is holding the money but it hasn't been taken
 * yet, so it stays pending until capture succeeds.
 */
export function interpretPayment(payment, { razorpayOrderId, amountPaise }) {
  if (!payment) return { outcome: "pending", status: "none" };
  const status = String(payment.status || "unknown");
  const belongs = !payment.order_id || payment.order_id === razorpayOrderId;
  const amountMatches = Number(payment.amount) === amountPaise;

  if (status === "captured" && belongs && amountMatches) return { outcome: "paid", status };
  if (status === "captured" || status === "authorized") {
    if (!belongs) {
      return { outcome: "review", status, reason: `Razorpay's payment is for order ${payment.order_id}` };
    }
    if (!amountMatches) {
      return {
        outcome: "review",
        status,
        reason: `paid ₹${Number(payment.amount) / 100} but the order total is ₹${amountPaise / 100}`,
      };
    }
    return { outcome: "pending", status }; // authorised, waiting to be captured
  }
  if (status === "failed") return { outcome: "failed", status };
  return { outcome: "pending", status };
}

// The payment that matters out of everything tried against an order: a
// captured one first, then one the bank has authorised, else the most recent.
export function pickPayment(payments = []) {
  return (
    payments.find((p) => p.status === "captured") ||
    payments.find((p) => p.status === "authorized") ||
    payments[payments.length - 1] ||
    null
  );
}
