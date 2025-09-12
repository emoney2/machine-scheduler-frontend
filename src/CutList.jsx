import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Parse Drive file id from URL or =IMAGE("...") formula
function extractFileIdFromFormulaOrUrl(v) {
  try {
    const s = String(v || "");
    let m = s.match(/id=([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    m = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    m = s.match(/IMAGE\("([^"]+)"/i); // =IMAGE("...url...")
    if (m) return extractFileIdFromFormulaOrUrl(m[1]);
  } catch {}
  return null;
}

// Build thumbnail URL via proxy (hits disk cache)
// We scan common fields, then the entire row if needed.
function orderThumbUrl(order) {
  const fields = [
    order.preview, order.Preview, order.previewFormula, order.PreviewFormula,
    order.image, order.Image, order.thumbnail, order.Thumbnail, order.imageUrl, order.ImageURL
  ];
  for (const f of fields) {
    const id = extractFileIdFromFormulaOrUrl(f);
    if (id) {
      const v = encodeURIComponent(String(order["Order #"] || order.orderNumber || "nov"));
      return `${API_ROOT}/drive/proxy/${id}?sz=w160&v=${v}`;
    }
    if (f && /^https?:\/\//i.test(String(f))) return f;
  }
  for (const v of Object.values(order || {})) {
    const s = String(v || "");
    let m = s.match(/id=([A-Za-z0-9_-]+)/) || s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m) {
      const ver = encodeURIComponent(String(order["Order #"] || order.orderNumber || "nov"));
      return `${API_ROOT}/drive/proxy/${m[1]}?sz=w160&v=${ver}`;
    }
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

    // Embroidery: prefer End Embroidery Time if available
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

function businessDaysUntil(target) {
  if (!target) return null;
  const t = new Date(target); t.setHours(0,0,0,0);
  const today = new Date();   today.setHours(0,0,0,0);
  if (t <= today) return 0;
  let count = 0;
  const d = new Date(today);
  while (d < t) {
    const day = d.getDay(); // 0 Sun, 6 Sat
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
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
export default function CutList() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const inFlight = useRef(false);

  const [saving, setSaving] = useState({});
  const [selected, setSelected] = useState({});

  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");
  const toastTimer = useRef(null);

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

  // Fetcher
  const fetchOrders = useCallback(async (opts = { refresh: false }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!opts.refresh) setIsLoading(true);
      const url = `${API_ROOT}/combined${opts.refresh ? "?refresh=1" : ""}`;
      const res = await axios.get(url, { withCredentials: true });
      setOrders(res.data?.orders || []);
    } catch {
      // keep last-known data
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

  // Filter + sort
  const cards = useMemo(() => {
    let base = (orders || []).filter(o => {
      const stage = String(o["Stage"] || "").trim().toUpperCase();
      // Prefer Cut Status if present, else general Status
      const statusCut = String(o["Cut Status"] || "").trim().toUpperCase();
      const status    = String(o["Status"]     || "").trim().toUpperCase();
      const statusForCut = statusCut || status;

      return stage !== "COMPLETE" && statusForCut !== "COMPLETE";
    });

    // Product exclusions — per your note: exclude "towel" only (case-insensitive).
    base = base.filter(o => !String(o["Product"] || "").toLowerCase().includes("towel"));

    const sorted = [...base].sort(makeComparator());
    return sorted;
  }, [orders]);

  // Actions
  async function markComplete(order) {
    const orderId = String(order["Order #"] || "");
    const qty = order["Quantity"] || 0;

    setSaving(p => ({ ...p, [orderId]: true }));
    try {
      const resp = await axios.post(`${API_ROOT}/cut/complete`,
        { orderId, quantity: qty },
        { withCredentials: true }
      );
      if (resp.data?.ok) {
        // optimistic removal then refresh from Sheets
        setOrders(prev => prev.filter(o => String(o["Order #"]) !== orderId));
        showToast("Saved to Cut List", "success");
        await fetchOrders({ refresh: true });
      } else {
        showToast(resp.data?.error || "Write failed", "error", 2600);
      }
    } catch {
      showToast("Error writing to Cut List", "error", 2600);
    } finally {
      setSaving(p => { const n = { ...p }; delete n[orderId]; return n; });
      setSelected(p => { const n = { ...p }; delete n[orderId]; return n; });
    }
  }

  async function completeSelected() {
    const ids = Object.keys(selected).filter(id => selected[id]);
    if (!ids.length) return;
    const items = cards.filter(o => ids.includes(String(o["Order #"])))
      .map(o => ({ orderId: String(o["Order #"]), quantity: o["Quantity"] || 0 }));

    setSaving(prev => { const n = { ...prev }; items.forEach(it => n[it.orderId] = true); return n; });

    const chunk = 8;
    let ok = 0, fail = 0;
    for (let i = 0; i < items.length; i += chunk) {
      const slice = items.slice(i, i + chunk);
      const proms = slice.map(it =>
        axios.post(`${API_ROOT}/cut/complete`, it, { withCredentials: true })
          .then(r => (r.data?.ok ? "ok" : "fail"))
          .catch(() => "fail")
      );
      const results = await Promise.all(proms);
      ok += results.filter(x => x === "ok").length;
      fail += results.filter(x => x === "fail").length;
    }

    // optimistic prune + refresh once
    setOrders(prev => prev.filter(o => !ids.includes(String(o["Order #"]))));
    setSelected({});
    setSaving(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n; });
    await fetchOrders({ refresh: true });

    showToast(fail ? `Completed ${ok}, failed ${fail}` : `Completed ${ok} orders`, fail ? "error" : "success", fail ? 2600 : 1800);
  }

  function toggleSelect(id, on = undefined) {
    setSelected(prev => {
      const n = { ...prev };
      n[id] = on === undefined ? !prev[id] : !!on;
      return n;
    });
  }
  const selectedCount = Object.values(selected).filter(Boolean).length;

  // Layout — same sticky right columns (Complete, Select). White cards; only red border for urgency.
  // New column order (as requested):
  // Order #, Preview, Company Name, Design, Quantity, Product, Stage, Price, Due Date, Print, Material1..5, Back Material, Ship Date, Notes, Hard/Soft, Cut Type, Complete, Select
  const gridFull =
    "60px 44px 120px 120px 42px 96px 84px 52px 60px 60px 60px 60px 60px 90px 64px 64px 100px 92px 80px 72px";
  const gridCompact = gridFull;
  const gridTemplate = compact ? gridCompact : gridFull;

  const stickyRight = (offset, bg) => ({
    position: "sticky", right: offset, zIndex: 2, background: bg || "#fff",
    boxShadow: "-8px 0 8px -8px rgba(0,0,0,0.12)"
  });

  const cellBase = { textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <div style={{ padding: 10, fontSize: 11, lineHeight: 1.2 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }
      `}</style>

      {/* Top bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Cut List</div>
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

      {/* Header */}
      <div
        className="hdr"
        style={{
          display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
          gap: 6, padding: "6px 6px", borderRadius: 10, border: "1px solid #ddd",
          background: "#fafafa", marginBottom: 6, position: "relative"
        }}
      >

        <div style={{ textAlign: "center" }}>Order #</div>
        <div style={{ textAlign: "center" }}>Preview</div>
        <div style={{ textAlign: "center" }}>Company Name</div>
        <div style={{ textAlign: "center" }}>Design</div>
        <div style={{ textAlign: "center" }}>Qty</div>
        <div style={{ textAlign: "center" }}>Product</div>
        <div style={{ textAlign: "center" }}>Stage</div>
        <div style={{ textAlign: "center" }}>Print</div>
        <div style={{ textAlign: "center" }}>Material1</div>
        <div style={{ textAlign: "center" }}>Material2</div>
        <div style={{ textAlign: "center" }}>Material3</div>
        <div style={{ textAlign: "center" }}>Material4</div>
        <div style={{ textAlign: "center" }}>Material5</div>
        <div style={{ textAlign: "center" }}>Back Material</div>
        <div style={{ textAlign: "center" }}>Ship</div>
        <div style={{ textAlign: "center" }}>Due</div>
        <div style={{ textAlign: "center" }}>Notes</div>
        <div style={{ textAlign: "center" }}>Hard/Soft</div>
        <div style={{ textAlign: "center" }}>Cut Type</div>
        <div style={{ ...stickyRight(0, "#fafafa"), textAlign: "right" }}>Complete</div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ padding: "24px 8px", color: "#777" }}>Loading orders…</div>
      ) : cards.length === 0 ? (
        <div style={{ padding: "24px 8px", color: "#777" }}>No work items for Cut.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {cards.map(order => {
            const orderId = String(order["Order #"] || "");
            const imageUrl = orderThumbUrl(order);

            const company = order["Company Name"] || "";
            const design  = order["Design"] || "";
            const qty     = order["Quantity"] || "";
            const product = order["Product"] || "";
            const stage   = order["Stage"] || "";
            const price   = order["Price"] || "";
            const due     = toDate(order["Due Date"]);
            const print   = order["Print"] || "";
            const m1      = order["Material1"] || "";
            const m2      = order["Material2"] || "";
            const m3      = order["Material3"] || "";
            const m4      = order["Material4"] || "";
            const m5      = order["Material5"] || "";
            const backMat = order["Back Material"] || "";
            const ship    = toDate(order["Ship Date"]);
            const notes   = order["Notes"] || "";
            const hardSoft= order["Hard Date/Soft Date"] || "";
            const cutType = order["Cut Type"] || "";

            const isSaving = !!saving[orderId];
            const sel = !!selected[orderId];

            // Urgency: ≤ 7 business days to Ship (or overdue)
            const daysToShip = businessDaysUntil(ship);
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
                  gap: 6, padding: 6, borderRadius: 12,
                  border: urgent ? "2px solid #e11900" : "1px solid #ddd",
                  background: "#fff", color: "#111", position: "relative",
                  boxShadow: sel ? "0 0 0 2px rgba(0,0,0,0.25) inset" : "0 1px 3px rgba(0,0,0,0.05)",
                  cursor: "pointer", userSelect: "none", outline: "none"
                }}
              >

                <div style={{ textAlign: "center", fontWeight: 700 }}>{orderId}</div>

                {/* Preview */}
                <div style={{ display: "grid", placeItems: "center" }}>
                  <div style={{ width: 50, height: 34, overflow: "hidden", borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }}>
                    {imageUrl ? (
                      <img loading="lazy" decoding="async" src={imageUrl} alt="preview"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 11, color: "#666" }}>
                        No Preview
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: "center" }}>{company}</div>
                <div style={{ textAlign: "center" }}>{design}</div>
                <div style={{ textAlign: "center" }}>{qty}</div>
                <div style={{ textAlign: "center" }}>{product}</div>
                <div style={{ textAlign: "center" }}>{stage}</div>
                <div style={{ textAlign: "center" }}>{print}</div>
                <div style={{ textAlign: "center" }}>{m1}</div>
                <div style={{ textAlign: "center" }}>{m2}</div>
                <div style={{ textAlign: "center" }}>{m3}</div>
                <div style={{ textAlign: "center" }}>{m4}</div>
                <div style={{ textAlign: "center" }}>{m5}</div>
                <div style={{ textAlign: "center" }}>{backMat}</div>
                <div style={{ textAlign: "center" }}>{fmtMMDD(ship)}</div>
                <div style={{ textAlign: "center" }}>{fmtMMDD(due)}</div>
                <div style={{ textAlign: "center" }}>{notes}</div>
                <div style={{ textAlign: "center" }}>{hardSoft}</div>
                <div style={{ textAlign: "center" }}>{cutType}</div>

                {/* Complete (final sticky cell). Stop click from toggling selection */}
                <div style={{ ...stickyRight(0, "#fff"), textAlign: "right" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); markComplete(order); }}
                    disabled={isSaving}
                    className="btn"
                    style={{
                      background: isSaving ? "rgba(255,255,255,0.8)" : "#ffffff",
                      color: "#222", display: "inline-flex", alignItems: "center", gap: 8,
                      opacity: isSaving ? 0.9 : 1
                    }}
                    title="Write Quantity to Cut List based on H..R sources"
                    aria-busy={isSaving ? "true" : "false"}
                  >
                    {isSaving && (
                      <span className="spin" aria-hidden="true"
                        style={{ width: 12, height: 12, border: "2px solid #999", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block" }} />
                    )}
                    {isSaving ? "Saving…" : "Complete"}
                  </button>
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
