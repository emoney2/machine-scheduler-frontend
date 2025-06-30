import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function ReorderPage() {
  const [company, setCompany] = useState("");
  const [companyList, setCompanyList] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmJob, setConfirmJob] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/directory`)
      .then((res) => {
        const names = (res.data || [])
          .map((entry) => entry.name)
          .filter((name) => typeof name === "string" && name.trim());
        setCompanyList(names);
      })
      .catch((err) => {
        console.error("Failed to load company names", err);
      });
  }, []);

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

      <div style={{ marginBottom: "1rem" }}>
        <input
          list="company-options"
          placeholder="Start typing a company..."
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          style={{ width: "300px", padding: "0.5rem" }}
        />
        <datalist id="company-options">
          {companyList.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
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
          <div
            style={{
              background: "#fff",
              padding: "2rem",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "1.1rem" }}>
              Do you want to change any details?
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "1rem",
                marginTop: "1rem",
              }}
            >
              <button
                onClick={() => handleConfirmChoice(true)}
                style={{ padding: "0.5rem 1rem" }}
              >
                Yes
              </button>
              <button
                onClick={() => handleConfirmChoice(false)}
                style={{ padding: "0.5rem 1rem" }}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
