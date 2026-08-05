// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.domain_lib.title,
//           spec.domain_lib.brief, spec.invariant_type, spec.key.
// One LLM slot below carries the actual physics; the prelude is verbatim.

/**
 * pebblecore — the laws of /pebble.
 *
 * The invariant is a state vector: 
 *
 * Pure math, no imports, no DOM — node-testable
 * (scripts/test-pebblecore.mjs). See INSPIRATION.md §2 (maps
 * between representations) and §4 (aliveness down the stack), and
 * docs/new-room.md §4.
 */

// ——— determinism ————————————————————————————————————————————————

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

export const clamp = (v: number, a: number, b: number): number =>
  v < a ? a : v > b ? b : v;
export const clamp01 = (v: number): number => clamp(v, 0, 1);

// ——— the invariant, and every process that only moves it ———————————

/**
 * The lattice of ONE stone. Redeclared here — pebblecore never imports
 * crystal.ts, so the two rooms' domain libs stay independent (and each is
 * pinned by its own test file).
 */
export type SystemId = "cubic" | "tetragonal" | "hexagonal" | "orthorhombic";
export type Centering = "P" | "I" | "F";

export type Lattice = {
  system: SystemId;
  centering: Centering;
  /** axial ratios with a ≡ 1; ba = b/a, ca = c/a */
  ba: number;
  ca: number;
  /** axial angles, degrees */
  alpha: number;
  beta: number;
  gamma: number;
};

/** One accretion event in the stone's history — oldest ring is at index 0. */
export type MineralId =
  | "calcite"
  | "quartz"
  | "jasper"
  | "agate"
  | "chert"
  | "chalcedony"
  | "feldspar"
  | "obsidian";

export type GrowthRing = {
  /** Fractional radius in [0, 1] — 0 is the seed, 1 is the outer envelope. */
  radius: number;
  mineral: MineralId;
  /** How thick this ring is, in the same normalized units. */
  thickness: number;
  /** Deterministic phase in [0, 1]. */
  seed: number;
};

export type PebbleState = {
  lattice: Lattice;
  /** Oldest-first; every entry's radius is monotone-increasing. */
  growthRings: GrowthRing[];
  /** How far the outer shell has been abraded, in [0, POLISH_MAX]. */
  polishDepth: number;
  /** Season phase in [0, 1). */
  season: number;
  /** Seconds of maturity — non-negative, capped at MAX_ELAPSED_S. */
  tau: number;
  /** Deterministic seed for the stone as a whole. */
  seedKey: number;
};

export type Climate = {
  /** How hard the stream carries the stone — raises polish rate. */
  waterCarry: number;
  /** How high the lattice-pressure is — raises accretion rate. */
  latticePressure: number;
};

// ——— physical constants ————————————————————————————————————————————

/** How far the polish can go before the stone is one big smooth ellipsoid. */
export const POLISH_MAX = 0.35;
/** Time constant of polish saturation — one hundred years for full polish. */
export const POLISH_TAU_S = 1e7;
/** Time constant of accretion — a growth ring per season under peak pressure. */
export const GROWTH_TAU_S = 60 * 60 * 24 * 30; // ~30 days per new ring
/** Maximum number of growth rings a stone can carry. */
export const MAX_GROWTH_RINGS = 24;
/** Names of the minerals the pebble can be made of. */
export const MINERAL_COUNT = 8;
/** Cap on elapsed time — a month away can never become a century. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;

/** Base pitch and scale for the invertible HEAD-analog map. */
export const PITCH_BASE_HZ = 220;
export const PITCH_SCALE = 0.55;

/** Polish damping — the exponential coefficient. */
export const POLISH_DAMPING_K = 4.0;

/** Standard angles for each crystal system. */
export function anglesFor(system: SystemId): {
  alpha: number;
  beta: number;
  gamma: number;
} {
  if (system === "hexagonal") return { alpha: 90, beta: 90, gamma: 120 };
  if (system === "cubic") return { alpha: 90, beta: 90, gamma: 90 };
  if (system === "tetragonal") return { alpha: 90, beta: 90, gamma: 90 };
  return { alpha: 90, beta: 90, gamma: 90 }; // orthorhombic
}

/** The species mapping — each mineral picks its own lattice family. */
export function latticeFor(mineral: MineralId, seed: number): Lattice {
  const rng = mulberry32(seed);
  // Deterministic per-mineral lattice with a small seeded variation.
  const jitter = (r: number, span: number) => (rng() - 0.5) * span * r;
  switch (mineral) {
    case "calcite":
      return {
        system: "hexagonal",
        centering: "P",
        ba: 1,
        ca: 0.855 + jitter(0.855, 0.02),
        ...anglesFor("hexagonal"),
      };
    case "quartz":
      return {
        system: "hexagonal",
        centering: "P",
        ba: 1,
        ca: 1.100 + jitter(1.1, 0.02),
        ...anglesFor("hexagonal"),
      };
    case "jasper":
      return {
        system: "orthorhombic",
        centering: "P",
        ba: 0.82 + jitter(0.82, 0.03),
        ca: 0.63 + jitter(0.63, 0.03),
        ...anglesFor("orthorhombic"),
      };
    case "agate":
      return {
        system: "hexagonal",
        centering: "P",
        ba: 1,
        ca: 0.98 + jitter(0.98, 0.02),
        ...anglesFor("hexagonal"),
      };
    case "chert":
      return {
        system: "tetragonal",
        centering: "P",
        ba: 1,
        ca: 0.72 + jitter(0.72, 0.03),
        ...anglesFor("tetragonal"),
      };
    case "chalcedony":
      return {
        system: "hexagonal",
        centering: "P",
        ba: 1,
        ca: 1.02 + jitter(1.02, 0.02),
        ...anglesFor("hexagonal"),
      };
    case "feldspar":
      return {
        system: "orthorhombic",
        centering: "P",
        ba: 0.94 + jitter(0.94, 0.03),
        ca: 1.15 + jitter(1.15, 0.03),
        ...anglesFor("orthorhombic"),
      };
    case "obsidian":
      // amorphous — reported here as a cubic P with unit ratio; the ring is
      // therefore a single dominant partial with the polish damping riding
      // strongly.
      return {
        system: "cubic",
        centering: "P",
        ba: 1,
        ca: 1,
        ...anglesFor("cubic"),
      };
  }
}

const MINERALS: MineralId[] = [
  "calcite",
  "quartz",
  "jasper",
  "agate",
  "chert",
  "chalcedony",
  "feldspar",
  "obsidian",
];

export function mineralFromSeed(seed: number): MineralId {
  const rng = mulberry32(seed);
  const idx = Math.floor(rng() * MINERAL_COUNT) % MINERAL_COUNT;
  return MINERALS[idx];
}

// ——— the load-bearing invertible map: reciprocal → partials ———————————
//
// The partial ratios are the sorted magnitudes of the (h, k, l) reciprocal-
// lattice vectors up to a bounded index, damped by the polish. The polish
// damping is a MONOTONE exponential — the higher the partial, the more the
// polish quiets it — so the load-bearing invariant is that a well-polished
// pebble rings SHORTER than a fresh crystal of the same lattice.
//
// `readLattice` reverses the damping by using the fundamental (index 0) as
// the reference amplitude, then reads the system + axial ratio the same
// way /rocks does. That is what makes the map INVERTIBLE — polish depth
// is audible, but the identity of the lattice is preserved.

const MAX_MILLER = 3;

function reciprocalMagnitudes(l: Lattice): number[] {
  // For orthorhombic / tetragonal / cubic and hexagonal the reciprocal
  // magnitudes are read from the metric tensor. We only need MAGNITUDES,
  // not directions.
  const mags: number[] = [];
  const gaa = 1;
  const gbb = 1 / (l.ba * l.ba);
  const gcc = 1 / (l.ca * l.ca);
  for (let h = 0; h <= MAX_MILLER; h++) {
    for (let k = 0; k <= MAX_MILLER; k++) {
      for (let m = 0; m <= MAX_MILLER; m++) {
        if (h === 0 && k === 0 && m === 0) continue;
        // Centring extinction: F excludes odd-mixed hkl; I excludes h+k+m
        // odd. P allows every hkl.
        if (l.centering === "F") {
          const allEven = h % 2 === 0 && k % 2 === 0 && m % 2 === 0;
          const allOdd = h % 2 === 1 && k % 2 === 1 && m % 2 === 1;
          if (!(allEven || allOdd)) continue;
        }
        if (l.centering === "I" && (h + k + m) % 2 !== 0) continue;
        let g2: number;
        if (l.system === "hexagonal") {
          g2 = 4 / 3 * (h * h + h * k + k * k) + m * m * gcc;
        } else {
          g2 = h * h * gaa + k * k * gbb + m * m * gcc;
        }
        const g = Math.sqrt(g2);
        if (g > 0) mags.push(g);
      }
    }
  }
  mags.sort((a, b) => a - b);
  // Deduplicate close-by values (within 1e-9) — different (hkl) triples
  // can produce the exact same magnitude.
  const out: number[] = [];
  for (const g of mags) {
    if (out.length === 0 || Math.abs(g - out[out.length - 1]) > 1e-9) {
      out.push(g);
    }
  }
  return out;
}

/** Polish damping factor for the k-th partial (index-based, k = 0 is fundamental). */
export function polishDamping(polishDepth: number, k: number): number {
  // k = 0 (fundamental) is UN-damped so the read-back can invert the polish.
  return Math.exp(-POLISH_DAMPING_K * polishDepth * k);
}

/**
 * Sorted partial ratios of the reciprocal lattice, damped by polish depth.
 * The fundamental is always 1.0; every subsequent partial is a ratio to it,
 * scaled by the polish damping. Length is bounded at 12.
 */
export function partialsFor(state: PebbleState): number[] {
  const mags = reciprocalMagnitudes(state.lattice);
  if (mags.length === 0) return [1];
  const g0 = mags[0];
  const partials: number[] = [];
  const N = Math.min(12, mags.length);
  for (let k = 0; k < N; k++) {
    const ratio = mags[k] / g0;
    partials.push(ratio * polishDamping(state.polishDepth, k));
  }
  return partials;
}

/**
 * Recover the lattice's axial ratios from a partials array.
 * The polish damping is inverted using the fundamental as the reference —
 * every partial's dampened value is divided by `polishDamping(polishDepth, k)`
 * to recover its true magnitude ratio, so the returned axial-ratio estimate
 * is INDEPENDENT of the polish (up to numerics).
 */
export function readLattice(
  partials: number[],
  polishDepth: number,
): { c_over_a_estimate: number } {
  if (partials.length < 2) return { c_over_a_estimate: 1 };
  // Undo the polish damping.
  const undamped = partials.map((p, k) => p / polishDamping(polishDepth, k));
  // For a hexagonal lattice, the ratio of (0, 0, 1) to (1, 0, 0) equals
  // 1/ca. We approximate ca as the reciprocal of the SECOND undamped
  // partial's ratio to the first — this is a coarse but pinnable estimate.
  const ratio = undamped[1] / undamped[0];
  return { c_over_a_estimate: 1 / ratio };
}

/**
 * The species voice — the name of the mineral, recovered from the pattern of
 * partials. Coarse: matches on the closest known (ba, ca) tuple, damping-
 * invariant.
 */
export function speciesFromRing(
  partials: number[],
  polishDepth: number,
): MineralId {
  const { c_over_a_estimate } = readLattice(partials, polishDepth);
  // Pick the mineral whose ca is closest to the estimate.
  let best: MineralId = "quartz";
  let bestDist = Infinity;
  for (const mineral of MINERALS) {
    const ca = latticeFor(mineral, 0).ca;
    const d = Math.abs(ca - c_over_a_estimate);
    if (d < bestDist) {
      bestDist = d;
      best = mineral;
    }
  }
  return best;
}

// ——— the load-bearing invertible map: ring frequency ↔ fundamental ————

/** Frequency of the fundamental — an invertible closed-form map. */
export function ringHzFor(state: PebbleState): number {
  // Damped fundamental amplitude; the fundamental itself is undamped, but
  // its PITCH depends on the lattice's characteristic length. Use ca as the
  // load-bearing pitch driver so a hexagonal calcite (ca ≈ 0.86) rings LOWER
  // than a hexagonal quartz (ca ≈ 1.10).
  return PITCH_BASE_HZ * Math.pow(2, state.lattice.ca / PITCH_SCALE);
}

export function ringHzForLattice(l: Lattice): number {
  return PITCH_BASE_HZ * Math.pow(2, l.ca / PITCH_SCALE);
}

/** Exact inverse: recover ca from a heard fundamental. */
export function caFromRingHz(hz: number): number {
  return Math.log2(hz / PITCH_BASE_HZ) * PITCH_SCALE;
}

// ——— growth, polish, cleavage — the state moves in closed form ————————

/**
 * Advance the polish depth exactly, in closed form.
 * `polishDepth(t) = POLISH_MAX · (1 − exp(−t / POLISH_TAU_S · waterCarry))`.
 */
export function polishStep(
  state: PebbleState,
  dtSec: number,
  waterCarry: number,
): PebbleState {
  const carry = clamp01(waterCarry);
  const dt = Math.max(0, dtSec);
  // The saturating curve: dp/dt = (POLISH_MAX − p) / POLISH_TAU_S · carry.
  const remaining = POLISH_MAX - state.polishDepth;
  const decayed = remaining * Math.exp(-(dt * carry) / POLISH_TAU_S);
  const newPolishDepth = POLISH_MAX - decayed;
  return {
    ...state,
    polishDepth: clamp(newPolishDepth, 0, POLISH_MAX),
    tau: Math.min(MAX_ELAPSED_S, state.tau + dt),
  };
}

/**
 * Grow one accretion ring under the current lattice pressure.
 * Returns state unchanged if pressure is below threshold or ring cap reached.
 */
export function growStep(
  state: PebbleState,
  dtSec: number,
  latticePressure: number,
): PebbleState {
  if (state.growthRings.length >= MAX_GROWTH_RINGS) return state;
  if (latticePressure <= 0) return state;
  // A ring is added when dtSec * pressure exceeds GROWTH_TAU_S.
  const grew = dtSec * latticePressure >= GROWTH_TAU_S;
  if (!grew) return state;
  const lastRadius =
    state.growthRings.length === 0
      ? 0
      : state.growthRings[state.growthRings.length - 1].radius;
  const remaining = 1 - lastRadius;
  if (remaining <= 0) return state;
  const thickness = remaining * 0.15;
  const seed = mulberry32(
    hashSeed(state.seedKey, state.growthRings.length),
  )();
  const mineral = mineralFromSeed(hashSeed(state.seedKey, state.growthRings.length + 1));
  const newRing: GrowthRing = {
    radius: clamp01(lastRadius + thickness),
    mineral,
    thickness,
    seed,
  };
  return {
    ...state,
    growthRings: [...state.growthRings, newRing],
    tau: Math.min(MAX_ELAPSED_S, state.tau + dtSec),
  };
}

/**
 * Combined advance: polish + growth + season, all in closed form.
 * Caps elapsed at MAX_ELAPSED_S so a month away can never become a century.
 */
export function advanceExact(
  state: PebbleState,
  seconds: number,
  climate: Climate,
): PebbleState {
  const dt = Math.max(0, Math.min(seconds, MAX_ELAPSED_S));
  const carry = clamp01(climate.waterCarry);
  const pressure = clamp01(climate.latticePressure);
  const polished = polishStep(state, dt, carry);
  const grown = growStep(polished, dt, pressure);
  const season = (grown.season + dt / (60 * 60 * 24 * 365)) % 1;
  return { ...grown, season };
}

/**
 * The nearest cleavage plane through a ray from the stone's centre. Only
 * a few planes are legal — the ones in the point group's cleavage orbit.
 * Returns a Miller-like triple as a triple of small integers.
 */
export function cleavageAt(
  state: PebbleState,
  rayAngle: number,
): { plane: [number, number, number] } {
  // The legal cleavage planes for each system. Simplified — we only need
  // enough that a `flick` returns a lattice plane, never an arbitrary line.
  const planes: [number, number, number][] =
    state.lattice.system === "cubic"
      ? [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 1, 0],
          [1, 0, 1],
        ]
      : state.lattice.system === "hexagonal"
      ? [
          [0, 0, 1],
          [1, 0, 0],
          [1, 1, 0],
          [1, 0, 1],
        ]
      : state.lattice.system === "tetragonal"
      ? [
          [0, 0, 1],
          [1, 0, 0],
          [1, 1, 0],
        ]
      : [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ];
  // Pick the plane whose angle is closest to rayAngle (normalized).
  const angleOf = (p: [number, number, number]) =>
    Math.atan2(p[1], p[0]);
  const wrap = (a: number) => {
    let r = a;
    while (r > Math.PI) r -= 2 * Math.PI;
    while (r < -Math.PI) r += 2 * Math.PI;
    return r;
  };
  let best: [number, number, number] = planes[0];
  let bestDist = Infinity;
  for (const p of planes) {
    const d = Math.abs(wrap(angleOf(p) - rayAngle));
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { plane: best };
}

/** Every growth ring's radii, in order. */
export function growthRadii(state: PebbleState): number[] {
  return state.growthRings.map((r) => r.radius);
}

/**
 * The observable used to check that growth conserves the stone's total
 * accreted mass. Sum of ring thicknesses is invariant under polish.
 */
export function accretedMass(state: PebbleState): number {
  return state.growthRings.reduce((s, r) => s + r.thickness, 0);
}

/**
 * Fresh state — one seed, no rings yet, no polish.
 */
export function initState(seedKey: number, mineral?: MineralId): PebbleState {
  const m = mineral ?? mineralFromSeed(seedKey);
  const lattice = latticeFor(m, hashSeed(seedKey, 0xa11c));
  // A newborn pebble already has ONE seed ring — the nucleus — with no
  // thickness (so it does not count against accretedMass).
  const initialRing: GrowthRing = {
    radius: 0.05,
    mineral: m,
    thickness: 0,
    seed: 0,
  };
  return {
    lattice,
    growthRings: [initialRing],
    polishDepth: 0,
    season: 0,
    tau: 0,
    seedKey: seedKey >>> 0,
  };
}
