// src/Overview.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";



const ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");
const BACKEND_ROOT = ROOT.replace(/\/api$/, "");
const THREAD_IMG_BASE =
  process.env.REACT_APP_THREAD_IMG_BASE || `${BACKEND_ROOT}/thread-images`;

const LS_VENDORS_KEY = "jrco.vendors.cache.v1";




// --- Image helpers (single source of truth) ---
// Handles =IMAGE("..."), uc?export=view&id=..., and /file/d/<id>/ patterns
function extractFileIdFromFormulaOrUrl(v) {
  try {
    const s = String(v || "");
    let m = s.match(/id=([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    m = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    m = s.match(/IMAGE\("([^"]+)"/i); // =IMAGE("...url...")
    if (m) return extractFileIdFromFormulaOrUrl(m[1]);
  } catch {}
  return null;
}

// Prefer common fields; if none, scan the whole row for any Drive link.
// Always return the proxy URL with a stable version key (?v=Order#) so it hits the disk cache.
function getJobThumbUrl(job, ROOT) {
  const fields = [
    job.preview, job.Preview, job.previewFormula, job.PreviewFormula,
    job.image, job.Image, job.thumbnail, job.Thumbnail, job.imageUrl
  ];

  for (const f of fields) {
    const id = extractFileIdFromFormulaOrUrl(f);
    if (id) {
      const vkey = encodeURIComponent(String(job["Order #"] || job.orderNumber || job.id || "nov"));
      return `${ROOT}/drive/proxy/${id}?sz=w160&v=${vkey}`;
    }
    if (f && /^https?:\/\//i.test(String(f))) return f; // already a direct URL
  }

  // Fallback: scan every field in the row for a Drive link
  for (const val of Object.values(job || {})) {
    const s = String(val || "");
    let m = s.match(/id=([A-Za-z0-9_-]+)/) || s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m) {
      const vkey = encodeURIComponent(String(job["Order #"] || job.orderNumber || job.id || "nov"));
      return `${ROOT}/drive/proxy/${m[1]}?sz=w160&v=${vkey}`;
    }
  }
  return null;
}

// 🔌 lightweight socket just for invalidations
const socket = io(BACKEND_ROOT, {
  path: "/socket.io",
  transports: ["websocket"],
  upgrade: false,
  withCredentials: true,
});

const LS_OVERVIEW_KEY = "jrco.overview.cache.v1";

function saveOverviewCache(data) {
  try { localStorage.setItem(LS_OVERVIEW_KEY, JSON.stringify({ t: Date.now(), data })); } catch {}
}
function loadOverviewCache(maxAgeMs = 5 * 60 * 1000) { // 5 min
  try {
    const raw = localStorage.getItem(LS_OVERVIEW_KEY);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (!t || (Date.now() - t) > maxAgeMs) return null;
    return data;
  } catch { return null; }
}




// ——— Helpers (no hooks here) ——————————————————————————————————————

function firstFourDigitCode(s) {
  const m = String(s || "").match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

function threadImgUrl(root, name) {
  const code = firstFourDigitCode(name);
  if (!code) return null;
  return `${root}/thread-images/${code}.jpg`;
}

function materialImgUrl(root, vendor, name) {
  // Builds /material-image?vendor=...&name=...
  const v = encodeURIComponent(vendor || "");
  const n = encodeURIComponent(name || "");
  return `${root}/material-image?vendor=${v}&name=${n}`;
}

function openUrlReturn(url) {
  try {
    const w = window.open(url, "_blank", "noopener,width=980,height=720");
    if (w) {
      try { w.opener = null; } catch {}
      setTimeout(() => { try { window.focus(); } catch {} }, 0);
      return w;
    }
  } catch {}
  // No mailto fallback (prevents Outlook). Just let the user know.
  alert("Popup was blocked. Please allow pop-ups for this site and click Order again.");
  return null;
}


// Opens Gmail in compose mode with subject/body prefilled
function buildGmailCompose({ to = "", cc = "", bcc = "", subject = "", body = "", authUser } = {}) {
  const base = "https://mail.google.com/mail/";
  const p = new URLSearchParams({ view: "cm", fs: "1" });
  if (to) p.set("to", to);
  if (cc) p.set("cc", cc);
  if (bcc) p.set("bcc", bcc);
  if (subject) p.set("su", subject);
  if (body) p.set("body", body);
  if (authUser !== undefined && authUser !== null && String(authUser) !== "") {
    p.set("authuser", String(authUser));
  }
  return `${base}?${p.toString()}`;
}


function buildMailto({ to = "", cc = "", subject = "", body = "" } = {}) {
  const esc = encodeURIComponent;
  const params = [];
  if (cc) params.push(`cc=${esc(cc)}`);
  if (subject) params.push(`subject=${esc(subject)}`);
  if (body) params.push(`body=${esc(body)}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  return `mailto:${esc(to)}${qs}`;
}

// Normalize comma/semicolon lists from the sheet → "a@x.com,b@y.com"
function normList(s) {
  return (s || "")
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean)
    .join(",");
}
// EDIT ME: email subject/body template
function buildEmailText(vendor, rows, { notes, requestBy } = {}) {
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const yyyy = today.getFullYear();

  const isMadeira = String(vendor || "").toLowerCase().includes("madeira");

  if (isMadeira) {
    // Madeira-specific wording for THREADS
    const subject = `JR & Co. Thread Order - Madeira - ${mm}/${dd}/${yyyy}`;
    const lines = rows.map(i => {
      const qty = i.qty ? Number(i.qty) : 1;
      return `${i.name} (Polyneon) - ${qty} Cones`;
    });

    const parts = [
      "Madeira team,",
      "",
      "I would like to place an order for the following:",
      "",
      ...lines,
      "",
      "If you have any question about this order, please feel free to reach out.",
      "",
      "Thanks,",
      "Justin Eckard",
      "678.294.5350",
    ];

    return { subject, body: parts.join("\n") };
  }

  // Generic fallback (non-Madeira vendors): keep your old style
  const subject = `Material Order – ${vendor} – ${mm}/${dd}/${yyyy}`;
  const lines = rows.map(i => `- ${i.name}${i.qty ? ` (${i.qty}${i.unit ? " " + i.unit : ""})` : ""}`);

  const parts = [
    `Hi ${vendor} team,`,
    "",
    "I would like to place an order for the following:",
    "",
    ...lines,
  ];

  if (requestBy) parts.push("", `Requested by: ${requestBy}`);
  if (notes) parts.push("", `Notes: ${notes}`);

  parts.push(
    "",
    "If you have any questions, please feel free to reach out to me.",
    "",
    "Thanks!",
    "Justin Eckard",
    "678.294.5350"
  );

  return { subject, body: parts.join("\n") };
}


function parseDate(s) {
  if (s === null || s === undefined || s === "") return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  if (typeof s === "number") {
    const base = new Date(1899, 11, 30); // Google Sheets epoch
    const dt = new Date(base.getTime() + s * 86400000);
    return isNaN(dt) ? null : dt;
  }
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.split("T")[0].split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return isNaN(dt) ? null : dt;
  }
  const parts = str.split(/[\/\-]/).map(p => p.trim());
  if (parts.length >= 2) {
    let [m, d, y] = parts.map(Number);
    if (!y) y = new Date().getFullYear();
    else if (y < 100) y += 2000;
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return isNaN(dt) ? null : dt;
  }
  return null;
}
function daysUntil(dateLike) {
  const dt = parseDate(dateLike);
  if (!dt) return null;
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  return Math.round((b - a) / 86400000);
}
function fmtMMDD(d) {
  const dt = parseDate(d);
  if (!dt) return "";
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${mo}/${da}`;
}
function showMMDDorRaw(v) {
  const dt = parseDate(v);
  return dt ? fmtMMDD(dt) : (v ?? "");
}
function pickHardSoft(job) {
  return job["Hard Date/Soft Date"]
      ?? job["Hard/Soft"]
      ?? job["Hard Soft"]
      ?? job["Hard/Soft Date"]
      ?? job["Hard or Soft"]
      ?? "";
}
function deriveThumb(link) {
  const s = String(link || "");
  let id = "";
  if (s.includes("id=")) id = s.split("id=")[1].split("&")[0];
  else if (s.includes("/file/d/")) id = s.split("/file/d/")[1].split("/")[0];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w160` : "";
}
function ringColorByShipDate(shipDate) {
  const d = daysUntil(shipDate);
  if (d === null) return "#999";
  if (d <= 0) return "#e74c3c";
  if (d <= 3) return "#f39c12";
  if (d <= 7) return "#2ecc71";
  return "#999";
}

// Parse a Drive file id from a link (works for .../file/d/<id>/... or ?id=<id>)
function parseDriveId(s) {
  const str = String(s || "");
  if (str.includes("id=")) return str.split("id=")[1].split("&")[0];
  if (str.includes("/file/d/")) return str.split("/file/d/")[1].split("/")[0];
  return "";
}

// Build your fast, cached proxy URL (server adds ETag + max-age)
function proxyThumb(id, size = "w96") {
  if (!id) return "";
  const root = (process.env.REACT_APP_API_ROOT || "").replace(/\/$/, "");
  return `${root}/drive/proxy/${id}?sz=${size}`;
}

// Map some common color words → hex; fallback to a stable hue if unknown
const COLOR_LOOKUP = {
  black: "#111111", white: "#f5f5f5", grey: "#9ca3af", gray: "#9ca3af",
  red: "#e11d48", burgundy: "#701a36", maroon: "#7f1d1d", pink: "#ec4899",
  orange: "#f97316", peach: "#fb923c", gold: "#d4a017", yellow: "#eab308",
  green: "#22c55e", kelly: "#15a34a", lime: "#84cc16", teal: "#14b8a6",
  aqua: "#22d3ee", cyan: "#06b6d4", blue: "#3b82f6", navy: "#1e3a8a",
  royal: "#3b5fcc", purple: "#8b5cf6", violet: "#7c3aed", brown: "#8b5e34",
  tan: "#d1b699", beige: "#d6c0a6"
};
function colorFromName(name) {
  const n = String(name || "").toLowerCase();
  // try exact words
  for (const key of Object.keys(COLOR_LOOKUP)) {
    if (n.includes(key)) return COLOR_LOOKUP[key];
  }
  // stable hash → hue fallback
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// Decide thumbnail for an item:
// 1) If it has a Drive link in known fields, use cached proxy image
// 2) Else return null (caller will render a color chip)
function getThreadThumbUrl(it) {
  // look for any field that might carry a Drive link
  const candidates = [it.image, it.preview, it.link, it.url];
  for (const c of candidates) {
    const id = parseDriveId(c);
    if (id) return proxyThumb(id, "w96");
  }
  return null;
}


// === Private thread image helpers (Netlify → Render, with auth cookies) ===
const isFourDigitThreadName = (name) => /^\d{4}$/.test(String(name || "").trim());

const urlCandidatesForThreadImage = (name) => {
  const n = String(name || "").trim();
  if (!isFourDigitThreadName(n)) return [];
  return [
    `${THREAD_IMG_BASE}/${n}.jpg`,
    `${THREAD_IMG_BASE}/${n}.png`,
    `${THREAD_IMG_BASE}/${n}.webp`,
  ];
};

function BasicImg({ src, alt = "", style }) {
  // Let the browser cache & HTTP validators (ETag/Cache-Control) work.
  // Add lazy/async hints for performance.
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      fetchpriority="low"
      style={style}
    />
  );
}


/** ThreadThumb: tries private backend image first, shows color swatch as fallback layer */
function ThreadThumb({ name, fallbackColor }) {
  const candidates = React.useMemo(() => urlCandidatesForThreadImage(name), [name]);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Fallback color underneath */}
      <div style={{ position: "absolute", inset: 0, background: fallbackColor || "#e5e7eb" }} />
      {/* Image overlays when loaded */}
      <SecureImage
        candidates={candidates}
        alt=""
        style={{ position: "relative", width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}

// ——— Styles (added) ——————————————————————————————————————————————
const header = { fontSize: 14, fontWeight: 700, marginBottom: 8 };

const rowCard = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  border: "1px solid #eee",
  borderRadius: 8,
  marginBottom: 8,
};

const imgBox = {
  width: 80,
  height: 40,
  border: "2px solid #ccc",
  borderRadius: 6,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#fafafa",
};

function col(width, center = false) {
  const s = { width };
  if (center) s.textAlign = "center";
  return s;
}

// ——— Component ——————————————————————————————————————————————
export default function Overview() {
  // Upcoming jobs
  const [upcoming, setUpcoming] = useState([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(true);

  // Materials (grouped by vendor)
  const [materials, setMaterials] = useState([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);

  const [selections, setSelections] = useState({});
  const [daysWindow, setDaysWindow] = useState("7");
  const overviewCtrlRef = useRef(null);

  // Order modal
  const [modalOpenForVendor, setModalOpenForVendor] = useState(null);
  const [modalSelections, setModalSelections] = useState({}); // key: `${vendor}:::${name}` -> { selected, qty, unit, type }

  // Vendor directory (from Material Inventory!K:O)
  const [vendorDir, setVendorDir] = useState({});

  // Optional UI fields
  const [orderMethod, setOrderMethod] = useState("email"); // "email" or "website"
  const [poNotes, setPoNotes] = useState("");
  const [requestBy, setRequestBy] = useState("");

  const [gmailPopup, setGmailPopup] = useState(null);

  // Load combined overview (upcoming + materials)
  useEffect(() => {
    let alive = true;

    // 1) Hydrate instantly from cache (if any)
    const cached = loadOverviewCache();
    if (cached) {
      const { upcoming = [], materials = [] } = cached;
      const jobs = (upcoming ?? []).filter(j => {
        const stage = String(j["Stage"] ?? j.stage ?? "").trim().toUpperCase();
        return stage !== "COMPLETE" && stage !== "COMPLETED";
      });
      setUpcoming(jobs);
      setMaterials(materials ?? []);
      // Prime selections
      const init = {};
      for (const g of (materials ?? [])) {
        for (const it of (g.items || [])) {
          const key = `${g.vendor}:::${it.name}`;
          init[key] = {
            selected: true,
            qty: String(it.qty ?? ""),
            unit: it.unit ?? "",
            type: it.type ?? "Material",
          };
        }
      }
      setSelections(init);
      setLoadingUpcoming(false);
      setLoadingMaterials(false);
    }

    // 2) Fetch fresh in background (stale-while-revalidate)
    async function loadFresh() {
      setLoadingUpcoming(!cached);
      setLoadingMaterials(!cached);
      const ctrl = new AbortController();
      try {
        const res = await axios.get(`${ROOT}/overview`, {
          withCredentials: true,
          signal: ctrl.signal,
          timeout: 20000,
        });
        if (!alive) return;
        const data = res?.data || {};
        saveOverviewCache(data);

        const { upcoming, materials, daysWindow: dw } = data;
        const jobs = (upcoming ?? []).filter(j => {
          const stage = String(j["Stage"] ?? j.stage ?? "").trim().toUpperCase();
          return stage !== "COMPLETE" && stage !== "COMPLETED";
        });
        setUpcoming(jobs);
        setMaterials(materials ?? []);
        if (dw) setDaysWindow(String(dw));

        const init = {};
        for (const g of (materials ?? [])) {
          for (const it of (g.items || [])) {
            const key = `${g.vendor}:::${it.name}`;
            init[key] = {
              selected: true,
              qty: String(it.qty ?? ""),
              unit: it.unit ?? "",
              type: it.type ?? "Material",
            };
          }
        }
        setSelections(init);

      } catch (e) {
        if (e?.name !== "CanceledError" && e?.message !== "canceled") {
          console.error("Failed to load overview", e?.message || e);
        }
      } finally {
        if (!alive) return;
        setLoadingUpcoming(false);
        setLoadingMaterials(false);
      }
    }

    loadFresh();

    // slow safety poll (5 minutes)
    const id = setInterval(loadFresh, 300000);

    // refresh when backend emits updates (debounced 1s)
    const debounced = (() => {
      let t;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => { if (alive) loadFresh(); }, 1000);
      };
    })();
    socket.on("ordersUpdated", debounced);
    socket.on("manualStateUpdated", debounced);
    socket.on("placeholdersUpdated", debounced);

    return () => {
      alive = false;
      clearInterval(id);
      socket.off("ordersUpdated", debounced);
      socket.off("manualStateUpdated", debounced);
      socket.off("placeholdersUpdated", debounced);
    };
  }, []);

  // Load vendor directory once
  useEffect(() => {
    let alive = true;

    // 1) Hydrate instantly from localStorage (if present)
    try {
      const raw = localStorage.getItem(LS_VENDORS_KEY);
      if (raw) {
        const map = JSON.parse(raw);
        if (map && typeof map === "object") {
          setVendorDir(map);
        }
      }
    } catch {}

    // 2) Fetch fresh in background and update cache + state
    (async () => {
      try {
        const res = await axios.get(`${ROOT}/vendors`, {
          withCredentials: true,
          timeout: 20000,
        });
        if (!alive) return;

        const map = {};
        for (const v of res.data?.vendors || []) {
          const key = (v.vendor || "").trim().toLowerCase();
          map[key] = v; // {vendor, method, email, cc, website}
        }

        setVendorDir(map);
        try { localStorage.setItem(LS_VENDORS_KEY, JSON.stringify(map)); } catch {}
      } catch (e) {
        console.error("Failed to load vendor directory", e);
      }
    })();

    return () => { alive = false; };
  }, []);


  useEffect(() => {
    const id = setInterval(() => {
      if (gmailPopup && gmailPopup.closed) {
        setGmailPopup(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [gmailPopup]);

  // Modal rows
  const modalRows = useMemo(() => {
    if (!modalOpenForVendor) return [];
    const grp = materials.find(g => g.vendor === modalOpenForVendor);
    if (!grp) return [];
    return (grp.items || []).map(it => {
      const key = `${grp.vendor}:::${it.name}`;
      return { vendor: grp.vendor, name: it.name, unit: it.unit || "", ...modalSelections[key], key };
    });
  }, [modalOpenForVendor, modalSelections, materials]);

  // Submit order: email (or open website) + log to inventory
  async function submitOrder() {
    try {
      const rows = modalRows.filter(r => r.selected);
      if (!rows.length) {
        alert("No items selected.");
        return;
      }

      // Vendor info from directory
      const v = vendorDir[(modalOpenForVendor || "").trim().toLowerCase()] || {};
      const vMethod = (v.method || "").toLowerCase();
      const defaultMethod = (vMethod.includes("online") || vMethod.includes("website")) ? "website" : "email";
      const effectiveMethod = orderMethod || defaultMethod;

      // Build subject/body (used for email path)
      let emailRows = rows;
      let emailTo = normList(v.email);
      const cc = normList(v.cc);
      const authUser = process.env.REACT_APP_GMAIL_AUTHUSER; // optional, 0/1/etc

      // Madeira threads: email contactus@madeirausa.com and list only thread items
      if ((modalOpenForVendor || "").toLowerCase().includes("madeira")) {
        const threadRows = rows.filter(r => (r.type || "Material").toLowerCase() === "thread");
        if (threadRows.length) {
          emailRows = threadRows;
          emailTo = "contactus@madeirausa.com";
        }
      }

      const { subject, body } = buildEmailText(modalOpenForVendor, emailRows, {
        notes: poNotes,
        requestBy,
      });

      // If targeting Madeira via email, force email method (not website/cart)
      const method = (emailTo === "contactus@madeirausa.com") ? "email" : (orderMethod || defaultMethod);


      // WEBSITE path — Madeira (special)
      if (method === "website" && (modalOpenForVendor || "").toLowerCase().includes("madeira")) {
        // Only send thread items for Madeira
        const threadRows = rows.filter(r => (r.type || "Material").toLowerCase() === "thread");
        if (!threadRows.length) {
          alert("No thread items selected for Madeira.");
          return;
        }

        try {
          // Ask the server to add them to the Madeira cart
          const resp = await axios.post(`${ROOT}/order/madeira`, {
            threads: threadRows.map(r => ({ name: r.name, qty: Number(r.qty || 1) }))
          }, { withCredentials: true });

          // Open the cart only after success (fallback to the common cart URL)
          const cartUrl = resp?.data?.cart || "https://www.madeirausa.com/shoppingcart.aspx";
          window.open(cartUrl, "_blank", "noopener");
        } catch (err) {
          console.error("Madeira web order failed:", err);
          const msg = err?.response?.data?.details || err?.message || "Unknown error";
          alert("Failed to add to Madeira cart. " + msg);
          return; // don't log inventory if order failed
        }
      }
      // WEBSITE path — other vendors: open configured website if present
      else if (method === "website" && v.website) {
        window.open(v.website, "_blank", "noopener");
      }
      // EMAIL path (no mailto fallback → avoids Outlook)
      else {
        const gmailUrl = buildGmailCompose({ to: emailTo, cc, subject, body, authUser });
        const win = openUrlReturn(gmailUrl);
        setGmailPopup(win);
      }
      // Log "Ordered" just like before
      const materialPayload = [];
      const threadPayload = [];
      for (const r of rows) {
        const base = { quantity: String(r.qty || "1"), action: "Ordered" };
        if ((r.type || "Material").toLowerCase() === "thread") {
          threadPayload.push({ ...base, value: r.name });
        } else {
          materialPayload.push({ ...base, materialName: r.name, type: "Material" });
        }
      }

      if (materialPayload.length) {
        await axios.post(`${ROOT}/materialInventory`, materialPayload, { withCredentials: true });
      }
      if (threadPayload.length) {
        await axios.post(`${ROOT}/threadInventory`, threadPayload, { withCredentials: true });
      }

      alert((method === "website" ? "Website opened." : "Gmail compose opened.") + " Order logged.");
      setModalOpenForVendor(null);
      setPoNotes("");
      setRequestBy("");
      setGmailPopup(null);
    } catch (e) {
      console.error("Failed to order/log", e);
      alert("Failed to order/log. Check console.");
    }
  }

  // Departments (placeholder)
  const departments = ["Digitizing", "Fur", "Cut", "Print", "Embroidery", "Sewing"];

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "auto auto", gap: 16, padding: 16 }}>
        {/* TL — Performance / Goals (placeholder metrics) */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", padding: 12, overflow: "hidden" }}>
          <div style={header}>Company Performance</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {["On-Time Ship %","Avg Lead Time","Throughput (pcs/day)","Digitizing SLA","Embroidery Hours","WIP Count"].map((t,i) => (
              <div key={i} style={{ border:"1px solid #eee", borderRadius:10, padding:10 }}>
                <div style={{ fontSize:12, color:"#666" }}>{t}</div>
                <div style={{ fontSize:22, fontWeight:700 }}>—</div>
                <div style={{ fontSize:11, color:"#888" }}>calculating…</div>
              </div>
            ))}
          </div>
        </div>

        {/* TR — Upcoming Jobs */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", padding: 12, overflow: "hidden" }}>
          <div style={{ ...header, textAlign: "center" }}>
            Upcoming Jobs (Ship in next {daysWindow} days)
          </div>

          {/* column headers */}
          <div
            style={{
              ...rowCard,
              padding: "4px 8px",
              marginBottom: 8,
              background: "#fafafa",
              borderColor: "#eee",
              fontSize: 11,
              fontWeight: 600,
              color: "#666",
            }}
          >
            <div style={{ ...imgBox, border: "0", background: "transparent" }} />
            <div style={{ width: 58 }}>Order #</div>
            <div style={col(250)}>Company Name</div>
            <div style={col(150)}>Design</div>
            <div style={{ ...col(56, true) }}>Qty</div>
            <div style={col(120)}>Product</div>
            <div style={col(90)}>Stage</div>
            <div style={{ ...col(64, true) }}>Due</div>
            <div style={{ ...col(50, true) }}>Print</div>
            <div style={{ ...col(68, true) }}>Ship</div>
            <div style={{ ...col(110, true) }}>Hard/Soft</div>
          </div>

          {loadingUpcoming && <div>Loading…</div>}
          {!loadingUpcoming && !upcoming.length && <div>No jobs in the next {daysWindow} days.</div>}

          {!loadingUpcoming && upcoming.map((job, idx) => {
            const ring = ringColorByShipDate(job["Ship Date"]);
            const imageUrl = getJobThumbUrl(job, ROOT);

            return (
              <div key={idx} style={rowCard}>
                <div style={{ ...imgBox, borderColor: ring }}>
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={160}
                      height={80}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                      style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, color: "#999" }}>No img</div>
                  )}
                </div>

                {/* Uniform 13px fonts; key values slightly bolder */}
                <div style={{ width: 58, fontWeight: 600, fontSize: 13, color: "#111827" }} title={String(job["Order #"] || "")}>
                  {job["Order #"]}
                </div>
                <div style={{ ...col(250), fontSize: 13, color: "#374151" }} title={String(job["Company Name"] || "")}>
                  {job["Company Name"]}
                </div>
                <div style={{ ...col(150), fontSize: 13, color: "#374151" }} title={String(job["Design"] || "")}>
                  {job["Design"]}
                </div>
                <div style={{ ...col(56, true), fontWeight: 600, fontSize: 13, color: "#111827" }} title={String(job["Quantity"] || "")}>
                  {job["Quantity"]}
                </div>
                <div style={{ ...col(120), fontSize: 13, color: "#374151" }} title={String(job["Product"] || "")}>
                  {job["Product"]}
                </div>
                <div style={{ ...col(90), fontSize: 13, color: "#374151" }} title={String(job["Stage"] || "")}>
                  {job["Stage"]}
                </div>
                <div style={{ ...col(64, true), fontSize: 13, color: "#374151" }} title={String(job["Due Date"] || "")}>
                  {fmtMMDD(job["Due Date"])}
                </div>
                <div style={{ ...col(50, true), fontSize: 13, color: "#374151" }} title={String(job["Print"] || "")}>
                  {job["Print"]}
                </div>
                <div style={{ ...col(68, true), fontWeight: 600, fontSize: 13, color: ring }} title={String(job["Ship Date"] || "")}>
                  {fmtMMDD(job["Ship Date"])}
                </div>
                <div style={{ ...col(110, true), fontSize: 13, color: "#374151" }} title={String(pickHardSoft(job) || "")}>
                  {showMMDDorRaw(pickHardSoft(job))}
                </div>
              </div>
            );
          })}
        </div>



        {/* BL — Department status (placeholders) */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", padding: 12, overflow: "hidden" }}>
          <div style={header}>Department Status</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:10 }}>
            {["Digitizing","Fur","Cut","Print","Embroidery","Sewing"].map((d,i) => (
              <div key={i} style={{ border:"1px solid #eee", borderRadius:10, padding:10, minHeight:72 }}>
                <div style={{ fontSize:12, color:"#666" }}>{d}</div>
                <div style={{ fontSize:22, fontWeight:700 }}>—</div>
                <div style={{ fontSize:11, color:"#888" }}>calculating…</div>
              </div>
            ))}
          </div>
        </div>

        {/* BR — Materials to order */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", padding: 12, overflow: "hidden" }}>
          <div style={header}>Materials To Order (Grouped by Vendor)</div>
          {loadingMaterials && <div>Loading…</div>}
          {!loadingMaterials && !materials.length && <div>No materials currently flagged.</div>}
          {!loadingMaterials && materials.map((grp, idx) => (
            <div key={idx} style={{ border:"1px solid #eee", borderRadius:10, padding:10, marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontWeight:700, fontSize: 13 }}>{grp.vendor || "Unknown Vendor"}</div>
                <button
                  onClick={() => {
                    const v = vendorDir[(grp.vendor || "").trim().toLowerCase()] || {};
                    const vMethod = (v.method || "").toLowerCase();
                    setOrderMethod((vMethod.includes("online") || vMethod.includes("website")) ? "website" : "email");
                    setModalOpenForVendor(grp.vendor);
                  }}
                  style={{ padding:"5px 8px", fontSize:12, borderRadius:8, border:"1px solid #ccc", cursor:"pointer" }}
                >
                  Order Material
                </button>
              </div>
              <div style={{ marginTop:6 }}>
                {(grp.items || []).map((it, j) => {
                  const isThread = String(it.type || "Material").toLowerCase() === "thread";
                  const swatch = isThread ? colorFromName(it.name) : null;

                  return (
                    <div
                      key={j}
                      style={{ display:"flex", alignItems:"center", gap:10, fontSize:12, lineHeight:"16px", padding:"2px 0" }}
                    >
                      {/* Thumbnail box: tries private backend image via fetch-with-credentials; swatch underlays */}
                      <div
                        style={{
                          width: 36, height: 24, borderRadius: 4, border: "1px solid #ddd",
                          overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                          background: "#fafafa", flex: "0 0 36px"
                        }}
                        aria-label={isThread ? "Thread image" : "Material image"}
                        title={it.name}
                      >
                        {isThread ? (
                          <ThreadThumb name={it.name} fallbackColor={swatch} />
                        ) : (
                          // Try vendor + name via backend; SecureImage fetches with credentials and caches blobs
                          <BasicImg
                            src={materialImgUrl(ROOT, grp.vendor, it.name)}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        )}
                      </div>
                      {/* Name */}
                      <div
                        style={{ width: 240, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                        title={it.name}
                      >
                        {it.name}
                      </div>

                      {/* Qty / Unit / Type */}
                      <div style={{ width: 70, textAlign:"right" }} title={String(it.qty ?? "")}>{it.qty}</div>
                      <div style={{ width: 60 }} title={it.unit || ""}>{it.unit || ""}</div>
                      <div style={{ width: 80, color:"#666" }} title={it.type || "Material"}>{it.type || "Material"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Order modal */}
      {modalOpenForVendor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              minWidth: 600,
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
              Order from {modalOpenForVendor}
            </div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
              All items are pre-selected. Unselect anything you don’t want to order.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 150px",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <select
                value={orderMethod}
                onChange={(e) => setOrderMethod(e.target.value)}
                style={{ padding: 6, border: "1px solid #ccc", borderRadius: 6, fontSize: 12 }}
              >
                <option value="email">Send by Email</option>
                <option value="website">Order via Website</option>
              </select>
              <input
                placeholder="Notes (optional)"
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                style={{ padding: 6, border: "1px solid #ccc", borderRadius: 6, fontSize: 12 }}
              />
              <input
                type="date"
                value={requestBy}
                onChange={(e) => setRequestBy(e.target.value)}
                style={{ padding: 6, border: "1px solid #ccc", borderRadius: 6, fontSize: 12 }}
                title="Requested By date"
              />
            </div>

            <div>
              {modalRows.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "20px 1fr 120px 80px 110px",
                    gap: 10,
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom: "1px solid #f1f1f1",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!r.selected}
                    onChange={(e) =>
                      setModalSelections((s) => ({
                        ...s,
                        [r.key]: { ...s[r.key], selected: e.target.checked },
                      }))
                    }
                  />
                  <div
                    title={r.name}
                    style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}
                  >
                    {r.name}
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={r.qty || ""}
                    onChange={(e) =>
                      setModalSelections((s) => ({ ...s, [r.key]: { ...s[r.key], qty: e.target.value } }))
                    }
                    style={{ width: "100%", padding: 6, border: "1px solid #ccc", borderRadius: 6 }}
                  />
                  <input
                    value={r.unit || ""}
                    onChange={(e) =>
                      setModalSelections((s) => ({ ...s, [r.key]: { ...s[r.key], unit: e.target.value } }))
                    }
                    placeholder="Unit"
                    style={{ width: "100%", padding: 6, border: "1px solid #ccc", borderRadius: 6 }}
                  />
                  <select
                    value={r.type || "Material"}
                    onChange={(e) =>
                      setModalSelections((s) => ({ ...s, [r.key]: { ...s[r.key], type: e.target.value } }))
                    }
                    style={{ width: "100%", padding: 6, border: "1px solid #ccc", borderRadius: 6 }}
                  >
                    <option>Material</option>
                    <option>Thread</option>
                  </select>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
              <button
                onClick={() => {
                  setModalOpenForVendor(null);
                  setGmailPopup(null);
                }}
                style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 8 }}
              >
                Cancel
              </button>
              <button
                onClick={submitOrder}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #0a7",
                  background: "#0a7",
                  color: "#fff",
                  borderRadius: 8,
                }}
              >
                Order & Log
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gmail popup banner */}
      {gmailPopup && !gmailPopup.closed && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            background: "#111",
            color: "#fff",
            padding: "10px 12px",
            borderRadius: 10,
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 2000,
          }}
        >
          <div style={{ fontSize: 12 }}>
            Gmail compose is open. After you send, you can close it.
          </div>
          <button
            onClick={() => {
              try { gmailPopup.close(); } catch {}
              setGmailPopup(null);
            }}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #fff",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Close Gmail
          </button>
        </div>
      )}
    </div>
  );
}
