/**
 * API base URL.
 *
 * Production talks to Render directly. Netlify's /api proxy dies on the
 * Google Sheets /combined read (often >10s), which looks like the app
 * "isn't connected to the sheet." Login still uses same-host /login, and
 * axios-setup sends the #ms= Bearer token so phones don't need cookies.
 */
const RENDER_API = "https://machine-scheduler-backend.onrender.com/api";

export function getApiRoot() {
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      const env = String(process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
      return env || "/api";
    }
  } catch (_) {}
  const env = String(process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
  if (env.startsWith("http")) return env;
  return RENDER_API;
}

export const API_ROOT = getApiRoot();

/**
 * Build a browser-safe Drive thumbnail URL via our backend proxy.
 * Public drive.google.com/thumbnail fails for private / shared-drive JR flats.
 * Accepts a raw Drive file id, Drive link, IMAGE() formula, or existing thumb URL.
 */
export function driveThumbnailSrc(fileIdOrUrl, sz = "w160") {
  if (!fileIdOrUrl) return "";
  const raw = String(fileIdOrUrl).trim();
  if (!raw) return "";
  let id = "";
  try {
    const m =
      raw.match(/[?&]fileId=([A-Za-z0-9_-]{10,})/i) ||
      raw.match(/[?&]id=([A-Za-z0-9_-]{10,})/) ||
      raw.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) ||
      raw.match(/\/d\/([A-Za-z0-9_-]{10,})/);
    if (m) id = m[1];
    else if (/^[A-Za-z0-9_-]{12,}$/.test(raw)) id = raw;
  } catch (_) {}
  if (!id) {
    // Already a non-Drive absolute image URL
    if (/^https?:\/\//i.test(raw) && !/drive\.google\.com/i.test(raw)) return raw;
    return "";
  }
  const size = String(sz || "w160").trim() || "w160";
  return `${API_ROOT}/drive/thumbnail?fileId=${encodeURIComponent(id)}&sz=${encodeURIComponent(size)}`;
}

export function getBackendOrigin() {
  const root = getApiRoot();
  if (root.startsWith("http")) return root.replace(/\/api$/, "");
  try {
    return window.location.origin;
  } catch (_) {
    return "";
  }
}

/** Login page origin. On Netlify use same-host /login (proxied) so phones stay on the app. */
export function getLoginOrigin() {
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host.endsWith(".netlify.app") || host.endsWith(".netlify.com")) {
      return window.location.origin;
    }
  } catch (_) {}
  return getBackendOrigin() || "https://machine-scheduler-backend.onrender.com";
}

export function getSocketOrigin() {
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      const env = String(process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
      if (env.startsWith("http")) return env.replace(/\/api$/, "");
      return window.location.origin;
    }
  } catch (_) {}
  return "https://machine-scheduler-backend.onrender.com";
}
