/**
 * The local group — a few galaxies that fall together forever, as laws.
 *
 * At ~10^21 m the sky is not stars but galaxies: the Milky Way, Andromeda,
 * and their dwarf satellites, a small gravitationally-bound cluster wheeling
 * about a common barycenter. The room's population is **galaxies**, and this
 * module is every law they obey: softened N-body gravity so nothing diverges
 * when two centres coincide, a symplectic kick–drift integrator so a bound
 * orbit stays bound forever instead of spiralling out of a rounding error,
 * dynamical friction keyed to cosmic time (the three-finger season) that pulls
 * the group toward its future mergers, tidal stretching that trails a stream
 * off a satellite falling in, and a merger that coalesces two discs into one
 * with mass and momentum conserved to the last unit.
 *
 * A galaxy IS its mass, its angular momentum (spin) and its stellar age — two
 * on a bound orbit tidally stream and eventually merge into a third disc that
 * is neither parent; a satellite is defined by the orbit it keeps, not where
 * it happens to sit.
 *
 * Pure math, no DOM, no audio, no imports, no Math.random — node-testable
 * (scripts/test-localgroup.mjs). The component (src/components/LocalGroup.tsx)
 * renders what these laws decide and nothing else.
 */

// ——— constants ———————————————————————————————————————————————————————————

/** log10 metres near the middle of the space band — why the room sits ~1e21. */
export const LOCALGROUP_S = 21;

/** How many galaxies may wheel about the barycenter; past this the oldest goes. */
export const GALAXY_CAP = 24;

/** Newton's constant, tuned so a 0.2-wide orbit turns in ~20 s of felt time. */
export const G = 0.0006;

/** Plummer softening (normalized units): the reason a close pass is finite. */
export const SOFTENING = 0.03;

/** Centres closer than the sum of contact radii times this coalesce. */
export const MERGE_FACTOR = 0.62;

/** Beyond this distance from the barycenter a galaxy has left the group. */
export const ESCAPE_RADIUS = 1.35;

/** Presence lost per second once a galaxy is unbound and past the escape radius. */
export const UNBIND_RATE = 0.35;

/** Dynamical-friction strength — the drag cosmic time applies toward mergers. */
export const FRICTION_K = 0.9;

/** Reach (normalized) over which a galaxy feels the local density for friction. */
export const DENSITY_REACH = 0.28;

// ——— determinism ————————————————————————————————————————————————————————

/** Fold any number of parts into one 32-bit seed. The group's only dice. */
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

// ——— the galaxy ——————————————————————————————————————————————————————————

export type Galaxy = {
  id: number;
  /** the determinism law: every generated detail is a function of this. */
  seed: number;
  /** normalized position, the room's own frame. */
  nx: number;
  ny: number;
  /** velocity, normalized units per second. */
  vx: number;
  vy: number;
  /** mass in Milky-Way units — the galaxy's weight, pitch and pull all at once. */
  mass: number;
  /** angular momentum: the disc's signed spin, radians/sec of its own turn. */
  spin: number;
  /** stellar age, 0 young-and-blue … 1 old-and-red — a merger youngens it. */
  age: number;
  bornMs: number;
  /** 0..1 condensation out of the intergalactic medium; a dwell deepens it. */
  growth: number;
  /** 0..1 excitation — a supernova twinkle, a starburst; decays. */
  flare: number;
  /** 1 while it wheels, falling to 0 as it streams away. Removed at 0. */
  presence: number;
};

export function bornGalaxy(
  id: number,
  seed: number,
  nx: number,
  ny: number,
  mass: number,
  tMs: number,
): Galaxy {
  const rng = mulberry32(seed);
  const m = Math.max(0.02, mass);
  return {
    id,
    seed,
    nx,
    ny,
    vx: (rng() - 0.5) * 0.01,
    vy: (rng() - 0.5) * 0.01,
    mass: m,
    // heavier discs spin slower; direction is the seed's coin
    spin: (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5) / (0.6 + m),
    age: rng(),
    bornMs: tMs,
    growth: 0.12,
    flare: 0,
    presence: 1,
  };
}

/** Mass → visible disc radius, normalized. Grows sublinearly (light ∝ area). */
export function galaxyRadius(mass: number): number {
  return 0.03 + 0.05 * Math.cbrt(Math.max(0.02, mass));
}

/** Mass → dark-matter halo radius — several times the light, as in the sky. */
export function haloRadius(mass: number): number {
  return galaxyRadius(mass) * 2.9;
}

/**
 * Mass → pitch. Heavier galaxies ring lower — the same law every string obeys —
 * monotone across the group's whole mass range and always audible.
 */
export function galaxyPitchMidi(mass: number): number {
  const m = Math.max(0.02, Math.min(3, mass));
  // log so the dwarves are not all crammed at the top; clamped to stay audible
  const midi = 60 - Math.log2(m) * 8;
  return Math.round(Math.max(40, Math.min(100, midi)));
}

// ——— the barycenter: what the group falls about ——————————————————————————

export type Barycenter = { x: number; y: number; vx: number; vy: number; mass: number };

/** Mass-weighted centre of the standing group, and how it drifts. */
export function computeBarycenter(gals: Galaxy[]): Barycenter {
  let mx = 0;
  let my = 0;
  let mvx = 0;
  let mvy = 0;
  let m = 0;
  for (const g of gals) {
    if (g.presence < 0.5) continue;
    mx += g.nx * g.mass;
    my += g.ny * g.mass;
    mvx += g.vx * g.mass;
    mvy += g.vy * g.mass;
    m += g.mass;
  }
  if (m <= 0) return { x: 0.5, y: 0.5, vx: 0, vy: 0, mass: 0 };
  return { x: mx / m, y: my / m, vx: mvx / m, vy: mvy / m, mass: m };
}

/** Total linear momentum — the invariant a purely internal step must preserve. */
export function totalMomentum(gals: Galaxy[]): { px: number; py: number } {
  let px = 0;
  let py = 0;
  for (const g of gals) {
    if (g.presence < 0.5) continue;
    px += g.vx * g.mass;
    py += g.vy * g.mass;
  }
  return { px, py };
}

/**
 * Specific orbital energy of a galaxy in the group's barycentric frame.
 * Negative is bound (it will fall forever), non-negative is escaping. The
 * softened potential is the same one the integrator uses, so this and the
 * dynamics agree about what "bound" means.
 */
export function specificEnergy(g: Galaxy, bary: Barycenter): number {
  const dvx = g.vx - bary.vx;
  const dvy = g.vy - bary.vy;
  const dx = g.nx - bary.x;
  const dy = g.ny - bary.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  return 0.5 * (dvx * dvx + dvy * dvy) - (G * bary.mass) / (r + SOFTENING);
}

export function isBound(g: Galaxy, bary: Barycenter): boolean {
  return specificEnergy(g, bary) < 0;
}

// ——— the field: softened N-body gravity, symmetric so momentum holds ———————

export type FieldInput = {
  /** three-finger drag — a bulk wind across the group (external, kicks all). */
  windX: number;
  windY: number;
  /** vessel tilt — a uniform acceleration (external). */
  gravX: number;
  gravY: number;
  /** 0..1 shake — a seeded velocity scatter (external). */
  agitation: number;
  /**
   * cosmic time, 0..1. 0.5 is the present: orbits wheel forever. Wound
   * forward (>0.5) dynamical friction bleeds orbital energy and the group
   * falls toward its mergers; wound back (<0.5) the friction reverses and
   * the orbits widen. The three-finger season turns this dial.
   */
  epoch: number;
  /** 1 normally, < 1 while a three-finger hold dilates time. */
  timeScale: number;
  reduced: boolean;
};

const ax = new Float64Array(GALAXY_CAP * 2);
const ay = new Float64Array(GALAXY_CAP * 2);

/**
 * Advance the group by dt seconds with a symplectic kick–drift step.
 *
 * The mutual gravity is computed pairwise and applied equal-and-opposite, so
 * with no external field the total momentum is conserved exactly (up to float
 * error); the Plummer softening keeps every acceleration finite even when two
 * centres coincide. Dynamical friction (cosmic time) and the vessel's fields
 * are external and deliberately do move the total momentum — winding the
 * season is meant to change the group.
 */
export function stepGroup(gals: Galaxy[], input: FieldInput, tMs: number, dt: number): void {
  const n = gals.length;
  if (n === 0) return;
  const d = Math.max(0, Math.min(0.05, dt)) * input.timeScale;
  if (d <= 0) return;

  for (let i = 0; i < n; i++) {
    ax[i] = 0;
    ay[i] = 0;
  }

  // pairwise softened gravity, symmetric — this is the momentum-conserving core
  for (let i = 0; i < n; i++) {
    const A = gals[i];
    if (A.presence < 0.5) continue;
    for (let j = i + 1; j < n; j++) {
      const B = gals[j];
      if (B.presence < 0.5) continue;
      const dx = B.nx - A.nx;
      const dy = B.ny - A.ny;
      const r2 = dx * dx + dy * dy + SOFTENING * SOFTENING;
      const invR3 = 1 / (r2 * Math.sqrt(r2));
      const f = G * invR3; // per-unit-mass-pair
      ax[i] += f * B.mass * dx;
      ay[i] += f * B.mass * dy;
      ax[j] -= f * A.mass * dx;
      ay[j] -= f * A.mass * dy;
    }
  }

  // dynamical friction toward the barycentric rest frame, keyed to cosmic time
  const dir = input.epoch - 0.5;
  const bary = Math.abs(dir) > 1e-4 ? computeBarycenter(gals) : null;
  if (bary) {
    const reach2 = DENSITY_REACH * DENSITY_REACH;
    for (let i = 0; i < n; i++) {
      const A = gals[i];
      if (A.presence < 0.5) continue;
      let rho = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const B = gals[j];
        if (B.presence < 0.5) continue;
        const dx = B.nx - A.nx;
        const dy = B.ny - A.ny;
        const dd = dx * dx + dy * dy;
        if (dd < reach2) rho += B.mass * (1 - dd / reach2);
      }
      const k = FRICTION_K * dir * rho;
      ax[i] -= k * (A.vx - bary.vx);
      ay[i] -= k * (A.vy - bary.vy);
    }
  }

  // external fields: the wind, the vessel's lean, the shake — never internal
  for (let i = 0; i < n; i++) {
    const A = gals[i];
    if (A.presence < 0.5) continue;
    ax[i] += input.gravX * 0.02 + input.windX * 0.03;
    ay[i] += input.gravY * 0.02 + input.windY * 0.03;
    if (input.agitation > 0.01) {
      const rng = mulberry32(hashSeed(A.seed, Math.floor(tMs * 0.01)));
      ax[i] += (rng() - 0.5) * input.agitation * 0.4;
      ay[i] += (rng() - 0.5) * input.agitation * 0.4;
    }
  }

  // kick, then drift — symplectic Euler, the reason a bound orbit stays bound
  for (let i = 0; i < n; i++) {
    const A = gals[i];
    if (A.presence < 1) {
      // an escaping galaxy still coasts, and streams away as it goes
      A.nx += A.vx * d;
      A.ny += A.vy * d;
      A.presence = Math.max(0, A.presence - UNBIND_RATE * d);
      continue;
    }
    A.vx += ax[i] * d;
    A.vy += ay[i] * d;
    A.nx += A.vx * d;
    A.ny += A.vy * d;
    A.growth += (1 - A.growth) * Math.min(1, d * 0.6);
    if (A.flare > 0) A.flare = Math.max(0, A.flare - d * 0.7);
  }

  // a galaxy carried past the escape radius has left the group for good
  const bc = computeBarycenter(gals);
  for (const A of gals) {
    if (A.presence < 1) continue; // one already streaming keeps fading, not reset
    const dx = A.nx - bc.x;
    const dy = A.ny - bc.y;
    if (Math.sqrt(dx * dx + dy * dy) > ESCAPE_RADIUS) {
      A.presence = 0.999; // begin streaming away on the next steps
    }
  }
}

// ——— tides: the stretch that trails a stream off a satellite ——————————————

/**
 * Tidal stretch felt by a body of the given mass at a separation from a much
 * heavier neighbour: the differential pull, ∝ M/r³. Monotone in closeness, so
 * the closer a satellite falls the harder it is drawn out into a stream.
 */
export function tidalStretch(sep: number, neighbourMass: number): number {
  const r = Math.max(SOFTENING, sep);
  return (2 * G * neighbourMass) / (r * r * r);
}

/**
 * The dominant tidal partner for a galaxy: the heaviest neighbour whose tidal
 * stretch on it is strongest. Returns its index and the stretch, or -1.
 */
export function tidalPartner(gals: Galaxy[], i: number): { j: number; stretch: number } {
  const A = gals[i];
  let best = -1;
  let bestStretch = 0;
  for (let j = 0; j < gals.length; j++) {
    if (j === i) continue;
    const B = gals[j];
    if (B.presence < 0.5 || B.mass <= A.mass) continue;
    const dx = B.nx - A.nx;
    const dy = B.ny - A.ny;
    const s = tidalStretch(Math.sqrt(dx * dx + dy * dy), B.mass);
    if (s > bestStretch) {
      bestStretch = s;
      best = j;
    }
  }
  return { j: best, stretch: bestStretch };
}

// ——— meetings: mergers, condensation, kicks ——————————————————————————————

/** The closest pair whose centres are within their combined contact radius. */
export function findMergePair(gals: Galaxy[]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let a = 0; a < gals.length; a++) {
    const A = gals[a];
    if (A.presence < 1 || A.growth < 0.4) continue;
    for (let b = a + 1; b < gals.length; b++) {
      const B = gals[b];
      if (B.presence < 1 || B.growth < 0.4) continue;
      const dx = B.nx - A.nx;
      const dy = B.ny - A.ny;
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = (galaxyRadius(A.mass) + galaxyRadius(B.mass)) * MERGE_FACTOR;
      if (d < reach && d < bestD) {
        bestD = d;
        best = [a, b];
      }
    }
  }
  return best;
}

/**
 * Two galaxies coalesce into one disc that is neither parent: the mass is both
 * masses joined, the momentum is exactly the sum (so the child drifts as the
 * pair's centre of mass did), the place is the mass-weighted meeting point, the
 * spin folds both angular momenta plus the orbital angular momentum they were
 * carrying, the age youngens toward a starburst, and the seed folds both
 * histories so the result is a new galaxy, not a relabelling of either.
 */
export function mergeGalaxies(a: Galaxy, b: Galaxy, id: number, tMs: number): Galaxy {
  const M = a.mass + b.mass;
  const wa = a.mass / M;
  const wb = b.mass / M;
  const child = bornGalaxy(id, hashSeed(a.seed, b.seed, Math.round(M * 1000)), 0, 0, M, tMs);
  child.nx = a.nx * wa + b.nx * wb;
  child.ny = a.ny * wa + b.ny * wb;
  // momentum conserved: M·v_child = m_a·v_a + m_b·v_b
  child.vx = a.vx * wa + b.vx * wb;
  child.vy = a.vy * wa + b.vy * wb;
  // angular momentum: the discs' own spins plus the orbital term of the fall-in
  const rx = b.nx - a.nx;
  const ry = b.ny - a.ny;
  const dvx = b.vx - a.vx;
  const dvy = b.vy - a.vy;
  const orbital = (rx * dvy - ry * dvx) * wa * wb;
  child.spin = a.spin * wa + b.spin * wb + orbital * 6;
  // a merger is a starburst: young blue light floods the new disc
  child.age = Math.max(0, (a.age * wa + b.age * wb) * 0.5);
  child.growth = 1;
  child.flare = 1;
  return child;
}

/**
 * A dwarf condensed out of the intergalactic medium: it starts faint and
 * light, and a deepening dwell grows its mass and halo.
 */
export function condenseGalaxy(id: number, seed: number, nx: number, ny: number, tMs: number): Galaxy {
  const g = bornGalaxy(id, seed, nx, ny, 0.05, tMs);
  g.growth = 0.2;
  g.age = 0.15; // freshly condensed gas is young
  g.flare = 0.5;
  return g;
}

/**
 * A dwell deepens a condensing dwarf: mass climbs with the tier held, each
 * rung heavier and lower-voiced. Returns true when a new rung was reached.
 */
export function growDwarf(g: Galaxy, elapsedMs: number): boolean {
  const rung = Math.max(0, Math.floor((elapsedMs - 900) / 650));
  const target = 0.05 + rung * 0.14;
  if (target > g.mass) {
    g.mass = Math.min(1.5, target);
    g.flare = Math.min(1, g.flare + 0.2);
    return true;
  }
  return false;
}

/**
 * A flick imparts a velocity kick: the galaxy is flung along the throw, fast
 * enough to unbind it from the group. Returns the galaxy so a caller can trail
 * its tidal tail.
 */
export function kickGalaxy(g: Galaxy, angle: number, speed: number): Galaxy {
  const k = Math.min(3, speed) * 0.12;
  g.vx += Math.cos(angle) * k;
  g.vy += Math.sin(angle) * k;
  g.flare = Math.min(1, g.flare + 0.4);
  return g;
}

/** Mark the oldest standing galaxy retiring; returns its index or -1. */
export function retireOldest(gals: Galaxy[]): number {
  let oldest = -1;
  let bornMs = Infinity;
  for (let i = 0; i < gals.length; i++) {
    const g = gals[i];
    if (g.presence >= 1 && g.bornMs < bornMs) {
      bornMs = g.bornMs;
      oldest = i;
    }
  }
  if (oldest >= 0) gals[oldest].presence = 0.999;
  return oldest;
}

// ——— the starter group: the Milky Way, Andromeda, and their dwarves ————————

/**
 * The group as it stands on arrival, seeded — placed on a rough bound orbit so
 * it is already wheeling before a hand touches it. The two giants approach; the
 * dwarves keep their satellite orbits.
 */
export function seedLocalGroup(tMs: number): Galaxy[] {
  const spec: { nx: number; ny: number; mass: number; vx: number; vy: number }[] = [
    // the Milky Way and Andromeda, falling toward each other across the group
    { nx: 0.40, ny: 0.52, mass: 1.0, vx: 0.012, vy: 0.006 },
    { nx: 0.62, ny: 0.46, mass: 1.15, vx: -0.010, vy: 0.008 },
    // dwarf satellites on their own orbits about the giants
    { nx: 0.33, ny: 0.63, mass: 0.09, vx: 0.03, vy: -0.02 },
    { nx: 0.47, ny: 0.40, mass: 0.06, vx: -0.02, vy: -0.03 },
    { nx: 0.70, ny: 0.58, mass: 0.10, vx: 0.02, vy: -0.03 },
    { nx: 0.55, ny: 0.66, mass: 0.05, vx: -0.03, vy: 0.01 },
  ];
  return spec.map((s, i) => {
    const g = bornGalaxy(i + 1, hashSeed(0x10ca1, i), s.nx, s.ny, s.mass, tMs);
    g.vx = s.vx;
    g.vy = s.vy;
    g.growth = 1;
    return g;
  });
}

// ——— persistence ————————————————————————————————————————————————————————

export type KeptGroup = {
  v: 1;
  galaxies: Array<{
    s: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    m: number;
    sp: number;
    a: number;
  }>;
};

export function serializeGroup(gals: Galaxy[]): KeptGroup {
  const out: KeptGroup = { v: 1, galaxies: [] };
  for (const g of gals) {
    if (g.presence < 1) continue;
    out.galaxies.push({
      s: g.seed,
      x: Math.round(g.nx * 1000) / 1000,
      y: Math.round(g.ny * 1000) / 1000,
      vx: Math.round(g.vx * 10000) / 10000,
      vy: Math.round(g.vy * 10000) / 10000,
      m: Math.round(g.mass * 1000) / 1000,
      sp: Math.round(g.spin * 1000) / 1000,
      a: Math.round(g.age * 1000) / 1000,
    });
  }
  return out;
}

export function loadGroup(raw: unknown, tMs: number): Galaxy[] {
  const gals: Galaxy[] = [];
  if (!raw || typeof raw !== "object") return gals;
  const kept = raw as Partial<KeptGroup>;
  if (kept.v !== 1 || !Array.isArray(kept.galaxies)) return gals;
  for (const k of kept.galaxies.slice(0, GALAXY_CAP)) {
    if (!k || typeof k.x !== "number" || typeof k.y !== "number") continue;
    const g = bornGalaxy(gals.length + 1, (k.s ?? 1) >>> 0, k.x, k.y, k.m ?? 0.1, tMs);
    g.vx = Number.isFinite(k.vx) ? (k.vx as number) : g.vx;
    g.vy = Number.isFinite(k.vy) ? (k.vy as number) : g.vy;
    g.spin = Number.isFinite(k.sp) ? (k.sp as number) : g.spin;
    g.age = Number.isFinite(k.a) ? Math.max(0, Math.min(1, k.a as number)) : g.age;
    g.growth = 1;
    gals.push(g);
  }
  return gals;
}
