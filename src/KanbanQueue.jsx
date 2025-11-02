import React, { useEffect, useMemo, useState } from "react";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

function statusForRow(r) {
  const raw =
    r["Event Status"] ??
    r["Status"] ??
    r["Event status"] ??
    r["event status"] ??
    "";
  return String(raw).trim().toLowerCase(); // "open" | "ordered" | "received" | ""
}

export default function KanbanQueue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [overlay, setOverlay] = useState(null); // { message: string } | null

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/kanban/queue`, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        setRows(j.rows || []);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const grouped = useMemo(() => {
    const open = [];
    const ordered = [];
    for (const r of rows || []) {
      const s = statusForRow(r);
      if (s === "open") open.push(r);
      else if (s === "ordered") ordered.push(r);
    }
    const byTimeDesc = (a, b) => new Date(b["Timestamp"] || 0) - new Date(a["Timestamp"] || 0);
    open.sort(byTimeDesc);
    ordered.sort(byTimeDesc);
    return { open, ordered, all: [...open, ...ordered] };
  }, [rows]);

  const openCount = grouped.open.length;
  const orderedCount = grouped.ordered.length;

  async function markOrdered(eventId) {
    const qtyStr = prompt("Ordered qty (cases/units)?", "1");
    if (!qtyStr) return;
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) {
      alert("Please enter a positive number.");
      return;
    }
    const po = prompt("PO # (optional)", "") || "";

    setOverlay({ message: "Marking Ordered… Please wait" });
    try {
      const r = await fetch(`${BACKEND}/api/kanban/ordered`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventId, orderedQty: qty, po }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Failed (HTTP ${r.status}) ${t}`);
      }
      window.location.reload();
    } catch (e) {
      setOverlay(null);
      alert(String(e));
    }
  }

  async function markReceived(eventId) {
    const qtyStr = prompt("Received qty (cases/units)?", "1");
    if (!qtyStr) return;
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) {
      alert("Please enter a positive number.");
      return;
    }

    setOverlay({ message: "Marking Received… Please wait" });
    try {
      const r = await fetch(`${BACKEND}/api/kanban/received`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventId, receivedQty: qty }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Failed (HTTP ${r.status}) ${t}`);
      }
      window.location.reload();
    } catch (e) {
      setOverlay(null);
      alert(String(e));
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (err) return <div style={{ padding: 24, color: "#b91c1c" }}>Error loading queue: {err}</div>;

  return (
    <div style={{ position: "relative" }}>
      {/* Overlay */}
      {overlay && (
        <div
          aria-live="assertive"
          role="alert"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(250, 204, 21, 0.55)", // yellow overlay
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              border: "1px solid #f59e0b",
              background: "#fef3c7",
              color: "#713f12",
              borderRadius: 12,
              padding: "12px 16px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "2px solid #78350f",
                borderTopColor: "transparent",
                display: "inline-block",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span>{overlay.message}</span>
          </div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Kanban — Needs to Order</h1>
        <p style={{ color: "#4b5563", marginTop: 6 }}>
          Open: <span style={{ fontWeight: 600 }}>{openCount}</span> • Ordered:{" "}
          <span style={{ fontWeight: 600 }}>{orderedCount}</span>
        </p>

        {grouped.all.length === 0 ? (
          <div style={{ marginTop: 16, color: "#6b7280" }}>No open requests.</div>
        ) : (
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead style={{ background: "#f3f4f6" }}>
                <tr>
                  <Th>Time</Th>
                  <Th>Kanban ID</Th>
                  <Th>Item</Th>
                  <Th>Qty</Th>
                  <Th>Supplier</Th>
                  <Th>Method</Th>
                  <Th>Order Link / Email</Th>
                  <Th>Requested By</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {grouped.all.map((r) => {
                  const status = statusForRow(r);
                  const isOpen = status === "open";
                  const rowStyle = {
                    borderTop: "1px solid #e5e7eb",
                    background: isOpen ? "rgba(254, 243, 199, 0.55)" : "#f8fafc",
                  };
                  const leftBarStyle = {
                    width: 4,
                    background: isOpen ? "#f59e0b" : "#cbd5e1",
                  };
                  return (
                    <tr
                      key={r["Event ID"] || `${r["Kanban ID"]}-${r["Timestamp"]}`}
                      style={rowStyle}
                    >
                      {/* left emphasis bar */}
                      <td style={{ padding: 0, width: 4 }}>
                        <div style={leftBarStyle} />
                      </td>

                      {/* Time */}
                      <Td>{formatWhen(r["Timestamp"])}</Td>

                      {/* Kanban ID */}
                      <Td mono>{r["Kanban ID"]}</Td>

                      {/* Item (image + info) */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          {r["Photo URL"] ? (
                            <img
                              src={r["Photo URL"]}
                              alt=""
                              style={{
                                width: 40,
                                height: 40,
                                objectFit: "cover",
                                borderRadius: 6,
                                border: "1px solid #e5e7eb",
                                marginRight: 12,
                              }}
                            />
                          ) : null}
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              {r["Item Name"] || "(unnamed)"}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>{r["SKU"]}</div>
                          </div>
                        </div>
                      </td>

                      {/* Qty */}
                      <Td mono>{r["Event Qty"]}</Td>

                      {/* Supplier */}
                      <Td>{r["Supplier"]}</Td>

                      {/* Method */}
                      <Td>{r["Order Method"]}</Td>

                      {/* Order link / email */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        {r["Order Method"] === "Email" ? (
                          <a
                            href={`mailto:${r["Order Email"] || ""}`}
                            style={{ color: "#2563eb", textDecoration: "underline" }}
                          >
                            {r["Order Email"] || "(missing email)"}
                          </a>
                        ) : (
                          <a
                            href={r["Order URL"] || "#"}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: "#2563eb",
                              textDecoration: "underline",
                              wordBreak: "break-all",
                            }}
                          >
                            {r["Order URL"] || "(missing link)"}
                          </a>
                        )}
                      </td>

                      {/* Requested By */}
                      <Td>{r["Requested By"] || "Public Scanner"}</Td>

                      {/* Status badge */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        {status === "open" ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 700,
                              background: "#fde68a",
                              color: "#78350f",
                            }}
                          >
                            Needs Order
                          </span>
                        ) : status === "ordered" ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 700,
                              background: "#bfdbfe",
                              color: "#1e3a8a",
                            }}
                          >
                            Ordered
                          </span>
                        ) : (
                          ""
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          {status === "open" && (
                            <button
                              onClick={() => markOrdered(r["Event ID"])}
                              title="Append ORDERED row and mark this request as Ordered"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #111827",
                                background: "#111827",
                                color: "white",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Mark Ordered
                            </button>
                          )}
                          {status === "ordered" && (
                            <button
                              onClick={() => markReceived(r["Event ID"])}
                              title="Append RECEIVED row and close this request"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #e5e7eb",
                                background: "white",
                                color: "#111827",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Mark Received
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 16 }}>
          Tip: click the link/email above to place the order. Then mark Ordered or Received to keep
          the queue clean.
        </p>
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 12px",
        borderBottom: "1px solid #e5e7eb",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono }) {
  return (
    <td
      style={{
        padding: "8px 12px",
        verticalAlign: "top",
        fontFamily: mono
          ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          : "inherit",
      }}
    >
      {children}
    </td>
  );
}

function formatWhen(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}
