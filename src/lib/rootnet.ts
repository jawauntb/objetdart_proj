// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.domain_lib.title,
//           spec.domain_lib.brief, spec.invariant_type, spec.key.
// One LLM slot below carries the actual physics; the prelude is verbatim.

/**
 * rootnet — the laws of /root.
 *
 * The invariant is a rooted directed tree of nodes anchored under a plant
 * crown, each node carrying a scalar water and a scalar sugar. Every parent-
 * child edge transports water UP and sugar DOWN in closed form; only tips
 * (childless nodes) grow, and only where local sugar × water is high. The
 * load-bearing sensory map is DEPTH → PITCH, exactly invertible: a shallow
 * tip rings HIGH, a deep tip rings LOW.
 *
 * Pure math, no imports, no DOM — node-testable
 * (scripts/test-rootnet.mjs). See INSPIRATION.md §2 (maps
 * between representations) and §4 (aliveness down the stack), and
 * docs/new-room.md §4.
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

/** A single root node in the directed tree. */
export type RootNode = {
  id: number;
  x: number;
  y: number;
  parentId: number | null;
  generation: number;
  water: number;
  sugar: number;
  growth: number;
  phase: number;
  sealed: boolean;
};

export type Climate = {
  warmth: number;
  wet: number;
};

export type RootState = {
  nodes: RootNode[];
  soilWater: number;
  sunlight: number;
  tau: number;
  seedKey: number;
};

/** Never let a month away become a century. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;
export const SCATTER_STEPS = 8;
export const POOL_X_MIN = 0.06;
export const POOL_X_MAX = 0.94;
export const CROWN_Y = 0.14;
export const POOL_Y_MIN = CROWN_Y;
export const POOL_Y_MAX = 0.96;
export const MAX_NODES = 24;
export const MAX_GROWTH = 1;
export const MAX_GENERATION = 6;

/** Water conductance along one edge, per second. */
export const C_WATER = 0.02;
/** Sugar conductance along one edge, per second. */
export const C_SUGAR = 0.015;
/** Soil water enters every tip at rate SOIL_C * soilWaterAt(y) * (1 - w). */
export const SOIL_C = 0.05;
/** Sunlight enters the crown at rate SUN_C * sunlight * (1 - u_crown). */
export const SUN_C = 0.08;
/** Base growth rate: r_eff = R_BASE * water * sugar; saturates fast at 1,1. */
export const R_BASE = 8e-4;

export const PITCH_BASE_HZ = 660;
export const PITCH_SCALE_Y = 0.5;

export const KNOCK_THRESHOLD = 0.5;
export const KNOCK_KAPPA = 0.7;

// ——— climate responses ————————————————————————————————————————————

export function sunlightRate(c: Climate): number {
  return clamp01(c.warmth);
}

export function soilWaterRate(c: Climate): number {
  return clamp01(c.wet);
}

/** Soil water at a given depth; deeper y sees more of the aquifer. */
export function soilWaterAt(y: number, soilWater: number): number {
  const yFrac = clamp01((y - CROWN_Y) / Math.max(1e-6, POOL_Y_MAX - CROWN_Y));
  return clamp01(soilWater) * (0.35 + 0.65 * yFrac);
}

// ——— the depth → pitch map, and its exact inverse ————————————————

export function ringHzFor(y: number): number {
  const depth = clamp(y - CROWN_Y, 0, POOL_Y_MAX - CROWN_Y);
  return PITCH_BASE_HZ * Math.pow(2, -depth / PITCH_SCALE_Y);
}

export function depthForRingHz(hz: number): number {
  if (!(hz > 0)) return CROWN_Y;
  return CROWN_Y - PITCH_SCALE_Y * Math.log2(hz / PITCH_BASE_HZ);
}

// ——— observables ———————————————————————————————————————————————

export function meanWater(state: RootState): number {
  if (state.nodes.length === 0) return 0;
  let s = 0;
  for (const n of state.nodes) s += n.water;
  return s / state.nodes.length;
}

export function meanSugar(state: RootState): number {
  if (state.nodes.length === 0) return 0;
  let s = 0;
  for (const n of state.nodes) s += n.sugar;
  return s / state.nodes.length;
}

export function sealedCount(state: RootState): number {
  let n = 0;
  for (const node of state.nodes) if (node.sealed) n++;
  return n;
}

export function treeDepth(state: RootState): number {
  let d = CROWN_Y;
  for (const n of state.nodes) if (n.y > d) d = n.y;
  return d;
}

export function totalRootLength(state: RootState): number {
  let L = 0;
  const byId = new Map<number, RootNode>();
  for (const n of state.nodes) byId.set(n.id, n);
  for (const n of state.nodes) {
    if (n.parentId === null) continue;
    const p = byId.get(n.parentId);
    if (!p) continue;
    L += Math.hypot(n.x - p.x, n.y - p.y);
  }
  return L;
}

export function tips(state: RootState): RootNode[] {
  const childrenOf = new Set<number>();
  for (const n of state.nodes) if (n.parentId !== null) childrenOf.add(n.parentId);
  return state.nodes.filter((n) => !childrenOf.has(n.id));
}

// ——— the closed-form advance ——————————————————————————————————

export function advanceExact(
  state: RootState,
  seconds: number,
  climate: Climate,
): RootState {
  if (!(seconds > 0)) return state;
  const dt = Math.min(seconds, MAX_ELAPSED_S);
  const byId = new Map<number, RootNode>();
  for (const n of state.nodes) byId.set(n.id, { ...n });
  const nodes = [...byId.values()];

  const SUN_RELAX = 1 / (12 * 3600);
  const relax = Math.exp(-SUN_RELAX * dt);
  const targetSun = sunlightRate(climate);
  const sunlight1 = targetSun + (state.sunlight - targetSun) * relax;
  const targetSoil = soilWaterRate(climate);
  const soilWater1 = targetSoil + (state.soilWater - targetSoil) * relax;

  const nSubSteps = 60;
  const subDt = dt / nSubSteps;
  const tipMap = new Set<number>();
  {
    const childrenOf = new Set<number>();
    for (const n of nodes) if (n.parentId !== null) childrenOf.add(n.parentId);
    for (const n of nodes) if (!childrenOf.has(n.id)) tipMap.add(n.id);
  }
  for (let step = 0; step < nSubSteps; step++) {
    for (const n of nodes) {
      if (n.parentId === null) continue;
      const p = byId.get(n.parentId);
      if (!p) continue;
      const dw = C_WATER * (n.water - p.water) * subDt;
      const halved = dw * 0.5;
      n.water = clamp01(n.water - halved);
      p.water = clamp01(p.water + halved);

      const du = C_SUGAR * (p.sugar - n.sugar) * subDt;
      const halvedU = du * 0.5;
      p.sugar = clamp01(p.sugar - halvedU);
      n.sugar = clamp01(n.sugar + halvedU);
    }
    for (const n of nodes) {
      if (!tipMap.has(n.id)) continue;
      const s = soilWaterAt(n.y, soilWater1);
      const dwSoil = SOIL_C * s * (1 - n.water) * subDt;
      n.water = clamp01(n.water + dwSoil);
    }
    for (const n of nodes) {
      if (n.parentId !== null) continue;
      const duSun = SUN_C * sunlight1 * (1 - n.sugar) * subDt;
      n.sugar = clamp01(n.sugar + duSun);
    }
    for (const n of nodes) {
      if (!tipMap.has(n.id)) continue;
      if (n.sealed) {
        n.growth = MAX_GROWTH;
        continue;
      }
      const rEff = R_BASE * n.water * n.sugar;
      n.growth = MAX_GROWTH - (MAX_GROWTH - n.growth) * Math.exp(-rEff * subDt);
      if (n.growth < 0) n.growth = 0;
      if (n.growth > MAX_GROWTH) n.growth = MAX_GROWTH;
    }
  }
  for (const n of nodes) if (n.sealed) n.growth = MAX_GROWTH;

  return {
    ...state,
    nodes,
    soilWater: soilWater1,
    sunlight: sunlight1,
    tau: state.tau + dt,
  };
}

// ——— what a hand does at a node ————————————————————————————

export function inSectionBounds(x: number, y: number): boolean {
  return x >= POOL_X_MIN && x <= POOL_X_MAX && y >= CROWN_Y && y <= POOL_Y_MAX;
}

export function nearestNode(
  state: RootState,
  x: number,
  y: number,
  within = 0.15,
): RootNode | null {
  let best: RootNode | null = null;
  let bestD = within;
  for (const n of state.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function spawnTip(
  state: RootState,
  x: number,
  y: number,
  parentId: number | null,
): RootState {
  if (!inSectionBounds(x, y)) return state;
  if (state.nodes.length >= MAX_NODES) return state;
  let parent: RootNode | null = null;
  if (parentId !== null) {
    parent = state.nodes.find((n) => n.id === parentId) ?? null;
  } else {
    parent = nearestNode(state, x, y, 1);
  }
  if (!parent) return state;
  if (parent.generation >= MAX_GENERATION) return state;
  let id = 1;
  for (const n of state.nodes) if (n.id >= id) id = n.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id))();
  const tip: RootNode = {
    id,
    x: clamp01(x),
    y: clamp01(y),
    parentId: parent.id,
    generation: parent.generation + 1,
    water: 0.05,
    sugar: 0.05,
    growth: 0,
    phase,
    sealed: false,
  };
  return { ...state, nodes: [...state.nodes, tip] };
}

export function deepenTip(
  state: RootState,
  id: number,
  dGrowth: number,
): RootState {
  const nodes = state.nodes.map((n) =>
    n.id === id && !n.sealed
      ? { ...n, growth: clamp(n.growth + dGrowth, 0, MAX_GROWTH) }
      : n,
  );
  return { ...state, nodes };
}

export function sealTip(state: RootState, id: number): RootState {
  const nodes = state.nodes.map((n) =>
    n.id === id ? { ...n, growth: MAX_GROWTH, sealed: true } : n,
  );
  return { ...state, nodes };
}

export function knockSweep(
  state: RootState,
  intensity: number,
): { state: RootState; dislodged: number } {
  const i = clamp01(intensity);
  const threshold = KNOCK_THRESHOLD * (1 - i * KNOCK_KAPPA);
  const drop = new Set<number>();
  const tipsList = tips(state);
  for (const t of tipsList) {
    if (t.sealed) continue;
    if (t.parentId === null) continue;
    if (t.water < threshold) drop.add(t.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of state.nodes) {
      if (drop.has(n.id)) continue;
      if (n.parentId !== null && drop.has(n.parentId) && !n.sealed) {
        drop.add(n.id);
        changed = true;
      }
    }
  }
  const kept = state.nodes.filter((n) => !drop.has(n.id));
  return { state: { ...state, nodes: kept }, dislodged: drop.size };
}

// ——— starter ————————————————————————————————————————————

export function initState(seed: number): RootState {
  const rng = mulberry32(seed >>> 0);
  const state0: RootState = {
    nodes: [],
    soilWater: 0.45 + rng() * 0.1,
    sunlight: 0.65 + rng() * 0.15,
    tau: 12 * 3600,
    seedKey: seed >>> 0,
  };
  const crown: RootNode = {
    id: 1,
    x: 0.5,
    y: CROWN_Y,
    parentId: null,
    generation: 0,
    water: 0.4,
    sugar: 0.7,
    growth: MAX_GROWTH,
    phase: rng(),
    sealed: true,
  };
  let state: RootState = { ...state0, nodes: [crown] };
  const starters: { xf: number; yf: number; seal: boolean }[] = [
    { xf: 0.28, yf: 0.28, seal: true },
    { xf: 0.52, yf: 0.50, seal: false },
    { xf: 0.74, yf: 0.38, seal: false },
  ];
  for (const st of starters) {
    const x = POOL_X_MIN + (POOL_X_MAX - POOL_X_MIN) * st.xf;
    const y = CROWN_Y + (POOL_Y_MAX - CROWN_Y) * st.yf;
    state = spawnTip(state, x, y, 1);
    const last = state.nodes[state.nodes.length - 1];
    if (last) {
      state = {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === last.id ? { ...n, water: 0.55, sugar: 0.55 } : n,
        ),
      };
      if (st.seal) state = sealTip(state, last.id);
    }
  }
  return advanceExact(state, 12 * 3600, { warmth: 0.6, wet: 0.5 });
}
