import crypto from "node:crypto";
import { safeEqual } from "./security.js";

/**
 * HDFC SmartGateway: creating payment sessions, the server-to-server Order
 * Status call, and the checks the bank's security audit asks for.
 */
export function hdfcClient({ apiKey, merchantId, clientId, resellerId, baseUrl, shopName }) {
  // Basic auth: base64 of "<api_key>:" (API key as username, no password).
  const headers = (customerId) => ({
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    "Content-Type": "application/json",
    "x-merchantid": merchantId,
    "x-customerid": customerId,
    "x-resellerid": resellerId,
  });

  return {
    baseUrl,

    // Returns the hosted payment-page link and SmartGateway's full reply.
    async createSession({ orderNo, amount, customer, returnUrl }) {
      const [firstName, ...rest] = (customer.name || "").trim().split(" ");
      const res = await fetch(`${baseUrl}/session`, {
        method: "POST",
        headers: headers(customer.customerId),
        body: JSON.stringify({
          order_id: orderNo,
          amount: Number(amount).toFixed(2),
          customer_id: customer.customerId,
          customer_email: customer.email || "",
          customer_phone: (customer.phone || "").replace(/\D/g, "").slice(-10),
          payment_page_client_id: clientId,
          action: "paymentPage",
          currency: "INR",
          return_url: returnUrl,
          description: `${shopName} order ${orderNo}`,
          first_name: firstName || "",
          last_name: rest.join(" "),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`SmartGateway session error: ${await res.text()}`);
      const data = await res.json();
      const paymentLink = data?.payment_links?.web;
      if (!paymentLink) throw new Error("SmartGateway did not return a payment link");
      return { paymentLink, response: data };
    },

    // The authoritative answer on an order's payment, straight from HDFC.
    async getOrderStatus(orderNo, customerId) {
      const res = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderNo)}`, {
        headers: headers(customerId),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`SmartGateway order-status error: ${await res.text()}`);
      return res.json();
    },
  };
}

// Order numbers: "PE" + date + 8 random characters, e.g. PE260918K7Q2M9XA.
// Alphanumeric and under 21 characters, as SmartGateway requires. The random
// part comes from the operating system's secure generator; the database's
// unique rule catches the (astronomically unlikely) repeat.
const ORDER_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function newOrderNo(now = new Date()) {
  const date = now.toISOString().slice(2, 10).replace(/-/g, "");
  let random = "";
  for (let i = 0; i < 8; i++) random += ORDER_CHARS[crypto.randomInt(ORDER_CHARS.length)];
  return `PE${date}${random}`;
}

// What an Order Status reply means for the shop. Only CHARGED, for this exact
// order and amount, is a payment. Anything not known to have failed is
// treated as still pending, so a new or unexpected status can never mark an
// order paid.
const FAILED = new Set([
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "JUSPAY_DECLINED",
  "CAPTURE_FAILED",
  "AUTO_REFUNDED",
  "VOIDED",
  "NOT_FOUND",
]);
export function interpretStatus(statusData, order) {
  const status = String(statusData?.status || "UNKNOWN").toUpperCase();
  const amountMatches = Math.abs(Number(statusData?.amount) - Number(order.total)) < 0.01;
  const orderMatches =
    statusData?.order_id === undefined || String(statusData.order_id) === order.orderNo;
  if (status === "CHARGED" && amountMatches && orderMatches) return { outcome: "paid", status };
  if (status === "CHARGED") {
    return {
      outcome: "review",
      status,
      reason: orderMatches
        ? `charged ₹${statusData?.amount} but the order total is ₹${order.total}`
        : `HDFC answered for order ${statusData.order_id}`,
    };
  }
  if (FAILED.has(status)) return { outcome: "failed", status };
  return { outcome: "pending", status };
}

// Before sending a shopper to the payment page, make sure it really is
// SmartGateway's — a tampered or misrouted session reply must not be able to
// send them anywhere else.
const GATEWAY_DOMAINS = ["hdfc.bank.in", "hdfcuat.bank.in", "hdfcbank.com", "juspay.in", "juspay.io"];
export function isGatewayUrl(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return GATEWAY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Checks the signature HDFC puts on the return redirect, as documented:
 * percent-encode every key and value except signature/signature_algorithm,
 * sort by encoded key, join as k=v with "&", percent-encode that, HMAC-SHA256
 * with the Response Key, base64.
 *
 * The documentation doesn't include a worked example, so the obvious readings
 * of "percent-encode that" and the output encoding are all accepted; the
 * matching one is reported. The payment decision itself never rests on this:
 * it comes from the Order Status API.
 */
export function verifyReturnSignature(params, responseKey) {
  if (!responseKey) return { checked: false };
  const received = params.signature;
  if (!received) return { checked: true, valid: false, reason: "no signature" };

  const joined = Object.entries(params)
    .filter(([k]) => k !== "signature" && k !== "signature_algorithm")
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(String(v))])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  // A "+" in a base64 signature arrives as a space once the query string is
  // decoded; put it back, then decode once as the documentation says.
  let got = String(received).replace(/ /g, "+");
  try {
    got = decodeURIComponent(got);
  } catch {
    /* already decoded */
  }

  const hmac = (text) => crypto.createHmac("sha256", responseKey).update(text);
  const candidates = {
    documented: hmac(encodeURIComponent(joined)).digest("base64"),
    "not re-encoded": hmac(joined).digest("base64"),
    "documented, hex": hmac(encodeURIComponent(joined)).digest("hex"),
  };
  for (const [variant, expected] of Object.entries(candidates)) {
    if (safeEqual(got, expected)) return { checked: true, valid: true, variant };
  }
  return { checked: true, valid: false, reason: "does not match" };
}
