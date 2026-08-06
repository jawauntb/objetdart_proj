/**
 * membrane — the organs before the body.
 *
 * The invariant is a MEMBRANE BUDGET. Every organelle is surface area
 * folded into a volume, and the room conserves it: flatten a fold
 * somewhere and the area has to go somewhere else. Nothing in /organelles
 * is created or destroyed, only redistributed.
 *
 * The load-bearing map is folded surface → timbre brightness. A tightly
 * cristae-folded mitochondrion rings bright and complex; a smooth vesicle
 * is a sine. You can hear how folded a thing is, and `foldednessFromHarmonics`
 * reads it back, so the timbre is a measurement rather than a mood.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-membrane.mjs).
 * See docs/plans/life-and-vista-bands.md §2 and INSPIRATION.md §2.
 */

export type MembraneKind =
  | "mitochondrion"
  | "ribosome"
  | "golgi"
  | "er"
  | "vacuole"
  | "nucleus";

export const MEMBRANE_KINDS: readonly MembraneKind[] = [
  "mitochondrion",
  "ribosome",
  "golgi",
  "er",
  "vacuole",
  "nucleus",
];

export const MAX_ORGANELLES = 12;

/**
 * The cytoplasm holds exactly this much membrane, in units of one smooth
 * unit-radius vesicle's circumference (2π). It is a budget, not a target:
 * the room may hold it in six tight folds or one wide sac, but never in
 * more of it than this.
 */
export const MEMBRANE_BUDGET = 96;

/** No organelle may be flattened out of existence, nor eat the whole cell. */
export const AREA_FLOOR = 1.6;
export const AREA_CEILING = 34;

export type Organelle = {
  kind: MembraneKind;
  seed: number;
  /** how many cristae / cisternae ride the membrane */
  folds: number;
  /** the depth of those folds, 0 = a smooth sac */
  amplitude: number;
  /** the enclosed size */
  radius: number;
  /** where it sits in the plasm, normalized */
  nx: number;
  ny: number;
};

const TAU = Math.PI * 2;

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The membrane's radius at angle θ — the parametric surface itself. */
export function membraneRadius(o: Organelle, theta: number, breath = 0): number {
  const wobble = 1 + breath * 0.03;
  return o.radius * (1 + o.amplitude * Math.sin(o.folds * theta)) * wobble;
}

/** A point on the membrane. Closed by construction: θ and θ+2π agree. */
export function membranePoint(o: Organelle, theta: number, breath = 0): { x: number; y: number } {
  const r = membraneRadius(o, theta, breath);
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

/**
 * The arclength of that closed curve — the actual surface area the budget
 * is spent on.
 *
 * ∫₀^2π √(r² + (dr/dθ)²) dθ under Simpson's rule, not a sum of chords: a
 * chord sum systematically UNDER-counts a curve, so a smooth sac would
 * measure a hair under 2πr and every "unfolded" membrane in the room would
 * quietly read as folded inward. Simpson on the analytic integrand is exact
 * for the constant case, which is the case we can check by hand.
 */
function membraneArcSpeed(o: Organelle, theta: number): number {
  const r = o.radius * (1 + o.amplitude * Math.sin(o.folds * theta));
  const dr = o.radius * o.amplitude * o.folds * Math.cos(o.folds * theta);
  return Math.hypot(r, dr);
}

export function surfaceArea(o: Organelle, samples = 360): number {
  const n = Math.max(2, samples % 2 === 0 ? samples : samples + 1);
  const h = TAU / n;
  let sum = membraneArcSpeed(o, 0) + membraneArcSpeed(o, TAU);
  for (let i = 1; i < n; i++) {
    sum += membraneArcSpeed(o, i * h) * (i % 2 === 1 ? 4 : 2);
  }
  return (h / 3) * sum;
}

/**
 * How folded a thing is: its perimeter over the perimeter of the smooth
 * sac that holds the same radius. Exactly 1 for a vesicle, and more the
 * deeper the cristae run — the number the timbre reports on.
 */
export function foldedness(o: Organelle): number {
  const smooth = TAU * o.radius;
  if (smooth <= 0) return 1;
  return surfaceArea(o) / smooth;
}

/** Set an organelle's amplitude so it spends exactly `area` of the budget. */
export function withArea(o: Organelle, area: number): Organelle {
  const target = Math.max(AREA_FLOOR, Math.min(AREA_CEILING, area));
  // Bisection on amplitude: surfaceArea is monotone in it, so this
  // converges and there is exactly one answer.
  const smoothArea = surfaceArea({ ...o, amplitude: 0 });
  if (target <= smoothArea) {
    // Below the smooth floor the sac itself must shrink; folds go to zero.
    return { ...o, amplitude: 0, radius: Math.max(0.02, target / TAU) };
  }
  // Widen the bracket until it actually contains the answer, then bisect.
  let lo = 0;
  let hi = 0.85;
  while (surfaceArea({ ...o, amplitude: hi }) < target && hi < 64) hi *= 2;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (surfaceArea({ ...o, amplitude: mid }) < target) lo = mid;
    else hi = mid;
  }
  return { ...o, amplitude: (lo + hi) / 2 };
}

export function totalArea(list: Organelle[]): number {
  let sum = 0;
  for (const o of list) sum += surfaceArea(o);
  return sum;
}

/**
 * Move `delta` of membrane into organelle `i`, taken from (or given to)
 * every other organelle in proportion to what it already holds.
 *
 * This is the room's whole law: the total is conserved exactly. Where a
 * clamp bites — an organelle that cannot give any more, or take any more —
 * the leftover is returned to the one it came from rather than vanishing,
 * so the sum after equals the sum before whatever the hand asks for.
 */
export function redistribute(list: Organelle[], i: number, delta: number): Organelle[] {
  if (list.length < 2 || i < 0 || i >= list.length) return list;
  const areas = list.map((o) => surfaceArea(o));
  const before = areas.reduce((a, b) => a + b, 0);

  const want = areas[i] + delta;
  const got = Math.max(AREA_FLOOR, Math.min(AREA_CEILING, want));
  let moved = got - areas[i];
  if (moved === 0) return list;

  // Take (or give) the counterpart from the others, proportionally, and
  // discover how much they can actually absorb.
  const othersTotal = before - areas[i];
  if (othersTotal <= 0) return list;
  let absorbed = 0;
  const nextOthers = areas.map((a, k) => {
    if (k === i) return a;
    const share = (a / othersTotal) * -moved;
    const capped = Math.max(AREA_FLOOR, Math.min(AREA_CEILING, a + share));
    absorbed += capped - a;
    return capped;
  });
  // Whatever the others could not take is not created: it stays where it
  // was, so the ledger closes.
  moved = -absorbed;
  nextOthers[i] = areas[i] + moved;

  return list.map((o, k) => withArea(o, nextOthers[k]));
}

// ——— vesicles: membrane in transit ——————————————————————————————
//
// A vesicle is not a new object in the ledger — it is membrane that has
// left one organ and has not yet arrived at another. Budding takes area
// OUT of a parent and fusion puts exactly that area back, so the room's
// one law (the total never moves) survives the whole secretory pathway.

/** The states cargo passes through, in the order the cell actually does it. */
export type CargoStage = "raw" | "folded" | "mature";
export const CARGO_STAGES: readonly CargoStage[] = ["raw", "folded", "mature"];

/** The smallest parcel of membrane that can travel on its own. */
export const VESICLE_AREA = 2.4;

/**
 * Which organ advances which stage. The pathway is ordered: the er folds
 * what the ribosome made, the golgi matures what the er folded, and nothing
 * skips a station. A golgi handed raw cargo can do nothing with it.
 */
export function advanceCargo(cargo: CargoStage, kind: MembraneKind): CargoStage {
  if (cargo === "raw" && kind === "er") return "folded";
  if (cargo === "folded" && kind === "golgi") return "mature";
  return cargo;
}

/** Where a parcel at this stage is trying to get to next. */
export function cargoDestination(cargo: CargoStage): MembraneKind | null {
  if (cargo === "raw") return "er";
  if (cargo === "folded") return "golgi";
  return null; // mature cargo leaves the cell entirely
}

/**
 * Bud a vesicle off an organelle. The parent shrinks by exactly the area
 * that left; refused outright when the parent cannot spare it, because a
 * bud that overdraws would quietly mint membrane.
 */
export function budVesicle(o: Organelle, area = VESICLE_AREA): { parent: Organelle; area: number } | null {
  const have = surfaceArea(o);
  const take = Math.max(0, area);
  if (take <= 0 || have - take < AREA_FLOOR) return null;
  return { parent: withArea(o, have - take), area: take };
}

/** ...and fusion, the same ledger entry read the other way. */
export function fuseVesicle(o: Organelle, area: number): Organelle {
  return withArea(o, surfaceArea(o) + Math.max(0, area));
}

/**
 * Fission: one organ becomes two, and the membrane is halved, not copied.
 * The daughters keep the parent's fold character (they are the same organ,
 * divided) but each carries its own seed, so they diverge from here.
 */
export function fissionOrganelle(o: Organelle): [Organelle, Organelle] | null {
  const have = surfaceArea(o);
  if (have / 2 < AREA_FLOOR) return null;
  const half = have / 2;
  const a = withArea({ ...o, seed: hashSeed(o.seed, 1) >>> 0 }, half);
  const b = withArea({ ...o, seed: hashSeed(o.seed, 2) >>> 0 }, half);
  return [a, b];
}

/**
 * What the plasm still holds loose: the budget minus everything currently
 * folded into an organ or riding in a vesicle. Never negative — an
 * over-full plasm has nothing free rather than a debt.
 */
export function freeMembrane(list: Organelle[], inTransit = 0): number {
  return Math.max(0, MEMBRANE_BUDGET - totalArea(list) - Math.max(0, inTransit));
}

// ——— folded surface → timbre ————————————————————————————————————

/** The most partials the room will ever ring at once. */
export const MAX_HARMONICS = 12;

/**
 * Foldedness → how many partials the membrane rings with. A smooth sac is
 * one partial — a sine, exactly. This is the map the ear reads.
 */
export function harmonicsFor(fold: number): number {
  const f = Math.max(1, fold);
  return Math.max(1, Math.min(MAX_HARMONICS, Math.round(1 + (f - 1) * 7)));
}

/** ...and back: the partial count names the foldedness it came from. */
export function foldednessFromHarmonics(h: number): number {
  const n = Math.max(1, Math.min(MAX_HARMONICS, Math.round(h)));
  return 1 + (n - 1) / 7;
}

/** 0..1 brightness for the room's palette and its filter alike. */
export function brightness(o: Organelle): number {
  return (harmonicsFor(foldedness(o)) - 1) / (MAX_HARMONICS - 1);
}

/** Where each kind sits in pitch — bigger organs ring lower. */
export const KIND_BASE_HZ: Record<MembraneKind, number> = {
  ribosome: 620,
  mitochondrion: 330,
  golgi: 262,
  er: 196,
  vacuole: 147,
  nucleus: 110,
};

// ——— the set, and what closes around it ——————————————————————————

/** Which of the six the plasm is still missing. */
export function missingKinds(list: Organelle[]): MembraneKind[] {
  const have = new Set(list.map((o) => o.kind));
  return MEMBRANE_KINDS.filter((k) => !have.has(k));
}

/**
 * The handoff: when all six organs stand in one plasm, the cell membrane
 * closes around them of its own accord and the band above has its material.
 */
export function hasFullSet(list: Organelle[]): boolean {
  return missingKinds(list).length === 0;
}

/** How much of the cell's organ set is present; duplicates never fake a body. */
export function membraneCompleteness(list: Pick<Organelle, "kind">[]): number {
  const have = new Set<MembraneKind>();
  for (const o of list) {
    if (MEMBRANE_KINDS.includes(o.kind)) have.add(o.kind);
  }
  return have.size / MEMBRANE_KINDS.length;
}

export const CELL_GHOST_RADIUS = 0.44;
export const CELL_GHOST_GATHER_BAND = 0.16;

export type CellWellPull = {
  /** unit vector in normalized room coordinates, pointing into the well */
  x: number;
  y: number;
  /** 0..1, scaled by how complete the membrane ghost already is */
  strength: number;
};

/**
 * The forming cell is a well: an organelle near the center, or brushing the
 * ghost membrane, feels a soft centripetal draw. Coordinates are normalized;
 * aspect scales distance so the circular ring stays circular on wide screens.
 */
export function cellWellPull(
  nx: number,
  ny: number,
  completeness = 1,
  aspectX = 1,
  aspectY = 1,
): CellWellPull {
  const vx = 0.5 - nx;
  const vy = 0.5 - ny;
  const rawDistance = Math.hypot(vx, vy);
  if (rawDistance < 1e-6) return { x: 0, y: 0, strength: 0 };

  const scaledDistance = Math.hypot((nx - 0.5) * aspectX, (ny - 0.5) * aspectY);
  const insideWell = Math.max(0, 1 - scaledDistance / CELL_GHOST_RADIUS);
  const nearMembrane = Math.max(0, 1 - Math.abs(scaledDistance - CELL_GHOST_RADIUS) / CELL_GHOST_GATHER_BAND);
  const field = Math.max(insideWell * 0.7, nearMembrane);
  const ready = Math.max(0, Math.min(1, completeness));

  return {
    x: vx / rawDistance,
    y: vy / rawDistance,
    strength: Math.max(0, Math.min(1, field * (0.25 + ready * 0.75))),
  };
}

// ——— determinism ————————————————————————————————————————————

const KIND_SHAPE: Record<MembraneKind, { folds: [number, number]; amp: [number, number]; radius: [number, number] }> = {
  mitochondrion: { folds: [8, 13], amp: [0.09, 0.16], radius: [0.9, 1.3] },
  ribosome: { folds: [3, 5], amp: [0.05, 0.1], radius: [0.3, 0.42] },
  golgi: { folds: [5, 8], amp: [0.11, 0.19], radius: [0.8, 1.1] },
  er: { folds: [10, 16], amp: [0.12, 0.21], radius: [1.1, 1.6] },
  vacuole: { folds: [2, 3], amp: [0, 0.03], radius: [1.2, 1.8] },
  nucleus: { folds: [3, 5], amp: [0.03, 0.08], radius: [1.5, 2.1] },
};

export function organelleFromSeed(kind: MembraneKind, seed: number): Organelle {
  const rng = mulberry32(seed >>> 0);
  const shape = KIND_SHAPE[kind];
  const lerp = (r: [number, number]) => r[0] + rng() * (r[1] - r[0]);
  return {
    kind,
    seed: seed >>> 0,
    folds: Math.round(lerp(shape.folds)),
    amplitude: lerp(shape.amp),
    radius: lerp(shape.radius),
    nx: 0.15 + rng() * 0.7,
    ny: 0.15 + rng() * 0.7,
  };
}

/** Oldest retired first; the plasm never holds more than it can. */
export function settlePopulation(list: Organelle[], cap = MAX_ORGANELLES): Organelle[] {
  return list.length <= cap ? list : list.slice(list.length - cap);
}
