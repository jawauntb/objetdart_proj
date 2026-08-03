/**
 * cosmicweb — the web that holds the light.
 *
 * The invariant is a dark-matter density field: a seeded skeleton of knots
 * and the filaments between them, read as a bounded scalar over the unit
 * cube. Everything /space shows or sounds is a readout of that one
 * invisible field. Galaxies are not scattered and then explained — they
 * exist exactly where the density stands above a threshold, so
 * `placeGalaxies` is a *measurement* of `densityAt` and nothing else. That
 * is the room's argument and the site's thesis in one function: the thing
 * doing the work was never the thing you could see.
 *
 * Three maps carry the field into other senses without losing it:
 *   density → sub-bass    (`subBassHzFor`, centred on the register the
 *                          scale axis assigns s ≈ 20 — 55 Hz, A1)
 *   density → morphology  (`morphologyOf`, the real morphology–density
 *                          relation: ellipticals in the cluster cores,
 *                          spirals along the filaments, irregulars out at
 *                          the void edge)
 *   density → time        (`grownDensity`, linear perturbation growth
 *                          about the field's own mean — wind the season
 *                          back far enough and the sky genuinely empties)
 *
 * NOTE ON THE OVERLAP WITH src/lib/manifold-field.ts. That file carries a
 * 2D seeded web for /manifold's fabric. This one is deliberately separate
 * rather than imported: both modules are import-free by law so they can be
 * loaded bare in node, and the two webs are not the same object — the
 * fabric's is a flat grain of ridges under a metric, this one is a three
 * dimensional volume with compactly-supported kernels you march a ray
 * through. The shared idea (jittered generator points, k-nearest ridges) is
 * about twenty lines; the physics either side of it is not.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-cosmicweb.mjs).
 * See docs/plans/life-and-vista-bands.md §2 and INSPIRATION.md §2.
 */

// ——— determinism ————————————————————————————————————————————————
// One seed is one universe, the same universe, every visit. Nothing here
// touches Math.random or the wall clock.

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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ——— the invisible: the skeleton ————————————————————————————————

export type Knot = { x: number; y: number; z: number; m: number };
export type Web = {
  knots: Knot[];
  /** Filaments as knot-index pairs [i, j] with i < j. */
  filaments: Array<[number, number]>;
};

/** Generator points per axis. 4 gives 64 knots and voids you can fall into. */
export const WEB_CELLS = 4;
/** How many neighbours each knot reaches for. Shared reaches dedupe. */
export const FILAMENT_K = 3;

/**
 * Kernel radii, in box units. Both kernels have COMPACT SUPPORT — exactly
 * zero beyond their radius — which is what makes a void a void rather than
 * a very faint everything, and what lets the grid builder below skip cells
 * without changing a single value.
 */
export const KNOT_RADIUS = 0.09;
export const FILAMENT_RADIUS = 0.045;
export const KNOT_WEIGHT = 1.35;
export const FILAMENT_WEIGHT = 0.9;

/**
 * The density kernel: smoothstep on the fraction of the radius remaining.
 * 1 at the centre, 0 at r and beyond, with zero slope at both ends so the
 * field is C¹ and a marched ray never sees a crease.
 */
export function kernel(d: number, r: number): number {
  if (!(r > 0)) return 0;
  if (d >= r) return 0;
  if (d <= 0) return 1;
  const t = 1 - d / r;
  return t * t * (3 - 2 * t);
}

/**
 * Distance from a point to a SEGMENT — not to the line it lies on. The
 * clamp on t is the whole content of this function: without it, everything
 * beyond a filament's end reads as if the filament ran on forever, and the
 * voids past the web's edges fill silently with light.
 */
export function segmentDistance(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const L2 = ex * ex + ey * ey + ez * ez;
  let t = L2 > 0 ? ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  const dz = pz - (az + ez * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Seeded generator points on a jittered grid — even coverage, no clumps —
 * each linked to its FILAMENT_K nearest neighbours. The ridge graph between
 * neighbouring cells is the filament skeleton the sky actually shows. Same
 * seed, identical knots and filaments, bit for bit, forever.
 */
export function buildWeb(seed: number, cells: number = WEB_CELLS): Web {
  const n = Math.max(2, Math.floor(cells));
  const rng = mulberry32(seed >>> 0);
  const step = 1 / n;
  const knots: Knot[] = [];
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        knots.push({
          x: (i + 0.18 + 0.64 * rng()) * step,
          y: (j + 0.18 + 0.64 * rng()) * step,
          z: (k + 0.18 + 0.64 * rng()) * step,
          m: 0.55 + 0.9 * rng(),
        });
      }
    }
  }
  const filaments: Array<[number, number]> = [];
  const seen = new Set<number>();
  const near: Array<{ j: number; d2: number }> = [];
  for (let i = 0; i < knots.length; i++) {
    near.length = 0;
    for (let j = 0; j < knots.length; j++) {
      if (j === i) continue;
      const dx = knots[j].x - knots[i].x;
      const dy = knots[j].y - knots[i].y;
      const dz = knots[j].z - knots[i].z;
      near.push({ j, d2: dx * dx + dy * dy + dz * dz });
    }
    near.sort((a, b) => a.d2 - b.d2);
    for (let k = 0; k < Math.min(FILAMENT_K, near.length); k++) {
      const a = Math.min(i, near[k].j);
      const b = Math.max(i, near[k].j);
      const key = a * knots.length + b;
      if (seen.has(key)) continue;
      seen.add(key);
      filaments.push([a, b]);
    }
  }
  return { knots, filaments };
}

/**
 * How much larger the dark-matter halo is than the light inside it. This
 * is the room's argument stated as a number: the same skeleton, the same
 * weights, a wider smoothing length — so the halo field is pointwise
 * greater than the luminous one and its support strictly contains it.
 * The invisible is everywhere the visible is, and a long way past it.
 */
export const HALO_SCALE = 1.9;

/** The unsaturated sum: knots and filaments, each through its own kernel. */
export function rawDensityAt(
  web: Web,
  x: number,
  y: number,
  z: number,
  radiusScale = 1,
): number {
  let raw = 0;
  const kr = KNOT_RADIUS * radiusScale;
  for (const k of web.knots) {
    const dx = k.x - x;
    const dy = k.y - y;
    const dz = k.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= kr * kr) continue;
    raw += KNOT_WEIGHT * k.m * kernel(Math.sqrt(d2), kr);
  }
  const r = FILAMENT_RADIUS * radiusScale;
  for (const [i, j] of web.filaments) {
    const a = web.knots[i];
    const b = web.knots[j];
    // The segment's bounding box, grown by the kernel radius. Rejecting
    // here is EXACT, not an approximation: the kernel is identically zero
    // outside r, so nothing that could contribute is ever skipped.
    if (x < (a.x < b.x ? a.x : b.x) - r || x > (a.x > b.x ? a.x : b.x) + r) continue;
    if (y < (a.y < b.y ? a.y : b.y) - r || y > (a.y > b.y ? a.y : b.y) + r) continue;
    if (z < (a.z < b.z ? a.z : b.z) - r || z > (a.z > b.z ? a.z : b.z) + r) continue;
    const d = segmentDistance(x, y, z, a.x, a.y, a.z, b.x, b.y, b.z);
    if (d >= r) continue;
    raw += FILAMENT_WEIGHT * kernel(d, r);
  }
  return raw;
}

/**
 * The field itself: raw/(1+raw), so any stacking of knots deforms the sky
 * but can never blow past 1. Exactly 0 in a true void (compact support),
 * approaching 1 in a cluster core.
 */
export function densityAt(
  web: Web,
  x: number,
  y: number,
  z: number,
  radiusScale = 1,
): number {
  const raw = rawDensityAt(web, x, y, z, radiusScale);
  return raw / (1 + raw);
}

// ——— the field, sampled: what the ray marcher reads ————————————
// The volume pass needs the field as a texture, so the grid must BE the
// field — same numbers, cell for cell — or the fog and the galaxies would
// be readouts of two different universes.

export const DENSITY_GRID = 64;

/**
 * `densityAt` evaluated at every cell centre of a grid³ lattice, built by
 * splatting each kernel into its own bounding box instead of asking every
 * cell about every filament. Because both kernels are exactly zero beyond
 * their radius, skipping cells outside the box changes nothing: the result
 * is identical to the brute-force sample, and the test proves it.
 */
export function buildDensityGrid(
  web: Web,
  grid: number = DENSITY_GRID,
  radiusScale = 1,
): Float32Array {
  const n = Math.max(2, Math.floor(grid));
  const raw = new Float32Array(n * n * n);
  const cell = 1 / n;
  const at = (v: number) => (v + 0.5) * cell;
  const lo = (v: number) => Math.max(0, Math.ceil(v / cell - 0.5));
  const hi = (v: number) => Math.min(n - 1, Math.floor(v / cell - 0.5));

  for (const k of web.knots) {
    const r = KNOT_RADIUS * radiusScale;
    for (let iz = lo(k.z - r); iz <= hi(k.z + r); iz++) {
      const dz = at(iz) - k.z;
      for (let iy = lo(k.y - r); iy <= hi(k.y + r); iy++) {
        const dy = at(iy) - k.y;
        for (let ix = lo(k.x - r); ix <= hi(k.x + r); ix++) {
          const dx = at(ix) - k.x;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= r) continue;
          raw[(iz * n + iy) * n + ix] += KNOT_WEIGHT * k.m * kernel(d, r);
        }
      }
    }
  }
  for (const [i, j] of web.filaments) {
    const a = web.knots[i];
    const b = web.knots[j];
    const r = FILAMENT_RADIUS * radiusScale;
    const minX = Math.min(a.x, b.x) - r;
    const maxX = Math.max(a.x, b.x) + r;
    const minY = Math.min(a.y, b.y) - r;
    const maxY = Math.max(a.y, b.y) + r;
    const minZ = Math.min(a.z, b.z) - r;
    const maxZ = Math.max(a.z, b.z) + r;
    for (let iz = lo(minZ); iz <= hi(maxZ); iz++) {
      const pz = at(iz);
      for (let iy = lo(minY); iy <= hi(maxY); iy++) {
        const py = at(iy);
        for (let ix = lo(minX); ix <= hi(maxX); ix++) {
          const px = at(ix);
          const d = segmentDistance(px, py, pz, a.x, a.y, a.z, b.x, b.y, b.z);
          if (d >= r) continue;
          raw[(iz * n + iy) * n + ix] += FILAMENT_WEIGHT * kernel(d, r);
        }
      }
    }
  }
  for (let i = 0; i < raw.length; i++) raw[i] = raw[i] / (1 + raw[i]);
  return raw;
}

/** Cell-centre coordinate of index i on a grid of n — the grid's own ruler. */
export function gridCellCenter(i: number, grid: number): number {
  return (i + 0.5) / grid;
}

/**
 * The field's mean over the box. The number matters twice: it is the fixed
 * point of the growth law below, and it must sit clear of
 * DENSITY_THRESHOLD or winding the season forward could *unlight* a galaxy.
 */
export const WEB_MEAN_DENSITY = 0.0559;

export function meanDensity(grid: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < grid.length; i++) sum += grid[i];
  return grid.length > 0 ? sum / grid.length : 0;
}

// ——— the visible: a readout, not a decoration ————————————————

export type Morphology = "spiral" | "elliptical" | "irregular";
export const MORPHOLOGIES: readonly Morphology[] = ["spiral", "elliptical", "irregular"];

/**
 * The morphology–density relation, which is a real thing the sky does:
 * ellipticals crowd the cluster cores where everything has already merged,
 * spirals keep their discs out along the filaments, and the ragged
 * irregulars sit furthest out where there was never enough to settle. So a
 * galaxy's *shape* is another readout of the invisible field, and the
 * latent only chooses inside the room the density leaves it.
 */
export const ELLIPTICAL_FLOOR = 0.45;
export const ELLIPTICAL_FULL = 0.8;
export const IRREGULAR_CEIL = 0.48;
export const IRREGULAR_FULL = 0.26;

export function morphologyOf(density: number, latent: number): Morphology {
  const d = clamp01(density);
  const u = clamp01(latent);
  const pE = clamp01((d - ELLIPTICAL_FLOOR) / (ELLIPTICAL_FULL - ELLIPTICAL_FLOOR));
  const pI = clamp01((IRREGULAR_CEIL - d) / (IRREGULAR_CEIL - IRREGULAR_FULL));
  if (u < pE) return "elliptical";
  if (u < pE + pI) return "irregular";
  return "spiral";
}

export type GalaxyLatent = {
  /** The die roll morphology reads, 0..1. */
  morphRoll: number;
  /** Disc orientation in the plane of the sprite, radians. */
  spin: number;
  /** 0 = face-on, 1 = edge-on. */
  tilt: number;
  /** 0..1 — apparent extent before density scales it. */
  size: number;
  /** 0..1 across the room's cold→warm palette. */
  hue: number;
  /** 2 or 3 or 4 arms, for the spirals. */
  arms: number;
  /** How tightly the arms wind. */
  wind: number;
};

/** A galaxy's whole private state, from the universe seed and its index. */
export function galaxyLatent(seed: number, index: number): GalaxyLatent {
  const rng = mulberry32(hashSeed(seed, index, 0x9e37));
  const morphRoll = rng();
  const spin = rng() * Math.PI * 2;
  const tilt = rng();
  const size = rng();
  const hue = rng();
  const arms = 2 + Math.floor(rng() * 3);
  const wind = 0.7 + rng() * 1.6;
  return { morphRoll, spin, tilt, size, hue, arms, wind };
}

export type Galaxy = {
  /**
   * The candidate index this galaxy came from — its identity in this
   * universe, keyed to the position rather than to how many galaxies
   * happened to precede it, so a galaxy keeps its shape and its name when
   * the threshold moves.
   */
  id: number;
  x: number;
  y: number;
  z: number;
  /** The invisible value that put it here. */
  density: number;
  morph: Morphology;
  latent: GalaxyLatent;
};

/**
 * Where the light switches on. Galaxies exist strictly above it — no
 * probability, no softening. That strictness is what makes the sky a
 * measurement of the field rather than a story about it.
 */
export const DENSITY_THRESHOLD = 0.34;
/**
 * The population is built once at a lower floor and then *lit* by the
 * threshold, so winding the season only changes which galaxies shine, never
 * where they are. Structure does not move when you look at it earlier.
 */
export const PLACEMENT_FLOOR = 0.2;
export const GALAXY_CANDIDATES = 9000;
export const MAX_GALAXIES = 4200;
/** How far off a filament's axis a candidate may be thrown, as a fraction
 *  of the kernel radius. Candidates are drawn near the web rather than
 *  uniformly through the box — not to bias what passes, but because a
 *  uniform box wastes 96% of its rolls on empty space and the filaments
 *  end up too thinly strung to read as strands. The threshold decides,
 *  exactly as before; only the sampling got cheaper. */
export const CANDIDATE_SPREAD = 0.62;
/** Share of candidates thrown along filaments rather than into knots. */
export const CANDIDATE_FILAMENT_SHARE = 0.74;

/**
 * A candidate point: a seeded stream that walks the skeleton, dropping
 * proposals along the filaments and into the knots. It knows nothing about
 * the threshold, which is what keeps the count monotone in it and gapless.
 */
export function candidateAt(web: Web, rng: () => number): { x: number; y: number; z: number } {
  const pick = rng();
  const dir = rng() * Math.PI * 2;
  const cosT = rng() * 2 - 1;
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const rr = Math.cbrt(rng());
  let cx: number;
  let cy: number;
  let cz: number;
  let reach: number;
  if (pick < CANDIDATE_FILAMENT_SHARE && web.filaments.length > 0) {
    const [i, j] = web.filaments[Math.min(web.filaments.length - 1, Math.floor(rng() * web.filaments.length))];
    const a = web.knots[i];
    const b = web.knots[j];
    const u = rng();
    cx = a.x + (b.x - a.x) * u;
    cy = a.y + (b.y - a.y) * u;
    cz = a.z + (b.z - a.z) * u;
    reach = FILAMENT_RADIUS * CANDIDATE_SPREAD;
  } else {
    const k = web.knots[Math.min(web.knots.length - 1, Math.floor(rng() * web.knots.length))];
    cx = k.x;
    cy = k.y;
    cz = k.z;
    reach = KNOT_RADIUS * CANDIDATE_SPREAD;
  }
  const d = rr * reach;
  return {
    x: Math.min(1, Math.max(0, cx + d * sinT * Math.cos(dir))),
    y: Math.min(1, Math.max(0, cy + d * sinT * Math.sin(dir))),
    z: Math.min(1, Math.max(0, cz + d * cosT)),
  };
}

/**
 * Candidates in a fixed seeded order; kept if the field stands above the
 * threshold there. The order does not depend on the threshold, which is
 * why the count is monotone in it and drops one galaxy at a time as it
 * rises — the sky is a level set of the field, exactly.
 */
export function placeGalaxies(
  web: Web,
  seed: number,
  threshold: number = PLACEMENT_FLOOR,
  candidates: number = GALAXY_CANDIDATES,
  cap: number = MAX_GALAXIES,
): Galaxy[] {
  const rng = mulberry32(hashSeed(seed, 0x6a1a));
  const out: Galaxy[] = [];
  for (let i = 0; i < candidates && out.length < cap; i++) {
    const { x, y, z } = candidateAt(web, rng);
    const density = densityAt(web, x, y, z);
    if (density <= threshold) continue;
    const latent = galaxyLatent(seed, i);
    out.push({
      id: i,
      x,
      y,
      z,
      density,
      morph: morphologyOf(density, latent.morphRoll),
      latent,
    });
  }
  return out;
}

// ——— the season: structure formation, run by hand ————————————

export const GROWTH_MIN = 0.15;
export const GROWTH_MAX = 1.75;

/**
 * Linear perturbation growth: δ(t) = D(t)·δ₀, with δ the contrast about
 * the field's own mean. D = 1 is now; D → 0 is the smooth early universe,
 * where nothing anywhere stands above the threshold and the sky is empty
 * of galaxies while the dark matter is still all there. That emptiness is
 * the argument stated as a verb.
 */
export function grownDensity(density: number, growth: number): number {
  const v = WEB_MEAN_DENSITY + (density - WEB_MEAN_DENSITY) * growth;
  return clamp01(v);
}

/** Is this galaxy shining in this season? */
export function isLit(density: number, growth: number, threshold: number = DENSITY_THRESHOLD): boolean {
  return grownDensity(density, growth) > threshold;
}

export function litCount(
  galaxies: readonly Galaxy[],
  growth: number,
  threshold: number = DENSITY_THRESHOLD,
): number {
  let n = 0;
  for (const g of galaxies) if (isLit(g.density, growth, threshold)) n += 1;
  return n;
}

// ——— the field, heard ————————————————————————————————————————
// The lowest register on the axis. `spectralRegisterFor` puts s = 20 at
// 27.5·2^((1−6/7)·7) = 55 Hz exactly — A1 — breathing once every ~48 s.
// This room does not invent a register; it spreads the density across the
// one the axis already assigned it.

/** The room's listening post on the manifold, log10 metres. */
export const WEB_SCALE_S = 20;
/** spectralRegisterFor(20).baseHz, to the last digit. */
export const WEB_BASE_HZ = 55;
/** spectralRegisterFor(20).lfoHz = 1.8·2^(−7.5·6/7). One breath ≈ 48 s. */
export const WEB_LFO_HZ = 1.8 * Math.pow(2, -45 / 7);
/** How many octaves the whole density range spans, centred on the register. */
export const SUB_BASS_SPAN = 1.6;
/** Below this the ear stops hearing pitch and starts hearing pressure. */
export const AUDIBLE_FLOOR_HZ = 20;
export const SUB_BASS_MAX_HZ = WEB_BASE_HZ * Math.pow(2, SUB_BASS_SPAN / 2);
export const SUB_BASS_MIN_HZ = WEB_BASE_HZ * Math.pow(2, -SUB_BASS_SPAN / 2);

/**
 * Density → sub-bass, strictly DECREASING: a heavier well rings lower, the
 * way a bigger bell does. The median of the field lands exactly on the
 * band's own fundamental, so a galaxy in an ordinary filament sounds the
 * note the scale axis says this place is.
 */
export function subBassHzFor(density: number): number {
  return WEB_BASE_HZ * Math.pow(2, (0.5 - clamp01(density)) * SUB_BASS_SPAN);
}

/** The same note as a midi number, for the shared audio bus. */
export function subBassMidiFor(density: number): number {
  return 69 + 12 * Math.log2(subBassHzFor(density) / 440);
}

// ——— novae: rare, deterministic, on the shared clock ————————————

/** The clock is quantised so a nova is an event, not a probability field. */
export const NOVA_TICK_SEC = 2.5;
/** Per tick. One nova about every 40 s of a room nobody is touching. */
export const NOVA_RATE = 1 / 16;
export const NOVA_LIFE_SEC = 5.5;

export type Nova = { galaxy: number; strength: number; age: number };

export function novaTickAt(t: number): number {
  return Math.floor(Math.max(0, t) / NOVA_TICK_SEC);
}

/**
 * Whether tick `k` carried a nova, and which galaxy took it. A pure
 * function of (seed, tick) — the same second of the same universe always
 * burns the same star, whether you were watching or not.
 */
export function novaAt(seed: number, tick: number, population: number): Nova | null {
  if (population <= 0) return null;
  const rng = mulberry32(hashSeed(seed, tick, 0x4e07));
  if (rng() >= NOVA_RATE) return null;
  const galaxy = Math.min(population - 1, Math.floor(rng() * population));
  return { galaxy, strength: 0.55 + 0.45 * rng(), age: 0 };
}

/** How many ticks back a nova can still be burning. */
export const NOVA_SCAN_TICKS = Math.ceil(NOVA_LIFE_SEC / NOVA_TICK_SEC) + 1;

/** Every nova still alight at time t, newest last. Bounded by NOVA_SCAN_TICKS. */
export function activeNovae(seed: number, t: number, population: number): Nova[] {
  const now = Math.max(0, t);
  const k0 = novaTickAt(now);
  const out: Nova[] = [];
  for (let k = k0 - NOVA_SCAN_TICKS + 1; k <= k0; k++) {
    if (k < 0) continue;
    const n = novaAt(seed, k, population);
    if (!n) continue;
    const age = now - k * NOVA_TICK_SEC;
    if (age < 0 || age > NOVA_LIFE_SEC) continue;
    out.push({ ...n, age });
  }
  return out;
}

/** A nova's brightness over its life: a fast rise, a long fall, ending at 0. */
export function novaBrightness(age: number, strength: number): number {
  if (age < 0 || age > NOVA_LIFE_SEC) return 0;
  const u = age / NOVA_LIFE_SEC;
  const rise = Math.min(1, u / 0.08);
  const fall = Math.pow(1 - u, 1.8);
  return clamp01(strength * rise * fall);
}
