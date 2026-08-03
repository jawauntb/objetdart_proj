"use client";

/**
 * /quarks — the floor of the scale axis at 10⁻¹⁸ m, the math band of the
 * manifold (plan W6). The strangest and quietest room on the site: there
 * are no things left down here, only relations.
 *
 * The vacuum is never empty — virtual pairs spark into being and
 * annihilate on a deterministic seeded schedule riding the shared audio
 * clock (src/lib/quarks.ts). Hadrons are bound pairs and triplets of
 * quarks joined by gluon flux tubes in the three color tints; every seed
 * decodes color-neutral, summing to white. The room's one great law is
 * CONFINEMENT, felt by hand: drag a quark and the tube pulls back HARDER
 * the further you pull — the force grows with distance, the anti-spring,
 * unlike anything else on the site. Pull past the snap ratio and the tube
 * breaks — and instead of freeing the quark, the snap energy becomes a
 * new bound pair at the break. You can never isolate one.
 *
 * tap perturbs the vacuum (a spray of virtual pairs, intensity-scaled);
 * dwell on empty vacuum condenses a triplet that spins up from the field;
 * the ceremony held on a hadron is annihilation — photon streaks racing
 * off at light speed; a flick throws a hadron whole (it moves as one,
 * never sheds a part); a scrub stirs the vacuum into a glowing ring of
 * pair production; three fingers run a field wind or dilate time; a twist
 * rotates the lens to the bare mathematics — the Feynman view: vertices,
 * coiled gluon propagators, virtual pairs as closed loops, photons as
 * waving lines. The field persists in `objetdart:quarks:v1`. Pinch is
 * deliberately unbound — ScaleTravel owns it (atoms above; below is the
 * floor of the axis, and the integrator holds it).
 */

import { useEffect, useRef } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { useField } from "@/store/field";
import {
  ANTI_TINTS,
  COLOR_TINTS,
  MAX_HADRONS,
  SNAP_RATIO,
  VACUUM_SLOT_MS,
  confinementForce,
  hadronFromSeed,
  hashSeed,
  settlePopulation,
  shouldSnap,
  snapChildren,
  tubesOf,
  vacuumPairAt,
  type HadronMorph,
} from "@/lib/quarks";

const STORE_KEY = "objetdart:quarks:v1";
const RETIRE_MS = 1400;
/** One fixed field: the same vacuum seethes the same way for everyone. */
const FIELD_SEED = hashSeed(97, 311, 8);
/** Finger spring on a grabbed quark, normalized/s² per unit offset. */
const FINGER_K = 42;
/** Tube force gain: confinementForce → normalized acceleration. */
const FORCE_GAIN = 3.2;
/** Photon speed, fraction of the smaller dimension per second. */
const PHOTON_SPEED = 1.35;

type Quark = { nx: number; ny: number; vx: number; vy: number; sx: number; sy: number };

type HadronEnt = {
  id: string;
  seed: number;
  morph: HadronMorph;
  quarks: Quark[];
  /** 0..1 — the triplet spinning up from the field when condensed. */
  growth: number;
  closed: boolean;
  /** 0..1 annihilation ceremony charge. */
  charge: number;
  /** 0..1 post-snap / post-flick tremble, decays. */
  shiver: number;
  birth: number;
  retiringAt: number;
};

type Photon = { x: number; y: number; vx: number; vy: number; born: number; life: number; color: string };
type SparkPair = { x: number; y: number; angle: number; sep: number; color: number; born: number; life: number };
type Ring = { x: number; y: number; r: number; born: number; life: number };
type PendingNote = { at: number; midi: number; ms: number };

type Stored = {
  hadrons: Array<{ id: string; seed: number; quarks: Array<{ nx: number; ny: number }> }>;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

function colorAlpha(hex: string, alpha: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

function twinkleHash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function mixHex(a: string, b: string, t: number) {
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  const r = Math.round(((va >> 16) & 255) * (1 - t) + ((vb >> 16) & 255) * t);
  const g = Math.round(((va >> 8) & 255) * (1 - t) + ((vb >> 8) & 255) * t);
  const bl = Math.round((va & 255) * (1 - t) + (vb & 255) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Lay a hadron's quarks out at rest around a center, oriented by phase. */
function layoutQuarks(morph: HadronMorph, cx: number, cy: number): Quark[] {
  const quarks: Quark[] = [];
  if (morph.kind === "pair") {
    const half = morph.rest[0] / 2;
    for (const sgn of [-1, 1]) {
      quarks.push({
        nx: clamp(cx + Math.cos(morph.phase) * half * sgn, 0.04, 0.96),
        ny: clamp(cy + Math.sin(morph.phase) * half * sgn, 0.06, 0.95),
        vx: 0, vy: 0, sx: -1, sy: -1,
      });
    }
  } else {
    const r = ((morph.rest[0] + morph.rest[1] + morph.rest[2]) / 3) / Math.sqrt(3);
    for (let i = 0; i < 3; i++) {
      const a = morph.phase + (i / 3) * Math.PI * 2;
      quarks.push({
        nx: clamp(cx + Math.cos(a) * r, 0.04, 0.96),
        ny: clamp(cy + Math.sin(a) * r, 0.06, 0.95),
        vx: 0, vy: 0, sx: -1, sy: -1,
      });
    }
  }
  return quarks;
}

function makeHadron(seed: number, cx: number, cy: number, growth: number): HadronEnt {
  const morph = hadronFromSeed(seed);
  return {
    id: `qk-${seed.toString(36)}-${Math.floor(cx * 997)}`,
    seed,
    morph,
    quarks: layoutQuarks(morph, cx, cy),
    growth,
    closed: growth >= 1,
    charge: 0,
    shiver: 0,
    birth: performance.now(),
    retiringAt: 0,
  };
}

// the first look is never an empty vacuum — a triplet and a pair, kept
const STARTERS: Array<{ nx: number; ny: number; triplet: boolean }> = [
  { nx: 0.38, ny: 0.42, triplet: true },
  { nx: 0.68, ny: 0.62, triplet: false },
];

function starterSeed(i: number, triplet: boolean): number {
  const h = hashSeed(419, 863, i);
  return (triplet ? h | 1 : h & ~1) >>> 0;
}

function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || !Array.isArray(parsed.hadrons)) return null;
    return {
      hadrons: parsed.hadrons.filter(
        (h) => h && typeof h.seed === "number" && Array.isArray(h.quarks) &&
          h.quarks.every((q) => q && typeof q.nx === "number" && typeof q.ny === "number"),
      ),
    };
  } catch {
    return null;
  }
}

/** midi voice of a hadron — the bright granular end of the axis */
function midiOf(morph: HadronMorph): number {
  return 67 + morph.voice + (morph.kind === "triplet" ? 3 : 0);
}

export default function QuarksVacuum() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let hadrons: HadronEnt[] = [];
    let seedCount = 0;
    const photons: Photon[] = [];
    const sparkPairs: SparkPair[] = [];
    const rings: Ring[] = [];
    const pendingNotes: PendingNote[] = [];
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let lastFrame = 0;
    let last = performance.now();
    let localT = 0;
    let reduce = false;
    let windX = 0;
    let windY = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lastInteractionAt = performance.now();
    let lastSaveAt = 0;
    let dirty = false;
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbMode: "none" | "condense" | "annihilate" = "none";
    let kbHadronId: string | null = null;
    let lastWindSoundAt = 0;
    let lastScrubAt = 0;
    let lastStirSparkAt = 0;
    let lastTensionNoteAt = 0;
    let lastTensionTickAt = 0;
    const drag: { hadronId: string | null; quarkIdx: number; x: number; y: number } = {
      hadronId: null, quarkIdx: -1, x: 0, y: 0,
    };
    const hold: { hadronId: string | null; onHadron: boolean; seededId: string | null; done: boolean } = {
      hadronId: null, onHadron: false, seededId: null, done: false,
    };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; };
    mq.addEventListener?.("change", onMq);

    // ————— persistence —————
    const save = (force = false) => {
      const now = performance.now();
      if (!force && now - lastSaveAt < 800) { dirty = true; return; }
      lastSaveAt = now;
      dirty = false;
      try {
        const stored: Stored = {
          hadrons: hadrons
            .filter((h) => !h.retiringAt)
            .map((h) => ({
              id: h.id,
              seed: h.seed,
              quarks: h.quarks.map((q) => ({ nx: q.nx, ny: q.ny })),
            })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the vacuum keeps its own counsel */ }
    };

    const stored = loadStored();
    if (stored && stored.hadrons.length > 0) {
      hadrons = stored.hadrons.slice(-MAX_HADRONS).map((s) => {
        const h = makeHadron(s.seed, 0.5, 0.5, 1);
        const morph = h.morph;
        const n = morph.colors.length;
        if (s.quarks.length === n) {
          h.quarks = s.quarks.map((q) => ({
            nx: clamp(q.nx, 0.04, 0.96), ny: clamp(q.ny, 0.06, 0.95),
            vx: 0, vy: 0, sx: -1, sy: -1,
          }));
        }
        h.id = s.id || h.id;
        return h;
      });
      seedCount = hadrons.length;
    } else {
      hadrons = STARTERS.map((s, i) => makeHadron(starterSeed(i, s.triplet), s.nx, s.ny, 1));
      seedCount = hadrons.length;
      save(true);
    }

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const noteLater = (delayMs: number, midi: number, ms = 120) => {
      pendingNotes.push({ at: performance.now() + delayMs, midi, ms });
    };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(r.width));
      height = Math.max(480, Math.floor(r.height));
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    const minDim = () => Math.min(width, height);

    const quarkAt = (x: number, y: number): { h: HadronEnt; qi: number } | null => {
      let best: { h: HadronEnt; qi: number } | null = null;
      let bestD = Infinity;
      const reach = Math.max(34, minDim() * 0.05);
      for (const h of hadrons) {
        if (h.retiringAt || !h.closed) continue;
        for (let qi = 0; qi < h.quarks.length; qi++) {
          const q = h.quarks[qi];
          const d = Math.hypot(x - q.sx, y - q.sy);
          if (d < reach && d < bestD) { bestD = d; best = { h, qi }; }
        }
      }
      return best;
    };

    const hadronAt = (x: number, y: number): HadronEnt | null => {
      let best: HadronEnt | null = null;
      let bestD = Infinity;
      for (const h of hadrons) {
        if (h.retiringAt) continue;
        let cx = 0, cy = 0;
        for (const q of h.quarks) { cx += q.sx; cy += q.sy; }
        cx /= h.quarks.length;
        cy /= h.quarks.length;
        const reach = Math.max(52, minDim() * 0.09);
        const d = Math.hypot(x - cx, y - cy);
        if (d < reach && d < bestD) { bestD = d; best = h; }
      }
      return best;
    };

    const spraySparks = (x: number, y: number, n: number, spread: number) => {
      const now = performance.now();
      for (let i = 0; i < n; i++) {
        const a = twinkleHash(now + i * 13.7) * Math.PI * 2;
        const r = twinkleHash(now * 1.7 + i * 31.1) * spread;
        sparkPairs.push({
          x: x + Math.cos(a) * r,
          y: y + Math.sin(a) * r,
          angle: twinkleHash(i * 7.3 + now) * Math.PI * 2,
          sep: 5 + twinkleHash(i * 11.9 + now) * 9,
          color: Math.floor(twinkleHash(i * 3.1 + now * 0.7) * 3),
          born: now,
          life: 380 + twinkleHash(i * 17.3 + now) * 520,
        });
      }
      if (sparkPairs.length > 140) sparkPairs.splice(0, sparkPairs.length - 140);
    };

    const emitPhoton = (x: number, y: number, angle: number, color: string) => {
      const s = PHOTON_SPEED * minDim();
      photons.push({
        x, y,
        vx: Math.cos(angle) * s,
        vy: Math.sin(angle) * s,
        born: performance.now(),
        life: 1300,
        color,
      });
      if (photons.length > 40) photons.splice(0, photons.length - 40);
    };

    const retireOldest = () => {
      const alive = hadrons.filter((h) => !h.retiringAt);
      const { retired } = settlePopulation(alive, MAX_HADRONS);
      for (const r of retired) {
        r.retiringAt = performance.now();
        // the eldest lets go with a faint photon and a low word
        let cx = 0, cy = 0;
        for (const q of r.quarks) { cx += q.sx; cy += q.sy; }
        cx /= r.quarks.length;
        cy /= r.quarks.length;
        if (cx > 0) emitPhoton(cx, cy, twinkleHash(r.seed) * Math.PI * 2, "#CFC2A6");
        note(midiOf(r.morph) - 24, 360);
        if (drag.hadronId === r.id) { drag.hadronId = null; drag.quarkIdx = -1; }
      }
    };

    const condense = (x: number, y: number): HadronEnt | null => {
      const nx = clamp(x / width, 0.08, 0.92);
      const ny = clamp(y / height, 0.1, 0.92);
      const seed = (hashSeed(Math.round(nx * 811), Math.round(ny * 809), seedCount) | 1) >>> 0;
      seedCount += 1;
      const h = makeHadron(seed, nx, ny, 0.04);
      hadrons.push(h);
      retireOldest();
      try { audio().spark(); } catch { /* noop */ }
      note(midiOf(h.morph) - 12, 220);
      try { haptics.ripple(0.5); } catch { /* noop */ }
      spraySparks(x, y, 4, 30);
      useField.getState().recordTape("object", 0.5, "quarks/condense");
      save();
      return h;
    };

    const closeHadron = (h: HadronEnt) => {
      h.closed = true;
      h.shiver = 0.6;
      // the three tubes close: white is complete
      try { haptics.bloom(); } catch { /* noop */ }
      note(midiOf(h.morph), 300);
      noteLater(140, midiOf(h.morph) + 7, 220);
      const cx = h.quarks.reduce((s, q) => s + q.sx, 0) / h.quarks.length;
      const cy = h.quarks.reduce((s, q) => s + q.sy, 0) / h.quarks.length;
      spraySparks(cx, cy, 6, 34);
      dirty = true;
    };

    const perturb = (x: number, y: number, intensity: number) => {
      const n = 3 + Math.round(clamp01(intensity) * 7);
      spraySparks(x, y, n, 26 + intensity * 40);
      note(79 + Math.round(intensity * 5), 90);
      try { haptics.tap(); } catch { /* noop */ }
      useField.getState().recordTape("ripple", 0.3 + intensity * 0.4, "quarks/perturb");
    };

    /** The room's one great law, executed: the tube snaps into a new pair. */
    const snap = (h: HadronEnt, tubeIdx: number) => {
      const tubes = tubesOf(h.morph.kind);
      const [i, j] = tubes[tubeIdx];
      const qa = h.quarks[i];
      const qb = h.quarks[j];
      const bx = (qa.sx + qb.sx) / 2;
      const by = (qa.sy + qb.sy) / 2;
      const childSeeds = snapChildren(h.seed, tubeIdx);
      // the parent is gone the instant the string parts
      hadrons = hadrons.filter((q) => q.id !== h.id);
      if (drag.hadronId === h.id) { drag.hadronId = null; drag.quarkIdx = -1; }
      // each torn end takes a new partner, born at the break
      const ends: Array<[number, number]> = [[qa.nx, qa.ny], [qb.nx, qb.ny]];
      childSeeds.forEach((seed, ci) => {
        const [enx, eny] = ends[ci % 2];
        const child = makeHadron(seed, (enx + (bx / width)) / 2, (eny + (by / height)) / 2, 1);
        child.shiver = 1;
        // the recoil: children part along the old tube's axis
        const away = ci % 2 === 0 ? -1 : 1;
        const ax = (qb.nx - qa.nx) || 0.001;
        const ay = (qb.ny - qa.ny) || 0.001;
        const al = Math.hypot(ax, ay);
        for (const q of child.quarks) {
          q.vx = (ax / al) * away * 0.12;
          q.vy = (ay / al) * away * 0.12;
        }
        hadrons.push(child);
      });
      retireOldest();
      // three senses in one frame: bell, bloom, a shiver of virtual sparks
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      note(52 + h.morph.voice, 420);
      noteLater(90, midiOf(h.morph) + 5, 180);
      spraySparks(bx, by, 10, 44);
      useField.getState().recordTape("sigil", 0.85, "quarks/snap");
      save();
    };

    /** The ceremony: matter returns to light. */
    const annihilate = (h: HadronEnt) => {
      const cx = h.quarks.reduce((s, q) => s + q.sx, 0) / h.quarks.length;
      const cy = h.quarks.reduce((s, q) => s + q.sy, 0) / h.quarks.length;
      for (let qi = 0; qi < h.quarks.length; qi++) {
        const q = h.quarks[qi];
        const a = Math.atan2(q.sy - cy, q.sx - cx) || (qi / h.quarks.length) * Math.PI * 2;
        emitPhoton(q.sx, q.sy, a, "#F7F3EA");
        emitPhoton(q.sx, q.sy, a + Math.PI * 0.92, COLOR_TINTS[h.morph.colors[qi]]);
      }
      hadrons = hadrons.filter((q) => q.id !== h.id);
      if (drag.hadronId === h.id) { drag.hadronId = null; drag.quarkIdx = -1; }
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
      note(midiOf(h.morph) + 12, 140);
      noteLater(160, midiOf(h.morph) + 19, 260);
      spraySparks(cx, cy, 8, 40);
      useField.getState().recordTape("sigil", 0.9, "quarks/annihilate");
      save();
    };

    // ————— gestures (the grammar, nothing private; pinch belongs to the manifold) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        perturb(x, y, e.intensity);
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "enter") { timeScaleTarget = 0.25; try { haptics.tap(); } catch { /* noop */ } note(31, 300); }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const h = hadronAt(x, y);
          hold.hadronId = h ? h.id : null;
          hold.onHadron = !!h;
          hold.seededId = null;
          hold.done = false;
          return;
        }
        if (e.phase === "release") {
          const h = hadrons.find((q) => q.id === hold.hadronId);
          if (h) h.charge = 0;
          hold.hadronId = null;
          hold.onHadron = false;
          hold.seededId = null;
          save();
          return;
        }
        // ticks (~80ms)
        if (hold.done) return;
        if (hold.onHadron && hold.hadronId) {
          // the ceremony: the hadron gathers toward its own undoing
          const h = hadrons.find((q) => q.id === hold.hadronId);
          if (!h || h.retiringAt || !h.closed) return;
          h.charge = clamp01((e.elapsed - 900) / 1600);
          const now = performance.now();
          if (h.charge > 0 && now - lastTensionNoteAt > 340) {
            lastTensionNoteAt = now;
            note(midiOf(h.morph) + Math.round(h.charge * 10), 90);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3) {
            hold.done = true;
            hold.hadronId = null;
            annihilate(h);
          }
        } else if (hold.seededId) {
          // a triplet this hand is condensing — keep holding, it keeps gathering
          const h = hadrons.find((q) => q.id === hold.seededId);
          if (h && !h.closed) {
            h.growth = clamp01(h.growth + 0.0011 * 80 * (1 + e.intensity * 0.6));
            if (h.growth >= 1) closeHadron(h);
          }
        } else if (e.tier >= 2 && !hold.onHadron) {
          // dwell on the empty vacuum: condense — long-press means grow, everywhere
          const h = condense(x, y);
          if (h) hold.seededId = h.id;
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers are the law: a field wind through the vacuum
          windTargetX = clamp(e.vx * 1.4, -1, 1);
          windTargetY = clamp(e.vy * 1.4, -1, 1);
          const now = performance.now();
          const mag = Math.hypot(windTargetX, windTargetY);
          if (mag > 0.5 && now - lastWindSoundAt > 520) {
            lastWindSoundAt = now;
            note(33 + Math.round(mag * 5), 280);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "end") {
          drag.hadronId = null;
          drag.quarkIdx = -1;
          save();
          return;
        }
        if (!drag.hadronId) {
          const hit = quarkAt(x, y);
          if (hit) {
            drag.hadronId = hit.h.id;
            drag.quarkIdx = hit.qi;
            note(midiOf(hit.h.morph) + 2, 90);
            try { haptics.tap(); } catch { /* noop */ }
          }
        }
        if (drag.hadronId) {
          drag.x = x;
          drag.y = y;
        } else {
          // the empty vacuum absorbs a stroke with a faint wake of pairs
          const now = performance.now();
          if (now - lastStirSparkAt > 240) {
            lastStirSparkAt = now;
            spraySparks(x, y, 1, 10);
          }
        }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        // a flick throws the hadron WHOLE — it moves as one, never sheds a part
        const { x, y } = toLocal(e.x, e.y);
        const h = hadronAt(x, y);
        if (!h || !h.closed) return;
        const speed = clamp(e.speed, 0.6, 2.4) * 0.16;
        for (const q of h.quarks) {
          q.vx += Math.cos(e.angle) * speed;
          q.vy += Math.sin(e.angle) * speed;
        }
        h.shiver = Math.min(1, h.shiver + 0.7);
        note(midiOf(h.morph) + 5, 110);
        try { haptics.ripple(0.4); } catch { /* noop */ }
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: the felt field ↔ the bare mathematics
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(43, 160);
          }
          lensTarget = snapped;
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        // stirring the vacuum: a briefly glowing ring of pair production
        const now = performance.now();
        if (now - lastScrubAt > 480) {
          lastScrubAt = now;
          const r = 34 + Math.min(60, Math.abs(e.winding) * 22);
          rings.push({ x: e.cx, y: e.cy, r, born: now, life: 900 });
          if (rings.length > 6) rings.splice(0, rings.length - 6);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + twinkleHash(now + i) * 1.2;
            sparkPairs.push({
              x: e.cx + Math.cos(a) * r,
              y: e.cy + Math.sin(a) * r,
              angle: a + Math.PI / 2,
              sep: 6 + twinkleHash(i * 5.1 + now) * 8,
              color: i % 3,
              born: now,
              life: 420 + twinkleHash(i * 9.7 + now) * 380,
            });
          }
          note(74 + Math.round(Math.abs(e.winding) * 2), 90);
          try { haptics.ripple(0.3); } catch { /* noop */ }
        }
      },
    });

    // ————— keyboard dialect (same verbs, quieter) —————
    const onKeyDown = (ev: KeyboardEvent) => {
      const step = 0.05;
      if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        cursorVisible = true;
        lastInteractionAt = performance.now();
        if (ev.key === "ArrowLeft") cursorNx = clamp(cursorNx - step, 0.05, 0.95);
        if (ev.key === "ArrowRight") cursorNx = clamp(cursorNx + step, 0.05, 0.95);
        if (ev.key === "ArrowUp") cursorNy = clamp(cursorNy - step, 0.08, 0.95);
        if (ev.key === "ArrowDown") cursorNy = clamp(cursorNy + step, 0.08, 0.95);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!cursorVisible) { cursorVisible = true; return; }
        const x = cursorNx * width;
        const y = cursorNy * height;
        const h = hadronAt(x, y);
        if (h && h.closed) {
          // held Enter repeats — the keyboard's ceremony: annihilation
          if (kbHadronId !== h.id || kbMode !== "annihilate") {
            kbMode = "annihilate";
            kbHadronId = h.id;
            kbCharge = 0;
            if (!ev.repeat) note(midiOf(h.morph) + 2, 90);
          }
          kbCharge = clamp01(kbCharge + (ev.repeat ? 0.07 : 0.02));
          h.charge = kbCharge;
          const now = performance.now();
          if (now - lastTensionNoteAt > 340) {
            lastTensionNoteAt = now;
            note(midiOf(h.morph) + Math.round(kbCharge * 10), 90);
          }
          if (kbCharge >= 1) {
            kbCharge = 0;
            kbMode = "none";
            kbHadronId = null;
            annihilate(h);
          }
        } else {
          // empty vacuum: a press stirs it; holding condenses a triplet
          if (kbMode !== "condense") {
            kbMode = "condense";
            kbCharge = 0;
            if (!ev.repeat) perturb(x, y, 0.5);
          }
          kbCharge = clamp01(kbCharge + (ev.repeat ? 0.08 : 0.02));
          if (kbCharge >= 0.35 && !kbHadronId) {
            const seeded = condense(x, y);
            if (seeded) kbHadronId = seeded.id;
          }
          if (kbHadronId) {
            const seeded = hadrons.find((q) => q.id === kbHadronId);
            if (seeded && !seeded.closed) {
              seeded.growth = clamp01(seeded.growth + 0.08);
              if (seeded.growth >= 1) closeHadron(seeded);
            }
          }
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const h = hadrons.find((q) => q.id === kbHadronId);
        if (h && kbMode === "annihilate") h.charge = 0;
        kbCharge = 0;
        kbMode = "none";
        kbHadronId = null;
      }
    };
    const onFocus = () => { focused = true; };
    const onBlur = () => { focused = false; cursorVisible = false; save(true); };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("focus", onFocus);
    wrap.addEventListener("blur", onBlur);
    const onVis = () => { if (document.visibilityState === "hidden") save(true); };
    document.addEventListener("visibilitychange", onVis);

    // ————— drawing —————

    /** A gluon propagator: the Feynman coil, loops laid along the line. */
    const drawCoil = (x1: number, y1: number, x2: number, y2: number, alpha: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const loopEvery = 9;
      const amp = 3.4;
      const steps = Math.max(8, Math.floor(len / 2));
      ctx.strokeStyle = colorAlpha("#DDD3BE", alpha);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const phi = (t * len / loopEvery) * Math.PI * 2;
        const bx = x1 + ux * (t * len - amp * Math.sin(phi)) + px * amp * Math.cos(phi);
        const by = y1 + uy * (t * len - amp * Math.sin(phi)) + py * amp * Math.cos(phi);
        if (s === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      }
      ctx.stroke();
    };

    /** A photon in the diagram: the waving line. */
    const drawWavyLine = (x: number, y: number, angle: number, len: number, alpha: number, color: string) => {
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const px = -uy;
      const py = ux;
      const steps = Math.max(6, Math.floor(len / 3));
      ctx.strokeStyle = colorAlpha(color, alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const w = Math.sin(t * len / 5.5 * Math.PI) * 2.6;
        const bx = x - ux * t * len + px * w;
        const by = y - uy * t * len + py * w;
        if (s === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      }
      ctx.stroke();
    };

    /** A small chevron on a lens propagator: quark forward, antiquark back. */
    const drawArrow = (x: number, y: number, angle: number, alpha: number) => {
      const s = 4;
      ctx.strokeStyle = colorAlpha("#DDD3BE", alpha);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(angle - 0.5) * s, y - Math.sin(angle - 0.5) * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x - Math.cos(angle + 0.5) * s, y - Math.sin(angle + 0.5) * s);
      ctx.stroke();
    };

    const drawVirtualPair = (
      x: number, y: number, angle: number, sepPx: number, color: number, env: number, alpha: number,
    ) => {
      const feltAlpha = (1 - lens) * alpha;
      const lensAlpha = lens * alpha;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const off = (sepPx * env) / 2;
      if (feltAlpha > 0.02) {
        // two brief lives and the filament between them
        ctx.strokeStyle = colorAlpha(COLOR_TINTS[color], 0.16 * feltAlpha);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - ux * off, y - uy * off);
        ctx.lineTo(x + ux * off, y + uy * off);
        ctx.stroke();
        ctx.fillStyle = colorAlpha(COLOR_TINTS[color], 0.55 * feltAlpha);
        ctx.beginPath();
        ctx.arc(x + ux * off, y + uy * off, 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorAlpha(ANTI_TINTS[color], 0.5 * feltAlpha);
        ctx.beginPath();
        ctx.arc(x - ux * off, y - uy * off, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lensAlpha > 0.02) {
        // in the diagram a virtual pair is a closed loop
        ctx.strokeStyle = colorAlpha("#DDD3BE", 0.4 * env * lensAlpha);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(2, off), Math.max(1.4, off * 0.62), angle, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const drawHadron = (h: HadronEnt, breath: number) => {
      const morph = h.morph;
      const md = minDim();
      let fade = 1;
      if (h.retiringAt) fade = 1 - clamp01((performance.now() - h.retiringAt) / RETIRE_MS);
      const feltAlpha = (1 - lens) * fade;
      const lensAlpha = lens * fade;
      const grow = h.closed ? 1 : 0.25 + 0.75 * h.growth;
      const tubes = tubesOf(morph.kind);
      const shiverAmp = reduce ? 0 : h.shiver * 1.6;

      // cache screen coords
      for (const q of h.quarks) {
        q.sx = q.nx * width + (shiverAmp ? (twinkleHash(q.nx * 977 + localT * 31) - 0.5) * shiverAmp * 4 : 0);
        q.sy = q.ny * height + (shiverAmp ? (twinkleHash(q.ny * 883 + localT * 29) - 0.5) * shiverAmp * 4 : 0);
      }

      // ceremony halo: the hadron gathers toward light
      if (h.charge > 0 && feltAlpha > 0.02) {
        const cx = h.quarks.reduce((s, q) => s + q.sx, 0) / h.quarks.length;
        const cy = h.quarks.reduce((s, q) => s + q.sy, 0) / h.quarks.length;
        const hr = md * 0.11 * (1.4 - h.charge * 0.5);
        const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, hr);
        halo.addColorStop(0, colorAlpha("#F7F3EA", 0.12 * h.charge * fade));
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(cx - hr, cy - hr, hr * 2, hr * 2);
      }

      // — flux tubes: luminous strings; brighter and thinner as they strain —
      for (let k = 0; k < tubes.length; k++) {
        const [i, j] = tubes[k];
        const qa = h.quarks[i];
        const qb = h.quarks[j];
        const rest = morph.rest[k] * md;
        const len = Math.max(1, Math.hypot(qb.sx - qa.sx, qb.sy - qa.sy));
        const ratio = len / rest;
        const strain = clamp01((ratio - 1) / (SNAP_RATIO - 1));
        const closeT = h.closed ? 1 : clamp01(h.growth * tubes.length - k);
        if (closeT <= 0.02) continue;
        const mx = (qa.sx + qb.sx) / 2;
        const my = (qa.sy + qb.sy) / 2;

        if (feltAlpha > 0.02) {
          // the string sags when slack, straightens and pales when strained
          const sag = (1 - clamp01(ratio)) * 14 + (reduce ? 2 : Math.sin(breath + morph.breathOffset + k) * 3);
          const px = -(qb.sy - qa.sy) / len;
          const py = (qb.sx - qa.sx) / len;
          const cxq = mx + px * sag;
          const cyq = my + py * sag;
          const tintA = morph.antis[i] ? ANTI_TINTS[morph.colors[i]] : COLOR_TINTS[morph.colors[i]];
          const tintB = morph.antis[j] ? ANTI_TINTS[morph.colors[j]] : COLOR_TINTS[morph.colors[j]];
          const grad = ctx.createLinearGradient(qa.sx, qa.sy, qb.sx, qb.sy);
          grad.addColorStop(0, colorAlpha(tintA, (0.3 + strain * 0.55) * feltAlpha * closeT));
          grad.addColorStop(0.5, colorAlpha(mixHexToHex("#F2EEE6", tintA, 0.5), (0.2 + strain * 0.7) * feltAlpha * closeT));
          grad.addColorStop(1, colorAlpha(tintB, (0.3 + strain * 0.55) * feltAlpha * closeT));
          ctx.strokeStyle = grad;
          ctx.lineWidth = Math.max(0.8, (3.4 - strain * 2.1) * grow);
          ctx.beginPath();
          ctx.moveTo(qa.sx, qa.sy);
          if (h.closed) ctx.quadraticCurveTo(cxq, cyq, qb.sx, qb.sy);
          else {
            // a tube still closing draws only part of its road
            const tx = qa.sx + (qb.sx - qa.sx) * closeT;
            const ty = qa.sy + (qb.sy - qa.sy) * closeT;
            ctx.lineTo(tx, ty);
          }
          ctx.stroke();
          // near the snap the string cries: a pale corona at midpoint
          if (strain > 0.55) {
            const cg = ctx.createRadialGradient(mx, my, 0, mx, my, 16 * strain);
            cg.addColorStop(0, colorAlpha("#F7F3EA", 0.25 * (strain - 0.55) * feltAlpha));
            cg.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = cg;
            ctx.fillRect(mx - 20, my - 20, 40, 40);
          }
        }

        if (lensAlpha > 0.02) {
          // the same tube as mathematics: a coiled gluon propagator
          drawCoil(qa.sx, qa.sy, qb.sx, qb.sy, (0.5 + strain * 0.4) * lensAlpha * closeT);
        }
      }

      // — quarks: small bright certainties (felt) / vertices (lens) —
      for (let qi = 0; qi < h.quarks.length; qi++) {
        const q = h.quarks[qi];
        const anti = morph.antis[qi];
        const tint = anti ? ANTI_TINTS[morph.colors[qi]] : COLOR_TINTS[morph.colors[qi]];
        const cr = morph.core * md * grow * (reduce ? 1 : 1 + Math.sin(breath * 2 + morph.breathOffset + qi * 2.1) * 0.1);

        if (feltAlpha > 0.02) {
          const g = ctx.createRadialGradient(q.sx, q.sy, 0, q.sx, q.sy, cr * 3.2);
          g.addColorStop(0, colorAlpha("#F7F3EA", 0.85 * feltAlpha * grow));
          g.addColorStop(0.3, colorAlpha(tint, 0.55 * feltAlpha * grow));
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(q.sx, q.sy, cr * 3.2, 0, Math.PI * 2);
          ctx.fill();
          if (anti) {
            // an antiquark wears its color as a ring, not a heart
            ctx.strokeStyle = colorAlpha(COLOR_TINTS[morph.colors[qi]], 0.5 * feltAlpha);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(q.sx, q.sy, cr * 1.9, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        if (lensAlpha > 0.02) {
          // a vertex: the point where lines meet, nothing more
          ctx.fillStyle = colorAlpha("#DDD3BE", 0.85 * lensAlpha);
          ctx.beginPath();
          ctx.arc(q.sx, q.sy, 1.6, 0, Math.PI * 2);
          ctx.fill();
          // direction chevron along the first tube this quark belongs to:
          // forward for a quark, reversed for an antiquark — the notation
          const tube = tubes.find((t) => t[0] === qi || t[1] === qi);
          if (tube) {
            const other = h.quarks[tube[0] === qi ? tube[1] : tube[0]];
            const ang = Math.atan2(other.sy - q.sy, other.sx - q.sx) + (anti ? Math.PI : 0);
            const ax = q.sx + Math.cos(Math.atan2(other.sy - q.sy, other.sx - q.sx)) * 10;
            const ay = q.sy + Math.sin(Math.atan2(other.sy - q.sy, other.sx - q.sx)) * 10;
            drawArrow(ax, ay, ang, 0.7 * lensAlpha);
          }
        }
      }
    };

    function mixHexToHex(a: string, b: string, t: number): string {
      const va = parseInt(a.slice(1), 16);
      const vb = parseInt(b.slice(1), 16);
      const r = Math.round(((va >> 16) & 255) * (1 - t) + ((vb >> 16) & 255) * t);
      const g = Math.round(((va >> 8) & 255) * (1 - t) + ((vb >> 8) & 255) * t);
      const bl = Math.round((va & 255) * (1 - t) + (vb & 255) * t);
      return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
    }

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      windX += (windTargetX - windX) * Math.min(1, dt * 2.2);
      windY += (windTargetY - windY) * Math.min(1, dt * 2.2);
      windTargetX *= Math.exp(-dt * 0.5);
      windTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);

      for (let i = pendingNotes.length - 1; i >= 0; i--) {
        if (now >= pendingNotes[i].at) {
          note(pendingNotes[i].midi, pendingNotes[i].ms);
          pendingNotes.splice(i, 1);
        }
      }

      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;
      const md = minDim();

      // ————— physics: confinement, the anti-spring —————
      const stepDt = Math.min(0.05, dt) * timeScale;
      for (let hi = hadrons.length - 1; hi >= 0; hi--) {
        const h = hadrons[hi];
        if (h.retiringAt && now - h.retiringAt > RETIRE_MS) { hadrons.splice(hi, 1); dirty = true; continue; }
        if (!h.closed) {
          h.growth = clamp01(h.growth + dt * 0.4);
          if (h.growth >= 1) closeHadron(h);
        }
        h.shiver = Math.max(0, h.shiver - dt * 1.1);
        if (hold.hadronId !== h.id && kbHadronId !== h.id) h.charge = Math.max(0, h.charge - dt * 1.6);

        const tubes = tubesOf(h.morph.kind);
        const dragged = drag.hadronId === h.id;

        // tube forces on screen geometry, applied in normalized space
        for (let k = 0; k < tubes.length; k++) {
          const [i, j] = tubes[k];
          const qa = h.quarks[i];
          const qb = h.quarks[j];
          if (qa.sx < 0 || qb.sx < 0) continue; // not drawn yet
          const rest = h.morph.rest[k] * md;
          const dx = qb.sx - qa.sx;
          const dy = qb.sy - qa.sy;
          const len = Math.max(1, Math.hypot(dx, dy));
          const ux = dx / len;
          const uy = dy / len;
          // THE LAW: the pull grows with the stretch — and never lets go
          const f = confinementForce(len, rest) * FORCE_GAIN;
          // slack tubes push apart only gently: freedom at close quarters
          const c = len < rest * 0.8 ? ((rest * 0.8 - len) / rest) * 1.6 : 0;
          const a = f - c;
          qa.vx += ux * a * stepDt;
          qa.vy += uy * a * stepDt;
          qb.vx -= ux * a * stepDt;
          qb.vy -= uy * a * stepDt;

          // snap: past the ratio the tube parts and a new pair is born
          if (h.closed && !h.retiringAt && shouldSnap(len, rest)) {
            snap(h, k);
            break;
          }
        }
        if (!hadrons.includes(h)) continue; // snapped away this frame

        // the grabbed quark chases the finger — and loses, increasingly
        if (dragged && drag.quarkIdx >= 0 && drag.quarkIdx < h.quarks.length) {
          const q = h.quarks[drag.quarkIdx];
          const fx = (drag.x - q.sx) / md;
          const fy = (drag.y - q.sy) / md;
          q.vx += fx * FINGER_K * stepDt;
          q.vy += fy * FINGER_K * stepDt;
          // the hand feels the strain: ticks quicken as the tube tightens
          let worst = 0;
          for (let k = 0; k < tubes.length; k++) {
            const [i, j] = tubes[k];
            if (i !== drag.quarkIdx && j !== drag.quarkIdx) continue;
            const qa = h.quarks[i];
            const qb = h.quarks[j];
            const len = Math.hypot(qb.sx - qa.sx, qb.sy - qa.sy);
            worst = Math.max(worst, clamp01((len / (h.morph.rest[k] * md) - 1) / (SNAP_RATIO - 1)));
          }
          if (worst > 0.08) {
            const interval = 380 - worst * 300;
            if (now - lastTensionTickAt > interval) {
              lastTensionTickAt = now;
              try { (worst > 0.75 ? haptics.chop : haptics.tap)(); } catch { /* noop */ }
            }
            if (now - lastTensionNoteAt > 300) {
              lastTensionNoteAt = now;
              note(midiOf(h.morph) + Math.round(worst * 14), 110);
            }
          }
        }

        // spin, drift, wind, integration
        let cx = 0, cy = 0;
        for (const q of h.quarks) { cx += q.nx; cy += q.ny; }
        cx /= h.quarks.length;
        cy /= h.quarks.length;
        const spinUp = h.closed ? 1 : 1 + (1 - h.growth) * 3; // a condensing triplet spins up
        for (const q of h.quarks) {
          if (!reduce) {
            const rx = q.nx - cx;
            const ry = q.ny - cy;
            q.vx += -ry * h.morph.spin * spinUp * stepDt * 2;
            q.vy += rx * h.morph.spin * spinUp * stepDt * 2;
            const d = h.morph.drift;
            q.vx += Math.sin(localT * d.rate + d.ax) * 0.0016 * stepDt * 60;
            q.vy += Math.cos(localT * d.rate * 0.8 + d.ay) * 0.0014 * stepDt * 60;
          }
          q.vx += windX * 0.05 * stepDt * 60;
          q.vy += windY * 0.05 * stepDt * 60;
          q.nx = clamp(q.nx + q.vx * stepDt, 0.03, 0.97);
          q.ny = clamp(q.ny + q.vy * stepDt, 0.05, 0.96);
          const damp = Math.exp(-stepDt * 3.4);
          q.vx *= damp;
          q.vy *= damp;
        }
      }

      // ————— background: the vacuum after dark; the lens deepens it —————
      const bgTop = mixHex("#07080c", "#10121a", lens);
      const bgMid = mixHex("#08090e", "#131522", lens);
      const bgLow = mixHex("#090a0e", "#12131c", lens);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, bgTop);
      bg.addColorStop(0.55, bgMid);
      bg.addColorStop(1, bgLow);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // the candle, eighteen orders of magnitude above: the faintest warmth
      const glowPulse = reduce ? 0.03 : 0.028 + Math.sin(breath) * 0.012;
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.38, 10, width * 0.5, height * 0.38, Math.max(width, height) * 0.8);
      glow.addColorStop(0, `rgba(231, 172, 82, ${glowPulse + lens * 0.02})`);
      glow.addColorStop(0.55, "rgba(200, 115, 42, 0.02)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // field-line shimmer: short faint strokes leaning with a slow phase
      ctx.save();
      const shimmerAlpha = (1 - lens * 0.6) * 0.05;
      for (let i = 0; i < 36; i++) {
        const fx = twinkleHash(i * 13.3) * width;
        const fy = twinkleHash(i * 29.7) * height;
        const baseA = twinkleHash(i * 7.9) * Math.PI * 2;
        const a = baseA + (reduce ? 0 : Math.sin(localT * 0.3 + i) * 0.6);
        const l = 5 + twinkleHash(i * 3.7) * 7;
        ctx.strokeStyle = colorAlpha(i % 5 === 0 ? "#E7AC52" : "#CFC2A6", shimmerAlpha * (0.5 + twinkleHash(i * 41.1) * 0.5));
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(fx - Math.cos(a) * l + windX * 8, fy - Math.sin(a) * l + windY * 8);
        ctx.lineTo(fx + Math.cos(a) * l + windX * 8, fy + Math.sin(a) * l + windY * 8);
        ctx.stroke();
      }
      ctx.restore();

      // ————— the seethe: scheduled virtual pairs on the shared clock —————
      if (reduce) {
        // seething stilled: a fixed constellation of faint pairs
        for (let slot = 0; slot < 14; slot++) {
          const p = vacuumPairAt(slot, FIELD_SEED);
          if (!p) continue;
          drawVirtualPair(p.nx * width, p.ny * height, p.angle, p.sep * md, p.color, 0.55, 0.5);
        }
      } else {
        // slots ride the shared clock; dilation stretches each pair's life,
        // so under a three-finger hold the seethe lingers long enough to SEE
        const btMs = bt * 1000;
        const nowSlot = Math.floor(btMs / VACUUM_SLOT_MS);
        for (let slot = nowSlot - 16; slot <= nowSlot; slot++) {
          const p = vacuumPairAt(slot, FIELD_SEED);
          if (!p) continue;
          const age = btMs - slot * VACUUM_SLOT_MS;
          const life = p.lifeMs / timeScale;
          if (age < 0 || age > life) continue;
          const env = Math.sin((age / life) * Math.PI);
          drawVirtualPair(p.nx * width, p.ny * height, p.angle, p.sep * md, p.color, env, env);
        }
      }

      // interactive spark pairs (taps, stirs, snaps)
      for (let i = sparkPairs.length - 1; i >= 0; i--) {
        const sp = sparkPairs[i];
        const age = (now - sp.born) / sp.life;
        if (age >= 1) { sparkPairs.splice(i, 1); continue; }
        const env = Math.sin(age * Math.PI);
        drawVirtualPair(sp.x, sp.y, sp.angle, sp.sep, sp.color, env, env);
      }

      // pair-production rings from scrubbing
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg = rings[i];
        const age = (now - rg.born) / rg.life;
        if (age >= 1) { rings.splice(i, 1); continue; }
        const env = Math.sin(age * Math.PI);
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.22 * env * (1 - lens * 0.5));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(rg.x, rg.y, rg.r * (1 + age * 0.25), 0, Math.PI * 2);
        ctx.stroke();
      }

      // hadrons
      for (const h of hadrons) drawHadron(h, breath);

      // photons: straight racing streaks (felt) / waving lines (lens)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = photons.length - 1; i >= 0; i--) {
        const p = photons[i];
        const age = (now - p.born) / p.life;
        if (age >= 1) { photons.splice(i, 1); continue; }
        if (!reduce) {
          p.x += p.vx * dt; // light does not obey the room's dilation
          p.y += p.vy * dt;
        }
        const a = 1 - age;
        const ang = Math.atan2(p.vy, p.vx);
        if (lens > 0.5) {
          drawWavyLine(p.x, p.y, ang, 26, 0.7 * a, p.color);
        } else {
          const tail = 20 + 26 * a;
          ctx.strokeStyle = colorAlpha(p.color, 0.75 * a);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(p.x - Math.cos(ang) * tail, p.y - Math.sin(ang) * tail);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      }
      ctx.restore();

      // glimmer — after quiet, a ring where a dwell would land (never text)
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.25 + twinkleHash(slot) * 0.5) * width;
        const gy = (0.25 + twinkleHash(slot + 7) * 0.5) * height;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.1 + pulse * 0.12);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 14 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // keyboard cursor
      if (focused && cursorVisible) {
        const cx = cursorNx * width;
        const cy = cursorNy * height;
        ctx.strokeStyle = colorAlpha("#F2EEE6", 0.7);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = colorAlpha("#E7AC52", 0.85);
        ctx.fill();
      }

      if (dirty && now - lastSaveAt > 800) save(true);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      detach();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("focus", onFocus);
      wrap.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener?.("change", onMq);
      save(true);
    };
  }, []);

  return (
    <div className="quarks-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="quarks-field"
        role="application"
        tabIndex={0}
        aria-label="a vacuum that is never empty — pull a quark and the tube pulls back harder the further you pull; snap it and a new pair is born at the break: nothing here can be alone. arrows walk, enter stirs the field; held on the empty vacuum it gathers a triplet, held on a hadron it lets one return to light"
      >
        <canvas ref={canvasRef} className="quarks-canvas" aria-hidden="true" />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .quarks-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #07080c;
          overflow: hidden;
        }

        .quarks-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .quarks-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.quarks-page) {
          overflow: hidden;
          background: #07080c;
        }

        body:has(.quarks-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.quarks-page) .oda-field-watch,
        body:has(.quarks-page) .oda-candle-mark,
        body:has(.quarks-page) .oda-tape-shell,
        body:has(.quarks-page) .oda-sound-toggle {
          display: none !important;
        }

        .quarks-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }
      ` }}
      />
    </div>
  );
}
