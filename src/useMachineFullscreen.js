import { useEffect, useRef, useState } from "react";

function fsElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function canFullscreen() {
  const el = document.documentElement;
  return !!(
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.msRequestFullscreen
  );
}

export async function enterFullscreen() {
  const el = document.documentElement;
  const fn =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.msRequestFullscreen;
  if (!fn || fsElement()) return true;
  try {
    const ret = fn.call(el, { navigationUI: "hide" });
    if (ret && typeof ret.then === "function") await ret;
    return true;
  } catch (_) {
    return false;
  }
}

export async function exitFullscreen() {
  const fn =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.msExitFullscreen;
  if (!fn || !fsElement()) return;
  try {
    const ret = fn.call(document);
    if (ret && typeof ret.then === "function") await ret;
  } catch (_) {}
}

export function useMachineFullscreen(active) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wantFs = useRef(true);

  useEffect(() => {
    const sync = () => setIsFullscreen(!!fsElement());
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      wantFs.current = true;
      exitFullscreen();
      return undefined;
    }
    enterFullscreen();
    const onDown = () => {
      if (wantFs.current && !fsElement()) enterFullscreen();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [active]);

  const toggle = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (fsElement()) {
      wantFs.current = false;
      exitFullscreen();
    } else {
      wantFs.current = true;
      enterFullscreen();
    }
  };

  return { isFullscreen, toggle, supported: canFullscreen() };
}

export function FullscreenToggle({ isFullscreen, onToggle, style }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      onPointerDown={(e) => e.stopPropagation()}
      title={isFullscreen ? "Exit full screen" : "Full screen"}
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        zIndex: 40,
        minWidth: 48,
        minHeight: 48,
        padding: "6px 10px",
        border: "none",
        borderRadius: 10,
        background: "rgba(17,24,39,0.82)",
        color: "#fff",
        fontSize: 13,
        fontWeight: 800,
        cursor: "pointer",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        ...style,
      }}
    >
      {isFullscreen ? "Exit full" : "Full screen"}
    </button>
  );
}
