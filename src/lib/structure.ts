/**
 * structure.ts — one abstract dynamical structure, compiled into every sense.
 *
 * This is the substrate compiler's kernel: a substrate-independent state
 * machine for "concern becoming agency", plus a set of pure compilers that
 * carry it — without loss where the medium allows, with a stated tolerance
 * where it does not — into sound, shape, text, space, and touch. The point
 * of the room over it (src/components/StructureLoom.tsx) is that all five
 * play AT ONCE from this one S, and a live table proves each compiler
 * commutes with `step`: compile∘step ≈ step_medium∘compile.
 *
 * The arc (INSPIRATION.md §2a — the q→ι cycle made playable):
 *   local accumulation → a global phase transition → a hidden variable
 *   (reach) revealed only by crossing → memory as hysteresis → agency as
 *   the selective reopening of previously inaccessible paths.
 *
 * Pure math. No imports, no DOM — node-testable (scripts/test-structure.mjs).
 * Everything a compiler needs is derived from the small state vector, so the
 * whole file loads standalone in the test harness.
 */

// ——— the phases ———
export const PHASES = ["latent", "gathering", "threshold", "agency", "rest"] as const;
export type Phase = (typeof PHASES)[number];

// ——— the state vector ———
// tension  — accumulated concern (rises under attention)
// coherence — how aligned the internal model is (locks at the crossing)
// reach    — how much of the possible-future space is accessible (the hidden
//            variable, near-flat until the crossing throws it open)
// visited  — has this run crossed before? (memory → hysteresis)
// phaseT   — seconds spent in the current phase (only the threshold plateau
//            reads it) — bookkeeping, part of the fiber, not carried by any
//            medium.
export type State = {
  tension: number;
  coherence: number;
  reach: number;
  phase: Phase;
  visited: boolean;
  phaseT: number;
};

// ——— surface parameters: the realization fiber ———
// Different admissible instances (structureFromSeed) vary ONLY these — how
// the same structure looks, sounds, and is voiced. The invariant-critical
// constants below are fixed, so every seed preserves the same invariants.
export type Params = {
  accumRate: number; // how fast tension pools (speed, not threshold)
  soundBaseHz: number; // register root for the sound compiler
  hueDeg: number; // palette anchor for the visual compiler
  symmetry: number; // base vertex/petal count before the snap
  voices: number; // chord voices in the sound compiler
};

export const DEFAULT_PARAMS: Params = {
  accumRate: 1,
  soundBaseHz: 110,
  hueDeg: 44,
  symmetry: 4,
  voices: 4,
};

// ——— invariant-critical constants (fixed across the fiber) ———
const T_FLOOR = 0.18; // tension left after the crossing spends it
const T_GATHER = 0.14; // above this, latent → gathering
const T_CRIT = 0.82; // first crossing threshold
const T_CRIT_RE = 0.52; // hysteresis: the second crossing is easier
const G_REACH = 0.6; // share of released tension that becomes reach
const G_COH = 0.4; // share that becomes coherence (G_REACH + G_COH = 1)
const R_EXIT = 0.16; // reach below this ends agency → rest
const THRESH_HOLD = 0.3; // seconds the threshold plateau is felt
const K_ACCUM = 0.9; // accumulation gain
const K_LEAK = 0.12; // tension leak without attention
const K_DECAY_R = 0.25; // reach decay in agency/rest without renewal
const K_DECAY_C = 0.2; // coherence decay without renewal
const K_RENEW = 0.8; // renewal rebuilds reach (selective reopening)

const R0 = 0.12; // reach at rest — the penned floor
const C0 = 0.22; // coherence before any lock

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampParams(p: Params): Params {
  return {
    accumRate: Math.max(0.5, Math.min(1.5, p.accumRate)),
    soundBaseHz: Math.max(40, Math.min(440, p.soundBaseHz)),
    hueDeg: ((p.hueDeg % 360) + 360) % 360,
    symmetry: Math.max(3, Math.min(7, Math.round(p.symmetry))),
    voices: Math.max(3, Math.min(6, Math.round(p.voices))),
  };
}

export function initialState(): State {
  return { tension: 0, coherence: C0, reach: R0, phase: "latent", visited: false, phaseT: 0 };
}

// ——— the realization fiber ———
// A deterministic admissible instance from a seed: same invariants, different
// surface. mulberry32 inline so the file stays import-free.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function structureFromSeed(seed: number): { params: Params; state: State } {
  const rng = mulberry32(seed >>> 0);
  const baseChoices = [82.41, 98, 110, 130.81, 146.83];
  const params: Params = clampParams({
    accumRate: 0.75 + rng() * 0.45,
    soundBaseHz: baseChoices[Math.floor(rng() * baseChoices.length)],
    hueDeg: Math.floor(rng() * 360),
    symmetry: 3 + Math.floor(rng() * 4),
    voices: 3 + Math.floor(rng() * 3),
  });
  return { params, state: initialState() };
}

// ——— the input the hand pours in ———
export type Input = {
  /** Attention poured in this frame (raises tension) — 0..1. */
  attention: number;
  /** Renewal in agency (keeps the way open); defaults to attention. */
  renew?: number;
};

export const PHASE_ORDER: Record<Phase, number> = {
  latent: 0,
  gathering: 1,
  threshold: 2,
  agency: 3,
  rest: 4,
};

export function phaseOf(s: State): Phase {
  return s.phase;
}

/** The conserved quantity: total intensity spread across the three axes. */
export function conservedQuantity(s: State): number {
  return s.tension + s.reach + s.coherence;
}

/** The threshold in force for this state (lower once the run has crossed). */
export function currentThreshold(s: State): number {
  return s.visited ? T_CRIT_RE : T_CRIT;
}

/**
 * Advance S by dt seconds under input. Deterministic and pure.
 *
 * Regimes:
 *  - accumulation (latent/gathering/rest): tension pools monotonically under
 *    attention; at the threshold it fires a single discontinuous
 *    redistribution — tension is SPENT into reach and coherence, conserving
 *    total intensity — and the run is marked visited (hysteresis).
 *  - threshold: a brief felt plateau, then agency.
 *  - agency: reach and coherence decay toward rest unless renewed; renewal
 *    reopens reach. Below R_EXIT the way closes → rest.
 */
export function step(state: State, input: Input, dt: number, params: Params = DEFAULT_PARAMS): State {
  const P = clampParams(params);
  const d = Math.max(0, Math.min(0.25, dt));
  const a = clamp01(input.attention);
  const renew = clamp01(input.renew ?? input.attention);

  let { tension: T, coherence: C, reach: R, phase, visited, phaseT } = state;
  const tCrit = visited ? T_CRIT_RE : T_CRIT;

  if (phase === "latent" || phase === "gathering" || phase === "rest") {
    // Accumulation: monotone under attention (leak only bites when idle).
    const dT = (K_ACCUM * P.accumRate * a * (1 - T) - K_LEAK * (1 - a) * T) * d;
    T = clamp01(T + dT);
    if (phase === "rest") {
      // The spent agency keeps settling while tension rebuilds.
      R = Math.max(0, R - K_DECAY_R * R * d);
      C = Math.max(0, C - K_DECAY_C * C * d);
    }
    if (T >= tCrit) {
      // THE CROSSING — a discontinuous redistribution, conserving intensity.
      const release = T - T_FLOOR;
      T = T_FLOOR;
      R = clamp01(R + G_REACH * release);
      C = clamp01(C + G_COH * release);
      phase = "threshold";
      phaseT = 0;
      visited = true;
    } else {
      phase = T < T_GATHER ? (visited ? "rest" : "latent") : "gathering";
      phaseT = 0;
    }
  } else if (phase === "threshold") {
    phaseT += d;
    // The plateau holds reach and coherence; a hair of tension bleeds.
    T = Math.max(0, T - K_LEAK * T * d);
    if (phaseT >= THRESH_HOLD) {
      phase = "agency";
      phaseT = 0;
    }
  } else {
    // agency
    R = clamp01(R - K_DECAY_R * (1 - renew) * R * d + K_RENEW * renew * (1 - R) * d);
    C = clamp01(C - K_DECAY_C * (1 - renew) * C * d);
    T = Math.max(0, T - K_LEAK * T * d);
    phaseT += d;
    if (R < R_EXIT) {
      phase = "rest";
      phaseT = 0;
    }
  }

  return { tension: T, coherence: C, reach: R, phase, visited, phaseT };
}

// ══════════════════════════════════════════════════════════════════════
// Selection — the symbolic-causation metric made concrete.
//
// At agency the reachable future is a landscape of gates. An intervention
// biases which gates open: a positive choice reaches for far futures (and
// lets near ones close), a negative choice hugs the near. selectionShift
// measures how far the whole landscape moved — 0 outside agency, >0 at
// agency, monotone in |choice|.
// ══════════════════════════════════════════════════════════════════════

export const N_GATES = 9;
const GATE_EPS = 0.12; // softness of a gate's edge
const GATE_BIAS = 0.7; // how strongly a choice tilts the horizon

// Gate positions never change (N_GATES is fixed), so the p_i = i/(N-1)
// values are computed once here instead of on every reachableRegion call.
const GATE_POSITIONS: readonly number[] = Array.from({ length: N_GATES }, (_, i) => i / (N_GATES - 1));

/** Gate positions along the future axis: p_i = i/(N-1) ∈ [0,1]. */
export function gatePositions(): number[] {
  return GATE_POSITIONS.slice();
}

/**
 * Soft reachability of each gate under a selection bias: sigmoid of how far
 * the (bias-tilted) reach horizon clears the gate. Continuous, so the shift
 * metric is smooth and monotone in |bias|.
 */
export function reachableRegion(s: State, bias: number): number[] {
  const b = Math.max(-1, Math.min(1, bias));
  return GATE_POSITIONS.map((p) => {
    // A positive bias lifts the horizon for far gates, lowers it for near.
    const horizon = s.reach * (1 + GATE_BIAS * b * (2 * p - 1));
    return 1 / (1 + Math.exp(-(horizon - p) / GATE_EPS));
  });
}

/** In agency? (selection only bites once the way is open.) */
function inAgency(s: State): boolean {
  return s.phase === "agency" || s.phase === "threshold";
}

export type Selection = {
  reachableBefore: number[];
  reachableAfter: number[];
  shift: number;
  state: State;
};

/** Shared summation core for selectionShift, given already-computed regions. */
function shiftFromRegions(before: number[], after: number[]): number {
  let sum = 0;
  for (let i = 0; i < before.length; i++) sum += Math.abs(after[i] - before[i]);
  return sum / before.length;
}

/**
 * Apply a choice at agency: the landscape moves (before→after), and the
 * selection reopens reach toward what was chosen — agency as the selective
 * reopening of previously inaccessible paths. Outside agency it is inert.
 */
export function select(s: State, choice: number): Selection {
  const before = reachableRegion(s, 0);
  if (!inAgency(s)) {
    return { reachableBefore: before, reachableAfter: before, shift: 0, state: s };
  }
  const after = reachableRegion(s, choice);
  // before/after are already computed above — reuse them instead of asking
  // selectionShift to recompute both reachableRegion calls from scratch.
  const shift = shiftFromRegions(before, after);
  const reopened = clamp01(s.reach + 0.25 * Math.abs(Math.max(-1, Math.min(1, choice))) * (1 - s.reach));
  return {
    reachableBefore: before,
    reachableAfter: after,
    shift,
    state: { ...s, reach: reopened },
  };
}

/** How much the reachable landscape moved, 0..1. Monotone in |choice|. */
export function selectionShift(s: State, choice: number): number {
  if (!inAgency(s)) return 0;
  const before = reachableRegion(s, 0);
  const after = reachableRegion(s, choice);
  return shiftFromRegions(before, after);
}

// ══════════════════════════════════════════════════════════════════════
// The compilers: S → medium params. Each is a pure function of the state
// (surface parameters where the medium is idiomatic about material). Each
// has a decode inverse on the axes it carries, so the commuting diagram
// compile∘step ≈ step_medium∘compile is testable — step_medium being
// compile∘step∘decode. The residual of decode∘compile is what the room's
// verification table reads live.
// ══════════════════════════════════════════════════════════════════════

// The carried axes — what "the same structure" means across substrates.
export type Carried = { tension: number; coherence: number; reach: number; phase: Phase };

export function carried(s: State): Carried {
  return { tension: s.tension, coherence: s.coherence, reach: s.reach, phase: s.phase };
}

// ——— sound: tension → dissonance, coherence → harmonicity, reach → spread,
// the phase transition → a resolution. Lossless on the axes (tol 1e-6). ———
export type SoundSpec = {
  phase: Phase;
  dissonance: number; // 0..1 — pitch tension / beating
  harmonicity: number; // 0..1 — how consonant the chord is
  spread: number; // 0..1 — register spread of the voices
  rootHz: number; // surface — the register root
  resolve: number; // 0/1 — resolved once across the threshold
};

export function compileSound(s: State, params: Params = DEFAULT_PARAMS): SoundSpec {
  const P = clampParams(params);
  return {
    phase: s.phase,
    dissonance: s.tension,
    harmonicity: s.coherence,
    spread: s.reach,
    rootHz: P.soundBaseHz,
    resolve: s.phase === "agency" || s.phase === "rest" ? 1 : 0,
  };
}

export function decodeSound(spec: SoundSpec): Carried {
  return { tension: spec.dissonance, coherence: spec.harmonicity, reach: spec.spread, phase: spec.phase };
}

// ——— visual: a field that gathers, then snaps into a new symmetry at the
// threshold; reach → how far the form extends. ConcernSigil polygon idiom. ———
export type VisualSpec = {
  phase: Phase;
  radius: number; // 0.15..1 — reach → extent
  gather: number; // 0..1 — tension → how tight the form pulls in
  lock: number; // 0..1 — coherence → symmetry lock
  symmetry: number; // integer — snaps up at the threshold (discontinuous)
};

export function compileVisual(s: State, params: Params = DEFAULT_PARAMS): VisualSpec {
  const P = clampParams(params);
  const snapped = s.phase === "latent" || s.phase === "gathering";
  return {
    phase: s.phase,
    radius: 0.15 + s.reach * 0.85,
    gather: s.tension,
    lock: s.coherence,
    symmetry: snapped ? P.symmetry : P.symmetry * 2 + 1,
  };
}

export function decodeVisual(spec: VisualSpec): Carried {
  return {
    tension: spec.gather,
    coherence: spec.lock,
    reach: (spec.radius - 0.15) / 0.85,
    phase: spec.phase,
  };
}

// ——— text: a line via buildReading-style tiering. This is a genuine
// quotient q — the line knows only the PHASE, forgetting the magnitudes
// (they stay in the fiber). What descends is the phase order. ———
export type TextSpec = { phase: Phase; tier: number; line: string };

const LINES: Record<Phase, string> = {
  latent: "the field is quiet; nothing has gathered to it yet.",
  gathering: "attention pools, and the weight begins to lean.",
  threshold: "the seam gives — every sense crosses at once.",
  agency: "the way stands open; choose which future to keep.",
  rest: "the reach closes softly; the crossing is remembered.",
};

export function compileText(s: State): TextSpec {
  return { phase: s.phase, tier: PHASE_ORDER[s.phase], line: LINES[s.phase] };
}

/** Text carries only the phase; decode recovers that and nothing more. */
export function decodeTextPhase(spec: TextSpec): Phase {
  return PHASES[spec.tier];
}

// ——— navigation/space: reach → traversable fraction of the room. Quantized
// to a grid of cells — a lossy-but-commuting medium (tol: 1 cell). ———
export const NAV_GRID = 48;
export type NavSpec = { phase: Phase; openCells: number; penned: boolean };

export function compileNav(s: State): NavSpec {
  return {
    phase: s.phase,
    openCells: Math.round(s.reach * NAV_GRID),
    penned: !(s.phase === "agency" || s.phase === "threshold"),
  };
}

export function decodeNavReach(spec: NavSpec): number {
  return spec.openCells / NAV_GRID;
}

// ——— tactile: accumulation = rising ticks, threshold = the bloom, agency =
// a sustained presence. Lossless on the axes (tol 1e-6). ———
export type TactileSpec = {
  phase: Phase;
  tickHz: number; // 1..8 — tension → tick rate
  presence: number; // 0..1 — reach → sustained presence
  grip: number; // 0..1 — coherence → steadiness
  bloom: boolean; // the threshold pulse
};

export function compileTactile(s: State): TactileSpec {
  return {
    phase: s.phase,
    tickHz: 1 + s.tension * 7,
    presence: s.reach,
    grip: s.coherence,
    bloom: s.phase === "threshold",
  };
}

export function decodeTactile(spec: TactileSpec): Carried {
  return { tension: (spec.tickHz - 1) / 7, coherence: spec.grip, reach: spec.presence, phase: spec.phase };
}

// ══════════════════════════════════════════════════════════════════════
// Live verification — the round-trip residual each medium currently carries.
// The room renders this as the always-live table: a medium "preserves" the
// structure when decode∘compile recovers the carried axes within its stated
// tolerance. This makes the commuting diagrams visible.
// ══════════════════════════════════════════════════════════════════════

export type MediumId = "sound" | "visual" | "text" | "nav" | "tactile";

export const MEDIUM_TOL: Record<MediumId, number> = {
  sound: 1e-6,
  visual: 1e-6,
  text: 1e-9, // exact on the phase lattice; the fiber is deliberately forgotten
  nav: 1 / NAV_GRID + 1e-9, // one cell of quantization
  tactile: 1e-6,
};

function carriedResidual(a: Carried, b: Carried): number {
  const dp = a.phase === b.phase ? 0 : 1;
  return Math.max(
    Math.abs(a.tension - b.tension),
    Math.abs(a.coherence - b.coherence),
    Math.abs(a.reach - b.reach),
    dp,
  );
}

export type MediumVerdict = { medium: MediumId; preserves: boolean; residual: number; tol: number };

export function verify(s: State, params: Params = DEFAULT_PARAMS): MediumVerdict[] {
  const c = carried(s);
  const out: MediumVerdict[] = [];

  const rSound = carriedResidual(c, decodeSound(compileSound(s, params)));
  out.push({ medium: "sound", preserves: rSound <= MEDIUM_TOL.sound, residual: rSound, tol: MEDIUM_TOL.sound });

  const rVisual = carriedResidual(c, decodeVisual(compileVisual(s, params)));
  out.push({ medium: "visual", preserves: rVisual <= MEDIUM_TOL.visual, residual: rVisual, tol: MEDIUM_TOL.visual });

  // text carries only the phase; residual is on the phase lattice.
  const rText = decodeTextPhase(compileText(s)) === s.phase ? 0 : 1;
  out.push({ medium: "text", preserves: rText <= MEDIUM_TOL.text, residual: rText, tol: MEDIUM_TOL.text });

  // nav carries only reach (quantized) + phase.
  const rNav = Math.abs(s.reach - decodeNavReach(compileNav(s)));
  out.push({ medium: "nav", preserves: rNav <= MEDIUM_TOL.nav, residual: rNav, tol: MEDIUM_TOL.nav });

  const rTac = carriedResidual(c, decodeTactile(compileTactile(s)));
  out.push({ medium: "tactile", preserves: rTac <= MEDIUM_TOL.tactile, residual: rTac, tol: MEDIUM_TOL.tactile });

  return out;
}

// ——— invariant predicates (pure; used by the room's live table and tests) ———

/** Strictly rising to a small tolerance. */
export function isMonotoneRising(values: number[], eps = 1e-9): boolean {
  for (let i = 1; i < values.length; i++) if (values[i] < values[i - 1] - eps) return false;
  return values.length >= 2 && values[values.length - 1] > values[0] + eps;
}

/** Non-increasing to a small tolerance. */
export function isMonotoneFalling(values: number[], eps = 1e-9): boolean {
  for (let i = 1; i < values.length; i++) if (values[i] > values[i - 1] + eps) return false;
  return values.length >= 2 && values[values.length - 1] < values[0] - eps;
}

/** The reach jump seen across a crossing in a state series (invariant ii). */
export function reachJump(states: State[]): number {
  let best = 0;
  for (let i = 1; i < states.length; i++) {
    if (states[i - 1].phase === "gathering" && states[i].phase === "threshold") {
      best = Math.max(best, states[i].reach - states[i - 1].reach);
    }
  }
  return best;
}
