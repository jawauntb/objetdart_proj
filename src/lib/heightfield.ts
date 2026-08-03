/**
 * heightfield — the wanderer above the sea of fog.
 *
 * The invariant of /olympus is two numbers: a heightfield seed and a fog
 * altitude. What is peak, what is island, what is drowned is a function of
 * those two and nothing else. This file is that function, written once in
 * arithmetic so the room can render it in GLSL and the suite can check it
 * in node — every law below is mirrored line-for-line by the fragment
 * shader in src/components/SeaOfFog.tsx, and the constants the two share
 * are injected into the shader source from here so they cannot drift.
 *
 * Three things earn their keep:
 *
 *  - **Analytic gradients.** `noised` returns a value AND its exact
 *    derivative, so the terrain normal is one evaluation rather than four
 *    taps of finite difference. A wrong analytic normal is invisible until
 *    the light is wrong everywhere, which is why it is the assertion the
 *    test suite leans hardest on (scripts/test-heightfield.mjs).
 *  - **A closed-form fog.** Density falls exponentially with height, so
 *    the optical depth along any straight ray integrates by hand. The
 *    marcher never touches the fog.
 *  - **A bounded march.** The step budget is a constant, the loop cannot
 *    exceed it, and the terrain is bounded above by HEIGHT_MAX_KM so a ray
 *    climbing away from the range can be abandoned the moment it clears the
 *    highest ground there can be.
 *
 * Everything is in kilometres — the olympus band runs 10^3.4 to 10^4.5 m,
 * a peak standing kilometres over a valley tens of kilometres wide.
 *
 * Pure math, no imports, no DOM. See docs/plans/life-and-vista-bands.md §2
 * and INSPIRATION.md §2.
 */

// ——— determinism ————————————————————————————————————————————————

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

/**
 * A seed is a translation of the noise field, nothing more — which is what
 * makes the same seed the same mountain, always, in JS and in GLSL alike
 * (the shader receives these two numbers as a uniform and never hashes).
 */
let offsetMemoSeed = NaN;
let offsetMemo: [number, number] = [0, 0];

export function seedOffset(seed: number): [number, number] {
  if (seed === offsetMemoSeed) return offsetMemo;
  const rng = mulberry32(hashSeed(seed, 0x0a1a));
  offsetMemoSeed = seed;
  offsetMemo = [(rng() - 0.5) * 4096, (rng() - 0.5) * 4096];
  return offsetMemo;
}

// ——— the noise basis: the water's own, given a derivative ————————
//
// hash21/vnoise are the house idiom, lifted unchanged from the sea
// (src/components/Sea.tsx, src/components/Ocean.tsx) so the fog and the
// water it resolves into are literally made of the same grain. The one
// refinement: a quintic fade instead of the cubic, because this field is
// differentiated rather than merely sampled, and the quintic's derivative
// vanishes at the cell walls — with the cubic, curvature would step across
// every lattice line and the shading would show it as a faint square grid.

function fract(v: number): number {
  return v - Math.floor(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function hash21(x: number, y: number): number {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}

/** Value noise in [0,1] with its exact gradient: [v, dv/dx, dv/dy]. */
export function noised(x: number, y: number): [number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
  const duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const k1 = b - a;
  const k2 = c - a;
  const k3 = a - b - c + d;
  return [a + k1 * ux + k2 * uy + k3 * ux * uy, dux * (k1 + k3 * uy), duy * (k2 + k3 * ux)];
}

// ——— the fold that makes a ridge ————————————————————————————————
//
// A mountain is not a hill with more octaves. The difference is one
// absolute value: reflect the noise about its middle and the smooth
// maximum becomes a crease. The transform is continuous everywhere and
// differentiable nowhere at the fold, and that kink IS the arête.

/** v ∈ [0,1] → [0,1], with its one maximum at the fold v = 1/2. */
export function ridgeFold(v: number): number {
  return 1 - Math.abs(2 * v - 1);
}

/** d(ridgeFold)/dv — ±2 either side of the fold, and 0 exactly on it. */
export function ridgeFoldSlope(v: number): number {
  const s = 2 * v - 1;
  return s === 0 ? 0 : s > 0 ? -2 : 2;
}

// ——— the field ————————————————————————————————————————————————

/** Octaves the marcher can afford per step. */
export const OCTAVES_MARCH = 5;
/** Octaves at the hit point, where one evaluation buys the whole normal. */
export const OCTAVES_SHADE = 7;
export const LACUNARITY = 2.06;
export const GAIN = 0.5;
/** Each octave is turned as well as scaled, so no ridge runs down an axis. */
export const OCTAVE_TURN = 0.573;
/** Cycles per kilometre at the first octave — a ~6 km ridge spacing. */
export const BASE_FREQ = 1 / 6.1;
/** The broad massif under the ridges: one wavelength every ~18 km. */
export const SWELL_RATIO = 0.34;
export const SWELL_OCTAVES = 3;
/** Peak-to-trough of the ridge system. */
export const RIDGE_AMP_KM = 1.95;
/**
 * The outcrop you are standing on, and how far it reaches. Narrow on
 * purpose: the ground has to fall away from under the eye within a hundred
 * metres, or the whole lower half of the frame is the rock at your feet
 * instead of the range — and the marcher wastes its budget on it.
 */
export const SUMMIT_KM = 1.15;
export const SUMMIT_RADIUS_KM = 0.62;
/**
 * The cone is rounded over this radius so it has a normal at its own apex —
 * which is also the twenty metres of rock the eye looks down onto, the one
 * piece of foreground in the frame.
 */
export const SUMMIT_EPS_KM = 0.02;
/** Eye height above the ground at the origin. */
export const EYE_KM = 0.0017;
/** The envelope the massif applies to the ridges: never zero, never over 1. */
export const ENVELOPE_FLOOR = 0.32;

export type Field = { v: number; dx: number; dy: number };

export const HORN_COUNT = 5;
export const HORN_SALT = 0x40a1;
/** Peak add on a ridge — tall enough to tower the inversion as a real horn. */
export const HORN_AMP_KM = 0.95;
export const HORN_AMP_JITTER = 0.22;
/** Narrow skirt so the silhouette reads as a pyramid, not a swell. */
export const HORN_RADIUS_KM = 0.72;
export const HORN_RADIUS_JITTER = 0.16;
export const HORN_EPS_KM = 0.014;
export const HORN_ANISO = 1.72;
export const HORN_POWER = 1.55;
export const HORN_RING_INNER_KM = 2.4;
export const HORN_RING_OUTER_KM = 7.8;
export const HORN_MIN_SEP_KM = 1.6;

export const CORNICE_CREASE_LO = 0.04;
export const CORNICE_CREASE_HI = 0.20;
export const CORNICE_SLOPE_LO = 0.38;
export const CORNICE_SLOPE_HI = 0.95;
export const WIND_SALT = 0x771d;

export const GLACIER_BELOW_SNOWLINE_KM = 0.24;
export const GLACIER_BAND_KM = 0.28;
export const GLACIER_VALLEY = 0.48;
export const GLACIER_SLOPE_MAX = 0.36;
export const SNOW_HOLD_KM = 0.30;
export const SNOW_SCOUR_ABOVE_KM = 0.52;
export const SNOW_SCOUR_WIDTH_KM = 0.22;
export const SNOW_SLOPE_K = 2.6;

/**
 * No ground anywhere can stand higher than this. Load-bearing: the marcher
 * abandons any ray that is above it and still climbing, so if the bound
 * were wrong the far peaks would be silently clipped out of the sky. Horns
 * spend the summit's headroom rather than expanding the covenant:
 * HORN_AMP_KM (0.95) ≤ SUMMIT_KM (1.15), and the horn ring never carries
 * the full outcrop, so ridge + horn stays under ridge + summit.
 */
export const HEIGHT_MAX_KM = RIDGE_AMP_KM + SUMMIT_KM;

export type Horn = {
  cx: number;
  cz: number;
  amp: number;
  radius: number;
  angle: number;
  aniso: number;
};

let hornsMemoSeed = NaN;
let hornsMemo: Horn[] = [];

export function hornsForSeed(seed: number): Horn[] {
  if (seed === hornsMemoSeed) return hornsMemo;
  // Hold an empty list while candidates are probed, so heightAt during
  // placement cannot recurse into this function and cannot credit horns
  // that have not been chosen yet.
  hornsMemoSeed = seed;
  hornsMemo = [];
  const rng = mulberry32(hashSeed(seed, HORN_SALT));
  const horns: Horn[] = [];
  for (let i = 0; i < HORN_COUNT; i++) {
    let cx = 0;
    let cz = 0;
    let bestH = -Infinity;
    // Several candidates per slot; keep the one that already stands on a
    // ridge. A horn in a valley is just a hill — the Matterhorn grows from
    // an arête.
    for (let attempt = 0; attempt < 10; attempt++) {
      const bearing = ((i + 0.5) * Math.PI * 2) / HORN_COUNT + (rng() - 0.5) * 0.7;
      const ring =
        HORN_RING_INNER_KM + rng() * (HORN_RING_OUTER_KM - HORN_RING_INNER_KM);
      const tx = Math.cos(bearing) * ring;
      const tz = Math.sin(bearing) * ring;
      const clear = horns.every((h) => Math.hypot(tx - h.cx, tz - h.cz) >= HORN_MIN_SEP_KM);
      if (!clear && attempt < 9) continue;
      // Ridge + summit only (horns memo is empty above) — prefer a crest.
      const probe = heightAt(tx, tz, seed, OCTAVES_MARCH);
      if (probe >= bestH) {
        bestH = probe;
        cx = tx;
        cz = tz;
      }
    }
    horns.push({
      cx,
      cz,
      amp: HORN_AMP_KM - rng() * HORN_AMP_JITTER,
      radius: HORN_RADIUS_KM + (rng() - 0.5) * 2 * HORN_RADIUS_JITTER,
      angle: rng() * Math.PI,
      aniso: HORN_ANISO * (0.92 + rng() * 0.16),
    });
  }
  hornsMemo = horns;
  return hornsMemo;
}

/**
 * A soft-L1 horn: the glacial pyramid, sharpened without ever losing a
 * derivative. The crease is devotional in the picture, operational in the
 * chain rule, oceanic in the way every face drains toward a bowl.
 */
export function hornField(x: number, z: number, horn: Horn): Field {
  const qx = x - horn.cx;
  const qz = z - horn.cz;
  const ca = Math.cos(horn.angle);
  const sa = Math.sin(horn.angle);
  const u = ca * qx - sa * qz;
  const v = sa * qx + ca * qz;
  const sx = horn.radius;
  const sz = horn.radius / horn.aniso;
  const au = Math.sqrt(u * u + HORN_EPS_KM * HORN_EPS_KM);
  const av = Math.sqrt(v * v + HORN_EPS_KM * HORN_EPS_KM);
  const invRoot2 = 1 / Math.sqrt(2);
  const rho = (au / sx + av / sz) * invRoot2;
  const h = horn.amp * Math.exp(-Math.pow(rho, HORN_POWER));
  const dhdr = -h * HORN_POWER * Math.pow(rho, HORN_POWER - 1);
  const dhdu = dhdr * (u / au) * (invRoot2 / sx);
  const dhdv = dhdr * (v / av) * (invRoot2 / sz);
  return { v: h, dx: dhdu * ca + dhdv * sa, dy: -dhdu * sa + dhdv * ca };
}

export function hornsAt(x: number, z: number, seed: number): Field {
  let v = 0;
  let dx = 0;
  let dy = 0;
  for (const horn of hornsForSeed(seed)) {
    const h = hornField(x, z, horn);
    v += h.v;
    dx += h.dx;
    dy += h.dy;
  }
  return { v, dx, dy };
}

/** Smooth fbm in [0,1] with its exact gradient (world-space per unit p). */
export function smoothFbm(x: number, y: number, octaves: number): Field {
  let v = 0;
  let dx = 0;
  let dy = 0;
  let amp = 1;
  let norm = 0;
  // The cumulative octave transform, as a 2x2 matrix, so the chain rule
  // through the per-octave rotation is exact rather than approximate.
  let m00 = 1;
  let m01 = 0;
  let m10 = 0;
  let m11 = 1;
  const c = Math.cos(OCTAVE_TURN) * LACUNARITY;
  const s = Math.sin(OCTAVE_TURN) * LACUNARITY;
  for (let i = 0; i < octaves; i++) {
    const px = m00 * x + m01 * y;
    const py = m10 * x + m11 * y;
    const [n, nx, ny] = noised(px, py);
    v += amp * n;
    dx += amp * (nx * m00 + ny * m10);
    dy += amp * (nx * m01 + ny * m11);
    norm += amp;
    amp *= GAIN;
    const a00 = c * m00 - s * m10;
    const a01 = c * m01 - s * m11;
    const a10 = s * m00 + c * m10;
    const a11 = s * m01 + c * m11;
    m00 = a00;
    m01 = a01;
    m10 = a10;
    m11 = a11;
  }
  return { v: v / norm, dx: dx / norm, dy: dy / norm };
}

export type RidgedField = Field & {
  /**
   * How far the two coarsest octaves sit from their folds, |2v−1|. Zero
   * means the point lies on a main arête; the room reads it as the crest
   * that catches the light.
   */
  crease: number;
  /**
   * How far the WHOLE field sits from the nearest fold, in units where one
   * unit is one unit of the octave's own coordinate — so a fine octave's
   * fold counts for as much as a coarse one's, because the gradient
   * contributions of the octaves are comparable (gain × lacunarity ≈ 1).
   *
   * This is the margin within which the surface genuinely has no normal.
   * The room never needs it; the suite does, to know exactly where a
   * finite difference is entitled to disagree with the analytic gradient
   * rather than tuning a tolerance until the assertion passes.
   */
  foldMargin: number;
};

/** Ridged fbm in [0,1] with its exact gradient away from the folds. */
export function ridgedFbm(x: number, y: number, octaves: number): RidgedField {
  let v = 0;
  let dx = 0;
  let dy = 0;
  let amp = 1;
  let norm = 0;
  let crease = 1;
  let foldMargin = Infinity;
  let octaveScale = 1;
  let m00 = 1;
  let m01 = 0;
  let m10 = 0;
  let m11 = 1;
  const c = Math.cos(OCTAVE_TURN) * LACUNARITY;
  const s = Math.sin(OCTAVE_TURN) * LACUNARITY;
  for (let i = 0; i < octaves; i++) {
    const px = m00 * x + m01 * y;
    const py = m10 * x + m11 * y;
    const [n, nx, ny] = noised(px, py);
    const r = ridgeFold(n);
    const g = ridgeFoldSlope(n);
    v += amp * r;
    dx += amp * g * (nx * m00 + ny * m10);
    dy += amp * g * (nx * m01 + ny * m11);
    norm += amp;
    const fold = Math.abs(2 * n - 1);
    if (i < 2) crease = Math.min(crease, fold);
    foldMargin = Math.min(foldMargin, fold / octaveScale);
    octaveScale *= LACUNARITY;
    amp *= GAIN;
    const a00 = c * m00 - s * m10;
    const a01 = c * m01 - s * m11;
    const a10 = s * m00 + c * m10;
    const a11 = s * m01 + c * m11;
    m00 = a00;
    m01 = a01;
    m10 = a10;
    m11 = a11;
  }
  return { v: v / norm, dx: dx / norm, dy: dy / norm, crease, foldMargin };
}

export type Ground = {
  /** Altitude in km. */
  h: number;
  /** ∂h/∂x and ∂h/∂z in km per km — dimensionless slope. */
  dhdx: number;
  dhdz: number;
  /** Nearness to a main arête, for the crest the light catches. */
  crease: number;
  /** Nearness to any fold at all — where the surface has no normal. */
  foldMargin: number;
  /** Ridged fbm value in [0,1]; low ground is the valley bowl cue. */
  ridge: number;
};

/**
 * The ground: ridges scaled by a broad massif, plus the outcrop the room
 * stands on at the origin. Every term is differentiated in closed form —
 * the product rule on the envelope, the gaussian on the summit — so the
 * normal comes free with the height.
 */
export function groundAt(x: number, z: number, seed: number, octaves = OCTAVES_SHADE): Ground {
  const [ox, oz] = seedOffset(seed);
  const px = (x + ox) * BASE_FREQ;
  const pz = (z + oz) * BASE_FREQ;
  const r = ridgedFbm(px, pz, octaves);
  const sw = smoothFbm(px * SWELL_RATIO, pz * SWELL_RATIO, SWELL_OCTAVES);

  const env = ENVELOPE_FLOOR + (1 - ENVELOPE_FLOOR) * sw.v;
  const denv = 1 - ENVELOPE_FLOOR;

  // ridge term
  const hR = RIDGE_AMP_KM * r.v * env;
  const dRx = RIDGE_AMP_KM * (r.dx * BASE_FREQ * env + r.v * denv * sw.dx * BASE_FREQ * SWELL_RATIO);
  const dRz = RIDGE_AMP_KM * (r.dy * BASE_FREQ * env + r.v * denv * sw.dy * BASE_FREQ * SWELL_RATIO);

  // The outcrop under the wanderer's feet. A cone, not a dome: a gaussian
  // is flat at its own apex, and standing 1.7 m above a flat apex fills the
  // whole lower frame with the rock you are on. The cone falls away at
  // SUMMIT_KM/SUMMIT_RADIUS_KM from the first metre, so the eye clears it
  // and the range opens; the rounding keeps it differentiable.
  const s = Math.sqrt(x * x + z * z + SUMMIT_EPS_KM * SUMMIT_EPS_KM);
  const g = SUMMIT_KM * Math.exp(-s / SUMMIT_RADIUS_KM);
  const dGx = (-g / SUMMIT_RADIUS_KM) * (x / s);
  const dGz = (-g / SUMMIT_RADIUS_KM) * (z / s);
  const horns = hornsAt(x, z, seed);

  return {
    h: hR + g + horns.v,
    dhdx: dRx + dGx + horns.dx,
    dhdz: dRz + dGz + horns.dy,
    crease: r.crease,
    foldMargin: r.foldMargin,
    ridge: r.v,
  };
}

export function heightAt(x: number, z: number, seed: number, octaves = OCTAVES_SHADE): number {
  return groundAt(x, z, seed, octaves).h;
}

/**
 * Where the wanderer's eye stands: 1.7 m above the summit.
 *
 * The `max` is load-bearing and was a real bug before it was a line. The
 * marcher walks a cheaper terrain than the shader draws, and at the origin
 * the two disagree by a few metres. Set the eye from the shading height
 * and on some seeds it starts BELOW the marching height — every ray then
 * hits ground on its first step, and the room opens on a wall of rock with
 * no error anywhere to explain it.
 */
export function eyeAltitude(seed: number): number {
  return (
    Math.max(heightAt(0, 0, seed, OCTAVES_MARCH), heightAt(0, 0, seed, OCTAVES_SHADE)) + EYE_KM
  );
}

export function eyePosition(seed: number): [number, number, number] {
  return [0, eyeAltitude(seed), 0];
}

/** The surface normal, from the gradient — never from four extra taps. */
export function normalAt(
  x: number,
  z: number,
  seed: number,
  octaves = OCTAVES_SHADE,
): [number, number, number] {
  const g = groundAt(x, z, seed, octaves);
  const nx = -g.dhdx;
  const ny = 1;
  const nz = -g.dhdz;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

// ——— the fog, integrated by hand ————————————————————————————————

/** How fast the fog thins with height. */
export const FOG_SCALE_HEIGHT_KM = 0.29;
/** Extinction per kilometre at the fog's own altitude. */
export const FOG_EXTINCTION = 3.1;
/** How far the fog top rolls above and below its altitude. */
export const FOG_WAVE_KM = 0.042;
/**
 * The integral is clamped here. Well past total darkness (e^-198), and the
 * point is not the physics: a ray sinking far into the fog would otherwise
 * return a non-finite optical depth, and one inf loose in a fragment
 * shader turns a whole region of the picture into NaN black.
 */
export const FOG_TAU_MAX = 64;

/** Density relative to the fog altitude: 1 at the top, thinning upward. */
export function fogDensity(y: number, fogAltitude: number): number {
  return Math.exp(-(y - fogAltitude) / FOG_SCALE_HEIGHT_KM);
}

/**
 * ∫₀^dist density(y0 + dirY·t) dt, exactly. An exponential in height is
 * an exponential along any straight line, so this is a closed form and the
 * marcher never has to sample the fog at all. Looking up from anywhere,
 * the whole column above weighs no more than H·density(y0) — which is why
 * the sky stays clear however deep the valley below is drowned.
 */
export function fogOpticalDepth(
  y0: number,
  dirY: number,
  dist: number,
  fogAltitude: number,
): number {
  const d = Math.max(0, dist);
  const H = FOG_SCALE_HEIGHT_KM;
  if (Math.abs(dirY) < 1e-7) return Math.min(FOG_TAU_MAX, d * fogDensity(y0, fogAltitude));
  const e0 = fogDensity(y0, fogAltitude);
  const e1 = fogDensity(y0 + dirY * d, fogAltitude);
  const tau = (H / dirY) * (e0 - e1);
  return Math.min(FOG_TAU_MAX, Math.max(0, tau));
}

/** What survives the fog over that path: 1 is clear, 0 is drowned. */
export function fogTransmittance(
  y0: number,
  dirY: number,
  dist: number,
  fogAltitude: number,
): number {
  return Math.exp(-FOG_EXTINCTION * fogOpticalDepth(y0, dirY, dist, fogAltitude));
}

/**
 * The top of the fog where it rolls — the shoreline of the archipelago.
 * The swell is additive and independent of the altitude, which is the
 * whole reason raising the fog can only ever drown more land.
 */
export function fogSurfaceAt(x: number, z: number, fogAltitude: number, phase = 0): number {
  const n = smoothFbm(x * 0.21 + phase * 0.05, z * 0.21 - phase * 0.03, 3).v;
  return fogAltitude + FOG_WAVE_KM * (n * 2 - 1);
}

/** Metres of fog over this ground; positive is drowned, negative is island. */
export function submergedDepth(
  x: number,
  z: number,
  fogAltitude: number,
  seed: number,
  phase = 0,
  octaves = OCTAVES_SHADE,
): number {
  return fogSurfaceAt(x, z, fogAltitude, phase) - heightAt(x, z, seed, octaves);
}

/** How the resting fog level is found: a quantile of the land around you. */
export const FOG_SAMPLES = 96;
export const FOG_QUANTILE = 0.58;
export const FOG_SAMPLE_INNER_KM = 1.1;
export const FOG_SAMPLE_OUTER_KM = 9;
/** How far one long breath draws the fog down from its rest. */
export const FOG_BREATH_KM = 0.65;

/**
 * Where the fog lies when nobody is breathing on it.
 *
 * Not a constant: a constant altitude would drown one seed's range
 * completely and leave the next one bare, because every seed's massif sits
 * at its own height. An inversion layer fills valleys to a level, so the
 * room finds that level the same way — the 65th percentile of the land in
 * a ring around the summit, sampled on a deterministic golden spiral. The
 * consequence is the one the room lives on: whatever the seed, some of the
 * range is always an archipelago.
 */
export function restingFogAltitude(seed: number): number {
  const hs: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < FOG_SAMPLES; i++) {
    const u = (i + 0.5) / FOG_SAMPLES;
    const r = FOG_SAMPLE_INNER_KM + (FOG_SAMPLE_OUTER_KM - FOG_SAMPLE_INNER_KM) * Math.sqrt(u);
    const a = i * golden;
    hs.push(heightAt(Math.cos(a) * r, Math.sin(a) * r, seed, OCTAVES_MARCH));
  }
  hs.sort((a, b) => a - b);
  const k = Math.min(hs.length - 1, Math.floor(FOG_QUANTILE * hs.length));
  return hs[k];
}

export function submerged(
  x: number,
  z: number,
  fogAltitude: number,
  seed: number,
  phase = 0,
  octaves = OCTAVES_SHADE,
): boolean {
  return submergedDepth(x, z, fogAltitude, seed, phase, octaves) > 0;
}

// ——— the march ————————————————————————————————————————————————

/** The budget, stated before the loop was written (plan §3). */
export const MARCH_STEPS = 64;
/** Bisections after the crossing is bracketed. */
export const MARCH_REFINE = 8;
export const MARCH_MAX_KM = 30;
export const MARCH_MIN_STEP_KM = 0.006;
/** Fraction of the height above ground the marcher dares to step. */
export const MARCH_RELAX = 0.42;
/** Floor on step size as a fraction of distance — how the far field is reached. */
export const MARCH_GROWTH = 0.085;

export type MarchHit = {
  hit: boolean;
  /** Distance along the ray, km. */
  t: number;
  /** Primary iterations spent — never more than MARCH_STEPS. */
  steps: number;
};

/**
 * A distance-bounded heightfield march. Steps grow with distance so 64 of
 * them reach 46 km; each is capped at MARCH_RELAX of the clearance so the
 * near field, where the eye actually looks, stays honest. Two exits are
 * free: past MARCH_MAX_KM there is nothing, and above HEIGHT_MAX_KM while
 * still climbing there can be nothing.
 */
export function marchTerrain(
  ro: [number, number, number],
  rd: [number, number, number],
  seed: number,
  octaves = OCTAVES_MARCH,
): MarchHit {
  let t = 0.02;
  let prevT = t;
  let steps = 0;
  for (let i = 0; i < MARCH_STEPS; i++) {
    steps++;
    const py = ro[1] + rd[1] * t;
    if (t > MARCH_MAX_KM) return { hit: false, t: MARCH_MAX_KM, steps };
    if (py > HEIGHT_MAX_KM && rd[1] >= 0) return { hit: false, t, steps };
    const h = heightAt(ro[0] + rd[0] * t, ro[2] + rd[2] * t, seed, octaves);
    const gap = py - h;
    if (gap < 0) {
      // Bracketed: the last step was above ground, this one below.
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < MARCH_REFINE; k++) {
        const mid = (lo + hi) * 0.5;
        const gy = ro[1] + rd[1] * mid;
        const gh = heightAt(ro[0] + rd[0] * mid, ro[2] + rd[2] * mid, seed, octaves);
        if (gy - gh < 0) hi = mid;
        else lo = mid;
      }
      return { hit: true, t: (lo + hi) * 0.5, steps };
    }
    prevT = t;
    t += Math.max(MARCH_MIN_STEP_KM, MARCH_RELAX * gap, MARCH_GROWTH * t);
  }
  return { hit: false, t: Math.min(t, MARCH_MAX_KM), steps };
}

// ——— the sun, and everything that follows it ————————————————————

export type SkyPalette = {
  /** Direct sunlight. */
  sun: [number, number, number];
  zenith: [number, number, number];
  horizon: [number, number, number];
  /** The fog's own colour — it is lit, not painted. */
  fog: [number, number, number];
  /** Sky fill on the shadowed faces. */
  ambient: number;
  /** Strength of the direct light. */
  sunI: number;
};

const NIGHT: SkyPalette = {
  sun: [0.16, 0.19, 0.3],
  zenith: [0.02, 0.028, 0.055],
  horizon: [0.055, 0.07, 0.115],
  fog: [0.055, 0.065, 0.1],
  ambient: 0.05,
  sunI: 0.05,
};
const DAWN: SkyPalette = {
  sun: [1.0, 0.44, 0.2],
  zenith: [0.1, 0.13, 0.26],
  horizon: [0.86, 0.44, 0.3],
  fog: [0.42, 0.3, 0.34],
  ambient: 0.2,
  sunI: 0.55,
};
const MORNING: SkyPalette = {
  sun: [1.0, 0.82, 0.62],
  zenith: [0.2, 0.36, 0.62],
  horizon: [0.72, 0.72, 0.72],
  fog: [0.7, 0.72, 0.76],
  ambient: 0.45,
  sunI: 0.95,
};
const HIGH: SkyPalette = {
  sun: [1.0, 0.97, 0.9],
  zenith: [0.24, 0.45, 0.8],
  horizon: [0.8, 0.86, 0.92],
  fog: [0.86, 0.89, 0.93],
  ambient: 0.62,
  sunI: 1.15,
};

/** Where night ends on the elevation axis, in radians below the horizon. */
export const SUN_NIGHT_ELEVATION = -0.34;
export const SUN_TOP_ELEVATION = 1.0;
/** The two interior anchors, as fractions of that span. */
const DAWN_U = 0.26;
const MORNING_U = 0.55;

function mix3(
  a: [number, number, number],
  b: [number, number, number],
  k: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * Sun elevation (radians) → the whole palette, from night through the
 * alpenglow into a high blue day. Three disjoint smoothstep segments over
 * anchors whose luminance only ever rises, so the picture cannot pop as
 * the sun crosses the horizon — the failure this map exists to prevent.
 */
export function paletteForSun(elevation: number): SkyPalette {
  const u = clamp01(
    (elevation - SUN_NIGHT_ELEVATION) / (SUN_TOP_ELEVATION - SUN_NIGHT_ELEVATION),
  );
  const k1 = smoothstep(0, DAWN_U, u);
  const k2 = smoothstep(DAWN_U, MORNING_U, u);
  const k3 = smoothstep(MORNING_U, 1, u);
  const lerp = (
    pick: (p: SkyPalette) => [number, number, number],
  ): [number, number, number] => {
    let c = mix3(pick(NIGHT), pick(DAWN), k1);
    c = mix3(c, pick(MORNING), k2);
    c = mix3(c, pick(HIGH), k3);
    return c;
  };
  const scalar = (pick: (p: SkyPalette) => number): number => {
    let v = pick(NIGHT) + (pick(DAWN) - pick(NIGHT)) * k1;
    v += (pick(MORNING) - v) * k2;
    v += (pick(HIGH) - v) * k3;
    return v;
  };
  return {
    sun: lerp((p) => p.sun),
    zenith: lerp((p) => p.zenith),
    horizon: lerp((p) => p.horizon),
    fog: lerp((p) => p.fog),
    ambient: scalar((p) => p.ambient),
    sunI: scalar((p) => p.sunI),
  };
}

export function luminance(c: [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Unit vector toward the sun from azimuth and elevation, both radians. */
export function sunDirection(azimuth: number, elevation: number): [number, number, number] {
  const ce = Math.cos(elevation);
  return [ce * Math.sin(azimuth), Math.sin(elevation), ce * Math.cos(azimuth)];
}

// ——— the season, and the snow it moves ————————————————————————

export const SNOWLINE_MID_KM = 1.38;
export const SNOWLINE_SWING_KM = 0.4;

/**
 * The snowline over the year. Periodic with period 1 by construction, so
 * turning the season a full circle brings the same mountain back — a
 * sawtooth here would crack the range open once per revolution.
 */
export function snowlineKm(season: number): number {
  return SNOWLINE_MID_KM + SNOWLINE_SWING_KM * Math.cos(season * Math.PI * 2);
}

export function windVector(seed: number): [number, number] {
  const rng = mulberry32(hashSeed(seed, WIND_SALT));
  const a = rng() * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

export function corniceStrength(
  crease: number,
  dhdx: number,
  dhdz: number,
  wind: [number, number],
): number {
  const slope = Math.hypot(dhdx, dhdz);
  const crest = 1 - smoothstep(CORNICE_CREASE_LO, CORNICE_CREASE_HI, crease);
  const steep = smoothstep(CORNICE_SLOPE_LO, CORNICE_SLOPE_HI, slope);
  const uphillX = slope > 0 ? dhdx / slope : 0;
  const uphillZ = slope > 0 ? dhdz / slope : 0;
  const lee = clamp01(-(wind[0] * uphillX + wind[1] * uphillZ));
  const strength = crest * steep * lee;
  return strength > 0 ? strength : 0;
}

export type TerrainMaterial = "rock" | "snow" | "glacier";
export type MaterialSample = {
  kind: TerrainMaterial;
  rock: number;
  snow: number;
  glacier: number;
  cornice: number;
};

export function materialFromGround(
  g: Ground,
  season: number,
  wind: [number, number],
): MaterialSample {
  const slope = Math.hypot(g.dhdx, g.dhdz);
  const snowKm = snowlineKm(season);
  const valleyW = 1 - smoothstep(0.4, 0.62, g.ridge);
  const gentle = 1 - smoothstep(GLACIER_SLOPE_MAX - 0.1, GLACIER_SLOPE_MAX + 0.14, slope);
  const iceAlt = smoothstep(
    snowKm - GLACIER_BELOW_SNOWLINE_KM - GLACIER_BAND_KM,
    snowKm - GLACIER_BELOW_SNOWLINE_KM,
    g.h,
  );
  const notCrest = smoothstep(0.06, 0.18, g.crease);
  let glacier = clamp01(valleyW * gentle * iceAlt * notCrest);

  const flat = 1 / (1 + slope * SNOW_SLOPE_K);
  const held = clamp01((g.h - snowKm) / SNOW_HOLD_KM) * flat;
  const scour = 1 - clamp01((g.h - (snowKm + SNOW_SCOUR_ABOVE_KM)) / SNOW_SCOUR_WIDTH_KM);
  let snow = clamp01(held * scour) * (1 - glacier);
  let rock = clamp01(1 - snow - glacier);

  const total = rock + snow + glacier;
  if (total > 0) {
    rock /= total;
    snow /= total;
    glacier /= total;
  } else {
    rock = 1;
    snow = 0;
    glacier = 0;
  }

  const cornice = corniceStrength(g.crease, g.dhdx, g.dhdz, wind) * (snow + glacier);
  const kind: TerrainMaterial =
    glacier >= snow && glacier >= rock ? "glacier" : snow >= rock ? "snow" : "rock";
  return { kind, rock, snow, glacier, cornice };
}

export function materialAt(
  x: number,
  z: number,
  seed: number,
  season: number,
  octaves = OCTAVES_SHADE,
): MaterialSample {
  return materialFromGround(groundAt(x, z, seed, octaves), season, windVector(seed));
}

// ——— the call, and what the range says back ————————————————————

/** Sound in cold mountain air, km per second. */
export const SOUND_KM_PER_S = 0.343;
/** Past this the range simply keeps the call — nothing waits forever. */
export const ECHO_MAX_KM = 2.4;
export const ECHO_NEAR_MIDI = 64;
export const ECHO_FAR_MIDI = 34;

/** There and back, in milliseconds. Real air, real distance, no scaling. */
export function echoDelayMs(distKm: number): number {
  return (2 * Math.max(0, distKm)) / SOUND_KM_PER_S * 1000;
}

/** The far wall answers deeper — distance heard as register. */
export function echoMidi(distKm: number): number {
  const u = clamp01(distKm / ECHO_MAX_KM);
  return Math.round(ECHO_NEAR_MIDI + (ECHO_FAR_MIDI - ECHO_NEAR_MIDI) * u);
}

export type Echo = { distKm: number; delayMs: number; midi: number };

/**
 * Call into the range along `rd` and find what answers. Null when the
 * nearest ground is beyond ECHO_MAX_KM or there is none — the wind takes
 * the call and nothing is ever scheduled for a time that will not come.
 */
export function callAnswer(
  ro: [number, number, number],
  rd: [number, number, number],
  seed: number,
): Echo | null {
  const hit = marchTerrain(ro, rd, seed);
  if (!hit.hit || hit.t > ECHO_MAX_KM) return null;
  return { distKm: hit.t, delayMs: echoDelayMs(hit.t), midi: echoMidi(hit.t) };
}

// ——— the wind, and the fog's hush ————————————————————————————————

export type WindVoice = { gain: number; hz: number };

/**
 * How the air sounds where you are standing. `exposure` is how far the
 * ground under you rises above the fog top, in km.
 *
 * Down inside the fog everything is muffled; step out of it and the wind
 * finds you; keep climbing and the air thins until the wind is a high,
 * quiet, almost airless thing. Loudest just above the fog line, never
 * louder the higher you go — the bug this shape exists to refuse.
 */
export function windVoice(exposureKm: number): WindVoice {
  const out = smoothstep(-0.12, 0.22, exposureKm);
  const thin = 1 - 0.62 * clamp01(exposureKm / 1.7);
  return { gain: out * thin, hz: 118 + 268 * clamp01(exposureKm / 1.8) };
}

// ——— the fog as a position on the axis ————————————————————————
//
// The second half of the invariant is not decoration: a fog that has risen
// over everything IS the sea, and a fog lying far below IS the map seen
// from above. The room glides its ambient register along this fraction, so
// drowning the range sounds like descending toward the coast.

/** 0 when the fog lies at the valley floor, 1 when it has taken the summit. */
export function fogRegisterFraction(fogAltitude: number): number {
  return clamp01(fogAltitude / HEIGHT_MAX_KM);
}

// ——— the survey lens ————————————————————————————————————————

/** Contour interval when the lens is raised, km. */
export const CONTOUR_INTERVAL_KM = 0.1;
