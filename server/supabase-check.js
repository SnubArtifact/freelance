/**
 * Checks the Supabase settings in server/.env before they go anywhere near the
 * live shop:
 *   npm --prefix server run check:supabase
 *
 * It connects to the database, creates the shop's tables, writes and deletes a
 * test row, then uploads and deletes a test photo. Every problem is reported in
 * plain words. Your keys and password are never printed.
 */
import crypto from "node:crypto";
import { openDatabase } from "./db/connect.js";
import { openImageStore } from "./images.js";
import { openShop } from "./shop.js";

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const hint = (s) => `    ${s}`;
let failures = 0;
const fail = (what, ...hints) => {
  failures++;
  console.log(bad(what));
  for (const h of hints) console.log(hint(h));
};

console.log("\n=== Supabase check ===\n");

// ---- 1. Is anything filled in? ---------------------------------------------
if (!DATABASE_URL && !SUPABASE_URL && !SUPABASE_SERVICE_KEY) {
  console.log(bad("server/.env has none of the three values filled in."));
  console.log(hint("Open server/.env and paste them in; the comments say where each one lives."));
  process.exit(1);
}

// ---- 2. Does the connection string look right? ------------------------------
if (!DATABASE_URL) {
  fail("DATABASE_URL is empty.", "Supabase → Connect → Session pooler.");
} else {
  let parsed = null;
  try {
    parsed = new URL(DATABASE_URL);
  } catch {
    /* handled below */
  }
  if (!parsed || !/^postgres(ql)?:$/.test(parsed.protocol)) {
    fail(
      "DATABASE_URL isn't a Postgres connection string.",
      "It must start with postgresql:// — copy it from Supabase → Connect.",
      "If your password contains @ # / ? or %, that breaks it: reset the database",
      "password (Project Settings → Database) to letters and numbers only."
    );
  } else {
    if (!parsed.password) {
      fail("DATABASE_URL has no password in it.", "Replace [YOUR-PASSWORD] with your database password.");
    } else if (/^\[.*\]$/.test(decodeURIComponent(parsed.password))) {
      fail("DATABASE_URL still has the [YOUR-PASSWORD] placeholder.", "Put your real database password there.");
    }
    if (!parsed.hostname.includes("pooler.supabase.com")) {
      console.log(
        bad("DATABASE_URL is not the Session pooler string.") +
          "\n" +
          hint("Render can only reach Supabase through the pooler (IPv4).") +
          "\n" +
          hint("Supabase → Connect → Session pooler; the host ends in pooler.supabase.com.")
      );
      failures++;
    } else if (parsed.port !== "5432") {
      fail(
        `DATABASE_URL uses port ${parsed.port}; the Session pooler is port 5432.`,
        "Port 6543 is the transaction pooler, which this server can't use."
      );
    }
  }
}

if (SUPABASE_URL && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL)) {
  fail(
    "SUPABASE_URL doesn't look like a Supabase project URL.",
    "It should be https://<your-project>.supabase.co (Project Settings → Data API)."
  );
}
if (SUPABASE_SERVICE_KEY && !/^(sb_secret_|eyJ)/.test(SUPABASE_SERVICE_KEY)) {
  fail(
    "SUPABASE_SERVICE_KEY doesn't look like a secret key.",
    "Use a secret key (sb_secret_…) or the legacy service_role key —",
    "not the publishable/anon key, which can't write."
  );
}
if (failures) {
  console.log("\nFix the above, then run this again.\n");
  process.exit(1);
}

// ---- 3. The database --------------------------------------------------------
let shop;
try {
  const db = await openDatabase({ url: DATABASE_URL });
  console.log(ok("Connected to the Supabase database."));
  shop = await openShop(db, { seed: false });
  console.log(ok("The shop's tables are in place."));
} catch (err) {
  const message = err.message || String(err);
  fail(`Could not use the database: ${message}`);
  if (/password authentication failed/i.test(message)) {
    console.log(hint("The password in DATABASE_URL is wrong. Reset it in Project Settings → Database."));
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    console.log(hint("That host doesn't exist — re-copy the string from Supabase → Connect."));
  } else if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(message)) {
    console.log(hint("Couldn't reach Supabase. Check the project isn't paused, and try again."));
  } else if (/Tenant or user not found/i.test(message)) {
    console.log(hint("The user must be postgres.<project-ref> — copy the pooler string exactly."));
  }
  console.log("");
  process.exit(1);
}

try {
  const saree = {
    id: `check-${crypto.randomUUID()}`,
    name: "Connection check",
    description: "",
    price: 1,
    originalPrice: null,
    category: "Check",
    fabric: "",
    color: "",
    images: [],
    featured: false,
    inStock: true,
    stock: 1,
    createdAt: Date.now(),
  };
  await shop.createProduct(saree);
  const readBack = await shop.getProduct(saree.id);
  await shop.deleteProduct(saree.id);
  if (readBack?.name !== saree.name) throw new Error("what was written didn't read back");
  console.log(ok("Wrote, read and deleted a test saree."));

  const existing = await shop.listProducts();
  console.log(ok(`The catalog currently holds ${existing.length} saree(s).`));
} catch (err) {
  fail(`The database is connected but not usable: ${err.message}`);
}

// ---- 4. Photo storage --------------------------------------------------------
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  fail(
    "SUPABASE_URL or SUPABASE_SERVICE_KEY is missing, so photos would still be lost on a restart.",
    "Project Settings → Data API for the URL; Project Settings → API Keys for a secret key."
  );
} else {
  const photos = openImageStore({
    uploadDir: null,
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_SERVICE_KEY,
  });
  try {
    // A 1×1 PNG.
    const url = await photos.save({
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      ),
      mimetype: "image/png",
      originalname: "connection-check.png",
    });
    const fetched = await fetch(url);
    if (!fetched.ok) throw new Error(`the uploaded photo wasn't public (HTTP ${fetched.status})`);
    await photos.remove(url);
    console.log(ok('Uploaded, fetched and deleted a test photo in the public "sarees" bucket.'));
  } catch (err) {
    fail(`Photo storage isn't working: ${err.message}`);
    if (/row-level security|Unauthorized|403|401/i.test(err.message)) {
      console.log(hint("That key can't write. Use a secret key (sb_secret_…), not the publishable one."));
    }
  }
}

await shop.close();

console.log(
  failures
    ? `\n${failures} problem(s) above. Fix them and run this again.\n`
    : "\nAll good — these settings are ready to paste into Render.\n"
);
process.exit(failures ? 1 : 0);
