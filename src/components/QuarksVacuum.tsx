"use client";

/**
 * /quarks — the confinement band at 10⁻¹⁸ m, the math band of the
 * manifold (plan W6). The strangest and quietest room on the site: there
 * are no things left down here, only relations — and below it, the quanta,
 * where even the relations dissolve into fields.
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
 * dwell on empty vacuum condenses — and what it condenses is the hand's
 * choice, made of duration alone: the seethe gathers visibly under the
 * finger from the touch tier, the dwell buys the cheap thing (a quark and
 * its own antiquark on one string), and a hand that keeps pressing past the
 * baryon depth pays for the third quark and the closed loop of three;
 * the ceremony held on a hadron is annihilation — photon streaks racing
 * off at light speed; a flick throws a hadron whole (it moves as one,
 * never sheds a part); a scrub stirs the vacuum into a glowing ring of
 * pair production; three fingers run a field wind or dilate time; a knock
 * on the case rings the field's door and everything bound answers; laid
 * face-down the room is night and the seethe goes on unwatched; a twist
 * rotates the lens to the bare mathematics — the Feynman view: vertices,
 * coiled gluon propagators, virtual pairs as closed loops, photons as
 * waving lines; three fingers twisted turn the season, from a vacuum nearly
 * still to one boiling with pair production. The field persists in
 * `objetdart:quarks:v1`. Deliberately unbound: pinch (ScaleTravel owns it —
 * nucleons above, the quanta below) and two-finger pan, there being no frame
 * to pan; two-finger tap lowers the lens.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { THRESHOLDS, attachGestures, tapTrainDepth, tapTrainTier } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import LetGo from "@/components/LetGo";
import { entryScaleFor, spectralRegisterFor } from "@/lib/scale";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import {
  ANTI_TINTS,
  BARYON_DEPTH,
  COLOR_TINTS,
  MAX_HADRONS,
  SNAP_RATIO,
  VACUUM_MAX_LIFE_MS,
  VACUUM_SLOT_MS,
  confinementForce,
  hadronFromSeed,
  hashSeed,
  kindForDepth,
  seedForKind,
  settlePopulation,
  shouldSnap,
  snapChildren,
  recombineSeeds,
  reconfineSeeds,
  RECONNECT_REACH,
  tubesOf,
  vacuumPairsAt,
  type HadronMorph,
} from "@/lib/quarks";

const STORE_KEY = "objetdart:quarks:v1";
const RETIRE_MS = 1400;
/** The hold tiers, read from the grammar — never redefined here. */
const TOUCH_MS = THRESHOLDS.tapMaxMs;
const DWELL_MS = THRESHOLDS.dwellMs;

/**
 * The room's place on the axis, sounded. This deep, the register rings high
 * and breathes quick — and every pitch in the room is an offset from it
 * rather than a number someone liked. Move the band and the whole room
 * retunes with it.
 */
const REGISTER = spectralRegisterFor(entryScaleFor("/quarks") ?? -17);
/** The band's fundamental under the site's monotone pitch law (as /overlook
 *  chimes it): power-compressed into the audible span. */
const RING_MIDI = Math.round(
  69 + 12 * Math.log2(
    Math.min(1250, Math.max(60, 220 * Math.pow(REGISTER.baseHz / 220, 0.62))) / 440,
  ),
);
/** Hadron voices sit one octave under the ring, so a field of them can stack
 *  into a chord without any single voice leaving the register. */
const VOICE_MIDI = RING_MIDI - 12;
/** Three octaves under the ring: the vacuum beneath the voices, the room's
 *  low word. */
const FLOOR_MIDI = RING_MIDI - 36;
/** Degrees the empty vacuum answers a stroke with, left edge to right. */
const STIR_DEGREES = [0, 2, 5, 7, 9];
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
  /**
   * An excited state: the tubes stretched past rest and the whole thing
   * spinning, until it drops back to the ground state radiating light.
   * `until` is when it falls; `strength` is how far up it was pushed.
   */
  resonance: { until: number; strength: number } | null;
  /** When this hadron may next trade colour with a neighbour, ms. */
  reconnectAt: number;
  birth: number;
  retiringAt: number;
};

/** A quark with no hadron — only ever inside the plasma, never on its own. */
type FreeQuark = { nx: number; ny: number; vx: number; vy: number; color: number; anti: boolean };

/**
 * The deconfined state: for as long as it holds, colour is not confined and
 * the quarks belong to no one. `seeds` is the census that went in, which is
 * what has to freeze back out.
 */
type Plasma = { born: number; life: number; seeds: number[]; quarks: FreeQuark[]; heat: number };

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

function mixHex(a: string, b: string, t: number): string {
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  const r = Math.round(((va >> 16) & 255) * (1 - t) + ((vb >> 16) & 255) * t);
  const g = Math.round(((va >> 8) & 255) * (1 - t) + ((vb >> 8) & 255) * t);
  const bl = Math.round((va & 255) * (1 - t) + (vb & 255) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
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
    resonance: null,
    reconnectAt: 0,
    birth: performance.now(),
    retiringAt: 0,
  };
}

// the first look is never a near-empty vacuum — a field already bound,
// spread so no two hadrons share a quadrant
const STARTERS: Array<{ nx: number; ny: number; triplet: boolean }> = [
  { nx: 0.30, ny: 0.30, triplet: true },
  { nx: 0.70, ny: 0.38, triplet: false },
  { nx: 0.38, ny: 0.68, triplet: false },
  { nx: 0.72, ny: 0.72, triplet: true },
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
  return VOICE_MIDI + morph.voice + (morph.kind === "triplet" ? 3 : 0);
}

export default function QuarksVacuum() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const letGoRef = useRef<() => void>(() => {});
  // whether anything bound still stands in the vacuum — gates the quiet clear
  const [standing, setStanding] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let hadrons: HadronEnt[] = [];
    let plasma: Plasma | null = null;
    /** Which rarer vacuum event the tier-3 train summons next. */
    let vacuumCycle = 0;
    /** The highest rung this tap train has already fired; 0 between trains. */
    let trainRung = 0;
    /** The next seeded moment the vacuum does something with no hand on it. */
    let nextAmbientAt = performance.now() + 7000;
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
    // the vessel: gravity's drift on the vacuum (-1..1)
    let tiltLeanX = 0;
    let tiltLeanY = 0;
    // face-down: the room dims toward night, and comes back when turned over
    let night = 0;
    let nightTarget = 0;
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
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
    const hold: {
      hadronId: string | null;
      onHadron: boolean;
      seededId: string | null;
      done: boolean;
      /** 0..1 — what the vacuum has visibly gathered under the finger */
      gather: number;
      gx: number;
      gy: number;
      /** 0..1 — how much the hand has poured in since the condensation */
      depth: number;
      forged: boolean;
    } = {
      hadronId: null, onHadron: false, seededId: null, done: false,
      gather: 0, gx: 0, gy: 0, depth: 0, forged: false,
    };
    let gatherFade = 0;
    let lastGatherNoteAt = 0;
    /** the room's slow cycle, 0..1: a still vacuum ↔ a boiling one */
    let season = 0.15;
    let seasonSpokenAt = 0;
    // span: two still fingers string a flux tube across the open vacuum —
    // held to the dwell, the interval condenses into a real pair
    const spanTube = { active: false, ax: 0, ay: 0, bx: 0, by: 0, elapsed: 0, spokenAt: 0 };
    // rhythm: a steady tapped pulse entrains the seethe to the hand's beat
    let entrainBpm = 0;
    let entrainUntil = 0;
    let lastEntrainBeat = -1;
    let beatEnv = 0;

    // ————— the room runtime: govern frames, sleep when unwatched —————
    const gov = createFrameGovernor();
    let sleeping = false;
    let paused = false;
    let lastTier = gov.tier();
    const offVis = onVisibility((hidden) => { sleeping = hidden; });
    const offPause = onGalleryPause((p) => { paused = p; });
    // the stilling: while true, saves are held so the annihilation sequence
    // cannot resurrect what the hand has already let go of.
    let clearing = false;
    const letGoTimers: number[] = [];

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; };
    mq.addEventListener?.("change", onMq);

    // ————— persistence —————
    const save = (force = false) => {
      if (clearing) { dirty = false; return; } // the stilling already wrote its empty word
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
    // an empty hadrons list is a real state (the vacuum was stilled) —
    // starters do not respawn over a deliberate clearing.
    if (stored) {
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
    const syncStanding = () => setStanding(!clearing && (plasma != null || hadrons.some((h) => !h.retiringAt)));
    syncStanding();

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const noteLater = (delayMs: number, midi: number, ms = 120) => {
      pendingNotes.push({ at: performance.now() + delayMs, midi, ms });
    };

    // ————— sprites: the two soft glows this room draws, baked once —————
    const sprite = (stops: Array<[number, string]>, size = 64): HTMLCanvasElement => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const g = c.getContext("2d");
      if (g) {
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        for (const [stop, color] of stops) grad.addColorStop(stop, color);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
      }
      return c;
    };
    // one core sprite per tint (quark and anti alike) — the per-quark radial
    // gradient used to be rebuilt every frame for every constituent
    const CORE_SPRITES = new Map<string, HTMLCanvasElement>();
    for (const hex of [...COLOR_TINTS, ...ANTI_TINTS]) {
      CORE_SPRITES.set(hex, sprite([
        [0, colorAlpha("#F7F3EA", 0.85)],
        [0.3, colorAlpha(hex, 0.55)],
        [1, "rgba(0,0,0,0)"],
      ]));
    }
    const CORONA_SPRITE = sprite([
      [0, "rgba(247, 243, 234, 0.5)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    const CEREMONY_SPRITE = sprite([
      [0, "rgba(247, 243, 234, 0.34)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    const GATHER_SPRITE = sprite([
      [0, "rgba(242, 238, 230, 0.38)"],
      [0.45, "rgba(231, 172, 82, 0.14)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    const stamp = (img: HTMLCanvasElement, x: number, y: number, r: number, alpha: number) => {
      if (alpha <= 0.004 || r <= 0.3) return;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), { embedded: isEmbeddedFrame(), reducedMotion: reduce });
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

    /**
     * The vacuum condenses what the hand has paid for: at the dwell it can
     * only afford the cheap thing — one quark and its own antiquark on a
     * single string — and a hand that keeps pressing pays for the third
     * quark and the closed loop. `depth` is that payment, 0..1, and
     * kindForDepth is the whole choice. No control, no word: duration.
     */
    const condense = (x: number, y: number, depth = 0): HadronEnt | null => {
      const nx = clamp(x / width, 0.08, 0.92);
      const ny = clamp(y / height, 0.1, 0.92);
      const seed = seedForKind(
        hashSeed(Math.round(nx * 811), Math.round(ny * 809), seedCount),
        kindForDepth(depth),
      );
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
      syncStanding();
      return h;
    };

    /**
     * The third quark arrives. A hand that keeps pouring in past the baryon
     * depth turns the pair it was making into a triplet, in place: the same
     * spot, the same growth, one more constituent and a loop of three tubes
     * instead of one string. This is how "make a different one" is said here.
     */
    const forgeTriplet = (h: HadronEnt): HadronEnt | null => {
      if (h.morph.kind === "triplet") return h;
      let cx = 0;
      let cy = 0;
      for (const q of h.quarks) {
        cx += q.nx;
        cy += q.ny;
      }
      cx /= h.quarks.length;
      cy /= h.quarks.length;
      const grown = makeHadron(seedForKind(h.seed, "triplet"), cx, cy, Math.min(0.92, h.growth));
      hadrons = hadrons.filter((q) => q.id !== h.id);
      hadrons.push(grown);
      const px = cx * width;
      const py = cy * height;
      try { audio().bell(); } catch { /* noop */ }
      note(midiOf(grown.morph) + 4, 220);
      try { haptics.bloom(); } catch { /* noop */ }
      spraySparks(px, py, 7, 30);
      useField.getState().recordTape("object", 0.65, "quarks/triplet");
      syncStanding();
      return grown;
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
      note(RING_MIDI - 5 + Math.round(intensity * 5), 90);
      try { haptics.tap(); } catch { /* noop */ }
      useField.getState().recordTape("ripple", 0.3 + intensity * 0.4, "quarks/perturb");
    };

    /**
     * EXCITATION TO A RESONANCE — what a train of taps does to something
     * already bound. Energy poured into a hadron cannot free a quark (the
     * tube only pulls harder), so it goes into the tube itself: the strings
     * stretch past rest, the whole thing spins up, and for a moment it is a
     * heavier state of the same constituents. That is what a resonance IS —
     * not a new particle, an excited one — and it does not last. When it
     * falls it RADIATES the difference as light, one photon per quark, and
     * comes back down with its colour assignment rotated: the gluon exchange
     * that carried the energy away also carried colour between the quarks.
     *
     * `depth` is how far the ladder was climbed, and it is a continuous axis:
     * a firmer, longer train pushes the state higher and holds it longer.
     */
    const exciteResonance = (h: HadronEnt, intensity: number, depth: number) => {
      const strength = clamp01(0.35 + intensity * 0.45 + depth * 0.5);
      const nowR = performance.now();
      const already = h.resonance ? clamp01(h.resonance.strength) : 0;
      h.resonance = {
        until: nowR + 620 + strength * 900,
        strength: clamp01(Math.max(already + 0.2, strength)),
      };
      h.shiver = Math.min(1, h.shiver + 0.4 + strength * 0.4);
      // the tubes stretch: the constituents are kicked outward from the
      // centre, which the confinement law will answer for
      let cx = 0;
      let cy = 0;
      for (const q of h.quarks) {
        cx += q.nx;
        cy += q.ny;
      }
      cx /= h.quarks.length;
      cy /= h.quarks.length;
      for (const q of h.quarks) {
        const rx = q.nx - cx;
        const ry = q.ny - cy;
        const r = Math.max(1e-4, Math.hypot(rx, ry));
        q.vx += (rx / r) * 0.05 * strength;
        q.vy += (ry / r) * 0.05 * strength;
        // and it spins: angular momentum is what a resonance mostly is
        q.vx += -ry * 0.5 * strength;
        q.vy += rx * 0.5 * strength;
      }
      for (let qi = 0; qi < h.quarks.length; qi++) {
        noteLater(qi * 70, midiOf(h.morph) + [0, 4, 7][qi % 3] + Math.round(strength * 7), 130);
      }
      try { audio().buzz(); } catch { /* noop */ }
      try { haptics.ripple(0.35 + strength * 0.4); } catch { /* noop */ }
      useField.getState().recordTape("object", clamp01(0.5 + strength * 0.4), "quarks/resonance");
    };

    /**
     * The resonance falls. The light goes out along each quark's own colour,
     * and the state that is left is the same constituents wearing a rotated
     * assignment — the exchange that carried the energy off carried colour
     * with it. Still white: it always is, that is the only law down here.
     */
    const dropFromResonance = (h: HadronEnt) => {
      const strength = h.resonance ? h.resonance.strength : 0.4;
      h.resonance = null;
      for (let qi = 0; qi < h.quarks.length; qi++) {
        const q = h.quarks[qi];
        emitPhoton(q.sx, q.sy, twinkleHash(h.seed + qi * 7 + strength * 97) * Math.PI * 2, COLOR_TINTS[h.morph.colors[qi]]);
      }
      // the colour rotation, in place: the same kind, a new assignment
      const rotated = seedForKind(hashSeed(h.seed, 0xc010, Math.round(strength * 97)), h.morph.kind);
      h.seed = rotated;
      h.morph = { ...hadronFromSeed(rotated), rest: h.morph.rest };
      h.shiver = Math.min(1, h.shiver + 0.5);
      try { audio().bell(); } catch { /* noop */ }
      note(midiOf(h.morph) + 12, 200);
      noteLater(130, midiOf(h.morph) + 7, 260);
      try { haptics.bloom(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", clamp01(0.55 + strength * 0.35), "quarks/radiate");
      save();
    };

    /**
     * COLOUR RECONNECTION — the physics between hadrons, which is the thing
     * a field of separately-drawn hadrons does not have. Each one is white,
     * so at any distance they are invisible to each other; bring two inside
     * RECONNECT_REACH and the colour fields overlap, a gluon crosses, and the
     * strings re-form ACROSS the pair. What parts is two hadrons neither of
     * which is either parent — the constituents have been traded.
     */
    const reconnect = (a: HadronEnt, b: HadronEnt) => {
      const nowR = performance.now();
      const [s1, s2] = recombineSeeds(a.seed, b.seed);
      const ca = { x: a.quarks.reduce((s, q) => s + q.nx, 0) / a.quarks.length, y: a.quarks.reduce((s, q) => s + q.ny, 0) / a.quarks.length };
      const cb = { x: b.quarks.reduce((s, q) => s + q.nx, 0) / b.quarks.length, y: b.quarks.reduce((s, q) => s + q.ny, 0) / b.quarks.length };
      const mx = ((ca.x + cb.x) / 2) * width;
      const my = ((ca.y + cb.y) / 2) * height;
      hadrons = hadrons.filter((q) => q !== a && q !== b);
      if (drag.hadronId === a.id || drag.hadronId === b.id) { drag.hadronId = null; drag.quarkIdx = -1; }
      const c1 = makeHadron(s1, ca.x, ca.y, 1);
      const c2 = makeHadron(s2, cb.x, cb.y, 1);
      // they leave along the axis they met on, still trailing the tube that
      // briefly ran between them
      const ax = (cb.x - ca.x) || 0.001;
      const ay = (cb.y - ca.y) || 0.001;
      const al = Math.hypot(ax, ay);
      for (const q of c1.quarks) { q.vx -= (ax / al) * 0.05; q.vy -= (ay / al) * 0.05; }
      for (const q of c2.quarks) { q.vx += (ax / al) * 0.05; q.vy += (ay / al) * 0.05; }
      c1.shiver = 1;
      c2.shiver = 1;
      c1.reconnectAt = nowR + 2600;
      c2.reconnectAt = nowR + 2600;
      hadrons.push(c1, c2);
      retireOldest();
      emitPhoton(mx, my, twinkleHash(s1) * Math.PI * 2, "#F7F3EA");
      spraySparks(mx, my, 9, 40);
      try { audio().bell(); } catch { /* noop */ }
      note(FLOOR_MIDI + 12, 300);
      noteLater(120, midiOf(c1.morph), 200);
      noteLater(240, midiOf(c2.morph), 240);
      try { haptics.detent(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.8, "quarks/reconnect");
      save();
      syncStanding();
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
      note(FLOOR_MIDI + 9 + h.morph.voice, 420);
      noteLater(90, midiOf(h.morph) + 5, 180);
      spraySparks(bx, by, 10, 44);
      useField.getState().recordTape("sigil", 0.85, "quarks/snap");
      save();
      syncStanding();
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
      syncStanding();
    };

    /**
     * The rarer things the bare vacuum does, in a fixed cycle so a hand that
     * keeps asking keeps being answered differently. Seeded, never random.
     */
    const vacuumEvent = (x: number, y: number, intensity: number, depth: number) => {
      const which = vacuumCycle % 3;
      vacuumCycle += 1;
      const md = minDim();
      const seed = hashSeed(Math.round(x), Math.round(y), vacuumCycle, 0x1e75);
      const k = 0.6 + intensity * 0.7 + depth * 0.7;
      if (which === 0) {
        // A TWO-JET EVENT. A quark and an antiquark thrown apart back to back
        // do not come apart: the tube between them stretches, snaps, snaps
        // again, and what reaches the walls is two narrow SPRAYS of colourless
        // hadrons along the original directions. You never see the quark —
        // you see the jet it made, which is the only way anyone ever has.
        const ang = twinkleHash(seed) * Math.PI * 2;
        for (const sgn of [-1, 1]) {
          for (let i = 0; i < 5; i++) {
            const spread = (twinkleHash(seed + i * 13 + (sgn > 0 ? 71 : 7)) - 0.5) * 0.5;
            const r = md * (0.06 + i * 0.05) * k;
            const a2 = ang + spread * 0.5;
            emitPhoton(x + Math.cos(a2) * r * sgn, y + Math.sin(a2) * r * sgn, a2 + (sgn > 0 ? 0 : Math.PI), COLOR_TINTS[i % 3]);
            spraySparks(x + Math.cos(a2) * r * sgn, y + Math.sin(a2) * r * sgn, 3, 16 + i * 5);
          }
        }
        // and one real hadron freezes out of each jet's hardest fragment
        for (const sgn of [-1, 1]) {
          const h = condense(x + Math.cos(ang) * md * 0.2 * sgn, y + Math.sin(ang) * md * 0.2 * sgn, depth * 0.7);
          if (h) {
            h.growth = 1;
            h.closed = true;
            h.shiver = 1;
            for (const q of h.quarks) {
              q.vx += Math.cos(ang) * 0.06 * sgn;
              q.vy += Math.sin(ang) * 0.06 * sgn;
            }
          }
        }
        note(RING_MIDI - 7, 160);
        noteLater(120, RING_MIDI, 200);
        try { haptics.chop(); } catch { /* noop */ }
        useField.getState().recordTape("region", clamp01(0.6 + depth * 0.3), "quarks/jets");
        return;
      }
      if (which === 1) {
        // A GLUON SHOWER. A gluon carries the colour it mediates, so it can
        // radiate gluons itself — and those radiate more. The cascade is why
        // the strong force is strong, and why a jet is a spray and not a line.
        const gens = 3;
        let front: Array<[number, number, number]> = [[x, y, twinkleHash(seed) * Math.PI * 2]];
        for (let g = 0; g < gens; g++) {
          const next: Array<[number, number, number]> = [];
          for (const [px, py, pa] of front) {
            for (const branch of [-1, 1]) {
              const a2 = pa + branch * (0.5 - g * 0.08) + (twinkleHash(seed + g * 31 + px) - 0.5) * 0.3;
              const r = md * (0.05 + g * 0.035) * k;
              const nx2 = px + Math.cos(a2) * r;
              const ny2 = py + Math.sin(a2) * r;
              spraySparks(nx2, ny2, 2 + (gens - g), 12 + g * 8);
              emitPhoton(px, py, a2, COLOR_TINTS[(g + (branch > 0 ? 1 : 2)) % 3]);
              if (g < gens - 1) next.push([nx2, ny2, a2]);
            }
          }
          front = next;
          noteLater(g * 90, RING_MIDI - 12 + g * 5, 110);
        }
        rings.push({ x, y, r: md * 0.1 * k, born: performance.now(), life: 900 });
        if (rings.length > 6) rings.splice(0, rings.length - 6);
        try { audio().buzz(); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        useField.getState().recordTape("region", clamp01(0.5 + depth * 0.35), "quarks/gluon-shower");
        return;
      }
      // A STRING SPONTANEOUSLY BREAKING in the bare vacuum: the field pulls a
      // pair out of nothing, the tube between them stretches past what it can
      // hold, and it snaps into two bound things instead of ever letting one
      // go free. The room's whole law, performed with no hadron involved.
      const ang = twinkleHash(seed * 1.9) * Math.PI * 2;
      const reach = md * (0.12 + k * 0.09);
      const ax = x - Math.cos(ang) * reach;
      const ay = y - Math.sin(ang) * reach;
      const bx = x + Math.cos(ang) * reach;
      const by = y + Math.sin(ang) * reach;
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        spraySparks(ax + (bx - ax) * u, ay + (by - ay) * u, 2, 10);
      }
      const h1 = condense(ax, ay, 0);
      const h2 = condense(bx, by, 0);
      for (const h of [h1, h2]) {
        if (!h) continue;
        h.growth = 1;
        h.closed = true;
        h.shiver = 1;
      }
      rings.push({ x, y, r: reach, born: performance.now(), life: 800 });
      if (rings.length > 6) rings.splice(0, rings.length - 6);
      try { audio().spark(); } catch { /* noop */ }
      note(FLOOR_MIDI + 7, 260);
      noteLater(140, RING_MIDI, 200);
      try { haptics.detent(); } catch { /* noop */ }
      useField.getState().recordTape("object", clamp01(0.55 + depth * 0.3), "quarks/string-break");
    };

    /**
     * DECONFINEMENT — the room's largest, rarest event, and the only state
     * this material has ever been in where the room's own law is suspended.
     * Heat the vacuum past the point where the strings can hold and colour
     * stops being confined: the quarks stop belonging to any particular
     * hadron and move as one hot liquid. The universe was in this state for
     * its first microsecond and has never been in it since.
     *
     * It does not last, and the way it ends is the point: as the plasma cools
     * every quark must find partners again, and what freezes out is a fresh
     * set of white hadrons carrying the same census (`reconfineSeeds`). The
     * things that come back are not the things that went in.
     */
    const deconfine = (intensity: number, depth: number) => {
      const alive = hadrons.filter((h) => !h.retiringAt && h.closed);
      if (alive.length === 0) return;
      const nowD = performance.now();
      const k = 0.5 + intensity * 0.6 + depth * 0.8;
      const md = minDim();
      const freed: FreeQuark[] = [];
      for (const h of alive) {
        for (let qi = 0; qi < h.quarks.length; qi++) {
          const q = h.quarks[qi];
          const a = twinkleHash(h.seed + qi * 17) * Math.PI * 2;
          freed.push({
            nx: q.nx,
            ny: q.ny,
            vx: Math.cos(a) * (0.22 + k * 0.22),
            vy: Math.sin(a) * (0.22 + k * 0.22),
            color: h.morph.colors[qi],
            anti: h.morph.antis[qi],
          });
        }
        spraySparks(
          h.quarks.reduce((s, q) => s + q.sx, 0) / h.quarks.length,
          h.quarks.reduce((s, q) => s + q.sy, 0) / h.quarks.length,
          8, md * 0.06,
        );
      }
      plasma = {
        born: nowD,
        life: 900 + k * 900,
        seeds: alive.map((h) => h.seed),
        quarks: freed,
        heat: 1,
      };
      hadrons = hadrons.filter((h) => h.retiringAt);
      drag.hadronId = null;
      drag.quarkIdx = -1;
      rings.push({ x: width * 0.5, y: height * 0.5, r: md * 0.06, born: nowD, life: 1400 });
      if (rings.length > 6) rings.splice(0, rings.length - 6);
      try { audio().thud(); } catch { /* noop */ }
      try { audio().bell(); } catch { /* noop */ }
      note(FLOOR_MIDI - 12, 700);
      noteLater(200, FLOOR_MIDI, 500);
      noteLater(460, RING_MIDI - 12, 420);
      try { haptics.storm(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", clamp01(0.9 + depth * 0.1), "quarks/deconfine");
      syncStanding();
    };

    /** The plasma cools and colour is confined again — into new partners. */
    const reconfine = () => {
      if (!plasma) return;
      const p = plasma;
      plasma = null;
      const seeds = reconfineSeeds(p.seeds, hashSeed(Math.round(p.born), p.quarks.length));
      // the freeze-out lands where the plasma actually is, so the new things
      // come out of the hot liquid rather than appearing beside it
      seeds.forEach((s, i) => {
        const q = p.quarks[Math.min(p.quarks.length - 1, i * 2)] ?? p.quarks[0];
        const h = makeHadron(s, clamp(q ? q.nx : 0.5, 0.08, 0.92), clamp(q ? q.ny : 0.5, 0.1, 0.92), 1);
        h.shiver = 1;
        h.reconnectAt = performance.now() + 2200;
        hadrons.push(h);
        noteLater(i * 110, midiOf(h.morph), 240);
      });
      retireOldest();
      for (const q of p.quarks) spraySparks(q.nx * width, q.ny * height, 3, 20);
      try { audio().chime(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.9, "quarks/reconfine");
      save();
      syncStanding();
    };

    // the whole-vacuum parting (LetGo, §8c): one low word, then every bound
    // thing returns to light along the existing annihilation path, in
    // sequence — an exhale, never a blink. Storage is written empty at once:
    // a stilled vacuum is a remembered state, and the starters do not return.
    const letGo = () => {
      if (clearing) return;
      // a plasma is a state of the room too: stilling the vacuum lets it
      // freeze back out first, so nothing is left hanging with no hadron
      if (plasma) reconfine();
      const alive = hadrons.filter((h) => !h.retiringAt);
      if (alive.length === 0) return;
      try { audio().thud(); } catch { /* noop */ }
      note(FLOOR_MIDI - 12, 520);
      try { haptics.roll(); } catch { /* noop */ }
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ hadrons: [] } satisfies Stored));
      } catch { /* noop */ }
      useField.getState().recordTape("object", 0.3, "quarks/letgo");
      setStanding(false);
      if (reduce) {
        // reduced motion: a quick fade of light, no racing photon sequence
        for (const h of alive) { h.charge = 0; h.retiringAt = performance.now(); }
        if (drag.hadronId) { drag.hadronId = null; drag.quarkIdx = -1; }
        return;
      }
      clearing = true;
      alive.forEach((h, i) => {
        letGoTimers.push(window.setTimeout(() => {
          if (hadrons.includes(h) && !h.retiringAt) annihilate(h);
        }, 160 + i * 240));
      });
      letGoTimers.push(window.setTimeout(() => {
        clearing = false;
        save(true); // anything condensed mid-stilling is kept honestly
        syncStanding();
      }, 160 + alive.length * 240 + 80));
    };
    letGoRef.current = letGo;

    // the raised-lens marker ScaleTravel reads before a step-back nudge
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    // three-finger tap = tutti (grammar §5): one synchronized soft pulse —
    // every hadron's tubes shimmer and its voice speaks once, quietly.
    // Intensity is an axis: a firmer chord shakes the field harder and
    // more voices join the statement.
    const tutti = (strength = 0.5) => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      const k = clamp01(strength);
      const alive = hadrons.filter((h) => !h.retiringAt && h.closed);
      alive.forEach((h, i) => {
        h.shiver = Math.max(h.shiver, 0.35 + k * 0.45);
        if (i < 4 + Math.round(k * 6)) noteLater(i * 45, midiOf(h.morph), 70 + Math.round(k * 60));
      });
      try { (k > 0.7 ? haptics.ripple(k) : haptics.tap()); } catch { /* noop */ }
    };

    // ————— gestures (the grammar, nothing private; pinch belongs to the manifold) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          // step back: a raised lens lowers first; the marker clears a beat
          // later so ScaleTravel skips its nudge on this same tap
          if (lensSnapped === 1) {
            lensSnapped = 0;
            lensTarget = 0;
            window.setTimeout(() => markLens(false), 0);
            try { haptics.lens(); } catch { /* noop */ }
            note(FLOOR_MIDI, 160);
          }
          return;
        }
        if (e.fingers === 3) { tutti(e.intensity); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const { x, y } = toLocal(e.x, e.y);
        // The site-wide tap ladder (gesture/core.ts: 1 / 3 / 5 / n) read in
        // this material. One tap perturbs. Three excite what is bound into a
        // resonance — or, on the bare vacuum, summon one of the rarer things
        // colour does. Five DECONFINE: the room's own law suspended for a
        // breath. Past seven the plasma is held open and reheated for as long
        // as the hand keeps hammering, which is the rung with no ceiling.
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (e.count <= 1) trainRung = 0;
        if (trainTier === "n") {
          // the sustained train: the plasma is held open and stirred hotter,
          // and everything still bound trembles harder each time
          trainRung = 7;
          if (plasma) {
            plasma.life += 260 + depth * 420;
            plasma.heat = Math.min(2.2, plasma.heat + 0.25 + depth * 0.35);
            for (const q of plasma.quarks) {
              const a = twinkleHash(q.nx * 977 + q.ny * 883 + e.count) * Math.PI * 2;
              q.vx += Math.cos(a) * 0.1 * (0.5 + depth);
              q.vy += Math.sin(a) * 0.1 * (0.5 + depth);
            }
          } else {
            deconfine(e.intensity, depth);
          }
          rings.push({ x, y, r: minDim() * (0.14 + depth * 0.14), born: performance.now(), life: 1100 });
          if (rings.length > 6) rings.splice(0, rings.length - 6);
          spraySparks(x, y, 9 + Math.round(depth * 8), minDim() * (0.22 + depth * 0.1));
          for (const h of hadrons) h.shiver = Math.min(1, h.shiver + 0.5 + depth * 0.5);
          note(RING_MIDI, 140);
          noteLater(90, RING_MIDI + 7, 160);
          noteLater(200, RING_MIDI + 12, 200 + Math.round(depth * 120));
          try { haptics.storm(); } catch { /* noop */ }
          useField.getState().recordTape("region", 0.7 + depth * 0.3, "quarks/boil");
          return;
        }
        if (trainTier === 5) {
          if (trainRung >= 5) {
            // still inside the rung: stir the plasma hotter rather than
            // starting a second one — the axis is continuous, not a switch
            if (plasma) {
              plasma.life += 180 + depth * 240;
              plasma.heat = Math.min(2.2, plasma.heat + 0.2);
            }
            spraySparks(x, y, 6, minDim() * 0.16);
            try { haptics.chop(); } catch { /* noop */ }
            return;
          }
          trainRung = 5;
          deconfine(e.intensity, depth);
          return;
        }
        if (trainTier === 3) {
          const h = hadronAt(x, y);
          if (trainRung >= 3) {
            // deepen what the rung already began
            if (h && h.closed) exciteResonance(h, e.intensity, depth);
            else spraySparks(x, y, 5 + Math.round(depth * 5), 34 + depth * 26);
            return;
          }
          trainRung = 3;
          if (h && h.closed) exciteResonance(h, e.intensity, depth);
          else vacuumEvent(x, y, e.intensity, depth);
          return;
        }
        trainRung = 1;
        perturb(x, y, e.intensity);
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "enter") { timeScaleTarget = 0.25; try { haptics.tap(); } catch { /* noop */ } note(FLOOR_MIDI - 12, 300); }
          // duration is an axis: the dilation keeps deepening the longer the
          // chord stands — never the same at 900ms and 2400ms
          if (e.phase === "tick") timeScaleTarget = Math.max(0.07, 0.25 - 0.18 * clamp01((e.elapsed - DWELL_MS) / 3000));
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
          hold.gather = 0;
          hold.depth = 0;
          hold.forged = false;
          hold.gx = x;
          hold.gy = y;
          return;
        }
        if (e.phase === "release") {
          const h = hadrons.find((q) => q.id === hold.hadronId);
          if (h) h.charge = 0;
          hold.hadronId = null;
          hold.onHadron = false;
          hold.seededId = null;
          gatherFade = hold.gather;
          hold.gather = 0;
          save();
          return;
        }
        // ticks (~80ms). On the open vacuum the seethe visibly draws inward
        // under the finger from the touch tier on, tightening until a hadron
        // condenses at the dwell — the verb is watched, never explained.
        if (!hold.onHadron) {
          hold.gx = x;
          hold.gy = y;
          hold.gather = hold.seededId
            ? Math.max(0, 1 - (e.elapsed - DWELL_MS) / 460) // it became the hadron
            : clamp01((e.elapsed - TOUCH_MS) / (DWELL_MS - TOUCH_MS));
          const nowG = performance.now();
          if (!hold.seededId && hold.gather > 0 && hold.gather < 1 && nowG - lastGatherNoteAt > 150) {
            lastGatherNoteAt = nowG;
            note(RING_MIDI - 16 + Math.round(hold.gather * 14), 70);
          }
        }
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
          // the hadron this hand is condensing — keep holding and the vacuum
          // keeps paying: the strings fill in, and past the baryon depth the
          // third quark arrives and the pair becomes a triplet
          hold.depth = clamp01((e.elapsed - DWELL_MS) / 1600);
          let h = hadrons.find((q) => q.id === hold.seededId);
          if (h && !hold.forged && kindForDepth(hold.depth) === "triplet" && h.morph.kind === "pair") {
            hold.forged = true;
            const grown = forgeTriplet(h);
            if (grown) {
              hold.seededId = grown.id;
              h = grown;
            }
          }
          if (h && !h.closed) {
            h.growth = clamp01(h.growth + 0.0011 * 80 * (1 + e.intensity * 0.6));
            if (h.growth >= 1) closeHadron(h);
          } else if (h) {
            // duration is an axis: past the closing the field keeps feeding —
            // the fresh hadron trembles with the energy the hand pours in
            h.shiver = Math.min(1, h.shiver + 0.03 * (1 + e.intensity * 0.5));
            const now = performance.now();
            if (now - lastTensionNoteAt > 700) {
              lastTensionNoteAt = now;
              note(midiOf(h.morph) + 2 + Math.round(h.shiver * 4), 90);
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
        } else if (e.tier >= 2 && !hold.onHadron) {
          // dwell on the empty vacuum: condense — long-press means grow,
          // everywhere. What it condenses is decided by how long the hand
          // stays: the cheap pair now, the triplet if it keeps paying.
          const h = condense(x, y, hold.depth);
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
            note(FLOOR_MIDI - 10 + Math.round(mag * 5), 280);
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
          // Most of the field is open vacuum, so this is the likeliest first
          // thing a hand does: it must sound. The stroke leaves a wake of
          // pairs and wakes a degree of the vacuum where it passes — the run
          // climbs from left edge to right, so a sweep is a phrase.
          const now = performance.now();
          if (now - lastStirSparkAt > 200) {
            lastStirSparkAt = now;
            const drift = clamp01(Math.hypot(e.vx, e.vy) * 0.5);
            spraySparks(x, y, 1 + Math.round(drift * 2), 10 + drift * 14);
            const deg = STIR_DEGREES[Math.min(4, Math.floor(clamp01(x / Math.max(1, width)) * 5))];
            note(RING_MIDI - 12 + deg, 70);
            try { haptics.tap(); } catch { /* noop */ }
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
        if (e.fingers === 3) {
          // three fingers turn the season: the vacuum's own temperature —
          // wound one way it goes nearly still, wound the other it boils and
          // the seethe fills the field
          if (e.phase !== "move") return;
          lastInteractionAt = performance.now();
          season = (season - e.angle / (Math.PI * 2) + 1) % 1;
          const now = performance.now();
          if (now - seasonSpokenAt > 260) {
            seasonSpokenAt = now;
            const seethe = 0.5 - 0.5 * Math.cos(season * Math.PI * 2);
            note(FLOOR_MIDI + Math.round(seethe * 24), 200);
            try { haptics.detent(); } catch { /* noop */ }
          }
          return;
        }
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: the felt field ↔ the bare mathematics
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            markLens(snapped === 1);
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(FLOOR_MIDI, 160);
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
          note(RING_MIDI - 10 + Math.round(Math.abs(e.winding) * 2), 90);
          try { haptics.ripple(0.3); } catch { /* noop */ }
        }
      },
      span: (e) => {
        lastInteractionAt = performance.now();
        if (e.phase === "release") {
          if (spanTube.active && spanTube.elapsed >= DWELL_MS && hadrons.length < MAX_HADRONS + 2) {
            // held to the dwell, the strung interval condenses: a real pair
            // whose quarks land exactly where the fingers stood
            const anx = clamp(spanTube.ax / Math.max(1, width), 0.05, 0.95);
            const anyy = clamp(spanTube.ay / Math.max(1, height), 0.07, 0.94);
            const bnx = clamp(spanTube.bx / Math.max(1, width), 0.05, 0.95);
            const bny = clamp(spanTube.by / Math.max(1, height), 0.07, 0.94);
            const seed = seedForKind(hashSeed(Math.round(anx * 811), Math.round(bny * 809), seedCount), "pair");
            seedCount += 1;
            const h = makeHadron(seed, (anx + bnx) / 2, (anyy + bny) / 2, 0.72);
            h.quarks[0].nx = anx;
            h.quarks[0].ny = anyy;
            h.quarks[1].nx = bnx;
            h.quarks[1].ny = bny;
            hadrons.push(h);
            retireOldest();
            try { audio().bell(); } catch { /* noop */ }
            note(midiOf(h.morph), 260);
            try { haptics.bloom(); } catch { /* noop */ }
            spraySparks((spanTube.ax + spanTube.bx) / 2, (spanTube.ay + spanTube.by) / 2, 6, 30);
            useField.getState().recordTape("object", 0.6, "quarks/span-pair");
            save();
            syncStanding();
          } else if (spanTube.active) {
            // let go early: the interval dissolves back into the seethe
            spraySparks((spanTube.ax + spanTube.bx) / 2, (spanTube.ay + spanTube.by) / 2, 3, 22);
            note(FLOOR_MIDI + 5, 160);
          }
          spanTube.active = false;
          return;
        }
        const a = toLocal(e.ax, e.ay);
        const b = toLocal(e.bx, e.by);
        spanTube.ax = a.x;
        spanTube.ay = a.y;
        spanTube.bx = b.x;
        spanTube.by = b.y;
        spanTube.elapsed = e.elapsed;
        if (e.phase === "enter") {
          spanTube.active = true;
          spanTube.spokenAt = 0;
          note(FLOOR_MIDI + 2, 140);
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        // tick: the tube grows more real for as long as the interval holds —
        // its word climbs with it, sustain as a continuous axis
        const now = performance.now();
        if (now - spanTube.spokenAt > 420) {
          spanTube.spokenAt = now;
          note(FLOOR_MIDI + 4 + Math.round(clamp01(spanTube.elapsed / DWELL_MS) * 10), 110);
        }
      },
      rhythm: (e) => {
        // a steady tapped pulse entrains the seethe: for a while the vacuum
        // boils on the hand's beat instead of only the shared clock
        if (e.stability <= 0.7 || e.bpm < 30 || e.bpm > 220) return;
        lastInteractionAt = performance.now();
        entrainBpm = e.bpm;
        entrainUntil = performance.now() + 9000;
        lastEntrainBeat = -1;
        note(FLOOR_MIDI + 7, 150);
        try { haptics.detent(); } catch { /* noop */ }
      },
    });

    // ————— the vessel: the device is the vacuum's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = the vacuum drifts downhill (hadrons and field lines
    // lean with real gravity); shake = a burst of virtual pairs; a knock on
    // the case rings the field's door; face-down is night.
    let lastKnockAt = 0;
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) { tiltLeanX = 0; tiltLeanY = 0; return; }
        tiltLeanX = clamp(gamma / 28, -1, 1);
        tiltLeanY = clamp((beta - 35) / 28, -1, 1); // rest angle ≈ a held phone
        const mag = Math.hypot(tiltLeanX, tiltLeanY);
        const now = performance.now();
        if (mag > 0.55 && now - lastTiltSoundAt > 1400) {
          lastTiltSoundAt = now;
          note(FLOOR_MIDI - 10 + Math.round(mag * 4), 240); // the drift's low word
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // a burst of virtual pairs: the seethe flares wherever the jolt lands
        const now = performance.now();
        for (let k = 0; k < 3; k++) {
          spraySparks(
            (0.2 + twinkleHash(now + k * 31.7) * 0.6) * width,
            (0.2 + twinkleHash(now * 1.3 + k * 17.9) * 0.6) * height,
            3 + Math.round(intensity * 5),
            30 + intensity * 40,
          );
        }
        for (const h of hadrons) h.shiver = Math.min(1, h.shiver + 0.3 + intensity * 0.4);
        note(RING_MIDI - 5, 90);
        noteLater(90, RING_MIDI, 70);
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        const now = performance.now();
        if (now - lastKnockAt < 350) return;
        lastKnockAt = now;
        lastInteractionAt = now;
        // a knock on the case is a knock on the room's door: one wavefront
        // of pair production crosses the field and everything bound answers
        note(RING_MIDI - 12 + Math.round(intensity * 7), 130);
        try { (intensity > 0.6 ? haptics.chop : haptics.tap)(); } catch { /* noop */ }
        if (!reduce) {
          rings.push({ x: width / 2, y: height / 2, r: minDim() * 0.14, born: now, life: 1100 });
          if (rings.length > 6) rings.splice(0, rings.length - 6);
          spraySparks(width / 2, height / 2, 5 + Math.round(intensity * 6), minDim() * 0.22);
        }
        tutti(intensity);
      },
      flip: ({ faceDown }) => {
        const want = faceDown ? 1 : 0;
        if (nightTarget === want) return;
        nightTarget = want;
        lastInteractionAt = performance.now();
        if (faceDown) {
          // night: the field goes on seething, unwatched
          note(FLOOR_MIDI - 12, 620);
          try { haptics.roll(); } catch { /* noop */ }
        } else {
          note(FLOOR_MIDI + 12, 240);
          noteLater(140, RING_MIDI - 12, 200);
          try { haptics.ripple(0.35); } catch { /* noop */ }
        }
        useField.getState().recordTape("object", faceDown ? 0.2 : 0.45, "quarks/night");
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
            const seeded = condense(x, y, 0);
            if (seeded) kbHadronId = seeded.id;
          }
          if (kbHadronId) {
            let seeded = hadrons.find((q) => q.id === kbHadronId);
            // the keyboard keeps the same choice: a key held past the baryon
            // depth pays for the third quark, exactly as a finger does
            if (
              seeded &&
              seeded.morph.kind === "pair" &&
              kindForDepth(clamp01((kbCharge - 0.35) / (1 - 0.35))) === "triplet"
            ) {
              const grown = forgeTriplet(seeded);
              if (grown) {
                kbHadronId = grown.id;
                seeded = grown;
              }
            }
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

    const drawHadron = (h: HadronEnt, breath: number, quick: number) => {
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
        stamp(CEREMONY_SPRITE, cx, cy, hr, 0.36 * h.charge * fade);
      }

      // an excited state wears its energy: the whole thing glows hotter and
      // the glow tightens as the moment to fall approaches
      if (h.resonance && feltAlpha > 0.02) {
        const left = clamp01((h.resonance.until - performance.now()) / 900);
        const cx = h.quarks.reduce((s, q) => s + q.sx, 0) / h.quarks.length;
        const cy = h.quarks.reduce((s, q) => s + q.sy, 0) / h.quarks.length;
        stamp(
          CORONA_SPRITE,
          cx, cy,
          md * 0.09 * (0.7 + left * 0.7) * (1 + h.resonance.strength * 0.5),
          0.4 * h.resonance.strength * (0.35 + left * 0.65) * feltAlpha,
        );
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
          // Two half-strings and a pale heart instead of a per-tube linear
          // gradient — the endpoints move every frame, so a gradient here
          // could never be cached, and this reads the same at a fraction of
          // the cost. The colour still runs from one quark's charge to the
          // other's, through white at the middle.
          ctx.lineWidth = Math.max(0.8, (3.4 - strain * 2.1) * grow);
          const endX = h.closed ? qb.sx : qa.sx + (qb.sx - qa.sx) * closeT;
          const endY = h.closed ? qb.sy : qa.sy + (qb.sy - qa.sy) * closeT;
          const heartX = h.closed ? cxq : (qa.sx + endX) / 2;
          const heartY = h.closed ? cyq : (qa.sy + endY) / 2;
          ctx.strokeStyle = colorAlpha(tintA, (0.3 + strain * 0.55) * feltAlpha * closeT);
          ctx.beginPath();
          ctx.moveTo(qa.sx, qa.sy);
          ctx.quadraticCurveTo(heartX, heartY, (qa.sx + endX) / 2, (qa.sy + endY) / 2);
          ctx.stroke();
          ctx.strokeStyle = colorAlpha(tintB, (0.3 + strain * 0.55) * feltAlpha * closeT);
          ctx.beginPath();
          ctx.moveTo((qa.sx + endX) / 2, (qa.sy + endY) / 2);
          ctx.quadraticCurveTo(heartX, heartY, endX, endY);
          ctx.stroke();
          ctx.strokeStyle = colorAlpha(
            mixHex("#F2EEE6", tintA, 0.5),
            (0.2 + strain * 0.7) * feltAlpha * closeT,
          );
          ctx.lineWidth = Math.max(0.6, (2 - strain * 1.2) * grow);
          ctx.beginPath();
          ctx.moveTo(qa.sx + (endX - qa.sx) * 0.32, qa.sy + (endY - qa.sy) * 0.32);
          ctx.quadraticCurveTo(heartX, heartY, qa.sx + (endX - qa.sx) * 0.68, qa.sy + (endY - qa.sy) * 0.68);
          ctx.stroke();
          // near the snap the string cries: a pale corona at midpoint
          if (strain > 0.55) {
            stamp(CORONA_SPRITE, mx, my, 16 * strain, 0.5 * (strain - 0.55) * feltAlpha);
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
        // the cores flicker at the band's own rate, not the sea's — this deep
        // on the axis the breath is quick (lib/scale, spectralRegisterFor)
        const cr = morph.core * md * grow * (reduce ? 1 : 1 + Math.sin(quick + morph.breathOffset + qi * 2.1) * 0.1);

        if (feltAlpha > 0.02) {
          const core = CORE_SPRITES.get(tint);
          if (core) stamp(core, q.sx, q.sy, cr * 3.2, feltAlpha * grow);
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

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      // unwatched, the vacuum seethes on without costing a frame
      if (sleeping || paused) { last = now; return; }
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      // the governor owns the drawing-buffer size too
      if (tier !== lastTier) { lastTier = tier; resize(); }
      const detail = detailForTier(tier);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;
      const seethe = 0.5 - 0.5 * Math.cos(season * Math.PI * 2);
      gatherFade = Math.max(0, gatherFade - dt * 2.2);

      // entrained seethe: while the hand's pulse holds, the vacuum boils on
      // the beat — each downbeat flares a brief burst of pair production
      beatEnv = 0;
      if (now < entrainUntil && entrainBpm > 0) {
        const beatLen = 60000 / entrainBpm;
        const beatIdx = Math.floor(now / beatLen);
        beatEnv = Math.max(0, 1 - ((now % beatLen) / beatLen) * 3);
        if (beatIdx !== lastEntrainBeat) {
          lastEntrainBeat = beatIdx;
          if (!reduce) {
            spraySparks(
              width * (0.3 + twinkleHash(beatIdx) * 0.4),
              height * (0.3 + twinkleHash(beatIdx + 3) * 0.4),
              2, 26,
            );
          }
          note(FLOOR_MIDI - 5, 50);
        }
      }

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      windX += (windTargetX - windX) * Math.min(1, dt * 2.2);
      windY += (windTargetY - windY) * Math.min(1, dt * 2.2);
      windTargetX *= Math.exp(-dt * 0.5);
      windTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      night += (nightTarget - night) * Math.min(1, dt * 1.6);

      for (let i = pendingNotes.length - 1; i >= 0; i--) {
        if (now >= pendingNotes[i].at) {
          note(pendingNotes[i].midi, pendingNotes[i].ms);
          pendingNotes.splice(i, 1);
        }
      }

      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;
      const quick = bt * Math.PI * 2 * REGISTER.lfoHz;
      const md = minDim();

      const stepDt = Math.min(0.05, dt) * timeScale;

      // ————— the deconfined state, while it holds —————
      //
      // Colour is not confined in here. The quarks move as one hot liquid,
      // pushed apart by their own pressure and pulled back by the vacuum's,
      // and they belong to nothing. It cools, always — and when it has, the
      // room's law returns and they must find partners again.
      if (plasma) {
        const age = (now - plasma.born) / plasma.life;
        plasma.heat = Math.max(0, plasma.heat - dt * 0.55);
        if (age >= 1) {
          reconfine();
        } else {
          const pressure = (1 - age) * (0.6 + plasma.heat * 0.5);
          for (let i = 0; i < plasma.quarks.length; i++) {
            const q = plasma.quarks[i];
            // the liquid's own seethe: deterministic in the quark's place
            if (!reduce) {
              q.vx += Math.sin(localT * 3.1 + i * 1.7) * 0.06 * pressure * stepDt;
              q.vy += Math.cos(localT * 2.7 + i * 2.3) * 0.06 * pressure * stepDt;
            }
            q.vx += (windX + tiltLeanX * 0.5) * 0.05 * stepDt * 60;
            q.vy += (windY + tiltLeanY * 0.5) * 0.05 * stepDt * 60;
            q.nx += q.vx * stepDt;
            q.ny += q.vy * stepDt;
            // the walls of the field hold the liquid in
            if (q.nx < 0.04) { q.nx = 0.04; q.vx = Math.abs(q.vx) * 0.7; }
            if (q.nx > 0.96) { q.nx = 0.96; q.vx = -Math.abs(q.vx) * 0.7; }
            if (q.ny < 0.06) { q.ny = 0.06; q.vy = Math.abs(q.vy) * 0.7; }
            if (q.ny > 0.95) { q.ny = 0.95; q.vy = -Math.abs(q.vy) * 0.7; }
            // as it cools every quark begins to feel the pull home again
            q.vx *= Math.exp(-stepDt * (1.2 + age * 3.4));
            q.vy *= Math.exp(-stepDt * (1.2 + age * 3.4));
          }
        }
      }

      // ————— physics: confinement, the anti-spring —————
      for (let hi = hadrons.length - 1; hi >= 0; hi--) {
        const h = hadrons[hi];
        if (h.retiringAt && now - h.retiringAt > RETIRE_MS) { hadrons.splice(hi, 1); dirty = true; continue; }
        if (!h.closed && !h.retiringAt) {
          h.growth = clamp01(h.growth + dt * 0.4);
          if (h.growth >= 1) closeHadron(h);
        }
        h.shiver = Math.max(0, h.shiver - dt * 1.1);
        if (hold.hadronId !== h.id && kbHadronId !== h.id) h.charge = Math.max(0, h.charge - dt * 1.6);
        // an excited state does not keep: when its moment is up it falls,
        // radiating the difference and coming back rotated in colour
        if (h.resonance && now >= h.resonance.until) {
          dropFromResonance(h);
        }

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
          q.vx += (windX + tiltLeanX * 0.5) * 0.05 * stepDt * 60;
          q.vy += (windY + tiltLeanY * 0.5) * 0.05 * stepDt * 60;
          q.nx = clamp(q.nx + q.vx * stepDt, 0.03, 0.97);
          q.ny = clamp(q.ny + q.vy * stepDt, 0.05, 0.96);
          const damp = Math.exp(-stepDt * 3.4);
          q.vx *= damp;
          q.vy *= damp;
        }
      }

      // ————— the physics BETWEEN hadrons: colour reconnection —————
      //
      // Each hadron is white, so at any distance the others are invisible to
      // it — which is why the strong force is short-ranged even though it
      // never falls off. Inside RECONNECT_REACH the colour fields overlap, a
      // gluon crosses, and what parts is two things neither of which is
      // either parent. This is the whole difference between a population and
      // a set of separately-drawn decals.
      if (!plasma) {
        const reach = RECONNECT_REACH;
        for (let i = 0; i < hadrons.length; i++) {
          const a = hadrons[i];
          if (a.retiringAt || !a.closed || now < a.reconnectAt) continue;
          let done = false;
          for (let j = i + 1; j < hadrons.length && !done; j++) {
            const b = hadrons[j];
            if (b.retiringAt || !b.closed || now < b.reconnectAt) continue;
            let ax = 0, ay = 0, bx = 0, by = 0;
            for (const q of a.quarks) { ax += q.nx; ay += q.ny; }
            for (const q of b.quarks) { bx += q.nx; by += q.ny; }
            ax /= a.quarks.length; ay /= a.quarks.length;
            bx /= b.quarks.length; by /= b.quarks.length;
            const d = Math.hypot(ax - bx, ay - by);
            if (d > reach) continue;
            // the fields overlapping is legible before anything happens: the
            // two lean toward each other, hard, as the tube forms between them
            const pull = (1 - d / reach) * 0.12;
            for (const q of a.quarks) { q.vx += ((bx - ax) / Math.max(1e-4, d)) * pull * stepDt; q.vy += ((by - ay) / Math.max(1e-4, d)) * pull * stepDt; }
            for (const q of b.quarks) { q.vx += ((ax - bx) / Math.max(1e-4, d)) * pull * stepDt; q.vy += ((ay - by) / Math.max(1e-4, d)) * pull * stepDt; }
            a.shiver = Math.min(1, a.shiver + dt * 0.9);
            b.shiver = Math.min(1, b.shiver + dt * 0.9);
            if (d < reach * 0.45) {
              reconnect(a, b);
              done = true;
            }
          }
          if (done) break;
        }
      }

      // ————— the vacuum's own life, with no hand on it —————
      //
      // A room that is still when untouched has failed. On its own seeded
      // clock the bare vacuum does what it does: a bound thing radiates and
      // drops, or a string pulls a pair out of nothing and snaps.
      if (!reduce && !plasma && now >= nextAmbientAt) {
        const k = twinkleHash(Math.round(now / 1000) * 7.7);
        nextAmbientAt = now + 9000 + k * 11000;
        const bound = hadrons.filter((h) => h.closed && !h.retiringAt && !h.resonance);
        if (k < 0.45 && bound.length > 0) {
          // one of them was already excited and nobody noticed: it drops
          const h = bound[Math.floor(k * 2.2 * bound.length) % bound.length];
          h.resonance = { until: now + 500, strength: 0.35 };
        } else if (hadrons.filter((h) => !h.retiringAt).length < MAX_HADRONS - 1) {
          vacuumEvent(
            width * (0.2 + twinkleHash(now * 0.013) * 0.6),
            height * (0.2 + twinkleHash(now * 0.017) * 0.6),
            0.3,
            0,
          );
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

      // the season's own colour: a still vacuum is nearly black, a boiling
      // one carries the faintest heat of all that pair production
      if (seethe > 0.01) {
        ctx.fillStyle = `rgba(120, 74, 40, ${0.02 + seethe * 0.05})`;
        ctx.fillRect(0, 0, width, height);
      }

      // field-line shimmer: short faint strokes leaning with a slow phase
      ctx.save();
      const shimmerAlpha = (1 - lens * 0.6) * 0.05 * (0.7 + seethe * 0.6);
      const shimmerCount = Math.max(8, Math.round(36 * detail.particles));
      for (let i = 0; i < shimmerCount; i++) {
        const fx = twinkleHash(i * 13.3) * width;
        const fy = twinkleHash(i * 29.7) * height;
        const baseA = twinkleHash(i * 7.9) * Math.PI * 2;
        const a = baseA + (reduce ? 0 : Math.sin(localT * 0.3 + i) * 0.6);
        const l = 5 + twinkleHash(i * 3.7) * 7;
        ctx.strokeStyle = colorAlpha(i % 5 === 0 ? "#E7AC52" : "#CFC2A6", shimmerAlpha * (0.5 + twinkleHash(i * 41.1) * 0.5));
        ctx.lineWidth = 0.6;
        const shiftX = (windX + tiltLeanX * 0.7) * 8;
        const shiftY = (windY + tiltLeanY * 0.7) * 8;
        ctx.beginPath();
        ctx.moveTo(fx - Math.cos(a) * l + shiftX, fy - Math.sin(a) * l + shiftY);
        ctx.lineTo(fx + Math.cos(a) * l + shiftX, fy + Math.sin(a) * l + shiftY);
        ctx.stroke();
      }
      ctx.restore();

      // ————— the seethe: scheduled virtual pairs on the shared clock —————
      if (reduce) {
        // seething stilled: a fixed constellation of faint pairs
        for (let slot = 0; slot < 8; slot++) {
          for (const p of vacuumPairsAt(slot, FIELD_SEED)) {
            drawVirtualPair(p.nx * width, p.ny * height, p.angle, p.sep * md, p.color, 0.55, 0.5);
          }
        }
      } else {
        // slots ride the shared clock; dilation stretches each pair's life,
        // so under a three-finger hold the seethe lingers long enough to SEE.
        // The lookback covers exactly the longest life still on screen — no
        // fixed window that either truncates a dilated pair or costs frames
        // scanning slots that died long ago.
        const btMs = bt * 1000;
        const nowSlot = Math.floor(btMs / VACUUM_SLOT_MS);
        const back = Math.min(64, Math.ceil(VACUUM_MAX_LIFE_MS / timeScale / VACUUM_SLOT_MS));
        // the season decides how much of the schedule the field shows: a
        // cold vacuum keeps most of its fluctuations to itself, a boiling one
        // shows them all. The schedule itself never changes — determinism.
        const shown = (0.45 + seethe * 0.75) * (1 + beatEnv * 0.6) * detail.particles;
        for (let slot = nowSlot - back; slot <= nowSlot; slot++) {
          const age = btMs - slot * VACUUM_SLOT_MS;
          if (age < 0) continue;
          const pairs = vacuumPairsAt(slot, FIELD_SEED);
          const take = Math.min(pairs.length, Math.round(pairs.length * shown + 0.35));
          for (let pi = 0; pi < take; pi++) {
            const p = pairs[pi];
            const life = p.lifeMs / timeScale;
            if (age > life) continue;
            const env = Math.sin((age / life) * Math.PI);
            drawVirtualPair(p.nx * width, p.ny * height, p.angle, p.sep * md, p.color, env, env);
          }
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

      // the plasma: quarks with no hadron, each still wearing its colour,
      // and the field between them a glow instead of a set of strings
      if (plasma) {
        const age = clamp01((now - plasma.born) / plasma.life);
        const env = Math.sin(Math.min(1, age * 1.08) * Math.PI);
        const feltA = (1 - lens) * (0.5 + env * 0.5);
        // the hot liquid itself: every quark reaches every other one, so the
        // links are drawn as a haze rather than as tubes with ends
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.lineWidth = 0.7;
        for (let i = 0; i < plasma.quarks.length; i++) {
          const qa = plasma.quarks[i];
          for (let j = i + 1; j < plasma.quarks.length; j++) {
            const qb = plasma.quarks[j];
            const d = Math.hypot(qa.nx - qb.nx, qa.ny - qb.ny);
            if (d > 0.34) continue;
            ctx.strokeStyle = colorAlpha(
              mixHex(COLOR_TINTS[qa.color], COLOR_TINTS[qb.color], 0.5),
              0.16 * (1 - d / 0.34) * feltA * (0.5 + plasma.heat * 0.5),
            );
            ctx.beginPath();
            ctx.moveTo(qa.nx * width, qa.ny * height);
            ctx.lineTo(qb.nx * width, qb.ny * height);
            ctx.stroke();
          }
        }
        ctx.restore();
        for (const q of plasma.quarks) {
          const cx = q.nx * width;
          const cy = q.ny * height;
          const tint = q.anti ? ANTI_TINTS[q.color] : COLOR_TINTS[q.color];
          const glow = CORE_SPRITES.get(tint);
          if (glow) stamp(glow, cx, cy, md * 0.045 * (0.7 + plasma.heat * 0.4), 0.5 * feltA);
          ctx.fillStyle = colorAlpha(tint, 0.9 * feltA);
          ctx.beginPath();
          ctx.arc(cx, cy, md * 0.008, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // hadrons
      for (const h of hadrons) drawHadron(h, breath, quick);

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

      // ——— the gathering under the finger ———
      // the seethe drawing inward, tightening until it condenses at the
      // dwell: the create verb, shown while it happens
      const gk = hold.gather > 0 ? hold.gather : gatherFade;
      if (gk > 0.01) {
        const ease = gk * gk;
        const ringR = 44 - 32 * ease;
        stamp(GATHER_SPRITE, hold.gx, hold.gy, 10 + 20 * ease, 0.3 + 0.5 * ease);
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.1 + 0.38 * ease);
        ctx.lineWidth = 0.8 + ease * 1.2;
        ctx.beginPath();
        ctx.arc(hold.gx, hold.gy, ringR, 0, Math.PI * 2);
        ctx.stroke();
        if (!reduce) {
          for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2 + localT * 1.3 + gk * 3;
            const r0 = ringR + 24 * (1 - ease);
            ctx.strokeStyle = colorAlpha(COLOR_TINTS[i % 3], 0.1 + 0.3 * ease);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hold.gx + Math.cos(ang) * r0, hold.gy + Math.sin(ang) * r0);
            ctx.lineTo(hold.gx + Math.cos(ang) * (ringR + 3), hold.gy + Math.sin(ang) * (ringR + 3));
            ctx.stroke();
          }
        }
      }

      // ——— the strung interval ———
      // two still fingers hold a flux tube open across the vacuum: it fills
      // in from both ends, sagging like the real strings, and whitens as the
      // dwell approaches — the pair it is about to become
      if (spanTube.active) {
        const fill = clamp01(spanTube.elapsed / DWELL_MS);
        const sx1 = spanTube.ax;
        const sy1 = spanTube.ay;
        const sx2 = spanTube.bx;
        const sy2 = spanTube.by;
        const len = Math.max(1, Math.hypot(sx2 - sx1, sy2 - sy1));
        const px = -(sy2 - sy1) / len;
        const py = (sx2 - sx1) / len;
        const sag = (1 - fill) * 16 + (reduce ? 2 : Math.sin(breath * 2) * 3);
        const hx = (sx1 + sx2) / 2 + px * sag;
        const hy = (sy1 + sy2) / 2 + py * sag;
        ctx.strokeStyle = colorAlpha(mixHex(COLOR_TINTS[0], "#F2EEE6", fill), 0.2 + fill * 0.55);
        ctx.lineWidth = 0.8 + fill * 2;
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.quadraticCurveTo(hx, hy, sx2, sy2);
        ctx.stroke();
        // the two ends already wear their charges: quark and antiquark
        ctx.fillStyle = colorAlpha(COLOR_TINTS[0], 0.3 + fill * 0.6);
        ctx.beginPath();
        ctx.arc(sx1, sy1, 2 + fill * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorAlpha(ANTI_TINTS[0], 0.3 + fill * 0.6);
        ctx.beginPath();
        ctx.arc(sx2, sy2, 2 + fill * 2, 0, Math.PI * 2);
        ctx.fill();
        if (fill >= 1) stamp(CORONA_SPRITE, (sx1 + sx2) / 2, (sy1 + sy2) / 2, 18, 0.4);
      }

      // glimmer (grammar §6.3) — after quiet the same gathering ripples once
      // where a press would land, never a word
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.25 + twinkleHash(slot) * 0.5) * width;
        const gy = (0.25 + twinkleHash(slot + 7) * 0.5) * height;
        const u = ((now % 9000) / 9000) * 3;
        if (u < 1) {
          const ease = reduce ? 0.5 : u;
          const alpha = Math.sin(ease * Math.PI);
          stamp(GATHER_SPRITE, gx, gy, 10 + 16 * ease, alpha * 0.5);
          ctx.strokeStyle = colorAlpha("#E7AC52", alpha * 0.3);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(gx, gy, 44 - 30 * ease, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // night — laid face-down, the field keeps seething under the dark
      if (night > 0.002) {
        ctx.fillStyle = `rgba(4, 5, 8, ${night * 0.72})`;
        ctx.fillRect(0, 0, width, height);
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
      offVis();
      offPause();
      detach();
      detachVessel();
      markLens(false);
      for (const id of letGoTimers) window.clearTimeout(id);
      // a stilling interrupted by leaving still ends stilled — the final
      // save below must not resurrect what the hand already let go of.
      if (clearing) { hadrons = []; clearing = false; }
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

      <LetGo label="still the vacuum" onLetGo={() => letGoRef.current()} visible={standing} />

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
