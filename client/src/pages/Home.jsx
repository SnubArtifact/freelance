import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import ProductCard from "../components/ProductCard.jsx";

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    api
      .listProducts()
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
    api
      .listCategories()
      .then((list) => setCategories(list.filter((c) => c.home)))
      .catch(() => {});
  }, []);

  const featured = products.filter((p) => p.featured).slice(0, 6);
  const showcase = (featured.length ? featured : products).slice(0, 6);

  return (
    <div className="home">
      {/* Hero */}
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Handwoven · Curated · Timeless</span>
          <h1>
            Drape yourself in <em>elegance</em>
          </h1>
          <p>
            Discover a curated collection of authentic sarees — from regal
            Kanjivaram silks to breezy handloom cottons, woven for moments worth
            remembering.
          </p>
          <div className="hero-cta">
            <Link to="/collection" className="btn btn-primary">
              Shop the Collection
            </Link>
            <Link to="/collection" className="btn btn-ghost">
              New Arrivals
            </Link>
          </div>
        </div>
        <div className="hero-media">
          <img
            src="https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=900&q=80"
            alt="Featured saree"
          />
          <div className="hero-float">
            <span className="hero-float-num">25+ yrs</span>
            <span className="hero-float-label">of weaving heritage</span>
          </div>
        </div>
      </section>

      {/* Categories — the ones the admin marked "show on homepage" */}
      {categories.length > 0 && (
      <section className="cats">
        {categories.map((c) => (
          <Link
            key={c.name}
            to={`/collection?category=${encodeURIComponent(c.name)}`}
            className="cat-chip"
          >
            <span className="cat-name">{c.name}</span>
            {c.tagline && <span className="cat-tag">{c.tagline}</span>}
          </Link>
        ))}
      </section>
      )}

      {/* Featured */}
      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Editor's picks</span>
            <h2>Featured Sarees</h2>
          </div>
          <Link to="/collection" className="link-arrow">
            View all →
          </Link>
        </div>

        {loading ? (
          <div className="grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card skeleton" />
            ))}
          </div>
        ) : showcase.length ? (
          <div className="grid">
            {showcase.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="empty">No sarees yet. Add some from the admin panel.</p>
        )}
      </section>

      {/* Promise band */}
      <section className="promise">
        <div className="promise-item">
          <strong>Authentic Weaves</strong>
          <span>Sourced directly from master weavers</span>
        </div>
        <div className="promise-item">
          <strong>Free Pan-India Shipping</strong>
          <span>No delivery charge on any order</span>
        </div>
        
      </section>
    </div>
  );
}
