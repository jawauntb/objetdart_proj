/**
 * flock — the murmuration's laws.
 *
 * The invariant is a boid parameter triple (separation, alignment, cohesion)
 * plus the wind. The flock's shape is a deterministic function of it: the same
 * seed and the same triple give the same sky, on any machine, at any refresh
 * rate. That last clause is why the integrator is FIXED-TIMESTEP with an
 * accumulator — a flock advanced by whatever the frame happened to be is a
 * different flock at 60 Hz and at 120 Hz, and the site's first law would be
 * false in the room that most needs it.
 *
 * The load-bearing map is the flock's ORDER PARAMETER → the harmonic series.
 * Order is the Vicsek order parameter: the magnitude of the mean heading,
 * 0 for a scattered sky and 1 for one animal. A scattered flock is heard as a
 * flat, detuned partial stack — chatter; a coherent murmuration collapses onto
 * a single ringing partial. And the map runs backwards: `orderFromPartials`
 * and `orderFromPartialFreqs` read the order back out of what you heard, so
 * the sound is a representation of the flock and not a decoration on it
 * (INSPIRATION.md §2).
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-flock.mjs).
 * See docs/plans/life-and-vista-bands.md §2 and §3.
 */

// ——— the sky, its size and its population ————————————————————————

/** Half-extents of the air the flock is allowed, in metres. */
export const WORLD_X = 34;
export const WORLD_Y = 15;
export const WORLD_Z = 34;
/** How far a bird sees. At this density it holds ~7 neighbours — the number
 *  real starlings actually track. */
export const PERCEPTION = 5.2;
/** Below this a neighbour is crowding, not company. */
export const SEPARATION_RADIUS = 2.4;
/** A bird is never still and never a bullet. */
export const MIN_SPEED = 5;
export const MAX_SPEED = 13;
/**
 * Deterministic ceilings on the work one bird does per step, so a tight
 * murmuration costs what open sky costs and the frame is bounded before the
 * flock is: at most this many neighbours counted, and at most this many
 * candidates walked to find them.
 */
export const MAX_NEIGHBORS = 16;
export const MAX_CANDIDATES = 48;
/** The air turns birds back before the wall does. */
export const BOUND_MARGIN = 7;

export const MIN_BIRDS = 200;
export const MAX_BIRDS = 4096;

/** The integrator's one true step. Everything else accumulates into it. */
export const FIXED_DT = 1 / 60;
/** After a long stall, drop the debt rather than spiral. */
export const MAX_STEPS_PER_ADVANCE = 6;
/** No single frame may hand the integrator more than this much time. */
export const MAX_FRAME_SEC = 0.25;

// force gains — the triple is a 0..2 dial on each of these
const ALIGN_K = 2.4;
const COH_K = 0.85;
const SEP_K = 26;
const BOUND_K = 4.5;

export type Vec3 = { x: number; y: number; z: number };

export type FlockParams = {
  /** 0..2 — how hard a bird refuses to be crowded. */
  separation: number;
  /** 0..2 — how hard it matches its neighbours' heading. */
  alignment: number;
  /** 0..2 — how hard it closes on their centre. */
  cohesion: number;
  /** An acceleration on the whole sky (the vessel steers this). */
  wind: Vec3;
  /** Where the flock is going — the season's heading, a unit vector. */
  goal: Vec3;
  /** How strongly the season pulls. */
  goalPull: number;
  /** A place in the sky the hand is holding. */
  lure?: Vec3;
  /** Positive gathers the flock to the lure, negative scatters it from there. */
  lurePull?: number;
  /** Rotation about the world's vertical, through the lure or the centre. */
  swirl?: number;
};

/** How far a held finger reaches into the sky. */
export const LURE_RADIUS = 18;

export type FlockState = {
  n: number;
  /** n*3 — metres. */
  pos: Float32Array;
  /** n*3 — metres per second. */
  vel: Float32Array;
  /** n*2 static — wing-phase offset (turns) and relative size. */
  bird: Float32Array;
  /** Seconds of unspent time held for the next fixed step. */
  acc: number;
  // ——— scratch, allocated once: the uniform grid that keeps the
  // neighbour search O(n) instead of O(n²).
  cellOf: Int32Array;
  cellStart: Int32Array;
  cursor: Int32Array;
  sorted: Int32Array;
  accel: Float32Array;
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

export const GRID_X = Math.ceil((2 * WORLD_X) / PERCEPTION);
export const GRID_Y = Math.ceil((2 * WORLD_Y) / PERCEPTION);
export const GRID_Z = Math.ceil((2 * WORLD_Z) / PERCEPTION);
const GRID_CELLS = GRID_X * GRID_Y * GRID_Z;

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

/** The population a screen may ask for, held between floor and cap. */
export function flockSize(request: number): number {
  if (!Number.isFinite(request)) return MIN_BIRDS;
  return Math.round(clamp(Math.floor(request), MIN_BIRDS, MAX_BIRDS));
}

/**
 * A sky from one seed.
 *
 * The flock arrives already flying — a loose body around a common heading,
 * denser at its middle, the way a flock that has been in the air for an hour
 * looks. The room must be alive before it is touched, and a random gas of
 * birds is not a flock; it is a thing that becomes one while you watch.
 */
export function seedFlock(seed: number, request: number): FlockState {
  const n = flockSize(request);
  const rng = mulberry32(seed >>> 0);
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const bird = new Float32Array(n * 2);
  const heading = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    // two uniforms make a triangle: a body with a middle, not a box
    pos[i * 3] = (rng() + rng() - 1) * WORLD_X * 0.55;
    pos[i * 3 + 1] = (rng() + rng() - 1) * WORLD_Y * 0.5;
    pos[i * 3 + 2] = (rng() + rng() - 1) * WORLD_Z * 0.55;
    const yaw = heading + (rng() - 0.5) * 2.6;
    const pitch = (rng() - 0.5) * 0.5;
    const sp = MIN_SPEED + rng() * (MAX_SPEED - MIN_SPEED);
    vel[i * 3] = Math.cos(yaw) * Math.cos(pitch) * sp;
    vel[i * 3 + 1] = Math.sin(pitch) * sp;
    vel[i * 3 + 2] = Math.sin(yaw) * Math.cos(pitch) * sp;
    bird[i * 2] = rng();
    bird[i * 2 + 1] = 0.75 + rng() * 0.55;
  }
  return {
    n,
    pos,
    vel,
    bird,
    acc: 0,
    cellOf: new Int32Array(n),
    cellStart: new Int32Array(GRID_CELLS + 1),
    cursor: new Int32Array(GRID_CELLS),
    sorted: new Int32Array(n),
    accel: new Float32Array(n * 3),
  };
}

function cellIndex(x: number, y: number, z: number): number {
  const cx = clamp(Math.floor((x + WORLD_X) / PERCEPTION), 0, GRID_X - 1);
  const cy = clamp(Math.floor((y + WORLD_Y) / PERCEPTION), 0, GRID_Y - 1);
  const cz = clamp(Math.floor((z + WORLD_Z) / PERCEPTION), 0, GRID_Z - 1);
  return (cz * GRID_Y + cy) * GRID_X + cx;
}

// ——— the integrator ——————————————————————————————————————————

/**
 * One fixed step. Never call this with a frame's delta — call `advanceFlock`,
 * which is the whole point.
 *
 * Three rules and two fields: neighbours inside PERCEPTION give alignment and
 * cohesion, neighbours inside SEPARATION_RADIUS push back with an inverse
 * square, the wind and the season's heading act on everyone, and the air turns
 * a bird before the wall clamps it.
 */
export function stepFlock(state: FlockState, params: FlockParams, dt: number): void {
  const { n, pos, vel, accel, cellOf, cellStart, cursor, sorted } = state;
  if (n === 0 || dt <= 0) return;

  // — the uniform grid, rebuilt by counting sort each step —
  cellStart.fill(0);
  for (let i = 0; i < n; i++) {
    const c = cellIndex(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    cellOf[i] = c;
    cellStart[c + 1] += 1;
  }
  for (let c = 0; c < GRID_CELLS; c++) cellStart[c + 1] += cellStart[c];
  cursor.set(cellStart.subarray(0, GRID_CELLS));
  for (let i = 0; i < n; i++) sorted[cursor[cellOf[i]]++] = i;

  const sep = Math.max(0, params.separation);
  const ali = Math.max(0, params.alignment);
  const coh = Math.max(0, params.cohesion);
  const percept2 = PERCEPTION * PERCEPTION;
  const sepR2 = SEPARATION_RADIUS * SEPARATION_RADIUS;

  for (let i = 0; i < n; i++) {
    const px = pos[i * 3];
    const py = pos[i * 3 + 1];
    const pz = pos[i * 3 + 2];
    const vx = vel[i * 3];
    const vy = vel[i * 3 + 1];
    const vz = vel[i * 3 + 2];

    let sumVx = 0;
    let sumVy = 0;
    let sumVz = 0;
    let sumPx = 0;
    let sumPy = 0;
    let sumPz = 0;
    let sepX = 0;
    let sepY = 0;
    let sepZ = 0;
    let seen = 0;
    let walked = 0;

    const cx = clamp(Math.floor((px + WORLD_X) / PERCEPTION), 0, GRID_X - 1);
    const cy = clamp(Math.floor((py + WORLD_Y) / PERCEPTION), 0, GRID_Y - 1);
    const cz = clamp(Math.floor((pz + WORLD_Z) / PERCEPTION), 0, GRID_Z - 1);

    outer: for (let gz = cz - 1; gz <= cz + 1; gz++) {
      if (gz < 0 || gz >= GRID_Z) continue;
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0 || gy >= GRID_Y) continue;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          if (gx < 0 || gx >= GRID_X) continue;
          const c = (gz * GRID_Y + gy) * GRID_X + gx;
          const from = cellStart[c];
          const to = cellStart[c + 1];
          for (let k = from; k < to; k++) {
            const j = sorted[k];
            if (j === i) continue;
            walked += 1;
            if (walked > MAX_CANDIDATES) break outer;
            const dx = pos[j * 3] - px;
            const dy = pos[j * 3 + 1] - py;
            const dz = pos[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > percept2) continue;
            sumVx += vel[j * 3];
            sumVy += vel[j * 3 + 1];
            sumVz += vel[j * 3 + 2];
            sumPx += pos[j * 3];
            sumPy += pos[j * 3 + 1];
            sumPz += pos[j * 3 + 2];
            if (d2 < sepR2) {
              // Inverse square, floored so a coincident pair still parts in
              // a definite direction instead of dividing by nothing.
              const w = 1 / Math.max(d2, 0.05);
              sepX -= dx * w;
              sepY -= dy * w;
              sepZ -= dz * w;
            }
            seen += 1;
            if (seen >= MAX_NEIGHBORS) break outer;
          }
        }
      }
    }

    let ax = 0;
    let ay = 0;
    let az = 0;
    if (seen > 0) {
      const inv = 1 / seen;
      ax += (sumVx * inv - vx) * ali * ALIGN_K;
      ay += (sumVy * inv - vy) * ali * ALIGN_K;
      az += (sumVz * inv - vz) * ali * ALIGN_K;
      ax += (sumPx * inv - px) * coh * COH_K;
      ay += (sumPy * inv - py) * coh * COH_K;
      az += (sumPz * inv - pz) * coh * COH_K;
    }
    ax += sepX * sep * SEP_K;
    ay += sepY * sep * SEP_K;
    az += sepZ * sep * SEP_K;

    ax += params.wind.x;
    ay += params.wind.y;
    az += params.wind.z;
    ax += params.goal.x * params.goalPull;
    ay += params.goal.y * params.goalPull;
    az += params.goal.z * params.goalPull;

    // the hand in the sky: a held finger gathers, a moving one scatters, and
    // a circling one turns the whole animal about its own axis
    const lurePull = params.lurePull ?? 0;
    const swirl = params.swirl ?? 0;
    if ((lurePull !== 0 || swirl !== 0) && params.lure) {
      const lx = params.lure.x - px;
      const ly = params.lure.y - py;
      const lz = params.lure.z - pz;
      const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (d < LURE_RADIUS && d > 1e-4) {
        // linear falloff: felt at the fingertip, gone at arm's length
        const w = (1 - d / LURE_RADIUS) / d;
        ax += lx * w * lurePull;
        ay += ly * w * lurePull;
        az += lz * w * lurePull;
        // and the tangent about the vertical, which is how a murmuration turns
        const r = Math.sqrt(lx * lx + lz * lz);
        if (r > 1e-4) {
          // positive swirl turns the flock counter-clockwise seen from above
          const t = (swirl * (1 - d / LURE_RADIUS)) / r;
          ax += lz * t;
          az += -lx * t;
        }
      }
    }

    // the air turns them back before the wall has to
    if (px > WORLD_X - BOUND_MARGIN) ax -= BOUND_K * (px - (WORLD_X - BOUND_MARGIN));
    else if (px < -WORLD_X + BOUND_MARGIN) ax -= BOUND_K * (px + WORLD_X - BOUND_MARGIN);
    if (py > WORLD_Y - BOUND_MARGIN) ay -= BOUND_K * (py - (WORLD_Y - BOUND_MARGIN));
    else if (py < -WORLD_Y + BOUND_MARGIN) ay -= BOUND_K * (py + WORLD_Y - BOUND_MARGIN);
    if (pz > WORLD_Z - BOUND_MARGIN) az -= BOUND_K * (pz - (WORLD_Z - BOUND_MARGIN));
    else if (pz < -WORLD_Z + BOUND_MARGIN) az -= BOUND_K * (pz + WORLD_Z - BOUND_MARGIN);

    accel[i * 3] = ax;
    accel[i * 3 + 1] = ay;
    accel[i * 3 + 2] = az;
  }

  for (let i = 0; i < n; i++) {
    let vx = vel[i * 3] + accel[i * 3] * dt;
    let vy = vel[i * 3 + 1] + accel[i * 3 + 1] * dt;
    let vz = vel[i * 3 + 2] + accel[i * 3 + 2] * dt;

    // The wall turns a bird BEFORE its speed is settled, so a bounce never
    // leaves anything flying slower than a bird flies.
    const nx = pos[i * 3] + vx * dt;
    const ny = pos[i * 3 + 1] + vy * dt;
    const nz = pos[i * 3 + 2] + vz * dt;
    if (nx > WORLD_X && vx > 0) vx = -vx * 0.6;
    else if (nx < -WORLD_X && vx < 0) vx = -vx * 0.6;
    if (ny > WORLD_Y && vy > 0) vy = -vy * 0.6;
    else if (ny < -WORLD_Y && vy < 0) vy = -vy * 0.6;
    if (nz > WORLD_Z && vz > 0) vz = -vz * 0.6;
    else if (nz < -WORLD_Z && vz < 0) vz = -vz * 0.6;

    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (sp > MAX_SPEED) {
      const k = MAX_SPEED / sp;
      vx *= k;
      vy *= k;
      vz *= k;
    } else if (sp < MIN_SPEED) {
      // A bird that has been stopped dead still leaves in some direction:
      // its own if it has one, the season's if it does not.
      const k = sp > 1e-6 ? MIN_SPEED / sp : 0;
      if (k > 0) {
        vx *= k;
        vy *= k;
        vz *= k;
      } else {
        vx = params.goal.x * MIN_SPEED;
        vy = params.goal.y * MIN_SPEED;
        vz = params.goal.z * MIN_SPEED;
      }
    }
    // and the sky is closed: whatever the wind, a bird is inside it.
    const px = clamp(pos[i * 3] + vx * dt, -WORLD_X, WORLD_X);
    const py = clamp(pos[i * 3 + 1] + vy * dt, -WORLD_Y, WORLD_Y);
    const pz = clamp(pos[i * 3 + 2] + vz * dt, -WORLD_Z, WORLD_Z);
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    pos[i * 3] = px;
    pos[i * 3 + 1] = py;
    pos[i * 3 + 2] = pz;
  }
}

/**
 * Hand the integrator a frame's worth of real time. It spends it in whole
 * FIXED_DT steps and carries the remainder, so the same elapsed time is the
 * same flock whether it arrived in one lump or in twenty — which is the only
 * reason the room looks the same on a 120 Hz phone as on a 60 Hz laptop.
 *
 * Returns how many fixed steps were taken.
 */
export function advanceFlock(state: FlockState, params: FlockParams, elapsedSec: number): number {
  const dt = Math.max(0, Math.min(MAX_FRAME_SEC, elapsedSec));
  state.acc += dt;
  let steps = 0;
  while (state.acc >= FIXED_DT && steps < MAX_STEPS_PER_ADVANCE) {
    stepFlock(state, params, FIXED_DT);
    state.acc -= FIXED_DT;
    steps += 1;
  }
  if (steps >= MAX_STEPS_PER_ADVANCE) state.acc = 0;
  return steps;
}

// ——— what the flock is, read off it ————————————————————————————

/**
 * The Vicsek order parameter: the magnitude of the mean unit heading. Exactly
 * 0 for a sky whose headings cancel (a regular ring, an opposed pair), exactly
 * 1 for one animal. Computed from the velocities alone — it knows nothing
 * about the integrator that made them, and nothing about where the observer
 * is standing.
 */
export function orderParameter(vel: Float32Array | number[], n: number): number {
  if (n <= 0) return 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    const x = vel[i * 3];
    const y = vel[i * 3 + 1];
    const z = vel[i * 3 + 2];
    const sp = Math.sqrt(x * x + y * y + z * z);
    if (sp < 1e-9) continue;
    mx += x / sp;
    my += y / sp;
    mz += z / sp;
    counted += 1;
  }
  if (counted === 0) return 0;
  return clamp01(Math.sqrt(mx * mx + my * my + mz * mz) / counted);
}

/** Where the whole animal is. */
export function centroid(pos: Float32Array | number[], n: number): Vec3 {
  if (n <= 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    x += pos[i * 3];
    y += pos[i * 3 + 1];
    z += pos[i * 3 + 2];
  }
  return { x: x / n, y: y / n, z: z / n };
}

/** How big the animal is: rms distance from its own centre. */
export function spread(pos: Float32Array | number[], n: number): number {
  if (n <= 0) return 0;
  const c = centroid(pos, n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3] - c.x;
    const dy = pos[i * 3 + 1] - c.y;
    const dz = pos[i * 3 + 2] - c.z;
    s += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(s / n);
}

/** Every bird inside the air it was given. */
export function withinBounds(pos: Float32Array | number[], n: number, eps = 1e-3): boolean {
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (Math.abs(x) > WORLD_X + eps) return false;
    if (Math.abs(y) > WORLD_Y + eps) return false;
    if (Math.abs(z) > WORLD_Z + eps) return false;
  }
  return true;
}

// ——— the map: order → the harmonic series —————————————————————

/** How many partials the flock is allowed to ring. */
export const PARTIALS = 6;
/** How far the partials are pulled off the harmonic series when scattered. */
export const MAX_STRETCH = 0.18;

/**
 * Order → partial amplitudes, L2-normalised.
 *
 * The ratio between successive partials is r = 1 − order. A scattered sky
 * (order 0, r 1) rings every partial equally — a flat stack, which is chatter;
 * one animal (order 1, r 0) puts everything in the fundamental and nothing
 * anywhere else. Between them the stack tilts smoothly, and the tilt IS the
 * order, which is what makes the next function possible.
 */
export function partialsForOrder(order: number, count = PARTIALS): number[] {
  const r = 1 - clamp01(order);
  const k = Math.max(1, Math.floor(count));
  const raw: number[] = [];
  let sum2 = 0;
  for (let i = 0; i < k; i++) {
    const a = Math.pow(r, i);
    raw.push(a);
    sum2 += a * a;
  }
  const norm = Math.sqrt(sum2) || 1;
  return raw.map((a) => a / norm);
}

/**
 * ...and back. The ratio of the second partial to the first is r, so the
 * order the flock had is 1 − r. This is the inverse that makes the sound a
 * representation of the flock rather than an accompaniment to it.
 */
export function orderFromPartials(amps: number[]): number | null {
  if (!amps || amps.length < 2) return null;
  if (!(amps[0] > 0)) return null;
  return clamp01(1 - amps[1] / amps[0]);
}

/**
 * Partial frequencies. At full order they are the harmonic series exactly —
 * k × the fundamental, the one case anybody can check by hand. Disorder
 * stretches them apart, so a scattered flock beats against itself.
 */
export function partialFreq(baseHz: number, k: number, order: number): number {
  const stretch = (1 - clamp01(order)) * MAX_STRETCH;
  const kk = Math.max(1, Math.floor(k));
  return baseHz * kk * (1 + stretch * (kk - 1));
}

/** The second inverse: the interval between the first two partials is also
 *  the order, read straight off two frequencies. */
export function orderFromPartialFreqs(f1: number, f2: number): number | null {
  if (!(f1 > 0) || !(f2 > 0)) return null;
  const stretch = f2 / (2 * f1) - 1;
  return clamp01(1 - stretch / MAX_STRETCH);
}

/** How often the flock calls: a scattered sky chatters, one animal rings. */
export const CALL_MIN_MS = 420;
export const CALL_MAX_MS = 1500;
export function callInterval(order: number): number {
  return CALL_MIN_MS + clamp01(order) * (CALL_MAX_MS - CALL_MIN_MS);
}

// ——— the world-law: seasons and the wind ——————————————————————

export const SEASONS = 4;

/**
 * Where the flock is going. Four seasons, four headings — north for the
 * return, east for the long light, south for the leaving, west for the
 * gathering. Any integer names a season; the year wraps.
 */
export function seasonGoal(season: number): Vec3 {
  const s = ((Math.round(season) % SEASONS) + SEASONS) % SEASONS;
  const a = (s / SEASONS) * Math.PI * 2;
  // a slight climb in spring and summer, a slight fall in autumn and winter
  const lift = Math.sin(a) * 0.22;
  const x = Math.sin(a);
  const z = -Math.cos(a);
  const m = Math.sqrt(x * x + lift * lift + z * z) || 1;
  return { x: x / m, y: lift / m, z: z / m };
}

/** The season's name, for the room's own use — never rendered as a caption. */
export const SEASON_LABELS = ["the return", "the long light", "the leaving", "the gathering"];

export function seasonIndex(season: number): number {
  return ((Math.round(season) % SEASONS) + SEASONS) % SEASONS;
}

/**
 * The vessel steers the wind. Tilt right and the air pushes right; tilt the
 * top of the device away and it pushes into the depth of the sky. Bounded by
 * `strength` in every direction, so no amount of tilt can blow the flock out
 * of the world.
 */
export function windFromTilt(beta: number, gamma: number, strength: number): Vec3 {
  const g = clamp(gamma / 40, -1, 1);
  const b = clamp((beta - 45) / 40, -1, 1);
  const s = Math.max(0, strength);
  return { x: g * s, y: -b * s * 0.35, z: b * s };
}

/** Wind magnitude, for anything that needs to hear how hard it is blowing. */
export function windStrength(w: Vec3): number {
  return Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
}
