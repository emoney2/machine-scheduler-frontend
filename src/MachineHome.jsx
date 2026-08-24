import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "./socketClient";
import {
  MACHINE_META,
  fmtMMDD,
  jobImageUrl,
  jobsForMachine,
  normalizeOrderId,
} from "./machineFloorUtils";

function outlineByDue(due) {
  if (!due) return "#9ca3af";
  const s = String(due);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  let dt = null;
  if (m) {
    let y = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (y < 100) y += 2000;
    dt = new Date(y, Number(m[1]) - 1, Number(m[2]));
  } else {
    dt = new Date(due);
  }
  if (!dt || isNaN(dt)) return "#9ca3af";
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const days = Math.round((b - a) / 86400000);
  if (days < 0) return "#e74c3c";
  if (days === 0) return "#f1c40f";
  return "#2ecc71";
}

function TileOverlay({ children, style, color = "#111827" }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        zIndex: 2,
        textAlign: "center",
        fontWeight: 800,
        lineHeight: 1.15,
        color,
        padding: "4px 8px",
        pointerEvents: "none",
        WebkitTextStroke: "4px #fff",
        paintOrder: "stroke fill",
        textShadow: "0 0 4px #fff",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function MachineHome({ columns, loading }) {
  const { machineId } = useParams();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [finishedIds, setFinishedIds] = useState(() => new Set());

  const meta = MACHINE_META[machineId] || { title: "Machine", headCount: 6 };
  const jobs = useMemo(
    () =>
      jobsForMachine(columns, machineId).filter(
        (j) => !finishedIds.has(normalizeOrderId(j.id))
      ),
    [columns, machineId, finishedIds]
  );

  useEffect(() => {
    if (!socket) return;
    const onFinished = (payload) => {
      const id = normalizeOrderId(payload?.orderId);
      if (!id) return;
      setFinishedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    };
    socket.on("embroideryFinished", onFinished);
    return () => socket.off("embroideryFinished", onFinished);
  }, []);

  const openJob = (orderId) => {
    const id = normalizeOrderId(orderId);
    if (!id) return;
    navigate(`/machine/${machineId}/job/${encodeURIComponent(id)}`);
  };

  const submitLookup = (e) => {
    e.preventDefault();
    const id = normalizeOrderId(lookup);
    if (!id) {
      setLookupError("Enter an order number");
      return;
    }
    setLookupError("");
    openJob(id);
  };

  if (!MACHINE_META[machineId]) {
    return (
      <div style={{ padding: 24 }}>
        <p>Unknown machine.</p>
        <button type="button" onClick={() => navigate("/")}>
          Back to Scheduler
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        padding: "8px 12px 0",
        touchAction: "manipulation",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/")}
          style={{
            minHeight: 48,
            padding: "8px 16px",
            fontSize: 16,
            fontWeight: 700,
            border: "1px solid #d1d5db",
            borderRadius: 10,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ← Scheduler
        </button>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: "0.02em",
            color: "#111827",
          }}
        >
          {meta.title}
        </h1>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "#111827",
            color: "#fff",
            fontWeight: 800,
            fontSize: 16,
          }}
          title="Heads"
        >
          {meta.headCount}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: 8,
        }}
      >
        {!jobs.length ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "#6b7280",
              fontSize: 18,
            }}
          >
            {loading ? "Loading jobs…" : "No open embroidery jobs on this machine."}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            {jobs.map((job) => {
              const order = String(job.id || "").trim();
              const thumb = jobImageUrl(job, "w400");
              const qty = job.quantity != null ? String(job.quantity) : "";
              const due = job.due_date || job.delivery || "";
              const outline = outlineByDue(due);
              const product = String(job.product || "").trim();
              const company = String(job.company || "").trim();

              return (
                <button
                  key={order}
                  type="button"
                  onClick={() => openJob(order)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    WebkitUserSelect: "none",
                    userSelect: "none",
                  }}
                >
                  {company ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: "#4b5563",
                        textAlign: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        padding: "0 4px 2px",
                      }}
                    >
                      {company}
                    </div>
                  ) : null}
                  {product ? (
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#111827",
                        textAlign: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        padding: "0 4px 6px",
                      }}
                    >
                      {product}
                    </div>
                  ) : (
                    <div style={{ height: 6 }} />
                  )}
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "1 / 1",
                      borderRadius: 12,
                      border: `5px solid ${outline}`,
                      background: "#fff",
                      overflow: "hidden",
                      boxSizing: "border-box",
                    }}
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
                          pointerEvents: "none",
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
                          color: "#9ca3af",
                          fontSize: 14,
                          padding: 8,
                          textAlign: "center",
                        }}
                      >
                        {job.design || product || "No image"}
                      </div>
                    )}
                    <TileOverlay style={{ top: 4, fontSize: 20 }}>{order}</TileOverlay>
                    <TileOverlay
                      color={outline}
                      style={{ bottom: 4, left: 0, right: "40%", fontSize: 15, textAlign: "left" }}
                    >
                      {fmtMMDD(due)}
                    </TileOverlay>
                    {qty ? (
                      <TileOverlay
                        style={{
                          bottom: 4,
                          left: "auto",
                          right: 0,
                          fontSize: 15,
                          textAlign: "right",
                        }}
                      >
                        {qty}
                      </TileOverlay>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <form
        onSubmit={submitLookup}
        style={{
          flexShrink: 0,
          padding: "12px 4px 16px",
          background: "#f3f4f6",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <label
          htmlFor="machine-order-lookup"
          style={{
            display: "block",
            fontSize: 16,
            fontWeight: 800,
            marginBottom: 6,
            color: "#111827",
          }}
        >
          Enter order #
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="machine-order-lookup"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={lookup}
            onChange={(e) => {
              setLookup(e.target.value);
              setLookupError("");
            }}
            placeholder="Job number"
            style={{
              flex: 1,
              minHeight: 52,
              fontSize: 20,
              padding: "8px 14px",
              border: "2px solid #111827",
              borderRadius: 10,
              boxSizing: "border-box",
              WebkitUserSelect: "text",
              userSelect: "text",
            }}
          />
          <button
            type="submit"
            style={{
              minHeight: 52,
              minWidth: 88,
              fontSize: 18,
              fontWeight: 800,
              background: "#111827",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            Open
          </button>
        </div>
        {lookupError ? (
          <div style={{ color: "#b91c1c", marginTop: 6, fontWeight: 700 }}>{lookupError}</div>
        ) : null}
      </form>
    </div>
  );
}
