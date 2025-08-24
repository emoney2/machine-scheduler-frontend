import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// One-row box choices (click to add to cart)
const BOX_CHOICES = [
  { label: "10×10×10", L: 10, W: 10, H: 10, PackagingType: "02", Weight: 7  },
  { label: "13×13×13", L: 13, W: 13, H: 13, PackagingType: "02", Weight: 12 },
  { label: "17×17×17", L: 17, W: 17, H: 17, PackagingType: "02", Weight: 24 },
  { label: "17×20×20", L: 17, W: 20, H: 20, PackagingType: "02", Weight: 32 },
  { label: "14×7×5",   L: 14, W: 7,  H: 5,  PackagingType: "02", Weight: 4  },
];

// Try to rebuild selection from many sources
function useSelectedJobs() {
  const location = useLocation();
  const state = location.state || {};

  // 1) direct selected jobs passed in state
  if (Array.isArray(state.selectedJobs) && state.selectedJobs.length > 0) {
    return state.selectedJobs;
  }

  // 2) ids + snapshot passed in state
  if (Array.isArray(state.selectedIds) && Array.isArray(state.jobsSnapshot)) {
    const idSet = new Set(state.selectedIds.map(String));
    const list = state.jobsSnapshot.filter(j => idSet.has(String(j.orderId)));
    if (list.length > 0) return list;
  }

  // 3) sessionStorage: exact array of jobs
  try {
    const raw = sessionStorage.getItem("ship:selectedJobs");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch {}

  // 4) sessionStorage: object with { selected, jobs }
  const tryKeys = ["ship:selected", "ship.selected"];
  for (const key of tryKeys) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const blob = JSON.parse(raw);
      const ids = (blob && Array.isArray(blob.selected)) ? blob.selected : [];
      const all = (blob && Array.isArray(blob.jobs)) ? blob.jobs : [];
      if (ids.length && all.length) {
        const set = new Set(ids.map(String));
        const list = all.filter(j => set.has(String(j.orderId)));
        if (list.length > 0) return list;
      }
    } catch {}
  }

  return [];
}

export default function BoxSelect() {
  const navigate = useNavigate();
  const selectedJobs = useSelectedJobs();

  // cart holds each box as separate line item (allows multiple of same)
  const [cart, setCart] = useState([]);

  const addBox = (choice) => {
    setCart(prev => [
      ...prev,
      {
        size: choice.label,
        PackagingType: choice.PackagingType || "02",
        Weight: choice.Weight || 1,
        Dimensions: { Length: choice.L, Width: choice.W, Height: choice.H }
      }
    ]);
  };

  const removeBoxAt = (idx) => {
    setCart(prev => prev.filter((_, i) => i !== idx));
  };

  const totalBoxes = cart.length;

  if (!Array.isArray(selectedJobs) || selectedJobs.length === 0) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Box Select</h2>
        <p>No jobs were provided. Go back to the Ship page and select jobs first.</p>
        <button onClick={() => navigate("/ship")} style={{ padding: "10px 16px" }}>
          ← Back to Ship
        </button>
      </div>
    );
  }

  // Render
  return (
    <div style={{ padding: "2rem" }}>
      <h2>Box Select</h2>

      {/* Jobs header (match Ship layout widths) */}
      <div style={{ display: "flex", fontWeight: "bold", padding: "0.5rem 1rem", borderBottom: "2px solid #333", marginBottom: "0.5rem", marginTop: "1rem", fontSize: "0.85rem" }}>
        <div style={{ width: 60 }}></div>
        <div style={{ width: 60,  textAlign: "center" }}>#</div>
        <div style={{ width: 80,  textAlign: "center" }}>Date</div>
        <div style={{ width: 200, textAlign: "center" }}>Design</div>
        <div style={{ width: 70,  textAlign: "center" }}>Qty</div>
        <div style={{ width: 120, textAlign: "center" }}>Product</div>
        <div style={{ width: 120, textAlign: "center" }}>Stage</div>
        <div style={{ width: 80,  textAlign: "center" }}>Price</div>
        <div style={{ width: 90,  textAlign: "center" }}>Due</div>
      </div>

      {/* Jobs list (look like Ship rows) */}
      {selectedJobs.map(job => (
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
                style={{ width: "50px", height: "50px", objectFit: "cover", borderRadius: "4px", border: "1px solid #999" }}
              />
            )}
          </div>
          <div style={{ width: 60,  textAlign: "center" }}>{job.orderId}</div>
          <div style={{ width: 80,  textAlign: "center" }}>{job["Date"] || ""}</div>
          <div style={{ width: 200, textAlign: "center" }}>{job["Design"] || ""}</div>
          <div style={{ width: 70,  textAlign: "center" }}>{job.shipQty ?? job["Quantity"] ?? 0}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Product"] || ""}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Stage"] || ""}</div>
          <div style={{ width: 80,  textAlign: "center" }}>${job["Price"] || ""}</div>
          <div style={{ width: 90,  textAlign: "center" }}>{job["Due Date"] || ""}</div>
        </div>
      ))}

      {/* One-row box buttons */}
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem", flexWrap: "nowrap", overflowX: "auto", paddingBottom: "0.5rem" }}>
        {BOX_CHOICES.map((b) => (
          <button
            key={b.label}
            onClick={() => addBox(b)}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#eee",
              cursor: "pointer",
              whiteSpace: "nowrap",
              minWidth: 110
            }}
            title={`Add ${b.label} to cart`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Cart list */}
      <div style={{ marginTop: "1rem" }}>
        <h4>Selected Boxes ({totalBoxes})</h4>
        {totalBoxes === 0 ? (
          <p>No boxes selected yet. Click a size above to add boxes.</p>
        ) : (
          <ul>
            {cart.map((c, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <b>{c.size}</b>
                {" "}
                <button
                  onClick={() => removeBoxAt(i)}
                  style={{
                    marginLeft: 8,
                    padding: "2px 8px",
                    borderRadius: 6,
                    border: "1px solid #999",
                    background: "#fafafa",
                    cursor: "pointer"
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
      <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem" }}>
        <button
          onClick={() => navigate("/ship")}
          style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #333", background: "#fff", cursor: "pointer" }}
        >
          ← Back
        </button>

        <button
          onClick={() => {
            // Persist chosen boxes so Ship can use them (if/when wired)
            try {
              sessionStorage.setItem("boxselect:cart", JSON.stringify(cart));
            } catch {}
            // For now, just go back to Ship. You can have Ship read boxselect:cart and call fetchRates.
            navigate("/ship");
          }}
          disabled={totalBoxes === 0}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #333",
            background: totalBoxes === 0 ? "#ddd" : "#000",
            color: "#fff",
            cursor: totalBoxes === 0 ? "not-allowed" : "pointer"
          }}
          title={totalBoxes === 0 ? "Add at least one box" : "Save selection and return to Ship"}
        >
          Save Boxes & Return to Ship
        </button>
      </div>
    </div>
  );
}
