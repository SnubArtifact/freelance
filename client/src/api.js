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

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export const api = {
  async login(password) {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return handle(res);
  },

  async listProducts() {
    return handle(await fetch("/api/products"));
  },

  async getProduct(id) {
    return handle(await fetch(`/api/products/${id}`));
  },

  async createProduct(data) {
    return handle(
      await fetch("/api/products", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      })
    );
  },

  async updateProduct(id, data) {
    return handle(
      await fetch(`/api/products/${id}`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      })
    );
  },

  async deleteProduct(id) {
    return handle(
      await fetch(`/api/products/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      })
    );
  },

  async uploadImages(files) {
    const form = new FormData();
    [...files].forEach((f) => form.append("images", f));
    return handle(
      await fetch("/api/upload", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      })
    );
  },

  // ----- Guest checkout & orders -----
  async createOrder(data) {
    return handle(
      await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    );
  },

  async initiatePaytmPayment(items) {
    return handle(
      await fetch("/api/payments/paytm/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })
    );
  },

  async adminOrders() {
    return handle(await fetch("/api/admin/orders", { headers: authHeaders() }));
  },
};

export function formatPrice(n) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}
