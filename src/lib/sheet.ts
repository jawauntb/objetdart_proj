/**
 * sheet — when one becomes many.
 *
 * The invariant is an adhesion graph over a sheet of cells, plus each
 * cell's polarity. Everything the /tissue room shows or sounds is a
 * representation of that one graph: the soft body you can stroke and tear,
 * the pit that opens under a held finger, the fates that land as the front
 * sweeps, and — the load-bearing one — the chord.
 *
 * The map is adhesion topology → harmonic consonance, and it carries the
 * graph's degree spectrum without loss. Each cell sings the interval named
 * by how many neighbours still hold it: six is the unison of a knit sheet,
 * five a fifth, four a fourth, and downward through thirds to the ninth and
 * the tritone of a cell adrift. Because the degree→ratio table is injective
 * and each voice carries its own population weight, `chordDegreeCounts`
 * reads the exact degree histogram back out of the chord — the topology and
 * the harmony are one object seen twice. And because ratio complexity rises
 * strictly as degree falls, cutting a bond can only ever make the sheet more
 * dissonant: you hear the break before you see it.
 *
 * The body is Verlet with a fixed timestep and an accumulator, so 60 Hz and
 * 120 Hz run the identical substep sequence and the sheet is the same sheet
 * on either machine, deterministic from its seed.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-sheet.mjs).
 * See docs/plans/life-and-vista-bands.md §2 and INSPIRATION.md §2.
 */

// ——— the clock ————————————————————————————————————————————————

/** One substep. The sheet only ever moves in whole ones of these. */
export const DT = 1 / 120;
/** A tab returning from the background never gets to simulate a minute. */
export const MAX_SUBSTEPS = 8;

// ——— the material ————————————————————————————————————————————

export const MAX_CELLS = 460;
export const SPACING = 1;
export const CELL_R = 0.34;
/** A bond's rest length is the sum of the two radii, in lattice units. */
export const REST_RATIO = SPACING / (2 * CELL_R);
/** Between 1 (first ring) and √3 (second ring): exactly six neighbours. */
export const NEIGHBOR_MAX = 1.35;
export const RELAX_PASSES = 3;
/** Fraction of the length error a single relaxation pass removes. */
export const STIFFNESS = 0.5;
export const DAMPING = 0.986;
export const BREAK_STRAIN = 0.55;
export const HEAL_STRAIN = 0.1;
/** Below this a cell has nothing left to halve. */
export const MIN_DIVIDE_R = 0.13;

// ——— the pit ——————————————————————————————————————————————————

/** How far apical constriction can pull a bond in, as a fraction. */
export const APICAL_MAX = 0.62;
/** ...and the floor it can never pass, so no rest length reaches zero. */
export const MIN_REST_FACTOR = 0.34;
/** How deep the pit must be before its floor can seal into the inner layer. */
export const SEAL_DEPTH = 0.62;

// ——— the fates ————————————————————————————————————————————————

export const FATE_COUNT = 4;
/** The germ layer that comes of a sealed pit — terminal, never overwritten. */
export const INNER_FATE = 4;
/** Seconds the differentiation front takes to cross the whole morphogen. */
export const FATE_FRONT_SEC = 26;

// ——— determinism ————————————————————————————————————————————

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

/** Brownian noise with no state and no clock: −1..1 from two integers. */
export function jitterAt(i: number, step: number): number {
  let h = 0x811c9dc5 ^ (i | 0);
  h = Math.imul(h, 0x01000193) ^ (step | 0);
  h = Math.imul(h, 0x01000193);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

// ——— the state vector ————————————————————————————————————————

export type Sheet = {
  n: number;
  cap: number;
  /** position, and the previous position Verlet keeps velocity in */
  px: Float64Array;
  py: Float64Array;
  ox: Float64Array;
  oy: Float64Array;
  /** where the sheet remembers being — tissue is held, not adrift */
  hx: Float64Array;
  hy: Float64Array;
  r: Float64Array;
  /** apical–basal polarity, as an angle in the plane */
  pol: Float64Array;
  fate: Uint8Array;
  /** 0 at the surface, 1 fully invaginated */
  depth: Float64Array;
  ea: Int32Array;
  eb: Int32Array;
  /** apical constriction, as a factor on the bond's natural rest length */
  restF: Float64Array;
  live: Uint8Array;
  ecount: number;
  ecap: number;
  /** the integrator's unspent time, in seconds */
  acc: number;
  /** simulated seconds, advanced only in whole substeps */
  t: number;
  steps: number;
  spanX: number;
  spanY: number;
  seed: number;
};

function emptySheet(cap: number, ecap: number, seed: number): Sheet {
  return {
    n: 0,
    cap,
    px: new Float64Array(cap),
    py: new Float64Array(cap),
    ox: new Float64Array(cap),
    oy: new Float64Array(cap),
    hx: new Float64Array(cap),
    hy: new Float64Array(cap),
    r: new Float64Array(cap),
    pol: new Float64Array(cap),
    fate: new Uint8Array(cap),
    depth: new Float64Array(cap),
    ea: new Int32Array(ecap),
    eb: new Int32Array(ecap),
    restF: new Float64Array(ecap),
    live: new Uint8Array(ecap),
    ecount: 0,
    ecap,
    acc: 0,
    t: 0,
    steps: 0,
    spanX: 1,
    spanY: 1,
    seed,
  };
}

/**
 * A hexagonal epithelium: `cols × rows` cells on a triangular lattice,
 * bonded to every neighbour in the first ring. The jitter is small enough
 * that the first ring stays under NEIGHBOR_MAX and the second stays over
 * it, so an interior cell has exactly six neighbours whatever the seed.
 */
export function buildSheet(
  seed: number,
  cols: number,
  rows: number,
  jitter = 0.07,
  cap = MAX_CELLS,
  round = false,
): Sheet {
  const c = Math.max(2, Math.floor(cols));
  let rw = Math.max(2, Math.floor(rows));
  while (c * rw > cap) rw -= 1;
  const n = c * rw;
  const s = emptySheet(cap, n * 4 + cap, seed);
  const rng = mulberry32(seed >>> 0);
  const dy = (SPACING * Math.sqrt(3)) / 2;

  const rx = ((c - 1) / 2 + 0.5) * SPACING;
  const ry = ((rw - 1) / 2 + 0.5) * dy;
  for (let row = 0; row < rw; row++) {
    for (let col = 0; col < c; col++) {
      const x = (col + (row % 2) * 0.5 - (c - 1) / 2 - 0.25) * SPACING + (rng() * 2 - 1) * jitter;
      const y = (row - (rw - 1) / 2) * dy + (rng() * 2 - 1) * jitter;
      // A patch of epithelium has a margin, not a corner. The cull is on the
      // ideal lattice site, so the jitter never punches holes in the rim.
      if (round && (x / rx) ** 2 + (y / ry) ** 2 > 1) continue;
      const i = s.n++;
      s.px[i] = x;
      s.py[i] = y;
      s.ox[i] = x;
      s.oy[i] = y;
      s.hx[i] = x;
      s.hy[i] = y;
      s.r[i] = CELL_R;
      // Polarity points away from the sheet's centre — the outward face of
      // an epithelium is the face that meets the world.
      s.pol[i] = Math.atan2(y, x) + (rng() * 2 - 1) * 0.35;
      s.fate[i] = 0;
      s.depth[i] = 0;
    }
  }
  s.spanX = rx;
  s.spanY = ry;

  const maxD2 = (NEIGHBOR_MAX * SPACING) ** 2;
  for (let i = 0; i < s.n; i++) {
    for (let j = i + 1; j < s.n; j++) {
      const dx = s.px[j] - s.px[i];
      const dyy = s.py[j] - s.py[i];
      if (dx * dx + dyy * dyy <= maxD2) addEdge(s, i, j);
    }
  }
  return s;
}

function addEdge(s: Sheet, a: number, b: number): number {
  if (s.ecount >= s.ecap) return -1;
  const e = s.ecount++;
  s.ea[e] = a;
  s.eb[e] = b;
  s.restF[e] = 1;
  s.live[e] = 1;
  return e;
}

/** A bond's natural length: the two radii, less whatever holds it in. */
export function restLength(s: Sheet, e: number): number {
  return (s.r[s.ea[e]] + s.r[s.eb[e]]) * REST_RATIO * s.restF[e];
}

export function edgeLength(s: Sheet, e: number): number {
  const dx = s.px[s.eb[e]] - s.px[s.ea[e]];
  const dy = s.py[s.eb[e]] - s.py[s.ea[e]];
  return Math.sqrt(dx * dx + dy * dy);
}

/** How far past its rest a bond is being pulled. Negative is compression. */
export function strainOf(s: Sheet, e: number): number {
  const rest = restLength(s, e);
  if (rest <= 0) return 0;
  return (edgeLength(s, e) - rest) / rest;
}

/** Cadherin, as a threshold: a loose sheet lets go under its own weight. */
export function breakStrainFor(adhesion: number): number {
  const a = adhesion < 0 ? 0 : adhesion > 1 ? 1 : adhesion;
  return BREAK_STRAIN * (0.35 + 1.3 * a);
}

export function totalArea(s: Sheet): number {
  let a = 0;
  for (let i = 0; i < s.n; i++) a += Math.PI * s.r[i] * s.r[i];
  return a;
}

export function constraintError(s: Sheet): number {
  let err = 0;
  for (let e = 0; e < s.ecount; e++) {
    if (!s.live[e]) continue;
    err += Math.abs(edgeLength(s, e) - restLength(s, e));
  }
  return err;
}

// ——— the integrator ————————————————————————————————————————

export type SheetForces = {
  /** gravity, in lattice units per second squared */
  gx: number;
  gy: number;
  /** brownian seethe */
  agitation: number;
  /** the world-law: how hard the bonds hold */
  adhesion: number;
  /** how strongly the sheet returns to the shape it remembers */
  homeK: number;
};

export const DEFAULT_FORCES: SheetForces = {
  gx: 0,
  gy: 0,
  agitation: 0.35,
  adhesion: 0.55,
  homeK: 5.5,
};

/**
 * One relaxation pass over the live bonds. Each endpoint is moved half the
 * length error times STIFFNESS, so a single bond's error is multiplied by
 * exactly (1 − STIFFNESS) per pass — the one case you can check by hand.
 */
export function relaxOnce(s: Sheet): void {
  for (let e = 0; e < s.ecount; e++) {
    if (!s.live[e]) continue;
    const a = s.ea[e];
    const b = s.eb[e];
    const dx = s.px[b] - s.px[a];
    const dy = s.py[b] - s.py[a];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-9) continue;
    const diff = ((d - restLength(s, e)) / d) * 0.5 * STIFFNESS;
    s.px[a] += dx * diff;
    s.py[a] += dy * diff;
    s.px[b] -= dx * diff;
    s.py[b] -= dy * diff;
  }
}

function substep(s: Sheet, f: SheetForces): void {
  const step = s.steps;
  const dt2 = DT * DT;
  const agit = f.agitation;
  const k = f.homeK;
  for (let i = 0; i < s.n; i++) {
    const vx = (s.px[i] - s.ox[i]) * DAMPING;
    const vy = (s.py[i] - s.oy[i]) * DAMPING;
    const ax = f.gx + agit * jitterAt(i, step) - k * (s.px[i] - s.hx[i]);
    const ay = f.gy + agit * jitterAt(i, step + 7919) - k * (s.py[i] - s.hy[i]);
    s.ox[i] = s.px[i];
    s.oy[i] = s.py[i];
    s.px[i] += vx + ax * dt2;
    s.py[i] += vy + ay * dt2;
  }
  for (let p = 0; p < RELAX_PASSES; p++) relaxOnce(s);

  // What the sheet can no longer hold, it lets go of; what it can reach
  // again under a strong enough adhesion, it takes back.
  const brk = breakStrainFor(f.adhesion);
  const canHeal = f.adhesion > 0.55;
  for (let e = 0; e < s.ecount; e++) {
    const st = strainOf(s, e);
    if (s.live[e]) {
      if (st > brk) s.live[e] = 0;
    } else if (canHeal && st < HEAL_STRAIN && st > -0.4) {
      s.live[e] = 1;
    }
  }
  s.t += DT;
  s.steps += 1;
}

/**
 * Advance by real elapsed time. The accumulator is the whole point: the
 * sheet only ever moves in whole DT substeps, so one second at 60 Hz and
 * one second at 120 Hz run the identical sequence and end in the identical
 * state. Returns the number of substeps actually taken.
 */
export function advance(s: Sheet, elapsedSec: number, f: SheetForces): number {
  s.acc += elapsedSec > 0 ? elapsedSec : 0;
  let steps = 0;
  while (s.acc >= DT && steps < MAX_SUBSTEPS) {
    substep(s, f);
    s.acc -= DT;
    steps += 1;
  }
  // A long stall is dropped, never repaid — the sheet must not spiral.
  if (steps >= MAX_SUBSTEPS) s.acc = 0;
  return steps;
}

// ——— the adhesion graph, read ————————————————————————————————

export const MAX_DEGREE = 6;

/** How many living bonds hold each cell. */
export function degreesOf(s: Sheet, out?: Uint8Array): Uint8Array {
  const d = out && out.length >= s.n ? out : new Uint8Array(s.n);
  d.fill(0, 0, s.n);
  for (let e = 0; e < s.ecount; e++) {
    if (!s.live[e]) continue;
    const a = s.ea[e];
    const b = s.eb[e];
    if (d[a] < MAX_DEGREE) d[a] += 1;
    if (d[b] < MAX_DEGREE) d[b] += 1;
  }
  return d;
}

/**
 * Degree → interval, as a just ratio. The table is injective (so the map
 * runs backwards) and its complexity p·q rises strictly as degree falls
 * (1, 6, 12, 20, 30, 72, 1440), which is what makes a cut bond audible:
 * every break moves weight from a simpler ratio to a rougher one and can
 * only ever raise the dissonance.
 */
export const DEGREE_NUM: readonly number[] = [45, 9, 6, 5, 4, 3, 1];
export const DEGREE_DEN: readonly number[] = [32, 8, 5, 4, 3, 2, 1];

export type Chord = {
  degree: number[];
  num: number[];
  den: number[];
  ratio: number[];
  /** the fraction of the sheet singing this interval; the weights sum to 1 */
  weight: number[];
};

/** The sheet's chord: one voice per degree present, weighted by population. */
export function chordOf(degrees: Uint8Array | number[], n: number): Chord {
  const counts = new Array<number>(MAX_DEGREE + 1).fill(0);
  const total = Math.min(n, degrees.length);
  for (let i = 0; i < total; i++) {
    const d = Math.max(0, Math.min(MAX_DEGREE, degrees[i] | 0));
    counts[d] += 1;
  }
  const chord: Chord = { degree: [], num: [], den: [], ratio: [], weight: [] };
  if (total === 0) return chord;
  for (let d = MAX_DEGREE; d >= 0; d--) {
    if (counts[d] === 0) continue;
    chord.degree.push(d);
    chord.num.push(DEGREE_NUM[d]);
    chord.den.push(DEGREE_DEN[d]);
    chord.ratio.push(DEGREE_NUM[d] / DEGREE_DEN[d]);
    chord.weight.push(counts[d] / total);
  }
  return chord;
}

/**
 * ...and the chord read back into the topology it came from. The interval
 * names the degree, the weight names how many cells stand at it — so the
 * degree histogram of the adhesion graph survives the trip into sound. The
 * map earns its place only because this exists.
 */
export function chordDegreeCounts(chord: Chord, n: number): number[] {
  const counts = new Array<number>(MAX_DEGREE + 1).fill(0);
  for (let k = 0; k < chord.num.length; k++) {
    let degree = -1;
    for (let d = 0; d <= MAX_DEGREE; d++) {
      if (DEGREE_NUM[d] === chord.num[k] && DEGREE_DEN[d] === chord.den[k]) {
        degree = d;
        break;
      }
    }
    if (degree < 0) continue;
    counts[degree] = Math.round(chord.weight[k] * n);
  }
  return counts;
}

/**
 * Weighted mean of log₂(p·q) — ratio complexity in the Euler spirit. A
 * sheet of nothing but unisons scores exactly 0; a sheet in pieces climbs
 * toward the tritone's log₂(1440).
 */
export function dissonance(chord: Chord): number {
  let sum = 0;
  let w = 0;
  for (let k = 0; k < chord.num.length; k++) {
    sum += chord.weight[k] * Math.log2(chord.num[k] * chord.den[k]);
    w += chord.weight[k];
  }
  return w > 0 ? sum / w : 0;
}

/** The chord as pitches, in hertz, over a root the band chooses. */
export function chordFrequencies(chord: Chord, rootHz: number): number[] {
  return chord.ratio.map((r) => rootHz * r);
}

/** One cell's voice: the interval its own coordination names. */
export function voiceOf(degree: number, rootHz: number): number {
  const d = Math.max(0, Math.min(MAX_DEGREE, degree | 0));
  return (rootHz * DEGREE_NUM[d]) / DEGREE_DEN[d];
}

// ——— the morphogen, and the fates it lands ————————————————————

export type MorphogenField = {
  k1: number;
  k2: number;
  p1: number;
  p2: number;
  a1: number;
  a2: number;
};

export function morphogenField(seed: number): MorphogenField {
  const rng = mulberry32(hashSeed(seed, 0x6d0f));
  const a1 = 0.45 + rng() * 0.25;
  return {
    k1: 1.1 + rng() * 1.3,
    k2: 1.7 + rng() * 2.1,
    p1: rng() * Math.PI * 2,
    p2: rng() * Math.PI * 2,
    a1,
    a2: 1 - a1,
  };
}

/**
 * The morphogen at a point, 0..1. `axis` turns the body axis — the same
 * landscape, read along a different direction, which is what a three-finger
 * twist does to the room's season.
 */
export function morphogenAt(f: MorphogenField, nx: number, ny: number, axis = 0): number {
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const u = nx * ca + ny * sa;
  const v = -nx * sa + ny * ca;
  const m = f.a1 * Math.sin(f.k1 * u * Math.PI + f.p1) + f.a2 * Math.sin(f.k2 * v * Math.PI + f.p2);
  const x = 0.5 + 0.5 * m;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** How far the differentiation front has swept. Monotone in time, always. */
export function fateFront(t: number): number {
  const u = t / FATE_FRONT_SEC;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/**
 * The fate at a point at a time — a pure function of position and clock.
 * Nothing is committed until the front has reached it; behind the front the
 * fate is whatever the morphogen says there. Monotone in t, so a cell's
 * fate can only ever land, never unland.
 */
export function fateAt(f: MorphogenField, nx: number, ny: number, axis: number, t: number): number {
  const m = morphogenAt(f, nx, ny, axis);
  if (m > fateFront(t)) return 0;
  const lvl = Math.floor(m * FATE_COUNT);
  return lvl < 0 ? 0 : lvl > FATE_COUNT - 1 ? FATE_COUNT - 1 : lvl;
}

/**
 * A fate that has landed stays landed, and a sealed germ layer is terminal.
 * Commitment is what makes the sweep a history rather than a shimmer.
 */
export function commitFate(prev: number, next: number): number {
  if (prev === INNER_FATE) return INNER_FATE;
  return next > prev ? next : prev;
}

/** Walk the sheet and let the front land what it has reached. */
export function commitFates(s: Sheet, f: MorphogenField, axis: number): number {
  let changed = 0;
  for (let i = 0; i < s.n; i++) {
    const nx = s.px[i] / Math.max(1e-6, s.spanX);
    const ny = s.py[i] / Math.max(1e-6, s.spanY);
    const next = commitFate(s.fate[i], fateAt(f, nx, ny, axis, s.t));
    if (next !== s.fate[i]) {
      s.fate[i] = next;
      changed += 1;
    }
  }
  return changed;
}

// ——— division ————————————————————————————————————————————————

/**
 * One cell becomes two. The spindle lies in the plane of the sheet,
 * perpendicular to apical–basal polarity, exactly as an epithelium's does.
 * Area is conserved: each daughter takes r/√2, so πr² = 2·π(r/√2)². Every
 * neighbour the mother held goes to whichever daughter is nearer — no bond
 * is dropped and none is doubled, so the topology (and therefore the chord)
 * stays honest through mitosis.
 *
 * Returns the daughter's index, or −1 when the sheet is full or the cell is
 * already too small to halve.
 */
export function divideCell(s: Sheet, i: number, seed: number): number {
  if (i < 0 || i >= s.n) return -1;
  if (s.n >= s.cap) return -1;
  if (s.r[i] < MIN_DIVIDE_R) return -1;
  const j = s.n++;
  const rng = mulberry32(hashSeed(seed, i, s.n));
  const axis = s.pol[i] + Math.PI / 2;
  const rn = s.r[i] / Math.SQRT2;
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  const sep = rn * 0.7;
  const vx = s.px[i] - s.ox[i];
  const vy = s.py[i] - s.oy[i];

  s.px[j] = s.px[i] + ux * sep;
  s.py[j] = s.py[i] + uy * sep;
  s.px[i] -= ux * sep;
  s.py[i] -= uy * sep;
  s.ox[j] = s.px[j] - vx;
  s.oy[j] = s.py[j] - vy;
  s.ox[i] = s.px[i] - vx;
  s.oy[i] = s.py[i] - vy;
  s.hx[j] = s.hx[i] + ux * sep;
  s.hy[j] = s.hy[i] + uy * sep;
  s.hx[i] -= ux * sep;
  s.hy[i] -= uy * sep;
  s.r[i] = rn;
  s.r[j] = rn;
  s.pol[j] = s.pol[i] + (rng() * 2 - 1) * 0.28;
  s.fate[j] = s.fate[i];
  s.depth[j] = s.depth[i];

  for (let e = 0; e < s.ecount; e++) {
    const a = s.ea[e];
    const b = s.eb[e];
    let k = -1;
    let mine = -1;
    if (a === i) {
      k = b;
      mine = 0;
    } else if (b === i) {
      k = a;
      mine = 1;
    }
    if (k < 0 || k === j) continue;
    const di = (s.px[k] - s.px[i]) ** 2 + (s.py[k] - s.py[i]) ** 2;
    const dj = (s.px[k] - s.px[j]) ** 2 + (s.py[k] - s.py[j]) ** 2;
    if (dj < di) {
      if (mine === 0) s.ea[e] = j;
      else s.eb[e] = j;
    }
  }
  const ne = addEdge(s, i, j);
  if (ne >= 0) s.restF[ne] = 1;
  return j;
}

// ——— the pit ——————————————————————————————————————————————————

/**
 * Apical constriction. A held finger draws the bonds under it in and the
 * cells with them; the sheet has no choice but to buckle, which is
 * gastrulation. `amount` is 0..1 and only ever deepens — the pit does not
 * un-form while the finger is down. No rest length can fall below
 * MIN_REST_FACTOR of its natural length, so the integrator never meets a
 * zero-length bond.
 */
export function constrict(
  s: Sheet,
  cx: number,
  cy: number,
  radius: number,
  amount: number,
): number {
  const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  const r2 = radius * radius;
  let touched = 0;
  for (let i = 0; i < s.n; i++) {
    const d2 = (s.px[i] - cx) ** 2 + (s.py[i] - cy) ** 2;
    if (d2 > r2) continue;
    const falloff = 1 - Math.sqrt(d2) / radius;
    const want = a * falloff;
    if (want > s.depth[i]) s.depth[i] = want > 1 ? 1 : want;
    touched += 1;
  }
  for (let e = 0; e < s.ecount; e++) {
    const da = (s.px[s.ea[e]] - cx) ** 2 + (s.py[s.ea[e]] - cy) ** 2;
    const db = (s.px[s.eb[e]] - cx) ** 2 + (s.py[s.eb[e]] - cy) ** 2;
    if (da > r2 || db > r2) continue;
    const falloff = 1 - Math.sqrt(Math.max(da, db)) / radius;
    let target = 1 - APICAL_MAX * a * falloff;
    if (target < MIN_REST_FACTOR) target = MIN_REST_FACTOR;
    if (target < s.restF[e]) s.restF[e] = target;
  }
  return touched;
}

/** The pit opens back out when the finger leaves — unless it was sealed. */
export function relaxConstriction(s: Sheet, dt: number, rate = 0.6): void {
  const k = Math.min(1, Math.max(0, dt * rate));
  for (let e = 0; e < s.ecount; e++) {
    if (s.restF[e] < 1) s.restF[e] += (1 - s.restF[e]) * k;
  }
  for (let i = 0; i < s.n; i++) {
    if (s.fate[i] === INNER_FATE) continue;
    if (s.depth[i] > 0) s.depth[i] -= s.depth[i] * k;
  }
}

/**
 * The room's one solemn act: a pit held past the ceremony tier closes over,
 * and its floor becomes a second layer. Nothing is destroyed — the cell
 * count is untouched — the sheet simply has an inside now.
 */
export function sealPit(s: Sheet, cx: number, cy: number, radius: number): number {
  const r2 = radius * radius;
  let sealed = 0;
  for (let i = 0; i < s.n; i++) {
    if (s.fate[i] === INNER_FATE) continue;
    if (s.depth[i] < SEAL_DEPTH) continue;
    if ((s.px[i] - cx) ** 2 + (s.py[i] - cy) ** 2 > r2) continue;
    s.fate[i] = INNER_FATE;
    s.depth[i] = 1;
    sealed += 1;
  }
  return sealed;
}

// ——— tearing ————————————————————————————————————————————————

function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * A stroke that cuts: every living bond the line actually crosses lets go,
 * and nothing else does. Returns how many bonds were opened.
 */
export function tearAcross(
  s: Sheet,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let cut = 0;
  for (let e = 0; e < s.ecount; e++) {
    if (!s.live[e]) continue;
    const a = s.ea[e];
    const b = s.eb[e];
    if (segmentsCross(s.px[a], s.py[a], s.px[b], s.py[b], x0, y0, x1, y1)) {
      s.live[e] = 0;
      cut += 1;
    }
  }
  return cut;
}

// ——— apoptosis ————————————————————————————————————————————————

/**
 * A single cell resorbed — the room's other solemn act, and the
 * touch-reachable per-cell delete. Every bond the cell held is dropped
 * outright (not merely slackened: a stale edge left dangling could later
 * heal into a bond that was never physically there once the slot is
 * reused). The cell is then removed by swapping the last live cell into
 * its slot, so `0..n-1` stays packed and every other index keeps its
 * meaning.
 *
 * Nothing needs to be rewired to close the gap: in a hex sheet the six
 * cells around any interior cell are already pairwise bonded to their
 * neighbours in the ring (each pair sixty degrees apart sits exactly one
 * `SPACING` from the other, same as from the centre), so the ring the
 * removed cell sat inside was never held open only by that cell. Losing it
 * just lets the ring relax onto the space, the way `advance`'s homing pull
 * already does for every gap.
 */
export function apoptose(s: Sheet, i: number): boolean {
  if (i < 0 || i >= s.n) return false;
  let e = 0;
  while (e < s.ecount) {
    if (s.ea[e] === i || s.eb[e] === i) {
      const last = s.ecount - 1;
      s.ea[e] = s.ea[last];
      s.eb[e] = s.eb[last];
      s.restF[e] = s.restF[last];
      s.live[e] = s.live[last];
      s.ecount -= 1;
      continue; // re-check this slot, which now holds the swapped edge
    }
    e += 1;
  }
  const lastCell = s.n - 1;
  if (i !== lastCell) {
    s.px[i] = s.px[lastCell];
    s.py[i] = s.py[lastCell];
    s.ox[i] = s.ox[lastCell];
    s.oy[i] = s.oy[lastCell];
    s.hx[i] = s.hx[lastCell];
    s.hy[i] = s.hy[lastCell];
    s.r[i] = s.r[lastCell];
    s.pol[i] = s.pol[lastCell];
    s.fate[i] = s.fate[lastCell];
    s.depth[i] = s.depth[lastCell];
    for (let k = 0; k < s.ecount; k++) {
      if (s.ea[k] === lastCell) s.ea[k] = i;
      if (s.eb[k] === lastCell) s.eb[k] = i;
    }
  }
  s.n -= 1;
  return true;
}

// ——— finding things ————————————————————————————————————————

export function nearestCell(s: Sheet, x: number, y: number, maxDist = Infinity): number {
  let best = -1;
  let bd = maxDist * maxDist;
  for (let i = 0; i < s.n; i++) {
    const d2 = (s.px[i] - x) ** 2 + (s.py[i] - y) ** 2;
    if (d2 < bd) {
      bd = d2;
      best = i;
    }
  }
  return best;
}

/** Squared distance from a point to a segment — for stroke corridors. */
export function distToSegment2(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x0 + dx * t;
  const qy = y0 + dy * t;
  return (px - qx) ** 2 + (py - qy) ** 2;
}

// ——— what the room keeps ————————————————————————————————————

export type SheetPack = {
  v: 1;
  seed: number;
  n: number;
  spanX: number;
  spanY: number;
  x: number[];
  y: number[];
  r: number[];
  p: number[];
  f: number[];
  d: number[];
  ea: number[];
  eb: number[];
  rf: number[];
  lv: number[];
};

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export function packSheet(s: Sheet): SheetPack {
  const x: number[] = [];
  const y: number[] = [];
  const r: number[] = [];
  const p: number[] = [];
  const f: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < s.n; i++) {
    x.push(round4(s.px[i]));
    y.push(round4(s.py[i]));
    r.push(round4(s.r[i]));
    p.push(round4(s.pol[i]));
    f.push(s.fate[i]);
    d.push(round4(s.depth[i]));
  }
  const ea: number[] = [];
  const eb: number[] = [];
  const rf: number[] = [];
  const lv: number[] = [];
  for (let e = 0; e < s.ecount; e++) {
    ea.push(s.ea[e]);
    eb.push(s.eb[e]);
    rf.push(round4(s.restF[e]));
    lv.push(s.live[e]);
  }
  return { v: 1, seed: s.seed, n: s.n, spanX: s.spanX, spanY: s.spanY, x, y, r, p, f, d, ea, eb, rf, lv };
}

export function unpackSheet(pack: SheetPack | null | undefined, cap = MAX_CELLS): Sheet | null {
  if (!pack || pack.v !== 1 || !Array.isArray(pack.x)) return null;
  const n = Math.min(cap, pack.n | 0, pack.x.length);
  if (n <= 0) return null;
  const ecount = Math.min(pack.ea.length, pack.eb.length);
  const s = emptySheet(cap, ecount + cap + 8, pack.seed | 0);
  s.n = n;
  s.spanX = pack.spanX || 1;
  s.spanY = pack.spanY || 1;
  for (let i = 0; i < n; i++) {
    s.px[i] = pack.x[i];
    s.py[i] = pack.y[i];
    s.ox[i] = pack.x[i];
    s.oy[i] = pack.y[i];
    s.hx[i] = pack.x[i];
    s.hy[i] = pack.y[i];
    s.r[i] = pack.r[i] ?? CELL_R;
    s.pol[i] = pack.p[i] ?? 0;
    s.fate[i] = pack.f[i] ?? 0;
    s.depth[i] = pack.d[i] ?? 0;
  }
  for (let e = 0; e < ecount; e++) {
    const a = pack.ea[e] | 0;
    const b = pack.eb[e] | 0;
    if (a < 0 || b < 0 || a >= n || b >= n || a === b) continue;
    const ne = addEdge(s, a, b);
    if (ne < 0) break;
    s.restF[ne] = pack.rf[e] ?? 1;
    s.live[ne] = pack.lv[e] ? 1 : 0;
  }
  return s;
}
