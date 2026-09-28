import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

const CartContext = createContext(null);
const STORAGE_KEY = "saree_cart";

// A saved cart item can still be bought if its saree exists, isn't marked sold
// out, and — when stock is tracked — has at least one left.
function stillAvailable(product) {
  if (!product || product.inStock === false) return false;
  const tracked = product.stock !== null && product.stock !== undefined;
  return !tracked || product.stock > 0;
}

// One cart line per saree and colour, so two colours of a saree are two lines.
export const lineKey = (item) => (item.color ? `${item.id}::${item.color}` : String(item.id));

// The colour of a saree with this name, ignoring case.
export const colorOf = (product, name) =>
  (product?.colors || []).find(
    (c) => c.name.toLowerCase() === String(name || "").toLowerCase()
  ) || null;

// The photo that shows a saree in a colour: the colour's own, else the saree's.
export const imageFor = (product, color) =>
  color?.images?.[0] || product?.images?.[0] || "";

// Adds up lines that ended up the same (e.g. a colour filled in on reconcile).
function mergeLines(list) {
  const byKey = new Map();
  for (const item of list) {
    const key = lineKey(item);
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, qty: existing.qty + item.qty } : { ...item, key });
  }
  return [...byKey.values()];
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      // Carts saved before colours existed have no line keys yet.
      return mergeLines(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // `colorName` picks one of the saree's colours; a saree that has colours
  // gets its first when none is given.
  function addToCart(product, qty = 1, colorName = null) {
    const color = colorOf(product, colorName) || product.colors?.[0] || null;
    const line = {
      id: product.id,
      name: product.name,
      ...(color ? { color: color.name } : {}),
      price: product.price,
      image: imageFor(product, color),
      qty,
    };
    setItems((prev) => mergeLines([...prev, line]));
  }

  function updateQty(key, qty) {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, qty: Math.max(1, qty) } : i))
    );
  }

  function removeFromCart(key) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  function clearCart() {
    setItems([]);
  }

  // Brings the saved cart in line with the live catalog: drops sarees that
  // were deleted or sold out, and colours no longer offered; caps quantities
  // at the stock left, and refreshes names, prices and photos. Returns the
  // names of anything dropped.
  function reconcile(catalog) {
    const byId = new Map(catalog.map((p) => [p.id, p]));
    // A line is kept if its saree is on sale and, when it names a colour,
    // still comes in that colour.
    const keep = (i) => {
      const p = byId.get(i.id);
      return stillAvailable(p) && (!i.color || !p.colors?.length || Boolean(colorOf(p, i.color)));
    };
    const dropped = items
      .filter((i) => !keep(i))
      .map((i) => (i.color ? `${i.name} (${i.color})` : i.name));
    setItems((prev) =>
      mergeLines(
        prev.filter(keep).map((i) => {
          const p = byId.get(i.id);
          const tracked = p.stock !== null && p.stock !== undefined;
          const color = colorOf(p, i.color) || p.colors?.[0] || null;
          const { color: _old, ...rest } = i;
          return {
            ...rest,
            ...(color ? { color: color.name } : {}),
            name: p.name,
            price: p.price,
            image: imageFor(p, color),
            qty: tracked ? Math.min(i.qty, p.stock) : i.qty,
          };
        })
      )
    );
    return dropped;
  }

  const count = useMemo(() => items.reduce((s, i) => s + i.qty, 0), [items]);
  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.qty * i.price, 0),
    [items]
  );

  const value = {
    items,
    count,
    subtotal,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
    reconcile,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

/**
 * Checks the saved cart against the live catalog when a page opens. The cart
 * lives in the browser, so it can hold sarees that were deleted or sold out
 * since they were added; the server refuses those, and the payment page never
 * opens. Returns a notice naming anything removed, and `check` to run it again
 * (it resolves to the list of removed names).
 */
export function useCartCheck() {
  const { reconcile } = useCart();
  const [notice, setNotice] = useState("");

  const check = useCallback(async () => {
    try {
      const dropped = reconcile(await api.listProducts());
      if (dropped.length) {
        const one = dropped.length === 1;
        setNotice(
          `${dropped.join(", ")} ${one ? "is" : "are"} no longer available and ${
            one ? "was" : "were"
          } removed from your cart.`
        );
      }
      return dropped;
    } catch {
      return []; // catalog unreachable — leave the cart as it is
    }
  }, [reconcile]);

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { notice, check };
}
