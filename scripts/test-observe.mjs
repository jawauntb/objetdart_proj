// The sample under the beam (/observe) — the laws that can lie, pinned.
// Falsifiable only: Beer-Lambert monotonicity, the band centers stay put,
// thermal broadening widens (higher T → wider Gaussian → more absorbance in
// the wings), photonHit is deterministic given (mol.seed, λ, intensity),
// the spectrum accumulator decays but never goes negative, wavelengthToRgb's
// hue anchors sit where the room's copy promises.

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
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const O = loadTsModule("src/lib/observe.ts");

// ——— determinism: the seed is the whole state ————————————————————————
// Catches: any Math.random or wall-clock leak into birth.
{
  const a = O.bornMolecule(1, 0xbeef, 0.4, 0.6, 1000);
  const b = O.bornMolecule(1, 0xbeef, 0.4, 0.6, 1000);
  assert.deepEqual(a, b, "the same seed must bear the same molecule, always");
  const c = O.bornMolecule(1, 0xbeef + 1, 0.4, 0.6, 1000);
  assert.ok(c.vx !== a.vx || c.vy !== a.vy, "a different seed drifts differently");
  assert.equal(O.hashSeed(1, 2, 3), O.hashSeed(1, 2, 3), "hashSeed is a function");
  assert.notEqual(O.hashSeed(1, 2, 3), O.hashSeed(3, 2, 1), "hashSeed hears order");
}

// ——— band centers: the physics is what it says it is ————————————————
// Catches: a peak drift, a band mis-labeling, an off-by-one in width.
{
  const piCenter = O.BAND_PI.center;
  const nCenter = O.BAND_N.center;
  const piEps = O.gaussianBand(piCenter, piCenter, O.BAND_PI.width, O.BAND_PI.epsilonMax);
  const nEps = O.gaussianBand(nCenter, nCenter, O.BAND_N.width, O.BAND_N.epsilonMax);
  assert.equal(piEps, O.BAND_PI.epsilonMax, "π band peaks at its own center, at ε_max");
  assert.equal(nEps, O.BAND_N.epsilonMax, "n band peaks at its own center, at ε_max");
  // The sample sums the bands; the π peak dominates and stays inside 258–262 nm.
  let peakLambda = 200;
  let peakEps = 0;
  for (let l = 200; l <= 800; l += 0.5) {
    const e = O.sampleEpsilon(l);
    if (e > peakEps) { peakEps = e; peakLambda = l; }
  }
  assert.ok(
    Math.abs(peakLambda - piCenter) < 3,
    `the sample's brightest band must sit near the π peak; got ${peakLambda}`,
  );
  assert.ok(
    O.sampleEpsilon(400) < O.sampleEpsilon(piCenter) * 0.05,
    "the visible-light window is transparent — no ghost band at 400 nm",
  );
}

// ——— Beer-Lambert monotonicity ————————————————————————————————————
// Catches: an inverted exponent, a sign flip in A→T.
{
  assert.equal(O.beerLambert(0), 1, "no absorbance, no dimming");
  assert.ok(O.beerLambert(1) < 1, "any absorbance dims the beam");
  assert.ok(O.beerLambert(2) < O.beerLambert(1), "more absorbance dims further");
  assert.ok(O.beerLambert(3) > 0, "T never goes negative, however dark");
  // On-band vs off-band: at the π peak the wall must be visibly darker than at 450 nm.
  const onA = O.sampleAbsorbance(O.BAND_PI.center);
  const offA = O.sampleAbsorbance(450);
  assert.ok(onA > offA * 10, "the band must actually darken the wall, not just tint it");
}

// ——— concentration doubles absorbance ——————————————————————————————
// Catches: a three-finger twist that dilutes the wrong way, or a log/linear mix-up.
{
  const A1 = O.sampleAbsorbance(260, O.REFERENCE_CONCENTRATION);
  const A2 = O.sampleAbsorbance(260, O.REFERENCE_CONCENTRATION * 2);
  assert.ok(
    Math.abs(A2 - A1 * 2) / A1 < 1e-9,
    "Beer-Lambert is linear in concentration — the season twist is a real dial",
  );
  const half = O.sampleAbsorbance(260, O.REFERENCE_CONCENTRATION / 2);
  assert.ok(half < A1, "diluting drops absorbance");
}

// ——— thermal broadening actually broadens ————————————————————————————
// Catches: a shake that widens the band on center and nowhere else, or a
// broadening constant that operates on the wrong axis.
{
  // At the center, the peak stays at ε_max (a Gaussian's peak does not move).
  const centerCold = O.gaussianBand(260, 260, O.BAND_PI.width, O.BAND_PI.epsilonMax, 0);
  const centerHot = O.gaussianBand(260, 260, O.BAND_PI.width, O.BAND_PI.epsilonMax, 0.6);
  assert.equal(centerCold, centerHot, "the peak of a Gaussian is invariant under widening");
  // In the wings, a broader band lets more light through the sides.
  const cold = O.gaussianBand(300, 260, O.BAND_PI.width, O.BAND_PI.epsilonMax, 0);
  const hot = O.gaussianBand(300, 260, O.BAND_PI.width, O.BAND_PI.epsilonMax, 0.6);
  assert.ok(hot > cold, "shaken sample has more absorbance in the wings — thermal broadening is real");
  // FWHM widens with broadening.
  const halfMax = O.BAND_PI.epsilonMax / 2;
  function fwhm(broaden) {
    let lo = 260;
    for (let l = 260; l > 200; l -= 0.1) {
      if (O.gaussianBand(l, 260, O.BAND_PI.width, O.BAND_PI.epsilonMax, broaden) < halfMax) { lo = l; break; }
    }
    let hi = 260;
    for (let l = 260; l < 320; l += 0.1) {
      if (O.gaussianBand(l, 260, O.BAND_PI.width, O.BAND_PI.epsilonMax, broaden) < halfMax) { hi = l; break; }
    }
    return hi - lo;
  }
  assert.ok(fwhm(0.6) > fwhm(0) * 1.3, "FWHM grows with broadening — the audible / visible width follows T");
}

// ——— wavelengthToRgb: the palette anchors ————————————————————————————
// Catches: a swap that puts red at the UV end or violet at the far red.
{
  const violet = O.wavelengthToRgb(400);
  const green = O.wavelengthToRgb(540);
  const red = O.wavelengthToRgb(700);
  assert.ok(violet[2] > violet[0], "400 nm reads as blue-violet — b > r");
  assert.ok(green[1] > green[0] && green[1] > green[2], "540 nm is green — g dominates");
  assert.ok(red[0] > red[1] && red[0] > red[2], "700 nm is red — r dominates");
  // Deep UV attenuates (dark end of the room).
  const deepUV = O.wavelengthToRgb(200);
  const luminance = (c) => c[0] + c[1] + c[2];
  assert.ok(luminance(deepUV) < luminance(violet), "deep-UV is darker than true violet");
  // Far red attenuates similarly.
  const farRed = O.wavelengthToRgb(800);
  assert.ok(luminance(farRed) < luminance(red), "800 nm is darker than 700 nm — approaching invisible");
  // The inverse map round-trips at the anchors it can.
  for (const nm of [200, 400, 550, 700, 800]) {
    const x = O.wavelengthToX(nm);
    const back = O.xToWavelength(x);
    assert.ok(Math.abs(back - nm) < 0.1, `x↔λ round-trips near ${nm} nm`);
  }
}

// ——— photonHit: determinism given (seed, λ, intensity) ————————————————
// Catches: a rolled random inside the absorption test, a wall-clock leak,
// a probability that depends on frame order or on mol.excited itself.
{
  const a = O.bornMolecule(1, 42, 0.5, 0.5, 0);
  const b = O.bornMolecule(1, 42, 0.5, 0.5, 0);
  const ra = O.photonHit(a, 260, 1, 100);
  const rb = O.photonHit(b, 260, 1, 100);
  assert.equal(ra.absorbed, rb.absorbed, "the same seed under the same beam always answers the same");
  assert.equal(ra.energyDeposited, rb.energyDeposited, "deposited energy is a function of the beam");
  // At the strong band's center, at full intensity, most molecules absorb.
  let hits = 0;
  for (let i = 0; i < 200; i++) {
    const m = O.bornMolecule(i, i * 97 + 3, 0.5, 0.5, 0);
    const r = O.photonHit(m, 260, 1, 0);
    if (r.absorbed) hits++;
  }
  assert.ok(hits > 100, `on-band beam should light most of the population, got ${hits}/200`);
  // At 450 nm (transparent) essentially none absorb.
  let offBandHits = 0;
  for (let i = 0; i < 200; i++) {
    const m = O.bornMolecule(i, i * 97 + 3, 0.5, 0.5, 0);
    const r = O.photonHit(m, 450, 1, 0);
    if (r.absorbed) offBandHits++;
  }
  assert.ok(offBandHits < 5, `off-band beam should not light the sample, got ${offBandHits}/200`);
  // An absorbing molecule visibly excites, and records the beam it swallowed.
  const m = O.bornMolecule(9, 42, 0.5, 0.5, 0);
  const r = O.photonHit(m, 260, 1, 500);
  if (r.absorbed) {
    assert.ok(m.excited > 0, "an absorbed hit lifts the excited state");
    assert.equal(m.lastLambda, 260, "the molecule remembers the wavelength it swallowed");
    assert.equal(m.lastAbsorbMs, 500, "and the ms at which it did so");
  }
}

// ——— stepMolecules: walls hold, dilation slows, brownian is seeded ——————
// Catches: a runaway that leaves the cuvette, a timeScale ignored, a
// Math.random leak into Brownian noise.
{
  const input = {
    windX: 0, windY: 0, tiltX: 0, tiltY: 0, temperature: 0.5,
    timeScale: 1, tMs: 1000, reduced: false,
  };
  const a = O.bornMolecule(1, 3, 0.5, 0.5, 0);
  const b = O.bornMolecule(1, 3, 0.5, 0.5, 0);
  O.stepMolecules([a], 0.05, input);
  O.stepMolecules([b], 0.05, input);
  assert.deepEqual(a, b, "the same molecule under the same field steps the same — no Math.random leak");
  const slow = O.bornMolecule(1, 3, 0.5, 0.5, 0);
  O.stepMolecules([slow], 0.05, { ...input, timeScale: 0.25 });
  const distA = Math.hypot(a.nx - 0.5, a.ny - 0.5);
  const distSlow = Math.hypot(slow.nx - 0.5, slow.ny - 0.5);
  assert.ok(distSlow <= distA + 1e-9, "a three-finger hold slows the world");
  // A runaway must stop at the wall.
  const runaway = O.bornMolecule(2, 4, 0.965, 0.5, 0);
  runaway.vx = 20;
  O.stepMolecules([runaway], 0.05, input);
  assert.ok(runaway.nx <= 0.97, "the cuvette wall holds");
  // Retiring is an exhale, not a blink.
  const retiring = O.bornMolecule(3, 5, 0.5, 0.5, 0);
  retiring.presence = 0.999;
  O.stepMolecules([retiring], 0.1, input);
  assert.ok(retiring.presence > 0 && retiring.presence < 0.999, "unraveling is an exhale, not a blink");
}

// ——— stepMolecules: temperature broadens drift ——————————————————————
// Catches: a temperature knob that only widens bands but does not move
// molecules faster (the room's shake is felt as both).
{
  const base = { windX: 0, windY: 0, tiltX: 0, tiltY: 0, timeScale: 1, tMs: 500, reduced: false };
  const cold = O.bornMolecule(1, 7, 0.5, 0.5, 0);
  const hot = O.bornMolecule(1, 7, 0.5, 0.5, 0);
  for (let i = 0; i < 40; i++) {
    O.stepMolecules([cold], 0.033, { ...base, tMs: 500 + i * 33, temperature: 0.05 });
    O.stepMolecules([hot], 0.033, { ...base, tMs: 500 + i * 33, temperature: 0.95 });
  }
  const dCold = Math.hypot(cold.nx - 0.5, cold.ny - 0.5);
  const dHot = Math.hypot(hot.nx - 0.5, hot.ny - 0.5);
  assert.ok(dHot > dCold, `a hotter sample must wander farther in the same time; cold=${dCold.toFixed(3)} hot=${dHot.toFixed(3)}`);
}

// ——— spectrum accumulator: decays but never goes negative ——————————
// Catches: a decay coefficient with the wrong sign, or a bin that dips
// below zero after a long idle.
{
  const acc = O.createSpectrumAccumulator(0);
  O.spectrumAdd(acc, 260, 1.4);
  const bin = O.spectrumBinFor(260);
  assert.ok(acc.bins[bin] > 0, "a hit lifts its bin");
  // decay shrinks it and does not flip signs, even after many steps.
  for (let i = 0; i < 200; i++) O.spectrumDecay(acc, 0.1, i * 100);
  assert.ok(acc.bins[bin] >= 0, "decay never crosses zero, however patiently");
  assert.ok(acc.bins[bin] < 0.05, "a long idle drains the curve nearly to zero");
  // a fresh accumulator has zero peak.
  const acc2 = O.createSpectrumAccumulator();
  assert.equal(O.spectrumPeak(acc2), 0, "no hits, no peak");
  O.spectrumAdd(acc2, 260, 0.8);
  O.spectrumAdd(acc2, 285, 0.4);
  assert.ok(O.spectrumPeak(acc2) >= 0.8, "the peak reads the tallest bin");
}

// ——— spectrum accumulator: hit-neighbor smear stays symmetric —————
// Catches: an off-by-one that biases the smear left or right.
{
  const acc = O.createSpectrumAccumulator();
  const lambda = 500;
  const bin = O.spectrumBinFor(lambda);
  // pick a bin well away from the edges so both neighbors exist.
  assert.ok(bin > 5 && bin < O.SPECTRUM_BINS - 5, "the test picks a mid-band bin");
  O.spectrumAdd(acc, lambda, 1);
  assert.ok(
    Math.abs(acc.bins[bin - 1] - acc.bins[bin + 1]) < 1e-9,
    "smear is symmetric — left and right neighbors get the same lift",
  );
  assert.ok(acc.bins[bin - 1] < acc.bins[bin], "and the smear is less than the direct hit");
}

// ——— persistence round-trips ————————————————————————————————————
// Catches: a serializer that loses information the spectrum needs to
// re-render at the same shape.
{
  const acc = O.createSpectrumAccumulator();
  O.spectrumAdd(acc, 260, 2.5);
  O.spectrumAdd(acc, 285, 1.0);
  O.spectrumAdd(acc, 500, 0.3);
  const kept = O.serializeSpectrum(acc);
  const back = O.loadSpectrum(kept, 0);
  // Rounding to 3 digits loses ~0.5% at scale; the peaks come back close.
  const b260 = O.spectrumBinFor(260);
  assert.ok(Math.abs(back.bins[b260] - acc.bins[b260]) < 0.05, "the strong peak returns to shape");
  assert.deepEqual(O.loadSpectrum("garbage", 0).bins.length, O.SPECTRUM_BINS, "a corrupt keep is a fresh accumulator");
  assert.deepEqual(O.loadSpectrum(null, 0).bins.length, O.SPECTRUM_BINS, "null keep loads clean");
}

console.log("observe: ok");
