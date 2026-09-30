/**
 * API base URL.
 *
 * On Netlify, use same-origin `/api` so the login cookie is sent. netlify.toml
 * proxies that to Render. A baked-in REACT_APP_API_ROOT pointing at Render
 * would skip the cookie and empty the scheduler for kiosk/desktop sessions.
 * Phone login still uses same-host /login.
 */
const RENDER_API = "https://machine-scheduler-backend.onrender.com/api";

export function getApiRoot() {
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      const env = String(process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
      return env || "/api";
    }
    if (host.endsWith(".netlify.app") || host.endsWith(".netlify.com")) {
      return "/api";
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
