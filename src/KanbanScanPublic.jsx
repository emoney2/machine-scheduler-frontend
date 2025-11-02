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
      if (!id) { setErr("Missing id parameter."); return; }
      try {
        const r = await fetch(`${BACKEND}/api/kanban/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit", // public; no login
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

  // Clean, bold green success page
  return (
    <div style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
      <div style={{
        border: "2px solid #059669",
        background: "#ecfdf5",
        color: "#065f46",
        borderRadius: 12,
        padding: 18,
        fontWeight: 800,
        fontSize: 18,
        textAlign: "center"
      }}>
        {done ? "Request logged — you're all set ✅" :
        err ? `Error: ${err}` :
        "Working…"}
      </div>
    </div>
  );
}
