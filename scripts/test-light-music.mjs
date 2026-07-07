import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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
  const sandbox = { module, exports: module.exports };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

const {
  MAX_WAVELENGTH,
  MIN_WAVELENGTH,
  colorFromWavelength,
  noteName,
  parseMusicScore,
  translateFrequencyToLight,
} = loadTsModule("src/lib/light-music.ts");

assert.equal(noteName(440), "A4", "A4 should round-trip through note naming");
assert.equal(colorFromWavelength(700), "#d83a2e", "700nm should use the red spectral stop");
assert.equal(colorFromWavelength(405), "#9a63ee", "405nm should use the violet spectral stop");

const a4 = translateFrequencyToLight(440);
assert.ok(a4.wavelength >= 600 && a4.wavelength <= 630, "A4 should translate into the orange-red band");
assert.equal(a4.exact, true, "A4 should land exactly inside the visible octave bridge");

const parsed = parseMusicScore("C4 D#4 Bb3 rest F#4/2 nope");
assert.equal(parsed.length, 6, "parser should preserve note, rest, duration, and invalid tokens");

const [c4, dSharp4, bFlat3, rest, fSharp4, invalid] = parsed;
assert.equal(c4.kind, "note");
assert.equal(c4.normalized, "C4");
assert.ok(c4.wavelength >= MIN_WAVELENGTH && c4.wavelength <= MAX_WAVELENGTH, "C4 should produce visible color");
assert.equal(dSharp4.kind, "note");
assert.equal(dSharp4.normalized, "Eb4");
assert.equal(bFlat3.kind, "note");
assert.equal(bFlat3.normalized, "Bb3");
assert.equal(rest.kind, "rest");
assert.equal(fSharp4.kind, "note");
assert.equal(fSharp4.duration, 2);
assert.ok(fSharp4.wavelength >= MIN_WAVELENGTH && fSharp4.wavelength <= MAX_WAVELENGTH, "gap notes should clamp to visible color");
assert.equal(invalid.kind, "invalid");

console.log("light music conversion ok");
