import { Link } from "react-router-dom";
import { formatPrice } from "../api.js";

const when = (ms) =>
  ms
    ? new Date(ms).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "";

const HEADINGS = {
  paid: "Payment successful",
  pending: "Confirming your payment…",
  failed: "Payment not completed",
};

/**
 * The payment result page. It shows what the bank requires every shopper to
 * see — the order number, the amount, and a clear success or failure message
 * — taken from the shop's database after the server has confirmed the payment
 * with HDFC, and it can be printed as a receipt.
 */
export default function Receipt({ order, onRetry }) {
  const { outcome } = order;
  const name = order.customer?.name;
  const email = order.customer?.email;

  return (
    <div className="page">
      <section className={`receipt receipt-${outcome}`} aria-live="polite">
        {order.isTest && (
          <p className="receipt-test">Test order — it will not be shipped.</p>
        )}
        <div className="receipt-mark" aria-hidden="true">
          {outcome === "paid" ? "✓" : outcome === "pending" ? <span className="demo-spinner" /> : "!"}
        </div>
        <h1>{HEADINGS[outcome]}</h1>
        <p className="receipt-lead">
          {outcome === "paid" &&
            `Thank you${name ? `, ${name}` : ""}. Your order is confirmed${
              email ? ` and a confirmation is on its way to ${email}` : ""
            }.`}
          {outcome === "pending" &&
            "Your bank is still confirming the payment. This page updates by itself — please don't pay again."}
          {outcome === "failed" &&
            "Your payment didn't go through, so the order hasn't been placed. If money was deducted, your bank will return it; please contact us with this order number."}
        </p>

        <dl className="receipt-facts">
          <dt>Order number</dt>
          <dd>{order.orderNo}</dd>
          <dt>{outcome === "paid" ? "Amount paid" : "Amount"}</dt>
          <dd>{formatPrice(order.total)}</dd>
          {outcome === "paid" && order.paymentId && (
            <>
              <dt>Transaction ID</dt>
              <dd>{order.paymentId}</dd>
            </>
          )}
          <dt>{outcome === "paid" ? "Paid on" : "Placed on"}</dt>
          <dd>{when(outcome === "paid" ? order.paidAt || order.createdAt : order.createdAt)}</dd>
          <dt>Status</dt>
          <dd>{order.paymentStatus}</dd>
        </dl>

        {order.items?.length > 0 && (
          <table className="receipt-items">
            <tbody>
              {order.items.map((item, n) => (
                <tr key={n}>
                  <td>
                    {item.name}{item.color ? ` (${item.color})` : ""} × {item.qty}
                  </td>
                  <td>{formatPrice(item.price * item.qty)}</td>
                </tr>
              ))}
              <tr>
                <td>Shipping</td>
                <td>{order.shippingFee ? formatPrice(order.shippingFee) : "Free"}</td>
              </tr>
              <tr className="receipt-total">
                <td>Total</td>
                <td>{formatPrice(order.total)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="receipt-actions">
          {outcome === "paid" && (
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              Print receipt
            </button>
          )}
          {outcome === "failed" && (
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Try again
            </button>
          )}
          <Link to="/collection" className={`btn ${outcome === "failed" ? "btn-ghost" : "btn-primary"}`}>
            Continue shopping
          </Link>
        </div>
      </section>
    </div>
  );
}
