import { apiUrl } from "./config.js";

const TOKEN_KEY = "saree_admin_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function isLoggedIn() {
  return Boolean(getToken());
}

async function handle(res) {
  if (!res.ok) {
    let message = "Request failed";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

// For admin-only requests. A 401 means the server no longer accepts the saved
// session (it expired, or the admin password changed). Drop the stale token
// and send the admin back to sign in, instead of leaving a dashboard that
// looks signed in but cannot save anything.
async function handleAuthed(res) {
  if (res.status === 401) {
    setToken(null);
    window.location.assign("/admin/login?expired=1");
    throw new Error("Your session expired. Please sign in again.");
  }
  return handle(res);
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export const api = {
  async login(password) {
    const res = await fetch(apiUrl("/api/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return handle(res);
  },

  async listProducts() {
    return handle(await fetch(apiUrl("/api/products")));
  },

  async getProduct(id) {
    return handle(await fetch(apiUrl(`/api/products/${id}`)));
  },

  async createProduct(data) {
    return handleAuthed(
      await fetch(apiUrl("/api/products"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      })
    );
  },

  async updateProduct(id, data) {
    return handleAuthed(
      await fetch(apiUrl(`/api/products/${id}`), {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      })
    );
  },

  // Adjust stock without touching the rest of the product. Pass { delta: 5 }
  // to add five, or { stock: 12 } to set an absolute count.
  async setStock(id, body) {
    return handleAuthed(
      await fetch(apiUrl(`/api/products/${id}/stock`), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      })
    );
  },

  async deleteProduct(id) {
    return handleAuthed(
      await fetch(apiUrl(`/api/products/${id}`), {
        method: "DELETE",
        headers: authHeaders(),
      })
    );
  },

  // The shop's categories, in the admin's order: [{ name, tagline, home }].
  async listCategories() {
    return handle(await fetch(apiUrl("/api/categories")));
  },

  // Replaces the list. Give each entry `was` (its name before editing) so a
  // renamed category keeps its sarees.
  async saveCategories(categories) {
    return handleAuthed(
      await fetch(apiUrl("/api/categories"), {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ categories }),
      })
    );
  },

  async uploadImages(files) {
    const form = new FormData();
    [...files].forEach((f) => form.append("images", f));
    return handleAuthed(
      await fetch(apiUrl("/api/upload"), {
        method: "POST",
        headers: authHeaders(),
        body: form,
      })
    );
  },

  // ----- Guest checkout & orders -----
  async createOrder(data) {
    return handle(
      await fetch(apiUrl("/api/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    );
  },

  // Create a SmartGateway payment session. Returns { configured, paymentLink,
  // orderNo, token } when the gateway is live, or { configured: false } to
  // fall back to demo. Only ids and quantities are sent: prices always come
  // from the server. attemptId identifies this one submission, so a repeated
  // request can't create a second order.
  async createHdfcSession(items, customer, attemptId) {
    return handle(
      await fetch(apiUrl("/api/payments/hdfc/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map(({ id, qty, name, color }) => ({ id, qty, name, color })),
          customer,
          attemptId,
        }),
      })
    );
  },

  // The receipt for an order; `token` is the receipt code from checkout.
  async getOrder(orderNo, token) {
    return handle(
      await fetch(
        apiUrl(`/api/orders/${encodeURIComponent(orderNo)}?t=${encodeURIComponent(token)}`)
      )
    );
  },

  // Admin-only: every recorded payment step for an order.
  async adminOrderEvents(orderNo) {
    return handleAuthed(
      await fetch(apiUrl(`/api/admin/orders/${encodeURIComponent(orderNo)}/events`), {
        headers: authHeaders(),
      })
    );
  },

  // Admin-only: asks HDFC for the order's status now. Returns
  // { order, response } with HDFC's full Order Status reply.
  async adminCheckOrder(orderNo) {
    return handleAuthed(
      await fetch(apiUrl(`/api/admin/orders/${encodeURIComponent(orderNo)}/check`), {
        method: "POST",
        headers: authHeaders(),
      })
    );
  },

  // Razorpay: create the order its checkout window pays against. Only ids and
  // quantities are sent; prices come from the server.
  async razorpayOrder(items, customer, attemptId) {
    return handle(
      await fetch(apiUrl("/api/payments/razorpay/order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map(({ id, qty, name, color }) => ({ id, qty, name, color })),
          customer,
          attemptId,
        }),
      })
    );
  },

  // Hands Razorpay's answer to the server, which checks it with Razorpay
  // before calling anything paid. Returns the receipt.
  async razorpayVerify(payload) {
    return handle(
      await fetch(apiUrl("/api/payments/razorpay/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  // The window was closed, or the payment failed. This can only ever record a
  // failure; the server still asks Razorpay what really happened.
  async razorpayCancel(payload) {
    return handle(
      await fetch(apiUrl("/api/payments/razorpay/cancel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  // Admin-only: why is the payment gateway refusing? Makes no payment.
  async diagnosePayments() {
    return handleAuthed(
      await fetch(apiUrl("/api/admin/payments/diagnose"), { headers: authHeaders() })
    );
  },

  async checkSession() {
    return handleAuthed(
      await fetch(apiUrl("/api/admin/session"), { headers: authHeaders() })
    );
  },

  async adminOrders() {
    return handleAuthed(
      await fetch(apiUrl("/api/admin/orders"), { headers: authHeaders() })
    );
  },
};

export function formatPrice(n) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}
