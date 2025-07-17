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
          "https://machine-scheduler-backend.onrender.com/api/process-shipment",
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
                : `https://app.sandbox.qbo.intuit.com/app/invoice?txnId=${data.invoice}`)
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
              labelsPrinted:  shipData.labels.length > 0,
              // use your React state 'boxes' which you set above
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
  // open background windows for labels & slips
  const labelWindows = selected.map((_, i) =>
    window.open("", `labelWindow${i}`, "width=600,height=400")
  );

  setIsShippingOverlay(true);
  setShippingStage("📦 Preparing shipment...");
  setLoading(true);

  try {
    // ── PREPARE ─────────────────────────────────────────
    let response = await fetch(
      `${process.env.REACT_APP_API_ROOT}/prepare-shipment`,
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
    let result = await response.json();

    // (retry missing volume as before)…

    // pack boxes
    const packedBoxes = result.boxes || [];
    setShippingStage("📦 Packing boxes...");
    setBoxes(packedBoxes);

    // ── PROCESS ─────────────────────────────────────────
    setShippingStage("🚚 Processing shipment...");
    const shipRes = await fetch(
      `${process.env.REACT_APP_API_ROOT}/process-shipment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          order_ids: selected,
          boxes: packedBoxes,
          shipped_quantities: Object.fromEntries(
            jobs
              .filter((j) => selected.includes(j.orderId.toString()))
              .map((j) => [j.orderId, j.shipQty])
          ),
          shipping_method: shippingMethod,
        }),
      }
    );
    const shipData = await shipRes.json();

    // ── HANDLE QBO REDIRECT ──────────────────────────────
    if (shipData.redirect) {
      sessionStorage.setItem(
        "pendingShipment",
        JSON.stringify({
          order_ids: selected,
          boxes: packedBoxes,
          shipped_quantities: Object.fromEntries(
            jobs
              .filter((j) => selected.includes(j.orderId.toString()))
              .map((j) => [j.orderId, j.shipQty])
          ),
          shipping_method: shippingMethod,
        })
      );
      window.location.href = `${process.env.REACT_APP_API_ROOT.replace(
        /\/api$/,
        ""
      )}${shipData.redirect}`;
      return;
    }

    // ── SUCCESS ─────────────────────────────────────────
    if (shipRes.ok) {
      setIsShippingOverlay(false);

      // build invoiceUrl but do NOT open it here
      const invoiceUrl = shipData.invoice
        ? shipData.invoice.startsWith("http")
          ? shipData.invoice
          : `https://app.sandbox.qbo.intuit.com/app/invoice?txnId=${shipData.invoice}`
        : "";

      // 4a) Shipping labels
      setShippingStage(
        `🖨️ Printing ${shipData.labels.length} shipping label${
          shipData.labels.length > 1 ? "s" : ""
        }…`
      );
      shipData.labels.forEach((url, i) => {
        const win = labelWindows[i];
        if (win) {
          win.location = url;
          win.blur();    // ensure background
        }
      });

      // 4b) QuickBooks customer/item setup
      setShippingStage("👤 Setting up QuickBooks customer…");
      setShippingStage("📦 Setting up QuickBooks product info…");

      // 4c) Packing slip saved
      setShippingStage(
        `📋 Packing slip PDF saved for ${packedBoxes.length} box${
          packedBoxes.length > 1 ? "es" : ""
        } (watching folder for print)…`
      );

      // 4d) refocus main tab immediately
      setTimeout(() => {
        const mainTab = window.open("", "mainShipTab");
        if (mainTab && mainTab.focus) mainTab.focus();
      }, 100);

      // 4e) Finalize
      setShippingStage("✅ Complete!");
      setLoading(false);
      setTimeout(() => {
         navigate("/shipment-complete", {
           state: {
             shippedOk:     true,
             labelsPrinted: shipData.labels.length > 0,
             // we saved one packing-slip PDF per box into the watch folder:
             slipsPrinted:  packedBoxes.length > 0,
             invoiceUrl
           },
         });
      }, 500);

    } else {
      // server error
      alert(shipData.error || "Shipment failed.");
      setLoading(false);
      setIsShippingOverlay(false);
    }
  } catch (err) {
    console.error(err);
    alert("Failed to ship.");
    setLoading(false);
    setIsShippingOverlay(false);
  }
}; // end handleShip


// 1) State for live UPS rates
const [shippingOptions, setShippingOptions] = useState([]);

// 2) Your package payloads (Customer Supplied = 02)
const packagesPayload = [
  { PackagingType: "02", Weight: 7,  Dimensions: { Length: 10, Width: 10, Height: 10 } },
  { PackagingType: "02", Weight: 24, Dimensions: { Length: 15, Width: 15, Height: 15 } },
  { PackagingType: "02", Weight: 55, Dimensions: { Length: 20, Width: 20, Height: 20 } },
];

// 3)
const shipper = {
  Name:           "JR & Co.",
  AttentionName:  "Justin Eckard",
  Phone:          "678-294-5350",
  Address: {
    AddressLine1:      "3653 Lost Oak Drive",
    AddressLine2:      "",
    City:              "Buford",
    StateProvinceCode: "GA",
    PostalCode:        "30519",
    CountryCode:       "US"
  }
};

// 5) Helper to fetch live UPS rates (with safety checks)
const fetchRates = async () => {
  // 5a) If nothing selected, clear rates and stop
  if (selected.length === 0) {
    setShippingOptions([]);
    return;
  }

  // 5b) Find the one job we’re quoting
  const jobToShip = jobs.find(j => selected.includes(j.orderId.toString()));
  if (!jobToShip) {
    console.warn("No matching job for selected IDs:", selected);
    setShippingOptions([]);
    return;
  }

  // 5c) Build the UPS “ship to” payload from that job
  const recipient = {
    Name:            jobToShip["Company Name"],
    AttentionName:   `${jobToShip["Contact First Name"]} ${jobToShip["Contact Last Name"]}`,
    Phone:           jobToShip["Phone Number"],
    Address: {
      AddressLine1:      jobToShip["Street Address 1"],
      AddressLine2:      jobToShip["Street Address 2"] || "",
      City:              jobToShip["City"],
      StateProvinceCode: jobToShip["State"],
      PostalCode:        jobToShip["Zip Code"],
      CountryCode:       "US"
    }
  };

  // 5d) Call your new /api/rate endpoint
  try {
    const resp = await fetch(
      `${process.env.REACT_APP_API_ROOT}/rate`,
      {
        method: "POST",
        credentials: "include",              // ← add this
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipper, recipient, packages: packagesPayload })
      }
    );
    if (!resp.ok) throw new Error("Rate fetch failed");
    const data = await resp.json();
    setShippingOptions(data);
  } catch (err) {
    console.error("UPS rate error:", err);
    alert("Unable to fetch UPS rates. See console for details.");
  }
};

// 6) Auto‑fetch rates whenever a job is selected
useEffect(() => {
  if (selected.length > 0) {
    fetchRates();
  }
}, [selected]);

// 🧠 Updated rate-based shipping handler
const handleRateAndShip = async (method, rate, deliveryDate) => {
  const confirmed = window.confirm(
    `Ship via ${method}?\nEstimated cost: ${rate}\nProjected delivery: ${deliveryDate}\nProceed?`
  );
  if (!confirmed) return;

  setShippingMethod(method);
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
          <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#f0f0f0", borderRadius: "4px" }}>
            <strong>Boxes needed:</strong>
            {projectedBoxes.length > 0 ? (
              Object.entries(
                projectedBoxes.reduce((acc, box) => {
                  acc[box.size] = (acc[box.size] || 0) + 1;
                  return acc;
                }, {})
              ).map(([size, count]) => (
                <div key={size}>{count} × {BOX_DIMENSIONS[size] || size}</div>
              ))
            ) : (
              <div>No boxes required.</div>
            )}
          </div>
          <h4>Select UPS Shipping Option:</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            {shippingOptions.map((opt) => {
              const { method, rate, delivery } = opt;
              const deliveryDate = parseDateFromString(delivery);

              function toDateOnly(d) {
                return new Date(d.getFullYear(), d.getMonth(), d.getDate());
              }

              const dueDates = jobs
                .filter(j => selected.includes(j.orderId.toString()))
                .map(j => {
                  const d = parseDateFromString(j.due);
                  return d instanceof Date && !isNaN(d) ? d : null;
                })
                .filter(Boolean);

              const earliestDueDate = dueDates.length > 0
                ? new Date(Math.min(...dueDates.map(d => d.getTime())))
                : null;

              function stripTime(d) {
                return new Date(d.getFullYear(), d.getMonth(), d.getDate());
              }

              let backgroundColor = "#ccc"; // default grey

              if (earliestDueDate && deliveryDate) {
                // strip times so we’re only comparing dates
                const due = new Date(
                  earliestDueDate.getFullYear(),
                  earliestDueDate.getMonth(),
                  earliestDueDate.getDate()
                ).getTime();
                const del = new Date(
                  deliveryDate.getFullYear(),
                  deliveryDate.getMonth(),
                  deliveryDate.getDate()
                ).getTime();

                if (del < due) {
                  backgroundColor = "#b2fab4"; // green: early
                } else if (del === due) {
                  backgroundColor = "#fff9c4"; // yellow: same day
                } else {
                  backgroundColor = "#ffcdd2"; // red: late
                }
              }
              return (
                <button
                  key={method}
                  onClick={() => handleRateAndShip(method)}
                  style={{
                    backgroundColor,
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
                  <div style={{ fontSize: "0.85rem", color: "#333" }}>Est. delivery: {formatDateMMDD(delivery)}</div>
                </button>
              );
            })}

          </div>
          <button onClick={() => setSelected([])} style={{ marginTop: "1rem" }}>
            Cancel
          </button>
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
    </div>
  );
}
