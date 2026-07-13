// Paytm JS Checkout SDK integration
// Loads Paytm's merchant-specific checkout script once and resolves when ready.

let loaderPromise = null;

/**
 * Dynamically loads the Paytm Checkout JS SDK for the given merchant MID.
 * Uses staging gateway for test MIDs (starts with "STAGING_" or "TEST") and
 * production gateway for live MIDs.
 */
export function loadPaytmSDK(mid) {
  if (window.Paytm && window.Paytm.CheckoutJS) return Promise.resolve(true);
  if (loaderPromise) return loaderPromise;

  const isStaging =
    !mid ||
    mid.toLowerCase().includes("staging") ||
    mid.toLowerCase().includes("test");

  const baseUrl = isStaging
    ? "https://securegw-stage.paytm.in"
    : "https://securegw.paytm.in";

  const src = `${baseUrl}/merchantpgpui/checkoutjs/merchants/${mid}.js`;

  loaderPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      // Paytm SDK may need a moment to initialise after load
      const poll = setInterval(() => {
        if (window.Paytm && window.Paytm.CheckoutJS) {
          clearInterval(poll);
          resolve(true);
        }
      }, 100);
      // Give up after 10 seconds
      setTimeout(() => {
        clearInterval(poll);
        resolve(Boolean(window.Paytm && window.Paytm.CheckoutJS));
      }, 10000);
    };
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

  return loaderPromise;
}

/**
 * Opens the Paytm JS Checkout overlay.
 *
 * @param {Object} opts
 * @param {string} opts.mid          - Paytm Merchant ID
 * @param {string} opts.txnToken     - Transaction token from server
 * @param {string} opts.orderId      - Your internal order ID
 * @param {number} opts.amount       - Amount in INR (e.g. 1299.00)
 * @param {Function} opts.onSuccess  - Called with payment response object on success
 * @param {Function} [opts.onCancel] - Called when customer cancels
 * @param {Function} [opts.onError]  - Called with error message on failure
 */
export function openPaytm({ mid, txnToken, orderId, amount, onSuccess, onCancel, onError }) {
  const isStaging =
    !mid ||
    mid.toLowerCase().includes("staging") ||
    mid.toLowerCase().includes("test");

  const rootPaymentUrl = isStaging
    ? "https://securegw-stage.paytm.in"
    : "https://securegw.paytm.in";

  const config = {
    root: "",
    flow: "DEFAULT",
    merchant: {
      mid,
      name: "Haveli Wale",
      redirect: false, // use JS overlay, not page redirect
    },
    data: {
      orderId,
      token: txnToken,
      tokenType: "TXN_TOKEN",
      amount: String(amount),
    },
    website: isStaging ? "WEBSTAGING" : "DEFAULT",
    payMode: {
      labels: {},
      savedCards: { securityCode: true },
      order: ["CC", "DC", "NB", "UPI", "PPBL", "PPI", "BALANCE"],
    },
    merchant: {
      redirect: false,
    },
    handler: {
      transactionStatus(response) {
        window.Paytm.CheckoutJS.close();
        if (response.STATUS === "TXN_SUCCESS") {
          onSuccess(response);
        } else if (response.STATUS === "TXN_FAILURE") {
          if (onError) onError(response.RESPMSG || "Payment failed");
        } else {
          // PENDING or unknown — treat as cancelled from UX perspective
          if (onCancel) onCancel();
        }
      },
      notifyMerchant(eventName) {
        if (eventName === "APP_CLOSED" || eventName === "SESSION_EXPIRED") {
          if (onCancel) onCancel();
        }
      },
    },
  };

  window.Paytm.CheckoutJS.init(config)
    .then(() => {
      window.Paytm.CheckoutJS.invoke();
    })
    .catch((err) => {
      if (onError) onError(err?.message || "Could not open payment gateway");
    });
}
