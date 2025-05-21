import React, { useState } from 'react';
import axios from 'axios';

export default function OrderSubmission() {
  // ── Form state ─────────────────────────────────────────────────────────────
  const [company,       setCompany]       = useState('');
  const [design,        setDesign]        = useState('');
  const [quantity,      setQuantity]      = useState('');
  const [product,       setProduct]       = useState('');
  const [dueDate,       setDueDate]       = useState('');
  const [price,         setPrice]         = useState('');
  const [hardSoft,      setHardSoft]      = useState('Hard Date');
  const [referral,      setReferral]      = useState('');

  const [material1,     setMaterial1]     = useState('');
  const [material2,     setMaterial2]     = useState('');
  const [material3,     setMaterial3]     = useState('');
  const [material4,     setMaterial4]     = useState('');
  const [material5,     setMaterial5]     = useState('');
  const [backMaterial,  setBackMaterial]  = useState('');

  const [furColor,      setFurColor]      = useState('');
  const [backingType,   setBackingType]   = useState('');
  const [notes,         setNotes]         = useState('');

  const [prodFiles,     setProdFiles]     = useState([]);
  const [printFiles,    setPrintFiles]    = useState([]);

  const [submitting,    setSubmitting]    = useState(false);
  const [message,       setMessage]       = useState(null);

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleProdFilesChange(e) {
    setProdFiles(Array.from(e.target.files));
  }
  function handlePrintFilesChange(e) {
    setPrintFiles(Array.from(e.target.files));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const url = process.env.REACT_APP_ORDER_SUBMIT_URL
        || `${process.env.REACT_APP_API_ROOT.replace(/\/api$/, '')}/submit`;

      const formData = new FormData();
      // JSON fields
      [
        ['company', company],
        ['design', design],
        ['quantity', quantity],
        ['product', product],
        ['dueDate', dueDate],
        ['price', price],
        ['hardSoft', hardSoft],
        ['referral', referral],
        ['material1', material1],
        ['material2', material2],
        ['material3', material3],
        ['material4', material4],
        ['material5', material5],
        ['backMaterial', backMaterial],
        ['furColor', furColor],
        ['backingType', backingType],
        ['notes', notes]
      ].forEach(([k,v]) => formData.append(k,v));

      // files
      prodFiles.forEach(f => formData.append('prodFiles', f));
      printFiles.forEach(f => formData.append('printFiles', f));

      await axios.post(url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        withCredentials: true
      });

      setMessage({ type:'success', text:'Order submitted!' });
      // reset form
      setCompany(''); setDesign(''); setQuantity(''); setProduct('');
      setDueDate(''); setPrice(''); setHardSoft('Hard Date'); setReferral('');
      setMaterial1(''); setMaterial2(''); setMaterial3('');
      setMaterial4(''); setMaterial5(''); setBackMaterial('');
      setFurColor(''); setBackingType(''); setNotes('');
      setProdFiles([]); setPrintFiles([]);
    }
    catch(err) {
      console.error(err);
      setMessage({ type:'error', text:'Submission failed. See console.' });
    }
    finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding:20, maxWidth:600, margin:'auto' }}>
      <h2>Order Submission</h2>
      {message && (
        <div style={{
          padding:10,
          marginBottom:10,
          color: message.type==='error'?'#900':'#090',
          border: `1px solid ${message.type==='error'?'#900':'#090'}`
        }}>
          {message.text}
        </div>
      )}
      <form onSubmit={handleSubmit} encType="multipart/form-data">
        <fieldset disabled={submitting} style={{ border:'none', padding:0 }}>
          <div>
            <label>Company Name*</label><br/>
            <input value={company} onChange={e=>setCompany(e.target.value)} required/>
          </div>

          <div>
            <label>Design Name*</label><br/>
            <input value={design} onChange={e=>setDesign(e.target.value)} required/>
          </div>

          <div>
            <label>Quantity*</label><br/>
            <input type="number" value={quantity} onChange={e=>setQuantity(e.target.value)} required/>
          </div>

          <div>
            <label>Product*</label><br/>
            <input value={product} onChange={e=>setProduct(e.target.value)} required/>
          </div>

          <div>
            <label>Due Date*</label><br/>
            <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required/>
          </div>

          <div>
            <label>Price*</label><br/>
            <input type="number" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} required/>
          </div>

          <div>
            <label>Hard/Soft Date*</label><br/>
            <select value={hardSoft} onChange={e=>setHardSoft(e.target.value)}>
              <option>Hard Date</option>
              <option>Soft Date</option>
            </select>
          </div>

          <div>
            <label>Referral</label><br/>
            <input value={referral} onChange={e=>setReferral(e.target.value)}/>
          </div>

          <hr/>

          <h4>Materials</h4>
          <div><label>Material 1*</label><br/>
            <input value={material1} onChange={e=>setMaterial1(e.target.value)} required/>
          </div>
          <div><label>Material 2</label><br/>
            <input value={material2} onChange={e=>setMaterial2(e.target.value)}/>
          </div>
          <div><label>Material 3</label><br/>
            <input value={material3} onChange={e=>setMaterial3(e.target.value)}/>
          </div>
          <div><label>Material 4</label><br/>
            <input value={material4} onChange={e=>setMaterial4(e.target.value)}/>
          </div>
          <div><label>Material 5</label><br/>
            <input value={material5} onChange={e=>setMaterial5(e.target.value)}/>
          </div>
          <div><label>Back Material</label><br/>
            <input value={backMaterial} onChange={e=>setBackMaterial(e.target.value)}/>
          </div>

          <hr/>

          <h4>Additional Info</h4>
          <div><label>Fur Color*</label><br/>
            <input value={furColor} onChange={e=>setFurColor(e.target.value)} required/>
          </div>
          <div><label>Backing Type*</label><br/>
            <select value={backingType} onChange={e=>setBackingType(e.target.value)} required>
              <option value="">Select…</option>
              <option value="Cut Away">Cut Away</option>
              <option value="Tear Away">Tear Away</option>
            </select>
          </div>
          <div><label>Notes</label><br/>
            <textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)}/>
          </div>

          <hr/>

          <h4>File Uploads</h4>
          <div>
            <label>Production Files</label><br/>
            <input type="file" multiple onChange={handleProdFilesChange}/>
          </div>
          <div>
            <label>Print Files</label><br/>
            <input type="file" multiple onChange={handlePrintFilesChange}/>
          </div>

          <hr/>

          <button type="submit" style={{ padding:'8px 16px' }}>
            {submitting ? 'Submitting…' : 'Submit Order'}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
