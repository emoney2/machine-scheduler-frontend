import React, { useEffect, useMemo, useState } from "react";
import "react-image-crop/dist/ReactCrop.css";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";

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
  const [crop, setCrop] = useState({ unit: "%", width: 90, x: 5, y: 5 });
  const [completedCrop, setCompletedCrop] = useState(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [photoFit, setPhotoFit] = useState("contain"); // contain | cover
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const cropImageRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [fieldErrors, setFieldErrors] = useState({});

  function openCropEditor(src) {
    if (!src) return;
    setCropSrc(src);
    setCropZoom(1);
    setCrop({ unit: "%", width: 90, x: 5, y: 5 });
    setCompletedCrop(null);
    setCropModalOpen(true);
  }

  function onCropImageLoad(e) {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    const next = centerCrop(
      makeAspectCrop({ unit: "%", width: 92 }, 1, width, height),
      width,
      height
    );
    setCrop(next);
    setCompletedCrop(null);
  }

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
    if (!cropImageRef.current) return;

    const img = cropImageRef.current;
    const pixelCrop = completedCrop?.width
      ? completedCrop
      : (() => {
          // Fallback: convert % crop to displayed pixels
          const w = img.width;
          const h = img.height;
          return {
            x: ((crop.x || 0) / 100) * w,
            y: ((crop.y || 0) / 100) * h,
            width: ((crop.width || 100) / 100) * w,
            height: ((crop.height || crop.width || 100) / 100) * h,
          };
        })();

    if (!pixelCrop?.width || !pixelCrop?.height) return;

    const canvas = document.createElement("canvas");
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    canvas.width = Math.max(1, Math.round(pixelCrop.width * scaleX));
    canvas.height = Math.max(1, Math.round(pixelCrop.height * scaleY));

    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      img,
      pixelCrop.x * scaleX,
      pixelCrop.y * scaleY,
      pixelCrop.width * scaleX,
      pixelCrop.height * scaleY,
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
      clearFieldError("photoUrl");
      openCropEditor(data);
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
    if (!String(location).trim()) errs.location = "Location is required.";
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
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => setPhase("method")}
              style={{
                ...btnSecondary,
                padding: "6px 10px",
                fontSize: 13,
              }}
            >
              {orderMethod === "Online" ? "Order Online" : "Manual"} · change
            </button>
            {editingId ? (
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 13,
                  color: "#6b7280",
                }}
              >
                {editingId}
              </span>
            ) : null}
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            {/* LIVE CARD — all fields live on the card */}
            <div
              style={{
                position: "relative",
                width: "100%",
                maxWidth: 440,
                boxSizing: "border-box",
                background: "white",
                borderRadius: 14,
                border: "0.9pt solid #9ca3af",
                padding: "12px 12px 14px",
                display: "grid",
                gridTemplateRows: "auto auto auto",
                gap: 10,
                overflow: "visible",
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

              {/* Location banner */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setLocationMenuOpen((v) => !v)}
                  aria-label="Location"
                  aria-expanded={locationMenuOpen}
                  style={{
                    width: "100%",
                    background: locBg,
                    color: locText,
                    textAlign: "center",
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
                  {location || "Location"}
                  <span
                    aria-hidden
                    style={{
                      marginLeft: 10,
                      fontSize: 12,
                      opacity: 0.85,
                    }}
                  >
                    ▼
                  </span>
                </button>
                {locationMenuOpen ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "calc(100% + 4px)",
                      zIndex: 40,
                      background: "#ffffff",
                      color: "#111827",
                      border: "1px solid #d1d5db",
                      borderRadius: 10,
                      boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
                      overflow: "hidden",
                    }}
                  >
                    {LOCATIONS.map((o) => {
                      const styles = getLocationStyles(o);
                      const active = o === location;
                      return (
                        <button
                          key={o}
                          type="button"
                          onClick={() => {
                            setLocation(o);
                            clearFieldError("location");
                            setLocationMenuOpen(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            width: "100%",
                            padding: "12px 14px",
                            border: "none",
                            borderBottom: "1px solid #f3f4f6",
                            background: active ? "#f3f4f6" : "#ffffff",
                            color: "#111827",
                            fontWeight: active ? 900 : 700,
                            fontSize: 16,
                            cursor: "pointer",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 999,
                              background: styles.bg,
                              border: "1px solid #d1d5db",
                              flexShrink: 0,
                            }}
                          />
                          {o}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  fontSize: "clamp(13px, 2.8vw, 18px)",
                }}
              >
                {/* TOP: photo + name/price/vendor/contact */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    alignItems: "start",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "1 / 1",
                      border: fieldErrors.photoUrl
                        ? "2px solid #ef4444"
                        : "1px solid #e5e7eb",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "#f3f4f6",
                    }}
                  >
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: photoFit,
                          objectPosition: "center",
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "grid",
                          placeItems: "center",
                          color: "#9ca3af",
                          fontSize: 12,
                          fontWeight: 700,
                          padding: 8,
                          textAlign: "center",
                        }}
                      >
                        Add a photo
                      </div>
                    )}

                    <div
                      style={{
                        position: "absolute",
                        left: 6,
                        right: 6,
                        bottom: 6,
                        display: "flex",
                        gap: 4,
                        flexWrap: "wrap",
                        justifyContent: "center",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setCameraModalOpen(true)}
                        style={photoChipBtn}
                      >
                        Camera
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        style={photoChipBtn}
                      >
                        Upload
                      </button>
                      {photoUrl ? (
                        <button
                          type="button"
                          onClick={() => openCropEditor(photoUrl)}
                          style={photoChipBtn}
                        >
                          Resize
                        </button>
                      ) : null}
                      {photoUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPhotoFit((f) =>
                              f === "contain" ? "cover" : "contain"
                            )
                          }
                          style={photoChipBtn}
                        >
                          {photoFit === "contain" ? "Fit" : "Fill"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      openCropFromFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />

                  <div
                    style={{
                      display: "grid",
                      rowGap: 6,
                      textAlign: "center",
                      justifyItems: "stretch",
                      minWidth: 0,
                      alignContent: "start",
                    }}
                  >
                    <CardText
                      value={itemName}
                      onChange={(v) => {
                        setItemName(v);
                        clearFieldError("itemName");
                      }}
                      placeholder="Item name"
                      error={!!fieldErrors.itemName}
                      rows={2}
                      style={{
                        fontWeight: 900,
                        fontSize: "clamp(15px, 3vw, 22px)",
                        lineHeight: 1.15,
                        textAlign: "center",
                      }}
                    />

                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "baseline",
                        justifyContent: "center",
                        fontSize: "clamp(14px, 2.6vw, 17px)",
                        flexWrap: "wrap",
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
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        }}
                      />
                    </div>

                    <div
                      style={{
                        fontSize: "clamp(11px, 2.1vw, 13px)",
                        lineHeight: 1.35,
                        textAlign: "left",
                        minWidth: 0,
                      }}
                    >
                      <div style={{ opacity: 0.8, marginBottom: 2 }}>
                        Vendor:
                      </div>
                      <CardText
                        value={supplier}
                        onChange={(v) => {
                          setSupplier(v);
                          clearFieldError("supplier");
                        }}
                        placeholder="Vendor name"
                        error={!!fieldErrors.supplier}
                        rows={2}
                        style={{
                          fontWeight: 600,
                          textAlign: "left",
                          fontSize: "inherit",
                        }}
                      />
                      <div style={{ opacity: 0.8, marginTop: 6 }}>
                        {orderMethod === "Online"
                          ? "Product URL:"
                          : "Contact:"}
                      </div>
                      <CardText
                        value={
                          orderMethod === "Online" ? url : orderEmail
                        }
                        onChange={(v) => {
                          if (orderMethod === "Online") {
                            setUrl(v);
                            clearFieldError("url");
                          } else {
                            setOrderEmail(v);
                            clearFieldError("orderEmail");
                          }
                        }}
                        placeholder={
                          orderMethod === "Online"
                            ? "https://vendor.com/product"
                            : "email or phone"
                        }
                        error={
                          !!(
                            orderMethod === "Online"
                              ? fieldErrors.url
                              : fieldErrors.orderEmail
                          )
                        }
                        rows={2}
                        style={{
                          fontWeight: 600,
                          textAlign: "left",
                          fontSize: "inherit",
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* MIDDLE: bin + reorder + lead time */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                    alignContent: "center",
                  }}
                >
                  <MiniStat
                    label="Bin Qty"
                    value={binQtyUnits}
                    onChange={(v) => {
                      setBinQtyUnits(v);
                      clearFieldError("binQtyUnits");
                    }}
                    error={!!fieldErrors.binQtyUnits}
                  />
                  <MiniStat
                    label="Reorder Qty"
                    value={reorderQtyBasis}
                    onChange={(v) => {
                      setReorderQtyBasis(v);
                      clearFieldError("reorderQtyBasis");
                    }}
                    error={!!fieldErrors.reorderQtyBasis}
                  />
                  <MiniStat
                    label="Lead (days)"
                    value={leadTimeDays}
                    onChange={(v) => {
                      setLeadTimeDays(v);
                      clearFieldError("leadTimeDays");
                    }}
                    error={!!fieldErrors.leadTimeDays}
                  />
                </div>

                {/* BOTTOM: QR placeholders */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    alignItems: "start",
                    gap: 6,
                  }}
                >
                  <QrPlaceholder
                    label="Product Link"
                    hint={
                      orderMethod === "Online"
                        ? url
                          ? "Ready after save"
                          : "Add URL above"
                        : orderEmail
                          ? "Ready after save"
                          : "Add contact above"
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

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
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
                  textAlign: "center",
                  maxWidth: 440,
                }}
              >
                {Object.values(fieldErrors).join(" ")}
              </div>
            ) : null}
          </div>
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

      {cameraModalOpen ? (
        <CameraCaptureModal
          onCapture={(img) => {
            setPhotoUrl(img);
            clearFieldError("photoUrl");
            setCameraModalOpen(false);
            openCropEditor(img);
          }}
          onClose={() => setCameraModalOpen(false)}
        />
      ) : null}

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
              maxWidth: "min(920px, 96vw)",
              maxHeight: "92vh",
              overflow: "auto",
              width: "100%",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
              Crop / resize photo
            </div>
            <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>
              Drag the corners to include more of the image (zoom out). Use the
              slider if the picture is still too big on screen.
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              View size
              <input
                type="range"
                min={0.45}
                max={1.4}
                step={0.05}
                value={cropZoom}
                onChange={(e) => setCropZoom(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 40, textAlign: "right" }}>
                {Math.round(cropZoom * 100)}%
              </span>
            </label>

            <div
              style={{
                maxHeight: "58vh",
                overflow: "auto",
                background: "#111827",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                style={{
                  width: `${Math.round(cropZoom * 100)}%`,
                  margin: "0 auto",
                  minWidth: 180,
                }}
              >
                <ReactCrop
                  crop={crop}
                  aspect={1}
                  onChange={(c) => setCrop(c)}
                  onComplete={(c) => setCompletedCrop(c)}
                >
                  <img
                    ref={cropImageRef}
                    src={cropSrc}
                    alt=""
                    onLoad={onCropImageLoad}
                    style={{ width: "100%", display: "block" }}
                  />
                </ReactCrop>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                flexWrap: "wrap",
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
                Apply crop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, onChange, error }) {
  return (
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
          fontSize: "clamp(11px, 2.2vw, 14px)",
          lineHeight: 1.2,
        }}
      >
        {label}
      </div>
      <CardInput
        value={value}
        onChange={onChange}
        placeholder="—"
        error={!!error}
        style={{
          fontWeight: 800,
          fontSize: "clamp(15px, 2.8vw, 22px)",
          textAlign: "center",
          width: "90%",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      />
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

function CardText({ value, onChange, placeholder, error, style, rows = 2 }) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        border: error ? "1px solid #fca5a5" : "1px solid transparent",
        borderRadius: 6,
        padding: "4px 6px",
        outline: "none",
        background: error ? "#fef2f2" : "rgba(243,244,246,0.55)",
        width: "100%",
        boxSizing: "border-box",
        minWidth: 0,
        resize: "vertical",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        lineHeight: 1.25,
        fontFamily: "inherit",
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

function CameraCaptureModal({ onCapture, onClose }) {
  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const [error, setError] = React.useState("");
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera is not available in this browser. Use Upload instead."
          );
        }
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          video.muted = true;
          await video.play();
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    onCapture(canvas.toDataURL("image/jpeg", 0.9));
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "grid",
        placeItems: "center",
        zIndex: 10000,
        padding: 20,
      }}
    >
      <div
        style={{
          background: "white",
          padding: 20,
          borderRadius: 12,
          maxWidth: 560,
          width: "100%",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>
          Camera
        </div>
        {error ? (
          <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>
        ) : null}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            borderRadius: 8,
            background: "#111827",
            minHeight: 220,
            objectFit: "cover",
          }}
        />
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={takePhoto}
            style={btnPrimary}
            disabled={!ready || !!error}
          >
            Take photo
          </button>
        </div>
      </div>
    </div>
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

const photoChipBtn = {
  border: "none",
  borderRadius: 999,
  padding: "5px 8px",
  fontSize: 11,
  fontWeight: 800,
  background: "rgba(17,24,39,0.82)",
  color: "#fff",
  cursor: "pointer",
  lineHeight: 1.1,
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
