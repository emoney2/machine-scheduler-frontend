import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";
import { socket } from "./socketClient";
import {
  composeNeedlepointThreadColors,
  rowsFromPaletteColors,
  NeedlepointThreadColorEditor,
  NeedlepointVendorGridPreview,
} from "./needlepointUi";

const BACKEND_ROOT = API_ROOT.replace(/\/api$/, "");
const ROOT = BACKEND_ROOT;

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
    const params = new URLSearchParams({ fileId: id, sz: "w160" }).toString();
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

function openUrlReturn(url) {
  try {
    const w = window.open(url, "_blank", "noopener,width=980,height=720");
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
      }, 0);
      return w;
    }
  } catch {
    /* ignore */
  }
  alert("Popup was blocked. Please allow pop-ups for this site and click Order again.");
  return null;
}

function productKind(product) {
  if (isNeedlepointProduct(product)) return "Needlepoint";
  if (isTowelProduct(product)) return "Towel";
  return "Outsourced";
}

export default function NeedlepointTab() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("All"); // All | Needlepoint | Towels
  const inFlight = useRef(false);

  const [needlepointOrders, setNeedlepointOrders] = useState([]);
  const [loadingNeedlepoint, setLoadingNeedlepoint] = useState(true);
  const [needlepointSupplierEmail, setNeedlepointSupplierEmail] = useState("");
  const [needlepointSelected, setNeedlepointSelected] = useState({});
  const [needlepointOrderModal, setNeedlepointOrderModal] = useState(false);
  const [needlepointThreadColors, setNeedlepointThreadColors] = useState({});
  const [needlepointColorDrafts, setNeedlepointColorDrafts] = useState({});
  const [needlepointColorLoading, setNeedlepointColorLoading] = useState({});
  const [needlepointColorErrors, setNeedlepointColorErrors] = useState({});
  const [needlepointOrderNotes, setNeedlepointOrderNotes] = useState("");
  const [needlepointSubmitting, setNeedlepointSubmitting] = useState(false);
  const [gmailPopup, setGmailPopup] = useState(null);

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

  const fetchNeedlepointOrders = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoadingNeedlepoint(true);
    try {
      const res = await axios.get(`${ROOT}/needlepoint/pending`, {
        withCredentials: true,
        timeout: 45000,
      });
      setNeedlepointOrders(Array.isArray(res.data?.orders) ? res.data.orders : []);
      if (res.data?.supplierEmail) {
        setNeedlepointSupplierEmail(String(res.data.supplierEmail));
      }
    } catch (e) {
      console.warn("Needlepoint pending fetch failed:", e);
      setNeedlepointOrders([]);
    } finally {
      if (showLoading) setLoadingNeedlepoint(false);
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!canceled) await fetchOrders();
      if (!canceled) await fetchNeedlepointOrders({ showLoading: true });
    })();
    const t = setInterval(() => {
      if (!canceled) fetchOrders({ refresh: true });
      if (!canceled) fetchNeedlepointOrders({ showLoading: false });
    }, 180000);
    const onOrdersChanged = () => {
      if (!canceled) {
        fetchOrders({ refresh: true });
        fetchNeedlepointOrders({ showLoading: false });
      }
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
  }, [fetchOrders, fetchNeedlepointOrders]);

  useEffect(() => {
    if (!gmailPopup) return undefined;
    const id = setInterval(() => {
      if (gmailPopup && gmailPopup.closed) setGmailPopup(null);
    }, 800);
    return () => clearInterval(id);
  }, [gmailPopup]);

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

  const selectedNeedlepointOrders = useMemo(
    () => (needlepointOrders || []).filter((o) => needlepointSelected[o.orderNumber]),
    [needlepointOrders, needlepointSelected]
  );

  const syncNeedlepointDraftToThreadColors = useCallback((orderNumber, draft) => {
    const composed = composeNeedlepointThreadColors(draft?.rows, draft?.extra);
    setNeedlepointThreadColors((prev) => ({ ...prev, [orderNumber]: composed }));
  }, []);

  const updateNeedlepointColorDraft = useCallback(
    (orderNumber, draft) => {
      setNeedlepointColorDrafts((prev) => ({ ...prev, [orderNumber]: draft }));
      syncNeedlepointDraftToThreadColors(orderNumber, draft);
    },
    [syncNeedlepointDraftToThreadColors]
  );

  const loadNeedlepointDesignColors = useCallback(
    async (orderNumber, seedExtra = "") => {
      setNeedlepointColorLoading((prev) => ({ ...prev, [orderNumber]: true }));
      setNeedlepointColorErrors((prev) => ({ ...prev, [orderNumber]: "" }));
      try {
        const res = await axios.get(
          `${ROOT}/needlepoint/order/${encodeURIComponent(orderNumber)}/colors`,
          { withCredentials: true, timeout: 90000 }
        );
        const palette = Array.isArray(res.data?.colors) ? res.data.colors : [];
        const draft = {
          rows: rowsFromPaletteColors(palette),
          extra: String(seedExtra || "").trim(),
        };
        setNeedlepointColorDrafts((prev) => ({ ...prev, [orderNumber]: draft }));
        syncNeedlepointDraftToThreadColors(orderNumber, draft);
        if (!palette.length) {
          setNeedlepointColorErrors((prev) => ({
            ...prev,
            [orderNumber]: "No colors detected — enter numbers manually.",
          }));
        }
      } catch (e) {
        const msg = e?.response?.data?.error || e?.message || "Could not load design colors";
        setNeedlepointColorErrors((prev) => ({ ...prev, [orderNumber]: msg }));
        const draft = { rows: [], extra: String(seedExtra || "").trim() };
        setNeedlepointColorDrafts((prev) => ({ ...prev, [orderNumber]: draft }));
        syncNeedlepointDraftToThreadColors(orderNumber, draft);
      } finally {
        setNeedlepointColorLoading((prev) => ({ ...prev, [orderNumber]: false }));
      }
    },
    [syncNeedlepointDraftToThreadColors]
  );

  const openNeedlepointOrderModal = () => {
    if (!selectedNeedlepointOrders.length) {
      alert("Select one or more needlepoint belts to order.");
      return;
    }
    setNeedlepointOrderModal(true);
    selectedNeedlepointOrders.forEach((o) => {
      const existingDraft = needlepointColorDrafts[o.orderNumber];
      if (existingDraft?.rows?.length) {
        syncNeedlepointDraftToThreadColors(o.orderNumber, existingDraft);
        return;
      }
      loadNeedlepointDesignColors(o.orderNumber, o.threadColors || "");
    });
  };

  const submitNeedlepointBeltOrder = async () => {
    const rows = selectedNeedlepointOrders;
    if (!rows.length) {
      alert("Select one or more needlepoint belts to order.");
      return;
    }
    const missing = rows.filter((o) => !String(needlepointThreadColors[o.orderNumber] || "").trim());
    if (missing.length) {
      alert(`Enter thread colors for order ${missing[0].orderNumber} before creating the email.`);
      return;
    }
    const to = String(needlepointSupplierEmail || "").trim();
    if (!to.includes("@")) {
      alert("Enter the supplier email address.");
      return;
    }
    setNeedlepointSubmitting(true);
    try {
      const payload = {
        to,
        notes: needlepointOrderNotes,
        orders: rows.map((o) => ({
          orderNumber: o.orderNumber,
          company: o.company,
          design: o.design,
          sizes: o.sizes,
          sizeSummary: o.sizeSummary,
          qty: o.qty,
          threadColors: String(needlepointThreadColors[o.orderNumber] || "").trim(),
        })),
      };
      const res = await axios.post(`${ROOT}/needlepoint/order-belts`, payload, {
        withCredentials: true,
        timeout: 120000,
      });
      const data = res.data || {};
      const method = data.method || "";
      const missingDesigns = Array.isArray(data.missingDesigns) ? data.missingDesigns : [];
      const pdfPayloads = Array.isArray(data.attachmentsBase64) ? data.attachmentsBase64 : [];

      const needsManualAttach =
        method === "compose_download" || method === "compose_url" || method === "none";
      if (needsManualAttach && pdfPayloads.length) {
        for (const file of pdfPayloads) {
          try {
            const bin = atob(String(file.contentBase64 || ""));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: file.mime || "application/pdf" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.filename || "design.pdf";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } catch (dlErr) {
            console.error("PDF download failed:", dlErr);
          }
        }
      }

      const openUrl = data.draftUrl || (needsManualAttach ? data.composeUrl : "");
      if (openUrl) {
        const popup = openUrlReturn(openUrl);
        if (popup) setGmailPopup(popup);
      }

      let msg = "Belt order email is ready.";
      if (method === "gmail_draft") {
        msg = "Gmail draft created with design PDF(s) attached. Review the draft, then Send.";
      } else if (method === "smtp") {
        msg = "Email sent to the supplier with design PDF(s) attached.";
      } else if (data.needsGmailAuth) {
        msg =
          "Google login needs Gmail permission. " +
          (pdfPayloads.length
            ? `Downloaded ${pdfPayloads.map((f) => f.filename).join(", ")} — paperclip them before sending.`
            : "");
      } else if (needsManualAttach) {
        msg = pdfPayloads.length
          ? `Downloaded ${pdfPayloads.map((f) => f.filename).join(", ")}. Attach in Gmail before sending.`
          : data.error || "No design PDF was found to attach.";
      }
      if (missingDesigns.length) {
        msg += ` Could not find a design PDF for order(s): ${missingDesigns.join(", ")}.`;
      }
      alert(msg);
      setNeedlepointOrderModal(false);
      setNeedlepointSelected({});
      setNeedlepointOrderNotes("");
      fetchNeedlepointOrders({ showLoading: false });
    } catch (e) {
      console.error("Needlepoint belt order failed:", e);
      alert(e?.response?.data?.error || e?.message || "Failed to create belt order email.");
    } finally {
      setNeedlepointSubmitting(false);
    }
  };

  const cellBase = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textAlign: "center",
  };

  const gridTemplate = `
    70px
    56px
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
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        .hdr { font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase; }
        .btn { padding: 6px 10px; border-radius: 10px; border: 1px solid #bbb; font-weight: 700; cursor: pointer; }
      `}</style>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Needlepoint & Towels</div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Outsourced products we do not make in-house. Needlepoint belts can be ordered from the
          supplier below; towels and needlepoint jobs are listed as cards (not on the Scheduler).
        </div>
      </div>

      {/* Pending needlepoint belts to order */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>Needlepoint belts to order</span>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {loadingNeedlepoint ? "Loading…" : `${needlepointOrders.length} waiting`}
          </span>
          <button
            type="button"
            onClick={openNeedlepointOrderModal}
            disabled={!selectedNeedlepointOrders.length}
            className="btn"
            style={{
              marginLeft: "auto",
              background: selectedNeedlepointOrders.length ? "#0a7" : "#f3f4f6",
              color: selectedNeedlepointOrders.length ? "#fff" : "#9ca3af",
              borderColor: selectedNeedlepointOrders.length ? "#0a7" : "#bbb",
              cursor: selectedNeedlepointOrders.length ? "pointer" : "not-allowed",
            }}
          >
            Order selected ({selectedNeedlepointOrders.length})
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
          Select belts, enter thread colors, then create one supplier email with designs attached.
        </div>
        {loadingNeedlepoint ? (
          <div style={{ fontSize: 13, color: "#6b7280" }}>Loading needlepoint orders…</div>
        ) : !needlepointOrders.length ? (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>No needlepoint belts waiting to order.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {needlepointOrders.map((row) => {
              const checked = !!needlepointSelected[row.orderNumber];
              const thumb = row.previewFileId
                ? `${ROOT}/drive/thumbnail?fileId=${encodeURIComponent(row.previewFileId)}&sz=w120`
                : null;
              return (
                <label
                  key={row.orderNumber}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "22px 56px 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    border: checked ? "1px solid #0a7" : "1px solid #e5e7eb",
                    background: checked ? "#f0fdf4" : "#fff",
                    borderRadius: 8,
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setNeedlepointSelected((prev) => ({
                        ...prev,
                        [row.orderNumber]: e.target.checked,
                      }))
                    }
                  />
                  <div
                    style={{
                      width: 56,
                      height: 32,
                      borderRadius: 6,
                      overflow: "hidden",
                      background: "#fafafa",
                      border: "1px solid #e5e7eb",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>No art</span>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      #{row.orderNumber} {row.company ? `· ${row.company}` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: "#4b5563" }}>
                      {[row.design, row.sizeSummary || `qty ${row.qty || 0}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{row.qty || 0}</div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Open outsourced jobs as cards */}
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
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                <div style={{ ...cellBase, fontWeight: 700 }}>{orderId}</div>
                <div style={{ display: "grid", placeItems: "center" }}>
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
                      width: 50,
                      height: 34,
                      overflow: "hidden",
                      borderRadius: 6,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "#fff",
                      cursor: openUrl ? "pointer" : "default",
                    }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
                          fontSize: 10,
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

      {needlepointOrderModal && (
        <div
          className="ms-dialog-overlay ms-dialog-overlay--fullscreen"
          style={{
            position: "fixed",
            inset: 0,
            background: "#fff",
            zIndex: 1600,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: "#fff",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                flex: "0 0 auto",
                padding: "16px 20px 12px",
                borderBottom: "1px solid #e5e7eb",
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 10,
                }}
              >
                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                  <h3 style={{ margin: "0 0 4px", fontSize: 20 }}>Order needlepoint belts</h3>
                  <div style={{ fontSize: 13, color: "#4b5563" }}>
                    Use each vendor grid as color reference, enter thread colors, then we create one
                    email with the grids attached and renamed to the order number.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setNeedlepointOrderModal(false)}
                    disabled={needlepointSubmitting}
                    style={{ padding: "8px 14px", border: "1px solid #ccc", borderRadius: 8 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitNeedlepointBeltOrder}
                    disabled={needlepointSubmitting}
                    style={{
                      padding: "8px 14px",
                      border: "1px solid #0a7",
                      background: "#0a7",
                      color: "#fff",
                      borderRadius: 8,
                      fontWeight: 600,
                    }}
                  >
                    {needlepointSubmitting ? "Creating email…" : "Create email"}
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(240px, 1.2fr) minmax(200px, 1fr)",
                  gap: 12,
                }}
              >
                <label style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                  Supplier email
                  <input
                    type="text"
                    value={needlepointSupplierEmail}
                    onChange={(e) => setNeedlepointSupplierEmail(e.target.value)}
                    placeholder="sales05@…, lingchoi@…"
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: 8,
                      border: "1px solid #ccc",
                      borderRadius: 8,
                      fontWeight: 400,
                      boxSizing: "border-box",
                    }}
                  />
                </label>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                  Notes for this email
                  <input
                    type="text"
                    value={needlepointOrderNotes}
                    onChange={(e) => setNeedlepointOrderNotes(e.target.value)}
                    placeholder="Optional notes…"
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: 8,
                      border: "1px solid #ccc",
                      borderRadius: 8,
                      fontWeight: 400,
                      boxSizing: "border-box",
                    }}
                  />
                </label>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "16px 20px 24px",
                background: "#f1f5f9",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {selectedNeedlepointOrders.map((row) => (
                <div
                  key={row.orderNumber}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 16,
                    alignItems: "stretch",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 16,
                    boxSizing: "border-box",
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    flex: selectedNeedlepointOrders.length === 1 ? "1 1 auto" : "0 0 auto",
                    minHeight: selectedNeedlepointOrders.length === 1 ? "100%" : undefined,
                  }}
                >
                  <div
                    style={{
                      flex: "0 1 420px",
                      minWidth: 280,
                      maxWidth: 520,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      #{row.orderNumber} {row.company ? `· ${row.company}` : ""}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#4b5563",
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {[row.design, row.sizeSummary].filter(Boolean).join(" · ")}
                    </div>
                    <NeedlepointThreadColorEditor
                      orderNumber={row.orderNumber}
                      draft={
                        needlepointColorDrafts[row.orderNumber] || {
                          rows: [],
                          extra: needlepointThreadColors[row.orderNumber] || "",
                        }
                      }
                      onChange={(draft) => updateNeedlepointColorDraft(row.orderNumber, draft)}
                      loading={!!needlepointColorLoading[row.orderNumber]}
                      error={needlepointColorErrors[row.orderNumber] || ""}
                    />
                  </div>
                  <NeedlepointVendorGridPreview
                    orderNumber={row.orderNumber}
                    previewFileId={row.previewFileId}
                    root={ROOT}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {gmailPopup && !gmailPopup.closed && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            background: "#111",
            color: "#fff",
            padding: "10px 12px",
            borderRadius: 10,
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 2000,
          }}
        >
          <div style={{ fontSize: 12 }}>Gmail compose is open. After you send, you can close it.</div>
          <button
            type="button"
            onClick={() => {
              try {
                gmailPopup.close();
              } catch {
                /* ignore */
              }
              setGmailPopup(null);
            }}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #fff",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Close Gmail
          </button>
        </div>
      )}
    </div>
  );
}
