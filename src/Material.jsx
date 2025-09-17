// src/pages/Material.jsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function Material() {
  const { dept, order } = useParams();
  const [info, setInfo] = useState({
    order,
    company: "—",
    title: "—",
    quantity: "—",
    thumbnailUrl: null,
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true); setErr("");
      try {
        // Optional API (add later). If it 404s, we fall back to stub.
        const root = process.env.REACT_APP_API_ROOT || "/api";
        const url  = `${root.replace(/\/$/, "")}/order-summary?dept=${encodeURIComponent(dept)}&order=${encodeURIComponent(order)}`;
        const res  = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          // Use a simple stub if no API yet
          if (mounted) setInfo({
            order,
            company: "(Unknown company)",
            title: `(Order ${order})`,
            quantity: "—",
            thumbnailUrl: `https://via.placeholder.com/640x480?text=Order+${encodeURIComponent(order)}`,
          });
        } else {
          const data = await res.json();
          if (mounted) setInfo({
            order: data.order ?? order,
            company: data.company ?? "—",
            title: data.title ?? "—",
            quantity: data.quantity ?? "—",
            thumbnailUrl: data.thumbnailUrl ?? null,
          });
        }
      } catch (e) {
        if (mounted) {
          setErr(String(e));
          setInfo({
            order,
            company: "(Unknown company)",
            title: `(Order ${order})`,
            quantity: "—",
            thumbnailUrl: `https://via.placeholder.com/640x480?text=Order+${encodeURIComponent(order)}`,
          });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => { mounted = false; };
  }, [dept, order]);

  return (
    <Frame>
      <div className="max-w-5xl mx-auto p-6">
        <header className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Order {info.order}</h1>
            <p className="opacity-60 text-sm">Dept: {dept.toUpperCase()}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => document.documentElement.requestFullscreen?.()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">Fullscreen</button>
            <button onClick={() => window.print()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">Print</button>
          </div>
        </header>

        {loading ? (
          <div className="opacity-70">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Left: fields */}
            <div className="space-y-4">
              <Field label="Order #">{info.order}</Field>
              <Field label="Company">{info.company || "—"}</Field>
              <Field label="Title">{info.title || "—"}</Field>
              <Field label="Quantity">{String(info.quantity ?? "—")}</Field>
              {err && <div className="text-sm text-red-400">{err}</div>}
            </div>

            {/* Right: thumbnail */}
            <div className="bg-white/5 rounded-2xl overflow-hidden">
              <div className="w-full aspect-[4/3] bg-black/40 flex items-center justify-center">
                {info.thumbnailUrl ? (
                  <img
                    src={info.thumbnailUrl}
                    alt={`Order ${info.order} thumbnail`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center text-white/60">No thumbnail</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-sm opacity-60">{label}</div>
      <div className="text-lg font-medium">{children}</div>
    </div>
  );
}

function Frame({ children }) {
  return <div className="min-h-screen bg-neutral-950 text-white">{children}</div>;
}
