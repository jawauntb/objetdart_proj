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
  vm.runInNewContext(code, { module, exports: module.exports }, { filename });
  return module.exports;
}

const { flockFromSeed, stepFlock, roostBird } = loadTsModule("src/lib/birds.ts");

const forces = {
  separation: 1.8,
  alignment: 1.1,
  cohesion: 0.9,
  windX: 0,
  windY: 0,
  scare: null,
  maxSpeed: 0.4,
};

{
  const a = flockFromSeed(123, 40);
  const b = flockFromSeed(123, 40);
  assert.equal(a.length, 40);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(flockFromSeed(123, 40)[0]), JSON.stringify(flockFromSeed(124, 40)[0]));
  assert.equal(flockFromSeed(1, 1000).length, 200, "flock is hard-capped");
}

{
  let flock = flockFromSeed(9, 30);
  for (let i = 0; i < 60; i++) flock = stepFlock(flock, 1 / 60, forces);
  for (const b of flock) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(Math.hypot(b.vx, b.vy) <= forces.maxSpeed + 1e-6);
  }
}

{
  let flock = flockFromSeed(2, 20);
  const before = flock.map((b) => ({ ...b }));
  flock = stepFlock(flock, 1 / 30, {
    ...forces,
    scare: { x: 0.5, y: 0.4, strength: 4 },
  });
  const moved = flock.some((b, i) => Math.hypot(b.x - before[i].x, b.y - before[i].y) > 1e-4);
  assert.ok(moved, "a scare moves the flock");
}

{
  let flock = flockFromSeed(5, 10);
  const sp0 = Math.hypot(flock[0].vx, flock[0].vy);
  flock = roostBird(flock, 0);
  const sp1 = Math.hypot(flock[0].vx, flock[0].vy);
  assert.ok(sp1 < sp0, "roost damps speed");
}

console.log("birds ok");
