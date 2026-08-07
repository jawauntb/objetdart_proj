// The local group (/localgroup) — the laws that can lie, pinned.
// Falsifiable only: determinism from the seed; softened accelerations that stay
// finite through a zero-separation pass; total momentum conserved exactly by
// the internal step; a bound orbit that stays bound under the symplectic
// integrator (and an escaping one that leaves); mergers that conserve mass and
// momentum and make a third galaxy; tides that strengthen with closeness; the
// cap retiring oldest-first; and a persistence round-trip that survives garbage.

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

const L = loadTsModule("src/lib/localgroup.ts");

const still = () => ({
  windX: 0, windY: 0, gravX: 0, gravY: 0, agitation: 0,
  epoch: 0.5, timeScale: 1, reduced: false,
});

// ——— determinism: the seed is the whole state ———————————————————————————
// Catches: any Math.random or wall-clock leak into birth.
{
  const a = L.bornGalaxy(1, 0xabcd, 0.4, 0.6, 1, 1000);
  const b = L.bornGalaxy(1, 0xabcd, 0.4, 0.6, 1, 1000);
  assert.deepEqual(a, b, "the same seed must bear the same galaxy, always");
  const c = L.bornGalaxy(1, 0xabcd + 1, 0.4, 0.6, 1, 1000);
  assert.ok(c.spin !== a.spin || c.age !== a.age, "a different seed must differ");
  assert.equal(L.hashSeed(2, 4, 6), L.hashSeed(2, 4, 6), "hashSeed is a function");
  assert.notEqual(L.hashSeed(2, 4, 6), L.hashSeed(6, 4, 2), "hashSeed hears order");
  // the whole step is deterministic too
  const g1 = L.seedLocalGroup(0);
  const g2 = L.seedLocalGroup(0);
  for (let s = 0; s < 50; s++) {
    L.stepGroup(g1, still(), s * 16, 0.016);
    L.stepGroup(g2, still(), s * 16, 0.016);
  }
  assert.deepEqual(g1, g2, "the same group stepped the same way lands identically");
}

// ——— softened gravity stays finite through a head-on pass ————————————————
// Catches: the 1/r² singularity — two centres coinciding must not throw NaN.
{
  const a = L.bornGalaxy(1, 3, 0.5, 0.5, 1, 0);
  const b = L.bornGalaxy(2, 4, 0.5, 0.5, 1, 0); // exactly the same point
  a.growth = b.growth = 1;
  L.stepGroup([a, b], still(), 0, 0.016);
  for (const g of [a, b]) {
    assert.ok(Number.isFinite(g.vx) && Number.isFinite(g.vy), "softening keeps velocity finite");
    assert.ok(Number.isFinite(g.nx) && Number.isFinite(g.ny), "softening keeps position finite");
  }
}

// ——— the internal step conserves total momentum exactly ——————————————————
// Catches: an asymmetric force (only some pairs pushed back), a global damping
// that quietly bleeds momentum, an integrator that is not symplectic-symmetric.
{
  const gals = L.seedLocalGroup(0);
  const before = L.totalMomentum(gals);
  for (let s = 0; s < 400; s++) L.stepGroup(gals, still(), s * 16, 0.016);
  const after = L.totalMomentum(gals);
  assert.ok(
    Math.abs(after.px - before.px) < 1e-9 && Math.abs(after.py - before.py) < 1e-9,
    "pure internal gravity is momentum-conserving to float precision",
  );
  // and the external season MUST be able to move it — friction is not internal
  const g2 = L.seedLocalGroup(0);
  const p0 = L.totalMomentum(g2);
  for (let s = 0; s < 400; s++) L.stepGroup(g2, { ...still(), epoch: 0.95 }, s * 16, 0.016);
  const p1 = L.totalMomentum(g2);
  assert.ok(
    Math.abs(p1.px - p0.px) > 1e-9 || Math.abs(p1.py - p0.py) > 1e-9,
    "winding cosmic time forward genuinely changes the group's momentum",
  );
}

// ——— a bound orbit stays bound; an unbound one leaves ————————————————————
// Catches: an integrator that spirals a circular orbit in or out; a softened
// potential that disagrees with the energy test about what "bound" means.
{
  // a two-body circular orbit about the shared barycenter, held at rest
  const mA = 1.0;
  const mB = 0.08;
  const r = 0.22;
  const M = mA + mB;
  const s2 = L.SOFTENING * L.SOFTENING;
  // circular speed of the relative coordinate under the softened potential
  const vrel = Math.sqrt((L.G * M * r * r) / Math.pow(r * r + s2, 1.5));
  const A = L.bornGalaxy(1, 11, 0.5 - (mB / M) * r, 0.5, mA, 0);
  const B = L.bornGalaxy(2, 22, 0.5 + (mA / M) * r, 0.5, mB, 0);
  A.growth = B.growth = 1;
  A.vx = 0; A.vy = -(mB / M) * vrel;
  B.vx = 0; B.vy = (mA / M) * vrel;
  const gals = [A, B];
  const bary0 = L.computeBarycenter(gals);
  assert.ok(L.isBound(B, bary0), "the satellite starts bound");
  let minSep = Infinity;
  let maxSep = 0;
  for (let s = 0; s < 3000; s++) {
    L.stepGroup(gals, still(), s * 16, 0.016);
    const sep = Math.hypot(A.nx - B.nx, A.ny - B.ny);
    if (Number.isFinite(sep)) {
      minSep = Math.min(minSep, sep);
      maxSep = Math.max(maxSep, sep);
    }
  }
  assert.ok(minSep > r * 0.5, `the orbit never collapses (min ${minSep.toFixed(3)} vs r ${r})`);
  assert.ok(maxSep < r * 2.0, `the orbit never runs away (max ${maxSep.toFixed(3)} vs r ${r})`);
  assert.ok(A.presence === 1 && B.presence === 1, "a bound pair is still standing after many turns");

  // now a real kick unbinds the satellite, and it leaves the group
  const gals2 = [
    L.bornGalaxy(1, 11, 0.5, 0.5, mA, 0),
    L.bornGalaxy(2, 22, 0.5 + r, 0.5, mB, 0),
  ];
  gals2[0].growth = gals2[1].growth = 1;
  const sat = gals2[1];
  const bc = L.computeBarycenter(gals2);
  assert.ok(L.isBound(sat, bc), "before the flick the satellite is bound");
  L.kickGalaxy(sat, 0, 3); // flung straight out, hard
  assert.ok(!L.isBound(sat, L.computeBarycenter(gals2)), "a hard flick unbinds it");
  for (let s = 0; s < 4000; s++) L.stepGroup(gals2, still(), s * 16, 0.016);
  assert.ok(sat.presence <= 0, "the unbound galaxy streams past the escape radius and is gone");
}

// ——— a merger conserves mass and momentum, and makes a third galaxy ———————
// Catches: a merge that averages mass, drops momentum, or hands back a parent.
{
  const a = L.bornGalaxy(1, 101, 0.45, 0.5, 1.0, 500);
  const b = L.bornGalaxy(2, 202, 0.55, 0.5, 0.6, 500);
  a.growth = b.growth = 1;
  a.vx = 0.02; a.vy = -0.01;
  b.vx = -0.03; b.vy = 0.02;
  const pBefore = L.totalMomentum([a, b]);
  const c = L.mergeGalaxies(a, b, 9, 900);
  assert.ok(Math.abs(c.mass - 1.6) < 1e-9, "the child carries both masses whole");
  const pAfter = { px: c.vx * c.mass, py: c.vy * c.mass };
  assert.ok(
    Math.abs(pAfter.px - pBefore.px) < 1e-9 && Math.abs(pAfter.py - pBefore.py) < 1e-9,
    "the merger conserves momentum: M·v_child = m_a·v_a + m_b·v_b",
  );
  assert.notEqual(c.seed, a.seed, "the child is neither parent");
  assert.notEqual(c.seed, b.seed, "the child is neither parent");
  assert.ok(c.nx > a.nx && c.nx < b.nx, "the child stands between its parents");
  const mid = (a.nx + b.nx) / 2;
  assert.ok(Math.abs(c.nx - mid) > 1e-9, "the meeting point is mass-weighted, not the midpoint");
  assert.ok(c.flare > 0.5, "a merger is a starburst — the new disc flares");
  assert.ok(c.age < a.age || c.age < b.age || c.age <= 0.5, "the starburst youngens the stellar age");
  assert.ok(Number.isFinite(c.spin), "the child's spin is finite");
}

// ——— the pair the field would actually coalesce ——————————————————————————
// Catches: a merge trigger that fires at any distance, or never.
{
  const near = [
    Object.assign(L.bornGalaxy(1, 1, 0.5, 0.5, 1, 0), { growth: 1 }),
    Object.assign(L.bornGalaxy(2, 2, 0.51, 0.5, 1, 0), { growth: 1 }),
  ];
  assert.deepEqual(L.findMergePair(near), [0, 1], "two overlapping discs are a merge pair");
  const far = [
    Object.assign(L.bornGalaxy(1, 1, 0.2, 0.5, 1, 0), { growth: 1 }),
    Object.assign(L.bornGalaxy(2, 2, 0.8, 0.5, 1, 0), { growth: 1 }),
  ];
  assert.equal(L.findMergePair(far), null, "galaxies a whole frame apart are not merging");
}

// ——— tides strengthen with closeness, and pick the giant ——————————————————
// Catches: a tidal law flat in distance, or one that streams off the giant.
{
  assert.ok(
    L.tidalStretch(0.1, 1) > L.tidalStretch(0.3, 1),
    "the closer the satellite the stronger the tide",
  );
  assert.ok(L.tidalStretch(0.2, 2) > L.tidalStretch(0.2, 1), "a heavier neighbour tides harder");
  const gals = [
    L.bornGalaxy(1, 1, 0.50, 0.5, 1.2, 0), // the giant
    L.bornGalaxy(2, 2, 0.56, 0.5, 0.05, 0), // a dwarf beside it
    L.bornGalaxy(3, 3, 0.90, 0.9, 0.05, 0), // a dwarf far off
  ];
  const p = L.tidalPartner(gals, 1);
  assert.equal(p.j, 0, "the dwarf's tidal partner is the giant it falls toward");
  assert.equal(L.tidalPartner(gals, 0).j, -1, "the giant has no heavier partner to stream toward");
}

// ——— pitch and radius stay monotone and sane ————————————————————————————
{
  assert.ok(L.galaxyPitchMidi(0.05) > L.galaxyPitchMidi(1.5), "heavier galaxies ring lower");
  for (const m of [0.05, 0.2, 1, 2]) {
    const p = L.galaxyPitchMidi(m);
    assert.ok(p >= 36 && p <= 100, `mass ${m} rings inside the register, got ${p}`);
  }
  assert.ok(L.galaxyRadius(1) > L.galaxyRadius(0.1), "a heavier disc is larger");
  assert.ok(L.haloRadius(1) > L.galaxyRadius(1), "the dark halo is larger than the light");
}

// ——— a dwarf condenses light and grows heavier by tier ————————————————————
{
  const g = L.condenseGalaxy(1, 7, 0.5, 0.5, 0);
  assert.ok(g.mass < 0.1, "a fresh dwarf condenses light");
  assert.ok(g.age < 0.3, "condensed gas is young");
  const before = g.mass;
  L.growDwarf(g, 2000);
  assert.ok(g.mass > before, "a deepening dwell grows its mass");
  const mid = g.mass;
  L.growDwarf(g, 4000);
  assert.ok(g.mass > mid, "holding longer keeps growing it — duration is an axis");
}

// ——— the cap retires oldest first ————————————————————————————————————————
{
  const gals = [
    L.bornGalaxy(1, 1, 0.2, 0.2, 1, 300),
    L.bornGalaxy(2, 2, 0.4, 0.4, 1, 100),
    L.bornGalaxy(3, 3, 0.6, 0.6, 1, 200),
  ];
  const idx = L.retireOldest(gals);
  assert.equal(gals[idx].id, 2, "the oldest gives way first");
  assert.equal(L.retireOldest(gals) === idx, false, "an already-retiring galaxy is not retired twice");
}

// ——— persistence round-trips, and an emptied group stays empty ————————————
{
  const gals = L.seedLocalGroup(0);
  gals[0].mass = 1.3;
  const kept = L.serializeGroup(gals);
  const back = L.loadGroup(kept, 5000);
  assert.equal(back.length, gals.length, "what wheeled is what returns");
  assert.ok(Math.abs(back[0].mass - 1.3) < 0.002, "a galaxy returns at the mass it was left at");
  assert.ok(Math.abs(back[0].nx - gals[0].nx) < 0.002, "and where it was left");
  // a streaming galaxy is not kept — it was already leaving
  gals[1].presence = 0.999;
  assert.equal(
    L.serializeGroup(gals).galaxies.length,
    gals.length - 1,
    "a galaxy that is leaving the group is not kept",
  );
  assert.deepEqual(L.loadGroup({ v: 1, galaxies: [] }, 0), [], "an emptied group stays empty");
  assert.deepEqual(L.loadGroup("garbage", 0), [], "a corrupt keep is a fresh sky, not a crash");
}

console.log("localgroup: ok");
