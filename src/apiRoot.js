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
