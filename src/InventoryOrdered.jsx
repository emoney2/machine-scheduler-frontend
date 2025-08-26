// src/InventoryOrdered.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = process.env.REACT_APP_API_ROOT;

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
  const [entries, setEntries] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "asc" });
  const [editingRowKey, setEditingRowKey] = useState(null); // unique key: `${type}-${row}`
  const [draftQty, setDraftQty] = useState("");

  const load = async () => {
    const res = await axios.get(`${API}/inventoryOrdered`);
    setEntries(res.data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const requestSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const sortedEntries = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      const dir = sortConfig.direction === "asc" ? 1 : -1;

      if (sortConfig.key === "date") {
        const aTime = toDate(a.date)?.getTime() ?? 0;
        const bTime = toDate(b.date)?.getTime() ?? 0;
        return dir * (aTime - bTime);
      }

      const av = (a[sortConfig.key] ?? "").toString().toLowerCase();
      const bv = (b[sortConfig.key] ?? "").toString().toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return copy;
  }, [entries, sortConfig]);

  const onReceive = async (e) => {
    try {
      await axios.put(`${API}/inventoryOrdered`, {
        type: e.type,
        row: e.row
      });
      await load();
    } catch (err) {
      console.error("Receive failed:", err);
      alert("Failed to mark as received.");
    }
  };

  const beginEdit = (e) => {
    const key = `${e.type}-${e.row}`;
    setEditingRowKey(key);
    setDraftQty(e.quantity ?? "");
  };

  const cancelEdit = () => {
    setEditingRowKey(null);
    setDraftQty("");
  };

  const saveEdit = async (e) => {
    try {
      await axios.patch(`${API}/inventoryOrdered/quantity`, {
        type: e.type,
        row: e.row,
        quantity: draftQty
      });
      setEditingRowKey(null);
      setDraftQty("");
      await load();
    } catch (err) {
      console.error("Save quantity failed:", err);
      alert("Failed to update quantity.");
    }
  };

  const headerStyle = { padding: "0.5rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" };
  const cellStyle = { padding: "0.4rem", textAlign: "center", fontSize: "0.85rem" };

  return (
    <div style={{ padding: "1rem" }}>
      <h2 style={{ margin: 0, marginBottom: "0.75rem" }}>Inventory &mdash; Ordered</h2>

      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #ddd" }}>
        <thead style={{ background: "#f5f5f5" }}>
          <tr>
            <th style={headerStyle} onClick={() => requestSort("date")}>Date</th>
            <th style={headerStyle} onClick={() => requestSort("type")}>Type</th>
            <th style={headerStyle} onClick={() => requestSort("name")}>Name</th>
            <th style={headerStyle} onClick={() => requestSort("quantity")}>Quantity</th>
            <th style={{ padding: "0.5rem", fontWeight: 700, fontSize: "0.85rem" }}>Unit</th>
            <th style={{ padding: "0.5rem", fontWeight: 700, fontSize: "0.85rem" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((e, i) => {
            const key = `${e.type}-${e.row}`;
            const isEditing = key === editingRowKey;
            const isMaterial = (e.type || "").toLowerCase() === "material";

            return (
              <tr key={key} style={{ backgroundColor: i % 2 === 0 ? "#fafafa" : "transparent" }}>
                <td style={cellStyle}>{fmtMMDDYYYY(toDate(e.date))}</td>
                <td style={cellStyle}>{e.type}</td>
                <td style={{ ...cellStyle, textAlign: "left" }}>{e.name}</td>
                <td style={cellStyle}>
                  {isEditing ? (
                    <input
                      style={{ width: "8rem", padding: "0.25rem" }}
                      value={draftQty}
                      onChange={(ev) => setDraftQty(ev.target.value)}
                      placeholder="Enter quantity"
                    />
                  ) : (
                    e.quantity
                  )}
                </td>
                <td style={cellStyle}>{e.unit ?? ""}</td>
                <td style={cellStyle}>
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => saveEdit(e)}
                        style={{ marginRight: 8, padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid #ddd" }}
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        style={{ padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid #ddd" }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Only allow editing for Material rows to avoid confusion with thread "cones" conversion */}
                      {isMaterial && (
                        <button
                          onClick={() => beginEdit(e)}
                          style={{ marginRight: 8, padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid #ddd" }}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => onReceive(e)}
                        style={{
                          padding: "0.25rem 0.6rem",
                          borderRadius: 6,
                          border: "1px solid #2c7",
                          background: "#eaffea"
                        }}
                      >
                        Receive
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
