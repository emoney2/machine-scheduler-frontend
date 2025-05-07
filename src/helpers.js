// File: frontend/src/helpers.js

// Parse a due‐date string (YYYY-MM-DD or MM/DD[/YYYY]) into a Date or null
export function parseDueDate(d) {
  if (!d) return null;
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d);
  // MM/DD[/YYYY]
  const parts = d.split('/');
  if (parts.length >= 2) {
    const mo = +parts[0], da = +parts[1],
          yr = parts.length === 3 ? +parts[2] : new Date().getFullYear();
    if (!isNaN(mo) && !isNaN(da) && !isNaN(yr)) return new Date(yr, mo-1, da);
  }
  // Fallback
  const dt = new Date(d);
  return isNaN(dt) ? null : dt;
}

// Subtract a given number of work-days (skipping weekends and holidays)
export function subWorkDays(start, days) {
  let d = new Date(start), removed = 0;
  const WEEKENDS = [0, 6];
  const HOLIDAYS = ['2025-01-01','2025-12-25'];
  function isHoliday(dt) {
    return HOLIDAYS.includes(dt.toISOString().slice(0,10));
  }
  function isWorkday(dt) {
    return !WEEKENDS.includes(dt.getDay()) && !isHoliday(dt);
  }

  while (removed < days) {
    d.setDate(d.getDate() - 1);
    if (isWorkday(d)) removed++;
  }
  return d;
}

// Format a Date (or date‐string) as MM/DD
export function fmtMMDD(d) {
  const dt = new Date(d);
  const mo = String(dt.getMonth() + 1).padStart(2,'0');
  const da = String(dt.getDate()).padStart(2,'0');
  return `${mo}/${da}`;
}
