import { API_ROOT } from "./apiRoot";

const ROOT = API_ROOT;

export const MACHINE_META = {
  machine1: { title: "Machine 1", headCount: 1 },
  machine2: { title: "Machine 2", headCount: 6 },
  machine3: { title: "Machine 3", headCount: 6 },
  machine4: { title: "Machine 4", headCount: 6 },
};

export function apiRoot() {
  return ROOT;
}

export function extractFileId(input) {
  if (!input) return null;
  const s = String(input);
  let m = s.match(/IMAGE\("([^"]+)"/i);
  if (m) return extractFileId(m[1]);
  if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return s;
  m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return null;
}

export function jobImageUrl(job, sz = "w640") {
  const proxyBase = ROOT.replace(/\/api$/, "") + "/api/drive/thumbnail";
  const id =
    job?.imageFileId ||
    extractFileId(job?.imageLink) ||
    extractFileId(job?.Image) ||
    extractFileId(job?.artworkUrl) ||
    extractFileId(job?.imageUrl);
  if (id) return `${proxyBase}?${new URLSearchParams({ fileId: id, sz })}`;
  const fallback = job?.artworkUrl || job?.imageUrl || "";
  if (/^https?:\/\//i.test(fallback)) return fallback;
  return "";
}

export function isPlaceholder(job) {
  return String(job?.id || "").startsWith("ph-");
}

export function isEmbroideryOpen(job) {
  const st = String(job?.status || job?.Stage || job?.stage || "")
    .trim()
    .toLowerCase();
  if (st === "sewing" || st === "complete" || st === "completed" || st === "shipped") {
    return false;
  }
  return true;
}

export function normalizeOrderId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const n = Number(s);
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return s;
}

export function findJobInColumns(columns, orderId) {
  const want = normalizeOrderId(orderId);
  if (!want || !columns) return null;
  for (const key of ["machine1", "machine2", "machine3", "machine4", "queue"]) {
    const hit = (columns[key]?.jobs || []).find((j) => normalizeOrderId(j.id) === want);
    if (hit) return { job: hit, machineKey: key };
  }
  return null;
}

export function jobsForMachine(columns, machineKey) {
  const list = columns?.[machineKey]?.jobs || [];
  return list.filter((j) => j && j.id != null && !isPlaceholder(j) && isEmbroideryOpen(j));
}

/** Same runtime as the scheduler: stitches / 35k per hour per head. */
export function estimateRemainingMs(stitchCount, piecesLeft, headCount) {
  const stitches = Number(stitchCount) > 0 ? Number(stitchCount) : 30000;
  const heads = Math.max(1, Number(headCount) || 6);
  const left = Math.max(0, Number(piecesLeft) || 0);
  const runs = Math.ceil(left / heads) || 0;
  return (stitches / 35000) * runs * 3600000;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtMMDD(d) {
  if (!d) return "—";
  if (d instanceof Date && !isNaN(d)) {
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }
  const s = String(d).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}`;
  const dt = new Date(s);
  if (!isNaN(dt)) {
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
  }
  return s;
}
