import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  // Current realm (not vm) so assert.deepEqual accepts the arrays it returns.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const { TIMBRE_CHAIN, blendLabel, crossfadeGains, timbreAt, timbreNeighbors } =
  loadTsModule("src/lib/timbre.ts");

const byKey = Object.fromEntries(TIMBRE_CHAIN.map((voice) => [voice.key, voice]));

// the chain holds the eight voices in a timbrally-ordered walk
assert.deepEqual(
  TIMBRE_CHAIN.map((voice) => voice.key),
  ["harp", "piano", "guitar", "tar", "sitar", "violin", "saxophone", "trumpet"],
  "the chain should walk from softest pluck to brightest blown voice",
);

// two physical models, split where the physics splits
for (const key of ["harp", "piano", "guitar", "tar", "sitar"]) {
  assert.equal(byKey[key].model, "string", `${key} should be a delay-line string`);
}
for (const key of ["violin", "saxophone", "trumpet"]) {
  assert.equal(byKey[key].model, "wind", `${key} should be a source+formant voice`);
}

// ── identity relations — the bugs these catch are "everything sounds alike" ──

// pluck point: sitar grazes the bridge, guitar picks near it, a harp is
// stroked toward mid-string. Flattening these collapses the string family
// into one generic pluck.
assert.ok(
  byKey.sitar.pluckPosition < byKey.tar.pluckPosition &&
  byKey.tar.pluckPosition < byKey.guitar.pluckPosition &&
  byKey.guitar.pluckPosition < byKey.harp.pluckPosition,
  "pluck points must walk from bridge-jangle (sitar) to mid-string round (harp)",
);

// the sitar's voice is its jawari buzz; nobody else may buzz like it
for (const voice of TIMBRE_CHAIN) {
  if (voice.key !== "sitar" && voice.model === "string") {
    assert.ok(byKey.sitar.buzz > voice.buzz * 2, `sitar buzz must dominate ${voice.key}`);
  }
}

// the piano is struck — its hammer thump must lead the family
for (const voice of TIMBRE_CHAIN) {
  if (voice.key !== "piano" && voice.model === "string") {
    assert.ok(byKey.piano.thump > voice.thump * 2, `piano thump must dominate ${voice.key}`);
  }
}

// ring and brightness must differ across the plucked family
assert.ok(byKey.tar.feedback < byKey.harp.feedback, "a tar rings shorter than a harp");
assert.ok(byKey.sitar.loopCutoff > byKey.guitar.loopCutoff, "a sitar rings brighter than a guitar");

// winds: brass brightness blooms with loudness harder than a bow's
assert.ok(byKey.trumpet.brightEnv > byKey.violin.brightEnv * 1.5, "trumpet brightness must bloom hardest");

// the saxophone breathes loudest of the winds
for (const key of ["violin", "trumpet"]) {
  assert.ok(byKey.saxophone.breath > byKey[key].breath * 2, `sax breath must dominate ${key}`);
}

// onset physics: brass rises into the note from below, a bow settles from above
assert.ok(byKey.trumpet.onsetBend < 1, "a trumpet must rise into the note");
assert.ok(byKey.violin.onsetBend > 1, "a bow must catch sharp and settle");

// every wind body has real resonances, and vibrato arrives late like a player's
for (const key of ["violin", "saxophone", "trumpet"]) {
  assert.ok(byKey[key].formants.length >= 2, `${key} needs body/bore formants`);
  assert.ok(byKey[key].vibratoDelayMs > 200, `${key} vibrato must start after the note is planted`);
}

// ── the morph is an equal-power crossfade between physical models ──
for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
  const g = crossfadeGains(mix);
  assert.ok(Math.abs(g.lower ** 2 + g.upper ** 2 - 1) < 1e-9, `crossfade at ${mix} must conserve energy`);
}
assert.equal(crossfadeGains(0).upper, 0, "a pure position plays one instrument only");
assert.ok(crossfadeGains(1).lower < 1e-9, "the far end silences the lower voice");

// the ends of the surface are the pure instruments
assert.equal(timbreAt(0).label, "harp", "position 0 should be pure harp");
assert.equal(timbreAt(1).label, "trumpet", "position 1 should be pure trumpet");
assert.equal(timbreAt(0).lower.key, "harp");
assert.equal(timbreAt(1).upper.key, "trumpet");

// interior positions sit between two named voices
const { mix } = timbreNeighbors(1.5 / 7);
assert.ok(mix > 0 && mix < 1, "an interior position should sit between two voices");
const between = timbreAt(1.5 / 7);
assert.equal(between.label, `${between.lower.label} ↔ ${between.upper.label}`, "an interior blend should name both parents");

// labels settle onto the pure voice near its band center
assert.equal(blendLabel(byKey.piano, byKey.guitar, 0.03), "piano", "positions near a voice should read as that voice");
assert.equal(blendLabel(byKey.piano, byKey.guitar, 0.97), "guitar", "positions near the next voice should read as it");

// out-of-range positions clamp to the ends instead of failing
assert.equal(timbreAt(-1).label, "harp", "positions below the surface clamp to the first voice");
assert.equal(timbreAt(2).label, "trumpet", "positions past the surface clamp to the last voice");

console.log("timbre atlas ok");
