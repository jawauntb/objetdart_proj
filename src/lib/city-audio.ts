/**
 * /city — the audio grammar of a settlement.
 *
 * A city is a cycle of care; its sound must let the ear hear that cycle.
 * v1 called `playNote(52)` for a plant, `playNote(56)` for a role climb, and
 * `playNote(60 + …)` for a flick — muddy, no musical identity, no way the
 * ear learned the room. This file is the counterpart to `src/lib/city.ts`:
 * the pure, testable **audio grammar**, pinned by `test-city-audio.mjs`
 * against the same causal roles the causal laws already speak.
 *
 * The settlement sits in **D mixolydian** — a folk mode with a warm hearth
 * (major third) and a soft ceiling (flat seventh), used the world over
 * where "town" is the topic: sea shanties, market bells, hearth hymns. It
 * has enough tension to feel worked-in and enough consonance to feel
 * inhabited.
 *
 * Each causal role owns a diatonic pitch, chosen so the civic ladder
 * home → store → event → tree the eye sees also **climbs** in the ear as
 * the mixolydian I – IV – v – ♭VII progression:
 *
 *   home  → D (I)    — tonic; a home is where the mode rests
 *   store → G (IV)   — subdominant; commerce is the day's work
 *   event → A (v)    — dominant minor; gathering is the pull
 *   tree  → C (♭VII) — the flat seventh; the tree crowns the town
 *
 * A ceremony seals a plot as a diatonic triad rooted at that role, so a
 * sealed home tolls D major, a sealed store tolls G major, a sealed event
 * tolls A minor, a sealed tree tolls C major — every seal is the same
 * chord *shape* at a different *pitch*, and the ear reads the pitch as
 * "which room in the settlement rings".
 *
 * Tutti is `bellChord(events)`: the more events the settlement holds, the
 * more voices in the tutti chord — a count the ear can hear.
 *
 * Wind and rain ride a single noise layer through a lowpass, and
 * `windNoiseTarget` returns the cutoff / gain / detune. Rain closes the
 * filter (a wet, hushed hiss), wind opens and bends it (an airborne lean).
 *
 * Nothing here touches the AudioContext. The consumer (`City.tsx`) reads
 * these numbers and hands them to the shared FieldAudio graph. That
 * separation is what makes the whole grammar testable in plain node.
 */

import type { PlotRole, Season } from "@/lib/city";

// ——— types ———————————————————————————————————————————————————————————————

/**
 * The four causal roles that answer a settlement's needs. Same set as
 * `PlotRole` minus "empty" — empty plots do not sing.
 */
export type CityRole = Exclude<PlotRole, "empty">;

export type WindNoiseTarget = {
  /** Lowpass corner over the noise layer, Hz. */
  cutoffHz: number;
  /** Linear gain on the noise layer, 0..1. */
  gain: number;
  /** Pitch bend on the noise layer, cents. Signed with wind direction. */
  detuneCents: number;
};

// ——— the mode ——————————————————————————————————————————————————————————————

/**
 * D above middle C. Warm without being heavy — a settlement's low voice
 * sits here comfortably, and its high voice fits within one octave.
 */
export const CITY_TONIC_MIDI = 62;

/**
 * D mixolydian, one octave. Offsets in semitones from `CITY_TONIC_MIDI`:
 * D E F# G A B C (D). The mode's "hearth + horizon" quality — the
 * settlement's tuning centre.
 */
export const CITY_MODE: readonly number[] = [0, 2, 4, 5, 7, 9, 10];

/**
 * True if `midi` is a member of D mixolydian at any octave. Tests use this
 * to catch a rewiring that lands a note off the mode — the room must sound
 * like one instrument tuned to itself.
 */
export function inMode(midi: number): boolean {
  const rel = ((midi - CITY_TONIC_MIDI) % 12 + 12) % 12;
  return CITY_MODE.includes(rel);
}

// ——— role → note ——————————————————————————————————————————————————————————

/**
 * The **civic ladder** in semitones above `CITY_TONIC_MIDI`. Home → store →
 * event → tree climbs D → G → A → C — the mixolydian I – IV – v – ♭VII
 * pillars. The eye sees the plot climb (`roleForDwell` in `city.ts`); the
 * ear hears the ladder climb with it.
 */
const ROLE_SEMITONES: Readonly<Record<CityRole, number>> = {
  home:  0,   // D  (I)     — rest, shelter
  store: 5,   // G  (IV)    — food, exchange
  event: 7,   // A  (v)     — gather, the pull
  tree:  10,  // C  (♭VII)  — weather, the breath crowning the town
};

/**
 * Base MIDI for a role. Deterministic — same role always returns the same
 * pitch — so a home always sounds like home and a store like store. Every
 * value sits inside D mixolydian by construction.
 */
export function noteForRole(role: CityRole): number {
  return CITY_TONIC_MIDI + ROLE_SEMITONES[role];
}

/**
 * A plot's **identity note**. A row of homes shouldn't play unison — the
 * ear must be able to count the settlement's homes when they ring at once
 * — so each plot's seed bins into one of three octave slots: −12, 0, +12
 * semitones off the role base. Small enough to stay in tune with the mode,
 * wide enough that a cluster of homes sounds like a chord.
 *
 * Deterministic in the seed: identical inputs return identical outputs,
 * which is what the ceremony sound and the tutti sound both rely on.
 */
export function noteForPlot(plot: { role: CityRole; seed: number }): number {
  const bucket = (((plot.seed | 0) % 3) + 3) % 3; // 0..2
  const octaveOffset = [0, -12, 12][bucket];
  return noteForRole(plot.role) + octaveOffset;
}

/**
 * The note that plays when the dwell ring crosses into a new role — the
 * **ladder-climb** sound. One octave above the role's identity note so the
 * ear reads it as "the plot rose", not as another plot ringing.
 */
export function dwellClimbNote(role: CityRole): number {
  return noteForRole(role) + 12;
}

// ——— ceremony triad ——————————————————————————————————————————————————————

/**
 * Diatonic triad rooted at a role, staying inside D mixolydian at every
 * voice — the sealing chord. Chords chosen so the four seals cover the
 * mode's characteristic colour palette:
 *
 *   home  → D  F# A  (I,  major)
 *   store → G  B  D  (IV, major)
 *   event → A  C  E  (v,  minor)
 *   tree  → C  E  G  (♭VII, major)
 *
 * A sealed home tolls the tonic triad; a sealed event tolls the classic
 * folk-cadence minor v; a sealed tree tolls the flat seventh. Every triad
 * is three notes.
 */
const CEREMONY_INTERVALS: Readonly<Record<CityRole, readonly [number, number, number]>> = {
  home:  [0, 4, 7],   // D  F# A — major
  store: [0, 4, 7],   // G  B  D — major
  event: [0, 3, 7],   // A  C  E — minor
  tree:  [0, 4, 7],   // C  E  G — major
};

export function chordForCeremony(role: CityRole): number[] {
  const base = noteForRole(role);
  return CEREMONY_INTERVALS[role].map((iv) => base + iv);
}

// ——— tutti chord ——————————————————————————————————————————————————————————

/**
 * The tutti — three-finger tap, or the vessel's knock. The town's own
 * tonic plus one voice for each event currently in the settlement. A city
 * with no events rings its own root, a city with three rings the full
 * I – v – ♭VII stack, a city with more piles on octave doublings above.
 *
 * The count is audible: more events → fuller chord. That is the whole
 * point of tutti — the settlement's population reports itself.
 *
 * `eventCount` is clamped at zero (negative counts are treated as none)
 * and above four the growth is bounded so the chord doesn't turn into
 * noise; there are only so many voices a settlement can ring at once.
 */
export function bellChord(eventCount: number): number[] {
  const n = Math.max(0, Math.floor(eventCount));
  const home = noteForRole("home");
  if (n === 0) return [home];
  const voices: number[] = [home, noteForRole("event")];
  if (n >= 2) voices.push(noteForRole("tree"));
  if (n >= 3) voices.push(noteForRole("store"));
  // Every event beyond three adds an octave-doubled A above the top
  // voice. Bounded so a settlement of 50 events doesn't ring 53 notes.
  const extras = Math.min(4, n - 3);
  for (let i = 0; i < extras; i += 1) {
    voices.push(noteForRole("event") + 12 * (i + 1));
  }
  return voices;
}

// ——— season detent ————————————————————————————————————————————————————————

/**
 * Three-finger twist walks the year. Each season lands on a **different
 * scale degree** of the city's mode, so the year audibly rounds through
 * the mode from bud to hearth:
 *
 *   spring → E (deg 1, supertonic)   — the shoot
 *   summer → A (deg 4, fifth)        — the fruit
 *   fall   → C (deg 6, flat seventh) — the harvest breath
 *   winter → D (deg 0, tonic)        — the hearth
 *
 * The four seasons cover four different mode degrees, no repeats.
 */
const SEASON_DEGREE: Readonly<Record<Season, number>> = {
  spring: 1,
  summer: 4,
  fall:   6,
  winter: 0,
};

export function noteForSeason(season: Season): number {
  return CITY_TONIC_MIDI + CITY_MODE[SEASON_DEGREE[season]];
}

// ——— flick chime ——————————————————————————————————————————————————————————

/**
 * A one-finger flick rings a chime; the flick's angle picks the chime's
 * pitch. Ringing one octave above the tonic so a chime sits above the
 * settlement's voices — brighter than a role note, unmistakable in the
 * mix. Every pitch lands inside the mode.
 */
export function noteForFlickAngle(angle: number): number {
  // Map angle → 0..CITY_MODE.length via a stable modular reduction. Any
  // finite angle is legal; a very negative or very positive angle wraps
  // to the same set of pitches.
  const twoPi = Math.PI * 2;
  const norm = ((angle % twoPi) + twoPi) % twoPi;
  const idx = Math.min(CITY_MODE.length - 1, Math.floor((norm / twoPi) * CITY_MODE.length));
  return CITY_TONIC_MIDI + 12 + CITY_MODE[idx];
}

// ——— weather noise ————————————————————————————————————————————————————————

/**
 * Rain and wind drive a single lowpass over the ambient noise bed:
 *
 *   - Rain closes the cutoff — a downpour hisses through a small window,
 *     dry air through a wide one.
 *   - Wind opens the gain and bends the pitch (a signed lean the ear
 *     reads as air pressure).
 *
 * Inputs are clamped: `rain` to 0..1, `wind` to −1..1. The function is
 * pure — same inputs always give the same target, no side effects — so
 * `City.tsx` can call it every frame and the tests can pin it in node.
 */
export function windNoiseTarget(rain: number, wind: number): WindNoiseTarget {
  const r = Math.max(0, Math.min(1, Number.isFinite(rain) ? rain : 0));
  const w = Math.max(-1, Math.min(1, Number.isFinite(wind) ? wind : 0));
  // 8 kHz open air → 900 Hz downpour. Monotone in rain, so a wetter city
  // is audibly muffled compared to a drier one.
  const cutoffHz = 8000 - r * 7100;
  // Rain is the primary voice of the noise; wind adds a rustle even when
  // dry. A perfectly still, dry city is silent on this bus.
  const gain = Math.min(1, r * 0.6 + Math.abs(w) * 0.25);
  // Wind bends the noise pitch — up to a major third either side.
  const detuneCents = w * 400;
  return { cutoffHz, gain, detuneCents };
}
