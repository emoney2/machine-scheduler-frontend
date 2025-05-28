import React, { useEffect, useState } from "react";
import axios from "axios";

export default function Inventory() {
  const [data, setData] = useState({ headers: [], rows: [] });

  useEffect(() => {
    axios.get(`${process.env.REACT_APP_API_ROOT}/inventory`)
         .then(r => setData(r.data))
         .catch(console.error);
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1>Inventory</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {data.headers.map(h => (
              <th key={h} style={{ border: "1px solid #ccc", padding: 4 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {data.headers.map(h => (
                <td key={h} style={{ border: "1px solid #eee", padding: 4 }}>
                  {row[h]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
