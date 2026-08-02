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

const { HARMONIC_COUNT, TIMBRE_CHAIN, blendLabel, timbreAt, timbreNeighbors } =
  loadTsModule("src/lib/timbre.ts");

// the chain holds the eight voices in a timbrally-ordered walk
assert.equal(TIMBRE_CHAIN.length, 8, "the chain should hold eight instruments");
assert.deepEqual(
  TIMBRE_CHAIN.map((voice) => voice.key),
  ["harp", "piano", "guitar", "tar", "sitar", "violin", "saxophone", "trumpet"],
  "the chain should walk from softest pluck to brightest blown voice",
);

for (const voice of TIMBRE_CHAIN) {
  assert.equal(voice.harmonics.length, HARMONIC_COUNT, `${voice.key} needs a full harmonic recipe`);
  assert.equal(voice.harmonics[0], 1, `${voice.key} should normalize to its fundamental`);
  assert.ok(voice.harmonics.every((amp) => amp > 0), `${voice.key} harmonics must all be positive`);
  assert.ok(voice.attack > 0 && voice.decay > 0 && voice.release > 0, `${voice.key} envelope must move`);
  assert.ok(voice.sustain >= 0 && voice.sustain <= 1, `${voice.key} sustain must be a level`);
}

// struck and plucked voices fall away; bowed and blown voices hold
for (const key of ["harp", "piano", "guitar", "tar", "sitar"]) {
  const voice = TIMBRE_CHAIN.find((entry) => entry.key === key);
  assert.equal(voice.sustain, 0, `${key} should be percussive`);
}
for (const key of ["violin", "saxophone", "trumpet"]) {
  const voice = TIMBRE_CHAIN.find((entry) => entry.key === key);
  assert.ok(voice.sustain > 0.5, `${key} should sustain`);
}

// the ends of the surface are the pure instruments
const bottom = timbreAt(0);
const top = timbreAt(1);
assert.equal(bottom.label, "harp", "position 0 should be pure harp");
assert.equal(top.label, "trumpet", "position 1 should be pure trumpet");
assert.deepEqual(bottom.harmonics, TIMBRE_CHAIN[0].harmonics, "position 0 should carry the harp recipe untouched");
assert.deepEqual(top.harmonics, TIMBRE_CHAIN[7].harmonics, "position 1 should carry the trumpet recipe untouched");

// between two voices, every parameter is strictly between its neighbors
const { mix } = timbreNeighbors(1.5 / 7);
assert.ok(mix > 0 && mix < 1, "an interior position should sit between two voices");
const between = timbreAt(1.5 / 7);
for (let i = 0; i < HARMONIC_COUNT; i++) {
  const lo = Math.min(between.lower.harmonics[i], between.upper.harmonics[i]);
  const hi = Math.max(between.lower.harmonics[i], between.upper.harmonics[i]);
  assert.ok(
    between.harmonics[i] >= lo - 1e-12 && between.harmonics[i] <= hi + 1e-12,
    `blended harmonic ${i + 1} should sit between its neighbors`,
  );
}
assert.equal(between.label, `${between.lower.label} ↔ ${between.upper.label}`, "an interior blend should name both parents");

// morphing across the pluck/bow border moves sustain continuously
const nearSitar = timbreAt(4 / 7 + 0.1 / 7);
const nearViolin = timbreAt(5 / 7 - 0.1 / 7);
assert.ok(nearSitar.sustain > 0 && nearSitar.sustain < nearViolin.sustain, "sustain should rise continuously toward the bow");

// labels settle onto the pure voice near its band center
assert.equal(blendLabel(TIMBRE_CHAIN[1], TIMBRE_CHAIN[2], 0.03), "piano", "positions near a voice should read as that voice");
assert.equal(blendLabel(TIMBRE_CHAIN[1], TIMBRE_CHAIN[2], 0.97), "guitar", "positions near the next voice should read as it");

// out-of-range positions clamp to the ends instead of failing
assert.equal(timbreAt(-1).label, "harp", "positions below the surface clamp to the first voice");
assert.equal(timbreAt(2).label, "trumpet", "positions past the surface clamp to the last voice");

console.log("timbre atlas ok");
