// --- Section 1: Imports & Constants --------------------------------------
import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

const modalOverlay = {
  position: "fixed", top: 0, left: 0,
  width: "100%", height: "100%",
  background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000
};
const modalBox = {
  background: "#fff", padding: 16,
  borderRadius: 8, minWidth: 500
};
const inputStyle = {
  width: "100%", padding: 4,
  border: "1px solid #ccc"
};

const ROWS = 15;
const BLANK = { value: "", action: "Ordered", quantity: "" };

// --- Section 2: Inventory Component -------------------------------------
export default function Inventory() {
  // --- Section 2.1: State Hooks -----------------------------------------
  const [threads, setThreads]           = useState([]);
  const [materials, setMaterials]       = useState([]);
  const [threadRows, setThreadRows]     = useState(() => initRows());
  const [materialRows, setMaterialRows] = useState(() => initRows());

  // --- Section 2.2: New-Item Modal State --------------------------------
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [newItemData, setNewItemData] = useState({
    name: "",
    type: "",
    minInv: "",
    reorder: "",
    cost: ""
  });
  const [newItemErrors, setNewItemErrors]           = useState({});
  const [bulkNewItems, setBulkNewItems] = useState([]);
  const [newMaterialsBatch, setNewMaterialsBatch]  = useState([]); 

  // --- Section 2.3: Refs for Inline Typeahead ---------------------------
  const threadInputRefs   = useRef(Array(ROWS).fill(null));
  const materialInputRefs = useRef(Array(ROWS).fill(null));

  // --- Section 2.4: Effects to Fetch Dropdown Lists ---------------------
  useEffect(() => {
    axios.get(`${process.env.REACT_APP_API_ROOT}/fur-colors`)
      .then(res => setThreads(res.data))
      .catch(console.error);
    axios.get(`${process.env.REACT_APP_API_ROOT}/materials`)
      .then(res => setMaterials(res.data))
      .catch(console.error);
  }, []);

  // --- Section 2.5: Helper to Initialize Rows ----------------------------
  function initRows() {
    return Array.from({ length: ROWS }, () => ({ ...BLANK }));
  }

  // --- Section 3: Handlers for Inline Typeahead -------------------------
  const handleThreadInput = (idx) => (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;
    setThreadRows(rows => {
      const newRows = [...rows];
      if (inputType?.startsWith("delete")) {
        newRows[idx].value = raw;
      } else {
        const match = threads.find(t => t.toLowerCase().startsWith(raw.toLowerCase()));
        newRows[idx].value = match && raw !== match ? match : raw;
        if (match && raw !== match) {
          setTimeout(() => {
            const inp = threadInputRefs.current[idx];
            inp.setSelectionRange(raw.length, match.length);
          }, 0);
        }
      }
      return newRows;
    });
  };

  const handleThreadBlur = (idx) => (e) => {
    const val = e.target.value.trim();
    if (val && !threads.includes(val)) {
      setNewItemData({ name: val, type: "Thread" });
      setNewItemErrors({});
      setIsNewItemModalOpen(true);
    }
  };

  const handleMaterialInput = (idx) => (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;
    setMaterialRows(rows => {
      const newRows = [...rows];
      if (inputType?.startsWith("delete")) {
        newRows[idx].value = raw;
      } else {
        const match = materials.find(m => m.toLowerCase().startsWith(raw.toLowerCase()));
        newRows[idx].value = match && raw !== match ? match : raw;
        if (match && raw !== match) {
          setTimeout(() => {
            const inp = materialInputRefs.current[idx];
            inp.setSelectionRange(raw.length, match.length);
          }, 0);
        }
      }
      return newRows;
    });
  };

  const handleMaterialBlur = (idx) => (e) => {
    const val = e.target.value.trim();
    if (val && !materials.includes(val)) {
      setNewItemData({ name: val, type: "Material" });
      setNewItemErrors({});
      setIsNewItemModalOpen(true);
    }
  };

  // --- Section 4: Change & Submit Handlers -------------------------------
  const handleChange = (setter, idx, field) => (e) => {
    const val = e.target.value;
    setter(rows => {
      const copy = [...rows];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const handleSubmit = async (rows, url, resetRows) => {
    const payload = rows.filter(r => r.value && r.quantity);
    if (!payload.length) return alert("No rows to submit");
    try {
      const res = await axios.post(
        `${process.env.REACT_APP_API_ROOT}${url}`,
        payload
      );
      alert("Submitted!");
      resetRows(initRows());
    } catch (err) {
      console.error(err);
      alert("Submission failed");
    }
  };

// ⏺ Add this immediately below handleSubmit
   // ——— Custom submit for Threads — detect new colors first ———
   const submitThreads = () => {
     // ① Gather every distinct color in the grid that’s not yet in threads[]
     const unknowns = [
       ...new Set(
         threadRows
           .map(r => r.value.trim())
           .filter(v => v && !threads.includes(v))
       )
     ];

     // ② If there are any, prepare the bulk modal and bail out
     if (unknowns.length) {
       setBulkNewItems(
         unknowns.map(color => ({
           name:    color,
           minInv:  "",
           reorder: "",
           cost:    ""
         }))
       );
       setNewItemErrors({});
       setIsNewItemModalOpen(true);
       return;
     }

     // ③ Otherwise, no unknowns → submit the grid as usual
     handleSubmit(threadRows, "/threadInventory", setThreadRows);
   };

// ─── Section 4b: Intercept Material-Submit & Branch Endpoints ────────────
const handleMaterialSubmit = async () => {
  // 1) Do we have any new (unknown) materials?
  const unknowns = materialRows.filter(
    r => r.value.trim() && !materials.includes(r.value.trim())
  );
  if (unknowns.length) {
    // Open the “add new material” modal
    setNewItemData({
      name:     "",
      type:     "Material",
      unit:     "",
      minInv:   "",
      reorder:  "",
      cost:     "",
      action:   "Ordered",
      quantity: "",
      notes:    ""
    });
    setNewMaterialsBatch(unknowns);
    setNewItemErrors({});
    setIsNewItemModalOpen(true);
    return;
  }

  // 2) All rows are known → build payload for logging only
  const payload = materialRows
    .filter(r => r.value.trim() && r.quantity.trim())
    .map(r => ({
      materialName: r.value.trim(),
      action:       r.action,
      quantity:     r.quantity,
      notes:        r.notes || ""
    }));

  if (!payload.length) {
    alert("No materials to submit");
    return;
  }

  // 3) POST to /materialInventory (only writes to your Material Log)
  try {
    await axios.post(
      `${process.env.REACT_APP_API_ROOT}/materialInventory`,
      payload
    );
    // reset the grid
    setMaterialRows(initRows());
    alert("Submitted!");
  } catch (err) {
    console.error(err);
    alert("Material submission failed");
  }
};

// — Section 5: New-Item Modal Save Handler ——————————————
// 5a: Single-item save (threads or a manual material)
const handleSaveNewItem = async () => {
  const errs = {};
  if (!newItemData.name.trim()) errs.name = "Required";
  if (newItemData.type === "Material") {
    if (!newItemData.unit)    errs.unit    = "Required";
    if (!newItemData.minInv)  errs.minInv  = "Required";
    if (!newItemData.reorder) errs.reorder = "Required";
    if (!newItemData.cost)    errs.cost    = "Required";
  }
  if (Object.keys(errs).length) {
    setNewItemErrors(errs);
    return;
  }

  try {
    if (newItemData.type === "Thread") {
      // single thread
      const payload = [{
        threadColor: newItemData.name.trim(),
        minInv:      newItemData.minInv,
        reorder:     newItemData.reorder,
        cost:        newItemData.cost
      }];
      await axios.post(
        `${process.env.REACT_APP_API_ROOT}/threads`,
        payload
      );
      setThreads(t => [...t, newItemData.name.trim()]);
    } else {
      // single material
      const payload = [{
        materialName: newItemData.name.trim(),
        unit:         newItemData.unit,
        minInv:       newItemData.minInv,
        reorder:      newItemData.reorder,
        cost:         newItemData.cost
      }];
      await axios.post(
        `${process.env.REACT_APP_API_ROOT}/materials`,
        payload
      );
      setMaterials(m => [...m, newItemData.name.trim()]);
    }

    // close modal & clear out
    setIsNewItemModalOpen(false);
    setNewItemErrors({});
    setNewItemData({ name:"", type:"", unit:"", minInv:"", reorder:"", cost:"" });

    // re-submit the grid now that dropdowns are up to date
    if (newItemData.type === "Thread") {
      handleSubmit(threadRows,    "/threadInventory",   setThreadRows);
    } else {
      handleSubmit(materialRows,  "/materialInventory", setMaterialRows);
    }
  } catch {
    setNewItemErrors({ general: "Failed to save. Try again." });
  }
};

// ─── Section 5b: Save Bulk New Items (Threads OR Materials) ───────────────
const handleSaveBulkNewItems = async () => {
  try {
    if (bulkNewItems.length) {
      // --- MATERIAL BATCH ---
      if (newItemData.type === "Material") {
        // 1) Build payload to add & log new materials
        const addAndLogPayload = bulkNewItems.map(item => ({
          materialName: item.name.trim(),
          unit:         item.unit.trim(),
          minInv:       item.minInv.trim(),
          reorder:      item.reorder.trim(),
          cost:         item.cost.trim(),
          action:       item.action,     // either "Ordered" or "Received"
          quantity:     item.quantity,   // the quantity entered
          notes:        item.notes || "" // optional notes
        }));

        // 2) POST to /materials → (adds to Inventory AND logs)
        await axios.post(
          `${process.env.REACT_APP_API_ROOT}/materials`,
          addAndLogPayload
        );

        // 3) Refresh local dropdown list
        setMaterials(m => [
          ...m,
          ...bulkNewItems.map(i => i.name.trim())
        ]);
      }

      // --- THREAD BATCH (unchanged) ---
      if (newItemData.type === "Thread") {
        const payload = bulkNewItems.map(item => ({
          threadColor: item.name,
          minInv:      item.minInv,
          reorder:     item.reorder,
          cost:        item.cost
        }));
        await axios.post(
          `${process.env.REACT_APP_API_ROOT}/threadInventory`,
          payload
        );
        setThreads(prev => [...prev, ...bulkNewItems.map(i => i.name)]);
      }
    }

    // Close modal & clear state
    setIsNewItemModalOpen(false);
    setNewItemErrors({});
    setNewItemData({
      name:     "",
      type:     "",
      unit:     "",
      minInv:   "",
      reorder:  "",
      cost:     "",
      action:   "",
      quantity: "",
      notes:    ""
    });
    setBulkNewItems([]);

    // Reset grid and show confirmation
    setMaterialRows(initRows());
    alert("Submitted!");
  } catch (err) {
    console.error(err);
    setNewItemErrors({ general: "Failed to save. Try again." });
  }
};

  // --- Section 6: Render -----------------------------------------------
  return (
    <>
{isNewItemModalOpen && (bulkNewItems.length > 0 || newMaterialsBatch.length > 0) && (
  <div style={modalOverlay}>
    <div style={modalBox}>
      {bulkNewItems.length > 0 ? (
        <>
          <h2>
            Add {bulkNewItems.length} New Thread
            {bulkNewItems.length > 1 ? "s" : ""}
          </h2>
          {newItemErrors.general && (
            <div style={{ color: "red", marginBottom: 8 }}>
              {newItemErrors.general}
            </div>
          )}
          {/* Header for threads */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr",
              gap: 8,
              fontWeight: "bold",
              marginBottom: 4
            }}
          >
            <div>Thread Color</div>
            <div>Min. Inv.</div>
            <div>ReOrder</div>
            <div>Cost</div>
          </div>
          {/* One row per new thread */}
          {bulkNewItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                gap: 8,
                marginBottom: 4
              }}
            >
              <input
                value={item.name}
                readOnly
                style={{ ...inputStyle, background: "#eee" }}
              />
              <input
                type="number"
                value={item.minInv}
                onChange={e => {
                  const v = e.target.value;
                  setBulkNewItems(bs => {
                    const copy = [...bs];
                    copy[idx].minInv = v;
                    return copy;
                  });
                }}
                style={inputStyle}
              />
              <input
                type="number"
                value={item.reorder}
                onChange={e => {
                  const v = e.target.value;
                  setBulkNewItems(bs => {
                    const copy = [...bs];
                    copy[idx].reorder = v;
                    return copy;
                  });
                }}
                style={inputStyle}
              />
              <input
                type="number"
                step="0.01"
                value={item.cost}
                onChange={e => {
                  const v = e.target.value;
                  setBulkNewItems(bs => {
                    const copy = [...bs];
                    copy[idx].cost = v;
                    return copy;
                  });
                }}
                style={inputStyle}
              />
            </div>
          ))}
          {/* Actions */}
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <button
              onClick={() => {
                setBulkNewItems([]);
                setIsNewItemModalOpen(false);
              }}
              style={{ marginRight: 8 }}
            >
              Cancel
            </button>
            <button onClick={handleSaveNewItem}>Save All</button>
          </div>
        </>
      ) : (
        <>
          <h2>
            Add {newMaterialsBatch.length} New Material
            {newMaterialsBatch.length > 1 ? "s" : ""}
          </h2>
          {newItemErrors.general && (
            <div style={{ color: "red", marginBottom: 8 }}>
              {newItemErrors.general}
            </div>
          )}
          {/* Header for materials */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
              gap: 8,
              fontWeight: "bold",
              marginBottom: 4
            }}
          >
            <div>Material Name</div>
            <div>Unit</div>
            <div>Min. Inv.</div>
            <div>ReOrder</div>
            <div>Cost</div>
          </div>
          {/* One row per new material */}
          {newMaterialsBatch.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                gap: 8,
                marginBottom: 4
              }}
            >
              <input
                value={item.value}
                readOnly
                style={{ ...inputStyle, background: "#eee" }}
              />
              <select
                value={newItemData.unit}
                onChange={e =>
                  setNewItemData(d => ({
                    ...d,
                    unit: e.target.value
                  }))
                }
                style={inputStyle}
              >
                <option value="">—select—</option>
                <option>Yards</option>
                <option>Sqft</option>
              </select>
              <input
                type="number"
                value={newItemData.minInv}
                onChange={e =>
                  setNewItemData(d => ({
                    ...d,
                    minInv: e.target.value
                  }))
                }
                style={inputStyle}
              />
              <input
                type="number"
                value={newItemData.reorder}
                onChange={e =>
                  setNewItemData(d => ({
                    ...d,
                    reorder: e.target.value
                  }))
                }
                style={inputStyle}
              />
              <input
                type="number"
                step="0.01"
                value={newItemData.cost}
                onChange={e =>
                  setNewItemData(d => ({
                    ...d,
                    cost: e.target.value
                  }))
                }
                style={inputStyle}
              />
            </div>
          ))}
          {/* Actions */}
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <button
              onClick={() => {
                setNewMaterialsBatch([]);
                setIsNewItemModalOpen(false);
              }}
              style={{ marginRight: 8 }}
            >
              Cancel
            </button>
            <button onClick={handleSaveBulkNewItems}>
              Save All
            </button>
          </div>
        </>
      )}
    </div>
  </div>
)}

      <div style={{ display:"flex", gap:32, padding:16 }}>
        {/* Thread Inventory */}
        <fieldset style={{ flex:1 }}>
          <legend>Thread Inventory ({ROWS} rows)</legend>
          <datalist id="thread-list">
            {threads.map(c => <option key={c} value={c}/>) }
          </datalist>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={{ border:"1px solid #ccc", padding:4 }}>Thread Color</th>
                <th style={{ border:"1px solid #ccc", padding:4 }}>O/R</th>
                <th style={{ border:"1px solid #ccc", padding:4 }}>Quantity (# of Cones)</th>
              </tr>
            </thead>
            <tbody>
              {threadRows.map((r,i) => (
                <tr key={i}>
                  <td style={{ border:"1px solid #eee", padding:4 }}>
                    <input
                      ref={el => threadInputRefs.current[i]=el}
                      list="thread-list"
                      value={r.value}
                      onChange={handleThreadInput(i)}
                      placeholder="Thread color…"
                      style={{ width:"90%", boxSizing:"border-box" }}
                    />
                  </td>
                  <td style={{ border:"1px solid #eee", padding:4 }}>
                    <select value={r.action} onChange={handleChange(setThreadRows,i,"action") }>
                      <option>Ordered</option>
                      <option>Received</option>
                    </select>
                  </td>
                  <td style={{ border:"1px solid #eee", padding:4 }}>
                    <input type="number" value={r.quantity} onChange={handleChange(setThreadRows,i,"quantity")}/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={submitThreads} style={{ marginTop:8 }}>
            Submit Threads
          </button>
        </fieldset>

        {/* Material Inventory */}
        <fieldset style={{ flex:1 }}>
          <legend>Material Inventory ({ROWS} rows)</legend>
          <datalist id="material-list">
            {materials.map(m => <option key={m} value={m}/>) }
          </datalist>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={{ border:"1px solid #ccc", padding:4 }}>Material</th>
                <th style={{ border:"1px solid #ccc", padding:4 }}>O/R</th>
                <th style={{ border:"1px solid #ccc", padding:4 }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {materialRows.map((r,i) => (
                <tr key={i}>
                  <td style={{ border:"1px solid #eee", padding:4 }}>
                    <input
                      ref={el => materialInputRefs.current[i]=el}
                      list="material-list"
                      value={r.value}
                      onChange={handleMaterialInput(i)}
                      onBlur={handleMaterialBlur(i)}
                      placeholder="Material…"
                      style={{ width:"90%", boxSizing:"border-box" }}
                    />
                  </td>
                  <td style={{ border:"1px solid #eee", padding:4 }}>
                    <select value={r.action} onChange={handleChange(setMaterialRows,i,"action") }>
                      <option>Ordered</option>
                      <option>Received</option>
                    </select>
                  </td>
                  <td style={{ border:"1px solid #eee", padding:4 }}>
                    <input type="number" value={r.quantity} onChange={handleChange(setMaterialRows,i,"quantity")}/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={handleMaterialSubmit}
            style={{ marginTop: 8 }}
          >
            Submit Materials
          </button>
        </fieldset>
      </div>
    </>
  );
}
