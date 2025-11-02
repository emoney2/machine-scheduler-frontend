import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

// Minimal fetch of the item (by Kanban ID) to render the card
export default function KanbanCardPreview() {
  const { kanbanId } = useParams();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/kanban/get-item?kanbanId=${encodeURIComponent(kanbanId)}`, {
          credentials: "include",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!j || !j.item) throw new Error("Item not found");
        setItem(j.item);
      } catch (e) {
        setErr(String(e));
      }
    };
    load();
  }, [kanbanId]);

  if (err) return <div style={{ padding: 24, color: "#b91c1c" }}>Error: {String(err)}</div>;
  if (!item) return <div style={{ padding: 24 }}>Loading…</div>;

  // print-friendly 4x6 card layout (portrait)
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => nav(`/kanban/new?edit=${encodeURIComponent(kanbanId)}`)}
          style={btnSecondary}
        >
          Edit
        </button>
        <button
          onClick={() => window.print()}
          style={btnPrimary}
        >
          Print
        </button>
      </div>

      <div
        className="card"
        style={{
          width: "4in",
          height: "6in",
          border: "2px solid #111827",
          borderRadius: 10,
          padding: "12px",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          gap: 8,
          background: "white",
        }}
      >
        {/* Header */}
        <div style={{ fontWeight: 800, fontSize: 18 }}>KANBAN CARD</div>
        <div style={{ fontSize: 12, color: "#374151" }}>{item["Dept"]} • {item["Category"] || "Supplies"}</div>

        {/* Body */}
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
            {item["Photo URL"] ? (
              <img
                alt=""
                src={item["Photo URL"]}
                style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }}
              />
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 8,
                  border: "1px dashed #e5e7eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                  fontSize: 11,
                }}
              >
                No photo
              </div>
            )}

            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{item["Item Name"]}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{item["SKU"] || ""}</div>
              <div style={{ fontSize: 12, color: "#374151" }}>
                {item["Package Size"]} • Lead: {item["Lead Time (days)"]}d
              </div>
              {item["Location"] ? (
                <div style={{ fontSize: 12, color: "#374151" }}>Location: {item["Location"]}</div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Bin Qty (units)" value={item["Bin Qty (units)"]} />
            <Field label="Reorder Qty (basis)" value={item["Reorder Qty (basis)"]} />
          </div>

          <div style={{ fontSize: 12 }}>
            Order via: <b>{item["Order Method (Email/Online)"]}</b>
            {" — "}
            {item["Order Method (Email/Online)"] === "Online" ? (
              <span style={{ wordBreak: "break-all" }}>{item["Order URL"]}</span>
            ) : (
              <span>{item["Order Email"]}</span>
            )}
          </div>
        </div>

        {/* QR footer */}
        <div style={{ marginTop: 4, display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
          <div
            style={{
              width: 92,
              height: 92,
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "#6b7280",
            }}
          >
            QR
          </div>
          <div style={{ fontSize: 11, color: "#374151" }}>
            Scan to request reorder • ID: <b>{item["Kanban ID"]}</b>
          </div>
        </div>
      </div>

      {/* print styles */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .card { box-shadow: none !important; }
          button, a { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ color: "#6b7280" }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value || "-"}</div>
    </div>
  );
}

const btnPrimary = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};
const btnSecondary = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "white",
  color: "#111827",
  fontWeight: 800,
  cursor: "pointer",
};
