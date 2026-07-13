import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import ProductCard from "../components/ProductCard.jsx";

const CATEGORIES = [
  { name: "Kanjivaram", tag: "Heirloom silk" },
  { name: "Banarasi", tag: "Festive weaves" },
  { name: "Georgette", tag: "Designer drapes" },
  { name: "Cotton", tag: "Everyday ease" },
];

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listProducts()
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  const featured = products.filter((p) => p.featured).slice(0, 4);
  const showcase = (featured.length ? featured : products).slice(0, 4);

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

      {/* Categories */}
      <section className="cats">
        {CATEGORIES.map((c) => (
          <Link
            key={c.name}
            to={`/collection?category=${encodeURIComponent(c.name)}`}
            className="cat-chip"
          >
            <span className="cat-name">{c.name}</span>
            <span className="cat-tag">{c.tag}</span>
          </Link>
        ))}
      </section>

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
            {Array.from({ length: 4 }).map((_, i) => (
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
          <strong>Pan-India Shipping</strong>
          <span>Safely delivered to your doorstep</span>
        </div>
        
      </section>
    </div>
  );
}
