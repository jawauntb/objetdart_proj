/**
 * eigen-field — the laws of /eigen.
 *
 * The eigen is the surviving direction after a constraint collapses a cloud —
 * weakness / effective dimension / ICA gauge-fix, not Av=λv theatre.
 * Constraint_Swap: a shortcut (`aligned: false`) can "work" without dragging
 * the blob. Gauge-Fixed: killing an axis that does not change the task
 * readout was a footprint.
 *
 * Pure math. No DOM, no Math.random — node-testable
 * (scripts/test-eigen-field.mjs).
 */

export const CLOUD_N = 48;
export const CONSTRAINT_CAP = 6;
export const COLLINEAR = 0.95;

export type Vec = { x: number; y: number };

export type CloudPoint = {
  x: number;
  y: number;
  w: number;
};

export type Constraint = {
  id: number;
  seed: number;
  nx: number;
  ny: number;
  ux: number;
  uy: number;
  beta: number;
  /** false = shortcut: does not drag the cloud (Constraint_Swap). */
  aligned: boolean;
  gaussian: boolean;
  growth: number;
  presence: number;
};

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

export function unit(x: number, y: number): Vec {
  const n = Math.hypot(x, y);
  if (n < 1e-9) return { x: 1, y: 0 };
  return { x: x / n, y: y / n };
}

export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

export function deepenBeta(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs);
  return 1 - Math.exp(-t / 1400);
}

export function bornConstraint(
  id: number,
  seed: number,
  nx: number,
  ny: number,
  ux: number,
  uy: number,
  opts: { aligned?: boolean; gaussian?: boolean } = {},
): Constraint {
  const u = unit(ux, uy);
  return {
    id,
    seed: seed >>> 0,
    nx,
    ny,
    ux: u.x,
    uy: u.y,
    beta: 0.18,
    aligned: opts.aligned !== false,
    gaussian: opts.gaussian === true,
    growth: 0.12,
    presence: 1,
  };
}

function living(cs: readonly Constraint[]): Constraint[] {
  return cs.filter((c) => c.presence >= 1 && c.growth > 0.08);
}

/** Axes that actually drag the cloud: aligned, living, Gram–Schmidt, collinear dropped. */
export function survivingAxes(cs: readonly Constraint[]): Vec[] {
  const xs = living(cs).filter((c) => c.aligned);
  const axes: Vec[] = [];
  const sorted = [...xs].sort((a, b) => b.beta - a.beta);
  for (const c of sorted) {
    let x = c.ux * c.beta;
    let y = c.uy * c.beta;
    for (const a of axes) {
      const d = x * a.x + y * a.y;
      x -= d * a.x;
      y -= d * a.y;
    }
    const n = Math.hypot(x, y);
    if (n < 0.05) continue;
    axes.push({ x: x / n, y: y / n });
    if (axes.length >= 2) break;
  }
  return axes;
}

export function projectOnto(p: CloudPoint, axes: readonly Vec[]): CloudPoint {
  if (axes.length === 0) return { x: p.x, y: p.y, w: p.w };
  let x = 0;
  let y = 0;
  for (const a of axes) {
    const d = p.x * a.x + p.y * a.y;
    x += d * a.x;
    y += d * a.y;
  }
  return { x, y, w: p.w };
}

export function collapse(cloud: readonly CloudPoint[], cs: readonly Constraint[]): CloudPoint[] {
  const axes = survivingAxes(cs);
  return cloud.map((p) => projectOnto(p, axes));
}

function mean(cloud: readonly CloudPoint[]): Vec {
  let x = 0;
  let y = 0;
  let w = 0;
  for (const p of cloud) {
    x += p.x * p.w;
    y += p.y * p.w;
    w += p.w;
  }
  if (w < 1e-9) return { x: 0, y: 0 };
  return { x: x / w, y: y / w };
}

function covariance(cloud: readonly CloudPoint[]): { xx: number; xy: number; yy: number } {
  const m = mean(cloud);
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let w = 0;
  for (const p of cloud) {
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    xx += p.w * dx * dx;
    xy += p.w * dx * dy;
    yy += p.w * dy * dy;
    w += p.w;
  }
  if (w < 1e-9) return { xx: 0, xy: 0, yy: 0 };
  return { xx: xx / w, xy: xy / w, yy: yy / w };
}

/** 1 = a line, 2 = isotropic. Collinear collapse must sit near 1. */
export function effectiveDim(cloud: readonly CloudPoint[]): number {
  const c = covariance(cloud);
  const tr = c.xx + c.yy;
  if (tr < 1e-12) return 1;
  const disc = Math.sqrt(Math.max(0, (c.xx - c.yy) * (c.xx - c.yy) + 4 * c.xy * c.xy));
  const l1 = 0.5 * (tr + disc);
  const l2 = 0.5 * (tr - disc);
  const a = Math.max(l1, l2);
  const b = Math.max(0, Math.min(l1, l2));
  return 1 + b / (a + 1e-12);
}

/** Variance along a unit axis — the task readout a ceremony can change. */
export function taskReadout(cloud: readonly CloudPoint[], axis: Vec): number {
  const u = unit(axis.x, axis.y);
  const m = mean(cloud);
  let v = 0;
  let w = 0;
  for (const p of cloud) {
    const d = (p.x - m.x) * u.x + (p.y - m.y) * u.y;
    v += p.w * d * d;
    w += p.w;
  }
  return w < 1e-9 ? 0 : v / w;
}

export function commitmentShift(before: number, after: number, eps = 0.08): boolean {
  const scale = Math.max(1e-6, Math.abs(before) + Math.abs(after));
  return Math.abs(after - before) / scale > eps;
}

/**
 * Two collinear aligned constraints collapse to one (neither parent id).
 * Independent pair returns null — they unmix instead.
 */
export function mergeConstraints(a: Constraint, b: Constraint): Constraint | null {
  if (a.presence < 1 || b.presence < 1) return null;
  if (!a.aligned || !b.aligned) return null;
  if (Math.abs(dot({ x: a.ux, y: a.uy }, { x: b.ux, y: b.uy })) < COLLINEAR) return null;
  const beta = Math.max(a.beta, b.beta);
  const id = (hashSeed(a.id + 1, b.id + 1, 7) % 0x3fffffff) + 1;
  const u = unit(a.ux * a.beta + b.ux * b.beta, a.uy * a.beta + b.uy * b.beta);
  return {
    id,
    seed: hashSeed(a.seed, b.seed),
    nx: (a.nx * a.beta + b.nx * b.beta) / (a.beta + b.beta),
    ny: (a.ny * a.beta + b.ny * b.beta) / (a.beta + b.beta),
    ux: u.x,
    uy: u.y,
    beta,
    aligned: true,
    gaussian: a.gaussian && b.gaussian,
    growth: 1,
    presence: 1,
  };
}

function kurtosisAlong(cloud: readonly CloudPoint[], axis: Vec): number {
  const u = unit(axis.x, axis.y);
  const m = mean(cloud);
  let m2 = 0;
  let m4 = 0;
  let w = 0;
  for (const p of cloud) {
    const d = (p.x - m.x) * u.x + (p.y - m.y) * u.y;
    m2 += p.w * d * d;
    m4 += p.w * d * d * d * d;
    w += p.w;
  }
  if (w < 1e-9 || m2 < 1e-12) return 0;
  m2 /= w;
  m4 /= w;
  return m4 / (m2 * m2) - 3;
}

/**
 * ICA-style snap: pick the orthonormal frame that maximises |kurtosis|.
 * Non-Gaussian sources lock (unique up to perm/sign). A Gaussian cloud has
 * a flat kurtosis landscape — two nearby angles score the same, so the
 * rotational gauge is not fixed.
 */
export function icaSnap(cloud: readonly CloudPoint[], step = 16): Vec {
  let best = { x: 1, y: 0 };
  let bestK = -Infinity;
  for (let i = 0; i < step; i++) {
    const a = (i / step) * Math.PI;
    const u = { x: Math.cos(a), y: Math.sin(a) };
    const k = Math.abs(kurtosisAlong(cloud, u));
    if (k > bestK) {
      bestK = k;
      best = u;
    }
  }
  return best;
}

export function kurtosisLandscapeFlat(cloud: readonly CloudPoint[], tol = 0.35): boolean {
  const ks: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    ks.push(Math.abs(kurtosisAlong(cloud, { x: Math.cos(a), y: Math.sin(a) })));
  }
  const mx = Math.max(...ks);
  const mn = Math.min(...ks);
  return mx - mn < tol;
}

/** Seeded elongated cloud (physical 2-D, mostly 1-D variance). */
export function bornCloud(seed: number, n: number = CLOUD_N): CloudPoint[] {
  const rng = mulberry32(seed >>> 0);
  const out: CloudPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = (rng() - 0.5) * 1.6;
    const s = (rng() - 0.5) * 0.22;
    out.push({ x: t, y: s, w: 1 });
  }
  return out;
}

/** Two independent non-Gaussian sources mixed by a small rotation. */
export function mixedSources(seed: number, n: number = CLOUD_N): CloudPoint[] {
  const rng = mulberry32(seed >>> 0);
  const c = Math.cos(0.4);
  const s = Math.sin(0.4);
  const out: CloudPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (rng() < 0.5 ? 1 : -1) * (0.4 + rng() * 0.7);
    const b = (rng() < 0.5 ? 1 : -1) * (0.4 + rng() * 0.7);
    out.push({ x: c * a + s * b, y: -s * a + c * b, w: 1 });
  }
  return out;
}

/** Isotropic Gaussian-ish cloud (Box–Muller via two uniforms). */
export function gaussianCloud(seed: number, n: number = CLOUD_N): CloudPoint[] {
  const rng = mulberry32(seed >>> 0);
  const out: CloudPoint[] = [];
  for (let i = 0; i < n; i++) {
    const u = Math.max(1e-6, rng());
    const v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = v * Math.PI * 2;
    out.push({ x: r * Math.cos(th) * 0.5, y: r * Math.sin(th) * 0.5, w: 1 });
  }
  return out;
}

export function principalDirection(cloud: readonly CloudPoint[]): Vec {
  const c = covariance(cloud);
  const disc = Math.sqrt(Math.max(0, (c.xx - c.yy) * (c.xx - c.yy) + 4 * c.xy * c.xy));
  const l1 = 0.5 * (c.xx + c.yy + disc);
  if (Math.abs(c.xy) < 1e-12 && Math.abs(c.xx - l1) < 1e-12) return unit(1, 0);
  return unit(c.xy, l1 - c.xx);
}
