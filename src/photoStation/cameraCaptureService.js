/**
 * Photo Station camera capture service — Safari-first state machine.
 *
 * States: idle → initializing → photo_capture → video_capture → saving → complete
 * Plus: error (recoverable via reset)
 *
 * Keeps one MediaStream alive across stills + video when possible.
 * Prefer ImageCapture.takePhoto(); fall back to canvas (no upscale / no fake 24MP claims).
 */

import { enqueueSessionUpload } from "./driveUpload";

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
const PHOTO_ANGLES = [0, 35, 90, 140, 150, 180, 210, 220, 270, 330];
const QUARTER_ANGLES = [0, 90, 180, 270];
const VIDEO_START_DEG = 270;
const TURNTABLE_SPEED = 6;
const TURNTABLE_FAST_SPEED = 24;
// One full turn from 270 back to 270, then on to 0.
const VIDEO_SPIN_DEG = 450;

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

export function photoAnglesWithQuarters(angles) {
  const source = Array.isArray(angles) && angles.length ? angles : PHOTO_ANGLES;
  const nums = [];
  for (const raw of [...source, ...QUARTER_ANGLES]) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    nums.push(((n % 360) + 360) % 360);
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

export function formatAngleToken(angle) {
  const n = Number(angle);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** "Order # - Job Name - Product" with characters Drive and files can keep. */
export function captureBaseName(label) {
  if (!label) return "";
  const parts = [label.orderNumber, label.jobName, label.product]
    .map((part) => String(part || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const name = parts
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name.slice(0, 140);
}

export function buildPhotoFilename(dateStr, sessionNum, photoIndex) {
  return `JR_${dateStr}_${pad3(sessionNum)}_Photo_${pad2(photoIndex)}.jpg`;
}

export function buildLabeledPhotoFilename(baseName, angle) {
  return `${baseName} - ${formatAngleToken(angle)}.jpg`;
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

export function buildLabeledVideoFilename(baseName, mimeType) {
  const ext = mimeType?.includes("mp4")
    ? "mp4"
    : mimeType?.includes("webm")
      ? "webm"
      : mimeType?.includes("quicktime")
        ? "mov"
        : "webm";
  return `${baseName} - 360.${ext}`;
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
  photoAngles = PHOTO_ANGLES,
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
    await waitForVideoPreview(8000);
  }

  async function waitForVideoPreview(timeoutMs = 8000) {
    const video = videoEl;
    if (!video) {
      throw Object.assign(new Error("Camera preview element is missing."), {
        code: "PREVIEW_MISSING",
      });
    }
    try {
      video.muted = true;
      video.setAttribute("playsinline", "true");
      video.playsInline = true;
      if (stream && video.srcObject !== stream) {
        video.srcObject = stream;
      }
      await video.play().catch(() => {});
    } catch {
      /* ignore */
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
      try {
        await video.play();
      } catch {
        /* ignore */
      }
    }
    throw Object.assign(
      new Error(
        "Video preview is not ready for capture. Keep Safari in the foreground and try again."
      ),
      { code: "PREVIEW_NOT_READY" }
    );
  }

  async function ensureLiveStream() {
    const track = stream?.getVideoTracks()?.[0];
    if (track && track.readyState === "live") {
      if (videoEl && (!videoEl.srcObject || videoEl.videoWidth === 0)) {
        await attachStream(stream);
      } else {
        await waitForVideoPreview(5000);
      }
      return;
    }
    log("camera track not live — reopening rear camera");
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      stream = null;
    }
    const s = await getRearStream();
    await attachStream(s);
  }

  async function initialize() {
    if (stream) {
      const track = stream.getVideoTracks()?.[0];
      if (track && track.readyState === "live") {
        readTrackInfo(stream);
        try {
          await waitForVideoPreview(5000);
          emitProgress({ step: "preview_ready", message: "Camera ready" });
          return;
        } catch {
          log("existing stream preview not ready — reinitializing");
        }
      }
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      stream = null;
    }
    setState(CAPTURE_STATES.initializing);
    emitProgress({ step: "initializing", message: "Opening rear camera…" });
    await probePermissions();
    const s = await getRearStream();
    await attachStream(s);
    setState(CAPTURE_STATES.idle);
    emitProgress({ step: "preview_ready", message: "Camera ready" });
  }

  async function captureStill(photoIndex, dateStr, sessionNum, angle) {
    await ensureLiveStream();
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

    // Prefer a settled preview frame on iPhone; ImageCapture can stall Safari's stream.
    await waitForVideoPreview(5000);
    // Brief settle so autofocus/exposure catch up after a rotate
    await new Promise((r) => setTimeout(r, 180));

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
      await ensureLiveStream();
      await waitForVideoPreview(5000);
      const video = videoEl;
      if (!video || !video.videoWidth) {
        throw Object.assign(
          new Error(
            "Video preview is not ready for canvas capture. Keep the Photo Station page open and unlocked."
          ),
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

    // After still capture, Safari may need a moment before the next preview frame.
    try {
      await waitForVideoPreview(3000);
    } catch {
      log("preview slow to recover after still; continuing");
    }

    // Ensure JPEG type when possible
    if (blob && blob.type && !blob.type.includes("jpeg") && !blob.type.includes("jpg")) {
      // Keep original if browser gave us something else from takePhoto (e.g. image/png)
      log("still mime", blob.type);
    }

    const filename = session?.baseName
      ? buildLabeledPhotoFilename(session.baseName, angle)
      : buildPhotoFilename(dateStr, sessionNum, photoIndex);
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

  function isSmoothVideoSettings(settings) {
    const w = settings?.width || 0;
    const h = settings?.height || 0;
    const fps = settings?.frameRate || 0;
    return w > 0 && h > 0 && w * h <= 1920 * 1080 * 1.25 && fps >= 20;
  }

  async function openSmoothVideoStream() {
    const attempts = [
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 },
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
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
    ];
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        const settings = s.getVideoTracks()[0]?.getSettings?.() || {};
        if (isSmoothVideoSettings(settings)) {
          log("smooth video stream", settings);
          return s;
        }
        log("smooth video stream still too heavy", settings);
        s.getTracks().forEach((t) => t.stop());
        lastErr = new Error("Camera stayed at a low frame rate");
      } catch (e) {
        lastErr = e;
        log("smooth video getUserMedia failed", e?.message || e);
      }
    }
    if (lastErr) throw lastErr;
    throw new Error("Could not open a smooth video stream");
  }

  async function prepareStreamForSmoothVideo() {
    const track = stream?.getVideoTracks?.()[0];
    if (track && track.readyState === "live") {
      try {
        track.contentHint = "motion";
      } catch {
        /* ignore */
      }
      try {
        await track.applyConstraints({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        });
        await waitForVideoPreview(3000);
        const settings = track.getSettings?.() || {};
        if (isSmoothVideoSettings(settings)) {
          log("smooth video constraints", settings);
          return settings;
        }
        log("in-place video constraints ignored", settings);
      } catch (e) {
        log("smooth video constraint failed", e?.message || e);
      }
    }

    try {
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
      const s = await openSmoothVideoStream();
      await attachStream(s);
      try {
        s.getVideoTracks()[0].contentHint = "motion";
      } catch {
        /* ignore */
      }
      return s.getVideoTracks()[0]?.getSettings?.() || {};
    } catch (e) {
      log("reopen smooth stream failed — recording current camera", e?.message || e);
      if (!stream) {
        try {
          const s = await getRearStream();
          await attachStream(s);
        } catch (reopenErr) {
          log("camera reopen failed", reopenErr?.message || reopenErr);
        }
      }
      return stream?.getVideoTracks?.()[0]?.getSettings?.() || null;
    }
  }

  async function restorePhotoStream() {
    const settings = stream?.getVideoTracks?.()[0]?.getSettings?.() || {};
    const pixels = (settings.width || 0) * (settings.height || 0);
    if (pixels > 1920 * 1080 * 1.3) return;
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
    try {
      const s = await getRearStream();
      await attachStream(s);
    } catch (e) {
      log("restore photo stream failed", e?.message || e);
    }
  }

  async function recordVideo(dateStr, sessionNum, signal, spin) {
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

    const videoSettings = (await prepareStreamForSmoothVideo()) || {};
    const mimeType = pickRecorderMimeType();
    const options = {};
    if (mimeType) options.mimeType = mimeType;
    const w = videoSettings.width || videoEl?.videoWidth || 1920;
    const h = videoSettings.height || videoEl?.videoHeight || 1080;
    const fps = videoSettings.frameRate || 30;
    // Enough bits to hold every frame. A higher number on a huge photo stream
    // makes Safari drop frames, which is what looks choppy.
    options.videoBitsPerSecond = Math.round(
      Math.min(12_000_000, Math.max(5_000_000, w * h * fps * 0.07))
    );
    log("recorder bitrate", { w, h, fps, videoBitsPerSecond: options.videoBitsPerSecond });

    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (e) {
      log("MediaRecorder with options failed; retrying default", e?.message);
      try {
        recorder = new MediaRecorder(stream);
      } catch (e2) {
        await restorePhotoStream();
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

    const recordMs = spin
      ? Math.round((videoDurationMs * VIDEO_SPIN_DEG) / 360)
      : videoDurationMs;
    const recordSec = Math.ceil(recordMs / 1000);

    emitProgress({
      step: "video_recording",
      message: spin ? "Recording from 270° around to 0°…" : "Recording video…",
      videoCountdownSec: recordSec,
      videoDurationSec: recordSec,
      recording: true,
    });

    try {
      // A timeslice makes iPhone Safari recordings stutter. One clip at stop plays smoothly.
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
      if (ios) recorder.start();
      else recorder.start(1000);
    } catch (e) {
      document.removeEventListener("visibilitychange", onVis);
      await restorePhotoStream();
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
          Math.ceil((recordMs - (Date.now() - startedAt)) / 1000)
        );
        emitProgress({
          step: "video_recording",
          recording: true,
          videoCountdownSec: left,
          videoDurationSec: recordSec,
          message: spin ? `Recording 270° to 0°… ${left}s` : `Recording… ${left}s`,
        });
      }, 200);

      // The spin defines the clip: 270° all the way around, then on to 0°.
      const spinPromise = spin
        ? spin().catch((e) => {
            log("video spin warning", e?.message || e);
          })
        : sleep(videoDurationMs, signal);

      try {
        await spinPromise;
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
      await restorePhotoStream();
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
    const width = w || videoSettings.width || 0;
    const height = h || videoSettings.height || 0;
    const filename = session?.baseName
      ? buildLabeledVideoFilename(session.baseName, actualMime)
      : buildVideoFilename(dateStr, sessionNum, actualMime);
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

  async function startCapture(opts = {}) {
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
    if (!opts.label?.orderNumber) {
      const message = "Scan the barcode on the job.";
      lastError = { code: "SCAN_REQUIRED", message };
      setState(CAPTURE_STATES.error);
      emitProgress({ step: "error", message, error: lastError });
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
    const baseName = captureBaseName(opts.label);
    const angles = photoAnglesWithQuarters(photoAngles);
    session = {
      id: `${dateStr}_${pad3(sessionNum)}`,
      dateStr,
      sessionNum,
      baseName: baseName || null,
      folderName: baseName || null,
      orderNumber: opts.label?.orderNumber || null,
      jobName: opts.label?.jobName || null,
      product: opts.label?.product || null,
      company: opts.label?.company || null,
      photos: [],
      video: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    emitProgress({
      step: "starting",
      message: baseName ? `Starting ${baseName}…` : "Starting capture…",
      photoIndex: 0,
      photoTotal: angles.length,
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
      await ensureLiveStream();
      const total = angles.length;

      async function moveTo(targetDeg, fast) {
        if (!turntable) {
          await sleep(fast ? 300 : stepWaitMs, signal);
          return;
        }
        const from = Number(turntable.getStatus()?.positionDeg) || 0;
        const current = ((from % 360) + 360) % 360;
        const target = ((Number(targetDeg) % 360) + 360) % 360;
        let delta = target - current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        if (Math.abs(delta) < 0.4) return;
        await turntable.rotateDegrees(delta, {
          speedGrade: fast ? TURNTABLE_FAST_SPEED : TURNTABLE_SPEED,
        });
      }

      for (let i = 0; i < total; i += 1) {
        if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "ABORTED" });
        const angle = angles[i];
        emitProgress({
          step: "turntable_wait",
          message: `Moving to ${angle}°…`,
          photoIndex: i,
          photoTotal: total,
          recording: false,
        });
        await moveTo(angle, false);
        await ensureLiveStream();
        await new Promise((r) => setTimeout(r, 250));
        emitProgress({
          step: "photo_capture",
          message: `Capturing photo ${i + 1} of ${total} at ${angle}°…`,
          photoIndex: i + 1,
          photoTotal: total,
          recording: false,
        });
        const photo = await captureStill(i + 1, dateStr, sessionNum, angle);
        session.photos.push(photo);
        emitProgress({
          step: "photo_captured",
          message: `Photo ${i + 1}/${total} at ${angle}°: ${photo.width}×${photo.height} (${photo.megapixels} MP)`,
          photoIndex: i + 1,
          photoTotal: total,
          lastPhoto: photo,
        });
      }

      emitProgress({
        step: "turntable_wait",
        message: `Moving quickly to ${VIDEO_START_DEG}°…`,
        photoIndex: total,
        photoTotal: total,
        recording: false,
      });
      await moveTo(VIDEO_START_DEG, true);

      setState(CAPTURE_STATES.video_capture);
      emitProgress({
        step: "video_starting",
        message: `Starting video at ${VIDEO_START_DEG}°…`,
        recording: true,
        photoIndex: total,
        photoTotal: total,
        videoCountdownSec: Math.ceil((videoDurationMs * VIDEO_SPIN_DEG) / 360 / 1000),
        videoDurationSec: Math.ceil((videoDurationMs * VIDEO_SPIN_DEG) / 360 / 1000),
      });
      await ensureLiveStream();
      const video = await recordVideo(dateStr, sessionNum, signal, async () => {
        if (!turntable) {
          await sleep(Math.round((videoDurationMs * VIDEO_SPIN_DEG) / 360), signal);
          return;
        }
        // Full turn brings 270° back to 270°, then 90° more lands on 0°.
        await turntable.rotateDegrees(360, { speedGrade: TURNTABLE_SPEED });
        await turntable.rotateDegrees(90, { speedGrade: TURNTABLE_SPEED });
      });
      session.video = video;

      session.completedAt = new Date().toISOString();

      // The video spin already returned the table to 0°. Don't home again.

      // Queue Drive upload in the background so the next product can start now.
      try {
        enqueueSessionUpload(session, {
          onJobUpdate: (job) => {
            log(`drive upload [${job.status}] ${job.sessionId}`, job.message);
          },
        });
        log("drive upload queued", session.id);
      } catch (queueErr) {
        log("drive upload queue failed", queueErr?.message || queueErr);
        session.drive = {
          ...(session.drive || {}),
          status: "error",
          error: queueErr?.message || String(queueErr),
          ok: false,
        };
      }

      setState(CAPTURE_STATES.complete);
      emitProgress({
        step: "complete",
        message:
          "Capture complete — ready for next product. Drive upload continues in background.",
        recording: false,
        folderUrl: session.drive?.folderUrl || null,
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
