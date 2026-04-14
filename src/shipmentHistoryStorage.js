const STORAGE_KEY = "jrco_shipment_history";
const MAX_ENTRIES = 400;

/**
 * @typedef {Object} ShipmentHistoryEntry
 * @property {string} id
 * @property {string} shippedAt - ISO timestamp
 * @property {string} company
 * @property {string[]} trackingNumbers
 * @property {string[]} labelUrls
 */

export function upsTrackingUrl(tracking) {
  const t = String(tracking || "").trim();
  if (!t) return "";
  return `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`;
}

/** @returns {ShipmentHistoryEntry[]} */
export function loadShipmentHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ company?: string, trackingNumbers?: string[], labelUrls?: string[], shippedAt?: string }} entry
 */
export function appendShipmentHistory(entry) {
  const trackingNumbers = (entry.trackingNumbers || [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (trackingNumbers.length === 0) return;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  /** @type {ShipmentHistoryEntry} */
  const row = {
    id,
    shippedAt: entry.shippedAt || new Date().toISOString(),
    company: String(entry.company || "—").trim() || "—",
    trackingNumbers,
    labelUrls: Array.isArray(entry.labelUrls)
      ? entry.labelUrls.map((u) => String(u))
      : [],
  };
  const next = [row, ...loadShipmentHistory()].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota or private mode */
  }
}

/**
 * Rows for the table: one row per tracking number, newest first.
 * @param {ShipmentHistoryEntry[]} entries
 */
export function flattenShipmentRows(entries) {
  const rows = [];
  for (const e of entries) {
    const tracks = e.trackingNumbers || [];
    for (const trk of tracks) {
      rows.push({
        groupId: e.id,
        shippedAt: e.shippedAt,
        company: e.company,
        trackingNumber: trk,
      });
    }
  }
  rows.sort((a, b) => {
    const ta = new Date(a.shippedAt).getTime();
    const tb = new Date(b.shippedAt).getTime();
    return tb - ta;
  });
  return rows;
}
