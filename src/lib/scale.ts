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
  | "atmosphere"
  | "atlas"
  | "earth"
  | "planets"
  | "solar"
  | "stars"
  | "galaxy"
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
  { id: "organics", label: "organic molecules", route: "/organics", sMin: -8.8, sMax: -8 },
  { id: "dna", label: "dna", route: "/dna", sMin: -8, sMax: -7.2 },
  { id: "organelles", label: "organelles", route: "/organelles", sMin: -7.2, sMax: -5.8 },
  { id: "cells", label: "cells", route: "/cells", sMin: -5.8, sMax: -4.4 },
  { id: "tissue", label: "tissue", route: "/tissue", sMin: -4.4, sMax: -3.5 },
  { id: "drop", label: "a drop", route: "/drop", sMin: -3.5, sMax: -1.5 },
  { id: "flowers", label: "flowers", route: "/flowers", sMin: -1.5, sMax: 0.5 },
  // The air above the garden: a wingspan is metres, a flock a hundred of them.
  { id: "birds", label: "birds", route: "/birds", sMin: 0.5, sMax: 2.2 },
  { id: "coast", label: "the coast", route: "/coast", sMin: 2.2, sMax: 3.4 },
  // A peak stands kilometres over a valley tens of kilometres wide.
  { id: "olympus", label: "olympus", route: "/mountain", sMin: 3.4, sMax: 4.5 },
  // The sky re-cut (docs/plans/ground-and-sky.md). The air column is ~100 km
  // deep, so the atmosphere takes the decade under the atlas and the chart
  // floor rises to 5.5. Above the earth the axis is metric-monotone: the
  // planetary neighbourhood (the sun at 1.4e9 m, Mercury's orbit at 5.8e10),
  // the system (Neptune at 4.5e12, the heliopause at 1.8e13), interstellar
  // space (the nearest star at 4e16), one galaxy (1e21 across, read from
  // ~1e19), and the web that holds the galaxies. Unbuilt spans (route: null)
  // are real addresses — travel resolves through them until the rooms land.
  { id: "atmosphere", label: "the atmosphere", route: null, sMin: 4.5, sMax: 5.5 },
  { id: "atlas", label: "the atlas", route: "/atlas/origin", sMin: 5.5, sMax: 6.5 },
  { id: "earth", label: "the earth", route: "/earth", sMin: 6.5, sMax: 9 },
  { id: "planets", label: "the planets", route: "/planets", sMin: 9, sMax: 11 },
  { id: "solar", label: "the solar system", route: null, sMin: 11, sMax: 13.5 },
  { id: "stars", label: "the stars", route: "/stars", sMin: 13.5, sMax: 17 },
  { id: "galaxy", label: "the galaxy", route: "/galaxy", sMin: 17, sMax: 20.5 },
  { id: "space", label: "deep space", route: "/space", sMin: 20.5, sMax: 22 },
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
 * stars ; the stars thin into the galaxy, the galaxy into the web ; the web
 * opens onto the fold. /beyond branches off the fold. Metric spans stay
 * physical — sound keeps them. Doors below the band grain (the ground's
 * strata: /rocks, /soil) live in ROUTE_TRAVEL_OVERRIDES further down.
 *
 * The life ladder needs no overrides at all: for once part-of and smaller-than
 * agree the whole way down, and so do the flock's neighbours (the garden below,
 * the shore above) and the peak's (the fog below, the map above). That
 * agreement is the tell that those bands were placed right.
 */
const TRAVEL_OVERRIDES: Partial<Record<ScaleBandId, TravelOverride>> = {
  drop: { up: "coast" }, // a drop returns to the shore (beach before deep)
  coast: { down: "drop", extraUp: ["earth"] }, // the shore gives the drop back;
  // and opens laterally onto the land it borders
  tissue: { up: "flowers" }, // a sheet of cells belongs to what it is a sheet of
  flowers: { up: "earth", down: "tissue", extraDown: ["drop"] }, // a petal is
  // tissue before it is one cell; dew gathers on them too
  earth: { up: "atlas", down: "flowers", extraDown: ["coast", "olympus"] }, // the
  // ground lies on the map; things grow from it; the beach and the peak are
  // lateral doors off the land (press, release, press again)
  olympus: { down: "coast", extraUp: ["earth"] }, // the peak rises from fog;
  // walking down from the land reaches the mountain; clouds are a peer, not a
  // pinch; its canonical ceiling is now the air column, resolving onto the map
  atlas: { up: "stars" }, // the map recedes into the sky — the trunk passage;
  // the earth, the planets and the system are reached by their own doors, and
  // it descends onto the peak through the air column by metric adjacency
  stars: { down: "atlas" }, // the sky descends onto the map, and thins upward
  // into the galaxy, then the web, by metric adjacency
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

/**
 * Every band remembers the door you last crossed in through: a band id, or —
 * when you arrived from a room below the band grain (a door room like /soil)
 * — its route prefix, so the return trip finds the very room, not just its
 * band. Band-grain consumers normalize route memories to their band.
 */
export type EnteredFromMap = Partial<Record<ScaleBandId, ScaleBandId | RouteRef>>;

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
  const raw = enteredFrom[id];
  const rememberedId = typeof raw === "string" && raw.startsWith("/")
    ? scaleBandIdForRoute(raw)
    : (raw as ScaleBandId | undefined);
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

// ——— Per-route doors: the ground opens more ways than a band can say ———
//
// TRAVEL_OVERRIDES speaks at the band grain, but several rooms share one
// band and need DIFFERENT vertical destinations: from the same span of
// centimetres a drop of water sinks into the plasm, the soil crumbles into
// cells, a rock cleaves into its lattice of molecules. This layer keys
// doors by route prefix and is consulted FIRST — exact route match, then
// the band override, then metric adjacency — so the band grammar stays the
// default and this stays the exception.
//
// The author's cosmology, stated plainly: doors may invert or skip the
// metric order, because travel follows what a thing is PART of (the
// narrative), not what it is smaller than. Band SPANS may never invert or
// lie — they are physical addresses, and the sound, the blend weights and
// the room cameras are keyed to them. Doors bend; metres do not.

export type RouteRef = `/${string}`;
/** A door target: a band id, or a route that shares a band with siblings. */
export type DoorRef = ScaleBandId | RouteRef;

/**
 * Rooms that are travel destinations below the band grain: they share a
 * band with a primary resident yet are doors in their own right. `route`
 * stays null until the page ships (the room lane flips that one line);
 * while null the door resolves through to the nearest built room in its
 * direction — firstBuiltAlong's transparency law, extended to routes, so
 * declaring a future room can never sever a door that works today.
 */
export const DOOR_ROOMS: { prefix: RouteRef; band: ScaleBandId; label: string; route: string | null }[] = [
  { prefix: "/rocks", band: "drop", label: "the rocks", route: "/rocks" },
  { prefix: "/soil", band: "drop", label: "the soil", route: "/soil" },
];

type RouteTravelOverride = {
  up?: DoorRef;
  down?: DoorRef;
  /** Additional doors beyond the first (press, release, press again). */
  extraUp?: DoorRef[];
  extraDown?: DoorRef[];
};

/**
 * A route with an entry here OWNS the wall it declares: the listed doors
 * replace the band grain's offer on that wall (memory of a band-grain door
 * still answers — see travelOptionsForRoute). A wall it stays silent on
 * falls through to the band. Route-level doors swing both ways, exactly
 * like band extras: each declaration also opens the reverse door.
 */
export const ROUTE_TRAVEL_OVERRIDES: Partial<Record<string, RouteTravelOverride>> = {
  // The ground forks three ways going down: things grow from it, and it is
  // itself made of stone and of soil.
  "/earth": { down: "flowers", extraDown: ["/rocks", "/soil"] },
  // Soil returns to the ground it is the ground of, or to the garden rooted
  // in it; downward it crumbles into the living plasm.
  "/soil": { up: "earth", extraUp: ["flowers"], down: "cells" },
  // Rock returns to the ground, or rises as the peak; downward it cleaves
  // into the lattice — molecules, not life.
  "/rocks": { up: "earth", extraUp: ["olympus"], down: "molecules" },
  // A drop of water magnifies what swims in it: down is the plasm. Its
  // band's default descent, tissue, stays reachable through the petal.
  "/drop": { down: "cells" },
  // The peak descends to the shore by default; press again for the strata
  // it stands on, again for the birds riding its updraft.
  "/mountain": { down: "coast", extraDown: ["/rocks", "birds"] },
};

/** A resolved, walkable door: where the hand actually goes today. */
export type TravelDoor = {
  /** The band the door lands in — the memory key and entry-scale source. */
  band: ScaleBand;
  /** Built route to navigate to. */
  route: string;
  label: string;
};

function stripQuery(route: string): string {
  return route.split("?")[0] || route;
}

function doorRoomFor(path: string): (typeof DOOR_ROOMS)[number] | null {
  for (const d of DOOR_ROOMS) {
    if (path === d.prefix || path.startsWith(`${d.prefix}/`)) return d;
  }
  return null;
}

/** The scale band a route lives in: band primary, door room, or lateral. */
export function scaleBandIdForRoute(route: string): ScaleBandId | null {
  const path = stripQuery(route);
  for (const b of SCALE_BANDS) {
    if (b.route && (path === b.route || path.startsWith(`${b.route}/`))) return b.id;
  }
  const dr = doorRoomFor(path);
  if (dr) return dr.band;
  // Longest-prefix match so /light does not steal /light/inverse later if
  // a lateral is ever added under a shared stem.
  let best: ScaleBandId | null = null;
  let bestLen = -1;
  for (const { prefix, band } of LATERAL_ROUTE_BANDS) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > bestLen) {
      best = band;
      bestLen = prefix.length;
    }
  }
  return best;
}

function bandFor(id: ScaleBandId): ScaleBand | null {
  return SCALE_BANDS.find((b) => b.id === id) ?? null;
}

/** A band id resolved to the built room it opens onto along `dir`. */
function builtDoorForBand(id: ScaleBandId, dir: TravelDir): TravelDoor | null {
  const band = bandFor(id);
  if (!band) return null;
  const built = band.route ? band : firstBuiltAlong(band.id, dir);
  return built?.route ? { band: built, route: built.route, label: built.label } : null;
}

/** Any door ref resolved to the built room it opens onto along `dir`. */
function resolveDoorRef(ref: DoorRef, dir: TravelDir): TravelDoor | null {
  if (ref.startsWith("/")) {
    const dr = doorRoomFor(ref);
    if (dr) {
      if (dr.route) {
        const band = bandFor(dr.band);
        return band ? { band, route: dr.route, label: dr.label } : null;
      }
      return builtDoorForBand(dr.band, dir); // address without a page yet
    }
    const b = SCALE_BANDS.find((x) => x.route === ref);
    return b?.route ? { band: b, route: b.route, label: b.label } : null;
  }
  return builtDoorForBand(ref as ScaleBandId, dir);
}

/** The route-level override governing `path`, by longest prefix. */
function routeOverrideFor(path: string): RouteTravelOverride | null {
  let best: RouteTravelOverride | null = null;
  let bestLen = -1;
  for (const prefix of Object.keys(ROUTE_TRAVEL_OVERRIDES)) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > bestLen) {
      best = ROUTE_TRAVEL_OVERRIDES[prefix] ?? null;
      bestLen = prefix.length;
    }
  }
  return best;
}

/**
 * Route-level reverse pointers: every route whose override, in the opposite
 * direction, names this position — by its band id or by its route — offers
 * itself here, so route doors swing both ways like band extras do.
 */
function reverseRouteDoorRefs(path: string, homeId: ScaleBandId, dir: TravelDir): DoorRef[] {
  const out: DoorRef[] = [];
  for (const prefix of Object.keys(ROUTE_TRAVEL_OVERRIDES)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) continue; // self
    const o = ROUTE_TRAVEL_OVERRIDES[prefix];
    if (!o) continue;
    const primary = dir === 1 ? o.down : o.up;
    const extras = (dir === 1 ? o.extraDown : o.extraUp) ?? [];
    const pointsHere = [primary, ...extras].some(
      (ref) =>
        ref !== undefined &&
        (ref === homeId || ref === path || (ref.startsWith("/") && path.startsWith(`${ref}/`))),
    );
    if (pointsHere) out.push(prefix as RouteRef);
  }
  return out;
}

/**
 * Every built door out of `route` in direction `dir`, resolved-first — the
 * route-aware form of travelOptions, consulted by ScaleTravel whenever the
 * room knows its route. Resolution order: exact route override, else the
 * band grain (band override, else metric adjacency). Doors onto unbuilt
 * addresses — band or route — resolve through to the nearest built room.
 *
 * Memory: you return the way you came. A remembered origin answers when it
 * is a structural door of this wall at either grain, or when its own wall,
 * in the opposite direction, opens onto this room — the latter is what lets
 * travel that resolved THROUGH an unbuilt address still round-trip (the
 * ground drops you into the drop while /rocks is only an address; pinching
 * out of the drop must return to the ground).
 */
export function travelOptionsForRoute(
  route: string,
  dir: TravelDir,
  enteredFrom: EnteredFromMap,
): TravelDoor[] {
  const path = stripQuery(route);
  const homeId = scaleBandIdForRoute(path);
  if (!homeId) return [];

  const o = routeOverrideFor(path);
  const primaryRef = dir === 1 ? o?.up : o?.down;
  const extraRefs = (dir === 1 ? o?.extraUp : o?.extraDown) ?? [];
  const owned = primaryRef !== undefined || extraRefs.length > 0;
  const reverses = reverseRouteDoorRefs(path, homeId, dir);

  const refs: DoorRef[] = [];
  if (owned) {
    if (primaryRef !== undefined) refs.push(primaryRef);
    else {
      const n = travelNeighbor(homeId, dir);
      if (n) refs.push(n);
    }
    refs.push(...extraRefs, ...reverses);
  } else {
    refs.push(...structuralDoors(homeId, dir), ...reverses);
  }

  // The remembered origin, validated against this wall (see doc above).
  let rememberedRef: DoorRef | null = null;
  const raw = enteredFrom[homeId];
  if (typeof raw === "string") {
    const wanted: DoorRef | null = raw.startsWith("/")
      ? doorRoomFor(raw)?.prefix ?? scaleBandIdForRoute(raw)
      : (raw as ScaleBandId);
    if (wanted && wanted !== homeId) {
      const memRefs = owned ? [...refs, ...structuralDoors(homeId, dir)] : refs;
      let valid = memRefs.includes(wanted);
      if (!valid) {
        const originRoute = wanted.startsWith("/")
          ? wanted
          : bandFor(wanted as ScaleBandId)?.route ?? null;
        if (originRoute) {
          valid = travelOptionsForRoute(originRoute, dir === 1 ? -1 : 1, {}).some(
            (d) => d.route === path || d.band.id === homeId,
          );
        }
      }
      if (valid) rememberedRef = wanted;
    }
  }

  const doors: TravelDoor[] = [];
  const seen = new Set<string>();
  const push = (d: TravelDoor | null) => {
    if (!d) return;
    if (d.route === path || path.startsWith(`${d.route}/`)) return; // self
    if (seen.has(d.route)) return;
    seen.add(d.route);
    doors.push(d);
  };
  if (rememberedRef) push(resolveDoorRef(rememberedRef, dir));
  for (const ref of refs) push(resolveDoorRef(ref, dir));
  return doors;
}

/**
 * What ScaleTravel records as the origin when leaving `route`: the route
 * prefix for a door room (so the return trip finds the very room), else
 * the band id — exactly what the band-grain memory always held.
 */
export function doorMemoryFor(route: string): ScaleBandId | RouteRef | null {
  const path = stripQuery(route);
  const dr = doorRoomFor(path);
  if (dr) return dr.prefix;
  return scaleBandIdForRoute(path);
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

/**
 * Lateral / sibling routes that share a band with a primary resident but
 * are not themselves `SCALE_BANDS[].route`. Keep in lockstep with
 * `PEER_CIRCLES` in `peers.ts` — `scripts/test-routes.mjs` asserts every
 * peer room resolves here.
 */
export const LATERAL_ROUTE_BANDS: { prefix: string; band: ScaleBandId }[] = [
  // shore family + wave instruments
  { prefix: "/tide", band: "coast" },
  { prefix: "/waves", band: "coast" },
  { prefix: "/ocean", band: "coast" },
  { prefix: "/sine", band: "coast" },
  { prefix: "/circularity", band: "coast" },
  { prefix: "/pretext", band: "coast" },
  { prefix: "/aphros", band: "coast" },
  // peak weather
  { prefix: "/clouds", band: "olympus" },
  { prefix: "/storm", band: "olympus" },
  // meadow under the flock
  { prefix: "/growth", band: "flowers" },
  // hearth
  { prefix: "/fire", band: "earth" },
  // night sky instruments
  { prefix: "/comb", band: "stars" },
  { prefix: "/beam", band: "stars" },
  // cabinet at the drop
  { prefix: "/seed", band: "drop" },
  { prefix: "/coin", band: "drop" },
  { prefix: "/jewel", band: "drop" },
  { prefix: "/tourbillon", band: "drop" },
  { prefix: "/watch", band: "drop" },
  { prefix: "/plasma", band: "drop" },
  { prefix: "/pulse", band: "drop" },
  { prefix: "/charts", band: "drop" },
  { prefix: "/dither", band: "drop" },
  // the ground's strata — door rooms of the earth wall (see DOOR_ROOMS):
  // a rock in the hand, a handful of soil, both the drop's size
  { prefix: "/rocks", band: "drop" },
  { prefix: "/soil", band: "drop" },
];

/** Where a route enters the manifold: center of its band. */
export function entryScaleFor(route: string): number | null {
  const id = scaleBandIdForRoute(route);
  if (!id) return null;
  const band = SCALE_BANDS.find((b) => b.id === id);
  return band ? (band.sMin + band.sMax) / 2 : null;
}
