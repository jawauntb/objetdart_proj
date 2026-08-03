/**
 * flock — the murmuration's laws.
 *
 * The invariant is a boid parameter triple (separation, alignment, cohesion)
 * plus the wind. The flock's shape is a deterministic function of it: the same
 * seed and the same triple give the same sky, on any machine, at any refresh
 * rate. That last clause is why the integrator is FIXED-TIMESTEP with an
 * accumulator — a flock advanced by whatever the frame happened to be is a
 * different flock at 60 Hz and at 120 Hz, and the site's first law would be
 * false in the room that most needs it.
 *
 * The load-bearing map is the flock's ORDER PARAMETER → the harmonic series.
 * Order is the Vicsek order parameter: the magnitude of the mean heading,
 * 0 for a scattered sky and 1 for one animal. A scattered flock is heard as a
 * flat, detuned partial stack — chatter; a coherent murmuration collapses onto
 * a single ringing partial. And the map runs backwards: `orderFromPartials`
 * and `orderFromPartialFreqs` read the order back out of what you heard, so
 * the sound is a representation of the flock and not a decoration on it
 * (INSPIRATION.md §2).
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-flock.mjs).
 * See docs/plans/life-and-vista-bands.md §2 and §3.
 */

// ——— the sky, its size and its population ————————————————————————

/** Half-extents of the air the flock is allowed, in metres. */
export const WORLD_X = 34;
export const WORLD_Y = 15;
export const WORLD_Z = 34;
/** How far a bird sees. At this density it holds ~7 neighbours — the number
 *  real starlings actually track. */
export const PERCEPTION = 5.2;
/** Below this a neighbour is crowding, not company. */
export const SEPARATION_RADIUS = 2.4;
/** A bird is never still and never a bullet. */
export const MIN_SPEED = 5;
export const MAX_SPEED = 13;
/**
 * Deterministic ceilings on the work one bird does per step, so a tight
 * murmuration costs what open sky costs and the frame is bounded before the
 * flock is: at most this many neighbours counted, and at most this many
 * candidates walked to find them.
 */
export const MAX_NEIGHBORS = 16;
export const MAX_CANDIDATES = 48;
/** The air turns birds back before the wall does. */
export const BOUND_MARGIN = 7;

export const MIN_BIRDS = 200;
export const MAX_BIRDS = 4096;
/** A living-room aviary: readable individuals, not a distant murmuration. */
export const AVIARY_MIN = 12;
export const AVIARY_MAX = 28;

/** The integrator's one true step. Everything else accumulates into it. */
export const FIXED_DT = 1 / 60;
/** After a long stall, drop the debt rather than spiral. */
export const MAX_STEPS_PER_ADVANCE = 6;
/** No single frame may hand the integrator more than this much time. */
export const MAX_FRAME_SEC = 0.25;

// force gains — the triple is a 0..2 dial on each of these
const ALIGN_K = 2.4;
const COH_K = 0.85;
const SEP_K = 26;
const BOUND_K = 4.5;

export type Vec3 = { x: number; y: number; z: number };

export type FlockParams = {
  /** 0..2 — how hard a bird refuses to be crowded. */
  separation: number;
  /** 0..2 — how hard it matches its neighbours' heading. */
  alignment: number;
  /** 0..2 — how hard it closes on their centre. */
  cohesion: number;
  /** An acceleration on the whole sky (the vessel steers this). */
  wind: Vec3;
  /** Where the flock is going — the season's heading, a unit vector. */
  goal: Vec3;
  /** How strongly the season pulls. */
  goalPull: number;
  /** A place in the sky the hand is holding. */
  lure?: Vec3;
  /** Positive gathers the flock to the lure, negative scatters it from there. */
  lurePull?: number;
  /** Rotation about the world's vertical, through the lure or the centre. */
  swirl?: number;
};

/** How far a held finger reaches into the sky. */
export const LURE_RADIUS = 18;

/**
 * The aviary catalog — thirteen kinds the meadow holds. Colors in 0..1,
 * sized relative to the murmuration's base point scale. Pure data (no
 * classes): the hot loop indexes these by `kindOf[i]`.
 */
export const BIRD_KINDS = [
  "parrot",
  "cockatiel",
  "falcon",
  "hawk",
  "duck",
  "chicken",
  "emu",
  "finch",
  "sparrow",
  "hummingbird",
  "red-ibis",
  "peacock",
  "bird-of-paradise",
] as const;

export type BirdKind = (typeof BIRD_KINDS)[number];

/** What a bird is doing — drives place and the integrator branch. */
export const ACTIVITIES = [
  "flock",
  "fly",
  "swoop",
  "flap",
  "perch",
  "drink",
  "eat",
  "swim",
  "hop",
  "strut",
  "soar",
  "dive",
  "display",
  "hover",
  "stalk",
] as const;

export type Activity = (typeof ACTIVITIES)[number];

export type BirdSpecies = {
  kind: BirdKind;
  label: string;
  /** Multiplier on point size. */
  size: number;
  body: readonly [number, number, number];
  /** The places this bird chooses when left alone. */
  places: readonly PlaceName[];
  /** Preferred activities, first = signature. */
  activities: readonly Activity[];
};

export const BIRD_SPECIES: Record<BirdKind, BirdSpecies> = {
  parrot: {
    kind: "parrot",
    label: "parrot",
    size: 1.15,
    body: [0.22, 0.55, 0.32],
    places: ["tree", "fruit", "drink"],
    activities: ["perch", "eat", "fly", "drink", "flock"],
  },
  cockatiel: {
    kind: "cockatiel",
    label: "cockatiel",
    size: 1.05,
    body: [0.82, 0.72, 0.48],
    places: ["tree", "fruit", "grass"],
    activities: ["perch", "hop", "eat", "fly", "drink"],
  },
  falcon: {
    kind: "falcon",
    label: "falcon",
    size: 1.2,
    body: [0.42, 0.4, 0.38],
    places: ["sky", "tree"],
    activities: ["dive", "soar", "fly", "perch"],
  },
  hawk: {
    kind: "hawk",
    label: "hawk",
    size: 1.35,
    body: [0.48, 0.34, 0.22],
    places: ["sky", "tree", "grass"],
    activities: ["soar", "dive", "fly", "perch"],
  },
  duck: {
    kind: "duck",
    label: "duck",
    size: 1.2,
    body: [0.2, 0.38, 0.32],
    places: ["pond", "drink", "grass"],
    activities: ["swim", "drink", "eat", "fly", "hop"],
  },
  chicken: {
    kind: "chicken",
    label: "chicken",
    size: 1.1,
    body: [0.72, 0.62, 0.48],
    places: ["hay", "grass", "drink"],
    activities: ["eat", "hop", "stalk", "drink", "strut", "fly"],
  },
  emu: {
    kind: "emu",
    label: "emu",
    size: 1.7,
    body: [0.38, 0.3, 0.24],
    places: ["grass", "hay", "drink"],
    activities: ["stalk", "eat", "drink", "hop", "strut"],
  },
  finch: {
    kind: "finch",
    label: "finch",
    size: 0.75,
    body: [0.72, 0.48, 0.22],
    places: ["tree", "fruit", "grass"],
    activities: ["flock", "perch", "eat", "hop", "fly"],
  },
  sparrow: {
    kind: "sparrow",
    label: "sparrow",
    size: 0.8,
    body: [0.45, 0.36, 0.28],
    places: ["grass", "hay", "tree"],
    activities: ["hop", "eat", "flock", "perch", "drink"],
  },
  hummingbird: {
    kind: "hummingbird",
    label: "hummingbird",
    size: 0.65,
    body: [0.18, 0.55, 0.48],
    places: ["fruit", "tree", "drink"],
    activities: ["hover", "drink", "flap", "fly", "perch"],
  },
  "red-ibis": {
    kind: "red-ibis",
    label: "red ibis",
    size: 1.25,
    body: [0.72, 0.16, 0.14],
    places: ["drink", "pond", "grass"],
    activities: ["drink", "stalk", "fly", "perch", "flock"],
  },
  peacock: {
    kind: "peacock",
    label: "peacock",
    size: 1.45,
    body: [0.12, 0.38, 0.42],
    places: ["grass", "tree", "drink"],
    activities: ["display", "strut", "perch", "drink", "hop"],
  },
  "bird-of-paradise": {
    kind: "bird-of-paradise",
    label: "bird of paradise",
    size: 1.25,
    body: [0.12, 0.12, 0.14],
    places: ["tree", "fruit", "grass"],
    activities: ["display", "perch", "hover", "fly", "flap"],
  },
};

/** Habitat anchors in world metres — the meadow under the murmuration. */
export const PLACES = {
  tree: { x: -14, y: -5.2, z: 10 },
  fruit: { x: -11.5, y: -4.7, z: 9 },
  pond: { x: 16, y: -9.2, z: 6 },
  drink: { x: 12, y: -9.0, z: 4 },
  grass: { x: -6, y: -11.2, z: -12 },
  hay: { x: 20, y: -11.0, z: -8 },
  sky: { x: 0, y: 2, z: 0 },
} as const;

export type PlaceName = keyof typeof PLACES;

export function activityIndex(a: Activity): number {
  return ACTIVITIES.indexOf(a);
}

export function kindIndex(k: BirdKind): number {
  return BIRD_KINDS.indexOf(k);
}

export function isAirActivity(a: Activity): boolean {
  return a === "flock" || a === "fly" || a === "swoop" || a === "flap" || a === "soar" || a === "dive";
}

export type FlockState = {
  n: number;
  /** Allocated bird slots; `n` is the live prefix. */
  capacity: number;
  /** n*3 — metres. */
  pos: Float32Array;
  /** n*3 — metres per second. */
  vel: Float32Array;
  /** n*2 static — wing-phase offset (turns) and relative size. */
  bird: Float32Array;
  /** n — catalog kind index. */
  kindOf: Uint8Array;
  /** n — activity index into ACTIVITIES. */
  activityOf: Uint8Array;
  /** n*3 — species body tint, uploaded once to the GPU. */
  tint: Float32Array;
  /** n — feeding/display progress for individual morphs. */
  eatProgress: Float32Array;
  /** Seconds of unspent time held for the next fixed step. */
  acc: number;
  // ——— scratch, allocated once: the uniform grid that keeps the
  // neighbour search O(n) instead of O(n²).
  cellOf: Int32Array;
  cellStart: Int32Array;
  cursor: Int32Array;
  sorted: Int32Array;
  accel: Float32Array;
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

export const GRID_X = Math.ceil((2 * WORLD_X) / PERCEPTION);
export const GRID_Y = Math.ceil((2 * WORLD_Y) / PERCEPTION);
export const GRID_Z = Math.ceil((2 * WORLD_Z) / PERCEPTION);
const GRID_CELLS = GRID_X * GRID_Y * GRID_Z;

// ——— determinism ————————————————————————————————————————————

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The population a screen may ask for, held between floor and cap. */
export function flockSize(request: number): number {
  if (!Number.isFinite(request)) return MIN_BIRDS;
  return Math.round(clamp(Math.floor(request), MIN_BIRDS, MAX_BIRDS));
}

/**
 * A sky from one seed.
 *
 * The flock arrives already flying — a loose body around a common heading,
 * denser at its middle, the way a flock that has been in the air for an hour
 * looks. The room must be alive before it is touched, and a random gas of
 * birds is not a flock; it is a thing that becomes one while you watch.
 */
function pickActivity(sp: BirdSpecies, rng: () => number, preferSignature: boolean): Activity {
  if (preferSignature) return sp.activities[0];
  const weights = sp.activities.map((_, i) => 1 / (1 + i * 0.85));
  let sum = 0;
  for (const w of weights) sum += w;
  let r = rng() * sum;
  for (let i = 0; i < sp.activities.length; i++) {
    r -= weights[i];
    if (r <= 0) return sp.activities[i];
  }
  return sp.activities[0];
}

function jitterPlace(base: Vec3, rng: () => number, spread: Vec3): Vec3 {
  return {
    x: base.x + (rng() - 0.5) * spread.x,
    y: base.y + (rng() - 0.5) * spread.y,
    z: base.z + (rng() - 0.5) * spread.z,
  };
}

/** Ring seats so the opening aviary doesn't stack every perch on one branch. */
function meadowSeat(kindSlot: number, rng: () => number): Vec3 {
  const seats: Vec3[] = [
    { x: PLACES.tree.x - 2, y: PLACES.tree.y + 1.2, z: PLACES.tree.z },
    { x: PLACES.fruit.x + 1, y: PLACES.fruit.y + 0.8, z: PLACES.fruit.z - 2 },
    { x: PLACES.pond.x - 3, y: PLACES.pond.y, z: PLACES.pond.z + 2 },
    { x: PLACES.drink.x + 2, y: PLACES.drink.y, z: PLACES.drink.z - 3 },
    { x: PLACES.hay.x - 2, y: PLACES.hay.y, z: PLACES.hay.z + 1 },
    { x: PLACES.grass.x - 8, y: PLACES.grass.y, z: PLACES.grass.z + 4 },
    { x: PLACES.grass.x + 10, y: PLACES.grass.y, z: PLACES.grass.z - 6 },
    { x: PLACES.tree.x + 6, y: PLACES.tree.y - 1, z: PLACES.tree.z - 8 },
    { x: PLACES.pond.x + 4, y: PLACES.pond.y + 0.2, z: PLACES.pond.z - 6 },
    { x: -20, y: 5.5, z: -8 },
    { x: 18, y: 7.0, z: 12 },
    { x: PLACES.hay.x - 8, y: PLACES.hay.y, z: PLACES.grass.z },
    { x: PLACES.drink.x - 10, y: PLACES.drink.y, z: 14 },
  ];
  const base = seats[((kindSlot % seats.length) + seats.length) % seats.length];
  return {
    x: base.x + (rng() - 0.5) * 3.2,
    y: base.y + (rng() - 0.5) * 1.4,
    z: base.z + (rng() - 0.5) * 3.2,
  };
}

function placeForActivity(activity: Activity, rng: () => number, kindSlot = 0): Vec3 {
  const j = (s: number) => (rng() - 0.5) * s;
  switch (activity) {
    case "perch":
      return meadowSeat(kindSlot, rng);
    case "flap":
      return { x: PLACES.tree.x + 2 + j(8), y: PLACES.tree.y + 1 + j(3), z: PLACES.tree.z + j(8) };
    case "hover":
      return { x: PLACES.fruit.x + j(6), y: PLACES.fruit.y + 1.5 + j(3), z: PLACES.fruit.z + j(6) };
    case "drink":
      return { x: PLACES.drink.x + j(7), y: PLACES.drink.y + j(0.6), z: PLACES.drink.z + j(7) };
    case "eat":
      return rng() > 0.5
        ? { x: PLACES.fruit.x + j(6), y: PLACES.fruit.y + j(1.2), z: PLACES.fruit.z + j(6) }
        : { x: PLACES.hay.x + j(7), y: PLACES.hay.y + j(0.8), z: PLACES.hay.z + j(7) };
    case "swim":
      return { x: PLACES.pond.x + j(6), y: PLACES.pond.y + j(0.4), z: PLACES.pond.z + j(6) };
    case "hop":
      return rng() > 0.45
        ? { x: PLACES.grass.x + j(14), y: PLACES.grass.y + j(0.8), z: PLACES.grass.z + j(14) }
        : { x: PLACES.hay.x + j(8), y: PLACES.hay.y + j(0.8), z: PLACES.hay.z + j(8) };
    case "strut":
      return { x: PLACES.grass.x + 4 + j(14), y: PLACES.grass.y + j(0.6), z: PLACES.grass.z + j(12) };
    case "display":
      return meadowSeat(kindSlot + 5, rng);
    case "stalk":
      return meadowSeat(kindSlot + 9, rng);
    case "soar":
      return { x: j(WORLD_X * 1.2), y: 6 + rng() * 6, z: j(WORLD_Z * 1.2) };
    case "dive":
    case "swoop":
      return { x: j(WORLD_X * 1.1), y: 4 + rng() * 6, z: j(WORLD_Z * 1.1) };
    case "fly":
      return { x: j(WORLD_X), y: 1 + rng() * 8, z: j(WORLD_Z) };
    case "flock":
    default:
      return meadowSeat(kindSlot, rng);
  }
}

function placeForHint(hint: PlaceName | Vec3 | undefined, rng: () => number): Vec3 | null {
  if (!hint) return null;
  if (typeof hint === "string") return jitterPlace(PLACES[hint], rng, { x: 4, y: 1.4, z: 4 });
  return { x: hint.x, y: hint.y, z: hint.z };
}

function aviarySize(request: number): number {
  if (!Number.isFinite(request)) return AVIARY_MIN;
  return Math.round(clamp(Math.floor(request), AVIARY_MIN, AVIARY_MAX));
}

function makeState(n: number, capacity: number): FlockState {
  const cap = Math.max(n, capacity);
  return {
    n,
    capacity: cap,
    pos: new Float32Array(cap * 3),
    vel: new Float32Array(cap * 3),
    bird: new Float32Array(cap * 2),
    kindOf: new Uint8Array(cap),
    activityOf: new Uint8Array(cap),
    tint: new Float32Array(cap * 3),
    eatProgress: new Float32Array(cap),
    acc: 0,
    cellOf: new Int32Array(cap),
    cellStart: new Int32Array(GRID_CELLS + 1),
    cursor: new Int32Array(GRID_CELLS),
    sorted: new Int32Array(cap),
    accel: new Float32Array(cap * 3),
  };
}

function writeBird(
  state: FlockState,
  i: number,
  kind: BirdKind,
  activity: Activity,
  rng: () => number,
  heading: number,
  placeHint?: PlaceName | Vec3,
): void {
  const sp = BIRD_SPECIES[kind];
  const slot = kindIndex(kind) + i * 3;
  const place = placeForHint(placeHint, rng) ?? placeForActivity(activity, rng, slot);
  state.pos[i * 3] = clamp(place.x, -WORLD_X, WORLD_X);
  state.pos[i * 3 + 1] = clamp(place.y, -WORLD_Y, WORLD_Y);
  state.pos[i * 3 + 2] = clamp(place.z, -WORLD_Z, WORLD_Z);
  const yaw = heading + (rng() - 0.5) * 2.6;
  const pitch = (rng() - 0.5) * 0.5;
  const air = isAirActivity(activity);
  const hover = activity === "hover";
  const spMul = air ? MIN_SPEED + rng() * (MAX_SPEED - MIN_SPEED) : hover ? 1.4 + rng() * 1.4 : 0.4 + rng() * 1.2;
  state.vel[i * 3] = Math.cos(yaw) * Math.cos(pitch) * spMul;
  state.vel[i * 3 + 1] = Math.sin(pitch) * spMul * (air || hover ? 1 : 0.2);
  state.vel[i * 3 + 2] = Math.sin(yaw) * Math.cos(pitch) * spMul;
  state.bird[i * 2] = rng();
  // keep size diversity without letting every resident claim a third of the sky
  state.bird[i * 2 + 1] = clamp((0.45 + rng() * 0.85) * sp.size, 0.4, 1.55);
  state.kindOf[i] = kindIndex(kind);
  state.activityOf[i] = activityIndex(activity);
  state.tint[i * 3] = sp.body[0];
  state.tint[i * 3 + 1] = sp.body[1];
  state.tint[i * 3 + 2] = sp.body[2];
  state.eatProgress[i] = activity === "eat" ? 0.35 + rng() * 0.35 : 0;
}

export function seedFlock(seed: number, request: number): FlockState {
  const n = flockSize(request);
  const state = makeState(n, n);
  const rng = mulberry32(seed >>> 0);
  const heading = rng() * Math.PI * 2;
  const guarantee = Math.min(n, BIRD_KINDS.length);

  for (let i = 0; i < n; i++) {
    const kind = i < guarantee ? BIRD_KINDS[i] : BIRD_KINDS[Math.floor(rng() * BIRD_KINDS.length)];
    const sp = BIRD_SPECIES[kind];
    // First catalog seats open on their signature activity in the meadow;
    // everyone else is the murmuration (a thin fly minority).
    const resident = i < guarantee;
    const activity = resident ? pickActivity(sp, rng, true) : rng() < 0.18 ? "fly" : "flock";
    writeBird(state, i, kind, activity, rng, heading);
    if (!resident) {
      // same triangle body the murmuration has always used
      state.pos[i * 3] = (rng() + rng() - 1) * WORLD_X * 0.55;
      state.pos[i * 3 + 1] = (rng() + rng() - 1) * WORLD_Y * 0.5;
      state.pos[i * 3 + 2] = (rng() + rng() - 1) * WORLD_Z * 0.55;
    }
  }
  return state;
}

/**
 * A small living aviary: enough birds to be an ecosystem, few enough that
 * each can be a readable animal. Weather nudges density; season turns the
 * opening heading, but the result is still a pure function of the inputs.
 */
export function seedAviary(seed: number, weather = 0, season = 0): FlockState {
  const w = clamp01(Number(weather) || 0);
  const rng = mulberry32(hashSeed(seed, Math.round(w * 1000), season));
  const n = aviarySize(AVIARY_MIN + Math.floor(rng() * (AVIARY_MAX - AVIARY_MIN + 1)) + Math.round(w * 4));
  const state = makeState(n, AVIARY_MAX);
  const goal = seasonGoal(season);
  const heading = Math.atan2(goal.z, goal.x);
  const guarantee = Math.min(n, BIRD_KINDS.length);
  for (let i = 0; i < n; i++) {
    const kind = i < guarantee ? BIRD_KINDS[i] : BIRD_KINDS[Math.floor(rng() * BIRD_KINDS.length)];
    const sp = BIRD_SPECIES[kind];
    // Prefer a ground/water pose so the opening frame is a meadow of animals,
    // not thirteen flyers collapsed into one murmuration ball.
    let activity = pickActivity(sp, rng, i < guarantee || rng() < 0.7);
    if (i < guarantee && isAirActivity(activity)) {
      const grounded = sp.activities.find((a) => !isAirActivity(a));
      if (grounded) activity = grounded;
      else if (activity === "flock") activity = "fly";
    }
    const place = sp.places[Math.floor(rng() * sp.places.length)];
    writeBird(state, i, kind, activity, rng, heading, place);
  }
  return state;
}

/** True when every catalog kind is present at least once. */
export function catalogCovered(state: FlockState): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < state.n; i++) seen.add(state.kindOf[i]);
  return seen.size === BIRD_KINDS.length;
}

function copyBirdSlot(state: FlockState, to: number, from: number): void {
  state.pos[to * 3] = state.pos[from * 3];
  state.pos[to * 3 + 1] = state.pos[from * 3 + 1];
  state.pos[to * 3 + 2] = state.pos[from * 3 + 2];
  state.vel[to * 3] = state.vel[from * 3];
  state.vel[to * 3 + 1] = state.vel[from * 3 + 1];
  state.vel[to * 3 + 2] = state.vel[from * 3 + 2];
  state.bird[to * 2] = state.bird[from * 2];
  state.bird[to * 2 + 1] = state.bird[from * 2 + 1];
  state.kindOf[to] = state.kindOf[from];
  state.activityOf[to] = state.activityOf[from];
  state.tint[to * 3] = state.tint[from * 3];
  state.tint[to * 3 + 1] = state.tint[from * 3 + 1];
  state.tint[to * 3 + 2] = state.tint[from * 3 + 2];
  state.eatProgress[to] = state.eatProgress[from];
}

/** Nearest bird to a top-down normalised meadow address (0..1, 0..1). */
export function nearestBird(state: FlockState, nx: number, ny: number): number {
  if (state.n <= 0) return -1;
  const x = (clamp01(nx) * 2 - 1) * WORLD_X;
  const z = (clamp01(ny) * 2 - 1) * WORLD_Z;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < state.n; i++) {
    const dx = state.pos[i * 3] - x;
    const dz = state.pos[i * 3 + 2] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A normalised hit test against the meadow projection. */
export function birdAt(state: FlockState, nx: number, ny: number, radius = 0.06): number {
  const i = nearestBird(state, nx, ny);
  if (i < 0) return -1;
  const x = (clamp01(nx) * 2 - 1) * WORLD_X;
  const z = (clamp01(ny) * 2 - 1) * WORLD_Z;
  const dx = state.pos[i * 3] - x;
  const dz = state.pos[i * 3 + 2] - z;
  const r = Math.max(0, radius) * Math.max(WORLD_X, WORLD_Z) * 2;
  return dx * dx + dz * dz <= r * r ? i : -1;
}

/** Add one bird if the aviary still has capacity. Returns its slot, or -1. */
export function spawnBird(state: FlockState, kind?: BirdKind, placeHint?: PlaceName | Vec3): number {
  if (state.n >= state.capacity || state.n >= AVIARY_MAX) return -1;
  const i = state.n;
  const seed = hashSeed(
    state.n,
    state.capacity,
    Math.round(state.pos[0] * 1000),
    Math.round(state.pos[1] * 1000),
    kind ? kindIndex(kind) : 91,
  );
  const rng = mulberry32(seed);
  const k = kind ?? BIRD_KINDS[Math.floor(rng() * BIRD_KINDS.length)];
  const sp = BIRD_SPECIES[k];
  const activity = placeHint === "pond" ? "swim" : pickActivity(sp, rng, true);
  writeBird(state, i, k, activity, rng, rng() * Math.PI * 2, placeHint);
  state.n += 1;
  return i;
}

/** Remove one bird by slot or nearest normalised address. Leaves at least one. */
export function cullBird(state: FlockState, idOrNearest?: number | { nx: number; ny: number }): number {
  if (state.n <= 1) return -1;
  let idx = typeof idOrNearest === "number" ? Math.round(idOrNearest) : -1;
  if (idx < 0 && idOrNearest && typeof idOrNearest === "object") idx = nearestBird(state, idOrNearest.nx, idOrNearest.ny);
  if (idx < 0 || idx >= state.n) idx = state.n - 1;
  const last = state.n - 1;
  if (idx !== last) copyBirdSlot(state, idx, last);
  state.n = last;
  return idx;
}

/** Let the aviary go nearly empty, without leaving a dead screen. */
export function clearBirds(state: FlockState): number {
  const keep = Math.min(state.n, 1 + (state.capacity % 3));
  while (state.n > keep) cullBird(state, state.n - 1);
  return state.n;
}

/** Flush birds near a world point into the air (tap / scare). */
export function flushNear(state: FlockState, at: Vec3, radius: number): void {
  const r2 = radius * radius;
  for (let i = 0; i < state.n; i++) {
    const dx = state.pos[i * 3] - at.x;
    const dy = state.pos[i * 3 + 1] - at.y;
    const dz = state.pos[i * 3 + 2] - at.z;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    const sp = BIRD_SPECIES[BIRD_KINDS[state.kindOf[i]]];
    const next = sp.activities.includes("fly")
      ? "fly"
      : sp.activities.includes("soar")
        ? "soar"
        : sp.activities.includes("flock")
          ? "flock"
          : sp.activities.includes("flap")
            ? "flap"
            : sp.activities[0];
    state.activityOf[i] = activityIndex(next);
    const inv = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3);
    state.vel[i * 3] += dx * inv * 4;
    state.vel[i * 3 + 1] += dy * inv * 4 + 3;
    state.vel[i * 3 + 2] += dz * inv * 4;
  }
}

/** Settle the nearest bird onto a perch / grass roost (hold). */
export function roostNearest(state: FlockState, at: Vec3): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < state.n; i++) {
    const dx = state.pos[i * 3] - at.x;
    const dy = state.pos[i * 3 + 1] - at.y;
    const dz = state.pos[i * 3 + 2] - at.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const sp = BIRD_SPECIES[BIRD_KINDS[state.kindOf[best]]];
  const prefer = sp.activities.includes("perch")
    ? "perch"
    : sp.activities.includes("hop")
      ? "hop"
      : sp.activities.includes("strut")
        ? "strut"
        : sp.activities[0];
  state.activityOf[best] = activityIndex(prefer);
  const place = placeForActivity(prefer, mulberry32(state.kindOf[best] + 17));
  state.pos[best * 3] = place.x;
  state.pos[best * 3 + 1] = place.y;
  state.pos[best * 3 + 2] = place.z;
  state.vel[best * 3] *= 0.1;
  state.vel[best * 3 + 1] *= 0.1;
  state.vel[best * 3 + 2] *= 0.1;
  return best;
}

/** Flick-launch the nearest bird into a swoop / flight. */
export function launchNearest(state: FlockState, at: Vec3, dir: Vec3, speed: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < state.n; i++) {
    const dx = state.pos[i * 3] - at.x;
    const dy = state.pos[i * 3 + 1] - at.y;
    const dz = state.pos[i * 3 + 2] - at.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const sp = BIRD_SPECIES[BIRD_KINDS[state.kindOf[best]]];
  const next = sp.activities.includes("swoop")
    ? "swoop"
    : sp.activities.includes("fly")
      ? "fly"
      : "flock";
  state.activityOf[best] = activityIndex(next);
  const m = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  const s = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  state.vel[best * 3] = (dir.x / m) * s;
  state.vel[best * 3 + 1] = (dir.y / m) * s;
  state.vel[best * 3 + 2] = (dir.z / m) * s;
  return best;
}

function cellIndex(x: number, y: number, z: number): number {
  const cx = clamp(Math.floor((x + WORLD_X) / PERCEPTION), 0, GRID_X - 1);
  const cy = clamp(Math.floor((y + WORLD_Y) / PERCEPTION), 0, GRID_Y - 1);
  const cz = clamp(Math.floor((z + WORLD_Z) / PERCEPTION), 0, GRID_Z - 1);
  return (cz * GRID_Y + cy) * GRID_X + cx;
}

// ——— the integrator ——————————————————————————————————————————

/**
 * One fixed step. Never call this with a frame's delta — call `advanceFlock`,
 * which is the whole point.
 *
 * Three rules and two fields: neighbours inside PERCEPTION give alignment and
 * cohesion, neighbours inside SEPARATION_RADIUS push back with an inverse
 * square, the wind and the season's heading act on everyone, and the air turns
 * a bird before the wall clamps it.
 */
export function stepFlock(state: FlockState, params: FlockParams, dt: number): void {
  const { n, pos, vel, accel, cellOf, cellStart, cursor, sorted, activityOf } = state;
  if (n === 0 || dt <= 0) return;

  // — the uniform grid, rebuilt by counting sort each step —
  // Only air birds enter the grid — residents are O(1) place motion.
  cellStart.fill(0);
  for (let i = 0; i < n; i++) {
    const act = ACTIVITIES[activityOf[i]];
    if (!isAirActivity(act)) {
      cellOf[i] = -1;
      continue;
    }
    const c = cellIndex(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    cellOf[i] = c;
    cellStart[c + 1] += 1;
  }
  for (let c = 0; c < GRID_CELLS; c++) cellStart[c + 1] += cellStart[c];
  cursor.set(cellStart.subarray(0, GRID_CELLS));
  for (let i = 0; i < n; i++) {
    if (cellOf[i] < 0) continue;
    sorted[cursor[cellOf[i]]++] = i;
  }

  const sep = Math.max(0, params.separation);
  const ali = Math.max(0, params.alignment);
  const coh = Math.max(0, params.cohesion);
  const percept2 = PERCEPTION * PERCEPTION;
  const sepR2 = SEPARATION_RADIUS * SEPARATION_RADIUS;

  for (let i = 0; i < n; i++) {
    const act = ACTIVITIES[activityOf[i]];
    const px = pos[i * 3];
    const py = pos[i * 3 + 1];
    const pz = pos[i * 3 + 2];
    const vx = vel[i * 3];
    const vy = vel[i * 3 + 1];
    const vz = vel[i * 3 + 2];

    // Ground / water / perch residents — cheap place motion, no O(neighbors).
    if (!isAirActivity(act)) {
      let ax = 0;
      let ay = 0;
      let az = 0;
      const phase = i * 0.37 + px * 0.05;
      if (act === "perch") {
        // stay near the seat the bird was given — don't vacuum every perch to one trunk
        ax += Math.sin(phase) * 0.55;
        ay += Math.sin(phase * 1.7) * 0.25;
        az += Math.cos(phase * 0.9) * 0.55;
      } else if (act === "hover") {
        ax += (PLACES.fruit.x - px) * 1.6 + Math.sin(phase * 5.7) * 0.9;
        ay += (PLACES.fruit.y + 1.6 - py) * 2.4 + Math.sin(phase * 11.0) * 0.45;
        az += (PLACES.fruit.z - pz) * 1.6 + Math.cos(phase * 4.9) * 0.9;
      } else if (act === "drink") {
        ax += (PLACES.drink.x - px) * 1.4;
        ay += (PLACES.drink.y - py) * 2.2;
        az += (PLACES.drink.z - pz) * 1.4;
        ay += Math.sin(phase * 3) * 0.8;
      } else if (act === "eat") {
        const home = px < 4 ? PLACES.fruit : PLACES.hay;
        ax += (home.x - px) * 1.1 + Math.sin(phase * 2.8) * 0.6;
        ay += (home.y - py) * 2.0 + Math.max(0, Math.sin(phase * 6.0)) * 0.9;
        az += (home.z - pz) * 1.1 + Math.cos(phase * 2.4) * 0.5;
        state.eatProgress[i] = clamp01(state.eatProgress[i] + dt * 0.45);
      } else if (act === "swim") {
        ax += (PLACES.pond.x - px) * 0.9 + Math.cos(phase) * 1.6;
        ay += (PLACES.pond.y - py) * 3.0;
        az += (PLACES.pond.z - pz) * 0.9 + Math.sin(phase) * 1.6;
      } else if (act === "hop") {
        const home = px * pz > 0 ? PLACES.hay : PLACES.grass;
        ax += (home.x - px) * 0.5 + Math.sin(phase * 2.1) * 2.2;
        ay += (home.y - py) * 2.4;
        az += (home.z - pz) * 0.5 + Math.cos(phase * 1.7) * 2.2;
        if (Math.floor(phase * 8 + i) % 17 === 0) ay += 6;
      } else if (act === "strut") {
        ax += Math.sin(phase * 0.4) * 1.4;
        ay += Math.max(-2, PLACES.grass.y - py) * 1.2;
        az += Math.cos(phase * 0.35) * 1.1;
      } else if (act === "display") {
        ax += Math.sin(phase * 0.7) * 0.9;
        ay += Math.max(-2, PLACES.grass.y - py) * 1.2;
        az += Math.cos(phase * 0.7) * 0.9;
      } else if (act === "stalk") {
        ax += Math.sin(phase * 0.7) * 1.0;
        ay += Math.max(-2, PLACES.grass.y - py) * 1.2;
        az += Math.cos(phase * 0.6) * 1.0;
      }
      // Soft wind only — residents feel a breeze, not a gale.
      ax += params.wind.x * 0.12;
      ay += params.wind.y * 0.12;
      az += params.wind.z * 0.12;
      accel[i * 3] = ax;
      accel[i * 3 + 1] = ay;
      accel[i * 3 + 2] = az;
      continue;
    }

    let sumVx = 0;
    let sumVy = 0;
    let sumVz = 0;
    let sumPx = 0;
    let sumPy = 0;
    let sumPz = 0;
    let sepX = 0;
    let sepY = 0;
    let sepZ = 0;
    let seen = 0;
    let walked = 0;

    const cx = clamp(Math.floor((px + WORLD_X) / PERCEPTION), 0, GRID_X - 1);
    const cy = clamp(Math.floor((py + WORLD_Y) / PERCEPTION), 0, GRID_Y - 1);
    const cz = clamp(Math.floor((pz + WORLD_Z) / PERCEPTION), 0, GRID_Z - 1);

    outer: for (let gz = cz - 1; gz <= cz + 1; gz++) {
      if (gz < 0 || gz >= GRID_Z) continue;
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0 || gy >= GRID_Y) continue;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          if (gx < 0 || gx >= GRID_X) continue;
          const c = (gz * GRID_Y + gy) * GRID_X + gx;
          const from = cellStart[c];
          const to = cellStart[c + 1];
          for (let k = from; k < to; k++) {
            const j = sorted[k];
            if (j === i) continue;
            walked += 1;
            if (walked > MAX_CANDIDATES) break outer;
            const dx = pos[j * 3] - px;
            const dy = pos[j * 3 + 1] - py;
            const dz = pos[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > percept2) continue;
            sumVx += vel[j * 3];
            sumVy += vel[j * 3 + 1];
            sumVz += vel[j * 3 + 2];
            sumPx += pos[j * 3];
            sumPy += pos[j * 3 + 1];
            sumPz += pos[j * 3 + 2];
            if (d2 < sepR2) {
              // Inverse square, floored so a coincident pair still parts in
              // a definite direction instead of dividing by nothing.
              const w = 1 / Math.max(d2, 0.05);
              sepX -= dx * w;
              sepY -= dy * w;
              sepZ -= dz * w;
            }
            seen += 1;
            if (seen >= MAX_NEIGHBORS) break outer;
          }
        }
      }
    }

    let ax = 0;
    let ay = 0;
    let az = 0;
    if (seen > 0) {
      const inv = 1 / seen;
      ax += (sumVx * inv - vx) * ali * ALIGN_K;
      ay += (sumVy * inv - vy) * ali * ALIGN_K;
      az += (sumVz * inv - vz) * ali * ALIGN_K;
      ax += (sumPx * inv - px) * coh * COH_K;
      ay += (sumPy * inv - py) * coh * COH_K;
      az += (sumPz * inv - pz) * coh * COH_K;
    }
    ax += sepX * sep * SEP_K;
    ay += sepY * sep * SEP_K;
    az += sepZ * sep * SEP_K;

    ax += params.wind.x;
    ay += params.wind.y;
    az += params.wind.z;
    ax += params.goal.x * params.goalPull;
    ay += params.goal.y * params.goalPull;
    az += params.goal.z * params.goalPull;

    // the hand in the sky: a held finger gathers, a moving one scatters, and
    // a circling one turns the whole animal about its own axis
    const lurePull = params.lurePull ?? 0;
    const swirl = params.swirl ?? 0;
    if ((lurePull !== 0 || swirl !== 0) && params.lure) {
      const lx = params.lure.x - px;
      const ly = params.lure.y - py;
      const lz = params.lure.z - pz;
      const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (d < LURE_RADIUS && d > 1e-4) {
        // linear falloff: felt at the fingertip, gone at arm's length
        const w = (1 - d / LURE_RADIUS) / d;
        ax += lx * w * lurePull;
        ay += ly * w * lurePull;
        az += lz * w * lurePull;
        // and the tangent about the vertical, which is how a murmuration turns
        const r = Math.sqrt(lx * lx + lz * lz);
        if (r > 1e-4) {
          // positive swirl turns the flock counter-clockwise seen from above
          const t = (swirl * (1 - d / LURE_RADIUS)) / r;
          ax += lz * t;
          az += -lx * t;
        }
      }
    }

    // the air turns them back before the wall has to
    if (px > WORLD_X - BOUND_MARGIN) ax -= BOUND_K * (px - (WORLD_X - BOUND_MARGIN));
    else if (px < -WORLD_X + BOUND_MARGIN) ax -= BOUND_K * (px + WORLD_X - BOUND_MARGIN);
    if (py > WORLD_Y - BOUND_MARGIN) ay -= BOUND_K * (py - (WORLD_Y - BOUND_MARGIN));
    else if (py < -WORLD_Y + BOUND_MARGIN) ay -= BOUND_K * (py + WORLD_Y - BOUND_MARGIN);
    if (pz > WORLD_Z - BOUND_MARGIN) az -= BOUND_K * (pz - (WORLD_Z - BOUND_MARGIN));
    else if (pz < -WORLD_Z + BOUND_MARGIN) az -= BOUND_K * (pz + WORLD_Z - BOUND_MARGIN);

    accel[i * 3] = ax;
    accel[i * 3 + 1] = ay;
    accel[i * 3 + 2] = az;
  }

  for (let i = 0; i < n; i++) {
    const act = ACTIVITIES[activityOf[i]];
    const air = isAirActivity(act);
    let vx = vel[i * 3] + accel[i * 3] * dt;
    let vy = vel[i * 3 + 1] + accel[i * 3 + 1] * dt;
    let vz = vel[i * 3 + 2] + accel[i * 3 + 2] * dt;

    // The wall turns a bird BEFORE its speed is settled, so a bounce never
    // leaves anything flying slower than a bird flies.
    const nx = pos[i * 3] + vx * dt;
    const ny = pos[i * 3 + 1] + vy * dt;
    const nz = pos[i * 3 + 2] + vz * dt;
    if (nx > WORLD_X && vx > 0) vx = -vx * 0.6;
    else if (nx < -WORLD_X && vx < 0) vx = -vx * 0.6;
    if (ny > WORLD_Y && vy > 0) vy = -vy * 0.6;
    else if (ny < -WORLD_Y && vy < 0) vy = -vy * 0.6;
    if (nz > WORLD_Z && vz > 0) vz = -vz * 0.6;
    else if (nz < -WORLD_Z && vz < 0) vz = -vz * 0.6;

    // Swoop / dive pulls down until low, then recovers into fly.
    if (act === "swoop" || act === "dive") {
      vy -= (act === "dive" ? 6.0 : 4.5) * dt * 60; // keep the nose down
      if (pos[i * 3 + 1] < -6) {
        activityOf[i] = activityIndex("fly");
        vy = Math.abs(vy) * 0.5 + 2;
      }
    }

    if (act === "soar") {
      vy += Math.sin((pos[i * 3] + pos[i * 3 + 2]) * 0.08 + dt) * 0.2;
    }

    const maxSp = air ? (act === "swoop" || act === "dive" ? MAX_SPEED * 1.18 : MAX_SPEED) : 3.2;
    const minSp = air ? (act === "soar" ? MIN_SPEED * 0.75 : MIN_SPEED) : 0;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (sp > maxSp) {
      const k = maxSp / sp;
      vx *= k;
      vy *= k;
      vz *= k;
    } else if (air && sp < minSp) {
      // A bird that has been stopped dead still leaves in some direction:
      // its own if it has one, the season's if it does not.
      const k = sp > 1e-6 ? minSp / sp : 0;
      if (k > 0) {
        vx *= k;
        vy *= k;
        vz *= k;
      } else {
        vx = params.goal.x * minSp;
        vy = params.goal.y * minSp;
        vz = params.goal.z * minSp;
      }
    } else if (!air) {
      // Damp residents so they settle into their place.
      vx *= 0.92;
      vy *= 0.88;
      vz *= 0.92;
    }
    // and the sky is closed: whatever the wind, a bird is inside it.
    const px = clamp(pos[i * 3] + vx * dt, -WORLD_X, WORLD_X);
    const py = clamp(pos[i * 3 + 1] + vy * dt, -WORLD_Y, WORLD_Y);
    const pz = clamp(pos[i * 3 + 2] + vz * dt, -WORLD_Z, WORLD_Z);
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    pos[i * 3] = px;
    pos[i * 3 + 1] = py;
    pos[i * 3 + 2] = pz;
  }
}

/**
 * Hand the integrator a frame's worth of real time. It spends it in whole
 * FIXED_DT steps and carries the remainder, so the same elapsed time is the
 * same flock whether it arrived in one lump or in twenty — which is the only
 * reason the room looks the same on a 120 Hz phone as on a 60 Hz laptop.
 *
 * Returns how many fixed steps were taken.
 */
export function advanceFlock(state: FlockState, params: FlockParams, elapsedSec: number): number {
  const dt = Math.max(0, Math.min(MAX_FRAME_SEC, elapsedSec));
  state.acc += dt;
  let steps = 0;
  while (state.acc >= FIXED_DT && steps < MAX_STEPS_PER_ADVANCE) {
    stepFlock(state, params, FIXED_DT);
    state.acc -= FIXED_DT;
    steps += 1;
  }
  if (steps >= MAX_STEPS_PER_ADVANCE) state.acc = 0;
  return steps;
}

// ——— what the flock is, read off it ————————————————————————————

/**
 * The Vicsek order parameter: the magnitude of the mean unit heading. Exactly
 * 0 for a sky whose headings cancel (a regular ring, an opposed pair), exactly
 * 1 for one animal. Computed from the velocities alone — it knows nothing
 * about the integrator that made them, and nothing about where the observer
 * is standing.
 */
export function orderParameter(vel: Float32Array | number[], n: number): number {
  if (n <= 0) return 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    const x = vel[i * 3];
    const y = vel[i * 3 + 1];
    const z = vel[i * 3 + 2];
    const sp = Math.sqrt(x * x + y * y + z * z);
    if (sp < 1e-9) continue;
    mx += x / sp;
    my += y / sp;
    mz += z / sp;
    counted += 1;
  }
  if (counted === 0) return 0;
  return clamp01(Math.sqrt(mx * mx + my * my + mz * mz) / counted);
}

/** Where the whole animal is. */
export function centroid(pos: Float32Array | number[], n: number): Vec3 {
  if (n <= 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    x += pos[i * 3];
    y += pos[i * 3 + 1];
    z += pos[i * 3 + 2];
  }
  return { x: x / n, y: y / n, z: z / n };
}

/** How big the animal is: rms distance from its own centre. */
export function spread(pos: Float32Array | number[], n: number): number {
  if (n <= 0) return 0;
  const c = centroid(pos, n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3] - c.x;
    const dy = pos[i * 3 + 1] - c.y;
    const dz = pos[i * 3 + 2] - c.z;
    s += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(s / n);
}

/** Every bird inside the air it was given. */
export function withinBounds(pos: Float32Array | number[], n: number, eps = 1e-3): boolean {
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (Math.abs(x) > WORLD_X + eps) return false;
    if (Math.abs(y) > WORLD_Y + eps) return false;
    if (Math.abs(z) > WORLD_Z + eps) return false;
  }
  return true;
}

// ——— the map: order → the harmonic series —————————————————————

/** How many partials the flock is allowed to ring. */
export const PARTIALS = 6;
/** How far the partials are pulled off the harmonic series when scattered. */
export const MAX_STRETCH = 0.18;

/**
 * Order → partial amplitudes, L2-normalised.
 *
 * The ratio between successive partials is r = 1 − order. A scattered sky
 * (order 0, r 1) rings every partial equally — a flat stack, which is chatter;
 * one animal (order 1, r 0) puts everything in the fundamental and nothing
 * anywhere else. Between them the stack tilts smoothly, and the tilt IS the
 * order, which is what makes the next function possible.
 */
export function partialsForOrder(order: number, count = PARTIALS): number[] {
  const r = 1 - clamp01(order);
  const k = Math.max(1, Math.floor(count));
  const raw: number[] = [];
  let sum2 = 0;
  for (let i = 0; i < k; i++) {
    const a = Math.pow(r, i);
    raw.push(a);
    sum2 += a * a;
  }
  const norm = Math.sqrt(sum2) || 1;
  return raw.map((a) => a / norm);
}

/**
 * ...and back. The ratio of the second partial to the first is r, so the
 * order the flock had is 1 − r. This is the inverse that makes the sound a
 * representation of the flock rather than an accompaniment to it.
 */
export function orderFromPartials(amps: number[]): number | null {
  if (!amps || amps.length < 2) return null;
  if (!(amps[0] > 0)) return null;
  return clamp01(1 - amps[1] / amps[0]);
}

/**
 * Partial frequencies. At full order they are the harmonic series exactly —
 * k × the fundamental, the one case anybody can check by hand. Disorder
 * stretches them apart, so a scattered flock beats against itself.
 */
export function partialFreq(baseHz: number, k: number, order: number): number {
  const stretch = (1 - clamp01(order)) * MAX_STRETCH;
  const kk = Math.max(1, Math.floor(k));
  return baseHz * kk * (1 + stretch * (kk - 1));
}

/** The second inverse: the interval between the first two partials is also
 *  the order, read straight off two frequencies. */
export function orderFromPartialFreqs(f1: number, f2: number): number | null {
  if (!(f1 > 0) || !(f2 > 0)) return null;
  const stretch = f2 / (2 * f1) - 1;
  return clamp01(1 - stretch / MAX_STRETCH);
}

/** How often the flock calls: a scattered sky chatters, one animal rings. */
export const CALL_MIN_MS = 420;
export const CALL_MAX_MS = 1500;
export function callInterval(order: number): number {
  return CALL_MIN_MS + clamp01(order) * (CALL_MAX_MS - CALL_MIN_MS);
}

// ——— the world-law: seasons and the wind ——————————————————————

export const SEASONS = 4;

/**
 * Where the flock is going. Four seasons, four headings — north for the
 * return, east for the long light, south for the leaving, west for the
 * gathering. Any integer names a season; the year wraps.
 */
export function seasonGoal(season: number): Vec3 {
  const s = ((Math.round(season) % SEASONS) + SEASONS) % SEASONS;
  const a = (s / SEASONS) * Math.PI * 2;
  // a slight climb in spring and summer, a slight fall in autumn and winter
  const lift = Math.sin(a) * 0.22;
  const x = Math.sin(a);
  const z = -Math.cos(a);
  const m = Math.sqrt(x * x + lift * lift + z * z) || 1;
  return { x: x / m, y: lift / m, z: z / m };
}

/** The season's name, for the room's own use — never rendered as a caption. */
export const SEASON_LABELS = ["the return", "the long light", "the leaving", "the gathering"];

export function seasonIndex(season: number): number {
  return ((Math.round(season) % SEASONS) + SEASONS) % SEASONS;
}

/**
 * The vessel steers the wind. Tilt right and the air pushes right; tilt the
 * top of the device away and it pushes into the depth of the sky. Bounded by
 * `strength` in every direction, so no amount of tilt can blow the flock out
 * of the world.
 */
export function windFromTilt(beta: number, gamma: number, strength: number): Vec3 {
  const g = clamp(gamma / 40, -1, 1);
  const b = clamp((beta - 45) / 40, -1, 1);
  const s = Math.max(0, strength);
  return { x: g * s, y: -b * s * 0.35, z: b * s };
}

/** Wind magnitude, for anything that needs to hear how hard it is blowing. */
export function windStrength(w: Vec3): number {
  return Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
}
