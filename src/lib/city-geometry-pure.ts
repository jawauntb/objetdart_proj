/**
 * city-geometry-pure — the small pure helpers city-geometry and
 * city-towers both need, extracted so those two modules can co-exist
 * without a circular import.
 *
 * A settlement's variety is legible because these hashes are stable:
 * the plot at seed=N keeps its roof pitch, its awning color, its
 * event-tower silhouette across every rebuild. Every function here is
 * pure — no THREE, no DOM, no time — so the pure test can load them
 * without any stub at all.
 */

/** Deterministic unit-float hash from a seed integer and a small salt. */
export function hashUnit(seed: number, salt: number): number {
  let n = ((seed | 0) ^ (salt * 0x9e3779b1)) >>> 0;
  n = Math.imul(n, 0x85ebca6b) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 0xc2b2ae35) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}

/**
 * Event tower silhouette variant.
 *
 *   0 — Gherkin (barrel-swell lathe body + diamond curtain-wall mask)
 *   1 — Salesforce (stack of 4 tapered cylinder segments + ellipsoid cap)
 *   2 — Transamerica (4-sided pyramid + two wing prisms N/S)
 */
export type EventVariant = 0 | 1 | 2;

export function eventVariantForSeed(seed: number): EventVariant {
  const t = hashUnit(seed, 31);
  return t < 0.4 ? 0 : t < 0.75 ? 1 : 2;
}
