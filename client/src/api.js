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

  // Create a SmartGateway payment session. Returns { configured, paymentLink }
  // when the gateway is live, or { configured: false } to fall back to demo.
  async createHdfcSession(items, customer) {
    return handle(
      await fetch(apiUrl("/api/payments/hdfc/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, customer }),
      })
    );
  },

  async getOrder(orderNo) {
    return handle(await fetch(apiUrl(`/api/orders/${orderNo}`)));
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
