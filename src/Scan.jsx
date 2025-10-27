// src/Scan.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
const IDLE_TIMEOUT_MS = 600;

// --- FAST ORDER HELPERS ---
async function fetchFastOrder(orderId) {
  const url = `${API_ROOT}/api/order_fast?orderNumber=${encodeURIComponent(orderId)}`;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) {
    let j = null;
    try { j = await r.json(); } catch {}
    throw new Error(j?.error || `HTTP ${r.status}`);
  }
  const j = await r.json();
  return j?.order || null; // raw row dict from server
}
function normalizeFast(o, fallbackOrderId) {
  // Keep this defensive — fast row may not have every field your summary returns
  return {
    order: String(o?.["Order #"] ?? fallbackOrderId ?? "—"),
    company: o?.["Company Name"] ?? o?.company ?? "—",
    title: o?.Design ?? o?.title ?? "",
    product: o?.Product ?? o?.product ?? "",
    stage: o?.Stage ?? o?.stage ?? "",
    dueDate: o?.["Due Date"] ?? o?.dueDate ?? "",
    furColor: o?.["Fur Color"] ?? o?.furColor ?? "",
    quantity: o?.Quantity ?? o?.quantity ?? "—",
    thumbnailUrl: null,
    images: [], // enrich later via /order-summary
  };
}


function extractOrderId(raw) {
  const digits = (raw || "").replace(/\D+/g, "");
  const trimmed = digits.replace(/^0+/, "");
  return trimmed || digits;
}

export default function Scan() {
  const [params] = useSearchParams();
  const dept = (params.get("dept") || "").toLowerCase();

  const allowedDepts = useMemo(
    () => new Set(["fur", "cut", "print", "embroidery", "sewing"]),
    []
  );
  const deptValid = allowedDepts.has(dept);

  const [buffer, setBuffer] = useState("");
  const bufferRef = useRef("");

  const [flash, setFlash] = useState("idle"); // idle | ok | error
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const [loading, setLoading] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState(""); // <-- for overlay
  const [errMsg, setErrMsg] = useState("");

  const [orderData, setOrderData] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState("");

  const idleTimerRef = useRef(null);
  const focusRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setLightboxSrc(""); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const focusInput = () => {
      try {
        if (focusRef.current) focusRef.current.focus();
        window.focus?.();
      } catch {}
    };
    focusInput();
    const onVis = () => {
      if (document.visibilityState === "visible") focusInput();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", focusInput);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", focusInput);
    };
  }, []);

  console.log("[Scan] v3 white theme + chart bar + labeled quadrant + yellow loading overlay");

  function flashOk() {
    setFlash("ok");
    setTimeout(() => setFlash("idle"), 200);
  }
  function flashError(msg) {
    if (msg) setErrMsg(msg);
    setFlash("error");
    setTimeout(() => setFlash("idle"), 600);
  }

  async function fetchOrder(orderId) {
    if (!deptValid) return flashError("Invalid department");
    setPendingOrderId(orderId);
    setLoading(true);
    setErrMsg("");

    try {
      // 1) FAST PATH: /api/order_fast (RAM lookup, should return in ms)
      let fast = null;
      try {
        fast = await fetchFastOrder(orderId);
      } catch (e) {
        // fast path failed; keep going (we'll still try summary below)
        console.warn("[Scan] fast order failed; falling back to summary", e);
      }

      if (fast) {
        const quick = normalizeFast(fast, orderId);
        setOrderData(quick); // quick paint now
      }

      // 2) ENRICH: your existing /order-summary (images, labels, thumbnails)
      const url = `${API_ROOT}/order-summary?dept=${encodeURIComponent(
        dept
      )}&order=${encodeURIComponent(orderId)}`;

      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) {
        const j = await safeJson(r);
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const data = await r.json();

      const normalized = {
        order: data.order ?? orderId,
        company: data.company ?? (fast?.["Company Name"] ?? "—"),
        title: data.title ?? fast?.Design ?? "",
        product: data.product ?? fast?.Product ?? "",
        stage: data.stage ?? fast?.Stage ?? "",
        dueDate: data.dueDate ?? fast?.["Due Date"] ?? "",
        furColor: data.furColor ?? fast?.["Fur Color"] ?? "",
        quantity: data.quantity ?? fast?.Quantity ?? "—",
        thumbnailUrl: data.thumbnailUrl || null,
        images:
          Array.isArray(data.imagesLabeled) && data.imagesLabeled.length > 0
            ? data.imagesLabeled
            : Array.isArray(data.images) && data.images.length > 0
              ? data.images.map(u => (typeof u === "string" ? { src: u, label: "" } : u))
              : (data.thumbnailUrl ? [{ src: data.thumbnailUrl, label: "" }] : []),
      };

      setOrderData(normalized);
      flashOk();
    } catch (e) {
      console.error("[Scan] order fetch failed:", e);
      setOrderData(null);
      flashError("Order not found or server error");
    } finally {
      setLoading(false);
      setPendingOrderId("");
    }
  }


  function handleSubmit(text, fromScan) {
    const raw = (text || "").trim();
    if (!fromScan) return flashError();
    const orderId = extractOrderId(raw);
    if (!orderId || !/^\d{1,10}$/.test(orderId)) return flashError("Invalid order #");
    setBuffer("");
    bufferRef.current = "";
    fetchOrder(orderId);
  }

  function manualSubmit() {
    const raw = (manualValue || "").trim();
    const orderId = extractOrderId(raw);
    if (deptValid && orderId && /^\d{1,10}$/.test(orderId)) {
      setShowManual(false);
      setManualValue("");
      fetchOrder(orderId);
    } else {
      flashError("Invalid order #");
    }
  }

// --- LIGHTBURN OPEN HELPERS ---
function openInLightBurn(bomNameOrPath) {
  // Accept "name", "name.dxf", or a relative path under LaserFiles
  let rel = String(bomNameOrPath || "").trim();
  if (!rel) return false;
  if (!/\.dxf$/i.test(rel)) rel = `${rel}.dxf`;

  const protoUrl = `jrco-lightburn://open?path=${encodeURIComponent(rel)}`;

  // Try protocol; provide a very soft fallback after a tick
  let fallbackTimer = setTimeout(() => {
    // If protocol isn’t registered, user stays on page; fallback to server stream
    window.open(`${API_ROOT}/drive/dxf?name=${encodeURIComponent(bomNameOrPath)}`, "_blank", "noopener");
  }, 800);

  try {
    window.location.href = protoUrl; // triggers local handler if registered
  } catch {
    clearTimeout(fallbackTimer);
    window.open(`${API_ROOT}/drive/dxf?name=${encodeURIComponent(bomNameOrPath)}`, "_blank", "noopener");
  }
  return true;
}

  async function handleImageClick(item) {
    // If it's a BOM tile with a bomName, open in LightBurn if possible (fallback to server)
    if (item && item.kind === "bom" && item.bomName) {
      // Allow Alt-click to force server stream (useful for testing)
      if (window.event && window.event.altKey) {
        window.open(`${API_ROOT}/drive/dxf?name=${encodeURIComponent(item.bomName)}`, "_blank", "noopener");
        return;
      }
      // Try protocol handler (desktop LightBurn). If not installed, fallback happens automatically.
      const ok = openInLightBurn(item.bomName);
      if (!ok) {
        // Protocol function refused (empty name, etc.), fallback to old behavior with precheck
        try {
          const url = `${API_ROOT}/drive/dxf?name=${encodeURIComponent(item.bomName)}&check=1`;
          const r = await fetch(url, { credentials: "include" });
          const j = await safeJson(r);
          if (!r.ok || !j?.ok) {
            const why = (j && (j.error || j.message)) || `No DXF found for '${item.bomName}'`;
            return flashError(why);
          }
          window.open(`${API_ROOT}/drive/dxf?name=${encodeURIComponent(item.bomName)}`, "_blank", "noopener");
        } catch (e) {
          return flashError(`DXF open failed: ${e?.message || e}`);
        }
      }
      return;
    }


    // Otherwise (main image or unknown): open the image itself in-page
    const href = item?.src || "";
    if (!href) return;
    setLightboxSrc(href);
  } 

  useEffect(() => {
    function scheduleIdleSubmit() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        const full = bufferRef.current;
        if (full && full.length > 0) handleSubmit(full, true);
      }, IDLE_TIMEOUT_MS);
    }
    function onKeyDown(e) {
      if (e.key.length > 1 && e.key !== "Enter") return;
      if (e.key.length === 1) {
        setBuffer((prev) => {
          const next = prev + e.key;
          bufferRef.current = next;
          return next;
        });
        scheduleIdleSubmit();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        const full = bufferRef.current;
        if (full && full.length > 0) handleSubmit(full, true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
    /* eslint-disable-next-line */
  }, [dept]);

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: "#ffffff", color: "#111" }}>
      {/* focus catcher */}
      <input
        ref={focusRef}
        autoFocus
        onBlur={() => focusRef.current?.focus()}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
      />

      {/* visual feedback styles (and spinner keyframes) */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* subtle success/error wash (kept) */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          boxShadow:
            flash === "ok"
              ? "inset 0 0 0 9999px rgba(16,185,129,0.08)"
              : flash === "error"
              ? "inset 0 0 0 9999px rgba(239,68,68,0.08)"
              : "none",
        }}
      />

      {/* top bar */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          Department: {deptValid ? dept.toUpperCase() : "(invalid)"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            Last keys: <span style={{ fontFamily: "monospace", color: "#111" }}>{buffer || "—"}</span>
          </span>
          <button
            onClick={() => setShowManual(true)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              background: "#111827",
              color: "#fff",
              fontWeight: 600,
              border: "1px solid #111827",
            }}
          >
            Enter Order Manually
          </button>
        </div>
      </div>

      {/* error / loading hint line (kept for debugging) */}
      {(errMsg) && (
        <div style={{ padding: "8px 20px" }}>
          <div style={{ fontSize: 14, color: "#b91c1c" }}>{errMsg}</div>
        </div>
      )}

      {/* ORDER INFO CHART-STYLE BAR */}
      {orderData && (
        <div style={{ padding: "12px 20px" }}>
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "10px 12px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "10px 16px",
            }}
          >
            <InfoBox label="Order #" value={orderData.order} />
            <InfoBox label="Company Name" value={orderData.company} />
            <InfoBox label="Design" value={orderData.title} />
            <InfoBox label="Product" value={orderData.product} />
            <InfoBox label="Stage" value={orderData.stage} />
            <InfoBox label="Due Date" value={orderData.dueDate} />
            <InfoBox label="Fur Color" value={orderData.furColor} />
            <InfoBox label="Quantity" value={String(orderData.quantity)} />
          </div>
        </div>
      )}

      {/* CENTERED QUADRANT */}
      <div
        style={{
          padding: "12px 20px 28px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto" }}>
          <Quadrant
            images={orderData?.imagesLabeled || orderData?.images || []}
            onClickItem={handleImageClick}
          />
        </div>
      </div>

      {/* Manual dialog */}
      {showManual && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 40,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              color: "#111",
              width: 520,
              maxWidth: "96vw",
              borderRadius: 12,
              padding: 20,
              border: "1px solid #e5e7eb",
              boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Open Order in {dept.toUpperCase()}</h2>
            <p style={{ color: "#6b7280", fontSize: 14, marginTop: 6 }}>
              Paste or type anything that contains the digits of the order number.
            </p>
            <input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder='e.g., JR|FUR|0063 → opens order 63'
              style={{
                width: "100%",
                background: "#f3f4f6",
                color: "#111",
                borderRadius: 8,
                padding: "10px 12px",
                outline: "none",
                marginTop: 12,
                border: "1px solid #e5e7eb",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  color: "#111",
                }}
                onClick={() => setShowManual(false)}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#111827",
                  color: "#fff",
                  fontWeight: 700,
                  border: "1px solid #111827",
                }}
                onClick={manualSubmit}
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}

      {/* YELLOW LOADING OVERLAY */}
      {loading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#fde047", // amber-300
            color: "#111",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
          }}
          role="alert"
          aria-live="assertive"
        >
          <div style={{ textAlign: "center", padding: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                border: "4px solid rgba(0,0,0,0.15)",
                borderTopColor: "#111",
                borderRadius: "9999px",
                margin: "0 auto",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 12 }}>
              Loading {pendingOrderId ? `order ${pendingOrderId}` : "order"}…
            </div>
            <div style={{ marginTop: 4, color: "#374151", fontSize: 14 }}>
              Fetching details and images
            </div>
          </div>
        </div>
      )}

      {/* IMAGE LIGHTBOX (click anywhere or "X" to close) */}
      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc("")}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 70,
            cursor: "zoom-out",
          }}
        >
          {/* Close X */}
          <button
            aria-label="Close"
            onClick={(e) => { e.stopPropagation(); setLightboxSrc(""); }}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.4)",
              background: "transparent",
              color: "#fff",
              fontSize: 20,
              lineHeight: "34px",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            ×
          </button>

          {/* The image */}
          <img
            src={lightboxSrc}
            alt=""
            style={{
              maxWidth: "95vw",
              maxHeight: "90vh",
              objectFit: "contain",
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              borderRadius: 8,
              background: "#111",
            }}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}


function InfoBox({ label, value }) {
  const val = clean(value);
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: "#6b7280",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 14,
          lineHeight: 1.2,
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {val}
      </div>
    </div>
  );
}

function clean(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && v.trim() === "") return "—";
  return v;
}

// --- Labeled Quadrant ---
function toImgMeta(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(Boolean)
    .map(it => (typeof it === "string" ? { src: it, label: "" } : it));
}

function Quadrant({ images, onClickItem }) {
  const items = toImgMeta(images);

  const frameStyle = {
    height: "58vh",
    width: "100%",
    maxWidth: 1100,
    margin: "0 auto",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  };

  const Tile = ({ item }) => {
    const label = (item?.label || "").trim();
    const isBom = item?.kind === "bom";
    const title = isBom
      ? (item?.bomName ? `Open DXF: ${item.bomName}` : "Open DXF")
      : "Open image in new tab";

    return (
      <button
        type="button"
        onClick={() => onClickItem && onClickItem(item)}
        title={title}
        style={{
          position: "relative",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          minHeight: 120,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          cursor: "pointer",
          textAlign: "left",
          padding: 0,
        }}
      >
        <div style={{ padding: "8px 10px", fontSize: 12, color: "#6b7280", display: "flex", alignItems: "center", gap: 8 }}>
          {isBom ? (
            <span style={{
              display: "inline-block",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 10,
              padding: "2px 6px",
              background: "#f9fafb",
              color: "#111",
            }}>
              DXF
            </span>
          ) : (
            <span style={{
              display: "inline-block",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 10,
              padding: "2px 6px",
              background: "#f9fafb",
              color: "#111",
            }}>
              Main
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label || (isBom ? (item?.bomName || "BOM") : "Image")}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
          <Img src={item?.src} />
        </div>
      </button>
    );
  };


  if (items.length === 0) {
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderStyle: "dashed",
          borderColor: "#e5e7eb",
        }}
      >
        <span style={{ fontSize: 13, color: "#9ca3af" }}>No images</span>
      </div>
    );
  }

  if (items.length === 1) {
    return (
      <div style={{ ...frameStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", height: "100%" }}>
          <Tile item={items[0]} />
        </div>
      </div>
    );
  }

  if (items.length === 2) {
    return (
      <div
        style={{
          ...frameStyle,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          padding: 12,
        }}
      >
        <Tile key={items[0]?.src || "a"} item={items[0]} />
        <Tile key={items[1]?.src || "b"} item={items[1]} />
      </div>
    );
  }

  const four = items.slice(0, 4);
  return (
    <div
      style={{
        ...frameStyle,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 12,
        padding: 12,
      }}
    >
      {four.map((it, i) => (
        <Tile key={it?.src || i} item={it} />
      ))}
    </div>
  );
}

function Img({ src, style }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]); // reset state when URL changes
  if (!src) return null;

  return ok ? (
    <img
      src={src}
      alt=""
      style={style || { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}

      onLoad={() => console.debug("[Img] loaded:", src)}
      onError={() => {
        console.debug("[Img] error:", src);
        setOk(false);
      }}
      draggable={false}
    />
  ) : (
    <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>Image unavailable</div>
  );
}


async function safeJson(r) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}
