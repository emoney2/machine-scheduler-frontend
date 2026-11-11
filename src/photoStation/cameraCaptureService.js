/**
 * Photo Station camera capture service — Safari-first state machine.
 *
 * States: idle → initializing → photo_capture → video_capture → saving → complete
 * Plus: error (recoverable via reset)
 *
 * Keeps one MediaStream alive across stills + video when possible.
 * Prefer ImageCapture.takePhoto(); fall back to canvas (no upscale / no fake 24MP claims).
 */

export const CAPTURE_STATES = Object.freeze({
  idle: "idle",
  initializing: "initializing",
  photo_capture: "photo_capture",
  video_capture: "video_capture",
  saving: "saving",
  complete: "complete",
  error: "error",
});

const PHOTO_COUNT = 6;
const VIDEO_MS = 10000;
const JPEG_QUALITY = 0.92;

const VIDEO_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pad3(n) {
  return String(n).padStart(3, "0");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nextSessionNumber() {
  const key = `jr.photoStation.session.${todayStamp()}`;
  let n = 1;
  try {
    n = Number(sessionStorage.getItem(key) || "0") + 1;
    sessionStorage.setItem(key, String(n));
  } catch {
    n = Date.now() % 1000;
  }
  return n;
}

export function buildPhotoFilename(dateStr, sessionNum, photoIndex) {
  return `JR_${dateStr}_${pad3(sessionNum)}_Photo_${pad2(photoIndex)}.jpg`;
}

export function buildVideoFilename(dateStr, sessionNum, mimeType) {
  const ext = mimeType?.includes("mp4")
    ? "mp4"
    : mimeType?.includes("webm")
      ? "webm"
      : mimeType?.includes("quicktime")
        ? "mov"
        : "webm";
  return `JR_${dateStr}_${pad3(sessionNum)}_360_Video.${ext}`;
}

export function megapixels(w, h) {
  if (!w || !h) return 0;
  return Math.round((w * h) / 1e6 * 100) / 100;
}

export function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of VIDEO_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Cancelled"), { code: "ABORTED" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error("Cancelled"), { code: "ABORTED" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Create the capture controller. Bind a <video> element via setVideoElement().
 */
export function createCameraCaptureService({
  onStateChange = () => {},
  onProgress = () => {},
  onLog = () => {},
  onPermission = () => {},
  turntable = null,
  photoCount = PHOTO_COUNT,
  videoDurationMs = VIDEO_MS,
  stepWaitMs = 2000,
} = {}) {
  let state = CAPTURE_STATES.idle;
  let stream = null;
  let videoEl = null;
  let runAbort = null;
  let runLock = false;
  let permission = "unknown"; // unknown | granted | denied | prompt
  let lastError = null;
  let capabilities = {
    imageCaptureSupported: typeof ImageCapture !== "undefined",
    mediaRecorderSupported: typeof MediaRecorder !== "undefined",
    preferredRecorderMime: pickRecorderMimeType(),
    trackSettings: null,
    trackCapabilities: null,
    maxPhotoResolution: null,
    notes: [],
  };
  let session = null;

  function setState(next, detail) {
    state = next;
    onStateChange(next, detail);
    onLog(`state → ${next}`, detail);
  }

  function log(msg, detail) {
    onLog(msg, detail);
  }

  function setPermission(p) {
    permission = p;
    onPermission(p);
  }

  function emitProgress(partial) {
    onProgress({
      state,
      permission,
      lastError,
      capabilities,
      session,
      ...partial,
    });
  }

  function setVideoElement(el) {
    videoEl = el;
    if (videoEl && stream) {
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.play?.().catch(() => {});
    }
  }

  async function probePermissions() {
    try {
      if (navigator.permissions?.query) {
        const st = await navigator.permissions.query({ name: "camera" });
        setPermission(st.state);
        st.onchange = () => setPermission(st.state);
        return st.state;
      }
    } catch {
      /* Safari often rejects permissions.query for camera */
    }
    return permission;
  }

  async function getRearStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(
        new Error("getUserMedia is not available in this browser."),
        { code: "NO_GETUSERMEDIA" }
      );
    }

    const attempts = [
      {
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 4032 },
          height: { ideal: 3024 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      {
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      },
      { video: true, audio: false },
    ];

    let lastErr = null;
    for (const constraints of attempts) {
      try {
        log("getUserMedia attempt", constraints);
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        setPermission("granted");
        return s;
      } catch (e) {
        lastErr = e;
        log("getUserMedia failed", { name: e?.name, message: e?.message });
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          setPermission("denied");
          throw Object.assign(
            new Error("Camera permission denied. Enable camera access for this site in Safari Settings."),
            { code: "PERMISSION_DENIED", cause: e }
          );
        }
      }
    }
    throw Object.assign(
      new Error(lastErr?.message || "Could not open the camera."),
      { code: "CAMERA_INIT_FAILED", cause: lastErr }
    );
  }

  function readTrackInfo(mediaStream) {
    const track = mediaStream.getVideoTracks()[0];
    if (!track) return;
    let settings = null;
    let caps = null;
    try {
      settings = track.getSettings?.() || null;
    } catch {
      settings = null;
    }
    try {
      caps = track.getCapabilities?.() || null;
    } catch {
      caps = null;
    }
    capabilities = {
      ...capabilities,
      trackSettings: settings,
      trackCapabilities: caps,
      preferredRecorderMime: pickRecorderMimeType(),
      imageCaptureSupported: typeof ImageCapture !== "undefined",
      mediaRecorderSupported: typeof MediaRecorder !== "undefined",
      notes: [],
    };

    const notes = [];
    const w = settings?.width;
    const h = settings?.height;
    if (w && h) {
      const mp = megapixels(w, h);
      notes.push(
        `Live stream: ${w}×${h} (${mp} MP). Still capture may differ if ImageCapture is available.`
      );
      if (mp < 20) {
        notes.push(
          `Safari typically exposes a preview/stream resolution, not a full 24 MP still. Reported dimensions below are measured from each file — not upscaled.`
        );
      }
    }
    if (!capabilities.imageCaptureSupported) {
      notes.push(
        "ImageCapture API is not available — using canvas fallback (captures the current video frame size)."
      );
    }
    const mime = capabilities.preferredRecorderMime;
    if (mime === null) {
      notes.push("MediaRecorder is not available in this browser.");
    } else if (!mime) {
      notes.push("No preferred MIME listed; MediaRecorder will use the browser default.");
    } else if (!mime.includes("mp4")) {
      notes.push(
        `Preferred recorder MIME is ${mime}. Safari may not offer MP4/4K — recording will use what the browser supports.`
      );
    }
    capabilities.notes = notes;
  }

  async function attachStream(mediaStream) {
    stream = mediaStream;
    readTrackInfo(mediaStream);
    if (videoEl) {
      videoEl.srcObject = mediaStream;
      videoEl.muted = true;
      videoEl.setAttribute("playsinline", "true");
      videoEl.playsInline = true;
      try {
        await videoEl.play();
      } catch (e) {
        log("video.play warning", e?.message || e);
      }
    }
  }

  async function initialize() {
    if (stream) {
      readTrackInfo(stream);
      emitProgress({ step: "preview_ready" });
      return;
    }
    setState(CAPTURE_STATES.initializing);
    emitProgress({ step: "initializing", message: "Opening rear camera…" });
    await probePermissions();
    const s = await getRearStream();
    await attachStream(s);
    setState(CAPTURE_STATES.idle);
    emitProgress({ step: "preview_ready", message: "Camera ready" });
  }

  async function captureStill(photoIndex, dateStr, sessionNum) {
    const track = stream?.getVideoTracks()?.[0];
    if (!track || track.readyState !== "live") {
      throw Object.assign(new Error("Camera stream is not live."), {
        code: "STREAM_DEAD",
      });
    }

    let blob = null;
    let method = "canvas";
    let width = 0;
    let height = 0;

    if (typeof ImageCapture !== "undefined") {
      try {
        const ic = new ImageCapture(track);
        if (typeof ic.takePhoto === "function") {
          blob = await ic.takePhoto();
          method = "ImageCapture.takePhoto";
          // Measure actual dimensions
          const bmp = await createImageBitmap(blob);
          width = bmp.width;
          height = bmp.height;
          bmp.close?.();
        } else if (typeof ic.grabFrame === "function") {
          const bmp = await ic.grabFrame();
          width = bmp.width;
          height = bmp.height;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(bmp, 0, 0);
          bmp.close?.();
          blob = await new Promise((res) =>
            canvas.toBlob(res, "image/jpeg", JPEG_QUALITY)
          );
          method = "ImageCapture.grabFrame+canvas";
        }
      } catch (e) {
        log("ImageCapture failed; falling back to canvas", e?.message || e);
        blob = null;
      }
    }

    if (!blob) {
      const video = videoEl;
      if (!video || !video.videoWidth) {
        throw Object.assign(
          new Error("Video preview is not ready for canvas capture."),
          { code: "PREVIEW_NOT_READY" }
        );
      }
      width = video.videoWidth;
      height = video.videoHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, width, height);
      blob = await new Promise((res, rej) => {
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("canvas.toBlob returned null"))),
          "image/jpeg",
          JPEG_QUALITY
        );
      });
      method = "canvas";
    }

    // Ensure JPEG type when possible
    if (blob && blob.type && !blob.type.includes("jpeg") && !blob.type.includes("jpg")) {
      // Keep original if browser gave us something else from takePhoto (e.g. image/png)
      log("still mime", blob.type);
    }

    const filename = buildPhotoFilename(dateStr, sessionNum, photoIndex);
    const url = URL.createObjectURL(blob);
    const mp = megapixels(width, height);
    const photo = {
      index: photoIndex,
      filename,
      blob,
      url,
      width,
      height,
      megapixels: mp,
      method,
      mimeType: blob.type || "image/jpeg",
      bytes: blob.size,
      capturedAt: new Date().toISOString(),
    };
    log(`photo ${photoIndex} captured`, {
      width,
      height,
      mp,
      method,
      bytes: blob.size,
    });
    return photo;
  }

  async function recordVideo(dateStr, sessionNum, signal) {
    if (typeof MediaRecorder === "undefined") {
      throw Object.assign(
        new Error("MediaRecorder is not supported in this browser."),
        { code: "NO_MEDIARECORDER" }
      );
    }
    if (!stream) {
      throw Object.assign(new Error("No camera stream for recording."), {
        code: "NO_STREAM",
      });
    }

    const mimeType = pickRecorderMimeType();
    const options = {};
    if (mimeType) options.mimeType = mimeType;
    // Prefer high bitrate when browser accepts it
    options.videoBitsPerSecond = 16_000_000;

    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (e) {
      log("MediaRecorder with options failed; retrying default", e?.message);
      try {
        recorder = new MediaRecorder(stream);
      } catch (e2) {
        throw Object.assign(
          new Error("Could not start MediaRecorder: " + (e2?.message || e2)),
          { code: "RECORDER_INIT_FAILED", cause: e2 }
        );
      }
    }

    const chunks = [];
    let stopReason = "timer";
    const actualMime = recorder.mimeType || mimeType || "video/webm";

    const done = new Promise((resolve, reject) => {
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = (ev) => {
        stopReason = "error";
        reject(
          Object.assign(new Error(ev?.error?.message || "Recording error"), {
            code: "RECORDER_ERROR",
            cause: ev?.error,
          })
        );
      };
      recorder.onstop = () => resolve();
    });

    const onAbort = () => {
      stopReason = "aborted";
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // Visibility / interruption handling
    const onVis = () => {
      if (document.hidden && recorder.state === "recording") {
        log("page hidden during recording — Safari may interrupt camera");
      }
    };
    document.addEventListener("visibilitychange", onVis);

    emitProgress({
      step: "video_recording",
      message: "Recording video…",
      videoCountdownSec: Math.ceil(videoDurationMs / 1000),
      recording: true,
    });

    try {
      recorder.start(250);
    } catch (e) {
      document.removeEventListener("visibilitychange", onVis);
      throw Object.assign(
        new Error("MediaRecorder.start failed: " + (e?.message || e)),
        { code: "RECORDER_START_FAILED", cause: e }
      );
    }

    const startedAt = Date.now();
    let countdownTimer = null;
    try {
      countdownTimer = setInterval(() => {
        const left = Math.max(
          0,
          Math.ceil((videoDurationMs - (Date.now() - startedAt)) / 1000)
        );
        emitProgress({
          step: "video_recording",
          recording: true,
          videoCountdownSec: left,
          message: `Recording… ${left}s`,
        });
      }, 200);

      // Drive continuous rotation in parallel; always record for the full duration.
      const spinPromise = turntable
        ? turntable.rotateContinuous(1).catch((e) => {
            log("turntable continuous rotate warning", e?.message || e);
          })
        : Promise.resolve();

      try {
        await sleep(videoDurationMs, signal);
      } catch (e) {
        if (e?.code !== "ABORTED") throw e;
      }

      if (recorder.state === "recording") {
        recorder.stop();
      }
      await done;
      await spinPromise.catch(() => {});
    } finally {
      clearInterval(countdownTimer);
      document.removeEventListener("visibilitychange", onVis);
      signal?.removeEventListener("abort", onAbort);
    }

    const durationMs = Date.now() - startedAt;
    if (!chunks.length) {
      throw Object.assign(
        new Error(
          stopReason === "aborted"
            ? "Recording cancelled."
            : "Recording ended with no data. Safari may have interrupted the camera (lock screen / background)."
        ),
        { code: "EMPTY_RECORDING" }
      );
    }

    const blob = new Blob(chunks, { type: actualMime });
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    const width = settings.width || videoEl?.videoWidth || 0;
    const height = settings.height || videoEl?.videoHeight || 0;
    const filename = buildVideoFilename(dateStr, sessionNum, actualMime);
    const url = URL.createObjectURL(blob);

    const video = {
      filename,
      blob,
      url,
      mimeType: actualMime,
      bytes: blob.size,
      width,
      height,
      durationMs,
      stopReason,
      capturedAt: new Date().toISOString(),
    };
    log("video recorded", {
      mimeType: actualMime,
      bytes: blob.size,
      width,
      height,
      durationMs,
    });
    return video;
  }

  function revokeSessionUrls(s) {
    if (!s) return;
    s.photos?.forEach((p) => {
      try {
        URL.revokeObjectURL(p.url);
      } catch {
        /* ignore */
      }
    });
    if (s.video?.url) {
      try {
        URL.revokeObjectURL(s.video.url);
      } catch {
        /* ignore */
      }
    }
  }

  async function startCapture() {
    if (runLock) {
      log("startCapture ignored — already running");
      return;
    }
    if (
      state !== CAPTURE_STATES.idle &&
      state !== CAPTURE_STATES.complete &&
      state !== CAPTURE_STATES.error
    ) {
      log("startCapture ignored — invalid state", state);
      return;
    }

    runLock = true;
    lastError = null;
    runAbort?.abort();
    runAbort = new AbortController();
    const { signal } = runAbort;

    revokeSessionUrls(session);
    const dateStr = todayStamp();
    const sessionNum = nextSessionNumber();
    session = {
      id: `${dateStr}_${pad3(sessionNum)}`,
      dateStr,
      sessionNum,
      photos: [],
      video: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    emitProgress({
      step: "starting",
      message: "Starting capture…",
      photoIndex: 0,
      photoTotal: photoCount,
    });

    try {
      setState(CAPTURE_STATES.initializing);
      await initialize();
      if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "ABORTED" });

      if (permission === "denied") {
        throw Object.assign(new Error("Camera permission denied."), {
          code: "PERMISSION_DENIED",
        });
      }

      if (turntable) {
        const st = turntable.getStatus();
        if (st.state === "disconnected") {
          await turntable.connect();
        }
      }

      setState(CAPTURE_STATES.photo_capture);
      for (let i = 1; i <= photoCount; i += 1) {
        if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "ABORTED" });
        emitProgress({
          step: "photo_capture",
          message: `Capturing photo ${i} of ${photoCount}…`,
          photoIndex: i,
          photoTotal: photoCount,
          recording: false,
        });
        const photo = await captureStill(i, dateStr, sessionNum);
        session.photos.push(photo);
        emitProgress({
          step: "photo_captured",
          message: `Photo ${i}/${photoCount}: ${photo.width}×${photo.height} (${photo.megapixels} MP)`,
          photoIndex: i,
          photoTotal: photoCount,
          lastPhoto: photo,
        });

        if (i < photoCount) {
          emitProgress({
            step: "turntable_wait",
            message: turntable
              ? `Rotating turntable 60°…`
              : `Waiting ${Math.round(stepWaitMs / 1000)}s (simulated turntable)…`,
            photoIndex: i,
            photoTotal: photoCount,
          });
          if (turntable) {
            await turntable.rotateDegrees(60);
          } else {
            await sleep(stepWaitMs, signal);
          }
        }
      }

      setState(CAPTURE_STATES.video_capture);
      emitProgress({
        step: "video_starting",
        message: "Starting continuous video…",
        recording: true,
        videoCountdownSec: Math.ceil(videoDurationMs / 1000),
      });
      const video = await recordVideo(dateStr, sessionNum, signal);
      session.video = video;

      setState(CAPTURE_STATES.saving);
      emitProgress({
        step: "saving",
        message: "Saving results in browser memory…",
        recording: false,
      });
      // Phase 1: in-memory only; URLs already created
      session.completedAt = new Date().toISOString();

      if (turntable) {
        try {
          await turntable.home();
        } catch (e) {
          log("turntable home warning", e?.message || e);
        }
      }

      setState(CAPTURE_STATES.complete);
      emitProgress({
        step: "complete",
        message: "Capture complete — export when ready.",
        recording: false,
      });
    } catch (e) {
      lastError = {
        code: e?.code || "UNKNOWN",
        message: e?.message || String(e),
      };
      setState(CAPTURE_STATES.error, lastError);
      emitProgress({
        step: "error",
        message: lastError.message,
        error: lastError,
        recording: false,
      });
      log("capture error", lastError);
    } finally {
      runLock = false;
    }
  }

  function cancel() {
    runAbort?.abort();
    try {
      turntable?.stop?.();
    } catch {
      /* ignore */
    }
  }

  function reset() {
    cancel();
    revokeSessionUrls(session);
    session = null;
    lastError = null;
    runLock = false;
    setState(CAPTURE_STATES.idle);
    emitProgress({ step: "reset", message: "Ready", recording: false });
  }

  function stopCamera() {
    cancel();
    if (stream) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  function getSnapshot() {
    return {
      state,
      permission,
      lastError,
      capabilities,
      session,
      isBusy: runLock,
    };
  }

  return {
    CAPTURE_STATES,
    setVideoElement,
    initialize,
    startCapture,
    cancel,
    reset,
    stopCamera,
    getSnapshot,
    probePermissions,
  };
}

export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export async function downloadSession(session) {
  if (!session) return;
  for (const p of session.photos || []) {
    await downloadBlob(p.blob, p.filename);
    await sleep(180);
  }
  if (session.video?.blob) {
    await downloadBlob(session.video.blob, session.video.filename);
  }
}
