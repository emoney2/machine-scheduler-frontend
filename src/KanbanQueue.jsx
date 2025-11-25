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
    const qtyStr = r["Reorder Qty Basis"] || r["Reorder Qty"] || "1";
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>Kanban — Needs to Order</h1>
            <p style={{ color: "#4b5563", marginTop: 6 }}>
              Open: <span style={{ fontWeight: 600 }}>{openCount}</span> • Ordered:{" "}
              <span style={{ fontWeight: 600 }}>{orderedCount}</span>
            </p>
          </div>
          <div>
            <a
              href="/kanban/new"
              style={{
                display: "inline-block",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #111827",
                background: "#111827",
                color: "white",
                fontWeight: 700,
                textDecoration: "none",
              }}
              title="Create a new Kanban card"
            >
              + New Kanban
            </a>
          </div>
        </div>
        {grouped.all.length === 0 ? (
          <div style={{ marginTop: 16, color: "#6b7280" }}>No open requests.</div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {/* Card list (no horizontal scroll) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {grouped.all.map((r) => {
                const status = statusForRow(r);
                const isOpen = status === "open";

                return (
                  <div
                    key={r["Event ID"] || `${r["Kanban ID"]}-${r["Timestamp"]}`}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      background: isOpen ? "rgba(254, 243, 199, 0.55)" : "#f8fafc",
                      overflow: "hidden",
                    }}
                  >
                    {/* accent bar */}
                    <div
                      style={{
                        height: 4,
                        background: isOpen ? "#f59e0b" : "#cbd5e1",
                      }}
                    />

                    {/* content */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 12,
                        padding: 12,
                      }}
                    >
                      {/* left info stack */}
                      <div style={{ display: "grid", gap: 8 }}>
                        {/* top row: time + status badge */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ color: "#374151", fontSize: 12 }}>
                            {formatWhen(r["Timestamp"])}
                          </div>
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
                          ) : null}
                        </div>

                        {/* main row: photo + name/sku + details */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          {r["Photo URL"] ? (
                            <img
                              src={r["Photo URL"]}
                              alt=""
                              style={{
                                width: 56,
                                height: 56,
                                objectFit: "cover",
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 8,
                                border: "1px dashed #e5e7eb",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#9ca3af",
                                fontSize: 12,
                              }}
                            >
                              No photo
                            </div>
                          )}

                          <div style={{ display: "grid", gap: 4 }}>
                            {r["Order Method"] === "Online" && r["Order URL"] ? (
                              <a
                                href={r["Order URL"]}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontWeight: 700, color: "#111827", textDecoration: "underline" }}
                                title="Open product page"
                              >
                                {r["Item Name"] || "(unnamed)"}
                              </a>
                            ) : (
                              <div style={{ fontWeight: 700 }}>
                                {r["Item Name"] || "(unnamed)"}
                              </div>
                            )}
                            <div
                              style={{
                                fontSize: 12,
                                color: "#6b7280",
                                fontFamily:
                                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                              }}
                            >
                              {r["SKU"]}
                            </div>
                            {/* metadata chips */}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Chip label="Kanban" value={r["Kanban ID"]} mono />
                              <Chip label="Qty" value={r["Event Qty"]} mono />
                              <Chip label="Supplier" value={r["Supplier"]} />
                              <Chip label="Method" value={r["Order Method"]} />
                              <Chip label="Requested By" value={r["Requested By"] || "Public Scanner"} />
                            </div>
                          </div>
                        </div>

                        {/* link/email row: keep email link only; Online link now lives on Item Name */}
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {r["Order Method"] === "Email" && (
                            <a
                              href={`mailto:${r["Order Email"] || ""}`}
                              style={{ color: "#2563eb", textDecoration: "underline" }}
                            >
                              {r["Order Email"] || "(missing email)"}
                            </a>
                          )}
                        </div>
                      </div>

                      {/* right actions */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 8,
                          minWidth: 180,
                        }}
                      >
                        {status === "open" && (
                          <button
                            onClick={() => markOrdered(r["Event ID"], r)}
                            title="Append ORDERED row and mark this request as Ordered"
                            style={{
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #111827",
                              background: "#111827",
                              color: "white",
                              fontWeight: 700,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
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
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #e5e7eb",
                              background: "white",
                              color: "#111827",
                              fontWeight: 700,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Mark Received
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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

function Chip({ label, value, mono }) {
  if (!value) return null;
  return (
    <span
      title={`${label}: ${value}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: "white",
        color: "#374151",
        fontSize: 12,
      }}
    >
      <span style={{ color: "#6b7280" }}>{label}:</span>
      <span
        style={{
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            : "inherit",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </span>
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
