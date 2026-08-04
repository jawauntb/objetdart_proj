/**
 * Center-field — a soft well toward mid-frame that never becomes an edge magnet.
 *
 * Populations that only soft-clamp at 0.06 / 0.94 learn to rest on the wall:
 * the clamp is a well. This helper is the opposite law — a gentle pull toward
 * the culture's resting point (0.5, 0.5 by default) plus a cushion that grows
 * only as a particle approaches the rim, pushing inward without rewarding
 * contact with the edge.
 *
 * Pure: no DOM. Pin with `scripts/test-center-field.mjs`.
 */

export type CenterFieldOpts = {
  /** Resting point in normalized [0,1] space. Default mid-frame. */
  cx?: number;
  cy?: number;
  /** Strength of the soft well toward the rest point. */
  well?: number;
  /** How hard the rim cushions (grows with proximity to the edge). */
  cushion?: number;
  /** Margin (normalized) inside which the cushion starts. */
  margin?: number;
};

export type CenterFieldForce = { ax: number; ay: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Acceleration in normalized space for a particle at (nx, ny).
 * Integrate with `nx += ax * dt` (and same for y); callers choose dt.
 */
export function centerFieldForce(
  nx: number,
  ny: number,
  opts: CenterFieldOpts = {},
): CenterFieldForce {
  const cx = opts.cx ?? 0.5;
  const cy = opts.cy ?? 0.5;
  const well = opts.well ?? 0.35;
  const cushion = opts.cushion ?? 2.4;
  const margin = opts.margin ?? 0.14;

  let ax = (cx - nx) * well;
  let ay = (cy - ny) * well;

  // Rim cushion: push inward proportional to how far past the inner margin.
  // Zero at and inside the safe band — no edge attractor.
  if (nx < margin) ax += (margin - nx) * cushion;
  else if (nx > 1 - margin) ax -= (nx - (1 - margin)) * cushion;
  if (ny < margin) ay += (margin - ny) * cushion;
  else if (ny > 1 - margin) ay -= (ny - (1 - margin)) * cushion;

  return { ax, ay };
}

/**
 * One Euler step. Clamps to [0,1] only as a hard safety (never a resting law).
 */
export function centerFieldStep(
  nx: number,
  ny: number,
  dt: number,
  opts?: CenterFieldOpts,
): { nx: number; ny: number } {
  const { ax, ay } = centerFieldForce(nx, ny, opts);
  return {
    nx: clamp01(nx + ax * dt),
    ny: clamp01(ny + ay * dt),
  };
}
