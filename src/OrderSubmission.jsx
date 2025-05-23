// File: frontend/src/OrderSubmission.jsx
import React, { useState } from "react";
import axios from "axios";

export default function OrderSubmission() {
  const [form, setForm] = useState({
    company: "",
    designName: "",
    dueDate: "",
    quantity: "",
    product: "",
    price: "",
    dateType: "Hard Date",
    referral: "",
    materials: ["", "", "", "", ""],
    backMaterial: "",
    furColor: "",
    notes: "",
  });
  const [prodFiles, setProdFiles] = useState([]);
  const [printFiles, setPrintFiles] = useState([]);

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
    setter(Array.from(e.target.files));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // build a JSON payload
      const payload = {
        ...form,
        materials: form.materials,
        prodFileNames: prodFiles.map((f) => f.name),
        printFileNames: printFiles.map((f) => f.name),
      };

      await axios.post(submitUrl, payload);
      alert("Order submitted!");
      // reset
      setForm({
        company: "",
        designName: "",
        dueDate: "",
        quantity: "",
        product: "",
        price: "",
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
      alert(
        err.response?.data?.error || "Submission failed – check your console"
      );
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
              name="price"
              type="number"
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
              name="dueDate"
              type="date"
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
                Material {i + 1}
                <br />
                <input
                  value={m}
                  onChange={(e) =>
                    handleMaterialChange(i, e.target.value)
                  }
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
