// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.domain_lib.title,
//           spec.domain_lib.brief, spec.invariant_type, spec.key.
// Filled by phase-6 track A — the field-invariant physics for /marsh.

/**
 * marshfield — the laws of /marsh.
 *
 * The invariant is a continuous scalar field of dissolved oxygen O(x, y)
 * over a shallow water surface, sampled on a coarse grid (GRID_W × GRID_H),
 * plus a small set of reed cores that produce oxygen and biofilm mats that
 * consume it. Every closed-form advance:
 *   1. The field diffuses laterally (5-point Laplacian, conductivity K_DIFF)
 *   2. Reeds inject oxygen into their neighborhood scaled by sunlight × height
 *   3. Biofilm mats consume oxygen from their neighborhood scaled by mass
 *
 * The load-bearing map is OXYGEN → PITCH, exactly invertible: a well-
 * oxygenated tile rings HIGH (fresh spring), a stagnant tile rings LOW.
 *
 * Pure math, no imports, no DOM — node-testable
 * (scripts/test-marshfield.mjs). See INSPIRATION.md §2 (maps between
 * representations) and §4 (aliveness down the stack).
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

export const clamp = (v: number, a: number, b: number): number =>
  v < a ? a : v > b ? b : v;
export const clamp01 = (v: number): number => clamp(v, 0, 1);

// ——— the invariant, and every process that only moves it ———————————

export type Reed = {
  id: number;
  x: number;
  y: number;
  height: number;
  phase: number;
  sealed: boolean;
};

export type BiofilmMat = {
  id: number;
  x: number;
  y: number;
  mass: number;
  phase: number;
};

export type Climate = {
  warmth: number;
  wet: number;
};

export type MarshState = {
  reeds: Reed[];
  mats: BiofilmMat[];
  /** oxygen field, GRID_W * GRID_H entries in row-major order, values 0..1 */
  oxygen: Float32Array;
  sunlight: number;
  tau: number;
  seedKey: number;
};

/** Never let a month away become a century. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;
/** How many bounded sub-steps a caller may spend on a scatter task. */
export const SCATTER_STEPS = 8;
/** Section bounds — outside is not marsh. */
export const POOL_X_MIN = 0.06;
export const POOL_X_MAX = 0.94;
export const POOL_Y_MIN = 0.14;
export const POOL_Y_MAX = 0.94;
/** Maximum reeds standing at once. */
export const MAX_REEDS = 20;
/** Maximum biofilm mats. */
export const MAX_MATS = 8;
/** A reed cannot grow past this — the biological ceiling. */
export const MAX_HEIGHT = 1;
/** A mat cannot grow past this. */
export const MAX_MASS = 1;

/** Oxygen field grid resolution. */
export const GRID_W = 16;
export const GRID_H = 12;
export const GRID_SIZE = GRID_W * GRID_H;

/** Diffusion conductivity of oxygen (per second, per unit area). */
export const K_DIFF = 0.4;
/** Reed oxygen production rate at height=1, sunlight=1 (per second). */
export const PROD = 0.6;
/** Biofilm oxygen consumption rate at mass=1 (per second). */
export const CONS = 0.5;
/** Radius (normalised) over which a reed injects oxygen into cells. */
export const REED_RADIUS = 0.12;
/** Radius over which a mat consumes oxygen. */
export const MAT_RADIUS = 0.14;
/** Base reed growth rate: `dh/dt = R_BASE * (1 - h) * localO`. */
export const R_BASE = 6e-4;
/** How many sub-steps advanceExact walks the ledger through for stability. */
export const SUB_STEPS = 60;

/** Base of the oxygen → pitch map: the pitch at oxygen=0. */
export const PITCH_BASE_HZ = 220;
/** Scale of the oxygen → pitch map. */
export const PITCH_SCALE_O = 0.5;

/** Threshold for the stir-oxygen sweep: intensity moves the field toward its mean by this fraction. */
export const STIR_STRENGTH = 0.65;

// ——— hoisted invariants (computed once at module load, not per call) ———

/** Flat row-major index into a GRID_W x GRID_H field. Shared, allocation-free. */
function gridIdx(i: number, j: number): number {
  return j * GRID_W + i;
}

/** Reed influence radius in grid units — REED_RADIUS * max(GRID_W, GRID_H) is invariant. */
const REED_RADIUS_GRID = REED_RADIUS * Math.max(GRID_W, GRID_H);
/** Mat influence radius in grid units — MAT_RADIUS * max(GRID_W, GRID_H) is invariant. */
const MAT_RADIUS_GRID = MAT_RADIUS * Math.max(GRID_W, GRID_H);

// ——— climate responses ————————————————————————————————————————————

export function sunlightRate(c: Climate): number {
  return clamp01(c.warmth);
}

export function matRate(c: Climate): number {
  return clamp01(c.wet);
}

// ——— the oxygen → pitch map, and its exact inverse ————————————————

export function ringHzFor(oxygen: number): number {
  const O = clamp01(oxygen);
  return PITCH_BASE_HZ * Math.pow(2, O / PITCH_SCALE_O);
}

export function oxygenForRingHz(hz: number): number {
  if (!(hz > 0)) return 0;
  return PITCH_SCALE_O * Math.log2(hz / PITCH_BASE_HZ);
}

// ——— grid helpers ————————————————————————————————————————————

/** Map a normalised (x, y) to an (ix, iy) integer grid coordinate. */
export function toGrid(x: number, y: number): { ix: number; iy: number } {
  const ix = clamp(Math.floor(x * GRID_W), 0, GRID_W - 1);
  const iy = clamp(Math.floor(y * GRID_H), 0, GRID_H - 1);
  return { ix, iy };
}

/** Bilinear sample of the oxygen field at (x, y). */
export function oxygenAt(state: MarshState, x: number, y: number): number {
  const fx = clamp01(x) * (GRID_W - 1);
  const fy = clamp01(y) * (GRID_H - 1);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const rx = fx - ix;
  const ry = fy - iy;
  const ix1 = Math.min(ix + 1, GRID_W - 1);
  const iy1 = Math.min(iy + 1, GRID_H - 1);
  const a = state.oxygen[gridIdx(ix, iy)];
  const b = state.oxygen[gridIdx(ix1, iy)];
  const c = state.oxygen[gridIdx(ix, iy1)];
  const d = state.oxygen[gridIdx(ix1, iy1)];
  return a * (1 - rx) * (1 - ry) + b * rx * (1 - ry) + c * (1 - rx) * ry + d * rx * ry;
}

// ——— observables ———————————————————————————————————————————————

/** Mean oxygen across every grid cell — the twist lens's barometer. */
export function meanOxygen(state: MarshState): number {
  let s = 0;
  for (let i = 0; i < state.oxygen.length; i++) s += state.oxygen[i];
  return s / state.oxygen.length;
}

/** Sum of biofilm mat masses — the consumption side of the ledger. */
export function matTotalMass(state: MarshState): number {
  let m = 0;
  for (const mat of state.mats) m += mat.mass;
  return m;
}

/** How many reeds have been sealed as mature stands. */
export function sealedCount(state: MarshState): number {
  let n = 0;
  for (const r of state.reeds) if (r.sealed) n++;
  return n;
}

/** Sum of reed heights — the production side of the ledger. */
export function totalReedHeight(state: MarshState): number {
  let h = 0;
  for (const r of state.reeds) h += r.height;
  return h;
}

// ——— the closed-form advance ——————————————————————————————————

/**
 * Advance the oxygen field, reeds, and mats by `seconds` under a stable
 * climate. Diffusion + reed production + biofilm consumption + reed growth
 * are all done in SUB_STEPS closed-form steps for stability. The field
 * clamps to [0, 1]; reeds and mats bounded likewise.
 */
export function advanceExact(
  state: MarshState,
  seconds: number,
  climate: Climate,
): MarshState {
  if (!(seconds > 0)) return state;
  const dt = Math.min(seconds, MAX_ELAPSED_S);
  // Adaptive sub-steps: the explicit 5-point Laplacian is only stable when
  // K_DIFF * subDt <= 0.2 (CFL condition for 2D diffusion). Use at least
  // SUB_STEPS, and more if the requested dt is long.
  const stableMaxSubDt = 0.2 / K_DIFF;
  const requiredSubSteps = Math.max(SUB_STEPS, Math.ceil(dt / stableMaxSubDt));
  const nSubSteps = requiredSubSteps;
  const subDt = dt / nSubSteps;
  const sunlight1 = sunlightRate(climate);
  // Sunlight relaxes toward its climate target on a 12-hour clock.
  const SUN_RELAX = 1 / (12 * 3600);
  const targetSun = sunlight1;
  const finalSunlight =
    targetSun + (state.sunlight - targetSun) * Math.exp(-SUN_RELAX * dt);
  const matConsScale = matRate(climate);

  const O = new Float32Array(state.oxygen);
  const O2 = new Float32Array(O.length);
  const reeds = state.reeds.map((r) => ({ ...r }));
  const mats = state.mats.map((m) => ({ ...m }));

  for (let step = 0; step < nSubSteps; step++) {
    // 5-point Laplacian diffusion
    for (let j = 0; j < GRID_H; j++) {
      for (let i = 0; i < GRID_W; i++) {
        const c = O[gridIdx(i, j)];
        const l = i > 0 ? O[gridIdx(i - 1, j)] : c;
        const r = i < GRID_W - 1 ? O[gridIdx(i + 1, j)] : c;
        const u = j > 0 ? O[gridIdx(i, j - 1)] : c;
        const d = j < GRID_H - 1 ? O[gridIdx(i, j + 1)] : c;
        const lap = l + r + u + d - 4 * c;
        O2[gridIdx(i, j)] = clamp01(c + K_DIFF * lap * subDt);
      }
    }
    // Copy back
    for (let k = 0; k < O.length; k++) O[k] = O2[k];

    // Reed production
    for (const reed of reeds) {
      const inject = PROD * sunlight1 * reed.height * subDt;
      // Weighted contribution to every cell in reed's radius.
      const cx = reed.x * GRID_W;
      const cy = reed.y * GRID_H;
      const rG = REED_RADIUS_GRID;
      const i0 = Math.max(0, Math.floor(cx - rG));
      const i1 = Math.min(GRID_W - 1, Math.ceil(cx + rG));
      const j0 = Math.max(0, Math.floor(cy - rG));
      const j1 = Math.min(GRID_H - 1, Math.ceil(cy + rG));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dxG = i + 0.5 - cx;
          const dyG = j + 0.5 - cy;
          const d2 = dxG * dxG + dyG * dyG;
          if (d2 > rG * rG) continue;
          const w = 1 - Math.sqrt(d2) / rG;
          O[gridIdx(i, j)] = clamp01(O[gridIdx(i, j)] + inject * w);
        }
      }
    }

    // Biofilm consumption
    for (const mat of mats) {
      const cons = CONS * matConsScale * mat.mass * subDt;
      const cx = mat.x * GRID_W;
      const cy = mat.y * GRID_H;
      const rG = MAT_RADIUS_GRID;
      const i0 = Math.max(0, Math.floor(cx - rG));
      const i1 = Math.min(GRID_W - 1, Math.ceil(cx + rG));
      const j0 = Math.max(0, Math.floor(cy - rG));
      const j1 = Math.min(GRID_H - 1, Math.ceil(cy + rG));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dxG = i + 0.5 - cx;
          const dyG = j + 0.5 - cy;
          const d2 = dxG * dxG + dyG * dyG;
          if (d2 > rG * rG) continue;
          const w = 1 - Math.sqrt(d2) / rG;
          O[gridIdx(i, j)] = clamp01(O[gridIdx(i, j)] - cons * w);
        }
      }
    }

    // Reed growth: h(t+dt) = h + R_BASE * (1 - h) * localO * dt (closed-form
    // for stability; the (1-h) makes it saturate)
    for (const reed of reeds) {
      if (reed.sealed) {
        reed.height = MAX_HEIGHT;
        continue;
      }
      const localO = sampleGrid(O, reed.x, reed.y);
      const dh = R_BASE * (MAX_HEIGHT - reed.height) * localO * subDt;
      reed.height = clamp(reed.height + dh, 0, MAX_HEIGHT);
    }
  }

  for (const reed of reeds) if (reed.sealed) reed.height = MAX_HEIGHT;

  return {
    ...state,
    reeds,
    mats,
    oxygen: O,
    sunlight: finalSunlight,
    tau: state.tau + dt,
  };
}

function sampleGrid(field: Float32Array, x: number, y: number): number {
  const fx = clamp01(x) * (GRID_W - 1);
  const fy = clamp01(y) * (GRID_H - 1);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const rx = fx - ix;
  const ry = fy - iy;
  const ix1 = Math.min(ix + 1, GRID_W - 1);
  const iy1 = Math.min(iy + 1, GRID_H - 1);
  const a = field[gridIdx(ix, iy)];
  const b = field[gridIdx(ix1, iy)];
  const c = field[gridIdx(ix, iy1)];
  const d = field[gridIdx(ix1, iy1)];
  return a * (1 - rx) * (1 - ry) + b * rx * (1 - ry) + c * (1 - rx) * ry + d * rx * ry;
}

// ——— what a hand does at a reed ————————————————————————————

export function inMarshBounds(x: number, y: number): boolean {
  return x >= POOL_X_MIN && x <= POOL_X_MAX && y >= POOL_Y_MIN && y <= POOL_Y_MAX;
}

export function nearestReed(
  state: MarshState,
  x: number,
  y: number,
  within = 0.12,
): Reed | null {
  let best: Reed | null = null;
  let bestD = within;
  for (const r of state.reeds) {
    const d = Math.hypot(r.x - x, r.y - y);
    if (d <= bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export function plantReed(state: MarshState, x: number, y: number): MarshState {
  if (!inMarshBounds(x, y)) return state;
  if (state.reeds.length >= MAX_REEDS) return state;
  let id = 1;
  for (const r of state.reeds) if (r.id >= id) id = r.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id))();
  const reed: Reed = {
    id,
    x: clamp01(x),
    y: clamp01(y),
    height: 0.05,
    phase,
    sealed: false,
  };
  return { ...state, reeds: [...state.reeds, reed] };
}

export function deepenReed(state: MarshState, id: number, dHeight: number): MarshState {
  const reeds = state.reeds.map((r) =>
    r.id === id && !r.sealed
      ? { ...r, height: clamp(r.height + dHeight, 0, MAX_HEIGHT) }
      : r,
  );
  return { ...state, reeds };
}

export function sealReed(state: MarshState, id: number): MarshState {
  const reeds = state.reeds.map((r) =>
    r.id === id ? { ...r, height: MAX_HEIGHT, sealed: true } : r,
  );
  return { ...state, reeds };
}

export function plantMat(
  state: MarshState,
  x: number,
  y: number,
  mass: number,
): MarshState {
  if (!inMarshBounds(x, y)) return state;
  if (state.mats.length >= MAX_MATS) return state;
  let id = 1;
  for (const m of state.mats) if (m.id >= id) id = m.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id + 1000))();
  const mat: BiofilmMat = {
    id,
    x: clamp01(x),
    y: clamp01(y),
    mass: clamp(mass, 0, MAX_MASS),
    phase,
  };
  return { ...state, mats: [...state.mats, mat] };
}

/**
 * Stir the oxygen field: every cell moves toward the field's current mean
 * by a fraction of intensity * STIR_STRENGTH. Mean is preserved exactly;
 * the gradient dissolves. The room's touch-reachable secret.
 */
export function stirOxygen(state: MarshState, intensity: number): MarshState {
  const i = clamp01(intensity);
  const factor = i * STIR_STRENGTH;
  const mean = meanOxygen(state);
  const O = new Float32Array(state.oxygen);
  for (let k = 0; k < O.length; k++) {
    O[k] = clamp01(O[k] + (mean - O[k]) * factor);
  }
  return { ...state, oxygen: O };
}

/**
 * A whole-marsh oxygen flush — the room's largest event (tier-5/n of the tap
 * ladder on a reed, or on open water). Every cell in the field is pulled
 * toward saturation by `strength` (0..1), and every biofilm mat — which
 * only holds ground by keeping the water around it stagnant — loses a
 * matching fraction of its mass: the same aeration that lifts the reeds'
 * pitch starves the mats that were feeding on the low-oxygen water. A real
 * reaction between the marsh's two populations, not two unrelated meters
 * moving together.
 */
export function flushMarsh(state: MarshState, strength: number): MarshState {
  const s = clamp01(strength);
  const O = new Float32Array(state.oxygen);
  for (let k = 0; k < O.length; k++) {
    O[k] = clamp01(O[k] + (1 - O[k]) * s * 0.7);
  }
  const mats = state.mats.map((m) => ({
    ...m,
    mass: clamp(m.mass * (1 - s * 0.55), 0, MAX_MASS),
  }));
  return { ...state, oxygen: O, mats };
}

/**
 * Add an oxygen impulse at (x, y) — the flick's ring wavefront. Bounded.
 */
export function pulseOxygen(
  state: MarshState,
  x: number,
  y: number,
  amount: number,
): MarshState {
  const O = new Float32Array(state.oxygen);
  const cx = clamp01(x) * GRID_W;
  const cy = clamp01(y) * GRID_H;
  const R = 3;
  const i0 = Math.max(0, Math.floor(cx - R));
  const i1 = Math.min(GRID_W - 1, Math.ceil(cx + R));
  const j0 = Math.max(0, Math.floor(cy - R));
  const j1 = Math.min(GRID_H - 1, Math.ceil(cy + R));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dxG = i + 0.5 - cx;
      const dyG = j + 0.5 - cy;
      const d = Math.sqrt(dxG * dxG + dyG * dyG);
      if (d > R) continue;
      const w = 1 - d / R;
      O[gridIdx(i, j)] = clamp01(O[gridIdx(i, j)] + amount * w);
    }
  }
  return { ...state, oxygen: O };
}

// ——— starter ————————————————————————————————————————————

export function initState(seed: number): MarshState {
  const rng = mulberry32(seed >>> 0);
  const oxygen = new Float32Array(GRID_SIZE);
  for (let k = 0; k < GRID_SIZE; k++) {
    oxygen[k] = 0.35 + rng() * 0.15;
  }
  let state: MarshState = {
    reeds: [],
    mats: [],
    oxygen,
    sunlight: 0.6 + rng() * 0.15,
    tau: 12 * 3600,
    seedKey: seed >>> 0,
  };
  // Plant a small starter set: three reeds at varied positions, one already
  // sealed as an anchor.
  const starters: { xf: number; yf: number; seal: boolean; h: number }[] = [
    { xf: 0.28, yf: 0.32, seal: true, h: 0.85 },
    { xf: 0.52, yf: 0.55, seal: false, h: 0.45 },
    { xf: 0.74, yf: 0.42, seal: false, h: 0.32 },
  ];
  for (const st of starters) {
    const x = POOL_X_MIN + (POOL_X_MAX - POOL_X_MIN) * st.xf;
    const y = POOL_Y_MIN + (POOL_Y_MAX - POOL_Y_MIN) * st.yf;
    state = plantReed(state, x, y);
    const last = state.reeds[state.reeds.length - 1];
    if (last) {
      state = {
        ...state,
        reeds: state.reeds.map((r) =>
          r.id === last.id ? { ...r, height: st.h } : r,
        ),
      };
      if (st.seal) state = sealReed(state, last.id);
    }
  }
  // A biofilm mat drifting across the middle.
  state = plantMat(state, 0.6, 0.65, 0.4);
  // Advance half a day so the field is already breathing when you arrive.
  return advanceExact(state, 12 * 3600, { warmth: 0.55, wet: 0.5 });
}
