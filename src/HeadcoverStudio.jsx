import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";
import {
  loadStudioData, createStudio, ensureTiles, slug, downloadCanvas, canvasToBlob, hexToRgb, PATTERN_DEFAULT, PAINT_DEFAULT, OIL_DEFAULT, pngWithDpi, downloadBlob,
} from "./headcoverStudio/engine";
import { matchInventory } from "./headcoverStudio/inventory";
import { saveSession, getSession, deleteSession, listSessions, newId, packSpec, unpackSpec, thumbOf } from "./headcoverStudio/sessions";
import "./HeadcoverStudio.css";

// Studio data (swatches, design templates, 3D proofs) is served as static files from
// public/headcover-studio/ (built by backend/headcover_tools). Rendering is all in the browser.
const DATA_BASE = `${process.env.PUBLIC_URL || ""}/headcover-studio`;
const DEFAULT_FUR = "Light Grey";

// Solid materials show as their colour; patterned ones show their tile.
const tileBg = (m) =>
  m ? (m.tileUrl && !m.solid ? { backgroundImage: `url("${m.chipUrl || m.tileUrl}")`, backgroundColor: m.hex } : { background: m.hex }) : {};

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

/** Copies a canvas so the same image can be shown in two places (e.g. card + lightbox). */
function copyCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

/** The logo's own colours as chips; tap one, then pick its new colour (quick picks or any colour). */
function LogoColors({ palette, map, picks, onChange, extra }) {
  const [open, setOpen] = useState(null);
  const toOf = (hex) => (map.find((m) => m.from === hex) || {}).to;
  const set = (from, to) => {
    const rest = map.filter((m) => m.from !== from);
    onChange(to && to.toLowerCase() !== from.toLowerCase() ? [...rest, { from, to }] : rest);
  };
  return (
    <div className="logocols">
      <div className="lcrow">
        {palette.map((c) => {
          const to = toOf(c.hex);
          return (
            <button key={c.hex} className={"lc" + (open === c.hex ? " on" : "")} onClick={() => setOpen(open === c.hex ? null : c.hex)}
              title={`${Math.round(c.share * 100)}% of the logo · tap to change`}>
              <span className="dot" style={{ background: c.hex }} />{to && <>→<span className="dot" style={{ background: to }} /></>}
            </button>
          );
        })}
        {extra}
        {map.length > 0 && <button className="ghost lcreset" onClick={() => { onChange([]); setOpen(null); }}>Reset colours</button>}
      </div>
      {open && (
        <div className="lcpick">
          {picks.map((m, i) => <span key={(m.id || m.hex) + i} className="dot" title={m.name || m.hex} style={{ background: m.hex }} onClick={() => set(open, m.hex)} />)}
          <label className="anyc" title="Any colour"><input type="color" value={toOf(open) || open} onChange={(e) => set(open, e.target.value)} /> Any</label>
          <button className="ghost" onClick={() => set(open, null)}>Original</button>
        </div>
      )}
    </div>
  );
}

let UID = 0;
const uid = () => `d${++UID}`;
const specKey = (sp) => `${sp.tpl}|${sp.roles.map((r) => r.mat && r.mat.id).join(",")}`;
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
};

/** Swipe-through of the session's designs, one per page. */
function Carousel({ designs, idx, setIdx, flat, children }) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const n = designs.length;
  const go = (i) => setIdx(Math.max(0, Math.min(n - 1, i)));
  const down = (e) => { if (e.button !== 0 && e.pointerType === "mouse") return; drag.current = { x: e.clientX, w: e.currentTarget.clientWidth }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (drag.current) setDx(e.clientX - drag.current.x); };
  const up = () => {
    if (!drag.current) return;
    const w = drag.current.w; drag.current = null;
    if (dx < -w * 0.15) go(idx + 1); else if (dx > w * 0.15) go(idx - 1);
    setDx(0);
  };
  return (
    <div className="car">
      <button className="nav prev" disabled={idx <= 0} onClick={() => go(idx - 1)} aria-label="Previous">‹</button>
      <div className="viewport" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="track" style={{ transform: `translateX(calc(${-idx * 100}% + ${dx}px))`, transition: dx ? "none" : "transform .28s ease" }}>
          {designs.map((d, i) => (
            <div key={d.uid} className="slide">
              {Math.abs(i - idx) <= 1 && (d.canvas
                ? <CanvasView canvas={flat && d.flat ? d.flat : d.canvas} className="stage" />
                : <div className="stage pending">Rendering…</div>)}
            </div>
          ))}
        </div>
        {children}
      </div>
      <button className="nav next" disabled={idx >= n - 1} onClick={() => go(idx + 1)} aria-label="Next">›</button>
    </div>
  );
}

export default function HeadcoverStudio() {
  const rootRef = useRef(null);
  const studioRef = useRef(null);
  const [loadError, setLoadError] = useState("");
  const [ready, setReady] = useState(false);
  const [inventory, setInventory] = useState(null);   // live Material Inventory names (optional)
  const [invOverrides, setInvOverrides] = useState({});

  const [status, setStatus] = useState("Paste a logo to start");
  const [toast, setToast] = useState(null);           // {text, undo?}
  const [logoView, setLogoView] = useState(null);     // canvas copy for the preview
  const [canUndo, setCanUndo] = useState(false);
  const [logoTool, setLogoTool] = useState("click");   // click (erase background colour) | erase | restore (brushes)
  const [brush, setBrush] = useState(12);               // brush radius in screen px
  const [liveLogo, setLiveLogo] = useState(null);       // the logo canvas itself while a brush stroke is under way
  const [logoPal, setLogoPal] = useState([]);           // the logo's own colours
  const [logoMap, setLogoMap] = useState([]);           // session colour changes [{from,to}]
  const [logoEdit, setLogoEdit] = useState(null);       // Edit logo pop-up open: what to put back on Cancel
  const modalLogo = useMemo(() => (logoView ? copyCanvas(logoView) : null), [logoView]);   // its own copy: a canvas can only sit in one place
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
  const [products, setProducts] = useState(["Driver"]);

  // the session: a batch of designs you swipe through, edit, delete or lock
  const [view, setView] = useState("setup");          // setup | review
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [designs, setDesigns] = useState([]);         // [{uid, spec, locked, canvas, flat, thumb}]
  const [idx, setIdx] = useState(0);
  const [variant, setVariant] = useState(0);
  const [flatView, setFlatView] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pickRole, setPickRole] = useState(null);     // role index being changed in the editor
  const [pickLine, setPickLine] = useState("Your colors");
  const [pickQuery, setPickQuery] = useState("");
  const [swapped, setSwapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState(null);             // save-to-customer-folder dialog state
  const [course, setCourseInfo] = useState(null);     // clubhouse / course photo for Painted Course {url, width, height}
  const [printing, setPrinting] = useState(null);     // print-file progress text
  const courseRef = useRef(null), courseBlob = useRef(null);

  const fileRef = useRef(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((text, undo) => {
    setToast({ text, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3600);
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
    listSessions().then((l) => alive && setSessions(l)).catch(() => {});
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
  const catalogFurs = useMemo(() => (S ? S.furs : []), [S]);
  const hasTemplates = !!(S && S.templates.length);
  const lines = useMemo(() => ["All", ...new Set(materials.map((m) => m.line))], [materials]);
  const libList = useMemo(() => materials.filter((m) => line === "All" || m.line === line), [materials, line]);
  const invMap = useMemo(
    () => (inventory ? matchInventory(materials, inventory.materials || [], invOverrides, "material") : null),
    [inventory, materials, invOverrides]);
  const furStock = useMemo(
    () => (inventory ? matchInventory(catalogFurs, (inventory.furs || []).map((n) => ({ name: n })), invOverrides, "fur") : null),
    [inventory, catalogFurs, invOverrides]);
  const furs = useMemo(() => {
    if (!inventory || !furStock) return catalogFurs;
    const used = new Set(Object.values(furStock).filter(Boolean));
    const extra = (inventory.furs || []).filter((n) => !used.has(n)).map((n) => {
      const row = (inventory.materials || []).find((m) => m.name === n);
      const hex = /^#[0-9a-f]{6}$/i.test(row?.color || "") ? row.color : "#b7b7b7";
      return { id: "inventory-" + slug(n), name: n.replace(/\s*fur$/i, "").trim(), line: "Fur Interior Lining", kind: "fur",
        solid: true, hex, rgb: hexToRgb(hex), tileUrl: null, inventoryName: n };
    });
    return [...catalogFurs, ...extra];
  }, [inventory, furStock, catalogFurs]);
  const furInStock = (f) => !furStock || !!f.inventoryName || !!furStock[f.id];
  const fur = furs.find((f) => f.id === furId) || null;

  /* ---------- logo ---------- */
  const logoDirty = useRef(false);   // the cleaned logo changed since the session was last saved
  const applyLogoResult = useCallback((res, resetSlots) => {
    if (!res) return;
    setLogoView(copyCanvas(res.canvas));
    logoDirty.current = true;
    setCanUndo(res.canUndo);
    setLogoPal(res.palette || []); setLogoMap(res.map || []);
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

  useEffect(() => {
    if (!ready) return undefined;
    async function onPaste(e) {
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      const cd = e.clipboardData;
      if (!cd) return;
      // an image file on the clipboard (desktop copy, iPhone/iPad "Copy" on a photo)
      const file = [...(cd.files || [])].find((f) => f.type.startsWith("image/"))
        || [...(cd.items || [])].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).find(Boolean);
      if (file) { e.preventDefault(); clearPasteBox(); loadBlob(file); return; }
      const html = cd.getData("text/html"), txt = (cd.getData("text/uri-list") || cd.getData("text/plain") || "").trim();
      const m = html && html.match(/<img[^>]+src="([^"]+)"/i);
      const src = m ? m[1].replace(/&amp;/g, "&") : /^(https?:|data:image)\S+$/.test(txt) ? txt : null;
      if (!src) { if (e.target.closest && e.target.closest(".pastebox")) { e.preventDefault(); showToast("That wasn't an image. Press and hold the logo picture → Copy, then paste here."); } return; }
      e.preventDefault(); clearPasteBox();
      loadUrl(src);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [ready, loadBlob, showToast]);

  // phones and tablets have no Ctrl+V. Two ways in: the paste box (press and hold → Paste, which fires a
  // normal paste event) and the Paste button (reads the clipboard directly where the browser allows it).
  const pasteBoxRef = useRef(null);
  const clearPasteBox = () => { if (pasteBoxRef.current) pasteBoxRef.current.innerHTML = ""; pasteBoxRef.current?.blur(); };
  const loadUrl = useCallback(async (src) => {
    try {
      const r = await fetch(src, src.startsWith("data:") ? undefined : { mode: "cors" });
      if (!r.ok) throw new Error(r.status);
      loadBlob(await r.blob());
    } catch {
      showToast("That site won't share the picture by link. Save the image to Photos, then use “Choose photo”.");
    }
  }, [loadBlob, showToast]);
  const isTouch = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const canClipboard = typeof navigator !== "undefined" && !!(navigator.clipboard && navigator.clipboard.read);
  const pasteFromClipboard = async () => {
    if (!canClipboard) { pasteBoxRef.current?.focus(); showToast("Press and hold the box → Paste."); return; }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith("image/"));
        if (t) { loadBlob(await it.getType(t)); return; }
      }
      for (const it of items) {   // a copied link to an image
        const t = it.types.find((x) => x === "text/uri-list" || x === "text/plain");
        if (t) {
          const txt = (await (await it.getType(t)).text()).trim();
          if (/^(https?:|data:image)\S+$/.test(txt)) { loadUrl(txt); return; }
        }
      }
      showToast("No picture on the clipboard. Press and hold the logo image → Copy, then tap Paste again.");
    } catch (err) {
      // Safari asks with a small "Paste" bubble first; if it was dismissed, or the browser refuses, use the box
      pasteBoxRef.current?.focus();
      showToast("Tap the small “Paste” bubble when it appears, or press and hold the paste box → Paste.");
    }
  };

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
  const stroke = useRef(null);
  const logoPt = (e, wrap) => {
    const el = wrap.querySelector("canvas"), r = el.getBoundingClientRect(), c = S.logoCanvas();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height, k: c.width / r.width };
  };
  const onLogoDown = (e) => {
    if (logoTool === "click" || !S || !S.hasLogo() || e.target.tagName !== "CANVAS") return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget; el.setPointerCapture && el.setPointerCapture(e.pointerId);   // the wrapper: the canvas inside is swapped for the live one
    S.brushStart();
    const pt = logoPt(e, el); stroke.current = { el, last: pt };
    S.brushAt(pt.x, pt.y, brush * pt.k, logoTool === "restore");
    setLiveLogo(S.logoCanvas());
  };
  const onLogoMove = (e) => {
    const st = stroke.current; if (!st) return;
    const pt = logoPt(e, st.el); if (!isFinite(pt.k)) return;
    const d = Math.hypot(pt.x - st.last.x, pt.y - st.last.y), step = Math.max(1, brush * pt.k * 0.35);
    for (let t = step; t <= d; t += step) S.brushAt(st.last.x + ((pt.x - st.last.x) * t) / d, st.last.y + ((pt.y - st.last.y) * t) / d, brush * pt.k, logoTool === "restore");
    if (d >= step) st.last = pt;
  };
  const onLogoUp = () => {
    if (!stroke.current) return;
    stroke.current = null; setLiveLogo(null);
    applyLogoResult(S.brushEnd(), false);
  };
  const setSessionLogoColors = (map) => applyLogoResult(S.setLogoColors(map), false);
  const openLogoEdit = () => { if (S && S.hasLogo()) { setLogoTool("click"); setLogoEdit({ snap: S.logoSnapshot(), tol, inside }); } };
  const cancelLogoEdit = () => { const e = logoEdit; setLogoEdit(null); if (e) { setTol(e.tol); setInside(e.inside); applyLogoResult(S.logoRestore(e.snap), false); } };
  const saveLogoEdit = () => { setLogoEdit(null); showToast("Logo saved · redrawing the covers"); };

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

  /* ---------- rendering a session ---------- */
  const canGo = !!(S && logoView && slots.some(Boolean));
  const renderOpts = useCallback(() => ({ oneColor, logoScale: logoSize / 100, fur }), [oneColor, logoSize, fur]);
  // a design can carry its own fur lining (set in Edit); otherwise it uses the session fur
  const furOf = useCallback((spec) => (spec && spec.furId && furs.find((f) => f.id === spec.furId)) || fur, [furs, fur]);
  // a design can also carry its own logo size (set in Edit); otherwise the session slider applies
  const optsFor = useCallback((spec, o) => { const b = o || renderOpts(); return { ...b, fur: furOf(spec), logoScale: spec && spec.logoScale ? spec.logoScale : b.logoScale }; }, [renderOpts, furOf]);
  const renderSeq = useRef(0);
  // (re)draw the given designs one at a time so the first ones show up straight away
  const renderAll = useCallback(async (list, onlyUids) => {
    const s = studioRef.current, seq = ++renderSeq.current, o = renderOpts();
    setBusy(true);
    for (const d of list) {
      if (onlyUids && !onlyUids.has(d.uid)) continue;
      const df = furOf(d.spec); if (df && df !== o.fur) await ensureTiles([df]);
      const r = await s.renderSpec(d.spec, optsFor(d.spec, o));
      if (seq !== renderSeq.current) return;
      if (!r) continue;
      setDesigns((cur) => cur.map((x) => (x.uid === d.uid ? { ...x, canvas: r.canvas, flat: r.flat, thumb: thumbOf(r.canvas, 200) } : x)));
    }
    setBusy(false);
  }, [renderOpts, furOf, optsFor]);

  // Design covers / Redesign / Create new ones. The batch has one place per product design + colorway.
  // A locked design keeps its place; every other place gets a design (a new combination of the picks
  // when "Create new ones" is pressed, falling back to the current one if no new combination exists).
  const buildBatch = useCallback(async ({ fresh = false, next = false } = {}) => {
    const s = studioRef.current;
    if (!s || !s.hasLogo() || !slots.some(Boolean)) return;
    const base = await s.plan({ slots, swapped, products, variant: 0 });
    const place = (sp) => `${sp.tpl}|${sp.cw}`;
    const locked = designs.filter((d) => d.locked);
    const used = new Set(locked.map((d) => specKey(d.spec)));
    const current = new Map(designs.filter((d) => !d.locked).map((d) => [place(d.spec), d]));
    const v = fresh ? 0 : variant;
    const pools = [];   // later orderings of the picks, fetched as needed
    const poolAt = async (k) => { while (pools.length <= k) pools.push(await s.plan({ slots, swapped, products, variant: v + pools.length + 1 })); return pools[k]; };
    const list = [];
    for (const sp of base) {
      const here = locked.filter((d) => place(d.spec) === place(sp));
      if (here.length) { here.forEach((d) => list.push(d)); continue; }
      let pick = null;
      if (next) {
        const avoid = current.get(place(sp));
        for (let k = 0; k < 24 && !pick; k++) {
          const cand = (await poolAt(k)).find((x) => place(x) === place(sp));
          if (cand && !used.has(specKey(cand)) && (!avoid || specKey(avoid.spec) !== specKey(cand))) pick = cand;
        }
        if (!pick && avoid) { list.push(avoid); used.add(specKey(avoid.spec)); continue; }   // no new combination for this one
      }
      pick = pick || (!used.has(specKey(sp)) ? sp : null);
      if (!pick) continue;
      used.add(specKey(pick));
      list.push({ uid: uid(), spec: pick, locked: false });
    }
    locked.filter((d) => !list.includes(d)).forEach((d) => list.push(d));   // locked designs from products no longer selected
    if (next) setVariant((x) => x + 1);
    else if (fresh) setVariant(0);
    setDesigns(list);
    setIdx(0);
    setView("review");
    setEditing(false); setPickRole(null);
    if (!sessionId) setSessionId(newId());
    setStatus(`${list.length} designs${locked.length ? ` · ${locked.length} locked kept` : ""}`);
    renderAll(list, new Set(list.filter((d) => !d.canvas).map((d) => d.uid)));
  }, [slots, swapped, products, variant, designs, sessionId, renderAll]);

  // settings that change every render (fur, logo size, thread, logo edits): redraw the whole session
  const rerenderTimer = useRef(null);
  useEffect(() => {
    if (!designs.length || logoEdit) return;   // logo edits show up on the covers when Save is pressed
    clearTimeout(rerenderTimer.current);
    rerenderTimer.current = setTimeout(() => renderAll(designs), 150);
  }, [oneColor, furId, logoSize, logoView, !!logoEdit]);

  const cur = designs[idx] || null;
  const updateDesign = (u, patch) => setDesigns((p) => p.map((d) => (d.uid === u ? { ...d, ...patch } : d)));
  const toggleLock = (d) => d && updateDesign(d.uid, { locked: !d.locked });
  const removeDesign = (d) => {
    if (!d) return;
    const at = designs.findIndex((x) => x.uid === d.uid);
    setDesigns((p) => p.filter((x) => x.uid !== d.uid));
    setIdx((i) => Math.max(0, Math.min(i, designs.length - 2)));
    setEditing(false); setPickRole(null);
    showToast(`Deleted ${d.spec.design} ${d.spec.cw}`, () => {
      setDesigns((p) => { const n = [...p]; n.splice(at, 0, d); return n; });
      setIdx(at);
    });
  };
  // edit: swap one role's material, redraw just that design; an edited design is locked so it's kept
  const setRole = async (k, m) => {
    if (!cur) return;
    await ensureTiles([m]);
    const spec = { ...cur.spec, roles: cur.spec.roles.map((r, i) => (i === k ? { ...r, mat: m } : r)) };
    updateDesign(cur.uid, { spec, locked: true });
    setPickRole(null);
    const r = await S.renderSpec(spec, optsFor(spec));
    if (r) updateDesign(cur.uid, { canvas: r.canvas, flat: r.flat, thumb: thumbOf(r.canvas, 200) });
  };
  // edit: this design's fur lining (null = follow the session fur)
  // edit: logo pattern size / spacing; drags re-render the newest values without queueing every step
  const patBusy = useRef(false), patNext = useRef(null);
  const setPattern = (patch) => cur && liveSpec({ ...cur.spec, pattern: { ...PATTERN_DEFAULT, ...(cur.spec.pattern || {}), ...patch } });
  // this design's logo colours (null = follow the session colours)
  const setDesignStroke = (st) => cur && liveSpec({ ...cur.spec, logoStroke: st || undefined });
  const setDesignLogoColors = (m) => cur && liveSpec({ ...cur.spec, logoColors: m && m.length ? m : undefined });
  const setDesignLogo = (v) => cur && liveSpec({ ...cur.spec, logoScale: v == null ? undefined : v });
  const liveSpec = (spec) => {
    updateDesign(cur.uid, { spec, locked: true });
    patNext.current = { uid: cur.uid, spec };
    if (patBusy.current) return;
    patBusy.current = true;
    (async () => {
      while (patNext.current) {
        const job = patNext.current; patNext.current = null;
        const r = await S.renderSpec(job.spec, optsFor(job.spec));
        if (r) updateDesign(job.uid, { canvas: r.canvas, flat: r.flat, thumb: thumbOf(r.canvas, 200) });
      }
      patBusy.current = false;
    })();
  };
  const setDesignFur = async (f) => {
    if (!cur) return;
    if (f) await ensureTiles([f]);
    const spec = { ...cur.spec, furId: f ? f.id : undefined };
    updateDesign(cur.uid, { spec, locked: true });
    const r = await S.renderSpec(spec, optsFor(spec));
    if (r) updateDesign(cur.uid, { canvas: r.canvas, flat: r.flat, thumb: thumbOf(r.canvas, 200) });
  };

  // painted course: the customer's clubhouse / course photo
  const loadCourse = async (file, quiet) => {
    if (!file) { await S.setCourse(null); courseBlob.current = null; setCourseInfo(null); return; }
    try {
      const r = await S.setCourse(file);
      courseBlob.current = file;
      setCourseInfo((old) => { if (old) URL.revokeObjectURL(old.url); return { url: URL.createObjectURL(file), ...r }; });
      if (!quiet) {
        const painted = designs.filter((d) => d.spec.kind === "painted");
        if (painted.length) renderAll(designs, new Set(painted.map((d) => d.uid)));
        showToast(painted.length ? "Course photo changed · repainting" : designs.length ? "Course photo added · press Redesign to add Painted Course" : "Course photo added");
      }
    } catch (e) { showToast(e.message || "Couldn't open that photo."); }
  };
  const setPaint = (patch) => cur && liveSpec({ ...cur.spec, paint: { ...PAINT_DEFAULT, ...(cur.spec.paint || {}), ...patch } });
  const setLook = (patch) => cur && setPaint({ look: { ...((cur.spec.paint || {}).look || {}), ...patch } });
  const downloadPrint = async () => {
    if (!cur || printing) return;
    try {
      setPrinting("Starting…");
      const c = await S.renderPrint(cur.spec, 300, setPrinting);
      setPrinting("Saving the file…");
      const b = await pngWithDpi(await canvasToBlob(c), 300);
      downloadBlob(b, `${slug(club)}_${slug(cur.spec.product)}_painted-course_${cur.spec.cw}_300dpi.png`);
    } catch (e) { console.warn(e); showToast("The print file couldn't be made on this device."); }
    setPrinting(null);
  };

  /* ---------- session save / open ---------- */
  const saveTimer = useRef(null);
  const logoBlob = useRef(null);
  useEffect(() => {
    if (!sessionId || !designs.length) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        if (logoDirty.current || !logoBlob.current) { logoBlob.current = S.hasLogo() ? await canvasToBlob(S.logoCanvas()) : null; logoDirty.current = false; }
        const first = designs.find((d) => d.locked && d.canvas) || designs.find((d) => d.canvas);
        const prev = sessions.find((x) => x.id === sessionId);
        await saveSession({
          id: sessionId, name: club.trim() || "Untitled session", createdAt: prev?.createdAt || Date.now(), updatedAt: Date.now(),
          count: designs.length, locked: designs.filter((d) => d.locked).length, thumb: first ? first.thumb : prev?.thumb || null,
          logo: logoBlob.current, course: courseBlob.current,
          settings: { logoMap, slots: slots.map((m) => m && m.id), furId, logoSize, oneColor, products, swapped, variant, tol, inside },
          designs: designs.map((d) => ({ spec: packSpec(d.spec), locked: d.locked })),
        });
        setSessions(await listSessions());
      } catch (e) { console.warn("[HeadcoverStudio] session not saved", e); }
    }, 600);
  }, [designs, club, slots, furId, logoSize, oneColor, products, swapped, variant, logoMap]);

  const openSession = async (id) => {
    const x = await getSession(id);
    if (!x) return showToast("That session couldn't be found.");
    const st = x.settings || {};
    if (x.logo) { await S.restoreLogo(x.logo); applyLogoResult(S.setLogoColors(st.logoMap || []), false); }
    logoBlob.current = x.logo || null; logoDirty.current = false;
    await loadCourse(x.course || null, true);
    const sl = (st.slots || []).map((sid) => (sid ? S.matById(sid) : null));
    setSlots([0, 1, 2, 3].map((i) => sl[i] || null)); ensureTiles(sl.filter(Boolean));
    setClub(x.name === "Untitled session" ? "" : x.name);
    if (st.furId) setFurId(st.furId);
    if (st.logoSize) setLogoSize(st.logoSize);
    setOneColor(!!st.oneColor); setSwapped(!!st.swapped); setVariant(st.variant || 0);
    if (st.products) setProducts(st.products);
    if (st.tol) setTol(st.tol); setInside(!!st.inside);
    const list = (x.designs || []).map((d) => ({ uid: uid(), spec: unpackSpec(d.spec, S.matById), locked: d.locked })).filter((d) => d.spec);
    setSessionId(x.id);
    setDesigns(list); setIdx(0); setView("review"); setEditing(false);
    setStatus(`Opened “${x.name}” · ${list.length} designs`);
    // fur and logo size come from the session, so render once they are set
    setTimeout(() => renderAll(list), 0);
  };
  const newSession = () => {
    renderSeq.current++;
    setSessionId(null); setDesigns([]); setIdx(0); setView("setup"); setEditing(false); setVariant(0);
    setClub(""); setLogoView(null); setSuggestions([]); setSlots([null, null, null, null]); setActive(0);
    logoBlob.current = null; loadCourse(null, true);
    setStatus("New session · paste a logo to start");
  };
  const removeSession = async (id) => {
    await deleteSession(id);
    setSessions(await listSessions());
    if (id === sessionId) newSession();
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") { if (pickRole != null) setPickRole(null); else if (editing) setEditing(false); setSave(null); return; }
      if (view === "review" && designs.length) {
        if (e.key === "ArrowRight") setIdx((i) => Math.min(designs.length - 1, i + 1));
        if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
        if (e.key === "l" || e.key === "L") toggleLock(cur);
        if (e.key === "e" || e.key === "E") setEditing((v) => !v);
        if (e.key === "Delete") removeDesign(cur);
        return;
      }
      if (e.key === "Enter" && canGo && tag !== "BUTTON") buildBatch({ fresh: true });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /* ---------- export ---------- */
  const asOut = (list) => list.filter((d) => d.canvas).map((d) => ({ ...d.spec, mats: d.spec.roles.map((r) => r.mat), canvas: d.canvas, wide: true, tpl: true }));
  const fursIn = (list) => [...new Set(list.map((d) => furOf(d.spec)?.name).filter(Boolean))].join(", ");
  const sheetOf = (list) => S.sheet(asOut(list), { club: club.trim(), furName: fursIn(list) });
  const dlSheet = () => designs.length && downloadCanvas(sheetOf(designs), `${slug(club)}_headcover-concepts.png`);
  const dlLocked = () => {
    const s = designs.filter((d) => d.locked);
    if (!s.length) return showToast("Lock the designs you want first (Lock on each page).");
    downloadCanvas(sheetOf(s), `${slug(club)}_picks.png`);
  };
  const saveToFolder = async (choice) => {
    const name = club.trim();
    if (!name) return showToast("Type the club name first. It picks the customer folder.");
    const locked = designs.filter((d) => d.locked);
    const list = locked.length ? locked : designs;
    if (!list.length) return;
    setSave({ state: "saving" });
    try {
      const blob = await canvasToBlob(sheetOf(list));
      const fd = new FormData();
      fd.append("file", blob, "sheet.png");
      fd.append("club", name);
      fd.append("kind", locked.length ? "picks" : "concepts");
      fd.append("materials", [...new Set(list.flatMap((d) => d.spec.roles.map((r) => r.mat)))].map((m) => `${m.name} (${m.line})`).join(", "));
      if (fursIn(list)) fd.append("fur", fursIn(list));
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
  const yourColors = [...new Set([...slots.filter(Boolean), ...suggestions.map((s) => s.material), S.WHITE, S.BLACK])];
  const pickPool = pickLine === "Your colors" ? yourColors
    : materials.filter((m) => (pickLine === "All" || m.line === pickLine) && (!pickQuery || `${m.name} ${m.line}`.toLowerCase().includes(pickQuery.toLowerCase())));
  const lockedCount = designs.filter((d) => d.locked).length;

  return (
    <div className="hcs" ref={rootRef}>
      <div className="hcs-head">
        <img className="jrlogo" src={`${process.env.PUBLIC_URL || ""}/android-chrome-512x512.png`} alt="JR & Co." /><div className="sub">Headcover Studio</div>
        {sessionId && <div className="sess">Session: <b>{club.trim() || "Untitled"}</b></div>}
        <div className="sp" /><div className="status">{busy ? "Rendering…" : status}</div>
        <button className="head-btn" onClick={newSession}>+ New session</button>
      </div>
      {view === "setup" ? (
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
              <CanvasView canvas={logoView} className="logoPrev" onClick={(e) => { e.stopPropagation(); openLogoEdit(); }} />
            ) : (
              <div className="hint">
                {isTouch ? (
                  <><b>Add a logo</b><br />Press and hold the logo picture → Copy,<br />then press and hold the box below → Paste<br />
                    <span className="small">or tap here to pick a photo / file</span></>
                ) : (
                  <><b>Paste a logo</b><br />Copy it from Google Images, then press <kbd>Ctrl</kbd>+<kbd>V</kbd><br />
                    <span className="small">or drag a file here / click to browse</span></>
                )}
              </div>
            )}
          </div>
          <input type="file" ref={fileRef} accept="image/*" hidden
            onChange={(e) => { if (e.target.files[0]) loadBlob(e.target.files[0]); e.target.value = ""; }} />
          <div className="pasterow">
            <div ref={pasteBoxRef} className="pastebox" contentEditable suppressContentEditableWarning
              onInput={() => {   // some browsers drop the pasted picture straight into the box instead of a paste event
                const el = pasteBoxRef.current, im = el && el.querySelector("img");
                if (im && im.src) { const src = im.src; clearPasteBox(); loadUrl(src); } else if (el) el.textContent = "";
              }}
              onDrop={(e) => e.preventDefault()}
              data-ph="Press and hold here → Paste" />
            <button onClick={pasteFromClipboard}>Paste</button>
            <button onClick={() => fileRef.current?.click()}>Photo / file</button>
          </div>
          {logoView && (
            <div className="row">
              <button className="editlogo" onClick={openLogoEdit}>✎ Edit logo</button>
              <span className="small" style={{ flex: 1 }}>Erase, clean up the background, change colours{logoMap.length ? ` · ${logoMap.length} colour change${logoMap.length > 1 ? "s" : ""}` : ""}</span>
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <input type="text" value={club} onChange={(e) => setClub(e.target.value)} placeholder="Club name (customer folder, file name, sheet)" />
          </div>

          <div className="course">
            <div className="small"><b>Painted Course</b> · optional clubhouse or course photo, oil-painted onto the cover with the logo embroidered on top</div>
            <div className="row">
              {course ? (
                <>
                  <img src={course.url} alt="" className="coursePrev" onClick={() => courseRef.current?.click()} />
                  <span className="small" style={{ flex: 1 }}>{course.width} × {course.height} px{course.width * course.height < 4e6 ? " · small for print, ask for the original photo" : ""}</span>
                  <button onClick={() => courseRef.current?.click()}>Change</button>
                  <button onClick={() => loadCourse(null)}>Remove</button>
                </>
              ) : (
                <button onClick={() => courseRef.current?.click()}>Add course photo</button>
              )}
            </div>
            <input type="file" ref={courseRef} accept="image/*" hidden
              onChange={(e) => { if (e.target.files[0]) loadCourse(e.target.files[0]); e.target.value = ""; }} />
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
                <span key={f.id} title={f.name + (furInStock(f) ? "" : " · not in Material Inventory")}
                  className={"dot" + (f.id === furId ? " sel" : "")}
                  style={{ ...tileBg(f), opacity: furInStock(f) ? 1 : 0.45 }}
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
          <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <label style={{ marginTop: 5 }}>Products</label>
            <span className="lines" style={{ flex: 1, margin: 0 }}>
              {S.products.map((p) => (
                <button key={p} className={products.includes(p) ? "on" : ""}
                  onClick={() => setProducts((cur) => (cur.includes(p) ? (cur.length > 1 ? cur.filter((x) => x !== p) : cur) : [...cur, p]))}>
                  {p}
                </button>
              ))}
            </span>
          </div>
          <div className="row"><label><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> Include quick styles (stand-in shapes)</label></div>
          <button className="primary" disabled={!canGo || busy} onClick={() => buildBatch({ fresh: true })}>
            {designs.length ? "Redesign (keeps locked)" : "Design covers"} &nbsp;↵
          </button>
          {designs.length > 0 && <button className="primary ghost" onClick={() => setView("review")}>Back to designs ({designs.length}) →</button>}

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
            <div className="sessions">
              <div className="toolbar"><div className="title">Sessions</div></div>
              {!sessions.length ? (
                <div className="empty-state">
                  <div className="big">Paste a club logo, pick colors, hit Enter.</div>
                  <div>Each batch of designs is saved as a session in this browser. Swipe through them, then edit, delete or lock each one.</div>
                </div>
              ) : (
                <div className="sgrid">
                  {sessions.map((x) => (
                    <div key={x.id} className={"scard" + (x.id === sessionId ? " cur" : "")} onClick={() => openSession(x.id)}>
                      <div className="th" style={x.thumb ? { backgroundImage: `url(${x.thumb})` } : {}} />
                      <div className="sm">
                        <b>{x.name}</b>
                        <span className="small">{x.count} designs{x.locked ? ` · ${x.locked} locked` : ""} · {ago(x.updatedAt)}</span>
                      </div>
                      <button className="del" title="Delete session" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete the session “${x.name}”?`)) removeSession(x.id); }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className={"review" + (editing ? " editing" : "")}>
          <div className="rv-bar">
            <button onClick={() => { setView("setup"); setEditing(false); }}>← Setup</button>
            <div className="title">{club.trim() || "Concepts"}</div>
            <span className="small">{designs.length ? `${idx + 1} / ${designs.length}` : "No designs"} · {lockedCount} locked</span>
            <div className="sp" />
            <button className="on" disabled={busy} onClick={() => buildBatch({ next: true })}
              title="Replaces every design that isn't locked with new combinations of your colors">
              Create new ones{designs.length - lockedCount ? ` (${designs.length - lockedCount})` : ""}
            </button>
            <button onClick={dlLocked}>Download locked</button>
            <button onClick={dlSheet}>Download all</button>
            <button onClick={() => saveToFolder()} title="Saves the locked designs (or all, if none are locked) into the club's customer folder in Drive">Save to customer folder</button>
          </div>
          {!designs.length ? (
            <div className="empty-state"><div className="big">Every design is deleted.</div><button className="on" onClick={() => buildBatch({ next: true })}>Create new ones</button></div>
          ) : (
            <div className={"rv-body" + (editing && cur ? " editing" : "")}>
              <div className="rv-stage">
                <Carousel designs={designs} idx={idx} setIdx={(i) => { setIdx(i); setPickRole(null); }} flat={flatView}>
                  {cur?.locked && <div className="lockbadge">🔒 Locked</div>}
                </Carousel>
                {cur && (
                  <div className="rv-meta">
                    <div className="nm">{cur.spec.design}<span className="cw">Colorway {cur.spec.cw}</span></div>
                    <div className="chips">
                      {cur.spec.roles.map((r, k) => (
                        <span key={k} className="mchip" title={`${r.label}: ${r.mat.name} · ${r.mat.line}`}><span className="dot" style={tileBg(r.mat)} />{r.mat.name}</span>
                      ))}
                    </div>
                    <div className="acts">
                      <button className={editing ? "on" : ""} onClick={() => { setEditing((v) => !v); setPickRole(null); }}>✎ Edit</button>
                      <button onClick={() => removeDesign(cur)}>🗑 Delete</button>
                      <button className={cur.locked ? "on lock" : "lock"} onClick={() => toggleLock(cur)}>{cur.locked ? "🔒 Locked" : "🔓 Lock"}</button>
                      <button onClick={() => setFlatView((v) => !v)}>{flatView ? "3D proof" : "Flat layout"}</button>
                      <button onClick={() => cur.canvas && downloadCanvas(flatView && cur.flat ? cur.flat : cur.canvas, `${slug(club)}_${slug(cur.spec.design)}_${cur.spec.cw}.png`)}>PNG</button>
                    </div>
                  </div>
                )}
                <div className="strip">
                  {designs.map((d, i) => (
                    <div key={d.uid} className={"tn" + (i === idx ? " cur" : "") + (d.locked ? " locked" : "")} onClick={() => { setIdx(i); setPickRole(null); }} title={`${d.spec.design} ${d.spec.cw}`}>
                      {d.thumb ? <img src={d.thumb} alt="" /> : <span className="small">…</span>}
                      {d.locked && <span className="lk">🔒</span>}
                    </div>
                  ))}
                </div>
              </div>
              {editing && cur && (
                <div className="editor">
                  <h3>Edit design</h3>
                  <div className="small">Click a part, then pick its material. Edited designs are locked so “Create new ones” keeps them.</div>
                  {cur.spec.roles.map((r, k) => (
                    <div key={k} className={"role" + (pickRole === k ? " on" : "")} onClick={() => setPickRole(pickRole === k ? null : k)}>
                      <span className="sw" style={tileBg(r.mat)} />
                      <span className="rl"><span className="small">{r.label}</span><br /><b>{r.mat.name}</b> <span className="small">{r.mat.line}</span></span>
                      <span className="chev">{pickRole === k ? "▾" : "▸"}</span>
                    </div>
                  ))}
                  {cur.spec.kind !== "pattern" && (() => {
                    const v = cur.spec.logoScale || logoSize / 100;
                    return (
                      <div className="patctl">
                        <label className="patrow">
                          <span>Logo size{cur.spec.logoScale ? "" : " · same as session"}<b>{Math.round(v * 100)}%</b></span>
                          <input type="range" min="60" max="400" step="5" value={Math.round(v * 100)} onChange={(e) => setDesignLogo(+e.target.value / 100)} />
                        </label>
                        {cur.spec.logoScale && <button className="ghost" onClick={() => setDesignLogo(null)}>Use session size</button>}
                      </div>
                    );
                  })()}
                  {cur.spec.kind === "pattern" && (() => {
                    const P = { ...PATTERN_DEFAULT, ...(cur.spec.pattern || {}) };
                    const sl = (k, label, min, max) => (
                      <label className="patrow" key={k}>
                        <span>{label}<b>{P[k].toFixed(2)}"</b></span>
                        <input type="range" min={min} max={max} step="0.05" value={P[k]} onChange={(e) => setPattern({ [k]: +e.target.value })} />
                      </label>
                    );
                    return (
                      <div className="patctl">
                        <div className="small">Logo pattern</div>
                        {sl("size", "Logo size", 0.5, 3)}
                        {sl("gapX", "Space across (X)", 0, 2)}
                        {sl("gapY", "Space down (Y)", 0, 2)}
                        <label className="chk"><input type="checkbox" checked={P.flip} onChange={(e) => setPattern({ flip: e.target.checked })} /> Alternate upside-down (180 / 0)</label>
                        <label className="chk"><input type="checkbox" checked={P.front} onChange={(e) => setPattern({ front: e.target.checked })} /> Front only (plain back)</label>
                        <label className="chk"><input type="checkbox" checked={P.orig == null ? !!S.patternOwnColours() : P.orig} onChange={(e) => setPattern({ orig: e.target.checked })} /> Logo in its own colours</label>
                        <button className="ghost" onClick={() => setPattern({ ...PATTERN_DEFAULT })}>Reset pattern</button>
                      </div>
                    );
                  })()}
                  {(() => {
                    const own = cur.spec.logoColors || [];
                    const map = own.length ? own : logoMap;
                    const body = S.logoGroundMat(cur.spec) || cur.spec.roles[0].mat;
                    const picks = [...cur.spec.roles.map((r) => r.mat), ...slots.filter(Boolean), S.WHITE, S.BLACK].filter((m, i, l) => m && l.findIndex((q) => q.hex.toLowerCase() === m.hex.toLowerCase() || q.name === m.name) === i);
                    return (
                      <div className="patctl">
                        <div className="small">Logo colours{own.length ? " · this design only" : " · same as session"}</div>
                        <LogoColors palette={logoPal} map={map} picks={picks} onChange={(m) => setDesignLogoColors(m)}
                          extra={<button className="ghost" title={`Whole logo in ${body.name}`} onClick={() => setDesignLogoColors(logoPal.map((c) => ({ from: c.hex, to: body.hex })))}>Match leather</button>} />
                        {own.length > 0 && <button className="ghost" onClick={() => setDesignLogoColors(null)}>Use session colours</button>}
                        <div className="small" style={{ marginTop: 10 }}>Logo outline{cur.spec.logoStroke && cur.spec.logoStroke.width > 0 ? "" : " · none"}</div>
                        <div className="logocols"><div className="lcpick" style={{ marginTop: 4 }}>
                          {picks.map((m, i) => <span key={(m.id || m.hex) + i} className={"dot" + (cur.spec.logoStroke && cur.spec.logoStroke.color === m.hex ? " sel" : "")} title={m.name} style={{ background: m.hex }}
                            onClick={() => setDesignStroke({ color: m.hex, width: (cur.spec.logoStroke && cur.spec.logoStroke.width) || 0.04 })} />)}
                          <label className="anyc"><input type="color" value={(cur.spec.logoStroke && cur.spec.logoStroke.color) || "#ffffff"}
                            onChange={(e) => setDesignStroke({ color: e.target.value, width: (cur.spec.logoStroke && cur.spec.logoStroke.width) || 0.04 })} /> Any</label>
                        </div></div>
                        {cur.spec.logoStroke && cur.spec.logoStroke.width > 0 && (
                          <label className="patrow">
                            <span>Outline width<b>{cur.spec.logoStroke.width.toFixed(2)}"</b></span>
                            <input type="range" min="0.01" max="0.15" step="0.01" value={cur.spec.logoStroke.width} onChange={(e) => setDesignStroke({ ...cur.spec.logoStroke, width: +e.target.value })} />
                          </label>
                        )}
                        {cur.spec.logoStroke && cur.spec.logoStroke.width > 0 && <button className="ghost" onClick={() => setDesignStroke(null)}>No outline</button>}
                      </div>
                    );
                  })()}
                  {cur.spec.kind === "painted" && (() => {
                    const P = { ...PAINT_DEFAULT, ...(cur.spec.paint || {}) }, L = { ...OIL_DEFAULT, ...P.look };
                    const T = S.templates.find((t) => t.id === cur.spec.tpl), area = P.area || (T && T.paintArea) || "front";
                    const dpi = S.paintDpi(cur.spec);
                    const sl = (label, val, min, max, step, on, fmt) => (
                      <label className="patrow" key={label}>
                        <span>{label}<b>{fmt ? fmt(val) : val}</b></span>
                        <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => on(+e.target.value)} />
                      </label>
                    );
                    if (!S.hasCourse()) return <div className="patctl"><div className="small">Add a course photo in setup to paint this design.</div></div>;
                    return (
                      <div className="patctl">
                        <div className="small">Painting</div>
                        <div className="lines" style={{ margin: "2px 0 6px" }}>
                          <button className={area === "front" ? "on" : ""} onClick={() => setPaint({ area: "front" })}>Front panel</button>
                          <button className={area === "all" ? "on" : ""} onClick={() => setPaint({ area: "all" })}>All panels</button>
                          <button onClick={() => setPaint({ rot: ((P.rot || 0) + 90) % 360 })}>Turn 90°</button>
                        </div>
                        {sl("Zoom", P.zoom, 1, 3, 0.05, (v) => setPaint({ zoom: v }), (v) => `${Math.round(v * 100)}%`)}
                        {sl("Move left / right", P.x, -0.5, 0.5, 0.01, (v) => setPaint({ x: v }), (v) => (v * 100).toFixed(0))}
                        {sl("Move up / down", P.y, -0.5, 0.5, 0.01, (v) => setPaint({ y: v }), (v) => (v * 100).toFixed(0))}
                        <div className="small">Paint look</div>
                        {sl("Brush size", L.scale, 2, 9, 1, (v) => setLook({ scale: v }))}
                        {sl("Paint ridges", L.rim, 0, 8, 1, (v) => setLook({ rim: v, relief: v }))}
                        {sl("Keep detail", L.detail, 2, 10, 1, (v) => setLook({ detail: v }))}
                        {sl("Colour pop", L.vivid, 0, 10, 1, (v) => setLook({ vivid: v }))}
                        <button className="ghost" onClick={() => setPaint({ ...PAINT_DEFAULT })}>Reset painting</button>
                        {dpi != null && (
                          <div className={"small" + (dpi < 150 ? " warn" : "")} style={{ marginTop: 6 }}>
                            Photo sharpness at this size: <b>{dpi} dpi</b>{dpi < 150 ? " · low, the print will look soft. Zoom out or get a bigger photo." : dpi < 300 ? " · fine once painted" : ""}
                          </div>
                        )}
                        <button className="ghost" disabled={!!printing} onClick={downloadPrint}>{printing || "Download print file (300 dpi, no logo)"}</button>
                      </div>
                    );
                  })()}
                  <div className="role furrow">
                    <span className="rl"><span className="small">Fur lining{cur.spec.furId ? "" : " · same as session"}</span><br /><b>{furOf(cur.spec)?.name}</b></span>
                  </div>
                  <span className="furs editfurs">
                    {furs.map((f) => (
                      <span key={f.id} title={f.name + (furInStock(f) ? "" : " · not in Material Inventory")}
                        className={"dot" + (f.id === furOf(cur.spec)?.id ? " sel" : "")}
                        style={{ ...tileBg(f), opacity: furInStock(f) ? 1 : 0.45 }}
                        onClick={() => setDesignFur(f.id === fur?.id ? null : f)} />
                    ))}
                  </span>
                  {pickRole != null && (
                    <div className="picker">
                      <div className="lines">
                        {["Your colors", ...lines].map((l) => <button key={l} className={l === pickLine ? "on" : ""} onClick={() => setPickLine(l)}>{l}</button>)}
                      </div>
                      {pickLine !== "Your colors" && <input type="text" value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="Search materials" />}
                      <div className="lib">
                        {pickPool.map((m) => (
                          <div key={m.id} className={"swt" + (cur.spec.roles[pickRole]?.mat?.id === m.id ? " sel" : "") + (invMap && !invMap[m.id] ? " noinv" : "")}
                            onClick={() => setRole(pickRole, m)} title={`${m.name} · ${m.line}`}>
                            <div className="t" style={tileBg(m)} />
                            <div className="nm">{m.name}</div><div className="ln">{m.line}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button className="primary" onClick={() => { setEditing(false); setPickRole(null); }}>Done</button>
                </div>
              )}
            </div>
          )}
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

      {toast && (
        <div className="toast">{toast.text}{toast.undo && <button onClick={() => { toast.undo(); setToast(null); }}>Undo</button>}</div>
      )}
      {logoEdit && (
        <div className="modal">
          <div className="box logoedit">
            <h3>Edit logo</h3>
            <div onPointerDown={onLogoDown} onPointerMove={onLogoMove} onPointerUp={onLogoUp} onPointerCancel={onLogoUp}
              className={"lebig" + (logoTool === "click" ? "" : " brushing")}>
              <CanvasView canvas={liveLogo || modalLogo} className="logoPrev" onClick={logoTool === "click" ? onLogoClick : (e) => e.stopPropagation()} />
            </div>
            <div className="row logotools">
              <label>Tool</label>
              <button className={logoTool === "click" ? "on" : ""} onClick={() => setLogoTool("click")}>Click erase</button>
              <button className={logoTool === "erase" ? "on" : ""} onClick={() => setLogoTool("erase")}>Eraser</button>
              <button className={logoTool === "restore" ? "on" : ""} onClick={() => setLogoTool("restore")}>Restore</button>
              {logoTool !== "click" && <><span className="small">Size</span><input type="range" min="3" max="40" value={brush} onChange={(e) => setBrush(+e.target.value)} /></>}
              <button disabled={!canUndo} onClick={() => applyLogoResult(S.undoErase(), false)}>Undo</button>
            </div>
            <div className="small" style={{ margin: "2px 0 8px" }}>{logoTool === "click" ? "Click leftover background to erase every touching pixel of that colour." : logoTool === "erase" ? "Paint over anything you want gone (taglines, ® marks, specks)." : "Paint to bring back anything erased or eaten by the cleanup."}</div>
            <div className="row">
              <label>Background cleanup</label>
              <input type="range" min="8" max="110" value={tol} onChange={(e) => onTol(+e.target.value)} />
              <button className={inside ? "on" : ""} onClick={toggleInside} title="Also remove background colour trapped inside letters and shapes">Clear inside</button>
            </div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label style={{ marginTop: 6 }}>Colours</label>
              <span style={{ flex: 1 }}>
                <LogoColors palette={logoPal} map={logoMap} onChange={setSessionLogoColors}
                  picks={[...slots.filter(Boolean), S.WHITE, S.BLACK].filter((m, i, l) => l.findIndex((q) => q.hex.toLowerCase() === m.hex.toLowerCase() || q.name === m.name) === i)} />
              </span>
            </div>
            <div className="lebtns">
              <button onClick={() => applyLogoResult(S.resetLogo(), false)}>Start over</button>
              <span style={{ flex: 1 }} />
              <button onClick={cancelLogoEdit}>Cancel</button>
              <button className="primary" onClick={saveLogoEdit}>Save logo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
