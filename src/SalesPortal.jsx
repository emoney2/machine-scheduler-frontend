import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");

function money(x) {
  const n = parseFloat(x);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function owedAmount(repBucket) {
  if (!repBucket) return 0;
  return repBucket.commission ?? repBucket.owed ?? 0;
}

const tableWrap = { overflowX: "auto", border: "1px solid #ddd", borderRadius: 6 };
const thStyle = { padding: 8, background: "#f5f5f5", textAlign: "left" };
const tdStyle = { padding: 8 };

function PipelineTable({ rows }) {
  if (!rows?.length) {
    return (
      <p style={{ color: "#666", fontSize: "0.88rem", margin: "0.5rem 0" }}>
        No open orders in production for this rep.
      </p>
    );
  }
  return (
    <div style={tableWrap}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
        <thead>
          <tr>
            <th style={thStyle}>Order #</th>
            <th style={thStyle}>Company</th>
            <th style={thStyle}>Design</th>
            <th style={thStyle}>Product</th>
            <th style={thStyle}>Qty</th>
            <th style={thStyle}>Est. sales</th>
            <th style={thStyle}>Est. commission</th>
            <th style={thStyle}>Stage</th>
            <th style={thStyle}>Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.orderId} style={{ borderTop: "1px solid #eee" }}>
              <td style={tdStyle}>{r.orderId}</td>
              <td style={tdStyle}>{r.company || "—"}</td>
              <td style={tdStyle}>{r.design || "—"}</td>
              <td style={tdStyle}>{r.product || "—"}</td>
              <td style={tdStyle}>{r.quantity ?? "—"}</td>
              <td style={tdStyle}>{money(r.estimatedSubtotal)}</td>
              <td style={tdStyle}>{money(r.estimatedCommission)}</td>
              <td style={tdStyle}>{r.stage || "—"}</td>
              <td style={tdStyle}>{r.dueDate || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommissionTable({ rows, showCheckboxes, selectedInvoices, onToggle }) {
  if (!rows?.length) {
    return (
      <p style={{ color: "#666", fontSize: "0.88rem", margin: "0.5rem 0" }}>
        No invoiced commission rows yet. Rows are added when orders ship and a QuickBooks invoice is created.
      </p>
    );
  }
  return (
    <div style={tableWrap}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
        <thead>
          <tr>
            {showCheckboxes ? <th style={thStyle} /> : null}
            <th style={thStyle}>Order #s</th>
            <th style={thStyle}>Invoice #</th>
            <th style={thStyle}>Product subtotal</th>
            <th style={thStyle}>Commission</th>
            <th style={thStyle}>Customer paid</th>
            <th style={thStyle}>Invoice paid</th>
            <th style={thStyle}>Rep pay due</th>
            <th style={thStyle}>Rep paid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const id = String(r["Invoice QBO Id"] || "").trim();
            const cust = String(r["Customer paid"] || "").toUpperCase();
            const rp = String(r["Rep paid"] || "").toUpperCase();
            const canSelect = showCheckboxes && cust === "Y" && rp !== "Y";
            return (
              <tr key={`${id}-${i}`} style={{ borderTop: "1px solid #eee" }}>
                {showCheckboxes ? (
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {canSelect ? (
                      <input
                        type="checkbox"
                        checked={selectedInvoices?.has(id)}
                        onChange={() => onToggle(id)}
                        aria-label={`Select invoice ${id}`}
                      />
                    ) : null}
                  </td>
                ) : null}
                <td style={tdStyle}>{r["Order #s"]}</td>
                <td style={tdStyle}>{r["Invoice #"]}</td>
                <td style={tdStyle}>{money(r["Product subtotal"])}</td>
                <td style={tdStyle}>{money(r["Commission $"])}</td>
                <td style={tdStyle}>{r["Customer paid"]}</td>
                <td style={tdStyle}>{r["Invoice paid date"] || "—"}</td>
                <td style={tdStyle}>{r["Rep pay due"] || "—"}</td>
                <td style={tdStyle}>{r["Rep paid"]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCards({ owed, pipelineCommission, pipelineCount, invoiceCount }) {
  const card = {
    flex: "1 1 160px",
    padding: "0.75rem 1rem",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    background: "#fafafa",
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "1rem 0" }}>
      <div style={card}>
        <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase" }}>Owed to rep</div>
        <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{money(owed)}</div>
        <div style={{ fontSize: "0.8rem", color: "#666" }}>Customer paid QBO; rep not paid</div>
      </div>
      <div style={card}>
        <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase" }}>In progress (est.)</div>
        <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{money(pipelineCommission)}</div>
        <div style={{ fontSize: "0.8rem", color: "#666" }}>{pipelineCount} open order{pipelineCount === 1 ? "" : "s"}</div>
      </div>
      <div style={card}>
        <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase" }}>Invoiced</div>
        <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{invoiceCount}</div>
        <div style={{ fontSize: "0.8rem", color: "#666" }}>Shipped / commission ledger</div>
      </div>
    </div>
  );
}

export default function SalesPortal() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commissionRows, setCommissionRows] = useState([]);
  const [pipelineOrders, setPipelineOrders] = useState([]);
  const [owed, setOwed] = useState(0);
  const [pipelineCommission, setPipelineCommission] = useState(0);
  const [summaryByRep, setSummaryByRep] = useState({});
  const [selectedInvoices, setSelectedInvoices] = useState(() => new Set());

  const applyRepPayload = (data) => {
    setCommissionRows(data.commissionRows || data.rows || []);
    setPipelineOrders(data.pipelineOrders || []);
    setOwed(data.owed ?? 0);
    setPipelineCommission(data.pipelineCommission ?? 0);
  };

  const applyAdminPayload = (data) => {
    setSummaryByRep(data.summaryByRep || {});
    setCommissionRows(data.commissionRows || data.rows || []);
    setPipelineOrders(data.pipelineOrders || []);
  };

  const refreshSession = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_ROOT}/sales/session`, {
        withCredentials: true,
      });
      setSession(data.loggedIn ? data : null);
      return data.loggedIn ? data : null;
    } catch {
      setSession(null);
      return null;
    }
  }, []);

  const loadRepData = async () => {
    const { data } = await axios.get(`${API_ROOT}/sales/me`, { withCredentials: true });
    applyRepPayload(data);
  };

  const loadAdminData = async () => {
    const { data } = await axios.get(`${API_ROOT}/sales/admin/ledger`, {
      withCredentials: true,
    });
    applyAdminPayload(data);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const s = await refreshSession();
      if (cancelled) return;
      try {
        if (s?.role === "rep" && s.repName) {
          await loadRepData();
        } else if (s?.role === "admin") {
          await loadAdminData();
        }
      } catch (e) {
        setError(e.response?.data?.error || "Failed to load sales data");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await axios.post(
        `${API_ROOT}/sales/login`,
        { username, password },
        { withCredentials: true }
      );
      setPassword("");
      const s = await refreshSession();
      if (s?.role === "rep" && s.repName) await loadRepData();
      else if (s?.role === "admin") await loadAdminData();
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  };

  const handleLogout = async () => {
    await axios.post(`${API_ROOT}/sales/logout`, {}, { withCredentials: true });
    setSession(null);
    setCommissionRows([]);
    setPipelineOrders([]);
    setOwed(0);
    setPipelineCommission(0);
    setSummaryByRep({});
    setSelectedInvoices(new Set());
  };

  const toggleInvoice = (id) => {
    const k = String(id || "").trim();
    if (!k) return;
    setSelectedInvoices((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const markRepPaid = async () => {
    const ids = [...selectedInvoices];
    if (!ids.length) {
      alert("Select at least one paid invoice (checkbox).");
      return;
    }
    try {
      const { data } = await axios.post(
        `${API_ROOT}/sales/admin/mark-paid`,
        { invoiceQboIds: ids },
        { withCredentials: true }
      );
      alert(`Updated ${data.updated || 0} row(s).`);
      setSelectedInvoices(new Set());
      await loadAdminData();
    } catch (err) {
      alert(err.response?.data?.error || "Mark paid failed");
    }
  };

  const repSections = Object.entries(summaryByRep).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  if (loading) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ maxWidth: 420, margin: "2rem auto", fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: "1.35rem" }}>Sales portal</h1>
        <p style={{ color: "#555", fontSize: "0.95rem" }}>
          Sign in with credentials configured in Render (<code>SALES_PORTAL_USERS</code>).
        </p>
        {error ? (
          <p style={{ color: "crimson", fontSize: "0.9rem" }}>{error}</p>
        ) : null}
        <form onSubmit={handleLogin} style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              style={{ width: "100%", padding: "0.4rem", marginTop: 4 }}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{ width: "100%", padding: "0.4rem", marginTop: 4 }}
            />
          </label>
          <button type="submit" style={{ padding: "0.5rem 1rem", marginTop: 8 }}>
            Sign in
          </button>
        </form>
      </div>
    );
  }

  if (session.role === "rep") {
    return (
      <div style={{ padding: "1rem 1.5rem 2rem", fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: "1.35rem" }}>Sales — {session.repName || session.username}</h1>
          <button type="button" onClick={handleLogout} style={{ padding: "0.35rem 0.75rem" }}>
            Sign out
          </button>
        </div>
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          Commission is 12% of product sales (excludes shipping, tax, and fees). Open orders show
          estimated commission; shipped orders use the QuickBooks invoice. Customer payment status
          syncs from QuickBooks on the scheduled cron job.
        </p>
        {error ? <p style={{ color: "crimson", fontSize: "0.9rem" }}>{error}</p> : null}
        <SummaryCards
          owed={owed}
          pipelineCommission={pipelineCommission}
          pipelineCount={pipelineOrders.length}
          invoiceCount={commissionRows.length}
        />
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>Orders in progress</h2>
        <PipelineTable rows={pipelineOrders} />
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Invoiced / commission</h2>
        <CommissionTable rows={commissionRows} />
      </div>
    );
  }

  const totalOwed = repSections.reduce((s, [, v]) => s + owedAmount(v), 0);

  return (
    <div style={{ padding: "1rem 1.5rem 2rem", fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: "1.35rem" }}>Sales — Admin</h1>
        <button type="button" onClick={handleLogout} style={{ padding: "0.35rem 0.75rem" }}>
          Sign out
        </button>
      </div>
      <p style={{ color: "#555", fontSize: "0.9rem" }}>
        <strong>Owed to reps</strong> ({money(totalOwed)} total) = commission on invoices where the
        customer has paid QuickBooks and you have not marked the rep paid. In-progress orders show
        estimated commission until they ship.
      </p>
      {error ? <p style={{ color: "crimson", fontSize: "0.9rem" }}>{error}</p> : null}
      <details style={{ fontSize: "0.82rem", color: "#666", marginBottom: 12 }}>
        <summary style={{ cursor: "pointer" }}>QuickBooks sync setup</summary>
        <p style={{ marginTop: 8 }}>
          Render cron: <code>POST /api/sales/cron/sync-qbo</code> with header{" "}
          <code>X-Sales-Cron-Secret</code>. Set <code>QBO_TOKEN_JSON</code> on the web service to match{" "}
          <code>qbo_token.json</code>.
        </p>
      </details>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={markRepPaid} style={{ padding: "0.4rem 0.9rem" }}>
          Mark selected rep-paid
        </button>
      </div>
      {repSections.length === 0 ? (
        <p style={{ color: "#666" }}>
          No rep orders found. Assign REP on Production Orders (column AQ) for orders that belong to a
          sales rep.
        </p>
      ) : (
        repSections.map(([rep, v]) => {
          const pipeline = v.pipelineOrders || [];
          const invoices = v.commissionRows || v.rows || [];
          const owedRep = owedAmount(v);
          const pipeEst = v.pipelineCommission ?? 0;
          return (
            <section key={rep} style={{ marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "1px solid #eee" }}>
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 0.35rem" }}>{rep}</h3>
              <p style={{ margin: "0 0 0.75rem", color: "#555", fontSize: "0.88rem" }}>
                <strong>{money(owedRep)}</strong> owed ·{" "}
                <strong>{money(pipeEst)}</strong> est. in progress ({pipeline.length} order
                {pipeline.length === 1 ? "" : "s"}) · {invoices.length} invoiced
              </p>
              <h4 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.35rem" }}>In progress</h4>
              <PipelineTable rows={pipeline} />
              <h4 style={{ fontSize: "0.95rem", margin: "1rem 0 0.35rem" }}>Invoiced / commission</h4>
              <CommissionTable
                rows={invoices}
                showCheckboxes
                selectedInvoices={selectedInvoices}
                onToggle={toggleInvoice}
              />
            </section>
          );
        })
      )}
    </div>
  );
}
