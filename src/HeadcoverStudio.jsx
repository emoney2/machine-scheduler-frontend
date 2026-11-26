import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";
import {
  loadStudioData, createStudio, ensureTiles, slug, downloadCanvas, canvasToBlob,
} from "./headcoverStudio/engine";
import { matchInventory } from "./headcoverStudio/inventory";
import "./HeadcoverStudio.css";

// Studio data (swatches, design templates, 3D proofs) is served as static files from
// public/headcover-studio/ (built by backend/headcover_tools). Rendering is all in the browser.
const DATA_BASE = `${process.env.PUBLIC_URL || ""}/headcover-studio`;
const DEFAULT_FUR = "Light Grey";

// Solid materials show as their colour; patterned ones show their tile.
const tileBg = (m) =>
  m ? (m.tileUrl && !m.solid ? { backgroundImage: `url("${m.tileUrl}")`, backgroundColor: m.hex } : { background: m.hex }) : {};

/** Mounts an existing <canvas> element (rendered by the engine) into the React tree. */
function CanvasView({ canvas, onClick, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !canvas) return undefined;
    el.innerHTML = "";
    el.appendChild(canvas);
    return () => { if (canvas.parentNode === el) el.removeChild(canvas); };
  }, [canvas]);
  return <div ref={ref} className={className} onClick={onClick} />;
}

/** Lightbox copy (the card keeps its own canvas). */
function LightboxCanvas({ src }) {
  const c = useMemo(() => copyCanvas(src), [src]);
  return <CanvasView canvas={c} />;
}

/** Copies a canvas so the same image can be shown in two places (e.g. card + lightbox). */
function copyCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

export default function HeadcoverStudio() {
  const rootRef = useRef(null);
  const studioRef = useRef(null);
  const [loadError, setLoadError] = useState("");
  const [ready, setReady] = useState(false);
  const [inventory, setInventory] = useState(null);   // live Material Inventory names (optional)
  const [invOverrides, setInvOverrides] = useState({});

  const [status, setStatus] = useState("Paste a logo to start · Ctrl+V");
  const [toast, setToast] = useState("");
  const [logoView, setLogoView] = useState(null);     // canvas copy for the preview
  const [canUndo, setCanUndo] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [tol, setTol] = useState(42);
  const [inside, setInside] = useState(false);
  const [club, setClub] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [slots, setSlots] = useState([null, null, null, null]);
  const [active, setActive] = useState(0);
  const [line, setLine] = useState("All");
  const [oneColor, setOneColor] = useState(false);
  const [furId, setFurId] = useState(null);
  const [logoSize, setLogoSize] = useState(220);
  const [quick, setQuick] = useState(false);

  const [out, setOut] = useState([]);
  const [swapped, setSwapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lb, setLb] = useState(null);                 // {i, flat}
  const [save, setSave] = useState(null);             // save-to-customer-folder dialog state

  const fileRef = useRef(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3600);
  }, []);

  /* ---------- load data ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await loadStudioData(DATA_BASE);
        if (!alive) return;
        const s = createStudio(data);
        studioRef.current = s;
        const fur = s.furs.find((f) => f.name === DEFAULT_FUR) || s.furs[0];
        setFurId(fur ? fur.id : null);
        setReady(true);
      } catch (e) {
        console.error("[HeadcoverStudio] load failed", e);
        if (alive) setLoadError("Couldn't load the studio data (public/headcover-studio). " + (e.message || ""));
      }
    })();
    fetch(`${DATA_BASE}/swatches/inventory-map.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((m) => alive && setInvOverrides(m || {}))
      .catch(() => {});
    // Live materials + furs from Material Inventory. The studio still works without it.
    axios
      .get(`${API_ROOT}/headcover-studio/materials`, { withCredentials: true })
      .then((r) => alive && setInventory(r.data))
      .catch((e) => console.warn("[HeadcoverStudio] inventory unavailable", e?.message));
    return () => { alive = false; };
  }, []);

  // keep the page exactly below the app's nav bar
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    el.style.setProperty("--hcs-top", `${Math.max(0, Math.round(top))}px`);
  }, [ready]);

  const S = studioRef.current;
  const materials = useMemo(() => (S ? S.materials : []), [S]);
  const furs = useMemo(() => (S ? S.furs : []), [S]);
  const fur = furs.find((f) => f.id === furId) || null;
  const hasTemplates = !!(S && S.templates.length);
  const lines = useMemo(() => ["All", ...new Set(materials.map((m) => m.line))], [materials]);
  const libList = useMemo(() => materials.filter((m) => line === "All" || m.line === line), [materials, line]);
  // {swatchId: inventoryName|null}; null when the backend isn't reachable (then nothing is faded)
  const invMap = useMemo(
    () => (inventory ? matchInventory(materials, inventory.materials || [], invOverrides, "material") : null),
    [inventory, materials, invOverrides]);
  const furStock = useMemo(
    () => (inventory ? matchInventory(furs, (inventory.furs || []).map((n) => ({ name: n })), invOverrides, "fur") : null),
    [inventory, furs, invOverrides]);

  /* ---------- logo ---------- */
  const applyLogoResult = useCallback((res, resetSlots) => {
    if (!res) return;
    setLogoView(copyCanvas(res.canvas));
    setCanUndo(res.canUndo);
    setSuggestions(res.suggestions);
    if (resetSlots) {
      const p = res.picks;
      const next = [p[0] || null, p[1] || null, p[2] || null, p[3] || null];
      setSlots(next);
      const firstEmpty = next.findIndex((x) => !x);
      setActive(firstEmpty < 0 ? 0 : firstEmpty);
      ensureTiles(next.filter(Boolean));
    }
    setStatus(`Logo ready${res.ms ? ` in ${Math.round(res.ms)} ms` : ""} · check the colors, then press Enter`);
  }, []);

  const runProcess = useCallback((resetSlots, tolValue, insideValue) => {
    const s = studioRef.current;
    if (!s) return;
    try { applyLogoResult(s.processLogo(tolValue, insideValue), resetSlots); }
    catch (e) { showToast(e.message); }
  }, [applyLogoResult, showToast]);

  const loadBlob = useCallback(async (blob) => {
    const s = studioRef.current;
    if (!s || !blob) return;
    try { await s.loadBlob(blob); runProcess(true, tol, inside); }
    catch (e) { showToast(e.message); }
  }, [runProcess, showToast, tol, inside]);

  // paste anywhere on the page (except into text fields)
  useEffect(() => {
    if (!ready) return undefined;
    async function onPaste(e) {
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find((i) => i.type.startsWith("image/"));
      if (img) { e.preventDefault(); loadBlob(img.getAsFile()); return; }
      const html = e.clipboardData.getData("text/html"), txt = e.clipboardData.getData("text/plain");
      const m = html && html.match(/<img[^>]+src="([^"]+)"/i);
      const src = m ? m[1].replace(/&amp;/g, "&") : /^https?:\/\/\S+$/.test(txt.trim()) ? txt.trim() : null;
      if (!src) return;
      e.preventDefault();
      try {
        const r = await fetch(src, src.startsWith("data:") ? undefined : { mode: "cors" });
        loadBlob(await r.blob());
      } catch {
        showToast("That site blocks copying by link. Right-click the image → Copy image, then paste again.");
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [ready, loadBlob, showToast]);

  // re-run background cleanup when the slider / inside toggle change
  const tolTimer = useRef(null);
  const onTol = (v) => {
    setTol(v);
    clearTimeout(tolTimer.current);
    tolTimer.current = setTimeout(() => S && S.hasLogo() && runProcess(false, v, inside), 120);
  };
  const toggleInside = () => {
    const v = !inside;
    setInside(v);
    if (S && S.hasLogo()) runProcess(false, tol, v);
  };
  const onLogoClick = (e) => {
    if (!S || !S.hasLogo() || e.target.tagName !== "CANVAS") return;
    e.stopPropagation();
    const r = e.target.getBoundingClientRect(), c = S.logoCanvas();
    const lx = Math.floor(((e.clientX - r.left) / r.width) * c.width), ly = Math.floor(((e.clientY - r.top) / r.height) * c.height);
    applyLogoResult(S.eraseAt(lx, ly, tol), false);
  };

  /* ---------- slots + library ---------- */
  const assign = (m) => {
    ensureTiles([m]);
    const next = [...slots];
    next[active] = m;
    const nx = next.findIndex((x, i) => !x && i > active);
    setSlots(next);
    setActive(nx >= 0 ? nx : Math.min(3, active + 1));
  };
  const clearSlot = (i) => { setSlots((p) => p.map((x, k) => (k === i ? null : x))); setActive(i); };

  /* ---------- generate ---------- */
  const canGo = !!(S && logoView && slots.some(Boolean));
  const genSeq = useRef(0);
  const generate = useCallback(async (opts = {}) => {
    const s = studioRef.current;
    if (!s || !s.hasLogo() || !slots.some(Boolean)) return;
    const seq = ++genSeq.current;
    setBusy(true);
    const { out: o, ms } = await s.generate({
      slots, swapped: opts.swapped ?? swapped, oneColor, logoScale: logoSize / 100, fur, quick,
    });
    if (seq !== genSeq.current) return;   // a newer render started
    // keep stars when a setting change re-renders the same design + colorway
    setOut((prev) => {
      const starred = new Set(prev.filter((x) => x.star).map((x) => `${x.design}|${x.cw}`));
      return o.map((x) => ({ ...x, star: starred.has(`${x.design}|${x.cw}`) }));
    });
    setBusy(false);
    setStatus(`${o.length} renderings in ${(ms / 1000).toFixed(2)} s`);
  }, [slots, swapped, oneColor, logoSize, fur, quick]);

  // live re-render once there are results (thread mode, fur, logo size, quick styles, logo edits)
  const hasOut = out.length > 0;
  const rerenderTimer = useRef(null);
  useEffect(() => {
    if (!hasOut) return;
    clearTimeout(rerenderTimer.current);
    rerenderTimer.current = setTimeout(() => generate(), 120);
  }, [oneColor, furId, logoSize, quick, logoView]);

  const toggleStar = (i) => setOut((p) => p.map((x, k) => (k === i ? { ...x, star: !x.star } : x)));
  const swap = () => { const v = !swapped; setSwapped(v); generate({ swapped: v }); };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") { setLb(null); setSave(null); return; }
      if (lb && out.length) {
        if (e.key === "ArrowRight") setLb({ i: (lb.i + 1) % out.length, flat: false });
        if (e.key === "ArrowLeft") setLb({ i: (lb.i - 1 + out.length) % out.length, flat: false });
        return;
      }
      const tag = document.activeElement?.tagName;
      if (e.key === "Enter" && canGo && tag !== "BUTTON" && tag !== "INPUT") generate();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lb, out.length, canGo, generate]);

  /* ---------- export ---------- */
  const sheetOf = (list) => S.sheet(list, { club: club.trim(), furName: fur?.name });
  const dlSheet = () => out.length && downloadCanvas(sheetOf(out), `${slug(club)}_headcover-concepts.png`);
  const dlStarred = () => {
    const s = out.filter((o) => o.star);
    if (!s.length) return showToast("Star a few designs first (★ on each card).");
    downloadCanvas(sheetOf(s), `${slug(club)}_picks.png`);
  };

  // Save the proof sheet into the club's customer folder in Drive (Design/<Club>), creating it if needed.
  const saveToFolder = async (choice) => {
    const name = club.trim();
    if (!name) return showToast("Type the club name first. It picks the customer folder.");
    const starred = out.filter((o) => o.star);
    const list = starred.length ? starred : out;
    if (!list.length) return;
    setSave({ state: "saving" });
    try {
      const blob = await canvasToBlob(sheetOf(list));
      const fd = new FormData();
      fd.append("file", blob, "sheet.png");
      fd.append("club", name);
      fd.append("kind", starred.length ? "picks" : "concepts");
      fd.append("materials", [...new Set(list.flatMap((o) => o.mats))].map((m) => `${m.name} (${m.line})`).join(", "));
      if (fur) fd.append("fur", fur.name);
      if (choice?.folderId) fd.append("folderId", choice.folderId);
      if (choice?.create) fd.append("create", "1");
      const r = await axios.post(`${API_ROOT}/headcover-studio/sheets`, fd, { withCredentials: true });
      if (r.data?.needsChoice) setSave({ state: "choose", candidates: r.data.candidates || [], club: name });
      else setSave({ state: "done", ...r.data });
    } catch (e) {
      setSave({ state: "error", error: e?.response?.data?.error || e.message });
    }
  };

  /* ---------- render ---------- */
  if (loadError) return <div className="hcs" ref={rootRef}><div className="loading">{loadError}</div></div>;
  if (!ready) return <div className="hcs" ref={rootRef}><div className="loading">Loading Headcover Studio…</div></div>;

  const roles = S.roles(hasTemplates);
  const cur = lb ? out[lb.i] : null;

  return (
    <div className="hcs" ref={rootRef}>
      <div className="hcs-head">
        <div className="brand">JR &amp; Co.</div><div className="sub">Headcover Studio</div>
        <div className="sp" /><div className="status">{busy ? "Rendering…" : status}</div>
      </div>
      <div className="hcs-main">
        <aside>
          <h2><span className="n">1</span>Logo</h2>
          <div
            className={"drop" + (dragOver ? " over" : "")}
            onClick={(e) => { if (e.target.tagName !== "CANVAS") fileRef.current?.click(); }}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
              if (f) loadBlob(f);
            }}
          >
            {logoView ? (
              <CanvasView canvas={logoView} className="logoPrev" onClick={onLogoClick} />
            ) : (
              <div className="hint">
                <b>Paste a logo</b><br />Copy it from Google Images, then press <kbd>Ctrl</kbd>+<kbd>V</kbd><br />
                <span className="small">or drag a file here / click to browse</span>
              </div>
            )}
          </div>
          <input type="file" ref={fileRef} accept="image/*" hidden
            onChange={(e) => { if (e.target.files[0]) loadBlob(e.target.files[0]); e.target.value = ""; }} />
          <div className="row">
            <label>Background cleanup</label>
            <input type="range" min="8" max="110" value={tol} onChange={(e) => onTol(+e.target.value)} />
            <button className={inside ? "on" : ""} onClick={toggleInside} title="Also remove background color trapped inside letters and shapes">Clear inside</button>
          </div>
          <div className="row">
            <button disabled={!canUndo} onClick={() => applyLogoResult(S.undoErase(), false)}>Undo click</button>
            <button disabled={!logoView} onClick={() => applyLogoResult(S.resetLogo(), false)}>Reset</button>
            <span className="small" style={{ flex: 1 }}>Click leftover background on the logo to erase it.</span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <input type="text" value={club} onChange={(e) => setClub(e.target.value)} placeholder="Club name (customer folder, file name, sheet)" />
          </div>

          <h2><span className="n">2</span>Pick up to 4 materials</h2>
          <div className="slots">
            {slots.map((m, i) => (
              <div key={i} className={"slot" + (m ? " filled" : " empty") + (i === active ? " active" : "")} onClick={() => setActive(i)}>
                <div className="sw" style={tileBg(m)} />
                <div className="lb">{m ? <><b>{m.name}</b><br /><span className="small">{m.line}</span></> : <span className="small">empty</span>}</div>
                <span className="role">{hasTemplates ? `Color ${i + 1}` : roles[i]}</span>
                {m && <span className="x" onClick={(e) => { e.stopPropagation(); clearSlot(i); }}>×</span>}
              </div>
            ))}
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            The back panel gets the lightest color. Camo uses 3 of the 4: A = lightest + colors 1 &amp; 2, B = lightest + colors 2 &amp; 3. Click a slot, then a material.
          </div>
          {suggestions.length > 0 && (
            <>
              <h2 style={{ marginTop: 14 }}>From the logo</h2>
              <div className="sugg">
                {suggestions.map((s, i) => (
                  <div key={i} className="chip" onClick={() => assign(s.material)} title={`${Math.round(s.share * 100)}% of the logo`}>
                    <span className="dot" style={{ background: s.from }} />→<span className="dot" style={tileBg(s.material)} />
                    {s.material.name} <span className="small">{s.material.line}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="row">
            <label>Logo thread</label>
            <button className={!oneColor ? "on" : ""} onClick={() => setOneColor(false)}>Original colors</button>
            <button className={oneColor ? "on" : ""} onClick={() => setOneColor(true)}>One color</button>
          </div>
          <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <label style={{ marginTop: 3 }}>Fur</label>
            <span className="furs" style={{ flex: 1 }}>
              {furs.map((f) => (
                <span key={f.id} title={f.name + (furStock && !furStock[f.id] ? " · not in Material Inventory" : "")}
                  className={"dot" + (f.id === furId ? " sel" : "")}
                  style={{ ...tileBg(f), opacity: furStock && !furStock[f.id] ? 0.45 : 1 }}
                  onClick={() => { ensureTiles([f]).then(() => setFurId(f.id)); }} />
              ))}
            </span>
            <span className="small">{fur?.name}</span>
          </div>
          <div className="row">
            <label>Logo size</label>
            <input type="range" min="60" max="400" value={logoSize} onChange={(e) => setLogoSize(+e.target.value)} />
            <span className="small">{logoSize}%</span>
          </div>
          <div className="row"><label><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> Include quick styles (stand-in shapes)</label></div>
          <button className="primary" disabled={!canGo || busy} onClick={() => generate()}>Design covers &nbsp;↵</button>

          <h2>Material library</h2>
          <div className="lines">
            {lines.map((l) => <button key={l} className={l === line ? "on" : ""} onClick={() => setLine(l)}>{l}</button>)}
          </div>
          {invMap && <div className="small" style={{ marginBottom: 6 }}>Faded swatches aren't matched to a Material Inventory row yet.</div>}
          <div className="lib">
            {libList.map((m) => {
              const noInv = invMap && !invMap[m.id];
              return (
                <div key={m.id} className={"swt" + (slots.some((s) => s && s.id === m.id) ? " sel" : "") + (noInv ? " noinv" : "")}
                  onClick={() => assign(m)} title={`${m.name} · ${m.line}${m.origin ? ` (${m.origin})` : ""}${invMap && invMap[m.id] ? ` · inventory: ${invMap[m.id]}` : ""}`}>
                  <div className="t" style={tileBg(m)} />
                  <div className="nm">{m.name}</div><div className="ln">{m.line}</div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="results">
          {!out.length ? (
            <div className="empty-state">
              <div className="big">Paste a club logo, pick colors, hit Enter.</div>
              <div>{hasTemplates ? `${S.templates.length} design${S.templates.length > 1 ? "s" : ""} × 2 colorways as 3D proofs, rendered right here in the browser.` : "8 quick styles × 2 colorways, rendered right here in the browser."}</div>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <div className="title">{club.trim() || "Concepts"}</div>
                <button onClick={swap}>Swap colorways</button>
                <button onClick={dlStarred}>Download starred</button>
                <button onClick={dlSheet}>Download sheet</button>
                <button className="on" onClick={() => saveToFolder()}
                  title="Saves the sheet (only starred designs, if any are starred) into the club's customer folder in Drive">
                  Save to customer folder
                </button>
              </div>
              <div className="grid">
                {out.map((o, i) => (
                  <div key={i} className={"card" + (o.wide ? " wide" : "")} onClick={() => setLb({ i, flat: false })}>
                    <CanvasView canvas={o.canvas} />
                    <div className="meta">
                      <span className="nm">{o.design}</span>
                      {[...new Set(o.mats)].map((m, k) => <span key={k} className="dot" title={`${m.name} · ${m.line}`} style={tileBg(m)} />)}
                      <span className="cw">&nbsp;{o.cw}</span>
                    </div>
                    <button className={"star" + (o.star ? " on" : "")} onClick={(e) => { e.stopPropagation(); toggleStar(i); }}>★</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {cur && (
        <div className="lightbox" onClick={(e) => { if (e.target.classList.contains("lightbox")) setLb(null); }}>
          <LightboxCanvas src={lb.flat && cur.flat ? cur.flat : cur.canvas} />
          <div className="side">
            <h3>{cur.design}</h3>
            <div className="small" style={{ color: "#bbb" }}>Colorway {cur.cw}</div>
            <div className="mats">
              {cur.mats.map((m, k) => (
                <div key={k}><span className="dot" style={{ ...tileBg(m), verticalAlign: "middle" }} /> {S.roles(cur.tpl)[k]}: {m.name} <span style={{ color: "#999" }}>{m.line}</span></div>
              ))}
              {cur.tpl && fur && <div><span className="dot" style={{ ...tileBg(fur), verticalAlign: "middle" }} /> Fur: {fur.name}</div>}
            </div>
            {cur.tpl && <button onClick={() => setLb({ ...lb, flat: !lb.flat })}>{lb.flat ? "Show 3D proof" : "Show flat layout"}</button>}
            <button onClick={() => toggleStar(lb.i)}>{cur.star ? "★ Starred" : "☆ Star"}</button>
            <button onClick={() => downloadCanvas(lb.flat && cur.flat ? cur.flat : cur.canvas, `${slug(club)}_${slug(cur.design)}_${cur.cw}${lb.flat ? "_flat" : ""}.png`)}>Download PNG</button>
            <button onClick={() => setLb(null)}>Close (Esc)</button>
          </div>
        </div>
      )}

      {save && (
        <div className="modal" onClick={(e) => { if (e.target.classList.contains("modal") && save.state !== "saving") setSave(null); }}>
          <div className="box">
            {save.state === "saving" && <><h3>Saving…</h3><div className="small">Uploading the proof sheet to the customer folder.</div></>}
            {save.state === "done" && (
              <>
                <h3>Saved</h3>
                <div className="small">
                  {save.createdFolder ? "Created a new customer folder " : "Saved to "}
                  <b>Design / {save.folderName}</b>{save.createdFolder ? " and saved the sheet there." : "."}
                </div>
                <div style={{ marginTop: 10, fontSize: 14 }}><a href={save.webViewLink} target="_blank" rel="noreferrer">{save.fileName}</a></div>
                <button className="opt" onClick={() => setSave(null)}>Close</button>
              </>
            )}
            {save.state === "choose" && (
              <>
                <h3>Which customer folder?</h3>
                <div className="small">No folder in Design is named exactly "{save.club}". Pick the right one, or make a new folder.</div>
                {save.candidates.map((c) => (
                  <button key={c.id} className="opt" onClick={() => saveToFolder({ folderId: c.id })}>Design / {c.name}</button>
                ))}
                <button className="opt on" onClick={() => saveToFolder({ create: true })}>Create “Design / {save.club}”</button>
                <button className="opt" onClick={() => setSave(null)}>Cancel</button>
              </>
            )}
            {save.state === "error" && (
              <><h3>Couldn't save</h3><div className="small">{save.error}</div><button className="opt" onClick={() => setSave(null)}>Close</button></>
            )}
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
