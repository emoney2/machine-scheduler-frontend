import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  flattenShipmentRows,
  loadShipmentHistory,
  upsTrackingUrl,
} from "./shipmentHistoryStorage";

function formatShippedAt(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || "—");
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso || "—");
  }
}

/** UPS Quantum View returns ship_date as YYYYMMDD (pickup date). */
function formatUpsYyyymmdd(ymd) {
  const s = String(ymd || "").trim();
  if (s.length !== 8 || !/^\d{8}$/.test(s)) return "—";
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, d));
  if (Number.isNaN(dt.getTime())) return s;
  return dt.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/**
 * @param {Array<{ tracking_number?: string, company?: string, ship_date?: string }>} upsRows
 * @param {Array<{ trackingNumber: string, company: string, shippedAt: string, groupId?: string }>} localRows
 */
function mergeShippingRows(upsRows, localRows) {
  const byTrk = new Map();

  for (const u of upsRows || []) {
    const trk = String(u.tracking_number || "").trim();
    if (!trk) continue;
    const ymd = String(u.ship_date || "").trim();
    const shippedAt =
      ymd.length === 8
        ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00.000Z`
        : "";
    byTrk.set(trk, {
      trackingNumber: trk,
      company: String(u.company || "—").trim() || "—",
      shippedAt,
      upsYyyymmdd: ymd.length === 8 ? ymd : "",
      source: "UPS",
    });
  }

  for (const r of localRows || []) {
    const trk = String(r.trackingNumber || "").trim();
    if (!trk || byTrk.has(trk)) continue;
    byTrk.set(trk, {
      trackingNumber: trk,
      company: String(r.company || "—").trim() || "—",
      shippedAt: r.shippedAt,
      upsYyyymmdd: "",
      source: "Browser",
    });
  }

  return Array.from(byTrk.values()).sort((a, b) => {
    const ta = new Date(a.shippedAt).getTime();
    const tb = new Date(b.shippedAt).getTime();
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
    return String(b.trackingNumber).localeCompare(String(a.trackingNumber));
  });
}

function formatRowDate(row) {
  if (row.source === "UPS" && row.upsYyyymmdd) {
    return formatUpsYyyymmdd(row.upsYyyymmdd);
  }
  return formatShippedAt(row.shippedAt);
}

export default function ShipmentsHistory() {
  const navigate = useNavigate();
  const [busyTracking, setBusyTracking] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upsPayload, setUpsPayload] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");

  const loadUps = useCallback(async () => {
    setLoading(true);
    setUpsPayload(null);
    try {
      const res = await fetch(`${API_BASE}/api/shipping-history-ups?days=7`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      setUpsPayload({
        ok: res.ok,
        configured: data.configured !== false,
        rows: Array.isArray(data.rows) ? data.rows : [],
        message: data.message || null,
        error: data.error || (res.ok ? null : data.error || `HTTP ${res.status}`),
        subscriptionNamesTried: Array.isArray(data.subscription_names_tried)
          ? data.subscription_names_tried
          : [],
        usedDefaultSubscriptionName: Boolean(data.used_default_subscription_name),
      });
    } catch (e) {
      setUpsPayload({
        ok: false,
        configured: true,
        rows: [],
        message: null,
        error: e?.message || "Failed to load UPS history",
        subscriptionNamesTried: [],
        usedDefaultSubscriptionName: false,
      });
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    loadUps();
  }, [loadUps, refreshKey]);

  const localFlat = flattenShipmentRows(loadShipmentHistory());
  const upsApiRows = upsPayload?.rows || [];
  const mergedRows = mergeShippingRows(upsApiRows, localFlat);

  async function handleReprint(tracking) {
    const trk = String(tracking || "").trim();
    if (!trk) return;
    setBusyTracking(trk);
    setToast(null);
    try {
      const res = await fetch(`${API_BASE}/api/reprint-label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tracking: trk }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setToast(data.error || `Reprint failed (${res.status})`);
        return;
      }
      const parts = [];
      if (data.drive_uploaded) parts.push("Drive (Label Printer folder)");
      if (data.local_copied) parts.push("local Label Printer path");
      setToast(
        parts.length
          ? `Saved: ${parts.join(" · ")}`
          : "Label reprint request completed."
      );
    } catch (e) {
      setToast(e?.message || "Network error");
    } finally {
      setBusyTracking(null);
    }
  }

  return (
    <div style={{ padding: "1rem 1.25rem", maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: "1.25rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Shipments</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={loading}
            onClick={() => setRefreshKey((k) => k + 1)}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.95rem",
              cursor: loading ? "wait" : "pointer",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
            }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => navigate("/ship")}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.95rem",
              cursor: "pointer",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
            }}
          >
            ← Back to Ship
          </button>
        </div>
      </div>

      <p style={{ color: "#64748b", marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>
        Shipment rows come from UPS Quantum View (last 7 days). If you do not set{" "}
        <code style={{ fontSize: "0.85em" }}>UPS_QUANTUM_VIEW_SUBSCRIPTION_NAME</code> on the server, the API
        uses UPS&apos;s documented default name <strong>OutboundXML</strong> (outbound + XML). You can set one
        or more comma-separated names if your UPS subscription uses different names. Rows that only exist in
        this browser show as <strong>Browser</strong>. Tracking opens UPS; Reprint sends the label to your
        Label Printer folder again.
      </p>

      {upsPayload && upsPayload.subscriptionNamesTried && upsPayload.subscriptionNamesTried.length > 0 && (
        <p style={{ color: "#64748b", marginTop: 0, marginBottom: "0.75rem", fontSize: "0.85rem" }}>
          Subscription name(s) queried:{" "}
          <code style={{ fontSize: "0.9em" }}>{upsPayload.subscriptionNamesTried.join(", ")}</code>
          {upsPayload.usedDefaultSubscriptionName ? " (default — set env to override)" : ""}
        </p>
      )}

      {upsPayload && upsPayload.message && !upsPayload.error && (
        <div
          role="note"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            color: "#1e3a5f",
            fontSize: "0.9rem",
          }}
        >
          {upsPayload.message}
        </div>
      )}

      {upsPayload && upsPayload.error && (
        <div
          role="alert"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: "0.9rem",
          }}
        >
          <strong>Could not load from UPS.</strong> {upsPayload.error}
        </div>
      )}

      {toast && (
        <div
          role="status"
          style={{
            marginBottom: "1rem",
            padding: "0.65rem 0.9rem",
            borderRadius: 8,
            background: "#f0fdf4",
            border: "1px solid #86efac",
            color: "#166534",
            fontSize: "0.9rem",
          }}
        >
          {toast}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>Loading shipment history…</div>
      ) : mergedRows.length === 0 ? (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            color: "#64748b",
            border: "1px dashed #cbd5e1",
            borderRadius: 12,
          }}
        >
          No shipments found for the last 7 days. If you expect UPS rows here, confirm Quantum View is active on
          your UPS account and that <code style={{ fontSize: "0.85em" }}>UPS_QUANTUM_VIEW_SUBSCRIPTION_NAME</code> on
          the server matches your subscription name (often <code style={{ fontSize: "0.85em" }}>OutboundXML</code>).
          You can still ship from the Ship tab; labels created on this computer may appear as Browser-only until UPS
          publishes manifest data.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                <th style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid #e2e8f0" }}>
                  Shipment date
                </th>
                <th style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid #e2e8f0" }}>
                  Company
                </th>
                <th style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid #e2e8f0" }}>
                  Source
                </th>
                <th style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid #e2e8f0" }}>
                  Tracking
                </th>
                <th style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid #e2e8f0", width: 120 }}>
                  Reprint
                </th>
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((row) => {
                const url = upsTrackingUrl(row.trackingNumber);
                const loadingTrk = busyTracking === row.trackingNumber;
                return (
                  <tr key={`${row.source}-${row.trackingNumber}`}>
                    <td style={{ padding: "0.55rem 0.85rem", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                      {formatRowDate(row)}
                    </td>
                    <td style={{ padding: "0.55rem 0.85rem", borderBottom: "1px solid #f1f5f9" }}>
                      {row.company}
                    </td>
                    <td style={{ padding: "0.55rem 0.85rem", borderBottom: "1px solid #f1f5f9", color: "#64748b" }}>
                      {row.source}
                    </td>
                    <td style={{ padding: "0.55rem 0.85rem", borderBottom: "1px solid #f1f5f9" }}>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>
                          {row.trackingNumber}
                        </a>
                      ) : (
                        row.trackingNumber
                      )}
                    </td>
                    <td style={{ padding: "0.55rem 0.85rem", borderBottom: "1px solid #f1f5f9" }}>
                      <button
                        type="button"
                        disabled={loadingTrk}
                        onClick={() => handleReprint(row.trackingNumber)}
                        style={{
                          padding: "0.35rem 0.65rem",
                          fontSize: "0.85rem",
                          cursor: loadingTrk ? "wait" : "pointer",
                          borderRadius: 6,
                          border: "1px solid #94a3b8",
                          background: "#fff",
                        }}
                      >
                        {loadingTrk ? "…" : "Reprint"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
