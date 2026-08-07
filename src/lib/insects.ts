/**
 * The swarm — bodies that are their behaviors.
 *
 * At the drop band (~0.3mm–3cm), a dusk meadow-edge fills with small flying
 * life, and the whole thesis of this room is that an insect is not a sprite:
 * it IS its behavior + its lifecycle stage + its causal role. A mote grazes,
 * a pollinator visits blooms, a predator hunts. This module is every law that
 * makes that true and nothing else — how an egg metamorphoses into a larva
 * and then an imago, how imagoes flock by alignment/cohesion/separation, how
 * they turn toward a lantern by phototaxis and follow a drawn scent, how a
 * predator pursues the nearest prey and the prey flee it, how two mature motes
 * that meet lay an egg that is neither parent, and how a breeze herds them all.
 *
 * Pure math: no DOM, no audio, no imports, no Math.random — node-testable
 * (scripts/test-insects.mjs). The component (src/components/Insects.tsx) renders
 * what these laws decide and says what each verb of the grammar means here.
 */

// ——— constants ———————————————————————————————————————————————————————————

/** log10 metres of the drop band's middle — why this room sits near -2.8. */
export const DROP_S = -2.8;

/** How many bodies may fly; past this the oldest fades out visibly. */
export const SWARM_CAP = 80;

/** Top speed, normalized units per second — the flock never launches. */
export const MAX_SPEED = 0.6;

/** Within this normalized reach two imagoes are flockmates. */
export const NEIGHBOR_REACH = 0.15;

/** Closer than this and separation dominates — no two bodies overlap. */
export const SEPARATION_REACH = 0.05;

/** A predator this close to prey has caught it. */
export const CATCH_REACH = 0.035;

/** A predator hunts the nearest prey within this reach. */
export const HUNT_REACH = 0.45;

/** Two mature motes closer than this may lay an egg. */
export const MATE_REACH = 0.045;

/** A bred mote will not breed again for this long (ms) — bounds the brood. */
export const BREED_COOLDOWN_MS = 5200;

/** ms of egg, then of larva; past their sum the body is a flying imago. */
export const EGG_MS = 6000;
export const LARVA_MS = 9000;
export const IMAGO_MS = EGG_MS + LARVA_MS;

/** Presence lost per second while a body retires (a breath-long fade). */
export const FADE_RATE = 0.6;

// stages
export const EGG = 0;
export const LARVA = 1;
export const IMAGO = 2;

// roles — identity is causal role, not a decal
export const MOTE = 0; // grazes the flock
export const POLLINATOR = 1; // visits the light, works the meadow
export const PREDATOR = 2; // hunts

// ——— determinism ————————————————————————————————————————————————————————

/** Fold any number of parts into one 32-bit seed. The swarm's only dice. */
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

// ——— the body ————————————————————————————————————————————————————————————

export type Insect = {
  id: number;
  /** the determinism law: wingbeat, jitter, chirp pitch all derive from this. */
  seed: number;
  nx: number;
  ny: number;
  /** velocity, normalized units per second. */
  vx: number;
  vy: number;
  /** EGG | LARVA | IMAGO — the lifecycle stage, read from `mature`. */
  stage: number;
  /** MOTE | POLLINATOR | PREDATOR — the causal role, fixed at birth. */
  role: number;
  /** ms of metamorphosis accrued; the stage is a closed-form read of this. */
  mature: number;
  bornMs: number;
  /** ms of the last brood laid, so mating cannot run away. */
  bred: number;
  presence: number;
};

/** Which stage a body of this much accrued maturity is in. Monotone. */
export function stageOf(mature: number): number {
  if (mature < EGG_MS) return EGG;
  if (mature < IMAGO_MS) return LARVA;
  return IMAGO;
}

export function bornInsect(
  id: number,
  seed: number,
  nx: number,
  ny: number,
  tMs: number,
  role: number = MOTE,
  mature: number = 0,
): Insect {
  const rng = mulberry32(seed);
  const stage = stageOf(mature);
  // eggs and larvae barely move; an imago is born already on the wing
  const speed = stage === IMAGO ? 0.06 : 0.004;
  const ang = rng() * Math.PI * 2;
  return {
    id,
    seed,
    nx: Math.min(0.97, Math.max(0.03, nx)),
    ny: Math.min(0.97, Math.max(0.03, ny)),
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    stage,
    role,
    mature,
    bornMs: tMs,
    bred: -1e9,
    presence: 1,
  };
}

/** Wingbeat pitch — smaller bodies (motes) hum higher than predators. */
export function wingHz(role: number): number {
  return role === PREDATOR ? 26 : role === POLLINATOR ? 200 : 320;
}

/** A cricket's chirp pitch, deterministic from a body's seed — always audible. */
export function chirpMidi(seed: number): number {
  return 78 + (seed % 9);
}

/** Draw radius by stage, normalized — an egg is a speck, an imago has span. */
export function stageRadius(stage: number, role: number): number {
  const base = stage === EGG ? 0.006 : stage === LARVA ? 0.011 : 0.017;
  return role === PREDATOR ? base * 1.7 : base;
}

// ——— metamorphosis: egg → larva → imago ——————————————————————————————————

/**
 * A dwell advances the brood one whole stage at a time — the clutch you laid
 * hatches and pupates under your held finger. Never regresses; caps at imago.
 */
export function broodAdvance(s: Insect): void {
  if (s.stage >= IMAGO) return;
  s.mature = s.stage === EGG ? EGG_MS : IMAGO_MS;
  s.stage = stageOf(s.mature);
  if (s.stage === IMAGO && Math.hypot(s.vx, s.vy) < 0.03) {
    // an imago leaves the ground on a seeded heading
    const rng = mulberry32(hashSeed(s.seed, s.mature));
    const a = rng() * Math.PI * 2;
    s.vx = Math.cos(a) * 0.12;
    s.vy = Math.sin(a) * 0.12;
  }
}

/** A dwell lays a clutch: n eggs scattered around a point, seeded, all eggs. */
export function layClutch(
  nx: number,
  ny: number,
  seed: number,
  tMs: number,
  n: number,
  startId: number,
  role: number = MOTE,
): Insect[] {
  const out: Insect[] = [];
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.03;
    out.push(
      bornInsect(
        startId + i,
        hashSeed(seed, i, 0x0e66),
        nx + Math.cos(a) * r,
        ny + Math.sin(a) * r,
        tMs,
        role,
        0,
      ),
    );
  }
  return out;
}

// ——— boids: the flock is the force balance, not a drawn path ———————————————

/**
 * The three rules of flocking, summed into one acceleration for `self` from
 * the imago neighbours it can see. Alignment steers toward the average
 * heading, cohesion toward the centroid, separation away from anyone crowding
 * it — and separation is weighted by 1/distance so a body pressed right up
 * against another is pushed off hard while a distant flockmate barely repels.
 * Eggs and larvae are not on the wing, so they never flock.
 */
export function flockForce(
  self: Insect,
  neighbors: Insect[],
): { ax: number; ay: number } {
  if (self.stage !== IMAGO) return { ax: 0, ay: 0 };
  let cx = 0;
  let cy = 0; // centroid accumulator
  let hx = 0;
  let hy = 0; // heading accumulator
  let sx = 0;
  let sy = 0; // separation accumulator
  let n = 0;
  const r2 = NEIGHBOR_REACH * NEIGHBOR_REACH;
  const sep2 = SEPARATION_REACH * SEPARATION_REACH;
  for (const o of neighbors) {
    if (o === self || o.stage !== IMAGO || o.presence < 0.5) continue;
    const dx = o.nx - self.nx;
    const dy = o.ny - self.ny;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    n++;
    cx += o.nx;
    cy += o.ny;
    hx += o.vx;
    hy += o.vy;
    if (d2 < sep2) {
      const d = Math.max(1e-4, Math.sqrt(d2));
      // away from the neighbour, harder the closer it is
      sx -= (dx / d) * (SEPARATION_REACH / d);
      sy -= (dy / d) * (SEPARATION_REACH / d);
    }
  }
  if (n === 0) return { ax: 0, ay: 0 };
  const ALIGN = 0.9;
  const COHERE = 1.1;
  const SEPARATE = 0.9;
  const ax =
    (hx / n - self.vx) * ALIGN +
    (cx / n - self.nx) * COHERE +
    sx * SEPARATE;
  const ay =
    (hy / n - self.vy) * ALIGN +
    (cy / n - self.ny) * COHERE +
    sy * SEPARATE;
  return { ax, ay };
}

/**
 * Phototaxis — an imago turns toward the lantern, harder the brighter it is
 * and (weakly) the nearer it is. Eggs and larvae have no eyes on the wing, so
 * the light does not move them.
 */
export function phototaxisForce(
  self: Insect,
  lightX: number,
  lightY: number,
  strength: number,
): { ax: number; ay: number } {
  if (self.stage !== IMAGO || strength <= 0) return { ax: 0, ay: 0 };
  const dx = lightX - self.nx;
  const dy = lightY - self.ny;
  const d = Math.max(0.02, Math.hypot(dx, dy));
  const pull = (strength * 1.4) / (0.4 + d);
  return { ax: (dx / d) * pull * d, ay: (dy / d) * pull * d };
}

// ——— the trophic web: predator and prey act on each other ————————————————

/** Is this body something a predator eats? A flying mote or pollinator. */
export function isPrey(s: Insect): boolean {
  return s.role !== PREDATOR && s.stage === IMAGO && s.presence >= 0.5;
}

/** The nearest prey a predator can see, or -1. */
export function nearestPrey(predator: Insect, swarm: Insect[]): number {
  let best = -1;
  let bestD2 = HUNT_REACH * HUNT_REACH;
  for (let i = 0; i < swarm.length; i++) {
    const s = swarm[i];
    if (!isPrey(s)) continue;
    const dx = s.nx - predator.nx;
    const dy = s.ny - predator.ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** The prey caught this instant — every prey a predator is on top of. */
export function huntCatches(swarm: Insect[]): number[] {
  const caught: number[] = [];
  for (const p of swarm) {
    if (p.role !== PREDATOR || p.stage !== IMAGO || p.presence < 0.5) continue;
    for (let i = 0; i < swarm.length; i++) {
      const s = swarm[i];
      if (!isPrey(s)) continue;
      const dx = s.nx - p.nx;
      const dy = s.ny - p.ny;
      if (dx * dx + dy * dy < CATCH_REACH * CATCH_REACH && !caught.includes(i)) {
        caught.push(i);
      }
    }
  }
  return caught;
}

/**
 * Two mature motes that meet lay an egg that is neither of them: the closest
 * eligible pair, or null. Both parents must be flying imago motes, past their
 * breeding cooldown — so the brood grows but never runs away.
 */
export function mateEncounter(swarm: Insect[], tMs: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD2 = MATE_REACH * MATE_REACH;
  for (let a = 0; a < swarm.length; a++) {
    const A = swarm[a];
    if (A.role !== MOTE || A.stage !== IMAGO || A.presence < 1) continue;
    if (tMs - A.bred < BREED_COOLDOWN_MS) continue;
    for (let b = a + 1; b < swarm.length; b++) {
      const B = swarm[b];
      if (B.role !== MOTE || B.stage !== IMAGO || B.presence < 1) continue;
      if (tMs - B.bred < BREED_COOLDOWN_MS) continue;
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

/** The egg two parents lay — folded seed, meeting point, marked as an egg. */
export function layEgg(a: Insect, b: Insect, id: number, tMs: number): Insect {
  const child = bornInsect(
    id,
    hashSeed(a.seed, b.seed, a.id + b.id),
    (a.nx + b.nx) / 2,
    (a.ny + b.ny) / 2,
    tMs,
    MOTE,
    0,
  );
  a.bred = tMs;
  b.bred = tMs;
  return child;
}

// ——— the step: every force, drift, and fade, all in place ————————————————

export type SwarmInput = {
  /** the breeze (three-finger drag / scrub), normalized accel. */
  windX: number;
  windY: number;
  /** the vessel's lean (tilt). */
  gravX: number;
  gravY: number;
  /** 0..1 agitation (shake / knock) — a jittering scatter. */
  agitation: number;
  /** the lantern, 0..1 frame position and 0..1 draw strength (phototaxis). */
  lightX: number;
  lightY: number;
  lightStrength: number;
  /** the drawn scent trail's current head, followed by the flock when on. */
  scentX: number;
  scentY: number;
  scentStrength: number;
  /** 0..1 season — dawn/dusk/night; the swarm is most awake at dusk. */
  epoch: number;
  /** 1 normally, < 1 while a three-finger hold dilates time. */
  timeScale: number;
  reduced: boolean;
};

const SPEED_DAMP = 0.4;

/** How awake the meadow is by season: dusk (~0.5) is the swarm's high noon. */
export function seasonActivity(epoch: number): number {
  // a raised cosine peaking at dusk (epoch 0.5), quiet at dawn and deep night
  return 0.35 + 0.65 * Math.max(0, Math.sin(epoch * Math.PI));
}

/**
 * Advance the swarm by dt seconds. Imagoes flock, take the light and the
 * scent, flee any predator and are pursued by it; every body drifts on the
 * breeze and the lean, the metamorphosis clock turns so eggs hatch at rest,
 * the walls hold, and a retiring body fades on a breath. All bounded, all
 * deterministic, closed-form after any pause.
 */
export function stepSwarm(
  swarm: Insect[],
  input: SwarmInput,
  tMs: number,
  dt: number,
): void {
  const d = Math.max(0, Math.min(0.05, dt)) * input.timeScale;
  const activity = seasonActivity(input.epoch);

  for (const self of swarm) {
    // the metamorphosis clock turns for everything not yet grown, at rest —
    // this is why a laid clutch hatches and pupates while nobody watches
    if (self.stage < IMAGO && self.presence >= 0.5) {
      self.mature += d * 1000 * activity;
      const st = stageOf(self.mature);
      if (st !== self.stage) {
        self.stage = st;
        if (st === IMAGO) {
          const rng = mulberry32(hashSeed(self.seed, Math.floor(self.mature)));
          const a = rng() * Math.PI * 2;
          self.vx = Math.cos(a) * 0.12;
          self.vy = Math.sin(a) * 0.12;
        }
      }
    }

    if (self.presence < 1) {
      self.presence = Math.max(0, self.presence - FADE_RATE * d);
      if (self.presence <= 0) continue;
    }
    if (input.reduced && self.stage !== IMAGO) continue;

    let ax = 0;
    let ay = 0;

    if (self.stage === IMAGO) {
      if (self.role === PREDATOR) {
        // a predator ignores the flock and runs the nearest prey down
        const t = nearestPrey(self, swarm);
        if (t >= 0) {
          const prey = swarm[t];
          const dx = prey.nx - self.nx;
          const dy = prey.ny - self.ny;
          const dd = Math.max(1e-4, Math.hypot(dx, dy));
          ax += (dx / dd) * 1.6;
          ay += (dy / dd) * 1.6;
        }
      } else {
        const f = flockForce(self, swarm);
        ax += f.ax;
        ay += f.ay;
        const p = phototaxisForce(self, input.lightX, input.lightY, input.lightStrength);
        ax += p.ax;
        ay += p.ay;
        if (input.scentStrength > 0) {
          const dx = input.scentX - self.nx;
          const dy = input.scentY - self.ny;
          const dd = Math.max(0.02, Math.hypot(dx, dy));
          ax += (dx / dd) * input.scentStrength * 0.9;
          ay += (dy / dd) * input.scentStrength * 0.9;
        }
        // prey flee any predator within reach — the swerve is emergent
        for (const o of swarm) {
          if (o.role !== PREDATOR || o.stage !== IMAGO || o.presence < 0.5) continue;
          const dx = self.nx - o.nx;
          const dy = self.ny - o.ny;
          const d2 = dx * dx + dy * dy;
          if (d2 < HUNT_REACH * HUNT_REACH) {
            const dd = Math.max(1e-3, Math.sqrt(d2));
            const fear = 0.9 / (0.05 + d2);
            ax += (dx / dd) * fear * 0.02;
            ay += (dy / dd) * fear * 0.02;
          }
        }
      }
      // the breeze and the lean move a body on the wing
      ax += input.windX * 0.5 + input.gravX * 0.4;
      ay += input.windY * 0.5 + input.gravY * 0.4;
      if (input.agitation > 0.01) {
        const rng = mulberry32(hashSeed(self.seed, Math.floor(tMs * 0.01)));
        ax += (rng() - 0.5) * input.agitation * 14;
        ay += (rng() - 0.5) * input.agitation * 14;
      }
    } else if (self.stage === LARVA) {
      // a larva crawls slowly along the ground toward the scent if any
      if (input.scentStrength > 0) {
        const dx = input.scentX - self.nx;
        const dy = input.scentY - self.ny;
        const dd = Math.max(0.02, Math.hypot(dx, dy));
        ax += (dx / dd) * 0.12;
        ay += (dy / dd) * 0.12;
      }
      ax += input.windX * 0.05;
    }

    // integrate with damping, then clamp the speed — the flock never launches
    self.vx += ax * activity * d;
    self.vy += ay * activity * d;
    const keep = Math.exp(-SPEED_DAMP * d);
    self.vx *= keep;
    self.vy *= keep;
    const sp = Math.hypot(self.vx, self.vy);
    const cap = self.stage === IMAGO ? MAX_SPEED : MAX_SPEED * 0.15;
    if (sp > cap) {
      self.vx = (self.vx / sp) * cap;
      self.vy = (self.vy / sp) * cap;
    }
    self.nx += self.vx * d;
    self.ny += self.vy * d;

    // the meadow's edges hold — a body turns back rather than escaping
    if (self.nx < 0.03) {
      self.nx = 0.03;
      self.vx = Math.abs(self.vx) * 0.6;
    }
    if (self.nx > 0.97) {
      self.nx = 0.97;
      self.vx = -Math.abs(self.vx) * 0.6;
    }
    if (self.ny < 0.03) {
      self.ny = 0.03;
      self.vy = Math.abs(self.vy) * 0.6;
    }
    if (self.ny > 0.97) {
      self.ny = 0.97;
      self.vy = -Math.abs(self.vy) * 0.6;
    }
  }
}

/** Mark the oldest living body retiring; returns its index or -1. */
export function retireOldest(swarm: Insect[]): number {
  let oldest = -1;
  let bornMs = Infinity;
  for (let i = 0; i < swarm.length; i++) {
    const s = swarm[i];
    if (s.presence >= 1 && s.bornMs < bornMs) {
      bornMs = s.bornMs;
      oldest = i;
    }
  }
  if (oldest >= 0) swarm[oldest].presence = 0.999;
  return oldest;
}

// ——— persistence ————————————————————————————————————————————————————————

export type KeptSwarm = {
  v: 1;
  bodies: Array<{ s: number; x: number; y: number; st: number; ro: number }>;
};

export function serializeSwarm(swarm: Insect[]): KeptSwarm {
  const out: KeptSwarm = { v: 1, bodies: [] };
  for (const s of swarm) {
    if (s.presence < 1) continue;
    out.bodies.push({
      s: s.seed,
      x: Math.round(s.nx * 1000) / 1000,
      y: Math.round(s.ny * 1000) / 1000,
      st: s.stage,
      ro: s.role,
    });
  }
  return out;
}

export function loadSwarm(raw: unknown, tMs: number): Insect[] {
  const swarm: Insect[] = [];
  if (!raw || typeof raw !== "object") return swarm;
  const kept = raw as Partial<KeptSwarm>;
  if (kept.v !== 1 || !Array.isArray(kept.bodies)) return swarm;
  for (const k of kept.bodies.slice(0, SWARM_CAP)) {
    if (!k || typeof k.x !== "number" || typeof k.y !== "number") continue;
    const stage = k.st === LARVA ? LARVA : k.st === EGG ? EGG : IMAGO;
    const mature = stage === EGG ? 0 : stage === LARVA ? EGG_MS : IMAGO_MS;
    const role = k.ro === POLLINATOR ? POLLINATOR : k.ro === PREDATOR ? PREDATOR : MOTE;
    swarm.push(bornInsect(swarm.length + 1, (k.s ?? 1) >>> 0, k.x, k.y, tMs, role, mature));
  }
  return swarm;
}
