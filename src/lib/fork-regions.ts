/**
 * Fork regions — where the pinch happens chooses the door.
 *
 * At a fork wall the press-release-press cycle (ScaleTravel's WallOffer)
 * offers doors one at a time. A room that knows its own geography can do
 * better: declare regions of its frame — the sky above the ridge, the sea
 * below the shoreline — and let the pinch centroid pick the door directly.
 * Where a room declares nothing, or the point falls in no region, the
 * resolver answers null and the cycle carries on exactly as before.
 *
 * Coordinates are the room's own frame, normalized: nx, ny in [0, 1] with
 * ny = 0 at the top. Rooms pass in per-frame numbers (a fog altitude, a
 * shoreline y, a ridge silhouette sampled across the width); the lib holds
 * the law. Pure math, no imports, no DOM — node-testable
 * (scripts/test-fork-regions.mjs).
 *
 * Two hard laws:
 *  - The resolver never invents a door: its answer is always one of the
 *    doors the travel graph already offers (`available`), or null.
 *  - Same point, same regions, same available doors → same destination,
 *    every time. Region order is the tie-break: the first region in the
 *    list that claims the point speaks for it, and if the door it names is
 *    not on offer the answer is null — the hand is never rerouted through
 *    a door it did not point at.
 */

/** A door out of the room: a band id or a route — whatever the travel graph names it. */
export type ForkDoor = string;

/** One region of the room's frame, claiming its door over normalized points. */
export type ForkRegion = {
  door: ForkDoor;
  /** Does this region claim the point? Pure over (nx, ny) ∈ [0,1]². */
  test: (nx: number, ny: number) => boolean;
};

/** The plainest constructor: a door and its claim. */
export function region(
  door: ForkDoor,
  test: (nx: number, ny: number) => boolean,
): ForkRegion {
  return { door, test };
}

/**
 * A horizon at ny = splitNy: strictly above the line (ny < splitNy — the
 * top of the frame is ny = 0) opens `above`; the line itself and everything
 * under it opens `below`. Exactly one side owns the boundary, so a swept
 * point never falls in a seam and never lands in two regions at once.
 * A non-finite split declares nothing — refusing, not guessing.
 */
export function horizonSplit(
  splitNy: number,
  above: ForkDoor,
  below: ForkDoor,
): ForkRegion[] {
  if (!Number.isFinite(splitNy)) return [];
  return [
    { door: above, test: (_nx, ny) => ny < splitNy },
    { door: below, test: (_nx, ny) => ny >= splitNy },
  ];
}

/**
 * A meridian at nx = splitNx: strictly left of the line opens `left`; the
 * line itself and everything right of it opens `right`. Same boundary law
 * as the horizon: one side owns the line.
 */
export function verticalSplit(
  splitNx: number,
  left: ForkDoor,
  right: ForkDoor,
): ForkRegion[] {
  if (!Number.isFinite(splitNx)) return [];
  return [
    { door: left, test: (nx) => nx < splitNx },
    { door: right, test: (nx) => nx >= splitNx },
  ];
}

/**
 * The silhouette height at nx, linearly interpolated between evenly spaced
 * samples spanning nx = 0 .. 1. One sample is a flat horizon. nx outside
 * the span reads the nearest edge.
 */
export function silhouetteAt(samples: readonly number[], nx: number): number {
  if (samples.length === 1) return samples[0];
  const t = Math.min(1, Math.max(0, nx)) * (samples.length - 1);
  const i = Math.min(samples.length - 2, Math.floor(t));
  const f = t - i;
  return samples[i] * (1 - f) + samples[i + 1] * f;
}

/**
 * A ridge sampled per frame: `samples` are ny heights at evenly spaced nx
 * across the width. Strictly above the interpolated silhouette opens
 * `above`; on it and under it opens `below` — the ridge line itself is
 * ground, not sky. The samples are copied at declaration, so a room
 * refilling its per-frame buffer cannot move a wall that is already being
 * pressed. Empty or non-finite samples declare nothing.
 */
export function silhouetteSplit(
  samples: readonly number[],
  above: ForkDoor,
  below: ForkDoor,
): ForkRegion[] {
  if (samples.length === 0) return [];
  for (const v of samples) if (!Number.isFinite(v)) return [];
  const ridge = samples.slice();
  return [
    { door: above, test: (nx, ny) => ny < silhouetteAt(ridge, nx) },
    { door: below, test: (nx, ny) => ny >= silhouetteAt(ridge, nx) },
  ];
}

/**
 * The law of the fork wall: which door does a pinch at (nx, ny) take?
 *
 * Walks `regions` in order; the first region that claims the point names
 * the door. The answer is that door if — and only if — it is among
 * `available` (the doors the travel graph already offers, by whatever name
 * the caller uses in both places); otherwise null. Null always means: fall
 * back to the press-release-press cycle, exactly as today.
 *
 * Degenerate points refuse rather than guess: a non-finite or out-of-frame
 * centroid claims nothing.
 */
export function resolveForkByPoint(
  regions: readonly ForkRegion[],
  nx: number,
  ny: number,
  available: readonly ForkDoor[],
): ForkDoor | null {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  for (const r of regions) {
    if (r.test(nx, ny)) {
      return available.includes(r.door) ? r.door : null;
    }
  }
  return null;
}
