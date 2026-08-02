/**
 * The manifold field — the pure math under /manifold (plan W6).
 *
 * A softened point-mass metric on a 2D fabric: masses deepen wells, light
 * rays integrate through the curved field at a fixed speed, and clocks tick
 * slower the deeper they sit. Approximate on purpose — a Plummer-softened
 * inverse square stands in for the Schwarzschild metric because the room
 * wants the *shape* of relativity (bending, orbits, dilation, one speed
 * limit) legible to a hand, not numerics a hand can't feel.
 *
 * The one law pinned here and tested: nothing outruns light. geodesicStep
 * renormalizes every ray to exactly c after every step, and the room's
 * pulse wavefronts ride the same constant, so a tapped ripple races the
 * light and never beats it.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-manifold-field.mjs).
 */

export type MassPoint = {
  x: number;
  y: number;
  /** Mass in room units; the room keeps these O(1). */
  m: number;
};

export type Ray = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

/** Default Plummer softening radius, px — keeps every field finite at r=0. */
export const SOFTENING = 26;

/**
 * Softened inverse-square acceleration toward the masses at (x, y).
 * a_i = g · m_i · d_vec / (|d|² + soft²)^(3/2) — finite everywhere,
 * vanishing exactly at a mass's center, classical 1/r² far away.
 */
export function accelAt(
  masses: readonly MassPoint[],
  x: number,
  y: number,
  g: number,
  soft: number = SOFTENING,
): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  const s2 = soft * soft;
  for (const p of masses) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy + s2;
    const inv = (g * p.m) / (d2 * Math.sqrt(d2));
    ax += dx * inv;
    ay += dy * inv;
  }
  return { ax, ay };
}

/**
 * Bounded well depth at (x, y): 0 on flat fabric, approaching (never
 * reaching) 1 under any stacking of masses. raw = Σ m·soft²/(d²+soft²) is
 * saturated through raw/(1+raw), so extreme mass piles deform the render
 * but can never blow it up.
 */
export function wellDepth(
  masses: readonly MassPoint[],
  x: number,
  y: number,
  soft: number = SOFTENING,
): number {
  let raw = 0;
  const s2 = soft * soft;
  for (const p of masses) {
    const dx = p.x - x;
    const dy = p.y - y;
    raw += (p.m * s2) / (dx * dx + dy * dy + s2);
  }
  return raw / (1 + raw);
}

/**
 * Proper-time factor at (x, y): 1 far from every mass, falling toward 0
 * (never reaching it) deep in a well. A clock's blink rate is multiplied
 * by this — the room's twin-beacon comparison is this function, watched.
 * `k` scales how hard gravity leans on the clock.
 */
export function timeDilation(
  masses: readonly MassPoint[],
  x: number,
  y: number,
  k: number,
  soft: number = SOFTENING,
): number {
  let raw = 0;
  const s2 = soft * soft;
  for (const p of masses) {
    const dx = p.x - x;
    const dy = p.y - y;
    raw += (p.m * s2) / (dx * dx + dy * dy + s2);
  }
  return 1 / (1 + k * raw);
}

/**
 * Advance a light ray one step of dtSec through the field.
 *
 * Bend first (acceleration at the current position), then renormalize the
 * velocity to exactly c, then move. The renormalization IS the speed
 * limit: gravity may turn light, it may never hurry or slow it. With no
 * masses the ray runs perfectly straight; close passes whip around heavy
 * wells and can wind into brief orbits — beauty over accuracy, but the
 * sign, the monotone falloff with impact parameter, and the constant
 * speed are exact and tested.
 *
 * A ray at exact rest (vx = vy = 0) is left at rest — light without a
 * direction is no light at all, and dividing by zero would mint NaNs.
 */
export function geodesicStep(
  masses: readonly MassPoint[],
  ray: Ray,
  dtSec: number,
  c: number,
  g: number,
  soft: number = SOFTENING,
): Ray {
  const { ax, ay } = accelAt(masses, ray.x, ray.y, g, soft);
  let vx = ray.vx + ax * dtSec;
  let vy = ray.vy + ay * dtSec;
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (sp > 0) {
    const r = c / sp;
    vx *= r;
    vy *= r;
  } else {
    vx = ray.vx;
    vy = ray.vy;
  }
  return { x: ray.x + vx * dtSec, y: ray.y + vy * dtSec, vx, vy };
}
