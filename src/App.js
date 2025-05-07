// === Section 1: Imports & Configuration ===
// File: frontend/src/App.js
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import axios from 'axios';
import Section9 from './Section9';
import { parseDueDate, subWorkDays, fmtMMDD } from './helpers';

// CONFIGURATION
const API_ROOT = 'https://machine-scheduler-backend.onrender.com/api';
const WORK_START_HR  = 8,  WORK_START_MIN = 30;
const WORK_END_HR    = 16, WORK_END_MIN   = 30;
const WEEKENDS       = [0,6];
const HOLIDAYS       = ['2025-01-01','2025-12-25'];

// COLOR CONSTANTS
const LIGHT_YELLOW  = '#FFF9C4', DARK_YELLOW  = '#FDD835';
const LIGHT_GREY    = '#ECEFF1', DARK_GREY    = '#616161';
const LIGHT_PURPLE  = '#E1BEE7', DARK_PURPLE  = '#6A1B9A';
const BUBBLE_START  = '#e0f7fa';
const BUBBLE_END    = '#ffe0b2';
const BUBBLE_DELIV  = '#c8e6c9';

export default function App() {
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
  const [links, setLinks]           = useState(loadLinks());
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
    fetchAll();
  }, []);

  // Manual sync handler
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

// === Section 5: FETCH & MERGE (with Placeholder Injection) ===
const fetchAll = async () => {
  try {
    // 1) Load manual state from server
    let manualState = { machine1: [], machine2: [] };
    try {
      const resp = await axios.get(`${API_ROOT}/manualState`);
      manualState = resp.data.state;
    } catch (err) {
      console.error('⚠️ manualState fetch error:', err);
    }

    // 2) Preserve embroidery_start from previous run
    const prevEmb = {};
    Object.values(columns)
      .flatMap((col) => col.jobs)
      .forEach((j) => {
        prevEmb[j.id] = j.embroidery_start || j.start_date || '';
      });

    // 3) Fetch live data
    const [{ data: orders }, { data: embList }] = await Promise.all([
      axios.get(`${API_ROOT}/orders`),
      axios.get(`${API_ROOT}/embroideryList`),
    ]);

    // 4) Build embroidery map
    const embMap = {};
    embList.forEach((row) => {
      const id = String(row['Order #'] || '').trim();
      if (id) embMap[id] = row['Embroidery Start Time'] || '';
    });

    // 5) Construct jobById from server data
    const jobById = {};
    orders.forEach((o) => {
      if (o.id == null) return;
      const id = String(o.id).trim();
      const rawTs = embMap[id] ?? prevEmb[id] ?? '';
      jobById[id] = {
        ...o,
        id,
        stitchCount: o.stitch_count,
        quantity: o.quantity,
        company: o.company,
        design: o.design,
        due_date: o.due_date,
        due_type: o.due_type,
        embroidery_start: rawTs,
        start_date: rawTs,
        linkedTo: links[o.id] || null,
        machineId: o.machineId ?? o.machine ?? '',
      };
    });

    // 5.5) Override machineId from manualState so queue omits those jobs
    Object.entries(manualState).forEach(([colId, idList]) => {
      idList.forEach((jid) => {
        if (jobById[jid]) {
          jobById[jid].machineId = colId;
        }
      });
    });

    // 6) Inject placeholders into jobById (preserve any saved link)
    placeholders.forEach((phJob) => {
      jobById[phJob.id] = {
        ...phJob,
        machineId: 'queue',
        embroidery_start: '',
        start_date: '',
        linkedTo: links[phJob.id] || null,
      };
    });

    // 7) Apply manualState overrides AND preserve manual order
    const buildMachine = (colId) => {
      const manualList = manualState[colId] || [];
      const ordered = manualList
        .map((jid) => jobById[jid])
        .filter((j) => j);
      const appended = Object.values(jobById).filter(
        (j) => j.machineId === colId && !manualList.includes(j.id)
      );
      return [...ordered, ...appended];
    };
    const machine1Jobs = buildMachine('machine1');
    const machine2Jobs = buildMachine('machine2');

    // 8) Build & sort queue only
    const queueJobs = Object.values(jobById)
      .filter((j) => !['machine1', 'machine2'].includes(j.machineId))
      .sort((a, b) => {
        const da = parseDueDate(a.due_date),
          db = parseDueDate(b.due_date);
        if (da && db) return da - db;
        if (da) return -1;
        if (db) return 1;
        return 0;
      });

    // 9) Schedule machine runtimes (but do not re-sort)
    setColumns({
      queue: { ...columns.queue, jobs: queueJobs },
      machine1: {
        ...columns.machine1,
        jobs: scheduleMachineJobs(machine1Jobs),
      },
      machine2: {
        ...columns.machine2,
        jobs: scheduleMachineJobs(machine2Jobs),
      },
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
// === Section 7: toggleLink (full replacement) ===
const toggleLink = (colId, idx) => {
  // step 1: read current link-map and our working columns
  const currentMap = loadLinks();
  const colJobs   = columns[colId].jobs;
  const thisId    = colJobs[idx]?.id;
  const nextId    = colJobs[idx + 1]?.id;
  if (!thisId || !nextId) return;

  // step 2: flip it in our persisted map
  if (currentMap[thisId] === nextId) {
    delete currentMap[thisId];
  } else {
    currentMap[thisId] = nextId;
  }
  saveLinks(currentMap);
  setLinks(currentMap);

  // step 3: rebuild all job.linkedTo flags from scratch
  setColumns(cols => {
    const newCols = {};
    Object.entries(cols).forEach(([cId, col]) => {
      newCols[cId] = {
        ...col,
        jobs: col.jobs.map(job => ({
          ...job,
          // clear every linkedTo first
          linkedTo: null
        }))
      };
    });

    // step 4: re-apply only the links still in currentMap
    Object.entries(newCols).forEach(([cId, col]) => {
      newCols[cId].jobs = col.jobs.map(job => {
        const target = currentMap[job.id];
        return target ? { ...job, linkedTo: target } : job;
      });
    });

    return newCols;
  });
};

// === Section 8: Drag & Drop Handler (with Chain-aware Moves) ===
const onDragEnd = async (result) => {
  const { source, destination, draggableId } = result;
  if (!destination) return;

  const srcCol = source.droppableId;
  const dstCol = destination.droppableId;
  const srcIdx = source.index;
  const dstIdx = destination.index;

  if (srcCol === dstCol && srcIdx === dstIdx) return;

  // get current jobs in source column
  const srcJobs = Array.from(columns[srcCol].jobs);

  // find chain and remove it
  const chainIds = getChain(srcJobs, draggableId);
  const chainJobs = chainIds.map(id => srcJobs.find(j => j.id === id));
  const newSrcJobs = srcJobs.filter(j => !chainIds.includes(j.id));

  // moving within same column
  if (srcCol === dstCol) {
    let insertAt = dstIdx;
    if (dstIdx > srcIdx) insertAt = dstIdx - chainJobs.length + 1;
    newSrcJobs.splice(insertAt, 0, ...chainJobs);

    // schedule in that exact order
    setColumns(cols => ({
      ...cols,
      [srcCol]: {
        ...cols[srcCol],
        jobs: scheduleMachineJobs(newSrcJobs)
      }
    }));
    return;
  }

  // ——— cross-column ———
  // 1) update manualState
  const manualState = JSON.parse(
    localStorage.getItem('manualState') ||
    JSON.stringify({ machine1: [], machine2: [] })
  );
  ['machine1','machine2'].forEach(col => {
    manualState[col] = manualState[col].filter(id => !chainIds.includes(id));
  });
  if (dstCol === 'machine1' || dstCol === 'machine2') {
    const arr = Array.from(manualState[dstCol]||[]);
    arr.splice(dstIdx, 0, ...chainIds);
    manualState[dstCol] = arr;
  }
  localStorage.setItem('manualState', JSON.stringify(manualState));
  try {
    await axios.post(`${API_ROOT}/manualState`, manualState);
  } catch(err) {
    console.error('⚠️ manualState save error:', err);
  }

  // 2) build new columns
  const dstJobs = Array.from(columns[dstCol].jobs);
  let movedJobs = chainJobs;
  if (dstCol === 'queue') {
    // unlink chain if needed…
    movedJobs = chainJobs.map(j => ({ ...j, machineId: 'queue', start:'', end:'', delivery:'', _rawStart:null, _rawEnd:null, isLate:false, linkedTo:null }));
    dstJobs.splice(dstIdx, 0, ...movedJobs);
  } else {
    movedJobs = chainJobs.map(j => ({ ...j, machineId: dstCol }));
    dstJobs.splice(dstIdx, 0, ...movedJobs);
  }

  // 3) commit new columns
  const next = {
    ...columns,
    [srcCol]: { ...columns[srcCol], jobs: newSrcJobs },
    [dstCol]: { ...columns[dstCol], jobs: dstJobs }
  };

  // 4) schedule but do NOT sort machines
  ['machine1','machine2'].forEach(col => {
    next[col].jobs = scheduleMachineJobs(next[col].jobs);
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