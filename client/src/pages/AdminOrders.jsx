import { useEffect, useMemo, useState } from "react";
import { api, formatPrice } from "../api.js";

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

  const stats = useMemo(() => {
    const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
    return { count: orders.length, revenue };
  }, [orders]);

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
          <span className="stat-num">{formatPrice(stats.revenue)}</span>
          <span className="stat-label">Total revenue</span>
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
                  <strong>#{o.orderNo}</strong>
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
                    {o.items.map((i) => (
                      <div key={i.id} className="ode-item">
                        <span>{i.name} × {i.qty}</span>
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
                    <p className="ode-address">
                      {o.customer?.name}<br />
                      {o.customer?.phone}<br />
                      {o.customer?.email}<br />
                      {o.customer?.address}<br />
                      {o.customer?.city} — {o.customer?.pincode}
                    </p>
                    {o.paymentId && (
                      <p className="ode-pid">Paytm TXNID: {o.paymentId}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
