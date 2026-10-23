// Shoppers are only ever sent to SmartGateway's own https pages. The server
// checks this too; the browser checks again before leaving the shop.
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

// HDFC requires Razorpay Hosted Checkout, rather than Razorpay's JavaScript
// pop-up. Razorpay expects the options as a normal HTML form POST, which moves
// the shopper to the full hosted gateway page. Only server-created fields are
// submitted here; in particular, a key secret never reaches the browser.
const RAZORPAY_HOSTED_CHECKOUT = "https://api.razorpay.com/v1/checkout/embedded";

export function postRazorpayHostedCheckout(session) {
  if (session?.checkoutUrl !== RAZORPAY_HOSTED_CHECKOUT || !session?.fields) {
    throw new Error("We couldn't start the secure payment page. Please try again.");
  }

  const form = document.createElement("form");
  form.method = "post";
  form.action = RAZORPAY_HOSTED_CHECKOUT;
  form.style.display = "none";

  for (const [name, value] of Object.entries(session.fields)) {
    if (value === undefined || value === null) continue;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

// Identifies one checkout submission (see api.createHdfcSession).
export function newAttemptId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
