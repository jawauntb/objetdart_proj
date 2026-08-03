/**
 * The manifold field — the pure math under /manifold (plan W6).
 *
 * A softened point-mass metric on a 2D fabric: masses deepen wells, light
 * rays integrate through the curved field at a fixed speed, and clocks tick
 * slower the deeper they sit. Approximate on purpose — a Plummer-softened
 * inverse square stands in for the Schwarzschild metric because the room
 * wants the *shape* of relativity (bending, orbits, dilation, one speed
 * limit) legible to a hand, not numerics a hand can't feel.
 *
 * The one law pinned here and tested: nothing outruns light. geodesicStep
 * renormalizes every ray to exactly c after every step, and the room's
 * pulse wavefronts ride the same constant, so a tapped ripple races the
 * light and never beats it.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-manifold-field.mjs).
 */

export type MassPoint = {
  x: number;
  y: number;
  /** Mass in room units; the room keeps these O(1). */
  m: number;
};

export type Ray = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

/** Default Plummer softening radius, px — keeps every field finite at r=0. */
export const SOFTENING = 26;

/**
 * Softened inverse-square acceleration toward the masses at (x, y).
 * a_i = g · m_i · d_vec / (|d|² + soft²)^(3/2) — finite everywhere,
 * vanishing exactly at a mass's center, classical 1/r² far away.
 */
export function accelAt(
  masses: readonly MassPoint[],
  x: number,
  y: number,
  g: number,
  soft: number = SOFTENING,
): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  const s2 = soft * soft;
  for (const p of masses) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy + s2;
    const inv = (g * p.m) / (d2 * Math.sqrt(d2));
    ax += dx * inv;
    ay += dy * inv;
  }
  return { ax, ay };
}

/**
 * Bounded well depth at (x, y): 0 on flat fabric, approaching (never
 * reaching) 1 under any stacking of masses. raw = Σ m·soft²/(d²+soft²) is
 * saturated through raw/(1+raw), so extreme mass piles deform the render
 * but can never blow it up.
 */
export function wellDepth(
  masses: readonly MassPoint[],
  x: number,
  y: number,
  soft: number = SOFTENING,
): number {
  let raw = 0;
  const s2 = soft * soft;
  for (const p of masses) {
    const dx = p.x - x;
    const dy = p.y - y;
    raw += (p.m * s2) / (dx * dx + dy * dy + s2);
  }
  return raw / (1 + raw);
}

/**
 * Proper-time factor at (x, y): 1 far from every mass, falling toward 0
 * (never reaching it) deep in a well. A clock's blink rate is multiplied
 * by this — the room's twin-beacon comparison is this function, watched.
 * `k` scales how hard gravity leans on the clock.
 */
export function timeDilation(
  masses: readonly MassPoint[],
  x: number,
  y: number,
  k: number,
  soft: number = SOFTENING,
): number {
  let raw = 0;
  const s2 = soft * soft;
  for (const p of masses) {
    const dx = p.x - x;
    const dy = p.y - y;
    raw += (p.m * s2) / (dx * dx + dy * dy + s2);
  }
  return 1 / (1 + k * raw);
}

/**
 * Advance a light ray one step of dtSec through the field.
 *
 * Bend first (acceleration at the current position), then renormalize the
 * velocity to exactly c, then move. The renormalization IS the speed
 * limit: gravity may turn light, it may never hurry or slow it. With no
 * masses the ray runs perfectly straight; close passes whip around heavy
 * wells and can wind into brief orbits — beauty over accuracy, but the
 * sign, the monotone falloff with impact parameter, and the constant
 * speed are exact and tested.
 *
 * A ray at exact rest (vx = vy = 0) is left at rest — light without a
 * direction is no light at all, and dividing by zero would mint NaNs.
 */
export function geodesicStep(
  masses: readonly MassPoint[],
  ray: Ray,
  dtSec: number,
  c: number,
  g: number,
  soft: number = SOFTENING,
): Ray {
  const { ax, ay } = accelAt(masses, ray.x, ray.y, g, soft);
  let vx = ray.vx + ax * dtSec;
  let vy = ray.vy + ay * dtSec;
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (sp > 0) {
    const r = c / sp;
    vx *= r;
    vy *= r;
  } else {
    vx = ray.vx;
    vy = ray.vy;
  }
  return { x: ray.x + vx * dtSec, y: ray.y + vy * dtSec, vx, vy };
}

// ————————————————————————————————————————————————————————————————————
// The cosmic web: the fabric's grain is the large-scale structure of the
// universe — luminous filaments meeting at nodes, dark voids between.
// Everything here is a deterministic function of one integer seed.
// ————————————————————————————————————————————————————————————————————

export type WebNode = { x: number; y: number };

export type CosmicWeb = {
  nodes: WebNode[];
  /** Filament links as node-index pairs [i, j] with i < j — ridges between
   *  neighboring generator points, Worley/Voronoi-style. */
  links: Array<[number, number]>;
};

export type Mote = { x: number; y: number; glow: number };

/**
 * Deterministic PRNG (mulberry32). The same seed yields the same stream,
 * forever — the web never rolls dice at render time.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded generator points on a jittered grid (even coverage, no clumps),
 * linked to their nearest neighbors: the ridge graph between neighboring
 * Voronoi cells, which is exactly the filament skeleton the sky shows.
 * Same seed → identical nodes and links, bit for bit.
 */
export function buildCosmicWeb(
  seed: number,
  width: number,
  height: number,
  count: number,
): CosmicWeb {
  const rng = seededRandom(seed);
  const cols = Math.max(2, Math.round(Math.sqrt((count * width) / Math.max(1, height))));
  const rows = Math.max(2, Math.round(count / cols));
  const cw = width / cols;
  const ch = height / rows;
  const nodes: WebNode[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      nodes.push({
        x: (i + 0.1 + 0.8 * rng()) * cw,
        y: (j + 0.1 + 0.8 * rng()) * ch,
      });
    }
  }
  // each node reaches for its 3 nearest neighbors; shared reaches dedupe
  const links: Array<[number, number]> = [];
  const seen = new Set<number>();
  const K = 3;
  for (let i = 0; i < nodes.length; i++) {
    const near: Array<{ j: number; d2: number }> = [];
    for (let j = 0; j < nodes.length; j++) {
      if (j === i) continue;
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      near.push({ j, d2: dx * dx + dy * dy });
    }
    near.sort((a, b) => a.d2 - b.d2);
    for (let k = 0; k < Math.min(K, near.length); k++) {
      const a = Math.min(i, near[k].j);
      const b = Math.max(i, near[k].j);
      const key = a * nodes.length + b;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([a, b]);
    }
  }
  return { nodes, links };
}

/** Distance from (x, y) to the nearest filament segment of the web. */
export function distanceToWeb(web: CosmicWeb, x: number, y: number): number {
  let best = Infinity;
  for (const [i, j] of web.links) {
    const ax = web.nodes[i].x;
    const ay = web.nodes[i].y;
    const bx = web.nodes[j].x;
    const by = web.nodes[j].y;
    const ex = bx - ax;
    const ey = by - ay;
    const L2 = ex * ex + ey * ey;
    let t = L2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + ex * t);
    const dy = y - (ay + ey * t);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return best === Infinity ? 0 : Math.sqrt(best);
}

/**
 * Galaxy motes, clustered along the filaments: candidates come from the
 * seeded PRNG and are kept with probability falling as a Gaussian of
 * filament distance (density ∝ filament proximity), with a whisper-thin
 * floor so the voids are sparse-to-none rather than censored. glow carries
 * proximity into brightness. Deterministic and bounded — no rejection
 * loop can spin forever.
 */
export function placeMotes(
  web: CosmicWeb,
  seed: number,
  count: number,
  width: number,
  height: number,
  sigma: number,
): Mote[] {
  const rng = seededRandom(seed);
  const motes: Mote[] = [];
  const maxTries = count * 40;
  for (let tries = 0; tries < maxTries && motes.length < count; tries++) {
    const x = rng() * width;
    const y = rng() * height;
    const d = distanceToWeb(web, x, y);
    const p = Math.exp(-(d * d) / (2 * sigma * sigma));
    const roll = rng();
    if (roll < p * 0.94 + 0.015) {
      motes.push({ x, y, glow: (0.3 + 0.7 * p) * (0.45 + 0.55 * rng()) });
    }
  }
  return motes;
}

// ————————————————————————————————————————————————————————————————————
// Expansion — the Hubble breath. Comoving structure drifts apart at a
// rate proportional to distance from the view center; the rate itself
// swells and eases on the audio graph's slow tide (0.03 Hz, the tidal
// drift in lib/audio.ts), so the void breathes rather than slides.
// ————————————————————————————————————————————————————————————————————

/** Base Hubble rate, 1/s — one e-fold of the void about every four minutes. */
export const HUBBLE_H0 = 0.004;
/** The shared slow tide (matches the 0.03 Hz tidal drift in the audio graph). */
export const HUBBLE_TIDE_HZ = 0.03;
/** How deeply the tide breathes the rate (must stay < 1: never contracting). */
export const HUBBLE_TIDE_DEPTH = 0.6;

/**
 * The scale factor a(t): da/dt = H₀ (1 + depth · sin 2πft) · a. Strictly
 * increasing for depth < 1 (the universe only deepens), a(0) = 1, and its
 * growth over any window is bounded between the quiet and full-breath
 * exponentials.
 */
export function scaleFactor(
  t: number,
  h0: number = HUBBLE_H0,
  tideHz: number = HUBBLE_TIDE_HZ,
  depth: number = HUBBLE_TIDE_DEPTH,
): number {
  const w = 2 * Math.PI * tideHz;
  return Math.exp(h0 * t + ((h0 * depth) / w) * (1 - Math.cos(w * t)));
}

/** Radius of a mass's gravitational neighborhood, px — inside it the web
 *  holds together while the void stretches. */
export const BINDING_SOFT = 150;
/** Sharpness of the bound/unbound knee. */
export const BINDING_GAIN = 9;

/**
 * How bound a point is to the placed masses, 0 (free void, fully carried
 * by the expansion) to ~1 (deep in a gravitational neighborhood, exempt).
 * The squared saturation gives a knee: near-total hold inside BINDING_SOFT,
 * falling fast beyond it — bound structures do not expand.
 */
export function boundFraction(
  masses: readonly MassPoint[],
  x: number,
  y: number,
  soft: number = BINDING_SOFT,
  gain: number = BINDING_GAIN,
): number {
  let raw = 0;
  const s2 = soft * soft;
  for (const p of masses) {
    const dx = p.x - x;
    const dy = p.y - y;
    raw += (p.m * s2) / (dx * dx + dy * dy + s2);
  }
  const g = gain * raw * raw;
  return g / (1 + g);
}

/**
 * Carry a comoving point into physical space: stretch about the view
 * center by the current factor, tempered by how bound the point is.
 * bound = 0 rides the full expansion; bound = 1 holds perfectly still.
 */
export function expandPoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  stretch: number,
  bound: number,
): { x: number; y: number } {
  const b = bound < 0 ? 0 : bound > 1 ? 1 : bound;
  const e = 1 + (stretch - 1) * (1 - b);
  return { x: cx + (x - cx) * e, y: cy + (y - cy) * e };
}

// ————————————————————————————————————————————————————————————————————
// The fold at the edges. The fabric is not an infinite plane: toward the
// boundary, curvature takes over and the metric closes on itself. The
// fold is a radial map on the elliptical rim coordinate u (1 at the edge
// midpoints): identity near the center, saturating below FOLD_U_MAX at
// the rim, so everything — mesh, web, rays — curls inward and nothing
// ever leaves.
// ————————————————————————————————————————————————————————————————————

/** The fold's asymptote in rim coordinates — the closed edge of everything. */
export const FOLD_U_MAX = 1.06;
/** Rim coordinate where rays start being steered along the boundary. */
export const RIM_STEER_START = 0.88;

/** The fold law: f(u) = u · (1 + (u/U)⁴)^(−1/4). Near-identity for
 *  u ≪ U, monotone, compressive, saturating below U. */
export function foldRadius(u: number, uMax: number = FOLD_U_MAX): number {
  if (u <= 0) return 0;
  const q = u / uMax;
  const q2 = q * q;
  return u * Math.pow(1 + q2 * q2, -0.25);
}

/**
 * Apply the fold to a screen point about center (cx, cy) with elliptical
 * half-extents (rx, ry). Returns the folded point and depth — how far
 * into the fold it sank (0 flat interior, →1 deep in the rim) — for
 * darkening and foreshortening.
 */
export function foldPoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): { x: number; y: number; depth: number } {
  const qx = (x - cx) / rx;
  const qy = (y - cy) / ry;
  const u = Math.sqrt(qx * qx + qy * qy);
  if (u < 1e-9) return { x, y, depth: 0 };
  const k = foldRadius(u) / u;
  return { x: cx + qx * k * rx, y: cy + qy * k * ry, depth: 1 - k };
}

/**
 * Steer a ray that has reached the rim along the boundary curvature and
 * back inward — light follows the fold, it does not exit. Velocity is
 * blended toward the rim tangent (keeping the ray's sense of circulation)
 * with a gentle inward bias, then renormalized to exactly c: the fold may
 * turn light, it may never hurry or slow it. Inside RIM_STEER_START the
 * ray is returned untouched.
 */
export function rimSteerRay(
  ray: Ray,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dtSec: number,
  c: number,
  strength: number = 9,
): Ray {
  const qx = (ray.x - cx) / rx;
  const qy = (ray.y - cy) / ry;
  const u = Math.sqrt(qx * qx + qy * qy);
  if (u <= RIM_STEER_START) return ray;
  const sp0 = Math.sqrt(ray.vx * ray.vx + ray.vy * ray.vy);
  if (sp0 <= 0) return ray;
  const depth = Math.min(1, (u - RIM_STEER_START) / (FOLD_U_MAX + 0.3 - RIM_STEER_START));
  // outward normal of the rim ellipse's level set at this point
  let nx = qx / rx;
  let ny = qy / ry;
  const nn = Math.sqrt(nx * nx + ny * ny);
  nx /= nn;
  ny /= nn;
  // tangent that preserves the ray's current sense of circulation
  const vt = -ray.vx * ny + ray.vy * nx;
  const sgn = vt >= 0 ? 1 : -1;
  const inward = 0.3 + 0.5 * depth;
  let dx = -ny * sgn * (1 - inward) - nx * inward;
  let dy = nx * sgn * (1 - inward) - ny * inward;
  const dn = Math.sqrt(dx * dx + dy * dy);
  dx /= dn;
  dy /= dn;
  const k = Math.min(1, strength * dtSec * (0.25 + depth));
  let vx = ray.vx + (dx * c - ray.vx) * k;
  let vy = ray.vy + (dy * c - ray.vy) * k;
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (sp > 0) {
    vx *= c / sp;
    vy *= c / sp;
  } else {
    vx = ray.vx;
    vy = ray.vy;
  }
  return { x: ray.x, y: ray.y, vx, vy };
}
