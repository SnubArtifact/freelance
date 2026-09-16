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

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  function addToCart(product, qty = 1) {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.id === product.id ? { ...i, qty: i.qty + qty } : i
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.images?.[0] || "",
          qty,
        },
      ];
    });
  }

  function updateQty(id, qty) {
    setItems((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: Math.max(1, qty) } : i))
        .filter((i) => i.qty > 0)
    );
  }

  function removeFromCart(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clearCart() {
    setItems([]);
  }

  // Brings the saved cart in line with the live catalog: drops sarees that
  // were deleted or sold out, caps quantities at the stock left, and refreshes
  // names, prices and photos. Returns the names of anything dropped.
  function reconcile(catalog) {
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const dropped = items
      .filter((i) => !stillAvailable(byId.get(i.id)))
      .map((i) => i.name);
    setItems((prev) =>
      prev
        .filter((i) => stillAvailable(byId.get(i.id)))
        .map((i) => {
          const p = byId.get(i.id);
          const tracked = p.stock !== null && p.stock !== undefined;
          return {
            ...i,
            name: p.name,
            price: p.price,
            image: p.images?.[0] || "",
            qty: tracked ? Math.min(i.qty, p.stock) : i.qty,
          };
        })
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
