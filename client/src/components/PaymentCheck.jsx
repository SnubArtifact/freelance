import { useState } from "react";
import { api } from "../api.js";

// Admin-only check of the HDFC SmartGateway setup. Runs on demand rather than
// on load, because each check makes a few calls to HDFC.
export default function PaymentCheck() {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    try {
      setReport(await api.diagnosePayments());
    } catch (err) {
      setError(err.message || "Could not run the check");
    } finally {
      setRunning(false);
    }
  }

  // HDFC returns the shopper to CLIENT_URL. If that isn't the site they paid
  // on, they land on another address and their cart is left behind.
  const here = window.location.origin;
  const clientMismatch = report?.configured && report.clientUrl !== here;

  return (
    <div className="panel pay-check">
      <div className="pay-check-head">
        <div>
          <h3>Payment gateway</h3>
          <p className="muted">Checks your HDFC SmartGateway key. No payment is made.</p>
        </div>
        <button className="btn btn-ghost small" onClick={run} disabled={running}>
          {running ? "Checking…" : report ? "Check again" : "Check payment gateway"}
        </button>
      </div>

      {error && <div className="alert">{error}</div>}

      {report && (
        <>
          <div className={`pay-check-verdict ${report.ok && !clientMismatch ? "ok" : "bad"}`}>
            {report.verdict}
          </div>

          {(report.steps.length > 0 || clientMismatch) && (
            <ol>
              {report.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
              {clientMismatch && (
                <li>
                  CLIENT_URL is "{report.clientUrl}", but this site is "{here}". Shoppers
                  are sent to CLIENT_URL after paying — set it to {here} and redeploy.
                </li>
              )}
            </ol>
          )}

          <dl className="pay-check-grid">
            <dt>Environment</dt>
            <dd>{report.env} · {report.baseUrl}</dd>
            <dt>Merchant id</dt>
            <dd>{report.merchantId || "—"}</dd>
            <dt>Client id</dt>
            <dd>{report.clientId || "—"}</dd>
            <dt>API key</dt>
            <dd>{report.key.length} characters (never shown)</dd>
            <dt>Return address</dt>
            <dd>{report.publicServerUrl}</dd>
            <dt>Last gateway error</dt>
            <dd>
              {report.lastError
                ? `${new Date(report.lastError.at).toLocaleString("en-IN")} — ${report.lastError.message}`
                : "None since the server last started"}
            </dd>
          </dl>

          {report.probes.length > 0 && (
            <div className="pay-check-probes">
              {report.probes.map((p) => (
                <div key={`${p.env}-${p.resellerHeader}`}>
                  {p.env}
                  {p.resellerHeader ? "" : " (without reseller header)"}: {p.result} · {p.code}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
