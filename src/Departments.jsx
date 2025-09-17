// src/pages/Departments.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

export default function Departments() {
  const nav = useNavigate();

  const btn = {
    base: {
      width: "100%",
      height: "7rem",
      borderRadius: "16px",
      fontSize: "1.5rem",
      fontWeight: 600,
      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      border: "1px solid #ddd",
      cursor: "pointer",
    },
    enabled: {
      background: "white",
      color: "#111",
    },
    disabled: {
      background: "#e9ecef",
      color: "#8a8f98",
      cursor: "not-allowed",
    },
  };

  const card = {
    maxWidth: 960,
    margin: "24px auto",
    padding: 24,
    border: "1px solid #ddd",
    borderRadius: 12,
    background: "#fff",
  };

  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={card}>
        <h1 style={{ margin: 0, marginBottom: 12 }}>Departments</h1>
        <p style={{ marginTop: 0, marginBottom: 24, color: "#555" }}>
          Choose a department. Only <b>Fur</b> is enabled for now.
        </p>

        <div style={grid}>
          {/* Fur (enabled) */}
          <button
            style={{ ...btn.base, ...btn.enabled }}
            onClick={() => nav("/scan?dept=fur")}
            title="Open the Fur listener"
          >
            Fur
          </button>

          {/* Others (disabled/greyed out) */}
          <button style={{ ...btn.base, ...btn.disabled }} disabled>
            Cut
          </button>
          <button style={{ ...btn.base, ...btn.disabled }} disabled>
            Print
          </button>
          <button style={{ ...btn.base, ...btn.disabled }} disabled>
            Embroidery
          </button>
          <button style={{ ...btn.base, ...btn.disabled }} disabled>
            Sewing
          </button>
        </div>
      </div>
    </div>
  );
}
