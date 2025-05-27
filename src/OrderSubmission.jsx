// File: frontend/src/OrderSubmission.jsx
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

  // builds e.g. "https://order-submission.onrender.com/submit"
  const submitUrl =
    process.env.REACT_APP_ORDER_SUBMIT_URL ||
    `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, "")}/submit`;

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

  const handleFileChange = (e, setter) => {
    const files = Array.from(e.target.files);
    setter(files);

    // if these are Production Files, auto-set designName
    if (setter === setProdFiles && files.length > 0) {
      let name = files[0].name.replace(/\.[^/.]+$/, ""); // strip extension
      if (name.length > 12) name = name.slice(0, 12) + "..";
      setForm(f => ({ ...f, designName: name }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // build multipart form data
    const fd = new FormData();

    // append scalar fields
    ["company","designName","quantity","product","price","dueDate","dateType","referral","backMaterial","furColor","notes"]
      .forEach(key => fd.append(key, form[key] || ""));

    // append materials (M1–M5)
    form.materials.forEach((mat) => fd.append("materials", mat));

    // append files
    prodFiles.forEach((file) => fd.append("prodFiles", file));
    printFiles.forEach((file) => fd.append("printFiles", file));

    try {
      console.log("Submitting to:", submitUrl);
      await axios.post(submitUrl, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      alert("Order submitted!");
      // reset everything
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
        furColor: "",
        notes: "",
      });
      setProdFiles([]);
      setPrintFiles([]);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Submission failed – check your console");
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2>Order Submission</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            Company Name*<br />
            <input
              name="company"
              value={form.company}
              onChange={handleChange}
              required
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
              readOnly
              required
            />
          </label>
        </div>

        <div>
          <label>
            Quantity*<br />
            <input
              type="number"
              name="quantity"
              value={form.quantity}
              onChange={handleChange}
              required
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
            />
          </label>
        </div>

        <div>
          <label>
            Price*<br />
            <input
              type="number"
              name="price"
              value={form.price}
              onChange={handleChange}
              required
            />
          </label>
        </div>

        <div>
          <label>
            Due Date*<br />
            <input
              type="date"
              name="dueDate"
              value={form.dueDate}
              onChange={handleChange}
              required
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
            />
          </label>
        </div>

        <fieldset style={{ margin: "1em 0", padding: "0.5em" }}>
          <legend>Materials</legend>
          {form.materials.map((m, i) => (
            <div key={i}>
              <label>
                Material {i + 1}{i === 0 && "*"}
                <br />
                <input
                  value={m}
                  onChange={(e) => handleMaterialChange(i, e.target.value)}
                  required={i === 0}
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
              />
            </label>
          </div>
        </fieldset>

          <div>
            <label>
              EMB Backing*<br />
              <input
                name="embBacking"
                value={form.embBacking}
                onChange={handleChange}
                required
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
            />
          </label>
        </div>

        <div>
          <label>
            Notes<br />
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
            />
          </label>
        </div>

        <div>
          <label>
            Production File(s)<br />
            <input
              type="file"
              multiple
              required
              onChange={(e) => handleFileChange(e, setProdFiles)}
            />
          </label>
        </div>

        <div>
          <label>
            Print File(s)<br />
            <input
              type="file"
              multiple
              onChange={(e) => handleFileChange(e, setPrintFiles)}
            />
          </label>
        </div>

        <button type="submit" style={{ marginTop: 16 }}>
          Submit Order
        </button>
      </form>
    </div>
  );
}
