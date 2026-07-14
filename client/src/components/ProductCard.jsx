import { Link } from "react-router-dom";
import { formatPrice } from "../api.js";
import { assetUrl } from "../config.js";

export default function ProductCard({ product }) {
  const img = product.images?.[0];
  const discount =
    product.originalPrice && product.originalPrice > product.price
      ? Math.round(
          ((product.originalPrice - product.price) / product.originalPrice) * 100
        )
      : 0;

  return (
    <Link to={`/product/${product.id}`} className="card">
      <div className="card-media">
        {img ? (
          <img src={assetUrl(img)} alt={product.name} loading="lazy" />
        ) : (
          <div className="card-media placeholder">No image</div>
        )}
        {discount > 0 && <span className="card-badge">{discount}% OFF</span>}
        {!product.inStock && <span className="card-sold">Sold Out</span>}
      </div>
      <div className="card-body">
        <span className="card-cat">{product.category}</span>
        <h3 className="card-title">{product.name}</h3>
        <div className="card-price">
          <span className="now">{formatPrice(product.price)}</span>
          {discount > 0 && (
            <span className="was">{formatPrice(product.originalPrice)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
