/**
 * The shells — icosahedral capsid symmetry, as laws.
 *
 * Inside the organelles band a hollow shell of protein **subunits** assembles
 * itself out of a warm medium by nothing but its own symmetry rule. This module
 * is that rule and every law the shells obey: the Caspar–Klug arithmetic that
 * decides how many subunits a shell of class T carries (exactly 60·T, always),
 * the geodesic bookkeeping of an icosahedron (12 vertices, 30 edges, 20 faces —
 * and the 2·3·5 rotation axes that fall out of them), the conserved traffic of
 * subunits through assembly, templating and dissolution (nothing is ever minted
 * or lost, only moved between the free medium and the shells), the bounded
 * Brownian drift that keeps the medium alive at rest, and the season's slow
 * wander of a shell's fidelity between perfect symmetry and the nearby classes.
 *
 * The causal identity: a shell IS its symmetry class T plus the geometric seed
 * it carries. Two shells of the same class and seed are geometrically identical
 * and ring alike — identity is the shape's rule, not its place, exactly as a
 * mineral is its lattice on /rocks.
 *
 * Pure math, no DOM, no audio, no imports, no Math.random — node-testable
 * (scripts/test-viruses.mjs). The component (src/components/Viruses.tsx) renders
 * what these laws decide and nothing else.
 */

// ——— constants ———————————————————————————————————————————————————————————

/** Log10 metres of a capsid shell — ~100nm, the middle of the organelles band. */
export const SHELL_S = -7.0;

/** Every icosahedral class carries exactly this many subunits per T. */
export const SUBUNITS_PER_T = 60;

/** How many shells may stand; past this the oldest is dissolved back to medium. */
export const SHELL_CAP = 24;

/** Normalized closeness at which a carried shell docks a templating surface. */
export const DOCK_REACH = 0.05;

/** Damping of Brownian velocity, per second — the medium is viscous. */
export const DRIFT_DAMP = 1.6;

/** The medium starts holding this many free subunits, drifting, unassembled. */
export const MEDIUM_START_FREE = SUBUNITS_PER_T * 40;

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

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ——— the Caspar–Klug ladder ——————————————————————————————————————————————
// A triangulation number is T = h² + h·k + k² for non-negative integers h, k.
// The allowed classes are exactly those values — 1, 3, 4, 7, 12, 13, … — and
// climbing them is how a shell adds rings of subunits.

/** True when t is a valid Caspar–Klug triangulation number. */
export function isCKNumber(t: number): boolean {
  if (!Number.isInteger(t) || t < 1) return false;
  for (let h = 0; h * h <= t; h++) {
    for (let k = 0; k <= h; k++) {
      if (h * h + h * k + k * k === t) return true;
    }
  }
  return false;
}

/** The sorted ladder of valid T-numbers, up to `cap`. Deterministic. */
export function ckLadder(cap = 25): number[] {
  const set = new Set<number>();
  for (let h = 0; h * h <= cap; h++) {
    for (let k = 0; k <= h; k++) {
      const t = h * h + h * k + k * k;
      if (t >= 1 && t <= cap) set.add(t);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** The room's fixed ladder — the classes a shell may ever hold. */
export const CK_LADDER: readonly number[] = ckLadder(25);

/** The nearest valid T at or above `t` on the ladder. */
export function nearestCK(t: number): number {
  let best = CK_LADDER[0];
  let bestD = Infinity;
  for (const c of CK_LADDER) {
    const d = Math.abs(c - t);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** The next class up the ladder, or the same one at the top. */
export function nextT(t: number): number {
  const i = CK_LADDER.indexOf(nearestCK(t));
  return CK_LADDER[Math.min(CK_LADDER.length - 1, i + 1)];
}

/** The previous class down the ladder, or the same one at the floor. */
export function prevT(t: number): number {
  const i = CK_LADDER.indexOf(nearestCK(t));
  return CK_LADDER[Math.max(0, i - 1)];
}

// ——— the counts that fall out of T ———————————————————————————————————————

/** A shell of class T is built from exactly 60·T protein subunits. */
export function subunitCount(t: number): number {
  return SUBUNITS_PER_T * Math.max(1, Math.round(t));
}

/** Capsomers (clustered subunits) on the shell: 10T + 2 of them. */
export function capsomerCount(t: number): number {
  return 10 * Math.max(1, Math.round(t)) + 2;
}

/** Pentamers sit at the twelve five-fold vertices — always exactly twelve. */
export function pentamerCount(): number {
  return 12;
}

/** Everything that is not a pentamer is a hexamer: 10·(T − 1) of them. */
export function hexamerCount(t: number): number {
  return capsomerCount(t) - pentamerCount();
}

// ——— the icosahedron, and the axes it grants ————————————————————————————

/** The icosahedron's Euler counts — V − E + F = 2, always. */
export const ICOSA = { vertices: 12, edges: 30, faces: 20 } as const;

/**
 * The three rotation-axis families of icosahedral symmetry, each an
 * antipodal pair of features: 6 five-fold axes (through 12 vertices),
 * 10 three-fold (through 20 faces), 15 two-fold (through 30 edges).
 * They sum to the 60 rotations of the icosahedral group — the same 60
 * that lifts each triangular facet into 60·T subunits.
 */
export function symmetryAxes(): { fivefold: number; threefold: number; twofold: number } {
  return {
    fivefold: ICOSA.vertices / 2,
    threefold: ICOSA.faces / 2,
    twofold: ICOSA.edges / 2,
  };
}

/** The twelve icosahedral vertices, unit-normalized. The five-fold seats. */
export function icosaVertices(): [number, number, number][] {
  const p = (1 + Math.sqrt(5)) / 2; // the golden ratio
  const raw: [number, number, number][] = [
    [-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0],
    [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p],
    [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1],
  ];
  const m = Math.hypot(1, p);
  return raw.map(([x, y, z]) => [x / m, y / m, z / m]);
}

/**
 * A shell's capsomers as points on the unit disc, deterministic from its seed.
 * A sunflower phyllotaxis gives capsomerCount(t) seats; the twelve five-fold
 * pentamers are evenly spaced through them, the rest hexamers. The layout is a
 * pure function of (t, seed): the same class and seed always draw the same
 * shell, which is the room's whole identity claim, made checkable.
 */
export function capsomers(t: number, seed: number): { u: number; v: number; penta: boolean }[] {
  const n = capsomerCount(t);
  const ga = Math.PI * (3 - Math.sqrt(5)); // the golden angle
  const a0 = mulberry32(seed)() * Math.PI * 2;
  // twelve evenly-spread indices are the pentamers
  const penta = new Set<number>();
  for (let k = 0; k < 12; k++) penta.add(Math.round((k * (n - 1)) / 11));
  const out: { u: number; v: number; penta: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * ga + a0;
    out.push({ u: r * Math.cos(a), v: r * Math.sin(a), penta: penta.has(i) });
  }
  return out;
}

// ——— the shell ———————————————————————————————————————————————————————————

export type Shell = {
  id: number;
  /** the geometric seed — with T, the whole causal identity of the shell. */
  seed: number;
  /** the Caspar–Klug class; subunit count, capsomer count and ring all at once. */
  t: number;
  nx: number;
  ny: number;
  /** Brownian velocity, normalized units per second. */
  vx: number;
  vy: number;
  bornMs: number;
  /** 0..1 how far assembled — a fresh dwell fills it, and it climbs with T. */
  assembly: number;
  /** 0..1 excitation — it pulses when struck and the pulse decays. */
  pulse: number;
  /** 0 = a closed shell, 1 = folded open into its flat geodesic net (ceremony). */
  net: number;
  /** 0..1 per-shell symmetry fidelity — cold is 1 (perfect), warm wanders. */
  fidelity: number;
  /** 1 while it stands, falling to 0 as it is dissolved. Removed at 0. */
  presence: number;
};

export function bornShell(
  id: number,
  seed: number,
  t: number,
  nx: number,
  ny: number,
  tMs: number,
): Shell {
  const rng = mulberry32(seed);
  return {
    id,
    seed,
    t: nearestCK(t),
    nx: clamp(nx, 0.05, 0.95),
    ny: clamp(ny, 0.05, 0.95),
    vx: (rng() - 0.5) * 0.02,
    vy: (rng() - 0.5) * 0.02,
    bornMs: tMs,
    assembly: 0.12,
    pulse: 0.6,
    net: 0,
    fidelity: 1,
    presence: 1,
  };
}

/** Heavier shells (more subunits) are jostled less by the same medium — inertia. */
export function brownianInertia(t: number): number {
  return 1 / (0.6 + (subunitCount(t) / SUBUNITS_PER_T) * 0.4);
}

/** Class → pitch. A larger shell rings lower — monotone, all of it audible. */
export function shellPitchMidi(t: number): number {
  const i = CK_LADDER.indexOf(nearestCK(t));
  return 92 - i * 3;
}

/** Class → drawn radius, normalized. Grows sublinearly (area carries the T). */
export function shellRadius(t: number): number {
  return 0.05 + 0.018 * Math.sqrt(Math.max(1, t) - 1);
}

// ——— the medium: a conserved traffic of subunits ————————————————————————

export type Medium = {
  /** free subunits drifting in the medium, not yet part of any shell. */
  free: number;
  shells: Shell[];
};

/** The invariant the whole room protects: nothing is minted, nothing is lost. */
export function totalSubunits(m: Medium): number {
  let bound = 0;
  for (const s of m.shells) bound += subunitCount(s.t);
  return m.free + bound;
}

/**
 * A dwell on the medium: drifting subunits gather into a fresh T=1 shell,
 * drawn out of the free pool. Returns the shell's index, or -1 when the medium
 * has too few free subunits to seed one. Subunits move, never appear.
 */
export function assembleShell(
  m: Medium,
  id: number,
  seed: number,
  nx: number,
  ny: number,
  tMs: number,
): number {
  const need = subunitCount(1);
  if (m.free < need) return -1;
  m.free -= need;
  const s = bornShell(id, seed, 1, nx, ny, tMs);
  m.shells.push(s);
  return m.shells.length - 1;
}

/**
 * Climb one rung of the Caspar–Klug ladder: the shell takes on the next class,
 * drawing the extra 60·(T' − T) subunits from the free pool. No-op (returns
 * false) at the top of the ladder or when the medium cannot pay the difference.
 */
export function climbShell(m: Medium, i: number): boolean {
  const s = m.shells[i];
  if (!s) return false;
  const up = nextT(s.t);
  if (up === s.t) return false;
  const delta = subunitCount(up) - subunitCount(s.t);
  if (m.free < delta) return false;
  m.free -= delta;
  s.t = up;
  s.assembly = 1;
  s.pulse = Math.min(1, s.pulse + 0.4);
  return true;
}

/**
 * Dissolve a shell: its 60·T subunits scatter back into the free medium and
 * the shell is removed. The room's delete path is its create path reversed,
 * subunit for subunit. Returns how many subunits rejoined the medium.
 */
export function dissolveShell(m: Medium, i: number): number {
  const s = m.shells[i];
  if (!s) return 0;
  const back = subunitCount(s.t);
  m.free += back;
  m.shells.splice(i, 1);
  return back;
}

/**
 * Template a copy: a shell docked on a smooth surface prints a second shell
 * carrying the SAME seed and class — geometrically identical, ringing alike —
 * built from 60·T subunits drawn out of the medium. Geometric self-copying.
 * Returns the copy's index, or -1 when the medium cannot supply it.
 */
export function templateShell(m: Medium, i: number, id: number, tMs: number): number {
  const s = m.shells[i];
  if (!s) return -1;
  const need = subunitCount(s.t);
  if (m.free < need) return -1;
  m.free -= need;
  const copy = bornShell(id, s.seed, s.t, clamp(s.nx + 0.06, 0.05, 0.95), s.ny, tMs);
  copy.fidelity = s.fidelity;
  m.shells.push(copy);
  return m.shells.length - 1;
}

// ——— the season: fidelity wanders the shell to nearby classes ————————————

/**
 * How faithfully a shell holds its class. Cold (fidelity → 1) keeps perfect
 * symmetry; warm (fidelity → 0) lets the geometry wander to a neighbouring
 * Caspar–Klug number — never off the ladder, only to an allowed nearby class.
 */
export function wanderT(t: number, fidelity: number, seed: number): number {
  if (fidelity >= 1) return nearestCK(t);
  const rng = mulberry32(hashSeed(seed, Math.round((1 - fidelity) * 1000), t));
  if (rng() < fidelity) return nearestCK(t);
  const i = CK_LADDER.indexOf(nearestCK(t));
  const step = rng() < 0.5 ? -1 : 1;
  const j = clamp(i + step, 0, CK_LADDER.length - 1);
  return CK_LADDER[j];
}

// ——— the medium at rest: bounded Brownian drift ——————————————————————————

/**
 * Advance a shell's Brownian walk by dt seconds. Seeded kicks scaled by the
 * medium's temperature and the shell's inertia, damped, and reflected off the
 * frame — the churn never launches and never drains, and a shell never leaves
 * the medium. Deterministic from the shell's seed and the clock.
 */
export function driftShell(s: Shell, dt: number, temp: number, tMs: number): void {
  const d = clamp(dt, 0, 0.1);
  const rng = mulberry32(hashSeed(s.seed, Math.floor(tMs / 90)));
  const kick = 0.02 * temp * brownianInertia(s.t);
  s.vx += (rng() - 0.5) * kick;
  s.vy += (rng() - 0.5) * kick;
  const keep = Math.exp(-DRIFT_DAMP * d);
  s.vx *= keep;
  s.vy *= keep;
  s.nx += s.vx * d;
  s.ny += s.vy * d;
  const lo = 0.04;
  const hi = 0.96;
  if (s.nx < lo) { s.nx = lo; s.vx = Math.abs(s.vx) * 0.5; }
  if (s.nx > hi) { s.nx = hi; s.vx = -Math.abs(s.vx) * 0.5; }
  if (s.ny < lo) { s.ny = lo; s.vy = Math.abs(s.vy) * 0.5; }
  if (s.ny > hi) { s.ny = hi; s.vy = -Math.abs(s.vy) * 0.5; }
  s.assembly += (1 - s.assembly) * Math.min(1, d * 0.9);
  s.pulse *= Math.exp(-2.0 * d);
  if (s.presence < 1) s.presence = Math.max(0, s.presence - 0.6 * d);
}

/** Mark the oldest standing shell for dissolution; returns its index or -1. */
export function oldestStanding(m: Medium): number {
  let oldest = -1;
  let bornMs = Infinity;
  for (let i = 0; i < m.shells.length; i++) {
    const s = m.shells[i];
    if (s.presence >= 1 && s.bornMs < bornMs) {
      bornMs = s.bornMs;
      oldest = i;
    }
  }
  return oldest;
}

// ——— persistence ————————————————————————————————————————————————————————

export type KeptMedium = {
  v: 1;
  free: number;
  shells: Array<{ s: number; t: number; x: number; y: number; net: number; fid: number }>;
};

export function serializeMedium(m: Medium): KeptMedium {
  const out: KeptMedium = { v: 1, free: Math.round(m.free), shells: [] };
  for (const s of m.shells) {
    if (s.presence < 1) continue;
    out.shells.push({
      s: s.seed,
      t: s.t,
      x: Math.round(s.nx * 1000) / 1000,
      y: Math.round(s.ny * 1000) / 1000,
      net: Math.round(s.net * 100) / 100,
      fid: Math.round(s.fidelity * 100) / 100,
    });
  }
  return out;
}

export function loadMedium(raw: unknown, tMs: number): Medium {
  const m: Medium = { free: MEDIUM_START_FREE, shells: [] };
  if (!raw || typeof raw !== "object") return m;
  const kept = raw as Partial<KeptMedium>;
  if (kept.v !== 1 || !Array.isArray(kept.shells)) return m;
  if (typeof kept.free === "number" && isFinite(kept.free)) m.free = Math.max(0, kept.free);
  let id = 1;
  for (const k of kept.shells.slice(0, SHELL_CAP)) {
    if (!k || typeof k.x !== "number" || typeof k.y !== "number") continue;
    const s = bornShell(id++, (k.s ?? 1) >>> 0, k.t ?? 1, k.x, k.y, tMs);
    s.assembly = 1;
    s.pulse = 0;
    s.net = clamp01(k.net ?? 0);
    s.fidelity = clamp01(k.fid ?? 1);
    m.shells.push(s);
  }
  return m;
}
