import React, { useEffect, useState } from "react";
import axios from "axios";

export default function InventoryOrdered() {
  const [entries, setEntries]       = useState([]);
  const [selected, setSelected]     = useState(null);
  const API = process.env.REACT_APP_API_ROOT;

  // fetch only “Ordered” rows (your existing logic)
  const load = async () => {
    const mat = await axios.get(`${API}/inventoryOrdered`);
    setEntries(mat.data);
    setSelected(null);
  };

  useEffect(() => {
    load();
  }, []);

  const handleReceive = async () => {
    if (!selected) return;
    const { type, row } = selected;
    await axios.put(`${API}/inventoryOrdered`, { type, row });
    // reload list: row will no longer appear
    load();
  };

  return (
    <div>
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
          borderRadius: 4
        }}
      >
        Receive
      </button>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Name</th><th>Quantity</th><th>O/R</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const isSel = selected && selected.row === e.row;
            return (
              <tr
                key={i}
                onClick={() => setSelected(e)}
                style={{
                  backgroundColor: isSel ? "#e0f7fa" : "transparent",
                  cursor: "pointer"
                }}
              >
                <td>{e.date}</td>
                <td>{e.type}</td>
                <td>{e.name}</td>
                <td>{e.quantity}</td>
                <td>{e.type==="Material" ? e.or : e.or}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
