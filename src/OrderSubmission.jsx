import React, { useState } from 'react';

export default function OrderSubmission() {
  // — Define state hooks for each field
  const [company, setCompany]         = useState('');
  const [design, setDesign]           = useState('');
  const [quantity, setQuantity]       = useState('');
  const [product, setProduct]         = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [price, setPrice]             = useState('');
  const [dateType, setDateType]       = useState('Hard Date');
  const [materials, setMaterials]     = useState(['', '', '', '', '']);
  const [backMaterial, setBackMaterial] = useState('');
  const [furColor, setFurColor]       = useState('');
  const [backingType, setBackingType] = useState('');
  const [notes, setNotes]             = useState('');
  const [prodFiles, setProdFiles]     = useState([]);
  const [printFiles, setPrintFiles]   = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // TODO: collect all data and POST to your Flask API
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Order Submission</h2>
      <form onSubmit={handleSubmit}>
        {/* TODO: Add input fields here */}
        <button type="submit">Submit Order</button>
      </form>
    </div>
  );
}
