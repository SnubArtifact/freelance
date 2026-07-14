export const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export function assetUrl(src) {
  if (!src) return src;
  return src.startsWith("/uploads/") ? `${API_BASE}${src}` : src;
}
