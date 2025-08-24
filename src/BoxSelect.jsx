import React, { useMemo, useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// ---------- helpers (local copy) ----------
function formatDateMMDD(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.includes("-")
    ? dateStr.split("-")
    : dateStr.includes("/")
    ? dateStr.split("/")
    : [];
  if (parts.length !== 3) return dateStr;
  const [a, b, c] = parts.map((p) => parseInt(p, 10));
  if (dateStr.includes("-")) {
    return `${b.toString().padStart(2, "0")}/${c.toString().padStart(2, "0")}`;
  } else {
    return `${a.toString().padStart(2, "0")}/${b.toString().padStart(2, "0")}`;
  }
}

// ---------- box choices (sorted smallest → largest) ----------
const BOX_CHOICES = [
  { key: "10x10x10", L: 10, W: 10, H: 10, label: "10×10×10" },
  { key: "13x13x13", L: 13, W: 13, H: 13, label: "13×13×13" },
  { key: "14x7x5",   L: 14, W: 7,  H: 5,  label: "14×7×5"   },
  { key: "17x17x17", L: 17, W: 17, H: 17, label: "17×17×17" },
  { key: "17x20x20", L: 17, W: 20, H: 20, label: "17×20×20" },
];
const sortedChoices = [...BOX_CHOICES].sort(
  (a, b) => a.L * a.W * a.H - b.L * b.W * b.H
);

// ---------- static shipper (same as Ship.jsx) ----------
const SHIPPER = {
  Name: "JR & Co.",
  AttentionName: "Justin Eckard",
  Phone: "678-294-5350",
  Address: {
    AddressLine1: "3653 Lost Oak Drive",
    AddressLine2: "",
    City: "Buford",
    StateProvinceCode: "GA",
    PostalCode: "30519",
    CountryCode: "US",
  },
};

export default function BoxSelect() {
  const navigate = useNavigate();
  const location = useLocation();

  // Pull selected jobs from navigation state or sessionStorage fallback
  const navJobs = (location.state && location.state.selectedJobs) || null;
  const ssJobs = useMemo(() => {
    try {
      const raw = sessionStorage.getItem("ship:selectedJobs");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const selectedJobs = navJobs && Array.isArray(navJobs) && navJobs.length > 0
    ? navJobs
    : (Array.isArray(ssJobs) ? ssJobs : []);

  const [selectedBoxes, setSelectedBoxes] = useState([]); // {L,W,H,label}[]
  const [rates, setRates] = useState([]);
  const [error, setError] = useState("");

  // If we truly have no jobs, show a gentle message
  if (!selectedJobs || selectedJobs.length === 0) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Box Select</h2>
        <p>No jobs were provided. Go back to the Ship page and select jobs first.</p>
        <button onClick={() => navigate("/ship")}>← Back to Ship</button>
      </div>
    );
  }

  // Add a box to the "cart"
  const addBox = (choice) => {
    setSelectedBoxes((prev) => [...prev, choice]);
  };

  const removeBoxAt = (idx) => {
    setSelectedBoxes((prev) => prev.filter((_, i) => i !== idx));
  };

  // Build a recipient from a job row (using your Production Orders/Directory-like headers)
  const toRecipient = (row) => {
    const get = (obj, key) => (obj && obj[key] != null ? String(obj[key]).trim() : "");
    const toState = (s = "") => {
      const two = String(s).trim();
      return two.length === 2 ? two.toUpperCase() : two.toUpperCase();
    };
    const toZip5 = (v = "") => {
      const m = String(v).match(/(\d{5})/);
      return m ? m[1] : "";
    };
    return {
      Name: get(row, "Company Name") || get(row, "Company") || get(row, "Customer") || "Unknown",
      AttentionName: `${get(row, "Contact First Name")} ${get(row, "Contact Last Name")}`.trim(),
      Phone: get(row, "Phone Number") || get(row, "Phone") || "",
      Address: {
        AddressLine1: get(row, "Street Address 1") || get(row, "Address 1") || get(row, "Address") || "",
        AddressLine2: get(row, "Street Address 2") || get(row, "Address 2") || "",
        City: get(row, "City"),
        StateProvinceCode: toState(get(row, "State")),
        PostalCode: toZip5(get(row, "Zip Code") || get(row, "ZIP") || get(row, "Postal Code")),
        CountryCode: "US",
      },
    };
  };

  // POST rates when user clicks "Get Rates" (NOT automatically)
  const getRates = async () => {
    setError("");
    setRates([]);

    if (selectedBoxes.length === 0) {
      setError("Please add at least one box before getting rates.");
      return;
    }

    // Use the first selected job for address (typical single-destination shipment)
    const job0 = selectedJobs[0];
    const recipient = toRecipient(job0);

    // Minimal legacy-friendly payload (covers your backend’s 'name'/'addr1' expectations)
    const legacyPayload = {
      shipper: {
        name: SHIPPER.Name,
        attention: SHIPPER.AttentionName,
        phone: SHIPPER.Phone,
        addr1: SHIPPER.Address.AddressLine1,
        addr2: SHIPPER.Address.AddressLine2,
        city: SHIPPER.Address.City,
        state: SHIPPER.Address.StateProvinceCode,
        zip: SHIPPER.Address.PostalCode,
        country: SHIPPER.Address.CountryCode,
      },
      recipient: {
        name: recipient.Name,
        attention: recipient.AttentionName,
        phone: recipient.Phone,
        addr1: recipient.Address.AddressLine1,
        addr2: recipient.Address.AddressLine2,
        city: recipient.Address.City,
        state: recipient.Address.StateProvinceCode,
        zip: recipient.Address.PostalCode,
        country: recipient.Address.CountryCode,
      },
      packages: selectedBoxes.map((b) => ({
        packagingType: "02",
        weight: Math.max(1, Math.ceil((b.L * b.W * b.H) / 1728)), // ~1 lb / ft³
        length: b.L,
        width: b.W,
        height: b.H,
        dimUnit: "IN",
        weightUnit: "LB",
      })),
    };

    try {
      const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
      const url = `${API_BASE}/api/rate`; // your working endpoint
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyPayload),
      });
      const raw = await res.text();
      let body = null;
      try { body = JSON.parse(raw); } catch {}

      if (!res.ok) {
        const detail = (body && (body.error || body.message || body.detail)) || raw || `HTTP ${res.status}`;
        setError(`Rates request failed: ${detail}`);
        return;
      }

      const ratesArr = Array.isArray(body) ? body : (body?.rates || []);
      setRates(ratesArr);
    } catch (err) {
      setError(`Rates request error: ${err?.message || String(err)}`);
    }
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>Box Select</h2>

      {/* Selected jobs list (same visual style as Ship) */}
      <div style={{ display: "flex", fontWeight: "bold", padding: "0.5rem 1rem", borderBottom: "2px solid #333", marginBottom: "0.5rem", marginTop: "1rem", fontSize: "0.85rem" }}>
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

      {selectedJobs.map((job) => (
        <div
          key={job.orderId}
          style={{
            display: "flex",
            alignItems: "center",
            border: "1px solid #ccc",
            padding: "0.5rem 1rem",
            marginBottom: "0.3rem",
            borderRadius: "6px",
            backgroundColor: "#fff",
            color: "#000",
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
                  border: "1px solid #999",
                }}
              />
            )}
          </div>
          <div style={{ width: 60, textAlign: "center" }}>{job.orderId}</div>
          <div style={{ width: 80, textAlign: "center" }}>{formatDateMMDD(job["Date"])}</div>
          <div style={{ width: 200, textAlign: "center" }}>{job["Design"]}</div>
          <div style={{ width: 70, textAlign: "center" }}>{job["Quantity"] ?? job.shipQty ?? 0}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Product"]}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Stage"]}</div>
          <div style={{ width: 80, textAlign: "center" }}>${job["Price"]}</div>
          <div style={{ width: 90, textAlign: "center" }}>{formatDateMMDD(job["Due Date"])}</div>
        </div>
      ))}

      {/* Box buttons in one row */}
      <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {sortedChoices.map((c) => (
          <button
            key={c.key}
            onClick={() => addBox(c)}
            style={{
              padding: "12px 16px",
              border: "1px solid #333",
              borderRadius: 8,
              background: "#eee",
              cursor: "pointer",
              minWidth: 140,
            }}
            title={`Add ${c.label}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Selected box "cart" */}
      <div style={{ marginTop: "1rem" }}>
        <h4>Selected Boxes</h4>
        {selectedBoxes.length === 0 ? (
          <div style={{ color: "#555" }}>No boxes added yet.</div>
        ) : (
          <ul>
            {selectedBoxes.map((b, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <b>{b.label}</b>{" "}
                <button
                  onClick={() => removeBoxAt(i)}
                  style={{
                    marginLeft: 8,
                    padding: "2px 6px",
                    border: "1px solid #999",
                    borderRadius: 4,
                    background: "#fafafa",
                    cursor: "pointer",
                  }}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
        <button
          onClick={() => navigate("/ship")}
          style={{
            padding: "10px 14px",
            border: "1px solid #333",
            borderRadius: 8,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ← Back to Ship
        </button>

        <button
          onClick={getRates}
          style={{
            padding: "10px 14px",
            border: "1px solid #333",
            borderRadius: 8,
            background: "#000",
            color: "#fff",
            cursor: "pointer",
          }}
          title="Request live UPS rates for the selected boxes"
        >
          Get Rates
        </button>
      </div>

      {/* Errors + Rates */}
      {error && (
        <div style={{ marginTop: "1rem", color: "#a00", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      {rates.length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <h4>UPS Rates</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            {rates.map((r, idx) => (
              <div
                key={idx}
                style={{
                  border: "1px solid #333",
                  borderRadius: 8,
                  padding: "12px",
                  minWidth: 220,
                  background: "#f7f7f7",
                }}
              >
                <div style={{ fontWeight: "bold" }}>{r.method || r.service || "Service"}</div>
                <div>Price: {r.rate ?? r.price ?? "—"}</div>
                <div>ETA: {r.delivery || r.eta || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
