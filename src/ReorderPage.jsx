import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function ReorderPage() {
  const [company, setCompany] = useState("");
  const [companyNames, setCompanyNames] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Load company name options from Ship tab's endpoint
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/directory`)
      .then((res) => {
        if (Array.isArray(res.data)) {
          setCompanyNames(res.data);
        } else {
          console.error("Expected array, got:", res.data);
        }
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
        `${process.env.REACT_APP_API_ROOT}/jobs-for-company?company=${company}`
      );
      setJobs(res.data.jobs || []);
    } catch (err) {
      alert("Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  const handleReorder = (job) => {
    setSelectedJob(job);
    setShowModal(true);
  };

  const handleModalYes = () => {
    setShowModal(false);
    navigate("/order", { state: { reorderJob: selectedJob } });
  };

  const handleModalNo = () => {
    setShowModal(false);
    axios
      .post(`${process.env.REACT_APP_API_ROOT}/reorder`, {
        previousOrder: selectedJob.orderId,
        newDueDate: selectedJob.due,
        newDateType: "Hard Date",
        notes: "",
      })
      .then(() => alert("Reorder submitted!"))
      .catch(() => alert("Reorder failed."));
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2>Reorder a Previous Job</h2>

      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="Enter company name"
        list="company-list"
        style={{ marginRight: "1rem", padding: "0.5rem", width: "300px" }}
      />
      <datalist id="company-list">
        {companyNames.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <button onClick={handleFetchJobs}>Find Jobs</button>

      {loading && <p>Loading...</p>}

      <div style={{ marginTop: "2rem" }}>
        {jobs.map((job) => (
          <div
            key={job.orderId}
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
              <strong>{job.design}</strong> — {job.product} ({job.quantity})
              <br />
              Order #{job.orderId} | Due: {job.due}
            </div>
            <button onClick={() => handleReorder(job)}>Reorder</button>
          </div>
        ))}
      </div>

      {/* Custom Modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "1.5rem",
              borderRadius: "8px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
              textAlign: "center",
            }}
          >
            <p style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>
              Do you want to change any details?
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
              <button
                onClick={handleModalYes}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#28a745",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                }}
              >
                Yes
              </button>
              <button
                onClick={handleModalNo}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#dc3545",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                }}
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
