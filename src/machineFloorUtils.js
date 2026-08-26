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
  return (
    String(job?.id || "").startsWith("ph-") ||
    job?.placeholder === true ||
    job?.isPlaceholder === true ||
    job?.type === "placeholder"
  );
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

/** Same runtime as the scheduler: observed cycle if known, else stitches / 30k per head-run. */
export function estimateRemainingMs(stitchCount, piecesLeft, headCount, avgCycleMs = 0) {
  const heads = Math.max(1, Number(headCount) || 6);
  const left = Math.max(0, Number(piecesLeft) || 0);
  const runs = Math.ceil(left / heads) || 0;
  const stitches = Number(stitchCount) > 0 ? Number(stitchCount) : 30000;
  const expectedCycle = (stitches / 30000) * 3600000;
  const avg = Number(avgCycleMs) || 0;
  const maxAvg = Math.max(expectedCycle * 2, expectedCycle + 15 * 60 * 1000);
  if (avg > 0 && avg <= maxAvg && runs > 0) return avg * runs;
  return expectedCycle * runs;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatClockET(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!(d instanceof Date) || isNaN(d)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatCompactDuration(ms) {
  if (!Number.isFinite(ms) || ms < 2 * 60 * 1000) return "";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

export function formatSignedPerf(aheadMs) {
  if (!Number.isFinite(aheadMs)) return null;
  const totalMin = Math.round(aheadMs / 60000);
  if (totalMin === 0) return { text: "0", color: "#6b7280" };
  const faster = totalMin > 0;
  const n = Math.abs(totalMin);
  const body = n < 60 ? `${n}m` : `${Math.floor(n / 60)}h${n % 60 ? `${n % 60}m` : ""}`;
  return {
    text: faster ? `+${body}` : `-${body}`,
    color: faster ? "#16a34a" : "#dc2626",
  };
}

/** Last N +N posts with clock and green/red vs expected cycle (stitches/30k). */
export function lastRunsWithPerf(runs, stitchCount, headCount, limit = 2) {
  const raw = (Array.isArray(runs) ? runs : []).filter((r) => r && r.at);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    let cycleMs = Number(r.cycleMs) || 0;
    if (!cycleMs && i > 0) {
      const t0 = new Date(raw[i - 1].at).getTime();
      const t1 = new Date(r.at).getTime();
      const ms = t1 - t0;
      if (Number.isFinite(ms) && ms >= 2 * 60 * 1000 && ms <= 4 * 60 * 60 * 1000) {
        cycleMs = ms;
      }
    }
    const inc = Number(r.increment) || 0;
    const expectedMs = estimateRemainingMs(stitchCount, inc, headCount, 0);
    const aheadMs =
      cycleMs >= 2 * 60 * 1000 && expectedMs > 0 ? expectedMs - cycleMs : null;
    out.push({
      increment: inc,
      at: r.at,
      clock: formatClockET(r.at),
      perf: aheadMs == null ? null : formatSignedPerf(aheadMs),
    });
  }
  return out.slice(-Math.max(1, limit));
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
