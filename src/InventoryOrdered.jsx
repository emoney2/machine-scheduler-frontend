// src/components/InventoryOrdered.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";

export default function InventoryOrdered() {
  const [entries, setEntries]     = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "asc" });
  const API = process.env.REACT_APP_API_ROOT;

  // Fetch only Ordered entries
  const load = async () => {
    const res = await axios.get(`${API}/inventoryOrdered`);
    setEntries(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  // Mark a single row as Received
  const handleReceiveRow = async (e) => {
    await axios.put(`${API}/inventoryOrdered`, { type: e.type, row: e.row });
    load();
  };

  // Sort handler
  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  // Produce sorted entries
  const sortedEntries = React.useMemo(() => {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      let aVal = a[sortConfig.key] || "";
      let bVal = b[sortConfig.key] || "";
      // for numeric sort on quantity (strip non‐digits)
      if (sortConfig.key === "quantity") {
        const numA = parseFloat(aVal) || 0;
        const numB = parseFloat(bVal) || 0;
        aVal = numA; bVal = numB;
      }
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1  : -1;
      return 0;
    });
    return sorted;
  }, [entries, sortConfig]);

  // Helper to display qty+unit
  const displayQty = (e) =>
    e.type === "Material"
      ? `${e.quantity} ${e.unit || ""}`.trim()
      : e.quantity;

  // Render sort arrow
  const SortArrow = ({ column }) => {
    if (sortConfig.key !== column) return null;
    return sortConfig.direction === "asc" ? " ▲" : " ▼";
  };

  return (
    <div style={{
      maxWidth: 800,
      margin: "2rem auto",
      fontFamily: "sans-serif"
    }}>
      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "sans-serif",
        marginBottom: "1rem"
      }}>
        <thead>
          <tr>
            {[
              { key: "date", label: "Date" },
              { key: "type", label: "Type" },
              { key: "name", label: "Name" },
              { key: "quantity", label: "Quantity" }
            ].map(col => (
              <th
                key={col.key}
                onClick={() => requestSort(col.key)}
                style={{
                  borderBottom: "1px solid #ddd",
                  padding: "0.5rem",
                  textAlign: "center",
                  cursor: "pointer",
                  userSelect: "none"
                }}
              >
                {col.label}<SortArrow column={col.key}/>
              </th>
            ))}
            <th style={{
              borderBottom: "1px solid #ddd",
              padding: "0.5rem",
              textAlign: "center"
            }}>
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((e, i) => (
            <tr key={i} style={{
              backgroundColor: i % 2 === 0 ? "#fafafa" : "transparent"
            }}>
              <td style={{ padding: "0.5rem", textAlign: "center" }}>{e.date}</td>
              <td style={{ padding: "0.5rem", textAlign: "center" }}>{e.type}</td>
              <td style={{ padding: "0.5rem", textAlign: "center" }}>{e.name}</td>
              <td style={{ padding: "0.5rem", textAlign: "center" }}>
                {displayQty(e)}
              </td>
              <td style={{ padding: "0.5rem", textAlign: "center" }}>
                <button
                  onClick={() => handleReceiveRow(e)}
                  style={{
                    padding: "0.3rem 0.6rem",
                    backgroundColor: "#4caf50",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontFamily: "sans-serif"
                  }}
                >
                  Receive
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
