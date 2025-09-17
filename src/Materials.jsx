// src/pages/Material.jsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function Material() {
  const { dept, order } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const root = process.env.REACT_APP_API_ROOT || "/api";
        const url  = `${root.replace(/\/$/, "")}/materials?dept=${encodeURIComponent(dept)}&order=${encodeURIComponent(order)}`;
        const res  = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) setData(json);
      } catch (e) { if (mounted) setError(String(e)); }
      finally { if (mounted) setLoading(false); }
    }
    fetchData();
    return () => { mounted = false; };
  }, [dept, order]);

  if (loading) return <Frame><div className="text-center opacity-70">Loading…</div></Frame>;
  if (error)   return <Frame><div className="text-center text-red-400">{String(error)}</div></Frame>;
  if (!data)   return <Frame><div className="text-center opacity-70">No data</div></Frame>;

  const { title, items = [] } = data;

  function onClickItem(item) {
    alert(`(stub) Would open laser file for: ${item.label}`);
  }

  return (
    <Frame>
      <div className="p-6 flex flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{title || `Order ${order}`}</h1>
            <p className="opacity-60 text-sm">Dept: {dept.toUpperCase()}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => document.documentElement.requestFullscreen?.()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">Fullscreen</button>
            <button onClick={() => window.print()} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20">Print</button>
          </div>
        </header>

        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((item, i) => (
              <button key={i} onClick={() => onClickItem(item)} className="text-left bg-white/5 rounded-2xl overflow-hidden hover:bg-white/10">
                <div className="w-full aspect-[4/3] bg-black/40 flex items-center justify-center">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.label || `mat-${i}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-white/60">No image</div>
                  )}
                </div>
                <div className="p-3">
                  <div className="font-medium">{item.label || `Material ${i+1}`}</div>
                  {item.notes && <div className="opacity-60 text-xs mt-1">{item.notes}</div>}
                </div>
              </button>
            ))}
            {items.length === 0 && (
              <div className="opacity-60 text-sm">No materials listed.</div>
            )}
          </div>
        </section>
      </div>
    </Frame>
  );
}

function Frame({ children }) {
  return <div className="min-h-screen bg-neutral-950 text-white">{children}</div>;
}
