/**
 * orbfield — the laws of `/orb`, extracted so they can be pinned.
 *
 * A disc is a small deterministic state vector in aspect-corrected clip space
 * (x in [-aspect, aspect], y in [-1, 1]) plus a seed. Nothing here touches the
 * DOM, WebGL, audio or the gesture engine: it is the room's physics, and
 * `scripts/test-orbfield.mjs` loads it in plain node.
 *
 * Three laws live here because all three can lie silently on screen:
 *
 *  - **separation.** Discs are a population, not a slideshow: two that drift
 *    into each other push apart along their own axis, conserving the pair's
 *    centre. A sign error here reads as "they clump" and is invisible in a
 *    screenshot.
 *  - **drift.** One semi-implicit Euler step with a viscous drag and walls
 *    that reflect rather than clamp. A disc must never leave the frame and
 *    never gain energy from a wall.
 *  - **the dwell curve.** Radius as a function of how long a finger has
 *    rested: strictly increasing (holding longer must keep deepening it, the
 *    law the grammar states as "nothing fires identically at 900ms and
 *    2400ms"), saturating at `MAX_RADIUS`, and never below `MIN_RADIUS`.
 */

/** How many discs the field holds; also the shader's uniform-array size. */
export const DISC_CAP = 9;
/** The radius a disc is born with, the instant a dwell is legible. */
export const MIN_RADIUS = 0.055;
/** The ceiling a long hold approaches but never crosses. */
export const MAX_RADIUS = 0.42;
/** How fast the dwell curve approaches the ceiling, in ms. */
const DWELL_TAU = 1500;

export type Disc = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** 0..1 — how built the disc is; the dwell's duration made visible. */
  weight: number;
  /** 0..1, deterministic; every per-disc variation is a function of it. */
  seed: number;
  born: number;
  /** transient brightness from a tap, a knock or tutti. */
  flare: number;
  /** 0 = standing, >0 = blooming out; 1 retires it. */
  retire: number;
};

export type DiscWorld = {
  /** -1..1, the three-finger drag and the vessel's roll. */
  wind: number;
  /** -1..1, the vessel's pitch. */
  gravity: number;
  /** 0..1, shake. */
  agitation: number;
  /** viewport aspect; the horizontal walls sit at ±aspect. */
  aspect: number;
  reducedMotion?: boolean;
};

/**
 * Radius after `elapsedMs` of dwell. Strictly increasing and saturating, so a
 * hand that keeps holding keeps being answered — the continuity law, in the
 * one place a room usually breaks it.
 */
export function dwellRadius(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs);
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * (1 - Math.exp(-t / DWELL_TAU));
}

/**
 * Discs push on each other. Overlapping pairs separate along the line between
 * them, split by the pair's own radii so a big disc shoulders a small one
 * aside rather than the other way round. Momentum-neutral: the pair's
 * radius-weighted centre does not move.
 */
export function separate(discs: Disc[], dt: number): void {
  const k = Math.min(1, dt * 9);
  for (let i = 0; i < discs.length; i++) {
    const a = discs[i];
    if (a.retire > 0) continue;
    for (let j = i + 1; j < discs.length; j++) {
      const b = discs[j];
      if (b.retire > 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const want = (a.radius + b.radius) * 0.92;
      if (d >= want || d <= 1e-6) continue;
      const push = (want - d) * k;
      const ux = dx / d;
      const uy = dy / d;
      // heavier (larger) discs move less; the shares always sum to one
      const total = a.radius + b.radius;
      const aShare = b.radius / total;
      const bShare = a.radius / total;
      a.x -= ux * push * aShare;
      a.y -= uy * push * aShare;
      b.x += ux * push * bShare;
      b.y += uy * push * bShare;
      a.vx -= ux * push * aShare * 2;
      a.vy -= uy * push * aShare * 2;
      b.vx += ux * push * bShare * 2;
      b.vy += uy * push * bShare * 2;
    }
  }
}

/**
 * One drift step. Semi-implicit Euler with viscous drag, a slow deterministic
 * wander keyed to the seed, and walls that reflect with loss — a disc can
 * never leave the frame, and can never come off a wall faster than it hit it.
 */
export function stepDisc(d: Disc, dt: number, world: DiscWorld): void {
  if (dt <= 0) return;
  const calm = world.reducedMotion ? 0.15 : 1;
  const wander = Math.sin(d.born * 0.0007 + d.seed * 12.9898) * 0.012 * calm;
  d.vx += (world.wind * 0.35 + wander) * dt;
  d.vy += (-world.gravity * 0.35 + world.agitation * (d.seed - 0.5) * 0.6) * dt;

  const drag = Math.exp(-dt * 1.6);
  d.vx *= drag;
  d.vy *= drag;

  d.x += d.vx * dt;
  d.y += d.vy * dt;

  const wallX = Math.max(0.2, world.aspect) - d.radius * 0.55;
  const wallY = 1 - d.radius * 0.55;
  if (d.x > wallX) { d.x = wallX; d.vx = -Math.abs(d.vx) * 0.55; }
  if (d.x < -wallX) { d.x = -wallX; d.vx = Math.abs(d.vx) * 0.55; }
  if (d.y > wallY) { d.y = wallY; d.vy = -Math.abs(d.vy) * 0.55; }
  if (d.y < -wallY) { d.y = -wallY; d.vy = Math.abs(d.vy) * 0.55; }
}

export type OrbPalette = {
  a: [number, number, number];
  hot: [number, number, number];
  b: [number, number, number];
  glow: [number, number, number];
};

/** The three seasons the field walks through, in ring order. */
const SEASONS: OrbPalette[] = [
  {
    a: [1.0, 0.706, 0.431],
    hot: [1.0, 0.541, 0.235],
    b: [0.957, 0.91, 0.839],
    glow: [0.784, 0.451, 0.165],
  },
  {
    a: [0.435, 0.812, 0.894],
    hot: [0.173, 0.29, 0.361],
    b: [0.863, 0.933, 0.957],
    glow: [0.102, 0.227, 0.322],
  },
  {
    a: [1.0, 0.416, 0.235],
    hot: [0.878, 0.231, 0.165],
    b: [0.949, 0.933, 0.902],
    glow: [0.784, 0.267, 0.094],
  },
];

const mixTriple = (
  x: [number, number, number],
  y: [number, number, number],
  t: number,
): [number, number, number] => [
  x[0] + (y[0] - x[0]) * t,
  x[1] + (y[1] - x[1]) * t,
  x[2] + (y[2] - x[2]) * t,
];

/**
 * Season 0..1 → palette, continuously and cyclically. Three-finger twist is a
 * continuous axis, not a switch, so the season must never step: a quarter turn
 * lands a quarter of the way between two palettes and the ring closes.
 */
export function seasonPalette(season: number): OrbPalette {
  const n = SEASONS.length;
  const u = ((season % 1) + 1) % 1;
  const scaled = u * n;
  const i = Math.floor(scaled) % n;
  const t = scaled - Math.floor(scaled);
  const from = SEASONS[i];
  const to = SEASONS[(i + 1) % n];
  return {
    a: mixTriple(from.a, to.a, t),
    hot: mixTriple(from.hot, to.hot, t),
    b: mixTriple(from.b, to.b, t),
    glow: mixTriple(from.glow, to.glow, t),
  };
}
