// The sample under the beam (/observe) — the laws that can lie, pinned.
// Falsifiable only: Beer-Lambert monotonicity, the band centers stay put,
// thermal broadening widens (higher T → wider Gaussian → more absorbance in
// the wings), photonHit is deterministic given (mol.seed, λ, intensity),
// the spectrum accumulator decays but never goes negative, wavelengthToRgb's
// hue anchors sit where the room's copy promises.

import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

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

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — altitude sweep laws
// ═══════════════════════════════════════════════════════════════════════════

// ——— altitudeFromZoom: buckets + monotone blend in transitions ————————
// Catches: a swapped bucket order, a bucket boundary an off-by-one apart, a
// blend that runs backward or non-monotonically inside a transition band.
{
  assert.equal(O.altitudeFromZoom(1).current, "crystal", "zoom 1 sits at the crystal altitude");
  assert.equal(O.altitudeFromZoom(64).current, "solution", "zoom 64 is inside the solution range");
  assert.equal(O.altitudeFromZoom(4000).current, "chromophore", "zoom 4000 lands at the chromophore");
  assert.equal(O.altitudeFromZoom(1.5).current, "crystal", "still crystal below zoom 2");
  assert.equal(O.altitudeFromZoom(500).current, "moleculeZoom", "500 is inside the molecule-zoom transition");
  assert.equal(O.altitudeFromZoom(1500).current, "molecule", "1500 is inside the hard molecule altitude");

  // Blends: monotone across the dissolve band.
  const dz = [3, 5, 10, 14];
  const dbs = dz.map((z) => O.altitudeFromZoom(z).blend);
  for (let i = 1; i < dbs.length; i++) {
    assert.ok(
      dbs[i] > dbs[i - 1],
      `dissolve blend must increase with zoom (${dz[i - 1]}→${dz[i]}: ${dbs[i - 1]} → ${dbs[i]})`,
    );
  }
  for (const b of dbs) assert.ok(b >= 0 && b <= 1, "dissolve blend stays in [0,1]");
  assert.equal(O.altitudeFromZoom(1).blend, 0, "at a hard altitude the blend is zero");

  // moleculeZoom transition too.
  const mz = [300, 512, 800, 1000];
  const mbs = mz.map((z) => O.altitudeFromZoom(z).blend);
  for (let i = 1; i < mbs.length; i++) {
    assert.ok(mbs[i] > mbs[i - 1], "molecule-zoom blend must increase with zoom");
  }

  // Incoming altitude names the RISING neighbour.
  assert.equal(O.altitudeFromZoom(8).incoming, "solution", "dissolve fades UP into solution");
  assert.equal(O.altitudeFromZoom(500).incoming, "molecule", "moleculeZoom fades UP into molecule");
  assert.equal(O.altitudeFromZoom(64).incoming, null, "no incoming at a hard altitude");
}

// ——— altitudeWeights: sum to ~1 across the whole zoom range —————————
// Catches: a bucket whose weights don't cover the frame (a hole in the
// crossfade), an over-shoot that would brighten the material past its cap.
{
  for (const z of [1, 4, 16, 100, 800, 1500, 3000, 4096]) {
    const w = O.altitudeWeights(z);
    const total = w.crystal + w.solution + w.molecule + w.chromophore;
    assert.ok(Math.abs(total - 1) < 1e-9, `altitude weights sum to 1 at zoom=${z}, got ${total}`);
    for (const [name, v] of Object.entries(w)) {
      assert.ok(v >= 0 && v <= 1, `weight ${name} in [0,1] at zoom=${z}, got ${v}`);
    }
  }
  // In a dissolve transition (zoom 4) the crystal weight decays as zoom rises
  // and the solution weight climbs — the room actually crossfades.
  const lo = O.altitudeWeights(3);
  const hi = O.altitudeWeights(12);
  assert.ok(lo.crystal > hi.crystal, "crystal fades out through the dissolve band");
  assert.ok(hi.solution > lo.solution, "solution fades in through the dissolve band");
}

// ——— OBSERVE_ZOOM_SPEC: names the /drop band, the two extremes ————————
{
  assert.equal(O.OBSERVE_ZOOM_SPEC.band, "drop", "the room lives on the /drop band");
  assert.equal(O.OBSERVE_ZOOM_SPEC.zoomMin, 1, "widest view is 1x");
  assert.equal(O.OBSERVE_ZOOM_SPEC.zoomMax, 4096, "tightest view is 4096x");
}

// ——— crystal flakes: determinism + gravity + walls ————————————————
// Catches: a Math.random leak into birth, a gravity that never lands, a
// wall that doesn't hold.
{
  const a = O.bornCrystalFlake(1, 0xa1b2, 0.5, 0.2);
  const b = O.bornCrystalFlake(1, 0xa1b2, 0.5, 0.2);
  assert.deepEqual(a, b, "the same seed births the same flake");
  const c = O.bornCrystalFlake(1, 0xa1b2 + 1, 0.5, 0.2);
  assert.ok(c.rot !== a.rot || c.omega !== a.omega, "a different seed spins differently");

  // Gravity actually lands.
  const falling = O.bornCrystalFlake(2, 3, 0.5, 0.2);
  for (let i = 0; i < 60; i++) O.stepCrystal([falling], 0.033);
  assert.ok(falling.y >= 0.85, "the flake reaches the bench-top under gravity");
  assert.ok(falling.settled || falling.y >= 0.85, "and comes to rest, doesn't fall through");

  // A tilt biases lateral drift on unsettled flakes.
  const left = O.bornCrystalFlake(3, 4, 0.5, 0.2);
  const right = O.bornCrystalFlake(3, 4, 0.5, 0.2);
  for (let i = 0; i < 20; i++) O.stepCrystal([left], 0.033, { x: -0.6, y: 0 });
  for (let i = 0; i < 20; i++) O.stepCrystal([right], 0.033, { x: 0.6, y: 0 });
  assert.ok(right.x > left.x, "a rightward tilt slides the heap toward positive x");
}

// ——— crystalCaustics: bounded, deterministic in (x, y, tSec, seed) ——
// Catches: a caustic that leaks NaN, drifts past 1, or reads the wall clock.
{
  for (let i = 0; i < 32; i++) {
    const x = (i * 0.11) % 1;
    const y = (i * 0.07) % 1;
    const t = i * 0.13;
    const seed = 0xbeef * (i + 1);
    const v = O.crystalCaustics(x, y, t, seed);
    assert.ok(v >= 0 && v <= 1, `caustic in [0,1] at (${x},${y},${t},${seed}) got ${v}`);
  }
  const a = O.crystalCaustics(0.3, 0.4, 1.5, 0xcafe);
  const b = O.crystalCaustics(0.3, 0.4, 1.5, 0xcafe);
  assert.equal(a, b, "crystalCaustics is a pure function");
  const c = O.crystalCaustics(0.3, 0.4, 1.5, 0xcafe + 1);
  assert.ok(a !== c, "a different seed shifts the caustic — no lockstep flakes");
}

// ——— flipChirality: involution, connectivity invariant, z inversion ——
// Catches: a mirror that mutates bonds (would change what molecule the room
// is drawing), a flip that fails to be its own inverse (an accumulating
// drift each time the visitor twists), a mirror that only touches labels
// but not geometry.
{
  const m = O.bornMolecule3D();
  const flipped = O.flipChirality(m);
  assert.notEqual(flipped.chirality, m.chirality, "flip toggles the enantiomer label");
  // z inverted on every atom
  for (let i = 0; i < m.atoms.length; i++) {
    assert.ok(
      Math.abs(flipped.atoms[i].z + m.atoms[i].z) < 1e-12,
      `atom ${i} z inverted under the mirror`,
    );
    assert.equal(flipped.atoms[i].el, m.atoms[i].el, "elements never change under a mirror");
    assert.equal(flipped.atoms[i].x, m.atoms[i].x, "x preserved");
    assert.equal(flipped.atoms[i].y, m.atoms[i].y, "y preserved");
  }
  // connectivity — the bond list, atom-index pairs and orders — is invariant
  assert.equal(flipped.bonds.length, m.bonds.length, "flip does not add or drop bonds");
  for (let i = 0; i < m.bonds.length; i++) {
    assert.equal(flipped.bonds[i].a, m.bonds[i].a, `bond ${i} a preserved`);
    assert.equal(flipped.bonds[i].b, m.bonds[i].b, `bond ${i} b preserved`);
    assert.equal(flipped.bonds[i].order, m.bonds[i].order, `bond ${i} order preserved`);
  }
  // involution
  const twice = O.flipChirality(flipped);
  assert.equal(twice.chirality, m.chirality, "flip twice returns the enantiomer label");
  for (let i = 0; i < m.atoms.length; i++) {
    assert.ok(
      Math.abs(twice.atoms[i].z - m.atoms[i].z) < 1e-12,
      `atom ${i} z returns to origin after two flips`,
    );
  }
}

// ——— rotateMolecule: additive on the euler angles ————————————————
// Catches: a rotation applied in the wrong axis order (would swap dqx/dqy),
// a mutation of the input (would break time reversibility for a film).
{
  const m = O.bornMolecule3D();
  const startRx = m.rotation[0];
  const startRy = m.rotation[1];
  const r1 = O.rotateMolecule(m, 0.5, 0.2);
  assert.equal(r1.rotation[1], startRy + 0.5, "dqx adds to ry");
  assert.equal(r1.rotation[0], startRx + 0.2, "dqy adds to rx");
  // and returns a new object — no mutation of the input state
  assert.equal(m.rotation[1], startRy, "rotateMolecule does not mutate its input");
  // bornMolecule3D starts at the rest pose — chirality is visible at first
  // paint because z-inversion projects onto screen x/y in this view.
  assert.equal(m.rotation[0], O.MOLECULE_REST_RX, "born at the rest pose (rx)");
  assert.equal(m.rotation[1], O.MOLECULE_REST_RY, "born at the rest pose (ry)");
  assert.ok(O.MOLECULE_REST_RX !== 0 || O.MOLECULE_REST_RY !== 0,
    "rest pose is a non-trivial tilt so chirality reads");
}

// ——— stepMolecule: chair flip on breath, rotation damps toward rest ——
// Catches: a damp toward zero that would render chirality flip invisible on
// a drag-released molecule.
{
  const m0 = O.bornMolecule3D();
  const rot = O.rotateMolecule(m0, 1.5, 0);
  const stepped = O.stepMolecule(rot, 0.5, 0.5);
  // Distance to the rest pose shrinks under one step
  const distBefore = Math.abs(rot.rotation[1] - O.MOLECULE_REST_RY);
  const distAfter = Math.abs(stepped.rotation[1] - O.MOLECULE_REST_RY);
  assert.ok(
    distAfter < distBefore,
    `rotation damps TOWARD the rest pose, not toward zero: ${distBefore} → ${distAfter}`,
  );
  // A breath at phase 0 vs 0.5 lands the chair phase at different places.
  const a = O.stepMolecule(m0, 0.5, 0);
  const b = O.stepMolecule(m0, 0.5, 0.5);
  assert.ok(a.chairFlipPhase !== b.chairFlipPhase, "chair phase reads the breath");
  // Many steps land at the rest pose — a released molecule finds it and stays
  let state = O.rotateMolecule(m0, 2.4, -1.8);
  for (let i = 0; i < 200; i++) state = O.stepMolecule(state, 0.03, 0);
  assert.ok(
    Math.abs(state.rotation[0] - O.MOLECULE_REST_RX) < 0.02
      && Math.abs(state.rotation[1] - O.MOLECULE_REST_RY) < 0.02,
    "long enough rest pulls the molecule all the way back to the rest pose",
  );
}

// ——— moTransitionEnergy: 1/L² scaling ————————————————————————————————
// Catches: a Planck constant swap, an m→h mix-up, an L in nm treated as
// metres (would be off by 10^18).
{
  const L1 = 1e-9; // 1 nm
  const L2 = 2e-9; // 2 nm
  const dE1 = O.moTransitionEnergy(1, 2, L1);
  const dE2 = O.moTransitionEnergy(1, 2, L2);
  assert.ok(Math.abs(dE2 * 4 - dE1) / dE1 < 1e-9, "double L, quarter ΔE — the 1/L² law");
  // A larger transition (n=1→3 vs 1→2) has larger ΔE.
  const dE12 = O.moTransitionEnergy(1, 2, L1);
  const dE13 = O.moTransitionEnergy(1, 3, L1);
  assert.ok(dE13 > dE12, "n=1→3 is a higher-energy transition than 1→2");
  // A 1 nm box's 1→2 transition sits in the deep UV — several eV.
  assert.ok(dE12 > 0.1 && dE12 < 100, `1 nm box 1→2 lands at a physical energy: ${dE12} eV`);
}

// ——— photonEnergyFromWavelength: hc/λ, and the visible check ————————
// Catches: a wavelength taken in metres or angstroms, an inverse-of-inverse
// bug that lets red light out-energize blue.
{
  const eBlue = O.photonEnergyFromWavelength(450);
  const eRed = O.photonEnergyFromWavelength(650);
  assert.ok(eBlue > eRed, "shorter wavelength → higher energy (E = hc/λ)");
  // 500 nm sits around 2.48 eV in reality.
  const e500 = O.photonEnergyFromWavelength(500);
  assert.ok(Math.abs(e500 - 2.48) < 0.05, `500 nm ≈ 2.48 eV, got ${e500}`);
}

// ——— resonant: fires when hc/λ ≈ ΔE, silent otherwise ————————————
// Catches: a tolerance whose sign got flipped, or a resonance test that
// compares energies in different units.
{
  const L = 1e-9;
  const dE = O.moTransitionEnergy(1, 2, L);
  // Solve for the resonant wavelength: λ = hc/ΔE, in nm.
  const lambdaOnResonance =
    (O.PLANCK_H * O.SPEED_OF_LIGHT) / (dE * O.EV_IN_JOULES) * 1e9;
  assert.ok(O.resonant(lambdaOnResonance, dE, 0.01), "resonant fires at the on-resonance wavelength");
  assert.ok(!O.resonant(lambdaOnResonance * 2, dE, 0.01), "resonant is silent at twice the wavelength");
  // A wide tolerance catches near-neighbors.
  assert.ok(O.resonant(lambdaOnResonance * 1.05, dE, 5), "wide tolerance catches a slight detune");
}

// ——— chromophore photons: fall, then exit the frame ————————————
{
  const photons = [
    { lambda: 260, y: 0.1, born: 0 },
    { lambda: 285, y: 0.98, born: 0 },
  ];
  const next = O.stepChromophorePhotons(photons, 0.05);
  assert.ok(next.length >= 1, "the photon that hasn't fallen keeps going");
  const survivor = next.find((p) => p.lambda === 260);
  assert.ok(survivor && survivor.y > 0.1, "the surviving photon has fallen");
  // A large dt still drops the below-bottom photon.
  const drop = O.stepChromophorePhotons([{ lambda: 400, y: 1.02, born: 0 }], 0.05);
  assert.equal(drop.length, 0, "a photon past y=1 is retired");
}

// ——— chromophoreBoxLength: monotone in spread ————————————————
{
  const short = O.chromophoreBoxLength(0, 800);
  const long = O.chromophoreBoxLength(600, 800);
  assert.ok(long > short, "a longer span opens a wider box");
  assert.ok(short > 0, "even a pinch to zero gives a positive box length");
}

// ——— PIB integration: span-through-L → ΔE monotonically drops ——————
// Catches: a wiring that took spread but never re-computed ΔE, a sign flip
// in chromophoreBoxLength that would make a wider span TIGHTEN the box.
// This is the "the hand feels the n²/L² law" law, in one integration pass.
{
  const framePx = 800;
  const spreads = [40, 120, 240, 400, 600];
  const energies = spreads.map((s) => {
    const L = O.chromophoreBoxLength(s, framePx);
    return O.moTransitionEnergy(1, 2, L);
  });
  for (let i = 1; i < energies.length; i++) {
    assert.ok(
      energies[i] < energies[i - 1],
      `a longer span drops ΔE (spread ${spreads[i - 1]}→${spreads[i]}: ` +
      `${energies[i - 1].toFixed(3)} → ${energies[i].toFixed(3)} eV) — the span IS the dial`,
    );
  }
  // The resonant wavelength walks toward the red as the box widens — the
  // photon-energy formula is E=hc/λ, so lower ΔE ⇒ longer λ.
  const lambdaOnResonance = (dE) =>
    (O.PLANCK_H * O.SPEED_OF_LIGHT) / (dE * O.EV_IN_JOULES) * 1e9;
  const lambdas = energies.map(lambdaOnResonance);
  for (let i = 1; i < lambdas.length; i++) {
    assert.ok(
      lambdas[i] > lambdas[i - 1],
      "widening the span walks the on-resonance wavelength toward the red",
    );
  }
}

// ——— absorb-at-ring: retire resonant photons, pass the off-band ————
// Catches: an absorption law that catches every photon regardless of match
// (a broken resonance check), or one that never fires (a mistuned tolerance).
// This is the whole reason a hand feels the resonance — the photon
// disappears at the ring only when hc/λ matches ΔE.
{
  const L = 1e-9;
  const dE = O.moTransitionEnergy(1, 2, L);
  const lambdaHit = (O.PLANCK_H * O.SPEED_OF_LIGHT) / (dE * O.EV_IN_JOULES) * 1e9;
  // Three photons: one on-resonance at the ring, one off-resonance at the
  // ring, one on-resonance but not at the ring yet.
  const photons = [
    { lambda: lambdaHit, y: O.CHROMOPHORE_RING_Y + 0.02, born: 0 },     // absorbed
    { lambda: lambdaHit * 3, y: O.CHROMOPHORE_RING_Y + 0.02, born: 0 }, // survives (off-band)
    { lambda: lambdaHit, y: 0.2, born: 0 },                             // survives (not yet)
  ];
  const { survivors, absorbed } = O.absorbChromophorePhotonsAtRing(photons, dE, 0.05);
  assert.equal(absorbed.length, 1, "one photon absorbed — the on-resonance one at the ring");
  assert.equal(absorbed[0].lambda, lambdaHit, "the absorbed photon is the resonant one");
  assert.equal(survivors.length, 2, "the off-band photon and the not-yet-at-ring one survive");
  // A photon well past the ring (y > ringY + window) is NOT absorbed — it
  // already crossed without being caught, and cannot be swallowed retroactively.
  const past = [{ lambda: lambdaHit, y: 0.9, born: 0 }];
  const r2 = O.absorbChromophorePhotonsAtRing(past, dE, 0.05);
  assert.equal(r2.absorbed.length, 0, "a photon that already fell past the ring is not absorbed");
  assert.equal(r2.survivors.length, 1, "and stays in flight");
  // No photons in, no absorbed out.
  const empty = O.absorbChromophorePhotonsAtRing([], dE, 0.05);
  assert.equal(empty.absorbed.length, 0, "empty in, empty out");
  assert.equal(empty.survivors.length, 0, "empty survivors on empty input");
}

// ——— walkBackFromZoom: one hard altitude per step, monotone descent ——
// Catches: a step-back that skips or doubles an altitude, or hangs on the
// widest one instead of releasing to the manifold.
{
  // From deep chromophore, land at the widest edge of molecule.
  assert.equal(O.walkBackFromZoom(3000), O.ALTITUDE_BOUNDS.molecule.lo,
    "from chromophore, step back to molecule.lo (1024)");
  assert.equal(O.walkBackFromZoom(4000), O.ALTITUDE_BOUNDS.molecule.lo,
    "from anywhere inside chromophore, step back is molecule.lo");
  // From molecule, land at solution's widest.
  assert.equal(O.walkBackFromZoom(1500), O.ALTITUDE_BOUNDS.solution.lo,
    "from molecule, step back to solution.lo (16)");
  // From solution, land at crystal's widest.
  assert.equal(O.walkBackFromZoom(64), O.ALTITUDE_BOUNDS.crystal.lo,
    "from solution, step back to crystal.lo (1)");
  // From crystal (the widest hard altitude), release toward the /drop band wall.
  assert.equal(O.walkBackFromZoom(1.2), O.OBSERVE_ZOOM_SPEC.zoomMin,
    "from crystal, step back releases at the widest end of the /drop band");
  // From transition bands, land at the outgoing hard altitude — never
  // half-a-step, never sideways.
  assert.equal(O.walkBackFromZoom(6), O.ALTITUDE_BOUNDS.crystal.lo,
    "dissolve transition steps back to crystal");
  assert.equal(O.walkBackFromZoom(600), O.ALTITUDE_BOUNDS.solution.lo,
    "moleculeZoom transition steps back to solution");
  // Repeated step-backs walk the visitor all the way to the manifold wall.
  let z = 3200;
  const trail = [z];
  for (let i = 0; i < 6; i++) {
    z = O.walkBackFromZoom(z);
    trail.push(z);
    if (z === O.OBSERVE_ZOOM_SPEC.zoomMin) break;
  }
  assert.equal(trail[trail.length - 1], O.OBSERVE_ZOOM_SPEC.zoomMin,
    `four taps walk from chromophore to the widest edge: ${trail.join(" → ")}`);
  // The sequence is strictly non-increasing.
  for (let i = 1; i < trail.length; i++) {
    assert.ok(trail[i] <= trail[i - 1], "step-back never zooms IN");
  }
}

console.log("observe: ok");
