import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

// Your standard box catalog
const BOX_CATALOG = [
  { label: "10×10×10", L: 10, W: 10, H: 10 },
  { label: "13×13×13", L: 13, W: 13, H: 13 },
  { label: "17×17×17", L: 17, W: 17, H: 17 },
  { label: "17×20×20", L: 17, W: 20, H: 20 },
  { label: "14×7×5",   L: 14, W: 7,  H: 5  },
];

const US_STATE_NAME_TO_ABBR = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT",
  "delaware":"DE","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA",
  "kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI",
  "minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH",
  "new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
  "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN",
  "texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY",
  "district of columbia":"DC","washington dc":"DC","dc":"DC"
};
const toStateAbbr = (v = "") => {
  const s = String(v).trim();
  if (s.length === 2) return s.toUpperCase();
  return US_STATE_NAME_TO_ABBR[s.toLowerCase()] || s.toUpperCase();
};
const toZip5 = (v = "") => {
  const m = String(v).match(/(\d{5})/);
  return m ? m[1] : "";
};
const get = (obj, key) => (obj && obj[key] != null ? String(obj[key]).trim() : "");

export default function BoxSelect() {
  const navigate = useNavigate();
  const location = useLocation();

  // Load selected jobs from navigation state or sessionStorage
  const selectedJobs = useMemo(() => {
    let fromState = location.state?.selectedJobs;
    if (fromState && Array.isArray(fromState) && fromState.length > 0) {
      sessionStorage.setItem("ship:selectedJobs", JSON.stringify(fromState));
      return fromState;
    }
    const saved = sessionStorage.getItem("ship:selectedJobs");
    try {
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [location.state]);

  useEffect(() => {
    if (!selectedJobs || selectedJobs.length === 0) {
      alert("No jobs selected. Returning to Ship.");
      navigate("/ship");
    }
  }, [selectedJobs, navigate]);

  // Box "cart": size label -> count
  const [boxCounts, setBoxCounts] = useState({});
  const [shippingOptions, setShippingOptions] = useState([]);
  const [selectedRate, setSelectedRate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  const addBox = (label) => {
    setSelectedRate(null);
    setShippingOptions([]);
    setBoxCounts((prev) => ({ ...prev, [label]: (prev[label] || 0) + 1 }));
  };
  const removeBox = (label) => {
    setSelectedRate(null);
    setShippingOptions([]);
    setBoxCounts((prev) => {
      const next = { ...prev };
      if (!next[label]) return next;
      if (next[label] <= 1) delete next[label];
      else next[label] = next[label] - 1;
      return next;
    });
  };
  const totalBoxes = Object.values(boxCounts).reduce((a, b) => a + b, 0);

  // Build packages array from cart (repeat each box count times)
  const packagesFromCart = useMemo(() => {
    const list = [];
    for (const item of BOX_CATALOG) {
      const count = boxCounts[item.label] || 0;
      for (let i = 0; i < count; i++) {
        const L = item.L, W = item.W, H = item.H;
        const weight = Math.max(1, Math.ceil((L * W * H) / 1728)); // ~1 lb per cubic ft
        list.push({
          PackagingType: "02",
          Weight: weight,
          Dimensions: { Length: L, Width: W, Height: H }
        });
      }
    }
    return list;
  }, [boxCounts]);

  // Build the ship-to address from the first job; you can expand this to choose one explicitly
  const buildRecipientFrom = (row) => ({
    Name:          get(row, "Company Name"),
    AttentionName: `${get(row, "Contact First Name")} ${get(row, "Contact Last Name")}`.trim(),
    Phone:         get(row, "Phone Number"),
    Address: {
      AddressLine1:      get(row, "Street Address 1"),
      AddressLine2:      get(row, "Street Address 2"),
      City:              get(row, "City"),
      StateProvinceCode: toStateAbbr(get(row, "State")),
      PostalCode:        toZip5(get(row, "Zip Code")),
      CountryCode:       "US"
    }
  });

  const tryDirectoryFallback = async (recipient, job) => {
    const needs = !recipient.Address.AddressLine1 ||
                  !recipient.Address.City ||
                  !recipient.Address.StateProvinceCode ||
                  recipient.Address.StateProvinceCode.length !== 2 ||
                  !recipient.Address.PostalCode ||
                  recipient.Address.PostalCode.length !== 5;

    if (!needs) return recipient;

    try {
      const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
      const company = get(job, "Company Name") || job.Company || job.Customer || "";
      const res = await fetch(`${API_BASE}/api/directory-row?company=${encodeURIComponent(company)}`, { credentials: "include" });
      if (!res.ok) return recipient;
      const row = await res.json();
      return buildRecipientFrom(row);
    } catch {
      return recipient;
    }
  };

  const getRates = async () => {
    setErrorText("");
    setSelectedRate(null);
    setShippingOptions([]);
    if (totalBoxes === 0) {
      alert("Add at least one box.");
      return;
    }
    const job = selectedJobs[0]; // assume same destination; you can expand later
    let recipient = buildRecipientFrom(job);
    recipient = await tryDirectoryFallback(recipient, job);

    const missing = [];
    if (!recipient.Address.AddressLine1) missing.push("street");
    if (!recipient.Address.City) missing.push("city");
    if (!recipient.Address.StateProvinceCode || recipient.Address.StateProvinceCode.length !== 2) missing.push("2-letter state");
    if (!recipient.Address.PostalCode || recipient.Address.PostalCode.length !== 5) missing.push("5-digit ZIP");
    if (missing.length) {
      setErrorText(`Recipient address incomplete (missing: ${missing.join(", ")}).`);
      return;
    }

    // Build payloads
    const shipper = {
      Name: "JR & Co.",
      AttentionName: "Justin Eckard",
      Phone: "678-294-5350",
      Address: {
        AddressLine1: "3653 Lost Oak Drive",
        AddressLine2: "",
        City: "Buford",
        StateProvinceCode: "GA",
        PostalCode: "30519",
        CountryCode: "US",
      },
    };

    // Mega + legacy compatibility
    const normParty = (p) => {
      const Name = p?.Name?.trim() || "Unknown";
      const AttentionName = p?.AttentionName || "";
      const Phone = p?.Phone || "";
      const A1 = p?.Address?.AddressLine1 || "";
      const A2 = p?.Address?.AddressLine2 || "";
      const City = p?.Address?.City || "";
      const State = p?.Address?.StateProvinceCode || "";
      const Zip = p?.Address?.PostalCode || "";
      const Ctry = p?.Address?.CountryCode || "US";
      return { Name, AttentionName, Phone, A1, A2, City, State, Zip, Ctry };
    };
    const recip = normParty(recipient);
    const shipr = normParty(shipper);

    const packagesMega = (packagesFromCart || []).map((pkg) => {
      const Wt = Number(pkg.Weight) || 1;
      const Lg = Number(pkg.Dimensions?.Length) || 1;
      const Wd = Number(pkg.Dimensions?.Width) || 1;
      const Hg = Number(pkg.Dimensions?.Height) || 1;
      const PackType = pkg.PackagingType || "02";
      return {
        PackagingType: PackType,
        Weight: Wt,
        Dimensions: { Length: Lg, Width: Wd, Height: Hg, L: Lg, W: Wd, H: Hg, Unit: "IN" },
        packagingType: PackType,
        weight: Wt,
        weightUnit: "LB",
        dimensions: { length: Lg, width: Wd, height: Hg, unit: "IN", L: Lg, W: Wd, H: Hg },
        Length: Lg, Width: Wd, Height: Hg, L: Lg, W: Wd, H: Hg, dimUnit: "IN",
      };
    });

    const partyVariants = ({ Name, AttentionName, Phone, A1, A2, City, State, Zip, Ctry }) => ({
      Name, AttentionName, Phone,
      Address: { AddressLine1: A1, AddressLine2: A2, City, StateProvinceCode: State, PostalCode: Zip, CountryCode: Ctry },
      name: Name, attentionName: AttentionName, phone: Phone,
      address: { addressLine1: A1, addressLine2: A2, city: City, state: State, postalCode: Zip, countryCode: Ctry },
      addressLine1: A1, addressLine2: A2, city: City, state: State, postalCode: Zip, countryCode: Ctry,
      attention: AttentionName, addr1: A1, addr2: A2, zip: Zip, country: Ctry,
    });

    const shipperAll = partyVariants(shipr);
    const recipientAll = partyVariants(recip);

    const megaPayload = {
      shipper: shipperAll,
      recipient: recipientAll,
      from: shipperAll,
      to: recipientAll,
      packages: packagesMega,
    };

    const legacyOnly = {
      shipper: {
        name: shipr.Name, attention: shipr.AttentionName, phone: shipr.Phone,
        addr1: shipr.A1, addr2: shipr.A2, city: shipr.City, state: shipr.State, zip: shipr.Zip, country: shipr.Ctry,
      },
      recipient: {
        name: recip.Name, attention: recip.AttentionName, phone: recip.Phone,
        addr1: recip.A1, addr2: recip.A2, city: recip.City, state: recip.State, zip: recip.Zip, country: recip.Ctry,
      },
      packages: (packagesFromCart || []).map((pkg) => {
        const Wt = Number(pkg.Weight) || 1;
        const Lg = Number(pkg.Dimensions?.Length) || 1;
        const Wd = Number(pkg.Dimensions?.Width) || 1;
        const Hg = Number(pkg.Dimensions?.Height) || 1;
        return { packagingType: pkg.PackagingType || "02", weight: Wt, length: Lg, width: Wd, height: Hg, L: Lg, W: Wd, H: Hg, dimUnit: "IN", weightUnit: "LB" };
      }),
    };

    const API_BASE = process.env.REACT_APP_API_ROOT.replace(/\/api$/, "");
    const ratesUrl = `${API_BASE}/api/rate`;

    const postAndParse = async (url, payload) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let body = null;
      try { body = JSON.parse(raw); } catch { /* keep raw */ }
      return { res, raw, body };
    };

    setLoading(true);
    try {
      let { res, raw, body } = await postAndParse(ratesUrl, megaPayload);
      if (res.status === 400) {
        ({ res, raw, body } = await postAndParse(ratesUrl, legacyOnly));
      }
      if (!res.ok) {
        const detail = (body && (body.error || body.message || body.detail)) || raw || `HTTP ${res.status}`;
        setErrorText(`UPS rates error [${res.status}]: ${String(detail).slice(0, 500)}`);
        setShippingOptions([]);
        return;
      }
      const options = Array.isArray(body) ? body : (body?.rates || []);
      if (!Array.isArray(options) || options.length === 0) {
        setErrorText("No live UPS rates returned.");
        setShippingOptions([]);
        return;
      }
      setShippingOptions(options);
    } catch (err) {
      setErrorText(`UPS rates error: ${(err && err.message) || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const uniqueCompanies = useMemo(() => {
    return Array.from(new Set((selectedJobs || []).map(j => j["Company Name"] || j.Company || ""))).filter(Boolean);
  }, [selectedJobs]);

  return (
    <div style={{ padding: "2rem", maxWidth: 980, margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>← Back</button>
      <h2>📦 Choose Boxes & Get Rates</h2>

      {uniqueCompanies.length > 1 && (
        <div style={{ background: "#fff7d6", border: "1px solid #e0c972", padding: 12, borderRadius: 8, margin: "12px 0" }}>
          Multiple companies selected; using the first job’s address for rating.
        </div>
      )}

      <h4>Selected Jobs</h4>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        {(selectedJobs || []).map((j) => (
          <div key={j.orderId} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px dashed #eee" }}>
            <div style={{ width: 70 }}>#{j.orderId}</div>
            <div style={{ flex: 1 }}>{j.Design || j.Product || ""}</div>
            <div style={{ width: 80, textAlign: "right" }}>{j.Quantity ?? j.shipQty ?? ""}</div>
          </div>
        ))}
      </div>

      <h4>Add Boxes</h4>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        {BOX_CATALOG.map(({ label }) => (
          <div key={label} style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, minWidth: 180 }}>
            <div style={{ fontWeight: "bold", marginBottom: 8 }}>{label}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => removeBox(label)} disabled={!boxCounts[label]}>−</button>
              <div style={{ width: 32, textAlign: "center" }}>{boxCounts[label] || 0}</div>
              <button onClick={() => addBox(label)}>＋</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <button
          onClick={getRates}
          disabled={totalBoxes === 0 || loading}
          style={{ padding: "10px 16px", fontWeight: "bold" }}
        >
          {loading ? "Getting Rates..." : "Get Rates"}
        </button>
        <button
          onClick={() => { setBoxCounts({}); setShippingOptions([]); setSelectedRate(null); setErrorText(""); }}
          style={{ marginLeft: 8, padding: "10px 16px" }}
        >
          Reset Boxes
        </button>
      </div>

      {errorText && (
        <div style={{ background: "#ffe9e9", border: "1px solid #d33", padding: 12, borderRadius: 8, margin: "12px 0" }}>
          {errorText}
        </div>
      )}

      {shippingOptions.length > 0 && (
        <>
          <h4>Rates</h4>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {shippingOptions.map((opt, i) => (
              <button
                key={i}
                onClick={() => setSelectedRate(opt)}
                style={{
                  border: "1px solid #333",
                  borderRadius: 8,
                  padding: 12,
                  minWidth: 220,
                  background: selectedRate === opt ? "#e6f7ff" : "#fff",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: "bold" }}>{opt.method || opt.service || "UPS"}</div>
                <div>Price: {String(opt.rate ?? opt.price ?? "")}</div>
                <div>ETA: {String(opt.delivery ?? opt.eta ?? "")}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
