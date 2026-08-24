/**
 * API base URL.
 *
 * On the hosted Netlify app, always use same-origin `/api` (proxied to Render).
 * Phone browsers block cross-site session cookies, so calling Render directly
 * from machineschedule.netlify.app makes login look like it "goes nowhere".
 */
export function getApiRoot() {
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (
      host === "machineschedule.netlify.app" ||
      host.endsWith(".netlify.app") ||
      host.endsWith(".netlify.com")
    ) {
      return "/api";
    }
  } catch (_) {}
  const env = String(process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
  return env || "/api";
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

/**
 * Socket.IO must talk to Render directly. Netlify's HTTP rewrite has no
 * sticky sessions, so Engine.IO polling hits a new worker and logs
 * "Invalid session". Login cookies still use same-origin /api.
 */
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
