import { API_ROOT } from "../apiRoot";

/**
 * Upload one Photo Station blob to Google Drive via the backend.
 * Auth: axios-setup patches fetch with Bearer + cookies (credentials include).
 */
export async function uploadPhotoStationFile({ blob, filename, sessionId }) {
  if (!blob) throw new Error("Missing file blob");
  const fd = new FormData();
  fd.append("file", blob, filename || "capture.bin");
  fd.append("filename", filename || "capture.bin");
  fd.append("sessionId", sessionId || "session");

  const res = await fetch(`${API_ROOT}/photo-station/upload`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      `Drive upload failed (${res.status})`;
    const err = new Error(msg);
    err.code = "DRIVE_UPLOAD_FAILED";
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Upload all photos + video for a capture session (blocking).
 * Prefer enqueueSessionUpload() so the station can capture the next product.
 */
export async function uploadSessionToDrive(session, { onProgress } = {}) {
  if (!session) throw new Error("No capture session to upload");
  const sessionId = `JR_${session.id || session.dateStr || "session"}`;
  const photos = (session.photos || []).map((p) => ({
    filename: p.filename,
    blob: p.blob,
    ref: p,
  }));
  const video = session.video?.blob
    ? { filename: session.video.filename, blob: session.video.blob, ref: session.video }
    : null;

  const result = await uploadSnapshotToDrive({
    sessionId,
    photos,
    video,
    onProgress,
  });

  session.drive = result.drive;
  return session;
}

async function uploadSnapshotToDrive({ sessionId, photos, video, onProgress }) {
  const uploads = [];
  const total = photos.length + (video ? 1 : 0);
  let done = 0;

  for (const photo of photos) {
    onProgress?.({
      message: `Uploading ${photo.filename}… (${done + 1}/${total})`,
      done,
      total,
      filename: photo.filename,
    });
    const result = await uploadPhotoStationFile({
      blob: photo.blob,
      filename: photo.filename,
      sessionId,
    });
    if (photo.ref) photo.ref.drive = result;
    uploads.push(result);
    done += 1;
  }

  if (video) {
    onProgress?.({
      message: `Uploading ${video.filename}… (${done + 1}/${total})`,
      done,
      total,
      filename: video.filename,
    });
    const result = await uploadPhotoStationFile({
      blob: video.blob,
      filename: video.filename,
      sessionId,
    });
    if (video.ref) video.ref.drive = result;
    uploads.push(result);
    done += 1;
  }

  const folderId = uploads[0]?.folderId || null;
  const rootFolderId = uploads[0]?.rootFolderId || null;
  const folderName = uploads[0]?.folderName || sessionId;
  const drive = {
    sessionId,
    folderId,
    rootFolderId,
    folderName,
    folderUrl: folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : null,
    uploads,
    ok: true,
  };

  onProgress?.({
    message: `Uploaded ${done} file(s) to ${folderName}`,
    done,
    total,
    folderUrl: drive.folderUrl,
  });

  return { drive, done, total };
}

/** @type {Array<object>} */
const uploadQueue = [];
/** @type {Set<Function>} */
const listeners = new Set();
let pumpRunning = false;

function notifyQueue() {
  const snapshot = getUploadQueueSnapshot();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore */
    }
  });
}

export function getUploadQueueSnapshot() {
  return uploadQueue.map((j) => ({
    id: j.id,
    sessionId: j.sessionId,
    status: j.status,
    message: j.message,
    done: j.done,
    total: j.total,
    folderUrl: j.folderUrl,
    folderName: j.folderName,
    error: j.error,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  }));
}

export function subscribeUploadQueue(fn) {
  listeners.add(fn);
  try {
    fn(getUploadQueueSnapshot());
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
}

/**
 * Queue a finished capture for background Drive upload.
 * Snapshots blob references so the next capture can start immediately.
 */
export function enqueueSessionUpload(session, { onJobUpdate } = {}) {
  if (!session) throw new Error("No capture session to upload");
  const sessionId = `JR_${session.id || session.dateStr || "session"}`;
  const photos = (session.photos || [])
    .filter((p) => p?.blob)
    .map((p) => ({ filename: p.filename, blob: p.blob, ref: p }));
  const video = session.video?.blob
    ? {
        filename: session.video.filename,
        blob: session.video.blob,
        ref: session.video,
      }
    : null;
  const total = photos.length + (video ? 1 : 0);

  const job = {
    id: session.id || sessionId,
    sessionId,
    status: "queued",
    message: total ? `Queued (${total} file${total === 1 ? "" : "s"})` : "Nothing to upload",
    done: 0,
    total,
    folderUrl: null,
    folderName: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    photos,
    video,
    sessionRef: session,
    onJobUpdate,
  };

  if (session.drive) {
    session.drive = { ...session.drive, status: "queued", ok: null };
  } else {
    session.drive = { sessionId, status: "queued", ok: null };
  }

  uploadQueue.unshift(job);
  // Keep recent history only
  while (uploadQueue.length > 12) {
    const oldest = uploadQueue[uploadQueue.length - 1];
    if (oldest.status === "queued" || oldest.status === "uploading") break;
    uploadQueue.pop();
  }

  notifyQueue();
  job.onJobUpdate?.(jobSnapshot(job));
  pumpQueue();
  return job.id;
}

function jobSnapshot(job) {
  return {
    id: job.id,
    sessionId: job.sessionId,
    status: job.status,
    message: job.message,
    done: job.done,
    total: job.total,
    folderUrl: job.folderUrl,
    folderName: job.folderName,
    error: job.error,
  };
}

async function pumpQueue() {
  if (pumpRunning) return;
  pumpRunning = true;
  try {
    while (true) {
      const job = uploadQueue.find((j) => j.status === "queued");
      if (!job) break;

      job.status = "uploading";
      job.startedAt = new Date().toISOString();
      job.message =
        job.total > 0
          ? `Uploading to Google Drive… (0/${job.total})`
          : "Nothing to upload";
      if (job.sessionRef) {
        job.sessionRef.drive = {
          ...(job.sessionRef.drive || {}),
          sessionId: job.sessionId,
          status: "uploading",
          ok: null,
        };
      }
      notifyQueue();
      job.onJobUpdate?.(jobSnapshot(job));

      if (job.total === 0) {
        job.status = "done";
        job.finishedAt = new Date().toISOString();
        job.message = "Nothing to upload";
        notifyQueue();
        job.onJobUpdate?.(jobSnapshot(job));
        continue;
      }

      try {
        const { drive, done, total } = await uploadSnapshotToDrive({
          sessionId: job.sessionId,
          photos: job.photos,
          video: job.video,
          onProgress: (p) => {
            job.done = p.done || 0;
            job.total = p.total || total;
            job.message = p.message;
            if (p.folderUrl) job.folderUrl = p.folderUrl;
            notifyQueue();
            job.onJobUpdate?.(jobSnapshot(job));
          },
        });
        job.status = "done";
        job.done = done;
        job.total = total;
        job.folderUrl = drive.folderUrl;
        job.folderName = drive.folderName;
        job.message = `Saved to ${drive.folderName}`;
        job.finishedAt = new Date().toISOString();
        job.error = null;
        if (job.sessionRef) {
          job.sessionRef.drive = { ...drive, status: "done", ok: true };
        }
      } catch (e) {
        const msg = e?.message || String(e);
        job.status = "error";
        job.error = msg;
        job.message = `Upload failed: ${msg}`;
        job.finishedAt = new Date().toISOString();
        if (job.sessionRef) {
          job.sessionRef.drive = {
            ...(job.sessionRef.drive || {}),
            sessionId: job.sessionId,
            status: "error",
            error: msg,
            ok: false,
          };
        }
      }

      // Drop heavy blob refs after finish so memory can reclaim
      job.photos = [];
      job.video = null;

      notifyQueue();
      job.onJobUpdate?.(jobSnapshot(job));
    }
  } finally {
    pumpRunning = false;
    // Another job may have been queued while we were finishing
    if (uploadQueue.some((j) => j.status === "queued")) {
      pumpQueue();
    }
  }
}
