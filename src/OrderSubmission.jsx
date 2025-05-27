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
    setter(files);
    previewSetter(createPreviews(files));
    if (setter === setProdFiles && files.length > 0) {
      let name = files[0].name.replace(/\.[^/.]+$/, "");
      if (name.length > 12) name = name.slice(0, 12) + "..";
      setForm((prev) => ({ ...prev, designName: name }));
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
        gap: "1.5rem",
        padding: "1rem",
        fontFamily: "sans-serif",
      }}
    >
      {/* LEFT COLUMN: Form sections */}
      <div style={{ display: "grid", gap: "1.5rem" }}>
        {/* Order Details */}
        <fieldset style={{ padding: "1rem" }}>
          <legend>Order Details</legend>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "1rem",
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
                  style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
                />
              </label>
            </div>
          </div>
        </fieldset>

        {/* Materials */}
        <fieldset style={{ padding: "1rem" }}>
          <legend>Materials</legend>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "1rem",
            }}
          >
            {form.materials.map((m, i) => (
              <div key={i}>
                <label>
                  Material {i + 1}
                  {i === 0 && "*"}
                  <br />
                  <input
                    value={m}
                    onChange={(e) => handleMaterialChange(i, e.target.value)}
                    required={i === 0}
                    style={{ width: "100%" }}
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
                  style={{ width: "100%" }}
                />
              </label>
            </div>
            <div>
              <label>
                EMB Backing*
                <br />
                <input
                  name="embBacking"
                  value={form.embBacking}
                  onChange={handleChange}
                  required
                  style={{ width: "100%" }}
                />
              </label>
            </div>
            <div>
              <label>
                Fur Color*
                <br />
                <input
                  name="furColor"
                  value={form.furColor}
                  onChange={handleChange}
                  required
                  style={{ width: "100%" }}
                />
              </label>
            </div>
          </div>
        </fieldset>

        {/* Additional Info + Files */}
        <fieldset style={{ padding: "1rem" }}>
          <legend>Additional Info</legend>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <label>
                Notes<br />
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows={3}
                  style={{ width: "100%" }}
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
                  onChange={(e) =>
                    handleFileChange(e, setProdFiles, setProdPreviews)
                  }
                />
              </label>
            </div>
            <div>
              <label>
                Print File(s)<br />
                <input
                  type="file"
                  multiple
                  onChange={(e) =>
                    handleFileChange(e, setPrintFiles, setPrintPreviews)
                  }
                />
              </label>
            </div>
            <div style={{ textAlign: "center" }}>
              <button
                type="submit"
                style={{ marginTop: "1rem", padding: "0.75rem 1.5rem" }}
              >
                Submit Order
              </button>
            </div>
          </div>
        </fieldset>
      </div>

      {/* RIGHT COLUMN: Previews */}
      <div style={{ display: "grid", gap: "1.5rem" }}>
        <fieldset style={{ padding: "1rem", height: "50%" }}>
          <legend>Production File Preview</legend>
          <div style={{ overflow: "auto", height: "100%" }}>
            {prodPreviews.map((p, i) =>
              p.type.startsWith("image/") ? (
                <img
                  key={i}
                  src={p.url}
                  alt={p.name}
                  style={{ maxWidth: "100%", marginBottom: "0.5rem" }}
                />
              ) : p.type === "application/pdf" ? (
                <iframe
                  key={i}
                  src={p.url}
                  title={p.name}
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div key={i} style={{ fontSize: "0.8rem" }}>
                  📄 {p.name}
                </div>
              )
            )}
          </div>
        </fieldset>
        <fieldset style={{ padding: "1rem", height: "50%" }}>
          <legend>Print File Preview</legend>
          <div style={{ overflow: "auto", height: "100%" }}>
            {printPreviews.map((p, i) =>
              p.type.startsWith("image/") ? (
                <img
                  key={i}
                  src={p.url}
                  alt={p.name}
                  style={{ maxWidth: "100%", marginBottom: "0.5rem" }}
                />
              ) : p.type === "application/pdf" ? (
                <iframe
                  key={i}
                  src={p.url}
                  title={p.name}
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div key={i} style={{ fontSize: "0.8rem" }}>
                  📄 {p.name}
                </div>
              )
            )}
          </div>
        </fieldset>
      </div>
    </form>
  );
}
