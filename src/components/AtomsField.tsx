"use client";

/**
 * /atoms — a near-vacuum at 10⁻¹⁰ m, the physics band of the scale
 * manifold (plan W6).
 *
 * A handful of atoms as soft probability clouds: shell rings, orbital
 * lobes rendered as translucent fields, a bright nucleus. Every atom is a
 * pure function of its seed (src/lib/atomics.ts) — electron count, shells,
 * lobe symmetry, tint — and the clouds breathe on the shared audio clock.
 * Tap excites: an electron jumps a shell (ring flash, rising note) and
 * decays back after a beat (falling note, a soft photon streak); intensity
 * decides the jump size. A drag sweeps the field and the clouds lean
 * toward the finger (and clouds under the finger ride it). Dwell on open
 * space condenses a new atom. The ceremony held where two atoms are near
 * is COVALENCE: they share a bond, lobes merging — the bond is the
 * order-independent hash of both seeds, and it obeys the real law
 * (src/lib/atomics.ts covalentPair): bond order is the lesser appetite,
 * drawn as one, two, or three strands; noble gases — and atoms whose
 * appetite is spent — refuse with a soft elastic rebuff and a low refuse
 * tone, never silence. FUSION is the other verb, kinetic where covalence
 * is ceremonial: drive two atoms together hard (flick one into another, or
 * slow time with a three-finger hold and drag them together fast) and, up
 * to iron, the nuclei merge into the real product with a radiating blast —
 * shockwave ring, flash, photon streaks — scaled by the released binding
 * energy; past iron the nuclei strain, shudder, and dim instead of
 * flashing — and the whole field goes heavy and sags DOWNWARD, toward the
 * band below where the only road past iron has ever run. The stellar dead
 * end, felt, and pointing. When two compatible atoms drift
 * near, a faint dashed arc breathes between them after a beat — the room
 * proposing the pair-ceremony, never text. A bond is drawn the way the
 * table says it is shared: the electronegativity gap pools the shared light
 * toward whichever atom pulls harder, and past Pauling's ionic gap it stops
 * being a share at all — two charged rings, and two notes instead of one.
 * Three fingers run a field wind or dilate time, three fingers TWISTED turn
 * the season from a cold vacuum to the inside of a star where electrons jump
 * unbidden, a scrub precesses the orbitals, a two-finger twist rotates the
 * lens to the orbital diagram (thin measured rings, energy rungs, the
 * element's symbol and Z in thin mono — the one lettered surface). A flick
 * still ionizes as it throws: the shed electron streaks off behind the
 * hurled cloud. A knock on the case rings the whole field; laid face-down
 * the room is night. The field persists in `objetdart:atoms:v1`; the shared
 * quiet control stills it. Deliberately unbound: pinch (ScaleTravel owns it
 * — molecules above, nucleons below) and two-finger pan, there being no
 * frame to pan; two-finger tap lowers the lens.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { THRESHOLDS, attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
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
  ATOM_FAMILIES,
  MAX_ATOMS,
  MAX_RING,
  atomFromSeed,
  blastMagnitude,
  bondPolarity,
  canFuse,
  covalentBond,
  covalentPair,
  elementFromSeed,
  elementOf,
  excitedRing,
  fuseProduct,
  fusionEnergy,
  hashSeed,
  settlePopulation,
  wantsBond,
  type AtomMorph,
} from "@/lib/atomics";

const STORE_KEY = "objetdart:atoms:v1";
const MOTE_COUNT = 60;
const RETIRE_MS = 1400;
const EXCITE_MS = 900;
/** The hold tiers, read from the grammar — never redefined here. */
const TOUCH_MS = THRESHOLDS.tapMaxMs;
const DWELL_MS = THRESHOLDS.dwellMs;

type AtomEnt = {
  id: string;
  seed: number;
  nx: number;
  ny: number;
  morph: AtomMorph;
  /** 0..1 — the cloud gathering from nothing when condensed. */
  growth: number;
  closed: boolean;
  /** Live excitation, if any. */
  excite: { ring: number; born: number; decayed: boolean } | null;
  /** 0..1 covalence charge — lobes reach for the partner. */
  charge: number;
  /** Extra precession from stirring, decays. */
  precessBoost: number;
  /** Ionization dimming, 0..1, decays. */
  dim: number;
  /** Nuclear strain tremor (the iron wall), 0..1, decays. */
  shudder: number;
  /** Kinetic velocity, px/s — the fusion channel (flick throws, hard drags). */
  kvx: number;
  kvy: number;
  precessPhase: number;
  birth: number;
  retiringAt: number;
  pushX: number;
  pushY: number;
  sx: number;
  sy: number;
  sr: number;
};

type CovBond = {
  aId: string;
  bId: string;
  seed: number;
  /** Real bond order from covalentPair — the strands drawn. */
  order: 1 | 2 | 3;
  /** Rest length factor over the two cloud radii (kernel radii + order). */
  restK: number;
};
type Blast = { x: number; y: number; born: number; maxR: number; mag: number };
type Hint = { aId: string; bId: string; since: number; alpha: number };
type Mote = { x: number; y: number; vx: number; vy: number };
type Speck = { x: number; y: number; vx: number; vy: number; born: number; life: number; r: number; color: string; streak?: boolean };
type PendingNote = { at: number; midi: number; ms: number };

type Stored = {
  atoms: Array<{ id: string; seed: number; nx: number; ny: number }>;
  bonds: Array<{ a: string; b: string }>;
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

function makeAtom(seed: number, nx: number, ny: number, growth: number): AtomEnt {
  const morph = atomFromSeed(seed);
  return {
    id: `at-${seed.toString(36)}`,
    seed,
    nx,
    ny,
    morph,
    growth,
    closed: growth >= 1,
    excite: null,
    charge: 0,
    precessBoost: 0,
    dim: 0,
    shudder: 0,
    kvx: 0,
    kvy: 0,
    precessPhase: (hashSeed(seed, 97) / 4294967296) * Math.PI * 2,
    birth: performance.now(),
    retiringAt: 0,
    pushX: 0,
    pushY: 0,
    sx: -1,
    sy: -1,
    sr: 0,
  };
}

// the first look is never an empty vacuum — three deterministic presences
const STARTERS: Array<[number, number]> = [
  [0.3, 0.4],
  [0.7, 0.34],
  [0.5, 0.7],
];

function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || !Array.isArray(parsed.atoms)) return null;
    return {
      atoms: parsed.atoms.filter(
        (a) => a && typeof a.seed === "number" && typeof a.nx === "number" && typeof a.ny === "number",
      ),
      bonds: Array.isArray(parsed.bonds)
        ? parsed.bonds.filter((b) => b && typeof b.a === "string" && typeof b.b === "string")
        : [],
    };
  } catch {
    return null;
  }
}

/** midi voice of an atom — the high shimmer end of the axis */
function midiOf(morph: AtomMorph): number {
  return 64 + morph.voice + morph.family * 2;
}

export default function AtomsField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // §8c — the quiet clear: visible only when atoms stand; wired by the effect
  const [hasAtoms, setHasAtoms] = useState(false);
  const stillRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let atoms: AtomEnt[] = [];
    let bonds: CovBond[] = [];
    let seedCount = 0;
    const motes: Mote[] = [];
    const specks: Speck[] = [];
    const pendingNotes: PendingNote[] = [];
    const blasts: Blast[] = [];
    const hints = new Map<string, Hint>(); // bond-hint arcs between compatible neighbors
    const fuseCooldown = new Map<string, number>();
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
    let sweepX = 0;
    let sweepY = 0;
    let sweepStrength = 0;
    let stirOmega = 0;
    // the vessel: gravity's lean on the clouds (-1..1) and the tutti pulse
    let tiltLeanX = 0;
    let tiltLeanY = 0;
    let tuttiPulse = 0;
    /** the room's slow cycle, 0..1: a cold vacuum ↔ the inside of a star */
    let season = 0.1;
    let seasonSpokenAt = 0;
    let spontaneousAt = 0;
    /** rhythm entrainment: electrons jump on the hand's own beat for a while */
    let pulseBpm = 0;
    let pulseUntil = 0;
    let lastPulseAt = 0;
    let pulseIdx = 0;
    /** face-down: the clouds keep their watch in the dark */
    let night = 0;
    let nightTarget = 0;
    /** the iron wall, still ringing: the field leans downhill toward the
     *  band below, where anything heavier has to be made */
    let ironward = 0;
    let lastKnockAt = 0;
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
    let lastDeepenNoteAt = 0;
    let lastInteractionAt = performance.now();
    let lastSaveAt = 0;
    let dirty = false;
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbAtomId: string | null = null;
    let lastSweepSoundAt = 0;
    let lastWindSoundAt = 0;
    let lastScrubAt = 0;
    let lastChargeNoteAt = 0;
    const hold: {
      atomId: string | null;
      partnerId: string | null;
      onExisting: boolean;
      seeded: boolean;
      bonded: boolean;
      /** 0..1 — what has visibly gathered under the finger so far */
      gather: number;
      gx: number;
      gy: number;
    } = {
      atomId: null,
      partnerId: null,
      onExisting: false,
      seeded: false,
      bonded: false,
      gather: 0,
      gx: 0,
      gy: 0,
    };
    let gatherFade = 0;
    let lastGatherNoteAt = 0;

    // ————— the room runtime: govern frames, sleep when unwatched —————
    const gov = createFrameGovernor();
    let sleeping = false;
    let paused = false;
    let lastTier = gov.tier();
    const offVis = onVisibility((hidden) => { sleeping = hidden; });
    const offPause = onGalleryPause((p) => { paused = p; });

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; };
    mq.addEventListener?.("change", onMq);

    // ————— persistence —————
    const save = (force = false) => {
      const now = performance.now();
      setHasAtoms(atoms.some((a) => !a.retiringAt));
      if (!force && now - lastSaveAt < 800) { dirty = true; return; }
      lastSaveAt = now;
      dirty = false;
      try {
        const alive = new Set(atoms.filter((a) => !a.retiringAt).map((a) => a.id));
        const stored: Stored = {
          atoms: atoms
            .filter((a) => !a.retiringAt)
            .map((a) => ({ id: a.id, seed: a.seed, nx: a.nx, ny: a.ny })),
          bonds: bonds
            .filter((b) => alive.has(b.aId) && alive.has(b.bId))
            .map((b) => ({ a: b.aId, b: b.bId })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the vacuum keeps its own counsel */ }
    };

    /** How many bonds the atom's element still wants — the real appetite. */
    const appetiteOf = (a: AtomEnt): number => {
      const el = elementOf(a.morph.z);
      if (!el) return 0;
      let held = 0;
      for (const b of bonds) if (b.aId === a.id || b.bId === a.id) held += 1;
      return wantsBond(el) - held;
    };

    /** The real pairing law for two atoms (null = nobles, no bond). */
    const pairingOf = (a: AtomEnt, b: AtomEnt) => {
      const ea = elementOf(a.morph.z);
      const eb = elementOf(b.morph.z);
      return ea && eb ? covalentPair(ea, eb) : null;
    };

    const bondBetween = (a: AtomEnt, b: AtomEnt) => {
      const cb = covalentBond(a.seed, b.seed);
      const pair = pairingOf(a, b);
      const order = (pair ? pair.order : 1) as 1 | 2 | 3;
      // rest from the kernel: radii through covalentBond.rest, the higher
      // orders pulling closer as covalentPair says they do
      bonds.push({ aId: a.id, bId: b.id, seed: cb.seed, order, restK: cb.rest * (1 - 0.08 * (order - 1)) });
    };

    const stored = loadStored();
    if (stored && stored.atoms.length > 0) {
      atoms = stored.atoms
        .slice(-MAX_ATOMS)
        .map((a) => makeAtom(a.seed, clamp01(a.nx), clamp01(a.ny), 1));
      const byId = new Map(atoms.map((a) => [a.id, a]));
      for (const b of stored.bonds) {
        const pa = byId.get(b.a);
        const pb = byId.get(b.b);
        if (pa && pb && pa !== pb && !bonds.some((q) => (q.aId === b.a && q.bId === b.b) || (q.aId === b.b && q.bId === b.a))) {
          bondBetween(pa, pb);
        }
      }
      seedCount = atoms.length;
    } else {
      atoms = STARTERS.map(([nx, ny], i) =>
        makeAtom(hashSeed(Math.round(nx * 811), Math.round(ny * 809), i), nx, ny, 1),
      );
      seedCount = atoms.length;
      save(true);
    }
    setHasAtoms(atoms.length > 0);

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const noteLater = (delayMs: number, midi: number, ms = 120) => {
      pendingNotes.push({ at: performance.now() + delayMs, midi, ms });
    };

    // ————— sprites: every soft glow baked once, drawn with drawImage —————
    // A cloud, a lobe and a nucleus are all the same shape at different
    // radii and tints, so the room bakes one per family instead of building
    // a radial gradient per atom per lobe per frame.
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
    const CLOUD_SPRITES = ATOM_FAMILIES.map((fam) =>
      sprite([
        [0, colorAlpha(fam[3], 0.1)],
        [0.6, colorAlpha(fam[2], 0.06)],
        [1, "rgba(0,0,0,0)"],
      ]),
    );
    const LOBE_SPRITES = ATOM_FAMILIES.map((fam) =>
      sprite([
        [0.04, colorAlpha(fam[4], 0.16)],
        [0.65, colorAlpha(fam[2], 0.07)],
        [1, "rgba(0,0,0,0)"],
      ], 64),
    );
    const NUCLEUS_SPRITES = ATOM_FAMILIES.map((fam) =>
      sprite([
        [0, colorAlpha("#F7F3EA", 0.9)],
        [0.25, colorAlpha(fam[5], 0.6)],
        [1, "rgba(0,0,0,0)"],
      ], 64),
    );
    const HALO_SPRITE = sprite([
      [0.1, "rgba(231, 172, 82, 0.3)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    const GATHER_SPRITE = sprite([
      [0, "rgba(242, 238, 230, 0.4)"],
      [0.45, "rgba(231, 172, 82, 0.16)"],
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
      if (motes.length === 0) {
        for (let i = 0; i < MOTE_COUNT; i++) {
          motes.push({ x: twinkleHash(i + 37) * width, y: twinkleHash(i + 733) * height, vx: 0, vy: 0 });
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

    const atomAt = (x: number, y: number): AtomEnt | null => {
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const a of atoms) {
        if (a.retiringAt) continue;
        const d = Math.hypot(x - a.sx, y - a.sy);
        if (d < Math.max(40, a.sr * 1.2) && d < bestD) { bestD = d; best = a; }
      }
      return best;
    };

    const nearestAtom = (x: number, y: number): AtomEnt | null => {
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const a of atoms) {
        if (a.retiringAt || !a.closed) continue;
        const d = Math.hypot(x - a.sx, y - a.sy);
        if (d < bestD) { bestD = d; best = a; }
      }
      return best;
    };

    const areBonded = (a: AtomEnt, b: AtomEnt) =>
      bonds.some((q) => (q.aId === a.id && q.bId === b.id) || (q.aId === b.id && q.bId === a.id));

    /** The nearest other unbonded-to-it atom within covalent reach of a. */
    const covalentPartner = (a: AtomEnt): AtomEnt | null => {
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const o of atoms) {
        if (o === a || o.retiringAt || !o.closed || areBonded(a, o)) continue;
        const d = Math.hypot(o.sx - a.sx, o.sy - a.sy);
        if (d < (a.sr + o.sr) * 1.5 && d < bestD) { bestD = d; best = o; }
      }
      return best;
    };

    const burst = (x: number, y: number, colors: string[], n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + twinkleHash(i + n) * 0.8;
        const s = speed * (0.4 + twinkleHash(i * 3 + 1) * 0.9);
        specks.push({
          x, y,
          vx: Math.cos(ang) * s,
          vy: Math.sin(ang) * s,
          born: performance.now(),
          life: 800 + twinkleHash(i * 7 + 2) * 1200,
          r: 0.7 + twinkleHash(i * 11 + 3) * 1.6,
          color: colors[i % colors.length],
        });
      }
      if (specks.length > 200) specks.splice(0, specks.length - 200);
    };

    const photonStreak = (a: AtomEnt, angle: number, speed: number, color: string) => {
      specks.push({
        x: a.sx,
        y: a.sy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: performance.now(),
        life: 900,
        r: 1.6,
        color,
        streak: true,
      });
    };

    const retireOldest = () => {
      const alive = atoms.filter((a) => !a.retiringAt);
      const { retired } = settlePopulation(alive, MAX_ATOMS);
      for (const r of retired) {
        r.retiringAt = performance.now();
        bonds = bonds.filter((b) => b.aId !== r.id && b.bId !== r.id);
        note(midiOf(r.morph) - 12, 340); // a low word as the eldest disperses
      }
    };

    const condense = (x: number, y: number): AtomEnt | null => {
      const nx = clamp01(x / width);
      const ny = clamp(y / height, 0.08, 0.95);
      const seed = hashSeed(Math.round(nx * 811), Math.round(ny * 809), seedCount);
      seedCount += 1;
      const a = makeAtom(seed, nx, ny, 0.03);
      atoms.push(a);
      retireOldest();
      try { audio().spark(); } catch { /* noop */ }
      note(midiOf(a.morph) - 12, 200);
      try { haptics.ripple(0.5); } catch { /* noop */ }
      burst(x, y, [ATOM_FAMILIES[a.morph.family][4], "#DDD3BE"], 6, 20);
      useField.getState().recordTape("object", 0.5, "atoms/condense");
      save();
      return a;
    };

    const growAtom = (a: AtomEnt, d: number) => {
      if (a.closed) return;
      a.growth = clamp01(a.growth + d);
      if (!a.closed && a.growth >= 1) {
        a.closed = true;
        // the cloud settles into itself: shimmer, note, bloom
        try { haptics.bloom(); } catch { /* noop */ }
        note(midiOf(a.morph), 280);
        burst(a.sx, a.sy, [ATOM_FAMILIES[a.morph.family][5], "#E7AC52"], 10, 30);
        dirty = true;
      }
    };

    const excite = (a: AtomEnt, intensity: number) => {
      if (!a.closed || a.retiringAt) return;
      const ring = excitedRing(a.morph, intensity);
      a.excite = { ring, born: performance.now(), decayed: false };
      // the jump: a rising note, sized like the leap
      note(midiOf(a.morph) + (ring - a.morph.shells) * 4, 160);
      try { haptics.tap(); } catch { /* noop */ }
      useField.getState().recordTape("ripple", 0.4 + intensity * 0.4, "atoms/excite");
    };

    // the covalence law refuses: nobles (and spent appetites) rebuff softly —
    // an elastic push apart, a low refuse tone, never silence
    const rebuff = (a: AtomEnt, b: AtomEnt) => {
      const dx = b.sx - a.sx;
      const dy = b.sy - a.sy;
      const d = Math.max(1, Math.hypot(dx, dy));
      a.pushX -= (dx / d) * 34;
      a.pushY -= (dy / d) * 34;
      b.pushX += (dx / d) * 34;
      b.pushY += (dy / d) * 34;
      a.shudder = Math.min(1, a.shudder + 0.35);
      b.shudder = Math.min(1, b.shudder + 0.35);
      try { audio().refuse(); } catch { /* noop */ }
      note(30, 260);
      try { haptics.ripple(0.3); } catch { /* noop */ }
      burst((a.sx + b.sx) / 2, (a.sy + b.sy) / 2, ["#2C4A5C", "#4E7D8C"], 5, 16);
    };

    const covalesce = (a: AtomEnt, b: AtomEnt) => {
      if (!a.closed || !b.closed || a.retiringAt || b.retiringAt || areBonded(a, b)) return;
      const pair = pairingOf(a, b);
      if (!pair || appetiteOf(a) <= 0 || appetiteOf(b) <= 0) { rebuff(a, b); return; }
      bondBetween(a, b);
      const cb = covalentBond(a.seed, b.seed);
      // covalence: one solemn act, three senses in one frame — and the act
      // sounds like the bond it made. An even share rings a clean fifth; a
      // lopsided one leans flat; an outright transfer (a wide
      // electronegativity gap — sodium and chlorine, not carbon and hydrogen)
      // speaks two separate notes, because that is two ions and not one pair.
      try { audio().bell(); } catch { /* noop */ }
      try { (cb.character === "ionic" ? haptics.chop : haptics.bloom)(); } catch { /* noop */ }
      note(52 + cb.tone, 420);
      if (cb.character === "ionic") {
        noteLater(150, 52 + cb.tone + 11, 380);
        try { audio().chime(); } catch { /* noop */ }
      } else if (cb.character === "polar") {
        noteLater(170, 52 + cb.tone + 7 - Math.round(cb.polarity * 2), 300);
      } else {
        noteLater(170, 52 + cb.tone + 7, 300);
      }
      burst((a.sx + b.sx) / 2, (a.sy + b.sy) / 2, [
        ATOM_FAMILIES[a.morph.family][5],
        ATOM_FAMILIES[b.morph.family][5],
        "#F2EEE6",
      ], 18, 46);
      useField.getState().recordTape("sigil", 0.85, "atoms/covalence");
      save();
    };

    // ————— fusion: the kinetic verb (collision, not ceremony) —————

    /**
     * A deterministic seed whose element IS the fusion product: walk the
     * pair's hash chain until elementFromSeed lands on z. Pure — the same
     * parents always beget the same child.
     */
    const seedForElement = (sa: number, sb: number, z: number): number | null => {
      for (let k = 0; k < 120000; k++) {
        const s = hashSeed(Math.min(sa, sb), Math.max(sa, sb), 0xfa57, k);
        if (elementFromSeed(s).z === z) return s;
      }
      return null;
    };

    /** The radiating blast — the room's brightest moment, scaled by mag. */
    const blast = (x: number, y: number, mag: number, family: number) => {
      const minDim = Math.min(width, height);
      blasts.push({ x, y, born: performance.now(), maxR: minDim * (0.22 + 0.55 * mag), mag });
      if (blasts.length > 4) blasts.shift();
      if (!reduce) {
        // photon streaks radiating from the merged nucleus
        const n = 8 + Math.round(mag * 16);
        const fam = ATOM_FAMILIES[family as 0 | 1 | 2 | 3];
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + twinkleHash(i + n) * 0.5;
          specks.push({
            x, y,
            vx: Math.cos(ang) * (240 + mag * 320) * (0.6 + twinkleHash(i * 5 + 2) * 0.6),
            vy: Math.sin(ang) * (240 + mag * 320) * (0.6 + twinkleHash(i * 7 + 3) * 0.6),
            born: performance.now(),
            life: 700 + twinkleHash(i * 3 + 1) * 800,
            r: 1.4,
            color: i % 3 === 0 ? "#F7F3EA" : fam[5],
            streak: true,
          });
        }
        // the shockwave shoves the rest of the field outward
        const reach = minDim * (0.3 + mag * 0.4);
        for (const o of atoms) {
          if (o.retiringAt || o.sr <= 0) continue;
          const dx = o.sx - x;
          const dy = o.sy - y;
          const d = Math.hypot(dx, dy);
          if (d > 1 && d < reach) {
            const k = (1 - d / reach) * (26 + 90 * mag);
            o.pushX += (dx / d) * k;
            o.pushY += (dy / d) * k;
          }
        }
      }
      // the blast is layered from the organ's own one-shots
      try { audio().bell(); } catch { /* noop */ }
      try { audio().thud(); } catch { /* noop */ }
      if (mag > 0.35) { try { audio().spark(); } catch { /* noop */ } }
      note(30 + Math.round(mag * 6), 480);
      noteLater(120, 42 + Math.round(mag * 10), 300);
      try { (mag > 0.55 ? haptics.storm : haptics.bloom)(); } catch { /* noop */ }
    };

    // Past iron, fusion costs more than it pays. This is not a failure to
    // report but a wall to feel: the two nuclei are thrown back hard, the
    // whole field goes heavy and sags DOWNWARD — toward the band below,
    // where the only road past iron has ever run — and a merlot weight
    // gathers along the bottom edge until it fades. No word is said about it.
    const ironWall = (a: AtomEnt, b: AtomEnt) => {
      const dx = b.sx - a.sx;
      const dy = b.sy - a.sy;
      const d = Math.max(1, Math.hypot(dx, dy));
      // the elastic bounce: whatever closing speed remains is returned
      const closing = ((a.kvx - b.kvx) * dx + (a.kvy - b.kvy) * dy) / d;
      const k = Math.max(90, closing * 1.1);
      a.kvx -= (dx / d) * k;
      a.kvy -= (dy / d) * k;
      b.kvx += (dx / d) * k;
      b.kvy += (dy / d) * k;
      a.shudder = 1;
      b.shudder = 1;
      a.dim = Math.min(1, a.dim + 0.6);
      b.dim = Math.min(1, b.dim + 0.6);
      // the weight: everything in the field is pulled down for a breath
      ironward = 1;
      if (!reduce) {
        for (let i = 0; i < 10; i++) {
          const spread = (i / 10 - 0.5) * 90;
          specks.push({
            x: (a.sx + b.sx) / 2 + spread,
            y: (a.sy + b.sy) / 2,
            vx: spread * 0.6,
            vy: 130 + twinkleHash(i * 5 + 3) * 120,
            born: performance.now(),
            life: 1200,
            r: 1.2,
            color: i % 3 === 0 ? "#7A1F1F" : "#9C3D33",
            streak: true,
          });
        }
      }
      try { audio().refuse(); } catch { /* noop */ }
      try { audio().thud(); } catch { /* noop */ }
      note(26, 520);
      noteLater(180, 22, 640); // the second, lower word: the floor of the band
      try { haptics.storm(); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.6, "atoms/iron-wall");
    };

    const attemptFusion = (a: AtomEnt, b: AtomEnt) => {
      if (!a.closed || !b.closed || a.retiringAt || b.retiringAt) return;
      const now = performance.now();
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      const cool = fuseCooldown.get(key);
      if (cool && now - cool < 900) return;
      fuseCooldown.set(key, now);
      const za = a.morph.z;
      const zb = b.morph.z;
      if (!canFuse(za, zb)) { ironWall(a, b); return; }
      const product = fuseProduct(za, zb);
      const seed = product ? seedForElement(a.seed, b.seed, product.z) : null;
      if (!product || seed == null) { ironWall(a, b); return; }
      const energy = fusionEnergy(za, zb);
      const mag = blastMagnitude(energy);
      const mx = (a.sx + b.sx) / 2;
      const my = (a.sy + b.sy) / 2;
      // the two nuclei become one: bonds fall away with the reactants
      bonds = bonds.filter((q) => q.aId !== a.id && q.bId !== a.id && q.aId !== b.id && q.bId !== b.id);
      atoms = atoms.filter((q) => q !== a && q !== b);
      const p = makeAtom(seed, clamp01(mx / Math.max(1, width)), clamp(my / Math.max(1, height), 0.09, 0.92), 1);
      atoms.push(p);
      retireOldest();
      if (mag > 0) blast(mx, my, mag, p.morph.family);
      useField.getState().recordTape("sigil", Math.min(1, 0.7 + mag * 0.3), "atoms/fusion");
      save();
    };

    /** The nearest other closed atom to a — the keyboard throw's target. */
    const nearestAtomOther = (a: AtomEnt): AtomEnt | null => {
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const o of atoms) {
        if (o === a || o.retiringAt || !o.closed) continue;
        const d = Math.hypot(o.sx - a.sx, o.sy - a.sy);
        if (d < bestD) { bestD = d; best = o; }
      }
      return best;
    };

    /** The nearest closed atom roughly along a throw's direction. */
    const atomAlongCone = (from: AtomEnt, angle: number): AtomEnt | null => {
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const o of atoms) {
        if (o === from || o.retiringAt || !o.closed) continue;
        const dx = o.sx - from.sx;
        const dy = o.sy - from.sy;
        const d = Math.hypot(dx, dy);
        if (d < 1 || d > Math.min(width, height) * 0.55) continue;
        if ((dx * ux + dy * uy) / d < 0.86) continue; // ~30° cone
        if (d < bestD) { bestD = d; best = o; }
      }
      return best;
    };

    // §8c — still the field: electrons streak away, the clouds let go
    stillRef.current = () => {
      const now = performance.now();
      for (const a of atoms) {
        if (a.retiringAt) continue;
        a.retiringAt = now;
        if (!reduce && a.sr > 0) {
          const shed = Math.min(6, Math.max(2, a.morph.shells * 2));
          for (let i = 0; i < shed; i++) {
            const ang = (i / shed) * Math.PI * 2 + twinkleHash(a.seed + i) * 0.9;
            photonStreak(a, ang, 130 + twinkleHash(i + 5) * 90, ATOM_FAMILIES[a.morph.family][5]);
          }
        }
      }
      bonds = [];
      hints.clear();
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ atoms: [], bonds: [] })); } catch { /* noop */ }
      setHasAtoms(false);
      try { audio().thud(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
    };

    // the raised-lens marker ScaleTravel reads before a step-back nudge
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    // three-finger tap = tutti (grammar §5): one synchronized soft pulse —
    // every cloud brightens a breath and hums its own voice, quietly, and
    // the firmness of the three fingers is the brightness of the answer
    const tutti = (gain = 0.6) => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      tuttiPulse = 0.55 + gain * 0.45;
      atoms
        .filter((a) => !a.retiringAt && a.closed)
        .slice(0, 8)
        .forEach((a, i) => noteLater(i * 45, midiOf(a.morph), 55 + Math.round(gain * 40)));
      try { haptics.ripple(0.2 + gain * 0.3); } catch { /* noop */ }
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
            note(46, 160);
          }
          return;
        }
        if (e.fingers === 3) { tutti(clamp01(0.35 + e.intensity * 0.65)); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const { x, y } = toLocal(e.x, e.y);
        const a = nearestAtom(x, y);
        // rapid-tap ladder 1 / 3 / 5 / n — counts between tiers deepen intensity
        const trainTier = tapTrainTier(e.count);
        const trainBase = trainTier === "n" ? 7 : trainTier;
        const deepen = Math.min(1, (e.count - trainBase) * 0.5);
        const amp = clamp01(e.intensity * (0.75 + deepen * 0.55));
        if (trainTier === 1) {
          if (a) excite(a, amp);
          return;
        }
        if (trainTier === 3) {
          // three sharp taps IONIZE: the outermost electron is knocked clean
          // off — it streaks away, the cloud dims, and after a beat the
          // falling-home note says it was only borrowed. On open vacuum the
          // taps condense an atom instead.
          if (a) {
            const ang = twinkleHash(a.seed + e.count) * Math.PI * 2;
            photonStreak(a, ang, 200 + amp * 180, ATOM_FAMILIES[a.morph.family][5]);
            a.dim = Math.min(1, a.dim + 0.5 + deepen * 0.3);
            note(midiOf(a.morph) + 12, 90);
            noteLater(650, midiOf(a.morph) + 3, 220);
            try { haptics.detent(); } catch { /* noop */ }
            useField.getState().recordTape("ripple", 0.5 + deepen * 0.3, "atoms/ionize");
          } else {
            condense(x, y);
          }
          return;
        }
        if (trainTier === 5) {
          // five taps are PHOTOLYSIS: every bond the ceremony joined on this
          // atom lets go at once, the partners thrown back with the elastic
          // recoil of the share they lose. An unbonded cloud takes the whole
          // charge as stirred orbitals instead.
          if (!a) return;
          const mine = bonds.filter((b) => b.aId === a.id || b.bId === a.id);
          if (mine.length > 0) {
            bonds = bonds.filter((b) => b.aId !== a.id && b.bId !== a.id);
            const byId = new Map(atoms.map((q) => [q.id, q]));
            for (const b of mine) {
              const o = byId.get(b.aId === a.id ? b.bId : b.aId);
              if (!o) continue;
              const dx = o.sx - a.sx;
              const dy = o.sy - a.sy;
              const dd = Math.max(1, Math.hypot(dx, dy));
              const kick = 30 + deepen * 24;
              o.pushX += (dx / dd) * kick;
              o.pushY += (dy / dd) * kick;
              a.pushX -= (dx / dd) * kick;
              a.pushY -= (dy / dd) * kick;
              o.shudder = Math.min(1, o.shudder + 0.4);
            }
            a.shudder = 1;
            burst(a.sx, a.sy, [ATOM_FAMILIES[a.morph.family][5], "#F2EEE6"], 12, 46);
            try { audio().thud(); } catch { /* noop */ }
            note(midiOf(a.morph) - 7, 260);
            try { haptics.chop(); } catch { /* noop */ }
            save();
          } else {
            excite(a, 1);
            a.precessBoost = clamp(a.precessBoost + 0.8 + deepen * 0.8, -3, 3);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        // n: the CASCADE — every cloud in reach jumps in sequence, a spectral
        // avalanche that widens and brightens as the train runs on
        const reach = Math.min(width, height) * (0.4 + deepen * 0.25);
        const near = atoms.filter(
          (q) => !q.retiringAt && q.closed && Math.hypot(q.sx - x, q.sy - y) < reach,
        );
        near.forEach((q, i) => {
          window.setTimeout(() => excite(q, 0.5 + deepen * 0.5), i * 70);
        });
        stirOmega = clamp(stirOmega + 0.6 + deepen, -4, 4);
        try { audio().bell(); } catch { /* noop */ }
        try { haptics.bloom(); } catch { /* noop */ }
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // dilation deepens with the hold: 900ms and 2400ms are different
          // stillnesses, and the vacuum keeps slowing for as long as asked
          if (e.phase === "enter") { try { haptics.tap(); } catch { /* noop */ } note(34, 280); }
          if (e.phase === "release") { timeScaleTarget = 1; return; }
          timeScaleTarget = 1 - 0.85 * clamp01(e.elapsed / 2400);
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const a = atomAt(x, y);
          hold.atomId = a ? a.id : null;
          hold.partnerId = null;
          hold.onExisting = !!a;
          hold.seeded = false;
          hold.bonded = false;
          hold.gather = 0;
          hold.gx = x;
          hold.gy = y;
          return;
        }
        if (e.phase === "release") {
          const a = atoms.find((q) => q.id === hold.atomId);
          if (a) a.charge = 0;
          const p = atoms.find((q) => q.id === hold.partnerId);
          if (p) p.charge = 0;
          hold.atomId = null;
          hold.partnerId = null;
          hold.onExisting = false;
          gatherFade = hold.gather;
          hold.gather = 0;
          save();
          return;
        }
        // ticks (~80ms). On open vacuum the gathering is continuous from the
        // touch tier: probability visibly draws inward under the finger and
        // tightens until, at the dwell, it is an atom. The verb is watched,
        // not waited through — and it keeps deepening after it lands.
        if (!hold.onExisting) {
          hold.gx = x;
          hold.gy = y;
          hold.gather = hold.seeded
            ? Math.max(0, 1 - (e.elapsed - DWELL_MS) / 460) // it became the atom
            : clamp01((e.elapsed - TOUCH_MS) / (DWELL_MS - TOUCH_MS));
          const nowG = performance.now();
          if (!hold.seeded && hold.gather > 0 && hold.gather < 1 && nowG - lastGatherNoteAt > 150) {
            lastGatherNoteAt = nowG;
            note(60 + Math.round(hold.gather * 16), 70);
          }
        }
        if (hold.onExisting && hold.atomId) {
          const a = atoms.find((q) => q.id === hold.atomId);
          if (!a || a.retiringAt) return;
          const partner = covalentPartner(a);
          hold.partnerId = partner ? partner.id : null;
          if (!partner || !a.closed) {
            // no partner in reach: the cloud deepens under the hand — and
            // duration is an axis, so the longer the hold, the more the
            // orbitals stir and the lower its hum settles
            a.precessBoost = clamp(a.precessBoost + 0.025 * (1 + e.intensity * 0.5), -3, 3);
            const now = performance.now();
            if (now - lastDeepenNoteAt > 800) {
              lastDeepenNoteAt = now;
              note(midiOf(a.morph) - Math.min(7, Math.round(e.elapsed / 900)), 130);
              try { haptics.tap(); } catch { /* noop */ }
            }
            return;
          }
          // the road to the ceremony: lobes reach, ticks rise
          a.charge = clamp01((e.elapsed - 900) / 1600);
          partner.charge = a.charge;
          const d = Math.hypot(partner.sx - a.sx, partner.sy - a.sy);
          if (d > (a.sr + partner.sr) * 0.8) {
            const k = 10 * a.charge + 3;
            a.pushX += ((partner.sx - a.sx) / d) * k;
            a.pushY += ((partner.sy - a.sy) / d) * k;
            partner.pushX += ((a.sx - partner.sx) / d) * k;
            partner.pushY += ((a.sy - partner.sy) / d) * k;
          }
          const now = performance.now();
          if (a.charge > 0 && now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(midiOf(a.morph) + Math.round(a.charge * 9), 90);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3 && !hold.bonded) {
            hold.bonded = true;
            hold.atomId = null;
            hold.partnerId = null;
            covalesce(a, partner);
            a.charge = 0;
            partner.charge = 0;
          }
        } else if (hold.atomId) {
          // an atom this hand just condensed — keep holding, it keeps
          // gathering: the cloud fills, and past its closing the hand keeps
          // pouring in, stirring the orbitals and exciting it further
          const a = atoms.find((q) => q.id === hold.atomId);
          if (!a) return;
          if (!a.closed) {
            growAtom(a, 0.0011 * 80 * (1 + e.intensity * 0.6));
          } else {
            a.precessBoost = clamp(a.precessBoost + 0.02 * (1 + e.intensity * 0.5), -3, 3);
            const now = performance.now();
            if (now - lastDeepenNoteAt > 600) {
              lastDeepenNoteAt = now;
              note(midiOf(a.morph) + Math.min(9, Math.round((e.elapsed - 900) / 400)), 100);
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
        } else if (e.tier >= 2 && !hold.seeded && !hold.onExisting && !hold.bonded) {
          // dwell on open space: condense — long-press means grow, everywhere
          hold.seeded = true;
          const a = condense(x, y);
          if (a) hold.atomId = a.id;
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
            note(36 + Math.round(mag * 5), 260);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "end") {
          sweepStrength = 0;
          return;
        }
        // one finger sweeps the field — probability leans toward the hand,
        // and a cloud under the finger rides it (the slow road to fusion:
        // dilate time with three fingers, then drive one atom into another)
        sweepX = x;
        sweepY = y;
        sweepStrength = Math.min(1, sweepStrength + 0.2);
        for (const a of atoms) {
          if (a.retiringAt || !a.closed || a.sr <= 0) continue;
          if (Math.hypot(x - a.sx, y - a.sy) < Math.max(48, a.sr * 1.1)) {
            a.kvx = clamp(a.kvx + e.vx * 3.2, -520, 520);
            a.kvy = clamp(a.kvy + e.vy * 3.2, -520, 520);
          }
        }
        const now = performance.now();
        if (now - lastSweepSoundAt > 300) {
          lastSweepSoundAt = now;
          note(70 + Math.round(twinkleHash(Math.floor(now / 300)) * 4), 70);
          try { haptics.ripple(0.15); } catch { /* noop */ }
        }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        // a flick THROWS the cloud along the hand's vector — the fusion
        // road — and ionizes as it goes: the shed electron streaks off
        // behind the hurled nucleus, and after a beat it falls home
        const { x, y } = toLocal(e.x, e.y);
        const a = nearestAtom(x, y);
        if (!a) return;
        const speed = clamp(e.speed, 0.6, 2.4);
        a.kvx = clamp(a.kvx + Math.cos(e.angle) * 220 * speed, -520, 520);
        a.kvy = clamp(a.kvy + Math.sin(e.angle) * 220 * speed, -520, 520);
        photonStreak(a, e.angle + Math.PI, 220 * speed, ATOM_FAMILIES[a.morph.family][5]);
        a.dim = Math.min(1, a.dim + 0.6);
        note(midiOf(a.morph) + 12, 90);
        noteLater(650, midiOf(a.morph) + 3, 220);
        try { haptics.ripple(0.4); } catch { /* noop */ }
        if (reduce) {
          // stillness never removes a verb: the throw resolves directly
          const b = atomAlongCone(a, e.angle);
          if (b) attemptFusion(a, b);
        }
      },
      twist: (e) => {
        if (e.fingers === 3) {
          // three fingers turn the season: the vacuum cools toward a still,
          // cold field or warms toward the inside of a star, where clouds
          // stir fast and electrons jump without being asked
          if (e.phase !== "move") return;
          lastInteractionAt = performance.now();
          season = (season - e.angle / (Math.PI * 2) + 1) % 1;
          const now = performance.now();
          if (now - seasonSpokenAt > 260) {
            seasonSpokenAt = now;
            const heat = 0.5 - 0.5 * Math.cos(season * Math.PI * 2);
            note(34 + Math.round(heat * 24), 200);
            try { haptics.detent(); } catch { /* noop */ }
          }
          return;
        }
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: felt cloud ↔ orbital diagram
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            markLens(snapped === 1);
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(46, 160);
          }
          lensTarget = snapped;
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        // orbital stirring: the lobes precess with the winding
        stirOmega = clamp(stirOmega + e.angularVelocity * 0.15, -4, 4);
        for (const a of atoms) a.precessBoost = clamp(a.precessBoost + e.angularVelocity * 0.1, -3, 3);
        const now = performance.now();
        if (now - lastScrubAt > 600) {
          lastScrubAt = now;
          note(72 + Math.round(Math.abs(e.winding)), 90);
          try { haptics.ripple(0.3); } catch { /* noop */ }
        }
      },
      rhythm: (e) => {
        lastInteractionAt = performance.now();
        // a steady hand entrains the vacuum: while the tempo holds, the
        // clouds take turns jumping a shell ON the beat — the steadier the
        // taps, the longer the pulse outlives them
        if (e.stability < 0.55 || e.bpm < 40 || e.bpm > 220) return;
        const wasSilent = performance.now() > pulseUntil;
        pulseBpm = e.bpm;
        pulseUntil = performance.now() + 6000 + e.stability * 10000;
        if (wasSilent) {
          note(58, 140);
          try { haptics.tap(); } catch { /* noop */ }
        }
      },
    });

    // ————— the vessel: the device is the vacuum's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = the clouds lean with real gravity; shake = a mass
    // excitation — several electrons jump at once, ring flashes and all.
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) { tiltLeanX = 0; tiltLeanY = 0; return; }
        tiltLeanX = clamp(gamma / 28, -1, 1);
        tiltLeanY = clamp((beta - 35) / 28, -1, 1); // rest angle ≈ a held phone
        const mag = Math.hypot(tiltLeanX, tiltLeanY);
        const now = performance.now();
        if (mag > 0.55 && now - lastTiltSoundAt > 1400) {
          lastTiltSoundAt = now;
          note(36 + Math.round(mag * 4), 220); // the field's low leaning word
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // mass excitation: the whole field jumps a shell together
        for (const a of atoms) {
          if (!a.retiringAt && a.closed) excite(a, 0.4 + intensity * 0.6);
        }
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        const now = performance.now();
        if (now - lastKnockAt < 350) return;
        lastKnockAt = now;
        lastInteractionAt = now;
        // a knock on the case is a knock on the room's door: the whole field
        // answers at once, and the nearest cloud sheds a photon toward it
        tutti();
        tuttiPulse = Math.max(tuttiPulse, 0.7 + intensity * 0.3);
        note(30 + Math.round(intensity * 8), 200);
        const a = atoms.find((q) => !q.retiringAt && q.closed);
        if (a && !reduce) {
          photonStreak(a, twinkleHash(now) * Math.PI * 2, 150 + intensity * 140, "#F2C56B");
        }
        try { (intensity > 0.6 ? haptics.chop : haptics.tap)(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        const want = faceDown ? 1 : 0;
        if (nightTarget === want) return;
        nightTarget = want;
        lastInteractionAt = performance.now();
        // night: the clouds keep their watch under the dark
        if (faceDown) {
          note(28, 620);
          try { haptics.roll(); } catch { /* noop */ }
        } else {
          note(52, 240);
          noteLater(140, 64, 200);
          try { haptics.ripple(0.35); } catch { /* noop */ }
        }
        useField.getState().recordTape("object", faceDown ? 0.2 : 0.45, "atoms/night");
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
      if ((ev.key === "Enter" || ev.key === " ") && ev.shiftKey) {
        // the keyboard's throw: shift-enter hurls the atom under the cursor
        // at its nearest neighbor — fusion or the iron wall, same physics
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (ev.repeat) return;
        if (!cursorVisible) { cursorVisible = true; return; }
        const a = atomAt(cursorNx * width, cursorNy * height);
        if (!a || !a.closed) return;
        const b = nearestAtomOther(a);
        if (b) attemptFusion(a, b);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!cursorVisible) { cursorVisible = true; return; }
        const x = cursorNx * width;
        const y = cursorNy * height;
        const a = atomAt(x, y);
        if (a && a.closed) {
          const partner = covalentPartner(a);
          if (partner) {
            // held Enter repeats — the keyboard's ceremony
            if (kbAtomId !== a.id) { kbAtomId = a.id; kbCharge = 0; }
            kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
            a.charge = kbCharge;
            partner.charge = kbCharge;
            const now = performance.now();
            if (now - lastChargeNoteAt > 340) {
              lastChargeNoteAt = now;
              note(midiOf(a.morph) + Math.round(kbCharge * 9), 90);
            }
            if (kbCharge >= 1) {
              kbCharge = 0;
              kbAtomId = null;
              covalesce(a, partner);
              a.charge = 0;
              partner.charge = 0;
            }
          } else if (!ev.repeat) {
            excite(a, 0.6);
          }
        } else if (!ev.repeat) {
          const seeded = condense(x, y);
          if (seeded) growAtom(seeded, 0.05);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const a = atoms.find((q) => q.id === kbAtomId);
        if (a) {
          a.charge = 0;
          const partner = covalentPartner(a);
          if (partner) partner.charge = 0;
        }
        kbCharge = 0;
        kbAtomId = null;
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
    const shellRadius = (R: number, ring: number, shells: number) =>
      R * (0.34 + 0.66 * (ring / Math.max(shells + 1, 4)));

    const drawAtom = (a: AtomEnt, t: number, breath: number) => {
      const morph = a.morph;
      const fam = ATOM_FAMILIES[morph.family];
      const minDim = Math.min(width, height);
      const grow = a.growth < 1 ? 0.2 + 0.8 * a.growth : 1;
      let fade = 1;
      let retireScale = 1;
      if (a.retiringAt) {
        const e = clamp01((performance.now() - a.retiringAt) / RETIRE_MS);
        fade = 1 - e;
        retireScale = 1 + e * 0.3; // an atom disperses outward, not inward
      }
      const breathScale = reduce ? 1 : 1 + Math.sin(breath + morph.breathOffset) * 0.035;
      const R = minDim * morph.radius * grow * breathScale * retireScale;
      if (R < 1) return;
      const cx = a.nx * width;
      const cy = a.ny * height;
      a.sx = cx;
      a.sy = cy;
      a.sr = R;

      const dimK = 1 - a.dim * 0.55;
      const feltAlpha = (1 - lens) * fade * dimK;
      const lensAlpha = lens * fade;
      const precession = a.precessPhase + (reduce ? 0 : t * (morph.precess + a.precessBoost + stirOmega * 0.3));
      // the vessel's gravity: every cloud leans downhill together
      let leanX = reduce ? 0 : tiltLeanX * R * 0.2;
      let leanY = reduce ? 0 : tiltLeanY * R * 0.2;
      // field sweep: the cloud leans toward the finger
      if (sweepStrength > 0.01) {
        const dx = sweepX - cx;
        const dy = sweepY - cy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const reach = minDim * 0.5;
        const k = Math.max(0, 1 - d / reach) * sweepStrength;
        leanX += (dx / d) * R * 0.22 * k;
        leanY += (dy / d) * R * 0.22 * k;
      }

      ctx.save();
      // nuclear strain: the shudder of a refused fusion (stillness keeps
      // only the dimming — the tremor is motion, and motion is honored)
      const tremor = !reduce && a.shudder > 0.02 ? a.shudder * R * 0.05 : 0;
      ctx.translate(
        cx + (tremor ? Math.sin(performance.now() * 0.09 + a.precessPhase) * tremor : 0),
        cy + (tremor ? Math.cos(performance.now() * 0.11 + a.precessPhase) * tremor : 0),
      );

      // the covalence ceremony: a warm halo tightens as lobes reach
      if (a.charge > 0) {
        stamp(HALO_SPRITE, 0, 0, R * (2 - a.charge * 0.6), 0.3 * a.charge * fade);
      }

      // — felt pass: probability as translucent light —
      if (feltAlpha > 0.02) {
        // the whole cloud: a soft envelope (baked sprite, not a per-frame
        // gradient — this loop runs once per atom per frame)
        stamp(CLOUD_SPRITES[morph.family], leanX * 0.5, leanY * 0.5, R * 1.1, feltAlpha * grow);

        // orbital lobes — translucent fields with the seed's symmetry
        const lobeR = R * 0.62;
        for (let i = 0; i < morph.lobes; i++) {
          const ang = morph.lobeTilt + precession + (i / morph.lobes) * Math.PI * 2;
          const hum = reduce ? 0 : Math.sin(t * Math.PI * 2 * morph.hum.rateHz + i * 1.9) * morph.hum.amp;
          const lx = Math.cos(ang) * lobeR * 0.62 + leanX;
          const ly = Math.sin(ang) * lobeR * 0.62 + leanY;
          const lr = lobeR * (0.55 + hum * 3);
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(ang);
          ctx.scale(1, 0.55);
          stamp(LOBE_SPRITES[morph.family], 0, 0, lr, feltAlpha);
          ctx.restore();
        }

        // shell rings — faint circles of standing probability
        for (let ringI = 1; ringI <= morph.shells; ringI++) {
          const rr = shellRadius(R, ringI, morph.shells);
          ctx.strokeStyle = colorAlpha(fam[Math.min(5, 2 + ringI)], 0.16 * feltAlpha);
          ctx.lineWidth = Math.max(0.6, R * 0.008);
          ctx.beginPath();
          ctx.arc(leanX * (ringI / morph.shells) * 0.5, leanY * (ringI / morph.shells) * 0.5, rr, 0, Math.PI * 2);
          ctx.stroke();
          // electrons on this shell, small pearls on their round
          const count = morph.electrons[ringI - 1];
          const shown = Math.min(count, 8);
          for (let k = 0; k < shown; k++) {
            const ea = precession * (ringI % 2 === 0 ? -1.3 : 1) + (k / shown) * Math.PI * 2 + ringI * 0.7;
            const ex = Math.cos(ea) * rr + leanX * (ringI / morph.shells) * 0.5;
            const ey = Math.sin(ea) * rr + leanY * (ringI / morph.shells) * 0.5;
            ctx.fillStyle = colorAlpha(fam[5], 0.5 * feltAlpha);
            ctx.beginPath();
            ctx.arc(ex, ey, Math.max(0.8, R * 0.016), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // excitation: the jumped ring flashes; decay throws a photon
        if (a.excite) {
          const age = (performance.now() - a.excite.born) / EXCITE_MS;
          if (age < 1) {
            const rr = shellRadius(R, a.excite.ring, morph.shells);
            const flash = age < 0.3 ? age / 0.3 : 1 - (age - 0.3) / 0.7;
            ctx.strokeStyle = colorAlpha("#F2C56B", 0.55 * flash * feltAlpha);
            ctx.lineWidth = Math.max(1, R * 0.02);
            ctx.beginPath();
            ctx.arc(0, 0, rr, 0, Math.PI * 2);
            ctx.stroke();
            // the traveling electron, one bright pearl on the high ring
            const ea = precession * 2 + age * Math.PI * 3;
            ctx.fillStyle = colorAlpha("#F7F3EA", 0.85 * flash * feltAlpha);
            ctx.beginPath();
            ctx.arc(Math.cos(ea) * rr, Math.sin(ea) * rr, Math.max(1.2, R * 0.022), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // nucleus — the one bright certainty
        const nR = R * morph.nucleus * (1 + (reduce ? 0 : Math.sin(breath * 2 + morph.breathOffset) * 0.08));
        stamp(NUCLEUS_SPRITES[morph.family], 0, 0, nR * 3, feltAlpha);
      }

      // — lens pass: the orbital diagram, the same atom as measure —
      if (lensAlpha > 0.02) {
        const ink = morph.family === 1 ? "#B25048" : "#DDD3BE";
        // shells as thin measured rings
        for (let ringI = 1; ringI <= morph.shells; ringI++) {
          const rr = shellRadius(R, ringI, morph.shells);
          ctx.setLineDash(ringI === morph.shells ? [] : [3, 4]);
          ctx.strokeStyle = colorAlpha(ink, 0.6 * lensAlpha);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(0, 0, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // energy levels as rungs, a ladder standing beside the cloud —
        // spacing tightens as the levels climb, the way energy does
        const lx = R * 1.18;
        const rungW = R * 0.3;
        for (let ringI = 1; ringI <= MAX_RING; ringI++) {
          const frac = 1 - 1 / (ringI + 0.6);
          const ry = R * 0.7 - frac * R * 1.35;
          const occupied = ringI <= morph.shells;
          const excitedHere = a.excite && !a.excite.decayed && a.excite.ring === ringI
            && (performance.now() - a.excite.born) / EXCITE_MS < 1;
          ctx.strokeStyle = colorAlpha(
            excitedHere ? "#F2C56B" : ink,
            (occupied ? 0.75 : 0.28) * lensAlpha * (excitedHere ? 1 : 1),
          );
          ctx.lineWidth = occupied ? 1.4 : 0.7;
          ctx.beginPath();
          ctx.moveTo(lx, ry);
          ctx.lineTo(lx + rungW, ry);
          ctx.stroke();
          if (occupied) {
            // occupancy pips, up to four per rung
            const pips = Math.min(4, morph.electrons[ringI - 1]);
            for (let p = 0; p < pips; p++) {
              ctx.fillStyle = colorAlpha(ink, 0.7 * lensAlpha);
              ctx.beginPath();
              ctx.arc(lx + rungW * ((p + 1) / (pips + 1)), ry - R * 0.035, R * 0.014, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        // the nucleus as a small measured cross
        ctx.strokeStyle = colorAlpha(ink, 0.8 * lensAlpha);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-R * 0.05, 0);
        ctx.lineTo(R * 0.05, 0);
        ctx.moveTo(0, -R * 0.05);
        ctx.lineTo(0, R * 0.05);
        ctx.stroke();
        // the element's name in the measured register — symbol and Z, thin
        // mono; the lens is the one lettered surface of this band
        const symSize = Math.max(10, Math.round(R * 0.18));
        ctx.font = `300 ${symSize}px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = colorAlpha(ink, 0.85 * lensAlpha);
        ctx.fillText(morph.symbol, -R * 1.16, -R * 0.86);
        ctx.font = `300 ${Math.max(8, Math.round(symSize * 0.7))}px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillStyle = colorAlpha(ink, 0.5 * lensAlpha);
        ctx.fillText(String(morph.z), -R * 1.16, -R * 0.86 + symSize * 0.85);
      }

      ctx.restore();
    };

    const drawBonds = (t: number) => {
      const byId = new Map(atoms.map((a) => [a.id, a]));
      for (const b of bonds) {
        const pa = byId.get(b.aId);
        const pb = byId.get(b.bId);
        if (!pa || !pb || pa.retiringAt || pb.retiringAt) continue;
        if (pa.sr <= 0 || pb.sr <= 0) continue; // not drawn yet: no geometry to shine between
        const cb = covalentBond(pa.seed, pb.seed);
        const midX = (pa.sx + pb.sx) / 2;
        const midY = (pa.sy + pb.sy) / 2;
        const d = Math.max(1, Math.hypot(pb.sx - pa.sx, pb.sy - pa.sy));
        const ux = (pb.sx - pa.sx) / d;
        const uy = (pb.sy - pa.sy) / d;
        // strand offsets: bond order drawn honestly — H–H one strand,
        // O=O two, N≡N three (the kernel's covalentPair decided b.order)
        const strandOffs = b.order === 1 ? [0] : b.order === 2 ? [-1, 1] : [-1.6, 0, 1.6];
        const feltAlpha = 1 - lens;
        // where the shared pair actually sits: the more electronegative atom
        // holds it closer, and an ionic gap holds it outright. This is the
        // one place the table's electronegativity column is visible.
        const ea = elementOf(pa.morph.z);
        const eb = elementOf(pb.morph.z);
        const pol = ea && eb ? bondPolarity(ea, eb) : 0; // + = pb pulls harder
        const bias = Math.max(-0.42, Math.min(0.42, pol * 0.45));
        const shareX = midX + ux * d * bias;
        const shareY = midY + uy * d * bias;
        if (feltAlpha > 0.02) {
          // merged lobes: a shared luminous field between the pair, pooled
          // toward whichever end takes the harder pull
          const g = ctx.createRadialGradient(shareX, shareY, 2, shareX, shareY, d * 0.55);
          const fa = ATOM_FAMILIES[(pol > 0 ? pb : pa).morph.family][4];
          g.addColorStop(0, colorAlpha(fa, 0.14 * cb.gleam * feltAlpha));
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.save();
          ctx.translate(shareX, shareY);
          ctx.rotate(Math.atan2(pb.sy - pa.sy, pb.sx - pa.sx));
          const pulse = reduce ? 1 : 1 + Math.sin(t * 1.7 + cb.tone) * 0.12;
          ctx.beginPath();
          ctx.ellipse(
            0, 0,
            d * (0.52 - Math.abs(bias) * 0.5) * pulse,
            Math.min(pa.sr, pb.sr) * 0.5 * pulse,
            0, 0, Math.PI * 2,
          );
          ctx.fillStyle = g;
          ctx.fill();
          ctx.restore();
          if (cb.character === "ionic") {
            // a transfer, not a share: the two ends carry opposite signs —
            // one ring bright and closed, the other open and hollow
            const giver = pol > 0 ? pa : pb;
            const taker = pol > 0 ? pb : pa;
            ctx.strokeStyle = colorAlpha("#E7AC52", 0.3 * feltAlpha);
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.arc(giver.sx, giver.sy, giver.sr * 0.72, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = colorAlpha("#6997A4", 0.4 * feltAlpha);
            ctx.beginPath();
            ctx.arc(taker.sx, taker.sy, taker.sr * 0.62, 0, Math.PI * 2);
            ctx.stroke();
          }
          // the luminous strands of the shared pair(s)
          const spacing = Math.max(2.2, Math.min(pa.sr, pb.sr) * 0.12);
          const x1 = pa.sx + ux * pa.sr * 0.5;
          const y1 = pa.sy + uy * pa.sr * 0.5;
          const x2 = pb.sx - ux * pb.sr * 0.5;
          const y2 = pb.sy - uy * pb.sr * 0.5;
          const glowPulse2 = reduce ? 0.85 : 0.75 + Math.sin(t * 1.7 + cb.tone) * 0.25;
          ctx.lineCap = "round";
          for (const o of strandOffs) {
            const ox = -uy * o * spacing;
            const oy = ux * o * spacing;
            ctx.strokeStyle = colorAlpha(ATOM_FAMILIES[pa.morph.family][5], 0.24 * feltAlpha * glowPulse2);
            ctx.lineWidth = Math.max(1, Math.min(pa.sr, pb.sr) * 0.045);
            ctx.beginPath();
            ctx.moveTo(x1 + ox, y1 + oy);
            ctx.lineTo(x2 + ox, y2 + oy);
            ctx.stroke();
          }
        }
        if (lens > 0.02) {
          // the diagram draws covalence as the true count of measured lines
          const off = 2.4;
          ctx.strokeStyle = colorAlpha("#DDD3BE", 0.55 * lens);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (const o of strandOffs) {
            const ox = -uy * o * off;
            const oy = ux * o * off;
            ctx.moveTo(pa.sx + ox, pa.sy + oy);
            ctx.lineTo(pb.sx + ox, pb.sy + oy);
          }
          ctx.stroke();
        }
      }
    };

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      // unwatched, the vacuum keeps its own counsel and costs nothing
      if (sleeping || paused) { last = now; return; }
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      // the governor owns the drawing-buffer size too: a field that starts
      // costing frames redraws itself smaller rather than dropping them
      if (tier !== lastTier) { lastTier = tier; resize(); }
      const detail = detailForTier(tier);
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
      sweepStrength *= Math.exp(-dt * 2.2);
      stirOmega *= Math.exp(-dt * 0.8);
      tuttiPulse *= Math.exp(-dt * 2.4);
      night += (nightTarget - night) * Math.min(1, dt * 1.6);
      gatherFade = Math.max(0, gatherFade - dt * 2.2);
      ironward = Math.max(0, ironward - dt * 0.42);
      const heat = 0.5 - 0.5 * Math.cos(season * Math.PI * 2);
      // the vessel's lean joins the field wind: the vacuum drifts downhill,
      // and after an iron refusal the whole field sags toward the band below
      const gravX = windX + tiltLeanX * 0.5;
      const gravY = windY + tiltLeanY * 0.5 + ironward * 0.85;

      // the entrained pulse: while the hand's tempo holds, the clouds take
      // turns jumping a shell on the visitor's own beat
      if (pulseBpm > 0 && now < pulseUntil && now - lastPulseAt > 60000 / pulseBpm) {
        lastPulseAt = now;
        const live = atoms.filter((a) => !a.retiringAt && a.closed);
        if (live.length > 0) {
          pulseIdx = (pulseIdx + 1) % live.length;
          excite(live[pulseIdx], 0.35);
        }
      }

      // the furnace season: hot enough and electrons jump unbidden — the room
      // is alive at rest, and the season says how alive
      if (!reduce && heat > 0.4 && now - spontaneousAt > 2600 - heat * 1600) {
        spontaneousAt = now;
        const live = atoms.filter((a) => !a.retiringAt && a.closed);
        if (live.length > 0) {
          const pick = live[Math.floor(twinkleHash(Math.floor(now / 97)) * live.length) % live.length];
          excite(pick, 0.25 + heat * 0.5);
        }
      }

      // deferred notes (the ionized electron falling home)
      for (let i = pendingNotes.length - 1; i >= 0; i--) {
        if (now >= pendingNotes[i].at) {
          note(pendingNotes[i].midi, pendingNotes[i].ms);
          pendingNotes.splice(i, 1);
        }
      }

      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;

      // atoms: growth, excitation decay, drift, bonds as soft springs
      const byId = new Map(atoms.map((a) => [a.id, a]));
      for (const b of bonds) {
        const pa = byId.get(b.aId);
        const pb = byId.get(b.bId);
        if (!pa || !pb || pa.retiringAt || pb.retiringAt) continue;
        if (pa.sr <= 0 || pb.sr <= 0) continue; // not drawn yet: no geometry to spring against
        const rest = (pa.sr + pb.sr) * b.restK; // kernel radii, order-tightened
        const dx = pb.sx - pa.sx;
        const dy = pb.sy - pa.sy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const err = (d - rest) / Math.max(1, rest);
        const k = err * 16;
        pa.pushX += (dx / d) * k;
        pa.pushY += (dy / d) * k;
        pb.pushX -= (dx / d) * k;
        pb.pushY -= (dy / d) * k;
      }
      for (let i = atoms.length - 1; i >= 0; i--) {
        const a = atoms[i];
        if (a.retiringAt && now - a.retiringAt > RETIRE_MS) { atoms.splice(i, 1); dirty = true; continue; }
        if (!a.closed) growAtom(a, dt * 0.45);
        a.dim = Math.max(0, a.dim - dt * 0.9);
        a.shudder *= Math.exp(-dt * 2.4);
        a.kvx *= Math.exp(-dt * 0.7);
        a.kvy *= Math.exp(-dt * 0.7);
        a.precessBoost *= Math.exp(-dt * 0.8);
        if (!hold.atomId || hold.atomId !== a.id) {
          if (kbAtomId !== a.id && hold.partnerId !== a.id) a.charge = Math.max(0, a.charge - dt * 1.6);
        }
        // excitation decays back after a beat: falling note + photon streak
        if (a.excite && !a.excite.decayed && now - a.excite.born >= EXCITE_MS * 0.72) {
          a.excite.decayed = true;
          const jump = a.excite.ring - a.morph.shells;
          note(midiOf(a.morph) - 2, 200);
          const ang = twinkleHash(a.seed + Math.floor(now / 100)) * Math.PI * 2;
          photonStreak(a, ang, 150 + jump * 60, "#F2C56B");
          try { haptics.tap(); } catch { /* noop */ }
        }
        if (a.excite && now - a.excite.born > EXCITE_MS) a.excite = null;
        if (!reduce) {
          const d = a.morph.drift;
          const wx = Math.sin(localT * d.rate + d.ax) * 0.0028;
          const wy = Math.cos(localT * d.rate * 0.8 + d.ay) * 0.0024;
          const vx = wx + (a.pushX + a.kvx + gravX * 26) / Math.max(1, width);
          const vy = wy + (a.pushY + a.kvy + gravY * 26) / Math.max(1, height);
          a.nx = clamp(a.nx + vx * dt * timeScale, 0.08, 0.92);
          a.ny = clamp(a.ny + vy * dt * timeScale, 0.09, 0.92);
          a.pushX *= Math.exp(-dt * 2.2);
          a.pushY *= Math.exp(-dt * 2.2);
        }
      }

      // fusion — the kinetic verb: two nuclei DRIVEN together hard enough
      // merge (or, past iron, strain and refuse). Closing speed is read from
      // the undilated impulses, so time dilation aids aim without a penalty.
      let fused = false;
      for (let i = 0; i < atoms.length && !fused; i++) {
        const a = atoms[i];
        if (a.retiringAt || !a.closed || a.sr <= 0) continue;
        for (let j = i + 1; j < atoms.length; j++) {
          const b = atoms[j];
          if (b.retiringAt || !b.closed || b.sr <= 0 || areBonded(a, b)) continue;
          const dx = b.sx - a.sx;
          const dy = b.sy - a.sy;
          const d = Math.hypot(dx, dy);
          if (d < 1 || d > (a.sr + b.sr) * 0.55) continue;
          const closing =
            ((a.kvx + a.pushX - b.kvx - b.pushX) * dx + (a.kvy + a.pushY - b.kvy - b.pushY) * dy) / d;
          if (closing > 110) { attemptFusion(a, b); fused = true; break; }
        }
      }

      // the bond-hint: when two compatible atoms drift near, the room
      // proposes the pair-ceremony — a dashed arc after a beat, never text
      const hintSeen = new Set<string>();
      for (let i = 0; i < atoms.length; i++) {
        const a = atoms[i];
        if (a.retiringAt || !a.closed || a.sr <= 0) continue;
        for (let j = i + 1; j < atoms.length; j++) {
          const b = atoms[j];
          if (b.retiringAt || !b.closed || b.sr <= 0 || areBonded(a, b)) continue;
          const d = Math.hypot(b.sx - a.sx, b.sy - a.sy);
          if (d > (a.sr + b.sr) * 2.0 || d < (a.sr + b.sr) * 0.55) continue;
          if (!pairingOf(a, b) || appetiteOf(a) <= 0 || appetiteOf(b) <= 0) continue;
          const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          hintSeen.add(key);
          if (!hints.has(key)) hints.set(key, { aId: a.id, bId: b.id, since: now, alpha: 0 });
        }
      }
      for (const [key, h] of hints) {
        if (!hintSeen.has(key)) {
          h.alpha = Math.max(0, h.alpha - dt * 1.8); // fades as they part
          if (h.alpha <= 0) hints.delete(key);
        } else if (now - h.since > 900) {
          h.alpha = Math.min(1, h.alpha + dt * 1.2); // glimmers after a beat
        }
      }

      // background — the vacuum after dark; the lens deepens it to slate
      const bgTop = mixHex("#0a0c11", "#111319", lens);
      const bgMid = mixHex("#0c0e14", "#151721", lens);
      const bgLow = mixHex("#0e0f13", "#13141c", lens);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, bgTop);
      bg.addColorStop(0.55, bgMid);
      bg.addColorStop(1, bgLow);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // the candle far above the vacuum: a faint warm presence
      const glowPulse = reduce ? 0.05 : 0.045 + Math.sin(breath) * 0.02;
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.4, 10, width * 0.5, height * 0.4, Math.max(width, height) * 0.8);
      glow.addColorStop(0, `rgba(231, 172, 82, ${glowPulse + lens * 0.03})`);
      glow.addColorStop(0.55, "rgba(200, 115, 42, 0.028)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // the season's warmth, and the weight of an iron refusal pooling along
      // the bottom edge — the direction the field is telling the hand to go
      if (heat > 0.01) {
        ctx.fillStyle = `rgba(200, 115, 42, ${0.02 + heat * 0.06})`;
        ctx.fillRect(0, 0, width, height);
      }
      if (ironward > 0.004) {
        const sink = ctx.createLinearGradient(0, height * (0.55 - ironward * 0.15), 0, height);
        sink.addColorStop(0, "rgba(0,0,0,0)");
        sink.addColorStop(1, `rgba(122, 31, 31, ${0.34 * ironward})`);
        ctx.fillStyle = sink;
        ctx.fillRect(0, 0, width, height);
      }

      // vacuum motes — the faint noise floor of the field
      ctx.save();
      ctx.globalCompositeOperation = lens > 0.5 ? "source-over" : "screen";
      const moteShown = Math.max(10, Math.round(motes.length * detail.particles));
      for (let i = 0; i < moteShown; i++) {
        const m = motes[i];
        if (!reduce) {
          const jx = Math.sin(localT * (0.8 + twinkleHash(i + 53) * 1.4) + twinkleHash(i + 11) * 6.28) * 4;
          const jy = Math.cos(localT * (0.7 + twinkleHash(i + 97) * 1.5) + twinkleHash(i + 5) * 6.28) * 4;
          m.vx += (jx - m.vx) * dt * 2 + gravX * 110 * dt;
          m.vy += (jy - m.vy) * dt * 2 + gravY * 110 * dt;
          m.x += m.vx * dt * timeScale;
          m.y += m.vy * dt * timeScale;
          m.vx *= Math.exp(-dt * 1.1);
          m.vy *= Math.exp(-dt * 1.1);
          if (m.x < -8) m.x += width + 16;
          if (m.x > width + 8) m.x -= width + 16;
          if (m.y < -8) m.y += height + 16;
          if (m.y > height + 8) m.y -= height + 16;
        }
        const tw = reduce ? 0.1 : 0.06 + Math.sin(localT * 0.6 + i) * 0.05;
        ctx.fillStyle = colorAlpha(i % 7 === 0 ? "#E7AC52" : "#CFC2A6", Math.max(0.02, tw));
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.4 + twinkleHash(i + 411) * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // bonds beneath, then atoms by size (small behind, large in front)
      drawBonds(localT);

      // bond-hint glimmer — a faint dashed arc breathing between the pair
      for (const h of hints.values()) {
        if (h.alpha <= 0.02) continue;
        const pa = atoms.find((q) => q.id === h.aId);
        const pb = atoms.find((q) => q.id === h.bId);
        if (!pa || !pb || pa.retiringAt || pb.retiringAt || pa.sr <= 0 || pb.sr <= 0) continue;
        const dx = pb.sx - pa.sx;
        const dy = pb.sy - pa.sy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / d;
        const uy = dy / d;
        const x1 = pa.sx + ux * pa.sr * 0.8;
        const y1 = pa.sy + uy * pa.sr * 0.8;
        const x2 = pb.sx - ux * pb.sr * 0.8;
        const y2 = pb.sy - uy * pb.sr * 0.8;
        const bow = d * 0.16;
        const mx2 = (x1 + x2) / 2 - uy * bow;
        const my2 = (y1 + y2) / 2 + ux * bow;
        const breathe = reduce ? 0.75 : 0.6 + 0.4 * Math.sin(now / 700 + (h.since % 1000));
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.2 * h.alpha * breathe);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx2, my2, x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const sorted = [...atoms].sort((a, b) => a.morph.radius - b.morph.radius);
      for (const a of sorted) drawAtom(a, localT, breath);

      // tutti: one soft ring around every cloud, fading together
      if (tuttiPulse > 0.03) {
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.2 * tuttiPulse);
        ctx.lineWidth = 1;
        for (const a of atoms) {
          if (a.retiringAt || a.sr <= 0) continue;
          ctx.beginPath();
          ctx.arc(a.sx, a.sy, a.sr * (1.05 + (1 - tuttiPulse) * 0.25), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // specks (bursts and photon streaks)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        const age = (now - s.born) / s.life;
        if (age >= 1) { specks.splice(i, 1); continue; }
        if (!reduce) {
          s.x += s.vx * dt * timeScale;
          s.y += s.vy * dt * timeScale;
          s.vx *= 1 - dt * (s.streak ? 0.4 : 1.2);
          s.vy *= 1 - dt * (s.streak ? 0.4 : 1.2);
        }
        if (s.streak) {
          // a photon is a line of light, not a point
          const lenS = Math.max(4, Math.hypot(s.vx, s.vy) * 0.06);
          const ang = Math.atan2(s.vy, s.vx);
          ctx.strokeStyle = colorAlpha(s.color, (1 - age) * 0.7);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(s.x - Math.cos(ang) * lenS, s.y - Math.sin(ang) * lenS);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = colorAlpha(s.color, (1 - age) * 0.6);
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * (1 + age * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // blasts — the radiating fusion wave, the room's brightest moment;
      // under reduced motion it becomes a still ring and a flash, no shake
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = blasts.length - 1; i >= 0; i--) {
        const bl = blasts[i];
        const age = (now - bl.born) / 1000;
        if (age >= 1) { blasts.splice(i, 1); continue; }
        // the light flash at the heart, brightest in the first beats
        if (age < 0.3) {
          const fA = (1 - age / 0.3) * (0.22 + 0.4 * bl.mag);
          const fg = ctx.createRadialGradient(bl.x, bl.y, 2, bl.x, bl.y, bl.maxR * 0.9);
          fg.addColorStop(0, `rgba(247, 243, 234, ${fA})`);
          fg.addColorStop(0.35, `rgba(242, 197, 107, ${fA * 0.6})`);
          fg.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.arc(bl.x, bl.y, bl.maxR * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
        const eased = 1 - (1 - age) * (1 - age);
        const rr = reduce ? bl.maxR * 0.5 : bl.maxR * eased;
        ctx.strokeStyle = colorAlpha("#F2C56B", (1 - age) * (0.3 + 0.4 * bl.mag));
        ctx.lineWidth = reduce ? 1.4 : 1.6 + bl.mag * 2.6;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        if (!reduce) {
          ctx.strokeStyle = colorAlpha("#F7F3EA", (1 - age) * 0.22 * bl.mag);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(bl.x, bl.y, rr * 0.72, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();

      // ——— the gathering under the finger ———
      // From the touch tier on, probability visibly draws inward and tightens
      // until, at the dwell, it is an atom. The hand learns the verb by
      // watching it happen — never by being told (grammar §6).
      const gk = hold.gather > 0 ? hold.gather : gatherFade;
      if (gk > 0.01) {
        const ease = gk * gk;
        const ringR = 48 - 34 * ease;
        stamp(GATHER_SPRITE, hold.gx, hold.gy, 12 + 22 * ease, 0.3 + 0.55 * ease);
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.1 + 0.4 * ease);
        ctx.lineWidth = 0.8 + ease * 1.2;
        ctx.beginPath();
        ctx.arc(hold.gx, hold.gy, ringR, 0, Math.PI * 2);
        ctx.stroke();
        if (!reduce) {
          for (let i = 0; i < 7; i++) {
            const ang = (i / 7) * Math.PI * 2 + localT * 1.1 + gk * 3;
            const r0 = ringR + 26 * (1 - ease);
            ctx.strokeStyle = colorAlpha("#CFC2A6", 0.08 + 0.3 * ease);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hold.gx + Math.cos(ang) * r0, hold.gy + Math.sin(ang) * r0);
            ctx.lineTo(hold.gx + Math.cos(ang) * (ringR + 4), hold.gy + Math.sin(ang) * (ringR + 4));
            ctx.stroke();
          }
        }
      }

      // glimmer (grammar §6.3) — after quiet, the same gathering ripples once
      // where a press would land, so the room shows its verb without a word
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.25 + twinkleHash(slot) * 0.5) * width;
        const gy = (0.25 + twinkleHash(slot + 7) * 0.5) * height;
        const u = ((now % 9000) / 9000) * 3;
        if (u < 1) {
          const ease = reduce ? 0.5 : u;
          const alpha = Math.sin(ease * Math.PI);
          stamp(GATHER_SPRITE, gx, gy, 12 + 18 * ease, alpha * 0.5);
          ctx.strokeStyle = colorAlpha("#E7AC52", alpha * 0.3);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(gx, gy, 48 - 32 * ease, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // night — laid face-down, the clouds keep their watch in the dark
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
    <div className="atoms-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="atoms-field"
        role="application"
        tabIndex={0}
        aria-label="a vacuum where probability keeps watch — touch and an electron climbs, rest a finger and an atom gathers; hold where two clouds drift near and they share a bond (nobles refuse); flick one cloud into another and the nuclei fuse, up to iron; arrows walk, enter excites and, held beside a neighbor, joins; shift-enter hurls at the nearest neighbor"
      >
        <canvas ref={canvasRef} className="atoms-canvas" aria-hidden="true" />
      </div>

      {/* the quiet clear is the shared one: LetGo portals to <body> on
          purpose, because a control rendered inside this `position: fixed`
          wrapper is trapped in its stacking context under the tape's z-28 */}
      <LetGo label="still the field" onLetGo={() => stillRef.current()} visible={hasAtoms} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .atoms-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #0a0c11;
          overflow: hidden;
        }

        .atoms-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .atoms-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.atoms-page) {
          overflow: hidden;
          background: #0a0c11;
        }

        body:has(.atoms-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.atoms-page) .oda-field-watch,
        body:has(.atoms-page) .oda-candle-mark,
        body:has(.atoms-page) .oda-tape-shell,
        body:has(.atoms-page) .oda-sound-toggle {
          display: none !important;
        }

        .atoms-canvas {
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
