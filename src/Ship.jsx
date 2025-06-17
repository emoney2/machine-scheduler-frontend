// File: frontend/src/Ship.jsx

import React, { useState, useEffect } from "react";

// Mocked job data for now
const MOCK_JOBS = [
  { orderId: "9", product: "Blade", company: "JR" },
  { orderId: "25", product: "Driver Cover", company: "JR" },
  { orderId: "32", product: "Fairway", company: "JR" }
];

export default function Ship() {
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [boxes, setBoxes] = useState([]);

  useEffect(() => {
    // Later we’ll replace this with a fetch based on company from URL
    setJobs(MOCK_JOBS);
  }, []);

  const toggleSelect = (orderId) => {
    setSelected(prev =>
      prev.includes(orderId)
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const handleShip = async () => {
    if (selected.length === 0) return alert("Select at least one job to ship.");
    setLoading(true);

    const response = await fetch("https://machine-scheduler-backend.onrender.com/api/prepare-shipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ order_ids: selected })
    });

    const result = await response.json();
    setLoading(false);

    if (!response.ok && result.missing_products) {
      const confirmed = window.confirm("Missing volumes found. Reload the page to enter them?");
      if (confirmed) window.location.reload();
      return;
    }

    setBoxes(result.boxes || []);
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>📦 Select Jobs to Ship</h2>

      <div style={{ marginBottom: "1rem" }}>
        {jobs.map((job) => (
          <div
            key={job.orderId}
            onClick={() => toggleSelect(job.orderId)}
            style={{
              padding: "0.5rem 1rem",
              marginBottom: "0.5rem",
              cursor: "pointer",
              borderRadius: "20px",
              backgroundColor: selected.includes(job.orderId) ? "#4CAF50" : "#f0f0f0",
              color: selected.includes(job.orderId) ? "white" : "black"
            }}
          >
            {job.product} – Order #{job.orderId}
          </div>
        ))}
      </div>

      <button onClick={handleShip} disabled={loading}>
        {loading ? "Calculating..." : "🚚 Ship"}
      </button>
      <button onClick={() => setSelected([])} style={{ marginLeft: "1rem" }}>
        Cancel
      </button>

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
