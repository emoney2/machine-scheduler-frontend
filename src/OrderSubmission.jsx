import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./FileInput.css";
import { useLocation } from "react-router-dom";
import { useNavigate } from "react-router-dom";

const API_ROOT = process.env.REACT_APP_API_ROOT;

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
    backMaterial: "",
    embBacking: "",
    furColor: "",
    notes: "",
  });

  const [prodFiles, setProdFiles] = useState([]);
  const [printFiles, setPrintFiles] = useState([]);
  const [prodPreviews, setProdPreviews] = useState([]);
  const [printPreviews, setPrintPreviews] = useState([]);
  const location = useLocation();
  const reorderJob = location.state?.reorderJob;
  const navigate = useNavigate();

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
  const [furColors, setFurColors] = useState([]);
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


  const extractDriveThumbnail = (link) => {
    let fileId = "";
    if (link.includes("id=")) {
      fileId = link.split("id=")[1].split("&")[0];
    } else if (link.includes("/file/d/")) {
      fileId = link.split("/file/d/")[1].split("/")[0];
    }
    return fileId ? `https://drive.google.com/thumbnail?id=${fileId}` : "";
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

  // when user types, update form.product and show inline suggestion
  const handleProductInput = (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;

    // allow deletes/backspace
    if (inputType?.startsWith("delete")) {
      setForm((prev) => ({ ...prev, product: raw }));
      return;
    }

    // attempt inline completion
    const match = productNames.find((p) =>
      p.toLowerCase().startsWith(raw.toLowerCase())
    );

    if (match && raw !== match) {
      // show the full match
      setForm((prev) => ({ ...prev, product: match }));
      // select just the appended part after React updates
      setTimeout(() => {
        const input = productInputRef.current;
        input.setSelectionRange(raw.length, match.length);
      }, 0);
    } else {
      // no match or exact match: just store raw
      setForm((prev) => ({ ...prev, product: raw }));
    }
  };

    // If the user is deleting, just store the raw value and bail out
    if (inputType && inputType.startsWith("delete")) {
      setForm((prev) => ({ ...prev, company: raw }));
      return;
    }

    // Otherwise attempt inline completion
    const match = companyNames.find((c) =>
      c.toLowerCase().startsWith(raw.toLowerCase())
    );

    if (match && raw !== match) {
      // put the full match into state so the input shows it
      setForm((prev) => ({ ...prev, company: match }));

      // then schedule selecting only the appended portion
      setTimeout(() => {
        const input = companyInputRef.current;
        input.setSelectionRange(raw.length, match.length);
      }, 0);
    } else {
      // no suggestion or exact match: just store the raw input
      setForm((prev) => ({ ...prev, company: raw }));
    }
  };

  // ─── PRODUCT inline‐typeahead ─────────────────────────────────
  const handleProductInput = (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;

    // handle backspace/delete just by storing raw
    if (inputType?.startsWith("delete")) {
      setForm((prev) => ({ ...prev, product: raw }));
      return;
    }

    // otherwise try to autocomplete
    const match = productNames.find((p) =>
      p.toLowerCase().startsWith(raw.toLowerCase())
    );
    if (match && raw !== match) {
      setForm((prev) => ({ ...prev, product: match }));
      // highlight only the appended text
      setTimeout(() => {
        const input = productInputRef.current;
        input.setSelectionRange(raw.length, match.length);
      }, 0);
    } else {
      setForm((prev) => ({ ...prev, product: raw }));
    }
  };

// ─── MATERIAL inline‐typeahead ─────────────────────────────────
const handleMaterialInput = (idx) => (e) => {
  const raw = e.target.value;
  const inputType = e.nativeEvent?.inputType;

  // on delete/backspace, just store raw
  if (inputType?.startsWith("delete")) {
    const newM = [...form.materials];
    newM[idx] = raw;
    setForm(prev => ({ ...prev, materials: newM }));
    return;
  }

  // otherwise try to complete
  const match = materialNames.find(m =>
    m.toLowerCase().startsWith(raw.toLowerCase())
  );
  if (match && raw !== match) {
    const newM = [...form.materials];
    newM[idx] = match;
    setForm(prev => ({ ...prev, materials: newM }));
    // highlight the appended text
    setTimeout(() => {
      const input = materialInputRefs.current[idx];
      input.setSelectionRange(raw.length, match.length);
    }, 0);
  } else {
    const newM = [...form.materials];
    newM[idx] = raw;
    setForm(prev => ({ ...prev, materials: newM }));
  }
};

// ─── BACK MATERIAL inline‐typeahead ─────────────────────────────
const handleBackMaterialInput = (e) => {
  const raw = e.target.value;
  const inputType = e.nativeEvent?.inputType;

  // allow backspace/delete
  if (inputType?.startsWith("delete")) {
    setForm(prev => ({ ...prev, backMaterial: raw }));
    return;
  }

  // otherwise try to complete
  const match = materialNames.find(m =>
    m.toLowerCase().startsWith(raw.toLowerCase())
  );
  if (match && raw !== match) {
    setForm(prev => ({ ...prev, backMaterial: match }));
    // highlight the appended text
    setTimeout(() => {
      const input = backMaterialRef.current;
      input.setSelectionRange(raw.length, match.length);
    }, 0);
  } else {
    setForm(prev => ({ ...prev, backMaterial: raw }));
  }
};

  // ─── FUR COLOR inline‐typeahead ────────────────────────────────
  const handleFurColorInput = (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;

    // on delete/backspace, store raw
    if (inputType?.startsWith("delete")) {
      setForm((prev) => ({ ...prev, furColor: raw }));
      return;
    }

    // try to autocomplete from materialNames
    const match = materialNames.find((m) =>
      m.toLowerCase().startsWith(raw.toLowerCase())
    );
    if (match && raw !== match) {
      setForm((prev) => ({ ...prev, furColor: match }));
      // highlight appended text
      setTimeout(() => {
        const input = furColorRef.current;
        input.setSelectionRange(raw.length, match.length);
      }, 0);
    } else {
      setForm((prev) => ({ ...prev, furColor: raw }));
    }
  };

  useEffect(() => {
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/directory`)
      .then((res) => {
        console.log("Directory response:", res.data);
        const opts = res.data
          .map((c) => ({ value: c, label: c }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setCompanies(opts);
      })
      .catch((err) => {
        console.error("Failed to load companies:", err);
      });
  }, []);

   // ─── Fetch products ────────────────────────────────────────────────
   useEffect(() => {
     axios
       .get(`${process.env.REACT_APP_API_ROOT}/products`)
       .then((res) => setProducts(res.data))
       .catch((err) => console.error("Failed to load products:", err));
   }, []);

  // ─── Fetch materials inventory from Sheet ──────────────────────
  useEffect(() => {
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/materials`)
      .then(res => setMaterialsInv(res.data))
      .catch(err => console.error("Failed to load materials:", err));
  }, []);

  // ─── Fetch fur colors from API ───────────────────────────────────
  useEffect(() => {
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/fur-colors`)
      .then(res => setFurColors(res.data))
      .catch(err => console.error("Failed to load fur colors:", err));
  }, []);

// make array of just the names for matching
const furColorNames = furColors;

  // for matching
  const materialNames = materialsInv;

  // prepare simple array of names
  const companyNames = companies.map((opt) => opt.value);

  const productNames = products;


  // remove the production file + its preview at index i
  const removeProdFile = (i) => {
    setProdFiles((prevFiles) => {
      const newFiles = prevFiles.filter((_, idx) => idx !== i);

      // Adjust designName:  
      // • if we still have files, use the first one  
      // • otherwise clear it
      if (newFiles.length > 0) {
        let name = newFiles[0].name.replace(/\.[^/.]+$/, "");
        if (name.length > 12) name = name.slice(0, 12) + "..";
        setForm((prev) => ({ ...prev, designName: name }));
      } else {
        setForm((prev) => ({ ...prev, designName: "" }));
      }

      return newFiles;
    });

    // remove its preview
    setProdPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  // remove the print file + its preview at index i
  const removePrintFile = (i) => {
    setPrintFiles((f) => f.filter((_, idx) => idx !== i));
    setPrintPreviews((p) => p.filter((_, idx) => idx !== i));
  };


  const submitUrl =
    process.env.REACT_APP_ORDER_SUBMIT_URL ||
    `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/submit`;

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

  const createPreviews = (files) =>
    files.map((f) => ({ url: URL.createObjectURL(f), type: f.type, name: f.name }));

  const handleFileChange = (e, setter, previewSetter) => {
    const files = Array.from(e.target.files);
    setter(prev => [...prev, ...files]);
    previewSetter(prev => [...prev, ...createPreviews(files)]);

    // only set designName on very first production-file upload
    if (
      setter === setProdFiles &&
      prodFiles.length === 0 &&      // no files were there before
      files.length > 0
    ) {
      let name = files[0].name.replace(/\.[^/.]+$/, "");
      if (name.length > 12) name = name.slice(0, 12) + "..";
      setForm(prev => ({ ...prev, designName: name }));
    }
  };

// ─── UPDATED handleSubmit ───────────────────────────────────────
const handleSubmit = async (e) => {
  console.log("🛎️ handleSubmit called");
  console.log("🛎️ isReorder:", form.isReorder);
  e.preventDefault();

  // ⛔ Skip all validation if this is a reorder
  if (form.isReorder) {
    return submitForm();  // moved core logic to a new helper
  }

  // 1) Company check
  const companyLower = form.company.trim().toLowerCase();
  const knownCompanies = companies.map(c => c.value.toLowerCase());
  if (!knownCompanies.includes(companyLower)) {
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
    alert("Unable to verify product list. Please try again later.");
    return;
  }
  const existingProducts = table
    .map(r => r.Products?.toString().trim().toLowerCase())
    .filter(Boolean);
  const requested = form.product.trim().toLowerCase();
  if (!existingProducts.includes(requested)) {
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
    // determine which field is missing
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

  // ✅ If everything checks out, submit
  return submitForm();
};

// 🔧 Shared submission logic for normal orders and reorders
const submitForm = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  console.log("🛎️ submitForm called");

  const fd = new FormData();

  // Append form fields
  Object.entries(form).forEach(([key, value]) => {
    if (key === "materials") {
      value.forEach(m => fd.append("materials", m));
    } else {
      fd.append(key, value);
    }
  });

  // 🧪 Append prodFiles
  if (prodFiles.length > 0) {
    prodFiles.forEach((f, i) => {
      const safeFile = new File([f], f.name, { type: f.type || "application/octet-stream" });
      fd.append("prodFiles", safeFile);
      console.log(`📦 Added prodFile[${i}]:`, safeFile.name, safeFile.size, safeFile.type);
    });
  } else if (!form.isReorder) {
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

  if (!fd.has("prodFiles")) {
    console.error("❌ No prodFiles in FormData");
  }

  setIsSubmitting(true);

  try {
    const submitUrl =
      process.env.REACT_APP_ORDER_SUBMIT_URL ||
      `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/submit`;

    const config = {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        const pct = Math.round((e.loaded * 100) / e.total);
        setUploadProgress(pct);
      }
    };

    await axios.post(submitUrl, fd, config);

    alert("Order submitted!");

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
      backMaterial: "",
      embBacking: "",
      furColor: "",
      notes: "",
    });
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
    // validate name, unit, minInv, reorder, cost
    const required = ["materialName", "unit", "minInv", "reorder", "cost"];
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
      console.log("📋 Prefilling form from reorder job:", reorderJob);
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
          fetch(`${process.env.REACT_APP_API_ROOT}/list-folder-files?folderId=${prodFolderId}`)
            .then(res => res.json())
            .then(async (data) => {
              if (!Array.isArray(data.files)) {
                console.warn("❗ Invalid response from backend for production files:", data);
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
                  previews.push({
                    url: URL.createObjectURL(blob),
                    type: blob.type,
                    name: fileMeta.name,
                  });
                } catch (err) {
                  console.error("❌ Failed to download production file:", fileMeta.name, err);
                }
              }
              setProdPreviews(previews);
              setProdFiles(files);
            })
            .catch(err => {
              console.error("❌ Failed to list production folder contents:", err);
            });
        }
      } else if (reorderJob["Image"] && reorderJob["Image"].includes("drive.google.com/file")) {
        // handle single production file
        const fileIdMatch = reorderJob["Image"].match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        const fileId = fileIdMatch ? fileIdMatch[1] : null;

        if (!fileId) {
          console.warn("❗ Invalid production file link:", reorderJob["Image"]);
        } else {
          // fetch metadata to get file name
          fetch(`${process.env.REACT_APP_API_ROOT}/drive-file-metadata?fileId=${fileId}`)
            .then(res => res.json())
            .then(meta => {
              const filename = meta?.name || "Production File";
              const downloadUrl = `${process.env.REACT_APP_API_ROOT}/proxy-drive-file?fileId=${fileId}`;
              return fetch(downloadUrl)
                .then(r => r.blob())
                .then(blob => {
                  const file = new File([blob], filename, {
                    type: blob.type || "application/octet-stream",
                  });

                  setProdFiles([file]);
                  setProdPreviews([{
                    url: URL.createObjectURL(blob),
                    type: blob.type,
                    name: filename,
                  }]);
                });
            })
            .catch(err => {
              console.error("❌ Failed to fetch or download single production file:", err);
            });
        }
      }

      if (reorderJob["Print Files"] && reorderJob["Print Files"].includes("/folders/")) {
        const folderUrl = reorderJob["Print Files"];
        const match = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        const folderId = match ? match[1] : null;

        if (!folderId) {
          console.warn("❗ Invalid folder link:", folderUrl);
          return;
        }

        // Call backend to list files in folder
        fetch(`${process.env.REACT_APP_API_ROOT}/list-folder-files?folderId=${folderId}`)
          .then(res => res.json())
          .then(async (data) => {
            if (!Array.isArray(data.files)) {
              console.warn("❗ Invalid response from backend for folder contents", data);
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
                previews.push({
                  url: URL.createObjectURL(blob),
                  type: blob.type,
                  name: fileMeta.name,
                });
              } catch (err) {
                console.error("❌ Failed to download print file:", fileMeta.name, err);
              }
            }

            setPrintFiles(files);
            setPrintPreviews(previews);
          })
          .catch(err => {
            console.error("❌ Failed to list folder contents:", err);
          });
      } else {
        console.warn("❗ Skipping print file fetch — no folder link:", reorderJob["Print Files"]);
      }
    }
  }, [reorderJob]);

  return (
    <>

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
                {companyInvalid && (
                  <span style={{ color: "red", marginLeft: "4px" }}>🚩</span>
                )}
                <br />
                <input
                  ref={companyInputRef}
                  name="company"
                  placeholder="Company Name*"
                  required
                  autoComplete="off"
                  style={{
                    width: "80%",
                    fontSize: "0.85rem",
                    padding: "0.25rem",
                  }}
                  onChange={handleCompanyInput}
                  value={form.company}
                  list="company-list"
                />
              </label>
              <datalist id="company-list">
                {companyNames.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label>
                Design Name*<br />
                <input
                  name="designName"
                  value={form.designName}
                  readOnly
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
                {productInvalid && (
                  <span style={{ color: "red", marginLeft: "4px" }}>🚩</span>
                )}
                <br />
                <input
                  ref={productInputRef}
                  name="product"
                  placeholder="Product*"
                  required
                  autoComplete="off"
                  style={{
                    width: "80%",
                    fontSize: "0.85rem",
                    padding: "0.25rem",
                  }}
                  onChange={handleProductInput}
                  value={form.product}
                  list="product-list"
                />
              </label>
              <datalist id="product-list">
                {productNames.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
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
        <fieldset style={{ padding: "0.5rem" }}>
          <legend>
            Materials
            {materialsInvalid && (
              <span style={{ color: "red", marginLeft: "4px" }}>🚩</span>
            )}
          </legend>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.5rem",
            }}
          >
            {form.materials.map((m, i) => (
              <div key={i}>
                <label>
                  Material {i + 1}{i === 0 && "*"}<br />
                  <input
                    ref={el => (materialInputRefs.current[i] = el)}
                    name={`materials[${i}]`}
                    value={form.materials[i]}
                    onChange={handleMaterialInput(i)}
                    list="material-list"
                    autoComplete="off"
                    required={i === 0}
                    style={{ width: "80%", fontSize: "0.85rem", padding: "0.25rem" }}
                  />
                </label>
              </div>
            ))}

            {/* shared dropdown options for all Material inputs */}
            <datalist id="material-list">
              {materialNames.map((mat) => (
                <option key={mat} value={mat} />
              ))}
            </datalist>
            <div>
              <label>
                Back Material<br />
                <input
                  ref={backMaterialRef}
                  name="backMaterial"
                  value={form.backMaterial}
                  onChange={handleBackMaterialInput}
                  list="material-list"
                  autoComplete="off"
                  required={form.product.toLowerCase().includes("full")}
                  style={{ width: "80%", fontSize: "0.85rem", padding: "0.25rem" }}
                />
              </label>
            </div>
            <div>
              <label>
                EMB Backing*<br/>
                <select
                  name="embBacking"
                  value={form.embBacking}
                  onChange={handleChange}
                  required
                  style={{ width: "80%", fontSize: "0.85rem", padding: "0.25rem" }}
                >
                  <option value="">Select backing…</option>
                  <option value="Cut Away">Cut Away</option>
                  <option value="Tear Away">Tear Away</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                Fur Color*<br />
                <input
                  ref={furColorRef}
                  name="furColor"
                  placeholder="Fur Color*"
                  value={form.furColor}
                  onChange={handleFurColorInput}
                  list="material-list"
                  autoComplete="off"
                  required
                  style={{ width: "80%", fontSize: "0.85rem", padding: "0.25rem" }}
                />
              </label>
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
            required
            onChange={(e) => handleFileChange(e, setProdFiles, setProdPreviews)}
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
            onChange={(e) => handleFileChange(e, setPrintFiles, setPrintPreviews)}
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

    </form>  
  </>      
);               
}  