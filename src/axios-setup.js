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

export function storeLoginToken(token) {
  const value = String(token || "").trim();
  if (!value) return;
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch (_) {}
  applyAuthHeader();
}

const KIOSK_HOME_KEY = "ms.kioskHome";
const KIOSK_PATHS = ["/photo-station", "/turntable-bridge"];

export function isStationDevice() {
  try {
    return /iPhone|iPad|iPod|Silk|Kindle|Android/i.test(navigator.userAgent || "");
  } catch (_) {
    return false;
  }
}

export function kioskHomeForPath(pathname) {
  const path = String(pathname || "/").replace(/\/$/, "") || "/";
  return KIOSK_PATHS.indexOf(path) >= 0 ? path : "";
}

export function rememberKioskHome(pathname) {
  const home = kioskHomeForPath(pathname);
  if (!home || !isStationDevice()) return;
  try {
    localStorage.setItem(KIOSK_HOME_KEY, home);
  } catch (_) {}
}

export function savedKioskHome() {
  if (!isStationDevice()) return "";
  try {
    const saved = localStorage.getItem(KIOSK_HOME_KEY) || "";
    return kioskHomeForPath(saved);
  } catch (_) {
    return "";
  }
}

export function startKioskSessionKeep(apiRoot, pathname) {
  const home = kioskHomeForPath(pathname);
  if (!home || !isStationDevice()) return function noop() {};
  rememberKioskHome(home);
  let stopped = false;
  let lastOk = 0;

  async function keep(force) {
    if (stopped || !getLoginToken()) return;
    const now = Date.now();
    if (!force && lastOk && now - lastOk < 30 * 60 * 1000) return;
    try {
      const res = await fetch(`${String(apiRoot || "").replace(/\/$/, "")}/session/keep`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getLoginToken()}`,
        },
        body: JSON.stringify({ home }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.token) storeLoginToken(data.token);
      if (data && data.kiosk) lastOk = Date.now();
    } catch (_) {}
  }

  keep(true);
  const timer = setInterval(function () {
    keep(true);
  }, 6 * 60 * 60 * 1000);
  function onVisible() {
    if (!document.hidden) keep(false);
  }
  document.addEventListener("visibilitychange", onVisible);
  return function stop() {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
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
