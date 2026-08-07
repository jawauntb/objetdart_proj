import type { RoomZoomSpec } from "@/lib/scale";

/**
 * observe — the sample under the beam, as laws.
 *
 * A shallow cuvette of solvent seen from above, a molecular sample dissolved
 * in it. The room's material is the interaction between light and molecules:
 * UV/Vis absorbance, as physics, made felt. This module is every law the
 * sample obeys — how a photon of a given wavelength either resonates with an
 * electronic transition and is absorbed (the molecule shudders, its outer
 * cloud brightens, the beam darkens on the far wall), or passes through
 * undisturbed; how molar absorptivity as a Gaussian in wavelength sums over
 * two chromophores; how Beer-Lambert reads that as a wall paint; how the
 * population drifts on Brownian noise you can tilt, stir, or heat; and how a
 * sweep of the beam builds a fingerprint spectrum along the top of the frame.
 *
 * Phase 2 turns the room into a five-altitude pinch-through of the same
 * substance: a heap of crystal on a bench → falling into a beaker → the
 * cuvette-from-above (Phase 1) → one molecule swelling to fill the frame →
 * that molecule's aromatic ring alone, its π-cloud pulsing with the room
 * breath. Every altitude is a representation of the same thing. Altitude is a
 * function of internal zoom in [1, 4096] (OBSERVE_ZOOM_SPEC), and the module
 * exports every law the new altitudes need (crystal caustics, ball-and-stick
 * chirality flip, particle-in-a-box math, resonant absorption at the
 * chromophore altitude).
 *
 * Pure math, no DOM, no audio, no imports, no Math.random — node-testable
 * (scripts/test-observe.mjs). The component (src/components/Observe.tsx)
 * renders what these laws decide and nothing else.
 *
 * ——— the wavelength palette ————————————————————————————————————————————
 * The room maps the full 200–800 nm axis to visible RGB. That is a
 * pedagogical remapping, not a lie: real UV below 380 nm is invisible, but
 * this room is a visualization where the visitor's finger picks a wavelength
 * across the frame, and dark bands must be seeable. The choice: 200 nm →
 * deep violet, 400 nm → true violet at the visible edge, 550 nm → green,
 * 700 nm → red, 800 nm → dark red toward invisible. Every UV wavelength maps
 * to a specific hue past violet on the visible circle; the tests pin the
 * anchors and the monotone-ish descent from short to long.
 *
 * ——— the two chromophores ——————————————————————————————————————————————
 * The sample is the o-chlorophenyl cyclohexanone family (documented in the
 * registry; never named in user-facing copy). It carries:
 *   1) an aromatic π→π* band centered ~260 nm (ε_max ~7000, width ~18 nm)
 *   2) a carbonyl n→π* band centered ~285 nm (ε_max ~350, width ~26 nm)
 * The numbers are chosen for the room's feel (visible band separation, one
 * strong band next to one weak broad shoulder), not lab literature — but
 * they are internally consistent, and every derived quantity (T, A, hit
 * probability) is a function of them alone.
 */

// ——— constants ———————————————————————————————————————————————————————————

/** Room-wide wavelength axis, nm. Finger x=0 → LAMBDA_MIN, x=1 → LAMBDA_MAX. */
export const LAMBDA_MIN = 200;
export const LAMBDA_MAX = 800;

/** Population cap; past this the oldest drifts out gracefully. */
export const MOLECULE_CAP = 220;

/** Path length in cuvette-plane units; the l in Beer-Lambert A = ε·c·l. */
export const PATH_LENGTH = 1;

/** Reference concentration, molarity units; a three-finger twist scales it. */
export const REFERENCE_CONCENTRATION = 1e-4;

/** The two chromophore bands, in ε(λ) space. */
export type BandParams = {
  /** center wavelength, nm */
  center: number;
  /** Gaussian standard deviation, nm — a shake widens both bands together. */
  width: number;
  /** ε_max (peak molar absorptivity, L·mol⁻¹·cm⁻¹, in the room's own scale). */
  epsilonMax: number;
};

export const BAND_PI: BandParams = { center: 260, width: 18, epsilonMax: 7000 };
export const BAND_N: BandParams = { center: 285, width: 26, epsilonMax: 350 };

/** How much a shake broadens both Gaussians (fractional add on width). */
export const THERMAL_BROADEN_MAX = 0.9;

/** Ceremony persistence key. */
export const OBSERVE_STORAGE_KEY = "objetdart:observe:v1";

// ——— determinism —————————————————————————————————————————————————————————

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

// ——— wavelength → RGB ————————————————————————————————————————————————————

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Map a wavelength (nm) to a visible RGB triple in 0..1.
 *
 * A pedagogical remapping — real UV is invisible — designed so a visitor
 * dragging left to right traverses violet → indigo → blue → cyan → green →
 * yellow → orange → red, with the deep-UV end (200 nm) presented as a very
 * dark violet (the "invisible" edge) and the far-red end (800 nm) as a dark
 * near-black red. The middle of the visible (400–700 nm) uses the standard
 * spectrum stops so the palette reads as real light, not a rainbow band.
 */
export function wavelengthToRgb(nm: number): [number, number, number] {
  const w = Math.max(LAMBDA_MIN, Math.min(LAMBDA_MAX, nm));
  // Piecewise linear across anchors chosen so 380–700 nm looks like real
  // visible light and 200–380 / 700–800 fall off toward invisible edges.
  let r = 0;
  let g = 0;
  let b = 0;
  if (w < 380) {
    // deep UV → dark violet (200) up to true violet (380)
    const t = (w - 200) / 180;
    r = 0.15 + 0.35 * t;
    g = 0.0;
    b = 0.25 + 0.55 * t;
  } else if (w < 440) {
    r = -(w - 440) / 60;
    g = 0.0;
    b = 1.0;
  } else if (w < 490) {
    r = 0.0;
    g = (w - 440) / 50;
    b = 1.0;
  } else if (w < 510) {
    r = 0.0;
    g = 1.0;
    b = -(w - 510) / 20;
  } else if (w < 580) {
    r = (w - 510) / 70;
    g = 1.0;
    b = 0.0;
  } else if (w < 645) {
    r = 1.0;
    g = -(w - 645) / 65;
    b = 0.0;
  } else if (w < 780) {
    r = 1.0;
    g = 0.0;
    b = 0.0;
  } else {
    // far-red into invisible: darken deep red down toward black
    const t = (w - 780) / 20;
    r = 1.0 - t * 0.6;
    g = 0.0;
    b = 0.0;
  }
  // Deep-UV and far-red attenuate — real visibility drops off past the
  // edges, and the room mimics that so an off-axis wavelength reads as
  // "less light" rather than a saturated hue.
  let f = 1.0;
  if (w < 380) f = 0.35 + 0.65 * ((w - 200) / 180);
  else if (w > 700) f = 1.0 - 0.7 * Math.min(1, (w - 700) / 100);
  return [clamp01(r * f), clamp01(g * f), clamp01(b * f)];
}

/** Inverse: normalized x (0..1) across the frame → wavelength in nm. */
export function xToWavelength(x: number): number {
  const t = clamp01(x);
  return LAMBDA_MIN + t * (LAMBDA_MAX - LAMBDA_MIN);
}

/** Inverse of xToWavelength — nm → x on the frame. */
export function wavelengthToX(nm: number): number {
  const t = (nm - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN);
  return clamp01(t);
}

// ——— the bands, absorbance, Beer-Lambert ——————————————————————————————

/**
 * One Gaussian in ε(λ) space. `broaden` is a fractional widening (0 = spec
 * width, 1 = spec width × 2) applied uniformly — the shake's thermal broad.
 */
export function gaussianBand(
  lambda: number,
  center: number,
  width: number,
  epsilonMax: number,
  broaden = 0,
): number {
  const w = Math.max(1e-6, width * (1 + broaden));
  const z = (lambda - center) / w;
  return epsilonMax * Math.exp(-z * z);
}

/**
 * Total ε(λ) for the sample: sum of the two chromophore Gaussians. Two
 * bands is the whole model — every user-facing behavior derives from them.
 */
export function sampleEpsilon(lambda: number, broaden = 0): number {
  return (
    gaussianBand(lambda, BAND_PI.center, BAND_PI.width, BAND_PI.epsilonMax, broaden) +
    gaussianBand(lambda, BAND_N.center, BAND_N.width, BAND_N.epsilonMax, broaden)
  );
}

/**
 * Absorbance A(λ) = ε(λ) · c · l. Concentration is normalized against the
 * reference — a three-finger twist scales it up or down continuously.
 */
export function sampleAbsorbance(
  lambda: number,
  concentration: number = REFERENCE_CONCENTRATION,
  broaden = 0,
  pathLength: number = PATH_LENGTH,
): number {
  return sampleEpsilon(lambda, broaden) * concentration * pathLength;
}

/**
 * Beer-Lambert transmittance: T = 10^(-A). The far wall paints the beam
 * through T — dark where A is high, bright where A is near zero.
 */
export function beerLambert(absorbance: number, pathLength: number = 1): number {
  return Math.pow(10, -absorbance * pathLength);
}

// ——— the molecules ———————————————————————————————————————————————————————

export type Molecule = {
  id: number;
  /** the determinism law: every generated detail is a function of this. */
  seed: number;
  /** normalized position in the cuvette, 0..1 on both axes. */
  nx: number;
  ny: number;
  /** drift velocity (normalized units per second). */
  vx: number;
  vy: number;
  bornMs: number;
  /**
   * excited-state charge: 0 at rest, climbs on absorption, decays to zero
   * as the molecule relaxes back to ground. When > 0.5 the molecule visibly
   * shudders and its outer cloud brightens toward the wavelength color.
   */
  excited: number;
  /**
   * ms of the absorption event that lit it — for computing the shudder phase
   * and the relaxation. null while at rest.
   */
  lastAbsorbMs: number | null;
  /** the beam wavelength (nm) that last excited it — sets the glow color. */
  lastLambda: number;
  /** 1 while it stands, falling to 0 as it drifts out. Removed at 0. */
  presence: number;
};

/** Deterministic birth — every trait is a function of the seed alone. */
export function bornMolecule(
  id: number,
  seed: number,
  nx: number,
  ny: number,
  tMs: number,
): Molecule {
  const rng = mulberry32(seed);
  return {
    id,
    seed,
    nx: Math.min(0.97, Math.max(0.03, nx)),
    ny: Math.min(0.97, Math.max(0.03, ny)),
    vx: (rng() - 0.5) * 0.06,
    vy: (rng() - 0.5) * 0.06,
    bornMs: tMs,
    excited: 0,
    lastAbsorbMs: null,
    lastLambda: 0,
    presence: 1,
  };
}

/** Presence lost per second while a molecule drifts out. */
export const UNRAVEL_RATE = 0.6;
/** Excited-state relaxation time constant (seconds). */
export const RELAX_TAU_S = 0.45;

/**
 * Advance every molecule by dt seconds. Brownian noise is a seeded function
 * of (mol.seed, tick), so two runs of the same scene produce the same
 * drift — the determinism law. Tilt biases drift along gravity, wind adds a
 * uniform push, temperature widens the noise, timeScale is the three-finger
 * hold dilation. Everything continuous.
 */
export type FieldInput = {
  /** normalized wind, -1..1 in each axis. */
  windX: number;
  windY: number;
  /** normalized tilt, -1..1 in each axis; gravity pulls molecules downhill. */
  tiltX: number;
  tiltY: number;
  /** 0..1 vessel agitation — from shake and the temperature knob. */
  temperature: number;
  /** 1 normally, < 1 while a three-finger hold slows the world. */
  timeScale: number;
  /** ms of the room's own clock — reused as the noise tick's seed input. */
  tMs: number;
  reduced: boolean;
};

export function stepMolecules(
  mols: Molecule[],
  dt: number,
  input: FieldInput,
): void {
  const d = Math.max(0, Math.min(0.1, dt)) * input.timeScale;
  const tSec = input.tMs / 1000;
  const brown = 0.09 + input.temperature * 0.28;
  const damp = Math.exp(-0.9 * d);
  for (const m of mols) {
    // excited state: exponential relaxation to ground.
    if (m.excited > 0) {
      m.excited = m.excited * Math.exp(-d / RELAX_TAU_S);
      if (m.excited < 0.005) m.excited = 0;
    }
    if (m.presence < 1) {
      m.presence = Math.max(0, m.presence - UNRAVEL_RATE * d);
      continue;
    }
    if (!input.reduced) {
      // Brownian velocity kick — seeded, deterministic given (mol, tick).
      const tick = Math.floor(tSec * 6);
      const rng = mulberry32(hashSeed(m.seed, tick));
      const jx = (rng() - 0.5);
      const jy = (rng() - 0.5);
      m.vx += (jx * brown + input.windX * 0.14 + input.tiltX * 0.20) * d * 6;
      m.vy += (jy * brown + input.windY * 0.14 + input.tiltY * 0.20) * d * 6;
    }
    m.vx *= damp;
    m.vy *= damp;
    m.nx += m.vx * d;
    m.ny += m.vy * d;
    // wall reflection — the cuvette holds its solvent.
    if (m.nx < 0.03) { m.nx = 0.03; m.vx = Math.abs(m.vx) * 0.5; }
    if (m.nx > 0.97) { m.nx = 0.97; m.vx = -Math.abs(m.vx) * 0.5; }
    if (m.ny < 0.03) { m.ny = 0.03; m.vy = Math.abs(m.vy) * 0.5; }
    if (m.ny > 0.97) { m.ny = 0.97; m.vy = -Math.abs(m.vy) * 0.5; }
  }
}

// ——— the photon: absorption law ————————————————————————————————————————

export type PhotonHit = {
  /** true if the molecule absorbed and shuddered. */
  absorbed: boolean;
  /** energy the molecule swallowed, 0..1 in the room's own scale. */
  energyDeposited: number;
};

/**
 * Fire a photon of wavelength `lambda` (nm) at intensity `intensity` (0..1)
 * at this molecule. Deterministic given (mol.seed, quantized λ, quantized
 * intensity) — the seed law: the same beam on the same molecule gives the
 * same answer, always. Probability of absorption ∝ gaussianBand at λ,
 * normalized so the peak of the strong π→π* band absorbs almost surely at
 * full intensity.
 *
 * A successful hit mutates the molecule: excited climbs by `intensity`
 * (capped 1), lastAbsorbMs is set, lastLambda is recorded — the shader
 * reads these to shudder the sprite and colour its outer glow with the
 * beam. Non-absorbing molecules are untouched.
 */
export function photonHit(
  mol: Molecule,
  lambda: number,
  intensity: number,
  tMs: number,
  broaden = 0,
): PhotonHit {
  if (mol.presence < 1) return { absorbed: false, energyDeposited: 0 };
  const eps = sampleEpsilon(lambda, broaden);
  // Normalize probability against the strong band's peak — a beam parked
  // dead-on the π→π* center excites with near-certainty; a beam parked at
  // the shoulder or between bands almost never lands.
  const pMax = BAND_PI.epsilonMax + BAND_N.epsilonMax;
  const p = Math.max(0, Math.min(1, (eps / pMax) * intensity));
  // Deterministic dice — quantize inputs so tiny wobbles in λ or intensity
  // do not flip the result frame-to-frame.
  const q = Math.floor(lambda * 4) + Math.floor(intensity * 32) * 8192;
  const rng = mulberry32(hashSeed(mol.seed, q));
  const roll = rng();
  if (roll >= p) return { absorbed: false, energyDeposited: 0 };
  const energy = intensity * (0.5 + p * 0.5);
  mol.excited = Math.min(1, mol.excited + energy);
  mol.lastAbsorbMs = tMs;
  mol.lastLambda = lambda;
  return { absorbed: true, energyDeposited: energy };
}

// ——— the ghost spectrum: an accumulator with decay ——————————————————

/**
 * Along the top of the cuvette the room draws a curve of A(λ): the sample's
 * UV/Vis fingerprint, built from the population's response to the visitor's
 * beam. Every hit adds a bit at (λ, A_hit); the whole curve fades slowly so
 * a hand that sweeps once then wanders sees the curve breathe back out.
 *
 * BINS is chosen so each bin is ~1.5 nm across at 400 bins over 600 nm —
 * finer than the eye can pick up but coarse enough that a single hit lifts
 * a visible spike, not one pixel's worth.
 */
export const SPECTRUM_BINS = 400;
export const SPECTRUM_DECAY_PER_SEC = 0.35;
export const SPECTRUM_MAX = 3.5;

export type SpectrumAccumulator = {
  /** length SPECTRUM_BINS, values 0..SPECTRUM_MAX. */
  bins: Float32Array;
  /** last tMs the accumulator was advanced. */
  lastMs: number;
};

export function createSpectrumAccumulator(tMs = 0): SpectrumAccumulator {
  return {
    bins: new Float32Array(SPECTRUM_BINS),
    lastMs: tMs,
  };
}

/** Which bin a wavelength lands in. */
export function spectrumBinFor(lambda: number): number {
  const u = (lambda - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN);
  return Math.max(0, Math.min(SPECTRUM_BINS - 1, Math.floor(u * SPECTRUM_BINS)));
}

/** The wavelength at the center of a given bin. */
export function wavelengthAtBin(bin: number): number {
  const u = (bin + 0.5) / SPECTRUM_BINS;
  return LAMBDA_MIN + u * (LAMBDA_MAX - LAMBDA_MIN);
}

/**
 * Add a fresh absorbance sample to the accumulator. A single hit at
 * wavelength λ contributes to that bin AND smears a little into the two
 * neighbors, so the ghost curve is smooth even from sparse samples.
 */
export function spectrumAdd(
  acc: SpectrumAccumulator,
  lambda: number,
  absorbance: number,
): void {
  const bin = spectrumBinFor(lambda);
  const gain = Math.max(0, absorbance);
  const bins = acc.bins;
  bins[bin] = Math.min(SPECTRUM_MAX, bins[bin] + gain);
  if (bin > 0) bins[bin - 1] = Math.min(SPECTRUM_MAX, bins[bin - 1] + gain * 0.45);
  if (bin < SPECTRUM_BINS - 1) bins[bin + 1] = Math.min(SPECTRUM_MAX, bins[bin + 1] + gain * 0.45);
}

/** Decay every bin toward zero at SPECTRUM_DECAY_PER_SEC * dt. */
export function spectrumDecay(acc: SpectrumAccumulator, dt: number, tMs: number): void {
  const d = Math.max(0, Math.min(0.5, dt));
  const keep = Math.exp(-SPECTRUM_DECAY_PER_SEC * d);
  const bins = acc.bins;
  for (let i = 0; i < bins.length; i++) bins[i] *= keep;
  acc.lastMs = tMs;
}

/** The peak absorbance currently in the accumulator — for the ghost curve's autoscale. */
export function spectrumPeak(acc: SpectrumAccumulator): number {
  let m = 0;
  const bins = acc.bins;
  for (let i = 0; i < bins.length; i++) if (bins[i] > m) m = bins[i];
  return m;
}

// ——— persistence: the kept sigil ————————————————————————————————————

export type KeptSpectrum = {
  v: 1;
  /** stored as fixed-point integer 0..1000 so the JSON stays compact. */
  bins: number[];
};

export function serializeSpectrum(acc: SpectrumAccumulator): KeptSpectrum {
  const out: number[] = new Array(SPECTRUM_BINS);
  const scale = 1000 / SPECTRUM_MAX;
  for (let i = 0; i < SPECTRUM_BINS; i++) {
    out[i] = Math.round(acc.bins[i] * scale);
  }
  return { v: 1, bins: out };
}

export function loadSpectrum(raw: unknown, tMs: number): SpectrumAccumulator {
  const acc = createSpectrumAccumulator(tMs);
  if (!raw || typeof raw !== "object") return acc;
  const kept = raw as Partial<KeptSpectrum>;
  if (kept.v !== 1 || !Array.isArray(kept.bins)) return acc;
  const inv = SPECTRUM_MAX / 1000;
  const n = Math.min(SPECTRUM_BINS, kept.bins.length);
  for (let i = 0; i < n; i++) {
    const v = kept.bins[i];
    if (typeof v === "number" && v > 0) acc.bins[i] = Math.min(SPECTRUM_MAX, v * inv);
  }
  return acc;
}

/**
 * Reduce a population to instance draw data for the shared population-layer.
 * The layer expects eight numbers per instance (see scene/instances.ts). This
 * is the emit-side of the observation, exported so a caller can also use it
 * for hit-testing (nearest molecule to a beam sample).
 */
export function moleculeRadius(m: Molecule): number {
  // Excited molecules bloom outward — a shudder plus a glow that fills in
  // as the excited state climbs.
  return 3.5 + m.excited * 4;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — the five altitudes
// ═══════════════════════════════════════════════════════════════════════════
//
// One substance, five representations. Phase 1's cuvette-from-above sits at
// the mid altitude (zoom 16–256, "solution"). Pinching in from there swells
// one molecule into the frame (256–1024 transition, then 1024–2048 the
// ball-and-stick model itself) and eventually reveals the aromatic ring's
// π-system (2048–4096, the chromophore). Pinching OUT lifts the visitor
// above the beaker (2–16 transition) to the crystalline solid on the
// bench-top (1–2). Every altitude renders a different material, but the
// SUBJECT is the same — the room's o-chlorophenyl cyclohexanone family.
//
// The transitions are cinematic. Between two hard altitudes the material of
// the outgoing layer alpha-blends into the material of the incoming layer —
// crystal facets dissolving into a beaker of solvent, the cuvette shrinking
// as one molecule swells out of it, the molecule fading behind its own
// electron cloud. The visitor SEES the crossing, does not cut through it.

/**
 * The room's membership in the scale manifold. Widest = the crystal on the
 * matte-black bench-top; tightest = the chromophore's π-cloud pulsing with
 * the room breath. `useBandEdgeTravel` reads this and turns residual pinch at
 * the two extremes into wall pressure on the /drop band — the same detent,
 * the same 320 ms of intent, the same handoff every other manifold room uses.
 */
export const OBSERVE_ZOOM_SPEC: RoomZoomSpec = {
  band: "drop",
  zoomMin: 1,
  zoomMax: 4096,
};

/**
 * The six altitudes, from widest to tightest. Two ("dissolve", "moleculeZoom")
 * are transition bands whose whole content is the crossfade between their
 * neighbours; the other four are the destinations the visitor lands on.
 */
export type Altitude =
  | "crystal"
  | "dissolve"
  | "solution"
  | "moleculeZoom"
  | "molecule"
  | "chromophore";

/**
 * Which altitude a zoom sits at, and — inside a transition band — how far
 * the crossfade toward the incoming altitude has advanced (0 = fully
 * outgoing, 1 = fully incoming). Named on log(zoom) so the fade is uniform
 * per pinch decade regardless of where the visitor entered the band.
 *
 * Ranges (see the /observe field-guide entry and the room manifest):
 *   [1, 2)     crystal      (heap of crystal on the bench)
 *   [2, 16)    dissolve     (crystal falling into solvent — crystal→solution)
 *   [16, 256)  solution     (Phase 1's cuvette-from-above)
 *   [256, 1024)  moleculeZoom  (one molecule swelling — solution→molecule)
 *   [1024, 2048) molecule   (ball-and-stick model, chirality flip)
 *   [2048, 4096] chromophore (aromatic ring's π-system, MO diagram)
 */
export const ALTITUDE_BOUNDS: Record<Altitude, { lo: number; hi: number }> = {
  crystal:      { lo: 1,    hi: 2 },
  dissolve:     { lo: 2,    hi: 16 },
  solution:     { lo: 16,   hi: 256 },
  moleculeZoom: { lo: 256,  hi: 1024 },
  molecule:     { lo: 1024, hi: 2048 },
  chromophore:  { lo: 2048, hi: 4096 },
};

export function altitudeFromZoom(zoom: number): {
  current: Altitude;
  incoming: Altitude | null;
  blend: number;
} {
  const z = Math.max(OBSERVE_ZOOM_SPEC.zoomMin, Math.min(OBSERVE_ZOOM_SPEC.zoomMax, zoom));
  const order: Altitude[] = [
    "crystal",
    "dissolve",
    "solution",
    "moleculeZoom",
    "molecule",
    "chromophore",
  ];
  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    const { lo, hi } = ALTITUDE_BOUNDS[a];
    const inRange = i === order.length - 1 ? z >= lo && z <= hi : z >= lo && z < hi;
    if (!inRange) continue;
    // In a transition band the incoming altitude is the neighbour on the
    // tightening side (index + 1); the blend is the log-fraction across.
    const isTransition = a === "dissolve" || a === "moleculeZoom";
    if (isTransition && i + 1 < order.length) {
      // "dissolve" fades crystal → solution; "moleculeZoom" fades
      // solution → molecule. The `incoming` field names which altitude is
      // rising, not the transition band itself.
      const incoming: Altitude = a === "dissolve" ? "solution" : "molecule";
      const blend = Math.log(z / lo) / Math.log(hi / lo);
      return { current: a, incoming, blend };
    }
    return { current: a, incoming: null, blend: 0 };
  }
  // Unreachable given clamping, but return crystal for defensive callers.
  return { current: "crystal", incoming: null, blend: 0 };
}

/**
 * Per-altitude render weights — the four terminal altitudes each get a 0..1
 * weight and the caller mixes their materials. Inside a transition band the
 * two neighbouring weights sum to 1; at a hard altitude one weight is 1 and
 * the rest are 0. The shader reads these four uniforms directly instead of
 * inspecting altitudeFromZoom's string discriminant, so the composition is a
 * simple weighted sum and never a branch.
 */
export function altitudeWeights(zoom: number): {
  crystal: number;
  solution: number;
  molecule: number;
  chromophore: number;
} {
  const alt = altitudeFromZoom(zoom);
  const w = { crystal: 0, solution: 0, molecule: 0, chromophore: 0 };
  if (alt.current === "crystal") w.crystal = 1;
  else if (alt.current === "solution") w.solution = 1;
  else if (alt.current === "molecule") w.molecule = 1;
  else if (alt.current === "chromophore") w.chromophore = 1;
  else if (alt.current === "dissolve") {
    w.crystal = 1 - alt.blend;
    w.solution = alt.blend;
  } else if (alt.current === "moleculeZoom") {
    w.solution = 1 - alt.blend;
    w.molecule = alt.blend;
  }
  return w;
}

// ——— the crystal altitude ————————————————————————————————————————————————
//
// A small heap of clear crystalline chunks sits on a matte-black bench-top.
// Each flake catches an overhead lamp — faceted highlights, a hint of
// refracted caustic on the bench beneath. A tap on a facet dislodges one
// flake and it tumbles; a tilt leans the whole heap; a ceremony hold
// nucleates a fresh crystal at the finger. Pinching in dissolves the heap
// into the beaker of solvent below.

/** Maximum number of flakes in a crystal heap at any time. */
export const CRYSTAL_CAP = 24;
/** Gravity in normalized-y units per second² for the crystal altitude. */
export const CRYSTAL_GRAVITY = 0.9;
/** Damping applied per second to a resting flake's velocity. */
export const CRYSTAL_DAMP_PER_S = 3.2;

export type CrystalFlake = {
  id: number;
  /** deterministic — every trait derives from this. */
  seed: number;
  /** normalized position on the bench. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** rotation angle in radians. */
  rot: number;
  /** angular velocity, rad/s. */
  omega: number;
  /**
   * size class, 0..1 — small flakes settle first and shine less. Radius on
   * screen is bornRadius * (0.6 + 0.4 * size).
   */
  size: number;
  /** true once the flake has hit the pile floor (no more gravity). */
  settled: boolean;
};

/**
 * Deterministic birth. The seed alone decides shape, spin and glint — a
 * flake nucleated with the same seed at the same tick returns exactly.
 */
export function bornCrystalFlake(
  id: number,
  seed: number,
  x: number,
  y: number,
): CrystalFlake {
  const rng = mulberry32(seed);
  return {
    id,
    seed,
    x: Math.min(0.97, Math.max(0.03, x)),
    y: Math.min(0.97, Math.max(0.03, y)),
    vx: (rng() - 0.5) * 0.05,
    vy: (rng() - 0.5) * 0.02,
    rot: rng() * Math.PI * 2,
    omega: (rng() - 0.5) * 0.6,
    size: 0.35 + rng() * 0.65,
    settled: false,
  };
}

/**
 * Advance every flake by dt seconds. Tilt biases lateral drift so a leaned
 * bench actually slides the heap sideways; a settled flake keeps its rest
 * position (no perpetual sliding under gravity — a real heap holds). Same
 * seed + same field = same step, always.
 */
export function stepCrystal(
  flakes: CrystalFlake[],
  dt: number,
  tilt: { x: number; y: number } = { x: 0, y: 0 },
): void {
  const d = Math.max(0, Math.min(0.1, dt));
  const damp = Math.exp(-CRYSTAL_DAMP_PER_S * d);
  const floor = 0.86; // where the bench-top sits, in normalized-y
  for (const f of flakes) {
    if (!f.settled) {
      f.vy += CRYSTAL_GRAVITY * d;
      f.vx += tilt.x * 0.35 * d;
      f.vy += tilt.y * 0.15 * d;
      f.rot += f.omega * d;
      f.omega *= damp;
      f.x += f.vx * d;
      f.y += f.vy * d;
      if (f.y >= floor) {
        f.y = floor;
        f.vy = 0;
        f.vx *= 0.4;
        if (Math.abs(f.vx) < 0.02) f.settled = true;
      }
    } else {
      // gentle sway on the pile if the bench is leaned hard enough
      const lean = tilt.x * 0.02 * d;
      f.x += lean;
      if (Math.abs(tilt.x) > 0.45) f.settled = false;
    }
    // walls of the bench
    if (f.x < 0.05) { f.x = 0.05; f.vx = Math.abs(f.vx) * 0.4; }
    if (f.x > 0.95) { f.x = 0.95; f.vx = -Math.abs(f.vx) * 0.4; }
  }
}

/**
 * Caustic intensity at (x, y) at time tSec, bounded 0..1, deterministic in
 * (x, y, tSec, seed). The shader mirrors this in GLSL to paint scattered
 * refracted light beneath a flake; keeping the JS twin lets `test-observe`
 * pin the shape and the shader's caustic can never drift silently. Uses a
 * cheap 2-octave value-noise ridge — the same form the shader inlines.
 */
export function crystalCaustics(x: number, y: number, tSec: number, seed: number): number {
  // Two rotated sinusoids beating against each other produce a lattice of
  // bright lines a real caustic reads as. Seed decouples per-flake caustics
  // so two identical flakes side by side do not shimmer in lockstep.
  const s = (seed & 0xffff) / 0xffff;
  const kx = 8.5 + s * 4;
  const ky = 9.7 - s * 3;
  const t = tSec * 0.4 + s * 6.283;
  const a = Math.sin(x * kx + t) * Math.cos(y * ky - t * 0.7);
  const b = Math.sin((x + y) * (kx * 0.6) + t * 0.9) * Math.cos((x - y) * (ky * 0.6));
  const raw = 0.5 + 0.5 * (a * 0.6 + b * 0.4);
  return Math.max(0, Math.min(1, raw));
}

// ——— the molecule altitude ————————————————————————————————————————————
//
// One ball-and-stick molecule dominates the frame. The chair conformation
// of the cyclohexanone ring flips slowly on the shared 7s breath; the
// aromatic ring's plane is rendered translucent, with a hint of the
// π-density above and below the plane. A two-finger twist at this altitude
// flips chirality: the S enantiomer mirrors into the R enantiomer, same
// connectivity, opposite spatial arrangement of the substituents around the
// chirality center. A tap on a bond lights it and prints its bond order.

/**
 * A single atom in the ball-and-stick model. Coordinates are in a small
 * local frame around the chirality center; the renderer rotates and
 * projects them each frame. Elements are the ones the compound actually
 * carries: carbon, hydrogen, oxygen, nitrogen, chlorine.
 */
export type AtomElement = "C" | "H" | "O" | "N" | "Cl";
export type Atom3D = {
  el: AtomElement;
  x: number;
  y: number;
  z: number;
};

/** A bond between two atoms (indices into the state's atom list). */
export type Bond3D = {
  a: number;
  b: number;
  /** 1 = single, 2 = double, 3 = triple. Aromatic rings emit 1.5 as a pair of alternating 1/2. */
  order: 1 | 2 | 3;
};

export type MoleculeState = {
  /** the enantiomer currently in view. flipChirality toggles this. */
  chirality: "S" | "R";
  /** camera-space rotation, radians (Euler xyz applied at render time). */
  rotation: [number, number, number];
  /** 0..1 chair-flip animation phase; 0 = chair, 1 = alt-chair. */
  chairFlipPhase: number;
  /** the atoms of the model. Connectivity (bonds) stays constant under chirality flip. */
  atoms: Atom3D[];
  /** the bonds — this list never mutates when chirality flips. */
  bonds: Bond3D[];
};

/**
 * A representative six-carbon ring with one carbonyl (=O), one chlorine on
 * an ortho carbon, and hydrogens filling out the valences — enough atoms and
 * bonds that a chirality flip is visually distinct without cluttering the
 * frame. The o-chlorophenyl fragment is stated as a small aromatic ring on
 * the far side of the chirality center; the maker's compound is the reason
 * this ring is drawn, and the maker's reticence keeps its name out of the
 * room copy (§manifest voice).
 */
export function bornMolecule3D(): MoleculeState {
  // Cyclohexanone ring (6C in a chair), with a carbonyl at position 1, a
  // methylene bridge at position 2 bound to the aromatic fragment, and
  // ring hydrogens elided except for the axial/equatorial at C2 (the
  // chirality center).
  const atoms: Atom3D[] = [
    // ring carbons — chair conformation z-values alternate
    { el: "C", x:  1.20, y: 0.00, z:  0.25 },  // 0: C1 (carbonyl carbon)
    { el: "C", x:  0.60, y: 1.04, z: -0.25 },  // 1: C2 (chirality center)
    { el: "C", x: -0.60, y: 1.04, z:  0.25 },  // 2: C3
    { el: "C", x: -1.20, y: 0.00, z: -0.25 },  // 3: C4
    { el: "C", x: -0.60, y: -1.04, z: 0.25 },  // 4: C5
    { el: "C", x:  0.60, y: -1.04, z: -0.25 }, // 5: C6
    // carbonyl oxygen and substituents
    { el: "O", x:  2.40, y: 0.00, z:  0.55 },  // 6: =O on C1
    // aromatic ring on the substituent branch (a phenyl group)
    { el: "C", x:  1.30, y: 2.20, z:  0.60 },  // 7: ipso-C
    { el: "C", x:  2.55, y: 2.40, z:  1.10 },  // 8: ortho-C (bears Cl)
    { el: "C", x:  3.15, y: 3.60, z:  1.70 },  // 9: meta-C
    { el: "C", x:  2.50, y: 4.65, z:  1.85 },  // 10: para-C
    { el: "C", x:  1.25, y: 4.50, z:  1.35 },  // 11: meta-C
    { el: "C", x:  0.65, y: 3.30, z:  0.75 },  // 12: ortho-C
    // Cl on the ortho carbon (ortho to the ring's bridge)
    { el: "Cl", x: 3.30, y: 1.30, z:  1.80 },  // 13
    // axial H on C2 — this is the chirality-defining substituent
    { el: "H", x:  0.60, y: 1.04, z: -1.45 },  // 14
  ];
  const bonds: Bond3D[] = [
    // cyclohexanone ring
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 3, b: 4, order: 1 },
    { a: 4, b: 5, order: 1 },
    { a: 5, b: 0, order: 1 },
    // carbonyl
    { a: 0, b: 6, order: 2 },
    // aromatic ring
    { a: 1, b: 7, order: 1 },
    { a: 7, b: 8, order: 2 },
    { a: 8, b: 9, order: 1 },
    { a: 9, b: 10, order: 2 },
    { a: 10, b: 11, order: 1 },
    { a: 11, b: 12, order: 2 },
    { a: 12, b: 7, order: 1 },
    // Cl on ortho carbon
    { a: 8, b: 13, order: 1 },
    // H on chirality center
    { a: 1, b: 14, order: 1 },
  ];
  return {
    chirality: "S",
    rotation: [0, 0, 0],
    chairFlipPhase: 0,
    atoms,
    bonds,
  };
}

/**
 * Mirror the molecule across the xy-plane (invert z). Connectivity is
 * preserved (the bond list never changes), so the atoms remain the same
 * atoms with the same neighbours — only the spatial arrangement around the
 * chirality center flips. Two flips return exactly to the starting state:
 * `test:observe` asserts this involution and the connectivity invariant.
 */
export function flipChirality(state: MoleculeState): MoleculeState {
  return {
    ...state,
    chirality: state.chirality === "S" ? "R" : "S",
    atoms: state.atoms.map((a) => ({ ...a, z: -a.z })),
    bonds: state.bonds.map((b) => ({ ...b })), // deep-copy but unchanged
  };
}

/** Rotate the model by (dqx, dqy) radians about y and x axes. */
export function rotateMolecule(
  state: MoleculeState,
  dqx: number,
  dqy: number,
): MoleculeState {
  const [rx, ry, rz] = state.rotation;
  return {
    ...state,
    rotation: [
      rx + dqy,
      ry + dqx,
      rz,
    ],
  };
}

/**
 * Advance the molecule state by dt seconds. Breath (0..1) drives the slow
 * chair flip — a real conformational change, not a decoration, tuned so the
 * whole flip takes about a room breath (7 s). Rotation coasts on damping.
 */
export function stepMolecule(state: MoleculeState, dt: number, breath: number): MoleculeState {
  const d = Math.max(0, Math.min(0.1, dt));
  const b = Math.max(0, Math.min(1, breath));
  const [rx, ry, rz] = state.rotation;
  // Chair flip: a slow phase that oscillates 0↔1 with the breath.
  const targetPhase = 0.5 - 0.5 * Math.cos(b * Math.PI * 2);
  const phase = state.chairFlipPhase + (targetPhase - state.chairFlipPhase) * Math.min(1, d * 1.2);
  // Gentle rotation damping — the model rests after a drag.
  const damp = Math.exp(-1.4 * d);
  return {
    ...state,
    rotation: [rx * damp + 0.001 * b, ry * damp, rz],
    chairFlipPhase: phase,
  };
}

// ——— the chromophore altitude ————————————————————————————————————————
//
// The aromatic ring's plane fills the frame, drawn as a translucent hex
// with a soft π-cloud lobe above and below. In one corner a small HOMO/LUMO
// diagram shows the energy gap ΔE; a photon of the finger's wavelength
// descends from above and — if resonant — kicks an electron across. A span
// (two still fingers) lights up particle-in-a-box: the interval sets L,
// ΔE recomputes as n²h²/8mL², the finger's wavelength lights the
// transition when the beam energy equals ΔE. A twist picks n; a tap fires.

/** SI constants — Planck, speed of light, electron mass, one eV in J. */
export const PLANCK_H = 6.62607015e-34; // J·s
export const SPEED_OF_LIGHT = 2.99792458e8; // m/s
export const ELECTRON_MASS = 9.1093837015e-31; // kg
export const EV_IN_JOULES = 1.602176634e-19;

/**
 * Particle-in-a-box transition energy between quantum numbers n1 and n2
 * for a box of length L (metres), returned in eV.
 *
 *   E_n = n² h² / (8 m L²)
 *   ΔE  = (n2² − n1²) · h² / (8 m L²)
 *
 * Scales as 1/L² — a box twice as wide holds electrons a quarter as
 * energetic, the same n1→n2 transition falls to a quarter of ΔE. `test:observe`
 * pins that inverse-square identity, because it is the whole reason a span
 * gesture (which sets L) is a real dial and not decoration.
 */
export function moTransitionEnergy(n1: number, n2: number, L: number): number {
  const safeL = Math.max(1e-12, L);
  const dE_joules =
    (n2 * n2 - n1 * n1) * (PLANCK_H * PLANCK_H) / (8 * ELECTRON_MASS * safeL * safeL);
  return dE_joules / EV_IN_JOULES;
}

/**
 * Photon energy from wavelength in nm, returned in eV.
 *
 *   E = h c / λ   ⇒   E_eV = (h c / EV_IN_JOULES) · (1 / λ_meters)
 */
export function photonEnergyFromWavelength(lambdaNm: number): number {
  const lambdaMeters = Math.max(1e-12, lambdaNm * 1e-9);
  const E_joules = (PLANCK_H * SPEED_OF_LIGHT) / lambdaMeters;
  return E_joules / EV_IN_JOULES;
}

/**
 * Whether a photon of wavelength `lambdaNm` is resonant with an electronic
 * transition of energy `deltaE_eV`, to within `tol_eV`. A pure test of
 * energy match; the room uses it to decide when the descending photon on
 * the chromophore altitude gets swallowed.
 */
export function resonant(lambdaNm: number, deltaE_eV: number, tol_eV: number): boolean {
  const E = photonEnergyFromWavelength(lambdaNm);
  return Math.abs(E - deltaE_eV) <= Math.max(0, tol_eV);
}

/** A photon descending toward the chromophore in the /observe chromophore altitude. */
export type ChromophorePhoton = {
  /** wavelength in nm — the finger picks it, the palette function colours it. */
  lambda: number;
  /** normalized y in the frame, 0 at top, 1 at bottom. Photons fall from y=0. */
  y: number;
  /** performance.now() ms at which the photon left the top of the frame. */
  born: number;
};

/** Advance every photon by dt seconds; a fallen-past-bottom photon returns absent. */
export const CHROMOPHORE_PHOTON_SPEED = 1.4; // normalized y per second — 700ms to fall
export function stepChromophorePhotons(
  photons: ChromophorePhoton[],
  dt: number,
): ChromophorePhoton[] {
  const d = Math.max(0, Math.min(0.1, dt));
  const out: ChromophorePhoton[] = [];
  for (const p of photons) {
    const y = p.y + CHROMOPHORE_PHOTON_SPEED * d;
    if (y > 1.05) continue; // fell out
    out.push({ ...p, y });
  }
  return out;
}

/**
 * The box length (in metres) the room reads off the visitor's span
 * interval. `spreadPx` is the live px between the two still fingers; the
 * frame width sets the reference. Longer spans → wider box → smaller ΔE.
 * A tight pinch gives a ~0.3 nm box (deep UV); a full-hand span gives
 * ~1.8 nm (visible). The mapping is linear in the interval so the finger's
 * movement is felt directly.
 */
export function chromophoreBoxLength(spreadPx: number, framePx: number): number {
  const t = Math.max(0, Math.min(1, spreadPx / Math.max(1, framePx)));
  // 0.3 nm at zero spread, 2.5 nm at full-hand — the electronic transitions
  // of the two bands both fall inside this range.
  return (0.3 + t * 2.2) * 1e-9;
}
