import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Where uploaded photos go. With SUPABASE_URL and SUPABASE_SERVICE_KEY set
 * they are stored in a public Supabase Storage bucket and served from there,
 * so they survive restarts on a server without a permanent disk. Otherwise
 * they are saved to uploadDir and served by this server at /uploads/…, which
 * is fine for local development.
 *
 * Both stores offer save(file) → url, remove(url) and ping().
 */
export function openImageStore({ uploadDir, supabaseUrl, supabaseKey, bucket = "sarees" }) {
  return supabaseUrl && supabaseKey
    ? supabaseImages({ supabaseUrl, supabaseKey, bucket })
    : localImages(uploadDir);
}

// The new secret keys (sb_secret_…) go in the apikey header only; the older
// service_role key is a JWT and goes in Authorization as well.
export function supabaseHeaders(key) {
  return key.startsWith("sb_secret_")
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}

const safeExt = (name) => {
  const ext = path.extname(name || "").toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".jpg";
};

function supabaseImages({ supabaseUrl, supabaseKey, bucket }) {
  const base = supabaseUrl.trim().replace(/\/+$/, "");
  const auth = supabaseHeaders(supabaseKey.trim());
  const publicPrefix = `${base}/storage/v1/object/public/${bucket}/`;

  async function call(method, route, { body, headers = {} } = {}) {
    const res = await fetch(`${base}/storage/v1${route}`, {
      method,
      body,
      headers: { ...auth, ...headers },
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { ok: res.ok, status: res.status, data, text };
  }
  const reason = (r) => r.data?.message || r.data?.error || `HTTP ${r.status}`;

  // Creates the public photo bucket the first time it's needed.
  let bucketReady = null;
  function ensureBucket() {
    bucketReady ??= (async () => {
      if ((await call("GET", `/bucket/${bucket}`)).ok) return;
      const made = await call("POST", "/bucket", {
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: true,
          file_size_limit: 8 * 1024 * 1024,
          allowed_mime_types: ["image/*"],
        }),
        headers: { "Content-Type": "application/json" },
      });
      if (!made.ok && !/already exists/i.test(made.text)) {
        throw new Error(`Supabase Storage: could not create the "${bucket}" bucket (${reason(made)})`);
      }
    })().catch((err) => {
      bucketReady = null; // try again next time
      throw err;
    });
    return bucketReady;
  }

  return {
    kind: "supabase",
    async save(file) {
      await ensureBucket();
      const now = new Date();
      const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}${safeExt(file.originalname)}`;
      const up = await call("POST", `/object/${bucket}/${key}`, {
        body: file.buffer,
        headers: {
          "Content-Type": file.mimetype || "application/octet-stream",
          "cache-control": "max-age=31536000",
          "x-upsert": "false",
        },
      });
      if (!up.ok) throw new Error(`Supabase Storage upload failed: ${reason(up)}`);
      return publicPrefix + key;
    },
    // Only ever deletes this shop's own photos, never a pasted outside link.
    async remove(url) {
      if (typeof url !== "string" || !url.startsWith(publicPrefix)) return;
      const key = decodeURIComponent(url.slice(publicPrefix.length).split("?")[0]);
      if (!key || key.includes("..")) return;
      const del = await call("DELETE", `/object/${bucket}`, {
        body: JSON.stringify({ prefixes: [key] }),
        headers: { "Content-Type": "application/json" },
      });
      if (!del.ok) throw new Error(`Supabase Storage delete failed: ${reason(del)}`);
    },
    async ping() {
      await ensureBucket();
    },
  };
}

function localImages(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
  return {
    kind: "local",
    async save(file) {
      const name = `${crypto.randomUUID()}${safeExt(file.originalname)}`;
      await fs.promises.writeFile(path.join(uploadDir, name), file.buffer);
      return `/uploads/${name}`;
    },
    async remove(url) {
      if (typeof url !== "string" || !url.startsWith("/uploads/")) return;
      // basename keeps a crafted URL from reaching outside uploadDir.
      await fs.promises.rm(path.join(uploadDir, path.basename(url)), { force: true });
    },
    async ping() {},
  };
}
