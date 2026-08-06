/**
 * orbits — the system assembled.
 *
 * The invariant is a set of orbital elements per body: semi-major axis `a`,
 * eccentricity `e`, inclination `incl`, argument of periapsis `omega`, and
 * `phase` (the mean anomaly at sim-time zero). Everything the /solar room
 * shows or sounds is a representation of those five numbers under one law,
 * Kepler's — and the load-bearing map is orbital period → pitch, INVERTIBLE:
 * each body's tone frequency is proportional to its orbital frequency, so
 * the intervals of the chord ARE the period ratios (T² ∝ a³ made audible),
 * and `semiMajorForFreq` reads the element back out of the sound.
 *
 * Elapsed time is closed form. The mean anomaly is linear in time, the
 * eccentric anomaly one bounded Kepler solve away — so a week of absence
 * lands every planet exactly where a week puts it, in O(1), never by
 * replaying history. That is the room's whole thesis, and the tests in
 * scripts/test-orbits.mjs exist to keep it true.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-orbits.mjs).
 * See INSPIRATION.md §2 and §4.
 */

export const TAU = Math.PI * 2;

/** Real seconds for one orbit at a = 1 under the unit sun. */
export const BASE_PERIOD_S = 540;
/** Gravitational parameter of the unit sun, in a³/s² units. */
export const MU_UNIT = (TAU / BASE_PERIOD_S) * (TAU / BASE_PERIOD_S);
/** The law layer may weigh the sun between these factors of MU_UNIT. */
export const MU_FACTOR_MIN = 0.5;
export const MU_FACTOR_MAX = 2;

/**
 * Semi-major axis range the room holds, in sun units. The ceiling is set by
 * honesty, not taste: the audio bus speaks 40–8000 Hz, and every reachable
 * orbit (including the lightest sun) must voice its TRUE mapped frequency,
 * unclamped — otherwise the sound could no longer be read back.
 */
export const A_MIN = 0.36;
export const A_MAX = 3.4;

/** Planets in a seeded system, and the comet population cap. */
export const PLANET_COUNT = 6;
export const MAX_COMETS = 6;

/**
 * Period → frequency: f = AUDIO_SCALE / T. One constant, so every interval
 * you hear is exactly a period ratio, and dividing it back out recovers T.
 * 3·2^16 puts the a = 1 orbit near 364 Hz; the innermost planet rings past
 * a thousand and the outermost sinks toward 40 — scale as register.
 */
export const AUDIO_SCALE = 196608;

/** Kepler's equation is solved to at least this residual, every time. */
export const KEPLER_TOL = 1e-11;

/**
 * Masses, as fractions of the sun. Small enough that the Kepler drift is
 * the truth and the mutual pull is a perturbation on top of it (which is
 * exactly what makes the mixed-variable map below legitimate) — but large
 * enough that a heavy world visibly herds its neighbours inside a minute.
 */
export const MASS_MIN = 0.0004;
export const MASS_MAX = 0.03;
/** Press duration → mass, ceremony-length holds condensing the heaviest. */
export function massForHold(holdMs: number): number {
  const u = clamp(Math.max(0, holdMs) / 3000, 0, 1);
  return MASS_MIN * Math.pow(MASS_MAX / MASS_MIN, u);
}
/** Physical radius from mass, in sun units — constant density, so m ∝ R³. */
export function radiusOf(mass: number): number {
  return 0.035 * Math.cbrt(clamp(mass, MASS_MIN, MASS_MAX) / MASS_MIN);
}

/** The eccentricity past which an orbit is a plunge, not an orbit. */
export const E_MAX = 0.94;
/** Softening length for the mutual pull, sun units — no infinite kicks. */
export const SOFTENING = 0.05;
/** The sun's own reach: anything inside this radius is swallowed. */
export const SUN_RADIUS = 0.09;

export type BodyKind = "planet" | "comet";

export type OrbitalElements = {
  /** Semi-major axis, sun units. */
  a: number;
  /** Eccentricity, 0 ≤ e < 1 (bound orbits only). */
  e: number;
  /** Inclination of the orbital plane, radians — rendered as foreshortening. */
  incl: number;
  /** Argument of periapsis, radians. */
  omega: number;
  /** Mean anomaly at sim-time zero, radians. */
  phase: number;
  /** Deterministic identity — visuals derive from this, never from chance. */
  seed: number;
  kind: BodyKind;
  /** Display size factor, 0..1. */
  size: number;
  /** Mass as a fraction of the sun — what the others feel of it. */
  mass: number;
};

export type OrbitalPosition = {
  /** View-plane coordinates, sun units ( y foreshortened by incl ). */
  x: number;
  y: number;
  /** Out-of-plane height, sun units. */
  z: number;
  /** Distance from the sun, sun units. */
  r: number;
  /** In-plane angle ν + ω, wrapped to [0, TAU). */
  angle: number;
  M: number;
  E: number;
  nu: number;
};

export function wrapAngle(x: number): number {
  return ((x % TAU) + TAU) % TAU;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ——— determinism (the site idiom) ————————————————————————————————

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

// ——— Kepler's clockwork ————————————————————————————————————————

/** T = 2π √(a³/μ) — the third law, by construction. */
export function periodOf(a: number, mu: number): number {
  return TAU * Math.sqrt((a * a * a) / mu);
}

/** n = √(μ/a³), radians of mean anomaly per second. */
export function meanMotionOf(a: number, mu: number): number {
  return Math.sqrt(mu / (a * a * a));
}

/**
 * Mean anomaly at sim-time t — the closed form that makes absence O(1).
 * Linear in t; wrap only at the read so partitioned advances agree.
 */
export function meanAnomalyAt(el: OrbitalElements, mu: number, t: number): number {
  return wrapAngle(el.phase + meanMotionOf(el.a, mu) * t);
}

/**
 * Solve Kepler's equation E − e·sin E = M for E, to KEPLER_TOL.
 * Safeguarded Newton: the bisection bracket [0, TAU) catches the
 * near-parabolic cases where the derivative 1 − e·cos E gets small.
 */
export function solveKepler(M: number, e: number): number {
  const m = wrapAngle(M);
  if (e <= 0) return m;
  let lo = 0;
  let hi = TAU;
  // E and M always sit on the same side of π, which tightens the bracket.
  if (m < Math.PI) hi = Math.PI + 1e-9;
  else lo = Math.PI - 1e-9;
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 64; i++) {
    const f = E - e * Math.sin(E) - m;
    if (Math.abs(f) <= KEPLER_TOL) return E;
    if (f > 0) hi = E;
    else lo = E;
    const d = 1 - e * Math.cos(E);
    let next = E - f / d;
    // Newton stepping outside the bracket means the derivative lied; bisect.
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    E = next;
  }
  return E;
}

/** True anomaly from eccentric anomaly. */
export function trueAnomalyOf(E: number, e: number): number {
  return wrapAngle(
    2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)),
  );
}

/** ...and back — the anomaly ladder climbs both ways. */
export function eccentricAnomalyOf(nu: number, e: number): number {
  return wrapAngle(
    2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2)),
  );
}

/**
 * Where a body stands at sim-time t. Closed form: linear mean anomaly, one
 * bounded Kepler solve, trig. The same t always lands the same place,
 * however many visits or frames it took to get there.
 */
export function positionAt(el: OrbitalElements, mu: number, t: number): OrbitalPosition {
  const M = meanAnomalyAt(el, mu, t);
  const E = solveKepler(M, el.e);
  const nu = trueAnomalyOf(E, el.e);
  const r = el.a * (1 - el.e * Math.cos(E));
  const angle = wrapAngle(nu + el.omega);
  const xp = r * Math.cos(angle);
  const yp = r * Math.sin(angle);
  return { x: xp, y: yp * Math.cos(el.incl), z: yp * Math.sin(el.incl), r, angle, M, E, nu };
}

/**
 * In-plane velocity at sim-time t (before the inclination projection —
 * conservation laws live in the plane). rhat/that decomposition of the
 * standard h-parameterized velocity.
 */
export function velocityAt(
  el: OrbitalElements,
  mu: number,
  t: number,
): { vx: number; vy: number } {
  const p = positionAt(el, mu, t);
  const h = Math.sqrt(mu * el.a * (1 - el.e * el.e));
  const vr = (mu / h) * el.e * Math.sin(p.nu);
  const vt = (mu / h) * (1 + el.e * Math.cos(p.nu));
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return { vx: vr * c - vt * s, vy: vr * s + vt * c };
}

/** v²/2 − μ/r. Kepler keeps this at −μ/2a forever; the tests make sure. */
export function specificEnergyAt(el: OrbitalElements, mu: number, t: number): number {
  const p = positionAt(el, mu, t);
  const v = velocityAt(el, mu, t);
  return (v.vx * v.vx + v.vy * v.vy) / 2 - mu / p.r;
}

/** |r × v| in the plane — the conserved areal clock of the second law. */
export function angularMomentumAt(el: OrbitalElements, mu: number, t: number): number {
  const p = positionAt(el, mu, t);
  const v = velocityAt(el, mu, t);
  const px = p.r * Math.cos(p.angle);
  const py = p.r * Math.sin(p.angle);
  return Math.abs(px * v.vy - py * v.vx);
}

// ——— state vectors, and the elements read back out of them ——————————
//
// Everything the hand does to a body — planting it, kicking it, merging it
// with another — happens in the state vector (where forces live) and is
// then re-read as osculating elements (where the closed form lives). That
// round trip is the hinge of the room: it is what lets mutual gravity be
// real without ever costing the absence a single integration step.

export type StateVector = { x: number; y: number; vx: number; vy: number };

/** In-plane position and velocity at sim-time t. */
export function stateVectorAt(el: OrbitalElements, mu: number, t: number): StateVector {
  const p = positionAt(el, mu, t);
  const v = velocityAt(el, mu, t);
  return { x: p.r * Math.cos(p.angle), y: p.r * Math.sin(p.angle), vx: v.vx, vy: v.vy };
}

/** The speed that holds a circle at r: √(μ/r). */
export function circularSpeed(r: number, mu: number): number {
  return Math.sqrt(mu / Math.max(1e-6, r));
}

/** ...and the speed that leaves for good: √(2μ/r). */
export function escapeSpeed(r: number, mu: number): number {
  return Math.SQRT2 * circularSpeed(r, mu);
}

export type StateOutcome =
  | { kind: "bound"; el: OrbitalElements }
  /** v ≥ escape speed: the system lets it go. */
  | { kind: "escaped" }
  /** Angular momentum spent: it falls in and the sun takes it. */
  | { kind: "consumed" };

/**
 * Osculating elements from a state vector — the inverse of `stateVectorAt`,
 * and the only place a force is allowed to become an orbit.
 *
 * Bound results are re-anchored so `positionAt(el, mu, t)` returns exactly
 * the (x, y) handed in: the semi-major axis is clamped into the room's
 * walls and the eccentricity re-solved from a(1−e²) = r(1 + e·cos ν) so
 * the ellipse still passes through the point. Prograde only — a state that
 * has lost (or reversed) its angular momentum is a plunge, and the sun
 * takes it.
 */
export function elementsFromState(
  base: Omit<OrbitalElements, "a" | "e" | "omega" | "phase">,
  s: StateVector,
  mu: number,
  t: number,
): StateOutcome {
  const r = Math.hypot(s.x, s.y);
  if (!(r > 1e-6)) return { kind: "consumed" };
  const v2 = s.vx * s.vx + s.vy * s.vy;
  if (v2 / 2 - mu / r >= 0) return { kind: "escaped" };
  const h = s.x * s.vy - s.y * s.vx;
  // Retrograde or angular-momentum-free: it is falling, not orbiting.
  if (h <= 1e-7) return { kind: "consumed" };

  const rv = s.x * s.vx + s.y * s.vy;
  const c = v2 / mu - 1 / r;
  const ex = c * s.x - (rv / mu) * s.vx;
  const ey = c * s.y - (rv / mu) * s.vy;
  const eRaw = Math.hypot(ex, ey);
  const aRaw = 1 / (2 / r - v2 / mu);
  if (eRaw > E_MAX && aRaw * (1 - eRaw) < SUN_RADIUS) return { kind: "consumed" };

  // The walls. A bound orbit through r needs apoapsis ≥ r, hence a ≥ r/(1+E_MAX).
  const a = clamp(aRaw, Math.max(A_MIN, r / (1 + E_MAX)), A_MAX);
  const omega = eRaw > 1e-9 ? wrapAngle(Math.atan2(ey, ex)) : wrapAngle(Math.atan2(s.y, s.x));
  const nu = wrapAngle(Math.atan2(s.y, s.x) - omega);
  // a·e² + r·cos ν·e + (r − a) = 0 — the conic through (r, ν) with this a.
  // Both roots are conics through the point; the physical one is the branch
  // continuous with the state's own eccentricity (they coincide exactly
  // whenever the walls did not have to clamp `a`).
  const cn = Math.cos(nu);
  const disc = Math.max(0, r * r * cn * cn - 4 * a * (r - a));
  const root = Math.sqrt(disc);
  const want = clamp(eRaw, 0, E_MAX);
  const r1 = (-r * cn + root) / (2 * a);
  const r2 = (-r * cn - root) / (2 * a);
  const ok1 = r1 >= 0 && r1 <= E_MAX;
  const ok2 = r2 >= 0 && r2 <= E_MAX;
  const e = clamp(
    ok1 && ok2 ? (Math.abs(r1 - want) <= Math.abs(r2 - want) ? r1 : r2) : ok1 ? r1 : ok2 ? r2 : want,
    0,
    E_MAX,
  );
  if (a * (1 - e) < SUN_RADIUS && e > 0.6) return { kind: "consumed" };

  const E = eccentricAnomalyOf(nu, e);
  const M = wrapAngle(E - e * Math.sin(E));
  return {
    kind: "bound",
    el: { ...base, a, e, omega, phase: wrapAngle(M - meanMotionOf(a, mu) * t) },
  };
}

/**
 * Change a body's velocity at sim-time t and re-read its orbit. Position is
 * continuous by construction — the kick turns the future, never teleports
 * the present — which is what makes it safe to apply every few frames.
 */
export function kicked(
  el: OrbitalElements,
  mu: number,
  t: number,
  dvx: number,
  dvy: number,
): StateOutcome {
  const s = stateVectorAt(el, mu, t);
  return elementsFromState(el, { x: s.x, y: s.y, vx: s.vx + dvx, vy: s.vy + dvy }, mu, t);
}

// ——— the mutual pull ————————————————————————————————————————————
//
// The bodies are not decorations on separate rails: each one pulls the
// others. The propagation is the Wisdom–Holman move — DRIFT along the exact
// Kepler ellipse (closed form, so an absence of any length costs one
// multiply), KICK by the mutual accelerations while someone is watching.
// The kick is a perturbation on a dominant central mass, which is exactly
// the regime where that split is the right physics and not a shortcut.

// Scratch position buffers for the O(n²) passes below (mutualAccelerations,
// firstCollision). The population is capped at PLANET_COUNT + MAX_COMETS,
// bodies.length never exceeds that, so this grows at most once and never
// allocates again — the buffers are purely internal work space, never
// returned or exposed, so callers can't observe or alias them.
let scratchN = 0;
let scratchPx = new Float64Array(0);
let scratchPy = new Float64Array(0);
function scratchPositions(n: number): { px: Float64Array; py: Float64Array } {
  if (n > scratchN) {
    scratchN = n;
    scratchPx = new Float64Array(n);
    scratchPy = new Float64Array(n);
  }
  return { px: scratchPx, py: scratchPy };
}

/**
 * Perturbing accelerations (the sun excluded — the drift already carries
 * it), written into `out` as [ax0, ay0, ax1, ay1, …]. O(n²) over a
 * population capped at PLANET_COUNT + MAX_COMETS; the loop cannot grow.
 */
export function mutualAccelerations(
  bodies: OrbitalElements[],
  mu: number,
  t: number,
  out?: Float64Array,
): Float64Array {
  const n = bodies.length;
  const acc = out && out.length >= n * 2 ? out : new Float64Array(n * 2);
  acc.fill(0, 0, n * 2);
  const { px, py } = scratchPositions(n);
  for (let i = 0; i < n; i++) {
    const p = positionAt(bodies[i], mu, t);
    px[i] = p.r * Math.cos(p.angle);
    py[i] = p.r * Math.sin(p.angle);
  }
  const eps2 = SOFTENING * SOFTENING;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = px[j] - px[i];
      const dy = py[j] - py[i];
      const d2 = dx * dx + dy * dy + eps2;
      const inv = 1 / (d2 * Math.sqrt(d2));
      // Newton's third law by construction: one pair, one force, two signs.
      const gi = mu * bodies[j].mass * inv;
      const gj = mu * bodies[i].mass * inv;
      acc[i * 2] += gi * dx;
      acc[i * 2 + 1] += gi * dy;
      acc[j * 2] -= gj * dx;
      acc[j * 2 + 1] -= gj * dy;
    }
  }
  return acc;
}

export type PerturbEvent = { index: number; fate: "escaped" | "consumed" };

// Scratch accelerations buffer for `perturbed`'s own (internal-only, never
// returned) call into mutualAccelerations — same bounded-population
// reasoning as scratchPositions above.
let scratchAcc = new Float64Array(0);
function scratchAccelerations(n: number): Float64Array {
  if (scratchAcc.length < n * 2) scratchAcc = new Float64Array(n * 2);
  return scratchAcc;
}

/**
 * One kick of the mixed-variable map: advance every body's elements by the
 * mutual pull over `dtSim` seconds. Bodies that leave (unbound) or fall in
 * (angular momentum spent) are reported and dropped — gravity is allowed
 * to remove things.
 */
export function perturbed(
  bodies: OrbitalElements[],
  mu: number,
  t: number,
  dtSim: number,
): { bodies: OrbitalElements[]; lost: PerturbEvent[] } {
  if (bodies.length < 2 || dtSim <= 0) return { bodies, lost: [] };
  const acc = mutualAccelerations(bodies, mu, t, scratchAccelerations(bodies.length));
  const out: OrbitalElements[] = [];
  const lost: PerturbEvent[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const dvx = acc[i * 2] * dtSim;
    const dvy = acc[i * 2 + 1] * dtSim;
    if (Math.abs(dvx) + Math.abs(dvy) < 1e-12) {
      out.push(bodies[i]);
      continue;
    }
    const r = kicked(bodies[i], mu, t, dvx, dvy);
    if (r.kind === "bound") out.push(r.el);
    else lost.push({ index: i, fate: r.kind });
  }
  return { bodies: out, lost };
}

/**
 * Two bodies become one: mass adds, momentum is conserved, and the merged
 * body starts from the barycentre of the collision. The survivor keeps the
 * heavier body's identity (seed, kind) — a world absorbing a wanderer is
 * still that world.
 */
export function mergedBody(
  a: OrbitalElements,
  b: OrbitalElements,
  mu: number,
  t: number,
): StateOutcome {
  const big = a.mass >= b.mass ? a : b;
  const small = a.mass >= b.mass ? b : a;
  const sa = stateVectorAt(big, mu, t);
  const sb = stateVectorAt(small, mu, t);
  const m = big.mass + small.mass;
  const w = small.mass / m;
  const state: StateVector = {
    x: sa.x + (sb.x - sa.x) * w,
    y: sa.y + (sb.y - sa.y) * w,
    vx: sa.vx + (sb.vx - sa.vx) * w,
    vy: sa.vy + (sb.vy - sa.vy) * w,
  };
  return elementsFromState(
    {
      incl: big.incl + (small.incl - big.incl) * w,
      seed: big.seed,
      kind: big.kind,
      size: clamp(Math.cbrt(big.size ** 3 + small.size ** 3), 0.1, 1),
      mass: clamp(m, MASS_MIN, MASS_MAX),
    },
    state,
    mu,
    t,
  );
}

/**
 * The first pair close enough to touch, or null. One pair per call: a
 * merger changes every distance, so the next frame asks again.
 */
export function firstCollision(
  bodies: OrbitalElements[],
  mu: number,
  t: number,
): [number, number] | null {
  const n = bodies.length;
  const { px, py } = scratchPositions(n);
  for (let i = 0; i < n; i++) {
    const p = positionAt(bodies[i], mu, t);
    px[i] = p.r * Math.cos(p.angle);
    py[i] = p.r * Math.sin(p.angle);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const touch = radiusOf(bodies[i].mass) + radiusOf(bodies[j].mass);
      const dx = px[j] - px[i];
      const dy = py[j] - py[i];
      if (dx * dx + dy * dy < touch * touch) return [i, j];
    }
  }
  return null;
}

// ——— resonance ————————————————————————————————————————————————
//
// Two periods in a small whole-number ratio are the system's own chord —
// the same integers whether you read them as orbits or as an interval,
// which is why the room can simply sound them.

export type Resonance = { i: number; j: number; p: number; q: number; detune: number };

/** The nearest p:q with p, q ≤ maxOrder, and how far off it is (relative). */
export function nearestRatio(
  ratio: number,
  maxOrder = 5,
): { p: number; q: number; detune: number } {
  let best = { p: 1, q: 1, detune: Math.abs(ratio - 1) };
  for (let p = 1; p <= maxOrder; p++) {
    for (let q = 1; q <= maxOrder; q++) {
      const d = Math.abs(ratio - p / q) / (p / q);
      if (d < best.detune) best = { p, q, detune: d };
    }
  }
  return best;
}

/** Pairs locked within `tol` of a small ratio. Bounded by the population. */
export function resonances(
  bodies: OrbitalElements[],
  mu: number,
  tol = 0.015,
): Resonance[] {
  const out: Resonance[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const ratio = periodOf(bodies[j].a, mu) / periodOf(bodies[i].a, mu);
      const near = nearestRatio(ratio);
      if (near.p === near.q) continue;
      if (near.detune <= tol) out.push({ i, j, p: near.p, q: near.q, detune: near.detune });
    }
  }
  return out;
}

// ——— the map: period → pitch, and back ————————————————————————————

/** f = AUDIO_SCALE / T. Strictly decreasing in T; intervals are ratios. */
export function freqForPeriod(T: number): number {
  return AUDIO_SCALE / T;
}

/** T = AUDIO_SCALE / f — the same division, run backward, exactly. */
export function periodForFreq(f: number): number {
  return AUDIO_SCALE / f;
}

/** A body's voice: its orbital frequency lifted whole into the audible. */
export function freqForElements(a: number, mu: number): number {
  return freqForPeriod(periodOf(a, mu));
}

/** Read the element back out of the sound: a = (μ (T/2π)²)^⅓. */
export function semiMajorForFreq(f: number, mu: number): number {
  const T = periodForFreq(f);
  const x = (T / TAU) * (T / TAU) * mu;
  return Math.cbrt(x);
}

// ——— the seeded system ————————————————————————————————————————

/**
 * A deterministic solar system. Semi-major axes climb geometrically from
 * near A_MIN toward A_MAX with seeded jitter (a Titius–Bode-ish ladder),
 * eccentricities stay planetary (< 0.35), inclinations shallow. The same
 * seed is the same sky, forever.
 */
export function systemFromSeed(seed: number): OrbitalElements[] {
  const rng = mulberry32(seed >>> 0);
  const bodies: OrbitalElements[] = [];
  const inner = 0.42;
  const outer = 3.1;
  const ratio = Math.pow(outer / inner, 1 / (PLANET_COUNT - 1));
  for (let i = 0; i < PLANET_COUNT; i++) {
    const jitter = 0.88 + rng() * 0.24;
    const a = clamp(inner * Math.pow(ratio, i) * jitter, A_MIN, A_MAX);
    bodies.push({
      a,
      e: 0.02 + rng() * 0.24 + (i === PLANET_COUNT - 1 ? rng() * 0.09 : 0),
      incl: (rng() - 0.5) * 0.26,
      omega: rng() * TAU,
      phase: rng() * TAU,
      seed: hashSeed(seed, i, 0x50a1),
      kind: "planet",
      size: 0.3 + rng() * 0.7,
      // The seeded worlds sit in the lower half of the mass range, so a
      // hand-condensed giant genuinely outweighs what it arrives among.
      mass: MASS_MIN * Math.pow(6, rng()),
    });
  }
  return bodies;
}

/**
 * A body condensed under a held finger. The press point is where it
 * appears; the hold's LENGTH is its mass (a touch makes a pebble, a
 * ceremony a giant that visibly herds its neighbours); the finger's DRIFT
 * while held is the kick it is released with, on top of the circular speed
 * at that radius. So a still finger drops a world onto a clean circle, a
 * finger sliding with the orbit stretches it outward into an ellipse, and
 * one sliding against it drops a comet's blade toward the sun. The velocity
 * is real, the elements are read back out of it, and nothing is decreed.
 */
export function plantBody(
  seed: number,
  r: number,
  theta: number,
  holdMs: number,
  drift: { vr: number; vt: number },
  mu: number,
  t: number,
): StateOutcome {
  const rng = mulberry32(seed >>> 0);
  const rr = clamp(r, A_MIN, A_MAX);
  const vc = circularSpeed(rr, mu);
  const vr = clamp(drift.vr, -1.4, 1.4) * vc;
  const vt = vc * (1 + clamp(drift.vt, -0.9, 0.38));
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const mass = massForHold(holdMs);
  return elementsFromState(
    {
      incl: (rng() - 0.5) * 0.5,
      seed: seed >>> 0,
      kind: "comet",
      size: clamp(0.12 + Math.cbrt(mass / MASS_MIN) * 0.14, 0.12, 1),
      mass,
    },
    { x: rr * ct, y: rr * st, vx: vr * ct - vt * st, vy: vr * st + vt * ct },
    mu,
    t,
  );
}

/**
 * Add a comet under the population law: planets are permanent, comets FIFO
 * past MAX_COMETS — the oldest wanderer is let go, never a world.
 */
export function withComet(
  bodies: OrbitalElements[],
  comet: OrbitalElements,
): OrbitalElements[] {
  const planets = bodies.filter((b) => b.kind === "planet");
  const comets = bodies.filter((b) => b.kind === "comet");
  comets.push(comet);
  while (comets.length > MAX_COMETS) comets.shift();
  return [...planets, ...comets];
}

// ——— the hand on the material ————————————————————————————————————

/**
 * Nudge a body from one grip point to another: the radial pull rescales the
 * orbit (r ∝ a at fixed true anomaly, so the whole ellipse breathes with
 * the finger), the angular pull re-times the phase so the body tracks the
 * hand at time t. The eccentricity — the orbit's character — survives.
 */
export function nudged(
  el: OrbitalElements,
  mu: number,
  t: number,
  fromR: number,
  toR: number,
  toTheta: number,
): OrbitalElements {
  const ratio = fromR > 1e-9 ? toR / fromR : 1;
  const a = clamp(el.a * ratio, A_MIN, A_MAX);
  const nu = wrapAngle(toTheta - el.omega);
  const E = eccentricAnomalyOf(nu, el.e);
  const M = wrapAngle(E - el.e * Math.sin(E));
  const phase = wrapAngle(M - meanMotionOf(a, mu) * t);
  return { ...el, a, phase };
}

/**
 * Re-time one body's phase so its position is continuous across a change of
 * the sun's mass. The knob turns the future, never teleports the present.
 */
export function phaseForContinuity(
  el: OrbitalElements,
  muOld: number,
  muNew: number,
  t: number,
): number {
  const M = meanAnomalyAt(el, muOld, t);
  return wrapAngle(M - meanMotionOf(el.a, muNew) * t);
}

/**
 * The grand conjunction — the room's one solemn act. Every body's phase is
 * re-timed so that at sim-time t it stands at targetTheta; from that instant
 * they shear apart at their own Kepler rates, the chord arpeggiating open.
 */
export function conjunctionPhases(
  bodies: OrbitalElements[],
  mu: number,
  t: number,
  targetTheta: number,
): number[] {
  return bodies.map((el) => {
    const nu = wrapAngle(targetTheta - el.omega);
    const E = eccentricAnomalyOf(nu, el.e);
    const M = wrapAngle(E - el.e * Math.sin(E));
    return wrapAngle(M - meanMotionOf(el.a, mu) * t);
  });
}

// ——— time, composed ————————————————————————————————————————————

/**
 * Sim-time after a real absence, at the persisted epoch rate: one multiply,
 * one add. However the absence is partitioned — one visit or a thousand
 * frames — the sum is the same span, which is the whole law.
 */
export function elapsedSim(storedSimS: number, elapsedRealMs: number, rate: number): number {
  return storedSimS + (Math.max(0, elapsedRealMs) / 1000) * rate;
}

/** The epoch rate knob, exp2-stepped and bounded — the law layer's vertical. */
export const RATE_EXP_MIN = -2;
export const RATE_EXP_MAX = 2;
export function rateForExp(rateExp: number): number {
  return Math.pow(2, clamp(rateExp, RATE_EXP_MIN, RATE_EXP_MAX));
}

/**
 * Did the wrapped mean anomaly cross periapsis between two reads? M climbs
 * monotonically, so a wrapped decrease is exactly one crossing of zero.
 */
export function crossedPeriapsis(mPrev: number, mNow: number): boolean {
  return mNow < mPrev;
}

// ——— the drawn orbit ————————————————————————————————————————————

/**
 * Display radius, 0..1 of the view: a^0.55, normalized. A power law keeps
 * the outer system on a phone screen while staying strictly monotone —
 * order and betweenness survive the compression, which is all the eye needs
 * to read `a` back.
 */
export const DISPLAY_GAMMA = 0.62;
export function displayRadiusFor(a: number): number {
  const c = clamp(a, A_MIN, A_MAX);
  return Math.pow(c, DISPLAY_GAMMA) / Math.pow(A_MAX, DISPLAY_GAMMA);
}

/** ...and back: the screen still knows which orbit it is drawing. */
export function worldRadiusForDisplay(u: number): number {
  const c = clamp(u, displayRadiusFor(A_MIN), 1);
  return Math.pow(c, 1 / DISPLAY_GAMMA) * A_MAX;
}
