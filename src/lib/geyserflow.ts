// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.domain_lib.title,
//           spec.domain_lib.brief, spec.invariant_type, spec.key.
// One LLM slot below carries the actual physics; the prelude is verbatim.

/**
 * geyserflow — the laws of /geyser.
 *
 * The invariant is a **two-state thermal ledger**. An aquifer head `H(t)`
 * under a narrow throat and a temperature `T(t)` in the same column; between
 * eruptions recharge lifts H and geothermal warmth lifts T, and the eruption
 * energy `E = H · T` moves toward a hysteretic threshold. When E crosses
 * `E_TRIGGER_HIGH` upward while the state is in `"building"`, the throat
 * blows: the state moves to `"erupting"` for exactly `ERUPT_DURATION_S` and
 * H and T decay along closed-form exponentials while a ballistic discharge
 * `Q_erupt(state)` reads off the column's current shove into the air. When
 * the eruption timer expires the state falls to `"cooling"`, where T
 * exponentially relaxes back to ambient and the phase only flips back to
 * `"building"` once E has fallen well under `E_TRIGGER_LOW` — the
 * hysteresis, so a marginal state does not fire ten times a second.
 *
 * Between eruptions the coupled system is
 *
 *     dH/dt = W(climate)
 *     dT/dt = M(climate) − c · (T − T_air)
 *
 * both of which admit exact closed-form solutions per stable interval —
 * one call per phase, never a Euler catch-up loop. `advanceExact` walks
 * the elapsed time forward one phase-branch at a time until the budget is
 * spent, so a month away can pass through many cycles and every fire that
 * would have happened has been counted.
 *
 * The load-bearing sensory maps are two:
 *   HEAD → PITCH (invertible): `ringHzFor(H) = base · 2^(H / scale)`,
 *   inverted exactly by `headForRingHz(hz)` — kept from springflow so
 *   the two rooms speak the same pitch dialect across the drop band.
 *   Q_ERUPT → PLUME_HEIGHT (monotone): the visible column's top pixel
 *   IS the discharge, so a taller column IS a bigger dump.
 *
 * Pure math, no imports, no DOM — node-testable
 * (scripts/test-geyserflow.mjs). See INSPIRATION.md §2 (maps
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

// ——— the invariant ————————————————————————————————————————————

/** The phase the column is in — building, erupting, or cooling. */
export type GeyserPhase = "building" | "erupting" | "cooling";

/** The climate the sky writes: warmth walks T's mantle rate, wet walks H's recharge. */
export type Climate = {
  /** 0 = frost, 1 = high summer */
  warmth: number;
  /** 0 = drought, 1 = downpour */
  wet: number;
};

/** Every dwell-heat marker — a hand's warmth still settling into the ground. */
export type HeatMark = {
  id: number;
  /** normalized x in the section frame (POOL_X_MIN..POOL_X_MAX) */
  x: number;
  /** normalized y in the section frame (POOL_Y_MIN..POOL_Y_MAX) */
  y: number;
  /**
   * The T-contribution this marker still has to give, decays at DWELL_DECAY_S.
   * The load-bearing observable: while a hand dwells the marker charges up;
   * when it releases it decays into T, which the ledger reads back.
   */
  heat: number;
  /** deterministic phase in 0..1, from mulberry32(hashSeed(seedKey, id)) */
  phase: number;
};

/** The whole geyser: two numbers, a phase, its plume, its heat markers. */
export type GeyserState = {
  /** aquifer head, in section units 0..1 (0 = dry bedrock, 1 = brimful) */
  H: number;
  /** temperature, 0 = frost, 1 = boiling — the trigger scales in this unit */
  T: number;
  /** the current phase */
  phase: GeyserPhase;
  /** seconds elapsed since the last phase transition — resets to 0 on flip */
  tSincePhase: number;
  /** count of eruptions ever fired — a monotone-increasing witness */
  eruptions: number;
  /**
   * The eruption reference: the H and T at the *instant* of ignition, kept
   * so the closed-form decay through "erupting" can be evaluated at any
   * `tSincePhase` without a running integrator. Zero when not erupting.
   */
  H0Erupt: number;
  T0Erupt: number;
  heatMarks: HeatMark[];
  /** seconds of maturity this room has lived through */
  tau: number;
  /** the seed the room persisted under, so heat-mark phases stay stable */
  seedKey: number;
};

// ——— constants ——————————————————————————————————————————————————

/** Never let a month away become a century: world.ts's law, in seconds. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;
/** How many bounded sub-steps a caller may spend on a scatter task. */
export const SCATTER_STEPS = 8;
/**
 * The pool level under the ground, held constant — the geyser's ground is
 * a shallow reservoir whose surface stays where it is; H is the head under
 * that surface. Only `H + POOL_L` is the room's total-water observable.
 */
export const POOL_L = 0.28;
/** Section bounds — outside is air (above) or bedrock (below). */
export const POOL_X_MIN = 0.04;
export const POOL_X_MAX = 0.96;
export const POOL_Y_MIN = 0.34;
export const POOL_Y_MAX = 0.94;
/** How many heat markers a section holds at once. */
export const MAX_HEAT_MARKS = 16;

/** Base of the head→pitch map: the pitch of a bone-dry aquifer. */
export const PITCH_BASE_HZ = 110;
/**
 * Scale of the head→pitch map: an octave per PITCH_SCALE_M of head. The map
 * is `f(H) = PITCH_BASE_HZ · 2^(H / PITCH_SCALE_M)`, exactly invertible.
 * Kept identical to springflow's scale so the two rooms sound compatible.
 */
export const PITCH_SCALE_M = 0.6;

/**
 * Recharge saturates here (H-units/second at wet = 1). Chosen so a fortnight
 * of downpour lifts the head by a fraction of the section — a meaningful
 * refill without the ledger exploding past its cells. The room advances at
 * `WATCHED_SPEED` while a hand is present, so this is the ledger-time rate.
 */
export const W_MAX = 3e-4;
/**
 * Mantle heating saturates here (T-units/second at warmth = 1). Balanced
 * against T_COOL_RATE so the steady-state temperature T_ss = M/c + T_AIR
 * lands near 0.9 at warmth = 1 (hot climate → the ground climbs toward
 * boiling and fires) and near 0.28 at warmth = 0 (cold climate → the
 * ground sits at a slow simmer, cycles rarely).
 */
export const M_MAX = 6e-4;
/**
 * Baseline mantle heating even when warmth = 0 — the ground is warmer than
 * the sky. Small; a cold climate can still trigger eventually.
 */
export const M_BASELINE = 1e-4;
/**
 * Newtonian cooling coefficient: the ground exchanges heat with the air
 * above at rate `c · (T − T_air)`, per second. Chosen so the T-relaxation
 * time-constant `1/c` is ~1250s (~20 minutes) — a build slow enough to
 * feel but fast enough that a session sees several cycles.
 */
export const T_COOL_RATE = 8e-4;
/** Air temperature the T-exchange relaxes toward. Cool but not frozen. */
export const T_AIR = 0.15;
/**
 * The hysteretic trigger. `E = H · T`. The state fires when E crosses
 * `E_TRIGGER_HIGH` upward from below; the state reseats to "building"
 * only when E has fallen under `E_TRIGGER_LOW`. HIGH > LOW keeps the
 * cycle honest — a marginal E cannot fire ten times a second.
 */
export const E_TRIGGER_HIGH = 0.45;
export const E_TRIGGER_LOW = 0.20;
/** How long an eruption fires for — the fixed shape of a shot. */
export const ERUPT_DURATION_S = 8;
/**
 * Eruption decay time-constants. H and T dump exponentially through the
 * fire; τ short enough that most of the shot happens in the first few
 * seconds. Chosen so H(ERUPT_DURATION_S) / H0 ≈ 0.02 (near-empty).
 */
export const TAU_H_ERUPT = 2.0;
export const TAU_T_ERUPT = 2.5;
/**
 * Q_erupt scale: the discharge (H-units/second equivalent) at the *instant*
 * of ignition is `ERUPT_C * H0 * T0`, decaying with τ_Q. Chosen so a
 * strong eruption (H ≈ 0.9, T ≈ 0.9) discharges at a visibly large
 * amplitude on the plume-height uniform in [0, 1].
 */
export const ERUPT_C = 1.4;
export const TAU_Q_ERUPT = 2.0;
/**
 * A knock can push a near-triggered state over: if the state is in
 * "building" and `E > E_TRIGGER_HIGH − intensity · KNOCK_KAPPA`, the
 * knock fires the eruption. κ is the room's touch-reachable secret.
 */
export const KNOCK_KAPPA = 0.08;
/**
 * Dwell heat-mark decay time — a marker charges up while a hand dwells and
 * bleeds into T once the hand releases. Slow enough that a two-second
 * dwell noticeably raises the ground for a minute after.
 */
export const DWELL_DECAY_S = 60;
/**
 * How much T a saturating dwell contributes at full. Small — a hand cannot
 * fire the geyser by itself, only accelerate an already-hot ground. The
 * cap is real; a maximal dwell only shifts the interval by a factor.
 */
export const DWELL_T_MAX = 0.18;
/**
 * The scrub verb (surface stir) cools the pool by exchanging with the air.
 * Rate is the same shape as T_COOL_RATE but only fires while a stir event
 * is live; the test pins the monotonicity.
 */
export const STIR_COOL_BONUS = 6e-4;

// ——— rates ——————————————————————————————————————————————————————

/** Recharge as a linear response to wet; bounded below zero and at W_MAX. */
export function rechargeRate(c: Climate): number {
  return W_MAX * clamp01(c.wet);
}

/**
 * Mantle heating as a baseline plus a warmth-scaled linear response. Bounded
 * below at M_BASELINE and above at M_BASELINE + M_MAX.
 */
export function mantleRate(c: Climate): number {
  return M_BASELINE + M_MAX * clamp01(c.warmth);
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

// ——— observables the shader, the audio, and the tests read ———————————

/**
 * The current eruption discharge — 0 outside "erupting". A closed-form
 * decay at rate 1/TAU_Q_ERUPT from the H0·T0 at ignition. Load-bearing:
 * `plumeHeight` in the component is this observable, monotone.
 */
export function Q_erupt(state: GeyserState): number {
  if (state.phase !== "erupting") return 0;
  const decay = Math.exp(-state.tSincePhase / TAU_Q_ERUPT);
  return ERUPT_C * state.H0Erupt * state.T0Erupt * decay;
}

/** The plume height as a normalized [0, 1] — a saturating map from Q. */
export function plumeHeightFor(state: GeyserState): number {
  const q = Q_erupt(state);
  // saturating: a small discharge is small, a huge discharge tops out at 1
  return q > 0 ? 1 - Math.exp(-q * 1.4) : 0;
}

/** Phase name, exported as a string for legibility across the boundary. */
export function phaseName(state: GeyserState): GeyserPhase {
  return state.phase;
}

/**
 * Closed-form head at time t under linear recharge: H0 + W·t. A free
 * (non-closure) function so the binary searches below don't allocate a
 * fresh closure on every call — same arithmetic, hoisted.
 */
function headAtLinear(H0: number, W: number, t: number): number {
  return H0 + W * t;
}

/** Closed-form temperature at time t relaxing toward T_ss at rate c. */
function tempAtRelax(T_ss: number, T0: number, c: number, t: number): number {
  return T_ss - (T_ss - T0) * Math.exp(-c * t);
}

/** E(t) = H(t) · T(t) for the same closed forms above. */
function energyAtLinearRelax(
  H0: number,
  W: number,
  T_ss: number,
  T0: number,
  c: number,
  t: number,
): number {
  return headAtLinear(H0, W, t) * tempAtRelax(T_ss, T0, c, t);
}

/**
 * Time until the next eruption, assuming climate holds. Returns +∞ if the
 * state is not "building" (a caller reading this while "erupting" or
 * "cooling" gets Infinity, and knows). While "building" the eruption fires
 * when E = H · T crosses E_TRIGGER_HIGH; solve this against the closed-
 * form H(t) = H0 + W·t and T(t) = T_ss − (T_ss − T0)·e^{-c·t} for the
 * first positive root by monotone binary search — cheap and bounded.
 *
 * `T_ss = (M + c · T_air) / c` is the steady-state temperature.
 */
export function timeUntilEruption(state: GeyserState, climate: Climate): number {
  if (state.phase !== "building") return Infinity;
  const W = rechargeRate(climate);
  const M = mantleRate(climate);
  const c = T_COOL_RATE;
  const T_ss = (M + c * T_AIR) / c;
  const E0 = state.H * state.T;
  if (E0 >= E_TRIGGER_HIGH) return 0; // already over
  // If M ≤ 0 (impossible with M_BASELINE > 0 but be defensive) and W = 0,
  // the state cannot heat toward the trigger, so it never fires.
  const H0 = state.H;
  const T0 = state.T;
  // Bracket: E is monotone in t (both H and T are non-decreasing here when
  // T0 <= T_ss; when T0 > T_ss, T decays and the geyser is off-cycle).
  // Find an upper bracket by doubling; cap at MAX_ELAPSED_S.
  if (state.T > T_ss && W <= 0) return Infinity;
  let lo = 0;
  let hi = 60; // start with a minute
  let it = 0;
  while (
    energyAtLinearRelax(H0, W, T_ss, T0, c, hi) < E_TRIGGER_HIGH &&
    hi < MAX_ELAPSED_S &&
    it < 40
  ) {
    lo = hi;
    hi *= 2;
    it++;
  }
  if (energyAtLinearRelax(H0, W, T_ss, T0, c, hi) < E_TRIGGER_HIGH) return Infinity;
  // Bisect. 60 iterations bring the interval down to ~1e-12 · hi.
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (energyAtLinearRelax(H0, W, T_ss, T0, c, mid) < E_TRIGGER_HIGH) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Total water — the conservation observable. `H` is the head under the
 * pool; the pool level is a constant `POOL_L`. During an eruption the
 * ledger loses head to the plume; the test pins that Q_erupt subtracts
 * exactly what it says.
 */
export function totalWater(state: GeyserState): number {
  return state.H + POOL_L;
}

// ——— the closed-form advance, per phase branch ——————————————————

/**
 * Advance the phase-tagged ledger by `seconds`. Walks time forward one
 * phase-branch at a time — a `seconds` argument spanning many cycles will
 * cross multiple phase boundaries, each transition read off the closed
 * form. Never Euler; the tolerance is floating-point, not step-size.
 *
 * The three branches:
 *   "building" — H rises linearly at W, T relaxes exponentially toward
 *                T_ss = (M + c·T_air) / c at rate c. The phase ends when
 *                E = H · T crosses E_TRIGGER_HIGH.
 *   "erupting" — H and T decay exponentially at τ_H and τ_T from H0Erupt,
 *                T0Erupt. The phase ends at exactly ERUPT_DURATION_S.
 *   "cooling"  — H stays put (or slowly recharges), T relaxes exponentially
 *                toward T_ss. The phase ends when E has fallen below
 *                E_TRIGGER_LOW.
 */
export function advanceExact(
  state: GeyserState,
  seconds: number,
  climate: Climate,
): GeyserState {
  if (!(seconds > 0)) return state;
  // Cap first, so a month away is not a century of drift.
  let remaining = Math.min(seconds, MAX_ELAPSED_S);
  let s = state;
  let guard = 0;
  while (remaining > 0 && guard < 4096) {
    guard++;
    const step = phaseStep(s, remaining, climate);
    s = step.next;
    remaining -= step.consumed;
    // Numerical belt: if a branch consumed nothing (e.g. a degenerate
    // climate where T sits at exactly T_ss and E never crosses), bail
    // rather than loop forever.
    if (step.consumed <= 0) break;
  }
  return s;
}

type PhaseStep = { next: GeyserState; consumed: number };

function phaseStep(state: GeyserState, budget: number, climate: Climate): PhaseStep {
  const bleed = bleedHeatMarks(state, budget);
  const s = bleed.state;
  const bleedT = bleed.tContribution;
  const W = rechargeRate(climate);
  const M = mantleRate(climate);
  const c = T_COOL_RATE;
  const T_ss = (M + c * T_AIR) / c;
  if (s.phase === "building") {
    // How long until E crosses HIGH? If never, spend the whole budget.
    const tCross = timeUntilEruption(s, climate);
    const dt = Math.min(budget, tCross, MAX_ELAPSED_S);
    const H1 = s.H + W * dt;
    // T evolves with the bleed as a small additional rate on top: treat
    // the bleed as an added constant heating over the sub-step, which is
    // the closed-form solution to dT/dt = M + bleedRate − c·(T − T_air)
    // where bleedRate = bleedT / budget (spread uniformly).
    const bleedRate = budget > 0 ? bleedT / budget : 0;
    const M_eff = M + bleedRate;
    const T_ss_eff = (M_eff + c * T_AIR) / c;
    const T1 = T_ss_eff - (T_ss_eff - s.T) * Math.exp(-c * dt);
    if (dt >= tCross && Number.isFinite(tCross)) {
      // We land at the trigger — flip to erupting.
      return {
        next: {
          ...s,
          H: H1,
          T: T1,
          phase: "erupting",
          tSincePhase: 0,
          H0Erupt: H1,
          T0Erupt: T1,
          tau: s.tau + dt,
        },
        consumed: dt,
      };
    }
    return {
      next: {
        ...s,
        H: H1,
        T: T1,
        tSincePhase: s.tSincePhase + dt,
        tau: s.tau + dt,
      },
      consumed: dt,
    };
  }
  if (s.phase === "erupting") {
    const remainingInPhase = ERUPT_DURATION_S - s.tSincePhase;
    const dt = Math.min(budget, Math.max(0, remainingInPhase));
    // Decay along closed-form exponentials from H0Erupt, T0Erupt with
    // total elapsed = tSincePhase + dt.
    const total = s.tSincePhase + dt;
    const H1 = s.H0Erupt * Math.exp(-total / TAU_H_ERUPT);
    const T1 = s.T0Erupt * Math.exp(-total / TAU_T_ERUPT);
    if (dt >= remainingInPhase) {
      // Phase ends: eruption expires and we move to cooling. Increment the
      // count. Recharge nudges H a hair (W · dt) since a small refill
      // happens during the fire itself — but we keep it in the decay for
      // simplicity: the eruption *dumps* net water.
      return {
        next: {
          ...s,
          H: H1,
          T: T1,
          phase: "cooling",
          tSincePhase: 0,
          eruptions: s.eruptions + 1,
          H0Erupt: 0,
          T0Erupt: 0,
          tau: s.tau + dt,
        },
        consumed: dt,
      };
    }
    return {
      next: {
        ...s,
        H: H1,
        T: T1,
        tSincePhase: s.tSincePhase + dt,
        tau: s.tau + dt,
      },
      consumed: dt,
    };
  }
  // "cooling"
  {
    // In cooling, H recharges (W · dt) and T relaxes toward T_ss. Just after
    // a fire, H and T are both low so E is well under E_TRIGGER_LOW. The
    // phase ends when E has climbed back UPWARD past E_TRIGGER_LOW — the
    // hysteresis reseat: the next build cannot begin until the state has
    // fully cleared the cool corner. If E is already above LOW (a manual
    // ceremony fired the throat before it had fully dumped, say), the
    // cooling phase is immediate and the state flips to building at once —
    // that is legal, if unusual.
    const bleedRate = budget > 0 ? bleedT / budget : 0;
    const M_eff = M + bleedRate;
    const T_ss_eff = (M_eff + c * T_AIR) / c;
    let phaseEnd: number;
    if (energyAtLinearRelax(s.H, W, T_ss_eff, s.T, c, 0) >= E_TRIGGER_LOW) {
      // Already back above LOW — the reseat happens immediately.
      phaseEnd = 0;
    } else {
      // Bracket: E must climb past LOW. Doubling; cap at MAX_ELAPSED_S.
      // If T_ss_eff is low enough that E cannot climb past LOW (e.g. a
      // frozen climate), phaseEnd stays at Infinity and the state stays
      // in cooling forever — a legitimate winter behavior.
      let lo = 0;
      let hi = 60;
      let it = 0;
      while (
        energyAtLinearRelax(s.H, W, T_ss_eff, s.T, c, hi) < E_TRIGGER_LOW &&
        hi < MAX_ELAPSED_S &&
        it < 40
      ) {
        lo = hi;
        hi *= 2;
        it++;
      }
      if (energyAtLinearRelax(s.H, W, T_ss_eff, s.T, c, hi) >= E_TRIGGER_LOW) {
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2;
          if (energyAtLinearRelax(s.H, W, T_ss_eff, s.T, c, mid) < E_TRIGGER_LOW) lo = mid;
          else hi = mid;
        }
        phaseEnd = (lo + hi) / 2;
      } else {
        phaseEnd = Infinity;
      }
    }
    const dt = Math.min(budget, phaseEnd, MAX_ELAPSED_S);
    const H1 = s.H + W * dt;
    const T1 = T_ss_eff - (T_ss_eff - s.T) * Math.exp(-c * dt);
    if (Number.isFinite(phaseEnd) && dt >= phaseEnd) {
      return {
        next: {
          ...s,
          H: H1,
          T: T1,
          phase: "building",
          tSincePhase: 0,
          tau: s.tau + dt,
        },
        consumed: dt,
      };
    }
    return {
      next: {
        ...s,
        H: H1,
        T: T1,
        tSincePhase: s.tSincePhase + dt,
        tau: s.tau + dt,
      },
      consumed: dt,
    };
  }
}

/**
 * Heat markers decay exponentially at 1/DWELL_DECAY_S; the amount that
 * bled off during the step is returned as an additive heating contribution
 * for the phase branch to fold into T. Pure, order-stable.
 */
function bleedHeatMarks(
  state: GeyserState,
  budget: number,
): { state: GeyserState; tContribution: number } {
  if (state.heatMarks.length === 0) return { state, tContribution: 0 };
  let contribution = 0;
  const next: HeatMark[] = [];
  // decay depends only on `budget`, not on the individual mark — hoisted
  // out of the loop so it's one Math.exp per call, not one per mark.
  const decay = Math.exp(-budget / DWELL_DECAY_S);
  for (const m of state.heatMarks) {
    const bled = m.heat * (1 - decay);
    contribution += bled;
    const remain = m.heat * decay;
    if (remain > 1e-6) next.push({ ...m, heat: remain });
  }
  return { state: { ...state, heatMarks: next }, tContribution: contribution };
}

// ——— what a hand does ————————————————————————————————————————

/** Where a new heat marker would sit — the section's own bounds. */
export function inSectionBounds(x: number, y: number): boolean {
  return x >= POOL_X_MIN && x <= POOL_X_MAX && y >= POOL_Y_MIN && y <= POOL_Y_MAX;
}

/**
 * Plant a heat marker at (x, y) with the given heat. A no-op when outside
 * the section bounds — the material refuses rather than pretends to warm
 * the sky. Also refuses when the section already holds the cap.
 */
export function plantHeatMark(
  state: GeyserState,
  x: number,
  y: number,
  heat: number,
): GeyserState {
  if (!inSectionBounds(x, y)) return state;
  if (state.heatMarks.length >= MAX_HEAT_MARKS) return state;
  let id = 1;
  for (const m of state.heatMarks) if (m.id >= id) id = m.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id))();
  const mark: HeatMark = {
    id,
    x: clamp01(x),
    y: clamp01(y),
    heat: clamp(heat, 0, DWELL_T_MAX),
    phase,
  };
  return { ...state, heatMarks: [...state.heatMarks, mark] };
}

/**
 * Deepen a heat marker's contribution. Saturating at DWELL_T_MAX. The
 * dwell handler calls this at each tier tick with the tier-scaled target.
 */
export function deepenHeatMark(
  state: GeyserState,
  id: number,
  dHeat: number,
): GeyserState {
  const heatMarks = state.heatMarks.map((m) =>
    m.id === id ? { ...m, heat: clamp(m.heat + dHeat, 0, DWELL_T_MAX) } : m,
  );
  return { ...state, heatMarks };
}

/**
 * Manual eruption — the ceremony. Fires the throat regardless of the
 * trigger, dumps H and T as a normal fire would, and marks the state as
 * `erupting`. A no-op if already erupting.
 */
export function manualErupt(state: GeyserState): GeyserState {
  if (state.phase === "erupting") return state;
  return {
    ...state,
    phase: "erupting",
    tSincePhase: 0,
    H0Erupt: state.H,
    T0Erupt: state.T,
  };
}

/**
 * A knock can fire a near-triggered state: if the state is in "building"
 * and E > E_TRIGGER_HIGH − intensity · κ, the throat blows. Returns the
 * new state and a boolean saying whether the knock actually landed as
 * an eruption. The room's touch-reachable secret.
 */
export function knockErupt(
  state: GeyserState,
  intensity: number,
): { state: GeyserState; fired: boolean } {
  if (state.phase !== "building") return { state, fired: false };
  const i = clamp01(intensity);
  const E = state.H * state.T;
  const shifted = E_TRIGGER_HIGH - i * KNOCK_KAPPA;
  if (E >= shifted) {
    return { state: manualErupt(state), fired: true };
  }
  return { state, fired: false };
}

/** Cooling accelerator for the scrub verb — subtract a small T rate. */
export function stirCool(state: GeyserState, seconds: number): GeyserState {
  if (seconds <= 0) return state;
  // A closed-form additional cooling: T' = T + (T_air − T) · (1 − e^{-r·dt})
  // where r is STIR_COOL_BONUS. Pushes T toward T_air over the step.
  const decay = 1 - Math.exp(-STIR_COOL_BONUS * seconds);
  const T1 = state.T + (T_AIR - state.T) * decay;
  return { ...state, T: T1 };
}

/** The heat marker nearest (x, y) within `within`, or null. */
export function nearestHeatMark(
  state: GeyserState,
  x: number,
  y: number,
  within = 0.14,
): HeatMark | null {
  let best: HeatMark | null = null;
  let bestD = within;
  for (const m of state.heatMarks) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

// ——— starter, storage ————————————————————————————————————————

/**
 * The geyser that is already there the first time anyone arrives. A modest
 * head, a warm-but-not-triggered temperature, phase = "building". The
 * cycle is already running — alive before it is touched.
 */
export function initState(seed: number): GeyserState {
  const rng = mulberry32(seed >>> 0);
  const H = 0.38 + rng() * 0.08;
  const T = 0.42 + rng() * 0.06;
  return {
    H,
    T,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 12 * 3600,
    seedKey: seed >>> 0,
  };
}
