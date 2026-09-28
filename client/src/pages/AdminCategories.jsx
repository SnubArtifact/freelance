import { useEffect, useState } from "react";
import { api } from "../api.js";

// Each row remembers the name it was loaded with (`was`), so renaming a
// category moves its sarees along when the list is saved.
const toRows = (list) => list.map((c) => ({ ...c, was: c.name }));

export default function AdminCategories({ products, onSaved, notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api
      .listCategories()
      .then((list) => setRows(toRows(list)))
      .catch(() => notify("Could not load categories", "err"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countIn = (name) => products.filter((p) => p.category === name).length;

  function change(i, field, value) {
    setRows((list) => list.map((r, n) => (n === i ? { ...r, [field]: value } : r)));
    setDirty(true);
  }

  function move(i, by) {
    setRows((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  function remove(i) {
    const row = rows[i];
    const count = row.was ? countIn(row.was) : 0;
    if (
      count &&
      !confirm(
        `${count} saree${count === 1 ? " is" : "s are"} in "${row.was}". They keep that category name, but it won't be offered for new sarees. Remove it?`
      )
    ) {
      return;
    }
    setRows((list) => list.filter((_, n) => n !== i));
    setDirty(true);
  }

  function add() {
    setRows((list) => [...list, { name: "", tagline: "", home: false, was: "" }]);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await api.saveCategories(
        rows.map((r) => ({ ...r, name: r.name.trim() }))
      );
      setRows(toRows(saved));
      setDirty(false);
      notify("Categories saved");
      onSaved?.(saved);
    } catch (err) {
      notify(err.message || "Could not save categories", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel admin-cats">
      <div className="admin-list-head">
        <h2>Categories</h2>
        <span className="count-pill">{rows.length} categories</span>
      </div>
      <p className="muted">
        Rename a category and every saree in it moves to the new name. The
        order here is the order shoppers see. Tick <em>Homepage</em> to show
        it as a tile on the homepage, with its tagline.
      </p>

      {loading ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className="cat-rows">
          <div className="cat-row cat-row-head" aria-hidden="true">
            <span>Name</span>
            <span>Tagline (optional)</span>
            <span>Homepage</span>
            <span>Sarees</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="cat-row">
              <input
                value={r.name}
                onChange={(e) => change(i, "name", e.target.value)}
                placeholder="Category name"
                aria-label="Category name"
                maxLength={60}
              />
              <input
                value={r.tagline}
                onChange={(e) => change(i, "tagline", e.target.value)}
                placeholder="e.g. Heirloom silk"
                aria-label="Tagline"
                maxLength={80}
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={r.home}
                  onChange={(e) => change(i, "home", e.target.checked)}
                />
                <span className="cat-home-label">Homepage</span>
              </label>
              <span className="cat-count" title="Sarees in this category">
                {r.was ? countIn(r.was) : 0}
              </span>
              <div className="cat-row-actions">
                <button type="button" className="icon-btn" onClick={() => move(i, -1)}
                  disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" className="icon-btn" onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1} aria-label="Move down">↓</button>
                <button type="button" className="icon-btn danger" onClick={() => remove(i)}
                  aria-label="Remove">✕</button>
              </div>
              {r.was && r.name.trim() && r.name.trim() !== r.was && (
                <span className="cat-rename-note">
                  Renaming from “{r.was}” — {countIn(r.was)} saree
                  {countIn(r.was) === 1 ? "" : "s"} will move.
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="admin-form-actions cat-actions">
        <button type="button" className="btn btn-ghost" onClick={add}>
          + Add category
        </button>
        <button type="button" className="btn btn-primary" onClick={save}
          disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save categories"}
        </button>
      </div>
    </section>
  );
}
