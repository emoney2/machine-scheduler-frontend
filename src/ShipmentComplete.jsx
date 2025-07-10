// src/ShipmentComplete.jsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function ShipmentComplete() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const invoiceUrl    = state?.invoiceUrl    || "";
  const shippedOk     = state?.shippedOk     ?? false;
  const slipsPrinted  = state?.slipsPrinted  ?? false;
  const labelsPrinted = state?.labelsPrinted ?? false;

  const renderStatus = (ok, label) => (
    <li style={{ marginBottom: "0.75rem", fontSize: "1.1rem" }}>
      {ok ? "✅" : "❌"} {label}
    </li>
  );

  const handleViewEdit = () => {
    if (invoiceUrl) {
      window.open(invoiceUrl, "_blank");
    }
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
    <div
      style={{
        padding: "2rem",
        maxWidth: "500px",
        margin: "0 auto",
        fontFamily: "sans-serif",
      }}
    >
      <h2 style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        Shipment Summary
      </h2>
      <ul style={{ listStyle: "none", padding: 0, lineHeight: 1.6 }}>
        {renderStatus(shippedOk, "Order Marked Shipped")}
        {renderStatus(slipsPrinted,  "Packing Slips Generated")}
        {renderStatus(labelsPrinted, "Printed Shipping Labels")}
      </ul>

      <div style={{ marginTop: "2rem", textAlign: "center" }}>
        {invoiceUrl && (
          <button
            onClick={handleViewEdit}
            style={{ margin: "0.5rem", padding: "0.75rem 1.5rem", fontSize: "1rem" }}
          >
            View / Edit Invoice
          </button>
        )}
        <button
          onClick={handleSend}
          style={{ margin: "0.5rem", padding: "0.75rem 1.5rem", fontSize: "1rem" }}
        >
          Send Invoice
        </button>
      </div>

      <div style={{ textAlign: "center", marginTop: "2rem" }}>
        <button
          onClick={() => navigate("/")}
          style={{
            color: "#666",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          ← Back to Shipping
        </button>
      </div>
    </div>
  );
}
