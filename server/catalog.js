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
    images: Array.isArray(body.images)
      ? body.images.filter((u) => typeof u === "string" && u)
      : [],
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

// A few sarees so a brand-new local setup isn't empty. Only used by the file
// store; the MongoDB store never adds samples to a real shop.
export function sampleProducts(now = Date.now()) {
  const sample = (fields, age) => ({
    id: crypto.randomUUID(),
    inStock: true,
    stock: null,
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
