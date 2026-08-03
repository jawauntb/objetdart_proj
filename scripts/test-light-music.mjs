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
  // Same realm as the test: vm.runInNewContext builds arrays, objects and
  // strings on a foreign prototype chain, so deepStrictEqual rejects them
  // against host literals of identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  AUDIBLE_MAX_HZ,
  AUDIBLE_MIN_HZ,
  MAX_WAVELENGTH,
  MIN_WAVELENGTH,
  audibleFrequency,
  colorFromWavelength,
  noteName,
  parseMusicInput,
  parseMusicScore,
  quantizeFrequency,
  translateFrequencyToLight,
  wavelengthFromX,
} = loadTsModule("src/lib/light-music.ts");

assert.equal(noteName(440), "A4", "A4 should round-trip through note naming");
assert.equal(colorFromWavelength(750), "#8e2318", "750nm should use the deep red spectral stop");
assert.equal(colorFromWavelength(700), "#d83a2e", "700nm should use the red spectral stop");
assert.equal(colorFromWavelength(405), "#9a63ee", "405nm should use the violet spectral stop");
assert.equal(colorFromWavelength(380), "#7a43d8", "380nm should use the deep violet spectral stop");

// the whole audible band covers the whole visible band, edge to edge
const floor = translateFrequencyToLight(AUDIBLE_MIN_HZ);
const ceiling = translateFrequencyToLight(AUDIBLE_MAX_HZ);
assert.ok(Math.abs(floor.wavelength - MAX_WAVELENGTH) < 0.0001, "the hearing floor should land on deep red");
assert.ok(Math.abs(ceiling.wavelength - MIN_WAVELENGTH) < 0.0001, "the hearing ceiling should land on deep violet");
assert.equal(floor.exact, true, "the hearing floor should be inside the map");
assert.equal(ceiling.exact, true, "the hearing ceiling should be inside the map");

// smooth and strictly monotone: every pitch owns its own color
const a3 = translateFrequencyToLight(220);
const a4 = translateFrequencyToLight(440);
const a5 = translateFrequencyToLight(880);
assert.ok(a3.wavelength > a4.wavelength && a4.wavelength > a5.wavelength, "rising pitch should march toward violet");
assert.ok(a4.wavelength >= 540 && a4.wavelength <= 565, "A4 should sit near the green center of the spectrum");

// the inverse is exact: playing a color back gives the pitch that made it
for (const freq of [27.5, 110, 440, 1760, 4186.009, 12000]) {
  const roundTrip = audibleFrequency(translateFrequencyToLight(freq).wavelength);
  assert.ok(Math.abs(roundTrip - freq) / freq < 1e-9, `${freq} Hz should survive the light round trip`);
  assert.ok(Math.abs(translateFrequencyToLight(freq).cents) < 0.001, `${freq} Hz should carry no pitch error`);
}

// beyond hearing clamps to the spectral edges and says so
const belowHearing = translateFrequencyToLight(10);
const aboveHearing = translateFrequencyToLight(30000);
assert.equal(belowHearing.exact, false, "sub-audible input should be marked inexact");
assert.equal(aboveHearing.exact, false, "ultrasonic input should be marked inexact");
assert.ok(Math.abs(belowHearing.wavelength - MAX_WAVELENGTH) < 0.0001, "sub-audible input should clamp to deep red");
assert.ok(Math.abs(aboveHearing.wavelength - MIN_WAVELENGTH) < 0.0001, "ultrasonic input should clamp to deep violet");

// the instrument strip is log-spaced: mid-plate is the geometric mid-pitch
assert.ok(Math.abs(wavelengthFromX(0) - MAX_WAVELENGTH) < 0.0001, "left edge of the strip should be deep red");
assert.ok(Math.abs(wavelengthFromX(1) - MIN_WAVELENGTH) < 0.0001, "right edge of the strip should be deep violet");
const midFreq = audibleFrequency(wavelengthFromX(0.5));
assert.ok(Math.abs(midFreq - Math.sqrt(AUDIBLE_MIN_HZ * AUDIBLE_MAX_HZ)) < 0.01, "mid-strip should be the geometric mean pitch");

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
assert.ok(fSharp4.wavelength >= MIN_WAVELENGTH && fSharp4.wavelength <= MAX_WAVELENGTH, "every note should stay inside the visible band");
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

assert.equal(quantizeFrequency(440, "pure"), 440, "pure mode should leave frequencies untouched");
assert.equal(quantizeFrequency(452, "pure"), 452, "pure mode should keep raw light frequencies");
assert.ok(Math.abs(quantizeFrequency(455, "chroma") - 466.16) < 0.01, "chroma mode should snap 455 Hz up to Bb4");
assert.ok(Math.abs(quantizeFrequency(455, "penta") - 440) < 0.01, "penta mode should snap 455 Hz down to A4");
assert.ok(Math.abs(quantizeFrequency(107.5, "penta") - 110) < 0.01, "the A2 light tone should land on A2 in penta mode");
assert.ok(Math.abs(quantizeFrequency(370, "penta") - 392) < 0.01, "penta mode should skip non-scale semitones (F#4 → G4)");
assert.equal(noteName(quantizeFrequency(311, "penta")), "D4", "penta snapping should produce clean note names");

console.log("light music conversion ok");
