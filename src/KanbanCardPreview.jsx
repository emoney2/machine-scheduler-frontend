// src/KanbanCardPreview.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

// App origin for QR links
const APP_ORIGIN =
  typeof window !== "undefined" && window.location?.origin
    ? (window.location.origin.includes("netlify.app")
        ? "https://machineschedule.netlify.app"
        : window.location.origin)
    : "https://machineschedule.netlify.app";

// QR generator (use short in-app URLs for reliability)
const makeQr = (data, size = 160) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&qzone=1&data=${encodeURIComponent(
    data
  )}`;

// Location color map (case-insensitive)
function getLocationStyles(locKey) {
  const k = (locKey || "").toLowerCase().trim();
  const COLORS = {
    black: "#111827",
    gray: "#9CA3AF",
    royal: "#1D4ED8",
    kelly: "#10B981",
    purple: "#7E22CE",
    orange: "#F97316",
    teal: "#0D9488",
    white: "#FFFFFF",
    text: "#111827",
    light: "#F3F4F6",
  };
  let bg = COLORS.light;
  let text = COLORS.text;

  if (k === "kitchen") { bg = COLORS.black; text = COLORS.white; }
  else if (k === "cut") { bg = COLORS.gray; }
  else if (k === "fur") { bg = COLORS.royal; }
  else if (k === "print") { bg = COLORS.kelly; }
  else if (k === "sewing") { bg = COLORS.purple; }
  else if (k === "shipping") { bg = COLORS.orange; }
  else if (k === "embroidery") { bg = COLORS.teal; }

  return { bg, text };
}

export default function KanbanCardPreview() {
  const { kanbanId } = useParams();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(
          `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(kanbanId)}`,
          { credentials: "include" }
        );
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`Preview failed: HTTP ${r.status} ${t}`);
        }
        const j = await r.json();
        if (!j?.item) throw new Error("Item not found (empty payload)");

        // normalize fields (accept camelCase or sheet headers)
        const n = (v) => (v == null ? "" : String(v).trim());
        const it = j.item;

        const normalized = {
          kanbanId: n(it["Kanban ID"] ?? it.kanbanId ?? kanbanId),
          itemName: n(it["Item Name"] ?? it.itemName ?? ""),
          sku: n(it["SKU"] ?? it.sku ?? ""),
          // dept/category intentionally dropped from UI (you asked to remove “Facilities”)
          location: n(it["Location"] ?? it.location ?? ""),
          packageSize: n(it["Package Size"] ?? it.packageSize ?? ""),
          leadTimeDays: n(it["Lead Time (days)"] ?? it.leadTimeDays ?? it.leadTime ?? ""),
          binQtyUnits: n(it["Bin Qty (units)"] ?? it.binQtyUnits ?? it.binQty ?? it.binQuantity ?? ""),
          reorderQtyBasis: n(it["Reorder Qty (basis)"] ?? it.reorderQtyBasis ?? it.reorderQty ?? ""),
          orderMethod: n(it["Order Method (Email/Online)"] ?? it.orderMethod ?? ""),
          orderUrl: n(it["Order URL"] ?? it.orderUrl ?? ""),
          orderEmail: n(it["Order Email"] ?? it.orderEmail ?? ""),
          photoUrl: n(it["Photo URL"] ?? it.photoUrl ?? ""),
        };

        setItem(normalized);

        // Optional log
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

  // Short URLs for QR codes
  const orderOpenUrl   = `${APP_ORIGIN}/kanban/open?id=${encodeURIComponent(item.kanbanId)}`;
  const reorderScanUrl = `${APP_ORIGIN}/kanban/scan?id=${encodeURIComponent(item.kanbanId)}&qty=1`;

  const { bg: locBg, text: locText } = getLocationStyles(item.location);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button onClick={() => nav(`/kanban/new?edit=${encodeURIComponent(kanbanId)}`)} style={btnSecondary}>Edit</button>
        <button onClick={() => window.print()} style={btnPrimary}>Print</button>
        <Link to="/kanban/queue" style={{ alignSelf: "center", marginLeft: "auto" }}>← Back to Queue</Link>
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
          // Add extra bottom padding so content never sits behind corner QR cards
          padding: "12px 12px 150px 12px",
          display: "grid",
          gridTemplateRows: "auto auto 1fr",
          gap: 8,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Title */}
        <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: 0.3, textAlign: "center" }}>
          KANBAN CARD
        </div>

        {/* Location banner (full width, centered, NO label) */}
        <div
          style={{
            background: locBg,
            color: locText,
            textAlign: "center",
            fontWeight: 900,
            fontSize: 18,
            padding: "6px 10px",
            borderRadius: 8,
          }}
        >
          {item.location || "—"}
        </div>

        {/* Body */}
        <div style={{ display: "grid", gap: 8 }}>
          {/* BIG centered image */}
          <div style={{ display: "grid", justifyItems: "center" }}>
            {item.photoUrl ? (
              <img
                alt=""
                src={item.photoUrl}
                style={{
                  width: 180,
                  height: 180,
                  objectFit: "cover",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                }}
              />
            ) : (
              <div
                style={{
                  width: 180,
                  height: 180,
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

          {/* Item name */}
          <div style={{ fontWeight: 900, fontSize: 16, textAlign: "center" }}>
            {item.itemName || "—"}
          </div>

          {/* Package size + Lead (if present) */}
          <div style={{ fontSize: 12, color: "#111827", textAlign: "center" }}>
            {item.packageSize || "—"}{item.leadTimeDays ? ` • Lead: ${item.leadTimeDays}d` : ""}
          </div>

          {/* Bin / Reorder back (big & bold) */}
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
        </div>

        {/* Corner QR codes — smaller, far apart, on top of everything */}
        <div
          style={{
            position: "absolute",
            left: 10,
            bottom: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 6,
            background: "white",
            width: 120,
            zIndex: 5,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 11, textAlign: "center" }}>Order Page</div>
          <img
            alt="Order QR"
            src={makeQr(orderOpenUrl, 140)}
            style={{ width: 100, height: 100, display: "block", margin: "6px auto 0" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>

        <div
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 6,
            background: "white",
            width: 120,
            zIndex: 5,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 11, textAlign: "center" }}>Request Reorder</div>
          <img
            alt="Reorder Request QR"
            src={makeQr(reorderScanUrl, 140)}
            style={{ width: 100, height: 100, display: "block", margin: "6px auto 0" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
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
