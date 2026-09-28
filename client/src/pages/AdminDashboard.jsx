import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken, formatPrice } from "../api.js";
import { assetUrl } from "../config.js";
import AdminCategories from "./AdminCategories.jsx";
import AdminOrders from "./AdminOrders.jsx";
import PaymentCheck from "../components/PaymentCheck.jsx";

const EMPTY = {
  name: "",
  description: "",
  price: "",
  originalPrice: "",
  category: "",
  fabric: "",
  color: "",
  images: [],
  colors: [],
  featured: false,
  inStock: true,
  stock: "",
};

// A new colour option starts with this swatch until the admin picks one.
const NEW_COLOR = { name: "", hex: "#6d1f3a", images: [] };

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
  const [categories, setCategories] = useState([]);

  function load() {
    api.listProducts().then(setProducts).catch(() => {});
  }
  useEffect(load, []);
  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, []);

  // A saree whose category was since removed from the list keeps it as an
  // option, so editing it doesn't quietly change its category.
  const categoryNames = categories.map((c) => c.name);
  const categoryOptions =
    form.category && !categoryNames.includes(form.category)
      ? [...categoryNames, form.category]
      : categoryNames;
  // Catch an expired session up front. On a 401, checkSession sends the
  // admin to the login page before they fill in the form. The reply also says
  // whether the server keeps data across restarts.
  const [storage, setStorage] = useState(null);
  useEffect(() => {
    api
      .checkSession()
      .then((s) => setStorage(s.storage || null))
      .catch(() => {});
  }, []);

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
      category: p.category || "",
      fabric: p.fabric || "",
      color: p.color || "",
      images: p.images || [],
      colors: (p.colors || []).map((c) => ({ ...c, hex: c.hex || "" })),
      featured: !!p.featured,
      inStock: p.inStock !== false,
      stock: p.stock ?? "",
    });
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addStock(p) {
    const current = p.stock ?? 0;
    const answer = window.prompt(
      `How many more "${p.name}" are you adding?\n\nCurrently tracked: ${
        p.stock ?? "not tracked"
      }`,
      "1"
    );
    if (answer === null) return;
    const delta = Math.floor(Number(answer));
    if (!Number.isFinite(delta) || delta === 0) {
      return notify("Enter a whole number", "err");
    }
    try {
      const updated = await api.setStock(p.id, { delta });
      notify(`${p.name}: ${current} → ${updated.stock} in stock`);
      load();
    } catch (err) {
      notify(err.message || "Could not update stock", "err");
    }
  }

  // Photos are shrunk in the browser before upload (longest side 1600px,
  // JPEG): pages load faster and they use less of the free photo storage.
  // Anything the browser can't read is uploaded as it is.
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 600 * 1024) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // transparent PNG areas become white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], `${file.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" });
    } catch {
      return file;
    }
  }

  // `colorIndex` uploads to one colour's photos instead of the saree's own.
  async function handleFiles(e, colorIndex = null) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      const { urls } = await api.uploadImages(await Promise.all([...files].map(shrink)));
      if (colorIndex === null) {
        setForm((f) => ({ ...f, images: [...f.images, ...urls] }));
      } else {
        setForm((f) => ({
          ...f,
          colors: f.colors.map((c, i) =>
            i === colorIndex ? { ...c, images: [...c.images, ...urls] } : c
          ),
        }));
      }
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

  function addColor() {
    setForm((f) => ({ ...f, colors: [...f.colors, { ...NEW_COLOR }] }));
  }

  function changeColor(idx, field, value) {
    update(
      "colors",
      form.colors.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    );
  }

  function removeColor(idx) {
    update("colors", form.colors.filter((_, i) => i !== idx));
  }

  function removeColorImage(idx, imgIdx) {
    changeColor(idx, "images", form.colors[idx].images.filter((_, i) => i !== imgIdx));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name || !form.price) {
      notify("Name and price are required", "err");
      return;
    }
    if (form.colors.some((c) => !c.name.trim())) {
      notify("Give every colour option a name, or remove it", "err");
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      price: Number(form.price),
      originalPrice: form.originalPrice ? Number(form.originalPrice) : null,
      category: form.category || categoryNames[0] || "Uncategorized",
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
          <span className="brand-mark">Pankaj Enterprises</span>
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
              className={`admin-tab ${view === "categories" ? "active" : ""}`}
              onClick={() => setView("categories")}
            >
              Categories
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

      {storage?.persistent === false && (
        <div className="storage-warning" role="alert">
          {storage.dataKept === false ? (
            <>
              <strong>Changes you make here will not be kept.</strong> Sarees,
              stock, orders and photos are stored on this server, which erases
              them whenever it restarts or wakes from sleep. In Render, set{" "}
              <code>MONGODB_URI</code> and <code>CLOUDINARY_URL</code> (see the
              README).
            </>
          ) : (
            <>
              <strong>Photos you upload will not be kept.</strong> Sarees, stock
              and orders are saved, but photos are stored on this server, which
              erases them whenever it restarts or wakes from sleep. In Render,
              set <code>CLOUDINARY_URL</code>.
            </>
          )}{" "}
          This warning goes away once that is done.
        </div>
      )}

      {view === "orders" ? (
        <div className="admin-orders-wrap">
          <PaymentCheck />
          <AdminOrders />
        </div>
      ) : view === "categories" ? (
        <div className="admin-orders-wrap">
          <AdminCategories
            products={products}
            notify={notify}
            onSaved={(list) => {
              setCategories(list);
              load(); // renamed categories move their sarees
            }}
          />
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
              <select value={form.category || categoryOptions[0] || ""}
                onChange={(e) => update("category", e.target.value)}>
                {categoryOptions.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Fabric</span>
              <input value={form.fabric}
                onChange={(e) => update("fabric", e.target.value)}
                placeholder="e.g. Pure Silk" />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Colour description</span>
              <input value={form.color}
                onChange={(e) => update("color", e.target.value)}
                placeholder="e.g. Maroon & Gold" />
            </label>
            <label className="field">
              <span>Stock (how many you have)</span>
              <input type="number" min="0" value={form.stock}
                onChange={(e) => update("stock", e.target.value)}
                placeholder="blank = don't track a count" />
            </label>
          </div>

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
                  onChange={(e) => handleFiles(e)} disabled={uploading} />
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

          {/* Colour options */}
          <div className="field">
            <span>Colour options</span>
            <p className="field-help">
              Add each colour this saree comes in, with its own photos.
              Shoppers pick one with a swatch; its photos replace the ones
              above.
            </p>
            {form.colors.map((c, i) => (
              <div key={i} className="color-edit">
                <div className="color-edit-head">
                  <input type="color" value={c.hex || "#cccccc"}
                    onChange={(e) => changeColor(i, "hex", e.target.value)}
                    aria-label="Swatch colour" />
                  <input value={c.name}
                    onChange={(e) => changeColor(i, "name", e.target.value)}
                    placeholder="Colour name, e.g. Maroon" maxLength={60} />
                  <button type="button" className="icon-btn danger"
                    onClick={() => removeColor(i)}>Remove</button>
                </div>
                <div className="image-tray">
                  {c.images.map((src, j) => (
                    <div key={j} className="image-tile small">
                      <img src={assetUrl(src)} alt="" />
                      <button type="button" onClick={() => removeColorImage(i, j)}>✕</button>
                    </div>
                  ))}
                  <label className="image-add small">
                    {uploading ? "…" : "+ Photos"}
                    <input type="file" accept="image/*" multiple hidden
                      onChange={(e) => handleFiles(e, i)} disabled={uploading} />
                  </label>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-ghost small add-color"
              onClick={addColor}>+ Add colour</button>
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
                      {p.colors?.length > 0 && (
                        <em className="tag muted-tag">
                          {p.colors.length} colour{p.colors.length === 1 ? "" : "s"}
                        </em>
                      )}
                      {p.featured && <em className="tag">Featured</em>}
                      {!p.inStock && <em className="tag muted-tag">Sold out</em>}
                      {p.stock !== null && p.stock !== undefined && (
                        <em className={p.stock === 0 ? "tag muted-tag" : "tag"}>
                          {p.stock} in stock
                        </em>
                      )}
                    </span>
                  </div>
                  <div className="admin-row-actions">
                    <button className="icon-btn" title="Add stock"
                      onClick={() => addStock(p)}>
                      + Stock
                    </button>
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
