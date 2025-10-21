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
  const [saving, setSaving] = useState({});               // whole-card submit
  const [materialSaving, setMaterialSaving] = useState({}); // material-only submit
  const [isLoading, setIsLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");
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

  const fetchOrders = useCallback(async (opts = { refresh: false }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!opts.refresh) setIsLoading(true);
      const url = `${API_ROOT}/combined${opts.refresh ? "?refresh=1" : ""}`;
      const res = await axios.get(url, { withCredentials: true });
      const list = res.data?.orders || [];
      setOrders(list);
    } catch {
      // keep last-known
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

    // start overlay for this order
    setMaterialSaving(prev => ({ ...prev, [orderId]: true }));
    try {
      const res = await axios.post(`${API_ROOT}/cut/submitMaterial`, {
        orderId,
        materialKey,
      }, { withCredentials: true });

      if (res.data?.ok) {
        const submitted = res.data.submitted || {};
        setSubmittedMap(prev => ({ ...prev, [orderId]: submitted }));

        const allDone = MATERIAL_KEYS.every(k => submitted[k]);
        if (allDone) {
          await markComplete(order); // this will flip the global 'saving' state as well
        } else {
          showToast(`Submitted ${materialKey}`);
        }
      } else {
        showToast(res.data?.error || "Submit failed", "error", 2600);
      }
    } catch {
      showToast("Error submitting material", "error", 2600);
    } finally {
      // stop overlay for this order (unless markComplete is now showing it)
      setMaterialSaving(prev => {
        const n = { ...prev };
        delete n[orderId];
        return n;
      });
    }
  };


  // Layout
  const gridFull =
    "60px 44px 120px 120px 42px 96px 84px 52px 60px 60px 60px 60px 60px 90px 64px 64px 100px 92px 80px";
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
        /* Card backgrounds:
           - Die Cut = white (plain)
           - Custom/Both = very light diagonal grey */
        .cardStripeCustomBoth {
          background-color: #fff;
          background-image: repeating-linear-gradient(
            135deg,
            rgba(0,0,0,0.06) 0,
            rgba(0,0,0,0.06) 2px,
            transparent 2px,
            transparent 6px
          );
        }


        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }

        /* Material buttons */
        .matBtn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 24px;
          padding: 3px 4px;              /* a bit tighter */
          border-radius: 8px;
          border: 1px solid #cfcfcf;
          background: #ffffff;
          font-weight: 700;
          font-size: 10px;               /* ↓ smaller text */
          line-height: 1.1;              /* room for 2-line labels */
          text-align: center;            /* center multi-line text */
          white-space: normal;           /* allow wrapping */
          word-break: break-word;        /* break long words if needed */
          cursor: pointer;
          user-select: none;
          transition: transform 0.06s ease, box-shadow 0.06s ease, background 0.06s ease, border-color 0.06s ease;
        }

        .matBtn:hover { box-shadow: 0 1px 4px rgba(0,0,0,0.12); }
        .matBtn:active { transform: translateY(1px); }
        .matBtn:focus-visible { outline: 2px solid #6aa9ff; outline-offset: 1px; }

        .matBtnDisabled {
          background: #eeeeee;
          color: #666;
          border-color: #d8d8d8;
          cursor: default;
          box-shadow: none;
        }

        /* Submission overlay (transparent yellow) */
        .overlayBusy {
          position: fixed;
          inset: 0;
          background: rgba(255, 230, 128, 0.35); /* transparent yellow */
          backdrop-filter: blur(0.5px);
          z-index: 999;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .overlayCard {
          background: #fff8cc;
          border: 1px solid #e6d87a;
          border-radius: 12px;
          padding: 14px 16px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.18);
          font-weight: 800;
          color: #6a5d00;
        }

      `}</style>

        {(Object.values(saving).some(Boolean) || Object.values(materialSaving).some(Boolean)) && (
          <div className="overlayBusy">
            <div className="overlayCard">Submitting&hellip;</div>
          </div>
        )}

      {/* Legend row (replaces "Cut List" title) */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...legendTileBase, background: "#fff" }} />
          <span style={{ fontWeight: 700 }}>Die Cut</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            ...legendTileBase,
            backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.08) 0, rgba(0,0,0,0.08) 2px, transparent 2px, transparent 6px)"
          }} />
          <span style={{ fontWeight: 700 }}>Custom/Both</span>
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
            const cutType = String(order["Cut Type"] || "").trim().toLowerCase();
            const isStriped = ["custom", "custom cut", "both"].includes(cutType);


            const isSaving = !!saving[orderId];
            const sel = !!selected[orderId];

            const daysToShip = businessDaysUntil(ship);
            const urgent = daysToShip !== null && daysToShip <= 7;

            const sub = submittedMap[orderId] || {};
            const matState = (key, val) => {
              const label = String(val || "").trim();
              const exists = !!label;
              const done = !!sub[key];
              const disabled = done || !exists;
              return { label, disabled, done };
            };

            const onClickMat = (key, labelValue) => (e) => {
              if (!String(labelValue || "").trim()) return;
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
                className={isStriped ? "cardStripeCustomBoth" : ""}
                style={{
                  display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
                  gap: 6, padding: 6, borderRadius: 12,
                  border: urgent ? "2px solid #e11900" : "1px solid #ddd",
                  backgroundColor: "#fff",          // ✅ lets the CSS background-image show through
                  color: "#111", position: "relative",
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

                {/* Materials as buttons */}
                {(() => {
                  const s1 = matState("Material1", m1);
                  const s2 = matState("Material2", m2);
                  const s3 = matState("Material3", m3);
                  const s4 = matState("Material4", m4);
                  const s5 = matState("Material5", m5);
                  const sb = matState("Back Material", backMat);
                  const Button = ({state, onClick}) => (
                    <button
                      type="button"
                      className={`matBtn${state.disabled ? " matBtnDisabled" : ""}`}
                      onClick={state.disabled ? undefined : onClick}
                      title={state.disabled ? (state.done ? "Submitted" : "") : (state.label || "")}
                      aria-disabled={state.disabled}
                    >
                      {state.label || ""}
                    </button>
                  );
                  return (
                    <>
                      <Button state={s1} onClick={onClickMat("Material1", m1)} />
                      <Button state={s2} onClick={onClickMat("Material2", m2)} />
                      <Button state={s3} onClick={onClickMat("Material3", m3)} />
                      <Button state={s4} onClick={onClickMat("Material4", m4)} />
                      <Button state={s5} onClick={onClickMat("Material5", m5)} />
                      <Button state={sb} onClick={onClickMat("Back Material", backMat)} />
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

// ---------- Toast (inline to keep file single) ----------
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
