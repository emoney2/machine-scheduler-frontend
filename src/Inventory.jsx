import React, { useEffect, useState } from "react";
import axios from "axios";

export default function Inventory() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    axios.get(`${process.env.REACT_APP_API_ROOT}/materialInventory`)
      .then((res) => setRows(res.data))
      .catch((err) => console.error(err));
  }, []);
  return (
    <div style={{ padding: 16 }}>
      <h1>Inventory</h1>
      {/* TODO: render rows in a table */}
    </div>
  );
}
