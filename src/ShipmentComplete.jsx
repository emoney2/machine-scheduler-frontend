// src/ShipmentComplete.jsx
import React, { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { postShipQboClientLog } from "./shipQboClientLog";

export default function ShipmentComplete() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { state } = location;
  const qi = (searchParams.get("qi") || "").trim();
  const qr = (searchParams.get("qr") || "").trim();

  const shippedOk     = state?.shippedOk     ?? false;
  const slipsPrinted  = state?.slipsPrinted  ?? false;
  const labelsPrinted = state?.labelsPrinted ?? false;

  // Prefer txnId + realm from this shipment (fixes wrong / new-invoice tabs). Else normalize backend URL.
  const invoiceUrl = useMemo(() => {
    const normalizeInvoiceUrl = (raw) => {
      const src = String(raw || "").trim();
      if (!src) return "";
      try {
        const u = new URL(src);
        const txnId = (u.searchParams.get("txnId") || "").trim();
        if (!txnId) return src;
        const company = (
          u.searchParams.get("deeplinkcompanyid") ||
          u.searchParams.get("companyId") ||
          ""
        ).trim();
        const q = new URLSearchParams();
        q.set("txnId", txnId);
        q.set("txnType", "Invoice");
        if (company) {
          q.set("deeplinkcompanyid", company);
          q.set("companyId", company);
        }
        let path = u.pathname.replace(/\/$/, "") || "/";
        if (/^\/app\/invoices$/i.test(path) || /^\/app\/invoicing$/i.test(path)) {
          path = "/app/invoice";
        }
        // Keep the same hostname the API used; forcing qbo.intuit.com can open a blank/new invoice for some sessions.
        const origin = u.origin;
        return `${origin}${path}?${q.toString()}`;
      } catch {
        return src;
      }
    };

    const buildFromTxnRealm = (txnId, realmId, hintUrl) => {
      const t = String(txnId || "").trim();
      const r = String(realmId || "").trim();
      if (!t || !r) return "";
      const hint = String(hintUrl || "").toLowerCase();
      const origin = hint.includes("sandbox") ? "https://app.sandbox.qbo.intuit.com" : "https://app.qbo.intuit.com";
      const q = new URLSearchParams();
      q.set("txnId", t);
      q.set("txnType", "Invoice");
      q.set("companyId", r);
      q.set("deeplinkcompanyid", r);
      return `${origin}/app/invoice?${q.toString()}`;
    };

    // Use txnId + company (realm) as a *pair* from one source. Mixing e.g. invoice id from
    // navigation state with an older realm from sessionStorage can open the wrong or blank QBO.
    // Query string qi/qr survive refresh; state does not.
    let txn = "";
    let realm = "";
    let hintFromState = "";
    try {
      const sid = String(state?.qbo_invoice_id ?? "").trim();
      const srealm = String(state?.qbo_realm_id ?? "").trim();
      if (qi && qr) {
        txn = qi;
        realm = qr;
        hintFromState = String(state?.invoiceUrl || "").trim();
      } else if (sid && srealm) {
        txn = sid;
        realm = srealm;
        hintFromState = String(state?.invoiceUrl || "").trim();
      } else {
        try {
          const blob = sessionStorage.getItem("jrco_lastShipmentQbo");
          if (blob) {
            const p = JSON.parse(blob);
            const a = String(p?.qbo_invoice_id ?? "").trim();
            const b = String(p?.qbo_realm_id ?? "").trim();
            if (a && b) {
              txn = a;
              realm = b;
              hintFromState = String(p?.invoiceUrl || "").trim();
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (!txn || !realm) {
        const stTxn = (sessionStorage.getItem("jrco_lastQboInvoiceId") || "").trim();
        const stRe = (sessionStorage.getItem("jrco_lastQboRealmId") || "").trim();
        if (stTxn && stRe) {
          txn = stTxn;
          realm = stRe;
          hintFromState = String(state?.invoiceUrl || "").trim();
        }
      }
    } catch {
      /* ignore */
    }
    const hint = hintFromState || (() => {
      try {
        return sessionStorage.getItem("jrco_lastInvoiceUrl") || "";
      } catch {
        return "";
      }
    })();
    if (txn && realm) {
      const rebuilt = buildFromTxnRealm(txn, realm, hint);
      if (rebuilt) {
        const normalized = normalizeInvoiceUrl(rebuilt);
        if (normalized) return normalized;
      }
    }

    const fromState = String(state?.invoiceUrl || "").trim();
    if (fromState) {
      const normalized = normalizeInvoiceUrl(fromState);
      if (normalized) return normalized;
    }

    try {
      return normalizeInvoiceUrl(sessionStorage.getItem("jrco_lastInvoiceUrl") || "");
    } catch {
      return "";
    }
  }, [location.key, state?.invoiceUrl, state?.qbo_invoice_id, state?.qbo_realm_id, qi, qr]);

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
        hasStateInvoice: !!(state?.invoiceUrl && String(state.invoiceUrl).trim()),
        resolvedInvoiceUrlLen: invoiceUrl.length,
        sessionStorageInvoiceLen: fromSession.trim().length,
        stateMatchesResolved:
          !!(state?.invoiceUrl && String(state.invoiceUrl).trim() === invoiceUrl),
      },
    ]);
  }, [invoiceUrl, location.key, state]);

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
              let txn = "";
              let company = "";
              let host = "";
              try {
                const u = new URL(invoiceUrl);
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
                  urlLength: invoiceUrl.length,
                },
              ]);
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
