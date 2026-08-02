/**
 * Cytology — the cell latent for /cells (plan W6, the first new band).
 *
 * A cell IS its seed: one 32-bit number decodes deterministically into a
 * whole morphology — membrane wobble harmonics, nucleus, organelles, cilia,
 * streaming direction, a voice. Division is deterministic too: a parent's
 * seed yields exactly two daughter seeds, and the low nibble of every seed
 * (HERITABLE_MASK) survives division unchanged, so a lineage keeps its
 * palette family and cilia character down the generations while everything
 * else perturbs.
 *
 * Pure and import-free by law: same seed = same cell, forever. No DOM, no
 * audio, no side effects — node-testable standalone (scripts/test-cytology.mjs).
 * The room that renders these (CellsPlasm) owns canvas, sound, and haptics.
 */

/** Hard population cap for the plasm; divisions beyond it retire the oldest. */
export const MAX_CELLS = 24;

/**
 * The low nibble of a seed is the lineage: bits 0–1 pick the palette family,
 * bits 2–3 the cilia character. daughterSeeds() preserves it verbatim.
 */
export const HERITABLE_MASK = 0x0f;

/**
 * The only colors a cell may wear — ramps around the site tokens
 * (--candle #C8732A, --closed #7A1F1F, --sea #2C4A5C, --paper #F2EEE6),
 * each family ordered dark → light. Index = the heritable family bits.
 */
export const CELL_FAMILIES = [
  ["#9C5820", "#B36524", "#C8732A", "#DA8F3B", "#E7AC52", "#F2C56B"], // gold
  ["#4F1414", "#5E1717", "#7A1F1F", "#8E2B2B", "#9C3D33", "#B25048"], // merlot
  ["#1E3440", "#243D4A", "#2C4A5C", "#3A6172", "#4E7D8C", "#6997A4"], // sea
  ["#B8A87F", "#CFC2A6", "#DDD3BE", "#E8E2D5", "#F2EEE6", "#F7F3EA"], // parchment
] as const;

/** Cilia counts by heritable class — some lineages are smooth-membraned. */
const CILIA_CLASSES = [0, 10, 16, 24] as const;

function mix32(n: number): number {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Fold any integer parts into one 32-bit seed (order-sensitive). */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = mix32(h ^ Math.imul(Math.floor(p) | 0, 0x9e3779b1));
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type OrganelleKind = "mitochondrion" | "vacuole" | "granule";

export type Organelle = {
  kind: OrganelleKind;
  /** Orbit radius as a fraction of the cell radius. */
  orbit: number;
  /** Starting angle on its streaming orbit, radians. */
  phase: number;
  /** Streaming speed, radians/second (signed). */
  speed: number;
  /** Size as a fraction of the cell radius. */
  size: number;
  /** Ellipse aspect (1 = round, >1 = lozenge). */
  ecc: number;
  /** Own rotation, radians. */
  tilt: number;
};

export type CellMorph = {
  /** Body radius as a fraction of the field's smaller dimension. */
  radius: number;
  /** Horizontal/vertical squash of the whole body. */
  aspect: number;
  /** Integer-harmonic membrane wobble; integer k keeps the outline closed. */
  wobble: Array<{ k: number; amp: number; phase: number; speed: number }>;
  /** Heritable palette family (index into CELL_FAMILIES). */
  family: 0 | 1 | 2 | 3;
  /** Ramp index of the membrane tone inside the family. */
  membraneTone: number;
  /** Cytoplasm translucency, 0..1. */
  cytoAlpha: number;
  nucleus: { dx: number; dy: number; r: number; nucleolus: number };
  organelles: Organelle[];
  cilia: { count: number; length: number; rateHz: number; phase: number };
  stream: { dir: 1 | -1; rate: number };
  drift: { ax: number; ay: number; rate: number };
  breathOffset: number;
  /** Chromatic voice offset, 0..11 semitones. */
  voice: number;
};

/** Decode a seed into a full morphology. Pure: same seed, same cell. */
export function cellFromSeed(seed: number): CellMorph {
  const s = seed >>> 0;
  const heritable = s & HERITABLE_MASK;
  const family = (heritable & 3) as 0 | 1 | 2 | 3;
  const ciliaClass = (heritable >> 2) & 3;
  const rng = mulberry32(mix32(s || 1));

  const radius = 0.055 + rng() * 0.05;
  const aspect = 0.85 + rng() * 0.3;

  const wobbleN = 3 + Math.floor(rng() * 3);
  const ampBudget = 0.14 + rng() * 0.12; // Σ amps ≤ 0.26 — outline stays convex-ish and positive
  const raw: number[] = [];
  let rawSum = 0;
  for (let j = 0; j < wobbleN; j++) {
    const w = 0.35 + rng();
    raw.push(w);
    rawSum += w;
  }
  const wobble = raw.map((w, j) => ({
    k: 2 + j,
    amp: (w / rawSum) * ampBudget,
    phase: rng() * Math.PI * 2,
    speed: (0.08 + rng() * 0.3) * (rng() < 0.5 ? -1 : 1),
  }));

  const nucleus = {
    dx: (rng() - 0.5) * 0.5,
    dy: (rng() - 0.5) * 0.5,
    r: 0.3 + rng() * 0.16,
    nucleolus: 0.22 + rng() * 0.14,
  };

  const organelleN = 5 + Math.floor(rng() * 8);
  const organelles: Organelle[] = [];
  for (let i = 0; i < organelleN; i++) {
    const roll = rng();
    const kind: OrganelleKind =
      roll < 0.42 ? "mitochondrion" : roll < 0.68 ? "vacuole" : "granule";
    organelles.push({
      kind,
      orbit: 0.42 + rng() * 0.4,
      phase: rng() * Math.PI * 2,
      speed: (0.1 + rng() * 0.35) * (rng() < 0.5 ? -1 : 1),
      size:
        kind === "mitochondrion"
          ? 0.1 + rng() * 0.06
          : kind === "vacuole"
            ? 0.11 + rng() * 0.09
            : 0.035 + rng() * 0.035,
      ecc: kind === "mitochondrion" ? 2.1 + rng() * 0.9 : 1,
      tilt: rng() * Math.PI * 2,
    });
  }

  const cilia = {
    count: CILIA_CLASSES[ciliaClass] + Math.floor(rng() * 6),
    length: 0.1 + rng() * 0.08,
    rateHz: 0.7 + rng() * 0.9,
    phase: rng() * Math.PI * 2,
  };

  return {
    radius,
    aspect,
    wobble,
    family,
    membraneTone: 2 + Math.floor(rng() * 3),
    cytoAlpha: 0.1 + rng() * 0.08,
    nucleus,
    organelles,
    cilia,
    stream: { dir: rng() < 0.5 ? -1 : 1, rate: 0.5 + rng() * 0.7 },
    drift: { ax: rng() * Math.PI * 2, ay: rng() * Math.PI * 2, rate: 0.12 + rng() * 0.3 },
    breathOffset: rng() * 7,
    voice: Math.floor(rng() * 12),
  };
}

/**
 * Membrane radius multiplier at angle theta, time t seconds. Integer
 * harmonics guarantee closure: the outline meets itself exactly at 2π.
 */
export function membraneRadius(morph: CellMorph, theta: number, t: number): number {
  let r = 1;
  for (const w of morph.wobble) {
    r += w.amp * Math.sin(w.k * theta + w.phase + t * w.speed);
  }
  return r;
}

/**
 * Mitosis: one seed becomes exactly two. Daughters are perturbed copies —
 * the heritable nibble is inherited verbatim, everything above it re-rolls
 * from the parent seed and generation, so the lineage tree is a pure
 * function of its root. Collisions (daughter === parent or sibling) fold a
 * lineage onto itself, so they are re-rolled deterministically.
 */
export function daughterSeeds(seed: number, generation: number): [number, number] {
  const s = seed >>> 0;
  const heritable = s & HERITABLE_MASK;
  const out: number[] = [];
  for (let i = 1; i <= 2; i++) {
    let round = 0;
    let d = ((hashSeed(s, generation + 1, i, round) & ~HERITABLE_MASK) | heritable) >>> 0;
    while (d === s || (out.length > 0 && d === out[0])) {
      round += 1;
      d = ((hashSeed(s, generation + 1, i, round) & ~HERITABLE_MASK) | heritable) >>> 0;
    }
    out.push(d);
  }
  return [out[0], out[1]];
}

/**
 * Enforce the population cap: the oldest residents (front of the list, which
 * the room keeps in arrival order) retire first, gracefully, never the new.
 */
export function settlePopulation<T>(cells: T[], cap: number = MAX_CELLS): { kept: T[]; retired: T[] } {
  const over = Math.max(0, cells.length - Math.max(1, cap));
  return { kept: cells.slice(over), retired: cells.slice(0, over) };
}
