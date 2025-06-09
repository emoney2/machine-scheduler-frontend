// === Section 1: Imports & Configuration ===
// File: frontend/src/App.js

import React, { useState, useEffect, useRef } from 'react';
import debounce from "lodash.debounce";
import { io } from 'socket.io-client';
import axios from 'axios';
import Inventory from "./Inventory";
import InventoryOrdered from "./InventoryOrdered";
import "./axios-setup";

// send cookies on every API call so Flask session is preserved
axios.defaults.withCredentials = true;

// if any API response is 401, kick the browser to /login
axios.interceptors.response.use(
  resp => resp,
  err => {
    if (err.response && err.response.status === 401) {
      const base = process.env.REACT_APP_API_ROOT.replace(/\/api$/, '');
      window.location.href = `${base}/login?next=/`;
    }
    return Promise.reject(err);
  }
);

import Section9 from './Section9';
import OrderSubmission from './OrderSubmission';
import { parseDueDate, subWorkDays, fmtMMDD } from './helpers';
import { Routes, Route, NavLink }        from 'react-router-dom';

console.log('→ REACT_APP_API_ROOT =', process.env.REACT_APP_API_ROOT);
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

  // Core columns state
  const [columns, setColumns]       = useState({
    queue:    { title: 'Queue',     jobs: [] },
    machine1: { title: 'Machine 1', jobs: [] },
    machine2: { title: 'Machine 2', jobs: [] },
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

  // Initial data load
  useEffect(() => {
    const handle = setInterval(() => {
      console.log("⏳ Auto-refresh polling");
      fetchAllCombined();
    }, 10_000);          // 10,000ms = 10 seconds

    return () => clearInterval(handle);
  }, []);
  
  // Real-time updates listener
  useEffect(() => {
    const handleUpdate = debounce(() => {
      console.log("🛰️ remote update – re-fetching");
      fetchAllCombined();
    }, 1000);

    socket.on("manualStateUpdated",   handleUpdate);
    socket.on("orderUpdated",         handleUpdate);
    socket.on("linksUpdated",         handleUpdate);
    socket.on("placeholdersUpdated",  handleUpdate);

    return () => {
      socket.off("manualStateUpdated",   handleUpdate);
      socket.off("orderUpdated",         handleUpdate);
      socket.off("linksUpdated",         handleUpdate);
      socket.off("placeholdersUpdated",  handleUpdate);
      handleUpdate.cancel();
    };
  }, []);

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
function scheduleMachineJobs(jobs) {
  let prevEnd = null;

  return jobs.map((job, idx) => {
    // 1) Cutoff for late (6 work-days before due)
    const eedDay = subWorkDays(parseDueDate(job.due_date), 6);
    const cutoff = new Date(eedDay);
    cutoff.setHours(WORK_END_HR, WORK_END_MIN, 0, 0);

    // 2) StartTime
    let start;
    if (idx === 0) {
      if (job.embroidery_start) {
        start = clampToWorkHours(new Date(job.embroidery_start));
      } else {
        start = clampToWorkHours(new Date());
      }
    } else {
      start = clampToWorkHours(new Date(prevEnd.getTime() + 30 * 60000));
    }

    // 3) Run → end
    //   round quantity up to multiple of 6
    const qty = job.quantity % 6 === 0
      ? job.quantity
      : Math.ceil(job.quantity / 6) * 6;

    //   if stitch_count is zero or missing, use 30000 as placeholder
    const stitches = job.stitch_count > 0
      ? job.stitch_count
      : 30000;

    const runMs = (stitches / 30000) * (qty / 6) * 3600000;
    const end   = addWorkTime(start, runMs);

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
  // (This alone does NOT re‐assign manual placements—see Step 5C below.)
  const fetchOrdersEmbroLinksCore = async () => {
    console.log('fetchOrdersEmbroLinksCore ▶ start');
    setIsLoading(true);
    setHasError(false);

    try {
      // 1) Fetch /orders, /embroideryList, and /links in parallel
      const [ordersRes, embRes, linksRes] = await Promise.all([
        axios.get(API_ROOT + '/orders'),
        axios.get(API_ROOT + '/embroideryList'),
        axios.get(API_ROOT + '/links'),
      ]);

      const orders    = ordersRes.data   || [];
      const embList   = embRes.data      || [];
      let linksData   = linksRes.data    || {};

      // 2) Remove any entry (key or value) that appears in doNotRelink
      const doNotRelink = JSON.parse(localStorage.getItem('doNotRelink') || '[]');
      const filteredLinks = {};
      Object.entries(linksData).forEach(([key, val]) => {
        // drop any pair if either side was unlinked
        if (!doNotRelink.includes(key) && !doNotRelink.includes(val)) {
          filteredLinks[key] = val;
        }
      });
      linksData = filteredLinks;

      // 3) Build embMap = { orderId → embroideryStartTime }
      const embMap = {};
      embList.forEach(r => {
        const id = String(r['Order #'] || '').trim();
        if (id) embMap[id] = r['Embroidery Start Time'] || '';
      });

      // 4) Construct fresh map of all jobs (real orders + placeholders)
      const jobById = {};
      orders.forEach(o => {
        const sid = String(o['Order #'] || '').trim();
        if (!sid) return;
        jobById[sid] = {
          id:               sid,
          company:          o['Company Name'] || '',
          design:           o['Design']       || '',
          quantity:         +o['Quantity']    || 0,
          stitch_count:     +o['Stitch Count']|| 0,
          due_date:         o['Due Date']     || '',
          due_type:         o['Hard Date/Soft Date'] || '',
          embroidery_start: embMap[sid] || '',
          start_date:       embMap[sid] || '',
          status:           o['Stage']       || '', 
          threadColors:     o['Threads']|| '',
          machineId:        'queue',            // default to queue
          linkedTo:         linksData[sid]   || null
        };
      });

      // 5) Inject any placeholders from local state so they never vanish
      placeholders.forEach(ph => {
        if (!jobById[ph.id]) {
          jobById[ph.id] = {
            id:               ph.id,
            company:          ph.company || '',
            design:           '',
            quantity:         +ph.quantity    || 0,
            stitch_count:     +ph.stitchCount || 0,
            due_date:         ph.inHand       || '',
            due_type:         ph.dueType      || '',
            embroidery_start: '',
            start_date:       '',
            machineId:        'queue',
            linkedTo:         null
          };
        } else {
          // If placeholder ID already existed, update its fields in place
          const existingPh = jobById[ph.id];
          existingPh.company      = ph.company      || '';
          existingPh.quantity     = +ph.quantity    || 0;
          existingPh.stitch_count = +ph.stitchCount || 0;
          existingPh.due_date     = ph.inHand       || '';
          existingPh.due_type     = ph.dueType      || '';
        }
      });

      // 6) Build initial “newCols” based on what’s currently in state
      const newCols = {
        queue:    { ...columns.queue,    jobs: [] },
        machine1: { ...columns.machine1, jobs: [] },
        machine2: { ...columns.machine2, jobs: [] },
      };

      // 7) Decide which column each job belongs to:
      //    a) If currently in columns.machine1.jobs, keep machineId = 'machine1'
      columns.machine1.jobs.forEach(job => {
        if (jobById[job.id]) jobById[job.id].machineId = 'machine1';
      });
      //    b) If currently in columns.machine2.jobs, keep machineId = 'machine2'
      columns.machine2.jobs.forEach(job => {
        if (jobById[job.id]) jobById[job.id].machineId = 'machine2';
      });
      //    c) Everything else remains machineId = 'queue'

      // 8) Build array version of each column from jobById
      Object.values(jobById).forEach(job => {
        if (job.machineId === 'machine1') {
          newCols.machine1.jobs.push(job);
        } else if (job.machineId === 'machine2') {
          newCols.machine2.jobs.push(job);
        } else {
          newCols.queue.jobs.push(job);
        }
      });

      // 9) Sort only the queue by due_date (machines remain in last arranged order)
      newCols.queue.jobs.sort((a, b) => {
        const da = parseDueDate(a.due_date);
        const db = parseDueDate(b.due_date);
        if (da && db) return da - db;
        if (da) return -1;
        if (db) return 1;
        return 0;
      });

      // 10) Re-run scheduleMachineJobs on the machine columns
      newCols.machine1.jobs = scheduleMachineJobs(newCols.machine1.jobs);
      newCols.machine2.jobs = scheduleMachineJobs(newCols.machine2.jobs);

      // 11) Return the newCols object (we’ll commit it in Step 5C)
      return newCols;
    } catch (err) {
      console.error('❌ fetchOrdersEmbroLinksCore error', err);
      setHasError(true);
      // In case of error, return the existing columns unmodified:
      return columns;
    } finally {
      setIsLoading(false);
    }
  };


  // ─── Section 5B: fetchManualState only ───────────────────────────────────────────
  const fetchManualStateCore = async (previousCols) => {
    // previousCols should be the object returned by fetchOrdersEmbroLinksCore
    // We’ll merge in any server‐specified placeholders and re‐assign those.
    console.log('fetchManualStateCore ▶ start');
    // We do not set loading flags here; the combined function handles that.
    try {
      // 1) Fetch manualState
      const { data: msData } = await axios.get(API_ROOT + '/manualState');
      //   msData = { machine1: [ … ], machine2: [ … ], placeholders: [ … ] }

      // 2) Overwrite local placeholders
      setPlaceholders(msData.placeholders || []);

      // 3) Build “mergedCols” starting from previousCols
      const mergedCols = {
        queue:    { ...previousCols.queue,    jobs: [...previousCols.queue.jobs] },
        machine1: { ...previousCols.machine1, jobs: [...previousCols.machine1.jobs] },
        machine2: { ...previousCols.machine2, jobs: [...previousCols.machine2.jobs] },
      };

      // 4) Remove any job that is now a placeholder from machine1/machine2
      ['machine1', 'machine2'].forEach(colId => {
        mergedCols[colId].jobs = mergedCols[colId].jobs.filter(
          job => !msData.placeholders.some(p => p.id === job.id)
        );
      });

      // 5) Re‐inject placeholders into machine1 in exact server order
      ;(msData.machine1 || []).forEach(jobId => {
        // find that job in mergedCols.queue.jobs
        const idx = mergedCols.queue.jobs.findIndex(j => j.id === jobId);
        if (idx !== -1) {
          const [jobObj] = mergedCols.queue.jobs.splice(idx, 1);
          mergedCols.machine1.jobs.push(jobObj);
        }
      });

      // 6) Re‐inject placeholders into machine2
      ;(msData.machine2 || []).forEach(jobId => {
        const idx = mergedCols.queue.jobs.findIndex(j => j.id === jobId);
        if (idx !== -1) {
          const [jobObj] = mergedCols.queue.jobs.splice(idx, 1);
          mergedCols.machine2.jobs.push(jobObj);
        }
      });

      // 7) Leave all other jobs exactly where they are (in queue / machine1 / machine2).
      //    Now re‐run scheduleMachineJobs on machines to recalc times.
      mergedCols.machine1.jobs = scheduleMachineJobs(mergedCols.machine1.jobs);
      mergedCols.machine2.jobs = scheduleMachineJobs(mergedCols.machine2.jobs);

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

    // 2) Then set up the 20 s interval
    const handle = setInterval(() => {
      console.log("⏳ Poll: combined fetchAllCombined()");
      fetchAllCombined();
    }, 20_000);

    return () => clearInterval(handle);
  }, []);


// === Section 6: Placeholder Management ===

// Add or update a placeholder and persist to server
const submitPlaceholder = async (e) => {
  if (e && e.preventDefault) e.preventDefault();

  let updated;
  if (ph.id) {
    // editing an existing placeholder
    updated = placeholders.map(p => (p.id === ph.id ? ph : p));
  } else {
    // creating a brand-new placeholder
    const newPh = {
      id:           `ph-${Date.now()}`,
      company:      ph.company,
      quantity:     Number(ph.quantity),
      stitchCount:  Number(ph.stitchCount),
      inHand:       ph.inHand,
      dueType:      ph.dueType,

      // fields so it renders correctly as a card
      start:        '',
      end:          '',
      delivery:     '',
      isLate:       false,
      linkedTo:     null,
      machineId:    'queue',
      threadColors: ''
    };
    updated = [...placeholders, newPh];

    // Immediately show the new placeholder in the queue
    setColumns(cols => ({
      ...cols,
      queue: {
        ...cols.queue,
        jobs: [newPh, ...cols.queue.jobs]
      }
    }));
  }

  // prepare the manualState payload
  const manualState = {
    machine1:     columns.machine1.jobs.map(j => j.id),
    machine2:     columns.machine2.jobs.map(j => j.id),
    placeholders: updated
  };

  try {
    await axios.post(API_ROOT + '/manualState', manualState);
    // update local placeholder list
    setPlaceholders(updated);
    // close modal & reset form
    setShowModal(false);
    setPh({ id: null, company: '', quantity: '', stitchCount: '', inHand: '', dueType: 'Hard Date' });
  } catch (err) {
    console.error('❌ failed to save placeholder', err);
  }
};

// Remove a placeholder from the list (and persist), and remove its card immediately
const removePlaceholder = async (id) => {
  // 1) Remove its card immediately from the queue
  setColumns(cols => ({
    ...cols,
    queue: {
      ...cols.queue,
      jobs: cols.queue.jobs.filter(j => String(j.id) !== id)
    }
  }));

  // 2) Clean the placeholders array
  const cleaned = placeholders.filter(p => p.id !== id);

  // 3) Persist cleaned list
  const manualState = {
    machine1:     columns.machine1.jobs.map(j => j.id),
    machine2:     columns.machine2.jobs.map(j => j.id),
    placeholders: cleaned
  };

  try {
    await axios.post(API_ROOT + '/manualState', manualState);
    // update local placeholders state
    setPlaceholders(cleaned);
  } catch (err) {
    console.error('❌ failed to remove placeholder', err);
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
        padding: 8,
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #ccc'
      }}>
        {[
          { to: "/",                label: "Scheduler" },
          { to: "/submit",          label: "Order Submission" },
          { to: "/inventory",       label: "Inventory" },
          { to: "/inventory-ordered", label: "Inventory Ordered" },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              marginRight: 16,
              padding: '0.5rem 1rem',
              textDecoration: 'none',
              color: '#333',                             // uniform dark text
              backgroundColor: isActive ? '#e0e0e0' : 'transparent',
              border: isActive ? '1px solid #ccc' : '1px solid transparent',
              borderBottom: isActive ? 'none' : '1px solid #ccc',
              borderRadius: '4px 4px 0 0'
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* ─── Route Outlet ─────────────────────────────────────────────────────── */}
      <Routes>
        <Route
          path="/"
          element={
            <Section9
              columns={columns}
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
      </Routes>
    </>
  );
}
