/**
 * HDFC SmartGateway credential check, from the command line.
 *
 *   cd server && node --env-file-if-exists=.env hdfc-check.js
 *
 * Runs the same check as the admin panel's "Check payment gateway" button,
 * using whatever HDFC_* variables are in your environment. It makes no payment,
 * creates nothing, and never prints the API key.
 */
import { diagnoseHdfc } from "./hdfcDiagnose.js";

const merchantId = (process.env.HDFC_MERCHANT_ID || "").trim();
const report = await diagnoseHdfc({
  apiKey: (process.env.HDFC_API_KEY || "").trim(),
  merchantId,
  clientId: (process.env.HDFC_CLIENT_ID || "").trim() || merchantId,
  resellerId: (process.env.HDFC_RESELLER_ID || "").trim() || "hdfc_reseller",
  env: (process.env.HDFC_ENV || "production").trim().toLowerCase(),
});

console.log("\n=== HDFC SmartGateway credential check ===\n");
console.log(`  environment   ${report.env}`);
console.log(`  merchant id   ${report.merchantId || "(not set)"}`);
console.log(`  client id     ${report.clientId || "(not set)"}`);
console.log(`  API key       ${report.key.length} characters (never printed)`);

if (report.probes.length) {
  console.log("\n  probes");
  for (const p of report.probes) {
    const label = p.env + (p.resellerHeader ? "" : " (no reseller header)");
    console.log(`    ${label.padEnd(32)} ${p.result.padEnd(9)} ${p.code}  ${p.message}`);
  }
}

console.log(`\n  ${report.verdict}`);
report.steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
console.log();
process.exit(report.ok ? 0 : 1);
