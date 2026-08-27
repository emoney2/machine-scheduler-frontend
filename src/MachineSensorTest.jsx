import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

const LS_EVENTS = "jrco.sensorTest.events.v1";
const LS_SETTINGS = "jrco.sensorTest.settings.v1";
const MAX_EVENTS = 200;

const DEFAULTS = {
  threshold: 0.45,
  startHoldMs: 400,
  stopHoldMs: 1500,
  darknessPct: 12,
  darknessSec: 8,
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

function probeApis() {
  const dme = typeof window.DeviceMotionEvent !== "undefined";
  const doe = typeof window.DeviceOrientationEvent !== "undefined";
  return {
    secureContext: !!window.isSecureContext,
    protocol: window.location.protocol,
    host: window.location.host,
    userAgent: navigator.userAgent || "",
    silk: /silk/i.test(navigator.userAgent || ""),
    fireOs: /kf[a-z0-9]+|fire[\s_-]?os|amazon/i.test(navigator.userAgent || ""),
    deviceMotionEvent: dme,
    deviceMotionPermission: !!(dme && window.DeviceMotionEvent.requestPermission),
    deviceOrientationEvent: doe,
    accelerometer: typeof window.Accelerometer === "function",
    linearAccelerationSensor: typeof window.LinearAccelerationSensor === "function",
    gyroscope: typeof window.Gyroscope === "function",
    genericSensor: typeof window.Sensor === "function",
    mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    permissionsApi: !!(navigator.permissions && navigator.permissions.query),
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
  const [running, setRunning] = useState(false);
  const [motionCount, setMotionCount] = useState(0);
  const [lastMotionAt, setLastMotionAt] = useState("");
  const [settings, setSettings] = useState(() => ({
    ...DEFAULTS,
    ...(loadJson(LS_SETTINGS, {}) || {}),
  }));
  const [events, setEvents] = useState(() => loadJson(LS_EVENTS, []) || []);
  const [camStatus, setCamStatus] = useState("off");
  const [camDetail, setCamDetail] = useState("Camera off. First test is vibration only — leave this off.");
  const [brightness, setBrightness] = useState(null);
  const [lightsOn, setLightsOn] = useState(null);
  const [endOfDay, setEndOfDay] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const camTimerRef = useRef(null);
  const darkSinceRef = useRef(null);
  const motionWatchRef = useRef(null);
  const accRef = useRef(null);
  const listeningRef = useRef(false);
  const runningRef = useRef(false);
  const overSinceRef = useRef(null);
  const underSinceRef = useRef(null);
  const smoothRef = useRef(0);
  const hasSmoothRef = useRef(false);
  const settingsRef = useRef(settings);
  const eventsRef = useRef(events);

  useEffect(() => {
    settingsRef.current = settings;
    saveJson(LS_SETTINGS, settings);
  }, [settings]);
  useEffect(() => {
    eventsRef.current = events;
    saveJson(LS_EVENTS, events.slice(0, MAX_EVENTS));
  }, [events]);

  const pushEvent = useCallback((type, extra = {}) => {
    const rec = { type, at: nowIso(), ...extra };
    setEvents((prev) => [rec, ...(Array.isArray(prev) ? prev : [])].slice(0, MAX_EVENTS));
    return rec;
  }, []);

  const applyMotionSample = useCallback(
    (raw, source) => {
      if (raw == null || !Number.isFinite(raw)) return;
      setMotionStatus("available");
      setMotionDetail(`Live from ${source}. These are device values, not estimates.`);
      setRawLevel(raw);
      setLastMotionAt(nowIso());
      setMotionCount((n) => n + 1);
      const next = hasSmoothRef.current ? smoothRef.current * 0.82 + raw * 0.18 : raw;
      hasSmoothRef.current = true;
      smoothRef.current = next;
      setSmoothLevel(next);

      const { threshold, startHoldMs, stopHoldMs } = settingsRef.current;
      const t = Number(threshold) || 0;
      const now = Date.now();
      if (next >= t) {
        underSinceRef.current = null;
        if (!overSinceRef.current) overSinceRef.current = now;
        if (!runningRef.current && now - overSinceRef.current >= (Number(startHoldMs) || 0)) {
          runningRef.current = true;
          setRunning(true);
          pushEvent("vibration-start", { level: Number(next.toFixed(3)), source });
        }
      } else {
        overSinceRef.current = null;
        if (!underSinceRef.current) underSinceRef.current = now;
        if (runningRef.current && now - underSinceRef.current >= (Number(stopHoldMs) || 0)) {
          runningRef.current = false;
          setRunning(false);
          pushEvent("vibration-stop", { level: Number(next.toFixed(3)), source });
        }
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
        acc.addEventListener("error", () => {
          /* DeviceMotion may still work */
        });
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

  const stopCamera = useCallback(() => {
    if (camTimerRef.current) {
      clearInterval(camTimerRef.current);
      camTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) v.srcObject = null;
    darkSinceRef.current = null;
    setCamStatus("off");
    setCamDetail("Camera off. First test is vibration only — leave this off.");
    setBrightness(null);
    setLightsOn(null);
  }, []);

  const sampleFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const w = 64;
    const h = 36;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    const pct = (sum / (data.length / 4) / 255) * 100;
    setBrightness(pct);
    const limit = Number(settingsRef.current.darknessPct) || 0;
    const needMs = (Number(settingsRef.current.darknessSec) || 0) * 1000;
    const dark = pct < limit;
    const now = Date.now();
    if (dark) {
      if (!darkSinceRef.current) darkSinceRef.current = now;
      if (now - darkSinceRef.current >= needMs) {
        setLightsOn((prev) => {
          if (prev === false) return prev;
          const lightsOutAt = nowIso();
          const stop = (eventsRef.current || []).find((e) => e.type === "vibration-stop");
          const eod = stop?.at || "";
          setEndOfDay(eod);
          pushEvent("lights-out", {
            brightness: Number(pct.toFixed(1)),
            endOfDay: eod || null,
          });
          return false;
        });
      }
    } else {
      darkSinceRef.current = null;
      setLightsOn((prev) => {
        if (prev === true) return prev;
        if (prev === false) pushEvent("lights-on", { brightness: Number(pct.toFixed(1)) });
        return true;
      });
    }
  }, [pushEvent]);

  const enableCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamStatus("unsupported");
      setCamDetail("Camera API not available in this browser.");
      return;
    }
    setCamStatus("requesting");
    setCamDetail("Waiting for Silk camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 320 }, height: { ideal: 180 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      setCamStatus("granted");
      setCamDetail("Sampling brightness only. Frames are discarded immediately. Nothing is stored.");
      camTimerRef.current = setInterval(sampleFrame, 400);
    } catch (err) {
      const name = err?.name || "";
      setCamStatus(name === "NotAllowedError" ? "denied" : "error");
      setCamDetail(`Camera blocked: ${err?.message || String(err)}`);
    }
  }, [sampleFrame]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const clearHistory = () => {
    if (!window.confirm("Clear all local test start/stop history on this tablet?")) return;
    setEvents([]);
    setEndOfDay("");
    saveJson(LS_EVENTS, []);
  };

  const motionTone =
    motionStatus === "available" ? "go" : motionStatus === "not-available" ? "stop" : "warn";
  const runTone = running ? "go" : "stop";
  const camTone =
    camStatus === "granted" ? "go" : camStatus === "off" ? "neutral" : camStatus === "denied" ? "stop" : "warn";
  const lightTone =
    lightsOn == null ? "neutral" : lightsOn ? "go" : "stop";

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
      ["getUserMedia (camera)", apis.mediaDevices ? "present" : "missing"],
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
          <div style={{ fontWeight: 900, fontSize: 18 }}>Fire HD 10 sensor test</div>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>TEMP · no Sheets</div>
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
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>First test: vibration only</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 16, fontWeight: 700, lineHeight: 1.45 }}>
            <li>On the Fire HD 10, open Silk and go to this page (already logged in): <code>machineschedule.netlify.app/machine-sensor-test</code></li>
            <li>Leave camera off. Do not tap Enable camera yet.</li>
            <li>Tape or set the tablet on the machine in the spot you want to use (firm contact helps).</li>
            <li>Tap <b>Enable motion</b>. If it says <b>Motion sensor not available</b>, Silk blocked it — stop and tell us. Do not guess values.</li>
            <li>With the machine idle, watch Vibration level. Drag the threshold just above that idle number.</li>
            <li>Start a hoop. The state should go <b>RUNNING</b> and a start should appear in history.</li>
            <li>Stop the machine. It should go <b>STOPPED</b> and log a stop. Repeat a few times.</li>
            <li>Lights / end-of-day come later. This first pass is vibration start/stop only.</li>
          </ol>
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
            sub={rawLevel == null ? "No fake values" : `raw ${rawLevel.toFixed(2)} · ${motionCount} events`}
            tone={smoothLevel == null ? "neutral" : "neutral"}
          />
          <Readout
            label="Machine"
            value={smoothLevel == null ? "—" : running ? "RUNNING" : "STOPPED"}
            sub={lastMotionAt ? `last sample ${formatClock(lastMotionAt)}` : "Waiting for sensor"}
            tone={smoothLevel == null ? "neutral" : runTone}
          />
          <Readout
            label="Camera permission"
            value={camStatus === "granted" ? "Granted" : camStatus === "denied" ? "Denied" : camStatus === "off" ? "Off" : camStatus}
            sub={camDetail}
            tone={camTone}
          />
          <Readout
            label="Brightness"
            value={brightness == null ? "—" : `${Math.round(brightness)}%`}
            sub="Average of one discarded camera frame"
            tone="neutral"
          />
          <Readout
            label="Lights"
            value={lightsOn == null ? "—" : lightsOn ? "ON" : "OFF"}
            sub={
              endOfDay
                ? `End of day = last vibration stop ${formatClock(endOfDay)}`
                : "End of day uses last vibration stop before lights-out"
            }
            tone={lightTone}
          />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <button type="button" onClick={enableMotion} style={btnStyle("#111827", "#fff")}>
            Enable motion
          </button>
          <button type="button" onClick={enableCamera} style={btnStyle("#1d4ed8", "#fff")}>
            Enable camera (later)
          </button>
          <button type="button" onClick={stopCamera} style={btnStyle("#e5e7eb", "#111827")}>
            Stop camera
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
            min={0.05}
            max={6}
            step={0.05}
            value={settings.threshold}
            onChange={(v) => setSettings((s) => ({ ...s, threshold: v }))}
            hint="Idle should sit below this. Running should sit above it."
          />
          <Slider
            label={`Start hold (${settings.startHoldMs} ms)`}
            min={100}
            max={3000}
            step={100}
            value={settings.startHoldMs}
            onChange={(v) => setSettings((s) => ({ ...s, startHoldMs: v }))}
          />
          <Slider
            label={`Stop hold (${settings.stopHoldMs} ms)`}
            min={200}
            max={8000}
            step={100}
            value={settings.stopHoldMs}
            onChange={(v) => setSettings((s) => ({ ...s, stopHoldMs: v }))}
          />
          <Slider
            label={`Darkness threshold (${settings.darknessPct}%)`}
            min={1}
            max={40}
            step={1}
            value={settings.darknessPct}
            onChange={(v) => setSettings((s) => ({ ...s, darknessPct: v }))}
            hint="Skip for first test. Lights-out only if brightness stays below this."
          />
          <Slider
            label={`Darkness duration (${settings.darknessSec}s)`}
            min={2}
            max={30}
            step={1}
            value={settings.darknessSec}
            onChange={(v) => setSettings((s) => ({ ...s, darknessSec: v }))}
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
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: 700, fontSize: 15, padding: "4px 0", borderBottom: "1px solid #e5e7eb" }}>
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
          {endOfDay ? (
            <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 10, color: "#1d4ed8" }}>
              End of day = {formatClock(endOfDay)}
            </div>
          ) : null}
          {events.length === 0 ? (
            <div style={{ fontWeight: 700, color: "#6b7280" }}>No start/stop events yet.</div>
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
                <span>{formatClock(e.at)}</span>
              </div>
            ))
          )}
        </div>

        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
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
