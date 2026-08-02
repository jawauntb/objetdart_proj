"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, THRESHOLDS } from "@/lib/gesture";
import { useField } from "@/store/field";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import {
  addNatural as worldAddNatural,
  commitZone as worldCommitZone,
  getNaturalsInZone,
  subscribeNaturals,
  type WorldKind,
  type WorldNatural,
} from "@/lib/world";

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

  // Ambient audio bed: phasey stereo swell + soft clicks. Kept alongside
  // the /stars pattern so the pond is never acoustically dead on arrival.
  useEffect(() => {
    try { getFieldAudio().setAmbientProfile("waves"); } catch { /* noop */ }
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

    // ── persistent naturals ─────────────────────────────────────────
    // Things the pond carries between visits: lily pads, fallen leaves,
    // and (rarely) a koi drifting under the surface. They advance their
    // position by elapsed real time on load (cap 12h) so the pond has
    // been *doing something* while the user was away. Nothing man-made.
    // Positions are normalized to survive resize.
    // Persistent pond life (from the shared world). Lily pads, fallen
    // leaves, and rare koi live in the shared pool (src/lib/world.ts) so a
    // leaf placed here can wash into /ocean over time. Rotation is derived
    // from seed at render time; vertical downstream drift dropped now that
    // migration between pages is the main long-term travel.
    type NaturalKind = Extract<WorldKind, "lily" | "leaf" | "koi">;
    const vxForKind = (kind: NaturalKind): number =>
      kind === "leaf" ? 0.024
      : kind === "koi" ? 0.014
      : 0.004;
    let naturals: WorldNatural[] = getNaturalsInZone("waves");
    const unsubscribeWorld = subscribeNaturals(() => {
      naturals = getNaturalsInZone("waves");
    });
    const addNatural = (kind: NaturalKind, nx?: number, ny?: number) => {
      const finalNx = nx != null ? clamp(nx, 0.04, 0.96) : Math.random();
      const finalNy = ny != null ? clamp(ny, 0.10, 0.94) : 0.2 + Math.random() * 0.7;
      const created = worldAddNatural(kind, "waves", finalNx, finalNy, vxForKind(kind));
      naturals = getNaturalsInZone("waves");
      return created;
    };
    const persistNaturals = () => {
      worldCommitZone("waves", naturals);
    };

    // ── weather events (autonomic, transient) ───────────────────────
    // Every 9-17s a jittered scheduler fires one of six natural events:
    // a falling leaf, a dragonfly hover, a wind gust, a frog jump, a
    // water strider crossing, or (rare) a koi surfacing. Pattern
    // borrowed from Stars.tsx cosmic weather / Ocean.tsx so the pond
    // feels like a place, not just an instrument. Only fires in ripple
    // mode — string and refraction stay analytic.
    type WeatherEvent =
      | { kind: "leaf"; t0: number; duration: number; startX: number; startY: number; endX: number; endY: number; rot0: number; spin: number; landed: boolean; nat: WorldNatural | null }
      | { kind: "dragonfly"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number; lastDip: number }
      | { kind: "wind"; t0: number; duration: number; dir: number; band: number; lastEmit: number }
      | { kind: "frog"; t0: number; duration: number; x: number; y: number }
      | { kind: "strider"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number; lastStep: number }
      | { kind: "koi"; t0: number; duration: number; x: number; y: number; dir: number; splashed: boolean; nat: WorldNatural | null };
    const weather: WeatherEvent[] = [];
    const addWeather = (e: WeatherEvent) => {
      weather.push(e);
      if (weather.length > 8) weather.shift();
    };

    const spawnFallingLeaf = () => {
      const startX = 0.1 + Math.random() * 0.8;
      const startY = -0.06;
      const endX = clamp(startX + (Math.random() - 0.5) * 0.35, 0.08, 0.92);
      const endY = 0.35 + Math.random() * 0.5;
      addWeather({
        kind: "leaf",
        t0: performance.now(),
        duration: 4.8 + Math.random() * 1.4,
        startX, startY, endX, endY,
        rot0: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 4,
        landed: false,
        nat: null,
      });
    };
    const spawnDragonfly = () => {
      const y = 0.15 + Math.random() * 0.7;
      const dir = Math.random() < 0.5 ? 1 : -1;
      addWeather({
        kind: "dragonfly",
        t0: performance.now(),
        duration: 6 + Math.random() * 2,
        ax: dir > 0 ? -0.05 : 1.05,
        ay: y,
        bx: dir > 0 ? 1.05 : -0.05,
        by: clamp(y + (Math.random() - 0.5) * 0.25, 0.1, 0.85),
        lastDip: 0,
      });
    };
    const spawnWindGust = () => {
      const dir = Math.random() < 0.5 ? 1 : -1;
      addWeather({
        kind: "wind",
        t0: performance.now(),
        duration: 4.0,
        dir,
        band: 0.2 + Math.random() * 0.6,
        lastEmit: 0,
      });
    };
    const spawnFrogJump = () => {
      const x = 0.12 + Math.random() * 0.76;
      const y = 0.15 + Math.random() * 0.7;
      drop2D(x, y, 2.4); // bigger than a tap
      addWeather({
        kind: "frog",
        t0: performance.now(),
        duration: 1.4,
        x, y,
      });
      // audio.ts has no bloop — chime is the friendliest fallback.
      try { getFieldAudio().playTone(140, 0.35); } catch { /* noop */ }
      try { getFieldAudio().chime(); } catch { /* noop */ }
    };
    const spawnStrider = () => {
      const y = 0.2 + Math.random() * 0.6;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const arc = 0.22 + Math.random() * 0.18;
      addWeather({
        kind: "strider",
        t0: performance.now(),
        duration: 5.5,
        ax: dir > 0 ? 0.1 : 0.9,
        ay: y,
        bx: dir > 0 ? 0.1 + arc : 0.9 - arc,
        by: clamp(y + (Math.random() - 0.5) * 0.12, 0.15, 0.85),
        lastStep: 0,
      });
    };
    const spawnKoiSurface = () => {
      const x = 0.15 + Math.random() * 0.7;
      const y = 0.25 + Math.random() * 0.55;
      const dir = Math.random() < 0.5 ? 1 : -1;
      addWeather({
        kind: "koi",
        t0: performance.now(),
        duration: 3.6,
        x, y, dir,
        splashed: false,
        nat: null,
      });
      try { getFieldAudio().playTone(160, 0.5); } catch { /* noop */ }
    };

    let weatherTimer: ReturnType<typeof setTimeout> | 0 = 0;
    const fireWeather = () => {
      // Only stir the pond when the user is here and in ripple mode.
      // string / refraction stay untouched analytical instruments.
      if (!document.hidden && modeRef.current === "ripple" && runningRef.current) {
        const roll = Math.random();
        // weighted: leaf 25, dragonfly 22, wind 18, frog 16, strider 12, koi 7
        if (roll < 0.25) spawnFallingLeaf();
        else if (roll < 0.47) spawnDragonfly();
        else if (roll < 0.65) spawnWindGust();
        else if (roll < 0.81) spawnFrogJump();
        else if (roll < 0.93) spawnStrider();
        else spawnKoiSurface();
      }
      weatherTimer = setTimeout(fireWeather, 9000 + Math.random() * 8000);
    };
    weatherTimer = setTimeout(fireWeather, 3500 + Math.random() * 4000);

    // ── gestures (the shared grammar — src/lib/gesture) ─────────────
    // One finger touches the water: taps and strokes disturb the field.
    // Two-finger pinch is left to the scale manifold on document.body
    // (wave speed keeps its slider). Three fingers touch the law: a drag
    // is wind, a hold dilates time. Dwell plants; the ceremony hold is a
    // koi taking residence. All thresholds live in gesture/core.
    const holdPlant = { lily: false, leaf: false, koi: false };
    let timeScale = 1;
    let timeScaleTarget = 1;
    let stepAcc = 0;
    let entrainInterval = 3200;
    let entrainUntil = 0;
    let lastGestureAt = performance.now();
    let lastGlimmerAt = 0;
    let glimmerStep = 0;
    let lastWindFxAt = 0;
    let lastWindToneAt = 0;
    let lastScrubAt = 0;
    const detachGestures = attachGestures(canvas, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers !== 1) return; // the tank absorbs frame/law taps
        energyRef.current = Math.min(1, energyRef.current + 0.35);
        // tap intensity is the drop: amplitude rides the same 0..1
        disturb(e.x, e.y, 0.35 + e.intensity * 0.9);
        try { haptics.tap(); } catch { /* noop */ }
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: a hand-driven gust marches a
          // bar of tiny plucks across the tank (and rocks the string)
          const rect = canvas.getBoundingClientRect();
          const nx = clamp((e.x - rect.left) / Math.max(1, rect.width), 0.02, 0.98);
          const ny = clamp((e.y - rect.top) / Math.max(1, rect.height), 0.05, 0.95);
          const nowMs = performance.now();
          if (modeRef.current === "string") {
            if (nowMs - lastWindFxAt > 90) {
              lastWindFxAt = nowMs;
              pluck1D(nx, 0.5 - clamp(e.vx, -1, 1) * 0.08, 0.3);
            }
          } else if (nowMs - lastWindFxAt > 80) {
            lastWindFxAt = nowMs;
            for (let r = -1; r <= 1; r++) {
              const y2 = ny + r * 0.03;
              if (y2 > 0 && y2 < 1) drop2D(nx, y2, 0.2);
            }
          }
          if (nowMs - lastWindToneAt > 420) {
            lastWindToneAt = nowMs;
            const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];
            try { getFieldAudio().playNote(cfg.midi - 5, 200); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          pointerRef.current.active = true;
          disturb(e.x, e.y, 0.6);
          return;
        }
        if (e.phase === "end") {
          pointerRef.current.active = false;
          return;
        }
        disturb(e.x, e.y, clamp(0.5 + Math.hypot(e.vx, e.vy) * 0.45, 0.5, 1.15));
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the medium runs at ~1/4 speed
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            try { getFieldAudio().playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdPlant.lily = false;
          holdPlant.leaf = false;
          holdPlant.koi = false;
          pointerRef.current.active = true;
          return;
        }
        if (e.phase === "release") {
          pointerRef.current.active = false;
          return;
        }
        if (modeRef.current !== "ripple") return; // the analytic media absorb the dwell
        const rect = canvas.getBoundingClientRect();
        const nx = (e.x - rect.left) / Math.max(1, rect.width);
        const ny = (e.y - rect.top) / Math.max(1, rect.height);
        // dwell plants a lily; kept longer, a fallen leaf; held to the
        // ceremony, a koi takes residence under the hand.
        if (e.tier >= 2 && !holdPlant.lily) {
          holdPlant.lily = true;
          addNatural("lily", nx, ny);
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.ripple(0.6); } catch { /* noop */ }
        }
        if (e.elapsed >= (THRESHOLDS.dwellMs + THRESHOLDS.ceremonyMs) / 2 && !holdPlant.leaf) {
          holdPlant.leaf = true;
          addNatural("leaf", nx, ny);
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
        }
        if (e.tier >= 3 && !holdPlant.koi) {
          holdPlant.koi = true;
          addNatural("koi", nx, ny);
          drop2D(nx, ny, 1.2);
          try { getFieldAudio().playTone(160, 0.6); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
        }
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        if (modeRef.current === "string") return;
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 700) return;
        lastScrubAt = nowMs;
        const rect = canvas.getBoundingClientRect();
        const cx = (e.cx - rect.left) / Math.max(1, rect.width);
        const cy = (e.cy - rect.top) / Math.max(1, rect.height);
        const sgn = Math.sign(e.winding) || 1;
        // stir: a ring of displacements interferes into a turning current,
        // and nearby floaters ride the gyre
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const rx = cx + Math.cos(a) * 0.05;
          const ry = cy + Math.sin(a) * 0.05;
          if (rx > 0 && rx < 1 && ry > 0 && ry < 1) drop2D(rx, ry, 0.32);
        }
        for (const n of naturals) {
          const d = Math.hypot(n.nx - cx, n.ny - cy);
          if (d < 0.2) n.nx = clamp(n.nx + sgn * 0.02 * (1 - d / 0.2), 0.02, 0.98);
        }
        const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];
        try { getFieldAudio().playNote(cfg.midi + 7, 150); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
      },
      rhythm: (e) => {
        // a steady tapped pulse: the pond's ambient life falls in with it
        if (e.stability <= 0.7) return;
        entrainInterval = Math.max(500, Math.min(2400, 60000 / e.bpm));
        entrainUntil = performance.now() + 9000;
      },
    }, { wheelZoom: false });

    // ── backdrop & natural rendering helpers ────────────────────────
    // Paint a paper-warm to slate gradient behind the water and a soft
    // horizon mist across the top so the pond reads as a place with a
    // far shore instead of just a top-down grid.
    const drawBackdrop = (w: number, h: number) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0.00, "rgba(226, 214, 186, 1)"); // warm paper
      sky.addColorStop(0.14, "rgba(178, 172, 168, 1)"); // haze
      sky.addColorStop(0.32, "rgba( 74,  92, 108, 1)"); // slate
      sky.addColorStop(1.00, "rgba(  8,  18,  30, 1)"); // deep pond
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
    };
    const drawHorizon = (w: number, h: number) => {
      const horizonY = h * 0.14;
      const mist = ctx.createLinearGradient(0, 0, 0, horizonY + 42);
      mist.addColorStop(0.0, "rgba(226, 214, 186, 0.86)");
      mist.addColorStop(0.7, "rgba(180, 174, 164, 0.28)");
      mist.addColorStop(1.0, "rgba(180, 174, 164, 0.0)");
      ctx.fillStyle = mist;
      ctx.fillRect(0, 0, w, horizonY + 42);
      // a barely-there horizon line
      ctx.strokeStyle = "rgba(232, 220, 194, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(w, horizonY);
      ctx.stroke();
    };

    let lastNaturalsSaveAt = performance.now();
    let prevDrawSec = performance.now() / 1000;

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
      const ambientEvery = performance.now() < entrainUntil ? entrainInterval : 3200;
      if (isRunning && !reduce && !pointer.active && now - lastAmbient.current > ambientEvery) {
        lastAmbient.current = now;
        if (m === "string") pluck1D(0.2 + Math.random() * 0.6, 0.5 - (Math.random() * 0.16 + 0.05), 0.35);
        else drop2D(Math.random(), Math.random() * 0.9 + 0.05, 0.35);
      }

      // ── tick weather (may inject displacement into the sim BEFORE
      //    the step, so the ripples read at the current frame) ───────
      const nowSec = now / 1000;
      const dt = Math.min(0.06, Math.max(0, nowSec - prevDrawSec));
      prevDrawSec = nowSec;
      if (m === "ripple") {
        for (let i = weather.length - 1; i >= 0; i--) {
          const e = weather[i];
          const age = (now - e.t0) / 1000;
          if (age >= e.duration) { weather.splice(i, 1); continue; }
          if (e.kind === "leaf") {
            const f = clamp(age / e.duration, 0, 1);
            if (!e.landed && f > 0.92) {
              e.landed = true;
              // touch-down pluck + persistent leaf at landing spot
              drop2D(e.endX, e.endY, 1.4);
              e.nat = addNatural("leaf", e.endX, e.endY);
              try { getFieldAudio().playTone(220, 0.28); } catch { /* noop */ }
            }
          } else if (e.kind === "dragonfly") {
            // dip every 900-1400ms while crossing
            if (age - e.lastDip > 0.9 + Math.random() * 0.5) {
              e.lastDip = age;
              const f = clamp(age / e.duration, 0, 1);
              const dx = e.ax + (e.bx - e.ax) * f;
              const dy = e.ay + (e.by - e.ay) * f + Math.sin(age * 3) * 0.02;
              if (dx > 0 && dx < 1 && dy > 0 && dy < 1) drop2D(dx, dy, 0.28);
            }
          } else if (e.kind === "wind") {
            // step a bar of tiny pluck sources across the field
            const f = clamp(age / e.duration, 0, 1);
            const xLead = e.dir > 0 ? f : 1 - f;
            if (age - e.lastEmit > 0.08) {
              e.lastEmit = age;
              const rows = 3;
              for (let r0 = 0; r0 < rows; r0++) {
                const y = e.band + (r0 - 1) * 0.03;
                if (y > 0 && y < 1) drop2D(clamp(xLead, 0.02, 0.98), y, 0.18);
              }
            }
          } else if (e.kind === "koi") {
            const f = clamp(age / e.duration, 0, 1);
            if (!e.splashed && f > 0.35 && f < 0.42) {
              e.splashed = true;
              drop2D(e.x, e.y, 1.6);
              e.nat = addNatural("koi", e.x, e.y);
              try { getFieldAudio().playTone(120, 0.4); } catch { /* noop */ }
            }
          }
          // strider intentionally leaves NO ripples — only visible dimples
        }
      }

      // three-finger time dilation: fractional substeps accumulate so the
      // medium itself runs slow while the law is held
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      stepAcc += (isRunning ? (reduce ? 1 : 2) : 0) * timeScale;
      const substeps = Math.floor(stepAcc);
      stepAcc -= substeps;
      for (let s = 0; s < substeps; s += 1) {
        if (m === "string") step1D(sim, c2, dampFactor);
        else step2D(sim, c2, dampFactor, m === "refraction");
      }

      if (m === "string") {
        renderString(sim, cfg.tone, glow);
      } else {
        if (m === "ripple") drawBackdrop(width, height);
        renderField(sim, m, glow);
        if (m === "ripple") {
          drawHorizon(width, height);
          // drift + draw persistent naturals on the pond
          if (naturals.length > 0) {
            for (const n of naturals) {
              if (dt > 0) {
                let nx = n.nx + n.vx * (dt / 3600);
                nx = ((nx % 1) + 1) % 1;
                n.nx = nx;
              }
              const sx = n.nx * width;
              const sy = n.ny * height;
              const bob = Math.sin(nowSec * 1.2 + n.seed * 0.001) * 1.4;
              // rot derived from seed (WorldNatural has no rot field —
              // deterministic from seed keeps each leaf's cant stable
              // across reloads without persisting the extra number).
              const rot = ((n.seed % 6283) / 1000);
              if (n.kind === "lily") drawLilyPad(ctx, sx, sy + bob, 18 + (n.seed & 15), n.seed);
              else if (n.kind === "leaf") drawFallenLeaf(ctx, sx, sy + bob, 10 + (n.seed & 7), rot + nowSec * 0.05, n.seed);
              else if (n.kind === "koi") drawKoiShadow(ctx, sx, sy, 28 + (n.seed & 15), nowSec, n.seed);
            }
          }
          // draw weather overlays after the naturals so they read on top
          drawWeatherOverlay(ctx, weather, now, nowSec, width, height);
          // glimmer (§6): after ~20s of quiet the water itself sketches a
          // small circle of dimples where a scrub would land — never text.
          if (isRunning && performance.now() - lastGestureAt > 20000 && now - lastGlimmerAt > 2600) {
            lastGlimmerAt = now;
            const slot = Math.floor(now / 9000);
            const g1 = Math.abs(Math.sin(slot * 127.1) * 43758.5453) % 1;
            const g2 = Math.abs(Math.sin(slot * 311.7) * 43758.5453) % 1;
            const gx = 0.2 + g1 * 0.6;
            const gy = 0.25 + g2 * 0.5;
            glimmerStep = (glimmerStep + 1) % 6;
            const ga = (glimmerStep / 6) * Math.PI * 2;
            drop2D(gx + Math.cos(ga) * 0.045, gy + Math.sin(ga) * 0.045, 0.1);
          }
        }
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

      // periodic naturals persistence — visible drift is applied per frame,
      // this makes sure the mutations get written before unmount races.
      if (naturals.length > 0 && now - lastNaturalsSaveAt > 4000) {
        lastNaturalsSaveAt = now;
        persistNaturals();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      if (weatherTimer) clearTimeout(weatherTimer);
      // final checkpoint so re-entry advances drift from now.
      persistNaturals();
      unsubscribeWorld();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      detachGestures();
    };
  }, [disturb, drop2D, pluck1D]);

  // ---- interaction ---------------------------------------------------------

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

      <label className="waves-mode-compact">
        <span>medium</span>
        <select
          aria-label="wave medium"
          value={mode}
          onChange={(event) => setWaveMode(event.target.value as WaveMode)}
        >
          {MODES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>

      <span className="waves-play-hint" aria-hidden="true">tap or drag · rest to plant</span>

      <MobileInstrumentPanel
        className="waves-mobile-panel"
        title="propagation"
        triggerLabel="tune"
        summary={readout}
      >
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
      </MobileInstrumentPanel>

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

        .waves-mode-compact,
        .waves-play-hint { display: none; }

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

        @media (max-width: 720px) {
          .waves-mode-rail { display: none; }
          .waves-mode-compact {
            position: fixed;
            z-index: 5;
            right: 14px;
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-height: 42px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            border: 1px solid color-mix(in srgb, var(--wave-tone) 42%, transparent);
            border-radius: 999px;
            padding: 0 10px 0 13px;
            background: rgba(5, 8, 15, 0.82);
            color: rgba(246, 241, 224, 0.62);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font: 9px/1 var(--font-mono);
            letter-spacing: 0.07em;
            text-transform: lowercase;
          }
          .waves-mode-compact select {
            min-height: 32px;
            border: 0;
            padding: 0 18px 0 4px;
            background: transparent;
            color: var(--wave-tone);
            font: 10px/1 var(--font-mono);
            text-transform: lowercase;
          }
          .waves-play-hint {
            position: fixed;
            z-index: 2;
            left: 50%;
            bottom: calc(122px + env(safe-area-inset-bottom, 0px));
            display: block;
            transform: translateX(-50%);
            color: rgba(246, 241, 224, 0.58);
            font: 10px/1 var(--font-mono);
            letter-spacing: 0.07em;
            white-space: nowrap;
            text-shadow: 0 2px 12px rgba(0, 0, 0, 0.86);
            pointer-events: none;
          }
          .waves-mobile-panel .mobile-instrument-panel__trigger {
            max-width: calc(100vw - 190px);
            border-color: color-mix(in srgb, var(--wave-tone) 38%, transparent);
            background: rgba(5, 8, 15, 0.86);
          }
          .waves-mobile-panel .mobile-instrument-panel__sheet {
            background: rgba(4, 7, 13, 0.98);
            border-color: color-mix(in srgb, var(--wave-tone) 26%, transparent);
          }
          .waves-mobile-panel .waves-console {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            box-shadow: none;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            overflow: visible;
          }
          .waves-mobile-panel .waves-readout { grid-column: 1 / -1; }
        }

        @media (max-width: 520px) {
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

// ── natural drawing helpers ────────────────────────────────────────
// Small tight paintings for things that live on the pond. Kept
// procedural (no assets) and never man-made — leaves, pads, koi.

function drawLilyPad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  // A round pad with the classic notch cut toward the current, a light
  // rim, and a subtle underwater shadow.
  const rot = Math.sin(seed * 0.013) * Math.PI;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // shadow beneath the pad in the water
  ctx.fillStyle = "rgba(6, 18, 30, 0.28)";
  ctx.beginPath();
  ctx.ellipse(2, 2, r * 1.02, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  // body — flat green oval with a wedge notch removed
  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, "rgba(150, 196, 118, 0.98)");
  g.addColorStop(0.6, "rgba( 92, 152,  86, 0.96)");
  g.addColorStop(1, "rgba( 46, 100,  62, 0.94)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arc(0, 0, r, 0, Math.PI * 2 - 0.55, false);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  // rim highlight
  ctx.strokeStyle = "rgba(214, 244, 178, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2 - 0.55, false);
  ctx.stroke();
  // vein radiating from the notch centre
  ctx.strokeStyle = "rgba(58, 100, 62, 0.55)";
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI + 0.35 + (i / 4) * (Math.PI * 2 - 0.7);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFallenLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  seed: number,
) {
  // A small ochre / rust leaf shape floating on the surface. Two lobes
  // pinched at both ends, thin stem, veined centre.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // shadow
  ctx.fillStyle = "rgba(6, 18, 30, 0.24)";
  ctx.beginPath();
  ctx.ellipse(1, 1, r * 1.1, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // body — pinched lens
  const g = ctx.createLinearGradient(-r, 0, r, 0);
  const warm = (seed & 3);
  const base = warm === 0 ? "rgba(214, 138, 68, 0.96)"
             : warm === 1 ? "rgba(196, 108, 54, 0.96)"
             : warm === 2 ? "rgba(228, 176, 90, 0.96)"
             : "rgba(180, 128, 76, 0.96)";
  g.addColorStop(0, "rgba(240, 210, 154, 0.92)");
  g.addColorStop(0.5, base);
  g.addColorStop(1, "rgba(120, 78, 48, 0.94)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.quadraticCurveTo(0, -r * 0.55, r, 0);
  ctx.quadraticCurveTo(0, r * 0.55, -r, 0);
  ctx.closePath();
  ctx.fill();
  // central vein
  ctx.strokeStyle = "rgba(96, 56, 32, 0.7)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, 0);
  ctx.lineTo(r * 0.95, 0);
  ctx.stroke();
  // side veins
  for (let i = 1; i <= 3; i++) {
    const f = i / 4;
    const px = -r + f * 2 * r;
    const vy = Math.sqrt(Math.max(0, 1 - Math.pow((px / r), 2))) * r * 0.48;
    ctx.beginPath();
    ctx.moveTo(px * 0.3, 0);
    ctx.lineTo(px, -vy * 0.6);
    ctx.moveTo(px * 0.3, 0);
    ctx.lineTo(px, vy * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawKoiShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number,
  seed: number,
) {
  // A dark elongated silhouette drifting under the surface, with a
  // slight fish-tail wiggle. A single warm orange dab hints at colour
  // in the koi's back.
  const angle = Math.sin(t * 0.15 + seed * 0.01) * 0.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // body shadow — soft, wide
  const g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
  g.addColorStop(0, "rgba(6, 14, 26, 0.55)");
  g.addColorStop(0.6, "rgba(6, 14, 26, 0.35)");
  g.addColorStop(1, "rgba(6, 14, 26, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  // tail wiggle
  const wag = Math.sin(t * 2.4 + seed * 0.03) * 0.5;
  ctx.beginPath();
  ctx.moveTo(-r * 0.85, 0);
  ctx.quadraticCurveTo(-r * 1.05, wag * r * 0.3, -r * 1.15, wag * r * 0.55);
  ctx.quadraticCurveTo(-r * 1.05, wag * r * 0.15 - r * 0.05, -r * 0.85, 0);
  ctx.fillStyle = "rgba(6, 14, 26, 0.42)";
  ctx.fill();
  // orange back dab — the koi's colour barely showing through the water
  ctx.fillStyle = "rgba(224, 120, 56, 0.42)";
  ctx.beginPath();
  ctx.ellipse(r * 0.15, -r * 0.02, r * 0.32, r * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── weather overlay drawing ────────────────────────────────────────
// Ephemeral acts that fire on their own schedule. Displacement is
// injected in the sim tick above; this pass just paints their bodies.
type WeatherLite =
  | { kind: "leaf"; t0: number; duration: number; startX: number; startY: number; endX: number; endY: number; rot0: number; spin: number; landed: boolean }
  | { kind: "dragonfly"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number }
  | { kind: "wind"; t0: number; duration: number; dir: number; band: number }
  | { kind: "frog"; t0: number; duration: number; x: number; y: number }
  | { kind: "strider"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number }
  | { kind: "koi"; t0: number; duration: number; x: number; y: number; dir: number; splashed: boolean };

function drawWeatherOverlay(
  ctx: CanvasRenderingContext2D,
  events: WeatherLite[],
  now: number,
  t: number,
  w: number,
  h: number,
) {
  for (const e of events) {
    const age = (now - e.t0) / 1000;
    if (age < 0 || age >= e.duration) continue;
    const f = age / e.duration;
    if (e.kind === "leaf" && !e.landed) {
      // spiral down from top: mix start→end with a sinusoidal x wobble
      const ease = f;
      const x = (e.startX + (e.endX - e.startX) * ease + Math.sin(age * 3.2) * 0.03) * w;
      const y = (e.startY + (e.endY - e.startY) * ease) * h;
      const rot = e.rot0 + age * e.spin;
      drawFallenLeaf(ctx, x, y, 9 + Math.sin(age * 2) * 1.4, rot, e.t0 & 0xffff);
    } else if (e.kind === "dragonfly") {
      const x = (e.ax + (e.bx - e.ax) * f) * w;
      const y = (e.ay + (e.by - e.ay) * f + Math.sin(age * 6) * 0.02) * h;
      // body
      ctx.save();
      ctx.fillStyle = "rgba(80, 220, 200, 0.85)";
      ctx.beginPath();
      ctx.ellipse(x, y, 4, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // shimmering wing blur
      const wing = 6 + Math.sin(age * 40) * 1.4;
      ctx.strokeStyle = "rgba(200, 240, 232, 0.35)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, wing, 2, 0.4, 0, Math.PI * 2);
      ctx.ellipse(x, y + 2, wing, 2, -0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (e.kind === "wind") {
      // subtle directional streak sweeping the band; the actual water
      // motion is done by drop2D above.
      const cy = e.band * h;
      const lead = (e.dir > 0 ? f : 1 - f) * w;
      const grad = ctx.createLinearGradient(lead - 60 * e.dir, cy, lead + 60 * e.dir, cy);
      grad.addColorStop(0, "rgba(230, 240, 240, 0)");
      grad.addColorStop(0.5, "rgba(230, 240, 240, 0.08)");
      grad.addColorStop(1, "rgba(230, 240, 240, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(lead - 90, cy - 40, 180, 80);
    } else if (e.kind === "frog") {
      // splash rings — the pluck already deformed the water, this is
      // just the outer shockwave ring for a moment.
      const rad = 8 + age * 90;
      const alpha = Math.max(0, 1 - age / e.duration) * 0.55;
      ctx.save();
      ctx.strokeStyle = `rgba(230, 244, 232, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(e.x * w, e.y * h, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (e.kind === "strider") {
      const x = (e.ax + (e.bx - e.ax) * f) * w;
      const y = (e.ay + (e.by - e.ay) * f + Math.sin(age * 5) * 0.006) * h;
      // little dimple pair (the strider's feet meniscus)
      ctx.save();
      ctx.fillStyle = "rgba(6, 18, 30, 0.55)";
      ctx.beginPath();
      ctx.arc(x - 2, y - 1, 0.8, 0, Math.PI * 2);
      ctx.arc(x + 2, y + 1, 0.8, 0, Math.PI * 2);
      ctx.fill();
      // very faint bug body
      ctx.strokeStyle = "rgba(20, 40, 24, 0.7)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.stroke();
      ctx.restore();
      // suppress unused-t warning
      void t;
    } else if (e.kind === "koi") {
      // A rising then descending dark silhouette. Splash ring fires
      // once at the surface break moment.
      const arc = Math.sin(Math.PI * f);
      const bob = arc * 8;
      const bx = e.x * w + e.dir * (f - 0.5) * 32;
      const by = e.y * h - bob;
      drawKoiShadow(ctx, bx, by, 32, t, e.t0 & 0xffff);
      if (f > 0.34 && f < 0.5) {
        const rf = (f - 0.34) / 0.16;
        const rad = 4 + rf * 42;
        ctx.strokeStyle = `rgba(232, 244, 250, ${(1 - rf) * 0.6})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bx, by + 4, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
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
