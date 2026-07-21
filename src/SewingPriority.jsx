import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

const ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");
const DAYS_WINDOW = 7;

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
      title="Sewing complete — ready for shipping"
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

export default function SewingPriority() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const ctrlRef = useRef(null);

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
        const res = await axios.get(url, {
          withCredentials: true,
          signal: ctrl.signal,
          timeout: 45000,
        });
        if (!alive) return;

        const raw = Array.isArray(res?.data?.upcoming) ? res.data.upcoming : [];
        const seen = new Set();
        const filtered = [];
        for (const j of raw) {
          if (isStageCompleted(j)) continue;
          if (!isJobInTimeWindow(j, DAYS_WINDOW)) continue;
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
        setLastUpdated(new Date());
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
    <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>
            Sewing Priority
          </h2>
          <div style={{ marginTop: 4, fontSize: 13, color: "#6b7280" }}>
            Ship in next {DAYS_WINDOW} days · green on time · yellow ships today · red catch up
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af" }}>
          {lastUpdated
            ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : loading
              ? "Loading…"
              : ""}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
          fontSize: 12,
          color: "#4b5563",
        }}
      >
        <Legend color="#2ecc71" label="On time" />
        <Legend color="#f1c40f" label="Ship today" />
        <Legend color="#e74c3c" label="Catch up" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ opacity: 0.7 }}>✓</span> Sewing done (stays for shipping)
        </span>
      </div>

      {error && (
        <div style={{ padding: 12, marginBottom: 12, background: "#fef2f2", color: "#b91c1c", borderRadius: 8 }}>
          {error}
        </div>
      )}

      {loading && !jobs.length && (
        <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>Loading jobs…</div>
      )}

      {!loading && !jobs.length && !error && (
        <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>No jobs in the next {DAYS_WINDOW} days.</div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 20,
          opacity: loading && jobs.length ? 0.7 : 1,
        }}
      >
        {jobs.map((job, idx) => {
          const order = String(job["Order #"] ?? "").trim() || "—";
          const customer = String(job["Company Name"] ?? job["Company"] ?? job["Customer"] ?? "").trim();
          const shipDate = job["Ship Date"] ?? job["Ship"] ?? null;
          const outline = outlineByShipDate(shipDate);
          const sewingDone = !!job.sewingSummaryComplete;
          const thumb = getJobThumbUrl(job);
          const product = String(job["Product"] ?? "").trim();
          const design = String(job["Design"] ?? "").trim();

          return (
            <div
              key={`${order}|${product}|${design}|${idx}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  color: "#111827",
                  textAlign: "center",
                  lineHeight: 1.2,
                }}
                title={order}
              >
                {order}
              </div>
              {customer ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#4b5563",
                    textAlign: "center",
                    lineHeight: 1.2,
                    marginTop: 2,
                    marginBottom: 6,
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
              ) : (
                <div style={{ marginBottom: 6 }} />
              )}

              {/* Tile + ship date stay visually paired */}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 10,
                    border: `5px solid ${outline}`,
                    background: "#f9fafb",
                    overflow: "hidden",
                    boxSizing: "border-box",
                  }}
                  title={
                    sewingDone
                      ? `${order} — sewing done · ship ${fmtMMDD(shipDate)}`
                      : `${order} · ship ${fmtMMDD(shipDate)}${product ? ` · ${product}` : ""}`
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
                </div>

                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: outline,
                    textAlign: "center",
                    marginTop: 3,
                    lineHeight: 1.1,
                  }}
                  title={shipDate ? `Ship: ${String(shipDate)}` : "No ship date"}
                >
                  {fmtMMDD(shipDate)}
                </div>
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: `5px solid ${color}`,
          boxSizing: "border-box",
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
