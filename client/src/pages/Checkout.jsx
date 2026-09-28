import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCart, useCartCheck } from "../context/CartContext.jsx";
import { api, formatPrice } from "../api.js";
import { apiUrl } from "../config.js";
import { isGatewayUrl, loadRazorpayCheckout, newAttemptId } from "../gateway.js";
import Receipt from "../components/Receipt.jsx";

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
        razorpay_payment_id: "demo_pay_" + Date.now(),
        razorpay_order_id: "demo_order_" + Date.now(),
        demo: true,
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
            <span className="demo-paytm-logo">SmartGateway</span>
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

// While the bank is still confirming, the receipt re-checks every few seconds
// for up to three minutes.
const POLL_MS = 4000;
const POLL_LIMIT = 45;

/* ─── Checkout Page ────────────────────────────────────────────────────────── */
export default function Checkout() {
  const { items, subtotal, clearCart } = useCart();
  const [receipt, setReceipt] = useState(null); // the result page, once there is one
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [payLive, setPayLive] = useState(false);
  const [provider, setProvider] = useState("demo");
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

  const [params, setParams] = useSearchParams();
  // Guards against a second click sending a second payment request before the
  // button has had a chance to disable itself.
  const inFlight = useRef(false);
  // Once a payment has an answer, a closing window mustn't overwrite it.
  const settled = useRef(false);
  const pollTimer = useRef(null);
  const polls = useRef(0);

  // Drops sarees that were deleted or sold out since they were added, so a
  // stale cart can't stop the payment page from opening.
  const { notice: cartNotice, check: checkCart } = useCartCheck();

  // Which gateway takes payments, if any?
  useEffect(() => {
    fetch(apiUrl("/api/payments/config"))
      .then((r) => r.json())
      .then((d) => {
        setPayLive(Boolean(d.configured));
        setProvider(d.provider || "demo");
      })
      .catch(() => setPayLive(false));
  }, []);

  // Coming back to this page with the browser's back button after leaving for
  // the payment page: let the shopper use the form again.
  useEffect(() => {
    const reset = (e) => {
      if (e.persisted) {
        inFlight.current = false;
        setSubmitting(false);
      }
    };
    window.addEventListener("pageshow", reset);
    return () => {
      window.removeEventListener("pageshow", reset);
      clearTimeout(pollTimer.current);
    };
  }, []);

  // The result shown is always the server's, which has asked HDFC directly —
  // never the status in the address bar.
  async function loadReceipt(orderNo, token) {
    try {
      const order = await api.getOrder(orderNo, token);
      setReceipt(order);
      if (order.outcome === "paid") clearCart();
      if (order.outcome === "pending" && (polls.current += 1) < POLL_LIMIT) {
        pollTimer.current = setTimeout(() => loadReceipt(orderNo, token), POLL_MS);
      }
    } catch {
      setError("We couldn't load your order. If you paid, please contact us with your payment details.");
    }
  }

  // Back from the gateway: /checkout?status=…&order=…&t=…
  useEffect(() => {
    const status = params.get("status");
    const orderNo = params.get("order");
    const token = params.get("t");
    if (!status) return;
    // Clear the query so a refresh doesn't re-trigger this.
    setParams({}, { replace: true });
    if (orderNo && token) {
      window.scrollTo({ top: 0 });
      loadReceipt(orderNo, token);
    } else if (status === "failed") {
      setError("Your payment didn't go through. Please try again.");
    } else {
      setError("We couldn't show your receipt here. If you paid, a confirmation email is on its way.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Razorpay opens its own window on this page. Nothing it hands back is
  // believed until the server has checked it with Razorpay.
  async function payWithRazorpay(session) {
    const Razorpay = await loadRazorpayCheckout();
    const done = (result) => {
      settled.current = true;
      setReceipt(result);
      if (result.outcome === "paid") clearCart();
      setSubmitting(false);
      inFlight.current = false;
      window.scrollTo({ top: 0 });
    };
    const stop = (message) => {
      setError(message);
      setSubmitting(false);
      inFlight.current = false;
    };
    const close = async (reason) => {
      if (settled.current) return;
      try {
        done(await api.razorpayCancel({ orderNo: session.orderNo, token: session.token, reason }));
      } catch (err) {
        stop(err.message || "The payment was not completed.");
      }
    };

    const checkout = new Razorpay({
      key: session.keyId,
      order_id: session.razorpayOrderId,
      amount: session.amount,
      currency: session.currency,
      name: session.name,
      description: `Order ${session.orderNo}`,
      prefill: session.prefill,
      notes: { order_no: session.orderNo },
      theme: { color: "#6d1f3a" },
      handler: async (response) => {
        try {
          done(
            await api.razorpayVerify({
              orderNo: session.orderNo,
              token: session.token,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            })
          );
        } catch (err) {
          stop(err.message || "We couldn't confirm that payment. Please contact us before paying again.");
        }
      },
      modal: { ondismiss: () => close("the payment window was closed") },
    });
    checkout.on("payment.failed", (response) =>
      close(response?.error?.description || "the payment failed")
    );
    checkout.open();
  }

  async function placeOrder(e) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    settled.current = false;
    setError("");
    setSubmitting(true);
    try {
      const attemptId = newAttemptId();
      const data =
        provider === "razorpay"
          ? await api.razorpayOrder(items, customerDetails(), attemptId)
          : await api.createHdfcSession(items, customerDetails(), attemptId);

      // No keys configured → show the demo payment modal instead.
      if (!data.configured) {
        setDemoModal({ amount: Math.round(total * 100) });
        setSubmitting(false);
        inFlight.current = false;
        return;
      }

      if (data.provider === "razorpay") {
        await payWithRazorpay(data);
        return;
      }

      // HDFC: go to its hosted payment page, and nowhere else.
      if (!data.paymentLink || !isGatewayUrl(data.paymentLink)) {
        throw new Error("We couldn't start the payment. Please try again.");
      }
      window.location.assign(data.paymentLink);
    } catch (err) {
      inFlight.current = false;
      setError(err.message || "Could not place order");
      setSubmitting(false);
      // If the server turned an item down, refresh the cart. When that removes
      // something, the cart notice explains it, so drop the duplicate error.
      const dropped = await checkCart();
      if (dropped.length) setError("");
    }
  }

  // Called when the demo modal payment succeeds (gateway not configured).
  async function handleDemoSuccess() {
    setDemoModal(null);
    setSubmitting(true);
    try {
      const order = await api.createOrder({
        items,
        customer: customerDetails(),
      });
      setReceipt(order);
      clearCart();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message || "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <Receipt
        order={receipt}
        onRetry={() => {
          setReceipt(null);
          setError("");
        }}
      />
    );
  }

  if (!items.length) {
    return (
      <div className="page">
        <div className="empty-state">
          <h1>Nothing to check out</h1>
          <p>{error || cartNotice || "Your cart is empty."}</p>
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
                    {!payLive
                      ? "Demo mode"
                      : provider === "razorpay"
                        ? "Secured by Razorpay"
                        : "Secured by HDFC SmartGateway"}
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
            {cartNotice && <div className="alert">{cartNotice}</div>}
            {error && <div className="alert">{error}</div>}
            <button type="submit" className="btn btn-primary full" disabled={submitting}>
              {submitting
                ? "Processing…"
                : `Pay ${formatPrice(total)}`}
            </button>
            <p className="sum-note center">
              {!payLive
                ? "A demo payment screen will open to simulate the flow."
                : provider === "razorpay"
                  ? "A secure Razorpay window will open to take the payment."
                  : "You'll be redirected to HDFC's secure payment page."}
            </p>
          </aside>
        </form>
      </div>
    </>
  );
}
