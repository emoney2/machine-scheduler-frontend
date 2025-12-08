import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

function ProductionOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setLoading(true);

    const { data, error } = await supabase
      .from('Production Orders TEST')
      .select('*')

    if (error) {
      console.error('Error loading production orders:', error);
    } else {
      setOrders(data || []);
    }

    setLoading(false);
  }

  if (loading) {
    return <div style={{ padding: 20 }}>Loading production orders…</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Production Orders</h2>

      {orders.length === 0 && <div>No orders found.</div>}

      {orders.map((order, idx) => (
        <div
          key={idx}
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
            background: '#fff'
          }}
        >
          {Object.entries(order).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', marginBottom: 4 }}>
              <div style={{ minWidth: 180, fontWeight: 600 }}>
                {key}:
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {value === null || value === '' ? '—' : String(value)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default ProductionOrders;
