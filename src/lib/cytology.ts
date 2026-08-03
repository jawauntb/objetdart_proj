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
 *
 * The culture's own clock (advanceCulture / catchUpCulture, below) lives here
 * too, for the same reason: it is a pure decode of (stored state, elapsed
 * real hours) into the next culture, deterministic and node-testable, with
 * no DOM or wall-clock read inside it — the room passes Date.now() in.
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

// ─────────────────────────────────────────────────────────────────────────
// The culture's own clock — accumulating persistence (plan the-third-law).
//
// A dish left overnight has gone on without you: some cells divided into
// descendants, some settled and dimmed, the population eased toward its own
// resting point. The whole gap is captured in ONE relaxation step per cell —
// never a loop over elapsed hours — so a dish opened after six months costs
// exactly what one opened after six minutes costs. That is the bound: cost
// is a function of population size (≤ MAX_CELLS), never of elapsed time.
//
// Growth and thinning are the same formula read two ways: population relaxes
// exponentially toward STEADY_POPULATION from either side. Left below it, a
// lone cell's descendants fill the dish in; left above it (someone divided
// fast right before closing the tab), the eldest settle and the census eases
// back down. Bounded, deterministic, and it never touches an empty dish —
// letting the culture rest (LetGo) is the only way to zero it, and it stays
// zero until a hand plants something new.

export const HOUR_MS = 3_600_000;
/** Hours beyond which nothing further changes. The relaxation below already
 *  saturates well inside this; it exists so a corrupt or far-future stored
 *  clock can't be fed an astronomical exponent. */
export const MAX_CATCHUP_H = 24 * 60; // 60 days
/** The population's own resting point. Comfortably under MAX_CELLS so a
 *  dish grown large by hand still has room to visibly ease back, and one
 *  left dividing from a single cell has room to visibly fill in. */
export const STEADY_POPULATION = 14;
/** e-folding time of the relaxation toward STEADY_POPULATION, hours. */
const RELAX_TAU_H = 40;
/** e-folding time of a cell's vitality decay toward its floor, hours. */
const VITALITY_TAU_H = 30;
/** A settled cell never reads as fully spent — it dims, it does not go dark. */
export const VITALITY_FLOOR = 0.35;
/** Bounded positional wander applied once per catch-up, nx units. */
const MAX_DRIFT = 0.05;
const DRIFT_TAU_H = 60;

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** One resident as the culture's persisted state knows it — a compact
 *  vector, never frame data. Position, lineage depth, and freshness are
 *  enough to redraw a whole cell from `cellFromSeed`. */
export type LineageCell = {
  id: string;
  seed: number;
  nx: number;
  ny: number;
  generation: number;
  /** 0..1 — how recently this cell (or an ancestor at this spot) was fresh.
   *  Starts at 1 on seeding or division; decays only across real elapsed
   *  time between visits, never within a live session. */
  vitality: number;
};

export type StoredCulture = { cells: LineageCell[]; lastSeen: number };

/** Deterministic per-seed angle, reused for both division offset and the
 *  bounded drift nudge (a different salt keeps the two independent). */
function seedAngle(seed: number, salt: number): number {
  return (hashSeed(seed, salt) / 4294967296) * Math.PI * 2;
}

/**
 * Advance a culture across `hoursAway` real hours in one closed-form pass.
 * Pure and deterministic: identical inputs always produce the identical
 * culture. An empty dish is a real, remembered state — nothing grows from
 * nothing, so it is returned untouched.
 */
export function advanceCulture(cells: LineageCell[], hoursAwayRaw: number): LineageCell[] {
  if (cells.length === 0) return cells;
  const hoursAway = clamp(hoursAwayRaw, 0, MAX_CATCHUP_H);
  if (hoursAway <= 0) return cells;

  const decay = Math.exp(-hoursAway / VITALITY_TAU_H);
  let pool: LineageCell[] = cells.map((c) => ({
    ...c,
    vitality: Math.max(VITALITY_FLOOR, Math.min(1, c.vitality * decay)),
  }));

  const target =
    STEADY_POPULATION + (pool.length - STEADY_POPULATION) * Math.exp(-hoursAway / RELAX_TAU_H);
  const rounded = Math.max(1, Math.min(MAX_CELLS, Math.round(target)));

  if (rounded > pool.length) {
    // growth: the healthiest resident divides first, seed breaking ties so
    // the same gap always cascades through the same lineage.
    let growable = Math.min(rounded - pool.length, MAX_CELLS - pool.length);
    let guard = 0;
    while (growable > 0 && pool.length > 0 && guard < MAX_CELLS * 2) {
      guard += 1;
      pool.sort((a, b) => b.vitality - a.vitality || a.seed - b.seed);
      const parent = pool[0];
      const [sa, sb] = daughterSeeds(parent.seed, parent.generation);
      const gen = parent.generation + 1;
      const axis = seedAngle(parent.seed, 71);
      const off = 0.05;
      const a: LineageCell = {
        id: `ce-${sa.toString(36)}-${gen}`,
        seed: sa,
        nx: clamp01(parent.nx + Math.cos(axis) * off),
        ny: clamp(parent.ny + Math.sin(axis) * off, 0.06, 0.96),
        generation: gen,
        vitality: 1,
      };
      const b: LineageCell = {
        id: `ce-${sb.toString(36)}-${gen}`,
        seed: sb,
        nx: clamp01(parent.nx - Math.cos(axis) * off),
        ny: clamp(parent.ny - Math.sin(axis) * off, 0.06, 0.96),
        generation: gen,
        vitality: 1,
      };
      pool = pool.filter((c) => c !== parent);
      pool.push(a, b);
      growable -= 1;
    }
  } else if (rounded < pool.length) {
    // thinning: the lowest-vitality residents settle out first — a census
    // easing back to the dish's own resting point, never to nothing.
    const shrink = pool.length - rounded;
    pool = [...pool].sort((a, b) => a.vitality - b.vitality || a.seed - b.seed).slice(shrink);
  }

  // bounded drift: survivors wander a little further from where they were
  // left, saturating with elapsed time — never a teleport, never unbounded.
  pool = pool.map((c) => {
    const mag = MAX_DRIFT * (1 - Math.exp(-hoursAway / DRIFT_TAU_H));
    const a = seedAngle(c.seed, 911);
    return {
      ...c,
      nx: clamp01(c.nx + Math.cos(a) * mag),
      ny: clamp(c.ny + Math.sin(a) * mag, 0.05, 0.96),
    };
  });

  return settlePopulation(pool, MAX_CELLS).kept;
}

/** Validate one persisted resident. Never throws; a malformed entry is
 *  simply dropped rather than corrupting the culture. */
function validateLineageCell(raw: unknown): LineageCell | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== "string") return null;
  if (typeof n.seed !== "number" || !Number.isFinite(n.seed)) return null;
  if (typeof n.nx !== "number" || !Number.isFinite(n.nx)) return null;
  if (typeof n.ny !== "number" || !Number.isFinite(n.ny)) return null;
  const generation =
    typeof n.generation === "number" && Number.isFinite(n.generation) ? Math.max(0, Math.floor(n.generation)) : 0;
  const vitality = typeof n.vitality === "number" && Number.isFinite(n.vitality) ? clamp01(n.vitality) : 1;
  return { id: n.id, seed: n.seed >>> 0, nx: clamp01(n.nx), ny: clamp01(n.ny), generation, vitality };
}

/**
 * Decode a persisted culture from an arbitrary parsed JSON value. Corrupt,
 * partial, or absent state degrades to a well-formed empty culture rather
 * than throwing — a bad localStorage value must never break the room.
 */
export function validateStoredCulture(raw: unknown, nowMs: number): StoredCulture {
  const empty: StoredCulture = { cells: [], lastSeen: nowMs };
  if (!raw || typeof raw !== "object") return empty;
  const n = raw as Record<string, unknown>;
  const cells = Array.isArray(n.cells)
    ? n.cells.map(validateLineageCell).filter((c): c is LineageCell => c != null).slice(-MAX_CELLS)
    : [];
  // A missing/invalid clock reads as "just seen now" — first load after this
  // shipped, or a legacy record with no clock, never fast-forwards a culture
  // that was never actually left alone.
  const lastSeen = typeof n.lastSeen === "number" && Number.isFinite(n.lastSeen) ? n.lastSeen : nowMs;
  return { cells, lastSeen };
}

/**
 * The single entry point a room calls on load: decode the elapsed real
 * hours since `stored.lastSeen` and advance the culture across the gap. A
 * clock set backwards (or a stored future timestamp) reads as zero elapsed —
 * never negative, never a jump.
 */
export function catchUpCulture(stored: StoredCulture, nowMs: number): StoredCulture {
  const hoursAway = Math.max(0, (nowMs - stored.lastSeen) / HOUR_MS);
  return { cells: advanceCulture(stored.cells, hoursAway), lastSeen: nowMs };
}
