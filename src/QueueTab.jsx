import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";

// ---------- Config ----------
const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");
const BACKEND_ROOT = API_ROOT.replace(/\/api$/, "");

// ---------- Utils ----------
function toDate(v) {
  if (v == null) return null;
  if (typeof v === "number" && isFinite(v)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    return new Date(base.getTime() + v * 86400000);
  }
  const d = new Date(String(v).trim());
  return isNaN(d) ? null : d;
}
function fmtMMDD(d) {
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}
function firstField(obj, names) {
  for (const n of names) {
    const val = obj?.[n];
    if (val !== undefined && val !== null && String(val).trim() !== "") return val;
  }
  return null;
}

// Extract Google Drive file ID from =IMAGE(...) or URL
function extractFileIdFromFormulaOrUrl(v) {
  try {
    const s = String(v || "");
    const m1 = s.match(/id=([A-Za-z0-9_-]+)/);
    if (m1) return m1[1];
    const m2 = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m2) return m2[1];
    const m3 = s.match(/IMAGE\("([^"]+)"/i);
    if (m3) return extractFileIdFromFormulaOrUrl(m3[1]);
  } catch {}
  return null;
}

function orderThumbUrl(order) {
  // Prefer direct server-provided URL if any
  const direct = firstField(order, ["imageUrl", "image", "thumbnail", "imageURL", "thumbnailUrl"]);
  if (direct && /^https?:\/\//i.test(String(direct))) return direct;

  // Extract a Drive file id from formula or any field in the row
  const previewLike = firstField(order, ["Preview", "preview", "PreviewFormula", "previewFormula"]) || "";
  let id = extractFileIdFromFormulaOrUrl(previewLike);
  if (!id) {
    for (const val of Object.values(order)) {
      const s = String(val || "");
      let m = s.match(/id=([A-Za-z0-9_-]+)/) || s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
      if (m) { id = m[1]; break; }
    }
  }
  if (!id) return null;

  return `https://drive.google.com/thumbnail?id=${id}&sz=w160`;
}

// Stage priority: Sewing → Embroidery → Print → Cut → Fur → Ordered
function stageBucket(order) {
  const s = String(order["Stage"] || "").toLowerCase();
  if (s.includes("sew"))        return 0;
  if (s.includes("embroidery")) return 1;
  if (s.includes("print"))      return 2;
  if (s.includes("cut"))        return 3;
  if (s.includes("fur"))        return 4;
  if (s.includes("ordered"))    return 5;
  return 6;
}
function makeComparator() {
  return (a, b) => {
    const ba = stageBucket(a), bb = stageBucket(b);
    if (ba !== bb) return ba - bb;

    // Embroidery: prefer End Embroidery Time
    if (ba === 1) {
      const aEnd = toDate(firstField(a, [
        "End Embroidery Time","Embroidery End Time","Embroidery End","End Embroidery","End Time"
      ]));
      const bEnd = toDate(firstField(b, [
        "End Embroidery Time","Embroidery End Time","Embroidery End","End Embroidery","End Time"
      ]));
      const at = aEnd ? aEnd.getTime() : Infinity;
      const bt = bEnd ? bEnd.getTime() : Infinity;
      if (at !== bt) return at - bt;
    }

    // Otherwise: Due Date
    const aDue = toDate(a["Due Date"]);
    const bDue = toDate(b["Due Date"]);
    const at = aDue ? aDue.getTime() : Infinity;
    const bt = bDue ? bDue.getTime() : Infinity;
    if (at !== bt) return at - bt;

    const aId = String(a["Order #"] || "");
    const bId = String(b["Order #"] || "");
    return aId.localeCompare(bId, undefined, { numeric: true });
  };
}

// ---------- Toast ----------
function Toast({ kind = "success", message, onClose }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", right: 16, bottom: 16, maxWidth: 360,
        background: kind === "success" ? "#0fbf4a" : "#e45858",
        color: "#fff", padding: "10px 14px", borderRadius: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,0.18)", fontWeight: 600,
        zIndex: 9999, display: "flex", alignItems: "center", gap: 10, cursor: "pointer"
      }}
      onClick={onClose}
      title="Click to dismiss"
    >
      <span>{kind === "success" ? "✓" : "⚠"}</span>
      <span style={{ lineHeight: 1.2 }}>{message}</span>
    </div>
  );
}

// ---------- Component ----------
export default function QueueTab() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const inFlight = useRef(false);

  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");
  const toastTimer = useRef(null);

  const [selected, setSelected] = useState({}); // { [orderId]: true }

  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printOrder, setPrintOrder] = useState(null);
  const [printServiceOnline, setPrintServiceOnline] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);

  // Search bar state
  const [searchQuery, setSearchQuery] = useState("");

  // responsive compact mode for narrow screens
  const [ww, setWw] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1400));
  useEffect(() => {
    function onResize() { setWw(window.innerWidth); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const compact = ww < 1200;

  function showToast(message, kind = "success", ms = 1800) {
    setToastMsg(message); setToastKind(kind);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), ms);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Reusable fetcher (first load sets isLoading; refreshes do not blank the UI)
  const fetchOrders = useCallback(async (opts = { refresh: false }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!opts.refresh) setIsLoading(true);
      const url = `${API_ROOT}/combined${opts.refresh ? '?refresh=1' : ''}`;
      const res = await axios.get(url, { withCredentials: true });
      setOrders(res.data?.orders || []);
    } catch {
      // swallow; UI will show last-known data
    } finally {
      if (!opts.refresh) setIsLoading(false);
      inFlight.current = false;
    }
  }, [API_ROOT]);

  // initial + polling
  useEffect(() => {
    let canceled = false;
    (async () => { if (!canceled) await fetchOrders(); })();
    const t = setInterval(() => { if (!canceled) fetchOrders({ refresh: true }); }, 60000);
    return () => { canceled = true; clearInterval(t); };
  }, [fetchOrders]);

  // 🆕 Check if Print Service is up
  useEffect(() => {
    async function checkService() {
      try {
        await fetch(`${BACKEND_ROOT}/print`, { method: "OPTIONS" });
        setPrintServiceOnline(true);
      } catch {
        setPrintServiceOnline(false);
      }
    }

    checkService();
    const interval = setInterval(checkService, 30000);
    return () => clearInterval(interval);
  }, []);

  // Filter + sort
  const cards = useMemo(() => {
    // 1) Filter for Open jobs (not COMPLETE) with front or back products
    let base = (orders || []).filter(o => {
      const status = String(o["Status"] || "").trim().toUpperCase();
      const stage  = String(o["Stage"]  || "").trim().toUpperCase();
      const prod = String(o["Product"] || "").toLowerCase();
      
      // Must not be COMPLETE
      if (status === "COMPLETE" || stage === "COMPLETE") {
        // But if search query matches, include it anyway
        if (searchQuery) {
          const orderId = String(o["Order #"] || "").toLowerCase();
          return orderId.includes(searchQuery.toLowerCase());
        }
        return false;
      }
      
      // Must have "front" or "back" in product name
      const hasFrontOrBack = prod.includes("front") || prod.includes("back");
      
      // If search query is provided, filter by order number (show all matching, even complete/queued)
      if (searchQuery) {
        const orderId = String(o["Order #"] || "").toLowerCase();
        return orderId.includes(searchQuery.toLowerCase());
      }
      
      return hasFrontOrBack;
    });

    // 3) Sort
    const sorted = [...base].sort(makeComparator());
    return sorted;
  }, [orders, searchQuery]);

  // ---------- Actions ----------
  function toggleSelect(id, on = undefined) {
    setSelected(prev => {
      const n = { ...prev };
      const cur = !!n[id];
      n[id] = on === undefined ? !cur : !!on;
      return n;
    });
  }
  function toggleSelectAll() {
    if (!cards.length) return;
    const allSelected = cards.every(o => selected[String(o["Order #"])]);
    const next = {};
    if (!allSelected) for (const o of cards) next[String(o["Order #"])] = true;
    setSelected(next);
  }

  // 🆕 Print handler function
  async function handlePrint(mode) {
    if (isPrinting) return; // Prevent double-clicks
    
    setIsPrinting(true);
    try {
      const response = await fetch(`${BACKEND_ROOT}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: printOrder,
          mode
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Print request failed");
      }

      showToast(`Print sent (${mode})`, "success");
      
      // Remove printed job from list (same as FurList complete behavior)
      if (printOrder) {
        setOrders(prev => prev.filter(o => String(o["Order #"]) !== printOrder));
        setSelected(prev => { const n = { ...prev }; delete n[printOrder]; return n; });
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "Print failed", "error", 2600);
    } finally {
      setIsPrinting(false);
      setShowPrintModal(false);
    }
  }

  // 🆕 Batch print handler function
  async function handleBatchPrint(mode) {
    const selectedOrderIds = Object.keys(selected).filter(id => selected[id]);
    if (!selectedOrderIds.length || isPrinting) return;
    
    setIsPrinting(true);
    try {
      const response = await fetch(`${BACKEND_ROOT}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: selectedOrderIds,
          mode
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Batch print request failed");
      }

      const result = await response.json();
      const successCount = result.successCount || selectedOrderIds.length;
      showToast(`Batch print sent: ${successCount}/${selectedOrderIds.length} orders (${mode})`, "success", 3000);
      
      // Remove printed jobs from list
      setOrders(prev => prev.filter(o => !selectedOrderIds.includes(String(o["Order #"]))));
      setSelected({}); // Clear selection after successful batch print
    } catch (err) {
      console.error(err);
      showToast(err.message || "Batch print failed", "error", 2600);
    } finally {
      setIsPrinting(false);
    }
  }

  // ---------- Layout ----------
  // Column order (compact hides Print + Hard/Soft):
  const gridFull = `
    62px   /* Order */
    56px   /* Preview */
    140px  /* Company */
    160px  /* Design */
    50px   /* Qty */
    100px  /* Product */
    80px   /* Stage */
    60px   /* Print column */
    100px  /* Fur Color */
    70px   /* Ship */
    70px   /* Due */
    90px   /* Hard/Soft */
    90px   /* Open button */
    110px  /* Print button */
  `;

  const gridCompact = `
    62px   /* Order */
    56px   /* Preview */
    150px  /* Company */
    140px  /* Design */
    50px   /* Qty */
    100px  /* Product */
    80px   /* Stage */
    100px  /* Fur Color */
    70px   /* Ship */
    70px   /* Due */
    90px   /* Open button */
    110px  /* Print button */
  `;

  const gridTemplate = compact ? gridCompact : gridFull;

  const cellBase = {
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center"
  };

  // Sticky helper
  const stickyRight = (offset, bg) => ({
    position: "sticky", right: offset, zIndex: 2, background: bg || "#fff",
    boxShadow: offset ? "-8px 0 8px -8px rgba(0,0,0,0.12)" : "inset 8px 0 8px -8px rgba(0,0,0,0.12)"
  });

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div style={{ padding: 12, fontSize: 12, lineHeight: 1.2 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }
      `}</style>

      {/* Search bar at the top */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search by job number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: "100%",
            maxWidth: 400,
            padding: "10px 14px",
            fontSize: 14,
            border: "1px solid #ddd",
            borderRadius: 8,
            outline: "none"
          }}
        />
      </div>

      {/* Top bar: batch action */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            if (selectedCount) {
              setShowPrintModal(true);
              setPrintOrder(null); // Signal batch mode
            }
          }}
          className="btn"
          disabled={!selectedCount || !printServiceOnline || isPrinting}
          title={selectedCount ? `Print ${selectedCount} selected orders` : "Select orders to enable"}
          style={{ 
            background: (selectedCount && printServiceOnline) ? "#f0f0f0" : "#f0f0f0", 
            opacity: (selectedCount && printServiceOnline) ? 1 : 0.6,
            borderColor: (selectedCount && printServiceOnline) ? "#ccc" : "#999"
          }}
        >
          Print Selected {selectedCount ? `(${selectedCount})` : ""}
        </button>
        <button
          onClick={() => setSelected({})}
          className="btn"
          disabled={!selectedCount}
          style={{ background: "#f8f8f8", opacity: selectedCount ? 1 : 0.6 }}
          title="Clear all selections"
        >
          Clear
        </button>
      </div>

      {/* Header row */}
      <div
        className="hdr"
        style={{
          display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
          gap: 8, padding: "6px 8px", borderRadius: 10, border: "1px solid #ddd",
          background: "#fafafa", marginBottom: 6, position: "relative"
        }}
      >
        <div style={cellBase}>Order #</div>
        <div style={cellBase}>Preview</div>
        <div style={cellBase}>Company Name</div>
        <div style={cellBase}>Design</div>
        <div style={cellBase}>Qty</div>
        <div style={cellBase}>Product</div>
        <div style={cellBase}>Stage</div>
        {!compact && <div style={cellBase}>Print</div>}
        <div style={cellBase}>Fur Color</div>
        <div style={cellBase}>Ship</div>
        <div style={cellBase}>Due</div>
        {!compact && <div style={cellBase}>Hard/Soft</div>}
        <div style={{ ...cellBase, ...stickyRight(0, "#fafafa"), textAlign: "right" }}>Actions</div>
      </div>

      {/* Content + overlay */}
      {isLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(255, 235, 59, 0.25)", // transparent yellow
            backdropFilter: "blur(1px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "none"
          }}
        >
          <div
            style={{
              padding: "14px 18px",
              background: "rgba(255, 235, 59, 0.85)",
              border: "1px solid #d4b300",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 18,
              color: "#3b3b00",
              boxShadow: "0 8px 20px rgba(0,0,0,0.15)"
            }}
          >
            Loading Jobs…
          </div>
        </div>
      )}
      {cards.length === 0 ? (
        <div style={{ padding: "24px 8px", color: "#777" }}>
          {searchQuery ? `No jobs found matching "${searchQuery}"` : "No Open jobs (front/back) found."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {cards.map(order => {
            const orderId = String(order["Order #"] || "");
            const company = order["Company Name"] || "";
            const design  = order["Design"] || "";
            const qty     = order["Quantity"] || "";
            const product = order["Product"] || "";
            const stage   = order["Stage"] || "";
            const due     = toDate(order["Due Date"]);
            const print   = order["Print"] || "";
            const color   = order["Fur Color"] || "";
            const ship    = toDate(order["Ship Date"]);
            const hardSoft= order["Hard Date/Soft Date"] || "";
            const imageUrl= orderThumbUrl(order);
            const sel = !!selected[orderId];
            const processSheetPrinted = order["Process Sheet Printed"] || "";

            // Card background from Fur Color (with readable text)
            const bg = (() => {
              const nameRaw = color || "";
              const s = String(nameRaw).trim().toLowerCase();
              const table = [
                { k: ["light grey","light gray","lt grey","lt gray"], v: "#D3D3D3" },
                { k: ["grey","gray"], v: "#BEBEBE" },
                { k: ["dark grey","dark gray"], v: "#A9A9A9" },
                { k: ["black"], v: "#111111" },
                { k: ["white"], v: "#FFFFFF" },
                { k: ["navy"], v: "#001F3F" },
                { k: ["blue"], v: "#1E90FF" },
                { k: ["red"], v: "#D9534F" },
                { k: ["green"], v: "#28A745" },
                { k: ["yellow"], v: "#FFD34D" },
                { k: ["orange"], v: "#FF9F40" },
                { k: ["brown","chocolate","coffee"], v: "#7B4B26" },
                { k: ["tan","khaki","beige","sand"], v: "#D2B48C" },
                { k: ["cream","ivory","off white","off-white"], v: "#F5F1E6" },
                { k: ["maroon","burgundy","wine"], v: "#800020" },
                { k: ["purple","violet"], v: "#7D4AA6" },
                { k: ["teal","cyan","aqua"], v: "#3AB7BF" },
                { k: ["pink","rose"], v: "#FF6FA6" },
                { k: ["gold"], v: "#D4AF37" },
                { k: ["silver"], v: "#C0C0C0" },
              ];
              for (const row of table) if (row.k.some(k => s.includes(k))) return row.v;
              const last = s.split(/\s+/).pop();
              for (const row of table) if (row.k.includes(last)) return row.v;
              return nameRaw || "#fff";
            })();
            const fg = (() => {
              const hex = String(bg).replace("#","");
              if (!/^[0-9a-f]{6}$/i.test(hex)) return "#111";
              const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
              const lum = (0.2126*r + 0.7152*g + 0.0722*b)/255;
              return lum > 0.6 ? "#111" : "#fff";
            })();

            // 🚨 Urgency: within 7 business days of Ship Date (or overdue)
            const daysToShip = (() => {
              if (!ship) return null;
              const target = new Date(ship); target.setHours(0,0,0,0);
              const today  = new Date();     today.setHours(0,0,0,0);
              if (target <= today) return 0;
              let count = 0;
              const d = new Date(today);
              while (d < target) {
                const day = d.getDay(); // 0 Sun, 6 Sat
                if (day !== 0 && day !== 6) count++;
                d.setDate(d.getDate() + 1);
              }
              return count;
            })();
            const urgent = daysToShip !== null && daysToShip <= 7;

            return (
              <div
                key={orderId}
                role="button"
                tabIndex={0}
                onClick={() => toggleSelect(orderId)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleSelect(orderId); }
                }}
                style={{
                  display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
                  gap: 8, padding: 10, borderRadius: 14,
                  border: urgent ? "2px solid #e11900" : (sel ? "2px solid #2563eb" : "1px solid #ddd"),
                  background: sel ? "rgba(37, 99, 235, 0.05)" : bg,
                  color: fg, position: "relative",
                  boxShadow: sel ? "0 0 0 4px rgba(37,99,235,0.15)" : "0 1px 3px rgba(0,0,0,0.05)",
                  transform: sel ? "translateY(-1px)" : "none",
                  transition: "border 120ms ease, box-shadow 120ms ease, background 120ms ease, transform 120ms ease",
                  cursor: "pointer", userSelect: "none", outline: "none"
                }}
              >
                {sel && (
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      background: "#2563eb",
                      color: "white",
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 999,
                      padding: "3px 8px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.15)"
                    }}
                  >
                    Selected
                  </div>
                )}
                <div style={{ ...cellBase, fontWeight: 700 }}>{orderId}</div>

                {/* Preview */}
                <div style={{ display: "grid", placeItems: "center" }}>
                  <div style={{ width: 72, height: 52, overflow: "hidden", borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }}>
                    {imageUrl ? (
                      <img
                        loading="lazy" decoding="async" src={imageUrl} alt="preview"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 11, color: "#666" }}>
                        No Preview
                      </div>
                    )}
                  </div>
                </div>

                {/* Company Name */}
                <div style={{ 
                  ...cellBase, 
                  maxWidth: 100, 
                  overflow: "hidden", 
                  textOverflow: "ellipsis", 
                  whiteSpace: "nowrap" 
                }}>
                  {company}
                </div>

                {/* Design */}
                <div style={{ 
                  ...cellBase, 
                  maxWidth: 120, 
                  overflow: "hidden", 
                  textOverflow: "ellipsis", 
                  whiteSpace: "nowrap" 
                }}>
                  {design}
                </div>

                {/* Qty */}
                <div style={{ ...cellBase, width: 40 }}>{qty}</div>

                {/* Product */}
                <div style={{ 
                  ...cellBase, 
                  maxWidth: 90, 
                  overflow: "hidden", 
                  textOverflow: "ellipsis", 
                  whiteSpace: "nowrap" 
                }}>
                  {product}
                </div>

                {/* Stage */}
                <div style={{ ...cellBase, width: 65 }}>{stage}</div>

                {/* Print (if visible) */}
                {!compact && (
                  <div style={{ ...cellBase, width: 50 }}>{print}</div>
                )}

                {/* Fur Color */}
                <div style={{ 
                  ...cellBase, 
                  maxWidth: 90, 
                  overflow: "hidden", 
                  textOverflow: "ellipsis", 
                  whiteSpace: "nowrap" 
                }}>
                  {color}
                </div>

                {/* Ship Date */}
                <div style={{ ...cellBase, width: 60 }}>{fmtMMDD(ship)}</div>

                {/* Due Date */}
                <div style={{ ...cellBase, width: 60, fontWeight: "bold" }}>
                  {fmtMMDD(due)}
                </div>

                {/* Hard/Soft */}
                {!compact && (
                  <div style={{ ...cellBase, width: 75 }}>{hardSoft}</div>
                )}

                {/* Actions (Open, Print). Stop click from toggling the card */}
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    width: "200px",
                    flexShrink: 0,
                    justifyContent: "flex-end",
                    alignItems: "center",
                    whiteSpace: "nowrap"
                  }}
                >
                  {/* Open */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = `https://machineschedule.netlify.app/scan?dept=fur&order=${orderId}`;
                      window.open(url, "_self");
                    }}
                    className="btn"
                    style={{ background: "#eef6ff", borderColor: "#8cb4ff" }}
                  >
                    Open
                  </button>

                  {/* Print / Reprint */}
                  <button
                    disabled={!printServiceOnline}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPrintOrder(orderId);
                      setShowPrintModal(true);
                    }}
                    className="btn"
                    style={{
                      background: printServiceOnline ? "#f0f0f0" : "#ddd",
                      borderColor: printServiceOnline ? "#ccc" : "#999",
                      opacity: printServiceOnline ? 1 : 0.5,
                      cursor: printServiceOnline ? "pointer" : "not-allowed"
                    }}
                  >
                    {printServiceOnline
                      ? (processSheetPrinted ? "Reprint" : "Print")
                      : "Offline"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 🆕 Print Options Modal */}
      {showPrintModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999
          }}
          onClick={() => setShowPrintModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              padding: 24,
              borderRadius: 12,
              width: 360,
              textAlign: "center",
              fontWeight: 700,
              display: "flex",
              flexDirection: "column",
              gap: 12
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 12 }}>
              {printOrder ? `Print Order #${printOrder}` : `Print ${selectedCount} Selected Orders`}
            </div>

            <button
              className="btn"
              style={{ padding: "14px 10px" }}
              onClick={() => {
                if (printOrder) {
                  handlePrint("both");
                } else {
                  handleBatchPrint("both");
                }
              }}
              disabled={isPrinting}
            >
              Bin sheet + Process Sheet
            </button>

            <button
              className="btn"
              style={{ padding: "14px 10px" }}
              onClick={() => {
                if (printOrder) {
                  handlePrint("process");
                } else {
                  handleBatchPrint("process");
                }
              }}
              disabled={isPrinting}
            >
              Process sheet
            </button>

            <button
              className="btn"
              style={{ padding: "14px 10px" }}
              onClick={() => {
                if (printOrder) {
                  handlePrint("binsheet");
                } else {
                  handleBatchPrint("binsheet");
                }
              }}
              disabled={isPrinting}
            >
              Bin sheet
            </button>
          </div>
        </div>
      )}

      {/* 🆕 Printing Overlay */}
      {isPrinting && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(230, 255, 230, 0.85)", // Light green overlay
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            pointerEvents: "auto"
          }}
          aria-live="assertive"
          role="alert"
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "24px 32px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              minWidth: 280
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                border: "4px solid #e6ffe6",
                borderTopColor: "#8ce68c",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite"
              }}
            />
            <div style={{ fontSize: 18, fontWeight: 600, color: "#333" }}>
              Printing...
            </div>
            <div style={{ fontSize: 14, color: "#666" }}>
              Please wait while we process your request
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        </div>
      )}

      <Toast kind={toastKind} message={toastMsg} onClose={() => setToastMsg("")} />
    </div>
  );
}

