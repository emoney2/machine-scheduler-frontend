import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function ReorderPage() {
  const [company, setCompany] = useState("");
  const [companyList, setCompanyList] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmJob, setConfirmJob] = useState(null);
  const navigate = useNavigate();

  // Fetch company names for dropdown
  useEffect(() => {
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/directory`)
      .then((res) => {
        const companies = res.data || [];
        setCompanyList(companies.map((entry) => entry.name).filter(name => typeof name === "string" && name.trim() !== ""));
      })
      .catch((err) => {
        console.error("Failed to load company names", err);
      });
  }, []);

  const filteredCompanies = companyList.filter((name) =>
    name.toLowerCase().includes(company.toLowerCase())
  );

  const handleFetchJobs = async () => {
    if (!company.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(
        `${process.env.REACT_APP_API_ROOT}/jobs-for-company?company=${encodeURIComponent(company)}`
      );
      setJobs(res.data.jobs || []);
    } catch (err) {
      alert("Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmChoice = (yes) => {
    if (!confirmJob) return;
    if (yes) {
      navigate("/order", { state: { reorderJob: confirmJob } });
    } else {
      axios
        .post(`${process.env.REACT_APP_API_ROOT}/reorder`, {
          previousOrder: confirmJob["Order #"],
          newDueDate: confirmJob["Due Date"],
          newDateType: "Hard Date",
          notes: "",
        })
        .then(() => alert("Reorder submitted!"))
        .catch(() => alert("Reorder failed."));
    }
    setConfirmJob(null);
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2>Reorder a Previous Job</h2>

      <div style={{ position: "relative", marginBottom: "1rem" }}>
        <input
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder="Enter company name"
          style={{ marginRight: "1rem", padding: "0.5rem", width: "300px" }}
        />
        {showDropdown && filteredCompanies.length > 0 && (
          <div
            style={{
              position: "absolute",
              background: "#fff",
              border: "1px solid #ccc",
              width: "300px",
              zIndex: 10,
              maxHeight: "150px",
              overflowY: "auto",
            }}
          >
            {filteredCompanies.map((name) => (
              <div
                key={name}
                onMouseDown={() => {
                  setCompany(name);
                  setShowDropdown(false);
                }}
                style={{
                  padding: "0.5rem",
                  cursor: "pointer",
                  borderBottom: "1px solid #eee",
                }}
              >
                {name}
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={handleFetchJobs}>Find Jobs</button>

      {loading && <p>Loading…</p>}

      <div style={{ marginTop: "2rem" }}>
        {jobs.map((job, idx) => (
          <div
            key={idx}
            style={{
              border: "1px solid #ccc",
              padding: "0.5rem",
              marginBottom: "0.75rem",
              display: "flex",
              alignItems: "center",
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
            <button onClick={() => setConfirmJob(job)}>Reorder</button>
          </div>
        ))}
      </div>

      {confirmJob && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div style={{ background: "#fff", padding: "2rem", borderRadius: "8px", textAlign: "center" }}>
            <p style={{ fontSize: "1.1rem" }}>Do you want to change any details?</p>
            <div style={{ display: "flex", justifyContent: "center", gap: "1rem", marginTop: "1rem" }}>
              <button onClick={() => handleConfirmChoice(true)} style={{ padding: "0.5rem 1rem" }}>
                Yes
              </button>
              <button onClick={() => handleConfirmChoice(false)} style={{ padding: "0.5rem 1rem" }}>
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
