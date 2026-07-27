import React, { useEffect, useMemo, useState } from "react";
import "react-image-crop/dist/ReactCrop.css";
import ReactCrop from "react-image-crop";

const BACKEND = "https://machine-scheduler-backend.onrender.com";

const LOCATIONS = [
  "Kitchen",
  "Cut",
  "Fur",
  "Print",
  "Embroidery",
  "Sewing",
  "Shipping",
];

async function findNextKanbanId(dept, category, sku) {
  const base = (() => {
    const d = (dept || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3);
    const c = (category || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 4);
    const s = (sku || "SKU").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3);
    return `K-${d}-${c}-${s}-`;
  })();

  for (let i = 1; i <= 99; i++) {
    const suffix = String(i).padStart(2, "0");
    const candidate = `${base}${suffix}`;
    try {
      const r = await fetch(
        `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(candidate)}`,
        { credentials: "omit" }
      );
      if (r.status === 404) return candidate;
    } catch {
      // try next
    }
  }
  return `${base}${Date.now().toString().slice(-2)}`;
}

function getLocationStyles(locKey) {
  const k = (locKey || "").toLowerCase().trim();
  const COLORS = {
    black: "#111827",
    gray: "#9CA3AF",
    royal: "#1D4ED8",
    kelly: "#10B981",
    purple: "#7E22CE",
    orange: "#F97316",
    teal: "#0D9488",
    white: "#FFFFFF",
    text: "#111827",
    light: "#F3F4F6",
  };
  let bg = COLORS.light;
  let text = COLORS.text;
  if (k === "kitchen") {
    bg = COLORS.black;
    text = COLORS.white;
  } else if (k === "cut") {
    bg = COLORS.gray;
  } else if (k === "fur") {
    bg = COLORS.royal;
    text = COLORS.white;
  } else if (k === "print") {
    bg = COLORS.kelly;
  } else if (k === "sewing") {
    bg = COLORS.purple;
    text = COLORS.white;
  } else if (k === "shipping") {
    bg = COLORS.orange;
  } else if (k === "embroidery") {
    bg = COLORS.teal;
    text = COLORS.white;
  }
  return { bg, text };
}

function formatPricePreview(raw) {
  const s = String(raw || "").trim();
  if (!s) return "—";
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? s : `$${n.toFixed(2)}`;
}

export default function KanbanWizard() {
  const editId = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("edit") || "";
    } catch {
      return "";
    }
  }, []);

  const [phase, setPhase] = useState(editId ? "card" : "method"); // method | card
  const [orderMethod, setOrderMethod] = useState("Online");
  const [editingId, setEditingId] = useState(editId || "");
  const [loadingEdit, setLoadingEdit] = useState(!!editId);

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
  const [photoUrl, setPhotoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [crop, setCrop] = useState({ unit: "%", width: 80, x: 10, y: 10 });
  const [completedCrop, setCompletedCrop] = useState(null);
  const cropImageRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [showCamera, setShowCamera] = useState(false);

  useEffect(() => {
    if (!editId) return;
    let alive = true;
    (async () => {
      try {
        setLoadingEdit(true);
        const r = await fetch(
          `${BACKEND}/api/kanban/get-item?id=${encodeURIComponent(editId)}`,
          { credentials: "omit" }
        );
        if (!r.ok) throw new Error(`Could not load kanban ${editId}`);
        const j = await r.json();
        const item = j?.item;
        if (!item) throw new Error("Item not found");
        if (!alive) return;

        const method = String(item.orderMethod || "Online").trim() || "Online";
        setOrderMethod(method === "Email" ? "Email" : "Online");
        setEditingId(item.kanbanId || item["Kanban ID"] || editId);
        setUrl(String(item.orderUrl || "").trim());
        setOrderEmail(String(item.orderEmail || item.contactInfo || "").trim());
        setItemName(String(item.itemName || "").trim());
        setSku(String(item.sku || "").trim());
        setDept(String(item.dept || "Facilities").trim() || "Facilities");
        setCategory(String(item.category || "").trim());
        setLocation(
          LOCATIONS.includes(item.location) ? item.location : LOCATIONS[0]
        );
        setPackageSize(String(item.packageSize || "").trim());
        setBinQtyUnits(String(item.binQtyUnits ?? "").trim());
        setCaseMultiple(String(item.caseMultiple ?? "").trim());
        setReorderQtyBasis(String(item.reorderQtyBasis ?? "").trim());
        setUnitsBasis(String(item.unitsBasis || "cases").trim() || "cases");
        setLeadTimeDays(String(item.leadTimeDays ?? "").trim());
        setSupplier(String(item.supplier || item.vendorName || "").trim());
        setSupplierSku(String(item.supplierSku || "").trim());
        setCostPerPkg(String(item.costPerPkg ?? "").trim());
        setSubstitutes(String(item.substitutes || "Y").trim() || "Y");
        setNotes(String(item.notes || "").trim());
        setPhotoUrl(String(item.photoUrl || "").trim());
        setPhase("card");
      } catch (e) {
        if (!alive) return;
        alert(String(e?.message || e));
        setPhase("method");
      } finally {
        if (alive) setLoadingEdit(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId]);

  function clearFieldError(key) {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
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
    clearFieldError("photoUrl");
  }

  function openCropFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || "");
      setPhotoUrl(data);
      setCropSrc(data);
      setCropModalOpen(true);
      clearFieldError("photoUrl");
    };
    reader.readAsDataURL(file);
  }

  function validate() {
    const errs = {};
    if (orderMethod === "Online") {
      if (!String(url).trim()) errs.url = "Product URL is required.";
    } else if (!String(orderEmail).trim()) {
      errs.orderEmail = "Contact info is required.";
    }
    if (!String(supplier).trim()) errs.supplier = "Vendor is required.";
    if (!String(itemName).trim()) errs.itemName = "Item name is required.";
    if (!String(dept).trim()) errs.dept = "Dept is required.";
    if (!String(location).trim()) errs.location = "Location is required.";
    if (!String(packageSize).trim()) errs.packageSize = "Package size is required.";
    if (!String(costPerPkg).trim()) errs.costPerPkg = "Price is required.";
    if (!String(photoUrl).trim()) errs.photoUrl = "Photo is required.";
    if (!String(binQtyUnits).trim()) errs.binQtyUnits = "Bin qty is required.";
    if (!String(leadTimeDays).trim()) errs.leadTimeDays = "Lead time is required.";
    if (!String(reorderQtyBasis).trim())
      errs.reorderQtyBasis = "Reorder qty is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function save() {
    if (!validate()) {
      alert("Fill in the highlighted fields on the card and details below.");
      return;
    }

    const finalId = editingId || (await findNextKanbanId(dept, category, sku));

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
      await new Promise((r) => setTimeout(r, 50));
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

  const { bg: locBg, text: locText } = getLocationStyles(location);
  const contactDisplay =
    orderMethod === "Email"
      ? orderEmail || "—"
      : url
        ? "See Product Link QR"
        : "—";

  if (loadingEdit) {
    return <div style={{ padding: 24 }}>Loading kanban…</div>;
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
          {editingId ? `Edit Kanban` : "New Kanban"}
        </h1>
        <a
          href="/kanban/queue"
          style={{ color: "#2563eb", textDecoration: "underline" }}
        >
          ← Back to Queue
        </a>
      </div>

      {phase === "method" && (
        <div
          style={{
            marginTop: 20,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 20,
            maxWidth: 520,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0 }}>
            How do you order this?
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            <button
              type="button"
              onClick={() => {
                setOrderMethod("Online");
                setPhase("card");
              }}
              style={{
                ...choiceBtn,
                background: "#111827",
                color: "white",
              }}
            >
              Order Online
            </button>
            <button
              type="button"
              onClick={() => {
                setOrderMethod("Email");
                setPhase("card");
              }}
              style={choiceBtn}
            >
              Create Manual Kanban
            </button>
          </div>
        </div>
      )}

      {phase === "card" && (
        <>
          <p style={{ color: "#6b7280", marginTop: 8, marginBottom: 0 }}>
            Fill out the card below — it matches what you’ll print.
            {editingId ? (
              <span style={{ marginLeft: 8, fontFamily: "ui-monospace, monospace" }}>
                {editingId}
              </span>
            ) : null}
          </p>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "minmax(280px, 420px) minmax(260px, 1fr)",
              gap: 28,
              alignItems: "start",
            }}
            className="wizardLayout"
          >
            {/* LIVE CARD — mirrors KanbanCardPreview front */}
            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "2 / 3",
                boxSizing: "border-box",
                background: "white",
                borderRadius: 14,
                border: "0.9pt solid #9ca3af",
                padding: "12px 12px 16px",
                display: "grid",
                gridTemplateRows: "auto auto 1fr",
                gap: 8,
                overflow: "hidden",
                boxShadow: "0 10px 28px rgba(17,24,39,0.08)",
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: "clamp(18px, 4.2vw, 26px)",
                  letterSpacing: 0.3,
                  textAlign: "center",
                }}
              >
                KANBAN CARD
              </div>

              {/* Location banner = select */}
              <div style={{ position: "relative" }}>
                <select
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    clearFieldError("location");
                  }}
                  aria-label="Location"
                  style={{
                    width: "100%",
                    appearance: "none",
                    WebkitAppearance: "none",
                    background: locBg,
                    color: locText,
                    textAlign: "center",
                    textAlignLast: "center",
                    fontWeight: 900,
                    fontSize: "clamp(16px, 3.8vw, 24px)",
                    padding: "10px 28px",
                    borderRadius: 10,
                    border: fieldErrors.location
                      ? "2px solid #ef4444"
                      : "none",
                    cursor: "pointer",
                    outline: "none",
                  }}
                >
                  {LOCATIONS.map((o) => (
                    <option key={o} value={o} style={{ color: "#111827" }}>
                      {o}
                    </option>
                  ))}
                </select>
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: locText,
                    opacity: 0.85,
                    pointerEvents: "none",
                    fontSize: 12,
                  }}
                >
                  ▼
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateRows: "1fr 1fr 1fr",
                  gap: 10,
                  minHeight: 0,
                  fontSize: "clamp(13px, 2.8vw, 18px)",
                }}
              >
                {/* TOP: photo + name/price/vendor */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    alignItems: "center",
                    minHeight: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Click to add or change photo"
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      padding: 0,
                      border: fieldErrors.photoUrl
                        ? "2px solid #ef4444"
                        : "1px solid #e5e7eb",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "#f9fafb",
                      cursor: "pointer",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          color: "#9ca3af",
                          fontSize: 12,
                          fontWeight: 700,
                          padding: 8,
                          textAlign: "center",
                        }}
                      >
                        Tap to add photo
                      </div>
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => {
                      openCropFromFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />

                  <div
                    style={{
                      display: "grid",
                      rowGap: 8,
                      textAlign: "center",
                      justifyItems: "stretch",
                      minWidth: 0,
                    }}
                  >
                    <CardInput
                      value={itemName}
                      onChange={(v) => {
                        setItemName(v);
                        clearFieldError("itemName");
                      }}
                      placeholder="Item name"
                      error={!!fieldErrors.itemName}
                      style={{
                        fontWeight: 900,
                        fontSize: "clamp(16px, 3.2vw, 28px)",
                        lineHeight: 1.1,
                        textAlign: "center",
                      }}
                    />

                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "baseline",
                        justifyContent: "center",
                        fontSize: "clamp(14px, 2.6vw, 20px)",
                      }}
                    >
                      <span style={{ opacity: 0.85 }}>Price:</span>
                      <CardInput
                        value={costPerPkg}
                        onChange={(v) => {
                          setCostPerPkg(v);
                          clearFieldError("costPerPkg");
                        }}
                        placeholder="0.00"
                        error={!!fieldErrors.costPerPkg}
                        style={{
                          fontWeight: 800,
                          width: 88,
                          textAlign: "left",
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: "clamp(11px, 2vw, 14px)",
                        lineHeight: 1.35,
                        opacity: 0.55,
                      }}
                    >
                      {formatPricePreview(costPerPkg)}
                    </div>

                    <div
                      style={{
                        fontSize: "clamp(11px, 2.2vw, 14px)",
                        lineHeight: 1.3,
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 4,
                          alignItems: "center",
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ opacity: 0.8, flexShrink: 0 }}>
                          Vendor:
                        </span>
                        <CardInput
                          value={supplier}
                          onChange={(v) => {
                            setSupplier(v);
                            clearFieldError("supplier");
                          }}
                          placeholder="Vendor"
                          error={!!fieldErrors.supplier}
                          style={{ fontWeight: 600, flex: 1, minWidth: 0 }}
                        />
                      </div>
                      <div style={{ opacity: 0.8 }}>
                        Contact:{" "}
                        <span style={{ fontWeight: 600, color: "#111827" }}>
                          {contactDisplay}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* MIDDLE: bin + reorder */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    alignContent: "center",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      alignContent: "center",
                      justifyItems: "center",
                      rowGap: 4,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        opacity: 0.8,
                        fontSize: "clamp(13px, 2.4vw, 18px)",
                      }}
                    >
                      Bin Qty (units):
                    </div>
                    <CardInput
                      value={binQtyUnits}
                      onChange={(v) => {
                        setBinQtyUnits(v);
                        clearFieldError("binQtyUnits");
                      }}
                      placeholder="—"
                      error={!!fieldErrors.binQtyUnits}
                      style={{
                        fontWeight: 800,
                        fontSize: "clamp(18px, 3.2vw, 26px)",
                        textAlign: "center",
                        width: "70%",
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "grid",
                      alignContent: "center",
                      justifyItems: "center",
                      rowGap: 4,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        opacity: 0.8,
                        fontSize: "clamp(13px, 2.4vw, 18px)",
                      }}
                    >
                      Reorder Qty (basis):
                    </div>
                    <CardInput
                      value={reorderQtyBasis}
                      onChange={(v) => {
                        setReorderQtyBasis(v);
                        clearFieldError("reorderQtyBasis");
                      }}
                      placeholder="—"
                      error={!!fieldErrors.reorderQtyBasis}
                      style={{
                        fontWeight: 800,
                        fontSize: "clamp(18px, 3.2vw, 26px)",
                        textAlign: "center",
                        width: "70%",
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      }}
                    />
                  </div>
                </div>

                {/* BOTTOM: QR placeholders */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    alignItems: "start",
                    gap: 6,
                    padding: "4px 4px 0",
                  }}
                >
                  <QrPlaceholder
                    label="Product Link"
                    hint={
                      orderMethod === "Online"
                        ? url
                          ? "Ready after save"
                          : "Needs URL →"
                        : orderEmail
                          ? "Ready after save"
                          : "Needs contact →"
                    }
                  />
                  <QrPlaceholder label="Reorder Request QR" hint="After save" />
                  <QrPlaceholder label="Receive Delivery QR" hint="After save" />
                </div>
              </div>

              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  boxSizing: "border-box",
                  border: "1pt dotted #e5e7eb",
                  pointerEvents: "none",
                  borderRadius: 14,
                }}
              />
            </div>

            {/* OFF-CARD DETAILS */}
            <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 16,
                  display: "grid",
                  gap: 12,
                  background: "#fafafa",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 15 }}>
                    Ordering &amp; details
                  </div>
                  <button
                    type="button"
                    onClick={() => setPhase("method")}
                    style={{
                      ...btnSecondary,
                      padding: "6px 10px",
                      fontSize: 13,
                    }}
                  >
                    {orderMethod === "Online" ? "Online" : "Manual"} · change
                  </button>
                </div>

                {orderMethod === "Online" ? (
                  <Field
                    label="Product URL (required — Product Link QR)"
                    value={url}
                    setValue={setUrl}
                    placeholder="https://vendor.com/product"
                    error={fieldErrors.url}
                    onEdit={() => clearFieldError("url")}
                  />
                ) : (
                  <Field
                    label="Contact info (email or phone — shown on card)"
                    value={orderEmail}
                    setValue={setOrderEmail}
                    placeholder="purchasing@vendor.com or 555-123-4567"
                    error={fieldErrors.orderEmail}
                    onEdit={() => clearFieldError("orderEmail")}
                  />
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <Field
                    label="Dept (required)"
                    value={dept}
                    setValue={setDept}
                    error={fieldErrors.dept}
                    onEdit={() => clearFieldError("dept")}
                  />
                  <Field
                    label="Package Size (required)"
                    value={packageSize}
                    setValue={setPackageSize}
                    error={fieldErrors.packageSize}
                    onEdit={() => clearFieldError("packageSize")}
                  />
                  <Field
                    label="Lead Time (days) — required"
                    value={leadTimeDays}
                    setValue={setLeadTimeDays}
                    mono
                    error={fieldErrors.leadTimeDays}
                    onEdit={() => clearFieldError("leadTimeDays")}
                  />
                  <Field
                    label="Category (optional)"
                    value={category}
                    setValue={setCategory}
                  />
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 16,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 15 }}>Photo tools</div>
                {fieldErrors.photoUrl ? (
                  <div style={{ color: "#b91c1c", fontSize: 13 }}>
                    {fieldErrors.photoUrl}
                  </div>
                ) : (
                  <div style={{ color: "#6b7280", fontSize: 13 }}>
                    Tap the photo on the card, or use camera / URL below.
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={btnSecondary}
                    onClick={() => setShowCamera((v) => !v)}
                  >
                    {showCamera ? "Hide camera" : "Use camera"}
                  </button>
                  {photoUrl ? (
                    <button
                      type="button"
                      style={btnSecondary}
                      onClick={() => {
                        setCropSrc(photoUrl);
                        setCropModalOpen(true);
                      }}
                    >
                      Crop photo
                    </button>
                  ) : null}
                </div>

                {showCamera ? (
                  <CameraCapture
                    onCapture={(img) => {
                      setPhotoUrl(img);
                      setCropSrc(img);
                      setCropModalOpen(true);
                      clearFieldError("photoUrl");
                    }}
                  />
                ) : null}

                <input
                  value={photoUrl.startsWith("data:") ? "" : photoUrl}
                  onChange={(e) => {
                    setPhotoUrl(e.target.value);
                    clearFieldError("photoUrl");
                  }}
                  placeholder="Or paste image URL…"
                  style={inp}
                />
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={save} style={btnPrimary}>
                  {editingId ? "Save changes" : "Save Kanban"}
                </button>
                <a
                  href="/kanban/queue"
                  style={{
                    ...btnSecondary,
                    display: "inline-flex",
                    alignItems: "center",
                    textDecoration: "none",
                  }}
                >
                  Cancel
                </a>
              </div>

              {Object.keys(fieldErrors).length > 0 ? (
                <div
                  style={{
                    color: "#b91c1c",
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}
                >
                  Missing:{" "}
                  {Object.values(fieldErrors).join(" ")}
                </div>
              ) : null}
            </div>
          </div>

          <style>{`
            @media (max-width: 820px) {
              .wizardLayout {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </>
      )}

      {saving && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(250, 204, 21, 0.9)",
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
                alt=""
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
                type="button"
                onClick={() => setCropModalOpen(false)}
                style={btnSecondary}
              >
                Cancel
              </button>
              <button type="button" onClick={applyCrop} style={btnPrimary}>
                Apply Crop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CardInput({ value, onChange, placeholder, error, style }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        border: error ? "1px solid #fca5a5" : "1px solid transparent",
        borderRadius: 6,
        padding: "2px 4px",
        outline: "none",
        background: error ? "#fef2f2" : "rgba(243,244,246,0.55)",
        width: "100%",
        boxSizing: "border-box",
        minWidth: 0,
        ...style,
      }}
      onFocus={(e) => {
        e.target.style.background = "#fff";
        e.target.style.border = error
          ? "1px solid #fca5a5"
          : "1px solid #d1d5db";
      }}
      onBlur={(e) => {
        e.target.style.background = error
          ? "#fef2f2"
          : "rgba(243,244,246,0.55)";
        e.target.style.border = error
          ? "1px solid #fca5a5"
          : "1px solid transparent";
      }}
    />
  );
}

function QrPlaceholder({ label, hint }) {
  return (
    <div
      style={{
        display: "grid",
        rowGap: 4,
        justifyItems: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "58%",
          maxWidth: 88,
          aspectRatio: "1 / 1",
          border: "1px dashed #d1d5db",
          borderRadius: 6,
          background:
            "repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%) 50% / 10px 10px",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          fontSize: "clamp(10px, 1.8vw, 13px)",
          fontWeight: 700,
          lineHeight: 1.15,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#9ca3af",
          lineHeight: 1.15,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

function CameraCapture({ onCapture }) {
  const videoRef = React.useRef(null);
  const [stream, setStream] = React.useState(null);

  React.useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

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
    onCapture(canvas.toDataURL("image/jpeg", 0.9));
  }

  return (
    <div style={{ marginTop: 4 }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: "100%", maxWidth: 320, borderRadius: 8 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" onClick={startCamera} style={btnSecondary}>
          Start Camera
        </button>
        <button type="button" onClick={takePhoto} style={btnSecondary}>
          Take Photo
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, setValue, placeholder, mono, error, onEdit }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onEdit?.();
        }}
        placeholder={placeholder}
        style={{
          ...inp,
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            : "inherit",
          border: error ? "1px solid #fca5a5" : inp.border,
          boxShadow: error ? "0 0 0 1px #fecaca" : undefined,
        }}
      />
      {error ? (
        <div style={{ color: "#b91c1c", fontSize: 13, lineHeight: 1.35 }}>
          {error}
        </div>
      ) : null}
    </label>
  );
}

const choiceBtn = {
  padding: "18px 16px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "white",
  color: "#111827",
  fontWeight: 800,
  fontSize: 16,
  cursor: "pointer",
};

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
