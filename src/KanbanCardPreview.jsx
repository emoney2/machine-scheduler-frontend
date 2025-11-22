// src/KanbanCardPreview.jsx
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

// Simple QR generator (external API)
const makeQr = (data, size = 180) => {
  if (!data) {
    console.warn("⚠️ QR generation failed — data is empty");
    return "about:blank"; // prevents invalid URL QR
  }
  const normalized = String(data).trim();
  if (!/^https?:\/\//i.test(normalized) && !/^mailto:/i.test(normalized)) {
    console.warn("⚠️ QR generation received non-absolute URL:", normalized);
  }
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&qzone=1&data=${encodeURIComponent(
    normalized
  )}`;
};


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

  // ✅ Add this: build the scan QR URL manually
  const scanUrl = `https://machinescheduler.netlify.app/kanban/scan?id=${encodeURIComponent(
    item.kanbanId
  )}&qty=1`;
  const scanQr = makeQr(scanUrl);


  // Final DIRECT URL for Order QR (short if available) — with safe fallback
  // Normalize order target safely
  let orderTarget = "";
  if (item.orderMethod === "Email") {
    if (item.orderEmail && item.orderEmail.includes("@")) {
      orderTarget = `mailto:${item.orderEmail.trim()}`;
    }
  } else if (item.orderUrl) {
    const u = item.orderUrl.trim();
    // prepend https:// if missing
    orderTarget = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  }


  const fallbackOpen = `https://machineschedule.netlify.app/kanban/open?id=${encodeURIComponent(item.kanbanId || routeKanbanId)}`;
  const orderQrUrl = shortOrderUrl || orderTarget || fallbackOpen;

  // DIRECT Google Form submission URL (no app, no login)
  // Submits a row with the Kanban ID and qty=1 by default
  const GOOGLE_FORM_ID = "1FAIpQLScsQeFaR22LNHcSZWbqwtNSBQU-j5MJdbxK1AA3cF-yBBxutA";
  const ENTRY_KANBAN = "entry.1189949378"; // Kanban ID field
  const ENTRY_QTY = "entry.312175649";     // Quantity field
  // Use backend route instead of frontend or Google Form
  const reorderScanUrl = `https://machine-scheduler-backend.onrender.com/kanban/scan?id=${encodeURIComponent(
    item.kanbanId || routeKanbanId
  )}&qty=1`;



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
            padding: "12px 12px 16px",
            display: "grid",
            gridTemplateRows: "auto auto 1fr",
            gap: 8,
            position: "relative",
            overflow: "hidden",          // lock aspect ratio so shape can't stretch
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
            fontSize: "clamp(18px, 2.4vw, 28px)", // bigger text
            padding: "10px 12px",                // ~2x taller bar
            borderRadius: 10,
          }}
        >
          {item.location || "—"}
        </div>


        {/* Body — divided into three equal rows (top/middle/bottom) */}
        <div
                style={{
                        display: "grid",
                        gridTemplateRows: "1fr 1fr 1fr",
                        gap: 12,
                        height: "100%",
                        fontSize: "clamp(14px, 1.9vw, 20px)",
                }}
        >
                {/* TOP THIRD: image (left) + item name & price (right) */}
                <div
                        style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 12,
                                alignItems: "center",
                        }}
                >
                        {/* Left: big product image */}
                        <div style={{ display: "grid", alignContent: "start" }}>
                                {item.photoUrl ? (
                                        <img
                                                src={item.photoUrl}
                                                alt=""
                                                style={{
                                                        width: "100%",
                                                        height: "auto",
                                                        aspectRatio: "1 / 1",
                                                        objectFit: "cover",
                                                        borderRadius: 12,
                                                        border: "1px solid #e5e7eb",
                                                }}
                                        />
                                ) : (
                                        <div
                                                style={{
                                                        width: "100%",
                                                        aspectRatio: "1 / 1",
                                                        border: "1px solid #e5e7eb",
                                                        borderRadius: 12,
                                                        display: "grid",
                                                        placeItems: "center",
                                                        color: "#9ca3af",
                                                        fontSize: "clamp(12px, 1.2vw, 14px)",
                                                }}
                                        >
                                                No Photo
                                        </div>
                                )}
                        </div>

                        {/* Right: Item name (big) + Price row (both centered) */}
                        <div style={{ display: "grid", rowGap: 12, textAlign: "center", justifyItems: "center" }}>
                          <div
                            style={{
                              fontWeight: 900,
                              fontSize: "clamp(28px, 3.4vw, 42px)",
                              lineHeight: 1.1,
                            }}
                          >
                            {String(item.itemName || "—")}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "baseline",
                              justifyContent: "center",
                              fontSize: "clamp(18px, 2.2vw, 26px)",
                            }}
                          >
                            <span style={{ opacity: 0.85 }}>Price:</span>
                            <span style={{ fontWeight: 800 }}>
                              {(() => {
                                const raw = String(item.costPerPkg || "").trim();
                                if (!raw) return "—";
                                const n = Number(raw.replace(/[^0-9.-]/g, ""));
                                return isNaN(n) ? raw : `$${n.toFixed(2)}`;
                              })()}
                            </span>
                          </div>
                        </div>
                        </div>   {/* <-- CLOSES the TOP third wrapper */}


                        {/* MIDDLE THIRD: Bin Qty (left) + Reorder Qty (right) */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 16,
                            alignContent: "center",
                          }}
                        >

                        {/* Left stat (label, then quantity underneath) */}
                        <div
                          className="statCol"
                          style={{
                            display: "grid",
                            alignContent: "center",
                            justifyItems: "center",
                            rowGap: 6,
                            textAlign: "center",
                          }}
                        >
                          <div style={{ opacity: 0.8, fontSize: "clamp(16px, 2vw, 22px)" }}>
                            Bin Qty (units):
                          </div>
                          <div style={{ fontWeight: 800, fontSize: "clamp(22px, 2.6vw, 30px)" }}>
                            {String(item.binQtyUnits ?? "—")}
                          </div>
                        </div>

                        {/* Right stat (label, then quantity underneath) */}
                        <div
                          className="statCol"
                          style={{
                            display: "grid",
                            alignContent: "center",
                            justifyItems: "center",
                            rowGap: 6,
                            textAlign: "center",
                          }}
                        >
                          <div style={{ opacity: 0.8, fontSize: "clamp(16px, 2vw, 22px)" }}>
                            Reorder Qty (basis):
                          </div>
                          <div style={{ fontWeight: 800, fontSize: "clamp(22px, 2.6vw, 30px)" }}>
                            {String(item.reorderQtyBasis ?? "—")}
                          </div>
                        </div>
                </div>

                {/* BOTTOM THIRD: QRs — far left and far right */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    alignItems: "start",
                    padding: "10px 10px 0",
                    boxSizing: "border-box",
                    gap: 8,
                    position: "relative",
                    top: "-0.625in",   // lift by 5/8"
                  }}
                >




                        {/* Left QR: Product Link */}
                        <div style={{ justifySelf: "start", display: "grid", rowGap: 6, justifyItems: "center" }}>
                                <img
                                  alt="Product Link"
                                  src={makeQr(orderQrUrl, 480)}
                                  style={{
                                    width: "64%",          // slightly smaller
                                    maxWidth: 228,         // tighter cap
                                    height: "auto",
                                    aspectRatio: "1 / 1",
                                    boxSizing: "border-box",
                                    marginTop: 2,          // tiny lift
                                  }}
                                />



                                <div
                                        style={{
                                                fontSize: "clamp(12px, 1.4vw, 16px)",
                                                fontWeight: 700,
                                                textAlign: "center",
                                        }}
                                >
                                        Product Link
                                </div>
                        </div>

                        {/* Right QR: Reorder Request */}
                        <div style={{ justifySelf: "end", display: "grid", rowGap: 6, justifyItems: "center" }}>
                                <img
                                  alt="Reorder Request QR"
                                  src={scanQr}
                                  style={{
                                    width: "64%",
                                    maxWidth: 228,
                                    height: "auto",
                                    aspectRatio: "1 / 1",
                                    boxSizing: "border-box",
                                    marginTop: 2,
                                  }}
                                />
                                <div
                                        style={{
                                          fontSize: "clamp(11px, 1.25vw, 15px)",
                                          lineHeight: 1.1,           // tighter label height
                                          fontWeight: 700,
                                          textAlign: "center",
                                        }}


                                >
                                        Reorder Request QR
                                </div>
                        </div>
                </div>
        </div>          {/* closes Body */}

        {/* dotted cut line frame */}
        <div className="cutframe" aria-hidden="true" />

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

      </div>            {/* closes .card.backCard */}
    </div>              {/* closes .printPage */}


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
          aspect-ratio: 2 / 3;           /* similar proportions to your sample */
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
