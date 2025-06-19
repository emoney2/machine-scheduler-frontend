import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./FileInput.css";


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

  const [printTime,    setPrintTime]    = useState("");
  const [perYard,      setPerYard]      = useState("");
  const [foamHalf,     setFoamHalf]     = useState("");
  const [foam38,       setFoam38]       = useState("");
  const [foam14,       setFoam14]       = useState("");
  const [foam18,       setFoam18]       = useState("");
  const [magnetN,      setMagnetN]      = useState("");
  const [magnetS,      setMagnetS]      = useState("");
  const [elasticHalf,  setElasticHalf]  = useState("");
  const [computedVolume, setComputedVolume] = useState("");

  // 2️⃣ – new save‐handler for your product‐specs modal
  const handleSaveProductSpecs = async () => {
    // (a) compute volume however you like; if you already have it in state, skip this
    // setComputedVolume(length * width * height);

    // (b) post everything up
    await fetch(`${process.env.REACT_APP_API_ROOT}/api/product-specs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        product:    form.product,
        printTime,    // minutes to print one
        perYard,      // how many per yard
        foamHalf,     // 1/2" foam count
        foam38,       // 3/8" foam count
        foam14,       // 1/4" foam count
        foam18,       // 1/8" foam count
        magnetN,      // N magnets count
        magnetS,      // S magnets count
        elasticHalf,  // 1/2" elastic length or count
        volume:       computedVolume
      })
    });

    // (c) close the modal
    setIsVolumeModalOpen(false);

    // (d) optional: trigger any downstream refresh or re-submit logic here
  };


  const [isVolumeModalOpen, setIsVolumeModalOpen] = useState(false);
  const [missingVolumeProduct, setMissingVolumeProduct] = useState("");
  const [dimensions, setDimensions] = useState({ length: "", width: "", height: "" });
  const [newProdSpecs, setNewProdSpecs] = useState({
    printTime: "",
    foamCounts: { half: "", threeEighth: "", quarter: "", eighth: "" },
    magnetCounts: { north: "", south: "" },
    halfFoamLength: "",
    // (you could store computedVolume here too, or derive it on-the-fly) 
  });


  const handleNewProdSpecsChange = (e) => {
    const { name, value } = e.target;
    // names like "printTime", "halfFoamLength"
    if (["printTime","halfFoamLength"].includes(name)) {
      setNewProdSpecs(prev => ({ ...prev, [name]: value }));
    }
    // foamCounts.* or magnetCounts.*
    else if (name.startsWith("foam_")) {
      const key = name.replace("foam_","");
      setNewProdSpecs(prev => ({
        ...prev,
        foamCounts: { ...prev.foamCounts, [key]: value }
      }));
    }
    else if (name.startsWith("magnet_")) {
      const key = name.replace("magnet_","");
      setNewProdSpecs(prev => ({
        ...prev,
        magnetCounts: { ...prev.magnetCounts, [key]: value }
      }));
    }
  };

  const handleNewCompanyChange = (e) => {
    const { name, value } = e.target;
    setNewCompanyData((prev) => ({ ...prev, [name]: value }));
  };

  // when user types, update form.company and show inline suggestion
  const handleCompanyInput = (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;

    // on delete/backspace, just store raw
    if (inputType?.startsWith("delete")) {
      setForm(prev => ({ ...prev, company: raw }));
      return;
    }

    // otherwise autocomplete
    const match = companyNames.find(c =>
      c.toLowerCase().startsWith(raw.toLowerCase())
    );
    if (match && raw !== match) {
      setForm(prev => ({ ...prev, company: match }));
      setTimeout(() => {
        companyInputRef.current.setSelectionRange(raw.length, match.length);
      }, 0);
    } else {
      setForm(prev => ({ ...prev, company: raw }));
    }
  };


  // ─── PRODUCT inline‐typeahead ─────────────────────────────────
  const handleProductInput = (e) => {
    const raw = e.target.value;
    const inputType = e.nativeEvent?.inputType;

    if (inputType?.startsWith("delete")) {
      setForm(prev => ({ ...prev, product: raw }));
      return;
    }

    const match = productNames.find(p =>
      p.toLowerCase().startsWith(raw.toLowerCase())
    );
    if (match && raw !== match) {
      setForm(prev => ({ ...prev, product: match }));
      setTimeout(() => {
        productInputRef.current.setSelectionRange(raw.length, match.length);
      }, 0);
    } else {
      setForm(prev => ({ ...prev, product: raw }));
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

    // Then store the volume for the product
    async function saveVolume(productName, volume) {
      const volRes = await fetch(`${process.env.REACT_APP_API_ROOT}/set-volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product: productName,
          volume,
        }),
      });

  if (!volRes.ok) {
    throw new Error("Failed to save volume");
  }

async function checkProductVolume(productName) {
  const res = await fetch(`${process.env.REACT_APP_API_ROOT}/table`, {
    credentials: "include",
  });
  const table = await res.json();
  const row = table.find(row => row.Product?.toLowerCase() === productName.toLowerCase());
  const volume = row?.Volume;
  return volume ? parseFloat(volume) : null;
}

// ─── UPDATED handleSubmit ───────────────────────────────────────
const handleSubmit = async (e) => {
  e.preventDefault();
  console.log("handleSubmit – isSubmitting before:", isSubmitting);
  if (isSubmitting) return;
  setIsSubmitting(true);

  const fd = new FormData(e.target);
  const product = fd.get("product");
  const volume = await checkProductVolume(product);

  if (!volume) {
    setMissingVolumeProduct(product);
    setIsVolumeModalOpen(true);
    setIsSubmitting(false);
    return;
  }


  try {
    // 1. Submit product data as usual
    await axios.post(submitUrl, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    // 2. Send volume if all dimensions are provided
    const product = fd.get("product");
    const len = parseFloat(fd.get("length") || "");
    const wid = parseFloat(fd.get("width") || "");
    const hei = parseFloat(fd.get("height") || "");

    if (product && len && wid && hei) {
      const volume = Math.round(len * wid * hei);
      const volRes = await fetch(`${process.env.REACT_APP_API_ROOT}/set-volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ product, volume }),
      });

      if (!volRes.ok) {
        throw new Error("Failed to save volume");
      }
    }

    alert("Submitted!");
  } catch (err) {
    console.error("Error during handleSubmit:", err);
    alert("Submission failed.");
  } finally {
    setIsSubmitting(false);
  }
};

  // ─── If company not in our directory, open modal ───────────────
  if (!companyNames.includes(form.company.trim())) {
    setNewCompanyData((prev) => ({
      ...prev,
      companyName: form.company.trim(),
    }));
    setNewCompanyErrors({});
    setIsNewCompanyModalOpen(true);
    return;
  }

    // ─── If any material field is unknown, open material modal ────
    const firstUnknown = form.materials.find(
      (m) => m.trim() && !materialNames.includes(m.trim())
    );
    const backUnknown = form.backMaterial.trim() && !materialNames.includes(form.backMaterial.trim());
    const furUnknown = form.furColor.trim() && !materialNames.includes(form.furColor.trim());

    if (firstUnknown || backUnknown || furUnknown) {
      // decide which field
      if (firstUnknown) {
        const idx = form.materials.findIndex((m) => m.trim() === firstUnknown.trim());
        setModalMaterialField({ type: "materials", index: idx });
        setNewMaterialData((prev) => ({ ...prev, materialName: firstUnknown.trim() }));
      } else if (backUnknown) {
        setModalMaterialField({ type: "backMaterial" });
        setNewMaterialData((prev) => ({ ...prev, materialName: form.backMaterial.trim() }));
      } else {
        setModalMaterialField({ type: "furColor" });
        setNewMaterialData((prev) => ({ ...prev, materialName: form.furColor.trim() }));
      }
      setNewMaterialErrors({});
      setIsNewMaterialModalOpen(true);
      return;
    }

  // ─── start loading ───────────────────────────────────────────
  setIsSubmitting(true);
  try {
    // build the form payload
    const fd = new FormData();
    [
      "company",
      "designName",
      "quantity",
      "product",
      "price",
      "dueDate",
      "dateType",
      "referral",
      "backMaterial",
      "embBacking",
      "furColor",
      "notes",
    ].forEach((k) => fd.append(k, form[k] || ""));

    form.materials.forEach((m) => fd.append("materials", m));

    // ensure the designName file is first
    let filesToUpload = [...prodFiles];
    const baseName = form.designName.replace(/\.\.$/, "");
    const idx = filesToUpload.findIndex(
      (f) => f.name.replace(/\.[^/.]+$/, "") === baseName
    );
    if (idx > 0) {
      const [match] = filesToUpload.splice(idx, 1);
      filesToUpload.unshift(match);
    }

    filesToUpload.forEach((f) => fd.append("prodFiles", f));
    printFiles.forEach((f) => fd.append("printFiles", f));

    // send to server
    await axios.post(submitUrl, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    alert("Order submitted!");

    // reset form + state
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

  const saveVolumeAndResubmit = async () => {
    const { length, width, height } = dimensions;
    const volume   = Math.round(length * width * height);
    const {
      printTime,
      foamCounts,
      magnetCounts,
      halfFoamLength
    } = newProdSpecs;

    await fetch(`${process.env.REACT_APP_API_ROOT}/set-product-specs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        product:      missingVolumeProduct,
        volume,
        printTime:    Number(printTime),
        foamCounts:   {
          half:       Number(foamCounts.half),
          threeEighth:Number(foamCounts.threeEighth),
          quarter:    Number(foamCounts.quarter),
          eighth:     Number(foamCounts.eighth)
        },
        magnetCounts: {
          north:      Number(magnetCounts.north),
          south:      Number(magnetCounts.south)
        },
        halfFoamLength: Number(halfFoamLength),
        dimensions:   { length, width, height }
      })
    });

  const checkProductVolume = async (productName) => {
    const res = await fetch(`${process.env.REACT_APP_API_ROOT}/table`, {
      credentials: "include",
    });

    if (!res.ok) {
      console.error("Failed to fetch Table data");
      return null;
    }

    const table = await res.json();
    const row = table.find(row =>
      row.Product?.toLowerCase().trim() === productName.toLowerCase().trim()
    );
    const volume = row?.Volume;
    return volume ? parseFloat(volume) : null;
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


  return (
    <>
      {/* Company Modal */}
      {isNewCompanyModalOpen && (
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
            <h2 style={{ marginTop: 0 }}>Add New Company</h2>
            {newCompanyErrors.general && (
              <div style={{ color: "red", marginBottom: "0.5rem" }}>
                {newCompanyErrors.general}
              </div>
            )}
            {[ /* company fields array */ ].map(({ key, label }) => (
              <div key={key} style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.9rem" }}>
                  {label}
                </label>
                <input
                  name={key}
                  value={newCompanyData[key]}
                  onChange={handleNewCompanyChange}
                  style={{
                    width: "100%",
                    padding: "0.4rem",
                    fontSize: "0.9rem",
                    border: newCompanyErrors[key]
                      ? "1px solid red"
                      : "1px solid #ccc",
                    borderRadius: "0.25rem",
                  }}
                />
                {newCompanyErrors[key] && (
                  <div style={{ color: "red", fontSize: "0.8rem" }}>
                    {newCompanyErrors[key]}
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setIsNewCompanyModalOpen(false)}
                style={{ padding: "0.5rem 1rem" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNewCompany}
                style={{ padding: "0.5rem 1rem" }}
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
      {isVolumeModalOpen && (
        <div style={{/* existing overlay styles */}}>
          <div style={{/* existing modal box styles */}}>
            <h2>New-Product Specs: {missingVolumeProduct}</h2>

            {/* Print Time */}      
            <label>Print Time (min):
              <input
                name="printTime"
                type="number"
                value={newProdSpecs.printTime}
                onChange={handleNewProdSpecsChange}
                style={{ width: "100%", marginBottom: ".5rem" }}
              />
            </label>

            {/* Yield per Yard (computed) */}
            <div style={{ marginBottom: ".5rem" }}>
              Yield per yard:
              {dimensions.length && dimensions.width && dimensions.height
                ? Math.floor(46656 / (dimensions.length * dimensions.width * dimensions.height))
                : "–"}
            </div>

            {/* Foam counts */}
            <fieldset style={{ marginBottom: ".5rem" }}>
              <legend>Foam per piece</legend>
              {[
                ["half", "1/2\" Foam"],
                ["threeEighth", "3/8\" Foam"],
                ["quarter", "1/4\" Foam"],
                ["eighth", "1/8\" Foam"]
              ].map(([key,label]) => (
                <label key={key} style={{ display: "block", marginBottom: ".25rem" }}>
                  {label}: 
                  <input
                    name={`foam_${key}`}
                    type="number"
                    value={newProdSpecs.foamCounts[key]}
                    onChange={handleNewProdSpecsChange}
                    style={{ width: "60px", marginLeft: ".5rem" }}
                  />
                </label>
              ))}
            </fieldset>

            {/* Magnet counts */}
            <fieldset style={{ marginBottom: ".5rem" }}>
              <legend>Magnets</legend>
              {[
                ["north", "North (N) magnets"],
                ["south", "South (S) magnets"]
              ].map(([key,label]) => (
                <label key={key} style={{ display: "block", marginBottom: ".25rem" }}>
                  {label}:
                  <input
                    name={`magnet_${key}`}
                    type="number"
                    value={newProdSpecs.magnetCounts[key]}
                    onChange={handleNewProdSpecsChange}
                    style={{ width: "60px", marginLeft: ".5rem" }}
                  />
                </label>
              ))}
            </fieldset>

            {/* 1/2" foam strip length */}
            <label style={{ display: "block", marginBottom: ".5rem" }}>
              1/2" Foam strip length (in):
              <input
                name="halfFoamLength"
                type="number"
                value={newProdSpecs.halfFoamLength}
                onChange={handleNewProdSpecsChange}
                style={{ width: "100%", marginTop: ".25rem" }}
              />
            </label>

            {/* Dimensions */}
            <fieldset style={{ marginBottom: ".5rem" }}>
              <legend>Dimensions (in)</legend>
              {["length","width","height"].map(dim => (
                <label key={dim} style={{ display: "block", marginBottom: ".25rem" }}>
                  {dim.charAt(0).toUpperCase()+dim.slice(1)}:
                  <input
                    type="number"
                    value={dimensions[dim]}
                    onChange={e => setDimensions(d => ({ ...d, [dim]: e.target.value }))}
                    style={{ width: "100%", marginTop: ".25rem" }}
                  />
                </label>
              ))}
            </fieldset>

            {/* Actions */}
            <div style={{ textAlign: "right", marginTop: "1rem" }}>
              <button onClick={() => setIsVolumeModalOpen(false)} style={{ marginRight: ".5rem" }}>
                Cancel
              </button>
              <button onClick={saveVolumeAndResubmit}>
                Save Specs & Resubmit
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Loading bar */}
      {isSubmitting && (
        <progress
          style={{
            position: "fixed",
            top: 0, left: 0,
            width: "100%", height: "4px",
            zIndex: 1001,
          }}
        />
      )}

      <form
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
            >            {/* COMPANY INLINE TYPE-AHEAD */}
            <div style={{ marginBottom: "0.5rem", position: "relative" }}>
              <label style={{ display: "block" }}>
                Company Name*<br />
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
              {/* fallback dropdown list for clicking */}
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
                Product*<br />
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
          <legend>Materials</legend>
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
            <div style={{ textAlign: "center" }}>
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