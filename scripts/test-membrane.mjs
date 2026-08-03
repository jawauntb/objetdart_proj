// The /organelles laws. The bugs these catch: a surface-area integral that
// disagrees with the analytic answer for the one case we can check by hand,
// a redistribution that creates or destroys membrane (the room's entire
// claim), a clamp that leaks the leftover, a timbre map you could not read
// backwards, a "smooth" vesicle that is not actually a sine, a ghost ring
// filled by duplicates, and a gather field that pulls sideways or from
// everywhere instead of only at the cell well.

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

const M = loadTsModule("src/lib/membrane.ts");
const TAU = Math.PI * 2;

// —— the integral agrees with the one answer we know ————————————
// A membrane with no folds is a circle, and its arclength is 2πr exactly.
// If the integrator is wrong, this is where it shows, and every area in
// the room is wrong with it.
for (const radius of [0.3, 1, 1.7, 2.4]) {
  const smooth = { kind: "vacuole", seed: 1, folds: 3, amplitude: 0, radius, nx: 0.5, ny: 0.5 };
  const a = M.surfaceArea(smooth);
  assert.ok(
    Math.abs(a - TAU * radius) < 1e-4 * radius,
    `a smooth sac of radius ${radius} has perimeter 2πr (got ${a}, want ${TAU * radius})`,
  );
  assert.ok(Math.abs(M.foldedness(smooth) - 1) < 1e-6, "and its foldedness is exactly one");
}

// —— folding always adds membrane, never removes it ————————————
{
  const base = { kind: "mitochondrion", seed: 2, folds: 9, amplitude: 0, radius: 1, nx: 0.5, ny: 0.5 };
  let prev = 0;
  for (const amp of [0, 0.05, 0.12, 0.22, 0.35, 0.5, 0.7]) {
    const a = M.surfaceArea({ ...base, amplitude: amp });
    assert.ok(a > prev, `deeper cristae hold more membrane (amp ${amp})`);
    assert.ok(M.foldedness({ ...base, amplitude: amp }) >= 1, "foldedness never drops below one");
    prev = a;
  }
  // more folds at the same depth also means more membrane
  let prevFolds = 0;
  for (const folds of [2, 4, 7, 11, 14]) {
    const a = M.surfaceArea({ ...base, amplitude: 0.25, folds });
    assert.ok(a > prevFolds, `more cristae hold more membrane (${folds})`);
    prevFolds = a;
  }
}

// —— the membrane is closed, and deterministic ——————————————————
{
  const o = M.organelleFromSeed("golgi", 0xbee5);
  const a = M.membranePoint(o, 0);
  const b = M.membranePoint(o, TAU);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, "the membrane closes on itself");
  assert.deepEqual(M.organelleFromSeed("golgi", 0xbee5), o, "a seed is an organelle");
  assert.notDeepEqual(M.organelleFromSeed("golgi", 0xbee6), o, "and a different seed is another");
}

// —— THE BUDGET: redistribution conserves membrane, exactly ————————
// This is the room's whole argument. Flatten a fold and the area has to go
// somewhere; the bug worth catching is a clamp that quietly eats the
// leftover, or a proportional share that does not sum back to what it took.
{
  const kinds = M.MEMBRANE_KINDS;
  const list = kinds.map((k, i) => M.organelleFromSeed(k, 0x100 + i));
  const before = M.totalArea(list);
  assert.ok(before > 0, "the plasm starts with membrane in it");

  let cur = list;
  // ordinary moves, extreme moves, and moves that must hit both clamps
  const deltas = [0.4, -0.9, 3.2, -2.6, 40, -40, 0.001, 1e6, -1e6, 7, -7];
  for (let step = 0; step < deltas.length; step++) {
    const i = step % cur.length;
    const next = M.redistribute(cur, i, deltas[step]);
    const after = M.totalArea(next);
    assert.ok(
      Math.abs(after - before) < 1e-2,
      `membrane is conserved (delta ${deltas[step]} at ${i}: ${before} → ${after})`,
    );
    for (const o of next) {
      const a = M.surfaceArea(o);
      assert.ok(a >= M.AREA_FLOOR - 1e-2, "no organelle is flattened out of existence");
      assert.ok(a <= M.AREA_CEILING + 1e-2, "and none eats the whole cell");
    }
    cur = next;
  }
  // Giving to one really does take from the others — not a no-op dressed
  // up as conservation.
  const grown = M.redistribute(list, 0, 2.5);
  assert.ok(M.surfaceArea(grown[0]) > M.surfaceArea(list[0]), "the one asked for grows");
  let othersShrank = false;
  for (let k = 1; k < list.length; k++) {
    if (M.surfaceArea(grown[k]) < M.surfaceArea(list[k]) - 1e-3) othersShrank = true;
  }
  assert.ok(othersShrank, "and the others pay for it");
  // A single organelle has nobody to trade with, so nothing moves at all.
  const alone = [list[0]];
  assert.deepEqual(M.redistribute(alone, 0, 5), alone, "one organelle cannot borrow from itself");
  assert.deepEqual(M.redistribute(list, -1, 5), list, "an index off the plasm does nothing");
  assert.deepEqual(M.redistribute(list, 99, 5), list, "and neither does one past its end");
}
// withArea actually hits the area it is asked for — the inverse of the
// integral, and the thing redistribute leans on entirely.
{
  const o = M.organelleFromSeed("er", 7);
  for (const target of [3, 6, 12, 20, 30]) {
    const got = M.surfaceArea(M.withArea(o, target));
    assert.ok(Math.abs(got - target) < 0.05, `withArea(${target}) lands on ${target} (got ${got})`);
  }
  assert.ok(
    M.surfaceArea(M.withArea(o, 1e9)) <= M.AREA_CEILING + 1e-6,
    "and refuses to exceed the ceiling",
  );
}

// —— folded surface → timbre, and back ————————————————————————
{
  // A smooth vesicle is a sine. Not "nearly" — exactly one partial.
  const vesicle = { kind: "vacuole", seed: 3, folds: 2, amplitude: 0, radius: 1.4, nx: 0.5, ny: 0.5 };
  assert.equal(M.harmonicsFor(M.foldedness(vesicle)), 1, "a smooth sac is a sine");
  assert.equal(M.brightness(vesicle), 0, "and carries no shimmer at all");

  let prev = 0;
  for (const f of [1, 1.2, 1.5, 1.9, 2.4, 3.5]) {
    const h = M.harmonicsFor(f);
    assert.ok(h >= prev, "a more folded membrane never rings simpler");
    assert.ok(h >= 1 && h <= M.MAX_HARMONICS, "and stays inside the room's range");
    prev = h;
  }
  assert.equal(M.harmonicsFor(99), M.MAX_HARMONICS, "the ceiling is a ceiling");
  assert.equal(M.harmonicsFor(0.2), 1, "and nothing rings less than a sine");

  // The map reads backwards: hearing the partial count IS reading the fold.
  for (let h = 1; h <= M.MAX_HARMONICS; h++) {
    assert.equal(
      M.harmonicsFor(M.foldednessFromHarmonics(h)),
      h,
      `${h} partials name the foldedness that produces ${h} partials`,
    );
  }

  // A crista-folded mitochondrion genuinely rings brighter than a vesicle —
  // the comparison the ear is supposed to be able to make.
  const mito = M.organelleFromSeed("mitochondrion", 0x5a);
  assert.ok(M.brightness(mito) > M.brightness(vesicle), "cristae ring brighter than a sac");
  assert.ok(M.brightness(mito) <= 1 && M.brightness(mito) >= 0, "brightness stays in its range");
}
// The pitches are ordered by size: a ribosome rings above a nucleus, always.
{
  const order = ["nucleus", "vacuole", "er", "golgi", "mitochondrion", "ribosome"];
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      M.KIND_BASE_HZ[order[i]] > M.KIND_BASE_HZ[order[i - 1]],
      `${order[i]} rings above ${order[i - 1]}`,
    );
  }
}

// —— the set, and the cap ——————————————————————————————————————
{
  const partial = ["mitochondrion", "ribosome"].map((k, i) => M.organelleFromSeed(k, i));
  assert.equal(M.hasFullSet(partial), false, "two organs are not a cell");
  assert.deepEqual(
    M.missingKinds(partial).sort(),
    ["er", "golgi", "nucleus", "vacuole"],
    "and the room knows exactly which four are missing",
  );
  const full = M.MEMBRANE_KINDS.map((k, i) => M.organelleFromSeed(k, i));
  assert.equal(M.hasFullSet(full), true, "all six close the membrane");
  assert.deepEqual(M.missingKinds(full), [], "with nothing left wanting");
  // duplicates do not fake a set
  const dupes = ["nucleus", "nucleus", "nucleus"].map((k, i) => M.organelleFromSeed(k, i));
  assert.equal(M.hasFullSet(dupes), false, "three nuclei are still one kind");
  assert.equal(M.membraneCompleteness(dupes), 1 / 6, "and only draw one sixth of the ghost ring");
  const partialSet = ["nucleus", "er", "er", "vacuole"].map((k, i) => M.organelleFromSeed(k, i));
  assert.equal(M.membraneCompleteness(partialSet), 3 / 6, "the ring fraction is unique kinds over six");
  assert.equal(M.membraneCompleteness(full), 1, "and a complete set draws a complete ghost");
}
// The forming membrane is also a well: it acts near the center and near the
// ghost ring, but it must not become a room-wide hidden gravity field.
{
  const inside = M.cellWellPull(0.56, 0.5, 0.5);
  assert.ok(inside.strength > 0, "near the well, the cell gathers");
  assert.ok(inside.x < -0.99 && Math.abs(inside.y) < 1e-9, "and the pull points toward the center");

  const onRingDim = M.cellWellPull(0.5 + M.CELL_GHOST_RADIUS, 0.5, 0.2);
  const onRingReady = M.cellWellPull(0.5 + M.CELL_GHOST_RADIUS, 0.5, 1);
  assert.ok(onRingDim.strength > 0, "the ghost membrane catches an organ brushed against it");
  assert.ok(onRingReady.strength > onRingDim.strength, "the well strengthens as the set fills");
  assert.ok(onRingReady.x < -0.99 && Math.abs(onRingReady.y) < 1e-9, "the ring also pulls inward");

  const outside = M.cellWellPull(0.95, 0.95, 1);
  assert.equal(outside.strength, 0, "outside the well band, the room does not secretly gather");
  assert.deepEqual(M.cellWellPull(0.5, 0.5, 1), { x: 0, y: 0, strength: 0 }, "the exact center is stable");
}
{
  const many = Array.from({ length: M.MAX_ORGANELLES + 4 }, (_, i) =>
    M.organelleFromSeed("ribosome", i),
  );
  const kept = M.settlePopulation(many);
  assert.equal(kept.length, M.MAX_ORGANELLES, "the plasm holds its cap");
  assert.equal(kept.at(-1).seed, many.at(-1).seed, "keeping the newest");
  assert.equal(kept[0].seed, many[4].seed, "and retiring the oldest");
}

console.log(
  "membrane ok: the arclength integral matching 2πr exactly for the smooth case, folding strictly adding surface, the budget conserved across eleven moves including both clamps, withArea inverting the integral, and folded-surface↔partials a true round trip with a vesicle ringing as one sine",
);
