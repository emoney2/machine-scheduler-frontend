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
