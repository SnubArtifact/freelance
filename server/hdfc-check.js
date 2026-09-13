/**
 * HDFC SmartGateway credential diagnostic.
 *
 *   node --env-file-if-exists=.env hdfc-check.js
 *
 * Run this from the `server/` folder with the same environment variables your
 * deployment uses. It reports why SmartGateway is rejecting your credentials.
 *
 * It NEVER prints your API key — only its shape (length, character classes) and
 * the gateway's response. The output is safe to paste into a chat or a ticket.
 */

const KEY = process.env.HDFC_API_KEY || "";
const MERCHANT_ID = process.env.HDFC_MERCHANT_ID || "";
const CLIENT_ID = process.env.HDFC_CLIENT_ID || MERCHANT_ID || "";
const RESELLER_ID = process.env.HDFC_RESELLER_ID || "hdfc_reseller";
const ENV = (process.env.HDFC_ENV || "production").toLowerCase();

const PROD_URL = "https://smartgateway.hdfc.bank.in";
const UAT_URL = "https://smartgateway.hdfcuat.bank.in";

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;

console.log("\n=== HDFC SmartGateway credential check ===\n");

/* ---------- 1. Is anything even set? ---------------------------------- */
if (!KEY || !MERCHANT_ID) {
  console.log(bad("HDFC_API_KEY and/or HDFC_MERCHANT_ID are empty."));
  console.log("The app would run in demo mode. Nothing else to check.\n");
  process.exit(1);
}

/* ---------- 2. Shape of the key (no secrets printed) ------------------ */
const trimmed = KEY.trim();
const looksBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0;

console.log("Config");
console.log(`  HDFC_ENV            ${ENV}  ${dim("→ " + (ENV === "sandbox" ? UAT_URL : PROD_URL))}`);
console.log(`  HDFC_MERCHANT_ID    ${MERCHANT_ID}`);
console.log(`  HDFC_CLIENT_ID      ${CLIENT_ID}${CLIENT_ID === MERCHANT_ID ? dim("  (defaulted to merchant id)") : ""}`);
console.log(`  HDFC_RESELLER_ID    ${RESELLER_ID}`);
console.log(`  HDFC_API_KEY        ${trimmed.length} chars ${dim("(value never printed)")}`);
console.log();

console.log("Key sanity");
if (KEY !== trimmed) {
  console.log(warn("  ! Key has leading/trailing whitespace or a newline."));
  console.log("    A trailing newline is a very common copy-paste error and WILL");
  console.log("    invalidate the key. Re-paste it with no line break.");
} else {
  console.log(ok("  ✓ No stray whitespace."));
}
if (looksBase64) {
  console.log(warn("  ! Key looks like it is ALREADY Base64-encoded."));
  console.log("    This server Base64-encodes the key for you. If you pasted a");
  console.log("    pre-encoded value it gets double-encoded and is rejected.");
  console.log("    Try pasting the RAW key instead.");
} else {
  console.log(ok("  ✓ Does not look pre-encoded (raw key expected — correct)."));
}
console.log();

/* ---------- 3. Try a real session against BOTH environments ----------- */
function headers(key, customerId) {
  return {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    "Content-Type": "application/json",
    "x-merchantid": MERCHANT_ID,
    "x-customerid": customerId,
    "x-resellerid": RESELLER_ID,
  };
}

async function probe(label, baseUrl, key) {
  const orderId = "DIAG" + Date.now().toString().slice(-10);
  const body = {
    order_id: orderId,
    amount: "1.00",
    customer_id: "DIAGCUST" + Date.now().toString().slice(-6),
    customer_email: "diagnostic@example.com",
    customer_phone: "9999999999",
    payment_page_client_id: CLIENT_ID,
    action: "paymentPage",
    currency: "INR",
    return_url: "https://example.com/return",
    description: "credential diagnostic",
    first_name: "Diag",
    last_name: "Check",
  };

  process.stdout.write(`  ${label.padEnd(34)}`);
  try {
    const res = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: headers(key, body.customer_id),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }

    if (res.ok && parsed?.payment_links?.web) {
      console.log(ok("ACCEPTED") + dim("  (payment link returned)"));
      return { accepted: true, baseUrl };
    }
    const info = parsed?.error_info || {};
    const code = info.code || parsed?.error_code || res.status;
    const msg = info.developer_message || info.user_message || text.slice(0, 120);
    console.log(bad(String(code)) + dim(`  ${msg}`));
    return { accepted: false, code: String(code) };
  } catch (err) {
    console.log(bad("NETWORK") + dim(`  ${err.message}`));
    return { accepted: false, code: "NETWORK" };
  }
}

const results = {};
console.log("Live probe (creates a ₹1 session request — no charge, nothing is paid)");
results.prod = await probe("production  smartgateway.hdfc", PROD_URL, trimmed);
results.uat = await probe("sandbox/UAT smartgateway...uat", UAT_URL, trimmed);
console.log();

/* ---------- 4. Verdict ------------------------------------------------ */
console.log("Verdict");
const workingEnv = results.prod.accepted
  ? "production"
  : results.uat.accepted
  ? "sandbox"
  : null;

if (workingEnv) {
  console.log(ok(`  ✓ Your key is valid on: ${workingEnv.toUpperCase()}`));
  if (workingEnv !== ENV) {
    console.log(bad(`  ✗ But HDFC_ENV is set to "${ENV}".`));
    console.log(`    → Set HDFC_ENV=${workingEnv} and redeploy. That is your bug.`);
    if (workingEnv === "sandbox" && CLIENT_ID !== "hdfcmaster") {
      console.log(warn(`    → For sandbox, HDFC_CLIENT_ID is usually "hdfcmaster".`));
    }
  } else {
    console.log(ok("  ✓ HDFC_ENV already matches. Credentials are good."));
  }
} else {
  console.log(bad("  ✗ Rejected on BOTH production and sandbox."));
  console.log("    The key itself is not active. Likely causes, in order:");
  console.log("      1. Copy-paste damage (see 'Key sanity' above).");
  console.log("      2. HDFC has not activated the key yet — merchant onboarding");
  console.log("         may still be pending. This is common and only the bank");
  console.log("         can fix it.");
  console.log("      3. The key belongs to a different merchant id than");
  console.log(`         "${MERCHANT_ID}" — they must match.`);
  console.log("    Ask HDFC to confirm the key is ACTIVE and tied to that");
  console.log("    merchant id, and which environment it is issued for.");
}
console.log();
