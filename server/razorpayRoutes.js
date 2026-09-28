import {
  interpretPayment,
  pickPayment,
  toPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay.js";

/**
 * The Razorpay half of checkout. The browser opens Razorpay's own payment
 * window, so there is no redirect to guard — but nothing it sends back is
 * trusted either:
 *
 *  - the amount comes from the shop's database, never the browser;
 *  - the signature Razorpay returns is checked with the key secret, and a
 *    wrong one is refused;
 *  - the payment is then read back from Razorpay's API and must be captured,
 *    for this order, for this exact amount;
 *  - a webhook covers the shopper who pays and closes the tab.
 */
export function razorpayPayments(ctx) {
  const { shop, tokens, client, keyId, keySecret, webhookSecret, shopName, sendOrderEmail, prepareOrder, publicReceipt, wrap } = ctx;

  // Applies Razorpay's own record of a payment to one of our orders. Safe to
  // run repeatedly: an order is completed once, and a paid one is never undone.
  async function applyPayment(order, payment, { source }) {
    const amountPaise = toPaise(order.total);
    const verdict = interpretPayment(payment, { razorpayOrderId: order.gatewayRef, amountPaise });

    // The bank is holding the money but it hasn't been taken: take it.
    if (verdict.outcome === "pending" && payment?.status === "authorized") {
      try {
        payment = await client.capture(payment.id, amountPaise);
        await shop.logEvent(order.orderNo, "status_checked", {
          source,
          status: payment.status,
          note: "captured an authorised payment",
        });
        return applyPayment(order, payment, { source });
      } catch (err) {
        await shop.logEvent(order.orderNo, "status_checked", {
          source,
          status: "authorized",
          note: `capture failed: ${err.message}`,
        });
      }
    }

    await shop.logEvent(order.orderNo, "status_checked", {
      source,
      status: verdict.status,
      amount: payment?.amount ?? null,
      payment_id: payment?.id ?? null,
      method: payment?.method ?? null,
      outcome: verdict.outcome,
    });

    if (verdict.outcome === "paid") {
      const completed = await shop.completePayment(order.orderNo, {
        paymentId: payment.id,
        gatewayStatus: verdict.status,
        gatewayResponse: payment,
      });
      if (completed) {
        await shop.logEvent(order.orderNo, "marked_paid", { source });
        await sendOrderEmail(completed);
        return { outcome: "paid", order: completed };
      }
      return { outcome: "paid", order: await shop.getOrderByOrderNo(order.orderNo) };
    }

    if (verdict.outcome === "review") {
      await shop.logEvent(order.orderNo, "tamper_suspected", { reason: verdict.reason });
    }
    const unpaid =
      verdict.outcome === "failed"
        ? {
            paymentStatus: `Not paid (${payment?.error_description || verdict.status})`,
            status: "Payment Failed",
          }
        : verdict.outcome === "review"
          ? { paymentStatus: `Needs review (${verdict.reason})`, status: "Payment Review" }
          : { paymentStatus: `Pending (${verdict.status})`, status: "Payment Pending" };
    const updated = await shop.recordUnpaid(order.orderNo, {
      ...unpaid,
      gatewayStatus: verdict.status,
      gatewayResponse: payment ?? null,
    });
    return {
      outcome: verdict.outcome === "failed" ? "failed" : "pending",
      order: updated || (await shop.getOrderByOrderNo(order.orderNo)),
    };
  }

  // Asks Razorpay what happened to an order, rather than believing the browser.
  async function confirmOrder(order, { source }) {
    if (order.paymentStatus.startsWith("Paid")) return { outcome: "paid", order };
    if (!order.gatewayRef) return { outcome: "pending", order };
    const { items } = await client.paymentsForOrder(order.gatewayRef);
    return applyPayment(order, pickPayment(items), { source });
  }

  // Powers the admin panel's "Check payment gateway" panel: proves the keys
  // work without taking any money, by asking about an order that can't exist.
  async function diagnose() {
    const mode = keyId.startsWith("rzp_test") ? "test" : "live";
    const report = {
      provider: "razorpay",
      configured: true,
      ok: false,
      verdict: "",
      steps: [],
      facts: [
        ["Gateway", "Razorpay"],
        ["Mode", mode === "test" ? "test keys — no real money moves" : "live keys — real money"],
        ["Key id", keyId],
        ["Webhook secret", webhookSecret ? "set" : "not set"],
      ],
    };
    try {
      await client.paymentsForOrder("order_0000000000000000");
      report.ok = true;
      report.verdict = `Razorpay accepted these ${mode} keys.`;
    } catch (err) {
      if (/does not exist|not found|no such|invalid id/i.test(err.message)) {
        report.ok = true;
        report.verdict = `Razorpay accepted these ${mode} keys.`;
      } else if (/authenticat|unauthor|401/i.test(err.message)) {
        report.verdict = "Razorpay rejected these keys.";
        report.steps.push(
          "Copy the Key Id and Key Secret again from Razorpay → Account & Settings → API Keys, and make sure both are from the same mode (test or live)."
        );
      } else {
        report.verdict = `Could not reach Razorpay: ${err.message}`;
      }
    }
    if (!webhookSecret) {
      report.steps.push(
        "Add a webhook in Razorpay → Settings → Webhooks for payment.captured and payment.failed, pointing at this server's /api/payments/razorpay/webhook, and set RAZORPAY_WEBHOOK_SECRET. Without it, a shopper who pays and closes the tab stays marked pending until someone checks."
      );
    }
    return report;
  }

  function register(app) {
    // Start a payment: record our order, then create the Razorpay order the
    // checkout window pays against.
    app.post("/api/payments/razorpay/order", wrap(async (req, res) => {
      const order = await prepareOrder(req, res, {
        resume: (earlier) =>
          earlier.gatewayRef && earlier.paymentStatus.startsWith("Pending")
            ? checkoutOptions(earlier)
            : null,
      });
      if (!order) return; // prepareOrder already answered

      const amountPaise = toPaise(order.total);
      try {
        const created = await client.createOrder({
          orderNo: order.orderNo,
          amountPaise,
          notes: { order_no: order.orderNo, shop: shopName },
        });
        const withRef = await shop.setGatewayRef(order.orderNo, created.id);
        await shop.logEvent(order.orderNo, "session_created", {
          razorpay_order_id: created.id,
          amount: amountPaise,
        });
        res.json(checkoutOptions(withRef));
      } catch (err) {
        console.error(`[razorpay] could not create an order for ${order.orderNo}:`, err.message);
        await shop.logEvent(order.orderNo, "session_failed", { message: err.message.slice(0, 500) });
        await shop.recordUnpaid(order.orderNo, {
          paymentStatus: "Failed",
          status: "Payment Failed",
        });
        res.status(502).json({
          error: "We couldn't reach the payment gateway. Please try again in a moment.",
        });
      }
    }));

    // What the browser needs to open Razorpay's window. The key id is public;
    // the secret never leaves the server.
    function checkoutOptions(order) {
      return {
        configured: true,
        provider: "razorpay",
        keyId,
        orderNo: order.orderNo,
        razorpayOrderId: order.gatewayRef,
        amount: toPaise(order.total),
        currency: "INR",
        name: shopName,
        token: tokens.receipt(order.orderNo),
        prefill: {
          name: order.customer?.name || "",
          email: order.customer?.email || "",
          contact: order.customer?.phone || "",
        },
      };
    }

    // The checkout window succeeded. Check its signature, then ask Razorpay.
    app.post("/api/payments/razorpay/verify", wrap(async (req, res) => {
      const orderNo = String(req.body?.orderNo || "");
      const paymentId = String(req.body?.razorpay_payment_id || "");
      const razorpayOrderId = String(req.body?.razorpay_order_id || "");
      const signature = String(req.body?.razorpay_signature || "");

      const order = await shop.getOrderByOrderNo(orderNo);
      if (!order || !tokens.check("receipt", orderNo, req.body?.token)) {
        return res.status(404).json({ error: "Order not found" });
      }

      // The payment must be for the Razorpay order this shop order created.
      if (!order.gatewayRef || order.gatewayRef !== razorpayOrderId) {
        await shop.logEvent(orderNo, "tamper_suspected", {
          reason: "the payment belongs to a different Razorpay order",
          sent: razorpayOrderId,
        });
        return res.status(409).json({ error: "This payment doesn't match your order." });
      }

      const signatureOk = verifyCheckoutSignature(
        { orderId: razorpayOrderId, paymentId, signature },
        keySecret
      );
      await shop.logEvent(orderNo, "shopper_returned", {
        payment_id: paymentId,
        signature: signatureOk ? "valid" : "INVALID",
      });
      if (!signatureOk) {
        await shop.logEvent(orderNo, "tamper_suspected", {
          reason: "the signature from checkout did not match",
        });
        return res.status(400).json({ error: "We couldn't verify that payment." });
      }

      try {
        const payment = await client.getPayment(paymentId);
        const result = await applyPayment(order, payment, { source: "checkout window" });
        return res.json(publicReceipt(result.order));
      } catch (err) {
        console.error(`[razorpay] verify failed for ${orderNo}:`, err.message);
        return res.status(502).json({ error: "We couldn't confirm the payment. Please wait a moment." });
      }
    }));

    // The shopper closed the window or the payment failed. This can only ever
    // record a failure; Razorpay remains the authority on what was paid.
    app.post("/api/payments/razorpay/cancel", wrap(async (req, res) => {
      const orderNo = String(req.body?.orderNo || "");
      if (!tokens.check("receipt", orderNo, req.body?.token)) {
        return res.status(404).json({ error: "Order not found" });
      }
      const order = await shop.getOrderByOrderNo(orderNo);
      if (!order) return res.status(404).json({ error: "Order not found" });

      const reason = String(req.body?.reason || "the payment window was closed").slice(0, 200);
      await shop.logEvent(orderNo, "checkout_abandoned", { reason });
      // Ask Razorpay anyway: the shopper may have paid and closed too early.
      const result = await confirmOrder(order, { source: "checkout closed" }).catch(() => null);
      if (result?.outcome === "paid") return res.json(publicReceipt(result.order));
      const updated = await shop.recordUnpaid(orderNo, {
        paymentStatus: `Not paid (${reason})`,
        status: "Payment Failed",
      });
      res.json(publicReceipt(updated || order));
    }));

    // Razorpay tells us directly — this is what saves the order when a shopper
    // pays and closes the tab before the browser can report back.
    app.post("/api/payments/razorpay/webhook", wrap(async (req, res) => {
      const signature = req.get("X-Razorpay-Signature");
      if (!webhookSecret) return res.status(503).json({ error: "Webhooks are not configured" });
      if (!verifyWebhookSignature(req.rawBody, signature, webhookSecret)) {
        console.warn("[razorpay] webhook with a bad signature was ignored");
        return res.status(400).json({ error: "Bad signature" });
      }

      const payment = req.body?.payload?.payment?.entity || null;
      const razorpayOrderId = payment?.order_id || req.body?.payload?.order?.entity?.id;
      // Answer Razorpay quickly; it retries on anything but a 2xx.
      res.json({ ok: true });

      try {
        if (!razorpayOrderId) return;
        const order = await shop.findOrderByGatewayRef(razorpayOrderId);
        if (!order) return;
        await shop.logEvent(order.orderNo, "webhook_received", { event: req.body?.event || "unknown" });
        await applyPayment(order, payment, { source: `webhook ${req.body?.event || ""}`.trim() });
      } catch (err) {
        console.error("[razorpay] webhook handling failed:", err.message);
      }
    }));
  }

  return { confirmOrder, diagnose, register };
}
