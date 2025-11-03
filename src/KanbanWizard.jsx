import React, { useMemo, useState } from "react";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

// Simple Kanban ID helper: K-<DEPT>-<CAT>-<SKU>-01
function makeKanbanId(dept, category, sku) {
  const d = (dept || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3);
  const c = (category || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 4);
  const s = (sku || "SKU").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3);
  return `K-${d}-${c}-${s}-01`;
}

export default function KanbanWizard() {
  const [step, setStep] = useState(1);
  const [orderMethod, setOrderMethod] = useState("Online"); // "Online" | "Email"

  // Core fields we’ll save to the ITEM row
  const [url, setUrl] = useState("");
  const [orderEmail, setOrderEmail] = useState("");
  const [itemName, setItemName] = useState("");
  const [sku, setSku] = useState("");
  const [dept, setDept] = useState("Facilities");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [binQtyUnits, setBinQtyUnits] = useState("");
  const [caseMultiple, setCaseMultiple] = useState("");
  const [reorderQtyBasis, setReorderQtyBasis] = useState("");
  const [unitsBasis, setUnitsBasis] = useState("cases");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierSku, setSupplierSku] = useState("");
  const [costPerPkg, setCostPerPkg] = useState("");
  const [substitutes, setSubstitutes] = useState("Y");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState(""); // will support camera/crop next
  const [saving, setSaving] = useState(false);

  const kanbanId = useMemo(() => makeKanbanId(dept, category, sku), [dept, category, sku]);


  function next() { setStep((s) => Math.min(3, s + 1)); }
  function back() { setStep((s) => Math.max(1, s - 1)); }

  async function save() {
    // Hard-required fields across steps
    if (!String(itemName).trim())       return alert("Item Name is required.");
    if (!String(dept).trim())           return alert("Dept is required.");
    if (!String(packageSize).trim())    return alert("Package Size is required.");
    if (!String(costPerPkg).trim())     return alert("Cost (per pkg) is required.");
    if (!String(photoUrl).trim())       return alert("Photo URL is required.");

    if (orderMethod === "Online" && !String(url).trim())
      return alert("Product URL is required for Online order method.");
    if (orderMethod === "Email" && !String(orderEmail).trim())
      return alert("Order Email is required for Email order method.");

    // Step 3 requireds (your labels already say required)
    if (!String(binQtyUnits).trim())      return alert("Bin Qty (units) is required.");
    if (!String(leadTimeDays).trim())     return alert("Lead Time (days) is required.");
    if (!String(reorderQtyBasis).trim())  return alert("Reorder Qty (basis) is required.");

    const payload = {
      kanbanId,
      itemName,
      sku,
      dept,
      category,
      location,
      packageSize,
      binQtyUnits,
      caseMultiple,
      reorderQtyBasis,
      unitsBasis,
      leadTimeDays,
      orderMethod,
      orderEmail: orderMethod === "Email" ? orderEmail : "",
      orderUrl: orderMethod === "Online" ? url : "",
      supplier,
      supplierSku,
      costPerPkg,
      substitutes,
      notes,
      photoUrl,
    };

    try {
      setSaving(true);
      const r = await fetch(`${BACKEND}/api/kanban/upsert-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Save failed (HTTP ${r.status}) ${t}`);
      }
      window.location.href = `/kanban/preview/${encodeURIComponent(kanbanId)}`;
    } catch (err) {
      alert(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  }



  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>New Kanban</h1>
        <a href="/kanban/queue" style={{ color: "#2563eb", textDecoration: "underline" }}>← Back to Queue</a>
      </div>

      {/* Stepper */}
      <p style={{ color: "#6b7280", marginTop: 6 }}>Step {step} of 3</p>

      <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ height: 4, background: "#111827", width: `${(step/3)*100}%` }} />

        <div style={{ padding: 16, display: "grid", gap: 14 }}>
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>How do you order this?</h2>

              {/* Big choice buttons */}
              <div style={{ display: "grid", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => { setOrderMethod("Online"); setStep(2); }}
                  style={{
                    padding: "18px 16px",
                    borderRadius: 10,
                    border: "1px solid #111827",
                    background: orderMethod === "Online" ? "#111827" : "white",
                    color: orderMethod === "Online" ? "white" : "#111827",
                    fontWeight: 800,
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                >
                  Order Online
                </button>

                <button
                  type="button"
                  onClick={() => { setOrderMethod("Email"); setStep(2); }}
                  style={{
                    padding: "18px 16px",
                    borderRadius: 10,
                    border: "1px solid #111827",
                    background: orderMethod === "Email" ? "#111827" : "white",
                    color: orderMethod === "Email" ? "white" : "#111827",
                    fontWeight: 800,
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                >
                  Order via Email
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                {orderMethod === "Online" ? "Order Online — Details" : "Order via Email — Details"}
              </h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {orderMethod === "Online" ? (
                  <Field label="Product URL (required)" value={url} setValue={setUrl} placeholder="https://vendor.com/product" />
                ) : (
                  <Field label="Order Email (required)" value={orderEmail} setValue={setOrderEmail} placeholder="purchasing@vendor.com" />
                )}

                <Field label="Item Name (required)" value={itemName} setValue={setItemName} />
                <Field label="Dept (required)" value={dept} setValue={setDept} />
                <Field label="Location (optional)" value={location} setValue={setLocation} />
                <Field label="Package Size (required)" value={packageSize} setValue={setPackageSize} placeholder="e.g., 6 rolls/case" />
                <Field label="Cost (per pkg) — required" value={costPerPkg} setValue={setCostPerPkg} mono />
                <Field label="Category (optional)" value={category} setValue={setCategory} />
                <Field label="Photo URL (required)" value={photoUrl} setValue={setPhotoUrl} placeholder="https://image..." />
              </div>
            </div>
          )}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>2-Bin & Ordering</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Field label="Bin Qty (units) — required" value={binQtyUnits} setValue={setBinQtyUnits} mono />
                <Field label="Lead Time (days) — required" value={leadTimeDays} setValue={setLeadTimeDays} mono />
                <Field label="Reorder Qty (basis) — required" value={reorderQtyBasis} setValue={setReorderQtyBasis} mono />
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", padding: 16, borderTop: "1px solid #e5e7eb" }}>
          <div>
            {step > 1 && (
              <button onClick={back} style={btnSecondary}>Back</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step < 3 ? (
              <button
                onClick={next}
                style={btnPrimary}
                disabled={
                  (step === 2 && (orderMethod === "Online" ? !url : !orderEmail)) ||
                  (step === 2 && (!itemName || !dept || !packageSize || !costPerPkg || !photoUrl))
                }
                title="Complete required fields to continue"
              >
                Next
              </button>
            ) : (
              <button onClick={save} style={btnPrimary}>Save Kanban</button>
            )}
          </div>
        </div>
      </div>

      {saving && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(250, 204, 21, 0.9)", // yellow overlay
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 24, color: "#111827" }}>
            Saving…
          </div>
        </div>
      )}

    </div>
  );
}


function canContinue() {
  return true;
}

function Field({ label, value, setValue, placeholder, mono }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        style={{
          ...inp,
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            : "inherit",
        }}
      />
    </label>
  );
}

function Select({ label, value, setValue, options }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <select value={value} onChange={(e) => setValue(e.target.value)} style={inp}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

const inp = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
  outline: "none",
};

const btnPrimary = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const btnSecondary = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "white",
  color: "#111827",
  fontWeight: 700,
  cursor: "pointer",
};

const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const grid3 = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 };
