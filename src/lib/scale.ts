/**
 * The scale manifold — one axis from the quantum fields to the spacetime
 * manifold.
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
  | "quanta"
  | "quarks"
  | "nucleons"
  | "atoms"
  | "molecules"
  | "organics"
  | "dna"
  | "organelles"
  | "cells"
  | "tissue"
  | "drop"
  | "flowers"
  | "birds"
  | "coast"
  | "olympus"
  | "atlas"
  | "earth"
  | "stars"
  | "space"
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
  { id: "quanta", label: "the quanta", route: "/quanta", sMin: -22, sMax: -19 },
  { id: "quarks", label: "quarks", route: "/quarks", sMin: -19, sMax: -15 },
  { id: "nucleons", label: "nucleons", route: "/nucleons", sMin: -15, sMax: -14 },
  { id: "atoms", label: "atoms", route: "/atoms", sMin: -14, sMax: -9.5 },
  // The life ladder. Carbon chains at ~0.9nm (hexane, glucose), a folded
  // protein at 4-10nm, the helix 2nm across with an 11nm nucleosome, a
  // ribosome at 25nm and a mitochondrion at 1um, a eukaryote at ~20um, an
  // epithelial sheet a fraction of a millimetre. Four rungs where the axis
  // used to take one step from a water molecule to a living plasm.
  { id: "molecules", label: "molecules", route: "/molecules", sMin: -9.5, sMax: -8.8 },
  { id: "organics", label: "organic molecules", route: null, sMin: -8.8, sMax: -8 },
  { id: "dna", label: "dna", route: null, sMin: -8, sMax: -7.2 },
  { id: "organelles", label: "organelles", route: null, sMin: -7.2, sMax: -5.8 },
  { id: "cells", label: "cells", route: "/cells", sMin: -5.8, sMax: -4.4 },
  { id: "tissue", label: "tissue", route: null, sMin: -4.4, sMax: -3.5 },
  { id: "drop", label: "a drop", route: "/drop", sMin: -3.5, sMax: -1.5 },
  { id: "flowers", label: "flowers", route: "/flowers", sMin: -1.5, sMax: 0.5 },
  // The air above the garden: a wingspan is metres, a flock a hundred of them.
  { id: "birds", label: "birds", route: null, sMin: 0.5, sMax: 2.2 },
  { id: "coast", label: "the coast", route: "/ocean", sMin: 2.2, sMax: 3.4 },
  // A peak stands kilometres over a valley tens of kilometres wide.
  { id: "olympus", label: "olympus", route: null, sMin: 3.4, sMax: 4.5 },
  { id: "atlas", label: "the atlas", route: "/atlas/origin", sMin: 4.5, sMax: 6.5 },
  { id: "earth", label: "the earth", route: "/earth", sMin: 6.5, sMax: 9 },
  { id: "stars", label: "the stars", route: "/stars", sMin: 9, sMax: 16.5 },
  // The nearest star is 4e16 m, a nebula 1e17-1e18, a galaxy 1e21.
  { id: "space", label: "deep space", route: null, sMin: 16.5, sMax: 22 },
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

export type TravelDir = -1 | 1; // -1 = inward/smaller, +1 = outward/larger

type TravelOverride = {
  up?: ScaleBandId;
  down?: ScaleBandId;
  /** Additional non-canonical doors (forks beyond the reverse-pointer rule). */
  extraUp?: ScaleBandId[];
  extraDown?: ScaleBandId[];
};

/**
 * The author's cosmology, stated as doors. Containment, inside → outside:
 * quarks ⊂ atoms ⊂ molecules ⊂ organics ⊂ dna ⊂ organelles ⊂ cells ⊂ tissue
 * ⊂ {drop, flowers} ; drop ⊂ coast ; flowers grow from the earth (the ground,
 * the strata) ; birds fly over the garden and out to the shore ; the peak
 * stands above the fog that is the sea ; coast and earth are both ON the
 * atlas (the map holds the land and the shore) ; the atlas recedes into the
 * stars ; the stars thin into the galactic web ; the web opens onto the fold.
 * /beyond branches off the fold. Metric spans stay physical — sound keeps them.
 *
 * The life ladder needs no overrides at all: for once part-of and smaller-than
 * agree the whole way down, and so do the flock's neighbours (the garden below,
 * the shore above) and the peak's (the fog below, the map above). That
 * agreement is the tell that those bands were placed right.
 */
const TRAVEL_OVERRIDES: Partial<Record<ScaleBandId, TravelOverride>> = {
  drop: { up: "coast" }, // a drop returns to the sea
  coast: { down: "drop" }, // and the sea gives the drop back
  tissue: { up: "flowers" }, // a sheet of cells belongs to what it is a sheet of
  flowers: { up: "earth", down: "tissue", extraDown: ["drop"] }, // a petal is
  // tissue before it is one cell; dew gathers on them too
  earth: { up: "atlas", down: "flowers" }, // the ground lies on the map;
  // things grow from it
  atlas: { up: "stars" }, // the map recedes into the sky (the planet-globe
  // room will one day sit between them); it descends onto the peak by metric
  stars: { down: "atlas" }, // the sky descends onto the map, and thins upward
  // into the web by metric adjacency
  space: { up: "manifold" }, // the web opens onto the fold; /beyond stays a
  // branch off the trunk, reachable by fork doors and received back by memory
  manifold: { down: "space" },
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

/**
 * Every door out of `id` in direction `dir`, built or not: the canonical
 * neighbor, any band whose opposite door points here, and declared extras
 * (in both directions, so every extra door swings both ways and the
 * round-trip law survives).
 */
function structuralDoors(id: ScaleBandId, dir: TravelDir): ScaleBandId[] {
  const doors: ScaleBandId[] = [];
  const add = (b: ScaleBandId | null | undefined) => {
    if (b && b !== id && !doors.includes(b)) doors.push(b);
  };
  add(travelNeighbor(id, dir));
  const opposite: TravelDir = dir === 1 ? -1 : 1;
  for (const b of SCALE_BANDS) {
    if (travelNeighbor(b.id, opposite) === id) add(b.id);
    const o = TRAVEL_OVERRIDES[b.id];
    const theirExtras = opposite === 1 ? o?.extraUp : o?.extraDown;
    if (theirExtras?.includes(id)) add(b.id);
  }
  const own = TRAVEL_OVERRIDES[id];
  for (const b of (dir === 1 ? own?.extraUp : own?.extraDown) ?? []) add(b);
  return doors;
}

export type EnteredFromMap = Partial<Record<ScaleBandId, ScaleBandId>>;

/**
 * Where travel in `dir` actually goes from `id`: the remembered origin if it
 * is one of this direction's doors (you return the way you came), else the
 * canonical neighbor. Returns the full band, or null at the axis's ends.
 */
export function resolveDestination(
  id: ScaleBandId,
  dir: TravelDir,
  enteredFrom: EnteredFromMap,
): ScaleBand | null {
  const rememberedId = enteredFrom[id];
  if (rememberedId && rememberedId !== id && structuralDoors(id, dir).includes(rememberedId)) {
    return SCALE_BANDS.find((b) => b.id === rememberedId) ?? null;
  }
  const n = travelNeighbor(id, dir);
  return n ? SCALE_BANDS.find((b) => b.id === n) ?? null : null;
}

/**
 * An unbuilt band is *transparent* to travel, not a wall: a hand pinching out
 * of the plasm still reaches the garden while /tissue is only an address, and
 * the sky still opens onto the fold before /space is a room. Walk the
 * canonical chain past any routeless band until a built one is found.
 *
 * This is what lets the axis be re-cut ahead of the rooms: declaring a future
 * band can never sever a door that works today, and each room that ships
 * simply shortens the walk. The `seen` guard keeps a cosmology with a cycle
 * in it from hanging the loop.
 */
function firstBuiltAlong(startId: ScaleBandId, dir: TravelDir): ScaleBand | null {
  let cur: ScaleBandId | null = startId;
  const seen = new Set<ScaleBandId>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const band = SCALE_BANDS.find((b) => b.id === cur);
    if (!band) return null;
    if (band.route) return band;
    cur = travelNeighbor(cur, dir);
  }
  return null;
}

/**
 * Every built door leading out of `id` in direction `dir`, resolved-first.
 * A fork (the earth holds both the atlas and the flowers; the fold holds
 * the stars and the beyond) offers its doors in this order; pressing the
 * wall takes the first, releasing and pressing again cycles to the next.
 * Doors onto unbuilt bands resolve through them rather than disappearing.
 */
export function travelOptions(
  id: ScaleBandId,
  dir: TravelDir,
  enteredFrom: EnteredFromMap,
): ScaleBand[] {
  const options: ScaleBand[] = [];
  const seen = new Set<ScaleBandId>();
  const add = (b: ScaleBand | null | undefined) => {
    if (!b || b.id === id) return;
    const built = b.route ? b : firstBuiltAlong(b.id, dir);
    if (!built || built.id === id || seen.has(built.id)) return;
    seen.add(built.id);
    options.push(built);
  };
  add(resolveDestination(id, dir, enteredFrom));
  for (const doorId of structuralDoors(id, dir)) {
    add(SCALE_BANDS.find((b) => b.id === doorId));
  }
  return options;
}

// ——— Step back: the two-finger tap (gesture grammar §5) ———

/** How far one step back retreats, in decades — gentle, felt, never a jump. */
export const STEP_BACK_DECADES = 0.35;

/**
 * Two-finger tap = step back: an impulse velocity (decades/second) that,
 * decaying through stepScale's V_TAU integrator with no active input,
 * displaces s by exactly the step — clamped inside the band so the nudge
 * can approach but never reach the upper wall, and therefore never emits
 * a detent or a crossing. Pure; the law tested in scripts/test-scale.mjs.
 */
export function stepBackVelocity(s: number): number {
  const band = bandAt(clampScale(s));
  const headroom = band.sMax - EDGE_PEEK - clampScale(s);
  const step = Math.min(STEP_BACK_DECADES, Math.max(0, headroom));
  return step / (V_TAU / 1000);
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
