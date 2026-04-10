/**
 * Append browser-side shipment / QBO debug lines to backend logs/ship_quickbooks.log
 * via POST /api/shipment-client-log (same session as Ship page).
 *
 * @param {Array<Record<string, unknown>>} events
 */
export async function postShipQboClientLog(events) {
  const root = (process.env.REACT_APP_API_ROOT || "").replace(/\/api$/i, "");
  if (!root || !Array.isArray(events) || events.length === 0) return;
  try {
    await fetch(`${root}/api/shipment-client-log`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
  } catch (e) {
    console.warn("[shipQboClientLog]", e);
  }
}
