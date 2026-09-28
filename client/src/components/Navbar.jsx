import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useCart } from "../context/CartContext.jsx";

export default function Navbar() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    setQ(params.get("q") || "");
  }, [params]);

  function submitSearch(e) {
    e.preventDefault();
    const term = q.trim();
    setOpen(false);
    if (term) navigate(`/collection?q=${encodeURIComponent(term)}`);
    else navigate("/collection");
  }

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand brand-image" onClick={() => setOpen(false)}>
          <img className="brand-logo-full" src="/logo.jpeg" alt="Pankaj Enterprises Sarees" />
        </Link>

        <nav className={`nav-links ${open ? "open" : ""}`} onClick={() => setOpen(false)}>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/collection">Collection</NavLink>

          <form
            className="nav-search"
            onSubmit={submitSearch}
            onClick={(e) => e.stopPropagation()}
            role="search"
          >
            <input
              type="search"
              placeholder="Search sarees…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search sarees"
            />
            <button type="submit" aria-label="Search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
          </form>
        </nav>

        {/* Outside the menu, so the cart is one tap away on phones too. */}
        <div className="nav-actions">
          <Link
            to="/cart"
            className="cart-btn"
            aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"}
            onClick={() => setOpen(false)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true">
              <path d="M6 7h12l-1 13H7L6 7z" />
              <path d="M9 7a3 3 0 0 1 6 0" />
            </svg>
            <span className="cart-label">Cart</span>
            {count > 0 && <span className="cart-badge">{count}</span>}
          </Link>
          <button
            className="nav-toggle"
            aria-label="Menu"
            onClick={() => setOpen((o) => !o)}
          >
            <span /><span /><span />
          </button>
        </div>
      </div>
    </header>
  );
}
