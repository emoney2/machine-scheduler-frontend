// === Section 1: Imports & Configuration ===
// File: frontend/src/App.js

import Scan from "./Scan";
import Material from "./Material";
import Departments from "./Departments";
import MaterialLog from "./MaterialLog";
import CutList from "./CutList";
import Ship from "./Ship";
import FurList from "./FurList";
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
import DigitizingList from "./DigitizingList";

function isWeekend(d) {
  const day = d.getDay(); // 0=Sun,6=Sat
  return day === 0 || day === 6;
}

function nextBusinessDay(d) {
  const out = new Date(d);
  while (isWeekend(out)) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}

/**
 * For UI only: Given an ISO start (the exact moment it was stamped),
 * show 8:30 AM local on the same day if that time is after the stamp,
 * else the NEXT business day at 8:30 AM.
 */
function displayClampTo830(iso) {
  if (!iso) return "";
  const raw = new Date(iso);

  // 8:30 AM local on that stamp's date
  const d830 = new Date(raw);
  d830.setHours(8, 30, 0, 0);

  let show = raw <= d830 ? d830 : nextBusinessDay(new Date(raw.setDate(raw.getDate() + 1)));
  // ensure 8:30 on the chosen day
  show.setHours(8, 30, 0, 0);
  // if that lands on a weekend, push to next weekday 8:30
  while (isWeekend(show)) {
    show.setDate(show.getDate() + 1);
    show.setHours(8, 30, 0, 0);
  }
  return show;
}




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
// Provide a safe default to avoid crashes if REACT_APP_API_ROOT isn't set in Netlify.

const RAW_API_ROOT  = process.env.REACT_APP_API_ROOT || '';
const API_ROOT      = RAW_API_ROOT || 'https://machine-scheduler-backend.onrender.com/api';
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
  const BACKEND_ORIGIN = API_ROOT.replace(/\/api$/, "");
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

  // (Legacy; safe if referenced elsewhere)
  const bumpedJobs = useRef(new Set());

  // NEW: prevent duplicate concurrent POSTs per job
  const bumpInFlight = useRef(new Set());

  // Which route are we on? (Scheduler is at "/")
  const location = useLocation();
  const isScheduler = location.pathname === "/";

  const prevM1Top = useRef(null);
  const prevM2Top = useRef(null);

  // Send a new start time when needed
  // >>> REPLACE your entire bumpJobStartTime with this <<<
  // Posts a real "now" timestamp for the top job's Order #
  // (No overwrite: server is idempotent and will no-op if already set)
  const bumpJobStartTime = async (jobId) => {
    try {
      // Find the job by id across both machines and the queue
      const findJobById = () => {
        for (const key of ["machine1", "machine2", "queue"]) {
          const hit = (columns?.[key]?.jobs || []).find((j) => j.id === jobId);
          if (hit) return hit;
        }
        return null;
      };

      const job = findJobById();
      if (!job) return;

      // If this job already has a start in the sheet, do nothing
      const hasStart = !!job.embroidery_start;
      if (hasStart) return;

      // Resolve Order # (adjust fallback fields if yours differ)
      const orderNumber = String(
        job?.order ?? job?.order_number ?? job?.orderNo ?? ""
      ).trim();
      if (!orderNumber) return;

      // Use actual current moment (ISO). Sheet keeps raw ISO; UI clamps to 8:30 for display only.
      const iso = new Date().toISOString();

      await axios.post(`${API_ROOT}/updateStartTime`, {
        orderNumber,
        startTime: iso,
      });
    } catch (err) {
      console.error("Failed to bump start time", err);
      // Swallow; the watcher will retry on next refresh
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
    if (!isScheduler) return;

    fetchAllCombined();

    const handle = setInterval(() => {
      fetchAllCombined();
    }, 15000);

    return () => clearInterval(handle);
  }, [isScheduler]);



// Listen for just-startTime updates, splice machine1 only
useEffect(() => {
  if (!socket) return;

  const onStartTimeUpdated = () => {
    // Re-fetch from backend so the UI reflects the new timestamp immediately
    fetchAllCombined();
  };

  socket.on("startTimeUpdated", onStartTimeUpdated);
  return () => socket.off("startTimeUpdated", onStartTimeUpdated);
}, [socket]);

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

// fmtMMDD and subWorkDays are imported from './helpers' — remove local duplicates.

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
// Public Drive thumbnails directly — no backend proxy.
// Keep one consistent size for caching & speed.
function toPreviewUrl(originalUrl /*, v */) {
  if (!originalUrl) return '';
  const id = extractDriveId(originalUrl);
  if (!id) {
    // If it's already a direct image URL, just use it.
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(originalUrl)) return originalUrl;
    return '';
  }
  return `https://drive.google.com/thumbnail?id=${id}&sz=w160`;
}

// Full view: open the original link if it’s already a direct image,
// otherwise use Drive’s inline viewer (no proxy).
function toFullViewUrl(originalUrl /*, v */) {
  if (!originalUrl) return '';
  const id = extractDriveId(originalUrl);
  if (!id) return originalUrl;
  // Use Drive file viewer URL
  return `https://drive.google.com/file/d/${id}/view`;
}



function openArtwork(originalUrl, v) {
  const url = toFullViewUrl(originalUrl, v);
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

// Cache Drive versions client-side so we don't re-fetch them every refresh
const metaVersionsRef = useRef(
  (() => {
    try { return JSON.parse(localStorage.getItem('driveVerCache') || '{}'); }
    catch { return {}; }
  })()
);
const saveDriveVerCache = () => {
  try { localStorage.setItem('driveVerCache', JSON.stringify(metaVersionsRef.current)); }
  catch {}
};


// ─── Section 5: Fetch Helpers + Combined Fetch Each 20 Seconds ─────────────────

// Two flags (for the top status bar if you have one):
// • isLoading = true whenever any fetch is in flight
// • hasError   = true if the most recent fetch attempt failed
const [isLoading, setIsLoading] = useState(false);
const [hasError,   setHasError]   = useState(false);

// NEW: show a yellow overlay on Scheduler while manualState is loading
const [isManualLoading, setIsManualLoading] = useState(false);

// One-at-a-time background worker for Drive meta versions
const metaWorkerBusyRef = useRef(false);
const pendingMetaIdsRef = useRef(new Set());
const inflightMetaIdsRef = useRef(new Set()); // avoid re-requesting IDs already being fetched

const kickMetaWorker = () => {
  if (metaWorkerBusyRef.current) return;
  metaWorkerBusyRef.current = true;

  const run = async () => {
    // Pull & clear the current queue
    const ids = Array.from(pendingMetaIdsRef.current);
    pendingMetaIdsRef.current.clear();
    if (!ids.length) { metaWorkerBusyRef.current = false; return; }

    // Fetch in small chunks
    const versionsBatch = {};
    const chunkSize = 20; // smaller chunks return faster/more reliably

    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = ids.slice(i, i + chunkSize);

      // Mark these as inflight so we don't enqueue them again mid-flight
      batch.forEach(id => inflightMetaIdsRef.current.add(id));

      try {
        const { data } = await axios.post(
          API_ROOT + '/drive/metaBatch',
          { ids: batch },
          { timeout: 20000 } // client > server(4s) — prevents 10s client-side cancels
        );
        if (data && data.versions) Object.assign(versionsBatch, data.versions);
      } catch (e) {
        console.warn('metaBatch worker chunk skipped:', e?.message || e);
      } finally {
        // Always clear inflight markers for this chunk
        batch.forEach(id => inflightMetaIdsRef.current.delete(id));
      }
    }

    // Save any new versions locally
    if (Object.keys(versionsBatch).length) {
      Object.entries(versionsBatch).forEach(([id, v]) => {
        if (v) metaVersionsRef.current[id] = v;
      });
      saveDriveVerCache();

      // Upgrade artwork URLs in place
      setColumns(prev => {
        if (!prev) return prev;
        const next = {
          queue:    { ...prev.queue,    jobs: [...prev.queue.jobs]    },
          machine1: { ...prev.machine1, jobs: [...prev.machine1.jobs] },
          machine2: { ...prev.machine2, jobs: [...prev.machine2.jobs] },
        };
        const upgrade = (job) => {
          if (!job?.imageFileId) return;
          const v = metaVersionsRef.current[job.imageFileId];
          if (!v) return;
          const newUrl = toPreviewUrl(job.imageLink, v);
          if (newUrl && newUrl !== job.artworkUrl) job.artworkUrl = newUrl;
        };
        next.queue.jobs.forEach(upgrade);
        next.machine1.jobs.forEach(upgrade);
        next.machine2.jobs.forEach(upgrade);
        return next;
      });
    }

    metaWorkerBusyRef.current = false;

    // If new IDs arrived while we worked, run again after idle
    if (pendingMetaIdsRef.current.size) {
      const defer = window.requestIdleCallback || ((fn) => setTimeout(fn, 600));
      defer(run);
    }
  };

  const defer = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
  defer(run);
};
// ─── Step 5A: “Core” fetchOrdersEmbroLinks – build columns based on latest orders/embroidery/links
const fetchOrdersEmbroLinksCore = async () => {
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
        // artworkUrl is set AFTER we fetch (or recall) version tokens
        machineId:        'queue',
        linkedTo:         linksData[sid] || null
      };
    });

    // 5) Render immediately, using any locally cached versions (no blocking)
    const uniqueIds = Array.from(new Set(driveIdsToPublicize));
    Object.values(jobById).forEach(job => {
      const cachedV = job.imageFileId ? metaVersionsRef.current[job.imageFileId] : '';
      job.artworkUrl = toPreviewUrl(job.imageLink, cachedV || '');
    });

    // 🔁 Fire-and-forget (SINGLE-FLIGHT): enqueue missing versions and let the worker handle them.
    const idsToFetch = uniqueIds.filter(id =>
      !metaVersionsRef.current[id] &&               // not already known
      !inflightMetaIdsRef.current.has(id) &&        // not currently fetching
      !pendingMetaIdsRef.current.has(id)            // not already queued
    );

    if (idsToFetch.length) {
      idsToFetch.forEach(id => pendingMetaIdsRef.current.add(id));
      kickMetaWorker();
    }

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
        job.machineId = 'Machine 2 (6)'
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
    // Robust fetch with one quick retry and longer timeout.
    const attempt = (ms) => axios.get(API_ROOT + '/manualState', { timeout: ms });

    let msData;
    try {
      ({ data: msData } = await attempt(25000));
    } catch (e1) {
      console.warn('manualState first attempt failed:', e1?.message || e1);
      await new Promise(r => setTimeout(r, 500));
      try {
        ({ data: msData } = await attempt(45000));
      } catch (e2) {
        console.error('manualState second attempt failed:', e2?.message || e2);
        // Gracefully degrade: return previous columns unchanged
        return previousCols;
      }
    }
    //    msData = { machineColumns: [ [...], [...] ], placeholders: [...] }

    // 2) Overwrite local placeholders state
    setPlaceholders(msData.placeholders || []);

    // 3) Extract machine1 & machine2 IDs
    const cols        = msData.machineColumns || [];
    const machine1Ids = cols[0] || [];
    const machine2Ids = cols[1] || [];

    // 4) Build a unified pool of all active, non-placeholder jobs
    const pool = [
      ...previousCols.queue.jobs,
      ...previousCols.machine1.jobs,
      ...previousCols.machine2.jobs,
    ].filter(job =>
      !msData.placeholders.some(p => p.id === job.id) &&
      String(job.status || '').toLowerCase() !== 'complete'
    );

    // Fast lookup by id
    const byId = new Map(pool.map(j => [j.id, { ...j, machineId: 'queue' }]));

    // 5) Start fresh columns; everything begins in the queue
    const mergedCols = {
      queue:    { ...previousCols.queue,    jobs: [] },
      machine1: { ...previousCols.machine1, jobs: [] },
      machine2: { ...previousCols.machine2, jobs: [] },
    };

    // Seed queue with all jobs initially (will be pulled out as we place them)
    mergedCols.queue.jobs = Array.from(byId.values());

    // Helper to pull an id from queue into a target machine in saved order
    function pullToMachine(id, machineKey) {
      const idx = mergedCols.queue.jobs.findIndex(j => j.id === id);
      if (idx !== -1) {
        const [jobObj] = mergedCols.queue.jobs.splice(idx, 1);
        jobObj.machineId = machineKey; // tag for clarity
        mergedCols[machineKey].jobs.push(jobObj);
      }
    }

    // 6) Place machine1 ids in exact saved order
    machine1Ids.forEach(id => pullToMachine(id, 'machine1'));

    // 7) Place machine2 ids in exact saved order
    machine2Ids.forEach(id => pullToMachine(id, 'machine2'));

    // 7.5) Any placeholders that are not explicitly on a machine stay in queue
    msData.placeholders.forEach(ph => {
      const onM1 = machine1Ids.includes(ph.id);
      const onM2 = machine2Ids.includes(ph.id);
      if (!onM1 && !onM2 && !mergedCols.queue.jobs.some(j => j.id === ph.id)) {
        mergedCols.queue.jobs.push(ph);
      }
    });

    // 7.6) Sort queue by due date for readability (machines keep saved order)
    mergedCols.queue.jobs.sort((a, b) => {
      const da = new Date(a.dueDate || a.delivery || 0);
      const db = new Date(b.dueDate || b.delivery || 0);
      return da - db;
    });

    // 8) Re-run scheduling on machines (timing only; order stays as placed)
    mergedCols.machine1.jobs = scheduleMachineJobs(mergedCols.machine1.jobs, 'Machine 1 (1)');
    mergedCols.machine2.jobs = scheduleMachineJobs(mergedCols.machine2.jobs, 'Machine 2 (6)');

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

      // 2) Show orders immediately — do NOT block on manualState
      setColumns(colsAfterOrders);

      // 3) Apply manualState in the background; upgrade columns when it returns
      setIsManualLoading(true);
      (async () => {
        try {
          const colsAfterManual = await fetchManualStateCore(colsAfterOrders);
          setColumns(colsAfterManual);
        } catch (e) {
          console.warn('manualState deferred fetch failed/skipped', e?.message || e);
        } finally {
          setIsManualLoading(false);
        }
      })();

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
  if (!isScheduler) return;

  const maybeStamp = (top, ref) => {
    if (!top) { ref.current = null; return; }

    const hasStart = !!top?.embroidery_start; // raw from server/sheet
    const key = String(top?.order ?? top?.order_number ?? top?.orderNo ?? "").trim();
    if (!key) { ref.current = null; return; }

    if (!hasStart && !bumpInFlight.current.has(key)) {
      bumpInFlight.current.add(key);
      bumpJobStartTime(top.id)
        .catch(() => { /* transient: retry next tick */ })
        .finally(() => bumpInFlight.current.delete(key));
    }

    ref.current = key;
  };

  maybeStamp(columns?.machine1?.jobs?.[0], prevM1Top);
  maybeStamp(columns?.machine2?.jobs?.[0], prevM2Top);
}, [isScheduler, columns?.machine1?.jobs, columns?.machine2?.jobs]);


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

// Heuristic: jobs that should NOT be treated as draggables (must mirror Section9 filters)
function isNonDraggable(job) {
  const isPlaceholder =
    job?.placeholder === true || job?.isPlaceholder === true || job?.type === 'placeholder';

  const status = String(job?.status || '').trim().toLowerCase();
  const notActive = status === 'complete' || status === 'sewing';

  const prod = String(job?.product ?? job?.Product ?? '').toLowerCase();
  const isTowel = prod.includes('towel');

  return isPlaceholder || notActive || isTowel;
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

// NEW: set start time when assigning to a machine, not via "top" watcher
async function maybeSetStartTimeOnAssign(job) {
  try {
    if (job && !job.embroidery_start) {
      await bumpJobStartTime(job.id);
    }
  } catch (e) {
    console.warn("Failed to set start time on assign:", e?.message || e);
  }
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

  // Safe even if the old "top watcher" effect is removed
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
  try {
    await axios.post(API_ROOT + '/manualState', manualState);
  } catch (err) {
    console.error('❌ manualState save failed (cross-col)', err);
  }

  // NEW: only set start time when moved into a machine column (preserves drop index)
  if (dstCol === 'machine1' || dstCol === 'machine2') {
    const head = movedJobs?.[0];
    if (head && !head.embroidery_start) {
      Promise.resolve().then(() => maybeSetStartTimeOnAssign(head));
    }
  }

  setManualReorder(true);
};

// Add debugging logs to inspect the state of the queue column
useEffect(() => {
  if (!isScheduler) return;
  console.log("Queue column before sorting:", columns.queue.jobs);
  const sortedQueue = sortQueue(columns.queue.jobs);
  console.log("Queue column after sorting:", sortedQueue);
}, [isScheduler, columns.queue.jobs]);
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
          { to: "/fur",               label: "Fur List" },
          { to: "/cut",               label: "Cut List" },  
          { to: "/ship",              label: "Ship" },
          { to: "/material-log", label: "Material Log" },
          { to: "/departments",       label: "Departments" }
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

      {/* 🌕 Scheduler overlay while manualState loads */}
      {isScheduler && isManualLoading && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0,
          width: '100vw', height: '100vh',
          backgroundColor: 'rgba(255, 247, 194, 0.65)', // transparent yellow
          zIndex: 1001, // above the status bar
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: '1.1rem',
          pointerEvents: 'none' // overlay is visual only; don’t block clicks
        }}>
          Loading Schedule…
        </div>
      )}

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
          <Route path="/digitizing" element={<DigitizingList />} />
          <Route path="/cut" element={<CutList />} />
          <Route path="/ship" element={<Ship />} />
          <Route path="/fur" element={<FurList />} />
          <Route path="/material-log" element={<MaterialLog />} />
          <Route path="/departments" element={<Departments />} />

          {/* 👇 New routes */}
          <Route path="/scan" element={<Scan />} />
          <Route path="/materials/:dept/:order" element={<Material />} />

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

// --- Copilot: Live update test ---
// This comment ensures a change for commit & push
