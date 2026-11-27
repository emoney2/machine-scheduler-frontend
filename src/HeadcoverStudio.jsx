import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ROOT } from "./apiRoot";
import {
  loadStudioData, createStudio, ensureTiles, slug, downloadCanvas, canvasToBlob, hexToRgb,
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
  const renderSeq = useRef(0);
  // (re)draw the given designs one at a time so the first ones show up straight away
  const renderAll = useCallback(async (list, onlyUids) => {
    const s = studioRef.current, seq = ++renderSeq.current, o = renderOpts();
    setBusy(true);
    for (const d of list) {
      if (onlyUids && !onlyUids.has(d.uid)) continue;
      const r = await s.renderSpec(d.spec, o);
      if (seq !== renderSeq.current) return;
      if (!r) continue;
      setDesigns((cur) => cur.map((x) => (x.uid === d.uid ? { ...x, canvas: r.canvas, flat: r.flat, thumb: thumbOf(r.canvas, 200) } : x)));
    }
    setBusy(false);
  }, [renderOpts]);

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
    if (!designs.length) return;
    clearTimeout(rerenderTimer.current);
    rerenderTimer.current = setTimeout(() => renderAll(designs), 150);
  }, [oneColor, furId, logoSize, logoView]);

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
    const r = await S.renderSpec(spec, renderOpts());
    if (r) updateDesign(cur.uid, { canvas: r.canvas, flat: r.flat, thumb: thumbOf(r.canvas, 200) });
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
          logo: logoBlob.current,
          settings: { slots: slots.map((m) => m && m.id), furId, logoSize, oneColor, products, swapped, variant, tol, inside },
          designs: designs.map((d) => ({ spec: packSpec(d.spec), locked: d.locked })),
        });
        setSessions(await listSessions());
      } catch (e) { console.warn("[HeadcoverStudio] session not saved", e); }
    }, 600);
  }, [designs, club, slots, furId, logoSize, oneColor, products, swapped, variant]);

  const openSession = async (id) => {
    const x = await getSession(id);
    if (!x) return showToast("That session couldn't be found.");
    const st = x.settings || {};
    if (x.logo) applyLogoResult(await S.restoreLogo(x.logo), false);
    logoBlob.current = x.logo || null; logoDirty.current = false;
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
    logoBlob.current = null;
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
  const sheetOf = (list) => S.sheet(asOut(list), { club: club.trim(), furName: fur?.name });
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
              <CanvasView canvas={logoView} className="logoPrev" onClick={onLogoClick} />
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
            <div className="rv-body">
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
    </div>
  );
}
