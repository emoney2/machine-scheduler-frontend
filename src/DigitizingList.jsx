// /src/DigitizingList.jsx
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

// Optional: grouping helper (same behavior as Fur List if you keep the mode buttons)
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

// ---------- (Optional) Toast ----------
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
export default function DigitizingList() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState("Main"); // Main | Fur Color | Product (optional grouping)
  const inFlight = useRef(false);

  // (Optional) toast state — safe to leave
  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");
  const toastTimer = useRef(null);

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
  }, []);

  // initial + polling
  useEffect(() => {
    let canceled = false;
    (async () => { if (!canceled) await fetchOrders(); })();
    const t = setInterval(() => { if (!canceled) fetchOrders({ refresh: true }); }, 60000);
    return () => { canceled = true; clearInterval(t); };
  }, [fetchOrders]);

  // Filter + sort (+optional partition like Fur List)
  const cards = useMemo(() => {
    // 1) Only show Stage === Ordered (case-insensitive).
    let base = (orders || []).filter(o => {
      const stage = String(o["Stage"] || "").trim().toUpperCase();
      return stage === "ORDERED";
    });

    // 2) Exclude products with pocket/towel/back (same as Fur List behavior)
    base = base.filter(o => {
      const prod = String(o["Product"] || "").toLowerCase();
      return !(
        prod.includes("pocket") ||
        prod.includes("towel")  ||
        prod.includes("back")
      );
    });

    // 3) Sort strictly by Due Date (oldest first).
    base.sort((a, b) => {
      const ad = toDate(a["Due Date"]);
      const bd = toDate(b["Due Date"]);
      const at = ad ? ad.getTime() : Infinity;
      const bt = bd ? bd.getTime() : Infinity;
      if (at !== bt) return at - bt;

      // tie-breaker: Order # (numeric-aware)
      const aId = String(a["Order #"] || "");
      const bId = String(b["Order #"] || "");
      return aId.localeCompare(bId, undefined, { numeric: true });
    });

    // Optional grouping (keeps the same "feel" as Fur List, but sort remains by due date)
    if (mode === "Fur Color") return priorityPartition(base, "Fur Color");
    if (mode === "Product")   return priorityPartition(base, "Product");
    return base;
  }, [orders, mode]);

  // ---------- Layout ----------
  // Column order (compact hides Print + Hard/Soft):
  // [Order#, Preview, Company, Design, Qty, Product, Stage, (Print), Fur Color, Ship, Due, (Hard/Soft)]
  const gridFull    = "62px 56px 170px 190px 62px 120px 110px 100px 78px 78px 110px 92px";
  const gridCompact = "62px 56px 160px 160px 60px 110px 100px 74px 74px 92px";
  const gridTemplate = compact ? gridCompact : gridFull;

  const cellBase = {
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center"
  };

  return (
    <div style={{ padding: 12, fontSize: 12, lineHeight: 1.2 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }
      `}</style>

      {/* Top bar — optional grouping buttons to match Fur List look */}
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
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(255, 235, 59, 0.25)",
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

      {/* Content */}
      {cards.length === 0 ? (
        <div style={{ padding: "24px 8px", color: "#777" }}>
          No digitizing items (Stage = Ordered) to show.
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
            const ship    = toDate(order["Ship Date"]); // your data seems to use "Ship Date"
            const hardSoft= order["Hard Date/Soft Date"] || "";
            const imageUrl= orderThumbUrl(order);

            return (
              <div
                key={orderId}
                style={{
                  display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
                  gap: 8, padding: 10, borderRadius: 10,
                  border: "1px solid #ddd", background: "#fff"
                }}
              >
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
                <div style={{ ...cellBase, fontWeight: 700 }}>{fmtMMDD(due)}</div>
                {!compact && <div style={cellBase}>{hardSoft}</div>}
              </div>
            );
          })}
        </div>
      )}

      <Toast kind={toastKind} message={toastMsg} onClose={() => setToastMsg("")} />
    </div>
  );
}
