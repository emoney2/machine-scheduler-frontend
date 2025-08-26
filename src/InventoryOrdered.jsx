// src/components/InventoryOrdered.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";

// Google Sheets serial date → JS Date
const SHEETS_EPOCH_MS = new Date(1899, 11, 30).getTime();
const toDate = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(SHEETS_EPOCH_MS + v * 86400000);
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
const fmtMMDDYYYY = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
};


export default function InventoryOrdered() {
  const [entries, setEntries]       = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "asc" });
  const API = process.env.REACT_APP_API_ROOT;

  const load = async () => {
    const res = await axios.get(`${API}/inventoryOrdered`);
    setEntries(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  const handleReceiveRow = async (e) => {
    await axios.put(`${API}/inventoryOrdered`, { type: e.type, row: e.row });
    load();
  };

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedEntries = React.useMemo(() => {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      // If sorting by date, parse strings into timestamps
      if (sortConfig.key === "date") {
        const aTime = toDate(a.date)?.getTime() ?? 0;
        const bTime = toDate(b.date)?.getTime() ?? 0;
        return sortConfig.direction === "asc" ? aTime - bTime : bTime - aTime;
      }

      let aVal = a[sortConfig.key] ?? "";
      let bVal = b[sortConfig.key] ?? "";

      if (sortConfig.key === "quantity") {
        // Numeric sort
        const numA = parseFloat(aVal) || 0;
        const numB = parseFloat(bVal) || 0;
        aVal = numA;
        bVal = numB;
      }

      // For strings (like Name), use localeCompare for proper alphabetic order
      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: "base" });
        return sortConfig.direction === "asc" ? cmp : -cmp;
      }
      // Fallback for any other types
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [entries, sortConfig]);


  const displayQty = (e) =>
    e.type === "Material"
      ? `${e.quantity} ${e.unit || ""}`.trim()
      : e.quantity;

  const SortArrow = ({ column }) => {
    if (sortConfig.key !== column) return null;
    return sortConfig.direction === "asc" ? " ▲" : " ▼";
  };

  return (
    <div style={{
      maxWidth: 800,
      margin: "2rem auto",
      fontFamily: "sans-serif",
      fontSize: "0.85rem"            // smaller base font
    }}>
      <table style={{
        width: "100%",
        borderCollapse: "collapse",
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
                  padding: "0.4rem",
                  textAlign: "center",
                  cursor: "pointer",
                  userSelect: "none",
                  fontSize: "0.85rem"
                }}
              >
                {col.label}<SortArrow column={col.key}/>
              </th>
            ))}
            <th style={{
              borderBottom: "1px solid #ddd",
              padding: "0.4rem",
              textAlign: "center",
              fontSize: "0.85rem"
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
              <td style={{ padding: "0.4rem", textAlign: "center", fontSize: "0.85rem" }}>
                {fmtMMDDYYYY(toDate(e.date))}
              </td>
              <td style={{ padding: "0.4rem", textAlign: "center", fontSize: "0.85rem" }}>
                {e.type}
              </td>
              <td style={{ padding: "0.4rem", textAlign: "center", fontSize: "0.85rem" }}>
                {e.name}
              </td>
              <td style={{ padding: "0.4rem", textAlign: "center", fontSize: "0.85rem" }}>
                {displayQty(e)}
              </td>
              <td style={{ padding: "0.4rem", textAlign: "center" }}>
                <button
                  onClick={() => handleReceiveRow(e)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    backgroundColor: "#4caf50",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: "0.8rem"   // smaller button text
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
