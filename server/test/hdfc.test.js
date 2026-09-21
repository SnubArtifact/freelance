import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { interpretStatus, isGatewayUrl, newOrderNo, verifyReturnSignature } from "../hdfc.js";
import { allowedOrigins, escapeHtml, loginLimiter, orderTokens } from "../security.js";

test("order numbers are alphanumeric, under 21 characters, dated and unique", () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const no = newOrderNo(new Date("2026-09-18T10:00:00Z"));
    assert.match(no, /^PE260918[0-9A-Z]{8}$/);
    assert.ok(no.length < 21);
    seen.add(no);
  }
  assert.equal(seen.size, 20000);
});

test("only CHARGED for this exact order and amount counts as paid", () => {
  const order = { orderNo: "PE1", total: 1099 };
  assert.equal(interpretStatus({ status: "CHARGED", amount: 1099, order_id: "PE1" }, order).outcome, "paid");
  assert.equal(interpretStatus({ status: "CHARGED", amount: "1099.00", order_id: "PE1" }, order).outcome, "paid");
  assert.equal(interpretStatus({ status: "CHARGED", amount: 1, order_id: "PE1" }, order).outcome, "review");
  assert.equal(interpretStatus({ status: "CHARGED", amount: 1099, order_id: "PE2" }, order).outcome, "review");
  assert.equal(interpretStatus({ status: "AUTHORIZATION_FAILED", amount: 1099 }, order).outcome, "failed");
  assert.equal(interpretStatus({ status: "PENDING_VBV", amount: 1099 }, order).outcome, "pending");
  assert.equal(interpretStatus({ status: "SOMETHING_NEW" }, order).outcome, "pending");
  assert.equal(interpretStatus({}, order).outcome, "pending");
});

test("shoppers are only sent to SmartGateway's own https pages", () => {
  assert.ok(isGatewayUrl("https://smartgateway.hdfcuat.bank.in/payment-page/order/ordeh_1"));
  assert.ok(isGatewayUrl("https://smartgateway.hdfc.bank.in/x"));
  assert.ok(isGatewayUrl("https://smartgatewayuat.hdfcbank.com/x"));
  assert.ok(!isGatewayUrl("http://smartgateway.hdfc.bank.in/x"), "not over plain http");
  assert.ok(!isGatewayUrl("https://smartgateway.hdfc.bank.in.evil.com/x"));
  assert.ok(!isGatewayUrl("https://evil.com/?smartgateway.hdfc.bank.in"));
  assert.ok(!isGatewayUrl("javascript:alert(1)"));
  assert.ok(!isGatewayUrl("not a url"));
});

// Signs return parameters the way HDFC's documentation describes.
function sign(params, key) {
  const joined = Object.entries(params)
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return crypto.createHmac("sha256", key).update(encodeURIComponent(joined)).digest("base64");
}

test("return signatures: genuine ones pass, altered ones don't", () => {
  const key = "RESPONSE_KEY";
  const params = { order_id: "PE260918ABCDEFGH", status: "CHARGED", status_id: "21" };
  const signature = sign(params, key);
  const genuine = { ...params, signature, signature_algorithm: "HMAC-SHA256" };

  assert.deepEqual(verifyReturnSignature(genuine, key), { checked: true, valid: true, variant: "documented" });
  // "+" in base64 turns into a space when a query string is decoded.
  assert.equal(verifyReturnSignature({ ...genuine, signature: signature.replace(/\+/g, " ") }, key).valid, true);
  assert.equal(verifyReturnSignature({ ...genuine, signature: encodeURIComponent(signature) }, key).valid, true);

  assert.equal(verifyReturnSignature({ ...genuine, status: "CHARGED ", order_id: "PE2" }, key).valid, false);
  assert.equal(verifyReturnSignature({ ...genuine, status: "AUTHORIZATION_FAILED" }, key).valid, false);
  assert.equal(verifyReturnSignature(genuine, "WRONG_KEY").valid, false);
  assert.deepEqual(verifyReturnSignature(params, key), { checked: true, valid: false, reason: "no signature" });
  assert.deepEqual(verifyReturnSignature(genuine, ""), { checked: false });
});

test("receipt and return codes belong to one order only", () => {
  const tokens = orderTokens("secret");
  const receipt = tokens.receipt("PE1");
  assert.ok(tokens.check("receipt", "PE1", receipt));
  assert.ok(!tokens.check("receipt", "PE2", receipt), "not another order");
  assert.ok(!tokens.check("return", "PE1", receipt), "not another purpose");
  assert.ok(!tokens.check("receipt", "PE1", undefined));
  assert.ok(!orderTokens("other secret").check("receipt", "PE1", receipt));
});

test("only the storefront's own origins may call the API from a browser", () => {
  const origins = allowedOrigins("https://www.shophaveliwale.com", "https://preview.example.com, junk");
  assert.deepEqual(
    [...origins].sort(),
    ["https://preview.example.com", "https://shophaveliwale.com", "https://www.preview.example.com", "https://www.shophaveliwale.com"]
  );
  assert.deepEqual([...allowedOrigins("http://localhost:5173")], ["http://localhost:5173"]);
});

test("shopper-typed text is made safe for HTML emails", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(escapeHtml(undefined), "");
});

test("sign-ins are refused after too many wrong passwords from one address", () => {
  const limiter = loginLimiter({ max: 3, windowMs: 60000 });
  for (let i = 0; i < 3; i++) limiter.fail("1.2.3.4");
  assert.ok(limiter.blocked("1.2.3.4"));
  assert.ok(!limiter.blocked("5.6.7.8"), "other visitors are unaffected");
  limiter.succeed("1.2.3.4");
  assert.ok(!limiter.blocked("1.2.3.4"));
});
