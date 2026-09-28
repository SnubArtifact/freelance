import { useEffect, useMemo, useState } from "react";
import { api, formatPrice } from "../api.js";

const STEP_LABELS = {
  order_created: "Order created",
  session_created: "Sent to HDFC payment page",
  session_failed: "Payment could not start",
  shopper_returned: "Shopper came back from HDFC",
  status_checked: "Status confirmed with HDFC",
  marked_paid: "Marked paid",
  tamper_suspected: "⚠ Possible tampering",
};

// One line of detail for a payment-log entry.
function describe({ kind, detail: d = {} }) {
  switch (kind) {
    case "order_created":
      return formatPrice(d.total);
    case "session_created":
      return d.payment_page_host || "";
    case "session_failed":
      return d.message || "";
    case "shopper_returned":
      return `signature ${d.signature}; return code ${d.return_code}`;
    case "status_checked":
      return [d.status, d.amount != null && `₹${d.amount}`, d.txn_id, d.source && `(${d.source})`]
        .filter(Boolean)
        .join(" · ");
    case "marked_paid":
      return d.source || "";
    case "tamper_suspected":
      return d.reason || "";
    default:
      return JSON.stringify(d).slice(0, 140);
  }
}

const at = (ms) =>
  new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Everything recorded about an order's payment, and a button to ask HDFC for
// its status now. HDFC's full reply is shown so it can be copied for the bank.
function PaymentLog({ order, onChecked }) {
  const [steps, setSteps] = useState(null);
  const [checking, setChecking] = useState(false);
  const [reply, setReply] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    api.adminOrderEvents(order.orderNo).then(setSteps).catch((e) => setError(e.message));
  };
  useEffect(load, [order.orderNo]);

  async function check() {
    setChecking(true);
    setError("");
    try {
      const { order: updated, response } = await api.adminCheckOrder(order.orderNo);
      setReply(response);
      onChecked(updated);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  }

  const viaGateway = Boolean(order.customer?.customerId);

  return (
    <div className="ode-col ode-log">
      <h4>Payment log</h4>
      {steps === null ? (
        <p className="muted">Loading…</p>
      ) : steps.length === 0 ? (
        <p className="muted">No payment steps recorded.</p>
      ) : (
        <ol className="pay-log">
          {steps.map((step, i) => (
            <li key={i} className={step.kind === "tamper_suspected" ? "warn" : ""}>
              <span className="pay-log-when">{at(step.at)}</span>
              <span className="pay-log-what">{STEP_LABELS[step.kind] || step.kind}</span>
              <span className="pay-log-detail">{describe(step)}</span>
            </li>
          ))}
        </ol>
      )}

      {viaGateway && (
        <button type="button" className="btn btn-ghost small" onClick={check} disabled={checking}>
          {checking ? "Asking HDFC…" : "Check status with HDFC"}
        </button>
      )}
      {error && <p className="alert">{error}</p>}
      {reply ? (
        <>
          <p className="muted">HDFC's Order Status reply, just now:</p>
          <pre className="pay-reply">{JSON.stringify(reply, null, 2)}</pre>
        </>
      ) : (
        order.gatewayResponse && (
          <details>
            <summary>Last Order Status reply from HDFC</summary>
            <pre className="pay-reply">{JSON.stringify(order.gatewayResponse, null, 2)}</pre>
          </details>
        )
      )}
    </div>
  );
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api
      .adminOrders()
      .then(setOrders)
      .catch((e) => setError(e.message || "Could not load orders"))
      .finally(() => setLoading(false));
  }, []);

  // Revenue counts real, paid orders only — not test, pending or failed ones.
  const stats = useMemo(() => {
    const paid = orders.filter((o) => o.paymentStatus?.startsWith("Paid") && !o.isTest);
    return {
      count: orders.length,
      paid: paid.length,
      revenue: paid.reduce((s, o) => s + (o.total || 0), 0),
    };
  }, [orders]);

  const replaceOrder = (updated) =>
    setOrders((list) => list.map((o) => (o.orderNo === updated.orderNo ? updated : o)));

  if (loading) return <p className="empty">Loading orders…</p>;
  if (error) return <p className="empty">{error}</p>;

  if (!orders.length) {
    return (
      <div className="panel">
        <p className="empty">No orders yet. They'll appear here as customers buy.</p>
      </div>
    );
  }

  return (
    <div className="admin-orders">
      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-num">{stats.count}</span>
          <span className="stat-label">Total orders</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{stats.paid}</span>
          <span className="stat-label">Paid (not test)</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{formatPrice(stats.revenue)}</span>
          <span className="stat-label">Revenue (paid)</span>
        </div>
      </div>

      <div className="panel">
        <div className="order-table-head">
          <span>Order</span>
          <span>Customer</span>
          <span>Items</span>
          <span>Payment</span>
          <span>Total</span>
        </div>

        {orders.map((o) => {
          const date = new Date(o.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const open = expanded === o.id;
          return (
            <div key={o.id} className={`order-table-row ${open ? "open" : ""}`}>
              <button
                className="order-table-summary"
                onClick={() => setExpanded(open ? null : o.id)}
              >
                <span className="ot-order">
                  <strong>
                    #{o.orderNo}
                    {o.isTest && <em className="tag test-tag">TEST</em>}
                  </strong>
                  <em>{date}</em>
                </span>
                <span className="ot-customer">
                  {o.customer?.name || "—"}
                  <em>{o.customer?.email || ""}</em>
                </span>
                <span className="ot-items">{o.items.length} item(s)</span>
                <span className="ot-pay">
                  <span className="pay-tag upi">
                    Online
                  </span>
                  <em>{o.paymentStatus}</em>
                </span>
                <span className="ot-total">{formatPrice(o.total)}</span>
              </button>

              {open && (
                <div className="order-detail-expand">
                  <div className="ode-col">
                    <h4>Items</h4>
                    {o.items.map((i, n) => (
                      <div key={n} className="ode-item">
                        <span>{i.name}{i.color ? ` (${i.color})` : ""} × {i.qty}</span>
                        <span>{formatPrice(i.price * i.qty)}</span>
                      </div>
                    ))}
                    <div className="ode-item ode-total">
                      <span>Total ({o.shippingFee ? "incl. shipping" : "free shipping"})</span>
                      <span>{formatPrice(o.total)}</span>
                    </div>
                  </div>
                  <div className="ode-col">
                    <h4>Ship to</h4>
                    {o.isTest && (
                      <p className="alert">Test order placed during the bank's testing — do not ship.</p>
                    )}
                    <p className="ode-address">
                      {o.customer?.name}<br />
                      {o.customer?.phone}<br />
                      {o.customer?.email}<br />
                      {o.customer?.address}<br />
                      {o.customer?.city} — {o.customer?.pincode}
                    </p>
                    {o.paymentId && (
                      <p className="ode-pid">Payment ID: {o.paymentId}</p>
                    )}
                  </div>
                  <PaymentLog order={o} onChecked={replaceOrder} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
