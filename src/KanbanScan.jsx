// src/KanbanScan.jsx
import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

export default function KanbanScan() {
  const [sp] = useSearchParams();
  const id = sp.get("id") || "";
  const qtyStr = sp.get("qty") || "1";
  const qty = Math.max(1, parseInt(qtyStr, 10) || 1);

  const [status, setStatus] = useState("working"); // working | ok | err
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const run = async () => {
      if (!id) {
        setStatus("err");
        setMsg("Missing id parameter.");
        return;
      }
      try {
        // Try without credentials first (so anyone can scan)
        let r = await fetch(`${BACKEND}/api/kanban/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kanbanId: id, qty }),
        });

        // If backend requires auth, one retry with credentials included
        if (r.status === 401) {
          r = await fetch(`${BACKEND}/api/kanban/request`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ kanbanId: id, qty }),
          });
        }

        const txt = await r.text();
        if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);

        setStatus("ok");
        setMsg("Request added to the queue.");
      } catch (e) {
        setStatus("err");
        setMsg(String(e));
      }
    };
    run();
  }, [id, qty]);

  return (
    <div style={{ padding: 24, display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>Kanban Scan</h1>
      <div>ID: <b>{id || "—"}</b> • Qty: <b>{qty}</b></div>

      {status === "working" && <div>Submitting request…</div>}
      {status === "ok" && (
        <div style={{ color: "#065f46", background: "#ecfdf5", border: "1px solid #a7f3d0", padding: 12, borderRadius: 8 }}>
          ✅ {msg}
        </div>
      )}
      {status === "err" && (
        <div style={{ color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>
          ❌ Could not add request.
          {"\n"}{msg}
          {"\n\n"}If your backend requires login, sign in first and scan again.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Link to="/kanban/queue">← Back to Queue</Link>
      </div>
    </div>
  );
}
