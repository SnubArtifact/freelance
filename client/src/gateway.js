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

// Razorpay's payment window is opened by their own script, fetched from their
// domain the first time a shopper needs it.
let checkoutScript = null;
export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  checkoutScript ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => {
      checkoutScript = null;
      reject(new Error("We couldn't load the payment window. Please check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return checkoutScript;
}

// Identifies one checkout submission (see api.createHdfcSession).
export function newAttemptId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
