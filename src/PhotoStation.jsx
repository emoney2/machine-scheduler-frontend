import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./PhotoStation.css";
import {
  CAPTURE_STATES,
  captureBaseName,
  createCameraCaptureService,
  downloadBlob,
  downloadSession,
  megapixels,
} from "./photoStation/cameraCaptureService";
import { createSimulatedTurntable } from "./photoStation/turntableService";
import { createComximTurntable } from "./photoStation/comximTurntable";
import { subscribeUploadQueue } from "./photoStation/driveUpload";
import { API_ROOT } from "./apiRoot";
import { socket } from "./socketClient";

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

function extractOrderId(raw) {
  const digits = String(raw || "").replace(/\D+/g, "");
  const trimmed = digits.replace(/^0+/, "");
  return trimmed || digits;
}

function progressPercent(progress) {
  const total = (progress?.photoTotal || 10) + 1; // photos + video
  if (progress?.step === "complete") return 100;
  if (progress?.recording || progress?.step === "video_starting" || progress?.step === "video_recording") {
    const photosDone = progress?.photoTotal || 10;
    const countdown = progress?.videoCountdownSec;
    const duration = progress?.videoDurationSec || 13;
    const videoFrac =
      countdown != null ? 1 - Math.min(1, Math.max(0, countdown / duration)) : 0.5;
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
  const [uploadJobs, setUploadJobs] = useState([]);
  const [bridgeStatus, setBridgeStatus] = useState({
    online: false,
    bleConnected: false,
    deviceName: null,
  });
  const [useSimTurntable, setUseSimTurntable] = useState(false);
  const [turntableAngle, setTurntableAngle] = useState(0);
  const [turntableMoving, setTurntableMoving] = useState(false);
  const [jogBusy, setJogBusy] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const scanFocusRef = useRef(null);
  const scanBufferRef = useRef("");
  const scanTimerRef = useRef(null);
  const scanLockRef = useRef(false);
  const scanHandlerRef = useRef(async () => {});

  function pushLog(msg, detail) {
    const line = `${new Date().toISOString().slice(11, 23)} ${msg}${
      detail != null ? " " + safeJson(detail) : ""
    }`;
    logRef.current = [...logRef.current.slice(-80), line];
    setLogs(logRef.current);
    try {
      console.log("[PhotoStation]", msg, detail ?? "");
    } catch {
      /* ignore */
    }
  }

  const turntableLog = useCallback((msg, detail) => {
    const line = `${new Date().toISOString().slice(11, 23)} ${msg}${
      detail != null ? " " + safeJson(detail) : ""
    }`;
    logRef.current = [...logRef.current.slice(-80), line];
    setLogs(logRef.current);
    try {
      console.log("[PhotoStation]", msg, detail ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  const turntable = useMemo(() => {
    if (useSimTurntable) {
      return createSimulatedTurntable({
        stepMs: 2000,
        continuousMsPer360: 10000,
        onLog: turntableLog,
      });
    }
    return createComximTurntable({
      continuousMsPer360: 10000,
      speedGrade: 6,
      onLog: turntableLog,
    });
  }, [useSimTurntable, turntableLog]);

  useEffect(() => {
    let cancelled = false;
    function read() {
      try {
        const st = turntable.getStatus();
        if (cancelled || !st) return;
        setTurntableAngle(Number(st.positionDeg) || 0);
        setTurntableMoving(st.state === "moving");
      } catch {
        /* ignore */
      }
    }
    read();
    const t = setInterval(read, 400);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [turntable]);

  useEffect(() => {
    return subscribeUploadQueue((jobs) => setUploadJobs(jobs));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(
      "(max-width: 520px), (max-height: 500px) and (pointer: coarse)"
    );
    const meta = document.querySelector('meta[name="viewport"]');
    const previous = meta?.getAttribute("content") || "";
    const locked =
      "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

    const preventGesture = (event) => {
      event.preventDefault();
    };
    const preventPinch = (event) => {
      if ((event.touches && event.touches.length > 1) || event.scale > 1) {
        event.preventDefault();
      }
    };

    function apply() {
      const on = mq.matches;
      document.documentElement.classList.toggle("ps-kiosk", on);
      if (meta) meta.setAttribute("content", on ? locked : previous);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("touchmove", preventPinch);
      if (on) {
        document.addEventListener("gesturestart", preventGesture, { passive: false });
        document.addEventListener("gesturechange", preventGesture, { passive: false });
        document.addEventListener("gestureend", preventGesture, { passive: false });
        document.addEventListener("touchmove", preventPinch, { passive: false });
      }
    }

    apply();
    mq.addEventListener?.("change", apply);
    return () => {
      mq.removeEventListener?.("change", apply);
      document.documentElement.classList.remove("ps-kiosk");
      if (meta) meta.setAttribute("content", previous);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("touchmove", preventPinch);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshBridge() {
      try {
        const res = await fetch(`${API_ROOT}/photo-station/turntable-status`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!cancelled && data) {
          setBridgeStatus({
            online: !!data.online,
            bleConnected: !!data.bleConnected,
            deviceName: data.deviceName || null,
          });
        }
      } catch {
        /* ignore */
      }
    }
    refreshBridge();
    const t = setInterval(refreshBridge, 8000);
    const onStatus = (p) => {
      setBridgeStatus({
        online: !!p?.online,
        bleConnected: !!p?.bleConnected,
        deviceName: p?.deviceName || null,
      });
    };
    socket?.on?.("comxim:bridgeStatus", onStatus);
    return () => {
      cancelled = true;
      clearInterval(t);
      socket?.off?.("comxim:bridgeStatus", onStatus);
    };
  }, []);

  useEffect(() => {
    const service = createCameraCaptureService({
      turntable,
      photoAngles: [0, 35, 90, 140, 150, 180, 210, 220, 270, 330],
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

  const turntableReady =
    useSimTurntable || (bridgeStatus.online && bridgeStatus.bleConnected);

  const canStart =
    !busy &&
    !scanBusy &&
    !jogBusy &&
    !turntableMoving &&
    turntableReady &&
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

  async function onJog(delta) {
    if (busy || jogBusy || turntableMoving || !turntableReady) return;
    setJogBusy(true);
    setError(null);
    try {
      const st = turntable.getStatus();
      if (st?.state === "disconnected") {
        await turntable.connect();
      }
      let step = delta;
      if (delta === 0) {
        const pos = ((Number(turntable.getStatus()?.positionDeg) || 0) % 360 + 360) % 360;
        if (pos < 0.05) return;
        step = pos > 180 ? 360 - pos : -pos;
      }
      await turntable.rotateDegrees(step);
    } catch (e) {
      setError({
        code: "TURNTABLE",
        message: e?.message || String(e),
      });
    } finally {
      setJogBusy(false);
    }
  }

  function onReset() {
    serviceRef.current?.reset();
    setSession(null);
    setError(null);
    setScanNote("");
  }

  async function startLabeledCapture(label) {
    if (label) setScanNote(captureBaseName(label));
    await serviceRef.current?.startCapture({ label });
    const snap = serviceRef.current?.getSnapshot();
    if (snap?.session) setSession({ ...snap.session });
  }

  async function onRetake() {
    const label = session?.orderNumber
      ? {
          orderNumber: session.orderNumber,
          jobName: session.jobName,
          product: session.product,
          company: session.company,
        }
      : null;
    if (!label) {
      setError({ code: "SCAN", message: "Scan the barcode on the job." });
      return;
    }
    onReset();
    await new Promise((r) => setTimeout(r, 50));
    setError(null);
    await startLabeledCapture(label);
  }

  async function handleBarcodeScan(raw) {
    if (scanLockRef.current) return;
    const orderId = extractOrderId(raw);
    if (!orderId || !/^\d{1,10}$/.test(orderId)) {
      setError({ code: "SCAN", message: "That scan is not an order number." });
      return;
    }
    if (!canStart) {
      setError({
        code: "SCAN",
        message: busy
          ? "Finish this capture before scanning the next job."
          : "Wait until the turntable is ready.",
      });
      return;
    }
    scanLockRef.current = true;
    setScanBusy(true);
    setError(null);
    setScanNote(`Looking up ${orderId}…`);
    try {
      const res = await fetch(
        `${API_ROOT}/photo-station/job?orderNumber=${encodeURIComponent(orderId)}`,
        { credentials: "include" }
      );
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !data?.order) {
        setScanNote("");
        setError({
          code: "SCAN",
          message: data?.error || `Order ${orderId} was not found.`,
        });
        return;
      }
      const label = {
        orderNumber: String(data.order || orderId).trim(),
        jobName: String(data.jobName || "").trim(),
        product: String(data.product || "").trim(),
        company: String(data.company || "").trim(),
      };
      await startLabeledCapture(label);
    } catch (e) {
      setScanNote("");
      setError({
        code: "SCAN",
        message: e?.message || "Could not look up that order.",
      });
    } finally {
      scanLockRef.current = false;
      setScanBusy(false);
    }
  }

  scanHandlerRef.current = handleBarcodeScan;

  useEffect(() => {
    function focusCatcher() {
      const el = scanFocusRef.current;
      if (!el) return;
      // Stay read-only so iPhone does not open the on-screen keyboard.
      // A Bluetooth scanner still sends keydown events through this field.
      el.setAttribute("readonly", "readonly");
      try {
        el.focus({ preventScroll: true });
      } catch {
        try {
          el.focus();
        } catch {
          /* ignore */
        }
      }
    }
    function onPointerUp(event) {
      const target = event.target;
      if (target && target.closest && target.closest("input, textarea")) return;
      setTimeout(focusCatcher, 0);
    }
    function onVis() {
      if (document.visibilityState === "visible") focusCatcher();
    }
    function takeBuffer() {
      const full = scanBufferRef.current;
      scanBufferRef.current = "";
      if (full.trim()) scanHandlerRef.current(full);
    }
    function schedule() {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = setTimeout(takeBuffer, 600);
    }
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (
        target &&
        target !== scanFocusRef.current &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(scanTimerRef.current);
        takeBuffer();
        return;
      }
      if (e.key.length !== 1) return;
      scanBufferRef.current += e.key;
      schedule();
    }
    focusCatcher();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("focus", focusCatcher);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focus", focusCatcher);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("pointerup", onPointerUp);
      clearTimeout(scanTimerRef.current);
    };
  }, []);

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
      <input
        ref={scanFocusRef}
        className="ps-scan-catcher"
        aria-label="Barcode scanner input"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        readOnly
        inputMode="none"
        defaultValue=""
      />
      <header className="ps-header">
        <div className="ps-brand">JR &amp; Co.</div>
        <h1 className="ps-title">Photo Station</h1>
        <p className="ps-subtitle">
          Scan the barcode on the job. Photos, rotates, and the 360 video run automatically.
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
        <span className="ps-chip">
          <span
            className={`ps-chip-dot ${
              useSimTurntable
                ? "warn"
                : bridgeStatus.online && bridgeStatus.bleConnected
                  ? "ok"
                  : bridgeStatus.online
                    ? "warn"
                    : "bad"
            }`}
          />
          {useSimTurntable
            ? "Turntable: simulated"
            : bridgeStatus.online && bridgeStatus.bleConnected
              ? `Turntable: ${bridgeStatus.deviceName || "ComXim"}`
              : bridgeStatus.online
                ? "Turntable: Fire online, BLE off"
                : "Turntable: Fire bridge offline"}
        </span>
        <span className="ps-chip">{streamRes}</span>
        {uploadJobs.length ? (
          <span className="ps-chip">{uploadSummary(uploadJobs)}</span>
        ) : null}
        {progress?.recording ? (
          <span className="ps-chip">
            <span className="ps-chip-dot rec" />
            REC {progress.videoCountdownSec ?? "—"}s
          </span>
        ) : null}
      </div>

      {!useSimTurntable && !(bridgeStatus.online && bridgeStatus.bleConnected) ? (
        <div className="ps-error" role="status">
          Fire HD bridge is required. On the Fire tablet open{" "}
          <strong>/turntable-bridge</strong>, connect Bluetooth to the ComXim, then scan a job barcode here.
        </div>
      ) : null}

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
        <div className="ps-angle" aria-live="polite">
          <span className="ps-angle-value">{formatAngle(turntableAngle)}</span>
          <span className="ps-angle-caption">{turntableMoving ? "Moving" : "Turntable"}</span>
        </div>
        <div className="ps-preview-overlay">
          <div className="ps-step">{progress?.message || stateLabel(state)}</div>
          <div className="ps-step-sub">
            {busy
              ? `Step: ${progress?.step || state}`
              : state === CAPTURE_STATES.complete
                ? "Capture finished — start the next product"
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
        <div className="ps-jog">
          <button
            type="button"
            className="ps-btn ps-btn-secondary"
            disabled={busy || scanBusy || jogBusy || turntableMoving || !turntableReady}
            onClick={() => onJog(0)}
          >
            0°
          </button>
          <button
            type="button"
            className="ps-btn ps-btn-secondary"
            disabled={busy || scanBusy || jogBusy || turntableMoving || !turntableReady}
            onClick={() => onJog(10)}
          >
            +10°
          </button>
          <button
            type="button"
            className="ps-btn ps-btn-secondary"
            disabled={busy || scanBusy || jogBusy || turntableMoving || !turntableReady}
            onClick={() => onJog(20)}
          >
            +20°
          </button>
        </div>
        <div className="ps-scan-prompt" role="status">
          {busy ? "Taking photos…" : scanNote || "Scan the barcode on the job."}
        </div>
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

      {uploadJobs.length ? (
        <section className="ps-section">
          <h2 className="ps-section-title">Google Drive uploads</h2>
          <p className="ps-subtitle" style={{ marginBottom: 8 }}>
            Uploads run in the background — you can Start the next product anytime.
          </p>
          <ul className="ps-notes">
            {uploadJobs.map((job) => (
              <li key={job.id}>
                <strong style={{ color: "var(--ps-text)" }}>{job.sessionId}</strong>
                {" · "}
                {jobStatusLabel(job)}
                {job.folderUrl ? (
                  <>
                    {" · "}
                    <a
                      href={job.folderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#86efac" }}
                    >
                      Open folder
                    </a>
                  </>
                ) : null}
                <div style={{ marginTop: 2 }}>{job.message}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
            Turntable: ComXim MT200RUBL via Fire HD bridge (
            <a href="/turntable-bridge" style={{ color: "#86efac" }}>
              /turntable-bridge
            </a>
            ).{" "}
            <button
              type="button"
              className="ps-btn ps-btn-secondary"
              style={{ fontSize: 11, padding: "4px 8px", marginLeft: 6 }}
              onClick={() => setUseSimTurntable((v) => !v)}
            >
              {useSimTurntable ? "Use real ComXim" : "Use simulated turntable"}
            </button>
          </li>
          {(capabilities?.notes || []).map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            After capture, files queue for Google Drive (
            <strong style={{ color: "var(--ps-text)" }}>JR Photo Station</strong>) in the
            background so the next product can start immediately. Keep this page open until uploads
            finish.
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

function formatAngle(deg) {
  const n = Math.round((Number(deg) || 0) * 10) / 10;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${text}°`;
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

function uploadSummary(jobs) {
  const active = jobs.find((j) => j.status === "uploading");
  if (active) return `Uploading ${active.done || 0}/${active.total || "?"}`;
  if (jobs.some((j) => j.status === "queued")) return "Upload queued";
  if (jobs.some((j) => j.status === "error")) return "Upload failed";
  return "Saved to Drive";
}

function jobStatusLabel(job) {
  if (job.status === "queued") return "Queued";
  if (job.status === "uploading") {
    return `Uploading ${job.done || 0}/${job.total || "?"}`;
  }
  if (job.status === "done") return "Saved";
  if (job.status === "error") return "Failed";
  return job.status || "—";
}
