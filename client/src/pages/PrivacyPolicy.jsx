export default function PrivacyPolicy() {
  return (
    <div className="page policy">
      <div className="page-head">
        <span className="eyebrow">Legal</span>
        <h1>Privacy Policy</h1>
        <p>How we handle your information at Haveli Wale.</p>
      </div>

      <div className="policy-body">
        <p>
          This Privacy Policy explains how Haveli Wale ("we", "us", "our")
          collects, uses, and protects the information you share with us when
          you visit haveliwale.com or place an order with us. By using the
          site, you agree to the practices described below.
        </p>

        <h2>1. Information We Collect</h2>
        <p>When you place an order or contact us, we collect:</p>
        <ul>
          <li>Your name, delivery address, phone number, and email address.</li>
          <li>Order details — items, quantities, and total amount.</li>
          <li>Payment reference IDs from our payment gateway (Paytm). We do
            <strong> not </strong>store your card number, UPI PIN, CVV, or bank
            login details on our servers.</li>
          <li>Basic technical information such as your browser type and
            general location, used only to keep the site working smoothly.</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>To process, pack, and deliver your order.</li>
          <li>To send order confirmations, shipping updates, and reply to
            questions you send us.</li>
          <li>To keep records required by Indian tax and consumer laws.</li>
          <li>To detect and prevent fraud on our website.</li>
        </ul>

        <h2>3. Sharing With Third Parties</h2>
        <p>We only share your details with:</p>
        <ul>
          <li>Our courier partners, so they can deliver your saree to you.</li>
          <li>Our payment gateway (Paytm), for processing your payment.</li>
          <li>Government or law enforcement agencies, only when legally
            required.</li>
        </ul>
        <p>We do not sell, rent, or trade your information to anyone else.</p>

        <h2>4. Cookies</h2>
        <p>
          We use a small amount of browser storage to remember what you have
          added to your cart and to keep you signed in to the admin panel.
          You can clear this at any time from your browser settings.
        </p>

        <h2>5. Data Retention</h2>
        <p>
          Order records are kept for as long as needed to serve you and to
          meet our legal obligations. You may ask us to delete your personal
          details at any time by writing to us.
        </p>

        <h2>6. Your Rights</h2>
        <p>
          You can ask us to view, correct, or delete the information we hold
          about you. Please write to us at
          {" "}<a href="mailto:hello@haveliwale.com">hello@haveliwale.com</a>{" "}
          and we will respond within a reasonable time.
        </p>

        <h2>7. Security</h2>
        <p>
          We take reasonable steps to protect your data, but no method of
          transmission over the internet is fully secure. Please keep your
          own login details safe.
        </p>

        <h2>8. Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. The latest version
          will always be available on this page.
        </p>

        <h2>9. Contact</h2>
        <p>
          Haveli Wale<br />
          Near Kanya Patshala, Nahar wali gali, Sikar, Rajasthan – 332001<br />
          Phone: +91 96258 61356<br />
          Email: <a href="mailto:hello@haveliwale.com">hello@haveliwale.com</a>
        </p>
      </div>
    </div>
  );
}
