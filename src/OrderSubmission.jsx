// File: frontend/src/OrderSubmission.jsx
import React, { useState, useEffect } from "react";
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

  // Helpers
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleMaterialChange = (idx, value) => {
    setForm((f) => {
      const m = [...f.materials];
      m[idx] = value;
      return { ...f, materials: m };
    });
  };

  // File handling + previews
  const handleFileChange = (e, setter, previewSetter) => {
    const files = Array.from(e.target.files);
    setter(files);

    const previews = files.map((file) => {
      const url = URL.createObjectURL(file);
      const type = file.type;
      return { url, type, name: file.name };
    });
    previewSetter(previews);

    // auto-fill designName from first prod file
    if (setter === setProdFiles && files.length > 0) {
      let name = files[0].name.replace(/\.[^/.]+$/, "");
      if (name.length > 12) name = name.slice(0, 12) + "..";
      setForm((f) => ({ ...f, designName: name }));
    }
  };

  // Submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    // append scalar fields
    ["company","designName","quantity","product","price","dueDate","dateType","referral","backMaterial","embBacking","furColor","notes"]
      .forEach(k => fd.append(k, form[k] || ""));
    // append materials
    form.materials.forEach((m) => fd.append("materials", m));
    // append files
    prodFiles.forEach((f) => fd.append("prodFiles", f));
    printFiles.forEach((f) => fd.append("printFiles", f));

    try {
      await axios.post(submitUrl, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
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
      setProdFiles([]); setPrintFiles([]);
      setProdPreviews([]); setPrintPreviews([]);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Submission failed – check console");
    }
  };

  return (
    <form onSubmit={handleSubmit}
          style={{
            display: "grid",
            gridTemplateRows: "repeat(3, auto)",
            gap: "1rem",
            fontFamily: "sans-serif",
            padding: "1rem"
          }}
    >
      {/* Top band: 3×3 */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "0.5rem"
      }}>
        <div>
          <label>Company Name*<br/>
            <input name="company" value={form.company} onChange={handleChange} required/>
          </label>
        </div>
        <div>
          <label>Design Name*<br/>
            <input name="designName" value={form.designName} readOnly required/>
          </label>
        </div>
        <div>
          <label>Quantity*<br/>
            <input type="number" name="quantity" value={form.quantity} onChange={handleChange} required/>
          </label>
        </div>
        <div>
          <label>Product*<br/>
            <input name="product" value={form.product} onChange={handleChange} required/>
          </label>
        </div>
        <div>
          <label>Price*<br/>
            <input type="number" name="price" value={form.price} onChange={handleChange} required/>
          </label>
        </div>
        <div>
          <label>Due Date*<br/>
            <input type="date" name="dueDate" value={form.dueDate} onChange={handleChange} required/>
          </label>
        </div>
        <div>
          <label>Hard/Soft Date*<br/>
            <select name="dateType" value={form.dateType} onChange={handleChange}>
              <option>Hard Date</option><option>Soft Date</option>
            </select>
          </label>
        </div>
        <div>
          <label>Referral<br/>
            <input name="referral" value={form.referral} onChange={handleChange}/>
          </label>
        </div>
        <div></div>
      </div>

      {/* Middle band: 3×3 */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "0.5rem"
      }}>
        {form.materials.map((m, i) => (
          <div key={i}>
            <label>
              Material {i+1}{i===0 && "*"}<br/>
              <input
                value={m}
                onChange={(e) => handleMaterialChange(i, e.target.value)}
                required={i===0}
              />
            </label>
          </div>
        ))}
        <div>
          <label>
            Back Material<br/>
            <input name="backMaterial" value={form.backMaterial} onChange={handleChange}/>
          </label>
        </div>
        <div>
          <label>
            EMB Backing*<br/>
            <input name="embBacking" value={form.embBacking} onChange={handleChange} required/>
          </label>
        </div>
        <div>
          <label>
            Fur Color*<br/>
            <input name="furColor" value={form.furColor} onChange={handleChange} required/>
          </label>
        </div>
      </div>

      {/* Bottom band */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr 0.5fr",
        gap: "0.5rem",
        alignItems: "start"
      }}>
        <div>
          <label>
            Notes<br/>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={4}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        {/* Prod Files input + preview */}
        <div>
          <label>
            Production File(s)*<br/>
            <input
              type="file"
              multiple
              required
              onChange={(e) => handleFileChange(e, setProdFiles, setProdPreviews)}
            />
          </label>
          <div style={{ marginTop: "0.5rem" }}>
            {prodPreviews.map((p, idx) => (
              p.type.startsWith("image/") ? (
                <img key={idx} src={p.url} alt={p.name} style={{ maxWidth: "100%", maxHeight: 80 }}/>
              ) : p.type === "application/pdf" ? (
                <iframe key={idx} src={p.url} style={{ width: "100%", height: 80 }} title={p.name}/>
              ) : (
                <div key={idx} style={{ fontSize: "0.8rem" }}>
                  📄 {p.name}
                </div>
              )
            ))}
          </div>
        </div>

        {/* Print Files input + preview */}
        <div>
          <label>
            Print File(s)<br/>
            <input
              type="file"
              multiple
              onChange={(e) => handleFileChange(e, setPrintFiles, setPrintPreviews)}
            />
          </label>
          <div style={{ marginTop: "0.5rem" }}>
            {printPreviews.map((p, idx) => (
              p.type.startsWith("image/") ? (
                <img key={idx} src={p.url} alt={p.name} style={{ maxWidth: "100%", maxHeight: 80 }}/>
              ) : p.type === "application/pdf" ? (
                <iframe key={idx} src={p.url} style={{ width: "100%", height: 80 }} title={p.name}/>
              ) : (
                <div key={idx} style={{ fontSize: "0.8rem" }}>
                  📄 {p.name}
                </div>
              )
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="submit" style={{ width: "100%", padding: "0.75rem" }}>
            Submit Order
          </button>
        </div>
      </div>
    </form>
  );
}
