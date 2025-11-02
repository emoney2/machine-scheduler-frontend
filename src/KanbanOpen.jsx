// src/KanbanOpen.jsx
import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

export default function KanbanOpen() {
  const [sp] = useSearchParams();
  const id = sp.get("id") || "";
  const [msg, setMsg] = useState("Loading…");

  useEffect(() => {
    const run = async () => {
      if (!id) { setMsg("Missing id parameter."); return; }
      try {
        const r = await fetch(`${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(id)}`, { credentials: "include" });
        const j = await r.json();
        if (!r.ok || !j?.item) throw new Error("Item not found.");

        const it = j.item;
        const orderMethod = it.orderMethod || it["Order Method (Email/Online)"];
        const url = it.orderUrl || it["Order URL"];
        const email = it.orderEmail || it["Order Email"];

        if (orderMethod === "Online" && url) {
          window.location.replace(url);
        } else if (orderMethod === "Email" && email) {
          window.location.replace(`mailto:${email}`);
        } else {
          setMsg("No valid order target found for this Kanban.");
        }
      } catch (e) {
        setMsg(String(e));
      }
    };
    run();
  }, [id]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Opening Order Target…</h1>
      <div style={{ marginTop: 8 }}>{msg}</div>
      <div style={{ marginTop: 16 }}>
        <Link to="/kanban/queue">← Back to Queue</Link>
      </div>
    </div>
  );
}
