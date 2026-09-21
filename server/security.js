import crypto from "node:crypto";

// Compares two strings in constant time, so the comparison can't leak how
// much of a secret was guessed right.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Short signed codes tied to one order number:
 *  - receipt: lets the shopper who placed the order, and only them, open its
 *    receipt. Order numbers alone can't be used to read someone's details.
 *  - return:  part of the return URL given to HDFC, so a payment return for
 *    one order can't be relabelled as another.
 */
export function orderTokens(secret) {
  const sign = (purpose, orderNo) =>
    crypto.createHmac("sha256", secret).update(`${purpose}:${orderNo}`).digest("base64url").slice(0, 32);
  return {
    receipt: (orderNo) => sign("receipt", orderNo),
    returnRef: (orderNo) => sign("return", orderNo),
    check: (purpose, orderNo, token) =>
      typeof token === "string" && safeEqual(token, sign(purpose, String(orderNo))),
  };
}

// For putting shopper-typed text into an HTML email.
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Headers that close common browser attack routes: no framing (clickjacking),
// no MIME sniffing, and HTTPS-only for a year once the API is seen over HTTPS.
export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Photos under /uploads are shown by the storefront on another origin.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

/**
 * The browser origins allowed to call the API: the storefront (CLIENT_URL),
 * its www/bare-domain twin, and anything listed in ALLOWED_ORIGINS. Requests
 * without an Origin (the bank's redirects, server-to-server calls) aren't
 * affected; CORS only governs browsers.
 */
export function allowedOrigins(clientUrl, extra = "") {
  const origins = new Set();
  for (const value of [clientUrl, ...String(extra).split(",")]) {
    let url;
    try {
      url = new URL(value.trim());
    } catch {
      continue;
    }
    origins.add(url.origin);
    const host = url.hostname;
    if (!/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host)) {
      const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
      origins.add(`${url.protocol}//${twin}${url.port ? `:${url.port}` : ""}`);
    }
  }
  return origins;
}

// Slows down password guessing: after `max` failed sign-ins from one address
// within the window, further attempts are refused until the window passes.
export function loginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();
  const current = (ip) => {
    const entry = failures.get(ip);
    if (entry && Date.now() - entry.since > windowMs) {
      failures.delete(ip);
      return null;
    }
    return entry;
  };
  return {
    blocked: (ip) => (current(ip)?.count || 0) >= max,
    fail(ip) {
      const entry = current(ip) || { count: 0, since: Date.now() };
      entry.count += 1;
      failures.set(ip, entry);
      if (failures.size > 5000) {
        for (const key of failures.keys()) current(key); // drop expired entries
      }
    },
    succeed: (ip) => failures.delete(ip),
  };
}
