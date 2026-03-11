// src/ShipmentComplete.jsx
import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function ShipmentComplete() {
  const navigate = useNavigate();
  const { state } = useLocation();

  const shippedOk     = state?.shippedOk     ?? false;
  const slipsPrinted  = state?.slipsPrinted  ?? false;
  const labelsPrinted = state?.labelsPrinted ?? false;

  // Prefer state.invoiceUrl (the invoice we just created this run); use sessionStorage only when state is missing (e.g. page refresh)
  const invoiceUrl = useMemo(() => {
    const fromState = (state?.invoiceUrl || "").trim();
    if (fromState) return fromState;
    try {
      return (sessionStorage.getItem("jrco_lastInvoiceUrl") || "").trim();
    } catch {
      return "";
    }
  }, [state]);

  const renderStatus = (ok, label) => (
    <li style={{ marginBottom: "0.75rem", fontSize: "1.1rem" }}>
      {ok ? "✅" : "❌"} {label}
    </li>
  );

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
        {renderStatus(slipsPrinted, "Packing Slips Generated")}
        {renderStatus(!!invoiceUrl, "Invoice Created")}
      </ul>

      <div style={{ marginTop: "2rem", textAlign: "center" }}>
        <button
          type="button"
          onClick={() => {
            if (invoiceUrl) {
              window.open(invoiceUrl, "_blank", "noopener,noreferrer");
            }
          }}
          disabled={!invoiceUrl}
          className="btn btn-primary"
          style={{ margin: "0.5rem", padding: "0.75rem 1.5rem", fontSize: "1rem" }}
        >
          Open Invoice
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
