/**
 * Growth phenology — the pure maturity → phenophase law for /growth's vines.
 *
 * A blossom node sits at a fixed fraction `nodeU` of its vine's full extent.
 * Once the vine's growth `progress` passes the node, the bud ripens along a
 * smoothstep toward RIPE_MAX — deliberately short of botany's BLOOM_PEAK
 * (0.72), so the vine alone carries every bud to the brink and the last step
 * into full bloom belongs to the hand (the dwell hold), exactly as on
 * /flowers. `held` is the hand's contribution; the sum is clamped to [0,1].
 *
 * Import-free by law: numbers in, numbers out — node-testable standalone
 * (scripts/test-growth-phenology.mjs).
 */

/** Highest phenophase vine maturity alone can reach (< botany BLOOM_PEAK). */
export const RIPE_MAX = 0.62;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Phenophase of the blossom at `nodeU` on a vine grown to `progress`, with
 * the hand's held contribution added. Monotone nondecreasing in both
 * `progress` and `held`; 0 before the vine reaches the node; always in [0,1].
 */
export function nodePhenophase(progress: number, nodeU: number, held = 0): number {
  const u = Math.min(0.95, Math.max(0.05, nodeU));
  const p = clamp01(progress);
  const reach = clamp01((p - u) / Math.max(0.05, 1 - u));
  const ripen = reach * reach * (3 - 2 * reach); // buds linger, then swell
  return clamp01(ripen * RIPE_MAX + Math.max(0, held));
}
