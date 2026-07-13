import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, formatPrice } from "../api.js";
import { useCart } from "../context/CartContext.jsx";

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getProduct(id)
      .then((p) => {
        setProduct(p);
        setActive(0);
      })
      .catch(() => setError("This saree could not be found."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page"><p className="empty">Loading…</p></div>;
  if (error || !product)
    return (
      <div className="page">
        <p className="empty">{error || "Not found."}</p>
        <Link to="/collection" className="btn btn-ghost">Back to collection</Link>
      </div>
    );

  const discount =
    product.originalPrice && product.originalPrice > product.price
      ? Math.round(
          ((product.originalPrice - product.price) / product.originalPrice) * 100
        )
      : 0;

  function handleAdd() {
    addToCart(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  function buyNow() {
    addToCart(product);
    navigate("/checkout");
  }

  const images = product.images?.length ? product.images : [""];

  return (
    <div className="page detail">
      <div className="breadcrumb">
        <Link to="/">Home</Link> / <Link to="/collection">Collection</Link> /{" "}
        <span>{product.name}</span>
      </div>

      <div className="detail-grid">
        <div className="detail-gallery">
          <div className="detail-main">
            {images[active] ? (
              <img src={images[active]} alt={product.name} />
            ) : (
              <div className="placeholder">No image</div>
            )}
          </div>
          {images.length > 1 && (
            <div className="thumbs">
              {images.map((src, i) => (
                <button
                  key={i}
                  className={`thumb ${i === active ? "active" : ""}`}
                  onClick={() => setActive(i)}
                >
                  <img src={src} alt={`${product.name} ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-info">
          <span className="eyebrow">{product.category}</span>
          <h1>{product.name}</h1>

          <div className="detail-price">
            <span className="now">{formatPrice(product.price)}</span>
            {discount > 0 && (
              <>
                <span className="was">{formatPrice(product.originalPrice)}</span>
                <span className="save">Save {discount}%</span>
              </>
            )}
          </div>

          <p className="detail-desc">{product.description}</p>

          <ul className="spec">
            {product.fabric && (
              <li><span>Fabric</span><strong>{product.fabric}</strong></li>
            )}
            {product.color && (
              <li><span>Color</span><strong>{product.color}</strong></li>
            )}
            <li>
              <span>Availability</span>
              <strong className={product.inStock ? "ok" : "no"}>
                {product.inStock ? "In Stock" : "Sold Out"}
              </strong>
            </li>
          </ul>

          <div className="detail-actions">
            <button
              className="btn btn-primary"
              disabled={!product.inStock}
              onClick={handleAdd}
            >
              {added ? "Added ✓" : "Add to Cart"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={!product.inStock}
              onClick={buyNow}
            >
              Buy Now
            </button>
          </div>

          <div className="detail-trust">
            <span>✦ Authentic weave</span>
            <span>✦ Pan-India shipping</span>
            <span>✦ 7-day returns</span>
          </div>
        </div>
      </div>
    </div>
  );
}
