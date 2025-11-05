// src/KanbanCardPreview.jsx
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

// Simple QR generator (external API)
const makeQr = (data, size = 180) =>
  data
    ? `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&qzone=1&data=${encodeURIComponent(
        data
      )}`
    : "";

function showVal(v) {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  return s.trim() === "" ? "—" : s;
}

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

export default function KanbanCardPreview({ printOnly = false, idOverride }) {
  // Support either :kanbanId or :id
  const params = useParams();
  const routeKanbanId = params.kanbanId || params.id || "";
  const effectiveId = idOverride || routeKanbanId;
  const nav = useNavigate();

  const [item, setItem] = useState(null);
  const [err, setErr] = useState("");
  const [shortOrderUrl, setShortOrderUrl] = useState("");
  const printRef = useRef(null);

  // Debug panel toggle via ?debug=1
  const debugOn = (() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      return sp.get("debug") === "1";
    } catch {
      return false;
    }
  })();


  function handlePrintAndSave() {
    // Print the live DOM at true size; no canvas, no PDF scaling
    window.print();
  }




  // --- Fetch item (public) ---
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(effectiveId)}`,
          { credentials: "omit" }
        );
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`Preview failed: HTTP ${r.status} ${t}`);
        }
        const j = await r.json();
        if (!j?.item) throw new Error("Item not found (empty payload)");

        // Use server-provided keys directly
        const raw = j.item;
        if (!alive) return;
        setItem({ ...raw, _debugRaw: raw });

        // Build the direct order target (from the freshly fetched raw)
        const method     = String(raw?.orderMethod || "").trim();
        const emailValue = String(raw?.orderEmail  || "").trim();
        const urlValue   = String(raw?.orderUrl    || "").trim();

        const orderTarget = method === "Email"
          ? (emailValue ? `mailto:${emailValue}` : "")
          : urlValue;

        // Shorten long URLs only; never route through app
        if (orderTarget && orderTarget.length > 40 && !orderTarget.startsWith("mailto:")) {
          try {
            const r2 = await fetch(
              `${BACKEND}/api/util/shorten?url=${encodeURIComponent(orderTarget)}`,
              { credentials: "omit" }
            );
            const j2 = await r2.json();
            if (!alive) return;
            setShortOrderUrl(j2?.short || orderTarget);
          } catch {
            if (!alive) return;
            setShortOrderUrl(orderTarget);
          }
        } else {
          setShortOrderUrl(orderTarget);
        }

      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
        setItem(null);
        setShortOrderUrl("");
      }
    })();
    return () => { alive = false; };
  }, [effectiveId]);

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

  const { bg: locBg, text: locText } = getLocationStyles(item.location);

  // Final DIRECT URL for Order QR (short if available) — with safe fallback
  const orderTarget =
    item.orderMethod === "Email"
      ? (item.orderEmail ? `mailto:${item.orderEmail}` : "")
      : (item.orderUrl || "").trim();

  const fallbackOpen = `https://machineschedule.netlify.app/kanban/open?id=${encodeURIComponent(item.kanbanId || routeKanbanId)}`;
  const orderQrUrl = shortOrderUrl || orderTarget || fallbackOpen;

  // DIRECT Google Form submission URL (no app, no login)
  // Submits a row with the Kanban ID and qty=1 by default
  const GOOGLE_FORM_ID = "1FAIpQLScsQeFaR22LNHcSZWbqwtNSBQU-j5MJdbxK1AA3cF-yBBxutA";
  const ENTRY_KANBAN = "entry.1189949378"; // Kanban ID field
  const ENTRY_QTY = "entry.312175649";     // Quantity field
  const reorderScanUrl =
    `https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/formResponse` +
    `?${ENTRY_KANBAN}=${encodeURIComponent(item.kanbanId || routeKanbanId)}` +
    `&${ENTRY_QTY}=1&submit=Submit`;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button
          onClick={() => nav(`/kanban/new?edit=${encodeURIComponent(item.kanbanId || routeKanbanId)}`)}
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

      {/* Letter page with two 4×6 cards side-by-side */}
      <div ref={printRef} className="printPage">

        {/* FRONT CARD */}
        <div
          className="card front"
          style={{
            borderRadius: 12,
            background: "white",
            boxSizing: "border-box",
            padding: "12px",
            display: "grid",
            gridTemplateRows: "auto auto 1fr",
            gap: 8,
            position: "relative",
            overflow: "hidden",
          }}
        >

        {/* Title */}
        <div style={{ fontWeight: 900, fontSize: "clamp(20px, 2.4vw, 28px)", letterSpacing: 0.3, textAlign: "center" }}>
          KANBAN CARD
        </div>

        {/* Location banner */}
        <div
          style={{
            background: locBg,
            color: locText,
            textAlign: "center",
            fontWeight: 900,
            fontSize: 14,
            padding: "4px 8px",
            borderRadius: 8,
          }}
        >
          {item.location || "—"}
        </div>

        {/* Body */}
        <div style={{ display: "grid", gap: 10, fontSize: "clamp(14px, 1.9vw, 20px)" }}>
          {/* Big centered image */}
          <div style={{ display: "grid", justifyItems: "center" }}>
            {item.photoUrl ? (
              <img
                alt=""
                src={item.photoUrl}
                style={{
                  width: 140,
                  height: 140,
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
            {showVal(item.itemName)}
          </div>

          {/* LOWER: 2 columns — LEFT (Package Size, Bin Qty, Order QR) / RIGHT (Price, Reorder Qty, Reorder QR) */}
          <div className="lower">
            <div className="leftCol">
              <div className="statRow" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontSize: "clamp(14px, 1.7vw, 20px)" }}>
                <span className="label" style={{ opacity: 0.8 }}>Price:</span>
                <span className="value" style={{ fontWeight: 700 }}>...</span>
              </div>


              <div className="statRow">
                <span className="label">Bin Qty (units):</span>
                <span className="value">{showVal(item.binQtyUnits)}</span>
              </div>

            </div>

            <div className="rightCol">
              <div className="statRow" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="label">Price:</span>
                <span className="value">
                  {(() => {
                    const raw = String(item.costPerPkg || "").trim();
                    if (!raw) return "—";
                    const n = Number(raw.replace(/[^0-9.-]/g, ""));
                    return isNaN(n) ? raw : `$${n.toFixed(2)}`;
                  })()}
                </span>
              </div>

              <div className="statRow" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="label">Reorder Qty (basis):</span>
                <span className="value">{showVal(item.reorderQtyBasis)}</span>
              </div>

              {/* QRs row: Order + Reorder side-by-side (smaller so both fit) */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginTop: 6,
                justifyItems: "center"
              }}>
                {/* Order QR (left) */}
                <div style={{ display: "grid", justifyItems: "center", rowGap: 4 }}>
                  <img alt="Order Page QR" src={makeQr(orderQrUrl, 320)} style={{ width: "48%", height: "auto", aspectRatio: "1 / 1" }} />
                  <div style={{ fontSize: 11, fontWeight: 700, textAlign: "center" }}>
                    Order Page QR
                  </div>
                </div>

                {/* Reorder QR (right) */}
                <div style={{ display: "grid", justifyItems: "center", rowGap: 4 }}>
                  <img alt="Reorder Request QR" src={makeQr(reorderScanUrl, 320)} style={{ width: "48%", height: "auto", aspectRatio: "1 / 1" }} />
                  <div style={{ fontSize: 11, fontWeight: 700, textAlign: "center" }}>
                    Reorder Request QR
                  </div>
                </div>
              </div>
            </div>
          </div>        {/* closes .lower */}

          {/* dotted cut line frame */}
          <div className="cutframe" aria-hidden="true" />

        </div>          {/* closes Body */}
      </div>            {/* closes .card.front */}
      {/* BACK CARD */}
      <div
        className="card backCard"
        style={{
          borderRadius: 12,
          background: "white",
          boxSizing: "border-box",
          padding: "12px",
          display: "grid",
          placeItems: "center",
        }}
      >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 900 }}>🚚</div>
              <div style={{ fontSize: "clamp(16px, 2.0vw, 24px)", fontWeight: 800, marginTop: 8, textAlign: "center" }}>
                ORDER PLACED — WAITING ON STOCK
              </div>
            </div>

            {/* dotted cut line frame */}
            <div className="cutframe" aria-hidden="true" />

          </div>

        </div>

      {/* Debug panel (add ?debug=1 to URL) */}

      {typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debug") === "1" ? (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#f9fafb",
            maxHeight: 240,
            overflow: "auto",
            fontSize: 12,
          }}
        >
          {JSON.stringify(item?._debugRaw || {}, null, 2)}
        </pre>
      ) : null}

      <style>{`
        /* Let the browser own the physical page; we'll fill it edge-to-edge with padding */
        @page { size: 8.5in 11in; margin: 0; }

        /* Full-width two-column layout that scales with the page */
        .printPage {
          width: 100vw;                 /* fill page width */
          height: 100vh;                /* fill page height */
          display: grid;
          grid-template-columns: 1fr 1fr; /* two equal columns */
          gap: 0.5in;                   /* gutter between cards */
          padding: 0.5in;               /* page margin */
          background: white;
          box-sizing: border-box;
          place-items: start;
        }

        /* Cards scale to their grid column, keeping a tall rectangular shape */
        .card {
          position: relative;
          width: 100%;
          height: auto;
          aspect-ratio: 3 / 4;          /* similar proportions to your sample */
          box-sizing: border-box;
          background: white;
          border-radius: 14px;
          border: 0.9pt solid #9ca3af;  /* visible grey frame */
        }

        /* Faint dotted guideline around each card (optional; keep or remove) */
        .cutframe {
          position: absolute;
          inset: 0;
          box-sizing: border-box;
          border: 1pt dotted #e5e7eb;   /* lighter grey */
          pointer-events: none;
          border-radius: 14px;
        }

        /* Make inner content responsive so it shrinks with the card */
        .card img { max-width: 100%; height: auto; }

        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { margin: 0; padding: 0; }
          body * { visibility: hidden; }
          .printPage, .printPage * { visibility: visible; }
          .printPage { position: fixed; inset: 0; transform: none !important; }
        }
      `}</style>


      {/* Debug panel toggle via ?debug=1 */}
      {(() => {
        try {
          const sp = new URLSearchParams(window.location.search);
          if (sp.get("debug") === "1") {
            return (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: "#f9fafb",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  overflow: "auto",
                  maxHeight: 320,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  🔎 Debug (add ?debug=1 to the URL to show/hide)
                </div>
                <div>
                  <strong>effectiveId:</strong>{" "}
                  {String(idOverride || (params?.kanbanId || params?.id || ""))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong>item keys:</strong>{" "}
                  {item ? Object.keys(item).join(", ") : "(no item)"}
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong>item JSON:</strong>
                  <pre style={{ margin: 0 }}>
                    {JSON.stringify(item?._debugRaw ?? item ?? null, null, 2)}
                  </pre>
                </div>
              </div>
            );
          }
        } catch {}
        return null;
      })()}
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
