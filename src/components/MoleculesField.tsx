"use client";

/**
 * /molecules — a dark solvent field at 10⁻⁹ m, the chemistry band of the
 * scale manifold (plan W6).
 *
 * A handful of molecules drift and tumble in candle-toned dark: rings,
 * chains, and branched skeletons, every one a pure function of its seed
 * (src/lib/chemistry.ts). Alive at rest — thermal jitter, slow tumbling,
 * occasional conformational flexing, breathing on the shared audio clock.
 * Tap gives a thermal kick, a drag runs a solvent current, dwell on open
 * field condenses a new molecule bond by bond (haptics.bloom() as the last
 * bond closes), and the ceremony held where two molecules are near is a
 * REACTION — real where reality has one: when the curated set holds an
 * equation for the pair and the neighborhood truly holds the counts
 * (src/lib/stoichiometry.ts), the equation fires with its true
 * stoichiometry — 2 H₂ near 1 O₂ genuinely yields two waters — releasing
 * an energy shiver when exothermic and visibly DRAWING light inward for
 * the one endothermic equation (N₂+O₂, lightning's work). Where no
 * equation exists (or the counts fall short) the old deterministic-product
 * fallback answers, order-independent as ever. Each compound also keeps
 * one behavioral tell from its felt property: CO₂ warms the field faintly,
 * flammables shiver near heat, the inert airs drift serene, and water
 * finds water — the hydrogen bond as a slow lean. Reactable neighbors get
 * a bond-hint: a faint dashed arc breathing between them after a beat,
 * never text. Bond orders draw honestly (single/double/triple strands,
 * N≡N's three). Three fingers run convection or dilate time, a scrub
 * stirs a vortex, a twist rotates the lens to the structural formula
 * (hairline bonds, real skeletal letters — notation, the one lettered
 * surface). Rhythm entrains the vibration modes; a flick sends a molecule
 * tumbling with a doppler note, the light ones flying farther than the
 * heavy. The field persists in `objetdart:molecules:v1`; a quiet control
 * at the bottom lets the solution clear. Pinch is deliberately unbound —
 * ScaleTravel owns it, so pinching travels the manifold (cells above,
 * atoms below).
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
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
  MAX_MOLECULES,
  MOLECULE_FAMILIES,
  REACTIONS,
  compoundByKey,
  compoundFromSeed,
  hashSeed,
  molecularWeight,
  moleculeFromSeed,
  reactionProductSeed,
  settlePopulation,
  type MoleculeMorph,
} from "@/lib/chemistry";
import { reactionForPair, resolveReaction } from "@/lib/stoichiometry";

const STORE_KEY = "objetdart:molecules:v1";
const MOTE_COUNT = 80;
const RETIRE_MS = 1200;

type Mol = {
  id: string;
  seed: number;
  nx: number;
  ny: number;
  morph: MoleculeMorph;
  /** Bonds assembled so far, 0..bonds.length; fractional while condensing. */
  built: number;
  /** All bonds closed at least once (bloom fired). */
  closed: boolean;
  /** 0..1 reaction charge — the pair leans together as the ceremony deepens. */
  charge: number;
  /** Current rotation, radians. */
  rot: number;
  /** Extra tumble from a flick, decays. */
  spin: number;
  /** Thermal excitement from taps, 0..~2, decays. */
  heat: number;
  /** Kick response ∝ 1/√(molecular weight) — the light fly, the heavy sit. */
  massK: number;
  birth: number;
  retiringAt: number;
  pushX: number;
  pushY: number;
  // screen-space cache for hit tests
  sx: number;
  sy: number;
  sr: number;
};

type Mote = { x: number; y: number; vx: number; vy: number };
type Wavefront = { x: number; y: number; born: number; maxR: number; strength: number };
type Indraw = { x: number; y: number; born: number; maxR: number };
type Hint = { aId: string; bId: string; since: number; alpha: number };
type Stir = { x: number; y: number; dx: number; dy: number; strength: number; born: number };
type Vortex = { x: number; y: number; omega: number; born: number };
type Speck = { x: number; y: number; vx: number; vy: number; born: number; life: number; r: number; color: string };
type PendingNote = { at: number; midi: number; ms: number };

type Stored = { molecules: Array<{ id: string; seed: number; nx: number; ny: number }> };

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

function makeMol(seed: number, nx: number, ny: number, built: number): Mol {
  const morph = moleculeFromSeed(seed);
  const compound = compoundByKey(morph.compound);
  const massK = compound
    ? clamp(4.5 / Math.sqrt(Math.max(1, molecularWeight(compound))), 0.45, 1.5)
    : 1;
  return {
    id: `mo-${seed.toString(36)}`,
    seed,
    nx,
    ny,
    morph,
    built: built >= morph.bonds.length ? morph.bonds.length : built,
    closed: built >= morph.bonds.length,
    charge: 0,
    rot: (hashSeed(seed, 53) / 4294967296) * Math.PI * 2,
    spin: 0,
    heat: 0,
    massK,
    birth: performance.now(),
    retiringAt: 0,
    pushX: 0,
    pushY: 0,
    sx: -1,
    sy: -1,
    sr: 0,
  };
}

// the first look is never an empty beaker — four deterministic residents
const STARTERS: Array<[number, number]> = [
  [0.3, 0.36],
  [0.68, 0.3],
  [0.42, 0.66],
  [0.72, 0.68],
];

function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || !Array.isArray(parsed.molecules)) return null;
    return {
      molecules: parsed.molecules.filter(
        (m) => m && typeof m.seed === "number" && typeof m.nx === "number" && typeof m.ny === "number",
      ),
    };
  } catch {
    return null;
  }
}

/** midi voice of a molecule — a middle register, brighter than the plasm below the drop */
function midiOf(morph: MoleculeMorph): number {
  return 58 + morph.voice + morph.family * 2;
}

export default function MoleculesField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // §8c — the quiet clear: visible only when molecules stand; wired by the effect
  const [hasMols, setHasMols] = useState(false);
  const clearRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state (all refs of the effect closure) —————
    let mols: Mol[] = [];
    let seedCount = 0;
    const motes: Mote[] = [];
    const wavefronts: Wavefront[] = [];
    const indraws: Indraw[] = []; // the endothermic equation drawing light in
    const stirs: Stir[] = [];
    const vortices: Vortex[] = [];
    const specks: Speck[] = [];
    const pendingNotes: PendingNote[] = [];
    const hints = new Map<string, Hint>(); // bond-hints between reactable neighbors
    const reactPairCache = new Map<string, boolean>();
    let greenhouseGlow = 0; // CO₂'s tell: the field warms faintly
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let lastFrame = 0;
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
    // the vessel: gravity's lean on the solvent (-1..1) and the thermal spike
    let tiltLeanX = 0;
    let tiltLeanY = 0;
    let thermalStorm = 0;
    let tuttiPulse = 0;
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
    let entrainedBpm = 0;
    let entrainedUntil = 0;
    let lastInteractionAt = performance.now();
    let lastSaveAt = 0;
    let dirty = false;
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbMolId: string | null = null;
    let lastStirSoundAt = 0;
    let lastStreamSoundAt = 0;
    let lastScrubAt = 0;
    let lastChargeNoteAt = 0;
    let lastSeasonSoundAt = 0;
    const hold: { molId: string | null; partnerId: string | null; onExisting: boolean; seeded: boolean; reacted: boolean } = {
      molId: null,
      partnerId: null,
      onExisting: false,
      seeded: false,
      reacted: false,
    };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; };
    mq.addEventListener?.("change", onMq);

    // ————— performance contract: frame governor + visibility sleep —————
    const gov = createFrameGovernor();
    let sleeping = false;
    const offVis = onVisibility((hidden) => { sleeping = hidden; });

    // the world-law's slow cycle (three-finger twist): the solvent's own
    // season, 0..1 cyclic — a warm/cool drift in the candlelight, nothing else
    let season = 0;

    // the vessel's flip: face-down is night, the pool of light goes down
    let night = 0;
    let nightTarget = 0;

    // two-finger pan: the frame peeks a little in the hand's direction, then
    // eases back — the map layer's translation, never a permanent move
    let panX = 0;
    let panY = 0;
    let panTargetX = 0;
    let panTargetY = 0;

    // ————— cached radial-gradient sprites: baked once per palette key,
    // stamped with drawImage every frame — never a createRadialGradient
    // inside the per-molecule / per-atom loops —————
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
    const stampSprite = (key: string, stops: Array<[number, string]>, cx: number, cy: number, r: number, alpha: number) => {
      if (r <= 0 || alpha <= 0.002) return;
      const sprite = radialSprite(key, stops);
      if (!sprite) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    };

    // ————— persistence —————
    const save = (force = false) => {
      const now = performance.now();
      setHasMols(mols.some((m) => !m.retiringAt));
      if (!force && now - lastSaveAt < 800) { dirty = true; return; }
      lastSaveAt = now;
      dirty = false;
      try {
        const stored: Stored = {
          molecules: mols
            .filter((m) => !m.retiringAt)
            .map((m) => ({ id: m.id, seed: m.seed, nx: m.nx, ny: m.ny })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the solution lives on in memory */ }
    };

    const stored = loadStored();
    if (stored && stored.molecules.length > 0) {
      mols = stored.molecules
        .slice(-MAX_MOLECULES)
        .map((m) => {
          const mol = makeMol(m.seed, clamp01(m.nx), clamp01(m.ny), Infinity);
          return mol;
        });
      seedCount = mols.length;
    } else {
      mols = STARTERS.map(([nx, ny], i) =>
        makeMol(hashSeed(Math.round(nx * 883), Math.round(ny * 877), i), nx, ny, Infinity),
      );
      seedCount = mols.length;
      save(true);
    }
    setHasMols(mols.length > 0);

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const noteLater = (delayMs: number, midi: number, ms = 120) => {
      pendingNotes.push({ at: performance.now() + delayMs, midi, ms });
    };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), { embedded: isEmbeddedFrame(), reducedMotion: reduce, maxDpr: 1.5 });
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
          motes.push({ x: twinkleHash(i + 29) * width, y: twinkleHash(i + 631) * height, vx: 0, vy: 0 });
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

    const molAt = (x: number, y: number): Mol | null => {
      let best: Mol | null = null;
      let bestD = Infinity;
      for (const m of mols) {
        if (m.retiringAt) continue;
        const d = Math.hypot(x - m.sx, y - m.sy);
        if (d < Math.max(34, m.sr * 1.25) && d < bestD) { bestD = d; best = m; }
      }
      return best;
    };

    /** The nearest other closed molecule within docking reach of m. */
    const dockPartner = (m: Mol): Mol | null => {
      let best: Mol | null = null;
      let bestD = Infinity;
      for (const o of mols) {
        if (o === m || o.retiringAt || !o.closed) continue;
        const d = Math.hypot(o.sx - m.sx, o.sy - m.sy);
        if (d < (m.sr + o.sr) * 1.7 && d < bestD) { bestD = d; best = o; }
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
      if (specks.length > 220) specks.splice(0, specks.length - 220);
    };

    const retireOldest = () => {
      const alive = mols.filter((m) => !m.retiringAt);
      const { retired } = settlePopulation(alive, MAX_MOLECULES);
      for (const r of retired) {
        r.retiringAt = performance.now();
        note(midiOf(r.morph) - 12, 320); // a low word as the eldest dissolves
      }
    };

    const condense = (x: number, y: number): Mol | null => {
      const nx = clamp01(x / width);
      const ny = clamp(y / height, 0.08, 0.95);
      const seed = hashSeed(Math.round(nx * 883), Math.round(ny * 877), seedCount);
      seedCount += 1;
      const m = makeMol(seed, nx, ny, 0.05);
      m.closed = false;
      mols.push(m);
      retireOldest();
      // a molecule begins: two senses in the same frame
      try { audio().spark(); } catch { /* noop */ }
      note(midiOf(m.morph) - 12, 180);
      try { haptics.ripple(0.5); } catch { /* noop */ }
      burst(x, y, [MOLECULE_FAMILIES[m.morph.family][4], "#DDD3BE"], 6, 20);
      useField.getState().recordTape("object", 0.5, "molecules/condense");
      save();
      return m;
    };

    const buildMol = (m: Mol, d: number) => {
      if (m.closed) return;
      const before = Math.floor(m.built);
      m.built = Math.min(m.morph.bonds.length, m.built + d);
      const after = Math.floor(m.built);
      if (after > before && m.built < m.morph.bonds.length) {
        // one more bond finds its angle: a small click of matter
        note(midiOf(m.morph) - 5 + after, 90);
        try { haptics.tap(); } catch { /* noop */ }
      }
      if (!m.closed && m.built >= m.morph.bonds.length) {
        m.closed = true;
        // the last bond closes: sight (shimmer), sound (note), touch (bloom)
        try { haptics.bloom(); } catch { /* noop */ }
        note(midiOf(m.morph), 260);
        burst(m.sx, m.sy, [MOLECULE_FAMILIES[m.morph.family][5], "#E7AC52"], 12, 34);
        dirty = true;
      }
    };

    /**
     * A deterministic seed whose compound IS `key`: walk the pair's hash
     * chain until compoundFromSeed lands on it. Pure — the same reactants
     * always beget the same individuals.
     */
    const seedForCompound = (sa: number, sb: number, key: string, idx: number): number | null => {
      for (let k = 0; k < 40000; k++) {
        const s = hashSeed(Math.min(sa, sb), Math.max(sa, sb), 0xc0de + idx, k);
        if (compoundFromSeed(s).key === key) return s;
      }
      return null;
    };

    // exothermic: a small energy shiver — motes, a warm ring, a bell
    const exothermicShiver = (x: number, y: number, energy: number) => {
      const s = clamp01(energy / 1200);
      wavefronts.push({
        x, y,
        born: performance.now(),
        maxR: Math.min(width, height) * (0.16 + s * 0.22),
        strength: 0.5 + s * 0.5,
      });
      if (wavefronts.length > 8) wavefronts.shift();
      burst(x, y, ["#F2C56B", "#E7AC52", "#F2EEE6"], 14 + Math.round(s * 18), 50 + s * 40);
      for (const m of mols) {
        if (m.retiringAt) continue;
        const d = Math.hypot(m.sx - x, m.sy - y);
        if (d < Math.min(width, height) * 0.4) m.heat = Math.min(2, m.heat + 0.3 + s * 0.5);
      }
      try { audio().bell(); } catch { /* noop */ }
      if (s > 0.5) { try { audio().spark(); } catch { /* noop */ } }
      note(52 + Math.round(s * 10), 300);
    };

    // endothermic (N₂+O₂, lightning's work): the reaction DRAWS light
    // inward — specks converge, a ring closes, the field cools
    const endothermicDraw = (x: number, y: number) => {
      indraws.push({ x, y, born: performance.now(), maxR: Math.min(width, height) * 0.2 });
      if (indraws.length > 3) indraws.shift();
      if (!reduce) {
        const r0 = Math.min(width, height) * 0.2;
        for (let i = 0; i < 16; i++) {
          const ang = (i / 16) * Math.PI * 2 + twinkleHash(i + 19) * 0.4;
          specks.push({
            x: x + Math.cos(ang) * r0,
            y: y + Math.sin(ang) * r0,
            vx: -Math.cos(ang) * (r0 / 0.8),
            vy: -Math.sin(ang) * (r0 / 0.8),
            born: performance.now(),
            life: 800,
            r: 0.9,
            color: i % 3 === 0 ? "#6997A4" : "#DDD3BE",
          });
        }
      }
      for (const m of mols) m.heat *= 0.55; // the solution cools around the work
      try { audio().thud(); } catch { /* noop */ }
      note(30, 480);
    };

    const react = (a: Mol, b: Mol) => {
      if (!a.closed || !b.closed || a.retiringAt || b.retiringAt) return;
      const mx = (a.sx + b.sx) / 2;
      const my = (a.sy + b.sy) / 2;
      // census the neighborhood: who stands near enough to take part
      const reach = Math.min(width, height) * 0.34;
      const nearby = mols.filter(
        (m) => !m.retiringAt && m.closed && Math.hypot(m.sx - mx, m.sy - my) < reach,
      );
      const census: Record<string, number> = {};
      for (const m of nearby) census[m.morph.compound] = (census[m.morph.compound] ?? 0) + 1;
      const resolution = resolveReaction(REACTIONS, a.morph.compound, b.morph.compound, census);
      if (resolution) {
        // pick the consumed individuals: the ceremony pair first, then the
        // nearest of each remaining species the equation demands
        const need = new Map(resolution.consumed.map((t) => [t.key, t.n]));
        const chosen: Mol[] = [];
        const take = (m: Mol) => {
          const n = need.get(m.morph.compound) ?? 0;
          if (n <= 0) return;
          need.set(m.morph.compound, n - 1);
          chosen.push(m);
        };
        take(a);
        take(b);
        const rest = nearby
          .filter((m) => m !== a && m !== b)
          .sort((p, q) => Math.hypot(p.sx - mx, p.sy - my) - Math.hypot(q.sx - mx, q.sy - my));
        for (const m of rest) take(m);
        let unmet = false;
        for (const n of need.values()) if (n > 0) unmet = true;
        // every product must decode to its real compound; if the chain ever
        // failed (it should not), the fallback law answers instead
        const productSeeds: Array<{ seed: number; key: string }> = [];
        if (!unmet) {
          let pi = 0;
          for (const t of resolution.produced) {
            for (let n = 0; n < t.n && pi >= 0; n++) {
              const s = seedForCompound(a.seed, b.seed, t.key, pi);
              if (s == null) { pi = -1; break; }
              productSeeds.push({ seed: s, key: t.key });
              pi += 1;
            }
            if (pi < 0) break;
          }
          if (pi >= 0 && productSeeds.length > 0) {
            // the equation fires: consume the true counts, condense the
            // true products with their real stoichiometry
            const now = performance.now();
            for (const m of chosen) {
              m.retiringAt = now;
              const d = Math.max(1, Math.hypot(mx - m.sx, my - m.sy));
              m.pushX += ((mx - m.sx) / d) * 26; // the consumed lean into the work
              m.pushY += ((my - m.sy) / d) * 26;
            }
            const spreadPhase = (hashSeed(a.seed, b.seed, 7) / 4294967296) * Math.PI * 2;
            productSeeds.forEach((ps, i) => {
              const ang = spreadPhase + (i / Math.max(1, productSeeds.length)) * Math.PI * 2;
              const rad = productSeeds.length > 1 ? (a.sr + b.sr) * 0.45 : 0;
              const nx = clamp01((mx + Math.cos(ang) * rad) / Math.max(1, width));
              const ny = clamp((my + Math.sin(ang) * rad) / Math.max(1, height), 0.08, 0.95);
              const p = makeMol(ps.seed, nx, ny, Math.max(1, Math.floor(moleculeFromSeed(ps.seed).bonds.length * 0.55)));
              p.closed = false;
              p.heat = resolution.energy > 0 ? 1.4 : 0.2;
              mols.push(p);
            });
            retireOldest();
            if (resolution.energy > 0) exothermicShiver(mx, my, resolution.energy);
            else endothermicDraw(mx, my);
            try { haptics.bloom(); } catch { /* noop */ }
            useField.getState().recordTape("sigil", 0.85, "molecules/reaction");
            save();
            return;
          }
        }
      }
      // no curated equation, or the counts fall short: the old law answers —
      // the pair's deterministic product, order-independent as ever
      const seed = reactionProductSeed(a.seed, b.seed);
      const nx = (a.nx + b.nx) / 2;
      const ny = (a.ny + b.ny) / 2;
      const p = makeMol(seed, nx, ny, Math.max(1, Math.floor(moleculeFromSeed(seed).bonds.length * 0.55)));
      p.closed = false;
      p.heat = 1.6; // reactions run hot for a moment
      mols = mols.filter((m) => m !== a && m !== b);
      mols.push(p);
      retireOldest();
      // reaction: one solemn act, three senses in one frame
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      const famA = MOLECULE_FAMILIES[a.morph.family];
      const famB = MOLECULE_FAMILIES[b.morph.family];
      // a shiver of released energy motes
      burst((a.sx + b.sx) / 2, (a.sy + b.sy) / 2, [famA[5], famB[5], "#F2EEE6", "#E7AC52"], 26, 64);
      for (const m of mols) m.heat = Math.min(2, m.heat + 0.4);
      useField.getState().recordTape("sigil", 0.85, "molecules/reaction");
      save();
    };

    const thermalKick = (x: number, y: number, intensity: number) => {
      const maxR = Math.min(width, height) * (0.12 + intensity * 0.3);
      wavefronts.push({ x, y, born: performance.now(), maxR, strength: 0.4 + intensity * 0.6 });
      if (wavefronts.length > 8) wavefronts.shift();
      for (const m of mols) {
        const d = Math.hypot(x - m.sx, y - m.sy);
        if (d < maxR * 1.4) {
          const k = 1 - d / (maxR * 1.4);
          m.heat = Math.min(2, m.heat + (0.4 + intensity) * k);
          if (d > 1) {
            // the light fly farther than the heavy — molecular weight, felt
            m.pushX += ((m.sx - x) / d) * k * 30 * (0.5 + intensity) * m.massK;
            m.pushY += ((m.sy - y) / d) * k * 30 * (0.5 + intensity) * m.massK;
          }
        }
      }
      note(64 + Math.round(intensity * 8), 100);
      try { haptics.tap(); } catch { /* noop */ }
    };

    // the raised-lens marker ScaleTravel reads before a step-back nudge
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    // §8c — let the solution clear: everything dissolves, the beaker forgets
    clearRef.current = () => {
      const now = performance.now();
      for (const m of mols) {
        if (m.retiringAt) continue;
        m.retiringAt = now;
        if (!reduce && m.sr > 0) {
          burst(m.sx, m.sy, [MOLECULE_FAMILIES[m.morph.family][3], "#CFC2A6"], 4, 16);
        }
      }
      hints.clear();
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ molecules: [] })); } catch { /* noop */ }
      setHasMols(false);
      try { audio().thud(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
    };

    // three-finger tap = tutti (grammar §5): one synchronized soft pulse —
    // every molecule rings its tone quietly, shimmering as one solution,
    // and how firmly the three fingers landed is how brightly it answers
    const tutti = (gain = 0.5) => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      tuttiPulse = 0.55 + gain * 0.45;
      const alive = mols.filter((m) => !m.retiringAt && m.closed);
      alive.slice(0, 10).forEach((m, i) => noteLater(i * 45, midiOf(m.morph), 60 + Math.round(gain * 50)));
      for (const m of alive) m.heat = Math.min(2, m.heat + 0.15 + gain * 0.3);
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
            note(50, 160);
          }
          return;
        }
        if (e.fingers === 3) { tutti(clamp01(0.35 + e.intensity * 0.65)); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const { x, y } = toLocal(e.x, e.y);
        // rapid-tap ladder 1 / 3 / 5 / n — counts between tiers deepen intensity
        const tier = tapTrainTier(e.count);
        const base = tier === "n" ? 7 : tier;
        const deepen = Math.min(1, (e.count - base) * 0.5);
        const amp = e.intensity * (0.75 + deepen * 0.55);
        if (tier === 1) {
          thermalKick(x, y, amp);
          return;
        }
        if (tier === 3) {
          // spawn: condense a molecule under the hand (or warm one already there)
          const hit = molAt(x, y);
          if (hit && !hit.retiringAt) {
            hit.heat = Math.min(2, hit.heat + 0.55 + deepen * 0.5);
            note(midiOf(hit.morph), 160 + deepen * 80);
            try { haptics.detent(); } catch { /* noop */ }
            burst(hit.sx, hit.sy, [MOLECULE_FAMILIES[hit.morph.family][5], "#E7AC52"], 8, 28);
          } else {
            const m = condense(x, y);
            if (m) m.heat = Math.min(2, 0.6 + deepen * 0.5);
          }
          return;
        }
        if (tier === 5) {
          // rupture: the nearest molecule dissolves
          const m = molAt(x, y) ?? mols.find((q) => !q.retiringAt) ?? null;
          if (m && !m.retiringAt) {
            m.retiringAt = performance.now();
            note(midiOf(m.morph) - 12, 280 + deepen * 120);
            try { audio().thud(); } catch { /* noop */ }
            try { haptics.roll(); } catch { /* noop */ }
            burst(m.sx, m.sy, [MOLECULE_FAMILIES[m.morph.family][3], "#DDD3BE"], 10, 34);
            save();
          } else {
            thermalKick(x, y, amp * 1.35);
          }
          return;
        }
        // n: rewrite — fire a reaction with a docked partner, or a heat storm
        const m = molAt(x, y) ?? mols.find((q) => !q.retiringAt && q.closed) ?? null;
        if (m && !m.retiringAt && m.closed) {
          const partner = dockPartner(m);
          if (partner) {
            react(m, partner);
            return;
          }
        }
        thermalKick(x, y, 0.85 + deepen * 0.5);
        for (const q of mols) {
          if (q.retiringAt) continue;
          if (Math.hypot(q.sx - x, q.sy - y) < Math.min(width, height) * 0.35) {
            q.heat = Math.min(2, q.heat + 0.7 + deepen * 0.4);
          }
        }
        try { audio().bell(); } catch { /* noop */ }
        try { haptics.bloom(); } catch { /* noop */ }
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: time dilates while held — and keeps
          // dilating, a 900ms hold and a 2400ms hold are different stillnesses
          if (e.phase === "enter") { try { haptics.tap(); } catch { /* noop */ } note(36, 260); }
          if (e.phase === "release") { timeScaleTarget = 1; return; }
          timeScaleTarget = 1 - 0.85 * clamp01(e.elapsed / 2400);
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const m = molAt(x, y);
          hold.molId = m ? m.id : null;
          hold.partnerId = null;
          hold.onExisting = !!m;
          hold.seeded = false;
          hold.reacted = false;
          return;
        }
        if (e.phase === "release") {
          const m = mols.find((q) => q.id === hold.molId);
          if (m) m.charge = 0;
          const p = mols.find((q) => q.id === hold.partnerId);
          if (p) p.charge = 0;
          hold.molId = null;
          hold.partnerId = null;
          hold.onExisting = false;
          save();
          return;
        }
        // ticks (~80ms)
        if (hold.onExisting && hold.molId) {
          const m = mols.find((q) => q.id === hold.molId);
          if (!m || m.retiringAt) return;
          const partner = dockPartner(m);
          hold.partnerId = partner ? partner.id : null;
          if (!partner || !m.closed) {
            // no partner in reach: the hand only warms what it holds
            m.heat = Math.min(2, m.heat + 0.02);
            return;
          }
          // the road to the ceremony: the pair docks, ticks rise
          m.charge = clamp01((e.elapsed - 900) / 1600);
          partner.charge = m.charge;
          // dock: they lean together while the ceremony deepens
          const d = Math.hypot(partner.sx - m.sx, partner.sy - m.sy);
          if (d > (m.sr + partner.sr) * 0.9) {
            const k = 14 * m.charge + 4;
            m.pushX += ((partner.sx - m.sx) / d) * k;
            m.pushY += ((partner.sy - m.sy) / d) * k;
            partner.pushX += ((m.sx - partner.sx) / d) * k;
            partner.pushY += ((m.sy - partner.sy) / d) * k;
          }
          const now = performance.now();
          if (m.charge > 0 && now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(midiOf(m.morph) + Math.round(m.charge * 9), 90);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3 && !hold.reacted) {
            hold.reacted = true;
            hold.molId = null;
            hold.partnerId = null;
            react(m, partner);
          }
        } else if (hold.molId) {
          // a molecule this hand just condensed — keep holding, it keeps building
          const m = mols.find((q) => q.id === hold.molId);
          if (m && !m.closed) buildMol(m, 0.0016 * 80 * (1 + e.intensity * 0.6) * m.morph.bonds.length * 0.25);
          else if (m) {
            // duration is an axis: past the last bond the hold keeps warming —
            // the molecule shimmers and tumbles faster the longer it is held
            m.heat = Math.min(2, m.heat + 0.035 * (1 + e.intensity * 0.6));
            const now = performance.now();
            if (now - lastChargeNoteAt > 700) {
              lastChargeNoteAt = now;
              note(midiOf(m.morph) + 2 + Math.round(m.heat * 3), 90);
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
        } else if (e.tier >= 2 && !hold.seeded && !hold.onExisting && !hold.reacted) {
          // dwell on open field: condense — long-press means grow, everywhere
          hold.seeded = true;
          const m = condense(x, y);
          if (m) hold.molId = m.id;
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers are the law: convection — the whole solvent turns over
          streamTargetX = clamp(e.vx * 1.4, -1, 1);
          streamTargetY = clamp(e.vy * 1.4, -1, 1);
          const now = performance.now();
          const mag = Math.hypot(streamTargetX, streamTargetY);
          if (mag > 0.5 && now - lastStreamSoundAt > 520) {
            lastStreamSoundAt = now;
            note(40 + Math.round(mag * 5), 240);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        // one finger runs a solvent current — molecules ride it
        stirs.push({ x, y, dx: e.vx, dy: e.vy, strength: clamp(Math.hypot(e.vx, e.vy), 0.1, 1.6), born: performance.now() });
        if (stirs.length > 24) stirs.shift();
        for (const m of mols) {
          const d = Math.hypot(x - m.sx, y - m.sy);
          if (d < m.sr * 2.4) {
            m.pushX += e.vx * 30;
            m.pushY += e.vy * 30;
            m.spin += (e.vx - e.vy) * 0.08;
          }
        }
        const now = performance.now();
        if (now - lastStirSoundAt > 240) {
          lastStirSoundAt = now;
          note(66 + Math.round(twinkleHash(Math.floor(now / 240)) * 5), 70);
          try { haptics.ripple(0.18); } catch { /* noop */ }
        }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        // a flick sends the nearest molecule tumbling, with a doppler note —
        // rising as it leaves the hand, falling as it recedes
        const { x, y } = toLocal(e.x, e.y);
        const m = molAt(x, y) ?? mols.find((q) => !q.retiringAt) ?? null;
        if (m) {
          const speed = clamp(e.speed, 0.6, 2.4);
          // weight is honest here too: hydrogen leaps, benzene lumbers
          m.pushX += Math.cos(e.angle) * 130 * speed * m.massK;
          m.pushY += Math.sin(e.angle) * 130 * speed * m.massK;
          m.spin += (e.angle > 0 ? 1 : -1) * speed * 4 * m.massK;
          m.heat = Math.min(2, m.heat + 0.5);
          note(midiOf(m.morph) + 7, 100);
          noteLater(190, midiOf(m.morph) - 2, 200);
        }
        for (let i = 0; i < 10; i++) {
          const jitter = (twinkleHash(i * 13 + 5) - 0.5) * 0.5;
          specks.push({
            x, y,
            vx: Math.cos(e.angle + jitter) * 150 * (0.6 + twinkleHash(i + 31) * 0.7),
            vy: Math.sin(e.angle + jitter) * 150 * (0.6 + twinkleHash(i + 67) * 0.7),
            born: performance.now(),
            life: 700 + twinkleHash(i + 3) * 900,
            r: 0.8 + twinkleHash(i + 91) * 1.4,
            color: i % 3 === 0 ? "#E7AC52" : "#DDD3BE",
          });
        }
        try { haptics.ripple(0.4); } catch { /* noop */ }
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three-finger twist = season: the solvent's own slow warm/cool
          // cycle, wound directly by the turn — never the lens
          if (e.phase === "move") {
            season = (((season + e.angle / (Math.PI * 2)) % 1) + 1) % 1;
            const now = performance.now();
            if (now - lastSeasonSoundAt > 260) {
              lastSeasonSoundAt = now;
              note(32 + Math.round(season * 14), 180);
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
          return; // never drives the lens
        }
        // two fingers rotate the lens: felt matter ↔ structural formula
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            markLens(snapped === 1);
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(50, 160);
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
        if (now - lastScrubAt > 600) {
          lastScrubAt = now;
          // the stirring rod answers: swirl seen, tone heard, ring felt
          note(68 + Math.round(Math.abs(e.winding)), 90);
          try { haptics.ripple(0.3); } catch { /* noop */ }
        }
      },
      rhythm: (e) => {
        lastInteractionAt = performance.now();
        if (e.bpm < 40 || e.bpm > 220) return;
        const wasSilent = performance.now() > entrainedUntil;
        entrainedBpm = e.bpm;
        // stability is an axis: a metronomic hand carries the entrainment
        // more than twice as far as a loose one
        entrainedUntil = performance.now() + 8000 + e.stability * 12000;
        if (wasSilent) {
          // the vibration modes lock to your pulse: a felt click as it takes
          try { haptics.tap(); } catch { /* noop */ }
          note(55, 140);
        }
      },
      drum: (e) => {
        lastInteractionAt = performance.now();
        // percussion on the bench: the patter plays the space BETWEEN the
        // hands. A convection cell wakes between the two struck spots and
        // the molecules shuttle across it — each hit sends the ferry the
        // other way, harder the stricter the alternation
        const a = toLocal(e.ax, e.ay);
        const b = toLocal(e.bx, e.by);
        const across = e.hits % 2 === 0 ? 1 : -1;
        const dd = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const ux = ((b.x - a.x) / dd) * across;
        const uy = ((b.y - a.y) / dd) * across;
        const k = 0.4 + e.alternation * 0.6;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        stirs.push({ x: mx, y: my, dx: ux * k, dy: uy * k, strength: k, born: performance.now() });
        if (stirs.length > 24) stirs.shift();
        for (const m of mols) {
          if (m.retiringAt || m.sr <= 0) continue;
          if (Math.hypot(m.sx - mx, m.sy - my) < Math.min(width, height) * 0.32) {
            m.pushX += ux * 26 * k * m.massK;
            m.pushY += uy * 26 * k * m.massK;
            m.heat = Math.min(2, m.heat + 0.08 * k);
          }
        }
        note(52 + (e.hits % 2) * 7 + Math.round(e.alternation * 4), 80);
        try { haptics.tap(); } catch { /* noop */ }
      },
    });

    // ————— the vessel: the device is the beaker's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = solvent convection downhill; shake = a thermal spike —
    // a brief temperature rise, everything jitters and tumbles harder.
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) { tiltLeanX = 0; tiltLeanY = 0; return; }
        tiltLeanX = clamp(gamma / 28, -1, 1);
        tiltLeanY = clamp((beta - 35) / 28, -1, 1); // rest angle ≈ a held phone
        const mag = Math.hypot(tiltLeanX, tiltLeanY);
        const now = performance.now();
        if (mag > 0.55 && now - lastTiltSoundAt > 1400) {
          lastTiltSoundAt = now;
          note(40 + Math.round(mag * 4), 220); // the convection's low word
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // thermal agitation spike: the whole solution runs hot for a breath
        thermalStorm = Math.min(1, 0.5 + intensity * 0.7);
        for (const m of mols) m.heat = Math.min(2, m.heat + 0.5 + intensity * 0.6);
        try { audio().spark(); } catch { /* noop */ }
        note(45, 200);
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // a rap on the case rings the beaker: one wavefront through the
        // whole solvent, center-out, felt and heard together
        wavefronts.push({
          x: width * 0.5,
          y: height * 0.5,
          born: performance.now(),
          maxR: Math.max(width, height) * 0.55,
          strength: 0.4 + intensity * 0.5,
        });
        if (wavefronts.length > 8) wavefronts.shift();
        try { audio().thud(); } catch { /* noop */ }
        note(33, 260);
        try { haptics.detent(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        // face-down is night: the pool of light under the beaker goes down
        nightTarget = faceDown ? 1 : 0;
        lastInteractionAt = performance.now();
        if (faceDown) {
          try { audio().thud(); } catch { /* noop */ }
          note(28, 600);
          try { haptics.roll(); } catch { /* noop */ }
        } else {
          try { audio().spark(); } catch { /* noop */ }
          note(46, 300);
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
        const m = molAt(x, y);
        if (m && m.closed) {
          const partner = dockPartner(m);
          if (partner) {
            // held Enter repeats — the keyboard's ceremony
            if (kbMolId !== m.id) { kbMolId = m.id; kbCharge = 0; }
            kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
            m.charge = kbCharge;
            partner.charge = kbCharge;
            const now = performance.now();
            if (now - lastChargeNoteAt > 340) {
              lastChargeNoteAt = now;
              note(midiOf(m.morph) + Math.round(kbCharge * 9), 90);
            }
            if (kbCharge >= 1) {
              kbCharge = 0;
              kbMolId = null;
              react(m, partner);
            }
          } else if (!ev.repeat) {
            thermalKick(x, y, 0.6);
          }
        } else if (!ev.repeat) {
          const seeded = condense(x, y);
          if (seeded) buildMol(seeded, 0.4);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const m = mols.find((q) => q.id === kbMolId);
        if (m) {
          m.charge = 0;
          const partner = dockPartner(m);
          if (partner) partner.charge = 0;
        }
        kbCharge = 0;
        kbMolId = null;
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
    /**
     * Screen-space atom positions of a molecule at time t: skeleton rotated
     * by rot, scaled to R, flexed conformationally, shivering thermally.
     */
    const atomPoints = (m: Mol, R: number, t: number): Array<{ x: number; y: number }> => {
      const morph = m.morph;
      const entrained = performance.now() < entrainedUntil;
      const jRate = entrained ? entrainedBpm / 60 : morph.jitter.rateHz;
      const jAmp = morph.jitter.amp * (1 + m.heat * 2 + (entrained ? 0.8 : 0)) * (reduce ? 0 : 1);
      const flex = reduce ? 0 : Math.sin(t * Math.PI * 2 * morph.flex.rateHz + morph.flex.phase) * morph.flex.amp;
      const cosR = Math.cos(m.rot);
      const sinR = Math.sin(m.rot);
      return morph.atoms.map((a, i) => {
        const stretch = 1 + flex * Math.sin(morph.modes[i]);
        const px = a.x * stretch;
        const py = a.y * stretch;
        const jx = jAmp * Math.sin(t * Math.PI * 2 * jRate + morph.modes[i]);
        const jy = jAmp * Math.cos(t * Math.PI * 2 * jRate * 0.93 + morph.modes[i] * 1.7);
        return {
          x: (px * cosR - py * sinR + jx) * R,
          y: (px * sinR + py * cosR + jy) * R,
        };
      });
    };

    const drawMol = (m: Mol, t: number, breath: number) => {
      const morph = m.morph;
      const fam = MOLECULE_FAMILIES[morph.family];
      const minDim = Math.min(width, height);
      let fade = 1;
      let retireScale = 1;
      if (m.retiringAt) {
        const e = clamp01((performance.now() - m.retiringAt) / RETIRE_MS);
        fade = 1 - e;
        retireScale = 1 - e * 0.4;
      }
      const breathScale = reduce ? 1 : 1 + Math.sin(breath + morph.breathOffset) * 0.03;
      const R = minDim * morph.radius * breathScale * retireScale;
      if (R < 1) return;
      const cx = m.nx * width;
      const cy = m.ny * height;
      m.sx = cx;
      m.sy = cy;
      m.sr = R;

      const feltAlpha = (1 - lens) * fade;
      const lensAlpha = lens * fade;
      const pts = atomPoints(m, R, t);
      const builtBonds = Math.floor(m.built);
      const partial = m.built - builtBonds;

      ctx.save();
      ctx.translate(cx, cy);

      // the reaction ceremony leans in: a warm halo tightens around the pair
      // — a cached sprite stamped with drawImage, never a per-molecule gradient
      if (m.charge > 0) {
        const haloR = R * (1.9 - m.charge * 0.5);
        stampSprite(
          "mol-charge-halo",
          [[0, "rgba(231, 172, 82, 1)"], [1, "rgba(0,0,0,0)"]],
          0, 0, haloR,
          0.1 * m.charge * fade,
        );
      }

      // — felt pass: warm orbs and glowing bonds under candlelight —
      if (feltAlpha > 0.02) {
        // heat shows as a faint shimmer envelope — and a greenhouse molecule
        // carries a permanent quiet warmth of its own (CO₂'s tell)
        const haloK = Math.max(Math.min(1, m.heat), morph.felt === "greenhouse" ? 0.4 : 0);
        if (haloK > 0.15) {
          stampSprite(
            `mol-heat-${morph.family}`,
            [[0, colorAlpha(fam[4], 1)], [1, "rgba(0,0,0,0)"]],
            0, 0, R * 1.5,
            0.05 * haloK * feltAlpha,
          );
        }
        ctx.lineCap = "round";
        for (let i = 0; i < morph.bonds.length; i++) {
          if (i >= m.built) break;
          const b = morph.bonds[i];
          const ax = pts[b.a].x;
          const ay = pts[b.a].y;
          let bx = pts[b.b].x;
          let by = pts[b.b].y;
          if (i === builtBonds && partial > 0 && partial < 1) {
            // the bond still finding its way across
            bx = ax + (pts[b.b].x - ax) * partial;
            by = ay + (pts[b.b].y - ay) * partial;
          }
          // bond order drawn honestly: one, two, or three parallel strands
          // (O=O's pair, N≡N's three) — the multiplicity is the material
          const blen = Math.max(1e-6, Math.hypot(bx - ax, by - ay));
          const pxv = -(by - ay) / blen;
          const pyv = (bx - ax) / blen;
          const gap = R * 0.055;
          const offs = b.order === 1 ? [0] : b.order === 2 ? [-1, 1] : [-1.7, 0, 1.7];
          ctx.strokeStyle = colorAlpha(fam[3], 0.55 * feltAlpha);
          ctx.lineWidth = Math.max(1, R * (b.order === 1 ? 0.05 : 0.036));
          ctx.beginPath();
          for (const o of offs) {
            ctx.moveTo(ax + pxv * o * gap, ay + pyv * o * gap);
            ctx.lineTo(bx + pxv * o * gap, by + pyv * o * gap);
          }
          ctx.stroke();
          if (b.order >= 2) {
            // multiplicity gleams: a bright filament down the middle
            ctx.strokeStyle = colorAlpha(fam[5], 0.4 * feltAlpha);
            ctx.lineWidth = Math.max(0.6, R * 0.02);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }
        for (let i = 0; i < morph.atoms.length; i++) {
          // atoms surface as their bonds arrive
          let touched = 0;
          for (let j = 0; j < morph.bonds.length; j++) {
            if (j >= m.built) break;
            const b = morph.bonds[j];
            if (b.a === i || b.b === i) touched = 1;
          }
          if (!touched && !m.closed) continue;
          const a = morph.atoms[i];
          const or = R * a.size * (a.letter === "C" ? 1 : 1.25);
          // stop ratios (0.85 / 0.5) are baked into the sprite; feltAlpha is
          // the only per-frame factor, applied uniformly via globalAlpha
          stampSprite(
            `mol-atom-${morph.family}-${a.tone}`,
            [
              [0, colorAlpha(fam[Math.min(5, a.tone + 2)], 0.85)],
              [0.6, colorAlpha(fam[a.tone], 0.5)],
              [1, "rgba(0,0,0,0)"],
            ],
            pts[i].x, pts[i].y, or * 1.6,
            feltAlpha,
          );
        }
      }

      // — lens pass: the structural formula, the same molecule as notation —
      if (lensAlpha > 0.02) {
        const ink = morph.family === 1 ? "#B25048" : "#DDD3BE";
        for (let i = 0; i < morph.bonds.length; i++) {
          if (i >= m.built) break;
          const b = morph.bonds[i];
          const ax = pts[b.a].x;
          const ay = pts[b.a].y;
          const bx = pts[b.b].x;
          const by = pts[b.b].y;
          const dx = bx - ax;
          const dy = by - ay;
          const len = Math.max(1e-6, Math.hypot(dx, dy));
          const ox = (-dy / len) * R * 0.045;
          const oy = (dx / len) * R * 0.045;
          ctx.strokeStyle = colorAlpha(ink, 0.8 * lensAlpha);
          ctx.lineWidth = 0.8;
          // the notation draws the true count of lines: N≡N earns three
          const offs2 = b.order === 1 ? [0] : b.order === 2 ? [-1, 1] : [-1.5, 0, 1.5];
          ctx.beginPath();
          for (const o of offs2) {
            ctx.moveTo(ax + ox * o, ay + oy * o);
            ctx.lineTo(bx + ox * o, by + oy * o);
          }
          ctx.stroke();
        }
        // heteroatom letters at their vertices — the one lettered surface of
        // this band, and it is notation, not instruction
        ctx.font = `italic ${Math.max(9, Math.round(R * 0.24))}px Georgia, 'Times New Roman', serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < morph.atoms.length; i++) {
          const a = morph.atoms[i];
          if (a.letter === "C") continue; // skeletal convention: carbon is the silence
          ctx.fillStyle = colorAlpha("#0d0a08", 0.9 * lensAlpha);
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, R * 0.16, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = colorAlpha(ink, 0.95 * lensAlpha);
          ctx.fillText(a.letter, pts[i].x, pts[i].y + R * 0.01);
        }
        // measure ring — a quiet dashed calibration, physical annotation
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = colorAlpha(ink, 0.22 * lensAlpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    };

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (sleeping) return; // no draw while the document is hidden
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      const detail = detailForTier(tier);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      streamX += (streamTargetX - streamX) * Math.min(1, dt * 2.2);
      streamY += (streamTargetY - streamY) * Math.min(1, dt * 2.2);
      streamTargetX *= Math.exp(-dt * 0.5);
      streamTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      thermalStorm *= Math.exp(-dt * 0.9);
      tuttiPulse *= Math.exp(-dt * 2.4);
      night += (nightTarget - night) * Math.min(1, dt * (nightTarget > night ? 1.6 : 2.8));
      // two-finger pan: the frame eases toward the hand's nudge, then home
      panX += (panTargetX - panX) * Math.min(1, dt * 5);
      panY += (panTargetY - panY) * Math.min(1, dt * 5);
      canvas.style.transform = (Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05)
        ? `translate(${panX.toFixed(1)}px, ${panY.toFixed(1)}px)`
        : "";
      // the vessel's lean: solvent convection runs downhill with real gravity
      const gravX = streamX + tiltLeanX * 0.5;
      const gravY = streamY + tiltLeanY * 0.5;

      // deferred notes (the doppler tail, mostly)
      for (let i = pendingNotes.length - 1; i >= 0; i--) {
        if (now >= pendingNotes[i].at) {
          note(pendingNotes[i].midi, pendingNotes[i].ms);
          pendingNotes.splice(i, 1);
        }
      }

      // shared breath: the audio swell clock when audible, RAF when not
      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;

      // the felt tells: one behavioral word per compound, subtle — CO₂
      // warms the field, flammables shiver near heat, the inert airs stay
      // serene, and water finds water (the anomaly as a slow lean)
      const tellMols = mols.filter((m) => !m.retiringAt && m.closed && m.sr > 0);
      let greenhouseCount = 0;
      for (const m of tellMols) if (m.morph.felt === "greenhouse") greenhouseCount += 1;
      greenhouseGlow += (Math.min(0.05, greenhouseCount * 0.012) - greenhouseGlow) * Math.min(1, dt * 0.8);
      for (let i = 0; i < tellMols.length; i++) {
        const m = tellMols[i];
        for (let j = i + 1; j < tellMols.length; j++) {
          const o = tellMols[j];
          const d = Math.hypot(o.sx - m.sx, o.sy - m.sy);
          if (d < 1 || d > (m.sr + o.sr) * 2.4) continue;
          // flammables catch the shiver from hot neighbors
          if (m.morph.felt === "flammable" && o.heat > 0.9) m.heat = Math.min(2, m.heat + dt * 0.55);
          if (o.morph.felt === "flammable" && m.heat > 0.9) o.heat = Math.min(2, o.heat + dt * 0.55);
          // a greenhouse molecule warms whoever drifts past, faintly
          if (m.morph.felt === "greenhouse") o.heat = Math.min(2, o.heat + dt * 0.06);
          if (o.morph.felt === "greenhouse") m.heat = Math.min(2, m.heat + dt * 0.06);
          // water finds water: the hydrogen bond as a quiet mutual lean
          if (m.morph.felt === "anomalous" && o.morph.felt === "anomalous" && !reduce) {
            const k = 30 * dt;
            m.pushX += ((o.sx - m.sx) / d) * k;
            m.pushY += ((o.sy - m.sy) / d) * k;
            o.pushX += ((m.sx - o.sx) / d) * k;
            o.pushY += ((m.sy - o.sy) / d) * k;
          }
        }
      }

      // the bond-hint: reactable neighbors get a dashed arc after a beat —
      // the room proposing the ceremony, never text
      const reactable = (ka: string, kb: string): boolean => {
        const ck = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        let v = reactPairCache.get(ck);
        if (v === undefined) {
          v = reactionForPair(REACTIONS, ka, kb) != null;
          reactPairCache.set(ck, v);
        }
        return v;
      };
      const hintSeen = new Set<string>();
      for (let i = 0; i < tellMols.length; i++) {
        const m = tellMols[i];
        for (let j = i + 1; j < tellMols.length; j++) {
          const o = tellMols[j];
          const d = Math.hypot(o.sx - m.sx, o.sy - m.sy);
          if (d > (m.sr + o.sr) * 2.2 || d < (m.sr + o.sr) * 0.6) continue;
          if (!reactable(m.morph.compound, o.morph.compound)) continue;
          const key = m.id < o.id ? `${m.id}|${o.id}` : `${o.id}|${m.id}`;
          hintSeen.add(key);
          if (!hints.has(key)) hints.set(key, { aId: m.id, bId: o.id, since: now, alpha: 0 });
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

      // molecules: assembly, tumble, decay of pushes/heat/charge, retirement
      for (let i = mols.length - 1; i >= 0; i--) {
        const m = mols[i];
        if (m.retiringAt && now - m.retiringAt > RETIRE_MS) { mols.splice(i, 1); dirty = true; continue; }
        if (!m.closed) buildMol(m, dt * 0.9); // a condensing molecule finishes on its own
        m.heat *= Math.exp(-dt * 0.7);
        m.spin *= Math.exp(-dt * 1.1);
        if (m.morph.felt === "inert") {
          // the still airs: agitation sheds faster, the tumble steadies
          m.heat *= Math.exp(-dt * 1.1);
          m.spin *= Math.exp(-dt * 0.8);
        }
        if (!hold.molId || hold.molId !== m.id) {
          if (kbMolId !== m.id && hold.partnerId !== m.id) m.charge = Math.max(0, m.charge - dt * 1.6);
        }
        if (!reduce) {
          m.rot += (m.morph.tumble * (1 + m.heat * 1.5) + m.spin) * dt * timeScale;
          // slow deterministic wander + currents
          const d = m.morph.drift;
          const wx = Math.sin(localT * d.rate + d.ax) * 0.004;
          const wy = Math.cos(localT * d.rate * 0.8 + d.ay) * 0.0035;
          let vx = wx + (m.pushX + gravX * 30) / Math.max(1, width);
          let vy = wy + (m.pushY + gravY * 30) / Math.max(1, height);
          for (const v of vortices) {
            const age = (now - v.born) / 3000;
            if (age >= 1) continue;
            const dx = m.sx - v.x;
            const dy = m.sy - v.y;
            const dist = Math.max(20, Math.hypot(dx, dy));
            const pull = (v.omega * (1 - age) * 16) / dist;
            vx += (-dy / dist) * pull / Math.max(1, width) * 60;
            vy += (dx / dist) * pull / Math.max(1, height) * 60;
          }
          m.nx = clamp(m.nx + vx * dt * timeScale, 0.04, 0.96);
          m.ny = clamp(m.ny + vy * dt * timeScale, 0.05, 0.96);
          m.pushX *= Math.exp(-dt * 2.4);
          m.pushY *= Math.exp(-dt * 2.4);
        }
      }

      // background — the solvent after dark; the lens dims it to a blackboard.
      // season (three-finger twist) drifts the solvent's ambient warmth on its
      // own slow cycle, independent of the lens's felt↔notation axis.
      const seasonWarm = 0.5 + 0.5 * Math.sin(season * Math.PI * 2);
      const bgTop = mixHex(mixHex("#0e0b10", "#181009", seasonWarm * 0.4), "#161018", lens);
      const bgMid = mixHex(mixHex("#120e12", "#1c1610", seasonWarm * 0.4), "#1d1520", lens);
      const bgLow = mixHex("#151013", "#191118", lens);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, bgTop);
      bg.addColorStop(0.55, bgMid);
      bg.addColorStop(1, bgLow);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // the candle beneath the bench: a breathing warm pool of light
      // greenhouseGlow is CO₂'s tell — the candle pool warms with the census
      const glowPulse = ((reduce ? 0.08 : 0.07 + Math.sin(breath) * 0.025) + greenhouseGlow + seasonWarm * 0.02) * (1 - night * 0.85);
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.44, 10, width * 0.5, height * 0.44, Math.max(width, height) * 0.72);
      glow.addColorStop(0, `rgba(231, 172, 82, ${glowPulse + lens * 0.05})`);
      glow.addColorStop(0.55, "rgba(200, 115, 42, 0.04)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      const iris = ctx.createRadialGradient(width * 0.5, height * 0.5, Math.min(width, height) * 0.55, width * 0.5, height * 0.5, Math.max(width, height) * 0.8);
      iris.addColorStop(0, "rgba(0,0,0,0)");
      iris.addColorStop(1, `rgba(4, 3, 5, ${0.45 + lens * 0.2})`);
      ctx.fillStyle = iris;
      ctx.fillRect(0, 0, width, height);
      // face-down is night: the pool of light goes down until the phone turns back
      if (night > 0.01) {
        ctx.fillStyle = `rgba(4, 3, 5, ${night * 0.6})`;
        ctx.fillRect(0, 0, width, height);
      }

      // solvent motes — the fixed count scales with the frame governor's tier
      const activeMotes = Math.max(8, Math.round(motes.length * detail.particles));
      ctx.save();
      ctx.globalCompositeOperation = lens > 0.5 ? "source-over" : "screen";
      for (let i = 0; i < activeMotes; i++) {
        const m = motes[i];
        if (!reduce) {
          const seethe = 7 * (1 + thermalStorm * 4); // the spike seethes, then cools
          const jx = Math.sin(localT * (1.2 + twinkleHash(i + 47) * 1.9) + twinkleHash(i + 9) * 6.28) * seethe;
          const jy = Math.cos(localT * (1.0 + twinkleHash(i + 89) * 2.1) + twinkleHash(i + 3) * 6.28) * seethe;
          m.vx += (jx - m.vx) * dt * (2 + thermalStorm * 6) + gravX * 130 * dt;
          m.vy += (jy - m.vy) * dt * (2 + thermalStorm * 6) + gravY * 130 * dt;
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
        const tw = reduce ? 0.14 : 0.08 + Math.sin(localT * 0.8 + i) * 0.06;
        const moteColor = lens > 0.5 ? "#3c3244" : i % 6 === 0 ? "#E7AC52" : "#CFC2A6";
        ctx.fillStyle = colorAlpha(moteColor, Math.max(0.03, tw));
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.5 + twinkleHash(i + 317) * 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      for (let i = stirs.length - 1; i >= 0; i--) if (now - stirs[i].born > 1800) stirs.splice(i, 1);
      for (let i = vortices.length - 1; i >= 0; i--) if (now - vortices[i].born > 3000) vortices.splice(i, 1);

      // bond-hint glimmer — a faint dashed arc breathing between the pair
      for (const h of hints.values()) {
        if (h.alpha <= 0.02) continue;
        const pa = mols.find((q) => q.id === h.aId);
        const pb = mols.find((q) => q.id === h.bId);
        if (!pa || !pb || pa.retiringAt || pb.retiringAt || pa.sr <= 0 || pb.sr <= 0) continue;
        const dx = pb.sx - pa.sx;
        const dy = pb.sy - pa.sy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / d;
        const uy = dy / d;
        const x1 = pa.sx + ux * pa.sr * 0.9;
        const y1 = pa.sy + uy * pa.sr * 0.9;
        const x2 = pb.sx - ux * pb.sr * 0.9;
        const y2 = pb.sy - uy * pb.sr * 0.9;
        const bow = d * 0.16;
        const bx2 = (x1 + x2) / 2 - uy * bow;
        const by2 = (y1 + y2) / 2 + ux * bow;
        const breathe = reduce ? 0.75 : 0.6 + 0.4 * Math.sin(now / 700 + (h.since % 1000));
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.2 * h.alpha * breathe);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(bx2, by2, x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // molecules, painter's order by size (small behind, large in front)
      const sorted = [...mols].sort((a, b) => a.morph.radius - b.morph.radius);
      for (const m of sorted) drawMol(m, localT, breath);

      // tutti: one soft ring around every molecule, fading together
      if (tuttiPulse > 0.03) {
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.2 * tuttiPulse);
        ctx.lineWidth = 1;
        for (const m of mols) {
          if (m.retiringAt || m.sr <= 0) continue;
          ctx.beginPath();
          ctx.arc(m.sx, m.sy, m.sr * (1.15 + (1 - tuttiPulse) * 0.25), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // wavefronts — the thermal kick made visible
      for (let i = wavefronts.length - 1; i >= 0; i--) {
        const w = wavefronts[i];
        const age = (now - w.born) / 900;
        if (age >= 1) { wavefronts.splice(i, 1); continue; }
        ctx.strokeStyle = colorAlpha("#E7AC52", (1 - age) * 0.26 * w.strength);
        ctx.lineWidth = 1.4 * (1 - age) + 0.4;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.maxR * age, 0, Math.PI * 2);
        ctx.stroke();
      }

      // indraws — the endothermic equation pulling light toward itself:
      // a cool ring closes on the point and the field dims around it
      // (under reduced motion the ring stands still and simply fades)
      for (let i = indraws.length - 1; i >= 0; i--) {
        const w = indraws[i];
        const age = (now - w.born) / 1100;
        if (age >= 1) { indraws.splice(i, 1); continue; }
        const ig = ctx.createRadialGradient(w.x, w.y, 2, w.x, w.y, w.maxR * 1.4);
        ig.addColorStop(0, `rgba(4, 3, 5, ${0.3 * (1 - age)})`);
        ig.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = ig;
        ctx.fillRect(w.x - w.maxR * 1.4, w.y - w.maxR * 1.4, w.maxR * 2.8, w.maxR * 2.8);
        const rr = reduce ? w.maxR * 0.55 : w.maxR * (1 - age);
        ctx.strokeStyle = colorAlpha("#6997A4", 0.3 * (1 - Math.abs(age * 2 - 1)));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(w.x, w.y, Math.max(2, rr), 0, Math.PI * 2);
        ctx.stroke();
      }

      // specks (bursts, comets, released reaction energy)
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
    <div className="molecules-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="molecules-field"
        role="application"
        tabIndex={0}
        aria-label="a solvent kept dark and warm — rest a finger and a molecule assembles bond by bond; hold where two drift near and they react, with real stoichiometry when the neighbors allow; arrows walk, enter kindles and, held beside a neighbor, reacts"
      >
        <canvas ref={canvasRef} className="molecules-canvas" aria-hidden="true" />
      </div>

      <LetGo label="let the solution clear" onLetGo={() => clearRef.current()} visible={hasMols} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .molecules-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #0e0b10;
          overflow: hidden;
        }

        .molecules-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .molecules-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.molecules-page) {
          overflow: hidden;
          background: #0e0b10;
        }

        body:has(.molecules-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.molecules-page) .oda-field-watch,
        body:has(.molecules-page) .oda-candle-mark,
        body:has(.molecules-page) .oda-tape-shell,
        body:has(.molecules-page) .oda-sound-toggle {
          display: none !important;
        }

        .molecules-canvas {
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
