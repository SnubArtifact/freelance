import {
  interpretPayment,
  pickPayment,
  toPaise,
  udfNotes,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay.js";

/**
 * The Razorpay half of checkout. HDFC requires Razorpay Hosted Checkout: the
 * browser POSTs options to Razorpay's full gateway page, then Razorpay POSTs
 * the result back to this server. Nothing it sends back is trusted either:
 *
 *  - the amount comes from the shop's database, never the browser;
 *  - the signature Razorpay returns is checked with the key secret, and a
 *    wrong one is refused;
 *  - the payment is then read back from Razorpay's API and must be captured,
 *    for this order, for this exact amount;
 *  - a webhook covers the shopper who pays and closes the tab.
 */
export function razorpayPayments(ctx) {
  const {
    shop,
    tokens,
    client,
    keyId,
    keySecret,
    webhookSecret,
    shopName,
    sendOrderEmail,
    prepareOrder,
    publicReceipt,
    publicServerUrl,
    clientUrl,
    wrap,
  } = ctx;

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

  /**
   * The dual enquiry HDFC requires: whatever anyone else says, the payment is
   * read back from Razorpay's Fetch Single Payment API before it counts.
   * `known` is a payment we've been handed (by checkout or a webhook) and is
   * only ever used to learn its id.
   */
  async function confirmOrder(order, { source, known } = {}) {
    if (order.paymentStatus.startsWith("Paid")) return { outcome: "paid", order };
    let candidate = known || null;
    if (!candidate) {
      if (!order.gatewayRef) return { outcome: "pending", order };
      const { items } = await client.paymentsForOrder(order.gatewayRef);
      candidate = pickPayment(items);
    }
    if (!candidate?.id) return applyPayment(order, candidate, { source });
    // Fetch Single Payment — the server-to-server check that decides.
    const payment = await client.getPayment(candidate.id);
    return applyPayment(order, payment, { source });
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
    // hosted checkout page pays against.
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
          notes: udfNotes(order, shopName),
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

    // What the browser POSTs to Razorpay Hosted Checkout. The key id is
    // public; the secret never leaves the server. `order_id`, amount and all
    // callbacks are derived here, never accepted from the browser.
    function checkoutOptions(order) {
      const callbackQuery = new URLSearchParams({
        order: order.orderNo,
        ref: tokens.returnRef(order.orderNo),
      });
      const callbackUrl = `${publicServerUrl}/api/payments/razorpay/hosted-return?${callbackQuery}`;
      const cancelUrl = `${publicServerUrl}/api/payments/razorpay/hosted-cancel?${callbackQuery}`;
      return {
        configured: true,
        provider: "razorpay",
        checkoutMode: "hosted",
        checkoutUrl: "https://api.razorpay.com/v1/checkout/embedded",
        // Kept for the API's backwards compatibility only. The storefront
        // uses `fields` below and never loads Razorpay's checkout.js.
        keyId,
        orderNo: order.orderNo,
        razorpayOrderId: order.gatewayRef,
        amount: toPaise(order.total),
        currency: "INR",
        token: tokens.receipt(order.orderNo),
        prefill: {
          name: order.customer?.name || "",
          email: order.customer?.email || "",
          contact: order.customer?.phone || "",
        },
        fields: {
          key_id: keyId,
          name: shopName,
          description: `Order ${order.orderNo}`,
          order_id: order.gatewayRef,
          amount: toPaise(order.total),
          currency: "INR",
          "prefill[name]": order.customer?.name || "",
          "prefill[email]": order.customer?.email || "",
          "prefill[contact]": order.customer?.phone || "",
          "notes[order_no]": order.orderNo,
          callback_url: callbackUrl,
          cancel_url: cancelUrl,
        },
      };
    }

    const returnToStorefront = (res, orderNo, status) =>
      res.redirect(
        303,
        `${clientUrl}/checkout?${new URLSearchParams({
          status,
          ...(orderNo ? { order: orderNo, t: tokens.receipt(orderNo) } : {}),
        })}`
      );

    // Razorpay Hosted Checkout submits successful and failed payment results
    // here. The signed URL parameter is tied to this order; the Razorpay
    // signature is then checked before Fetch Single Payment decides its state.
    app.post("/api/payments/razorpay/hosted-return", wrap(async (req, res) => {
      const orderNo = String(req.query?.order || "");
      const ref = String(req.query?.ref || "");
      if (!orderNo || !tokens.check("return", orderNo, ref)) {
        return returnToStorefront(res, "", "failed");
      }
      const order = await shop.getOrderByOrderNo(orderNo);
      if (!order) return returnToStorefront(res, "", "failed");

      const paymentId = String(req.body?.razorpay_payment_id || "");
      const razorpayOrderId = String(req.body?.razorpay_order_id || "");
      const signature = String(req.body?.razorpay_signature || "");
      const signatureOk =
        Boolean(order.gatewayRef) &&
        order.gatewayRef === razorpayOrderId &&
        verifyCheckoutSignature({ orderId: order.gatewayRef, paymentId, signature }, keySecret);
      const isFailureCallback = !paymentId && !razorpayOrderId && !signature;

      await shop.logEvent(orderNo, "hosted_returned", {
        payment_id: paymentId || null,
        razorpay_order_id: razorpayOrderId || null,
        signature: signatureOk ? "valid" : "INVALID",
      });

      if (!signatureOk) {
        if (!isFailureCallback) {
          await shop.logEvent(orderNo, "tamper_suspected", {
            reason: "the hosted checkout callback did not match this order and signature",
          });
        }
        // A failure callback has no payment signature. Its fields are not
        // trusted, but the bank record is still checked before showing status.
        const checked = await confirmOrder(order, { source: "hosted callback without valid signature" }).catch(() => null);
        return returnToStorefront(res, orderNo, checked?.outcome || "failed");
      }

      try {
        const result = await confirmOrder(order, {
          source: "hosted checkout callback",
          known: { id: paymentId },
        });
        return returnToStorefront(res, orderNo, result.outcome);
      } catch (err) {
        console.error(`[razorpay] hosted callback failed for ${orderNo}:`, err.message);
        return returnToStorefront(res, orderNo, "pending");
      }
    }));

    // Razorpay redirects here with GET if the shopper cancels or goes back.
    app.get("/api/payments/razorpay/hosted-cancel", wrap(async (req, res) => {
      const orderNo = String(req.query?.order || "");
      const ref = String(req.query?.ref || "");
      if (!orderNo || !tokens.check("return", orderNo, ref)) {
        return returnToStorefront(res, "", "failed");
      }
      const order = await shop.getOrderByOrderNo(orderNo);
      if (!order) return returnToStorefront(res, "", "failed");

      await shop.logEvent(orderNo, "hosted_checkout_cancelled", { source: "Razorpay Hosted Checkout" });
      const checked = await confirmOrder(order, { source: "hosted checkout cancelled" }).catch(() => null);
      if (checked?.outcome === "paid") return returnToStorefront(res, orderNo, "paid");
      const updated = await shop.recordUnpaid(orderNo, {
        paymentStatus: "Not paid (payment cancelled)",
        status: "Payment Failed",
      });
      return returnToStorefront(res, updated?.orderNo || orderNo, checked?.outcome || "failed");
    }));

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
        const result = await confirmOrder(order, {
          source: "checkout window",
          known: { id: paymentId },
        });
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
        await confirmOrder(order, {
          source: `webhook ${req.body?.event || ""}`.trim(),
          known: payment,
        });
      } catch (err) {
        console.error("[razorpay] webhook handling failed:", err.message);
      }
    }));
  }

  return { confirmOrder, diagnose, register };
}
