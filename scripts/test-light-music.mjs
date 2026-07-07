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
  parseMusicInput,
  parseMusicScore,
  translateFrequencyToLight,
} = loadTsModule("src/lib/light-music.ts");

assert.equal(noteName(440), "A4", "A4 should round-trip through note naming");
assert.equal(colorFromWavelength(700), "#d83a2e", "700nm should use the red spectral stop");
assert.equal(colorFromWavelength(405), "#9a63ee", "405nm should use the violet spectral stop");

const a4 = translateFrequencyToLight(440);
assert.ok(a4.wavelength >= 600 && a4.wavelength <= 630, "A4 should translate into the orange-red band");
assert.equal(a4.exact, true, "A4 should land exactly inside the visible octave bridge");

const a3 = translateFrequencyToLight(220);
const a5 = translateFrequencyToLight(880);
assert.ok(Math.abs(a3.wavelength - a4.wavelength) < 0.0001, "octave-down A should keep the same light color");
assert.ok(Math.abs(a5.wavelength - a4.wavelength) < 0.0001, "octave-up A should keep the same light color");
assert.equal(a3.bridgeDivisor, a4.bridgeDivisor + 1, "downshifting notes should upshift the bridge divisor by one");
assert.equal(a5.bridgeDivisor, a4.bridgeDivisor - 1, "upshifting notes should downshift the bridge divisor by one");

const a0 = translateFrequencyToLight(27.5);
const c8 = translateFrequencyToLight(4186.009);
assert.equal(a0.exact, true, "low piano notes should adapt into visible light without clamping");
assert.equal(c8.exact, true, "high piano notes should adapt into visible light without clamping");

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

const parsedInput = parseMusicInput("tempo=90 time=3/4 key=C\n[C4 E4 G4]:2 rest D4");
assert.equal(parsedInput.metadata.tempo, 90);
assert.equal(parsedInput.metadata.timeSignature[0], 3);
assert.equal(parsedInput.metadata.timeSignature[1], 4);
assert.equal(parsedInput.metadata.key, "C");
assert.equal(parsedInput.tokens.length, 3);
assert.equal(parsedInput.tokens[0].kind, "chord");
assert.equal(parsedInput.tokens[0].notes.length, 3);
assert.equal(parsedInput.tokens[0].duration, 2);
assert.equal(parsedInput.tokens[0].normalized, "[C4 E4 G4]");
assert.equal(parsedInput.tokens[1].kind, "rest");
assert.equal(parsedInput.tokens[2].kind, "note");

const abcInput = parseMusicInput("T:tiny\nM:6/8\nQ:1/4=132\nK:G\n[G3 B3 D4] E4/0.5");
assert.equal(abcInput.metadata.title, "tiny");
assert.equal(abcInput.metadata.timeSignature[0], 6);
assert.equal(abcInput.metadata.timeSignature[1], 8);
assert.equal(abcInput.metadata.tempo, 132);
assert.equal(abcInput.metadata.key, "G");
assert.equal(abcInput.tokens[0].kind, "chord");
assert.equal(abcInput.tokens[1].kind, "note");
assert.equal(abcInput.tokens[1].duration, 0.5);

console.log("light music conversion ok");
