// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.domain_lib.title,
//           spec.domain_lib.brief, spec.invariant_type, spec.key.
// One LLM slot below carries the actual physics; the prelude is verbatim.

/**
 * springflow — the laws of /spring.
 *
 * The invariant is a **two-cell hydraulic ledger**. One aquifer head `H(t)`
 * under the ground and a small pool level `L(t)` at the surface; every seep is
 * a throat that hands water from the first to the second, every rainy day
 * quietly adds to `H`, every warm afternoon quietly draws from `L`, and the
 * one door out is the weir at the pool's lip. When the throats sum to a
 * stable `S`, the coupled ODEs
 *
 *     dH/dt = W − k·(H − L)·Σθᵢ
 *     dL/dt = k·(H − L)·Σθᵢ − E − Q_lip
 *     Q_lip = c_w · max(0, L − L_lip)^(3/2)
 *
 * split cleanly along the two eigen-directions of the aquifer-pool exchange.
 * With `D = H − L` and `Σ = H + L`,
 *
 *     dD/dt = (W + E) − 2S·D
 *     dΣ/dt = (W − E) − Q_lip
 *
 * so `Σ` grows or shrinks at the balance of the sky, and `D` converges to
 * the mean-flux target `(W + E) / (2S)` at rate `2S`. Between visits, this is
 * one closed-form step per stable interval — never a Euler catch-up loop.
 *
 * The load-bearing sensory map is **HEAD → PITCH**, and it is INVERTIBLE:
 * `ringHzFor(H) = base · 2^(H/scale)`, and `headForRingHz(hz)` exactly undoes
 * it. From the sound alone you recover the head, so a deep pool never sounds
 * like a wet edge; a fortnight's absence, read off the closed-form ledger,
 * lifts the pitch by exactly what the rain gave.
 *
 * Pure math, no imports, no DOM — node-testable
 * (scripts/test-springflow.mjs). See INSPIRATION.md §2 (maps
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

/** Every seep the aquifer breaches into the pool through. */
export type Seep = {
  id: number;
  /** normalized x in the pool's frame (POOL_X_MIN..POOL_X_MAX) */
  x: number;
  /** normalized y in the pool's frame (POOL_Y_MIN..POOL_Y_MAX) */
  y: number;
  /** the throat width, 0..MAX_THROAT — the Darcy rate constant */
  throat: number;
  /** deterministic phase in 0..1, from mulberry32(hashSeed(seedKey, id)) */
  phase: number;
  /**
   * The flux out of this seep at the last advance, in H-units per second.
   * Recovered by the shader's wet-halo brightness (monotone in flux); the
   * inversion of that map is the room's central legibility claim.
   */
  flux: number;
  /** true once the ceremony sealed it — kept between visits at full throat. */
  sealed: boolean;
};

/** The world-law layer: what the three-finger hand turns. */
export type Climate = {
  /** 0 = frost, 1 = high summer */
  warmth: number;
  /** 0 = drought, 1 = downpour */
  wet: number;
};

/** The whole spring: two water numbers, its seeps, and how long it has been. */
export type SpringState = {
  /** aquifer head, in section units 0..1 (0 = dry bedrock, 1 = brimful) */
  H: number;
  /** pool level, in section units 0..1 (L_LIP is the weir crest) */
  L: number;
  /** seconds of maturity this spring has lived through */
  tau: number;
  seeps: Seep[];
  /** the seed the room persisted under, so seep phases stay stable */
  seedKey: number;
};

/** Never let a month away become a century: world.ts's law, in seconds. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;
/** How many bounded sub-steps a caller may spend on a scatter task. */
export const SCATTER_STEPS = 8;
/** Weir crest: pool spills once L climbs past this. */
export const L_LIP = 0.85;
/**
 * Darcy rate constant: seep flux is `K_SEEP · throat · (H − L)`, per second.
 * Chosen so a throat of 0.3 equilibrates the exchange in a few thousand
 * seconds — fast against the day, slow against the second.
 */
export const K_SEEP = 6e-4;
/** Weir coefficient: Q_lip = C_W · (L − L_lip)^(3/2), per second. */
export const C_W = 0.02;
/** A throat cannot open past this — an aquifer has a real cross section. */
export const MAX_THROAT = 1;
/** Base of the head→pitch map: the pitch of a bone-dry aquifer. */
export const PITCH_BASE_HZ = 110;
/**
 * Scale of the head→pitch map: an octave per PITCH_SCALE_M of head. The map
 * is `f(H) = PITCH_BASE_HZ · 2^(H / PITCH_SCALE_M)`, exactly invertible.
 */
export const PITCH_SCALE_M = 0.6;
/**
 * Recharge saturates here (units/second at wet = 1). Chosen so a fortnight
 * of downpour lifts the head by a fraction of the section — a meaningful
 * refill without the ledger exploding past its cells.
 */
export const W_MAX = 3e-7;
/** Evaporation saturates here (units/second at warmth = 1). Same scaling. */
export const E_MAX = 3e-7;
/** Maximum seeps a section holds — the uniform arrays are sized to this. */
export const MAX_SEEPS = 16;
/** Wet ground bounds — outside is air (above) or bedrock (below). */
export const POOL_X_MIN = 0.04;
export const POOL_X_MAX = 0.96;
export const POOL_Y_MIN = 0.34;
export const POOL_Y_MAX = 0.94;

// ——— the sky's two rates ————————————————————————————————————————

/** Recharge as a linear response to wet; bounded below zero and at W_MAX. */
export function rechargeRate(c: Climate): number {
  return W_MAX * clamp01(c.wet);
}

/** Evaporation as a linear response to warmth; bounded likewise. */
export function evaporationRate(c: Climate): number {
  return E_MAX * clamp01(c.warmth);
}

/** Total throat summed across every live seep — the linear system's S/k. */
export function totalThroat(state: SpringState): number {
  let s = 0;
  for (const seep of state.seeps) s += Math.max(0, seep.throat);
  return s;
}

/** The weir's outflow, always non-negative, zero when the lip is not drowned. */
export function weirOutflow(L: number): number {
  const h = Math.max(0, L - L_LIP);
  return h > 0 ? C_W * Math.pow(h, 1.5) : 0;
}

// ——— the head → pitch map, and its exact inverse ————————————————

/** Ring frequency for a given aquifer head. Monotone-increasing, invertible. */
export function ringHzFor(head: number): number {
  return PITCH_BASE_HZ * Math.pow(2, head / PITCH_SCALE_M);
}

/** Aquifer head recovered from a ring frequency. Exact inverse of ringHzFor. */
export function headForRingHz(hz: number): number {
  if (!(hz > 0)) return 0;
  return PITCH_SCALE_M * Math.log2(hz / PITCH_BASE_HZ);
}

/** The total water in the two cells — conservation observable for the test. */
export function totalWater(state: SpringState): number {
  return state.H + state.L;
}

// ——— the two-cell ledger, in closed form ——————————————————————————

/**
 * Advance the head and pool by `seconds` under a stable climate. The exchange
 * eigen-decomposes into D = H − L (converging to the mean-flux target) and
 * Σ = H + L (walking at the balance of the sky). When Σ throat = 0 the
 * exchange stops and D drifts linearly; both branches are closed form.
 *
 * The weir subtracts a linear outflow when L exceeds L_lip. This is applied
 * post-hoc across the step rather than baked into the eigen-decomposition —
 * the nonlinearity is real, and the honest thing is to state that the closed
 * form is exact only while the lip is dry. When it is not, the test suite
 * still pins mass conservation across the whole step.
 */
export function advanceExact(
  state: SpringState,
  seconds: number,
  climate: Climate,
): SpringState {
  if (!(seconds > 0)) return state;
  // Cap first, so a month away is not a century of drift.
  const dt = Math.min(seconds, MAX_ELAPSED_S);
  const W = rechargeRate(climate);
  const E = evaporationRate(climate);
  const throat = totalThroat(state);
  const S = K_SEEP * throat;

  const H0 = state.H;
  const L0 = state.L;
  const D0 = H0 - L0;
  const Sum0 = H0 + L0;

  let D: number;
  let Sum: number;
  if (S > 0) {
    // Two-eigenvalue linear system: D relaxes toward Dstar at rate 2S; Σ
    // walks linearly at W − E. Exact — no Euler.
    const Dstar = (W + E) / (2 * S);
    D = Dstar + (D0 - Dstar) * Math.exp(-2 * S * dt);
    Sum = Sum0 + (W - E) * dt;
  } else {
    // Σ throat = 0: no exchange. D and Σ both walk linearly, but note the
    // sign — with no seep, H accumulates the rain while L just loses to E.
    D = D0 + (W + E) * dt;
    Sum = Sum0 + (W - E) * dt;
  }

  // The weir: an outflow proportional to the mean over the step. This is a
  // first-order correction; a stable hour with L < L_lip is exact.
  const Lmid = (Sum - D) / 2;
  const outflow = weirOutflow(Lmid) * dt;
  Sum -= outflow;

  // No clamp: the closed form is respected. In a very long or very wet run
  // Σ may drift outside its nominal 0..2 range — the shader deals with the
  // display; the ledger stays truthful.
  const H = (Sum + D) / 2;
  const L = (Sum - D) / 2;

  // Report each seep's flux, so the shader's wet-halo can invert to it.
  const meanD = (D0 + D) / 2;
  const seeps = state.seeps.map((seep) => ({
    ...seep,
    flux: Math.max(0, K_SEEP * seep.throat * meanD),
  }));

  return { ...state, H, L, tau: state.tau + dt, seeps };
}

// ——— what a hand does at a seep ————————————————————————————————

/** Where a new seep would sit — the pool's own bounds. */
export function inPoolBounds(x: number, y: number): boolean {
  return x >= POOL_X_MIN && x <= POOL_X_MAX && y >= POOL_Y_MIN && y <= POOL_Y_MAX;
}

/**
 * Plant a seep at (x, y) with the given throat. A no-op when the point sits
 * outside the pool's bounds — the material refuses rather than pretends to
 * breach the bedrock. Also refuses when the section already holds the cap.
 */
export function plantSeep(
  state: SpringState,
  x: number,
  y: number,
  throat: number,
): SpringState {
  if (!inPoolBounds(x, y)) return state;
  if (state.seeps.length >= MAX_SEEPS) return state;
  let id = 1;
  for (const s of state.seeps) if (s.id >= id) id = s.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id))();
  const seep: Seep = {
    id,
    x: clamp01(x),
    y: clamp01(y),
    throat: clamp(throat, 0, MAX_THROAT),
    phase,
    flux: 0,
    sealed: false,
  };
  return { ...state, seeps: [...state.seeps, seep] };
}

/**
 * Widen a seep's throat by `dtheta`. Bounded at MAX_THROAT; a negative
 * `dtheta` narrows. The test pins: monotone in dtheta while the ceiling is
 * clear, and the seep's flux moves the same way at the next advance.
 */
export function deepenSeep(
  state: SpringState,
  id: number,
  dtheta: number,
): SpringState {
  const seeps = state.seeps.map((s) =>
    s.id === id && !s.sealed
      ? { ...s, throat: clamp(s.throat + dtheta, 0, MAX_THROAT) }
      : s,
  );
  return { ...state, seeps };
}

/**
 * The ceremony: seal a seep at full throat. Kept between visits: a sealed
 * seep never narrows and its water is what fills the pool while nobody
 * watches.
 */
export function sealSeep(state: SpringState, id: number): SpringState {
  const seeps = state.seeps.map((s) =>
    s.id === id ? { ...s, throat: MAX_THROAT, sealed: true } : s,
  );
  return { ...state, seeps };
}

/** The seep nearest (x, y) within `within`, or null. What a tap or flick finds. */
export function nearestSeep(
  state: SpringState,
  x: number,
  y: number,
  within = 0.12,
): Seep | null {
  let best: Seep | null = null;
  let bestD = within;
  for (const s of state.seeps) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// ——— starter, storage ————————————————————————————————————————

/**
 * The spring that is already there the first time anyone arrives. A shallow
 * pool near the lip and a small aquifer beneath it, with one calm seep
 * running: alive before it is touched.
 */
export function initState(seed: number): SpringState {
  const rng = mulberry32(seed >>> 0);
  const H = 0.58 + rng() * 0.06;
  const L = 0.32 + rng() * 0.04;
  const state0: SpringState = {
    H,
    L,
    tau: 12 * 3600,
    seeps: [],
    seedKey: seed >>> 0,
  };
  // One seep already breathing when you arrive — the room's aliveness claim.
  const withSeep = plantSeep(
    state0,
    POOL_X_MIN + (POOL_X_MAX - POOL_X_MIN) * (0.42 + rng() * 0.16),
    POOL_Y_MIN + (POOL_Y_MAX - POOL_Y_MIN) * (0.55 + rng() * 0.1),
    0.3,
  );
  // Let the ledger run half a day at a calm climate so the first flux is
  // reported, not zero — the room is already breathing.
  return advanceExact(withSeep, 12 * 3600, { warmth: 0.42, wet: 0.5 });
}
