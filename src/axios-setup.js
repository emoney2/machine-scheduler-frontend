import axios from "axios";

const TOKEN_KEY = "ms.session";

export function getLoginToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (_) {
    return "";
  }
}

export function clearLoginToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
  try {
    delete axios.defaults.headers.common.Authorization;
  } catch (_) {}
}

function captureTokenFromHash() {
  try {
    const hash = String(window.location.hash || "");
    const m = hash.match(/^#ms=([^&]+)/);
    if (!m || !m[1]) return;
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1]));
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    );
  } catch (_) {}
}

function applyAuthHeader() {
  const t = getLoginToken();
  if (t) axios.defaults.headers.common.Authorization = `Bearer ${t}`;
  else delete axios.defaults.headers.common.Authorization;
}

captureTokenFromHash();
axios.defaults.withCredentials = true;
applyAuthHeader();

axios.interceptors.request.use((config) => {
  const t = getLoginToken();
  if (t) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

if (typeof window !== "undefined" && window.fetch) {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const t = getLoginToken();
    if (!t) return origFetch(input, init);
    const headers = new Headers(
      init.headers || (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${t}`);
    }
    return origFetch(input, { ...init, headers });
  };
}
