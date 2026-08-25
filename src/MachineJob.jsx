import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "./socketClient";
import {
  MACHINE_META,
  apiRoot,
  estimateRemainingMs,
  findJobInColumns,
  formatDuration,
  formatRecentRunsLine,
  jobImageUrl,
  normalizeOrderId,
} from "./machineFloorUtils";

const ROOT = apiRoot();
const PLUS_FLASH_MS = 2500;
const JOB_COMPLETE_MS = 2000;

export default function MachineJob({ columns }) {
  const { machineId, orderId } = useParams();
  const navigate = useNavigate();
  const meta = MACHINE_META[machineId] || { title: "Machine", headCount: 6 };
  const oid = normalizeOrderId(orderId);

  const fromColumns = useMemo(
    () => findJobInColumns(columns, oid)?.job || null,
    [columns, oid]
  );

  const [job, setJob] = useState(null);
  const [piecesLeft, setPiecesLeft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [recutOpen, setRecutOpen] = useState(false);
  const [recutQty, setRecutQty] = useState("");
  const [postedN, setPostedN] = useState(null);
  const postedTimer = useRef(null);
  const [finishOverlay, setFinishOverlay] = useState(null);
  const [manualStart, setManualStart] = useState(false);
  const [lastRunAt, setLastRunAt] = useState("");

  const applyPayload = useCallback((data) => {
    if (!data) return;
    setJob(data);
    if (data.piecesLeft != null) setPiecesLeft(Number(data.piecesLeft));
    if (data.manualStart != null) setManualStart(!!data.manualStart);
    if (data.lastRunAt) setLastRunAt(String(data.lastRunAt));
  }, []);

  const loadJob = useCallback(
    async (signal) => {
      setError("");
      try {
        const res = await axios.get(
          `${ROOT}/embroidery/floor-job/${encodeURIComponent(oid)}`,
          { withCredentials: true, signal, timeout: 25000 }
        );
        applyPayload(res.data);
      } catch (e) {
        if (axios.isCancel(e)) return;
        if (e?.response?.status === 404) {
          setError(`Order #${oid} was not found.`);
        } else {
          setError(e?.response?.data?.error || e?.message || "Failed to load job");
        }
      } finally {
        setLoading(false);
      }
    },
    [oid, applyPayload]
  );

  useEffect(() => {
    if (!oid) return;
    setLoading(true);
    const ctrl = new AbortController();
    loadJob(ctrl.signal);
    return () => ctrl.abort();
  }, [oid, loadJob]);

  useEffect(() => {
    if (!socket) return;
    const onProgress = (payload) => {
      if (normalizeOrderId(payload?.orderId) !== oid) return;
      applyPayload(payload);
    };
    const onFinished = (payload) => {
      if (normalizeOrderId(payload?.orderId) !== oid) return;
      setPiecesLeft(0);
      setFlash("Job finished");
    };
    socket.on("embroideryProgressUpdated", onProgress);
    socket.on("embroideryFinished", onFinished);
    return () => {
      socket.off("embroideryProgressUpdated", onProgress);
      socket.off("embroideryFinished", onFinished);
    };
  }, [oid, applyPayload]);

  const quantity = Number(job?.quantity ?? fromColumns?.quantity ?? 0) || 0;
  const left = piecesLeft == null ? quantity : Math.max(0, piecesLeft);
  const stitchCount = Number(job?.stitchCount ?? fromColumns?.stitch_count ?? 0) || 0;
  const avgCycleMs = Number(job?.avgCycleMs ?? fromColumns?.avgCycleMs ?? 0) || 0;
  const estLabel = formatDuration(
    estimateRemainingMs(stitchCount, left, meta.headCount, avgCycleMs)
  );
  const displayJob = job
    ? {
        ...fromColumns,
        id: job.orderId,
        company: job.company,
        product: job.product,
        design: job.design,
        quantity: job.quantity,
        imageFileId: job.imageFileId,
        imageLink: job.imageLink,
      }
    : fromColumns;
  const imageSrc = jobImageUrl(displayJob || job, "w1200");

  const stampInferredStart = (piecesJustFinished) => {
    if (manualStart) return;
    const runMs = estimateRemainingMs(stitchCount, piecesJustFinished, meta.headCount);
    const started = new Date(Date.now() - Math.max(0, runMs));
    axios
      .post(
        `${ROOT}/updateStartTime`,
        {
          orderNumber: oid,
          startTime: started.toISOString(),
          source: "floor",
        },
        { withCredentials: true, timeout: 15000 }
      )
      .catch(() => {});
  };

  const pressStart = async () => {
    if (busy || manualStart) return;
    setBusy(true);
    setError("");
    try {
      const res = await axios.post(
        `${ROOT}/updateStartTime`,
        {
          orderNumber: oid,
          startTime: new Date().toISOString(),
          source: "manual",
        },
        { withCredentials: true, timeout: 15000 }
      );
      setManualStart(true);
      setJob((prev) => (prev ? { ...prev, manualStart: true } : prev));
      if (res?.data?.ok) setFlash("Started");
      setTimeout(() => setFlash(""), 2000);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Could not start job");
    } finally {
      setBusy(false);
    }
  };

  const postProgress = async (body) => {
    setBusy(true);
    setError("");
    let finished = false;
    try {
      const res = await axios.post(
        `${ROOT}/embroidery/progress`,
        { orderId: oid, ...body },
        { withCredentials: true, timeout: 25000 }
      );
      applyPayload(res.data);
      finished =
        !!res.data?.embroideryComplete ||
        (res.data?.piecesLeft != null && Number(res.data.piecesLeft) <= 0);
      if (finished) {
        setPiecesLeft(0);
        if (postedTimer.current) clearTimeout(postedTimer.current);
        postedTimer.current = setTimeout(() => {
          setPostedN(null);
          setFinishOverlay("complete");
          setTimeout(() => navigate(`/machine/${machineId}`), JOB_COMPLETE_MS);
        }, PLUS_FLASH_MS);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Could not save progress");
    } finally {
      if (!finished) setBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      if (postedTimer.current) clearTimeout(postedTimer.current);
    };
  }, []);

  const recordCompleted = (n) => {
    if (busy || n <= 0 || left <= 0) return;
    const inc = Math.min(n, left);
    setPiecesLeft(left - inc);
    setPostedN(inc);
    setLastRunAt(new Date().toISOString());
    if (postedTimer.current) clearTimeout(postedTimer.current);
    postedTimer.current = setTimeout(() => setPostedN(null), PLUS_FLASH_MS);
    if (left === quantity) stampInferredStart(inc);
    postProgress({ increment: inc });
  };

  const savePiecesLeft = () => {
    const n = parseInt(String(editValue).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter a valid pieces-left count");
      return;
    }
    setEditOpen(false);
    setPiecesLeft(n);
    postProgress({ piecesLeft: n });
  };

  const finishJob = async () => {
    if (busy) return;
    if (!window.confirm(`Finish order #${oid}? This marks embroidery complete.`)) return;
    setBusy(true);
    setError("");
    setFinishOverlay("recording");
    try {
      await axios.post(
        `${ROOT}/embroidery/finish`,
        { orderId: oid },
        { withCredentials: true, timeout: 25000 }
      );
      setPiecesLeft(0);
      setFinishOverlay("complete");
      setTimeout(() => navigate(`/machine/${machineId}`), JOB_COMPLETE_MS);
    } catch (e) {
      setFinishOverlay(null);
      setError(e?.response?.data?.error || e?.message || "Could not finish job");
      setBusy(false);
    }
  };

  const sendRecut = async () => {
    const n = parseInt(String(recutQty).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter how many pieces need to be recut");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await axios.post(
        `${ROOT}/embroidery/recut`,
        { orderId: oid, machine: meta.title, pieces: n },
        { withCredentials: true, timeout: 25000 }
      );
      setRecutOpen(false);
      setRecutQty("");
      setFlash("Manager emailed");
      setTimeout(() => setFlash(""), 2500);
    } catch (e) {
      setError(
        e?.response?.data?.error || e?.message || "Could not email the manager"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        maxHeight: "100vh",
        overflow: "hidden",
        background: "#111827",
        color: "#111",
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1fr)",
        touchAction: "manipulation",
        WebkitUserSelect: "none",
        userSelect: "none",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          gridColumn: 1,
          gridRow: 1,
          display: "grid",
          gridTemplateRows: "minmax(0, 3fr) minmax(0, 1fr)",
          minWidth: 0,
          minHeight: 0,
          background: "#fff",
        }}
      >
      <div
        style={{
          position: "relative",
          background: "#f9fafb",
          borderRight: "1px solid #e5e7eb",
          borderBottom: "1px solid #e5e7eb",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <button
          type="button"
          onClick={() => navigate(`/machine/${machineId}`)}
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 4,
            minHeight: 44,
            padding: "6px 12px",
            fontSize: 15,
            fontWeight: 800,
            border: "none",
            borderRadius: 8,
            background: "rgba(255,255,255,0.92)",
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          }}
        >
          ← Jobs
        </button>
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={`Order ${oid}`}
            referrerPolicy="no-referrer"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f3f4f6",
              color: "#6b7280",
              fontSize: 18,
              padding: 16,
              textAlign: "center",
            }}
          >
            {loading ? "Loading image…" : displayJob?.design || "No image"}
          </div>
        )}
        {job?.embroideryComplete && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 4,
              background: "#dcfce7",
              color: "#166534",
              fontWeight: 800,
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            Embroidery complete
          </div>
        )}
        {loading && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              background: "rgba(255,255,255,0.9)",
              padding: "4px 10px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Loading…
          </div>
        )}
      </div>

      <div
        style={{
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          borderRight: "1px solid #e5e7eb",
          minWidth: 0,
          minHeight: 0,
          padding: 12,
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "#6b7280",
            letterSpacing: "0.08em",
          }}
        >
          ORDER
        </div>
        <div
          style={{
            fontSize: "clamp(48px, 10vh, 96px)",
            fontWeight: 900,
            lineHeight: 0.95,
            color: "#111827",
          }}
        >
          {oid}
        </div>
      </div>
      </div>

      <div
        style={{
          gridColumn: 2,
          gridRow: 1,
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
          minWidth: 0,
          minHeight: 0,
          background: "#fff",
        }}
      >
      <div
        style={{
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 8,
          padding: 12,
          minWidth: 0,
          minHeight: 0,
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            border: "3px solid #111827",
            borderRadius: 16,
            padding: "6px 8px",
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#374151" }}>Quantity remaining</span>
            <button
              type="button"
              onClick={() => {
                setEditValue(String(left));
                setEditOpen(true);
              }}
              style={{
                fontSize: 13,
                fontWeight: 800,
                padding: "4px 10px",
                borderRadius: 999,
                border: "2px solid #111827",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Edit
            </button>
          </div>
          <div
            style={{
              fontSize: "clamp(40px, 8vh, 88px)",
              fontWeight: 900,
              lineHeight: 0.95,
              letterSpacing: "-0.04em",
            }}
          >
            {left}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            gap: 6,
          }}
        >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            border: "3px solid #d1d5db",
            borderRadius: 16,
            background: "#f9fafb",
            padding: "6px 8px",
            minHeight: 0,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800, color: "#374151", textAlign: "center" }}>
            Est. time left
          </div>
          <div
            style={{
              fontSize: "clamp(28px, 6vh, 64px)",
              fontWeight: 900,
              lineHeight: 0.95,
              letterSpacing: "-0.04em",
              textAlign: "center",
            }}
          >
            {estLabel}
          </div>
        </div>
        <div
          style={{
            flexShrink: 0,
            textAlign: "center",
            fontSize: 15,
            fontWeight: 800,
            color: "#111827",
            padding: "2px 4px 0",
            lineHeight: 1.15,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatRecentRunsLine(
            job?.recentRuns || fromColumns?.recentRuns,
            lastRunAt || job?.lastRunAt || fromColumns?.lastRunAt
          ) || "Last run posted at —"}
        </div>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "center",
          gap: 10,
          padding: 12,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {!manualStart && left === quantity && (
          <button
            type="button"
            disabled={busy}
            onClick={pressStart}
            style={{
              height: 56,
              border: "none",
              borderRadius: 12,
              background: "#2563eb",
              color: "#fff",
              fontSize: "clamp(20px, 3.4vh, 32px)",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Start
          </button>
        )}
        {manualStart && (
          <div
            style={{
              textAlign: "center",
              fontSize: 16,
              fontWeight: 800,
              color: "#166534",
            }}
          >
            Started
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flex: 1, minHeight: 0 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRecutQty("");
            setRecutOpen(true);
          }}
          style={{
            width: "42%",
            maxWidth: 140,
            aspectRatio: "1",
            maxHeight: "80%",
            height: "auto",
            borderRadius: "50%",
            border: "4px solid #b91c1c",
            background: "#fef2f2",
            color: "#b91c1c",
            fontWeight: 900,
            fontSize: "clamp(14px, 2vh, 22px)",
            cursor: "pointer",
            lineHeight: 1.15,
            flexShrink: 0,
          }}
        >
          Recut
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={finishJob}
          style={{
            flex: 1,
            height: "80%",
            minHeight: 64,
            padding: "8px 12px",
            border: "none",
            borderRadius: 16,
            background: "#16a34a",
            color: "#fff",
            fontSize: "clamp(22px, 4vh, 44px)",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Finish
        </button>
        </div>
      </div>
      </div>

      <div
        style={{
          gridColumn: 3,
          gridRow: 1,
          background: "#111827",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr 1fr",
          padding: 8,
          gap: 8,
          alignItems: "center",
          justifyItems: "center",
        }}
      >
        {[
          [6, 5],
          [4, 3],
          [2, 1],
        ].flatMap((row) =>
          row.map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy || left <= 0}
              onClick={() => recordCompleted(n)}
              style={{
                width: "100%",
                maxWidth: "100%",
                aspectRatio: "1",
                maxHeight: "100%",
                border: "none",
                borderRadius: 16,
                background: left <= 0 ? "#374151" : "#fbbf24",
                color: "#111",
                fontSize: "clamp(28px, 5vh, 64px)",
                fontWeight: 900,
                cursor: left <= 0 || busy ? "default" : "pointer",
              }}
            >
              +{n}
            </button>
          ))
        )}
      </div>

      {postedN != null && !finishOverlay && (
        <div
          aria-live="polite"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(46, 204, 113, 0.28)",
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <svg width="160" height="160" viewBox="0 0 72 72" fill="none">
              <circle
                cx="36"
                cy="36"
                r="32"
                stroke="#1b5e20"
                strokeWidth="4"
                fill="rgba(255,255,255,0.9)"
              />
              <path
                d="M20 37 L32 49 L52 25"
                stroke="#1b5e20"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div
              style={{
                fontSize: "clamp(56px, 12vh, 120px)",
                fontWeight: 900,
                color: "#14532d",
                lineHeight: 1,
                textShadow: "0 2px 0 #fff",
              }}
            >
              +{postedN}
            </div>
          </div>
        </div>
      )}

      {finishOverlay && (
        <div
          aria-live="polite"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 55,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              finishOverlay === "recording"
                ? "rgba(187, 247, 208, 0.72)"
                : "rgba(46, 204, 113, 0.38)",
            pointerEvents: "auto",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {finishOverlay === "complete" && (
              <svg width="180" height="180" viewBox="0 0 72 72" fill="none">
                <circle
                  cx="36"
                  cy="36"
                  r="32"
                  stroke="#1b5e20"
                  strokeWidth="4"
                  fill="rgba(255,255,255,0.92)"
                />
                <path
                  d="M20 37 L32 49 L52 25"
                  stroke="#1b5e20"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <div
              style={{
                fontSize: finishOverlay === "recording" ? 42 : 48,
                fontWeight: 900,
                color: "#14532d",
                textShadow: "0 1px 0 #fff",
              }}
            >
              {finishOverlay === "recording" ? "Recording…" : "Job Complete"}
            </div>
          </div>
        </div>
      )}

      {(error || flash) && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            padding: "10px 16px",
            borderRadius: 10,
            fontWeight: 800,
            background: error ? "#fef2f2" : "#ecfdf5",
            color: error ? "#991b1b" : "#065f46",
            border: `1px solid ${error ? "#fecaca" : "#6ee7b7"}`,
            maxWidth: "80vw",
          }}
        >
          {error || flash}
        </div>
      )}

      {editOpen && (
        <Modal onClose={() => setEditOpen(false)}>
          <h2 style={{ margin: "0 0 12px", fontSize: 22 }}>Pieces left</h2>
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            min={0}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            style={{
              width: "100%",
              fontSize: 32,
              padding: "10px 12px",
              borderRadius: 10,
              border: "2px solid #111827",
              boxSizing: "border-box",
              textAlign: "center",
              WebkitUserSelect: "text",
              userSelect: "text",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => setEditOpen(false)} style={btnGhost}>
              Cancel
            </button>
            <button type="button" onClick={savePiecesLeft} style={btnPrimary}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {recutOpen && (
        <Modal onClose={() => setRecutOpen(false)}>
          <h2 style={{ margin: "0 0 12px", fontSize: 22 }}>How many pieces to recut?</h2>
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            min={1}
            value={recutQty}
            onChange={(e) => setRecutQty(e.target.value)}
            placeholder="#"
            style={{
              width: "100%",
              fontSize: 32,
              padding: "10px 12px",
              borderRadius: 10,
              border: "2px solid #111827",
              boxSizing: "border-box",
              textAlign: "center",
              WebkitUserSelect: "text",
              userSelect: "text",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => setRecutOpen(false)} style={btnGhost}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={sendRecut}
              style={{ ...btnPrimary, background: "#b91c1c" }}
            >
              Send
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      className="ms-dialog-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 30,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 20,
          width: "min(420px, 100%)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const btnGhost = {
  flex: 1,
  minHeight: 48,
  fontSize: 16,
  fontWeight: 800,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
};

const btnPrimary = {
  flex: 1,
  minHeight: 48,
  fontSize: 16,
  fontWeight: 800,
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  cursor: "pointer",
};
