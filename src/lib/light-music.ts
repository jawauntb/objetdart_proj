export const SPEED_OF_LIGHT = 299_792_458;

// Both human ranges, edge to edge. The whole audible band (≈E0 up to the
// hearing ceiling) stretches across the whole visible band, so every pitch
// owns one color, every color owns one pitch, and the map runs both ways
// without loss: 20 Hz ↔ 750 nm deep red, 20 kHz ↔ 380 nm deep violet,
// exponential (log↔log) in between so equal musical intervals cover equal
// spectral ground.
export const MIN_WAVELENGTH = 380;
export const MAX_WAVELENGTH = 750;
export const AUDIBLE_MIN_HZ = 20;
export const AUDIBLE_MAX_HZ = 20_000;

const AUDIBLE_SPAN = Math.log(AUDIBLE_MAX_HZ / AUDIBLE_MIN_HZ);
const VISIBLE_SPAN = Math.log(MAX_WAVELENGTH / MIN_WAVELENGTH);

export const SPECTRAL_STOPS = [
  { nm: 750, color: "#8e2318", name: "deep red" },
  { nm: 700, color: "#d83a2e", name: "red" },
  { nm: 610, color: "#f08a28", name: "orange" },
  { nm: 575, color: "#f5d65b", name: "gold" },
  { nm: 530, color: "#4fca75", name: "green" },
  { nm: 485, color: "#45b8e8", name: "cyan" },
  { nm: 450, color: "#5574f7", name: "blue" },
  { nm: 405, color: "#9a63ee", name: "violet" },
  { nm: 380, color: "#7a43d8", name: "deep violet" },
] as const;

export type LightTranslation = {
  frequency: number;
  wavelength: number;
  rawWavelength: number;
  optical: number;
  color: string;
  cents: number;
  exact: boolean;
};

export type ParsedMusicTone = {
  raw: string;
  normalized: string;
  midi: number;
  octave: number;
} & LightTranslation;

export type ParsedMusicToken =
  | ({
      kind: "note";
      duration: number;
    } & ParsedMusicTone)
  | ({
      kind: "chord";
      duration: number;
      notes: ParsedMusicTone[];
    } & Omit<ParsedMusicTone, "midi" | "octave">)
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

export type ParsedMusicMetadata = {
  tempo?: number;
  timeSignature?: [number, number];
  key?: string;
  title?: string;
  unit?: number;
};

export type ParsedMusicInput = {
  tokens: ParsedMusicToken[];
  metadata: ParsedMusicMetadata;
  warnings: string[];
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

// 0..1 across the instrument → wavelength, log-spaced so equal distance is
// equal musical interval: x = 0 is 750 nm deep red (20 Hz), x = 1 is 380 nm
// deep violet (20 kHz).
export function wavelengthFromX(x: number) {
  return MAX_WAVELENGTH * Math.exp(-clamp(x, 0, 1) * VISIBLE_SPAN);
}

export function xFromWavelength(nm: number) {
  return Math.log(MAX_WAVELENGTH / clamp(nm, MIN_WAVELENGTH, MAX_WAVELENGTH)) / VISIBLE_SPAN;
}

// Stops sorted once (ascending by wavelength) instead of on every call — the
// source list is a static const, so the sort order never changes at runtime.
const SORTED_SPECTRAL_STOPS = [...SPECTRAL_STOPS].sort((a, b) => a.nm - b.nm);
// Each stop's RGB parsed once up front so the hot color-lookup path (driven
// from pointer/gesture handlers) never re-parses hex strings per call.
const SORTED_SPECTRAL_STOP_RGB = SORTED_SPECTRAL_STOPS.map((stop) => hexToRgb(stop.color));

export function colorFromWavelength(nm: number) {
  const stops = SORTED_SPECTRAL_STOPS;
  const upperIndex = stops.findIndex((stop) => nm <= stop.nm);
  const safeUpperIndex = upperIndex === -1 ? stops.length - 1 : upperIndex;
  const upperPos = Math.max(0, safeUpperIndex);
  const lowerPos = Math.max(0, safeUpperIndex - 1);
  const upper = stops[upperPos];
  const lower = stops[lowerPos] ?? upper;
  if (!upper || !lower || upper.nm === lower.nm) return upper?.color ?? "#f4d778";

  const mix = (nm - lower.nm) / (upper.nm - lower.nm);
  const from = SORTED_SPECTRAL_STOP_RGB[lowerPos];
  const to = SORTED_SPECTRAL_STOP_RGB[upperPos];
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * mix));

  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function opticalFrequencyThz(nm: number) {
  return SPEED_OF_LIGHT / (nm * 1e-9) / 1e12;
}

// Exact inverse of translateFrequencyToLight for in-range wavelengths, so
// playing a color back gives the pitch that made it. octaveShift transposes
// the result for performance registers without moving the underlying map.
export function audibleFrequency(nm: number, octaveShift = 0) {
  return AUDIBLE_MIN_HZ * Math.exp(xFromWavelength(nm) * AUDIBLE_SPAN) * 2 ** octaveShift;
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

// Playing-scale modes for the light instrument. "pure" keeps the raw
// light-derived frequency; "chroma" snaps to 12-TET; "penta" snaps to
// A minor pentatonic (A C D E G) so multi-touch chords always agree.
export type ScaleMode = "penta" | "chroma" | "pure";

export const SCALE_MODES: ScaleMode[] = ["penta", "chroma", "pure"];

const PENTA_PITCH_CLASSES = new Set([9, 0, 2, 4, 7]); // A C D E G

export function quantizeFrequency(freq: number, mode: ScaleMode): number {
  if (mode === "pure" || !Number.isFinite(freq) || freq <= 0) return freq;
  const midi = 69 + 12 * Math.log2(freq / 440);
  if (mode === "chroma") return frequencyFromMidi(Math.round(midi));

  let best = Math.round(midi);
  let bestDistance = Infinity;
  for (let candidate = Math.floor(midi) - 3; candidate <= Math.ceil(midi) + 3; candidate++) {
    if (!PENTA_PITCH_CLASSES.has(((candidate % 12) + 12) % 12)) continue;
    const distance = Math.abs(candidate - midi);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return frequencyFromMidi(best);
}

export function translateFrequencyToLight(frequency: number): LightTranslation {
  const position = Math.log(frequency / AUDIBLE_MIN_HZ) / AUDIBLE_SPAN;
  const rawWavelength = MAX_WAVELENGTH * Math.exp(-position * VISIBLE_SPAN);
  const wavelength = clamp(rawWavelength, MIN_WAVELENGTH, MAX_WAVELENGTH);
  const cents = 1200 * Math.log2(audibleFrequency(wavelength) / frequency);
  const exact = frequency >= AUDIBLE_MIN_HZ && frequency <= AUDIBLE_MAX_HZ;

  return {
    frequency,
    wavelength,
    rawWavelength,
    optical: opticalFrequencyThz(wavelength),
    color: colorFromWavelength(wavelength),
    cents,
    exact,
  };
}

export function parseMusicScore(input: string): ParsedMusicToken[] {
  return parseMusicInput(input).tokens;
}

export function parseMusicInput(input: string): ParsedMusicInput {
  const metadata: ParsedMusicMetadata = {};
  const warnings: string[] = [];
  const scoreLines: string[] = [];

  input.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (readMetadataLine(trimmed, metadata)) return;
    scoreLines.push(trimmed);
  });

  return {
    tokens: scoreTokens(scoreLines.join(" ")).map(parseMusicToken),
    metadata,
    warnings,
  };
}

export function tonesForMusicToken(token: ParsedMusicToken): ParsedMusicTone[] {
  if (token.kind === "note") return [token];
  if (token.kind === "chord") return token.notes;
  return [];
}

function parseMusicToken(raw: string): ParsedMusicToken {
  const { token, duration } = splitDuration(raw);
  const normalizedToken = normalizeAccidentals(token);

  if (/^(?:r|rest|-|\.)$/i.test(normalizedToken)) {
    return { kind: "rest", raw, normalized: "rest", duration };
  }

  const chordMatch = normalizedToken.match(/^\[(.*)\]$/);
  if (chordMatch) {
    const pieces = chordMatch[1]
      .split(/[\s,+]+/)
      .map((piece) => piece.trim())
      .filter(Boolean);
    const notes = pieces.map(parseMusicTone);
    const invalidIndex = notes.findIndex((note) => note == null);

    if (pieces.length === 0 || invalidIndex !== -1) {
      return {
        kind: "invalid",
        raw,
        normalized: normalizedToken,
        duration,
        reason: pieces[invalidIndex] ? `bad chord note ${pieces[invalidIndex]}` : "empty chord",
      };
    }

    const chordNotes = notes as ParsedMusicTone[];
    const wavelength = average(chordNotes.map((note) => note.wavelength));
    const rawWavelength = average(chordNotes.map((note) => note.rawWavelength));
    const optical = average(chordNotes.map((note) => note.optical));
    const cents = chordNotes.reduce((max, note) => Math.max(max, Math.abs(note.cents)), 0);

    return {
      kind: "chord",
      raw,
      normalized: `[${chordNotes.map((note) => note.normalized).join(" ")}]`,
      duration,
      notes: chordNotes,
      frequency: average(chordNotes.map((note) => note.frequency)),
      wavelength,
      rawWavelength,
      optical,
      color: colorFromWavelength(wavelength),
      cents,
      exact: chordNotes.every((note) => note.exact),
    };
  }

  const tone = parseMusicTone(normalizedToken);
  if (!tone) {
    return { kind: "invalid", raw, normalized: normalizedToken, duration, reason: "not a note" };
  }

  return {
    kind: "note",
    duration,
    ...tone,
    raw,
  };
}

function parseMusicTone(raw: string): ParsedMusicTone | null {
  const normalizedToken = normalizeAccidentals(raw);
  const match = normalizedToken.match(/^([A-Ga-g])([#b]?)(-?\d+)?$/);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidental = match[2] ?? "";
  const octave = match[3] == null ? 4 : Number(match[3]);
  const key = `${letter}${accidental}`;
  const semitone = NOTE_OFFSETS[key];

  if (semitone == null || !Number.isFinite(octave)) {
    return null;
  }

  const octaveAdjustment = key === "Cb" ? -1 : key === "B#" ? 1 : 0;
  const midi = (octave + 1 + octaveAdjustment) * 12 + semitone;
  const frequency = frequencyFromMidi(midi);
  const translation = translateFrequencyToLight(frequency);

  return {
    raw,
    normalized: `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`,
    midi,
    octave: Math.floor(midi / 12) - 1,
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
  const tokens: string[] = [];
  let current = "";
  let inChord = false;

  const push = () => {
    const token = current.trim();
    if (token) tokens.push(token);
    current = "";
  };

  for (const char of input) {
    if (char === "[") {
      push();
      inChord = true;
      current += char;
      continue;
    }

    if (char === "]") {
      inChord = false;
      current += char;
      continue;
    }

    if (!inChord && /[\s,;|(){}]/.test(char)) {
      push();
      continue;
    }

    current += char;
  }

  push();
  return tokens;
}

function normalizeAccidentals(token: string) {
  return token.replace(/\u266f/g, "#").replace(/\u266d/g, "b");
}

function readMetadataLine(line: string, metadata: ParsedMusicMetadata) {
  if (readAbcMetadataLine(line, metadata)) return true;

  const assignments = [...line.matchAll(/\b(tempo|bpm|time|meter|key|title|unit|length)\s*=\s*("[^"]+"|'[^']+'|[^\s]+)/gi)];
  if (assignments.length === 0) return false;

  const covered = assignments
    .map((match) => match[0])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (covered.length !== line.replace(/\s+/g, " ").trim().length) return false;

  assignments.forEach((match) => applyMetadataValue(match[1], unquote(match[2]), metadata));
  return true;
}

function readAbcMetadataLine(line: string, metadata: ParsedMusicMetadata) {
  const match = line.match(/^([TMQKL]):\s*(.+)$/i);
  if (!match) return false;

  const key = match[1].toUpperCase();
  const value = match[2].trim();

  if (key === "T") metadata.title = value;
  if (key === "M") applyMetadataValue("time", value, metadata);
  if (key === "Q") {
    const tempo = value.match(/(\d+(?:\.\d+)?)\s*$/);
    if (tempo) applyMetadataValue("tempo", tempo[1], metadata);
  }
  if (key === "K") metadata.key = value;
  if (key === "L") applyMetadataValue("unit", value, metadata);
  return true;
}

function applyMetadataValue(key: string, value: string, metadata: ParsedMusicMetadata) {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "tempo" || normalizedKey === "bpm") {
    const tempo = Number(value);
    if (Number.isFinite(tempo) && tempo > 0) metadata.tempo = clamp(tempo, 20, 320);
    return;
  }

  if (normalizedKey === "time" || normalizedKey === "meter") {
    const signature = parseRatio(value);
    if (signature) metadata.timeSignature = signature;
    return;
  }

  if (normalizedKey === "key") {
    metadata.key = value;
    return;
  }

  if (normalizedKey === "title") {
    metadata.title = value;
    return;
  }

  if (normalizedKey === "unit" || normalizedKey === "length") {
    const unit = parseDurationValue(value);
    if (unit) metadata.unit = unit;
  }
}

function parseRatio(value: string): [number, number] | null {
  const match = value.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (!match) return null;

  const top = Number(match[1]);
  const bottom = Number(match[2]);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0) return null;
  return [top, bottom];
}

function parseDurationValue(value: string) {
  const ratio = parseRatio(value);
  if (ratio) return ratio[0] / ratio[1];

  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function unquote(value: string) {
  return value.replace(/^["']|["']$/g, "");
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function hexToRgb(hex: string) {
  return hex.match(/\w\w/g)?.map((part) => parseInt(part, 16)) ?? [244, 215, 120];
}
