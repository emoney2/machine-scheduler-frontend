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
        const r = await fetch(
          `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(kanbanId)}`,
          { credentials: "include" }
        );

        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!j || !j.item) throw new Error("Item not found");

        // normalize keys from either camelCase or sheet headers
        function norm(it) {
          return {
            kanbanId: it["Kanban ID"] ?? it.kanbanId ?? kanbanId,
            itemName: it["Item Name"] ?? it.itemName ?? "",
            sku: it["SKU"] ?? it.sku ?? "",
            dept: it["Dept"] ?? it.dept ?? "",
            category: it["Category"] ?? it.category ?? "",
            location: it["Location"] ?? it.location ?? "",
            packageSize: it["Package Size"] ?? it.packageSize ?? "",
            leadTimeDays: it["Lead Time (days)"] ?? it.leadTimeDays ?? "",
            binQtyUnits: it["Bin Qty (units)"] ?? it.binQtyUnits ?? "",
            reorderQtyBasis: it["Reorder Qty (basis)"] ?? it.reorderQtyBasis ?? "",
            orderMethod: it["Order Method (Email/Online)"] ?? it.orderMethod ?? "",
            orderUrl: it["Order URL"] ?? it.orderUrl ?? "",
            orderEmail: it["Order Email"] ?? it.orderEmail ?? "",
            photoUrl: it["Photo URL"] ?? it.photoUrl ?? "",
          };
        }

        setItem(norm(j.item));

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
        <div style={{ fontSize: 12, color: "#374151" }}>
          {item.dept} {item.category ? `• ${item.category}` : ""}
        </div>


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
              <div style={{ fontWeight: 800, fontSize: 16 }}>{item.itemName}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{item.sku || ""}</div>
              <div style={{ fontSize: 12, color: "#374151" }}>
                {item.packageSize} • Lead: {item.leadTimeDays}d
              </div>
              {item.location ? (
                <div style={{ fontSize: 12, color: "#374151" }}>Location: {item.location}</div>
              ) : null}

            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Bin Qty (units)" value={item.binQtyUnits} />
            <Field label="Reorder Qty (basis)" value={item.reorderQtyBasis} />
          </div>

          <div style={{ fontSize: 12 }}>
            Order via: <b>{item.orderMethod}</b>
            {" — "}
            {item.orderMethod === "Online" ? (
              <span style={{ wordBreak: "break-all" }}>{item.orderUrl}</span>
            ) : (
              <span>{item.orderEmail}</span>
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
