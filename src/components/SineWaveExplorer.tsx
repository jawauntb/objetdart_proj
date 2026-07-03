"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
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
    const y = yCenter - waveSample(u, phase, amp, freq, damping, harmonic, mode) * height * 0.0026;
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

      if (!reduce && runningRef.current) {
        phaseRef.current = (phaseRef.current + delta * 0.0017 * (0.55 + freqRef.current * 0.18)) % (Math.PI * 2);
      }
      time += reduce ? delta * 0.00015 : delta * 0.001;
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
      drawRibbon(ctx, width, height, phaseNow, ampNow, freqNow, dampingNow, harmonicNow, modeNow, cfg.tone, center, 0.94, 4.2);

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

    if (now - pointer.lastTone > 75) {
      pointer.lastTone = now;
      const cfg = MODES.find((item) => item.id === modeRef.current) ?? MODES[0];
      try { getFieldAudio().playNote(cfg.midi + Math.round((1 - y) * 22) + Math.round(x * 7), 86); } catch { /* noop */ }
      recordTape("ripple", 0.34 + (1 - y) * 0.42, "sine/drag");
      try { haptics.ripple(0.22 + strength * 0.25); } catch { /* noop */ }
    }
  }, [recordTape]);

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
        aria-label="A touch responsive sine wave instrument"
        onPointerDown={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          pointerRef.current.active = true;
          pointerRef.current.id = event.pointerId;
          pointerRef.current.moved = 0;
          tuneFromPointer(event.clientX, event.clientY, event.pressure || 1);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const pointer = pointerRef.current;
          if (!pointer.active || pointer.id !== event.pointerId) return;
          tuneFromPointer(event.clientX, event.clientY, event.pressure > 0 ? event.pressure + 0.42 : 0.82);
        }}
        onPointerUp={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const pointer = pointerRef.current;
          if (pointer.id !== event.pointerId) return;
          pointer.active = false;
          pointer.id = -1;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        }}
        onPointerCancel={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const pointer = pointerRef.current;
          if (pointer.id !== event.pointerId) return;
          pointer.active = false;
          pointer.id = -1;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        }}
      />

      <div className="sine-title" aria-hidden="true">
        <span>sine / fundamental oscillator</span>
        <strong>Sine</strong>
      </div>

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
