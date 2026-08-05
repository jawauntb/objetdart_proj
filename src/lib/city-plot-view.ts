import type { PlotRole } from "./city";

/**
 * city-plot-view — build the per-frame `PlotInstance[]` handed to
 * `skyline.syncPlots` without allocating a fresh array (or a fresh nested
 * object per plot) each tick, and without re-scanning every road segment
 * for every plot every frame.
 *
 * The tick loop used to call:
 *
 *   const view = plots.map(plot => ({
 *     role, seed, x, y, sealed, bornT,
 *     streetYaw: nearestRoadYaw(plot.x, plot.y),  // O(roads) per plot
 *   }));
 *
 * At 48 plots that is 48 fresh objects + one array PER FRAME (≈2900/s of
 * GC pressure), and the nearestRoadYaw scan is a full O(plots × roads)
 * sweep with no memoisation. This module hoists the array + inner objects
 * into a persistent scratch that the caller reuses each frame, and caches
 * the yaw per-plot keyed on (plot.id, plot.x, plot.y, roadsRev) so
 * nearestRoadYaw runs only when a plot moves or the road list changes.
 *
 * Nothing in here touches Three; the file is pure TypeScript so the same
 * test that runs test-city.mjs can pin its behaviour.
 */

/** The minimum plot shape this module reads. City.tsx's `Plot` type is a
 *  strict superset — dwellStartMs / liveDwellMs are irrelevant here. */
export type PlotViewSource = {
  readonly id: number;
  readonly seed: number;
  readonly x: number;
  readonly y: number;
  readonly role: PlotRole;
  readonly sealed: boolean;
  readonly bornMs: number;
};

/** The minimum road shape this module reads. Kept structural so callers
 *  can pass their own Road[] without a cast. */
export type PlotViewRoad = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

/** One row of the scratch buffer. Field-for-field the same shape the
 *  city-geometry.ts `PlotInstance` type declares (structural match) so a
 *  caller can hand `PlotViewEntry[]` straight to `skyline.syncPlots`. */
export type PlotViewEntry = {
  role: PlotRole;
  seed: number;
  x: number;
  y: number;
  sealed: boolean;
  bornT: number;
  streetYaw: number;
};

/** Snap radius (in normalized plot coords, squared) for the plot-to-road
 *  angle read. Kept as a module-scope constant so the pure inline scan
 *  and the tests read the same number. Matches the value the inline
 *  nearestRoadYaw in City.tsx used before this file existed. */
export const ROAD_SNAP_RADIUS_SQ = 0.12 * 0.12;

/**
 * The angle (in radians) of the nearest road segment to a plot at
 * normalized coordinate (nx, ny). Returns NaN when no road is within the
 * snap radius — callers treat non-finite as "use the seed's drift".
 *
 * The math is identical to the inline copy this module replaces; see
 * `src/components/City.tsx` history for the derivation of atan2(dx, dy)
 * from normToWorld's frame.
 */
export function nearestRoadYaw(
  nx: number,
  ny: number,
  roads: readonly PlotViewRoad[],
): number {
  let bestD2 = ROAD_SNAP_RADIUS_SQ;
  let bestAng = NaN;
  for (let i = 0; i < roads.length; i += 1) {
    const road = roads[i];
    const dx = road.x2 - road.x1;
    const dy = road.y2 - road.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-8) continue;
    let t = ((nx - road.x1) * dx + (ny - road.y1) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = road.x1 + t * dx;
    const py = road.y1 + t * dy;
    const ddx = nx - px;
    const ddy = ny - py;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAng = Math.atan2(dx, dy);
    }
  }
  return bestAng;
}

/** A per-plot yaw cache row. `rev` is the caller's road-revision counter
 *  at the time the yaw was computed; `x`/`y` are the plot's position at
 *  that same moment so a plot that moves invalidates its own cache. */
type YawCacheEntry = { yaw: number; rev: number; x: number; y: number };

export type PlotViewBuilder = {
  /**
   * Fill `scratch` in place with one entry per plot, allocating only
   * when `scratch.length < plots.length` (grow) or when a new plot's
   * yaw cache row is first created. Returns `scratch` unchanged.
   *
   * `roadsRev` is a monotone counter the caller bumps whenever the road
   * list mutates (push / shift / clear). Yaw is recomputed for a plot
   * only when its cache row's rev differs OR when the plot's (x, y)
   * moved — the two conditions that could change the answer.
   *
   * `growMs` is the plot's rise-in duration; `cityTimeMs` is the room
   * clock. bornT is clamped to [0.02, 1] the same way the inline copy
   * this replaces did — a plot must be at least a hair visible on frame
   * one so the InstancedMesh writes a non-degenerate matrix.
   */
  build(
    scratch: PlotViewEntry[],
    plots: readonly PlotViewSource[],
    roads: readonly PlotViewRoad[],
    cityTimeMs: number,
    growMs: number,
    roadsRev: number,
  ): PlotViewEntry[];
  /** Drop every cached yaw. Called from onLetGo when plots.length = 0. */
  clear(): void;
  /** For tests: how many plots have a live cache entry. */
  cacheSize(): number;
};

/** A fresh builder with an empty yaw cache. One per mount site. */
export function createPlotViewBuilder(): PlotViewBuilder {
  const yawCache = new Map<number, YawCacheEntry>();
  return {
    build(scratch, plots, roads, cityTimeMs, growMs, roadsRev) {
      // Grow the scratch to plots.length, mutating in place. This is the
      // only path that allocates during steady-state; once the scratch
      // has reached its high-water mark the tick loop never re-enters.
      while (scratch.length < plots.length) {
        scratch.push({
          role: "empty",
          seed: 0,
          x: 0,
          y: 0,
          sealed: false,
          bornT: 0,
          streetYaw: NaN,
        });
      }
      // Shrink by truncating length. Truncation on a plain array does not
      // reallocate the backing store, so this is zero-alloc even when
      // plots have been removed.
      if (scratch.length > plots.length) scratch.length = plots.length;

      for (let i = 0; i < plots.length; i += 1) {
        const plot = plots[i];
        const age = cityTimeMs - plot.bornMs;
        const bornT = age >= growMs ? 1 : Math.max(0.02, age / growMs);

        // Yaw cache lookup keyed on the stable plot.id. City.tsx never
        // mutates plot.x / plot.y after creation, so the (x, y) fields
        // in the cache row are a safety net for a future move rather
        // than a hot path — but keeping the check honest lets the pure
        // test file cover the invalidation without a Three context.
        let entry = yawCache.get(plot.id);
        if (entry === undefined) {
          entry = {
            yaw: nearestRoadYaw(plot.x, plot.y, roads),
            rev: roadsRev,
            x: plot.x,
            y: plot.y,
          };
          yawCache.set(plot.id, entry);
        } else if (
          entry.rev !== roadsRev ||
          entry.x !== plot.x ||
          entry.y !== plot.y
        ) {
          entry.yaw = nearestRoadYaw(plot.x, plot.y, roads);
          entry.rev = roadsRev;
          entry.x = plot.x;
          entry.y = plot.y;
        }

        const out = scratch[i];
        out.role = plot.role;
        out.seed = plot.seed;
        out.x = plot.x;
        out.y = plot.y;
        out.sealed = plot.sealed;
        out.bornT = bornT;
        out.streetYaw = entry.yaw;
      }
      return scratch;
    },
    clear() {
      yawCache.clear();
    },
    cacheSize() {
      return yawCache.size;
    },
  };
}
