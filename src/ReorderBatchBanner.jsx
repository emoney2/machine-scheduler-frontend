import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";
import {
  clearActiveReorderBatch,
  readActiveReorderBatch,
  subscribeReorderBatch,
} from "./reorderBatchStore";

function statusLabel(batch) {
  if (!batch) return "";
  if (batch.status === "done") {
    return `Finished ${batch.completed} reorder${batch.completed === 1 ? "" : "s"}`;
  }
  if (batch.status === "partial") {
    return `Finished ${batch.completed}, ${batch.failed} failed`;
  }
  if (batch.status === "error") {
    return `Reorder failed (${batch.failed} job${batch.failed === 1 ? "" : "s"})`;
  }
  const done = (batch.completed || 0) + (batch.failed || 0) + (batch.skipped || 0);
  return `Setting up ${done}/${batch.total} jobs in the background`;
}

export default function ReorderBatchBanner() {
  const [active, setActive] = useState(() => readActiveReorderBatch());
  const [status, setStatus] = useState(null);

  useEffect(() => subscribeReorderBatch(setActive), []);

  useEffect(() => {
    if (!active?.batchId) {
      setStatus(null);
      return undefined;
    }
    let canceled = false;
    const load = async () => {
      try {
        const res = await axios.get(`${API_ROOT}/reorder-batch/${active.batchId}`);
        if (!canceled) setStatus(res.data);
      } catch (err) {
        if (!canceled && err?.response?.status === 404) {
          clearActiveReorderBatch();
          setActive(null);
        }
      }
    };
    load();
    const finished = status?.status === "done" || status?.status === "error" || status?.status === "partial";
    if (finished) return undefined;
    const id = setInterval(load, 3000);
    return () => {
      canceled = true;
      clearInterval(id);
    };
  }, [active?.batchId, status?.status]);

  if (!active?.batchId) return null;
  if (!status) {
    return (
      <div
        style={{
          position: "fixed",
          left: 12,
          right: 12,
          bottom: 12,
          zIndex: 11000,
          background: "#1e3a5f",
          color: "#fff",
          borderRadius: 10,
          padding: "0.75rem 1rem",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          fontWeight: 700,
        }}
      >
        Reorder started in the background. You can keep using the app.
      </div>
    );
  }

  const finished =
    status.status === "done" || status.status === "error" || status.status === "partial";
  const failedItems = (status.items || []).filter((item) => item.status === "error");

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 11000,
        background: finished && status.status === "error" ? "#7f1d1d" : "#1e3a5f",
        color: "#fff",
        borderRadius: 10,
        padding: "0.75rem 1rem",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {status.company ? `${status.company}: ` : ""}
          {statusLabel(status)}
        </div>
        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>
          {finished
            ? "You can dismiss this. New jobs are already in their own folders."
            : "You can use other tabs. Closing this page is fine — the server keeps working."}
        </div>
        {failedItems.length > 0 && (
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.95 }}>
            {failedItems
              .slice(0, 3)
              .map((item) => `#${item.sourceOrder}: ${item.error || "failed"}`)
              .join(" · ")}
          </div>
        )}
      </div>
      {finished && (
        <button
          type="button"
          onClick={() => {
            clearActiveReorderBatch();
            setActive(null);
          }}
          style={{
            flexShrink: 0,
            background: "#fff",
            color: "#1e3a5f",
            border: "none",
            borderRadius: 6,
            padding: "0.35rem 0.7rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
