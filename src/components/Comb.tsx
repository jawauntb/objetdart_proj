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
// tap                bloom a +1 vortex where you touch
// long-press         grow a −1 saddle; the longer the hold, the stronger
// slide / flick      comb the field — comets swing to follow your stroke
// drag a defect      carry the singularity around
// pinch              zoom into the singularity
// two-finger twist   rotate the global phase
// two-finger drag    pan across the field
// shake              slam opposite charges together — annihilation
// tilt               gravity leans the whole comet stream
// flip the phone     portrait↔landscape reverses time

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";

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

type Pointer = {
  x0: number; y0: number; x: number; y: number;
  px: number; py: number; pt: number;          // previous sample for velocity
  t0: number;
  moved: boolean;
  defect: Defect | null;
  emitted: number;                              // px of stroke path emitted
};

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
  const audioRef = useRef<CombAudio | null>(null);
  const armSensorsRef = useRef<() => void>(() => {});
  const motionRef = useRef<{
    armed: boolean;
    lastMag: number | null;
    lastShakeAt: number;
    onOrient: ((e: DeviceOrientationEvent) => void) | null;
    onMotion: ((e: DeviceMotionEvent) => void) | null;
  }>({ armed: false, lastMag: null, lastShakeAt: 0, onOrient: null, onMotion: null });
  const gravityRef = useRef({ tx: 0, ty: 0, x: 0, y: 0 });
  const shakeRef = useRef({ pending: 0 });
  const reduceRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = createCombAudio();
    audioRef.current.kick();
  }, []);

  // ── device motion: tilt leans the stream, shake annihilates ────────────
  const armSensors = useCallback(() => {
    if (typeof window === "undefined" || motionRef.current.armed) return;
    motionRef.current.armed = true;

    const onOrient = (e: DeviceOrientationEvent) => {
      const g = gravityRef.current;
      g.tx = clamp((e.gamma ?? 0) / 45, -1, 1);
      g.ty = clamp((e.beta ?? 0) / 45, -1, 1);
    };

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const m = motionRef.current;
      if (m.lastMag != null) {
        const jolt = Math.abs(mag - m.lastMag);
        const hard = reduceRef.current ? 22 : 14;
        const now = performance.now();
        if (jolt > hard && now - m.lastShakeAt > 650) {
          m.lastShakeAt = now;
          shakeRef.current.pending = clamp(jolt / 30, 0.4, 1);
        }
      }
      m.lastMag = mag;
    };

    motionRef.current.onOrient = onOrient;
    motionRef.current.onMotion = onMotion;

    type PermCtor = { requestPermission?: () => Promise<"granted" | "denied"> };
    const DOE = (window as unknown as { DeviceOrientationEvent?: PermCtor }).DeviceOrientationEvent;
    const DME = (window as unknown as { DeviceMotionEvent?: PermCtor }).DeviceMotionEvent;
    const add = () => {
      window.addEventListener("deviceorientation", onOrient);
      window.addEventListener("devicemotion", onMotion);
      setMotionUI("on");
    };
    if (DOE && typeof DOE.requestPermission === "function") {
      Promise.allSettled([DOE.requestPermission?.(), DME?.requestPermission?.()])
        .then((res) => {
          if (res.some((r) => r.status === "fulfilled" && r.value === "granted")) add();
          else motionRef.current.armed = false;
        })
        .catch(() => { motionRef.current.armed = false; });
    } else {
      add();
    }
  }, []);
  armSensorsRef.current = armSensors;

  // decide the motion affordance on mount; auto-arm where no permission is
  // needed (Android/desktop), show a chip on iOS, clean up on unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
    };
    const hasAny = "DeviceOrientationEvent" in window || "DeviceMotionEvent" in window;
    if (!hasAny) { setMotionUI("hidden"); return; }
    const needsPerm = !!(w.DeviceOrientationEvent && typeof w.DeviceOrientationEvent.requestPermission === "function");
    if (needsPerm) setMotionUI("prompt");
    else armSensors();
    const m = motionRef.current;
    return () => {
      if (m.onOrient) window.removeEventListener("deviceorientation", m.onOrient);
      if (m.onMotion) window.removeEventListener("devicemotion", m.onMotion);
      m.armed = false; m.onOrient = null; m.onMotion = null;
    };
  }, [armSensors]);

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

    let w = 0, h = 0, dpr = 1, u = 1;
    let landscape: boolean | null = null;

    // camera
    let zoom = 1;
    let camX = 0, camY = 0;

    // global field state
    let th0 = 0;                 // global phase (twist + slow rotation)
    let tDir = 1;                // time direction — flipping the phone reverses it
    let simT = 0;

    const defects: Defect[] = [
      { x: -0.34, y: 0.08, q: 1, s: 1, smax: 1, born: -10, dying: false, slam: 0, grabbed: false },
      { x: 0.38, y: -0.12, q: 1, s: 1, smax: 1, born: -10, dying: false, slam: 0, grabbed: false },
    ];
    const strokes: Stroke[] = [];
    const bursts: Burst[] = [];
    const particles: Particle[] = [];
    let forming: { x: number; y: number; start: number } | null = null;

    const pointers = new Map<number, Pointer>();
    let pinch: {
      d0: number; a0: number; z0: number; th0_0: number;
      cx0: number; cy0: number; camX0: number; camY0: number;
    } | null = null;

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
      const k = 0.32 + 0.22 * Math.sin(simT * 0.061);
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
      const phase = simT * 0.014;
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
      return reduceRef.current ? Math.round(base * 0.55) : base;
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
      return d;
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

    const beginPinch = () => {
      const pts = [...pointers.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      pinch = {
        d0: Math.max(20, Math.hypot(b.x - a.x, b.y - a.y)),
        a0: Math.atan2(b.y - a.y, b.x - a.x),
        z0: zoom,
        th0_0: th0,
        cx0: (a.x + b.x) / 2,
        cy0: (a.y + b.y) / 2,
        camX0: camX,
        camY0: camY,
      };
      forming = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      ensureAudio();
      canvas.setPointerCapture?.(e.pointerId);
      const wx = toWorldX(e.clientX), wy = toWorldY(e.clientY);
      const p: Pointer = {
        x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        px: e.clientX, py: e.clientY, pt: performance.now(),
        t0: performance.now(), moved: false,
        defect: null, emitted: 0,
      };
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        const d = defectNear(wx, wy);
        if (d) { p.defect = d; d.grabbed = true; }
      } else if (pointers.size === 2) {
        for (const q of pointers.values()) {
          if (q.defect) { q.defect.grabbed = false; q.defect = null; }
        }
        beginPinch();
      }
    };

    const emitStrokes = (p: Pointer, fromX: number, fromY: number, fromT: number) => {
      const dx = p.x - fromX, dy = p.y - fromY;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) return;
      p.emitted += dist;
      const dtms = Math.max(8, p.pt - fromT);
      const speed = dist / dtms; // px per ms
      if (p.emitted > 14) {
        p.emitted = 0;
        strokes.push({
          x: toWorldX(p.x), y: toWorldY(p.y),
          ang: Math.atan2(dy, dx),
          amp: clamp(0.5 + speed * 0.9, 0.5, 2.4),
          sig2: 0.045 / (zoom * zoom),
          t0: simT,
        });
        if (strokes.length > 90) strokes.splice(0, strokes.length - 90);
        try { audioRef.current?.brush(clamp(speed, 0.1, 1)); } catch { /* noop */ }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        // hover comb on desktop — the field notices the mouse passing
        if (e.pointerType === "mouse" && e.buttons === 0 && pointers.size === 0) {
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
        }
        return;
      }
      const fromX = p.x, fromY = p.y, fromT = p.pt;
      p.px = fromX; p.py = fromY;
      p.x = e.clientX; p.y = e.clientY;
      p.pt = performance.now();
      if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 10) {
        p.moved = true;
        forming = null;
      }

      if (pointers.size >= 2 && pinch) {
        const pts = [...pointers.values()];
        const [a, b] = pts;
        const d = Math.max(20, Math.hypot(b.x - a.x, b.y - a.y));
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        zoom = clamp(pinch.z0 * (d / pinch.d0), 0.55, 2.6);
        th0 = pinch.th0_0 + (ang - pinch.a0);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        camX = pinch.camX0 - (cx - pinch.cx0) / (u * zoom);
        camY = pinch.camY0 - (cy - pinch.cy0) / (u * zoom);
        return;
      }

      if (p.defect) {
        p.defect.x = toWorldX(e.clientX);
        p.defect.y = toWorldY(e.clientY);
        return;
      }
      if (p.moved) emitStrokes(p, fromX, fromY, fromT);
    };

    const onPointerEnd = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;

      if (p.defect) {
        p.defect.grabbed = false;
        try { haptics.ripple(0.3); } catch { /* noop */ }
        return;
      }

      const held = (performance.now() - p.t0) / 1000;
      const wx = toWorldX(p.x), wy = toWorldY(p.y);

      if (forming) {
        // the long-press saddle commits at whatever strength it grew to
        const strength = clamp(0.45 + (held - 0.38) / 1.2, 0.45, 1);
        spawnDefect(-1, forming.x, forming.y, strength);
        forming = null;
        return;
      }

      if (!p.moved && held < 0.32 && e.type !== "pointercancel") {
        const d = spawnDefect(1, wx, wy);
        bursts.push({ x: d.x, y: d.y, t0: simT, amp: 0.5 });
        return;
      }

      if (p.moved) {
        // a flick leaves a bigger wake than a stroke
        const dtms = Math.max(16, performance.now() - p.pt + 16);
        const speed = Math.hypot(p.x - p.px, p.y - p.py) / dtms;
        if (speed > 0.6) {
          strokes.push({
            x: wx, y: wy,
            ang: Math.atan2(p.y - p.py, p.x - p.px),
            amp: clamp(1.4 + speed, 1.4, 3.4),
            sig2: 0.12 / (zoom * zoom),
            t0: simT,
          });
          try { audioRef.current?.brush(1); } catch { /* noop */ }
          try { haptics.chop(); } catch { /* noop */ }
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.55, 2.6);
    };

    const hoverRef = { x: 0, y: 0, acc: 0 };

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
      dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
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
    window.addEventListener("resize", resize);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ── main loop ────────────────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      if (document.hidden) return;
      const reduced = reduceRef.current;
      const speedScale = reduced ? 0.35 : 1;
      simT += dt;

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

      // ── long-press saddle forming under a still finger ─────────────────
      const wasForming = forming !== null;
      forming = null;
      if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        const held = (now - p.t0) / 1000;
        if (!p.moved && !p.defect && held > 0.38) {
          forming = { x: toWorldX(p.x), y: toWorldY(p.y), start: p.t0 };
          if (!wasForming) {
            // the hold announces itself once — a low gathering tone, so a
            // long press feels different from a tap the moment it begins
            try { audioRef.current?.gather(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
        }
      }

      // ── paint: persistence wash, then heads over their own trails ──────
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
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
      const wash = ctx.createRadialGradient(
        w / 2 + Math.sin(simT * 0.05) * w * 0.08,
        h / 2 + Math.cos(simT * 0.041) * h * 0.08,
        Math.min(w, h) * 0.1,
        w / 2, h / 2, Math.hypot(w, h) * 0.62,
      );
      wash.addColorStop(0, `rgb(${inner.r},${inner.g},${inner.b})`);
      wash.addColorStop(1, `rgb(${edge.r},${edge.g},${edge.b})`);
      ctx.globalAlpha = reduced ? 0.13 : 0.085;
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

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
        const grow = clamp(((now - forming.start) / 1000 - 0.38) / 1.1, 0, 1);
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
        const boost = 1 + (pointers.size > 0 ? 0.15 : 0);
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
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("wheel", onWheel);
      reduceQuery.removeEventListener?.("change", onReduce);
      try { audioRef.current?.dispose(); } catch { /* noop */ }
      audioRef.current = null;
    };
  }, [ensureAudio]);

  return (
    <div className="comb-stage">
      <canvas
        ref={canvasRef}
        className="comb-canvas"
        role="img"
        aria-label="A cream-colored field of comet-like light streaks orbiting glowing singularities. Tap to bloom a new vortex; press and hold to grow a dark saddle; slide or flick to comb the light; drag a glowing center to carry it; pinch to zoom; twist two fingers to rotate the whole field; shake the phone to slam opposite charges together until they annihilate in a burst; tilt to lean the stream; and flip the phone sideways to run time backwards."
      />
      <div className="comb-title" aria-hidden="true">
        <span>comb the light — the cowlick stays</span>
        <strong>comb</strong>
      </div>
      <div className="comb-hud">
        <span className="comb-hint" aria-hidden="true">tap vortex · hold saddle · comb · pinch</span>
        {motionUI === "prompt" && (
          <button
            type="button"
            className="comb-motion-chip"
            aria-label="Enable motion so tilting leans the light and shaking slams the charges together"
            onClick={() => { ensureAudio(); armSensorsRef.current(); }}
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
