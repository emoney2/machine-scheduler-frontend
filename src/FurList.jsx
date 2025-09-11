import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

// Parse Google/Excel serial date OR ISO/strings → Date
function toDate(v) {
  if (v == null) return null;
  if (typeof v === "number" && isFinite(v)) {
    // Excel serial days since 1899-12-30
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

// Choose first present field from a list
function firstField(obj, names) {
  for (const n of names) {
    if (obj && obj[n] != null && obj[n] !== "") return obj[n];
  }
  return null;
}

// Stage bucket priority per your spec
function stageBucket(order) {
  const stage = String(order["Stage"] || "").toLowerCase();
  if (stage.includes("embroidery")) return 0;
  if (stage.includes("print"))      return 1;
  if (stage.includes("cut"))        return 2;
  if (stage.includes("fur"))        return 3;
  if (stage.includes("ordered"))    return 4;
  return 5;
}

// Comparator:
// 1) by stage bucket priority
// 2) within "Embroidery" by end embroidery time
// 3) otherwise by Due Date
function makeComparator() {
  return (a, b) => {
    const ba = stageBucket(a);
    const bb = stageBucket(b);
    if (ba !== bb) return ba - bb;

    if (ba === 0) {
      const aEnd = toDate(firstField(a, ["End Embroidery Time", "Embroidery End Time", "Embroidery End", "End Embroidery", "End Time"]));
      const bEnd = toDate(firstField(b, ["End Embroidery Time", "Embroidery End Time", "Embroidery End", "End Embroidery", "End Time"]));
      const at = aEnd ? aEnd.getTime() : Infinity;
      const bt = bEnd ? bEnd.getTime() : Infinity;
      if (at !== bt) return at - bt;
    }

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

    // 3) optional partition by mode
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
        // remove from current list immediately
        setOrders(prev => prev.filter(o => String(o["Order #"]) !== String(orderId)));
        showToast("Saved to Fur List", "success");
      } else {
        showToast(resp.data?.error || "Write failed", "error", 2600);
      }
    } catch (e) {
      showToast("Error writing to Fur List", "error", 2600);
    } finally {
      // clear saving state (safe even if we removed the card)
      setSaving(prev => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  }

  return (
    <div style={{ padding: 12 }}>
      {/* tiny CSS for spinner */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin {
          animation: spin 0.9s linear infinite;
        }
      `}</style>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {["Main", "Fur Color", "Product"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: mode === m ? "#eee" : "#fff",
              cursor: "pointer"
            }}
          >
            {m}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
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

          // We reuse any existing thumbnail key if present on rows (e.g., from backend derivation).
          const thumb = order["imageUrl"]; // fallback: undefined; page still renders fine

          const isSaving = !!saving[orderId];

          return (
            <div
              key={String(orderId)}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr 1fr 1fr 80px 1fr 1fr 100px 80px 120px 100px 140px 120px",
                alignItems: "center",
                gap: 8,
                padding: 8,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}
            >
              {/* Order # */}
              <div style={{ fontWeight: 600 }}>{orderId}</div>

              {/* Preview */}
              <div style={{ width: 72, height: 48, overflow: "hidden", borderRadius: 8, border: "1px solid #eee" }}>
                {thumb ? (
                  <img src={thumb} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 12, color: "#888" }}>
                    No Preview
                  </div>
                )}
              </div>

              <div>{company}</div>
              <div>{design}</div>
              <div>{qty}</div>
              <div>{product}</div>
              <div>{stage}</div>
              <div>{fmtMMDD(due)}</div>
              <div>{print}</div>
              <div>{color}</div>
              <div>{fmtMMDD(ship)}</div>
              <div>{hardSoft}</div>

              {/* Complete */}
              <div style={{ textAlign: "right" }}>
                <button
                  onClick={() => markComplete(order)}
                  disabled={isSaving}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #bbb",
                    background: isSaving ? "#efefef" : "#f6f6f6",
                    cursor: isSaving ? "default" : "pointer",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: isSaving ? 0.8 : 1
                  }}
                  title="Write Quantity to Fur List → Quantity Made, then hide"
                  aria-busy={isSaving ? "true" : "false"}
                >
                  {isSaving && (
                    <span
                      className="spin"
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
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
        <div style={{ marginTop: 24, color: "#777" }}>No work items for Fur.</div>
      )}

      <Toast
        kind={toastKind}
        message={toastMsg}
        onClose={() => setToastMsg("")}
      />
    </div>
  );
}
