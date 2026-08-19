// The wave instrument's pure laws. These assertions target plausible drift:
// wrong stencil signs, leaky boundaries, misplaced bins, and lost phase.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);

async function loadTsModule(path) {
  // Bun can execute the small TypeScript law directly; Node uses the same
  // TypeScript transpilation path as the rest of this repository's tests.
  if (typeof Bun !== "undefined") return import(new URL(path, rootUrl).href);
  const ts = await import("typescript");
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
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  TAU,
  advanceWave2DInto,
  advanceString1DInto,
  refractionSpeedAt,
  fillRefractionSpeedField,
  harmonicFor,
  epicycleChain,
  epicycleTipY,
  discreteFourierTransform,
  inverseDiscreteFourierTransform,
  complexPower,
  signalEnergy,
} = await loadTsModule("src/lib/waves.ts");

const closeTo = (actual, expected, tolerance = 1e-8, message = "values differ") => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
};

// A central impulse advances under the five-point stencil: its neighbours
// receive energy while the central value follows the analytical update.
{
  const current = new Float32Array(25);
  const previous = new Float32Array(25);
  const next = new Float32Array(25);
  current[12] = 1;
  advanceWave2DInto({ current, previous, next, width: 5, height: 5, cSquared: 0.25, damping: 1 });
  closeTo(next[12], 1, 1e-7, "the impulse center follows the centered update");
  for (const index of [7, 11, 13, 17]) closeTo(next[index], 0.25, 1e-7, "each cardinal neighbour receives the same impulse");
  for (const index of [0, 4, 20, 24]) assert.equal(next[index], 0, "tank walls stay fixed at rest");
}

// The preallocated web buffers alias `previous` and `next`; this must retain
// the previous displacement until each cell has consumed it.
{
  const current = new Float32Array(25);
  const previousAndNext = new Float32Array(25);
  current[12] = 1;
  previousAndNext[12] = 0.4;
  advanceWave2DInto({
    current,
    previous: previousAndNext,
    next: previousAndNext,
    width: 5,
    height: 5,
    cSquared: 0.25,
    damping: 1,
  });
  closeTo(previousAndNext[12], 0.6, 1e-7, "aliased buffers preserve the finite-difference history");
}

// The string is the one-dimensional form of the same law, pinned at both ends.
{
  const current = new Float32Array([0, 0, 1, 0, 0]);
  const previous = new Float32Array(5);
  const next = new Float32Array(5);
  advanceString1DInto({ current, previous, next, cSquared: 0.25, damping: 1 });
  assert.deepEqual(Array.from(next), [0, 0.25, 1.5, 0.25, 0], "a pluck propagates symmetrically and reflects at fixed ends");
}

// Refraction is a declared, deterministic material gradient rather than a
// visual effect: the upper water travels fastest and the lower band slowest.
{
  const field = new Float32Array(8 * 10);
  fillRefractionSpeedField(field, 8, 10);
  closeTo(refractionSpeedAt(0, 10), 1, 1e-12, "the top of the tank has base speed");
  closeTo(refractionSpeedAt(9, 10), 0.42, 1e-12, "the deep band has its declared slow speed");
  for (let row = 1; row < 10; row += 1) {
    assert.ok(field[row * 8] <= field[(row - 1) * 8], "refraction speed never rises with depth");
    for (let column = 1; column < 8; column += 1) {
      assert.equal(field[row * 8 + column], field[row * 8], "every depth band is laterally uniform");
    }
  }
}

// The visible epicycle is its spectral sum: component families and the
// allocation-free trace projection must agree with the full chain exactly.
{
  assert.deepEqual(harmonicFor("square", 2, 0), { n: 5, r: 16, sign: 1, hue: "#ff7f8f" }, "square keeps odd, positive harmonics");
  assert.deepEqual(harmonicFor("saw", 1, 0), { n: 2, r: 44, sign: -1, hue: "#66d4c9" }, "saw alternates harmonic orientation");
  const triangleFirst = harmonicFor("triangle", 1, 0);
  assert.equal(triangleFirst.n, 3, "triangle omits even harmonics");
  closeTo(triangleFirst.r, 112 / 9, 1e-12, "triangle amplitude falls quadratically");
  const chain = epicycleChain("pulse", 8, 0.91, 0.42);
  closeTo(epicycleTipY("pulse", 8, 0.91, 0.42), chain.at(-1).y, 1e-10, "trace and circle chain share one Fourier sum");
}

// DFT fixture: a phase-shifted pure tone has only conjugate bins, retains its
// phase, reconstructs, and satisfies Parseval. A swapped sign or scale breaks
// at least one of these independently meaningful assertions.
{
  const count = 32;
  const bin = 5;
  const phase = 0.63;
  const samples = Array.from({ length: count }, (_, index) => Math.cos(TAU * bin * index / count + phase));
  const spectrum = discreteFourierTransform(samples);
  for (let index = 0; index < count; index += 1) {
    if (index === bin || index === count - bin) continue;
    assert.ok(complexPower(spectrum[index]) < 1e-20, "a pure tone leaves every non-conjugate bin silent");
  }
  closeTo(Math.atan2(spectrum[bin].im, spectrum[bin].re), phase, 1e-10, "the positive bin retains phase");
  closeTo(complexPower(spectrum[bin]), (count / 2) ** 2, 1e-8, "the positive bin carries half the real-tone amplitude");
  closeTo(complexPower(spectrum[count - bin]), (count / 2) ** 2, 1e-8, "the conjugate bin mirrors the real tone");
  closeTo(signalEnergy(samples), spectrum.reduce((sum, value) => sum + complexPower(value), 0) / count, 1e-8, "Parseval conserves signal energy");
  const reconstructed = inverseDiscreteFourierTransform(spectrum);
  for (let index = 0; index < count; index += 1) closeTo(reconstructed[index], samples[index], 1e-10, "inverse DFT reconstructs every sample");
}

console.log("waves laws passed");
