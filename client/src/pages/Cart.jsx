import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { formatPrice } from "../api.js";
import { assetUrl } from "../config.js";

export default function Cart() {
  const { items, updateQty, removeFromCart, subtotal } = useCart();

  if (!items.length) {
    return (
      <div className="page">
        <div className="empty-state">
          <h1>Your cart is empty</h1>
          <p>Looks like you haven't added any sarees yet.</p>
          <Link to="/collection" className="btn btn-primary">
            Browse Collection
          </Link>
        </div>
      </div>
    );
  }

  const shipping = subtotal > 4999 ? 0 : 99;

  return (
    <div className="page cart">
      <div className="page-head">
        <h1>Your Cart</h1>
      </div>

      <div className="cart-grid">
        <div className="cart-items">
          {items.map((item) => (
            <div key={item.id} className="cart-row">
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
                <span className="cart-unit">{formatPrice(item.price)}</span>
              </div>
              <div className="qty">
                <button onClick={() => updateQty(item.id, item.qty - 1)}>−</button>
                <span>{item.qty}</span>
                <button onClick={() => updateQty(item.id, item.qty + 1)}>+</button>
              </div>
              <div className="cart-line">{formatPrice(item.price * item.qty)}</div>
              <button
                className="cart-remove"
                onClick={() => removeFromCart(item.id)}
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
            <span>{shipping === 0 ? "Free" : formatPrice(shipping)}</span>
          </div>
          <div className="sum-row total">
            <span>Total</span>
            <span>{formatPrice(subtotal + shipping)}</span>
          </div>
          {shipping > 0 && (
            <p className="sum-note">
              Add {formatPrice(5000 - subtotal)} more for free shipping.
            </p>
          )}
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
