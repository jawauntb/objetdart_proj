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
  { id: "atoms", label: "atoms", route: null, sMin: -14, sMax: -9.5 },
  { id: "molecules", label: "molecules", route: null, sMin: -9.5, sMax: -7 },
  { id: "cells", label: "cells", route: null, sMin: -7, sMax: -3.5 },
  { id: "drop", label: "a drop", route: "/drop", sMin: -3.5, sMax: -1.5 },
  { id: "flowers", label: "flowers", route: "/flowers", sMin: -1.5, sMax: 0.5 },
  { id: "coast", label: "the coast", route: "/ocean", sMin: 0.5, sMax: 4.5 },
  { id: "atlas", label: "the atlas", route: "/atlas", sMin: 4.5, sMax: 6.5 },
  { id: "earth", label: "the earth", route: "/earth", sMin: 6.5, sMax: 9 },
  { id: "stars", label: "the stars", route: "/stars", sMin: 9, sMax: 22 },
  { id: "beyond", label: "beyond", route: "/beyond", sMin: 22, sMax: 25.5 },
  { id: "manifold", label: "the manifold", route: null, sMin: 25.5, sMax: 27 },
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
