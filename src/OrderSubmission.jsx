// File: frontend/src/OrderSubmission.jsx
import React from 'react';

export default function OrderSubmission() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <iframe
        src="https://order-submission.onrender.com"      // ← replace with your Render app URL, e.g. order-submission.onrender.com
        title="Order Submission"
        style={{
          width: '100%',
          height: 'calc(100vh - 64px)',      // adjust if necessary to fit under your nav bar
          border: 'none',
        }}
      />
    </div>
  );
}
