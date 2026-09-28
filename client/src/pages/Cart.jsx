import { Link } from "react-router-dom";
import { useCart, useCartCheck } from "../context/CartContext.jsx";
import { formatPrice } from "../api.js";
import { assetUrl } from "../config.js";

export default function Cart() {
  const { items, updateQty, removeFromCart, subtotal } = useCart();
  // Drops sarees that were deleted or sold out since they were added.
  const { notice } = useCartCheck();

  if (!items.length) {
    return (
      <div className="page">
        <div className="empty-state">
          <h1>Your cart is empty</h1>
          <p>{notice || "Looks like you haven't added any sarees yet."}</p>
          <Link to="/collection" className="btn btn-primary">
            Browse Collection
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page cart">
      <div className="page-head">
        <h1>Your Cart</h1>
      </div>

      {notice && <div className="alert">{notice}</div>}

      <div className="cart-grid">
        <div className="cart-items">
          {items.map((item) => (
            <div key={item.key} className="cart-row">
              <Link to={`/product/${item.id}`} className="cart-thumb">
                {item.image ? (
                  <img src={assetUrl(item.image)} alt={item.name} />
                ) : (
                  <div className="placeholder">—</div>
                )}
              </Link>
              <div className="cart-meta">
                <Link to={`/product/${item.id}`} className="cart-name">
                  {item.name}
                </Link>
                {item.color && <span className="cart-color">Colour: {item.color}</span>}
                <span className="cart-unit">{formatPrice(item.price)}</span>
              </div>
              <div className="qty">
                <button onClick={() => updateQty(item.key, item.qty - 1)}>−</button>
                <span>{item.qty}</span>
                <button onClick={() => updateQty(item.key, item.qty + 1)}>+</button>
              </div>
              <div className="cart-line">{formatPrice(item.price * item.qty)}</div>
              <button
                className="cart-remove"
                onClick={() => removeFromCart(item.key)}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <aside className="cart-summary">
          <h3>Order Summary</h3>
          <div className="sum-row">
            <span>Subtotal</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="sum-row">
            <span>Shipping</span>
            <span>Free</span>
          </div>
          <div className="sum-row total">
            <span>Total</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <Link to="/checkout" className="btn btn-primary full">
            Proceed to Checkout
          </Link>
          <Link to="/collection" className="link-arrow center">
            ← Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
