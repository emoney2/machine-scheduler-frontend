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

      {orders.map(order => (
        <div
          key={order.id}
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 12,
            marginBottom: 10,
            background: '#fff'
          }}
        >
          <div><strong>Order #:</strong> {order.order_number}</div>
          <div><strong>Company:</strong> {order.company_name}</div>
          <div><strong>Design:</strong> {order.design}</div>
          <div><strong>Quantity:</strong> {order.quantity}</div>
          <div><strong>Stage:</strong> {order.stage}</div>
          <div><strong>Due Date:</strong> {order.due_date}</div>
        </div>
      ))}
    </div>
  );
}

export default ProductionOrders;
