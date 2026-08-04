"use client";

/**
 * /cells — a living microscopy field at 10⁻⁵ m, the first new band of the
 * scale manifold (plan W6).
 *
 * A warm dark plasm under candle-toned light: a few drifting cells with
 * membranes, nuclei, and streaming organelles, over a haze of brownian
 * motes. Every cell is a pure function of its seed (src/lib/cytology.ts) —
 * dwell on open plasm to seed one (haptics.bloom() when its membrane
 * closes), hold an existing cell through the ceremony and it divides into
 * two daughters with deterministically perturbed seeds. Tap perturbs the
 * plasm, a drag stirs the cytoplasm, three fingers run an osmotic current
 * or dilate time, a scrub spins a centrifuge vortex, a twist rotates the
 * lens to a stained-slide diagram. Rhythm entrains the cilia; a flick sends
 * a mote comet. The whole field breathes on the site's shared 0.14 Hz swell.
 * The vessel is wired through: tilt leans the plasm downhill, shake storms
 * it, a knock on the case rings the coverslip, face-down is night, and a
 * blow across the stage gutters the candle. The plasm persists in
 * `objetdart:cells:v1`. Pinch is deliberately unbound here — ScaleTravel
 * owns it, so pinching travels the manifold.
 *
 * The dish keeps its own tide: real elapsed hours between visits are decoded
 * by `catchUpCulture` (src/lib/cytology.ts) into a next generation — some
 * cells divide into descendants, some settle and dim, the census eases
 * toward the culture's own resting point. Deterministic and bounded (same
 * law as `lib/world.ts`'s migrating naturals, applied to a genealogy instead
 * of a scattering of objects) — never a loop over elapsed time, never more
 * than MAX_CELLS residents.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, enableBreath } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import { onVessel, requestVessel } from "@/lib/vessel";
import { shouldInvite } from "@/lib/candle";
import { relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import { useField } from "@/store/field";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import {
  CELL_FAMILIES,
  MAX_CELLS,
  catchUpCulture,
  cellFromSeed,
  daughterSeeds,
  hashSeed,
  membraneRadius,
  settlePopulation,
  validateStoredCulture,
  type CellMorph,
  type LineageCell,
} from "@/lib/cytology";

const STORE_KEY = "objetdart:cells:v1";
const MOTE_COUNT = 110;
const MEMBRANE_STEPS = 44;
const RETIRE_MS = 1200;

type Cell = {
  id: string;
  seed: number;
  nx: number;
  ny: number;
  generation: number;
  morph: CellMorph;
  /** 0..1 membrane closure; grows from nothing when seeded. */
  growth: number;
  /** 0..1 — freshness; decays only across real elapsed hours away, never
   *  within a session. Dims the cytoplasm's glow so a long-settled culture
   *  reads as calm rather than cluttered. */
  vitality: number;
  /** The membrane has closed at least once (bloom fired). */
  closed: boolean;
  /** 0..1 mitosis charge — the waist pinches as the ceremony deepens. */
  charge: number;
  /** Deterministic division axis, radians. */
  axis: number;
  birth: number;
  /** performance.now() when retirement began; 0 = alive. */
  retiringAt: number;
  /** Impulse velocity from currents/comets, px/s. */
  pushX: number;
  pushY: number;
  /** Extra streaming speed from a stir, decays. */
  streamBoost: number;
  // screen-space cache for hit tests
  sx: number;
  sy: number;
  sr: number;
};

type Mote = { x: number; y: number; vx: number; vy: number };

type Wavefront = { x: number; y: number; born: number; maxR: number; strength: number };

type Stir = { x: number; y: number; dx: number; dy: number; strength: number; born: number };

type Vortex = { x: number; y: number; omega: number; born: number };

type Speck = { x: number; y: number; vx: number; vy: number; born: number; life: number; r: number; color: string };

type Stored = { cells: LineageCell[]; lastSeen: number };

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

function makeCell(
  seed: number,
  nx: number,
  ny: number,
  generation: number,
  growth: number,
  vitality = 1,
): Cell {
  const morph = cellFromSeed(seed);
  return {
    id: `ce-${seed.toString(36)}-${generation}`,
    seed,
    nx,
    ny,
    generation,
    morph,
    growth,
    vitality,
    closed: growth >= 1,
    charge: 0,
    axis: (hashSeed(seed, 71) / 4294967296) * Math.PI * 2,
    birth: performance.now(),
    retiringAt: 0,
    pushX: 0,
    pushY: 0,
    streamBoost: 0,
    sx: -1,
    sy: -1,
    sr: 0,
  };
}

// the first look is never an empty slide — three deterministic residents
// (seeds chosen so at least one lineage carries cilia to entrain)
const STARTERS: Array<[number, number]> = [
  [0.34, 0.42],
  [0.62, 0.62],
  [0.5, 0.28],
];

// Load, validate, and advance in one step: a bad or absent value degrades to
// null (a fresh dish); a present one is decoded and carried across whatever
// real time passed since it was last written — see catchUpCulture.
function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const nowMs = Date.now();
    return catchUpCulture(validateStoredCulture(parsed, nowMs), nowMs);
  } catch {
    return null;
  }
}

/** midi voice of a cell — low warm register, the lineage sets the degree */
function midiOf(morph: CellMorph): number {
  return 48 + morph.voice + morph.family * 2;
}

export default function CellsPlasm() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const letGoRef = useRef<() => void>(() => {});
  // whether anything still stands in the plasm — gates the quiet clear
  const [standing, setStanding] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state (all refs of the effect closure) —————
    let cells: Cell[] = [];
    let seedCount = 0;
    const motes: Mote[] = [];
    const wavefronts: Wavefront[] = [];
    const stirs: Stir[] = [];
    const vortices: Vortex[] = [];
    const specks: Speck[] = [];
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0; // dilatable clock
    let reduce = false;
    let streamX = 0;
    let streamY = 0;
    let streamTargetX = 0;
    let streamTargetY = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    // the vessel: gravity's lean on the plasm (-1..1), night, the blown gust
    let tiltLeanX = 0;
    let tiltLeanY = 0;
    let night = 0;
    let nightTarget = 0;
    let breathGust = 0;
    let tuttiPulse = 0;
    let lastTiltSoundAt = 0;
    let lastBreathAt = 0;
    let lastTuttiAt = 0;
    let entrainedBpm = 0;
    let entrainedUntil = 0;
    let lastBeatIndex = -1;
    let lastInteractionAt = performance.now();
    let lastSaveAt = 0;
    let dirty = false;
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbCellId: string | null = null;
    let lastStirFeltAt = 0;
    let stirVoice = 0;
    let lastStreamSoundAt = 0;
    let lastScrubAt = 0;
    let lastChargeNoteAt = 0;
    const hold: {
      cellId: string | null; onExisting: boolean; seeded: boolean; divided: boolean; tier: number;
    } = {
      cellId: null,
      onExisting: false,
      seeded: false,
      divided: false,
      tier: 0,
    };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; };
    // ————— performance contract —————
    const gov = createFrameGovernor();
    let sleeping = false;
    const offVis = onVisibility((hidden) => { sleeping = hidden; });

    // three-finger twist = season: the culture's own slow cycle
    let season = 0;
    let lastSeasonSoundAt = 0;

    // two-finger pan: the frame peeks, then eases home
    let panX = 0;
    let panY = 0;
    let panTargetX = 0;
    let panTargetY = 0;

    // cached radial-gradient sprite for the per-cell cytoplasm — baked once
    // per palette key, stamped with drawImage; never a per-cell gradient
    const spriteCache = new Map<string, HTMLCanvasElement>();
    const SPRITE_REF = 128;
    const radialSprite = (key: string, stops: Array<[number, string]>): HTMLCanvasElement | null => {
      let c = spriteCache.get(key);
      if (c) return c;
      c = document.createElement("canvas");
      c.width = SPRITE_REF;
      c.height = SPRITE_REF;
      const sctx = c.getContext("2d");
      if (!sctx) return null;
      const rad = SPRITE_REF / 2;
      const g = sctx.createRadialGradient(rad, rad, 0, rad, rad, rad);
      for (const [o, color] of stops) g.addColorStop(o, color);
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, SPRITE_REF, SPRITE_REF);
      spriteCache.set(key, c);
      return c;
    };
    mq.addEventListener?.("change", onMq);

    // ————— persistence —————
    const save = (force = false) => {
      const now = performance.now();
      if (!force && now - lastSaveAt < 800) { dirty = true; return; }
      lastSaveAt = now;
      dirty = false;
      try {
        const stored: Stored = {
          cells: cells
            .filter((c) => !c.retiringAt)
            .map((c) => ({
              id: c.id,
              seed: c.seed,
              nx: c.nx,
              ny: c.ny,
              generation: c.generation,
              vitality: c.vitality,
            })),
          lastSeen: Date.now(),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the plasm lives on in memory */ }
    };

    const stored = loadStored();
    if (stored) {
      // an empty cells list is a real state (the plasm was let rest) —
      // starters do not respawn over a deliberate clearing.
      cells = stored.cells
        .slice(-MAX_CELLS)
        .map((c) => makeCell(c.seed, clamp01(c.nx), clamp01(c.ny), Math.max(0, c.generation), 1, c.vitality));
      seedCount = cells.length;
    } else {
      cells = STARTERS.map(([nx, ny], i) =>
        makeCell(hashSeed(Math.round(nx * 997), Math.round(ny * 991), i), nx, ny, 0, 1),
      );
      seedCount = cells.length;
      save(true);
    }
    const syncStanding = () => setStanding(cells.some((c) => !c.retiringAt));
    syncStanding();

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };

    // The stage — background gradient, candle pool, lens iris — carries no
    // detail above a few pixels, so it is baked once at half resolution and
    // blitted back up. That pays for the full-rate 2× field in front of it,
    // and the bilinear upscale keeps the dark gradient from banding.
    const stage = document.createElement("canvas");
    const stageCtx = stage.getContext("2d");
    let stageLens = -1;
    let stageGlow = -1;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), { embedded: isEmbeddedFrame(), reducedMotion: reduce, maxDpr: 2 });
      width = Math.max(320, Math.floor(r.width));
      height = Math.max(480, Math.floor(r.height));
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const sr = Math.max(0.5, ratio * 0.5);
      stage.width = Math.max(1, Math.floor(width * sr));
      stage.height = Math.max(1, Math.floor(height * sr));
      stageCtx?.setTransform(sr, 0, 0, sr, 0, 0);
      stageLens = -1;
      if (motes.length === 0) {
        for (let i = 0; i < MOTE_COUNT; i++) {
          motes.push({
            x: twinkleHash(i + 17) * width,
            y: twinkleHash(i + 523) * height,
            vx: 0,
            vy: 0,
          });
        }
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    const cellAt = (x: number, y: number): Cell | null => {
      let best: Cell | null = null;
      let bestD = Infinity;
      for (const c of cells) {
        if (c.retiringAt) continue;
        const d = Math.hypot(x - c.sx, y - c.sy);
        if (d < Math.max(30, c.sr * 1.15) && d < bestD) { bestD = d; best = c; }
      }
      return best;
    };

    const burst = (x: number, y: number, colors: string[], n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + twinkleHash(i + n) * 0.8;
        const s = speed * (0.4 + twinkleHash(i * 3 + 1) * 0.9);
        specks.push({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          born: performance.now(),
          life: 800 + twinkleHash(i * 7 + 2) * 1200,
          r: 0.7 + twinkleHash(i * 11 + 3) * 1.6,
          color: colors[i % colors.length],
        });
      }
      if (specks.length > 200) specks.splice(0, specks.length - 200);
    };

    const retireOldest = () => {
      const alive = cells.filter((c) => !c.retiringAt);
      const { retired } = settlePopulation(alive, MAX_CELLS);
      for (const r of retired) {
        r.retiringAt = performance.now();
        note(midiOf(r.morph) - 12, 320); // a low word as the eldest lets go
      }
    };

    const seedCell = (x: number, y: number): Cell | null => {
      const nx = clamp01(x / width);
      const ny = clamp(y / height, 0.08, 0.95);
      const seed = hashSeed(Math.round(nx * 997), Math.round(ny * 991), seedCount);
      seedCount += 1;
      const c = makeCell(seed, nx, ny, 0, 0.02);
      cells.push(c);
      retireOldest();
      // a seed enters the plasm: two senses in the same frame
      try { audio().spark(); } catch { /* noop */ }
      note(midiOf(c.morph) - 12, 180);
      try { haptics.ripple(0.5); } catch { /* noop */ }
      burst(x, y, [CELL_FAMILIES[c.morph.family][4], "#DDD3BE"], 7, 22);
      useField.getState().recordTape("object", 0.5, "cells/seed");
      save();
      syncStanding();
      return c;
    };

    const growCell = (c: Cell, d: number) => {
      if (c.closed) return;
      c.growth = clamp01(c.growth + d);
      if (!c.closed && c.growth >= 1) {
        c.closed = true;
        // the membrane closes: sight (shimmer), sound (note), touch (bloom)
        try { haptics.bloom(); } catch { /* noop */ }
        note(midiOf(c.morph), 260);
        burst(c.sx, c.sy, [CELL_FAMILIES[c.morph.family][5], "#E7AC52"], 12, 34);
        dirty = true;
      }
    };

    const divideCell = (parent: Cell) => {
      if (!parent.closed || parent.retiringAt) return;
      const [sa, sb] = daughterSeeds(parent.seed, parent.generation);
      const off = (parent.morph.radius * 0.9 * Math.min(width, height)) / Math.max(1, width);
      const offY = (parent.morph.radius * 0.9 * Math.min(width, height)) / Math.max(1, height);
      const ax = Math.cos(parent.axis);
      const ay = Math.sin(parent.axis);
      const gen = parent.generation + 1;
      const a = makeCell(sa, clamp01(parent.nx + ax * off), clamp(parent.ny + ay * offY, 0.06, 0.96), gen, 0.72);
      const b = makeCell(sb, clamp01(parent.nx - ax * off), clamp(parent.ny - ay * offY, 0.06, 0.96), gen, 0.72);
      a.pushX = ax * 26; a.pushY = ay * 26;
      b.pushX = -ax * 26; b.pushY = -ay * 26;
      cells = cells.filter((c) => c !== parent);
      cells.push(a, b);
      retireOldest();
      // mitosis: one solemn act, three senses in one frame
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      burst(parent.sx, parent.sy, [
        CELL_FAMILIES[parent.morph.family][5],
        CELL_FAMILIES[parent.morph.family][3],
        "#F2EEE6",
      ], 18, 52);
      useField.getState().recordTape("sigil", 0.85, "cells/mitosis");
      save();
      syncStanding();
    };

    // the whole-plasm parting (LetGo, §8c): every cell dims and lets its
    // membrane soften while the motes disperse on one last slow wavefront —
    // an exhale, never a blink. Storage is written empty at once: a rested
    // plasm is a remembered state, and the starters do not return over it.
    const letGo = () => {
      const alive = cells.filter((c) => !c.retiringAt);
      if (alive.length === 0) return;
      const now = performance.now();
      alive.forEach((c, i) => {
        c.charge = 0;
        c.retiringAt = reduce ? now : now + (i % 5) * 150 + twinkleHash(c.seed % 997) * 180;
      });
      hold.cellId = null;
      hold.onExisting = false;
      kbCellId = null;
      kbCharge = 0;
      if (!reduce) {
        // motes disperse: one wide, gentle wavefront through everything
        wavefronts.push({
          x: width * 0.5,
          y: height * 0.5,
          born: now,
          maxR: Math.max(width, height) * 0.6,
          strength: 0.45,
        });
        stirTurbulence(0.4);
      }
      try { audio().thud(); } catch { /* noop */ }
      note(40, 520);
      try { haptics.roll(); } catch { /* noop */ }
      try {
        window.localStorage.setItem(
          STORE_KEY,
          JSON.stringify({ cells: [], lastSeen: Date.now() } satisfies Stored),
        );
      } catch { /* noop */ }
      useField.getState().recordTape("object", 0.3, "cells/letgo");
      setStanding(false);
    };
    letGoRef.current = letGo;

    const perturb = (x: number, y: number, intensity: number) => {
      const maxR = Math.min(width, height) * (0.14 + intensity * 0.3);
      wavefronts.push({ x, y, born: performance.now(), maxR, strength: 0.4 + intensity * 0.6 });
      if (wavefronts.length > 8) wavefronts.shift();
      stirTurbulence(intensity * 0.05);
      note(57 + Math.round(intensity * 7), 110);
      try { haptics.tap(); } catch { /* noop */ }
    };

    // the raised-lens marker ScaleTravel reads before a step-back nudge
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    // three-finger tap = tutti (grammar §5): one synchronized soft pulse —
    // every cell's cytoplasm quickens, its voice a whisper, one felt tick
    const tutti = () => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      tuttiPulse = 1;
      const alive = cells.filter((c) => !c.retiringAt && c.closed);
      alive.slice(0, 10).forEach((c, i) => {
        window.setTimeout(() => note(midiOf(c.morph), 70), i * 45);
      });
      for (const c of alive) c.streamBoost = Math.min(2.4, c.streamBoost + 0.5);
      try { haptics.tap(); } catch { /* noop */ }
    };

    // ————— breath: the candle under the stage can be blown across —————
    // Opt-in (grammar §1): armed only by the ceremony hold, and a refused
    // microphone simply costs the room a dimension.
    let breathStop: (() => void) | null = null;
    const onBreath = ({ strength }: { strength: number }) => {
      const now = performance.now();
      lastInteractionAt = now;
      breathGust = Math.min(1, breathGust + strength * 0.4);
      if (now - lastBreathAt < 260) return;
      lastBreathAt = now;
      // the pool of light gutters, the motes go with the draught
      stirTurbulence(Math.min(0.25, 0.08 + strength * 0.2));
      if (!reduce) {
        wavefronts.push({
          x: width * 0.5,
          y: height * 0.42,
          born: now,
          maxR: Math.max(width, height) * 0.7,
          strength: 0.3 + strength * 0.5,
        });
        if (wavefronts.length > 8) wavefronts.shift();
      }
      note(33 + Math.round(strength * 5), 420);
      try { haptics.chop(); } catch { /* noop */ }
    };
    const armBreath = async () => {
      if (breathStop) return;
      const stop = await enableBreath({ breath: onBreath });
      if (stop) breathStop = stop;
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
            note(48, 160);
          }
          return;
        }
        if (e.fingers === 3) { tutti(); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const { x, y } = toLocal(e.x, e.y);
        // rapid-tap ladder 1 / 3 / 5 / n — counts between tiers deepen intensity
        const tier = tapTrainTier(e.count);
        const base = tier === "n" ? 7 : tier;
        const deepen = Math.min(1, (e.count - base) * 0.5);
        const amp = e.intensity * (0.75 + deepen * 0.55);
        if (tier === 1) {
          perturb(x, y, amp);
          return;
        }
        if (tier === 3) {
          // mitosis: nearest closed cell divides; open plasm seeds one
          const hit = cellAt(x, y);
          const c = hit && hit.closed && !hit.retiringAt
            ? hit
            : cells.find((q) => !q.retiringAt && q.closed) ?? null;
          if (c) {
            c.streamBoost = Math.min(2.4, c.streamBoost + 0.25 + deepen * 0.55);
            divideCell(c);
          } else {
            seedCell(x, y);
          }
          return;
        }
        if (tier === 5) {
          // rupture: the nearest cell lets its membrane go
          const c = cellAt(x, y) ?? cells.find((q) => !q.retiringAt) ?? null;
          if (c && !c.retiringAt) {
            c.retiringAt = performance.now();
            note(midiOf(c.morph) - 12, 280 + deepen * 140);
            try { audio().thud(); } catch { /* noop */ }
            try { haptics.roll(); } catch { /* noop */ }
            burst(
              c.sx, c.sy,
              [CELL_FAMILIES[c.morph.family][3], "#DDD3BE"],
              10 + Math.round(deepen * 8),
              36 + deepen * 16,
            );
            save();
            syncStanding();
          } else {
            perturb(x, y, amp * 1.35);
          }
          return;
        }
        // n: rewrite — a wave of mitosis through the nearby culture
        const R = Math.min(width, height) * (0.28 + deepen * 0.18);
        const nearby = cells.filter(
          (c) => !c.retiringAt && c.closed && Math.hypot(c.sx - x, c.sy - y) <= R,
        );
        const budget = 2 + Math.round(deepen * 2);
        let divided = 0;
        for (const c of nearby) {
          if (divided >= budget) break;
          // re-find: prior divides may have removed parents from the live list
          if (!cells.includes(c)) continue;
          divideCell(c);
          divided += 1;
        }
        if (divided === 0) seedCell(x, y);
        else perturb(x, y, 0.7 + deepen * 0.45);
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: time dilates while held
          if (e.phase === "enter") { timeScaleTarget = 0.25; try { haptics.tap(); } catch { /* noop */ } note(36, 260); }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const c = cellAt(x, y);
          hold.cellId = c ? c.id : null;
          hold.onExisting = !!c;
          hold.seeded = false;
          hold.divided = false;
          hold.tier = 0;
          return;
        }
        if (e.phase === "release") {
          const c = cells.find((q) => q.id === hold.cellId);
          if (c) c.charge = 0;
          hold.cellId = null;
          hold.onExisting = false;
          hold.tier = 0;
          save();
          return;
        }
        // the candle's ladder, kept here because the flame is hidden on this
        // route: dwell invites the vessel, the ceremony invites breath
        if (e.tier >= 2 && hold.tier < 2) {
          hold.tier = 2;
          if (shouldInvite("vessel")) void requestVessel();
        }
        if (e.tier >= 3 && hold.tier < 3) {
          hold.tier = 3;
          if (shouldInvite("breath")) void armBreath();
        }
        // ticks (~80ms)
        if (hold.onExisting && hold.cellId) {
          const c = cells.find((q) => q.id === hold.cellId);
          if (!c || c.retiringAt) return;
          // the road to the ceremony: the waist pinches, ticks rise
          c.charge = clamp01((e.elapsed - 900) / 1600);
          const now = performance.now();
          if (c.charge > 0 && now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(midiOf(c.morph) + Math.round(c.charge * 9), 90);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3 && !hold.divided) {
            hold.divided = true;
            hold.cellId = null;
            divideCell(c);
          }
        } else if (hold.cellId) {
          // a cell this hand just seeded — keep holding and it keeps growing
          const c = cells.find((q) => q.id === hold.cellId);
          if (c && !c.closed) growCell(c, 0.0011 * 80 * (1 + e.intensity * 0.6));
          else if (c) {
            // duration is an axis: past the closing the hold keeps feeding —
            // the cytoplasm streams faster the longer the hand stays
            c.streamBoost = Math.min(2.4, c.streamBoost + 0.045 * (1 + e.intensity * 0.6));
            const now = performance.now();
            if (now - lastChargeNoteAt > 700) {
              lastChargeNoteAt = now;
              note(midiOf(c.morph) + 3 + Math.round(c.streamBoost), 90);
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
        } else if (e.tier >= 2 && !hold.seeded && !hold.onExisting && !hold.divided) {
          // dwell on open plasm: seed — long-press means grow, everywhere
          hold.seeded = true;
          const c = seedCell(x, y);
          if (c) hold.cellId = c.id;
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers are the law: an osmotic current — everything streams
          streamTargetX = clamp(e.vx * 1.4, -1, 1);
          streamTargetY = clamp(e.vy * 1.4, -1, 1);
          const now = performance.now();
          const mag = Math.hypot(streamTargetX, streamTargetY);
          if (mag > 0.35 && now - lastStreamSoundAt > 150) {
            lastStreamSoundAt = now;
            stirTurbulence(Math.min(0.04, mag * 0.04));
            note(38 + Math.round(mag * 5), 200);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        // one finger stirs the cytoplasm — a local current follows the hand
        stirs.push({ x, y, dx: e.vx, dy: e.vy, strength: clamp(Math.hypot(e.vx, e.vy), 0.1, 1.6), born: performance.now() });
        if (stirs.length > 24) stirs.shift();
        for (const c of cells) {
          const d = Math.hypot(x - c.sx, y - c.sy);
          if (d < c.sr * 2.2) {
            c.pushX += e.vx * 34;
            c.pushY += e.vy * 34;
            c.streamBoost = Math.min(2.4, c.streamBoost + 0.5);
          }
        }
        // a stir is one continuous act, so it answers continuously: the hand
        // is met every ~80ms and the plasm speaks on every other meeting
        const now = performance.now();
        if (now - lastStirFeltAt > 80) {
          lastStirFeltAt = now;
          const speed = Math.hypot(e.vx, e.vy);
          stirTurbulence(Math.min(0.03, speed * 0.02));
          try { haptics.ripple(0.12 + Math.min(0.38, speed * 0.24)); } catch { /* noop */ }
          stirVoice = (stirVoice + 1) % 2;
          if (stirVoice === 0) note(62 + Math.round(twinkleHash(Math.floor(now / 160)) * 5), 70);
        }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        // a flick sends a mote comet through the plasm
        const { x, y } = toLocal(e.x, e.y);
        const speed = clamp(e.speed, 0.6, 2.4) * 160;
        for (let i = 0; i < 14; i++) {
          const jitter = (twinkleHash(i * 13 + 5) - 0.5) * 0.5;
          specks.push({
            x, y,
            vx: Math.cos(e.angle + jitter) * speed * (0.6 + twinkleHash(i + 31) * 0.7),
            vy: Math.sin(e.angle + jitter) * speed * (0.6 + twinkleHash(i + 67) * 0.7),
            born: performance.now(),
            life: 700 + twinkleHash(i + 3) * 900,
            r: 0.8 + twinkleHash(i + 91) * 1.4,
            color: i % 3 === 0 ? "#E7AC52" : "#DDD3BE",
          });
        }
        for (const c of cells) {
          c.pushX += Math.cos(e.angle) * 20;
          c.pushY += Math.sin(e.angle) * 20;
        }
        stirTurbulence(Math.min(0.15, e.speed * 0.08));
        try { audio().spark(); } catch { /* noop */ }
        try { haptics.ripple(0.4); } catch { /* noop */ }
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three-finger twist = season: the culture's own slow cycle,
          // never the lens
          if (e.phase === "move") {
            season = (((season + e.angle / (Math.PI * 2)) % 1) + 1) % 1;
            const now = performance.now();
            if (now - lastSeasonSoundAt > 260) {
              lastSeasonSoundAt = now;
              note(36 + Math.round(season * 14), 180);
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
          return;
        }
        // two fingers rotate the lens: felt plasm ↔ stained slide
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            markLens(snapped === 1);
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(48, 160);
          }
          lensTarget = snapped;
        }
      },
      pan2: (e) => {
        // two-finger drag pans the frame: a peek, not a permanent move
        lastInteractionAt = performance.now();
        if (e.phase === "move") {
          panTargetX = clamp(panTargetX + e.dx * 0.6, -48, 48);
          panTargetY = clamp(panTargetY + e.dy * 0.6, -48, 48);
        } else if (e.phase === "end") {
          panTargetX = 0;
          panTargetY = 0;
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.cx, e.cy);
        vortices.push({ x, y, omega: clamp(e.angularVelocity, -6, 6), born: performance.now() });
        if (vortices.length > 4) vortices.shift();
        const now = performance.now();
        if (now - lastScrubAt > 260) {
          lastScrubAt = now;
          // the centrifuge answers: swirl seen, tone heard, ring felt
          stirTurbulence(Math.min(0.05, Math.abs(e.angularVelocity) * 0.02));
          note(64 + Math.round(Math.abs(e.winding)), 90);
          try { haptics.ripple(0.3); } catch { /* noop */ }
        }
      },
      rhythm: (e) => {
        lastInteractionAt = performance.now();
        if (e.bpm < 40 || e.bpm > 220) return;
        const wasSilent = performance.now() > entrainedUntil;
        entrainedBpm = e.bpm;
        entrainedUntil = performance.now() + 16000;
        lastBeatIndex = -1;
        if (wasSilent) {
          // the cilia lock to your pulse: a felt click as the beat takes
          try { haptics.tap(); } catch { /* noop */ }
          note(52, 140);
        }
      },
    });

    // ————— the vessel: the device is the plasm's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = the plasm settles downhill (cytoplasm streaming biases
    // toward real gravity); shake = a brownian storm. Cheap handlers: they
    // assign targets and fire debounced one-shots; the loop does the rest.
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) { tiltLeanX = 0; tiltLeanY = 0; return; }
        tiltLeanX = clamp(gamma / 28, -1, 1);
        tiltLeanY = clamp((beta - 35) / 28, -1, 1); // rest angle ≈ a held phone
        const mag = Math.hypot(tiltLeanX, tiltLeanY);
        const now = performance.now();
        if (mag > 0.55 && now - lastTiltSoundAt > 1400) {
          lastTiltSoundAt = now;
          note(38 + Math.round(mag * 4), 220); // the streaming's low wind-word
          try { haptics.tap(); } catch { /* noop */ }
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // brownian storm: every mote seethes harder for a breath
        stirTurbulence(Math.min(0.7, 0.3 + intensity * 0.5));
        for (const c of cells) c.streamBoost = Math.min(2.4, c.streamBoost + 0.7);
        wavefronts.push({
          x: width * 0.5,
          y: height * 0.5,
          born: performance.now(),
          maxR: Math.min(width, height) * 0.4,
          strength: 0.5 + intensity * 0.5,
        });
        try { audio().spark(); } catch { /* noop */ }
        note(43, 200);
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        // a rap on the case is a rap on the coverslip: the field rings
        lastInteractionAt = performance.now();
        stirTurbulence(Math.min(0.35, 0.1 + intensity * 0.3));
        if (!reduce) {
          wavefronts.push({
            x: width * 0.5,
            y: height * 0.5,
            born: performance.now(),
            maxR: Math.max(width, height) * 0.55,
            strength: 0.3 + intensity * 0.4,
          });
          if (wavefronts.length > 8) wavefronts.shift();
        }
        try { haptics.detent(); } catch { /* noop */ }
        tutti();
      },
      flip: ({ faceDown }) => {
        // face-down is night: the lamp under the stage goes down and the
        // plasm slows to almost still until the slide is turned back over
        nightTarget = faceDown ? 1 : 0;
        lastInteractionAt = performance.now();
        if (faceDown) {
          try { audio().thud(); } catch { /* noop */ }
          note(31, 620);
          try { haptics.roll(); } catch { /* noop */ }
        } else {
          try { audio().spark(); } catch { /* noop */ }
          note(48, 320);
          try { haptics.bloom(); } catch { /* noop */ }
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
        const c = cellAt(x, y);
        if (c) {
          // held Enter repeats — the keyboard's ceremony
          if (kbCellId !== c.id) { kbCellId = c.id; kbCharge = 0; }
          kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
          c.charge = kbCharge;
          const now = performance.now();
          if (now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(midiOf(c.morph) + Math.round(kbCharge * 9), 90);
          }
          if (kbCharge >= 1) {
            kbCharge = 0;
            kbCellId = null;
            divideCell(c);
          }
        } else if (!ev.repeat) {
          const seeded = seedCell(x, y);
          if (seeded) growCell(seeded, 0.05);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const c = cells.find((q) => q.id === kbCellId);
        if (c) c.charge = 0;
        kbCharge = 0;
        kbCellId = null;
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
    /** frac < 1 draws an open arc from the cell's axis — a membrane still closing. */
    const membranePath = (c: Cell, R: number, t: number, frac = 1) => {
      ctx.beginPath();
      const steps = Math.max(4, Math.round(MEMBRANE_STEPS * frac));
      for (let i = 0; i <= steps; i++) {
        const th = c.axis + (i / MEMBRANE_STEPS) * Math.PI * 2;
        let r = membraneRadius(c.morph, th, reduce ? 0 : t) * R;
        if (c.charge > 0) {
          // the waist pinches perpendicular to the division axis
          const co = Math.cos(th - c.axis);
          r *= 1 - 0.34 * c.charge * Math.exp(-7 * co * co);
        }
        const px = Math.cos(th) * r * c.morph.aspect;
        const py = Math.sin(th) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (frac >= 1) ctx.closePath();
    };

    const drawCell = (c: Cell, t: number, breath: number) => {
      const morph = c.morph;
      const fam = CELL_FAMILIES[morph.family];
      const minDim = Math.min(width, height);
      const grow = c.growth < 1 ? 0.25 + 0.75 * c.growth : 1;
      let fade = 1;
      let retireScale = 1;
      if (c.retiringAt) {
        const e = clamp01((performance.now() - c.retiringAt) / RETIRE_MS);
        fade = 1 - e;
        retireScale = 1 - e * 0.5;
      }
      const breathScale = reduce ? 1 : 1 + Math.sin(breath + morph.breathOffset) * 0.028;
      const R = minDim * morph.radius * grow * breathScale * retireScale;
      if (R < 1) return;
      const cx = c.nx * width;
      const cy = c.ny * height;
      c.sx = cx;
      c.sy = cy;
      c.sr = R;

      const feltAlpha = (1 - lens) * fade;
      const slideAlpha = lens * fade;
      const streamT = reduce ? 0 : t * morph.stream.rate * (1 + c.streamBoost);
      // a long-settled cell's glow dims (never its structure) — the legible
      // trace of real time passed, and why a dense, long-neglected dish
      // still reads as calm rather than lit up all at once
      const vitalityGlow = 0.4 + 0.6 * c.vitality;

      ctx.save();
      ctx.translate(cx, cy);

      // — felt pass: warm translucent body under candlelight —
      if (feltAlpha > 0.02) {
        // cytoplasm gathers as the membrane closes. The gradient is a cached
        // sprite (fixed ratios baked in, the dynamic factor folded into a
        // single globalAlpha scalar — see the comment above) clipped to the
        // membrane's own irregular path, never a per-cell gradient.
        const gatherA = c.growth < 1 ? 0.2 + 0.8 * c.growth * c.growth : 1;
        membranePath(c, R, t * 0.6, 1);
        ctx.save();
        ctx.clip();
        const cytoR = R * 1.05;
        const cytoSprite = radialSprite(`cell-cyto-${morph.family}`, [
          [0, colorAlpha(fam[3], 1)],
          [0.7, colorAlpha(fam[2], 2 / 3)],
          [1, colorAlpha(fam[1], 1 / 3)],
        ]);
        if (cytoSprite) {
          ctx.globalAlpha = morph.cytoAlpha * 1.5 * feltAlpha * gatherA * vitalityGlow;
          ctx.drawImage(cytoSprite, -cytoR, -cytoR, cytoR * 2, cytoR * 2);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        // membrane: a double line, the outer soft, the inner taut — while
        // growing it is an open arc, still finding its way around
        ctx.lineCap = "round";
        membranePath(c, R, t * 0.6, c.growth < 1 ? c.growth : 1);
        ctx.strokeStyle = colorAlpha(fam[morph.membraneTone], (c.growth < 1 ? 0.45 + 0.55 * c.growth : 0.85) * feltAlpha);
        ctx.lineWidth = Math.max(1, R * 0.035);
        ctx.stroke();
        membranePath(c, R * 0.93, t * 0.6, c.growth < 1 ? c.growth : 1);
        ctx.strokeStyle = colorAlpha(fam[Math.min(5, morph.membraneTone + 2)], 0.28 * feltAlpha);
        ctx.lineWidth = Math.max(0.6, R * 0.014);
        ctx.stroke();

        // cilia — short strokes beating on the shared or entrained clock
        if (morph.cilia.count > 0 && c.growth >= 1) {
          const entrained = performance.now() < entrainedUntil;
          const beatHz = entrained ? entrainedBpm / 60 : morph.cilia.rateHz;
          const beatPhase = entrained ? 0 : morph.cilia.phase;
          ctx.strokeStyle = colorAlpha(fam[Math.min(5, morph.membraneTone + 1)], 0.5 * feltAlpha);
          ctx.lineWidth = Math.max(0.5, R * 0.012);
          ctx.beginPath();
          for (let i = 0; i < morph.cilia.count; i++) {
            const th = (i / morph.cilia.count) * Math.PI * 2;
            const rr = membraneRadius(morph, th, reduce ? 0 : t * 0.6) * R;
            const bx = Math.cos(th) * rr * morph.aspect;
            const by = Math.sin(th) * rr;
            const sway = reduce ? 0 : Math.sin(t * Math.PI * 2 * beatHz + beatPhase + i * 0.55) * 0.5;
            const len = R * morph.cilia.length * (0.8 + (entrained && !reduce ? 0.5 : 0.2) * Math.abs(sway) * 2);
            const outA = th + sway * 0.6;
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(outA) * len, by + Math.sin(outA) * len);
          }
          ctx.stroke();
        }

        // nucleus — a darker heart, its nucleolus a still point
        const nR = R * morph.nucleus.r;
        const ndx = R * morph.nucleus.dx;
        const ndy = R * morph.nucleus.dy;
        ctx.fillStyle = colorAlpha(fam[0], 0.55 * feltAlpha);
        ctx.beginPath();
        ctx.ellipse(ndx, ndy, nR, nR * 0.88, morph.nucleus.dx, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorAlpha(fam[1], 0.8 * feltAlpha);
        ctx.beginPath();
        ctx.arc(ndx, ndy, nR * morph.nucleus.nucleolus, 0, Math.PI * 2);
        ctx.fill();

        // organelles, streaming on their orbits
        for (const o of morph.organelles) {
          const a = o.phase + streamT * o.speed * morph.stream.dir;
          const ox = Math.cos(a) * R * o.orbit * morph.aspect * 0.9;
          const oy = Math.sin(a) * R * o.orbit * 0.9;
          const os = R * o.size;
          if (o.kind === "vacuole") {
            ctx.strokeStyle = colorAlpha(fam[4], 0.4 * feltAlpha * vitalityGlow);
            ctx.lineWidth = Math.max(0.5, os * 0.16);
            ctx.beginPath();
            ctx.arc(ox, oy, os, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = colorAlpha(fam[5], 0.1 * feltAlpha * vitalityGlow);
            ctx.fill();
          } else if (o.kind === "mitochondrion") {
            ctx.save();
            ctx.translate(ox, oy);
            ctx.rotate(o.tilt + (reduce ? 0 : a * 0.4));
            ctx.fillStyle = colorAlpha(fam[3], 0.5 * feltAlpha * vitalityGlow);
            ctx.beginPath();
            ctx.ellipse(0, 0, os * o.ecc * 0.5, os * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else {
            ctx.fillStyle = colorAlpha(fam[4], 0.6 * feltAlpha * vitalityGlow);
            ctx.beginPath();
            ctx.arc(ox, oy, os, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // — lens pass: the stained slide, the same cell as diagram —
      if (slideAlpha > 0.02) {
        const stain = morph.family === 1 ? "#7A1F1F" : "#2C4A5C";
        membranePath(c, R, t * 0.6);
        ctx.strokeStyle = colorAlpha(stain, 0.75 * slideAlpha);
        ctx.lineWidth = Math.max(0.8, R * 0.02);
        ctx.stroke();
        // measure ring — physical annotation, never text
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = colorAlpha(stain, 0.3 * slideAlpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const nR = R * morph.nucleus.r;
        ctx.strokeStyle = colorAlpha("#7A1F1F", 0.8 * slideAlpha);
        ctx.lineWidth = Math.max(0.7, R * 0.016);
        ctx.beginPath();
        ctx.ellipse(R * morph.nucleus.dx, R * morph.nucleus.dy, nR, nR * 0.88, morph.nucleus.dx, 0, Math.PI * 2);
        ctx.stroke();
        for (const o of morph.organelles) {
          const a = o.phase + streamT * o.speed * morph.stream.dir;
          const ox = Math.cos(a) * R * o.orbit * morph.aspect * 0.9;
          const oy = Math.sin(a) * R * o.orbit * 0.9;
          const os = R * o.size;
          ctx.strokeStyle = colorAlpha(stain, 0.55 * slideAlpha);
          ctx.lineWidth = 0.8;
          if (o.kind === "mitochondrion") {
            ctx.save();
            ctx.translate(ox, oy);
            ctx.rotate(o.tilt + (reduce ? 0 : a * 0.4));
            ctx.beginPath();
            ctx.ellipse(0, 0, os * o.ecc * 0.5, os * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.beginPath();
            ctx.arc(ox, oy, os, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    };

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (sleeping) return; // no draw while the document is hidden
      const detail = detailForTier(tier);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      // two-finger pan: the frame eases toward the hand's nudge, then home
      panX += (panTargetX - panX) * Math.min(1, dt * 5);
      panY += (panTargetY - panY) * Math.min(1, dt * 5);
      canvas.style.transform = (Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05)
        ? `translate(${panX.toFixed(1)}px, ${panY.toFixed(1)}px)`
        : "";

      // night falls gently and lifts a little quicker — turning the slide
      // back over should feel like the lamp coming up, not a slow dawn
      night += (nightTarget - night) * Math.min(1, dt * (nightTarget > night ? 1.6 : 2.8));
      timeScale += (timeScaleTarget * (1 - night * 0.82) - timeScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      streamX += (streamTargetX - streamX) * Math.min(1, dt * 2.2);
      streamY += (streamTargetY - streamY) * Math.min(1, dt * 2.2);
      streamTargetX *= Math.exp(-dt * 0.5);
      streamTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      // the shared intensity axis — the same storm the haptics ride
      const turb = reduce ? 0 : relaxTurbulence(now);
      breathGust *= Math.exp(-dt * 1.6);
      tuttiPulse *= Math.exp(-dt * 2.4);
      // the vessel's lean: the plasm settles downhill with real gravity
      const gravX = streamX + tiltLeanX * 0.5;
      const gravY = streamY + tiltLeanY * 0.5;

      // shared breath: the audio swell clock when audible, RAF when not
      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;

      // cells: growth, drift, decay of pushes and charges, retirement
      for (let i = cells.length - 1; i >= 0; i--) {
        const c = cells[i];
        if (c.retiringAt && now - c.retiringAt > RETIRE_MS) { cells.splice(i, 1); dirty = true; continue; }
        if (!c.closed && !c.retiringAt) growCell(c, dt * 0.5); // a seeded cell finishes closing on its own
        c.streamBoost *= Math.exp(-dt * 1.4);
        if (!hold.cellId || hold.cellId !== c.id) {
          if (kbCellId !== c.id) c.charge = Math.max(0, c.charge - dt * 1.6);
        }
        if (!reduce) {
          // slow deterministic wander + currents
          const d = c.morph.drift;
          const wx = Math.sin(localT * d.rate + d.ax) * 0.004;
          const wy = Math.cos(localT * d.rate * 0.8 + d.ay) * 0.0035;
          let vx = wx + (c.pushX + gravX * 30) / Math.max(1, width);
          let vy = wy + (c.pushY + gravY * 30) / Math.max(1, height);
          for (const v of vortices) {
            const age = (now - v.born) / 3000;
            if (age >= 1) continue;
            const dx = c.sx - v.x;
            const dy = c.sy - v.y;
            const dist = Math.max(20, Math.hypot(dx, dy));
            const pull = (v.omega * (1 - age) * 16) / dist;
            vx += (-dy / dist) * pull / Math.max(1, width) * 60;
            vy += (dx / dist) * pull / Math.max(1, height) * 60;
          }
          c.nx = clamp(c.nx + vx * dt * timeScale, 0.04, 0.96);
          c.ny = clamp(c.ny + vy * dt * timeScale, 0.05, 0.96);
          c.pushX *= Math.exp(-dt * 2.4);
          c.pushY *= Math.exp(-dt * 2.4);
        }
      }

      // the stage: dark plasm, the candle pool beneath it, the objective's
      // iris. Repainted only when the lens turns or the pool's light moves;
      // otherwise it is one blit, and the whole frame budget goes to life.
      // season (three-finger twist) drifts the plasm's own slow warmth cycle
      const seasonWarm = Math.max(0, Math.sin(season * Math.PI * 2)) * 0.02;
      const glowPulse = ((reduce ? 0.1 : 0.09 + Math.sin(breath) * 0.03) + seasonWarm)
        * (1 - night * 0.85) * (1 - breathGust * 0.55);
      if (stageCtx && (Math.abs(lens - stageLens) > 0.003 || Math.abs(glowPulse - stageGlow) > 0.0015)) {
        stageLens = lens;
        stageGlow = glowPulse;
        const bg = stageCtx.createLinearGradient(0, 0, 0, height);
        bg.addColorStop(0, mixHex("#130e0b", "#26201a", lens));
        bg.addColorStop(0.55, mixHex("#181110", "#332a20", lens));
        bg.addColorStop(1, mixHex("#1c1512", "#2b2118", lens));
        stageCtx.fillStyle = bg;
        stageCtx.fillRect(0, 0, width, height);
        const glow = stageCtx.createRadialGradient(width * 0.5, height * 0.46, 10, width * 0.5, height * 0.46, Math.max(width, height) * 0.72);
        glow.addColorStop(0, `rgba(231, 172, 82, ${glowPulse + lens * 0.1})`);
        glow.addColorStop(0.55, `rgba(200, 115, 42, ${0.045 * (1 - night * 0.85)})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        stageCtx.fillStyle = glow;
        stageCtx.fillRect(0, 0, width, height);
        const iris = stageCtx.createRadialGradient(width * 0.5, height * 0.5, Math.min(width, height) * 0.52, width * 0.5, height * 0.5, Math.max(width, height) * 0.78);
        iris.addColorStop(0, "rgba(0,0,0,0)");
        iris.addColorStop(1, `rgba(5, 3, 2, ${0.5 + lens * 0.2})`);
        stageCtx.fillStyle = iris;
        stageCtx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(stage, 0, 0, width, height);

      // brownian motes — the fixed count scales with the frame governor's tier
      const activeMotes = Math.max(12, Math.round(motes.length * detail.particles));
      ctx.save();
      ctx.globalCompositeOperation = lens > 0.5 ? "source-over" : "screen";
      for (let i = 0; i < activeMotes; i++) {
        const m = motes[i];
        if (!reduce) {
          // brownian jitter — deterministic per mote, alive at rest
          const seethe = 6 * (1 + turb * 4); // the storm seethes, then settles
          const jx = Math.sin(localT * (1.1 + twinkleHash(i + 41) * 1.7) + twinkleHash(i + 7) * 6.28) * seethe;
          const jy = Math.cos(localT * (0.9 + twinkleHash(i + 83) * 1.9) + twinkleHash(i + 5) * 6.28) * seethe;
          m.vx += (jx - m.vx) * dt * (2 + turb * 6) + gravX * 130 * dt;
          m.vy += (jy - m.vy) * dt * (2 + turb * 6) + gravY * 130 * dt;
          for (const s of stirs) {
            const age = (now - s.born) / 1800;
            if (age >= 1) continue;
            const d2 = (m.x - s.x) * (m.x - s.x) + (m.y - s.y) * (m.y - s.y);
            const reach = 130 * 130;
            if (d2 < reach) {
              const k = (1 - d2 / reach) * (1 - age) * s.strength * 90;
              m.vx += s.dx * k * dt * 10;
              m.vy += s.dy * k * dt * 10;
            }
          }
          for (const v of vortices) {
            const age = (now - v.born) / 3000;
            if (age >= 1) continue;
            const dx = m.x - v.x;
            const dy = m.y - v.y;
            const dist = Math.max(14, Math.hypot(dx, dy));
            const pull = (v.omega * (1 - age) * 900) / (dist * dist) * 60;
            m.vx += (-dy / dist) * pull * dt * 10;
            m.vy += (dx / dist) * pull * dt * 10;
            // the centrifuge also draws inward, slowly
            m.vx -= (dx / dist) * Math.abs(pull) * dt * 2;
            m.vy -= (dy / dist) * Math.abs(pull) * dt * 2;
          }
          for (const w of wavefronts) {
            const age = (now - w.born) / 900;
            if (age >= 1) continue;
            const fr = w.maxR * age;
            const d = Math.hypot(m.x - w.x, m.y - w.y);
            if (Math.abs(d - fr) < 16 && d > 1) {
              const k = w.strength * (1 - age) * 160;
              m.vx += ((m.x - w.x) / d) * k * dt * 10;
              m.vy += ((m.y - w.y) / d) * k * dt * 10;
            }
          }
          m.x += m.vx * dt * timeScale;
          m.y += m.vy * dt * timeScale;
          m.vx *= Math.exp(-dt * 1.1);
          m.vy *= Math.exp(-dt * 1.1);
          if (m.x < -8) m.x += width + 16;
          if (m.x > width + 8) m.x -= width + 16;
          if (m.y < -8) m.y += height + 16;
          if (m.y > height + 8) m.y -= height + 16;
        }
        const tw = reduce ? 0.16 : 0.1 + Math.sin(localT * 0.7 + i) * 0.07;
        const moteColor = lens > 0.5 ? "#4a3a2c" : i % 5 === 0 ? "#E7AC52" : "#DDD3BE";
        ctx.fillStyle = colorAlpha(moteColor, Math.max(0.03, tw));
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.5 + twinkleHash(i + 311) * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // stirs decay out of the record
      for (let i = stirs.length - 1; i >= 0; i--) if (now - stirs[i].born > 1800) stirs.splice(i, 1);
      for (let i = vortices.length - 1; i >= 0; i--) if (now - vortices[i].born > 3000) vortices.splice(i, 1);

      // cells, painter's order by size (small behind, large in front)
      const sorted = [...cells].sort((a, b) => a.morph.radius - b.morph.radius);
      for (const c of sorted) drawCell(c, localT, breath);

      // tutti: one soft ring around everything alive, fading together
      if (tuttiPulse > 0.03) {
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.22 * tuttiPulse);
        ctx.lineWidth = 1;
        for (const c of cells) {
          if (c.retiringAt || c.sr <= 0) continue;
          ctx.beginPath();
          ctx.arc(c.sx, c.sy, c.sr * (1.1 + (1 - tuttiPulse) * 0.25), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // wavefronts — the perturbation made visible
      for (let i = wavefronts.length - 1; i >= 0; i--) {
        const w = wavefronts[i];
        const age = (now - w.born) / 900;
        if (age >= 1) { wavefronts.splice(i, 1); continue; }
        ctx.strokeStyle = colorAlpha("#E7AC52", (1 - age) * 0.28 * w.strength);
        ctx.lineWidth = 1.4 * (1 - age) + 0.4;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.maxR * age, 0, Math.PI * 2);
        ctx.stroke();
      }

      // entrained cilia: the plasm sounds its shared beat, softly, briefly
      if (now < entrainedUntil && entrainedBpm > 0) {
        const beat = Math.floor(((now - (entrainedUntil - 16000)) / 60000) * entrainedBpm);
        if (beat !== lastBeatIndex) {
          lastBeatIndex = beat;
          if (beat < 8) note(52 + (beat % 2) * 7, 60);
        }
      }

      // specks (bursts and comets)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        const age = (now - s.born) / s.life;
        if (age >= 1) { specks.splice(i, 1); continue; }
        if (!reduce) {
          s.x += s.vx * dt * timeScale;
          s.y += s.vy * dt * timeScale;
          s.vx *= 1 - dt * 1.2;
          s.vy *= 1 - dt * 1.2;
        }
        ctx.fillStyle = colorAlpha(s.color, (1 - age) * 0.6);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (1 + age * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // night (the slide turned face-down) settles over everything alive
      if (night > 0.01) {
        ctx.fillStyle = `rgba(5, 3, 2, ${night * 0.62})`;
        ctx.fillRect(0, 0, width, height);
      }

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
      detachVessel();
      offVis();
      breathStop?.();
      markLens(false);
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
    <div className="cells-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="cells-field"
        role="application"
        tabIndex={0}
        aria-label="a plasm kept warm under the lens — rest a finger and a cell gathers from nothing; hold one through the long moment and it becomes two; arrows walk, enter seeds and, held, divides"
      >
        <canvas ref={canvasRef} className="cells-canvas" aria-hidden="true" />
      </div>

      <LetGo label="let the plasm rest" onLetGo={() => letGoRef.current()} visible={standing} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cells-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #130e0b;
          overflow: hidden;
        }

        .cells-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .cells-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.cells-page) {
          overflow: hidden;
          background: #130e0b;
        }

        body:has(.cells-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.cells-page) .oda-field-watch,
        body:has(.cells-page) .oda-candle-mark,
        body:has(.cells-page) .oda-tape-shell,
        body:has(.cells-page) .oda-sound-toggle {
          display: none !important;
        }

        .cells-canvas {
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
