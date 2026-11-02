// /src/DigitizingList.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";

// ---------- Config ----------
const BACKEND_ROOT = API_ROOT.replace(/\/api$/, "");

// ---------- Utils ----------
function toDate(v) {
  if (v == null) return null;
  if (typeof v === "number" && isFinite(v)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    return new Date(base.getTime() + v * 86400000);
  }
  const d = new Date(String(v).trim());
  return isNaN(d) ? null : d;
}
function fmtMMDD(d) {
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}
// Same Drive parsing + **backend thumbnail proxy** as Overview (direct drive.google.com
// thumbnails often stay blank in <img> until interaction; /api/drive/thumbnail uses server auth).
function extractFileIdFromFormulaOrUrl(input) {
  if (!input) return null;
  const s = String(input);
  let m = s.match(/IMAGE\("([^"]+)"/i);
  if (m) return extractFileIdFromFormulaOrUrl(m[1]);
  if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return s;
  m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/\/(?:open|uc)[^?]*\?[^#]*\bid=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/"id":"([A-Za-z0-9_-]{10,})"/);
  if (m) return m[1];
  return null;
}

/** Thumbnail via /api/drive/thumbnail + URL to open (Overview-style popup). */
function resolveOrderPreview(order) {
  const proxyBase = `${BACKEND_ROOT}/api/drive/thumbnail`;
  const proxyForId = (id) => {
    if (!id) return null;
    const params = new URLSearchParams({ fileId: id, sz: "w160" }).toString();
    return `${proxyBase}?${params}`;
  };

  const toPreview = (idOrUrl) => {
    if (!idOrUrl) return null;
    const id = extractFileIdFromFormulaOrUrl(idOrUrl);
    if (id) {
      return {
        fileId: id,
        thumbUrl: proxyForId(id),
        openUrl: `https://drive.google.com/file/d/${id}/view`,
      };
    }
    const str = String(idOrUrl);
    if (/^https?:\/\//i.test(str)) return { fileId: null, thumbUrl: str, openUrl: str };
    if (/^[A-Za-z0-9_-]{12,}$/.test(str)) {
      return {
        fileId: str,
        thumbUrl: proxyForId(str),
        openUrl: `https://drive.google.com/file/d/${str}/view`,
      };
    }
    return null;
  };

  const fromAny = (val) => {
    if (!val) return null;
    if (Array.isArray(val)) {
      for (const v of val) {
        const hit = fromAny(v);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof val === "object") {
      const cand = [
        val.imageUrl, val.src, val.url, val.href, val.link, val.image, val.thumbnail, val.preview,
      ];
      for (const c of cand) {
        const hit = fromAny(c);
        if (hit) return hit;
      }
      return toPreview(JSON.stringify(val));
    }
    return toPreview(val);
  };

  const fields = [
    order.imageUrl, order.image,
    order.thumbnailUrl, order.ImageURL,
    order.preview, order.Preview, order.previewFormula, order.PreviewFormula,
    order.Image, order.thumbnail, order.Thumbnail,
    order.images, order.Images, order.imagesLabeled, order.images_labelled,
    order.files, order.attachments, order.Attachment, order.Attachements,
    order.Art, order["Art Link"], order["Art URL"],
  ];
  for (const f of fields) {
    const hit = fromAny(f);
    if (hit) return hit;
  }
  for (const v of Object.values(order || {})) {
    const hit = fromAny(v);
    if (hit) return hit;
  }
  return { fileId: null, thumbUrl: null, openUrl: null };
}

const DIGITIZING_VENDOR_EMAIL = "classicdigitizers@gmail.com";
const DIGITIZING_EMAIL_SIGNATURE = [
  "Thanks,",
  "Justin Eckard",
  "JR & Co.",
  "678.294.5350",
  "www.jrcogolf.com",
].join("\n");

// Same as Overview material orders — open Justin's Gmail compose in the browser.
const DEFAULT_GMAIL_ACCOUNT = "justin.eckard@jrcogolf.com";

function resolveGmailAuthUser() {
  const raw = String(process.env.REACT_APP_GMAIL_AUTHUSER || "").trim();
  if (!raw || raw === "0") return DEFAULT_GMAIL_ACCOUNT;
  return raw;
}

function buildGmailCompose({ to = "", cc = "", bcc = "", subject = "", body = "", authUser } = {}) {
  const account = String(authUser ?? "").trim();
  const p = new URLSearchParams({ view: "cm", fs: "1" });
  if (to) p.set("to", to);
  if (cc) p.set("cc", cc);
  if (bcc) p.set("bcc", bcc);
  if (subject) p.set("su", subject);
  if (body) p.set("body", body);
  if (!account) {
    return `https://mail.google.com/mail/?${p.toString()}`;
  }
  if (/^\d+$/.test(account)) {
    return `https://mail.google.com/mail/u/${account}/?${p.toString()}`;
  }
  p.set("authuser", account);
  return `https://mail.google.com/mail/u/?${p.toString()}`;
}

function openUrlReturn(url) {
  try {
    const w = window.open(url, "_blank", "noopener,width=980,height=720");
    if (w) {
      try { w.opener = null; } catch { /* ignore */ }
      setTimeout(() => {
        try { window.focus(); } catch { /* ignore */ }
      }, 0);
      return w;
    }
  } catch { /* ignore */ }
  return null;
}

function buildDigitizingEmailSubject({ orderNumber = "", design = "" } = {}) {
  const parts = ["JR & Co Digitize Order"];
  const order = String(orderNumber || "").trim();
  const designName = String(design || "").trim();
  if (order) parts.push(`#${order}`);
  if (designName) parts.push(designName);
  return parts.join(" - ");
}

function buildDigitizingEmailText({ product = "", orderNumber = "", design = "" } = {}) {
  const productName = String(product || "").trim() || "(product not specified)";
  const lines = [
    "Hi William,",
    "",
    "Could you please digitize the attached design for us?",
    "",
    `Product: ${productName}`,
  ];
  const order = String(orderNumber || "").trim();
  if (order) lines.push(`Order #: ${order}`);
  const designName = String(design || "").trim();
  if (designName) lines.push(`Design: ${designName}`);
  lines.push("", DIGITIZING_EMAIL_SIGNATURE);
  return {
    subject: buildDigitizingEmailSubject({ orderNumber, design }),
    body: lines.join("\n"),
  };
}

function attachmentDataUrl(att) {
  if (!att?.contentBase64) return "";
  const mime = att.mime || "image/jpeg";
  return `data:${mime};base64,${att.contentBase64}`;
}

function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      const contentBase64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name || "attachment",
        mime: file.type || "application/octet-stream",
        contentBase64,
        size: file.size || 0,
        isDesign: false,
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function downloadAttachmentPayloads(files) {
  for (const file of files || []) {
    try {
      const bin = atob(String(file.contentBase64 || ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: file.mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename || "attachment";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Attachment download failed:", err);
    }
  }
}

/** Match Overview upcoming-jobs image popup. */
function openPreviewLikeOverview(url) {
  if (!url) return;
  try {
    const w = window.open(url, "_blank", "noopener,width=980,height=720");
    if (w) {
      try { w.opener = null; } catch { /* ignore */ }
      setTimeout(() => {
        try { window.focus(); } catch { /* ignore */ }
      }, 0);
    }
  } catch { /* ignore */ }
}

/** Production Orders material columns (same as Cut List / submit). */
const MATERIAL_ORDER_KEYS = [
  "Material1",
  "Material2",
  "Material3",
  "Material4",
  "Material5",
  "Back Material",
];

function materialLabelsFromOrder(order) {
  const seen = new Set();
  const out = [];
  for (const k of MATERIAL_ORDER_KEYS) {
    const v = String(order?.[k] ?? "").trim();
    if (!v) continue;
    const lk = v.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    out.push(v);
  }
  return out;
}

function normalizeSheetColor(raw) {
  const s = String(raw || "").trim();
  if (!s) return "#e5e7eb";
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`;
  return s;
}

function contrastTextForBackground(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg).replace(/\s/g, ""));
  if (!m) return "#111827";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? "#111827" : "#ffffff";
}

// Optional: grouping helper (same behavior as Fur List if you keep the mode buttons)
function priorityPartition(rows, key) {
  if (!rows.length) return rows;
  const target = String(rows[0][key] || "").trim().toLowerCase();
  if (!target) return rows;
  const yes = [], no = [];
  for (const r of rows) {
    const v = String(r[key] || "").trim().toLowerCase();
    (v === target ? yes : no).push(r);
  }
  return [...yes, ...no];
}

// ---------- (Optional) Toast ----------
function Toast({ kind = "success", message, onClose }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", right: 16, bottom: 16, maxWidth: 360,
        background: kind === "success" ? "#0fbf4a" : "#e45858",
        color: "#fff", padding: "10px 14px", borderRadius: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,0.18)", fontWeight: 600,
        zIndex: 9999, display: "flex", alignItems: "center", gap: 10, cursor: "pointer"
      }}
      onClick={onClose}
      title="Click to dismiss"
    >
      <span>{kind === "success" ? "✓" : "⚠"}</span>
      <span style={{ lineHeight: 1.2 }}>{message}</span>
    </div>
  );
}

// ---------- Component ----------
export default function DigitizingList() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState("Main"); // Main | Fur Color | Product (optional grouping)
  const [materialColors, setMaterialColors] = useState({});
  const inFlight = useRef(false);

  // (Optional) toast state — safe to leave
  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState("success");
  const toastTimer = useRef(null);
  const [orderingId, setOrderingId] = useState("");
  const orderingLock = useRef(false);
  const [composeModal, setComposeModal] = useState(null); // { orderId, to, subject, body, attachment, thumbUrl, loading, sending }

  // responsive compact mode for narrow screens
  const [ww, setWw] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1400));
  useEffect(() => {
    function onResize() { setWw(window.innerWidth); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const compact = ww < 1200;

  function showToast(message, kind = "success", ms = 1800) {
    setToastMsg(message); setToastKind(kind);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), ms);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await axios.get(`${API_ROOT}/material-inventory/colors`, {
          withCredentials: true,
        });
        if (!cancel && res.data && typeof res.data === "object") {
          setMaterialColors(res.data);
        }
      } catch {
        if (!cancel) setMaterialColors({});
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Reusable fetcher (first load sets isLoading; refreshes do not blank the UI)
  const fetchOrders = useCallback(async (opts = { refresh: false }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!opts.refresh) setIsLoading(true);
      const url = `${API_ROOT}/combined${opts.refresh ? '?refresh=1' : ''}`;
      const res = await axios.get(url, { withCredentials: true });
      setOrders(res.data?.orders || []);
    } catch {
      // swallow; UI will show last-known data
    } finally {
      if (!opts.refresh) setIsLoading(false);
      inFlight.current = false;
    }
  }, []);

  // initial + polling
  useEffect(() => {
    let canceled = false;
    (async () => { if (!canceled) await fetchOrders(); })();
    const t = setInterval(() => { if (!canceled) fetchOrders({ refresh: true }); }, 180000);
    return () => { canceled = true; clearInterval(t); };
  }, [fetchOrders]);

  // Filter + sort (+optional partition like Fur List)
  const cards = useMemo(() => {
    // 1) Exclude COMPLETE orders (Stage or Status)
    let base = (orders || []).filter(o => {
      const status = String(o["Status"] || "").trim().toUpperCase();
      const stage = String(o["Stage"] || "").trim().toUpperCase();
      return (
        status !== "COMPLETE" &&
        status !== "COMPLETED" &&
        stage !== "COMPLETE" &&
        stage !== "COMPLETED"
      );
    });

    // 2) Only show jobs with NO Stitch Count
    base = base.filter(o => {
      const stitch = String(o["Stitch Count"] || "").trim();
      return stitch === "";
    });

    // 3) Exclude Printed Towels and Belts
    base = base.filter(o => {
      const product = String(o["Product"] || "").toLowerCase();
      if (product.includes("printed towel")) return false;
      if (/\bbelts?\b/.test(product)) return false;
      return true;
    });



    // 4) Sort: samples (qty 1) at top, then by Due Date (oldest first), then Order #
    const isSample = (o) => Number(o["Quantity"]) === 1;
    base.sort((a, b) => {
      const aSample = isSample(a);
      const bSample = isSample(b);
      if (aSample !== bSample) return aSample ? -1 : 1; // samples first

      const ad = toDate(a["Due Date"]);
      const bd = toDate(b["Due Date"]);
      const at = ad ? ad.getTime() : Infinity;
      const bt = bd ? bd.getTime() : Infinity;
      if (at !== bt) return at - bt;

      // tie-breaker: Order # (numeric-aware)
      const aId = String(a["Order #"] || "");
      const bId = String(b["Order #"] || "");
      return aId.localeCompare(bId, undefined, { numeric: true });
    });

    // Optional grouping (keeps the same "feel" as Fur List, but sort remains by due date)
    if (mode === "Fur Color") return priorityPartition(base, "Fur Color");
    if (mode === "Product")   return priorityPartition(base, "Product");
    return base;
  }, [orders, mode]);

  const closeComposeModal = () => {
    setComposeModal(null);
    setOrderingId("");
    orderingLock.current = false;
  };

  const handleOrderDigitizing = async (order, fileId, thumbUrl = "") => {
    const orderId = String(order?.["Order #"] || "").trim();
    const designName = String(order?.["Design"] || "").trim();
    const productName = String(order?.["Product"] || "").trim();
    if (!orderId) {
      showToast("Missing order number.", "error", 2400);
      return;
    }
    if (!fileId) {
      showToast("No design image found to attach.", "error", 2400);
      return;
    }
    if (orderingLock.current) return;
    orderingLock.current = true;
    setOrderingId(orderId);

    const local = buildDigitizingEmailText({
      product: productName,
      orderNumber: orderId,
      design: designName,
    });
    setComposeModal({
      orderId,
      fileId,
      product: productName,
      design: designName,
      to: DIGITIZING_VENDOR_EMAIL,
      subject: local.subject,
      body: local.body,
      attachments: [],
      thumbUrl: thumbUrl || "",
      loading: true,
      sending: false,
    });

    try {
      const res = await axios.post(
        `${API_ROOT}/digitizing/order-email`,
        {
          action: "prepare",
          orderNumber: orderId,
          product: productName,
          design: designName,
          fileId,
        },
        { withCredentials: true, timeout: 120000 }
      );
      const data = res.data || {};
      const designAtt = data.attachment
        ? {
            id: "design",
            filename: data.attachment.filename || `${orderId}.jpg`,
            mime: data.attachment.mime || "image/jpeg",
            contentBase64: data.attachment.contentBase64,
            isDesign: true,
          }
        : null;
      setComposeModal((prev) =>
        prev && prev.orderId === orderId
          ? {
              ...prev,
              to: data.to || DIGITIZING_VENDOR_EMAIL,
              subject: data.subject || local.subject,
              body: data.body || local.body,
              attachments: designAtt ? [designAtt] : [],
              loading: false,
            }
          : prev
      );
    } catch (err) {
      console.error("Prepare digitizing email failed:", err);
      showToast(
        err?.response?.data?.error || err?.message || "Could not load design attachment.",
        "error",
        3600
      );
      closeComposeModal();
    } finally {
      orderingLock.current = false;
    }
  };

  const handleAddExtraAttachments = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !composeModal) return;
    try {
      const extras = [];
      for (const file of files) {
        // Keep payloads reasonable for the API (~12MB each).
        if (file.size > 12 * 1024 * 1024) {
          showToast(`${file.name} is too large (max 12MB).`, "error", 3200);
          continue;
        }
        extras.push(await readFileAsAttachment(file));
      }
      if (!extras.length) return;
      setComposeModal((prev) =>
        prev
          ? { ...prev, attachments: [...(prev.attachments || []), ...extras] }
          : prev
      );
    } catch (err) {
      console.error("Add attachment failed:", err);
      showToast("Could not add one or more files.", "error", 2800);
    }
  };

  const handleRemoveAttachment = (attId) => {
    setComposeModal((prev) => {
      if (!prev) return prev;
      const next = (prev.attachments || []).filter((a) => a.id !== attId);
      // Keep at least the design file if we still have fileId on the server side.
      return { ...prev, attachments: next };
    });
  };

  const handleSendDigitizingEmail = async () => {
    if (!composeModal || composeModal.sending || composeModal.loading) return;
    const attachments = Array.isArray(composeModal.attachments) ? composeModal.attachments : [];
    if (!attachments.length && !composeModal.fileId) {
      showToast("Add at least one attachment before sending.", "error", 2400);
      return;
    }
    setComposeModal((prev) => (prev ? { ...prev, sending: true } : prev));
    try {
      const extraAttachments = attachments
        .filter((a) => !a.isDesign)
        .map((a) => ({
          filename: a.filename,
          mime: a.mime,
          contentBase64: a.contentBase64,
        }));
      const res = await axios.post(
        `${API_ROOT}/digitizing/order-email`,
        {
          action: "send",
          orderNumber: composeModal.orderId,
          product: composeModal.product,
          design: composeModal.design,
          fileId: composeModal.fileId,
          to: composeModal.to,
          subject: composeModal.subject,
          body: composeModal.body,
          extraAttachments,
        },
        { withCredentials: true, timeout: 180000 }
      );
      const data = res.data || {};
      if (!data.ok) {
        throw new Error(data.error || "Send failed");
      }
      const count = Number(data.attachmentCount || attachments.length || 1);
      const fromEmail = String(data.fromEmail || DEFAULT_GMAIL_ACCOUNT).trim();
      showToast(
        `Sent from ${fromEmail} with ${count} attachment${count === 1 ? "" : "s"} auto-attached.`,
        "success",
        4500
      );
      closeComposeModal();
    } catch (err) {
      console.error("Send digitizing email failed:", err);
      setComposeModal((prev) => (prev ? { ...prev, sending: false } : prev));
      const msg =
        err?.response?.data?.error || err?.message || "Failed to send digitizing email.";
      showToast(msg, "error", 6000);
    }
  };

  // ---------- Layout ----------
  // Column order (compact hides Print + Hard/Soft):
  // [Order#, Preview, Company, Design, Qty, Product, Stage, (Print), Materials, Due, (Hard/Soft), Order]
  const gridFull =
    "62px 56px 170px 190px 62px 120px 110px 100px minmax(140px,1.15fr) 110px 92px 148px";
  const gridCompact =
    "62px 56px 160px 160px 60px 110px 100px minmax(120px,1fr) 92px 136px";
  const gridTemplate = compact ? gridCompact : gridFull;

  const cellBase = {
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center"
  };

  return (
    <div style={{ padding: 12, fontSize: 12, lineHeight: 1.2 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }
      `}</style>

      {/* Top bar — optional grouping buttons to match Fur List look */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {["Main", "Fur Color", "Product"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="btn"
            style={{ background: mode === m ? "#eee" : "#fff" }}
          >
            {m}
          </button>
        ))}
        <div style={{ flex: 1 }} />
      </div>

      {/* Header row */}
      <div
        className="hdr"
        style={{
          display: "grid", gridTemplateColumns: gridTemplate, alignItems: "center",
          gap: 8, padding: "6px 8px", borderRadius: 10, border: "1px solid #ddd",
          background: "#fafafa", marginBottom: 6, position: "relative"
        }}
      >
        <div style={cellBase}>Order #</div>
        <div style={cellBase}>Preview</div>
        <div style={cellBase}>Company Name</div>
        <div style={cellBase}>Design</div>
        <div style={cellBase}>Qty</div>
        <div style={cellBase}>Product</div>
        <div style={cellBase}>Stage</div>
        {!compact && <div style={cellBase}>Print</div>}
        <div style={cellBase}>Materials</div>
        <div style={cellBase}>Due</div>
        {!compact && <div style={cellBase}>Hard/Soft</div>}
        <div style={cellBase}>Order</div>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(255, 235, 59, 0.25)",
            backdropFilter: "blur(1px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "none"
          }}
        >
          <div
            style={{
              padding: "14px 18px",
              background: "rgba(255, 235, 59, 0.85)",
              border: "1px solid #d4b300",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 18,
              color: "#3b3b00",
              boxShadow: "0 8px 20px rgba(0,0,0,0.15)"
            }}
          >
            Loading Jobs…
          </div>
        </div>
      )}

      {/* Content */}
      {cards.length === 0 ? (
        <div style={{ padding: "24px 8px", color: "#777" }}>
          No digitizing items to show.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {cards.map(order => {
            const orderId = String(order["Order #"] || "");
            const company = order["Company Name"] || "";
            const design  = order["Design"] || "";
            const qty     = order["Quantity"] || "";
            const product = order["Product"] || "";
            const stage   = order["Stage"] || "";
            const due     = toDate(order["Due Date"]);
            const print   = order["Print"] || "";
            const hardSoft= order["Hard Date/Soft Date"] || "";
            const matLabels = materialLabelsFromOrder(order);
            const { fileId, thumbUrl: imageUrl, openUrl } = resolveOrderPreview(order);
            const isOrdering = orderingId === orderId;

            const onPreviewClick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              openPreviewLikeOverview(openUrl);
            };

            return (
              <div
                key={orderId}
                style={{
                  display: "grid", gridTemplateColumns: gridTemplate, alignItems: "start",
                  gap: 8, padding: 10, borderRadius: 10,
                  border: "1px solid #ddd", background: "#fff"
                }}
              >
                <div style={{ ...cellBase, fontWeight: 700, alignSelf: "center" }}>{orderId}</div>

                {/* Preview — thumbs via /api/drive/thumbnail (like Overview); click opens like scheduler */}
                <div style={{ display: "grid", placeItems: "center", alignSelf: "center" }}>
                  <div
                    role={openUrl ? "button" : undefined}
                    tabIndex={openUrl ? 0 : undefined}
                    title={openUrl ? "Open full preview" : undefined}
                    onClick={openUrl ? onPreviewClick : undefined}
                    onKeyDown={
                      openUrl
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onPreviewClick(e);
                            }
                          }
                        : undefined
                    }
                    style={{
                      width: 50,
                      height: 34,
                      overflow: "hidden",
                      borderRadius: 6,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "#fff",
                      cursor: openUrl ? "pointer" : "default",
                    }}
                  >
                    {imageUrl ? (
                      <img
                        loading="eager"
                        decoding="async"
                        src={imageUrl}
                        alt=""
                        draggable={false}
                        referrerPolicy="no-referrer"
                        width={50}
                        height={34}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
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
                          fontSize: 11,
                          color: "#666",
                        }}
                      >
                        No Preview
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ ...cellBase, alignSelf: "center" }}>{company}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{design}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{qty}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{product}</div>
                <div style={{ ...cellBase, alignSelf: "center" }}>{stage}</div>
                {!compact && <div style={{ ...cellBase, alignSelf: "center" }}>{print}</div>}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    alignSelf: "center",
                    minWidth: 0,
                    padding: "4px 0",
                  }}
                >
                  {matLabels.length === 0 ? (
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>—</span>
                  ) : (
                    matLabels.map((label) => {
                      const raw = materialColors[label.toLowerCase()];
                      const bg = normalizeSheetColor(raw);
                      const fg = contrastTextForBackground(bg);
                      const short = label.length > 24 ? `${label.slice(0, 22)}…` : label;
                      return (
                        <span
                          key={`${orderId}-${label}`}
                          title={label}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            lineHeight: 1.2,
                            padding: "3px 7px",
                            borderRadius: 999,
                            background: bg,
                            color: fg,
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            border: "1px solid rgba(0,0,0,0.06)",
                          }}
                        >
                          {short}
                        </span>
                      );
                    })
                  )}
                </div>
                <div style={{ ...cellBase, fontWeight: 700, alignSelf: "center" }}>{fmtMMDD(due)}</div>
                {!compact && <div style={{ ...cellBase, alignSelf: "center" }}>{hardSoft}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", alignSelf: "center" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!!orderingId || !fileId}
                    title={fileId ? "Email William with this design attached" : "No design image to attach"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleOrderDigitizing(order, fileId, imageUrl);
                    }}
                    style={{
                      background: isOrdering ? "#e5e7eb" : "#111827",
                      color: isOrdering ? "#374151" : "#fff",
                      borderColor: isOrdering ? "#bbb" : "#111827",
                      whiteSpace: "nowrap",
                      opacity: !fileId && !isOrdering ? 0.45 : 1,
                      fontSize: 11,
                      padding: "7px 10px",
                    }}
                  >
                    {isOrdering ? "Preparing…" : "Order Digitizing"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {composeModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Order digitizing email"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={closeComposeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #ddd",
              boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid #eee",
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14 }}>Order Digitizing</div>
              <button
                type="button"
                className="btn"
                onClick={closeComposeModal}
                disabled={composeModal.sending}
                style={{ background: "#fff", padding: "4px 10px" }}
              >
                Close
              </button>
            </div>

            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>To</span>
                <input
                  value={composeModal.to}
                  onChange={(e) =>
                    setComposeModal((prev) => (prev ? { ...prev, to: e.target.value } : prev))
                  }
                  disabled={composeModal.loading || composeModal.sending}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>Subject</span>
                <input
                  value={composeModal.subject}
                  onChange={(e) =>
                    setComposeModal((prev) => (prev ? { ...prev, subject: e.target.value } : prev))
                  }
                  disabled={composeModal.loading || composeModal.sending}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>Message</span>
                <textarea
                  value={composeModal.body}
                  onChange={(e) =>
                    setComposeModal((prev) => (prev ? { ...prev, body: e.target.value } : prev))
                  }
                  disabled={composeModal.loading || composeModal.sending}
                  rows={8}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13,
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.35,
                  }}
                />
              </label>

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 10,
                  background: "#f9fafb",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>Attachments</div>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 10px",
                      borderRadius: 8,
                      border: "1px solid #bbb",
                      background: "#fff",
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: composeModal.loading || composeModal.sending ? "default" : "pointer",
                      opacity: composeModal.loading || composeModal.sending ? 0.55 : 1,
                    }}
                  >
                    + Add files
                    <input
                      type="file"
                      multiple
                      disabled={composeModal.loading || composeModal.sending}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        handleAddExtraAttachments(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>

                {composeModal.loading ? (
                  <div style={{ fontSize: 12, color: "#666" }}>Loading design image…</div>
                ) : (composeModal.attachments || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>No files attached yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {(composeModal.attachments || []).map((att) => {
                      const preview = att.isDesign
                        ? attachmentDataUrl(att) || composeModal.thumbUrl
                        : (String(att.mime || "").startsWith("image/")
                          ? attachmentDataUrl(att)
                          : "");
                      return (
                        <div
                          key={att.id}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                            background: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 8,
                            padding: 8,
                          }}
                        >
                          <div
                            style={{
                              width: 52,
                              height: 40,
                              borderRadius: 6,
                              overflow: "hidden",
                              border: "1px solid #ddd",
                              background: "#f3f4f6",
                              flexShrink: 0,
                              display: "grid",
                              placeItems: "center",
                              fontSize: 10,
                              color: "#6b7280",
                            }}
                          >
                            {preview ? (
                              <img
                                src={preview}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              "FILE"
                            )}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={att.filename}
                            >
                              {att.filename}
                              {att.isDesign ? " (design)" : ""}
                            </div>
                            <div style={{ fontSize: 11, color: "#6b7280" }}>
                              {att.isDesign ? "Included automatically" : "Added by you"}
                            </div>
                          </div>
                          {!att.isDesign && (
                            <button
                              type="button"
                              className="btn"
                              disabled={composeModal.sending}
                              onClick={() => handleRemoveAttachment(att.id)}
                              style={{ background: "#fff", padding: "4px 8px", fontSize: 11 }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "12px 16px",
                borderTop: "1px solid #eee",
                background: "#fafafa",
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={closeComposeModal}
                disabled={composeModal.sending}
                style={{ background: "#fff" }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleSendDigitizingEmail}
                disabled={
                  composeModal.loading ||
                  composeModal.sending ||
                  !(composeModal.attachments || []).length
                }
                style={{
                  background:
                    composeModal.loading ||
                    composeModal.sending ||
                    !(composeModal.attachments || []).length
                      ? "#9ca3af"
                      : "#111827",
                  color: "#fff",
                  borderColor: "#111827",
                }}
              >
                {composeModal.sending ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast kind={toastKind} message={toastMsg} onClose={() => setToastMsg("")} />
    </div>
  );
}
