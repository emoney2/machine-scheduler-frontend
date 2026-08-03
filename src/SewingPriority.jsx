import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { socket } from "./socketClient";

const ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");
/** Tile board horizon (~one month). */
const BOARD_DAYS_WINDOW = 30;
/** Catch-up tracker uses the same one-month window as the board. */
const CATCH_UP_DAYS_WINDOW = 30;

/** Mon–Fri sewing capacity. */
const WORKDAY_PCS = 48;
const WORK_START_H = 8; // 8:00
const WORK_END_H = 16; // 16:00
const HOURS_PER_WORKDAY = WORK_END_H - WORK_START_H;
const PCS_PER_HOUR = WORKDAY_PCS / HOURS_PER_WORKDAY;

function parseDate(s) {
  if (s === null || s === undefined || s === "") return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  if (typeof s === "number") {
    const base = new Date(1899, 11, 30);
    const dt = new Date(base.getTime() + s * 86400000);
    return isNaN(dt) ? null : dt;
  }
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.split("T")[0].split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return isNaN(dt) ? null : dt;
  }
  const parts = str.split(/[\/\-]/).map((p) => p.trim());
  if (parts.length >= 2) {
    let [m, d, y] = parts.map(Number);
    if (!y) y = new Date().getFullYear();
    else if (y < 100) y += 2000;
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return isNaN(dt) ? null : dt;
  }
  return null;
}

function daysUntil(dateLike) {
  const dt = parseDate(dateLike);
  if (!dt) return null;
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  return Math.round((b - a) / 86400000);
}

function fmtMMDD(d) {
  const dt = parseDate(d);
  if (!dt) return "—";
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${mo}/${da}`;
}

function getJobStage(job) {
  const fromStage = (job["Stage"] ?? job["stage"] ?? "").toString().trim();
  const fromStatus = (job["Status"] ?? job["status"] ?? "").toString().trim();
  const fromJobStage = (job["Job Stage"] ?? job["JobStage"] ?? "").toString().trim();
  return (fromStatus || fromJobStage || fromStage || "").toUpperCase();
}

function isStageCompleted(job) {
  const stage = getJobStage(job);
  return stage === "COMPLETE" || stage === "COMPLETED";
}

function isJobInTimeWindow(job, daysWindowNum) {
  const shipDate = job["Ship Date"] ?? job["Ship"] ?? null;
  const dueDate = job["Due Date"] ?? job["Due"] ?? null;
  const daysToShip = shipDate != null ? daysUntil(shipDate) : null;
  const daysToDue = dueDate != null ? daysUntil(dueDate) : null;
  const days = daysToShip ?? daysToDue;
  if (days === null) return false;
  return days <= daysWindowNum;
}

/** Green = on time, yellow = ship today, red = catch up (overdue). */
function outlineByShipDate(shipDate) {
  const d = daysUntil(shipDate);
  if (d === null) return "#9ca3af";
  if (d < 0) return "#e74c3c";
  if (d === 0) return "#f1c40f";
  return "#2ecc71";
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isWeekday(d) {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

/** Hours of sewing still available today (0 on weekends / after 4pm). */
function remainingWorkHoursToday(now = new Date()) {
  if (!isWeekday(now)) return 0;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), WORK_START_H, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), WORK_END_H, 0, 0, 0);
  if (now >= end) return 0;
  if (now <= start) return HOURS_PER_WORKDAY;
  return (end.getTime() - now.getTime()) / 3600000;
}

function remainingCapacityToday(now = new Date()) {
  return remainingWorkHoursToday(now) * PCS_PER_HOUR;
}

/** Capacity from now through end of ship date (Mon–Fri only, partial today). */
function capacityThroughShipDate(shipDate, now = new Date()) {
  const ship = parseDate(shipDate);
  if (!ship) return 0;
  const shipDay = startOfLocalDay(ship);
  const today = startOfLocalDay(now);

  if (shipDay.getTime() < today.getTime()) {
    return remainingCapacityToday(now);
  }
  if (shipDay.getTime() === today.getTime()) {
    return remainingCapacityToday(now);
  }

  let cap = remainingCapacityToday(now);
  const cursor = new Date(today);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor.getTime() <= shipDay.getTime()) {
    if (isWeekday(cursor)) cap += WORKDAY_PCS;
    cursor.setDate(cursor.getDate() + 1);
  }
  return cap;
}

/** Workdays from today through ship date (today counts only if hours remain). */
function workdaysThroughShipDate(shipDate, now = new Date()) {
  const ship = parseDate(shipDate);
  if (!ship) return 0;
  const shipDay = startOfLocalDay(ship);
  const today = startOfLocalDay(now);

  if (shipDay.getTime() < today.getTime()) {
    return remainingWorkHoursToday(now) > 0 ? 1 : 0;
  }

  let n = 0;
  const cursor = new Date(today);
  while (cursor.getTime() <= shipDay.getTime()) {
    if (isWeekday(cursor)) {
      if (cursor.getTime() === today.getTime()) {
        if (remainingWorkHoursToday(now) > 0) n += 1;
      } else {
        n += 1;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return n;
}

function jobQty(job) {
  const raw = job?.["Quantity"] ?? job?.["Qty"];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Still shown on the board, but not counted in catch-up capacity math.
 * Back panels / towels / belts are not part of the 48/day sewing load.
 */
function excludeFromCatchUpLoad(job) {
  const product = String(job?.["Product"] ?? "").toLowerCase();
  if (!product) return false;
  if (/\bback\b/.test(product)) return true;
  if (/\btowels?\b/.test(product)) return true;
  if (/\bbelts?\b/.test(product)) return true;
  return false;
}

/**
 * Running catch-up: walk jobs by ship date; max(cum demand − capacity through that date).
 * Sewing-complete, Back, towel, and belt jobs are excluded from the load
 * (they still appear on the tile board).
 */
function computeCatchUpTracker(jobs, now = new Date()) {
  const hoursLeft = remainingWorkHoursToday(now);
  const pcsLeftToday = Math.max(0, Math.round(remainingCapacityToday(now)));

  let cumDemand = 0;
  let maxDeficit = 0;
  let bottleneckShip = null;

  for (const job of jobs || []) {
    if (job?.sewingSummaryComplete) continue;
    if (excludeFromCatchUpLoad(job)) continue;
    const ship = job["Ship Date"] ?? job["Ship"] ?? null;
    if (parseDate(ship) == null) continue;
    const qty = jobQty(job);
    if (qty <= 0) continue;

    cumDemand += qty;
    const cap = capacityThroughShipDate(ship, now);
    const deficit = cumDemand - cap;
    if (deficit > maxDeficit + 1e-9) {
      maxDeficit = deficit;
      bottleneckShip = ship;
    }
  }

  const extraPcs = maxDeficit > 1e-9 ? Math.ceil(maxDeficit - 1e-9) : 0;
  const overWorkdays = bottleneckShip ? workdaysThroughShipDate(bottleneckShip, now) : 0;
  const perDay =
    extraPcs > 0
      ? overWorkdays > 0
        ? Math.round((extraPcs / overWorkdays) * 10) / 10
        : extraPcs
      : 0;

  return {
    extraPcs,
    overWorkdays,
    perDay,
    hoursLeft,
    pcsLeftToday,
    bottleneckShip,
    openPcs: cumDemand,
  };
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
  return null;
}

function getJobThumbUrl(job) {
  const apiRoot = ROOT;
  const proxyBase = apiRoot.replace(/\/api$/, "") + "/api/drive/thumbnail";

  const proxyForId = (id) => {
    if (!id) return null;
    return `${proxyBase}?${new URLSearchParams({ fileId: id, sz: "w320" })}`;
  };

  const toThumb = (idOrUrl) => {
    if (!idOrUrl) return null;
    const id = extractFileIdFromFormulaOrUrl(idOrUrl);
    if (id) return proxyForId(id);
    const s = String(idOrUrl);
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return proxyForId(s);
    return null;
  };

  const fromAny = (val) => {
    if (!val) return null;
    if (Array.isArray(val)) {
      for (const v of val) {
        const hit = fromAny(v);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof val === "object") {
      for (const c of [
        val.imageUrl,
        val.src,
        val.url,
        val.href,
        val.link,
        val.image,
        val.thumbnail,
        val.preview,
      ]) {
        const hit = fromAny(c);
        if (hit) return hit;
      }
      return null;
    }
    return toThumb(val);
  };

  const fields = [
    job.imageUrl,
    job.image,
    job.thumbnailUrl,
    job.ImageURL,
    job.preview,
    job.Preview,
    job.Image,
    job.thumbnail,
    job.Thumbnail,
    job["Art Link"],
    job["Art URL"],
  ];
  for (const f of fields) {
    const hit = fromAny(f);
    if (hit) return hit;
  }
  return null;
}

function SewingDoneOverlay() {
  return (
    <div
      title="Sewing complete (Sewing Summary Top ≥ order quantity)"
      aria-label="Sewing complete"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 2,
        background: "rgba(46, 204, 113, 0.12)",
      }}
    >
      <svg
        width="72"
        height="72"
        viewBox="0 0 72 72"
        fill="none"
        style={{ opacity: 0.55 }}
      >
        <circle cx="36" cy="36" r="32" stroke="#1b5e20" strokeWidth="4" fill="rgba(46,204,113,0.15)" />
        <path
          d="M20 37 L32 49 L52 25"
          stroke="#1b5e20"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function jobWaitingKey(job) {
  return [
    String(job["Order #"] ?? "").trim(),
    String(job["Product"] ?? "").trim(),
    String(job["Design"] ?? "").trim(),
  ].join("|");
}

function keysToSet(keys) {
  return new Set((Array.isArray(keys) ? keys : []).map((k) => String(k)));
}

function WaitingOverlay() {
  return (
    <div
      title="Waiting — double-click to clear"
      aria-label="Waiting"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 4,
        background: "rgba(128, 0, 128, 0.45)",
      }}
    >
      <span
        style={{
          fontWeight: 900,
          fontSize: 22,
          letterSpacing: "0.04em",
          color: "#fff",
          WebkitTextStroke: "4px #4a044e",
          paintOrder: "stroke fill",
          textShadow: "0 1px 4px rgba(0,0,0,0.45)",
        }}
      >
        Waiting
      </span>
    </div>
  );
}

function TileOverlayText({ children, color = "#111827", style = {}, title }) {
  return (
    <div
      title={title}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        zIndex: 3,
        textAlign: "center",
        fontWeight: 800,
        lineHeight: 1.15,
        color,
        padding: "4px 6px",
        pointerEvents: "none",
        WebkitTextStroke: "5px #fff",
        paintOrder: "stroke fill",
        textShadow: "0 0 6px #fff, 0 0 3px #fff, 0 1px 2px rgba(255,255,255,0.95)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function SewingPriority() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [soldPerDay6w, setSoldPerDay6w] = useState(null);
  const [waitingKeys, setWaitingKeys] = useState(() => new Set());
  const ctrlRef = useRef(null);
  const rootRef = useRef(null);
  const waitingToggleInFlight = useRef(new Set());

  const applyWaitingKeys = (keys) => {
    setWaitingKeys(keysToSet(keys));
  };

  const fetchWaitingKeys = async (signal) => {
    const res = await axios.get(`${ROOT}/sewing-priority/waiting`, {
      withCredentials: true,
      signal,
      timeout: 20000,
    });
    applyWaitingKeys(res?.data?.keys);
  };

  const toggleWaiting = async (key) => {
    if (!key || waitingToggleInFlight.current.has(key)) return;
    waitingToggleInFlight.current.add(key);
    // Optimistic local update for snappy UI; server broadcast reconciles everyone.
    setWaitingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    try {
      const res = await axios.post(
        `${ROOT}/sewing-priority/waiting/toggle`,
        { key },
        { withCredentials: true, timeout: 20000 }
      );
      if (Array.isArray(res?.data?.keys)) applyWaitingKeys(res.data.keys);
    } catch (e) {
      console.error("Waiting toggle failed:", e);
      // Re-sync from server so we don't stay on a wrong optimistic state.
      try {
        await fetchWaitingKeys();
      } catch {}
    } finally {
      waitingToggleInFlight.current.delete(key);
    }
  };

  useEffect(() => {
    const syncFs = () => {
      const el = rootRef.current;
      setIsFullscreen(!!(document.fullscreenElement && el && document.fullscreenElement === el));
    };
    document.addEventListener("fullscreenchange", syncFs);
    return () => document.removeEventListener("fullscreenchange", syncFs);
  }, []);

  // Shared Waiting flags — load + poll (socket covers live updates).
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();

    const load = async () => {
      try {
        await fetchWaitingKeys(ctrl.signal);
      } catch (e) {
        if (!alive || axios.isCancel(e)) return;
        console.warn("Sewing Priority waiting load failed:", e?.message || e);
      }
    };

    load();
    const interval = window.setInterval(load, 30000);

    const onWaitingUpdated = (payload) => {
      if (!alive) return;
      if (Array.isArray(payload?.keys)) applyWaitingKeys(payload.keys);
    };
    if (socket) socket.on("sewingPriorityWaitingUpdated", onWaitingUpdated);

    return () => {
      alive = false;
      window.clearInterval(interval);
      try {
        ctrl.abort();
      } catch {}
      if (socket) socket.off("sewingPriorityWaitingUpdated", onWaitingUpdated);
    };
  }, []);

  // Live workday clock (hours left today / catch-up math).
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);

  // Board + catch-up both use the one-month loaded set.
  const boardJobs = useMemo(
    () => (jobs || []).filter((j) => isJobInTimeWindow(j, BOARD_DAYS_WINDOW)),
    [jobs]
  );
  const catchUp = useMemo(() => computeCatchUpTracker(jobs, now), [jobs, now]);

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
    let alive = true;

    async function load() {
      try {
        ctrlRef.current?.abort();
      } catch {}
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setLoading(true);
      setError(null);

      try {
        const url = `${ROOT}/overview?nocache=1`;
        const [res, metricsRes] = await Promise.all([
          axios.get(url, {
            withCredentials: true,
            signal: ctrl.signal,
            timeout: 45000,
          }),
          axios
            .get(`${ROOT}/overview/metrics`, {
              withCredentials: true,
              signal: ctrl.signal,
              timeout: 45000,
            })
            .catch(() => null),
        ]);
        if (!alive) return;

        const raw = Array.isArray(res?.data?.upcoming) ? res.data.upcoming : [];
        const seen = new Set();
        const filtered = [];
        for (const j of raw) {
          if (isStageCompleted(j)) continue;
          // Load one-month horizon for board + catch-up.
          if (!isJobInTimeWindow(j, CATCH_UP_DAYS_WINDOW)) continue;
          const k = [
            String(j["Order #"] ?? "").trim(),
            String(j["Product"] ?? "").trim(),
            String(j["Design"] ?? "").trim(),
          ].join("|");
          if (seen.has(k)) continue;
          seen.add(k);
          filtered.push(j);
        }

        filtered.sort((a, b) => {
          const sa = daysUntil(a["Ship Date"] ?? a["Ship"]);
          const sb = daysUntil(b["Ship Date"] ?? b["Ship"]);
          if (sa !== null && sb !== null && sa !== sb) return sa - sb;
          if (sa !== null && sb === null) return -1;
          if (sa === null && sb !== null) return 1;
          const oa = parseInt(String(a["Order #"] || "").replace(/\D+/g, ""), 10) || 0;
          const ob = parseInt(String(b["Order #"] || "").replace(/\D+/g, ""), 10) || 0;
          return oa - ob;
        });

        setJobs(filtered);
        const avg6w = metricsRes?.data?.headcovers_sold_per_day_6w;
        setSoldPerDay6w(
          avg6w != null && Number.isFinite(Number(avg6w)) ? Number(avg6w) : null
        );
      } catch (e) {
        if (!alive || axios.isCancel(e)) return;
        console.error("Sewing Priority load failed:", e);
        setError(e?.message || "Failed to load jobs");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    const interval = window.setInterval(load, 60000);
    return () => {
      alive = false;
      window.clearInterval(interval);
      try {
        ctrlRef.current?.abort();
      } catch {}
    };
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        padding: "6px 8px 8px",
        maxWidth: isFullscreen ? "none" : 1600,
        margin: "0 auto",
        background: "#fff",
        minHeight: isFullscreen ? "100vh" : undefined,
        boxSizing: "border-box",
        overflow: isFullscreen ? "auto" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "nowrap",
          marginBottom: 8,
          whiteSpace: "nowrap",
          overflowX: "auto",
          minHeight: 22,
          lineHeight: 1,
        }}
      >
        <span
          style={{
            fontWeight: 900,
            fontSize: 18,
            color: "#111827",
            letterSpacing: "0.02em",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {(() => {
            const d = now;
            const weekday = d.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
            return `${weekday} ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
          })()}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#4b5563",
            flexShrink: 0,
          }}
        >
          <Legend color="#2ecc71" label="On time" />
          <Legend color="#f1c40f" label="Ship today" />
          <Legend color="#e74c3c" label="Catch up" />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ opacity: 0.7 }}>✓</span> Sewn
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Double-click a tile to toggle">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "rgba(128, 0, 128, 0.55)",
                display: "inline-block",
              }}
            />
            Waiting
          </span>
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          <SoldPerDayCircle value={soldPerDay6w} />
          <CatchUpStatus catchUp={catchUp} />
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
            }}
          >
            {isFullscreen ? "Exit" : "Full"}
          </button>
        </span>
      </div>

      {error && (
        <div style={{ padding: 12, marginBottom: 12, background: "#fef2f2", color: "#b91c1c", borderRadius: 8 }}>
          {error}
        </div>
      )}

      {loading && !boardJobs.length && (
        <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>Loading jobs…</div>
      )}

      {!loading && !boardJobs.length && !error && (
        <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>
          No jobs in the next {BOARD_DAYS_WINDOW} days.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          columnGap: 10,
          rowGap: 0,
          opacity: loading && boardJobs.length ? 0.7 : 1,
        }}
      >
        {boardJobs.map((job, idx) => {
          const order = String(job["Order #"] ?? "").trim() || "—";
          const customer = String(job["Company Name"] ?? job["Company"] ?? job["Customer"] ?? "").trim();
          const shipDate = job["Ship Date"] ?? job["Ship"] ?? null;
          const outline = outlineByShipDate(shipDate);
          const sewingDone = !!job.sewingSummaryComplete;
          const thumb = getJobThumbUrl(job);
          const product = String(job["Product"] ?? "").trim();
          const design = String(job["Design"] ?? "").trim();
          const qtyRaw = job["Quantity"] ?? job["Qty"] ?? null;
          const qtyLabel =
            qtyRaw === null || qtyRaw === undefined || qtyRaw === ""
              ? ""
              : String(Math.round(Number(qtyRaw)) || qtyRaw).trim();
          const waitKey = jobWaitingKey(job);
          const isWaiting = waitingKeys.has(waitKey);

          return (
            <div
              key={`${order}|${product}|${design}|${idx}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                height: "100%",
                paddingTop: 8,
                paddingBottom: 10,
                borderBottom: "1px solid #d1d5db",
                boxSizing: "border-box",
              }}
            >
              {customer ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#4b5563",
                    textAlign: "center",
                    lineHeight: 1.2,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "0 2px",
                  }}
                  title={customer}
                >
                  {customer}
                </div>
              ) : null}
              {product ? (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#111827",
                    textAlign: "center",
                    lineHeight: 1.2,
                    marginTop: customer ? 2 : 0,
                    marginBottom: 4,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "0 2px",
                  }}
                  title={product}
                >
                  {product}
                </div>
              ) : (
                <div style={{ marginBottom: 4 }} />
              )}

              <div
                onDoubleClick={(e) => {
                  e.preventDefault();
                  toggleWaiting(waitKey);
                }}
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 10,
                  border: `5px solid ${outline}`,
                  background: "#f9fafb",
                  overflow: "hidden",
                  boxSizing: "border-box",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                title={
                  isWaiting
                    ? `${order} — Waiting · double-click to clear`
                    : sewingDone
                      ? `${order} — sewing done · ship ${fmtMMDD(shipDate)} · double-click for Waiting`
                      : `${order} · ship ${fmtMMDD(shipDate)}${product ? ` · ${product}` : ""} · double-click for Waiting`
                }
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 8,
                      textAlign: "center",
                      fontSize: 12,
                      color: "#9ca3af",
                    }}
                  >
                    {design || product || "No image"}
                  </div>
                )}
                {sewingDone && <SewingDoneOverlay />}
                {isWaiting && <WaitingOverlay />}
                <TileOverlayText style={{ top: 2, fontSize: 16 }} title={order}>
                  {order}
                </TileOverlayText>
                <TileOverlayText
                  color={outline}
                  style={{ bottom: 2, left: 0, right: "40%", fontSize: 14, textAlign: "left" }}
                  title={shipDate ? `Ship: ${String(shipDate)}` : "No ship date"}
                >
                  {fmtMMDD(shipDate)}
                </TileOverlayText>
                {qtyLabel ? (
                  <TileOverlayText
                    color="#111827"
                    style={{
                      bottom: 2,
                      left: "auto",
                      right: 0,
                      fontSize: 14,
                      textAlign: "right",
                      padding: "4px 6px",
                    }}
                    title={`Qty: ${qtyLabel}`}
                  >
                    {qtyLabel}
                  </TileOverlayText>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          border: `2.5px solid ${color}`,
          boxSizing: "border-box",
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function fmtHoursLeft(h) {
  if (h <= 0) return "0h";
  if (h >= HOURS_PER_WORKDAY - 1e-6) return `${HOURS_PER_WORKDAY}h`;
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

const CATCH_UP_POSITIVE = [
  "Caught up — nice work!",
  "On track — keep crushing it!",
  "All clear — you're ahead of the stack!",
  "Caught up — great pace!",
];

/** Avg pcs sold / business day over last 6 weeks (excludes back, towel, belt). */
function SoldPerDayCircle({ value }) {
  const label =
    value != null && Number.isFinite(Number(value))
      ? Number(value).toFixed(1)
      : "—";
  return (
    <span
      title="Avg pieces sold per day (last 6 weeks). Excludes products with back, towel, or belt in the name."
      style={{
        width: 40,
        height: 40,
        borderRadius: "50%",
        border: "2px solid #111827",
        background: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
        fontSize: label.length > 4 ? 11 : 13,
        lineHeight: 1,
        color: "#111827",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      {label}
    </span>
  );
}

function CatchUpStatus({ catchUp }) {
  const behind = (catchUp?.extraPcs || 0) > 0;
  const hoursLeft = catchUp?.hoursLeft ?? 0;
  const pcsLeftToday = catchUp?.pcsLeftToday ?? 0;
  const hoursBit =
    hoursLeft > 0 ? `${fmtHoursLeft(hoursLeft)} left (${pcsLeftToday} pcs)` : "day done";

  const title = `Assumes ${WORKDAY_PCS}/day Mon–Fri ${WORK_START_H}:00–${WORK_END_H}:00. Catch-up looks ${CATCH_UP_DAYS_WINDOW} days out (board shows ${BOARD_DAYS_WINDOW}). Excludes sewing-complete, Back, towels, and belts.`;

  if (behind) {
    const days = catchUp.overWorkdays || "—";
    const dayWord = catchUp.overWorkdays === 1 ? "day" : "days";
    return (
      <span
        title={title}
        style={{
          fontWeight: 900,
          fontSize: 18,
          lineHeight: 1,
          color: "#dc2626",
          letterSpacing: "0.01em",
        }}
      >
        Need +{catchUp.extraPcs} over {days} {dayWord} (~{Number(catchUp.perDay).toFixed(1)}/day) · {hoursBit}
      </span>
    );
  }

  const note = CATCH_UP_POSITIVE[(catchUp?.openPcs || 0) % CATCH_UP_POSITIVE.length];
  return (
    <span
      title={title}
      style={{
        fontWeight: 900,
        fontSize: 18,
        lineHeight: 1,
        color: "#16a34a",
        letterSpacing: "0.01em",
      }}
    >
      {note} · {hoursBit}
    </span>
  );
}
