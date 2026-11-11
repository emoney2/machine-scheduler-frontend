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
 * Upload all photos + video for a capture session.
 * Returns the same session object with drive metadata attached.
 */
export async function uploadSessionToDrive(session, { onProgress } = {}) {
  if (!session) throw new Error("No capture session to upload");
  const sessionId = `JR_${session.id || session.dateStr || "session"}`;
  const uploads = [];
  const photos = session.photos || [];
  const total = photos.length + (session.video?.blob ? 1 : 0);
  let done = 0;

  for (const photo of photos) {
    onProgress?.({
      message: `Uploading ${photo.filename} to Google Drive… (${done + 1}/${total})`,
      done,
      total,
      filename: photo.filename,
    });
    const result = await uploadPhotoStationFile({
      blob: photo.blob,
      filename: photo.filename,
      sessionId,
    });
    photo.drive = result;
    uploads.push(result);
    done += 1;
  }

  if (session.video?.blob) {
    onProgress?.({
      message: `Uploading ${session.video.filename} to Google Drive… (${done + 1}/${total})`,
      done,
      total,
      filename: session.video.filename,
    });
    const result = await uploadPhotoStationFile({
      blob: session.video.blob,
      filename: session.video.filename,
      sessionId,
    });
    session.video.drive = result;
    uploads.push(result);
    done += 1;
  }

  const folderId = uploads[0]?.folderId || null;
  const rootFolderId = uploads[0]?.rootFolderId || null;
  const folderName = uploads[0]?.folderName || sessionId;
  session.drive = {
    sessionId,
    folderId,
    rootFolderId,
    folderName,
    folderUrl: folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : null,
    uploads,
  };

  onProgress?.({
    message: `Uploaded ${done} file(s) to Google Drive folder ${folderName}`,
    done,
    total,
    folderUrl: session.drive.folderUrl,
  });

  return session;
}
