import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");

function money(x) {
  const n = parseFloat(x);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function SalesPortal() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repRows, setRepRows] = useState([]);
  const [summaryByRep, setSummaryByRep] = useState({});
  const [selectedInvoices, setSelectedInvoices] = useState(() => new Set());
  const [syncMsg, setSyncMsg] = useState("");

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const s = await refreshSession();
      if (cancelled) return;
      if (s?.role === "rep" && s.repName) {
        try {
          const { data } = await axios.get(`${API_ROOT}/sales/me`, {
            withCredentials: true,
          });
          setRepRows(data.rows || []);
        } catch (e) {
          setError(e.response?.data?.error || "Failed to load rep data");
        }
      } else if (s?.role === "admin") {
        try {
          const { data } = await axios.get(`${API_ROOT}/sales/admin/ledger`, {
            withCredentials: true,
          });
          setSummaryByRep(data.summaryByRep || {});
        } catch (e) {
          setError(e.response?.data?.error || "Failed to load admin ledger");
        }
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
      if (s?.role === "rep" && s.repName) {
        const { data } = await axios.get(`${API_ROOT}/sales/me`, {
          withCredentials: true,
        });
        setRepRows(data.rows || []);
      } else if (s?.role === "admin") {
        const { data } = await axios.get(`${API_ROOT}/sales/admin/ledger`, {
          withCredentials: true,
        });
        setSummaryByRep(data.summaryByRep || {});
      }
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  };

  const handleLogout = async () => {
    await axios.post(`${API_ROOT}/sales/logout`, {}, { withCredentials: true });
    setSession(null);
    setRepRows([]);
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

  const repSections = Object.entries(summaryByRep).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  const renderAdminRow = (r, i) => {
    const id = String(r["Invoice QBO Id"] || "").trim();
    const cust = String(r["Customer paid"] || "").toUpperCase();
    const rp = String(r["Rep paid"] || "").toUpperCase();
    const canSelect = cust === "Y" && rp !== "Y";
    return (
      <tr key={`${id}-${i}`} style={{ borderTop: "1px solid #eee" }}>
        <td style={{ padding: 6, textAlign: "center" }}>
          {canSelect ? (
            <input
              type="checkbox"
              checked={selectedInvoices.has(id)}
              onChange={() => toggleInvoice(id)}
              aria-label={`Select invoice ${id}`}
            />
          ) : null}
        </td>
        <td style={{ padding: 6 }}>{r["Order #s"]}</td>
        <td style={{ padding: 6 }}>{r["Invoice #"]}</td>
        <td style={{ padding: 6 }}>{money(r["Product subtotal"])}</td>
        <td style={{ padding: 6 }}>{money(r["Commission $"])}</td>
        <td style={{ padding: 6 }}>{r["Customer paid"]}</td>
        <td style={{ padding: 6 }}>{r["Rep paid"]}</td>
      </tr>
    );
  };

  const markRepPaid = async () => {
    const ids = [...selectedInvoices];
    if (!ids.length) {
      alert("Select at least one invoice (checkbox).");
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
      const { data: d2 } = await axios.get(`${API_ROOT}/sales/admin/ledger`, {
        withCredentials: true,
      });
      setSummaryByRep(d2.summaryByRep || {});
    } catch (err) {
      alert(err.response?.data?.error || "Mark paid failed");
    }
  };

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
          Commission is 12% of product sales (excludes shipping, tax, and fee-style lines). Company
          payment and rep payout dates update after the scheduled QuickBooks sync.
        </p>
        <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                <th style={{ padding: 8 }}>Order #s</th>
                <th style={{ padding: 8 }}>Invoice #</th>
                <th style={{ padding: 8 }}>Product subtotal</th>
                <th style={{ padding: 8 }}>Commission</th>
                <th style={{ padding: 8 }}>Customer paid</th>
                <th style={{ padding: 8 }}>Invoice paid</th>
                <th style={{ padding: 8 }}>Rep pay due (EOM)</th>
                <th style={{ padding: 8 }}>Rep paid</th>
              </tr>
            </thead>
            <tbody>
              {repRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 12, color: "#666" }}>
                    No commission rows yet. Rows appear when a shipped invoice is created and logged.
                  </td>
                </tr>
              ) : (
                repRows.map((r, i) => (
                  <tr key={`${r["Invoice QBO Id"]}-${i}`} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{r["Order #s"]}</td>
                    <td style={{ padding: 8 }}>{r["Invoice #"]}</td>
                    <td style={{ padding: 8 }}>{money(r["Product subtotal"])}</td>
                    <td style={{ padding: 8 }}>{money(r["Commission $"])}</td>
                    <td style={{ padding: 8 }}>{r["Customer paid"]}</td>
                    <td style={{ padding: 8 }}>{r["Invoice paid date"]}</td>
                    <td style={{ padding: 8 }}>{r["Rep pay due"]}</td>
                    <td style={{ padding: 8 }}>{r["Rep paid"]}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* admin */
  return (
    <div style={{ padding: "1rem 1.5rem 2rem", fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: "1.35rem" }}>Sales — Admin</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={handleLogout} style={{ padding: "0.35rem 0.75rem" }}>
            Sign out
          </button>
        </div>
      </div>
      <p style={{ color: "#666", fontSize: "0.88rem" }}>
        Owed to rep = sum of commission $ where customer has paid QuickBooks and rep has not been
        marked paid. Use Render cron to call <code>POST /api/sales/cron/sync-qbo</code> with{" "}
        <code>X-Sales-Cron-Secret</code>. On the web service, set <code>QBO_TOKEN_JSON</code> (or{" "}
        <code>QBO_TOKEN_JSON_B64</code>) to the same JSON as <code>qbo_token.json</code> so QuickBooks
        auth survives deploys; update that secret after reconnecting QuickBooks.
      </p>
      {syncMsg ? <p style={{ fontSize: "0.85rem" }}>{syncMsg}</p> : null}
      <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>Outstanding by rep</h2>
      <ul style={{ margin: "0.25rem 0 1rem", paddingLeft: "1.1rem" }}>
        {repSections.length === 0 ? (
          <li style={{ color: "#666" }}>No rep commission rows</li>
        ) : (
          repSections.map(([rep, v]) => (
            <li key={rep}>
              <strong>{rep}</strong>: {money(v.commission || 0)} owed
            </li>
          ))
        )}
      </ul>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={markRepPaid} style={{ padding: "0.4rem 0.9rem" }}>
          Mark selected rep-paid
        </button>
      </div>
      {repSections.length === 0 ? (
        <p style={{ color: "#666" }}>No rep orders in the commission ledger.</p>
      ) : (
        repSections.map(([rep, v]) => {
          const rows = v.rows || [];
          return (
            <section key={rep} style={{ marginBottom: "1.75rem" }}>
              <h3 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>
                {rep}
                <span style={{ fontWeight: 400, color: "#555", fontSize: "0.88rem" }}>
                  {" "}
                  — {rows.length} invoice{rows.length === 1 ? "" : "s"}
                  {(v.commission || 0) > 0 ? ` · ${money(v.commission)} owed` : ""}
                </span>
              </h3>
              <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                      <th style={{ padding: 6 }} />
                      <th style={{ padding: 6 }}>Order #s</th>
                      <th style={{ padding: 6 }}>Invoice #</th>
                      <th style={{ padding: 6 }}>Product subtotal</th>
                      <th style={{ padding: 6 }}>Commission</th>
                      <th style={{ padding: 6 }}>Cust paid</th>
                      <th style={{ padding: 6 }}>Rep paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: 10, color: "#666" }}>
                          No rows
                        </td>
                      </tr>
                    ) : (
                      rows.map((r, i) => renderAdminRow(r, i))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
