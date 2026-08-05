import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import vm from "node:vm";

// Compile src/lib/city-audio.ts in-process. Same pattern as test-city.mjs
// (its causal-laws sibling). The `@/lib/city` import is types-only, so we
// don't need to resolve it — TypeScript strips the import at compile time.
const rootUrl = new URL("../", import.meta.url);
const source = readFileSync(fileURLToPath(new URL("src/lib/city-audio.ts", rootUrl)), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    isolatedModules: true,
  },
  fileName: "src/lib/city-audio.ts",
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(
  code,
  { module: mod, exports: mod.exports, require: () => ({}), Math, Object, Array, Number },
  { filename: "src/lib/city-audio.ts" },
);
const {
  CITY_TONIC_MIDI,
  CITY_MODE,
  inMode,
  noteForRole,
  noteForPlot,
  dwellClimbNote,
  chordForCeremony,
  bellChord,
  noteForSeason,
  noteForFlickAngle,
  windNoiseTarget,
} = mod.exports;

const ROLES = ["home", "store", "event", "tree"];
const SEASONS = ["spring", "summer", "fall", "winter"];

// ——— the mode is closed and canonical ————————————————————————————————————

assert.equal(CITY_TONIC_MIDI, 62, "the settlement is tuned to D above middle C");
assert.equal(CITY_MODE.length, 7, "a mode has seven degrees in one octave");
assert.deepEqual([...CITY_MODE], [0, 2, 4, 5, 7, 9, 10], "D mixolydian: D E F# G A B C");
assert.ok(inMode(CITY_TONIC_MIDI), "the tonic is in mode");
assert.ok(inMode(CITY_TONIC_MIDI + 12), "an octave up is in mode");
assert.ok(inMode(CITY_TONIC_MIDI - 12), "an octave down is in mode");
assert.ok(!inMode(CITY_TONIC_MIDI + 1), "the minor second (D → D#) is out of mixolydian");
assert.ok(!inMode(CITY_TONIC_MIDI + 3), "the minor third (D → F) is out of mixolydian — the mode has a major third");
assert.ok(!inMode(CITY_TONIC_MIDI + 6), "the tritone (D → G#) is out of mixolydian");
assert.ok(!inMode(CITY_TONIC_MIDI + 11), "the major seventh (D → C#) is out — the mode's seventh is flat");

// ——— role → note: identity, distinctness, and climb ——————————————————————

// A home always sounds like a home — the whole point of the grammar.
for (const role of ROLES) {
  assert.equal(noteForRole(role), noteForRole(role), `${role} is deterministic`);
  assert.ok(inMode(noteForRole(role)), `${role}'s note lies inside the settlement's mode`);
}

// Four distinct roles → four distinct pitches.
const rolePitches = ROLES.map(noteForRole);
assert.equal(new Set(rolePitches).size, 4, "every role owns its own pitch — the ear can tell them apart");

// The civic ladder home → store → event → tree climbs monotonically. This is
// the ear-eye sync: the visual ladder in city.ts and the audio ladder here
// must move the same direction.
assert.ok(
  noteForRole("home") < noteForRole("store") &&
  noteForRole("store") < noteForRole("event") &&
  noteForRole("event") < noteForRole("tree"),
  "home < store < event < tree — the audio ladder climbs with the visual ladder",
);

// The specific chord: home is the tonic, tree is the flat seventh above.
assert.equal(noteForRole("home"), CITY_TONIC_MIDI, "the home is the mode's tonic");
assert.equal(noteForRole("tree") - noteForRole("home"), 10, "the tree sits a minor seventh above the home");

// ——— noteForPlot: same seed same note, seed spread within one octave ——————

for (const role of ROLES) {
  // Determinism across independent calls with the same input.
  const a = noteForPlot({ role, seed: 0xC17A });
  const b = noteForPlot({ role, seed: 0xC17A });
  assert.equal(a, b, `noteForPlot is deterministic for role=${role}`);

  // Every seed lands within +/- one octave of the role's identity note —
  // so a row of homes reads as a chord, not as a bass and a piccolo.
  for (let seed = -6; seed <= 6; seed += 1) {
    const note = noteForPlot({ role, seed });
    assert.ok(inMode(note), `noteForPlot for role=${role} seed=${seed} stays in mode`);
    const offset = note - noteForRole(role);
    assert.ok(Math.abs(offset) <= 12, `noteForPlot for role=${role} seed=${seed} sits within one octave of the role note`);
  }
}

// Different seeds should not all collapse to unison — the ear should be
// able to count multiple homes even when they ring at once.
const homePitches = new Set([0, 1, 2, 3, 4, 5].map((s) => noteForPlot({ role: "home", seed: s })));
assert.ok(homePitches.size >= 2, "different seeds spread homes across at least two pitches — a row of homes reads as a chord");

// ——— dwellClimbNote: an octave above the role note ————————————————————————

for (const role of ROLES) {
  const climb = dwellClimbNote(role);
  assert.equal(climb - noteForRole(role), 12, `dwellClimbNote(${role}) sits one octave above the role — the ear reads it as "the plot rose"`);
  assert.ok(inMode(climb), `dwellClimbNote(${role}) stays in mode`);
}

// ——— chordForCeremony: three-note diatonic triads ——————————————————————————

for (const role of ROLES) {
  const chord = chordForCeremony(role);
  assert.equal(chord.length, 3, `ceremony triad for ${role} has three voices`);
  assert.equal(chord[0], noteForRole(role), `ceremony triad for ${role} is rooted at the role's note`);
  for (const note of chord) {
    assert.ok(inMode(note), `every voice of ${role}'s ceremony chord lies inside the mode — the seal is consonant`);
  }
  // A triad's voices must be distinct: three notes, not one repeated.
  assert.equal(new Set(chord).size, 3, `ceremony triad for ${role} has three distinct notes`);
}

// The event chord is minor (v of mixolydian), a load-bearing character of
// the mode. A rewiring that made every ceremony major would silently kill
// the folk feel — this catches it.
const eventChord = chordForCeremony("event");
assert.equal(eventChord[1] - eventChord[0], 3, "event ceremony chord has a minor third — the folk-cadence v minor");
const homeChord = chordForCeremony("home");
assert.equal(homeChord[1] - homeChord[0], 4, "home ceremony chord has a major third — the tonic major");

// ——— bellChord: audible count ————————————————————————————————————————————

assert.deepEqual(bellChord(0), [noteForRole("home")], "no events → the town rings its own tonic alone");
assert.deepEqual(bellChord(-1), [noteForRole("home")], "negative event count is treated as none — a settlement can't have -1 events");
assert.deepEqual(bellChord(2.7), bellChord(2), "fractional event counts floor down — you either have two events or you don't");

// More events → more voices. This is the "count is audible" property.
for (let n = 0; n < 5; n += 1) {
  const c1 = bellChord(n).length;
  const c2 = bellChord(n + 1).length;
  assert.ok(c2 >= c1, `bellChord(${n + 1}).length >= bellChord(${n}).length — a settlement with more events rings at least as many voices`);
}
assert.ok(bellChord(5).length > bellChord(1).length, "a settlement with five events rings a wider chord than one with one event");

// The chord doesn't grow without bound — the tutti is a chord, not noise.
assert.ok(bellChord(1000).length <= 8, "even a settlement of 1000 events tolls at most eight voices — a chord, not noise");

// Every voice of every tutti chord stays in the mode.
for (let n = 0; n < 12; n += 1) {
  for (const note of bellChord(n)) {
    assert.ok(inMode(note), `bellChord(${n}) voice ${note} stays inside the mode`);
  }
}

// ——— season: four seasons on four different degrees ——————————————————————

const seasonNotes = SEASONS.map(noteForSeason);
assert.equal(new Set(seasonNotes).size, 4, "the four seasons ring four different pitches — the ear can tell one from the next");
for (const s of SEASONS) {
  assert.ok(inMode(noteForSeason(s)), `${s} lands inside the mode`);
}
assert.equal(noteForSeason("winter"), CITY_TONIC_MIDI, "winter is the tonic — the hearth of the year");

// ——— flick chime: angle → in-mode pitch, wrap-safe ———————————————————————

for (const angle of [-100, -1.5, 0, 0.7, 3.1, Math.PI, Math.PI * 2, 12.3]) {
  const note = noteForFlickAngle(angle);
  assert.ok(inMode(note), `flick at angle ${angle} lands in mode`);
  assert.ok(note >= CITY_TONIC_MIDI + 12 && note <= CITY_TONIC_MIDI + 12 + 10, `flick at angle ${angle} rings within the chime octave above the tonic`);
}
// An angle + 2π lands on the same pitch as the original angle — a full
// rotation of the wrist should return to the same chime, not accumulate.
assert.equal(noteForFlickAngle(0.4), noteForFlickAngle(0.4 + Math.PI * 2), "flick chime is 2π-periodic — a full wrist turn returns to the same pitch");

// ——— windNoiseTarget: rain closes, wind bends ————————————————————————————

// A dry, still city is silent on the weather bus.
const still = windNoiseTarget(0, 0);
assert.equal(still.gain, 0, "a still, dry city is silent on the noise bus");
assert.equal(still.detuneCents, 0, "no wind → no pitch bend");
assert.ok(still.cutoffHz >= 7000, "no rain → the filter is wide open");

// Rain monotonically closes the cutoff.
const dry = windNoiseTarget(0, 0);
const damp = windNoiseTarget(0.5, 0);
const soaked = windNoiseTarget(1, 0);
assert.ok(soaked.cutoffHz < damp.cutoffHz, "wet cities hiss through a smaller window than damp ones");
assert.ok(damp.cutoffHz < dry.cutoffHz, "damp cities hiss through a smaller window than dry ones");

// Wind bends pitch signed with direction; magnitude symmetric.
const west = windNoiseTarget(0, -1);
const east = windNoiseTarget(0, 1);
assert.equal(west.detuneCents, -east.detuneCents, "wind detune is antisymmetric — a westerly leans opposite an easterly");
assert.ok(east.gain > 0, "a windy dry day still rustles the noise bus");

// Out-of-range inputs are clamped — a downpour twice as heavy as the model
// still returns a bounded target.
const monsoon = windNoiseTarget(5, 5);
assert.ok(monsoon.cutoffHz >= 900 && monsoon.cutoffHz <= 8000, "cutoff stays inside the audible band even for out-of-range inputs");
assert.ok(monsoon.gain <= 1, "gain never exceeds unity — the bus cannot overdrive itself");

// NaN and non-finite inputs collapse to the still state (no crashes).
const nan = windNoiseTarget(Number.NaN, Number.NaN);
assert.equal(nan.gain, 0, "NaN inputs are treated as zero — the bus doesn't crash on bad numbers");
assert.equal(nan.detuneCents, 0, "NaN wind → no detune");

console.log(
  `city-audio ok: mode is closed D mixolydian, ${ROLES.length} roles ladder monotonically, ` +
  `ceremony triads all diatonic, bellChord count is audible, weather noise clamps.`,
);
