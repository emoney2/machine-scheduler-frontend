// --- Section 1: Imports & Constants --------------------------------------
import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

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
  const [newItemData, setNewItemData]               = useState({ name: "", type: "" });
  const [newItemErrors, setNewItemErrors]           = useState({});

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
      alert(`Added ${res.data.added} rows`);
      resetRows(initRows());
    } catch (err) {
      console.error(err);
      alert("Submission failed");
    }
  };

  // --- Section 5: New-Item Modal Save Handler ---------------------------
  const handleSaveNewItem = async () => {
    const key = newItemData.type === "Thread" ? "/fur-colors" : "/materials";
    if (!newItemData.name.trim()) {
      setNewItemErrors({ name: "Required" });
      return;
    }
    try {
      await axios.post(
        `${process.env.REACT_APP_API_ROOT}${key}`,
        { [(newItemData.type === "Thread" ? "furColor" : "materialName")]: newItemData.name }
      );
      if (newItemData.type === "Thread") setThreads(prev => [...prev, newItemData.name]);
      else setMaterials(prev => [...prev, newItemData.name]);
      setIsNewItemModalOpen(false);
    } catch {
      setNewItemErrors({ general: "Failed to save. Try again." });
    }
  };

  // --- Section 6: Render -----------------------------------------------
  return (
    <>
      {isNewItemModalOpen && (
        <div style={{ position: "fixed", top:0, left:0, width:"100%", height:"100%", background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:"#fff", padding:16, borderRadius:8, minWidth:300 }}>
            <h2>Add New {newItemData.type}</h2>
            {newItemErrors.general && <div style={{color:"red"}}>{newItemErrors.general}</div>}
            <div style={{ marginBottom:12 }}>
              <label>Name*<br/>
                <input
                  value={newItemData.name}
                  onChange={e => setNewItemData(prev => ({ ...prev, name: e.target.value }))}
                  style={{ width:"100%", padding:4, borderColor: newItemErrors.name ? 'red':'#ccc' }}
                />
              </label>
              {newItemErrors.name && <div style={{color:"red"}}>{newItemErrors.name}</div>}
            </div>
            <div style={{ textAlign:"right" }}>
              <button onClick={() => setIsNewItemModalOpen(false)} style={{ marginRight:8 }}>Cancel</button>
              <button onClick={handleSaveNewItem}>Save</button>
            </div>
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
                      onBlur={handleThreadBlur(i)}
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
          <button onClick={() => handleSubmit(threadRows, "/threadInventory", setThreadRows)} style={{ marginTop:8 }}>Submit Threads</button>
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
          <button onClick={() => handleSubmit(materialRows, "/materialInventory", setMaterialRows)} style={{ marginTop:8 }}>Submit Materials</button>
        </fieldset>
      </div>
    </>
  );
}
