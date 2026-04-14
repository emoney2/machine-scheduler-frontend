import React, { useState } from "react";
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

export default function ShipmentsHistory() {
  const navigate = useNavigate();
  const [busyTracking, setBusyTracking] = useState(null);
  const [toast, setToast] = useState(null);

  const rows = flattenShipmentRows(loadShipmentHistory());

  const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");

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

      <p style={{ color: "#64748b", marginTop: 0, marginBottom: "1rem", fontSize: "0.95rem" }}>
        Recent UPS shipments from this browser (stored locally). Tracking opens UPS. Reprint sends the label to your Label Printer folder again.
      </p>

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

      {rows.length === 0 ? (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            color: "#64748b",
            border: "1px dashed #cbd5e1",
            borderRadius: 12,
          }}
        >
          No shipments recorded yet. Ship with UPS from the Ship tab; each successful run is listed here.
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
                  Tracking
                </th>
                <th style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid #e2e8f0", width: 120 }}>
                  Reprint
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const url = upsTrackingUrl(row.trackingNumber);
                const loading = busyTracking === row.trackingNumber;
                return (
                  <tr key={`${row.groupId}-${row.trackingNumber}`}>
                    <td style={{ padding: "0.55rem 0.85rem", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                      {formatShippedAt(row.shippedAt)}
                    </td>
                    <td style={{ padding: "0.55rem 0.85rem", borderBottom: "1px solid #f1f5f9" }}>
                      {row.company}
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
                        disabled={loading}
                        onClick={() => handleReprint(row.trackingNumber)}
                        style={{
                          padding: "0.35rem 0.65rem",
                          fontSize: "0.85rem",
                          cursor: loading ? "wait" : "pointer",
                          borderRadius: 6,
                          border: "1px solid #94a3b8",
                          background: "#fff",
                        }}
                      >
                        {loading ? "…" : "Reprint"}
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
