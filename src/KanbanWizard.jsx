import React, { useMemo, useState } from "react";
import 'react-image-crop/dist/ReactCrop.css';
import ReactCrop from "react-image-crop";




const BACKEND = "https://machine-scheduler-backend.onrender.com";

// Required locations list (must match your preview styling keys)
const LOCATIONS = ["Kitchen","Cut","Fur","Print","Embroidery","Sewing","Shipping"];

// Simple Kanban ID helper: K-<DEPT>-<CAT>-<SKU>-01
function makeKanbanId(dept, category, sku) {
  const d = (dept || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3);
  const c = (category || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 4);
  const s = (sku || "SKU").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3);
  return `K-${d}-${c}-${s}-01`;
}

// Find the first available ID by probing /api/kanban/get-item
async function findNextKanbanId(dept, category, sku) {
  const base = (() => {
    const d = (dept || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0,3);
    const c = (category || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0,4);
    const s = (sku || "SKU").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0,3);
    return `K-${d}-${c}-${s}-`;
  })();

  for (let i = 1; i <= 99; i++) {
    const suffix = String(i).padStart(2, "0");
    const candidate = `${base}${suffix}`;
    try {
      const r = await fetch(`${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(candidate)}`, {
        credentials: "omit",
      });
      if (r.status === 404) {
        // not found → available
        return candidate;
      }
      // if r.ok (200), it exists; keep trying next suffix
    } catch {
      // transient error → try next
    }
  }
  // fallback (should never happen)
  return `${base}${Date.now().toString().slice(-2)}`;
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
  const [location, setLocation] = useState(LOCATIONS[0]);
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
  const [cameraImage, setCameraImage] = useState(null); // base64 jpeg
  const [saving, setSaving] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);        // original image (camera or URL)
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [crop, setCrop] = useState({ unit: "%", width: 80, x: 10, y: 10 });
  const [croppedImage, setCroppedImage] = useState(null);
  const cropImageRef = React.useRef(null);
  const [completedCrop, setCompletedCrop] = useState(null);



  const kanbanId = useMemo(() => makeKanbanId(dept, category, sku), [dept, category, sku]);

  function CameraCapture({ onCapture }) {
    const videoRef = React.useRef(null);
    const [stream, setStream] = React.useState(null);

    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        videoRef.current.srcObject = s;
        setStream(s);
      } catch (e) {
        alert("Camera error: " + e.message);
      }
    }

    function takePhoto() {
      const video = videoRef.current;
      if (!video) return;

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);

      const img = canvas.toDataURL("image/jpeg", 0.9);
      onCapture(img);
    }

    function applyCrop() {
      if (!completedCrop || !cropImageRef.current) return;

      const img = cropImageRef.current;
      const canvas = document.createElement("canvas");
      const scaleX = img.naturalWidth / img.width;
      const scaleY = img.naturalHeight / img.height;

      canvas.width = completedCrop.width * scaleX;
      canvas.height = completedCrop.height * scaleY;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const base64 = canvas.toDataURL("image/jpeg", 0.9);
      setPhotoUrl(base64);
      setCropModalOpen(false);
    }


    return (
      <div style={{ marginTop: 12 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: "100%", maxWidth: 320, borderRadius: 8 }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={startCamera} style={{ padding: "8px 12px" }}>
            Start Camera
          </button>
          <button type="button" onClick={takePhoto} style={{ padding: "8px 12px" }}>
            Take Photo
          </button>
        </div>
      </div>
    );
  }



  function next() { setStep((s) => Math.min(3, s + 1)); }
  function back() { setStep((s) => Math.max(1, s - 1)); }

  async function save() {
    if (!location || !location.trim()) {
      alert("Location is required.");
      setStep(2);
      return;
    }
    // Hard-required fields across steps
    if (!String(itemName).trim())       return alert("Item Name is required.");
    if (!String(dept).trim())           return alert("Dept is required.");
    if (!String(packageSize).trim())    return alert("Package Size is required.");
    if (!String(costPerPkg).trim())     return alert("Cost (per pkg) is required.");
    if (!String(photoUrl).trim()) {
      return alert("A photo is required. Use camera OR photo URL.");
    }


    if (orderMethod === "Online" && !String(url).trim())
      return alert("Product URL is required for Online order method.");
    if (orderMethod === "Email" && !String(orderEmail).trim())
      return alert("Contact info (email or phone) is required for a manual Kanban.");

    if (!String(supplier).trim())
      return alert("Vendor name is required.");

    // Step 3 requireds (your labels already say required)
    if (!String(binQtyUnits).trim())      return alert("Bin Qty (units) is required.");
    if (!String(leadTimeDays).trim())     return alert("Lead Time (days) is required.");
    if (!String(reorderQtyBasis).trim())  return alert("Reorder Qty (basis) is required.");


    // Compute the first free ID like K-<DEPT>-<CAT>-<SKU>-02 if ...-01 exists
    const finalId = await findNextKanbanId(dept, category, sku);

    const payload = {
      kanbanId: finalId,
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
      window.location.href = `/kanban/preview/${encodeURIComponent(finalId)}`;
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
                  Create Manual Kanban
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                {orderMethod === "Online"
                  ? "Order Online — Details"
                  : "Create Manual Kanban — Details"}
              </h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
               {orderMethod === "Online" ? (
                 <Field
                   label="Product URL (required)"
                   value={url}
                   setValue={setUrl}
                   placeholder="https://vendor.com/product"
                 />
               ) : (
                 <Field
                   label="Contact info (email or phone — required)"
                   value={orderEmail}
                   setValue={setOrderEmail}
                   placeholder="purchasing@vendor.com or 555-123-4567"
                 />
               )}

               <Field
                 label="Vendor name (required)"
                 value={supplier}
                 setValue={setSupplier}
               />

               <Field
                 label="Item Name (required)"
                 value={itemName}
                 setValue={setItemName}
               />

               {/* PHOTO SECTION */}
               <div style={{ display: "grid", gap: 8 }}>
                 <div style={{ fontWeight: 600 }}>Photo</div>

                 {/* Webcam Capture */}
                 <CameraCapture
                   onCapture={(img) => {
                     setPhotoUrl(img);
                     setCropSrc(img);
                     setCropModalOpen(true);
                   }}
                 />

                 {/* Crop Button */}
                 {photoUrl && (
                   <button
                     type="button"
                     style={btnSecondary}
                     onClick={() => {
                       setCropSrc(photoUrl);
                       setCropModalOpen(true);
                     }}
                   >
                     Crop Photo
                   </button>
                 )}

                 {/* Photo URL */}
                 <input
                   value={photoUrl.startsWith("data:") ? "" : photoUrl}
                   onChange={(e) => {
                     setPhotoUrl(e.target.value);
                     setCameraImage(null);
                   }}
                   placeholder="https://image..."
                   style={inp}
                 />

                 {/* Preview */}
                 {photoUrl && (
                   <img
                     src={photoUrl}
                     alt=""
                     style={{
                       width: 140,
                       height: 140,
                       objectFit: "cover",
                       borderRadius: 8,
                       border: "1px solid #e5e7eb",
                       marginTop: 8
                     }}
                   />
                 )}
               </div>

               <Field label="Dept (required)" value={dept} setValue={setDept} />
               <Select label="Location (required)" value={location} setValue={setLocation} options={LOCATIONS} />
               <Field label="Package Size (required)" value={packageSize} setValue={setPackageSize} />
               <Field label="Cost (per pkg) — required" value={costPerPkg} setValue={setCostPerPkg} mono />
               <Field label="Category (optional)" value={category} setValue={setCategory} />

            </div>
          </div>
          )}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                2-Bin & Ordering
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                }}
              >
                <Field
                  label="Bin Qty (units) — required"
                  value={binQtyUnits}
                  setValue={setBinQtyUnits}
                  mono
                />
                <Field
                  label="Lead Time (days) — required"
                  value={leadTimeDays}
                  setValue={setLeadTimeDays}
                  mono
                />
                <Field
                  label="Reorder Qty (basis) — required"
                  value={reorderQtyBasis}
                  setValue={setReorderQtyBasis}
                  mono
                />
              </div>
            </div>
          )} {/* CLOSE STEP 3 */}
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
                    (step === 2 &&
                      (orderMethod === "Online"
                        ? (!url || !supplier)
                        : (!orderEmail || !supplier))) ||
                    (step === 2 &&
                      (!itemName || !dept || !packageSize || !costPerPkg || !photoUrl))
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

    {cropModalOpen && cropSrc && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          display: "grid",
          placeItems: "center",
          zIndex: 9999,
          padding: 20,
        }}
      >
        <div
          style={{
            background: "white",
            padding: 20,
            borderRadius: 12,
            maxWidth: "90vw",
            maxHeight: "90vh",
            overflow: "auto",
          }}
        >
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
          >
            <img
              ref={cropImageRef}
              src={cropSrc}
              style={{ maxWidth: "100%" }}
            />
          </ReactCrop>

          <div
            style={{
              marginTop: 12,
              textAlign: "right",
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={() => setCropModalOpen(false)}
              style={btnSecondary}
            >
              Cancel
            </button>
            <button onClick={applyCrop} style={btnPrimary}>
              Apply Crop
            </button>
          </div>
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
