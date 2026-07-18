import { Link } from "react-router-dom";

const INSTAGRAM_URL = "https://www.instagram.com/haveliwale";
const FACEBOOK_URL = "https://www.facebook.com/haveliwale";

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
          <div className="social-row">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Haveli Wale on Instagram"
              className="social-icon"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
              </svg>
            </a>
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Haveli Wale on Facebook"
              className="social-icon"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.5 21v-8h2.7l.4-3.2h-3.1V7.7c0-.9.3-1.6 1.6-1.6h1.7V3.2C16.5 3.1 15.5 3 14.4 3c-2.4 0-4 1.4-4 4.1v2.7H7.6V13h2.8v8h3.1z" />
              </svg>
            </a>
          </div>
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
          <Link to="/return-policy">Return Policy</Link>
          <Link to="/privacy-policy">Privacy Policy</Link>
          <Link to="/terms-and-conditions">Terms &amp; Conditions</Link>
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
