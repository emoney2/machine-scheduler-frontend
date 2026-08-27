import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

const LS_EVENTS = "jrco.sensorTest.events.v2";
const LS_SETTINGS = "jrco.sensorTest.settings.v2";
const LS_CLOCK = "jrco.sensorTest.clock.v2";
const MAX_EVENTS = 200;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const DEFAULTS = {
  threshold: 0.05,
  pauseQuietMs: TWO_HOURS_MS,
};

const EMPTY_CLOCK = {
  lastVibrationAt: "",
  workStartedAt: "",
  pausedAt: "",
  pauses: [],
};

function nowIso() {
  return new Date().toISOString();
}

function formatClock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
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

function workElapsedMs(clock, nowMs) {
  if (!clock?.workStartedAt) return 0;
  const start = new Date(clock.workStartedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  let paused = 0;
  for (const p of clock.pauses || []) {
    const from = new Date(p.from).getTime();
    const to = p.to ? new Date(p.to).getTime() : nowMs;
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) paused += to - from;
  }
  return Math.max(0, nowMs - start - paused);
}

function probeApis() {
  const dme = typeof window.DeviceMotionEvent !== "undefined";
  return {
    secureContext: !!window.isSecureContext,
    userAgent: navigator.userAgent || "",
    silk: /silk/i.test(navigator.userAgent || ""),
    deviceMotionEvent: dme,
    deviceMotionPermission: !!(dme && window.DeviceMotionEvent.requestPermission),
    deviceOrientationEvent: typeof window.DeviceOrientationEvent !== "undefined",
    accelerometer: typeof window.Accelerometer === "function",
    linearAccelerationSensor: typeof window.LinearAccelerationSensor === "function",
    gyroscope: typeof window.Gyroscope === "function",
    localStorage: (() => {
      try {
        const k = "__jrco_sensor_probe__";
        localStorage.setItem(k, "1");
        localStorage.removeItem(k);
        return true;
      } catch {
        return false;
      }
    })(),
  };
}

function Readout({ label, value, sub, tone = "neutral" }) {
  const bg =
    tone === "go" ? "#dcfce7" : tone === "stop" ? "#fee2e2" : tone === "warn" ? "#fef9c3" : "#f3f4f6";
  const fg =
    tone === "go" ? "#14532d" : tone === "stop" ? "#7f1d1d" : tone === "warn" ? "#713f12" : "#111827";
  return (
    <div
      style={{
        background: bg,
        color: fg,
        border: "3px solid #111827",
        borderRadius: 16,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: "clamp(28px, 5.2vw, 52px)",
          fontWeight: 900,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, opacity: 0.85 }}>{sub}</div>
      ) : null}
    </div>
  );
}

export default function MachineSensorTest() {
  const [apis, setApis] = useState(() => probeApis());
  const [motionStatus, setMotionStatus] = useState("idle");
  const [motionDetail, setMotionDetail] = useState("Tap Enable motion to start. No values until the Fire sends real events.");
  const [rawLevel, setRawLevel] = useState(null);
  const [smoothLevel, setSmoothLevel] = useState(null);
  const [vibrating, setVibrating] = useState(false);
  const [motionCount, setMotionCount] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [settings, setSettings] = useState(() => ({
    ...DEFAULTS,
    ...(loadJson(LS_SETTINGS, {}) || {}),
  }));
  const [events, setEvents] = useState(() => loadJson(LS_EVENTS, []) || []);
  const [clock, setClock] = useState(() => ({
    ...EMPTY_CLOCK,
    ...(loadJson(LS_CLOCK, {}) || {}),
  }));

  const motionWatchRef = useRef(null);
  const accRef = useRef(null);
  const listeningRef = useRef(false);
  const smoothRef = useRef(0);
  const hasSmoothRef = useRef(false);
  const settingsRef = useRef(settings);
  const clockRef = useRef(clock);

  useEffect(() => {
    settingsRef.current = settings;
    saveJson(LS_SETTINGS, settings);
  }, [settings]);
  useEffect(() => {
    clockRef.current = clock;
    saveJson(LS_CLOCK, clock);
  }, [clock]);
  useEffect(() => {
    saveJson(LS_EVENTS, (events || []).slice(0, MAX_EVENTS));
  }, [events]);

  const pushEvent = useCallback((type, extra = {}) => {
    const rec = { type, at: extra.at || nowIso(), ...extra };
    setEvents((prev) => [rec, ...(Array.isArray(prev) ? prev : [])].slice(0, MAX_EVENTS));
    return rec;
  }, []);

  const maybePause = useCallback(() => {
    const c = clockRef.current;
    if (!c.lastVibrationAt || c.pausedAt) return;
    const quietMs = Number(settingsRef.current.pauseQuietMs) || TWO_HOURS_MS;
    const last = new Date(c.lastVibrationAt).getTime();
    const now = Date.now();
    if (!Number.isFinite(last) || now - last <= quietMs) return;
    const pausedAt = c.lastVibrationAt;
    setClock((prev) => {
      if (prev.pausedAt) return prev;
      const next = {
        ...prev,
        pausedAt,
        pauses: [...(prev.pauses || []), { from: pausedAt, to: null }],
      };
      clockRef.current = next;
      return next;
    });
    pushEvent("pause", {
      at: pausedAt,
      detectedAt: nowIso(),
      lastVibrationAt: pausedAt,
    });
  }, [pushEvent]);

  const applyMotionSample = useCallback(
    (raw, source) => {
      if (raw == null || !Number.isFinite(raw)) return;
      setMotionStatus("available");
      setMotionDetail(`Live from ${source}. These are device values, not estimates.`);
      setRawLevel(raw);
      setMotionCount((n) => n + 1);
      const next = hasSmoothRef.current ? smoothRef.current * 0.82 + raw * 0.18 : raw;
      hasSmoothRef.current = true;
      smoothRef.current = next;
      setSmoothLevel(next);

      const t = Number(settingsRef.current.threshold);
      const threshold = Number.isFinite(t) ? t : 0.05;
      const above = next >= threshold;
      setVibrating(above);
      if (!above) return;

      const iso = nowIso();
      const wasPaused = !!clockRef.current.pausedAt;
      setClock((prev) => {
        let pauses = prev.pauses || [];
        if (prev.pausedAt) {
          pauses = pauses.map((p, i) =>
            i === pauses.length - 1 && !p.to ? { ...p, to: iso } : p
          );
        }
        const next = {
          lastVibrationAt: iso,
          workStartedAt: prev.workStartedAt || iso,
          pausedAt: "",
          pauses,
        };
        clockRef.current = next;
        return next;
      });
      if (wasPaused) {
        pushEvent("unpause", { at: iso, level: Number(next.toFixed(3)), source });
      }
    },
    [pushEvent]
  );

  const onDeviceMotion = useCallback(
    (ev) => {
      const mag = magFromMotion(ev);
      if (mag == null) {
        if (!hasSmoothRef.current) {
          setMotionStatus("not-available");
          setMotionDetail("Silk fired DeviceMotion but acceleration fields were empty.");
        }
        return;
      }
      applyMotionSample(mag, "DeviceMotionEvent");
    },
    [applyMotionSample]
  );

  const stopMotion = useCallback(() => {
    listeningRef.current = false;
    window.removeEventListener("devicemotion", onDeviceMotion);
    if (accRef.current) {
      try {
        accRef.current.stop();
      } catch {
        /* ignore */
      }
      accRef.current = null;
    }
    if (motionWatchRef.current) {
      clearTimeout(motionWatchRef.current);
      motionWatchRef.current = null;
    }
  }, [onDeviceMotion]);

  const enableMotion = useCallback(async () => {
    setApis(probeApis());
    stopMotion();
    hasSmoothRef.current = false;
    smoothRef.current = 0;
    setRawLevel(null);
    setSmoothLevel(null);
    setMotionCount(0);
    setVibrating(false);
    setMotionStatus("listening");
    setMotionDetail("Waiting for a real accelerometer event from Silk…");

    listeningRef.current = true;
    let permitted = true;
    if (typeof window.DeviceMotionEvent?.requestPermission === "function") {
      try {
        const res = await window.DeviceMotionEvent.requestPermission();
        permitted = res === "granted";
        if (!permitted) {
          setMotionStatus("not-available");
          setMotionDetail(`DeviceMotion permission was ${res}. Silk blocked the sensor.`);
          return;
        }
      } catch (err) {
        setMotionStatus("not-available");
        setMotionDetail(`Motion permission failed: ${err?.message || String(err)}`);
        return;
      }
    }

    if (permitted && typeof window.DeviceMotionEvent !== "undefined") {
      window.addEventListener("devicemotion", onDeviceMotion, true);
    }

    if (typeof window.Accelerometer === "function") {
      try {
        const acc = new window.Accelerometer({ frequency: 30 });
        acc.addEventListener("reading", () => {
          const x = Number(acc.x) || 0;
          const y = Number(acc.y) || 0;
          const z = Number(acc.z) || 0;
          applyMotionSample(Math.abs(Math.sqrt(x * x + y * y + z * z) - 9.81), "Accelerometer");
        });
        acc.addEventListener("error", () => {});
        acc.start();
        accRef.current = acc;
      } catch {
        /* constructor often throws on Silk */
      }
    }

    motionWatchRef.current = setTimeout(() => {
      if (!listeningRef.current) return;
      if (!hasSmoothRef.current) {
        setMotionStatus("not-available");
        setMotionDetail("Motion sensor not available. Silk did not send accelerometer data.");
        setRawLevel(null);
        setSmoothLevel(null);
      }
    }, 2500);
  }, [applyMotionSample, onDeviceMotion, stopMotion]);

  useEffect(() => () => stopMotion(), [stopMotion]);

  useEffect(() => {
    const id = setInterval(() => {
      maybePause();
      setTick(Date.now());
    }, 1000);
    maybePause();
    return () => clearInterval(id);
  }, [maybePause]);

  const clearHistory = () => {
    if (!window.confirm("Clear local vibration / pause history on this tablet?")) return;
    setEvents([]);
    setClock({ ...EMPTY_CLOCK });
    saveJson(LS_EVENTS, []);
    saveJson(LS_CLOCK, EMPTY_CLOCK);
  };

  const paused = !!clock.pausedAt;
  const elapsed = workElapsedMs(clock, tick);
  const quietMs = clock.lastVibrationAt ? Math.max(0, tick - new Date(clock.lastVibrationAt).getTime()) : 0;
  const pauseAfterMs = Number(settings.pauseQuietMs) || TWO_HOURS_MS;

  const motionTone =
    motionStatus === "available" ? "go" : motionStatus === "not-available" ? "stop" : "warn";
  const clockTone = !clock.workStartedAt ? "neutral" : paused ? "stop" : "go";

  const apiRows = useMemo(
    () => [
      ["HTTPS / secure context", apis.secureContext ? "yes" : "NO — sensors will fail"],
      ["Amazon Silk", apis.silk ? "yes" : "no (user agent does not say Silk)"],
      ["DeviceMotionEvent", apis.deviceMotionEvent ? "present" : "missing"],
      ["DeviceMotion.requestPermission", apis.deviceMotionPermission ? "present" : "not used on this browser"],
      ["DeviceOrientationEvent", apis.deviceOrientationEvent ? "present" : "missing"],
      ["Accelerometer (Generic Sensor)", apis.accelerometer ? "present" : "missing"],
      ["LinearAccelerationSensor", apis.linearAccelerationSensor ? "present" : "missing"],
      ["Gyroscope", apis.gyroscope ? "present" : "missing"],
      ["localStorage", apis.localStorage ? "present" : "missing"],
    ],
    [apis]
  );

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#111827",
        color: "#111827",
        padding: 12,
        boxSizing: "border-box",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            color: "#f9fafb",
          }}
        >
          <Link to="/" style={{ color: "#93c5fd", fontWeight: 800, fontSize: 16 }}>
            ← Scheduler
          </Link>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Fire HD 10 vibration clock</div>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>TEMP · no Sheets · no camera</div>
        </div>

        <div
          style={{
            background: "#fffbeb",
            border: "3px solid #f59e0b",
            borderRadius: 16,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Pause rule (vibration only)</div>
          <ul style={{ margin: 0, paddingLeft: 22, fontSize: 16, fontWeight: 700, lineHeight: 1.45 }}>
            <li>Vibration below <b>0.05</b> for <b>more than 2 hours</b> → machine is paused.</li>
            <li>Pause time is <b>the last vibration</b>, not the 2-hour mark. The clock jumps back to that time.</li>
            <li>When vibration starts again, the clock <b>unpauses</b> at that moment.</li>
            <li>A short stop under 2 hours is not a pause. Camera is off for now.</li>
          </ul>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <Readout
            label="Motion sensor"
            value={
              motionStatus === "available"
                ? "Available"
                : motionStatus === "not-available"
                  ? "Not available"
                  : motionStatus === "listening"
                    ? "Listening…"
                    : "Not started"
            }
            sub={motionDetail}
            tone={motionTone}
          />
          <Readout
            label="Vibration level"
            value={smoothLevel == null ? "—" : smoothLevel.toFixed(2)}
            sub={
              rawLevel == null
                ? "No fake values"
                : `${vibrating ? "vibrating" : "quiet"} · threshold ${Number(settings.threshold).toFixed(2)} · raw ${rawLevel.toFixed(2)}`
            }
            tone={smoothLevel == null ? "neutral" : vibrating ? "go" : "warn"}
          />
          <Readout
            label="Clock"
            value={!clock.workStartedAt ? "—" : paused ? "PAUSED" : "RUNNING"}
            sub={
              paused
                ? `Paused at last vibration ${formatClock(clock.pausedAt)}`
                : clock.lastVibrationAt
                  ? `Last vibration ${formatClock(clock.lastVibrationAt)}`
                  : "Waiting for vibration"
            }
            tone={clockTone}
          />
          <Readout
            label="Work clock"
            value={formatElapsed(elapsed)}
            sub={
              paused
                ? "Frozen as of last vibration (2h quiet backdated)"
                : quietMs > 0 && !vibrating
                  ? `Quiet ${formatElapsed(quietMs)} — pause after 2h`
                  : "Counts only while not paused"
            }
            tone={clockTone}
          />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <button type="button" onClick={enableMotion} style={btnStyle("#111827", "#fff")}>
            Enable motion
          </button>
          <button type="button" onClick={clearHistory} style={btnStyle("#991b1b", "#fff")}>
            Clear test history
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <Slider
            label={`Vibration threshold (${Number(settings.threshold).toFixed(2)})`}
            min={0.02}
            max={1}
            step={0.01}
            value={settings.threshold}
            onChange={(v) => setSettings((s) => ({ ...s, threshold: v }))}
            hint="At or above this counts as vibration. Default 0.05."
          />
          <Slider
            label={`Pause after quiet (${(pauseAfterMs / 3600000).toFixed(2)} h)`}
            min={0.05}
            max={8}
            step={0.05}
            value={pauseAfterMs / 3600000}
            onChange={(v) => setSettings((s) => ({ ...s, pauseQuietMs: v * 3600000 }))}
            hint="Must stay quiet longer than this, then pause is stamped at last vibration. Default 2 hours."
          />
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 14,
            marginBottom: 12,
            border: "3px solid #d1d5db",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Silk API probe</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#4b5563", marginBottom: 8, wordBreak: "break-all" }}>
            {apis.userAgent}
          </div>
          {apiRows.map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontWeight: 700,
                fontSize: 15,
                padding: "4px 0",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 14,
            border: "3px solid #d1d5db",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>
            Local history ({events.length}) — not sent to Sheets
          </div>
          {events.length === 0 ? (
            <div style={{ fontWeight: 700, color: "#6b7280" }}>No pause / unpause events yet.</div>
          ) : (
            events.slice(0, 40).map((e, i) => (
              <div
                key={`${e.at}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  fontWeight: 800,
                  fontSize: 16,
                  padding: "6px 0",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <span>{e.type}</span>
                <span>
                  {formatClock(e.at)}
                  {e.detectedAt ? ` · seen ${formatClock(e.detectedAt)}` : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, hint }) {
  return (
    <label
      style={{
        display: "block",
        background: "#fff",
        border: "3px solid #d1d5db",
        borderRadius: 16,
        padding: 12,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      {hint ? <div style={{ fontSize: 13, fontWeight: 700, color: "#4b5563" }}>{hint}</div> : null}
    </label>
  );
}

function btnStyle(bg, color) {
  return {
    background: bg,
    color,
    border: "3px solid #111827",
    borderRadius: 14,
    padding: "14px 18px",
    fontSize: 18,
    fontWeight: 900,
    cursor: "pointer",
  };
}
