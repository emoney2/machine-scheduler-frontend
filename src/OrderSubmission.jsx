// File: frontend/src/OrderSubmission.jsx
import React, { useState } from 'react';
import axios from 'axios';

export default function OrderSubmission() {
  // 1️⃣ Define state for each field
  const [company,    setCompany]    = useState('');
  const [design,     setDesign]     = useState('');
  const [quantity,   setQuantity]   = useState('');
  const [product,    setProduct]    = useState('');
  const [dueDate,    setDueDate]    = useState('');
  const [price,      setPrice]      = useState('');
  const [dateType,   setDateType]   = useState('Hard Date');
  const [referral,   setReferral]   = useState('');
  const [message,    setMessage]    = useState('');

  // 2️⃣ On submit, POST to your Python backend
  const handleSubmit = async e => {
    e.preventDefault();
    try {
      const payload = {
        company, design, quantity, product,
        due_date: dueDate, price,
        date_type: dateType, referral
      };
      await axios.post(
        process.env.REACT_APP_ORDER_SUBMIT_URL || '/api/submit',
        payload,
        { withCredentials: true }
      );
      setMessage('✅ Order submitted!');
      // clear form:
      setCompany(''); setDesign(''); setQuantity('');
      setProduct(''); setDueDate(''); setPrice('');
      setDateType('Hard Date'); setReferral('');
    } catch (err) {
      setMessage('❌ Submission failed.');
      console.error(err);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 600, margin: '0 auto' }}>
      <h2>Order Submission</h2>
      {message && <p>{message}</p>}
      <form onSubmit={handleSubmit}>
        <div>
          <label>Company Name*</label><br/>
          <input
            type="text" value={company}
            onChange={e => setCompany(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Design Name*</label><br/>
          <input
            type="text" value={design}
            onChange={e => setDesign(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Quantity*</label><br/>
          <input
            type="number" value={quantity}
            onChange={e => setQuantity(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Product*</label><br/>
          <input
            type="text" value={product}
            onChange={e => setProduct(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Due Date (MM/DD)*</label><br/>
          <input
            type="text" value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            placeholder="mm/dd"
            required
          />
        </div>
        <div>
          <label>Price*</label><br/>
          <input
            type="text" value={price}
            onChange={e => setPrice(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Date Type*</label><br/>
          <select 
            value={dateType}
            onChange={e => setDateType(e.target.value)}
          >
            <option>Hard Date</option>
            <option>Soft Date</option>
          </select>
        </div>
        <div>
          <label>Referral</label><br/>
          <input
            type="text" value={referral}
            onChange={e => setReferral(e.target.value)}
          />
        </div>
        <button type="submit" style={{ marginTop: 12 }}>
          Submit Order
        </button>
      </form>
    </div>
  );
}
