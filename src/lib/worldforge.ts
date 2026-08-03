/**
 * Worldforge — the planet latent (/planets, INSPIRATION.md §6).
 *
 * A compact 12-dim latent in [0,1] IS a world: radius, ocean fraction,
 * terrain family, relief, atmosphere tint and depth, axial tilt, day
 * length, cloud cover, ring density, moon retinue, polar ice. The decode
 * (worldFromLatent) is affine and therefore invertible: latentFromWorld
 * reads the vector back off the world's physical fields, exactly. Sculpting
 * is movement of the point — raise land and the ocean coordinate falls;
 * wind the ring and the ring coordinate climbs. If the round trip ever
 * breaks, the room is decoration, not a map.
 *
 * Accretion is a duration, not a tier: the held time buys mass along one
 * continuous saturating curve, and mass is conserved — every world is
 * condensed out of one fixed budget of dust, growth draws the reserve
 * down, and a retired world returns to it.
 *
 * Pure and import-free by law: no DOM, no audio, no Math.random, no
 * Date.now. Node-testable standalone (scripts/test-worldforge.mjs). The
 * room that renders these (PlanetForge) owns canvas, sound, and haptics.
 */

export const LATENT_DIM = 12;

/** The field holds this many worlds; the oldest is retired past it. */
export const MAX_WORLDS = 9;

/** One fixed budget of dust — all worlds together can never exceed it. */
export const DUST_TOTAL = 1;

/** Ring density above this renders a visible ring. */
export const RING_MIN = 0.55;

/** Hard cap on axial tilt, radians (~35.5 degrees). */
export const TILT_MAX = 0.62;

/** Display radius bounds, unit space (fractions of the field's cell). */
export const RADIUS_MIN = 0.22;
export const RADIUS_MAX = 1;

/** Day length bounds, hours. */
export const DAY_MIN = 6;
export const DAY_MAX = 60;

/** A world may carry at most this many moons. */
export const MOON_MAX = 3;

/** Accretion time constant, ms — the curve's whole shape (see accretionRadius). */
export const ACCRETION_TAU_MS = 1400;

/** Mass bounds: even a dust-mote world costs something. */
export const MASS_MIN = 0.02;
export const MASS_SPAN = 0.26;

const TAU = Math.PI * 2;

// —————————————————— hashing / prng (inline, no deps) ——————————————————

function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Fold any integer parts into one 32-bit seed (order-sensitive). */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = mix32(h ^ Math.imul(Math.floor(p) | 0, 0x9e3779b1));
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A newborn's point in latent space: LATENT_DIM values in [0,1). */
export function latentFromSeed(seed: number): number[] {
  const rng = mulberry32(mix32((seed >>> 0) || 1));
  const l: number[] = new Array(LATENT_DIM);
  for (let i = 0; i < LATENT_DIM; i++) l[i] = rng();
  return l;
}

// ————————————————————————— types —————————————————————————

export type Moon = {
  /** Orbit radius, in world radii (outside any ring). */
  dist: number;
  /** Moon radius relative to the world's, 0.08..0.2. */
  size: number;
  /** Orbital phase at t=0, radians. */
  phase: number;
  /** Orbit rate, radians per hour of world time. */
  speed: number;
};

/**
 * The world — every field an affine image of one latent coordinate, so
 * the whole vector can be read back off it (latentFromWorld). Moons are
 * derived furniture: their count is the quantized moonField, their orbits
 * pure functions of the seed.
 */
export type World = {
  seed: number;
  /** l0 — display radius, RADIUS_MIN..RADIUS_MAX. */
  radius01: number;
  /** l1 — ocean fraction of the surface, 0..1. */
  ocean: number;
  /** l2 — position along the terrain family ramp, 0..1. */
  terrainHue: number;
  /** l3 — relief: how sharply the land rises, 0..1. */
  relief: number;
  /** l4 — position along the atmosphere tint ramp, 0..1. */
  atmoHue: number;
  /** l5 — atmosphere depth: 0 airless .. 1 thick veil. */
  atmoDepth: number;
  /** l6 × TILT_MAX — axial tilt, radians. */
  tiltRad: number;
  /** l7 → DAY_MIN..DAY_MAX — hours in this world's day. */
  dayHours: number;
  /** l8 — cloud cover, 0..1. */
  cloud: number;
  /** l9 — ring density; a ring shows above RING_MIN. */
  ring: number;
  /** l10 — moon retinue field; floor(l10 × (MOON_MAX+1)) moons. */
  moonField: number;
  /** l11 — polar ice extent, 0..1. */
  ice: number;
  moons: Moon[];
};

// —————————————————————— the decoder and its inverse ——————————————————————

export function moonCountOf(moonField: number): number {
  return Math.min(MOON_MAX, Math.floor(clamp01(moonField) * (MOON_MAX + 1)));
}

function moonsFor(seed: number, moonField: number): Moon[] {
  const count = moonCountOf(moonField);
  const rng = mulberry32(mix32((seed >>> 0) ^ 0x5f356495));
  const moons: Moon[] = [];
  let dist = 1.7;
  for (let i = 0; i < count; i++) {
    dist += 0.55 + rng() * 0.5;
    moons.push({
      dist,
      size: 0.08 + rng() * 0.12,
      phase: rng() * TAU,
      // Farther moons run slower — a felt Kepler, not the real law.
      speed: (0.5 + rng() * 0.35) / Math.sqrt(dist),
    });
  }
  return moons;
}

/** Decode a latent into a complete world. Pure; affine in every field. */
export function worldFromLatent(latent: number[], seed: number): World {
  const l = latent.map(clamp01);
  const moonField = l[10];
  return {
    seed: (seed >>> 0) || 1,
    radius01: RADIUS_MIN + l[0] * (RADIUS_MAX - RADIUS_MIN),
    ocean: l[1],
    terrainHue: l[2],
    relief: l[3],
    atmoHue: l[4],
    atmoDepth: l[5],
    tiltRad: l[6] * TILT_MAX,
    dayHours: DAY_MIN + l[7] * (DAY_MAX - DAY_MIN),
    cloud: l[8],
    ring: l[9],
    moonField,
    ice: l[11],
    moons: moonsFor(seed, moonField),
  };
}

/**
 * Read the latent back off the world's physical fields — the inverse of
 * worldFromLatent, and the room's central claim: the vector IS the world.
 */
export function latentFromWorld(w: World): number[] {
  return [
    (w.radius01 - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN),
    w.ocean,
    w.terrainHue,
    w.relief,
    w.atmoHue,
    w.atmoDepth,
    w.tiltRad / TILT_MAX,
    (w.dayHours - DAY_MIN) / (DAY_MAX - DAY_MIN),
    w.cloud,
    w.ring,
    w.moonField,
    w.ice,
  ];
}

export function worldFromSeed(seed: number): World {
  return worldFromLatent(latentFromSeed(seed), seed);
}

// —————————————————————— mass and the dust reserve ——————————————————————

/** Mass grows with the cube of size — a big world is dear. */
export function massOf(w: World): number {
  const r = (w.radius01 - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
  return MASS_MIN + MASS_SPAN * r * r * r;
}

/** The inverse of massOf, clamped to the displayable radius band. */
export function radiusForMass(mass: number): number {
  const m = Math.max(MASS_MIN, Math.min(MASS_MIN + MASS_SPAN, mass));
  const r = Math.cbrt((m - MASS_MIN) / MASS_SPAN);
  return RADIUS_MIN + r * (RADIUS_MAX - RADIUS_MIN);
}

/** The heaviest body the display band can hold; past it, collisions eject. */
export const MASS_MAX = MASS_MIN + MASS_SPAN;

/**
 * The accretion curve: held time buys radius along one continuous
 * saturating exponential. Strictly monotone in heldMs, materially
 * different at 900ms and 2400ms — the long-press IS the accretion time,
 * never a tier switch.
 */
export function accretionRadius(heldMs: number): number {
  const t = Math.max(0, heldMs);
  const u = 1 - Math.exp(-t / ACCRETION_TAU_MS);
  return RADIUS_MIN + u * (RADIUS_MAX - RADIUS_MIN);
}

export type Forge = { world: World; reserve: number };

/**
 * Condense a new world out of the dust. The held duration sets the radius
 * through accretionRadius; the reserve caps it — a field short of dust
 * yields a smaller world, never a negative reserve. Mass is conserved:
 * reserve falls by exactly the newborn's mass.
 */
export function forgeWorld(reserve: number, seed: number, heldMs: number): Forge | null {
  if (reserve < MASS_MIN) return null; // not even a mote of dust left
  const latent = latentFromSeed(seed);
  const wanted = accretionRadius(heldMs);
  const affordable = radiusForMass(reserve);
  const radius01 = Math.min(wanted, affordable);
  latent[0] = (radius01 - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
  const world = worldFromLatent(latent, seed);
  return { world, reserve: reserve - massOf(world) };
}

/**
 * Keep accreting onto an existing world: extend its position on the same
 * curve by dMs. Draws the difference from the reserve; conserved, capped,
 * and monotone — a hold never shrinks a world.
 */
export function growWorld(w: World, reserve: number, dMs: number): Forge {
  if (dMs <= 0) return { world: w, reserve };
  const u = clamp01((w.radius01 - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN));
  // Where on the curve this world already stands.
  const tNow = u >= 1 ? Infinity : -ACCRETION_TAU_MS * Math.log(1 - u);
  const wanted = accretionRadius(tNow + dMs);
  const affordable = radiusForMass(reserve + massOf(w));
  const radius01 = Math.max(w.radius01, Math.min(wanted, affordable));
  const grown = setLatentDim(w, 0, (radius01 - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN));
  return { world: grown, reserve: reserve - (massOf(grown) - massOf(w)) };
}

// —————————————————————— sculpting: moving the point ——————————————————————

/** Move one latent coordinate and re-decode — sculpting IS translation. */
export function setLatentDim(w: World, dim: number, value: number): World {
  const l = latentFromWorld(w);
  l[dim] = clamp01(value);
  return worldFromLatent(l, w.seed);
}

/** Raise land: the ocean coordinate falls, monotonically, clamped at dry. */
export function raiseLand(w: World, amount: number): World {
  if (amount <= 0) return w;
  return setLatentDim(w, 1, w.ocean - amount);
}

/** Flood: the ocean coordinate climbs, monotonically, clamped at drowned. */
export function floodOcean(w: World, amount: number): World {
  if (amount <= 0) return w;
  return setLatentDim(w, 1, w.ocean + amount);
}

/** Wind or unwind the ring — a signed circular scrub. */
export function windRing(w: World, delta: number): World {
  if (delta === 0) return w;
  return setLatentDim(w, 9, w.ring + delta);
}

/** Lean or right the axis — the world-law layer's vertical drag. */
export function tiltAxis(w: World, deltaRad: number): World {
  if (deltaRad === 0) return w;
  return setLatentDim(w, 6, (w.tiltRad + deltaRad) / TILT_MAX);
}

/** Thicken or thin the cloud deck. */
export function stirClouds(w: World, delta: number): World {
  if (delta === 0) return w;
  return setLatentDim(w, 8, w.cloud + delta);
}

// —————————————————————— the field's population ——————————————————————

export type Kept<T> = { worlds: T[]; retired: T[] };

/**
 * Append a world, retiring the oldest past MAX_WORLDS. Order is age,
 * oldest first; what leaves is always the head, never the newcomer.
 */
export function addWorld<T>(worlds: T[], w: T): Kept<T> {
  const next = [...worlds, w];
  const retired: T[] = [];
  while (next.length > MAX_WORLDS) retired.push(next.shift() as T);
  return { worlds: next, retired };
}

// —————————————————————— insolation: the world-law ——————————————————————

/**
 * Sunlight on a point of the sphere. `season` is the orbital phase in
 * 0..1 (0.25 = this axis's midsummer); the subsolar latitude follows the
 * tilt, and cos(zenith) is the standard spherical dot product.
 *
 * The hand-computable law pinned in tests: at the pole in midsummer the
 * insolation equals sin(tilt) at EVERY hour angle — the midnight sun. A
 * sign slip in the tilt convention lights the winter pole instead, and
 * looks perfectly smooth while being exactly backwards.
 */
export function insolation(
  latRad: number,
  hourAngleRad: number,
  tiltRad: number,
  season: number,
): number {
  const subLat = Math.asin(Math.sin(tiltRad) * Math.sin(season * TAU));
  const cosZ =
    Math.sin(latRad) * Math.sin(subLat) +
    Math.cos(latRad) * Math.cos(subLat) * Math.cos(hourAngleRad);
  return Math.max(0, cosZ);
}

// —————————————————————— palette (site tokens only) ——————————————————————

export type RGB = [number, number, number];

/**
 * The only colors a world may wear — the site tokens as numbers, each
 * ramp ordered dark → light (compare botany's PALETTE_FAMILIES).
 */
export const TOKEN_RGB = {
  gold: [200, 115, 42] as RGB, // --candle
  goldDeep: [156, 88, 32] as RGB,
  merlot: [122, 31, 31] as RGB, // --closed
  merlotDeep: [79, 20, 20] as RGB,
  sea: [44, 74, 92] as RGB, // --sea
  seaDeep: [30, 52, 64] as RGB,
  paper: [242, 238, 230] as RGB, // --paper
  parchment: [221, 211, 190] as RGB,
  kept: [110, 90, 46] as RGB, // --kept
  ink: [21, 23, 26] as RGB,
} as const;

const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Piecewise-linear walk along a ramp of stops, u in 0..1. */
function ramp(stops: RGB[], u: number): RGB {
  const x = clamp01(u) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixRgb(stops[i], stops[i + 1], x - i);
}

// Terrain families along the terrainHue axis: rust → gold → kept → parchment.
const LAND_LO_RAMP: RGB[] = [
  TOKEN_RGB.merlotDeep,
  TOKEN_RGB.goldDeep,
  TOKEN_RGB.kept,
  TOKEN_RGB.seaDeep,
];
const LAND_HI_RAMP: RGB[] = [
  TOKEN_RGB.merlot,
  TOKEN_RGB.gold,
  TOKEN_RGB.parchment,
  TOKEN_RGB.paper,
];
// Atmosphere tints: sea teal → paper haze → candle gold.
const ATMO_RAMP: RGB[] = [TOKEN_RGB.sea, TOKEN_RGB.paper, TOKEN_RGB.gold];

export type WorldColors = {
  landLo: RGB;
  landHi: RGB;
  seaShallow: RGB;
  seaDeep: RGB;
  atmo: RGB;
  ringCol: RGB;
  cloud: RGB;
  ice: RGB;
};

/** The world's whole wardrobe, deterministic from its latent alone. */
export function worldColors(w: World): WorldColors {
  return {
    landLo: ramp(LAND_LO_RAMP, w.terrainHue),
    landHi: ramp(LAND_HI_RAMP, w.terrainHue),
    seaShallow: mixRgb(TOKEN_RGB.sea, TOKEN_RGB.paper, 0.16),
    seaDeep: mixRgb(TOKEN_RGB.seaDeep, TOKEN_RGB.ink, 0.35),
    atmo: ramp(ATMO_RAMP, w.atmoHue),
    ringCol: mixRgb(TOKEN_RGB.parchment, TOKEN_RGB.kept, 0.4 + 0.4 * w.ring),
    cloud: TOKEN_RGB.paper,
    ice: mixRgb(TOKEN_RGB.paper, TOKEN_RGB.sea, 0.12),
  };
}

// —————————————————————— the world's voice ——————————————————————

/**
 * Each world sounds as a small chord read off its latent: root from the
 * terrain family, a color tone from the atmosphere, a fifth if it is
 * ringed. Deterministic — the same world always answers in the same
 * voice, which is how a hand learns to tell its worlds apart blind.
 */
export function worldChord(w: World): number[] {
  const root = 45 + Math.round(w.terrainHue * 12);
  const color = root + 3 + Math.round(w.atmoHue * 4);
  const chord = [root, color];
  if (w.ring > RING_MIN) chord.push(root + 7);
  return chord;
}

// ——————————————————— celestial mechanics (the room's law) ———————————————————
//
// Unit space: the field is a square of side 1 with the star at (0.5, 0.5),
// and time is measured in seconds of room time. The constants are tuned so
// that a world dropped a third of the field out takes something like half a
// minute to come round — slow enough to watch, fast enough to play.

/** Gravitational parameter of the star (G·M☉ in field units). */
export const STAR_MU = 0.0012;

/** G for world-on-world attraction — real, but a whisper beside the star. */
export const G_WORLD = 6e-4;

/** Plummer softening, field units: no singularity at contact. */
export const SOFTENING = 0.012;

/** Inside this radius a world falls into the star and is unmade. */
export const STAR_RADIUS = 0.045;

/** Speed of light for nothing here — just the fastest a hand may throw. */
export const MAX_SPEED = 0.5;

export type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravitational and inertial mass — the same number, as it should be. */
  mass: number;
  /** Collision radius in field units. */
  radius: number;
};

/** The circular-orbit speed at radius r about a body of parameter mu. */
export function circularSpeed(mu: number, r: number): number {
  return Math.sqrt(mu / Math.max(1e-6, r));
}

/** Vis-viva: the speed of an orbit of semi-major axis a at radius r. */
export function visViva(mu: number, r: number, a: number): number {
  const v2 = mu * (2 / Math.max(1e-6, r) - 1 / Math.max(1e-6, a));
  return Math.sqrt(Math.max(0, v2));
}

/**
 * One kick-drift step of the whole field: the star's pull plus every
 * world on every other, softened. Semi-implicit (symplectic) Euler —
 * kick then drift — because it conserves the shape of an orbit over long
 * play where plain Euler spirals outward and ruins the room in a minute.
 *
 * Mutates in place (the field is a live typed population, not a value),
 * and is otherwise pure: no time source, no randomness. `starAt` is the
 * star's centre; pass a zero `mu` for a starless test of pure mutual
 * gravity, where total momentum must be exactly conserved.
 */
export function stepBodies(
  bodies: Body[],
  dt: number,
  mu: number,
  starAt: { x: number; y: number },
  extraAx = 0,
  extraAy = 0,
): void {
  const n = bodies.length;
  const ax = new Array<number>(n).fill(extraAx);
  const ay = new Array<number>(n).fill(extraAy);
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    if (mu > 0) {
      const dx = starAt.x - b.x;
      const dy = starAt.y - b.y;
      const r2 = dx * dx + dy * dy + SOFTENING * SOFTENING;
      const inv = mu / (r2 * Math.sqrt(r2));
      ax[i] += dx * inv;
      ay[i] += dy * inv;
    }
    for (let j = i + 1; j < n; j++) {
      const o = bodies[j];
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      const r2 = dx * dx + dy * dy + SOFTENING * SOFTENING;
      const invr3 = 1 / (r2 * Math.sqrt(r2));
      // Equal and opposite — this symmetry is what conserves momentum.
      const f = G_WORLD * invr3;
      ax[i] += dx * f * o.mass;
      ay[i] += dy * f * o.mass;
      ax[j] -= dx * f * b.mass;
      ay[j] -= dy * f * b.mass;
    }
  }
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    b.vx += ax[i] * dt;
    b.vy += ay[i] * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) {
      b.vx *= MAX_SPEED / sp;
      b.vy *= MAX_SPEED / sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
}

/** Total linear momentum of the field — the invariant of mutual gravity. */
export function totalMomentum(bodies: Body[]): [number, number] {
  let px = 0;
  let py = 0;
  for (const b of bodies) {
    px += b.mass * b.vx;
    py += b.mass * b.vy;
  }
  return [px, py];
}

// ——————————————————— starlight: what an orbit does to a world ———————————————

/** Flux at distance r from a star of luminosity `lum`, inverse square. */
export function irradiance(r: number, lum = 1): number {
  return lum / Math.max(1e-4, r * r);
}

/**
 * Surface temperature as 0..1: the equilibrium law (T ∝ flux^¼) affinely
 * mapped so the whole playable field spans the interval — scorched inside
 * ~0.1, temperate around a quarter of the field, frozen past a third of
 * it. Strictly decreasing in distance across that whole span; it saturates
 * only where a world is already falling into the star or lost to the dark.
 */
const TEMP_GAIN = 0.3057;
const TEMP_BIAS = -0.232;
export function temperature01(r: number, lum = 1): number {
  return clamp01(Math.pow(irradiance(r, lum), 0.25) * TEMP_GAIN + TEMP_BIAS);
}

/**
 * How much atmosphere a world can hold: heavy and cold keeps it, light
 * and hot loses it — Jeans escape, in one line. Strictly increasing in
 * mass, strictly decreasing in temperature.
 */
export function atmosphereRetention(mass: number, temp: number): number {
  const escape = mass / MASS_MAX; // 0..1, the gravity well
  return clamp01(escape * 1.35 - temp * 0.85 + 0.12);
}

export type Climate = { ocean: number; ice: number; atmoDepth: number };

/**
 * The surface an orbit implies: water boils off near the star and freezes
 * far from it, so the ocean band sits in the middle and ice takes over
 * beyond it; the air is whatever gravity can keep.
 */
export function climateTarget(temp: number, retention: number): Climate {
  const boiled = smooth01((temp - 0.62) / 0.22); // too hot for a sea
  const frozen = smooth01((0.3 - temp) / 0.24); // too cold for a sea
  return {
    ocean: clamp01((1 - boiled) * (1 - frozen * 0.65) * retention),
    ice: clamp01(frozen * (0.35 + retention * 0.65)),
    atmoDepth: clamp01(retention),
  };
}

function smooth01(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

/** Per-second rate at which a surface answers the orbit it is in. */
export const CLIMATE_RATE = 0.16;

/**
 * Let a world settle toward the climate its orbit implies. Moves exactly
 * three latent coordinates — ocean, atmosphere depth, ice — monotonically
 * toward the target and never past it, at a bounded rate. Everything else
 * in the vector is untouched: an orbit change is a sculpt, not a re-roll.
 */
export function settleClimate(w: World, target: Climate, dtSec: number): World {
  const k = 1 - Math.exp(-CLIMATE_RATE * Math.max(0, dtSec));
  const l = latentFromWorld(w);
  l[1] += (target.ocean - l[1]) * k;
  l[5] += (target.atmoDepth - l[5]) * k;
  l[11] += (target.ice - l[11]) * k;
  return worldFromLatent(l, w.seed);
}

/**
 * How flat spin makes a body: the rotational bulge, ~ ω²R³/GM. Zero at
 * rest, monotone in spin, and capped well short of a body that flies apart.
 */
export const OBLATE_MAX = 0.19;
export function oblateness(spinRadPerSec: number, mass: number): number {
  const w2 = spinRadPerSec * spinRadPerSec;
  return clamp01((w2 * 0.02) / (mass + 1e-6)) * OBLATE_MAX;
}

/**
 * Tidal braking: a close world's day lengthens toward its year. Returns
 * the new spin, always between the old one and synchronous — never past
 * it, never spun up. Strength falls as the sixth power of distance, as
 * the real tide does.
 */
export function tidalSpin(
  spin: number,
  syncSpin: number,
  dist: number,
  dtSec: number,
): number {
  const d = Math.max(0.02, dist);
  const rate = clamp01(1.4e-7 / Math.pow(d, 6)) * Math.max(0, dtSec);
  const k = 1 - Math.exp(-rate);
  return spin + (syncSpin - spin) * k;
}

export type Merge = { world: World; ejecta: number };

/**
 * Two worlds become one. Mass adds; the latent is the mass-weighted mean
 * of the two points, so the child genuinely wears both parents; the seed
 * of the heavier survives, so its terrain lineage does too. What the
 * display band cannot hold comes back as ejecta — mass is never destroyed,
 * only scattered.
 */
export function mergeWorlds(a: World, b: World): Merge {
  const ma = massOf(a);
  const mb = massOf(b);
  const heavy = ma >= mb ? a : b;
  const total = ma + mb;
  const la = latentFromWorld(a);
  const lb = latentFromWorld(b);
  const l = la.map((v, i) => (v * ma + lb[i] * mb) / total);
  l[0] = (radiusForMass(total) - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
  const world = worldFromLatent(l, heavy.seed);
  return { world, ejecta: Math.max(0, total - massOf(world)) };
}
