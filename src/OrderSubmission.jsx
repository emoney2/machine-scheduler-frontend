// File: frontend/src/OrderSubmission.jsx
import React, { useState } from 'react';

export default function OrderSubmission() {
  const [form, setForm] = useState({
    customer: '',
    quantity: '',
    notes: ''
  });

  const handleChange = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = e => {
    e.preventDefault();
    // TODO: wire up submission (e.g. axios.post to your orders endpoint)
    console.log('Submitting order:', form);
    // clear form
    setForm({ customer: '', quantity: '', notes: '' });
  };

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif', fontSize: 14 }}>
      <h2>Order Submission</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400 }}>
        <label>
          Customer Name
          <input
            type="text"
            name="customer"
            value={form.customer}
            onChange={handleChange}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        <label>
          Quantity
          <input
            type="number"
            name="quantity"
            value={form.quantity}
            onChange={handleChange}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        <label>
          Notes
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            style={{ width: '100%', padding: 8, minHeight: 80 }}
          />
        </label>
        <button type="submit" style={{ padding: '8px 12px', fontSize: 14 }}>
          Submit Order
        </button>
      </form>
    </div>
  );
}
