/**
 * The scale manifold — one axis from quarks to the spacetime manifold.
 *
 * `s` is a position in log10 meters. Every room that joins the manifold owns a
 * band (a half-open span of decades); zooming moves `s`; crossing a band
 * boundary is *travel* and must be meant, not slipped into. Generalized from
 * src/lib/stars/nestedCosmos.ts, which proved both the band-crossfade idea and
 * the accidental-zoom failure mode this integrator exists to prevent.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-scale.mjs).
 * See docs/plans/scale-manifold-build-plan.md (W0/W1) and INSPIRATION.md §6.
 */

export type ScaleBandId =
  | "quarks"
  | "atoms"
  | "molecules"
  | "cells"
  | "drop"
  | "flowers"
  | "coast"
  | "atlas"
  | "earth"
  | "stars"
  | "beyond"
  | "manifold";

export type ScaleBand = {
  id: ScaleBandId;
  label: string;
  /** Primary route serving this band today; null until the room is built. */
  route: string | null;
  /** log10 meters, inclusive. */
  sMin: number;
  /** log10 meters, exclusive (except the last band). */
  sMax: number;
};

/**
 * Physical addresses. Spans are contiguous and ordered small → large.
 * Unbuilt bands (route: null) still exist in the math so travel resistance
 * and audio registers are stable when the rooms arrive (plan W6).
 */
export const SCALE_BANDS: ScaleBand[] = [
  { id: "quarks", label: "quarks", route: null, sMin: -19, sMax: -14 },
  { id: "atoms", label: "atoms", route: "/atoms", sMin: -14, sMax: -9.5 },
  { id: "molecules", label: "molecules", route: "/molecules", sMin: -9.5, sMax: -7 },
  { id: "cells", label: "cells", route: "/cells", sMin: -7, sMax: -3.5 },
  { id: "drop", label: "a drop", route: "/drop", sMin: -3.5, sMax: -1.5 },
  { id: "flowers", label: "flowers", route: "/flowers", sMin: -1.5, sMax: 0.5 },
  { id: "coast", label: "the coast", route: "/ocean", sMin: 0.5, sMax: 4.5 },
  { id: "atlas", label: "the atlas", route: "/atlas/origin", sMin: 4.5, sMax: 6.5 },
  { id: "earth", label: "the earth", route: "/earth", sMin: 6.5, sMax: 9 },
  { id: "stars", label: "the stars", route: "/stars", sMin: 9, sMax: 22 },
  { id: "beyond", label: "beyond", route: "/beyond", sMin: 22, sMax: 25.5 },
  { id: "manifold", label: "the manifold", route: "/manifold", sMin: 25.5, sMax: 27 },
];

export const SCALE_MIN = SCALE_BANDS[0].sMin;
export const SCALE_MAX = SCALE_BANDS[SCALE_BANDS.length - 1].sMax;

/** Width of the crossfade window on each side of a boundary, in decades. */
export const EDGE_BLEND = 0.4;
/** How far past a wall the view may rubber-band visually, in decades. */
export const EDGE_PEEK = 0.18;
/** Sustained push required to cross a boundary, in ms. */
export const TRAVEL_INTENT_MS = 320;
/** Max |velocity| in decades/second (zoom speed governor). */
export const V_MAX = 2.6;
/** Velocity smoothing time constant, ms. */
export const V_TAU = 90;
/** Intent decays this much faster than it accumulates. */
const INTENT_DECAY = 3;

export function clampScale(s: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

export function bandIndexAt(s: number): number {
  const c = clampScale(s);
  for (let i = 0; i < SCALE_BANDS.length; i++) {
    if (c < SCALE_BANDS[i].sMax) return i;
  }
  return SCALE_BANDS.length - 1;
}

export function bandAt(s: number): ScaleBand {
  return SCALE_BANDS[bandIndexAt(s)];
}

export type BandBlend = {
  primary: ScaleBandId;
  secondary: ScaleBandId;
  /** 0 = fully primary; 1 = fully secondary. */
  t: number;
};

/** Crossfade weight toward the neighboring band near a boundary. */
export function bandBlend(s: number): BandBlend {
  const c = clampScale(s);
  const i = bandIndexAt(c);
  const band = SCALE_BANDS[i];
  const toLower = c - band.sMin;
  const toUpper = band.sMax - c;
  if (i > 0 && toLower < EDGE_BLEND) {
    return {
      primary: band.id,
      secondary: SCALE_BANDS[i - 1].id,
      t: 0.5 * (1 - toLower / EDGE_BLEND),
    };
  }
  if (i < SCALE_BANDS.length - 1 && toUpper < EDGE_BLEND) {
    return {
      primary: band.id,
      secondary: SCALE_BANDS[i + 1].id,
      t: 0.5 * (1 - toUpper / EDGE_BLEND),
    };
  }
  return { primary: band.id, secondary: band.id, t: 0 };
}

export type ScaleState = {
  s: number;
  /** decades/second. */
  v: number;
  /** Accumulated sustained push against the current wall, ms. */
  intentMs: number;
  /** Which wall is being pressed: the band edge s would cross next. */
  pressing: -1 | 0 | 1;
};

export function initialScaleState(s: number): ScaleState {
  return { s: clampScale(s), v: 0, intentMs: 0, pressing: 0 };
}

export type ScaleInput = {
  /**
   * Requested zoom velocity in decades/second. Negative = toward smaller
   * scales (pinch out / zoom in), positive = toward larger (pinch in).
   */
  zoomVel: number;
  /** True while the gesture is held. */
  active: boolean;
};

/**
 * Wheel/trackpad pinches arrive as discrete ticks with no end event. An input
 * older than this is treated as released — otherwise one orphan tick keeps
 * pushing the integrator and eventually self-travels through a wall.
 */
export const PINCH_TICK_TTL_MS = 150;

/** The liveness policy for tick-style inputs: stale means released. */
export function liveInput(input: ScaleInput, msSinceLastEvent: number): ScaleInput {
  if (input.active && msSinceLastEvent > PINCH_TICK_TTL_MS) {
    return { zoomVel: 0, active: false };
  }
  return input;
}

export type ScaleEvent =
  | { type: "detent"; at: number; band: ScaleBandId }
  | { type: "edge"; toward: ScaleBandId; progress: number }
  | { type: "crossing"; from: ScaleBandId; to: ScaleBandId; s: number };

export type ScaleStep = {
  state: ScaleState;
  events: ScaleEvent[];
  /** 0..1 rubber-band pressure for rooms to render at the wall. */
  edgePressure: number;
};

/**
 * Advance the scale position by dtMs under the given input.
 *
 * Two regimes:
 *  - LOCAL: s integrates freely inside the band; velocity is smoothed and
 *    clamped so a fast pinch cannot skip material.
 *  - TRAVEL: at a wall, motion stops and pushes accumulate as intent. Only
 *    TRAVEL_INTENT_MS of sustained push breaks through (emitting `crossing`);
 *    letting go decays intent quickly and the wall holds. A `detent` fires on
 *    first contact with the wall so the hand feels the stop.
 */
export function stepScale(state: ScaleState, input: ScaleInput, dtMs: number): ScaleStep {
  const dt = Math.max(0, Math.min(100, dtMs)) / 1000;
  const events: ScaleEvent[] = [];
  let { s, v, intentMs, pressing } = state;

  const target = input.active ? Math.max(-V_MAX, Math.min(V_MAX, input.zoomVel)) : 0;
  const k = 1 - Math.exp(-dtMs / V_TAU);
  v = v + (target - v) * k;

  const i = bandIndexAt(s);
  const band = SCALE_BANDS[i];
  let next = s + v * dt;
  let edgePressure = 0;

  const hitLower = next < band.sMin && i > 0;
  const hitUpper = next >= band.sMax && i < SCALE_BANDS.length - 1;

  if (!hitLower && !hitUpper) {
    // LOCAL regime — free movement, intent releases.
    s = clampScale(next);
    if (intentMs > 0) intentMs = Math.max(0, intentMs - dtMs * INTENT_DECAY);
    pressing = 0;
    return { state: { s, v, intentMs, pressing }, events, edgePressure };
  }

  const dir: -1 | 1 = hitLower ? -1 : 1;
  const wall = hitLower ? band.sMin : band.sMax;
  const neighbor = SCALE_BANDS[i + dir];

  if (pressing !== dir) {
    // First contact with this wall in this push: a felt stop.
    events.push({ type: "detent", at: wall, band: band.id });
    pressing = dir;
    intentMs = 0;
  }

  const pushing = input.active && Math.sign(target) === dir && Math.abs(target) > 0.05;
  if (pushing) {
    intentMs += dtMs;
    edgePressure = Math.min(1, intentMs / TRAVEL_INTENT_MS);
    events.push({ type: "edge", toward: neighbor.id, progress: edgePressure });
  } else {
    intentMs = Math.max(0, intentMs - dtMs * INTENT_DECAY);
    edgePressure = Math.min(1, intentMs / TRAVEL_INTENT_MS);
  }

  if (intentMs >= TRAVEL_INTENT_MS) {
    // Break through: land just inside the neighbor so re-crossing needs a
    // fresh, deliberate push.
    const landing = dir === 1 ? wall + EDGE_PEEK : wall - EDGE_PEEK;
    events.push({ type: "crossing", from: band.id, to: neighbor.id, s: landing });
    return {
      state: { s: clampScale(landing), v: v * 0.35, intentMs: 0, pressing: 0 },
      events,
      edgePressure: 0,
    };
  }

  // Held at the wall; velocity bleeds off against it.
  s = dir === 1 ? Math.min(next, wall - 1e-9) : Math.max(next, wall);
  v *= Math.exp(-dt * 6);
  return { state: { s: clampScale(s), v, intentMs, pressing }, events, edgePressure };
}

/**
 * A room that owns an internal camera (its own zoom) joins the manifold by
 * declaring how that zoom spans its band. `zoomMin` is the room's WIDEST
 * view — the top of the band, larger scales beyond it; `zoomMax` is its
 * TIGHTEST view — the band floor, smaller scales beyond. The zoom→s map is
 * therefore monotone and order-reversing: zooming in moves down the axis.
 */
export type RoomZoomSpec = {
  band: ScaleBandId;
  /** Internal zoom at the widest view (maps to the band ceiling). */
  zoomMin: number;
  /** Internal zoom at the tightest view (maps to the band floor). */
  zoomMax: number;
};

function bandById(id: ScaleBandId): ScaleBand {
  for (const b of SCALE_BANDS) if (b.id === id) return b;
  return SCALE_BANDS[0];
}

/** Bands are half-open: keep a mapped position strictly under the ceiling. */
const ROOM_WALL_EPS = 1e-6;

/**
 * Internal zoom → manifold position, in log domain (zoom is multiplicative,
 * decades are its logarithm). zoomMin lands flush against the band ceiling
 * and zoomMax on the band floor, so the room's extremes ARE the walls: one
 * residual push at either end makes wall contact within a frame.
 */
export function scaleForRoomZoom(spec: RoomZoomSpec, zoom: number): number {
  const b = bandById(spec.band);
  const z = Math.max(spec.zoomMin, Math.min(spec.zoomMax, zoom));
  const u = Math.log(z / spec.zoomMin) / Math.log(spec.zoomMax / spec.zoomMin);
  const s = b.sMax - u * (b.sMax - b.sMin);
  return Math.max(b.sMin, Math.min(b.sMax - ROOM_WALL_EPS, s));
}

/**
 * Which manifold wall the internal zoom is pinned against, in scale-axis
 * terms (matching ScaleState.pressing): -1 = the band floor (tightest view;
 * smaller scales beyond), +1 = the band ceiling (widest view; larger scales
 * beyond), 0 = strictly inside — the room owns its camera.
 */
export function roomZoomWall(spec: RoomZoomSpec, zoom: number): -1 | 0 | 1 {
  const eps = (spec.zoomMax - spec.zoomMin) * 1e-6;
  if (zoom >= spec.zoomMax - eps) return -1;
  if (zoom <= spec.zoomMin + eps) return 1;
  return 0;
}

/**
 * Residual pinch at a held extreme → manifold input.
 *
 * `zoomInVel` is the room's ATTEMPTED zoom velocity in log units per second
 * (ln of the per-event zoom ratio over elapsed time — the same convention
 * the gesture engine uses for pinch velocity); positive means zooming in.
 * Strictly inside the room's range the input is inactive: internal zoom is
 * the room's own business and the manifold must not move. Only overflow at
 * a pinned extreme becomes wall pressure, and stepScale still demands
 * TRAVEL_INTENT_MS of sustained push before it becomes travel.
 */
export function residualScaleInput(
  spec: RoomZoomSpec,
  zoom: number,
  zoomInVel: number,
): ScaleInput {
  const wall = roomZoomWall(spec, zoom);
  if (wall === -1 && zoomInVel > 0) {
    // Zooming in past the tightest view: toward smaller scales.
    return { zoomVel: Math.max(-V_MAX, -zoomInVel), active: true };
  }
  if (wall === 1 && zoomInVel < 0) {
    // Zooming out past the widest view: toward larger scales.
    return { zoomVel: Math.min(V_MAX, -zoomInVel), active: true };
  }
  return { zoomVel: 0, active: false };
}

// ——— The travel graph: part-of, not size-of ———
//
// The metric axis orders bands by size, but a hand zooming out of a drop
// expects the sea it belongs to, not a garden that happens to be the next
// size up. Travel therefore follows mereology — what a thing is PART of —
// with the metric adjacency as the default. Where a parent has two children
// (the earth holds both the atlas and the flowers), you return the way you
// came: every band remembers the neighbor you last crossed from.

export type TravelDir = -1 | 1; // -1 = toward smaller scales, +1 = toward larger

const TRAVEL_OVERRIDES: Partial<Record<ScaleBandId, { up?: ScaleBandId; down?: ScaleBandId }>> = {
  drop: { up: "coast" }, // a drop returns to the sea
  coast: { down: "drop" }, // and the sea gives the drop back
  flowers: { up: "earth", down: "cells" }, // a garden on the planet; a petal opens into cells
  stars: { up: "manifold" }, // the sky opens straight onto the fold
  manifold: { down: "stars" }, // and the fold descends into stars — /beyond is a
  // branch off the trunk (an abstraction, not a place between places),
  // reachable by memory: leave through it and it will receive you back.
};

/** Canonical travel neighbor: mereological override, else metric adjacency. */
export function travelNeighbor(id: ScaleBandId, dir: TravelDir): ScaleBandId | null {
  const o = TRAVEL_OVERRIDES[id];
  const overridden = dir === 1 ? o?.up : o?.down;
  if (overridden) return overridden;
  const i = SCALE_BANDS.findIndex((b) => b.id === id);
  const n = SCALE_BANDS[i + dir];
  return n ? n.id : null;
}

export type EnteredFromMap = Partial<Record<ScaleBandId, ScaleBandId>>;

/**
 * Where travel in `dir` actually goes from `id`: the remembered origin if it
 * lies in that direction (you return the way you came), else the canonical
 * neighbor. Returns the full band, or null at the ends of the axis.
 */
export function resolveDestination(
  id: ScaleBandId,
  dir: TravelDir,
  enteredFrom: EnteredFromMap,
): ScaleBand | null {
  const self = SCALE_BANDS.find((b) => b.id === id);
  const rememberedId = enteredFrom[id];
  if (self && rememberedId && rememberedId !== id) {
    const r = SCALE_BANDS.find((b) => b.id === rememberedId);
    if (r && (dir === 1 ? r.sMin >= self.sMax - 1e-9 : r.sMax <= self.sMin + 1e-9)) {
      return r;
    }
  }
  const n = travelNeighbor(id, dir);
  return n ? SCALE_BANDS.find((b) => b.id === n) ?? null : null;
}

/** Arrival position: upward travel enters at the lower wall, downward at the upper. */
export function entryScaleInto(dest: ScaleBand, dir: TravelDir): number {
  const mid = (dest.sMin + dest.sMax) / 2;
  return dir === 1 ? Math.min(dest.sMin + EDGE_PEEK, mid) : Math.max(dest.sMax - EDGE_PEEK, mid);
}

export type SpectralRegister = {
  /** Fundamental for the band's ambient bed, Hz. */
  baseHz: number;
  /** Breathing rate for the band, Hz (cosmic = minutes, atomic = fast). */
  lfoHz: number;
  /** 0..1 — how much high-partial shimmer the palette may carry. */
  brightness: number;
};

/**
 * Scale position → audio register. Small scales ring high and quick, large
 * scales sink toward sub-bass and minute-long breaths, so zooming the world
 * is a glissando (plan W3). Continuous in s, so bandBlend crossfades match.
 */
export function spectralRegisterFor(s: number): SpectralRegister {
  const u = (clampScale(s) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  const baseHz = 27.5 * Math.pow(2, (1 - u) * 7);
  const lfoHz = 1.8 * Math.pow(2, -u * 7.5);
  return { baseHz, lfoHz, brightness: 1 - u * 0.85 };
}

/** Where a route enters the manifold: center of its band. */
export function entryScaleFor(route: string): number | null {
  for (const b of SCALE_BANDS) {
    if (b.route && route.startsWith(b.route)) return (b.sMin + b.sMax) / 2;
  }
  // Coast shares one band across three shores.
  if (route.startsWith("/tide") || route.startsWith("/waves")) {
    const coast = SCALE_BANDS.find((b) => b.id === "coast");
    if (coast) return (coast.sMin + coast.sMax) / 2;
  }
  return null;
}
