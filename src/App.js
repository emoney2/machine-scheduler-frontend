// === Section 1: Imports, Configuration & Initial Hooks ===
// File: frontend/src/App.js

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Section9 from './Section9';
import { parseDueDate, subWorkDays, fmtMMDD } from './helpers';

console.log('→ REACT_APP_API_ROOT =', process.env.REACT_APP_API_ROOT);
const API_ROOT      = process.env.REACT_APP_API_ROOT;
const WORK_START_HR = 8,  WORK_START_MIN = 30;
const WORK_END_HR   = 16, WORK_END_MIN   = 30;
const WEEKENDS      = [0,6];
const HOLIDAYS      = ['2025-01-01','2025-12-25'];

// color constants…
const LIGHT_YELLOW = '#FFF9C4', DARK_YELLOW  = '#FDD835';
const LIGHT_GREY   = '#ECEFF1', DARK_GREY    = '#616161';
const LIGHT_PURPLE = '#E1BEE7', DARK_PURPLE  = '#6A1B9A';
const BUBBLE_START = '#e0f7fa';
const BUBBLE_END   = '#ffe0b2';
const BUBBLE_DELIV = '#c8e6c9';

export default function App() {
  // --- state hooks ---
  const [columns, setColumns]           = useState({
    queue:    { title: 'Queue',     jobs: [] },
    machine1: { title: 'Machine 1', jobs: [] },
    machine2: { title: 'Machine 2', jobs: [] },
  });
  const [links, setLinks]               = useState(() => loadLinks());
  const [placeholders, setPlaceholders] = useState(() =>
    JSON.parse(localStorage.getItem('placeholders') || '[]')
  );
  const [syncStatus, setSyncStatus]     = useState('');
  const [showModal, setShowModal]       = useState(false);
  const [ph, setPh]                     = useState({
    id: null, company:'', quantity:'', stitchCount:'', inHand:'', dueType:'Hard Date'
  });

  // persist placeholders into localStorage
  useEffect(() => {
    localStorage.setItem('placeholders', JSON.stringify(placeholders));
  }, [placeholders]);

  // --- handleSync & polling ---
  const handleSync = async () => {
    setSyncStatus('');
    await fetchAll();
    setSyncStatus('updated');
    setTimeout(() => setSyncStatus(''), 2000);
  };

// === Section 1b: Initial load + polling ===
useEffect(() => {
  // 1) fetch immediately on mount
  fetchAll();

  // 2) then refetch every 30 seconds to keep all clients in sync
  const intervalId = setInterval(() => {
    fetchAll();
  }, 30_000);

  // 3) cleanup on unmount
  return () => clearInterval(intervalId);
}, []);

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
  const pad = n => String(n).padStart(2,'0');
  const month = pad(dt.getMonth() + 1);
  const day   = pad(dt.getDate());
  let h = dt.getHours(),
      m = pad(dt.getMinutes()),
      ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${month}/${day} ${pad(h)}:${m} ${ap}`;
}

function parseDueDate(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d);
  const parts = d.split('/');
  if (parts.length >= 2) {
    const mo = +parts[0], da = +parts[1],
          yr = parts.length === 3 ? +parts[2] : new Date().getFullYear();
    if (!isNaN(mo) && !isNaN(da) && !isNaN(yr)) return new Date(yr, mo-1, da);
  }
  const dt = new Date(d);
  return isNaN(dt) ? null : dt;
}

function addWorkDays(start, days) {
  let d = new Date(start), added = 0;
  while (added < days) {
    d.setDate(d.getDate()+1);
    if (isWorkday(d)) added++;
  }
  return d;
}

function subWorkDays(start, days) {
  let d = new Date(start), removed = 0;
  while (removed < days) {
    d.setDate(d.getDate()-1);
    if (isWorkday(d)) removed++;
  }
  return d;
}

function fmtMMDD(d) {
  const dt = new Date(d);
  const mo = String(dt.getMonth()+1).padStart(2,'0');
  const da = String(dt.getDate()).padStart(2,'0');
  return `${mo}/${da}`;
}

function sortQueue(arr) {
  return [...arr].sort((a,b) => {
    const da = parseDueDate(a.due_date), db = parseDueDate(b.due_date);
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
        const nowIso = new Date().toISOString();
        job.embroidery_start = nowIso;
        start = clampToWorkHours(new Date(nowIso));
        axios
          .put(`${API_ROOT}/orders/${job.id}`, { embroidery_start: nowIso })
          .catch(console.error);
      }
    } else {
      start = clampToWorkHours(new Date(prevEnd.getTime() + 30*60000));
    }

    // 3) Run → end
    const qty   = job.quantity % 6 === 0
      ? job.quantity
      : Math.ceil(job.quantity/6)*6;
    const runMs = (job.stitchCount/30000)*(qty/6)*3600000;
    const end   = addWorkTime(start, runMs);

    // 4) Decorate
    job._rawStart = start;
    job._rawEnd   = end;
    job.start     = fmtDT(start);
    job.end       = fmtDT(end);
    job.delivery  = fmtMMDD(addWorkDays(end,6));
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

// === Section 5: FETCH & MERGE (with Debug Logs) ===
const fetchAll = async () => {
  try {
    // 0) Debug your API root
    console.log('→ REACT_APP_API_ROOT =', API_ROOT);

    // 1) Load manualState from localStorage
    const manualState = JSON.parse(
      localStorage.getItem('manualState') ||
      JSON.stringify({ machine1: [], machine2: [] })
    );

    // 2) Preserve any previous embroidery_start so edits stick across sync
    const prevEmb = {};
    Object.values(columns)
      .flatMap(col => col.jobs)
      .forEach(job => {
        if (job.embroidery_start) prevEmb[job.id] = job.embroidery_start;
        else if (job.start_date)     prevEmb[job.id] = job.start_date;
      });

    // 3) Fetch live data in parallel
    const [ordersRes, embRes] = await Promise.all([
      axios.get(`${API_ROOT}/orders`),
      axios.get(`${API_ROOT}/embroideryList`)
    ]);

    // 3b) Debug the raw responses
    console.log('👀 orders from API:', ordersRes.data);
    console.log('👀 embroideryList from API:', embRes.data);

    const orders  = ordersRes.data;
    const embList = embRes.data;

    // 4) Build a lookup of embroidery start times from the sheet
    const embMap = {};
    embList.forEach(row => {
      const id = String(row['Order #'] || '').trim();
      if (id) embMap[id] = row['Embroidery Start Time'] || '';
    });

    // 5) Turn orders into a lookup by id, seeding start_date from embMap or prevEmb
    const jobById = {};
    orders.forEach(o => {
      const sid = String(o.id ?? '').trim();
      if (!sid) return;
      const rawTs = embMap[sid] ?? prevEmb[sid] ?? '';
      jobById[sid] = {
        ...o,
        id:               sid,
        company:          o.company,
        design:           o.design,
        quantity:         o.quantity,
        stitch_count:     o.stitch_count,
        due_date:         o.due_date,
        due_type:         o.due_type,
        embroidery_start: rawTs,
        start_date:       rawTs,
        machineId:        o.machineId || 'queue',
        linkedTo:         links[sid] || null
      };
    });

    // 6) Inject placeholders into jobById
    placeholders.forEach(ph => {
      jobById[ph.id] = {
        ...ph,
        id:               ph.id,
        company:          ph.company,
        design:           ph.design,
        quantity:         ph.quantity,
        stitch_count:     ph.stitchCount,
        due_date:         ph.inHand,
        due_type:         ph.dueType,
        embroidery_start: '',
        start_date:       '',
        machineId:        'queue',
        linkedTo:         links[ph.id] || null
      };
    });

    // 7) Apply manualState overrides for machine1 & machine2
    ['machine1','machine2'].forEach(colId => {
      (manualState[colId] || []).forEach(id => {
        if (jobById[id]) jobById[id].machineId = colId;
      });
    });

    // 8) Build & sort the queue
    const queueJobs = Object.values(jobById)
      .filter(j => !['machine1','machine2'].includes(j.machineId))
      .sort((a,b) => {
        const da = parseDueDate(a.due_date), db = parseDueDate(b.due_date);
        if (da && db) return da - db;
        if (da) return -1;
        if (db) return 1;
        return 0;
      });

    // 9) Build each machine’s list
    const buildMachine = colId => {
      const manualList = manualState[colId] || [];
      const fromManual = manualList.map(id => jobById[id]).filter(Boolean);
      const autoAppend = Object.values(jobById)
        .filter(j => j.machineId === colId && !manualList.includes(j.id));
      return [...fromManual, ...autoAppend];
    };
    const machine1Jobs = buildMachine('machine1');
    const machine2Jobs = buildMachine('machine2');

    // 9b) Debug the computed columns
    console.log('→ queueJobs:', queueJobs);
    console.log('→ machine1Jobs:', machine1Jobs);
    console.log('→ machine2Jobs:', machine2Jobs);

    // 10) Finally, update your state
    setColumns({
      queue:    { ...columns.queue,    jobs: queueJobs },
      machine1: { ...columns.machine1, jobs: scheduleMachineJobs(machine1Jobs) },
      machine2: { ...columns.machine2, jobs: scheduleMachineJobs(machine2Jobs) },
    });

  } catch (err) {
    console.error('fetchAll error:', err);
  }
};

// === Section 6: Placeholder CRUD ===
const submitPlaceholder = () => {
  const job = {
    id:         ph.id || `ph-${Date.now()}`,
    company:    ph.company,
    quantity:   +ph.quantity || 1,
    stitchCount:+ph.stitchCount || 30000,
    due_date:   ph.inHand,
    due_type:   ph.dueType,
    machineId:  'queue',
  };

  if (ph.id) {
    setPlaceholders(ps => ps.map(p => p.id === ph.id ? job : p));
    setColumns(c => ({
      ...c,
      queue:    { ...c.queue,    jobs: c.queue.jobs.map(j => j.id === ph.id ? job : j) },
      machine1: { ...c.machine1, jobs: c.machine1.jobs.map(j => j.id === ph.id ? job : j) },
      machine2: { ...c.machine2, jobs: c.machine2.jobs.map(j => j.id === ph.id ? job : j) },
    }));
  } else {
    setPlaceholders(ps => [job, ...ps]);
    setColumns(c => ({
      ...c,
      queue: { ...c.queue, jobs: [job, ...c.queue.jobs] }
    }));
  }

  setShowModal(false);
  setPh({ id:null, company:'', quantity:'', stitchCount:'', inHand:'', dueType:'Hard Date' });
};

const removePlaceholder = id => {
  setPlaceholders(ps => ps.filter(p => p.id !== id));
  setColumns(c => ({
    ...c,
    queue:    { ...c.queue,    jobs: c.queue.jobs.filter(j => j.id !== id) },
    machine1: { ...c.machine1, jobs: c.machine1.jobs.filter(j => j.id !== id) },
    machine2: { ...c.machine2, jobs: c.machine2.jobs.filter(j => j.id !== id) },
  }));
};

const editPlaceholder = job => {
  setPh({
    id:         job.id,
    company:    job.company,
    quantity:   job.quantity,
    stitchCount:job.stitchCount,
    inHand:     job.due_date,
    dueType:    job.due_type
  });
  setShowModal(true);
};
// === Section 7: Shared Link/Unlink Handler ===
const toggleLink = async (colId, idx) => {
  // Grab the two jobs we’re toggling between
  const jobs = columns[colId].jobs;
  const job  = jobs[idx];
  const next = jobs[idx + 1];
  if (!next) return;

  // Make a copy of the current link map
  const updated = { ...links };

  // Unlink if already linked, otherwise link them
  if (updated[job.id] === next.id) {
    delete updated[job.id];
  } else {
    updated[job.id] = next.id;
  }

  try {
    // Persist to the backend
    await axios.post(`${API_ROOT}/links`, updated);
    // Re-fetch everything so all open tabs/apps see the same state
    await fetchAll();
  } catch (err) {
    console.error('Link save error:', err);
  }
};


// === Section 8: Drag & Drop Handler (with proper unlink on Queue) ===
const onDragEnd = async result => {
  const { source, destination, draggableId } = result;
  if (!destination) return;

  const srcCol = source.droppableId;
  const dstCol = destination.droppableId;
  const srcIdx = source.index;
  const dstIdx = destination.index;

  // No-op if dropped back to the same place
  if (srcCol === dstCol && srcIdx === dstIdx) return;

  // 1) Extract the full linked-chain from src column
  const srcJobs    = Array.from(columns[srcCol].jobs);
  const chainIds   = getChain(srcJobs, draggableId);
  const chainJobs  = chainIds.map(id => srcJobs.find(j => j.id === id));
  const newSrcJobs = srcJobs.filter(j => !chainIds.includes(j.id));

  // —— same-column reorder ——
  if (srcCol === dstCol) {
    let insertAt = dstIdx;
    if (dstIdx > srcIdx) insertAt = dstIdx - chainJobs.length + 1;
    newSrcJobs.splice(insertAt, 0, ...chainJobs);
    setColumns(c => ({
      ...c,
      [srcCol]: {
        ...c[srcCol],
        jobs: scheduleMachineJobs(newSrcJobs)
      }
    }));
    return;
  }

  // —— cross-column move ——
  // A) Update manualState
  const manualState = JSON.parse(
    localStorage.getItem('manualState') ||
    JSON.stringify({ machine1: [], machine2: [] })
  );
  ['machine1','machine2'].forEach(col => {
    manualState[col] = (manualState[col]||[]).filter(id => !chainIds.includes(id));
  });
  if (dstCol==='machine1'||dstCol==='machine2') {
    const arr = Array.from(manualState[dstCol]||[]);
    arr.splice(dstIdx, 0, ...chainIds);
    manualState[dstCol] = arr;
  }
  localStorage.setItem('manualState', JSON.stringify(manualState));
  localStorage.setItem('manualStateMs', Date.now().toString());
  axios.post(`${API_ROOT}/manualState`, manualState).catch(console.error);

  // B) Build the destination array
  const dstJobs = Array.from(columns[dstCol].jobs);
  const moved   = chainJobs.map(j => ({
    ...j,
    machineId: dstCol==='queue' ? 'queue' : dstCol,
    ...(dstCol==='queue'
      ? { 
          // Clear all schedule fields when moving back to queue
          start:'', end:'', delivery:'',
          _rawStart: null, _rawEnd: null, isLate: false,
          linkedTo: null
        }
      : {}
    )
  }));
  dstJobs.splice(dstIdx, 0, ...moved);

  // C) If dropped into the queue, unlink that entire chain globally
  if (dstCol === 'queue') {
    const updated = { ...links };
    // remove any forward and reverse pointers
    chainIds.forEach(id => delete updated[id]);
    Object.keys(updated).forEach(k => {
      if (chainIds.includes(updated[k])) delete updated[k];
    });
    // persist and update local state
    await axios.post(`${API_ROOT}/links`, updated);
    setLinks(updated);
  }

  // D) Assemble new columns object
  const next = {
    ...columns,
    [srcCol]: { ...columns[srcCol], jobs: newSrcJobs },
    [dstCol]: { ...columns[dstCol], jobs: dstJobs }
  };

  // E) Always re-schedule machines and re-sort queue
  ['machine1','machine2'].forEach(c => {
    next[c].jobs = scheduleMachineJobs(next[c].jobs);
  });
  next.queue.jobs = next.queue.jobs.sort((a,b) => {
    const da = parseDueDate(a.due_date), db = parseDueDate(b.due_date);
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return 0;
  });

  setColumns(next);
};


// === Section 9: Render via Section9.jsx ===
  return (
    <div>
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
    </div>
  );
} // end of App component