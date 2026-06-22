import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function orderIdStr(job) {
  return String(job.orderId ?? job["Order #"] ?? "").trim();
}

export default function OrderConfirmationPage() {
  const [companyList, setCompanyList] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingCustomersText, setLoadingCustomersText] = useState("Loading customers…");
  const [pdfLoading, setPdfLoading] = useState(false);
  const jobsRequestRef = useRef(null);
  const companyListRef = useRef([]);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const cancelTokenSource = axios.CancelToken.source();

    setLoadingCustomers(true);
    setLoadingCustomersText("Loading customers…");

    axios
      .get(`${API_ROOT}/directory`, { cancelToken: cancelTokenSource.token })
      .then((res) => {
        if (!isMounted) return;
        const names = (res.data || [])
          .filter((name) => typeof name === "string" && name.trim())
          .sort((a, b) => a.localeCompare(b));
        setCompanyList(names);
        companyListRef.current = names;
      })
      .catch((err) => {
        if (!isMounted || axios.isCancel(err)) return;
        console.error("Failed to load company names", err);
      })
      .finally(() => {
        if (isMounted) {
          setLoadingCustomers(false);
          setLoadingCustomersText("");
        }
      });

    return () => {
      isMounted = false;
      cancelTokenSource.cancel("Component unmounted");
      if (jobsRequestRef.current) {
        jobsRequestRef.current.cancel("Component unmounted");
        jobsRequestRef.current = null;
      }
    };
  }, []);

  const loadOutstandingJobs = useCallback(async (companyName) => {
    const value = String(companyName || "").trim();
    if (!value) return;
    if (!companyListRef.current.includes(value)) {
      alert("Please select a valid customer from the list.");
      return;
    }

    if (jobsRequestRef.current) {
      jobsRequestRef.current.cancel("New company selected");
    }

    const cancelTokenSource = axios.CancelToken.source();
    jobsRequestRef.current = cancelTokenSource;

    setLoading(true);
    setSelectedCompany(value);
    setSelected([]);
    try {
      const res = await axios.get(
        `${API_ROOT}/outstanding-orders-for-company?company=${encodeURIComponent(value)}`,
        { cancelToken: cancelTokenSource.token }
      );
      setJobs(res.data.jobs || []);
    } catch (err) {
      if (axios.isCancel(err)) return;
      console.error("Failed to load outstanding jobs:", value, err);
      alert("Failed to load outstanding orders.");
    } finally {
      if (jobsRequestRef.current === cancelTokenSource) {
        jobsRequestRef.current = null;
      }
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    loadOutstandingJobs(companyInput);
  };

  const toggleSelect = (orderId) => {
    const idStr = String(orderId).trim();
    setSelected((prev) =>
      prev.includes(idStr) ? prev.filter((id) => id !== idStr) : [...prev, idStr]
    );
  };

  const handleSelectAll = () => {
    setSelected(jobs.map((job) => orderIdStr(job)).filter(Boolean));
  };

  const handleClearSelection = () => {
    setSelected([]);
  };

  const selectedJobs = useMemo(
    () => jobs.filter((job) => selected.includes(orderIdStr(job))),
    [jobs, selected]
  );

  const grandTotal = selectedJobs.reduce((sum, job) => sum + Number(job.LineTotal || 0), 0);

  const handleDownloadPdf = async () => {
    if (!selectedCompany) {
      alert("Select a customer first.");
      return;
    }
    if (selected.length === 0) {
      alert("Select at least one job for the order confirmation.");
      return;
    }
    setPdfLoading(true);
    try {
      const res = await axios.get(
        `${API_ROOT}/order-confirmation-pdf?company=${encodeURIComponent(selectedCompany)}&order_ids=${encodeURIComponent(selected.join(","))}`,
        { responseType: "blob" }
      );
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `order_confirmation_${selectedCompany.replace(/[^\w-]+/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
      alert("Failed to generate PDF.");
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Order Confirmation</h2>
        <button
          type="button"
          onClick={() => navigate("/submit")}
          style={{
            padding: "0.4rem 0.8rem",
            borderRadius: 6,
            border: "1px solid #64748b",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Back to Order Submission
        </button>
      </div>

      <p style={{ color: "#4b5563", marginTop: 0 }}>
        Select a customer, then click the jobs you want on the order confirmation. Back jobs are excluded.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1rem" }}>
        <input
          list="order-conf-company-options"
          value={companyInput}
          onChange={(e) => setCompanyInput(e.target.value)}
          placeholder="Type a customer name..."
          style={{ width: 320, padding: "0.5rem", fontSize: "1rem" }}
        />
        <datalist id="order-conf-company-options">
          {companyList.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={!companyInput.trim() || loading}
          style={{
            padding: "0.5rem 1rem",
            background: "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          Submit
        </button>
      </form>

      {companyList.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 8, color: "#374151" }}>
            Customers
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 8,
              maxHeight: 220,
              overflowY: "auto",
              padding: 4,
            }}
          >
            {companyList.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setCompanyInput(name);
                  loadOutstandingJobs(name);
                }}
                style={{
                  padding: "0.45rem 0.6rem",
                  borderRadius: 8,
                  border: selectedCompany === name ? "2px solid #007bff" : "1px solid #d1d5db",
                  background: selectedCompany === name ? "#eff6ff" : "#fff",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={name}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <p>Loading outstanding orders…</p>}

      {selectedCompany && !loading && jobs.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong>{selectedCompany}</strong>
            <span style={{ color: "#6b7280", marginLeft: 8 }}>
              {selected.length} of {jobs.length} selected
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleSelectAll}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: 6,
                border: "1px solid #64748b",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              disabled={selected.length === 0}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: 6,
                border: "1px solid #64748b",
                background: "#fff",
                cursor: selected.length === 0 ? "not-allowed" : "pointer",
                opacity: selected.length === 0 ? 0.6 : 1,
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfLoading || selected.length === 0}
              style={{
                padding: "0.5rem 1rem",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: pdfLoading || selected.length === 0 ? "not-allowed" : "pointer",
                opacity: pdfLoading || selected.length === 0 ? 0.7 : 1,
                fontWeight: 600,
              }}
            >
              {pdfLoading ? "Generating PDF…" : "Download PDF"}
            </button>
          </div>
        </div>
      )}

      {selectedCompany && !loading && jobs.length > 0 && (
        <p style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: 0, marginBottom: 12 }}>
          Click a job to select or deselect it for the confirmation.
        </p>
      )}

      <div style={{ marginTop: "0.5rem" }}>
        {jobs.map((job, idx) => {
          const id = orderIdStr(job);
          const isSelected = selected.includes(id);
          return (
            <div
              key={`${id}-${idx}`}
              role="button"
              tabIndex={0}
              onClick={() => toggleSelect(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSelect(id);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                border: isSelected ? "2px solid #16a34a" : "1px solid #d1d5db",
                padding: "0.85rem",
                borderRadius: 10,
                marginBottom: "0.85rem",
                gap: "1rem",
                background: isSelected ? "#4CAF50" : "#fff",
                color: isSelected ? "#fff" : "#000",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  borderRadius: "50%",
                  border: isSelected ? "2px solid #fff" : "2px solid #9ca3af",
                  background: isSelected ? "#fff" : "transparent",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  fontSize: 14,
                  color: isSelected ? "#16a34a" : "transparent",
                }}
                aria-hidden="true"
              >
                ✓
              </div>
              <div
                style={{
                  width: 72,
                  height: 72,
                  flexShrink: 0,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: isSelected ? "1px solid rgba(255,255,255,0.35)" : "1px solid #e5e7eb",
                  background: isSelected ? "rgba(255,255,255,0.15)" : "#f9fafb",
                }}
              >
                {job.image ? (
                  <img
                    src={job.image}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      color: isSelected ? "rgba(255,255,255,0.8)" : "#9ca3af",
                    }}
                  >
                    No preview
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 4 }}>
                  {job.Design || "(No Design)"}
                </div>
                <div style={{ marginBottom: 4, opacity: isSelected ? 0.95 : 1 }}>
                  {job.Product || "?"}
                </div>
                <div style={{ fontSize: "0.85rem", opacity: isSelected ? 0.9 : 1, color: isSelected ? "inherit" : "#6b7280" }}>
                  Order #{job["Order #"] || "?"} | Stage: {job.Stage || "—"}
                  {job["Due Date"] ? ` | Due: ${job["Due Date"]}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right", minWidth: 120 }}>
                <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>Qty</div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{job.Quantity ?? "?"}</div>
              </div>
              <div style={{ textAlign: "right", minWidth: 120 }}>
                <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>Price</div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(job.Price)}</div>
                <div style={{ fontSize: "0.8rem", opacity: 0.85, marginTop: 2 }}>
                  Total {formatMoney(job.LineTotal)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedCompany && !loading && selectedJobs.length > 0 && (
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: "1.1rem", marginTop: 8 }}>
          Selected Total: {formatMoney(grandTotal)}
        </div>
      )}

      {selectedCompany && !loading && jobs.length === 0 && (
        <p style={{ color: "#6b7280" }}>No outstanding orders for this customer.</p>
      )}

      {loadingCustomers && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(255, 247, 194, 0.65)",
            zIndex: 9998,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontSize: "1.25rem",
            fontWeight: "bold",
          }}
        >
          {loadingCustomersText || "Loading…"}
        </div>
      )}
    </div>
  );
}
