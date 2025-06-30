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

  useEffect(() => {
    console.log("🔄 Fetching company list...");
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/directory`)
      .then((res) => {
        const names = (res.data || [])
          .map((entry) => entry.value)
          .filter((name) => typeof name === "string" && name.trim());
        console.log("✅ Company list loaded:", names);
        setCompanyList(names);
      })
      .catch((err) => {
        console.error("❌ Failed to load company names", err);
      });
  }, []);

  const handleCompanySelect = async (value) => {
    console.log("🏢 Company selected:", value);
    setCompanyInput(value);
    if (!companyList.includes(value)) {
      console.log("⚠️ Company not in list:", value);
      return;
    }

    setLoading(true);
    try {
      const res = await axios.get(
        `${process.env.REACT_APP_API_ROOT}/jobs-for-company?company=${encodeURIComponent(value)}`
      );
      console.log("📦 Jobs loaded:", res.data.jobs);
      setJobs(res.data.jobs || []);
    } catch (err) {
      console.error("❌ Failed to load jobs for company:", value, err);
      alert("Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    console.log("⌨️ Typing:", val);
    setCompanyInput(val);
    if (companyList.includes(val)) {
      console.log("✅ Match found in companyList, fetching jobs...");
      handleCompanySelect(val);
    } else {
      console.log("🔍 No exact match yet.");
    }
  };

  const handleReorder = (job) => {
    console.log("🔁 Reordering job:", job);
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
