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
  MAX_A,
  MAX_NUCLEI,
  bindingEnergy,
  bindingPerNucleon,
  mostStableZ,
  decayMode,
  betaMinusQ,
  betaPlusQ,
  alphaQ,
  fissility,
  fissionSplit,
  canFission,
  fissionMagnitude,
  coulombBarrier,
  captureQ,
  nuclideFromSeed,
  packOffsets,
  settlePopulation,
  symbolFor,
} = loadTsModule("src/lib/nucleons.ts");

// — The curve peaks at iron. This is the one fact the whole axis hinges on:
//   /atoms hits this wall from below by fusing, /nucleons climbs past it by
//   capturing. If the SEMF coefficients ever drift, the peak moves and both
//   rooms start lying.
let peakA = 0;
let peakB = -Infinity;
for (let a = 2; a <= MAX_A; a++) {
  const z = mostStableZ(a);
  const b = bindingPerNucleon(z, a - z);
  if (b > peakB) {
    peakB = b;
    peakA = a;
  }
}
assert.ok(peakA >= 52 && peakA <= 64, `binding peaks at the iron group (got A=${peakA})`);
assert.ok(peakB > 8.3 && peakB < 9.1, `peak binding ≈ 8.8 MeV/nucleon (got ${peakB.toFixed(2)})`);

// — The valley bottoms out at uranium for A = 238. Nothing places U-238 by
//   hand; it is where the energy is lowest, which is the room's whole claim.
assert.equal(mostStableZ(238), 92, "the valley floor at A=238 is uranium");
assert.equal(mostStableZ(56), 26, "the valley floor at A=56 is iron");
assert.equal(mostStableZ(4), 2, "the valley floor at A=4 is helium");

// — Heavy nuclei are neutron-rich: Z/A falls monotonically as A climbs. A bug
//   that dropped the asymmetry or Coulomb term would flatten this to 1/2.
const zFrac = (a) => mostStableZ(a) / a;
assert.ok(zFrac(20) > zFrac(120), "neutron excess grows with mass");
assert.ok(zFrac(120) > zFrac(238), "and keeps growing into the actinides");
assert.ok(Math.abs(zFrac(16) - 0.5) < 0.03, "light nuclei sit near Z = N");
assert.ok(zFrac(238) < 0.41, "uranium is deeply neutron-rich");

// — Off the valley floor, the betas point back toward it. This is the rule
//   the room's decay animation is derived from; if it inverted, nuclei would
//   walk away from stability forever.
// Odd A, where the pairing term vanishes and the isobar landscape is a single
// clean parabola — the case where "off the floor" and "unstable" must agree.
// (Above A ≈ 150 the alpha channel starts outbidding the beta on the
// proton-rich side, which is the actinide habit and is asserted separately.)
for (const a of [91, 121, 141]) {
  const z0 = mostStableZ(a);
  assert.equal(decayMode(z0 - 2, a - z0 + 2), "beta-minus", `neutron-rich A=${a} betas down`);
  assert.equal(decayMode(z0 + 2, a - z0 - 2), "beta-plus", `proton-rich A=${a} betas up`);
  assert.ok(betaMinusQ(z0 - 2, a - z0 + 2) > 0, "and the β⁻ actually pays");
  assert.ok(betaPlusQ(z0 + 2, a - z0 - 2) > 0, "and the β⁺ actually pays");
  assert.equal(decayMode(z0, a - z0), "stable", `the odd-A floor at A=${a} sits still`);
}

// Even A, where pairing splits the isobars into two parabolas: an even-even
// nuclide two steps off the floor can still be stable, because reaching its
// odd-odd neighbor costs the full pairing swing. Same rule, richer landscape —
// the reason the room has more than one stable island per mass.
assert.equal(decayMode(60, 80), "stable", "an even-even isobar two steps off holds");
assert.equal(decayMode(57, 83), "beta-minus", "its odd-odd neighbors do not");
assert.equal(decayMode(26, 30), "stable", "iron-56 sits still");

// — The actinides shed alphas and the very heavy ones come apart on their own.
assert.equal(decayMode(92, 146), "alpha", "uranium-238 alpha-decays");
assert.ok(alphaQ(92, 146) > 0, "and the alpha pays");
assert.ok(fissility(92, 146) < 1, "uranium is strained but still holds");
assert.equal(decayMode(108, 152), "fission", "past the strain limit the drop splits itself");
assert.ok(fissility(108, 152) > 1 - 0.12, "and it is genuinely past the strain limit");
assert.ok(fissility(26, 30) < 0.3, "iron is nowhere near the strain limit");

// — The Coulomb barrier is the difference between the room's two hands: a
//   neutron feels nothing, a proton feels more with every proton already home.
assert.equal(coulombBarrier(92, 146, 0), 0, "a neutron walks in free");
assert.ok(coulombBarrier(2, 2, 1) > 0, "a proton always has a wall to climb");
let prevBarrier = -1;
for (let a = 4; a <= 240; a += 8) {
  const z = mostStableZ(a);
  const bar = coulombBarrier(z, a - z, 1);
  assert.ok(bar > prevBarrier, `the proton barrier climbs with Z (A=${a})`);
  prevBarrier = bar;
}
assert.ok(
  coulombBarrier(92, 146, 2) > coulombBarrier(92, 146, 1),
  "and a heavier projectile has to climb further",
);

// — Capture pays below iron and keeps paying as neutrons (the free lunch of
//   the r-process); it refuses past the mass ceiling rather than running away.
assert.ok(captureQ(26, 30, 0) > 0, "iron still takes a neutron");
assert.ok(captureQ(92, 146, 0) > 0, "so does uranium");
assert.equal(captureQ(130, 130, 0), -Infinity, "past the ceiling nothing is absorbed");
assert.ok(
  captureQ(8, 8, 0) > captureQ(8, 8, 1),
  "a neutron binds better than a proton to a matched drop",
);

// — Fission conserves nucleons exactly, is deterministic, and is asymmetric.
for (const [z, n, seed] of [[92, 144, 7], [94, 145, 11], [90, 142, 3]]) {
  const s = fissionSplit(z, n, seed);
  assert.equal(s.a.z + s.b.z, z, "protons conserved");
  assert.equal(s.a.n + s.b.n + s.neutrons, n, "neutrons conserved");
  assert.ok(s.neutrons >= 1 && s.neutrons <= 3, `prompt neutrons in range (${s.neutrons})`);
  const aLight = s.a.z + s.a.n;
  const aHeavy = s.b.z + s.b.n;
  assert.ok(Math.abs(aLight - aHeavy) > 8, `the split is asymmetric (${aLight}/${aHeavy})`);
  const again = fissionSplit(z, n, seed);
  assert.deepEqual(again, s, "same nucleus and seed split the same way");
}

// — Splitting pays for actinides and costs for everything light: the reason
//   fission is one end of the curve and fusion the other.
assert.ok(fissionSplit(92, 144, 5).q > 120, "uranium fission releases ~200 MeV");
assert.equal(canFission(26, 30), false, "iron does not come apart at a profit");
assert.equal(canFission(92, 144), true, "uranium does");
assert.equal(fissionMagnitude(-40), 0, "an endothermic split does not bloom");
assert.ok(
  fissionMagnitude(200) > fissionMagnitude(80) && fissionMagnitude(200) < 1,
  "violence is monotone in energy and bounded",
);

// — Fission fragments land neutron-rich, which is why they keep glowing.
const frag = fissionSplit(92, 144, 9);
assert.equal(decayMode(frag.a.z, frag.a.n), "beta-minus", "the light fragment still decays");
assert.equal(decayMode(frag.b.z, frag.b.n), "beta-minus", "so does the heavy one");

// — Seeded drops are deterministic, valley-bound, and light.
for (let i = 0; i < 200; i++) {
  const nuc = nuclideFromSeed(i * 2654435761);
  const a = nuc.z + nuc.n;
  assert.equal(nuc.z, mostStableZ(a), "a seeded drop sits on the valley floor");
  assert.ok(a >= 2 && a <= 56, `starters stay light (A=${a})`);
  assert.deepEqual(nuclideFromSeed(i * 2654435761), nuc, "same seed, same drop");
}

// — Packing is deterministic, sized to A, and stays inside the drop.
const pack = packOffsets(56, 3);
assert.equal(pack.length, 56, "one site per nucleon");
assert.deepEqual(packOffsets(56, 3), pack, "same A and seed, same packing");
for (const p of pack) {
  assert.ok(Math.hypot(p.x, p.y) <= 1.08, "nucleons stay within the drop's skin");
}

// — Population settles oldest-first and never drops the newcomer.
const { kept, retired } = settlePopulation([1, 2, 3, 4, 5, 6, 7, 8], MAX_NUCLEI);
assert.equal(kept.length, MAX_NUCLEI);
assert.deepEqual(retired, [1, 2]);
assert.equal(kept[kept.length - 1], 8, "the newest is always kept");

assert.equal(symbolFor(0), "n");
assert.equal(symbolFor(92), "U");
assert.equal(symbolFor(26), "Fe");
assert.equal(bindingEnergy(1, 0), 0, "a lone proton binds to nothing");
assert.equal(bindingEnergy(0, 1), 0, "nor does a lone neutron");

console.log("nucleons: ok");
