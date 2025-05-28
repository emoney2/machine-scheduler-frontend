import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
const ROWS = 15;
const BLANK = { value: "", action: "Ordered", quantity: "" };

export default function Inventory() {
  const [threads, setThreads] = useState([]);
  const [materials, setMaterials] = useState([]);

  // ➊ Create refs for each Thread-Color input (for later selection)
  const threadInputRefs = useRef(Array(ROWS).fill(null));

  // ➋ Handler to autocomplete Thread-Color inputs
  const handleThreadInput = (idx) => (e) => {
    const raw       = e.target.value;
    const inputType = e.nativeEvent?.inputType;

  // ➌ If user leaves an input that isn’t in the list, open a modal to add it
  const handleThreadBlur = (idx) => (e) => {
    const val = e.target.value.trim();
    if (val && !threads.includes(val)) {
      // seed the modal
      setNewItemData({ name: val, type: "Thread" });
      setNewItemErrors({});
      setIsNewItemModalOpen(true);
    }
  };
  // ➍ When a Thread-Color input loses focus, if its value isn’t in the list, open the “new thread” modal
  const handleThreadBlur = (idx) => (e) => {
    const val = e.target.value.trim();
    if (val && !threads.includes(val)) {
      setNewItemData({ name: val, type: "Thread" });
      setNewItemErrors({});
      setIsNewItemModalOpen(true);
    }
  };

    setThreadRows((rows) => {
      const newRows = [...rows];
      // If deleting, just store raw
      if (inputType?.startsWith("delete")) {
        newRows[idx].value = raw;
      } else {
        // Otherwise, attempt to complete from the threads list
        const match = threads.find((t) =>
          t.toLowerCase().startsWith(raw.toLowerCase())
        );
        newRows[idx].value = match && raw !== match ? match : raw;
        if (match && raw !== match) {
          // Highlight the appended text after render
          setTimeout(() => {
            const inp = threadInputRefs.current[idx];
            inp.setSelectionRange(raw.length, match.length);
          }, 0);
        }
      }
      return newRows;
    });
  };


  // Fetch dropdown options
  useEffect(() => {
    axios.get(`${process.env.REACT_APP_API_ROOT}/fur-colors`)
      .then(r => setThreads(r.data))
      .catch(console.error);
    axios.get(`${process.env.REACT_APP_API_ROOT}/materials`)
      .then(r => setMaterials(r.data))
      .catch(console.error);
  }, []);

  // Build initial rows
  const initRows = () => Array.from({ length: ROWS }, () => ({ ...BLANK }));
  const [threadRows, setThreadRows] = useState(initRows());
  const [materialRows, setMaterialRows] = useState(initRows());

  const handleChange = (setter, idx, field) => e => {
    const val = e.target.value;
    setter(rows => {
      const copy = [...rows];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const handleSubmit = async (rows, url, reset) => {
    const payload = rows.filter(r => r.value && r.quantity);
    if (!payload.length) return alert("No rows to submit");
    try {
      const res = await axios.post(`${process.env.REACT_APP_API_ROOT}${url}`, payload);
      alert(`Added ${res.data.added} rows`);
      reset(initRows());
    } catch (err) {
      console.error(err);
      alert("Submission failed");
    }
  };

  return (
    <div style={{ display: "flex", gap: 32, padding: 16 }}>
      {/* Thread Inventory */}
      <fieldset style={{ flex: 1 }}>
        <legend>Thread Inventory ({ROWS} rows)</legend>
        <table>
          <thead>
            <tr>
              <th>Thread Color</th>
              <th>O/R</th>
              <th>Quantity (# of Cones)</th>
            </tr>
          </thead>
          <datalist id="thread-list">
            {threads.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <tbody>
            {threadRows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input
                    ref={el => (threadInputRefs.current[i] = el)}
                    list="thread-list"
                    value={r.value}
                    placeholder="Thread color…"
                    onChange={handleThreadInput(i)}
                    onBlur={handleThreadBlur(i)}
                    style={{ width: "90%", boxSizing: "border-box" }}
                  />
                </td>
                <td>
                  <select
                    value={r.action}
                    onChange={handleChange(setThreadRows, i, "action")}
                  >
                    <option>Ordered</option>
                    <option>Received</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    value={r.quantity}
                    onChange={handleChange(setThreadRows, i, "quantity")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => handleSubmit(threadRows, "/threadInventory", setThreadRows)}
        >
          Submit Threads
        </button>
      </fieldset>

      {/* Material Inventory */}
      <fieldset style={{ flex: 1 }}>
        <legend>Material Inventory ({ROWS} rows)</legend>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>O/R</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {materialRows.map((r, i) => (
              <tr key={i}>
                <td>
                  <select
                    value={r.value}
                    onChange={handleChange(setMaterialRows, i, "value")}
                  >
                    <option value="">—</option>
                    {materials.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    value={r.action}
                    onChange={handleChange(setMaterialRows, i, "action")}
                  >
                    <option>Ordered</option>
                    <option>Received</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    value={r.quantity}
                    onChange={handleChange(setMaterialRows, i, "quantity")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => handleSubmit(materialRows, "/materialInventory", setMaterialRows)}
        >
          Submit Materials
        </button>
      </fieldset>
    </div>
  );
}
