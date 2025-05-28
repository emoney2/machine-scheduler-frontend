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

const handleSubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData();

  // append scalar fields
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

  // append materials
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

  // append production files in the new order
  filesToUpload.forEach((f) => fd.append("prodFiles", f));

  // append print files
  printFiles.forEach((f) => fd.append("printFiles", f));

  try {
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
  }
};


  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        gap: "0.5rem",        // tighter gaps
        padding: "0.5rem",    // reduced padding
        fontFamily: "sans-serif",
        fontSize: "0.85rem",  // slightly smaller text
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
          >
            {/* COMPANY INLINE TYPE-AHEAD */}
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
                Due Date*<br />
                <input
                  name="dueDate"
                  type="date"
                  value={form.dueDate}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
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
                  style={{ width: "80%", fontSize: "0.85rem", padding: "0.25rem" }}
                />
              </label>
            </div>
            <div>
              <label>
                EMB Backing*<br />
                <input
                  name="embBacking"
                  value={form.embBacking}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
              </label>
            </div>
            <div>
              <label>
                Fur Color*<br />
                <input
                  name="furColor"
                  value={form.furColor}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
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
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                Production File(s)*
                <input
                  type="file"
                  multiple
                  required
                  onChange={(e) => handleFileChange(e, setProdFiles, setProdPreviews)}
                  style={{
                    width: "auto",       // shrink input to its intrinsic width (just the button)
                    overflow: "hidden"   // hide any filename text that would overflow
                  }}
                />
                <span style={{ fontSize: "0.85rem" }}>
                  {prodFiles.map((f) => f.name).join(", ")}
                </span>
              </label>
            </div>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                Print File(s)
                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFileChange(e, setPrintFiles, setPrintPreviews)}
                  style={{
                    width: "auto",
                    overflow: "hidden"
                  }}
                />
                <span style={{ fontSize: "0.85rem" }}>
                  {printFiles.map((f) => f.name).join(", ")}
                </span>
              </label>
            </div>
            <div style={{ textAlign: "center" }}>
              <button
                type="submit"
                style={{ marginTop: "0.5rem", padding: "0.5rem 1rem" }}
              >
                Submit
              </button>
            </div>
          </div>
        </fieldset>
      </div>

      {/* RIGHT COLUMN: Previews */}
      <div style={{ display: "grid", gap: "0.5rem" }}>
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
    </form>        
  );               
}  