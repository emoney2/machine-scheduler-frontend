import { useCallback, useEffect, useRef, useState } from "react";

/** Tajima-style end-of-hoop chime from shop floor video: 3 high beeps ~0.6s apart, 2.8–4.3 kHz. */
const FFT_SIZE = 2048;
const HIGH_LO = 3850;
const HIGH_HI = 4450;
const MID_LO = 2700;
const MID_HI = 3600;
const LOW_LO = 200;
const LOW_HI = 1400;
const COOLDOWN_MS = 8000;
/** Local chime is louder on this tablet than a neighbor across the aisle. */
const MIN_PULSE_PEAK = 40;
/** This machine must have just stopped sewing — not still stitching, not idle. */
const OWN_STOP_MIN_MS = 80;
const OWN_STOP_MAX_MS = 8000;

function bandAvg(bytes, sampleRate, f0, f1) {
  const binHz = sampleRate / FFT_SIZE;
  const a = Math.max(0, Math.floor(f0 / binHz));
  const b = Math.min(bytes.length - 1, Math.ceil(f1 / binHz));
  if (b < a) return 0;
  let s = 0;
  for (let i = a; i <= b; i++) s += bytes[i];
  return s / (b - a + 1);
}

function ownMachineStopped(motion, atMs) {
  if (!motion?.motionAvailable) return false;
  if (motion.bursting) return false;
  const lastAct = Number(motion.lastActivityAt) || 0;
  if (!lastAct) return false;
  const dt = atMs - lastAct;
  return dt >= OWN_STOP_MIN_MS && dt <= OWN_STOP_MAX_MS;
}

export function useMachineChime(enabled, motionLiveRef) {
  const [heardAt, setHeardAt] = useState("");
  const heardAtRef = useRef("");
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const startedRef = useRef(false);
  const motionHolder = useRef(motionLiveRef);
  motionHolder.current = motionLiveRef;

  const stop = useCallback(() => {
    startedRef.current = false;
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
    if (!enabled || startedRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    startedRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      streamRef.current = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.12;
      src.connect(analyser);
      const bytes = new Uint8Array(analyser.frequencyBinCount);
      const pulses = [];
      let inPulse = false;
      let pulseStart = 0;
      let pulsePeak = 0;
      let lastDetect = 0;
      const noise = { n: 0, mean: 0 };

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        analyser.getByteFrequencyData(bytes);
        const high = bandAvg(bytes, ctx.sampleRate, HIGH_LO, HIGH_HI);
        const mid = bandAvg(bytes, ctx.sampleRate, MID_LO, MID_HI);
        const low = bandAvg(bytes, ctx.sampleRate, LOW_LO, LOW_HI);
        const now = Date.now();
        const motion = motionHolder.current?.current || {};
        const chimeFrame =
          high > 22 &&
          high > noise.mean * 1.85 + 8 &&
          high + mid > low * 1.15;
        if (!chimeFrame) {
          noise.n = Math.min(80, noise.n + 1);
          noise.mean += (high - noise.mean) / noise.n;
        }

        // Neighbor machines can chime too. Only this tablet feels this bed
        // shake, so ignore beeps unless this machine just went quiet.
        if (motion.bursting || !motion.motionAvailable) {
          inPulse = false;
          pulsePeak = 0;
          pulses.length = 0;
          return;
        }

        if (chimeFrame && ownMachineStopped(motion, now)) {
          if (!inPulse) {
            inPulse = true;
            pulseStart = now;
            pulsePeak = high;
          } else {
            pulsePeak = Math.max(pulsePeak, high);
          }
        } else if (inPulse) {
          if (
            now - pulseStart >= 220 &&
            pulsePeak >= MIN_PULSE_PEAK &&
            ownMachineStopped(motion, pulseStart)
          ) {
            pulses.push(pulseStart);
          }
          inPulse = false;
          pulsePeak = 0;
        }

        while (pulses.length && now - pulses[0] > 2600) pulses.shift();
        if (pulses.length >= 3 && now - lastDetect > COOLDOWN_MS) {
          const a = pulses[pulses.length - 3];
          const b = pulses[pulses.length - 2];
          const c = pulses[pulses.length - 1];
          const d1 = b - a;
          const d2 = c - b;
          if (
            d1 >= 380 &&
            d1 <= 950 &&
            d2 >= 380 &&
            d2 <= 950 &&
            ownMachineStopped(motion, a)
          ) {
            lastDetect = now;
            pulses.length = 0;
            const iso = new Date().toISOString();
            heardAtRef.current = iso;
            setHeardAt(iso);
          }
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      startedRef.current = false;
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

  return { heardAt, consume };
}
