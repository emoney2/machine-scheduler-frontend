import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function ReorderPage() {
  const [companyList, setCompanyList] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingCustomersText, setLoadingCustomersText] = useState("Loading customers…");
  const inputRef = useRef(null);
  const jobsRequestRef = useRef(null);
  const inputDebounceRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const cancelTokenSource = axios.CancelToken.source();
    
    console.log("🔄 Fetching company list...");
    setLoadingCustomers(true);
    setLoadingCustomersText("Loading customers…");
    
    axios
      .get(`${process.env.REACT_APP_API_ROOT}/directory`, {
        cancelToken: cancelTokenSource.token
      })
      .then((res) => {
        if (!isMounted) return;
        const names = (res.data || [])
          .map((name) => name)
          .filter((name) => typeof name === "string" && name.trim());
        console.log("✅ Company list loaded:", names);
        setCompanyList(names);
      })
      .catch((err) => {
        if (!isMounted || axios.isCancel(err)) return;
        console.error("❌ Failed to load company names", err);
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
      // Also cancel any jobs request if component unmounts
      if (jobsRequestRef.current) {
        jobsRequestRef.current.cancel("Component unmounted");
        jobsRequestRef.current = null;
      }
      // Clear debounce timer
      if (inputDebounceRef.current) {
        clearTimeout(inputDebounceRef.current);
        inputDebounceRef.current = null;
      }
    };
  }, []);

  const handleCompanySelect = async (value) => {
    console.log("🏢 Company selected:", value);
    setCompanyInput(value);
    if (!companyList.includes(value)) {
      console.log("⚠️ Company not in list:", value);
      return;
    }

    // Cancel any in-flight request
    if (jobsRequestRef.current) {
      jobsRequestRef.current.cancel("New company selected");
    }

    const cancelTokenSource = axios.CancelToken.source();
    jobsRequestRef.current = cancelTokenSource;

    setLoading(true);
    try {
      const res = await axios.get(
        `${process.env.REACT_APP_API_ROOT}/jobs-for-company?company=${encodeURIComponent(value)}`,
        { cancelToken: cancelTokenSource.token }
      );
      console.log("📦 Jobs loaded:", res.data.jobs);
      setJobs(res.data.jobs || []);
    } catch (err) {
      if (axios.isCancel(err)) {
        console.log("⏹️ Jobs request cancelled");
        return;
      }
      console.error("❌ Failed to load jobs for company:", value, err);
      alert("Failed to load jobs.");
    } finally {
      if (jobsRequestRef.current === cancelTokenSource) {
        jobsRequestRef.current = null;
      }
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    console.log("⌨️ Typing:", val);
    setCompanyInput(val);
    
    // Clear any existing debounce timer
    if (inputDebounceRef.current) {
      clearTimeout(inputDebounceRef.current);
    }
    
    // Debounce the company selection to avoid rapid-fire requests
    inputDebounceRef.current = setTimeout(() => {
      if (companyList.includes(val)) {
        console.log("✅ Match found in companyList, fetching jobs...");
        handleCompanySelect(val);
      } else {
        console.log("🔍 No exact match yet.");
      }
    }, 300); // 300ms debounce
  };

  const handleReorder = (job) => {
    console.log("🔁 Reordering job:", job);
    navigate("/order", { state: { reorderJob: job } });
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h2>🔁 Reorder a Previous Job</h2>

      <input
        list="company-options"
        value={companyInput}
        onChange={handleInputChange}
        placeholder="Start typing a company..."
        ref={inputRef}
        style={{ width: "300px", padding: "0.5rem", fontSize: "1rem" }}
      />
      <datalist id="company-options">
        {companyList.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {loading && <p>Loading jobs…</p>}

      {/* 🌕 Page Overlay for loading customers */}
      {loadingCustomers && (
        <div style={{
          position: "fixed",
          top: 0, left: 0,
          width: "100vw", height: "100vh",
          backgroundColor: "rgba(255, 247, 194, 0.65)", // transparent yellow
          zIndex: 9998,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: "1.25rem",
          fontWeight: "bold"
        }}>
          {loadingCustomersText || "Loading…"}
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        {jobs.map((job, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid #ccc",
              padding: "0.75rem",
              borderRadius: "8px",
              marginBottom: "1rem",
              gap: "1rem",
            }}
          >
            <img
              src={job.image || ""}
              alt=""
              style={{ width: 60, height: 60, objectFit: "cover" }}
            />
            <div style={{ flex: 1 }}>
              <strong>{job.Design || "(No Design)"}</strong> — {job.Product || "?"} ({job.Quantity || "?"})
              <br />
              Order #{job["Order #"] || "?"} | Due: {job["Due Date"] || "?"}
            </div>
            <button onClick={() => handleReorder(job)}>Reorder</button>
          </div>
        ))}
      </div>
    </div>
  );
}
