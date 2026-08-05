// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.domain_lib.title,
//           spec.domain_lib.brief, spec.invariant_type, spec.key.
// One LLM slot below carries the actual physics; the prelude is verbatim.

/**
 * coralflow — the laws of /reef.
 *
 * The invariant is a state vector: 
 *
 * Pure math, no imports, no DOM — node-testable
 * (scripts/test-coralflow.mjs). See INSPIRATION.md §2 (maps
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
 * A single coral polyp anchored to the calcite substrate. Every polyp
 * carries a size s ∈ [0, MAX_SIZE] whose closed-form logistic advance
 * saturates toward MAX_SIZE at a rate scaled by the local illumination and
 * shear-reduced by the current strength. The seed pins its ring phase for
 * every visit.
 */
export type Polyp = {
  id: number;
  /** normalized x in the reef's frame (POOL_X_MIN..POOL_X_MAX) */
  x: number;
  /** normalized y in the reef's frame (POOL_Y_MIN..POOL_Y_MAX); smaller y = shallower = brighter */
  y: number;
  /** the polyp's size, 0..MAX_SIZE — the load-bearing scalar */
  size: number;
  /** deterministic phase in 0..1, from mulberry32(hashSeed(seedKey, id)) */
  phase: number;
  /** true once the ceremony sealed it — a cornerstone, kept between visits */
  sealed: boolean;
};

/** The world-law layer the three-finger hand turns. */
export type Climate = {
  /** 0 = frost, 1 = high summer — scales illumination */
  warmth: number;
  /** 0 = drought, 1 = downpour — scales current strength */
  wet: number;
};

/**
 * The whole reef: a lattice of polyps, a shared current direction and
 * strength, an illumination scalar, and how long the colony has lived.
 */
export type ReefState = {
  polyps: Polyp[];
  /** current signed magnitude in [-1, 1] — sign is direction along x */
  current: number;
  /** illumination scalar in [0, 1] — 0 = night, 1 = midday */
  illum: number;
  /** seconds of maturity this colony has lived through */
  tau: number;
  /** the seed the room persisted under, so polyp phases stay stable */
  seedKey: number;
};

/** Never let a month away become a century: world.ts's law, in seconds. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;
/** How many bounded sub-steps a caller may spend on a scatter task. */
export const SCATTER_STEPS = 8;
/** Reef bounds — outside is open water (above) or bedrock (below). */
export const POOL_X_MIN = 0.06;
export const POOL_X_MAX = 0.94;
export const POOL_Y_MIN = 0.30;
export const POOL_Y_MAX = 0.94;
/** Maximum polyps a section holds — cap on the population. */
export const MAX_POLYPS = 24;
/** A polyp cannot grow past this — the biological ceiling. */
export const MAX_SIZE = 1;
/**
 * Base growth rate: a polyp at illum=1, current=0 saturates to 1 with
 * time-constant 1/R_BASE ≈ 20 minutes of ledger time (fast enough that
 * the visitor sees the arc, slow enough that a dwell matters).
 */
export const R_BASE = 8e-4;
/**
 * Current shear coefficient: the effective growth rate falls off linearly
 * with |current|; at |current| = 1 the shear removes SHEAR_C of the base
 * rate. Chosen below 1 so a strong current still permits some growth.
 */
export const SHEAR_C = 0.55;
/**
 * Illumination gradient: sunlit polyps (small y = shallow) grow at
 * ILLUM_TOP, deep polyps (large y) grow at ILLUM_BOTTOM. Linear in y.
 */
export const ILLUM_TOP = 1.0;
export const ILLUM_BOTTOM = 0.28;
/** Base of the size→pitch map: the pitch of a size-0 recruit. */
export const PITCH_BASE_HZ = 660;
/**
 * Scale of the size→pitch map. Bigger polyps ring LOWER (a bell's
 * fundamental drops as its mass grows), so PITCH_SCALE_S sets an octave
 * per PITCH_SCALE_S of size. The map is
 * `f(s) = PITCH_BASE_HZ · 2^(-s / PITCH_SCALE_S)`, exactly invertible.
 */
export const PITCH_SCALE_S = 0.5;
/**
 * Illumination clamp: a warmth = 1 climate reaches ILLUM_MAX, warmth = 0
 * reaches ILLUM_MIN. A cold year is still lit, a hot year does not exceed 1.
 */
export const ILLUM_MAX = 1.0;
export const ILLUM_MIN = 0.35;
/** Current strength scales with wet. Signed: leftward vs. rightward. */
export const CURRENT_MAX = 1.0;
/**
 * A hard knock dislodges unsealed polyps under the shifted threshold
 * `DISLODGE_THRESHOLD + intensity * KNOCK_KAPPA`. Higher intensity raises the
 * threshold, sweeping more polyps; at intensity = 1 every unsealed polyp
 * (size ≤ 1 = DISLODGE_THRESHOLD + KNOCK_KAPPA) is at risk. Cornerstones
 * (sealed) are exempt regardless.
 */
export const DISLODGE_THRESHOLD = 0.45;
export const KNOCK_KAPPA = 0.7;

// ——— the sky's rates ————————————————————————————————————————————

/**
 * Illumination as a function of climate warmth. Bounded at [ILLUM_MIN,
 * ILLUM_MAX]. A monotone-increasing linear response — a hot climate is a
 * bright one; a cold one is dim but not dark.
 */
export function illuminationRate(c: Climate): number {
  return ILLUM_MIN + (ILLUM_MAX - ILLUM_MIN) * clamp01(c.warmth);
}

/** Current signed strength in [-CURRENT_MAX, CURRENT_MAX]. */
export function currentStrength(c: Climate): number {
  // A wet year drives a stronger current (either direction); a drought calms
  // it. The direction sign is written by the drag verb into state.current
  // directly, so here we return only the magnitude at the current sign.
  return CURRENT_MAX * clamp01(c.wet);
}

/**
 * Illumination multiplier at a given depth. Top of the section gets the
 * full ILLUM_TOP, bottom gets ILLUM_BOTTOM; linear in y. Multiplied by
 * `illum` (the state's own scalar) to yield the effective illumination.
 */
export function illuminationAt(y: number, illum: number): number {
  const yFrac = clamp01((y - POOL_Y_MIN) / Math.max(1e-6, POOL_Y_MAX - POOL_Y_MIN));
  const depthMul = ILLUM_TOP + (ILLUM_BOTTOM - ILLUM_TOP) * yFrac;
  return depthMul * clamp01(illum);
}

// ——— the size → pitch map, and its exact inverse ————————————————

/** Ring frequency for a given polyp size. Monotone-DECREASING, invertible. */
export function ringHzFor(size: number): number {
  return PITCH_BASE_HZ * Math.pow(2, -clamp(size, 0, MAX_SIZE) / PITCH_SCALE_S);
}

/** Polyp size recovered from a ring frequency. Exact inverse of ringHzFor. */
export function sizeForRingHz(hz: number): number {
  if (!(hz > 0)) return 0;
  return -PITCH_SCALE_S * Math.log2(hz / PITCH_BASE_HZ);
}

// ——— observables the shader, the audio, and the tests read ———————————

/** The mean size across the colony — the twist lens's barometer. */
export function meanSize(state: ReefState): number {
  if (state.polyps.length === 0) return 0;
  let s = 0;
  for (const p of state.polyps) s += p.size;
  return s / state.polyps.length;
}

/** How many polyps have been sealed as cornerstones. */
export function cornerstoneCount(state: ReefState): number {
  let n = 0;
  for (const p of state.polyps) if (p.sealed) n++;
  return n;
}

/** Total mass — the conservation observable for the test. */
export function totalMass(state: ReefState): number {
  let m = 0;
  for (const p of state.polyps) m += p.size;
  return m;
}

/** Effective growth rate for one polyp under the current climate. */
export function effectiveGrowthRate(
  polyp: Polyp,
  state: ReefState,
  climate: Climate,
): number {
  const illumMul = illuminationAt(polyp.y, illuminationRate(climate) * state.illum);
  const shearMul = Math.max(0, 1 - SHEAR_C * Math.abs(state.current));
  return R_BASE * illumMul * shearMul;
}

// ——— the closed-form advance ——————————————————————————————————

/**
 * Advance every polyp by `seconds` under a stable climate. Each polyp's
 * size obeys `dS/dt = r(polyp) · (MAX_SIZE - S)`, which is linear-in-log
 * space — one closed-form step per polyp, never a Euler catch-up loop.
 * Sealed polyps are frozen at MAX_SIZE; unsealed polyps saturate toward
 * MAX_SIZE at rate r(polyp).
 *
 * The illumination and current fields relax on their own toward the
 * climate-driven values (illum → illuminationRate(climate)) with a slow
 * time-constant, so a drag3 that lifts illum stays high for a while.
 * Current is kept at whatever the drag/climate last wrote — no relaxation.
 */
export function advanceExact(
  state: ReefState,
  seconds: number,
  climate: Climate,
): ReefState {
  if (!(seconds > 0)) return state;
  // Cap first, so a month away is not a century of drift.
  const dt = Math.min(seconds, MAX_ELAPSED_S);
  const polyps = state.polyps.map((p) => {
    if (p.sealed) return { ...p, size: MAX_SIZE };
    const r = effectiveGrowthRate(p, state, climate);
    // Closed form: S(t) = MAX_SIZE - (MAX_SIZE - S0) · exp(-r · t)
    const decay = Math.exp(-r * dt);
    const size1 = MAX_SIZE - (MAX_SIZE - p.size) * decay;
    return { ...p, size: clamp(size1, 0, MAX_SIZE) };
  });
  // Illumination relaxes toward its climate steady state on a 12-hour clock.
  const ILLUM_RELAX = 1 / (12 * 3600);
  const targetIllum = illuminationRate(climate);
  const illum1 =
    targetIllum + (state.illum - targetIllum) * Math.exp(-ILLUM_RELAX * dt);
  return {
    ...state,
    polyps,
    illum: clamp01(illum1),
    tau: state.tau + dt,
  };
}

// ——— what a hand does at a polyp ————————————————————————————

/** Where a new polyp would sit — the reef's own bounds. */
export function inReefBounds(x: number, y: number): boolean {
  return x >= POOL_X_MIN && x <= POOL_X_MAX && y >= POOL_Y_MIN && y <= POOL_Y_MAX;
}

/**
 * Plant a polyp at (x, y) with the given size. A no-op when the point sits
 * outside the reef's bounds — the material refuses rather than pretends to
 * anchor on open water. Also refuses when the colony already holds the cap.
 */
export function plantPolyp(
  state: ReefState,
  x: number,
  y: number,
  size: number,
): ReefState {
  if (!inReefBounds(x, y)) return state;
  if (state.polyps.length >= MAX_POLYPS) return state;
  let id = 1;
  for (const p of state.polyps) if (p.id >= id) id = p.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id))();
  const polyp: Polyp = {
    id,
    x: clamp01(x),
    y: clamp01(y),
    size: clamp(size, 0, MAX_SIZE),
    phase,
    sealed: false,
  };
  return { ...state, polyps: [...state.polyps, polyp] };
}

/**
 * Widen a polyp's size by `dSize`. Bounded at MAX_SIZE; a negative
 * `dSize` narrows an unsealed polyp. Sealed polyps refuse both directions.
 */
export function deepenPolyp(
  state: ReefState,
  id: number,
  dSize: number,
): ReefState {
  const polyps = state.polyps.map((p) =>
    p.id === id && !p.sealed
      ? { ...p, size: clamp(p.size + dSize, 0, MAX_SIZE) }
      : p,
  );
  return { ...state, polyps };
}

/**
 * The ceremony: seal a polyp at full size — the cornerstone. Kept between
 * visits: a sealed polyp never shrinks, and its size holds at MAX_SIZE
 * regardless of what the current does.
 */
export function sealPolyp(state: ReefState, id: number): ReefState {
  const polyps = state.polyps.map((p) =>
    p.id === id ? { ...p, size: MAX_SIZE, sealed: true } : p,
  );
  return { ...state, polyps };
}

/**
 * A hard knock dislodges every unsealed polyp under the shifted threshold.
 * Returns the new state and the count of polyps that were swept off. The
 * cornerstones stay — that's the load-bearing invariant of the touch-
 * reachable secret. `intensity` is clamped 0..1.
 */
export function knockSweep(
  state: ReefState,
  intensity: number,
): { state: ReefState; dislodged: number } {
  const i = clamp01(intensity);
  const threshold = DISLODGE_THRESHOLD + i * KNOCK_KAPPA;
  const kept: Polyp[] = [];
  let dislodged = 0;
  for (const p of state.polyps) {
    if (!p.sealed && p.size < threshold) {
      dislodged++;
      continue;
    }
    kept.push(p);
  }
  return { state: { ...state, polyps: kept }, dislodged };
}

/** The polyp nearest (x, y) within `within`, or null. Tap and flick reach. */
export function nearestPolyp(
  state: ReefState,
  x: number,
  y: number,
  within = 0.1,
): Polyp | null {
  let best: Polyp | null = null;
  let bestD = within;
  for (const p of state.polyps) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// ——— starter, storage ————————————————————————————————————————

/**
 * The reef that is already there the first time anyone arrives. A modest
 * colony of a few polyps at varying depths, current calm, illum near
 * midday — alive before it is touched.
 */
export function initState(seed: number): ReefState {
  const rng = mulberry32(seed >>> 0);
  let state: ReefState = {
    polyps: [],
    current: 0.1 + rng() * 0.15,
    illum: 0.85 + rng() * 0.1,
    tau: 12 * 3600,
    seedKey: seed >>> 0,
  };
  // Plant a small starting colony: three polyps at varying depths, one
  // already a cornerstone (the anchor the room was built around).
  const starters: { xf: number; yf: number; size: number; seal: boolean }[] = [
    { xf: 0.28, yf: 0.30, size: 0.68, seal: true },
    { xf: 0.52, yf: 0.55, size: 0.44, seal: false },
    { xf: 0.74, yf: 0.42, size: 0.30, seal: false },
  ];
  for (const st of starters) {
    const x = POOL_X_MIN + (POOL_X_MAX - POOL_X_MIN) * st.xf;
    const y = POOL_Y_MIN + (POOL_Y_MAX - POOL_Y_MIN) * st.yf;
    state = plantPolyp(state, x, y, st.size);
    if (st.seal) {
      const last = state.polyps[state.polyps.length - 1];
      if (last) state = sealPolyp(state, last.id);
    }
  }
  // Let the ledger run half a day at a calm climate so the reef is already
  // breathing when you arrive.
  return advanceExact(state, 12 * 3600, { warmth: 0.55, wet: 0.45 });
}
