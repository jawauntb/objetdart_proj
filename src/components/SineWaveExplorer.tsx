"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { holdTier, pathWinding, THRESHOLDS } from "@/lib/gesture/core";
import { getTimbreEngine } from "@/lib/timbre-engine";
import type { TimbreSpec } from "@/lib/timbre";
import { useField } from "@/store/field";

type WaveMode = "source" | "interference" | "standing";

type Impulse = {
  x: number;
  y: number;
  born: number;
  life: number;
  strength: number;
};

const MODES: Array<{ id: WaveMode; label: string; tone: string; midi: number }> = [
  { id: "source", label: "source", tone: "#f3d77a", midi: 50 },
  { id: "interference", label: "interference", tone: "#65d8c5", midi: 57 },
  { id: "standing", label: "standing", tone: "#ff6f8e", midi: 62 },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// The room's own voice on the shared timbre engine: the narrowest wind the
// physical models can speak — a breathless, chiffless bore whose lowpass
// hugs the fundamental, so what holds under the finger is as close to the
// bare oscillator as the engine allows.
const SINE_VOICE: TimbreSpec = {
  key: "sine-voice",
  label: "sine",
  model: "wind",
  attack: 0.05,
  release: 0.35,
  brightBase: 1.1,
  brightEnv: 0.4,
  formants: [],
  breath: 0,
  breathHz: 2000,
  onsetBend: 1,
  onsetMs: 0,
  chiff: 0,
  vibratoHz: 0.14,
  vibratoCents: 3,
  vibratoDelayMs: 0,
  gain: 0.7,
};

const hzFromMidi = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Each voice is pitched by its height on the wave: high on screen, high in pitch. */
const hzFromY = (y: number, midi: number) => hzFromMidi(midi) * 2 ** ((1 - y) * 1.8);

type VoiceTouch = {
  x: number; // normalized 0..1
  y: number;
  t0: number;
  moved: number; // px since landing
  vx: number; // px/ms, smoothed
  lastX: number;
  lastY: number;
  lastT: number;
  path: Array<{ x: number; y: number }>; // px, for the scrub verb
  scrubFired: number;
};

type KeptWave = {
  amp: number;
  freq: number;
  phase: number;
  damping: number;
  harmonic: number;
  mode: WaveMode;
};

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function waveSample(
  u: number,
  phase: number,
  amp: number,
  freq: number,
  damping: number,
  harmonic: number,
  mode: WaveMode,
) {
  const decay = Math.exp(-damping * u * 3.7);
  const primary = Math.sin(u * Math.PI * 2 * freq + phase);
  const overtone = Math.sin(u * Math.PI * 2 * freq * 2 + phase * 1.46) * harmonic * 0.58;
  const third = Math.sin(u * Math.PI * 2 * (freq + 1.5) - phase * 0.7) * harmonic * 0.24;

  if (mode === "standing") {
    const node = Math.sin(u * Math.PI * Math.round(freq + 1));
    const pulse = Math.cos(phase);
    return amp * node * pulse * (0.74 + harmonic * 0.32) * decay;
  }

  if (mode === "interference") {
    const reflected = Math.sin((1 - u) * Math.PI * 2 * (freq * 0.72 + 0.5) - phase * 1.2);
    return amp * (primary + reflected * 0.62 + overtone + third) * 0.58 * decay;
  }

  return amp * (primary + overtone + third) * decay;
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
  amp: number,
  freq: number,
  damping: number,
  harmonic: number,
  mode: WaveMode,
  color: string,
  yCenter: number,
  alpha: number,
  lineWidth: number,
  bend?: (u: number) => number,
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colorAlpha(color, alpha);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  const left = width * 0.07;
  const usable = width * 0.86;
  for (let i = 0; i <= 260; i += 1) {
    const u = i / 260;
    const x = left + usable * u;
    let y = yCenter - waveSample(u, phase, amp, freq, damping, harmonic, mode) * height * 0.0026;
    if (bend) y += bend(u);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  tone: string,
  energy: number,
) {
  const ground = ctx.createLinearGradient(0, 0, width, height);
  ground.addColorStop(0, "#070a12");
  ground.addColorStop(0.48, "#10201d");
  ground.addColorStop(1, "#190d16");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.46, 0, width * 0.5, height * 0.52, Math.max(width, height) * 0.58);
  glow.addColorStop(0, colorAlpha(tone, 0.16 + energy * 0.10));
  glow.addColorStop(0.48, "rgba(101, 216, 197, 0.055)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1;
  const step = Math.max(42, Math.min(82, width / 18));
  for (let x = -step; x < width + step; x += step) {
    ctx.strokeStyle = "rgba(238, 234, 219, 0.055)";
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(time + x * 0.006) * 8, 0);
    ctx.lineTo(x - height * 0.055, height);
    ctx.stroke();
  }
  for (let y = height * 0.12; y < height; y += step * 0.92) {
    ctx.strokeStyle = "rgba(243, 215, 122, 0.045)";
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(time + y * 0.012) * 8);
    ctx.lineTo(width, y + Math.cos(time * 0.7 + y * 0.011) * 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawImpulses(
  ctx: CanvasRenderingContext2D,
  impulses: Impulse[],
  now: number,
  tone: string,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const impulse of impulses) {
    const age = (now - impulse.born) / impulse.life;
    if (age >= 1) continue;
    const alpha = (1 - age) * impulse.strength;
    const radius = 24 + age * 170 * impulse.strength;
    ctx.strokeStyle = colorAlpha(tone, alpha * 0.45);
    ctx.lineWidth = 1 + (1 - age) * 3;
    ctx.beginPath();
    ctx.arc(impulse.x, impulse.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    const core = ctx.createRadialGradient(impulse.x, impulse.y, 0, impulse.x, impulse.y, radius * 0.64);
    core.addColorStop(0, colorAlpha(tone, alpha * 0.22));
    core.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(impulse.x, impulse.y, radius * 0.64, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export default function SineWaveExplorer() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const impulsesRef = useRef<Impulse[]>([]);
  const pointerRef = useRef({ active: false, id: -1, x: 0.5, y: 0.5, lastTone: 0, moved: 0 });
  // ── the polyphonic dialect: every finger an independent voice ──
  const voicesRef = useRef(new Map<number, VoiceTouch>());
  const keptRef = useRef<KeptWave | null>(null);
  const windRef = useRef({ cur: 0, target: 0 }); // phase wind from a 3-voice drag
  const timeScaleRef = useRef({ cur: 1, target: 1 }); // 3-voice hold dilates time
  const chordRef = useRef({ dilating: false, kept: false });
  const entrainRef = useRef({ bpm: 0, until: 0, lastBeat: -1 });
  const lastGestureAtRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const phaseRef = useRef(0);
  const ampRef = useRef(86);
  const freqRef = useRef(2.5);
  const dampingRef = useRef(0.08);
  const harmonicRef = useRef(0.28);
  const runningRef = useRef(true);
  const modeRef = useRef<WaveMode>("source");
  const lastControlAt = useRef(0);
  const recordTape = useField((s) => s.recordTape);

  const [amp, setAmp] = useState(86);
  const [freq, setFreq] = useState(2.5);
  const [phase, setPhase] = useState(0);
  const [damping, setDamping] = useState(0.08);
  const [harmonic, setHarmonic] = useState(0.28);
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<WaveMode>("source");
  const [readout, setReadout] = useState("86 / 2.50 / source");

  useEffect(() => { ampRef.current = amp; }, [amp]);
  useEffect(() => { freqRef.current = freq; }, [freq]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { dampingRef.current = damping; }, [damping]);
  useEffect(() => { harmonicRef.current = harmonic; }, [harmonic]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const update = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    let time = 0;
    let energy = 0;
    let lastPhaseSync = 0;

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(520, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      const delta = Math.min(48, now - last);
      last = now;
      const reduce = reduceMotionRef.current;
      const cfg = MODES.find((item) => item.id === modeRef.current) ?? MODES[0];

      // ── the law layer, read from the chord (gesture grammar §3) ──
      // Three voices held still dilate the room's clock; three voices held
      // through the ceremony tier keep the wave as a golden ghost. All
      // tiers come from gesture/core — no private thresholds.
      const voices = Array.from(voicesRef.current.values());
      const chord = chordRef.current;
      if (voices.length >= 3) {
        const still = voices.every((v) => v.moved < THRESHOLDS.moveTolPx);
        const newest = Math.max(...voices.map((v) => v.t0));
        const tier = holdTier(now - newest);
        if (still && tier >= 1) {
          if (!chord.dilating) {
            chord.dilating = true;
            timeScaleRef.current.target = 0.25;
            try { getFieldAudio().playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (tier >= 3 && !chord.kept) {
            // ceremony — the room's one solemn act: the wave is kept
            chord.kept = true;
            keptRef.current = {
              amp: ampRef.current,
              freq: freqRef.current,
              phase: phaseRef.current,
              damping: dampingRef.current,
              harmonic: harmonicRef.current,
              mode: modeRef.current,
            };
            try { getFieldAudio().bell(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
            useField.getState().recordTape("sigil", 1, "sine/kept-wave");
          }
        } else if (chord.dilating && !still) {
          chord.dilating = false;
          timeScaleRef.current.target = 1;
        }
      } else {
        if (chord.dilating) {
          chord.dilating = false;
          timeScaleRef.current.target = 1;
        }
        chord.kept = false;
      }

      const ts = timeScaleRef.current;
      ts.cur += (ts.target - ts.cur) * Math.min(1, delta * 0.005);
      // phase wind from three voices dragged together — decays on its own
      const wind = windRef.current;
      wind.cur += (wind.target - wind.cur) * Math.min(1, delta * 0.0045);
      wind.target *= Math.exp(-delta / 1400);

      const entrain = entrainRef.current;
      const entrained = now < entrain.until && entrain.bpm > 0;
      if (!reduce && runningRef.current) {
        const beatLen = entrained ? 60000 / entrain.bpm : 0;
        const advance = entrained
          ? delta * ((Math.PI * 2) / beatLen) // the wave locks to your tempo
          : delta * 0.0017 * (0.55 + freqRef.current * 0.18);
        phaseRef.current =
          (phaseRef.current + advance * ts.cur + wind.cur * delta * 0.004 + Math.PI * 2) % (Math.PI * 2);
      } else if (wind.cur !== 0) {
        // even paused or reduced, a deliberate 3-finger push still lands
        phaseRef.current = (phaseRef.current + wind.cur * delta * 0.004 + Math.PI * 2) % (Math.PI * 2);
      }
      if (entrained) {
        const beatIdx = Math.floor(now / (60000 / entrain.bpm));
        if (beatIdx !== entrain.lastBeat) {
          entrain.lastBeat = beatIdx;
          try { getFieldAudio().playNote(cfg.midi + (beatIdx % 2) * 7, 90); } catch { /* noop */ }
          const rect = canvas.getBoundingClientRect();
          impulsesRef.current.push({
            x: rect.width * 0.5,
            y: rect.height * 0.49,
            born: now,
            life: 700,
            strength: 0.4,
          });
        }
      }
      time += reduce ? delta * 0.00015 : delta * 0.001 * ts.cur;
      pointerRef.current.active = voicesRef.current.size > 0;
      energy = mix(energy, pointerRef.current.active ? 1 : 0, pointerRef.current.active ? 0.12 : 0.025);

      drawBackground(ctx, width, height, time, cfg.tone, energy);
      const center = height * 0.49;
      const ampNow = ampRef.current;
      const freqNow = freqRef.current;
      const phaseNow = phaseRef.current;
      const dampingNow = dampingRef.current;
      const harmonicNow = harmonicRef.current;
      const modeNow = modeRef.current;

      drawRibbon(ctx, width, height, phaseNow - Math.PI * 0.55, ampNow * 0.62, freqNow * 0.64 + 0.3, dampingNow * 0.7, harmonicNow, "interference", "#65d8c5", center - height * 0.13, 0.20, 1.4);
      drawRibbon(ctx, width, height, -phaseNow * 0.82, ampNow * 0.50, freqNow + 0.75, dampingNow * 0.35, harmonicNow * 0.65, "standing", "#b99aff", center + height * 0.13, 0.18, 1.3);

      // the kept wave — sealed by ceremony, a golden ghost under the living one
      const kept = keptRef.current;
      if (kept) {
        drawRibbon(ctx, width, height, kept.phase, kept.amp, kept.freq, kept.damping, kept.harmonic, kept.mode, "#f3d77a", center, 0.24, 2);
      }

      // every held finger bends the wave through its point — the voices are
      // the material, the ribbon obeys all of them at once
      let bend: ((u: number) => number) | undefined;
      if (voices.length > 0) {
        const left = width * 0.07;
        const usable = width * 0.86;
        const bends = voices.map((v) => {
          const u = clamp(((v.x * width) - left) / usable, 0, 1);
          const waveY = center - waveSample(u, phaseNow, ampNow, freqNow, dampingNow, harmonicNow, modeNow) * height * 0.0026;
          return { u, d: v.y * height - waveY };
        });
        bend = (u: number) => {
          let off = 0;
          for (const b of bends) {
            const du = u - b.u;
            off += b.d * Math.exp(-(du * du) / 0.0028);
          }
          return off;
        };
      }
      drawRibbon(ctx, width, height, phaseNow, ampNow, freqNow, dampingNow, harmonicNow, modeNow, cfg.tone, center, 0.94, 4.2, bend);

      // halos under the held voices — sight for what the hand is sounding
      for (const v of voices) {
        const vx = v.x * width;
        const vy = v.y * height;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 260 + v.t0) * 0.5;
        ctx.save();
        ctx.strokeStyle = colorAlpha(cfg.tone, 0.3 + pulse * 0.3);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(vx, vy, 20 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = colorAlpha(cfg.tone, 0.16);
        ctx.beginPath();
        ctx.arc(vx, vy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = "rgba(238, 234, 219, 0.13)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 14]);
      ctx.beginPath();
      ctx.moveTo(width * 0.07, center);
      ctx.lineTo(width * 0.93, center);
      ctx.stroke();
      ctx.setLineDash([]);
      const nodes = modeNow === "standing" ? Math.max(2, Math.round(freqNow + 1)) : Math.max(3, Math.round(freqNow * 2));
      for (let i = 0; i <= nodes; i += 1) {
        const x = width * 0.07 + (width * 0.86 * i) / nodes;
        ctx.fillStyle = colorAlpha(i % 2 ? "#65d8c5" : cfg.tone, 0.62);
        ctx.beginPath();
        ctx.arc(x, center, 2.4 + harmonicNow * 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const lissR = Math.min(width, height) * 0.115;
      const lx = width * 0.78;
      const ly = height * 0.28;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = colorAlpha("#f3d77a", 0.36);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i <= 180; i += 1) {
        const t = (i / 180) * Math.PI * 2;
        const x = lx + Math.sin(t * freqNow + phaseNow) * lissR;
        const y = ly + Math.sin(t * (freqNow + 1) - phaseNow * 0.7) * lissR * 0.72;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      impulsesRef.current = impulsesRef.current.filter((impulse) => now - impulse.born < impulse.life);
      drawImpulses(ctx, impulsesRef.current, now, cfg.tone);

      // glimmer (grammar §6): after ~20s of quiet, a faint touch-ring floats
      // on the wave where a finger would land — physical, never text.
      if (now - lastGestureAtRef.current > 20000) {
        const slot = Math.floor(now / 9000);
        const gseed = (n: number) => { const v = Math.sin((slot + n) * 127.1) * 43758.5453; return v - Math.floor(v); };
        const gu = 0.14 + gseed(0) * 0.72;
        const gx = width * 0.07 + width * 0.86 * gu;
        const gy = center - waveSample(gu, phaseNow, ampNow, freqNow, dampingNow, harmonicNow, modeNow) * height * 0.0026;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.save();
        ctx.strokeStyle = colorAlpha(cfg.tone, 0.06 + pulse * 0.09);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 16 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (now - lastPhaseSync > 130) {
        lastPhaseSync = now;
        setPhase(Number(phaseRef.current.toFixed(2)));
        setReadout(`${Math.round(ampNow)} / ${freqNow.toFixed(2)} / ${modeNow}`);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  const markControl = useCallback((meta: string, intensity: number) => {
    const now = performance.now();
    if (now - lastControlAt.current < 100) return;
    lastControlAt.current = now;
    const cfg = MODES.find((item) => item.id === modeRef.current) ?? MODES[0];
    try { getFieldAudio().playNote(cfg.midi + Math.round(intensity * 24), 90); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("sigil", 0.28 + intensity * 0.48, `sine/${meta}`);
  }, [recordTape]);

  const tuneFromPointer = useCallback((clientX: number, clientY: number, strength = 1) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const pointer = pointerRef.current;
    pointer.moved += Math.hypot(x - pointer.x, y - pointer.y);
    pointer.x = x;
    pointer.y = y;

    const nextAmp = Math.round(26 + (1 - y) * 130);
    const nextFreq = Number((0.7 + x * 7.4).toFixed(2));
    const nextPhase = Number(((x * Math.PI * 2 + y * Math.PI) % (Math.PI * 2)).toFixed(2));
    const nextHarmonic = Number(clamp(harmonicRef.current + (strength - 0.6) * 0.08, 0, 0.82).toFixed(2));

    ampRef.current = nextAmp;
    freqRef.current = nextFreq;
    phaseRef.current = nextPhase;
    harmonicRef.current = nextHarmonic;
    setAmp(nextAmp);
    setFreq(nextFreq);
    setPhase(nextPhase);
    setHarmonic(nextHarmonic);
    setReadout(`${nextAmp} / ${nextFreq.toFixed(2)} / ${modeRef.current}`);

    const now = performance.now();
    impulsesRef.current.push({
      x: x * rect.width,
      y: y * rect.height,
      born: now,
      life: 1300 + strength * 500,
      strength: clamp(0.36 + strength * 0.42, 0.28, 0.96),
    });
    if (impulsesRef.current.length > 18) impulsesRef.current = impulsesRef.current.slice(-18);

    // Sound is the voice's own now (the timbre engine holds the tone) —
    // here only the tape and the hand's throttled pulse remain.
    if (now - pointer.lastTone > 75) {
      pointer.lastTone = now;
      recordTape("ripple", 0.34 + (1 - y) * 0.42, "sine/drag");
      try { haptics.ripple(0.22 + strength * 0.25); } catch { /* noop */ }
    }
  }, [recordTape]);

  // ── gestures (the shared grammar — src/lib/gesture) ────────────────────
  // Binding `voice` switches this surface to the polyphonic dialect: every
  // finger is an independent voice on the waveform — it holds a point, the
  // wave bends through all held points, and the engine (not the room)
  // reclaims real pinches so a chord can never misread as one.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = getTimbreEngine();
    const audio = getFieldAudio();

    const toNorm = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1),
        y: clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1),
      };
    };
    const leadId = () => voicesRef.current.keys().next().value as number | undefined;
    let lastWindCueAt = 0;
    let lastScrubCueAt = 0;
    let lastVoiceHapticAt = 0;

    const detach = attachGestures(canvas, {
      voice: (e) => {
        lastGestureAtRef.current = performance.now();
        const cfg = MODES.find((item) => item.id === modeRef.current) ?? MODES[0];
        const key = `sine:${e.id}`;
        const now = performance.now();
        if (e.phase === "start") {
          void audio.start();
          const p = toNorm(e.x, e.y);
          voicesRef.current.set(e.id, {
            x: p.x, y: p.y, t0: now, moved: 0, vx: 0,
            lastX: e.x, lastY: e.y, lastT: now,
            path: [{ x: e.x, y: e.y }], scrubFired: 0,
          });
          engine.noteOn(key, hzFromY(p.y, cfg.midi), SINE_VOICE);
          if (voicesRef.current.size === 1) tuneFromPointer(e.x, e.y, 0.5 + e.intensity * 0.5);
          try { haptics.ripple(0.24 + e.intensity * 0.36); } catch { /* noop */ }
          recordTape("object", 0.3 + e.intensity * 0.35, "sine/voice");
          return;
        }
        if (e.phase === "move") {
          const v = voicesRef.current.get(e.id);
          if (!v) return;
          const p = toNorm(e.x, e.y);
          const dt = Math.max(1, now - v.lastT);
          v.vx = v.vx * 0.7 + ((e.x - v.lastX) / dt) * 0.3;
          v.moved += Math.hypot(e.x - v.lastX, e.y - v.lastY);
          v.lastX = e.x; v.lastY = e.y; v.lastT = now;
          v.x = p.x; v.y = p.y;
          const lastPt = v.path[v.path.length - 1];
          if (Math.hypot(e.x - lastPt.x, e.y - lastPt.y) > 4) {
            v.path.push({ x: e.x, y: e.y });
            if (v.path.length > 240) v.path.shift();
          }
          engine.glide(key, hzFromY(p.y, cfg.midi));
          if (e.id === leadId()) tuneFromPointer(e.x, e.y, 0.82);
          else if (now - lastVoiceHapticAt > 140) {
            lastVoiceHapticAt = now;
            try { haptics.tap(); } catch { /* noop */ }
          }
          // three voices moving the same way push the phase wind — the law
          // layer read in the polyphonic register
          const all = Array.from(voicesRef.current.values());
          if (all.length >= 3 && all.every((av) => av.moved >= THRESHOLDS.moveTolPx)) {
            const meanVx = all.reduce((acc, av) => acc + av.vx, 0) / all.length;
            const aligned = all.every((av) => av.vx * meanVx > 0);
            if (aligned && Math.abs(meanVx) > 0.08) {
              windRef.current.target = clamp(windRef.current.target + meanVx * 0.5, -1.4, 1.4);
              if (now - lastWindCueAt > 700) {
                lastWindCueAt = now;
                try { audio.playNote(38, 240); } catch { /* noop */ }
                try { haptics.chop(); } catch { /* noop */ }
                recordTape("region", 0.45, "sine/phase-wind");
              }
            }
          }
          // a circling voice is the scrub verb: it bends the frequency —
          // winding and thresholds come from gesture/core alone
          const w = pathWinding(v.path);
          if (Math.abs(w) >= THRESHOLDS.scrubWinding && Math.abs(w - v.scrubFired) >= 0.5 && now - lastScrubCueAt > 500) {
            v.scrubFired = w;
            lastScrubCueAt = now;
            const dir = Math.sign(w) || 1;
            const nextFreq = Number(clamp(freqRef.current + dir * 0.55, 0.5, 8.4).toFixed(2));
            freqRef.current = nextFreq;
            setFreq(nextFreq);
            try { audio.playNote(cfg.midi + (dir > 0 ? 12 : -7), 150); } catch { /* noop */ }
            try { haptics.ripple(0.38); } catch { /* noop */ }
            recordTape("ripple", 0.5, "sine/scrub-bend");
          }
          return;
        }
        // end or cancel — a canceled voice was a grip forming; let it go fast
        engine.noteOff(key);
        voicesRef.current.delete(e.id);
      },
      tap: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers !== 1) return; // the field absorbs frame/law taps
        const cfg = MODES.find((item) => item.id === modeRef.current) ?? MODES[0];
        const p = toNorm(e.x, e.y);
        // tap intensity is the strike: pitch weight, impulse size and the
        // haptic all ride the same 0..1 from core.
        tuneFromPointer(e.x, e.y, 0.3 + e.intensity * 0.7);
        try { audio.playNote(cfg.midi + Math.round((1 - p.y) * 22) + Math.round(p.x * 7), 90 + Math.round(e.intensity * 120)); } catch { /* noop */ }
        try { haptics.ripple(0.2 + e.intensity * 0.4); } catch { /* noop */ }
        recordTape("object", 0.3 + e.intensity * 0.35, "sine/strike");
      },
      flick: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers !== 1) return;
        // a flick throws a pulse down the wave — a comet of impulses
        const rect = canvas.getBoundingClientRect();
        const cfg = MODES.find((item) => item.id === modeRef.current) ?? MODES[0];
        const px = e.x - rect.left;
        const py = e.y - rect.top;
        const sp = Math.min(260, 90 + e.speed * 120);
        for (let i = 0; i < 6; i++) {
          impulsesRef.current.push({
            x: px + Math.cos(e.angle) * sp * (i / 5),
            y: py + Math.sin(e.angle) * sp * (i / 5) * 0.4,
            born: performance.now(),
            life: 900 + i * 160,
            strength: 0.72 - i * 0.09,
          });
        }
        if (impulsesRef.current.length > 18) impulsesRef.current = impulsesRef.current.slice(-18);
        try { audio.playNote(cfg.midi + 7, 110); } catch { /* noop */ }
        try { audio.playNote(cfg.midi + 14, 160); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("ripple", 0.55, "sine/throw");
      },
      rhythm: (e) => {
        // a steady tapped pulse: the oscillator locks to your tempo
        if (e.stability <= 0.7) return;
        entrainRef.current.bpm = Math.max(40, Math.min(150, e.bpm));
        entrainRef.current.until = performance.now() + 9000;
        recordTape("sigil", 0.5, "sine/entrain");
      },
    }, { wheelZoom: false });

    const heldVoices = voicesRef.current;
    return () => {
      detach();
      for (const id of heldVoices.keys()) engine.noteOff(`sine:${id}`);
      heldVoices.clear();
    };
  }, [recordTape, tuneFromPointer]);

  const setWaveMode = (next: WaveMode) => {
    setMode(next);
    modeRef.current = next;
    const cfg = MODES.find((item) => item.id === next) ?? MODES[0];
    try { getFieldAudio().playNote(cfg.midi + 12, 120); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("object", 0.62, `sine/mode/${next}`);
  };

  const toggleRunning = () => {
    setRunning((value) => {
      const next = !value;
      runningRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTape("sigil", next ? 0.72 : 0.42, next ? "sine/run" : "sine/rest");
      return next;
    });
  };

  return (
    <div
      ref={rootRef}
      className="sine-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--sine-tone": (MODES.find((item) => item.id === mode) ?? MODES[0]).tone } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className="sine-canvas"
        role="img"
        aria-label="a touch responsive sine wave instrument — every finger is a voice: touch holds a point on the wave and sounds a tone pitched by height. drag horizontally for frequency, vertically for amplitude."
        aria-describedby="sine-gesture-hint"
      />

      <div className="sine-title" aria-hidden="true">
        <span>sine / fundamental oscillator</span>
        <strong>Sine</strong>
      </div>

      <p id="sine-gesture-hint" className="sine-gesture-hint">
        every finger a voice · <span aria-hidden="true">↔</span> frequency · <span aria-hidden="true">↕</span> amplitude
      </p>

      <div className="sine-mode-rail" aria-label="wave modes">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            onClick={() => setWaveMode(item.id)}
            style={{ "--mode-tone": item.tone } as CSSProperties}
          >
            <i aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <label className="sine-mode-compact">
        <span>mode</span>
        <select
          aria-label="wave mode"
          value={mode}
          onChange={(event) => setWaveMode(event.target.value as WaveMode)}
        >
          {MODES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>

      <MobileInstrumentPanel
        title="oscillator tuning"
        triggerLabel="tune"
        summary={`${mode} · ${Math.round(amp)} / ${freq.toFixed(2)}`}
      >
        <div className="sine-console" aria-label="oscillator controls">
          <button type="button" className="sine-run" onClick={toggleRunning} aria-pressed={running}>
            {running ? "pause" : "play"}
          </button>
          <WaveSlider label="amp" min={20} max={156} step={1} value={amp} display={String(Math.round(amp))} onChange={(value) => { setAmp(value); ampRef.current = value; markControl("amp", value / 156); }} />
          <WaveSlider label="freq" min={0.5} max={8.4} step={0.05} value={freq} display={freq.toFixed(2)} onChange={(value) => { setFreq(value); freqRef.current = value; markControl("freq", value / 8.4); }} />
          <WaveSlider label="phase" min={0} max={6.28} step={0.01} value={phase} display={phase.toFixed(2)} onChange={(value) => { setPhase(value); phaseRef.current = value; markControl("phase", value / 6.28); }} />
          <WaveSlider label="damp" min={0} max={0.46} step={0.01} value={damping} display={damping.toFixed(2)} onChange={(value) => { setDamping(value); dampingRef.current = value; markControl("damp", value / 0.46); }} />
          <WaveSlider label="harm" min={0} max={0.84} step={0.01} value={harmonic} display={harmonic.toFixed(2)} onChange={(value) => { setHarmonic(value); harmonicRef.current = value; markControl("harm", value / 0.84); }} />
          <output className="sine-readout" aria-live="polite" aria-label={`sine readout ${readout}`}>
            {readout}
          </output>
        </div>
      </MobileInstrumentPanel>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .sine-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #070a12;
          color: rgba(246, 241, 224, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .sine-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: crosshair;
          z-index: 0;
        }

        .sine-title {
          position: fixed;
          z-index: 2;
          top: 78px;
          left: var(--pad-x);
          pointer-events: none;
        }

        .sine-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(246, 241, 224, 0.48);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0;
          text-transform: lowercase;
        }

        .sine-title strong {
          display: block;
          color: rgba(248, 244, 224, 0.96);
          font-family: var(--font-serif);
          font-size: 136px;
          font-weight: 500;
          line-height: 0.86;
        }

        .sine-gesture-hint {
          display: none;
          position: fixed;
          z-index: 2;
          left: 50%;
          bottom: 112px;
          margin: 0;
          padding: 8px 12px;
          border: 1px solid rgba(246, 241, 224, 0.13);
          border-radius: 999px;
          background: rgba(7, 10, 18, 0.42);
          color: rgba(246, 241, 224, 0.55);
          font-family: var(--font-mono);
          font-size: 10px;
          line-height: 1;
          letter-spacing: 0.02em;
          white-space: nowrap;
          pointer-events: none;
          transform: translateX(-50%);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .sine-mode-rail {
          position: fixed;
          z-index: 3;
          top: 92px;
          right: var(--pad-x);
          display: grid;
          gap: 8px;
          width: min(260px, 28vw);
          pointer-events: auto;
        }

        .sine-mode-compact { display: none; }

        .sine-mode-rail button {
          min-width: 0;
          min-height: 48px;
          display: grid;
          grid-template-columns: 30px 1fr;
          align-items: center;
          gap: 10px;
          border: 1px solid color-mix(in srgb, var(--mode-tone) 32%, transparent);
          border-radius: 8px;
          background: rgba(7, 10, 18, 0.56);
          color: rgba(246, 241, 224, 0.78);
          padding: 7px 11px;
          font-family: var(--font-mono);
          font-size: 11px;
          text-align: left;
          cursor: pointer;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .sine-mode-rail button i {
          width: 26px;
          height: 26px;
          border-radius: 999px;
          border: 1px solid var(--mode-tone);
          box-shadow: 0 0 18px color-mix(in srgb, var(--mode-tone) 32%, transparent);
        }

        .sine-mode-rail button[aria-pressed="true"] {
          background: color-mix(in srgb, var(--mode-tone) 14%, rgba(7, 10, 18, 0.60));
          color: rgba(248, 244, 224, 0.96);
        }

        .sine-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 86px repeat(5, minmax(104px, 1fr)) minmax(170px, 0.8fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(246, 241, 224, 0.13);
          border-radius: 8px;
          background: rgba(7, 10, 18, 0.62);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
          pointer-events: auto;
        }

        .sine-run,
        .sine-slider,
        .sine-readout {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(246, 241, 224, 0.12);
          border-radius: 6px;
          background: rgba(246, 241, 224, 0.055);
          color: rgba(246, 241, 224, 0.9);
        }

        .sine-run {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: lowercase;
        }

        .sine-run[aria-pressed="true"] {
          border-color: color-mix(in srgb, var(--sine-tone) 42%, transparent);
          color: var(--sine-tone);
        }

        .sine-slider {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 28px;
          gap: 4px 8px;
          align-items: center;
          padding: 7px 9px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(246, 241, 224, 0.58);
        }

        .sine-slider strong {
          color: var(--sine-tone);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }

        .sine-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: var(--sine-tone);
        }

        .sine-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--sine-tone), rgba(246, 241, 224, 0.15));
        }

        .sine-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          margin-top: -6px;
          border: 0;
          border-radius: 4px;
          background: var(--sine-tone);
          box-shadow: 0 0 14px var(--sine-tone);
          cursor: pointer;
        }

        .sine-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--sine-tone), rgba(246, 241, 224, 0.15));
        }

        .sine-slider input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: 0;
          border-radius: 4px;
          background: var(--sine-tone);
          box-shadow: 0 0 14px var(--sine-tone);
          cursor: pointer;
        }

        .sine-readout {
          display: grid;
          place-items: center;
          padding: 0 12px;
          color: rgba(246, 241, 224, 0.72);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1.2;
          text-align: center;
          word-break: break-word;
        }

        body:has(.sine-instrument) {
          background: #070a12;
          overflow: hidden;
        }

        body:has(.sine-instrument) header:not(.oda-site-header) {
          display: none !important;
        }

        body:has(.sine-instrument) .oda-field-watch,
        body:has(.sine-instrument) .oda-candle-mark,
        body:has(.sine-instrument) .oda-tape-shell,
        body:has(.sine-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .sine-mode-rail {
            top: auto;
            left: 12px;
            right: 12px;
            bottom: calc(214px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .sine-mode-rail button {
            grid-template-columns: 24px 1fr;
            min-height: 44px;
            padding: 6px 8px;
            font-size: 10px;
          }

          .sine-mode-rail button i {
            width: 22px;
            height: 22px;
          }

          .sine-console {
            left: 10px;
            right: 10px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: repeat(3, minmax(0, 1fr));
            max-height: min(42svh, 390px);
            overflow-y: auto;
          }

          .sine-readout {
            grid-column: 1 / -1;
            min-height: 42px;
          }

          .sine-title {
            top: 34px;
            left: 24px;
          }

          .sine-title strong {
            font-size: 86px;
          }
        }

        @media (max-width: 520px) {
          .sine-console {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .sine-mode-rail {
            bottom: calc(312px + env(safe-area-inset-bottom, 0px));
          }

          .sine-slider {
            min-height: 52px;
          }

          .sine-run {
            min-height: 52px;
          }

          .sine-title strong {
            font-size: 64px;
          }
        }

        @media (max-width: 720px) {
          .sine-mode-rail { display: none; }

          .sine-mode-compact {
            position: fixed;
            z-index: 122;
            right: max(14px, env(safe-area-inset-right, 0px));
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-height: 42px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            border: 1px solid color-mix(in srgb, var(--sine-tone) 42%, transparent);
            border-radius: 999px;
            padding: 0 10px 0 13px;
            background: rgba(7, 10, 18, 0.84);
            color: rgba(246, 241, 224, 0.58);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font: 9px/1 var(--font-mono);
            letter-spacing: 0.07em;
            text-transform: lowercase;
          }

          .sine-mode-compact select {
            min-height: 32px;
            border: 0;
            padding: 0 18px 0 4px;
            background: transparent;
            color: var(--sine-tone);
            font: 10px/1 var(--font-mono);
            text-transform: lowercase;
          }

          .sine-gesture-hint {
            display: block;
            top: 120px;
            bottom: auto;
            padding: 7px 10px;
            font-size: 9px;
          }

          .sine-console {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .sine-run,
          .sine-slider {
            min-height: 52px;
          }
        }
      `,
        }}
      />
    </div>
  );
}

function WaveSlider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="sine-slider">
      <span>{label}</span>
      <strong>{display}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
