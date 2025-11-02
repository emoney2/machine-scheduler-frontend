import React, { useEffect, useMemo, useState } from "react";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

export default function KanbanQueue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [overlay, setOverlay] = useState(null); // { message: string } | null

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/kanban/queue`, {
          credentials: "include",
        });
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
      const s = String(r["Event Status"] || "").toLowerCase();
      if (s === "open") open.push(r);
      else if (s === "ordered") ordered.push(r);
    }
    const byTimeDesc = (a, b) =>
      new Date(b["Timestamp"] || 0) - new Date(a["Timestamp"] || 0);
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

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">Error loading queue: {err}</div>;

  return (
    <div className="relative">
      {/* Overlay */}
      {overlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-yellow-200/80"
          aria-live="assertive"
          role="alert"
        >
          <div className="rounded-xl shadow-lg border border-yellow-400 bg-yellow-100 px-6 py-4 text-yellow-900 text-base font-medium flex items-center gap-3">
            <span className="inline-block w-4 h-4 border-2 border-yellow-700 border-t-transparent rounded-full animate-spin" />
            <span>{overlay.message}</span>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold">Kanban — Needs to Order</h1>
        <p className="text-gray-600 mt-1">
          Open: <span className="font-semibold">{openCount}</span> • Ordered:{" "}
          <span className="font-semibold">{orderedCount}</span>
        </p>

        {grouped.all.length === 0 ? (
          <div className="mt-6 text-gray-500">No open requests.</div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border text-sm">
              <thead className="bg-gray-100">
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
                  const status = (r["Event Status"] || "").toLowerCase();
                  const rowClass =
                    status === "open"
                      ? "border-t bg-yellow-50 border-l-4 border-l-yellow-400"
                      : "border-t bg-slate-50";
                  return (
                    <tr
                      key={r["Event ID"] || `${r["Kanban ID"]}-${r["Timestamp"]}`}
                      className={rowClass}
                    >
                      <Td>{formatWhen(r["Timestamp"])}</Td>
                      <Td mono>{r["Kanban ID"]}</Td>
                      <Td>
                        <div className="flex items-center gap-3">
                          {r["Photo URL"] ? (
                            <img
                              src={r["Photo URL"]}
                              alt=""
                              className="w-10 h-10 object-cover rounded border"
                            />
                          ) : null}
                          <div>
                            <div className="font-medium">
                              {r["Item Name"] || "(unnamed)"}
                            </div>
                            <div className="text-xs text-gray-500">{r["SKU"]}</div>
                          </div>
                        </div>
                      </Td>
                      <Td mono>{r["Event Qty"]}</Td>
                      <Td>{r["Supplier"]}</Td>
                      <Td>{r["Order Method"]}</Td>
                      <Td>
                        {r["Order Method"] === "Email" ? (
                          <a
                            className="text-blue-600 underline"
                            href={`mailto:${r["Order Email"] || ""}`}
                          >
                            {r["Order Email"] || "(missing email)"}
                          </a>
                        ) : (
                          <a
                            className="text-blue-600 underline break-all"
                            href={r["Order URL"] || "#"}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r["Order URL"] || "(missing link)"}
                          </a>
                        )}
                      </Td>
                      <Td>{r["Requested By"] || "Public Scanner"}</Td>
                      <Td>
                        {status === "open" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-yellow-200 text-yellow-900">
                            Needs Order
                          </span>
                        ) : status === "ordered" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-blue-200 text-blue-900">
                            Ordered
                          </span>
                        ) : (
                          ""
                        )}
                      </Td>
                      <Td>
                        <div className="flex gap-2">
                          {status === "open" && (
                            <button
                              className="px-3 py-1 rounded bg-black text-white"
                              onClick={() => markOrdered(r["Event ID"])}
                              title="Append ORDERED row and mark this request as Ordered"
                            >
                              Mark Ordered
                            </button>
                          )}
                          {status === "ordered" && (
                            <button
                              className="px-3 py-1 rounded border"
                              onClick={() => markReceived(r["Event ID"])}
                              title="Append RECEIVED row and close this request"
                            >
                              Mark Received
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-gray-500 mt-4">
          Tip: click the link/email above to place the order. Then mark Ordered or
          Received to keep the queue clean.
        </p>
      </div>
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left px-3 py-2 border-b font-semibold">{children}</th>;
}
function Td({ children, mono }) {
  return <td className={`px-3 py-2 align-top ${mono ? "font-mono" : ""}`}>{children}</td>;
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
