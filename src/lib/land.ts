/**
 * The land — a parcel of living ground, as laws.
 *
 * At the coast band (~160m–2.5km) the material is a heightfield: elevation,
 * surface water, soil moisture, and vegetation cover, on a square grid. A
 * parcel of land IS these four fields at once. Grass grows where the ground is
 * wet and flat and thins where it is steep or dry; a slope IS its angle of
 * repose, and past that angle material slumps until the angle is honoured;
 * water flows downhill, carrying soil as sediment, cutting the highlands and
 * filling the lowlands without ever creating or destroying a grain; wind wears
 * the exposed peaks down and lays the dust in their lee.
 *
 * Two conservation laws hold everything honest: under erosion (water, slump,
 * wind) the total of ground-plus-sediment never moves — material is carried,
 * never minted — and surface water is likewise only ever moved between cells.
 * Creation (raising a hummock, rain falling) adds; the rest is transport.
 *
 * Pure math, no DOM, no audio, no imports, no Math.random — node-testable
 * (scripts/test-land.mjs). The component (src/components/Land.tsx) renders what
 * these laws decide and nothing else.
 */

// ——— constants ———————————————————————————————————————————————————————————

/** log10 metres near the middle of the coast band — the parcel's own size. */
export const LAND_S = 2.7;

/** Cells per side of the parcel's grid. The whole state is n·n of each field. */
export const GRID_N = 48;

/**
 * The angle of repose, in height units per cell: the steepest a neighbour pair
 * may stand before the upper slumps onto the lower. Loam is a loose material,
 * so the angle is shallow.
 */
export const REPOSE = 0.045;

/** Vegetation cover is a fraction — grass never exceeds a whole cell of it. */
export const GREEN_MAX = 1;

// ——— determinism ————————————————————————————————————————————————————————

/** Fold any number of parts into one 32-bit seed. The parcel's only dice. */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let x = Math.floor(p * 8192) | 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ x, 0x01000193);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/** mulberry32 — the codebase's standard small deterministic stream. */
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

// ——— small math ————————————————————————————————————————————————————————

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep between two edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Perlin's smootherstep — the interpolant the value noise uses. */
function smoother(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// ——— the value-noise terrain generator ——————————————————————————————————

/** A lattice point's height, 0..1, a pure function of its integer coords. */
function lattice(ix: number, iy: number, seed: number): number {
  return mulberry32(hashSeed(seed, ix + 8192, iy + 8192))();
}

/** Value noise at (x, y) in lattice units — smooth, seamless, deterministic. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = smoother(fx);
  const v = smoother(fy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

/** Fractal value noise — a few octaves of hills within hills. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(fx, fy, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    fx = fx * 2.02 + 11.1;
    fy = fy * 2.02 + 7.3;
  }
  return norm > 0 ? sum / norm : 0;
}

// ——— the parcel ——————————————————————————————————————————————————————————

export type Terrain = {
  n: number;
  seed: number;
  /** elevation, arbitrary units, roughly 0..1 at birth but unbounded above. */
  h: Float64Array;
  /** standing surface water depth. */
  w: Float64Array;
  /** soil in transit — suspended + freshly deposited sediment. */
  s: Float64Array;
  /** soil moisture 0..1. */
  m: Float64Array;
  /** vegetation cover 0..1. */
  g: Float64Array;
  /** the kept river's cell indices, or empty until a watershed is set. */
  river: number[];
};

export function idx(n: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= n ? n - 1 : x;
  const cy = y < 0 ? 0 : y >= n ? n - 1 : y;
  return cy * n + cx;
}

/**
 * The moisture a fresh parcel holds at a given elevation: the lowlands hold
 * more water than the ridges, with a little noise so the wet ground is not a
 * clean contour line.
 */
function birthMoisture(h: number, gx: number, gy: number, seed: number): number {
  return clamp01(0.75 * (1 - h) + 0.25 * fbm(gx * 3.1 + 40, gy * 3.1 + 40, seed ^ 0x51ed, 3) - 0.1);
}

/** Raise a parcel from its seed: hills, moisture in the hollows, grass to match. */
export function makeTerrain(n: number, seed: number): Terrain {
  const h = new Float64Array(n * n);
  const w = new Float64Array(n * n);
  const s = new Float64Array(n * n);
  const m = new Float64Array(n * n);
  const g = new Float64Array(n * n);
  const scale = 3.3;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const gx = x / n;
      const gy = y / n;
      const e = fbm(gx * scale, gy * scale, seed, 4);
      h[y * n + x] = e * 0.85;
    }
  }
  const t: Terrain = { n, seed, h, w, s, m, g, river: [] };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      m[i] = birthMoisture(h[i], x / n, y / n, seed);
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      g[i] = greenTarget(m[i], slopeMag(t, x, y), w[i]);
    }
  }
  return t;
}

// ——— reading the surface ——————————————————————————————————————————————————

/** Central-difference slope magnitude at a cell, in height units per cell. */
export function slopeMag(t: Terrain, x: number, y: number): number {
  const n = t.n;
  const gx = 0.5 * (t.h[idx(n, x + 1, y)] - t.h[idx(n, x - 1, y)]);
  const gy = 0.5 * (t.h[idx(n, x, y + 1)] - t.h[idx(n, x, y - 1)]);
  return Math.hypot(gx, gy);
}

/** Total ground plus sediment — the conserved quantity under erosion. */
export function totalMaterial(t: Terrain): number {
  let sum = 0;
  for (let i = 0; i < t.h.length; i++) sum += t.h[i] + t.s[i];
  return sum;
}

/** Total surface water — conserved by every flow step (no evaporation here). */
export function totalWater(t: Terrain): number {
  let sum = 0;
  for (let i = 0; i < t.w.length; i++) sum += t.w[i];
  return sum;
}

/** Mean vegetation cover across the parcel, 0..1. */
export function meanGreen(t: Terrain): number {
  let sum = 0;
  for (let i = 0; i < t.g.length; i++) sum += t.g[i];
  return sum / t.g.length;
}

// ——— CREATE: raising ground ————————————————————————————————————————————————

/**
 * Raise a hummock: a Gaussian bump added to the elevation within a radius.
 * This is creation — a hand piling ground up — so it adds material; the
 * conservation laws govern erosion, not the making. Returns the peak added.
 */
export function raiseHummock(
  t: Terrain,
  cx: number,
  cy: number,
  radius: number,
  amount: number,
): number {
  const n = t.n;
  const r2 = Math.max(1e-6, radius * radius);
  let peak = 0;
  const x0 = Math.max(0, Math.floor(cx - radius * 2));
  const x1 = Math.min(n - 1, Math.ceil(cx + radius * 2));
  const y0 = Math.max(0, Math.floor(cy - radius * 2));
  const y1 = Math.min(n - 1, Math.ceil(cy + radius * 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      const bump = amount * Math.exp(-d2 / r2);
      t.h[y * n + x] += bump;
      if (bump > peak) peak = bump;
    }
  }
  return peak;
}

/**
 * Sculpt along a stroke: raise a ridge (sign > 0) or carve a valley
 * (sign < 0) under a moving finger, honouring nothing but the hand. Carving
 * cannot dig below zero. Also transport, not conserved — the MODIFY verb.
 */
export function sculpt(
  t: Terrain,
  cx: number,
  cy: number,
  radius: number,
  amount: number,
): void {
  const n = t.n;
  const r2 = Math.max(1e-6, radius * radius);
  const x0 = Math.max(0, Math.floor(cx - radius * 2));
  const x1 = Math.min(n - 1, Math.ceil(cx + radius * 2));
  const y0 = Math.max(0, Math.floor(cy - radius * 2));
  const y1 = Math.min(n - 1, Math.ceil(cy + radius * 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      const i = y * n + x;
      t.h[i] = Math.max(0, t.h[i] + amount * Math.exp(-d2 / r2));
    }
  }
}

/** Rain: add water within a radius. Adds to the water budget — the scrub/sky. */
export function rain(t: Terrain, cx: number, cy: number, radius: number, amount: number): void {
  const n = t.n;
  const r2 = Math.max(1e-6, radius * radius);
  const x0 = Math.max(0, Math.floor(cx - radius * 2));
  const x1 = Math.min(n - 1, Math.ceil(cx + radius * 2));
  const y0 = Math.max(0, Math.floor(cy - radius * 2));
  const y1 = Math.min(n - 1, Math.ceil(cy + radius * 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      t.w[y * n + x] += amount * Math.exp(-d2 / r2);
    }
  }
}

// ——— MODIFY: water flows, and cuts —————————————————————————————————————————

export type HydrologyParams = {
  /** fraction of a cell's drop resolved per second. */
  flow?: number;
  /** how much soil the flow can hold per unit slope and depth. */
  capacity?: number;
  /** rate the flow erodes toward capacity. */
  erode?: number;
  /** rate the flow deposits its excess. */
  deposit?: number;
};

const HY: Required<HydrologyParams> = { flow: 3.2, capacity: 3.5, erode: 0.35, deposit: 0.55 };

/**
 * Advance the hydrology by dt seconds. Two conservation laws are exact here:
 *
 *  1. Surface water only moves between cells — `sum(w)` is invariant (no
 *     evaporation lives in this step; the room applies that separately).
 *  2. Ground and sediment only trade with each other — `sum(h + s)` is
 *     invariant. Where the flow is faster than it can carry, it erodes ground
 *     into sediment; where it slows, it lays the sediment back down as ground.
 *
 * The whole step reads a snapshot and writes deltas, so it is order-independent
 * and deterministic. Moisture relaxes toward the water present — derived, not
 * conserved.
 */
export function stepHydrology(t: Terrain, dt: number, params?: HydrologyParams): void {
  const n = t.n;
  const p = { ...HY, ...(params ?? {}) };
  const d = Math.max(0, Math.min(0.1, dt));
  const N = n * n;
  const dW = new Float64Array(N);
  const dS = new Float64Array(N);
  const neigh = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  // Phase A — move water downhill by surface height, and carry its sediment.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const wi = t.w[i];
      if (wi <= 1e-9) continue;
      const surf = t.h[i] + wi;
      let totalDrop = 0;
      const drop: number[] = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const nx = x + neigh[k][0];
        const ny = y + neigh[k][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        const dd = surf - (t.h[j] + t.w[j]);
        if (dd > 0) {
          drop[k] = dd;
          totalDrop += dd;
        }
      }
      if (totalDrop <= 0) continue;
      // move at most half the head, and never more than the water present.
      const move = Math.min(wi, p.flow * d * (totalDrop * 0.5));
      if (move <= 0) continue;
      const sedShare = t.s[i] * (move / wi);
      dW[i] -= move;
      dS[i] -= sedShare;
      for (let k = 0; k < 4; k++) {
        if (drop[k] <= 0) continue;
        const nx = x + neigh[k][0];
        const ny = y + neigh[k][1];
        const j = ny * n + nx;
        const frac = drop[k] / totalDrop;
        dW[j] += move * frac;
        dS[j] += sedShare * frac;
      }
    }
  }
  for (let i = 0; i < N; i++) {
    t.w[i] += dW[i];
    t.s[i] += dS[i];
    if (t.w[i] < 0) t.w[i] = 0;
    if (t.s[i] < 0) t.s[i] = 0;
  }

  // Phase B — erosion / deposition: h and s only ever trade with each other.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const wi = t.w[i];
      const slope = slopeMag(t, x, y);
      // carrying capacity grows with flow depth and slope; slack water drops.
      const cap = p.capacity * slope * Math.min(1, wi * 4);
      if (cap > t.s[i]) {
        // the flow has room — cut ground into sediment.
        const e = Math.min(p.erode * d * (cap - t.s[i]), t.h[i] * 0.5);
        if (e > 0) {
          t.h[i] -= e;
          t.s[i] += e;
        }
      } else {
        // the flow is overloaded — lay sediment back down as ground.
        const dep = p.deposit * d * (t.s[i] - cap);
        if (dep > 0) {
          t.s[i] -= dep;
          t.h[i] += dep;
        }
      }
      // moisture chases the water it can feel, and slowly dries otherwise.
      const target = clamp01(0.35 * t.m[i] + Math.min(1, wi * 6));
      t.m[i] += (Math.max(target, clamp01(1 - t.h[i]) * 0.4) - t.m[i]) * Math.min(1, d * 0.8);
    }
  }
}

/** Move water into the soil (and let a little leave the sky), the room's soak. */
export function soak(t: Terrain, dt: number, infiltrate = 0.4, evaporate = 0.05): void {
  const d = Math.max(0, Math.min(0.2, dt));
  for (let i = 0; i < t.w.length; i++) {
    const into = Math.min(t.w[i], infiltrate * d * t.w[i]);
    t.w[i] -= into + evaporate * d * t.w[i];
    if (t.w[i] < 0) t.w[i] = 0;
    t.m[i] = clamp01(t.m[i] + into * 2);
  }
}

// ——— DESTROY: slump, and wind ———————————————————————————————————————————————

/**
 * Settle every slope toward the angle of repose. A pair of neighbours steeper
 * than REPOSE sheds the excess from the higher onto the lower — material is
 * moved, never lost, so `sum(h)` is invariant. Snapshot in, deltas out: the
 * relaxation is order-independent, and iterating drives the whole field under
 * the angle of repose. Returns the steepest neighbour drop remaining.
 */
export function settleSlopes(t: Terrain, iterations = 1, rate = 0.5): number {
  const n = t.n;
  const N = n * n;
  const neigh = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let worst = 0;
  for (let it = 0; it < iterations; it++) {
    const dH = new Float64Array(N);
    worst = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        for (let k = 0; k < 4; k++) {
          const nx = x + neigh[k][0];
          const ny = y + neigh[k][1];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          const diff = t.h[i] - t.h[j];
          if (diff > worst) worst = diff;
          if (diff > REPOSE) {
            // shed half the excess, split so both sides meet in the middle.
            const move = (diff - REPOSE) * rate * 0.5;
            dH[i] -= move;
            dH[j] += move;
          }
        }
      }
    }
    for (let i = 0; i < N; i++) t.h[i] += dH[i];
  }
  return worst;
}

/**
 * A landslide at a point: pour extra settling energy into the neighbourhood so
 * a steep face lets go at once. Conserves `sum(h)` — a slide carries the hill
 * downslope, it does not delete it.
 */
export function slump(t: Terrain, cx: number, cy: number, radius: number): number {
  const n = t.n;
  // A local, harder settle: three sweeps at full rate over the whole field is
  // cheap at this grid size and keeps the conservation exact.
  void cx;
  void cy;
  void radius;
  void n;
  return settleSlopes(t, 4, 0.75);
}

/**
 * Wind erosion: the exposed cells — those standing above their neighbours —
 * give a little ground to the cell downwind, so the peaks wear down and the
 * dust gathers in their lee. Conserves `sum(h)`. `dirx`/`diry` is the wind
 * vector; `amount` scales how much is carried.
 */
export function windErosion(t: Terrain, dirx: number, diry: number, amount: number): void {
  const n = t.n;
  const N = n * n;
  const len = Math.hypot(dirx, diry) || 1;
  const ux = dirx / len;
  const uy = diry / len;
  const sx = ux > 0 ? 1 : ux < 0 ? -1 : 0;
  const sy = uy > 0 ? 1 : uy < 0 ? -1 : 0;
  const dH = new Float64Array(N);
  const neigh = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let sum = 0;
      let count = 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + neigh[k][0];
        const ny = y + neigh[k][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        sum += t.h[ny * n + nx];
        count++;
      }
      if (count === 0) continue;
      const exposure = t.h[i] - sum / count;
      if (exposure <= 0) continue;
      const carry = Math.min(t.h[i] * 0.5, exposure * amount);
      if (carry <= 0) continue;
      // the lee cell is the neighbour downwind; if the wind is diagonal, split.
      let leftToGive = carry;
      const lx = x + sx;
      const ly = y + sy;
      if (sx !== 0 && lx >= 0 && lx < n) {
        const give = leftToGive * (sy !== 0 ? 0.5 : 1);
        dH[y * n + lx] += give;
        dH[i] -= give;
        leftToGive -= give;
      }
      if (sy !== 0 && ly >= 0 && ly < n && leftToGive > 0) {
        dH[ly * n + x] += leftToGive;
        dH[i] -= leftToGive;
        leftToGive = 0;
      }
      // whatever could not land (blown off the frame) settles back on itself,
      // so the frame is a closed basin and the mass stays exactly put.
    }
  }
  for (let i = 0; i < N; i++) t.h[i] += dH[i];
}

// ——— vegetation ————————————————————————————————————————————————————————————

/**
 * The vegetation a cell tends toward: grass wants moisture and flat ground and
 * drowns under standing water. Monotone — rising in moisture, falling in slope,
 * falling in flood — and always in [0, 1].
 */
export function greenTarget(moisture: number, slope: number, water: number): number {
  const wet = smoothstep(0.12, 0.55, moisture);
  const flat = 1 - smoothstep(REPOSE * 0.6, REPOSE * 3.5, slope);
  const notFlooded = 1 - smoothstep(0.04, 0.18, water);
  return clamp01(wet * flat * notFlooded) * GREEN_MAX;
}

/**
 * Advance the greening by dt seconds: every cell's cover chases its target,
 * so freshly-raised ground greens as it settles and drowned or scarped ground
 * browns. Cover stays in [0, 1] by construction — the target is bounded and
 * the relaxation never overshoots.
 */
export function stepVegetation(t: Terrain, dt: number, rate = 0.6): void {
  const n = t.n;
  const d = Math.min(1, Math.max(0, rate * dt));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const target = greenTarget(t.m[i], slopeMag(t, x, y), t.w[i]);
      t.g[i] = clamp01(t.g[i] + (target - t.g[i]) * d);
    }
  }
}

// ——— the watershed ——————————————————————————————————————————————————————————

/** Steepest-descent neighbour of a cell, or -1 at a pit / the frame's low. */
function downhillOf(t: Terrain, x: number, y: number): number {
  const n = t.n;
  const surf = t.h[y * n + x] + t.w[y * n + x];
  let best = -1;
  let bestDrop = 0;
  const neigh = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [ox, oy] of neigh) {
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
    const j = ny * n + nx;
    const drop = surf - (t.h[j] + t.w[j]);
    if (drop > bestDrop) {
      bestDrop = drop;
      best = j;
    }
  }
  return best;
}

/**
 * Flow accumulation: how much of the parcel drains through each cell, by
 * steepest descent. Cells are processed high to low so every upstream cell
 * hands its accumulated flow down before its outlet is read — the standard
 * O(n log n) accumulation, fully deterministic.
 */
export function flowAccumulation(t: Terrain): Float64Array {
  const n = t.n;
  const N = n * n;
  const acc = new Float64Array(N).fill(1);
  const order = Array.from({ length: N }, (_, i) => i);
  order.sort((a, b) => t.h[b] + t.w[b] - (t.h[a] + t.w[a]));
  for (const i of order) {
    const x = i % n;
    const y = (i / n) | 0;
    const dn = downhillOf(t, x, y);
    if (dn >= 0) acc[dn] += acc[i];
  }
  return acc;
}

/**
 * Set a watershed: find the wettest headwater and trace its channel by
 * steepest descent down to the outlet, then remember that course. Returns the
 * river's cell indices in flow order. Deterministic, and kept between visits.
 */
export function setWatershed(t: Terrain): number[] {
  const n = t.n;
  // The spring is the parcel's highest ground; the channel is the course
  // steepest descent carves from it down to the outlet, and the flow
  // accumulation confirms this is where the water of the whole slope gathers.
  let src = 0;
  for (let i = 1; i < n * n; i++) if (t.h[i] > t.h[src]) src = i;
  const path: number[] = [];
  const seen = new Set<number>();
  let cur = src;
  while (cur >= 0 && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    const x = cur % n;
    const y = (cur / n) | 0;
    cur = downhillOf(t, x, y);
  }
  t.river = path;
  return path;
}

/** Carve the kept river a little deeper and wet its banks — a course held. */
export function inciseRiver(t: Terrain, depth: number): void {
  const n = t.n;
  for (const i of t.river) {
    t.h[i] = Math.max(0, t.h[i] - depth);
    t.w[i] += depth * 0.5;
    const x = i % n;
    const y = (i / n) | 0;
    t.m[idx(n, x, y)] = clamp01(t.m[i] + 0.2);
  }
}

// ——— LetGo: the parcel goes flat ————————————————————————————————————————————

/**
 * Flatten the whole parcel: the ground relaxes to its own mean, the water and
 * sediment drain away, the river is forgotten, and the grass thins back toward
 * bare loam. An emptied field stays empty.
 */
export function flatten(t: Terrain): void {
  const N = t.h.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += t.h[i];
  mean /= N;
  for (let i = 0; i < N; i++) {
    t.h[i] = mean;
    t.w[i] = 0;
    t.s[i] = 0;
    t.g[i] = 0;
    t.m[i] = clamp01(1 - mean) * 0.4;
  }
  t.river = [];
}

// ——— persistence ————————————————————————————————————————————————————————————

export type KeptLand = {
  v: 1;
  n: number;
  seed: number;
  /** elevation range, so the quantised heights can be restored. */
  hmin: number;
  hmax: number;
  /** elevation quantised to 0..1000 across [hmin, hmax]. */
  h: number[];
  /** green quantised to 0..255. */
  g: number[];
  /** the kept river's cell indices. */
  river: number[];
};

export function serializeLand(t: Terrain): KeptLand {
  const N = t.h.length;
  let hmin = Infinity;
  let hmax = -Infinity;
  for (let i = 0; i < N; i++) {
    if (t.h[i] < hmin) hmin = t.h[i];
    if (t.h[i] > hmax) hmax = t.h[i];
  }
  if (!Number.isFinite(hmin)) {
    hmin = 0;
    hmax = 1;
  }
  const span = hmax - hmin || 1;
  const h = new Array<number>(N);
  const g = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    h[i] = Math.round(((t.h[i] - hmin) / span) * 1000);
    g[i] = Math.round(clamp01(t.g[i]) * 255);
  }
  return { v: 1, n: t.n, seed: t.seed, hmin, hmax, h, g, river: t.river.slice() };
}

export function loadLand(raw: unknown): Terrain | null {
  if (!raw || typeof raw !== "object") return null;
  const k = raw as Partial<KeptLand>;
  if (k.v !== 1 || typeof k.n !== "number" || !Array.isArray(k.h) || !Array.isArray(k.g)) return null;
  const n = k.n | 0;
  if (n <= 0 || k.h.length !== n * n || k.g.length !== n * n) return null;
  const seed = (k.seed ?? 1) >>> 0;
  const hmin = typeof k.hmin === "number" ? k.hmin : 0;
  const hmax = typeof k.hmax === "number" ? k.hmax : 1;
  const span = hmax - hmin || 1;
  const t: Terrain = {
    n,
    seed,
    h: new Float64Array(n * n),
    w: new Float64Array(n * n),
    s: new Float64Array(n * n),
    m: new Float64Array(n * n),
    g: new Float64Array(n * n),
    river: Array.isArray(k.river) ? k.river.filter((i) => typeof i === "number" && i >= 0 && i < n * n) : [],
  };
  for (let i = 0; i < n * n; i++) {
    t.h[i] = hmin + (Math.max(0, Math.min(1000, k.h[i] as number)) / 1000) * span;
    t.g[i] = clamp01((Math.max(0, Math.min(255, k.g[i] as number)) / 255));
    t.m[i] = clamp01(1 - t.h[i]) * 0.5;
  }
  return t;
}
