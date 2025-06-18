import React, { useState, useEffect } from "react";

export default function Ship() {
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [boxes, setBoxes] = useState([]);

  const query = new URLSearchParams(window.location.search);
  const company = query.get("company");

  useEffect(() => {
    async function loadJobs() {
      if (!company) {
        alert("Missing company in URL (e.g. ?company=ClientName)");
        return;
      }

      try {
        const res = await fetch(
          `https://machine-scheduler-backend.onrender.com/api/jobs-for-company?company=${company}`,
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
        alert("Network error loading jobs.");
      }
    }

    loadJobs();
  }, [company]);

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
      <h2>📦 Select Jobs to Ship</h2>

      {jobs.map((job) => (
        <div
          key={job.orderId}
          onClick={() => toggleSelect(job.orderId)}
          style={{
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "12px",
            border: "1px solid #ccc",
            backgroundColor: selected.includes(job.orderId) ? "#4CAF50" : "#fff",
            color: selected.includes(job.orderId) ? "#fff" : "#000",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "1rem"
          }}
        >
          {job.image && (
            <img
              src={job.image}
              alt="Preview"
              style={{
                width: "100px",
                height: "100px",
                objectFit: "cover",
                borderRadius: "8px",
                border: "1px solid #999"
              }}
            />
          )}
          <div>
            <div><strong>Order #{job.orderId}</strong> – {job.company}</div>
            <div>Date: {job.date} | Due: {job.due}</div>
            <div>Design: {job.design}</div>
            <div>Product: {job.product} | Qty: {job.quantity}</div>
            <div>Price: ${job.price} | Stage: {job.stage}</div>
          </div>
        </div>
      ))}

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
