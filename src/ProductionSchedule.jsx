import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";
import { extractFileId, jobImageUrl } from "./machineFloorUtils";
import "./ProductionSchedule.css";

const ROOT = `${API_ROOT}/schedule`;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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
  return compact.length > 220 ? `${compact.slice(0, 220)}…` : compact || "Could not load schedule";
}

function fmtDate(value) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split("-");
  return y && m && d ? `${m}/${d}/${y}` : String(value);
}

function fmtCardDate(value) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split("-");
  return y && m && d ? `${Number(m)}/${Number(d)}` : String(value);
}

function weekdayName(value) {
  const raw = String(value || "").slice(0, 10);
  const dt = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
}

function fmtDayHeading(value) {
  const raw = String(value || "").slice(0, 10);
  const dt = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return fmtDate(value);
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function wholeQty(value) {
  return Math.round(Number(value) || 0);
}

function outPhrase(names) {
  const people = (names || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!people.length) return "";
  if (people.length === 1) return `${people[0]} is out`;
  if (people.length === 2) return `${people[0]} and ${people[1]} are out`;
  return `${people.slice(0, -1).join(", ")}, and ${people[people.length - 1]} are out`;
}

function fmtTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusText(schedule, version) {
  if (!version) return "No schedule";
  const conflicts = schedule?.summary?.blockingConflictCount || 0;
  return `${version.Status || "Unknown"} · ${conflicts} blocking conflict${conflicts === 1 ? "" : "s"}`;
}

function useScheduleData({ tv = false } = {}) {
  const [published, setPublished] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const pub = await axios.get(`${ROOT}/published`, { timeout: 60000 });
      if (pub.data?.version || pub.data?.schedule) {
        setPublished(pub.data);
      }
      if (pub.data?.warning) {
        setError(friendlyError({ message: pub.data.warning }));
      }
      if (!tv) {
        const prop = await axios.get(`${ROOT}/proposal`, { timeout: 60000 });
        if (prop.data?.version || prop.data?.schedule) {
          setProposal(prop.data);
        }
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [tv]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, tv ? 60000 : 120000);
    return () => window.clearInterval(timer);
  }, [load, tv]);

  return { published, proposal, loading, error, reload: load };
}

function chooseSchedule(data, showProposal) {
  if (showProposal && data.proposal?.schedule) {
    return {
      schedule: data.proposal.schedule,
      version: data.proposal.version,
      proposed: true,
      comparison: data.proposal.comparison || {},
    };
  }
  return {
    schedule: data.published?.schedule,
    version: data.published?.version,
    proposed: false,
    comparison: {},
  };
}

function ScheduleHeader({ title, active, canPropose, showProposal, setShowProposal, onRebuild, onStaff, busy, tv }) {
  return (
    <div className="ps-header">
      <div>
        <h1>{title}</h1>
        <div className="ps-subtitle">
          {statusText(active.schedule, active.version)}
          {active.version?.["Version ID"] ? ` · ${active.version["Version ID"]}` : ""}
          {tv ? " · Published schedule only · Auto-refreshes" : ""}
        </div>
      </div>
      {!tv && (
        <div className="ps-actions">
          {canPropose && (
            <div className="ps-segmented" aria-label="Schedule version">
              <button className={!showProposal ? "active" : ""} onClick={() => setShowProposal(false)}>
                Published
              </button>
              <button className={showProposal ? "active" : ""} onClick={() => setShowProposal(true)}>
                Proposal
              </button>
            </div>
          )}
          {onStaff && (
            <button type="button" onClick={onStaff} disabled={busy}>
              Staff
            </button>
          )}
          <button className="ps-primary" onClick={onRebuild} disabled={busy}>
            {busy ? "Building…" : "Rebuild Schedule"}
          </button>
        </div>
      )}
    </div>
  );
}

function Banner({ error, proposed }) {
  if (error) return <div className="ps-banner danger">{error}</div>;
  if (proposed) {
    return (
      <div className="ps-banner warning">
        Proposed schedule — employees and the shop TV still see the current published schedule.
      </div>
    );
  }
  return null;
}

function dateRange(schedule, field = "date") {
  const dates = asList(schedule).map((r) => String(r[field] || r.start || "").slice(0, 10)).filter(Boolean).sort();
  if (!dates.length) return [];
  const start = new Date(`${dates[0]}T12:00:00`);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const finish = new Date(`${dates[dates.length - 1]}T12:00:00`);
  const days = [];
  const cursor = new Date(start);
  while (cursor <= finish && days.length < 371) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function orderKey(value) {
  return String(value || "").replace(/^#/, "").trim();
}

function collectJobImages(columns, orders) {
  const map = {};
  asList(orders).forEach((order) => {
    const id = orderKey(order.order_number || order.orderNumber);
    const image = order.image || order.Image || order.Preview || "";
    if (id && image) map[id] = { imageLink: image, imageFileId: extractFileId(image) || "" };
  });
  Object.values(columns || {}).forEach((col) => {
    asList(col?.jobs).forEach((job) => {
      const id = orderKey(job.id || job.orderNumber);
      const image = job.imageLink || job.Image || job.image || "";
      if (!id || !(image || job.imageFileId)) return;
      map[id] = {
        imageLink: image || map[id]?.imageLink || "",
        imageFileId: job.imageFileId || extractFileId(image) || map[id]?.imageFileId || "",
      };
    });
  });
  return map;
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

function isBackProduct(product) {
  return /(?:^|\s)backs?$/i.test(String(product || "").trim());
}

function isTowelOrNeedlepoint(product) {
  const name = String(product || "").toLowerCase().replace(/[-_]+/g, " ");
  if (name.includes("towel")) return true;
  return name.replace(/\s+/g, "").includes("needlepoint");
}

function needsSewing(order) {
  if (order.needs_sewing === false || order.needsSewing === false) return false;
  if (isBackProduct(order.product) || isTowelOrNeedlepoint(order.product)) return false;
  return Number(order.remaining_quantity || order.remainingQuantity || 0) > 0;
}

function dayPieces(job) {
  const explicit = Number(job.dayQuantity);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const units = Number(job.capacityUnits);
  if (Number.isFinite(units) && units > 0) return Math.round(units);
  return Number(job.remainingQuantity || 0);
}

function needsEmbroidery(order) {
  const stage = String(order.stage || "").toUpperCase();
  if (stage.includes("SEW") || stage === "COMPLETE" || stage === "SHIPPED") return false;
  if (isTowelOrNeedlepoint(order.product)) return false;
  return Number(order.stitch_count || order.stitchCount || 0) > 0
    && Number(order.embroidery_remaining ?? order.embroideryRemaining ?? order.remaining_quantity ?? 0) > 0;
}

function UnscheduledOrders({ schedule, type }) {
  const planned = new Set(
    asList(type === "sewing" ? schedule?.sewing : schedule?.embroidery).map((r) => String(r.orderNumber || r.order_number || ""))
  );
  const missing = asList(schedule?.orders).filter((r) => {
    const id = String(r.order_number || r.orderNumber || "");
    if (!id || planned.has(id)) return false;
    return type === "sewing" ? needsSewing(r) : needsEmbroidery(r);
  });
  if (!missing.length) return null;
  return (
    <div className="ps-unscheduled">
      <strong>{type === "sewing" ? "Unscheduled sewing work" : "Unscheduled embroidery work"} ({missing.length})</strong>
      <span>
        {type === "sewing"
          ? "These open orders still need sewing capacity and could not be placed."
          : "These orders still need embroidery and could not be placed. Orders that are already sewing, or that do not have stitch counts yet, are omitted here."}
      </span>
      <div className="ps-chip-row">
        {missing.map((r) => (
          <span className="ps-chip danger" key={r.order_number}>
            #{r.order_number} · {r.customer || "No customer"} · {r.product || "No product"}
          </span>
        ))}
      </div>
    </div>
  );
}

function nextWeekdayIso(from = new Date()) {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function StaffModal({ date, onClose, onSaved }) {
  const [day, setDay] = useState(date || nextWeekdayIso());
  const [sewers, setSewers] = useState([]);
  const [out, setOut] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`${ROOT}/staff`, { timeout: 60000 }).then(({ data }) => {
      if (cancelled) return;
      const roster = Array.isArray(data?.sewers) ? data.sewers : [];
      setSewers(roster);
      const saved = (data?.absences && data.absences[day]) || [];
      setOut(saved);
    }).catch((e) => {
      if (!cancelled) setError(e?.response?.data?.error || e?.message || "Could not load sewers");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [day]);

  const toggle = (name) => {
    setOut((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await axios.put(`${ROOT}/staff`, { date: day, out }, { timeout: 180000 });
      onSaved();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Could not save staff");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ps-modal-overlay" onClick={onClose}>
      <div className="ps-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Staff</h2>
        <p className="ps-help">Mark who is out. Names come from the Sewing tab. The last name is the emergency sewer.</p>
        <label>
          Date
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        {loading ? <div className="ps-empty small">Loading sewers…</div> : null}
        {!loading && !sewers.length ? (
          <div className="ps-empty small">
            No sewer names found on the Sewing tab.
          </div>
        ) : null}
        <div className="ps-staff-list">
          {sewers.map((sewer) => (
            <label key={sewer.name} className="ps-staff-row">
              <input
                type="checkbox"
                checked={out.includes(sewer.name)}
                onChange={() => toggle(sewer.name)}
              />
              <span>{sewer.name}</span>
              <em>{sewer.role === "emergency" ? "Emergency" : "Regular"}</em>
            </label>
          ))}
        </div>
        {error ? <div className="ps-banner danger">{error}</div> : null}
        <div className="ps-actions">
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="ps-primary" onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save and rebuild"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SewingCalendar({ tv = false, columns }) {
  const data = useScheduleData({ tv });
  const [showProposal, setShowProposal] = useState(!tv);
  const [busy, setBusy] = useState(false);
  const [staffDate, setStaffDate] = useState("");
  const active = chooseSchedule(data, !tv && showProposal);
  const schedule = active.schedule && typeof active.schedule === "object" ? active.schedule : {};
  const rows = asList(schedule.sewing).filter(
    (row) => !isBackProduct(row.product) && !isTowelOrNeedlepoint(row.product)
  );
  const splitCounts = useMemo(() => {
    const counts = {};
    rows.forEach((row) => {
      const id = String(row.orderNumber || "");
      if (id) counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }, [rows]);
  const images = useMemo(
    () => collectJobImages(columns, schedule.orders),
    [columns, schedule.orders]
  );
  const days = useMemo(() => dateRange(rows), [rows]);
  const byDay = useMemo(() => {
    const map = {};
    rows.forEach((row) => {
      const key = String(row.date || row.start || "").slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(row);
    });
    Object.values(map).forEach((list) => {
      list.sort((a, b) => {
        const hardA = a.hardDate ? 0 : 1;
        const hardB = b.hardDate ? 0 : 1;
        if (hardA !== hardB) return hardA - hardB;
        return String(a.start || "").localeCompare(String(b.start || ""))
          || String(a.orderNumber || "").localeCompare(String(b.orderNumber || ""));
      });
    });
    return map;
  }, [rows]);

  const rebuild = async () => {
    setBusy(true);
    try {
      await axios.post(`${ROOT}/rebuild`, { reason: "administrator requested rebuild" }, { timeout: 180000 });
      setShowProposal(true);
      await data.reload();
    } catch (e) {
      window.alert(friendlyError(e) || "Schedule rebuild failed");
    } finally {
      setBusy(false);
    }
  };

  const lockOnDay = async (event, day) => {
    if (tv || !active.proposed) return;
    event.preventDefault();
    const payload = JSON.parse(event.dataTransfer.getData("application/json") || "{}");
    if (!payload.orderNumber) return;
    try {
      await axios.put(
        `${ROOT}/locks/SEW-${encodeURIComponent(payload.orderNumber)}`,
        { orderNumber: payload.orderNumber, date: day, capacityUnits: payload.capacityUnits, active: true },
        { timeout: 120000 }
      );
      await data.reload();
    } catch (e) {
      window.alert(e?.response?.data?.error || e?.message || "Could not lock sewing job");
    }
  };

  return (
    <main className={`ps-page ${tv ? "tv" : ""}`}>
      <ScheduleHeader
        title={tv ? "Published Sewing Schedule" : "Sewing Calendar"}
        active={active}
        canPropose={!!data.proposal?.schedule}
        showProposal={showProposal}
        setShowProposal={setShowProposal}
        onRebuild={rebuild}
        onStaff={tv ? undefined : () => setStaffDate(nextWeekdayIso())}
        busy={busy}
        tv={tv}
      />
      {staffDate && (
        <StaffModal
          date={staffDate}
          onClose={() => setStaffDate("")}
          onSaved={async () => {
            setShowProposal(true);
            await data.reload();
          }}
        />
      )}
      <Banner error={data.error} proposed={active.proposed} />
      {data.loading && !active.schedule ? <div className="ps-empty">Loading schedule…</div> : null}
      <UnscheduledOrders schedule={schedule} type="sewing" />
      <div className="ps-week-labels">{DOW.map((d) => <div key={d}>{d}</div>)}</div>
      <div className="ps-calendar">
        {days.map((day) => {
          const jobs = byDay[day] || [];
          const regular = Math.max(0, ...jobs.map((j) => Number(j.regularCapacity || 0)), jobs.length ? 0 : 95);
          const emergency = Math.max(0, ...jobs.map((j) => Number(j.emergencyCapacity || 0)));
          const scheduled = jobs.reduce((sum, j) => sum + Number(j.capacityUnits || 0) + Number(j.setupUnits || 0), 0);
          const remaining = regular + emergency - scheduled;
          const outNames = (schedule.settings?.sewerAbsences || {})[day] || [];
          const whoIsOut = outPhrase(outNames);
          return (
            <section
              className={`ps-day ${remaining < -0.01 ? "over" : ""}`}
              key={day}
              onDragOver={(e) => active.proposed && e.preventDefault()}
              onDrop={(e) => lockOnDay(e, day)}
            >
              <header>
                <button
                  type="button"
                  className="ps-day-staff"
                  onClick={() => !tv && setStaffDate(day)}
                  disabled={tv}
                >
                  <span className="ps-day-weekday">{weekdayName(day)}</span>
                  {whoIsOut ? <span className="ps-day-out">{whoIsOut}</span> : null}
                  <span className="ps-day-date">{fmtDayHeading(day)}</span>
                </button>
                <span className="ps-day-units">{wholeQty(scheduled)} / {wholeQty(regular + emergency)}</span>
              </header>
              <div className="ps-capacity">
                Regular {wholeQty(regular)} · Emergency {wholeQty(emergency)} · Remaining {wholeQty(remaining)}
              </div>
              <div className="ps-cards">
                {jobs.map((job, index) => (
                  <SewingCard
                    key={`${job.orderNumber}-${job.start}-${index}`}
                    job={job}
                    split={!!job.split || (splitCounts[String(job.orderNumber)] || 0) > 1}
                    imageHint={images[orderKey(job.orderNumber)]}
                    tv={tv}
                    draggable={!tv && active.proposed && !job.locked}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {!days.length && !data.loading ? (
        <div className="ps-empty">
          {data.error
            ? "Could not load the sewing calendar. Wait a minute and refresh — do not rebuild yet."
            : active.version
              ? "No sewing work is placed on this schedule yet."
              : "No published schedule yet. Click Rebuild Schedule to create the first baseline."}
        </div>
      ) : null}
    </main>
  );
}

function SewingCard({ job, draggable, imageHint, tv, split }) {
  const hard = !!job.hardDate;
  const sample = Number(job.quantity) === 1;
  const late = !hard && (!!job.late || !!job.conflict);
  const todayQty = dayPieces(job);
  const totalQty = Number(job.remainingQuantity ?? job.quantity ?? 0);
  const qtyLabel = split
    ? `${todayQty}/${totalQty || "—"}`
    : `${totalQty || 0}/${job.quantity ?? "—"}`;
  const classes = [
    "ps-sched-card",
    hard ? "hard" : "soft",
    sample ? "sample" : "",
    late ? "late" : "",
    job.locked ? "locked" : "",
  ].filter(Boolean).join(" ");
  const title = [
    `#${job.orderNumber}`,
    job.customer,
    job.product,
    job.design,
    split ? `${todayQty} pieces today of ${totalQty || "—"}` : `qty ${job.remainingQuantity ?? "—"}/${job.quantity ?? "—"}`,
    `due ${fmtDate(job.dueDate)}`,
    `ship ${fmtDate(job.requiredShipDate)}`,
    job.shippingGroupId && job.shippingGroupId.startsWith("ORDER-") ? "" : job.shippingGroupId,
  ].filter(Boolean).join(" · ");
  const rawImage = job.image || job.imageLink || imageHint?.imageLink || "";
  const thumb = jobImageUrl({
    image: rawImage,
    imageLink: rawImage,
    Image: rawImage,
    imageFileId: job.imageFileId || imageHint?.imageFileId || "",
  }, tv ? "w320" : "w240");
  const transitDays = Number(job.transitBusinessDays) || 0;
  return (
    <article
      className={classes}
      title={title}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/json", JSON.stringify({
          orderNumber: job.orderNumber,
          capacityUnits: Number(job.capacityUnits || job.remainingQuantity || 1),
        }));
      }}
    >
      <button
        type="button"
        className={`ps-sched-thumb ${thumb ? "" : "missing"}`}
        onClick={(e) => {
          e.stopPropagation();
          if (rawImage) openJobImage(rawImage);
        }}
        disabled={!rawImage}
        title={rawImage ? "Open artwork" : "No image"}
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
          />
        ) : (
          <span>No img</span>
        )}
      </button>
      <div className="ps-sched-body">
        <div className="ps-sched-top">
          <span className="ps-sched-id">{job.orderNumber}</span>
          <span className={`ps-sched-qty ${split ? "split" : ""}`}>{qtyLabel}</span>
        </div>
        <span className="ps-sched-name">
          {job.customer || "No customer"}
          {job.product ? ` - ${job.product}` : ""}
        </span>
      </div>
      <div className="ps-sched-facts">
        <span>Due {fmtCardDate(job.dueDate)}</span>
        <span>
          Ship {fmtCardDate(job.requiredShipDate)}
          {transitDays > 0 ? ` · ${transitDays}-day` : ""}
        </span>
        <span>{hard ? "Hard date" : "Soft date"}</span>
        {(job.emergencyUsed || Number(job.emergencyCapacity) > 0) && (
          <span className="warning">Emergency</span>
        )}
        {!job.embroideryReady && <span className="danger">Emb not ready</span>}
      </div>
    </article>
  );
}

export function EmbroideryCalendar() {
  const data = useScheduleData();
  const [showProposal, setShowProposal] = useState(true);
  const [busy, setBusy] = useState(false);
  const active = chooseSchedule(data, showProposal);
  const schedule = active.schedule && typeof active.schedule === "object" ? active.schedule : {};
  const byMachine = useMemo(() => {
    const map = {
      "Single Head Machine": [],
      "Machine 2": [],
      "Machine 3": [],
      "Machine 4": [],
    };
    asList(schedule.embroidery).forEach((job) => {
      if (isTowelOrNeedlepoint(job.product)) return;
      const raw = job.machine || "";
      const machine = ["Machine 1", "Single Head", "Single Head Machine"].includes(raw)
        ? "Single Head Machine"
        : (raw || "Machine 2");
      (map[machine] ||= []).push(job);
    });
    Object.values(map).forEach((jobs) => jobs.sort((a, b) => String(a.start).localeCompare(String(b.start))));
    return map;
  }, [schedule]);

  const rebuild = async () => {
    setBusy(true);
    try {
      await axios.post(`${ROOT}/rebuild`, { reason: "administrator requested rebuild" }, { timeout: 180000 });
      setShowProposal(true);
      await data.reload();
    } catch (e) {
      window.alert(friendlyError(e) || "Schedule rebuild failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ps-page">
      <ScheduleHeader
        title="Embroidery Calendar"
        active={active}
        canPropose={!!data.proposal?.schedule}
        showProposal={showProposal}
        setShowProposal={setShowProposal}
        onRebuild={rebuild}
        busy={busy}
      />
      <Banner error={data.error} proposed={active.proposed} />
      <UnscheduledOrders schedule={schedule} type="embroidery" />
      <div className="ps-machines">
        {Object.entries(byMachine).map(([machine, jobs]) => (
          <section className="ps-machine" key={machine}>
            <h2>{machine} <span>{machine === "Single Head Machine" ? "1 head" : "6 heads"} · 30,000 stitches/hour</span></h2>
            {jobs.map((job) => (
              <article className={`ps-card ${job.threadConflict ? "conflict" : ""}`} key={`${job.orderNumber}-${job.start}`}>
                <div className="ps-card-title"><strong>#{job.orderNumber}</strong><span>{job.sameDaySewing ? "Same-day sewing" : ""}</span></div>
                <div>{job.customer}</div>
                <div className="muted">{[job.product, job.design].filter(Boolean).join(" · ")}</div>
                <dl>
                  <dt>Quantity / runs</dt><dd>{job.quantity} / {job.runs} · {job.heads || (machine === "Single Head Machine" ? 1 : 6)}-head</dd>
                  <dt>Stitches</dt><dd>{Number(job.stitchCount || 0).toLocaleString()}</dd>
                  <dt>Duration</dt><dd>{Number(job.durationHours || 0).toFixed(2)} hours</dd>
                  <dt>Start / finish</dt><dd>{fmtDate(job.start)} {fmtTime(job.start)} → {fmtDate(job.finish)} {fmtTime(job.finish)}</dd>
                  <dt>Sewing-ready by</dt><dd>{fmtDate(job.sewingReadyDeadline)} {fmtTime(job.sewingReadyDeadline)}</dd>
                  <dt>Thread</dt><dd>{(job.threadColors || []).join(", ") || "Missing"}</dd>
                </dl>
                <div className="ps-badges">
                  {job.threadConflict ? <span className="danger">Thread conflict</span> : <span className="ok">Thread capacity checked</span>}
                  <span title={job.splitReason}>{job.splitPermitted ? "Split permitted if needed" : "Keep on one machine"}</span>
                </div>
              </article>
            ))}
            {!jobs.length && <div className="ps-empty small">No assigned work</div>}
          </section>
        ))}
      </div>
    </main>
  );
}

export function ScheduleApprovals() {
  const data = useScheduleData();
  const proposal = data.proposal;
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const schedule = proposal?.schedule;

  const decide = async (decision) => {
    const id = proposal?.version?.["Version ID"];
    if (!id) return;
    setBusy(decision);
    try {
      await axios.post(`${ROOT}/versions/${encodeURIComponent(id)}/${decision}`, { notes }, { timeout: 60000 });
      setNotes("");
      await data.reload();
    } catch (e) {
      window.alert(e?.response?.data?.error || e?.message || "Decision failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="ps-page">
      <div className="ps-header"><div><h1>Schedule Approvals</h1><div className="ps-subtitle">Published work remains active until approval.</div></div></div>
      <Banner error={data.error} proposed={!!schedule} />
      {!schedule && <div className="ps-empty">No schedule is awaiting approval.</div>}
      {schedule && (
        <>
          <div className="ps-summary-grid">
            <Summary label="Version" value={proposal.version?.["Version ID"]} />
            <Summary label="New orders" value={(proposal.comparison?.newOrders || []).length} />
            <Summary label="Jobs moved" value={(proposal.comparison?.jobsMoved || []).length} />
            <Summary label="Machine changes" value={(proposal.comparison?.machineChanges || []).length} />
            <Summary label="Late / blocking" value={schedule.summary?.blockingConflictCount || 0} danger />
            <Summary label="Third sewer dates" value={(schedule.summary?.thirdSewerDates || []).length} />
          </div>
          <ChangeList title="New orders" items={(proposal.comparison?.newOrders || []).map((v) => `#${v}`)} />
          <ChangeList
            title="Sewing dates moved"
            items={(proposal.comparison?.jobsMoved || []).map((r) => `#${r.orderNumber}: ${(r.previousDates || []).join(", ") || "unscheduled"} → ${(r.proposedDates || []).join(", ") || "unscheduled"}`)}
          />
          <ChangeList
            title="Machine assignments changed"
            items={(proposal.comparison?.machineChanges || []).map((r) => `#${r.orderNumber}: ${r.previousMachine || "unassigned"} → ${r.proposedMachine || "unassigned"}`)}
          />
          <ChangeList
            title="Conflicts"
            items={asList(schedule.conflicts).map((r) => `${r.orderNumber ? `#${r.orderNumber}: ` : ""}${r.message}`)}
            danger
          />
          <label className="ps-notes">
            Approval notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </label>
          <div className="ps-actions">
            <button className="ps-primary" disabled={!!busy} onClick={() => decide("approve")}>{busy === "approve" ? "Publishing…" : "Approve & Publish"}</button>
            <button className="ps-danger-button" disabled={!!busy} onClick={() => decide("reject")}>{busy === "reject" ? "Rejecting…" : "Reject Proposal"}</button>
          </div>
        </>
      )}
    </main>
  );
}

export function ScheduleConflicts() {
  const data = useScheduleData();
  const [showProposal, setShowProposal] = useState(true);
  const active = chooseSchedule(data, showProposal);
  const conflicts = asList(active.schedule?.conflicts);
  const warnings = asList(active.schedule?.warnings);
  return (
    <main className="ps-page">
      <ScheduleHeader
        title="Conflicts"
        active={active}
        canPropose={!!data.proposal?.schedule}
        showProposal={showProposal}
        setShowProposal={setShowProposal}
        onRebuild={() => {}}
        busy={false}
      />
      <Banner error={data.error} proposed={active.proposed} />
      <ConflictList title="Blocking conflicts" rows={conflicts} severity="danger" />
      <ConflictList title="Warnings" rows={warnings} severity="warning" />
      {!conflicts.length && !warnings.length && <div className="ps-banner success">No scheduling conflicts or warnings.</div>}
    </main>
  );
}

function ConflictList({ title, rows, severity }) {
  if (!rows.length) return null;
  return (
    <section className="ps-list-section">
      <h2>{title} ({rows.length})</h2>
      {rows.map((row, index) => (
        <article className={`ps-conflict ${severity}`} key={`${row.type}-${row.orderNumber}-${index}`}>
          <strong>{row.orderNumber ? `Order #${row.orderNumber}` : row.groupId || row.type}</strong>
          <span>{row.message}</span>
          <small>
            {[
              row.color && `Color ${row.color}`,
              row.availableCones != null && `Available ${row.availableCones}`,
              row.requiredCones != null && `Required ${row.requiredCones}`,
              row.missingSewingUnits != null && `Missing ${row.missingSewingUnits} sewing units`,
              row.missingEmbroideryHours != null && `Missing ${row.missingEmbroideryHours} embroidery hours`,
              row.thirdSewerWouldHelp && `Third sewer: ${row.thirdSewerDaysNeeded} day(s) may help`,
            ].filter(Boolean).join(" · ")}
          </small>
        </article>
      ))}
    </section>
  );
}

export function SchedulingSettings() {
  const [settings, setSettings] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    axios.get(`${ROOT}/settings`, { timeout: 60000 }).then(({ data }) => {
      setSettings(data.settings || {});
      setMetrics(data.sewingOutput || {});
    }).catch((e) => setMessage(e?.response?.data?.error || e?.message));
  }, []);

  if (!settings) return <main className="ps-page"><div className="ps-empty">Loading settings…</div></main>;
  const set = (key, value) => setSettings((old) => ({ ...old, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      await axios.put(`${ROOT}/settings`, { settings }, { timeout: 60000 });
      setMessage("Settings saved. Rebuild the schedule to apply them.");
    } catch (e) {
      setMessage(e?.response?.data?.error || e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ps-page">
      <div className="ps-header"><div><h1>Scheduling Settings</h1><div className="ps-subtitle">Deterministic capacity settings require administrator approval.</div></div></div>
      {message && <div className="ps-banner">{message}</div>}
      <div className="ps-settings-grid">
        <Setting label="Regular sewing capacity (normal-equivalent pieces/day)" value={settings.regularSewingCapacity} onChange={(v) => set("regularSewingCapacity", Number(v))} />
        <Setting label="Third sewer capacity (pieces/day)" value={settings.emergencySewingCapacity} onChange={(v) => set("emergencySewingCapacity", Number(v))} />
        <Setting label="Sewing changeover (minutes)" value={settings.sewingChangeoverMinutes} onChange={(v) => set("sewingChangeoverMinutes", Number(v))} />
        <Setting label="French-seam factor (blank = warning + standard)" value={settings.frenchSeamFactor ?? ""} onChange={(v) => set("frenchSeamFactor", v === "" ? null : Number(v))} />
        <Setting label="Unusual-shape factor (blank = warning + standard)" value={settings.unusualShapeFactor ?? ""} onChange={(v) => set("unusualShapeFactor", v === "" ? null : Number(v))} />
        <Setting label="Holidays / unavailable dates (YYYY-MM-DD, comma separated)" value={(settings.holidays || []).join(", ")} onChange={(v) => set("holidays", v.split(",").map((x) => x.trim()).filter(Boolean))} text />
        <Setting label="Approved third-sewer dates (YYYY-MM-DD, comma separated)" value={(settings.approvedEmergencyDates || []).join(", ")} onChange={(v) => set("approvedEmergencyDates", v.split(",").map((x) => x.trim()).filter(Boolean))} text />
      </div>
      <label className="ps-notes">
        Product capacity factors (JSON: product name → factor)
        <textarea
          rows={8}
          value={JSON.stringify(settings.productFactors || {}, null, 2)}
          onChange={(e) => {
            try { set("productFactors", JSON.parse(e.target.value)); } catch (_) {}
          }}
        />
      </label>
      <div className="ps-actions"><button className="ps-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Settings"}</button></div>
      <h2>Recent finished sewing output (Top only)</h2>
      <div className="ps-summary-grid">
        {[7, 14, 30].map((days) => {
          const row = metrics[String(days)] || {};
          return <Summary key={days} label={`${days}-day average`} value={row.enoughData ? `${row.averagePerWorkday ?? "—"} / workday` : "Not enough data"} />;
        })}
      </div>
      <p className="ps-help">Recent performance is advisory only. It never changes configured planning capacity automatically.</p>
    </main>
  );
}

function Setting({ label, value, onChange, text }) {
  return <label><span>{label}</span><input type={text ? "text" : "number"} step="0.01" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Summary({ label, value, danger }) {
  return <div className={`ps-summary ${danger ? "danger" : ""}`}><span>{label}</span><strong>{value ?? "—"}</strong></div>;
}

function ChangeList({ title, items, danger }) {
  if (!items.length) return null;
  return <section className="ps-list-section"><h2>{title}</h2>{items.map((item, i) => <div className={`ps-change ${danger ? "danger" : ""}`} key={i}>{item}</div>)}</section>;
}
