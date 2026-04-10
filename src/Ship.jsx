import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { postShipQboClientLog } from "./shipQboClientLog";

function summarizeInvoiceForLog(inv) {
  if (!inv || typeof inv !== "string") return { hasInvoiceInPayload: false };
  const t = inv.trim();
  if (!t) return { hasInvoiceInPayload: false };
  try {
    const u = new URL(t);
    return {
      hasInvoiceInPayload: true,
      invoiceHost: u.hostname,
      invoiceTxnId: u.searchParams.get("txnId") || "",
      invoiceCompanyId:
        u.searchParams.get("companyId") ||
        u.searchParams.get("deeplinkcompanyid") ||
        "",
    };
  } catch {
    return { hasInvoiceInPayload: true, invoiceUrlPrefix: t.slice(0, 200) };
  }
}

// Map our logical box names to their actual dimensions
const BOX_DIMENSIONS = {
  Small:  "10×10×10",
  Medium: "15×15×15",
  Large:  "20×20×20"
};

/** Preset boxes for Ship wizard (dims inches, weight lbs). */
const SHIP_BOX_PRESETS = [
  { id: "14x5x7", label: "14×5×7 (5 lbs)", L: 14, W: 5, H: 7, weight: 5 },
  { id: "10x10x10", label: "10×10×10 (10 lbs)", L: 10, W: 10, H: 10, weight: 10 },
  { id: "13x13x13", label: "13×13×13 (13 lbs)", L: 13, W: 13, H: 13, weight: 13 },
  { id: "15x15x15", label: "15×15×15 (15 lbs)", L: 15, W: 15, H: 15, weight: 15 },
  { id: "20x20x20", label: "20×20×20 (20 lbs)", L: 20, W: 20, H: 20, weight: 20 },
];

/** Public-folder logos for ship actions (CRA/Vite: files in public/ship-icons/). */
const _pub = (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL
  ? String(process.env.PUBLIC_URL).replace(/\/$/, "")
  : "") || "";
const SHIP_ICON_SHIP_ONLY = `${_pub}/ship-icons/ship-ups-only.png`;
const SHIP_ICON_SHIP_AND_BILL = `${_pub}/ship-icons/ship-and-bill.png`;
const SHIP_ICON_BILL_ONLY = `${_pub}/ship-icons/bill-only-qb.png`;

function initialBoxCounts() {
  const o = {};
  SHIP_BOX_PRESETS.forEach((p) => {
    o[p.id] = 0;
  });
  return o;
}

function expandPackagesFromCounts(counts) {
  const out = [];
  SHIP_BOX_PRESETS.forEach((p) => {
    const n = Math.max(0, Math.floor(Number(counts[p.id]) || 0));
    for (let i = 0; i < n; i++) {
      out.push({ L: p.L, W: p.W, H: p.H, weight: p.weight });
    }
  });
  return out;
}

function boxesSummaryFromCounts(counts) {
  return SHIP_BOX_PRESETS.filter((p) => (counts[p.id] || 0) > 0).map((p) => ({
    label: p.label,
    qty: counts[p.id] || 0,
    L: p.L,
    W: p.W,
    H: p.H,
    weight: p.weight,
  }));
}

/** Preset counts + user-entered custom boxes → flat package list for rates / UPS. */
function buildShipmentPackages(counts, customBoxes) {
  const fromPresets = expandPackagesFromCounts(counts);
  const fromCustom = (customBoxes || []).map((c) => ({
    L: c.L,
    W: c.W,
    H: c.H,
    weight: c.weight,
  }));
  return [...fromPresets, ...fromCustom];
}

function buildBoxesSummary(counts, customBoxes) {
  const presetPart = boxesSummaryFromCounts(counts);
  const customPart = (customBoxes || []).map((c) => ({
    label: `${c.L}×${c.W}×${c.H} (${c.weight} lb) custom`,
    qty: 1,
    L: c.L,
    W: c.W,
    H: c.H,
    weight: c.weight,
    customId: c.id,
  }));
  return [...presetPart, ...customPart];
}

function summaryForShipmentApi(rows) {
  return (rows || []).map(({ customId, ...rest }) => rest);
}

function hasAnyBoxesSelected(counts, customBoxes) {
  const presetAny = SHIP_BOX_PRESETS.some((p) => (counts[p.id] || 0) > 0);
  return presetAny || (customBoxes && customBoxes.length > 0);
}

function parseUpsRateNumber(rate) {
  if (rate == null || rate === "N/A") return 0;
  if (typeof rate === "number" && Number.isFinite(rate)) return rate;
  const s = String(rate).replace(/[$,]/g, "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const SKIP_UPS = false;

// Replace your existing parseDateFromString + formatDateMMDD with this:

// Convert Google/Excel serial date numbers to a JS Date (treat as days since 1899-12-30)
function fromSheetSerial(n) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  // Excel/Sheets serial day 1 is 1899-12-31; but Google Sheets aligns with 1899-12-30 for JS calc
  const base = Date.UTC(1899, 11, 30);
  return new Date(base + n * msPerDay);
}

// Robust parse: accepts number (serial), Date, or string "MM/DD", "YYYY-MM-DD", etc.
function parseDateFromString(val) {
  if (!val && val !== 0) return null;

  if (val instanceof Date) return isNaN(val) ? null : val;
  if (typeof val === "number") return fromSheetSerial(val);

  const s = String(val).trim();
  if (!s) return null;

  const parts = s.includes("-") ? s.split("-")
              : s.includes("/") ? s.split("/")
              : [];

  if (parts.length === 2) {
    // M/D or MM/DD (assume current year)
    const [mm, dd] = parts.map(x => parseInt(x, 10));
    if (!mm || !dd) return null;
    const now = new Date();
    return new Date(now.getFullYear(), mm - 1, dd);
  }

  if (parts.length === 3) {
    // YYYY-MM-DD or MM-DD-YYYY or MM/DD/YYYY
    let [a, b, c] = parts;
    if (s.includes("-")) {
      // Could be YYYY-MM-DD or MM-DD-YYYY
      if (a.length === 4) {
        const year = parseInt(a, 10), month = parseInt(b, 10), day = parseInt(c, 10);
        if (!year || !month || !day) return null;
        return new Date(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
      } else if (c.length === 4) {
        const year = parseInt(c, 10), month = parseInt(a, 10), day = parseInt(b, 10);
        if (!year || !month || !day) return null;
        return new Date(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
      }
    } else {
      // MM/DD/YYYY
      const month = parseInt(a, 10), day = parseInt(b, 10), year = parseInt(c, 10);
      if (!year || !month || !day) return null;
      return new Date(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
    }
  }

  // Fallback: let JS try
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function formatDateMMDD(val) {
  const d = parseDateFromString(val);
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}


function getButtonColor(deliveryDateStr, selectedJobs, allJobs) {
  if (!deliveryDateStr || selectedJobs.length === 0) return "#ccc";

  const deliveryDate = new Date(deliveryDateStr);

  const dueDates = selectedJobs
    .map(id => allJobs.find(j => j.orderId.toString() === id)?.due)
    .filter(Boolean)
    .map(dateStr => new Date(dateStr));

  if (dueDates.length === 0) return "#ccc";

  const earliestDueDate = new Date(Math.min(...dueDates));

  if (deliveryDate < earliestDueDate) return "#c2f0c2"; // green
  if (
    deliveryDate.getFullYear() === earliestDueDate.getFullYear() &&
    deliveryDate.getMonth() === earliestDueDate.getMonth() &&
    deliveryDate.getDate() === earliestDueDate.getDate()
  ) {
    return "#fff5ba"; // yellow
  }
  return "#f5c2c2"; // red
}

// Parses delivery date text like "Fri 06/21" into a JS Date object
function parseDeliveryDate(text) {
  const match = text.match(/(\d{2})\/(\d{2})/);
  if (!match) return null;
  const [, mm, dd] = match;
  const now = new Date();
  return new Date(now.getFullYear(), parseInt(mm) - 1, parseInt(dd));
}

function getEarliestDueDate(selected, jobs) {
  const selectedJobs = jobs.filter(j => selected.includes(j.orderId.toString()));
  const dueDates = selectedJobs
    .map((j) => parseDateFromString(j["Due Date"] ?? j.due ?? j.Due))
    .filter((d) => d && !isNaN(d.getTime()));
  return dueDates.length > 0 ? new Date(Math.min(...dueDates.map((d) => d.getTime()))) : null;
}

/** Sheet column "Hard Date/Soft Date" → short label for UI. */
function formatHardSoftType(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower.includes("hard")) return "Hard date";
  if (lower.includes("soft")) return "Soft date";
  return s;
}

/** One label when all selected rows agree; otherwise a mixed hint. */
function hardSoftSummaryForSelection(selected, jobs) {
  const selectedJobs = jobs.filter((j) => selected.includes(j.orderId.toString()));
  const vals = [
    ...new Set(
      selectedJobs
        .map((j) => String(j["Hard Date/Soft Date"] ?? j["Hard/Soft"] ?? "").trim())
        .filter(Boolean)
    ),
  ];
  if (vals.length === 0) return null;
  const labels = [...new Set(vals.map(formatHardSoftType).filter(Boolean))];
  if (labels.length === 1) return labels[0];
  return "Mixed (Hard/Soft)";
}

/** UPS returns "N business days" — parse N for ETA. */
function parseBusinessDaysFromDelivery(deliveryStr) {
  if (deliveryStr == null || deliveryStr === "") return null;
  const m = String(deliveryStr).match(/(\d+)\s*business\s*day/i);
  if (m) return Math.max(0, parseInt(m[1], 10));
  const m2 = String(deliveryStr).match(/^(\d+)\s*$/);
  if (m2) return Math.max(0, parseInt(m2[1], 10));
  return null;
}

function addBusinessDays(fromDate, businessDays) {
  const n = Math.max(0, parseInt(businessDays, 10) || 0);
  const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

/** Parse UPS ScheduledDeliveryDate (YYYY-MM-DD or YYYYMMDD). */
function parseUpsScheduledDate(val) {
  if (val == null || val === "") return null;
  const str = String(val).trim();
  if (/^\d{8}$/.test(str)) {
    const y = str.slice(0, 4);
    const m = str.slice(4, 6);
    const d = str.slice(6, 8);
    const dt = new Date(`${y}-${m}-${d}T12:00:00`);
    return isNaN(dt.getTime()) ? null : dt;
  }
  return parseDateFromString(str);
}

/** Estimated delivery: prefer UPS calendar date, else today + business_days. */
function estimatedDeliveryDate(opt) {
  if (!opt || opt.method === "Manual Shipping") return null;
  const sched = parseUpsScheduledDate(opt.scheduled_delivery_date);
  if (sched) return sched;
  const n =
    typeof opt.business_days === "number" && Number.isFinite(opt.business_days)
      ? Math.max(0, Math.floor(opt.business_days))
      : parseBusinessDaysFromDelivery(opt?.delivery);
  if (n == null) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return addBusinessDays(start, n);
}

function formatArrivalLabel(d) {
  if (!d || isNaN(d.getTime())) return "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${formatDateMMDD(d)}`;
}

/** Compare calendar dates only: -1 a before b, 0 same, 1 a after b. */
function calendarDateCompare(a, b) {
  if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  if (da < db) return -1;
  if (da > db) return 1;
  return 0;
}

/** Due vs today — same green / yellow / red palette as rate tiles / Overview-style urgency. */
function queueCardDueStyle(dueVal) {
  const due = parseDateFromString(dueVal);
  if (!due) {
    return {
      background: "rgba(249, 250, 251, 0.95)",
      border: "1px solid #e5e7eb",
    };
  }
  const today = new Date();
  const c = calendarDateCompare(due, today);
  if (c < 0) {
    return {
      background: "rgba(231, 76, 60, 0.18)",
      border: "2px solid #e74c3c",
    };
  }
  if (c === 0) {
    return {
      background: "rgba(243, 156, 18, 0.2)",
      border: "2px solid #f39c12",
    };
  }
  return {
    background: "rgba(46, 204, 113, 0.12)",
    border: "2px solid #2ecc71",
  };
}

/**
 * Same tint + border as Overview upcoming jobs (cardUrgencyFromRing / ringColorByShipDate).
 * Logic here is delivery vs due — colors only match Overview palette.
 */
function rateTileDueStyle(estimatedArrival, earliestDue) {
  if (!estimatedArrival || !earliestDue) {
    return {
      background: "rgba(249, 250, 251, 0.95)",
      border: "1px solid #e5e7eb",
    };
  }
  const c = calendarDateCompare(estimatedArrival, earliestDue);
  if (c < 0) {
    return {
      background: "rgba(46, 204, 113, 0.16)",
      border: "2px solid #2ecc71",
    };
  }
  if (c === 0) {
    return {
      background: "rgba(243, 156, 18, 0.2)",
      border: "2px solid #f39c12",
    };
  }
  return {
    background: "rgba(231, 76, 60, 0.22)",
    border: "2px solid #e74c3c",
  };
}

function LoginModal({ open, onClose, onLogin }) {
  if (!open) return null;
  const backdropStyle = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
  };
  const cardStyle = {
    background: "#fff", borderRadius: 12, padding: 20, width: 360, boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
  };
  const rowStyle = { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 };
  return (
    <div style={backdropStyle} role="dialog" aria-modal="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Session expired</div>
        <div>Please log in to continue processing shipments.</div>
        <div style={rowStyle}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={onLogin}>Log in</button>
        </div>
      </div>
    </div>
  );
}

export default function Ship() {
  // Helpers must live inside the component (hooks rule)
  const openedOnceRef = useRef(false);

  function isHttpUrl(u) {
    return typeof u === "string" && /^https?:\/\//i.test(u);
  }

  function openResultsWindows(data) {
    if (openedOnceRef.current) {
      console.log("Suppressing duplicate popups for this shipment run");
      return;
    }
    openedOnceRef.current = true;

    const labels = Array.isArray(data?.labels) ? data.labels : [];
    const slips  = Array.isArray(data?.slips)  ? data.slips  : [];
    const openLabels = data?.open_label_windows !== false;
    const openSlips = data?.open_slip_windows === true;

    const labelHttp = labels.filter(isHttpUrl);
    const slipHttp = slips.filter(isHttpUrl);
    postShipQboClientLog([
      {
        message: "openResultsWindows",
        openLabels,
        openSlips,
        labelUrls: labelHttp,
        slipUrls: slipHttp,
        labels_copied_to_folder: data?.labels_copied_to_folder,
      },
    ]);

    // Labels (skip when backend copied to Label Printer folder)
    if (openLabels) {
      labels.forEach((u) => {
        if (isHttpUrl(u)) {
          const w = window.open(u, "_blank", "noopener,noreferrer");
          if (w) w.blur();
        }
      });
    }

    // Slips: backend prints directly, so popup only when explicitly requested.
    if (openSlips) {
      slips.forEach((u) => {
        if (isHttpUrl(u)) {
          const w = window.open(u, "_blank", "noopener,noreferrer");
          if (w) w.blur();
        }
      });
    }
  }

  // NEW: Force QuickBooks auth (popup if needed), then continue
  async function ensureQboAuth() {
    try {
      const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");

      // Pre-open a placeholder popup synchronously (reduces popup blockers)
      // This function MUST be called from a direct user gesture (e.g., button click).
      const w = 720, h = 720;
      const y = window.top.outerHeight / 2 + window.top.screenY - (h / 2);
      const x = window.top.outerWidth / 2 + window.top.screenX - (w / 2);
      let popup = window.open(
        "about:blank",
        "qbo_oauth",
        `toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${w},height=${h},top=${y},left=${x}`
      );

      // 1) Initial check
      const resp = await fetch(`${API_BASE}/api/ensure-qbo-auth`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      let data = null;
      try { data = await resp.json(); } catch {}

      if (resp.ok && data?.ok) {
        // Already authorized — close the placeholder if it exists
        if (popup && !popup.closed) popup.close();
        return true;
      }

      // Show backend-provided error details if any
      if (!resp.ok && data?.error && !data?.redirect) {
        if (popup && !popup.closed) popup.close();
        alert(`QuickBooks auth failed: ${data.detail || data.error}`);
        return false;
      }

      // 2) If we got a redirect, navigate the pre-opened popup
      if (data?.redirect) {
        if (!popup || popup.closed) {
          // Fallback: try to open again (may be blocked if not in user gesture)
          popup = window.open("about:blank", "qbo_oauth",
            `toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${w},height=${h},top=${y},left=${x}`
          );
          if (!popup) {
            alert("Popup blocked. Please allow popups for QuickBooks login.");
            return false;
          }
        }

        // Support absolute or relative redirect URLs
        const targetUrl = data.redirect.startsWith("http")
          ? data.redirect
          : `${API_BASE}${data.redirect}`;

        try { popup.location = targetUrl; } catch { popup.close(); return false; }

        // Wait until popup closes (5 min timeout)
        await new Promise((resolve, reject) => {
          const start = Date.now();
          const timer = setInterval(() => {
            if (popup.closed) {
              clearInterval(timer);
              resolve();
            } else if (Date.now() - start > 5 * 60 * 1000) {
              clearInterval(timer);
              try { popup.close(); } catch {}
              reject(new Error("QuickBooks login timed out"));
            }
          }, 800);
        });

        // 3) Re-check after popup closes
        const re = await fetch(`${API_BASE}/api/ensure-qbo-auth`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });

        let redata = null;
        try { redata = await re.json(); } catch {}

        if (re.ok && redata?.ok) {
          return true;
        }

        if (!re.ok && redata?.error && !redata?.redirect) {
          alert(`QuickBooks auth failed: ${redata.detail || redata.error}`);
          return false;
        }

        // No explicit error but also not ok → treat as cancelled
        return false;
      }

      // No ok, no redirect, no error → treat as failure
      if (popup && !popup.closed) popup.close();
      return false;
    } catch (e) {
      console.error("[ensureQboAuth] error:", e);
      alert("QuickBooks login failed or was cancelled.");
      return false;
    }
  }

  // 📌 give this tab a name so we can re-focus it later
  useEffect(() => {
    window.name = 'mainShipTab';
  }, []);

  const [searchParams] = useSearchParams();
  const targetCompany = searchParams.get("company");
  const targetOrder = searchParams.get("order");
  const jobRefs = useRef({});
  const [jobs, setJobs] = useState([]);
  const [allCompanies, setAllCompanies] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [companyInput, setCompanyInput] = useState("");
  /** Embroidery / Sewing jobs for quick-pick cards (sorted on server). */
  const [productionQueue, setProductionQueue] = useState([]);
  const [productionQueueLoading, setProductionQueueLoading] = useState(false);
  const [isPageOverlay, setIsPageOverlay] = useState(false);
  const [pageOverlayText, setPageOverlayText] = useState("");

// Session/login modal + stable API base for redirects
  const [showLoginModal, setShowLoginModal] = useState(false);
  const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");

  const query = new URLSearchParams(window.location.search);
  const defaultCompany = query.get("company");

  const [isShippingOverlay, setIsShippingOverlay] = useState(false);
  const [shippingStage, setShippingStage] = useState(""); // dynamic overlay message
  const [showBoxModal, setShowBoxModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [showAddressChoiceModal, setShowAddressChoiceModal] = useState(false);
  const [showOneTimeAddressModal, setShowOneTimeAddressModal] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [boxCounts, setBoxCounts] = useState(() => initialBoxCounts());
  /** @type {Array<{ id: string, L: number, W: number, H: number, weight: number }>} */
  const [customBoxes, setCustomBoxes] = useState([]);
  const [showCustomBoxModal, setShowCustomBoxModal] = useState(false);
  const [customBoxForm, setCustomBoxForm] = useState({
    L: "",
    W: "",
    H: "",
    weight: "",
  });
  const [oneTimeShipAddress, setOneTimeShipAddress] = useState(null);
  const [oneTimeAddressForm, setOneTimeAddressForm] = useState({
    companyName: "",
    contactName: "",
    phone: "",
    street1: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
  });
  /** UPS wizard: whether this flow should create a QBO invoice (set when opening box modal). */
  const upsFlowCreateInvoiceRef = useRef(true);
  const navigate = useNavigate();

  // === useEffect 1: Initial load ===
  useEffect(() => {
    async function loadJobsForCompany(company) {
      try {
        const res = await fetch(
          `${API_BASE}/api/jobs-for-company?company=${encodeURIComponent(company)}`,
          { credentials: "include" }
        );
        if (res.status === 401) {
          setShowLoginModal(true);
          return;
        }
        const data = await res.json();

        if (res.ok) {
          const incompleteJobs = (data.jobs || []).filter((job) => {
            const stage = String(job["Stage"] ?? job.stage ?? "").trim().toUpperCase();
            const status = String(job["Status"] ?? job.status ?? "").trim().toUpperCase();
            return stage !== "COMPLETE" && stage !== "COMPLETED" && status !== "COMPLETE" && status !== "COMPLETED";
          });

          const updatedJobs = incompleteJobs.map((job) => {
            const qty = Number(job.Quantity ?? job.quantity ?? 0);
            return {
              ...job,
              shipQty: qty,
              ShippedQty: qty,
            };
          });

          setJobs(updatedJobs);

          setSelected((prevSelected) =>
            prevSelected.filter((id) =>
              updatedJobs.some((j) => j.orderId.toString() === id)
            )
          );
        } else {
          console.error("Fetch error:", data.error);
        }
      } catch (err) {
        console.error("Error loading jobs:", err);
      }
    }

    async function setup() {
      await fetchCompanyNames();
      if (defaultCompany) {
        setCompanyInput(defaultCompany);
        await loadJobsForCompany(defaultCompany);
      }
    }

    setup();
  }, []);
  // === End useEffect 1 ===

  // Embroidery / Sewing queue for cards under the search bar
  useEffect(() => {
    let cancelled = false;

    async function loadProductionQueue() {
      try {
        setProductionQueueLoading(true);
        const res = await fetch(`${API_BASE}/api/ship-production-queue`, {
          credentials: "include",
        });
        if (res.status === 401) {
          if (!cancelled) setShowLoginModal(true);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.jobs)) {
          setProductionQueue(data.jobs);
        }
      } catch (e) {
        console.error("ship-production-queue:", e);
      } finally {
        if (!cancelled) setProductionQueueLoading(false);
      }
    }

    loadProductionQueue();
    const t = setInterval(loadProductionQueue, 60000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [API_BASE]);

  // === useEffect 2: Live update polling ===
  useEffect(() => {
    if (!companyInput || !allCompanies.includes(companyInput)) return;

    const interval = setInterval(() => {
      fetch(
        `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/api/jobs-for-company?company=${encodeURIComponent(companyInput)}`,
        { credentials: "include" }
      )
        .then(res => {
          if (res.status === 401) {
            setShowLoginModal(true);
            throw new Error("unauthorized");
          }
          return res.json();
        })

        .then(data => {
          if (data.jobs) {
            // Filter out COMPLETE jobs
            const incompleteJobs = data.jobs.filter((job) => {
              const stage = String(job["Stage"] ?? job.stage ?? "").trim().toUpperCase();
              const status = String(job["Status"] ?? job.status ?? "").trim().toUpperCase();
              return stage !== "COMPLETE" && stage !== "COMPLETED" && status !== "COMPLETE" && status !== "COMPLETED";
            });

            setJobs(prev => {
              const prevMap = Object.fromEntries(prev.map(j => [j.orderId, j]));
              return incompleteJobs.map(newJob => {
                const existing = prevMap[newJob.orderId];
                return {
                  ...newJob,
                  shipQty: existing?.shipQty ?? newJob.quantity,
                  ShippedQty: existing?.shipQty ?? newJob.quantity,
                };
              });
            });

            // 🧼 Remove any selected jobs that no longer exist
            setSelected(prevSelected => {
              const newOrderIds = new Set(incompleteJobs.map(j => j.orderId.toString()));
              return prevSelected.filter(id => newOrderIds.has(id));
            });
          }
        })
        .catch(err => console.error("Live update error", err));
    }, 15000);

    return () => clearInterval(interval);
  }, [companyInput, allCompanies]);

  // === End useEffect 2 ===

  useEffect(() => {
    // 1) Retry any pending shipment
    const retryPendingShipment = async () => {
      const pending = sessionStorage.getItem("pendingShipment");
      if (!pending) return;

      console.log("🔁 Resuming pending shipment...");
      sessionStorage.removeItem("pendingShipment");
      const payload = JSON.parse(pending);

      const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
      const res = await fetch(`${API_BASE}/api/process-shipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        alert(data.error || "Shipment failed.");
        return;
      }

      openedOnceRef.current = false;
      postShipQboClientLog([
        {
          message: "pending_shipment_resume_ok",
          labels: data?.labels,
          open_label_windows: data?.open_label_windows,
          open_slip_windows: data?.open_slip_windows,
          labels_copied_to_folder: data?.labels_copied_to_folder,
          tracking_numbers: data?.tracking_numbers,
          ...summarizeInvoiceForLog(
            data?.invoice && typeof data.invoice === "string" ? data.invoice : ""
          ),
        },
      ]);
      // Open URLs once (labels/invoice/slips)
      openResultsWindows(data);

      // Refocus current tab
      setTimeout(() => window.focus(), 500);

      // Build invoice URL for summary page (use the one we just created)
      const invoiceUrl = data?.invoice && typeof data.invoice === "string"
        ? data.invoice.trim()
        : "";
      try {
        sessionStorage.setItem("jrco_lastInvoiceUrl", invoiceUrl || "");
      } catch {}

      navigate("/shipment-complete", {
        state: {
          shippedOk: true,
          labelsPrinted: Array.isArray(data?.labels) && data.labels.length > 0,
          slipsSaved: Array.isArray(data?.slips) && data.slips.length > 0,
          invoiceUrl,
        },
      });
    };

    retryPendingShipment();

    // 2) If we deep-linked with ?order=..., scroll into view + select
    if (targetOrder && jobs.length > 0) {
      const match = jobs.find(j => j.orderId.toString() === targetOrder);
      if (match) {
        const el = jobRefs.current[targetOrder];
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        setSelected(prev =>
          prev.includes(targetOrder) ? prev : [...prev, targetOrder]
        );
      }
    }
  }, [jobs, targetOrder, navigate]);

  async function fetchCompanyNames() {
    try {
      setIsPageOverlay(true);
      setPageOverlayText("Loading customers…");

      const res = await fetch(
        `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/api/company-list`,
        { credentials: "include" }
      );
      const data = await res.json();
      setAllCompanies(data.companies || []);
    } catch (err) {
      console.error("Company fetch failed", err);
    } finally {
      setIsPageOverlay(false);
      setPageOverlayText("");
    }
  }


  async function fetchJobs(company) {
    try {
      setIsPageOverlay(true);
      setPageOverlayText("Loading jobs…");

      const res = await fetch(
        `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/api/jobs-for-company?company=${encodeURIComponent(company)}`,
        { credentials: "include" }
      );
      if (res.status === 401) {
        setShowLoginModal(true);
        return;
      }

      const data = await res.json();
      if (res.ok) {
        // Filter out COMPLETE jobs
        const incompleteJobs = data.jobs.filter((job) => {
          const stage = String(job["Stage"] ?? job.stage ?? "").trim().toUpperCase();
          const status = String(job["Status"] ?? job.status ?? "").trim().toUpperCase();
          return stage !== "COMPLETE" && stage !== "COMPLETED" && status !== "COMPLETE" && status !== "COMPLETED";
        });

        const jobsWithQty = incompleteJobs.map(job => {
          const qty = Number(job.Quantity ?? 0);
          return { ...job, shipQty: qty, ShippedQty: qty };
        });
        setJobs(jobsWithQty);
        setSelected(prev =>
          prev.filter(id => jobsWithQty.some(j => j.orderId.toString() === id))
        );
      } else {
        alert(data.error || "Failed to load jobs");
      }
    } catch (err) {
      console.error("Error loading jobs:", err);
      alert("Error loading jobs.");
    } finally {
      setIsPageOverlay(false);
      setPageOverlayText("");
    }
  }



  const handleSelectCompany = (e) => {
    const value = e.target.value;
    setCompanyInput(value);
    if (allCompanies.includes(value)) {
      fetchJobs(value);
    }
  };

  /** Same outcome as choosing a valid company in the search field. */
  const openCompanyInShip = (companyName) => {
    const name = String(companyName || "").trim();
    if (!name) return;
    setCompanyInput(name);
    fetchJobs(name);
  };

  const toggleSelect = (orderId) => {
    const idStr = orderId.toString();
    setSelected((prev) =>
      prev.includes(idStr)
        ? prev.filter((id) => id !== idStr)
        : [...prev, idStr]
    );
  };

  const handleSelectAll = () => {
    const allOrderIds = jobs.map(job => job.orderId.toString());
    setSelected(allOrderIds);
  };

  const goToBoxSelect = () => {
    try {
      sessionStorage.setItem(
        "ship.selected",
        JSON.stringify({ selected, jobs })
      );
    } catch {}
    navigate("/box-select", { state: { selected, jobsSnapshot: jobs } });
  };


  const promptDimensionsForProduct = (product) => {
    return new Promise((resolve) => {
      const container = document.createElement("div");
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.fontSize = "1rem";

      const label = document.createElement("label");
      label.innerText = `Enter dimensions for "${product}" (in inches):`;
      label.style.marginBottom = "0.5rem";

      const inputL = document.createElement("input");
      const inputW = document.createElement("input");
      const inputH = document.createElement("input");

      [inputL, inputW, inputH].forEach((input, i) => {
        input.placeholder = ["Length", "Width", "Height"][i];
        input.type = "number";
        input.style.marginBottom = "0.5rem";
        input.style.padding = "0.25rem";
        input.style.fontSize = "1rem";
      });

      const submitBtn = document.createElement("button");
      submitBtn.innerText = "Save";
      submitBtn.style.padding = "0.5rem";
      submitBtn.style.fontSize = "1rem";

      submitBtn.onclick = async () => {
        const length = inputL.value;
        const width = inputW.value;
        const height = inputH.value;

        if (!length || !width || !height) {
          alert("Please enter all three dimensions.");
          return;
        }

        try {
          const res = await fetch(
            `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/api/process-shipment`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(parsed),
            }
          );
          const data = await res.json();
          if (res.ok) {
            document.body.removeChild(dialog);
            resolve(true);
          } else {
            alert(`Failed to set volume: ${data.error}`);
            resolve(false);
          }
        } catch (err) {
          alert("Failed to save volume.");
          resolve(false);
        }
      };

      container.appendChild(label);
      container.appendChild(inputL);
      container.appendChild(inputW);
      container.appendChild(inputH);
      container.appendChild(submitBtn);

      const dialog = document.createElement("div");
      dialog.style.position = "fixed";
      dialog.style.top = "50%";
      dialog.style.left = "50%";
      dialog.style.transform = "translate(-50%, -50%)";
      dialog.style.backgroundColor = "#fff";
      dialog.style.padding = "1rem";
      dialog.style.border = "1px solid #ccc";
      dialog.style.borderRadius = "8px";
      dialog.style.zIndex = 9999;
      dialog.appendChild(container);

      document.body.appendChild(dialog);
    });
  };

  /** Shared POST /api/process-shipment + completion navigation. */
  const runShipmentCore = async (shipmentBody) => {
    const mergedBody = {
      ...shipmentBody,
      skip_invoice:
        shipmentBody.skip_invoice !== undefined
          ? Boolean(shipmentBody.skip_invoice)
          : false,
    };

    openedOnceRef.current = false;
    setIsShippingOverlay(true);
    setLoading(true);

    const needsQbo = !mergedBody.skip_invoice;

    try {
      if (needsQbo) {
        setShippingStage("🔐 Checking QuickBooks login…");
        const authed = await ensureQboAuth();
        if (!authed) {
          setIsShippingOverlay(false);
          setLoading(false);
          alert("QuickBooks login failed or was cancelled.");
          return;
        }
      }

      {
        const si = mergedBody.skip_invoice;
        const su = mergedBody.skip_ups === true;
        let msg = "📦 Processing shipment…";
        if (!su && si) msg = "📦 Creating labels & packing slip (no invoice)…";
        else if (!su && !si) msg = "📦 Creating labels, invoice, packing slip…";
        else if (su && !si) msg = "📦 Creating invoice & packing slip (no UPS)…";
        else msg = "📦 Creating packing slip…";
        setShippingStage(msg);
      }
      const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
      let shipData;
      try {
        const shipRes = await fetch(`${API_BASE}/api/process-shipment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(mergedBody),
        });
        const data = await shipRes.json();
        if (!shipRes.ok) {
          console.warn("process-shipment error:", data.error);
          throw new Error(data.error || `HTTP ${shipRes.status}`);
        }
        shipData = data;
      } catch (procErr) {
        console.error("process-shipment failed:", procErr);
        throw procErr;
      }

      postShipQboClientLog([
        {
          message: "process_shipment_client_received",
          skip_invoice: mergedBody.skip_invoice,
          skip_ups: mergedBody.skip_ups,
          order_ids: mergedBody.order_ids,
          labels: shipData?.labels,
          open_label_windows: shipData?.open_label_windows,
          open_slip_windows: shipData?.open_slip_windows,
          labels_copied_to_folder: shipData?.labels_copied_to_folder,
          tracking_numbers: shipData?.tracking_numbers,
          ...summarizeInvoiceForLog(
            shipData?.invoice && typeof shipData.invoice === "string"
              ? shipData.invoice
              : ""
          ),
        },
      ]);

      if (shipData.redirect) {
        sessionStorage.setItem("pendingShipment", JSON.stringify(mergedBody));
        window.location.href = `${API_BASE}${shipData.redirect}`;
        return;
      }

      setIsShippingOverlay(false);
      setLoading(false);
      setShowBoxModal(false);
      setShowRateModal(false);
      setBoxCounts(initialBoxCounts());

      const invoiceUrl =
        shipData.invoice && typeof shipData.invoice === "string"
          ? shipData.invoice.trim()
          : "";

      try {
        sessionStorage.setItem("jrco_lastInvoiceUrl", invoiceUrl || "");
        sessionStorage.setItem(
          "jrco_lastSlipUrl",
          Array.isArray(shipData.slips) && shipData.slips[0] ? shipData.slips[0] : ""
        );
      } catch { /* ignore */ }

      openResultsWindows(shipData);
      setTimeout(() => window.focus(), 500);

      setShippingStage("✅ Complete!");
      setTimeout(() => {
        navigate("/shipment-complete", {
          state: {
            shippedOk: true,
            labelsPrinted:
              Array.isArray(shipData.labels) && shipData.labels.length > 0,
            slipsPrinted:
              Array.isArray(shipData.slips) && shipData.slips.length > 0,
            invoiceUrl,
          },
        });
      }, 500);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to ship.");
      setLoading(false);
      setIsShippingOverlay(false);
    }
  };

  const handleBillOnly = async () => {
    if (selected.length === 0) {
      alert("Select at least one job to ship.");
      return;
    }
    await runShipmentCore({
      order_ids: selected,
      boxes: [],
      boxes_summary: [],
      packages: [],
      shipped_quantities: Object.fromEntries(
        jobs
          .filter((j) => selected.includes(j.orderId.toString()))
          .map((j) => [j.orderId, j.shipQty])
      ),
      shipping_method: "Bill only (no UPS)",
      skip_ups: true,
      ups_purchased_rate: 0,
      skip_invoice: false,
      qboEnv: "production",
    });
  };

  // 1) State for live UPS rates
  const [shippingOptions, setShippingOptions] = useState([]);

  // 2) Static fallback package payloads (Customer Supplied = 02)
  const packagesPayload = [
    { PackagingType: "02", Weight: 7,  Dimensions: { Length: 10, Width: 10, Height: 10 } },
    { PackagingType: "02", Weight: 24, Dimensions: { Length: 15, Width: 15, Height: 15 } },
    { PackagingType: "02", Weight: 55, Dimensions: { Length: 20, Width: 20, Height: 20 } },
  ];

  // 3) Static shipper
  const shipper = {
    Name:          "JR & Co.",
    AttentionName: "Justin Eckard",
    Phone:         "678-294-5350",
    Address: {
      AddressLine1:      "1384 Buford Business Blvd",
      AddressLine2:      "Suite 300",
      City:              "Buford",
      StateProvinceCode: "GA",
      PostalCode:        "30518",
      CountryCode:       "US"
    }
  };

  // 4) Simple notifier. If you already have a toast system, use that instead.
  // Copyable error banner
  const [errorInfo, setErrorInfo] = useState(null);

  function notify(message, detail = null) {
    const text = [message, detail]
      .filter(Boolean)
      .map(v => (typeof v === "string" ? v : JSON.stringify(v, null, 2)))
      .join("\n");
    console.error(text);
    setErrorInfo({ text, ts: new Date().toISOString() });
  }

  // (Optional) route any window.alert(...) into the banner too
  useEffect(() => {
    const prev = window.alert;
    window.alert = (m) => notify(String(m || "Alert"));
    return () => { window.alert = prev; };
  }, []);


  // 5) Helper to fetch live UPS rates (with Directory fallback + multi-endpoint retry)
  /**
   * @param {Array<{L:number,W:number,H:number,weight:number}>|null} packagesFlatOverride
   * @param {{companyName:string,contactName:string,phone:string,street1:string,street2:string,city:string,state:string,zip:string,country?:string}|null} shipToOverride
   */
  const fetchRates = async (packagesFlatOverride = null, shipToOverride = null) => {
    if (selected.length === 0) {
      setShippingOptions([]);
      return;
    }

    // Pick one selected job (first one)
    const jobToShip = jobs.find(j => selected.includes(j.orderId.toString()));
    if (!jobToShip) {
      console.warn("No matching job for selected IDs:", selected);
      setShippingOptions([]);
      return;
    }

    // ---- helpers (scoped to this function) ----
    const US_STATE_NAME_TO_ABBR = {
      "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT",
      "delaware":"DE","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA",
      "kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI",
      "minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH",
      "new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
      "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN",
      "texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY",
      "district of columbia":"DC","washington dc":"DC","dc":"DC"
    };
    const toStateAbbr = (v = "") => {
      const s = String(v).trim();
      if (s.length === 2) return s.toUpperCase();
      return US_STATE_NAME_TO_ABBR[s.toLowerCase()] || s.toUpperCase();
    };
    const toZip5 = (v = "") => {
      const m = String(v).match(/(\d{5})/);
      return m ? m[1] : "";
    };
    const get = (obj, key) => (obj && obj[key] != null ? String(obj[key]).trim() : "");

    // Build recipient from a row using your Directory headers
    const buildRecipientFrom = (row) => ({
      Name:          get(row, "Company Name"),
      AttentionName: `${get(row, "Contact First Name")} ${get(row, "Contact Last Name")}`.trim(),
      Phone:         get(row, "Phone Number"),
      Address: {
        AddressLine1:      get(row, "Street Address 1"),
        AddressLine2:      get(row, "Street Address 2"),
        City:              get(row, "City"),
        StateProvinceCode: toStateAbbr(get(row, "State")),
        PostalCode:        toZip5(get(row, "Zip Code")),
        CountryCode:       "US"
      }
    });

    // 1) Try one-time override first, then Production Orders row (may not have address)
    let recipient = shipToOverride
      ? toRecipientFromOneTimeAddress(normalizeOneTimeAddress(shipToOverride))
      : buildRecipientFrom(jobToShip);

    // 2) If missing anything important, fetch from Directory by company name
    const needsDirectory = !recipient.Address.AddressLine1 ||
      !recipient.Address.City ||
      !recipient.Address.StateProvinceCode ||
      recipient.Address.StateProvinceCode.length !== 2 ||
      !recipient.Address.PostalCode ||
      recipient.Address.PostalCode.length !== 5;

    if (needsDirectory && !shipToOverride) {
      const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
      const companyName =
        get(jobToShip, "Company Name") ||
        jobToShip.Company ||
        jobToShip.Customer ||
        "";

      try {
        const dirRes = await fetch(
          `${API_BASE}/api/directory-row?company=${encodeURIComponent(companyName)}`,
          { credentials: "include" }
        );
        if (dirRes.ok) {
          const dirRow = await dirRes.json();
          recipient = buildRecipientFrom(dirRow);
        } else {
          console.warn("Directory fetch failed:", await dirRes.text());
        }
      } catch (e) {
        console.warn("Directory fetch error:", e);
      }
    }

    // 3) Final validation
    const missing = [];
    if (!recipient.Address.AddressLine1) missing.push("street");
    if (!recipient.Address.City) missing.push("city");
    if (!recipient.Address.StateProvinceCode || recipient.Address.StateProvinceCode.length !== 2) missing.push("2-letter state");
    if (!recipient.Address.PostalCode || recipient.Address.PostalCode.length !== 5) missing.push("5-digit ZIP");

    if (missing.length) {
      console.warn("Address still incomplete after Directory lookup", { jobToShip, recipient, missing });
      notify(`Recipient address is incomplete (missing: ${missing.join(", ")}).`);
      setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
      return;
    }

    // 4) Build packages: wizard override, else defaults
    let boxesToUse;
    if (packagesFlatOverride && packagesFlatOverride.length > 0) {
      boxesToUse = packagesFlatOverride.map((p) => ({
        PackagingType: "02",
        Weight: Number(p.weight) || 1,
        Dimensions: {
          Length: Number(p.L) || 10,
          Width: Number(p.W) || 10,
          Height: Number(p.H) || 10,
        },
      }));
    } else {
      boxesToUse = packagesPayload;
    }

    // 5) Optional manual path
    if (SKIP_UPS) {
      setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
      return;
    }

    // 6) Post with a mega-compatible payload; if 400, retry with minimal legacy shape
    const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
    const ratesUrl =
      (process.env.REACT_APP_RATES_URL && process.env.REACT_APP_RATES_URL.trim()) ||
      `${API_BASE}/api/rate`;

    // Ensure non-empty names for both parties
    const fallbackRecipientName =
      (recipient?.Name && String(recipient.Name).trim()) ||
      (jobToShip?.["Company Name"] && String(jobToShip["Company Name"]).trim()) ||
      (jobToShip?.Company && String(jobToShip.Company).trim()) ||
      "Unknown";
    const fallbackShipperName =
      (shipper?.Name && String(shipper.Name).trim()) || "JR & Co.";

    // Extract normalized address values once
    const normParty = (p, fallbackName) => {
      const Name = (p?.Name && String(p.Name).trim()) || fallbackName;
      const AttentionName = p?.AttentionName || "";
      const Phone = p?.Phone || "";
      const A1 = p?.Address?.AddressLine1 || "";
      const A2 = p?.Address?.AddressLine2 || "";
      const City = p?.Address?.City || "";
      const State = p?.Address?.StateProvinceCode || "";
      const Zip = p?.Address?.PostalCode || "";
      const Ctry = p?.Address?.CountryCode || "US";
      return { Name, AttentionName, Phone, A1, A2, City, State, Zip, Ctry };
    };

    const recip = normParty({ ...recipient, Name: fallbackRecipientName }, fallbackRecipientName);
    const shipr = normParty({ ...shipper,   Name: fallbackShipperName   }, fallbackShipperName);

    // Build package variants with every field name the server might want
    const packagesMega = (boxesToUse || []).map((pkg) => {
      const Wt = Number(pkg.Weight) || 1;
      const Lg = Number(pkg.Dimensions?.Length) || 1;
      const Wd = Number(pkg.Dimensions?.Width) || 1;
      const Hg = Number(pkg.Dimensions?.Height) || 1;
      const PackType = pkg.PackagingType || "02";
      return {
        // Canonical UPS-style
        PackagingType: PackType,
        Weight: Wt,
        Dimensions: {
          Length: Lg,
          Width: Wd,
          Height: Hg,
          // single-letter aliases
          L: Lg,
          W: Wd,
          H: Hg,
          Unit: "IN",
        },
        // Flat + camel variants
        packagingType: PackType,
        weight: Wt,
        weightUnit: "LB",
        dimensions: {
          length: Lg,
          width: Wd,
          height: Hg,
          unit: "IN",
          L: Lg,
          W: Wd,
          H: Hg,
        },
        // Top-level variants
        Length: Lg,
        Width: Wd,
        Height: Hg,
        L: Lg,
        W: Wd,
        H: Hg,
        dimUnit: "IN",
      };
    });

    // Party variants: include nested PascalCase, nested camel, and flat legacy keys
    const partyVariants = ({ Name, AttentionName, Phone, A1, A2, City, State, Zip, Ctry }) => ({
      // Nested PascalCase
      Name,
      AttentionName,
      Phone,
      Address: {
        AddressLine1: A1,
        AddressLine2: A2,
        City,
        StateProvinceCode: State,
        PostalCode: Zip,
        CountryCode: Ctry,
      },
      // Nested camel
      name: Name,
      attentionName: AttentionName,
      phone: Phone,
      address: {
        addressLine1: A1,
        addressLine2: A2,
        city: City,
        state: State,
        postalCode: Zip,
        countryCode: Ctry,
      },
      // Flat camel
      addressLine1: A1,
      addressLine2: A2,
      city: City,
      state: State,
      postalCode: Zip,
      countryCode: Ctry,
      // Legacy flat
      attention: AttentionName,
      addr1: A1,
      addr2: A2,
      zip: Zip,
      country: Ctry,
    });

    const recipientAll = partyVariants(recip);
    const shipperAll   = partyVariants(shipr);

    // Mega payload: include multiple shapes simultaneously so backend can pick what it needs
    const megaPayload = {
      shipper:   shipperAll,
      recipient: recipientAll,
      from:      shipperAll,
      to:        recipientAll,
      packages:  packagesMega,
    };

    console.log("🔎 UPS rates POST (mega) →", { url: ratesUrl, payload: megaPayload });

    // Helper to POST and parse
    const postAndParse = async (url, payload) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let body = null;
      try { body = JSON.parse(raw); } catch { /* keep raw string */ }
      return { res, raw, body };
    };

    try {
      // First attempt: mega payload (covers name/addr1/L/W/H/etc.)
      let { res, raw, body } = await postAndParse(ratesUrl, megaPayload);

      // If still a schema complaint, try a minimal legacy-only payload
      if (res.status === 400) {
        const legacyOnly = {
          shipper: {
            name: shipr.Name,
            attention: shipr.AttentionName,
            phone: shipr.Phone,
            addr1: shipr.A1,
            addr2: shipr.A2,
            city: shipr.City,
            state: shipr.State,
            zip:   shipr.Zip,
            country: shipr.Ctry,
          },
          recipient: {
            name: recip.Name,
            attention: recip.AttentionName,
            phone: recip.Phone,
            addr1: recip.A1,
            addr2: recip.A2,
            city: recip.City,
            state: recip.State,
            zip:   recip.Zip,
            country: recip.Ctry,
          },
          packages: (boxesToUse || []).map((pkg) => {
            const Wt = Number(pkg.Weight) || 1;
            const Lg = Number(pkg.Dimensions?.Length) || 1;
            const Wd = Number(pkg.Dimensions?.Width) || 1;
            const Hg = Number(pkg.Dimensions?.Height) || 1;
            return {
              packagingType: pkg.PackagingType || "02",
              weight: Wt,
              length: Lg,
              width: Wd,
              height: Hg,
              L: Lg,
              W: Wd,
              H: Hg,
              dimUnit: "IN",
              weightUnit: "LB",
            };
          }),
        };

        console.warn("⚠️  400 on mega payload — retrying with minimal legacy-only payload");
        ({ res, raw, body } = await postAndParse(ratesUrl, legacyOnly));
      }

      if (!res.ok) {
        const detail = (body && (body.error || body.message || body.detail)) || raw || `HTTP ${res.status}`;
        console.error(`❌ UPS rates failed at ${ratesUrl} [${res.status}]:`, detail);
        notify(`UPS rates error [${res.status}]: ${String(detail).slice(0, 500)}`);
        setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
        return;
      }

      const optionsLocal = Array.isArray(body)
        ? body
        : (body?.options || body?.rates || []);
      console.log("✅ UPS rates response ←", optionsLocal);

      if (!Array.isArray(optionsLocal) || optionsLocal.length === 0) {
        notify("No live UPS rates returned; using manual shipping.");
        setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
        return;
      }

      setShippingOptions(optionsLocal);
      return;
    } catch (err) {
      console.error("UPS rate error:", err);
      notify(`UPS rates error: ${(err && err.message) || String(err)}`);
      setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
      return;
    }
  };

  const bumpBoxCount = (id, delta) => {
    setBoxCounts((c) => {
      const next = { ...c };
      const cur = Math.floor(Number(next[id]) || 0);
      next[id] = Math.max(0, cur + delta);
      return next;
    });
  };

  const setBoxCountDirect = (id, rawVal) => {
    const v = Math.max(0, Math.floor(Number(rawVal) || 0));
    setBoxCounts((c) => ({ ...c, [id]: v }));
  };

  const handleCustomBoxFormChange = (e) => {
    const { name, value } = e.target;
    setCustomBoxForm((prev) => ({ ...prev, [name]: value }));
  };

  const submitCustomBox = () => {
    const L = parseFloat(String(customBoxForm.L).trim());
    const W = parseFloat(String(customBoxForm.W).trim());
    const H = parseFloat(String(customBoxForm.H).trim());
    const weight = parseFloat(String(customBoxForm.weight).trim());
    if (![L, W, H, weight].every((n) => Number.isFinite(n) && n > 0)) {
      alert(
        "Enter positive numbers for length, width, height (inches) and weight (lbs)."
      );
      return;
    }
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setCustomBoxes((prev) => [...prev, { id, L, W, H, weight }]);
    setCustomBoxForm({ L: "", W: "", H: "", weight: "" });
    setShowCustomBoxModal(false);
  };

  const removeCustomBox = (id) => {
    setCustomBoxes((prev) => prev.filter((c) => c.id !== id));
  };

  const normalizeOneTimeAddress = (raw = {}) => {
    const toStateAbbr = (v = "") => {
      const s = String(v || "").trim().toUpperCase();
      return s.slice(0, 2);
    };
    const toZip5 = (v = "") => {
      const m = String(v || "").match(/(\d{5})/);
      return m ? m[1] : "";
    };
    return {
      companyName: String(raw.companyName || "").trim(),
      contactName: String(raw.contactName || "").trim(),
      phone: String(raw.phone || "").trim(),
      street1: String(raw.street1 || "").trim(),
      street2: String(raw.street2 || "").trim(),
      city: String(raw.city || "").trim(),
      state: toStateAbbr(raw.state),
      zip: toZip5(raw.zip),
      country: "US",
    };
  };

  const validateOneTimeAddress = (raw = {}) => {
    const a = normalizeOneTimeAddress(raw);
    if (!a.street1 || !a.city || a.state.length !== 2 || a.zip.length !== 5) {
      return {
        ok: false,
        message: "Please enter a valid one-time address (street, city, 2-letter state, 5-digit ZIP).",
      };
    }
    return { ok: true, value: a };
  };

  const toRecipientFromOneTimeAddress = (addr = {}) => ({
    Name: addr.companyName || "Recipient",
    AttentionName: addr.contactName || "",
    Phone: addr.phone || "",
    Address: {
      AddressLine1: addr.street1 || "",
      AddressLine2: addr.street2 || "",
      City: addr.city || "",
      StateProvinceCode: addr.state || "",
      PostalCode: addr.zip || "",
      CountryCode: "US",
    },
  });

  const beginRatesFlowWithAddressChoice = () => {
    const flat = buildShipmentPackages(boxCounts, customBoxes);
    if (flat.length === 0) {
      alert("Add at least one box.");
      return;
    }
    setShowAddressChoiceModal(true);
  };

  const proceedToRatesWithAddress = async (overrideAddress = null) => {
    const flat = buildShipmentPackages(boxCounts, customBoxes);
    if (flat.length === 0) {
      alert("Add at least one box.");
      return;
    }
    setOneTimeShipAddress(overrideAddress || null);
    setShowAddressChoiceModal(false);
    setShowOneTimeAddressModal(false);
    setShowRateModal(true);
    setRatesLoading(true);
    setShippingOptions([]);
    try {
      await fetchRates(flat, overrideAddress || null);
    } finally {
      setRatesLoading(false);
    }
  };

  const handleOneTimeAddressInputChange = (e) => {
    const { name, value } = e.target;
    setOneTimeAddressForm((prev) => ({ ...prev, [name]: value }));
  };

  /** @param {boolean} createInvoice - false = Ship (UPS, no QBO invoice); true = Ship & bill */
  const openShipBoxModal = (createInvoice) => {
    if (selected.length === 0) {
      alert("Select at least one job to ship.");
      return;
    }
    upsFlowCreateInvoiceRef.current = Boolean(createInvoice);
    setBoxCounts(initialBoxCounts());
    setCustomBoxes([]);
    setShowCustomBoxModal(false);
    setCustomBoxForm({ L: "", W: "", H: "", weight: "" });
    setShippingOptions([]);
    setShowRateModal(false);
    setShowAddressChoiceModal(false);
    setShowOneTimeAddressModal(false);
    setOneTimeShipAddress(null);
    setOneTimeAddressForm({
      companyName: "",
      contactName: "",
      phone: "",
      street1: "",
      street2: "",
      city: "",
      state: "",
      zip: "",
    });
    setShowBoxModal(true);
  };

  const onContinueToRates = async () => {
    beginRatesFlowWithAddressChoice();
  };

  const onShipWithSelectedRate = async (opt) => {
    const flat = buildShipmentPackages(boxCounts, customBoxes);
    if (flat.length === 0) {
      alert("No packages.");
      return;
    }
    const summary = summaryForShipmentApi(
      buildBoxesSummary(boxCounts, customBoxes)
    );
    const skipInv = !upsFlowCreateInvoiceRef.current;
    const shipToOverride = oneTimeShipAddress ? { ...oneTimeShipAddress } : null;
    const isManualRate =
      SKIP_UPS ||
      !opt ||
      opt.method === "Manual Shipping" ||
      opt.rate === "N/A" ||
      !opt.code;

    if (isManualRate) {
      await runShipmentCore({
        order_ids: selected,
        shipped_quantities: Object.fromEntries(
          jobs
            .filter((j) => selected.includes(j.orderId.toString()))
            .map((j) => [j.orderId, j.shipQty])
        ),
        packages: [],
        boxes_summary: summary,
        boxes: summary,
        shipping_method: "Manual Shipping",
        skip_ups: true,
        ups_purchased_rate: 0,
        skip_invoice: skipInv,
        qboEnv: "production",
        ...(shipToOverride ? { ship_to_override: shipToOverride } : {}),
      });
      return;
    }

    const rateNum = parseUpsRateNumber(opt.rate);
    await runShipmentCore({
      order_ids: selected,
      shipped_quantities: Object.fromEntries(
        jobs
          .filter((j) => selected.includes(j.orderId.toString()))
          .map((j) => [j.orderId, j.shipQty])
      ),
      packages: flat,
      boxes_summary: summary,
      boxes: summary,
      service_code: String(opt.code || ""),
      shipping_method: (() => {
        const m = String(opt.method || "").trim();
        if (!m) return "UPS";
        if (/^ups\b/i.test(m)) return m;
        return `UPS ${m}`;
      })(),
      ups_purchased_rate: rateNum,
      skip_ups: false,
      skip_invoice: skipInv,
      qboEnv: "production",
      ...(shipToOverride ? { ship_to_override: shipToOverride } : {}),
    });
  };

  const earliestDueSelected = getEarliestDueDate(selected, jobs);
  const hardSoftSummarySelected = hardSoftSummaryForSelection(selected, jobs);

  const shipModalFooterBtn = {
    minWidth: 88,
    minHeight: 44,
    padding: "0 14px",
    borderRadius: 8,
    border: "1px solid #90a4ae",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
    boxSizing: "border-box",
  };

  return (
    <div style={{ padding: "2rem" }}>
      {/* 🔴 Error banner (copyable) */}
      {errorInfo && (
        <div
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 12,
            background: "#ffe9e9",
            border: "1px solid #d33",
            borderRadius: 8,
            padding: 12,
            zIndex: 10000,
            boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ color: "#900" }}>Error details</strong>
            <div>
              <button
                onClick={() => navigator.clipboard && navigator.clipboard.writeText(errorInfo.text)}
                style={{ marginRight: 8 }}
              >
                Copy
              </button>
              <button onClick={() => setErrorInfo(null)}>Dismiss</button>
            </div>
          </div>
          <textarea
            readOnly
            value={errorInfo.text}
            style={{ width: "100%", height: 140, fontFamily: "monospace", fontSize: 12 }}
          />
        </div>
      )}

      {/* 🌕 Page Overlay for initial loads */}
      {isPageOverlay && (
        <div style={{
          position: "fixed",
          top: 0, left: 0,
          width: "100vw", height: "100vh",
          backgroundColor: "rgba(255, 247, 194, 0.65)", // transparent yellow
          zIndex: 9998,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: "1.25rem",
          fontWeight: "bold"
        }}>
          {pageOverlayText || "Loading…"}
        </div>
      )}

      {/* 🚚 Shipping Overlay */}
      {isShippingOverlay && (
        <div style={{
          position: "fixed",
          top: 0, left: 0,
          width: "100vw", height: "100vh",
          backgroundColor: "rgba(255, 247, 194, 0.85)",
          zIndex: 10010,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: "1.5rem",
          fontWeight: "bold"
        }}>
          {shippingStage || "Processing..."}
        </div>
      )}

      {/* ✅ Success Overlay */}
      <h2>📦 Ship Jobs</h2>
      <input
        list="company-options"
        placeholder="Start typing a company..."
        value={companyInput}
        onChange={handleSelectCompany}
        style={{ fontSize: "1rem", padding: "0.5rem", width: "300px", marginBottom: "1rem" }}
      />
      <datalist id="company-options">
        {allCompanies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.5rem", color: "#374151" }}>
          In production (Embroidery / Sewing)
        </div>
        {productionQueueLoading && productionQueue.length === 0 ? (
          <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>Loading queue…</div>
        ) : productionQueue.length === 0 ? (
          <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>No open jobs in Embroidery or Sewing.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {productionQueue.map((row, idx) => {
              const company = row["Company Name"] || "";
              const oid = row.orderId || row["Order #"] || "";
              const dueStyle = queueCardDueStyle(row["Due Date"]);
              const stageLabel = String(row["Stage"] || "").trim() || "—";
              const onCardActivate = () => openCompanyInShip(company);
              return (
                <div
                  key={`${company}-${oid}-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={onCardActivate}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onCardActivate();
                    }
                  }}
                  style={{
                    borderRadius: 10,
                    padding: 10,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                    ...dueStyle,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        flexShrink: 0,
                        borderRadius: 6,
                        overflow: "hidden",
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "#fff",
                      }}
                    >
                      {row.image ? (
                        <img
                          src={row.image}
                          alt=""
                          loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 10,
                            color: "#9ca3af",
                          }}
                        >
                          No preview
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "0.95rem",
                          lineHeight: 1.25,
                          wordBreak: "break-word",
                        }}
                      >
                        {company}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#4b5563", marginTop: 4 }}>
                        Order #{oid}
                      </div>
                      <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "rgba(0,0,0,0.06)",
                            fontWeight: 600,
                            fontSize: "0.72rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.02em",
                          }}
                        >
                          {stageLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 6,
                      fontSize: "0.78rem",
                      color: "#374151",
                      borderTop: "1px solid rgba(0,0,0,0.06)",
                      paddingTop: 8,
                    }}
                  >
                    <div>
                      <div style={{ color: "#9ca3af", fontWeight: 600 }}>Due</div>
                      <div style={{ fontWeight: 600 }}>{formatDateMMDD(row["Due Date"]) || "—"}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "#9ca3af", fontWeight: 600 }}>Design</div>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row["Design"]}>
                        {row["Design"] || "—"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {jobs.length > 0 && (
        <button
          onClick={handleSelectAll}
          style={{
            fontSize: "1rem",
            padding: "0.5rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#4CAF50",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          Select All
        </button>
      )}

      {jobs.length > 0 && (
        <div style={{ display: "flex", fontWeight: "bold", padding: "0.5rem 1rem", borderBottom: "2px solid #333", marginBottom: "0.5rem", marginTop: "1rem", fontSize: "0.85rem" }}>
          <div style={{ width: 60 }}></div>
          <div style={{ width: 60, textAlign: "center" }}>#</div>
          <div style={{ width: 80, textAlign: "center" }}>Date</div>
          <div style={{ width: 200, textAlign: "center" }}>Design</div>
          <div style={{ width: 70, textAlign: "center" }}>Qty</div>
          <div style={{ width: 120, textAlign: "center" }}>Product</div>
          <div style={{ width: 120, textAlign: "center" }}>Stage</div>
          <div style={{ width: 80, textAlign: "center" }}>Price</div>
          <div style={{ width: 128, textAlign: "center" }}>Due / H·S</div>
        </div>
      )}

      {jobs.map((job) => (
        <div
          key={job.orderId}
          ref={el => { if (el) jobRefs.current[job.orderId] = el; }}
          onClick={() => toggleSelect(job.orderId)}
          style={{
            display: "flex",
            alignItems: "center",
            border: "1px solid #ccc",
            padding: "0.5rem 1rem",
            marginBottom: "0.3rem",
            borderRadius: "6px",
            backgroundColor: selected.includes(job.orderId.toString()) ? "#4CAF50" : "#fff",
            color: selected.includes(job.orderId.toString()) ? "#fff" : "#000",
            cursor: "pointer"
          }}
        >
          <div style={{ width: 60 }}>{job.image && <img loading="lazy" src={job.image} alt="Preview" style={{ width: "50px", height: "50px", objectFit: "cover", borderRadius: "4px", border: "1px solid #999" }} />}</div>
          <div style={{ width: 60, textAlign: "center" }}>{job.orderId}</div>
          <div style={{ width: 80, textAlign: "center" }}>{formatDateMMDD(job["Date"])}</div>
          <div style={{ width: 200, textAlign: "center" }}>{job["Design"]}</div>
          <div style={{ width: 70, textAlign: "center" }}>
            <input
              type="number"
              value={job.shipQty ?? job["Quantity"] ?? 0}
              min="1"
              style={{ width: "50px" }}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                setJobs((prev) =>
                  prev.map((j) =>
                    j.orderId === job.orderId ? { ...j, shipQty: value } : j
                  )
                );
              }}
            />
          </div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Product"]}</div>
          <div style={{ width: 120, textAlign: "center" }}>{job["Stage"]}</div>
          <div style={{ width: 80, textAlign: "center" }}>${job["Price"]}</div>
          <div style={{ width: 128, textAlign: "center", fontSize: "0.8rem", lineHeight: 1.25 }}>
            <div>{formatDateMMDD(job["Due Date"])}</div>
            <div style={{ fontSize: "0.72rem", opacity: 0.92 }}>
              {formatHardSoftType(job["Hard Date/Soft Date"] ?? job["Hard/Soft"]) || "—"}
            </div>
          </div>
        </div>
      ))}

      {selected.length > 0 && (
        <div style={{ marginTop: "2rem", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          {/** Icon-only actions; title/aria-label describe behavior. */}
          <button
            type="button"
            onClick={() => openShipBoxModal(false)}
            disabled={isShippingOverlay || loading}
            aria-label="Ship with UPS: labels and packing slip, no QuickBooks invoice"
            title="Ship with UPS: labels and packing slip, no QuickBooks invoice"
            style={{
              width: 112,
              height: 112,
              borderRadius: 14,
              border: "2px solid #1565c0",
              background: "linear-gradient(180deg, #fafafa 0%, #eceff1 100%)",
              boxShadow: "0 4px 14px rgba(21,101,192,0.2)",
              cursor: (isShippingOverlay || loading) ? "not-allowed" : "pointer",
              opacity: (isShippingOverlay || loading) ? 0.55 : 1,
              padding: 8,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={SHIP_ICON_SHIP_ONLY}
              alt=""
              draggable={false}
              style={{ width: 88, height: 88, objectFit: "contain", pointerEvents: "none", userSelect: "none" }}
            />
          </button>
          <button
            type="button"
            onClick={() => openShipBoxModal(true)}
            disabled={isShippingOverlay || loading}
            aria-label="Ship with UPS and bill in QuickBooks"
            title="Ship with UPS and bill in QuickBooks"
            style={{
              width: 112,
              height: 112,
              borderRadius: 14,
              border: "2px solid #2e7d32",
              background: "linear-gradient(180deg, #fafafa 0%, #e8f5e9 100%)",
              boxShadow: "0 4px 14px rgba(46,125,50,0.22)",
              cursor: (isShippingOverlay || loading) ? "not-allowed" : "pointer",
              opacity: (isShippingOverlay || loading) ? 0.55 : 1,
              padding: 8,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={SHIP_ICON_SHIP_AND_BILL}
              alt=""
              draggable={false}
              style={{ width: 88, height: 88, objectFit: "contain", pointerEvents: "none", userSelect: "none" }}
            />
          </button>
          <button
            type="button"
            onClick={handleBillOnly}
            disabled={isShippingOverlay || loading}
            aria-label="Bill only in QuickBooks: invoice and packing slip, no UPS"
            title="Bill only in QuickBooks: invoice and packing slip, no UPS"
            style={{
              width: 112,
              height: 112,
              borderRadius: 14,
              border: "2px solid #78909c",
              background: "linear-gradient(180deg, #fff 0%, #eceff1 100%)",
              boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
              cursor: (isShippingOverlay || loading) ? "not-allowed" : "pointer",
              opacity: (isShippingOverlay || loading) ? 0.55 : 1,
              padding: 8,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={SHIP_ICON_BILL_ONLY}
              alt=""
              draggable={false}
              style={{ width: 88, height: 88, objectFit: "contain", pointerEvents: "none", userSelect: "none" }}
            />
          </button>
        </div>
      )}

      {showBoxModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px",
            boxSizing: "border-box",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ship-box-modal-title"
        >
          <div
            style={{
              background: "#fafafa",
              borderRadius: 14,
              width: "min(540px, 100%)",
              maxHeight: "min(92vh, 640px)",
              padding: "14px 16px 12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxSizing: "border-box",
              border: "1px solid #e0e0e0",
            }}
          >
            <h3 id="ship-box-modal-title" style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1a237e" }}>
              Select boxes
            </h3>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#1565c0" }}>
              Tap a square to add one · adjust qty below · due {earliestDueSelected ? formatDateMMDD(earliestDueSelected) : "—"}
              {hardSoftSummarySelected ? (
                <> · <strong>{hardSoftSummarySelected}</strong></>
              ) : null}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
                gap: 8,
                width: "100%",
              }}
            >
              {SHIP_BOX_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => bumpBoxCount(p.id, 1)}
                  style={{
                    aspectRatio: "1",
                    width: "100%",
                    margin: 0,
                    borderRadius: 10,
                    border: "2px solid #b0bec5",
                    background: "linear-gradient(180deg, #fff 0%, #eceff1 100%)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 4,
                    boxSizing: "border-box",
                    boxShadow: "inset 0 1px 0 #fff",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#263238", lineHeight: 1.1, textAlign: "center" }}>
                    {p.L}×{p.W}×{p.H}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#546e7a", marginTop: 4 }}>
                    {p.weight} lb
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustomBoxModal(true)}
                style={{
                  aspectRatio: "1",
                  width: "100%",
                  margin: 0,
                  borderRadius: 10,
                  border: "2px solid #1565c0",
                  background: "linear-gradient(180deg, #e3f2fd 0%, #bbdefb 100%)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 4,
                  boxSizing: "border-box",
                  boxShadow: "inset 0 1px 0 #fff",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: "#0d47a1", lineHeight: 1.1, textAlign: "center" }}>
                  Custom
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#1565c0", marginTop: 4 }}>
                  L × W × H
                </span>
              </button>
            </div>
            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: "1px solid #cfd8dc",
                flexShrink: 0,
                maxHeight: "22vh",
                overflow: "hidden",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#455a64", marginBottom: 6 }}>Summary</div>
              {!hasAnyBoxesSelected(boxCounts, customBoxes) ? (
                <div style={{ fontSize: 12, color: "#78909c" }}>None selected</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {SHIP_BOX_PRESETS.filter((x) => (boxCounts[x.id] || 0) > 0).map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#37474f" }}>
                        {p.L}×{p.W}×{p.H} <span style={{ color: "#78909c", fontWeight: 500 }}>× {boxCounts[p.id] || 0}</span>
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                          type="button"
                          aria-label="decrease"
                          onClick={() => bumpBoxCount(p.id, -1)}
                          style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #90a4ae", background: "#fff", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={0}
                          value={boxCounts[p.id] ?? 0}
                          onChange={(e) => setBoxCountDirect(p.id, e.target.value)}
                          style={{ width: 40, height: 36, textAlign: "center", borderRadius: 8, border: "1px solid #90a4ae", fontSize: 13 }}
                        />
                        <button
                          type="button"
                          aria-label="increase"
                          onClick={() => bumpBoxCount(p.id, 1)}
                          style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #90a4ae", background: "#fff", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                  {customBoxes.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#37474f" }}>
                        {c.L}×{c.W}×{c.H}{" "}
                        <span style={{ color: "#78909c", fontWeight: 500 }}>({c.weight} lb) × 1</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCustomBox(c.id)}
                        style={{
                          ...shipModalFooterBtn,
                          minWidth: 72,
                          fontSize: 12,
                          color: "#c62828",
                          borderColor: "#e57373",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flexShrink: 0 }}>
              <button type="button" onClick={() => setShowBoxModal(false)} style={shipModalFooterBtn}>Cancel</button>
              <button
                type="button"
                onClick={onContinueToRates}
                style={{
                  ...shipModalFooterBtn,
                  background: "#1565c0",
                  color: "#fff",
                  borderColor: "#0d47a1",
                }}
              >
                Rates →
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomBoxModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 10002,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
            boxSizing: "border-box",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ship-custom-box-title"
        >
          <div
            style={{
              background: "#fafafa",
              borderRadius: 14,
              width: "min(400px, 100%)",
              padding: "16px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              border: "1px solid #e0e0e0",
              boxSizing: "border-box",
            }}
          >
            <h3 id="ship-custom-box-title" style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#1a237e" }}>
              Custom box
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#546e7a" }}>
              Enter inside dimensions (inches) and total package weight (lbs).
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#37474f" }}>
                Length (in)
                <input
                  name="L"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={customBoxForm.L}
                  onChange={handleCustomBoxFormChange}
                  style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#37474f" }}>
                Width (in)
                <input
                  name="W"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={customBoxForm.W}
                  onChange={handleCustomBoxFormChange}
                  style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#37474f" }}>
                Height (in)
                <input
                  name="H"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={customBoxForm.H}
                  onChange={handleCustomBoxFormChange}
                  style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#37474f" }}>
                Weight (lb)
                <input
                  name="weight"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={customBoxForm.weight}
                  onChange={handleCustomBoxFormChange}
                  style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5", fontSize: 14 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => {
                  setShowCustomBoxModal(false);
                  setCustomBoxForm({ L: "", W: "", H: "", weight: "" });
                }}
                style={shipModalFooterBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCustomBox}
                style={{
                  ...shipModalFooterBtn,
                  background: "#1565c0",
                  color: "#fff",
                  borderColor: "#0d47a1",
                }}
              >
                Add box
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddressChoiceModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 10003,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px",
            boxSizing: "border-box",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ship-address-choice-title"
        >
          <div
            style={{
              background: "#fafafa",
              borderRadius: 14,
              width: "min(520px, 100%)",
              padding: "16px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              border: "1px solid #e0e0e0",
            }}
          >
            <h3 id="ship-address-choice-title" style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#1a237e" }}>
              Ship to a different address?
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 14, color: "#37474f", lineHeight: 1.4 }}>
              Use your default address from Directory, or enter a one-time shipping address for this shipment only.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setShowAddressChoiceModal(false);
                  setShowOneTimeAddressModal(false);
                }}
                style={shipModalFooterBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => proceedToRatesWithAddress(null)}
                style={shipModalFooterBtn}
              >
                No, use default
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddressChoiceModal(false);
                  setShowOneTimeAddressModal(true);
                }}
                style={{
                  ...shipModalFooterBtn,
                  background: "#1565c0",
                  color: "#fff",
                  borderColor: "#0d47a1",
                }}
              >
                Yes, different address
              </button>
            </div>
          </div>
        </div>
      )}

      {showOneTimeAddressModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 10004,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px",
            boxSizing: "border-box",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ship-one-time-address-title"
        >
          <div
            style={{
              background: "#fafafa",
              borderRadius: 14,
              width: "min(620px, 100%)",
              maxHeight: "min(92vh, 740px)",
              padding: "14px 16px 12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              border: "1px solid #e0e0e0",
              overflow: "auto",
            }}
          >
            <h3 id="ship-one-time-address-title" style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "#1a237e" }}>
              One-time shipping address
            </h3>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#546e7a" }}>
              This address is used for this shipment only and is not saved.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <input name="companyName" value={oneTimeAddressForm.companyName} onChange={handleOneTimeAddressInputChange} placeholder="Company Name (optional)" style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5" }} />
              <input name="contactName" value={oneTimeAddressForm.contactName} onChange={handleOneTimeAddressInputChange} placeholder="Contact Name (optional)" style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5" }} />
              <input name="phone" value={oneTimeAddressForm.phone} onChange={handleOneTimeAddressInputChange} placeholder="Phone (optional)" style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5" }} />
              <div />
              <input name="street1" value={oneTimeAddressForm.street1} onChange={handleOneTimeAddressInputChange} placeholder="Street Address 1 *" style={{ gridColumn: "1 / span 2", padding: "8px", borderRadius: 8, border: "1px solid #b0bec5" }} />
              <input name="street2" value={oneTimeAddressForm.street2} onChange={handleOneTimeAddressInputChange} placeholder="Street Address 2" style={{ gridColumn: "1 / span 2", padding: "8px", borderRadius: 8, border: "1px solid #b0bec5" }} />
              <input name="city" value={oneTimeAddressForm.city} onChange={handleOneTimeAddressInputChange} placeholder="City *" style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5" }} />
              <input name="state" value={oneTimeAddressForm.state} onChange={handleOneTimeAddressInputChange} placeholder="State (2-letter) *" maxLength={2} style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5", textTransform: "uppercase" }} />
              <input name="zip" value={oneTimeAddressForm.zip} onChange={handleOneTimeAddressInputChange} placeholder="ZIP (5-digit) *" style={{ padding: "8px", borderRadius: 8, border: "1px solid #b0bec5" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setShowOneTimeAddressModal(false);
                  setShowAddressChoiceModal(true);
                }}
                style={shipModalFooterBtn}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  const checked = validateOneTimeAddress(oneTimeAddressForm);
                  if (!checked.ok) {
                    alert(checked.message);
                    return;
                  }
                  proceedToRatesWithAddress(checked.value);
                }}
                style={{
                  ...shipModalFooterBtn,
                  background: "#1565c0",
                  color: "#fff",
                  borderColor: "#0d47a1",
                }}
              >
                Continue to rates
              </button>
            </div>
          </div>
        </div>
      )}

      {showRateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 10002,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px",
            boxSizing: "border-box",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ship-rate-modal-title"
        >
          <div
            style={{
              background: "#fafafa",
              borderRadius: 14,
              width: "min(720px, 100%)",
              maxHeight: "min(92vh, 720px)",
              padding: "14px 16px 12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxSizing: "border-box",
              border: "1px solid #e0e0e0",
            }}
          >
            <h3 id="ship-rate-modal-title" style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1a237e" }}>
              Choose UPS rate
            </h3>
            <p style={{ margin: "0 0 8px", fontSize: 11, color: "#374151", lineHeight: 1.4 }}>
              <span
                title="Early vs due"
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "rgba(46, 204, 113, 0.16)",
                  border: "2px solid #2ecc71",
                  marginRight: 6,
                }}
              >
                early
              </span>
              <span
                title="On due date"
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "rgba(243, 156, 18, 0.2)",
                  border: "2px solid #f39c12",
                  margin: "0 6px",
                }}
              >
                on-time
              </span>
              <span
                title="After due"
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "rgba(231, 76, 60, 0.22)",
                  border: "2px solid #e74c3c",
                }}
              >
                late
              </span>
              {" · "}Due <strong>{earliestDueSelected ? formatDateMMDD(earliestDueSelected) : "—"}</strong>
              {hardSoftSummarySelected ? (
                <> · <strong>{hardSoftSummarySelected}</strong></>
              ) : null}
            </p>
            {ratesLoading && (
              <div style={{ padding: 24, textAlign: "center", color: "#546e7a", fontWeight: 600 }}>Loading rates…</div>
            )}
            {!ratesLoading && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 8,
                  flex: "1 1 auto",
                  minHeight: 0,
                  overflow: "hidden",
                  alignContent: "start",
                }}
              >
                {shippingOptions.map((opt, i) => {
                  const eta = estimatedDeliveryDate(opt);
                  const tileUrgency = rateTileDueStyle(eta, earliestDueSelected);
                  const priceStr =
                    typeof opt.rate === "number"
                      ? `$${opt.rate.toFixed(2)}`
                      : opt.rate;
                  return (
                    <button
                      key={`${opt.code || "x"}-${i}`}
                      type="button"
                      onClick={() => onShipWithSelectedRate(opt)}
                      disabled={isShippingOverlay || loading}
                      style={{
                        aspectRatio: "1",
                        width: "100%",
                        minHeight: 0,
                        margin: 0,
                        borderRadius: 12,
                        ...tileUrgency,
                        cursor: isShippingOverlay || loading ? "not-allowed" : "pointer",
                        opacity: isShippingOverlay || loading ? 0.55 : 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 6,
                        boxSizing: "border-box",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                        textAlign: "center",
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#212121", lineHeight: 1.15, display: "block" }}>
                        {(opt.method || "Rate").replace(/ UPS$/i, "").slice(0, 22)}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "#0d47a1", marginTop: 6 }}>{priceStr}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#37474f", marginTop: 6, lineHeight: 1.2 }}>
                        {eta ? (
                          <>
                            Est. delivery
                            <br />
                            {formatArrivalLabel(eta)}
                          </>
                        ) : (
                          <>
                            {opt.delivery || "—"}
                            <br />
                            <span style={{ color: "#78909c" }}>Tap to ship</span>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => {
                  setShowRateModal(false);
                  setShowBoxModal(true);
                }}
                style={shipModalFooterBtn}
              >
                ← Boxes
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRateModal(false);
                  setShowBoxModal(false);
                }}
                style={shipModalFooterBtn}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <LoginModal
        open={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLogin={() => {
          // send them to backend login, then come back to this page
          window.location.href = `${API_BASE}/login?next=${encodeURIComponent(window.location.href)}`;
        }}
      />
    </div>
  );
}

