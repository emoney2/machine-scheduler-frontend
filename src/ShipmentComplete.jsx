// src/ShipmentComplete.jsx
import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { postShipQboClientLog } from "./shipQboClientLog";
import { resolveShipmentInvoiceUrl } from "./qboInvoiceOpenUrl";

export default function ShipmentComplete() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { state } = location;
  const qi = (searchParams.get("qi") || "").trim();
  const qr = (searchParams.get("qr") || "").trim();
  const qeParam = (searchParams.get("qe") || "").trim().toLowerCase();

  const [invoiceUrl, setInvoiceUrl] = useState("");
  const [resolvingInvoice, setResolvingInvoice] = useState(true);

  const resolveNow = useCallback(() => {
    return resolveShipmentInvoiceUrl({ qi, qr, qeParam, state });
  }, [qi, qr, qeParam, state]);

  useEffect(() => {
    let cancelled = false;
    const delays = [0, 50, 150, 400, 800, 1200];
    const timers = [];
    setResolvingInvoice(true);

    delays.forEach((ms, index) => {
      const timer = setTimeout(() => {
        if (cancelled) return;
        const url = resolveNow();
        if (url) {
          setInvoiceUrl(url);
          setResolvingInvoice(false);
        } else if (index === delays.length - 1) {
          setResolvingInvoice(false);
        }
      }, ms);
      timers.push(timer);
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [location.key, resolveNow]);

  useEffect(() => {
    let fromSession = "";
    try {
      fromSession = sessionStorage.getItem("jrco_lastInvoiceUrl") || "";
    } catch {
      fromSession = "";
    }
    postShipQboClientLog([
      {
        message: "shipment_complete_mount",
        qi_present: !!qi,
        qr_present: !!qr,
        qe_param: qeParam || null,
        resolvedInvoiceUrlLen: invoiceUrl.length,
        sessionStorageInvoiceLen: fromSession.trim().length,
      },
    ]);
  }, [invoiceUrl, location.key, qi, qr, qeParam]);

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

  const handleOpenInvoice = (e) => {
    const url = resolveNow() || invoiceUrl;
    if (!url) {
      e.preventDefault();
      return;
    }
    if (url !== invoiceUrl) {
      setInvoiceUrl(url);
    }
    let txn = "";
    let company = "";
    let host = "";
    try {
      const u = new URL(url);
      host = u.hostname || "";
      txn = u.searchParams.get("txnId") || "";
      company =
        u.searchParams.get("companyId") ||
        u.searchParams.get("deeplinkcompanyid") ||
        "";
    } catch {
      /* ignore */
    }
    postShipQboClientLog([
      {
        message: "open_invoice_click",
        qi_present: !!qi,
        qr_present: !!qr,
        invoiceHost: host,
        txnId: txn,
        companyId_param: company,
        urlLength: url.length,
      },
    ]);
    if (e.currentTarget.getAttribute("href") !== url) {
      e.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const renderStatus = (ok, label) => (
    <li style={{ marginBottom: "0.75rem", fontSize: "1.1rem" }}>
      <span aria-hidden="true">{ok ? "\u2705" : "\u274C"}</span> {label}
    </li>
  );

  const canOpenInvoice = !!invoiceUrl;
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
        {renderStatus(canOpenInvoice, "Invoice Created")}
      </ul>

      <div style={{ marginTop: "2rem", textAlign: "center" }}>
        {canOpenInvoice ? (
          <a
            href={invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleOpenInvoice}
            style={openBtnStyle}
          >
            Open Invoice
          </a>
        ) : (
          <button type="button" disabled style={openBtnStyle}>
            {resolvingInvoice ? "Loading invoice..." : "Open Invoice"}
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

