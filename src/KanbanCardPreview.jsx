// src/KanbanCardPreview.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

// Choose app origin for QR links (works in Netlify and local)
const APP_ORIGIN =
  typeof window !== "undefined" && window.location?.origin
    ? (window.location.origin.includes("netlify.app")
        ? "https://machineschedule.netlify.app"
        : window.location.origin)
    : "https://machineschedule.netlify.app";

// Simple QR image generator (reliable, takes short URLs best)
const makeQr = (data, size = 180) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&qzone=1&data=${encodeURIComponent(
    data
  )}`;

export default function KanbanCardPreview() {
  const { kanbanId } = useParams();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const url = `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(kanbanId)}`;
        const r = await fetch(url, { credentials: "include" });

        if (!r.ok) {
          let detail = "";
          try { detail = await r.text(); } catch {}
          throw new Error(`Preview failed: HTTP ${r.status} ${detail}`);
        }

        const j = await r.json();
        if (!j || !j.item) throw new Error("Item not found (empty payload)");

        // normalize keys (accepts camelCase or sheet headers)
        const n = (v) => (v === undefined || v === null ? "" : String(v).trim());
        const it = j.item;

        // Handle common alias keys for these three
        const lead = n(it["Lead Time (days)"] ?? it.leadTimeDays ?? it.leadTime ?? "");
        const bin = n(it["Bin Qty (units)"] ?? it.binQtyUnits ?? it.binQty ?? it.binQuantity ?? "");
        const reorder = n(it["Reorder Qty (basis)"] ?? it.reorderQtyBasis ?? it.reorderQty ?? "");

        const normalized = {
          kanbanId: n(it["Kanban ID"] ?? it.kanbanId ?? kanbanId),
          itemName: n(it["Item Name"] ?? it.itemName ?? ""),
          sku: n(it["SKU"] ?? it.sku ?? ""),
          dept: n(it["Dept"] ?? it.dept ?? ""),
          category: n(it["Category"] ?? it.category ?? ""),
          location: n(it["Location"] ?? it.location ?? ""),
          packageSize: n(it["Package Size"] ?? it.packageSize ?? ""),
          leadTimeDays: lead,
          binQtyUnits: bin,
          reorderQtyBasis: reorder,
          orderMethod: n(it["Order Method (Email/Online)"] ?? it.orderMethod ?? ""),
          orderUrl: n(it["Order URL"] ?? it.orderUrl ?? ""),
          orderEmail: n(it["Order Email"] ?? it.orderEmail ?? ""),
          photoUrl: n(it["Photo URL"] ?? it.photoUrl ?? ""),
        };

        setItem(normalized);

        // Optional: log preview
        try {
          await fetch(`${BACKEND}/api/kanban/log-card`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ kanbanId: normalized.kanbanId }),
          });
        } catch {}
      } catch (e) {
        setErr(String(e?.message || e));
      }
    };
    load();
  }, [kanbanId]);

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: "#b91c1c", whiteSpace: "pre-wrap" }}>Error: {err}</div>
        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <a href="/kanban/new" style={btnSecondary}>+ Create Kanban</a>
          <a href="/kanban/queue" style={{ alignSelf: "center" }}>← Back to Queue</a>
        </div>
      </div>
    );
  }
  if (!item) return <div style={{ padding: 24 }}>Loading…</div>;

  // Short URLs for QRs:
  // - Order QR points to /kanban/open?id=… (this page redirects to vendor URL or mailto)
  // - Reorder QR points to /kanban/scan?id=…&qty=1 (adds REQUEST to the queue)
  const orderOpenUrl = `${APP_ORIGIN}/kanban/open?id=${encodeURIComponent(item.kanbanId)}`;
  const reorderScanUrl = `${APP_ORIGIN}/kanban/scan?id=${encodeURIComponent(item.kanbanId)}&qty=1`;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button
          onClick={() => nav(`/kanban/new?edit=${encodeURIComponent(kanbanId)}`)}
          style={btnSecondary}
        >
          Edit
        </button>
        <button onClick={() => window.print()} style={btnPrimary}>
          Print
        </button>
        <Link to="/kanban/queue" style={{ alignSelf: "center", marginLeft: "auto" }}>
          ← Back to Queue
        </Link>
      </div>

      {/* 4x6 printable card */}
      <div
        className="card"
        style={{
          width: "4in",
          height: "6in",
          border: "2px solid #111827",
          borderRadius: 12,
          background: "white",
          padding: 12,
          display: "grid",
          gridTemplateRows: "auto auto auto 1fr auto",
          gap: 8,
        }}
      >
        {/* Title */}
        <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: 0.3 }}>
          KANBAN CARD
        </div>

        {/* Location immediately under title */}
        {item.location ? (
          <div style={{ fontWeight: 900, fontSize: 18, color: "#111827" }}>
            Location: {item.location}
          </div>
        ) : (
          <div style={{ fontWeight: 900, fontSize: 18, color: "#9ca3af" }}>
            Location: —
          </div>
        )}

        {/* Dept / Category */}
        <div style={{ fontSize: 12, color: "#374151", textAlign: "center" }}>
          {item.dept} {item.category ? `• ${item.category}` : ""}
        </div>

        {/* BIG centered image */}
        <div style={{ display: "grid", justifyItems: "center" }}>
          {item.photoUrl ? (
            <img
              alt=""
              src={item.photoUrl}
              style={{
                width: 160,
                height: 160,
                objectFit: "cover",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
              }}
            />
          ) : (
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 10,
                border: "1px dashed #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#9ca3af",
                fontSize: 12,
              }}
            >
              No Photo
            </div>
          )}
        </div>

        {/* Main body */}
        <div style={{ display: "grid", gap: 8 }}>
          {/* Item name & package/lead */}
          <div style={{ fontWeight: 900, fontSize: 16, textAlign: "center" }}>
            {item.itemName || "—"}
          </div>

          <div style={{ fontSize: 12, color: "#111827", textAlign: "center" }}>
            {item.packageSize || "—"}
            {item.leadTimeDays ? ` • Lead: ${item.leadTimeDays}d` : ""}
          </div>

          {/* Bin / Reorder in bold large */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Bin Qty (units)</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{item.binQtyUnits || "—"}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Reorder Qty (basis)</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{item.reorderQtyBasis || "—"}</div>
            </div>
          </div>

          {/* Dual QR boxes */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginTop: 4,
            }}
          >
            {/* Order Page QR (short URL -> our Open page -> redirects to vendor URL or mailto) */}
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: 8,
                display: "grid",
                gap: 6,
                alignContent: "start",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 12, textAlign: "center" }}>Order Page</div>
              <img
                alt="Order QR"
                src={makeQr(orderOpenUrl)}
                style={{ width: 120, height: 120, justifySelf: "center" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <div style={{ fontSize: 10, color: "#6b7280", textAlign: "center" }}>
                Scan to open product page
              </div>
            </div>

            {/* Reorder Request QR */}
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: 8,
                display: "grid",
                gap: 6,
                alignContent: "start",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 12, textAlign: "center" }}>Scan to Request Reorder</div>
              <img
                alt="Reorder Request QR"
                src={makeQr(reorderScanUrl)}
                style={{ width: 120, height: 120, justifySelf: "center" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <div style={{ fontSize: 10, color: "#6b7280", textAlign: "center" }}>
                ID: <b>{item.kanbanId || "—"}</b> • Qty: 1
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* print styles */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .card { box-shadow: none !important; }
          button, a { display: none !important; }
          @page { size: 4in 6in; margin: 0.25in; }
        }
      `}</style>
    </div>
  );
}

const btnPrimary = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};
const btnSecondary = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "white",
  color: "#111827",
  fontWeight: 800,
  cursor: "pointer",
};
