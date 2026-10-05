import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";

const EMPTY_FORM = {
  companyName: "",
  contactFirstName: "",
  contactLastName: "",
  contactEmailAddress: "",
  shippingEmail: "",
  phoneNumber: "",
  shippingPhone: "",
  shippingAttention: "",
  streetAddress1: "",
  streetAddress2: "",
  streetAddress3: "",
  city: "",
  state: "",
  zipCode: "",
  billingSameAsShipping: true,
  billingSameAsContact: true,
  billingFirstName: "",
  billingLastName: "",
  billingEmail1: "",
  billingEmail2: "",
  billingEmail3: "",
  billingPhone: "",
  billingStreetAddress1: "",
  billingStreetAddress2: "",
  billingStreetAddress3: "",
  billingCity: "",
  billingState: "",
  billingZip: "",
};

const inputStyle = {
  width: "100%",
  padding: "0.5rem",
  fontSize: "1rem",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "#334155",
  marginBottom: 4,
};

function Field({ label, name, value, onChange, disabled, type = "text" }) {
  return (
    <div>
      <label style={labelStyle} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value || ""}
        disabled={disabled}
        onChange={onChange}
        style={{
          ...inputStyle,
          background: disabled ? "#f1f5f9" : "#fff",
        }}
      />
    </div>
  );
}

export default function EditCustomer() {
  const [companyList, setCompanyList] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [updateQuickbooks, setUpdateQuickbooks] = useState(true);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingRow, setLoadingRow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let mounted = true;
    const source = axios.CancelToken.source();
    setLoadingCustomers(true);
    axios
      .get(`${API_ROOT}/directory`, { cancelToken: source.token })
      .then((res) => {
        if (!mounted) return;
        const names = (res.data || []).filter(
          (name) => typeof name === "string" && name.trim()
        );
        setCompanyList(names);
      })
      .catch((err) => {
        if (!mounted || axios.isCancel(err)) return;
        console.error("Failed to load customers", err);
      })
      .finally(() => {
        if (mounted) setLoadingCustomers(false);
      });
    return () => {
      mounted = false;
      source.cancel("unmount");
    };
  }, []);

  const filteredCompanies = useMemo(() => {
    const q = companyInput.trim().toLowerCase();
    if (!q) return companyList;
    return companyList.filter((name) => name.toLowerCase().includes(q));
  }, [companyInput, companyList]);

  const loadCompany = useCallback(async (name) => {
    const company = String(name || "").trim();
    if (!company) return;
    setSelectedCompany(company);
    setCompanyInput(company);
    setLoadingRow(true);
    setMessage(null);
    try {
      const res = await axios.get(
        `${API_ROOT}/directory-customer?company=${encodeURIComponent(company)}`
      );
      const next = { ...EMPTY_FORM, ...(res.data?.form || {}) };
      next.companyName = res.data?.company || company;
      setForm(next);
    } catch (err) {
      console.error("Failed to load customer", err);
      setForm({ ...EMPTY_FORM, companyName: company });
      setMessage({
        kind: "error",
        text: err.response?.data?.error || "Failed to load this customer.",
      });
    } finally {
      setLoadingRow(false);
    }
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => {
      const next = {
        ...prev,
        [name]: type === "checkbox" ? checked : value,
      };
      const syncBillingContact =
        name === "billingSameAsContact"
          ? checked
          : Boolean(next.billingSameAsContact);
      if (syncBillingContact) {
        next.billingFirstName = next.contactFirstName;
        next.billingLastName = next.contactLastName;
        next.billingEmail1 = next.contactEmailAddress;
        next.billingPhone = next.phoneNumber;
      }
      const syncBillingAddr =
        name === "billingSameAsShipping"
          ? checked
          : Boolean(next.billingSameAsShipping);
      if (syncBillingAddr) {
        next.billingStreetAddress1 = next.streetAddress1;
        next.billingStreetAddress2 = next.streetAddress2;
        next.billingStreetAddress3 = next.streetAddress3;
        next.billingCity = next.city;
        next.billingState = next.state;
        next.billingZip = next.zipCode;
      }
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCompany) {
      setMessage({ kind: "error", text: "Select a customer first." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await axios.put(`${API_ROOT}/directory-customer`, {
        ...form,
        companyName: selectedCompany,
        updateQuickbooks,
      });
      const qbo = res.data?.quickbooks || {};
      if (res.data?.form) {
        setForm({ ...EMPTY_FORM, ...res.data.form, companyName: selectedCompany });
      }
      if (updateQuickbooks && qbo.updated) {
        setMessage({
          kind: "ok",
          text: qbo.created
            ? "Directory saved, and this customer was created in QuickBooks."
            : "Directory saved, and the QuickBooks customer was updated.",
        });
      } else if (updateQuickbooks && qbo.error) {
        setMessage({
          kind: "warn",
          text: `Directory saved. QuickBooks was not updated: ${qbo.error}`,
          redirect: qbo.redirect,
        });
      } else {
        setMessage({
          kind: "ok",
          text: "Directory saved. Future UPS labels and invoices will use this buyer.",
        });
      }
    } catch (err) {
      console.error("Failed to save customer", err);
      setMessage({
        kind: "error",
        text: err.response?.data?.error || "Failed to save customer.",
      });
    } finally {
      setSaving(false);
    }
  };

  const billingLocked = Boolean(form.billingSameAsContact);
  const billingAddrLocked = Boolean(form.billingSameAsShipping);

  return (
    <div style={{ padding: "2rem", maxWidth: 980, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>Customers</h2>
      <p style={{ color: "#4b5563", marginTop: 0, lineHeight: 1.45 }}>
        When a buyer leaves, pick the company and update the buyer and billing
        contacts here. That writes the Directory sheet this app uses. Check
        QuickBooks to update that customer&apos;s name, email, phone, and
        bill/ship addresses. UPS does not keep a separate address book in this
        app — new labels and tracking emails use Directory at ship time.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          list="edit-customer-company-options"
          value={companyInput}
          onChange={(e) => setCompanyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const match = companyList.find(
                (name) => name.toLowerCase() === companyInput.trim().toLowerCase()
              );
              if (match) loadCompany(match);
            }
          }}
          placeholder="Type a customer name..."
          style={{ width: 320, padding: "0.5rem", fontSize: "1rem" }}
        />
        <datalist id="edit-customer-company-options">
          {companyList.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => {
            const match = companyList.find(
              (name) => name.toLowerCase() === companyInput.trim().toLowerCase()
            );
            if (match) loadCompany(match);
          }}
          disabled={!companyInput.trim() || loadingRow}
          style={{
            padding: "0.5rem 1rem",
            background: "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: loadingRow ? "not-allowed" : "pointer",
            opacity: loadingRow ? 0.7 : 1,
          }}
        >
          Open
        </button>
      </div>

      {loadingCustomers && (
        <p style={{ color: "#64748b" }}>Loading customers…</p>
      )}

      {filteredCompanies.length > 0 && (
        <div style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
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
            {filteredCompanies.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => loadCompany(name)}
                style={{
                  padding: "0.45rem 0.55rem",
                  textAlign: "left",
                  borderRadius: 6,
                  border:
                    selectedCompany === name ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
                  background: selectedCompany === name ? "#eff6ff" : "#fff",
                  cursor: "pointer",
                  fontWeight: selectedCompany === name ? 700 : 500,
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {loadingRow && <p>Loading customer…</p>}

      {selectedCompany && !loadingRow && (
        <form onSubmit={handleSubmit}>
          <h3 style={{ marginBottom: 8 }}>{selectedCompany}</h3>

          <section
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <h4 style={{ marginTop: 0 }}>Buyer / shipping contact</h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <Field label="First name" name="contactFirstName" value={form.contactFirstName} onChange={handleChange} />
              <Field label="Last name" name="contactLastName" value={form.contactLastName} onChange={handleChange} />
              <Field label="Email" name="contactEmailAddress" type="email" value={form.contactEmailAddress} onChange={handleChange} />
              <Field label="Phone" name="phoneNumber" value={form.phoneNumber} onChange={handleChange} />
              <Field label="Shipping notify email" name="shippingEmail" type="email" value={form.shippingEmail} onChange={handleChange} />
              <Field label="Attention / receiving" name="shippingAttention" value={form.shippingAttention} onChange={handleChange} />
            </div>
          </section>

          <section
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <h4 style={{ marginTop: 0 }}>Shipping address</h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <Field label="Street 1" name="streetAddress1" value={form.streetAddress1} onChange={handleChange} />
              <Field label="Street 2" name="streetAddress2" value={form.streetAddress2} onChange={handleChange} />
              <Field label="Street 3" name="streetAddress3" value={form.streetAddress3} onChange={handleChange} />
              <Field label="City" name="city" value={form.city} onChange={handleChange} />
              <Field label="State" name="state" value={form.state} onChange={handleChange} />
              <Field label="Zip" name="zipCode" value={form.zipCode} onChange={handleChange} />
            </div>
          </section>

          <section
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <h4 style={{ marginTop: 0 }}>Billing</h4>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input
                type="checkbox"
                name="billingSameAsContact"
                checked={Boolean(form.billingSameAsContact)}
                onChange={handleChange}
              />
              Billing contact is the same as the buyer
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                name="billingSameAsShipping"
                checked={Boolean(form.billingSameAsShipping)}
                onChange={handleChange}
              />
              Billing address is the same as shipping
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <Field label="Billing first name" name="billingFirstName" value={form.billingFirstName} onChange={handleChange} disabled={billingLocked} />
              <Field label="Billing last name" name="billingLastName" value={form.billingLastName} onChange={handleChange} disabled={billingLocked} />
              <Field label="Billing email 1" name="billingEmail1" type="email" value={form.billingEmail1} onChange={handleChange} disabled={billingLocked} />
              <Field label="Billing email 2" name="billingEmail2" type="email" value={form.billingEmail2} onChange={handleChange} />
              <Field label="Billing email 3" name="billingEmail3" type="email" value={form.billingEmail3} onChange={handleChange} />
              <Field label="Billing phone" name="billingPhone" value={form.billingPhone} onChange={handleChange} disabled={billingLocked} />
              {!billingAddrLocked && (
                <>
                  <Field label="Billing street 1" name="billingStreetAddress1" value={form.billingStreetAddress1} onChange={handleChange} />
                  <Field label="Billing street 2" name="billingStreetAddress2" value={form.billingStreetAddress2} onChange={handleChange} />
                  <Field label="Billing city" name="billingCity" value={form.billingCity} onChange={handleChange} />
                  <Field label="Billing state" name="billingState" value={form.billingState} onChange={handleChange} />
                  <Field label="Billing zip" name="billingZip" value={form.billingZip} onChange={handleChange} />
                </>
              )}
            </div>
          </section>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={updateQuickbooks}
              onChange={(e) => setUpdateQuickbooks(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              Also update this customer in QuickBooks (name, email, phone, bill
              and ship addresses). Does not change the company name.
            </span>
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "0.65rem 1.2rem",
              background: "#0f766e",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: saving ? "not-allowed" : "pointer",
              fontWeight: 700,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save customer"}
          </button>
        </form>
      )}

      {message && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.85rem 1rem",
            borderRadius: 8,
            background:
              message.kind === "ok"
                ? "#ecfdf5"
                : message.kind === "warn"
                ? "#fffbeb"
                : "#fef2f2",
            border: `1px solid ${
              message.kind === "ok"
                ? "#6ee7b7"
                : message.kind === "warn"
                ? "#fcd34d"
                : "#fecaca"
            }`,
            color:
              message.kind === "ok"
                ? "#065f46"
                : message.kind === "warn"
                ? "#92400e"
                : "#991b1b",
            fontWeight: 600,
          }}
        >
          {message.text}
          {message.redirect && (
            <div style={{ marginTop: 8, fontWeight: 500 }}>
              <a href={message.redirect}>Connect QuickBooks</a> and save again
              if you want the QuickBooks customer updated.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
