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
import { parseDueDate, subWorkDays, fmtMMDD } from './helpers';
import { Routes, Route, NavLink } from 'react-router-dom';

console.log('→ REACT_APP_API_ROOT =', process.env.REACT_APP_API_ROOT);

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
const API_ROOT   = process.env.REACT_APP_API_ROOT;
const SOCKET_URL = API_ROOT.replace(/\/api$/, '');
const socket     = io(SOCKET_URL, {
  transports: ['websocket','polling'],
  withCredentials: true   // ← send the session cookie on the WS handshake
});

socket.on("connect",        () => console.log("⚡ socket connected, id =", socket.id));
socket.on("disconnect",     reason => console.log("🛑 socket disconnected:", reason));
socket.on("connect_error",  err    => console.error("🚨 socket connection error:", err));

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
  console.log('🔔 App component mounted');

  // ─── Section 1.5: Auto‐bump setup ────────────────────────────────────────────
  // Track last‐seen top job on each machine
  const prevMachine1Top = useRef(null);
  const prevMachine2Top = useRef(null);
  const bumpedJobs = useRef(new Set());


  // Send a new start time when needed
  const bumpJobStartTime = async (jobId) => {
    try {
      console.log("⏱️ Setting embroidery start time for job", jobId);
      const clamped = clampToWorkHours(new Date());
      const iso     = clamped.toISOString();
      await axios.post(API_ROOT + '/updateStartTime', {
        id:        jobId,
        startTime: iso
      });
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
      console.log("🛰️ remote update – re-fetching");
      fetchAllCombined();
    }, 1000);

    socket.on("manualStateUpdated",   handleUpdate);
    socket.on("linksUpdated",         handleUpdate);
    socket.on("placeholdersUpdated",  handleUpdate);

    return () => {
      socket.off("manualStateUpdated",   handleUpdate);
      socket.off("linksUpdated",         handleUpdate);
      socket.off("placeholdersUpdated",  handleUpdate);
      handleUpdate.cancel();
    };
  }, []);

// Listen for just-startTime updates, splice machine1 only
useEffect(() => {
  socket.on("startTimeUpdated", ({ orderId, startTime }) => {
    setColumns(cols => {
      const m1 = cols.machine1.jobs.filter(j => j.id !== orderId);
      if (m1.length) {
        // bump the next job’s start time
        m1[0] = { ...m1[0], embroidery_start: startTime };
      }
      return {
        ...cols,
        machine1: { ...cols.machine1, jobs: m1 }
        // machine2 is untouched
      };
    });
  });
  return () => {
    socket.off("startTimeUpdated");
  };
}, []);

useEffect(() => {
  const top1 = columns.machine1.jobs?.[0];
  const top2 = columns.machine2.jobs?.[0];

  if (top1 && !top1.embroidery_start && !bumpedJobs.current.has(top1.id)) {
    console.log("⏱️ Setting start time for Machine 1 top job:", top1.id);
    bumpJobStartTime(top1.id);
    bumpedJobs.current.add(top1.id);
  }

  if (top2 && !top2.embroidery_start && !bumpedJobs.current.has(top2.id)) {
    console.log("⏱️ Setting start time for Machine 2 top job:", top2.id);
    bumpJobStartTime(top2.id);
    bumpedJobs.current.add(top2.id);
  }
}, [columns.machine1.jobs, columns.machine2.jobs]);
;



  // Manual sync button handler
  const handleSync = async () => {
    setSyncStatus('');
    await fetchAllCombined();
    setSyncStatus('updated');
    setTimeout(() => setSyncStatus(''), 2000);
  };

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

function fmtDT(dt) {
  const pad = n => String(n).padStart(2, '0');
  const month = pad(dt.getMonth() + 1);
  const day   = pad(dt.getDate());
  let h       = dt.getHours();
  const m     = pad(dt.getMinutes());
  let ap      = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return month + '/' + day + ' ' + pad(h) + ':' + m + ' ' + ap;
}


function parseDueDate(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d);
  const parts = d.split('/');
  if (parts.length >= 2) {
    const mo = +parts[0], da = +parts[1],
          yr = parts.length === 3 ? +parts[2] : new Date().getFullYear();
    if (!isNaN(mo) && !isNaN(da) && !isNaN(yr)) {
      return new Date(yr, mo - 1, da);
    }
  }
  const dt = new Date(d);
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
function scheduleMachineJobs(jobs, headCount = 6) {
  let prevEnd = null;

  return jobs.map((job, idx) => {
    // 1) Late cutoff
    const eedDay = subWorkDays(parseDueDate(job.due_date), 6);
    const cutoff = new Date(eedDay);
    cutoff.setHours(WORK_END_HR, WORK_END_MIN, 0, 0);

    // 2) StartTime
    let start;
    if (idx === 0) {
      start = job.embroidery_start
        ? clampToWorkHours(new Date(job.embroidery_start))
        : clampToWorkHours(prevEnd || new Date());
    } else {
      start = clampToWorkHours(prevEnd);
    }

    // 3) Run → EndTime
    //   a) bump quantity to a multiple of headCount
    const qty = job.quantity % headCount === 0
      ? job.quantity
      : Math.ceil(job.quantity / headCount) * headCount;
    //   b) default to 30000 stitches if none provided
    const stitches = job.stitch_count > 0 ? job.stitch_count : 30000;
    const runMs    = (stitches / 30000) * (qty / headCount) * 3600000;

    //   c) calculate end time
    const end = addWorkTime(start, runMs);

    // 4) Decorate
    job._rawStart = start;
    job._rawEnd   = end;
    job.start     = fmtDT(start);
    job.end       = fmtDT(end);
    job.delivery  = fmtMMDD(addWorkDays(end, 6));
    job.isLate    = end > cutoff;

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
    console.log('fetchOrdersEmbroLinksCore ▶ start');
    setIsLoading(true);
    setHasError(false);
    bumpedJobs.current.clear();


    try {
      // 1) Fetch orders, embroideryList, and links in parallel
      const [ordersRes, embRes, linksRes] = await Promise.all([
        axios.get(API_ROOT + '/orders'),
        axios.get(API_ROOT + '/embroideryList'),
        axios.get(API_ROOT + '/links'),
      ]);

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

      // 4) Build embMap: orderId → embroideryStartTime
      const embMap = {};
      embList.forEach(r => {
        const id = String(r['Order #'] || '').trim();
        if (id) embMap[id] = r['Embroidery Start Time'] || '';
      });

      // 5) Build a map of all jobs (orders + placeholders)
      const jobById = {};
      orders.forEach(o => {
        const sid = String(o['Order #'] || '').trim();
        if (!sid) return;
        jobById[sid] = {
          id:               sid,
          company:          o['Company Name'] || '',
          design:           o['Design'] || '',
          quantity:         +o['Quantity'] || 0,
          stitch_count:     +o['Stitch Count'] || 0,
          due_date:         o['Due Date'] || '',
          due_type:         o['Hard Date/Soft Date'] || '',
          embroidery_start: embMap[sid] || '',
          start_date:       embMap[sid] || '',
          status:           o['Stage'] || '',
          threadColors:     o['Threads'] || '',
          machineId:        'queue',
          linkedTo:         linksData[sid] || null
        };
      });

      // 6) Inject placeholders so they persist
      placeholders.forEach(ph => {
        if (!jobById[ph.id]) {
          jobById[ph.id] = {
            id:               ph.id,
            company:          ph.company || '',
            design:           '',
            quantity:         +ph.quantity || 0,
            stitch_count:     +ph.stitchCount || 0,
            due_date:         ph.inHand || '',
            due_type:         ph.dueType || '',
            embroidery_start: '',
            start_date:       '',
            status:           '',
            threadColors:     '',
            machineId:        'queue',
            linkedTo:         null
          };
        } else {
          // update existing placeholder fields
          const existing = jobById[ph.id];
          existing.company      = ph.company      || '';
          existing.quantity     = +ph.quantity    || 0;
          existing.stitch_count = +ph.stitchCount || 0;
          existing.due_date     = ph.inHand       || '';
          existing.due_type     = ph.dueType      || '';
        }
      });

      // 7) Initialize newCols from current columns (retaining headCount)
      const newCols = {
        queue:    { ...columns.queue,    jobs: [] },
        machine1: { ...columns.machine1, jobs: [] },
        machine2: { ...columns.machine2, jobs: [] },
      };

      // 8) Preserve any manual placements
      columns.machine1.jobs.forEach(job => {
        if (jobById[job.id]) jobById[job.id].machineId = 'machine1';
      });
      columns.machine2.jobs.forEach(job => {
        if (jobById[job.id]) jobById[job.id].machineId = 'machine2';
      });

      // 9) Distribute jobs into newCols
      Object.values(jobById).forEach(job => {
        if (job.machineId === 'machine1') {
          newCols.machine1.jobs.push(job);
        } else if (job.machineId === 'machine2') {
          newCols.machine2.jobs.push(job);
        } else {
          newCols.queue.jobs.push(job);
        }
      });

      // 10) Sort queue by due_date
      newCols.queue.jobs.sort((a, b) => {
        const da = parseDueDate(a.due_date);
        const db = parseDueDate(b.due_date);
        if (da && db) return da - db;
        if (da) return -1;
        if (db) return 1;
        return 0;
      });

      // 11) Re-run scheduleMachineJobs for each machine using its headCount
      newCols.machine1.jobs = scheduleMachineJobs(
        newCols.machine1.jobs,
        newCols.machine1.headCount
      );
      newCols.machine2.jobs = scheduleMachineJobs(
        newCols.machine2.jobs,
        newCols.machine2.headCount
      );

      // 12) Return the updated columns
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
  console.log('fetchManualStateCore ▶ start');
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

    // 8) Re-run scheduling on machines
    // re-schedule using each column’s headCount
    mergedCols.machine1.jobs = scheduleMachineJobs(
      mergedCols.machine1.jobs,
      mergedCols.machine1.headCount
    );
    mergedCols.machine2.jobs = scheduleMachineJobs(
      mergedCols.machine2.jobs,
      mergedCols.machine2.headCount
    );

    console.log('fetchManualStateCore ▶ done');
    return mergedCols;

  } catch (err) {
    console.error('❌ fetchManualStateCore error', err);
    throw err;
  }
};

  // ─── Section 5C: Combined “fetchAll” that first loads orders/embroidery/links, THEN applies manualState ─────
  const fetchAllCombined = async () => {
    console.log('fetchAllCombined ▶ start');
    setIsLoading(true);
    setHasError(false);

    try {
      // 1) First, build new columns from orders/embroidery/links only
      const colsAfterOrders = await fetchOrdersEmbroLinksCore();

      // 2) Then, apply manualState on top of that to enforce placeholders & machine1/machine2 order
      const colsAfterManual = await fetchManualStateCore(colsAfterOrders);

      // 3) Finally, commit to React state
      setColumns(colsAfterManual);

      console.log('fetchAllCombined ▶ done');
      setHasError(false);
    } catch (err) {
      console.error('❌ fetchAllCombined error', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Section 5D: On mount, do one combined fetch; then every 20 s do the same combined fetch ─────────────
  useEffect(() => {
    console.log("📡 Initial load: combined fetchAllCombined()");

    // 1) Run immediately on mount
    fetchAllCombined();

    // 2) Then set up the 15 s interval
    const handle = setInterval(() => {
      console.log("⏳ Poll: combined fetchAllCombined()");
      fetchAllCombined();
    }, 15_000);

    return () => clearInterval(handle);
  }, []);
// ─── Section 5E: Auto‐clear old & bump new top‐of‐list ───────────────
useEffect(() => {
  const m1Jobs = columns.machine1.jobs;
  const m2Jobs = columns.machine2.jobs;

  const handleTopChange = async (prevRef, jobs, machineName) => {
    const oldTop = prevRef.current;
    const newTop = jobs[0]?.id || null;

    if (newTop !== oldTop) {
      const jobObj = jobs.find(j => j.id === newTop);

      console.log(`🧪 Top job ID: ${newTop}`);
      console.log(`🧪 embroidery_start value: ${jobObj?.embroidery_start}`);
      console.log(`🧪 embroidery_start type: ${typeof jobObj?.embroidery_start}`);

      // Only set start time if missing or empty string
      if (jobObj && (!jobObj.embroidery_start || jobObj.embroidery_start.trim() === '')) {
        const clamped = clampToWorkHours(new Date());
        const iso = clamped.toISOString();

        console.log(`🔔 Bumping start time for ${newTop}: ${iso}`);

        try {
          await axios.post(API_ROOT + '/updateStartTime', {
            id: newTop,
            startTime: iso
          });
        } catch (err) {
          console.error("❌ Failed to bump start time", err);
        }
      }

      prevRef.current = newTop;
    }
  };

  handleTopChange(prevMachine1Top, m1Jobs, 'machine1');
  handleTopChange(prevMachine2Top, m2Jobs, 'machine2');
}, [columns.machine1.jobs, columns.machine2.jobs]);

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
const onDragEnd = async (result) => {
  // 🔍 DEBUGGING INSTRUMENTATION
  console.log("🔍 DRAG-END result:", result);
  console.log("🔍 BEFORE COLUMNS:", JSON.stringify(columns, null, 2));

  const { source, destination, draggableId } = result;
  if (!destination) {
    console.log("→ No destination, aborting");
    return;
  }

  const srcCol = source.droppableId;
  const dstCol = destination.droppableId;
  const srcIdx = source.index;
  const dstIdx = destination.index;
  if (srcCol === dstCol && srcIdx === dstIdx) return;

  // 1) Extract the full chain from the source column
  const srcJobs   = Array.from(columns[srcCol].jobs);
  const chainIds  = getChain(srcJobs, draggableId);
  const chainJobs = chainIds.map(id => srcJobs.find(j => j.id === id));
  const newSrcJobs = srcJobs.filter(j => !chainIds.includes(j.id));

  // 2) If reordering within the same column:
  if (srcCol === dstCol) {
    let insertAt = dstIdx;
    if (dstIdx > srcIdx) insertAt = dstIdx - chainJobs.length + 1;
    newSrcJobs.splice(insertAt, 0, ...chainJobs);
    const updatedJobs = srcCol === 'queue'
      ? sortQueue(newSrcJobs)
      : scheduleMachineJobs(newSrcJobs);

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
    const manualState = {
      machine1:    nextCols.machine1.jobs.map(j => j.id),
      machine2:    nextCols.machine2.jobs.map(j => j.id),
      placeholders // ensure this is in scope
    };
    console.log('⏹ Persisting manualState (same-col) to server:', manualState);
    try {
      await axios.post(API_ROOT + '/manualState', manualState);
      console.log('✅ manualState saved (same-col reorder)');
    } catch (err) {
      console.error('❌ manualState save failed (same-col reorder)', err);
    }

    console.log('⏹ onDragEnd end (reorder same col), new columns:', nextCols);
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
  dstJobs.splice(dstIdx, 0, ...movedJobs);

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
  ['machine1', 'machine2'].forEach(machine => {
    nextCols[machine].jobs = scheduleMachineJobs(nextCols[machine].jobs);
  });
  nextCols.queue.jobs = sortQueue(nextCols.queue.jobs);

  // update state
  setColumns(nextCols);
  console.log('⏹ onDragEnd end (cross-col), new columns:', nextCols);

  // ─── reset the “previous top” refs so handleTopChange sees no change ───
  prevMachine1Top.current = nextCols.machine1.jobs[0]?.id || null;
  prevMachine2Top.current = nextCols.machine2.jobs[0]?.id || null;

  // 6) Persist the shared manualState to backend **including placeholders**
  const manualState = {
    machine1:    nextCols.machine1.jobs.map(j => j.id),
    machine2:    nextCols.machine2.jobs.map(j => j.id),
    placeholders
  };
  console.log('⏹ Persisting manualState (cross-col) to server:', manualState);
  try {
    await axios.post(API_ROOT + '/manualState', manualState);
    console.log('✅ manualState saved (cross-col)');
  } catch (err) {
    console.error('❌ manualState save failed (cross-col)', err);
  }
};
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
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        padding: 8,
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #ccc'
      }}>
        {[
          { to: "/",                  label: "Scheduler" },
          { to: "/submit",            label: "Order Submission" },
          { to: "/inventory",         label: "Inventory" },
          { to: "/inventory-ordered", label: "Inventory Ordered" },
          { to: "/ship",              label: "Ship" }
        ].map(({ to, label }) => (
          <NavLink key={to} to={to} style={/* ... */}>
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
            />
          }
        />
        <Route path="/submit" element={<OrderSubmission />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory-ordered" element={<InventoryOrdered />} />
        <Route path="/ship" element={<Ship />} />
      </Routes>
    </>
  );
}
