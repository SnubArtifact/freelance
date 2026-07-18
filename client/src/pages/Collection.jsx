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
  const query = (params.get("q") || "").trim().toLowerCase();

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
    if (query) {
      list = list.filter((p) =>
        [p.name, p.description, p.category]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      );
    }
    list = [...list];
    if (sort === "low") list.sort((a, b) => a.price - b.price);
    else if (sort === "high") list.sort((a, b) => b.price - a.price);
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [products, activeCategory, sort, query]);

  function selectCategory(cat) {
    const next = {};
    if (cat !== "All") next.category = cat;
    if (query) next.q = params.get("q");
    setParams(next);
  }

  function clearSearch() {
    const next = {};
    if (activeCategory !== "All") next.category = activeCategory;
    setParams(next);
  }

  return (
    <div className="page collection">
      <div className="page-head">
        <span className="eyebrow">Our Collection</span>
        <h1>Explore the Drapes</h1>
        <p>Find the perfect saree for every occasion.</p>
        {query && (
          <p className="search-info">
            Showing results for <strong>“{params.get("q")}”</strong>{" "}
            <button className="link-arrow" onClick={clearSearch}>Clear</button>
          </p>
        )}
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
