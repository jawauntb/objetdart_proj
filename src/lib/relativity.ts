/**
 * The relativity kernel — the pure math under /relativity.
 *
 * Four tiny functions, one law: c is a constant and nothing material
 * reaches it. The room's matter tops out at MATTER_CAP of c — a room
 * choice, so a hand can *watch* matter lose the race — and the flick is
 * read as rapidity: effort adds without bound, speed saturates, the
 * energy that didn't become speed becomes glow. The light clock is the
 * same law heard: a moving clock's photon rides a longer diagonal at the
 * same c, so its tick period stretches by the Lorentz factor. Doppler is
 * the law seen in color: the shift toward an approach and away from a
 * retreat, reciprocal by construction.
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
