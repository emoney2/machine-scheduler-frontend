// src/Scan.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
const IDLE_TIMEOUT_MS = 600;
const VALID_ORDER_REGEX = /\d{1,10}/;

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

  console.log("[Scan] compact bar + centered quadrant v2");

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
    setLoading(true);
    setErrMsg("");
    try {
      // IMPORTANT: your env already includes /api
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
        images:
          Array.isArray(data.images) && data.images.length > 0
            ? data.images
            : data.thumbnailUrl
            ? [data.thumbnailUrl]
            : [],
      };
      setOrderData(normalized);
      flashOk();
    } catch (e) {
      console.error("[Scan] order fetch failed:", e);
      setOrderData(null);
      flashError("Order not found or server error");
    } finally {
      setLoading(false);
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
    <div style={{ minHeight: "100vh", width: "100%", background: "#0a0a0a", color: "#fff" }}>
      {/* focus catcher */}
      <input
        ref={focusRef}
        autoFocus
        onBlur={() => focusRef.current?.focus()}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
      />

      {/* subtle feedback overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          boxShadow:
            flash === "ok"
              ? "inset 0 0 0 9999px rgba(0,255,127,0.1)"
              : flash === "error"
              ? "inset 0 0 0 9999px rgba(255,0,64,0.1)"
              : "none",
        }}
      />

      {/* top bar */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          Department: {deptValid ? dept.toUpperCase() : "(invalid)"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            Last keys: <span style={{ fontFamily: "monospace" }}>{buffer || "—"}</span>
          </span>
          <button
            onClick={() => setShowManual(true)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              background: "#fff",
              color: "#000",
              fontWeight: 600,
            }}
          >
            Enter Order Manually
          </button>
        </div>
      </div>

      {/* error / loading */}
      {(loading || errMsg) && (
        <div style={{ padding: "8px 20px" }}>
          {loading && <div style={{ fontSize: 14, opacity: 0.7 }}>Loading order…</div>}
          {errMsg && <div style={{ fontSize: 14, color: "#f88" }}>{errMsg}</div>}
        </div>
      )}

      {/* ORDER INFO BAR — forced into 1–2 lines */}
      {orderData && (
        <div style={{ padding: "10px 20px" }}>
          <div
            style={{
              background: "#171717",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 12,
              padding: "8px 12px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "6px 14px",
              lineHeight: 1.2,
              fontSize: 13,
            }}
          >
            <BarItem label="Order #" value={orderData.order} />
            <BarItem label="Company" value={orderData.company} maxCh={20} />
            <BarItem label="Design" value={orderData.title} maxCh={20} />
            <BarItem label="Product" value={orderData.product} maxCh={14} />
            <BarItem label="Stage" value={orderData.stage} maxCh={12} />
            <BarItem label="Due" value={orderData.dueDate} />
            <BarItem label="Fur" value={orderData.furColor} maxCh={14} />
            <BarItem label="Qty" value={String(orderData.quantity)} />
          </div>
        </div>
      )}

      {/* CENTERED QUADRANT AREA */}
      <div
        style={{
          padding: "16px 20px 28px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto" }}>
          <Quadrant images={orderData?.images || []} />
        </div>
      </div>

      {/* manual dialog */}
      {showManual && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
          }}
        >
          <div
            style={{
              background: "#171717",
              width: 520,
              maxWidth: "96vw",
              borderRadius: 12,
              padding: 20,
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 600 }}>Open Order in {dept.toUpperCase()}</h2>
            <p style={{ opacity: 0.7, fontSize: 14, marginTop: 6 }}>
              Paste or type anything that contains the digits of the order number.
            </p>
            <input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="e.g., JR|FUR|0063 → opens order 63"
              style={{
                width: "100%",
                background: "#202020",
                color: "#fff",
                borderRadius: 8,
                padding: "10px 12px",
                outline: "none",
                marginTop: 12,
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.08)" }}
                onClick={() => setShowManual(false)}
              >
                Cancel
              </button>
              <button
                style={{ padding: "6px 10px", borderRadius: 8, background: "#fff", color: "#000", fontWeight: 600 }}
                onClick={manualSubmit}
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BarItem({ label, value, maxCh }) {
  const max = maxCh ?? 18;
  const val = clean(value);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.6 }}>
        {label}:
      </span>
      <span
        title={val}
        style={{
          fontWeight: 600,
          display: "inline-block",
          maxWidth: `${max}ch`,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {val}
      </span>
    </div>
  );
}

function clean(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && v.trim() === "") return "—";
  return v;
}

function Quadrant({ images }) {
  const imgs = Array.isArray(images) ? images.filter(Boolean) : [];
  const frameStyle = {
    height: "58vh",
    width: "100%",
    maxWidth: 1100,
    margin: "0 auto",
    background: "#171717",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
  };

  if (imgs.length === 0) {
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderStyle: "dashed",
          borderColor: "rgba(255,255,255,0.15)",
        }}
      >
        <span style={{ fontSize: 13, opacity: 0.5 }}>No images</span>
      </div>
    );
  }

  if (imgs.length === 1) {
    return (
      <div style={{ ...frameStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <Img src={imgs[0]} style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} />
      </div>
    );
  }

  if (imgs.length === 2) {
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
        <Cell><Img src={imgs[0]} /></Cell>
        <Cell><Img src={imgs[1]} /></Cell>
      </div>
    );
  }

  const four = imgs.slice(0, 4);
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
      {four.map((src, i) => (
        <Cell key={i}><Img src={src} /></Cell>
      ))}
    </div>
  );
}

function Cell({ children }) {
  return (
    <div
      style={{
        background: "#202020",
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
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
    <div style={{ fontSize: 12, opacity: 0.5, padding: 8 }}>Image unavailable</div>
  );
}

async function safeJson(r) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}
