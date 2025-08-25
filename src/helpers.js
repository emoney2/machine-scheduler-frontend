// File: frontend/src/helpers.js

// Excel/Google Sheets serial epoch (1899-12-30)
const EXCEL_EPOCH = new Date(1899, 11, 30);

// Parse a date-like (Date | number | string) into a Date or null
export function parseDueDate(d) {
  if (d === null || d === undefined || d === '') return null;

  // Already a Date?
  if (d instanceof Date) return isNaN(d) ? null : d;

  // Sheets/Excel serial number
  if (typeof d === 'number' && isFinite(d)) {
    const dt = new Date(EXCEL_EPOCH.getTime() + d * 24 * 60 * 60 * 1000);
    return isNaN(dt) ? null : dt;
  }

  // Coerce to string
  const s = String(d).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD (allow optional time)
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s)) {
    const dt = new Date(s.slice(0, 10));
    return isNaN(dt) ? null : dt;
  }

  // MM/DD[/YYYY] or M-D[-YYYY]
  const parts = s.split(/[\/\-]/);
  if (parts.length >= 2) {
    const mo = +parts[0], da = +parts[1];
    const yr = parts.length >= 3 ? +parts[2] : new Date().getFullYear();
    if (!isNaN(mo) && !isNaN(da) && !isNaN(yr)) {
      const dt = new Date(yr, mo - 1, da);
      return isNaN(dt) ? null : dt;
    }
  }

  // Last resort
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}

// Subtract a given number of work-days (skipping weekends/holidays)
export function subWorkDays(start, days) {
  const base = parseDueDate(start) || new Date(start);
  let d = (base instanceof Date && !isNaN(base)) ? new Date(base) : new Date();
  let removed = 0;
  const WEEKENDS = [0, 6];
  const HOLIDAYS = new Set(['2025-01-01', '2025-12-25']);

  const isWorkday = (dt) =>
    !WEEKENDS.includes(dt.getDay()) &&
    !HOLIDAYS.has(dt.toISOString().slice(0, 10));

  while (removed < days) {
    d.setDate(d.getDate() - 1);
    if (isWorkday(d)) removed++;
  }
  return d;
}

// Format a Date-like as MM/DD
export function fmtMMDD(d) {
  const dt = d instanceof Date ? d : parseDueDate(d);
  if (!(dt instanceof Date) || isNaN(dt)) return '';
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

// Safe CSV splitter: accepts string | number | null | array
export function splitCSV(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  }
  if (value === null || value === undefined) return [];
  const s = String(value).trim();
  if (!s) return [];
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}
