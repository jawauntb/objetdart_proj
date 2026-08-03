// The /atmosphere laws. Every assertion names the bug it catches; the
// calibration case (the /organelles lesson) is the standard atmosphere
// itself: 22.632 kPa at 11 km and 1.225 kg/m³ at the ground are numbers a
// person can check against a book, so a unit slip in the exponent (K/km
// where K/m belonged — the classic) cannot hide behind plausible curves.

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
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  });
  return module.exports;
}

const A = loadTsModule("src/lib/aircolumn.ts");

const near = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} (got ${a}, want ~${b})`);

// —— the column against the book ————————————————————————————————
// Bug caught: a wrong barometric exponent or a lapse-rate unit slip. Both
// produce smooth, plausible skies — only the published standard-atmosphere
// values can tell on them.
near(A.pressureKPa(0), 101.325, 1e-9, "sea level reads the sea-level pressure");
near(A.pressureKPa(11), 22.632, 0.01, "the tropopause carries the book's 22.632 kPa");
near(A.densityKgM3(0), 1.225, 0.005, "sea-level air weighs the book's 1.225 kg/m³");
near(A.tropopauseKm(6.5), 11.0, 0.001, "the standard lapse puts the tropopause at 11 km");
// The exponent itself, hand-computed: 9.80665·0.0289644 / (8.31446·0.0065).
near(A.barometricExponent(6.5), 5.2559, 0.001, "gM/RL, and not gM/RL with L in the wrong unit");
// Pressure is monotone down the column — an inversion here would mean the
// piecewise join at the tropopause is stitched backwards.
{
  let prev = Infinity;
  for (let z = 0; z <= 90; z += 0.5) {
    const p = A.pressureKPa(z);
    assert.ok(p < prev, `pressure falls through ${z} km`);
    prev = p;
  }
}

// —— the barometer IS the column's weight ————————————————————————
// Bug caught: a wrong antiderivative. The whole column of relative density
// must integrate to P0/(ρ0·g) — sea-level pressure is nothing but the
// weight of the air above it, and the closed form has to agree.
{
  const expected = (A.P0_KPA * 1000) / (A.RHO0 * A.G_MS2) / 1000; // km
  near(A.columnKm(0, 500), expected, 0.005, "the full column weighs what the barometer says");
}
// ...and against blunt numerical quadrature, including straddling the
// tropopause and off-standard lapse rates, so neither piece nor the join
// can be wrong on its own.
for (const [z0, z1, lapse] of [
  [0, 5, 6.5],
  [2, 30, 6.5],
  [0, 80, 4.2],
  [9, 13, 8.5],
  [15, 60, 6.5],
]) {
  let num = 0;
  const N = 20000;
  const dz = (z1 - z0) / N;
  for (let i = 0; i < N; i++) num += A.relDensity(z0 + (i + 0.5) * dz, lapse) * dz;
  near(
    A.columnKm(z0, z1, lapse),
    num,
    0.002,
    `closed-form column agrees with quadrature over ${z0}–${z1} km at lapse ${lapse}`,
  );
}

// —— the profile inverts ————————————————————————————————————————
// Bug caught: a broken inverse. If altitudeForPressure does not round-trip,
// the room's central claim — that the sky's reading can be taken back to
// the column — is false, and the isobar lens lies about where the air is.
for (const lapse of [4.0, 6.5, 9.0]) {
  for (const z of [0, 1.3, 7, 11, 12, 25, 60]) {
    near(
      A.altitudeForPressure(A.pressureKPa(z, lapse), lapse),
      Math.max(1e-9, z),
      z === 0 ? Infinity : 1e-6,
      `altitude ${z} km survives the trip through pressure and back (lapse ${lapse})`,
    );
  }
  assert.ok(
    Math.abs(A.altitudeForPressure(A.pressureKPa(0, lapse), lapse)) < 1e-9,
    "the ground names the ground",
  );
}

// —— optical depth behaves like a depth ———————————————————————————
// Bug caught: a path integral that shrinks as the path grows, or one that
// overflows into NaN and paints the sky black.
{
  let prev = 0;
  for (const d of [0, 1, 5, 20, 80, 200, 1000]) {
    const t = A.opticalDepthRGB(2, 0.00001, d)[2];
    assert.ok(t >= prev, `optical depth never falls as the path runs to ${d} km`);
    assert.ok(Number.isFinite(t) && t <= A.TAU_MAX, "…and never past the cap into NaN");
    prev = t;
  }
  for (const [z, dirY, d] of [
    [0, 1, 1e6],
    [0, -1, 1e6],
    [50, 0.0000001, 1e9],
    [120, 0.3, 500],
  ]) {
    const tr = A.transmittanceRGB(z, dirY, d);
    for (const c of tr) {
      assert.ok(c > 0 && c <= 1 && Number.isFinite(c), "transmittance stays in (0,1]");
    }
  }
}

// —— blue for the right reason ——————————————————————————————————
// Bug caught: a palette pretending to be physics. The channel extinctions
// must order strictly by λ⁻⁴, the zenith under a high sun must scatter
// blue over green over red, and the low sun's DIRECT light must come
// through red over green over blue — all three from the same constants.
assert.ok(
  A.BETA_R[2] > A.BETA_R[1] && A.BETA_R[1] > A.BETA_R[0],
  "extinction is monotone in wavelength: blue scatters most",
);
near(A.BETA_R[2] / A.BETA_R[1], Math.pow(550 / 440, 4), 1e-9, "…and by exactly λ⁻⁴");
{
  const zen = A.skyColor(0, 0.999, 0.2, 1.1, 6.5, 0.4).rgb;
  assert.ok(zen[2] > zen[1] && zen[1] > zen[0], "a high-sun zenith is blue over green over red");
  const setSun = A.sunTransmitRGB(0, 0.01);
  assert.ok(setSun[0] > setSun[1] && setSun[1] > setSun[2], "a setting sun survives red first");
  const noonSun = A.sunTransmitRGB(0, 1.2);
  assert.ok(
    setSun[2] / setSun[0] < noonSun[2] / noonSun[0],
    "the low path reddens against the high one — sunset is subtraction, not paint",
  );
  // More column, more scatter: the horizon outshines the zenith in green.
  const hor = A.skyColor(0, 0.001, 0.2, 1.1, 6.5, 0.4).rgb;
  assert.ok(hor[1] > zen[1], "the long horizon path out-scatters the short zenith path");
  // No air, no sky: radiance vanishes with the column, so the colour is a
  // reading of the air and not a backdrop.
  const thin = A.skyColor(95, 0.9, 0.2, 1.1, 6.5, 0).rgb;
  assert.ok(thin[2] < zen[2] * 0.02, "where the column is gone the sky goes dark");
}

// —— the scatter keeps its budget ————————————————————————————————
// Bug caught: an adaptive loop creeping past the stated cost.
for (const [z, dirY] of [[0, 0.9], [8, -0.4], [8, 0.0000001], [99.9, 1], [30, -1]]) {
  const s = A.skyColor(z, dirY, 0.5, 0.4);
  assert.ok(s.steps <= A.SCATTER_STEPS, `the scatter spends ≤ ${A.SCATTER_STEPS} steps`);
  for (const c of s.rgb) assert.ok(Number.isFinite(c) && c >= 0, "…and stays finite");
}

// —— stirring conserves ————————————————————————————————————————
// Bug caught: a "disturbance" that secretly pushes the whole column — the
// hand may shear layers against each other but never add net momentum.
{
  const rngAmps = [[0.4, -0.2, 0.13, 0.5, -0.31, 0.07], A.stirImpulse(3.2, 0.8), A.stirImpulse(19, -1)];
  for (const amps of rngAmps) {
    let integral = 0;
    const N = 40000;
    const dz = A.TOP_KM / N;
    for (let i = 0; i < N; i++) integral += A.perturbationAt((i + 0.5) * dz, amps) * dz;
    assert.ok(
      Math.abs(integral) < 1e-6 * A.TOP_KM,
      `the column's net momentum stays zero (got ${integral})`,
    );
  }
  // ...and the stir is not a no-op: at the stirred altitude the wind moves
  // with the finger, in the finger's direction.
  const before = A.windAt(3.2, []);
  const after = A.windAt(3.2, A.stirImpulse(3.2, 0.8));
  assert.ok(after > before, "a forward stir carries its own layer forward");
  const afterBack = A.windAt(19, A.stirImpulse(19, -1));
  assert.ok(afterBack < A.windAt(19, []), "and a backward stir carries it back");
}

// —— the shear is the wind's true derivative ——————————————————————
// Bug caught: an analytic shear disagreeing with the wind it claims to
// differentiate — invisible until every streak is stretched wrong.
{
  const amps = A.stirImpulse(6, 0.7);
  const h = 1e-4;
  for (const z of [0.5, 3, 6, 9.5, 14, 30, 70]) {
    const fd = (A.windAt(z + h, amps) - A.windAt(z - h, amps)) / (2 * h);
    const an = A.shearAt(z, amps);
    assert.ok(
      Math.abs(fd - an) < 1e-3 * Math.max(1, Math.abs(fd)),
      `analytic shear matches finite difference at ${z} km (${an} vs ${fd})`,
    );
  }
}

// —— the jet stands where the law puts it ————————————————————————
// Bug caught: a wind decoupled from the lapse law. The three-finger law
// moves the tropopause; the jet must move with it or the "world-law" is
// scenery.
for (const lapse of [4.5, 6.5, 9.0]) {
  const zt = A.tropopauseKm(lapse);
  assert.ok(A.baseWind(zt, lapse) > A.baseWind(0, lapse), "the jet outruns the surface drift");
  assert.ok(
    A.baseWind(zt, lapse) > A.baseWind(zt + 25, lapse),
    "…and the air above it goes quiet",
  );
  const below = A.baseWind(zt - 3, lapse);
  const at = A.baseWind(zt, lapse);
  assert.ok(at >= below, `the jet crests at the tropopause the lapse ${lapse} builds`);
}

// —— pressure as register, invertible ————————————————————————————
// Bug caught: a sound map that cannot be read back, or one that inverts —
// deep ground, high sky is the room's covenant.
{
  for (const midi of [A.MIDI_GROUND, 48, 60, 71, A.MIDI_TOP]) {
    near(A.midiForPressure(A.pressureForMidi(midi)), midi, 1e-9, `midi ${midi} round-trips`);
  }
  let prev = -Infinity;
  for (const z of [0, 2, 8, 16, 40, 80]) {
    const m = A.midiForPressure(A.pressureKPa(z));
    assert.ok(m > prev, "higher air always sounds higher");
    prev = m;
  }
  near(A.midiForPressure(A.P0_KPA), A.MIDI_GROUND, 1e-9, "the ground sounds the ground note");
}

// —— the banks are seeded, bounded, ordered ——————————————————————
// Bug caught: Math.random smuggled into the sky (two visits, two skies),
// or a bank floating above where aerosols can be.
{
  const a = A.hazeBankAltitudes(0x0a72);
  const b = A.hazeBankAltitudes(0x0a72);
  assert.deepEqual(a, b, "the same seed lays the same banks");
  assert.notDeepEqual(a, A.hazeBankAltitudes(0x0a73), "a different seed is a different sky");
  assert.equal(a.length, A.HAZE_BANKS);
  for (let i = 0; i < a.length; i++) {
    assert.ok(a[i] >= 0 && a[i] <= A.BANK_CEIL_KM, "banks stay below the aerosol ceiling");
    if (i > 0) assert.ok(a[i] >= a[i - 1], "…in ascending order");
  }
}

// —— the isobar lens crowds toward the ground ————————————————————
// Bug caught: a lens drawn on a linear ruler. Equal pressure steps must
// pack tighter near the ground than aloft — that crowding IS the
// exponential law made visible; if it ever reverses, the lens is lying.
{
  const zs = A.ISOBARS_KPA.map((p) => A.altitudeForPressure(p));
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] > zs[i - 1], "lower pressure sits higher");
  const firstGap = zs[1] - zs[0];
  const lastGap = zs[zs.length - 1] - zs[zs.length - 2];
  assert.ok(lastGap > firstGap * 2, "equal pressure steps stretch apart with altitude");
}

// —— the moisture, against the book ——————————————————————————————
// Bug caught: a Tetens curve with the wrong sign or a Celsius/Kelvin slip.
// Saturation vapour pressure at 0 °C is 0.611 kPa and at 30 °C is 4.24 kPa;
// both are table values, and no plausible cloud can hide a factor of ten.
near(A.saturationVaporKPa(273.15), 0.6108, 0.005, "es at 0 °C is the book's 0.611 kPa");
near(A.saturationVaporKPa(303.15), 4.242, 0.01, "es at 30 °C is the book's 4.24 kPa");
near(A.saturationVaporKPa(293.15), 2.338, 0.01, "es at 20 °C is the book's 2.34 kPa");
{
  let prev = 0;
  for (let T = 220; T <= 320; T += 5) {
    const e = A.saturationVaporKPa(T);
    assert.ok(e > prev, `warmer air always holds more vapour (at ${T} K)`);
    prev = e;
  }
  // The dew point inverts the mixing ratio, and saturated air's dew point IS
  // its temperature. Bug caught: a lens that names the wrong cloud base.
  for (const [p, T] of [[101.325, 288.15], [70, 275], [50, 258]]) {
    const ws = A.satMixingRatio(p, T);
    near(A.dewPointK(p, ws), T, 1e-4, `saturated air dews at its own temperature (${p} kPa)`);
    assert.ok(A.dewPointK(p, ws * 0.5) < T, "…and drier air dews colder");
  }
}

// —— the two adiabats ——————————————————————————————————————————
// Bug caught: a moist adiabat that is not gentler than the dry one (then
// latent heat is doing nothing and every cloud the room makes is a lie),
// or one that never relaxes back to it where there is no vapour left.
near(A.LAPSE_DRY, 9.76, 0.01, "the dry adiabat is g/cp, ~9.8 K/km");
{
  for (const [T, p] of [[300, 101], [288, 101], [273, 90], [250, 60]]) {
    const m = A.moistLapseKKm(T, p);
    assert.ok(m < A.LAPSE_DRY, `the moist adiabat is gentler than the dry one at ${T} K`);
    assert.ok(m > 0, "…and still cools upward");
  }
  assert.ok(
    A.moistLapseKKm(300, 101) < A.moistLapseKKm(273, 101),
    "warm saturated air cools slowest — more vapour, more latent heat",
  );
  // …and where there is nothing left to condense the two become one law:
  // the gap must close monotonically as the air gets colder and thinner.
  {
    let prevGap = Infinity;
    for (const [T, p] of [[290, 90], [270, 70], [250, 50], [230, 25], [210, 10], [190, 3]]) {
      const gap = A.LAPSE_DRY - A.moistLapseKKm(T, p);
      assert.ok(gap > 0 && gap < prevGap, `the moist adiabat closes on the dry one by ${T} K`);
      prevGap = gap;
    }
    assert.ok(prevGap < 0.01 * A.LAPSE_DRY, "and at the top of the column they agree to 1%");
  }
}

// —— cloud base is computed, not chosen ————————————————————————————
// Bug caught: an LCL that ignores humidity (then the room's moisture law is
// scenery), that sits below the release altitude (impossible — lifting is
// what cools it), or an unbounded search.
{
  const sat = A.liftToCondensation(0.4, 1.0);
  near(sat.lclKm, 0.4, 1e-9, "saturated air condenses in the hand that lifted it");
  let prev = -1;
  for (const rh of [0.95, 0.8, 0.6, 0.4, 0.2]) {
    const r = A.liftToCondensation(0.4, rh);
    assert.ok(r.lclKm >= 0.4, "cloud base is never below the parcel that made it");
    assert.ok(r.lclKm > prev, `drier air lifts its cloud base higher (rh ${rh})`);
    assert.ok(r.steps <= A.LCL_STEPS, "…inside the stated bisection budget");
    prev = r.lclKm;
    // At the level it names, the parcel really is saturated: the lifted
    // temperature's saturation mixing ratio meets the conserved one.
    const T0 = A.temperatureK(0.4);
    const Tl = T0 - A.LAPSE_DRY * (r.lclKm - 0.4);
    near(
      A.satMixingRatio(A.pressureKPa(r.lclKm), Tl),
      r.w,
      2e-3,
      `the named level is where the parcel actually saturates (rh ${rh})`,
    );
  }
  // Espy's rule of thumb: base ≈ 125 m per °C of dew-point depression. A
  // wildly different slope means the thermodynamics drifted.
  const r = A.liftToCondensation(0, 0.5);
  const T0 = A.T0_K;
  const td = A.dewPointK(A.P0_KPA, r.w);
  const espy = (T0 - td) * 0.125;
  near(r.lclKm, espy, 0.2, "cloud base tracks Espy's 125 m per degree of dew-point depression");
}

// —— the column's stability sets how tall a cloud can grow ——————————
// Bug caught: a cloud top that is decoration. The three-finger law steepens
// the environmental lapse rate; a steeper column is less stable, so both
// the parcel's vigour and its ceiling MUST answer. If they do not, the
// world-law is not touching the objects and the room is a picture.
{
  const WARM = 3.5; // the ground's heat, as a long press gives it
  let prevB = -1;
  let prevDepth = -1;
  for (const lapse of [6.5, 7.0, 7.5, 8.0, 8.6, 9.4]) {
    const a = A.liftParcel(0.4, 0.75, lapse, WARM);
    assert.ok(a.elKm >= a.lclKm, "a cloud's top is never below its base");
    assert.ok(a.steps <= A.ASCENT_STEPS, "the ascent keeps its stated budget");
    assert.ok(a.lfcKm !== null && a.lfcKm >= a.lclKm, "free convection begins at or above cloud base");
    assert.ok(a.peakBuoyancy > prevB, `a steeper column convects harder (lapse ${lapse})`);
    assert.ok(a.elKm - a.lclKm >= prevDepth, `…and never shallower (lapse ${lapse})`);
    prevB = a.peakBuoyancy;
    prevDepth = a.elKm - a.lclKm;
  }
  assert.ok(
    A.liftParcel(0.4, 0.75, 8.6, WARM).elKm - A.liftParcel(0.4, 0.75, 8.6, WARM).lclKm >
      A.liftParcel(0.4, 0.75, 6.5, WARM).elKm - A.liftParcel(0.4, 0.75, 6.5, WARM).lclKm,
    "an unstable column builds a visibly deeper cloud than a standard one",
  );
  // A stable column gives a parcel nowhere to go at all: no level of free
  // convection, no positive buoyancy, top pinned to base.
  const stable = A.liftParcel(0.4, 0.75, A.LAPSE_MIN, WARM);
  assert.equal(stable.lfcKm, null, "a near-isothermal column never lets a parcel go");
  assert.ok(stable.peakBuoyancy === 0, "…so nothing convects in it");
  assert.equal(stable.elKm, stable.lclKm, "…and the cloud has no depth to give");

  // —— and how long the press was held is the other half of the law ——
  // A warmed parcel carries no extra vapour, so its cloud base RISES; but
  // it starts ahead of the column, so it goes free sooner and climbs
  // higher. Both must move, in opposite directions, or "hold longer" is a
  // number that does nothing.
  let prevLcl = -1;
  let prevTop = -1;
  let prevWarmB = -1;
  for (const dT of [1, 2, 3, 4, 6]) {
    const a = A.liftParcel(0.4, 0.75, 6.5, dT);
    assert.ok(a.lclKm > prevLcl, `a warmer parcel hangs its cloud base higher (+${dT} K)`);
    assert.ok(a.elKm > prevTop, `…and reaches higher (+${dT} K)`);
    assert.ok(a.peakBuoyancy > prevWarmB, `…with more vigour (+${dT} K)`);
    prevLcl = a.lclKm;
    prevTop = a.elKm;
    prevWarmB = a.peakBuoyancy;
  }
  assert.equal(
    A.liftParcel(0.4, 0.75, 6.5, 0).lfcKm,
    null,
    "and an unwarmed parcel in the standard column stays a puff — the press is what lifts it",
  );

  // Below the condensation level the parcel is always heavy: it cools at
  // 9.8 while the column only cools at its lapse rate. Sign errors here
  // would make every press launch a rocket.
  const mid = A.liftToCondensation(0.4, 0.6).lclKm * 0.5 + 0.2;
  assert.ok(
    A.temperatureK(0.4) - A.LAPSE_DRY * (mid - 0.4) < A.temperatureK(mid),
    "a dry-lifted parcel is colder than the air it is climbing through",
  );
}

// —— merging conserves ——————————————————————————————————————————
// Bug caught: clouds that gain mass by touching (the sky would run away),
// or a merged centre outside the two it came from.
{
  const mk = (id, xKm, zKm, mass, spin, w, born) => ({
    id, xKm, zKm, lclKm: 1.2, elKm: 6, mass, spin, w, seed: id, born,
  });
  const a = mk(1, 10, 4, 0.8, 0.4, 0.02, 100);
  const b = mk(2, 13, 5, 0.3, -0.9, -0.01, 300);
  const m = A.mergeParcels(a, b);
  near(m.mass, a.mass + b.mass, 1e-12, "mass adds exactly");
  assert.ok(m.xKm > Math.min(a.xKm, b.xKm) && m.xKm < Math.max(a.xKm, b.xKm), "…centre between them");
  assert.ok(m.xKm < (a.xKm + b.xKm) / 2, "…and pulled toward the heavier one");
  near(m.spin * m.mass, a.spin * a.mass + b.spin * b.mass, 1e-12, "angular momentum is carried, not invented");
  near(m.w * m.mass, a.w * a.mass + b.w * b.mass, 1e-12, "vertical momentum likewise");
  assert.ok(m.elKm >= a.elKm && m.elKm >= b.elKm, "the merged cloud reaches at least as high");
  assert.ok(m.born === Math.min(a.born, b.born), "the elder cloud's identity survives");
  assert.ok(
    A.parcelRadiusKm(m.mass) > A.parcelRadiusKm(a.mass) &&
      A.parcelRadiusKm(m.mass) < A.parcelRadiusKm(a.mass) + A.parcelRadiusKm(b.mass),
    "radius grows as the cube root: bigger than either, smaller than the sum",
  );
  // Touching is symmetric and honest about the radii it claims.
  const far = mk(3, 60, 4, 0.8, 0, 0, 0);
  assert.ok(A.parcelsTouch(a, b) === A.parcelsTouch(b, a), "touching is symmetric");
  assert.ok(!A.parcelsTouch(a, far), "…and distant clouds do not merge");
}

// —— dissipation has the right shape ————————————————————————————
// Bug caught: big clouds dying faster than small ones (entrainment works at
// the surface, so it must be the other way), or shear that does not tear.
{
  assert.ok(
    A.dissipationRate(0.2, 0, 0.7) > A.dissipationRate(3.0, 0, 0.7),
    "small clouds evaporate faster — entrainment is a surface effect",
  );
  assert.ok(
    A.dissipationRate(1, 0, 0.2) > A.dissipationRate(1, 0, 0.95),
    "dry air eats clouds faster than moist air",
  );
  assert.ok(
    A.dissipationRate(1, 0.5, 0.7) > A.dissipationRate(1, 0, 0.7),
    "shear tears a cloud apart",
  );
  for (const [m, s, rh] of [[0.06, 0, 1], [8, 3, 0], [1, -2, 0.5]]) {
    assert.ok(A.dissipationRate(m, s, rh) > 0, "…and nothing is immortal");
  }
}

console.log(
  "aircolumn ok: the column carries the book's numbers and its own weight, the closed form matches quadrature across the tropopause, the profile and the register both invert, the sky is blue by λ⁻⁴ and dark without air, the scatter keeps its budget, stirring conserves momentum while the shear stays the wind's true derivative, the jet follows the lapse law, saturation follows Tetens and the moist adiabat stays under the dry one, cloud base is Espy's own number, a steeper column grows taller clouds, and merging conserves mass and momentum",
);
