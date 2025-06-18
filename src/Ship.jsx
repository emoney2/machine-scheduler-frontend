import React, { useState, useEffect } from "react";

export default function Ship() {
  const [jobs, setJobs] = useState([]);
  const [allCompanies, setAllCompanies] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [boxes, setBoxes] = useState([]);
  const [companyInput, setCompanyInput] = useState("");

  const query = new URLSearchParams(window.location.search);
  const defaultCompany = query.get("company");

  useEffect(() => {
    if (defaultCompany) {
      setCompanyInput(defaultCompany);
      fetchJobs(defaultCompany);
    }
    fetchCompanyNames();
  }, []);

  async function fetchCompanyNames() {
    try {
      const res = await fetch(
        "https://machine-scheduler-backend.onrender.com/api/company-list",
        { credentials: "include" }
      );
      const data = await res.json();
      setAllCompanies(data.companies || []);
    } catch (err) {
      console.error("Company fetch failed", err);
    }
  }

  async function fetchJobs(company) {
    setJobs([]);
    setBoxes([]);
    setSelected([]);
    try {
      const res = await fetch(
        `https://machine-scheduler-backend.onrender.com/api/jobs-for-company?company=${encodeURIComponent(
          company
        )}`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (res.ok) {
        setJobs(data.jobs);
      } else {
        alert(data.error || "Failed to load jobs");
      }
    } catch (err) {
      console.error(err);
      alert("Error loading jobs.");
    }
  }

  const handleSelectCompany = (e) => {
    const value = e.target.value;
    setCompanyInput(value);
    if (allCompanies.includes(value)) {
      fetchJobs(value);
    }
  };

  const toggleSelect = (orderId) => {
    setSelected((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId]
    );
  };

  const handleShip = async () => {
    if (selected.length === 0) {
      alert("Select at least one job to ship.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        "https://machine-scheduler-backend.onrender.com/api/prepare-shipment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ order_ids: selected }),
        }
      );

      const result = await response.json();
      setLoading(false);

      if (!response.ok && result.missing_products) {
        const confirmed = window.confirm(
          "Missing volumes found. Reload the page to enter them?"
        );
        if (confirmed) window.location.reload();
        return;
      }

      setBoxes(result.boxes || []);
    } catch (err) {
      console.error(err);
      alert("Failed to ship.");
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>📦 Ship Jobs</h2>

      {/* 🔍 Type-ahead search */}
      <input
        list="company-options"
        placeholder="Start typing a company..."
        value={companyInput}
        onChange={handleSelectCompany}
        style={{
          fontSize: "1rem",
          padding: "0.5rem",
          width: "300px",
          marginBottom: "2rem"
        }}
      />
      <datalist id="company-options">
        {allCompanies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* ✅ Job Row Display */}
      {jobs.map((job) => (
        <div
          key={job.orderId}
          onClick={() => toggleSelect(job.orderId)}
          style={{
            display: "flex",
            alignItems: "center",
            border: "1px solid #ccc",
            padding: "0.5rem 1rem",
            marginBottom: "0.5rem",
            borderRadius: "8px",
            backgroundColor: selected.includes(job.orderId)
              ? "#4CAF50"
              : "#fff",
            color: selected.includes(job.orderId) ? "#fff" : "#000",
            cursor: "pointer",
            gap: "1rem",
            overflow: "hidden"
          }}
        >
          {job.image && (
            <img
              src={job.image}
              alt="Preview"
              style={{
                width: "60px",
                height: "60px",
                objectFit: "cover",
                borderRadius: "4px",
                border: "1px solid #999"
              }}
            />
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "80px 80px 120px 160px 60px 100px 80px 80px 80px",
              gap: "1rem",
              fontSize: "0.9rem",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              width: "100%"
            }}
          >
            <div><strong>{job.orderId}</strong></div>
            <div>{job.date}</div>
            <div>{job.company}</div>
            <div>{job.design}</div>
            <div>{job.quantity}</div>
            <div>{job.product}</div>
            <div>{job.stage}</div>
            <div>${job.price}</div>
            <div>{job.due}</div>
          </div>
        </div>
      ))}

      {/* 🚚 Ship Buttons */}
      <div style={{ marginTop: "2rem" }}>
        <button onClick={handleShip} disabled={loading}>
          {loading ? "Calculating..." : "🚚 Ship"}
        </button>
        <button onClick={() => setSelected([])} style={{ marginLeft: "1rem" }}>
          Cancel
        </button>
      </div>

      {/* 📦 Box Summary */}
      {boxes.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h3>📦 Packed Boxes</h3>
          <ul>
            {boxes.map((box, i) => (
              <li key={i}>
                <b>{box.size}</b> → {box.jobs.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
