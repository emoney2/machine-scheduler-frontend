import { useCallback, useEffect, useRef, useState } from "react";

// Idle sits at ~0.01–0.02. Thread trims / slow stitches look the same for a
// couple of seconds, then the machine picks back up. Instant amplitude cannot
// tell those apart — stay "running" until quiet lasts longer than a trim.
const ACTIVITY_THRESHOLD = 0.03;
const SLOW_HOLD_MS = 12000;
const PAUSE_AFTER_MS = 2 * 60 * 60 * 1000;
const LS_PREFIX = "jrco.machineVibration.v1.";

function lsKey(machineId) {
  return `${LS_PREFIX}${String(machineId || "unknown")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function loadClock(machineId) {
  let clock = { lastVibrationAt: "", pausedAt: "", pauses: [] };
  try {
    const raw = localStorage.getItem(lsKey(machineId));
    if (raw) {
      const parsed = JSON.parse(raw);
      clock = {
        lastVibrationAt: String(parsed?.lastVibrationAt || ""),
        pausedAt: String(parsed?.pausedAt || ""),
        pauses: Array.isArray(parsed?.pauses) ? parsed.pauses : [],
      };
    }
  } catch {
    /* ignore */
  }
  if (clock.lastVibrationAt && !clock.pausedAt) {
    const last = new Date(clock.lastVibrationAt).getTime();
    if (Number.isFinite(last) && Date.now() - last > PAUSE_AFTER_MS) {
      clock = {
        ...clock,
        pausedAt: clock.lastVibrationAt,
        pauses: [...clock.pauses, { from: clock.lastVibrationAt, to: null }].slice(-50),
      };
    }
  }
  return clock;
}

function saveClock(machineId, clock) {
  try {
    localStorage.setItem(lsKey(machineId), JSON.stringify(clock));
  } catch {
    /* ignore */
  }
}

function magFromMotion(ev) {
  const a = ev?.acceleration;
  if (a && (a.x != null || a.y != null || a.z != null)) {
    const x = Number(a.x) || 0;
    const y = Number(a.y) || 0;
    const z = Number(a.z) || 0;
    return Math.sqrt(x * x + y * y + z * z);
  }
  const g = ev?.accelerationIncludingGravity;
  if (g && (g.x != null || g.y != null || g.z != null)) {
    const x = Number(g.x) || 0;
    const y = Number(g.y) || 0;
    const z = Number(g.z) || 0;
    return Math.abs(Math.sqrt(x * x + y * y + z * z) - 9.81);
  }
  return null;
}

/**
 * Silent Fire HD vibration pause/unpause for machine floor pages.
 * Burst above idle + 12s hold covers trims. Pause after >2h quiet, backdated.
 */
export function useMachineVibration(machineId) {
  const [clock, setClock] = useState(() => loadClock(machineId));
  const [vibrating, setVibrating] = useState(false);
  const [motionAvailable, setMotionAvailable] = useState(false);
  const [level, setLevel] = useState(null);

  const clockRef = useRef(clock);
  const smoothRef = useRef(0);
  const hasSmoothRef = useRef(false);
  const listeningRef = useRef(false);
  const accRef = useRef(null);
  const startedOkRef = useRef(false);
  const lastUiRef = useRef(0);
  const lastActivityRef = useRef(0);
  const liveRef = useRef({
    level: 0,
    lastActivityAt: 0,
    bursting: false,
    motionAvailable: false,
  });
  const machineRef = useRef(machineId);

  useEffect(() => {
    machineRef.current = machineId;
    const next = loadClock(machineId);
    clockRef.current = next;
    setClock(next);
    hasSmoothRef.current = false;
    smoothRef.current = 0;
    lastActivityRef.current = 0;
    liveRef.current = {
      level: 0,
      lastActivityAt: 0,
      bursting: false,
      motionAvailable: liveRef.current.motionAvailable,
    };
    setVibrating(false);
    setLevel(null);
  }, [machineId]);

  useEffect(() => {
    clockRef.current = clock;
    saveClock(machineId, clock);
  }, [clock, machineId]);

  const applySample = useCallback((raw) => {
    if (raw == null || !Number.isFinite(raw)) return;
    setMotionAvailable(true);
    const next = hasSmoothRef.current ? smoothRef.current * 0.82 + raw * 0.18 : raw;
    hasSmoothRef.current = true;
    smoothRef.current = next;
    const t = Date.now();
    const burst = next >= ACTIVITY_THRESHOLD;
    if (burst) lastActivityRef.current = t;
    liveRef.current = {
      level: next,
      lastActivityAt: lastActivityRef.current,
      bursting: burst,
      motionAvailable: true,
    };
    const running = lastActivityRef.current > 0 && t - lastActivityRef.current < SLOW_HOLD_MS;
    if (t - lastUiRef.current >= 150) {
      lastUiRef.current = t;
      setVibrating(running);
      setLevel(next);
    }
    if (!burst) return;

    const iso = nowIso();
    setClock((prev) => {
      let pauses = prev.pauses || [];
      if (prev.pausedAt) {
        pauses = pauses.map((p, i) =>
          i === pauses.length - 1 && !p.to ? { ...p, to: iso } : p
        );
      }
      const updated = {
        lastVibrationAt: iso,
        pausedAt: "",
        pauses: pauses.slice(-50),
      };
      clockRef.current = updated;
      return updated;
    });
  }, []);

  const onDeviceMotion = useCallback(
    (ev) => {
      const mag = magFromMotion(ev);
      if (mag == null) return;
      applySample(mag);
    },
    [applySample]
  );

  const stop = useCallback(() => {
    listeningRef.current = false;
    startedOkRef.current = false;
    window.removeEventListener("devicemotion", onDeviceMotion, true);
    if (accRef.current) {
      try {
        accRef.current.stop();
      } catch {
        /* ignore */
      }
      accRef.current = null;
    }
  }, [onDeviceMotion]);

  const start = useCallback(async () => {
    if (startedOkRef.current) return;
    if (typeof window.DeviceMotionEvent?.requestPermission === "function") {
      try {
        const res = await window.DeviceMotionEvent.requestPermission();
        if (res !== "granted") return;
      } catch {
        return;
      }
    }
    startedOkRef.current = true;
    listeningRef.current = true;
    if (typeof window.DeviceMotionEvent !== "undefined") {
      window.addEventListener("devicemotion", onDeviceMotion, true);
    }
    if (typeof window.Accelerometer === "function") {
      try {
        const acc = new window.Accelerometer({ frequency: 30 });
        acc.addEventListener("reading", () => {
          const x = Number(acc.x) || 0;
          const y = Number(acc.y) || 0;
          const z = Number(acc.z) || 0;
          applySample(Math.abs(Math.sqrt(x * x + y * y + z * z) - 9.81));
        });
        acc.start();
        accRef.current = acc;
      } catch {
        /* Silk often has no Generic Sensor API */
      }
    }
  }, [applySample, onDeviceMotion]);

  useEffect(() => {
    start();
    const kick = () => start();
    document.addEventListener("pointerdown", kick, true);
    return () => {
      document.removeEventListener("pointerdown", kick, true);
      stop();
    };
  }, [start, stop, machineId]);

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setVibrating(
        lastActivityRef.current > 0 && t - lastActivityRef.current < SLOW_HOLD_MS
      );
    }, 400);
    return () => clearInterval(id);
  }, [machineId]);

  useEffect(() => {
    const id = setInterval(() => {
      const c = clockRef.current;
      if (!c.lastVibrationAt || c.pausedAt) return;
      const last = new Date(c.lastVibrationAt).getTime();
      if (!Number.isFinite(last) || Date.now() - last <= PAUSE_AFTER_MS) return;
      const pausedAt = c.lastVibrationAt;
      setClock((prev) => {
        if (prev.pausedAt) return prev;
        const updated = {
          ...prev,
          pausedAt,
          pauses: [...(prev.pauses || []), { from: pausedAt, to: null }].slice(-50),
        };
        clockRef.current = updated;
        return updated;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [machineId]);

  const paused = !!clock.pausedAt;
  return {
    paused,
    pausedAt: clock.pausedAt || "",
    lastVibrationAt: clock.lastVibrationAt || "",
    vibrating,
    level,
    motionAvailable,
    hoopEndedAt: clock.lastVibrationAt || "",
    liveRef,
  };
}

export function VibrationDot({ vibrating, level, pendingChimes = [], audioOn }) {
  const on = !!vibrating;
  const n = Number(level);
  const label = Number.isFinite(n) ? n.toFixed(2) : "—";
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 6,
        bottom: 6,
        zIndex: 6,
        display: "flex",
        alignItems: "center",
        gap: 4,
        pointerEvents: "none",
      }}
    >
      <style>{`
        @keyframes ms-melody-flash {
          0%, 100% { opacity: 1; transform: scale(1); }
          20% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.15); }
          60% { opacity: 0.2; transform: scale(0.8); }
          80% { opacity: 1; transform: scale(1.1); }
        }
        .ms-melody-dot { animation: ms-melody-flash 0.9s ease-out 1; }
      `}</style>
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: on ? "#16a34a" : "#dc2626",
          color: "#fff",
          fontSize: 9,
          fontWeight: 900,
          lineHeight: "16px",
          textAlign: "center",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
        }}
      >
        V
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: on ? "#16a34a" : "#dc2626",
          lineHeight: 1,
          textShadow: "0 0 3px #fff, 0 0 3px #fff",
        }}
      >
        {label}
      </span>
      <div
        title={audioOn ? "Listening for chime" : "Mic off"}
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: audioOn ? "#16a34a" : "#6b7280",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M6.2 3.4c2.4-1.2 5.6.2 5.6 3.4 0 2.2-1.3 3.4-2.4 4.4-.5.5-.8 1.1-.8 1.8v.6"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M6.2 3.4C4.8 4.2 4 5.6 4 7.2c0 1.4.6 2.5 1.4 3.2"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="6.4" cy="13.2" r="1.1" fill="#fff" />
        </svg>
      </div>
      {pendingChimes.map((heardAt, index) => (
        <div
          key={`${heardAt}-${index}`}
          className="ms-melody-dot"
          title="Finished run waiting for +N"
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#6d28d9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
            transformOrigin: "center",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 8.2 6.4 11.5 13 4.8"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}


