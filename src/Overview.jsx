// src/Overview.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const ROOT = (process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");

// ——— Helpers ——————————————————————————————————————————————
function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  const str = String(s).trim();
  // Accept MM/DD, M/D, MM/DD/YYYY, YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.split("T")[0].split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return isNaN(dt) ? null : dt;
  }
  const parts = str.split(/[\/\-]/).map(p => p.trim());
  if (parts.length >= 2) {
    let [m, d, y] = parts.map(p => Number(p));
    if (!y) {
      // assume current year if omitted
      y = new Date().getFullYear();
    } else if (y < 100) {
      y += 2000;
    }
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return isNaN(dt) ? null : dt;
  }
  return null;
}

function daysUntil(dateLike) {
  const dt = parseDate(dateLike);
  if (!dt) return null;
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function fmtMMDD(s) {
  const dt = parseDate(s);
  if (!dt) return "";
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

function deriveThumb(link) {
  const s = String(link || "");
  let id = "";
  if (s.includes("id=")) id = s.split("id=")[1].split("&")[0];
  else if (s.includes("/file/d/")) id = s.split("/file/d/")[1].split("/")[0];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w160` : "";
}

function ringColorByShipDate(shipDate) {
  const d = daysUntil(shipDate);
  if (d === null) return "#999";
  if (d <= 0) return "#e74c3c";     // due/past due
  if (d <= 3) return "#f39c12";     // urgent
  if (d <= 7) return "#2ecc71";     // within window
  return "#999";
}

// ——— UI Bits ——————————————————————————————————————————————
const grid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gridTemplateRows: "auto auto",
  gap: 16,
  padding: 16,
};

const card = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  padding: 12,
  overflow: "hidden",
};

const header = { fontSize: 16, fontWeight: 700, marginBottom: 10 };

const rowCard = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #eee",
  borderRadius: 8,
  padding: "6px 8px",
  marginBottom: 6,
};

const col = (w, center = false) => ({
  width: w,
  flex: `0 0 ${w}`,
  textAlign: center ? "center" : "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  lineHeight: "16px",
});

const imgBox = {
  width: 80,            // ⬅️ doubled from 40
  height: 40,
  border: "2px solid #ccc",
  borderRadius: 6,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#fafafa",
};



// ——— Component ——————————————————————————————————————————————
export default function Overview() {
  // upcoming jobs
  const [upcoming, setUpcoming] = useState([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(true);

  // summary materials (grouped by vendor)
  const [materials, setMaterials] = useState([]); // [{vendor, items:[{name, qty, unit, type}], note?}]
  const [loadingMaterials, setLoadingMaterials] = useState(true);

  // departments (placeholders)
  const departments = ["Digitizing", "Fur", "Cut", "Print", "Embroidery", "Sewing"];

  // order modal
  const [modalOpenForVendor, setModalOpenForVendor] = useState(null);
  const [modalSelections, setModalSelections] = useState({}); // key: `${vendor}:::${name}` -> { selected, qty, unit, type }

  // Fast path: one call for both upcoming + materials (server: /api/overview)
  useEffect(() => {
    let alive = true;

    async function loadOverview() {
      try {
        setLoadingUpcoming(true);
        setLoadingMaterials(true);

        const res = await axios.get(`${ROOT}/overview`, { withCredentials: true });
        if (!alive) return;

        const { upcoming, materials } = res.data || {};
        const jobs = upcoming ?? [];
        const groups = materials ?? [];

        setUpcoming(jobs);
        setMaterials(groups);

        // prime selections (all pre-checked)
        const init = {};
        for (const g of groups) {
          for (const it of (g.items || [])) {
            const key = `${g.vendor}:::${it.name}`;
            init[key] = {
              selected: true,
              qty: String(it.qty ?? ""),
              unit: it.unit ?? "",
              type: it.type ?? "Material",
            };
          }
        }
        setModalSelections(init);
      } catch (e) {
        console.error("Failed to load overview", e);
      } finally {
        if (alive) {
          setLoadingUpcoming(false);
          setLoadingMaterials(false);
        }
      }
    }

    loadOverview();
    const id = setInterval(loadOverview, 45000); // fewer polls = faster app
    return () => { alive = false; clearInterval(id); };
  }, []);


  // Build rows for modal
  const modalRows = useMemo(() => {
    if (!modalOpenForVendor) return [];
    const grp = materials.find(g => g.vendor === modalOpenForVendor);
    if (!grp) return [];
    return (grp.items || []).map(it => {
      const key = `${grp.vendor}:::${it.name}`;
      return { vendor: grp.vendor, name: it.name, unit: it.unit || "", ...modalSelections[key], key };
    });
  }, [modalOpenForVendor, modalSelections, materials]);

  // Submit Order → write “Ordered” to Material Log / Thread Log using the same endpoints as Inventory
  async function submitOrder() {
    try {
      const rows = modalRows.filter(r => r.selected);
      if (!rows.length) {
        alert("No items selected.");
        return;
      }

      const materialPayload = [];
      const threadPayload = [];

      for (const r of rows) {
        const base = {
          quantity: String(r.qty || "1"),
          action: "Ordered",
        };
        if ((r.type || "Material") === "Thread") {
          threadPayload.push({ ...base, value: r.name });
        } else {
          materialPayload.push({ ...base, materialName: r.name, type: "Material" });
        }
      }

      if (materialPayload.length) {
        await axios.post(`${ROOT}/materialInventory`, materialPayload, { withCredentials: true });
      }
      if (threadPayload.length) {
        await axios.post(`${ROOT}/threadInventory`, threadPayload, { withCredentials: true });
      }

      alert("Order logged. (Action: Ordered)");
      setModalOpenForVendor(null);
    } catch (e) {
      console.error("Failed to log order", e);
      alert("Failed to log order. Check console.");
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={grid}>
        {/* TL — Performance / Goals (placeholder metrics) */}
        <div style={card}>
          <div style={header}>Company Performance</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[ "On-Time Ship %", "Avg Lead Time", "Throughput (pcs/day)", "Digitizing SLA", "Embroidery Hours", "WIP Count" ].map((t,i) => (
              <div key={i} style={{ border:"1px solid #eee", borderRadius:10, padding:10 }}>
                <div style={{ fontSize:12, color:"#666" }}>{t}</div>
                <div style={{ fontSize:22, fontWeight:700 }}>—</div>
                <div style={{ fontSize:11, color:"#888" }}>calculating…</div>
              </div>
            ))}
          </div>
        </div>

        {/* TR — Upcoming Jobs */}
        <div style={card}>
          {/* centered title */}
          <div style={{ ...header, textAlign: "center" }}>Upcoming Jobs (Ship in next 7 days)</div>

          {/* column header row */}
          <div
            style={{
              ...rowCard,
              padding: "4px 8px",
              marginBottom: 8,
              background: "#fafafa",
              borderColor: "#eee",
              fontSize: 11,
              fontWeight: 600,
              color: "#666",
            }}
          >
            <div style={{ ...imgBox, border: "0", background: "transparent" }} />
            <div style={{ width: 58 }}>Order #</div>
            <div style={col(250)}>Company Name</div>
            <div style={col(150)}>Design</div>
            <div style={{ ...col(56, true) }}>Qty</div>
            <div style={col(120)}>Product</div>
            <div style={col(90)}>Stage</div>
            <div style={{ ...col(64, true) }}>Due</div>
            <div style={{ ...col(50, true) }}>Print</div>
            <div style={{ ...col(68, true) }}>Ship</div>
            <div style={{ ...col(110, true) }}>Hard/Soft</div>
          </div>

          {loadingUpcoming && <div>Loading…</div>}
          {!loadingUpcoming && !upcoming.length && <div>No jobs in the next 7 days.</div>}

          {!loadingUpcoming && upcoming.map((job, idx) => {
            const ring = ringColorByShipDate(job["Ship Date"]);
            const imageUrl = job.image || deriveThumb(job["Preview"]);
            return (
              <div key={idx} style={rowCard}>
                <div style={{ ...imgBox, borderColor: ring }}>
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{ fontSize: 10, color: "#999" }}>No img</div>
                  )}
                </div>

                <div style={{ width: 58, fontWeight: 700, fontSize: 12 }} title={String(job["Order #"] || "")}>
                  {job["Order #"]}
                </div>
                <div style={col(250
)} title={String(job["Company Name"] || "")}>{job["Company Name"]}</div>
                <div style={col(150)} title={String(job["Design"] || "")}>{job["Design"]}</div>
                <div style={{ ...col(56, true), fontWeight: 600 }} title={String(job["Quantity"] || "")}>
                  {job["Quantity"]}
                </div>
                <div style={col(120)} title={String(job["Product"] || "")}>{job["Product"]}</div>
                <div style={col(90)} title={String(job["Stage"] || "")}>{job["Stage"]}</div>
                <div style={col(64, true)} title={String(job["Due Date"] || "")}>{fmtMMDD(job["Due Date"])}</div>
                <div style={col(50, true)} title={String(job["Print"] || "")}>{job["Print"]}</div>
                <div style={{ ...col(68, true), fontWeight: 700, color: ring }} title={String(job["Ship Date"] || "")}>
                  {fmtMMDD(job["Ship Date"])}
                </div>
                <div style={col(110, true)} title={String(job["Hard Date/Soft Date"] || "")}>{job["Hard Date/Soft Date"]}</div>
              </div>
            );
          })}
        </div>


        {/* BL — Department status (placeholders) */}
        <div style={card}>
          <div style={header}>Department Status</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:10 }}>
            {departments.map((d,i) => (
              <div key={i} style={{ border:"1px solid #eee", borderRadius:10, padding:10, minHeight:72 }}>
                <div style={{ fontSize:12, color:"#666" }}>{d}</div>
                <div style={{ fontSize:22, fontWeight:700 }}>—</div>
                <div style={{ fontSize:11, color:"#888" }}>calculating…</div>
              </div>
            ))}
          </div>
        </div>

        {/* BR — Materials to order (from Summary Tab) */}
        <div style={card}>
          <div style={header}>Materials To Order (Grouped by Vendor)</div>
          {loadingMaterials && <div>Loading…</div>}
          {!loadingMaterials && !materials.length && <div>No materials currently flagged.</div>}
          {!loadingMaterials && materials.map((grp, idx) => (
            <div key={idx} style={{ border:"1px solid #eee", borderRadius:10, padding:10, marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontWeight:700, fontSize: 13 }}>{grp.vendor || "Unknown Vendor"}</div>
                <button
                  onClick={() => setModalOpenForVendor(grp.vendor)}
                  style={{ padding:"5px 8px", fontSize:12, borderRadius:8, border:"1px solid #ccc", cursor:"pointer" }}
                >
                  Order Material
                </button>
              </div>
              <div style={{ marginTop:6 }}>
                {(grp.items || []).map((it, j) => (
                  <div
                    key={j}
                    style={{ display:"flex", gap:10, fontSize:12, lineHeight:"16px", padding:"2px 0" }}
                  >
                    <div
                      style={{ width: 240, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                      title={it.name}
                    >
                      {it.name}
                    </div>
                    <div style={{ width: 70, textAlign:"right" }} title={String(it.qty ?? "")}>{it.qty}</div>
                    <div style={{ width: 60 }} title={it.unit || ""}>{it.unit || ""}</div>
                    <div style={{ width: 80, color:"#666" }} title={it.type || "Material"}>{it.type || "Material"}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Order modal */}
      {modalOpenForVendor && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000
        }}>
          <div style={{ background:"#fff", borderRadius:12, padding:16, minWidth:600, maxHeight:"80vh", overflow:"auto" }}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:10 }}>
              Order from {modalOpenForVendor}
            </div>
            <div style={{ fontSize:12, color:"#666", marginBottom:10 }}>All items are pre-selected. Unselect anything you don’t want to order.</div>
            <div>
              {modalRows.map((r, i) => (
                <div key={i} style={{ display:"grid", gridTemplateColumns:"20px 1fr 120px 80px 110px", gap:10, alignItems:"center", padding:"6px 0", borderBottom:"1px solid #f1f1f1" }}>
                  <input
                    type="checkbox"
                    checked={!!r.selected}
                    onChange={e => setModalSelections(s => ({ ...s, [r.key]: { ...s[r.key], selected: e.target.checked } }))}
                  />
                  <div title={r.name} style={{ overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{r.name}</div>
                  <input
                    type="number"
                    min="0"
                    value={r.qty || ""}
                    onChange={e => setModalSelections(s => ({ ...s, [r.key]: { ...s[r.key], qty: e.target.value } }))}
                    style={{ width:"100%", padding:6, border:"1px solid #ccc", borderRadius:6 }}
                  />
                  <input
                    value={r.unit || ""}
                    onChange={e => setModalSelections(s => ({ ...s, [r.key]: { ...s[r.key], unit: e.target.value } }))}
                    placeholder="Unit"
                    style={{ width:"100%", padding:6, border:"1px solid #ccc", borderRadius:6 }}
                  />
                  <select
                    value={r.type || "Material"}
                    onChange={e => setModalSelections(s => ({ ...s, [r.key]: { ...s[r.key], type: e.target.value } }))}
                    style={{ width:"100%", padding:6, border:"1px solid #ccc", borderRadius:6 }}
                  >
                    <option>Material</option>
                    <option>Thread</option>
                  </select>
                </div>
              ))}
            </div>

            <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:12 }}>
              <button onClick={() => setModalOpenForVendor(null)} style={{ padding:"8px 12px", border:"1px solid #ccc", borderRadius:8 }}>Cancel</button>
              <button onClick={submitOrder} style={{ padding:"8px 12px", border:"1px solid #0a7", background:"#0a7", color:"#fff", borderRadius:8 }}>
                Order & Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
