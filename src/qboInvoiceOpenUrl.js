/**
 * Build a QuickBooks invoice deeplink and resolve it from navigation state / session storage.
 * Used by ShipmentComplete so "Open Invoice" works on the first shipment (not only after a retry).
 */

export function buildQboInvoiceOpenUrl(txnId, realmId, qeHint, invoiceUrlHint) {
  const t = String(txnId || "").trim();
  const r = String(realmId || "").trim();
  if (!t || !r) return "";
  const qev = String(qeHint || "").trim().toLowerCase();
  let origin;
  if (qev === "sandbox") {
    origin = "https://app.sandbox.qbo.intuit.com";
  } else if (qev === "production") {
    origin = "https://app.qbo.intuit.com";
  } else {
    const hint = String(invoiceUrlHint || "").toLowerCase();
    origin = hint.includes("sandbox")
      ? "https://app.sandbox.qbo.intuit.com"
      : "https://app.qbo.intuit.com";
  }
  const q = new URLSearchParams();
  q.set("txnId", t);
  q.set("txnType", "Invoice");
  q.set("companyId", r);
  q.set("deeplinkcompanyid", r);
  return `${origin}/app/invoice?${q.toString()}`;
}

export function parseTxnRealmFromInvoiceUrl(raw) {
  const src = String(raw || "").trim();
  if (!src) return { txnId: "", realmId: "" };
  try {
    const u = new URL(src);
    return {
      txnId: (u.searchParams.get("txnId") || "").trim(),
      realmId: (
        u.searchParams.get("deeplinkcompanyid") ||
        u.searchParams.get("companyId") ||
        ""
      ).trim(),
    };
  } catch {
    return { txnId: "", realmId: "" };
  }
}

export function normalizeQboInvoiceUrl(raw) {
  const src = String(raw || "").trim();
  if (!src) return "";
  try {
    const u = new URL(src);
    const txnId = (u.searchParams.get("txnId") || "").trim();
    if (!txnId) return "";
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
    return `${u.origin}${path}?${q.toString()}`;
  } catch {
    return "";
  }
}

function readSessionJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readSessionString(key) {
  try {
    return (sessionStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function deeplinkMatchesTxnRealm(dl, txnId, realmId) {
  if (!txnId || !realmId) return true;
  try {
    const u = new URL(dl);
    const tx = (u.searchParams.get("txnId") || "").trim();
    const co = (
      u.searchParams.get("companyId") ||
      u.searchParams.get("deeplinkcompanyid") ||
      ""
    ).trim();
    return tx === txnId && co === realmId;
  } catch {
    return false;
  }
}

/**
 * Resolve the invoice URL to open. Prefer qi/qr from this shipment's query string, then
 * navigation state, then session keys written by persistShipmentCompleteQbo.
 */
export function resolveShipmentInvoiceUrl({ qi, qr, qeParam, state }) {
  let qeEffective = qeParam === "sandbox" || qeParam === "production" ? qeParam : "";
  if (!qeEffective) {
    const stE = String(state?.qbo_invoice_env || "").trim().toLowerCase();
    if (stE === "sandbox" || stE === "production") qeEffective = stE;
  }
  if (!qeEffective) {
    const blob = readSessionJson("jrco_lastShipmentQbo");
    const qev = String(blob?.qbo_invoice_env || "").trim().toLowerCase();
    if (qev === "sandbox" || qev === "production") qeEffective = qev;
  }

  const hintFromState = String(state?.invoiceUrl || "").trim();

  let txn = String(qi || "").trim();
  let realm = String(qr || "").trim();

  if (!txn || !realm) {
    const sid = String(state?.qbo_invoice_id ?? "").trim();
    const srealm = String(state?.qbo_realm_id ?? "").trim();
    if (sid && srealm) {
      txn = sid;
      realm = srealm;
    }
  }

  if (!txn || !realm) {
    const blob = readSessionJson("jrco_lastShipmentQbo");
    const a = String(blob?.qbo_invoice_id ?? "").trim();
    const b = String(blob?.qbo_realm_id ?? "").trim();
    if (a && b) {
      txn = a;
      realm = b;
    }
  }

  if (!txn || !realm) {
    const stTxn = readSessionString("jrco_lastQboInvoiceId");
    const stRe = readSessionString("jrco_lastQboRealmId");
    if (stTxn && stRe) {
      txn = stTxn;
      realm = stRe;
    }
  }

  if (!txn || !realm) {
    const fromInv = parseTxnRealmFromInvoiceUrl(
      hintFromState || readSessionString("jrco_lastInvoiceUrl")
    );
    if (fromInv.txnId) txn = fromInv.txnId;
    if (fromInv.realmId) realm = fromInv.realmId;
  }

  if (txn && realm) {
    const rebuilt = buildQboInvoiceOpenUrl(txn, realm, qeEffective, hintFromState);
    const normalized = normalizeQboInvoiceUrl(rebuilt);
    if (normalized) return normalized;
  }

  const dl = readSessionString("jrco_lastInvoiceDeeplink");
  if (dl && /^https:\/\//i.test(dl) && deeplinkMatchesTxnRealm(dl, txn, realm)) {
    const normalizedDl = normalizeQboInvoiceUrl(dl);
    if (normalizedDl) return normalizedDl;
  }

  if (hintFromState) {
    const normalized = normalizeQboInvoiceUrl(hintFromState);
    if (normalized) return normalized;
  }

  const nu = normalizeQboInvoiceUrl(readSessionString("jrco_lastInvoiceUrl"));
  if (nu) return nu;

  return "";
}
