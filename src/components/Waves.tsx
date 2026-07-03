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

/**
 * Waves — a wave-propagation instrument.
 *
 * A wave is a travelling disturbance. Here it is literal: a real
 * finite-difference wave equation runs on a grid (a ripple tank), so pulses
 * expand at a finite speed, reflect off the walls, and interfere into moiré.
 * Three media share the same physics:
 *   ripple      — 2D open tank, circular wavefronts
 *   string      — 1D plucked line reflecting at both ends
 *   refraction  — 2D tank with a speed gradient, so wavefronts bend
 */

type WaveMode = "ripple" | "string" | "refraction";

type ModeCfg = {
  id: WaveMode;
  label: string;
  hint: string;
  tone: string;
  midi: number;
};

const MODES: ModeCfg[] = [
  { id: "ripple", label: "ripple", hint: "open tank", tone: "#5fd4e0", midi: 48 },
  { id: "string", label: "string", hint: "plucked line", tone: "#f3d77a", midi: 55 },
  { id: "refraction", label: "refraction", hint: "bent front", tone: "#b99aff", midi: 43 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type Palette = {
  mid: [number, number, number];
  crest: [number, number, number];
  trough: [number, number, number];
  caustic: [number, number, number];
};

const PALETTES: Record<"ripple" | "refraction", Palette> = {
  ripple: {
    mid: [8, 30, 46],
    crest: [138, 228, 238],
    trough: [22, 30, 88],
    caustic: [214, 248, 255],
  },
  refraction: {
    mid: [18, 16, 40],
    crest: [190, 156, 255],
    trough: [58, 26, 96],
    caustic: [238, 228, 255],
  },
};

// Simulation state, allocated lazily on resize and never re-created per frame.
type Sim = {
  gw: number;
  gh: number;
  a: Float32Array; // current field u(t)
  b: Float32Array; // previous field u(t-1) / scratch for next
  speedFld: Float32Array; // per-cell speed multiplier (refraction)
  // 1D string
  sN: number;
  sa: Float32Array;
  sb: Float32Array;
  // offscreen grid raster
  grid: HTMLCanvasElement | null;
  gctx: CanvasRenderingContext2D | null;
  image: ImageData | null;
};

export default function Waves() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const simRef = useRef<Sim | null>(null);
  const pointerRef = useRef({ active: false, id: -1, x: 0.5, y: 0.5, lastTone: 0, moved: 0 });
  const reduceRef = useRef(false);

  const speedRef = useRef(0.34); // c^2 (Courant-stable below 0.5)
  const dampRef = useRef(0.006); // energy loss per step
  const dropRef = useRef(1.05); // impulse strength
  const runningRef = useRef(true);
  const modeRef = useRef<WaveMode>("ripple");
  const energyRef = useRef(0);
  const lastAmbient = useRef(0);
  const lastControlAt = useRef(0);

  const recordTape = useField((s) => s.recordTape);

  const [speed, setSpeed] = useState(0.34);
  const [damp, setDamp] = useState(0.006);
  const [drop, setDrop] = useState(1.05);
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<WaveMode>("ripple");
  const [readout, setReadout] = useState("ripple · c 0.34 · still");

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { dampRef.current = damp; }, [damp]);
  useEffect(() => { dropRef.current = drop; }, [drop]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = mq.matches;
    const update = () => { reduceRef.current = mq.matches; };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // ---- field helpers -------------------------------------------------------

  const clearFields = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.a.fill(0);
    sim.b.fill(0);
    sim.sa.fill(0);
    sim.sb.fill(0);
    energyRef.current = 0;
  }, []);

  // Drop a smooth circular disturbance into the 2D field at normalized (nx,ny).
  const drop2D = useCallback((nx: number, ny: number, amp: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const { gw, gh, a } = sim;
    const cx = clamp(nx, 0.02, 0.98) * gw;
    const cy = clamp(ny, 0.02, 0.98) * gh;
    const rad = Math.max(2.5, gw * 0.028);
    const sig2 = rad * rad * 0.5;
    const r0 = Math.ceil(rad * 2.4);
    const x0 = Math.max(1, Math.floor(cx - r0));
    const x1 = Math.min(gw - 2, Math.ceil(cx + r0));
    const y0 = Math.max(1, Math.floor(cy - r0));
    const y1 = Math.min(gh - 2, Math.ceil(cy + r0));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const g = Math.exp(-(dx * dx + dy * dy) / (2 * sig2));
        a[y * gw + x] += amp * g;
      }
    }
  }, []);

  // Pluck the 1D string: displace toward the pointer offset from the axis.
  const pluck1D = useCallback((nx: number, ny: number, amp: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const { sN, sa } = sim;
    const c = clamp(nx, 0.03, 0.97) * (sN - 1);
    const rad = Math.max(3, sN * 0.05);
    const sig2 = rad * rad * 0.5;
    const target = (0.5 - ny) * amp; // above axis => positive
    const r0 = Math.ceil(rad * 2.6);
    const i0 = Math.max(1, Math.floor(c - r0));
    const i1 = Math.min(sN - 2, Math.ceil(c + r0));
    for (let i = i0; i <= i1; i += 1) {
      const d = i - c;
      const g = Math.exp(-(d * d) / (2 * sig2));
      sa[i] = mix(sa[i], target, g);
    }
  }, []);

  // ---- main loop -----------------------------------------------------------

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

    const buildSim = (w: number, h: number) => {
      const aspect = w / Math.max(1, h);
      const target = 190;
      let gw: number;
      let gh: number;
      if (aspect >= 1) {
        gw = target;
        gh = clamp(Math.round(target / aspect), 90, 220);
      } else {
        gh = target;
        gw = clamp(Math.round(target * aspect), 90, 220);
      }
      const n = gw * gh;
      const sN = clamp(Math.round(w / 3), 200, 640);
      const grid = document.createElement("canvas");
      grid.width = gw;
      grid.height = gh;
      const gctx = grid.getContext("2d");
      const image = gctx ? gctx.createImageData(gw, gh) : null;
      if (image) {
        // opaque alpha up front; RGB filled per frame
        for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      }
      const speedFld = new Float32Array(n);
      for (let y = 0; y < gh; y += 1) {
        // slow band across the lower third bends fronts (refraction)
        const fy = y / gh;
        const s = 0.42 + 0.58 * (1 - clamp((fy - 0.3) / 0.6, 0, 1));
        for (let x = 0; x < gw; x += 1) speedFld[y * gw + x] = s;
      }
      simRef.current = {
        gw,
        gh,
        a: new Float32Array(n),
        b: new Float32Array(n),
        speedFld,
        sN,
        sa: new Float32Array(sN),
        sb: new Float32Array(sN),
        grid,
        gctx,
        image,
      };
    };

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(480, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildSim(width, height);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    window.addEventListener("resize", resize);

    // 2D finite-difference step. usesField => refraction speed gradient.
    const step2D = (sim: Sim, c2: number, dampFactor: number, usesField: boolean) => {
      const { gw, gh, a, b, speedFld } = sim;
      for (let y = 1; y < gh - 1; y += 1) {
        const row = y * gw;
        for (let x = 1; x < gw - 1; x += 1) {
          const i = row + x;
          const lap = a[i - 1] + a[i + 1] + a[i - gw] + a[i + gw] - 4 * a[i];
          const cc = usesField ? c2 * speedFld[i] : c2;
          b[i] = (2 * a[i] - b[i] + cc * lap) * dampFactor;
        }
      }
      // fixed edges (u=0) reflect the wavefronts back into the tank
      sim.a = b;
      sim.b = a;
    };

    const step1D = (sim: Sim, c2: number, dampFactor: number) => {
      const { sN, sa, sb } = sim;
      for (let i = 1; i < sN - 1; i += 1) {
        const lap = sa[i - 1] + sa[i + 1] - 2 * sa[i];
        sb[i] = (2 * sa[i] - sb[i] + c2 * lap) * dampFactor;
      }
      sim.sa = sb;
      sim.sb = sa;
    };

    const renderField = (sim: Sim, m: "ripple" | "refraction", glow: number) => {
      const { gw, gh, a, image, gctx, grid } = sim;
      if (!image || !gctx || !grid) return;
      const data = image.data;
      const pal = PALETTES[m];
      const [mr, mg, mb] = pal.mid;
      const [cr, cg, cb] = pal.crest;
      const [tr, tg, tb] = pal.trough;
      const [xr, xg, xb] = pal.caustic;
      const hScale = 2.3;
      const causScale = 3.6;
      for (let y = 0; y < gh; y += 1) {
        const row = y * gw;
        for (let x = 0; x < gw; x += 1) {
          const i = row + x;
          const h = a[i];
          const xl = x > 0 ? a[i - 1] : h;
          const xrr = x < gw - 1 ? a[i + 1] : h;
          const yt = y > 0 ? a[i - gw] : h;
          const yb = y < gh - 1 ? a[i + gw] : h;
          const sx = xrr - xl;
          const sy = yb - yt;
          const slope = Math.sqrt(sx * sx + sy * sy);
          const t = clamp(h * hScale, -1, 1);
          let r: number;
          let g: number;
          let bl: number;
          if (t >= 0) {
            r = mr + (cr - mr) * t;
            g = mg + (cg - mg) * t;
            bl = mb + (cb - mb) * t;
          } else {
            const f = -t;
            r = mr + (tr - mr) * f;
            g = mg + (tg - mg) * f;
            bl = mb + (tb - mb) * f;
          }
          let caus = clamp(slope * causScale, 0, 1);
          caus *= caus;
          const cg2 = caus * (0.55 + glow * 0.5);
          r += (xr - r) * cg2 * 0.9;
          g += (xg - g) * cg2 * 0.9;
          bl += (xb - bl) * cg2 * 0.9;
          const p = i * 4;
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = bl;
        }
      }
      gctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(grid, 0, 0, gw, gh, 0, 0, width, height);
    };

    const renderString = (sim: Sim, tone: string, glow: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#05070f");
      bg.addColorStop(0.5, "#0a1420");
      bg.addColorStop(1, "#080610");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const { sN, sa } = sim;
      const center = height * 0.52;
      const amp = height * 0.26;
      const left = width * 0.06;
      const usable = width * 0.88;

      // axis
      ctx.save();
      ctx.strokeStyle = "rgba(238,234,219,0.10)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 12]);
      ctx.beginPath();
      ctx.moveTo(left, center);
      ctx.lineTo(left + usable, center);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const pathAt = (mult: number) => {
        ctx.beginPath();
        for (let i = 0; i < sN; i += 1) {
          const u = i / (sN - 1);
          const x = left + usable * u;
          const y = center - sa[i] * amp * mult;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // reflection halo
      ctx.strokeStyle = colorAlpha(tone, 0.16 + glow * 0.12);
      ctx.lineWidth = 9;
      pathAt(1);
      ctx.stroke();
      // core line
      ctx.strokeStyle = colorAlpha(tone, 0.95);
      ctx.lineWidth = 2.4;
      pathAt(1);
      ctx.stroke();
      ctx.restore();

      // endpoints (fixed nodes where reflection happens)
      for (const nx of [0, 1]) {
        const x = left + usable * nx;
        ctx.fillStyle = colorAlpha(tone, 0.8);
        ctx.beginPath();
        ctx.arc(x, center, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colorAlpha(tone, 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, center, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const draw = (now: number) => {
      last = now;
      const sim = simRef.current;
      if (!sim) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const reduce = reduceRef.current;
      const m = modeRef.current;
      const cfg = MODES.find((it) => it.id === m) ?? MODES[0];
      const isRunning = runningRef.current;
      const c2 = speedRef.current;
      const dampFactor = 1 - dampRef.current;
      const pointer = pointerRef.current;

      energyRef.current = mix(energyRef.current, pointer.active ? 1 : 0, pointer.active ? 0.14 : 0.03);
      const glow = energyRef.current;

      // sparse ambient life so the medium is never dead (not when reduced)
      if (isRunning && !reduce && !pointer.active && now - lastAmbient.current > 3200) {
        lastAmbient.current = now;
        if (m === "string") pluck1D(0.2 + Math.random() * 0.6, 0.5 - (Math.random() * 0.16 + 0.05), 0.35);
        else drop2D(Math.random(), Math.random() * 0.9 + 0.05, 0.35);
      }

      const substeps = isRunning ? (reduce ? 1 : 2) : 0;
      for (let s = 0; s < substeps; s += 1) {
        if (m === "string") step1D(sim, c2, dampFactor);
        else step2D(sim, c2, dampFactor, m === "refraction");
      }

      if (m === "string") {
        renderString(sim, cfg.tone, glow);
      } else {
        renderField(sim, m, glow);
        if (m === "refraction") {
          // faint marker of the slow medium boundary
          const gy = height * 0.6;
          const grad = ctx.createLinearGradient(0, gy - 40, 0, gy + 40);
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(0.5, colorAlpha(cfg.tone, 0.05));
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, gy - 40, width, 80);
        }
      }

      // vignette
      const vg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.3,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.72,
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [drop2D, pluck1D]);

  // ---- interaction ---------------------------------------------------------

  const disturb = useCallback((clientX: number, clientY: number, strength: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const ny = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const pointer = pointerRef.current;
    pointer.moved += Math.hypot(nx - pointer.x, ny - pointer.y);
    pointer.x = nx;
    pointer.y = ny;

    const m = modeRef.current;
    const amp = dropRef.current * (0.5 + strength * 0.7);
    if (m === "string") pluck1D(nx, ny, amp);
    else drop2D(nx, ny, amp);

    const now = performance.now();
    if (now - pointer.lastTone > 82) {
      pointer.lastTone = now;
      const cfg = MODES.find((it) => it.id === m) ?? MODES[0];
      const speedShift = Math.round(speedRef.current * 12);
      const midi = cfg.midi + Math.round((1 - ny) * 24) + Math.round(nx * 5) + speedShift;
      try { getFieldAudio().playNote(midi, 90); } catch { /* noop */ }
      try { haptics.ripple(0.24 + strength * 0.3); } catch { /* noop */ }
      recordTape("ripple", clamp(0.32 + (1 - ny) * 0.4 + strength * 0.2, 0, 1), `waves/${m}`);
      setReadout(`${m} · c ${speedRef.current.toFixed(2)} · flowing`);
    }
  }, [drop2D, pluck1D, recordTape]);

  const markControl = useCallback((meta: string, intensity: number) => {
    const now = performance.now();
    if (now - lastControlAt.current < 100) return;
    lastControlAt.current = now;
    const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];
    try { getFieldAudio().playNote(cfg.midi + 12 + Math.round(intensity * 20), 80); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("sigil", 0.26 + intensity * 0.44, `waves/${meta}`);
  }, [recordTape]);

  const setWaveMode = (next: WaveMode) => {
    if (next === modeRef.current) return;
    setMode(next);
    modeRef.current = next;
    clearFields();
    const cfg = MODES.find((it) => it.id === next) ?? MODES[0];
    setReadout(`${next} · c ${speedRef.current.toFixed(2)} · still`);
    try { getFieldAudio().playNote(cfg.midi + 12, 130); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    recordTape("object", 0.62, `waves/mode/${next}`);
  };

  const toggleRunning = () => {
    setRunning((v) => {
      const next = !v;
      runningRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTape("sigil", next ? 0.7 : 0.4, next ? "waves/run" : "waves/still");
      return next;
    });
  };

  const stillTank = () => {
    clearFields();
    setReadout(`${modeRef.current} · c ${speedRef.current.toFixed(2)} · still`);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.chop(); } catch { /* noop */ }
    recordTape("concern", 0.5, "waves/still");
  };

  const activeTone = (MODES.find((it) => it.id === mode) ?? MODES[0]).tone;

  return (
    <div
      ref={rootRef}
      className="waves-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--wave-tone": activeTone } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className="waves-canvas"
        role="img"
        aria-label="A touch responsive wave propagation instrument. Touch to send travelling pulses that reflect and interfere."
        onPointerDown={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          pointerRef.current.active = true;
          pointerRef.current.id = event.pointerId;
          pointerRef.current.moved = 0;
          disturb(event.clientX, event.clientY, event.pressure || 1);
          try { haptics.tap(); } catch { /* noop */ }
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const pointer = pointerRef.current;
          if (!pointer.active || pointer.id !== event.pointerId) return;
          disturb(event.clientX, event.clientY, event.pressure > 0 ? event.pressure + 0.35 : 0.8);
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

      <div className="waves-title" aria-hidden="true">
        <span>waves / travelling disturbance</span>
        <strong>Waves</strong>
      </div>

      <div className="waves-mode-rail" aria-label="wave media">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            onClick={() => setWaveMode(item.id)}
            style={{ "--mode-tone": item.tone } as CSSProperties}
          >
            <i aria-hidden="true" />
            <span>
              <b>{item.label}</b>
              <em>{item.hint}</em>
            </span>
          </button>
        ))}
      </div>

      <div className="waves-console" aria-label="propagation controls">
        <button type="button" className="waves-btn" onClick={toggleRunning} aria-pressed={running}>
          {running ? "pause" : "play"}
        </button>
        <WaveSlider
          label="speed"
          min={0.14}
          max={0.5}
          step={0.01}
          value={speed}
          display={speed.toFixed(2)}
          onChange={(v) => { setSpeed(v); speedRef.current = v; markControl("speed", (v - 0.14) / 0.36); }}
        />
        <WaveSlider
          label="damp"
          min={0}
          max={0.03}
          step={0.001}
          value={damp}
          display={damp.toFixed(3)}
          onChange={(v) => { setDamp(v); dampRef.current = v; markControl("damp", v / 0.03); }}
        />
        <WaveSlider
          label="drop"
          min={0.3}
          max={2}
          step={0.05}
          value={drop}
          display={drop.toFixed(2)}
          onChange={(v) => { setDrop(v); dropRef.current = v; markControl("drop", (v - 0.3) / 1.7); }}
        />
        <button type="button" className="waves-btn" onClick={stillTank}>
          still
        </button>
        <output className="waves-readout" aria-live="polite" aria-label={`wave readout ${readout}`}>
          {readout}
        </output>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .waves-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #04070d;
          color: rgba(246, 241, 224, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .waves-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: crosshair;
          z-index: 0;
        }

        .waves-title {
          position: fixed;
          z-index: 2;
          top: 78px;
          left: var(--pad-x);
          pointer-events: none;
        }

        .waves-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(246, 241, 224, 0.48);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }

        .waves-title strong {
          display: block;
          color: rgba(248, 244, 224, 0.96);
          font-family: var(--font-serif);
          font-size: 136px;
          font-weight: 500;
          line-height: 0.86;
          text-shadow: 0 0 44px color-mix(in srgb, var(--wave-tone) 30%, transparent);
        }

        .waves-mode-rail {
          position: fixed;
          z-index: 3;
          top: 92px;
          right: var(--pad-x);
          display: grid;
          gap: 8px;
          width: min(264px, 30vw);
          pointer-events: auto;
        }

        .waves-mode-rail button {
          min-width: 0;
          min-height: 52px;
          display: grid;
          grid-template-columns: 30px 1fr;
          align-items: center;
          gap: 11px;
          border: 1px solid color-mix(in srgb, var(--mode-tone) 32%, transparent);
          border-radius: 8px;
          background: rgba(5, 8, 15, 0.56);
          color: rgba(246, 241, 224, 0.78);
          padding: 7px 11px;
          text-align: left;
          cursor: pointer;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .waves-mode-rail button i {
          width: 26px;
          height: 26px;
          border-radius: 999px;
          border: 1px solid var(--mode-tone);
          box-shadow: 0 0 18px color-mix(in srgb, var(--mode-tone) 34%, transparent);
        }

        .waves-mode-rail button span {
          display: grid;
          gap: 2px;
        }

        .waves-mode-rail button b {
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        .waves-mode-rail button em {
          font-family: var(--font-mono);
          font-size: 10px;
          font-style: normal;
          color: rgba(246, 241, 224, 0.42);
        }

        .waves-mode-rail button[aria-pressed="true"] {
          background: color-mix(in srgb, var(--mode-tone) 15%, rgba(5, 8, 15, 0.6));
          color: rgba(248, 244, 224, 0.96);
        }

        .waves-mode-rail button[aria-pressed="true"] i {
          background: color-mix(in srgb, var(--mode-tone) 60%, transparent);
        }

        .waves-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 82px repeat(3, minmax(112px, 1fr)) 82px minmax(160px, 0.8fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(246, 241, 224, 0.13);
          border-radius: 8px;
          background: rgba(5, 8, 15, 0.62);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
        }

        .waves-btn,
        .waves-slider,
        .waves-readout {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(246, 241, 224, 0.12);
          border-radius: 6px;
          background: rgba(246, 241, 224, 0.055);
          color: rgba(246, 241, 224, 0.9);
        }

        .waves-btn {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: lowercase;
        }

        .waves-btn[aria-pressed="true"] {
          border-color: color-mix(in srgb, var(--wave-tone) 42%, transparent);
          color: var(--wave-tone);
        }

        .waves-slider {
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

        .waves-slider strong {
          color: var(--wave-tone);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }

        .waves-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: var(--wave-tone);
        }

        .waves-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--wave-tone), rgba(246, 241, 224, 0.15));
        }

        .waves-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          margin-top: -6px;
          border: 0;
          border-radius: 4px;
          background: var(--wave-tone);
          box-shadow: 0 0 14px var(--wave-tone);
          cursor: pointer;
        }

        .waves-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--wave-tone), rgba(246, 241, 224, 0.15));
        }

        .waves-slider input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: 0;
          border-radius: 4px;
          background: var(--wave-tone);
          box-shadow: 0 0 14px var(--wave-tone);
          cursor: pointer;
        }

        .waves-readout {
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

        body:has(.waves-instrument) {
          background: #04070d;
          overflow: hidden;
        }

        body:has(.waves-instrument) header:not(.oda-site-header) {
          display: none !important;
        }

        body:has(.waves-instrument) .oda-field-watch,
        body:has(.waves-instrument) .oda-candle-mark,
        body:has(.waves-instrument) .oda-tape-shell,
        body:has(.waves-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .waves-mode-rail {
            top: auto;
            left: 12px;
            right: 12px;
            bottom: calc(214px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .waves-mode-rail button {
            grid-template-columns: 22px 1fr;
            min-height: 46px;
            padding: 6px 8px;
            gap: 8px;
          }

          .waves-mode-rail button i {
            width: 20px;
            height: 20px;
          }

          .waves-mode-rail button em {
            display: none;
          }

          .waves-console {
            left: 10px;
            right: 10px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: repeat(3, minmax(0, 1fr));
            max-height: min(42svh, 380px);
            overflow-y: auto;
          }

          .waves-readout {
            grid-column: 1 / -1;
            min-height: 42px;
          }

          .waves-title {
            top: 34px;
            left: 24px;
          }

          .waves-title strong {
            font-size: 84px;
          }
        }

        @media (max-width: 520px) {
          .waves-console {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .waves-mode-rail {
            bottom: calc(300px + env(safe-area-inset-bottom, 0px));
          }

          .waves-slider,
          .waves-btn {
            min-height: 52px;
          }

          .waves-title strong {
            font-size: 62px;
          }
        }
      `,
        }}
      />
    </div>
  );
}

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    <label className="waves-slider">
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
