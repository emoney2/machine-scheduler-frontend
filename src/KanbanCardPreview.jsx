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
  // palette
  const COLORS = {
    black: "#111827",
    gray: "#9CA3AF",
    royal: "#1D4ED8",
    kelly: "#10B981", // nice bright green close to Kelly
    purple: "#7E22CE",
    orange: "#F97316",
    teal: "#0D9488",
    white: "#FFFFFF",
    text: "#111827",
  };

  // defaults
  let bg = "#F3F4F6"; // light gray if unknown
  let text = COLORS.text;

  if (k === "kitchen") {
    bg = COLORS.black; text = COLORS.white; // bold white text on black
  } else if (k === "cut") {
    bg = COLORS.gray; text = COLORS.text;
  } else if (k === "fur") {
    bg = COLORS.royal; text = COLORS.text;
  } else if (k === "print") {
    bg = COLORS.kelly; text = COLORS.text;
  } else if (k === "sewing") {
    bg = COLORS.purple; text = COLORS.text;
  } else if (k === "shipping") {
    bg = COLORS.orange; text = COLORS.text;
  } else if (k === "embroidery") {
    bg = COLORS.teal; text = COLORS.text;
  }
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
        const url = `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(kanbanId)}`;
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) {
          let detail = "";
          try { detail = await r.text(); } catch {}
          throw new Error(`Preview failed: HTTP ${r.status} ${detail}`);
        }
        const j = await r.json();
        if (!j || !j.item) throw new Error("Item not found (empty payload)");

        // normalize keys from either camelCase or sheet headers, with fallbacks
        const n = (v) => (v === undefined || v === null ? "" : String(v).trim());
        const it = j.item;

        const lead   = n(it["Lead Time (days)"]   ?? it.leadTimeDays   ?? it.leadTime   ?? "");
        const bin    = n(it["Bin Qty (units)"]    ?? it.binQtyUnits    ?? it.binQty     ?? it.binQuantity ?? "");
        const reorder= n(it["Reorder Qty (basis)"]?? it.reorderQtyBasis?? it.reorderQty ?? "");

        const normalized = {
          kanbanId:     n(it["Kanban ID"] ?? it.kanbanId ?? kanbanId),
          itemName:     n(it["Item Name"] ?? it.itemName ?? ""),
          sku:          n(it["SKU"] ?? it.sku ?? ""),
          dept:         n(it["Dept"] ?? it.dept ?? ""),
          category:     n(it["Category"] ?? it.category ?? ""),
          location:     n(it["Location"] ?? it.location ?? ""),
          packageSize:  n(it["Package Size"] ?? it.packageSize ?? ""),
          leadTimeDays: lead,
          binQtyUnits:  bin,
          reorderQtyBasis: reorder,
          orderMethod:  n(it["Order Method (Email/Online)"] ?? it.orderMethod ?? ""),
          orderUrl:     n(it["Order URL"] ?? it.orderUrl ?? ""),
          orderEmail:   n(it["Order Email"] ?? it.orderEmail ?? ""),
          photoUrl:     n(it["Photo URL"] ?? it.photoUrl ?? ""),
        };

        setItem(normalized);

        // Optional: log that a card was previewed
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
          padding: 12,
          display: "grid",
          gridTemplateRows: "auto auto auto 1fr",
          gap: 8,
          position: "relative", // allow corner QRs
        }}
      >
        {/* Title */}
        <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: 0.3, textAlign: "center" }}>
          KANBAN CARD
        </div>

        {/* Location banner (full width, centered, no label) */}
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

        {/* Dept / Category (small, above the image) */}
        <div style={{ fontSize: 12, color: "#374151", textAlign: "center" }}>
          {item.dept} {item.category ? `• ${item.category}` : ""}
        </div>

        {/* Body (image, item name, package/lead, bin/reorder) */}
        <div style={{ display: "grid", gap: 8 }}>
          {/* BIG centered image under dept line */}
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
        </div>

        {/* Corner QR codes — smaller, far apart */}
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
