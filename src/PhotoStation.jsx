import React, { useEffect, useMemo, useRef, useState } from "react";
import "./PhotoStation.css";
import {
  CAPTURE_STATES,
  createCameraCaptureService,
  downloadBlob,
  downloadSession,
  megapixels,
} from "./photoStation/cameraCaptureService";
import { createSimulatedTurntable } from "./photoStation/turntableService";

function permissionLabel(p) {
  if (p === "granted") return "Camera allowed";
  if (p === "denied") return "Camera blocked";
  if (p === "prompt") return "Permission needed";
  return "Permission unknown";
}

function permissionTone(p) {
  if (p === "granted") return "ok";
  if (p === "denied") return "bad";
  if (p === "prompt") return "warn";
  return "";
}

function stateLabel(state) {
  switch (state) {
    case CAPTURE_STATES.idle:
      return "Ready";
    case CAPTURE_STATES.initializing:
      return "Initializing";
    case CAPTURE_STATES.photo_capture:
      return "Capturing photos";
    case CAPTURE_STATES.video_capture:
      return "Recording video";
    case CAPTURE_STATES.saving:
      return "Saving";
    case CAPTURE_STATES.complete:
      return "Complete";
    case CAPTURE_STATES.error:
      return "Error";
    default:
      return state || "—";
  }
}

function progressPercent(progress) {
  const total = (progress?.photoTotal || 6) + 1; // photos + video
  if (progress?.step === "complete") return 100;
  if (progress?.recording || progress?.step === "video_starting" || progress?.step === "video_recording") {
    const photosDone = progress?.photoTotal || 6;
    const countdown = progress?.videoCountdownSec;
    const videoFrac =
      countdown != null ? 1 - Math.min(1, Math.max(0, countdown / 10)) : 0.5;
    return Math.round(((photosDone + videoFrac) / total) * 100);
  }
  const idx = progress?.photoIndex || 0;
  return Math.round((idx / total) * 100);
}

export default function PhotoStation() {
  const videoRef = useRef(null);
  const serviceRef = useRef(null);
  const logRef = useRef([]);

  const [state, setState] = useState(CAPTURE_STATES.idle);
  const [permission, setPermission] = useState("unknown");
  const [progress, setProgress] = useState({
    message: "Open camera to begin",
    photoIndex: 0,
    photoTotal: 6,
  });
  const [session, setSession] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [initBusy, setInitBusy] = useState(false);
  const [showDiag, setShowDiag] = useState(false);

  const turntable = useMemo(
    () =>
      createSimulatedTurntable({
        stepMs: 2000,
        continuousMsPer360: 10000,
        onLog: (msg, detail) => pushLog(msg, detail),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function pushLog(msg, detail) {
    const line = `${new Date().toISOString().slice(11, 23)} ${msg}${
      detail != null ? " " + safeJson(detail) : ""
    }`;
    logRef.current = [...logRef.current.slice(-80), line];
    setLogs(logRef.current);
    // Diagnostic logging for Safari remote debugging / console
    try {
      // eslint-disable-next-line no-console
      console.log("[PhotoStation]", msg, detail ?? "");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const service = createCameraCaptureService({
      turntable,
      photoCount: 6,
      videoDurationMs: 10000,
      stepWaitMs: 2000,
      onStateChange: (next) => setState(next),
      onPermission: (p) => setPermission(p),
      onLog: (msg, detail) => pushLog(msg, detail),
      onProgress: (p) => {
        setProgress(p);
        if (p.session) setSession({ ...p.session, photos: [...(p.session.photos || [])], video: p.session.video });
        if (p.capabilities) setCapabilities(p.capabilities);
        if (p.error) setError(p.error);
        if (p.step === "reset" || p.step === "starting") setError(null);
      },
    });
    serviceRef.current = service;
    if (videoRef.current) service.setVideoElement(videoRef.current);

    (async () => {
      setInitBusy(true);
      try {
        await service.probePermissions();
        await service.initialize();
        const snap = service.getSnapshot();
        setCapabilities(snap.capabilities);
        setPermission(snap.permission);
        setState(snap.state);
      } catch (e) {
        setError({ code: e?.code || "INIT", message: e?.message || String(e) });
        setState(CAPTURE_STATES.error);
      } finally {
        setInitBusy(false);
      }
    })();

    const onVis = () => {
      if (document.hidden) {
        pushLog("document hidden — camera may pause on iPhone lock/background");
      } else {
        pushLog("document visible again");
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      service.stopCamera();
      try {
        turntable.disconnect();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turntable]);

  useEffect(() => {
    const service = serviceRef.current;
    if (service && videoRef.current) {
      service.setVideoElement(videoRef.current);
    }
  });

  const busy =
    initBusy ||
    state === CAPTURE_STATES.initializing ||
    state === CAPTURE_STATES.photo_capture ||
    state === CAPTURE_STATES.video_capture ||
    state === CAPTURE_STATES.saving;

  const canStart =
    !busy &&
    (state === CAPTURE_STATES.idle ||
      state === CAPTURE_STATES.complete ||
      state === CAPTURE_STATES.error) &&
    permission !== "denied";

  const streamSettings = capabilities?.trackSettings;
  const streamRes =
    streamSettings?.width && streamSettings?.height
      ? `${streamSettings.width}×${streamSettings.height} (${megapixels(
          streamSettings.width,
          streamSettings.height
        )} MP stream)`
      : "Resolution pending";

  async function onStart() {
    setError(null);
    await serviceRef.current?.startCapture();
    const snap = serviceRef.current?.getSnapshot();
    if (snap?.session) setSession({ ...snap.session });
  }

  function onReset() {
    serviceRef.current?.reset();
    setSession(null);
    setError(null);
  }

  async function onRetake() {
    onReset();
    // Allow state to settle, then start again
    await new Promise((r) => setTimeout(r, 50));
    await onStart();
  }

  async function onExportAll() {
    if (!session) return;
    try {
      await downloadSession(session);
      pushLog("export all triggered (browser download)");
    } catch (e) {
      setError({
        code: "EXPORT_FAILED",
        message:
          e?.message ||
          "Export failed. On iPhone Safari, use each Download button, or Add to Photos from the share sheet if offered.",
      });
    }
  }

  const pct = progressPercent(progress);

  return (
    <div className="ps-root">
      <header className="ps-header">
        <div className="ps-brand">JR &amp; Co.</div>
        <h1 className="ps-title">Photo Station</h1>
        <p className="ps-subtitle">
          Place headcover on turntable, press Start once. Six photos + 10s video run automatically.
        </p>
      </header>

      <div className="ps-status-row">
        <span className="ps-chip">
          <span className={`ps-chip-dot ${permissionTone(permission)}`} />
          {permissionLabel(permission)}
        </span>
        <span className="ps-chip">
          <span
            className={`ps-chip-dot ${
              state === CAPTURE_STATES.error
                ? "bad"
                : state === CAPTURE_STATES.complete
                  ? "ok"
                  : busy
                    ? "warn"
                    : "ok"
            }`}
          />
          {stateLabel(state)}
        </span>
        <span className="ps-chip">{streamRes}</span>
        {progress?.recording ? (
          <span className="ps-chip">
            <span className="ps-chip-dot rec" />
            REC {progress.videoCountdownSec ?? "—"}s
          </span>
        ) : null}
      </div>

      <div className="ps-preview-wrap">
        <video
          ref={videoRef}
          className="ps-preview"
          autoPlay
          playsInline
          muted
        />
        {progress?.recording ? (
          <div className="ps-rec-badge">
            <span className="ps-chip-dot rec" />
            RECORDING {progress.videoCountdownSec ?? ""}s
          </div>
        ) : null}
        <div className="ps-preview-overlay">
          <div className="ps-step">{progress?.message || stateLabel(state)}</div>
          <div className="ps-step-sub">
            {busy
              ? `Step: ${progress?.step || state}`
              : state === CAPTURE_STATES.complete
                ? "Files ready below — export or start next product"
                : "Ready for next capture"}
          </div>
          <div className="ps-progress-track">
            <div className="ps-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {error ? (
        <div className="ps-error" role="alert">
          <strong>{error.code || "Error"}:</strong> {error.message}
        </div>
      ) : null}

      <div className="ps-actions">
        <button
          type="button"
          className="ps-btn ps-btn-start"
          disabled={!canStart}
          onClick={onStart}
        >
          {busy ? "Capture in progress…" : "Start Capture"}
        </button>
        <div className="ps-btn-row">
          <button
            type="button"
            className="ps-btn ps-btn-secondary"
            disabled={!session || busy}
            onClick={onRetake}
          >
            Retake
          </button>
          <button
            type="button"
            className="ps-btn ps-btn-secondary"
            disabled={!session || busy}
            onClick={onExportAll}
          >
            Download All
          </button>
          <button
            type="button"
            className="ps-btn ps-btn-danger"
            disabled={busy && state !== CAPTURE_STATES.error}
            onClick={onReset}
          >
            Reset
          </button>
        </div>
      </div>

      {session?.photos?.length ? (
        <section className="ps-section">
          <h2 className="ps-section-title">Photographs</h2>
          <div className="ps-gallery">
            {session.photos.map((p) => (
              <div className="ps-thumb" key={p.filename}>
                <img src={p.url} alt={p.filename} />
                <div className="ps-thumb-meta">
                  <strong>
                    {p.width}×{p.height}
                  </strong>
                  {p.megapixels} MP · {p.method}
                  <br />
                  <button
                    type="button"
                    className="ps-btn ps-btn-secondary"
                    style={{
                      marginTop: 6,
                      width: "100%",
                      fontSize: 11,
                      padding: "6px 4px",
                    }}
                    onClick={() => downloadBlob(p.blob, p.filename)}
                  >
                    Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {session?.video ? (
        <section className="ps-section">
          <h2 className="ps-section-title">360 Video</h2>
          <div className="ps-video-card">
            <video src={session.video.url} controls playsInline />
            <div className="ps-thumb-meta" style={{ padding: "10px 12px" }}>
              <strong>{session.video.filename}</strong>
              {(session.video.width && session.video.height
                ? `${session.video.width}×${session.video.height}`
                : "Resolution unknown") +
                ` · ${(session.video.durationMs / 1000).toFixed(1)}s · ${
                  session.video.mimeType
                } · ${formatBytes(session.video.bytes)}`}
              <button
                type="button"
                className="ps-btn ps-btn-secondary"
                style={{ marginTop: 8, width: "100%", fontSize: 13, padding: "10px" }}
                onClick={() =>
                  downloadBlob(session.video.blob, session.video.filename)
                }
              >
                Download Video
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="ps-section">
        <h2 className="ps-section-title">Capabilities &amp; limits</h2>
        <ul className="ps-notes">
          <li>
            ImageCapture:{" "}
            {capabilities?.imageCaptureSupported ? "available" : "not available (canvas fallback)"}
          </li>
          <li>
            MediaRecorder:{" "}
            {capabilities?.mediaRecorderSupported
              ? capabilities?.preferredRecorderMime || "default MIME"
              : "not available"}
          </li>
          <li>
            Turntable driver: simulated (2s / 60°, 10s continuous spin). No raw TCP from the browser.
          </li>
          {(capabilities?.notes || []).map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            Phase 1 stores files in browser memory only. Safari will not silently write into Apple Photos —
            use Download / the iOS share sheet. Automatic Drive upload comes in a later phase.
          </li>
        </ul>
        <button
          type="button"
          className="ps-btn ps-btn-secondary"
          style={{ marginTop: 8, fontSize: 13, padding: "10px 12px" }}
          onClick={() => setShowDiag((v) => !v)}
        >
          {showDiag ? "Hide diagnostics" : "Show diagnostics"}
        </button>
        {showDiag ? (
          <pre className="ps-diag">{logs.join("\n") || "No log lines yet."}</pre>
        ) : null}
      </section>
    </div>
  );
}

function safeJson(v) {
  try {
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
