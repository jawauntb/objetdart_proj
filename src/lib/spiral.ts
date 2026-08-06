/**
 * spiral — the arms are a wave, not a place.
 *
 * The invariant is a density wave in a differentially rotating disc. Every
 * star rides its own circular orbit at Ω(R), set by one flat rotation curve;
 * the spiral arms are a standing pattern turning rigidly at a single pattern
 * speed Ωp. Those two clocks disagree everywhere except one radius — the
 * corotation circle — so stars pour *through* the arms: inside corotation
 * they overtake the pattern, outside it the pattern overtakes them. The arm
 * is not made of particular stars. It is the place where the crowd happens.
 *
 * Nothing here draws a spiral. `starDisplacement` gives every star a small
 * wave-locked excursion, and the arms EMERGE as the level set where those
 * excursions compress the disc — the tests bin real propagated stars and
 * find the crest, rather than trusting a painted curve.
 *
 * Three maps carry the one wave into other senses without losing it:
 *   pattern speed + pitch → the register  (`patternHzFor`, centred exactly
 *                            on spectralRegisterFor at the band's middle,
 *                            s = 18.75 — the turn you hear is the turn you
 *                            see; wind the law and the room re-tunes)
 *   radius → pitch          (`orbitHzFor`, strictly with Ω(R): the inner
 *                            disc rings higher because it turns faster —
 *                            differential rotation, heard)
 *   arm crossing → rhythm   (a followed star's wave phase advances at
 *                            m·|Ω − Ωp|; each wrap is one arm crossed, so
 *                            the crossing beat IS the frequency mismatch)
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-spiral.mjs).
 * See INSPIRATION.md §2 and the /space precedent (src/lib/cosmicweb.ts).
 */

// ——— determinism ————————————————————————————————————————————————
// One seed is one galaxy, the same galaxy, every visit. Nothing here
// touches Math.random or the wall clock.

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

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Wrap an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  let v = a % TAU;
  if (v <= -Math.PI) v += TAU;
  else if (v > Math.PI) v -= TAU;
  return v;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ——— the disc: one rotation curve ———————————————————————————————
// Radii are in units of the disc edge (R = 1); time is seconds.

/** Asymptotic circular speed — the flat part the dark matter holds up. */
export const V_FLAT = 0.055;
/** Core radius: inside it the curve rises almost linearly (solid body). */
export const R_CORE = 0.12;
/** Disc edge, in its own units. */
export const R_MAX = 1;
/** Exponential scale length of the stellar disc (edge ≈ 3.3 lengths out). */
export const R_DISC = 0.3;

/**
 * v(R) = V·R/√(R²+Rc²): linear through the core, flat far outside — the
 * rotation curve that says the visible disc is not all the mass there is.
 */
export function orbitalSpeed(R: number): number {
  const r = Math.max(0, R);
  return (V_FLAT * r) / Math.sqrt(r * r + R_CORE * R_CORE);
}

/**
 * Ω(R) = v/R = V/√(R²+Rc²) — strictly decreasing in R, finite at the
 * centre (V/Rc exactly). This monotone fall is the entire engine of the
 * room: no two radii keep station, so nothing material can stay an arm.
 */
export function angularSpeed(R: number): number {
  const r = Math.max(0, R);
  return V_FLAT / Math.sqrt(r * r + R_CORE * R_CORE);
}

export function orbitalPeriod(R: number): number {
  return TAU / angularSpeed(R);
}

// ——— the wave: a standing pattern with one clock ————————————————

/** Two arms — the grand-design mode the bar drives. */
export const ARM_M = 2;
/** Arm phase reference radius (where the crest crosses θ = pattern angle). */
export const R_REF = 0.35;

/** Pitch angle bounds, radians. Default ~15°, the Sb sweet spot. */
export const PITCH_MIN = 0.14;
export const PITCH_MAX = 0.52;
export const PITCH_DEFAULT = 0.26;

/** Corotation bounds: where the hand may put the one agreeing radius. */
export const COROTATION_MIN = 0.3;
export const COROTATION_MAX = 0.95;
export const COROTATION_DEFAULT = 0.62;
export const OMEGA_P_MIN = angularSpeed(COROTATION_MAX);
export const OMEGA_P_MAX = angularSpeed(COROTATION_MIN);
export const OMEGA_P_DEFAULT = angularSpeed(COROTATION_DEFAULT);

/** Radial wavenumber of an m-armed logarithmic spiral of this pitch. */
export function waveNumber(pitch: number): number {
  return ARM_M / Math.tan(clamp(pitch, PITCH_MIN, PITCH_MAX));
}

/**
 * The wave coordinate χ = m·(θ − φp) − k·ln(R/R_REF), wrapped. The crest is
 * a level set of χ: constant χ traces exactly a logarithmic spiral, so
 * moving out by one e-fold in R walks the crest around by k/m = 1/tan(α)
 * radians — a relation you can check by hand, and the test does.
 */
export function armPhase(R: number, theta: number, patternPhase: number, pitch: number): number {
  const r = Math.max(1e-6, R);
  return wrapAngle(ARM_M * (theta - patternPhase) - waveNumber(pitch) * Math.log(r / R_REF));
}

/**
 * Corotation: the one radius where a star and the pattern agree,
 * Ω(Rc) = Ωp. Inside it dχ/dt > 0, outside dχ/dt < 0; exactly here a
 * star's wave phase stands still forever.
 */
export function corotationRadius(omegaP: number): number {
  const w = clamp(omegaP, OMEGA_P_MIN, OMEGA_P_MAX);
  const q = (V_FLAT / w) * (V_FLAT / w) - R_CORE * R_CORE;
  return Math.sqrt(Math.max(0, q));
}

/** Where in the disc the wave has any purchase: outside the bar's reach,
 *  fading before the edge so the outskirts stay smooth. */
export function armEnvelope(R: number): number {
  return smoothstep(0.14, 0.26, R) * (1 - smoothstep(0.92, 1.12, R));
}

/**
 * Fractional radial excursion at full envelope. Small on purpose: the
 * displacement is a few percent, and the arm contrast comes from the
 * CONVERGENCE of many small excursions (the k·sin χ term of the Jacobian),
 * not from stars being dragged visibly sideways.
 */
export const WAVE_AMP_FRAC = 0.075;
/** Azimuthal streaming share of the same excursion. */
export const AZ_FACTOR = 0.6;

/** The bar: an m = 2 oval locked to the pattern, dying by BAR_REACH. */
export const BAR_REACH = 0.3;
export const BAR_AMP = 0.16;

export function barEnvelope(R: number): number {
  return 1 - smoothstep(BAR_REACH * 0.45, BAR_REACH, R);
}

export type WaveParams = {
  /** Pattern azimuth φp, radians — the integral of Ωp over the room's clock. */
  patternPhase: number;
  /** Arm pitch, radians. */
  pitch: number;
  /** Wave amplitude multiplier, 1 = the disc's own. */
  amp: number;
  /** Bar strength 0..1. */
  bar: number;
};

export type StarState = {
  x: number;
  y: number;
  /** Displaced radius. */
  r: number;
  /** Displaced azimuth. */
  theta: number;
  /** Wave phase of the guiding centre — the star's place in the pattern. */
  chi: number;
};

/**
 * One star, propagated: circular orbit at Ω(R₀) plus the wave-locked
 * excursion plus the bar's oval. Pure in (R₀, θ₀, t, params); the GPU
 * evaluates the identical expressions per vertex, and the tests pin this
 * copy so the shader has a ground truth to mirror.
 */
export function starState(R0: number, theta0: number, t: number, p: WaveParams): StarState {
  const th = theta0 + angularSpeed(R0) * t;
  const chi = armPhase(R0, th, p.patternPhase, p.pitch);
  const a = WAVE_AMP_FRAC * armEnvelope(R0) * p.amp;
  let r = R0 * (1 - a * Math.cos(chi));
  const theta = th + a * AZ_FACTOR * Math.sin(chi);
  const bq = BAR_AMP * p.bar * barEnvelope(R0);
  if (bq > 0) r *= 1 - bq * Math.cos(2 * (th - p.patternPhase));
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), r, theta, chi };
}

/**
 * The Jacobian's radial compression at a star's phase: how much the wave
 * squeezes the disc there. > 1 means crowding — the emergent arm — and the
 * young blue light rides exactly this factor, because compressed gas is
 * where stars are born.
 */
export function crowding(R0: number, chi: number, amp: number, pitch: number): number {
  const a = WAVE_AMP_FRAC * armEnvelope(R0) * amp;
  const j = 1 - a * Math.cos(chi) - a * waveNumber(pitch) * Math.sin(chi);
  return 1 / Math.max(0.3, j);
}

// ——— the population, from one seed ————————————————————————————

/**
 * The population. One instanced draw over typed arrays uploaded once — the
 * count is a fill-rate question, never a JS one, because no star is ever
 * touched by the CPU after build: the vertex shader propagates every orbit
 * from the closed form below.
 */
export const STAR_COUNT = 180000;
export const STAR_CAP = 260000;
export const BULGE_FRAC = 0.2;
export const BULGE_R = 0.1;
/** Disc thickness at the centre; flares gently outward. */
export const DISC_H = 0.03;

export type StarField = {
  count: number;
  /** Guiding-centre radius. */
  r: Float32Array;
  /** Azimuth at t = 0. */
  theta: Float32Array;
  /** Height off the plane (static — the thin disc breathes elsewhere). */
  z: Float32Array;
  /** 0..1 apparent size roll. */
  size: Float32Array;
  /** 0..1 population roll — high rolls are the young, arm-lit stars. */
  pop: Float32Array;
  /** 0..1 palette roll. */
  hue: Float32Array;
};

/**
 * The disc: radii Gamma(2, R_DISC)-distributed (surface density ∝ e^{−R/Rd}),
 * a spheroidal bulge inside, azimuths uniform. Same seed, identical field,
 * bit for bit; the count is capped and the cap is law.
 */
export function buildStars(seed: number, count: number = STAR_COUNT): StarField {
  const n = Math.max(1, Math.min(STAR_CAP, Math.floor(count)));
  const rng = mulberry32(hashSeed(seed, 0x5a17));
  const r = new Float32Array(n);
  const theta = new Float32Array(n);
  const z = new Float32Array(n);
  const size = new Float32Array(n);
  const pop = new Float32Array(n);
  const hue = new Float32Array(n);
  const gauss = () => {
    // Box–Muller from the one stream — deterministic, no rejection.
    const u = Math.max(1e-9, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  for (let i = 0; i < n; i++) {
    const inBulge = rng() < BULGE_FRAC;
    if (inBulge) {
      const rr = Math.min(2.6, Math.abs(gauss())) * BULGE_R;
      r[i] = rr;
      z[i] = gauss() * BULGE_R * 0.55;
    } else {
      // Gamma(2): the sum of two exponentials — pdf ∝ R·e^{−R/Rd}, which is
      // exactly a surface density e^{−R/Rd} swept around the circle. The
      // tail past the disc edge is REDRAWN, not clamped: piling rejects at
      // one radius would print a bright artificial rim no renderer could
      // hide, and the test measures for exactly that.
      let rr = -R_DISC * Math.log(Math.max(1e-9, rng()) * Math.max(1e-9, rng()));
      for (let tries = 0; rr > R_MAX * 1.08 && tries < 8; tries++) {
        rr = -R_DISC * Math.log(Math.max(1e-9, rng()) * Math.max(1e-9, rng()));
      }
      if (rr > R_MAX * 1.08) rr = R_DISC * 2;
      r[i] = rr;
      z[i] = gauss() * DISC_H * (0.6 + rr);
    }
    theta[i] = rng() * TAU;
    size[i] = rng();
    pop[i] = rng();
    hue[i] = rng();
  }
  return { count: n, r, theta, z, size, pop, hue };
}

// ——— the wave, heard ————————————————————————————————————————————
// The register the axis assigns this band. The galaxy band spans
// s = 17..20.5 log10 m; its centre is 18.75, and on the −35…27 axis
// (span 62 decades — the plank band moved the floor) spectralRegisterFor puts
//   baseHz = 27.5·2^(7·(27 − 18.75)/62) = 27.5·2^(57.75/62) ≈ 52.45 Hz
//   lfoHz  = 1.8·2^(−7.5·(18.75 + 35)/62)            ≈ 0.0199 Hz
// — one breath every ~50 seconds, a third above the deep-space web. The
// literals 62 (SCALE_MAX − SCALE_MIN), 27 (SCALE_MAX) and 35 (−SCALE_MIN)
// encode the axis span because this module stays import-free; retune them
// whenever the floor moves again. This module does not invent a register;
// the test asserts these constants agree with lib/scale.ts to the last digit.

export const GALAXY_SCALE_S = 18.75;
export const GALAXY_BASE_HZ = 27.5 * Math.pow(2, (7 * (27 - GALAXY_SCALE_S)) / 62);
export const GALAXY_LFO_HZ = 1.8 * Math.pow(2, (-7.5 * (GALAXY_SCALE_S + 35)) / 62);

/** Octaves the pattern-speed range sweeps around the band's fundamental. */
export const PATTERN_SPAN_OCT = 1.2;
/** Octaves the pitch range adds — an open spiral speaks slightly brighter. */
export const PITCH_SPAN_OCT = 0.35;

/**
 * The world-law, heard: pattern speed and arm pitch → one bounded pitch,
 * strictly increasing in both, and exactly the band's own fundamental at
 * the defaults — so an untouched room sounds where the axis says it lives,
 * and winding the law is audibly winding the law.
 */
export function patternHzFor(omegaP: number, pitch: number): number {
  const w = clamp(omegaP, OMEGA_P_MIN, OMEGA_P_MAX);
  const p = clamp(pitch, PITCH_MIN, PITCH_MAX);
  const uw = (Math.log(w) - Math.log(OMEGA_P_DEFAULT)) / (Math.log(OMEGA_P_MAX) - Math.log(OMEGA_P_MIN));
  const up = (p - PITCH_DEFAULT) / (PITCH_MAX - PITCH_MIN);
  return GALAXY_BASE_HZ * Math.pow(2, PATTERN_SPAN_OCT * uw + PITCH_SPAN_OCT * up);
}

export function patternMidiFor(omegaP: number, pitch: number): number {
  return 69 + 12 * Math.log2(patternHzFor(omegaP, pitch) / 440);
}

/** How far a tapped orbit may ring above or below the pattern's own note. */
export const ORBIT_SPAN_OCT = 1;

/**
 * A tapped radius, heard: the local angular speed against the pattern's,
 * bounded softly (tanh) to ±ORBIT_SPAN_OCT so the map stays STRICTLY
 * decreasing in R all the way to the centre — the inner disc turns faster
 * and rings higher, which is the rotation curve as melody, with no
 * flat-topped plateau where the ear would stop learning.
 */
export function orbitHzFor(R: number, omegaP: number, pitch: number): number {
  const w = clamp(omegaP, OMEGA_P_MIN, OMEGA_P_MAX);
  const rel = Math.log2(angularSpeed(clamp(R, 0, R_MAX)) / w);
  const soft = ORBIT_SPAN_OCT * Math.tanh(rel / ORBIT_SPAN_OCT);
  return patternHzFor(omegaP, pitch) * Math.pow(2, soft * 0.55);
}

export function orbitMidiFor(R: number, omegaP: number, pitch: number): number {
  return 69 + 12 * Math.log2(orbitHzFor(R, omegaP, pitch) / 440);
}

/**
 * How often a star at R crosses an arm: m·|Ω(R) − Ωp| / 2π crossings per
 * second. Zero exactly at corotation; the followed star's crossing beat in
 * the room is this number and nothing else.
 */
export function armCrossingHz(R: number, omegaP: number): number {
  return (ARM_M * Math.abs(angularSpeed(R) - omegaP)) / TAU;
}

// ——— what a hand puts into the disc ————————————————————————————
//
// The room is not read-only: a held finger seeds a star-forming region in
// the gas, and a region held into the ceremony ignites — a supernova whose
// shell sweeps outward, brightens what it passes, and where it reaches the
// next patch of gas, lights it too. That last part is not decoration: it is
// self-propagating stochastic star formation (Gerola & Seiden 1978), the
// standard companion to the density wave, and it is what makes the arms
// flocculent between the grand-design crests.
//
// Regions obey the SAME rotation curve the stars do, so everything a hand
// plants is caught in the shear immediately — which is the winding problem
// made personal: plant a round patch, come back, find it drawn into an arc.

/** How many regions the disc carries at once — the shader loops are bounded. */
export const REGION_MAX = 6;
/** Seconds of disc clock a nursery burns before it is spent. */
export const REGION_LIFE = 150;
/** Radial half-width of a seeded patch, in disc units. */
export const REGION_HALF_WIDTH = 0.045;

/**
 * Sedov–Taylor: a blast into a uniform medium goes as r ∝ t^(2/5), so the
 * shell is fastest the instant it is born and never stops decelerating.
 * Bounded by SHELL_MAX because a real remnant fades into the medium rather
 * than crossing the galaxy.
 */
export const SHELL_K = 0.16;
export const SHELL_EXP = 0.4;
export const SHELL_MAX = 0.34;

export function shellRadius(age: number): number {
  if (age <= 0) return 0;
  return Math.min(SHELL_MAX, SHELL_K * Math.pow(age, SHELL_EXP));
}

/** dr/dt of the same law — strictly falling while the shell still runs. */
export function shellSpeed(age: number): number {
  if (age <= 0) return 0;
  if (shellRadius(age) >= SHELL_MAX) return 0;
  return SHELL_K * SHELL_EXP * Math.pow(age, SHELL_EXP - 1);
}

export type Region = {
  /** Guiding-centre radius — the region rides Ω(R0) like every star. */
  R0: number;
  /** Azimuth at t = 0. */
  theta0: number;
  /** Disc-clock time the hand seeded it. */
  born: number;
  /** How much gas the hold gathered, 0..1. */
  strength: number;
  /** Disc-clock time it went supernova, or -1 while it is still gas. */
  ignited: number;
};

export type RegionPoint = { x: number; y: number; r: number; theta: number };

/** Where a region stands now: the same circular orbit its stars ride. */
export function regionAt(reg: Region, t: number): RegionPoint {
  const theta = reg.theta0 + angularSpeed(reg.R0) * t;
  return { x: reg.R0 * Math.cos(theta), y: reg.R0 * Math.sin(theta), r: reg.R0, theta };
}

/**
 * The winding problem, quantified. A patch of radial half-width dR is torn
 * azimuthally at |dΩ/dR|·dR per unit time, so its angular span grows without
 * bound and grows FASTER further in, where the curve is steeper. This is
 * exactly why a material arm cannot survive — and why the room's arms are a
 * wave instead. Returns radians.
 */
export function shearedSpan(R0: number, dR: number, t: number): number {
  const r = Math.max(1e-6, R0);
  // dΩ/dR = −V·R/(R²+Rc²)^{3/2}
  const denom = Math.pow(r * r + R_CORE * R_CORE, 1.5);
  const dOmega = (V_FLAT * r) / denom;
  return 2 * dOmega * dR * Math.max(0, t);
}

/** Great-circle-free plane distance between two regions at time t. */
export function regionSeparation(a: Region, b: Region, t: number): number {
  const pa = regionAt(a, t);
  const pb = regionAt(b, t);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/**
 * Has a's shell reached b by time t? A region only triggers neighbours while
 * it is genuinely burning — an already-ignited b is never re-lit, and a
 * shell that has run to SHELL_MAX has spent itself.
 */
export function shellReaches(a: Region, b: Region, t: number): boolean {
  if (a.ignited < 0 || b.ignited >= 0) return false;
  const age = t - a.ignited;
  if (age <= 0) return false;
  const rs = shellRadius(age);
  if (rs >= SHELL_MAX) return false;
  return regionSeparation(a, b, t) <= rs;
}

/**
 * One step of propagating star formation: every gas region a live shell has
 * swept lights, and its own shell starts from this instant. Pure — it
 * returns a NEW list, so the room can pin the chain in a test and the
 * renderer never has to own the rule.
 */
export function propagate(regions: Region[], t: number): { regions: Region[]; lit: number[] } {
  const lit: number[] = [];
  const out = regions.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].ignited >= 0) continue;
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      if (shellReaches(regions[j], regions[i], t)) {
        out[i] = { ...out[i], ignited: t, strength: Math.max(out[i].strength, 0.45) };
        lit.push(i);
        break;
      }
    }
  }
  return { regions: out, lit };
}

/**
 * A region's remaining life, 0..1. Gas burns down over REGION_LIFE; an
 * ignited region fades on the shell's own clock instead, so a supernova is
 * a shorter, brighter death than a slow burn.
 */
export function regionLife(reg: Region, t: number): number {
  if (reg.ignited >= 0) {
    const age = t - reg.ignited;
    return clamp(1 - age / (REGION_LIFE * 0.45), 0, 1);
  }
  return clamp(1 - (t - reg.born) / REGION_LIFE, 0, 1);
}
