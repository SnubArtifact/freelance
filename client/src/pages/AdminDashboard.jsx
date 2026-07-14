import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken, formatPrice } from "../api.js";
import { assetUrl } from "../config.js";
import AdminOrders from "./AdminOrders.jsx";

const EMPTY = {
  name: "",
  description: "",
  price: "",
  originalPrice: "",
  category: "Kanjivaram",
  fabric: "",
  color: "",
  images: [],
  featured: false,
  inStock: true,
};

const CATEGORIES = [
  "Kanjivaram",
  "Banarasi",
  "Silk",
  "Georgette",
  "Cotton",
  "Chiffon",
  "Designer",
  "Other",
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [view, setView] = useState("catalog");

  function load() {
    api.listProducts().then(setProducts).catch(() => {});
  }
  useEffect(load, []);

  function notify(text, kind = "ok") {
    setMessage({ text, kind });
    setTimeout(() => setMessage(null), 3000);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function resetForm() {
    setForm(EMPTY);
    setEditingId(null);
    setImageUrl("");
  }

  function startEdit(p) {
    setForm({
      name: p.name || "",
      description: p.description || "",
      price: p.price ?? "",
      originalPrice: p.originalPrice ?? "",
      category: p.category || "Other",
      fabric: p.fabric || "",
      color: p.color || "",
      images: p.images || [],
      featured: !!p.featured,
      inStock: p.inStock !== false,
    });
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleFiles(e) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      const { urls } = await api.uploadImages(files);
      update("images", [...form.images, ...urls]);
      notify("Image uploaded");
    } catch (err) {
      notify(err.message || "Upload failed", "err");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function addImageUrl() {
    const url = imageUrl.trim();
    if (!url) return;
    update("images", [...form.images, url]);
    setImageUrl("");
  }

  function removeImage(idx) {
    update("images", form.images.filter((_, i) => i !== idx));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name || !form.price) {
      notify("Name and price are required", "err");
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      price: Number(form.price),
      originalPrice: form.originalPrice ? Number(form.originalPrice) : null,
    };
    try {
      if (editingId) {
        await api.updateProduct(editingId, payload);
        notify("Saree updated");
      } else {
        await api.createProduct(payload);
        notify("Saree added to collection");
      }
      resetForm();
      load();
    } catch (err) {
      notify(err.message || "Save failed", "err");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm("Delete this saree? This cannot be undone.")) return;
    try {
      await api.deleteProduct(id);
      if (editingId === id) resetForm();
      load();
      notify("Saree deleted");
    } catch (err) {
      notify(err.message || "Delete failed", "err");
    }
  }

  function logout() {
    setToken(null);
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="admin">
      <header className="admin-bar">
        <Link to="/" className="brand">
          <span className="brand-mark">Haveli Wale</span>
          <span className="brand-sub">ADMIN</span>
        </Link>
        <div className="admin-bar-actions">
          <div className="admin-tabs">
            <button
              className={`admin-tab ${view === "catalog" ? "active" : ""}`}
              onClick={() => setView("catalog")}
            >
              Catalog
            </button>
            <button
              className={`admin-tab ${view === "orders" ? "active" : ""}`}
              onClick={() => setView("orders")}
            >
              Orders
            </button>
          </div>
          <Link to="/" className="link-arrow">View store ↗</Link>
          <button className="btn btn-ghost small" onClick={logout}>Logout</button>
        </div>
      </header>

      {message && <div className={`toast ${message.kind}`}>{message.text}</div>}

      {view === "orders" ? (
        <div className="admin-orders-wrap">
          <AdminOrders />
        </div>
      ) : (
      <div className="admin-body">
        {/* Form */}
        <form className="admin-form panel" onSubmit={save}>
          <h2>{editingId ? "Edit Saree" : "Add a New Saree"}</h2>
          <p className="muted">
            {editingId
              ? "Update the details and save."
              : "Fill in the details. It appears on the storefront instantly."}
          </p>

          <label className="field">
            <span>Saree name *</span>
            <input value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="e.g. Royal Kanjivaram Silk" />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea rows={3} value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Fabric, weave, occasion, styling notes…" />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Price (₹) *</span>
              <input type="number" min="0" value={form.price}
                onChange={(e) => update("price", e.target.value)}
                placeholder="2999" />
            </label>
            <label className="field">
              <span>Original price (₹)</span>
              <input type="number" min="0" value={form.originalPrice}
                onChange={(e) => update("originalPrice", e.target.value)}
                placeholder="optional — for discounts" />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Category</span>
              <select value={form.category}
                onChange={(e) => update("category", e.target.value)}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Fabric</span>
              <input value={form.fabric}
                onChange={(e) => update("fabric", e.target.value)}
                placeholder="e.g. Pure Silk" />
            </label>
          </div>

          <label className="field">
            <span>Color</span>
            <input value={form.color}
              onChange={(e) => update("color", e.target.value)}
              placeholder="e.g. Maroon & Gold" />
          </label>

          {/* Images */}
          <div className="field">
            <span>Images</span>
            <div className="image-tray">
              {form.images.map((src, i) => (
                <div key={i} className="image-tile">
                  <img src={assetUrl(src)} alt="" />
                  <button type="button" onClick={() => removeImage(i)}>✕</button>
                </div>
              ))}
              <label className="image-add">
                {uploading ? "…" : "+ Upload"}
                <input type="file" accept="image/*" multiple hidden
                  onChange={handleFiles} disabled={uploading} />
              </label>
            </div>
            <div className="url-add">
              <input value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="…or paste an image URL" />
              <button type="button" className="btn btn-ghost small"
                onClick={addImageUrl}>Add URL</button>
            </div>
          </div>

          <div className="toggles">
            <label className="toggle">
              <input type="checkbox" checked={form.featured}
                onChange={(e) => update("featured", e.target.checked)} />
              Feature on homepage
            </label>
            <label className="toggle">
              <input type="checkbox" checked={form.inStock}
                onChange={(e) => update("inStock", e.target.checked)} />
              In stock
            </label>
          </div>

          <div className="admin-form-actions">
            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Saree"}
            </button>
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>

        {/* List */}
        <section className="admin-list panel">
          <div className="admin-list-head">
            <h2>Collection</h2>
            <span className="count-pill">{products.length} sarees</span>
          </div>

          {products.length === 0 ? (
            <p className="empty">No sarees yet. Add your first one!</p>
          ) : (
            <div className="admin-rows">
              {products.map((p) => (
                <div key={p.id} className="admin-row">
                  <div className="admin-thumb">
                    {p.images?.[0] ? (
                      <img src={assetUrl(p.images[0])} alt={p.name} />
                    ) : (
                      <div className="placeholder">—</div>
                    )}
                  </div>
                  <div className="admin-row-info">
                    <strong>{p.name}</strong>
                    <span className="admin-row-meta">
                      {p.category} · {formatPrice(p.price)}
                      {p.featured && <em className="tag">Featured</em>}
                      {!p.inStock && <em className="tag muted-tag">Sold out</em>}
                    </span>
                  </div>
                  <div className="admin-row-actions">
                    <button className="icon-btn" onClick={() => startEdit(p)}>
                      Edit
                    </button>
                    <button className="icon-btn danger" onClick={() => remove(p.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
