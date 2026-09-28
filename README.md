# Pankaj Enterprises — Boutique Storefront + Admin Panel

A full-stack platform to showcase your saree collection, sell online, and manage
inventory from a private admin panel. Sarees you add in the admin appear on the
storefront instantly. Customers check out as guests — they enter their details at
checkout and receive an order confirmation by email (no account required).

## Tech
- **Frontend:** React + Vite + React Router (elegant boutique UI)
- **Backend:** Express
- **Database:** Postgres — Supabase (free plan) in production; an embedded
  Postgres (PGlite) for local development, so there's nothing to install.
  Sarees, stock, orders and a log of every payment step are kept here.
- **Photos:** Supabase Storage in production; a local folder in development.
- **Payments:** Razorpay or HDFC SmartGateway (UPI / cards / netbanking).
  Whichever gateway is configured, no order is marked paid until the server has
  confirmed it with the gateway itself; falls back to demo mode when no keys
  are set.

## Admin panel — two tabs
- **Catalog:** add / edit / delete sarees (with image upload) — changes appear on
  the storefront instantly.
- **Orders:** every customer order with paid revenue, customer contact,
  shipping address, items, and payment status. Click a row for details, the
  order's payment log, and a **Check status with HDFC** button. The Orders tab
  also has a **Check payment gateway** panel that explains, in plain words, any
  problem with the HDFC keys.

## Project layout
```
saree/
├── client/        # React storefront + admin UI
├── server/        # Express API, database, photos, HDFC integration
│   └── test/      # automated tests (npm --prefix server test)
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

Locally, everything is saved in `server/data/` (database in `pgdata/`, photos in
`uploads/`, both git-ignored). A brand-new local database starts with a few sample
sarees, or with the sarees from an old `server/data/products.json` if there is one.

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
note instead of failing with "Unauthorized". After 10 wrong passwords from one
address, sign-in is refused for 15 minutes.

Always set your own `ADMIN_PASSWORD` in production — with the default, anyone
who knows it can sign in.

## Using the admin panel
1. Go to `/admin`, sign in with the password.
2. Fill in saree name, price, category, fabric, color, description.
3. Upload images **or** paste an image URL. Photos are shrunk in the browser
   before upload (longest side 1600px) so the shop loads quickly.
4. Tick **Feature on homepage** to show it in the hero/featured section.
5. Save — it appears in the storefront collection immediately.
6. Edit or delete any saree from the list on the right. Photos no saree uses any
   more are deleted automatically.

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

## Keeping your data: Supabase (free)
Render's free plan erases its disk on every restart, deploy and wake-up from
sleep, so in production the shop keeps everything in Supabase instead. The
server creates its tables and the public `sarees` photo bucket by itself.

1. Create a free project at [supabase.com](https://supabase.com). Pick the region
   closest to the Render server (Render's Oregon → Supabase **West US**), and save
   the database password somewhere safe.
2. **Connect** → **Session pooler** → copy the connection string and put your
   database password in it. (Use the *Session pooler*: Render needs IPv4, which
   the direct connection doesn't offer.) If the password has special characters
   such as `@ # / ?`, [URL-encode](https://www.urlencoder.org/) them.
3. **Project Settings → API Keys** → copy a **secret key** (`sb_secret_…`, or the
   legacy `service_role` key), and the **Project URL** (`https://….supabase.co`).
4. In Render → your service → **Environment**, set:
   ```
   DATABASE_URL=postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_KEY=sb_secret_…
   ```
   and save. Render redeploys; the server log shows
   `sarees and orders: postgres database; photos: supabase`, and the red
   "not kept" banner in the admin panel disappears.

The secret key can do anything in your project: keep it on the server only,
never in the storefront or in git. The shop's tables live in a `shop` schema
that Supabase's public API doesn't expose, with row level security on as well.

A free Supabase project pauses after **a week without requests**. The GitHub
Action in `.github/workflows/keep-alive.yml` visits `/api/health?deep=1` once a
day, which wakes the API and touches the database and photo storage. (GitHub
turns scheduled workflows off in repositories with no activity for 60 days; if
that happens, re-enable it in the repository's **Actions** tab.)

## Guest checkout & email confirmation
- No sign-up. At checkout the customer enters name, email, phone, and shipping
  address, then pays online (UPI / card / netbanking via HDFC SmartGateway).
- The saved cart is checked against the live catalog whenever the cart or
  checkout opens: sarees that were removed or sold out are taken out with a note,
  and prices are refreshed.
- After payment, a confirmation email with the order summary is sent to the
  customer's email address (see SMTP setup below).
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

## Which gateway takes the money
Whichever one is configured, checked in this order:

1. **Razorpay** — when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set.
2. **HDFC SmartGateway** — when its keys are set instead.
3. **Demo mode** — neither: a fake payment screen, so the flow can be tried
   without money.

`PAYMENT_PROVIDER=razorpay|hdfc|demo` forces one. `GET /api/payments/config`
reports which is live, and the checkout page shows it as a badge. Each order
records the gateway that took it, so orders taken through an older gateway are
still checked against that gateway afterwards.

## Accepting real payments (Razorpay)
1. Razorpay dashboard → **Account & Settings → API Keys** → generate keys.
   Test keys start with `rzp_test_`; orders paid with them are marked **TEST**
   everywhere so they're never shipped.
2. Set on the server (Render → Environment, or `server/.env` locally):
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=your-key-secret
   RAZORPAY_WEBHOOK_SECRET=the-webhook-secret
   ```
3. Razorpay dashboard → **Settings → Webhooks** → add a webhook for
   **payment.captured** and **payment.failed** pointing at
   `https://api.shophaveliwale.com/api/payments/razorpay/webhook`, and put its
   secret in `RAZORPAY_WEBHOOK_SECRET`.

The key **secret** and the webhook secret stay on the server. Only the key id
reaches the browser, which is what Razorpay expects.

### How the flow works
1. `POST /api/payments/razorpay/order` — the browser sends only *which* sarees
   and *how many*. The server rebuilds the cart from the database, records a
   pending order with a unique number, and asks Razorpay for an order for that
   exact amount.
2. Razorpay's own payment window opens on the shop's page.
3. On success it hands back a payment id, order id and signature. The server
   checks that signature with the key secret (HMAC-SHA256 of
   `order_id|payment_id`) and **refuses anything that doesn't match**, then
   reads the payment back from Razorpay: it must be *captured*, for this order,
   for this exact amount. A payment the bank has only authorised is captured
   first.
4. The receipt page shows the result from the shop's own database.

If the shopper closes the window, the shop asks Razorpay anyway — and the
webhook confirms the payment even if the browser never reports back.

## Accepting real payments (HDFC SmartGateway)
1. Get your credentials from the SmartGateway dashboard: the **API key**, your
   **merchant id**, the **payment_page_client_id** and the **Response Key**.
2. In the `server/` folder, copy `.env.example` to `.env` and fill in:
   ```
   HDFC_API_KEY=your-raw-api-key      # Base64 is applied for you
   HDFC_MERCHANT_ID=your-merchant-id
   HDFC_CLIENT_ID=hdfcmaster          # "hdfcmaster" for sandbox
   HDFC_ENV=sandbox                   # or "production" when live
   HDFC_RESPONSE_KEY=your-response-key
   PUBLIC_SERVER_URL=http://localhost:5050
   CLIENT_URL=http://localhost:5173
   ```
3. Restart with `npm run dev`. Checkout now redirects to HDFC's hosted payment
   page instead of the demo modal.

In production, `PUBLIC_SERVER_URL` must be the API's public **https** address
(`https://api.shophaveliwale.com`) and `CLIENT_URL` the storefront
(`https://www.shophaveliwale.com`). Orders taken while `HDFC_ENV=sandbox` are
marked **TEST** everywhere (admin, receipt, email) and must not be shipped.

### How the flow works
1. `POST /api/payments/hdfc/session` — the browser sends only *which* sarees and
   *how many*. The server rebuilds the cart from the database with its own
   prices, gives the order a unique number, records it as **Pending**, and asks
   SmartGateway for a payment page. The shopper is sent there only if it's on
   SmartGateway's own domain.
2. The shopper pays on HDFC's page.
3. HDFC sends them back to
   `PUBLIC_SERVER_URL/api/payments/hdfc/return/<code>`, where the code belongs to
   that one order. The server checks the code and the return's signature, logs
   both, then asks HDFC itself (`GET /orders/{order_id}`) — the dual inquiry.
   The order is marked paid only if HDFC says `CHARGED` for that order **and**
   amount; a mismatch is held for review. Nothing the browser brings back can
   mark an order paid.
4. The shopper lands on the receipt page (`/checkout?status=…&order=…&t=…`),
   which shows the order number, amount and result from the database, and keeps
   checking with HDFC while the bank is still confirming.

### Checking which mode you're in
`GET /api/payments/config` returns `{"configured": true, "provider": "…"}`
when real keys are loaded. The checkout page shows it as a badge: **"Secured by
Razorpay"**, **"Secured by HDFC SmartGateway"** or **"Demo mode"**. The admin
**Check payment gateway** panel tests the live gateway's keys without charging
anything.

## Security, and HDFC's audit checklist
These protections apply to whichever gateway is in use; the wording below
follows HDFC's checklist, since theirs is the formal audit.

| HDFC checkpoint | How the shop meets it |
|---|---|
| Unique order ID | `PE` + date + 8 characters from the OS's secure random generator; the database refuses any repeat. |
| Request tampering | Amounts always come from the database; the browser only sends product ids and quantities. |
| Response tampering | The return URL carries a code tied to its order; the return's HMAC signature is checked with the Response Key; the result is decided by the server-to-server Order Status call, whose order id and amount must match. Anything suspicious is logged. |
| URL redirection | Shoppers are only sent to payment pages on SmartGateway's own https domain (checked on the server and in the browser), and always come back to `CLIENT_URL`. |
| Duplicate entries | Order numbers and checkout submissions are unique; a payment is completed exactly once, so stock and the email happen once even if confirmations arrive together. |
| Receipt | The result page shows order number, amount, transaction id, date and a clear success/failure message; it can be printed, and an email receipt is sent. |
| SSL | HTTPS on the storefront (Vercel) and the API (Render), with HSTS. |

Also: every payment step is stored in the database (orders and
`shop.payment_events`), and the confirmation shown to the customer comes from
that database status. Receipts are only readable with the code from checkout, so
order numbers can't be used to look up other people's orders. The API only
accepts browser calls from the storefront, sends standard security headers,
escapes customer input in emails, and never writes the admin password to its log.

To share an **Order Status API response** with HDFC: admin → **Orders** → open
the order → **Check status with HDFC**. The reply is shown in full, ready to copy.

## Running the tests
```bash
npm --prefix server test
```
Includes end-to-end runs against a fake SmartGateway *and* a fake Razorpay:
tampered prices, forged signatures, payments belonging to another order,
wrong amounts, simultaneous confirmations, double submissions, redirects to
other sites, and webhooks.

## Brand logo
- The logo at `client/public/logo.jpeg` is used in the navbar and as the favicon.
  To change it, replace that file (keep the name `logo.jpeg`).

## Notes
- The storefront finds the API through the **`VITE_API_BASE`** build-time
  variable (see `client/.env.production.example`). It is baked into the bundle at
  build time, so it must be set in the hosting provider's environment *before*
  the build runs — if it is missing, the deployed site silently shows an empty
  catalog. Leave it unset for local dev, where Vite proxies to the server.
- The API accepts browser requests only from `CLIENT_URL` (and its www/bare-domain
  twin). Add any other storefront address to `ALLOWED_ORIGINS`.
