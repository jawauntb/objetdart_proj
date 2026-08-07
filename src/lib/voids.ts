/**
 * The voids — the emptiness that pushes, as laws.
 *
 * At the beyond band (~10^22–3e25 m) the subject is negative space: a great
 * underdense cosmic void bounded by the web. The room's population is
 * **nodes** — galaxy clusters, each of which IS its mass — strung by
 * **filaments**, and a filament IS the tension line between two nodes: it
 * thins and snaps as the void stretches it. The **void** itself is not a
 * thing but a causal fact — the outward push (a Hubble outflow) that voids
 * leave in their wake, draining matter outward onto the walls. This module is
 * every law they obey: how a node condenses, how proximity weaves the tension
 * network, how the outflow expands a void monotonically and pushes matter to
 * its wall, how two clusters drawn together fall into one great attractor
 * that conserves both masses, and how the vessel leans the whole field.
 *
 * Pure math, no DOM, no audio, no imports, no Math.random — node-testable
 * (scripts/test-voids.mjs). The component (src/components/Voids.tsx) renders
 * what these laws decide and nothing else.
 */

// ——— constants ———————————————————————————————————————————————————————————

/** log10 metres of a great void — why this room sits in the beyond band. */
export const VOID_S = 23.8;

/** How many cluster nodes may stand; past this the oldest drains out. */
export const NODE_CAP = 64;

/**
 * The longest a tension line can span before it snaps. A filament exists only
 * while the two nodes are within this reach; the void stretches them past it,
 * and past it there is no thread — the snap is exactly a length exceeded.
 */
export const FILAMENT_REACH = 0.22;

/** The rest length a filament pulls its two nodes back toward. */
export const REST_LEN = 0.085;

/** A node strings at most this many filaments — the web stays a web, not a mesh. */
export const MAX_DEGREE = 5;

/** Two nodes closer than this fall together into one great attractor. */
export const MERGE_REACH = 0.035;

/** dR/dt ∝ HUBBLE·R — the void's expansion is exponential, scaled to a hand. */
export const HUBBLE = 0.05;

/** How hard the outflow advects matter outward onto the walls. */
export const OUTFLOW_K = 0.02;

/** Presence lost per second while a node drains out (a breath-long exhale). */
export const UNRAVEL_RATE = 0.55;

const SPRING = 2.4;
const DAMP = 1.8;

// ——— determinism ————————————————————————————————————————————————————————

/** Fold any number of parts into one 32-bit seed. The room's only dice. */
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

// ——— the node: a cluster that is its mass ————————————————————————————————

export type Node = {
  id: number;
  /** the determinism law: every generated detail is a function of this. */
  seed: number;
  nx: number;
  ny: number;
  vx: number;
  vy: number;
  /** the node's whole identity — pitch, weight, size and pull all at once. */
  mass: number;
  bornMs: number;
  /** 0..1, how condensed it is; a dwell deepens it continuously. */
  growth: number;
  /** 0..1 excitation — it flares when matter crosses and the flare decays. */
  glow: number;
  /** 0..1 matter drained onto this wall node by the outflow; visible, decays. */
  drain: number;
  /** 1 while it stands, falling to 0 as it drains out. Removed at 0. */
  presence: number;
};

export function bornNode(
  id: number,
  seed: number,
  nx: number,
  ny: number,
  tMs: number,
): Node {
  const rng = mulberry32(seed);
  return {
    id,
    seed,
    nx: Math.min(0.96, Math.max(0.04, nx)),
    ny: Math.min(0.96, Math.max(0.04, ny)),
    vx: (rng() - 0.5) * 0.01,
    vy: (rng() - 0.5) * 0.01,
    mass: 1,
    bornMs: tMs,
    growth: 0.12,
    glow: 0.55,
    drain: 0,
    presence: 1,
  };
}

/**
 * Mass → pitch. Heavier clusters ring lower — a log law, so a great attractor
 * is felt as a deep swell — monotone and always inside the register the room
 * sings in.
 */
export function massPitchMidi(mass: number): number {
  const m = Math.max(1, mass);
  return Math.max(36, Math.min(96, 84 - Math.log2(m) * 6));
}

/** Mass → visual/reach radius, normalized. Grows sublinearly (area carries mass). */
export function massRadius(mass: number): number {
  return 0.02 + 0.018 * Math.sqrt(Math.max(0, mass - 1));
}

// ——— the void: the outward push, not a thing ————————————————————————————

export type Void = {
  id: number;
  cx: number;
  cy: number;
  /** grows monotonically under the outflow; the void is defined by this. */
  radius: number;
  /** how hard it pushes matter to its wall. */
  strength: number;
  bornMs: number;
};

export function bornVoid(
  id: number,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
  tMs: number,
): Void {
  return {
    id,
    cx: Math.min(0.95, Math.max(0.05, cx)),
    cy: Math.min(0.95, Math.max(0.05, cy)),
    radius: Math.max(0.02, radius),
    strength,
    bornMs: tMs,
  };
}

/**
 * The ceremony's product: a new void nucleated inside a wall, pushing its own
 * bubble outward from where matter was densest. A void-in-wall.
 */
export function nucleateVoid(id: number, cx: number, cy: number, tMs: number): Void {
  return bornVoid(id, cx, cy, 0.03, 0.9, tMs);
}

/**
 * dR/dt of a void — the Hubble law, ∝ R. Positive epoch expands, negative
 * collapses (the reversed flow of the season), zero freezes. The void's whole
 * causal identity is that this is nonzero.
 */
export function hubbleRate(radius: number, epoch: number): number {
  return HUBBLE * radius * epoch;
}

/**
 * Advance every void's radius by its own Hubble rate. Monotone increasing
 * while epoch > 0 (until the frame ceiling) — the emptiness only ever grows in
 * the wake it leaves. Clamped so a void never swallows the whole frame or
 * collapses through zero.
 */
export function stepVoids(voids: Void[], epoch: number, dt: number): void {
  const d = Math.max(0, Math.min(0.1, dt));
  for (const v of voids) {
    v.radius = Math.max(0.02, Math.min(0.92, v.radius + hubbleRate(v.radius, epoch) * d));
  }
}

/**
 * The outflow field at a point: the sum over every void of an outward push
 * away from its center, strongest at the wall (r ≈ radius) and fading beyond.
 * Unlike a stirring churn this field has net positive divergence inside a
 * void — that is the whole argument: the emptiness drains matter *out*, it
 * never merely stirs. Epoch scales and can reverse it (inflow under collapse).
 */
export function hubbleFlow(
  nx: number,
  ny: number,
  voids: Void[],
  epoch: number,
  out: { x: number; y: number },
): void {
  let vx = 0;
  let vy = 0;
  for (const v of voids) {
    const dx = nx - v.cx;
    const dy = ny - v.cy;
    const r = Math.max(0.02, Math.hypot(dx, dy));
    const push = v.strength * epoch * Math.exp(-Math.abs(r - v.radius) * 3.5);
    vx += (dx / r) * push;
    vy += (dy / r) * push;
  }
  out.x = vx * OUTFLOW_K;
  out.y = vy * OUTFLOW_K;
}

// ——— the network: filaments are the tension between nodes ————————————————

export type Filament = {
  /** indices into the node array, a < b always. */
  a: number;
  b: number;
  /** 0..1 how stretched past rest it is toward its snap length; 1 = snapping. */
  strain: number;
};

/**
 * Weave the filaments. Deterministic and order-independent: every candidate
 * pair inside FILAMENT_REACH is considered nearest-first (ties broken by id),
 * and a pair strings while both ends have degree to spare. A pair stretched
 * past the reach is simply absent — that absence is the snap. Drained and
 * retiring nodes thread nothing.
 */
export function weaveFilaments(nodes: Node[]): Filament[] {
  const cand: { a: number; b: number; d2: number; ka: number; kb: number }[] = [];
  const r2 = FILAMENT_REACH * FILAMENT_REACH;
  for (let a = 0; a < nodes.length; a++) {
    const A = nodes[a];
    if (A.presence < 0.5) continue;
    for (let b = a + 1; b < nodes.length; b++) {
      const B = nodes[b];
      if (B.presence < 0.5) continue;
      const dx = B.nx - A.nx;
      const dy = B.ny - A.ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) cand.push({ a, b, d2, ka: A.id, kb: B.id });
    }
  }
  cand.sort((p, q) => p.d2 - q.d2 || p.ka - q.ka || p.kb - q.kb);
  const degree = new Array<number>(nodes.length).fill(0);
  const fils: Filament[] = [];
  const span = FILAMENT_REACH - REST_LEN;
  for (const c of cand) {
    if (degree[c.a] >= MAX_DEGREE || degree[c.b] >= MAX_DEGREE) continue;
    degree[c.a]++;
    degree[c.b]++;
    const len = Math.sqrt(c.d2);
    fils.push({ a: c.a, b: c.b, strain: Math.min(1, Math.max(0, (len - REST_LEN) / span)) });
  }
  return fils;
}

/** BFS depth of every node from `from` along the filaments; -1 is unreachable. */
export function graphOrder(nodes: Node[], fils: Filament[], from: number): number[] {
  const depth = new Array<number>(nodes.length).fill(-1);
  if (from < 0 || from >= nodes.length) return depth;
  depth[from] = 0;
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    for (const f of fils) {
      const other = f.a === i ? f.b : f.b === i ? f.a : -1;
      if (other >= 0 && depth[other] === -1) {
        depth[other] = depth[i] + 1;
        queue.push(other);
      }
    }
  }
  return depth;
}

/** Indices of the wall a node belongs to: itself and its filament neighbours. */
export function wallOf(fils: Filament[], from: number): number[] {
  const wall = [from];
  for (const f of fils) {
    if (f.a === from && !wall.includes(f.b)) wall.push(f.b);
    else if (f.b === from && !wall.includes(f.a)) wall.push(f.a);
  }
  return wall;
}

// ——— the step: outflow, tension, drift, drain — all in place ———————————

export type FieldInput = {
  windX: number;
  windY: number;
  gravX: number;
  gravY: number;
  /** 0..1 agitation (shake). */
  agitation: number;
  /** frame-dragging vortex from the scrub: center + signed strength. */
  vortexX: number;
  vortexY: number;
  vortexW: number;
  /** the expansion epoch (three-finger season); + expands, − collapses. */
  epoch: number;
  /** 1 normally, < 1 while a three-finger hold dilates time. */
  timeScale: number;
  reduced: boolean;
};

const flow = { x: 0, y: 0 };

/**
 * Advance the web by dt seconds. Filaments pull toward their rest length (the
 * network holds its own shape), the void outflow drives every node outward
 * onto the walls and drains matter onto them, the vessel leans and agitates,
 * the vortex drags frames, glow decays, and the retiring exhale plays out.
 * Void radii are advanced separately by `stepVoids`; here they are read.
 */
export function stepWeb(
  nodes: Node[],
  fils: Filament[],
  voids: Void[],
  input: FieldInput,
  tMs: number,
  dt: number,
): void {
  const d = Math.max(0, Math.min(0.1, dt)) * input.timeScale;
  const span = FILAMENT_REACH - REST_LEN;

  // tension: each filament pulls its two nodes toward the rest length
  for (const f of fils) {
    const A = nodes[f.a];
    const B = nodes[f.b];
    const dx = B.nx - A.nx;
    const dy = B.ny - A.ny;
    const len = Math.max(1e-5, Math.hypot(dx, dy));
    f.strain = Math.min(1, Math.max(0, (len - REST_LEN) / span));
    const force = ((len - REST_LEN) * SPRING) / len;
    const wa = 1 / Math.max(1, A.mass);
    const wb = 1 / Math.max(1, B.mass);
    A.vx += dx * force * wa * d;
    A.vy += dy * force * wb * d;
    B.vx -= dx * force * wb * d;
    B.vy -= dy * force * wb * d;
  }

  for (const s of nodes) {
    if (!input.reduced) {
      // the outflow: the emptiness pushes this node toward its wall
      hubbleFlow(s.nx, s.ny, voids, input.epoch, flow);
      const outMag = Math.hypot(flow.x, flow.y);
      const inertia = 1 / (0.8 + s.mass * 0.3);
      s.vx += (flow.x + input.windX * 0.05 + input.gravX * 0.045) * inertia * d * 30;
      s.vy += (flow.y + input.windY * 0.05 + input.gravY * 0.045) * inertia * d * 30;
      // matter drains onto the wall where the outflow drives it hardest
      s.drain = Math.max(0, Math.min(1, s.drain + outMag * 26 * d - 0.12 * d));
      if (input.agitation > 0.01) {
        const rng = mulberry32(hashSeed(s.seed, Math.floor((tMs / 1000) * 5)));
        s.vx += (rng() - 0.5) * input.agitation * 0.12 * d * 30;
        s.vy += (rng() - 0.5) * input.agitation * 0.12 * d * 30;
      }
      if (Math.abs(input.vortexW) > 0.01) {
        const rx = s.nx - input.vortexX;
        const ry = s.ny - input.vortexY;
        const r = Math.max(0.03, Math.hypot(rx, ry));
        const fall = Math.exp(-r * 4.5) * input.vortexW * 0.5;
        s.vx += (-ry / r) * fall * d;
        s.vy += (rx / r) * fall * d;
      }
    }
    const keep = Math.exp(-DAMP * d);
    s.vx *= keep;
    s.vy *= keep;
    s.nx += s.vx * d;
    s.ny += s.vy * d;
    if (s.nx < 0.03) { s.nx = 0.03; s.vx = Math.abs(s.vx) * 0.5; }
    if (s.nx > 0.97) { s.nx = 0.97; s.vx = -Math.abs(s.vx) * 0.5; }
    if (s.ny < 0.03) { s.ny = 0.03; s.vy = Math.abs(s.vy) * 0.5; }
    if (s.ny > 0.97) { s.ny = 0.97; s.vy = -Math.abs(s.vy) * 0.5; }
    s.growth += (1 - s.growth) * Math.min(1, d * 0.9);
    s.glow *= Math.exp(-1.9 * d);
    if (s.presence < 1) s.presence = Math.max(0, s.presence - UNRAVEL_RATE * d);
  }
}

// ——— meetings: merge, collapse, retirement —————————————————————————————

/** The closest pair inside MERGE_REACH, nearest first — or null. */
export function findMergePair(nodes: Node[]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD2 = MERGE_REACH * MERGE_REACH;
  for (let a = 0; a < nodes.length; a++) {
    const A = nodes[a];
    if (A.presence < 1 || A.growth < 0.5) continue;
    for (let b = a + 1; b < nodes.length; b++) {
      const B = nodes[b];
      if (B.presence < 1 || B.growth < 0.5) continue;
      const dx = B.nx - A.nx;
      const dy = B.ny - A.ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = [a, b];
      }
    }
  }
  return best;
}

/**
 * Two clusters drawn together fall into one great attractor that is neither
 * parent: the mass is both masses summed (mass is conserved), the place is the
 * mass-weighted meeting point, the momentum is conserved, and the seed folds
 * both histories.
 */
export function mergeNodes(a: Node, b: Node, id: number, tMs: number): Node {
  const total = a.mass + b.mass;
  const wa = a.mass / total;
  const child = bornNode(id, hashSeed(a.seed, b.seed, Math.floor(total)), 0, 0, tMs);
  child.nx = a.nx * wa + b.nx * (1 - wa);
  child.ny = a.ny * wa + b.ny * (1 - wa);
  child.vx = (a.vx * a.mass + b.vx * b.mass) / total;
  child.vy = (a.vy * a.mass + b.vy * b.mass) / total;
  child.mass = total;
  child.growth = 1;
  child.glow = 1;
  return child;
}

/**
 * A wall collapses: the flick throws every node of the wall inward toward
 * their shared centroid, so they fall together and merge over the frames that
 * follow. Returns the centroid the great attractor forms at.
 */
export function collapseWall(
  nodes: Node[],
  wall: number[],
  strength: number,
): { cx: number; cy: number } {
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const i of wall) {
    const s = nodes[i];
    if (!s || s.presence < 1) continue;
    cx += s.nx;
    cy += s.ny;
    n++;
  }
  if (n === 0) return { cx: 0.5, cy: 0.5 };
  cx /= n;
  cy /= n;
  for (const i of wall) {
    const s = nodes[i];
    if (!s || s.presence < 1) continue;
    s.vx += (cx - s.nx) * strength;
    s.vy += (cy - s.ny) * strength;
    s.glow = Math.min(1, s.glow + 0.5);
  }
  return { cx, cy };
}

/** Mark the oldest standing node draining out; returns its index or -1. */
export function retireOldest(nodes: Node[]): number {
  let oldest = -1;
  let bornMs = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const s = nodes[i];
    if (s.presence >= 1 && s.bornMs < bornMs) {
      bornMs = s.bornMs;
      oldest = i;
    }
  }
  if (oldest >= 0) nodes[oldest].presence = 0.999;
  return oldest;
}

// ——— persistence ————————————————————————————————————————————————————————

export type KeptWeb = {
  v: 1;
  nodes: Array<{ s: number; x: number; y: number; m: number }>;
  voids: Array<{ x: number; y: number; r: number }>;
};

export function serializeWeb(nodes: Node[], voids: Void[]): KeptWeb {
  const out: KeptWeb = { v: 1, nodes: [], voids: [] };
  for (const s of nodes) {
    if (s.presence < 1) continue;
    out.nodes.push({
      s: s.seed,
      x: Math.round(s.nx * 1000) / 1000,
      y: Math.round(s.ny * 1000) / 1000,
      m: Math.round(s.mass * 100) / 100,
    });
  }
  for (const v of voids) {
    out.voids.push({
      x: Math.round(v.cx * 1000) / 1000,
      y: Math.round(v.cy * 1000) / 1000,
      r: Math.round(v.radius * 1000) / 1000,
    });
  }
  return out;
}

export function loadWeb(raw: unknown, tMs: number): { nodes: Node[]; voids: Void[] } {
  const nodes: Node[] = [];
  const voids: Void[] = [];
  if (!raw || typeof raw !== "object") return { nodes, voids };
  const kept = raw as Partial<KeptWeb>;
  if (kept.v !== 1) return { nodes, voids };
  if (Array.isArray(kept.nodes)) {
    for (const k of kept.nodes.slice(0, NODE_CAP)) {
      if (!k || typeof k.x !== "number" || typeof k.y !== "number") continue;
      const s = bornNode(nodes.length + 1, (k.s ?? 1) >>> 0, k.x, k.y, tMs);
      s.mass = Math.max(1, k.m ?? 1);
      s.growth = 1;
      s.glow = 0;
      nodes.push(s);
    }
  }
  if (Array.isArray(kept.voids)) {
    for (const k of kept.voids.slice(0, 8)) {
      if (!k || typeof k.x !== "number" || typeof k.y !== "number") continue;
      voids.push(bornVoid(voids.length + 1, k.x, k.y, Math.max(0.02, k.r ?? 0.1), 0.9, tMs));
    }
  }
  return { nodes, voids };
}
