import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { api, formatPrice } from "../api.js";
import { apiUrl } from "../config.js";
import { loadPaytmSDK, openPaytm } from "../paytm.js";

/* ─── Demo Payment Modal ───────────────────────────────────────────────────── */
function DemoPaymentModal({ amount, onSuccess, onCancel }) {
  const [step, setStep] = useState("options"); // options | upi | card | nb
  const [upiId, setUpiId] = useState("");
  const [processing, setProcessing] = useState(false);
  const [cardNo, setCardNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  function handlePay() {
    setProcessing(true);
    setTimeout(() => {
      onSuccess({
        STATUS: "TXN_SUCCESS",
        TXNID: "DEMO_" + Date.now(),
        ORDERID: "DEMO_ORDER",
        RESPMSG: "Txn Success",
        CHECKSUMHASH: "DEMO_CHECKSUM",
      });
    }, 1800);
  }

  const paymentMethods = [
    { id: "upi", icon: "📱", label: "UPI" },
    { id: "card", icon: "💳", label: "Credit / Debit Card" },
    { id: "nb", icon: "🏦", label: "Net Banking" },
  ];

  return (
    <div className="demo-modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="demo-modal">
        {/* Header */}
        <div className="demo-modal-header">
          <div className="demo-modal-brand">
            <span className="demo-paytm-logo">Paytm</span>
            <span className="demo-modal-badge">Demo Mode</span>
          </div>
          <button className="demo-modal-close" onClick={onCancel} aria-label="Close">✕</button>
        </div>

        <div className="demo-modal-amount">
          Pay <strong>{formatPrice(amount / 100)}</strong>
        </div>

        {/* Step: choose method */}
        {step === "options" && (
          <div className="demo-modal-body">
            <p className="demo-modal-hint">Choose a payment method</p>
            <div className="demo-pay-methods">
              {paymentMethods.map((m) => (
                <button
                  key={m.id}
                  className="demo-pay-method-btn"
                  onClick={() => setStep(m.id)}
                >
                  <span className="demo-method-icon">{m.icon}</span>
                  <span>{m.label}</span>
                  <span className="demo-method-arrow">›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: UPI */}
        {step === "upi" && (
          <div className="demo-modal-body">
            <button className="demo-back-btn" onClick={() => setStep("options")}>‹ Back</button>
            <p className="demo-modal-hint">Enter your UPI ID</p>
            <input
              className="demo-input"
              placeholder="yourname@upi"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              disabled={processing}
            />
            <button
              className="demo-pay-btn"
              onClick={handlePay}
              disabled={processing || !upiId.trim()}
            >
              {processing ? <span className="demo-spinner" /> : `Pay ${formatPrice(amount / 100)}`}
            </button>
          </div>
        )}

        {/* Step: Card */}
        {step === "card" && (
          <div className="demo-modal-body">
            <button className="demo-back-btn" onClick={() => setStep("options")}>‹ Back</button>
            <p className="demo-modal-hint">Enter card details</p>
            <input
              className="demo-input"
              placeholder="Card Number"
              maxLength={19}
              value={cardNo}
              onChange={(e) => setCardNo(e.target.value.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim())}
              disabled={processing}
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                className="demo-input"
                placeholder="MM / YY"
                maxLength={5}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                disabled={processing}
              />
              <input
                className="demo-input"
                placeholder="CVV"
                maxLength={3}
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))}
                disabled={processing}
                type="password"
              />
            </div>
            <button
              className="demo-pay-btn"
              onClick={handlePay}
              disabled={processing || cardNo.length < 19 || !expiry || cvv.length < 3}
            >
              {processing ? <span className="demo-spinner" /> : `Pay ${formatPrice(amount / 100)}`}
            </button>
          </div>
        )}

        {/* Step: Net Banking */}
        {step === "nb" && (
          <div className="demo-modal-body">
            <button className="demo-back-btn" onClick={() => setStep("options")}>‹ Back</button>
            <p className="demo-modal-hint">Select your bank</p>
            <div className="demo-bank-grid">
              {["SBI", "HDFC", "ICICI", "Axis", "Kotak", "PNB"].map((bank) => (
                <button key={bank} className="demo-bank-btn" onClick={handlePay} disabled={processing}>
                  {processing ? <span className="demo-spinner" /> : bank}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="demo-modal-footer">
          🔒 This is a demo — no real payment is processed
        </p>
      </div>
    </div>
  );
}

/* ─── Checkout Page ────────────────────────────────────────────────────────── */
export default function Checkout() {
  const { items, subtotal, clearCart } = useCart();
  const navigate = useNavigate();
  const [placedOrder, setPlacedOrder] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [payLive, setPayLive] = useState(false);
  const [demoModal, setDemoModal] = useState(null); // { amount } when open
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    pincode: "",
    payment: "upi",
  });

  // Is the real Paytm gateway configured on the server?
  useEffect(() => {
    fetch(apiUrl("/api/payments/config"))
      .then((r) => r.json())
      .then((d) => setPayLive(Boolean(d.configured)))
      .catch(() => setPayLive(false));
  }, []);

  const shipping = subtotal > 4999 ? 0 : 99;
  const total = subtotal + shipping;

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const customerDetails = () => ({
    name: form.name,
    email: form.email,
    phone: form.phone,
    address: form.address,
    city: form.city,
    pincode: form.pincode,
  });

  async function saveOrder(extra = {}) {
    const order = await api.createOrder({
      items,
      customer: customerDetails(),
      payment: form.payment,
      ...extra,
    });
    setPlacedOrder(order);
    clearCart();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function placeOrder(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      // Online payment — initiate a Paytm transaction on the server.
      const paytmData = await api.initiatePaytmPayment(items);

      // No keys configured → show demo payment modal instead of skipping.
      if (!paytmData.configured) {
        setDemoModal({ amount: paytmData.amount });
        setSubmitting(false);
        return;
      }

      // Real Paytm gateway configured — load SDK and open overlay.
      const loaded = await loadPaytmSDK(paytmData.mid);
      if (!loaded) throw new Error("Could not load the payment gateway");

      await new Promise((resolve, reject) => {
        openPaytm({
          mid: paytmData.mid,
          txnToken: paytmData.txnToken,
          orderId: paytmData.orderId,
          amount: (paytmData.amount / 100).toFixed(2),
          onSuccess: async (response) => {
            try {
              await saveOrder({ paytm: response });
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          onCancel: () => {
            setSubmitting(false);
            reject(new Error("Payment cancelled"));
          },
          onError: (msg) => {
            reject(new Error(msg || "Payment failed"));
          },
        });
      });
    } catch (err) {
      if (err.message !== "Payment cancelled") {
        setError(err.message || "Could not place order");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Called when demo modal payment succeeds
  async function handleDemoSuccess(response) {
    setDemoModal(null);
    setSubmitting(true);
    try {
      await saveOrder({ paytm: response });
    } catch (err) {
      setError(err.message || "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  // Order placed successfully
  if (placedOrder) {
    return (
      <div className="page">
        <div className="empty-state success">
          <div className="success-mark">✓</div>
          <h1>Order placed!</h1>
          <p>
            Thank you, {placedOrder.customer.name || "friend"}. Your order
            <strong> #{placedOrder.orderNo} </strong> is confirmed.
          </p>
          <p className="muted">
            {placedOrder.emailSent
              ? `A confirmation email is on its way to ${placedOrder.customer.email}.`
              : `We'll send your confirmation to ${placedOrder.customer.email}.`}
          </p>
          <div className="checkout-cta">
            <button className="btn btn-primary" onClick={() => navigate("/collection")}>
              Continue Shopping
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="page">
        <div className="empty-state">
          <h1>Nothing to check out</h1>
          <p>Your cart is empty.</p>
          <Link to="/collection" className="btn btn-primary">Browse Collection</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {demoModal && (
        <DemoPaymentModal
          amount={demoModal.amount}
          onSuccess={handleDemoSuccess}
          onCancel={() => { setDemoModal(null); setSubmitting(false); }}
        />
      )}

      <div className="page checkout">
        <div className="page-head">
          <h1>Checkout</h1>
          <p>No account needed — just your details and you're done.</p>
        </div>

        <form className="checkout-grid" onSubmit={placeOrder}>
          <div className="checkout-form">
            <h3>Contact Details</h3>
            <div className="field-row">
              <label className="field">
                <span>Full name</span>
                <input required value={form.name}
                  onChange={(e) => update("name", e.target.value)} />
              </label>
              <label className="field">
                <span>Phone</span>
                <input required value={form.phone}
                  onChange={(e) => update("phone", e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Email (for order confirmation)</span>
              <input type="email" required value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="you@example.com" />
            </label>

            <h3>Shipping Address</h3>
            <label className="field">
              <span>Address</span>
              <textarea required rows={3} value={form.address}
                onChange={(e) => update("address", e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>City</span>
                <input required value={form.city}
                  onChange={(e) => update("city", e.target.value)} />
              </label>
              <label className="field">
                <span>PIN code</span>
                <input required value={form.pincode}
                  onChange={(e) => update("pincode", e.target.value)} />
              </label>
            </div>

            <h3>Payment</h3>
            <div className="pay-options">
              <div className="pay active">
                <span className="pay-label">
                  Online Payment (UPI, Card, Netbanking)
                  <span className="pay-badge">
                    {payLive ? "Secured by Paytm" : "Demo mode"}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <aside className="checkout-summary">
            <h3>Your Order</h3>
            <div className="mini-items">
              {items.map((i) => (
                <div key={i.id} className="mini-row">
                  <span className="mini-name">{i.name} × {i.qty}</span>
                  <span>{formatPrice(i.price * i.qty)}</span>
                </div>
              ))}
            </div>
            <div className="sum-row">
              <span>Subtotal</span><span>{formatPrice(subtotal)}</span>
            </div>
            <div className="sum-row">
              <span>Shipping</span>
              <span>{shipping === 0 ? "Free" : formatPrice(shipping)}</span>
            </div>
            <div className="sum-row total">
              <span>Total</span><span>{formatPrice(total)}</span>
            </div>
            {error && <div className="alert">{error}</div>}
            <button type="submit" className="btn btn-primary full" disabled={submitting}>
              {submitting
                ? "Processing…"
                : `Pay ${formatPrice(total)}`}
            </button>
            <p className="sum-note center">
              {payLive
                ? "You'll be redirected to Paytm's secure checkout."
                : "A demo payment screen will open to simulate the flow."}
            </p>
          </aside>
        </form>
      </div>
    </>
  );
}
