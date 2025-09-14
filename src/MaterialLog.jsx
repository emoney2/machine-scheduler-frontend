// src/MaterialLog.jsx
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
      padding: 16,
    }}
  >
    {children}
  </button>
);

const Section = ({ title, children, actions }) => (
  <div style={{ marginTop: 16, background: "#fff", border: "1px solid #eee", borderRadius: 14 }}>
    <div
      style={{
        padding: 12,
        borderBottom: "1px solid #eee",
        display: "flex",
        alignItems: "center",
      }}
    >
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 2fr 2fr 2fr 1fr auto",
        gap: 8,
        alignItems: "center",
        marginBottom: 8,
      }}
    >
      {/* Material (typeahead) */}
      <div>
        <input
          list="materials-list"
          value={row.material}
          onChange={(e) => update({ material: e.target.value })}
          placeholder="Material"
          style={{ width: "100%" }}
        />
      </div>

      {/* Product (optional) */}
      <div>
        <input
          list="products-list"
          value={row.product}
          onChange={(e) => update({ product: e.target.value })}
          placeholder="Product (optional)"
          style={{ width: "100%" }}
        />
      </div>

      {/* Width (in) */}
      <div>
        <input
          type="number"
          min="0"
          step="1"
          value={row.w}
          onChange={(e) => update({ w: e.target.value })}
          placeholder="Width (in)"
          style={{ width: "100%" }}
        />
      </div>

      {/* Length (in) */}
      <div>
        <input
          type="number"
          min="0"
          step="1"
          value={row.l}
          onChange={(e) => update({ l: e.target.value })}
          placeholder="Length (in)"
          style={{ width: "100%" }}
        />
      </div>

      {/* Qty (whole numbers) */}
      <div>
        <input
          type="number"
          min="1"
          step="1"
          value={row.qty}
          onChange={(e) => update({ qty: e.target.value })}
          placeholder="Qty"
          style={{ width: "100%" }}
        />
      </div>

      <div>
        <button onClick={() => onRemove(idx)} style={{ padding: "6px 10px" }}>
          Remove
        </button>
      </div>
    </div>
  );
}

function RDForm() {
  const { materials, products } = useMaterialsAndProducts();
  const [rows, setRows] = useState(() =>
    Array.from({ length: 5 }, () => ({ material: "", product: "", w: "", l: "", qty: 1 }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const addRow = () =>
    setRows((r) => [...r, { material: "", product: "", w: "", l: "", qty: 1 }]);
  const clearAll = () => {
    setRows(Array.from({ length: 5 }, () => ({ material: "", product: "", w: "", l: "", qty: 1 })));
    setError("");
    setOkMsg("");
  };

  const onChange = (idx, next) => setRows((r) => r.map((x, i) => (i === idx ? next : x)));
  const onRemove = (idx) => setRows((r) => r.filter((_, i) => i !== idx));

  const validate = () => {
    for (const [i, r] of rows.entries()) {
      const hasAny = [r.material, r.product, r.w, r.l].some((v) => String(v || "").trim());
      if (!hasAny) continue; // allow empty trailing rows
      if (!r.material.trim()) return `Row ${i + 1}: select the correct material`;
      const qty = Number(r.qty);
      if (!Number.isInteger(qty) || qty <= 0) return `Row ${i + 1}: quantity must be a whole number`;
      const hasProd = !!r.product.trim();
      const hasDims = r.w !== "" && r.l !== "";
      if (!hasProd && !hasDims) return `Row ${i + 1}: provide Product or W×L`;
    }
    return "";
  };

  const submit = async () => {
    setError("");
    setOkMsg("");
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    const payload = rows
      .filter((r) => [r.material, r.product, r.w, r.l].some((v) => String(v || "").trim()))
      .map((r) => ({
        material: r.material.trim(),
        product: r.product.trim() || null,
        widthIn: r.w !== "" ? Number(r.w) : null,
        lengthIn: r.l !== "" ? Number(r.l) : null,
        quantity: Number(r.qty),
      }));
    if (!payload.length) {
      setError("Nothing to submit");
      return;
    }
    try {
      setSubmitting(true);
      await axios.post(`${API_ROOT}/material-log/rd-append`, { items: payload }, { withCredentials: true });
      setOkMsg(`Logged ${payload.length} item(s) to Material Log`);
      clearAll();
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.error || "Failed to append";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <datalist id="materials-list">{materials.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id="products-list">{products.map((p) => <option key={p} value={p} />)}</datalist>
      <Section
        title="R&D usage"
        actions={
          <>
            <button onClick={clearAll} style={{ marginRight: 8 }}>
              Clear all
            </button>
            <button onClick={addRow}>Add row</button>
          </>
        }
      >
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          At least one of Product or W×L is required per row. W×L is in inches. Qty must be a whole
          number. Product wins if both are provided.
        </div>
        {rows.map((row, i) => (
          <Row
            key={i}
            idx={i}
            row={row}
            onChange={onChange}
            onRemove={onRemove}
            materials={materials}
            products={products}
          />
        ))}
        {error && <div style={{ color: "#b00020", marginTop: 8 }}>{error}</div>}
        {okMsg && <div style={{ color: "#0a0", marginTop: 8 }}>{okMsg}</div>}
        <div style={{ marginTop: 12 }}>
          <button disabled={submitting} onClick={submit} style={{ padding: "8px 14px", fontWeight: 600 }}>
            {submitting ? "Submitting…" : "Submit to Material Log"}
          </button>
        </div>
      </Section>
    </>
  );
}

function Recut() {
  const [orders, setOrders] = useState([]);
  const [fetchErr, setFetchErr] = useState("");     // ← NEW
  const [filterOpenOnly, setFilterOpenOnly] = useState(true);
  const [sortKey, setSortKey] = useState("dueDate"); // 'dueDate' | 'order'
  const [sortDir, setSortDir] = useState("asc");     // 'asc' | 'desc'
  const [query, setQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [recutQty, setRecutQty] = useState(1);
  const [originalUsage, setOriginalUsage] = useState([]);
  const [checked, setChecked] = useState({});
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  function normalizeOrders(raw) {                    // ← NEW
    // Accepts either [{...}] or [[hdr...], [row...], ...] and returns [{...}]
    if (Array.isArray(raw) && raw.length && Array.isArray(raw[0])) {
      const [hdr, ...rows] = raw;
      const headers = hdr.map((h) => String(h || "").trim());
      return rows.map((r) => {
        const o = {};
        headers.forEach((h, i) => { o[h] = r[i]; });
        return o;
      });
    }
    if (Array.isArray(raw)) return raw;
    return [];
  }

  useEffect(() => {
    (async () => {
      try {
        setFetchErr("");
        const res = await axios.get(`${API_ROOT}/orders`, { withCredentials: true });
        const list = normalizeOrders(res?.data);
        setOrders(Array.isArray(list) ? list : []);
        if (!Array.isArray(list)) setFetchErr("Orders endpoint did not return a list.");
      } catch (e) {
        console.error(e);
        setFetchErr(e?.response?.data?.error || `Failed to load orders (${e?.response?.status || "network"})`);
        setOrders([]);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    let arr = orders.slice();
    const get = (o, k) => (o?.[k] ?? "").toString().trim();

    if (filterOpenOnly) {
      arr = arr.filter((o) => get(o, "Stage").toLowerCase() !== "complete");
    }
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter((o) =>
        ["Order #", "Company Name", "Design", "Product"].some((k) => get(o, k).toLowerCase().includes(q))
      );
    }
    arr.sort((a, b) => {
      if (sortKey === "order") {
        const A = Number(get(a, "Order #")) || 0;
        const B = Number(get(b, "Order #")) || 0;
        return sortDir === "asc" ? A - B : B - A;
      }
      const A = new Date(get(a, "Due Date") || "1970-01-01");
      const B = new Date(get(b, "Due Date") || "1970-01-01");
      return sortDir === "asc" ? A - B : B - A;
    });
    return arr;
  }, [orders, filterOpenOnly, query, sortKey, sortDir]);

  const onPickOrder = async (order) => {
    setSelectedOrder(order);
    setErr("");
    setOk("");
    setChecked({});
    setOriginalUsage([]);
    try {
      const orderNum = order["Order #"];
      const res = await axios.get(`${API_ROOT}/material-log/original-usage`, {
        params: { order: orderNum },
        withCredentials: true,
      });
      setOriginalUsage(res.data.items || []);
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.error || "Failed to load usage for order");
    }
  };

  const toggle = (id) => setChecked((c) => ({ ...c, [id]: !c[id] }));
  const allOn = () => {
    const map = {};
    (originalUsage || []).forEach((it) => {
      map[it.id] = true;
    });
    setChecked(map);
  };
  const allOff = () => setChecked({});

  const submitRecut = async () => {
    setErr("");
    setOk("");
    const qty = Number(recutQty);
    if (!selectedOrder) {
      setErr("Pick a job first");
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      setErr("Recut quantity must be a whole number");
      return;
    }
    const chosen = (originalUsage || []).filter((it) => checked[it.id]);
    if (!chosen.length) {
      setErr("Select at least one item to recut");
      return;
    }

    try {
      const payload = {
        orderNumber: selectedOrder["Order #"],
        recutQty: qty,
        items: chosen.map((it) => ({
          id: it.id,
          material: it.material,
          shape: it.shape,
          companyName: it.companyName,
          originalQuantity: it.quantity,
          originalUnits: it.qtyUnits,
        })),
      };
      await axios.post(`${API_ROOT}/material-log/recut-append`, payload, { withCredentials: true });
      setOk(`Logged ${chosen.length} recut row(s)`);
      setChecked({});
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.error || "Failed to append recut rows");
    }
  };

  return (
    <>
      {!selectedOrder && (
        <Section
          title="Pick job to recut"
          actions={
            <div style={{ display: "flex", gap: 8 }}>
              <input
                placeholder="Search company/order/product…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button onClick={() => setFilterOpenOnly((v) => !v)}>
                {filterOpenOnly ? "Showing Open" : "Showing All"}
              </button>
              <div>
                <label style={{ marginRight: 6 }}>Sort</label>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  <option value="dueDate">By Due Date</option>
                  <option value="order">By Order #</option>
                </select>
                <button
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  style={{ marginLeft: 8 }}
                >
                  {sortDir === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>
          }
        >
          {fetchErr && (
            <div style={{ color: "#b00020", marginBottom: 8 }}>
              {fetchErr}
            </div>
          )}
          {filtered.length === 0 && !fetchErr && (
            <div style={{ color: "#555", marginBottom: 8 }}>
              No jobs found. Toggle to “Showing All” or adjust your search.
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((o) => (
              <div
                key={o["Order #"]}
                onClick={() => onPickOrder(o)}
                style={{ cursor: "pointer", border: "1px solid #eee", borderRadius: 12, padding: 10 }}
              >
                <div style={{ fontWeight: 700 }}>
                  #{o["Order #"]} – {o["Product"]}
                </div>
                <div style={{ fontSize: 12, color: "#555" }}>{o["Company Name"]}</div>
                <div style={{ fontSize: 12, color: "#555" }}>Due: {o["Due Date"]}</div>
                {o["Preview"] && (
                  <div style={{ marginTop: 6 }}>
                    <img
                      alt="preview"
                      src={o["Preview"]}
                      style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8 }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {selectedOrder && (
        <>
          <Section
            title={`Recut #${selectedOrder["Order #"]} — ${selectedOrder["Product"]}`}
            actions={<button onClick={() => setSelectedOrder(null)}>Clear all</button>}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div>Recut quantity:</div>
              <input
                type="number"
                min="1"
                step="1"
                value={recutQty}
                onChange={(e) => setRecutQty(e.target.value)}
                style={{ width: 100 }}
              />
              <button onClick={submitRecut} style={{ marginLeft: "auto" }}>
                Append recut rows
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
              These are the original usage rows (excluding any previously marked Recut). Check what you are remaking.
            </div>
            <div style={{ marginTop: 10 }}>
              <button onClick={allOn} style={{ marginRight: 8 }}>
                Select all
              </button>
              <button onClick={allOff}>Clear all</button>
            </div>
            <div style={{ marginTop: 10 }}>
              {(originalUsage || []).map((it) => (
                <label
                  key={it.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 2fr 2fr 1fr 1fr",
                    gap: 8,
                    padding: 6,
                    borderBottom: "1px solid #f0f0f0",
                  }}
                >
                  <input type="checkbox" checked={!!checked[it.id]} onChange={() => toggle(it.id)} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{it.material}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{it.shape}</div>
                  </div>
                  <div>Original Qty (pieces): {it.quantity}</div>
                  <div>Units used: {it.qtyUnits}</div>
                  <div>
                    Per piece: {(Number(it.qtyUnits) / Math.max(1, Number(it.quantity))).toFixed(4)}
                  </div>
                </label>
              ))}
            </div>
            {err && <div style={{ color: "#b00020", marginTop: 8 }}>{err}</div>}
            {ok && <div style={{ color: "#0a0", marginTop: 8 }}>{ok}</div>}
          </Section>
        </>
      )}
    </>
  );
}

export default function MaterialLog() {
  const [mode, setMode] = useState(""); // "RD" | "RECUT" | ""
  return (
    <div style={{ padding: 16 }}>
      {!mode && (
        <div style={{ display: "flex", gap: 12 }}>
          <Tile onClick={() => setMode("RD")}>R&amp;D</Tile>
          <Tile onClick={() => setMode("RECUT")}>Recut</Tile>
        </div>
      )}

      {mode === "RD" && (
        <>
          <button onClick={() => setMode("")} style={{ marginBottom: 12 }}>
            Back
          </button>
          <RDForm />
        </>
      )}

      {mode === "RECUT" && (
        <>
          <button onClick={() => setMode("")} style={{ marginBottom: 12 }}>
            Back
          </button>
          <Recut />
        </>
      )}
    </div>
  );
}
