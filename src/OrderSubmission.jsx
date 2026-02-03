import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./FileInput.css";
import { useLocation } from "react-router-dom";
import { useNavigate } from "react-router-dom";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");

export default function OrderSubmission() {
  const [form, setForm] = useState({
    company: "",
    designName: "",
    quantity: "",
    product: "",
    price: "",
    dueDate: "",
    dateType: "Hard Date",
    referral: "",
    materials: ["", "", "", "", ""],
    materialPercents: ["", "", "", "", ""],  // ← new
    backMaterial: "",
    embBacking: "Cut Away",
    furColor: "",
    notes: "",
  });

  const [prodFiles, setProdFiles] = useState([]);
  const [printFiles, setPrintFiles] = useState([]);
  const [prodPreviews, setProdPreviews] = useState([]);
  const [printPreviews, setPrintPreviews] = useState([]);
  
  // Track preview URLs for cleanup on unmount
  const prodPreviewUrlsRef = useRef(new Set());
  const printPreviewUrlsRef = useRef(new Set());
  const location = useLocation();
  const reorderJob = location.state?.reorderJob;
  const navigate = useNavigate();
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [isSubmittingOverlay, setIsSubmittingOverlay] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [prodFilesLoading, setProdFilesLoading] = useState(false);
  const [printFilesLoading, setPrintFilesLoading] = useState(false);
  const [overlayVisibleOnce, setOverlayVisibleOnce] = useState(false);
  const [hasStartedLoadingFiles, setHasStartedLoadingFiles] = useState(false);

  // NEW: loading flags for catalog fetches
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [loadingProducts, setLoadingProducts]   = useState(false);
  const [loadingMaterials, setLoadingMaterials] = useState(false);

  const isLoadingCatalog =
    loadingDirectory || loadingProducts || loadingMaterials;

  const getLoadingMessage = () => {
    if (loadingDirectory) return "Loading customers…";
    if (loadingProducts)  return "Loading products…";
    if (loadingMaterials) return "Loading materials…";
    return "Loading…";
  };


  // list of company‐name options from Directory sheet
  const [companies, setCompanies] = useState([]);
  const companyInputRef = useRef(null);

  // product list + input ref
  const [products, setProducts] = useState([]);
  const productInputRef = useRef(null);

  // ─── MATERIALS inventory + refs ───────────────────────────────
  const [materialsInv, setMaterialsInv] = useState([]);
  // an array of refs for Material1–5
  const materialInputRefs = useRef([null, null, null, null, null]);
  // single ref for Back Material
  const backMaterialRef = useRef(null);
  // ─── FUR COLORS list + input ref ───────────────────────────────
  const furColorRef = useRef(null);

  // ─── New-Material modal state & data ─────────────────────────
  const [isNewMaterialModalOpen, setIsNewMaterialModalOpen] = useState(false);
  const [modalMaterialField, setModalMaterialField] = useState(null);
  const [newMaterialData, setNewMaterialData] = useState({
    materialName: "",
    unit: "",
    minInv: "",
    reorder: "",
    cost: "",
    vendor: "",
    color: "#000000",
  });
  const [newMaterialErrors, setNewMaterialErrors] = useState({});

  const handleNewMaterialChange = (e) => {
    const { name, value } = e.target;
    setNewMaterialData((prev) => ({ ...prev, [name]: value }));
  };


  // ─── New‐Company modal state & data ───────────────────────────
  const [isNewCompanyModalOpen, setIsNewCompanyModalOpen] = useState(false);
  const [newCompanyData, setNewCompanyData] = useState({
    companyName: form.company,
    contactFirstName: "",
    contactLastName: "",
    contactEmailAddress: "",
    streetAddress1: "",
    streetAddress2: "",
    city: "",
    state: "",
    zipCode: "",
    phoneNumber: "",
  });
  const [newCompanyErrors, setNewCompanyErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress]  = useState(0);
  // ─── NEW: track “unknown product” pop-up ───────────────────────
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [newProductName, setNewProductName]         = useState("");
  const [newProductData, setNewProductData] = useState({
    product: "",
    printTime: "",
    foamHalf: "",
    foam38: "",
    foam14: "",
    foam18: "",
    magnetN: "",
    magnetS: "",
    elasticHalf: "",
    length: "",
    width: "",
    depth: "",
    blackGrommets: "",    // <— new
    paracordFt: "",       // <— new
    cordStoppers: ""      // <— new
  });

  const [modalSubmitting, setModalSubmitting] = useState(false);

  // ─── Reorder modal state & handlers ─────────────────────────────
  const [isReorderModalOpen, setIsReorderModalOpen] = useState(false);
  const [reorderData, setReorderData] = useState({
    previousOrder: "",
    newDueDate: "",
    newDateType: "Hard Date",
    notes: "",
    previewUrl: ""
  });

  const handleReorderChange = (e) => {
    const { name, value } = e.target;
    setReorderData(d => ({ ...d, [name]: value }));
  };


  // Extract the Drive fileId (works for ?id=... or /file/d/<id>/...)
  const extractDriveFileId = (link) => {
    if (!link) return "";
    try {
      if (link.includes("id=")) return link.split("id=")[1].split("&")[0];
      if (link.includes("/file/d/")) return link.split("/file/d/")[1].split("/")[0];
    } catch {}
    return "";
  };

  // Build the exact formula you like for the Preview cell (still renders a thumbnail)
  const buildPreviewFormulaFromId = (fileId) => {
    if (!fileId) return "";
    // Your current formula pattern, but we fill the id directly:
    // =IFNA(IMAGE("https://drive.google.com/uc?export=view&id=" & <id>), "No preview available")
    // Since we’re sending a single cell value, we inline the id string (no & needed).
    return `=IFNA(IMAGE("https://drive.google.com/uc?export=view&id=${fileId}"), "No preview available")`;
  };

  // If you already have a full thumbnail URL (drive.google.com/thumbnail?...), you can still IMAGE() it:
  const buildPreviewFormulaFromUrl = (url) => {
    if (!url) return "";
    return `=IFNA(IMAGE("${url}"), "No preview available")`;
  };


  const loadExistingOrder = async () => {
    if (!reorderData.previousOrder) return;

    try {
      const { data: old } = await axios.get(
        `${API_ROOT}/orders/${reorderData.previousOrder}`
      );

      const preview = extractDriveThumbnail(old["Image"] || "");

      setReorderData((d) => ({
        ...d,
        notes: old["Notes"] || "",
        newDateType: old["Hard/Soft Date"] || "Hard Date",
        previewUrl: preview,
      }));
    } catch (err) {
      console.error("❌ Could not load existing order:", err);
    }
  };

  const handleReorderSubmit = async () => {
    try {
      const payload = {
        previousOrder: reorderData.previousOrder,
        newDueDate: reorderData.newDueDate,
        newDateType: reorderData.newDateType,
        notes: reorderData.notes,
      };

      console.log("📦 Submitting reorder payload:", JSON.stringify(payload, null, 2));

      const response = await axios.post(`${API_ROOT}/reorder`, payload, {
        headers: { "Content-Type": "application/json" },
      });

      console.log("✅ Reorder response:", response.data);

      setIsReorderModalOpen(false);
      alert("Reorder created!");
    } catch (err) {
      console.error("❌ Error submitting reorder:", err);
      alert("Failed to submit reorder.");
    }
  };

  // Step 1: flags for unrecognized entries
  const companyInvalid   = form.company.trim() && !companies
    .map(c => c.value.toLowerCase())
    .includes(form.company.trim().toLowerCase());
  const productInvalid   = form.product.trim() && !products
    .map(p => p.toLowerCase())
    .includes(form.product.trim().toLowerCase());
  const materialsInvalid =
    form.materials.filter(m => m.trim()).some(m =>
      !materialsInv.map(v => v.toLowerCase()).includes(m.trim().toLowerCase())
    )
    || (
      form.backMaterial.trim() &&
      !materialsInv.map(v => v.toLowerCase())
               .includes(form.backMaterial.trim().toLowerCase())
    )
    || (
      form.furColor.trim() &&
      !materialsInv.map(v => v.toLowerCase())
               .includes(form.furColor.trim().toLowerCase())
    );
  const formRef = useRef(null); // for automatic resubmit

  const handleNewProductChange = (e) => {
    const { name, value } = e.target;
    setNewProductData((p) => ({ ...p, [name]: value }));
  };

  const handleNewCompanyChange = (e) => {
    const { name, value } = e.target;
    setNewCompanyData((prev) => ({ ...prev, [name]: value }));
  };

// when user types, update form.company and show inline suggestion
const handleCompanyInput = (e) => {
  const raw = e.target.value;
  const inputType = e.nativeEvent?.inputType;

  // handle backspace/delete by just storing raw
  if (inputType?.startsWith("delete")) {
    setForm((prev) => ({ ...prev, company: raw }));
    return;
  }

  // attempt inline completion from the loaded names
  const match = companyNames.find((c) =>
    c.toLowerCase().startsWith(raw.toLowerCase())
  );

  if (match && raw !== match) {
    setForm((prev) => ({ ...prev, company: match }));
    // highlight only the appended text
    setTimeout(() => {
      const input = companyInputRef.current;
      input?.setSelectionRange(raw.length, match.length);
    }, 0);
  } else {
    setForm((prev) => ({ ...prev, company: raw }));
  }
};


// ─── PRODUCT inline‐typeahead (single definition) ──────────────
const handleProductInput = (e) => {
  const raw = e.target.value;
  const inputType = e.nativeEvent?.inputType;

  if (inputType?.startsWith("delete")) {
    setForm((prev) => ({ ...prev, product: raw }));
    return;
  }

  const match = productNames.find((p) =>
    p.toLowerCase().startsWith(raw.toLowerCase())
  );

  if (match && raw !== match) {
    setForm((prev) => ({ ...prev, product: match }));
    setTimeout(() => {
      const input = productInputRef.current;
      input?.setSelectionRange(raw.length, match.length);
    }, 0);
  } else {
    setForm((prev) => ({ ...prev, product: raw }));
  }
};


// ─── MATERIAL inline‐typeahead ─────────────────────────────────
const handleMaterialInput = (i) => (e) => {
  const raw = e.target.value;
  const inputType = e.nativeEvent?.inputType;

  if (!raw) {
    handleMaterialChange(i, "");
    return;
  }

  if (inputType?.startsWith("delete")) {
    handleMaterialChange(i, raw);
    return;
  }

  const match = materialNames.find(m =>
    m.toLowerCase().startsWith(raw.toLowerCase())
  );
  if (match && raw !== match) {
    handleMaterialChange(i, match);
    setTimeout(() => {
      const input = materialInputRefs.current[i];
      if (input) input.setSelectionRange(raw.length, match.length);
    }, 0);
  } else {
    handleMaterialChange(i, raw);
  }
};


// ─── BACK MATERIAL inline‐typeahead ─────────────────────────────
const handleBackMaterialInput = (e) => {
  const raw = e.target.value;
  const inputType = e.nativeEvent?.inputType;

  if (!raw) {
    setForm(prev => ({ ...prev, backMaterial: "" }));
    return;
  }

  if (inputType?.startsWith("delete")) {
    setForm(prev => ({ ...prev, backMaterial: raw }));
    return;
  }

  const match = materialNames.find(m =>
    m.toLowerCase().startsWith(raw.toLowerCase())
  );
  if (match && raw !== match) {
    setForm(prev => ({ ...prev, backMaterial: match }));
    setTimeout(() => {
      const input = backMaterialRef.current;
      if (input) input.setSelectionRange(raw.length, match.length);
    }, 0);
  } else {
    setForm(prev => ({ ...prev, backMaterial: raw }));
  }
};


  // ─── FUR COLOR inline‐typeahead ────────────────────────────────
  const handleFurColorInput = (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;

    if (!raw) {
      setForm(prev => ({ ...prev, furColor: "" }));
      return;
    }

    if (inputType?.startsWith("delete")) {
      setForm(prev => ({ ...prev, furColor: raw }));
      return;
    }

    const match = furColorNames.find(m =>
      m.toLowerCase().startsWith(raw.toLowerCase())
    );
    if (match && raw !== match) {
      setForm(prev => ({ ...prev, furColor: match }));
      setTimeout(() => {
        const input = furColorRef.current;
        if (input) input.setSelectionRange(raw.length, match.length);
      }, 0);
    } else {
      setForm(prev => ({ ...prev, furColor: raw }));
    }
  };


  useEffect(() => {
    const fetchDirectory = async () => {
      setLoadingDirectory(true);
      try {
        const cfg = {
          withCredentials: true,
          timeout: 90000,
          validateStatus: s => s >= 200 && s < 400,
        };
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await axios.get(`${API_ROOT}/directory`, cfg);
            const arr = Array.isArray(res.data) ? res.data : [];
            console.log(`[/directory] payload size (attempt ${attempt}):`, arr.length);
            const opts = arr
              .map((c) => ({ value: c, label: c }))
              .sort((a, b) => a.label.localeCompare(b.label));
            setCompanies(opts);
            return;
          } catch (err) {
            console.error(`Directory attempt ${attempt} failed:`, err?.message || err);
            if (attempt === 3) setCompanies([]);
            else await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      } finally {
        setLoadingDirectory(false);
      }
    };
    fetchDirectory();
  }, []);



   // ─── Fetch products ────────────────────────────────────────────────
  useEffect(() => {
    const fetchProducts = async () => {
      setLoadingProducts(true);
      try {
        const cfg = {
          withCredentials: true,
          timeout: 90000,
          validateStatus: s => s >= 200 && s < 400,
        };
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await axios.get(`${API_ROOT}/products`, cfg);
            const arr = Array.isArray(res.data) ? res.data : [];
            console.log(`[/products] payload size (attempt ${attempt}):`, arr.length);
            setProducts(arr);
            return;
          } catch (err) {
            console.error(`Products attempt ${attempt} failed:`, err?.message || err);
            if (attempt === 3) setProducts([]);
            else await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      } finally {
        setLoadingProducts(false);
      }
    };
    fetchProducts();
  }, []);



  // ─── Fetch materials inventory from Sheet ──────────────────────
useEffect(() => {
  setLoadingMaterials(true);
  const cfg = {
    withCredentials: true,
    timeout: 45000,
    validateStatus: s => s >= 200 && s < 400,
  };
  axios.get(`${API_ROOT}/materials`, cfg)
    .then(res => {
      const arr = Array.isArray(res.data) ? res.data : [];
      console.log("[/materials] payload size:", arr.length);
      setMaterialsInv(arr);
    })
    .catch(err => {
      console.error("Failed to load materials:", err?.message || err);
      setMaterialsInv([]);
    })
    .finally(() => setLoadingMaterials(false));
}, []);

  // ─── Cleanup blob URLs on component unmount to prevent memory leaks ───────────
  useEffect(() => {
    return () => {
      // Revoke all blob URLs when component unmounts
      prodPreviewUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      printPreviewUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      prodPreviewUrlsRef.current.clear();
      printPreviewUrlsRef.current.clear();
    };
  }, []); // Only run on mount/unmount




// for matching
const materialNames = materialsInv;

// make array of just the names for matching
const furColorNames = materialNames;

// prepare simple array of names
const companyNames = companies.map((opt) => opt.value);


  const productNames = products;


  // remove the production file + its preview at index i
  const removeProdFile = (i) => {
    // Revoke the blob URL before removing to prevent memory leaks
    setProdPreviews((prev) => {
      if (prev[i]?.url) {
        URL.revokeObjectURL(prev[i].url);
        prodPreviewUrlsRef.current.delete(prev[i].url); // Remove from tracking
      }
      return prev.filter((_, idx) => idx !== i);
    });
    // Only update file array; leave form.designName alone
    setProdFiles((prevFiles) => prevFiles.filter((_, idx) => idx !== i));
  };


  // remove the print file + its preview at index i
  const removePrintFile = (i) => {
    // Revoke the blob URL before removing to prevent memory leaks
    setPrintPreviews((prev) => {
      if (prev[i]?.url) {
        URL.revokeObjectURL(prev[i].url);
        printPreviewUrlsRef.current.delete(prev[i].url); // Remove from tracking
      }
      return prev.filter((_, idx) => idx !== i);
    });
    setPrintFiles((f) => f.filter((_, idx) => idx !== i));
  };


  const baseForSubmit = API_ROOT.replace(/\/api$/, "");
  const submitUrl = process.env.REACT_APP_ORDER_SUBMIT_URL || `${baseForSubmit}/submit`;


  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // ─── Quick-pick Due Date (6/7/8 weeks) ────────────────────────
  const setDueDateWeeks = (weeks) => {
    const d = new Date();
    d.setDate(d.getDate() + weeks * 7);
    const iso = d.toISOString().split("T")[0];  // YYYY-MM-DD
    setForm((prev) => ({ ...prev, dueDate: iso }));
  };



  const handleMaterialChange = (i, val) => {
    setForm((prev) => {
      const m = [...prev.materials];
      m[i] = val;
      return { ...prev, materials: m };
    });
  };


  const handleMaterialPercentChange = (i, val) => {
    setForm((prev) => {
      const newPercents = [...prev.materialPercents];
      newPercents[i] = val;
      return { ...prev, materialPercents: newPercents };
    });
  };


  const createPreviews = (files, urlsRef) =>
    files.map((f) => {
      const url = URL.createObjectURL(f);
      urlsRef.current.add(url); // Track URL for cleanup
      return { url, type: f.type, name: f.name };
    });

  const handleFileChange = (e, setter, previewSetter, urlsRef) => {
    const files = Array.from(e.target.files);
    setter((prev) => [...prev, ...files]);
    previewSetter((prev) => [...prev, ...createPreviews(files, urlsRef)]);
    // Do NOT touch form.designName — user will type it manually 
  };

console.log({
  companyNames: companyNames.slice(0, 5),
  productNames: productNames.slice(0, 5),
  materialNames: materialNames.slice(0, 5),
});
// ─── UPDATED handleSubmit ───────────────────────────────────────
const handleSubmit = async (e) => {
  console.log("🛎️ handleSubmit called");
  console.log("🛎️ isReorder:", form.isReorder);
  e.preventDefault();

  // Show overlay immediately when submit button is clicked
  setIsSubmittingOverlay(true);

  // ⛔ Skip all validation if this is a reorder
  if (form.isReorder) {
    return submitForm();
  }

  // 1) Company check
  const companyLower = form.company.trim().toLowerCase();
  const knownCompanies = companies.map(c => c.value.toLowerCase());
  if (!knownCompanies.includes(companyLower)) {
    setIsSubmittingOverlay(false);  // Hide overlay on validation failure
    setNewCompanyData(dc => ({ ...dc, companyName: form.company }));
    return setIsNewCompanyModalOpen(true);
  }

  // 2) Product check
  let table;
  try {
    const res = await fetch(`${process.env.REACT_APP_API_ROOT}/table`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Table fetch failed");
    table = await res.json();
  } catch (err) {
    console.error("Could not load Table data:", err);
    setIsSubmittingOverlay(false);  // Hide overlay on validation failure
    alert("Unable to verify product list. Please try again later.");
    return;
  }
  const existingProducts = table
    .map(r => r.Products?.toString().trim().toLowerCase())
    .filter(Boolean);
  const requested = form.product.trim().toLowerCase();
  if (!existingProducts.includes(requested)) {
    setIsSubmittingOverlay(false);  // Hide overlay on validation failure
    setNewProductName(form.product);
    setNewProductData(p => ({ ...p, product: form.product }));
    return setIsNewProductModalOpen(true);
  }

  // 3) Materials check
  const allMaterials = [
    ...form.materials.filter(m => m.trim()),
    form.backMaterial,
    form.furColor
  ].filter(Boolean);
  const missingMat = allMaterials.find(m =>
    !materialsInv.map(v => v.toLowerCase()).includes(m.trim().toLowerCase())
  );
  if (missingMat) {
    setIsSubmittingOverlay(false);  // Hide overlay on validation failure
    const matIndex = form.materials.indexOf(missingMat);
    setModalMaterialField({
      type: matIndex >= 0 ? "materials" : "backMaterial",
      index: matIndex >= 0 ? matIndex : null
    });
    setNewMaterialData({
      materialName: missingMat,
      unit: "",
      minInv: "",
      reorder: "",
      cost: ""
    });
    return setIsNewMaterialModalOpen(true);
  }

  // ── New: ensure any non‑empty Material[i] has form.materialPercents[i] filled ──
  for (let i = 0; i < form.materials.length; i++) {
    const mat = form.materials[i].trim();
    const pct = (form.materialPercents[i] || "").toString().trim();
    if (mat && !pct) {
      setIsSubmittingOverlay(false);  // Hide overlay on validation failure
      alert(`Please enter a percentage for Material ${i+1}.`);
      return;  // stop here and keep the form visible
    }
  }

  // ✅ If everything checks out, submit
  return submitForm();
};


// 🔧 Shared submission logic for normal orders and reorders
const submitForm = async () => {
  window._isSubmittingOrder = true;   // ⛔ pause polling

  console.log("⏳ Waiting for prodFiles to finalize...");
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log("🛎️ submitForm called");

  console.log("🧪 prodFiles right before check:", prodFiles);

  if (prodFiles.length === 0 && !form.isReorder) {
    setIsSubmittingOverlay(false);  // Hide overlay on validation failure
    window._isSubmittingOrder = false;  // Resume polling
    alert("Please select one or more production files.");
    return;
  }
  const fd = new FormData();
  Object.entries(form).forEach(([key, value]) => {
    if (key === "materials") {
      value.forEach(m => fd.append("materials", m));
    } else if (key === "materialPercents") {
      value.forEach(p => fd.append("materialPercents", p));
    } else {
      fd.append(key, value);
    }
  });

  // 🧵 Add reorderFrom if this is a reorder
  if (reorderJob && reorderJob["Order #"]) {
    fd.append("reorderFrom", reorderJob["Order #"]);
  }

  console.log("🧪 prodFiles right before check:", prodFiles);

  if (prodFiles.length > 0) {
    prodFiles.forEach((f, i) => {
      const safeFile = new File([f], f.name, { type: f.type || "application/octet-stream" });
      fd.append("prodFiles", safeFile);
      console.log(`📦 Added prodFile[${i}]:`, safeFile.name, safeFile.size, safeFile.type);
    });
  } else if (!form.isReorder) {
    setIsSubmittingOverlay(false);  // Hide overlay on validation failure
    window._isSubmittingOrder = false;  // Resume polling
    alert("Please select one or more production files.");
    return;
  } else {
    console.warn("⚠️ No prodFiles but this is reorder, continuing...");
  }

  // 🖨️ Append printFiles
  if (printFiles.length > 0) {
    printFiles.forEach((f, i) => {
      const safeFile = new File([f], f.name, { type: f.type || "application/octet-stream" });
      fd.append("printFiles", safeFile);
      console.log(`🖨️ Added printFile[${i}]:`, safeFile.name, safeFile.size, safeFile.type);
    });
  }

  // Log all form data before submitting
  for (let [key, value] of fd.entries()) {
    if (value instanceof File) {
      console.log(`📁 ${key}: File - ${value.name} (${value.size} bytes, ${value.type})`);
    } else {
      console.log(`📄 ${key}: ${value}`);
    }
  }

  // ▶️ Build Preview formula (so the cell shows a thumbnail immediately)
  // Priority:
  // 1) If this is a reorder and we have reorderData.previewUrl → use it
  // 2) Else if you store any Google Drive link in a form field (e.g. form.prodLink) → use it
  //    (Add your own field name if you have one)
  let previewFormula = "";

  if (form.isReorder && reorderData.previewUrl) {
    const id = extractDriveFileId(reorderData.previewUrl);
    previewFormula = id
      ? buildPreviewFormulaFromId(id)
      : buildPreviewFormulaFromUrl(reorderData.previewUrl);
  } else if (form.prodLink) {
    const id = extractDriveFileId(form.prodLink);
    previewFormula = id
      ? buildPreviewFormulaFromId(id)
      : buildPreviewFormulaFromUrl(form.prodLink);
  }

  // If we built a formula, include it in the submission. The backend should write this
  // into the "Preview" column for the new row verbatim (Sheets will render the image).
  if (previewFormula) {
    fd.append("previewFormula", previewFormula);
  }


  if (!fd.has("prodFiles")) {
    console.error("❌ No prodFiles in FormData");
  }

  setIsSubmitting(true);
  // Note: setIsSubmittingOverlay(true) is already set at the start of handleSubmit

  try {
    const baseForSubmit = API_ROOT.replace(/\/api$/, "");
    const submitUrl = process.env.REACT_APP_ORDER_SUBMIT_URL || `${baseForSubmit}/submit`;


    const config = {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        const pct = Math.round((e.loaded * 100) / e.total);
        setUploadProgress(pct);
      }
    };

    // ⬇️ keep the response so we can use any returned IDs/fields
    const { data } = await axios.post(submitUrl, fd, config);

    // ⬇️ If backend returns a Drive fileId for the primary production file,
    // write the Preview cell formula immediately (so the sheet shows the thumbnail now).
    if (data?.primaryFileId && data?.orderNumber) {
      const f = buildPreviewFormulaFromId(data.primaryFileId);
      try {
        try {
          // Try to get the file id from the formula or from any provided link
          const fromFormula = (f || "").match(/id=([A-Za-z0-9_-]+)/)?.[1]
                          || (f || "").match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1];

          // If you have a prod link field, keep as a fallback:
          const fromProdLink = form?.prodLink ? (form.prodLink.match(/id=([A-Za-z0-9_-]+)/)?.[1]
                          || form.prodLink.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]) : null;

          const fileId = fromFormula || fromProdLink;
          if (fileId) {
            await axios.post(
              `${API_ROOT}/drive/warmThumbnails`,
              { pairs: [ { id: fileId, v: String(data.orderNumber), sz: "w160" } ] },
              { withCredentials: true }
            );
          }
        } catch (err) {
          console.warn("Thumbnail warm failed (non-blocking):", err);
        }

      } catch (err) {
        console.warn("Could not set Preview formula via API:", err);
      }
    }

    setIsSubmittingOverlay(false);
    setShowSuccessOverlay(true);
    setTimeout(() => {
      setShowSuccessOverlay(false);
    }, 3000);

    // reset
    setForm({
      company: "",
      designName: "",
      quantity: "",
      product: "",
      price: "",
      dueDate: "",
      dateType: "Hard Date",
      referral: "",
      materials: ["", "", "", "", ""],
      materialPercents: ["", "", "", "", ""],  // ← add this
      backMaterial: "",
      embBacking: "",
      furColor: "",
      notes: "",
    });
    // Clean up blob URLs before clearing arrays to prevent memory leaks
    prodPreviews.forEach((preview) => {
      if (preview?.url) {
        URL.revokeObjectURL(preview.url);
        prodPreviewUrlsRef.current.delete(preview.url);
      }
    });
    printPreviews.forEach((preview) => {
      if (preview?.url) {
        URL.revokeObjectURL(preview.url);
        printPreviewUrlsRef.current.delete(preview.url);
      }
    });
    prodPreviewUrlsRef.current.clear();
    printPreviewUrlsRef.current.clear();
    setProdFiles([]);
    setPrintFiles([]);
    setProdPreviews([]);
    setPrintPreviews([]);
  } catch (err) {
    console.error(err);
    alert(err.response?.data?.error || "Submission failed");
  } finally {
    setIsSubmitting(false);
    setUploadProgress(0);
    window._isSubmittingOrder = false;   // ✔ resume polling
  }

};


// ─── Save the new company to Google Sheets ─────────────────────
const handleSaveNewCompany = async () => {
  // 1) Validate required fields (everything except streetAddress2)
  const required = [
    "companyName",
    "contactFirstName",
    "contactLastName",
    "contactEmailAddress",
    "streetAddress1",
    "city",
    "state",
    "zipCode",
    "phoneNumber",
  ];
  const errors = {};
  required.forEach((key) => {
    if (!newCompanyData[key]?.trim()) {
      errors[key] = "Required";
    }
  });
  if (Object.keys(errors).length) {
    setNewCompanyErrors(errors);
    return;
  }

  // 2) Call the backend
  try {
    await axios.post(
      `${process.env.REACT_APP_API_ROOT}/directory`,
      newCompanyData
    );
    alert("Company successfully added");
    // 3) On success, add to local company list so it’s available immediately
    setCompanies((prev) => [
      ...prev,
      { value: newCompanyData.companyName, label: newCompanyData.companyName },
    ]);
    // 4) Fill the form.company with the newly added name
    setForm((prev) => ({ ...prev, company: newCompanyData.companyName }));
    // 5) Close the modal
    setIsNewCompanyModalOpen(false);
    // 6) Clear any past errors
    setNewCompanyErrors({});
    // (You can now click Submit again to finish the order.)
  } catch (err) {
    // Show a general error at the top of the modal
    setNewCompanyErrors({ general: "Failed to save company. Please try again." });
  }
};

  // ─── Save the new material to Google Sheets ───────────────────
  const handleSaveNewMaterial = async () => {
    // validate name, unit, minInv, reorder, cost, vendor
    const required = ["materialName", "unit", "minInv", "reorder", "cost", "vendor"];
    const errors = {};
    required.forEach((k) => {
      if (!newMaterialData[k]?.toString().trim()) errors[k] = "Required";
    });
    if (Object.keys(errors).length) {
      setNewMaterialErrors(errors);
      return;
    }

    try {
      await axios.post(
        `${process.env.REACT_APP_API_ROOT}/materials`,
        newMaterialData
      );
      alert("Material successfully added");

      // 1) Add to local list
      setMaterialsInv((prev) => [...prev, newMaterialData.materialName]);

      // 2) Update the form field that triggered it
      if (modalMaterialField.type === "materials") {
        const mArr = [...form.materials];
        mArr[modalMaterialField.index] = newMaterialData.materialName;
        setForm((f) => ({ ...f, materials: mArr }));
      } else if (modalMaterialField.type === "backMaterial") {
        setForm((f) => ({ ...f, backMaterial: newMaterialData.materialName }));
      } else {
        setForm((f) => ({ ...f, furColor: newMaterialData.materialName }));
      }

      // 3) Close modal & clear errors
      setIsNewMaterialModalOpen(false);
      setNewMaterialErrors({});
    } catch {
      setNewMaterialErrors({ general: "Failed to save material. Try again." });
    }
  };

  // whenever the order# changes, immediately load it
  useEffect(() => {
    if (reorderData.previousOrder) {
      loadExistingOrder();
    }
  }, [reorderData.previousOrder]);

  useEffect(() => {
    if (reorderJob) {
      setHasStartedLoadingFiles(true);
      console.log("📋 Prefilling form from reorder job:", reorderJob);
      setIsPrefilling(true);
      console.log("🟡 isPrefilling manually set to TRUE");
      console.log("🔍 Keys:", Object.keys(reorderJob));
 
      setForm(prev => ({
        ...prev,
        company: reorderJob["Company Name"] || "",
        designName: reorderJob["Design"] || "",
        quantity: reorderJob["Quantity"] || "",
        product: reorderJob["Product"] || "",
        price: reorderJob["Price"] || "",
        dueDate: "", // force user to select a new one
        dateType: reorderJob["Hard Date/Soft Date"] || "Hard Date",
        referral: reorderJob["Referral"] || "",
        notes: reorderJob["Notes"] || "",
        materials: [
          reorderJob["Material1"] || "",
          reorderJob["Material2"] || "",
          reorderJob["Material3"] || "",
          reorderJob["Material4"] || "",
          reorderJob["Material5"] || "",
        ],
        backMaterial: reorderJob["Back Material"] || "",
        embBacking: reorderJob["EMB Backing"] || "",  // ✅ this now works with your <select>
        furColor: reorderJob["Fur Color"] || "",
        isReorder: true,
      }));

      if (reorderJob["Image"] && reorderJob["Image"].includes("/folders/")) {
        const prodFolderMatch = reorderJob["Image"].match(/\/folders\/([a-zA-Z0-9_-]+)/);
        const prodFolderId = prodFolderMatch ? prodFolderMatch[1] : null;

        if (!prodFolderId) {
          console.warn("❗ Invalid production folder link:", reorderJob["Image"]);
        } else {
          setProdFilesLoading(true);
          fetch(`${process.env.REACT_APP_API_ROOT}/list-folder-files?folderId=${prodFolderId}`)
            .then(res => res.json())
            .then(async (data) => {
              if (!Array.isArray(data.files)) {
                console.warn("❗ Invalid response from backend for production files:", data);
                setProdFilesLoading(false);
                return;
              }

              const previews = [];
              const files = [];

              for (let fileMeta of data.files) {
                const downloadUrl = `${process.env.REACT_APP_API_ROOT}/proxy-drive-file?fileId=${fileMeta.id}`;
                try {
                  const blob = await fetch(downloadUrl).then(r => r.blob());
                  const realBlob = blob.slice(0, blob.size, blob.type);
                  const file = new File([realBlob], fileMeta.name, {
                    type: realBlob.type || "application/octet-stream",
                  });

                  files.push(file);
                  const url = URL.createObjectURL(blob);
                  prodPreviewUrlsRef.current.add(url); // Track URL for cleanup
                  previews.push({
                    url,
                    type: blob.type,
                    name: fileMeta.name,
                  });
                } catch (err) {
                  console.error("❌ Failed to download production file:", fileMeta.name, err);
                }
              }
              setProdPreviews(previews);
              setProdFiles(files);
              setProdFilesLoading(false);
              setTimeout(() => {
                console.log("✅ Prod files set after reorder:", files);
              }, 0);
            })
            .catch(err => {
              console.error("❌ Failed to list production folder contents:", err);
              setProdFilesLoading(false);
            });
        }
      } else if (reorderJob["Image"] && reorderJob["Image"].includes("drive.google.com/file")) {
        const fileIdMatch = reorderJob["Image"].match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        const fileId = fileIdMatch ? fileIdMatch[1] : null;

        if (!fileId) {
          console.warn("❗ Invalid production file link:", reorderJob["Image"]);
        } else {
          setProdFilesLoading(true);
          fetch(`${process.env.REACT_APP_API_ROOT}/drive-file-metadata?fileId=${fileId}`)
            .then(res => res.json())
            .then(meta => {
              const filename = meta?.name || "Production File";
              const downloadUrl = `${process.env.REACT_APP_API_ROOT}/proxy-drive-file?fileId=${fileId}`;
              return fetch(downloadUrl)
                .then(r => r.blob())
                .then(blob => {
                  const realBlob = blob.slice(0, blob.size, blob.type);
                  const file = new File([realBlob], filename, {
                    type: realBlob.type || "application/octet-stream",
                  });

                  const wrappedFile = new File([blob], filename, {
                    type: blob.type || "application/octet-stream",
                  });

                  const url = URL.createObjectURL(blob);
                  prodPreviewUrlsRef.current.add(url); // Track URL for cleanup
                  setProdFiles([wrappedFile]);
                  setProdPreviews([{
                    url,
                    type: blob.type,
                    name: filename,
                  }]);
                  setProdFilesLoading(false);

                  setTimeout(() => {
                    console.log("✅ Prod files set (single):", wrappedFile);
                  }, 0);
                });
            })
            .catch(err => {
              console.error("❌ Failed to fetch or download single production file:", err);
              setProdFilesLoading(false);
            });
        }
      } else {
        setProdFilesLoading(false);
      }

      if (reorderJob["Print Files"] && reorderJob["Print Files"].includes("/folders/")) {
        const folderUrl = reorderJob["Print Files"];
        const match = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        const folderId = match ? match[1] : null;

        if (!folderId) {
          console.warn("❗ Invalid folder link:", folderUrl);
          setPrintFilesLoading(false);
          return;
        }

        setPrintFilesLoading(true);
        fetch(`${process.env.REACT_APP_API_ROOT}/list-folder-files?folderId=${folderId}`)
          .then(res => res.json())
          .then(async (data) => {
            if (!Array.isArray(data.files)) {
              console.warn("❗ Invalid response from backend for folder contents", data);
              setPrintFilesLoading(false);
              return;
            }

            const previews = [];
            const files = [];

            for (let fileMeta of data.files) {
              const downloadUrl = `${process.env.REACT_APP_API_ROOT}/proxy-drive-file?fileId=${fileMeta.id}`;

              try {
                const blob = await fetch(downloadUrl).then(r => r.blob());

                const file = new File([blob], fileMeta.name, {
                  type: blob.type || "application/octet-stream",
                });

                files.push(file);
                const url = URL.createObjectURL(blob);
                printPreviewUrlsRef.current.add(url); // Track URL for cleanup
                previews.push({
                  url,
                  type: blob.type,
                  name: fileMeta.name,
                });
              } catch (err) {
                console.error("❌ Failed to download print file:", fileMeta.name, err);
              }
            }

            setPrintFiles(files);
            setPrintPreviews(previews);
            setPrintFilesLoading(false);
          })
          .catch(err => {
            console.error("❌ Failed to list folder contents:", err);
            setPrintFilesLoading(false);
          });
      } else {
        console.warn("❗ Skipping print file fetch — no folder link:", reorderJob["Print Files"]);
        setPrintFilesLoading(false);
        console.log("🟢 Print file loading finished");
      }
    }
  }, [reorderJob]);

  useEffect(() => {
    if (hasStartedLoadingFiles && !prodFilesLoading && !printFilesLoading) {
      setTimeout(() => {
        setIsPrefilling(false);
      }, 300);
    }
  }, [hasStartedLoadingFiles, prodFilesLoading, printFilesLoading]);

  return (
    <>
      {isLoadingCatalog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(255, 255, 0, 0.35)", // transparent yellow
            backdropFilter: "blur(1px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "none", // overlay blocks clicks visually but doesn't steal them
          }}
          aria-live="polite"
          aria-busy="true"
        >
          <div
            style={{
              padding: "16px 24px",
              borderRadius: 16,
              background: "rgba(255,255,255,0.85)",
              boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {getLoadingMessage()}
          </div>
        </div>
      )}

      {isSubmittingOverlay && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(255, 255, 0, 0.2)",
          zIndex: 9999,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: "2rem",
          fontWeight: "bold",
          color: "#555",
        }}>
          🛠️ Submitting order...
        </div>
      )}

      {showSuccessOverlay && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(0, 255, 0, 0.2)",
          zIndex: 9999,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: "2rem",
          fontWeight: "bold",
          color: "#1a3e1a",
        }}>
          ✅ Order submitted!
        </div>
      )}
      {/* ─── Company Modal ───────────────────────────────────── */}
      {isNewCompanyModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "1.5rem",
              borderRadius: "0.5rem",
              width: "500px",
              maxHeight: "90%",
              overflowY: "auto",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Add New Company</h2>
            {newCompanyErrors.general && (
              <div style={{ color: "red", marginBottom: "0.5rem" }}>
                {newCompanyErrors.general}
              </div>
            )}
            {[
              { key: 'companyName', label: 'Company Name' },
              { key: 'contactFirstName', label: 'Contact First Name' },
              { key: 'contactLastName', label: 'Contact Last Name' },
              { key: 'contactEmailAddress', label: 'Contact Email Address' },
              { key: 'streetAddress1', label: 'Street Address 1' },
              { key: 'streetAddress2', label: 'Street Address 2' },
              { key: 'city', label: 'City' },
              { key: 'state', label: 'State' },
              { key: 'zipCode', label: 'Zip Code' },
              { key: 'phoneNumber', label: 'Phone Number' },
            ].map(({ key, label }) => (
              <div key={key} style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.9rem' }}>
                  {label}
                </label>
                <input
                  name={key}
                  value={newCompanyData[key]}
                  onChange={handleNewCompanyChange}
                  style={{
                    width: '100%',
                    padding: '0.4rem',
                    fontSize: '0.9rem',
                    border: newCompanyErrors[key]
                      ? '1px solid red'
                      : '1px solid #ccc',
                    borderRadius: '0.25rem',
                  }}
                  required={key !== 'streetAddress2'}
                />
                {newCompanyErrors[key] && (
                  <div style={{ color: 'red', fontSize: '0.8rem' }}>
                    {newCompanyErrors[key]}
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setIsNewCompanyModalOpen(false)}
                style={{ padding: '0.5rem 1rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNewCompany}
                style={{ padding: '0.5rem 1rem' }}
              >
                Save Company
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Material Modal */}
      {isNewMaterialModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0, left: 0,
            width: "100%", height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "1.5rem",
              borderRadius: "0.5rem",
              width: "400px",
              maxHeight: "90%",
              overflowY: "auto",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Add New Material</h2>
            {newMaterialErrors.general && (
              <div style={{ color: "red", marginBottom: "0.5rem" }}>
                {newMaterialErrors.general}
              </div>
            )}
            {/* Material Name */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label>Material Name*<br/>
                <input
                  name="materialName"
                  value={newMaterialData.materialName}
                  onChange={handleNewMaterialChange}
                  style={{
                    width: "100%",
                    padding: "0.4rem",
                    border: newMaterialErrors.materialName
                      ? "1px solid red"
                      : "1px solid #ccc",
                    borderRadius: "0.25rem",
                  }}
                />
              </label>
              {newMaterialErrors.materialName && (
                <div style={{ color: "red", fontSize: "0.8rem" }}>
                  {newMaterialErrors.materialName}
                </div>
              )}
            </div>
            {/* Unit */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label>Unit*<br/>
                <select
                  name="unit"
                  value={newMaterialData.unit}
                  onChange={handleNewMaterialChange}
                  style={{
                    width: "100%",
                    padding: "0.4rem",
                    border: newMaterialErrors.unit
                      ? "1px solid red"
                      : "1px solid #ccc",
                    borderRadius: "0.25rem",
                  }}
                >
                  <option value="">Select unit…</option>
                  <option value="Yards">Yards</option>
                  <option value="Sqft">Sqft</option>
                </select>
              </label>
              {newMaterialErrors.unit && (
                <div style={{ color: "red", fontSize: "0.8rem" }}>
                  {newMaterialErrors.unit}
                </div>
              )}
            </div>
            {/* Min. Inv. */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label>Min. Inv.*<br/>
                <input
                  type="number"
                  name="minInv"
                  value={newMaterialData.minInv}
                  onChange={handleNewMaterialChange}
                  style={{
                    width: "100%",
                    padding: "0.4rem",
                    border: newMaterialErrors.minInv
                      ? "1px solid red"
                      : "1px solid #ccc",
                    borderRadius: "0.25rem",
                  }}
                />
              </label>
              {newMaterialErrors.minInv && (
                <div style={{ color: "red", fontSize: "0.8rem" }}>
                  {newMaterialErrors.minInv}
                </div>
              )}
            </div>
            {/* Reorder */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label>Reorder Point*<br/>
                <input
                  type="number"
                  name="reorder"
                  value={newMaterialData.reorder}
                  onChange={handleNewMaterialChange}
                  style={{
                    width: "100%",
                    padding: "0.4rem",
                    border: newMaterialErrors.reorder
                      ? "1px solid red"
                      : "1px solid #ccc",
                    borderRadius: "0.25rem",
                  }}
                />
              </label>
              {newMaterialErrors.reorder && (
                <div style={{ color: "red", fontSize: "0.8rem" }}>
                  {newMaterialErrors.reorder}
                </div>
              )}
            </div>
            {/* Cost */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label>Cost*<br/>
                <input
                  type="number"
                  step="0.01"
                  name="cost"
                  value={newMaterialData.cost}
                  onChange={handleNewMaterialChange}
                  style={{
                    width: "100%",
                    padding: "0.4rem",
                    border: newMaterialErrors.cost
                      ? "1px solid red"
                      : "1px solid #ccc",
                    borderRadius: "0.25rem",
                  }}
                />
              </label>
              {newMaterialErrors.cost && (
                <div style={{ color: "red", fontSize: "0.8rem" }}>
                  {newMaterialErrors.cost}
                </div>
              )}
            </div>
            {/* Vendor */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label>Vendor*<br/>
                <input
                  name="vendor"
                  value={newMaterialData.vendor}
                  onChange={handleNewMaterialChange}
                  style={{
                    width: "100%",
                    padding: "0.4rem",
                    border: newMaterialErrors.vendor
                      ? "1px solid red"
                      : "1px solid #ccc",
                    borderRadius: "0.25rem",
                  }}
                />
              </label>
              {newMaterialErrors.vendor && (
                <div style={{ color: "red", fontSize: "0.8rem" }}>
                  {newMaterialErrors.vendor}
                </div>
              )}
            </div>
            {/* Color */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label>Color*<br/>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="color"
                    name="color"
                    value={newMaterialData.color}
                    onChange={handleNewMaterialChange}
                    style={{
                      width: "60px",
                      height: "40px",
                      padding: "0",
                      border: newMaterialErrors.color
                        ? "1px solid red"
                        : "1px solid #ccc",
                      borderRadius: "0.25rem",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    type="text"
                    name="color"
                    value={newMaterialData.color}
                    onChange={handleNewMaterialChange}
                    placeholder="#000000"
                    style={{
                      flex: 1,
                      padding: "0.4rem",
                      border: newMaterialErrors.color
                        ? "1px solid red"
                        : "1px solid #ccc",
                      borderRadius: "0.25rem",
                    }}
                  />
                </div>
              </label>
              {newMaterialErrors.color && (
                <div style={{ color: "red", fontSize: "0.8rem" }}>
                  {newMaterialErrors.color}
                </div>
              )}
            </div>
            {/* Modal buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setIsNewMaterialModalOpen(false)}
                style={{ padding: "0.5rem 1rem" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNewMaterial}
                style={{ padding: "0.5rem 1rem" }}
              >
                Save Material
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── New Product Modal ───────────────────────────────────────── */}
      {isNewProductModalOpen && newProductName && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "1.5rem",
              borderRadius: "0.5rem",
              width: "600px",
              maxHeight: "90%",
              overflowY: "auto",
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              New Product: {newProductData.product}
            </h2>

            {/* 4-column grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",    // ← equal-width columns
                columnGap: "1rem",                        // horizontal gap
                rowGap: "0.5rem",                         // vertical gap between rows
                alignItems:     "start",    // ← top-aligns all columns
                justifyItems:   "start",    // ← ensures each column starts flush left
              }}
            >
              {/* Column 1: Print Time & Magnets */}
              <div style={{
                display:        "grid",
                gridTemplateColumns: "max-content 4ch",
                columnGap:      "0.5ch",
                rowGap:         "0.5rem",
                alignSelf:      "start"
              }}>
                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  Print Time (min)
                </label>
                <input
                  name="printTime"
                  type="number"
                  value={newProductData.printTime || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  N Magnets
                </label>
                <input
                  name="magnetN"
                  type="number"
                  value={newProductData.magnetN || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  S Magnets
                </label>
                <input
                  name="magnetS"
                  type="number"
                  value={newProductData.magnetS || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />
              </div>

              {/* Column 2: Foam & Elastic */}
              <div style={{
                display:        "grid",
                gridTemplateColumns: "max-content 4ch",
                columnGap:      "0.5ch",
                rowGap:         "0.5rem",
                alignSelf:      "start"
              }}>
                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  ½" Foam
                </label>
                <input
                  name="foamHalf"
                  type="number"
                  value={newProductData.foamHalf || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  ⅜" Foam
                </label>
                <input
                  name="foam38"
                  type="number"
                  value={newProductData.foam38 || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  ¼" Foam
                </label>
                <input
                  name="foam14"
                  type="number"
                  value={newProductData.foam14 || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  ⅛" Foam
                </label>
                <input
                  name="foam18"
                  type="number"
                  value={newProductData.foam18 || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  ½" Elastic (in)
                </label>
                <input
                  name="elasticHalf"
                  type="number"
                  value={newProductData.elasticHalf || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />
              </div>

              {/* Column 3: Dimensions */}
              <div style={{
                display:        "grid",
                gridTemplateColumns: "max-content 4ch",
                columnGap:      "0.5ch",
                rowGap:         "0.5rem",
                alignSelf:      "start"
              }}>
                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  Length (in)
                </label>
                <input
                  name="length"
                  type="number"
                  value={newProductData.length || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  Width (in)
                </label>
                <input
                  name="width"
                  type="number"
                  value={newProductData.width || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  Depth (in)
                </label>
                <input
                  name="depth"
                  type="number"
                  value={newProductData.depth || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />
              </div>

              {/* Column 4: Pouch-Specific */}
              <div style={{
                display:        "grid",
                gridTemplateColumns: "max-content 4ch",
                columnGap:      "0.5ch",
                rowGap:         "0.5rem",
                alignSelf:      "start"
              }}>
                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  1/4" Black Grommets
                </label>
                <input
                  name="blackGrommets"
                  type="number"
                  value={newProductData.blackGrommets || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  Paracord (ft)
                </label>
                <input
                  name="paracordFt"
                  type="number"
                  value={newProductData.paracordFt || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />

                <label style={{ fontSize:"0.85rem", whiteSpace:"nowrap" }}>
                  Cord Stoppers
                </label>
                <input
                  name="cordStoppers"
                  type="number"
                  value={newProductData.cordStoppers || ""}
                  onChange={handleNewProductChange}
                  required
                  style={{ width:"4ch", padding:"0.25rem", fontSize:"0.85rem" }}
                />
              </div>
            </div>
            {/* end grid */}

            {/* Buttons inside white box */}
            <div style={{ textAlign: "right", marginTop: "1rem" }}>
              <button
                type="button"
                onClick={() => {
                  if (modalSubmitting) return;
                  setIsNewProductModalOpen(false);
                  setNewProductName("");
                }}
                style={{ marginRight: "0.5rem", padding: "0.5rem 1rem" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={modalSubmitting}
                onClick={async () => {
                  if (modalSubmitting) return;
                  setModalSubmitting(true);
                  const {
                    product,
                    printTime,
                    foamHalf,
                    foam38,
                    foam14,
                    foam18,
                    magnetN,
                    magnetS,
                    elasticHalf,
                    length,
                    width,
                    depth,
                    blackGrommets,
                    paracordFt,
                    cordStoppers,
                  } = newProductData;
                  const volume = length * width * depth;
                  const perYard = Math.floor((36 / length) * (55 / width));
                  const tablePayload = {
                    product,
                    printTime,
                    perYard,
                    foamHalf,
                    foam38,
                    foam14,
                    foam18,
                    magnetN,
                    magnetS,
                    elasticHalf,
                    volume,
                    blackGrommets,
                    paracordFt,
                    cordStoppers,
                  };
                  try {
                    await axios.post(
                      `${process.env.REACT_APP_API_ROOT}/table`,
                      tablePayload,
                      { withCredentials: true }
                    );
                    alert("Product successfully added");
                    setProducts(prev => [...prev, newProductData.product]);

                    setForm(prev => ({ ...prev, product: newProductData.product }));
                    setIsNewProductModalOpen(false);
                    setNewProductName("");
                  } catch (err) {
                    console.error("Modal workflow error:", err);
                    alert("Failed to add product. Check console.");
                  } finally {
                    setModalSubmitting(false);
                  }
                }}
                style={{ padding: "0.5rem 1rem" }}
              >
                {modalSubmitting ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading bar */}
      {isSubmitting && (
        <progress className="upload-progress"
          max="100"
          value={uploadProgress}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "8px",
            appearance: "none",
            WebkitAppearance: "none"
          }}
        />
      )}
      {isPrefilling && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(255, 255, 150, 0.3)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.5rem",
          fontWeight: "bold",
          color: "#444"
        }}>
          🔄 Loading previous order files...
        </div>
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "0.5rem",
          padding: "0.5rem",
          fontFamily: "sans-serif",
          fontSize: "0.85rem",
        }}
      >

        {/* ─── Reorder Modal ──────────────────────────── */}
        {isReorderModalOpen && (
          <div style={{
            position: "fixed", top: 0, left: 0,
            width: "100%", height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000
          }}>
            <div style={{
              background: "#fff",
              padding: "1rem",
              borderRadius: "0.5rem",
              width: "320px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.2)"
            }}>
              <h3 style={{ margin: 0, marginBottom: "0.5rem" }}>Reorder Previous Job</h3>

              <label>Previous Order #</label>
              <input
                type="text"
                value={reorderData.previousOrder}
                onChange={(e) =>
                  setReorderData((d) => ({ ...d, previousOrder: e.target.value }))
                }
              />

              <label>New Due Date</label>
              <input
                type="date"
                value={reorderData.newDueDate}
                onChange={(e) =>
                  setReorderData((d) => ({ ...d, newDueDate: e.target.value }))
                }
              />

              {/* Quick-select buttons */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                {[6, 7, 8].map((weeks) => (
                  <button
                    type="button"
                    key={weeks}
                    onClick={() =>
                      setReorderData((d) => ({
                        ...d,
                        newDueDate: new Date(
                          Date.now() + weeks * 7 * 24 * 60 * 60 * 1000
                        )
                          .toISOString()
                          .split("T")[0],
                      }))
                    }
                  >
                    {weeks} weeks
                  </button>
                ))}
              </div>

              <label>Due Type</label>
              <select
                value={reorderData.newDateType}
                onChange={(e) =>
                  setReorderData((d) => ({ ...d, newDateType: e.target.value }))
                }
              >
                <option>Hard Date</option>
                <option>Soft Date</option>
              </select>

              <label>Notes</label>
              <textarea
                value={reorderData.notes}
                onChange={(e) =>
                  setReorderData((d) => ({ ...d, notes: e.target.value }))
                }
              />

              {/* ✅ Always-visible Preview Section */}
              <div style={{ marginBottom: "1rem" }}>
                <label>Preview:</label><br />
                <div
                  style={{
                    width: "100%",
                    height: "160px",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: "0.5rem",
                    background: "#f9f9f9"
                  }}
                >
                  {reorderData.previewUrl ? (
                    <img
                      src={reorderData.previewUrl}
                      alt="Preview"
                      style={{
                        maxHeight: "100%",
                        maxWidth: "100%",
                        objectFit: "contain",
                        borderRadius: "4px"
                      }}
                    />
                  ) : (
                    <span style={{ color: "#888", fontStyle: "italic" }}>No preview yet</span>
                  )}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => setIsReorderModalOpen(false)}
                  style={{ marginRight: "0.5rem", padding: "0.25rem 0.5rem" }}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  onClick={(e) => handleReorderSubmit(e)}
                  disabled={
                    !reorderData.previousOrder ||
                    !reorderData.newDueDate ||
                    !reorderData.newDateType
                  }
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}


        <div style={{ gridColumn: "2 / 3", textAlign: "right", marginBottom: "0.5rem" }}>
          <button
            type="button"
            onClick={() => navigate("/reorder")}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.8rem",
              background: "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "3px",
              cursor: "pointer",
            }}
          >
            Reorder Previous Job
          </button>
        </div>
        {/* LEFT COLUMN */}
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {/* Order Details */}
          <fieldset style={{ padding: "0.5rem" }}>
            <legend>Order Details</legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "0.5rem",
              }}
            >            
            {/* COMPANY INLINE TYPE-AHEAD */}
            <div style={{ marginBottom: "0.5rem", position: "relative" }}>
              <label style={{ display: "block" }}>
                Company Name*
                {companyInvalid && <span style={{ color: "red", marginLeft: "4px" }}>🚩</span>}
                <br />
                <input
                  ref={companyInputRef}
                  name="company"
                  placeholder="Company Name*"
                  required
                  autoComplete="off"
                  style={{ width: "80%", fontSize: "0.85rem", padding: "0.25rem" }}
                  onChange={handleCompanyInput}
                  value={form.company}
                  list="os-company-list"
                />
                </label>
            </div>

            <div>
              <label>
                Design Name*<br />
                <input
                  name="designName"
                  value={form.designName}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
              </label>
            </div>
            <div>
              <label>
                Quantity*<br />
                <input
                  name="quantity"
                  type="number"
                  value={form.quantity}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
              </label>
            </div>
            {/* PRODUCT INLINE TYPE-AHEAD */}
            <div style={{ marginBottom: "0.5rem", position: "relative" }}>
              <label style={{ display: "block" }}>
                Product*
                {productInvalid && <span style={{ color: "red", marginLeft: "4px" }}>🚩</span>}
                <br />
                <input
                  ref={productInputRef}
                  name="product"
                  placeholder="Product*"
                  required
                  autoComplete="off"
                  style={{ width: "80%", fontSize: "0.85rem", padding: "0.25rem" }}
                  onChange={handleProductInput}
                  value={form.product}
                  list="os-product-list"
                />
                </label>
                {/* datalist moved to global section at bottom */}
            </div>
            <div>
              <label>
                Price*<br />
                <input
                  name="price"
                  type="number"
                  value={form.price}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
              </label>
            </div>
            <div>
              <label>
                Due Date*<br/>
                <input
                  name="dueDate"
                  type="date"
                  value={form.dueDate}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
                <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.5rem" }}>
                  <button type="button" onClick={() => setDueDateWeeks(6)}>
                    6 Weeks
                  </button>
                  <button type="button" onClick={() => setDueDateWeeks(7)}>
                    7 Weeks
                  </button>
                  <button type="button" onClick={() => setDueDateWeeks(8)}>
                    8 Weeks
                  </button>
                </div>
              </label>
            </div>

            <div>
              <label>
                Hard/Soft Date*<br />
                <select
                  name="dateType"
                  value={form.dateType}
                  onChange={handleChange}
                  style={{ width: "80%" }}
                >
                  <option>Hard Date</option>
                  <option>Soft Date</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                Referral<br />
                <input
                  name="referral"
                  value={form.referral}
                  onChange={handleChange}
                  style={{ width: "80%" }}
                />
              </label>
            </div>
          </div>
        </fieldset>

        {/* Materials */}
        <fieldset style={{ padding: "1rem", marginBottom: "2rem" }}>
          <legend style={{ marginBottom: "1rem", fontSize: "1.1rem", fontWeight: 600 }}>
            Materials
            {materialsInvalid && <span style={{ color: "red", marginLeft: "0.5rem" }}>🚩</span>}
          </legend>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "1rem",
            }}
          >
            {/* Left: Material 1–3 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    ref={(el) => (materialInputRefs.current[i] = el)}
                    type="text"
                    placeholder={`Material ${i + 1}${i === 0 ? "*" : ""}`}
                    value={form.materials[i]}
                    onChange={handleMaterialInput(i)}
                    list="os-material-list"
                    autoComplete="off"
                    required={i === 0}
                    style={{ flex: 1, padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                  <input
                    type="number"
                    placeholder="%"
                    value={form.materialPercents[i] || ""}
                    onChange={(e) => handleMaterialPercentChange(i, e.target.value)}
                    min="0"
                    max="100"
                    style={{
                      width: "3rem",
                      padding: "0.5rem",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      textAlign: "right",
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Middle: Material 4–5 + Back Material */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[3, 4].map((i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    ref={(el) => (materialInputRefs.current[i] = el)}
                    type="text"
                    placeholder={`Material ${i + 1}`}
                    value={form.materials[i]}
                    onChange={handleMaterialInput(i)}
                    list="os-material-list"
                    autoComplete="off"
                    style={{ flex: 1, padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                  <input
                    type="number"
                    placeholder="%"
                    value={form.materialPercents[i] || ""}
                    onChange={(e) => handleMaterialPercentChange(i, e.target.value)}
                    min="0"
                    max="100"
                    style={{
                      width: "3rem",
                      padding: "0.5rem",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      textAlign: "right",
                    }}
                  />
                </div>
              ))}

              {/* Back Material (placeholder-only label, required iff Product contains "full") */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <input
                  ref={backMaterialRef}
                  id="backMaterial"
                  type="text"
                  placeholder={`Back Material${form.product.toLowerCase().includes("full") ? "*" : ""}`}
                  value={form.backMaterial}
                  onChange={handleBackMaterialInput}
                  list="os-material-list"
                  autoComplete="off"
                  required={form.product.toLowerCase().includes("full")}
                  style={{ padding:"0.5rem", border:"1px solid #ccc", borderRadius:"4px" }}
                />
              </div>
            </div>

            {/* Right: EMB Backing & Fur Color */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <select
                  id="embBacking"
                  name="embBacking"
                  value={form.embBacking}
                  onChange={handleChange}
                  required
                  style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                >
                  <option value="">EMB Backing*</option>
                  <option value="Cut Away">Cut Away</option>
                  <option value="Tear Away">Tear Away</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                <input
                  ref={furColorRef}
                  id="furColor"
                  type="text"
                  placeholder="Fur Color*"
                  value={form.furColor}
                  onChange={handleFurColorInput}
                  list="os-material-list"
                  autoComplete="off"
                  required
                  style={{ padding:"0.5rem", border:"1px solid #ccc", borderRadius:"4px" }}
                />
              </div>
            </div>
          </div>

        </fieldset>
        {/* Additional Info + Files */}
        <fieldset style={{ padding: "0.5rem" }}>
          <legend>Additional Info</legend>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div>
              <label>
                Notes<br />
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows={2}
                  style={{ width: "80%" }}
                />
              </label>
            </div>
            <div
              style={{
                textAlign: "center",
                display: "flex",
                gap: "1rem",
                justifyContent: "center",
              }}
            >
              <button
                type="submit"
                style={{ marginTop: "0.5rem", padding: "0.5rem 1rem" }}
              >
                {isSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </fieldset>
      </div>

      {/* RIGHT COLUMN: Uploads + Previews */}
      <div style={{ display: "grid", gap: "0.5rem" }}>
        {/* ── Production Upload + Preview ─────────────────────────────── */}
        <div>
          <h3 style={{ margin: "0.25rem 0" }}>Production Files</h3>
          <input
            type="file"
            multiple
            required={!form.isReorder}
            onChange={(e) => handleFileChange(e, setProdFiles, setProdPreviews, prodPreviewUrlsRef)}
            style={{ marginBottom: "0.5rem" }}
          />
          <div style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            {prodFiles.map((f) => f.name).join(", ")}
          </div>

          <fieldset style={{ padding: "0.5rem", height: "50%" }}>
            <legend>Production Preview</legend>
            <div style={{ overflow: "auto", height: "100%" }}>
              {prodPreviews.map((p, i) => (
                <div key={i} style={{ position: "relative", marginBottom: "0.25rem" }}>
                  <button
                    type="button"
                    onClick={() => removeProdFile(i)}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "1rem",
                      lineHeight: 1,
                    }}
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                  {p.type.startsWith("image/") ? (
                    <img
                      src={p.url}
                      alt={p.name}
                      style={{ maxWidth: "100%", maxHeight: 80 }}
                    />
                  ) : p.type === "application/pdf" ? (
                    <iframe
                      src={p.url}
                      title={p.name}
                      style={{ width: "100%", height: 80 }}
                    />
                  ) : (
                    <div style={{ fontSize: "0.8rem" }}>📄 {p.name}</div>
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        </div>

        {/* ── Print Upload + Preview ──────────────────────────────────── */}
        <div>
          <h3 style={{ margin: "0.25rem 0" }}>Print Files</h3>
          <input
            type="file"
            multiple
            onChange={(e) => handleFileChange(e, setPrintFiles, setPrintPreviews, printPreviewUrlsRef)}
            style={{ marginBottom: "0.5rem" }}
          />
          <div style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            {printFiles.map((f) => f.name).join(", ")}
          </div>

          <fieldset style={{ padding: "0.5rem", height: "50%" }}>
            <legend>Print Preview</legend>
            <div style={{ overflow: "auto", height: "100%" }}>
              {printPreviews.map((p, i) => (
                <div key={i} style={{ position: "relative", marginBottom: "0.25rem" }}>
                  <button
                    type="button"
                    onClick={() => removePrintFile(i)}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "1rem",
                      lineHeight: 1,
                    }}
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                  {p.type.startsWith("image/") ? (
                    <img
                      src={p.url}
                      alt={p.name}
                      style={{ maxWidth: "100%", maxHeight: 80 }}
                    />
                  ) : p.type === "application/pdf" ? (
                    <iframe
                      src={p.url}
                      title={p.name}
                      style={{ width: "100%", height: 80 }}
                    />
                  ) : (
                    <div style={{ fontSize: "0.8rem" }}>📄 {p.name}</div>
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
      {/* ───────────────── Global datalists (stable mount) ───────────────── */}
      <datalist id="os-company-list">
        {companyNames.map((c) => <option key={c} value={c} />)}
      </datalist>

      <datalist id="os-product-list">
        {productNames.map((p) => <option key={p} value={p} />)}
      </datalist>

      <datalist id="os-material-list">
        {materialNames.map((m) => <option key={m} value={m} />)}
      </datalist>
      {/* ─────────────────────────────────────────────────────────────────── */}
    </form>  
  </>      
);               
}  