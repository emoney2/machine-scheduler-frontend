// src/KanbanGo.jsx
import React, { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export default function KanbanGo() {
  const [sp] = useSearchParams();
  useEffect(() => {
    const to = sp.get("to") || "";
    if (to) {
      try {
        // basic safety: allow http/https/mailto only
        const ok = /^https?:\/\//i.test(to) || /^mailto:/i.test(to);
        if (ok) {
          window.location.replace(to);
          return;
        }
      } catch {}
    }
    // fallback: show a small message
    // (You can style this up if you want)
  }, [sp]);

  return (
    <div style={{ padding: 24 }}>
      <h1>Opening...</h1>
      <div>If nothing happens, the URL might be invalid.</div>
    </div>
  );
}
