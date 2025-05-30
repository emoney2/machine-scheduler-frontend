// src/components/InventoryOrdered.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";

export default function InventoryOrdered() {
  const [entries, setEntries]   = useState([]);
  const [selected, setSelected] = useState(null);
  const API = process.env.REACT_APP_API_ROOT;

  // load only Ordered entries
  const load = async () => {
    const res = await axios.get(`${API}/inventoryOrdered`);
    setEntries(res.data);
    setSelected(null);
  };

  useEffect(() => {
    load();
  }, []);

  const handleReceive = async () => {
    if (!selected) return;
    const { type, row } = selected;
    await axios.put(`${API}/inventoryOrdered`, { type, row });
    load();
  };

  return (
    <div style={{
      maxWidth: 800,
      margin: "2rem auto",
      fontFamily: "sans-serif"
    }}>
      <button
        onClick={handleReceive}
        disabled={!selected}
        style={{
          marginBottom: "1rem",
          padding: "0.5rem 1rem",
          cursor: selected ? "pointer" : "not-allowed",
          backgroundColor: selected ? "#4caf50" : "#ccc",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          fontFamily: "sans-serif"
        }}
      >
        Receive
      </button>

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "sans-serif"
      }}>
        <thead>
          <tr>
            {["Date", "Type", "Name", "Quantity"].map(header => (
              <th key={header} style={{
                borderBottom: "1px solid #ddd",
                padding: "0.5rem",
                textAlign: "center"
              }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const isSel = selected && selected.row === e.row;
            const displayQty = e.type === "Material"
              ? `${e.quantity} ${e.unit || ""}`.trim()
              : e.quantity;
            return (
              <tr
                key={i}
                onClick={() => setSelected(e)}
                style={{
                  backgroundColor: isSel ? "#e0f7fa" : "transparent",
                  cursor: "pointer"
                }}
              >
                <td style={{ padding: "0.5rem", textAlign: "center" }}>
                  {e.date}
                </td>
                <td style={{ padding: "0.5rem", textAlign: "center" }}>
                  {e.type}
                </td>
                <td style={{ padding: "0.5rem", textAlign: "center" }}>
                  {e.name}
                </td>
                <td style={{ padding: "0.5rem", textAlign: "center" }}>
                  {displayQty}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
