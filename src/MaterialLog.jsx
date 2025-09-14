import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";


const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");


const Tile = ({ onClick, children }) => (
<button
onClick={onClick}
style={{
flex: 1,
minHeight: 140,
border: "1px solid #ddd",
borderRadius: 16,
background: "#fff",
boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
cursor: "pointer",
fontSize: 24,
fontWeight: 600,
display: "flex",
alignItems: "center",
justifyContent: "center",
padding: 16
}}
>
{children}
</button>
);


const Section = ({ title, children, actions }) => (
<div style={{ marginTop: 16, background: "#fff", border: "1px solid #eee", borderRadius: 14 }}>
<div style={{ padding: 12, borderBottom: "1px solid #eee", display: "flex", alignItems: "center" }}>
<div style={{ fontWeight: 700 }}>{title}</div>
<div style={{ marginLeft: "auto" }}>{actions}</div>
</div>
<div style={{ padding: 12 }}>{children}</div>
</div>
);


function useMaterialsAndProducts() {
const [materials, setMaterials] = useState([]);
const [products, setProducts] = useState([]);
useEffect(() => {
(async () => {
try {
const [m, p] = await Promise.all([
axios.get(`${API_ROOT}/materials`, { withCredentials: true }),
axios.get(`${API_ROOT}/products`, { withCredentials: true }),
]);
setMaterials(m.data || []);
setProducts(p.data || []);
} catch (e) {
console.error("Failed to load materials/products", e);
}
})();
}, []);
return { materials, products };
}


function Row({ idx, row, onChange, onRemove, materials, products }) {
const update = (patch) => onChange(idx, { ...row, ...patch });
return (
<div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 2fr 2fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 8 }}>
{/* Material (typeahead) */}
<div>
<input list="materials-list" value={row.material} onChange={(e) => update({ material: e.target.value })} placeholder="Material" style={{ width: "100%" }} />
</div>
{/* Product (optional) */}
<div>
<input list="products-list" value={row.product} onChange={(e) => update({ product: e.target.value })} placeholder="Product (optional)" style={{ width: "100%" }} />
</div>
{/* Width (in) */}
<div>
<input type="number" min="0" step="1" value={row.w} onChange={(e) => update({ w: e.target.value })} placeholder="Width (in)" style={{ width: "100%" }} />
</div>
}