import crypto from "node:crypto";

// How many are physically in hand. null means "don't track a count for this
// one" — availability then rests on the inStock flag alone, which is how every
// product created before stock counts existed behaves.
export function normalizeStock(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

export const hasTrackedStock = (product) =>
  product.stock !== null && product.stock !== undefined;

const cleanImages = (list) =>
  Array.isArray(list) ? list.filter((u) => typeof u === "string" && u) : [];

/**
 * The colours a saree comes in, each with its own swatch and photos. Nameless
 * entries and repeated names are dropped; a swatch that isn't a #rrggbb hex
 * code is left blank.
 */
export function normalizeColors(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const colors = [];
  for (const c of list.slice(0, 20)) {
    const name = String(c?.name || "").trim().slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const hex = String(c?.hex || "").trim();
    colors.push({
      name,
      hex: /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "",
      images: cleanImages(c?.images),
    });
  }
  return colors;
}

// Finds one of a saree's colours by name, ignoring case.
export const findColor = (product, name) =>
  (product.colors || []).find(
    (c) => c.name.toLowerCase() === String(name || "").trim().toLowerCase()
  ) || null;

// Every photo a saree uses: its own and each colour's.
export const allImages = (product) => [
  ...(product.images || []),
  ...(product.colors || []).flatMap((c) => c.images || []),
];

// The fields the admin form may set, cleaned up.
export function normalizeProduct(body) {
  return {
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    price: Number(body.price) || 0,
    originalPrice: body.originalPrice ? Number(body.originalPrice) : null,
    category: String(body.category || "Uncategorized").trim(),
    fabric: String(body.fabric || "").trim(),
    color: String(body.color || "").trim(),
    images: cleanImages(body.images),
    colors: normalizeColors(body.colors),
    featured: Boolean(body.featured),
    inStock: body.inStock === undefined ? true : Boolean(body.inStock),
    stock: normalizeStock(body.stock),
  };
}

/**
 * Applies a stock change from the admin panel and returns the updated copy.
 * { stock } sets an absolute count (blank stops tracking); { delta } adds or
 * removes units, starting an untracked product from zero. A tracked item is on
 * sale exactly when it has units left, so restocking a sold-out saree puts it
 * back on sale. An untracked one keeps the inStock flag the admin set.
 */
export function applyStockChange(product, change) {
  const next = { ...product };
  next.stock =
    change.stock !== undefined
      ? normalizeStock(change.stock)
      : Math.max(0, (next.stock ?? 0) + change.delta);
  if (hasTrackedStock(next)) next.inStock = next.stock > 0;
  return next;
}

// The categories a shop starts with, until the admin changes them. Those
// marked `home` are shown on the homepage.
export const DEFAULT_CATEGORIES = [
  { name: "Kanjivaram", tagline: "Heirloom silk", home: true },
  { name: "Banarasi", tagline: "Festive weaves", home: true },
  { name: "Silk", tagline: "", home: false },
  { name: "Georgette", tagline: "Designer drapes", home: true },
  { name: "Cotton", tagline: "Everyday ease", home: true },
  { name: "Chiffon", tagline: "", home: false },
  { name: "Designer", tagline: "", home: false },
  { name: "Other", tagline: "", home: false },
];

/**
 * Cleans up the category list from the admin panel. Each entry is
 * { name, tagline, home, was }, where `was` is the name it had before, so a
 * rename can move its sarees along. Returns { categories, renames } or
 * { error }.
 */
export function normalizeCategories(list) {
  if (!Array.isArray(list)) return { error: "Send a list of categories" };
  if (list.length > 50) return { error: "At most 50 categories" };
  const seen = new Set();
  const categories = [];
  const renames = [];
  for (const c of list) {
    const name = String(c?.name || "").trim().slice(0, 60);
    if (!name) return { error: "Every category needs a name" };
    if (seen.has(name.toLowerCase())) return { error: `"${name}" is listed twice` };
    seen.add(name.toLowerCase());
    categories.push({
      name,
      tagline: String(c?.tagline || "").trim().slice(0, 80),
      home: Boolean(c?.home),
    });
    const was = String(c?.was || "").trim();
    if (was && was !== name) renames.push({ from: was, to: name });
  }
  return { categories, renames };
}

// A few sarees so a brand-new local setup isn't empty. Only used by the file
// store; the MongoDB store never adds samples to a real shop.
export function sampleProducts(now = Date.now()) {
  const sample = (fields, age) => ({
    id: crypto.randomUUID(),
    inStock: true,
    stock: null,
    colors: [],
    createdAt: now - age,
    ...fields,
  });
  return [
    sample(
      {
        name: "Royal Kanjivaram Silk",
        description:
          "Handwoven pure Kanjivaram silk with a contrast border and intricate gold zari motifs. A timeless heirloom piece for weddings and grand occasions.",
        price: 12999,
        originalPrice: 16999,
        category: "Kanjivaram",
        fabric: "Pure Silk",
        color: "Maroon & Gold",
        images: [
          "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=900&q=80",
        ],
        featured: true,
      },
      0
    ),
    sample(
      {
        name: "Banarasi Festive Drape",
        description:
          "Lustrous Banarasi silk with delicate floral jaal weaving throughout the body. Lightweight, elegant, and perfect for festive evenings.",
        price: 8499,
        originalPrice: 10999,
        category: "Banarasi",
        fabric: "Silk Blend",
        color: "Emerald Green",
        images: [
          "https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=900&q=80",
        ],
        featured: true,
      },
      1000
    ),
    sample(
      {
        name: "Soft Cotton Handloom",
        description:
          "Breathable handloom cotton saree with a minimal temple border. An everyday classic that stays comfortable from morning to night.",
        price: 2499,
        originalPrice: 2999,
        category: "Cotton",
        fabric: "Handloom Cotton",
        color: "Indigo Blue",
        images: [
          "https://images.unsplash.com/photo-1617059998515-3c0e2b4f9aa1?w=900&q=80",
        ],
        featured: false,
      },
      2000
    ),
    sample(
      {
        name: "Georgette Pastel Charm",
        description:
          "Flowy georgette saree in a soft pastel tone with a subtle sequin border. Designer drape that's easy to carry for parties and receptions.",
        price: 5999,
        originalPrice: 7499,
        category: "Georgette",
        fabric: "Georgette",
        color: "Blush Pink",
        images: [
          "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=900&q=80",
        ],
        featured: true,
      },
      3000
    ),
  ];
}
