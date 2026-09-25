import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ROOT } from "./apiRoot";
import { writeActiveReorderBatch } from "./reorderBatchStore";

function orderIdStr(job) {
  return String(job.orderId ?? job["Order #"] ?? "").trim();
}

function dueDateWeeksFromNow(weeks) {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split("T")[0];
}

function jobQuantity(job) {
  return String(job?.Quantity ?? job?.quantity ?? "").trim();
}

export default function ReorderPage() {
  const [companyList, setCompanyList] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [dueDate, setDueDate] = useState("");
  const [dateType, setDateType] = useState("Hard Date");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingCustomersText, setLoadingCustomersText] = useState("Loading customers…");
  const inputRef = useRef(null);
  const jobsRequestRef = useRef(null);
  const inputDebounceRef = useRef(null);
  const companyListRef = useRef([]);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const cancelTokenSource = axios.CancelToken.source();

    setLoadingCustomers(true);
    setLoadingCustomersText("Loading customers…");

    axios
      .get(`${API_ROOT}/directory`, {
        cancelToken: cancelTokenSource.token,
      })
      .then((res) => {
        if (!isMounted) return;
        const names = (res.data || [])
          .map((name) => name)
          .filter((name) => typeof name === "string" && name.trim());
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
      if (inputDebounceRef.current) {
        clearTimeout(inputDebounceRef.current);
        inputDebounceRef.current = null;
      }
    };
  }, []);

  const handleCompanySelect = useCallback(async (value) => {
    setCompanyInput(value);
    if (!companyListRef.current.includes(value)) return;

    if (jobsRequestRef.current) {
      jobsRequestRef.current.cancel("New company selected");
    }

    const cancelTokenSource = axios.CancelToken.source();
    jobsRequestRef.current = cancelTokenSource;

    setLoading(true);
    setSelected([]);
    setOverrides({});
    setSubmitMessage("");
    try {
      const res = await axios.get(
        `${API_ROOT}/jobs-for-company?company=${encodeURIComponent(value)}`,
        { cancelToken: cancelTokenSource.token }
      );
      setJobs(res.data.jobs || []);
    } catch (err) {
      if (axios.isCancel(err)) return;
      console.error("Failed to load jobs for company:", value, err);
      alert("Failed to load jobs.");
    } finally {
      if (jobsRequestRef.current === cancelTokenSource) {
        jobsRequestRef.current = null;
      }
      setLoading(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (e) => {
      const val = e.target.value;
      setCompanyInput(val);
      if (inputDebounceRef.current) {
        clearTimeout(inputDebounceRef.current);
      }
      inputDebounceRef.current = setTimeout(() => {
        if (companyListRef.current.includes(val)) {
          handleCompanySelect(val);
        }
      }, 300);
    },
    [handleCompanySelect]
  );

  const toggleSelect = (job) => {
    const idStr = orderIdStr(job);
    if (!idStr) return;
    setSelected((prev) =>
      prev.includes(idStr) ? prev.filter((id) => id !== idStr) : [...prev, idStr]
    );
    setOverrides((prev) => {
      if (prev[idStr]) return prev;
      return {
        ...prev,
        [idStr]: { quantity: jobQuantity(job), dueDate: dueDate || "" },
      };
    });
  };

  const updateOverride = (id, field, value) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: {
        quantity: prev[id]?.quantity ?? "",
        dueDate: prev[id]?.dueDate ?? "",
        [field]: value,
      },
    }));
  };

  const applyDueToSelected = (value) => {
    setDueDate(value);
    setOverrides((prev) => {
      const next = { ...prev };
      selected.forEach((id) => {
        const job = jobs.find((row) => orderIdStr(row) === id);
        next[id] = {
          quantity: next[id]?.quantity ?? jobQuantity(job),
          dueDate: value,
        };
      });
      return next;
    });
  };

  const selectedJobs = useMemo(
    () => jobs.filter((job) => selected.includes(orderIdStr(job))),
    [jobs, selected]
  );

  const handleEditOne = (job, e) => {
    e.stopPropagation();
    navigate("/order", { state: { reorderJob: job } });
  };

  const handleReorderSelected = async () => {
    if (!companyInput || !companyListRef.current.includes(companyInput)) {
      alert("Select a customer first.");
      return;
    }
    if (selected.length === 0) {
      alert("Click the jobs you want to reorder.");
      return;
    }
    const jobsPayload = selectedJobs.map((job) => {
      const id = orderIdStr(job);
      const ov = overrides[id] || {};
      return {
        orderId: id,
        quantity: ov.quantity || jobQuantity(job),
        dueDate: ov.dueDate || dueDate,
      };
    });
    if (jobsPayload.some((job) => !job.dueDate)) {
      alert("Each selected job needs a due date. Set one for all, or a date on that job.");
      return;
    }
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const res = await axios.post(`${API_ROOT}/reorder-batch`, {
        company: companyInput,
        jobs: jobsPayload,
        dueDate,
        dateType,
        notes,
      });
      writeActiveReorderBatch({
        batchId: res.data.batchId,
        company: companyInput,
        startedAt: new Date().toISOString(),
      });
      setSubmitMessage(
        `Started ${selected.length} reorder${selected.length === 1 ? "" : "s"} in the background. You can leave this page or open another tab — each job still gets its own new folder.`
      );
      setSelected([]);
    } catch (err) {
      console.error("Batch reorder failed:", err);
      alert(err.response?.data?.error || "Failed to start the reorders.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto", paddingBottom: 180 }}>
      <h2 style={{ marginTop: 0 }}>Reorder Previous Jobs</h2>
      <p style={{ color: "#4b5563", marginTop: 0 }}>
        Pick a customer and click every past job you want. Change quantity or due date on
        each selected job, or use Due date for all to fill them at once. Submit once —
        each job still gets its own new folder, and you can leave this page afterward.
      </p>

      <input
        list="company-options"
        value={companyInput}
        onChange={handleInputChange}
        placeholder="Start typing a company..."
        ref={inputRef}
        style={{ width: "320px", padding: "0.5rem", fontSize: "1rem" }}
      />
      <datalist id="company-options">
        {companyList.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {loading && <p>Loading jobs…</p>}

      {submitMessage && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.85rem 1rem",
            borderRadius: 8,
            background: "#ecfdf5",
            border: "1px solid #6ee7b7",
            color: "#065f46",
            fontWeight: 600,
          }}
        >
          {submitMessage}
        </div>
      )}

      {jobs.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: "1rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              const ids = jobs.map(orderIdStr).filter(Boolean);
              setSelected(ids);
              setOverrides((prev) => {
                const next = { ...prev };
                jobs.forEach((job) => {
                  const id = orderIdStr(job);
                  if (!id || next[id]) return;
                  next[id] = { quantity: jobQuantity(job), dueDate: dueDate || "" };
                });
                return next;
              });
            }}
            style={{ padding: "0.4rem 0.8rem", cursor: "pointer" }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            style={{ padding: "0.4rem 0.8rem", cursor: "pointer" }}
          >
            Clear
          </button>
          <span style={{ alignSelf: "center", color: "#6b7280", fontSize: 14 }}>
            {selected.length} selected
          </span>
        </div>
      )}

      <div style={{ marginTop: "1.25rem" }}>
        {jobs.map((job, idx) => {
          const id = orderIdStr(job);
          const isSelected = selected.includes(id);
          return (
            <div
              key={`${id}-${idx}`}
              role="button"
              tabIndex={0}
              onClick={() => toggleSelect(job)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSelect(job);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                border: isSelected ? "2px solid #16a34a" : "1px solid #d1d5db",
                padding: "0.75rem",
                borderRadius: 8,
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
                  color: isSelected ? "#16a34a" : "transparent",
                }}
                aria-hidden="true"
              >
                ✓
              </div>
              <img
                src={job.image || ""}
                alt=""
                style={{
                  width: 60,
                  height: 60,
                  objectFit: "cover",
                  borderRadius: 6,
                  background: "#f3f4f6",
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{job.Design || "(No Design)"}</strong> — {job.Product || "?"}
                <br />
                Order #{job["Order #"] || "?"} | Was qty {job.Quantity || "?"} | Due {job["Due Date"] || "?"}
              </div>
              {isSelected && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  style={{ display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}
                >
                  <label style={{ fontSize: 12 }}>
                    Qty
                    <input
                      type="number"
                      min="1"
                      value={overrides[id]?.quantity ?? jobQuantity(job)}
                      onChange={(e) => updateOverride(id, "quantity", e.target.value)}
                      style={{ display: "block", width: 72, marginTop: 4, padding: "0.3rem" }}
                    />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    Due
                    <input
                      type="date"
                      value={overrides[id]?.dueDate || ""}
                      onChange={(e) => updateOverride(id, "dueDate", e.target.value)}
                      style={{ display: "block", width: 140, marginTop: 4, padding: "0.3rem" }}
                    />
                  </label>
                </div>
              )}
              <button
                type="button"
                onClick={(e) => handleEditOne(job, e)}
                title="Open the order form to change this one job before submitting"
                style={{
                  flexShrink: 0,
                  padding: "0.4rem 0.7rem",
                  borderRadius: 6,
                  border: isSelected ? "1px solid #fff" : "1px solid #64748b",
                  background: isSelected ? "rgba(255,255,255,0.15)" : "#fff",
                  color: isSelected ? "#fff" : "#334155",
                  cursor: "pointer",
                }}
              >
                Edit one
              </button>
            </div>
          );
        })}
      </div>

      {jobs.length > 0 && selectedJobs.length > 0 && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            background: "#fff",
            borderTop: "1px solid #d1d5db",
            padding: "0.85rem 1.25rem 1rem",
            boxShadow: "0 -6px 20px rgba(0,0,0,0.08)",
            zIndex: 10900,
          }}
        >
          <div
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            <label style={{ fontSize: 14 }}>
              Due date for all
              <input
                type="date"
                value={dueDate}
                onChange={(e) => applyDueToSelected(e.target.value)}
                style={{ display: "block", marginTop: 4, padding: "0.35rem" }}
              />
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              {[6, 7, 8].map((weeks) => (
                <button
                  key={weeks}
                  type="button"
                  onClick={() => applyDueToSelected(dueDateWeeksFromNow(weeks))}
                  style={{ padding: "0.4rem 0.6rem", cursor: "pointer" }}
                >
                  {weeks} Weeks
                </button>
              ))}
            </div>
            <label style={{ fontSize: 14 }}>
              Date type
              <select
                value={dateType}
                onChange={(e) => setDateType(e.target.value)}
                style={{ display: "block", marginTop: 4, padding: "0.35rem" }}
              >
                <option value="Hard Date">Hard Date</option>
                <option value="Soft Date">Soft Date</option>
              </select>
            </label>
            <label style={{ fontSize: 14, flex: "1 1 180px" }}>
              Extra note (optional)
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Added to each job's original notes"
                style={{ display: "block", marginTop: 4, width: "100%", padding: "0.35rem" }}
              />
            </label>
            <button
              type="button"
              onClick={handleReorderSelected}
              disabled={submitting}
              style={{
                padding: "0.65rem 1.1rem",
                background: submitting ? "#93c5fd" : "#007bff",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              {submitting
                ? "Starting…"
                : `Reorder ${selectedJobs.length} job${selectedJobs.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
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
