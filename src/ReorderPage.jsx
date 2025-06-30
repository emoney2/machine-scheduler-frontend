import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function ReorderPage() {
  const [companyList, setCompanyList] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Load list of company names on mount
  useEffect(() => {
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/directory`)
      .then((res) => {
        const names = (res.data || [])
          .map((entry) => entry.value)
          .filter((name) => typeof name === "string" && name.trim());
        setCompanyList(names);
      })
      .catch((err) => console.error("Failed to load company names", err));
  }, []);

  // Fetch jobs when a full company name is selected
  const handleCompanySelect = async (value) => {
    setCompanyInput(value);
    if (!companyList.includes(value)) return;
    setLoading(true);
    try {
      const res = await axios.get(
        `${process.env.REACT_APP_API_ROOT}/jobs-for-company?company=${encodeURIComponent(value)}`
      );
      setJobs(res.data.jobs || []);
    } catch {
      alert("Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setCompanyInput(val);
    if (companyList.includes(val)) {
      handleCompanySelect(val);
    }
  };

  const handleReorder = (job) => {
    navigate("/order", { state: { reorderJob: job } });
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>🔁 Reorder a Previous Job</h2>
      <input
        list="company-options"
        value={companyInput}
        onChange={handleInputChange}
        placeholder="Start typing a company..."
        ref={inputRef}
        style={{ width: "300px", padding: "0.5rem", fontSize: "1rem" }}
      />
      <datalist id="company-options">
        {companyList.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {loading && <p>Loading jobs…</p>}

      <div style={{ marginTop: "2rem" }}>
        {jobs.map((job, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid #ccc",
              padding: "0.75rem",
              borderRadius: "8px",
              marginBottom: "1rem",
              gap: "1rem",
            }}
          >
            <img
              src={job.image || ""}
              alt=""
              style={{ width: 60, height: 60, objectFit: "cover" }}
            />
            <div style={{ flex: 1 }}>
              <strong>{job.Design || "(No Design)"}</strong> — {job.Product || "?"} ({job.Quantity || "?"})
              <br />
              Order #{job["Order #"] || "?"} | Due: {job["Due Date"] || "?"}
            </div>
            <button onClick={() => handleReorder(job)}>Reorder</button>
          </div>
        ))}
      </div>
    </div>
  );
}
