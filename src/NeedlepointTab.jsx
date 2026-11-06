import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";
import { socket } from "./socketClient";

const BACKEND_ROOT = API_ROOT.replace(/\/api$/, "");

function toDate(v) {
  if (v == null) return null;
  if (typeof v === "number" && isFinite(v)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    return new Date(base.getTime() + v * 86400000);
  }
  const d = new Date(String(v).trim());
  return isNaN(d) ? null : d;
}

function fmtMMDD(d) {
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

function isNeedlepointProduct(product) {
  return String(product || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .includes("needlepoint");
}

function isTowelProduct(product) {
  return String(product || "").toLowerCase().includes("towel");
}

function isOutsourcedProduct(product) {
  return isNeedlepointProduct(product) || isTowelProduct(product);
}

function productKind(product) {
  if (isNeedlepointProduct(product)) return "Needlepoint";
  if (isTowelProduct(product)) return "Towel";
  return "Outsourced";
}

function extractFileIdFromFormulaOrUrl(input) {
  if (!input) return null;
  const s = String(input);
  let m = s.match(/IMAGE\("([^"]+)"/i);
  if (m) return extractFileIdFromFormulaOrUrl(m[1]);
  if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return s;
  m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/\/(?:open|uc)[^?]*\?[^#]*\bid=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return null;
}

function resolveOrderPreview(order) {
  const proxyBase = `${BACKEND_ROOT}/api/drive/thumbnail`;
  const proxyForId = (id) => {
    if (!id) return null;
    const params = new URLSearchParams({ fileId: id, sz: "w640" }).toString();
    return `${proxyBase}?${params}`;
  };

  const toPreview = (idOrUrl) => {
    if (!idOrUrl) return null;
    const id = extractFileIdFromFormulaOrUrl(idOrUrl);
    if (id) {
      return {
        fileId: id,
        thumbUrl: proxyForId(id),
        openUrl: `https://drive.google.com/file/d/${id}/view`,
      };
    }
    const str = String(idOrUrl);
    if (/^https?:\/\//i.test(str)) return { fileId: null, thumbUrl: str, openUrl: str };
    return null;
  };

  const fields = [
    order.imageUrl,
    order.image,
    order.thumbnailUrl,
    order.preview,
    order.Preview,
    order.Image,
    order.Art,
    order["Art Link"],
    order["Art URL"],
  ];
  for (const f of fields) {
    const hit = toPreview(f);
    if (hit) return hit;
  }
  for (const v of Object.values(order || {})) {
    const hit = toPreview(v);
    if (hit?.fileId) return hit;
  }
  return { fileId: null, thumbUrl: null, openUrl: null };
}

/** View-only list of outsourced jobs (towels + needlepoint). Ordering stays on Overview. */
export default function NeedlepointTab() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("All"); // All | Needlepoint | Towels
  const inFlight = useRef(false);

  const fetchOrders = useCallback(async (opts = { refresh: false }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!opts.refresh) setIsLoading(true);
      const url = `${API_ROOT}/combined${opts.refresh ? "?refresh=1" : ""}`;
      const res = await axios.get(url, { withCredentials: true });
      setOrders(res.data?.orders || []);
    } catch {
      /* keep last-known */
    } finally {
      if (!opts.refresh) setIsLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!canceled) await fetchOrders();
    })();
    const t = setInterval(() => {
      if (!canceled) fetchOrders({ refresh: true });
    }, 180000);
    const onOrdersChanged = () => {
      if (!canceled) fetchOrders({ refresh: true });
    };
    if (socket) {
      socket.on("ordersUpdated", onOrdersChanged);
      socket.on("orderUpdated", onOrdersChanged);
    }
    return () => {
      canceled = true;
      clearInterval(t);
      if (socket) {
        socket.off("ordersUpdated", onOrdersChanged);
        socket.off("orderUpdated", onOrdersChanged);
      }
    };
  }, [fetchOrders]);

  const cards = useMemo(() => {
    let base = (orders || []).filter((o) => {
      const status = String(o["Status"] || "").trim().toUpperCase();
      const stage = String(o["Stage"] || "").trim().toUpperCase();
      if (
        status === "COMPLETE" ||
        status === "COMPLETED" ||
        stage === "COMPLETE" ||
        stage === "COMPLETED"
      ) {
        return false;
      }
      return isOutsourcedProduct(o["Product"]);
    });

    if (filter === "Needlepoint") {
      base = base.filter((o) => isNeedlepointProduct(o["Product"]));
    } else if (filter === "Towels") {
      base = base.filter((o) => isTowelProduct(o["Product"]));
    }

    base.sort((a, b) => {
      const ad = toDate(a["Due Date"]);
      const bd = toDate(b["Due Date"]);
      const at = ad ? ad.getTime() : Infinity;
      const bt = bd ? bd.getTime() : Infinity;
      if (at !== bt) return at - bt;
      return String(a["Order #"] || "").localeCompare(String(b["Order #"] || ""), undefined, {
        numeric: true,
      });
    });
    return base;
  }, [orders, filter]);

  const cellBase = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textAlign: "center",
  };

  const gridTemplate = `
    70px
    180px
    150px
    160px
    50px
    140px
    90px
    80px
    70px
  `;

  return (
    <div style={{ padding: 12, fontSize: 12, lineHeight: 1.25 }}>
      <style>{`
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }
      `}</style>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Needlepoint & Towels</div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Open outsourced jobs we do not make in-house. Supplier ordering stays on Overview.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {["All", "Needlepoint", "Towels"].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setFilter(m)}
            className="btn"
            style={{ background: filter === m ? "#eee" : "#fff" }}
          >
            {m}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {isLoading ? "Loading…" : `${cards.length} open`}
        </span>
      </div>

      <div
        className="hdr"
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderRadius: 10,
          border: "1px solid #ddd",
          background: "#fafafa",
          marginBottom: 6,
        }}
      >
        <div style={cellBase}>Order #</div>
        <div style={cellBase}>Preview</div>
        <div style={cellBase}>Company</div>
        <div style={cellBase}>Design</div>
        <div style={cellBase}>Qty</div>
        <div style={cellBase}>Product</div>
        <div style={cellBase}>Type</div>
        <div style={cellBase}>Stage</div>
        <div style={cellBase}>Due</div>
      </div>

      {isLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(255, 235, 59, 0.25)",
            backdropFilter: "blur(1px)",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: "14px 18px",
              fontWeight: 700,
              boxShadow: "0 8px 20px rgba(0,0,0,0.15)",
            }}
          >
            Loading Jobs…
          </div>
        </div>
      )}

      {cards.length === 0 ? (
        <div style={{ padding: "24px 8px", color: "#777" }}>
          No open towel or needlepoint jobs.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {cards.map((order) => {
            const orderId = String(order["Order #"] || "");
            const company = order["Company Name"] || "";
            const design = order["Design"] || "";
            const qty = order["Quantity"] || "";
            const product = order["Product"] || "";
            const stage = order["Stage"] || "";
            const due = toDate(order["Due Date"]);
            const kind = productKind(product);
            const { thumbUrl: imageUrl, openUrl } = resolveOrderPreview(order);

            return (
              <div
                key={orderId}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                <div style={{ ...cellBase, fontWeight: 700 }}>{orderId}</div>
                <div style={{ display: "grid", placeItems: "center", padding: "2px 0" }}>
                  <div
                    role={openUrl ? "button" : undefined}
                    tabIndex={openUrl ? 0 : undefined}
                    title={openUrl ? "Open full preview" : undefined}
                    onClick={
                      openUrl
                        ? (e) => {
                            e.preventDefault();
                            window.open(openUrl, "_blank", "noopener");
                          }
                        : undefined
                    }
                    style={{
                      width: 168,
                      height: 96,
                      overflow: "hidden",
                      borderRadius: 8,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "#fafafa",
                      cursor: openUrl ? "pointer" : "default",
                    }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          display: "block",
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                          color: "#666",
                        }}
                      >
                        No Preview
                      </div>
                    )}
                  </div>
                </div>
                <div style={cellBase}>{company}</div>
                <div style={cellBase}>{design}</div>
                <div style={cellBase}>{qty}</div>
                <div style={cellBase}>{product}</div>
                <div style={cellBase}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: kind === "Needlepoint" ? "#ecfdf5" : "#eff6ff",
                      color: kind === "Needlepoint" ? "#047857" : "#1d4ed8",
                      border:
                        kind === "Needlepoint" ? "1px solid #a7f3d0" : "1px solid #bfdbfe",
                    }}
                  >
                    {kind}
                  </span>
                </div>
                <div style={cellBase}>{stage}</div>
                <div style={cellBase}>{fmtMMDD(due)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
