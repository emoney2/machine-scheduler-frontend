import React, { useEffect, useState } from "react";

export default function KanbanQueue() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("https://machine-scheduler-backend.onrender.com/api/kanban/queue", {
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

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">Error loading queue: {err}</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Kanban — Needs to Order</h1>
      <p className="text-gray-600 mt-1">Open requests from scanned cards</p>

      {rows.length === 0 ? (
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r["Event ID"]} className="border-t">
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
                        <div className="font-medium">{r["Item Name"] || "(unnamed)"}</div>
                        <div className="text-xs text-gray-500">{r["SKU"]}</div>
                      </div>
                    </div>
                  </Td>
                  <Td mono>{r["Event Qty"]}</Td>
                  <Td>{r["Supplier"]}</Td>
                  <Td>{r["Order Method"]}</Td>
                  <Td>
                    {r["Order Method"] === "Email" ? (
                      <a className="text-blue-600 underline" href={`mailto:${r["Order Email"]}`}>
                        {r["Order Email"] || "(missing email)"}
                      </a>
                    ) : (
                      <a
                        className="text-blue-600 underline"
                        href={r["Order URL"] || "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r["Order URL"] || "(missing link)"}
                      </a>
                    )}
                  </Td>
                  <Td>{r["Requested By"] || "Public Scanner"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-4">
        Tip: click the link/email above to place the order, then we’ll add buttons here to mark
        Ordered / Received next.
      </p>
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left px-3 py-2 border-b font-semibold">{children}</th>;
}
function Td({ children, mono }) {
  return (
    <td className={`px-3 py-2 align-top ${mono ? "font-mono" : ""}`}>
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
