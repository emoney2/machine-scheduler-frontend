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
      fetchAll();
    }, 10_000);          // 10,000ms = 10 seconds

    return () => clearInterval(handle);
  }, []);
  
  // Real-time updates listener
  useEffect(() => {
    const handleUpdate = debounce(() => {
      console.log("🛰️ remote update – re-fetching");
      fetchAll();
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
    await fetchAll();
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

  // ─── Section 5: Fetch Helpers + Initial Load & Polling ────────────────────
  // Two new state flags:
  //   • isLoading = true whenever any fetch is in flight
  //   • hasError   = true if the most recent fetch attempt failed
  const [isLoading, setIsLoading] = useState(false);
  const [hasError,   setHasError]   = useState(false);

  // ─── Section 5A: fetchManualState only ─────────────────────────────────
  const fetchManualState = async () => {
    console.log('fetchManualState ▶ start');
    setIsLoading(true);
    setHasError(false);

    try {
      // 1) Fetch current manualState (machine1, machine2, placeholders)
      const { data: msData } = await axios.get(API_ROOT + '/manualState');

      // 2) Update local placeholders array
      setPlaceholders(msData.placeholders || []);

      // 3) Build a shallow copy of columns to modify:
      const newCols = { ...columns };

      // a) Remove any job that’s now a placeholder from machine lists
      ['machine1', 'machine2'].forEach(colId => {
        newCols[colId].jobs = newCols[colId].jobs.filter(
          job => !msData.placeholders.some(p => p.id === job.id)
        );
      });

      // b) Inject placeholders into machine1, in exact server order
      ;(msData.machine1 || []).forEach(jobId => {
        const idx = newCols.queue.jobs.findIndex(j => j.id === jobId);
        if (idx !== -1) {
          const [jobObj] = newCols.queue.jobs.splice(idx, 1);
          newCols.machine1.jobs.push(jobObj);
        }
      });

      // c) Inject placeholders into machine2 similarly
      ;(msData.machine2 || []).forEach(jobId => {
        const idx = newCols.queue.jobs.findIndex(j => j.id === jobId);
        if (idx !== -1) {
          const [jobObj] = newCols.queue.jobs.splice(idx, 1);
          newCols.machine2.jobs.push(jobObj);
        }
      });

      // 4) Overwrite local columns state so placeholders + assignments appear
      setColumns(newCols);
      console.log('fetchManualState ▶ done');
      setHasError(false);
    } catch (err) {
      console.error('❌ fetchManualState error', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };


  // ─── Section 5B: fetchOrdersEmbroLinks only (preserve local assignments) ───
  const fetchOrdersEmbroLinks = async () => {
    console.log('fetchOrdersEmbroLinks ▶ start');
    setIsLoading(true);
    setHasError(false);

    try {
      // 1) Grab fresh orders, embroideryList, links
      const [ordersRes, embRes, linksRes] = await Promise.all([
        axios.get(API_ROOT + '/orders'),
        axios.get(API_ROOT + '/embroideryList'),
        axios.get(API_ROOT + '/links'),
      ]);

      const orders    = ordersRes.data   || [];
      const embList   = embRes.data      || [];
      const linksData = linksRes.data    || {};

      // 2) Build embMap = { orderId → embroideryStartTime }
      const embMap = {};
      embList.forEach(r => {
        const id = String(r['Order #'] || '').trim();
        if (id) embMap[id] = r['Embroidery Start Time'] || '';
      });

      // 3) Construct jobById for all real orders
      const jobById = {};
      orders.forEach(o => {
        const sid = String(o['Order #'] || '').trim();
        if (!sid) return;
        jobById[sid] = {
          id:               sid,
          company:         o['Company Name'] || '',
          design:          o['Design']       || '',
          quantity:        +o['Quantity']    || 0,
          stitch_count:    +o['Stitch Count']|| 0,
          due_date:        o['Due Date']     || '',
          due_type:        o['Hard Date/Soft Date'] || '',
          embroidery_start: embMap[sid] || '',
          start_date:       embMap[sid] || '',
          machineId:       'queue',
          linkedTo:        linksData[sid]   || null
        };
      });

      // 4) Merge in any placeholder jobs (from your local state) so they persist
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
            machineId:       'queue',
            linkedTo:        null
          };
        }
      });

      // 5) Preserve any job that your user has already dragged into machine1/machine2
      columns.machine1.jobs.forEach(job => {
        if (jobById[job.id]) {
          jobById[job.id].machineId = 'machine1';
        }
      });
      columns.machine2.jobs.forEach(job => {
        if (jobById[job.id]) {
          jobById[job.id].machineId = 'machine2';
        }
      });

      // 6) Collect queueJobs = those still marked “queue”
      const queueJobs = Object.values(jobById)
        .filter(j => j.machineId === 'queue')
        .sort((a, b) => {
          const da = parseDueDate(a.due_date);
          const db = parseDueDate(b.due_date);
          if (da && db) return da - db;
          if (da) return -1;
          if (db) return  1;
          return  0;
        });

      // 7) Build arrays for machine1/machine2
      const machine1Jobs = Object.values(jobById).filter(j => j.machineId === 'machine1');
      const machine2Jobs = Object.values(jobById).filter(j => j.machineId === 'machine2');

      // 8) Merge them into state (so your existing assignments stay in place)
      setColumns(cols => ({
        queue:     { ...cols.queue,     jobs: queueJobs },
        machine1:  { ...cols.machine1,  jobs: scheduleMachineJobs(machine1Jobs) },
        machine2:  { ...cols.machine2,  jobs: scheduleMachineJobs(machine2Jobs) }
      }));

      console.log('fetchOrdersEmbroLinks ▶ done');
      setHasError(false);
    } catch (err) {
      console.error('❌ fetchOrdersEmbroLinks error', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Section 5.2: On mount, do ONE fetchManualState and ONE fetchOrdersEmbroLinks,
  //                   then poll only orders/embroideryList/links every 20 s
  useEffect(() => {
    console.log("📡 Initial load: manualState + orders/embroidery/links");

    // 1) Load manualState so placeholders & machine assignments appear
    fetchManualState();

    // 2) Load orders/embroideryList/links so queue/machine jobs appear
    fetchOrdersEmbroLinks();

    // 3) Then every 20 seconds, only re-fetch orders/embroideryList/links
    const handle = setInterval(() => {
      console.log("⏳ Poll: orders/embroidery/links");
      fetchOrdersEmbroLinks();
    }, 20_000);

    return () => clearInterval(handle);
  }, []);

// === Section 6: Placeholder Management ===

// Add or update a placeholder and persist to server
const submitPlaceholder = async (e) => {
  if (e && e.preventDefault) e.preventDefault();

  // build new placeholders array
  let updated;
  if (ph.id) {
    updated = placeholders.map(p => p.id === ph.id ? ph : p);
  } else {
    const newPh = { ...ph, id: `ph-${Date.now()}` };
    updated = [...placeholders, newPh];
  }

  // prepare the manualState payload (machine order + placeholders)
  const manualState = {
    machine1: columns.machine1.jobs.map(j => j.id),
    machine2: columns.machine2.jobs.map(j => j.id),
    placeholders: updated
  };

  try {
    await axios.post(API_ROOT + '/manualState', manualState);

    // update local placeholders array
    setPlaceholders(updated);

    // close modal and reset form
    setShowModal(false);
    setPh({ id: null, company: '', quantity: '', stitchCount: '', inHand: '', dueType: 'Hard Date' });

    // **new**: re-fetch everything so the queue shows your placeholder immediately
    await fetchAll();
  } catch (err) {
    console.error('❌ failed to save placeholders', err);
  }
};

// Populate the modal for editing an existing placeholder
const editPlaceholder = (job) => {
  setPh(job);
  setShowModal(true);
};

// Remove a placeholder from the list (and persist)
const removePlaceholder = async (id) => {
  const updated = placeholders.filter(p => p.id !== id);
  const manualState = {
    machine1: columns.machine1.jobs.map(j => j.id),
    machine2: columns.machine2.jobs.map(j => j.id),
    placeholders: updated
  };
  try {
    await axios.post(API_ROOT + '/manualState', manualState);
    setPlaceholders(updated);
    // **new**: re-fetch so the card disappears without a full page reload
    await fetchAll();
  } catch (err) {
    console.error('❌ failed to remove placeholder', err);
  }
};

// === Section 7: toggleLink (full replacement) ===
const toggleLink = async (colId, idx) => {
  // 1) Copy current jobs in that column
  const jobs = Array.from(columns[colId].jobs);
  const job  = jobs[idx];
  const next = jobs[idx + 1];

  // 2) Build a new links map
  const newLinks = { ...links };
  if (job.linkedTo === next?.id) {
    // unlink
    delete newLinks[job.id];
  } else if (next) {
    // link
    newLinks[job.id] = next.id;
  }

  // 3) Persist to server so everyone sees it
  try {
    await axios.post(API_ROOT + '/links', newLinks);
    // server will broadcast a "linksUpdated" event
  } catch (err) {
    console.error('❌ failed to save links to server', err);
  }

  // 4) Update local state immediately
  setLinks(newLinks);

  // 5) Reflect it in the UI right away
  jobs[idx] = { ...job, linkedTo: newLinks[job.id] || null };
  setColumns(cols => ({
    ...cols,
    [colId]: { ...cols[colId], jobs }
  }));
};

// === Section 8: Drag & Drop Handler (with Chain‐aware Moves & shared manualState + placeholders) ===
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
    setColumns(cols => ({
      ...cols,
      [srcCol]: { ...cols[srcCol], jobs: updatedJobs }
    }));
    console.log('⏹ onDragEnd end (reorder same col), new columns:', {
      ...columns,
      [srcCol]: { ...columns[srcCol], jobs: updatedJobs }
    });
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
    placeholders // ← make sure to include this
  };
  console.log('⏹ Persisting manualState to server:', manualState);
  try {
    await axios.post(API_ROOT + '/manualState', manualState);
    console.log('✅ manualState saved');
  } catch (err) {
    console.error('❌ manualState save failed', err);
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
