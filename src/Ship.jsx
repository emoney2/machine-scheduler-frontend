import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";

// Map our logical box names to their actual dimensions
const BOX_DIMENSIONS = {
  Small:  "10×10×10",
  Medium: "15×15×15",
  Large:  "20×20×20"
};

function parseDateFromString(dateStr) {
  if (!dateStr) return null;

  const parts = dateStr.includes("-")
    ? dateStr.split("-")
    : dateStr.includes("/")
    ? dateStr.split("/")
    : [];

  if (parts.length === 2) {
    // Format is MM/DD or M/D (assume current year)
    const [mm, dd] = parts;
    const now = new Date();
    return new Date(now.getFullYear(), parseInt(mm) - 1, parseInt(dd));
  }

  if (parts.length === 3) {
    let [year, month, day] = parts;
    if (parts[0].length <= 2 && parts[2].length === 4) {
      [month, day, year] = parts;
    }
    return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  }

  return null;
}

function formatDateMMDD(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.includes("-")
    ? dateStr.split("-")
    : dateStr.includes("/")
    ? dateStr.split("/")
    : [];

  if (parts.length !== 3) return dateStr;

  const [a, b, c] = parts.map(p => parseInt(p));
  if (dateStr.includes("-")) {
    return `${b.toString().padStart(2, "0")}/${c.toString().padStart(2, "0")}`;
  } else {
    return `${a.toString().padStart(2, "0")}/${b.toString().padStart(2, "0")}`;
  }
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
    .map(j => new Date(j.due))
    .filter(d => !isNaN(d));
  return dueDates.length > 0 ? new Date(Math.min(...dueDates.map(d => d.getTime()))) : null;
}

export default function Ship() {
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
  const [boxes, setBoxes] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [projectedBoxes, setProjectedBoxes] = useState([]);

  const query = new URLSearchParams(window.location.search);
  const defaultCompany = query.get("company");

  const [isShippingOverlay, setIsShippingOverlay] = useState(false);
  const [shippingStage, setShippingStage] = useState(""); // dynamic overlay message
  const navigate = useNavigate();

  // === useEffect 1: Initial load ===
  useEffect(() => {
    async function loadJobsForCompany(company) {
      try {
        const res = await fetch(
          `https://machine-scheduler-backend.onrender.com/api/jobs-for-company?company=${encodeURIComponent(company)}`,
          { credentials: "include" }
        );
        const data = await res.json();

        if (res.ok) {
          // 1) Build job array and initialize shipQty from the sheet quantity
          const updatedJobs = data.jobs.map((job) => {
            // Pull from the sheet’s "Quantity" column (capital Q)
            const qty = Number(job.Quantity ?? job.quantity ?? 0);
            return {
              ...job,
              shipQty: qty,
              ShippedQty: qty,
            };
          });

          // 2) Push into state
          setJobs(updatedJobs);

          // 3) Drop any selected IDs that no longer exist
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

  // === useEffect 2: Live update polling ===
  useEffect(() => {
    if (!companyInput || !allCompanies.includes(companyInput)) return;

    const interval = setInterval(() => {
      fetch(
        `https://machine-scheduler-backend.onrender.com/api/jobs-for-company?company=${encodeURIComponent(companyInput)}`,
        { credentials: "include" }
      )
        .then(res => res.json())
        .then(data => {
          if (data.jobs) {
            setJobs(prev => {
              const prevMap = Object.fromEntries(prev.map(j => [j.orderId, j]));
              return data.jobs.map(newJob => {
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
              const newOrderIds = new Set(data.jobs.map(j => j.orderId.toString()));
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
      if (pending) {
        console.log("🔁 Resuming pending shipment...");
        sessionStorage.removeItem("pendingShipment");
        const parsed = JSON.parse(pending);

        const res = await fetch(
          "https://machine-scheduler-backend.onrender.com/api/process-shipment",  // updated URL
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(parsed),
          }
        );
        const data = await res.json();
        if (res.ok) {
          const mainWindow = window;
          // open shipping labels
          data.labels.forEach((url) => {
            const win = window.open(url, "_blank");
            win && win.blur();
          });

          // build and open the full invoice URL
          const invoiceUrl = data.invoice
            ? (data.invoice.startsWith("http")
                ? data.invoice
                : `https://app.qbo.intuit.com/app/invoice?txnId=${shipData.invoice}`)
            : null;
          if (invoiceUrl) {
            const invWin = window.open(invoiceUrl, "_blank");
            invWin && invWin.blur();
          }

          // open packing slips
          data.slips.forEach((url) => {
            const win = window.open(url, "_blank");
            win && win.blur();
          });

          // refocus this tab after a brief pause
          setTimeout(() => {
            mainWindow.focus();
          }, 500);

          // 📌 bring the main Ship tab back into view a moment later
          setTimeout(() => {
            const mainTab = window.open("", "mainShipTab");
            if (mainTab && mainTab.focus) mainTab.focus();
          }, 500);

          navigate("/shipment-complete", {
            state: {
              shippedOk:      true,
              labelsPrinted:  data.labels.length > 0,
              slipsSaved:     boxes.length > 0,
              invoiceUrl
            },
          });

        } else {
          alert(data.error || "Shipment failed.");
        }
      }
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

  // ▶︎ Whenever selection changes, re-fetch box requirements
  useEffect(() => {
    async function previewBoxes() {
      if (selected.length === 0) {
        setProjectedBoxes([]);
        return;
      }
      const res = await fetch(
        `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/api/prepare-shipment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            order_ids: selected.filter(id => {
              const name = jobs.find(j => j.orderId.toString()===id)?.Product||"";
              return !/\s+Back$/i.test(name.trim());
            }),
            shipped_quantities: Object.fromEntries(
              jobs
                .filter((j) =>
                  selected.includes(j.orderId.toString()) &&
                  !/\s+Back$/i.test(j.Product.trim())
                )
                .map((j) => [j.orderId, j.shipQty])
            ),
          }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        setProjectedBoxes(data.boxes || []);
      }
    }
    previewBoxes();
  }, [selected]);

  async function fetchCompanyNames() {
    try {
      const res = await fetch(
        "https://machine-scheduler-backend.onrender.com/api/company-list",
        { credentials: "include" }
      );
      const data = await res.json();
      setAllCompanies(data.companies || []);
    } catch (err) {
      console.error("Company fetch failed", err);
    }
  }

  async function fetchJobs(company) {
    try {
      const res = await fetch(
        `https://machine-scheduler-backend.onrender.com/api/jobs-for-company?company=${encodeURIComponent(company)}`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (res.ok) {
        // Initialize shipQty from the sheet's "Quantity" column
        const jobsWithQty = data.jobs.map(job => {
          const qty = Number(job.Quantity ?? 0);
          return { ...job, shipQty: qty, ShippedQty: qty };
        });
        setJobs(jobsWithQty);
        // Also clean up your selected list in case jobs changed
        setSelected(prev =>
          prev.filter(id => jobsWithQty.some(j => j.orderId.toString() === id))
        );
      } else {
        alert(data.error || "Failed to load jobs");
      }
    } catch (err) {
      console.error("Error loading jobs:", err);
      alert("Error loading jobs.");
    }
  }

  const handleSelectCompany = (e) => {
    const value = e.target.value;
    setCompanyInput(value);
    if (allCompanies.includes(value)) {
      fetchJobs(value);
    }
  };

  const toggleSelect = (orderId) => {
    const idStr = orderId.toString();
    setSelected((prev) =>
      prev.includes(idStr)
        ? prev.filter((id) => id !== idStr)
        : [...prev, idStr]
    );
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
            "https://machine-scheduler-backend.onrender.com/api/set-volume",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ product, length, width, height }),
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

  const handleShip = async () => {
    if (selected.length === 0) {
      alert("Select at least one job to ship.");
      return;
    }

    // ── PRE-OPEN POPUPS ──────────────────────────────────
    const labelWindows = selected.map((_, i) =>
      window.open("", `labelWindow${i}`, "width=600,height=400")
    );

    setIsShippingOverlay(true);
    setShippingStage("📦 Preparing shipment...");
    setLoading(true);

    try {
      // ── PREPARE ─────────────────────────────────────────
      let result;
      // Use a consistent base (handles whether REACT_APP_API_ROOT ends with /api)
      const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");

      try {
        const response = await fetch(
          `${API_BASE}/api/prepare-shipment`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              order_ids: selected,
              shipped_quantities: Object.fromEntries(
                jobs
                  .filter((j) => selected.includes(j.orderId.toString()))
                  .map((j) => [j.orderId, j.shipQty])
              ),
            }),
          }
        );
        const data = await response.json();
        if (!response.ok) {
          console.warn("prepare-shipment error:", data.error);
          result = { boxes: [] };
        } else {
          result = data;
        }
      } catch (prepErr) {
        console.error("prepare-shipment failed:", prepErr);
        result = { boxes: [] };
      }

      // pack boxes
      const packedBoxes = result.boxes || [];
      setShippingStage("📦 Packing boxes...");
      setBoxes(packedBoxes);

      // ── PROCESS ─────────────────────────────────────────
      setShippingStage("🚚 Processing shipment...");
      let shipData;
      try {
        const shipRes = await fetch(
          `${API_BASE}/api/process-shipment`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              order_ids:          selected,
              boxes:              packedBoxes,
              shipped_quantities: Object.fromEntries(
                jobs
                  .filter((j) => selected.includes(j.orderId.toString()))
                  .map((j) => [j.orderId, j.shipQty])
              ),
              shipping_method:    shippingMethod,
              service_code:       (shippingSelection && shippingSelection.code) || null,
              qboEnv: "production",
            }),
          }
        );
        const data = await shipRes.json();
        if (!shipRes.ok) {
          console.warn("process-shipment error:", data.error);
          shipData = { labels: [], slips: [], invoice: null, redirect: data.redirect };
        } else {
          shipData = data;
        }
      } catch (procErr) {
        console.error("process-shipment failed:", procErr);
        shipData = { labels: [], slips: [], invoice: null };
      }

      // ── HANDLE QBO REDIRECT ──────────────────────────────
      if (shipData.redirect) {
        sessionStorage.setItem(
          "pendingShipment",
          JSON.stringify({
            order_ids:         selected,
            boxes:             packedBoxes,
            shipped_quantities: Object.fromEntries(
              jobs
                .filter((j) => selected.includes(j.orderId.toString()))
                .map((j) => [j.orderId, j.shipQty])
            ),
            shipping_method:   shippingMethod,
            qboEnv:            "production",
          })
        );
        window.location.href = `${process.env.REACT_APP_API_ROOT.replace(
          /\/api$/,
          ""
        )}${shipData.redirect}`;
        return;
      }

      // ── SUCCESS ─────────────────────────────────────────
      setIsShippingOverlay(false);
      setLoading(false);

      // build invoiceUrl but do NOT open it here
      const invoiceUrl = shipData.invoice
        ? shipData.invoice.startsWith("http")
          ? shipData.invoice
          : `https://app.sandbox.qbo.intuit.com/app/invoice?txnId=${shipData.invoice}`
        : "";

      // 4a) Shipping labels
      setShippingStage(
        `🖨️ Printing ${shipData.labels.length} shipping label${shipData.labels.length > 1 ? "s" : ""}…`
      );
      shipData.labels.forEach((url, i) => {
        const win = labelWindows[i];
        if (win) {
          win.location = url;
          win.blur();
        }
      });

      // 4b) QuickBooks customer/item setup
      setShippingStage("👤 Setting up QuickBooks customer…");
      setShippingStage("📦 Setting up QuickBooks product info…");

      // 4c) Packing slip saved
      setShippingStage(
        `📋 Packing slip PDF saved for ${packedBoxes.length} box${packedBoxes.length > 1 ? "es" : ""} (watching folder for print)…`
      );

      // 4d) refocus main tab immediately
      setTimeout(() => {
        const mainTab = window.open("", "mainShipTab");
        if (mainTab && mainTab.focus) mainTab.focus();
      }, 100);

      // 4e) Finalize
      setShippingStage("✅ Complete!");
      setTimeout(() => {
        navigate("/shipment-complete", {
          state: {
            shippedOk:     true,
            labelsPrinted: shipData.labels.length > 0,
            slipsPrinted:  packedBoxes.length > 0,
            invoiceUrl
          },
        });
      }, 500);
    } catch (err) {
      console.error(err);
      alert("Failed to ship.");
      setLoading(false);
      setIsShippingOverlay(false);
    }
  }; // end handleShip

  // ─── 0) Feature flag at top ───
  const SKIP_UPS = false;

  // 1) State for live UPS rates
  const [shippingOptions, setShippingOptions] = useState([]);
  // Store the user’s chosen UPS option (includes .code)
  const [shippingSelection, setShippingSelection] = useState(null);

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
      AddressLine1:      "3653 Lost Oak Drive",
      AddressLine2:      "",
      City:              "Buford",
      StateProvinceCode: "GA",
      PostalCode:        "30519",
      CountryCode:       "US"
    }
  };

  // 4) Simple notifier. If you already have a toast system, use that instead.
  function notify(msg) {
    alert(msg);
  }

  // 5) Helper to fetch live UPS rates (with safety checks + fallback)
  const fetchRates = async () => {
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

    // --- helpers: normalize state + zip, and pick from multiple key spellings ---
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
    function toStateAbbr(v = "") {
      const s = String(v).trim();
      if (s.length === 2) return s.toUpperCase();
      const ab = US_STATE_NAME_TO_ABBR[s.toLowerCase()];
      return ab ? ab : s.toUpperCase(); // fallback unchanged
    }
    function toZip5(v = "") {
      const m = String(v).match(/(\d{5})/);
      return m ? m[1] : "";
    }
    // pick first non-empty value by trying several sheet column spellings
    function pick(obj, keys) {
      for (const k of keys) {
        const val = obj?.[k];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          return String(val).trim();
        }
      }
      return "";
    }

    // ---- build recipient with robust key mapping & normalization ----
    // NOTE: exact headers you shared are listed first, with sane fallbacks after.
    const recipient = {
      Name: pick(jobToShip, ["Company Name", "Company", "Customer", "Client"]),
      AttentionName: `${pick(jobToShip, [
        "Contact First Name",
        "First Name",
        "Contact First",
      ])} ${pick(jobToShip, [
        "Contact Last Name",
        "Contact Last",
        "Last Name",
      ])}`.trim(),
      Phone: pick(jobToShip, ["Phone Number", "Phone", "Tel", "Telephone"]),
      Address: {
        AddressLine1: pick(jobToShip, [
          "Street Address 1",
          "Address 1",
          "Street 1",
          "Addr1",
          "Address",
          "Street",
        ]),
        AddressLine2: pick(jobToShip, ["Street Address 2", "Address 2", "Street 2", "Addr2", "Suite", "Apt"]),
        City: pick(jobToShip, ["City", "Town"]),
        StateProvinceCode: toStateAbbr(
          pick(jobToShip, ["State", "State/Province", "Province", "Region"])
        ),
        PostalCode: toZip5(
          pick(jobToShip, ["Zip Code", "ZIP", "Zip", "Postal Code", "Postcode"])
        ),
        CountryCode: "US",
      },
    };

    // ---- validation that tells you exactly what's missing ----
    const missing = [];
    if (!recipient.Address.AddressLine1) missing.push("street");
    if (!recipient.Address.City) missing.push("city");
    if (!recipient.Address.StateProvinceCode || recipient.Address.StateProvinceCode.length !== 2) missing.push("2-letter state");
    if (!recipient.Address.PostalCode || recipient.Address.PostalCode.length !== 5) missing.push("5-digit ZIP");

    if (missing.length) {
      console.warn("Job record missing fields →", { jobToShip, recipient, missing });
      notify(`Recipient address is incomplete (missing: ${missing.join(", ")}).`);
      setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
      return;
    }

    // Build packages from projectedBoxes if available
    const boxesToUse =
      projectedBoxes && projectedBoxes.length > 0
        ? projectedBoxes.map((b) => {
            const dimStr = BOX_DIMENSIONS[b.size] || "10×10×10";
            const [L, W, H] = dimStr.split(/[x×]/i).map((n) => parseInt(n, 10) || 10);
            const weight = Math.max(1, Math.ceil((L * W * H) / 1728)); // rough 1lb per cubic ft
            return {
              PackagingType: "02",
              Weight: weight,
              Dimensions: { Length: L, Width: W, Height: H },
            };
          })
        : packagesPayload;

    if (SKIP_UPS) {
      setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
      return;
    }

    const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
    const url = `${API_BASE}/api/ups/rates`;
    const payload = { shipper, recipient, packages: boxesToUse };

    console.log("🔎 UPS rates request →", payload);

    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        /* leave raw */
      }

      if (!res.ok) {
        const detail =
          (body && (body.error || body.message || body.detail)) ||
          raw ||
          `HTTP ${res.status}`;
        console.error("❌ UPS rates failed:", detail);
        notify(`UPS rates error: ${detail}`);
        setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
        return;
      }

      const options = Array.isArray(body) ? body : body?.rates || [];
      console.log("✅ UPS rates response ←", options);
      setShippingOptions(options);
    } catch (err) {
      console.error("UPS rate error:", err);
      notify(`UPS rates error: ${(err && err.message) || err}`);
      setShippingOptions([{ method: "Manual Shipping", rate: "N/A", delivery: "TBD" }]);
    }
  }; // ← CLOSES fetchRates PROPERLY

  // 6) Auto-fetch rates whenever a job is selected
  useEffect(() => {
    if (selected.length > 0) {
      fetchRates();
    }
  }, [selected]);

  // 🧠 Updated rate-based shipping handler
  const handleRateAndShip = async (opt) => {
    const { method, rate, delivery } = opt || {};

    if (SKIP_UPS) {
      const ok = window.confirm("Ship this order now?\nThis will update the Google Sheet and create the QuickBooks invoice.");
      if (!ok) return;
      setShippingSelection(null);
      setShippingMethod("Manual Shipping");
      await handleShip();
      return;
    }

    const confirmed = window.confirm(
      `Ship via ${method}?\nEstimated cost: ${rate}\nProjected delivery: ${delivery}\nProceed?`
    );
    if (!confirmed) return;

    setShippingSelection(opt);
    setShippingMethod(method || "UPS");
    await handleShip();
  };


  return (
    <div style={{ padding: "2rem" }}>
      {/* 🚚 Shipping Overlay */}
      {isShippingOverlay && (
        <div style={{
          position: "fixed",
          top: 0, left: 0,
          width: "100vw", height: "100vh",
          backgroundColor: "rgba(255, 247, 194, 0.85)",
          zIndex: 9999,
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
        style={{ fontSize: "1rem", padding: "0.5rem", width: "300px", marginBottom: "2rem" }}
      />
      <datalist id="company-options">
        {allCompanies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

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
          <div style={{ width: 90, textAlign: "center" }}>Due</div>
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
          <div style={{ width: 60 }}>{job.image && <img src={job.image} alt="Preview" style={{ width: "50px", height: "50px", objectFit: "cover", borderRadius: "4px", border: "1px solid #999" }} />}</div>
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
          <div style={{ width: 90, textAlign: "center" }}>{formatDateMMDD(job["Due Date"])}</div>
        </div>
      ))}

      {selected.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h4>Select UPS Shipping Option:</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            {shippingOptions.map((opt) => {
              const { code, method, rate, delivery } = opt;
              return (
                <button
                  key={`${code || method}`}
                  onClick={() => handleRateAndShip(opt)}   // pass the whole object
                  style={{
                    backgroundColor: "#eee",
                    color: "#000",
                    padding: "1rem",
                    marginRight: "1rem",
                    marginBottom: "1rem",
                    minWidth: "200px",
                    border: "1px solid #333",
                    borderRadius: "6px",
                    textAlign: "left",
                    lineHeight: "1.4"
                  }}
                >
                  <div style={{ fontWeight: "bold" }}>{method}</div>
                  <div style={{ fontSize: "0.9rem" }}>Price: {rate}</div>
                  <div style={{ fontSize: "0.85rem", color: "#333" }}>
                    Est. delivery: {typeof delivery === "string" ? delivery : formatDateMMDD(delivery)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}


      {boxes.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h3>📦 Packed Boxes</h3>
          <ul>
            {boxes.map((box, i) => (
              <li key={i}>
                <b>{box.size}</b> → {box.jobs.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sticky action bar — always visible */}
      <div style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        display: "flex",
        gap: "0.5rem",
        zIndex: 1000
      }}>
        <button
          onClick={handleShip}
          disabled={selected.length === 0}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: "bold",
            borderRadius: "999px",
            border: "1px solid #333",
            background: selected.length === 0 ? "#ddd" : "#000",
            color: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            cursor: selected.length === 0 ? "not-allowed" : "pointer"
          }}
          title={selected.length === 0 ? "Select at least one job" : "Ship the selected jobs now"}
        >
          Ship Selected Now
        </button>
      </div>
    </div>
  );
}
