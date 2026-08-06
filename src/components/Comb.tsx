"use client";

// Comb — a field of light you cannot flatten.
//
// Comets stream along a smoothly varying direction field. The field carries
// topological defects: +1 vortices (everything winds around them) and −1
// saddles. The hairy ball theorem is the toy: comb the field all you like,
// the total winding is conserved, so the cowlick never really goes away —
// opposite charges can only cancel each other in a burst of light.
//
// alive on its own   two vortices co-orbit, the field breathes between
//                    radiating and orbiting, color drifts like weather
//
// All contact speaks the shared grammar (src/lib/gesture):
// tap                bloom a +1 vortex where you touch
// dwell              grow a −1 saddle; the longer the hold, the stronger
// dwell on a sun     feed it — the winding deepens
// ceremony hold      a charge pair is born together (winding conserved)
// slide / flick      comb the field — comets swing to follow your stroke
// drag a defect      carry the singularity around
// circle a finger    stir the comets into a ring
// tap a steady beat  the field's breath entrains to your tempo
// two-finger twist   rotate the global phase
// three-finger drag  a gust combs the whole sky
// three-finger hold  time dilates to quarter speed
// wheel (desktop)    zoom — pinch belongs to the manifold, not the room
// shake              slam opposite charges together — annihilation
// tilt               gravity leans the whole comet stream
// flip the phone     portrait↔landscape reverses time

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import { onVessel, requestVessel, vesselAvailable, vesselGranted } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// ── palette ──────────────────────────────────────────────────────────────
// The cream field with dark comet tails: mostly warm ambers, with blue and
// violet minorities whose share drifts slowly, so the weather turns.
const CREAM = { r: 244, g: 236, b: 221 };
const TAIL_GROUPS: string[][] = [
  ["#7c5a33", "#96693a", "#5f4426", "#b07c3e", "#8a5a2a"], // amber / umber
  ["#3d5c8c", "#2f4a80", "#5b7fae", "#274064"],            // blue / navy
  ["#5e4a8a", "#7a5a9a", "#8a4a55"],                        // violet / rose
];

type Defect = {
  x: number; y: number;      // world coords, unit = min(w,h)/2 at zoom 1
  q: 1 | -1;                 // topological charge
  s: number;                 // strength 0..smax (grows in, shrinks out)
  smax: number;              // how strong this defect gets (long-press holds grow it)
  born: number;
  dying: boolean;
  slam: number;              // >0 while a shake is slamming this defect
  grabbed: boolean;
};

type Stroke = {
  x: number; y: number;
  ang: number;
  amp: number;
  sig2: number;              // spatial gaussian variance (world units²)
  t0: number;
};

type Particle = {
  x: number; y: number;
  lx: number; ly: number;    // last drawn position (world)
  gi: number; ci: number;    // tail sprite group / index
  sz: number;
  sp: number;
  age: number; life: number;
  skip: boolean;             // don't leave a streak this frame (fresh spawn)
};

type Burst = { x: number; y: number; t0: number; amp: number };

// ── tiny synth on the shared field-audio context ─────────────────────────
type CombAudio = {
  kick: () => void;
  bloom: (q: 1 | -1, strength: number) => void;
  brush: (strength: number) => void;
  ring: (strength: number) => void;
  reverse: () => void;
  gather: () => void;
  dispose: () => void;
};

function createCombAudio(): CombAudio {
  const fa = getFieldAudio();
  let ctx: AudioContext | null = null;
  let bus: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let lastBrush = 0;

  const noise = (c: AudioContext): AudioBuffer => {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(c.sampleRate * 0.8);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  };

  const ensure = (): boolean => {
    if (ctx && bus) return true;
    try { void fa.start(); } catch { /* noop */ }
    const c = fa.getAudioContext();
    if (!c) return false;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    ctx = c;
    bus = c.createGain();
    bus.gain.value = 0.85;
    bus.connect(c.destination);
    return true;
  };

  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, lp?: number) => {
    if (!ctx || !bus || fa.isMuted()) return;
    const c = ctx;
    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, f0), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    let tail: AudioNode = g;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      g.connect(f);
      tail = f;
    }
    osc.connect(g);
    tail.connect(bus);
    osc.start(now);
    osc.stop(now + dur + 0.05);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* noop */ } };
  };

  const hiss = (dur: number, peak: number, bp: number, q: number) => {
    if (!ctx || !bus || fa.isMuted()) return;
    const c = ctx;
    const now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = bp;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f).connect(g).connect(bus);
    try { src.start(now); src.stop(now + dur + 0.05); } catch { /* noop */ }
  };

  return {
    kick() { ensure(); },
    bloom(q, strength) {
      if (!ensure()) return;
      const s = clamp(strength, 0.2, 1);
      if (q > 0) {
        tone("sine", 520, mix(760, 1040, s), 0.5, 0.09);
        tone("sine", 1040, mix(1400, 1960, s), 0.34, 0.035);
        hiss(0.2, 0.02, 2400, 2);
      } else {
        tone("sine", 460, mix(220, 150, s), 0.6, 0.1, 900);
        tone("triangle", 230, 96, 0.5, 0.05, 500);
        hiss(0.26, 0.02, 700, 2);
      }
    },
    brush(strength) {
      if (!ensure() || !ctx) return;
      const now = ctx.currentTime;
      if (now - lastBrush < 0.09) return;
      lastBrush = now;
      const s = clamp(strength, 0, 1);
      hiss(mix(0.1, 0.24, s), mix(0.012, 0.05, s), mix(700, 1600, s), 1.2);
    },
    ring(strength) {
      if (!ensure()) return;
      const s = clamp(strength, 0.2, 1);
      tone("sine", 660, 655, 0.9, 0.08 * s);
      tone("sine", 992, 984, 0.7, 0.05 * s);
      tone("sine", 330, 320, 1.2, 0.06 * s, 1200);
      hiss(0.4, 0.05 * s, 1900, 1.4);
    },
    reverse() {
      if (!ensure()) return;
      tone("sine", 880, 220, 0.5, 0.06);
      tone("sine", 220, 660, 0.5, 0.05);
      hiss(0.5, 0.03, 1100, 1);
    },
    gather() {
      if (!ensure()) return;
      tone("sine", 240, 150, 0.5, 0.05, 800);
      hiss(0.4, 0.015, 500, 0.8);
    },
    dispose() {
      try { bus?.disconnect(); } catch { /* noop */ }
      bus = null;
      ctx = null;
    },
  };
}

// pre-rendered soft dots so the frame loop never builds gradients
function makeDot(size: number, stops: Array<[number, string]>): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return c;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export default function Comb() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [motionUI, setMotionUI] = useState<"hidden" | "prompt" | "on">("hidden");
  const [hasChanged, setHasChanged] = useState(false);
  const clearFieldRef = useRef<() => void>(() => {});
  const audioRef = useRef<CombAudio | null>(null);
  const gravityRef = useRef({ tx: 0, ty: 0, x: 0, y: 0 });
  const shakeRef = useRef({ pending: 0 });
  const reduceRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = createCombAudio();
    audioRef.current.kick();
  }, []);

  // ── the vessel (shared bus, @/lib/vessel): tilt leans the stream, shake
  // slams opposite charges together. Not a private wiring — one arm/permit
  // lifecycle shared with every room. requestVessel() is invited from the
  // chip's own click on gated platforms (iOS); ungated platforms (Android,
  // desktop) arm silently, same as the room always behaved.
  const armSensors = useCallback(() => {
    void requestVessel().then((ok) => {
      if (ok) setMotionUI("on");
    });
  }, []);

  useEffect(() => {
    if (!vesselAvailable()) { setMotionUI("hidden"); return; }
    if (vesselGranted()) { setMotionUI("on"); return; }
    // try a silent arm first (covers ungated platforms + a prior grant);
    // if it doesn't take, offer the chip so the hand can invite it.
    void requestVessel().then((ok) => setMotionUI(ok ? "on" : "prompt"));
  }, []);

  // ── the field itself ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = reduceQuery.matches;
    const onReduce = () => { reduceRef.current = reduceQuery.matches; };
    reduceQuery.addEventListener?.("change", onReduce);

    // ── the shared performance contract: no draw while hidden, a quality
    // tier that scales particle counts, a DPR ceiling on resize ────────
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hiddenDoc = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    const syncSleep = () => {
      asleep = hiddenDoc || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((hd) => {
      hiddenDoc = hd;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    let w = 0, h = 0, dpr = 1, u = 1;
    let landscape: boolean | null = null;

    // camera
    let zoom = 1;
    let camX = 0, camY = 0;

    // global field state
    let th0 = 0;                 // global phase (twist + slow rotation)
    let seasonOffset = 0;        // three-finger twist: advances/rewinds the weather cycle
    let tDir = 1;                // time direction — flipping the phone reverses it
    let simT = 0;

    const defects: Defect[] = [
      { x: -0.34, y: 0.08, q: 1, s: 1, smax: 1, born: -10, dying: false, slam: 0, grabbed: false },
      { x: 0.38, y: -0.12, q: 1, s: 1, smax: 1, born: -10, dying: false, slam: 0, grabbed: false },
    ];
    const strokes: Stroke[] = [];
    const bursts: Burst[] = [];
    const particles: Particle[] = [];
    // the saddle forming under a held finger — driven by the engine's hold
    let forming: { x: number; y: number; elapsed: number } | null = null;

    // ── the law layer (gesture grammar): wind, dilated time, entrainment ──
    const timeScale = { cur: 1, target: 1 };
    const entrain = { bpm: 0, until: 0, lastBeat: -1 };
    let beatPulse = 0;
    let lastGestureAt = performance.now();

    // sprites
    // one head sprite per hue family — brightness rides the hue (gold-white,
    // ice-white, violet-white), never absolute white, so comets stay tinted
    // even at their hottest, the way filtered light behaves on film
    const HEAD_TINTS: Array<[string, string]> = [
      ["255,244,210", "250,222,160"], // amber family
      ["224,236,255", "196,216,250"], // blue family
      ["240,228,252", "220,202,244"], // violet family
    ];
    const heads = HEAD_TINTS.map(([core, halo]) => makeDot(64, [
      [0, `rgba(${core},0.9)`],
      [0.18, `rgba(${halo},0.42)`],
      [0.45, `rgba(${halo},0.08)`],
      [1, `rgba(${halo},0)`],
    ]));
    // blooms repaint onto a persisted canvas every frame, so their per-frame
    // alpha must stay well under the wash fade or they saturate to white
    const bloomPos = makeDot(256, [
      [0, "rgba(255,242,206,0.045)"],
      [0.12, "rgba(253,234,188,0.028)"],
      [0.38, "rgba(250,228,180,0.01)"],
      [1, "rgba(250,228,180,0)"],
    ]);
    const bloomNeg = makeDot(256, [
      [0, "rgba(74,58,92,0.04)"],
      [0.45, "rgba(96,74,60,0.015)"],
      [1, "rgba(96,74,60,0)"],
    ]);
    const flare = makeDot(256, [
      [0, "rgba(255,244,210,0.85)"],
      [0.3, "rgba(252,234,190,0.35)"],
      [1, "rgba(252,234,190,0)"],
    ]);
    const tails: HTMLCanvasElement[][] = TAIL_GROUPS.map((group) =>
      group.map((hex) => {
        const { r, g, b } = hexToRgb(hex);
        return makeDot(40, [
          [0, `rgba(${r},${g},${b},0.6)`],
          [0.45, `rgba(${r},${g},${b},0.22)`],
          [1, `rgba(${r},${g},${b},0)`],
        ]);
      }),
    );

    // A pre-rendered "wash" — the slow-drifting weather tint under the
    // whole field. Built on a small offscreen canvas at a throttled rate
    // and blitted with drawImage every frame; the frame loop never builds
    // a CanvasGradient itself (perf contract — never per-frame allocation).
    const washCanvas = document.createElement("canvas");
    washCanvas.width = 128;
    washCanvas.height = 128;
    const washCtx = washCanvas.getContext("2d");
    let lastWashPaintAt = -Infinity;
    const paintWash = () => {
      if (!washCtx) return;
      const ww = washCanvas.width, wh = washCanvas.height;
      const tint = weatherTint();
      const inner = {
        r: Math.round(mix(CREAM.r, tint.r, tint.amt * 0.45)),
        g: Math.round(mix(CREAM.g, tint.g, tint.amt * 0.45)),
        b: Math.round(mix(CREAM.b, tint.b, tint.amt * 0.45)),
      };
      const edge = {
        r: Math.round(mix(CREAM.r, tint.r, tint.amt)),
        g: Math.round(mix(CREAM.g, tint.g, tint.amt)),
        b: Math.round(mix(CREAM.b, tint.b, tint.amt)),
      };
      const cx = ww / 2 + Math.sin(simT * 0.05) * ww * 0.08;
      const cy = wh / 2 + Math.cos(simT * 0.041) * wh * 0.08;
      const grad = washCtx.createRadialGradient(cx, cy, Math.min(ww, wh) * 0.1, ww / 2, wh / 2, Math.hypot(ww, wh) * 0.62);
      grad.addColorStop(0, `rgb(${inner.r},${inner.g},${inner.b})`);
      grad.addColorStop(1, `rgb(${edge.r},${edge.g},${edge.b})`);
      washCtx.fillStyle = grad;
      washCtx.fillRect(0, 0, ww, wh);
    };

    // ── coordinate helpers ───────────────────────────────────────────────
    const toScreenX = (x: number) => w / 2 + (x - camX) * u * zoom;
    const toScreenY = (y: number) => h / 2 + (y - camY) * u * zoom;
    const toWorldX = (sx: number) => (sx - w / 2) / (u * zoom) + camX;
    const toWorldY = (sy: number) => (sy - h / 2) / (u * zoom) + camY;
    const halfExtX = () => (w / 2) / (u * zoom);
    const halfExtY = () => (h / 2) / (u * zoom);

    // ── the direction field ──────────────────────────────────────────────
    // θ(p) = Σ qᵢ·arg(p − pᵢ) + θ₀ + χ(t) + k(t)·sin(3r − ω_r·t), blended
    // with any comb strokes still fading. χ breathes the field between
    // radiating (source) and orbiting (vortex); the winding term is what
    // makes the center a true topological defect.
    const fieldAngle = (px: number, py: number): number => {
      // biased toward radiating outward — a sun first, a whirlpool sometimes
      const chi = 0.3 + 0.55 * Math.sin(simT * 0.09 + 1.3) + 0.25 * Math.sin(simT * 0.023);
      let sum = th0 + chi;
      for (let i = 0; i < defects.length; i++) {
        const d = defects[i];
        sum += d.q * d.s * Math.atan2(py - d.y, px - d.x);
      }
      const r = Math.hypot(px - camX, py - camY);
      // beatPulse: an entrained hand's tempo breathes through the winding
      const k = 0.32 + 0.22 * Math.sin(simT * 0.061) + beatPulse * 0.45;
      sum += k * Math.sin(3.1 * r - simT * 0.9 * tDir);

      let vx = Math.cos(sum);
      let vy = Math.sin(sum);
      const now = simT;
      for (let i = 0; i < strokes.length; i++) {
        const s = strokes[i];
        const dx = px - s.x, dy = py - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > s.sig2 * 9) continue;
        const wgt = s.amp * Math.exp(-d2 / (2 * s.sig2)) * Math.exp(-(now - s.t0) / 1.4);
        vx += wgt * Math.cos(s.ang);
        vy += wgt * Math.sin(s.ang);
      }
      return Math.atan2(vy, vx);
    };

    // ── particles ────────────────────────────────────────────────────────
    const groupWeights = (): [number, number, number] => {
      const a = 0.55 + 0.45 * Math.sin(simT * 0.021);
      const b = 0.3 + 0.28 * Math.sin(simT * 0.017 + 2.1);
      const v = 0.22 + 0.21 * Math.sin(simT * 0.013 + 4.2);
      const t = a + b + v;
      return [a / t, b / t, v / t];
    };

    // the slow weather the whole page moves through: cream noon, peach
    // afternoon, mauve dusk, amber evening — streaks and wash shift together
    const WEATHER: Array<{ r: number; g: number; b: number }> = [
      { r: 222, g: 184, b: 154 },  // peach
      { r: 174, g: 156, b: 188 },  // mauve dusk
      { r: 214, g: 188, b: 140 },  // amber
      { r: 156, g: 168, b: 194 },  // blue hour
    ];
    const weatherTint = (): { r: number; g: number; b: number; amt: number } => {
      const phase = simT * 0.014 + seasonOffset;
      const idx = ((Math.floor(phase) % WEATHER.length) + WEATHER.length) % WEATHER.length;
      const next = (idx + 1) % WEATHER.length;
      const f = phase - Math.floor(phase);
      const sm = f * f * (3 - 2 * f);
      const a = WEATHER[idx], b = WEATHER[next];
      return {
        r: mix(a.r, b.r, sm),
        g: mix(a.g, b.g, sm),
        b: mix(a.b, b.b, sm),
        amt: 0.62 + 0.3 * Math.sin(simT * 0.019 + 1.1),
      };
    };

    const respawn = (p: Particle) => {
      const hx = halfExtX(), hy = halfExtY();
      if (defects.length > 0 && Math.random() < 0.6) {
        const d = defects[(Math.random() * defects.length) | 0];
        const ang = Math.random() * TAU;
        const rad = 0.12 + Math.random() * 0.85;
        p.x = d.x + Math.cos(ang) * rad;
        p.y = d.y + Math.sin(ang) * rad;
      } else {
        p.x = camX + (Math.random() * 2 - 1) * hx;
        p.y = camY + (Math.random() * 2 - 1) * hy;
      }
      const [wa, wb] = groupWeights();
      const roll = Math.random();
      p.gi = roll < wa ? 0 : roll < wa + wb ? 1 : 2;
      p.ci = (Math.random() * TAIL_GROUPS[p.gi].length) | 0;
      p.sz = 0.7 + Math.random() * 0.8;
      // fast and short-lived: each streak dies before the field can bend it,
      // so the hairs read as straight vectors, the way iron filings would
      p.sp = 0.24 + Math.random() * 0.22;
      p.age = 0;
      p.life = 1.4 + Math.random() * 2.2;
      p.lx = p.x;
      p.ly = p.y;
      p.skip = true;
    };

    const targetCount = () => {
      const area = w * h;
      const base = clamp(Math.round(area / 6200), 90, 210);
      const scaled = Math.round(base * detailForTier(gov.tier()).particles);
      return reduceRef.current ? Math.round(scaled * 0.55) : scaled;
    };

    const syncParticles = () => {
      const n = targetCount();
      while (particles.length < n) {
        const p: Particle = { x: 0, y: 0, lx: 0, ly: 0, gi: 0, ci: 0, sz: 1, sp: 0.15, age: 0, life: 8, skip: true };
        respawn(p);
        p.age = Math.random() * p.life;
        particles.push(p);
      }
      if (particles.length > n) particles.length = n;
    };

    // ── defect management ────────────────────────────────────────────────
    const spawnDefect = (q: 1 | -1, x: number, y: number, smax = 1) => {
      const alive = defects.filter((d) => !d.dying);
      if (alive.length >= 6) {
        const oldest = alive.filter((d) => !d.grabbed).sort((a, b) => a.born - b.born)[0];
        if (oldest) oldest.dying = true;
      }
      const d: Defect = { x, y, q, s: 0.05, smax, born: simT, dying: false, slam: 0, grabbed: false };
      defects.push(d);
      try { audioRef.current?.bloom(q, 0.7); } catch { /* noop */ }
      try { (q > 0 ? haptics.tap : haptics.chop)(); } catch { /* noop */ }
      setHasChanged(true);
      return d;
    };

    clearFieldRef.current = () => {
      defects.length = 0;
      defects.push(
        { x: -0.34, y: 0.08, q: 1, s: 1, smax: 1, born: simT - 10, dying: false, slam: 0, grabbed: false },
        { x: 0.38, y: -0.12, q: 1, s: 1, smax: 1, born: simT - 10, dying: false, slam: 0, grabbed: false },
      );
      strokes.length = 0;
      bursts.length = 0;
      setHasChanged(false);
    };

    const annihilate = (a: Defect, b: Defect) => {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      defects.splice(defects.indexOf(a), 1);
      defects.splice(defects.indexOf(b), 1);
      bursts.push({ x: mx, y: my, t0: simT, amp: 1 });
      // the released winding shears the nearby field
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * TAU;
        strokes.push({
          x: mx + Math.cos(ang) * 0.2, y: my + Math.sin(ang) * 0.2,
          ang, amp: 1.6, sig2: 0.05, t0: simT,
        });
      }
      try { audioRef.current?.ring(1); } catch { /* noop */ }
      try { haptics.storm(); } catch { /* noop */ }
    };

    const shake = (amt: number) => {
      if (reduceRef.current) return;
      const pos = defects.find((d) => d.q > 0 && !d.dying);
      const neg = defects.find((d) => d.q < 0 && !d.dying);
      if (pos && neg) {
        pos.slam = 1.4;
        neg.slam = 1.4;
      } else {
        for (let i = 0; i < 7; i++) {
          const hx = halfExtX(), hy = halfExtY();
          strokes.push({
            x: camX + (Math.random() * 2 - 1) * hx,
            y: camY + (Math.random() * 2 - 1) * hy,
            ang: Math.random() * TAU,
            amp: 1.2 + amt, sig2: 0.12, t0: simT,
          });
        }
        bursts.push({ x: camX, y: camY, t0: simT, amp: 0.5 * amt });
      }
      try { audioRef.current?.brush(1); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
    };

    // ── the tap ladder's tier 3 and tier 5 rungs (tapTrainTier) ─────────
    // Splitting conserves winding by construction: one defect of charge q
    // (contributing q) becomes two of q and one of −q (contributing
    // q + q − q = q) — the hairy ball theorem paying out under the hand,
    // for either sign of defect, not just a "sun".
    const splitDefect = (d: Defect) => {
      const px = d.x, py = d.y, q = d.q;
      const negQ: 1 | -1 = q === 1 ? -1 : 1;
      d.dying = true;
      spawnDefect(q, px - 0.14, py - 0.05, 1);
      spawnDefect(q, px + 0.14, py - 0.05, 1);
      spawnDefect(negQ, px, py + 0.12, 0.9);
      bursts.push({ x: px, y: py, t0: simT, amp: 0.9 });
      try { audioRef.current?.ring(0.9); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
    };

    // Tier 3 on open sky: a cycling set of rarer events, deterministic by
    // tap order (a counter, never Math.random) — the same sequence every
    // time a hand keeps tapping the same empty patch of field.
    let skyEventCounter = 0;
    const skyEventPair = (wx: number, wy: number) => {
      const a = spawnDefect(1, wx - 0.09, wy, 1);
      const b = spawnDefect(-1, wx + 0.09, wy, 1);
      bursts.push({ x: (a.x + b.x) / 2, y: wy, t0: simT, amp: 0.9 });
      try { audioRef.current?.ring(0.8); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
    };
    const skyEventGust = (wx: number, wy: number, intensity: number) => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        strokes.push({
          x: wx + Math.cos(a) * 0.14, y: wy + Math.sin(a) * 0.14,
          ang: a, amp: 1.2 + intensity, sig2: 0.12, t0: simT,
        });
      }
      if (strokes.length > 90) strokes.splice(0, strokes.length - 90);
      bursts.push({ x: wx, y: wy, t0: simT, amp: 0.5 + intensity * 0.3 });
      try { audioRef.current?.brush(1); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
    };
    const skyEventFlare = (wx: number, wy: number, intensity: number) => {
      const amp = 0.4 + intensity * 0.35;
      for (const d of defects) bursts.push({ x: d.x, y: d.y, t0: simT, amp });
      bursts.push({ x: wx, y: wy, t0: simT, amp: amp * 0.8 });
      try { audioRef.current?.ring(amp); } catch { /* noop */ }
      try { haptics.ripple(amp); } catch { /* noop */ }
    };
    const cycleSkyEvent = (wx: number, wy: number, intensity: number) => {
      const events = [
        () => skyEventPair(wx, wy),
        () => skyEventGust(wx, wy, intensity),
        () => skyEventFlare(wx, wy, intensity),
      ];
      const pick = events[skyEventCounter % events.length];
      skyEventCounter += 1;
      pick();
    };

    // Tier 5: the room's biggest, rarest event — the whole field's time
    // sense turns over. Reuses the same tDir the phone-flip already drives,
    // so the wave term in fieldAngle genuinely runs backward everywhere at
    // once, not a decal on top of the same forward field.
    const reverseField = () => {
      tDir *= -1;
      bursts.push({ x: camX, y: camY, t0: simT, amp: 1.3 });
      for (const d of defects) bursts.push({ x: d.x, y: d.y, t0: simT, amp: 0.55 });
      try { audioRef.current?.reverse(); } catch { /* noop */ }
      try { haptics.storm(); } catch { /* noop */ }
      setHasChanged(true);
    };

    // ── gestures ─────────────────────────────────────────────────────────
    const defectNear = (wx: number, wy: number): Defect | null => {
      let best: Defect | null = null;
      let bestD = 0.16 / zoom;
      for (const d of defects) {
        if (d.dying) continue;
        const dist = Math.hypot(d.x - wx, d.y - wy);
        if (dist < bestD) { best = d; bestD = dist; }
      }
      return best;
    };

    // ── gestures (the shared grammar — src/lib/gesture) ─────────────────
    // One finger touches the light: tap blooms a +1 vortex, a stroke combs
    // the comets, a flick leaves a wake, a drag on a defect carries it, a
    // dwell grows a −1 saddle and a dwell on a vortex feeds it; the
    // ceremony creates a charge pair (winding conserved). Two fingers
    // twist the global phase. Three fingers are the law: drag is a gust
    // over the whole field, hold dilates time. Pinch and pan2 stay
    // unbound — the frame belongs to the manifold; the desktop wheel
    // still zooms. Tilt / shake / flip (the vessel) keep their wiring.
    let carried: Defect | null = null;
    let feeding: Defect | null = null;
    let strokeAcc = 0;
    let holdDone = false;
    let dwellCued = false;   // the dwell tier announces itself exactly once
    let pendingSaddle = 0;   // a hold preempted by a drag must not commit
    let lastFeedCueAt = 0;
    let lastGustCueAt = 0;
    let lastScrubAt = 0;

    const detachGestures = attachGestures(canvas, {
      tap: (e) => {
        ensureAudio();
        lastGestureAt = performance.now();
        if (e.fingers === 2) return; // ScaleTravel's step back — no lens here
        if (e.fingers === 3) {
          // tutti — everything alive answers softly at once, as loud as the strike
          for (const d of defects) bursts.push({ x: d.x, y: d.y, t0: simT, amp: 0.16 + e.intensity * 0.22 });
          try { audioRef.current?.ring(0.35 + e.intensity * 0.35); } catch { /* noop */ }
          try { haptics.ripple(0.3 + e.intensity * 0.3); } catch { /* noop */ }
          return;
        }
        const wx = toWorldX(e.x), wy = toWorldY(e.y);
        // the site-wide tap train (gesture/core.ts): 1 / 3 / 5 / n. Tier 3 is
        // the object's transformation (or, on open sky, a cycling rarer
        // event); tier 5 is the room's biggest, rarest event; tier n keeps
        // deepening rather than stopping at a step.
        const trainTier = tapTrainTier(e.count);
        if (trainTier === 3) {
          const hitD = defectNear(wx, wy);
          if (hitD) splitDefect(hitD);
          else cycleSkyEvent(wx, wy, e.intensity);
          return;
        }
        if (trainTier === 5) {
          // the room's biggest, rarest event: the whole field's time sense
          // turns over — the wave term runs backward everywhere at once
          reverseField();
          return;
        }
        if (trainTier === "n") {
          // seven and beyond: the crescendo keeps deepening — every further
          // strike brightens every defect further, nothing new is born
          const amp = clamp(0.3 + (e.count - 6) * 0.12, 0.3, 1);
          for (const d of defects) bursts.push({ x: d.x, y: d.y, t0: simT, amp });
          bursts.push({ x: wx, y: wy, t0: simT, amp: amp * 0.8 });
          try { audioRef.current?.ring(amp); } catch { /* noop */ }
          try { (e.count === 7 ? haptics.storm : () => haptics.ripple(amp))(); } catch { /* noop */ }
          return;
        }
        // tap intensity is the strike — the newborn vortex's burst rides it
        const d = spawnDefect(1, wx, wy);
        bursts.push({ x: d.x, y: d.y, t0: simT, amp: 0.3 + e.intensity * 0.4 });
      },
      drag: (e) => {
        ensureAudio();
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: one gust combs the whole sky
          const ang = Math.atan2(e.dy, e.dx);
          const hx = halfExtX(), hy = halfExtY();
          for (let i = 0; i < 3; i++) {
            strokes.push({
              x: camX + (Math.random() * 2 - 1) * hx,
              y: camY + (Math.random() * 2 - 1) * hy,
              ang,
              amp: clamp(0.8 + Math.hypot(e.vx, e.vy) * 0.8, 0.8, 2.6),
              sig2: 0.16, t0: simT,
            });
          }
          if (strokes.length > 90) strokes.splice(0, strokes.length - 90);
          const now = performance.now();
          if (now - lastGustCueAt > 500) {
            lastGustCueAt = now;
            try { audioRef.current?.brush(1); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          forming = null;
          if (pendingSaddle) { window.clearTimeout(pendingSaddle); pendingSaddle = 0; }
          const d = defectNear(toWorldX(e.x), toWorldY(e.y));
          if (d) { carried = d; d.grabbed = true; }
          strokeAcc = 0;
          return;
        }
        if (e.phase === "end") {
          if (carried) {
            carried.grabbed = false;
            carried = null;
            try { haptics.ripple(0.3); } catch { /* noop */ }
          }
          return;
        }
        if (carried) {
          // carrying the singularity around
          carried.x = toWorldX(e.x);
          carried.y = toWorldY(e.y);
          return;
        }
        // combing: strokes bend the field along the moving hand
        const dist = Math.hypot(e.dx, e.dy);
        if (dist < 2) return;
        strokeAcc += dist;
        const speed = Math.hypot(e.vx, e.vy); // px per ms
        if (strokeAcc > 14) {
          strokeAcc = 0;
          strokes.push({
            x: toWorldX(e.x), y: toWorldY(e.y),
            ang: Math.atan2(e.dy, e.dx),
            amp: clamp(0.5 + speed * 0.9, 0.5, 2.4),
            sig2: 0.045 / (zoom * zoom),
            t0: simT,
          });
          if (strokes.length > 90) strokes.splice(0, strokes.length - 90);
          try { audioRef.current?.brush(clamp(speed, 0.1, 1)); } catch { /* noop */ }
        }
      },
      flick: (e) => {
        ensureAudio();
        lastGestureAt = performance.now();
        if (e.fingers !== 1 || carried) return;
        // a flick leaves a bigger wake than a stroke
        strokes.push({
          x: toWorldX(e.x), y: toWorldY(e.y),
          ang: e.angle,
          amp: clamp(1.4 + e.speed, 1.4, 3.4),
          sig2: 0.12 / (zoom * zoom),
          t0: simT,
        });
        try { audioRef.current?.brush(1); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
      },
      hold: (e) => {
        ensureAudio();
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the field breathes at 1/4 speed
          if (e.phase === "enter") {
            timeScale.target = 0.25;
            try { audioRef.current?.gather(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") timeScale.target = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdDone = false;
          dwellCued = false;
          const d = defectNear(toWorldX(e.x), toWorldY(e.y));
          if (d && d.q > 0) {
            // dwelling on a sun feeds it — the winding deepens
            feeding = d;
          } else {
            forming = { x: toWorldX(e.x), y: toWorldY(e.y), elapsed: e.elapsed };
            // the hold announces itself once — a low gathering tone
            try { audioRef.current?.gather(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (e.phase === "release") {
          feeding = null;
          if (forming && !holdDone) {
            // the long-press saddle commits at whatever strength it grew to —
            // deferred one tick so a drag preempting the hold cancels it
            const px = forming.x, py = forming.y;
            const strength = clamp(0.45 + (e.elapsed / 1000 - 0.25) / 1.75, 0.45, 1);
            pendingSaddle = window.setTimeout(() => {
              pendingSaddle = 0;
              spawnDefect(-1, px, py, strength);
            }, 0);
          }
          forming = null;
          holdDone = false;
          return;
        }
        // ticks
        if (feeding) {
          if (feeding.dying) { feeding = null; return; }
          feeding.smax = Math.min(1.35, feeding.smax + 0.004);
          feeding.s = Math.min(feeding.smax, feeding.s + 0.004);
          const now = performance.now();
          if (now - lastFeedCueAt > 340) {
            lastFeedCueAt = now;
            try { audioRef.current?.bloom(1, feeding.smax - 0.35); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (forming) {
          forming.x = toWorldX(e.x);
          forming.y = toWorldY(e.y);
          forming.elapsed = e.elapsed;
          // the dwell tier crossed: the gathering plants in earnest — a
          // second, darker tone and a firmer pull mark the saddle taking root
          if (e.tier >= 2 && !dwellCued) {
            dwellCued = true;
            try { audioRef.current?.bloom(-1, 0.5); } catch { /* noop */ }
            try { haptics.ripple(0.35); } catch { /* noop */ }
          }
          // ceremony — the one solemn act: the gathering completes into a
          // charge PAIR, born together, winding conserved.
          if (e.tier >= 3 && !holdDone) {
            holdDone = true;
            const px = forming.x, py = forming.y;
            forming = null;
            const a = spawnDefect(1, px - 0.09, py, 1);
            const b = spawnDefect(-1, px + 0.09, py, 1);
            bursts.push({ x: (a.x + b.x) / 2, y: py, t0: simT, amp: 0.9 });
            try { audioRef.current?.ring(0.8); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
          }
        }
      },
      twist: (e) => {
        ensureAudio();
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers turn the season — the slow weather cycle, not the lens
          if (e.phase === "move") seasonOffset += e.angle * 0.6;
          return;
        }
        // two fingers rotate the global phase — the whole sky turns
        if (e.phase === "move") th0 += e.angle;
      },
      pan2: (e) => {
        ensureAudio();
        lastGestureAt = performance.now();
        // two fingers pan the frame — the camera leans, bounded, world units
        camX = clamp(camX - e.dx / (u * zoom), -1.6, 1.6);
        camY = clamp(camY - e.dy / (u * zoom), -1.6, 1.6);
      },
      drum: (e) => {
        ensureAudio();
        lastGestureAt = performance.now();
        // drumming scatters a syncopated shower of comet sparks between the
        // two drum points — each hit fires from its own side toward the
        // other hand, so the shower alternates with the patter. Reduced
        // motion keeps the brush and the haptic; the sparks stay still.
        const hx = toWorldX(e.x), hy = toWorldY(e.y);
        const otherIsB = Math.hypot(e.x - e.ax, e.y - e.ay) <= Math.hypot(e.x - e.bx, e.y - e.by);
        const ox = toWorldX(otherIsB ? e.bx : e.ax);
        const oy = toWorldY(otherIsB ? e.by : e.ay);
        const ang = Math.atan2(oy - hy, ox - hx);
        strokes.push({
          x: hx, y: hy, ang,
          amp: clamp(1.1 + e.alternation, 1.1, 2.4),
          sig2: 0.06 / (zoom * zoom), t0: simT,
        });
        if (strokes.length > 90) strokes.splice(0, strokes.length - 90);
        bursts.push({ x: hx, y: hy, t0: simT, amp: 0.2 + e.alternation * 0.25 });
        if (!reduceRef.current) {
          for (let k = 0; k < 5; k++) {
            const p = particles[(Math.random() * particles.length) | 0];
            if (!p) break;
            const t = Math.random() * 0.85;
            p.x = hx + (ox - hx) * t + (Math.random() - 0.5) * 0.06;
            p.y = hy + (oy - hy) * t + (Math.random() - 0.5) * 0.06;
            p.age = 0;
            p.life = 0.8 + Math.random() * 0.8;
            p.sp = 0.42 + Math.random() * 0.24;
            p.lx = p.x;
            p.ly = p.y;
            p.skip = true;
          }
        }
        try { audioRef.current?.brush(0.5 + e.alternation * 0.5); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        const now = performance.now();
        if (now - lastScrubAt < 500) return;
        lastScrubAt = now;
        // a circling finger stirs the comets into a ring
        const cx = toWorldX(e.cx), cy = toWorldY(e.cy);
        const sgn = Math.sign(e.winding) || 1;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          strokes.push({
            x: cx + Math.cos(a) * 0.22, y: cy + Math.sin(a) * 0.22,
            ang: a + sgn * Math.PI / 2,
            amp: 1.5, sig2: 0.05 / (zoom * zoom), t0: simT,
          });
        }
        if (strokes.length > 90) strokes.splice(0, strokes.length - 90);
        try { audioRef.current?.brush(0.8); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
      },
      rhythm: (e) => {
        // a steady tapped pulse: the field's breath falls in with the hand
        if (e.stability <= 0.7 || e.bpm < 40 || e.bpm > 200) return;
        lastGestureAt = performance.now();
        entrain.bpm = e.bpm;
        entrain.until = performance.now() + 9000;
        entrain.lastBeat = -1;
      },
    }, { wheelZoom: false });

    // ── the vessel (shared bus): tilt leans the stream, shake slams
    // opposite charges together, a knock rings the field, and face-down
    // is night — the field dims and slows until the phone turns back up.
    // (Distinct from the portrait/landscape flip below, which is this
    // room's own discovery, not the grammar's vessel `flip`.)
    let nightTarget = 0;
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        const g = gravityRef.current;
        g.tx = clamp(gamma / 45, -1, 1);
        g.ty = clamp(beta / 45, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduceRef.current) return;
        shakeRef.current.pending = clamp(intensity, 0.4, 1);
      },
      knock: ({ intensity }) => {
        bursts.push({ x: camX, y: camY, t0: simT, amp: 0.4 + intensity * 0.4 });
        try { audioRef.current?.ring(0.5 + intensity * 0.4); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
      },
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.55, 2.6);
    };

    const hoverRef = { x: 0, y: 0, acc: 0 };
    // hover comb on desktop — the grammar's quiet dialect: the field
    // notices the mouse passing even before any gesture begins
    const onHover = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      const ghost = hoverRef;
      const dx = e.clientX - ghost.x, dy = e.clientY - ghost.y;
      const dist = Math.hypot(dx, dy);
      ghost.acc += dist;
      if (ghost.acc > 26 && dist > 1) {
        ghost.acc = 0;
        strokes.push({
          x: toWorldX(e.clientX), y: toWorldY(e.clientY),
          ang: Math.atan2(dy, dx),
          amp: 0.3, sig2: 0.018 / (zoom * zoom), t0: simT,
        });
        if (strokes.length > 90) strokes.splice(0, strokes.length - 90);
      }
      ghost.x = e.clientX; ghost.y = e.clientY;
    };

    // ── resize / orientation ─────────────────────────────────────────────
    const paintFlat = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgb(${CREAM.r},${CREAM.g},${CREAM.b})`;
      ctx.fillRect(0, 0, w, h);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      dpr = resolveDpr(gov.tier(), { embedded, reducedMotion: reduceRef.current });
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      washCanvas.width = Math.max(2, Math.round(w * 0.25));
      washCanvas.height = Math.max(2, Math.round(h * 0.25));
      u = Math.min(w, h) / 2;
      const nowLandscape = w > h;
      if (landscape !== null && nowLandscape !== landscape && !reduceRef.current) {
        // reorienting the phone runs time backwards
        tDir *= -1;
        bursts.push({ x: camX, y: camY, t0: simT, amp: 0.8 });
        try { audioRef.current?.reverse(); } catch { /* noop */ }
        try { haptics.ripple(0.6); } catch { /* noop */ }
      }
      landscape = nowLandscape;
      paintFlat();
      syncParticles();
    };
    resize();
    paintWash();
    window.addEventListener("resize", resize);

    canvas.addEventListener("pointermove", onHover);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ── main loop ────────────────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();
    let night = 0;

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const tier = gov.beginFrame(now);
      const rawDt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      if (asleep) return;
      void tier; // consumed by targetCount()/resize() via gov.tier(), not per-frame here
      const reduced = reduceRef.current;
      night += (nightTarget - night) * Math.min(1, rawDt * 0.8);
      const speedScale = (reduced ? 0.35 : 1) * (1 - night * 0.7);
      // three-finger time dilation: the field's clock eases to 1/4 speed
      timeScale.cur += (timeScale.target - timeScale.cur) * Math.min(1, rawDt * 5);
      const dt = rawDt * timeScale.cur;
      simT += dt;

      // entrained breath: the winding pulses on each beat of your tempo
      if (now < entrain.until && entrain.bpm > 0) {
        const beatIdx = Math.floor(now / (60000 / entrain.bpm));
        if (beatIdx !== entrain.lastBeat) {
          entrain.lastBeat = beatIdx;
          beatPulse = Math.min(1, beatPulse + 0.55);
          try { audioRef.current?.bloom(1, 0.3); } catch { /* noop */ }
        }
      }
      beatPulse *= Math.exp(-rawDt * 3.2);

      // slow global rotation — the whole sky turns
      th0 += 0.1 * tDir * dt * speedScale;

      // smoothed gravity from tilt
      const g = gravityRef.current;
      g.x = mix(g.x, g.tx, 1 - Math.exp(-dt * 4));
      g.y = mix(g.y, g.ty, 1 - Math.exp(-dt * 4));

      if (shakeRef.current.pending > 0) {
        const amt = shakeRef.current.pending;
        shakeRef.current.pending = 0;
        shake(amt);
      }

      // ── defect dynamics: point vortices with charge conservation ───────
      for (let i = defects.length - 1; i >= 0; i--) {
        const d = defects[i];
        if (d.dying) {
          d.s -= dt * 1.4;
          if (d.s <= 0) { defects.splice(i, 1); continue; }
        } else if (d.s < d.smax) {
          d.s = clamp((simT - d.born) / 0.8, 0.05, 1) * d.smax;
        }
        if (d.slam > 0) d.slam -= dt;
      }
      for (let i = 0; i < defects.length; i++) {
        const d = defects[i];
        if (d.grabbed || d.dying) continue;
        let fx = -d.x * 0.03 + g.x * 0.22;
        let fy = -d.y * 0.03 + g.y * 0.22;
        for (let j = 0; j < defects.length; j++) {
          if (i === j) continue;
          const o = defects[j];
          const dx = d.x - o.x, dy = d.y - o.y;
          const dist = Math.hypot(dx, dy) + 0.06;
          const nx = dx / dist, ny = dy / dist;
          // each vortex rides the flow of the others — this is why two
          // +1s orbit each other on their own
          fx += o.q * o.s * 0.055 * (-ny) / dist;
          fy += o.q * o.s * 0.055 * nx / dist;
          if (d.q * o.q < 0) {
            const pull = (d.slam > 0 || o.slam > 0) ? 1.6 : 0.05;
            fx -= nx * pull / dist * 0.09;
            fy -= ny * pull / dist * 0.09;
          } else {
            fx += nx * 0.016 / dist;
            fy += ny * 0.016 / dist;
          }
        }
        d.x += fx * dt * speedScale * 2.2;
        d.y += fy * dt * speedScale * 2.2;
      }
      // annihilation — opposite charges cancel, winding is conserved
      outer: for (let i = 0; i < defects.length; i++) {
        for (let j = i + 1; j < defects.length; j++) {
          const a = defects[i], b = defects[j];
          if (a.dying || b.dying || a.q * b.q >= 0) continue;
          if (a.s > 0.4 && b.s > 0.4 && Math.hypot(a.x - b.x, a.y - b.y) < 0.09) {
            annihilate(a, b);
            break outer;
          }
        }
      }

      // prune faded strokes
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (simT - strokes[i].t0 > 4.5) strokes.splice(i, 1);
      }

      // ── paint: persistence wash, then heads over their own trails ──────
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      // the wash sprite is repainted on a throttled cadence, never per
      // frame — the draw loop only ever blits it.
      if (now - lastWashPaintAt > 180) {
        lastWashPaintAt = now;
        paintWash();
      }
      ctx.globalAlpha = (reduced ? 0.13 : 0.085) * (1 - night * 0.25);
      ctx.drawImage(washCanvas, 0, 0, w, h);
      ctx.globalAlpha = 1;
      if (night > 0.02) {
        // face-down night: a soft dark veil settles over the field
        ctx.fillStyle = "rgb(20,17,24)";
        ctx.globalAlpha = night * 0.35;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }

      // defect blooms
      for (const d of defects) {
        const sx = toScreenX(d.x), sy = toScreenY(d.y);
        const breathe = 1 + 0.12 * Math.sin(simT * 1.7 + d.born * 3);
        const rad = u * 0.24 * zoom * d.s * breathe;
        if (d.q > 0) {
          ctx.globalCompositeOperation = "lighter";
          ctx.drawImage(bloomPos, sx - rad, sy - rad, rad * 2, rad * 2);
        } else {
          ctx.globalCompositeOperation = "source-over";
          ctx.drawImage(bloomNeg, sx - rad, sy - rad, rad * 2, rad * 2);
          // a saddle wears a thin dark ring so you can find it
          ctx.strokeStyle = `rgba(94,74,138,${0.08 * d.s})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(sx, sy, u * 0.055 * zoom * breathe, 0, TAU);
          ctx.stroke();
        }
      }

      // the saddle forming under a held finger — a ring, and spokes drawn
      // inward as the hold gathers the field toward the coming charge
      if (forming) {
        const grow = clamp((forming.elapsed / 1000 - 0.25) / 1.75, 0, 1);
        const sx = toScreenX(forming.x), sy = toScreenY(forming.y);
        const rad = u * zoom * (0.02 + grow * 0.05);
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = `rgba(94,74,138,${0.25 + grow * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = `rgba(94,74,138,${0.15 + grow * 0.3})`;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + simT * 0.8;
          const r0 = rad * (3.4 - grow * 1.2);
          const r1 = rad * 1.5;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
          ctx.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
          ctx.stroke();
        }
        const dim = u * zoom * 0.6 * grow;
        ctx.drawImage(bloomNeg, sx - dim, sy - dim, dim * 2, dim * 2);
      }

      // bursts
      ctx.globalCompositeOperation = "lighter";
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        const e = (simT - b.t0) / 0.9;
        if (e >= 1) { bursts.splice(i, 1); continue; }
        const sx = toScreenX(b.x), sy = toScreenY(b.y);
        const rad = u * zoom * (0.06 + e * 0.9) * b.amp;
        ctx.globalAlpha = (1 - e) * (1 - e) * 0.45;
        ctx.drawImage(flare, sx - rad, sy - rad, rad * 2, rad * 2);
      }
      ctx.globalAlpha = 1;

      // ── comets ─────────────────────────────────────────────────────────
      const hx = halfExtX() * 1.15, hy = halfExtY() * 1.15;
      for (const p of particles) {
        p.age += dt;
        if (p.age > p.life || Math.abs(p.x - camX) > hx || Math.abs(p.y - camY) > hy) {
          respawn(p);
        }
        const ang = fieldAngle(p.x, p.y);
        const boost = 1 + (now - lastGestureAt < 400 ? 0.15 : 0);
        p.x += (Math.cos(ang) * p.sp * boost * speedScale + g.x * 0.05) * dt * 2.2;
        p.y += (Math.sin(ang) * p.sp * boost * speedScale + g.y * 0.05) * dt * 2.2;

        if (p.skip) { p.skip = false; p.lx = p.x; p.ly = p.y; continue; }
        const fade = Math.min(1, p.age * 6, (p.life - p.age) * 2);
        // near a sun the dashes are tiny and white-hot; out at the rim they
        // grow fatter and darker — the moving-sun look
        let rC = 1.3;
        for (const d of defects) {
          if (d.q > 0 && !d.dying) rC = Math.min(rC, Math.hypot(p.x - d.x, p.y - d.y));
        }
        rC = clamp(rC, 0, 1.3);
        const size = p.sz * (1.0 + rC * 1.5) * (0.8 + zoom * 0.4);
        const tail = tails[p.gi][p.ci];
        const ts = size * 3.1;
        const hs = size * 2.0;
        const tailA = (0.5 + 0.35 * rC) * fade;
        const headA = (0.85 - 0.3 * rC) * fade;

        // stamp continuously along the motion segment so the streak stays a
        // solid tapered dash at any frame rate instead of beading into pearls
        const sx0 = toScreenX(p.lx), sy0 = toScreenY(p.ly);
        const sx1 = toScreenX(p.x), sy1 = toScreenY(p.y);
        const span = Math.hypot(sx1 - sx0, sy1 - sy0);
        const steps = Math.min(8, Math.max(1, Math.ceil(span / 3)));
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const sx = mix(sx0, sx1, t), sy = mix(sy0, sy1, t);
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = tailA;
          ctx.drawImage(tail, sx - ts / 2, sy - ts / 2, ts, ts);
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = k === steps ? headA : headA * 0.55;
          ctx.drawImage(heads[p.gi], sx - hs / 2, sy - hs / 2, hs, hs);
        }
        p.lx = p.x;
        p.ly = p.y;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // glimmer (grammar §6): after ~20s of quiet a faint turning ring
      // floats where a circling finger would stir — physical, never text.
      if (now - lastGestureAt > 20000) {
        const slot = Math.floor(now / 9000);
        const gseed = (n: number) => { const v = Math.sin((slot + n) * 127.1) * 43758.5453; return v - Math.floor(v); };
        const gx = (0.22 + gseed(0) * 0.56) * w;
        const gy = (0.25 + gseed(7) * 0.5) * h;
        const pulse = reduced ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = `rgba(124,90,51,${(0.05 + pulse * 0.07).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 20 + pulse * 9, 0, TAU);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      detachGestures();
      detachVessel();
      unvis();
      ungal();
      if (pendingSaddle) window.clearTimeout(pendingSaddle);
      canvas.removeEventListener("pointermove", onHover);
      canvas.removeEventListener("wheel", onWheel);
      reduceQuery.removeEventListener?.("change", onReduce);
      try { audioRef.current?.dispose(); } catch { /* noop */ }
      audioRef.current = null;
      clearFieldRef.current = () => {};
    };
  }, [ensureAudio]);

  const letGo = useCallback(() => {
    clearFieldRef.current();
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
  }, []);

  return (
    <div className="comb-stage">
      <canvas
        ref={canvasRef}
        className="comb-canvas"
        role="img"
        aria-label="A cream-colored field of comet-like light streaks orbiting glowing singularities. Tap to bloom a new vortex; press and hold to grow a dark saddle, or hold longer to bear a matched pair; rest on a glowing center to feed it; slide or flick to comb the light; circle a finger to stir it; drag a glowing center to carry it; twist two fingers to rotate the whole field; shake the phone to slam opposite charges together until they annihilate in a burst; tilt to lean the stream; and flip the phone sideways to run time backwards."
      />
      <div className="comb-title" aria-hidden="true">
        <span>comb the light — the cowlick stays</span>
        <strong>comb</strong>
      </div>
      <LetGo label="let the field settle" onLetGo={letGo} visible={hasChanged} />
      <div className="comb-hud">
        <span className="comb-hint" aria-hidden="true">tap vortex · hold saddle · comb the light</span>
        {motionUI === "prompt" && (
          <button
            type="button"
            className="comb-motion-chip"
            aria-label="Enable motion so tilting leans the light and shaking slams the charges together"
            onClick={() => { ensureAudio(); armSensors(); }}
          >
            <span aria-hidden="true">◒</span>
            <span>tilt &amp; shake to play</span>
          </button>
        )}
        {motionUI === "on" && (
          <div className="comb-motion-chip comb-motion-on" aria-hidden="true">
            <span>◒</span>
            <span>tilt &amp; shake live</span>
          </div>
        )}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
.comb-stage {
  position: fixed;
  inset: 0;
  background: #f4ecdd;
  overflow: hidden;
}
.comb-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
}
.comb-title {
  position: absolute;
  left: 18px;
  bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  color: #574430;
  font-size: 12px;
  letter-spacing: 0.04em;
}
.comb-title strong {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #3f3020;
}
.comb-hud {
  position: absolute;
  right: 16px;
  bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.comb-hint {
  color: rgba(87, 68, 48, 0.55);
  font-size: 11px;
  letter-spacing: 0.08em;
  pointer-events: none;
}
.comb-motion-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(87, 68, 48, 0.3);
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: #4a3a27;
  background: rgba(255, 251, 240, 0.75);
  backdrop-filter: blur(6px);
  cursor: pointer;
}
.comb-motion-chip:active { transform: scale(0.97); }
.comb-motion-on {
  cursor: default;
  opacity: 0.65;
}
@media (prefers-reduced-motion: reduce) {
  .comb-motion-chip { display: none; }
}
`,
        }}
      />
    </div>
  );
}
