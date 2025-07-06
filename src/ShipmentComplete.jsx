// src/ShipmentComplete.jsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function ShipmentComplete() {
  const navigate = useNavigate();
  const { state } = useLocation();
  // The full URL we passed via navigate()
  const invoiceUrl = state?.invoiceUrl || "";

  const handleViewEdit = () => {
    // Opens the QuickBooks invoice page
    window.open(invoiceUrl, "_blank");
  };

  const handleSend = async () => {
    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_ROOT}/send-invoice`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceUrl }),
        }
      );
      if (res.ok) {
        alert("Invoice emailed!");
      } else {
        alert("Failed to send invoice.");
      }
    } catch {
      alert("Network error sending invoice.");
    }
  };

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>✅ Shipment Complete!</h2>
      <button
        onClick={handleViewEdit}
        style={{ margin: "1rem", padding: "0.75rem 1.5rem", fontSize: "1rem" }}
      >
        View / Edit Invoice
      </button>
      <button
        onClick={handleSend}
        style={{ margin: "1rem", padding: "0.75rem 1.5rem", fontSize: "1rem" }}
      >
        Send Invoice
      </button>
      <br />
      <button
        onClick={() => navigate("/")}
        style={{
          marginTop: "2rem",
          color: "#666",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      >
        ← Back to Shipping
      </button>
    </div>
  );
}
