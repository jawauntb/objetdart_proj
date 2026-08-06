/**
 * coast — pure beach helpers for /coast.
 *
 * Import-free: the shore's whole state vector is a handful of numbers (time,
 * moon, wind, season) and every function here is a deterministic map out of
 * it. The section through the shore — sky, sea, wet sand, dry sand, dune —
 * lives here too, because a tap has to be *read* before it can be answered,
 * and both the renderer and the gesture table must read it the same way.
 */

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

export function mix32(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const TAU = Math.PI * 2;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Tide line as a fraction of height (0 top, 1 bottom). */
export function tideLine(tSec: number, moon: number): number {
  const swell = Math.sin(tSec * 0.11) * 0.04 + Math.sin(tSec * 0.03 + 1.7) * 0.03;
  return 0.58 + moon * 0.1 + swell;
}

// ——— the section through the shore ———
//
// Five materials stacked down the screen. The bands are defined relative to
// the moving tide line so the shore stays a shore at every tide: the sea
// band hangs above the waterline, the soaked sand hangs below it, and the
// dune is pushed down whenever a spring tide would otherwise swallow the
// dry beach (DRY_MIN guarantees the dry band never collapses to nothing).

/** How far above the waterline the visible sea band reaches (the horizon). */
export const SEA_BAND = 0.1;
/** How far below the waterline the sand stays soaked. */
export const WET_BAND = 0.08;
/** Where the dune crest sits at an ordinary tide. */
export const DUNE_BASE = 0.78;
/** The dry beach is never allowed to be thinner than this. */
export const DRY_MIN = 0.16;

export const ZONE_ORDER = ["sky", "sea", "wet", "dry", "dune"] as const;
export type CoastZone = (typeof ZONE_ORDER)[number];

/** 0..4, the order the zones stack down the screen. */
export function zoneIndex(zone: CoastZone): number {
  return ZONE_ORDER.indexOf(zone);
}

/**
 * The dune crest at column `nx`, as a fraction of height. Shaped by two
 * sines so the ridge is not a ruler, and floored so a high tide pushes the
 * dune down the screen instead of drowning the dry beach.
 */
export function duneLine(nx: number, tide: number): number {
  const shape = Math.sin(nx * 4 + 0.4) * 0.04 + Math.sin(nx * 11) * 0.015;
  return Math.max(DUNE_BASE + shape, tide + DRY_MIN);
}

/**
 * Which material a point lands on. This is the reading every gesture on
 * /coast starts from — pressing into wet sand is not pressing into a dune.
 */
export function zoneAt(nx: number, ny: number, tide: number): CoastZone {
  if (ny < tide - SEA_BAND) return "sky";
  if (ny < tide) return "sea";
  if (ny < tide + WET_BAND) return "wet";
  return ny < duneLine(nx, tide) ? "dry" : "dune";
}

/** 0..1 position inside the zone the point falls in (0 = its seaward edge). */
export function zoneDepth(nx: number, ny: number, tide: number): number {
  // Same branch structure as zoneAt, but the dune line — two sin() calls —
  // is computed at most once instead of once in zoneAt and again here.
  if (ny < tide - SEA_BAND) return clamp01(ny / Math.max(1e-4, tide - SEA_BAND));
  if (ny < tide) return clamp01((ny - (tide - SEA_BAND)) / SEA_BAND);
  if (ny < tide + WET_BAND) return clamp01((ny - tide) / WET_BAND);
  const dune = duneLine(nx, tide);
  if (ny < dune) {
    const top = tide + WET_BAND;
    return clamp01((ny - top) / Math.max(1e-4, dune - top));
  }
  return clamp01((ny - dune) / Math.max(1e-4, 1 - dune));
}

/**
 * How wet the sand is at screen-fraction `ny`. The waterline sits at `tide`;
 * sand just below it is saturated by the swash and dries as the beach climbs
 * toward the dunes. Above the waterline there is no sand to be wet — 0.
 * `swash` (0..1, the surf breath) carries the soak farther up the beach, so
 * the sheen visibly follows the sets rather than sitting still.
 */
export function sandWetness(ny: number, tide: number, swash = 0): number {
  if (ny <= tide) return 0;
  const reach = 0.05 + clamp01(swash) * 0.05;
  const d = ny - tide;
  const plateau = reach * 0.35;
  if (d <= plateau) return 1;
  return Math.max(0, 1 - (d - plateau) / (reach * 1.6));
}

// ——— the shore's voice ———
//
// Five materials, five answers. The registers are deliberately disjoint:
// the sky is the top of the room and the dune is its floor, so a hand can
// hear where it landed without looking. Timbre carries as much of the
// difference as pitch — a dune rustles, dry sand thuds, wet sand plops,
// the sea slaps, the sky rings.

export type ZoneWave = "sine" | "triangle" | "square" | "sawtooth";

export type ZoneVoice = {
  /** midi note at the centre of the zone's register */
  midi: number;
  wave: ZoneWave;
  /** seconds the answer lasts */
  dur: number;
  /** semitones the tone travels over its life — the shape of the answer */
  glide: number;
  toneGain: number;
  /** band-passed noise: the material's grain */
  noiseHz: number;
  noiseQ: number;
  noiseGain: number;
  /** lowpass on the tone — how covered the answer sounds */
  cutoffHz: number;
};

type ZoneTimbre = Omit<ZoneVoice, "midi"> & { base: number; span: number };

const ZONE_TIMBRE: Record<CoastZone, ZoneTimbre> = {
  // air: a thin ring that rises and hangs
  sky: {
    base: 79, span: 3,
    wave: "sine", dur: 1.5, glide: 5,
    toneGain: 0.034, noiseHz: 5200, noiseQ: 0.7, noiseGain: 0.009, cutoffHz: 7000,
  },
  // water: a slap that falls away, thick with low broadband hiss
  sea: {
    base: 54, span: 3,
    wave: "sine", dur: 0.9, glide: -7,
    toneGain: 0.052, noiseHz: 520, noiseQ: 0.6, noiseGain: 0.075, cutoffHz: 1400,
  },
  // soaked sand: a hollow plop, water squeezed out of the grains
  wet: {
    base: 66, span: 3,
    wave: "triangle", dur: 0.45, glide: -2,
    toneGain: 0.046, noiseHz: 1500, noiseQ: 3.2, noiseGain: 0.036, cutoffHz: 2600,
  },
  // dry sand: a short dull thud, almost no ring at all
  dry: {
    base: 43, span: 3,
    wave: "square", dur: 0.22, glide: -4,
    toneGain: 0.036, noiseHz: 300, noiseQ: 0.5, noiseGain: 0.05, cutoffHz: 420,
  },
  // marram: a low pedal under a long dry rustle
  dune: {
    base: 33, span: 3,
    wave: "sawtooth", dur: 1.1, glide: 1,
    toneGain: 0.022, noiseHz: 3400, noiseQ: 1.1, noiseGain: 0.062, cutoffHz: 300,
  },
};

/**
 * The note a zone answers with. `depth` (0..1 inside the zone) tilts the
 * pitch within the zone's own register — never out of it — and `intensity`
 * (0..1, how hard the hand meant it) opens the gains and lengthens the tail.
 * Registers of different zones never overlap, so pitch alone identifies the
 * material and timbre confirms it.
 */
export function zoneVoice(zone: CoastZone, depth: number, intensity: number): ZoneVoice {
  const T = ZONE_TIMBRE[zone];
  const d = clamp01(depth);
  const i = clamp01(intensity);
  return {
    midi: T.base + (0.5 - d) * 2 * T.span + (i - 0.5) * 2,
    wave: T.wave,
    dur: T.dur * (0.7 + i * 0.7),
    glide: T.glide * (0.6 + i * 0.8),
    toneGain: T.toneGain * (0.45 + i * 0.95),
    noiseHz: T.noiseHz * (0.85 + i * 0.35),
    noiseQ: T.noiseQ,
    noiseGain: T.noiseGain * (0.4 + i * 1.0),
    cutoffHz: T.cutoffHz * (0.8 + i * 0.5),
  };
}

// ——— aliveness ———

/**
 * The breath of the surf, 0..1 — the envelope the idle room runs on.
 *
 * Two swell components close in period beat against each other and a third,
 * far slower one groups them, so waves arrive in *sets*: the shore is never
 * metronomic and never still. `period` is the dominant swell period in
 * seconds.
 */
export function surfBreath(tSec: number, period = 9): number {
  const p = Math.max(0.5, period);
  const a = Math.sin((tSec / p) * TAU);
  const b = Math.sin((tSec / (p * 1.31)) * TAU + 0.7);
  const sets = Math.sin((tSec / (p * 4.7)) * TAU + 2.1);
  const v = (a * 0.55 + b * 0.45) * (0.62 + 0.38 * (0.5 + 0.5 * sets));
  return clamp01(0.5 + v * 0.5);
}

/**
 * The shore's slow cycle. Real beaches have two: the summer profile builds a
 * berm and the sand sits high and wide; the winter storm profile drags it
 * offshore into bars and the swell that took it is the biggest of the year.
 * Berm and swell are therefore in antiphase, by construction, and the whole
 * profile wraps — season is an angle, not a counter.
 */
export type SeasonProfile = {
  /** -1 storm beach (sand offshore) … +1 summer berm (sand piled high) */
  berm: number;
  /** 0..1 swell energy */
  swell: number;
  /** 0..1 how green the marram is */
  grass: number;
  /** 0..1 light warmth */
  warmth: number;
  /** 0..1 how much foam the surf carries */
  foam: number;
};

export function seasonProfile(season: number): SeasonProfile {
  const s = ((season % 1) + 1) % 1;
  const a = s * TAU;
  const berm = Math.cos(a);
  const swell = clamp01(0.5 - berm * 0.35);
  return {
    berm,
    swell,
    grass: clamp01(0.5 + 0.5 * Math.cos(a - 0.6)),
    warmth: clamp01(0.5 + 0.5 * Math.cos(a)),
    foam: clamp01(0.3 + swell * 0.6),
  };
}

// ——— foam, grit, and blown grass ———
//
// One particle pool for everything the shore throws into the air. `tint`
// picks which material it came off (0 water, 1 sand, 2 grass) so a dry-sand
// puff never reads as sea foam. Ballistic: specks carry velocity and fall,
// because a kicked handful of sand arcs and a burst of spray does not.

export type FoamSpeck = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /** life lost per second */
  decay: number;
  /** px radius at full life */
  size: number;
  /** 0 water, 1 sand, 2 grass */
  tint: number;
  seed: number;
};

export type FoamOpts = {
  /** normalized radius the burst is scattered over */
  spread?: number;
  /** initial upward speed, normalized units/sec */
  rise?: number;
  /** outward speed, normalized units/sec */
  drift?: number;
  /** px radius at full life */
  size?: number;
  /** life lost per second */
  decay?: number;
  tint?: number;
};

export function spawnFoam(
  seed: number,
  x: number,
  y: number,
  n: number,
  opts: FoamOpts = {},
): FoamSpeck[] {
  const spread = opts.spread ?? 0.05;
  const rise = opts.rise ?? 0.05;
  const drift = opts.drift ?? 0.03;
  const size = opts.size ?? 3.4;
  const decay = opts.decay ?? 0.55;
  const tint = opts.tint ?? 0;
  const rng = mulberry32((seed >>> 0) || 1);
  const out: FoamSpeck[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng());
    out.push({
      x: x + Math.cos(a) * r * spread,
      y: y + Math.sin(a) * r * spread * 0.45,
      vx: Math.cos(a) * r * drift,
      vy: -rise * (0.4 + rng() * 0.8),
      life: 0.55 + rng() * 0.45,
      decay: decay * (0.7 + rng() * 0.6),
      size: size * (0.55 + rng() * 0.9),
      tint,
      seed: mix32(seed, i, Math.round(x * 1000)),
    });
  }
  return out;
}

/**
 * Advance the pool one step, **in place** — the RAF loop must not allocate.
 * Specks are ballistic (gravity pulls them back down) and the wind carries
 * them; dead ones are compacted out with the survivors' order preserved, and
 * the same array is returned truncated.
 */
export function stepFoam(
  specks: FoamSpeck[],
  dt: number,
  wind: number,
  gravity = 0.1,
): FoamSpeck[] {
  let w = 0;
  for (let i = 0; i < specks.length; i++) {
    const s = specks[i];
    const life = s.life - dt * (s.decay + Math.abs(wind) * 0.25);
    if (life <= 0) continue;
    s.life = life;
    s.vy += gravity * dt;
    s.vx += wind * dt * 0.06;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    specks[w++] = s;
  }
  specks.length = w;
  return specks;
}

/**
 * Cap the pool in place — the freshest (highest life) specks survive, the
 * ones already dissolving are the ones the shore lets go of first.
 */
export function capFoam(specks: FoamSpeck[], max: number): FoamSpeck[] {
  if (specks.length <= max) return specks;
  specks.sort((a, b) => b.life - a.life);
  specks.length = Math.max(0, max);
  return specks;
}

// ——— breakers: the physics of a raised wave, and the profile it moves ———
//
// A double-tap on the surf raises a real breaker: a swash that runs up the
// beach and drains back, asymmetric like a real one, that both erodes at
// the point it broke and deposits further up its own run-up — so the sand
// profile is a *consequence* of where breakers have struck, not a decal
// painted under them. `sandProfile` is a small bank of per-column offsets
// (ny units) shared between the shader (visible dune/dry line) and the JS
// side (shell burial, zone reads); it persists for the session and relaxes
// slowly, the way a berm actually rebuilds.

/** Columns in the shared sand-profile bank. Small: this is a coarse drift, not a heightmap. */
export const SAND_PROFILE_N = 24;
/** Largest either direction the profile may move a column, in ny units. */
export const SAND_PROFILE_MAX = 0.05;

export function createSandProfile(): Float32Array {
  return new Float32Array(SAND_PROFILE_N);
}

/** Bilinear-interpolated profile offset at shore position `nx` (0..1). */
export function sandProfileAt(profile: Float32Array, nx: number): number {
  const n = profile.length;
  if (n === 0) return 0;
  const f = clamp01(nx) * (n - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(n - 1, i0 + 1);
  const t = f - i0;
  return profile[i0] * (1 - t) + profile[i1] * t;
}

/**
 * A breaker's run-up envelope, 0..1: a fast rise to the swash's landward
 * limit, then a slower drain back to nothing — a real asymmetric swash, not
 * a symmetric pulse. `power` (0..1) stretches both legs a little, the way a
 * bigger wave takes longer to run out.
 */
export function breakerRunup(ageSec: number, power: number): number {
  const rise = 0.30 + clamp01(power) * 0.16;
  const fall = 0.68 + clamp01(power) * 0.30;
  if (ageSec <= 0) return 0;
  if (ageSec < rise) {
    const t = ageSec / rise;
    return t * t * (3 - 2 * t);
  }
  const f = clamp01((ageSec - rise) / fall);
  return 1 - f * f * (3 - 2 * f);
}

/** Total lifetime (s) of a breaker's swash before it has fully drained. */
export function breakerLifeSec(power: number): number {
  return 0.30 + clamp01(power) * 0.16 + 0.68 + clamp01(power) * 0.30;
}

/** How far up the dry band (fraction of it) the swash reaches at its peak. */
export function breakerReach(power: number): number {
  return 0.16 + clamp01(power) * 0.55;
}

/**
 * Net sand a breaker moves at shore-column `x` this instant: erosion in a
 * trench right where it broke (the backwash pulls sand seaward, strongest
 * early in the swash) and deposition further up the run (the water loses
 * energy and drops what it carries, strongest at peak run-up) — real swash
 * sediment transport, not a single symmetric bump under the strike point.
 */
export function breakerSandRate(
  x: number,
  bnx: number,
  spread: number,
  power: number,
  runup: number,
): number {
  const s = Math.max(0.02, spread);
  const dx = x - bnx;
  const lateral = Math.exp(-(dx * dx) / (2 * s * s));
  if (lateral < 0.01) return 0;
  const erode = (1 - runup) * 0.62;
  const deposit = runup * 0.95;
  return lateral * clamp01(power) * (deposit - erode);
}

/**
 * Integrate one breaker's effect on the profile for `dt` seconds, in place.
 * `scale` converts the dimensionless rate into ny units per second; callers
 * own the scale so weak taps and rogue sets can differ.
 */
export function applyBreakerToProfile(
  profile: Float32Array,
  bnx: number,
  spread: number,
  power: number,
  runup: number,
  dt: number,
  scale = 0.02,
): void {
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const x = n <= 1 ? 0.5 : i / (n - 1);
    const rate = breakerSandRate(x, bnx, spread, power, runup);
    if (rate === 0) continue;
    const next = profile[i] + rate * dt * scale;
    profile[i] = next < -SAND_PROFILE_MAX ? -SAND_PROFILE_MAX : next > SAND_PROFILE_MAX ? SAND_PROFILE_MAX : next;
  }
}

/** Relax the whole profile a little toward flat — a berm slowly rebuilding. */
export function relaxSandProfile(profile: Float32Array, dt: number, tau = 90): void {
  const k = Math.exp(-dt / Math.max(1, tau));
  for (let i = 0; i < profile.length; i++) profile[i] *= k;
}
