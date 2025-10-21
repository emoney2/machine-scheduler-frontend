import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

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
  const color = kind === "error" ? "#a00" : "#0a0";
  const bg    = kind === "error" ? "#fde8e8" : "#e9fbe9";
  return (
    <div style={{
      position: "fixed", bottom: 16, left: 16, padding: "10px 12px",
      background: bg, color, border: `1px solid ${color}33`, borderRadius: 8,
      boxShadow: "0 6px 20px rgba(0,0,0,0.12)", fontSize: 12, zIndex: 50
    }}>
      {message}
      <button onClick={onClose} style={{ marginLeft: 10, border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
    </div>
  );
}

// Parse Drive file id from URL or =IMAGE("...") formula
function extractFileIdFromFormulaOrUrl(v) {
  try {
    const s = String(v || "").trim();
    if (!s) return null;
    const m1 = s.match(/=IMAGE\("([^"]+)"/i);
    const url = m1 ? m1[1] : s;
    const m2 = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]{20,})/);
    return m2 ? m2[1] : null;
  } catch { return null; }
}

function orderThumbUrl(order) {
  const fields = [
    order.preview, order.Preview, order.previewFormula, order.PreviewFormula,
    order.image, order.Image, order.thumbnail, order.Thumbnail, order.imageUrl, order.ImageURL
  ];
  for (const f of fields) {
    const id = extractFileIdFromFormulaOrUrl(f);
    if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w160`;
    if (f && /^https?:\/\//i.test(String(f))) return String(f);
  }
  return "";
}

export default function CutList() {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");

  // Per-material submitted map: { [orderId]: {Material1:true, ...} }
  const [submittedMap, setSubmittedMap] = useState({});

  const inFlight = useRef(false);
  const toastTimer = useRef(null);

  const showToast = (msg, kind = "success", ms = 1600) => {
    setToastMsg(msg);
    setToastKind(kind);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), ms);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Fetcher
  const fetchOrders = useCallback(async (opts = { refresh: false }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!opts.refresh) setIsLoading(true);
      const url = `${API_ROOT}/combined${opts.refresh ? "?refresh=1" : ""}`;
      const res = await axios.get(url, { withCredentials: true });
      const list = res.data?.orders || [];
      setOrders(list);

      // Optional: hydrate submittedMap if backend exposes cut material status in /combined.
      // If not available, we’ll manage it optimistically on click.
    } catch {
      // keep last-known data
    } finally {
      if (!opts.refresh) setIsLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    (async () => { if (!canceled) await fetchOrders(); })();
    const t = setInterval(() => { if (!canceled) fetchOrders({ refresh: true }); }, 60000);
    return () => { canceled = true; clearInterval(t); };
  }, [fetchOrders]);

  // Filter + sort (exclude completed)
  const cards = useMemo(() => {
    let base = (orders || []).filter(o => {
      const stage = String(o["Stage"] || "").trim().toUpperCase();
      const statusCut = String(o["Cut Status"] || "").trim().toUpperCase();
      const status    = String(o["Status"]     || "").trim().toUpperCase();
      const statusForCut = statusCut || status;
      return stage !== "COMPLETE" && statusForCut !== "COMPLETE";
    });
    base = base.filter(o => !String(o["Product"] || "").toLowerCase().includes("towel"));

    // Sort: Due Date asc, then Order #
    base.sort((a, b) => {
      const aDue = toDate(a["Due Date"]);
      const bDue = toDate(b["Due Date"]);
      const at = aDue ? aDue.getTime() : Infinity;
      const bt = bDue ? bDue.getTime() : Infinity;
      if (at !== bt) return at - bt;
      const aId = String(a["Order #"] || "");
      const bId = String(b["Order #"] || "");
      return aId.localeCompare(bId, undefined, { numeric: true });
    });

    return base;
  }, [orders]);

  const selectedCount = Object.values(selected).filter(Boolean).length;

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
        setOrders(prev => prev.filter(o => String(o["Order #"]) !== orderId));
        showToast("Saved to Cut List");
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
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (!ids.length) return;
    let ok = 0, fail = 0;

    try {
      // Fallback: loop (keeps code simple and more resilient if partial failures occur)
      for (const id of ids) {
        const order = orders.find(o => String(o["Order #"]) === id);
        if (!order) { fail++; continue; }
        try {
          const res = await axios.post(`${API_ROOT}/cut/complete`,
            { orderId: id, quantity: order["Quantity"] || 0 },
            { withCredentials: true }
          );
          if (res.data?.ok) { ok++; } else { fail++; }
        } catch { fail++; }
      }

      setOrders(prev => prev.filter(o => !ids.includes(String(o["Order #"]))));
      setSelected({});
      await fetchOrders({ refresh: true });
      showToast(fail ? `Completed ${ok}, failed ${fail}` : `Completed ${ok} orders`,
        fail ? "error" : "success", fail ? 2600 : 1800);
    } finally {}
  }

  // Material-only submit
  const MATERIAL_KEYS = ["Material1", "Material2", "Material3", "Material4", "Material5", "Back Material"];

  const handleMaterialClick = async (e, order, materialKey) => {
    e.stopPropagation(); // don’t toggle card selection
    const orderId = String(order["Order #"] || "");
    const already = submittedMap[orderId]?.[materialKey];
    if (already) return;

    try {
      const res = await axios.post(`${API_ROOT}/cut/submitMaterial`, {
        orderId,
        materialKey,
        // quantity omitted → server will use job Quantity in the row
      }, { withCredentials: true });

      if (res.data?.ok) {
        const submitted = res.data.submitted || {};
        setSubmittedMap(prev => ({ ...prev, [orderId]: submitted }));

        // If all six are submitted, auto-complete + remove
        const allDone = MATERIAL_KEYS.every(k => submitted[k]);
        if (allDone) {
          await markComplete(order);
        } else {
          showToast(`Submitted ${materialKey}`);
        }
      } else {
        showToast(res.data?.error || "Submit failed", "error", 2600);
      }
    } catch {
      showToast("Error submitting material", "error", 2600);
    }
  };

  // Layout
  const gridFull =
    "60px 44px 120px 120px 42px 96px 84px 52px 60px 60px 60px 60px 60px 90px 64px 64px 100px 92px 80px"; // removed the old "Cut Type" column
  const gridTemplate = gridFull;
  const stickyRight = (offset, bg) => ({
    position: "sticky", right: offset, zIndex: 2, background: bg || "#fff",
    boxShadow: "-8px 0 8px -8px rgba(0,0,0,0.12)"
  });

  const legendTileBase = {
    width: 16, height: 12, borderRadius: 3, border: "1px solid #cfcfcf",
    background: "#fff", display: "inline-block", verticalAlign: "middle", marginRight: 6
  };

  return (
    <div style={{ padding: 10, fontSize: 11, lineHeight: 1.2 }}>
      <style>{`
        .cardStripeBoth {
          background-image:
            linear-gradient(white, white),
            repeating-linear-gradient(135deg, rgba(0,0,0,0.04) 0, rgba(0,0,0,0.04) 2px, transparent 2px, transparent 6px);
          background-origin: border-box;
          background-clip: padding-box, border-box;
        }
        .matClickable { cursor: pointer; }
        .matDisabled  { cursor: default; opacity: 0.5; }
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }
      `}</style>

      {/* Legend row (replaces "Cut List" title) */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={legendTileBase} />
          <span style={{ fontWeight: 700 }}>Custom/Die</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            ...legendTileBase,
            backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.08) 0, rgba(0,0,0,0.08) 2px, transparent 2px, transparent 6px)"
          }} />
          <span style={{ fontWeight: 700 }}>Both</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...legendTileBase, background: "#e6e6e6" }} />
          <span style={{ fontWeight: 700 }}>Submitted material</span>
        </div>
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

      {/* Headers */}
      <div className="hdr" style={{ display: "grid", gridTemplateColumns: gridTemplate, gap: 6, padding: "6px 6px" }}>
        <div style={{ textAlign: "center" }}>#</div>
        <div style={{ textAlign: "center" }}>Preview</div>
        <div style={{ textAlign: "center" }}>Company</div>
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
            const cutType = String(order["Cut Type"] || "").trim();

            const isSaving = !!saving[orderId];
            const sel = !!selected[orderId];

            const daysToShip = businessDaysUntil(ship);
            const urgent = daysToShip !== null && daysToShip <= 7;

            const ctLower = cutType.toLowerCase();
            const isBoth = (ctLower === "both");
            // Custom and Die are treated the same (plain card). Both = diagonal micro-stripe.

            const sub = submittedMap[orderId] || {};
            const matStatus = (key, labelValue) => {
              const isEmpty = !String(labelValue || "").trim();
              const done = !!sub[key];
              const className = " " + (done ? "matDisabled" : (isEmpty ? "" : "matClickable"));
              return { done, isEmpty, className };
            };

            const onClickMat = (key, labelValue) => (e) => {
              if (!String(labelValue || "").trim()) return; // ignore empty cells
              handleMaterialClick(e, order, key);
            };

            return (
              <div
                key={orderId}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(s => ({ ...s, [orderId]: !s[orderId] }))}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") { e.preventDefault(); setSelected(s => ({ ...s, [orderId]: !s[orderId] })); }
                }}
                className={isBoth ? "cardStripeBoth" : ""}
                style={{
                  display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
                  gap: 6, padding: 6, borderRadius: 12,
                  border: urgent ? "2px solid #e11900" : "1px solid #ddd",
                  background: "#fff", color: "#111", position: "relative",
                  boxShadow: sel ? "0 0 0 2px rgba(0,0,0,0.25) inset" : "0 1px 3px rgba(0,0,0,0.05)",
                  cursor: "pointer", userSelect: "none", outline: "none"
                }}
              >
                {/* Order # */}
                <div style={{ textAlign: "center", fontWeight: 700 }}>{orderId}</div>

                {/* Preview */}
                <div style={{ display: "grid", placeItems: "center" }}>
                  <div style={{ width: 50, height: 34, overflow: "hidden", borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)", background: "#fff" }}>
                    {imageUrl ? (
                      <img loading="lazy" decoding="async" src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : <div style={{ width: "100%", height: "100%", background: "linear-gradient(45deg,#f4f4f4,#f9f9f9)" }} />}
                  </div>
                </div>

                <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{company}</div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{design}</div>
                <div style={{ textAlign: "center" }}>{qty}</div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{product}</div>
                <div style={{ textAlign: "center" }}>{stage}</div>
                <div style={{ textAlign: "center" }}>{print}</div>

                {/* Materials — individually clickable */}
                {(() => {
                  const s1 = matStatus("Material1", m1);
                  const s2 = matStatus("Material2", m2);
                  const s3 = matStatus("Material3", m3);
                  const s4 = matStatus("Material4", m4);
                  const s5 = matStatus("Material5", m5);
                  const sb = matStatus("Back Material", backMat);
                  return (
                    <>
                      <div className={s1.className} onClick={onClickMat("Material1", m1)} title={s1.done ? "Submitted" : (m1 || "")}
                           style={{ textAlign: "center", background: s1.done ? "#eee" : "#fff", borderRadius: 6, padding: "4px 2px" }}>
                        {m1 || ""}
                      </div>
                      <div className={s2.className} onClick={onClickMat("Material2", m2)} title={s2.done ? "Submitted" : (m2 || "")}
                           style={{ textAlign: "center", background: s2.done ? "#eee" : "#fff", borderRadius: 6, padding: "4px 2px" }}>
                        {m2 || ""}
                      </div>
                      <div className={s3.className} onClick={onClickMat("Material3", m3)} title={s3.done ? "Submitted" : (m3 || "")}
                           style={{ textAlign: "center", background: s3.done ? "#eee" : "#fff", borderRadius: 6, padding: "4px 2px" }}>
                        {m3 || ""}
                      </div>
                      <div className={s4.className} onClick={onClickMat("Material4", m4)} title={s4.done ? "Submitted" : (m4 || "")}
                           style={{ textAlign: "center", background: s4.done ? "#eee" : "#fff", borderRadius: 6, padding: "4px 2px" }}>
                        {m4 || ""}
                      </div>
                      <div className={s5.className} onClick={onClickMat("Material5", m5)} title={s5.done ? "Submitted" : (m5 || "")}
                           style={{ textAlign: "center", background: s5.done ? "#eee" : "#fff", borderRadius: 6, padding: "4px 2px" }}>
                        {m5 || ""}
                      </div>
                      <div className={sb.className} onClick={onClickMat("Back Material", backMat)} title={sb.done ? "Submitted" : (backMat || "")}
                           style={{ textAlign: "center", background: sb.done ? "#eee" : "#fff", borderRadius: 6, padding: "4px 2px" }}>
                        {backMat || ""}
                      </div>
                    </>
                  );
                })()}

                <div style={{ textAlign: "center" }}>{fmtMMDD(ship)}</div>
                <div style={{ textAlign: "center" }}>{fmtMMDD(toDate(order["Due Date"]))}</div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{notes}</div>
                <div style={{ textAlign: "center" }}>{hardSoft}</div>

                {/* Complete */}
                <div style={{ ...stickyRight(0, "#fff"), display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); markComplete(order); }}
                    disabled={!!saving[orderId]}
                    className="btn"
                    style={{ background: saving[orderId] ? "#f0f0f0" : "#f6f6f6" }}
                    title="Mark this job complete (writes Quantity next to each listed material)"
                  >
                    {saving[orderId] ? "Saving…" : "Complete"}
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
