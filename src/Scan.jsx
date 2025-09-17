// src/pages/Scan.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Scanner-friendly: submit on Enter OR when keys go idle for a short time.
// Tolerate slower cadence and ignore prefixes/suffixes around the digits.
const IDLE_TIMEOUT_MS = 600;             // pause after last keystroke to submit
const MAX_KEY_INTERVAL_MS = 120;         // kept for reference (not used to auto-reject)
const VALID_ORDER_REGEX = /\d{1,10}/;    // allow anything that contains up to 10 digits
const KIOSK_WINDOW_NAME = "JRCO_KioskWindow"; // named window (reused on every scan)

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
  const bufferRef = useRef(""); // keep latest buffer without re-subscribing the keydown handler

  const [flash, setFlash] = useState("idle"); // idle | ok | error
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");

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
    setTimeout(() => setFlash("idle"), 250);
  }
  function flashError() {
    setFlash("error");
    setTimeout(() => setFlash("idle"), 600);
  }

  // Submit handler used by both scanner (fromScan=true) and manual (fromScan=false -> blocked)
  function handleSubmit(text, fromScan) {
    const raw = (text || "").trim();

    // IMPORTANT: we only auto-submit for scans (Enter or idle timer)
    if (!fromScan) return flashError();
    if (!deptValid) return flashError();

    const orderId = extractOrderId(raw);
    if (!orderId || !/^\d{1,10}$/.test(orderId)) return flashError();

    // Clear AFTER capturing raw
    setBuffer("");
    bufferRef.current = "";

    const url = `/materials/${dept}/${encodeURIComponent(orderId)}`;
    window.open(url, KIOSK_WINDOW_NAME, "noopener,noreferrer");
    flashOk();
  }

  // Manual dialog "Open" button
  function manualSubmit() {
    const raw = (manualValue || "").trim();
    const orderId = extractOrderId(raw);

    if (deptValid && orderId && /^\d{1,10}$/.test(orderId)) {
      const url = `/materials/${dept}/${encodeURIComponent(orderId)}`;
      window.open(url, KIOSK_WINDOW_NAME, "noopener,noreferrer");
      setShowManual(false);
      setManualValue("");
      flashOk();
    } else {
      flashError();
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
    // NOTE: only depend on dept so the effect doesn't resubscribe on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white">
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
        .flash-ok { box-shadow: 0 0 0 9999px rgba(0, 255, 127, 0.15) inset; }
        .flash-error { box-shadow: 0 0 0 9999px rgba(255, 0, 64, 0.15) inset; }
      `}</style>

      <div
        className={`w-full h-full fixed top-0 left-0 ${
          flash === "ok" ? "flash-ok" : flash === "error" ? "flash-error" : "flash-idle"
        }`}
      />

      <div className="text-center relative z-10">
        <h1 className="text-3xl font-semibold">Scanner Listener</h1>
        <p className="opacity-70 mt-2">
          Dept: <b>{deptValid ? dept.toUpperCase() : "(invalid)"}</b>
        </p>

        <p className="opacity-60 text-sm mt-6">
          Scan a barcode with the order number (manual typing won’t submit; use the button).
        </p>

        {/* Tiny debug line to see what the scanner just sent */}
        <p className="opacity-50 text-xs mt-2">
          Last keys: <span className="font-mono">{buffer || "—"}</span>
        </p>

        <div className="mt-8">
          <button
            onClick={() => setShowManual(true)}
            className="px-4 py-2 rounded bg-white text-black hover:bg-white/90"
          >
            Enter Order Manually
          </button>
        </div>
      </div>

      {showManual && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-20">
          <div className="bg-neutral-900 w-[480px] max-w-[96vw] rounded-xl p-5 border border-white/10">
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
