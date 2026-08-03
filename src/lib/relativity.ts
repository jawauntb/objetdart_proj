/**
 * The relativity kernel — the pure math under /relativity.
 *
 * A handful of tiny functions, one law: c is a constant and nothing
 * material reaches it. The room's matter tops out at MATTER_CAP of c — a
 * room choice, so a hand can *watch* matter lose the race — and the flick
 * is read as rapidity: effort adds without bound, speed saturates, the
 * energy that didn't become speed becomes glow. The light clock is the
 * same law heard: a moving clock's photon rides a longer diagonal at the
 * same c, so its tick period stretches by the Lorentz factor. Doppler is
 * the law seen in color: the shift toward an approach and away from a
 * retreat, reciprocal by construction. Simultaneity is the same law
 * split in two: one flash, two framings, and the room keeps a gap the
 * car never feels. Proper time is the law kept as a ledger: the bent
 * worldline is the shorter one, so the traveler comes home younger. And
 * contraction is the law measured with a ruler: a moving rod fits inside
 * the ghost of its resting self by exactly 1/γ.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-relativity.mjs).
 * The gravitational half of the room (bending, wells, gravitational time
 * dilation) lives in src/lib/manifold-field.ts and is reused, not rebuilt.
 */

/** Fraction of c that matter in this room may approach, never reach. */
export const MATTER_CAP = 0.6;

/**
 * Lorentz factor for a clock moving at speed v where light moves at c.
 * Exactly 1 at rest, monotone in |v|, diverging toward v → c. Speeds at
 * or beyond c are clamped just inside the horizon so a wild input bends
 * the render instead of minting NaNs.
 */
export function lorentzGamma(v: number, c: number): number {
  const beta = Math.min(Math.abs(v) / c, 0.999999);
  return 1 / Math.sqrt(1 - beta * beta);
}

/**
 * Tick period of a light clock with rest period `restPeriod`, carried at
 * speed v: the photon's path stretches into diagonals at the same c, so
 * the period dilates by exactly gamma. Equal to restPeriod at v = 0.
 */
export function tickPeriod(restPeriod: number, v: number, c: number): number {
  return restPeriod * lorentzGamma(v, c);
}

/**
 * Matter speed for a flick of speed `effort` (same units as c). The
 * effort is read as rapidity: v = cap·c·tanh(effort / cap·c). Gentle
 * flicks keep their own speed (slope 1 at zero), hard flicks saturate
 * toward — and never reach beyond — MATTER_CAP·c. No input wins the race
 * with light.
 */
export function matterSpeed(effort: number, c: number): number {
  if (!(effort > 0)) return 0;
  const cap = MATTER_CAP * c;
  return cap * Math.tanh(effort / cap);
}

/**
 * The heat of a throw: the energy that did not become speed. With effort
 * as rapidity the kinetic factor is cosh(effort / cap·c) − 1, which
 * diverges while matterSpeed saturates — energy without bound, speed
 * with one. Saturated into [0, 1) for the render.
 */
export function matterGlow(effort: number, c: number): number {
  if (!(effort > 0)) return 0;
  const cap = MATTER_CAP * c;
  const raw = Math.cosh(Math.min(effort / cap, 12)) - 1;
  return raw / (3 + raw);
}

/**
 * Relativistic longitudinal Doppler factor for a source whose line-of-
 * sight velocity toward the observer is vTow (positive = approaching).
 * 1 at rest, > 1 approaching (blue), < 1 receding (red), and exactly
 * reciprocal under vTow → −vTow: the retreat undoes the approach.
 */
export function dopplerShift(vTow: number, c: number): number {
  const beta = Math.max(-0.99, Math.min(0.99, vTow / c));
  return Math.sqrt((1 + beta) / (1 - beta));
}

/** Betas clamped just inside the horizon: wild inputs bend, never NaN. */
function safeBeta(beta: number): number {
  return Math.min(Math.abs(beta), 0.999999);
}

/**
 * Length of a rod of rest length `rest`, measured by the frame it moves
 * through at beta = v/c, along its motion: rest/γ = rest·√(1−β²).
 * Exactly `rest` at rest, exactly 0.8·rest at 0.6c and 0.6·rest at 0.8c,
 * strictly shrinking with speed, never zero this side of c.
 */
export function contractedLength(rest: number, beta: number): number {
  const b = safeBeta(beta);
  return rest * Math.sqrt(1 - b * b);
}

/**
 * A flash lit at the center of a car of rest length `carLength` —
 * measured in light-milliseconds, the time light needs to cross it at
 * rest — reaches both ends in one moment of the car's own frame. The
 * room disagrees: the rear runs into its flash, the front runs from it,
 * and the two strikes land γ·β·L milliseconds apart. Zero at rest,
 * strictly widening with speed, and to first order in beta exactly β·L —
 * the gap IS the relativity of simultaneity, in units a hand can hear.
 */
export function simultaneityGapMs(beta: number, carLength: number): number {
  const b = safeBeta(beta);
  return lorentzGamma(b, 1) * b * Math.max(0, carLength);
}

/**
 * Proper time's exchange rate at speed beta: dτ/dt = √(1−β²) = 1/γ.
 * Exactly 1 at rest, falling toward 0 near c — motion spends the room's
 * time faster than it earns its own aging.
 */
export function properTimeRatio(beta: number): number {
  const b = safeBeta(beta);
  return Math.sqrt(1 - b * b);
}

/**
 * Proper time carried home along a sampled path: Σ dtᵢ·√(1−βᵢ²). Equal
 * to Σ dtᵢ only when the whole path rests; exactly T/γ at constant
 * speed; never negative; and always ≤ the coordinate time — the bent
 * worldline is the shorter one, which is the whole twin paradox.
 */
export function properTimeOf(betas: number[], dts: number[]): number {
  const n = Math.min(betas.length, dts.length);
  let tau = 0;
  for (let i = 0; i < n; i++) tau += Math.max(0, dts[i]) * properTimeRatio(betas[i]);
  return tau;
}
