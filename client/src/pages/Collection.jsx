import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import ProductCard from "../components/ProductCard.jsx";

export default function Collection() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState("new");

  const activeCategory = params.get("category") || "All";

  useEffect(() => {
    api
      .listProducts()
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean));
    return ["All", ...[...set].sort()];
  }, [products]);

  const visible = useMemo(() => {
    let list =
      activeCategory === "All"
        ? products
        : products.filter((p) => p.category === activeCategory);
    list = [...list];
    if (sort === "low") list.sort((a, b) => a.price - b.price);
    else if (sort === "high") list.sort((a, b) => b.price - a.price);
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [products, activeCategory, sort]);

  function selectCategory(cat) {
    if (cat === "All") setParams({});
    else setParams({ category: cat });
  }

  return (
    <div className="page collection">
      <div className="page-head">
        <span className="eyebrow">Our Collection</span>
        <h1>Explore the Drapes</h1>
        <p>Find the perfect saree for every occasion.</p>
      </div>

      <div className="collection-bar">
        <div className="filter-chips">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`chip ${activeCategory === cat ? "active" : ""}`}
              onClick={() => selectCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        <select
          className="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="new">Newest</option>
          <option value="low">Price: Low to High</option>
          <option value="high">Price: High to Low</option>
        </select>
      </div>

      {loading ? (
        <div className="grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card skeleton" />
          ))}
        </div>
      ) : visible.length ? (
        <div className="grid">
          {visible.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <p className="empty">No sarees in this category yet.</p>
      )}
    </div>
  );
}
