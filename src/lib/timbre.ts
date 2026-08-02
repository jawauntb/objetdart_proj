// The meta instrument's spectral atlas. Every instrument playing the same
// note shares its fundamental; what separates a piano's C from a sitar's C
// is the recipe stacked on top — relative harmonic amplitudes, how the
// envelope moves, how much the partials detune, what noise the body adds,
// whether the tone breathes vibrato. Each voice below is a point in that
// parameter space, and because the space is continuous, any position
// between two voices is also an instrument. Morphing is interpolation.

export const HARMONIC_COUNT = 12;

export type NoiseColor = "none" | "breath" | "buzz";

export type TimbreSpec = {
  key: string;
  label: string;
  // relative harmonic amplitudes, fundamental first, always HARMONIC_COUNT long
  harmonics: number[];
  // cents between the paired detuned oscillator and the main one — string
  // stiffness and doubled courses read as shimmer
  detune: number;
  attack: number;
  decay: number;
  // 0 = struck/plucked (the note falls away), near 1 = bowed/blown (it holds)
  sustain: number;
  release: number;
  noise: number;
  noiseColor: NoiseColor;
  vibratoHz: number;
  vibratoCents: number;
  // lowpass cutoff as a multiple of the fundamental
  brightness: number;
};

export const TIMBRE_CHAIN: TimbreSpec[] = [
  {
    key: "harp",
    label: "harp",
    harmonics: [1, 0.5, 0.25, 0.12, 0.06, 0.03, 0.015, 0.008, 0.004, 0.002, 0.001, 0.0005],
    detune: 1,
    attack: 0.004,
    decay: 2.2,
    sustain: 0,
    release: 0.4,
    noise: 0,
    noiseColor: "none",
    vibratoHz: 0,
    vibratoCents: 0,
    brightness: 6,
  },
  {
    key: "piano",
    label: "piano",
    harmonics: [1, 0.62, 0.4, 0.3, 0.18, 0.12, 0.09, 0.06, 0.05, 0.035, 0.02, 0.012],
    detune: 3,
    attack: 0.002,
    decay: 1.6,
    sustain: 0,
    release: 0.3,
    noise: 0.02,
    noiseColor: "buzz",
    vibratoHz: 0,
    vibratoCents: 0,
    brightness: 9,
  },
  {
    key: "guitar",
    label: "guitar",
    harmonics: [1, 0.68, 0.34, 0.22, 0.16, 0.09, 0.05, 0.04, 0.02, 0.015, 0.008, 0.004],
    detune: 2,
    attack: 0.003,
    decay: 1.1,
    sustain: 0,
    release: 0.28,
    noise: 0.03,
    noiseColor: "buzz",
    vibratoHz: 0,
    vibratoCents: 0,
    brightness: 8,
  },
  {
    key: "tar",
    label: "tar",
    harmonics: [1, 0.75, 0.5, 0.35, 0.28, 0.18, 0.12, 0.09, 0.05, 0.03, 0.02, 0.01],
    detune: 6,
    attack: 0.003,
    decay: 0.9,
    sustain: 0,
    release: 0.24,
    noise: 0.05,
    noiseColor: "buzz",
    vibratoHz: 0,
    vibratoCents: 0,
    brightness: 10,
  },
  {
    key: "sitar",
    label: "sitar",
    harmonics: [1, 0.8, 0.65, 0.55, 0.5, 0.42, 0.36, 0.3, 0.22, 0.16, 0.1, 0.06],
    detune: 5,
    attack: 0.004,
    decay: 1.4,
    sustain: 0,
    release: 0.5,
    noise: 0.18,
    noiseColor: "buzz",
    vibratoHz: 0,
    vibratoCents: 0,
    brightness: 14,
  },
  {
    key: "violin",
    label: "violin",
    harmonics: [1, 0.78, 0.6, 0.5, 0.4, 0.33, 0.26, 0.2, 0.15, 0.1, 0.07, 0.05],
    detune: 2,
    attack: 0.09,
    decay: 0.4,
    sustain: 0.85,
    release: 0.32,
    noise: 0.05,
    noiseColor: "breath",
    vibratoHz: 5.4,
    vibratoCents: 14,
    brightness: 12,
  },
  {
    key: "saxophone",
    label: "saxophone",
    harmonics: [1, 0.55, 0.8, 0.45, 0.5, 0.3, 0.22, 0.12, 0.08, 0.05, 0.03, 0.02],
    detune: 1,
    attack: 0.05,
    decay: 0.3,
    sustain: 0.9,
    release: 0.26,
    noise: 0.12,
    noiseColor: "breath",
    vibratoHz: 5,
    vibratoCents: 8,
    brightness: 10,
  },
  {
    key: "trumpet",
    label: "trumpet",
    harmonics: [1, 0.85, 0.95, 0.8, 0.7, 0.55, 0.42, 0.3, 0.2, 0.12, 0.07, 0.04],
    detune: 1,
    attack: 0.035,
    decay: 0.25,
    sustain: 0.9,
    release: 0.22,
    noise: 0.06,
    noiseColor: "breath",
    vibratoHz: 4.6,
    vibratoCents: 5,
    brightness: 16,
  },
];

export type TimbreBlend = TimbreSpec & {
  lower: TimbreSpec;
  upper: TimbreSpec;
  mix: number;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// position 0..1 along the chain → the two neighboring voices and how far
// between them the position sits
export function timbreNeighbors(position: number) {
  const clamped = Math.max(0, Math.min(1, position));
  const scaled = clamped * (TIMBRE_CHAIN.length - 1);
  const lowerIndex = Math.min(TIMBRE_CHAIN.length - 2, Math.floor(scaled));
  return {
    lower: TIMBRE_CHAIN[lowerIndex],
    upper: TIMBRE_CHAIN[lowerIndex + 1],
    mix: scaled - lowerIndex,
  };
}

export function blendLabel(lower: TimbreSpec, upper: TimbreSpec, mix: number) {
  if (mix <= 0.08) return lower.label;
  if (mix >= 0.92) return upper.label;
  return `${lower.label} ↔ ${upper.label}`;
}

// The whole point: any position along the chain is itself an instrument.
export function timbreAt(position: number): TimbreBlend {
  const { lower, upper, mix } = timbreNeighbors(position);
  const dominant = mix < 0.5 ? lower : upper;

  return {
    key: `${lower.key}~${upper.key}`,
    label: blendLabel(lower, upper, mix),
    harmonics: lower.harmonics.map((amp, index) => lerp(amp, upper.harmonics[index], mix)),
    detune: lerp(lower.detune, upper.detune, mix),
    attack: lerp(lower.attack, upper.attack, mix),
    decay: lerp(lower.decay, upper.decay, mix),
    sustain: lerp(lower.sustain, upper.sustain, mix),
    release: lerp(lower.release, upper.release, mix),
    noise: lerp(lower.noise, upper.noise, mix),
    noiseColor: dominant.noiseColor,
    vibratoHz: lerp(lower.vibratoHz, upper.vibratoHz, mix),
    vibratoCents: lerp(lower.vibratoCents, upper.vibratoCents, mix),
    brightness: lerp(lower.brightness, upper.brightness, mix),
    lower,
    upper,
    mix,
  };
}
