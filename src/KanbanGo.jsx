// src/KanbanGo.jsx
import React, { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

// Use the same backend base you use elsewhere
const BACKEND = "https://machine-scheduler-backend.onrender.com";

export default function KanbanGo() {
  const [sp] = useSearchParams();

  useEffect(() => {
    const id = sp.get("id") || "";
    const to = sp.get("to") || "";

    async function goById(kid) {
      try {
        const r = await fetch(
          `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(kid)}`
        );
        const j = await r.json();
        const item = j?.item || {};
        const orderMethod = item.orderMethod || "";
        const orderEmail  = item.orderEmail || "";
        const orderUrl    = item.orderUrl || "";

        // Build the real destination from item data
        const target =
          orderMethod === "Email"
            ? (orderEmail ? `mailto:${orderEmail}` : "")
            : orderUrl;

        const ok = /^https?:\/\//i.test(target) || /^mailto:/i.test(target);
        if (ok) {
          window.location.replace(target);
          return;
        }
      } catch (e) {
        // fall through to 'to=' logic below
      }

      // If lookup failed, do nothing here; we'll try ?to= next or show message
    }

    (async () => {
      if (id) {
        await goById(id);
        return;
      }

      // Fallback: maintain existing ?to= behavior
      if (to) {
        const ok = /^https?:\/\//i.test(to) || /^mailto:/i.test(to);
        if (ok) {
          window.location.replace(to);
          return;
        }
      }
    })();
  }, [sp]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ fontWeight: 800 }}>Opening…</div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
        If this page doesn’t redirect automatically, the item might be missing an Order URL or Email.
      </div>
    </div>
  );
}
