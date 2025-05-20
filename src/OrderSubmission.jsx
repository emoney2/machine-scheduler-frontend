// File: frontend/src/OrderSubmission.jsx
import React from 'react';

export default function OrderSubmission() {
  return (
    <iframe
      title="Order Submission"
      src="https://order-submission.onrender.com"   // ← your Render URL here
      style={{
        width: '100%',
        height: 'calc(100vh - 50px)',  // adjust if your Nav bar is ~50px tall
        border: 'none'
      }}
    />
  );
}