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

// ─────────────────────────────────────────────────────────────────────────
// Objet d'Art · /drop — a living bead of RAINWATER.
//
// This is a 2D-canvas take built around tactile water physics. The droplet is
// a surface-tension soft body: a cohesive bead that holds a round shape,
// wobbles through damped spherical-harmonic modes when poked or flung, and
// springs back. A metaball field lets beads NECK and PINCH apart on split and
// GLOOP together on merge. Zooming magnifies the water and reveals microscopic
// life rendered dark-field: bright translucent organisms glowing on deep water.
// ─────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-4), 0, 1);
  return t * t * (3 - 2 * t);
};

const MAX_DROPS = 5;

// ── Microscopic life ─────────────────────────────────────────────────────
type Species =
  | "mote"
  | "paramecium"
  | "amoeba"
  | "diatom"
  | "rotifer"
  | "tardigrade"
  | "euglena"
  | "volvox"
  | "bacterium";

type SpeciesDef = {
  minZoom: number; // fades in around here
  maxZoom: number; // fades out beyond here
  size: number; // local-radius fraction
  speed: number; // local units / second
  wander: number; // heading jitter
};

const SPECIES: Record<Species, SpeciesDef> = {
  mote:       { minZoom: 0.0,  maxZoom: 0.34, size: 0.022, speed: 0.06, wander: 2.2 },
  diatom:     { minZoom: 0.12, maxZoom: 1.0,  size: 0.10,  speed: 0.05, wander: 0.5 },
  paramecium: { minZoom: 0.13, maxZoom: 1.0,  size: 0.12,  speed: 0.17, wander: 0.9 },
  amoeba:     { minZoom: 0.15, maxZoom: 1.0,  size: 0.14,  speed: 0.03, wander: 1.4 },
  euglena:    { minZoom: 0.17, maxZoom: 1.0,  size: 0.12,  speed: 0.15, wander: 1.1 },
  rotifer:    { minZoom: 0.21, maxZoom: 1.0,  size: 0.11,  speed: 0.09, wander: 0.8 },
  volvox:     { minZoom: 0.24, maxZoom: 1.0,  size: 0.15,  speed: 0.035, wander: 0.4 },
  tardigrade: { minZoom: 0.30, maxZoom: 1.0,  size: 0.14,  speed: 0.04, wander: 0.6 },
  bacterium:  { minZoom: 0.5,  maxZoom: 1.0,  size: 0.03,  speed: 0.2,  wander: 3.5 },
};

type Microbe = {
  sp: Species;
  x: number; // local coords in unit disc (-1..1)
  y: number;
  depth: number; // 0..1 parallax layer
  heading: number;
  size: number; // local-radius fraction
  phase: number;
  spin: number;
  seed: number;
  dart: number; // seconds of boosted motion remaining
};

// A damped surface-oscillation mode (spherical-harmonic radius term).
type Mode = { k: number; a: number; v: number; omega: number; damp: number };

type Drop = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  modes: Mode[];
  mic: Microbe[];
  grabbed: boolean;
  gx: number; // grab offset
  gy: number;
  mergeLock: number; // time (s) until which merging is suppressed
  bob: number; // idle buoyancy phase
};

let DROP_ID = 1;

function makeModes(reduced: boolean): Mode[] {
  // Rayleigh-style ordering: higher harmonics ring faster. baseW/damp tuned so
  // a poke rings a few times then settles — liquid, never rigid.
  const baseW = 2.15;
  const damp = reduced ? 2.4 : 1.05;
  return [2, 3, 4, 5].map((k) => ({
    k,
    a: 0,
    v: 0,
    omega: baseW * Math.sqrt(k * (k - 1) * (k + 2)) * 0.5,
    damp,
  }));
}

function populate(drop: Drop, reduced: boolean): void {
  const plan: Array<[Species, number]> = [
    ["mote", 6],
    ["paramecium", 1],
    ["amoeba", 1],
    ["diatom", 1],
    ["euglena", 1],
    ["rotifer", 1],
    ["volvox", 1],
    ["tardigrade", 1],
    ["bacterium", 3],
  ];
  const list: Microbe[] = [];
  for (const [sp, n] of plan) {
    for (let i = 0; i < n; i++) {
      const rr = Math.sqrt(Math.random()) * 0.78;
      const a = Math.random() * TAU;
      list.push({
        sp,
        x: Math.cos(a) * rr,
        y: Math.sin(a) * rr,
        depth: Math.random(),
        heading: Math.random() * TAU,
        size: SPECIES[sp].size * rand(0.8, 1.25),
        phase: Math.random() * TAU,
        spin: (Math.random() - 0.5) * (reduced ? 0.2 : 1),
        seed: Math.random() * 1000,
        dart: 0,
      });
    }
  }
  drop.mic = list;
}

function makeDrop(x: number, y: number, r: number, reduced: boolean): Drop {
  const d: Drop = {
    id: DROP_ID++,
    x, y, vx: 0, vy: 0, r,
    modes: makeModes(reduced),
    mic: [],
    grabbed: false, gx: 0, gy: 0,
    mergeLock: 0,
    bob: Math.random() * TAU,
  };
  populate(d, reduced);
  return d;
}

// signed radial displacement fraction of the surface at angle θ
function modeSum(d: Drop, theta: number): number {
  let s = 0;
  for (const m of d.modes) s += m.a * Math.cos(m.k * theta);
  return clamp(s, -0.42, 0.42);
}

// Excite modes to localise a dent at `angle` with the given strength.
function poke(d: Drop, angle: number, strength: number): void {
  for (const m of d.modes) m.v -= strength * Math.cos(m.k * angle) * 6;
}

// ── Water audio — a present interactive layer over the "aphros" bed ────────
type WaterAudio = {
  ready: boolean;
  kick: () => void;
  drip: (bright?: number) => void;
  plip: () => void;
  gloop: () => void;
  ripple: (strength: number) => void;
  bloop: () => void;
  setDepth: (z: number) => void;
  dispose: () => void;
};

function createWaterAudio(): WaterAudio {
  const fa = getFieldAudio();
  let ctx: AudioContext | null = null;
  let bus: GainNode | null = null;
  let burbleGain: GainNode | null = null;
  let burbleLP: BiquadFilterNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let sources: AudioScheduledSourceNode[] = [];
  let ready = false;

  const noise = (c: AudioContext): AudioBuffer => {
    if (noiseBuf) return noiseBuf;
    const len = c.sampleRate * 1.2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.2;
    }
    noiseBuf = buf;
    return buf;
  };

  const ensure = (): boolean => {
    if (ready && ctx) return true;
    try { void fa.start(); } catch { /* noop */ }
    const c = fa.getAudioContext();
    if (!c) return false;
    ctx = c;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    bus = c.createGain();
    bus.gain.value = fa.isMuted() ? 0 : 0.9;
    bus.connect(c.destination);
    // underwater burble drone whose lowpass opens as you descend
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    burbleLP = c.createBiquadFilter();
    burbleLP.type = "lowpass";
    burbleLP.frequency.value = 240;
    burbleLP.Q.value = 0.8;
    burbleGain = c.createGain();
    burbleGain.gain.value = 0.0;
    src.connect(burbleLP).connect(burbleGain).connect(bus);
    try { src.start(); } catch { /* noop */ }
    sources.push(src);
    ready = true;
    return true;
  };

  const tone = (
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
    lp?: number,
  ) => {
    if (!ctx || !bus || fa.isMuted()) return;
    const c = ctx;
    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.006);
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

  const noiseBurst = (dur: number, peak: number, bp: number, q: number) => {
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
    g.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f).connect(g).connect(bus);
    try { src.start(now); src.stop(now + dur + 0.04); } catch { /* noop */ }
  };

  return {
    get ready() { return ready; },
    kick() { ensure(); },
    drip(bright = 0.5) {
      if (!ensure()) return;
      tone("sine", mix(620, 1000, bright), mix(190, 260, bright), 0.13, 0.1);
      tone("sine", mix(1300, 1900, bright), 900, 0.05, 0.03);
      noiseBurst(0.05, 0.04, 1600, 3);
    },
    plip() {
      if (!ensure()) return;
      tone("sine", 1180, 300, 0.12, 0.11);
      tone("triangle", 1900, 1200, 0.06, 0.05);
      noiseBurst(0.05, 0.05, 2200, 4);
    },
    gloop() {
      if (!ensure()) return;
      tone("sine", 320, 92, 0.24, 0.13, 480);
      tone("sine", 190, 70, 0.3, 0.08, 300);
      noiseBurst(0.09, 0.05, 420, 2);
    },
    ripple(strength) {
      if (!ensure()) return;
      const s = clamp(strength, 0.1, 1);
      tone("sine", 260, 120, 0.18, 0.05 + s * 0.05);
      noiseBurst(0.12, 0.03 + s * 0.04, 520, 1.5);
    },
    bloop() {
      if (!ensure()) return;
      tone("sine", rand(440, 620), 300, 0.09, 0.03);
    },
    setDepth(z) {
      if (!ready || !ctx || !burbleGain || !burbleLP || !bus) return;
      const muted = fa.isMuted();
      const now = ctx.currentTime;
      bus.gain.setTargetAtTime(muted ? 0 : 0.9, now, 0.1);
      burbleLP.frequency.setTargetAtTime(180 + z * 1500, now, 0.2);
      burbleGain.gain.setTargetAtTime(muted ? 0 : 0.018 + z * 0.05, now, 0.25);
    },
    dispose() {
      for (const s of sources) { try { s.stop(); s.disconnect(); } catch { /* noop */ } }
      sources = [];
      try { burbleGain?.disconnect(); burbleLP?.disconnect(); bus?.disconnect(); } catch { /* noop */ }
      ctx = null; bus = null; burbleGain = null; burbleLP = null; ready = false;
    },
  };
}

// ── Creature drawing (ctx pre-translated to microbe centre, rotated, scaled by
//    its pixel size `s`). All translucent, drawn under a 'lighter' composite so
//    they glow on the dark water field. ─────────────────────────────────────
function glowBlob(ctx: CanvasRenderingContext2D, s: number, col: string, a: number) {
  ctx.fillStyle = col.replace("$a", String(a * 0.5));
  ctx.beginPath(); ctx.arc(0, 0, s * 1.7, 0, TAU); ctx.fill();
  ctx.fillStyle = col.replace("$a", String(a));
  ctx.beginPath(); ctx.arc(0, 0, s * 0.9, 0, TAU); ctx.fill();
}

function drawMote(ctx: CanvasRenderingContext2D, s: number) {
  glowBlob(ctx, s, "rgba(150,220,255,$a)", 0.5);
}

function drawParamecium(ctx: CanvasRenderingContext2D, s: number, t: number) {
  ctx.save();
  ctx.scale(1.7, 0.78);
  ctx.fillStyle = "rgba(130,235,255,0.09)";
  ctx.beginPath(); ctx.arc(0, 0, s * 1.35, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(165,245,255,0.16)";
  ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
  ctx.restore();
  // beating cilia around the slipper
  ctx.strokeStyle = "rgba(200,250,255,0.28)";
  ctx.lineWidth = s * 0.05;
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * TAU;
    const wag = Math.sin(t * 7 + k * 0.9) * 0.35;
    const ex = Math.cos(a) * s * 1.7, ey = Math.sin(a) * s * 0.82;
    const ox = Math.cos(a + wag) * s * 0.42, oy = Math.sin(a + wag) * s * 0.42;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + ox, ey + oy); ctx.stroke();
  }
  // oral groove + a couple of vacuoles
  ctx.strokeStyle = "rgba(120,220,255,0.3)";
  ctx.lineWidth = s * 0.08;
  ctx.beginPath(); ctx.moveTo(-s * 0.4, -s * 0.1); ctx.quadraticCurveTo(0, s * 0.3, s * 0.5, 0); ctx.stroke();
  ctx.fillStyle = "rgba(190,250,255,0.22)";
  ctx.beginPath(); ctx.arc(-s * 0.5, 0, s * 0.16, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.55, s * 0.05, s * 0.13, 0, TAU); ctx.fill();
}

function drawAmoeba(ctx: CanvasRenderingContext2D, s: number, t: number, seed: number) {
  const lobes = 7;
  ctx.beginPath();
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * TAU;
    const puls = 1 + Math.sin(t * 1.6 + i * 1.7 + seed) * 0.34 + Math.sin(t * 0.7 + i) * 0.12;
    const rr = s * puls;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.quadraticCurveTo(Math.cos(a - 0.3) * rr * 1.15, Math.sin(a - 0.3) * rr * 1.15, x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(150,240,205,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(180,250,220,0.22)";
  ctx.lineWidth = s * 0.05;
  ctx.stroke();
  ctx.fillStyle = "rgba(120,230,190,0.3)";
  ctx.beginPath(); ctx.arc(Math.cos(t * 0.4) * s * 0.2, Math.sin(t * 0.3) * s * 0.2, s * 0.28, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(210,255,240,0.25)";
  ctx.beginPath(); ctx.arc(s * 0.35, -s * 0.3, s * 0.14, 0, TAU); ctx.fill();
}

function drawDiatom(ctx: CanvasRenderingContext2D, s: number, t: number, seed: number) {
  const pennate = Math.floor(seed) % 2 === 0;
  const hue = 150 + Math.sin(t * 0.6 + seed) * 40; // iridescent shimmer
  const stroke = `hsla(${hue}, 90%, 78%, 0.4)`;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = `hsla(${hue}, 90%, 80%, 0.08)`;
  ctx.lineWidth = s * 0.05;
  if (pennate) {
    // boat-shaped valve with transverse striae
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.5, s * 0.55, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 1.4, 0); ctx.lineTo(s * 1.4, 0); ctx.stroke();
    for (let i = -6; i <= 6; i++) {
      const x = (i / 6) * s * 1.35;
      const h = s * 0.5 * Math.sqrt(Math.max(0, 1 - (x / (s * 1.5)) ** 2));
      ctx.beginPath(); ctx.moveTo(x, -h); ctx.lineTo(x, h); ctx.stroke();
    }
  } else {
    // radial disc with spokes + concentric ring
    ctx.beginPath(); ctx.arc(0, 0, s * 1.1, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, TAU); ctx.stroke();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62);
      ctx.lineTo(Math.cos(a) * s * 1.1, Math.sin(a) * s * 1.1); ctx.stroke();
    }
  }
}

function drawRotifer(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const tele = 1 + Math.sin(t * 1.4) * 0.18; // telescoping trunk
  // tapering trunk + forked foot
  ctx.fillStyle = "rgba(160,235,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, -s * 0.5);
  ctx.quadraticCurveTo(-s * 0.2, s * 1.4 * tele, 0, s * 1.7 * tele);
  ctx.quadraticCurveTo(s * 0.2, s * 1.4 * tele, s * 0.5, -s * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(190,245,255,0.25)";
  ctx.lineWidth = s * 0.05;
  // forked foot
  ctx.beginPath(); ctx.moveTo(0, s * 1.6 * tele); ctx.lineTo(-s * 0.22, s * 1.95 * tele);
  ctx.moveTo(0, s * 1.6 * tele); ctx.lineTo(s * 0.22, s * 1.95 * tele); ctx.stroke();
  // two spinning ciliary coronas
  for (const cx of [-s * 0.42, s * 0.42]) {
    ctx.save(); ctx.translate(cx, -s * 0.55);
    ctx.fillStyle = "rgba(210,250,255,0.16)";
    ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(225,252,255,0.4)";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + t * 2.4;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5);
      ctx.lineTo(Math.cos(a) * s * 0.72, Math.sin(a) * s * 0.72); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawTardigrade(ctx: CanvasRenderingContext2D, s: number, t: number) {
  // plump segmented water bear
  ctx.fillStyle = "rgba(200,220,180,0.12)";
  ctx.strokeStyle = "rgba(215,235,195,0.22)";
  ctx.lineWidth = s * 0.05;
  for (let i = 0; i < 4; i++) {
    const x = -s * 0.9 + i * s * 0.62;
    ctx.beginPath(); ctx.arc(x, 0, s * 0.72, 0, TAU); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(s * 1.35, 0, s * 0.55, 0, TAU); ctx.fill(); // snout
  // 8 stubby legs lumbering
  ctx.lineWidth = s * 0.2;
  ctx.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const x = -s * 0.8 + i * s * 0.62;
    const swA = Math.sin(t * 3 + i) * 0.4;
    const swB = Math.sin(t * 3 + i + Math.PI) * 0.4;
    ctx.beginPath(); ctx.moveTo(x, s * 0.5); ctx.lineTo(x + swA * s * 0.4, s * 1.0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, -s * 0.5); ctx.lineTo(x + swB * s * 0.4, -s * 1.0); ctx.stroke();
  }
  ctx.lineCap = "butt";
}

function drawEuglena(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const flex = Math.sin(t * 2.2) * 0.4; // metaboly
  ctx.fillStyle = "rgba(150,240,150,0.14)";
  ctx.strokeStyle = "rgba(180,250,170,0.24)";
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.moveTo(-s * 1.5, 0);
  ctx.quadraticCurveTo(0, -s * 0.55 - flex * s, s * 1.5, 0);
  ctx.quadraticCurveTo(0, s * 0.55 - flex * s, -s * 1.5, 0);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // red eyespot
  ctx.fillStyle = "rgba(255,90,70,0.6)";
  ctx.beginPath(); ctx.arc(-s * 1.05, -flex * s * 0.4, s * 0.16, 0, TAU); ctx.fill();
  // whipping flagellum
  ctx.strokeStyle = "rgba(210,255,200,0.4)";
  ctx.lineWidth = s * 0.06;
  ctx.beginPath(); ctx.moveTo(-s * 1.5, 0);
  for (let i = 1; i <= 8; i++) {
    const p = i / 8;
    const x = -s * 1.5 - p * s * 1.4;
    const y = Math.sin(t * 9 - p * 6) * s * 0.4 * p;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawVolvox(ctx: CanvasRenderingContext2D, s: number, t: number, seed: number) {
  ctx.fillStyle = "rgba(120,230,160,0.08)";
  ctx.beginPath(); ctx.arc(0, 0, s * 1.4, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(160,245,190,0.28)";
  ctx.lineWidth = s * 0.04;
  ctx.beginPath(); ctx.arc(0, 0, s * 1.4, 0, TAU); ctx.stroke();
  // surface daughter colonies, rotating
  ctx.fillStyle = "rgba(190,255,200,0.4)";
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU + t * 0.5;
    const rr = s * 1.4 * (0.55 + 0.45 * Math.abs(Math.sin(i * 2.3 + seed)));
    ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, s * 0.12, 0, TAU); ctx.fill();
  }
  // a couple of inner colonies
  ctx.fillStyle = "rgba(150,240,180,0.3)";
  ctx.beginPath(); ctx.arc(Math.cos(t * 0.6) * s * 0.4, Math.sin(t * 0.5) * s * 0.4, s * 0.3, 0, TAU); ctx.fill();
}

function drawBacterium(ctx: CanvasRenderingContext2D, s: number, seed: number) {
  const kind = Math.floor(seed) % 3;
  ctx.strokeStyle = "rgba(210,240,255,0.5)";
  ctx.fillStyle = "rgba(200,235,255,0.4)";
  ctx.lineWidth = s * 0.9;
  ctx.lineCap = "round";
  if (kind === 0) {
    ctx.beginPath(); ctx.moveTo(-s * 1.3, 0); ctx.lineTo(s * 1.3, 0); ctx.stroke(); // rod
  } else if (kind === 1) {
    ctx.beginPath(); ctx.arc(-s * 0.6, 0, s * 0.7, 0, TAU); ctx.fill(); // cocci pair
    ctx.beginPath(); ctx.arc(s * 0.6, 0, s * 0.7, 0, TAU); ctx.fill();
  } else {
    ctx.lineWidth = s * 0.6;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const x = -s * 1.4 + (i / 12) * s * 2.8;
      const y = Math.sin(i * 1.1) * s * 0.6;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); // spiral
  }
  ctx.lineCap = "butt";
}

function drawMicrobe(ctx: CanvasRenderingContext2D, m: Microbe, s: number, t: number) {
  switch (m.sp) {
    case "mote": drawMote(ctx, s); break;
    case "paramecium": drawParamecium(ctx, s, t); break;
    case "amoeba": drawAmoeba(ctx, s, t, m.seed); break;
    case "diatom": drawDiatom(ctx, s, t, m.seed); break;
    case "rotifer": drawRotifer(ctx, s, t); break;
    case "tardigrade": drawTardigrade(ctx, s, t); break;
    case "euglena": drawEuglena(ctx, s, t); break;
    case "volvox": drawVolvox(ctx, s, t, m.seed); break;
    case "bacterium": drawBacterium(ctx, s, m.seed); break;
  }
}

// ─────────────────────────────────────────────────────────────────────────

export default function DropSphere() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const reduceRef = useRef(false);
  const dropsRef = useRef<Drop[]>([]);
  const zoomRef = useRef({ slider: 0, impulse: 0, current: 0, vel: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragRef = useRef({ id: -1, drop: -1, lastX: 0, lastY: 0, lastT: 0, downX: 0, downY: 0, downT: 0, moved: 0, vx: 0, vy: 0, throttle: 0 });
  const pinchRef = useRef({ active: false, dist: 0 });
  const audioRef = useRef<WaterAudio | null>(null);
  const startRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bloopRef = useRef(0);

  const [dive, setDive] = useState(0);
  const [readout, setReadout] = useState("surface · zoom 0.00 · 1 drop");
  const [fallback, setFallback] = useState(false);

  const recordTape = useField((s) => s.recordTape);

  useEffect(() => { zoomRef.current.slider = dive; }, [dive]);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = createWaterAudio();
    audioRef.current.kick();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = mq.matches;
    const update = () => { reduceRef.current = mq.matches; };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const dropCount = useCallback(() => dropsRef.current.length, []);

  // spawn a new droplet by splitting an existing bead — necks then pinches off
  const splitLargest = useCallback(() => {
    const drops = dropsRef.current;
    if (drops.length >= MAX_DROPS) return;
    let idx = 0;
    for (let i = 1; i < drops.length; i++) if (drops[i].r > drops[idx].r) idx = i;
    const d = drops[idx];
    if (d.r < 46) return;
    const reduced = reduceRef.current;
    const now = (performance.now() - startRef.current) / 1000;
    const childR = d.r / Math.SQRT2;
    const axis = rand(0, TAU);
    const ax = Math.cos(axis), ay = Math.sin(axis);
    const off = childR * 0.4;
    const mk = (sign: number): Drop => ({
      id: DROP_ID++,
      x: d.x + ax * off * sign,
      y: d.y + ay * off * sign,
      vx: d.vx + ax * sign * 130 + rand(-20, 20),
      vy: d.vy + ay * sign * 130 + rand(-20, 20),
      r: childR,
      modes: makeModes(reduced),
      mic: [],
      grabbed: false, gx: 0, gy: 0,
      mergeLock: now + 1.0,
      bob: Math.random() * TAU,
    });
    const a = mk(1), b = mk(-1);
    // partition the life between the two beads along the pull axis
    for (const m of d.mic) {
      const side = m.x * ax + m.y * ay;
      (side >= 0 ? a : b).mic.push(m);
    }
    if (a.mic.length === 0) populate(a, reduced);
    if (b.mic.length === 0) populate(b, reduced);
    // strong wobble as they tear apart
    for (const m of a.modes) m.v += rand(-9, 9);
    for (const m of b.modes) m.v += rand(-9, 9);
    drops.splice(idx, 1, a, b);
    try { audioRef.current?.plip(); } catch { /* noop */ }
    try { haptics.chop(); } catch { /* noop */ }
    recordTape("object", 0.85, "drop/split");
  }, [recordTape]);

  // ── screen point → which drop / where ────────────────────────────────
  const hitDrop = useCallback((px: number, py: number): number => {
    const drops = dropsRef.current;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      const dist = Math.hypot(px - d.x, py - d.y);
      if (dist < d.r * 1.08) return i;
    }
    return -1;
  }, []);

  // try to dart a microbe near the tap; returns true if one was hit
  const dartMicrobe = useCallback((px: number, py: number): boolean => {
    const drops = dropsRef.current;
    const z = zoomRef.current.current;
    const mag = 1 + z * 3.4;
    let best: Microbe | null = null;
    let bestD = Infinity;
    for (const d of drops) {
      for (const m of d.mic) {
        const def = SPECIES[m.sp];
        const vis = smooth(def.minZoom, def.minZoom + 0.08, z) * (1 - smooth(def.maxZoom - 0.06, def.maxZoom, z));
        if (vis < 0.25) continue;
        const par = mag * (0.72 + m.depth * 0.55);
        const sx = d.x + m.x * d.r * par;
        const sy = d.y + m.y * d.r * par;
        const dist = Math.hypot(px - sx, py - sy);
        const reach = Math.max(16, m.size * d.r * mag * 1.4);
        if (dist < reach && dist < bestD) { bestD = dist; best = m; }
      }
    }
    if (best) {
      best.dart = 0.9;
      best.heading = Math.atan2(best.y, best.x) + rand(-0.6, 0.6);
      try { audioRef.current?.bloop(); } catch { /* noop */ }
      try { haptics.tap(); } catch { /* noop */ }
      return true;
    }
    return false;
  }, []);

  // ── main loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
    if (!ctx) { setFallback(true); return; }
    const g = ctx;

    const coarse = window.matchMedia("(pointer: coarse)").matches
      || window.matchMedia("(max-width: 820px)").matches;

    // offscreen buffers for the metaball body
    const field = document.createElement("canvas");
    const fctx = field.getContext("2d");
    const sharp = document.createElement("canvas");
    const sctx = sharp.getContext("2d");
    const body = document.createElement("canvas");
    const bctx = body.getContext("2d");
    if (!fctx || !sctx || !bctx) { setFallback(true); return; }
    const FS = coarse ? 0.42 : 0.5; // field render scale

    let w = 0, h = 0, dpr = 1, fw = 0, fh = 0;
    const resize = () => {
      const rect = root.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
      w = Math.max(320, Math.floor(rect.width));
      h = Math.max(420, Math.floor(rect.height));
      sizeRef.current = { w, h };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      fw = Math.max(1, Math.floor(w * FS));
      fh = Math.max(1, Math.floor(h * FS));
      field.width = fw; field.height = fh;
      sharp.width = fw; sharp.height = fh;
      body.width = fw; body.height = fh;
    };
    resize();

    // first bead — centred, sized to the viewport
    if (dropsRef.current.length === 0) {
      const r = clamp(Math.min(w, h) * 0.24, 92, 240);
      dropsRef.current.push(makeDrop(w / 2, h / 2, r, reduceRef.current));
    }

    const obs = new ResizeObserver(resize);
    obs.observe(root);
    window.addEventListener("resize", resize);

    startRef.current = performance.now();
    let last = startRef.current;
    let raf = 0;
    let readoutAt = 0;

    const step = (dt: number, time: number) => {
      const reduced = reduceRef.current;
      const drops = dropsRef.current;
      const zs = zoomRef.current;
      const topM = 70, botM = coarse ? 150 : 120;

      // zoom easing
      zs.impulse *= Math.exp(-dt * 2.2);
      const target = clamp(zs.slider + zs.impulse, 0, 1);
      const prevZ = zs.current;
      zs.current = mix(zs.current, target, 1 - Math.exp(-dt * 6));
      zs.vel = Math.abs(zs.current - prevZ) / Math.max(dt, 0.001);

      for (const d of drops) {
        // surface-tension modes: damped harmonic springs → ring and settle
        for (const m of d.modes) {
          m.v += (-m.omega * m.omega * m.a - 2 * m.damp * m.v) * dt;
          m.a += m.v * dt;
        }
        d.bob += dt * (reduced ? 0.3 : 0.8);

        if (d.grabbed) {
          continue; // position handled by pointer follow
        }
        // gentle buoyant drift + cohesion pull toward the crowd centroid
        d.vy += Math.sin(d.bob) * 2 * dt;
        if (drops.length > 1) {
          let cx = 0, cy = 0;
          for (const o of drops) { cx += o.x; cy += o.y; }
          cx /= drops.length; cy /= drops.length;
          d.vx += (cx - d.x) * 0.25 * dt;
          d.vy += (cy - d.y) * 0.25 * dt;
        }
        // integrate + drag
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        const drag = Math.exp(-dt * 0.9);
        d.vx *= drag; d.vy *= drag;
        // soft containment inside the viewport (bounce with damping)
        const lo = d.r + 8, hiX = w - d.r - 8;
        const hiY = h - d.r - botM, loY = d.r + topM;
        if (d.x < lo) { d.x = lo; d.vx = Math.abs(d.vx) * 0.55; poke(d, Math.PI, 0.05); }
        if (d.x > hiX) { d.x = hiX; d.vx = -Math.abs(d.vx) * 0.55; poke(d, 0, 0.05); }
        if (d.y < loY) { d.y = loY; d.vy = Math.abs(d.vy) * 0.55; poke(d, -Math.PI / 2, 0.05); }
        if (d.y > hiY) { d.y = hiY; d.vy = -Math.abs(d.vy) * 0.55; poke(d, Math.PI / 2, 0.05); }
      }

      // coalescence — one merge per frame
      for (let i = 0; i < drops.length; i++) {
        for (let j = i + 1; j < drops.length; j++) {
          const a = drops[i], b = drops[j];
          if (time < a.mergeLock || time < b.mergeLock) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < (a.r + b.r) * 0.6) {
            const aA = a.r * a.r, bA = b.r * b.r;
            const sum = aA + bA;
            const nx = (a.x * aA + b.x * bA) / sum;
            const ny = (a.y * aA + b.y * bA) / sum;
            const nvx = (a.vx * aA + b.vx * bA) / sum;
            const nvy = (a.vy * aA + b.vy * bA) / sum;
            const nr = Math.min(Math.sqrt(sum), Math.min(w, h) * 0.34);
            const keepGrab = a.grabbed || b.grabbed;
            const merged: Drop = {
              id: DROP_ID++, x: nx, y: ny, vx: nvx, vy: nvy, r: nr,
              modes: makeModes(reduced), mic: [...a.mic, ...b.mic],
              grabbed: keepGrab, gx: a.grabbed ? a.gx : b.gx, gy: a.grabbed ? a.gy : b.gy,
              mergeLock: 0, bob: a.bob,
            };
            // remember which pointer was dragging so it keeps hold
            if (keepGrab && dragRef.current.drop === (a.grabbed ? a.id : b.id)) dragRef.current.drop = merged.id;
            if (merged.mic.length > 22) merged.mic.length = 22;
            for (const m of merged.modes) m.v += rand(-6, 6);
            drops.splice(j, 1); drops.splice(i, 1); drops.push(merged);
            try { audioRef.current?.gloop(); } catch { /* noop */ }
            try { haptics.roll(); } catch { /* noop */ }
            recordTape("object", 0.7, "drop/merge");
            i = drops.length; break;
          }
        }
      }

      // microbe motion
      const spd = reduced ? 0.4 : 1;
      for (const d of drops) {
        for (const m of d.mic) {
          const def = SPECIES[m.sp];
          m.phase += dt * (reduced ? 1.2 : 3) * (0.6 + m.depth);
          let sp = def.speed * spd;
          if (m.dart > 0) { m.dart -= dt; sp *= 3.2; }
          // characteristic steering
          if (m.sp === "paramecium") m.heading += m.spin * dt * 0.8;
          else if (m.sp === "bacterium" || m.sp === "mote") m.heading += rand(-1, 1) * def.wander * dt;
          else m.heading += Math.sin(m.phase * 0.7 + m.seed) * def.wander * dt;
          m.x += Math.cos(m.heading) * sp * dt;
          m.y += Math.sin(m.heading) * sp * dt;
          if (m.sp === "bacterium") { m.x += rand(-1, 1) * 0.01; m.y += rand(-1, 1) * 0.01; }
          const rr = Math.hypot(m.x, m.y);
          if (rr > 0.8) { // reflect at the inner meniscus
            const n = Math.atan2(m.y, m.x);
            m.x = Math.cos(n) * 0.8; m.y = Math.sin(n) * 0.8;
            m.heading = n + Math.PI + rand(-0.5, 0.5);
          }
        }
      }
    };

    const drawBody = () => {
      const drops = dropsRef.current;
      // metaball field: additive wobbly blobs
      fctx.setTransform(FS, 0, 0, FS, 0, 0);
      fctx.clearRect(0, 0, w, h);
      fctx.globalCompositeOperation = "lighter";
      const N = coarse ? 30 : 44;
      for (const d of drops) {
        const rad = fctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 1.75);
        rad.addColorStop(0, "rgba(255,255,255,1)");
        rad.addColorStop(0.55, "rgba(255,255,255,0.85)");
        rad.addColorStop(1, "rgba(255,255,255,0)");
        fctx.fillStyle = rad;
        fctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const th = (i / N) * TAU;
          const rr = d.r * 1.75 * (1 + modeSum(d, th) * 0.7);
          const x = d.x + Math.cos(th) * rr, y = d.y + Math.sin(th) * rr;
          if (i === 0) fctx.moveTo(x, y); else fctx.lineTo(x, y);
        }
        fctx.closePath();
        fctx.fill();
      }
      fctx.globalCompositeOperation = "source-over";

      // threshold → crisp liquid silhouette
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, fw, fh);
      sctx.filter = `blur(${(coarse ? 4 : 6)}px) contrast(26)`;
      sctx.drawImage(field, 0, 0);
      sctx.filter = "none";

      // tint the silhouette into dark water
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, fw, fh);
      const grad = bctx.createLinearGradient(0, 0, 0, fh);
      grad.addColorStop(0, "rgba(24,74,96,0.95)");
      grad.addColorStop(0.45, "rgba(10,40,58,0.96)");
      grad.addColorStop(1, "rgba(4,16,28,0.97)");
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, fw, fh);
      bctx.globalCompositeOperation = "destination-in";
      bctx.drawImage(sharp, 0, 0);
      bctx.globalCompositeOperation = "source-over";
    };

    const draw = (now: number) => {
      const dtRaw = (now - last) / 1000;
      const dt = Math.min(0.05, dtRaw);
      last = now;
      const time = (now - startRef.current) / 1000;
      step(dt, time);

      // pointer-follow for grabbed drop (critically damped)
      const dr = dragRef.current;
      if (dr.drop !== -1) {
        const d = dropsRef.current.find((o) => o.id === dr.drop);
        const p = pointersRef.current.get(dr.id);
        if (d && p) {
          const tx = p.x - d.gx, ty = p.y - d.gy;
          const k = 1 - Math.exp(-dt * 20);
          const nx = mix(d.x, tx, k), ny = mix(d.y, ty, k);
          d.vx = (nx - d.x) / Math.max(dt, 0.001);
          d.vy = (ny - d.y) / Math.max(dt, 0.001);
          d.x = clamp(nx, d.r, sizeRef.current.w - d.r);
          d.y = clamp(ny, d.r + 60, sizeRef.current.h - d.r - 40);
        }
      }

      const drops = dropsRef.current;
      const z = zoomRef.current.current;
      const mag = 1 + z * 3.4;

      // background — a deep dark-field water body with slow caustic light
      g.clearRect(0, 0, w, h);
      const bg = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      bg.addColorStop(0, "#04141d");
      bg.addColorStop(1, "#01070c");
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      if (!reduceRef.current) {
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i++) {
          const cy = h * (0.3 + i * 0.22) + Math.sin(time * 0.2 + i) * 24;
          const cg = g.createLinearGradient(0, cy - 60, 0, cy + 60);
          cg.addColorStop(0, "rgba(20,60,80,0)");
          cg.addColorStop(0.5, "rgba(30,90,110,0.06)");
          cg.addColorStop(1, "rgba(20,60,80,0)");
          g.fillStyle = cg;
          g.fillRect(0, cy - 60, w, 120);
        }
        g.globalCompositeOperation = "source-over";
      }

      // caustic bright spot beneath each bead + a wet halo
      g.globalCompositeOperation = "lighter";
      for (const d of drops) {
        const cg = g.createRadialGradient(d.x, d.y + d.r * 0.7, 0, d.x, d.y + d.r * 0.7, d.r * 0.9);
        cg.addColorStop(0, "rgba(120,220,235,0.18)");
        cg.addColorStop(1, "rgba(120,220,235,0)");
        g.fillStyle = cg;
        g.beginPath(); g.ellipse(d.x, d.y + d.r * 0.72, d.r * 0.7, d.r * 0.3, 0, 0, TAU); g.fill();
        const hg = g.createRadialGradient(d.x, d.y, d.r * 0.85, d.x, d.y, d.r * 1.25);
        hg.addColorStop(0, "rgba(70,150,180,0.12)");
        hg.addColorStop(1, "rgba(70,150,180,0)");
        g.fillStyle = hg;
        g.beginPath(); g.arc(d.x, d.y, d.r * 1.25, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = "source-over";

      // water body (metaball, dark-field)
      drawBody();
      g.imageSmoothingEnabled = true;
      g.drawImage(body, 0, 0, fw, fh, 0, 0, w, h);

      // microscopic life — clipped to each bead, magnified by zoom, glowing
      for (const d of drops) {
        g.save();
        g.beginPath(); g.arc(d.x, d.y, d.r * 0.94, 0, TAU); g.clip();
        g.globalCompositeOperation = "lighter";
        for (const m of d.mic) {
          const def = SPECIES[m.sp];
          const vis = smooth(def.minZoom, def.minZoom + 0.08, z) * (1 - smooth(def.maxZoom - 0.06, def.maxZoom, z));
          if (vis < 0.02) continue;
          const par = mag * (0.72 + m.depth * 0.55);
          const sx = d.x + m.x * d.r * par;
          const sy = d.y + m.y * d.r * par;
          const px = m.size * d.r * mag;
          if (px < 0.6) continue;
          g.save();
          g.globalAlpha = vis;
          g.translate(sx, sy);
          if (m.sp !== "volvox" && m.sp !== "mote") g.rotate(m.heading);
          drawMicrobe(g, m, px, m.phase);
          g.restore();
        }
        g.restore();
      }

      // glass reads: fresnel rim, specular glint, inner shading — per bead
      const N = 48;
      for (const d of drops) {
        // fresnel rim
        g.save();
        g.globalCompositeOperation = "lighter";
        g.lineWidth = Math.max(1.5, d.r * 0.03);
        g.strokeStyle = "rgba(150,225,245,0.5)";
        g.beginPath();
        for (let i = 0; i <= N; i++) {
          const th = (i / N) * TAU;
          const rr = d.r * (1 + modeSum(d, th));
          const x = d.x + Math.cos(th) * rr, y = d.y + Math.sin(th) * rr;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath(); g.stroke();
        // soft aqua fresnel glow just inside the rim
        const fr = g.createRadialGradient(d.x, d.y, d.r * 0.6, d.x, d.y, d.r);
        fr.addColorStop(0, "rgba(90,190,220,0)");
        fr.addColorStop(1, "rgba(120,220,245,0.28)");
        g.fillStyle = fr;
        g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill();
        g.restore();

        // bright sharp specular glint (upper-left) + soft secondary
        g.save();
        g.globalCompositeOperation = "lighter";
        const gx = d.x - d.r * 0.38, gy = d.y - d.r * 0.42;
        const sgl = g.createRadialGradient(gx, gy, 0, gx, gy, d.r * 0.22);
        sgl.addColorStop(0, "rgba(255,255,255,0.95)");
        sgl.addColorStop(0.5, "rgba(220,245,255,0.4)");
        sgl.addColorStop(1, "rgba(220,245,255,0)");
        g.fillStyle = sgl;
        g.beginPath(); g.ellipse(gx, gy, d.r * 0.2, d.r * 0.13, -0.6, 0, TAU); g.fill();
        const sg2 = g.createRadialGradient(d.x + d.r * 0.3, d.y + d.r * 0.36, 0, d.x + d.r * 0.3, d.y + d.r * 0.36, d.r * 0.3);
        sg2.addColorStop(0, "rgba(120,210,235,0.22)");
        sg2.addColorStop(1, "rgba(120,210,235,0)");
        g.fillStyle = sg2;
        g.beginPath(); g.arc(d.x + d.r * 0.3, d.y + d.r * 0.36, d.r * 0.3, 0, TAU); g.fill();
        g.restore();
      }

      if (now - readoutAt > 200) {
        readoutAt = now;
        const zz = zoomRef.current.current;
        const zone = zz < 0.05 ? "surface" : zz < 0.4 ? "shallows" : zz < 0.75 ? "midwater" : "deep";
        const n = drops.length;
        setReadout(`${zone} · zoom ${zz.toFixed(2)} · ${n} drop${n === 1 ? "" : "s"}`);
        try { audioRef.current?.setDepth(zz); } catch { /* noop */ }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      ensureAudio();
      const zs = zoomRef.current;
      zs.impulse = clamp(zs.impulse - e.deltaY * 0.0009, -0.25, 1);
      const now = performance.now();
      if (now - dragRef.current.throttle > 110) {
        dragRef.current.throttle = now;
        const depth = clamp(zs.slider + zs.impulse, 0, 1);
        try { audioRef.current?.drip(depth); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("sigil", 0.3 + depth * 0.5, "drop/dive");
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheel);
      try { audioRef.current?.dispose(); } catch { /* noop */ }
      audioRef.current = null;
    };
  }, [ensureAudio, recordTape]);

  // ── pointer gestures ─────────────────────────────────────────────────
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    ensureAudio();
    const map = pointersRef.current;
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const rect = e.currentTarget.getBoundingClientRect();

    if (map.size >= 2) {
      // two-finger pinch → zoom
      pinchRef.current.active = true;
      const pts = [...map.values()];
      pinchRef.current.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      dragRef.current.id = -1;
      dragRef.current.drop = -1;
      return;
    }

    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const hit = hitDrop(px, py);
    const d = dragRef.current;
    d.id = e.pointerId;
    d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = performance.now();
    d.downX = px; d.downY = py; d.downT = performance.now();
    d.moved = 0; d.vx = 0; d.vy = 0;
    if (hit !== -1) {
      const drop = dropsRef.current[hit];
      drop.grabbed = true;
      drop.gx = px - drop.x;
      drop.gy = py - drop.y;
      d.drop = drop.id;
    } else {
      d.drop = -1;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const map = pointersRef.current;
    if (!map.has(e.pointerId)) return;
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current.active && map.size >= 2) {
      const pts = [...map.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const delta = dist - pinchRef.current.dist;
      pinchRef.current.dist = dist;
      const zs = zoomRef.current;
      zs.impulse = clamp(zs.impulse + delta * 0.0032, -0.25, 1);
      const now = performance.now();
      if (now - dragRef.current.throttle > 120) {
        dragRef.current.throttle = now;
        const depth = clamp(zs.slider + zs.impulse, 0, 1);
        try { audioRef.current?.drip(depth); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("sigil", 0.3 + depth * 0.5, "drop/pinch");
      }
      return;
    }

    const d = dragRef.current;
    if (d.id !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const now = performance.now();
    const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
    d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = now;
    d.moved += Math.hypot(dx, dy);

    if (d.drop !== -1) {
      // sloshing wobble while a bead is dragged fast
      const drop = dropsRef.current.find((o) => o.id === d.drop);
      if (drop && d.moved > 6) {
        const spd = Math.hypot(dx, dy);
        if (spd > 6) {
          const ang = Math.atan2(dy, dx);
          poke(drop, ang + Math.PI, clamp(spd * 0.0016, 0, 0.09));
          if (now - d.throttle > 120) {
            d.throttle = now;
            try { audioRef.current?.ripple(clamp(spd / 40, 0.15, 0.7)); } catch { /* noop */ }
            try { haptics.ripple(0.2 + clamp(spd / 60, 0, 0.4)); } catch { /* noop */ }
            recordTape("ripple", 0.35, "drop/drag");
          }
        }
      }
    } else if (d.moved > 8) {
      // dragging empty water → poke the nearest bead into ripples
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const hit = hitDrop(px, py);
      if (hit !== -1 && now - d.throttle > 110) {
        d.throttle = now;
        const drop = dropsRef.current[hit];
        poke(drop, Math.atan2(py - drop.y, px - drop.x), 0.05);
        try { audioRef.current?.ripple(0.4); } catch { /* noop */ }
        try { haptics.ripple(0.3); } catch { /* noop */ }
      }
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const map = pointersRef.current;
    const d = dragRef.current;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const wasDrag = d.id === e.pointerId;
    map.delete(e.pointerId);

    if (pinchRef.current.active) {
      if (map.size < 2) pinchRef.current.active = false;
      return;
    }
    if (!wasDrag) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const grabbedId = d.drop;
    d.id = -1;
    d.drop = -1;
    const drop = grabbedId !== -1 ? dropsRef.current.find((o) => o.id === grabbedId) : undefined;
    const now = performance.now();
    const dur = now - d.downT;

    if (d.moved < 9 && dur < 340) {
      // TAP — dart a microbe if we hit one, else poke the bead
      if (drop) drop.grabbed = false;
      if (dartMicrobe(px, py)) return;
      const hit = drop ? dropsRef.current.indexOf(drop) : hitDrop(px, py);
      if (hit !== -1) {
        const dd = dropsRef.current[hit];
        poke(dd, Math.atan2(py - dd.y, px - dd.x), 0.14);
        try { audioRef.current?.drip(0.5); } catch { /* noop */ }
        try { haptics.ripple(0.5); } catch { /* noop */ }
        recordTape("ripple", 0.5, "drop/poke");
      }
      return;
    }

    // FLING — release with velocity; leading edge flattens then rebounds
    if (drop) {
      drop.grabbed = false;
      const spd = Math.hypot(drop.vx, drop.vy);
      if (spd > 60) {
        poke(drop, Math.atan2(drop.vy, drop.vx), clamp(spd * 0.0009, 0, 0.14));
        try { audioRef.current?.ripple(clamp(spd / 300, 0.2, 0.8)); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        recordTape("ripple", clamp(0.3 + spd * 0.001, 0.3, 0.95), "drop/fling");
      }
    }
  };

  const onDive = (v: number) => {
    setDive(v);
    zoomRef.current.slider = v;
    ensureAudio();
    const now = performance.now();
    if (now - dragRef.current.throttle > 110) {
      dragRef.current.throttle = now;
      try { audioRef.current?.drip(v); } catch { /* noop */ }
      try { haptics.chop(); } catch { /* noop */ }
      recordTape("sigil", 0.3 + v * 0.5, "drop/dive");
    }
  };

  const onSplit = () => {
    ensureAudio();
    splitLargest();
  };

  return (
    <div
      ref={rootRef}
      className="drop-sphere"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--drop-accent": "#5fd8f0" } as CSSProperties}
    >
      {!fallback && (
        <canvas
          ref={canvasRef}
          className="drop-canvas"
          role="img"
          aria-label="A living bead of rainwater. Drag it to make it wobble and sway, fling it, split it into more droplets or drag droplets together to merge them, and zoom in — with the dive control, the scroll wheel, or a two-finger pinch — to reveal the microscopic life swimming inside."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        />
      )}

      {fallback && (
        <div className="drop-fallback" data-drop-fallback="true" aria-hidden="true">
          <div className="drop-fallback-orb" />
        </div>
      )}

      <div className="drop-title" aria-hidden="true">
        <span>a bead of rain, alive</span>
        <strong>drop</strong>
      </div>

      <div className="drop-hud">
        <output className="drop-readout" aria-live="polite">{readout}</output>
        <div className="drop-console" aria-label="droplet controls">
          <label className="drop-pill drop-dive-pill">
            <span>zoom</span>
            <input
              type="range" min={0} max={1} step={0.001} value={dive}
              aria-label="dive into the droplet to reveal the life inside"
              onChange={(e) => onDive(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="drop-pill drop-split"
            aria-label="split the droplet in two"
            onClick={onSplit}
            disabled={dropCount() >= MAX_DROPS}
          >
            <span>split</span>
          </button>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .drop-sphere {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #01070c;
          color: rgba(224, 246, 252, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .drop-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: grab;
          z-index: 0;
        }
        .drop-canvas:active { cursor: grabbing; }

        .drop-fallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          background: #01070c;
          z-index: 0;
        }
        .drop-fallback-orb {
          width: min(58vmin, 460px);
          height: min(58vmin, 460px);
          border-radius: 999px;
          background:
            radial-gradient(32% 28% at 40% 36%, rgba(255,255,255,0.95), rgba(180,240,255,0.5) 24%, rgba(30,110,140,0.6) 52%, rgba(5,26,40,0.95) 78%, #01070c 100%),
            radial-gradient(120% 120% at 66% 76%, rgba(60,180,210,0.3), transparent 60%);
          box-shadow:
            inset 0 0 80px rgba(120,220,245,0.35),
            inset -16px -20px 70px rgba(0,0,0,0.7),
            0 0 100px rgba(70,190,220,0.3);
        }

        .drop-title {
          position: fixed;
          z-index: 2;
          top: 96px;
          left: var(--pad-x);
          pointer-events: none;
        }
        .drop-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(200, 236, 248, 0.5);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }
        .drop-title strong {
          display: block;
          color: rgba(232, 248, 255, 0.96);
          font-family: var(--font-serif);
          font-size: 118px;
          font-weight: 500;
          line-height: 0.86;
          text-shadow: 0 0 40px rgba(80, 200, 235, 0.35);
        }

        .drop-hud {
          position: fixed;
          z-index: 4;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(22px + env(safe-area-inset-bottom, 0px));
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          pointer-events: none;
        }

        .drop-readout {
          padding: 7px 14px;
          border: 1px solid rgba(150, 220, 245, 0.18);
          border-radius: 999px;
          background: rgba(4, 20, 30, 0.55);
          color: rgba(212, 240, 250, 0.82);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          pointer-events: none;
        }

        .drop-console {
          display: flex;
          gap: 10px;
          padding: 8px;
          border: 1px solid rgba(150, 220, 245, 0.16);
          border-radius: 999px;
          background: rgba(4, 20, 30, 0.55);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          pointer-events: auto;
        }

        .drop-pill {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 48px;
          padding: 0 18px;
          border: 0;
          border-radius: 999px;
          background: rgba(180, 235, 250, 0.06);
          font-family: var(--font-mono);
          font-size: 11px;
          color: rgba(206, 238, 250, 0.72);
          text-transform: lowercase;
        }
        .drop-pill span { flex: none; }
        .drop-split {
          cursor: pointer;
          transition: background 0.2s ease, opacity 0.2s ease;
          letter-spacing: 0.08em;
          color: rgba(224, 248, 255, 0.92);
        }
        .drop-split:hover { background: rgba(120, 220, 245, 0.16); }
        .drop-split:active { background: rgba(120, 220, 245, 0.26); }
        .drop-split:disabled { opacity: 0.4; cursor: not-allowed; }

        .drop-pill input {
          -webkit-appearance: none;
          appearance: none;
          width: 150px;
          height: 28px;
          margin: 0;
          background: transparent;
          cursor: pointer;
        }
        .drop-dive-pill input::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(90,180,210,0.3), rgba(160,235,255,0.9));
        }
        .drop-dive-pill input::-moz-range-track {
          height: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(90,180,210,0.3), rgba(160,235,255,0.9));
        }
        .drop-pill input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -6px;
          border: 0;
          border-radius: 999px;
          background: #eafcff;
          box-shadow: 0 0 14px rgba(150, 230, 255, 0.9);
          cursor: pointer;
        }
        .drop-pill input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: 0;
          border-radius: 999px;
          background: #eafcff;
          box-shadow: 0 0 14px rgba(150, 230, 255, 0.9);
          cursor: pointer;
        }

        body:has(.drop-sphere) { overflow: hidden; background: #01070c; }
        body:has(.drop-sphere) header:not(.oda-site-header) { display: none !important; }
        body:has(.drop-sphere) .oda-field-watch,
        body:has(.drop-sphere) .oda-candle-mark,
        body:has(.drop-sphere) .oda-tape-shell,
        body:has(.drop-sphere) .oda-sound-toggle { display: none !important; }

        @media (max-width: 820px) {
          .drop-title { top: 70px; left: 22px; }
          .drop-title strong { font-size: 74px; }
          .drop-console { flex-direction: row; }
          .drop-pill input { width: 40vw; max-width: 170px; }
        }

        @media (max-width: 520px) {
          .drop-title strong { font-size: 56px; }
          .drop-console { flex-wrap: wrap; justify-content: center; }
        }
      `,
        }}
      />
    </div>
  );
}
