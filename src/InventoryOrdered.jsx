import React, { useEffect, useState } from "react";
import axios from "axios";

export default function InventoryOrdered() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    axios.get(`${process.env.REACT_APP_API_ROOT}/inventoryOrdered`)
         .then(r => setOrders(r.data))
         .catch(console.error);
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1>Inventory Ordered</h1>
      <button onClick={() => window.location.reload()}>Refresh</button>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead>
          <tr>
            {["Date","Type","Name","Quantity"].map(col => (
              <th key={col} style={{ border: "1px solid #ccc", padding: 4 }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #eee", padding: 4 }}>{o.date}</td>
              <td style={{ border: "1px solid #eee", padding: 4 }}>{o.type}</td>
              <td style={{ border: "1px solid #eee", padding: 4 }}>{o.name}</td>
              <td style={{ border: "1px solid #eee", padding: 4 }}>{o.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
