import React, { useState } from "react";
import axios from "axios";

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
    prodFiles.forEach((f) => fd.append("prodFiles", f));
    printFiles.forEach((f) => fd.append("printFiles", f));
    try {
      await axios.post(submitUrl, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      alert("Order submitted!");
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
            <div>
              <label>
                Company Name*<br />
                <input
                  name="company"
                  value={form.company}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
              </label>
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
            <div>
              <label>
                Product*<br />
                <input
                  name="product"
                  value={form.product}
                  onChange={handleChange}
                  required
                  style={{ width: "80%" }}
                />
              </label>
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
                    value={m}
                    onChange={(e) => handleMaterialChange(i, e.target.value)}
                    required={i === 0}
                    style={{ width: "80%" }}
                  />
                </label>
              </div>
            ))}
            <div>
              <label>
                Back Material<br />
                <input
                  name="backMaterial"
                  value={form.backMaterial}
                  onChange={handleChange}
                  style={{ width: "80%" }}
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
              <label>
                Production File(s)*<br />
                <input
                  type="file"
                  multiple
                  required
                  onChange={(e) => handleFileChange(e, setProdFiles, setProdPreviews)}
                />
              </label>
              <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
                {prodFiles.map((f, i) => (
                  <div key={i}>• {f.name}</div>
                ))}
              </div>
            </div>
            <div>
              <label>
                Print File(s)<br />
                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFileChange(e, setPrintFiles, setPrintPreviews)}
                />
              </label>
              <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
                {printFiles.map((f, i) => (
                  <div key={i}>• {f.name}</div>
                ))}
              </div>
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