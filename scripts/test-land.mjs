// The land (/land) — the laws that can lie, pinned.
// Falsifiable only: determinism from the seed, the two conservation laws under
// erosion (surface water only moves; ground+sediment only trade), water that
// actually runs downhill, an angle of repose the slumps honour, vegetation
// bounded in [0,1] and monotone in its causes, a watershed that descends and
// replays, and a persistence round-trip that keeps the parcel.

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

const L = loadTsModule("src/lib/land.ts");

const N = 24; // small enough to be fast, large enough to have real hydrology

/** Steepest D4 neighbour drop anywhere on the field — the repose witness. */
function maxNeighborDrop(t) {
  const n = t.n;
  let worst = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const neigh = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [ox, oy] of neigh) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const diff = t.h[i] - t.h[ny * n + nx];
        if (diff > worst) worst = diff;
      }
    }
  }
  return worst;
}

// ——— determinism: the seed is the whole parcel ————————————————————————————
// Catches: any Math.random or wall-clock leak into generation.
{
  const a = L.makeTerrain(N, 0xbeef);
  const b = L.makeTerrain(N, 0xbeef);
  assert.deepEqual(a.h, b.h, "the same seed must raise the same ground, always");
  assert.deepEqual(a.g, b.g, "and the same grass on it");
  const c = L.makeTerrain(N, 0xbeef + 1);
  let differs = false;
  for (let i = 0; i < a.h.length; i++) if (a.h[i] !== c.h[i]) differs = true;
  assert.ok(differs, "a different seed must raise different ground");
  assert.equal(L.hashSeed(1, 2, 3), L.hashSeed(1, 2, 3), "hashSeed is a function");
  assert.notEqual(L.hashSeed(1, 2, 3), L.hashSeed(3, 2, 1), "hashSeed hears order");
  // value noise is smooth and in range
  for (let k = 0; k < 20; k++) {
    const v = L.valueNoise(k * 0.37, k * 0.91, 7);
    assert.ok(v >= 0 && v <= 1, "value noise stays in [0,1]");
  }
}

// ——— erosion conserves water, and ground+sediment ————————————————————————
// Catches: a flow step that leaks water off the frame, or an erosion that
// mints or destroys soil instead of carrying it.
{
  const t = L.makeTerrain(N, 42);
  L.rain(t, N * 0.5, N * 0.3, 4, 0.6);
  L.rain(t, N * 0.3, N * 0.7, 5, 0.4);
  const w0 = L.totalWater(t);
  const mat0 = L.totalMaterial(t);
  assert.ok(w0 > 0, "there must be water to conserve");
  for (let step = 0; step < 40; step++) L.stepHydrology(t, 0.05);
  const w1 = L.totalWater(t);
  const mat1 = L.totalMaterial(t);
  assert.ok(Math.abs(w1 - w0) < 1e-9, `surface water is only moved, never lost (${w0} → ${w1})`);
  assert.ok(
    Math.abs(mat1 - mat0) < 1e-9,
    `ground and sediment only trade with each other (${mat0} → ${mat1})`,
  );
  // and the flow must actually do work — some soil is now in transit.
  let anySediment = 0;
  for (let i = 0; i < t.s.length; i++) anySediment += t.s[i];
  assert.ok(anySediment > 0, "flowing water must actually pick up soil");
}

// ——— water flows downhill, never up ——————————————————————————————————————
// Catches: a flow that ignores the surface gradient, or spreads isotropically.
{
  const t = L.makeTerrain(8, 1);
  const n = t.n;
  // a clean ramp rising with x; a lump of water on an interior cell.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      t.h[y * n + x] = x; // higher x = higher ground
      t.w[y * n + x] = 0;
      t.s[y * n + x] = 0;
    }
  }
  const ym = 4;
  const xm = 3;
  t.w[ym * n + xm] = 1;
  const before = L.totalWater(t);
  L.stepHydrology(t, 0.05);
  assert.ok(t.w[ym * n + (xm - 1)] > 0, "water reaches the lower neighbour");
  assert.equal(t.w[ym * n + (xm + 1)], 0, "water never climbs to the higher neighbour");
  assert.ok(Math.abs(L.totalWater(t) - before) < 1e-9, "and the ramp is a closed basin");
}

// ——— the angle of repose holds ———————————————————————————————————————————
// Catches: a slump that leaks mass, or a slope that never settles.
{
  const t = L.makeTerrain(N, 5);
  L.raiseHummock(t, N * 0.5, N * 0.5, 2, 3.0); // a sharp spike, well over repose
  const before = L.totalMaterial(t);
  assert.ok(maxNeighborDrop(t) > L.REPOSE, "the spike starts steeper than repose");
  L.settleSlopes(t, 300);
  const after = L.totalMaterial(t);
  assert.ok(Math.abs(after - before) < 1e-9, "a slump carries the hill, it never deletes it");
  assert.ok(
    maxNeighborDrop(t) <= L.REPOSE + 1e-3,
    `settling drives every slope under the angle of repose (worst ${maxNeighborDrop(t)})`,
  );
  // slump at a point is the same conservation
  L.raiseHummock(t, N * 0.3, N * 0.3, 1.5, 2.0);
  const b2 = L.totalMaterial(t);
  L.slump(t, N * 0.3, N * 0.3, 3);
  assert.ok(Math.abs(L.totalMaterial(t) - b2) < 1e-9, "a landslide conserves mass too");
}

// ——— wind wears the peaks down, and conserves the dust ———————————————————
// Catches: a wind erosion that removes material to nowhere.
{
  const t = L.makeTerrain(N, 9);
  // an isolated peak on flat ground
  for (let i = 0; i < t.h.length; i++) t.h[i] = 0.2;
  const px = 12;
  const py = 12;
  t.h[py * t.n + px] = 1.4;
  const before = L.totalMaterial(t);
  const peak0 = t.h[py * t.n + px];
  L.windErosion(t, 1, 0, 0.5); // wind blowing toward +x
  assert.ok(Math.abs(L.totalMaterial(t) - before) < 1e-9, "wind carries the dust, it does not delete it");
  assert.ok(t.h[py * t.n + px] < peak0, "the exposed peak wears down");
  assert.ok(t.h[py * t.n + (px + 1)] > 0.2, "and the dust gathers in its lee");
}

// ——— vegetation is bounded, and grows for the right reasons ————————————————
// Catches: green outside [0,1], or a target that greens the cliff and the desert.
{
  // bounds and monotonicity of the target
  for (let mi = 0; mi <= 10; mi++) {
    for (let si = 0; si <= 10; si++) {
      const g = L.greenTarget(mi / 10, (si / 10) * L.REPOSE * 4, 0);
      assert.ok(g >= 0 && g <= 1, "green cover is always a fraction");
    }
  }
  assert.ok(
    L.greenTarget(0.8, 0, 0) > L.greenTarget(0.2, 0, 0),
    "wetter ground greens more",
  );
  assert.ok(
    L.greenTarget(0.8, 0, 0) > L.greenTarget(0.8, L.REPOSE * 3, 0),
    "a steeper slope greens less",
  );
  assert.ok(
    L.greenTarget(0.8, 0, 0) > L.greenTarget(0.8, 0, 0.5),
    "flooded ground greens less",
  );

  // a flat wet cell greens; a steep dry cell does not — over real steps.
  const t = L.makeTerrain(N, 3);
  for (let i = 0; i < t.h.length; i++) {
    t.g[i] = 0;
  }
  // flatten a patch and wet it
  const wetFlat = 10 * t.n + 10;
  for (let y = 8; y < 13; y++) for (let x = 8; x < 13; x++) t.h[y * t.n + x] = 0.5;
  t.m[wetFlat] = 0.9;
  // a steep dry ridge
  const dry = 3 * t.n + 3;
  t.h[dry] = 2.0;
  t.h[dry + 1] = 0.0;
  t.m[dry] = 0.0;
  for (let step = 0; step < 30; step++) L.stepVegetation(t, 0.1);
  for (let i = 0; i < t.g.length; i++) {
    assert.ok(t.g[i] >= 0 && t.g[i] <= 1, "cover never leaves [0,1] under stepping");
  }
  assert.ok(t.g[wetFlat] > 0.4, "the flat wet cell greens");
  assert.ok(t.g[dry] < 0.15, "the steep dry cell stays bare");
}

// ——— the watershed descends, and replays ————————————————————————————————
// Catches: a river that runs uphill, or a non-deterministic course.
{
  const t = L.makeTerrain(N, 77);
  const river = L.setWatershed(t);
  assert.ok(river.length >= 2, "a river is a course, not a point");
  const n = t.n;
  for (let i = 1; i < river.length; i++) {
    const a = river[i - 1];
    const b = river[i];
    const sa = t.h[a] + t.w[a];
    const sb = t.h[b] + t.w[b];
    assert.ok(sb <= sa + 1e-9, "a river never runs uphill");
  }
  const again = L.setWatershed(L.makeTerrain(N, 77));
  assert.deepEqual(again, river, "the same parcel finds the same course");
  void n;
}

// ——— flatten empties the parcel, and it stays empty ——————————————————————
{
  const t = L.makeTerrain(N, 11);
  L.raiseHummock(t, N * 0.5, N * 0.5, 3, 2);
  L.rain(t, N * 0.5, N * 0.5, 4, 1);
  L.setWatershed(t);
  L.flatten(t);
  const mean = t.h[0];
  for (let i = 0; i < t.h.length; i++) {
    assert.ok(Math.abs(t.h[i] - mean) < 1e-9, "a flattened parcel is level");
    assert.equal(t.w[i], 0, "the water has drained");
  }
  assert.equal(t.river.length, 0, "and the river is forgotten");
}

// ——— persistence round-trips the parcel ——————————————————————————————————
{
  const t = L.makeTerrain(N, 20);
  L.raiseHummock(t, N * 0.4, N * 0.6, 2.5, 1.5);
  L.settleSlopes(t, 20);
  L.setWatershed(t);
  const kept = L.serializeLand(t);
  const back = L.loadLand(kept);
  assert.ok(back, "a kept parcel loads back");
  assert.equal(back.n, t.n, "at the same grid");
  assert.equal(back.seed, t.seed, "and the same seed");
  assert.deepEqual(back.river, t.river, "the river's course is kept");
  // heights within the quantisation step of the stored range
  let hmax = -Infinity;
  let hmin = Infinity;
  for (let i = 0; i < t.h.length; i++) {
    if (t.h[i] > hmax) hmax = t.h[i];
    if (t.h[i] < hmin) hmin = t.h[i];
  }
  const step = (hmax - hmin) / 1000 + 1e-9;
  for (let i = 0; i < t.h.length; i++) {
    assert.ok(Math.abs(back.h[i] - t.h[i]) <= step, "a cell returns at the height it was left");
    assert.ok(Math.abs(back.g[i] - t.g[i]) <= 1 / 255 + 1e-9, "and the grass it wore");
  }
  assert.equal(L.loadLand("garbage"), null, "a corrupt keep is a fresh field, not a crash");
  assert.equal(L.loadLand({ v: 2 }), null, "an unknown version is refused");
}

console.log("land: ok");
