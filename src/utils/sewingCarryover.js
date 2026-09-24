const STORAGE_KEY = "sewingCarryover.v1";

export function persistSewingCarryover(payload) {
  try {
    const next = {
      ...(payload || {}),
      persistedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("sewingCarryoverUpdated", { detail: next }));
    }
  } catch (_) {
    /* ignore quota */
  }
}

export function loadPersistedSewingCarryover() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function sewingCarryoverCount(snapshot) {
  return Array.isArray(snapshot?.carryovers) ? snapshot.carryovers.length : 0;
}
