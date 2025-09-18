// src/Scan.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
const IDLE_TIMEOUT_MS = 600;

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

  const idleTimerRef = useRef(null);
  const focusRef = useRef(null);

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
    setPendingOrderId(orderId);          // <-- show which order is loading
    setLoading(true);
    setErrMsg("");

    try {
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
        company: data.company ?? "—",
        title: data.title ?? "",
        product: data.product ?? "",
        stage: data.stage ?? "",
        dueDate: data.dueDate ?? "",
        furColor: data.furColor ?? "",
        quantity: data.quantity ?? "—",
        thumbnailUrl: data.thumbnailUrl || null,
        // Prefer labeled images; fall back to plain images; else to the thumbnail
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
          <Quadrant images={orderData?.images || []} />
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

function Quadrant({ images }) {
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

  const Tile = ({ item }) => (
    <div
      style={{
        background: "#f3f4f6",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
        width: "100%",
        height: "100%",
      }}
    >
      <Img src={item.src} style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} />
      {item.label ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280", textAlign: "center" }}>
          {item.label}
        </div>
      ) : null}
    </div>
  );

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
        <Tile item={items[0]} />
        <Tile item={items[1]} />
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
        <Tile key={i} item={it} />
      ))}
    </div>
  );
}

function Img({ src, style }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  if (!src) return null;
  return ok ? (
    <img src={src} alt="" style={style || { maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} onError={() => setOk(false)} draggable={false} />
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
