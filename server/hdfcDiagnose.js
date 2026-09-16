/**
 * Works out why HDFC SmartGateway is refusing the configured credentials.
 *
 * It never moves money and never creates anything: it asks each environment
 * for the status of an order id that cannot exist. A key the gateway accepts
 * gets back "order not found"; a key it rejects gets UNAUTHORIZED. Each
 * environment is tried with and without the x-resellerid header. HDFC's docs
 * require it (value hdfc_reseller); trying both shows if it is ever the cause.
 *
 * The API key itself is never returned — only its length and shape.
 * Used by the admin panel (GET /api/admin/payments/diagnose) and hdfc-check.js.
 */

export const HDFC_URLS = {
  production: "https://smartgateway.hdfc.bank.in",
  sandbox: "https://smartgateway.hdfcuat.bank.in",
};

async function probe(env, baseUrl, { apiKey, merchantId, resellerId }) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    "Content-Type": "application/json",
    "x-merchantid": merchantId,
    "x-customerid": "DIAGCHECK",
  };
  if (resellerId) headers["x-resellerid"] = resellerId;

  const orderId = "DIAG" + Date.now().toString(36).toUpperCase();
  const base = { env, resellerHeader: Boolean(resellerId) };
  try {
    const res = await fetch(`${baseUrl}/orders/${orderId}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON reply */
    }
    const info = body?.error_info || {};
    const code = String(info.code || body?.error_code || res.status);
    const message =
      info.developer_message ||
      info.user_message ||
      body?.error_message ||
      text.slice(0, 160);

    const rejected =
      res.status === 401 ||
      /UNAUTHORIZED|access_denied/i.test(code) ||
      /invalid api key/i.test(message);
    // Any reply from HDFC other than an auth refusal means the key got past
    // authentication ("order not found" is the expected answer). Only a
    // network failure, in the catch below, is inconclusive.
    const result = rejected ? "rejected" : "accepted";
    return { ...base, result, status: res.status, code, message };
  } catch (err) {
    return { ...base, result: "error", status: 0, code: "NETWORK", message: err.message };
  }
}

export async function diagnoseHdfc({
  apiKey = "",
  merchantId = "",
  clientId = "",
  resellerId = "",
  env = "production",
}) {
  const report = {
    configured: Boolean(apiKey && merchantId),
    env,
    merchantId,
    clientId: clientId || merchantId,
    resellerId: resellerId || null,
    key: {
      length: apiKey.length,
      looksBase64:
        /^[A-Za-z0-9+/]+={0,2}$/.test(apiKey) && apiKey.length % 4 === 0 && /=$/.test(apiKey),
    },
    probes: [],
    ok: false,
    verdict: "",
    steps: [],
  };

  if (!report.configured) {
    report.verdict = "No HDFC credentials are set, so checkout runs in demo mode.";
    report.steps.push("Set HDFC_API_KEY and HDFC_MERCHANT_ID on the server.");
    return report;
  }

  const jobs = [];
  for (const [name, url] of Object.entries(HDFC_URLS)) {
    jobs.push(probe(name, url, { apiKey, merchantId, resellerId }));
    if (resellerId) jobs.push(probe(name, url, { apiKey, merchantId, resellerId: "" }));
  }
  report.probes = await Promise.all(jobs);

  const accepted = report.probes.filter((p) => p.result === "accepted");
  const envsAccepting = [...new Set(accepted.map((p) => p.env))];
  const inConfiguredEnv = accepted.filter((p) => p.env === env);

  if (report.probes.every((p) => p.result === "error")) {
    report.verdict = "The server could not reach HDFC SmartGateway at all.";
    report.steps.push("This is a network problem, not your key. Try again in a few minutes.");
  } else if (!accepted.length) {
    report.verdict = "HDFC rejects this API key in both sandbox and production.";
    if (report.key.looksBase64) {
      report.steps.push(
        "The key looks already Base64-encoded. Paste the raw key from the dashboard; the server encodes it for you."
      );
    }
    report.steps.push(
      "In the SmartGateway dashboard go to Security → Create New API Key, and copy the API key from the config.json it gives you."
    );
    report.steps.push(
      `Make sure that key belongs to merchant id "${merchantId}" — the two must come from the same account.`
    );
    report.steps.push(
      "If a freshly created key is still rejected, ask HDFC to confirm the key is active; onboarding may not be finished."
    );
  } else if (!inConfiguredEnv.length) {
    const right = envsAccepting[0];
    report.verdict = `Your key works on ${right.toUpperCase()}, but the server is set to ${env.toUpperCase()}.`;
    report.steps.push(`Set HDFC_ENV=${right} on the server and redeploy.`);
    if (right === "sandbox" && report.clientId !== "hdfcmaster") {
      report.steps.push('For sandbox, also set HDFC_CLIENT_ID=hdfcmaster.');
    }
    if (right === "sandbox") {
      report.steps.push(
        "Sandbox takes test payments only. Ask HDFC for production credentials before going live."
      );
    }
  } else if (resellerId && inConfiguredEnv.every((p) => !p.resellerHeader)) {
    report.verdict =
      "Your key is valid, but HDFC refuses it when the x-resellerid header is sent.";
    report.steps.push(
      "HDFC's docs say this header is required, so send this result to HDFC support and ask them to check the merchant account."
    );
  } else {
    report.ok = true;
    report.verdict = `Your key is accepted on ${env.toUpperCase()}. The credentials are fine.`;
    report.steps.push(
      "If checkout still fails, the session request itself is the problem — see the last gateway error below."
    );
  }

  return report;
}
