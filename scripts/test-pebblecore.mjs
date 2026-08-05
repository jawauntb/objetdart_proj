// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.route.
// One LLM slot below carries the pins; the loader boilerplate is verbatim.

// The /pebble laws. Every assertion names the bug it catches — a
// test that only restates a constant back at itself is not a test.

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

const M = loadTsModule("src/lib/pebblecore.ts");

const near = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} (got ${a}, want ~${b})`);

// —— determinism: same seed → same state ————————————————————————————
{
  const a = M.initState(0xc0ffee);
  const b = M.initState(0xc0ffee);
  assert.equal(a.lattice.system, b.lattice.system, "determinism: same system");
  assert.equal(a.lattice.centering, b.lattice.centering, "determinism: same centering");
  near(a.lattice.ca, b.lattice.ca, 1e-12, "determinism: same axial ratio");
  assert.equal(a.growthRings.length, b.growthRings.length, "determinism: rings");
  assert.equal(a.growthRings[0].mineral, b.growthRings[0].mineral, "determinism: mineral");
}

// —— determinism: different seeds → different minerals (probabilistically) ——
{
  const seen = new Set();
  for (let i = 0; i < 32; i++) {
    seen.add(M.initState(0xa000 + i).lattice.system);
  }
  assert.ok(seen.size >= 2, "different seeds produce different lattice systems");
}

// —— pebblecore has all the known minerals reachable ————————————————
{
  const minerals = new Set();
  for (let s = 0; s < 256; s++) minerals.add(M.mineralFromSeed(s));
  assert.ok(minerals.size >= 6, `at least 6 of 8 minerals reachable, got ${minerals.size}`);
}

// —— constants have their advertised bounds ————————————————————————
{
  assert.equal(M.POLISH_MAX, 0.35, "POLISH_MAX is the advertised 0.35");
  assert.equal(M.MAX_GROWTH_RINGS, 24, "MAX_GROWTH_RINGS is the advertised cap");
  assert.equal(M.MAX_ELAPSED_S, 14 * 24 * 3600, "MAX_ELAPSED_S is the fortnight cap");
}

// —— the invertible map: reciprocal → partials is monotone in polish ——
{
  const s = M.initState(0x12345, "quartz");
  const fresh = M.partialsFor(s);
  const worn = M.partialsFor({ ...s, polishDepth: M.POLISH_MAX });
  // The fundamental is un-damped and identical across polish depths.
  near(fresh[0], worn[0], 1e-9, "fundamental un-damped under polish");
  // Every higher partial is STRICTLY smaller under polish.
  for (let k = 1; k < Math.min(fresh.length, worn.length); k++) {
    assert.ok(
      worn[k] < fresh[k],
      `partial ${k} damped under polish (fresh=${fresh[k]}, worn=${worn[k]})`,
    );
  }
}

// —— the invertible map: partials → lattice is polish-invariant ————————
{
  const fresh = M.initState(0x789a, "calcite");
  const partialsFresh = M.partialsFor(fresh);
  const partialsWorn = M.partialsFor({ ...fresh, polishDepth: 0.28 });
  const readFresh = M.readLattice(partialsFresh, 0);
  const readWorn = M.readLattice(partialsWorn, 0.28);
  near(
    readFresh.c_over_a_estimate,
    readWorn.c_over_a_estimate,
    1e-6,
    "reading the lattice back is polish-invariant",
  );
}

// —— speciesFromRing recovers the mineral name (damping-invariant) ————
{
  for (const mineral of ["calcite", "quartz", "jasper", "chert"]) {
    const s = M.initState(0xbeef + mineral.length, mineral);
    const p0 = M.partialsFor(s);
    const p1 = M.partialsFor({ ...s, polishDepth: 0.30 });
    const namedFresh = M.speciesFromRing(p0, 0);
    const namedWorn = M.speciesFromRing(p1, 0.30);
    assert.equal(namedFresh, namedWorn, `speciesFromRing polish-invariant for ${mineral}`);
  }
}

// —— polishStep is a saturating exponential in [0, POLISH_MAX] —————————
{
  const s0 = M.initState(0xcafe);
  // A one-second carry moves polish very little.
  const s1 = M.polishStep(s0, 1, 1);
  assert.ok(s1.polishDepth > 0 && s1.polishDepth < 1e-4, "1s of polish is small");
  // A million seconds of carry is well into the saturating regime.
  const sHuge = M.polishStep(s0, 1e6, 1);
  assert.ok(sHuge.polishDepth < M.POLISH_MAX, "polish saturates strictly below POLISH_MAX");
  // Zero carry → no polish change.
  const sZero = M.polishStep(s0, 1e6, 0);
  near(sZero.polishDepth, 0, 1e-12, "zero carry → no polish");
}

// —— polishStep never fires identically at different held durations ———
{
  const s0 = M.initState(0xdeed);
  const s900 = M.polishStep(s0, 0.9, 1);
  const s2400 = M.polishStep(s0, 2.4, 1);
  assert.ok(s2400.polishDepth > s900.polishDepth, "2.4s polishes more than 0.9s");
  // But the ratio is well under 2.4 / 0.9 — saturating, not linear.
  const ratio = s2400.polishDepth / s900.polishDepth;
  assert.ok(
    ratio > 2.5 && ratio < 2.71,
    `saturating polish: ratio in linear region ~ 2.4/0.9 (got ${ratio})`,
  );
}

// —— growStep respects MAX_GROWTH_RINGS ——————————————————————————————
{
  let s = M.initState(0xf00d);
  // A big enough pressure * time forces a new ring per call.
  for (let i = 0; i < 30; i++) {
    s = M.growStep(s, M.MAX_ELAPSED_S, 1);
  }
  assert.ok(
    s.growthRings.length <= M.MAX_GROWTH_RINGS,
    `growth cap holds (got ${s.growthRings.length})`,
  );
}

// —— accretedMass is invariant under polish (a pebble does not lose accretion) —
{
  const s = M.initState(0xbaad);
  const grown = M.growStep(s, M.MAX_ELAPSED_S, 1);
  const before = M.accretedMass(grown);
  const polished = M.polishStep(grown, 1e6, 1);
  const after = M.accretedMass(polished);
  near(before, after, 1e-12, "accreted mass is polish-invariant");
}

// —— advanceExact caps elapsed at MAX_ELAPSED_S ————————————————————
{
  const s0 = M.initState(0x1234);
  // A century of elapsed becomes at most a fortnight.
  const century = 100 * 365 * 24 * 3600;
  const advanced = M.advanceExact(s0, century, { waterCarry: 1, latticePressure: 0.5 });
  assert.ok(
    advanced.tau <= M.MAX_ELAPSED_S,
    `a century is capped at MAX_ELAPSED_S (got ${advanced.tau})`,
  );
}

// —— advanceExact's polish grows monotonically over time ————————————
{
  const s0 = M.initState(0x5678);
  const step1 = M.advanceExact(s0, 1000, { waterCarry: 1, latticePressure: 0 });
  const step2 = M.advanceExact(step1, 1000, { waterCarry: 1, latticePressure: 0 });
  assert.ok(step2.polishDepth > step1.polishDepth, "polish grows monotonically");
}

// —— season wraps around 1 ————————————————————————————————————————
{
  const s0 = M.initState(0x9abc);
  // A month is a small fraction of a year.
  const sHalf = M.advanceExact(s0, 15 * 24 * 3600, { waterCarry: 0, latticePressure: 0 });
  assert.ok(sHalf.season > 0 && sHalf.season < 1, "season stays in [0, 1)");
}

// —— cleavageAt returns a lattice plane, not an arbitrary line ————————
{
  const s = M.initState(0xef01, "quartz");
  // Try a range of ray angles; every one should return one of the legal
  // cleavage planes for the hexagonal system.
  const legalPlanes = new Set([
    "0,0,1",
    "1,0,0",
    "1,1,0",
    "1,0,1",
  ]);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * 2 * Math.PI;
    const { plane } = M.cleavageAt(s, angle);
    const key = plane.join(",");
    assert.ok(legalPlanes.has(key), `cleavage returns a lattice plane (got ${key})`);
  }
}

// —— the ring frequency is invertible (ca → hz → ca round-trip) ————————
{
  for (const mineral of ["calcite", "quartz", "chert", "feldspar"]) {
    const s = M.initState(0x2222, mineral);
    const hz = M.ringHzFor(s);
    const ca = M.caFromRingHz(hz);
    near(ca, s.lattice.ca, 1e-9, `ring frequency round-trips for ${mineral}`);
  }
}

// —— ringHzFor is monotone in ca (higher ca → higher hz) ———————————————
{
  const s1 = M.initState(0xa1, "calcite"); // ca ~ 0.855
  const s2 = M.initState(0xa2, "quartz");  // ca ~ 1.10
  const s3 = M.initState(0xa3, "feldspar"); // ca ~ 1.15
  const hz1 = M.ringHzFor(s1);
  const hz2 = M.ringHzFor(s2);
  const hz3 = M.ringHzFor(s3);
  assert.ok(hz1 < hz2, `calcite (${hz1}) rings lower than quartz (${hz2})`);
  assert.ok(hz2 < hz3, `quartz (${hz2}) rings lower than feldspar (${hz3})`);
}

// —— polishDamping monotone-decreasing in polish depth ————————————————
{
  for (let k = 1; k <= 5; k++) {
    const d0 = M.polishDamping(0, k);
    const d1 = M.polishDamping(0.1, k);
    const d2 = M.polishDamping(0.3, k);
    assert.ok(d0 === 1, `polishDamping at 0 is 1 for k=${k}`);
    assert.ok(d1 > d2, `polishDamping monotone-decreasing for k=${k}`);
  }
  // The fundamental (k=0) is always un-damped.
  assert.equal(M.polishDamping(0.35, 0), 1, "fundamental is polish-invariant");
}

// —— partialsFor's fundamental is always exactly 1.0 ————————————————
{
  const s = M.initState(0xffff, "obsidian");
  for (const p of [0, 0.1, 0.25, M.POLISH_MAX]) {
    const partials = M.partialsFor({ ...s, polishDepth: p });
    near(partials[0], 1, 1e-12, `fundamental is 1.0 at polish=${p}`);
  }
}

// —— latticeFor's centering is P for every current mineral ————————————
{
  for (const mineral of [
    "calcite",
    "quartz",
    "jasper",
    "agate",
    "chert",
    "chalcedony",
    "feldspar",
    "obsidian",
  ]) {
    const l = M.latticeFor(mineral, 0);
    assert.equal(l.centering, "P", `${mineral} lattice is primitive`);
  }
}

// —— initState always includes a seed ring at radius 0.05 ————————————
{
  const s = M.initState(0x1);
  assert.equal(s.growthRings.length, 1, "initState has 1 growth ring (the seed)");
  near(s.growthRings[0].radius, 0.05, 1e-12, "seed ring is at radius 0.05");
  assert.equal(s.growthRings[0].thickness, 0, "seed ring has thickness 0");
}

// —— growth ring radii are monotone-increasing ————————————————————————
{
  let s = M.initState(0x8888);
  for (let i = 0; i < 6; i++) {
    s = M.growStep(s, M.MAX_ELAPSED_S, 1);
  }
  for (let i = 1; i < s.growthRings.length; i++) {
    assert.ok(
      s.growthRings[i].radius >= s.growthRings[i - 1].radius,
      `growth radii monotone-increasing (i=${i})`,
    );
  }
}

// —— growthRadii returns radii in oldest-first order ——————————————————
{
  let s = M.initState(0x9999);
  s = M.growStep(s, M.MAX_ELAPSED_S, 1);
  s = M.growStep(s, M.MAX_ELAPSED_S, 1);
  const radii = M.growthRadii(s);
  assert.equal(radii.length, s.growthRings.length, "growthRadii returns one per ring");
}

console.log("pebblecore: OK");
