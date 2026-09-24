import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { API_ROOT } from "./apiRoot";
import { socket } from "./socketClient";
import { extractFileId, estimateRemainingMs, formatClockET, jobImageUrl, normalizeOrderId } from "./machineFloorUtils";
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

function openJobImage(raw) {
  const id = extractFileId(raw);
  if (id) {
    window.open(`https://drive.google.com/file/d/${id}/view`, "_blank", "noopener,noreferrer");
    return;
  }
  if (/^https?:\/\//i.test(String(raw || ""))) {
    window.open(raw, "_blank", "noopener,noreferrer");
  }
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

function overlayEmbroidery(job, columns) {
  if (!job) return job;
  const found = findColumnJob(columns, job.orderNumber);
  const live = found?.job || {};
  const qty = Number(live.quantity ?? job.quantity) || 0;
  const done = Math.max(Number(live.completedQty ?? job.embroideryCompletedQty) || 0, 0);
  const stitch = Number(live.stitch_count ?? job.stitchCount) || 0;
  const heads = found?.headCount || Number(job.headCount) || 6;
  const avg = Number(live.avgCycleMs ?? job.avgCycleMs) || 0;
  const remainingFromJob = Number(
    live.embroideryRemaining ?? job.embroideryRemaining ?? (qty ? qty - done : 0)
  );
  const left = Math.max(0, Number.isFinite(remainingFromJob) ? remainingFromJob : Math.max(0, qty - done));
  const ready = left <= 0;
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
    image: job.image || live.imageLink || live.Image || live.image || "",
    imageFileId: job.imageFileId || live.imageFileId || "",
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

function isClosedOrBackJob(job, columns) {
  if (!job) return true;
  const stage = String(job.stage || job.status || "").toUpperCase();
  if (["SHIPPED", "COMPLETE", "COMPLETED", "CANCELED", "CANCELLED"].includes(stage)) return true;
  const product = String(job.product || "").toLowerCase();
  if (product.includes("back")) return true;
  const found = findColumnJob(columns, job.orderNumber);
  const liveStage = String(found?.job?.status || found?.job?.Stage || found?.job?.stage || "").toUpperCase();
  if (["SHIPPED", "COMPLETE", "COMPLETED"].includes(liveStage)) return true;
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
  const hard = !!job.hardDate;
  const embReady = !!job.embroideryReady;
  const thumb = jobImageUrl({
    image: job.image,
    imageLink: job.image,
    Image: job.image,
    imageFileId: job.imageFileId || extractFileId(job.image) || "",
  }, compact ? "w160" : "w240");
  const qtyLabel = `${Number(job.remainingQuantity || 0)}/${job.quantity ?? "—"}`;
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
          if (job.image) openJobImage(job.image);
        }}
        disabled={!job.image}
        title={job.image ? "Open artwork" : "No image"}
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
      <span className="sc-hs" title={hard ? "Hard date" : "Soft date"}>{hard ? "H" : "S"}</span>
      <div className="sc-row sc-row-main">
        <span className="sc-id">{job.orderNumber}</span>
        <span className="sc-company">{jobName(job)}</span>
        {job.overdue ? <span className="sc-late">LATE</span> : null}
        {!compact && <span className="sc-qty">{qtyLabel}</span>}
      </div>
      {!compact && (
        <>
          <span className="sc-bubble due">Due {fmtCardDate(job.dueDate)}</span>
          <span className="sc-bubble ship">Ship {fmtCardDate(job.requiredShipDate)}</span>
          {!embReady && (
            <div className="sc-emb">
              <strong>Emb not ready</strong>
              <span>{job.embroideryPercent || 0}%</span>
              <span>{etaLabel(job.embroideryEta) || "Waiting on machine"}</span>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function ColumnCards({ droppableId, ids, jobs, tv, compact }) {
  return (
    <Droppable droppableId={droppableId}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`sc-drop ${droppableId === QUEUE_ID ? "sc-queue-drop" : ""} ${snapshot.isDraggingOver ? "over" : ""}`}
        >
          {ids.map((id, index) => {
            const job = jobs[id];
            if (!job) return null;
            return (
              <Draggable key={id} draggableId={id} index={index}>
                {(drag) => (
                  <SewingJobCard job={job} drag={drag} tv={tv} compact={compact} />
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

export function SewingCalendar({ tv = false, columns }) {
  const draft = useMemo(() => (tv ? null : loadSewingBoardDraft()), [tv]);
  const [queue, setQueue] = useState(() => asList(draft?.queue));
  const [board, setBoard] = useState(() => (draft?.board && typeof draft.board === "object" ? draft.board : {}));
  const [jobs, setJobs] = useState({});
  const [days, setDays] = useState([]);
  const [carryovers, setCarryovers] = useState([]);
  const [absences, setAbsences] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const [dirty, setDirty] = useState(() => !!draft?.dirty);
  const [staffDate, setStaffDate] = useState("");
  const [queueOpen, setQueueOpen] = useState(() => {
    if (tv) return false;
    try { return localStorage.getItem("sewingQueueOpen") !== "0"; } catch { return true; }
  });
  const dirtyRef = useRef(!!draft?.dirty);
  const syncingRef = useRef(false);
  const placementsRef = useRef({ queue: asList(draft?.queue), board: draft?.board || {} });
  const rootRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    placementsRef.current = { queue, board };
  }, [queue, board]);

  const markClean = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
    clearSewingBoardDraft();
  }, []);

  const applyPayload = useCallback((data, { keepPlacements = false } = {}) => {
    if (!data || typeof data !== "object") return;
    const nextJobs = data.jobs && typeof data.jobs === "object" ? data.jobs : {};
    setJobs(nextJobs);
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
        const extras = Object.keys(nextJobs).filter((id) => !placedIds(prev, placementsRef.current.board).has(id));
        const next = extras.length ? [...prev, ...extras] : prev;
        placementsRef.current = { queue: next, board: placementsRef.current.board };
        if (dirtyRef.current) saveSewingBoardDraft(next, placementsRef.current.board);
        return next;
      });
      return;
    }
    setQueue(asList(data.queue));
    setBoard(data.board && typeof data.board === "object" ? data.board : {});
    markClean();
  }, [markClean]);

  const load = useCallback(async ({ publish = false } = {}) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      setError("");
      const shouldPublish = publish && dirtyRef.current;
      if (shouldPublish) {
        const { queue: nextQueue, board: nextBoard } = placementsRef.current;
        const { data } = await axios.put(
          `${ROOT}/sewing-board`,
          { queue: nextQueue, days: nextBoard },
          { timeout: 60000 }
        );
        applyPayload(data);
      } else {
        const { data } = await axios.get(`${ROOT}/sewing-board`, { timeout: 60000 });
        applyPayload(data, { keepPlacements: dirtyRef.current });
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      syncingRef.current = false;
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

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

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ publish: dirtyRef.current }), tv ? 45000 : 120000);
    const onBoard = () => {
      if (dirtyRef.current || syncingRef.current) return;
      load();
    };
    const onJobs = () => load({ publish: false });
    socket.on("sewingBoardUpdated", onBoard);
    socket.on("embroideryProgressUpdated", onJobs);
    socket.on("embroideryFinished", onJobs);
    return () => {
      window.clearInterval(timer);
      socket.off("sewingBoardUpdated", onBoard);
      socket.off("embroideryProgressUpdated", onJobs);
      socket.off("embroideryFinished", onJobs);
    };
  }, [load, tv]);

  const liveJobs = useMemo(() => {
    const next = {};
    const rolled = new Set(carryovers.map((row) => String(row.orderNumber)));
    Object.entries(jobs).forEach(([id, job]) => {
      const overdue = !!(job.overdue || job.overdueFrom);
      const merged = overlayEmbroidery({
        ...job,
        carriedOver: rolled.has(id),
        overdue,
      }, columns);
      if (isClosedOrBackJob(merged, columns)) return;
      next[id] = merged;
    });
    return next;
  }, [jobs, columns, carryovers]);

  const visibleQueue = useMemo(
    () => queue.filter((id) => liveJobs[id]),
    [queue, liveJobs]
  );
  const visibleBoard = useMemo(() => {
    const next = {};
    Object.entries(board).forEach(([day, ids]) => {
      next[day] = asList(ids).filter((id) => liveJobs[id]);
    });
    return next;
  }, [board, liveJobs]);

  const persistBoard = (nextQueue, nextBoard) => {
    placementsRef.current = { queue: nextQueue, board: nextBoard };
    dirtyRef.current = true;
    setQueue(nextQueue);
    setBoard(nextBoard);
    setDirty(true);
    saveSewingBoardDraft(nextQueue, nextBoard);
  };

  const onDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    const fromIds = idsForColumn(source.droppableId, visibleQueue, visibleBoard).slice();
    const [moved] = fromIds.splice(source.index, 1);
    if (!moved) return;
    let nextQueue = visibleQueue.slice();
    const nextBoard = { ...visibleBoard };
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

  const clearSchedule = async () => {
    if (!window.confirm("Clear the sewing calendar? Every job goes back to the queue so you can start from scratch.")) {
      return;
    }
    setClearing(true);
    try {
      setError("");
      markClean();
      const { data } = await axios.post(`${ROOT}/sewing-board/clear`, {}, { timeout: 60000 });
      applyPayload(data);
    } catch (e) {
      setError(friendlyError(e) || "Could not clear sewing board");
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    try { localStorage.setItem("sewingQueueOpen", queueOpen ? "1" : "0"); } catch (_) {}
  }, [queueOpen]);

  const week1 = days.slice(0, 5);
  const week2 = days.slice(5, 10);

  return (
    <main
      ref={rootRef}
      className={`ps-page sc-page ${tv ? "tv" : ""} ${queueOpen ? "" : "queue-collapsed"} ${isFullscreen ? "fs" : ""}`}
    >
      <div className="ps-header">
        <div className="ps-actions">
          {!tv && (
            <>
              <button type="button" onClick={() => setStaffDate(nextWeekdayIso())}>Staff</button>
              <button type="button" onClick={() => load({ publish: dirty })}>Refresh</button>
              {dirty ? <span className="sc-draft-hint">Saved here — Refresh to share</span> : null}
              <button type="button" className="ps-danger-button" onClick={clearSchedule} disabled={clearing}>
                {clearing ? "Clearing…" : "Clear schedule"}
              </button>
            </>
          )}
          <button
            type="button"
            className={`sc-fs-btn ${isFullscreen ? "on" : ""}`}
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
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
              <ColumnCards droppableId={QUEUE_ID} ids={visibleQueue} jobs={liveJobs} tv={tv} compact={false} />
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
                  return (
                    <section className={`sc-day ${day === days[0] ? "today" : ""} ${ids.length >= 5 ? "packed" : "sparse"}`} key={day}>
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
                      <ColumnCards droppableId={day} ids={ids} jobs={liveJobs} tv={tv} compact={ids.length >= 5} />
                    </section>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </DragDropContext>
    </main>
  );
}

export default SewingCalendar;
