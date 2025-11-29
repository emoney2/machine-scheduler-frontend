import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";

// ---------- Config ----------
const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");

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

function businessDaysUntil(target) {
  if (!target) return null;
  const t = new Date(target); t.setHours(0,0,0,0);
  const today = new Date();   today.setHours(0,0,0,0);

  // If already past due, treat as 0 to force highlight
  if (t <= today) return 0;

  let count = 0;
  for (let d = new Date(today); d < t; d.setDate(d.getDate() + 1)) {
    const day = d.getDay(); // 0 Sun, 6 Sat
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
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

function priorityPartition(rows, key) {
  if (!rows.length) return rows;
  const target = String(rows[0][key] || "").trim().toLowerCase();
  if (!target) return rows;
  const yes = [], no = [];
  for (const r of rows) {
    const v = String(r[key] || "").trim().toLowerCase();
    (v === target ? yes : no).push(r);
  }
  return [...yes, ...no];
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
export default function FurList() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState("Main"); // Main | Fur Color | Product
  const inFlight = useRef(false);

  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");
  const toastTimer = useRef(null);

  const [saving, setSaving] = useState({});   // { [orderId]: true }
  const [selected, setSelected] = useState({}); // { [orderId]: true }

  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printOrder, setPrintOrder] = useState(null);
  const [printServiceOnline, setPrintServiceOnline] = useState(true);



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
        await fetch("http://127.0.0.1:5009/print", { method: "OPTIONS" });
        setPrintServiceOnline(true);
      } catch {
        setPrintServiceOnline(false);
      }
    }

    checkService();
    const interval = setInterval(checkService, 10000);
    return () => clearInterval(interval);
  }, []);


  // Filter + sort (+partition)
  const cards = useMemo(() => {
    // 1) Ignore COMPLETE from either source
    let base = (orders || []).filter(o => {
      const status = String(o["Status"] || "").trim().toUpperCase();
      const stage  = String(o["Stage"]  || "").trim().toUpperCase();
      return status !== "COMPLETE" && stage !== "COMPLETE";
    });

    // 2) Exclude products containing pocket / towel / back (case-insensitive)
    base = base.filter(o => {
      const prod = String(o["Product"] || "").toLowerCase();
      return !(
        prod.includes("pocket") ||
        prod.includes("towel")  ||
        prod.includes("back")
      );
    });

    // 3) Sort and (optionally) partition
    const sorted = [...base].sort(makeComparator());
    if (mode === "Fur Color") return priorityPartition(sorted, "Fur Color");
    if (mode === "Product")   return priorityPartition(sorted, "Product");
    return sorted;
  }, [orders, mode]);

  // ---------- Actions ----------
  async function markComplete(order) {
    const orderId = String(order["Order #"] || "");
    const qty = order["Quantity"] || 0;

    setSaving(prev => ({ ...prev, [orderId]: true }));
    try {
      const resp = await axios.post(`${API_ROOT}/fur/complete`,
        { orderId, quantity: qty }, { withCredentials: true });
      if (resp.data?.ok) {
        // Quick optimistic removal to feel snappy
        setOrders(prev => prev.filter(o => String(o["Order #"]) !== orderId));
        setSelected(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        showToast("Saved to Fur List", "success");

        // Now re-fetch from Sheets so any downstream formulas/status changes are reflected
        await fetchOrders({ refresh: true });
      } else {
        showToast(resp.data?.error || "Write failed", "error", 2600);
      }

    } catch {
      showToast("Error writing to Fur List", "error", 2600);
    } finally {
      setSaving(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    }
  }

  // Batch complete — single request to /fur/completeBatch
  async function completeSelected() {
    const ids = Object.keys(selected).filter(id => selected[id]);
    if (!ids.length) return;

    const items = cards
      .filter(o => ids.includes(String(o["Order #"])))
      .map(o => ({ orderId: String(o["Order #"]), quantity: o["Quantity"] || 0 }));

    setSaving(prev => { const n = { ...prev }; items.forEach(it => n[it.orderId] = true); return n; });

    let ok = false, wrote = 0;
    try {
      const r = await axios.post(`${API_ROOT}/fur/completeBatch`, { items }, { withCredentials: true });
      ok = !!r.data?.ok;
      wrote = r.data?.wrote || 0;
    } catch {
      ok = false;
    }

    if (ok) {
      // Optimistic removal of succeeded orders
      setOrders(prev => prev.filter(o => !ids.includes(String(o["Order #"]))));
      showToast(`Completed ${wrote} orders`, "success");
    } else {
      showToast(`Batch failed — nothing written`, "error", 2600);
    }

    setSelected({});
    setSaving(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n; });

    // Re-sync from Sheets
    await fetchOrders({ refresh: true });
  }


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
    try {
      await fetch("http://127.0.0.1:5009/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: printOrder,
          mode,
          requiresProcessSheetUpdate: mode === "process" || mode === "both"
        })
      });

      // 🆕 Immediately mark as printed in UI if needed
      if (mode === "process" || mode === "both") {
        setOrders(prev =>
          prev.map(o =>
            String(o["Order #"]) === String(printOrder)
              ? { ...o, "Process Sheet Printed": o["Process Sheet Printed"] || "printed" }
              : o
          )
        );
      }

      showToast(`Print sent (${mode})`, "success");
    } catch (err) {
      showToast("Print service not running", "error", 2600);
    }

    setShowPrintModal(false);
  }

  // ---------- Layout ----------
  // Column order (compact hides Print + Hard/Soft):
  // [Order#, Preview, Company, Design, Qty, Product, Stage, Due, (Print), Fur Color, Ship, (Hard/Soft), Complete]
  const gridFull    = "62px 56px 170px 190px 62px 120px 110px 68px 100px 78px 78px 110px 92px";
  const gridCompact = "62px 56px 160px 160px 60px 110px 100px 96px 74px 74px 92px"; // compact: no Print, no Hard/Soft
  const gridTemplate = compact ? gridCompact : gridFull;

  const cellBase = {
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center"
  };

  // Sticky helper (one right sticky column now: Complete)
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

      {/* Top bar: filters + batch action */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {["Main", "Fur Color", "Product"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="btn"
            style={{ background: mode === m ? "#eee" : "#fff" }}
          >
            {m}
          </button>
        ))}

        <div style={{ flex: 1 }} />
        <button
          onClick={completeSelected}
          className="btn"
          disabled={!selectedCount}
          title={selectedCount ? `Complete ${selectedCount} selected` : "Select orders to enable"}
          style={{ background: selectedCount ? "#f6f6f6" : "#f0f0f0", opacity: selectedCount ? 1 : 0.6 }}
        >
          Complete Selected {selectedCount ? `(${selectedCount})` : ""}
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
        <div style={{ ...cellBase, ...stickyRight(0, "#fafafa"), textAlign: "right" }}>Complete</div>
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
        <div style={{ padding: "24px 8px", color: "#777" }}>No work items for Fur.</div>
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
            const isSaving = !!saving[orderId];
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
                  <div style={{ width: 50, height: 34, overflow: "hidden", borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }}>
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

                <div style={cellBase}>{company}</div>
                <div style={cellBase}>{design}</div>
                <div style={cellBase}>{qty}</div>
                <div style={cellBase}>{product}</div>
                <div style={cellBase}>{stage}</div>
                {!compact && <div style={cellBase}>{print}</div>}
                <div style={cellBase}>{color}</div>
                <div style={cellBase}>{fmtMMDD(ship)}</div>
                <div style={cellBase}>{fmtMMDD(due)}</div>
                {!compact && <div style={cellBase}>{hardSoft}</div>}

                {/* Complete (final sticky cell). Stop click from toggling the card */}
                {/* Actions (Print, Open, Complete). Stop click from toggling the card */}
                <div
                  style={{
                    display: "flex",
                    gap: "6px",
                    flexWrap: "wrap",
                    marginTop: "6px",
                    marginBottom: "6px"
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

                  {/* Complete */}
                  <button
                    disabled={isSaving}
                    onClick={(e) => {
                      e.stopPropagation();
                      markComplete(order);
                    }}
                    className="btn"
                    style={{ background: "#e6ffe6", borderColor: "#8ce68c" }}
                  >
                    {isSaving ? "Saving..." : "Complete"}
                  </button>
                </div>

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
              Print Order #{printOrder}
            </div>

            <button
              className="btn"
              style={{ padding: "14px 10px" }}
              onClick={() => handlePrint("both")}
            >
              Process Sheet + Bin Sheet
            </button>

            <button
              className="btn"
              style={{ padding: "14px 10px" }}
              onClick={() => handlePrint("process")}
            >
              Process Sheet Only
            </button>

            <button
              className="btn"
              style={{ padding: "14px 10px" }}
              onClick={() => handlePrint("binsheet")}
            >
              Bin Sheet Only
            </button>
          </div>
        </div>
      )}

      <Toast kind={toastKind} message={toastMsg} onClose={() => setToastMsg("")} />
    </div>
  );
}

