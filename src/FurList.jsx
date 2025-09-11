import React, { useEffect, useMemo, useRef, useState } from "react";
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

// Build thumbnail URL for an order row.
// 1) Prefer server-provided absolute URL fields.
// 2) Parse =IMAGE(...) formula if it contains a full URL.
// 3) If the formula builds a URL from another cell (like REGEXEXTRACT(Y..)),
//    scan ALL fields in the row for any Drive link and extract the file id.
function orderThumbUrl(order) {
  // 0) Prefer absolute URL fields (server already resolved)
  const direct = firstField(order, ["imageUrl", "image", "thumbnail", "imageURL", "thumbnailUrl"]);
  if (direct && /^https?:\/\//i.test(String(direct))) return direct;

  // 1) If Preview/preview holds a straight URL or an =IMAGE("...") with a full URL
  const previewLike = firstField(order, ["Preview", "preview", "PreviewFormula", "previewFormula"]) || "";
  const fromPreviewId = extractFileIdFromFormulaOrUrl(previewLike);
  if (fromPreviewId) return `${API_ROOT}/drive/proxy/${fromPreviewId}?sz=w160`;

  // 2) Fallback: scan EVERY cell for a Drive link (supports your Y-column pattern)
  for (const val of Object.values(order)) {
    const s = String(val || "");
    // id=XXXX on uc?export=view
    const m1 = s.match(/id=([A-Za-z0-9_-]+)/);
    if (m1) return `${API_ROOT}/drive/proxy/${m1[1]}?sz=w160`;
    // /file/d/XXXX/
    const m2 = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m2) return `${API_ROOT}/drive/proxy/${m2[1]}?sz=w160`;
  }

  return null;
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

  // initial + polling
  useEffect(() => {
    let canceled = false;

    const fetchOnce = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      axios.get(`${API_ROOT}/combined`, { withCredentials: true })
        .then(res => {
          if (canceled) return;
          setOrders(res.data?.orders || []);
          setIsLoading(false);
        })
        .catch(() => { if (!canceled) setIsLoading(false); })
        .finally(() => { inFlight.current = false; });
    };

    fetchOnce();
    const t = setInterval(fetchOnce, 60000);
    return () => { canceled = true; clearInterval(t); };
  }, []);

  // Filter + sort (+partition)
  const cards = useMemo(() => {
    let base = (orders || []).filter(o => String(o["Status"] || "").toUpperCase() !== "COMPLETE");
    // Also hide if Stage contains "complete"
    base = base.filter(o => !String(o["Stage"] || "").toLowerCase().includes("complete"));
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
        setOrders(prev => prev.filter(o => String(o["Order #"]) !== orderId));
        setSelected(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        showToast("Saved to Fur List", "success");
      } else {
        showToast(resp.data?.error || "Write failed", "error", 2600);
      }
    } catch {
      showToast("Error writing to Fur List", "error", 2600);
    } finally {
      setSaving(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    }
  }

  // Batch complete (parallel 8 at a time)
  async function completeSelected() {
    const ids = Object.keys(selected).filter(id => selected[id]);
    if (!ids.length) return;

    const items = cards.filter(o => ids.includes(String(o["Order #"])))
      .map(o => ({ orderId: String(o["Order #"]), quantity: o["Quantity"] || 0 }));

    setSaving(prev => { const n = { ...prev }; items.forEach(it => n[it.orderId] = true); return n; });

    const chunk = 8;
    let okCount = 0, failCount = 0;
    for (let i = 0; i < items.length; i += chunk) {
      const slice = items.slice(i, i + chunk);
      const proms = slice.map(it =>
        axios.post(`${API_ROOT}/fur/complete`, it, { withCredentials: true })
          .then(r => (r.data?.ok ? "ok" : "fail"))
          .catch(() => "fail")
      );
      const results = await Promise.all(proms);
      okCount += results.filter(x => x === "ok").length;
      failCount += results.filter(x => x === "fail").length;
    }

    setOrders(prev => prev.filter(o => !ids.includes(String(o["Order #"]))));
    setSelected({});
    setSaving(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n; });

    if (failCount === 0) showToast(`Completed ${okCount} orders`, "success");
    else showToast(`Completed ${okCount}, failed ${failCount}`, "error", 2600);
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

  // ---------- Layout ----------
  // Column order (compact hides Print + Hard/Soft):
  // [Order#, Preview, Company, Design, Qty, Product, Stage, Due, (Print), Fur Color, Ship, (Hard/Soft), Complete, Select]
  const gridFull    = "62px 56px 170px 190px 62px 120px 110px 78px 68px 100px 78px 110px 92px 28px";
  const gridCompact = "62px 56px 160px 160px 60px 110px 100px 74px       96px 74px        92px 28px"; // no Print, no Hard/Soft
  const gridTemplate = compact ? gridCompact : gridFull;

  const cellBase = {
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center"
  };

  // Sticky helpers (two right sticky columns: Complete, then Select)
  const RIGHT_W_SELECT = 28;
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
        <div style={cellBase}>Due</div>
        {!compact && <div style={cellBase}>Print</div>}
        <div style={cellBase}>Fur Color</div>
        <div style={cellBase}>Ship</div>
        {!compact && <div style={cellBase}>Hard/Soft</div>}
        {/* Complete (second-from-right) */}
        <div style={{ ...cellBase, ...stickyRight(RIGHT_W_SELECT, "#fafafa"), textAlign: "right" }}>Complete</div>
        {/* Select-all (far right) */}
        <div style={{ ...stickyRight(0, "#fafafa"), textAlign: "center" }}>
          <input
            aria-label="Select all"
            type="checkbox"
            onChange={toggleSelectAll}
            checked={!!cards.length && cards.every(o => selected[String(o["Order #"])])}
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ padding: "24px 8px", color: "#777" }}>Loading orders…</div>
      ) : cards.length === 0 ? (
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

            return (
              <div
                key={orderId}
                style={{
                  display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
                  gap: 8, padding: 8, borderRadius: 12, border: "1px solid #ddd",
                  background: bg, color: fg, position: "relative",
                  boxShadow: sel ? "0 0 0 2px rgba(0,0,0,0.25) inset" : "0 1px 3px rgba(0,0,0,0.05)"
                }}
              >
                <div style={{ ...cellBase, fontWeight: 700 }}>{orderId}</div>

                {/* Preview */}
                <div style={{ display: "grid", placeItems: "center" }}>
                  <div style={{ width: 50, height: 34, overflow: "hidden", borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }}>
                    {imageUrl ? (
                      <img loading="lazy" src={imageUrl} alt="preview"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                <div style={cellBase}>{fmtMMDD(due)}</div>
                {!compact && <div style={cellBase}>{print}</div>}
                <div style={cellBase}>{color}</div>
                <div style={cellBase}>{fmtMMDD(ship)}</div>
                {!compact && <div style={cellBase}>{hardSoft}</div>}

                {/* Complete (second from right, sticky with right offset = select col width) */}
                <div style={{ ...stickyRight(RIGHT_W_SELECT, bg), textAlign: "right" }}>
                  <button
                    onClick={() => markComplete(order)}
                    disabled={isSaving}
                    className="btn"
                    style={{
                      background: isSaving ? "rgba(255,255,255,0.8)" : "#ffffff",
                      color: "#222", display: "inline-flex", alignItems: "center", gap: 8,
                      opacity: isSaving ? 0.9 : 1
                    }}
                    title="Write Quantity to Fur List → Quantity Made, then hide"
                    aria-busy={isSaving ? "true" : "false"}
                  >
                    {isSaving && (
                      <span className="spin" aria-hidden="true"
                        style={{ width: 12, height: 12, border: "2px solid #999", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block" }} />
                    )}
                    {isSaving ? "Saving…" : "Complete"}
                  </button>
                </div>

                {/* Select (far right, sticky at right:0) */}
                <div style={{ ...stickyRight(0, bg), textAlign: "center" }}>
                  <input
                    aria-label={`Select order ${orderId}`}
                    type="checkbox"
                    checked={sel}
                    onChange={(e) => toggleSelect(orderId, e.target.checked)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Toast kind={toastKind} message={toastMsg} onClose={() => setToastMsg("")} />
    </div>
  );
}
