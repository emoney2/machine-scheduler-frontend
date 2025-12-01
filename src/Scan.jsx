// src/Scan.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const requestCache = {};

async function fetchOnce(url) {
  if (!requestCache[url]) {
    requestCache[url] = fetch(url).then(res => res.json());
  }
  return requestCache[url];
}


const API_ROOT = (process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
const IDLE_TIMEOUT_MS = 600;

// --- FAST ORDER HELPERS ---
async function fetchFastOrder(orderId) {
  const url = `${API_ROOT}/order_fast?orderNumber=${encodeURIComponent(orderId)}`;
  console.log("[Scan] fetchFastOrder →", url);
  const r = await fetch(url, { credentials: "include" });

  // ❗ fast endpoint may return 404 when cache is cold — treat that as "no fast result,"
  // NOT an error
  if (r.status === 404) {
    return null;
  }

  // handle other failures normally
  if (!r.ok) {
    let j = null;
    try { j = await r.json(); } catch {}
    throw new Error(j?.error || `HTTP ${r.status}`);
  }

  const j = await r.json();

  // Expect { order: {...}, cached: true/false }
  return j?.order || null;
}

function colorFromName(name = "") {
  // Raw string from sheet
  const raw = String(name ?? "");

  // Normalize aggressively
  const normalized = raw
    .toLowerCase()
    .replace(/fur/g, "")      // drop the word "fur" anywhere
    .replace(/[-_]/g, " ")    // treat - and _ as spaces
    .replace(/\s+/g, " ")     // collapse weird / multiple spaces
    .trim();

  const map = {
    "navy blue": "#001F5B",
    "light grey": "#D3D3D3",
    "black": "#000000",
    "white": "#FFFFFF",
    "red": "#B22222",
    "royal blue": "#4169E1",
    "hunter green": "#355E3B",
    "tan": "#D2B48C",

    // helpful synonyms
    "light gray": "#D3D3D3",
    "lt grey": "#D3D3D3",
    "lt gray": "#D3D3D3",
  };

  const value = map[normalized] || "#CCCCCC";

  // 🔍 DEBUG: log exactly what we see and choose
  console.log("[colorFromName]", {
    raw,
    normalized,
    value,
    charCodes: raw.split("").map(c => c.charCodeAt(0)),
  });

  return value;
}

function getHueFromHex(hex) {
  const rgb = hex
    .replace("#", "")
    .match(/.{1,2}/g)
    .map((x) => parseInt(x, 16) / 255);

  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  if (max === min) h = 0;
  else if (max === r) h = (60 * ((g - b) / (max - min)) + 360) % 360;
  else if (max === g) h = 60 * ((b - r) / (max - min)) + 120;
  else h = 60 * ((r - g) / (max - min)) + 240;
  return Math.round(h);
}




function normalizeFast(o) {
  if (!o || typeof o !== "object") return o;

  // clone all existing props
  const result = { ...o };

  const imagesLabeled = Array.isArray(o.imagesLabeled) ? o.imagesLabeled : [];
  const images = Array.isArray(o.images) ? o.images : [];
  const imageUrls = Array.isArray(o.imageUrls) ? o.imageUrls : [];
  const preNormalized = Array.isArray(o.imagesNormalized) ? o.imagesNormalized : [];
  const imageUrl = o.imageUrl || o.thumbnailUrl || null;
  const thumbnail = o.thumbnailUrl || imageUrl || null;

  let normalizedImages = [];

  if (preNormalized.length) {
    // ✅ use already-normalized quadrants from backend
    normalizedImages = preNormalized;
  } else if (imagesLabeled.length) {
    normalizedImages = imagesLabeled.map(img =>
      typeof img === "string" ? { src: img, label: "" } : { src: img.src, label: img.label || "" }
    );
  } else if (images.length) {
    normalizedImages = images.map(img =>
      typeof img === "string" ? { src: img, label: "" } : { src: img.src, label: img.label || "" }
    );
  } else if (imageUrls.length) {
    normalizedImages = imageUrls.map(u => ({ src: u, label: "" }));
  } else if (thumbnail) {
    normalizedImages = [{ src: thumbnail, label: "" }];
  }

  result.imagesNormalized = normalizedImages;
  result.thumbnail = thumbnail;
  result.hasImages = normalizedImages.length > 0;

  return result;
}

function extractOrderId(raw) {
  const digits = (raw || "").replace(/\D+/g, "");
  const trimmed = digits.replace(/^0+/, "");
  return trimmed || digits;
}

export default function Scan() {
  const [params] = useSearchParams();
  const dept = (params.get("dept") || "").toLowerCase();

  const allowedDepts = useMemo(
    () => new Set(["fur", "cut", "print", "embroidery", "sewing"]),
    []
  );
  const deptValid = allowedDepts.has(dept);

  const [buffer, setBuffer] = useState("");
  const bufferRef = useRef("");

  const [flash, setFlash] = useState("idle"); // idle | ok | error
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const [loading, setLoading] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState(""); // <-- for overlay
  const [errMsg, setErrMsg] = useState("");

  const [orderData, setOrderData] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState("");

  const idleTimerRef = useRef(null);
  const focusRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setLightboxSrc(""); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const focusInput = () => {
      try {
        if (focusRef.current) focusRef.current.focus();
        window.focus?.();
      } catch {}
    };
    focusInput();
    const onVis = () => {
      if (document.visibilityState === "visible") focusInput();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", focusInput);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", focusInput);
    };
  }, []);

  console.log("[Scan] v3 white theme + chart bar + labeled quadrant + yellow loading overlay");

  function flashOk() {
    setFlash("ok");
    setTimeout(() => setFlash("idle"), 200);
  }
  function flashError(msg) {
    if (msg) setErrMsg(msg);
    setFlash("error");
    setTimeout(() => setFlash("idle"), 600);
  }

async function fetchOrder(orderId) {
  if (!deptValid) return flashError("Invalid department");
  setPendingOrderId(orderId);
  setLoading(true);
  setErrMsg("");

  try {
    console.log("[Scan] fast path for order", orderId);
    const fastRow = await fetchFastOrder(orderId);

    if (fastRow) {
      console.log("[Scan] fast raw payload →", fastRow);
      console.log("[Scan] fast raw keys →", Object.keys(fastRow || {}));
      console.log("[Scan] fast raw imagesNormalized length →", Array.isArray(fastRow?.imagesNormalized) ? fastRow.imagesNormalized.length : "none");

      const quick = normalizeFast(fastRow, orderId);
      console.log("[Scan] fast normalized →", quick);
      console.log("[Scan] fast normalized keys →", Object.keys(quick || {}));
      console.log("[Scan] fast normalized imagesNormalized length →", Array.isArray(quick?.imagesNormalized) ? quick.imagesNormalized.length : "none");

      setOrderData(quick);
      setLoading(false);
    } else {
      console.log("[Scan] fast MISS (no cached row for", orderId, ")");
    }

    flashOk();
  } catch (e) {
    console.warn("[Scan] Full order fetch failed:", e);
    if (orderData) {
      console.log("[Scan] Fast data already applied — suppressing toast");
    } else {
      setOrderData(null);
      flashError("Order not found");
    }
  } finally {
    setPendingOrderId("");
    setLoading(false);
  }
}




  function handleSubmit(text, fromScan) {
    const raw = (text || "").trim();
    if (!fromScan) return flashError();
    const orderId = extractOrderId(raw);
    if (!orderId || !/^\d{1,10}$/.test(orderId)) return flashError("Invalid order #");
    setBuffer("");
    bufferRef.current = "";
    fetchOrder(orderId);
  }

  function manualSubmit() {
    const raw = (manualValue || "").trim();
    const orderId = extractOrderId(raw);
    if (deptValid && orderId && /^\d{1,10}$/.test(orderId)) {
      setShowManual(false);
      setManualValue("");
      fetchOrder(orderId);
    } else {
      flashError("Invalid order #");
    }
  }

// --- LIGHTBURN OPEN HELPERS ---
function openInLightBurn(bomNameOrPath) {
  let rel = String(bomNameOrPath || "").trim();
  if (!rel) return false;
  if (!/\.dxf$/i.test(rel)) rel = `${rel}.dxf`;
  const protoUrl = `jrco-lightburn://open?path=${encodeURIComponent(rel)}`;
  window.location.href = protoUrl;  // desktop protocol only
  return true;
}


  async function handleImageClick(item) {
    // If it's a BOM tile with a bomName, open in LightBurn via protocol only
    if (item && item.kind === "bom" && item.bomName) {
      // Optional: Alt-click to force the old download route for testing
      if (window.event && window.event.altKey) {
        window.open(`${API_ROOT}/drive/dxf?name=${encodeURIComponent(item.bomName)}`, "_blank", "noopener");
        return;
      }

      const ok = openInLightBurn(item.bomName);
      if (!ok) {
        return flashError(`No DXF name for this item`);
      }
      return;
    }




    // Otherwise (main image or unknown): open the image itself in-page
    const href = item?.src || "";
    if (!href) return;
    setLightboxSrc(href);
  } 

  useEffect(() => {
    function scheduleIdleSubmit() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        const full = bufferRef.current;
        if (full && full.length > 0) handleSubmit(full, true);
      }, IDLE_TIMEOUT_MS);
    }
    function onKeyDown(e) {
      if (e.key.length > 1 && e.key !== "Enter") return;
      if (e.key.length === 1) {
        setBuffer((prev) => {
          const next = prev + e.key;
          bufferRef.current = next;
          return next;
        });
        scheduleIdleSubmit();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        const full = bufferRef.current;
        if (full && full.length > 0) handleSubmit(full, true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
    /* eslint-disable-next-line */
  }, [dept]);

  // 🆕 Auto-load order if URL contains ?order=####
  useEffect(() => {
    const urlOrder = params.get("order");
    if (urlOrder && /^\d+$/.test(urlOrder)) {
      fetchOrder(urlOrder);
    }
  }, []); 


  return (
    <div style={{ minHeight: "100vh", width: "100%", background: "#ffffff", color: "#111" }}>
      {/* focus catcher */}
      <input
        ref={focusRef}
        autoFocus
        onBlur={() => focusRef.current?.focus()}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
      />

      {/* visual feedback styles (and spinner keyframes) */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* subtle success/error wash (kept) */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          boxShadow:
            flash === "ok"
              ? "inset 0 0 0 9999px rgba(16,185,129,0.08)"
              : flash === "error"
              ? "inset 0 0 0 9999px rgba(239,68,68,0.08)"
              : "none",
        }}
      />

      {/* top bar */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          Department: {deptValid ? dept.toUpperCase() : "(invalid)"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            Last keys: <span style={{ fontFamily: "monospace", color: "#111" }}>{buffer || "—"}</span>
          </span>
          <button
            onClick={() => setShowManual(true)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              background: "#111827",
              color: "#fff",
              fontWeight: 600,
              border: "1px solid #111827",
            }}
          >
            Enter Order Manually
          </button>
        </div>
      </div>

      {/* error / loading hint line (kept for debugging) */}
      {(errMsg) && (
        <div style={{ padding: "8px 20px" }}>
          <div style={{ fontSize: 14, color: "#b91c1c" }}>{errMsg}</div>
        </div>
      )}

      {/* ORDER INFO CHART-STYLE BAR */}
      {orderData && (
        <div style={{ padding: "12px 20px" }}>
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "10px 12px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "10px 16px",
            }}
          >
            <InfoBox label="Order #" value={orderData.order} />
            <InfoBox label="Company Name" value={orderData.company} />
            <InfoBox label="Design" value={orderData.title} />
            <InfoBox label="Product" value={orderData.product} />
            <InfoBox label="Stage" value={orderData.stage} />
            <InfoBox label="Due Date" value={orderData.dueDate} />
            <InfoBox label="Fur Color" value={orderData.furColor} />
            <InfoBox label="Quantity" value={String(orderData.quantity)} />
          </div>
        </div>
      )}

      {/* CENTERED QUADRANT */}
      <div
        style={{
          padding: "12px 20px 28px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto" }}>
          <Quadrant
            images={
              Array.isArray(orderData?.imagesNormalized) && orderData.imagesNormalized.length > 0
                ? orderData.imagesNormalized.map(img => ({
                    ...img,
                    tint:
                      img.label?.toLowerCase().includes("fur") && orderData?.furColor
                        ? colorFromName(orderData.furColor)
                        : null,
                  }))
                : [
                    orderData?.thumbnailUrl && { src: orderData.thumbnailUrl, label: "Thumbnail" },
                    orderData?.foamImg && { src: orderData.foamImg, label: "Foam" },
                    orderData?.furImg && {
                      src: orderData.furImg,
                      label: "Fur",
                      tint: orderData?.furColor ? colorFromName(orderData.furColor) : null,
                    },
                    ...(Array.isArray(orderData?.imagesLabeled)
                      ? orderData.imagesLabeled.map(img => ({
                          src: img.src,
                          label: img.label || "Extra",
                        }))
                      : []),
                  ].filter(Boolean)
            }
            onClickItem={handleImageClick}
            renderItem={(img, index) => {
              const isTinted = !!img.tint;

              return (
                <div
                  key={index}
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    backgroundColor: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {isTinted ? (
                    // 🟢 Use the white PNG as a mask and fill it with the fur color
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        backgroundColor: img.tint,
                        WebkitMaskImage: `url(${img.src})`,
                        WebkitMaskRepeat: "no-repeat",
                        WebkitMaskPosition: "center",
                        WebkitMaskSize: "contain",
                        maskImage: `url(${img.src})`,
                        maskRepeat: "no-repeat",
                        maskPosition: "center",
                        maskSize: "contain",
                      }}
                    />
                  ) : (
                    // Fallback for non-tinted images
                    <img
                      src={img.src}
                      alt={img.label}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  )}

                  <div
                    style={{
                      position: "absolute",
                      bottom: 8,
                      left: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#222",
                      textShadow: "0 0 4px rgba(255,255,255,0.6)",
                    }}
                  >
                    {img.label}
                  </div>
                </div>
              );
            }}

          />
        </div>
      </div>


      {/* Manual dialog */}
      {showManual && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 40,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              color: "#111",
              width: 520,
              maxWidth: "96vw",
              borderRadius: 12,
              padding: 20,
              border: "1px solid #e5e7eb",
              boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Open Order in {dept.toUpperCase()}</h2>
            <p style={{ color: "#6b7280", fontSize: 14, marginTop: 6 }}>
              Paste or type anything that contains the digits of the order number.
            </p>
            <input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder='e.g., JR|FUR|0063 → opens order 63'
              style={{
                width: "100%",
                background: "#f3f4f6",
                color: "#111",
                borderRadius: 8,
                padding: "10px 12px",
                outline: "none",
                marginTop: 12,
                border: "1px solid #e5e7eb",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  color: "#111",
                }}
                onClick={() => setShowManual(false)}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#111827",
                  color: "#fff",
                  fontWeight: 700,
                  border: "1px solid #111827",
                }}
                onClick={manualSubmit}
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}

      {/* YELLOW LOADING OVERLAY */}
      {loading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#fde047", // amber-300
            color: "#111",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
          }}
          role="alert"
          aria-live="assertive"
        >
          <div style={{ textAlign: "center", padding: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                border: "4px solid rgba(0,0,0,0.15)",
                borderTopColor: "#111",
                borderRadius: "9999px",
                margin: "0 auto",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 12 }}>
              Loading {pendingOrderId ? `order ${pendingOrderId}` : "order"}…
            </div>
            <div style={{ marginTop: 4, color: "#374151", fontSize: 14 }}>
              Fetching details and images
            </div>
          </div>
        </div>
      )}

      {/* IMAGE LIGHTBOX (click anywhere or "X" to close) */}
      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc("")}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 70,
            cursor: "zoom-out",
          }}
        >
          {/* Close X */}
          <button
            aria-label="Close"
            onClick={(e) => { e.stopPropagation(); setLightboxSrc(""); }}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.4)",
              background: "transparent",
              color: "#fff",
              fontSize: 20,
              lineHeight: "34px",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            ×
          </button>

          {/* The image */}
          <img
            src={lightboxSrc}
            alt=""
            style={{
              maxWidth: "95vw",
              maxHeight: "90vh",
              objectFit: "contain",
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              borderRadius: 8,
              background: "#111",
            }}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}


function InfoBox({ label, value }) {
  const val = clean(value);
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: "#6b7280",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 14,
          lineHeight: 1.2,
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {val}
      </div>
    </div>
  );
}

function clean(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && v.trim() === "") return "—";
  return v;
}

// --- Labeled Quadrant ---
function toImgMeta(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(Boolean)
    .map(it => (typeof it === "string" ? { src: it, label: "" } : it));
}

function Quadrant({ images, onClickItem }) {
  const items = toImgMeta(images);

  const frameStyle = {
    height: "58vh",
    width: "100%",
    maxWidth: 1100,
    margin: "0 auto",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  };

  const Tile = ({ item }) => {
    const label = (item?.label || "").trim();
    const isBom = item?.kind === "bom";
    const title = isBom
      ? (item?.bomName ? `Open DXF: ${item.bomName}` : "Open DXF")
      : "Open image in new tab";

    return (
      <button
        type="button"
        onClick={() => onClickItem && onClickItem(item)}
        title={title}
        style={{
          position: "relative",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          minHeight: 120,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          cursor: "pointer",
          textAlign: "left",
          padding: 0,
        }}
      >
        <div style={{ padding: "8px 10px", fontSize: 12, color: "#6b7280", display: "flex", alignItems: "center", gap: 8 }}>
          {isBom ? (
            <span style={{
              display: "inline-block",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 10,
              padding: "2px 6px",
              background: "#f9fafb",
              color: "#111",
            }}>
              DXF
            </span>
          ) : (
            <span style={{
              display: "inline-block",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 10,
              padding: "2px 6px",
              background: "#f9fafb",
              color: "#111",
            }}>
              Main
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label || (isBom ? (item?.bomName || "BOM") : "Image")}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
          <Img src={item?.src} tint={item?.tint} />
        </div>
      </button>
    );
  };


  if (items.length === 0) {
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderStyle: "dashed",
          borderColor: "#e5e7eb",
        }}
      >
        <span style={{ fontSize: 13, color: "#9ca3af" }}>No images</span>
      </div>
    );
  }

  if (items.length === 1) {
    return (
      <div style={{ ...frameStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", height: "100%" }}>
          <Tile item={items[0]} />
        </div>
      </div>
    );
  }

  if (items.length === 2) {
    return (
      <div
        style={{
          ...frameStyle,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          padding: 12,
        }}
      >
        <Tile key={items[0]?.src || "a"} item={items[0]} />
        <Tile key={items[1]?.src || "b"} item={items[1]} />
      </div>
    );
  }

  const four = items.slice(0, 4);
  return (
    <div
      style={{
        ...frameStyle,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 12,
        padding: 12,
      }}
    >
      {four.map((it, i) => (
        <Tile key={it?.src || i} item={it} />
      ))}
    </div>
  );
}

function Img({ src, style, tint }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  if (!src) return null;

  // Convert Google Drive URLs into thumbnails
  function toThumbnail(url) {
    try {
      const s = String(url);
      const m = s.match(/\/d\/([A-Za-z0-9_-]+)/);
      if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400`;
      const m2 = s.match(/id=([A-Za-z0-9_-]+)/);
      if (m2) return `https://drive.google.com/thumbnail?id=${m2[1]}&sz=w400`;
      return s;
    } catch {
      return url;
    }
  }

  const thumb = toThumbnail(src);

  console.log("[Img] render", { src, tint, thumb });

  return ok ? (
    tint ? (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: tint,
          WebkitMaskImage: `url(${thumb})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
          maskImage: `url(${thumb})`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
        }}
        draggable={false}
      />
    ) : (
      <img
        src={thumb}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          ...style
        }}
        onLoad={() => console.debug("[Img] loaded:", thumb)}
        onError={() => {
          console.debug("[Img] error:", thumb);
          setOk(false);
        }}
        draggable={false}
      />
    )
  ) : (
    <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>
      Image unavailable
    </div>
  );
}



async function safeJson(r) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}