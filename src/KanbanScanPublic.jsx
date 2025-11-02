// src/KanbanScanPublic.jsx
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

export default function KanbanScanPublic() {
  const [sp] = useSearchParams();
  const id = (sp.get("id") || "").trim();
  const qty = (sp.get("qty") || "1").trim();

  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const run = async () => {
      if (!id) { setErr("Missing id"); return; }
      try {
        const r = await fetch(`${BACKEND}/api/kanban/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify({ kanbanId: id, qty }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status} ${t}`);
        }
        setDone(true);
      } catch (e) {
        setErr(String(e?.message || e));
      }
    };
    run();
  }, [id, qty]);

  // full-bleed green panel
  return (
    <div style={{
      minHeight: "100vh",
      margin: 0,
      background: done ? "#ecfdf5" : err ? "#fef2f2" : "#f3f4f6",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        border: `2px solid ${done ? "#059669" : err ? "#ef4444" : "#9ca3af"}`,
        background: done ? "#d1fae5" : err ? "#fee2e2" : "white",
        color: done ? "#065f46" : err ? "#991b1b" : "#111827",
        borderRadius: 14,
        padding: 24,
        fontWeight: 900,
        fontSize: 22,
        textAlign: "center",
        width: "min(520px, 90vw)"
      }}>
        {done ? "Success — Request Logged ✅" : err ? `Error: ${err}` : "Working…"}
      </div>
    </div>
  );
}
