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

export default function KanbanCardPreview() {
  // Support either :kanbanId or :id
  const params = useParams();
  const routeKanbanId = params.kanbanId || params.id || "";
  const nav = useNavigate();

  const [item, setItem] = useState(null);
  const [err, setErr] = useState("");
  const [shortOrderUrl, setShortOrderUrl] = useState("");
  const printRef = useRef(null);

  async function handlePrintAndSave() {
    try {
      const node = printRef.current;
      if (!node) {
        window.print();
        return;
      }
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });
      const imgData = canvas.toDataURL("image/png");

      // Make a Letter PDF so the upload matches what you print
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "in",
        format: [8.5, 11],
        compress: true,
      });

      const pageW = 8.5, pageH = 11;
      const imgW = canvas.width / 96;  // px → inches
      const imgH = canvas.height / 96;
      const ratio = Math.min(pageW / imgW, pageH / imgH);
      const drawW = imgW * ratio;
      const drawH = imgH * ratio;
      const dx = (pageW - drawW) / 2;
      const dy = (pageH - drawH) / 2;

      doc.addImage(imgData, "PNG", dx, dy, drawW, drawH, undefined, "FAST");

      const pdfBlob = doc.output("blob");
      const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "").trim();
      const fname = `${clean(item?.itemName || item?.kanbanId || routeKanbanId || "kanban")} (front+back).pdf`;

      const fd = new FormData();
      fd.append("file", pdfBlob, fname);
      fd.append("filename", fname);
      // optional: fd.append("subfolder", String(item?.location || ""));

      await fetch(`${BACKEND}/api/kanban/upload-card`, {
        method: "POST",
        body: fd,
        credentials: "include",
      }).catch(() => { /* ignore upload errors but still print */ });
    } finally {
      window.print();
    }
  }



  // --- Fetch item (public) ---
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(routeKanbanId)}`,
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
        const orderTarget =
          normalized.orderMethod === "Email"
            ? normalized.orderEmail
              ? `mailto:${normalized.orderEmail}`
              : ""
            : (normalized.orderUrl || "").trim();

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
  }, [routeKanbanId]);

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
        <button onClick={() => window.print()} style={btnPrimary}>Print</button>
        <Link to="/kanban/queue" style={{ alignSelf: "center", marginLeft: "auto" }}>
          ← Back to Queue
        </Link>
      </div>

      {/* Letter page with two 4×6 cards side-by-side */}
      <div ref={printRef} className="printPage">
        <div className="cardRow">

          {/* FRONT CARD */}
          <div
            className="card"
            style={{

            width: "3.5in",
            height: "5.5in",
            border: "2px solid #111827",
            borderRadius: 12,
            background: "white",
            boxSizing: "border-box",
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

          {/* Package size (left) + Price (right); lead time tucks under size if present */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#111827", textAlign: "left" }}>
              {showVal(item.packageSize)}
              {item.leadTimeDays ? ` • Lead: ${String(item.leadTimeDays).trim()}d` : ""}
            </div>
            <div style={{ fontSize: 12, color: "#111827", textAlign: "right", fontWeight: 800 }}>
              {(() => {
                const raw = String(item.costPerPkg || "").trim();
                if (!raw) return "—";
                const n = Number(raw.replace(/[^0-9.-]/g, ""));
                return isNaN(n) ? raw : `$${n.toFixed(2)}`;
              })()}
            </div>
          </div>


          {/* Bin / Reorder */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Bin Qty (units)</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{showVal(item.binQtyUnits)}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Reorder Qty (basis)</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{showVal(item.reorderQtyBasis)}</div>
            </div>
          </div>
        </div>

        {/* Corner QRs */}
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
          {/* generate at 180px for cleaner code; render smaller */}
          <img
            alt="Order QR"
            src={makeQr(orderQrUrl, 180)}
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
            src={makeQr(reorderScanUrl, 180)}
            style={{ width: 100, height: 100, display: "block", margin: "6px auto 0" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>
      </div>
          {/* BACK CARD */}
          <div
            className="card backCard"
            style={{
              width: "3.5in",
              height: "5.5in",
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
        :root {
          --card-w: 4in;
          --card-h: 6in;
          --gap: 0.25in;
          --margin-left: 0.125in;
          --margin-top: 0.125in;
        }

        @page {
          size: Letter;
          margin: 0; /* We'll handle our own margin */
        }

        .printPage {
          position: relative;
          width: 8.5in;
          height: 11in;
          box-sizing: border-box;
          padding-left: var(--margin-left);
          padding-top: var(--margin-top);
          background: white;
        }

        .cardRow {
          display: grid;
          grid-template-columns: var(--card-w) var(--card-w);
          gap: var(--gap);
        }

        .card {
          width: var(--card-w);
          height: var(--card-h);
          box-shadow: 0 0 0.05in rgba(0,0,0,0.2);

          /* very, very light trim guide */
          position: relative;
          border: 0.25pt solid rgba(0,0,0,0.08); /* ultra-light grey */

          /* subtle internal corner crop marks (stay inside the card) */
          background-image:
            linear-gradient(to right, rgba(0,0,0,0.08), rgba(0,0,0,0.08)),
            linear-gradient(to bottom, rgba(0,0,0,0.08), rgba(0,0,0,0.08)),
            linear-gradient(to right, rgba(0,0,0,0.08), rgba(0,0,0,0.08)),
            linear-gradient(to bottom, rgba(0,0,0,0.08), rgba(0,0,0,0.08));
          background-repeat: no-repeat;
          /* corner tick lengths: ~0.25in; line thickness: 0.5pt */
          background-size:
            0.5pt 0.25in, 0.25in 0.5pt,
            0.5pt 0.25in, 0.25in 0.5pt;
          /* inset the ticks a hair so they’re not on the edge */
          background-position:
            left 0.125in top 0, left 0 top 0.125in,
            right 0.125in bottom 0, right 0 bottom 0.125in;
        }


        @media print {
          html, body {
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Hide everything except cards */
          body * { visibility: hidden; }
          .printPage, .printPage * { visibility: visible; }

          .printPage {
            position: fixed;
            inset: 0;
            margin: 0;
            padding-left: var(--margin-left);
            padding-top: var(--margin-top);
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
