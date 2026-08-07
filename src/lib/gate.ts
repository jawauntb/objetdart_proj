/**
 * gate — the channel that answers the sample, as laws.
 *
 * A cross-section of the NMDA-type ionotropic glutamate receptor's ion channel:
 * four subunit helices arranged in a fourfold-ish assembly around a central
 * pore. Two GluN1 subunits (light grey) sit beside two GluN2 subunits (green
 * for 2A, blue for 2B) — a diheteromer, the canonical form. The pore descends
 * from the extracellular vestibule (top) through the gate (middle constriction)
 * to the selectivity filter (below). When bound, the same substance /observe
 * built up around — the o-chlorophenyl cyclohexanone family — sits in the
 * transmembrane vestibule between the M2 and M3 helices, above the gate, and
 * blocks ion flow. When unbound and the span is holding the gate open, ions
 * (Ca²⁺ / Na⁺ / K⁺, unlabeled in the material) descend the pore.
 *
 * The room does NOT own pinch — it is one scene at one altitude, no zoom
 * sweep. Pinch-travel through ScaleTravel presses the /drop band walls
 * normally. Frame: yield.
 *
 * Pure math, no DOM, no audio, no React, no Math.random — node-testable
 * (scripts/test-gate.mjs). The component (src/components/Gate.tsx) renders
 * what these laws decide and nothing else.
 */

// ——— constants ———————————————————————————————————————————————————————————

/**
 * Vertical coordinate system. z = 0 at the gate constriction; positive z
 * climbs into the extracellular vestibule, negative z descends toward the
 * selectivity filter and the cytoplasm. Units are the room's own frame; the
 * component's renderer maps them into pixels.
 */
export const GATE_Z = 0;

/** Center of the extracellular vestibule — where the substance snaps when bound. */
export const VESTIBULE_Z = 0.35;

/** Center of the selectivity filter — the "deeper" position of the season cycle. */
export const SELECTIVITY_Z = -0.35;

/** How close to VESTIBULE_Z the substance must reach to snap into binding. */
export const BINDING_TOLERANCE = 0.18;

/** Height above the membrane where an unbound substance drifts back to rest. */
export const REST_ABOVE_Z = 0.85;

/** Population cap for descending ions — one instanced draw, no growth. */
export const ION_CAP = 96;

/** Persistence key for the ceremony's kept sigil. */
export const GATE_STORAGE_KEY = "objetdart:gate:v1";

/** How fast the gate approaches its target openness (per-second time constant). */
export const GATE_RATE_PER_S = 3.6;

/** Baseline gate openness at rest — a hair open, so the breath is legible. */
export const GATE_BASELINE_LO = 0.15;
export const GATE_BASELINE_HI = 0.35;

// ——— determinism —————————————————————————————————————————————————————————

/**
 * Fold any number of parts into one 32-bit seed. The room's only dice.
 * Same idiom as /observe and every other room — one seed law, site-wide.
 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let x = Math.floor(p * 8192) | 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ x, 0x01000193);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ——— the channel state ———————————————————————————————————————————————————

/**
 * The GluN2 subunit currently paired with the two GluN1 subunits. The room
 * shows only these two — the twist verb toggles between them, and the shader
 * reads the choice as a hue drift on the two coloured helices.
 */
export type SubunitId = "2A" | "2B";

/**
 * The three named gate configurations, for readability at call sites. The
 * numeric openness in ChannelState is the authority; this is a shape convenience.
 */
export type GateState = "closed" | "open" | "partial";

/**
 * The whole material as a small deterministic state vector. Every visible
 * frame is a function of (state, breath, time) — no wall-clock reads inside
 * the physics.
 */
export type ChannelState = {
  subunit: SubunitId;
  /** 0 = fully pinched, 1 = fully dilated. Continuous, not switched. */
  gateOpenness: number;
  substanceBound: boolean;
  /** Height above the gate: negative below, positive above. Metres of the room's frame. */
  substanceZ: number;
  /** Rotation of the ball-and-stick model, xyz euler radians. */
  substanceRotation: [number, number, number];
  /** 0..1 ion current through the pore; state-derived, not a UI knob. */
  ionFlow: number;
};

export function initialChannelState(subunit: SubunitId = "2A"): ChannelState {
  return {
    subunit,
    gateOpenness: 0,
    substanceBound: false,
    substanceZ: REST_ABOVE_Z,
    substanceRotation: [0, 0, 0],
    ionFlow: 0,
  };
}

/**
 * Snap the substance into the vestibule and mark it bound. The renderer
 * animates the last step of the descent from wherever the finger left it;
 * the physics jumps to the canonical vestibule z so the two visual and
 * mechanical states cannot drift.
 */
export function bindSubstance(state: ChannelState, _z: number): ChannelState {
  return {
    ...state,
    substanceBound: true,
    substanceZ: VESTIBULE_Z,
    // A bound substance closes the gate — see stepChannel. Reset ionFlow
    // now so a caller reading straight after bind sees the truth.
    ionFlow: 0,
  };
}

/**
 * Release the substance. The next step of the loop kicks it upward toward
 * REST_ABOVE_Z with a small positive-z velocity so the drift is legible.
 */
export function unbindSubstance(state: ChannelState): ChannelState {
  return {
    ...state,
    substanceBound: false,
    // Nudge just above the vestibule so the next step's upward drift reads
    // as motion the visitor started, not as a jump.
    substanceZ: state.substanceZ + 0.02,
  };
}

/**
 * Flip 2A ↔ 2B. Keeps the current binding — the subunit swap is a
 * pharmacological identity switch, not a receptor rebuild; the substance in
 * the vestibule stays where it is. Test asserts involution.
 */
export function toggleSubunit(state: ChannelState): ChannelState {
  return { ...state, subunit: state.subunit === "2A" ? "2B" : "2A" };
}

/**
 * Advance the channel by dt seconds. Every dynamic axis is continuous and
 * driven by the caller's live inputs — the breath (0..1), the span-hold flag,
 * and the resolved binding state.
 *
 *   - Bound → gate targets 0 (the block closes the door). ionFlow is 0.
 *   - Unbound + span held → gate targets 1. ionFlow rides gateOpenness.
 *   - Neither → gate breathes between GATE_BASELINE_LO and GATE_BASELINE_HI
 *     with the album's 7s clock, so the room is alive at rest.
 *
 * Unbound substance drifts up (positive z velocity) toward REST_ABOVE_Z with
 * a small exponential approach. A bound substance jitters gently around the
 * vestibule as a function of the room's clock (deterministic — no random).
 */
export function stepChannel(
  state: ChannelState,
  dt: number,
  breath: number,
  spanHoldingOpen: boolean,
): ChannelState {
  const d = Math.max(0, Math.min(0.1, dt));
  const b = clamp01(breath);

  // ——— gate target ———
  let target: number;
  if (state.substanceBound) {
    // Bound: the block always closes the gate. The block IS the door.
    target = 0;
  } else if (spanHoldingOpen) {
    // Unbound, held open: full dilation.
    target = 1;
  } else {
    // Alive at rest: breathe between the baseline low and high on the 7s clock.
    target = GATE_BASELINE_LO + (GATE_BASELINE_HI - GATE_BASELINE_LO) * b;
  }
  // Exponential approach — a hand that watches sees the door move continuously,
  // never a snap.
  const alpha = 1 - Math.exp(-GATE_RATE_PER_S * d);
  const gateOpenness = state.gateOpenness + (target - state.gateOpenness) * alpha;

  // ——— substance z ———
  let substanceZ = state.substanceZ;
  if (state.substanceBound) {
    // Small deterministic jitter around the vestibule — a bound ligand is
    // never perfectly still. Seeded on time so replay stays deterministic.
    const jitter = 0.008 * Math.sin(b * Math.PI * 4);
    substanceZ = VESTIBULE_Z + jitter;
  } else {
    // Drift up to REST_ABOVE_Z with an exponential approach — same shape as
    // the gate, so the eye reads one law, not two.
    substanceZ = state.substanceZ + (REST_ABOVE_Z - state.substanceZ) * (1 - Math.exp(-1.8 * d));
  }

  // ——— ionFlow ———
  // Ions cannot pass through a bound blocker, and cannot pass through a
  // closed gate. The product is the whole rule; every downstream visual —
  // ion population alpha, sound register, wall darkening — reads from it.
  const ionFlow = state.substanceBound ? 0 : gateOpenness;

  return {
    ...state,
    gateOpenness,
    substanceZ,
    ionFlow,
  };
}

// ——— the ion column ———————————————————————————————————————————————————
//
// Faint moving specks above the gate suggest the ion column (Ca²⁺ / Na⁺ /
// K⁺). Deterministic in (z, tSec, seed) so replay is exact and no
// Math.random reaches the frame. The x/y are small jitter offsets around a
// column center; the alpha grows near the gate when ionFlow is high, so a
// dilated gate visibly funnels the specks through.

/**
 * Sample one point of the ion column at height `z`, time `tSec`, seed `seed`.
 * Returns a jitter offset (dx, dy in the room's frame, tiny) and an alpha
 * that peaks near GATE_Z. Purely deterministic; bounded 0..1 for alpha and
 * |0.03| for the jitter.
 */
export function ionColumnSample(
  z: number,
  tSec: number,
  seed: number,
): { x: number; y: number; alpha: number } {
  // A pair of rotating trig terms seeded by (z, tSec, seed) — cheap, bounded,
  // and reproducible. No mulberry needed because the sample doesn't accumulate;
  // any given (z, tSec, seed) triplet returns the same point every time.
  const s = (seed >>> 0) / 0xffffffff;
  const phase = z * 4.7 + tSec * 1.9 + s * 6.2831853;
  const phase2 = z * 3.1 - tSec * 1.3 + s * 4.7123890;
  const x = 0.025 * Math.sin(phase) * Math.cos(phase2 * 0.7);
  const y = 0.025 * Math.cos(phase2) * Math.sin(phase * 0.8);
  // Alpha peaks at the gate — a hand watching the flow sees the column
  // brighten as it descends through the constriction.
  const distGate = Math.abs(z - GATE_Z);
  const alpha = clamp01(Math.exp(-distGate * distGate * 6.0));
  return { x, y, alpha };
}

// ——— season: the vestibule → filter → out cycle ————————————————————————
//
// Twist3 walks the substance through the pore — vestibule (canonical bound
// site, above the gate) → deeper (through the constriction to the selectivity
// filter) → out (unbound, above the membrane). Continuous, not stepped: the
// return value is a target z the caller eases toward, and the binding flag is
// derived from where in the cycle the position sits.

export type SeasonPhase = "vestibule" | "deeper" | "out";

/**
 * Given a season position 0..1 (0 = vestibule, 0.5 = selectivity filter,
 * 1 = out above the membrane), return the z the substance should occupy and
 * whether it is bound at that position.
 */
export function seasonTarget(u: number): { z: number; bound: boolean; phase: SeasonPhase } {
  const t = clamp01(u);
  if (t <= 0.5) {
    // vestibule → filter, all bound
    const k = t / 0.5;
    return { z: VESTIBULE_Z + (SELECTIVITY_Z - VESTIBULE_Z) * k, bound: true, phase: k > 0.5 ? "deeper" : "vestibule" };
  }
  // filter → out — passes back through the vestibule and up
  const k = (t - 0.5) / 0.5;
  return { z: SELECTIVITY_Z + (REST_ABOVE_Z - SELECTIVITY_Z) * k, bound: k < 0.4, phase: "out" };
}

// ——— serialization ——————————————————————————————————————————————————
//
// A ceremony seals the current channel state as a kept sigil. The bound flag,
// the subunit, and the gate openness at commit time are what the room
// remembers; the substance z is derived from bound (vestibule) or not
// (rest). Small enough that a JSON blob fits comfortably.

export type KeptChannel = {
  v: 1;
  subunit: SubunitId;
  gateOpenness: number;
  substanceBound: boolean;
};

export function serializeChannel(state: ChannelState): KeptChannel {
  return {
    v: 1,
    subunit: state.subunit,
    gateOpenness: clamp01(state.gateOpenness),
    substanceBound: !!state.substanceBound,
  };
}

export function loadChannel(raw: unknown): ChannelState {
  const base = initialChannelState("2A");
  if (!raw || typeof raw !== "object") return base;
  const k = raw as Partial<KeptChannel>;
  if (k.v !== 1) return base;
  const subunit: SubunitId = k.subunit === "2B" ? "2B" : "2A";
  const gateOpenness = typeof k.gateOpenness === "number" ? clamp01(k.gateOpenness) : 0;
  const substanceBound = !!k.substanceBound;
  return {
    ...base,
    subunit,
    gateOpenness,
    substanceBound,
    substanceZ: substanceBound ? VESTIBULE_Z : REST_ABOVE_Z,
    ionFlow: substanceBound ? 0 : gateOpenness,
  };
}

// ——— the subunit helix shape ————————————————————————————————————————
//
// The four helices are drawn as vertical ribbons that taper toward the gate
// constriction. The taper is a function of z alone (independent of subunit
// or state), so the same helix shape reads across every frame — only the
// hue and the position depend on subunit / open / bound. Exported so the
// component's overlay draws through the same math the tests can pin.

/**
 * Half-width of one helix at height z, in the room's frame. 1.0 far from the
 * gate, ~0.28 at the constriction. The four helices sit at x = ±HALF_WIDTHS,
 * so this is the offset from the pore centerline of one helix's inner edge.
 */
export function helixHalfWidth(z: number, gateOpenness: number): number {
  // A gaussian pinch at the gate plane, softened as the gate opens.
  const pinch = Math.exp(-(z - GATE_Z) * (z - GATE_Z) * 8);
  const openHold = 1 - 0.6 * pinch * (1 - gateOpenness);
  return clamp(openHold, 0.28, 1.0);
}

/** The four helices' x-positions at the resting frame width — for renderer layout. */
export const HELIX_X_POSITIONS = [-0.28, -0.09, 0.09, 0.28] as const;

/** Colours by subunit. Grey for the two GluN1, tinted for GluN2A/B. */
export const SUBUNIT_TINT: Record<SubunitId, { r: number; g: number; b: number }> = {
  "2A": { r: 0.30, g: 0.72, b: 0.35 }, // green
  "2B": { r: 0.32, g: 0.55, b: 0.85 }, // blue
};
export const GLUN1_TINT = { r: 0.72, g: 0.74, b: 0.78 } as const;
