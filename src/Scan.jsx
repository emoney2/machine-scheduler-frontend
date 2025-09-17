// src/pages/Scan.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Accept scanner bursts but tolerate slower cadence & messy prefixes/suffixes.
const IDLE_TIMEOUT_MS = 400;             // end-of-scan if no Enter and quick burst stops
const MAX_KEY_INTERVAL_MS = 75;          // tolerate slightly slower keyboard-wedge
const VALID_ORDER_REGEX = /\d{1,10}/;    // allow anything that contains up to 10 digits
const KIOSK_WINDOW_NAME = "JRCO_KioskWindow"; // named window (reused on every scan)

// Helper: extract just the digits from a scan like "JR|FUR|006" -> "6"
function extractOrderId(raw) {
  const digits = (raw || "").replace(/\D+/g, ""); // keep only digits
  // drop leading zeros but preserve "0" if it's literally the only char (unlikely)
  const trimmed = digits.replace(/^0+/, "");
  return trimmed || digits;
}


export default function Scan() {
  const [params] = useSearchParams();
  const dept = (params.get("dept") || "").toLowerCase();

  const [buffer, setBuffer] = useState("");
  const [flash, setFlash] = useState("idle"); // idle | ok | error
  const inputRef = useRef(null);
  const idleTimerRef = useRef(null);
  const lastKeyTimeRef = useRef(0);
  const slowKeyDetectedRef = useRef(false);

  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const deptValid = useMemo(
    () => ["fur", "cut", "print", "embroidery", "sewing"].includes(dept),
    [dept]
  );

  useEffect(() => {
    // Keep the hidden input focused to capture the scanner keystrokes
    inputRef.current?.focus();
    const onVis = () => inputRef.current?.focus();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (buffer) handleSubmit(buffer, /*fromScan*/ true);
    }, IDLE_TIMEOUT_MS);
  }

  function handleSubmit(text, fromScan) {
    const raw = text.trim();
    setBuffer("");
    slowKeyDetectedRef.current = false;

    if (!deptValid) return flashError();

    // Pull out just the digits from whatever the scanner sent
    const orderId = extractOrderId(raw);
    if (!orderId || !/^\d{1,10}$/.test(orderId)) return flashError();

    // Only accept automatic submit from a scan (Enter key or idle timer)
    if (!fromScan) return flashError();

    const url = `/materials/${dept}/${encodeURIComponent(orderId)}`;
    // Reuse a named window so it stays on your side monitor after you place it once.
    window.open(url, KIOSK_WINDOW_NAME, "noopener,noreferrer");
    flashOk();
  }


  function flashOk() { setFlash("ok"); setTimeout(() => setFlash("idle"), 250); }
  function flashError() { setFlash("error"); setTimeout(() => setFlash("idle"), 600); }

  function onKeyDown(e) {
    const now = Date.now();

    if (e.key === "Enter") {
      e.preventDefault();
      const isScan = !slowKeyDetectedRef.current && buffer.length > 0;
      if (isScan) handleSubmit(buffer, true);
      else flashError();
      return;
    }

    // Ignore control keys (Shift, Ctrl, arrows, etc.)
    if (e.key.length > 1) return;

    // Require fast cadence → if any char arrives too slow, mark as "typing"
    const interval = lastKeyTimeRef.current ? now - lastKeyTimeRef.current : 0;
    lastKeyTimeRef.current = now;
    if (interval > MAX_KEY_INTERVAL_MS && buffer.length > 0) {
      slowKeyDetectedRef.current = true;
    }

    // Disallow backspaces (typists do; scanners don’t)
    if (e.key === "Backspace") {
      slowKeyDetectedRef.current = true;
      return;
    }

    setBuffer(prev => prev + e.key);
    resetIdleTimer();
  }

  function manualSubmit() {
    const raw = manualValue.trim();
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


  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white">
      <style>{`
        .flash-idle { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
        .flash-ok { box-shadow: 0 0 0 9999px rgba(0, 255, 127, 0.15) inset; }
        .flash-error { box-shadow: 0 0 0 9999px rgba(255, 0, 64, 0.15) inset; }
      `}</style>

      <div className={`w-full h-full fixed top-0 left-0 ${
        flash === "ok" ? "flash-ok" : flash === "error" ? "flash-error" : "flash-idle"
      }`} />

      <div className="text-center">
        <h1 className="text-3xl font-semibold">Scanner Listener</h1>
        <p className="opacity-70 mt-2">Dept: <b>{deptValid ? dept : "(invalid)"}</b></p>
        <p className="opacity-60 text-sm mt-6">
          Scan a barcode with the order number (manual typing is rejected).
        </p>
        <div className="mt-6">
          <button
            onClick={() => setShowManual(true)}
            className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-sm"
          >
            Supervisor Manual Override
          </button>
        </div>
      </div>

      {/* Hidden focused input to capture wedge scanners */}
      <input
        ref={inputRef}
        onKeyDown={onKeyDown}
        value={buffer}
        onChange={() => {}}
        className="opacity-0 absolute pointer-events-none"
        autoFocus
      />

      {showManual && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-neutral-900 border border-white/10 rounded-2xl p-6 w-80">
            <h2 className="text-lg font-semibold mb-3">Manual Override</h2>
            <input
              value={manualValue}
              onChange={e => setManualValue(e.target.value)}
              className="w-full bg-neutral-800 rounded px-3 py-2 outline-none"
              placeholder="Enter order #"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1 rounded bg-white/10" onClick={() => setShowManual(false)}>Cancel</button>
              <button className="px-3 py-1 rounded bg-white text-black" onClick={manualSubmit}>Open</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
