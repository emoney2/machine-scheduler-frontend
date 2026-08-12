/**
 * Department Status — capacity schedule working backwards from Ship Date.
 *
 * Flow: Digitizing → (Fur ∥ Cut) → Print? → Embroidery → Sewing → Ship
 *
 * Model:
 *   1) Per job, compute department finish-by dates by walking back from ship
 *      (sewing 96 pcs/day, embroidery one-job-one-machine hours, etc.).
 *   2) Shared shop capacity is reserved from the future toward today:
 *      farthest deadlines claim days first, so a 1000-pc Sept 15 sew blocks
 *      ~11 workdays ending on ship and those days cannot be used by other jobs.
 *   3) Anything that cannot fit before today is "behind".
 *
 * Capacities (Mon–Fri, US national holidays off):
 *   Sewing:     96 pcs/day (ship day may include sewing)
 *   Embroidery: one job stays on one 6-head machine.
 *     Job hours = (stitches/30000)×(qty/6); calendar days = ceil(jobHours/8).
 *     Shop catch-up capacity = 3 machines × 8 hr = 24 machine-hours/day.
 *   Print:      3 min/pc × 8 hr = 160 pcs/day
 *   Cut:        200 pcs/day (estimate)
 *   Fur:        200 pcs/day (estimate)
 *   Digitizing: 4 designs/day (estimate)
 *
 * Exclusions: towels and belts are never counted (not manufactured here).
 * Backs are excluded from sewing load only (same as Sewing Priority).
 */

export const DEPT_PLANNING_DAYS = 60;

export const SEWING_PCS_PER_DAY = 96;
export const EMB_STITCHES_PER_HOUR = 30000;
export const EMB_HEADS = 6;
export const EMB_MACHINES = 3; // 6-head only; Machine 1 ignored
export const HOURS_PER_DAY = 8;
export const EMB_MACHINE_HOURS_PER_DAY = EMB_MACHINES * HOURS_PER_DAY; // 24
export const PRINT_PCS_PER_DAY = Math.floor((HOURS_PER_DAY * 60) / 3); // 160
export const CUT_PCS_PER_DAY = 200;
export const FUR_PCS_PER_DAY = 200;
export const DIGITIZE_DESIGNS_PER_DAY = 4;
export const DEFAULT_STITCHES = 30000;
export const DIGITIZE_LEAD_WORKDAYS = 3;
/** Jobs due within this many workdays count as "coming up" in the detail list. */
export const COMING_UP_WORKDAYS = 5;

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

/**
 * Towels / belts are not manufactured here — exclude from every department
 * capacity calculation (digitizing through sewing).
 */
export function excludeNonManufactured(job) {
  const product = String(job?.Product ?? job?.product ?? '').toLowerCase();
  if (!product) return false;
  return product.includes('towel') || product.includes('belt');
}

/** Exclude backs/towels/belts from sewing pcs load (same as Sewing Priority). */
export function excludeFromSewingLoad(job) {
  const product = String(job?.Product ?? job?.product ?? '').toLowerCase();
  if (!product) return false;
  if (excludeNonManufactured(job)) return true;
  return product.includes('back');
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
  const embDays = Math.max(1, Math.ceil(hours / HOURS_PER_DAY - 1e-9));
  const embFinishBy = subWorkDays(sewingStart, 1);
  const embStart = subWorkDays(embFinishBy, embDays - 1);

  const printJob = needsPrint(job);
  const printFinishBy = printJob ? subWorkDays(embStart, 1) : null;
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
  if (!furComplete(job) || !cutComplete(job)) return false;
  return !printComplete(job);
}

export function needsEmbroidery(job) {
  if (isComplete(job) || needsDigitizing(job)) return false;
  if (!furComplete(job) || !cutComplete(job)) return false;
  if (!printComplete(job)) return false;
  const stage = getStage(job);
  if (stage === 'SEWING' || stage === 'SEW') return false;
  return true;
}

/** Ready to sew right now (already in sewing). */
export function needsSewing(job) {
  if (isComplete(job)) return false;
  if (job?.sewingSummaryComplete) return false;
  if (excludeFromSewingLoad(job)) return false;
  const stage = getStage(job);
  return stage === 'SEWING' || stage === 'SEW';
}

/**
 * Will need sewing before ship — includes jobs still in digitizing/fur/cut/print/embroidery.
 */
export function willNeedSewing(job) {
  if (isComplete(job)) return false;
  if (job?.sewingSummaryComplete) return false;
  if (excludeFromSewingLoad(job)) return false;
  return true;
}

/**
 * Will need embroidery before sewing — includes upstream jobs not yet embroidered.
 */
export function willNeedEmbroidery(job) {
  if (isComplete(job)) return false;
  if (job?.sewingSummaryComplete) return false;
  const stage = getStage(job);
  if (stage === 'SEWING' || stage === 'SEW') return false;
  return true;
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
      return willNeedEmbroidery(job);
    case 'sewing':
      return willNeedSewing(job);
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

/**
 * Reserve shared daily capacity from the future back to today.
 * Farthest deadlines claim days first (a big Sept 15 sew blocks those days).
 * Work that cannot fit on/after today becomes overflow → days behind.
 */
export function capacityScheduleBackward(items, dailyCapacity, now = new Date()) {
  const today = startOfDay(now);
  const sorted = [...(items || [])].sort((a, b) => {
    const ta = a.deadline?.getTime?.() || 0;
    const tb = b.deadline?.getTime?.() || 0;
    if (tb !== ta) return tb - ta; // latest deadline first
    return (b.work || 0) - (a.work || 0);
  });

  const capLeft = new Map(); // ymd -> remaining capacity that day
  let totalOverflow = 0;
  let bottleneck = null;
  const enriched = [];

  for (const item of sorted) {
    let need = Math.max(0, Number(item.work) || 0);
    let overflow = 0;
    const past = workdaysPastDue(item.deadline, now);

    if (need <= 0 || !item.deadline) {
      enriched.push({
        ...item,
        overflow: 0,
        pastDueWorkdays: past,
        scheduledOk: true,
        risk: past > 0 ? 'late' : 'ok',
      });
      continue;
    }

    // Already past department deadline → entire load is late/overflow
    if (past > 0) {
      overflow = need;
      need = 0;
    } else {
      const cursor = startOfDay(item.deadline);
      let guard = 0;
      while (need > 1e-9 && guard < 800) {
        guard += 1;
        if (!isWorkday(cursor)) {
          cursor.setDate(cursor.getDate() - 1);
          continue;
        }
        if (cursor.getTime() < today.getTime()) {
          overflow += need;
          need = 0;
          break;
        }
        const key = ymd(cursor);
        if (!capLeft.has(key)) capLeft.set(key, dailyCapacity);
        const avail = capLeft.get(key);
        const take = Math.min(avail, need);
        capLeft.set(key, avail - take);
        need -= take;
        cursor.setDate(cursor.getDate() - 1);
      }
      if (need > 1e-9) {
        overflow += need;
        need = 0;
      }
    }

    totalOverflow += overflow;
    const daysThrough = workdaysThrough(item.deadline, now);
    const row = {
      ...item,
      overflow,
      pastDueWorkdays: past,
      scheduledOk: overflow < 1e-9,
      daysThrough,
      risk:
        past > 0 || overflow > 1e-9
          ? 'late'
          : daysThrough > 0 && daysThrough <= COMING_UP_WORKDAYS
          ? 'soon'
          : 'ok',
    };
    enriched.push(row);
    if (overflow > 1e-9 && (!bottleneck || overflow > (bottleneck.overflow || 0))) {
      bottleneck = row;
    }
  }

  const daysBehind = dailyCapacity > 0 ? totalOverflow / dailyCapacity : 0;
  const lateCount = enriched.filter((r) => r.risk === 'late').length;
  const soonCount = enriched.filter((r) => r.risk === 'soon').length;

  return {
    mode: 'capacity',
    maxDeficit: totalOverflow,
    daysBehind: Math.round(daysBehind * 10) / 10,
    bottleneck,
    items: enriched,
    totalWork: (items || []).reduce((s, i) => s + (Number(i.work) || 0), 0),
    lateCount,
    soonCount,
    dailyCapacity,
  };
}

function riskSort(a, b, now) {
  const rank = { late: 0, soon: 1, ok: 2 };
  const ra = rank[a.risk] ?? 2;
  const rb = rank[b.risk] ?? 2;
  if (ra !== rb) return ra - rb;
  const pa = a.pastDueWorkdays ?? workdaysPastDue(a.deadline, now);
  const pb = b.pastDueWorkdays ?? workdaysPastDue(b.deadline, now);
  if (pa !== pb) return pb - pa;
  const oa = a.overflow || 0;
  const ob = b.overflow || 0;
  if (Math.abs(ob - oa) > 1e-9) return ob - oa;
  const dd = (a.deadline?.getTime?.() || 0) - (b.deadline?.getTime?.() || 0);
  if (dd !== 0) return dd;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

/**
 * Deadline-only risk (no shared capacity). Used for digitizing:
 * LATE = past department due date; SOON = due within COMING_UP_WORKDAYS.
 */
export function deadlineRiskOnly(items, now = new Date()) {
  const enriched = (items || []).map((item) => {
    const past = workdaysPastDue(item.deadline, now);
    const daysThrough = workdaysThrough(item.deadline, now);
    return {
      ...item,
      overflow: 0,
      pastDueWorkdays: past,
      scheduledOk: past <= 0,
      daysThrough,
      risk:
        past > 0
          ? 'late'
          : daysThrough > 0 && daysThrough <= COMING_UP_WORKDAYS
          ? 'soon'
          : 'ok',
    };
  });

  return {
    mode: 'deadline',
    maxDeficit: 0,
    daysBehind: 0,
    bottleneck: null,
    items: enriched,
    totalWork: (items || []).reduce((s, i) => s + (Number(i.work) || 0), 0),
    lateCount: enriched.filter((r) => r.risk === 'late').length,
    soonCount: enriched.filter((r) => r.risk === 'soon').length,
    dailyCapacity: null,
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
    if (excludeNonManufactured(job)) continue;
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

    let dailyCapacity = null;
    if (dept === 'sewing') dailyCapacity = SEWING_PCS_PER_DAY;
    else if (dept === 'embroidery') dailyCapacity = EMB_MACHINE_HOURS_PER_DAY;
    else if (dept === 'print') dailyCapacity = PRINT_PCS_PER_DAY;
    else if (dept === 'cut') dailyCapacity = CUT_PCS_PER_DAY;
    else if (dept === 'fur') dailyCapacity = FUR_PCS_PER_DAY;
    // Digitizing: per-job dig due only (no shared 4/day capacity)

    const deadlineOnly = dept === 'digitizing';
    const result = deadlineOnly
      ? deadlineRiskOnly(rows, now)
      : capacityScheduleBackward(rows, dailyCapacity, now);
    result.unit =
      dept === 'digitizing' ? 'designs' : dept === 'embroidery' ? 'mch-hrs' : 'pcs';
    result.dailyCapacity = dailyCapacity;

    const jobCount = rows.length;
    const lateCount = result.lateCount || 0;
    const soonCount = result.soonCount || 0;
    const behind = deadlineOnly ? lateCount > 0 : result.daysBehind > 0.05;

    let headline;
    let subline;
    if (jobCount === 0) {
      headline = '—';
      subline = 'clear';
    } else if (deadlineOnly) {
      if (lateCount > 0) {
        headline = String(lateCount);
        subline = 'past dig due';
      } else if (soonCount > 0) {
        headline = String(soonCount);
        subline = 'due soon';
      } else {
        headline = 'OK';
        subline = `${jobCount} open`;
      }
    } else if (behind) {
      headline = `+${result.daysBehind}d`;
      subline = lateCount ? `${lateCount} late` : 'behind';
    } else if (soonCount > 0) {
      headline = String(soonCount);
      subline = 'due soon';
    } else {
      headline = 'OK';
      subline = 'on pace';
    }

    // Detail list: late + coming up only (not every open job)
    const atRisk = [...(result.items || [])]
      .filter((r) => r.risk === 'late' || r.risk === 'soon')
      .sort((a, b) => riskSort(a, b, now));

    // If nothing at risk, show the next few soonest deadlines so the modal isn't empty when OK
    const nextJobs = (
      atRisk.length
        ? atRisk
        : [...(result.items || [])].sort((a, b) => riskSort(a, b, now)).slice(0, 8)
    ).slice(0, 20);

    let readyNow = 0;
    if (dept === 'sewing') {
      readyNow = rows.filter((r) => needsSewing(r.job)).length;
    } else if (dept === 'embroidery') {
      readyNow = rows.filter((r) => needsEmbroidery(r.job)).length;
    } else if (dept === 'digitizing') {
      readyNow = rows.length;
    } else if (dept === 'fur') {
      readyNow = rows.filter((r) => needsFur(r.job)).length;
    } else if (dept === 'cut') {
      readyNow = rows.filter((r) => needsCut(r.job)).length;
    } else if (dept === 'print') {
      readyNow = rows.filter((r) => needsPrintDept(r.job)).length;
    }

    if (dept === 'sewing' || dept === 'embroidery') {
      if (jobCount === 0) subline = 'clear';
      else if (behind) subline = `behind · ${readyNow} ready now`;
      else if (soonCount > 0) subline = `${soonCount} due soon · ${readyNow} ready`;
      else subline = `on pace · ${readyNow} ready`;
    }

    departments[dept] = {
      id: dept,
      label: DEPT_LABELS[dept],
      ...result,
      pastDueCount: lateCount,
      jobCount,
      readyNow,
      behind,
      headline,
      subline,
      nextJobs,
      forecastsUpstream: dept === 'sewing' || dept === 'embroidery',
    };
  }

  // Floater target: capacity days-behind, or digitizing calendar past-due count
  let focusId = null;
  let bestScore = -Infinity;
  for (const dept of DEPT_ORDER) {
    const d = departments[dept];
    const score =
      d.mode === 'deadline' ? Number(d.lateCount) || 0 : Number(d.daysBehind) || 0;
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
