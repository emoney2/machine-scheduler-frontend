// File: frontend/src/Ship.jsx

import React, { useState, useEffect } from "react";

export default function Ship() {
  const [result, setResult] = useState(null);

  async function handleMissingVolumes(missingProducts) {
    for (let product of missingProducts) {
      let volume = prompt(`Enter volume in cubic inches for "${product}":`);

      if (!volume || isNaN(volume)) {
        alert(`Invalid input for ${product}. Please try again.`);
        return false;
      }

      // Send to backend
      const res = await fetch("https://machine-scheduler-backend.onrender.com/api/set-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ product, volume })
      });

      const json = await res.json();
      if (!res.ok) {
        alert(`Failed to update volume for ${product}: ${json.error}`);
        return false;
      }
    }

    return true;
  }

  async function prepareShipment(orderIds) {
    const response = await fetch("https://machine-scheduler-backend.onrender.com/api/prepare-shipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ order_ids: orderIds })
    });

    const result = await response.json();

    if (!response.ok && result.missing_products) {
      const filled = await handleMissingVolumes(result.missing_products);
      if (filled) {
        return await prepareShipment(orderIds); // retry
      } else {
        return null;
      }
    }

    return result;
  }

  useEffect(() => {
    // EXAMPLE: You can replace this with actual scanned orders
    prepareShipment(["9", "25"]).then(setResult);
  }, []);

  return (
    <div style={{ padding: "2rem" }}>
      <h2>Shipping Preview</h2>
      {result && result.boxes ? (
        <div>
          <p>✅ Boxes calculated:</p>
          <ul>
            {result.boxes.map((box, i) => (
              <li key={i}>
                📦 <b>{box.size}</b> → {box.jobs.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>Loading or missing volume...</p>
      )}
    </div>
  );
}
