// Shared needlepoint ordering UI (thread colors + vendor grid preview)
import React from "react";
import axios from "axios";

export function composeNeedlepointThreadColors(rows, extra) {
  const parts = (rows || [])
    .map((r) => [String(r.code || "").trim(), String(r.label || "").trim()].filter(Boolean).join(" "))
    .filter(Boolean);
  const extraText = String(extra || "").trim();
  if (extraText) parts.push(extraText);
  return parts.join(", ");
}

function newManualColorRow() {
  return {
    key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    hex: "#CCCCCC",
    name: "",
    stitchCount: 0,
    source: "manual",
    code: "",
    label: "",
    suggestions: [],
  };
}

export function rowsFromPaletteColors(colors) {
  return (colors || []).map((c, i) => ({
    key: String(c.id || `p${i}`),
    hex: c.hex || "#CCCCCC",
    name: c.name || "",
    stitchCount: c.stitchCount || 0,
    source: "palette",
    code: "",
    label: "",
    suggestions: Array.isArray(c.suggestions) ? c.suggestions : [],
  }));
}

/** Per-design color list: swatches + DMC suggestions + editable numbers. */
export function NeedlepointThreadColorEditor({
  orderNumber,
  draft,
  onChange,
  loading,
  error,
}) {
  const rows = draft?.rows || [];
  const extra = draft?.extra || "";

  const updateRow = (key, patch) => {
    onChange({
      ...draft,
      rows: rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    });
  };

  const removeRow = (key) => {
    onChange({ ...draft, rows: rows.filter((r) => r.key !== key) });
  };

  const addRow = () => {
    onChange({ ...draft, rows: [...rows, newManualColorRow()] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Thread colors*</div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>
        Colors from the design are listed below. Click a DMC suggestion or type your own numbers —
        suggestions only, nothing is locked.
      </div>
      {loading && (
        <div style={{ fontSize: 13, color: "#6b7280" }}>Loading design colors…</div>
      )}
      {!!error && !loading && (
        <div style={{ fontSize: 12, color: "#b45309" }}>{error}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row, idx) => (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr auto",
              gap: 10,
              alignItems: "start",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 10,
              background: "#fafafa",
            }}
          >
            <div
              title={row.hex}
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                background: row.hex || "#ccc",
                border: "1px solid #d1d5db",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.35)",
              }}
            />
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#4b5563" }}>
                Color {idx + 1}
                {row.name ? ` · ${row.name}` : ""}
                {row.stitchCount ? ` · ${row.stitchCount} stitches` : ""}
                {row.source === "manual" ? " · manual" : ""}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={row.code}
                  onChange={(e) => updateRow(row.key, { code: e.target.value })}
                  placeholder="Number"
                  aria-label={`Color ${idx + 1} number`}
                  style={{
                    width: 88,
                    padding: "6px 8px",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => updateRow(row.key, { label: e.target.value })}
                  placeholder="Name (optional)"
                  aria-label={`Color ${idx + 1} name`}
                  style={{
                    flex: "1 1 120px",
                    minWidth: 100,
                    padding: "6px 8px",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              {!!(row.suggestions || []).length && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(row.suggestions || []).map((sug) => {
                    const active =
                      String(row.code || "").trim() === String(sug.code || "").trim();
                    return (
                      <button
                        key={`${row.key}-${sug.code}`}
                        type="button"
                        onClick={() =>
                          updateRow(row.key, {
                            code: sug.code || "",
                            label: sug.name || "",
                          })
                        }
                        title={`Suggest ${sug.label || sug.code}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: active ? "1px solid #0a7" : "1px solid #d1d5db",
                          background: active ? "#ecfdf5" : "#fff",
                          cursor: "pointer",
                          fontSize: 11,
                          color: "#111827",
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 3,
                            background: sug.hex || "#ccc",
                            border: "1px solid #9ca3af",
                            flex: "0 0 auto",
                          }}
                        />
                        DMC {sug.code}
                        {sug.name ? ` ${sug.name}` : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              title="Remove color"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 12,
                color: "#6b7280",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={addRow}
          style={{
            padding: "6px 10px",
            border: "1px solid #ccc",
            borderRadius: 8,
            background: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Add color
        </button>
      </div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600 }}>
        Extra / freeform (optional)
        <textarea
          rows={2}
          value={extra}
          onChange={(e) => onChange({ ...draft, extra: e.target.value })}
          placeholder="Anything else to include in the email…"
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 8,
            fontWeight: 400,
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
            fontSize: 13,
          }}
        />
      </label>
      <div style={{ fontSize: 12, color: "#374151" }}>
        <span style={{ fontWeight: 600 }}>Email will list: </span>
        {composeNeedlepointThreadColors(rows, extra) || (
          <span style={{ color: "#9ca3af" }}>enter numbers above</span>
        )}
      </div>
      {/* keep orderNumber referenced for future debugging / keys */}
      <span style={{ display: "none" }}>{orderNumber}</span>
    </div>
  );
}

/** Loads the same stitch-grid PDF the supplier email attaches, for color reference. */
export function NeedlepointVendorGridPreview({ orderNumber, previewFileId, root }) {
  const [objectUrl, setObjectUrl] = React.useState(null);
  const [status, setStatus] = React.useState("loading"); // loading | ready | error
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    let createdUrl = null;
    setStatus("loading");
    setError("");
    setObjectUrl(null);

    (async () => {
      try {
        const res = await axios.get(
          `${root}/needlepoint/order/${encodeURIComponent(orderNumber)}/grid`,
          { withCredentials: true, responseType: "blob", timeout: 90000 }
        );
        if (cancelled) return;
        const blob = res.data;
        if (!(blob instanceof Blob) || blob.size < 8) {
          throw new Error("Empty grid PDF");
        }
        const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
        const isPdf =
          head.length >= 4 &&
          head[0] === 0x25 &&
          head[1] === 0x50 &&
          head[2] === 0x44 &&
          head[3] === 0x46; // %PDF
        if (!isPdf || (blob.type || "").includes("json")) {
          const text = await blob.text();
          let msg = "No vendor grid PDF found";
          try {
            msg = JSON.parse(text)?.error || msg;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        let msg = e?.message || "Could not load grid";
        const data = e?.response?.data;
        if (data instanceof Blob) {
          try {
            const parsed = JSON.parse(await data.text());
            if (parsed?.error) msg = parsed.error;
          } catch {
            /* ignore */
          }
        } else if (data?.error) {
          msg = data.error;
        }
        setStatus("error");
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [orderNumber, root]);

  const beltThumb = previewFileId
    ? `${root}/drive/thumbnail?fileId=${encodeURIComponent(previewFileId)}&sz=w640`
    : null;

  return (
    <div
      style={{
        flex: "1 1 520px",
        minWidth: 320,
        minHeight: "60vh",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        background: "#f8fafc",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignSelf: "stretch",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#64748b",
          padding: "8px 10px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
          flex: "0 0 auto",
        }}
      >
        Vendor grid (what they receive)
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: "56vh" }}>
        {status === "loading" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: "#6b7280",
            }}
          >
            Loading grid…
          </div>
        )}
        {status === "ready" && objectUrl && (
          <iframe
            title={`Vendor grid ${orderNumber}`}
            src={objectUrl}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: 0,
              background: "#fff",
            }}
          />
        )}
        {status === "error" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: 16,
              textAlign: "center",
            }}
          >
            {beltThumb ? (
              <img
                src={beltThumb}
                alt=""
                style={{
                  maxWidth: "100%",
                  maxHeight: 200,
                  objectFit: "contain",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                }}
              />
            ) : null}
            <div style={{ fontSize: 12, color: "#b45309" }}>
              {error || "Grid PDF unavailable"} — showing belt preview if available.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
