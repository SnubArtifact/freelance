# Pankaj Enterprises — Boutique Storefront + Admin Panel

A full-stack platform to showcase your saree collection, sell online, and manage
inventory from a private admin panel. Sarees you add in the admin appear on the
storefront instantly. Customers check out as guests — they enter their details at
checkout and receive an order confirmation by email (no account required).

## Tech
- **Frontend:** React + Vite + React Router (elegant boutique UI)
- **Backend:** Express + image uploads
- **Database:** SQLite (via `better-sqlite3`) stores all orders; the product
  catalog stays in a JSON file. No separate database server to run.
- **Payments:** HDFC SmartGateway (UPI / cards / netbanking) via its hosted
  payment page, with a server-to-server order-status check before any order is
  marked paid; falls back to demo mode when keys aren't set

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

Signing in gives the browser a signed session token that lasts **7 days** and
survives server restarts and deploys. Changing `ADMIN_PASSWORD` signs every
admin out, because the signing key is derived from it (set
`ADMIN_TOKEN_SECRET` to use a separate key instead). When a session expires,
the admin panel sends you back to the login page with a "session expired"
note instead of failing with "Unauthorized".

Always set your own `ADMIN_PASSWORD` in production — with the default, anyone
who knows it can sign in.

## Using the admin panel
1. Go to `/admin`, sign in with the password.
2. Fill in saree name, price, category, fabric, color, description.
3. Upload images (stored on the server) **or** paste an image URL.
4. Tick **Feature on homepage** to show it in the hero/featured section.
5. Save — it appears in the storefront collection immediately.
6. Edit or delete any saree from the list on the right.

## Stock
Each saree has an optional **stock count**, set in the admin form or with the
**+ Stock** button on any row in the catalog list.

- **Leave it blank** to not track a count. Availability then rests on the
  *In stock* checkbox alone — this is how every product behaves by default.
- **Set a number** and the server enforces it: an order for more than you have is
  refused, the count drops when an order is actually paid for, and an item that
  reaches zero flips itself to sold out.
- Restocking a sold-out saree puts it back on sale automatically.
- The storefront shows "Only N left" once a tracked item is down to 5 or fewer.

Stock only comes down on **paid** orders — an abandoned payment leaves it alone.

## Guest checkout & email confirmation
- No sign-up. At checkout the customer enters name, email, phone, and shipping
  address, then pays online (UPI / card / netbanking via HDFC SmartGateway).
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

## Accepting real payments (HDFC SmartGateway)
1. Get your credentials from the SmartGateway dashboard: the **API key**, your
   **merchant id**, and the **payment_page_client_id**.
2. In the `server/` folder, copy `.env.example` to `.env` and fill in:
   ```
   HDFC_API_KEY=your-raw-api-key      # Base64 is applied for you
   HDFC_MERCHANT_ID=your-merchant-id
   HDFC_CLIENT_ID=hdfcmaster          # "hdfcmaster" for sandbox
   HDFC_ENV=sandbox                   # or "production" when live
   PUBLIC_SERVER_URL=http://localhost:5050
   CLIENT_URL=http://localhost:5173
   ```
3. Restart with `npm run dev`. Checkout now redirects to HDFC's hosted payment
   page instead of the demo modal.

### How the flow works
1. `POST /api/payments/hdfc/session` — the browser sends only *which* product and
   *how many*. The server looks each one up in the catalog and rebuilds the cart
   with its own prices, records a **Pending** order, and asks SmartGateway for a
   hosted payment-page link. A tampered price in the request is ignored.
2. The shopper is redirected there and pays.
3. HDFC sends them back to `PUBLIC_SERVER_URL + /api/payments/hdfc/return`. The
   server then makes its own **server-to-server** call to
   `GET /orders/{order_id}` and only marks the order paid when the status is
   `CHARGED` **and** the amount matches. A browser cannot fake a paid order.
4. The shopper is redirected to `CLIENT_URL/checkout?status=success|failed`.

### Checking which mode you're in
`GET /api/payments/config` returns `{"configured": true}` when real keys are
loaded. The checkout page shows the same thing as a badge: **"Secured by HDFC
SmartGateway"** vs **"Demo mode"**.

- Without keys, online checkout still works in **demo mode** (marked "Demo mode",
  no real charge) so you can test the full flow. Once keys *are* set, the demo
  order endpoint refuses to record orders directly — payment must go through the
  gateway.
- `PUBLIC_SERVER_URL` must be the API's public **https** origin in production;
  HDFC redirects the shopper there, so `localhost` will not work once deployed.

## Brand logo
- The logo at `client/public/logo.jpeg` is used in the navbar and as the favicon.
  To change it, replace that file (keep the name `logo.jpeg`).

## Notes
- Product data lives in `server/data/products.json`; uploaded images in
  `server/uploads/`. Both are created automatically and are git-ignored.
- Orders are stored in a SQLite database at `server/data/haveli.db` (git-ignored).
  Any old `server/data/orders.json` is auto-imported into the database on first
  start, then renamed to `orders.json.bak`.
- For production, build the client (`npm --prefix client run build`) and serve it,
  and replace the simple token auth with real auth over HTTPS.
- The storefront finds the API through the **`VITE_API_BASE`** build-time
  variable (see `client/.env.production.example`). It is baked into the bundle at
  build time, so it must be set in the hosting provider's environment *before*
  the build runs — if it is missing, the deployed site silently shows an empty
  catalog. Leave it unset for local dev, where Vite proxies to the server.
- On a host with ephemeral storage, set **`DATA_DIR`** to a mounted persistent
  disk (Render: `/var/data`). `products.json`, the SQLite database, and uploaded
  images all live there — without it, your catalog and orders are wiped on every
  deploy and the sample sarees are re-seeded.
