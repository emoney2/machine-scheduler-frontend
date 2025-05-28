import React, { useEffect, useState } from "react";
import axios from "axios";

const BLANK = { value: "", action: "Ordered", quantity: "" };
const ROWS = 15;

export default function Inventory() {
  const [threads, setThreads] = useState([]);
  const [materials, setMaterials] = useState([]);

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
              <th>Quantity (ft)</th>
            </tr>
          </thead>
          <tbody>
            {threadRows.map((r, i) => (
              <tr key={i}>
                <td>
                  <select
                    value={r.value}
                    onChange={handleChange(setThreadRows, i, "value")}
                  >
                    <option value="">—</option>
                    {threads.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
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
