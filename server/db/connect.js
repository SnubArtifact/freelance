import fs from "node:fs";
import path from "node:path";

/**
 * Opens the shop's Postgres database behind the small interface the rest of
 * the server uses:
 *   query(sql, params) → rows   one statement, $1-style parameters
 *   exec(sql)                   several statements, no parameters (the schema)
 *   transaction(fn)             fn(query) runs inside BEGIN … COMMIT
 *   close()
 *
 * With DATABASE_URL it connects to a real Postgres server through `pg`:
 * Supabase in production, using its "Session pooler" string, which works over
 * IPv4 as Render needs. Without it, PGlite runs Postgres inside this process
 * and saves it in dataDir, so local development needs nothing installed. A
 * null dataDir keeps PGlite in memory, for tests.
 */
export function openDatabase({ url, dataDir, maxConnections = 3 }) {
  return url ? openPostgres(url, maxConnections) : openEmbedded(dataDir);
}

async function openPostgres(url, maxConnections) {
  const { default: pg } = await import("pg");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({
    // sslmode in the string would override the ssl option below.
    connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""),
    // Supabase only accepts encrypted connections. Its certificates come from
    // Supabase's own authority, which Node doesn't ship, so the connection is
    // encrypted without verifying that chain.
    ssl: local ? false : { rejectUnauthorized: false },
    max: maxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
  });
  // The pooler closes idle connections; that must not crash the server.
  pool.on("error", (err) => console.error(`[db] Idle connection closed: ${err.message}`));

  const runner = (client) => async (sql, params = []) => (await client.query(sql, params)).rows;

  // Prove the connection now, so a wrong URL or password fails at startup
  // rather than on a shopper's first order. The first attempt can time out
  // while a sleeping database wakes, so it gets a few tries before the server
  // gives up and exits.
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      break;
    } catch (err) {
      if (attempt === 4) throw err;
      console.warn(`[db] Connection attempt ${attempt} failed (${err.message}); retrying…`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }

  return {
    kind: "postgres",
    fresh: false,
    query: runner(pool),
    exec: async (sql) => {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(runner(client));
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openEmbedded(dataDir) {
  const { PGlite } = await import("@electric-sql/pglite");
  const fresh = !dataDir || !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  const db = await PGlite.create(dataDir || undefined);
  const runner = (q) => async (sql, params = []) => (await q.query(sql, params)).rows;

  return {
    kind: "embedded",
    fresh,
    query: runner(db),
    exec: async (sql) => {
      await db.exec(sql);
    },
    transaction: (fn) => db.transaction((tx) => fn(runner(tx))),
    close: () => db.close(),
  };
}
