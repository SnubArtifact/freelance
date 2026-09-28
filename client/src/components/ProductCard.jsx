import { useState } from "react";
import { Link } from "react-router-dom";
import { formatPrice } from "../api.js";
import { assetUrl } from "../config.js";
import { imageFor, lineKey, useCart } from "../context/CartContext.jsx";
import ColorSwatches from "./ColorSwatches.jsx";

export default function ProductCard({ product }) {
  const { items, addToCart } = useCart();
  const colors = product.colors || [];
  const [colorName, setColorName] = useState(colors[0]?.name || null);
  const color = colors.find((c) => c.name === colorName) || null;
  const img = imageFor(product, color);
  const href = `/product/${product.id}${color ? `?color=${encodeURIComponent(color.name)}` : ""}`;
  const inCart = items.some(
    (i) => i.key === lineKey({ id: product.id, color: color?.name })
  );
  const discount =
    product.originalPrice && product.originalPrice > product.price
      ? Math.round(
          ((product.originalPrice - product.price) / product.originalPrice) * 100
        )
      : 0;

  return (
    <div className="card">
      <Link to={href} className="card-media">
        {img ? (
          <img src={assetUrl(img)} alt={product.name} loading="lazy" />
        ) : (
          <div className="card-media placeholder">No image</div>
        )}
        {discount > 0 && <span className="card-badge">{discount}% OFF</span>}
        {!product.inStock && <span className="card-sold">Sold Out</span>}
      </Link>
      <div className="card-body">
        <span className="card-cat">{product.category}</span>
        <Link to={href} className="card-title">{product.name}</Link>
        <div className="card-price">
          <span className="now">{formatPrice(product.price)}</span>
          {discount > 0 && (
            <span className="was">{formatPrice(product.originalPrice)}</span>
          )}
        </div>
        {colors.length > 0 && (
          <ColorSwatches
            colors={colors}
            selected={colorName}
            onSelect={setColorName}
            size="small"
          />
        )}
        <div className="card-actions">
          {!product.inStock ? (
            <button className="btn btn-ghost small full" disabled>
              Sold Out
            </button>
          ) : inCart ? (
            <Link to="/cart" className="btn btn-primary small full">
              Go to Cart →
            </Link>
          ) : (
            <button
              className="btn btn-ghost small full"
              onClick={() => addToCart(product, 1, colorName)}
            >
              Add to Cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
