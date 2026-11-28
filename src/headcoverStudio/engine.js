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

import { oilPaintAsync, OIL_DEFAULT } from "./oilpaint";

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
  // whites were photographed / averaged a little grey and the 3D shading darkens them again: lift them toward true white
  const WHITE_LIFT = 0.35;   // keep 35% of the distance to pure white
  const bright = (s) => (/^white$/i.test(s.name) ? { ...s, hex: rgbToHex(hexToRgb(s.hex).map((v) => 255 - (255 - v) * WHITE_LIFT)), whiteLift: WHITE_LIFT } : s);
  const all = (sw.materials || sw).map(bright).map((s) => ({ ...s, rgb: hexToRgb(s.hex), tileUrl: s.tile ? swDir + s.tile : null, chipUrl: s.chip ? swDir + s.chip : null }));

  // Only the small manifests load up front; each product's images and UV maps load when it's first used.
  const templates = await Promise.all(
    (cat.templates || []).map(async (e) => {
      const dir = base + e.dir;
      const T = await (await fetch(dir + "template.json", { cache: "no-cache" })).json();
      return Object.assign(T, { id: e.id, dir, ready: null });
    })
  );
  // Quilted / Exotic use the product's camo logo spot as the standard: logoFrom points at that template
  templates.forEach((T) => {
    const S = T.logoFrom && templates.find((x) => x.id === T.logoFrom);
    if (S && S.logo) T.logo = { ...S.logo };
  });
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

const CAMO_ASSETS = { tile: null, font: null };
const PATCH_FONTS = { p: null };
function loadTemplateAssets(T) {
  if (T.ready) return T.ready;
  T.ready = (async () => {
    const dir = T.dir;
    T.frameImg = T.frame ? await loadImg(dir + T.frame) : null;
    T.slotImgs = await Promise.all(T.slots.map((s) => loadImg(dir + s.mask)));
    T.furImg = T.fur ? await loadImg(dir + T.fur.mask) : null;
    T.quiltShadeImg = T.quilt ? await loadImg(dir + T.quilt.shade) : null;
    T.stripeMaskImg = T.stripes ? await loadImg(dir + T.stripes.mask) : null;
    T.quiltStitchImg = T.quilt ? await loadImg(dir + T.quilt.stitch) : null;
    if (T.camotext) {   // Camo Text (Oakmont): panel mask, the camo tile and the block letter font
      T.camoMaskImg = await loadImg(dir + T.camotext.mask);
      if (!CAMO_ASSETS.tile) CAMO_ASSETS.tile = loadImg(dir + "../../camotile.png");
      if (!CAMO_ASSETS.font && typeof FontFace !== "undefined") {
        const ff = new FontFace("JRBlock", "url(" + dir + "../../fonts/NFLBearsThrowback.ttf)");   // the block font from the Oakmont file
        CAMO_ASSETS.font = ff.load().then((f) => { document.fonts.add(f); return f; }).catch(() => null);
      }
      T.camoTile = await CAMO_ASSETS.tile; await CAMO_ASSETS.font;
    }
    if (T.patch && typeof FontFace !== "undefined") {   // Circle Patch: engraving fonts
      if (!PATCH_FONTS.p) PATCH_FONTS.p = Promise.all([["PatchSans", "PatchSans.ttf"], ["PatchSerif", "PatchSerif.ttf"]].map(([n, f]) =>
        new FontFace(n, "url(" + dir + "../../fonts/" + f + ")").load().then((ff) => document.fonts.add(ff)).catch(() => null)));
      await PATCH_FONTS.p;
    }
    T.patternImgs = T.pattern ? { all: await loadImg(dir + T.pattern.all), front: await loadImg(dir + T.pattern.front) } : null;
    if (T.paint) {   // painted course: where the painting goes (front panel / every panel) and each area's box
      T.paintImgs = { all: await loadImg(dir + T.paint.all), front: await loadImg(dir + T.paint.front) };
      T.paintBox = {};
      Object.entries(T.paintImgs).forEach(([k, im]) => {
        const c = makeCanvas(T.w, T.h), x = c.getContext("2d"); x.drawImage(im, 0, 0);
        const d = x.getImageData(0, 0, T.w, T.h).data; let x0 = T.w, y0 = T.h, x1 = 0, y1 = 0;
        for (let y = 0; y < T.h; y++) for (let xx = 0; xx < T.w; xx++) if (d[(y * T.w + xx) * 4 + 3] > 128) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        T.paintBox[k] = { x: x0, y: y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1) };
      });
    }
    T.tartanImgs = T.tartan ? await Promise.all(T.tartan.stitches.map((f) => loadImg(dir + f))) : null;
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
// Some swatch photos (dark gator especially) are so flat that the scales vanish once the 3D shading darkens
// them. Stretch the texture around its own average so the pattern reads; the average colour stays the same.
function liftDetail(img) {
  if (!img) return img;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = makeCanvas(w, h), x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, w, h), p = d.data, n = w * h;
  let sum = 0, sq = 0;
  for (let i = 0; i < p.length; i += 4) { const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; sum += l; sq += l * l; }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const k = Math.min(2.2, 18 / Math.max(sd, 1));   // aim for a texture spread of ~18 levels
  if (k <= 1.05) return img;
  const avg = [0, 0, 0];
  for (let i = 0; i < p.length; i += 4) { avg[0] += p[i]; avg[1] += p[i + 1]; avg[2] += p[i + 2]; }
  avg[0] /= n; avg[1] /= n; avg[2] /= n;
  for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) p[i + j] = Math.max(0, Math.min(255, avg[j] + (p[i + j] - avg[j]) * k));
  x.putImageData(d, 0, 0);
  return c;
}

export async function ensureTiles(list) {
  await Promise.all(
    list.filter((m) => m && m.tileUrl && !m.solid && !m.img).map(async (m) => {
      const im = await loadImg(m.tileUrl);
      m.img = m.noLift ? im : liftDetail(im);   // noLift: tile already has its final contrast
      if (m.whiteLift && m.img) {   // textured whites (gator, carbon): same lift toward white as the solid colour
        const c = makeCanvas(m.img.width, m.img.height), x = c.getContext("2d"); x.drawImage(m.img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
        for (let i = 0; i < p.length; i += 4) { p[i] = 255 - (255 - p[i]) * m.whiteLift; p[i + 1] = 255 - (255 - p[i + 1]) * m.whiteLift; p[i + 2] = 255 - (255 - p[i + 2]) * m.whiteLift; }
        x.putImageData(d, 0, 0); m.img = c;
      }
    })
  );
}

/* ---------- studio ---------- */

// Quilt stitching as real thread: a sunken needle channel, then thick dashed stitches in the thread
// colour with a soft highlight, so a light thread reads on dark leather as well as a dark one on light.
function quiltThreadMask(T) {
  if (T._qMask) return T._qMask;
  const w = T.w, h = T.h, m = makeCanvas(w, h), x = m.getContext("2d");
  for (const [dx, dy] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) x.drawImage(T.quiltStitchImg, dx, dy);   // ~2px thread
  const d = makeCanvas(1, 7), dc = d.getContext("2d"); dc.fillStyle = "#000"; dc.fillRect(0, 0, 1, 5);              // 5 on / 2 off
  x.globalCompositeOperation = "destination-in"; x.fillStyle = x.createPattern(d, "repeat"); x.fillRect(0, 0, w, h);
  return (T._qMask = m);
}
function tint(mask, color, w, h) {
  const c = makeCanvas(w, h), x = c.getContext("2d");
  x.drawImage(mask, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, w, h); return c;
}
// More quilting patterns, generated for any template (the PSD only has the diamond): stitch lines in inches, then
// a puffed shade from the same lines (dark in the seams, full in the middle of each pocket)
export const QUILT_PATTERNS = [["diamond", "Diamond"], ["doublediamond", "Double Diamond"], ["curved", "Curved Diamond"], ["viper", "Viper"], ["honeycomb", "Hex"]];
const quiltGen = new Map();
function quiltPaths(x, w, h, ppi, pattern, size, axes) {
  const S = ppi * (size || 1);   // one pocket ~1"
  const line = (pts) => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke(); };
  const curve = (fy) => { const pts = []; for (let xx = -S; xx <= w + S; xx += 3) pts.push([xx, fy(xx)]); line(pts); };
  if (pattern === "doublediamond") {   // every seam stitched twice ~0.12" apart; the diamond inside each pair of seams is
    // the same size as the plain Diamond stitch (1.33" x 1.9" pockets), so the lattice opens up by the gap
    const dw = ppi * 1.333 * (size || 1), dh = ppi * 1.9 * (size || 1), k = dh / dw;
    const gx = (ppi * 0.12 * Math.sqrt(1 + k * k)) / k, P = dw + gx;   // the second seam's horizontal offset
    for (let c = -h / k - P; c < w + h / k + P; c += P) for (const o of [0, gx]) { line([[c + o, 0], [c + o + h / k, h]]); line([[c + o, h], [c + o + h / k, 0]]); }
  }
  if (pattern === "curved") {   // Oakmont: the Diamond stitch with every line bowed, rows dipping toward the panel sides like a dome
    const dw = ppi * 1.333 * (size || 1), dh = ppi * 1.9 * (size || 1), k = dh / dw, ax = axes && axes.length ? axes : [w / 2];
    const bow = (xx) => { let a = ax[0]; ax.forEach((q) => { if (Math.abs(q - xx) < Math.abs(a - xx)) a = q; }); const u = (xx - a) / (ppi * 3); return ppi * 0.7 * u * u; };
    for (let c = -h / k - dw * 2; c < w + h / k + dw * 2; c += dw) for (const sgn of [1, -1]) {
      const pts = []; for (let y = -dh; y <= h + dh; y += 4) { const xx = sgn > 0 ? c + y / k : c + (h - y) / k; pts.push([xx, y + bow(xx)]); } line(pts);
    }
  }
  if (pattern === "viper") {   // Peachtree viper: columns with rungs rising toward each panel's centre line, so the chevrons point up the middle
    const ax = axes && axes.length ? axes : [w / 2], cw = S * 0.85;
    ax.forEach((a, i) => {
      const lo = i ? (ax[i - 1] + a) / 2 : 0, hi = i < ax.length - 1 ? (a + ax[i + 1]) / 2 : w;
      for (let k = Math.floor((lo - a) / cw) - 1; k * cw + a < hi + cw; k++) {
        const x0 = a + k * cw; line([[Math.max(lo, x0), 0], [Math.max(lo, x0), h]]);
        const side = k >= 0 ? 1 : -1;   // right of the centre line: rungs rise to the left, left of it: to the right
        for (let y = -2 * cw; y < h + 2 * cw; y += S * 0.95) line([[x0, y + (side > 0 ? 0 : cw * 0.55)], [x0 + cw, y + (side > 0 ? cw * 0.55 : 0)]]);
      }
    });
  }
  if (pattern === "basket") {   // squares of three short channels, turning 90° square to square
    const B = S * 1.2, n = 3;
    for (let y = 0, r = 0; y < h + B; y += B, r++) for (let xx = 0, c = 0; xx < w + B; xx += B, c++) {
      line([[xx, y], [xx + B, y]]); line([[xx, y], [xx, y + B]]);
      for (let i = 1; i < n; i++) { const t = (B * i) / n; if ((r + c) % 2) line([[xx + t, y], [xx + t, y + B]]); else line([[xx, y + t], [xx + B, y + t]]); }
    }
  }
  if (pattern === "circles") {   // interlocking circles: each pocket a four-petal quatrefoil
    const a = S * 1.1, r = a / Math.SQRT2;
    for (let y = 0; y < h + a; y += a) for (let xx = 0; xx < w + a; xx += a) { x.beginPath(); x.arc(xx, y, r, 0, Math.PI * 2); x.stroke(); }
  }
  if (pattern === "brick") {   // rows of long pockets, each row shifted half a brick
    const bh = S * 0.75, bw = S * 1.6;
    for (let y = 0, r = 0; y < h + bh; y += bh, r++) {
      line([[0, y], [w, y]]);
      for (let xx = (r % 2) * (bw / 2) - bw; xx < w + bw; xx += bw) line([[xx, y], [xx, y + bh]]);
    }
  }
  if (pattern === "wave") for (let y = S * 0.5; y < h + S; y += S) curve((xx) => y + S * 0.22 * Math.sin((xx / (S * 1.6)) * Math.PI * 2));
  if (pattern === "onion") for (let y = 0; y < h + S; y += S) { curve((xx) => y + S * 0.35 * Math.sin((xx / (S * 1.4)) * Math.PI * 2)); curve((xx) => y - S * 0.35 * Math.sin((xx / (S * 1.4)) * Math.PI * 2)); }
  if (pattern === "scallop") {   // fish scales: rows of half-circles, every other row shifted half a scale
    const r = S * 0.5;
    for (let y = 0, row = 0; y < h + S; y += r, row++) for (let xx = (row % 2) * r - 2 * r; xx < w + 2 * r; xx += 2 * r) { x.beginPath(); x.arc(xx, y, r, 0, Math.PI); x.stroke(); }
  }
  if (pattern === "honeycomb") {   // hexagons, pointy sides left and right
    const r = S * 0.55, hw = r * Math.sqrt(3) / 2;
    for (let y = 0, row = 0; y < h + 2 * r; y += r * 1.5, row++) for (let xx = (row % 2) * hw - 2 * hw; xx < w + 2 * hw; xx += 2 * hw) {
      const pts = []; for (let i = 0; i <= 6; i++) { const t = Math.PI / 6 + (i * Math.PI) / 3; pts.push([xx + Math.cos(t) * r, y + Math.sin(t) * r]); } line(pts);
    }
  }
  if (pattern === "channel" || pattern === "box" || pattern === "mountain") for (let y = S * 0.5; y < h; y += S) line([[0, y], [w, y]]);
  if (pattern === "box") for (let xx = S * 0.5; xx < w; xx += S) line([[xx, 0], [xx, h]]);
  if (pattern === "zigzag") for (let y = 0; y < h + S; y += S) { const pts = []; for (let xx = -S, i = 0; xx < w + S; xx += S / 2, i++) pts.push([xx, y + (i % 2 ? S * 0.35 : -S * 0.35)]); line(pts); }
  if (pattern === "chevron") {   // herringbone: columns, each with slanted rungs, the slant flipping column to column
    const cw = S * 1.1;
    for (let xx = 0, c = 0; xx < w + cw; xx += cw, c++) {
      line([[xx, 0], [xx, h]]);
      const d = c % 2 ? 1 : -1;
      for (let y = -cw; y < h + cw; y += S * 0.8) line([[xx, y], [xx + cw, y + d * cw * 0.5]]);
    }
  }
  if (pattern === "mountain") {   // a ridge line inside each band (Wade Hampton mountains)
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = S * 0.5; y < h; y += S) {   // peaks and valleys with a shoulder on each slope, sitting on the band below
      const base = y + S * 0.88, pts = [[-S, base - S * 0.1]]; let xx = -S * 0.6;
      while (xx < w + S) {
        const pw = S * (0.9 + rnd() * 0.8), top = base - S * (0.5 + rnd() * 0.35), sh = 0.35 + rnd() * 0.3;
        pts.push([xx + pw * 0.25, base - (base - top) * sh], [xx + pw * 0.5, top], [xx + pw * 0.72, base - (base - top) * (sh + 0.1)], [xx + pw, base - S * (0.05 + rnd() * 0.12)]);
        xx += pw;
      }
      line(pts);
    }
  }
}
function quiltImages(T, pattern, size) {
  const key = T.id + "|" + pattern + "|" + (size || 1);
  if (quiltGen.has(key)) return quiltGen.get(key);
  const w = T.w, h = T.h, ppi = T.pxPerInch || 60;
  const sh = makeCanvas(w, h), sx = sh.getContext("2d");
  sx.fillStyle = "#fff"; sx.fillRect(0, 0, w, h); sx.lineCap = "round"; sx.lineJoin = "round";
  sx.save(); sx.filter = `blur(${Math.round(ppi * 0.16 * (size || 1))}px)`; sx.strokeStyle = "rgba(0,0,0,.17)"; sx.lineWidth = ppi * 0.3 * (size || 1); quiltPaths(sx, w, h, ppi, pattern, size, T.quiltAxes); sx.restore();
  sx.save(); sx.filter = "blur(1.2px)"; sx.strokeStyle = "rgba(0,0,0,.25)"; sx.lineWidth = 2.5; quiltPaths(sx, w, h, ppi, pattern, size, T.quiltAxes); sx.restore();
  {   // level it like the PSD diamond: pocket middles stay full white, seams no darker than ~210
    const im = sx.getImageData(0, 0, w, h), d = im.data; let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    const k = hi > lo ? 44 / (hi - lo) : 0;
    for (let i = 0; i < d.length; i += 4) { const v = 255 - (hi - d[i]) * k; d[i] = d[i + 1] = d[i + 2] = v; }
    sx.putImageData(im, 0, 0);
  }
  const st = makeCanvas(w, h), tx = st.getContext("2d");
  tx.strokeStyle = "#000"; tx.lineWidth = 1.8; tx.setLineDash([5, 2]); tx.lineJoin = "round"; quiltPaths(tx, w, h, ppi, pattern, size, T.quiltAxes);
  const out = { shade: sh, stitch: st };
  quiltGen.set(key, out);
  return out;
}
function drawQuiltThread(ctx, T, color, gen) {
  const w = T.w, h = T.h, mask = gen ? gen.stitch : quiltThreadMask(T);
  ctx.save(); ctx.filter = "blur(0.8px)"; ctx.globalAlpha = 0.55; ctx.drawImage(tint(gen ? gen.stitch : T.quiltStitchImg, "#000", w, h), 0, 0.6); ctx.restore();   // needle channel
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 1.2; ctx.shadowOffsetY = 0.8; ctx.drawImage(tint(mask, color, w, h), 0, 0); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = "screen"; ctx.drawImage(tint(gen ? gen.stitch : T.quiltStitchImg, "#ffffff", w, h), 0, -0.4); ctx.restore();   // thread sheen
}

// painted course: the customer's clubhouse / course photo, oil-painted in the browser (no Photoshop, no AI),
// printed on the panels with the logo embroidered on top. zoom 1 = the photo just covers the area;
// x / y move it (fraction of the area), rot turns it in 90° steps; look = oil paint settings
export const PAINT_DEFAULT = { area: null, zoom: 1, x: 0, y: 0, rot: 0, look: {} };
export { OIL_DEFAULT };
export const CAMOTEXT_DEFAULT = { text: "", size: 1, spacing: 0.128, camoScale: 1, outlineW: 0.06, seed: 0, wide: 1 };
// Circle Patch: a leather patch zigzag-stitched on, with a smaller laser-engraved leather patch zigzag-stitched on top;
// the club logo in the middle and the club name around it (2 words: top / bottom, 3: two on top, 4: two and two)
export const PATCH_DEFAULT = { text: "", topText: "", bottomText: "", font: "sans", size: 1, textSize: 1, logoSize: 1, ring: 0.18, sep: "none", tracking: 0.04 };
// the name around the logo: 1 word on top; 2 words top / bottom; 3 words two on top, one below; 4 two and two
export function patchLines(name) {
  const w = String(name || "").toUpperCase().trim().split(/\s+/).filter(Boolean);
  if (!w.length) return ["CLUB", ""];
  if (w.length === 1) return [w[0], ""];
  if (w.length === 2) return [w[0], w[1]];
  if (w.length === 3) return [w[0] + " " + w[1], w[2]];
  const k = Math.ceil(w.length / 2);
  return [w.slice(0, k).join(" "), w.slice(k).join(" ")];
}
export const PATTERN_DEFAULT = { size: 1.4, gapX: 0.45, gapY: 0.3, flip: true, front: false, orig: true };   // orig: logo in its own colours (false = one colour)
export function createStudio({ materials, furs, templates, proofs }) {
  const SW = materials;
  const find = (line, name) => SW.find((s) => s.line === line && s.name.toLowerCase() === name.toLowerCase());
  const byLum = [...SW].sort((a, b) => lum(a.rgb) - lum(b.rgb));
  const WHITE = find("Classic Leather", "White") || byLum[byLum.length - 1];
  const BLACK = find("Classic Leather", "Black") || byLum[0];
  const NAVY = find("Classic Leather", "Navy Blue") || BLACK;
  const PATCH_TOP = find("Classic Leather", "Tan") || WHITE;   // the engraved patch: natural leather
  const PATCH_ENGRAVE = "#3a3a3c";   // the laser engraving reads dark grey on every leather colour
  const W = 600, H = 830, CX = 300;
  const SIL_PPI = 60;   // quick-style silhouettes are ~14" tall on a 830 px canvas
  const LOGO = { src: null, canvas: null, base: null, history: [], main: null, colors: [], map: [] };
  let CUR = { mats: [] };
  let CLUB_NAME = "";   // the session's club name: Camo Text spells it unless a design has its own text
  const COURSE = { src: null, cache: new Map() };   // photo (capped at 6000 px) + painted previews by look

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
    if (m.img && m.img.complete !== false && m.img.width) {   // an <img> or a lifted canvas
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
  /* logo colours: a colour map [{from, to}] (hex) moves each of the logo's own colours to a new one.
     The session map applies everywhere; a design can carry its own map (e.g. logo in the leather colour). */
  let ACTIVE = null;
  let STROKE = null, PPI = 60;   // this design's logo outline {color, width in inches} while it is drawn   // {canvas, map} while one design is being drawn
  const recolorCache = new Map();
  function recolor(map) {
    if (!LOGO.canvas || !map || !map.length) return LOGO.canvas;
    const key = LOGO.ver + "|" + map.map((m) => m.from + ">" + m.to).join(",");
    if (recolorCache.has(key)) return recolorCache.get(key);
    const pal = (LOGO.palette || []).map((c) => c.rgb);
    // each map entry moves the palette colour nearest to its "from"
    const delta = pal.map(() => [0, 0, 0]);
    map.forEach((m) => {
      const f = hexToRgb(m.from), t = hexToRgb(m.to); let b = -1, bd = 1e9;
      pal.forEach((q, k) => { const d = dE(q, f); if (d < bd) { bd = d; b = k; } });
      if (b >= 0 && bd < 30) delta[b] = [t[0] - pal[b][0], t[1] - pal[b][1], t[2] - pal[b][2]];
    });
    const src = LOGO.canvas, c = makeCanvas(src.width, src.height), x = c.getContext("2d");
    x.drawImage(src, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data, K = pal.length, s2 = 2 * 26 * 26;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      let ws = 0, dr = 0, dg = 0, db = 0;
      for (let k = 0; k < K; k++) {   // soft assignment keeps the anti-aliased edges between two colours clean
        const q = pal[k], a = p[i] - q[0], b = p[i + 1] - q[1], cc = p[i + 2] - q[2], w = Math.exp(-(a * a + b * b + cc * cc) / s2) + 1e-9;
        ws += w; dr += w * delta[k][0]; dg += w * delta[k][1]; db += w * delta[k][2];
      }
      p[i] += dr / ws; p[i + 1] += dg / ws; p[i + 2] += db / ws;
    }
    x.putImageData(d, 0, 0);
    recolorCache.set(key, c);
    if (recolorCache.size > 24) recolorCache.delete(recolorCache.keys().next().value);
    return c;
  }
  const mergeMaps = (base, own) => {
    const out = (base || []).filter((m) => !(own || []).some((o) => dE(hexToRgb(o.from), hexToRgb(m.from)) < 30));
    return [...out, ...(own || [])];
  };
  const art = () => (ACTIVE ? ACTIVE.canvas : recolor(LOGO.map));
  function logoLayer(w, h, tint) {
    const c = makeCanvas(w, h), x = c.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(art(), 0, 0, w, h);
    if (tint) { x.globalCompositeOperation = "source-in"; x.fillStyle = tint; x.fillRect(0, 0, w, h); }
    return c;   // plain colours: the old diagonal thread texture read as stripes
  }
  /** The logo with an outline of the given colour and width (px) around it; returns {img, pad}. */
  function stroked(img, color, wpx) {
    const pad = Math.ceil(wpx) + 1, c = makeCanvas(img.width + pad * 2, img.height + pad * 2), x = c.getContext("2d");
    const sil = silhouetteOf(img, color), n = Math.max(16, Math.round(wpx * 6));
    for (let a = 0; a < n; a++) { const t = (a / n) * Math.PI * 2; x.drawImage(sil, pad + Math.cos(t) * wpx, pad + Math.sin(t) * wpx); }
    x.drawImage(sil, pad, pad); x.drawImage(img, pad, pad);
    return { img: c, pad };
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
    // opts.rot (degrees) turns the logo upright on panels that sit rotated in the flat layout
    ctx.save(); ctx.translate(cx, cy);
    if (opts.m) ctx.transform(opts.m[0], opts.m[1], opts.m[2], opts.m[3], 0, 0);   // undoes the 3D model's local stretch at this spot
    if (opts.rot) ctx.rotate((opts.rot * Math.PI) / 180);
    const x = -w / 2, y = -h / 2;
    const chosen = (LOGO.map && LOGO.map.length) || (ACTIVE && ACTIVE.map && ACTIVE.map.length);   // colours picked on purpose (e.g. tone-on-tone): no outline
    if (!opts.flat && !chosen && main && dE(main, ground.rgb) < 28) {   // logo would vanish on its ground: outline it
      const o = opts.outline || bestContrast(ground);
      const sil = silhouetteOf(img, o.hex);
      for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; ctx.drawImage(sil, x + Math.cos(t) * 4.5, y + Math.sin(t) * 4.5); }
    }
    let draw = img, dx = x, dy = y;
    if (STROKE && STROKE.width > 0) { const k = stroked(img, STROKE.color, STROKE.width * PPI); draw = k.img; dx = x - k.pad; dy = y - k.pad; }
    if (!opts.flat) { ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 3; ctx.shadowOffsetX = 1.2; ctx.shadowOffsetY = 2.2; }
    ctx.drawImage(draw, dx, dy); ctx.restore();
  }
  // logo pattern (Atlanta Athletic Club / Wade Hampton style): along each row the logo alternates
  // 180°, 0°, 180°, 0°; every other row is shifted by half the spacing; size and spacing in inches, set per design in Edit
  // a filled badge/crest printed in one colour turns into a blob; line marks (monograms) read fine
  function logoFill() {
    const c = LOGO.canvas; if (!c) return 0;
    if (LOGO._fill && LOGO._fill[0] === c) return LOGO._fill[1];
    const s = Math.min(1, 120 / Math.max(c.width, c.height)), k = makeCanvas(Math.max(1, c.width * s), Math.max(1, c.height * s)), x = k.getContext("2d");
    x.drawImage(c, 0, 0, k.width, k.height); const d = x.getImageData(0, 0, k.width, k.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    const f = n / (k.width * k.height); LOGO._fill = [c, f]; return f;
  }
  const patternOrig = (P) => P.orig !== false;
  function drawLogoPattern(ctx, T, P, ppi) {
    const lc = LOGO.canvas, lw = P.size * ppi, lh = (lw * lc.height) / lc.width;
    let img = logoLayer(lw, lh, patternOrig(P) ? null : P.ink);
    if (STROKE && STROKE.width > 0) img = stroked(img, STROKE.color, STROKE.width * ppi).img;
    const cw = lw + P.gapX * ppi, ch = lh + P.gapY * ppi;
    const ax = T.logo ? T.logo.x + T.logo.w / 2 : T.w / 2, ay = T.logo ? T.logo.y + T.logo.h / 2 : T.h / 2;
    const pc = makeCanvas(T.w, T.h), x = pc.getContext("2d"), R = Math.hypot(T.w, T.h);
    x.translate(ax, ay); if (T.logo && T.logo.rot) x.rotate((T.logo.rot * Math.PI) / 180);
    const nr = Math.ceil(R / ch) + 1, nc = Math.ceil(R / cw) + 1;
    for (let j = -nr; j <= nr; j++) {
      const off = (j & 1) * cw / 2;
      for (let i = -nc; i <= nc; i++) {
        x.save(); x.translate(i * cw + off, j * ch); if (P.flip && !(i & 1)) x.rotate(Math.PI);   // 180, 0, 180, 0 along each row
        x.drawImage(img, -lw / 2, -lh / 2); x.restore();
      }
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "destination-in";
    x.drawImage(P.front ? T.patternImgs.front : T.patternImgs.all, 0, 0);
    ctx.drawImage(pc, 0, 0);
  }
  // where the photo sits on the layout: photo units are (aspect x 1); returns the transform pieces
  function paintPlace(T, P) {
    const area = P.area || T.paintArea || "front", box = T.paintBox[area], a = COURSE.src.width / COURSE.src.height;
    const rot = ((((P.rot || 0) + ((T.logo && T.logo.rot) || 0)) % 360) + 360) % 360, side = rot % 180 !== 0;
    const rw = side ? 1 : a, rh = side ? a : 1, fit = Math.max(box.w / rw, box.h / rh) * (P.zoom || 1);
    return { area, box, a, rot, fit, cx: box.x + box.w / 2 + (P.x || 0) * box.w, cy: box.y + box.h / 2 + (P.y || 0) * box.h };
  }
  // src = {img, sx, sy, sw, sh}: img shows that part of the photo (0..1 of its width / height)
  function drawPainting(ctx, T, P, src, k = 1) {
    const g = paintPlace(T, P), pc = makeCanvas(T.w * k, T.h * k), x = pc.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.scale(k, k); x.translate(g.cx, g.cy); x.rotate((g.rot * Math.PI) / 180); x.scale(g.fit, g.fit); x.translate(-g.a / 2, -0.5);
    x.drawImage(src.img, src.sx * g.a, src.sy, src.sw * g.a, src.sh);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "destination-in";
    x.drawImage(T.paintImgs[g.area], 0, 0, T.w * k, T.h * k);
    ctx.drawImage(pc, 0, 0);
  }
  async function paintedCourse(look) {
    const key = JSON.stringify(look || {});
    if (COURSE.cache.has(key)) return COURSE.cache.get(key);
    const s = Math.min(1, 1400 / COURSE.src.width), c = makeCanvas(COURSE.src.width * s, COURSE.src.height * s), x = c.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(COURSE.src, 0, 0, c.width, c.height);
    const job = oilPaintAsync(x.getImageData(0, 0, c.width, c.height), look, c.width / 1100).then((r) => { x.putImageData(new ImageData(r.data, r.width, r.height), 0, 0); return c; });
    COURSE.cache.set(key, job);
    if (COURSE.cache.size > 6) COURSE.cache.delete(COURSE.cache.keys().next().value);   // keep the last few looks
    return job;
  }
  async function setCourse(blob) {
    if (!blob) { COURSE.src = null; COURSE.cache.clear(); return null; }
    const url = URL.createObjectURL(blob), im = await loadImg(url); URL.revokeObjectURL(url);
    if (!im) throw new Error("That file isn't a picture this browser can open.");
    const s = Math.min(1, 6000 / Math.max(im.width, im.height)), c = makeCanvas(im.width * s, im.height * s);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    COURSE.src = c; COURSE.cache.clear(); COURSE.w = im.width; COURSE.h = im.height;
    return { width: im.width, height: im.height };
  }
  /** Print sharpness: how many of the photo's own pixels land on each inch of the painted area. */
  function paintDpi(spec) {
    const T = templates.find((t) => t.id === spec.tpl);
    if (!COURSE.src || !T || !T.paintBox) return null;
    const g = paintPlace(T, { ...PAINT_DEFAULT, ...(spec.paint || {}) });
    return Math.round((COURSE.h * (T.pxPerInch || 60)) / g.fit);
  }
  /** 300 dpi print file of one painted design: background colour + painting + cut lines, no logo
      (the logo is embroidered). The painting is redone at full size so the brush marks stay crisp. */
  async function renderPrint(spec, dpi = 300, onStep) {
    const T = templates.find((t) => t.id === spec.tpl);
    await loadTemplateAssets(T);
    const P = { ...PAINT_DEFAULT, ...(spec.paint || {}) }, ppi = T.pxPerInch || 60, k = dpi / ppi, g = paintPlace(T, P);
    // the part of the photo that can show: the area's box taken back into photo units
    const r = (-g.rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
    [[g.box.x, g.box.y], [g.box.x + g.box.w, g.box.y], [g.box.x, g.box.y + g.box.h], [g.box.x + g.box.w, g.box.y + g.box.h]].forEach(([px, py]) => {
      const dx = px - g.cx, dy = py - g.cy, u = (dx * cs - dy * sn) / g.fit + g.a / 2, v = (dx * sn + dy * cs) / g.fit + 0.5;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    });
    const pad = 0.03;
    u0 = Math.max(0, u0 - pad); v0 = Math.max(0, v0 - pad); u1 = Math.min(g.a, u1 + pad); v1 = Math.min(1, v1 + pad);
    let scale = g.fit * k;   // print px per photo unit
    const cap = 10e6, area = (u1 - u0) * (v1 - v0) * scale * scale;
    if (area > cap) scale *= Math.sqrt(cap / area);   // very large panels: paint at up to 10 MP, then scale up
    const cw = Math.round((u1 - u0) * scale), ch = Math.round((v1 - v0) * scale), crop = makeCanvas(cw, ch), cx = crop.getContext("2d");
    cx.imageSmoothingQuality = "high";
    const H = COURSE.src.height;
    cx.drawImage(COURSE.src, (u0 * H), v0 * H, (u1 - u0) * H, (v1 - v0) * H, 0, 0, cw, ch);
    onStep && onStep(`Painting at ${dpi} dpi (${cw}×${ch})…`);
    const pr = await oilPaintAsync(cx.getImageData(0, 0, cw, ch), P.look, (g.a * scale) / 1100);
    cx.putImageData(new ImageData(pr.data, pr.width, pr.height), 0, 0);
    onStep && onStep("Laying out the print file…");
    const out = makeCanvas(T.w * k, T.h * k), o = out.getContext("2d");
    o.imageSmoothingQuality = "high";
    o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height);
    const bg = makeCanvas(out.width, out.height), b = bg.getContext("2d");   // background colour on every panel
    b.drawImage(T.paintImgs.all, 0, 0, out.width, out.height); b.globalCompositeOperation = "source-in";
    b.fillStyle = spec.roles[0].mat.hex; b.fillRect(0, 0, out.width, out.height); o.drawImage(bg, 0, 0);
    drawPainting(o, T, P, { img: crop, sx: u0 / g.a, sy: v0, sw: (u1 - u0) / g.a, sh: v1 - v0 }, k);
    if (T.frameImg) o.drawImage(T.frameImg, 0, 0, out.width, out.height);
    return out;
  }
  // Camo Text (Oakmont): the club name in tall block letters up the front, filled with camo in the club colours
  const camoCache = new Map();
  // Light Camo print: lightest = background colour, then camo 2, then camo 1
  function camoTileIn(img, colors) {   // labels 0 = ground, 1-3 = blobs -> 3 colours (1 & 3 share colour 1)
    const key = colors.join(",");
    if (camoCache.has(key)) return camoCache.get(key);
    const c = makeCanvas(img.width, img.height), x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data, rgb = colors.map(hexToRgb);
    for (let i = 0; i < p.length; i += 4) { const l = Math.round(p[i] / 80), k = l === 0 ? 2 : l === 1 ? 1 : 0; p[i] = rgb[k][0]; p[i + 1] = rgb[k][1]; p[i + 2] = rgb[k][2]; p[i + 3] = 255; }
    x.putImageData(d, 0, 0); camoCache.set(key, c); return c;
  }
  // set like the OAKMONT layer in the Oakmont file: NFL Bears Throwback at 81% width, gaps 12.8% of the letter height,
  // camo = that file's "Camo Top Layer" art laid over the front panel, outline round the outside of the letters
  // Flag Text: the flag inside the letters, in the word's own frame (x along the word, y across it)
  function fillLetters(x, C, rx, ry, rw, rh, ppi) {
    const pad = rh * 0.15; rx -= pad; ry -= pad; rw += 2 * pad; rh += 2 * pad;
    x.save();
    if (C.fill === "flag") {   // stars and stripes along the word: 13 stripes across the letters, blue canton at the start
      // drawn on its own canvas first: the letters are filled with one "source-in" draw
      const F = makeCanvas(Math.ceil(rw), Math.ceil(rh)), fx = F.getContext("2d"), X = x; fx.translate(-rx, -ry); x = fx;
      const red = C.flagRed || "#a43e4b", white = C.flagWhite || "#edeceb", blue = C.flagBlue || "#323e4b";
      const sy = ry + pad, sh = rh - 2 * pad, st = sh / 13;
      x.fillStyle = white; x.fillRect(rx, ry, rw, rh);
      x.fillStyle = red; for (let i = 0; i < 13; i += 2) x.fillRect(rx, sy + i * st - (i === 0 ? pad : 0), rw, st + (i === 0 ? pad : 0) + (i === 12 ? pad : 0));
      const cw = Math.min(rw * 0.42, sh * 1.25), chh = st * 7 + pad;
      x.fillStyle = blue; x.fillRect(rx, ry, cw + pad, chh);
      x.fillStyle = white; const r = st * 0.32;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) {   // rows of stars
        const px = rx + pad + (i + 0.5 + (j % 2) * 0.5) * (cw / 6.5), py = sy + (j + 0.7) * (st * 7) / 5.6;
        if (px > rx + cw + pad - r) continue;
        x.beginPath(); for (let a = 0; a < 10; a++) { const t = -Math.PI / 2 + (a * Math.PI) / 5, rr = a % 2 ? r * 0.42 : r; x.lineTo(px + Math.cos(t) * rr, py + Math.sin(t) * rr); } x.fill();
      }
      x = X; x.drawImage(F, rx, ry);
    }
    x.restore();
  }
  function drawCamoText(ctx, T, C, ppi) {
    if (T.camotext.spots) { T.camotext.spots.forEach((sp) => drawCamoText(ctx, { ...T, camotext: { ...T.camotext, ...sp, spots: null } }, C, ppi)); return; }   // e.g. blade: one word on each side
    if (T.camotext.taper) return drawCamoTaper(ctx, T, C, ppi);
    const B = T.camotext, txt = String(C.text || CLUB_NAME || "CLUB").toUpperCase().trim() || "CLUB", chars = [...txt];
    const L = makeCanvas(T.w, T.h), x = L.getContext("2d");
    x.translate(B.cx, B.cy); x.rotate(((B.rot || 0) * Math.PI) / 180);
    const fam = "JRBlock, Impact, sans-serif";
    x.font = `100px ${fam}`;
    const cap100 = x.measureText("H").actualBoundingBoxAscent || 80;
    // letters measured by their ink (not advance widths): in the Oakmont file an O is 0.43 x the letter height and the
    // gap between letters is 0.128 x the letter height
    let capPx = B.thick * (C.size || 1), gapK = C.spacing == null ? 0.128 : C.spacing;
    const ink = chars.map((ch) => { const m = x.measureText(ch); return { l: m.actualBoundingBoxLeft || 0, w: (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width) }; });
    const mo = x.measureText("O"), inkO = ((mo.actualBoundingBoxLeft || 0) + (mo.actualBoundingBoxRight || mo.width)) / cap100;   // per unit cap
    let wk = (0.43 / inkO) * (C.wide || 1);
    if (B.fill) {   // stretch the letters along the length so the word runs the whole panel
      const inkSum = ink.reduce((a, b) => a + b.w, 0), cp = capPx;
      wk = Math.max(wk, ((B.len - gapK * cp * (chars.length - 1)) / (inkSum * (cp / cap100))) * Math.min(1, C.wide || 1));
    }
    const lenAt = (cp) => ink.reduce((a, b) => a + b.w, 0) * (cp / cap100) * wk + gapK * cp * (chars.length - 1);
    if (lenAt(capPx) > B.len) capPx *= B.len / lenAt(capPx);   // long names: smaller letters
    const fs = capPx * (100 / cap100); x.font = `${fs}px ${fam}`;
    const kf = (fs / 100) * wk, widths = ink.map((m) => m.w * kf), gap = gapK * capPx, total = lenAt(capPx), px = -total / 2;
    const glyph = (c, q, stroke, i) => { x.save(); x.translate(q + ink[i].l * kf, capPx / 2); x.scale(wk, 1); if (stroke) x.strokeText(c, 0, 0); else x.fillText(c, 0, 0); x.restore(); };
    const each = (stroke) => { let q = px; chars.forEach((c, i) => { glyph(c, q, stroke, i); q += widths[i] + gap; }); };
    x.fillStyle = "#000"; each(false);
    x.globalCompositeOperation = "source-in";
    if (C.fill && C.fill !== "camo") fillLetters(x, C, -total / 2, -capPx / 2, total, capPx, ppi);   // Flag Text: the flag inside the letters, laid along the word
    else {
    const tile = camoTileIn(T.camoTile, C.colors), seed = C.seed || 0, [cx0, cy0, cw, ch] = B.camo || [0, 0, T.w, T.h];
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    x.translate(cx0 + cw / 2, cy0 + ch / 2); if (seed & 1) x.scale(-1, 1); if (seed & 2) x.scale(1, -1);
    const k = C.camoScale || 1;
    if (B.camoRot) { x.rotate(Math.PI / 2); x.drawImage(tile, (-ch / 2) * k, (-cw / 2) * k, ch * k, cw * k); }   // wide panels: the camo art turned to fit
    else x.drawImage(tile, (-cw / 2) * k, (-ch / 2) * k, cw * k, ch * k);
    x.restore();
    }
    // outline outside the letters, in the outline colour
    x.globalCompositeOperation = "destination-over";
    x.lineJoin = "miter"; x.lineWidth = (2 * Math.max(0.6, ppi * (C.outlineW == null ? 0.06 : C.outlineW))) / wk; x.strokeStyle = C.outline;
    each(true);
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (T.camoMaskImg) { x.globalCompositeOperation = "destination-in"; x.drawImage(T.camoMaskImg, 0, 0); }
    ctx.drawImage(L, 0, 0);
  }
  // tapered panels (blade / mid mallet top): the letters grow with the panel from the narrow tip to the wide end,
  // each letter keeping its shape, and the word is stretched to run the whole length of the top
  function drawCamoTaper(ctx, T, C, ppi) {
    const B = T.camotext, [t0, t1] = B.taper, half = B.len / 2;
    const txt = String(C.text || CLUB_NAME || "CLUB").toUpperCase().trim() || "CLUB", chars = [...txt];
    const L = makeCanvas(T.w, T.h), x = L.getContext("2d");
    x.translate(B.cx, B.cy); x.rotate(((B.rot || 0) * Math.PI) / 180);
    const fam = "JRBlock, Impact, sans-serif";
    x.font = `100px ${fam}`;
    const cap100 = x.measureText("H").actualBoundingBoxAscent || 80, gapK = C.spacing == null ? 0.128 : C.spacing;
    const ink = chars.map((ch) => { const m = x.measureText(ch); return { l: m.actualBoundingBoxLeft || 0, w: (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width) }; });
    const mo = x.measureText("O"), wk0 = 0.43 / (((mo.actualBoundingBoxLeft || 0) + (mo.actualBoundingBoxRight || mo.width)) / cap100);
    const tAt = (s) => t0 + ((t1 - t0) * Math.min(B.len, Math.max(0, s + half))) / B.len;
    const lay = (sig, lam) => {   // returns glyph caps/positions and the end point
      let p = -half; const G = [];
      chars.forEach((c, i) => {
        const u = (ink[i].w / cap100) * wk0 * sig; let cp = lam * tAt(p);
        for (let k = 0; k < 4; k++) cp = lam * tAt(p + (cp * u) / 2);
        G.push({ c, i, p, cp }); p += cp * u + (i < chars.length - 1 ? gapK * cp : 0);
      });
      return { G, end: p };
    };
    let sig = 1, lam = C.size || 1, R = lay(sig, lam);
    if (B.fill || R.end > half) {
      let lo = 0.6, hi = 3;
      for (let k = 0; k < 30; k++) { sig = (lo + hi) / 2; if (lay(sig, lam).end > half) hi = sig; else lo = sig; }
      sig = lo;
      if (sig <= 0.61) { let a = 0.1, z = lam; for (let k = 0; k < 30; k++) { lam = (a + z) / 2; if (lay(sig, lam).end > half) z = lam; else a = lam; } lam = a; }
      R = lay(sig, lam);
    }
    const off = (half - R.end) / 2;   // centre what is left over
    const wk = wk0 * sig * (C.wide || 1);
    const each = (stroke) => R.G.forEach((g) => {
      const fs = g.cp * (100 / cap100), kf = (fs / 100) * wk;
      x.save(); x.font = `${fs}px ${fam}`; x.translate(g.p + off + ink[g.i].l * kf, g.cp / 2); x.scale(wk, 1);
      if (stroke) x.strokeText(g.c, 0, 0); else x.fillText(g.c, 0, 0); x.restore();
    });
    x.fillStyle = "#000"; each(false);
    x.globalCompositeOperation = "source-in";
    const tile = camoTileIn(T.camoTile, C.colors), seed = C.seed || 0, k = C.camoScale || 1, big = Math.max(t0, t1) * 1.3;
    x.save(); x.rotate((-(B.rot || 0) * Math.PI) / 180);   // camo stays upright on the flat, like the other panels
    if (seed & 1) x.scale(-1, 1); if (seed & 2) x.scale(1, -1);
    const vert = Math.abs(Math.sin(((B.rot || 0) * Math.PI) / 180)) > 0.7, cw = vert ? big : B.len * 1.1, ch = vert ? B.len * 1.1 : big;
    x.drawImage(tile, (-cw / 2) * k, (-ch / 2) * k, cw * k, ch * k); x.restore();
    x.globalCompositeOperation = "destination-over";
    x.lineJoin = "miter"; x.lineWidth = (2 * Math.max(0.6, ppi * (C.outlineW == null ? 0.06 : C.outlineW))) / wk; x.strokeStyle = C.outline;
    each(true);
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (T.camoMaskImg) { x.globalCompositeOperation = "destination-in"; x.drawImage(T.camoMaskImg, 0, 0); }
    ctx.drawImage(L, 0, 0);
  }
  /* ----- Circle Patch ----- */
  // laser engraving burns the dark parts of the art: near-white areas of the logo stay unburnt
  const engraveCache = new Map();
  function engraveArt(src) {
    if (engraveCache.has(src)) return engraveCache.get(src);
    const c = makeCanvas(src.width, src.height), x = c.getContext("2d"); x.drawImage(src, 0, 0);
    const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const keep = L > 0.86 ? 0 : L > 0.78 ? (0.86 - L) / 0.08 : 1;
      d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = d[i + 3] * keep;
    }
    x.putImageData(im, 0, 0);
    engraveCache.clear(); engraveCache.set(src, c);
    return c;
  }
  function zigzagRing(x, cx, cy, rIn, rOut, per) {
    const rm = (rIn + rOut) / 2, n = Math.max(12, Math.round((2 * Math.PI * rm) / (per / 2)) & ~1);
    x.beginPath();
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, r = i % 2 ? rOut : rIn; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
  }
  function stitchRing(ctx, cx, cy, r, ppi, thread) {   // zigzag over the patch edge: mostly on the patch, just over the edge
    const amp = ppi * 0.075, per = ppi * 0.085, lw = Math.max(1, ppi * 0.024);
    ctx.save(); ctx.lineJoin = "miter";
    zigzagRing(ctx, cx + 0.5, cy + 0.9, r - amp, r + ppi * 0.015, per); ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = lw * 1.5; ctx.stroke();
    zigzagRing(ctx, cx, cy, r - amp, r + ppi * 0.015, per); ctx.strokeStyle = thread; ctx.lineWidth = lw; ctx.stroke();
    ctx.restore();
    return amp;
  }
  // curved tops (blade, mid mallet): the 3D model stretches one side more than the other there, so the patch is
  // pre-warped with a measured grid (flat point -> where it lands in the top view) to read as a true circle
  function warpPatch(L, B) {
    const W = B.warp, h = W.half, n = W.n, st = W.step, x0 = Math.round(B.cx - h), y0 = Math.round(B.cy - h), sz = 2 * h;
    const src = L.getContext("2d").getImageData(x0, y0, sz, sz), sd = src.data, out = new ImageData(sz, sz), od = out.data;
    const at = (i, j, k) => W.pts[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))][k];
    for (let py = 0; py < sz; py++) for (let px = 0; px < sz; px++) {
      const gx = px / st, gy = py / st, i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
      const q = (k) => (at(i, j, k) * (1 - fx) + at(i + 1, j, k) * fx) * (1 - fy) + (at(i, j + 1, k) * (1 - fx) + at(i + 1, j + 1, k) * fx) * fy;
      const sx = h + q(0), sy = h + q(1);
      if (sx < 0 || sy < 0 || sx >= sz - 1 || sy >= sz - 1) continue;
      const ix = sx | 0, iy = sy | 0, ax = sx - ix, ay = sy - iy, o = (py * sz + px) * 4;
      for (let c = 0; c < 4; c++) {
        const a = sd[(iy * sz + ix) * 4 + c], b = sd[(iy * sz + ix + 1) * 4 + c], d = sd[((iy + 1) * sz + ix) * 4 + c], e = sd[((iy + 1) * sz + ix + 1) * 4 + c];
        od[o + c] = (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
      }
    }
    const C = makeCanvas(L.width, L.height); C.getContext("2d").putImageData(out, x0, y0);
    return C;
  }
  function drawPatch(ctx, T, P, ppi) {
    const B = T.patch, R = B.r * (P.size || 1), cx = B.cx, cy = B.cy;
    const L = makeCanvas(T.w, T.h), x = L.getContext("2d");
    x.translate(cx, cy); if (B.rot) x.rotate((B.rot * Math.PI) / 180); x.scale(B.sx || 1, B.sy || 1); if (B.m) x.transform(B.m[0], B.m[1], B.m[2], B.m[3], 0, 0); x.translate(-cx, -cy);   // sx/sy and m undo the 3D model's stretch there, so the patch reads round
    const disc = (r, mat, sh) => {
      const c = new Path2D(); c.arc(cx, cy, r, 0, Math.PI * 2);
      x.save(); x.shadowColor = "rgba(0,0,0,.5)"; x.shadowBlur = sh; x.shadowOffsetX = sh * 0.3; x.shadowOffsetY = sh * 0.6;
      x.fillStyle = matStyle(x, mat, ppi); x.fill(c); x.restore();
      x.save(); x.clip(c); x.fillStyle = grain(x); x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.05);   // a little leather sheen, darker at the edge
      g.addColorStop(0, "rgba(255,255,255,.07)"); g.addColorStop(0.75, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.16)");
      x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); x.restore();
    };
    // bottom patch, zigzag-stitched on
    disc(R, P.bottom, Math.max(2, ppi * 0.05));
    // zigzag in a thread close to the patch's own leather (a touch darker so the stitch still reads)
    const near = (m) => rgbToHex(m.rgb.map((v) => v * (lum(m.rgb) > 0.3 ? 0.86 : 0.78)));
    stitchRing(x, cx, cy, R, ppi, P.thread || near(P.bottom));
    // top patch (engraved), zigzag-stitched on
    const R2 = R * (1 - (P.ring == null ? 0.18 : P.ring));
    disc(R2, P.top, Math.max(1.5, ppi * 0.035));
    const zw = ppi * 0.075;
    // engraving: name around the logo
    const E = makeCanvas(T.w, T.h), e = E.getContext("2d");
    const fam = P.font === "serif" ? "PatchSerif, Georgia, serif" : P.font === "block" ? "JRBlock, Impact, sans-serif" : "PatchSans, 'Arial Narrow', sans-serif";
    e.font = `100px ${fam}`;
    const cap100 = e.measureText("H").actualBoundingBoxAscent || 72;
    const ro = R2 * 0.83;                    // outer edge of the lettering (Peachtree: 0.82 of the engraved patch)
    const capBase = R2 * 0.23 * (P.textSize || 1);   // Peachtree: letters ~0.23 of the engraved patch radius
    const auto = patchLines(P.text || CLUB_NAME);
    const typed = P.topText || P.bottomText;   // typed lines win over the automatic split
    const top = typed ? String(P.topText || "").toUpperCase().trim() : auto[0];
    const bot = typed ? String(P.bottomText || "").toUpperCase().trim() : auto[1];
    const track = P.tracking == null ? 0.04 : P.tracking;
    const arcOf = (txt, cp) => {   // angle a line takes on the circle at this letter height
      const fs = (cp * 100) / cap100; e.font = `${fs}px ${fam}`;
      const ws = [...txt].map((ch) => e.measureText(ch).width), tr = cp * track;
      const w = ws.reduce((a, b) => a + b, 0) + tr * Math.max(0, ws.length - 1);
      return { fs, ws, tr, ang: w / (ro - cp / 2) };
    };
    const maxTop = bot ? (150 * Math.PI) / 180 : (220 * Math.PI) / 180, maxBot = (130 * Math.PI) / 180;
    let cp = capBase; const t0 = top ? arcOf(top, cp) : null, b0 = bot ? arcOf(bot, cp) : null;
    const k = Math.min(1, t0 ? maxTop / t0.ang : 1, b0 ? maxBot / b0.ang : 1);
    cp = capBase * Math.max(0.55, k);
    const lay = (txt, upper) => {
      if (!txt) return;
      const A = arcOf(txt, cp), rb = upper ? ro - cp : ro, rmid = ro - cp / 2;
      let a = upper ? -Math.PI / 2 - A.ang / 2 : Math.PI / 2 + A.ang / 2;
      e.font = `${A.fs}px ${fam}`; e.textAlign = "center"; e.textBaseline = "alphabetic";
      [...txt].forEach((ch, i) => {
        const da = (A.ws[i] + (i < A.ws.length - 1 ? A.tr : 0)) / rmid, ac = upper ? a + A.ws[i] / rmid / 2 : a - A.ws[i] / rmid / 2;
        e.save(); e.translate(cx + Math.cos(ac) * rb, cy + Math.sin(ac) * rb); e.rotate(upper ? ac + Math.PI / 2 : ac - Math.PI / 2);
        e.fillText(ch, 0, 0); e.restore();
        a += upper ? da : -da;
      });
      return A.ang;
    };
    e.fillStyle = "#000";
    lay(top, true); lay(bot, false);
    if (top && bot && P.sep && P.sep !== "none") {   // small marks between the two lines
      const rm = ro - cp / 2, d = cp * 0.13;
      [0, Math.PI].forEach((a) => {
        const px = cx + Math.cos(a) * rm, py = cy + Math.sin(a) * rm;
        e.beginPath();
        if (P.sep === "star") { for (let i = 0; i < 10; i++) { const t = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? d * 0.95 : d * 2.3; e.lineTo(px + Math.cos(t) * rr, py + Math.sin(t) * rr); } e.closePath(); }
        else e.arc(px, py, d * 1.25, 0, Math.PI * 2);
        e.fill();
      });
    }
    // logo in the middle
    const rl = ro - capBase - R2 * 0.05;
    if (LOGO.canvas && rl > 4) {
      const src = engraveArt(art()), box = rl * 2 * 0.95 * (P.logoSize || 1), sc = Math.min(box / src.width, box / src.height);
      const lw = src.width * sc, lh = src.height * sc;
      e.drawImage(src, cx - lw / 2, cy - lh / 2, lw, lh);
    }
    // engraving colour: burnt into the leather (multiplied so the grain still shows), with a soft darker edge
    e.globalCompositeOperation = "source-in"; e.fillStyle = P.engrave; e.fillRect(0, 0, T.w, T.h);
    x.save(); x.globalAlpha = 0.35; x.filter = "blur(0.8px)"; x.drawImage(E, 0, 0); x.restore();
    x.save(); x.globalAlpha = 0.93; x.drawImage(E, 0, 0); x.restore();
    stitchRing(x, cx, cy, R2, ppi, P.thread2 || near(P.top));
    ctx.drawImage(B.warp ? warpPatch(L, B) : L, 0, 0);
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
          const k = makeCanvas(LOGO.canvas.width * r, LOGO.canvas.height * r); k.getContext("2d").drawImage(art(), 0, 0, k.width, k.height);
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
    T.slotImgs.forEach((im, i) => { if (im) maskFill(ctx, T, im, matStyle(ctx, mats[(i + 1) % mats.length], ppi), !T.printed); });   // printed camo: no raised edges
    if (T.patternImgs && opts.pattern && LOGO.canvas) drawLogoPattern(ctx, T, opts.pattern, ppi);
    if (T.camotext && opts.camotext && T.camoTile) drawCamoText(ctx, T, opts.camotext, ppi);
    if (T.paintImgs && opts.paint && opts.paint.img) drawPainting(ctx, T, opts.paint, { img: opts.paint.img, sx: 0, sy: 0, sw: 1, sh: 1 });
    if (T.stripeMaskImg && opts.stripes) {   // Silver Britches-style stripes through the logo spot, zigzag-stitched
      const S = T.stripes, c = makeCanvas(T.w, T.h), x = c.getContext("2d"), L = T.w + T.h;
      const total = S.widths.reduce((a, b) => a + b, 0);
      x.save(); x.translate(S.cx, S.cy); x.rotate(((S.angle || 0) * Math.PI) / 180);
      let off = -total / 2;
      const amp = ppi * 0.09, per = ppi * 0.15;   // zigzag ~0.18" wide, 0.15" repeat
      x.lineWidth = Math.max(1.2, ppi * 0.035); x.lineJoin = "miter";
      S.widths.forEach((w, i) => {
        const m = opts.stripes[i % opts.stripes.length];
        x.fillStyle = matStyle(x, m, ppi); x.fillRect(off, -L, w, 2 * L);
        // each stripe is zigzag-stitched along both edges in a slightly darker shade of its own colour
        const [r, g, b] = m.rgb, k = isLight(m) ? 0.91 : 0.82;   // same colour, a shade darker
        x.strokeStyle = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
        [off + amp * 1.1, off + w - amp * 1.1].forEach((e) => {
          x.beginPath();
          for (let y = -L, j = 0; y <= L; y += per / 2, j++) { const xx = e + (j % 2 ? amp : -amp); if (j === 0) x.moveTo(xx, y); else x.lineTo(xx, y); }
          x.stroke();
        });
        off += w;
      });
      x.restore();
      x.globalCompositeOperation = "destination-in"; x.drawImage(T.stripeMaskImg, 0, 0);
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1; ctx.drawImage(c, 0, 0); ctx.restore();
    }
    if (T.quiltShadeImg && !opts.pinstripe) {   // quilted: puffed pockets (multiply), then the stitching in the thread colour
      const q = opts.quilt || {}, gen = q.pattern && q.pattern !== "diamond" ? quiltImages(T, q.pattern, q.size) : null;
      const shade = gen ? gen.shade : T.quiltShadeImg;
      ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.drawImage(shade, 0, 0); ctx.drawImage(shade, 0, 0); ctx.restore();
      if (gen || T.quiltStitchImg) drawQuiltThread(ctx, T, opts.thread || "#f2efe8", gen);
    }
    if (opts.pinstripe) {   // Pinstripe (River Club): thin printed lines down the whole cover
      const P = opts.pinstripe, gap = ppi * (P.gap || 0.4), lw = Math.max(1, ppi * (P.width || 0.025));
      // zones: panels laid out turned in the flat (blade / mid mallet sides) get their stripes turned to match
      if (T.pinFan) {   // blade / mid mallet: the middle stripe straight up the flat, the others fanning out from a point above
        // so the outermost ones run parallel to the flat's slanted sides
        const F = T.pinFan, vx = F.cx, vy = F.vy, ry = F.ry || T.h / 2, d = ry - vy, dt = gap / d, L = (T.w + T.h) * 3;
        ctx.save(); ctx.strokeStyle = P.color; ctx.lineWidth = lw;
        const n = Math.ceil(Math.atan2(T.w, d) / dt) + 2;
        for (let i = -n; i <= n; i++) { const t = i * dt; ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx + Math.sin(t) * L, vy + Math.cos(t) * L); ctx.stroke(); }
        ctx.restore();
      }
      const zones = T.pinFan ? [] : T.pinZones || [{ box: [0, 0, T.w, T.h], angle: 0 }];
      zones.forEach((z) => {
        const pts = z.poly || [[z.box[0], z.box[1]], [z.box[2], z.box[1]], [z.box[2], z.box[3]], [z.box[0], z.box[3]]];
        const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length, L = T.w + T.h;
        ctx.save(); ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.clip();
        if (z.angle) { ctx.translate(cx, cy); ctx.rotate((z.angle * Math.PI) / 180); }   // straight zones keep one phase so the stripes line up across them
        ctx.fillStyle = P.color;
        for (let xx = -L + gap / 2; xx < L; xx += gap) ctx.fillRect(xx - lw / 2, -L, lw, 2 * L);
        ctx.restore();
      });
    }
    if (T.tartanImgs && opts.tartan) {   // tartan: straight stitch lines, one thread colour per layer
      T.tartanImgs.forEach((im, i) => {
        const c = makeCanvas(T.w, T.h), x = c.getContext("2d");
        x.drawImage(im, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = opts.tartan[i % opts.tartan.length]; x.fillRect(0, 0, T.w, T.h);
        ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 1; ctx.shadowOffsetY = 0.7; ctx.drawImage(c, 0, 0); ctx.restore();
      });
    }
    if (T.frameImg) ctx.drawImage(T.frameImg, 0, 0);
    if (T.furImg && opts.fur) maskFill(ctx, T, T.furImg, matStyle(ctx, opts.fur, ppi), true);
    if (T.patch && opts.patch) drawPatch(ctx, T, opts.patch, ppi);
    if (T.scatter && LOGO.canvas) {   // scattered logo print (Farmington style): one colour, each mark turned
      const k = Math.min(opts.logoScale || 1, 1.15);   // the size slider can't push marks into each other
      T.scatter.forEach((m) => drawLogo(ctx, m.x, m.y, m.w * k, m.w * k, mats[0], { tint: opts.scatterTint, rot: m.rot, flat: true }));
    }
    if (T.logo && LOGO.canvas && !T.patternImgs && !opts.noLogo && !T.patch) {
      const s = opts.logoScale, g = T.logoGround >= 0 ? mats[(T.logoGround + 1) % mats.length] : mats[0];
      const c = { body: mats[0], accent: mats[1], trim: mats[2], extra: mats[3] };
      // T.logos: more than one logo spot (painted blade: one on each side; painted mallet: on the tab, upside down)
      (T.logos || [T.logo]).forEach((L) =>
        drawLogo(ctx, L.x + L.w / 2, L.y + L.h / 2, L.w * s, L.h * s, g, { tint: opts.oneColor ? pickThread({ ...c, body: g }) : null, rot: L.rot || 0, m: L.m }));
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
        // whites / near-whites: soften the grey shading by half so white reads white, not light grey (colours unchanged)
        const mn = Math.min(fd[j], fd[j + 1], fd[j + 2]), kw = mn > 170 ? Math.min(1, (mn - 170) / 70) * 0.5 : 0;
        const s0 = b[i * 4] + (255 - b[i * 4]) * kw, s1 = b[i * 4 + 1] + (255 - b[i * 4 + 1]) * kw, s2 = b[i * 4 + 2] + (255 - b[i * 4 + 2]) * kw;
        o[i * 4] = (s0 * fd[j]) / 255; o[i * 4 + 1] = (s1 * fd[j + 1]) / 255; o[i * 4 + 2] = (s2 * fd[j + 2]) / 255; o[i * 4 + 3] = a;
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

  /* ----- Quilted / Exotic colourways ----- */
  // the exotic closest in colour to m (m itself if it already is one); `avoid` keeps colourway B different from A
  // the Exotic cover is built from plain Gator Leather; split-tone, rustic or ostrich only by choosing it in Edit
  function exoticFor(m, avoid) {
    if (m && m.line === "Gator Leather") return m;
    const pool = SW.filter((x) => x.line === "Gator Leather" && x !== avoid && !x.hidden);
    return pool.reduce((b, x) => (dE(x.rgb, m.rgb) < dE(b.rgb, m.rgb) ? x : b), pool[0]);
  }
  const isSmooth = (m) => m && m.solid && m.kind !== "fur";
  function smoothFor(m) {
    if (isSmooth(m)) return m;
    const pool = SW.filter((x) => x.line === "Classic Leather" && !x.hidden);
    return pool.reduce((b, x) => (dE(x.rgb, m.rgb) < dE(b.rgb, m.rgb) ? x : b), pool[0]);
  }
  // flag: Sedgefield's off-white flag in the nearest smooth leathers (one colourway)
  function nearestSmooth(hex) {
    const rgb = hexToRgb(hex), pool = SW.filter((x) => isSmooth(x) && !x.hidden);
    return pool.reduce((b, x) => (dE(x.rgb, rgb) < dE(b.rgb, rgb) ? x : b), pool[0]);
  }
  function flagWays() {
    const navy = nearestSmooth("#323e4b"), red = nearestSmooth("#a43e4b"), white = nearestSmooth("#edeceb");
    return { A: { back: navy, blue: navy, red, white } };
  }
  // stripes: A = main pick body with the other picks as the three stripes; B = the second pick as body
  function stripeWays(picks) {
    const a = (picks.length ? picks : [NAVY, WHITE]).map(smoothFor);
    const fill = (list, body) => {
      const out = list.filter((m) => m !== body);
      for (const extra of [WHITE, BLACK, NAVY]) if (out.length < 3 && !out.includes(extra) && extra !== body) out.push(extra);
      return [out[0], out[1], out[2]];
    };
    const way = (body) => {
      const stripes = fill(a, body);
      return { body, stripes };
    };
    return { A: way(a[0]), B: way(a[1] || (isLight(a[0]) ? NAVY : WHITE)) };
  }
  // scatter: smooth body in the lightest pick with marks in the darkest, and the reverse
  function scatterWays(picks) {
    const a = (picks.length ? picks : [NAVY, WHITE]).map(smoothFor);
    const light = a.reduce((b, m) => (lum(m.rgb) > lum(b.rgb) ? m : b)), dark = a.reduce((b, m) => (lum(m.rgb) < lum(b.rgb) ? m : b));
    const L = dE(light.rgb, dark.rgb) > 40 ? light : WHITE, D = dE(light.rgb, dark.rgb) > 40 ? dark : (isLight(light) ? NAVY : dark);
    return { A: { body: L, ink: D }, B: { body: D, ink: L } };
  }
  // tartan: a solid (usually the darkest pick) with three thread colours stitched in a sett
  function tartanWays(picks) {
    const a = (picks.length ? picks : [NAVY, WHITE]).map(smoothFor);
    const byDark = [...a].sort((x, y) => lum(x.rgb) - lum(y.rgb));
    const way = (body) => {
      const cr = (m) => { const p = lum(m.rgb), q = lum(body.rgb); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
      const shows = (m) => m && dE(m.rgb, body.rgb) > 25 && cr(m) > 1.9;   // a thread has to read against the leather
      const rest = a.filter((m) => m !== body && shows(m)).sort((x, y) => cr(y) - cr(x));   // boldest first = the bold line
      const pool = [...rest, WHITE, bestContrast(body), isLight(body) ? NAVY : WHITE].filter((m, i, l) => shows(m) && l.indexOf(m) === i);
      return { body, threads: [pool[0], pool[1] || pool[0], pool[2] || pool[0]] };
    };
    return { A: way(byDark[0]), B: byDark[1] && lum(byDark[1].rgb) < 0.3 ? way(byDark[1]) : null };   // B only when a second dark pick exists
  }
  // colourway k (0 = A, 1 = B): main material, a contrasting thread, and the exotic body
  function designWay(picks, k) {
    const a = picks.length ? picks : [NAVY, WHITE];
    const pick = a[k % a.length] || a[0];
    const main = smoothFor(pick);   // quilting goes on smooth leather, never on an exotic
    const others = a.filter((x) => x !== pick);
    const thread = others.find((x) => dE(x.rgb, main.rgb) > 40) || bestContrast(main);
    const bodyA = exoticFor(a[0]);
    const body = k === 0 ? bodyA : exoticFor(a[1] || a[0], a[1] ? null : bodyA);
    return { main, thread, body };
  }

  /** Render everything. Returns [{design, cw, mats, tpl, wide, flat, proof, canvas}]. */
  /* ----- designs as editable specs: plan() picks the materials, renderSpec() draws one ----- */
  // A spec is plain data: the template, the colourway, and one material per named role. Editing a design
  // just swaps a role's material and re-renders that one card, so sessions can be saved and reopened.
  const KIND_ROLES = {
    camo: (T) => ["Back panel", ...T.slots.map((x, i) => `Camo ${i + 1}`)],
    solid: () => ["Body"],
    quilted: () => ["Leather", "Quilt thread"],
    pinstripe: () => ["Leather", "Pinstripe"],
    exotic: () => ["Exotic"],
    stripes: () => ["Body", "Stripe 1", "Stripe 2", "Stripe 3"],
    tartan: () => ["Leather", "Thread 1", "Thread 2", "Thread 3"],
    flag: () => ["Navy", "Red", "White"],
    scatter: () => ["Body", "Marks"],
    pattern: () => ["Background", "Logo colour"],
    painted: () => ["Back / sides"],
    camotext: () => ["Background", "Camo 1", "Camo 2", "Letter outline"],
    patch: () => ["Body", "Bottom patch", "Top patch"],
    flagtext: () => ["Background", "Letter outline"],
    stockcamo: (T) => ["Back panel", ...(T.stockNames || T.slots.map((x, i) => `Camo ${i + 1}`))],
  };
  // stock designs (Duck Camo, Light Camo) come in their own printed colours; these colours aren't in the
  // material picker, but sessions can still find them by id
  const STOCK = new Map();
  const stockMat = (hex, name) => {
    const id = "stock-" + hex.replace("#", "");
    if (!STOCK.has(id)) STOCK.set(id, { id, name: name || hex, line: "Printed colour", hex, rgb: hexToRgb(hex), solid: true });
    return STOCK.get(id);
  };
  templates.forEach((T) => (T.stock || []).forEach((h, i) => stockMat(h, `${T.name} ${(T.stockNames || [])[i] || i + 1}`)));
  const kindOf = (T) => T.design || (T.slots.length ? "camo" : "solid");
  function permute(picks, v) {   // the v-th ordering of the picks (v = 0 keeps them as chosen)
    const a = picks.slice(), n = a.length, f = [1];
    for (let i = 1; i <= n; i++) f[i] = f[i - 1] * i;
    let k = n ? v % f[n] : 0; const out = [];
    for (let i = n; i > 0; i--) { const q = Math.floor(k / f[i - 1]); k %= f[i - 1]; out.push(a.splice(q, 1)[0]); }
    return out;
  }
  async function plan({ slots, swapped, products, variant = 0 }) {
    const picks0 = slots.filter(Boolean);
    if (!picks0.length) return [];
    const picks = permute(picks0, variant), sl = [...picks, null, null, null, null].slice(0, 4);
    const [TA, TB] = templateWays(sl);
    const tpls = templates.filter((T) => !products || products.includes(T.product));
    const special = { A: designWay(picks, 0), B: designWay(picks, 1), scatter: scatterWays(picks), stripes: stripeWays(picks), flag: flagWays(), tartan: tartanWays(picks) };
    const tways = swapped ? [["B", TB], ["A", TA]] : [["A", TA], ["B", TB]];
    // Pinstripe (River Club) rides on the quilted layouts (and the exotic one for the alignment stick):
    // A light leather with dark pinstripes, B the reverse; every product but the barrel and valuables pouch
    const pushPin = (T, cw) => {
      const ws = special.scatter.A, body = cw === "A" ? ws.body : ws.ink, line = cw === "A" ? ws.ink : ws.body;
      specs.push({ tpl: T.id, product: T.product, name: "Pinstripe", design: `${T.product} · Pinstripe`, cw, kind: "pinstripe",
        roles: [{ label: "Leather", mat: body }, { label: "Pinstripe", mat: line }], pinstripe: { gap: 0.4, width: 0.025 } });
    };
    const specs = [];
    tpls.forEach((T) => tways.forEach(([cw, m]) => {
      const kind = kindOf(T);
      if (kind === "scatter") return;   // parked
      if (kind === "painted" && !COURSE.src) return;   // needs a course photo
      if ((kind === "flag" || kind === "stockcamo" || kind === "painted" || kind === "camotext") && cw === "B") return;   // painted course: dark back only (back colour can still be changed in Edit)   // the flag has one colourway: classic red, white and navy
      if (kind === "tartan" && !special.tartan[cw]) return;
      let r;
      if (kind === "quilted") {
        r = [special[cw].main, special[cw].thread];
        pushPin(T, cw);
      }
      else if (kind === "exotic") { r = [special[cw].body]; if (T.product === "Alignment Stick Cover") pushPin(T, cw); }   // alignment stick has no quilted layout
      else if (kind === "stripes") r = [special.stripes[cw].body, ...special.stripes[cw].stripes];
      else if (kind === "tartan") r = [special.tartan[cw].body, ...special.tartan[cw].threads];
      else if (kind === "flag") r = [special.flag[cw].blue, special.flag[cw].red, special.flag[cw].white];
      else if (kind === "pattern") r = [special.scatter[cw].body, special.scatter[cw].ink];
      else if (kind === "camotext") {   // camo is printed: use the logo's own colours exactly (Oakmont: logo green + gold)
        const w = special.scatter.A, lp = (LOGO.palette || []).filter((c) => { const l = toLab(c.rgb)[0]; return l < 92 && l > 6; }).sort((a, b) => b.share - a.share);
        const pm = (i, fb) => (lp[i] ? stockMat(lp[i].hex, `Logo colour ${i + 1}`) : fb);
        const others = picks.map(smoothFor).filter((m) => dE(m.rgb, w.body.rgb) > 25 && dE(m.rgb, w.ink.rgb) > 25);
        let c1 = pm(0, w.ink), c2 = pm(1, others[0] || bestContrast(w.ink));
        if (lum(c2.rgb) < lum(c1.rgb)) { const t = c1; c1 = c2; c2 = t; }   // the darker logo colour leads and outlines (Oakmont: green)
        r = [w.body, c1, c2, c1];
      }
      else if (kind === "patch") {   // A: dark body (Peachtree navy), B: light body; ring in a club colour; tan top patch, engraved
        const w = special.scatter.A, body = cw === "A" ? w.ink : w.body;
        const lp = (LOGO.palette || []).filter((c) => { const l = toLab(c.rgb)[0]; return l < 90 && l > 8; }).sort((a, b) => b.share - a.share).map((c) => nearestSmooth(c.hex));
        const ringPool = [...picks.map(smoothFor), ...lp].filter((m) => dE(m.rgb, body.rgb) > 25);
        const ring = ringPool.find((m) => dE(m.rgb, PATCH_TOP.rgb) > 25) || (isLight(body) ? NAVY : WHITE);
        r = [body, ring, PATCH_TOP];
      }
      else if (kind === "painted") r = [cw === "A" ? special.scatter.A.ink : special.scatter.A.body];   // A dark back (Wade Hampton), B light
      else if (kind === "stockcamo") { const st = T.stock.map((h, i) => stockMat(h, `${T.name} ${(T.stockNames || [])[i] || i + 1}`)); r = [st[0], ...st]; }
      else if (kind === "camo") r = [m[0], ...T.slots.map((x, i) => m[(i + 1) % m.length])];
      else r = [m[1] && m[1] !== m[0] ? m[1] : m[0]];
      const roles = KIND_ROLES[kind](T);
      if (kind === "camotext") {   // Flag Text: the same word layout filled with the stars and stripes
        const w = special.scatter.A, extra = [];
        const fl = special.flag.A; extra.push(["flagtext", "Flag Text", [w.body, fl.blue], "flag"]);
        extra.forEach(([k, nm, rr, fill]) => specs.push({ tpl: T.id, product: T.product, name: nm, design: `${T.product} · ${nm}`, cw, kind: k,
          roles: KIND_ROLES[k](T).map((label, i) => ({ label, mat: rr[i] || rr[0] })), camotext: { ...CAMOTEXT_DEFAULT, fill } }));
      }
      specs.push({ tpl: T.id, product: T.product, name: T.name, design: `${T.product} · ${T.name}`, cw, kind,
        roles: roles.map((label, i) => ({ label, mat: r[i] || r[0] })), ...(kind === "pattern" ? { pattern: { ...PATTERN_DEFAULT } } : {}), ...(kind === "painted" ? { paint: { ...PAINT_DEFAULT } } : {}), ...(kind === "camotext" ? { camotext: { ...CAMOTEXT_DEFAULT } } : {}), ...(kind === "patch" ? { patch: { ...PATCH_DEFAULT } } : {}) });
    }));
    return specs;
  }
  async function renderSpec(spec, { oneColor, logoScale, fur }) {
    const T = templates.find((t) => t.id === spec.tpl);
    if (!T) return null;
    const P = proofs.find((p) => p.name === T.product);
    const r = spec.roles.map((x) => x.mat);
    await Promise.all([ensureTiles([...r, fur, WHITE, BLACK, NAVY]), loadTemplateAssets(T), P ? loadProofAssets(P) : null]);
    CUR = { mats: r };
    let mats, thread = null, stripes = null, tartan = null, pattern = null, paint = null, camotext = null, patch = null, quilt = null, pinstripe = null;
    switch (spec.kind) {
      case "quilted": mats = [r[0], r[0], r[0], r[0]]; thread = r[1].hex; quilt = { pattern: "diamond", size: 1, ...(spec.quilt || {}) }; break;
      case "pinstripe": mats = [r[0], r[0], r[0], r[0]]; pinstripe = { gap: 0.4, width: 0.025, ...(spec.pinstripe || {}), color: r[1].hex }; break;
      case "exotic": mats = [r[0], r[0], r[0], r[0]]; break;
      case "stripes": mats = [r[0], r[0], r[0], r[0]]; stripes = r.slice(1); break;
      case "tartan": mats = [r[0], r[0], r[0], r[0]]; tartan = r.slice(1).map((m) => m.hex); break;
      case "flag": mats = [r[0], r[2], r[1], r[0], r[2]]; break;   // [back, field, red stripes, canton, stars]
      case "camo": mats = r.length >= 4 ? r : [...r, ...r].slice(0, 4); break;
      case "stockcamo": mats = r; break;
      case "flagtext": {
        mats = [r[0], r[0], r[0], r[0]];
        const C = { ...CAMOTEXT_DEFAULT, ...(spec.camotext || {}) };
        C.fill = "flag";
        C.outline = r[r.length - 1].hex; C.colors = [r[0].hex, r[0].hex, r[0].hex];
        camotext = C; break;
      }
      case "patch": mats = [r[0], r[0], r[0], r[0]]; patch = { ...PATCH_DEFAULT, ...(spec.patch || {}), bottom: r[1], top: r[2], engrave: PATCH_ENGRAVE }; break;
      case "camotext": mats = [r[0], r[0], r[0], r[0]]; camotext = { ...CAMOTEXT_DEFAULT, ...(spec.camotext || {}), colors: [r[1].hex, r[2].hex, r[0].hex], outline: r[3].hex }; break;
      case "painted": mats = [r[0], r[0], r[0], r[0]];
        if (COURSE.src) { const P = { ...PAINT_DEFAULT, ...(spec.paint || {}) }; paint = { ...P, img: await paintedCourse(P.look) }; }
        break;
      case "pattern": mats = [r[0], r[0], r[0], r[0]]; pattern = { ...PATTERN_DEFAULT, ...(spec.pattern || {}), ink: r[1].hex }; break;
      default: mats = [r[0], r[0], r[0], r[0]];
    }
    const own = spec.logoColors && spec.logoColors.length ? spec.logoColors : null;
    const map = own ? mergeMaps(LOGO.map, own) : null;
    ACTIVE = map ? { map, canvas: recolor(map) } : null;
    STROKE = spec.logoStroke && spec.logoStroke.width > 0 ? spec.logoStroke : null; PPI = T.pxPerInch || 60;
    let flat;
    try { flat = renderTemplate(T, mats, { oneColor: oneColor && !own, logoScale, fur, thread, stripes, tartan, pattern, paint, camotext, patch, quilt, pinstripe }); }
    finally { ACTIVE = null; STROKE = null; }
    const canvas = P ? renderProof(P, flat, fur) : flat;
    return { flat, canvas, proof: canvas };
  }
  const allMats = () => [...SW, ...furs, ...STOCK.values()];
  const matById = (id) => allMats().find((m) => m.id === id) || null;

  async function generate({ slots, swapped, oneColor, logoScale, fur, quick, products }) {
    if (!LOGO.canvas || !slots.some(Boolean)) return { out: [], ms: 0 };
    const t0 = performance.now();
    const specs = await plan({ slots, swapped, products });
    const out = [];
    for (const sp of specs) {
      const r = await renderSpec(sp, { oneColor, logoScale, fur });
      if (r) out.push({ ...sp, mats: sp.roles.map((x) => x.mat), wide: true, tpl: true, spec: sp, ...r });
    }
    if (quick || !templates.length) {
      const A = expand(slots), B = [A[1], A[0], A[3], A[2]];
      const ways = swapped ? [["B", B], ["A", A]] : [["A", A], ["B", B]];
      DESIGNS.forEach((d) => ways.forEach(([cw, m]) => out.push({ design: d.name, cw, mats: m, canvas: renderOne(d, m, { oneColor }) })));
    }
    return { out, ms: performance.now() - t0 };
  }
  /** Restore a saved (already cleaned) logo without running the background cleanup again. */
  async function restoreLogo(blob) {
    await loadBlob(blob);
    LOGO.base = cloneCanvas(LOGO.src); LOGO.canvas = cloneCanvas(LOGO.src); LOGO.history = []; LOGO.orig = cloneCanvas(LOGO.src);
    return afterLogo(0, true);
  }

  /* ----- logo intake + background removal ----- */
  function setLogoSource(img) {
    let w = img.naturalWidth || img.width || 600, h = img.naturalHeight || img.height || 600, k = 1;
    const L = Math.max(w, h);
    if (L > 1400) k = 1400 / L; else if (L < 700) k = 900 / L;
    const c = makeCanvas(Math.round(w * k), Math.round(h * k)), x = c.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height);
    LOGO.src = c; LOGO.history = []; LOGO.map = [];   // a new logo starts in its own colours
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
    // the untouched photo under the logo, for the restore brush
    const orig = makeCanvas(out.width, out.height); orig.getContext("2d").drawImage(s, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    LOGO.orig = orig;
    return afterLogo(performance.now() - t0, true);
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
  /* eraser / restore brush: start a stroke, paint, end it (one undo step per stroke) */
  function brushStart() { if (LOGO.canvas) LOGO.history.push(cloneCanvas(LOGO.canvas)); }
  function brushAt(lx, ly, r, restore) {
    const c = LOGO.canvas; if (!c) return;
    const x = c.getContext("2d"), g = x.createRadialGradient(lx, ly, r * 0.6, lx, ly, r);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    if (!restore) { x.save(); x.globalCompositeOperation = "destination-out"; x.fillStyle = g; x.beginPath(); x.arc(lx, ly, r, 0, Math.PI * 2); x.fill(); x.restore(); return; }
    if (!LOGO.orig) return;
    const t = makeCanvas(r * 2 + 2, r * 2 + 2), tx = t.getContext("2d"), ox = Math.floor(lx - r - 1), oy = Math.floor(ly - r - 1);
    tx.drawImage(LOGO.orig, -ox, -oy); tx.globalCompositeOperation = "destination-in";
    const g2 = tx.createRadialGradient(lx - ox, ly - oy, r * 0.6, lx - ox, ly - oy, r); g2.addColorStop(0, "rgba(0,0,0,1)"); g2.addColorStop(1, "rgba(0,0,0,0)");
    tx.fillStyle = g2; tx.fillRect(0, 0, t.width, t.height);
    x.drawImage(t, ox, oy);
  }
  function brushEnd() { return afterLogo(); }
  /** For the Edit logo pop-up: take a copy on open, put it back on Cancel. */
  const logoSnapshot = () => (LOGO.canvas ? { canvas: cloneCanvas(LOGO.canvas), history: LOGO.history.slice(), map: (LOGO.map || []).slice(), base: LOGO.base, orig: LOGO.orig, palette: LOGO.palette } : null);
  /** After editing: crop to what's left of the logo (+ a little room), so sizing uses the logo, not the old box. */
  function trimLogo() {
    const c = LOGO.canvas; if (!c) return null;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return afterLogo();
    const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
    if (x0 === 0 && y0 === 0 && x1 === c.width - 1 && y1 === c.height - 1) return afterLogo();
    const crop = (src) => { if (!src) return src; const k = makeCanvas(x1 - x0 + 1, y1 - y0 + 1); k.getContext("2d").drawImage(src, -x0, -y0); return k; };
    LOGO.canvas = crop(LOGO.canvas); LOGO.orig = crop(LOGO.orig); LOGO.base = crop(LOGO.base); LOGO.history = [];
    return afterLogo();
  }
  function logoRestore(sn) { if (!sn) return null; Object.assign(LOGO, { canvas: sn.canvas, history: sn.history, map: sn.map, base: sn.base, orig: sn.orig, palette: sn.palette }); return afterLogo(); }
  function setLogoColors(map) { LOGO.map = map || []; return afterLogo(); }
  /** The logo drawn with a given colour map (for previews and swatch pickers). */
  const logoWith = (map) => recolor(map);
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
  function afterLogo(ms, fresh) {
    LOGO.ver = (LOGO.ver || 0) + 1;
    LOGO.colors = logoColors();
    if (fresh || !LOGO.palette) LOGO.palette = LOGO.colors.map((c) => ({ rgb: c.rgb, hex: rgbToHex(c.rgb.map(Math.round)), share: c.share }));   // stays put while erasing, so colour picks keep pointing at the same colour
    const nonNeutral = LOGO.colors.filter((c) => { const L = toLab(c.rgb)[0]; return L < 92 && L > 8; });
    LOGO.main = (nonNeutral[0] || LOGO.colors[0] || { rgb: [0, 0, 0] }).rgb;
    const ordered = [...LOGO.colors].sort((a, b) => { const wa = toLab(a.rgb)[0] > 90 ? 1 : 0, wb = toLab(b.rgb)[0] > 90 ? 1 : 0; return wa - wb || b.share - a.share; });
    const picks = [];
    ordered.forEach((c) => { const m = nearest(c.rgb); if (!picks.some((p) => dE(p.rgb, m.rgb) < 12) && picks.length < 4) picks.push(m); });
    if (picks.length === 1) picks.push(isLight(picks[0]) ? BLACK : WHITE);
    const suggestions = LOGO.colors.map((c) => ({ from: rgbToHex(c.rgb), share: c.share, material: nearest(c.rgb) }));
    return { canvas: recolor(LOGO.map), picks, suggestions, ms, canUndo: LOGO.history.length > 0, palette: LOGO.palette, map: LOGO.map || [] };
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
    if (logo && LOGO.canvas) { const r = Math.min(80 / LOGO.canvas.width, 80 / LOGO.canvas.height); x.drawImage(art(), c.width - pad - LOGO.canvas.width * r, 15, LOGO.canvas.width * r, LOGO.canvas.height * r); }
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
    patternOwnColours: () => logoFill() > 0.45,
    /** The material the logo sits on in this design (what "Match leather" matches). */
    logoGroundMat: (spec) => {
      const T = templates.find((t) => t.id === spec.tpl), r = spec.roles.map((x) => x.mat);
      if (T && T.logoGround >= 0 && (spec.kind === "camo" || spec.kind === "stockcamo")) return r[(T.logoGround + 1) % r.length] || r[0];
      return r[0];
    },
    setClubName: (n) => { CLUB_NAME = n || ""; },
    setCourse, hasCourse: () => !!COURSE.src, courseCanvas: () => COURSE.src, paintDpi, renderPrint,
    materials: SW, furs, templates, proofs, products, WHITE, BLACK,
    hasLogo: () => !!LOGO.canvas, logoCanvas: () => LOGO.canvas, logoPalette: () => LOGO.palette || [], logoMap: () => LOGO.map || [],
    brushStart, brushAt, brushEnd, setLogoColors, logoWith, mergeMaps, logoSnapshot, logoRestore, trimLogo,
    loadBlob, processLogo, eraseAt, undoErase, resetLogo, nearest, generate, sheet,
    plan, renderSpec, restoreLogo, matById,
    renderTemplate, renderProof,   // exposed for tests / future tools
    roles: (tpl) => (tpl ? ["Back panel", "Camo base", "Camo mid", "Camo top"] : ["Body", "Accent", "Trim", "Extra"]),
  };
}

export const slug = (s) => (s || "club").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "club";
export const canvasToBlob = (canvas) => new Promise((r) => canvas.toBlob(r, "image/png"));
/** PNG with its print resolution written in (pHYs), so Photoshop / the RIP opens it at the right size. */
export async function pngWithDpi(blob, dpi) {
  const b = new Uint8Array(await blob.arrayBuffer()), ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  let c = ~0;
  for (let i = 4; i < 17; i++) { c ^= chunk[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  dv.setUint32(17, ~c >>> 0);
  const at = 8 + 25;   // signature + IHDR
  return new Blob([b.slice(0, at), chunk, b.slice(at)], { type: "image/png" });
}
export async function downloadBlob(b, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export async function downloadCanvas(canvas, name) {
  const b = await canvasToBlob(canvas), a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
