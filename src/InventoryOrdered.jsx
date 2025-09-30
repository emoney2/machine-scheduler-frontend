// src/components/InventoryOrdered.jsx
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function InventoryOrdered() {
  const [entries, setEntries] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "asc" });
  const [editingKey, setEditingKey] = useState(null);   // `${type}-${row}`
  const [draftQty, setDraftQty] = useState("");
  const [isOverlay, setIsOverlay] = useState(false);
  const [overlayText, setOverlayText] = useState("");

  const load = async (force = false, opts = {}) => {
    const silent = !!opts.silent; // when true, don't touch the page overlay here
    try {
      if (!silent) {
        setIsOverlay(true);
        setOverlayText("Loading inventory…");
      }

      const etagKey = "invOrd:etag";
      const dataKey = "invOrd:data";
      const headers = {};

      // Only send If-None-Match when NOT forcing
      if (!force) {
        const prevEtag = localStorage.getItem(etagKey);
        if (prevEtag) headers["If-None-Match"] = prevEtag;
      }

      // Cache-bust when forcing
      const url = force
        ? `${API}/inventoryOrdered?t=${Date.now()}`
        : `${API}/inventoryOrdered`;

      const res = await axios.get(url, {
        headers,
        withCredentials: true,
        // accept 304 (Not Modified) without throwing
        validateStatus: (s) => s === 200 || s === 304,
      });

      if (res.status === 304) {
        const cached = localStorage.getItem(dataKey);
        setEntries(cached ? JSON.parse(cached) : []);
      } else {
        const rows = Array.isArray(res.data) ? res.data : [];
        setEntries(rows);
        if (res.headers?.etag) localStorage.setItem(etagKey, res.headers.etag);
        localStorage.setItem(dataKey, JSON.stringify(rows));
      }
    } catch (err) {
      console.error("Failed to load inventoryOrdered:", err);
      setEntries([]);
    } finally {
      if (!silent) {
        setOverlayText("");
        setIsOverlay(false);
      }
    }
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
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      if (sortConfig.key === "date") {
        const aTime = toDate(a.date)?.getTime() ?? 0;
        const bTime = toDate(b.date)?.getTime() ?? 0;
        return dir * (aTime - bTime);
      }
      const av = (a[sortConfig.key] ?? "").toString().toLowerCase();
      const bv = (b[sortConfig.key] ?? "").toString().toLowerCase();

      if (sortConfig.key === "quantity") {
        const numA = parseFloat(av) || 0;
        const numB = parseFloat(bv) || 0;
        return dir * (numA - numB);
      }

      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return dir * cmp;
    });
    return copy;
  }, [entries, sortConfig]);

  const displayQty = (e) => {
    const q = e?.quantity;
    if (q == null) return "";
    const t = String(e.type || "").toLowerCase();

    // For Threads, backend quantity may include "cones" (e.g., "1.00 cones")
    // Show just the numeric part in the Quantity column; Unit column already shows "cones".
    if (t === "thread") {
      const n = parseFloat(String(q).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n.toFixed(2) : String(q);
    }

    // Materials: show as-is
    return q;
  };

  const handleReceiveRow = async (e) => {
    try {
      // Show overlay with the item name while receiving
      const itemName = e?.name ? String(e.name) : "";
      setIsOverlay(true);
      setOverlayText(itemName ? `Receiving ${itemName}…` : "Receiving…");

      await axios.put(
        `${API}/inventoryOrdered`,
        { type: e.type, row: e.row },
        { withCredentials: true, timeout: 20000 }
      );

      // One forced reload + short settle (refreshAfterWrite will switch text to “Updating…” then clear)
      await refreshAfterWrite();
    } catch (err) {
      console.error("Receive failed:", err);
      alert("Failed to mark as received.");
      setOverlayText("");
      setIsOverlay(false);
    }
  };


  // Inline edit controls (Materials only)
  const beginEdit = (e) => {
    setEditingKey(`${e.type}-${e.row}`);
    setDraftQty(String(e.quantity ?? ""));
  };
  const cancelEdit = () => {
    setEditingKey(null);
    setDraftQty("");
  };

  const refreshAfterWrite = async () => {
    // Keep the overlay up, but let load run in "silent" mode (no flicker)
    setOverlayText("Updating…");
    // We already do ONE immediate forced reload to reflect raw write:
    await load(true, { silent: true });
    // Then wait a beat so QUERY/ARRAYFORMULA finishes
    await sleep(900);
    // No second fetch — we keep what we have and clear the overlay
    setOverlayText("");
    setIsOverlay(false);
  };


const saveEdit = async (e) => {
  try {
    setIsOverlay(true);
    setOverlayText("Saving quantity…");

    const body = {
      type: e.type,     // "Material" | "Thread"
      row:  e.row,      // original sheet row (>= 2)
      quantity: draftQty
    };

    const res = await axios.patch(
      `${API}/inventoryOrdered/quantity`,
      body,
      { withCredentials: true, timeout: 20000 }
    );

    if (res.status !== 200 || !res.data?.ok) {
      throw new Error(res.data?.error || `Unexpected status ${res.status}`);
    }

    setEditingKey(null);
    setDraftQty("");

    await refreshAfterWrite(); // one forced reload + 900ms settle
  } catch (err) {
    console.error("Save quantity failed:", err);
    const msg = err?.response?.data?.error || err?.message || "Failed to update quantity.";
    alert(msg);
    setOverlayText("");
    setIsOverlay(false);
  }
};

  // ——— centered styles ———
  const th = {
    padding: "0.5rem",
    fontWeight: 700,
    fontSize: "0.85rem",
    cursor: "pointer",
    textAlign: "center",
    verticalAlign: "middle"
  };
  const thPlain = {
    padding: "0.5rem",
    fontWeight: 700,
    fontSize: "0.85rem",
    textAlign: "center",
    verticalAlign: "middle"
  };
  const td = {
    padding: "0.4rem",
    textAlign: "center",
    fontSize: "0.85rem",
    verticalAlign: "middle"
  };
  const btn = {
    padding: "0.25rem 0.6rem",
    borderRadius: 6,
    border: "1px solid #ddd",
    cursor: "pointer",
    fontSize: "0.8rem"
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h2 style={{ margin: 0, marginBottom: "0.75rem" }}>Inventory — Ordered</h2>

      {/* 🌕 Transparent page overlay */}
      {isOverlay && (
        <div style={{
          position: "fixed",
          top: 0, left: 0,
          width: "100vw", height: "100vh",
          backgroundColor: "rgba(255, 247, 194, 0.65)", // transparent yellow
          zIndex: 9998,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: "1.1rem",
          pointerEvents: "none" // visual only; don't block clicks
        }}>
          {overlayText || "Loading…"}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #ddd" }}>

        <thead style={{ background: "#f5f5f5" }}>
          <tr>
            <th style={th} onClick={() => requestSort("date")}>Date</th>
            <th style={th} onClick={() => requestSort("type")}>Type</th>
            <th style={th} onClick={() => requestSort("name")}>Name</th>
            <th style={th} onClick={() => requestSort("vendor")}>Vendor</th>
            <th style={th} onClick={() => requestSort("quantity")}>Quantity</th>
            <th style={thPlain}>Unit</th>
            <th style={thPlain}>Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((e, i) => {
            const key = `${e.type}-${e.row}`;
            const editing = key === editingKey;
            const isMaterial = String(e.type || "").toLowerCase() === "material";

            return (
              <tr key={key} style={{ backgroundColor: i % 2 === 0 ? "#fafafa" : "transparent" }}>
                <td style={td}>{fmtMMDDYYYY(toDate(e.date))}</td>
                <td style={td}>{e.type}</td>
                <td style={td}>{e.name}</td>
                <td style={td}>{e.vendor ?? ""}</td>

                {/* Quantity cell: inline edit for Materials only */}
                <td style={td}>
                  {editing ? (
                    <div style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                      <input
                        style={{ width: "7rem", padding: "0.25rem" }}
                        value={draftQty}
                        onChange={(ev) => setDraftQty(ev.target.value)}
                        placeholder="Enter qty"
                      />
                      <button style={btn} onClick={() => saveEdit(e)}>Save</button>
                      <button style={btn} onClick={cancelEdit}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                      <span>{displayQty(e)}</span>
                      {isMaterial && (
                        <button style={btn} onClick={() => beginEdit(e)}>Edit</button>
                      )}
                    </div>
                  )}
                </td>

                <td style={td}>{e.unit ?? ""}</td>

                <td style={td}>
                  <button
                    onClick={() => handleReceiveRow(e)}
                    style={{
                      padding: "0.25rem 0.6rem",
                      borderRadius: 6,
                      border: "1px solid #2c7",
                      background: "#eaffea",
                      cursor: "pointer",
                      fontSize: "0.8rem"
                    }}
                  >
                    Receive
                  </button>
                </td>
              </tr>
            );
          })}
          {sortedEntries.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: "0.8rem", textAlign: "center", color: "#777" }}>
                No ordered items
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
