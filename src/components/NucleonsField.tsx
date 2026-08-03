"use client";

/**
 * /nucleons — the nuclear band at 10⁻¹⁵ m, between the quarks below and the
 * atoms above.
 *
 * One level up from confinement, matter has parts again. A few nuclei float
 * as charged liquid drops: gold protons and parchment neutrons packed in a
 * breathing skin, jostling with their own thermal motion, leaning with the
 * vessel's gravity. Every drop is a pure function of (Z, N) through the
 * semi-empirical mass formula (src/lib/nucleons.ts) — its size, its hum, its
 * strain, and above all what it WANTS to become.
 *
 * The room is alive at rest because nuclei off the valley of stability decay
 * on their own clock, fast when they are far off it and slowly when they are
 * near: a neutron turns into a proton, throws an electron out into a sea-blue
 * halo, and the drop becomes a different element without anyone touching it.
 *
 * The two hands are different, and the difference is the Coulomb barrier.
 * A NEUTRON walks in free: drift one into a drop and it is absorbed, always.
 * A PROTON has a wall to climb that grows with every proton already home, so
 * it must be thrown hard or it curves away and refuses. That is the whole
 * reason the universe builds heavy elements out of neutrons.
 *
 * So: hold on open field to condense a nucleon (a neutron at the long-press
 * tier; hold on into the ceremony and the vacuum pays for a proton instead).
 * Flick it into a drop. Tap a drop to strike it — the giant resonance, the
 * whole nucleus ringing. Hold a drop to the ceremony and it does the thing it
 * already wanted: beta, alpha, or fission. Scrub a drop to spin it up until
 * angular momentum stretches it past holding and it splits — and the prompt
 * neutrons that fly out are captured by its neighbors, which is a chain
 * reaction, felt. Three fingers run a NEUTRON FLUX across the field, and a
 * drop standing in that wind climbs the chart of the nuclides one capture and
 * one beta at a time: the r-process, and the only way anything past iron has
 * ever been made — here or anywhere. Three fingers held dilate time; three
 * fingers tapped ask every drop to hum at once. A twist rotates the lens to
 * the chart of the nuclides itself — N against Z, the valley drawn, every
 * drop you have made plotted with its symbol and mass number, the one
 * lettered surface in the room and the only place the periodic table is
 * spelled out.
 *
 * The field persists in `objetdart:nucleons:v1`. Pinch is deliberately
 * unbound — ScaleTravel owns it (atoms above, quarks below).
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { THRESHOLDS, attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import {
  HAND_MAX_A,
  MAX_A,
  MAX_NUCLEI,
  NUCLEON_TINTS,
  accretedA,
  alphaQ,
  betaMinusQ,
  betaPlusQ,
  bindingPerNucleon,
  canFission,
  coulombBarrier,
  decayMode,
  fissility,
  fissionMagnitude,
  fissionSplit,
  hashSeed,
  massNumber,
  mostStableZ,
  nuclideFromSeed,
  packOffsets,
  settlePopulation,
  symbolFor,
  valleyNuclide,
  type DecayMode,
} from "@/lib/nucleons";

const STORE_KEY = "objetdart:nucleons:v1";
const RETIRE_MS = 1500;
const MOTE_COUNT = 70;
/** Free nucleons in flight at once; the flux trims the oldest. */
const MAX_FREE = 26;
/** The hold tiers, read from the grammar — never redefined here. */
const TOUCH_MS = THRESHOLDS.tapMaxMs;
const DWELL_MS = THRESHOLDS.dwellMs;
const CEREMONY_MS = THRESHOLDS.ceremonyMs;
/** Screen speed (px/s) that counts as one unit of collision energy. */
const ENERGY_SPEED = 260;
/** MeV delivered by a projectile arriving at ENERGY_SPEED. */
const ENERGY_MEV = 14;

type Nucleus = {
  id: string;
  z: number;
  n: number;
  seed: number;
  nx: number;
  ny: number;
  /** Kinetic velocity, px/s. */
  vx: number;
  vy: number;
  /** 0..1 — the drop gathering when condensed or born from a split. */
  growth: number;
  closed: boolean;
  /** 0..1 giant resonance, decays: the whole drop ringing after a strike. */
  ring: number;
  /** 0..1 capture swell, decays — the drop visibly taking a nucleon in. */
  swell: number;
  /** The walk this drop has taken across the chart: n, z, n, z, … */
  walk: number[];
  /** Cached packing (only ever changes when A does). */
  pack: Array<{ x: number; y: number }> | null;
  packA: number;
  packMask: boolean[] | null;
  /** Angular momentum from stirring — deforms the drop toward a spindle. */
  spin: number;
  spinPhase: number;
  /** 0..1 ceremony charge while a hand asks it to decay. */
  charge: number;
  /** Electrons thrown by past betas, kept in a halo. */
  halo: number;
  /** When this drop next does what it wants, ms on the local clock. */
  decayAt: number;
  /** 0..1 necking: the drop pulling itself into two before a split. */
  neck: number;
  pushX: number;
  pushY: number;
  birth: number;
  retiringAt: number;
  sx: number;
  sy: number;
  sr: number;
};

type Free = {
  id: number;
  /** 0 = neutron (walks in), 1 = proton (must climb the barrier). */
  kind: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  /** Recent positions for the trail. */
  trail: number[];
};

type Speck = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  r: number;
  color: string;
  streak?: boolean;
};

type Blast = { x: number; y: number; born: number; maxR: number; mag: number };
type PendingNote = { at: number; midi: number; ms: number };

type Stored = {
  nuclei: Array<{ z: number; n: number; nx: number; ny: number; seed: number; halo: number }>;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

function colorAlpha(hex: string, alpha: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Which packing sites hold protons: a Bresenham spread of Z over A, so the
 * charge is distributed through the drop instead of clumped at one edge —
 * and identical for the same (Z, A), so a drop always looks like itself.
 */
function protonMask(z: number, a: number): boolean[] {
  const out: boolean[] = [];
  let acc = 0;
  for (let i = 0; i < a; i++) {
    acc += z;
    if (acc >= a) {
      acc -= a;
      out.push(true);
    } else {
      out.push(false);
    }
  }
  return out;
}

/** The drop's voice: heavy nuclei hum low, light ones ring high. */
function midiOf(z: number, n: number): number {
  const a = Math.max(1, massNumber(z, n));
  return Math.round(84 - (24 * Math.log(a)) / Math.log(MAX_A));
}

/**
 * How long this nuclide waits before doing what it wants, ms. Far off the
 * valley is impatient, near it is nearly still — the same monotone the real
 * half-lives follow, compressed into a span a hand can sit through.
 */
function decayDelay(z: number, n: number, seed: number): number {
  const mode = decayMode(z, n);
  if (mode === "stable") return Infinity;
  const q =
    mode === "beta-minus"
      ? betaMinusQ(z, n)
      : mode === "beta-plus"
        ? betaPlusQ(z, n)
        : mode === "alpha"
          ? alphaQ(z, n)
          : 40;
  const eager = clamp01(q / 8);
  const base = 9000 - eager * 7200;
  return base * (0.7 + hash01(seed + z * 31 + n) * 0.6);
}

function makeNucleus(z: number, n: number, nx: number, ny: number, growth: number, seed: number, halo = 0): Nucleus {
  const now = performance.now();
  return {
    id: `nu-${seed.toString(36)}-${z}-${n}`,
    z,
    n,
    seed,
    nx,
    ny,
    vx: 0,
    vy: 0,
    growth,
    closed: growth >= 1,
    ring: 0,
    swell: 0,
    walk: [n, z],
    pack: null,
    packA: -1,
    packMask: null,
    spin: 0,
    spinPhase: hash01(seed) * Math.PI * 2,
    charge: 0,
    halo,
    decayAt: now + decayDelay(z, n, seed),
    neck: 0,
    pushX: 0,
    pushY: 0,
    birth: now,
    retiringAt: 0,
    sx: -1,
    sy: -1,
    sr: 0,
  };
}

// the first look is never an empty field — three light drops on the valley
const STARTERS: Array<[number, number]> = [
  [0.3, 0.38],
  [0.68, 0.33],
  [0.5, 0.68],
];

function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || !Array.isArray(parsed.nuclei)) return null;
    return {
      nuclei: parsed.nuclei.filter(
        (d) =>
          d &&
          typeof d.z === "number" &&
          typeof d.n === "number" &&
          d.z >= 1 &&
          d.z + d.n <= MAX_A &&
          typeof d.nx === "number" &&
          typeof d.ny === "number",
      ),
    };
  } catch {
    return null;
  }
}

export default function NucleonsField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasNuclei, setHasNuclei] = useState(false);
  const stillRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let nuclei: Nucleus[] = [];
    const frees: Free[] = [];
    const specks: Speck[] = [];
    const blasts: Blast[] = [];
    const pendingNotes: PendingNote[] = [];
    const motes: Array<{ x: number; y: number; p: number }> = [];
    let freeId = 0;
    let seedCount = 0;
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0;
    let reduce = false;
    let windX = 0;
    let windY = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    let fluxDebt = 0;
    /** 0..1 — how hard the neutron wind is blowing, and for how long it
     *  keeps blowing after the hand lets go. A flux is weather, not a shove. */
    let flux = 0;
    let lastFluxSoundAt = 0;
    /** The room's slow cycle, 0..1: the vacuum cold ↔ the furnace. */
    let season = 0.12;
    let seasonSpokenAt = 0;
    let ambientDebt = 0;
    /** face-down: the field goes on making elements in the dark. */
    let night = 0;
    let nightTarget = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let tiltLeanX = 0;
    let tiltLeanY = 0;
    let tuttiPulse = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let lastSaveAt = 0;
    let lastWindSoundAt = 0;
    let lastSpinSoundAt = 0;
    let lastChargeNoteAt = 0;
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbId: string | null = null;
    let lastAccreteAt = 0;
    let lastGatherNoteAt = 0;
    const hold: {
      id: string | null;
      onExisting: boolean;
      seeded: boolean;
      freeId: number | null;
      /** the loose nucleon was already here when the finger landed */
      carried: boolean;
      asked: boolean;
      /** the drop this hold bound out of the vacuum, still gathering */
      nucId: string | null;
      /** 0..1 — what has visibly gathered under the finger so far */
      gather: number;
      gx: number;
      gy: number;
      atCeiling: boolean;
    } = {
      id: null,
      onExisting: false,
      seeded: false,
      freeId: null,
      carried: false,
      asked: false,
      nucId: null,
      gather: 0,
      gx: 0,
      gy: 0,
      atCeiling: false,
    };
    /** The gathering the room keeps drawing for a breath after the hand goes. */
    let gatherFade = 0;

    // ————— the room runtime: govern frames, sleep when unwatched —————
    const gov = createFrameGovernor();
    let sleeping = false;
    let paused = false;
    let lastFrameAt = 0;
    const offVis = onVisibility((hidden) => {
      sleeping = hidden;
    });
    const offPause = onGalleryPause((p) => {
      paused = p;
    });

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => {
      reduce = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => {
      try {
        audio().playNote(midi, ms);
      } catch {
        /* noop */
      }
    };
    const noteLater = (delayMs: number, midi: number, ms = 120) => {
      pendingNotes.push({ at: performance.now() + delayMs, midi, ms });
    };

    // ————— persistence —————
    const save = (force = false) => {
      const now = performance.now();
      setHasNuclei(nuclei.some((d) => !d.retiringAt));
      if (!force && now - lastSaveAt < 800) return;
      lastSaveAt = now;
      try {
        const stored: Stored = {
          nuclei: nuclei
            .filter((d) => !d.retiringAt)
            .map((d) => ({ z: d.z, n: d.n, nx: d.nx, ny: d.ny, seed: d.seed, halo: d.halo })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch {
        /* quota; the field keeps its own counsel */
      }
    };

    const stored = loadStored();
    if (stored && stored.nuclei.length > 0) {
      nuclei = stored.nuclei
        .slice(-MAX_NUCLEI)
        .map((d) =>
          makeNucleus(d.z, d.n, clamp01(d.nx), clamp(d.ny, 0.1, 0.9), 1, d.seed >>> 0, Math.max(0, d.halo | 0)),
        );
      seedCount = nuclei.length;
    } else {
      nuclei = STARTERS.map(([nx, ny], i) => {
        const seed = hashSeed(Math.round(nx * 811), Math.round(ny * 809), i);
        const nuc = nuclideFromSeed(seed);
        return makeNucleus(nuc.z, nuc.n, nx, ny, 1, seed);
      });
      seedCount = nuclei.length;
      save(true);
    }
    setHasNuclei(nuclei.length > 0);

    // ————— sprites: every glow this room draws is baked once —————
    // A radial gradient built inside a per-element loop is the single most
    // expensive thing a 2D canvas can do; these are drawn with drawImage
    // instead, at whatever radius the moment asks for.
    const sprite = (stops: Array<[number, string]>, size = 96): HTMLCanvasElement => {
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
    const glowSprite = (hex: string) =>
      sprite([
        [0, colorAlpha(hex, 0.85)],
        [0.35, colorAlpha(hex, 0.34)],
        [1, "rgba(0,0,0,0)"],
      ], 64);
    const SPRITES = {
      neutron: glowSprite(NUCLEON_TINTS.neutron[3]),
      proton: glowSprite(NUCLEON_TINTS.proton[3]),
      /** the drop's skin, calm and strained */
      rim: sprite([
        [0.28, colorAlpha("#2A1E12", 0.5)],
        [0.62, colorAlpha("#1A1309", 0.28)],
        [1, "rgba(0,0,0,0)"],
      ]),
      rimStrained: sprite([
        [0.28, colorAlpha(NUCLEON_TINTS.strain[1], 0.5)],
        [0.62, colorAlpha(NUCLEON_TINTS.strain[0], 0.28)],
        [1, "rgba(0,0,0,0)"],
      ]),
      halo: sprite([
        [0, "rgba(231, 172, 82, 0.5)"],
        [1, "rgba(0,0,0,0)"],
      ]),
      gather: sprite([
        [0, "rgba(242, 238, 230, 0.42)"],
        [0.45, "rgba(221, 211, 190, 0.14)"],
        [1, "rgba(0,0,0,0)"],
      ]),
    };
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
      if (motes.length === 0) {
        for (let i = 0; i < MOTE_COUNT; i++) {
          motes.push({ x: hash01(i + 17) * width, y: hash01(i + 733) * height, p: hash01(i * 3 + 5) * 7 });
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

    const radiusOf = (z: number, n: number) =>
      Math.min(width, height) * 0.018 * Math.pow(Math.max(1, massNumber(z, n)), 1 / 3);

    const nucleusAt = (x: number, y: number): Nucleus | null => {
      let best: Nucleus | null = null;
      let bestD = Infinity;
      for (const d of nuclei) {
        if (d.retiringAt) continue;
        const dist = Math.hypot(x - d.sx, y - d.sy);
        if (dist < Math.max(40, d.sr * 1.5) && dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    };

    const freeAt = (x: number, y: number): Free | null => {
      let best: Free | null = null;
      let bestD = Infinity;
      for (const f of frees) {
        const dist = Math.hypot(x - f.x, y - f.y);
        if (dist < 38 && dist < bestD) {
          bestD = dist;
          best = f;
        }
      }
      return best;
    };

    const burst = (x: number, y: number, colors: string[], n: number, speed: number, streak = false) => {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + hash01(i + n) * 0.8;
        const s = speed * (0.4 + hash01(i * 3 + 1) * 0.9);
        specks.push({
          x,
          y,
          vx: Math.cos(ang) * s,
          vy: Math.sin(ang) * s,
          born: performance.now(),
          life: 700 + hash01(i * 7 + 2) * 1100,
          r: 0.8 + hash01(i * 11 + 3) * 1.5,
          color: colors[i % colors.length],
          streak,
        });
      }
      if (specks.length > 220) specks.splice(0, specks.length - 220);
    };

    const spawnFree = (kind: 0 | 1, x: number, y: number, vx: number, vy: number) => {
      frees.push({ id: freeId++, kind, x, y, vx, vy, born: performance.now(), trail: [] });
      if (frees.length > MAX_FREE) frees.splice(0, frees.length - MAX_FREE);
    };

    const retireOldest = () => {
      const alive = nuclei.filter((d) => !d.retiringAt);
      const { retired } = settlePopulation(alive, MAX_NUCLEI);
      for (const r of retired) {
        r.retiringAt = performance.now();
        note(midiOf(r.z, r.n) - 12, 380);
      }
    };

    const addNucleus = (z: number, n: number, nx: number, ny: number, growth: number, halo = 0): Nucleus => {
      const seed = hashSeed(Math.round(nx * 811), Math.round(ny * 809), seedCount++, z, n);
      const d = makeNucleus(z, n, clamp01(nx), clamp(ny, 0.1, 0.9), growth, seed, halo);
      nuclei.push(d);
      retireOldest();
      return d;
    };

    /** The nucleus becomes a different nuclide; its clock resets to the new want. */
    const retune = (d: Nucleus, z: number, n: number) => {
      d.z = Math.max(0, z);
      d.n = Math.max(0, n);
      d.decayAt = performance.now() + decayDelay(d.z, d.n, d.seed);
      save();
    };

    // ————— the two hands: capture, and the wall a proton has to climb —————

    const mevOf = (speed: number) => Math.pow(speed / ENERGY_SPEED, 2) * ENERGY_MEV;

    const capture = (d: Nucleus, f: Free) => {
      const idx = frees.indexOf(f);
      if (idx >= 0) frees.splice(idx, 1);
      if (massNumber(d.z, d.n) >= MAX_A) {
        // past the ceiling nothing more is absorbed: the drop spits it back
        spawnFree(f.kind, f.x, f.y, -f.vx * 0.6, -f.vy * 0.6);
        try {
          audio().refuse();
        } catch {
          /* noop */
        }
        return;
      }
      retune(d, d.z + f.kind, d.n + (f.kind === 0 ? 1 : 0));
      d.ring = Math.min(1, d.ring + 0.5);
      d.vx += f.vx * 0.06;
      d.vy += f.vy * 0.06;
      try {
        audio().bell();
      } catch {
        /* noop */
      }
      note(midiOf(d.z, d.n), 260);
      try {
        haptics.bloom();
      } catch {
        /* noop */
      }
      burst(d.sx, d.sy, [f.kind === 0 ? NUCLEON_TINTS.neutron[3] : NUCLEON_TINTS.proton[3], "#F2EEE6"], 8, 34);
      useField.getState().recordTape("object", 0.55, "nucleons/capture");
    };

    /** A proton that arrived too slow: turned aside by the wall, never absorbed. */
    const rebuff = (d: Nucleus, f: Free) => {
      const dx = f.x - d.sx;
      const dy = f.y - d.sy;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / dist;
      const uy = dy / dist;
      const along = f.vx * ux + f.vy * uy;
      f.vx -= 2 * along * ux;
      f.vy -= 2 * along * uy;
      f.vx *= 0.86;
      f.vy *= 0.86;
      // push it clear so it cannot re-strike the same wall next frame
      f.x = d.sx + ux * (d.sr + 14);
      f.y = d.sy + uy * (d.sr + 14);
      try {
        audio().refuse();
      } catch {
        /* noop */
      }
      note(32, 200);
      try {
        haptics.ripple(0.25);
      } catch {
        /* noop */
      }
      burst(f.x, f.y, [NUCLEON_TINTS.strain[2], NUCLEON_TINTS.proton[1]], 4, 20);
    };

    // ————— decay: what the drop already wanted —————

    const blast = (x: number, y: number, mag: number) => {
      const minDim = Math.min(width, height);
      blasts.push({ x, y, born: performance.now(), maxR: minDim * (0.2 + 0.6 * mag), mag });
      if (blasts.length > 4) blasts.shift();
      if (!reduce) {
        const reach = minDim * (0.28 + mag * 0.4);
        for (const o of nuclei) {
          if (o.retiringAt || o.sr <= 0) continue;
          const dx = o.sx - x;
          const dy = o.sy - y;
          const dist = Math.hypot(dx, dy);
          if (dist > 1 && dist < reach) {
            const k = (1 - dist / reach) * (30 + 110 * mag);
            o.pushX += (dx / dist) * k;
            o.pushY += (dy / dist) * k;
          }
        }
      }
      try {
        audio().bell();
        audio().thud();
      } catch {
        /* noop */
      }
      if (mag > 0.4) {
        try {
          audio().spark();
        } catch {
          /* noop */
        }
      }
      note(28 + Math.round(mag * 6), 460);
      noteLater(130, 40 + Math.round(mag * 10), 300);
      try {
        (mag > 0.55 ? haptics.storm : haptics.bloom)();
      } catch {
        /* noop */
      }
    };

    const doBeta = (d: Nucleus, minus: boolean) => {
      const ang = hash01(d.seed + d.z + d.n) * Math.PI * 2;
      retune(d, d.z + (minus ? 1 : -1), d.n + (minus ? -1 : 1));
      d.ring = Math.min(1, d.ring + 0.4);
      if (minus) d.halo = Math.min(24, d.halo + 1);
      // the electron leaves at once, and a neutrino thread goes the other way
      const tint = minus ? NUCLEON_TINTS.electron[2] : NUCLEON_TINTS.proton[3];
      specks.push({
        x: d.sx,
        y: d.sy,
        vx: Math.cos(ang) * 300,
        vy: Math.sin(ang) * 300,
        born: performance.now(),
        life: 900,
        r: 1.5,
        color: tint,
        streak: true,
      });
      specks.push({
        x: d.sx,
        y: d.sy,
        vx: Math.cos(ang + Math.PI) * 520,
        vy: Math.sin(ang + Math.PI) * 520,
        born: performance.now(),
        life: 700,
        r: 0.7,
        color: "#7C8B93",
        streak: true,
      });
      note(midiOf(d.z, d.n) + (minus ? 7 : -7), 200);
      noteLater(180, midiOf(d.z, d.n), 260);
      try {
        audio().spark();
      } catch {
        /* noop */
      }
      try {
        haptics.tap();
      } catch {
        /* noop */
      }
      useField.getState().recordTape("ripple", 0.5, minus ? "nucleons/beta-minus" : "nucleons/beta-plus");
    };

    const doAlpha = (d: Nucleus) => {
      const ang = hash01(d.seed * 3 + d.z) * Math.PI * 2;
      retune(d, d.z - 2, d.n - 2);
      d.ring = Math.min(1, d.ring + 0.6);
      d.vx -= Math.cos(ang) * 60;
      d.vy -= Math.sin(ang) * 60;
      const child = addNucleus(
        2,
        2,
        clamp01((d.sx + Math.cos(ang) * (d.sr + 26)) / Math.max(1, width)),
        clamp((d.sy + Math.sin(ang) * (d.sr + 26)) / Math.max(1, height), 0.1, 0.9),
        1,
      );
      child.vx = Math.cos(ang) * 260;
      child.vy = Math.sin(ang) * 260;
      burst(d.sx, d.sy, [NUCLEON_TINTS.proton[3], NUCLEON_TINTS.neutron[2], "#F7F3EA"], 12, 90);
      try {
        audio().chime();
      } catch {
        /* noop */
      }
      note(midiOf(d.z, d.n) - 5, 340);
      try {
        haptics.chop();
      } catch {
        /* noop */
      }
      useField.getState().recordTape("sigil", 0.7, "nucleons/alpha");
      save();
    };

    const doFission = (d: Nucleus) => {
      const split = fissionSplit(d.z, d.n, d.seed);
      const mag = fissionMagnitude(split.q);
      const ang = d.spinPhase + Math.PI / 2;
      const x = d.sx;
      const y = d.sy;
      const halo = d.halo;
      nuclei = nuclei.filter((q) => q !== d);
      const spread = d.sr + 30;
      const a = addNucleus(
        split.a.z,
        split.a.n,
        clamp01((x - Math.cos(ang) * spread) / Math.max(1, width)),
        clamp((y - Math.sin(ang) * spread) / Math.max(1, height), 0.1, 0.9),
        1,
        Math.floor(halo / 2),
      );
      const b = addNucleus(
        split.b.z,
        split.b.n,
        clamp01((x + Math.cos(ang) * spread) / Math.max(1, width)),
        clamp((y + Math.sin(ang) * spread) / Math.max(1, height), 0.1, 0.9),
        1,
        halo - Math.floor(halo / 2),
      );
      const kick = 150 + mag * 220;
      a.vx = -Math.cos(ang) * kick;
      a.vy = -Math.sin(ang) * kick;
      b.vx = Math.cos(ang) * kick;
      b.vy = Math.sin(ang) * kick;
      // the prompt neutrons — the ones that go and find the next drop
      for (let i = 0; i < split.neutrons; i++) {
        const na = ang + Math.PI / 2 + (i - (split.neutrons - 1) / 2) * 0.9 + hash01(d.seed + i) * 0.4;
        spawnFree(0, x, y, Math.cos(na) * 340, Math.sin(na) * 340);
      }
      if (mag > 0) blast(x, y, mag);
      burst(x, y, [NUCLEON_TINTS.proton[3], NUCLEON_TINTS.neutron[3], "#F7F3EA"], 22, 150, true);
      useField.getState().recordTape("sigil", Math.min(1, 0.7 + mag * 0.3), "nucleons/fission");
      save();
    };

    /** Do the one thing this nuclide wants. Stable drops hum instead of nothing. */
    const resolve = (d: Nucleus, asked: boolean): DecayMode => {
      const mode = decayMode(d.z, d.n);
      if (mode === "beta-minus") doBeta(d, true);
      else if (mode === "beta-plus") doBeta(d, false);
      else if (mode === "alpha") doAlpha(d);
      else if (mode === "fission") doFission(d);
      else if (asked) {
        // stillness is an answer too: a held drop that wants nothing sings
        d.ring = Math.min(1, d.ring + 0.35);
        note(midiOf(d.z, d.n), 520);
        noteLater(200, midiOf(d.z, d.n) + 12, 340);
        try {
          audio().chime();
        } catch {
          /* noop */
        }
        try {
          haptics.ripple(0.35);
        } catch {
          /* noop */
        }
      }
      return mode;
    };

    /** Two drops meeting hard enough merge — how superheavies are really made. */
    const attemptMerge = (a: Nucleus, b: Nucleus) => {
      if (!a.closed || !b.closed || a.retiringAt || b.retiringAt) return;
      const closing = Math.hypot(a.vx - b.vx, a.vy - b.vy);
      const barrier = coulombBarrier(a.z, a.n, b.z);
      if (massNumber(a.z, a.n) + massNumber(b.z, b.n) > MAX_A || mevOf(closing) < barrier) {
        // an elastic refusal: the two drops bounce off each other's charge
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const k = Math.max(50, closing * 0.55);
        a.vx -= (dx / dist) * k;
        a.vy -= (dy / dist) * k;
        b.vx += (dx / dist) * k;
        b.vy += (dy / dist) * k;
        a.ring = Math.min(1, a.ring + 0.3);
        b.ring = Math.min(1, b.ring + 0.3);
        try {
          audio().refuse();
        } catch {
          /* noop */
        }
        note(26, 300);
        try {
          haptics.chop();
        } catch {
          /* noop */
        }
        return;
      }
      const x = (a.sx + b.sx) / 2;
      const y = (a.sy + b.sy) / 2;
      const z = a.z + b.z;
      const n = a.n + b.n;
      const halo = a.halo + b.halo;
      nuclei = nuclei.filter((q) => q !== a && q !== b);
      const merged = addNucleus(z, n, x / Math.max(1, width), y / Math.max(1, height), 1, halo);
      merged.ring = 1;
      blast(x, y, clamp01(0.25 + massNumber(z, n) / 320));
      useField.getState().recordTape("sigil", 0.85, "nucleons/merge");
      save();
    };

    // ————— the quiet clear —————
    stillRef.current = () => {
      const now = performance.now();
      for (const d of nuclei) {
        if (d.retiringAt) continue;
        d.retiringAt = now;
        if (!reduce && d.sr > 0) {
          burst(d.sx, d.sy, [NUCLEON_TINTS.neutron[2], NUCLEON_TINTS.proton[2]], 8, 90, true);
        }
      }
      frees.length = 0;
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ nuclei: [] }));
      } catch {
        /* noop */
      }
      setHasNuclei(false);
      try {
        audio().thud();
      } catch {
        /* noop */
      }
      try {
        haptics.roll();
      } catch {
        /* noop */
      }
    };

    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    const tutti = () => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      tuttiPulse = 1;
      nuclei
        .filter((d) => !d.retiringAt && d.closed)
        .slice(0, 8)
        .forEach((d, i) => noteLater(i * 55, midiOf(d.z, d.n), 90));
      try {
        haptics.tap();
      } catch {
        /* noop */
      }
    };

    // ————— gestures —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          if (lensSnapped === 1) {
            lensSnapped = 0;
            lensTarget = 0;
            window.setTimeout(() => markLens(false), 0);
            try {
              haptics.lens();
            } catch {
              /* noop */
            }
            note(46, 160);
          }
          return;
        }
        if (e.fingers === 3) {
          tutti();
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        const d = nucleusAt(x, y);
        if (d) {
          // the giant resonance: the whole drop rings, and a strained one
          // can shake a neutron loose
          d.ring = Math.min(1, d.ring + 0.35 + e.intensity * 0.55);
          note(midiOf(d.z, d.n) + Math.round(e.intensity * 7), 170);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
          if (e.intensity > 0.7 && d.n > 1 && fissility(d.z, d.n) > 0.5) {
            const ang = hash01(d.seed + d.n) * Math.PI * 2;
            retune(d, d.z, d.n - 1);
            spawnFree(0, d.sx + Math.cos(ang) * d.sr, d.sy + Math.sin(ang) * d.sr, Math.cos(ang) * 210, Math.sin(ang) * 210);
            try {
              audio().spark();
            } catch {
              /* noop */
            }
          }
          useField.getState().recordTape("ripple", 0.35 + e.intensity * 0.4, "nucleons/strike");
        }
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            note(32, 300);
          }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const d = nucleusAt(x, y);
          hold.id = d ? d.id : null;
          hold.onExisting = !!d;
          hold.seeded = false;
          hold.freeId = null;
          hold.asked = false;
          return;
        }
        if (e.phase === "release") {
          const d = nuclei.find((q) => q.id === hold.id);
          if (d) d.charge = 0;
          hold.id = null;
          hold.onExisting = false;
          hold.freeId = null;
          save();
          return;
        }
        // ticks
        if (hold.onExisting && hold.id) {
          const d = nuclei.find((q) => q.id === hold.id);
          if (!d || d.retiringAt) return;
          // asking the drop for what it wants — the charge is the asking
          d.charge = clamp01((e.elapsed - 700) / 1700);
          const now = performance.now();
          if (d.charge > 0 && now - lastChargeNoteAt > 320) {
            lastChargeNoteAt = now;
            note(midiOf(d.z, d.n) + Math.round(d.charge * 10), 90);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
          if (e.tier >= 3 && !hold.asked) {
            hold.asked = true;
            hold.id = null;
            d.charge = 0;
            resolve(d, true);
          }
        } else if (hold.freeId != null) {
          // still holding the nucleon this hand pulled from the vacuum:
          // the longer the hold, the more the vacuum was made to pay —
          // past the ceremony tier it hands back a proton instead
          const f = frees.find((q) => q.id === hold.freeId);
          if (f) {
            f.x = x;
            f.y = y;
            f.vx = 0;
            f.vy = 0;
            if (e.tier >= 3 && f.kind === 0) {
              f.kind = 1;
              try {
                audio().chime();
              } catch {
                /* noop */
              }
              note(74, 220);
              try {
                haptics.bloom();
              } catch {
                /* noop */
              }
              burst(x, y, [NUCLEON_TINTS.proton[3], "#F7F3EA"], 8, 40);
            }
          }
        } else if (e.tier >= 2 && !hold.seeded) {
          hold.seeded = true;
          spawnFree(0, x, y, 0, 0);
          hold.freeId = frees[frees.length - 1].id;
          try {
            audio().spark();
          } catch {
            /* noop */
          }
          note(70, 200);
          try {
            haptics.ripple(0.45);
          } catch {
            /* noop */
          }
          burst(x, y, [NUCLEON_TINTS.neutron[3]], 5, 18);
          useField.getState().recordTape("object", 0.45, "nucleons/condense");
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // the neutron flux — the wind that builds the heavy elements
          windTargetX = clamp(e.vx * 1.5, -1, 1);
          windTargetY = clamp(e.vy * 1.5, -1, 1);
          const mag = Math.hypot(windTargetX, windTargetY);
          const now = performance.now();
          if (mag > 0.45 && now - lastWindSoundAt > 500) {
            lastWindSoundAt = now;
            note(38 + Math.round(mag * 6), 280);
            try {
              haptics.chop();
            } catch {
              /* noop */
            }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "end") return;
        // one finger carries whatever it is on: a loose nucleon rides the
        // hand; a drop is shoved and keeps the momentum you gave it
        const f = hold.freeId != null ? frees.find((q) => q.id === hold.freeId) : freeAt(x, y);
        if (f) {
          f.x = x;
          f.y = y;
          f.vx = e.vx * 26;
          f.vy = e.vy * 26;
          return;
        }
        for (const d of nuclei) {
          if (d.retiringAt || !d.closed || d.sr <= 0) continue;
          if (Math.hypot(x - d.sx, y - d.sy) < Math.max(46, d.sr * 1.2)) {
            d.vx = clamp(d.vx + e.vx * 3.0, -560, 560);
            d.vy = clamp(d.vy + e.vy * 3.0, -560, 560);
          }
        }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        const speed = clamp(e.speed, 0.6, 2.6);
        const f = freeAt(x, y);
        if (f) {
          // the throw that decides whether a proton ever gets in
          f.vx = Math.cos(e.angle) * 340 * speed;
          f.vy = Math.sin(e.angle) * 340 * speed;
          note(f.kind === 0 ? 76 : 80, 90);
          try {
            haptics.ripple(0.35);
          } catch {
            /* noop */
          }
          return;
        }
        const d = nucleusAt(x, y);
        if (!d) return;
        d.vx = clamp(d.vx + Math.cos(e.angle) * 230 * speed, -560, 560);
        d.vy = clamp(d.vy + Math.sin(e.angle) * 230 * speed, -560, 560);
        d.ring = Math.min(1, d.ring + 0.25);
        note(midiOf(d.z, d.n) + 10, 90);
        try {
          haptics.ripple(0.4);
        } catch {
          /* noop */
        }
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            markLens(snapped === 1);
            try {
              haptics.lens();
            } catch {
              /* noop */
            }
            if (snapped === 1) {
              try {
                audio().chime();
              } catch {
                /* noop */
              }
            } else note(46, 160);
          }
          lensTarget = snapped;
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        // winding a drop up: angular momentum stretches it toward a spindle,
        // and a fissile drop spun far enough necks and splits on its own
        const { x, y } = toLocal(e.cx, e.cy);
        const d = nucleusAt(x, y) ?? nuclei.find((q) => !q.retiringAt && q.closed) ?? null;
        if (!d) return;
        d.spin = clamp(d.spin + Math.abs(e.angularVelocity) * 0.09, 0, 2.4);
        d.spinPhase += e.angularVelocity * 0.08;
        const now = performance.now();
        if (now - lastSpinSoundAt > 420) {
          lastSpinSoundAt = now;
          note(midiOf(d.z, d.n) + Math.round(d.spin * 5), 100);
          try {
            haptics.ripple(clamp01(0.2 + d.spin * 0.3));
          } catch {
            /* noop */
          }
        }
      },
    });

    // ————— the vessel —————
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) {
          tiltLeanX = 0;
          tiltLeanY = 0;
          return;
        }
        tiltLeanX = clamp(gamma / 28, -1, 1);
        tiltLeanY = clamp((beta - 35) / 28, -1, 1);
        const mag = Math.hypot(tiltLeanX, tiltLeanY);
        const now = performance.now();
        if (mag > 0.55 && now - lastTiltSoundAt > 1500) {
          lastTiltSoundAt = now;
          note(34 + Math.round(mag * 4), 240);
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // the field is agitated: every drop that wanted something does it now
        for (const d of [...nuclei]) {
          if (d.retiringAt || !d.closed) continue;
          d.ring = Math.min(1, d.ring + 0.4 + intensity * 0.4);
          resolve(d, false);
        }
        try {
          (intensity > 0.7 ? haptics.storm : haptics.chop)();
        } catch {
          /* noop */
        }
      },
      knock: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // a knock on the case shakes a neutron loose from the heaviest drop
        let heaviest: Nucleus | null = null;
        for (const d of nuclei) {
          if (d.retiringAt || d.n < 2) continue;
          if (!heaviest || massNumber(d.z, d.n) > massNumber(heaviest.z, heaviest.n)) heaviest = d;
        }
        if (!heaviest) return;
        const ang = hash01(heaviest.seed + Math.round(intensity * 100)) * Math.PI * 2;
        retune(heaviest, heaviest.z, heaviest.n - 1);
        spawnFree(
          0,
          heaviest.sx + Math.cos(ang) * heaviest.sr,
          heaviest.sy + Math.sin(ang) * heaviest.sr,
          Math.cos(ang) * (160 + intensity * 200),
          Math.sin(ang) * (160 + intensity * 200),
        );
        heaviest.ring = Math.min(1, heaviest.ring + 0.5);
        note(midiOf(heaviest.z, heaviest.n) - 4, 200);
        try {
          haptics.chop();
        } catch {
          /* noop */
        }
      },
    });

    // ————— keyboard dialect —————
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
      if ((ev.key === "Enter" || ev.key === " ") && ev.shiftKey) {
        // the keyboard's throw: send the nearest loose nucleon at the drop
        // under the cursor — the same barrier, the same answer
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (ev.repeat) return;
        if (!cursorVisible) {
          cursorVisible = true;
          return;
        }
        const x = cursorNx * width;
        const y = cursorNy * height;
        const d = nucleusAt(x, y);
        if (!d) return;
        let best: Free | null = null;
        let bestD = Infinity;
        for (const f of frees) {
          const dist = Math.hypot(f.x - d.sx, f.y - d.sy);
          if (dist < bestD) {
            bestD = dist;
            best = f;
          }
        }
        if (!best) return;
        const ang = Math.atan2(d.sy - best.y, d.sx - best.x);
        best.vx = Math.cos(ang) * 620;
        best.vy = Math.sin(ang) * 620;
        note(78, 90);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!cursorVisible) {
          cursorVisible = true;
          return;
        }
        const x = cursorNx * width;
        const y = cursorNy * height;
        const d = nucleusAt(x, y);
        if (d) {
          if (kbId !== d.id) {
            kbId = d.id;
            kbCharge = 0;
          }
          kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
          d.charge = kbCharge;
          const now = performance.now();
          if (now - lastChargeNoteAt > 320) {
            lastChargeNoteAt = now;
            note(midiOf(d.z, d.n) + Math.round(kbCharge * 10), 90);
          }
          if (kbCharge >= 1) {
            kbCharge = 0;
            kbId = null;
            d.charge = 0;
            resolve(d, true);
          }
        } else if (!ev.repeat) {
          spawnFree(0, x, y, 0, 0);
          try {
            audio().spark();
          } catch {
            /* noop */
          }
          note(70, 200);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const d = nuclei.find((q) => q.id === kbId);
        if (d) d.charge = 0;
        kbCharge = 0;
        kbId = null;
      }
    };
    const onBlur = () => {
      cursorVisible = false;
      save(true);
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("blur", onBlur);
    const onVis = () => {
      if (document.visibilityState === "hidden") save(true);
    };
    document.addEventListener("visibilitychange", onVis);

    // ————— drawing —————

    const drawNucleus = (d: Nucleus, t: number, breath: number) => {
      const a = massNumber(d.z, d.n);
      const minDim = Math.min(width, height);
      const grow = d.growth < 1 ? 0.25 + 0.75 * d.growth : 1;
      let fade = 1;
      let retireScale = 1;
      if (d.retiringAt) {
        const u = clamp01((performance.now() - d.retiringAt) / RETIRE_MS);
        fade = 1 - u;
        retireScale = 1 + u * 0.4;
      }
      const breathScale = reduce ? 1 : 1 + Math.sin(breath + d.spinPhase) * 0.03;
      const R = radiusOf(d.z, d.n) * grow * breathScale * retireScale * (1 + d.ring * 0.1);
      if (R < 1) return;
      const cx = d.nx * width;
      const cy = d.ny * height;
      d.sx = cx;
      d.sy = cy;
      d.sr = R;

      const strain = clamp01((fissility(d.z, d.n) - 0.35) / 0.55);
      const feltAlpha = (1 - lens) * fade;
      if (feltAlpha <= 0.02) return;

      // spin stretches the drop into a spindle; strain stretches it further
      const elong = reduce ? 1 : 1 + d.spin * 0.42 + strain * 0.1 + d.neck * 0.7;
      const squash = 1 / Math.sqrt(elong);

      ctx.save();
      const tremor = !reduce && strain > 0.2 ? strain * R * 0.035 : 0;
      ctx.translate(
        cx + (tremor ? Math.sin(performance.now() * 0.021 + d.spinPhase) * tremor : 0),
        cy + (tremor ? Math.cos(performance.now() * 0.017 + d.spinPhase) * tremor : 0),
      );

      // the ceremony's halo while a hand asks
      if (d.charge > 0) {
        const halo = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * (2.2 - d.charge * 0.5));
        halo.addColorStop(0, colorAlpha("#E7AC52", 0.1 * d.charge * fade));
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(-R * 2.4, -R * 2.4, R * 4.8, R * 4.8);
      }

      // the electron halo — everything the betas have thrown away, still near
      if (d.halo > 0) {
        const hr = R * 2.3;
        const shown = Math.min(d.halo, 14);
        for (let i = 0; i < shown; i++) {
          const ea = (i / shown) * Math.PI * 2 + (reduce ? 0 : t * 0.5 * (i % 2 === 0 ? 1 : -0.7));
          const ex = Math.cos(ea) * hr;
          const ey = Math.sin(ea) * hr * 0.72;
          ctx.fillStyle = colorAlpha(NUCLEON_TINTS.electron[2], 0.4 * feltAlpha);
          ctx.beginPath();
          ctx.arc(ex, ey, Math.max(0.9, R * 0.045), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.rotate(d.spinPhase);

      // the skin: surface tension drawn as a soft rim, merlot when strained
      const rim = ctx.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 1.45);
      rim.addColorStop(0, colorAlpha(strain > 0.4 ? NUCLEON_TINTS.strain[1] : "#2A1E12", 0.5 * feltAlpha));
      rim.addColorStop(0.62, colorAlpha(strain > 0.4 ? NUCLEON_TINTS.strain[0] : "#1A1309", 0.28 * feltAlpha));
      rim.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.scale(elong, squash);
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // the giant resonance ring — the drop still humming from a strike
      if (d.ring > 0.02) {
        ctx.strokeStyle = colorAlpha("#F2C56B", 0.42 * d.ring * feltAlpha);
        ctx.lineWidth = Math.max(1, R * 0.05 * d.ring);
        ctx.save();
        ctx.scale(elong, squash);
        ctx.beginPath();
        ctx.arc(0, 0, R * (1.05 + (1 - d.ring) * 0.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // the nucleons themselves — the drop is made of countable things
      const sites = packOffsets(a, d.seed);
      const mask = protonMask(d.z, a);
      const jitter = reduce ? 0 : (0.03 + d.ring * 0.09) * R;
      const nr = Math.max(1, R * (a > 90 ? 0.1 : a > 30 ? 0.14 : 0.2));
      for (let i = 0; i < sites.length; i++) {
        const p = sites[i];
        const ph = hash01(d.seed + i * 7) * 7;
        const jx = jitter === 0 ? 0 : Math.sin(t * (1.6 + hash01(i) * 2.2) + ph) * jitter;
        const jy = jitter === 0 ? 0 : Math.cos(t * (1.4 + hash01(i + 3) * 2.4) + ph) * jitter;
        const px = p.x * R * elong + jx;
        const py = p.y * R * squash + jy;
        const isP = mask[i];
        const tints = isP ? NUCLEON_TINTS.proton : NUCLEON_TINTS.neutron;
        // the closer to the skin, the dimmer — a drop has depth
        const depth = 1 - Math.hypot(p.x, p.y) * 0.42;
        ctx.fillStyle = colorAlpha(tints[isP ? 2 : 1], (0.62 + d.ring * 0.3) * depth * feltAlpha);
        ctx.beginPath();
        ctx.arc(px, py, nr, 0, Math.PI * 2);
        ctx.fill();
        if (isP && a <= 60) {
          ctx.fillStyle = colorAlpha(tints[3], 0.5 * depth * feltAlpha);
          ctx.beginPath();
          ctx.arc(px - nr * 0.28, py - nr * 0.28, nr * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    };

    /** The chart of the nuclides — the room's one lettered surface. */
    const drawChart = (alpha: number) => {
      if (alpha <= 0.02) return;
      const padX = Math.max(34, width * 0.1);
      const padY = Math.max(48, height * 0.11);
      const w = width - padX * 2;
      const h = height - padY * 2;
      const maxN = 170;
      const maxZ = 118;
      const px = (n: number) => padX + (clamp(n, 0, maxN) / maxN) * w;
      const py = (z: number) => padY + h - (clamp(z, 0, maxZ) / maxZ) * h;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(6, 7, 10, 0.86)";
      ctx.fillRect(0, 0, width, height);

      // the valley of stability, drawn as the band it is
      ctx.beginPath();
      for (let a = 2; a <= MAX_A; a += 2) {
        const z = mostStableZ(a);
        const x = px(a - z);
        const y = py(z);
        if (a === 2) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(232, 226, 213, 0.34)";
      ctx.lineWidth = 1.1;
      ctx.stroke();

      ctx.strokeStyle = "rgba(232, 226, 213, 0.1)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(px(maxN), py(0));
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(px(0), py(maxZ));
      ctx.stroke();

      // N = Z, the line light nuclei sit on and heavy ones fall away from
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = "rgba(105, 151, 164, 0.28)";
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(px(maxZ), py(maxZ));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(232, 226, 213, 0.4)";
      ctx.textAlign = "left";
      ctx.fillText("n", px(maxN) - 8, py(0) + 16);
      ctx.fillText("z", px(0) - 12, py(maxZ) - 8);

      for (const d of nuclei) {
        if (d.retiringAt) continue;
        const x = px(d.n);
        const y = py(d.z);
        const mode = decayMode(d.z, d.n);
        const tint =
          mode === "stable"
            ? "#DDD3BE"
            : mode === "fission"
              ? NUCLEON_TINTS.strain[3]
              : mode === "alpha"
                ? NUCLEON_TINTS.proton[3]
                : NUCLEON_TINTS.electron[2];
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "rgba(247, 243, 234, 0.82)";
        ctx.textAlign = "left";
        ctx.fillText(`${symbolFor(d.z)} ${massNumber(d.z, d.n)}`, x + 7, y + 3);
        ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "rgba(232, 226, 213, 0.42)";
        ctx.fillText(`${bindingPerNucleon(d.z, d.n).toFixed(2)} mev/a`, x + 7, y + 14);
      }
      ctx.restore();
    };

    // ————— the frame —————
    const frame = () => {
      const nowReal = performance.now();
      const dtReal = Math.min(64, nowReal - last);
      last = nowReal;
      timeScale += (timeScaleTarget - timeScale) * 0.12;
      const dt = (dtReal * timeScale) / 1000;
      localT += dt;
      const t = audio().getAudioTime() ?? nowReal / 1000;
      const breath = reduce ? 0 : Math.sin(t * Math.PI * 2 * 0.14) * 2;

      lens += (lensTarget - lens) * 0.14;
      windX += (windTargetX - windX) * 0.06;
      windY += (windTargetY - windY) * 0.06;
      windTargetX *= 0.985;
      windTargetY *= 0.985;
      tuttiPulse *= 0.94;

      // pending notes
      for (let i = pendingNotes.length - 1; i >= 0; i--) {
        if (nowReal >= pendingNotes[i].at) {
          note(pendingNotes[i].midi, pendingNotes[i].ms);
          pendingNotes.splice(i, 1);
        }
      }

      // the flux: a sustained wind keeps pulling neutrons out of the vacuum
      const windMag = Math.hypot(windX, windY);
      if (windMag > 0.12 && frees.length < MAX_FREE) {
        fluxDebt += windMag * dtReal * 0.012;
        while (fluxDebt >= 1 && frees.length < MAX_FREE) {
          fluxDebt -= 1;
          const k = hash01(nowReal * 0.37 + frees.length);
          const fromX = windX >= 0 ? -20 : width + 20;
          const fromY = windY >= 0 ? -20 : height + 20;
          const alongEdge = Math.abs(windX) > Math.abs(windY);
          spawnFree(
            0,
            alongEdge ? fromX : k * width,
            alongEdge ? k * height : fromY,
            windX * 320,
            windY * 320,
          );
        }
      }

      // ——— nuclei: drift, jostle, and do what they want ———
      for (const d of nuclei) {
        if (d.retiringAt) continue;
        d.spin *= Math.exp(-dt * 0.55);
        d.spinPhase += (reduce ? 0 : d.spin * 1.6 + 0.08) * dt;
        d.ring *= Math.exp(-dt * 1.9);
        if (d.growth < 1) d.growth = clamp01(d.growth + dt * 1.6);
        else d.closed = true;

        // spun past holding: the drop necks, and then it splits
        const strain = fissility(d.z, d.n);
        if (!reduce && d.closed && d.spin > 1.05 && strain > 0.45 && canFission(d.z, d.n)) {
          d.neck = clamp01(d.neck + dt * (d.spin - 0.9) * 1.4);
          if (d.neck >= 1) {
            doFission(d);
            continue;
          }
        } else {
          d.neck = Math.max(0, d.neck - dt * 1.2);
        }

        // the decay clock — this is why the room is alive when nobody is here
        if (d.closed && nowReal >= d.decayAt) {
          resolve(d, false);
          continue;
        }

        // motion: kinetic velocity, the vessel's gravity, the shockwave push
        d.vx += d.pushX;
        d.vy += d.pushY;
        d.pushX = 0;
        d.pushY = 0;
        if (!reduce) {
          d.vx += tiltLeanX * 28 * dt * 60;
          d.vy += tiltLeanY * 28 * dt * 60;
          d.vx += Math.sin(localT * 0.31 + d.spinPhase) * 5;
          d.vy += Math.cos(localT * 0.27 + d.spinPhase * 1.3) * 5;
        }
        d.vx *= Math.exp(-dt * 1.6);
        d.vy *= Math.exp(-dt * 1.6);
        d.nx += (d.vx * dt) / Math.max(1, width);
        d.ny += (d.vy * dt) / Math.max(1, height);
        const marginX = d.sr / Math.max(1, width) + 0.02;
        const marginY = d.sr / Math.max(1, height) + 0.04;
        if (d.nx < marginX) {
          d.nx = marginX;
          d.vx = Math.abs(d.vx) * 0.55;
        }
        if (d.nx > 1 - marginX) {
          d.nx = 1 - marginX;
          d.vx = -Math.abs(d.vx) * 0.55;
        }
        if (d.ny < marginY) {
          d.ny = marginY;
          d.vy = Math.abs(d.vy) * 0.55;
        }
        if (d.ny > 1 - marginY) {
          d.ny = 1 - marginY;
          d.vy = -Math.abs(d.vy) * 0.55;
        }
      }

      // ——— drops meeting drops ———
      for (let i = 0; i < nuclei.length; i++) {
        for (let j = i + 1; j < nuclei.length; j++) {
          const a = nuclei[i];
          const b = nuclei[j];
          if (a.retiringAt || b.retiringAt || a.sr <= 0 || b.sr <= 0) continue;
          if (Math.hypot(a.sx - b.sx, a.sy - b.sy) < (a.sr + b.sr) * 0.92) {
            attemptMerge(a, b);
            i = nuclei.length;
            break;
          }
        }
      }

      // ——— free nucleons ———
      for (let i = frees.length - 1; i >= 0; i--) {
        const f = frees[i];
        const held = hold.freeId === f.id;
        if (!held) {
          f.vx += windX * 260 * dt;
          f.vy += windY * 260 * dt;
          if (!reduce) {
            f.vx += tiltLeanX * 40 * dt * 60;
            f.vy += tiltLeanY * 40 * dt * 60;
          }
          f.vx *= Math.exp(-dt * 0.35);
          f.vy *= Math.exp(-dt * 0.35);
          f.x += f.vx * dt;
          f.y += f.vy * dt;
        }
        f.trail.push(f.x, f.y);
        if (f.trail.length > 14) f.trail.splice(0, f.trail.length - 14);
        if (f.x < -60 || f.x > width + 60 || f.y < -60 || f.y > height + 60) {
          frees.splice(i, 1);
          continue;
        }
        if (held) continue;
        // the wall, or the way in
        for (const d of nuclei) {
          if (d.retiringAt || !d.closed || d.sr <= 0) continue;
          if (Math.hypot(f.x - d.sx, f.y - d.sy) > d.sr + 8) continue;
          const speed = Math.hypot(f.vx, f.vy);
          const barrier = coulombBarrier(d.z, d.n, f.kind);
          if (mevOf(speed) >= barrier) capture(d, f);
          else rebuff(d, f);
          break;
        }
      }

      // ——— specks ———
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        const age = nowReal - s.born;
        if (age > s.life) {
          specks.splice(i, 1);
          continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= Math.exp(-dt * 0.8);
        s.vy *= Math.exp(-dt * 0.8);
      }

      // ——— paint ———
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.42,
        Math.min(width, height) * 0.08,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.82,
      );
      bg.addColorStop(0, "#100d0b");
      bg.addColorStop(1, "#050506");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // the vacuum's own faint grain
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const dx = reduce ? 0 : Math.sin(localT * 0.24 + m.p) * 6 + windX * 22;
        const dy = reduce ? 0 : Math.cos(localT * 0.19 + m.p * 1.4) * 6 + windY * 22;
        ctx.fillStyle = `rgba(221, 211, 190, ${0.035 + 0.03 * hash01(i) + tuttiPulse * 0.05})`;
        ctx.beginPath();
        ctx.arc(m.x + dx, m.y + dy, 0.8 + hash01(i + 9) * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // blasts, under the drops
      for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i];
        const u = (nowReal - b.born) / (700 + b.mag * 700);
        if (u >= 1) {
          blasts.splice(i, 1);
          continue;
        }
        const r = b.maxR * (u < 0.2 ? u / 0.2 : 1) * (0.35 + u * 0.8);
        ctx.strokeStyle = `rgba(242, 197, 107, ${0.42 * (1 - u) * b.mag})`;
        ctx.lineWidth = Math.max(1, 7 * (1 - u) * b.mag);
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const d of nuclei) drawNucleus(d, t, breath);

      // free nucleons, with the trail that says which way they came
      for (const f of frees) {
        const tint = f.kind === 0 ? NUCLEON_TINTS.neutron : NUCLEON_TINTS.proton;
        if (f.trail.length >= 4 && !reduce) {
          ctx.strokeStyle = colorAlpha(tint[0], 0.3 * (1 - lens));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(f.trail[0], f.trail[1]);
          for (let i = 2; i < f.trail.length; i += 2) ctx.lineTo(f.trail[i], f.trail[i + 1]);
          ctx.stroke();
        }
        const glow = ctx.createRadialGradient(f.x, f.y, 0.5, f.x, f.y, 11);
        glow.addColorStop(0, colorAlpha(tint[3], 0.8 * (1 - lens)));
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorAlpha(tint[2], 0.95 * (1 - lens));
        ctx.beginPath();
        ctx.arc(f.x, f.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // specks over everything
      for (const s of specks) {
        const u = (nowReal - s.born) / s.life;
        const alpha = (1 - u) * (1 - lens);
        if (s.streak) {
          ctx.strokeStyle = colorAlpha(s.color, 0.7 * alpha);
          ctx.lineWidth = s.r;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - s.vx * 0.02, s.y - s.vy * 0.02);
          ctx.stroke();
        } else {
          ctx.fillStyle = colorAlpha(s.color, 0.75 * alpha);
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // the keyboard's cursor, when a keyboard is driving
      if (cursorVisible) {
        ctx.strokeStyle = "rgba(242, 197, 107, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cursorNx * width, cursorNy * height, 13, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawChart(lens);

      // the glimmer: after a long stillness, one neutron drifts through
      if (!reduce && nowReal - lastInteractionAt > 20000 && nowReal - glimmerAt > 14000) {
        glimmerAt = nowReal;
        const k = hash01(nowReal * 0.11);
        spawnFree(0, -20, k * height * 0.8 + height * 0.1, 70 + k * 40, (k - 0.5) * 30);
      }

      if (nuclei.some((d) => d.retiringAt && nowReal - d.retiringAt > RETIRE_MS)) {
        nuclei = nuclei.filter((d) => !d.retiringAt || nowReal - d.retiringAt <= RETIRE_MS);
      }
      save();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      mq.removeEventListener?.("change", onMq);
      observer.disconnect();
      detach();
      detachVessel();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(raf);
      save(true);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a field of nuclei — drops of protons and neutrons that capture, decay, and split"
      style={{
        position: "fixed",
        inset: 0,
        background: "#050506",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <LetGo label="let the drops disperse" onLetGo={() => stillRef.current()} visible={hasNuclei} />
    </div>
  );
}
