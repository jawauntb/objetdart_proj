/**
 * The plank — the floor of the world, as laws.
 *
 * At 10^-34.8 m there is no stage left under the dancers: spacetime itself is
 * the material. The room's population is **stitches** — closed loops of space,
 * the spin-network quanta of loop quantum gravity — and this module is every
 * law they obey: how they are born, how adjacency weaves them into the network
 * that *is* space, how two of them drawn together fuse into one loop carrying
 * both spins, how a loop pressed past its limit collapses into a pinprick hole
 * that evaporates in j³ time (the Hawking scaling, scaled to a hand), and how
 * the foam advects everything on a seeded, divergence-free breath.
 *
 * Pure math, no DOM, no audio, no imports, no Math.random — node-testable
 * (scripts/test-plank.mjs). The component (src/components/Plank.tsx) renders
 * what these laws decide and nothing else.
 */

// ——— constants ———————————————————————————————————————————————————————————

/** log10 metres of the Planck length — why the band floor sits at -35. */
export const PLANCK_S = -34.79;

/** How many stitches may stand; past this the oldest unravels visibly. */
export const STITCH_CAP = 64;

/** Normalized reach within which two stitches weave a link. */
export const LINK_REACH = 0.17;

/** Normalized closeness at which two stitches fuse into one. */
export const FUSE_REACH = 0.03;

/** A node carries at most this many threads — the network stays a weave. */
export const MAX_DEGREE = 4;

/** A fusion crossing this spin does not make a bigger loop — it makes a hole. */
export const SPIN_COLLAPSE = 12;

/** τ = EVAP_MS_J3 · j³ — a hole's whole life, closed form, no counting down. */
export const EVAP_MS_J3 = 620;

/** Presence lost per second while a stitch unravels (a breath-long exhale). */
export const UNRAVEL_RATE = 0.55;

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

// ——— the stitch ——————————————————————————————————————————————————————————

export type Stitch = {
  id: number;
  /** the determinism law: every generated detail is a function of this. */
  seed: number;
  nx: number;
  ny: number;
  /** drift, normalized units per second. */
  vx: number;
  vy: number;
  /** integer spin ≥ 1 — the loop's size, weight, pitch and degree all at once. */
  j: number;
  bornMs: number;
  /** 0..1, how woven it is; a dwell deepens it continuously. */
  growth: number;
  /** 0..1 excitation — it rings when struck and the ring decays. */
  ring: number;
  /** ms when it collapsed into a pinprick hole, or null while it is a loop. */
  holeMs: number | null;
  /** the spin the hole swallowed — sets its evaporation time. */
  holeJ: number;
  /** 1 while it stands, falling to 0 as it unravels. Removed at 0. */
  presence: number;
};

export function bornStitch(
  id: number,
  seed: number,
  nx: number,
  ny: number,
  tMs: number,
): Stitch {
  const rng = mulberry32(seed);
  return {
    id,
    seed,
    nx: Math.min(0.96, Math.max(0.04, nx)),
    ny: Math.min(0.96, Math.max(0.04, ny)),
    vx: (rng() - 0.5) * 0.012,
    vy: (rng() - 0.5) * 0.012,
    j: 1,
    bornMs: tMs,
    growth: 0.12,
    ring: 0.6,
    holeMs: null,
    holeJ: 0,
    presence: 1,
  };
}

/**
 * Spin → pitch. Heavier loops ring lower — the same law every string obeys —
 * monotone from a bright midi 96 down toward 96 - 33, all of it audible.
 */
export function spinPitchMidi(j: number): number {
  const k = Math.max(1, Math.min(SPIN_COLLAPSE, j));
  return 96 - (k - 1) * 3;
}

/** Spin → visual/reach radius, normalized. Grows sublinearly (area carries j). */
export function spinRadius(j: number): number {
  return 0.021 + 0.013 * Math.sqrt(Math.max(1, j) - 1);
}

// ——— the network: adjacency is space ————————————————————————————————————

export type Link = {
  /** indices into the stitch array, a < b always. */
  a: number;
  b: number;
  /** 0..1 how stretched past rest it is — 1 is the snapping point. */
  strain: number;
};

/**
 * Weave the links. Deterministic and order-independent: every candidate pair
 * inside LINK_REACH is considered nearest-first (ties broken by id), and a
 * pair joins while both ends have degree to spare. Holes thread nothing —
 * a pinprick in the weave is exactly a place with no threads left.
 */
export function weaveLinks(sts: Stitch[]): Link[] {
  const cand: { a: number; b: number; d2: number; ka: number; kb: number }[] = [];
  const r2 = LINK_REACH * LINK_REACH;
  for (let a = 0; a < sts.length; a++) {
    const A = sts[a];
    if (A.holeMs !== null || A.presence < 0.5) continue;
    for (let b = a + 1; b < sts.length; b++) {
      const B = sts[b];
      if (B.holeMs !== null || B.presence < 0.5) continue;
      const dx = B.nx - A.nx;
      const dy = B.ny - A.ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) cand.push({ a, b, d2, ka: A.id, kb: B.id });
    }
  }
  cand.sort((p, q) => p.d2 - q.d2 || p.ka - q.ka || p.kb - q.kb);
  const degree = new Array<number>(sts.length).fill(0);
  const links: Link[] = [];
  for (const c of cand) {
    if (degree[c.a] >= MAX_DEGREE || degree[c.b] >= MAX_DEGREE) continue;
    degree[c.a]++;
    degree[c.b]++;
    links.push({ a: c.a, b: c.b, strain: Math.sqrt(c.d2) / LINK_REACH });
  }
  return links;
}

/** BFS depth of every stitch from `from` along the links; -1 is unreachable. */
export function graphOrder(sts: Stitch[], links: Link[], from: number): number[] {
  const depth = new Array<number>(sts.length).fill(-1);
  if (from < 0 || from >= sts.length) return depth;
  depth[from] = 0;
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    for (const l of links) {
      const other = l.a === i ? l.b : l.b === i ? l.a : -1;
      if (other >= 0 && depth[other] === -1) {
        depth[other] = depth[i] + 1;
        queue.push(other);
      }
    }
  }
  return depth;
}

// ——— the foam: a seeded, divergence-free churn ——————————————————————————

const FOAM_WAVES = [
  { ax: 5.1, ay: 3.7, w: 0.21, amp: 1.0 },
  { ax: -3.3, ay: 6.2, w: 0.33, amp: 0.8 },
  { ax: 7.9, ay: -4.6, w: 0.13, amp: 0.6 },
  { ax: -6.1, ay: -7.4, w: 0.4, amp: 0.45 },
] as const;

/**
 * The foam's stream function φ at a point; drift is its curl (∂φ/∂y, -∂φ/∂x),
 * so the churn is divergence-free — the foam stirs, it never drains. Seed
 * offsets the phases; epoch (the three-finger season) quickens the churn.
 */
export function foamDrift(
  nx: number,
  ny: number,
  tSec: number,
  seed: number,
  epoch: number,
  out: { x: number; y: number },
): void {
  const p0 = (seed % 1024) * 0.006135923151;
  const speed = 0.35 + epoch * 1.15;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < FOAM_WAVES.length; i++) {
    const w = FOAM_WAVES[i];
    const ph = w.ax * nx + w.ay * ny + tSec * w.w * speed + p0 * (i + 1);
    // curl of amp·sin(ph): (amp·ay·cos, -amp·ax·cos)
    const c = Math.cos(ph) * w.amp;
    dx += w.ay * c;
    dy -= w.ax * c;
  }
  const k = 0.0035 * (0.5 + epoch * 0.9);
  out.x = dx * k;
  out.y = dy * k;
}

// ——— the step: forces, drift, evaporation — all in place ————————————————

export type FieldInput = {
  windX: number;
  windY: number;
  gravX: number;
  gravY: number;
  /** 0..1 vacuum agitation (shake). */
  agitation: number;
  /** frame-dragging vortex from the scrub: center + signed strength. */
  vortexX: number;
  vortexY: number;
  vortexW: number;
  /** 0..1 vacuum-energy epoch (three-finger season). */
  epoch: number;
  /** 1 normally, < 1 while a three-finger hold dilates time. */
  timeScale: number;
  reduced: boolean;
};

const REST_LEN = LINK_REACH * 0.55;
const SPRING = 2.6;
const DAMP = 1.9;
const drift = { x: 0, y: 0 };

/**
 * Advance the weave by dt seconds. Links pull toward their rest length (the
 * network holds its own shape), the foam advects, the vessel leans, the
 * vortex drags frames around itself, rings decay, holes evaporate on their
 * closed-form clock, and the retiring exhale.
 */
export function stepWeave(
  sts: Stitch[],
  links: Link[],
  input: FieldInput,
  tMs: number,
  dt: number,
): void {
  const d = Math.max(0, Math.min(0.1, dt)) * input.timeScale;
  const tSec = tMs / 1000;

  for (const l of links) {
    const A = sts[l.a];
    const B = sts[l.b];
    const dx = B.nx - A.nx;
    const dy = B.ny - A.ny;
    const len = Math.max(1e-5, Math.hypot(dx, dy));
    l.strain = Math.min(1, len / LINK_REACH);
    const f = ((len - REST_LEN) * SPRING) / len;
    const wa = 1 / Math.max(1, A.j);
    const wb = 1 / Math.max(1, B.j);
    A.vx += dx * f * wa * d;
    A.vy += dy * f * wa * d;
    B.vx -= dx * f * wb * d;
    B.vy -= dy * f * wb * d;
  }

  for (const s of sts) {
    if (s.holeMs !== null) {
      // A hole neither drifts nor rings — it only gives its light back.
      s.ring = 0;
      if (holePhase(s, tMs) <= 0) s.presence = Math.max(0, s.presence - UNRAVEL_RATE * d);
      continue;
    }
    if (!input.reduced) {
      foamDrift(s.nx, s.ny, tSec, s.seed, input.epoch, drift);
      const inertia = 1 / (0.8 + s.j * 0.35);
      s.vx += (drift.x + input.windX * 0.06 + input.gravX * 0.05) * inertia * d;
      s.vy += (drift.y + input.windY * 0.06 + input.gravY * 0.05) * inertia * d;
      if (input.agitation > 0.01) {
        const rng = mulberry32(hashSeed(s.seed, Math.floor(tSec * 5)));
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
    s.ring *= Math.exp(-2.1 * d);
    if (s.presence < 1) s.presence = Math.max(0, s.presence - UNRAVEL_RATE * d);
  }
}

// ——— meetings: fusion, budding, collapse, evaporation ———————————————————

/** The closest pair inside FUSE_REACH, nearest first — or null. */
export function findFusePair(sts: Stitch[]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD2 = FUSE_REACH * FUSE_REACH;
  for (let a = 0; a < sts.length; a++) {
    const A = sts[a];
    if (A.holeMs !== null || A.presence < 1 || A.growth < 0.5) continue;
    for (let b = a + 1; b < sts.length; b++) {
      const B = sts[b];
      if (B.holeMs !== null || B.presence < 1 || B.growth < 0.5) continue;
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
 * Two loops drawn together become one loop that is neither parent: the spin
 * is both spins joined, the place is the spin-weighted meeting point, the
 * seed folds both histories. Past SPIN_COLLAPSE the fusion does not make a
 * bigger loop — too much spin in one place is how the weave makes a hole.
 */
export function fuseStitches(a: Stitch, b: Stitch, id: number, tMs: number): Stitch {
  const wa = a.j / (a.j + b.j);
  const child = bornStitch(id, hashSeed(a.seed, b.seed, a.j + b.j), 0, 0, tMs);
  child.nx = a.nx * wa + b.nx * (1 - wa);
  child.ny = a.ny * wa + b.ny * (1 - wa);
  child.vx = (a.vx * a.j + b.vx * b.j) / (a.j + b.j);
  child.vy = (a.vy * a.j + b.vy * b.j) / (a.j + b.j);
  child.j = a.j + b.j;
  child.growth = 1;
  child.ring = 1;
  if (child.j > SPIN_COLLAPSE) collapseStitch(child, tMs);
  return child;
}

/**
 * The three-tap transformation: a loop with spin to spare pinches off a
 * satellite carrying one unit of it. Spin is conserved: parent j-1, child 1.
 * Returns null when the parent has only itself to give.
 */
export function budFrom(parent: Stitch, id: number, tMs: number): Stitch | null {
  if (parent.holeMs !== null || parent.j <= 1) return null;
  parent.j -= 1;
  parent.ring = Math.min(1, parent.ring + 0.6);
  const rng = mulberry32(hashSeed(parent.seed, parent.j, id));
  const ang = rng() * Math.PI * 2;
  const dist = LINK_REACH * (0.45 + rng() * 0.2);
  const child = bornStitch(
    id,
    hashSeed(parent.seed, id, 7),
    parent.nx + Math.cos(ang) * dist,
    parent.ny + Math.sin(ang) * dist,
    tMs,
  );
  child.growth = 0.6;
  child.ring = 1;
  return child;
}

/** The ceremony: a loop pressed past its limit becomes a pinprick hole. */
export function collapseStitch(s: Stitch, tMs: number): void {
  if (s.holeMs !== null) return;
  s.holeJ = s.j;
  s.holeMs = tMs;
  s.ring = 0;
}

/** A hole's whole life — the Hawking scaling, τ ∝ j³, scaled to a hand. */
export function evaporationMs(j: number): number {
  const k = Math.max(1, j);
  return EVAP_MS_J3 * k * k * k;
}

/** 1 → 0 of a hole's remaining life, closed form — never a counter. */
export function holePhase(s: Stitch, tMs: number): number {
  if (s.holeMs === null) return 1;
  const life = evaporationMs(s.holeJ);
  return Math.max(0, 1 - (tMs - s.holeMs) / life);
}

/** Mark the oldest standing stitch retiring; returns its index or -1. */
export function retireOldest(sts: Stitch[]): number {
  let oldest = -1;
  let bornMs = Infinity;
  for (let i = 0; i < sts.length; i++) {
    const s = sts[i];
    if (s.presence >= 1 && s.bornMs < bornMs) {
      bornMs = s.bornMs;
      oldest = i;
    }
  }
  if (oldest >= 0) sts[oldest].presence = 0.999;
  return oldest;
}

// ——— the span's standing wave ————————————————————————————————————————————

/**
 * Two still fingers hold an interval open; the spread between them is a
 * wavelength, and this maps it monotonically into the audible register the
 * plank sings in — wider hands, deeper mode.
 */
export function waveHz(spreadPx: number): number {
  const u = Math.max(0, Math.min(1, (spreadPx - 40) / 520));
  return 1760 * Math.pow(2, -u * 3.2);
}

// ——— persistence ————————————————————————————————————————————————————————

export type KeptWeave = {
  v: 1;
  stitches: Array<{ s: number; x: number; y: number; j: number }>;
};

export function serializeWeave(sts: Stitch[]): KeptWeave {
  const out: KeptWeave = { v: 1, stitches: [] };
  for (const s of sts) {
    if (s.holeMs !== null || s.presence < 1) continue;
    out.stitches.push({
      s: s.seed,
      x: Math.round(s.nx * 1000) / 1000,
      y: Math.round(s.ny * 1000) / 1000,
      j: s.j,
    });
  }
  return out;
}

export function loadWeave(raw: unknown, tMs: number): Stitch[] {
  const sts: Stitch[] = [];
  if (!raw || typeof raw !== "object") return sts;
  const kept = raw as Partial<KeptWeave>;
  if (kept.v !== 1 || !Array.isArray(kept.stitches)) return sts;
  for (const k of kept.stitches.slice(0, STITCH_CAP)) {
    if (!k || typeof k.x !== "number" || typeof k.y !== "number") continue;
    const st = bornStitch(sts.length + 1, (k.s ?? 1) >>> 0, k.x, k.y, tMs);
    st.j = Math.max(1, Math.min(SPIN_COLLAPSE, Math.floor(k.j ?? 1)));
    st.growth = 1;
    st.ring = 0;
    sts.push(st);
  }
  return sts;
}
