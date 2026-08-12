/**
 * Thread-cone conflict detection for multi-head embroidery scheduling.
 *
 * Ignores schedule times. Only 6-head machines (Machine 2–4) are considered —
 * Machine 1 single cones are not tracked in inventory the same way.
 * If the same color is on two or more 6-head machines, cones needed = 6 × machines.
 * Yellow conflict when on-hand cones cannot cover that.
 * Buy recommendations always round up to pods of 6.
 */

/** Only multi-head machines — Machine 1 (1-head) is excluded */
const MACHINE_KEYS = ['machine2', 'machine3', 'machine4'];

const MACHINE_TITLES = {
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
 * Jobs assigned to machine columns (not queue). Times are not used.
 */
export function collectScheduledJobs(columns) {
  if (!columns || typeof columns !== 'object') return [];
  const out = [];

  for (const machineKey of MACHINE_KEYS) {
    const col = columns[machineKey];
    if (!col) continue;
    const headCount = Number(col.headCount) > 0 ? Number(col.headCount) : 6;
    // Single-head inventory is not tracked — skip anything under 6 heads
    if (headCount < 6) continue;
    const machineTitle = col.title || MACHINE_TITLES[machineKey] || machineKey;
    const jobs = Array.isArray(col.jobs) ? col.jobs : [];

    for (const job of jobs) {
      if (!job || job.id == null) continue;
      const isPh = String(job.id).startsWith('ph-') || job.isPlaceholder;
      if (isPh) continue;

      const colors = parseThreadCodes(job.threadColors ?? job.Threads ?? '');
      if (!colors.length) continue;

      out.push({
        id: String(job.id),
        company: String(job.company || job['Company Name'] || ''),
        design: String(job.design || job.Design || ''),
        product: String(job.product || job.Product || ''),
        machineKey,
        machineTitle,
        headCount: 6, // always one full 6-cone set per 6-head machine
        colors,
        due_date: job.due_date ?? job['Due Date'] ?? '',
        due_type: String(job.due_type ?? job['Hard Date/Soft Date'] ?? ''),
        isLate: !!job.isLate,
        imageLink: String(job.imageLink || job.Image || job['Art Link'] || ''),
        artworkUrl: String(job.artworkUrl || ''),
        imageFileId: String(job.imageFileId || ''),
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

/**
 * Normalize inventory map entries to { inventory, onOrder, status }.
 */
export function normalizeInventoryMap(rawMap) {
  const map = {};
  if (!rawMap || typeof rawMap !== 'object') return map;
  for (const [code, raw] of Object.entries(rawMap)) {
    const key = String(code).trim();
    if (!key) continue;
    if (typeof raw === 'string') {
      map[key] = {
        status: raw,
        inventory: raw === 'green' ? 6 : 0,
        onOrder: raw === 'yellow' ? 6 : 0,
        conesKnown: false,
      };
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

export function availableCones(invEntry) {
  if (!invEntry) return 0;
  const n = Number(invEntry.inventory);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Same color on 2+ machines + not enough cones → conflict.
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

    /** @type {Map<string, { machineKey: string, machineTitle: string, headCount: number }>} */
    const machines = new Map();
    for (const j of jobsForColor) {
      if (!machines.has(j.machineKey)) {
        machines.set(j.machineKey, {
          machineKey: j.machineKey,
          machineTitle: j.machineTitle,
          headCount: j.headCount,
        });
      }
    }

    if (machines.size < 2) continue;

    const peakCones = Array.from(machines.values()).reduce((sum, m) => sum + m.headCount, 0);

    const invEntry = inventory[color];
    const avail =
      invEntry?.conesKnown === false
        ? invEntry?.status === 'green'
          ? 6
          : 0
        : availableCones(invEntry);

    if (peakCones <= avail) continue;

    const shortfall = peakCones - avail;
    // Always buy in pods of 6 (never recommend 1–5 cones)
    const conesToBuy = Math.max(
      CONE_POD_SIZE,
      Math.ceil(shortfall / CONE_POD_SIZE) * CONE_POD_SIZE
    );
    const jobsList = jobsForColor.slice();
    const preferBuy = shouldPreferBuy(jobsList, machines.size);
    const suggestions = buildSuggestions({
      color,
      jobs: jobsList,
      machines: Array.from(machines.values()),
      avail,
      peakCones,
      shortfall,
      conesToBuy,
      preferBuy,
    });

    conflicts.push({
      id: `color-${color}`,
      color,
      peakConesNeeded: peakCones,
      availableCones: avail,
      onOrderCones: invEntry ? Math.max(0, Math.floor(Number(invEntry.onOrder) || 0)) : 0,
      shortfall,
      conesToBuy,
      preferBuy,
      preferReschedule: !preferBuy,
      machineCount: machines.size,
      jobs: jobsList
        .slice()
        .sort((a, b) => a.machineKey.localeCompare(b.machineKey) || a.id.localeCompare(b.id))
        .map((j) => ({
          id: j.id,
          company: j.company,
          design: j.design,
          product: j.product,
          machineKey: j.machineKey,
          machineTitle: j.machineTitle,
          headCount: j.headCount,
          conesNeeded: j.headCount,
          due_date: j.due_date,
          due_type: j.due_type,
          isLate: j.isLate,
          imageLink: j.imageLink || '',
          artworkUrl: j.artworkUrl || '',
          imageFileId: j.imageFileId || '',
        })),
      suggestions,
    });
  }

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

  const optionalBuy = conflicts
    .filter((c) => !c.preferBuy && c.conesToBuy > 0)
    .map((c) => ({
      color: c.color,
      conesToBuy: c.conesToBuy,
      shortfall: c.shortfall,
      availableCones: c.availableCones,
      peakConesNeeded: c.peakConesNeeded,
      jobIds: c.jobs.map((j) => j.id),
      reason: 'Keep these jobs on different machines only if you buy more cones, or run them one machine at a time.',
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
  if (conflict.machineCount >= 3) {
    return `Color ${conflict.color} is on ${conflict.machineCount} machines — hard to schedule around.`;
  }
  return `Hard/near due dates make keeping color ${conflict.color} on one machine at a time difficult.`;
}

function buildSuggestions({ color, jobs, machines, avail, peakCones, shortfall, conesToBuy, preferBuy }) {
  const suggestions = [];
  const machineNames = machines.map((m) => m.machineTitle).join(' and ');
  const jobBits = jobs.map((j) => `#${j.id} (${j.machineTitle})`).join(', ');

  suggestions.push(
    `${color} is on ${machines.length} machines (${machineNames}): ${jobBits}.`
  );
  suggestions.push(
    `Need ${peakCones} cones to load those machines at once; you have ${avail} on hand.`
  );
  suggestions.push(
    `Run jobs with ${color} on one machine at a time, or move one job so they are not on different machines together.`
  );

  if (conesToBuy > 0) {
    if (preferBuy) {
      suggestions.push(
        `Recommended buy: ${conesToBuy} cones of ${color} (short ${shortfall}; order in pods of ${CONE_POD_SIZE}).`
      );
    } else {
      suggestions.push(
        `Optional buy: ${conesToBuy} cones of ${color} if you want those machines to run ${color} at the same time.`
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

/** @deprecated Times are no longer used; kept for older Overview snapshots. */
export function formatConflictWindow() {
  return '';
}

export function formatConflictMachines(conflict) {
  if (!conflict?.jobs?.length) return '';
  const machines = [...new Set(conflict.jobs.map((j) => j.machineTitle))];
  const jobs = conflict.jobs.map((j) => `#${j.id}`).join(', ');
  return `${machines.join(' + ')} · ${jobs}`;
}
