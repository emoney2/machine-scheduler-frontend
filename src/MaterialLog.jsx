// src/MaterialLog.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");

// ---------- small utils ----------
function excelSerialToDate(n) {
  const base = new Date(Date.UTC(1899, 11, 30));
  return new Date(base.getTime() + Number(n) * 86400000);
}
function mmdd(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}
function formatDueDate(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") return mmdd(excelSerialToDate(raw));
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return mmdd(excelSerialToDate(Number(s)));
  const d = new Date(s);
  if (!isNaN(d)) return mmdd(d);
  return s;
}

// --- Thumbnail helpers (Drive + =IMAGE() + proxy) ---
function driveIdFromUrl(u) {
  try {
    const s = String(u || "");
    let m = s.match(/\/d\/([^/]+)/);                 // .../d/<ID>/...
    if (m) return m[1];
    m = s.match(/[?&]id=([^&]+)/);                   // ?id=<ID>
    if (m) return m[1];
    m = s.match(/open\?usp=drive_[^&]*&id=([^&]+)/); // open?usp=...&id=<ID>
    if (m) return m[1];
  } catch {}
  return "";
}
function extractUrlFromImageFormula(s) {
  const m = String(s || "").match(/=IMAGE\(\s*"([^"]+)"/i);
  return m ? m[1] : "";
}
function getPreviewUrl(obj) {
  // Try likely columns from your Production Orders sheet:
  const keys = [
    "Preview", "Image", "Thumbnail", "Image URL", "Image Link",
    "Photo", "Img", "Mockup", "Front Image", "Mockup Link"
  ];
  let raw = "";
  for (const k of keys) {
    const v = obj?.[k];
    if (v) { raw = String(v); break; }
  }
  if (!raw) return "";

  // If it's an =IMAGE("...") formula, extract the URL
  const fromFormula = extractUrlFromImageFormula(raw);
  let url = (fromFormula || raw).trim();

  // If it's a Google Drive URL, use backend proxy (works even if file is private)
  if (/^https?:\/\/(drive\.google\.com|docs\.google\.com)\//i.test(url)) {
    const id = driveIdFromUrl(url);
    if (id) return `${API_ROOT}/drive/thumbnail?fileId=${encodeURIComponent(id)}`;
  }

  // Otherwise use the URL directly
  return url;
}

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

function Row({ idx, row, onChange, onRemove }) {
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
      <div>
        <input
          list="materials-list"
          value={row.material}
          onChange={(e) => update({ material: e.target.value })}
          placeholder="Material"
          style={{ width: "100%" }}
        />
      </div>
      <div>
        <input
          list="products-list"
          value={row.product}
          onChange={(e) => update({ product: e.target.value })}
          placeholder="Product (optional)"
          style={{ width: "100%" }}
        />
      </div>
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

  const addRow = () => setRows((r) => [...r, { material: "", product: "", w: "", l: "", qty: 1 }]);
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
      if (!hasAny) continue;
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
    if (err) return setError(err);
    const payload = rows
      .filter((r) => [r.material, r.product, r.w, r.l].some((v) => String(v || "").trim()))
      .map((r) => ({
        material: r.material.trim(),
        product: r.product.trim() || null,
        widthIn: r.w !== "" ? Number(r.w) : null,
        lengthIn: r.l !== "" ? Number(r.l) : null,
        quantity: Number(r.qty),
      }));
    if (!payload.length) return setError("Nothing to submit");
    try {
      setSubmitting(true);
      await axios.post(`${API_ROOT}/material-log/rd-append`, { items: payload }, { withCredentials: true });
      setOkMsg(`Logged ${payload.length} item(s) to Material Log`);
      clearAll();
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "Failed to append");
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
          <Row key={i} idx={i} row={row} onChange={onChange} onRemove={onRemove} />
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

function Recut({ onExit }) {
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [fetchErr, setFetchErr] = useState("");
  const [filterOpenOnly, setFilterOpenOnly] = useState(true);
  const [sortKey, setSortKey] = useState("dueDate");
  const [sortDir, setSortDir] = useState("asc");
  const [query, setQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [originalUsage, setOriginalUsage] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [qtyMap, setQtyMap] = useState({});

  function normalizeOrders(raw) {
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
        setLoadingOrders(true);
        const res = await axios.get(`${API_ROOT}/orders`, { withCredentials: true });
        const list = normalizeOrders(res?.data);
        setOrders(Array.isArray(list) ? list : []);
        if (!Array.isArray(list)) setFetchErr("Orders endpoint did not return a list.");
      } catch (e) {
        console.error(e);
        setFetchErr(e?.response?.data?.error || `Failed to load orders (${e?.response?.status || "network"})`);
        setOrders([]);
      } finally {
        setLoadingOrders(false);
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
    setErr(""); setOk(""); setOriginalUsage([]); setQtyMap({});
    setLoadingDetails(true);
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
    } finally {
      setLoadingDetails(false);
    }
  };

  const setLineQty = (id, val) => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      setQtyMap((m) => ({ ...m, [id]: "" }));
    } else {
      setQtyMap((m) => ({ ...m, [id]: String(n) }));
    }
  };

  const submitRecut = async () => {
    setErr(""); setOk("");
    if (!selectedOrder) return setErr("Pick a job first");

    const chosen = (originalUsage || []).filter((it) => {
      const q = Number(qtyMap[it.id]);
      return Number.isInteger(q) && q > 0;
    });
    if (!chosen.length) return setErr("Enter a recut Qty for at least one item");

    try {
      const payload = {
        orderNumber: selectedOrder["Order #"],
        items: chosen.map((it) => ({
          id: it.id,
          material: it.material,
          shape: it.shape,
          companyName: it.companyName,
          originalQuantity: it.quantity,
          originalUnits: it.qtyUnits,
          unit: it.unit,
          recutQty: Number(qtyMap[it.id]),
        })),
      };
      await axios.post(`${API_ROOT}/material-log/recut-append`, payload, { withCredentials: true });
      setOk(`Logged ${chosen.length} recut row(s)`);
      setQtyMap({});
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.error || "Failed to append recut rows");
    }
  };

  const backFromSelected = () => setSelectedOrder(null);
  const backFromList = () => onExit?.();

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button onClick={selectedOrder ? backFromSelected : backFromList}>Back</button>
      </div>

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
          {loadingOrders && <div style={{ color: "#555", marginBottom: 8 }}>Loading jobs…</div>}
          {!loadingOrders && fetchErr && (
            <div style={{ color: "#b00020", marginBottom: 8 }}>{fetchErr}</div>
          )}
          {!loadingOrders && !fetchErr && filtered.length === 0 && (
            <div style={{ color: "#555", marginBottom: 8 }}>
              No jobs found. Toggle to “Showing All” or adjust your search.
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((o) => {
              const orderNo = o["Order #"];
              const design = (o["Design"] || "").toString();
              const product = (o["Product"] || "").toString();
              const company = (o["Company Name"] || "").toString();
              const due = formatDueDate(o["Due Date"]);
              const preview = getPreviewUrl(o);
              return (
                <div
                  key={orderNo}
                  onClick={() => onPickOrder(o)}
                  style={{ cursor: "pointer", border: "1px solid #eee", borderRadius: 12, padding: 10 }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 10, alignItems: "center" }}>
                    <div>
                      {preview ? (
                        <img
                          alt=""
                          src={preview}
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                          style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 8, background: "#f7f7f7" }}
                        />
                      ) : (
                        <div style={{ width: 88, height: 88, borderRadius: 8, background: "#f0f0f0" }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>
                        #{orderNo} — {design || product}
                      </div>
                      <div style={{ fontSize: 12, color: "#555" }}>{company}</div>
                      {product && <div style={{ fontSize: 12, color: "#555" }}>{product}</div>}
                      <div style={{ fontSize: 12, color: "#555" }}>Due: {due}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {selectedOrder && (
        <>
          <Section
            title={
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {(() => {
                  const selPreview = getPreviewUrl(selectedOrder);
                  return selPreview ? (
                    <img
                      alt=""
                      src={selPreview}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                      style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 8, background: "#f7f7f7" }}
                    />
                  ) : null;
                })()}
                <span>
                  Recut #{selectedOrder["Order #"]} — {selectedOrder["Product"]}
                </span>
              </div>
            }
            actions={<button onClick={() => setSelectedOrder(null)}>Clear all</button>}
          >
            {loadingDetails ? (
              <div style={{ color: "#555" }}>Loading job details…</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  Enter a recut Qty (whole number) for each material you are remaking.
                </div>

                <div style={{ marginTop: 10 }}>
                  {(originalUsage || []).map((it) => {
                    const perPiece = Number(it.qtyUnits) / Math.max(1, Number(it.quantity));
                    const usedRounded = Number(it.qtyUnits || 0).toFixed(2);
                    const perRounded = Number(perPiece || 0).toFixed(2);
                    const unit = it.unit || "Units";
                    return (
                      <div
                        key={it.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "2fr 1.2fr 1.2fr auto",
                          gap: 8,
                          padding: 6,
                          borderBottom: "1px solid #f0f0f0",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>{it.material}</div>
                          <div style={{ fontSize: 12, color: "#666" }}>{it.shape}</div>
                        </div>
                        <div>Used ({unit}): {usedRounded}</div>
                        <div>Per piece ({unit}): {perRounded}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <label htmlFor={`rq-${it.id}`} style={{ fontSize: 12 }}>Qty</label>
                          <input
                            id={`rq-${it.id}`}
                            type="number"
                            min="0"
                            step="1"
                            placeholder=""
                            value={qtyMap[it.id] ?? ""}
                            onChange={(e) => setLineQty(it.id, e.target.value)}
                            style={{ width: 80 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {err && <div style={{ color: "#b00020", marginTop: 8 }}>{err}</div>}
                {ok && <div style={{ color: "#0a0", marginTop: 8 }}>{ok}</div>}

                <div style={{ marginTop: 12 }}>
                  <button onClick={submitRecut} style={{ padding: "8px 14px", fontWeight: 600 }}>
                    Submit
                  </button>
                </div>
              </>
            )}
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
          <Recut onExit={() => setMode("")} />
        </>
      )}
    </div>
  );
}
