// src/pages/Scan.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");

// Scanner-friendly: submit on Enter OR when keys go idle for a short time.
// Tolerate slower cadence and ignore prefixes/suffixes around the digits.
const IDLE_TIMEOUT_MS = 600;             // pause after last keystroke to submit
const VALID_ORDER_REGEX = /\d{1,10}/;    // allow anything that contains up to 10 digits

// Helper: from "JR|FUR|0063" -> "63"
function extractOrderId(raw) {
  const digits = (raw || "").replace(/\D+/g, "");
  const trimmed = digits.replace(/^0+/, "");
  return trimmed || digits; // keep at least "0" if that ever occurs
}

export default function Scan() {
  const [params] = useSearchParams();
  const dept = (params.get("dept") || "").toLowerCase();

  // Departments you plan to support
  const allowedDepts = useMemo(
    () => new Set(["fur", "cut", "print", "embroidery", "sewing"]),
    []
  );
  const deptValid = allowedDepts.has(dept);

  // Raw keystrokes buffer (what the scanner "types")
  const [buffer, setBuffer] = useState("");
  const bufferRef = useRef("");

  // UI state
  const [flash, setFlash] = useState("idle"); // idle | ok | error
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // Loaded order data
  const [orderData, setOrderData] = useState(null);
  // { order, company, title, product, stage, dueDate, furColor, quantity, thumbnailUrl, images?[] }

  const idleTimerRef = useRef(null);
  const focusRef = useRef(null); // hidden autofocus input

  // Keep keyboard focus on the page so scanner keystrokes land here.
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
    if (!deptValid) {
      flashError("Invalid department");
      return;
    }
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

      // Normalize fields and images
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
        images: Array.isArray(data.images) && data.images.length > 0
          ? data.images
          : (data.thumbnailUrl ? [data.thumbnailUrl] : []),
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

  // Submit handler for scans: uses buffered full string; extracts digits; fetches order
  function handleSubmit(text, fromScan) {
    const raw = (text || "").trim();

    // Only auto-submit for scans (Enter or idle timer)
    if (!fromScan) return flashError();

    const orderId = extractOrderId(raw);
    if (!orderId || !/^\d{1,10}$/.test(orderId)) return flashError("Invalid order #");

    // Clear AFTER capturing raw
    setBuffer("");
    bufferRef.current = "";

    fetchOrder(orderId);
  }

  // Manual dialog "Open" button
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

  // Global keydown listener: accumulate characters, submit on Enter or after idle pause
  useEffect(() => {
    function scheduleIdleSubmit() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        const full = bufferRef.current;
        if (full && full.length > 0) {
          handleSubmit(full, /* fromScan */ true);
        }
      }, IDLE_TIMEOUT_MS);
    }

    function onKeyDown(e) {
      // Ignore modifier-only keys and function keys except Enter
      if (e.key.length > 1 && e.key !== "Enter") return;

      // Printable char?
      if (e.key.length === 1) {
        setBuffer(prev => {
          const next = prev + e.key;
          bufferRef.current = next;
          return next;
        });
        scheduleIdleSubmit();
        return;
      }

      // Enter submits immediately
      if (e.key === "Enter") {
        e.preventDefault();
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        const full = bufferRef.current;
        if (full && full.length > 0) {
          handleSubmit(full, /* fromScan */ true);
        }
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
    <div className="min-h-screen w-full bg-neutral-950 text-white">
      {/* Hidden autofocus input keeps focus on this page */}
      <input
        ref={focusRef}
        autoFocus
        onBlur={() => focusRef.current?.focus()}
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "absolute",
          opacity: 0,
          width: 1,
          height: 1,
          pointerEvents: "none",
        }}
      />

      <style>{`
        .flash-idle { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
        .flash-ok { box-shadow: 0 0 0 9999px rgba(0, 255, 127, 0.10) inset; }
        .flash-error { box-shadow: 0 0 0 9999px rgba(255, 0, 64, 0.10) inset; }
      `}</style>

      <div
        className={`w-full h-full fixed top-0 left-0 pointer-events-none ${
          flash === "ok" ? "flash-ok" : flash === "error" ? "flash-error" : "flash-idle"
        }`}
      />

      {/* Top bar */}
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <div className="text-lg font-semibold">
          Department: {deptValid ? dept.toUpperCase() : "(invalid)"}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs opacity-60">
            Last keys: <span className="font-mono">{buffer || "—"}</span>
          </span>
          <button
            onClick={() => setShowManual(true)}
            className="px-3 py-1.5 rounded bg-white text-black hover:bg-white/90"
          >
            Enter Order Manually
          </button>
        </div>
      </div>

      {/* Error / loading ribbon */}
      {(loading || errMsg) && (
        <div className="px-5 py-2">
          {loading && <div className="text-sm opacity-70">Loading order…</div>}
          {errMsg && <div className="text-sm text-red-400">{errMsg}</div>}
        </div>
      )}

      {/* Order info BAR (compact card, 1–2 lines, wraps as needed) */}
      {orderData && (
        <div className="px-5 pt-3">
          <div className="bg-neutral-900 border border-white/10 rounded-xl px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <BarItem label="Order #" value={orderData.order} />
            <BarItem label="Company" value={orderData.company} maxCh={22} />
            <BarItem label="Design" value={orderData.title} maxCh={22} />
            <BarItem label="Product" value={orderData.product} maxCh={16} />
            <BarItem label="Stage" value={orderData.stage} maxCh={14} />
            <BarItem label="Due" value={orderData.dueDate} />
            <BarItem label="Fur" value={orderData.furColor} maxCh={16} />
            <BarItem label="Qty" value={orderData.quantity} />
          </div>
        </div>
      )}

      {/* Centered quadrant */}
      <div className="px-5 pb-6 flex justify-center">
        <div className="w-full max-w-6xl flex justify-center">
          <Quadrant images={(orderData?.images || [])} />
        </div>
      </div>

      {/* Manual dialog */}
      {showManual && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-20">
          <div className="bg-neutral-900 w-[520px] max-w-[96vw] rounded-xl p-5 border border-white/10">
            <h2 className="text-xl font-semibold">Open Order in {dept.toUpperCase()}</h2>
            <p className="opacity-70 text-sm mt-1">
              Paste or type anything that contains the digits of the order number.
            </p>
            <input
              value={manualValue}
              onChange={e => setManualValue(e.target.value)}
              className="w-full bg-neutral-800 rounded px-3 py-2 outline-none mt-4"
              placeholder="e.g., JR|FUR|0063 → opens order 63"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1 rounded bg-white/10"
                onClick={() => setShowManual(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 rounded bg-white text-black"
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
  return (
    <div className="flex items-baseline gap-1 min-w-0 whitespace-nowrap">
      <span className="text-[11px] uppercase tracking-wide opacity-60">{label}:</span>
      <span
        className="font-medium truncate"
        style={{ maxWidth: `${max}ch` }}
        title={value || "—"}
      >
        {clean(value)}
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
  if (imgs.length === 0) {
    return (
      <div className="h-[58vh] w-full max-w-[1100px] mx-auto rounded-xl border border-dashed border-white/15 flex items-center justify-center text-sm opacity-50">
        No images
      </div>
    );
  }

  // 1 → centered; 2 → side-by-side; 3–4 → 2x2 grid
  if (imgs.length === 1) {
    return (
      <div className="h-[58vh] w-full max-w-[1100px] mx-auto rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center p-4">
        <Img src={imgs[0]} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (imgs.length === 2) {
    return (
      <div className="h-[58vh] w-full max-w-[1100px] mx-auto rounded-xl bg-neutral-900 border border-white/10 grid grid-cols-2 gap-3 p-3">
        <div className="flex items-center justify-center bg-neutral-800 rounded-lg">
          <Img src={imgs[0]} className="max-h-full max-w-full object-contain" />
        </div>
        <div className="flex items-center justify-center bg-neutral-800 rounded-lg">
          <Img src={imgs[1]} className="max-h-full max-w-full object-contain" />
        </div>
      </div>
    );
  }

  const four = imgs.slice(0, 4);
  return (
    <div className="h-[58vh] w-full max-w-[1100px] mx-auto rounded-xl bg-neutral-900 border border-white/10 grid grid-cols-2 grid-rows-2 gap-3 p-3">
      {four.map((src, i) => (
        <div key={i} className="flex items-center justify-center bg-neutral-800 rounded-lg">
          <Img src={src} className="max-h-full max-w-full object-contain" />
        </div>
      ))}
    </div>
  );
}

function Img({ src, className }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  if (!src) return null;
  return ok ? (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setOk(false)}
      draggable={false}
    />
  ) : (
    <div className="text-xs opacity-50 p-2">Image unavailable</div>
  );
}

async function safeJson(r) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}
