/**
 * Headcover Studio rendering engine (ported from the standalone "JR Headcover Studio.html").
 *
 * Everything renders in the browser on <canvas>: logo cleanup, colour matching, flat
 * template layouts, the 3D proof warp (precomputed per-pixel UV map multiplied over the
 * product's grey shading) and the proof sheet. React (HeadcoverStudio.jsx) owns the UI
 * and state; this module only takes inputs and returns canvases / data.
 *
 * Owner's colorway rules (keep these):
 *   - back panel = the lightest colour in that colorway's camo
 *   - camo uses 3 of the 4 picks: A = lightest + picks 1 & 2, B = lightest + picks 2 & 3
 *   - customers see the 3D proof; the flat layout is only shown in the lightbox
 */

const { DecompressionStream, DOMMatrix } = window;

/* ---------- colour math ---------- */
export const hexToRgb = (h) => {
  h = String(h || "#000000").replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const rgbToHex = (c) =>
  "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function lin(v) {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export function toLab(c) {
  const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047,
    y = r * 0.2126 + g * 0.7152 + b * 0.0722,
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const dE = (a, b) => {
  const A = toLab(a), B = toLab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
const shade = (c, k) => c.map((v) => (k > 0 ? v + (255 - v) * k : v * (1 + k)));
export const isLight = (m) => lum(m.rgb) > 0.32;

const makeCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
export const cloneCanvas = (c) => {
  const n = makeCanvas(c.width, c.height);
  n.getContext("2d").drawImage(c, 0, 0);
  return n;
};
const loadImg = (src) =>
  new Promise((r) => {
    const i = new Image();
    i.onload = () => r(i);
    i.onerror = () => r(null);
    i.src = src;
  });
const pixelsOf = (img) => {
  const c = makeCanvas(img.width, img.height), x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  return x.getImageData(0, 0, c.width, c.height).data;
};

/* ---------- data loading (files in public/headcover-studio) ---------- */
async function inflate16(url) {
  const res = await fetch(url);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  return new Int16Array(buf);
}

export async function loadStudioData(base) {
  base = base.replace(/\/$/, "") + "/";
  const cat = await (await fetch(base + "catalog.json", { cache: "no-cache" })).json();
  const swDir = base + cat.swatches.replace(/[^/]+$/, "");
  const sw = await (await fetch(base + cat.swatches, { cache: "no-cache" })).json();
  const all = (sw.materials || sw).map((s) => ({ ...s, rgb: hexToRgb(s.hex), tileUrl: s.tile ? swDir + s.tile : null }));

  // Only the small manifests load up front; each product's images and UV maps load when it's first used.
  const templates = await Promise.all(
    (cat.templates || []).map(async (e) => {
      const dir = base + e.dir;
      const T = await (await fetch(dir + "template.json", { cache: "no-cache" })).json();
      return Object.assign(T, { id: e.id, dir, ready: null });
    })
  );
  const proofs = await Promise.all(
    (cat.proofs || []).map(async (e) => {
      const dir = base + e.dir;
      const P = await (await fetch(dir + "proof.json", { cache: "no-cache" })).json();
      return Object.assign(P, { id: e.id, dir, ready: null });
    })
  );

  const materials = all.filter((s) => s.kind !== "fur");
  const furs = all.filter((s) => s.kind === "fur");
  return { materials, furs, templates, proofs };
}

function loadTemplateAssets(T) {
  if (T.ready) return T.ready;
  T.ready = (async () => {
    const dir = T.dir;
    T.frameImg = T.frame ? await loadImg(dir + T.frame) : null;
    T.slotImgs = await Promise.all(T.slots.map((s) => loadImg(dir + s.mask)));
    T.furImg = T.fur ? await loadImg(dir + T.fur.mask) : null;
    T.logoGround = -1;   // which slot sits under the logo centre (for logo contrast)
    if (T.logo) {
      const cx = Math.round(T.logo.x + T.logo.w / 2), cy = Math.round(T.logo.y + T.logo.h / 2);
      T.slotImgs.forEach((im, i) => {
        if (!im) return;
        const c = makeCanvas(T.w, T.h), x = c.getContext("2d");
        x.drawImage(im, 0, 0);
        if (x.getImageData(cx, cy, 1, 1).data[3] > 128) T.logoGround = i;
      });
    }
  })();
  return T.ready;
}

function loadProofAssets(P) {
  if (P.ready) return P.ready;
  P.ready = (async () => {
    const dir = P.dir;
    for (const v of P.views) {
      if (v.draft) continue;   // view whose 3D map isn't exact yet: not drawn, so not downloaded
      const [, , w, h] = v.bbox;
      v.basePx = pixelsOf(await loadImg(dir + v.base));
      const d = await inflate16(dir + v.uv);
      const uv = new Uint16Array(w * h * 2);
      for (let r = 0; r < h; r++) {
        let pu = 0, pv = 0;
        for (let q = 0; q < w; q++) {
          const k = (r * w + q) * 2;
          pu = (q ? pu + d[k] : d[k]) & 0xffff;
          pv = (q ? pv + d[k + 1] : d[k + 1]) & 0xffff;
          uv[k] = pu; uv[k + 1] = pv;
        }
      }
      v.uvArr = uv;
    }
    if (P.fur) P.furPx = pixelsOf(await loadImg(dir + P.fur.png));
    P.overlayImg = P.overlay ? await loadImg(dir + P.overlay) : null;
  })();
  return P.ready;
}

/** Decode the tile images for a set of swatches (lazily, only what is used). */
export async function ensureTiles(list) {
  await Promise.all(
    list.filter((m) => m && m.tileUrl && !m.solid && !m.img).map(async (m) => {
      m.img = await loadImg(m.tileUrl);
    })
  );
}

/* ---------- studio ---------- */
export function createStudio({ materials, furs, templates, proofs }) {
  const SW = materials;
  const find = (line, name) => SW.find((s) => s.line === line && s.name.toLowerCase() === name.toLowerCase());
  const byLum = [...SW].sort((a, b) => lum(a.rgb) - lum(b.rgb));
  const WHITE = find("Classic Leather", "White") || byLum[byLum.length - 1];
  const BLACK = find("Classic Leather", "Black") || byLum[0];
  const NAVY = find("Classic Leather", "Navy Blue") || BLACK;
  const W = 600, H = 830, CX = 300;
  const SIL_PPI = 60;   // quick-style silhouettes are ~14" tall on a 830 px canvas
  const LOGO = { src: null, canvas: null, base: null, history: [], main: null, colors: [] };
  let CUR = { mats: [] };

  /* ----- materials as canvas fills ----- */
  let grainPat = null;
  function grain(ctx) {
    if (!grainPat) {
      const g = makeCanvas(128, 128), x = g.getContext("2d"), d = x.createImageData(128, 128);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.random() < 0.5 ? 0 : 255;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = Math.random() * 14;
      }
      x.putImageData(d, 0, 0);
      grainPat = g;
    }
    return ctx.createPattern(grainPat, "repeat");
  }
  // Fur strokes for solid furs in the flat layout (the 3D proof uses the product's own fur shading).
  const furCache = {};
  function furTile(hex) {
    if (furCache[hex]) return furCache[hex];
    const c = makeCanvas(96, 96), x = c.getContext("2d");
    x.fillStyle = hex; x.fillRect(0, 0, 96, 96);
    for (let i = 0; i < 900; i++) {
      const px = Math.random() * 96, py = Math.random() * 96, l = 4 + Math.random() * 7, a = -1.2 + Math.random() * 0.5, v = Math.random() < 0.5;
      x.strokeStyle = v ? `rgba(255,255,255,${0.15 + Math.random() * 0.25})` : `rgba(70,70,70,${0.12 + Math.random() * 0.2})`;
      x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
    furCache[hex] = c;
    return c;
  }
  // Solid colours tint the template's leather (flat colour; the proof's shading supplies the leather look).
  // Patterned materials use their seamless tile at real-world scale: a tile covers m.tileInches.
  function matStyle(ctx, m, ppi = SIL_PPI) {
    if (m.solid) return m.kind === "fur" ? ctx.createPattern(furTile(m.hex), "repeat") : m.hex;
    if (m.img && m.img.complete && m.img.width) {
      const p = ctx.createPattern(m.img, "repeat");
      p.setTransform(new DOMMatrix().scale((ppi * (m.tileInches || 2.1)) / m.img.width));
      return p;
    }
    return m.hex;
  }

  /* ----- stand-in driver silhouette for the quick styles ----- */
  function silPath() {
    const p = new Path2D();
    p.moveTo(212, 784); p.bezierCurveTo(206, 690, 198, 560, 196, 486);
    p.bezierCurveTo(138, 456, 84, 392, 84, 286); p.bezierCurveTo(84, 148, 184, 64, 300, 64);
    p.bezierCurveTo(416, 64, 516, 148, 516, 286); p.bezierCurveTo(516, 392, 462, 456, 404, 486);
    p.bezierCurveTo(402, 560, 394, 690, 388, 784); p.bezierCurveTo(330, 798, 270, 798, 212, 784);
    p.closePath();
    return p;
  }
  const SIL = silPath();
  const HEAD = (() => { const p = new Path2D(); p.moveTo(0, 0); p.lineTo(W, 0); p.lineTo(W, 486); p.quadraticCurveTo(300, 514, 0, 486); p.closePath(); return p; })();
  const NECK = (() => { const p = new Path2D(); p.moveTo(0, 486); p.quadraticCurveTo(300, 514, W, 486); p.lineTo(W, H); p.lineTo(0, H); p.closePath(); return p; })();
  const SEAM = (() => { const p = new Path2D(); p.moveTo(0, 486); p.quadraticCurveTo(300, 514, W, 486); return p; })();
  function fillIn(ctx, clips, style) { ctx.save(); clips.forEach((c) => ctx.clip(c)); ctx.fillStyle = style; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  function rectPath(x, y, w, h) { const p = new Path2D(); p.rect(x, y, w, h); return p; }
  function stitch(ctx, path, light, w = 1.6) {
    ctx.save(); ctx.setLineDash([7, 6]); ctx.lineWidth = w;
    ctx.strokeStyle = light ? "rgba(255,255,255,.45)" : "rgba(0,0,0,.4)"; ctx.stroke(path); ctx.restore();
  }
  function band(ctx, m, width) {
    ctx.save(); ctx.clip(SIL); ctx.lineWidth = width; ctx.strokeStyle = matStyle(ctx, m); ctx.stroke(SEAM);
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.translate(0, -width / 2); ctx.stroke(SEAM);
    ctx.translate(0, width); ctx.stroke(SEAM); ctx.restore();
  }
  function shading(ctx) {
    ctx.save(); ctx.clip(SIL);
    ctx.fillStyle = grain(ctx); ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(240, 190, 10, 250, 210, 300);
    g.addColorStop(0, "rgba(255,255,255,.26)"); g.addColorStop(0.5, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.clip(HEAD);
    g = ctx.createRadialGradient(300, 270, 150, 300, 280, 270);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.42)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.save(); ctx.clip(NECK);
    g = ctx.createLinearGradient(196, 0, 404, 0);
    g.addColorStop(0, "rgba(0,0,0,.42)"); g.addColorStop(0.33, "rgba(0,0,0,0)"); g.addColorStop(0.45, "rgba(255,255,255,.10)");
    g.addColorStop(0.62, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.45)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, 486, 0, 560); g.addColorStop(0, "rgba(0,0,0,.32)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    [[232, 520, 228, 770], [262, 530, 260, 775], [352, 525, 358, 770]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1 + 8, y1 + 60, x2 - 8, y2 - 70, x2, y2);
      ctx.lineWidth = 10; ctx.strokeStyle = "rgba(0,0,0,.07)"; ctx.stroke(); ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.translate(-4, 0); ctx.stroke(); ctx.translate(4, 0);
    });
    ctx.restore(); ctx.restore();
  }
  function piping(ctx, m, bodyLight) {
    ctx.save(); ctx.lineWidth = 11; ctx.strokeStyle = matStyle(ctx, m); ctx.stroke(SIL);
    ctx.lineWidth = 11; ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.stroke(SIL);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.translate(-1.5, -1.5); ctx.stroke(SIL); ctx.restore();
    ctx.save(); ctx.translate(CX, 390); ctx.scale(0.952, 0.966); ctx.translate(-CX, -390); stitch(ctx, SIL, !bodyLight, 1.7); ctx.restore();
  }
  function tartan(cols) {
    const s = 150, c = makeCanvas(s, s), x = c.getContext("2d");
    x.fillStyle = cols[0].hex; x.fillRect(0, 0, s, s);
    const sett = [[0, 36, cols[1], 0.8], [50, 8, cols[2], 0.9], [78, 22, cols[1], 0.8], [118, 4, cols[3], 0.95], [128, 4, cols[2], 0.9]];
    sett.forEach(([p, w, m, a]) => { x.globalAlpha = a * 0.75; x.fillStyle = m.hex; x.fillRect(0, p, s, w); });
    sett.forEach(([p, w, m, a]) => { x.globalAlpha = a * 0.6; x.fillStyle = m.hex; x.fillRect(p, 0, w, s); });
    x.globalAlpha = 0.1; x.strokeStyle = "#000"; x.lineWidth = 1;
    for (let i = -s; i < s; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + s, s); x.stroke(); }
    return c;
  }
  function houndstooth(a, b) {
    const u = 4, s = 8 * u, c = makeCanvas(s, s), x = c.getContext("2d");
    x.fillStyle = b.hex; x.fillRect(0, 0, s, s); x.fillStyle = a.hex; x.fillRect(0, 0, 4 * u, 4 * u);
    x.beginPath(); x.moveTo(4 * u, 4 * u); x.lineTo(8 * u, 0); x.lineTo(8 * u, 2 * u); x.lineTo(6 * u, 4 * u); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(0, 8 * u); x.lineTo(4 * u, 4 * u); x.lineTo(4 * u, 6 * u); x.lineTo(2 * u, 8 * u); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(4 * u, 4 * u); x.lineTo(6 * u, 4 * u); x.lineTo(4 * u, 6 * u); x.closePath(); x.fill();
    return c;
  }

  /* ----- logo drawing (embroidery look) ----- */
  let threadPat = null;
  function threadTile() {
    if (threadPat) return threadPat;
    const c = makeCanvas(6, 6), x = c.getContext("2d");
    x.fillStyle = "rgba(255,255,255,.22)"; x.fillRect(0, 0, 6, 2); x.fillStyle = "rgba(0,0,0,.20)"; x.fillRect(0, 3, 6, 1.5);
    threadPat = c;
    return c;
  }
  function logoLayer(w, h, tint) {
    const c = makeCanvas(w, h), x = c.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(LOGO.canvas, 0, 0, w, h);
    if (tint) { x.globalCompositeOperation = "source-in"; x.fillStyle = tint; x.fillRect(0, 0, w, h); }
    x.globalCompositeOperation = "source-atop";
    const p = x.createPattern(threadTile(), "repeat"); p.setTransform(new DOMMatrix().rotate(-38)); x.fillStyle = p; x.fillRect(0, 0, w, h);
    return c;
  }
  function silhouetteOf(img, color) {
    const c = makeCanvas(img.width, img.height), x = c.getContext("2d");
    x.drawImage(img, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function bestContrast(ground) {
    const pool = [...CUR.mats, WHITE, BLACK];
    return pool.reduce((b, m) => (dE(m.rgb, ground.rgb) > dE(b.rgb, ground.rgb) ? m : b), pool[0]);
  }
  function drawLogo(ctx, cx, cy, maxW, maxH, ground, opts) {
    if (!LOGO.canvas) return;
    const r = Math.min(maxW / LOGO.canvas.width, maxH / LOGO.canvas.height), w = LOGO.canvas.width * r, h = LOGO.canvas.height * r;
    const tint = opts.tint || null;
    const img = logoLayer(w, h, tint);
    const main = tint ? hexToRgb(tint) : LOGO.main;
    const x = cx - w / 2, y = cy - h / 2;
    if (main && dE(main, ground.rgb) < 28) {   // logo would vanish on its ground: outline it
      const o = opts.outline || bestContrast(ground);
      const sil = silhouetteOf(img, o.hex);
      for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; ctx.drawImage(sil, x + Math.cos(t) * 4.5, y + Math.sin(t) * 4.5); }
    }
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 3; ctx.shadowOffsetX = 1.2; ctx.shadowOffsetY = 2.2;
    ctx.drawImage(img, x, y); ctx.restore();
  }
  function pickThread(c) {
    const cands = [c.accent, c.trim, c.extra, WHITE, BLACK];
    return cands.find((m) => m && dE(m.rgb, c.body.rgb) > 40)?.hex || bestContrast(c.body).hex;
  }

  /* ----- quick styles (stand-in shapes) ----- */
  const DESIGNS = [
    { name: "Classic", draw(ctx, c, o) { fillIn(ctx, [SIL], matStyle(ctx, c.body)); band(ctx, c.accent, 14); shading(ctx); piping(ctx, c.accent, isLight(c.body)); drawLogo(ctx, 300, 278, 300, 250, c.body, o); } },
    { name: "Two-Tone", draw(ctx, c, o) { fillIn(ctx, [SIL, HEAD], matStyle(ctx, c.body)); fillIn(ctx, [SIL, NECK], matStyle(ctx, c.accent)); band(ctx, c.trim, 16); shading(ctx); piping(ctx, c.trim, isLight(c.body)); drawLogo(ctx, 300, 278, 300, 250, c.body, o); } },
    { name: "Rally Stripe", draw(ctx, c, o) {
        fillIn(ctx, [SIL], matStyle(ctx, c.body));
        ctx.save(); ctx.clip(SIL);
        [[300 - 140, 34], [300 + 106, 34]].forEach(([x, w]) => { ctx.fillStyle = matStyle(ctx, c.trim); ctx.fillRect(x - 6, 0, w + 12, H); ctx.fillStyle = matStyle(ctx, c.accent); ctx.fillRect(x, 0, w, H); stitch(ctx, rectPath(x + 3, 0, w - 6, H), !isLight(c.accent), 1.3); });
        ctx.restore(); shading(ctx); piping(ctx, c.accent, isLight(c.body)); drawLogo(ctx, 300, 278, 215, 230, c.body, o); } },
    { name: "Side Panels", draw(ctx, c, o) {
        fillIn(ctx, [SIL], matStyle(ctx, c.accent)); fillIn(ctx, [SIL, rectPath(205, 0, 190, H)], matStyle(ctx, c.body));
        ctx.save(); ctx.clip(SIL); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(203, 0, 3, H); ctx.fillRect(394, 0, 3, H); ctx.restore();
        ctx.save(); ctx.clip(SIL); stitch(ctx, rectPath(212, 0, 176, H), !isLight(c.body), 1.4); ctx.restore();
        shading(ctx); piping(ctx, c.trim, isLight(c.accent)); drawLogo(ctx, 300, 278, 180, 230, c.body, o); } },
    { name: "Tartan", draw(ctx, c, o) {
        fillIn(ctx, [SIL, HEAD], matStyle(ctx, c.body)); const t = ctx.createPattern(tartan([c.body, c.accent, c.trim, c.extra]), "repeat"); fillIn(ctx, [SIL, NECK], t);
        band(ctx, c.trim, 16); shading(ctx); piping(ctx, c.accent, isLight(c.body)); drawLogo(ctx, 300, 278, 300, 250, c.body, o); } },
    { name: "Houndstooth", draw(ctx, c, o) {
        fillIn(ctx, [SIL, HEAD], matStyle(ctx, c.body)); const second = dE(c.accent.rgb, c.body.rgb) > 25 ? c.accent : bestContrast(c.body);
        const p = ctx.createPattern(houndstooth(c.body, second), "repeat"); fillIn(ctx, [SIL, NECK], p); band(ctx, c.accent, 14); shading(ctx); piping(ctx, c.accent, isLight(c.body));
        drawLogo(ctx, 300, 278, 300, 250, c.body, o); } },
    { name: "Varsity", draw(ctx, c, o) {
        fillIn(ctx, [SIL], matStyle(ctx, c.body));
        ctx.save(); ctx.clip(SIL); [[660, 16, c.trim], [682, 26, c.accent], [714, 16, c.trim]].forEach(([y, h, m]) => { ctx.fillStyle = matStyle(ctx, m); ctx.fillRect(0, y, W, h); }); ctx.restore();
        const patch = new Path2D(); patch.roundRect(168, 150, 264, 250, [100, 100, 28, 28]);
        ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; ctx.fillStyle = matStyle(ctx, c.trim); ctx.fill(patch); ctx.restore();
        ctx.save(); ctx.translate(300, 272); ctx.scale(0.93, 0.92); ctx.translate(-300, -272); ctx.fillStyle = matStyle(ctx, c.accent); ctx.fill(patch); stitch(ctx, patch, !isLight(c.accent), 1.4); ctx.restore();
        shading(ctx); piping(ctx, c.trim, isLight(c.body)); drawLogo(ctx, 300, 282, 200, 190, c.accent, o); } },
    { name: "Tonal Monogram", draw(ctx, c, o) {
        fillIn(ctx, [SIL], matStyle(ctx, c.body));
        if (LOGO.canvas) {
          const tone = rgbToHex(shade(c.body.rgb, isLight(c.body) ? -0.16 : 0.22));
          const r = Math.min(44 / LOGO.canvas.width, 34 / LOGO.canvas.height);
          const k = makeCanvas(LOGO.canvas.width * r, LOGO.canvas.height * r); k.getContext("2d").drawImage(LOGO.canvas, 0, 0, k.width, k.height);
          const mini = silhouetteOf(k, tone);
          ctx.save(); ctx.clip(SIL); ctx.globalAlpha = 0.75;
          for (let y = 40, row = 0; y < H; y += 58, row++) for (let x = row % 2 ? 40 : 10; x < W; x += 72) ctx.drawImage(mini, x, y);
          ctx.restore();
          ctx.save(); ctx.clip(SIL); ctx.fillStyle = matStyle(ctx, c.body); const pz = new Path2D(); pz.ellipse(300, 278, 168, 140, 0, 0, Math.PI * 2); ctx.fill(pz); ctx.restore();
        }
        band(ctx, c.accent, 12); shading(ctx); piping(ctx, c.accent, isLight(c.body)); drawLogo(ctx, 300, 278, 280, 235, c.body, o); } },
  ];

  /* ----- PSD templates (flat layout) ----- */
  function maskFill(ctx, T, img, style, shadow = true) {
    const c = makeCanvas(T.w, T.h), x = c.getContext("2d");
    x.drawImage(img, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = style; x.fillRect(0, 0, T.w, T.h);
    x.globalCompositeOperation = "source-atop"; x.fillStyle = grain(x); x.fillRect(0, 0, T.w, T.h);
    if (shadow) { ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 3; ctx.shadowOffsetX = 0.8; ctx.shadowOffsetY = 1.4; ctx.drawImage(c, 0, 0); ctx.restore(); }
    else ctx.drawImage(c, 0, 0);
  }
  function renderTemplate(T, mats, opts) {
    const cv = makeCanvas(T.w, T.h), ctx = cv.getContext("2d"), ppi = T.pxPerInch || 60;
    // mats = [back panel, camo base, camo mid, camo top]; body fill first, then the camo pieces
    ctx.fillStyle = matStyle(ctx, mats[0], ppi); ctx.fillRect(0, 0, T.w, T.h); ctx.fillStyle = grain(ctx); ctx.fillRect(0, 0, T.w, T.h);
    T.slotImgs.forEach((im, i) => { if (im) maskFill(ctx, T, im, matStyle(ctx, mats[(i + 1) % mats.length], ppi)); });
    if (T.frameImg) ctx.drawImage(T.frameImg, 0, 0);
    if (T.furImg && opts.fur) maskFill(ctx, T, T.furImg, matStyle(ctx, opts.fur, ppi), true);
    if (T.logo && LOGO.canvas) {
      const s = opts.logoScale, g = T.logoGround >= 0 ? mats[(T.logoGround + 1) % mats.length] : mats[0];
      const c = { body: mats[0], accent: mats[1], trim: mats[2], extra: mats[3] };
      drawLogo(ctx, T.logo.x + T.logo.w / 2, T.logo.y + T.logo.h / 2, T.logo.w * s, T.logo.h * s, g, { tint: opts.oneColor ? pickThread({ ...c, body: g }) : null });
    }
    return cv;
  }

  /* ----- 3D proof: flat layout -> product views via per-pixel UV map ----- */
  const furPxCache = new Map();
  function furTexture(fur, w, h, ppi) {
    // fur tile resampled to the proof's pixel scale, so tie-dye / tiger / custom prints read correctly
    const key = fur.id + ":" + w + "x" + h;
    if (furPxCache.has(key)) return furPxCache.get(key);
    let data = null;   // null = tint the fur shading with fur.rgb (solid furs)
    if (!fur.solid && fur.img && fur.img.width) {
      const c = makeCanvas(w, h), x = c.getContext("2d");
      const p = x.createPattern(fur.img, "repeat");
      p.setTransform(new DOMMatrix().scale((ppi * (fur.tileInches || 2.1)) / fur.img.width));
      x.fillStyle = p; x.fillRect(0, 0, w, h);
      data = x.getImageData(0, 0, w, h).data;
    }
    furPxCache.set(key, data);
    return data;
  }
  function renderProof(P, flat, fur) {
    const cv = makeCanvas(P.w, P.h), ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, P.w, P.h);
    const fw = flat.width, fh = flat.height, fd = flat.getContext("2d").getImageData(0, 0, fw, fh).data, sx = fw / P.contentW, sy = fh / P.contentH;
    const tmp = makeCanvas(1, 1), tx = tmp.getContext("2d");
    // fur sits where it does in the 3Draw's layer stack (fur.order = views drawn beneath it; old files: on top)
    const furAt = P.fur && Number.isInteger(P.fur.order) ? P.fur.order : P.views.length;
    const drawFur = () => {
      if (!(P.fur && P.furPx && fur)) return;
      const [x, y, w, h] = P.fur.bbox, src = P.furPx, out = new ImageData(w, h), o = out.data, c = fur.rgb;
      const tex = furTexture(fur, w, h, 70);   // 3Draw proofs are ~70 px per inch
      for (let i = 0; i < w * h; i++) {
        const a = src[i * 4 + 3];
        if (!a) continue;
        const l = (src[i * 4] + src[i * 4 + 1] + src[i * 4 + 2]) / 3, k = l / 174, e = (l - 174) * 0.3;
        const r0 = tex ? tex[i * 4] : c[0], g0 = tex ? tex[i * 4 + 1] : c[1], b0 = tex ? tex[i * 4 + 2] : c[2];
        o[i * 4] = Math.max(0, Math.min(255, r0 * k + e)); o[i * 4 + 1] = Math.max(0, Math.min(255, g0 * k + e)); o[i * 4 + 2] = Math.max(0, Math.min(255, b0 * k + e)); o[i * 4 + 3] = a;
      }
      tmp.width = w; tmp.height = h; tx.putImageData(out, 0, 0); ctx.drawImage(tmp, x, y);
    };
    P.views.forEach((v, vi) => {
      if (vi === furAt) drawFur();
      if (v.draft) return;
      const [x, y, w, h] = v.bbox, out = new ImageData(w, h), o = out.data, b = v.basePx, uv = v.uvArr;
      for (let i = 0, n = w * h; i < n; i++) {
        const a = b[i * 4 + 3];
        if (!a) continue;
        const u = uv[i * 2];
        if (u === 65535) { o[i * 4] = b[i * 4]; o[i * 4 + 1] = b[i * 4 + 1]; o[i * 4 + 2] = b[i * 4 + 2]; o[i * 4 + 3] = a; continue; }
        let fx = (u * sx) | 0, fy = (uv[i * 2 + 1] * sy) | 0;
        if (fx >= fw) fx = fw - 1;
        if (fy >= fh) fy = fh - 1;
        const j = (fy * fw + fx) * 4;   // multiply the design over the grey shading
        o[i * 4] = (b[i * 4] * fd[j]) / 255; o[i * 4 + 1] = (b[i * 4 + 1] * fd[j + 1]) / 255; o[i * 4 + 2] = (b[i * 4 + 2] * fd[j + 2]) / 255; o[i * 4 + 3] = a;
      }
      tmp.width = w; tmp.height = h; tx.putImageData(out, 0, 0); ctx.drawImage(tmp, x, y);
    });
    if (furAt >= P.views.length) drawFur();
    if (P.overlayImg) ctx.drawImage(P.overlayImg, 0, 0);
    return cv;
  }

  /* ----- colorways ----- */
  // Template colorways: mats = [back, camo base, camo mid, camo top]; back is always the lightest camo colour.
  function templateWays(sel) {
    let a = sel.filter(Boolean);
    if (!a.length) a = [NAVY, WHITE];
    const L = a.reduce((b, m) => (lum(m.rgb) > lum(b.rgb) ? m : b)), o = a.filter((m) => m !== L);
    if (!o.length) o.push(isLight(L) ? BLACK : NAVY);
    if (o.length >= 3) return [[L, o[0], o[1], L], [L, o[1], o[2], L]];   // A = lightest + 1,2 · B = lightest + 2,3
    if (o.length === 2) return [[L, o[0], o[1], L], [L, o[1], L, o[0]]];
    return [[L, o[0], L, o[0]], [L, L, o[0], o[0]]];
  }
  // Quick-style colorways: [body, accent, trim, extra]
  function expand(sel) {
    const a = sel.filter(Boolean);
    if (!a.length) return [NAVY, WHITE, WHITE, NAVY];
    const n = isLight(a[0]) ? BLACK : WHITE;
    if (a.length === 1) return [a[0], n, a[0], n];
    if (a.length === 2) return [a[0], a[1], a[1], a[0]];
    if (a.length === 3) return [a[0], a[1], a[2], a[1]];
    return a;
  }

  function renderOne(design, mats, opts) {
    const cv = makeCanvas(W, H), ctx = cv.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#fbfaf8"); bg.addColorStop(1, "#ece8e1"); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.30)"; ctx.shadowBlur = 34; ctx.shadowOffsetY = 20; ctx.fillStyle = "#777"; ctx.fill(SIL); ctx.restore();
    const c = { body: mats[0], accent: mats[1], trim: mats[2], extra: mats[3] };
    design.draw(ctx, c, { tint: opts.oneColor ? pickThread(c) : null });
    return cv;
  }

  /** Render everything. Returns [{design, cw, mats, tpl, wide, flat, proof, canvas}]. */
  async function generate({ slots, swapped, oneColor, logoScale, fur, quick, products }) {
    if (!LOGO.canvas || !slots.some(Boolean)) return { out: [], ms: 0 };
    const A = expand(slots), B = [A[1], A[0], A[3], A[2]];
    const [TA, TB] = templateWays(slots);
    const tpls = templates.filter((T) => !products || products.includes(T.product));
    await Promise.all([
      ensureTiles([...A, ...TA, ...TB, fur, WHITE, BLACK, NAVY]),
      ...tpls.map(loadTemplateAssets),
      ...tpls.map((T) => proofs.find((p) => p.name === T.product)).filter(Boolean).map(loadProofAssets),
    ]);
    const t0 = performance.now();
    CUR = { mats: A };
    const out = [];
    const tways = swapped ? [["B", TB], ["A", TA]] : [["A", TA], ["B", TB]];
    tpls.forEach((T) => tways.forEach(([cw, m]) => {
      // a solid design has no camo pieces: it is one colour (the first pick), lightest still goes on the back
      const mats = T.slots.length ? m : [m[1] && m[1] !== m[0] ? m[1] : m[0], m[0], m[0], m[0]];
      const flat = renderTemplate(T, mats, { oneColor, logoScale, fur });
      const P = proofs.find((p) => p.name === T.product);
      const canvas = P ? renderProof(P, flat, fur) : flat;
      out.push({ design: `${T.product} · ${T.name}`, product: T.product, cw, mats: T.slots.length ? m : [mats[0]], wide: true, tpl: true, flat, proof: canvas, canvas });
    }));
    if (quick || !tpls.length) {
      const ways = swapped ? [["B", B], ["A", A]] : [["A", A], ["B", B]];
      DESIGNS.forEach((d) => ways.forEach(([cw, m]) => out.push({ design: d.name, cw, mats: m, canvas: renderOne(d, m, { oneColor }) })));
    }
    return { out, ms: performance.now() - t0 };
  }

  /* ----- logo intake + background removal ----- */
  function setLogoSource(img) {
    let w = img.naturalWidth || img.width || 600, h = img.naturalHeight || img.height || 600, k = 1;
    const L = Math.max(w, h);
    if (L > 1400) k = 1400 / L; else if (L < 700) k = 900 / L;
    const c = makeCanvas(Math.round(w * k), Math.round(h * k)), x = c.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height);
    LOGO.src = c; LOGO.history = [];
  }
  function loadBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { setLogoSource(im); URL.revokeObjectURL(url); resolve(); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image. Try right-click → Copy image on Google.")); };
      im.src = url;
    });
  }
  /** Flood-fill the background from the edges. tol = cleanup slider; inside = also clear trapped background. */
  function processLogo(tol, inside) {
    const t0 = performance.now();
    const s = LOGO.src, w = s.width, h = s.height, d = s.getContext("2d").getImageData(0, 0, w, h), p = d.data;
    const border = [];
    let transparentBorder = 0;
    for (let x = 0; x < w; x += 2) border.push((0 * w + x) * 4, ((h - 1) * w + x) * 4);
    for (let y = 0; y < h; y += 2) border.push(y * w * 4, (y * w + w - 1) * 4);
    border.forEach((i) => { if (p[i + 3] < 20) transparentBorder++; });
    if (transparentBorder < border.length * 0.5) {
      const bs = border.filter((i) => p[i + 3] > 200).map((i) => [p[i], p[i + 1], p[i + 2]]);
      const med = (k) => bs.map((b) => b[k]).sort((a, b) => a - b)[bs.length >> 1];
      const bg = [med(0), med(1), med(2)], t2 = tol * tol;
      const dist2 = (i) => { const a = p[i] - bg[0], b = p[i + 1] - bg[1], c = p[i + 2] - bg[2]; return a * a + b * b + c * c; };
      const mask = new Uint8Array(w * h), st = [];
      for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x);
      for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
      while (st.length) {
        const k = st.pop();
        if (mask[k]) continue;
        const i = k * 4;
        if (p[i + 3] > 20 && dist2(i) > t2) continue;
        mask[k] = 1;
        const x = k % w, y = (k / w) | 0;
        if (x > 0) st.push(k - 1); if (x < w - 1) st.push(k + 1); if (y > 0) st.push(k - w); if (y < h - 1) st.push(k + w);
      }
      if (inside) for (let k = 0; k < w * h; k++) if (!mask[k] && dist2(k * 4) < t2 * 0.55) mask[k] = 1;
      for (let k = 0; k < w * h; k++) {
        const i = k * 4;
        if (mask[k]) { p[i + 3] = 0; continue; }
        const x = k % w, y = (k / w) | 0;
        const edge = (x > 0 && mask[k - 1]) || (x < w - 1 && mask[k + 1]) || (y > 0 && mask[k - w]) || (y < h - 1 && mask[k + w]);
        if (edge) {   // un-premultiply the background out of anti-aliased edges
          const dd = Math.sqrt(dist2(i)), a = Math.min(1, Math.max(0.12, (dd - tol) / (tol * 1.4) + 0.2));
          for (let c = 0; c < 3; c++) p[i + c] = Math.max(0, Math.min(255, (p[i + c] - bg[c] * (1 - a)) / a));
          p[i + 3] = Math.round(p[i + 3] * a);
        }
      }
    }
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (p[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) throw new Error("Nothing left after cleanup. Lower the cleanup slider.");
    const tmp = makeCanvas(w, h); tmp.getContext("2d").putImageData(d, 0, 0);
    const pad = 6, out = makeCanvas(x1 - x0 + 1 + pad * 2, y1 - y0 + 1 + pad * 2);
    out.getContext("2d").drawImage(tmp, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    LOGO.base = out; LOGO.canvas = cloneCanvas(out); LOGO.history = [];
    return afterLogo(performance.now() - t0);
  }
  /** Click on leftover background: flood-erase similar colour. Returns false if nothing to erase. */
  function eraseAt(lx, ly, tol) {
    const c = LOGO.canvas, x = c.getContext("2d"), w = c.width, h = c.height;
    const d = x.getImageData(0, 0, w, h), p = d.data, k0 = ly * w + lx, i0 = k0 * 4;
    if (p[i0 + 3] < 10) return null;
    LOGO.history.push(cloneCanvas(c));
    const ref = [p[i0], p[i0 + 1], p[i0 + 2]], t2 = tol * tol, seen = new Uint8Array(w * h), st = [k0];
    while (st.length) {
      const k = st.pop();
      if (seen[k]) continue;
      seen[k] = 1;
      const i = k * 4;
      if (p[i + 3] < 10) continue;
      const a = p[i] - ref[0], b = p[i + 1] - ref[1], cc = p[i + 2] - ref[2];
      if (a * a + b * b + cc * cc > t2) continue;
      p[i + 3] = 0;
      const xx = k % w, yy = (k / w) | 0;
      if (xx > 0) st.push(k - 1); if (xx < w - 1) st.push(k + 1); if (yy > 0) st.push(k - w); if (yy < h - 1) st.push(k + w);
    }
    x.putImageData(d, 0, 0);
    return afterLogo();
  }
  function undoErase() { const h = LOGO.history.pop(); if (!h) return null; LOGO.canvas = h; return afterLogo(); }
  function resetLogo() { if (!LOGO.base) return null; LOGO.canvas = cloneCanvas(LOGO.base); LOGO.history = []; return afterLogo(); }

  /** k-means the logo's colours (ignoring transparent pixels). */
  function logoColors() {
    const c = LOGO.canvas, s = Math.min(1, 140 / Math.max(c.width, c.height));
    const w = Math.max(1, Math.round(c.width * s)), h = Math.max(1, Math.round(c.height * s));
    const t = makeCanvas(w, h), x = t.getContext("2d"); x.drawImage(c, 0, 0, w, h);
    const p = x.getImageData(0, 0, w, h).data, px = [];
    for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 200) px.push([p[i], p[i + 1], p[i + 2]]);
    if (!px.length) return [];
    const K = 6;
    px.sort((a, b) => lum(a) - lum(b));
    let cent = [...Array(K)].map((_, k) => px[Math.floor(((k + 0.5) / K) * px.length)].slice());
    const asg = new Array(px.length);
    for (let it = 0; it < 10; it++) {
      const sum = [...Array(K)].map(() => [0, 0, 0, 0]);
      for (let j = 0; j < px.length; j++) {
        const q = px[j];
        let b = 0, bd = 1e9;
        for (let k = 0; k < K; k++) {
          const cc = cent[k], d = (q[0] - cc[0]) ** 2 + (q[1] - cc[1]) ** 2 + (q[2] - cc[2]) ** 2;
          if (d < bd) { bd = d; b = k; }
        }
        asg[j] = b; sum[b][0] += q[0]; sum[b][1] += q[1]; sum[b][2] += q[2]; sum[b][3]++;
      }
      const prev = cent;
      cent = prev.map((cc, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : cc));
    }
    const cl = cent.map((cc, k) => ({ rgb: cc, n: asg.filter((a) => a === k).length })).filter((cc) => cc.n > 0);
    cl.sort((a, b) => b.n - a.n);
    const merged = [];
    cl.forEach((cc) => { const m = merged.find((q) => dE(q.rgb, cc.rgb) < 14); if (m) m.n += cc.n; else merged.push({ ...cc }); });
    const tot = px.length;
    return merged.filter((cc) => cc.n / tot > 0.03).map((cc) => ({ rgb: cc.rgb, share: cc.n / tot }));
  }
  /** Nearest material by Lab distance (Delta E 1976). */
  function nearest(rgb, pool = SW) {
    return pool.map((s) => ({ s, d: dE(s.rgb, rgb) })).sort((a, b) => a.d - b.d)[0].s;
  }
  function afterLogo(ms) {
    LOGO.colors = logoColors();
    const nonNeutral = LOGO.colors.filter((c) => { const L = toLab(c.rgb)[0]; return L < 92 && L > 8; });
    LOGO.main = (nonNeutral[0] || LOGO.colors[0] || { rgb: [0, 0, 0] }).rgb;
    const ordered = [...LOGO.colors].sort((a, b) => { const wa = toLab(a.rgb)[0] > 90 ? 1 : 0, wb = toLab(b.rgb)[0] > 90 ? 1 : 0; return wa - wb || b.share - a.share; });
    const picks = [];
    ordered.forEach((c) => { const m = nearest(c.rgb); if (!picks.some((p) => dE(p.rgb, m.rgb) < 12) && picks.length < 4) picks.push(m); });
    if (picks.length === 1) picks.push(isLight(picks[0]) ? BLACK : WHITE);
    const suggestions = LOGO.colors.map((c) => ({ from: rgbToHex(c.rgb), share: c.share, material: nearest(c.rgb) }));
    return { canvas: LOGO.canvas, picks, suggestions, ms, canUndo: LOGO.history.length > 0 };
  }

  /* ----- proof sheet ----- */
  function sheet(list, { club, furName, logo = true }) {
    const wide = list.every((o) => o.wide), cols = wide ? 2 : 4, cw = wide ? 740 : 360;
    const ch = Math.round(cw * Math.max(...list.map((o) => o.canvas.height / o.canvas.width))), lab = 46, top = 150, rows = Math.ceil(list.length / cols), pad = 24;
    const c = makeCanvas(cols * cw + pad * (cols + 1), top + rows * (ch + lab + pad) + 70), x = c.getContext("2d");
    x.fillStyle = "#f6f4f0"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#000"; x.fillRect(0, 0, c.width, 110);
    x.fillStyle = "#fff"; x.font = "italic 44px Georgia"; x.fillText("JR & Co.", pad, 68);
    x.font = "15px Segoe UI, Arial"; x.fillStyle = "#bbb"; x.fillText("FULLY CUSTOM HEADCOVERS", pad, 94);
    x.textAlign = "right"; x.fillStyle = "#fff"; x.font = "600 30px Segoe UI, Arial";
    x.fillText(club || "Headcover Concepts", c.width - pad - (logo && LOGO.canvas ? 100 : 0), 66); x.textAlign = "left";
    if (logo && LOGO.canvas) { const r = Math.min(80 / LOGO.canvas.width, 80 / LOGO.canvas.height); x.drawImage(LOGO.canvas, c.width - pad - LOGO.canvas.width * r, 15, LOGO.canvas.width * r, LOGO.canvas.height * r); }
    x.font = "14px Segoe UI, Arial"; x.fillStyle = "#555";
    const mats = [...new Set(list.flatMap((o) => o.mats))].map((m) => `${m.name} (${m.line})`).join("  ·  ");
    x.fillText("Materials: " + mats + (list.some((o) => o.tpl) && furName ? `  ·  Fur: ${furName}` : ""), pad, 136);
    list.forEach((o, i) => {
      const cx = pad + (i % cols) * (cw + pad), cy = top + Math.floor(i / cols) * (ch + lab + pad);
      const r = Math.min(cw / o.canvas.width, ch / o.canvas.height), dw = o.canvas.width * r, dh = o.canvas.height * r;
      x.fillStyle = "#fff"; x.fillRect(cx, cy, cw, ch); x.drawImage(o.canvas, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
      x.fillStyle = "#fff"; x.fillRect(cx, cy + ch, cw, lab);
      x.fillStyle = "#000"; x.font = "600 16px Segoe UI, Arial"; x.fillText(o.design, cx + 12, cy + ch + 29);
      x.fillStyle = "#8a8378"; x.font = "12px Segoe UI, Arial"; x.textAlign = "right"; x.fillText("COLORWAY " + o.cw, cx + cw - 12, cy + ch + 29); x.textAlign = "left";
    });
    x.fillStyle = "#8a8378"; x.font = "13px Segoe UI, Arial";
    x.fillText("jrcogolf.com  ·  Concept renderings. Final colors and embroidery are confirmed at proof.", pad, c.height - 28);
    return c;
  }

  const products = [...new Set(templates.map((T) => T.product))];
  return {
    materials: SW, furs, templates, proofs, products, WHITE, BLACK,
    hasLogo: () => !!LOGO.canvas, logoCanvas: () => LOGO.canvas,
    loadBlob, processLogo, eraseAt, undoErase, resetLogo, nearest, generate, sheet,
    renderTemplate, renderProof,   // exposed for tests / future tools
    roles: (tpl) => (tpl ? ["Back panel", "Camo base", "Camo mid", "Camo top"] : ["Body", "Accent", "Trim", "Extra"]),
  };
}

export const slug = (s) => (s || "club").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "club";
export const canvasToBlob = (canvas) => new Promise((r) => canvas.toBlob(r, "image/png"));
export async function downloadCanvas(canvas, name) {
  const b = await canvasToBlob(canvas), a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
