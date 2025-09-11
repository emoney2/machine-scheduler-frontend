import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

// Parse Google/Excel serial date OR ISO/strings → Date
function toDate(v) {
  if (v == null) return null;
  if (typeof v === "number" && isFinite(v)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 24 * 60 * 60 * 1000;
    return new Date(base.getTime() + ms);
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtMMDD(d) {
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

// Pick first present field from a list
function firstField(obj, names) {
  for (const n of names) {
    const val = obj?.[n];
    if (val !== undefined && val !== null && String(val).trim() !== "") return val;
  }
  return null;
}

// Stage bucket priority per your spec: Sewing → Embroidery → Print → Cut → Fur → Ordered
function stageBucket(order) {
  const stage = String(order["Stage"] || "").toLowerCase();
  if (stage.includes("sew"))        return 0; // sewing
  if (stage.includes("embroidery")) return 1;
  if (stage.includes("print"))      return 2;
  if (stage.includes("cut"))        return 3;
  if (stage.includes("fur"))        return 4;
  if (stage.includes("ordered"))    return 5;
  return 6;
}

// Comparator:
// 1) by stage bucket priority
// 2) within Embroidery by end embroidery time
// 3) otherwise by Due Date
function makeComparator() {
  return (a, b) => {
    const ba = stageBucket(a);
    const bb = stageBucket(b);
    if (ba !== bb) return ba - bb;

    // Embroidery: sort by End Embroidery Time first
    if (ba === 1) {
      const aEnd = toDate(firstField(a, [
        "End Embroidery Time",
        "Embroidery End Time",
        "Embroidery End",
        "End Embroidery",
        "End Time"
      ]));
      const bEnd = toDate(firstField(b, [
        "End Embroidery Time",
        "Embroidery End Time",
        "Embroidery End",
        "End Embroidery",
        "End Time"
      ]));
      const at = aEnd ? aEnd.getTime() : Infinity;
      const bt = bEnd ? bEnd.getTime() : Infinity;
      if (at !== bt) return at - bt;
    }

    // Others: Due Date
    const aDue = toDate(a["Due Date"]);
    const bDue = toDate(b["Due Date"]);
    const at = aDue ? aDue.getTime() : Infinity;
    const bt = bDue ? bDue.getTime() : Infinity;
    if (at !== bt) return at - bt;

    // final stable tiebreakers
    const aId = String(a["Order #"] || "");
    const bId = String(b["Order #"] || "");
    return aId.localeCompare(bId, undefined, { numeric: true });
  };
}

// When in "Fur Color" or "Product" mode, prioritize rows that match the first card's value
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

// Try to resolve a thumbnail URL using several common keys
function getThumb(order) {
  // Ship.jsx commonly uses `image`. Also try other likely keys.
  const candidates = [
    "image", "thumbnail", "thumb", "preview", "Preview",
    "imageUrl", "imageURL", "thumbnailUrl", "Thumbnail URL",
    "Image URL", "ImageURL"
  ];
  const val = firstField(order, candidates);
  // If the "Preview" cell contains a Sheets formula like =IMAGE(...), your backend must resolve it.
  // Here we only display direct URLs.
  if (!val) return null;
  const s = String(val);
  // Basic sanity: must look like a URL
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

// Map common color names/phrases → hex (fallback: try the raw string)
function colorFromFurName(nameRaw) {
  if (!nameRaw) return null;
  const s = String(nameRaw).trim().toLowerCase();

  // quick direct matches & contains
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
    // Try pulling a simple base color token if two-word branded names (e.g., "Wow Navy")
  ];

  for (const row of table) {
    if (row.k.some(k => s.includes(k))) return row.v;
  }

  // Try last word as a base color (e.g., "Wow Navy" → "navy")
  const last = s.split(/\s+/).pop();
  for (const row of table) {
    if (row.k.includes(last)) return row.v;
  }

  // As a last resort, return the raw string (browser may know it)
  return nameRaw;
}

// Compute readable text color against a background
function textColorFor(bg) {
  // Expect hex like #rrggbb; if not hex, default to dark text
  if (typeof bg !== "string" || !/^#?[0-9a-f]{6}$/i.test(bg.replace("#",""))) return "#111";
  const hex = bg.replace("#","");
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  // luminance
  const lum = (0.2126*r + 0.7152*g + 0.0722*b)/255;
  return lum > 0.6 ? "#111" : "#fff";
}

function Toast({ kind = "success", message, onClose }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        maxWidth: 360,
        background: kind === "success" ? "#0fbf4a" : "#e45858",
        color: "#fff",
        padding: "10px 14px",
        borderRadius: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
        fontWeight: 600,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 10
      }}
      onClick={onClose}
      title="Click to dismiss"
    >
      <span style={{ display: "inline-block" }}>
        {kind === "success" ? "✓" : "⚠"}&nbsp;
      </span>
      <span style={{ lineHeight: 1.2 }}>{message}</span>
    </div>
  );
}

export default function FurList() {
  const [orders, setOrders] = useState([]);
  const [mode, setMode] = useState("Main"); // Main | Fur Color | Product
  const inFlight = useRef(false);

  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");
  const toastTimer = useRef(null);

  // per-order saving state
  const [saving, setSaving] = useState({}); // { [orderId]: true }

  function showToast(message, kind = "success", ms = 1800) {
    setToastMsg(message);
    setToastKind(kind);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), ms);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // initial + polling every 60s (preserve keys to minimize flicker)
  useEffect(() => {
    let canceled = false;

    const fetchOnce = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      axios.get(`${process.env.REACT_APP_API_ROOT}/combined`, { withCredentials: true })
        .then(res => {
          if (canceled) return;
          const rows = (res.data?.orders || []);
          setOrders(rows);
        })
        .catch(() => {})
        .finally(() => { inFlight.current = false; });
    };

    fetchOnce();
    const t = setInterval(fetchOnce, 60000);
    return () => { canceled = true; clearInterval(t); };
  }, []);

  // Filter + sort
  const cards = useMemo(() => {
    // 1) exclude COMPLETE status
    const base = (orders || []).filter(o => String(o["Status"] || "").toUpperCase() !== "COMPLETE");

    // 2) sort by your stage/dates rule
    const sorted = [...base].sort(makeComparator());

    // 3) optional partition by mode (priority to top-card value)
    if (mode === "Fur Color") {
      return priorityPartition(sorted, "Fur Color");
    }
    if (mode === "Product") {
      return priorityPartition(sorted, "Product");
    }
    return sorted;
  }, [orders, mode]);

  async function markComplete(order) {
    const orderId = order["Order #"];
    const qty = order["Quantity"] || 0;

    setSaving(prev => ({ ...prev, [orderId]: true }));
    try {
      const resp = await axios.post(
        `${process.env.REACT_APP_API_ROOT}/fur/complete`,
        { orderId, quantity: qty },
        { withCredentials: true }
      );
      if (resp.data?.ok) {
        setOrders(prev => prev.filter(o => String(o["Order #"]) !== String(orderId)));
        showToast("Saved to Fur List", "success");
      } else {
        showToast(resp.data?.error || "Write failed", "error", 2600);
      }
    } catch (e) {
      showToast("Error writing to Fur List", "error", 2600);
    } finally {
      setSaving(prev => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  }

  // Tight grid + centered content
  const gridTemplate = "72px 64px 170px 200px 72px 150px 120px 84px 84px 120px 90px 120px 110px";
  const cellBase = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textAlign: "center"
  };

  return (
    <div style={{ padding: 12, fontSize: 12, lineHeight: 1.2 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
      `}</style>

      {/* Filter toggles */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {["Main", "Fur Color", "Product"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: mode === m ? "#eee" : "#fff",
              cursor: "pointer",
              fontSize: 12
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Header row */}
      <div
        className="hdr"
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderRadius: 10,
          border: "1px solid #ddd",
          background: "#fafafa",
          marginBottom: 6
        }}
      >
        <div style={cellBase}>Order #</div>
        <div style={cellBase}>Preview</div>
        <div style={cellBase}>Company Name</div>
        <div style={cellBase}>Design</div>
        <div style={cellBase}>Quantity</div>
        <div style={cellBase}>Product</div>
        <div style={cellBase}>Stage</div>
        <div style={cellBase}>Due Date</div>
        <div style={cellBase}>Print</div>
        <div style={cellBase}>Fur Color</div>
        <div style={cellBase}>Ship Date</div>
        <div style={cellBase}>Hard Date/Soft Date</div>
        <div style={{ ...cellBase, textAlign: "right" }}>Complete</div>
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gap: 8 }}>
        {cards.map(order => {
          const orderId = order["Order #"];
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

          const thumb = getThumb(order);
          const isSaving = !!saving[orderId];

          // Background from Fur Color + readable text
          const bg = colorFromFurName(color);
          const fg = textColorFor(typeof bg === "string" ? bg : "#fff");

          return (
            <div
              key={String(orderId)}
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                alignItems: "center",
                gap: 8,
                padding: 8,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: bg || "#fff",
                color: fg,
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}
            >
              <div style={{ ...cellBase, fontWeight: 700 }}>{orderId}</div>

              {/* Preview */}
              <div style={{ display: "grid", placeItems: "center" }}>
                <div style={{ width: 60, height: 40, overflow: "hidden", borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }}>
                  {thumb ? (
                    <img
                      loading="lazy"
                      src={thumb}
                      alt="preview"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{
                      width: "100%", height: "100%",
                      display: "grid", placeItems: "center",
                      fontSize: 11, color: "#888"
                    }}>
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
              <div style={cellBase}>{fmtMMDD(due)}</div>
              <div style={cellBase}>{print}</div>
              <div style={cellBase}>{color}</div>
              <div style={cellBase}>{fmtMMDD(ship)}</div>
              <div style={cellBase}>{hardSoft}</div>

              {/* Complete */}
              <div style={{ textAlign: "right" }}>
                <button
                  onClick={() => markComplete(order)}
                  disabled={isSaving}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.25)",
                    background: isSaving ? "rgba(255,255,255,0.8)" : "#ffffff",
                    cursor: isSaving ? "default" : "pointer",
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: isSaving ? 0.9 : 1,
                    fontSize: 12,
                    color: "#222"
                  }}
                  title="Write Quantity to Fur List → Quantity Made, then hide"
                  aria-busy={isSaving ? "true" : "false"}
                >
                  {isSaving && (
                    <span
                      className="spin"
                      aria-hidden="true"
                      style={{
                        width: 12,
                        height: 12,
                        border: "2px solid #999",
                        borderTopColor: "transparent",
                        borderRadius: "50%",
                        display: "inline-block"
                      }}
                    />
                  )}
                  {isSaving ? "Saving…" : "Complete"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!cards.length && (
        <div style={{ marginTop: 18, color: "#777" }}>No work items for Fur.</div>
      )}

      <Toast
        kind={toastKind}
        message={toastMsg}
        onClose={() => setToastMsg("")}
      />
    </div>
  );
}
