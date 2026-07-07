export const SPEED_OF_LIGHT = 299_792_458;
export const MIN_WAVELENGTH = 380;
export const MAX_WAVELENGTH = 700;
export const BASE_OCTAVE_DROP = 40;

export const SPECTRAL_STOPS = [
  { nm: 700, color: "#d83a2e", name: "red" },
  { nm: 610, color: "#f08a28", name: "orange" },
  { nm: 575, color: "#f5d65b", name: "gold" },
  { nm: 530, color: "#4fca75", name: "green" },
  { nm: 485, color: "#45b8e8", name: "cyan" },
  { nm: 450, color: "#5574f7", name: "blue" },
  { nm: 405, color: "#9a63ee", name: "violet" },
] as const;

export const OCTAVE_SHIFTS = [-3, -2, -1, 0, 1, 2, 3] as const;

export type OctaveShift = (typeof OCTAVE_SHIFTS)[number];

export type LightTranslation = {
  frequency: number;
  wavelength: number;
  rawWavelength: number;
  optical: number;
  color: string;
  octaveShift: OctaveShift;
  bridgeDivisor: number;
  cents: number;
  exact: boolean;
};

export type ParsedMusicToken =
  | ({
      kind: "note";
      raw: string;
      normalized: string;
      midi: number;
      octave: number;
      duration: number;
    } & LightTranslation)
  | {
      kind: "rest";
      raw: string;
      normalized: "rest";
      duration: number;
    }
  | {
      kind: "invalid";
      raw: string;
      normalized: string;
      duration: number;
      reason: string;
    };

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
const NOTE_OFFSETS: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
  "B#": 0,
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function wavelengthFromX(x: number) {
  return Math.round(MAX_WAVELENGTH - x * (MAX_WAVELENGTH - MIN_WAVELENGTH));
}

export function colorFromWavelength(nm: number) {
  const stops = [...SPECTRAL_STOPS].sort((a, b) => a.nm - b.nm);
  const upperIndex = stops.findIndex((stop) => nm <= stop.nm);
  const safeUpperIndex = upperIndex === -1 ? stops.length - 1 : upperIndex;
  const upper = stops[Math.max(0, safeUpperIndex)];
  const lower = stops[Math.max(0, safeUpperIndex - 1)] ?? upper;
  if (!upper || !lower || upper.nm === lower.nm) return upper?.color ?? "#f4d778";

  const mix = (nm - lower.nm) / (upper.nm - lower.nm);
  const from = hexToRgb(lower.color);
  const to = hexToRgb(upper.color);
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * mix));

  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function opticalFrequencyThz(nm: number) {
  return SPEED_OF_LIGHT / (nm * 1e-9) / 1e12;
}

export function audibleFrequency(nm: number, octaveShift: OctaveShift) {
  const opticalHz = SPEED_OF_LIGHT / (nm * 1e-9);
  return opticalHz / 2 ** (BASE_OCTAVE_DROP - octaveShift);
}

export function noteName(freq: number) {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function formatHz(freq: number) {
  return `${freq.toFixed(freq >= 100 ? 1 : 2)} Hz`;
}

export function frequencyFromMidi(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function translateFrequencyToLight(frequency: number): LightTranslation {
  const candidates = OCTAVE_SHIFTS.map((octaveShift) => {
    const bridgeDivisor = BASE_OCTAVE_DROP - octaveShift;
    const rawWavelength = SPEED_OF_LIGHT / (frequency * 2 ** bridgeDivisor) * 1e9;
    const wavelength = clamp(rawWavelength, MIN_WAVELENGTH, MAX_WAVELENGTH);
    const translatedFrequency = audibleFrequency(wavelength, octaveShift);
    const cents = 1200 * Math.log2(translatedFrequency / frequency);
    const exact = rawWavelength >= MIN_WAVELENGTH && rawWavelength <= MAX_WAVELENGTH;

    return {
      frequency,
      wavelength,
      rawWavelength,
      optical: opticalFrequencyThz(wavelength),
      color: colorFromWavelength(wavelength),
      octaveShift,
      bridgeDivisor,
      cents,
      exact,
    };
  });

  return candidates.sort((a, b) => {
    const byPitchError = Math.abs(a.cents) - Math.abs(b.cents);
    if (byPitchError !== 0) return byPitchError;
    return Math.abs(a.octaveShift) - Math.abs(b.octaveShift);
  })[0];
}

export function parseMusicScore(input: string): ParsedMusicToken[] {
  return scoreTokens(input).map(parseMusicToken);
}

function parseMusicToken(raw: string): ParsedMusicToken {
  const { token, duration } = splitDuration(raw);
  const normalizedToken = normalizeAccidentals(token);

  if (/^(?:r|rest|-|\.)$/i.test(normalizedToken)) {
    return { kind: "rest", raw, normalized: "rest", duration };
  }

  const match = normalizedToken.match(/^([A-Ga-g])([#b]?)(-?\d+)?$/);
  if (!match) {
    return { kind: "invalid", raw, normalized: normalizedToken, duration, reason: "not a note" };
  }

  const letter = match[1].toUpperCase();
  const accidental = match[2] ?? "";
  const octave = match[3] == null ? 4 : Number(match[3]);
  const key = `${letter}${accidental}`;
  const semitone = NOTE_OFFSETS[key];

  if (semitone == null || !Number.isFinite(octave)) {
    return { kind: "invalid", raw, normalized: normalizedToken, duration, reason: "not a note" };
  }

  const octaveAdjustment = key === "Cb" ? -1 : key === "B#" ? 1 : 0;
  const midi = (octave + 1 + octaveAdjustment) * 12 + semitone;
  const frequency = frequencyFromMidi(midi);
  const translation = translateFrequencyToLight(frequency);

  return {
    kind: "note",
    raw,
    normalized: `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`,
    midi,
    octave: Math.floor(midi / 12) - 1,
    duration,
    ...translation,
  };
}

function splitDuration(raw: string) {
  const normalized = raw.trim();
  const match = normalized.match(/^(.*?)(?::|\/|x|\*)(\d+(?:\.\d+)?)$/i);
  if (!match) return { token: normalized, duration: 1 };

  return {
    token: match[1],
    duration: clamp(Number(match[2]) || 1, 0.125, 8),
  };
}

function scoreTokens(input: string) {
  return input
    .replace(/[\[\](){}|]/g, " ")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeAccidentals(token: string) {
  return token.replace(/\u266f/g, "#").replace(/\u266d/g, "b");
}

function hexToRgb(hex: string) {
  return hex.match(/\w\w/g)?.map((part) => parseInt(part, 16)) ?? [244, 215, 120];
}
