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

function unpaidCommission(repBucket) {
  if (!repBucket) return 0;
  return repBucket.unpaidCommission ?? repBucket.pipelineCommission ?? 0;
}

const tableWrap = { overflowX: "auto", border: "1px solid #ddd", borderRadius: 6 };
const thStyle = { padding: 8, background: "#f5f5f5", textAlign: "left" };
const tdStyle = { padding: 8 };

function OrdersTable({ rows, showCheckboxes, selectedInvoices, onToggle, repView = false }) {
  if (!rows?.length) {
    return (
      <p style={{ color: "#666", fontSize: "0.88rem", margin: "0.5rem 0" }}>
        {repView ? "No orders to show." : "No unpaid rep orders. Orders come from Production Orders (Google Sheets) with REP set in column AQ."}
      </p>
    );
  }
  return (
    <div style={tableWrap}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
        <thead>
          <tr>
            {showCheckboxes ? <th style={thStyle} /> : null}
            <th style={thStyle}>Order #</th>
            <th style={thStyle}>Company</th>
            <th style={thStyle}>Design</th>
            <th style={thStyle}>Product</th>
            <th style={thStyle}>Qty</th>
            <th style={thStyle}>Sales</th>
            <th style={thStyle}>Commission</th>
            <th style={thStyle}>Customer paid</th>
            <th style={thStyle}>Rep paid</th>
            {repView ? <th style={thStyle}>Due date</th> : <th style={thStyle}>Stage</th>}
            {!repView ? <th style={thStyle}>Invoice #</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const id = String(r.invoiceQboId || r["Invoice QBO Id"] || "").trim();
            const cust = String(r.customerPaid || r["Customer paid"] || "N").toUpperCase();
            const rp = String(r.repPaid || r["Rep paid"] || "N").toUpperCase();
            const canSelect = showCheckboxes && id && cust === "Y" && rp !== "Y";
            const orderId = r.orderId || r["Order #"] || r["Order #s"];
            return (
              <tr key={`${orderId}-${i}`} style={{ borderTop: "1px solid #eee" }}>
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
                <td style={tdStyle}>{orderId}</td>
                <td style={tdStyle}>{r.company || "—"}</td>
                <td style={tdStyle}>{r.design || "—"}</td>
                <td style={tdStyle}>{r.product || "—"}</td>
                <td style={tdStyle}>{r.quantity ?? "—"}</td>
                <td style={tdStyle}>{money(r.salesAmount ?? r.estimatedSubtotal ?? r["Product subtotal"])}</td>
                <td style={tdStyle}>{money(r.commission ?? r.estimatedCommission ?? r["Commission $"])}</td>
                <td style={tdStyle}>{cust}</td>
                <td style={tdStyle}>{rp}</td>
                {repView ? (
                  <td style={tdStyle}>{r.dueDate || "—"}</td>
                ) : (
                  <td style={tdStyle}>{r.stage || "—"}</td>
                )}
                {!repView ? <td style={tdStyle}>{r.invoiceNum || r["Invoice #"] || "—"}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCards({ owed, unpaidCommission, orderCount, repView = false }) {
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
        <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase" }}>Owed now</div>
        <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{money(owed)}</div>
        {repView ? (
          <div style={{ fontSize: "0.8rem", color: "#666" }}>
            Customer has paid and Commission will be paid at the end of the month
          </div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: "#666" }}>Customer paid (QBO) — pay rep</div>
        )}
      </div>
      <div style={card}>
        <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase" }}>Unpaid commission</div>
        <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{money(unpaidCommission)}</div>
        {!repView ? (
          <div style={{ fontSize: "0.8rem", color: "#666" }}>All sheet orders not paid to rep</div>
        ) : null}
      </div>
      <div style={card}>
        <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase" }}>Orders</div>
        <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{orderCount}</div>
        {!repView ? (
          <div style={{ fontSize: "0.8rem", color: "#666" }}>Production Orders with REP</div>
        ) : null}
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
  const [orders, setOrders] = useState([]);
  const [owed, setOwed] = useState(0);
  const [unpaidTotal, setUnpaidTotal] = useState(0);
  const [summaryByRep, setSummaryByRep] = useState({});
  const [meta, setMeta] = useState(null);
  const [selectedInvoices, setSelectedInvoices] = useState(() => new Set());

  const ordersFromPayload = (data) => data.orders || data.pipelineOrders || data.commissionRows || data.rows || [];

  const applyRepPayload = (data) => {
    const list = ordersFromPayload(data);
    setOrders(list);
    setOwed(data.owed ?? 0);
    setUnpaidTotal(data.unpaidCommission ?? data.pipelineCommission ?? 0);
    setMeta(data.meta || null);
  };

  const applyAdminPayload = (data) => {
    setSummaryByRep(data.summaryByRep || {});
    setOrders(ordersFromPayload(data));
    setMeta(data.meta || null);
  };

  const refreshSession = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_ROOT}/sales/session`, { withCredentials: true });
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
    const { data } = await axios.get(`${API_ROOT}/sales/admin/ledger`, { withCredentials: true });
    applyAdminPayload(data);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const s = await refreshSession();
      if (cancelled) return;
      try {
        if (s?.role === "rep" && s.repName) await loadRepData();
        else if (s?.role === "admin") await loadAdminData();
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
      await axios.post(`${API_ROOT}/sales/login`, { username, password }, { withCredentials: true });
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
    setOrders([]);
    setOwed(0);
    setUnpaidTotal(0);
    setSummaryByRep({});
    setMeta(null);
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
      alert("Select orders where customer paid (checkbox) to mark rep paid.");
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
    return <div style={{ padding: "2rem", fontFamily: "system-ui" }}>Loading…</div>;
  }

  if (!session) {
    return (
      <div style={{ maxWidth: 420, margin: "2rem auto", fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: "1.35rem" }}>Sales portal</h1>
        <p style={{ color: "#555", fontSize: "0.95rem" }}>
          Sign in with credentials configured in Render (<code>SALES_PORTAL_USERS</code>).
        </p>
        {error ? <p style={{ color: "crimson", fontSize: "0.9rem" }}>{error}</p> : null}
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
        {error ? <p style={{ color: "crimson", fontSize: "0.9rem" }}>{error}</p> : null}
        <SummaryCards
          owed={owed}
          unpaidCommission={unpaidTotal}
          orderCount={orders.length}
          repView
        />
        <h2 style={{ fontSize: "1.05rem", marginTop: "1rem" }}>Your orders</h2>
        <OrdersTable rows={orders} repView />
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
        <strong>Owed to reps ({money(totalOwed)}):</strong> commission on sheet orders where QuickBooks
        shows the customer paid and you have not marked the rep paid. All other unpaid rows are
        still in progress or awaiting customer payment.
      </p>
      {error ? <p style={{ color: "crimson", fontSize: "0.9rem" }}>{error}</p> : null}
      <details style={{ fontSize: "0.82rem", color: "#666", marginBottom: 12 }}>
        <summary style={{ cursor: "pointer" }}>QuickBooks sync setup</summary>
        <p style={{ marginTop: 8 }}>
          Cron: <code>POST /api/sales/cron/sync-qbo</code> with <code>X-Sales-Cron-Secret</code>.
          Sets <strong>Customer paid</strong> on the commission ledger when the QBO invoice balance is zero.
        </p>
      </details>
      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={markRepPaid} style={{ padding: "0.4rem 0.9rem" }}>
          Mark selected rep-paid
        </button>
      </div>
      {repSections.length === 0 ? (
        <div style={{ color: "#666" }}>
          <p>
            No rep orders with outstanding rep payment. Each row needs a name under the{" "}
            <strong>Sales Rep</strong> column on Production Orders (column AQ).
          </p>
          {meta ? (
            <p style={{ fontSize: "0.82rem", marginTop: 8 }}>
              Debug: reading <code>{meta.sheetRange}</code> — {meta.productionRowCount} production
              row(s), {meta.rowsWithRep} with Sales Rep filled
              {meta.repColumn ? (
                <>
                  , column &quot;{meta.repColumn}&quot;
                  {meta.repColumnIndex != null ? ` (index ${meta.repColumnIndex})` : ""}
                </>
              ) : (
                <> — Sales Rep column not found in header row</>
              )}
              .
            </p>
          ) : null}
        </div>
      ) : (
        repSections.map(([rep, v]) => {
          const repOrders = v.orders || v.pipelineOrders || v.commissionRows || v.rows || [];
          return (
            <section key={rep} style={{ marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "1px solid #eee" }}>
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 0.35rem" }}>{rep}</h3>
              <p style={{ margin: "0 0 0.75rem", color: "#555", fontSize: "0.88rem" }}>
                <strong>{money(owedAmount(v))}</strong> owed now ·{" "}
                <strong>{money(unpaidCommission(v))}</strong> total unpaid commission ·{" "}
                {repOrders.length} order{repOrders.length === 1 ? "" : "s"}
              </p>
              <OrdersTable
                rows={repOrders}
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
