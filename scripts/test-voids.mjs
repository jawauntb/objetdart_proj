// The voids (/voids) — the laws that can lie, pinned.
// Falsifiable only: determinism through birth, filament tension held in [0,1]
// with a snap that is exactly a length exceeded, adjacency that is symmetric,
// degree-capped and order-independent, a void that expands monotonically under
// the outflow (and reverses under a negative epoch), an outflow field with net
// positive divergence (it drains, it never merely stirs), node-merge that
// conserves mass into a third attractor that is neither parent, cap retirement
// oldest-first, dilation that slows, walls that hold, and the retiring exhale.

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

const V = loadTsModule("src/lib/voids.ts");

const field = (over = {}) => ({
  windX: 0, windY: 0, gravX: 0, gravY: 0, agitation: 0,
  vortexX: 0.5, vortexY: 0.5, vortexW: 0, epoch: 0.5, timeScale: 1, reduced: false,
  ...over,
});

// ——— determinism: the seed is the whole state ———————————————————————————
// Catches: any Math.random or wall-clock leak into birth.
{
  const a = V.bornNode(1, 0xbeef, 0.4, 0.6, 1000);
  const b = V.bornNode(1, 0xbeef, 0.4, 0.6, 1000);
  assert.deepEqual(a, b, "the same seed must bear the same node, always");
  const c = V.bornNode(1, 0xbeef + 1, 0.4, 0.6, 1000);
  assert.ok(c.vx !== a.vx || c.vy !== a.vy, "a different seed must drift differently");
  assert.equal(V.hashSeed(1, 2, 3), V.hashSeed(1, 2, 3), "hashSeed is a function");
  assert.notEqual(V.hashSeed(1, 2, 3), V.hashSeed(3, 2, 1), "hashSeed hears order");
  assert.equal(a.mass, 1, "a node is born as one cluster");
}

// ——— filament tension is bounded, and the snap is a length exceeded ———————
// Catches: a strain that runs past 1 or below 0; a filament that survives being
// stretched past its snap length; a rest-length that reads as strained.
{
  const mk = (id, x, y) => {
    const s = V.bornNode(id, id * 101, x, y, 0);
    s.growth = 1;
    return s;
  };
  // at the rest length: no strain. near the snap length: near-full strain.
  const rest = [mk(1, 0.5, 0.5), mk(2, 0.5 + V.REST_LEN, 0.5)];
  const restFil = V.weaveFilaments(rest);
  assert.equal(restFil.length, 1, "two nodes at the rest length hold one filament");
  assert.ok(restFil[0].strain < 0.02, "a filament at rest is not strained");

  const taut = V.weaveFilaments([mk(1, 0.5, 0.5), mk(2, 0.5 + V.FILAMENT_REACH * 0.98, 0.5)]);
  assert.equal(taut.length, 1, "a filament that is nearly snapped still stands");
  assert.ok(taut[0].strain > 0.9 && taut[0].strain <= 1, "and it reads near-full strain, never past 1");

  // past the reach: no thread at all — that absence is the snap.
  const snapped = V.weaveFilaments([mk(1, 0.5, 0.5), mk(2, 0.5 + V.FILAMENT_REACH * 1.2, 0.5)]);
  assert.equal(snapped.length, 0, "stretched past the reach, the filament has snapped");

  // adjacency: symmetric, degree-capped, order-independent (a tight cluster).
  const sts = [
    mk(1, 0.5, 0.5), mk(2, 0.56, 0.5), mk(3, 0.44, 0.5), mk(4, 0.5, 0.56),
    mk(5, 0.5, 0.44), mk(6, 0.56, 0.56), mk(7, 0.44, 0.44), mk(8, 0.56, 0.44),
  ];
  const fils = V.weaveFilaments(sts);
  const degree = new Array(sts.length).fill(0);
  for (const f of fils) {
    assert.ok(f.a < f.b, "a filament names its ends once, low index first");
    assert.ok(f.strain >= 0 && f.strain <= 1, "strain is a fraction, always");
    degree[f.a]++;
    degree[f.b]++;
  }
  for (const dg of degree) assert.ok(dg <= V.MAX_DEGREE, "no node strings past MAX_DEGREE");
  assert.ok(fils.length > 0, "a cluster inside reach must weave");
  const shuffled = [sts[3], sts[6], sts[0], sts[7], sts[5], sts[1], sts[4], sts[2]];
  const relinks = V.weaveFilaments(shuffled);
  const key = (arr, f) => {
    const p = [arr[f.a].id, arr[f.b].id].sort((x, y) => x - y);
    return `${p[0]}-${p[1]}`;
  };
  assert.deepEqual(
    fils.map((f) => key(sts, f)).sort(),
    relinks.map((f) => key(shuffled, f)).sort(),
    "the web is a fact about positions, not about array order",
  );
  // a retiring node threads nothing
  sts[0].presence = 0.4;
  for (const f of V.weaveFilaments(sts)) {
    assert.ok(f.a !== 0 && f.b !== 0, "a draining node holds no filament");
  }
}

// ——— the void expands monotonically under the flow ————————————————————————
// Catches: a Hubble rate that ignores its epoch, a radius that drifts down
// under expansion, an outflow that stirs (zero mean) instead of draining.
{
  assert.ok(V.hubbleRate(0.1, 0.5) > 0, "positive epoch expands");
  assert.ok(V.hubbleRate(0.1, -0.5) < 0, "negative epoch collapses");
  assert.equal(V.hubbleRate(0.1, 0), 0, "a frozen epoch neither expands nor collapses");
  assert.ok(V.hubbleRate(0.2, 0.5) > V.hubbleRate(0.1, 0.5), "a bigger void grows faster — dR/dt ∝ R");

  const v = V.bornVoid(1, 0.5, 0.5, 0.1, 0.9, 0);
  let prev = v.radius;
  for (let i = 0; i < 20; i++) {
    V.stepVoids([v], 0.6, 0.05);
    assert.ok(v.radius > prev, "under the flow the void only ever grows");
    prev = v.radius;
  }
  // and reverses under the season run backward
  const w = V.bornVoid(2, 0.5, 0.5, 0.4, 0.9, 0);
  const before = w.radius;
  V.stepVoids([w], -0.6, 0.05);
  assert.ok(w.radius < before, "the season run backward pulls the wall back in");

  // the outflow field has net positive divergence — it drains, never stirs
  const voids = [V.bornVoid(1, 0.5, 0.5, 0.2, 0.9, 0)];
  const out = { x: 0, y: 0 };
  let radialMean = 0;
  const N = 16;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const px = 0.5 + Math.cos(ang) * 0.2;
    const py = 0.5 + Math.sin(ang) * 0.2;
    V.hubbleFlow(px, py, voids, 0.5, out);
    radialMean += out.x * Math.cos(ang) + out.y * Math.sin(ang);
  }
  radialMean /= N;
  assert.ok(radialMean > 0, "averaged around the wall the outflow points outward — it drains");

  // a node near the wall is pushed outward, onto it
  const s = V.bornNode(1, 3, 0.7, 0.5, 0);
  s.vx = 0; s.vy = 0;
  const d0 = Math.hypot(s.nx - 0.5, s.ny - 0.5);
  V.stepWeb([s], [], voids, field({ epoch: 0.6 }), 1000, 0.05);
  assert.ok(Math.hypot(s.nx - 0.5, s.ny - 0.5) > d0, "the emptiness pushes matter to its wall");
}

// ——— node-merge conserves mass into a third attractor ————————————————————
// Catches: a merge that averages, drops, or double-counts mass; a child that
// is secretly one of its parents; an unweighted meeting point.
{
  const a = V.bornNode(1, 11, 0.3, 0.5, 0);
  const b = V.bornNode(2, 22, 0.5, 0.5, 0);
  a.mass = 3;
  b.mass = 5;
  a.vx = 0.02; b.vx = -0.02;
  const c = V.mergeNodes(a, b, 9, 500);
  assert.equal(c.mass, 8, "the great attractor carries both masses whole — mass is conserved");
  assert.notEqual(c.seed, a.seed, "the child is neither parent");
  assert.notEqual(c.seed, b.seed, "the child is neither parent");
  assert.ok(c.nx > a.nx && c.nx < b.nx, "the attractor stands between its parents");
  const mid = (a.nx + b.nx) / 2;
  assert.ok(c.nx > mid, "the heavier cluster (b, at higher x) pulls the meeting point toward itself");
  const p = (a.vx * a.mass + b.vx * b.mass) / (a.mass + b.mass);
  assert.ok(Math.abs(c.vx - p) < 1e-9, "momentum is conserved through the fall");

  // findMergePair only pairs grown, present, close clusters
  const near = [V.bornNode(1, 1, 0.5, 0.5, 0), V.bornNode(2, 2, 0.5 + V.MERGE_REACH * 0.5, 0.5, 0)];
  near[0].growth = near[1].growth = 1;
  assert.ok(V.findMergePair(near), "two grown clusters within reach must find each other");
  const far = [V.bornNode(1, 1, 0.2, 0.5, 0), V.bornNode(2, 2, 0.8, 0.5, 0)];
  far[0].growth = far[1].growth = 1;
  assert.equal(V.findMergePair(far), null, "clusters out of reach do not merge");
}

// ——— a wall collapses inward ——————————————————————————————————————————————
// Catches: a flick that throws nodes outward, or leaves them untouched.
{
  const sts = [V.bornNode(1, 1, 0.3, 0.5, 0), V.bornNode(2, 2, 0.7, 0.5, 0)];
  const { cx } = V.collapseWall(sts, [0, 1], 0.5);
  assert.ok(Math.abs(cx - 0.5) < 1e-9, "the wall falls toward its own centroid");
  assert.ok(sts[0].vx > 0, "the left node is thrown right, toward the centre");
  assert.ok(sts[1].vx < 0, "the right node is thrown left, toward the centre");
}

// ——— stepping: dilation slows, walls hold, retiring exhales ——————————————
// Catches: timeScale ignored, nodes escaping the frame, instant deletes.
{
  const voids = [V.bornVoid(1, 0.5, 0.5, 0.2, 0.9, 0)];
  const a = V.bornNode(1, 3, 0.7, 0.5, 0); a.vx = 0; a.vy = 0;
  const b = V.bornNode(1, 3, 0.7, 0.5, 0); b.vx = 0; b.vy = 0;
  V.stepWeb([a], [], voids, field({ epoch: 0.6, timeScale: 1 }), 1000, 0.05);
  V.stepWeb([b], [], voids, field({ epoch: 0.6, timeScale: 0.25 }), 1000, 0.05);
  const moved = Math.hypot(a.nx - 0.7, a.ny - 0.5);
  const dilated = Math.hypot(b.nx - 0.7, b.ny - 0.5);
  assert.ok(dilated < moved, "a three-finger hold must actually slow the world");

  const runaway = V.bornNode(2, 4, 0.965, 0.5, 0);
  runaway.vx = 5;
  V.stepWeb([runaway], [], [], field(), 1000, 0.05);
  assert.ok(runaway.nx <= 0.97, "the frame's edge holds");

  const retiring = V.bornNode(3, 5, 0.5, 0.5, 0);
  retiring.presence = 0.999;
  V.stepWeb([retiring], [], [], field(), 1000, 0.1);
  assert.ok(retiring.presence > 0 && retiring.presence < 0.999, "draining out is an exhale, not a blink");
}

// ——— the cap retires oldest first ————————————————————————————————————————
{
  const sts = [V.bornNode(1, 1, 0.2, 0.2, 300), V.bornNode(2, 2, 0.4, 0.4, 100), V.bornNode(3, 3, 0.6, 0.6, 200)];
  const idx = V.retireOldest(sts);
  assert.equal(sts[idx].id, 2, "the oldest gives way first");
  assert.equal(V.retireOldest(sts) === idx, false, "an already-retiring node is not retired twice");
}

// ——— the tutti-wave walks the graph, not the screen ———————————————————————
// Catches: a wave that is just radial distance in disguise.
{
  const mk = (id, x, y) => {
    const s = V.bornNode(id, id * 7, x, y, 0);
    s.growth = 1;
    return s;
  };
  // a chain 0-1-2 linked, 3 far off and unlinked
  const sts = [mk(1, 0.2, 0.5), mk(2, 0.32, 0.5), mk(3, 0.44, 0.5), mk(4, 0.9, 0.9)];
  const fils = V.weaveFilaments(sts);
  const order = V.graphOrder(sts, fils, 0);
  assert.equal(order[0], 0, "the struck node is depth zero");
  assert.ok(order[1] === 1 && order[2] === 2, "the wave walks filament by filament");
  assert.equal(order[3], -1, "what the web does not reach, the wave does not reach");
  const wall = V.wallOf(fils, 1);
  assert.ok(wall.includes(0) && wall.includes(1) && wall.includes(2), "a node's wall is itself and its neighbours");
  assert.ok(!wall.includes(3), "an unlinked node is not part of the wall");
}

// ——— pitch stays audible and monotone ————————————————————————————————————
{
  let prev = Infinity;
  for (const m of [1, 2, 4, 8, 16, 32, 64]) {
    const midi = V.massPitchMidi(m);
    assert.ok(midi < prev, "heavier clusters ring lower — monotone");
    assert.ok(midi >= 36 && midi <= 96, "and always inside the register the room sings");
    prev = midi;
  }
}

// ——— persistence round-trips, and an emptied room stays empty ————————————
{
  const nodes = [V.bornNode(1, 10, 0.25, 0.75, 0), V.bornNode(2, 20, 0.5, 0.5, 0)];
  nodes[0].mass = 4;
  const voids = [V.bornVoid(1, 0.4, 0.4, 0.18, 0.9, 0)];
  const kept = V.serializeWeb(nodes, voids);
  const back = V.loadWeb(kept, 5000);
  assert.equal(back.nodes.length, 2, "what stood is what returns");
  assert.equal(back.nodes[0].mass, 4, "a node returns at the mass it was left at");
  assert.ok(Math.abs(back.nodes[0].nx - 0.25) < 0.002, "and where it was left");
  assert.equal(back.voids.length, 1, "the void returns too");
  assert.ok(Math.abs(back.voids[0].radius - 0.18) < 0.002, "at the size it had grown to");
  // a retiring node is not kept — it was already draining out
  nodes[1].presence = 0.5;
  assert.equal(V.serializeWeb(nodes, voids).nodes.length, 1, "a draining node is never kept");
  assert.deepEqual(V.loadWeb({ v: 1, nodes: [], voids: [] }, 0), { nodes: [], voids: [] }, "an emptied web stays empty");
  assert.deepEqual(V.loadWeb("garbage", 0), { nodes: [], voids: [] }, "a corrupt keep is a fresh field, not a crash");
}

console.log("voids: ok");
