// src/ShipmentComplete.jsx
import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { postShipQboClientLog } from "./shipQboClientLog";

/** QBO sales invoices list — reliable target vs per-invoice deeplinks. */
export const QBO_OPEN_INVOICES_URL =
  "https://qbo.intuit.com/app/invoices?jobId=sales-payments";

export default function ShipmentComplete() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = location;

  useEffect(() => {
    postShipQboClientLog([
      {
        message: "shipment_complete_mount",
        openInvoicesUrl: QBO_OPEN_INVOICES_URL,
      },
    ]);
  }, [location.key]);

  function mergedShipmentFlags(navState) {
    let shippedOk = navState?.shippedOk ?? false;
    let slipsPrinted = navState?.slipsPrinted ?? false;
    let labelsPrinted = navState?.labelsPrinted ?? false;
    try {
      const raw = sessionStorage.getItem("jrco_lastShipmentCompleteSummary");
      if (!raw) return { shippedOk, slipsPrinted, labelsPrinted };
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return { shippedOk, slipsPrinted, labelsPrinted };
      if (typeof p.shippedOk === "boolean") shippedOk = shippedOk || p.shippedOk;
      if (typeof p.slipsPrinted === "boolean") slipsPrinted = slipsPrinted || p.slipsPrinted;
      if (typeof p.labelsPrinted === "boolean") labelsPrinted = labelsPrinted || p.labelsPrinted;
    } catch {
      /* ignore */
    }
    return { shippedOk, slipsPrinted, labelsPrinted };
  }

  const { shippedOk, slipsPrinted, labelsPrinted } = mergedShipmentFlags(state);

  const handleOpenInvoice = () => {
    postShipQboClientLog([
      {
        message: "open_invoice_click",
        openInvoicesUrl: QBO_OPEN_INVOICES_URL,
      },
    ]);
    window.open(QBO_OPEN_INVOICES_URL, "_blank", "noopener,noreferrer");
  };

  const renderStatus = (ok, label) => (
    <li style={{ marginBottom: "0.75rem", fontSize: "1.1rem" }}>
      <span aria-hidden="true">{ok ? "\u2705" : "\u274C"}</span> {label}
    </li>
  );

  const canOpenInvoice = shippedOk;
  const openBtnStyle = {
    margin: "0.5rem",
    padding: "0.75rem 1.5rem",
    fontSize: "1rem",
    display: "inline-block",
    textDecoration: "none",
    borderRadius: 4,
    color: "#fff",
    backgroundColor: canOpenInvoice ? "#0d6efd" : "#6c757d",
    border: "1px solid transparent",
    cursor: canOpenInvoice ? "pointer" : "not-allowed",
    opacity: canOpenInvoice ? 1 : 0.55,
    pointerEvents: canOpenInvoice ? "auto" : "none",
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
        {renderStatus(slipsPrinted, "Packing Slips Generated")}
        {renderStatus(shippedOk, "Invoice Created")}
      </ul>

      <div style={{ marginTop: "2rem", textAlign: "center" }}>
        {canOpenInvoice ? (
          <a
            href={QBO_OPEN_INVOICES_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              handleOpenInvoice();
            }}
            style={openBtnStyle}
          >
            Open Invoice
          </a>
        ) : (
          <button type="button" disabled style={openBtnStyle}>
            Open Invoice
          </button>
        )}
      </div>

      <div style={{ textAlign: "center", marginTop: "2rem" }}>
        <button
          type="button"
          onClick={() => navigate("/")}
          style={{
            color: "#666",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          {"\u2190"} Back to Shipping
        </button>
      </div>
    </div>
  );
}
