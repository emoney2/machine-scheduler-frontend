import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tajima end-of-hoop melody from the shop clip (IMG_8969):
 * three rising phrases ~0.62s apart, ~1.85s total.
 * Each phrase: strong 4.08–4.32 kHz, then 2.79–3.31 kHz, then 4.1 kHz again.
 * Not a volume beep — shop noise/speech lives below ~1.5 kHz.
 */
const FFT_SIZE = 2048;
const B4_LO = 3920;
const B4_HI = 4420;
const B3_LO = 2720;
const B3_HI = 3380;
const BASS_LO = 150;
const BASS_HI = 1300;
const COOLDOWN_MS = 6000;
const PEAK_GAP_MIN = 350;
const PEAK_GAP_MAX = 1100;
const PEAK_REFRACTORY = 280;

function bandAvg(bytes, sampleRate, f0, f1) {
  const binHz = sampleRate / FFT_SIZE;
  const a = Math.max(0, Math.floor(f0 / binHz));
  const b = Math.min(bytes.length - 1, Math.ceil(f1 / binHz));
  if (b < a) return 0;
  let s = 0;
  for (let i = a; i <= b; i++) s += bytes[i];
  return s / (b - a + 1);
}

async function openMic() {
  const attempts = [
    {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    },
    { audio: true, video: false },
  ];
  let lastErr;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("mic");
}

function maxB4Before(hist, peakT) {
  let m = 0;
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i];
    if (h.t >= peakT - 500 && h.t <= peakT + 80) m = Math.max(m, h.b4);
  }
  return m;
}

function melodyDetected(hist, b3Noise, b4Noise) {
  if (hist.length < 12) return false;
  const peaks = [];
  for (let i = 2; i < hist.length - 2; i++) {
    const p = hist[i];
    const isPeak =
      p.b3 >= hist[i - 1].b3 &&
      p.b3 >= hist[i + 1].b3 &&
      p.b3 >= hist[i - 2].b3 &&
      p.b3 >= hist[i + 2].b3;
    if (!isPeak) continue;
    if (p.b3 < b3Noise * 1.65 + 8) continue;
    if (peaks.length && p.t - peaks[peaks.length - 1].t < PEAK_REFRACTORY) continue;
    peaks.push(p);
  }
  if (peaks.length < 3) return false;
  const needB4 = b4Noise * 1.6 + 6;
  for (let i = 0; i < peaks.length - 2; i++) {
    for (let j = i + 1; j < peaks.length - 1; j++) {
      const d1 = peaks[j].t - peaks[i].t;
      if (d1 < PEAK_GAP_MIN) continue;
      if (d1 > PEAK_GAP_MAX) break;
      for (let k = j + 1; k < peaks.length; k++) {
        const d2 = peaks[k].t - peaks[j].t;
        if (d2 < PEAK_GAP_MIN) continue;
        if (d2 > PEAK_GAP_MAX) break;
        const highToneCount = [peaks[i], peaks[j], peaks[k]].filter(
          (peak) => maxB4Before(hist, peak.t) >= needB4
        ).length;
        if (highToneCount >= 2) return true;
      }
    }
  }
  return false;
}

export function useMachineChime(enabled) {
  const [heardAt, setHeardAt] = useState("");
  const [level, setLevel] = useState(null);
  const [listening, setListening] = useState(false);
  const heardAtRef = useRef("");
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const startedRef = useRef(false);
  const lastUiRef = useRef(0);
  const stop = useCallback(() => {
    startedRef.current = false;
    setListening(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!enabled) return;
    if (ctxRef.current?.state === "suspended") {
      await ctxRef.current.resume().catch(() => {});
    }
    if (startedRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    startedRef.current = true;
    try {
      const stream = await openMic();
      streamRef.current = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.18;
      src.connect(analyser);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      analyser.connect(mute);
      mute.connect(ctx.destination);
      const bytes = new Uint8Array(analyser.frequencyBinCount);
      const hist = [];
      let lastDetect = 0;
      const b3Noise = { n: 0, mean: 8 };
      const b4Noise = { n: 0, mean: 6 };
      setListening(true);

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        analyser.getByteFrequencyData(bytes);
        const b4 = bandAvg(bytes, ctx.sampleRate, B4_LO, B4_HI);
        const b3 = bandAvg(bytes, ctx.sampleRate, B3_LO, B3_HI);
        const bass = bandAvg(bytes, ctx.sampleRate, BASS_LO, BASS_HI);
        const now = Date.now();
        const melody = Math.max(b3, b4);
        if (now - lastUiRef.current >= 120) {
          lastUiRef.current = now;
          setLevel(melody / 255);
        }

        const likely =
          (b4 > b4Noise.mean * 2.2 + 8 && b4 > bass * 0.9) ||
          (b3 > b3Noise.mean * 2.2 + 10 && b3 > bass * 0.95);
        if (!likely) {
          b3Noise.n = Math.min(100, b3Noise.n + 1);
          b3Noise.mean += (b3 - b3Noise.mean) / b3Noise.n;
          b4Noise.n = Math.min(100, b4Noise.n + 1);
          b4Noise.mean += (b4 - b4Noise.mean) / b4Noise.n;
        }

        hist.push({ t: now, b3, b4, bass });
        while (hist.length && now - hist[0].t > 2800) hist.shift();

        if (now - lastDetect <= COOLDOWN_MS) return;
        if (!melodyDetected(hist, b3Noise.mean, b4Noise.mean)) return;
        lastDetect = now;
        hist.length = 0;
        const iso = new Date().toISOString();
        heardAtRef.current = iso;
        setHeardAt(iso);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      startedRef.current = false;
      setListening(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return undefined;
    }
    start();
    const kick = () => start();
    document.addEventListener("pointerdown", kick, true);
    return () => {
      document.removeEventListener("pointerdown", kick, true);
      stop();
    };
  }, [enabled, start, stop]);

  const consume = useCallback(() => {
    heardAtRef.current = "";
    setHeardAt("");
  }, []);

  return { heardAt, consume, level, listening };
}
