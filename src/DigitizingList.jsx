// /src/DigitizingList.jsx
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
// Same Drive parsing + **backend thumbnail proxy** as Overview (direct drive.google.com
// thumbnails often stay blank in <img> until interaction; /api/drive/thumbnail uses server auth).
function extractFileIdFromFormulaOrUrl(input) {
  if (!input) return null;
  const s = String(input);
  let m = s.match(/IMAGE\("([^"]+)"/i);
  if (m) return extractFileIdFromFormulaOrUrl(m[1]);
  if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return s;
  m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/\/(?:open|uc)[^?]*\?[^#]*\bid=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/"id":"([A-Za-z0-9_-]{10,})"/);
  if (m) return m[1];
  return null;
}

/** Thumbnail via /api/drive/thumbnail + URL to open (Overview-style popup). */
function resolveOrderPreview(order) {
  const proxyBase = `${BACKEND_ROOT}/api/drive/thumbnail`;
  const proxyForId = (id) => {
    if (!id) return null;
    const params = new URLSearchParams({ fileId: id, sz: "w160" }).toString();
    return `${proxyBase}?${params}`;
  };

  const toPreview = (idOrUrl) => {
    if (!idOrUrl) return null;
    const id = extractFileIdFromFormulaOrUrl(idOrUrl);
    if (id) {
      return {
        thumbUrl: proxyForId(id),
        openUrl: `https://drive.google.com/file/d/${id}/view`,
      };
    }
    const str = String(idOrUrl);
    if (/^https?:\/\//i.test(str)) return { thumbUrl: str, openUrl: str };
    if (/^[A-Za-z0-9_-]{12,}$/.test(str)) {
      return {
        thumbUrl: proxyForId(str),
        openUrl: `https://drive.google.com/file/d/${str}/view`,
      };
    }
    return null;
  };

  const fromAny = (val) => {
    if (!val) return null;
    if (Array.isArray(val)) {
      for (const v of val) {
        const hit = fromAny(v);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof val === "object") {
      const cand = [
        val.imageUrl, val.src, val.url, val.href, val.link, val.image, val.thumbnail, val.preview,
      ];
      for (const c of cand) {
        const hit = fromAny(c);
        if (hit) return hit;
      }
      return toPreview(JSON.stringify(val));
    }
    return toPreview(val);
  };

  const fields = [
    order.imageUrl, order.image,
    order.thumbnailUrl, order.ImageURL,
    order.preview, order.Preview, order.previewFormula, order.PreviewFormula,
    order.Image, order.thumbnail, order.Thumbnail,
    order.images, order.Images, order.imagesLabeled, order.images_labelled,
    order.files, order.attachments, order.Attachment, order.Attachements,
    order.Art, order["Art Link"], order["Art URL"],
  ];
  for (const f of fields) {
    const hit = fromAny(f);
    if (hit) return hit;
  }
  for (const v of Object.values(order || {})) {
    const hit = fromAny(v);
    if (hit) return hit;
  }
  return { thumbUrl: null, openUrl: null };
}

/** Match Overview upcoming-jobs image popup. */
function openPreviewLikeOverview(url) {
  if (!url) return;
  try {
    const w = window.open(url, "_blank", "noopener,width=980,height=720");
    if (w) {
      try { w.opener = null; } catch { /* ignore */ }
      setTimeout(() => {
        try { window.focus(); } catch { /* ignore */ }
      }, 0);
    }
  } catch { /* ignore */ }
}

/** Production Orders material columns (same as Cut List / submit). */
const MATERIAL_ORDER_KEYS = [
  "Material1",
  "Material2",
  "Material3",
  "Material4",
  "Material5",
  "Back Material",
];

function materialLabelsFromOrder(order) {
  const seen = new Set();
  const out = [];
  for (const k of MATERIAL_ORDER_KEYS) {
    const v = String(order?.[k] ?? "").trim();
    if (!v) continue;
    const lk = v.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    out.push(v);
  }
  return out;
}

function normalizeSheetColor(raw) {
  const s = String(raw || "").trim();
  if (!s) return "#e5e7eb";
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`;
  return s;
}

function contrastTextForBackground(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg).replace(/\s/g, ""));
  if (!m) return "#111827";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? "#111827" : "#ffffff";
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
  const [materialColors, setMaterialColors] = useState({});
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

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await axios.get(`${API_ROOT}/material-inventory/colors`, {
          withCredentials: true,
        });
        if (!cancel && res.data && typeof res.data === "object") {
          setMaterialColors(res.data);
        }
      } catch {
        if (!cancel) setMaterialColors({});
      }
    })();
    return () => { cancel = true; };
  }, []);

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
    // 1) Only show jobs with NO Stitch Count
    let base = (orders || []).filter(o => {
      const stitch = String(o["Stitch Count"] || "").trim();
      return stitch === "";
    });

    // 2) Exclude Printed Towels
    base = base.filter(o => {
      const product = String(o["Product"] || "").toLowerCase();
      return !product.includes("printed towel");
    });



    // 3) Sort: samples (qty 1) at top, then by Due Date (oldest first), then Order #
    const isSample = (o) => Number(o["Quantity"]) === 1;
    base.sort((a, b) => {
      const aSample = isSample(a);
      const bSample = isSample(b);
      if (aSample !== bSample) return aSample ? -1 : 1; // samples first

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
  // [Order#, Preview, Company, Design, Qty, Product, Stage, (Print), Materials, Due, (Hard/Soft)]
  const gridFull =
    "62px 56px 170px 190px 62px 120px 110px 100px minmax(140px,1.15fr) 110px 92px";
  const gridCompact =
    "62px 56px 160px 160px 60px 110px 100px minmax(120px,1fr) 92px";
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
        <div style={cellBase}>Materials</div>
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
            const hardSoft= order["Hard Date/Soft Date"] || "";
            const matLabels = materialLabelsFromOrder(order);
            const { thumbUrl: imageUrl, openUrl } = resolveOrderPreview(order);

            const onPreviewClick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              openPreviewLikeOverview(openUrl);
            };

            return (
              <div
                key={orderId}
                style={{
                  display: "grid", gridTemplateColumns: gridTemplate, alignItems: "start",
                  gap: 8, padding: 10, borderRadius: 10,
                  border: "1px solid #ddd", background: "#fff"
                }}
              >
                <div style={{ ...cellBase, fontWeight: 700, alignSelf: "center" }}>{orderId}</div>

                {/* Preview — thumbs via /api/drive/thumbnail (like Overview); click opens like scheduler */}
                <div style={{ display: "grid", placeItems: "center", alignSelf: "center" }}>
                  <div
                    role={openUrl ? "button" : undefined}
                    tabIndex={openUrl ? 0 : undefined}
                    title={openUrl ? "Open full preview" : undefined}
                    onClick={openUrl ? onPreviewClick : undefined}
                    onKeyDown={
                      openUrl
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onPreviewClick(e);
                            }
                          }
                        : undefined
                    }
                    style={{
                      width: 50,
                      height: 34,
                      overflow: "hidden",
                      borderRadius: 6,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "#fff",
                      cursor: openUrl ? "pointer" : "default",
                    }}
                  >
                    {imageUrl ? (
                      <img
                        loading="eager"
                        decoding="async"
                        src={imageUrl}
                        alt=""
                        draggable={false}
                        referrerPolicy="no-referrer"
                        width={50}
                        height={34}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                          color: "#666",
                        }}
                      >
                        No Preview
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ ...cellBase, alignSelf: "center" }}>{company}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{design}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{qty}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{product}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{stage}</div>
                {!compact && <div style={{ ...cellBase, alignSelf: "center" }}>{print}</div>}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    alignSelf: "center",
                    minWidth: 0,
                    padding: "4px 0",
                  }}
                >
                  {matLabels.length === 0 ? (
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>—</span>
                  ) : (
                    matLabels.map((label) => {
                      const raw = materialColors[label.toLowerCase()];
                      const bg = normalizeSheetColor(raw);
                      const fg = contrastTextForBackground(bg);
                      const short = label.length > 24 ? `${label.slice(0, 22)}…` : label;
                      return (
                        <span
                          key={`${orderId}-${label}`}
                          title={label}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            lineHeight: 1.2,
                            padding: "3px 7px",
                            borderRadius: 999,
                            background: bg,
                            color: fg,
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            border: "1px solid rgba(0,0,0,0.06)",
                          }}
                        >
                          {short}
                        </span>
                      );
                    })
                  )}
                </div>
                <div style={{ ...cellBase, fontWeight: 700, alignSelf: "center" }}>{fmtMMDD(due)}</div>
                {!compact && <div style={{ ...cellBase, alignSelf: "center" }}>{hardSoft}</div>}
              </div>
            );
          })}
        </div>
      )}

      <Toast kind={toastKind} message={toastMsg} onClose={() => setToastMsg("")} />
    </div>
  );
}
