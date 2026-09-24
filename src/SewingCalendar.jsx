import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { API_ROOT } from "./apiRoot";
import { socket } from "./socketClient";
import { extractFileId, estimateRemainingMs, formatClockET, normalizeOrderId } from "./machineFloorUtils";
import { persistSewingCarryover } from "./utils/sewingCarryover";
import { clearSewingBoardDraft, loadSewingBoardDraft, saveSewingBoardDraft } from "./utils/sewingBoardDraft";
import { StaffModal, nextWeekdayIso } from "./ProductionSchedule";
import "./ProductionSchedule.css";

const ROOT = `${API_ROOT}/schedule`;
const QUEUE_ID = "queue";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function friendlyError(err) {
  const raw = err?.response?.data?.error ?? err?.message ?? err;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw || "");
  if (/RATE_LIMIT|quota exceeded|429|attribute 'close'|NoneType|BadStatusLine|reentrant|temporarily busy/i.test(text)) {
    return "Google Sheets is temporarily busy. Wait about a minute and refresh.";
  }
  const compact = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}…` : compact || "Could not load sewing board";
}

function fmtCardDate(value) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split("-");
  return y && m && d ? `${Number(m)}/${Number(d)}` : String(value);
}

function dayHeading(value) {
  const raw = String(value || "").slice(0, 10);
  const dt = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return raw;
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  const md = dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" });
  return `${weekday} - ${md}`;
}

function outPhrase(names) {
  const people = (names || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!people.length) return "";
  if (people.length === 1) return `${people[0]} is out`;
  if (people.length === 2) return `${people[0]} and ${people[1]} are out`;
  return `${people.slice(0, -1).join(", ")}, and ${people[people.length - 1]} are out`;
}

function openJobImage(jobOrRaw) {
  const raw = typeof jobOrRaw === "object" && jobOrRaw
    ? (jobOrRaw.image || jobOrRaw.imageLink || jobOrRaw.Image || jobOrRaw.imageFileId || "")
    : jobOrRaw;
  const id = (typeof jobOrRaw === "object" && jobOrRaw?.imageFileId) || extractFileId(raw);
  if (id) {
    window.open(`https://drive.google.com/file/d/${id}/view`, "_blank", "noopener,noreferrer");
    return;
  }
  if (/^https?:\/\//i.test(String(raw || ""))) {
    window.open(raw, "_blank", "noopener,noreferrer");
  }
}

function extractFileIdFromFormulaOrUrl(input) {
  if (!input) return null;
  const s = String(input);
  let m = s.match(/IMAGE\("([^"]+)"/i);
  if (m) return extractFileIdFromFormulaOrUrl(m[1]);
  if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return s;
  m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/\/(?:open|uc)[^?]*\?[^#]*\bid=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/"id":"([A-Za-z0-9_-]{10,})"/);
  if (m) return m[1];
  return extractFileId(s);
}

function getJobThumbUrl(job, sz = "w240") {
  const proxyBase = String(API_ROOT || "").replace(/\/api$/, "") + "/api/drive/thumbnail";
  const proxyForId = (id) => (id ? `${proxyBase}?${new URLSearchParams({ fileId: id, sz })}` : "");
  const toThumb = (idOrUrl) => {
    if (!idOrUrl) return "";
    const id = extractFileIdFromFormulaOrUrl(idOrUrl);
    if (id) return proxyForId(id);
    const s = String(idOrUrl);
    if (/^https?:\/\//i.test(s)) return s;
    return "";
  };
  const fromAny = (val) => {
    if (!val) return "";
    if (Array.isArray(val)) {
      for (const item of val) {
        const hit = fromAny(item);
        if (hit) return hit;
      }
      return "";
    }
    if (typeof val === "object") {
      for (const key of ["imageUrl", "src", "url", "href", "link", "image", "thumbnail", "preview", "Image"]) {
        const hit = fromAny(val[key]);
        if (hit) return hit;
      }
      return "";
    }
    return toThumb(val);
  };
  for (const field of [
    job?.imageFileId,
    job?.imageUrl,
    job?.image,
    job?.imageLink,
    job?.artworkUrl,
    job?.thumbnailUrl,
    job?.Image,
    job?.Preview,
    job?.["Art Link"],
  ]) {
    const hit = fromAny(field);
    if (hit) return hit;
  }
  return "";
}

function isLocalDelivery(method) {
  return /local/i.test(String(method || ""));
}

function estimateTransitDays(method, zip, state, city) {
  if (isLocalDelivery(method)) return 0;
  const raw = String(method || "").toUpperCase();
  if (/NEXT DAY/.test(raw)) return 1;
  if (/2ND DAY|SECOND DAY/.test(raw)) return 2;
  if (/3 DAY/.test(raw)) return 3;
  const digits = String(zip || "").replace(/\D/g, "");
  const prefix = digits.slice(0, 3);
  const lead = prefix.slice(0, 1);
  const st = String(state || "").trim().toUpperCase().slice(0, 2);
  const cityKey = String(city || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (st === "GA" || prefix.startsWith("30") || prefix.startsWith("31")) return 1;
  if (["SC", "AL", "TN", "FL", "NC"].includes(st) || lead === "3") return 2;
  if (["VA", "WV", "KY", "MS", "LA", "MD", "DC", "DE", "PA", "NJ", "NY", "CT", "RI", "MA", "NH", "VT", "ME", "OH", "IN", "MI", "IL", "WI", "MO", "AR"].includes(st) || ["1", "2", "4"].includes(lead)) return 3;
  if (["CA", "OR", "WA", "HI", "AK"].includes(st) || ["8", "9"].includes(lead)) return 5;
  if (["TX", "OK", "KS", "NE", "SD", "ND", "MN", "IA", "AZ", "NM", "NV", "UT", "CO", "ID", "MT", "WY"].includes(st) || ["5", "6", "7"].includes(lead)) return 4;
  if (/(carlsbad|san diego|los angeles|la jolla|irvine|newport|orange county|san francisco|oakland|seattle|portland)/.test(cityKey)) return 5;
  return 3;
}

function subtractWorkdaysIso(iso, days) {
  const raw = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || days < 0) return "";
  const dt = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return "";
  let left = days;
  while (left > 0) {
    dt.setDate(dt.getDate() - 1);
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function requiredShipFromDue(dueIso, method, zip, state, city) {
  const due = String(dueIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return "";
  const hasHint = String(method || zip || state || city || "").trim();
  if (!hasHint) return "";
  const transit = estimateTransitDays(method, zip, state, city);
  const extra = isLocalDelivery(method) || transit <= 0 ? 0 : 1;
  return subtractWorkdaysIso(due, transit + extra);
}

function parseOverviewDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return parseOverviewDate(n);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (!m) return "";
  let [, mm, dd, yy] = m;
  if (!yy) yy = String(new Date().getFullYear());
  else if (yy.length === 2) yy = `20${yy}`;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function liveFromOverviewRow(row) {
  const image = row?.Image || row?.Preview || row?.["Art Link"] || row?.image || "";
  const qty = Number(String(row?.Quantity ?? row?.quantity ?? "").replace(/,/g, "")) || 0;
  return {
    Image: image,
    Preview: row?.Preview || image,
    image,
    imageLink: image,
    imageFileId: extractFileIdFromFormulaOrUrl(image) || "",
    "Art Link": row?.["Art Link"] || image,
    stage: row?.Stage || row?.stage || "",
    sewingSummaryComplete: !!row?.sewingSummaryComplete,
    customer: row?.["Company Name"] || row?.customer || "",
    product: row?.Product || row?.product || "",
    quantity: qty || undefined,
    dueDate: parseOverviewDate(row?.["Due Date"] || row?.dueDate),
    shippingMethod: row?.["Shipping Method"] || row?.shippingMethod || row?.["Ship Via"] || "",
    shipCity: row?.["Shipping City"] || row?.["Ship To City"] || row?.shipCity || "",
    shipState: row?.["Shipping State"] || row?.["Ship To State"] || row?.shipState || "",
    shipZip: row?.["Shipping Zip"] || row?.["Ship To Zip"] || row?.shipZip || "",
    requiredShipDate: "",
    due_type: row?.["Hard Date/Soft Date"] || row?.["Hard/Soft"] || row?.due_type || "",
    hardDate: /hard/i.test(String(row?.["Hard Date/Soft Date"] || row?.["Hard/Soft"] || "")),
  };
}

function shipTimestamp(job) {
  const raw = String(job?.requiredShipDate || job?.shipDate || "").slice(0, 10);
  if (!raw) return Number.POSITIVE_INFINITY;
  const stamp = new Date(`${raw}T00:00:00`).getTime();
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY;
}

function sortIdsByShip(ids, jobs) {
  return asList(ids).slice().sort((a, b) => {
    const delta = shipTimestamp(jobs[a]) - shipTimestamp(jobs[b]);
    if (delta) return delta;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });
}

function machineHeadCount(key, columns) {
  const title = String(columns?.[key]?.title || key || "");
  if (/machine 1|single/i.test(title) || key === "machine1") return 1;
  return Number(columns?.[key]?.headCount) || 6;
}

function findColumnJob(columns, orderNumber) {
  const want = normalizeOrderId(orderNumber);
  if (!want || !columns) return null;
  for (const key of ["machine1", "machine2", "machine3", "machine4", "queue"]) {
    const hit = (columns[key]?.jobs || []).find((j) => normalizeOrderId(j.id) === want);
    if (hit) return { job: hit, machineKey: key, headCount: machineHeadCount(key, columns) };
  }
  return null;
}

function isHardJob(job) {
  if (!job) return false;
  if (job.hardDate === true) return true;
  return /hard/i.test(String(job.due_type || job.dueType || job.hardDate || ""));
}

function overlayEmbroidery(job, columns) {
  if (!job) return job;
  const found = findColumnJob(columns, job.orderNumber);
  const live = found?.job || {};
  const qty = Number(live.quantity ?? job.quantity) || 0;
  const done = Math.max(Number(live.completedQty ?? job.embroideryCompletedQty) || 0, 0);
  const stitch = Number(live.stitch_count ?? job.stitchCount) || 0;
  const heads = found?.headCount || Number(job.headCount) || 6;
  const avg = Number(live.avgCycleMs ?? job.avgCycleMs) || 0;
  const rawLeft = live.embroideryRemaining ?? job.embroideryRemaining;
  const parsedLeft = Number(rawLeft);
  const left = rawLeft != null && rawLeft !== "" && Number.isFinite(parsedLeft)
    ? Math.max(0, parsedLeft)
    : Math.max(0, qty ? qty - done : 0);
  const embStatus = String(
    live.embroidery_status || live.embroideryStatus || job.embroidery_status || job.stage || ""
  ).toUpperCase();
  const sewingStage = /^(SEWING|COMPLETE|COMPLETED)$/.test(String(job.stage || live.status || "").toUpperCase());
  const ready = (
    sewingStage
    || embStatus === "COMPLETE"
    || embStatus === "COMPLETED"
    || (qty > 0 && done >= qty)
    || (done > 0 && left <= 0)
  );
  const percent = qty > 0 ? Math.min(100, Math.round((Math.min(done, qty) / qty) * 1000) / 10) : (ready ? 100 : 0);
  const remainingMs = left > 0 ? estimateRemainingMs(stitch, left, heads, avg) : 0;
  let eta = job.embroideryEta || "";
  if (!ready && remainingMs > 0) {
    const last = live.lastRunAt ? new Date(live.lastRunAt).getTime() : Date.now();
    const start = Number.isFinite(last) ? last : Date.now();
    eta = new Date(start + remainingMs).toISOString();
  }
  return {
    ...job,
    quantity: qty || job.quantity,
    stitchCount: stitch || job.stitchCount,
    embroideryCompletedQty: done,
    embroideryRemaining: left,
    embroideryPercent: ready ? 100 : percent,
    embroideryReady: ready,
    embroideryEta: ready ? "" : eta,
    avgCycleMs: avg,
    headCount: heads,
    hardDate: !!(job.hardDate || isHardJob(job) || isHardJob(live)),
    due_type: job.due_type || live.due_type || live.dueType || "",
    dueDate: job.dueDate || live.due_date || "",
    requiredShipDate: job.requiredShipDate || live.requiredShipDate || "",
    shippingMethod: job.shippingMethod || live.shippingMethod || "",
    shipCity: job.shipCity || live.shipCity || "",
    shipState: job.shipState || live.shipState || "",
    shipZip: job.shipZip || live.shipZip || "",
    customer: job.customer || live.company || "",
    product: job.product || live.product || "",
    quantity: qty || job.quantity,
    image: job.image || live.imageLink || live.Image || live.image || "",
    imageLink: job.imageLink || live.imageLink || job.image || live.image || "",
    imageFileId: job.imageFileId || live.imageFileId || extractFileId(job.image || live.imageLink || live.image) || "",
    artworkUrl: job.artworkUrl || live.artworkUrl || "",
  };
}

function etaLabel(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const now = new Date();
  const sameDay = dt.toLocaleDateString("en-US", { timeZone: "America/New_York" })
    === now.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const clock = formatClockET(iso);
  if (sameDay) return `Est. done ${clock}`;
  const day = dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "America/New_York",
  });
  return `Est. done ${day} ${clock}`;
}

function jobName(job) {
  return [job.customer, job.product].filter(Boolean).join(" - ") || "No company";
}

function embroideryStatus(job) {
  if (job?.embroideryReady) {
    return { kind: "ready", label: "Embroidery ready" };
  }
  const done = Number(job?.embroideryCompletedQty) || 0;
  const percent = Number(job?.embroideryPercent) || 0;
  if (done <= 0 && percent <= 0) {
    return { kind: "not-started", label: "Embroidery Not Started" };
  }
  return { kind: "progress", label: `${percent}% complete` };
}

function isClosedStage(value) {
  const stage = String(value || "").trim().toUpperCase();
  return ["SHIPPED", "COMPLETE", "COMPLETED", "CANCELED", "CANCELLED", "SEWN"].includes(stage);
}

function isClosedOrBackJob(job, columns) {
  if (!job) return true;
  if (job.sewingSummaryComplete || job.sewingComplete) return true;
  if (isClosedStage(job.stage || job.status || job.Stage)) return true;
  const qty = Number(job.quantity) || 0;
  const sewn = Number(job.sewingFinishedQty) || 0;
  if (qty > 0 && sewn >= qty) return true;
  const product = String(job.product || "").toLowerCase();
  if (product.includes("back")) return true;
  const found = findColumnJob(columns, job.orderNumber);
  if (isClosedStage(found?.job?.status || found?.job?.Stage || found?.job?.stage)) return true;
  const liveProduct = String(found?.job?.product || found?.job?.Product || "").toLowerCase();
  return liveProduct.includes("back");
}

function idsForColumn(columnId, queue, board) {
  if (columnId === QUEUE_ID) return asList(queue);
  return asList(board[columnId]);
}

function placedIds(queue, board) {
  const seen = new Set(asList(queue));
  Object.values(board || {}).forEach((ids) => {
    asList(ids).forEach((id) => seen.add(id));
  });
  return seen;
}

function CarryoverStrip({ carryovers }) {
  const [open, setOpen] = useState(false);
  const count = carryovers.length;
  if (!count) return null;
  return (
    <div className="sc-carry-strip">
      <button type="button" className="sc-carry-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="sc-carry-count">{count}</span>
        <span className="sc-carry-title">
          {count === 1 ? "Unfinished job rolled to today" : "Unfinished jobs rolled to today"}
        </span>
        <span className="sc-carry-hint">Yesterday’s leftover work is at the top of today</span>
        <span className="sc-carry-more">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="sc-carry-list">
          {carryovers.map((row) => (
            <div key={`${row.orderNumber}-${row.fromDate}`} className="sc-carry-row">
              <strong>#{row.orderNumber}</strong>
              <span>{[row.customer, row.product].filter(Boolean).join(" · ") || "Sewing job"}</span>
              <em>from {fmtCardDate(row.fromDate)}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SewingJobCard({ job, drag, tv, compact }) {
  const hard = isHardJob(job);
  const emb = embroideryStatus(job);
  const embReady = emb.kind === "ready";
  const thumb = getJobThumbUrl(job, "w240");
  const qtyLabel = String(Number(job.quantity ?? job.remainingQuantity ?? 0) || job.quantity || "—");
  const classes = [
    "sc-card",
    hard ? "hard" : "soft",
    compact ? "compact" : "",
    !embReady ? "emb-wait" : "",
    job.overdue ? "overdue" : "",
    job.carriedOver && !job.overdue ? "carried" : "",
  ].filter(Boolean).join(" ");
  return (
    <article
      className={classes}
      ref={drag.innerRef}
      {...drag.draggableProps}
      {...drag.dragHandleProps}
      style={drag.draggableProps.style}
    >
      <button
        type="button"
        className={`sc-thumb ${thumb ? "" : "missing"}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (thumb) openJobImage(job);
        }}
        disabled={!thumb}
        title={thumb ? "Open artwork" : "No image"}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <span>No img</span>
        )}
      </button>
      <div className="sc-card-body">
        <div className="sc-row sc-row-main">
          <span className="sc-id">{job.orderNumber}</span>
          <span className="sc-company">{jobName(job)}</span>
          <span className="sc-qty">{qtyLabel}</span>
          <span className="sc-hs" title={hard ? "Hard date" : "Soft date"}>{hard ? "H" : "S"}</span>
        </div>
        <div className="sc-meta">
          <span className="sc-bubble due" title="Due date">Due {fmtCardDate(job.dueDate)}</span>
          <span className="sc-bubble ship" title="Ship date">Ship {fmtCardDate(job.requiredShipDate)}</span>
          {job.overdue ? <span className="sc-late">LATE</span> : null}
          {embReady ? (
            <span className="sc-emb ready" title="Embroidery done">Done</span>
          ) : (
            <span className="sc-e" title={emb.label}>E</span>
          )}
        </div>
      </div>
    </article>
  );
}

function dayDensity(count) {
  if (count > 12) return { name: "density-12", rows: 6, cols: 2, scroll: true };
  if (count > 6) return { name: "density-12", rows: 6, cols: 2 };
  if (count > 3) return { name: "density-6", rows: 6, cols: 1 };
  return { name: "density-3", rows: 3, cols: 1 };
}

function ColumnCards({ droppableId, ids, jobs, tv, compact, density }) {
  const isQueue = droppableId === QUEUE_ID;
  const twoCol = !isQueue && (density?.cols || 1) > 1;
  return (
    <Droppable droppableId={droppableId}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`sc-drop ${isQueue ? "sc-queue-drop" : "sc-day-drop"} ${density?.name || ""} ${density?.scroll ? "can-scroll" : ""} ${twoCol ? "two-col" : ""} ${snapshot.isDraggingOver ? "over" : ""}`}
          style={!isQueue && density ? { "--rows": density.rows, "--cols": density.cols } : undefined}
        >
          {ids.map((id, index) => {
            const job = jobs[id];
            if (!job) return null;
            return (
              <Draggable key={id} draggableId={id} index={index}>
                {(drag) => (
                  <SewingJobCard job={job} drag={drag} tv={tv} compact={compact || twoCol} />
                )}
              </Draggable>
            );
          })}
          {provided.placeholder}
          {!ids.length && <div className="sc-empty-col">Drop jobs here</div>}
        </div>
      )}
    </Droppable>
  );
}

function QueuePane({ ids, jobs, tv }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event) => {
      el.scrollTop += event.deltaY;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);
  return (
    <div className="sc-queue-scroll" ref={scrollRef}>
      <ColumnCards droppableId={QUEUE_ID} ids={ids} jobs={jobs} tv={tv} compact={false} />
    </div>
  );
}

export function SewingCalendar({ tv = false, columns }) {
  const draft = useMemo(() => (tv ? null : loadSewingBoardDraft()), [tv]);
  const [queue, setQueue] = useState(() => asList(draft?.queue));
  const [board, setBoard] = useState(() => (draft?.board && typeof draft.board === "object" ? draft.board : {}));
  const [jobs, setJobs] = useState({});
  const [days, setDays] = useState([]);
  const [carryovers, setCarryovers] = useState([]);
  const [absences, setAbsences] = useState({});
  const [artByOrder, setArtByOrder] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [staffDate, setStaffDate] = useState("");
  const [queueOpen, setQueueOpen] = useState(() => {
    if (tv) return false;
    try { return localStorage.getItem("sewingQueueOpen") !== "0"; } catch { return true; }
  });
  const syncingRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const writeGuardUntilRef = useRef(0);
  const initialLoadRef = useRef(true);
  const jobsRef = useRef({});
  const placementsRef = useRef({ queue: asList(draft?.queue), board: draft?.board || {} });
  const rootRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    placementsRef.current = { queue, board };
  }, [queue, board]);

  const extendWriteGuard = useCallback((ms = 8000) => {
    writeGuardUntilRef.current = Math.max(writeGuardUntilRef.current, Date.now() + ms);
  }, []);

  const isWriteGuarded = useCallback(
    () => saveInFlightRef.current || Date.now() < writeGuardUntilRef.current,
    []
  );

  const applyPayload = useCallback((data, { keepPlacements = false } = {}) => {
    if (!data || typeof data !== "object") return;
    const nextJobs = data.jobs && typeof data.jobs === "object" ? data.jobs : {};
    const incomingCount = Object.keys(nextJobs).length;
    const currentCount = Object.keys(jobsRef.current).length;
    if (incomingCount > 0 || currentCount === 0) {
      jobsRef.current = nextJobs;
      setJobs(nextJobs);
    }
    setDays(asList(data.days));
    const rolled = asList(data.carryovers);
    setCarryovers(rolled);
    setAbsences(data.absences && typeof data.absences === "object" ? data.absences : {});
    persistSewingCarryover({
      carryovers: rolled,
      today: data.today,
      updatedAt: data.updatedAt,
      summary: { count: rolled.length },
    });
    if (keepPlacements) {
      setQueue((prev) => {
        const extras = Object.keys(jobsRef.current).filter((id) => !placedIds(prev, placementsRef.current.board).has(id));
        const next = extras.length ? sortIdsByShip([...prev, ...extras], jobsRef.current) : prev;
        placementsRef.current = { queue: next, board: placementsRef.current.board };
        return next;
      });
      return;
    }
    setQueue(asList(data.queue));
    setBoard(data.board && typeof data.board === "object" ? data.board : {});
    clearSewingBoardDraft();
  }, []);

  const load = useCallback(async () => {
    if (syncingRef.current || saveInFlightRef.current) return;
    syncingRef.current = true;
    try {
      setError("");
      const { data } = await axios.get(`${ROOT}/sewing-board`, { timeout: 60000 });
      const keep = !initialLoadRef.current || isWriteGuarded();
      applyPayload(data, { keepPlacements: keep });
      initialLoadRef.current = false;
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      syncingRef.current = false;
      setLoading(false);
    }
  }, [applyPayload, isWriteGuarded]);

  useEffect(() => {
    const syncFs = () => {
      const el = rootRef.current;
      setIsFullscreen(!!(document.fullscreenElement && el && document.fullscreenElement === el));
    };
    document.addEventListener("fullscreenchange", syncFs);
    return () => document.removeEventListener("fullscreenchange", syncFs);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const el = rootRef.current;
      if (el?.requestFullscreen) await el.requestFullscreen();
    } catch (e) {
      console.warn("Fullscreen failed:", e);
    }
  };

  const loadArt = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_ROOT}/overview`, { timeout: 45000 });
      const map = {};
      for (const row of asList(data?.upcoming)) {
        const oid = normalizeOrderId(row?.["Order #"] || row?.orderNumber);
        if (!oid) continue;
        map[oid] = liveFromOverviewRow(row);
      }
      if (!Object.keys(map).length) return;
      setArtByOrder(map);
    } catch (_) {
      /* board still works without artwork */
    }
  }, []);

  useEffect(() => {
    loadArt();
    const artTimer = window.setInterval(loadArt, 45000);
    return () => window.clearInterval(artTimer);
  }, [loadArt, tv]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, tv ? 45000 : 60000);
    const onBoard = () => {
      if (isWriteGuarded() || syncingRef.current) return;
      load();
      loadArt();
    };
    const onJobs = () => {
      load();
      loadArt();
    };
    socket.on("sewingBoardUpdated", onBoard);
    socket.on("embroideryProgressUpdated", onJobs);
    socket.on("embroideryFinished", onJobs);
    return () => {
      window.clearInterval(timer);
      socket.off("sewingBoardUpdated", onBoard);
      socket.off("embroideryProgressUpdated", onJobs);
      socket.off("embroideryFinished", onJobs);
    };
  }, [load, loadArt, tv, isWriteGuarded]);

  const liveJobs = useMemo(() => {
    const next = {};
    const rolled = new Set(carryovers.map((row) => String(row.orderNumber)));
    const mergeOne = (id, job, live) => {
      const overdue = !!(job.overdue || job.overdueFrom);
      const qty = Number(live.quantity || job.quantity) || 0;
      const dueDate = live.dueDate || job.dueDate;
      const shippingMethod = live.shippingMethod || job.shippingMethod;
      const shipCity = live.shipCity || job.shipCity;
      const shipState = live.shipState || job.shipState;
      const shipZip = live.shipZip || job.shipZip;
      const computedShip = requiredShipFromDue(dueDate, shippingMethod, shipZip, shipState, shipCity);
      const merged = overlayEmbroidery({
        ...job,
        ...live,
        orderNumber: job.orderNumber || id,
        customer: live.customer || job.customer,
        product: live.product || job.product,
        quantity: qty || job.quantity,
        remainingQuantity: live.sewingSummaryComplete ? 0 : (job.remainingQuantity ?? qty),
        dueDate,
        shippingMethod,
        shipCity,
        shipState,
        shipZip,
        requiredShipDate: computedShip || job.requiredShipDate,
        due_type: live.due_type || job.due_type,
        hardDate: live.due_type ? !!live.hardDate : !!(live.hardDate || job.hardDate),
        image: live.image || job.image,
        imageLink: live.imageLink || job.imageLink,
        Image: live.Image || job.Image,
        imageFileId: live.imageFileId || job.imageFileId,
        stage: live.stage || job.stage,
        sewingSummaryComplete: !!(live.sewingSummaryComplete || job.sewingSummaryComplete),
        carriedOver: rolled.has(id),
        overdue,
      }, columns);
      if (isClosedOrBackJob(merged, columns)) return;
      next[id] = merged;
    };
    Object.entries(jobs).forEach(([id, job]) => {
      const live = artByOrder[normalizeOrderId(id)] || artByOrder[id] || {};
      mergeOne(id, job, live);
    });
    return next;
  }, [jobs, columns, carryovers, artByOrder]);

  const visibleQueue = useMemo(() => {
    const placed = placedIds(queue, board);
    const extras = Object.keys(liveJobs).filter((id) => !placed.has(id));
    return sortIdsByShip([...queue.filter((id) => liveJobs[id]), ...extras], liveJobs);
  }, [queue, board, liveJobs]);
  const visibleBoard = useMemo(() => {
    const next = {};
    Object.entries(board).forEach(([day, ids]) => {
      next[day] = asList(ids).filter((id) => liveJobs[id]);
    });
    return next;
  }, [board, liveJobs]);

  const persistBoard = async (nextQueue, nextBoard) => {
    const sortedQueue = sortIdsByShip(nextQueue, liveJobs);
    placementsRef.current = { queue: sortedQueue, board: nextBoard };
    extendWriteGuard();
    setQueue(sortedQueue);
    setBoard(nextBoard);
    saveSewingBoardDraft(sortedQueue, nextBoard);
    try {
      saveInFlightRef.current = true;
      const { data } = await axios.put(
        `${ROOT}/sewing-board`,
        { queue: sortedQueue, days: nextBoard },
        { timeout: 60000 }
      );
      applyPayload(data, { keepPlacements: true });
      extendWriteGuard();
      clearSewingBoardDraft();
    } catch (e) {
      setError(friendlyError(e) || "Could not save sewing board");
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const onDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    const fromIds = idsForColumn(source.droppableId, visibleQueue, visibleBoard).slice();
    const [moved] = fromIds.splice(source.index, 1);
    if (!moved) return;
    let nextQueue = visibleQueue.slice();
    const nextBoard = { ...board, ...visibleBoard };
    if (source.droppableId === QUEUE_ID) nextQueue = fromIds;
    else nextBoard[source.droppableId] = fromIds;
    if (destination.droppableId === QUEUE_ID) {
      const dest = nextQueue.slice();
      dest.splice(destination.index, 0, moved);
      nextQueue = dest;
    } else {
      const dest = (nextBoard[destination.droppableId] || []).slice();
      dest.splice(destination.index, 0, moved);
      nextBoard[destination.droppableId] = dest;
    }
    persistBoard(nextQueue, nextBoard);
  };

  useEffect(() => {
    try { localStorage.setItem("sewingQueueOpen", queueOpen ? "1" : "0"); } catch (_) {}
  }, [queueOpen]);

  const week1 = days.slice(0, 5);
  const week2 = days.slice(5, 10);

  return (
    <div
      ref={rootRef}
      className={`sc-fs-root ${isFullscreen ? "fs" : ""} ${tv ? "tv" : ""}`}
      style={{
        background: "#fff",
        minHeight: isFullscreen ? "100vh" : undefined,
        height: isFullscreen ? "100vh" : undefined,
        boxSizing: "border-box",
        overflow: isFullscreen ? "auto" : undefined,
      }}
    >
    <main
      className={`ps-page sc-page ${tv ? "tv" : ""} ${queueOpen ? "" : "queue-collapsed"} ${isFullscreen ? "fs" : ""}`}
    >
      <div className="ps-header">
        <div className="ps-actions">
          {!tv && (
            <button type="button" onClick={() => setStaffDate(nextWeekdayIso())}>Staff</button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              background: isFullscreen ? "#111827" : "#fff",
              color: isFullscreen ? "#fff" : "#111827",
              cursor: "pointer",
              flexShrink: 0,
              marginLeft: "auto",
            }}
          >
            {isFullscreen ? "Exit" : "Full"}
          </button>
        </div>
      </div>
      {staffDate && (
        <StaffModal
          date={staffDate}
          onClose={() => setStaffDate("")}
          onSaved={async () => { await load(); }}
        />
      )}
      {error ? <div className="ps-banner danger">{error}</div> : null}
      <CarryoverStrip carryovers={carryovers} />
      {loading && !days.length ? <div className="ps-empty">Loading sewing board…</div> : null}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="sc-layout">
          <aside
            className={`sc-queue ${queueOpen ? "" : "collapsed"}`}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="sc-queue-head">
              <button
                type="button"
                className="sc-queue-toggle"
                onClick={() => setQueueOpen((v) => !v)}
                title={queueOpen ? "Minimize queue" : "Maximize queue"}
                aria-label={queueOpen ? "Minimize queue" : "Maximize queue"}
              >
                <span className={`sc-arrow ${queueOpen ? "open" : ""}`} aria-hidden="true" />
              </button>
              <h2>Queue <span>{visibleQueue.length}</span></h2>
            </div>
            {queueOpen && (
              <QueuePane ids={visibleQueue} jobs={liveJobs} tv={tv} />
            )}
            {!queueOpen && (
              <Droppable droppableId={QUEUE_ID}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`sc-queue-rail ${snapshot.isDraggingOver ? "over" : ""}`}
                  >
                    {provided.placeholder}
                    <span>{visibleQueue.length}</span>
                  </div>
                )}
              </Droppable>
            )}
          </aside>
          <div className="sc-weeks">
            {[week1, week2].map((week, weekIndex) => (
              <div className="sc-week" key={weekIndex}>
                {week.map((day) => {
                  const ids = asList(visibleBoard[day]);
                  const whoIsOut = outPhrase(absences[day] || []);
                  const density = dayDensity(ids.length);
                  return (
                    <section className={`sc-day ${day === days[0] ? "today" : ""} ${density.name}${density.scroll ? " can-scroll" : ""}`} key={day}>
                      <header>
                        <button
                          type="button"
                          className="ps-day-staff"
                          onClick={() => !tv && setStaffDate(day)}
                          disabled={tv}
                        >
                          <span className="sc-day-title">{dayHeading(day)}</span>
                          {whoIsOut ? <span className="ps-day-out">{whoIsOut}</span> : null}
                        </button>
                      </header>
                      <ColumnCards
                        droppableId={day}
                        ids={ids}
                        jobs={liveJobs}
                        tv={tv}
                        density={density}
                      />
                    </section>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </DragDropContext>
    </main>
    </div>
  );
}

export default SewingCalendar;
