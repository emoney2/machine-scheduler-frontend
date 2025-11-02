// src/KanbanScan.jsx
import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

export default function KanbanScan() {
  const [sp] = useSearchParams();
  const id = (sp.get("id") || "").trim();
  const qty = (sp.get("qty") || "1").trim();

  const [status, setStatus] = useState("Working…");
  const [itemName, setItemName] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const run = async () => {
      if (!id) {
        setErr("Missing id parameter.");
        setStatus("");
        return;
      }
      try {
        // Optional: fetch item to show friendly name
        try {
          const rItem = await fetch(`${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(id)}`, {
            credentials: "omit", // public
          });
          if (rItem.ok) {
            const j = await rItem.json();
            const item = j?.item || {};
            const name = item["Item Name"] || item.itemName || "";
            setItemName(name);
          }
        } catch {}

        // Post REQUEST row (public — no login)
        const r = await fetch(`${BACKEND}/api/kanban/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit", // <-- IMPORTANT: public
          body: JSON.stringify({ kanbanId: id, qty }),
        });

        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status} ${t}`);
        }

        const j = await r.json().catch(() => ({}));
        if (j && j.ok) {
          setStatus("Added to queue ✅");
        } else {
          setStatus("");
          setErr(j?.error || "Unknown error");
        }
      } catch (e) {
        setStatus("");
        setErr(String(e?.message || e));
      }
    };
    run();
  }, [id, qty]);

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Kanban Scan</h1>
      <div style={{ marginTop: 6, color: "#6b7280" }}>
        This page logs a reorder request directly from a QR scan.
      </div>

      <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 800 }}>
          {itemName ? `Item: ${itemName}` : "Item"} ({id || "—"})
        </div>
        <div style={{ marginTop: 4 }}>Quantity: <strong>{qty}</strong></div>
        {status && (
          <div style={{ marginTop: 12, padding: 8, borderRadius: 8, background: "#ecfdf5", border: "1px solid #10b981", color: "#065f46" }}>
            {status}
          </div>
        )}
        {err && (
          <div style={{ marginTop: 12, padding: 8, borderRadius: 8, background: "#fef2f2", border: "1px solid #ef4444", color: "#991b1b", whiteSpace: "pre-wrap" }}>
            Error: {err}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <Link to="/kanban/queue">← Back to Queue</Link>
        <a href={`/kanban/preview/${encodeURIComponent(id)}`}>View Card</a>
      </div>
    </div>
  );
}
