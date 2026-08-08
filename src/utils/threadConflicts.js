/**
 * Concurrent thread-cone conflict detection for multi-head embroidery scheduling.
 *
 * Rule: a machine needs `headCount` cones of a color mounted to run that color.
 * Machine 1 (1 head) → 1 cone; Machines 2–4 (6 heads) → 6 cones each.
 * If overlapping jobs on different machines need the same color, cones add up.
 */

const MACHINE_KEYS = ['machine1', 'machine2', 'machine3', 'machine4'];

const MACHINE_TITLES = {
  machine1: 'Machine 1',
  machine2: 'Machine 2',
  machine3: 'Machine 3',
  machine4: 'Machine 4',
};

/** Default Madeira pod size when recommending a purchase */
export const CONE_POD_SIZE = 6;

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseThreadCodes(raw) {
  if (Array.isArray(raw)) {
    return raw.map((c) => String(c).trim()).filter(Boolean);
  }
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter((c) => /^\d{4}$/.test(c) || c.length > 0)
    .filter(Boolean);
}

/**
 * @param {Record<string, any>} columns
 * @returns {Array<{
 *   id: string,
 *   company: string,
 *   design: string,
 *   product: string,
 *   machineKey: string,
 *   machineTitle: string,
 *   headCount: number,
 *   start: Date,
 *   end: Date,
 *   colors: string[],
 *   due_date: any,
 *   due_type: string,
 *   isLate: boolean,
 * }>}
 */
export function collectScheduledJobs(columns) {
  if (!columns || typeof columns !== 'object') return [];
  const out = [];

  for (const machineKey of MACHINE_KEYS) {
    const col = columns[machineKey];
    if (!col) continue;
    const headCount = Number(col.headCount) > 0 ? Number(col.headCount) : machineKey === 'machine1' ? 1 : 6;
    const machineTitle = col.title || MACHINE_TITLES[machineKey] || machineKey;
    const jobs = Array.isArray(col.jobs) ? col.jobs : [];

    for (const job of jobs) {
      if (!job || job.id == null) continue;
      // Placeholders / empty thread lists cannot create cone conflicts
      const isPh = String(job.id).startsWith('ph-') || job.isPlaceholder;
      if (isPh) continue;

      const start = toDate(job._rawStart || job.start_date || job.start);
      const end = toDate(job._rawEnd || job.end);
      if (!(start instanceof Date) || !(end instanceof Date) || !(end > start)) continue;

      const colors = parseThreadCodes(job.threadColors ?? job.Threads ?? '');
      if (!colors.length) continue;

      out.push({
        id: String(job.id),
        company: String(job.company || job['Company Name'] || ''),
        design: String(job.design || job.Design || ''),
        product: String(job.product || job.Product || ''),
        machineKey,
        machineTitle,
        headCount,
        start,
        end,
        colors,
        due_date: job.due_date ?? job['Due Date'] ?? '',
        due_type: String(job.due_type ?? job['Hard Date/Soft Date'] ?? ''),
        isLate: !!job.isLate,
      });
    }
  }

  return out;
}

function toDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (v == null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Normalize inventory map entries to { inventory, onOrder, status }.
 * Accepts legacy string statuses or detail objects.
 */
export function normalizeInventoryMap(rawMap) {
  const map = {};
  if (!rawMap || typeof rawMap !== 'object') return map;
  for (const [code, raw] of Object.entries(rawMap)) {
    const key = String(code).trim();
    if (!key) continue;
    if (typeof raw === 'string') {
      map[key] = { status: raw, inventory: raw === 'green' ? 6 : 0, onOrder: raw === 'yellow' ? 6 : 0 };
      // string-only maps have no cone counts — mark unknown
      map[key].conesKnown = false;
      continue;
    }
    if (raw && typeof raw === 'object') {
      const inventory = Number(raw.inventory ?? raw.Inventory ?? raw.quantity ?? 0);
      const onOrder = Number(raw.onOrder ?? raw.on_order ?? raw['On Order'] ?? 0);
      let status = raw.status;
      if (!status) {
        if (inventory > 0) status = 'green';
        else if (onOrder > 0 && inventory + onOrder > 0) status = 'yellow';
        else status = 'red';
      }
      map[key] = {
        status,
        inventory: Number.isFinite(inventory) ? inventory : 0,
        onOrder: Number.isFinite(onOrder) ? onOrder : 0,
        conesKnown: true,
      };
    }
  }
  return map;
}

/**
 * Available physical cones for loading machines now.
 * On-order cones are NOT counted (cannot mount what has not arrived).
 */
export function availableCones(invEntry) {
  if (!invEntry) return 0;
  const n = Number(invEntry.inventory);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Detect concurrent cone conflicts across scheduled machines.
 *
 * @param {Record<string, any>} columns - scheduler columns with scheduled jobs
 * @param {Record<string, any>} inventoryRaw - from /api/thread-inventory-status
 * @returns {{
 *   conflicts: Array<Conflict>,
 *   byJobId: Record<string, Conflict[]>,
 *   buyRecommendations: Array<BuyRec>,
 *   summary: { conflictCount: number, jobCount: number, buyCount: number }
 * }}
 *
 * Conflict shape:
 * {
 *   id, color, peakConesNeeded, availableCones, shortfall,
 *   conesToBuy, preferBuy, preferReschedule,
 *   windowStart, windowEnd,
 *   jobs: [...],
 *   suggestions: string[]
 * }
 */
export function detectThreadConflicts(columns, inventoryRaw) {
  const inventory = normalizeInventoryMap(inventoryRaw);
  const scheduled = collectScheduledJobs(columns);

  /** @type {Map<string, typeof scheduled>} */
  const byColor = new Map();
  for (const job of scheduled) {
    for (const color of job.colors) {
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(job);
    }
  }

  const conflicts = [];

  for (const [color, jobsForColor] of byColor) {
    if (jobsForColor.length < 2) continue;

    // Sweep-line: peak concurrent cone demand for this color
    const events = [];
    for (const j of jobsForColor) {
      events.push({ t: j.start.getTime(), delta: j.headCount, job: j, kind: 'start' });
      events.push({ t: j.end.getTime(), delta: -j.headCount, job: j, kind: 'end' });
    }
    events.sort((a, b) => a.t - b.t || (a.kind === 'end' ? -1 : 1) - (b.kind === 'end' ? -1 : 1));

    let activeCones = 0;
    let peakCones = 0;
    /** @type {Set<string>} */
    let activeJobIds = new Set();
    /** @type {typeof scheduled} */
    let peakJobs = [];
    let peakWindowStart = null;
    let peakWindowEnd = null;

    // Also track current active set for window bounds
    /** @type {Map<string, typeof scheduled[0]>} */
    const activeMap = new Map();

    for (const ev of events) {
      if (ev.kind === 'end') {
        activeCones += ev.delta;
        activeMap.delete(ev.job.id);
        activeJobIds.delete(ev.job.id);
        continue;
      }
      activeCones += ev.delta;
      activeMap.set(ev.job.id, ev.job);
      activeJobIds.add(ev.job.id);

      if (activeCones > peakCones) {
        peakCones = activeCones;
        peakJobs = Array.from(activeMap.values());
        peakWindowStart = ev.job.start;
        // window end = earliest end among active
        let minEnd = Infinity;
        for (const aj of peakJobs) {
          if (aj.end.getTime() < minEnd) minEnd = aj.end.getTime();
        }
        peakWindowEnd = new Date(minEnd);
      }
    }

    // Need at least two machines overlapping to be a concurrency issue
    const distinctMachines = new Set(peakJobs.map((j) => j.machineKey));
    if (peakCones <= 0 || distinctMachines.size < 2) continue;

    const invEntry = inventory[color];
    const avail = invEntry?.conesKnown === false
      ? // Legacy string status without counts: green ⇒ assume at least one machine (6), else 0
        (invEntry?.status === 'green' ? 6 : 0)
      : availableCones(invEntry);

    if (peakCones <= avail) continue;

    const shortfall = peakCones - avail;
    const conesToBuy = Math.ceil(shortfall / CONE_POD_SIZE) * CONE_POD_SIZE;

    // Competing jobs: all jobs for this color that overlap the peak window (or each other)
    const competing = [];
    const seen = new Set();
    for (const j of jobsForColor) {
      const overlapsPeak =
        peakWindowStart &&
        peakWindowEnd &&
        intervalsOverlap(j.start, j.end, peakWindowStart, peakWindowEnd);
      const inPeak = peakJobs.some((p) => p.id === j.id);
      if (!overlapsPeak && !inPeak) continue;
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      competing.push(j);
    }
    // Fallback: use peak jobs
    const jobsList = competing.length ? competing : peakJobs;

    const preferBuy = shouldPreferBuy(jobsList, distinctMachines.size);
    const suggestions = buildSuggestions({
      color,
      jobs: jobsList,
      avail,
      peakCones,
      shortfall,
      conesToBuy,
      preferBuy,
    });

    conflicts.push({
      id: `color-${color}-${peakWindowStart ? peakWindowStart.getTime() : 0}`,
      color,
      peakConesNeeded: peakCones,
      availableCones: avail,
      onOrderCones: invEntry ? Math.max(0, Math.floor(Number(invEntry.onOrder) || 0)) : 0,
      shortfall,
      conesToBuy,
      preferBuy,
      preferReschedule: !preferBuy,
      windowStart: peakWindowStart,
      windowEnd: peakWindowEnd,
      jobs: jobsList
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((j) => ({
          id: j.id,
          company: j.company,
          design: j.design,
          product: j.product,
          machineKey: j.machineKey,
          machineTitle: j.machineTitle,
          headCount: j.headCount,
          conesNeeded: j.headCount,
          start: j.start.toISOString(),
          end: j.end.toISOString(),
          due_date: j.due_date,
          due_type: j.due_type,
          isLate: j.isLate,
        })),
      suggestions,
    });
  }

  // Sort: buy-first, then largest shortfall
  conflicts.sort((a, b) => {
    if (a.preferBuy !== b.preferBuy) return a.preferBuy ? -1 : 1;
    return b.shortfall - a.shortfall;
  });

  /** @type {Record<string, typeof conflicts>} */
  const byJobId = {};
  for (const c of conflicts) {
    for (const j of c.jobs) {
      if (!byJobId[j.id]) byJobId[j.id] = [];
      byJobId[j.id].push(c);
    }
  }

  const buyRecommendations = conflicts
    .filter((c) => c.preferBuy && c.conesToBuy > 0)
    .map((c) => ({
      color: c.color,
      conesToBuy: c.conesToBuy,
      shortfall: c.shortfall,
      availableCones: c.availableCones,
      peakConesNeeded: c.peakConesNeeded,
      jobIds: c.jobs.map((j) => j.id),
      reason: buyReason(c),
      label: `${c.color} (Polyneon) - ${c.conesToBuy} Cones`,
    }));

  // Also surface non-urgent shortfalls as "optional buy" for Overview
  const optionalBuy = conflicts
    .filter((c) => !c.preferBuy && c.conesToBuy > 0)
    .map((c) => ({
      color: c.color,
      conesToBuy: c.conesToBuy,
      shortfall: c.shortfall,
      availableCones: c.availableCones,
      peakConesNeeded: c.peakConesNeeded,
      jobIds: c.jobs.map((j) => j.id),
      reason: 'Schedule around this shortage if possible; buy only if reordering would hurt due dates.',
      label: `${c.color} (Polyneon) - ${c.conesToBuy} Cones`,
      optional: true,
    }));

  return {
    conflicts,
    byJobId,
    buyRecommendations,
    optionalBuy,
    summary: {
      conflictCount: conflicts.length,
      jobCount: Object.keys(byJobId).length,
      buyCount: buyRecommendations.length,
    },
    computedAt: new Date().toISOString(),
  };
}

function shouldPreferBuy(jobs, machineCount) {
  if (machineCount >= 3) return true;
  const now = Date.now();
  const DAY = 86400000;
  for (const j of jobs) {
    if (j.isLate) return true;
    const due = toDate(j.due_date);
    const hard = /hard/i.test(String(j.due_type || ''));
    if (hard && due && due.getTime() - now < 14 * DAY) return true;
    if (due && due.getTime() - now < 7 * DAY) return true;
  }
  return false;
}

function buyReason(conflict) {
  const late = conflict.jobs.filter((j) => j.isLate).map((j) => j.id);
  if (late.length) {
    return `Late or at-risk jobs (${late.join(', ')}) share color ${conflict.color}; buying avoids further delay.`;
  }
  if (conflict.jobs.length >= 3 || new Set(conflict.jobs.map((j) => j.machineKey)).size >= 3) {
    return `Color ${conflict.color} peaks across ${new Set(conflict.jobs.map((j) => j.machineKey)).size} machines — hard to schedule around.`;
  }
  return `Hard/near due dates make rescheduling around color ${conflict.color} difficult.`;
}

function buildSuggestions({ color, jobs, avail, peakCones, shortfall, conesToBuy, preferBuy }) {
  const suggestions = [];
  const sorted = jobs.slice().sort((a, b) => a.start - b.start);
  if (sorted.length >= 2) {
    const a = sorted[0];
    const b = sorted[1];
    suggestions.push(
      `Run sequentially: finish #${a.id} on ${a.machineTitle} before starting #${b.id} on ${b.machineTitle} (both need ${color}).`
    );
  }
  if (sorted.length >= 2) {
    suggestions.push(
      `Reorder machine queues so jobs using ${color} do not overlap in time.`
    );
  }
  // Machine move hint: if one job is on a 6-head and another could wait in queue
  const sixHead = sorted.filter((j) => j.headCount >= 6);
  if (sixHead.length >= 2) {
    suggestions.push(
      `Keep only one 6-head machine on ${color} at a time (need ${avail} on hand; peak asks for ${peakCones}).`
    );
  }
  if (conesToBuy > 0) {
    if (preferBuy) {
      suggestions.push(
        `Recommended buy: ${conesToBuy} cones of ${color} (short ${shortfall}; order in pods of ${CONE_POD_SIZE}).`
      );
    } else {
      suggestions.push(
        `Optional buy: ${conesToBuy} cones of ${color} if you cannot reshuffle without missing due dates.`
      );
    }
  }
  return suggestions;
}

const STORAGE_KEY = 'threadScheduleConflicts.v1';

export function persistThreadConflicts(result) {
  try {
    const payload = {
      ...result,
      // Dates already ISO on jobs; keep serializable
      persistedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('threadScheduleConflictsUpdated', { detail: payload }));
    }
  } catch (_) {
    /* ignore quota */
  }
}

export function loadPersistedThreadConflicts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function formatConflictWindow(isoStart, isoEnd) {
  const fmt = (iso) => {
    const d = toDate(iso);
    if (!d) return '—';
    return d.toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };
  return `${fmt(isoStart)} → ${fmt(isoEnd)}`;
}
