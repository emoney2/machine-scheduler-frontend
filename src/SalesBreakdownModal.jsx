import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";

const PALETTE = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
  "#0f766e",
  "#be123c",
  "#65a30d",
  "#9333ea",
  "#0284c7",
  "#c026d3",
];
const HOUSE_COLOR = "#64748b";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PERIOD_TABS = [
  { id: "day", tab: "Today" },
  { id: "week", tab: "This week" },
  { id: "month", tab: "This month" },
  { id: "year", tab: "This year" },
];

const card = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 14,
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtPieces(value) {
  const n = num(value);
  if (Math.abs(n - Math.round(n)) < 0.05) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function money(value) {
  const n = num(value);
  const digits = Math.abs(n) >= 1000 || Number.isInteger(n) ? 0 : 2;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function compactMoney(value) {
  const n = num(value);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}m`;
  if (abs >= 10000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return money(n);
}

function pct(part, whole) {
  if (!(whole > 0)) return "0%";
  return `${Math.round((num(part) / whole) * 100)}%`;
}

function deltaInfo(current, prior) {
  if (!(prior > 0)) {
    if (current > 0) return { text: "New", up: true, flat: false };
    return { text: "—", up: null, flat: false };
  }
  const rounded = Math.round(((current - prior) / prior) * 100);
  if (rounded === 0) return { text: "0%", up: false, flat: true };
  const sign = rounded > 0 ? "+" : "";
  return { text: `${sign}${rounded}%`, up: rounded > 0, flat: false };
}

function deltaColor(info) {
  if (!info || info.up == null || info.flat) return "#64748b";
  return info.up ? "#15803d" : "#b91c1c";
}

function paceColor(perDay, goal) {
  if (!(goal > 0)) return "#0f172a";
  if (perDay >= goal) return "#15803d";
  if (perDay >= goal * 0.8) return "#b45309";
  return "#b91c1c";
}

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(value) {
  const [y, m, d] = String(value || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function mondayOf(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function shortDate(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function eachDay(start, end, fn) {
  if (!start || !end || start.getTime() > end.getTime()) return;
  let guard = 0;
  for (
    let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d.getTime() <= end.getTime() && guard < 800;
    d = addDays(d, 1), guard += 1
  ) {
    fn(d);
  }
}

function countWeekdays(start, end) {
  let n = 0;
  eachDay(start, end, (d) => {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n += 1;
  });
  return n;
}

function emptyTotals() {
  return { pieces: 0, revenue: 0, orders: 0 };
}

function rangeTotals(dayMap, start, end) {
  const all = emptyTotals();
  const byRep = {};
  eachDay(start, end, (d) => {
    const row = dayMap[iso(d)];
    if (!row) return;
    all.pieces += num(row.pieces);
    all.revenue += num(row.revenue);
    all.orders += num(row.orders);
    Object.keys(row.reps || {}).forEach((name) => {
      const vals = row.reps[name] || {};
      if (!byRep[name]) byRep[name] = emptyTotals();
      byRep[name].pieces += num(vals.pieces);
      byRep[name].revenue += num(vals.revenue);
      byRep[name].orders += num(vals.orders);
    });
  });
  return { all, byRep };
}

function sumMonth(dayMap, year, monthIndex, capDate) {
  const start = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  let end = last;
  if (capDate) {
    if (capDate.getTime() < start.getTime()) return null;
    if (capDate.getTime() < last.getTime()) end = capDate;
  }
  return rangeTotals(dayMap, start, end);
}

function bucketFromDay(d, dayMap, asOf) {
  const future = d.getTime() > asOf.getTime();
  const row = dayMap[iso(d)];
  return {
    key: iso(d),
    label: WEEKDAYS[d.getDay()],
    sub: shortDate(d),
    pieces: !future && row ? num(row.pieces) : 0,
    revenue: !future && row ? num(row.revenue) : 0,
    orders: !future && row ? num(row.orders) : 0,
    byRep: !future && row ? row.reps || {} : {},
    future,
    isToday: iso(d) === iso(asOf),
  };
}

function weekDayBuckets(asOf, dayMap) {
  const start = mondayOf(asOf);
  return Array.from({ length: 7 }, (_, i) => bucketFromDay(addDays(start, i), dayMap, asOf));
}

function monthDayBuckets(asOf, dayMap) {
  const start = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const last = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
  const buckets = [];
  eachDay(start, last, (d) => {
    const bucket = bucketFromDay(d, dayMap, asOf);
    buckets.push({
      ...bucket,
      label: String(d.getDate()),
      sub: WEEKDAYS[d.getDay()].slice(0, 1),
    });
  });
  return buckets;
}

function monthWeekBuckets(asOf, dayMap) {
  const start = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const last = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
  const buckets = [];
  let cursor = start;
  let guard = 0;
  while (cursor.getTime() <= last.getTime() && guard < 6) {
    const weekEnd = addDays(mondayOf(cursor), 6);
    const sliceEnd = weekEnd.getTime() < last.getTime() ? weekEnd : last;
    const sumEnd = sliceEnd.getTime() > asOf.getTime() ? asOf : sliceEnd;
    const totals = sumEnd.getTime() < cursor.getTime() ? { all: emptyTotals(), byRep: {} } : rangeTotals(dayMap, cursor, sumEnd);
    buckets.push({
      key: iso(cursor),
      label: shortDate(cursor),
      sub: shortDate(sliceEnd),
      pieces: totals.all.pieces,
      revenue: totals.all.revenue,
      orders: totals.all.orders,
      byRep: totals.byRep,
      future: cursor.getTime() > asOf.getTime(),
      isToday: false,
    });
    cursor = addDays(sliceEnd, 1);
    guard += 1;
  }
  return buckets;
}

function sameDayLastYear(asOf) {
  const rolled = new Date(asOf.getFullYear() - 1, asOf.getMonth(), asOf.getDate());
  if (rolled.getMonth() === asOf.getMonth()) return rolled;
  return new Date(asOf.getFullYear() - 1, asOf.getMonth() + 1, 0);
}

function yearMonthBuckets(asOf, dayMap) {
  return MONTHS.map((label, monthIndex) => {
    const current = sumMonth(dayMap, asOf.getFullYear(), monthIndex, asOf);
    const previousCap = monthIndex === asOf.getMonth() ? sameDayLastYear(asOf) : null;
    const previous = sumMonth(dayMap, asOf.getFullYear() - 1, monthIndex, previousCap);
    return {
      key: `${asOf.getFullYear()}-${monthIndex}`,
      label,
      sub: "",
      pieces: current ? current.all.pieces : 0,
      revenue: current ? current.all.revenue : 0,
      orders: current ? current.all.orders : 0,
      byRep: current ? current.byRep : {},
      future: !current,
      isToday: monthIndex === asOf.getMonth(),
      lastPieces: previous ? previous.all.pieces : 0,
      lastRevenue: previous ? previous.all.revenue : 0,
    };
  });
}

function trendWeeks(asOf, dayMap) {
  const thisMonday = mondayOf(asOf);
  const out = [];
  for (let i = 11; i >= 0; i -= 1) {
    const start = addDays(thisMonday, -7 * i);
    const sunday = addDays(start, 6);
    const end = sunday.getTime() > asOf.getTime() ? asOf : sunday;
    const totals = rangeTotals(dayMap, start, end);
    out.push({
      key: iso(start),
      label: i === 0 ? "Now" : shortDate(start),
      sub: "",
      pieces: totals.all.pieces,
      revenue: totals.all.revenue,
      orders: totals.all.orders,
      byRep: totals.byRep,
      future: false,
      isToday: i === 0,
    });
  }
  return out;
}

function weekdayPattern(dayMap, start, end) {
  const acc = Array.from({ length: 7 }, () => ({ pieces: 0, revenue: 0, count: 0 }));
  eachDay(start, end, (d) => {
    const slot = acc[d.getDay()];
    slot.count += 1;
    const row = dayMap[iso(d)];
    if (!row) return;
    slot.pieces += num(row.pieces);
    slot.revenue += num(row.revenue);
  });
  return [1, 2, 3, 4, 5, 6, 0].map((index) => {
    const slot = acc[index];
    return {
      label: WEEKDAYS[index],
      pieces: slot.pieces,
      revenue: slot.revenue,
      count: slot.count,
      avgPieces: slot.count ? slot.pieces / slot.count : null,
      avgRevenue: slot.count ? slot.revenue / slot.count : null,
    };
  });
}

function buildCalendar(asOf, dayMap) {
  const start = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const end = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
  const cells = [];
  for (let d = mondayOf(start), guard = 0; guard < 42; d = addDays(d, 1), guard += 1) {
    const inMonth = d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
    const row = inMonth ? dayMap[iso(d)] : null;
    const future = d.getTime() > asOf.getTime();
    cells.push({
      date: d,
      inMonth,
      future,
      isToday: iso(d) === iso(asOf),
      pieces: row && !future ? num(row.pieces) : 0,
      revenue: row && !future ? num(row.revenue) : 0,
      reps: row && !future ? row.reps || {} : {},
    });
    if (d.getTime() >= end.getTime() && d.getDay() === 0) break;
  }
  return cells;
}

function repRows(byRep, priorByRep, order) {
  const names = new Set([...order, ...Object.keys(byRep || {}), ...Object.keys(priorByRep || {})]);
  return [...names]
    .map((name) => {
      const current = byRep[name] || emptyTotals();
      const prior = priorByRep[name] || emptyTotals();
      return {
        name,
        pieces: num(current.pieces),
        revenue: num(current.revenue),
        orders: num(current.orders),
        priorPieces: num(prior.pieces),
        priorRevenue: num(prior.revenue),
      };
    })
    .filter((row) => row.pieces || row.revenue || row.orders || row.priorPieces || row.priorRevenue);
}

function rangeText(start, end) {
  if (iso(start) === iso(end)) {
    return `${WEEKDAYS[start.getDay()]}, ${MONTHS_LONG[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`;
  }
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${MONTHS_LONG[start.getMonth()]} ${start.getDate()} to ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${shortDate(start)} to ${shortDate(end)}, ${end.getFullYear()}`;
}

function colorsFor(repNames, houseLabel) {
  const colors = {};
  let paletteIndex = 0;
  repNames.forEach((name) => {
    if (name === houseLabel) {
      colors[name] = HOUSE_COLOR;
      return;
    }
    colors[name] = PALETTE[paletteIndex % PALETTE.length];
    paletteIndex += 1;
  });
  return colors;
}

function buildModel(data) {
  const asOf = parseISO(data.asOf);
  const houseLabel = data.houseLabel || "House Account";
  const dailyGoal = num(data.dailyGoal) || 75;
  const dayMap = {};
  (data.days || []).forEach((row) => {
    if (row && row.date) dayMap[row.date] = row;
  });
  const repNames = [...(data.reps || [])];
  const seen = new Set(repNames);
  Object.keys(dayMap).forEach((key) => {
    Object.keys(dayMap[key].reps || {}).forEach((name) => {
      if (!seen.has(name)) {
        seen.add(name);
        repNames.push(name);
      }
    });
  });
  const colors = colorsFor(repNames, houseLabel);
  const weekStart = mondayOf(asOf);
  const monthStart = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const yearStart = new Date(asOf.getFullYear(), 0, 1);
  const monthEnd = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
  const yearEnd = new Date(asOf.getFullYear(), 11, 31);

  const windows = {
    day: {
      title: "Today",
      start: asOf,
      end: asOf,
      priorStart: addDays(asOf, -7),
      priorEnd: addDays(asOf, -7),
      priorLabel: `vs last ${WEEKDAYS[asOf.getDay()]}`,
    },
    week: {
      title: "This week",
      start: weekStart,
      end: asOf,
      priorStart: addDays(weekStart, -7),
      priorEnd: addDays(asOf, -7),
      priorLabel: "vs last week",
    },
    month: {
      title: `${MONTHS_LONG[asOf.getMonth()]} ${asOf.getFullYear()}`,
      start: monthStart,
      end: asOf,
      priorStart: new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1),
      priorEnd: priorMonthEnd(asOf),
      priorLabel: "vs last month",
    },
    year: {
      title: String(asOf.getFullYear()),
      start: yearStart,
      end: asOf,
      priorStart: new Date(asOf.getFullYear() - 1, 0, 1),
      priorEnd: priorYearEnd(asOf),
      priorLabel: "vs last year",
    },
  };

  const weekBuckets = weekDayBuckets(asOf, dayMap);
  const monthBuckets = monthDayBuckets(asOf, dayMap);
  const monthWeeks = monthWeekBuckets(asOf, dayMap);
  const yearBuckets = yearMonthBuckets(asOf, dayMap);
  const weeks = trendWeeks(asOf, dayMap);
  const wow = weeks.slice(1).map((week, index) => ({
    label: week.label,
    deltaPieces: week.pieces - weeks[index].pieces,
    deltaRevenue: week.revenue - weeks[index].revenue,
  }));

  const periods = {};
  PERIOD_TABS.forEach(({ id }) => {
    const window = windows[id];
    const current = rangeTotals(dayMap, window.start, window.end);
    const prior = rangeTotals(dayMap, window.priorStart, window.priorEnd);
    const reps = repRows(current.byRep, prior.byRep, repNames).sort(
      (a, b) => b.revenue - a.revenue || b.pieces - a.pieces || a.name.localeCompare(b.name)
    );
    const elapsed = id === "day" ? 1 : countWeekdays(window.start, window.end);
    const goalDays = id === "day" ? 1 : id === "week" ? 5 : id === "month" ? countWeekdays(monthStart, monthEnd) : countWeekdays(yearStart, yearEnd);
    const perDay = elapsed > 0 ? current.all.pieces / elapsed : 0;
    const chartBuckets = id === "year" ? yearBuckets : id === "month" ? monthBuckets : weekBuckets;
    const matrixBuckets = id === "year" ? yearBuckets.filter((bucket) => !bucket.future) : id === "month" ? monthWeeks : weekBuckets;
    const weekdays = weekdayPattern(dayMap, window.start, window.end);
    const bestWeekday = [...weekdays].filter((row) => row.count > 0).sort((a, b) => b.avgPieces - a.avgPieces)[0] || null;
    const leader = reps.find((row) => row.revenue > 0 || row.pieces > 0) || null;
    periods[id] = {
      id,
      title: window.title,
      rangeLabel: rangeText(window.start, window.end),
      priorLabel: window.priorLabel,
      totals: current.all,
      prior: prior.all,
      reps,
      chartBuckets,
      matrixBuckets,
      weekdays,
      bestWeekday,
      leader,
      pace: {
        perDay,
        elapsed,
        goalDays,
        goalPieces: dailyGoal * goalDays,
        projected: id === "day" ? current.all.pieces : perDay * goalDays,
        dailyGoal,
      },
    };
  });

  return {
    asOf,
    generatedAt: data.generatedAt,
    houseLabel,
    dailyGoal,
    weeklyGoal: num(data.weeklyGoal) || dailyGoal * 5,
    note: data.note,
    stats: data.stats || {},
    colors,
    repNames,
    periods,
    weeks,
    wow,
    yearBuckets,
    calendar: buildCalendar(asOf, dayMap),
    topProducts: data.topProducts || {},
  };
}

function priorMonthEnd(asOf) {
  const prevStart = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
  const rolled = new Date(asOf.getFullYear(), asOf.getMonth() - 1, asOf.getDate());
  if (rolled.getMonth() === prevStart.getMonth()) return rolled;
  return new Date(asOf.getFullYear(), asOf.getMonth(), 0);
}

function priorYearEnd(asOf) {
  return sameDayLastYear(asOf);
}

function formatGenerated(stamp) {
  if (!stamp) return "";
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function legendNames(buckets, repNames) {
  const used = new Set();
  (buckets || []).forEach((bucket) => {
    Object.keys(bucket.byRep || {}).forEach((name) => {
      const vals = bucket.byRep[name] || {};
      if (num(vals.pieces) || num(vals.revenue)) used.add(name);
    });
  });
  const ordered = repNames.filter((name) => used.has(name));
  used.forEach((name) => {
    if (!ordered.includes(name)) ordered.push(name);
  });
  return ordered;
}

function headline(view, houseLabel, dailyGoal) {
  const parts = [
    `${view.title} is ${fmtPieces(view.totals.pieces)} pieces and ${money(view.totals.revenue)}.`,
  ];
  if (view.leader) {
    parts.push(`${view.leader.name} leads revenue at ${money(view.leader.revenue)}.`);
  }
  if (view.id === "day") {
    parts.push(`Daily goal is ${fmtPieces(dailyGoal)} pieces.`);
  } else if (view.pace.elapsed > 0) {
    parts.push(`Pace is ${fmtPieces(view.pace.perDay)} pieces per weekday, against ${fmtPieces(dailyGoal)} a day.`);
  }
  if (view.bestWeekday && view.id !== "day") {
    parts.push(`${view.bestWeekday.label} is the strongest weekday at ${fmtPieces(view.bestWeekday.avgPieces)} pieces on average.`);
  }
  const house = view.reps.find((row) => row.name === houseLabel);
  if (house && view.totals.pieces > 0 && house.pieces / view.totals.pieces >= 0.15) {
    parts.push(`House Account is ${pct(house.pieces, view.totals.pieces)} of pieces.`);
  }
  return parts.join(" ");
}

function Section({ title, hint, children }) {
  return (
    <section style={{ ...card, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "#0f172a" }}>{title}</h3>
        {hint ? <div style={{ fontSize: 12, color: "#64748b" }}>{hint}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Legend({ names, colors }) {
  if (!names.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
      {names.map((name) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: "#334155" }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: colors[name] || "#94a3b8" }} />
          {name}
        </div>
      ))}
    </div>
  );
}

function HBarChart({ title, rows, field, format, total, colors }) {
  const max = Math.max(1, ...rows.map((row) => num(row[field])));
  const positiveTotal = rows.reduce((sum, row) => sum + Math.max(0, num(row[field])), 0);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#0f172a" }}>{title}</div>
      {rows.length === 0 ? <div style={{ color: "#64748b", fontSize: 13 }}>No sales in this stretch.</div> : null}
      {rows.map((row) => {
        const value = num(row[field]);
        const width = value > 0 ? (value / max) * 100 : 0;
        return (
          <div key={row.name} style={{ display: "grid", gridTemplateColumns: "minmax(88px, 132px) 1fr auto", gap: 8, alignItems: "center", marginBottom: 7 }}>
            <div title={row.name} style={{ fontSize: 13, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.name}
            </div>
            <div style={{ background: "#f1f5f9", borderRadius: 999, height: 14, overflow: "hidden" }}>
              <div style={{ width: `${width}%`, height: "100%", background: colors[row.name] || "#94a3b8", minWidth: value > 0 ? 3 : 0 }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {format(value)}
              <span style={{ color: "#64748b", fontWeight: 650, marginLeft: 6 }}>{pct(Math.max(0, value), positiveTotal || total)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function arcPath(cx, cy, r, start, end) {
  const point = (angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function Donut({ slices, center }) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, num(slice.value)), 0);
  const positive = slices.filter((slice) => num(slice.value) > 0);
  const cx = 60;
  const cy = 60;
  const r = 38;
  const paths = [];
  if (total <= 0 || positive.length === 0) {
    paths.push(<circle key="empty" cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="16" />);
  } else if (positive.length === 1) {
    paths.push(<circle key={positive[0].name} cx={cx} cy={cy} r={r} fill="none" stroke={positive[0].color} strokeWidth="16" />);
  } else {
    let angle = -Math.PI / 2;
    positive.forEach((slice) => {
      const sweep = (num(slice.value) / total) * Math.PI * 2;
      const end = angle + (sweep > 0.05 ? sweep - 0.012 : sweep);
      paths.push(
        <path key={slice.name} d={arcPath(cx, cy, r, angle, end)} fill="none" stroke={slice.color} strokeWidth="16" strokeLinecap="butt">
          <title>{`${slice.name}: ${slice.label}`}</title>
        </path>
      );
      angle += sweep;
    });
  }
  return (
    <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label={center}>
      {paths}
      <text x="60" y="56" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0f172a">{center}</text>
      <text x="60" y="72" textAnchor="middle" fontSize="9" fill="#64748b">total</text>
    </svg>
  );
}

function StackedColumns({ title, buckets, names, colors, field, format }) {
  const max = Math.max(1, ...buckets.map((bucket) => Math.max(0, num(bucket[field]))));
  const wide = buckets.length > 16;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: wide ? 3 : 8, height: 248, minWidth: wide ? buckets.length * 34 : "100%" }}>
          {buckets.map((bucket) => {
            const value = Math.max(0, num(bucket[field]));
            const compare = field === "pieces" ? bucket.lastPieces : bucket.lastRevenue;
            return (
              <div key={bucket.key} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                <div style={{ fontSize: wide ? 10 : 11, fontWeight: 800, color: bucket.future ? "#94a3b8" : "#0f172a", minHeight: 16 }}>
                  {bucket.future ? "" : format(bucket[field])}
                </div>
                <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  <div
                    style={{
                      width: wide ? "78%" : "62%",
                      height: `${(value / max) * 100}%`,
                      minHeight: value > 0 ? 3 : 0,
                      display: "flex",
                      flexDirection: "column-reverse",
                      borderRadius: 5,
                      overflow: "hidden",
                      outline: bucket.isToday ? "2px solid #1d4ed8" : "none",
                      outlineOffset: 1,
                    }}
                  >
                    {names.map((name) => {
                      const part = Math.max(0, num(bucket.byRep?.[name]?.[field]));
                      if (!(part > 0) || !(value > 0)) return null;
                      return (
                        <div key={name} title={`${name}: ${format(part)}`} style={{ height: `${(part / value) * 100}%`, background: colors[name] || "#94a3b8" }} />
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, fontWeight: bucket.isToday ? 800 : 650, color: bucket.isToday ? "#1d4ed8" : "#475569", textAlign: "center" }}>
                  {bucket.label}
                </div>
                {bucket.sub && !wide ? <div style={{ fontSize: 10, color: "#94a3b8" }}>{bucket.sub}</div> : null}
                {compare != null && (num(compare) || num(bucket[field])) ? (
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>LY {format(compare)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LineChart({ labels, series, formatValue }) {
  const width = 720;
  const height = 220;
  const pad = { l: 52, r: 12, t: 16, b: 32 };
  const nums = [];
  series.forEach((item) => item.values.forEach((value) => {
    if (value != null && Number.isFinite(value)) nums.push(value);
  }));
  const max = Math.max(1, ...nums);
  const n = Math.max(labels.length, 1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const xAt = (index) => (n <= 1 ? pad.l + innerW / 2 : pad.l + (index / (n - 1)) * innerW);
  const yAt = (value) => pad.t + innerH - (value / max) * innerH;
  const ticks = [0, max / 2, max];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="220" role="img">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.l} x2={width - pad.r} y1={yAt(tick)} y2={yAt(tick)} stroke="#e5e7eb" />
          <text x={pad.l - 6} y={yAt(tick) + 3} textAnchor="end" fontSize="10" fill="#64748b">{formatValue(tick)}</text>
        </g>
      ))}
      {series.map((item) => {
        const segments = [];
        let current = [];
        item.values.forEach((value, index) => {
          if (value == null || !Number.isFinite(value)) {
            if (current.length) segments.push(current);
            current = [];
          } else {
            current.push(index);
          }
        });
        if (current.length) segments.push(current);
        return (
          <g key={item.name}>
            {segments.map((segment) => (
              <polyline
                key={`${item.name}-${segment[0]}`}
                fill="none"
                stroke={item.color}
                strokeWidth="2.5"
                points={segment.map((index) => `${xAt(index)},${yAt(item.values[index])}`).join(" ")}
              />
            ))}
            {item.values.map((value, index) => (
              value == null ? null : (
                <circle key={`${item.name}-pt-${index}`} cx={xAt(index)} cy={yAt(value)} r="3" fill={item.color}>
                  <title>{`${item.name} ${labels[index]}: ${formatValue(value)}`}</title>
                </circle>
              )
            ))}
          </g>
        );
      })}
      {labels.map((label, index) => (
        <text key={`${label}-${index}`} x={xAt(index)} y={height - 8} textAnchor="middle" fontSize="10" fill="#64748b">{label}</text>
      ))}
    </svg>
  );
}

function DeltaBars({ rows, field, formatValue }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(num(row[field]))));
  return (
    <div>
      {rows.map((row) => {
        const delta = num(row[field]);
        const width = (Math.abs(delta) / max) * 50;
        const positive = delta >= 0;
        return (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "72px 1fr 76px", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>{row.label}</div>
            <div style={{ position: "relative", height: 12, background: "#f1f5f9", borderRadius: 999 }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#cbd5e1" }} />
              <div
                style={{
                  position: "absolute",
                  top: 1,
                  bottom: 1,
                  width: `${width}%`,
                  left: positive ? "50%" : `calc(50% - ${width}%)`,
                  background: positive ? "#16a34a" : "#dc2626",
                  borderRadius: 999,
                }}
              />
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, textAlign: "right", color: delta === 0 ? "#64748b" : positive ? "#15803d" : "#b91c1c" }}>
              {positive && delta !== 0 ? "+" : ""}{formatValue(delta)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GoalTrack({ actual, goal, projected }) {
  const showProjected = projected != null && Math.abs(projected - actual) > 0.5;
  const max = Math.max(actual, goal, showProjected ? projected : 0, 1);
  const mark = (value, color, label) => (
    <div style={{ position: "absolute", left: `${Math.min(100, (value / max) * 100)}%`, top: -4, bottom: -4, width: 2, background: color }} title={`${label} ${fmtPieces(value)}`} />
  );
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ position: "relative", height: 16, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, (Math.max(0, actual) / max) * 100)}%`, height: "100%", background: "#2563eb" }} />
      </div>
      <div style={{ position: "relative", height: 8 }}>
        {mark(goal, "#0f172a", "Goal")}
        {showProjected ? mark(projected, "#16a34a", "On pace") : null}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#475569", marginTop: 2 }}>
        <span><strong style={{ color: "#2563eb" }}>{fmtPieces(actual)}</strong> sold</span>
        <span><strong>{fmtPieces(goal)}</strong> goal</span>
        {showProjected ? <span><strong style={{ color: "#15803d" }}>{fmtPieces(projected)}</strong> on this pace</span> : null}
      </div>
    </div>
  );
}

function VerticalBars({ buckets, field, format, color }) {
  const max = Math.max(1, ...buckets.map((bucket) => num(bucket[field])));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 170 }}>
      {buckets.map((bucket) => {
        const value = bucket[field];
        const height = value == null ? 0 : (num(value) / max) * 100;
        return (
          <div key={bucket.label} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 800, minHeight: 16 }}>{value == null ? "—" : format(value)}</div>
            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              <div style={{ width: "68%", height: `${height}%`, minHeight: num(value) > 0 ? 3 : 0, background: color, borderRadius: 5 }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700 }}>{bucket.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ values, color }) {
  const w = 96;
  const h = 28;
  const max = Math.max(1, ...values.map((value) => num(value)));
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? w / 2 : (index / (values.length - 1)) * (w - 4) + 2;
    const y = h - 3 - (num(value) / max) * (h - 8);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth="1.75" points={points} />
    </svg>
  );
}

function NumPair({ pieces, revenue }) {
  if (!num(pieces) && !num(revenue)) return <span style={{ color: "#cbd5e1" }}>·</span>;
  return (
    <div>
      <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtPieces(pieces)}</div>
      <div style={{ fontSize: 11, color: "#64748b", fontVariantNumeric: "tabular-nums" }}>{compactMoney(revenue)}</div>
    </div>
  );
}

const stickyCell = {
  position: "sticky",
  left: 0,
  background: "#fff",
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
  zIndex: 1,
  minWidth: 140,
};
const numCell = {
  textAlign: "right",
  padding: "8px 8px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

function RepMatrix({ title, hint, buckets, repNames, colors, houseLabel, compareLabel, compare }) {
  const names = legendNames(buckets, repNames);
  const rows = [...names].sort((a, b) => {
    const rev = (name) => buckets.reduce((sum, bucket) => sum + num(bucket.byRep?.[name]?.revenue), 0);
    return rev(b) - rev(a) || a.localeCompare(b);
  });
  const grandPieces = buckets.reduce((sum, bucket) => sum + (bucket.future ? 0 : num(bucket.pieces)), 0);
  const grandRevenue = buckets.reduce((sum, bucket) => sum + (bucket.future ? 0 : num(bucket.revenue)), 0);
  return (
    <Section title={title} hint={hint}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...stickyCell, fontSize: 11, color: "#64748b" }}>Rep</th>
              <th style={{ ...numCell, fontSize: 11, color: "#64748b" }}>Total</th>
              {buckets.map((col) => (
                <th key={col.key} style={{ ...numCell, fontSize: 11, color: col.isToday ? "#1d4ed8" : "#64748b" }}>
                  <div>{col.label}</div>
                  {col.sub ? <div style={{ fontWeight: 500, color: "#94a3b8" }}>{col.sub}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((name) => (
              <tr key={name}>
                <td style={stickyCell}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: colors[name] || "#94a3b8" }} />
                    <span style={{ fontWeight: 750 }}>{name}</span>
                  </div>
                  {name === houseLabel ? <div style={{ fontSize: 10, color: "#94a3b8", paddingLeft: 14 }}>No rep on the order</div> : null}
                </td>
                <td style={numCell}>
                  <NumPair
                    pieces={buckets.reduce((sum, bucket) => sum + num(bucket.byRep?.[name]?.pieces), 0)}
                    revenue={buckets.reduce((sum, bucket) => sum + num(bucket.byRep?.[name]?.revenue), 0)}
                  />
                </td>
                {buckets.map((col) => (
                  <td key={col.key} style={{ ...numCell, background: col.isToday ? "#eff6ff" : undefined }}>
                    {col.future ? <span style={{ color: "#cbd5e1" }}>·</span> : (
                      <NumPair pieces={col.byRep?.[name]?.pieces} revenue={col.byRep?.[name]?.revenue} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td style={{ ...stickyCell, fontWeight: 800 }}>All reps</td>
              <td style={numCell}><NumPair pieces={grandPieces} revenue={grandRevenue} /></td>
              {buckets.map((col) => (
                <td key={col.key} style={numCell}>
                  {col.future ? <span style={{ color: "#cbd5e1" }}>·</span> : <NumPair pieces={col.pieces} revenue={col.revenue} />}
                </td>
              ))}
            </tr>
            {compare ? (
              <tr>
                <td style={{ ...stickyCell, color: "#64748b" }}>{compareLabel}</td>
                <td style={numCell}>
                  <NumPair
                    pieces={compare.reduce((sum, cell) => sum + num(cell.pieces), 0)}
                    revenue={compare.reduce((sum, cell) => sum + num(cell.revenue), 0)}
                  />
                </td>
                {compare.map((cell, index) => (
                  <td key={buckets[index].key} style={numCell}><NumPair pieces={cell.pieces} revenue={cell.revenue} /></td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <div style={{ color: "#64748b", marginTop: 8 }}>No sales in this stretch.</div> : null}
    </Section>
  );
}

function MonthCalendar({ cells }) {
  const max = Math.max(1, ...cells.filter((cell) => cell.inMonth && !cell.future).map((cell) => cell.pieces));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
        <div key={label} style={{ textAlign: "center", fontSize: 11, fontWeight: 800, color: "#64748b" }}>{label}</div>
      ))}
      {cells.map((cell) => {
        const alpha = !cell.inMonth || cell.future || !cell.pieces ? 0 : 0.12 + 0.78 * (cell.pieces / max);
        const tip = Object.entries(cell.reps || {})
          .sort((a, b) => num(b[1].revenue) - num(a[1].revenue))
          .map(([name, vals]) => `${name}: ${fmtPieces(vals.pieces)} · ${money(vals.revenue)}`)
          .join("\n");
        return (
          <div
            key={iso(cell.date)}
            title={tip || "No sales"}
            style={{
              minHeight: 74,
              borderRadius: 8,
              padding: 6,
              background: cell.inMonth ? `rgba(37, 99, 235, ${alpha})` : "transparent",
              border: cell.isToday ? "2px solid #1d4ed8" : "1px solid #e5e7eb",
              opacity: cell.inMonth ? 1 : 0.4,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: cell.isToday ? "#1d4ed8" : "#334155" }}>{cell.date.getDate()}</div>
            {cell.inMonth && !cell.future ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{fmtPieces(cell.pieces)}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{compactMoney(cell.revenue)}</div>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function chartCopy(view) {
  if (view.id === "day") {
    return {
      title: "This week by day",
      hint: "Today is highlighted. The totals above are today only.",
      matrixTitle: "Each rep, each day this week",
      matrixHint: "Top number is pieces. Under it is revenue.",
    };
  }
  if (view.id === "week") {
    return {
      title: "This week by day",
      hint: view.rangeLabel,
      matrixTitle: "Each rep, each day this week",
      matrixHint: "Top number is pieces. Under it is revenue.",
    };
  }
  if (view.id === "month") {
    return {
      title: "This month by day",
      hint: view.rangeLabel,
      matrixTitle: "Each rep, each week this month",
      matrixHint: "Weeks run Monday to Sunday, clipped to the month.",
    };
  }
  return {
    title: "This year by month",
    hint: "Earlier months are full. This month runs through today on both years.",
    matrixTitle: "Each rep, each month this year",
    matrixHint: "Last year matches the same dates. Later months stay on the chart below.",
  };
}

function SalesDashboard({ data }) {
  const [period, setPeriod] = useState("week");
  const model = useMemo(() => buildModel(data), [data]);
  const view = model.periods[period];
  const copy = chartCopy(view);
  const stackNames = legendNames(view.chartBuckets, model.repNames);
  const trendNames = legendNames(model.weeks, model.repNames);
  const pieceDelta = deltaInfo(view.totals.pieces, view.prior.pieces);
  const revenueDelta = deltaInfo(view.totals.revenue, view.prior.revenue);
  const orderDelta = deltaInfo(view.totals.orders, view.prior.orders);
  const avgPrice = view.totals.pieces ? view.totals.revenue / view.totals.pieces : 0;
  const priorAvg = view.prior.pieces ? view.prior.revenue / view.prior.pieces : 0;
  const products = (model.topProducts && model.topProducts[period]) || [];
  const productMaxPieces = Math.max(1, ...products.map((row) => num(row.pieces)));
  const productMaxRevenue = Math.max(1, ...products.map((row) => num(row.revenue)));
  const sparks = model.weeks.slice(-8);
  const activeReps = view.reps.filter((row) => row.pieces || row.revenue || row.orders);
  const yearCompare = view.id === "year"
    ? view.matrixBuckets.map((bucket) => ({ pieces: bucket.lastPieces, revenue: bucket.lastRevenue }))
    : null;
  const updated = formatGenerated(model.generatedAt);

  const kpis = [
    { label: "Pieces", value: fmtPieces(view.totals.pieces), delta: pieceDelta, sub: view.priorLabel },
    { label: "Revenue", value: money(view.totals.revenue), delta: revenueDelta, sub: view.priorLabel },
    { label: "Orders", value: fmtPieces(view.totals.orders), delta: orderDelta, sub: view.priorLabel },
    { label: "Avg price / piece", value: view.totals.pieces ? money(avgPrice) : "—", delta: deltaInfo(avgPrice, priorAvg), sub: view.priorLabel },
    {
      label: "Weekday pace",
      value: `${fmtPieces(view.pace.perDay)}/day`,
      color: paceColor(view.pace.perDay, model.dailyGoal),
      sub: `Goal ${fmtPieces(model.dailyGoal)}/day`,
    },
    view.id === "day"
      ? { label: `Last ${WEEKDAYS[model.asOf.getDay()]}`, value: fmtPieces(view.prior.pieces), sub: money(view.prior.revenue) }
      : { label: "On this pace", value: fmtPieces(view.pace.projected), sub: `Goal ${fmtPieces(view.pace.goalPieces)} pieces` },
  ];

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PERIOD_TABS.map((tab) => {
          const item = model.periods[tab.id];
          const active = period === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPeriod(tab.id)}
              style={{
                border: active ? "1px solid #0f172a" : "1px solid #e5e7eb",
                background: active ? "#0f172a" : "#fff",
                color: active ? "#fff" : "#0f172a",
                borderRadius: 10,
                padding: "8px 12px",
                minWidth: 118,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>{tab.tab}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtPieces(item.totals.pieces)}</div>
              <div style={{ fontSize: 12 }}>{compactMoney(item.totals.revenue)}</div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: "#475569" }}>
        {view.rangeLabel}
        {updated ? ` · Updated ${updated}` : ""}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.45, color: "#0f172a" }}>{headline(view, model.houseLabel, model.dailyGoal)}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
        {kpis.map((item) => (
          <div key={item.label} style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>{item.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: item.color || "#0f172a", fontVariantNumeric: "tabular-nums" }}>{item.value}</div>
            {item.delta ? (
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 750, color: deltaColor(item.delta) }}>
                {item.delta.text} {item.sub}
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{item.sub}</div>
            )}
          </div>
        ))}
      </div>
      <div style={{ ...card, marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>Pieces against the goal</div>
        <GoalTrack
          actual={view.totals.pieces}
          goal={view.pace.goalPieces}
          projected={view.id === "day" ? null : view.pace.projected}
        />
      </div>

      <Section title={`${view.title} by rep`} hint="House Account is any order with a blank rep.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          <HBarChart title="Pieces" rows={activeReps} field="pieces" format={fmtPieces} total={view.totals.pieces} colors={model.colors} />
          <HBarChart title="Revenue" rows={activeReps} field="revenue" format={money} total={view.totals.revenue} colors={model.colors} />
          <HBarChart title="Orders" rows={activeReps} field="orders" format={fmtPieces} total={view.totals.orders} colors={model.colors} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 16, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Donut
              center={fmtPieces(view.totals.pieces)}
              slices={activeReps.filter((row) => row.pieces > 0).map((row) => ({
                name: row.name,
                value: row.pieces,
                color: model.colors[row.name] || "#94a3b8",
                label: fmtPieces(row.pieces),
              }))}
            />
            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Piece mix</div>
              <Legend names={activeReps.filter((row) => row.pieces > 0).map((row) => row.name)} colors={model.colors} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Donut
              center={compactMoney(view.totals.revenue)}
              slices={activeReps.filter((row) => row.revenue > 0).map((row) => ({
                name: row.name,
                value: row.revenue,
                color: model.colors[row.name] || "#94a3b8",
                label: money(row.revenue),
              }))}
            />
            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Revenue mix</div>
              <Legend names={activeReps.filter((row) => row.revenue > 0).map((row) => row.name)} colors={model.colors} />
            </div>
          </div>
        </div>
      </Section>

      <Section title={copy.title} hint={copy.hint}>
        <Legend names={stackNames} colors={model.colors} />
        <StackedColumns title="Pieces" buckets={view.chartBuckets} names={stackNames} colors={model.colors} field="pieces" format={fmtPieces} />
        <StackedColumns title="Revenue" buckets={view.chartBuckets} names={stackNames} colors={model.colors} field="revenue" format={compactMoney} />
      </Section>

      <RepMatrix
        title={copy.matrixTitle}
        hint={copy.matrixHint}
        buckets={view.matrixBuckets}
        repNames={model.repNames}
        colors={model.colors}
        houseLabel={model.houseLabel}
        compareLabel="Last year"
        compare={yearCompare}
      />

      {view.id === "month" ? (
        <Section title={`${MONTHS_LONG[model.asOf.getMonth()]} calendar`} hint="Color deepens as pieces go up. Hover a day for the rep split.">
          <MonthCalendar cells={model.calendar} />
        </Section>
      ) : null}

      <Section title="Weekday pattern" hint={`Average per weekday in ${view.rangeLabel}.`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Average pieces</div>
            <VerticalBars buckets={view.weekdays} field="avgPieces" format={fmtPieces} color="#2563eb" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Average revenue</div>
            <VerticalBars buckets={view.weekdays} field="avgRevenue" format={compactMoney} color="#0f766e" />
          </div>
        </div>
      </Section>

      <Section title="Last 12 weeks" hint="Each bar is Monday through Sunday. This week runs through today.">
        <Legend names={trendNames} colors={model.colors} />
        <StackedColumns title="Pieces" buckets={model.weeks} names={trendNames} colors={model.colors} field="pieces" format={fmtPieces} />
        <StackedColumns title="Revenue" buckets={model.weeks} names={trendNames} colors={model.colors} field="revenue" format={compactMoney} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Week to week change in pieces</div>
            <DeltaBars rows={model.wow} field="deltaPieces" formatValue={fmtPieces} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Week to week change in revenue</div>
            <DeltaBars rows={model.wow} field="deltaRevenue" formatValue={compactMoney} />
          </div>
        </div>
      </Section>

      <Section title={`${model.asOf.getFullYear()} vs ${model.asOf.getFullYear() - 1}`} hint="This month is through the same date. Earlier months are full. Later months show last year only.">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8, fontSize: 12, fontWeight: 700 }}>
          <span style={{ color: "#2563eb" }}>This year</span>
          <span style={{ color: "#94a3b8" }}>Last year</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Pieces</div>
        <LineChart
          labels={MONTHS}
          formatValue={fmtPieces}
          series={[
            { name: "This year", color: "#2563eb", values: model.yearBuckets.map((bucket) => (bucket.future ? null : bucket.pieces)) },
            { name: "Last year", color: "#94a3b8", values: model.yearBuckets.map((bucket) => num(bucket.lastPieces)) },
          ]}
        />
        <div style={{ fontSize: 13, fontWeight: 800, margin: "12px 0 4px" }}>Revenue</div>
        <LineChart
          labels={MONTHS}
          formatValue={compactMoney}
          series={[
            { name: "This year", color: "#0f766e", values: model.yearBuckets.map((bucket) => (bucket.future ? null : bucket.revenue)) },
            { name: "Last year", color: "#94a3b8", values: model.yearBuckets.map((bucket) => num(bucket.lastRevenue)) },
          ]}
        />
      </Section>

      <Section title={`Top products · ${view.title}`} hint="By revenue.">
        {products.length === 0 ? <div style={{ color: "#64748b" }}>No products in this stretch.</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1.3fr) 1fr 1fr", gap: 8, fontSize: 11, fontWeight: 800, color: "#64748b" }}>
              <div>Product</div>
              <div>Pieces</div>
              <div>Revenue</div>
            </div>
            {products.map((row) => (
              <div key={row.name} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1.3fr) 1fr 1fr", gap: 8, alignItems: "center" }}>
                <div title={row.name} style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
                  <div style={{ background: "#f1f5f9", borderRadius: 999, height: 10 }}>
                    <div style={{ width: `${(num(row.pieces) / productMaxPieces) * 100}%`, height: "100%", background: "#2563eb", borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtPieces(row.pieces)}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
                  <div style={{ background: "#f1f5f9", borderRadius: 999, height: 10 }}>
                    <div style={{ width: `${(Math.max(0, num(row.revenue)) / productMaxRevenue) * 100}%`, height: "100%", background: "#0f766e", borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{compactMoney(row.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Leaderboard" hint={`${view.priorLabel}. Sparkline is pieces over the last 8 weeks.`}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                {["#", "Rep", "Pieces", "vs prior", "Revenue", "vs prior", "Orders", "Avg price", "Piece share", "Rev share", "8 wks"].map((label) => (
                  <th key={label} style={{ textAlign: label === "Rep" ? "left" : "right", padding: "8px", borderBottom: "1px solid #e5e7eb", color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.reps.map((row, index) => {
                const piecesDelta = deltaInfo(row.pieces, row.priorPieces);
                const revenueDeltaRow = deltaInfo(row.revenue, row.priorRevenue);
                const spark = sparks.map((week) => num(week.byRep?.[row.name]?.pieces));
                return (
                  <tr key={row.name} style={{ background: index === 0 ? "#f8fafc" : undefined }}>
                    <td style={{ padding: "8px", textAlign: "right", fontWeight: 800 }}>{index + 1}</td>
                    <td style={{ padding: "8px", fontWeight: 750, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: model.colors[row.name] || "#94a3b8", marginRight: 6 }} />
                      {row.name}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontWeight: 800 }}>{fmtPieces(row.pieces)}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: deltaColor(piecesDelta), fontWeight: 750 }}>{piecesDelta.text}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontWeight: 800 }}>{money(row.revenue)}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: deltaColor(revenueDeltaRow), fontWeight: 750 }}>{revenueDeltaRow.text}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{fmtPieces(row.orders)}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{row.pieces ? money(row.revenue / row.pieces) : "—"}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{pct(row.pieces, view.totals.pieces)}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{pct(row.revenue, view.totals.revenue)}</td>
                    <td style={{ padding: "8px 8px 4px", textAlign: "right" }}><Sparkline values={spark} color={model.colors[row.name] || "#64748b"} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {model.note ? <p style={{ fontSize: 12, color: "#64748b", marginTop: 14, lineHeight: 1.45 }}>{model.note}</p> : null}
    </>
  );
}

export default function SalesBreakdownModal({ open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const dataRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(dataRef.current == null);
    setError("");
    axios
      .get(`${API_ROOT}/overview/sales-breakdown`, { withCredentials: true, timeout: 90000 })
      .then((res) => {
        if (cancelled) return;
        dataRef.current = res.data;
        setData(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.response?.data?.error || err?.message || "Could not load sales.";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sales breakdown"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        zIndex: 10060,
        display: "flex",
        justifyContent: "center",
        padding: 8,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(1440px, 100%)",
          height: "calc(100vh - 16px)",
          background: "#f8fafc",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>Sales</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Pieces and revenue by rep, for the day, week, month, and year.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, padding: "8px 12px", fontWeight: 750, cursor: "pointer" }}
          >
            Close
          </button>
        </header>
        <div style={{ overflow: "auto", padding: 16, flex: 1 }}>
          {error ? (
            <div style={{ background: "#fef2f2", color: "#991b1b", padding: "10px 12px", borderRadius: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span>{error}</span>
              <button type="button" onClick={() => setReloadKey((key) => key + 1)} style={{ border: "1px solid #fecaca", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
                Try again
              </button>
            </div>
          ) : null}
          {loading && !data ? (
            <div style={{ padding: 48, textAlign: "center", fontWeight: 750, color: "#334155" }}>Loading sales…</div>
          ) : null}
          {loading && data ? <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Refreshing…</div> : null}
          {data && !data.error ? <SalesDashboard data={data} /> : null}
        </div>
      </div>
    </div>
  );
}
