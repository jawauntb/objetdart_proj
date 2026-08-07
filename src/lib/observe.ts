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
