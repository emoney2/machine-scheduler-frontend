// File: frontend/src/OrderSubmission.jsx
import React from 'react';
console.log("🔍 OrderSubmission component rendered, iframe src →", window.location.href);

export default function OrderSubmission() {
  return (
    <iframe
      src="https://order-submission.onrender.com/"
      title="Order Submission"
      style={{
        width: '100%',
        height: '100vh',
        border: 'none',
      }}
    />
  );
}
