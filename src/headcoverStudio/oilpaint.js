/* Oil-paint filter in the spirit of Photoshop's Filter › Stylize › Oil Paint, run entirely in the browser.
   Steps: edge-following stroke direction (structure tensor) -> colour smeared along the strokes (line integral
   convolution) -> bristle streaks -> paint ridges lit from one side with a little shine.
   opts (all 0..10 like Photoshop): stylization (stroke length), cleanliness (how smooth inside a stroke),
   scale (brush width), bristle (bristle detail), shine; angle in degrees for the light. */

// Everything lives inside makeOil() so the same code can be handed to a Web Worker as text (a 300 dpi print
// takes ~20-40 s and must not freeze the page). Keep it free of spread / destructuring / for-of so the build
// doesn't pull in helpers from outside the function.
function makeOil() {
  const OIL_DEFAULT = { stylization: 3, cleanliness: 3, scale: 5, bristle: 4, shine: 2, angle: -60, detail: 7, vivid: 5, rim: 3, relief: 3, grey: false, style: "oil", ink: null, lineDetail: 5, shading: 5, wash: 5, outline: 3 };
  
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
  function oilPaintOil(img, opts, px) {
    const o = Object.assign({}, OIL_DEFAULT, opts);
    const w = img.width, h = img.height, n = w * h, d = img.data;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = d[j]; G[i] = d[j + 1]; B[i] = d[j + 2]; }
    if (o.grey) for (let i = 0; i < n; i++) { const l = 0.3 * R[i] + 0.59 * G[i] + 0.11 * B[i]; R[i] = l; G[i] = l; B[i] = l; }   // black-and-white painting
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

  /* ----- other looks from the same photo: pen & ink, screen print, watercolour (filters only, no AI) ----- */
  function hexRgb(h, d) { if (!h) return d; h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rng(seed) { let s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
  function noise(w, h, sigma, seed) { const r = rng(seed), a = new Float32Array(w * h); for (let i = 0; i < a.length; i++) a[i] = r() - 0.5; const b = blur(a, w, h, sigma); let q = 0; for (let i = 0; i < b.length; i++) q += b[i] * b[i]; q = Math.sqrt(q / b.length) || 1; for (let i = 0; i < b.length; i++) b[i] /= q; return b; }
  function boxBlur(src, w, h, r) {   // mean over (2r+1)^2, running sums
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const o = y * w; let s = 0; for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { tmp[o + x] = s; s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
    const k = 1 / ((2 * r + 1) * (2 * r + 1));
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = s * k; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
    return out;
  }
  // Kuwahara: each pixel takes the calmest of its four neighbouring squares -> flat colour areas with crisp edges
  function kuwahara(chans, L, w, h, r) {
    const hr = Math.max(1, Math.round(r / 2)), L2 = new Float32Array(w * h);
    for (let i = 0; i < L2.length; i++) L2[i] = L[i] * L[i];
    const mL = boxBlur(L, w, h, hr), mL2 = boxBlur(L2, w, h, hr), mC = chans.map(function (c) { return boxBlur(c, w, h, hr); });
    const outs = chans.map(function () { return new Float32Array(w * h); });
    const off = [[-hr, -hr], [hr, -hr], [-hr, hr], [hr, hr]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let best = -1, bv = 1e18;
      for (let q = 0; q < 4; q++) { const xx = Math.min(w - 1, Math.max(0, x + off[q][0])), yy = Math.min(h - 1, Math.max(0, y + off[q][1])), j = yy * w + xx, v = mL2[j] - mL[j] * mL[j]; if (v < bv) { bv = v; best = j; } }
      for (let c = 0; c < chans.length; c++) outs[c][y * w + x] = mC[c][best];
    }
    return outs;
  }
  function lumOf(R, G, B) { const n = R.length, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = (0.3 * R[i] + 0.59 * G[i] + 0.11 * B[i]) / 255; return L; }
  // even out the light (dusk / backlit photos), then a gentle local-contrast lift
  function evenLight(L, w, h, px) {
    const n = L.length, st = Math.max(1, Math.floor(n / 20000)), smp = [];
    for (let i = 0; i < n; i += st) smp.push(L[i]);
    smp.sort(function (a, b) { return a - b; });
    const lo = smp[Math.floor(smp.length * 0.02)], hi = smp[Math.floor(smp.length * 0.98)] || 1, base = blur(L, w, h, 18 * px), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = (L[i] - lo) / Math.max(0.05, hi - lo); v = v + 0.4 * (v - (base[i] - lo) / Math.max(0.05, hi - lo)); v = Math.min(1, Math.max(0, v)); out[i] = Math.pow(v, 0.75); }
    return out;
  }
  function quantiles(A, qs) { const st = Math.max(1, Math.floor(A.length / 30000)), s = []; for (let i = 0; i < A.length; i += st) s.push(A[i]); s.sort(function (a, b) { return a - b; }); return qs.map(function (q) { return s[Math.floor(q * (s.length - 1))]; }); }
  function xdog(g, w, h, sig, p, eps, phi) {
    const a = blur(g, w, h, sig), b = blur(g, w, h, sig * 1.6), out = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) { const d = (1 + p) * a[i] - p * b[i]; out[i] = d >= eps ? 1 : 1 + Math.tanh(phi * (d - eps)); }
    return out;
  }
  function split(img) { const n = img.width * img.height, d = img.data, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n); for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = d[j]; G[i] = d[j + 1]; B[i] = d[j + 2]; } return [R, G, B]; }
  function pack(R, G, B, n) { const out = new Uint8ClampedArray(n * 4); for (let i = 0, j = 0; i < n; i++, j += 4) { out[j] = R[i]; out[j + 1] = G[i]; out[j + 2] = B[i]; out[j + 3] = 255; } return out; }

  function penInk(img, o, px) {
    const w = img.width, h = img.height, n = w * h, ch = split(img), L = evenLight(lumOf(ch[0], ch[1], ch[2]), w, h, px);
    const g = kuwahara([L], L, w, h, Math.max(2, Math.round(1.6 * px)))[0];
    const ld = o.lineDetail / 5, lines = xdog(g, w, h, 0.7 * px, 14 + 8 * ld, 0.5 - 0.06 * ld, 12);
    const tone = blur(g, w, h, 1.2 * px), sh = o.shading / 5;
    const wob = noise(w, h, 5 * px, 7), per = 4.2 * px, hw = Math.max(0.55, 0.32 * px);
    const inkc = hexRgb(o.ink, [32, 36, 52]), pap = hexRgb(o.paper, [244, 238, 224]), pn = noise(w, h, 1.2 * px, 11), pn2 = noise(w, h, 12 * px, 13);
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    const T = [[Math.PI / 4, 0.36 * sh], [-Math.PI / 4, 0.2 * sh], [0, 0.08 * sh]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let ink = 1 - lines[i];
      for (let k = 0; k < 3; k++) { if (tone[i] >= T[k][1]) continue; const a = T[k][0], v = ((x * Math.cos(a) + y * Math.sin(a)) % per + per) % per, d = Math.abs(v - per / 2 + wob[i] * 0.35 * px); ink = Math.max(ink, Math.min(1, Math.max(0, hw - d + 0.5))); }
      const t = pn[i] * 4 + pn2[i] * 3;
      R[i] = (pap[0] + t) * (1 - ink) + inkc[0] * ink; G[i] = (pap[1] + t) * (1 - ink) + inkc[1] * ink; B[i] = (pap[2] + t) * (1 - ink) + inkc[2] * ink;
    }
    return { data: pack(R, G, B, n), width: w, height: h };
  }

  function screenPrint(img, o, px) {
    const w = img.width, h = img.height, n = w * h, ch = split(img), L = evenLight(lumOf(ch[0], ch[1], ch[2]), w, h, px);
    const det = o.lineDetail / 5, sm = blur(kuwahara([L], L, w, h, Math.max(2, Math.round((4.5 - 1.5 * det) * px)))[0], w, h, 0.8 * px);
    const qs = quantiles(sm, [0.3, 0.58, 0.84]);
    // clean speckles: blur each level's mask, keep the strongest
    const lv = [0, 1, 2, 3].map(function (k) { const m = new Float32Array(n); for (let i = 0; i < n; i++) { const l = (sm[i] > qs[0]) + (sm[i] > qs[1]) + (sm[i] > qs[2]); m[i] = l === k ? 1 : 0; } return blur(m, w, h, 2.2 * px); });
    const c = hexRgb(o.ink, [48, 110, 80]), cream = hexRgb(o.paper, [240, 232, 208]);
    const mix = function (a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
    const pal = [mix(c, [0, 0, 0], 0.55), c, mix(c, cream, 0.5), cream];
    const tex = noise(w, h, 0.8 * px, 17), R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let k = 0; for (let q = 1; q < 4; q++) if (lv[q][i] > lv[k][i]) k = q;
      const t = 1 + tex[i] * 0.015; R[i] = pal[k][0] * t; G[i] = pal[k][1] * t; B[i] = pal[k][2] * t;
    }
    return { data: pack(R, G, B, n), width: w, height: h };
  }

  function waterColour(img, o, px) {
    const w = img.width, h = img.height, n = w * h, ch = split(img);
    if (o.grey) { for (let i = 0; i < n; i++) { const l = 0.3 * ch[0][i] + 0.59 * ch[1][i] + 0.11 * ch[2][i]; ch[0][i] = l; ch[1][i] = l; ch[2][i] = l; } }
    const L0 = lumOf(ch[0], ch[1], ch[2]);
    const k0 = kuwahara(ch, L0, w, h, Math.max(2, Math.round((2 + o.wash * 0.9) * px)));
    const flat = kuwahara(k0.map(function (c) { return blur(c, w, h, 0.9 * px); }), blur(L0, w, h, 0.9 * px), w, h, Math.max(2, Math.round((1.5 + o.wash * 0.5) * px)));
    for (let i = 0; i < n; i++) { const m = (flat[0][i] + flat[1][i] + flat[2][i]) / 3; for (let c = 0; c < 3; c++) flat[c][i] = 255 * Math.pow(Math.min(1, Math.max(0, m + (flat[c][i] - m) * (o.grey ? 1 : 1.2)) / 255), 0.8); }   // a little richer, brighter like thin paint
    const Lf = lumOf(flat[0], flat[1], flat[2]), Lb = blur(Lf, w, h, 1.2 * px);
    const gran = noise(w, h, 1.6 * px, 21), wash = noise(w, h, 30 * px, 23), pn = noise(w, h, 1.2 * px, 25);
    const ol = o.outline / 10, lines = blur(xdog(blur(L0, w, h, 1.0 * px), w, h, 1.4 * px, 10, 0.72, 6), w, h, 0.6 * px);
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), C = [R, G, B], pap = [250, 247, 240];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, lap = Math.abs(4 * Lb[i] - Lb[i - 1] - Lb[i + 1] - Lb[i - w] - Lb[i + w]) * 255 / 14, e = Math.min(1, lap);
      for (let c = 0; c < 3; c++) {
        let v = flat[c][i] * (1 - 0.22 * e);                                      // pigment pools at the edges
        v = 255 - (255 - v) * 0.74 * (1 + gran[i] * 0.04);                          // lighter, grainy
        v = 255 - (255 - v) * Math.min(1.15, Math.max(0.7, 0.92 + 0.12 * wash[i])); // uneven washes
        v = v * (pap[c] + pn[i] * 3) / 255;                                        // on paper
        C[c][i] = v * (1 - ol + ol * lines[i]);                                    // a little pencil line
      }
    }
    for (let x = 0; x < w; x++) { R[x] = R[x + w]; G[x] = G[x + w]; B[x] = B[x + w]; const a = (h - 1) * w + x; R[a] = R[a - w]; G[a] = G[a - w]; B[a] = B[a - w]; }
    for (let y = 0; y < h; y++) { const a = y * w, b = a + w - 1; R[a] = R[a + 1]; G[a] = G[a + 1]; B[a] = B[a + 1]; R[b] = R[b - 1]; G[b] = G[b - 1]; B[b] = B[b - 1]; }
    return { data: pack(R, G, B, n), width: w, height: h };
  }

  function oilPaint(img, opts, px) {
    const o = Object.assign({}, OIL_DEFAULT, opts || {}); px = px || 1;
    if (o.style === "ink") return penInk(img, o, px);
    if (o.style === "screen") return screenPrint(img, o, px);
    if (o.style === "water") return waterColour(img, o, px);
    return oilPaintOil(img, opts || {}, px);
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
