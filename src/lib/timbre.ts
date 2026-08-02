// The meta instrument's atlas — what actually makes a piano's C not a
// sitar's C. Identity does not live in a static harmonic recipe; it lives
// in the physics of how the note is made and how it dies:
//
// - the attack transient (hammer thump, pick click, bow scratch, breath
//   chiff) — cut the onset off a recording and instruments become nearly
//   indistinguishable;
// - how the spectrum moves in time — a plucked string loses its highs
//   faster than its lows (the damped loop does this for free), while brass
//   brightness blooms *with* loudness;
// - where the string is excited — the pluck point notches the series with
//   a comb (guitar picked near the bridge jangles, a harp stroked at
//   mid-string rounds off);
// - fixed body resonances — formants that stay put while pitch moves under
//   them, which is why a violin glide sounds like one violin and not a
//   swept oscillator.
//
// So the atlas holds two physical models. Strings are Karplus-Strong
// delay-line loops (harp, piano, guitar, tar, sitar). Bowed and blown
// voices are a sawtooth-like source through fixed formants with
// envelope-coupled brightness (violin, saxophone, trumpet). A position
// between two voices crossfades the two physical models equal-power —
// morphing swaps physics, not just tone color.

export type Formant = { freq: number; q: number; gain: number };

export type StringModel = {
  model: "string";
  /** Loop feedback — sets how long the string rings. */
  feedback: number;
  /** Loop lowpass as a multiple of the fundamental — how fast highs die. */
  loopCutoff: number;
  /** Excitation burst lowpass, Hz — pick/hammer/finger hardness. */
  burstBrightness: number;
  /** Unison courses (piano triples, tar/sitar doubled strings). */
  strings: 1 | 2;
  /** Cents between courses — the shimmer of doubled strings. */
  courseDetune: number;
  /** Pluck point as a fraction of the string — combs the series. */
  pluckPosition: number;
  /** Jawari-style bridge buzz 0..1 (the sitar's voice). */
  buzz: number;
  /** Hammer/soundboard thump 0..1. */
  thump: number;
  /** Pick/nail click 0..1. */
  pick: number;
  /** Body resonances. */
  formants: Formant[];
  gain: number;
};

export type WindModel = {
  model: "wind";
  attack: number;
  release: number;
  /** Cutoff = fundamental × (brightBase + envelope × brightEnv). */
  brightBase: number;
  brightEnv: number;
  /** Bore/body resonances — fixed while pitch moves under them. */
  formants: Formant[];
  breath: number;
  breathHz: number;
  /** Onset pitch ratio: brass rises from below (<1), a bow settles (>1). */
  onsetBend: number;
  onsetMs: number;
  /** Onset noise — bow scratch, reed chiff, lip noise. */
  chiff: number;
  vibratoHz: number;
  vibratoCents: number;
  /** Players start straight, then let the vibrato in. */
  vibratoDelayMs: number;
  gain: number;
};

export type TimbreSpec = { key: string; label: string } & (StringModel | WindModel);

export const TIMBRE_CHAIN: TimbreSpec[] = [
  {
    key: "harp",
    label: "harp",
    model: "string",
    feedback: 0.9985,
    loopCutoff: 5,
    burstBrightness: 1800,
    strings: 1,
    courseDetune: 0,
    pluckPosition: 0.5,
    buzz: 0,
    thump: 0.06,
    pick: 0,
    formants: [{ freq: 300, q: 1.2, gain: 4 }],
    gain: 1,
  },
  {
    key: "piano",
    label: "piano",
    model: "string",
    feedback: 0.997,
    loopCutoff: 7,
    burstBrightness: 3200,
    strings: 2,
    courseDetune: 1.6,
    pluckPosition: 0.115,
    buzz: 0,
    thump: 0.55,
    pick: 0.12,
    formants: [{ freq: 180, q: 1, gain: 3 }],
    gain: 0.95,
  },
  {
    key: "guitar",
    label: "guitar",
    model: "string",
    feedback: 0.995,
    loopCutoff: 5.5,
    burstBrightness: 4500,
    strings: 1,
    courseDetune: 0,
    pluckPosition: 0.13,
    buzz: 0,
    thump: 0.08,
    pick: 0.5,
    formants: [
      { freq: 110, q: 2, gain: 5 },
      { freq: 225, q: 2, gain: 3 },
    ],
    gain: 1,
  },
  {
    key: "tar",
    label: "tar",
    model: "string",
    feedback: 0.991,
    loopCutoff: 7,
    burstBrightness: 5200,
    strings: 2,
    courseDetune: 9,
    pluckPosition: 0.09,
    buzz: 0.12,
    thump: 0.05,
    pick: 0.6,
    formants: [{ freq: 340, q: 2.5, gain: 5 }],
    gain: 0.95,
  },
  {
    key: "sitar",
    label: "sitar",
    model: "string",
    feedback: 0.997,
    loopCutoff: 11,
    burstBrightness: 5200,
    strings: 2,
    courseDetune: 3,
    pluckPosition: 0.06,
    buzz: 0.6,
    thump: 0,
    pick: 0.35,
    formants: [
      { freq: 240, q: 1.5, gain: 4 },
      { freq: 3400, q: 4, gain: 6 },
    ],
    gain: 0.8,
  },
  {
    key: "violin",
    label: "violin",
    model: "wind",
    attack: 0.09,
    release: 0.3,
    brightBase: 3,
    brightEnv: 6,
    formants: [
      { freq: 300, q: 2, gain: 6 },
      { freq: 950, q: 1.5, gain: 4 },
      { freq: 2800, q: 3, gain: 5 },
    ],
    breath: 0.06,
    breathHz: 2800,
    onsetBend: 1.012,
    onsetMs: 70,
    chiff: 0.35,
    vibratoHz: 5.5,
    vibratoCents: 16,
    vibratoDelayMs: 350,
    gain: 0.8,
  },
  {
    key: "saxophone",
    label: "saxophone",
    model: "wind",
    attack: 0.05,
    release: 0.25,
    brightBase: 3.5,
    brightEnv: 7,
    formants: [
      { freq: 500, q: 1.2, gain: 4 },
      { freq: 1100, q: 1.5, gain: 7 },
    ],
    breath: 0.16,
    breathHz: 1900,
    onsetBend: 0.99,
    onsetMs: 45,
    chiff: 0.4,
    vibratoHz: 5,
    vibratoCents: 9,
    vibratoDelayMs: 450,
    gain: 0.85,
  },
  {
    key: "trumpet",
    label: "trumpet",
    model: "wind",
    attack: 0.04,
    release: 0.2,
    brightBase: 2.5,
    brightEnv: 12,
    formants: [
      { freq: 700, q: 1.5, gain: 3 },
      { freq: 1200, q: 2, gain: 8 },
      { freq: 2500, q: 3, gain: 4 },
    ],
    breath: 0.05,
    breathHz: 3000,
    onsetBend: 0.972,
    onsetMs: 55,
    chiff: 0.2,
    vibratoHz: 5,
    vibratoCents: 5,
    vibratoDelayMs: 500,
    gain: 0.8,
  },
];

export type TimbreBlend = {
  key: string;
  label: string;
  lower: TimbreSpec;
  upper: TimbreSpec;
  mix: number;
};

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

/**
 * Equal-power crossfade weights between the two physical models. Morphing
 * plays both instruments at once and leans between them — total energy
 * stays flat across the whole walk.
 */
export function crossfadeGains(mix: number) {
  const clamped = Math.max(0, Math.min(1, mix));
  return {
    lower: Math.cos((clamped * Math.PI) / 2),
    upper: Math.sin((clamped * Math.PI) / 2),
  };
}

// The whole point: any position along the chain is itself an instrument —
// two real physical models sounding together in proportion.
export function timbreAt(position: number): TimbreBlend {
  const { lower, upper, mix } = timbreNeighbors(position);
  return {
    key: `${lower.key}~${upper.key}`,
    label: blendLabel(lower, upper, mix),
    lower,
    upper,
    mix,
  };
}
