/**
 * lightning — a forked bolt as pure geometry.
 *
 * A recursive midpoint-displacement fractal that produces the shape of a
 * lightning bolt: a jagged main channel from (x0,y0) to (x1,y1), with
 * subsidiary branches forking off along the way. Every random draw is
 * derived from a seeded stream, so `buildBolt(x0,y0,x1,y1,cfg,seed)` is
 * deterministic — same inputs, same segments, always.
 *
 * The shape was proven inside /storm's `Storm.tsx` first. Extracting it
 * here lets /zeus draw the same anatomically-branched bolts over its own
 * shader without either room owning the algorithm privately. Pure math —
 * no DOM, no imports, no `Math.random`, no `Date.now()`. Node-testable
 * (scripts/test-lightning.mjs).
 */

// ——— determinism ————————————————————————————————————————————————————————
// The canonical hash + rng shape from src/lib/plank.ts. Same law: the seed
// is the whole state; two calls with the same seed produce the same stream.

/** Fold any number of parts into one 32-bit seed. */
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

// ——— the bolt ——————————————————————————————————————————————————————————

/**
 * One drawn segment of the bolt. Storm's existing rendering code walks
 * arrays of exactly this shape; the field is preserved so this lib is a
 * drop-in extraction.
 *
 * `main: true` — a leaf of the main channel from (x0,y0) to (x1,y1).
 *   Walking the main segments in order traces a continuous polyline from
 *   the strike's origin to its impact point.
 * `main: false` — a branch that forks off the main channel and terminates
 *   somewhere aside from the impact point.
 */
export type BoltSeg = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  main: boolean;
};

/**
 * The parameters the fractal exposes. Every knob storm hardcoded lives
 * here so /zeus (bigger, closer bolts) can tune each independently.
 *
 * `generations`  — recursion depth. The main channel emits at most 2^gen
 *                  leaf segments; branches shorten by two generations.
 * `displacement` — the max midpoint offset at the root. Halves (·0.58) at
 *                  every generation. Units match (x0,y0) — pixels if the
 *                  caller passes pixels; normalized if normalized.
 * `branchProb`   — probability per subdivision that a branch also spawns.
 * `minSegLen`    — segments shorter than this stop subdividing. Prevents
 *                  the fractal from grinding out sub-pixel splits.
 * `maxSegments`  — optional hard cap on the returned array; when hit, the
 *                  remaining subtree is emitted as one unforked segment.
 */
export type BoltConfig = {
  generations: number;
  displacement: number;
  branchProb: number;
  minSegLen: number;
  maxSegments?: number;
};

/**
 * Reasonable defaults matching storm's original call. `displacement` is a
 * fraction — the caller multiplies by frame width to get pixels, so the
 * bolt's jaggedness stays proportional to the frame it draws into.
 */
export const DEFAULT_BOLT_CFG: BoltConfig = {
  generations: 6,
  displacement: 0.12,
  branchProb: 0.42,
  minSegLen: 8,
};

/**
 * Build the bolt. Recursive midpoint-displacement: each segment is split
 * at its midpoint, the midpoint is pushed off the straight line by a
 * seeded offset, and both halves recurse. At each generation there is a
 * `branchProb` chance the midpoint also spawns a shorter, shallower fork.
 *
 * Deterministic: `(x0,y0,x1,y1,cfg,seed)` fully determines the returned
 * segments. Every sub-call derives its own seed via `hashSeed(seed, gen,
 * side)` so a shuffle of the recursion order would produce a different
 * bolt — the branching is not a function of walk order.
 */
export function buildBolt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cfg: BoltConfig,
  seed: number,
): BoltSeg[] {
  const out: BoltSeg[] = [];
  const cap = cfg.maxSegments && cfg.maxSegments > 0 ? cfg.maxSegments : Infinity;
  buildInto(x0, y0, x1, y1, cfg.generations, cfg.displacement, true, seed, cfg, out, cap);
  return out;
}

function buildInto(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  gen: number,
  disp: number,
  main: boolean,
  seed: number,
  cfg: BoltConfig,
  out: BoltSeg[],
  cap: number,
): void {
  // Cap is a strict ceiling — once the array holds `cap` segments, no more
  // are pushed. Truncates the tail rather than growing it, so a pathological
  // seed cannot balloon past the caller's budget.
  if (out.length >= cap) return;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const minSq = cfg.minSegLen * cfg.minSegLen;
  // Terminal segment: out of generations, or already short enough to draw
  // straight without further midpoint displacement.
  if (gen <= 0 || dx * dx + dy * dy < minSq) {
    out.push({ x0, y0, x1, y1, main });
    return;
  }
  const rng = mulberry32(seed);
  const mx = (x0 + x1) / 2 + (rng() - 0.5) * disp;
  const my = (y0 + y1) / 2 + (rng() - 0.5) * disp * 0.35;
  buildInto(x0, y0, mx, my, gen - 1, disp * 0.58, main,
    hashSeed(seed, gen, 0), cfg, out, cap);
  buildInto(mx, my, x1, y1, gen - 1, disp * 0.58, main,
    hashSeed(seed, gen, 1), cfg, out, cap);
  if (gen > 1 && rng() < cfg.branchProb && out.length < cap) {
    const bl = 0.5 + rng() * 0.7;
    const bx = mx + dx * bl * 0.5 + (rng() - 0.5) * disp * 1.2;
    const by = my + Math.abs(dy) * bl * 0.5 + rng() * disp * 0.4;
    buildInto(mx, my, bx, by, gen - 2, disp * 0.5, false,
      hashSeed(seed, gen, 2), cfg, out, cap);
  }
}
