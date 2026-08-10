/**
 * Department Status — work backwards from Ship Date.
 *
 * Flow: Digitizing → (Fur ∥ Cut) → Print? → Embroidery → Sewing → Ship
 *
 * Capacities (Mon–Fri, US national holidays off):
 *   Sewing:     96 pcs/day (ship day may include sewing)
 *   Embroidery: one job stays on one 6-head machine.
 *     Job hours = (stitches/30000)×(qty/6); calendar days = ceil(jobHours/8).
 *     Shop catch-up capacity = 3 machines × 8 hr = 24 machine-hours/day (different jobs in parallel).
 *   Print:      3 min/pc × 8 hr = 160 pcs/day
 *   Cut / Fur / Digitizing: no pcs/day yet → past-due vs on-time only
 */

export const DEPT_PLANNING_DAYS = 30;

export const SEWING_PCS_PER_DAY = 96;
export const EMB_STITCHES_PER_HOUR = 30000;
export const EMB_HEADS = 6;
export const EMB_MACHINES = 3; // 6-head only; Machine 1 ignored
export const HOURS_PER_DAY = 8;
export const EMB_MACHINE_HOURS_PER_DAY = EMB_MACHINES * HOURS_PER_DAY; // 24
export const PRINT_PCS_PER_DAY = Math.floor((HOURS_PER_DAY * 60) / 3); // 160
export const DEFAULT_STITCHES = 30000;
export const DIGITIZE_LEAD_WORKDAYS = 3;

/** US federal holidays (observed) 2025–2027 — YYYY-MM-DD local */
const US_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19',
  '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24',
]);

export const DEPT_ORDER = [
  'digitizing',
  'fur',
  'cut',
  'print',
  'embroidery',
  'sewing',
];

export const DEPT_LABELS = {
  digitizing: 'Digitizing',
  fur: 'Fur',
  cut: 'Cut',
  print: 'Print',
  embroidery: 'Embroidery',
  sewing: 'Sewing',
};

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function parseJobDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : startOfDay(val);
  if (typeof val === 'number' && Number.isFinite(val)) {
    const base = new Date(1899, 11, 30);
    return startOfDay(new Date(base.getTime() + val * 86400000));
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.split('T')[0].split('-').map(Number);
    return startOfDay(new Date(y, m - 1, d));
  }
  const parts = s.split(/[/-]/).map((p) => p.trim());
  if (parts.length >= 2) {
    let mo = Number(parts[0]);
    let da = Number(parts[1]);
    let yr = parts[2] != null ? Number(parts[2]) : new Date().getFullYear();
    if (yr < 100) yr += 2000;
    if (Number.isFinite(mo) && Number.isFinite(da) && Number.isFinite(yr)) {
      return startOfDay(new Date(yr, mo - 1, da));
    }
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : startOfDay(dt);
}

export function isWorkday(d) {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  return !US_HOLIDAYS.has(ymd(d));
}

/** Subtract N workdays (N > 0). N = 0 returns same day. */
export function subWorkDays(date, n) {
  const d = startOfDay(date);
  let left = Math.max(0, Number(n) || 0);
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    if (isWorkday(d)) left -= 1;
  }
  return startOfDay(d);
}

/** Workdays from today through deadline inclusive (both workdays). Past deadline → 0. */
export function workdaysThrough(deadline, now = new Date()) {
  const end = parseJobDate(deadline);
  if (!end) return 0;
  const today = startOfDay(now);
  if (end.getTime() < today.getTime()) return 0;
  let n = 0;
  const cur = new Date(today);
  while (cur.getTime() <= end.getTime()) {
    if (isWorkday(cur)) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/** Positive = deadline is in the past by that many workdays. */
export function workdaysPastDue(deadline, now = new Date()) {
  const end = parseJobDate(deadline);
  if (!end) return 0;
  const today = startOfDay(now);
  if (end.getTime() >= today.getTime()) return 0;
  let n = 0;
  const cur = new Date(end);
  cur.setDate(cur.getDate() + 1);
  while (cur.getTime() <= today.getTime()) {
    if (isWorkday(cur)) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export function jobQty(job) {
  const n = Number(job?.Quantity ?? job?.Qty ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function jobStitches(job) {
  const n = Number(job?.['Stitch Count'] ?? job?.stitch_count ?? 0);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STITCHES;
}

export function hasStitchCount(job) {
  const raw = job?.['Stitch Count'] ?? job?.stitch_count;
  if (raw == null || raw === '') return false;
  const n = Number(raw);
  return Number.isFinite(n) ? n > 0 : String(raw).trim().length > 0;
}

export function needsPrint(job) {
  return String(job?.Print ?? '').trim().toUpperCase() === 'PRINT';
}

export function getStage(job) {
  return String(job?.Stage ?? job?.stage ?? '').trim().toUpperCase();
}

export function isComplete(job) {
  const s = getStage(job);
  return s === 'COMPLETE' || s === 'COMPLETED';
}

function listStatus(job, key) {
  return String(job?.[key] ?? '').trim().toUpperCase();
}

/** Exclude backs/towels/belts from sewing pcs load (same as Sewing Priority). */
export function excludeFromSewingLoad(job) {
  const product = String(job?.Product ?? job?.product ?? '').toLowerCase();
  if (!product) return false;
  return product.includes('back') || product.includes('towel') || product.includes('belt');
}

export function embMachineHours(job) {
  const q = jobQty(job);
  if (q <= 0) return 0;
  return (jobStitches(job) / EMB_STITCHES_PER_HOUR) * (q / EMB_HEADS);
}

/**
 * Deadlines working backwards from ship.
 * Embroidery finishes the workday before sewing starts (sewing can use ship day).
 */
export function computeDeadlines(job) {
  const ship = parseJobDate(job['Ship Date'] ?? job.Ship ?? job['Due Date'] ?? job.Due);
  if (!ship) return null;
  const q = jobQty(job);
  if (q <= 0) return null;

  const sewingDays = Math.max(1, Math.ceil(q / SEWING_PCS_PER_DAY));
  const sewingStart = subWorkDays(ship, sewingDays - 1);
  const sewingFinish = ship;

  const hours = embMachineHours(job);
  // One job → one machine (8 hr/day). Do NOT divide across 3 machines.
  // Example: 100 pcs @ 30k stitches → 16.67 hr → 3 workdays, not 16.67/24 ≈ 1 day.
  const embDays = Math.max(1, Math.ceil(hours / HOURS_PER_DAY - 1e-9));
  // Must be embroidered before sewing starts that morning
  const embFinishBy = subWorkDays(sewingStart, 1);
  const embStart = subWorkDays(embFinishBy, embDays - 1);

  const printJob = needsPrint(job);
  const printFinishBy = printJob ? subWorkDays(embStart, 1) : null;
  // Fur and Cut run in parallel after digitizing, but have separate finish targets
  // so each department can show its own past-due pressure.
  // Cut: 1 workday before print (or embroidery if no print)
  // Fur: 2 workdays before that same gate (slightly earlier buffer)
  const nextGate = printJob ? printFinishBy : embStart;
  const cutFinishBy = subWorkDays(nextGate, 1);
  const furFinishBy = subWorkDays(nextGate, 2);
  const digitizingFinishBy = subWorkDays(embStart, DIGITIZE_LEAD_WORKDAYS);

  return {
    ship,
    qty: q,
    sewingDays,
    sewingStart,
    sewingFinish,
    embHours: hours,
    embDays,
    embStart,
    embFinishBy,
    printJob,
    printFinishBy,
    cutFinishBy,
    furFinishBy,
    /** @deprecated use cutFinishBy / furFinishBy */
    cutFurFinishBy: cutFinishBy,
    digitizingFinishBy,
  };
}

function furComplete(job) {
  const st = listStatus(job, 'Fur Status');
  if (st === 'COMPLETE') return true;
  const stage = getStage(job);
  return ['CUT', 'PRINT', 'EMBROIDERY', 'SEWING', 'SEW'].includes(stage);
}

function cutComplete(job) {
  const st = listStatus(job, 'Cut Status');
  if (st === 'COMPLETE') return true;
  const stage = getStage(job);
  return ['PRINT', 'EMBROIDERY', 'SEWING', 'SEW'].includes(stage);
}

function printComplete(job) {
  if (!needsPrint(job)) return true;
  const stage = getStage(job);
  return ['EMBROIDERY', 'SEWING', 'SEW'].includes(stage);
}

/** Ready for floater work in this department right now (gates respected). */
export function needsDigitizing(job) {
  if (isComplete(job)) return false;
  return !hasStitchCount(job);
}

export function needsFur(job) {
  if (isComplete(job) || needsDigitizing(job)) return false;
  return !furComplete(job);
}

export function needsCut(job) {
  if (isComplete(job) || needsDigitizing(job)) return false;
  return !cutComplete(job);
}

export function needsPrintDept(job) {
  if (isComplete(job) || !needsPrint(job)) return false;
  if (needsDigitizing(job)) return false;
  // Print gated on fur AND cut
  if (!furComplete(job) || !cutComplete(job)) return false;
  return !printComplete(job);
}

export function needsEmbroidery(job) {
  if (isComplete(job) || needsDigitizing(job)) return false;
  if (!furComplete(job) || !cutComplete(job)) return false;
  if (!printComplete(job)) return false;
  const stage = getStage(job);
  if (stage === 'SEWING' || stage === 'SEW') return false;
  // Gates cleared and not yet in sewing → embroidery work remains
  return true;
}

export function needsSewing(job) {
  if (isComplete(job)) return false;
  if (job?.sewingSummaryComplete) return false;
  if (excludeFromSewingLoad(job)) return false;
  const stage = getStage(job);
  return stage === 'SEWING' || stage === 'SEW';
}

function stillNeeds(dept, job) {
  switch (dept) {
    case 'digitizing':
      return needsDigitizing(job);
    case 'fur':
      return needsFur(job);
    case 'cut':
      return needsCut(job);
    case 'print':
      return needsPrintDept(job);
    case 'embroidery':
      return needsEmbroidery(job);
    case 'sewing':
      return needsSewing(job);
    default:
      return false;
  }
}

function deadlineFor(dept, deadlines) {
  if (!deadlines) return null;
  switch (dept) {
    case 'digitizing':
      return deadlines.digitizingFinishBy;
    case 'fur':
      return deadlines.furFinishBy;
    case 'cut':
      return deadlines.cutFinishBy;
    case 'print':
      return deadlines.printFinishBy;
    case 'embroidery':
      return deadlines.embFinishBy;
    case 'sewing':
      return deadlines.sewingFinish;
    default:
      return null;
  }
}

function fmtMD(d) {
  if (!d) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function capacityCatchUp(items, dailyCapacity, now) {
  let cum = 0;
  let maxDeficit = 0;
  let bottleneck = null;
  const enriched = [];

  for (const item of items) {
    cum += item.work;
    const days = workdaysThrough(item.deadline, now);
    const cap = days * dailyCapacity;
    const deficit = cum - cap;
    const past = workdaysPastDue(item.deadline, now);
    enriched.push({ ...item, cum, cap, deficit, pastDueWorkdays: past });
    if (deficit > maxDeficit + 1e-9) {
      maxDeficit = deficit;
      bottleneck = item;
    }
  }

  const daysBehind = dailyCapacity > 0 ? maxDeficit / dailyCapacity : 0;
  return {
    maxDeficit,
    daysBehind: Math.round(daysBehind * 10) / 10,
    bottleneck,
    items: enriched,
    totalWork: cum,
  };
}

function pastDueSummary(items, now) {
  let pastDueCount = 0;
  let maxPast = 0;
  const enriched = items.map((item) => {
    const past = workdaysPastDue(item.deadline, now);
    if (past > 0) {
      pastDueCount += 1;
      if (past > maxPast) maxPast = past;
    }
    return { ...item, pastDueWorkdays: past };
  });
  return {
    pastDueCount,
    daysBehind: maxPast, // max workdays late
    items: enriched,
    totalWork: items.length,
  };
}

/**
 * @param {object[]} jobs - Production order rows (overview upcoming shape)
 * @param {Date} [now]
 */
export function computeDepartmentStatus(jobs, now = new Date()) {
  const today = startOfDay(now);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + DEPT_PLANNING_DAYS);

  const pool = [];
  for (const job of jobs || []) {
    if (isComplete(job)) continue;
    const ship = parseJobDate(job['Ship Date'] ?? job.Ship ?? job['Due Date']);
    if (!ship) continue;
    // Include overdue + within planning horizon
    if (ship.getTime() > horizon.getTime()) continue;
    const deadlines = computeDeadlines(job);
    if (!deadlines) continue;
    pool.push({ job, deadlines });
  }

  const departments = {};

  for (const dept of DEPT_ORDER) {
    const rows = [];
    for (const { job, deadlines } of pool) {
      if (!stillNeeds(dept, job)) continue;
      const deadline = deadlineFor(dept, deadlines);
      if (!deadline && dept === 'print') continue;

      let work = 1;
      let workLabel = 'job';
      if (dept === 'sewing' || dept === 'print' || dept === 'cut' || dept === 'fur') {
        work = deadlines.qty;
        workLabel = 'pcs';
      } else if (dept === 'embroidery') {
        work = deadlines.embHours;
        workLabel = 'mch-hrs';
      } else if (dept === 'digitizing') {
        work = 1;
        workLabel = 'design';
      }

      rows.push({
        id: String(job['Order #'] ?? ''),
        company: String(job['Company Name'] ?? ''),
        design: String(job.Design ?? ''),
        product: String(job.Product ?? ''),
        stage: getStage(job),
        ship: deadlines.ship,
        shipLabel: fmtMD(deadlines.ship),
        deadline,
        deadlineLabel: fmtMD(deadline),
        qty: deadlines.qty,
        work,
        workLabel,
        printJob: deadlines.printJob,
        job,
      });
    }

    rows.sort((a, b) => {
      const ds = a.ship - b.ship;
      if (ds !== 0) return ds;
      return a.id.localeCompare(b.id);
    });

    let result;
    if (dept === 'sewing') {
      result = capacityCatchUp(rows, SEWING_PCS_PER_DAY, now);
      result.mode = 'capacity';
      result.unit = 'pcs';
      result.dailyCapacity = SEWING_PCS_PER_DAY;
    } else if (dept === 'embroidery') {
      result = capacityCatchUp(rows, EMB_MACHINE_HOURS_PER_DAY, now);
      result.mode = 'capacity';
      result.unit = 'mch-hrs';
      result.dailyCapacity = EMB_MACHINE_HOURS_PER_DAY;
    } else if (dept === 'print') {
      result = capacityCatchUp(rows, PRINT_PCS_PER_DAY, now);
      result.mode = 'capacity';
      result.unit = 'pcs';
      result.dailyCapacity = PRINT_PCS_PER_DAY;
    } else {
      result = pastDueSummary(rows, now);
      result.mode = 'deadline';
      result.unit = dept === 'digitizing' ? 'designs' : 'pcs';
      result.dailyCapacity = null;
      // For display pressure: prefer past-due count; daysBehind = max lateness
      result.maxDeficit = result.pastDueCount;
    }

    const behind =
      (result.mode === 'capacity' && result.daysBehind > 0.05) ||
      (result.mode === 'deadline' && (result.pastDueCount || 0) > 0);
    const jobCount = rows.length;

    let headline;
    let subline;
    if (result.mode === 'capacity') {
      if (result.daysBehind > 0.05) {
        headline = `+${result.daysBehind}d`;
        subline = 'behind';
      } else if (jobCount === 0) {
        headline = '—';
        subline = 'clear';
      } else {
        headline = 'OK';
        subline = 'on pace';
      }
    } else if ((result.pastDueCount || 0) > 0) {
      headline = String(result.pastDueCount);
      subline = 'past due';
    } else if (jobCount === 0) {
      headline = '—';
      subline = 'clear';
    } else {
      headline = String(jobCount);
      subline = 'on time';
    }

    const nextJobs = [...(result.items || rows)]
      .sort((a, b) => {
        const pa = a.pastDueWorkdays ?? workdaysPastDue(a.deadline, now);
        const pb = b.pastDueWorkdays ?? workdaysPastDue(b.deadline, now);
        if (pa !== pb) return pb - pa;
        const dd = (a.deadline?.getTime?.() || 0) - (b.deadline?.getTime?.() || 0);
        if (dd !== 0) return dd;
        return a.ship - b.ship;
      })
      .slice(0, 12);

    departments[dept] = {
      id: dept,
      label: DEPT_LABELS[dept],
      ...result,
      jobCount,
      behind,
      headline,
      subline,
      nextJobs,
    };
  }

  // Floater target = largest deficit
  let focusId = null;
  let bestScore = -Infinity;
  for (const dept of DEPT_ORDER) {
    const d = departments[dept];
    let score = 0;
    if (d.mode === 'capacity') score = d.daysBehind;
    else score = d.pastDueCount > 0 ? d.daysBehind + d.pastDueCount * 0.1 : 0;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      focusId = score > 0.05 ? dept : focusId;
    }
  }

  return {
    departments,
    focusId,
    computedAt: now.toISOString(),
  };
}
