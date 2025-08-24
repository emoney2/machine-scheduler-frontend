import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Format dates like Ship.jsx */
function formatDateMMDD(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.includes("-")
    ? dateStr.split("-")
    : dateStr.includes("/")
    ? dateStr.split("/")
    : [];

  if (parts.length !== 3) return dateStr;

  const [a, b, c] = parts.map((p) => parseInt(p));
  if (dateStr.includes("-")) {
    return `${b.toString().padStart(2, "0")}/${c.toString().padStart(2, "0")}`;
  } else {
    return `${a.toString().padStart(2, "0")}/${b.toString().padStart(2, "0")}`;
  }
}

/** The box presets you requested (single-row buttons) */
const BOX_CATALOG = [
  { label: "10×10×10", L: 10, W: 10, H: 10 },
  { label: "13×13×13", L: 13, W: 13, H: 13 },
  { label: "17×17×17", L: 17, W: 17, H: 17 },
  { label: "17×20×20", L: 17, W: 20, H: 20 },
  { label: "14×7×5",   L: 14, W: 7,  H: 5  },
];

/** Convert (L×W×H) to a rough shipping weight (≥1lb, 1 lb / cubic foot) */
function dimsToWeight(L, W, H) {
  const cubicFeet = (L * W * H) / 1728;
  return Math.max(1, Math.ceil(cubicFeet));
}

export default function BoxSelect() {
  const location = useLocation();
  const navigate = useNavigate();

  // Expect navigation from Ship.jsx like: navigate("/box-select", { state: { selected, jobs } })
  const selectedIds = useMemo(() => {
    const st = location.state || {};
    return (st.selected || st.selectedIds || []).map(String);
  }, [location.state]);

  const allJobs = useMemo(() => {
    const st = location.state || {};
    return st.jobs || st.jobsData || [];
  }, [location.state]);

  const selectedJobs = useMemo(() => {
    if (!Array.isArray(allJobs) || selectedIds.length === 0) return [];
    return allJobs.filter((j) =>
      selectedIds.includes(String(j.orderId ?? j.id ?? ""))
    );
  }, [allJobs, selectedIds]);

  // “Cart” of boxes you add by clicking the buttons
  const [selectedBoxes, setSelectedBoxes] = useState([]);
  // UPS options after clicking Get Rates
  const [shippingOptions, setShippingOptions] = useState([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [error, setError] = useState("");

  const addBox = (box) => {
    setSelectedBoxes((prev) => [...prev, { ...box }]);
  };

  const removeOne = (label) => {
    setSelectedBoxes((prev) => {
      const idx = prev.findIndex((b) => b.label === label);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy.splice(idx, 1);
      return copy;
    });
  };

  const removeAllOf = (label) =>
    setSelectedBoxes((prev) => prev.filter((b) => b.label !== label));

  const grouped = useMemo(() => {
    const m = new Map();
    selectedBoxes.forEach((b) => {
      m.set(b.label, (m.get(b.label) || 0) + 1);
    });
    return Array.from(m.entries()).map(([label, qty]) => ({ label, qty }));
  }, [selectedBoxes]);

  /** Build recipient (same headers you use on the sheet) */
  const buildRecipientFromFirstJob = () => {
    const j = selectedJobs[0] || {};
    const val = (k) => (j && j[k] != null ? String(j[k]).trim() : "");
    const toZip5 = (v = "") => {
      const m = String(v).match(/(\d{5})/);
      return m ? m[1] : "";
    };
    const toStateAbbr = (s = "") => {
      const t = String(s).trim();
      if (t.length === 2) return t.toUpperCase();
      // minimal name→abbr (extend if you need more)
      const MAP = { georgia: "GA" };
      return MAP[t.toLowerCase()] || t.toUpperCase();
    };

    return {
      Name: val("Company Name"),
      AttentionName: `${val("Contact First Name")} ${val("Contact Last Name")}`.trim(),
      Phone: val("Phone Number"),
      Address: {
        AddressLine1: val("Street Address 1"),
        AddressLine2: val("Street Address 2"),
        City: val("City"),
        StateProvinceCode: toStateAbbr(val("State")),
        PostalCode: toZip5(val("Zip Code")),
        CountryCode: "US",
      },
    };
  };

  /** Build UPS packages from the selectedBoxes cart */
  const buildPackages = () => {
    if (selectedBoxes.length === 0) return [];
    return selectedBoxes.map(({ L, W, H }) => ({
      PackagingType: "02",
      Weight: dimsToWeight(L, W, H),
      Dimensions: { Length: L, Width: W, Height: H },
    }));
  };

  /** Very simple “Get Rates” that tries /api/rate first; falls back to /rate */
  const handleGetRates = async () => {
    setError("");
    setShippingOptions([]);
    setLoadingRates(true);

    try {
      if (selectedJobs.length === 0) {
        setError("No jobs selected — go back and choose some jobs in Ship.");
        return;
      }
      const recipient = buildRecipientFromFirstJob();

      // Basic validation
      const miss = [];
      if (!recipient.Address.AddressLine1) miss.push("street");
      if (!recipient.Address.City) miss.push("city");
      if (!recipient.Address.StateProvinceCode || recipient.Address.StateProvinceCode.length !== 2) miss.push("state");
      if (!recipient.Address.PostalCode || recipient.Address.PostalCode.length !== 5) miss.push("zip");
      if (miss.length) {
        setError(`Recipient is missing: ${miss.join(", ")}`);
        return;
      }

      const packages = buildPackages();
      if (packages.length === 0) {
        setError("Add at least one box before getting rates.");
        return;
      }

      const shipper = {
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

      const API_ROOT = process.env.REACT_APP_API_ROOT;
      const API_BASE = API_ROOT.replace(/\/api$/, "");
      const candidateUrls = [
        `${API_ROOT}/rate`,
        `${API_BASE}/api/rate`,
        `${API_BASE}/ups/rate`,
      ];

      let options = null;
      let lastErr = "";

      for (const url of candidateUrls) {
        try {
          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shipper, recipient, packages }),
          });
          const txt = await res.text();
          let body = null;
          try {
            body = JSON.parse(txt);
          } catch {
            body = null;
          }

          if (!res.ok) {
            lastErr = body?.error || body?.message || txt || `HTTP ${res.status}`;
            continue;
          }

          options = Array.isArray(body) ? body : body?.rates || [];
          break;
        } catch (e) {
          lastErr = e?.message || String(e);
        }
      }

      if (!options || options.length === 0) {
        setError(lastErr || "No rates returned.");
        return;
      }

      setShippingOptions(options);
    } finally {
      setLoadingRates(false);
    }
  };

  if (selectedJobs.length === 0) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Box Select</h2>
        <p>No jobs were provided. Go back to the Ship page and select jobs first.</p>
        <button onClick={() => navigate("/ship")}>← Back to Ship</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem" }}>
      <h2>📦 Box Select</h2>

      {/* Jobs list (same look as Ship) */}
      <div
        style={{
          display: "flex",
          fontWeight: "bold",
          padding: "0.5rem 1rem",
          borderBottom: "2px solid #333",
          marginBottom: "0.5rem",
          marginTop: "1rem",
          fontSize: "0.85rem",
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
            backgroundColor: "#4CAF50",
            color: "#fff",
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
          <div style={{ width: 80, textAlign: "center" }}>
            {formatDateMMDD(job["Date"])}
          </div>
          <div style={{ width: 200, textAlign: "center" }}>{job["Design"]}</div>
          <div style={{ width: 70, textAlign: "center" }}>
            {job.shipQty ?? job["Quantity"] ?? 0}
          </div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Product"]}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Stage"]}</div>
          <div style={{ width: 80, textAlign: "center" }}>${job["Price"]}</div>
          <div style={{ width: 90, textAlign: "center" }}>
            {formatDateMMDD(job["Due Date"])}
          </div>
        </div>
      ))}

      {/* One-row (scrollable) box buttons */}
      <h3 style={{ marginTop: "1.5rem" }}>Choose Boxes</h3>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          whiteSpace: "nowrap",
          overflowX: "auto",
          paddingBottom: "0.5rem",
          borderBottom: "1px dashed #ccc",
        }}
      >
        {BOX_CATALOG.map((b) => (
          <button
            key={b.label}
            onClick={() => addBox(b)}
            style={{
              flex: "0 0 auto",
              padding: "0.75rem 1rem",
              border: "1px solid #333",
              borderRadius: 8,
              background: "#eee",
              cursor: "pointer",
              minWidth: 120,
            }}
            title="Add this box"
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Selected boxes list below the buttons */}
      <div style={{ marginTop: "1rem" }}>
        <h4>Selected Boxes</h4>
        {grouped.length === 0 ? (
          <div style={{ color: "#555" }}>No boxes added yet.</div>
        ) : (
          <ul style={{ listStyle: "none", paddingLeft: 0 }}>
            {grouped.map(({ label, qty }) => (
              <li
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.35rem",
                }}
              >
                <strong>{label}</strong>
                <span>× {qty}</span>
                <button onClick={() => removeOne(label)}>−1</button>
                <button onClick={() => removeAllOf(label)}>Remove all</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <button onClick={() => navigate("/ship")}>← Back to Ship</button>
        <button
          onClick={handleGetRates}
          disabled={loadingRates}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: "bold",
            borderRadius: "999px",
            border: "1px solid #333",
            background: "#000",
            color: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            cursor: "pointer",
          }}
        >
          {loadingRates ? "Getting rates…" : "Get Rates"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            border: "1px solid #d33",
            background: "#ffe9e9",
            borderRadius: 8,
          }}
        >
          <strong style={{ color: "#900" }}>Error:</strong> {error}
        </div>
      )}

      {/* Rate options */}
      {shippingOptions.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h4>UPS Options</h4>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {shippingOptions.map((opt, i) => (
              <button
                key={i}
                style={{
                  backgroundColor: "#eee",
                  color: "#000",
                  padding: "1rem",
                  minWidth: "220px",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  textAlign: "left",
                  lineHeight: "1.4",
                }}
                onClick={() => {
                  // choose and go back; you can extend to pass this choice to Ship if you like
                  navigate("/ship", {
                    state: {
                      selected: selectedIds,
                      manualBoxes: selectedBoxes,
                      selectedRate: opt,
                    },
                  });
                }}
              >
                <div style={{ fontWeight: "bold" }}>{opt.method || opt.service || "UPS"}</div>
                <div style={{ fontSize: "0.9rem" }}>Price: {opt.rate}</div>
                <div style={{ fontSize: "0.85rem", color: "#333" }}>
                  Est. delivery: {opt.delivery || ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
