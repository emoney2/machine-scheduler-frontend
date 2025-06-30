import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function ReorderPage() {
  const [company, setCompany] = useState("");
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
    const confirm = window.confirm("Do you want to change any details?");
    if (confirm) {
      // go to order form with job info pre-filled
      navigate("/order", { state: { reorderJob: job } });
    } else {
      // trigger auto reorder
      axios
        .post(`${process.env.REACT_APP_API_ROOT}/reorder`, {
          previousOrder: job.orderId,
          newDueDate: job.due,
          newDateType: "Hard Date",
          notes: "",
        })
        .then(() => alert("Reorder submitted!"))
        .catch(() => alert("Reorder failed."));
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2>Reorder a Previous Job</h2>
      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="Enter company name"
        style={{ marginRight: "1rem", padding: "0.5rem" }}
      />
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
    </div>
  );
}
