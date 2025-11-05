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

        // Normalize keys (case/space-proof)
        const raw = j.item;
        const normKey = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const nmap = {};
        Object.keys(raw).forEach((k) => { nmap[normKey(k)] = raw[k]; });
        const pick = (...aliases) => {
          for (const a of aliases) {
            const v = nmap[normKey(a)];
            if (v !== undefined && v !== null && String(v).trim() !== "") return v;
          }
          return "";
        };

        const normalized = {
          kanbanId:        pick("Kanban ID","kanbanId"),
          itemName:        pick("Item Name","itemName"),
          sku:             pick("SKU","sku"),
          location:        pick("Location","location"),
          packageSize:     pick("Package Size","packageSize"),
          leadTimeDays:    String(pick("Lead Time (days)","leadTimeDays","leadTime")).trim(),
          costPerPkg:      pick("Cost (per pkg)","costPerPkg"),
          binQtyUnits:     pick("Bin Qty (units)","Bin Quantity (units)","binQtyUnits","binQty","binQuantity"),
          reorderQtyBasis: pick("Reorder Qty (basis)","reorderQtyBasis","reorderQty"),
          orderMethod:     pick("Order Method (Email/Online)","orderMethod"),
          orderUrl:        pick("Order URL","orderUrl"),
          orderEmail:      pick("Order Email","orderEmail"),
          photoUrl:        pick("Photo URL","photoUrl"),
        };


        if (!alive) return;
        setItem({ ...normalized, _debugRaw: raw });

        // Build the direct order target (mailto or vendor URL)
        // Null-safe getters (item can be null on first render)
        const method      = (item?.orderMethod || "").trim();
        const emailValue  = (item?.orderEmail  || "").trim();
        const urlValue    = (item?.orderUrl    || "").trim();

        // Choose direct target (mailto for Email method, else URL)
        const orderTarget = method === "Email"
          ? (emailValue ? `mailto:${emailValue}` : "")
          : urlValue;

        // Always have a fallback that your app can open/redirect from
        const fallbackOpen = `https://machineschedule.netlify.app/kanban/open?id=${encodeURIComponent(item?.kanbanId || routeKanbanId || "")}`;

        const orderQrUrl = shortOrderUrl || orderTarget || fallbackOpen;


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

  // Final DIRECT URL for Order QR (short if available, fallback to long/mailto)
  const orderTarget =
    item.orderMethod === "Email"
      ? item.orderEmail
        ? `mailto:${item.orderEmail}`
        : ""
      : (item.orderUrl || "").trim();
  const orderQrUrl = shortOrderUrl || orderTarget || "";

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
            width: "4in",
            height: "6in",
            border: "2px solid #111827",
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
        <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: 0.3, textAlign: "center" }}>
          KANBAN CARD
        </div>

        {/* Location banner */}
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
          {/* Big centered image */}
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
            {showVal(item.itemName)}
          </div>

          {/* LOWER: 2 columns — LEFT (Package Size, Bin Qty, Order QR) / RIGHT (Price, Reorder Qty, Reorder QR) */}
          <div className="lower">
            <div className="leftCol">
              <div className="statRow">
                <span className="label">Package Size:</span>
                <span className="value">
                  {showVal(item.packageSize)}
                  {item.leadTimeDays ? ` • Lead: ${String(item.leadTimeDays).trim()}d` : ""}
                </span>
              </div>

              <div className="statRow">
                <span className="label">Bin Qty (units):</span>
                <span className="value">{showVal(item.binQtyUnits)}</span>
              </div>

              {/* Order QR */}
              <div className="qr qr-order">
                <img
                  alt="Order Page QR"
                  src={makeQr(orderQrUrl, 250)}
                />
              </div>

            </div>

            <div className="rightCol">
              <div className="statRow">
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

              <div className="statRow">
                <span className="label">Reorder Qty (basis):</span>
                <span className="value">{showVal(item.reorderQtyBasis)}</span>
              </div>

              {/* Reorder QR */}
              <div className="qr qr-reorder">
                <img
                  alt="Reorder Request QR"
                  src={makeQr(reorderScanUrl, 250)}
                />
              </div>
            </div>
          </div>        {/* closes .lower */}
        </div>          {/* closes Body */}
      </div>            {/* closes .card.front */}
          {/* BACK CARD */}
          <div
            className="card backCard"
            style={{
              width: "4in",
              height: "6in",
              border: "2px solid #111827",
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
              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
                ORDER PLACED — WAITING ON STOCK
              </div>
            </div>
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
        @page {
          size: 8.5in 11in;
          margin: 0;
        }

        .printPage {
          width: 8.5in;
          height: 11in;
          display: grid;
          grid-template-columns: 4in 4in;
          column-gap: 0.25in;
          padding-top: 0.125in;
          padding-left: 0.125in;
          background: white;
          box-sizing: border-box;
          place-items: start;
        }

        .card {
          width: 4in;
          height: 6in;
          border: 0.4pt solid rgba(0,0,0,0.25);
          box-sizing: border-box;
          background: white;
        }

        @media print {
          html, body {
            width: 8.5in;
            height: 11in;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* hide everything except the cards */
          body * { visibility: hidden; }
          .printPage, .printPage * { visibility: visible; }

          .printPage {
            position: fixed;
            inset: 0;
            margin: 0;
            transform: none !important;
          }
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
