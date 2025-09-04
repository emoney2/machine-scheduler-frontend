// === Section 1: Imports & Configuration ===
// File: frontend/src/App.js

import Ship from "./Ship";
import React, { useState, useEffect, useRef } from 'react';
import debounce from "lodash.debounce";
import { io } from 'socket.io-client';
import axios from 'axios';
import Inventory from "./Inventory";
import InventoryOrdered from "./InventoryOrdered";
import "./axios-setup";
import Section9 from './Section9';
import OrderSubmission from './OrderSubmission';
import { subWorkDays, fmtMMDD } from './helpers';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import ReorderPage from "./ReorderPage";
import throttle from 'lodash.throttle';
import ShipmentComplete from "./ShipmentComplete";
import BoxSelect from "./BoxSelect";
import Overview from "./Overview";

// console.log('→ REACT_APP_API_ROOT =', process.env.REACT_APP_API_ROOT);

// Time helpers: normalize to ISO (UTC), display in Eastern

function isISO8601Z(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s);
}

// Format a Date/string in America/New_York as "MM/DD h:mm AM/PM"
function fmtET(dtLike) {
  const d = typeof dtLike === "string" ? new Date(dtLike) : dtLike;
  if (!(d instanceof Date) || isNaN(d)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

// Convert "M/D/YYYY H:MM AM/PM" (Eastern local text) → ISO (UTC) safely, DST-aware.
function etDisplayToISO(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/.exec(s?.trim() || "");
  if (!m) return null;
  let [, MM, DD, YYYY, hh, mm, ap] = m;
  const y = +YYYY, mon = +MM, d = +DD, min = +mm;
  let h = (+hh % 12) + (ap === "PM" ? 12 : 0);

  // Build a "naive UTC" ms from the ET wall time
  const naiveUtcMs = Date.UTC(y, mon - 1, d, h, min, 0);

  // Find ET offset (GMT-4 or GMT-5) at that date
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const tzName = dtf.formatToParts(new Date(naiveUtcMs)).find(p => p.type === "timeZoneName")?.value || "GMT-05";
  const m2 = /GMT([+-]\d{1,2})/.exec(tzName);
  const offsetHours = m2 ? parseInt(m2[1], 10) : -5; // -4 or -5
  // ET local + (UTC - ET) => UTC
  const realUtcMs = naiveUtcMs - (offsetHours * 60 * 60 * 1000);

  return new Date(realUtcMs).toISOString();
}

// Normalize the sheet value: return ISO (UTC) no matter what we got.
function normalizeStart(val) {
  if (!val) return null;
  if (isISO8601Z(val)) return val;             // already ISO UTC
  const iso = etDisplayToISO(val);              // ET text → ISO
  if (iso) return iso;
  // Fallback: let JS parse (local), then convert to ISO
  const d = new Date(val);
  return isNaN(d) ? null : d.toISOString();
}


function QuickBooksRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || "/";
    window.location.href = `https://machine-scheduler-backend.onrender.com/quickbooks/login?next=${encodeURIComponent(next)}`;
  }, []);

  return <div>🔁 Redirecting to QuickBooks...</div>;
}

function BoxSelectGuard() {
  const location = useLocation();
  const st = location.state || {};

  // direct state from navigate()
  const picked = Array.isArray(st.selected) ? st.selected
               : Array.isArray(st.selectedIds) ? st.selectedIds
               : null;

  // fallback from sessionStorage (if route state got dropped)
  let persisted = null;
  try {
    persisted = JSON.parse(sessionStorage.getItem("ship.selected") || "null");
  } catch {}

  const fromStore = Array.isArray(persisted?.selected) ? persisted.selected : null;

  const hasSelection = (picked && picked.length > 0) || (fromStore && fromStore.length > 0);

  return hasSelection ? <BoxSelect /> : <Navigate to="/ship" replace />;
}


// send cookies on every API call so Flask session is preserved
axios.defaults.withCredentials = true;

// if any API response is 401, kick the browser to /login
axios.interceptors.response.use(
  resp => resp,
  err => {
    if (err.response && err.response.status === 401) {
      const base = process.env.REACT_APP_API_ROOT.replace(/\/api$/, '');
      const currentPath = window.location.pathname + window.location.search;
      window.location.href = `${base}/login?next=${encodeURIComponent(currentPath)}`;
    }
    return Promise.reject(err);
  }
);

// CONFIGURATION
const API_ROOT      = process.env.REACT_APP_API_ROOT;           // e.g. https://machine-scheduler-backend.onrender.com/api
const SOCKET_ORIGIN = API_ROOT.replace(/\/api$/, '');           // → https://machine-scheduler-backend.onrender.com
const SOCKET_PATH   = '/socket.io';

let socket = null;
try {
  socket = io(SOCKET_ORIGIN, {
    path: SOCKET_PATH,
    transports: ['websocket'], // force native WS
    upgrade: false,            // skip polling->ws upgrade
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 800,
    reconnectionDelayMax: 3000,
    withCredentials: true
  });

  // socket.on("connect",       () => console.log("⚡ socket connected, id =", socket.id));
  // socket.on("disconnect",    (reason) => console.log("🛑 socket disconnected:", reason));
  socket.on("connect_error", (err) => {
    console.warn("🟡 socket connect_error:", err?.message || err);
    window.__SOCKET_DOWN__ = true;
  });
  socket.on("error", (err) => console.warn("🟡 socket error:", err?.message || err));
} catch (e) {
  console.warn("🟡 socket init failed:", e);
  window.__SOCKET_DOWN__ = true;
}

// Optional helper if you emit elsewhere:
const isSocketLive = () => !!(socket && socket.connected);

// WORK HOURS / HOLIDAYS
const WORK_START_HR  = 8;
const WORK_START_MIN = 30;
const WORK_END_HR    = 16;
const WORK_END_MIN   = 30;
const WEEKENDS       = [0,6];
const HOLIDAYS       = ['2025-01-01','2025-12-25'];

// COLOR CONSTANTS
const LIGHT_YELLOW  = '#FFF9C4';
const DARK_YELLOW   = '#FDD835';
const LIGHT_GREY    = '#ECEFF1';
const DARK_GREY     = '#616161';
const LIGHT_PURPLE  = '#E1BEE7';
const DARK_PURPLE   = '#6A1B9A';
const BUBBLE_START  = '#e0f7fa';
const BUBBLE_END    = '#ffe0b2';
const BUBBLE_DELIV  = '#c8e6c9';

export default function App() {
  // Derive backend origin (no /api) for login redirects
  const BACKEND_ORIGIN = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
  const [manualReorder, setManualReorder] = useState(false);

  // NEW: prevent overlapping combined fetches
  const combinedInFlightRef = useRef(false);

  // Log once on mount (optional — keeps your existing console signal)
  useEffect(() => {
    // console.log("🔔 App component mounted");
  }, []);


  // Session check: if not logged in, bounce to backend /login and return here after
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_ROOT}/ping`, {
          method: "GET",
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        });

        if (res.status === 200) {
          // console.log("✅ /api/ping OK (session present)");
          return;
        }

        if (res.status === 401) {
          console.warn("🔒 /api/ping 401 — redirecting to backend login");
          const next = encodeURIComponent(window.location.href);
          window.location.href = `${BACKEND_ORIGIN}/login?next=${next}`;
          return;
        }

        console.warn("⚠️ /api/ping unexpected status:", res.status);
      } catch (err) {
        console.warn("🟡 /api/ping failed:", err?.message || err);
      }
    })();
  }, []);

  // ─── Section 1.5: Auto‐bump setup ────────────────────────────────────────────
  // Track last‐seen top job on each machine
  const prevMachine1Top = useRef({ id: null, ts: 0 });
  const prevMachine2Top = useRef({ id: null, ts: 0 });
  const bumpedJobs = useRef(new Set());

  const prevM1Top = useRef(null);
  const prevM2Top = useRef(null);


  // Send a new start time when needed
  const bumpJobStartTime = async (jobId) => {
    try {
      // If this job already has a valid start, skip
      const findJobById = () => {
        for (const key of ['machine1', 'machine2', 'queue']) {
          const hit = (columns?.[key]?.jobs || []).find(j => j.id === jobId);
          if (hit) return hit;
        }
        return null;
      };

      const existing = findJobById();
      if (existing && normalizeStart(existing.embroidery_start)) {
        // console.log(`⏭️ Job ${jobId} already has start time (${existing.embroidery_start}), skipping`);
        return;
      }
  
      // Clamp to work window: if now is between 4:30 PM and 8:30 AM,
      // snap to *next* 8:30 AM local (uses existing clampToWorkHours)
      const iso = clampToWorkHours(new Date()).toISOString();
      await axios.post(API_ROOT + '/updateStartTime', {
        id: jobId,
        startTime: iso,
      });

      // Optimistically update all columns so UI reflects immediately
      setColumns((cols) => {
        const patch = (jobs) =>
          jobs.map((j) => (j.id === jobId ? { ...j, embroidery_start: iso, start_date: iso } : j));
        return {
          ...cols,
          queue:    { ...cols.queue,    jobs: patch(cols.queue.jobs) },
          machine1: { ...cols.machine1, jobs: patch(cols.machine1.jobs) },
          machine2: { ...cols.machine2, jobs: patch(cols.machine2.jobs) },
        };
      });

      // console.log(`✅ Set start time for ${jobId}: ${fmtET(iso)} ET`);
    } catch (err) {
      console.error('Failed to bump start time', err);
    }
  };

  // live sheet data
  const [orders, setOrders]                 = useState([]);
  const [embroideryList, setEmbroideryList] = useState([]);

  // Persisted placeholders
  const [placeholders, setPlaceholders] = useState(() =>
    JSON.parse(localStorage.getItem('placeholders') || '[]')
  );
  useEffect(() => {
    localStorage.setItem('placeholders', JSON.stringify(placeholders));
  }, [placeholders]);

  // ─── Core columns state, with fixed headCount baked into the title ───────────
  const [columns, setColumns] = useState({
    queue: {
      title: 'Queue',
      jobs: []
    },
    machine1: {
      title: 'Machine 1',  // <-- headCount = 1
      headCount: 1,             // <-- fixed
      jobs: []
    },
    machine2: {
      title: 'Machine 2',  // <-- headCount = 6
      headCount: 6,             // <-- fixed
      jobs: []
    },
  });
  const [links, setLinks]           = useState(() => {
    try { return JSON.parse(localStorage.getItem('jobLinks') || '{}'); }
    catch { return {}; }
  });
  const [syncStatus, setSyncStatus] = useState('');

  // Modal form state
  const [showModal, setShowModal] = useState(false);
  const [ph, setPh] = useState({
    id:          null,
    company:     '',
    quantity:    '',
    stitchCount: '',
    inHand:      '',
    dueType:     'Hard Date'
  });

  // Real-time updates listener
  useEffect(() => {
    const handleUpdate = debounce(() => {
      // console.log("🌐 remote update – re-fetching");
      fetchAllCombined();
    }, 1000);


  socket.on("manualStateUpdated",   handleUpdate);
  socket.on("linksUpdated",         handleUpdate);
  socket.on("placeholdersUpdated",  handleUpdate);
  socket.on("ordersUpdated",        handleUpdate);

    return () => {
  socket.off("manualStateUpdated",   handleUpdate);
  socket.off("linksUpdated",         handleUpdate);
  socket.off("placeholdersUpdated",  handleUpdate);
  socket.off("ordersUpdated",        handleUpdate);
  handleUpdate.cancel();
    };
  }, []);

// Listen for just-startTime updates, splice machine1 only
useEffect(() => {
  const handler = ({ orderId, startTime }) => {
    setColumns(cols => {
      const patch = (jobs) =>
        jobs.map(j => j.id === orderId ? { ...j, embroidery_start: startTime } : j);

      return {
        ...cols,
        queue:    { ...cols.queue,    jobs: patch(cols.queue.jobs) },
        machine1: { ...cols.machine1, jobs: patch(cols.machine1.jobs) },
        machine2: { ...cols.machine2, jobs: patch(cols.machine2.jobs) },
      };
    });
  };

  socket.on("startTimeUpdated", handler);
  return () => socket.off("startTimeUpdated", handler);
}, []);

useEffect(() => {
  const top1 = columns.machine1.jobs?.[0];
  const top2 = columns.machine2.jobs?.[0];

  if (top1?.id !== prevM1Top.current) {
    if (top1?.id && !top1.embroidery_start) {
      // console.log("⏱️ Setting embroidery start time for Machine 1 top job:", top1.id);
      bumpJobStartTime(top1.id);
    }
    prevM1Top.current = top1?.id || null;
  }

  if (top2?.id !== prevM2Top.current) {
    if (top2?.id && !top2.embroidery_start) {
      // console.log("⏱️ Setting embroidery start time for Machine 2 top job:", top2.id);
      bumpJobStartTime(top2.id);
    }
    prevM2Top.current = top2?.id || null;
  }
}, [columns.machine1.jobs, columns.machine2.jobs]);


// === Section 2: Helpers ===
function isHoliday(dt) {
  return dt instanceof Date &&
         !isNaN(dt) &&
         HOLIDAYS.includes(dt.toISOString().slice(0,10));
}

function isWorkday(dt) {
  return dt instanceof Date &&
         !isNaN(dt) &&
         !WEEKENDS.includes(dt.getDay()) &&
         !isHoliday(dt);
}

function clampToWorkHours(dt) {
  let d = new Date(dt);
  while (
    !isWorkday(d) ||
    d.getHours() < WORK_START_HR ||
    (d.getHours() === WORK_START_HR && d.getMinutes() < WORK_START_MIN)
  ) {
    d.setDate(d.getDate() + 1);
    d.setHours(WORK_START_HR, WORK_START_MIN, 0, 0);
  }
  if (
    d.getHours() > WORK_END_HR ||
    (d.getHours() === WORK_END_HR && d.getMinutes() >= WORK_END_MIN)
  ) {
    d.setDate(d.getDate() + 1);
    d.setHours(WORK_START_HR, WORK_START_MIN, 0, 0);
    return clampToWorkHours(d);
  }
  return d;
}

function addWorkTime(start, ms) {
  let remaining = ms;
  let current   = clampToWorkHours(start);
  while (remaining > 0) {
    const endOfDay = new Date(current);
    endOfDay.setHours(WORK_END_HR, WORK_END_MIN, 0, 0);
    const free = endOfDay.getTime() - current.getTime();
    if (free <= 0) {
      current = clampToWorkHours(new Date(current.setDate(current.getDate() + 1)));
    } else if (remaining <= free) {
      current   = new Date(current.getTime() + remaining);
      remaining = 0;
    } else {
      remaining -= free;
      current    = new Date(endOfDay);
    }
  }
  return current;
}

function fmtDT(dtLike) {
  const d = typeof dtLike === "string" ? new Date(dtLike) : dtLike;
  if (!(d instanceof Date) || isNaN(d)) return "";

  // Render in UTC so it matches Google Sheet's ISO Z entries
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}


// Parse "Embroidery Start Time" from the sheet into a reliable ISO string
function parseEmbroideryStart(val) {
  if (val == null || val === '') return '';

  // Accept ISO (with or without a stray space before T)
  if (typeof val === 'string') {
    let s = val.trim().replace(/\s*T\s*/, 'T');
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;

    // M/D/YYYY H:MM AM/PM
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      let [, mo, da, yr, hh, mm, ap] = m;
      mo=+mo; da=+da; yr=+yr; hh=+hh; mm=+mm;
      if (/pm/i.test(ap) && hh < 12) hh += 12;
      if (/am/i.test(ap) && hh === 12) hh = 0;
      const dt = new Date(yr, mo - 1, da, hh, mm, 0, 0);
      return isNaN(dt) ? '' : dt.toISOString();
    }

    // M/D H:MM AM/PM  (assume current year)
    m = s.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      let [, mo, da, hh, mm, ap] = m;
      const yr = new Date().getFullYear();
      mo=+mo; da=+da; hh=+hh; mm=+mm;
      if (/pm/i.test(ap) && hh < 12) hh += 12;
      if (/am/i.test(ap) && hh === 12) hh = 0;
      const dt = new Date(yr, mo - 1, da, hh, mm, 0, 0);
      return isNaN(dt) ? '' : dt.toISOString();
    }

    // Fallback
    const dt = new Date(s);
    return isNaN(dt) ? '' : dt.toISOString();
  }

  // Google/Sheets numeric date serial
  if (typeof val === 'number' && isFinite(val)) {
    const ms = Math.round((val - 25569) * 86400000); // 1899-12-30 epoch
    return new Date(ms).toISOString();
  }

  // Final fallback
  const dt = new Date(val);
  return isNaN(dt) ? '' : dt.toISOString();
}



function parseDueDate(d) {
  if (d === null || d === undefined || d === '') return null;

  // Already a Date?
  if (d instanceof Date) return isNaN(d) ? null : d;

  // Google/Sheets serial date (number)
  if (typeof d === 'number' && isFinite(d)) {
    const base = new Date(1899, 11, 30); // Excel/Sheets epoch
    const dt = new Date(base.getTime() + d * 24 * 60 * 60 * 1000);
    return isNaN(dt) ? null : dt;
  }

  const s = String(d).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s);

  const parts = s.split(/[\/\-]/);
  if (parts.length >= 2) {
    const mo = +parts[0], da = +parts[1];
    const yr = parts.length >= 3 ? +parts[2] : new Date().getFullYear();
    if (!isNaN(mo) && !isNaN(da) && !isNaN(yr)) {
      const dt = new Date(yr, mo - 1, da);
      return isNaN(dt) ? null : dt;
    }
  }

  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}


function addWorkDays(start, days) {
  let d = new Date(start), added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (isWorkday(d)) added++;
  }
  return d;
}

function subWorkDays(start, days) {
  let d = new Date(start), removed = 0;
  while (removed < days) {
    d.setDate(d.getDate() - 1);
    if (isWorkday(d)) removed++;
  }
  return d;
}

function fmtMMDD(d) {
  const dt = new Date(d);
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return mo + '/' + da;
}

function fmtMMDD(d) {
  const dt = new Date(d);
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return mo + '/' + da;
}

// === Artwork / Image Helpers ===
function extractDriveId(url) {
  if (!url) return '';
  try {
    const m1 = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m1) return m1[1];
    const idParam = new URL(url).searchParams.get('id');
    if (idParam) return idParam;
  } catch (_) {}
  return '';
}

// === Artwork / Image Helpers ===
function extractDriveId(url) {
  if (!url) return '';
  try {
    const m1 = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m1) return m1[1];
    const idParam = new URL(url).searchParams.get('id');
    if (idParam) return idParam;
  } catch (_) {}
  return '';
}

// Use backend thumbnail proxy (thumb=1) with a slightly larger size for better clarity
function toPreviewUrl(originalUrl, v) {
  if (!originalUrl) return '';
  const id = extractDriveId(originalUrl);
  if (!id) {
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(originalUrl)) return originalUrl;
    return '';
  }
  let url = `${API_ROOT}/drive/proxy/${id}?thumb=1&sz=w240`;
  if (v) url += `&v=${encodeURIComponent(v)}`; // versioned → immutable cache
  return url;
}


// Full-view URL (original quality / inline display)
function toFullViewUrl(originalUrl) {
  if (!originalUrl) return '';
  const id = extractDriveId(originalUrl);
  return id ? `${API_ROOT}/drive/proxy/${id}?thumb=0` : originalUrl;
}

// Click handler to open full-view in a new tab
function openArtwork(originalUrl) {
  const url = toFullViewUrl(originalUrl);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}


function sortQueue(arr) {
  return [...arr].sort((a, b) => {
    const da = parseDueDate(a.due_date);
    const db = parseDueDate(b.due_date);
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
}

// === Section 3: Scheduling & Late (using embroidery_start) ===
function scheduleMachineJobs(jobs, machineKey = '') {
  const BUFFER_MS = 30 * 60 * 1000;

  // Accept either a label ("Machine 1 (1)") or a number (1 or 6)
  let headCount = 6;
  if (typeof machineKey === 'number') {
    headCount = Number(machineKey) || 6;
  } else if (String(machineKey).toLowerCase().includes('(1)')) {
    headCount = 1;
  }

  // console.log(`🧵 Scheduling for ${machineKey} → ${headCount} heads`);
  let prevEnd = null;

  return jobs.map((job, idx) => {
    // 1) Compute late cutoff for this job
    const due = parseDueDate(job.due_date);
    let cutoff = null;
    if (due) {
      const eedDay = subWorkDays(due, 6);
      cutoff = new Date(eedDay);
      cutoff.setHours(WORK_END_HR, WORK_END_MIN, 0, 0);
    }
    // 2) Determine start time
    let startIso = null;
    let start;

    if (idx === 0) {
      // Top job: use sheet start if present, else actual now (no clamp)
      const sheetIso = job.embroidery_start ? normalizeStart(job.embroidery_start) : null;
      if (sheetIso) {
        startIso = sheetIso;
        start = new Date(sheetIso);
      } else {
        start = new Date();
        startIso = start.toISOString();
      }
    } else {
      // Job 1..N: always chain from previous job's end + 30 min buffer
      const base = (prevEnd instanceof Date && !isNaN(prevEnd)) ? prevEnd : new Date();
      const buffered = new Date(base.getTime() + BUFFER_MS);
      start = clampToWorkHours(buffered);
      startIso = start.toISOString();
    }

    // Persist ISO on the job for consistent display/calcs
    job.start_date = startIso;


    // 3) Calculate end time based on stitches and head count
    const qty = job.quantity % headCount === 0
      ? job.quantity
      : Math.ceil(job.quantity / headCount) * headCount;

    const stitches = job.stitch_count > 0 ? job.stitch_count : 30000;
    const runMs    = (stitches / 35000) * (qty / headCount) * 3600000;

    const end = addWorkTime(start, runMs);

    // 4) Assign computed times to job (overwrite existing values)
    job._rawStart = start;
    job._rawEnd   = end;
    job.start     = fmtET(start);
    job.end       = fmtET(end);
    job.delivery  = fmtMMDD(addWorkDays(end, 6));
    job.isLate = cutoff instanceof Date && !isNaN(cutoff) && end > cutoff;

    // 5) Advance tracker
    prevEnd = end;

    return job;
  });
}

// === Section 4: Link Utilities ===
function loadLinks() {
  try {
    return JSON.parse(localStorage.getItem('jobLinks') || '{}');
  } catch {
    return {};
  }
}

function saveLinks(map) {
  localStorage.setItem('jobLinks', JSON.stringify(map));
}

function getChain(jobs, id) {
  const fwd = {}, rev = {};
  jobs.forEach(j => {
    if (j.linkedTo) {
      fwd[j.id]    = j.linkedTo;
      rev[j.linkedTo] = j.id;
    }
  });

  // find root of the chain
  let root = id;
  while (rev[root]) {
    root = rev[root];
  }

  // build the chain array
  const chain = [];
  let cur = root;
  while (cur) {
    chain.push(cur);
    cur = fwd[cur];
  }
  return chain;
}

  // ─── Section 5: Fetch Helpers + Combined Fetch Each 20 Seconds ─────────────────

  // Two flags (for the top status bar if you have one):
  // • isLoading = true whenever any fetch is in flight
  // • hasError   = true if the most recent fetch attempt failed
  const [isLoading, setIsLoading] = useState(false);
  const [hasError,   setHasError]   = useState(false);

// ─── Step 5A: “Core” fetchOrdersEmbroLinks – build columns based on latest orders/embroidery/links
const fetchOrdersEmbroLinksCore = async () => {
  // console.log('fetchOrdersEmbroLinksCore ▶ start');
  setIsLoading(true);
  setHasError(false);

  try {
    // 1) Fetch everything in a single round-trip
    const combinedRes = await axios.get(API_ROOT + '/combined');
    const ordersRes   = { data: combinedRes.data?.orders || [] };
    const embRes      = { data: combinedRes.data?.embroideryList || [] };
    const linksRes    = { data: combinedRes.data?.links || {} };


    // 2) Prepare orders array, filter out completed
    let orders = (ordersRes.data || []).filter(
      o => (o['Stage'] || '').toLowerCase() !== 'complete'
    );
    const embList = embRes.data || [];
    let linksData = linksRes.data || {};

    // 3) Filter out any doNotRelink entries
    const doNotRelink = JSON.parse(localStorage.getItem('doNotRelink') || '[]');
    linksData = Object.fromEntries(
      Object.entries(linksData)
        .filter(([key, val]) =>
          !doNotRelink.includes(key) && !doNotRelink.includes(val)
        )
    );

    // 4) Build a map of all jobs (orders only)
    const jobById = {};
    const driveIdsToPublicize = [];

    orders.forEach(o => {
      const sid = String(o['Order #'] || '').trim();
      if (!sid) return;

      // Persisted start time (from Production Orders)
      const persistedStart = parseEmbroideryStart(o['Embroidery Start Time']);

      // Artwork link (from Production Orders → Image)
      const rawImageLink = o['Image'] || '';
      const fileId = extractDriveId(rawImageLink);
      if (fileId) driveIdsToPublicize.push(fileId);

      jobById[sid] = {
        id:               sid,
        company:          o['Company Name'] || '',
        product:          o['Product'] || '',
        design:           o['Design'] || '',
        quantity:         +o['Quantity'] || 0,
        stitch_count:     +o['Stitch Count'] || 0,
        due_date:         o['Due Date'] || '',
        due_type:         o['Hard Date/Soft Date'] || '',
        embroidery_start: persistedStart,
        start_date:       persistedStart,
        status:           o['Stage'] || '',
        threadColors:     o['Threads'] || '',
        imageLink:        rawImageLink,
        imageFileId:      fileId || '',
        // artworkUrl is set AFTER we fetch version tokens
        machineId:        'queue',
        linkedTo:         linksData[sid] || null
      };
    });

    // 5) Fetch version tokens for unique Drive file IDs and set artworkUrl
    let versionById = {};
    const uniqueIds = Array.from(new Set(driveIdsToPublicize));
    if (uniqueIds.length) {
      try {
        const { data } = await axios.post(API_ROOT + '/drive/metaBatch', { ids: uniqueIds });
        versionById = data?.versions || {};
      } catch (err) {
        console.error('drive/metaBatch failed', err);
      }
    }

    // 5b) Kick off server pre-warm, but DON'T await it
    try {
      const pairs = uniqueIds
        .map(id => ({ id, v: versionById[id] || '', sz: 'w240' }))
        .filter(p => p.v);
      if (pairs.length) {
        axios.post(API_ROOT + '/drive/warmThumbnails', { pairs }).catch(() => {});
      }
    } catch {
      // ignore
    }



    // Fill artworkUrl now that we have versions
    Object.values(jobById).forEach(job => {
      if (!job.imageFileId) {
        // non-Drive link or empty
        job.artworkUrl = toPreviewUrl(job.imageLink, '');
      } else {
        const v = versionById[job.imageFileId] || '';
        job.artworkUrl = toPreviewUrl(job.imageLink, v);
      }
    });

    // 6) Initialize newCols from current columns (retaining headCount)
    const newCols = {
      queue:    { ...columns.queue,    jobs: [] },
      machine1: { ...columns.machine1, jobs: [] },
      machine2: { ...columns.machine2, jobs: [] },
    };

    // 7) Preserve any manual placements
    columns.machine1.jobs.forEach(job => {
      if (jobById[job.id]) jobById[job.id].machineId = 'machine1';
    });
    columns.machine2.jobs.forEach(job => {
      if (jobById[job.id]) jobById[job.id].machineId = 'machine2';
    });

    // 8) Distribute jobs into newCols
    Object.values(jobById).forEach(job => {
      if (job.machineId === 'machine1') {
        job.machineId = 'Machine 1 (1)';
        newCols['machine1'].jobs.push(job);
      } else if (job.machineId === 'machine2') {
        job.machineId = 'Machine 2'; // (kept as-is per your current code)
        newCols['machine2'].jobs.push(job);
      } else {
        newCols.queue.jobs.push(job);
      }
    });

    // 9) Sort queue by due_date
    newCols.queue.jobs.sort((a, b) => {
      const da = parseDueDate(a.due_date);
      const db = parseDueDate(b.due_date);
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return 0;
    });

    // 10) Re-run scheduleMachineJobs with machine labels so head counts are correct
    newCols.machine1.jobs = scheduleMachineJobs(newCols.machine1.jobs, 'Machine 1 (1)');
    newCols.machine2.jobs = scheduleMachineJobs(newCols.machine2.jobs, 'Machine 2 (6)');

    // 11) Return the updated columns
    return newCols;
  } catch (err) {
    console.error('❌ fetchOrdersEmbroLinksCore error', err);
    setHasError(true);
    return columns;
  } finally {
    setIsLoading(false);
  }
};
// ─── Section 5B: fetchManualState only ───────────────────────────────────────────
const fetchManualStateCore = async (previousCols) => {
  // console.log('fetchManualStateCore ▶ start');
  try {
    // 1) Fetch manualState from server (note no extra '/api' prefix)
    const { data: msData } = await axios.get(API_ROOT + '/manualState');
    //    msData = { machineColumns: [ [...], [...] ], placeholders: [...] }

    // 2) Overwrite local placeholders state
    setPlaceholders(msData.placeholders || []);

    // 3) Extract machine1 & machine2 IDs
    const cols        = msData.machineColumns || [];
    const machine1Ids = cols[0] || [];
    const machine2Ids = cols[1] || [];

    // 4) Start mergedCols from previousCols
    const mergedCols = {
      queue:    { ...previousCols.queue,    jobs: [...previousCols.queue.jobs] },
      machine1: { ...previousCols.machine1, jobs: [] },
      machine2: { ...previousCols.machine2, jobs: [] },
    };

    // 5) Remove completed & placeholder jobs from machine1/machine2
    ['machine1','machine2'].forEach(colId => {
      mergedCols[colId].jobs = previousCols[colId].jobs.filter(job =>
        !msData.placeholders.some(p => p.id === job.id) &&
        String(job.status || '').toLowerCase() !== 'complete'
      );
    });

    // 6) Re-inject placeholders into machine1 (in saved order)
    machine1Ids.forEach(jobId => {
      const idx = mergedCols.queue.jobs.findIndex(j => j.id === jobId);
      if (idx !== -1) {
        const [jobObj] = mergedCols.queue.jobs.splice(idx, 1);
        mergedCols.machine1.jobs.push(jobObj);
      }
    });

    // 7) Re-inject placeholders into machine2
    machine2Ids.forEach(jobId => {
      const idx = mergedCols.queue.jobs.findIndex(j => j.id === jobId);
      if (idx !== -1) {
        const [jobObj] = mergedCols.queue.jobs.splice(idx, 1);
        mergedCols.machine2.jobs.push(jobObj);
      }
    });

    // 7.5) Re-inject any placeholders meant to stay in the queue
    msData.placeholders.forEach(ph => {
      const onM1 = machine1Ids.includes(ph.id);
      const onM2 = machine2Ids.includes(ph.id);
      if (!onM1 && !onM2 && !mergedCols.queue.jobs.some(j => j.id === ph.id)) {
        mergedCols.queue.jobs.push(ph);
      }
    });

    // 7.6) Sort the queue by due date
    mergedCols.queue.jobs.sort((a, b) => {
      const da = new Date(a.dueDate || a.delivery || 0);
      const db = new Date(b.dueDate || b.delivery || 0);
      return da - db;
    });

    // 8) Re-run scheduling on machines using machineKey
    mergedCols.machine1.jobs = scheduleMachineJobs(
      mergedCols.machine1.jobs,
      'Machine 1 (1)'
    );
    mergedCols.machine2.jobs = scheduleMachineJobs(
      mergedCols.machine2.jobs,
      'Machine 2 (6)'
    );

    // console.log('fetchManualStateCore ▶ done');
    return mergedCols;

  } catch (err) {
    console.error('❌ fetchManualStateCore error', err);
    throw err;
  }
};

  // ─── Section 5C: Combined “fetchAll” that first loads orders/embroidery/links, THEN applies manualState ─────
  const fetchAllCombined = async () => {
    // Prevent overlapping requests
    if (combinedInFlightRef.current) {
      // console.log('⏭️ fetchAllCombined skipped (in flight)');
      return;
    }
    combinedInFlightRef.current = true;

    // console.log('fetchAllCombined ▶ start');
    setIsLoading(true);
    setHasError(false);

    try {
      // 1) First, build new columns from orders/embroidery/links only
      const colsAfterOrders = await fetchOrdersEmbroLinksCore();

      // 2) Then, apply manualState on top of that to enforce placeholders & machine1/machine2 order
      const colsAfterManual = await fetchManualStateCore(colsAfterOrders);

      // 3) Finally, commit to React state
      setColumns(colsAfterManual);

      // 🔥 DO NOT manually re-patch embroidery_start — we only update that on drag/drop
      // console.log('fetchAllCombined ▶ done');
      setHasError(false);
    } catch (err) {
      console.error('❌ fetchAllCombined error', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
      combinedInFlightRef.current = false;
    }
  };


  // ─── Section 5D: On mount, do one combined fetch; then every 20 s do the same combined fetch ─────────────
  useEffect(() => {
    // console.log("📡 Initial load: combined fetchAllCombined()");

    // 1) Run immediately on mount
    fetchAllCombined();

    // 2) Set up the 5-minute polling WITHOUT modifying start times
    const handle = setInterval(() => {
      // console.log("⏳ Poll: combined fetchAllCombined()");
      fetchAllCombined();
    }, 300000); // 5 minutes

    return () => clearInterval(handle);
  }, []);

  const handleSync = async () => {
    setSyncStatus('');
    await fetchAllCombined();
    setSyncStatus('updated');
    setTimeout(() => setSyncStatus(''), 2000);
  };

// ─── Section 5E: Always ensure top jobs have a start time (no clamp) ───
useEffect(() => {
  const maybeBump = (top, ref) => {
    // If no top job, clear the tracker and bail
    if (!top?.id) { ref.current = null; return; }

    // Does this top job already have a parseable start?
    const hasStart = !!normalizeStart(top.embroidery_start);

    // If it doesn't, and we haven't bumped this job before this session, do it.
    if (!hasStart && !bumpedJobs.current.has(top.id)) {
      // console.log("⏱️ Setting embroidery start time for top job:", top.id);
      bumpedJobs.current.add(top.id);
      bumpJobStartTime(top.id); // posts /updateStartTime and patches UI optimistically
    }

    // Track the current top id (in case you need it elsewhere)
    ref.current = top.id;
  };

  // Check both machines each time the lists change
  maybeBump(columns?.machine1?.jobs?.[0], prevM1Top);
  maybeBump(columns?.machine2?.jobs?.[0], prevM2Top);
}, [columns?.machine1?.jobs, columns?.machine2?.jobs]);



// === Section 6: Placeholder Management ===

// Populate edit modal
const editPlaceholder = (job) => {
  setPh(job);
  setShowModal(true);
};

// Add or update a placeholder and persist to server
const submitPlaceholder = async (e) => {
  if (e?.preventDefault) e.preventDefault();

  let updated, newPh;

  if (ph.id) {
    // editing existing
    updated = placeholders.map(p => p.id === ph.id ? ph : p);
  } else {
    // creating new
    newPh = {
      id:           `ph-${Date.now()}`,
      company:      ph.company,
      quantity:     Number(ph.quantity),
      stitchCount:  Number(ph.stitchCount),
      inHand:       ph.inHand,
      dueType:      ph.dueType,
      start:        '',
      end:          '',
      delivery:     '',
      isLate:       false,
      linkedTo:     null,
      machineId:    'queue',
      threadColors: ''
    };
    updated = [...placeholders, newPh];
  }

  // 1) persist full manual state
  const manualState = {
    machine1:     columns.machine1.jobs.map(j => j.id),
    machine2:     columns.machine2.jobs.map(j => j.id),
    placeholders: updated
  };
  try {
    await axios.post(API_ROOT + '/manualState', manualState);
    setPlaceholders(updated);

    // 2) re-fetch authoritative combined state
    await fetchAllCombined();

  } catch (err) {
    console.error("Error saving placeholder:", err);
  }

  // 3) close modal & reset form
  setShowModal(false);
  setPh({ id:null, company:'', quantity:'', stitchCount:'', inHand:'', dueType:'Hard Date' });
};

// Remove placeholder
const removePlaceholder = async (id) => {
  // 1) compute new placeholders list
  const cleaned = placeholders.filter(p => p.id !== id);
  setPlaceholders(cleaned);

  // 2) persist updated manual state
  const manualState = {
    machine1:     columns.machine1.jobs.map(j => j.id),
    machine2:     columns.machine2.jobs.map(j => j.id),
    placeholders: cleaned
  };
  try {
    await axios.post(API_ROOT + '/manualState', manualState);

    // 3) re-fetch authoritative combined state
    await fetchAllCombined();

  } catch (err) {
    console.error("Error removing placeholder:", err);
  }
};

// === Section 7: toggleLink (with “do-not-relink” logic) ===

// A helper that persists our “do-not-relink” set in localStorage
const addToDoNotRelink = (jobId) => {
  const existing = JSON.parse(localStorage.getItem('doNotRelink') || '[]');
  if (!existing.includes(jobId)) {
    localStorage.setItem('doNotRelink', JSON.stringify([...existing, jobId]));
  }
};

const toggleLink = async (colId, idx) => {
  const jobs = Array.from(columns[colId].jobs);
  const job  = jobs[idx];
  const next = jobs[idx + 1];

  // Build a new links map
  const newLinks = { ...links };
  if (job.linkedTo === next?.id) {
    // unlink: RECORD this jobId so we don't re‐link it on refresh
    delete newLinks[job.id];
    addToDoNotRelink(job.id);
  } else if (next) {
    // link: ensure it's not marked “do not relink”
    const doNot = JSON.parse(localStorage.getItem('doNotRelink') || '[]');
    if (!doNot.includes(job.id)) {
      newLinks[job.id] = next.id;
    }
  }

  // Persist to server
  try {
    await axios.post(API_ROOT + '/links', newLinks);
  } catch (err) {
    console.error('❌ failed to save links to server', err);
  }

  // Update local state immediately
  setLinks(newLinks);

  // Reflect in the UI
  jobs[idx] = { ...job, linkedTo: newLinks[job.id] || null };
  setColumns((cols) => ({
    ...cols,
    [colId]: { ...cols[colId], jobs },
  }));
};


// === Section 8: Drag & Drop Handler (with Chain-aware Moves & shared manualState + placeholders) ===
function updatePrevTopRef(prevRef, oldTop, newTop) {
  if (oldTop !== newTop) {
    // Clear the old reference if the top job changed
    prevRef.current = { id: null, ts: 0 };
  }
}

// Heuristic: jobs that should NOT be treated as draggables (adjust to your schema if needed)
function isNonDraggable(job) {
  return job?.placeholder === true || job?.isPlaceholder === true || job?.type === 'placeholder';
}

// Convert a react-beautiful-dnd visual index (counts only draggables) to an index in the full array
function visualToActualIndex(fullList, visualIdx) {
  let seen = 0;
  for (let i = 0; i < fullList.length; i++) {
    if (!isNonDraggable(fullList[i])) {
      if (seen === visualIdx) return i;
      seen++;
    }
  }
  return fullList.length; // append if visualIdx is at/after the end
}

const onDragEnd = async (result) => {
  // 🔍 DEBUGGING INSTRUMENTATION
  // console.log("🔍 DRAG-END result:", result);
  // console.log("🔍 BEFORE COLUMNS:", JSON.stringify(columns, null, 2));

  const { source, destination, draggableId } = result;
  if (!destination) {
    // console.log("→ No destination, aborting");
    return;
  }

  const srcCol = source.droppableId;
  const dstCol = destination.droppableId;
  const srcIdxVisual = source.index;       // visual index among draggables
  const dstIdxVisual = destination.index;  // visual index among draggables

  if (srcCol === dstCol && srcIdxVisual === dstIdxVisual) return;

  // 1) Extract the full chain from the source column
  const srcJobs = Array.from(columns[srcCol].jobs);
  const chainIds = getChain(srcJobs, draggableId);
  const chainJobs = chainIds.map(id => srcJobs.find(j => j.id === id));

  // Remove chain from source list (works against the full list incl. placeholders)
  const newSrcJobs = srcJobs.filter(j => !chainIds.includes(j.id));

  // 2) If reordering within the same column:
  if (srcCol === dstCol) {
    // Translate destination index from visual → actual within this list
    const insertAt = visualToActualIndex(newSrcJobs, dstIdxVisual);

    // Insert the already-removed chain back into this same list
    newSrcJobs.splice(insertAt, 0, ...chainJobs);

    // Remember the manual order you intended (by IDs, in the full list order)
    const desiredOrder = newSrcJobs.map(j => j.id);

    // Compute times/metadata, but **don’t** let scheduling change order
    const scheduled = srcCol === 'queue'
      ? sortQueue(newSrcJobs)
      : scheduleMachineJobs(
          newSrcJobs,
          srcCol === 'machine1' ? 'Machine 1 (1)' : 'Machine 2 (6)'
        );

    // 🔒 Preserve the manual order you just set
    const indexOf = new Map(desiredOrder.map((id, i) => [id, i]));
    const updatedJobs = [...scheduled].sort(
      (a, b) => (indexOf.get(a.id) ?? 1e9) - (indexOf.get(b.id) ?? 1e9)
    );

    // 2a) Update local state
    setColumns(cols => ({
      ...cols,
      [srcCol]: { ...cols[srcCol], jobs: updatedJobs }
    }));

    // 2b) Persist manual ordering back to the server
    const nextCols = {
      ...columns,
      [srcCol]: { ...columns[srcCol], jobs: updatedJobs }
    };

    const oldTop1 = columns.machine1.jobs[0]?.id || null;
    const oldTop2 = columns.machine2.jobs[0]?.id || null;
    const newTop1 = nextCols.machine1.jobs[0]?.id || null;
    const newTop2 = nextCols.machine2.jobs[0]?.id || null;

    updatePrevTopRef(prevMachine1Top, oldTop1, newTop1);
    updatePrevTopRef(prevMachine2Top, oldTop2, newTop2);
    prevMachine1Top.current = newTop1;
    prevMachine2Top.current = newTop2;

    const manualState = {
      machine1: nextCols.machine1.jobs.map(j => j.id),
      machine2: nextCols.machine2.jobs.map(j => j.id),
      placeholders
    };
    try {
      await axios.post(API_ROOT + '/manualState', manualState);
    } catch (err) {
      console.error('❌ manualState save failed (same-col reorder)', err);
    }

    setManualReorder(true);
    return;
  }

  // 3) Cross-column move: build the destination jobs array
  const dstJobs = Array.from(columns[dstCol].jobs);
  const movedJobs = chainJobs.map(job => ({
    ...job,
    machineId: dstCol === 'queue' ? 'queue' : dstCol,
    ...(dstCol === 'queue' && {
      start: '', end: '', delivery: '',
      _rawStart: null, _rawEnd: null,
      isLate: false, linkedTo: null
    })
  }));

  // Translate visual destination index → actual array index in destination
  const insertAt = visualToActualIndex(dstJobs, dstIdxVisual);
  dstJobs.splice(insertAt, 0, ...movedJobs);

  // 4) If dropping into queue, unlink the chain from links
  if (dstCol === 'queue') {
    const pruned = { ...links };
    chainIds.forEach(id => delete pruned[id]);
    Object.keys(pruned).forEach(key => {
      if (chainIds.includes(pruned[key])) delete pruned[key];
    });
    saveLinks(pruned);
    setLinks(pruned);
  }

  // 5) Assemble and reschedule all columns
  const nextCols = {
    ...columns,
    [srcCol]: { ...columns[srcCol], jobs: newSrcJobs },
    [dstCol]: { ...columns[dstCol], jobs: dstJobs }
  };

  const machineKeyLabels = {
    machine1: 'Machine 1 (1)',
    machine2: 'Machine 2 (6)'
  };

  // ─── reset the “previous top” refs so handleTopChange sees no change ───
  prevMachine1Top.current = nextCols.machine1.jobs[0]?.id || null;
  prevMachine2Top.current = nextCols.machine2.jobs[0]?.id || null;

  // Compute times (or any scheduling metadata)
  ['machine1', 'machine2'].forEach(machine => {
    nextCols[machine].jobs = scheduleMachineJobs(
      nextCols[machine].jobs,
      machineKeyLabels[machine]
    );
  });

  // 🔒 Preserve manual order for machine columns after scheduling
  if (srcCol !== 'queue') {
    const srcDesired = newSrcJobs.map(j => j.id);
    const srcIndex = new Map(srcDesired.map((id, i) => [id, i]));
    nextCols[srcCol].jobs = [...nextCols[srcCol].jobs].sort(
      (a, b) => (srcIndex.get(a.id) ?? 1e9) - (srcIndex.get(b.id) ?? 1e9)
    );
  }
  if (dstCol !== 'queue') {
    const dstDesired = dstJobs.map(j => j.id);
    const dstIndex = new Map(dstDesired.map((id, i) => [id, i]));
    nextCols[dstCol].jobs = [...nextCols[dstCol].jobs].sort(
      (a, b) => (dstIndex.get(a.id) ?? 1e9) - (dstIndex.get(b.id) ?? 1e9)
    );
  }

  // Always keep queue sorted by your rule
  nextCols.queue.jobs = sortQueue(nextCols.queue.jobs);

  // update state
  setColumns(nextCols);
  // console.log('⏹ onDragEnd end (cross-col), new columns:', nextCols);

  // 6) Persist the shared manualState to backend **including placeholders**
  const manualState = {
    machine1: nextCols.machine1.jobs.map(j => j.id),
    machine2: nextCols.machine2.jobs.map(j => j.id),
    placeholders
  };
  // console.log('⏹ Persisting manualState (cross-col) to server:', manualState);
  try {
    await axios.post(API_ROOT + '/manualState', manualState);
    // console.log('✅ manualState saved (cross-col)');
  } catch (err) {
    console.error('❌ manualState save failed (cross-col)', err);
  }

  // Trigger top-of-list start-time update effect
  setManualReorder(true);
};

// Add debugging logs to inspect the state of the queue column
useEffect(() => {
  console.log("Queue column before sorting:", columns.queue.jobs);
  const sortedQueue = sortQueue(columns.queue.jobs);
  console.log("Queue column after sorting:", sortedQueue);
}, [columns.queue.jobs]);

// === Section 9: Render via Section9.jsx ===

  return (
    <>
      {/* ─── Status Bar ───────────────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '4px',
          width: '100%',
          backgroundColor: (isLoading || hasError) ? 'yellow' : 'green',
          zIndex: 1000
        }}
      />

      {/* ─── Nav Bar ────────────────────────────────────────────────────────── */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 8,
          backgroundColor: '#fafafa',
          borderBottom: '1px solid #ccc'
        }}
      >
        {[
          { to: "/Overview",          label: "Overview" },
          { to: "/",                  label: "Scheduler" },
          { to: "/submit",            label: "Order Submission" },
          { to: "/inventory",         label: "Inventory" },
          { to: "/inventory-ordered", label: "Inventory Ordered" },
          { to: "/ship",              label: "Ship" }
        ].map(({ to, label }) => (
          <NavLink key={to} to={to} style={({ isActive }) => ({
            padding: '0.5rem 1rem',
            textDecoration: 'none',
            color: '#333',
            fontWeight: isActive ? '600' : '400',
            borderBottom: isActive ? '2px solid #333' : 'none'
          })}>
            {label}
          </NavLink>
        ))}


        {/* ← push this button as far right as possible */}
        <button
          onClick={() => {
            // redirect to backend logout endpoint
            const base = process.env.REACT_APP_API_ROOT.replace(/\/api$/, '');
            window.location.href = `${base}/logout`;
          }}
          style={{
            marginLeft: 'auto',
            padding: '0.5rem 1rem',
            border: '1px solid transparent',
            background: 'transparent',
            cursor: 'pointer',
            color: '#333',
            fontWeight: '400'
          }}
        >
          Logout
        </button>
      </nav>

      {/* ─── Route Outlet ─────────────────────────────────────────────────────── */}
      <Routes>
        <Route
          path="/"
          element={
            <Section9
              columns={columns}
              setColumns={setColumns}
              handleSync={handleSync}
              syncStatus={syncStatus}
              showModal={showModal}
              setShowModal={setShowModal}
              onDragEnd={onDragEnd}
              getChain={getChain}
              toggleLink={toggleLink}
              editPlaceholder={editPlaceholder}
              removePlaceholder={removePlaceholder}
              ph={ph}
              setPh={setPh}
              submitPlaceholder={submitPlaceholder}
              LIGHT_YELLOW={LIGHT_YELLOW}
              DARK_YELLOW={DARK_YELLOW}
              LIGHT_GREY={LIGHT_GREY}
              DARK_GREY={DARK_GREY}
              LIGHT_PURPLE={LIGHT_PURPLE}
              DARK_PURPLE={DARK_PURPLE}
              BUBBLE_START={BUBBLE_START}
              BUBBLE_END={BUBBLE_END}
              BUBBLE_DELIV={BUBBLE_DELIV}
              toPreviewUrl={toPreviewUrl}
              openArtwork={openArtwork}  
            />
          }
        />
        <Route path="/overview" element={<Overview />} />
        <Route path="/submit" element={<OrderSubmission />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory-ordered" element={<InventoryOrdered />} />
        <Route path="/ship" element={<Ship />} />
        {/* 🔒 Hidden page — only reachable when Ship passes selected jobs via location.state */}
        <Route path="/box-select" element={<BoxSelectGuard />} />
        <Route path="/reorder" element={<ReorderPage />} />
        <Route path="/order" element={<OrderSubmission />} />
        <Route path="/quickbooks/login" element={<QuickBooksRedirect />} />
        <Route path="/shipment-complete" element={<ShipmentComplete />} />
      </Routes>
    </>
  );
}
