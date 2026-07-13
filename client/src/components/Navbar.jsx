import { Link, NavLink } from "react-router-dom";
import { useState } from "react";
import { useCart } from "../context/CartContext.jsx";

export default function Navbar() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand brand-image" onClick={() => setOpen(false)}>
          <img className="brand-logo-full" src="/logo.jpeg" alt="Haveli Wale Sarees" />
        </Link>

        <button
          className="nav-toggle"
          aria-label="Menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span /><span /><span />
        </button>

        <nav className={`nav-links ${open ? "open" : ""}`} onClick={() => setOpen(false)}>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/collection">Collection</NavLink>
          <Link to="/cart" className="cart-link">
            Cart
            {count > 0 && <span className="cart-badge">{count}</span>}
          </Link>
        </nav>
      </div>
    </header>
  );
}
