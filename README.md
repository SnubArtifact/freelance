# Haveli Wale — Boutique Storefront + Admin Panel

A full-stack platform to showcase your saree collection, sell online, and manage
inventory from a private admin panel. Sarees you add in the admin appear on the
storefront instantly. Customers check out as guests — they enter their details at
checkout and receive an order confirmation by email (no account required).

## Tech
- **Frontend:** React + Vite + React Router (elegant boutique UI)
- **Backend:** Express + image uploads
- **Database:** SQLite (via `better-sqlite3`) stores all orders; the product
  catalog stays in a JSON file. No separate database server to run.
- **Payments:** Razorpay (UPI / cards / netbanking) with secure server-side
  signature verification; falls back to demo mode when keys aren't set

## Admin panel — two tabs
- **Catalog:** add / edit / delete sarees (with image upload) — changes appear on
  the storefront instantly.
- **Orders:** every customer order with revenue totals, customer contact,
  shipping address, items, and payment status. Click a row to expand details.

## Project layout
```
saree/
├── client/        # React storefront + admin UI
├── server/        # Express API, image uploads, product data
└── package.json   # runs both together
```

## Getting started

### 1. Install everything (first time only)
```bash
npm run install:all
```

### 2. Run the app (frontend + backend together)
```bash
npm run dev
```
- Storefront → http://localhost:5173
- Admin panel → http://localhost:5173/admin  (also linked at the bottom of the site)
- API → http://localhost:5050

### Admin password
Default password is **`saree-admin`**. Change it by setting an environment
variable before starting the server, e.g. on Windows PowerShell:
```powershell
$env:ADMIN_PASSWORD = "your-secret"; npm run dev
```

## Using the admin panel
1. Go to `/admin`, sign in with the password.
2. Fill in saree name, price, category, fabric, color, description.
3. Upload images (stored on the server) **or** paste an image URL.
4. Tick **Feature on homepage** to show it in the hero/featured section.
5. Save — it appears in the storefront collection immediately.
6. Edit or delete any saree from the list on the right.

## Guest checkout & email confirmation
- No sign-up. At checkout the customer enters name, email, phone, and shipping
  address, then pays by Cash on Delivery or online (Razorpay).
- After the order is placed, a confirmation email with the order summary is sent
  to the customer's email address (see SMTP setup below).
- Orders appear in the admin **Orders** tab with full customer details.

## Sending real confirmation emails (SMTP)
1. In `server/`, copy `.env.example` to `.env`.
2. For Gmail: enable 2-Step Verification, create an **App Password**
   (Google Account -> Security -> App passwords), then set in `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=youraddress@gmail.com
   SMTP_PASS=your-16-char-app-password
   ```
3. Restart with `npm run dev`. Orders now send a real email.
- Without SMTP set, email runs in **demo mode** — the confirmation is logged to
  the server console instead of sent, so you can still test the flow.

## Accepting real payments (Razorpay)
1. Create a free account at https://dashboard.razorpay.com.
2. Go to **Settings → API Keys → Generate Key**. Copy the **Key Id** and **Key Secret**
   (use the **test** keys, `rzp_test_...`, while developing).
3. In the `server/` folder, copy `.env.example` to `.env` and paste your keys:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
   ```
4. Restart with `npm run dev`. The checkout's "UPI / Card / Netbanking" option now
   opens Razorpay's secure popup, and the server verifies the payment signature
   before saving the order.
- Without keys, online checkout still works in **demo mode** (marked "Demo mode",
  no real charge) so you can test the full flow.

## Brand logo
- The logo at `client/public/logo.jpeg` is used in the navbar and as the favicon.
  To change it, replace that file (keep the name `logo.jpeg`).

## Notes
- Product data lives in `server/data/products.json`; uploaded images in
  `server/uploads/`. Both are created automatically and are git-ignored.
- Orders are stored in a SQLite database at `server/data/haveli.db` (git-ignored).
  Any old `server/data/orders.json` is auto-imported into the database on first
  start, then renamed to `orders.json.bak`.
- Checkout is a working demo flow (no real payment gateway). To go live, plug in
  Razorpay/Stripe in `client/src/pages/Checkout.jsx` and add an orders endpoint.
- For production, build the client (`npm --prefix client run build`) and serve it,
  and replace the simple token auth with real auth over HTTPS.
