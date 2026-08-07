// The shells (/viruses) — icosahedral capsid symmetry, pinned.
// Falsifiable only: the 60·T subunit law and the Euler/axis counts of the
// icosahedron, conservation of subunits across assembly, climbing, templating
// and dissolution, determinism from the seed alone, the Caspar–Klug ladder,
// bounded Brownian drift, and the season's wander staying on the ladder.

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

const V = loadTsModule("src/lib/viruses.ts");

// ——— determinism: the seed is the whole state ———————————————————————————
// Catches: any Math.random or wall-clock leak into a born shell or its geometry.
{
  const a = V.bornShell(1, 0xcafe, 3, 0.4, 0.6, 1000);
  const b = V.bornShell(1, 0xcafe, 3, 0.4, 0.6, 1000);
  assert.deepEqual(a, b, "the same seed and class must bear the same shell, always");
  const c = V.bornShell(1, 0xcafe + 1, 3, 0.4, 0.6, 1000);
  assert.ok(c.vx !== a.vx || c.vy !== a.vy, "a different seed must drift differently");
  // the identity claim: same (t, seed) → geometrically identical capsomer layout
  const g1 = V.capsomers(4, 0xbeef);
  const g2 = V.capsomers(4, 0xbeef);
  assert.deepEqual(g1, g2, "same class and seed draw the same shell — that is the identity");
  const g3 = V.capsomers(4, 0xbeef + 1);
  assert.notDeepEqual(g1, g3, "a different seed draws a different shell of the same class");
}

// ——— the 60·T subunit law, and the capsomer arithmetic ————————————————————
// Catches: an off-by-a-factor subunit count, a pentamer count that is not 12,
// a hexamer count that does not close the books.
{
  for (const t of [1, 3, 4, 7, 13]) {
    assert.equal(V.subunitCount(t), 60 * t, `a T=${t} capsid has exactly 60·${t} subunits`);
    assert.equal(V.pentamerCount(), 12, "always exactly twelve pentamers at the five-fold vertices");
    assert.equal(V.capsomerCount(t), 10 * t + 2, `T=${t} has 10T+2 capsomers`);
    assert.equal(
      V.hexamerCount(t) + V.pentamerCount(),
      V.capsomerCount(t),
      "pentamers plus hexamers must close on the capsomer total",
    );
  }
  assert.equal(V.hexamerCount(1), 0, "T=1 is all pentamers — twelve, no hexamers");
  // the capsomer layout carries the counts it claims
  const caps = V.capsomers(7, 99);
  assert.equal(caps.length, V.capsomerCount(7), "the layout has one seat per capsomer");
  assert.equal(caps.filter((c) => c.penta).length, 12, "and exactly twelve of them are pentamers");
  for (const c of caps) assert.ok(Math.hypot(c.u, c.v) <= 1.0001, "every capsomer sits on the unit disc");
}

// ——— the icosahedron: Euler, and the 2·3·5 axes ——————————————————————————
// Catches: a bad vertex table, or axis counts that don't come from the solid.
{
  assert.equal(V.ICOSA.vertices - V.ICOSA.edges + V.ICOSA.faces, 2, "V − E + F = 2, always");
  const v = V.icosaVertices();
  assert.equal(v.length, 12, "twelve five-fold vertices");
  for (const p of v) {
    assert.ok(Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) < 1e-9, "each vertex is unit-normalized");
  }
  const ax = V.symmetryAxes();
  assert.deepEqual(
    ax,
    { fivefold: 6, threefold: 10, twofold: 15 },
    "6 five-fold, 10 three-fold, 15 two-fold — the axes of the icosahedral group",
  );
  assert.equal(ax.fivefold + ax.threefold + ax.twofold, 31, "and thirty-one axes in all");
}

// ——— the Caspar–Klug ladder ————————————————————————————————————————————
// Catches: a ladder that admits a non-CK number, or that does not climb in order.
{
  assert.ok(V.isCKNumber(1) && V.isCKNumber(3) && V.isCKNumber(4) && V.isCKNumber(7));
  assert.ok(!V.isCKNumber(2), "2 is not h²+hk+k² for any h,k — not a class");
  assert.ok(!V.isCKNumber(5) && !V.isCKNumber(6), "5 and 6 are not triangulation numbers");
  assert.ok(V.isCKNumber(13), "13 = 3²+3·1+1² is a class");
  for (const t of V.CK_LADDER) assert.ok(V.isCKNumber(t), `every ladder rung is a real class (${t})`);
  for (let i = 1; i < V.CK_LADDER.length; i++) {
    assert.ok(V.CK_LADDER[i] > V.CK_LADDER[i - 1], "the ladder climbs strictly");
  }
  assert.equal(V.nextT(1), 3, "one rung up from T=1 is T=3");
  assert.equal(V.nextT(3), 4, "then T=4");
  assert.equal(V.prevT(4), 3, "and back down from T=4 is T=3");
  const top = V.CK_LADDER[V.CK_LADDER.length - 1];
  assert.equal(V.nextT(top), top, "there is no rung above the top of the ladder");
  assert.equal(V.prevT(1), 1, "and none below T=1");
}

// ——— conservation: assembly, climbing, templating, dissolution ————————————
// Catches: a create/destroy path that mints or drops subunits — the heart of
// the room. Every operation only MOVES subunits between the free medium and the
// shells; the grand total never changes.
{
  const m = { free: V.MEDIUM_START_FREE, shells: [] };
  const total0 = V.totalSubunits(m);

  const i = V.assembleShell(m, 1, 0x11, 0.5, 0.5, 0);
  assert.ok(i >= 0, "the medium seeds a fresh shell");
  assert.equal(m.shells[i].t, 1, "a fresh assembly is class T=1");
  assert.equal(V.totalSubunits(m), total0, "assembly moved 60 subunits out of the medium, minted none");
  assert.equal(m.free, total0 - 60, "the free pool fell by exactly one shell's worth");

  const before = m.shells[i].t;
  assert.ok(V.climbShell(m, i), "a shell with medium to spare climbs the ladder");
  assert.equal(m.shells[i].t, V.nextT(before), "it took on the next class");
  assert.equal(V.totalSubunits(m), total0, "climbing drew the difference from the medium, conserved");

  const j = V.templateShell(m, i, 2, 10);
  assert.ok(j >= 0, "a docked shell templates a copy");
  assert.equal(m.shells[j].seed, m.shells[i].seed, "the copy carries the same seed");
  assert.equal(m.shells[j].t, m.shells[i].t, "and the same class — geometrically identical");
  assert.equal(V.totalSubunits(m), total0, "templating drew 60·T from the medium, conserved");

  const gave = V.dissolveShell(m, j);
  assert.equal(gave, 60 * m.shells[i].t, "dissolution returned exactly the shell's subunits");
  assert.equal(V.totalSubunits(m), total0, "and the grand total is untouched — nothing was lost");

  // a starved medium refuses rather than minting subunits from nothing
  const starved = { free: 10, shells: [] };
  assert.equal(V.assembleShell(starved, 9, 1, 0.5, 0.5, 0), -1, "too few free subunits: no shell, no invention");
}

// ——— bounded Brownian drift ————————————————————————————————————————————
// Catches: a drift that escapes the frame or accelerates without bound.
{
  const s = V.bornShell(1, 0x5eed, 3, 0.5, 0.5, 0);
  s.vx = 3; // slam it at the wall
  s.vy = -3;
  for (let step = 0; step < 4000; step++) {
    V.driftShell(s, 0.016, 1, step * 16);
    assert.ok(s.nx >= 0.03 && s.nx <= 0.97, "the frame's edge holds in x");
    assert.ok(s.ny >= 0.03 && s.ny <= 0.97, "the frame's edge holds in y");
    assert.ok(Math.abs(s.vx) < 3 && Math.abs(s.vy) < 3, "the walk stays a walk, never a launch");
  }
  // and it settles: a wall-slammed shell relaxes to a gentle drift within a breath
  assert.ok(Math.abs(s.vx) < 0.1 && Math.abs(s.vy) < 0.1, "the launch decays to a walk once the wall is left");
  // heavier shells are jostled less: inertia falls with T
  assert.ok(
    V.brownianInertia(1) > V.brownianInertia(13),
    "a heavier capsid drifts less under the same medium",
  );
  // temperature actually stirs
  const cold = V.bornShell(2, 7, 1, 0.5, 0.5, 0);
  const warm = V.bornShell(2, 7, 1, 0.5, 0.5, 0);
  let cd = 0;
  let wd = 0;
  for (let step = 0; step < 200; step++) {
    V.driftShell(cold, 0.016, 0.05, step * 16);
    V.driftShell(warm, 0.016, 1, step * 16);
    cd += Math.abs(cold.vx) + Math.abs(cold.vy);
    wd += Math.abs(warm.vx) + Math.abs(warm.vy);
  }
  assert.ok(wd > cd, "a warmer medium jostles the shells harder");
}

// ——— the season: fidelity wanders on the ladder, never off it —————————————
// Catches: cold that is not perfect, or a wander that leaves a real class.
{
  assert.equal(V.wanderT(7, 1, 123), 7, "cold holds the class exactly");
  assert.equal(V.wanderT(7, 1, 456), 7, "for any seed");
  for (let seed = 0; seed < 200; seed++) {
    const w = V.wanderT(7, 0, seed);
    assert.ok(V.isCKNumber(w), `warm wanders only to a real class (got ${w})`);
    const i = V.CK_LADDER.indexOf(7);
    const j = V.CK_LADDER.indexOf(w);
    assert.ok(Math.abs(i - j) <= 1, "and only to an adjacent rung, never a leap");
  }
}

// ——— persistence round-trips, and an emptied medium stays empty ——————————
{
  const m = { free: V.MEDIUM_START_FREE, shells: [] };
  V.assembleShell(m, 1, 0xaa, 0.25, 0.75, 0);
  V.climbShell(m, 0);
  m.shells[0].net = 0.5;
  const kept = V.serializeMedium(m);
  const back = V.loadMedium(kept, 5000);
  assert.equal(back.shells.length, 1, "what stood returns");
  assert.equal(back.shells[0].t, m.shells[0].t, "at the class it was left in");
  assert.ok(Math.abs(back.shells[0].nx - 0.25) < 0.002, "and where it was left");
  assert.ok(Math.abs(back.shells[0].net - 0.5) < 0.02, "with its fold remembered");
  assert.equal(V.totalSubunits(back), V.totalSubunits(m), "and the medium's books balance across a reload");
  assert.deepEqual(V.loadMedium({ v: 1, free: 100, shells: [] }, 0).shells, [], "an emptied medium stays empty");
  assert.equal(V.loadMedium("garbage", 0).shells.length, 0, "a corrupt keep is a fresh medium, not a crash");
}

console.log("viruses: ok");
