// The /zeus laws. Every assertion below names the bug it would catch.
//
// The load-bearing ones: conservation across a merge and a calve (a room
// that mints charge on a union turns the peal into a perpetual-motion
// machine), the invertibility of the thunder map (the pitch IS the energy —
// if the round trip drifts, the listener is being lied to), and the peal's
// nearest-neighbor walk checked against a brute-force chain on a fixture
// (a wrong walk is invisible in play until two far houses answer out of
// order and the verdict skips across the sky).

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

const Z = loadTsModule("src/lib/zeussky.ts");

// --- attraction: symmetric, monotone in charge, finite at contact --------

{
  const a = { nx: 0.3, ny: 0.3, charge: 0.8 };
  const b = { nx: 0.6, ny: 0.4, charge: 0.5 };
  const onA = Z.attraction(a, b);
  const onB = Z.attraction(b, a);
  // Newton's third law in normalized units: the pulls mirror exactly. A sign
  // slip here reads as one cloud chasing another that never answers.
  assert.ok(Math.abs(onA.ax + onB.ax) < 1e-12 && Math.abs(onA.ay + onB.ay) < 1e-12,
    "induction must pull both courts toward each other with equal magnitude");
  // The pull points from A toward B, not away.
  assert.ok(onA.ax > 0 && onA.ay > 0, "attraction on A must point toward B");

  const hot = Z.attraction({ ...a, charge: 1.6 }, b);
  assert.ok(Math.hypot(hot.ax, hot.ay) > Math.hypot(onA.ax, onA.ay),
    "doubling a charge must strengthen the induction — the force reads the product");

  const zero = Z.attraction({ ...a, charge: 0 }, b);
  assert.equal(Math.hypot(zero.ax, zero.ay), 0, "an uncharged cell courts nothing");

  const coincident = Z.attraction({ nx: 0.5, ny: 0.5, charge: 1 }, { nx: 0.5, ny: 0.5, charge: 1 });
  assert.ok(Number.isFinite(coincident.ax) && Number.isFinite(coincident.ay),
    "two cores at zero distance must pull finitely — the softening is load-bearing");
}

// --- contact: monotone anvils, symmetric test ----------------------------

{
  assert.ok(Z.contactRadius(1) > Z.contactRadius(0.2), "a wetter cell spreads a wider anvil");
  assert.equal(Z.contactRadius(99), Z.contactRadius(Z.CONTACT_WATER_MAX),
    "the anvil saturates — endless water must not grow an endless reach");
  const a = { nx: 0.5, ny: 0.5, charge: 1, water: 0.5 };
  const b = { nx: 0.56, ny: 0.5, charge: 1, water: 0.5 };
  assert.equal(Z.inContact(a, b), Z.inContact(b, a), "contact is symmetric");
}

// --- merge: exact conservation, weighted centroid, commutative -----------

{
  const a = { nx: 0.2, ny: 0.3, charge: 0.9, water: 0.4 };
  const b = { nx: 0.8, ny: 0.35, charge: 0.3, water: 0.7 };
  const m = Z.mergeCells(a, b);
  assert.equal(m.charge, a.charge + b.charge, "a union mints no charge and loses none");
  assert.equal(m.water, a.water + b.water, "the water columns sum exactly");
  // The new court stands between the parents, nearer the heavier throne.
  assert.ok(m.nx > a.nx && m.nx < b.nx, "the merged cell stands between its parents");
  assert.ok(Math.abs(m.nx - a.nx) < Math.abs(m.nx - b.nx),
    "the centroid leans toward the larger charge");
  const m2 = Z.mergeCells(b, a);
  assert.ok(Math.abs(m.nx - m2.nx) < 1e-12 && Math.abs(m.ny - m2.ny) < 1e-12,
    "merge order must not matter — the union is one house either way");
  // Degenerate case: two spent cells still merge somewhere finite.
  const dead = Z.mergeCells({ nx: 0.1, ny: 0.1, charge: 0, water: 0 }, { nx: 0.9, ny: 0.9, charge: 0, water: 0 });
  assert.ok(Number.isFinite(dead.nx) && Number.isFinite(dead.ny), "a chargeless union still lands");
}

// --- calve: the satellite is paid for, not minted ------------------------

{
  const parent = { nx: 0.5, ny: 0.3, charge: 0.9, water: 0.8 };
  const { parent: after, child } = Z.calve(parent, 0.37);
  assert.ok(Math.abs(after.charge + child.charge - parent.charge) < 1e-12,
    "a calve transfers charge — the sum before equals the sum after");
  assert.ok(Math.abs(after.water + child.water - parent.water) < 1e-12,
    "a calve transfers water — nothing is minted for the satellite");
  assert.ok(child.charge > 0 && child.charge < after.charge,
    "the satellite is real but junior — it carries less than the parent keeps");
  const again = Z.calve(parent, 0.37);
  assert.equal(child.nx, again.child.nx, "the same seed stands the satellite on the same shoulder");
  const other = Z.calve(parent, 0.62);
  assert.notEqual(child.nx, other.child.nx, "a different seed picks a different shoulder");
}

// --- thunder: monotone, invertible — the pitch IS the energy -------------

{
  let prev = Infinity;
  for (const e of [0, 0.2, 0.5, 1, 1.7, 2.5]) {
    const hz = Z.thunderHz(e);
    assert.ok(hz < prev, "a bigger bolt must ring lower — monotone, no plateaus");
    prev = hz;
    if (e > 0) {
      assert.ok(Math.abs(Z.energyForHz(hz) - e) < 1e-9,
        `the thunder map must invert: energyForHz(thunderHz(${e})) came back ${Z.energyForHz(hz)}`);
    }
  }
  assert.ok(Z.thunderHz(0) <= Z.THUNDER_HZ_FLOOR + Z.THUNDER_HZ_SPAN, "a spark rings at the top of the register");
  assert.ok(Z.thunderHz(50) >= Z.THUNDER_HZ_FLOOR, "no bolt rings below the floor of the register");
  assert.ok(Z.boltEnergy(1, 1) > Z.boltEnergy(1, 0.2), "a wetter column conducts a hotter strike");
  assert.equal(Z.boltEnergy(0, 5), 0, "no charge, no bolt — water alone cannot strike");
}

// --- the peal: a complete, deterministic, truly nearest-neighbor walk ----

{
  const cells = [
    { nx: 0.1, ny: 0.2 },
    { nx: 0.9, ny: 0.8 },
    { nx: 0.15, ny: 0.25 },
    { nx: 0.5, ny: 0.5 },
    { nx: 0.88, ny: 0.78 },
  ];
  const order = Z.pealOrder(cells, 0);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4],
    "the peal visits every house exactly once");
  assert.equal(order[0], 0, "the verdict starts at the house the hand named");
  // Brute-force the same chain and demand agreement: from each house the
  // next voice is the nearest not yet spoken.
  const expect = [0];
  const used = new Set([0]);
  while (expect.length < cells.length) {
    const here = cells[expect[expect.length - 1]];
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (used.has(i)) continue;
      const d = (cells[i].nx - here.nx) ** 2 + (cells[i].ny - here.ny) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    expect.push(best);
    used.add(best);
  }
  assert.deepEqual(order, expect, "each next voice is the nearest house not yet spoken");
  assert.deepEqual(Z.pealOrder(cells, 0), order, "the same sky peals in the same order every time");
  assert.deepEqual(Z.pealOrder([], 0), [], "an empty sky peals nothing");
  assert.deepEqual(Z.pealOrder(cells, 99), Z.pealOrder(cells, cells.length - 1),
    "an out-of-range start clamps to a real house instead of walking from nowhere");
}

console.log("zeussky ok: induction mirrors, unions conserve, thunder inverts, the peal walks nearest-first");
