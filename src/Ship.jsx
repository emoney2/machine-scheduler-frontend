import React, { useState, useEffect } from "react";

function formatDateMMDD(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.includes("-")
    ? dateStr.split("-")
    : dateStr.includes("/")
    ? dateStr.split("/")
    : [];

  if (parts.length !== 3) return dateStr;

  const [a, b, c] = parts.map(p => parseInt(p));
  if (dateStr.includes("-")) {
    return `${b.toString().padStart(2, "0")}/${c.toString().padStart(2, "0")}`;
  } else {
    return `${a.toString().padStart(2, "0")}/${b.toString().padStart(2, "0")}`;
  }
}

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

  const promptDimensionsForProduct = async (product) => {
    const input = prompt(
      `Enter dimensions for "${product}" (in inches).\nFormat: Length x Width x Height`
    );

    if (!input) {
      alert("Volume entry canceled. Shipping aborted.");
      return false;
    }

    const match = input.match(/^(\d+)\s*[xX*]\s*(\d+)\s*[xX*]\s*(\d+)$/);
    if (!match) {
      alert("Invalid format. Use something like 10x5x3.");
      return false;
    }

    const [, length, width, height] = match;

    try {
      const res = await fetch(
        "https://machine-scheduler-backend.onrender.com/api/set-volume",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ product, length, width, height }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(`Failed to set volume for ${product}: ${data.error}`);
        return false;
      }
      return true;
    } catch (err) {
      alert("Failed to save volume");
      return false;
    }
  };


  const handleShip = async () => {
    if (selected.length === 0) {
      alert("Select at least one job to ship.");
      return;
    }

    setLoading(true);
    try {
      // Step 1: try preparing shipment
      let response = await fetch(
        "https://machine-scheduler-backend.onrender.com/api/prepare-shipment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ order_ids: selected }),
        }
      );

      let result = await response.json();

      // If missing volume, prompt for dimensions
      if (!response.ok && result.missing_products) {
        for (let product of result.missing_products) {
          const success = await promptDimensionsForProduct(product);
          if (!success) {
            setLoading(false);
            return;
          }
        }

        // Retry shipment after saving volumes
        response = await fetch(
          "https://machine-scheduler-backend.onrender.com/api/prepare-shipment",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ order_ids: selected }),
          }
        );

        result = await response.json();
      }

      const packedBoxes = result.boxes || [];
      setBoxes(packedBoxes);

      // Step 2: simulate shipping
      const shipRes = await fetch(
        "https://machine-scheduler-backend.onrender.com/api/process-shipment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ order_ids: selected, boxes: packedBoxes }),
        }
      );

      const shipData = await shipRes.json();

      if (shipRes.ok) {
        // Open each label
        shipData.labels.forEach((url) => window.open(url, "_blank"));
        window.open(shipData.invoice, "_blank");
        shipData.slips.forEach((url) => window.open(url, "_blank"));
      } else {
        alert(shipData.error || "Shipment failed.");
      }

      setLoading(false);
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert("Failed to ship.");
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>📦 Ship Jobs</h2>

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

      {jobs.length > 0 && (
        <div
          style={{
            display: "flex",
            fontWeight: "bold",
            padding: "0.5rem 1rem",
            borderBottom: "2px solid #333",
            marginBottom: "0.5rem",
            marginTop: "1rem",
            fontSize: "0.85rem"
          }}
        >
          <div style={{ width: 60 }}></div>
          <div style={{ width: 60, textAlign: "center" }}>#</div>
          <div style={{ width: 80, textAlign: "center" }}>Date</div>
          <div style={{ width: 200, textAlign: "center" }}>Design</div>
          <div style={{ width: 70, textAlign: "center" }}>Qty</div>
          <div style={{ width: 120, textAlign: "center" }}>Product</div>
          <div style={{ width: 120, textAlign: "center" }}>Stage</div>
          <div style={{ width: 80, textAlign: "center" }}>Price</div>
          <div style={{ width: 90, textAlign: "center" }}>Due</div>
        </div>
      )}

      {jobs.map((job) => (
        <div
          key={job.orderId}
          onClick={() => toggleSelect(job.orderId)}
          style={{
            display: "flex",
            alignItems: "center",
            border: "1px solid #ccc",
            padding: "0.5rem 1rem",
            marginBottom: "0.3rem",
            borderRadius: "6px",
            backgroundColor: selected.includes(job.orderId)
              ? "#4CAF50"
              : "#fff",
            color: selected.includes(job.orderId) ? "#fff" : "#000",
            cursor: "pointer"
          }}
        >
          <div style={{ width: 60 }}>
            {job.image && (
              <img
                src={job.image}
                alt="Preview"
                style={{
                  width: "50px",
                  height: "50px",
                  objectFit: "cover",
                  borderRadius: "4px",
                  border: "1px solid #999"
                }}
              />
            )}
          </div>
          <div style={{ width: 60, textAlign: "center" }}>{job.orderId}</div>
          <div style={{ width: 80, textAlign: "center" }}>{formatDateMMDD(job.date)}</div>
          <div style={{ width: 200, textAlign: "center" }}>{job.design}</div>
          <div style={{ width: 70, textAlign: "center" }}>{job.quantity}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job.product}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job.stage}</div>
          <div style={{ width: 80, textAlign: "center" }}>${job.price}</div>
          <div style={{ width: 90, textAlign: "center" }}>{formatDateMMDD(job.due)}</div>
        </div>
      ))}

      <div style={{ marginTop: "2rem" }}>
        <button onClick={handleShip} disabled={loading}>
          {loading ? "Shipping..." : "🚚 Ship"}
        </button>
        <button onClick={() => setSelected([])} style={{ marginLeft: "1rem" }}>
          Cancel
        </button>
      </div>

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
