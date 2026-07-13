import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <div className="brand-mark footer-brand">Haveli Wale</div>
          <p className="footer-text">
            Handpicked sarees woven with tradition — Kanjivaram, Banarasi, silk
            and cotton drapes for every celebration.
          </p>
        </div>
        <div>
          <h4>Shop</h4>
          <Link to="/collection">All Sarees</Link>
          <Link to="/collection">New Arrivals</Link>
          <Link to="/cart">Your Cart</Link>
        </div>
        <div>
          <h4>Help</h4>
          <a href="mailto:hello@haveliwale.com">Contact Us</a>
          <a href="#">Shipping &amp; Returns</a>
          <a href="#">Size &amp; Care Guide</a>
        </div>
        <div>
          <h4>Visit</h4>
          <p className="footer-text">
            Mon–Sat, 10am–8pm<br />
            
            Near Kanya Patshala, Nahar wali gali, Sikar, Rajasthan, 332001<br />
            +91 9625861356
          </p>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Haveli Wale. Crafted with love.</span>
        <Link to="/admin" className="admin-link">Admin</Link>
      </div>
    </footer>
  );
}
