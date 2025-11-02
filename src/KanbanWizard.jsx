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

  const kanbanId = useMemo(() => makeKanbanId(dept, category, sku), [dept, category, sku]);

  // Prefill fields by scraping the product page
  async function prefillFromUrl() {
    const u = (url || "").trim();
    if (!u) {
      alert("Please paste a product URL first.");
      return;
    }
    try {
      // Optional: simple loading state via button disabled text
      const btn = document.getElementById("kanban-prefill-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Prefilling…"; }

      const qs = new URLSearchParams({ url: u });
      const r = await fetch(`${BACKEND}/api/kanban/scrape?${qs}`, {
        method: "GET",
        credentials: "include",
      });
      const j = await r.json();

      if (!r.ok || !j.ok) {
        throw new Error(j?.error || `Failed to scrape (HTTP ${r.status})`);
      }

      // Map result to our fields
      if (j.title) setItemName((prev) => prev || j.title);
      if (j.image) setPhotoUrl((prev) => prev || j.image);
      if (j.price) setCostPerPkg((prev) => prev || String(j.price));
      if (j.canonical) setUrl(j.canonical);

      // Heuristic: if itemName still blank, suggest deriving from URL
      if (!itemName && !j.title) {
        try {
          const urlObj = new URL(u);
          const slug = (urlObj.pathname || "").split("/").filter(Boolean).pop() || "";
          if (slug) setItemName(slug.replace(/[-_]+/g, " "));
        } catch {}
      }
    } catch (e) {
      alert(String(e));
    } finally {
      const btn = document.getElementById("kanban-prefill-btn");
      if (btn) { btn.disabled = false; btn.textContent = "Prefill from URL"; }
    }
  }


  function next() { setStep((s) => Math.min(6, s + 1)); }
  function back() { setStep((s) => Math.max(1, s - 1)); }

  async function save() {
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

    const r = await fetch(`${BACKEND}/api/kanban/upsert-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      alert(`Save failed (HTTP ${r.status}) ${t}`);
      return;
    }
    // Go back to queue
    window.location.href = "/kanban/queue";
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>New Kanban</h1>
        <a href="/kanban/queue" style={{ color: "#2563eb", textDecoration: "underline" }}>← Back to Queue</a>
      </div>

      {/* Stepper */}
      <p style={{ color: "#6b7280", marginTop: 6 }}>Step {step} of 6</p>

      <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ height: 4, background: "#111827", width: `${(step/6)*100}%` }} />

        <div style={{ padding: 16, display: "grid", gap: 14 }}>
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>How do you order this?</h2>
              <div style={{ display: "grid", gap: 10 }}>
                <label>
                  <input
                    type="radio"
                    name="meth"
                    checked={orderMethod === "Online"}
                    onChange={() => setOrderMethod("Online")}
                    style={{ marginRight: 8 }}
                  />
                  Online (URL)
                </label>
                <label>
                  <input
                    type="radio"
                    name="meth"
                    checked={orderMethod === "Email"}
                    onChange={() => setOrderMethod("Email")}
                    style={{ marginRight: 8 }}
                  />
                  Email
                </label>

                {orderMethod === "Online" ? (
                  <div>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>Product URL</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://vendor.com/product"
                        style={{ ...inp, flex: 1 }}
                      />
                      <button
                        id="kanban-prefill-btn"
                        type="button"
                        onClick={prefillFromUrl}
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
                        title="Scrape title / image / price from the product page"
                      >
                        Prefill from URL
                      </button>
                    </div>
                    <p style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                      The prefill grabs the page’s title, a product image, approximate price, and canonical URL.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>Order Email</div>
                    <input
                      value={orderEmail}
                      onChange={(e) => setOrderEmail(e.target.value)}
                      placeholder="purchasing@vendor.com"
                      style={inp}
                    />
                  </div>
                )}

                ) : (
                  <div>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>Order Email</div>
                    <input
                      value={orderEmail}
                      onChange={(e) => setOrderEmail(e.target.value)}
                      placeholder="purchasing@vendor.com"
                      style={inp}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Item basics</h2>
              <div style={grid2}>
                <Field label="Item Name" value={itemName} setValue={setItemName} />
                <Field label="SKU" value={sku} setValue={setSku} mono />
                <Field label="Dept" value={dept} setValue={setDept} />
                <Field label="Category" value={category} setValue={setCategory} />
                <Field label="Location" value={location} setValue={setLocation} />
                <Field label="Package Size" value={packageSize} setValue={setPackageSize} placeholder="e.g., 6 rolls/case" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>2-Bin & Ordering</h2>
              <div style={grid3}>
                <Field label="Bin Qty (units)" value={binQtyUnits} setValue={setBinQtyUnits} mono />
                <Field label="Case Multiple" value={caseMultiple} setValue={setCaseMultiple} mono />
                <Field label="Reorder Qty (basis)" value={reorderQtyBasis} setValue={setReorderQtyBasis} mono />
                <Select
                  label="Units Basis"
                  value={unitsBasis}
                  setValue={setUnitsBasis}
                  options={["units", "cases"]}
                />
                <Field label="Lead Time (days)" value={leadTimeDays} setValue={setLeadTimeDays} mono />
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Supplier</h2>
              <div style={grid3}>
                <Field label="Supplier" value={supplier} setValue={setSupplier} />
                <Field label="Supplier SKU" value={supplierSku} setValue={setSupplierSku} mono />
                <Field label="Cost (per pkg)" value={costPerPkg} setValue={setCostPerPkg} mono />
                <Select label="Substitutes (Y/N)" value={substitutes} setValue={setSubstitutes} options={["Y", "N"]} />
                <Field label="Notes" value={notes} setValue={setNotes} />
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Photo</h2>
              <p style={{ color: "#6b7280", marginBottom: 8 }}>
                Next iteration we’ll add a “Take Photo” camera button with crop/resize. For now, paste a hosted image URL.
              </p>
              <Field label="Photo URL" value={photoUrl} setValue={setPhotoUrl} placeholder="https://..." />
              {photoUrl ? (
                <img src={photoUrl} alt="" style={{ width: 120, height: 120, objectFit: "cover", marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 8 }} />
              ) : null}
            </div>
          )}

          {step === 6 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Preview</h2>
              <div style={{ display: "grid", gap: 8 }}>
                <div><b>Kanban ID:</b> <code>{kanbanId}</code></div>
                <div><b>Item:</b> {itemName || "(unnamed)"} <span style={{ color: "#6b7280" }}>({sku})</span></div>
                <div><b>Order via:</b> {orderMethod === "Online" ? (url || "(missing link)") : (orderEmail || "(missing email)")}</div>
                <div><b>Supplier:</b> {supplier || "(none)"} | <b>Lead Time:</b> {leadTimeDays || "-"} days</div>
                {photoUrl ? <img src={photoUrl} alt="" style={{ width: 120, height: 120, objectFit: "cover", border: "1px solid #e5e7eb", borderRadius: 8 }} /> : null}
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
            {step < 6 ? (
              <button
                onClick={next}
                style={btnPrimary}
                disabled={!canContinue(step, { orderMethod, url, orderEmail, itemName, sku })}
                title={!canContinue(step, { orderMethod, url, orderEmail, itemName, sku }) ? "Please complete required fields" : ""}
              >
                Next
              </button>
            ) : (
              <button onClick={save} style={btnPrimary}>Save Kanban</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function canContinue(step, ctx) {
  if (step === 1) {
    if (ctx.orderMethod === "Online") return !!ctx.url;
    return !!ctx.orderEmail;
  }
  if (step === 2) return !!ctx.itemName && !!ctx.sku;
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
