/* Oil-paint filter in the spirit of Photoshop's Filter › Stylize › Oil Paint, run entirely in the browser.
   Steps: edge-following stroke direction (structure tensor) -> colour smeared along the strokes (line integral
   convolution) -> bristle streaks -> paint ridges lit from one side with a little shine.
   opts (all 0..10 like Photoshop): stylization (stroke length), cleanliness (how smooth inside a stroke),
   scale (brush width), bristle (bristle detail), shine; angle in degrees for the light. */

// Everything lives inside makeOil() so the same code can be handed to a Web Worker as text (a 300 dpi print
// takes ~20-40 s and must not freeze the page). Keep it free of spread / destructuring / for-of so the build
// doesn't pull in helpers from outside the function.
function makeOil() {
  const OIL_DEFAULT = { stylization: 3, cleanliness: 3, scale: 5, bristle: 4, shine: 2, angle: -60, detail: 7, vivid: 5, rim: 3, relief: 3 };
  
  function gauss1d(sigma) {
    const r = Math.max(1, Math.ceil(sigma * 2.5)), k = new Float32Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    return k;
  }
  function blur(src, w, h, sigma) {
    if (sigma <= 0.05) return src.slice();
    const k = gauss1d(sigma), r = (k.length - 1) >> 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) { const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i; s += src[o + xx] * k[i + r]; }
        tmp[o + x] = s;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) { const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i; s += tmp[yy * w + x] * k[i + r]; }
        out[y * w + x] = s;
      }
    }
    return out;
  }
  
  /** imgData: ImageData (or {data,width,height}); returns a new ImageData-shaped object. px scales the brush to
      the image size: pass the image's pixels-per-inch over 60 so a print file and a preview get the same strokes. */
  function oilPaint(img, opts = {}, px = 1) {
    const o = Object.assign({}, OIL_DEFAULT, opts);
    const w = img.width, h = img.height, n = w * h, d = img.data;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = d[j]; G[i] = d[j + 1]; B[i] = d[j + 2]; }
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const sp = (3 + o.scale * 1.1) * px;                 // dab spacing (brush width)
    // big working buffers live inside blocks so a 300 dpi print doesn't hold them all at once
    const dir_ = (() => {
    const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.3 * R[i] + 0.59 * G[i] + 0.11 * B[i];
  
    // 1. stroke direction: smoothed structure tensor, strokes run along edges
    const Ls = blur(L, w, h, 0.8 * px);
    const Jxx = new Float32Array(n), Jxy = new Float32Array(n), Jyy = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (Ls[i - w + 1] + 2 * Ls[i + 1] + Ls[i + w + 1] - Ls[i - w - 1] - 2 * Ls[i - 1] - Ls[i + w - 1]) / 8;
      const gy = (Ls[i + w - 1] + 2 * Ls[i + w] + Ls[i + w + 1] - Ls[i - w - 1] - 2 * Ls[i - w] - Ls[i - w + 1]) / 8;
      Jxx[i] = gx * gx; Jxy[i] = gx * gy; Jyy[i] = gy * gy;
    }
    const ts = (1.5 + o.scale * 0.9) * px;
    const A = blur(Jxx, w, h, ts), Bt = blur(Jxy, w, h, ts), C = blur(Jyy, w, h, ts);
    // detail mask: busy areas (windows, roof lines, branches) keep their shape; flat areas get the paint
    const D = new Float32Array(n);
    { let mx = 0; for (let i = 0; i < n; i++) { const t = Math.sqrt(A[i] + C[i]); D[i] = t; if (t > mx) mx = t; }
      const lo = mx * 0.10, hi = mx * 0.45; for (let i = 0; i < n; i++) { const u = Math.min(1, Math.max(0, (D[i] - lo) / (hi - lo))); D[i] = u * u * (3 - 2 * u); } }
    // stroke direction: follow edges where the photo has a clear edge; in open sky / grass / water use a slowly
    // turning random direction so dabs criss-cross like knife work instead of lining up into long streaks
    const cell = sp * 4, gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const gc = new Float32Array(gw * gh), gs = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) { const t = rnd() * Math.PI * 2; gc[i] = Math.cos(t); gs[i] = Math.sin(t); }   // doubled angle
    const ang2 = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = A[i], b = Bt[i], c = C[i];
      const tr = a + c, df = Math.sqrt((a - c) * (a - c) + 4 * b * b), coh = tr > 1e-6 ? df / tr : 0;
      // edge direction (doubled angle of the along-edge vector = -(gradient doubled angle))
      const ex = -(a - c) / (df || 1), ey = -(2 * b) / (df || 1);
      const gx = x / cell, gy = y / cell, x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, k = y0 * gw + x0;
      const fxs = fx * fx * (3 - 2 * fx), fys = fy * fy * (3 - 2 * fy);
      const rx = (gc[k] * (1 - fxs) + gc[k + 1] * fxs) * (1 - fys) + (gc[k + gw] * (1 - fxs) + gc[k + gw + 1] * fxs) * fys;
      const ry = (gs[k] * (1 - fxs) + gs[k + 1] * fxs) * (1 - fys) + (gs[k + gw] * (1 - fxs) + gs[k + gw + 1] * fxs) * fys;
      const e = Math.min(1, D[i] * 1.6) * Math.min(1, coh * 1.5);
      ang2[i] = Math.atan2(ey * e + ry * (1 - e) * 0.8, ex * e + rx * (1 - e) * 0.8);
    }
    return [D, ang2];
    })();
    const D = dir_[0], ang2 = dir_[1];
  
    // 2. paint with short dabs: each dab picks up the colour under its centre and is laid down as a flat,
    //    slightly rounded knife/brush mark. Overlapping edges leave the ridges the light catches.
    const paint_ = (() => {
    const pre = (0.6 + o.cleanliness * 0.35) * px;
    const Rp = blur(R, w, h, pre), Gp = blur(G, w, h, pre), Bp = blur(B, w, h, pre);
    const Rf = blur(R, w, h, 0.7 * px), Gf = blur(G, w, h, 0.7 * px), Bf = blur(B, w, h, 0.7 * px);
    const Rc = Rp.slice(), Gc = Gp.slice(), Bc = Bp.slice(), H = new Float32Array(n).fill(0.5);
    const fine = blur((() => { const a = new Float32Array(4096); for (let i = 0; i < 4096; i++) a[i] = rnd() - 0.5; return a; })(), 4096, 1, 0.8);
    let fsd = 0; for (let i = 0; i < 4096; i++) fsd += fine[i] * fine[i]; fsd = Math.sqrt(fsd / 4096) || 1;
    const bristle = 0.08 + o.bristle * 0.05;
    const dabPass = (spacing, lenK, srcR, srcG, srcB, keep) => {
      const pts = [];
      for (let y = -spacing; y < h + spacing; y += spacing * 0.8) for (let x = -spacing; x < w + spacing; x += spacing * 0.8) {
        const cx = x + (rnd() - 0.5) * spacing, cy = y + (rnd() - 0.5) * spacing;
        const ci = Math.min(h - 1, Math.max(0, cy | 0)) * w + Math.min(w - 1, Math.max(0, cx | 0));
        if (keep && rnd() > keep(ci)) continue;
        pts.push([cx, cy, ci, rnd()]);
      }
      for (let k = pts.length - 1; k > 0; k--) { const j = (rnd() * (k + 1)) | 0; const t = pts[k]; pts[k] = pts[j]; pts[j] = t; }
      for (let q = 0; q < pts.length; q++) {
        const cx = pts[q][0], cy = pts[q][1], ci = pts[q][2], rv = pts[q][3];
        const th = ang2[ci] / 2 + (rv - 0.5) * 0.35, ux = Math.cos(th), uy = Math.sin(th);
        const hl = spacing * lenK * (0.75 + rv * 0.5) / 2, hw = spacing * (0.55 + rv * 0.25);
        const lit = 1 + (rnd() - 0.5) * 0.06;
        const cr = srcR[ci] * lit, cg = srcG[ci] * lit, cb = srcB[ci] * lit;
        const off = (rnd() * 4000) | 0, tilt = (rnd() - 0.5) * 0.5;
        const ext = Math.ceil(hl + hw + 2);
        const x0 = Math.max(0, (cx - ext) | 0), x1 = Math.min(w - 1, (cx + ext) | 0), y0 = Math.max(0, (cy - ext) | 0), y1 = Math.min(h - 1, (cy + ext) | 0);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy, u = (dx * ux + dy * uy) / hl, v = (-dx * uy + dy * ux) / hw;
          const dd = Math.pow(u * u * u * u + v * v * v * v, 0.25);
          if (dd >= 1) continue;
          const al = Math.min(1, (1 - dd) * Math.min(hl, hw) / (1.2 * px));
          const i = y * w + x;
          Rc[i] += (cr - Rc[i]) * al; Gc[i] += (cg - Gc[i]) * al; Bc[i] += (cb - Bc[i]) * al;
          // flat top, paint pushed up at the rim, fine bristle lines running along the dab, slight tilt
          const rim = dd > 0.72 ? (dd - 0.72) / 0.28 : 0;
          const ht = 0.55 + o.rim * 0.03 * rim * (1 - rim) * 4 + u * tilt * 0.25 + (fine[(off + ((v * hw / px * 1.6) | 0) + 4096) % 4096] / fsd) * bristle * 0.25;
          H[i] += (ht - H[i]) * al;
        }
      }
    };
    dabPass(sp, 1.6 + o.stylization * 0.35, Rp, Gp, Bp, null);
    dabPass(sp * 0.45, 1.5 + o.stylization * 0.2, Rf, Gf, Bf, (ci) => (D[ci] - 0.25) * 1.6);   // smaller dabs in busy areas
    return [Rc, Gc, Bc, H];
    })();
    const Rc = paint_[0], Gc = paint_[1], Bc = paint_[2], H = paint_[3];
  
    // put the photo's own detail back where it's busy, so buildings and trees stay crisp
    const kd = o.detail / 12, Ro = Rc, Go = Gc, Bo = Bc;
    const Rs = blur(R, w, h, 0.5 * px), Gs = blur(G, w, h, 0.5 * px), Bs = blur(B, w, h, 0.5 * px);   // (R,G,B not needed after this)
    const vib = 1 + o.vivid * 0.05;
    for (let i = 0; i < n; i++) {
      const k = D[i] * kd;
      let r = Rc[i] * (1 - k) + Rs[i] * k, g = Gc[i] * (1 - k) + Gs[i] * k, b = Bc[i] * (1 - k) + Bs[i] * k;
      const m = (r + g + b) / 3; r = m + (r - m) * vib; g = m + (g - m) * vib; b = m + (b - m) * vib;
      Ro[i] = r; Go[i] = g; Bo[i] = b;
      H[i] = H[i] * (1 - 0.6 * k);
    }
  
    // 4. light the relief from one side, with a little shine
    const ang = (o.angle * Math.PI) / 180, lx = Math.cos(ang), ly = Math.sin(ang), lz = 0.9;
    const ln = Math.hypot(lx, ly, lz), Lx = lx / ln, Ly = ly / ln, Lz = lz / ln;
    const relief = (1 + o.relief * 0.5) / px, shine = o.shine / 10;
    const out = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const hx = (H[x < w - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) * relief, hy = (H[y < h - 1 ? i + w : i] - H[y > 0 ? i - w : i]) * relief;
      const nm = Math.hypot(hx, hy, 1), nx = -hx / nm, ny = -hy / nm, nz = 1 / nm;
      const diff = nx * Lx + ny * Ly + nz * Lz;
      const shade = 1 + 0.55 * (diff - Lz);   // averages out to the original brightness
      const hz = nz + Lz, hn = Math.hypot(nx + Lx, ny + Ly, hz), spec = Math.pow(Math.max(0, hz / hn), 40) * shine * 120;
      const j = i * 4;
      out[j] = Ro[i] * shade + spec; out[j + 1] = Go[i] * shade + spec; out[j + 2] = Bo[i] * shade + spec; out[j + 3] = 255;
    }
    return { data: out, width: w, height: h };
  }
  return { OIL_DEFAULT: OIL_DEFAULT, oilPaint: oilPaint };
}
const OIL = makeOil();
export const OIL_DEFAULT = OIL.OIL_DEFAULT;
export const oilPaint = OIL.oilPaint;

/** Same as oilPaint, off the main thread when the browser allows; resolves to {data,width,height}. */
let worker = null, jobs = 0;
const waiting = new Map();
function getWorker() {
  if (worker !== null) return worker;
  try {
    const src = "var OIL=(" + makeOil.toString() + ")();onmessage=function(e){var m=e.data,r=OIL.oilPaint({data:m.data,width:m.width,height:m.height},m.opts,m.px);postMessage({id:m.id,data:r.data,width:r.width,height:r.height},[r.data.buffer]);};";
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    worker.onmessage = (e) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); if (f) f.res(e.data); };
    worker.onerror = (e) => { waiting.forEach((f) => f.rej(e)); waiting.clear(); worker = false; };
  } catch (e) { worker = false; }
  return worker;
}
export function oilPaintAsync(img, opts, px) {
  const wk = getWorker();
  if (!wk) return Promise.resolve(oilPaint(img, opts, px));
  return new Promise((res, rej) => {
    const id = ++jobs, data = new Uint8ClampedArray(img.data);
    waiting.set(id, { res, rej });
    wk.postMessage({ id, data, width: img.width, height: img.height, opts, px }, [data.buffer]);
  }).catch(() => oilPaint(img, opts, px));
}
