import { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatPrice } from "../api.js";
import { assetUrl } from "../config.js";
import { colorOf, lineKey, useCart } from "../context/CartContext.jsx";
import ColorSwatches from "../components/ColorSwatches.jsx";

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { items, addToCart } = useCart();
  // The chosen colour lives in the address, so it survives a refresh and can
  // be shared.
  const [params, setParams] = useSearchParams();
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

  const colors = product.colors || [];
  const color = colorOf(product, params.get("color")) || colors[0] || null;
  const inCart = items.some((i) => i.key === lineKey({ id: product.id, color: color?.name }));

  function pickColor(name) {
    setParams({ color: name }, { replace: true });
    setActive(0);
  }

  function handleAdd() {
    addToCart(product, 1, color?.name);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  function buyNow() {
    if (!inCart) addToCart(product, 1, color?.name);
    navigate("/checkout");
  }

  // A colour with its own photos shows those; otherwise the saree's.
  const images = color?.images?.length
    ? color.images
    : product.images?.length
    ? product.images
    : [""];

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
              <img
                src={assetUrl(images[active])}
                alt={color ? `${product.name} in ${color.name}` : product.name}
              />
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
                  <img src={assetUrl(src)} alt={`${product.name} ${i + 1}`} />
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

          {colors.length > 0 && (
            <div className="detail-colors">
              <span className="detail-colors-label">
                Colour: <strong>{color?.name}</strong>
              </span>
              <ColorSwatches
                colors={colors}
                selected={color?.name}
                onSelect={pickColor}
              />
            </div>
          )}

          <p className="detail-desc">{product.description}</p>

          <ul className="spec">
            {product.fabric && (
              <li><span>Fabric</span><strong>{product.fabric}</strong></li>
            )}
            {product.color && !colors.length && (
              <li><span>Color</span><strong>{product.color}</strong></li>
            )}
            <li>
              <span>Availability</span>
              <strong className={product.inStock ? "ok" : "no"}>
                {!product.inStock
                  ? "Sold Out"
                  : product.stock > 0 && product.stock <= 5
                  ? `Only ${product.stock} left`
                  : "In Stock"}
              </strong>
            </li>
          </ul>

          <div className="detail-actions">
            <button
              className="btn btn-primary"
              disabled={!product.inStock}
              onClick={handleAdd}
            >
              {added ? "Added ✓" : inCart ? "Add Another" : "Add to Cart"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={!product.inStock}
              onClick={buyNow}
            >
              Buy Now
            </button>
          </div>
          {inCart && (
            <Link to="/cart" className="btn btn-ghost full go-cart">
              Go to Cart →
            </Link>
          )}

          <div className="detail-trust">
            <span>✦ Authentic weave</span>
            <span>✦ Free Pan-India shipping</span>
            <span>✦ 7-day returns</span>
          </div>
        </div>
      </div>
    </div>
  );
}
