import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const API_ROOT = (process.env.REACT_APP_API_ROOT || "/api").replace(/\/$/, "");

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function OrderConfirmationPage() {
  const [companyList, setCompanyList] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [jobs, setJobs] = useState([]);
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

  const handleDownloadPdf = async () => {
    if (!selectedCompany) {
      alert("Select a customer first.");
      return;
    }
    setPdfLoading(true);
    try {
      const res = await axios.get(
        `${API_ROOT}/order-confirmation-pdf?company=${encodeURIComponent(selectedCompany)}`,
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

  const grandTotal = jobs.reduce((sum, job) => sum + Number(job.LineTotal || 0), 0);

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
        Select a customer to view all outstanding jobs (stage is not Complete). Back jobs are excluded.
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

      {selectedCompany && !loading && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <strong>{selectedCompany}</strong>
            <span style={{ color: "#6b7280", marginLeft: 8 }}>
              {jobs.length} outstanding job{jobs.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            style={{
              padding: "0.5rem 1rem",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: pdfLoading ? "not-allowed" : "pointer",
              opacity: pdfLoading ? 0.7 : 1,
              fontWeight: 600,
            }}
          >
            {pdfLoading ? "Generating PDF…" : "Download PDF"}
          </button>
        </div>
      )}

      <div style={{ marginTop: "0.5rem" }}>
        {jobs.map((job, idx) => (
          <div
            key={`${job.orderId || job["Order #"]}-${idx}`}
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid #d1d5db",
              padding: "0.85rem",
              borderRadius: 10,
              marginBottom: "0.85rem",
              gap: "1rem",
              background: "#fff",
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                flexShrink: 0,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
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
                    color: "#9ca3af",
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
              <div style={{ color: "#374151", marginBottom: 4 }}>
                {job.Product || "?"}
              </div>
              <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                Order #{job["Order #"] || "?"} | Stage: {job.Stage || "—"}
                {job["Due Date"] ? ` | Due: ${job["Due Date"]}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right", minWidth: 120 }}>
              <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Qty</div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{job.Quantity ?? "?"}</div>
            </div>
            <div style={{ textAlign: "right", minWidth: 120 }}>
              <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Price</div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(job.Price)}</div>
              <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: 2 }}>
                Total {formatMoney(job.LineTotal)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedCompany && !loading && jobs.length > 0 && (
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: "1.1rem", marginTop: 8 }}>
          Grand Total: {formatMoney(grandTotal)}
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
