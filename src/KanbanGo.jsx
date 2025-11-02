// src/KanbanGo.jsx
import React, { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export default function KanbanGo() {
  const [sp] = useSearchParams();
  useEffect(() => {
    const to = sp.get("to") || "";
    if (to) {
      const ok = /^https?:\/\//i.test(to) || /^mailto:/i.test(to);
      if (ok) {
        window.location.replace(to);
        return;
      }
    }
  }, [sp]);
  return (
    <div style={{ padding: 24 }}>
      <div style={{ fontWeight: 800 }}>Opening…</div>
    </div>
  );
}
