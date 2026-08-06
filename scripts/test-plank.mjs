// The floor of the world (/plank) — the laws that can lie, pinned.
// Falsifiable only: spin conservation through fusion and budding, the j³
// evaporation clock in closed form, the collapse threshold, adjacency that is
// symmetric, degree-capped and order-independent, a divergence-free churn,
// cap retirement oldest-first, and determinism throughout.

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
  // Same realm as the test — vm.runInNewContext yields string primitives that
  // fail deepStrictEqual against host literals despite identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const P = loadTsModule("src/lib/plank.ts");

// ——— determinism: the seed is the whole state ———————————————————————————
// Catches: any Math.random or wall-clock leak into birth.
{
  const a = P.bornStitch(1, 0xbeef, 0.4, 0.6, 1000);
  const b = P.bornStitch(1, 0xbeef, 0.4, 0.6, 1000);
  assert.deepEqual(a, b, "the same seed must bear the same stitch, always");
  const c = P.bornStitch(1, 0xbeef + 1, 0.4, 0.6, 1000);
  assert.ok(c.vx !== a.vx || c.vy !== a.vy, "a different seed must drift differently");
  assert.equal(P.hashSeed(1, 2, 3), P.hashSeed(1, 2, 3), "hashSeed is a function");
  assert.notEqual(P.hashSeed(1, 2, 3), P.hashSeed(3, 2, 1), "hashSeed hears order");
}

// ——— fusion conserves spin, and makes a third thing ——————————————————————
// Catches: a merge that averages, drops, or double-counts j; a child that is
// secretly one of its parents.
{
  const a = P.bornStitch(1, 11, 0.3, 0.5, 0);
  const b = P.bornStitch(2, 22, 0.5, 0.5, 0);
  a.j = 3;
  b.j = 4;
  a.growth = b.growth = 1;
  const c = P.fuseStitches(a, b, 9, 500);
  assert.equal(c.j, 7, "fusion must carry both spins whole — j is conserved");
  assert.equal(c.holeMs, null, "seven is a loop, not yet a hole");
  assert.notEqual(c.seed, a.seed, "the child is neither parent");
  assert.notEqual(c.seed, b.seed, "the child is neither parent");
  assert.ok(c.nx > a.nx && c.nx < b.nx, "the child stands between its parents");
  // spin-weighted: the heavier parent pulls the meeting point toward itself
  const mid = (a.nx + b.nx) / 2;
  assert.ok(Math.abs(c.nx - mid) > 1e-6, "the meeting point is weighted, not the midpoint");
}

// ——— the collapse threshold ————————————————————————————————————————————
// Catches: a fusion that grows without limit, or a threshold off by one.
{
  const a = P.bornStitch(1, 5, 0.4, 0.5, 0);
  const b = P.bornStitch(2, 6, 0.6, 0.5, 0);
  a.j = P.SPIN_COLLAPSE - 1;
  b.j = 1;
  let c = P.fuseStitches(a, b, 3, 100);
  assert.equal(c.holeMs, null, "exactly SPIN_COLLAPSE still stands as a loop");
  b.j = 2;
  c = P.fuseStitches(a, b, 4, 100);
  assert.notEqual(c.holeMs, null, "past SPIN_COLLAPSE the weave makes a hole, not a loop");
  assert.equal(c.holeJ, P.SPIN_COLLAPSE + 1, "the hole remembers the spin it swallowed");
}

// ——— evaporation: τ ∝ j³, closed form ————————————————————————————————————
// Catches: linear lifetimes, counters instead of clocks, a phase that climbs.
{
  assert.equal(P.evaporationMs(2) / P.evaporationMs(1), 8, "twice the spin lives eight times as long");
  assert.equal(P.evaporationMs(3) / P.evaporationMs(1), 27, "the cube, exactly");
  const s = P.bornStitch(1, 9, 0.5, 0.5, 0);
  s.j = 2;
  P.collapseStitch(s, 1000);
  assert.equal(P.holePhase(s, 1000), 1, "a fresh hole has its whole life ahead");
  const half = P.holePhase(s, 1000 + P.evaporationMs(2) / 2);
  assert.ok(half > 0.49 && half < 0.51, "half the clock is half the life — closed form, no drift");
  assert.equal(P.holePhase(s, 1000 + P.evaporationMs(2)), 0, "and then it is gone");
  assert.equal(P.holePhase(s, 999999999), 0, "never negative, however long the tab slept");
}

// ——— budding conserves spin ————————————————————————————————————————————
// Catches: a bud that mints spin from nothing, or takes from an empty loop.
{
  const parent = P.bornStitch(1, 77, 0.5, 0.5, 0);
  parent.j = 3;
  const before = parent.j;
  const child = P.budFrom(parent, 2, 100);
  assert.ok(child, "a loop with spin to spare must bud");
  assert.equal(parent.j + child.j, before, "budding moves spin, never makes it");
  assert.equal(child.j, 1, "the satellite carries exactly one unit");
  parent.j = 1;
  assert.equal(P.budFrom(parent, 3, 200), null, "a loop of one has only itself — no bud");
}

// ——— adjacency is symmetric, capped, and order-independent ———————————————
// Catches: directed links, unbounded degree, an order-dependent weave.
{
  const mk = (id, x, y) => {
    const s = P.bornStitch(id, id * 101, x, y, 0);
    s.growth = 1;
    return s;
  };
  // a tight cluster of six around one center — the center cannot thread all
  const sts = [
    mk(1, 0.5, 0.5),
    mk(2, 0.56, 0.5),
    mk(3, 0.44, 0.5),
    mk(4, 0.5, 0.56),
    mk(5, 0.5, 0.44),
    mk(6, 0.56, 0.56),
    mk(7, 0.44, 0.44),
  ];
  const links = P.weaveLinks(sts);
  const degree = new Array(sts.length).fill(0);
  for (const l of links) {
    assert.ok(l.a < l.b, "a link names its ends once, low index first");
    degree[l.a]++;
    degree[l.b]++;
  }
  for (const d of degree) assert.ok(d <= P.MAX_DEGREE, "no node threads past MAX_DEGREE");
  assert.ok(links.length > 0, "a cluster inside reach must weave");
  // order-independence: shuffle the array, the same edges (by id pairs) form
  const shuffled = [sts[3], sts[6], sts[0], sts[5], sts[1], sts[4], sts[2]];
  const relinks = P.weaveLinks(shuffled);
  const key = (arr, l) => {
    const p = [arr[l.a].id, arr[l.b].id].sort((x, y) => x - y);
    return `${p[0]}-${p[1]}`;
  };
  assert.deepEqual(
    links.map((l) => key(sts, l)).sort(),
    relinks.map((l) => key(shuffled, l)).sort(),
    "the weave is a fact about positions, not about array order",
  );
  // holes thread nothing
  P.collapseStitch(sts[0], 10);
  for (const l of P.weaveLinks(sts)) {
    assert.ok(l.a !== 0 && l.b !== 0, "a pinprick in the weave has no threads");
  }
}

// ——— the churn is divergence-free and bounded ————————————————————————————
// Catches: a drift field that drains to a corner, or blows up with epoch.
{
  const out = { x: 0, y: 0 };
  let sum = 0;
  for (let gx = 0; gx < 8; gx++) {
    for (let gy = 0; gy < 8; gy++) {
      P.foamDrift(gx / 8 + 0.06, gy / 8 + 0.06, 12.5, 0xa11ce, 1, out);
      assert.ok(Math.abs(out.x) < 0.1 && Math.abs(out.y) < 0.1, "the churn stays a churn, never a launch");
      sum += out.x + out.y;
    }
  }
  assert.ok(Math.abs(sum / 64) < 0.01, "averaged over the field, the foam goes nowhere — it stirs");
  P.foamDrift(0.3, 0.7, 5, 42, 0, out);
  const calm = Math.hypot(out.x, out.y);
  P.foamDrift(0.3, 0.7, 5, 42, 1, out);
  const fury = Math.hypot(out.x, out.y);
  assert.ok(fury > calm, "the epoch dial must actually quicken the vacuum");
}

// ——— stepping: dilation slows, walls hold, retiring exhales ——————————————
// Catches: timeScale ignored, stitches escaping the frame, instant deletes.
{
  const input = {
    windX: 0, windY: 0, gravX: 0, gravY: 0, agitation: 0,
    vortexX: 0.5, vortexY: 0.5, vortexW: 0, epoch: 0.5, timeScale: 1, reduced: false,
  };
  const a = P.bornStitch(1, 3, 0.5, 0.5, 0);
  const b = P.bornStitch(1, 3, 0.5, 0.5, 0);
  P.stepWeave([a], [], input, 1000, 0.05);
  P.stepWeave([b], [], { ...input, timeScale: 0.25 }, 1000, 0.05);
  const moved = Math.hypot(a.nx - 0.5, a.ny - 0.5);
  const dilated = Math.hypot(b.nx - 0.5, b.ny - 0.5);
  assert.ok(dilated < moved, "a three-finger hold must actually slow the world");
  const runaway = P.bornStitch(2, 4, 0.965, 0.5, 0);
  runaway.vx = 5;
  P.stepWeave([runaway], [], input, 1000, 0.05);
  assert.ok(runaway.nx <= 0.97, "the frame's edge holds");
  const retiring = P.bornStitch(3, 5, 0.5, 0.5, 0);
  retiring.presence = 0.999;
  P.stepWeave([retiring], [], input, 1000, 0.1);
  assert.ok(retiring.presence > 0 && retiring.presence < 0.999, "unraveling is an exhale, not a blink");
}

// ——— the cap retires oldest first ————————————————————————————————————————
{
  const sts = [P.bornStitch(1, 1, 0.2, 0.2, 300), P.bornStitch(2, 2, 0.4, 0.4, 100), P.bornStitch(3, 3, 0.6, 0.6, 200)];
  const idx = P.retireOldest(sts);
  assert.equal(sts[idx].id, 2, "the oldest gives way first");
  assert.equal(P.retireOldest(sts) === idx, false, "an already-retiring stitch is not retired twice");
}

// ——— the loom-wave walks the graph, not the screen ———————————————————————
// Catches: a tier-5 wave that is just radial distance in disguise.
{
  const mk = (id, x, y) => {
    const s = P.bornStitch(id, id * 7, x, y, 0);
    s.growth = 1;
    return s;
  };
  // a chain: 0-1-2 linked, 3 far off and unlinked
  const sts = [mk(1, 0.2, 0.5), mk(2, 0.3, 0.5), mk(3, 0.4, 0.5), mk(4, 0.9, 0.9)];
  const links = P.weaveLinks(sts);
  const order = P.graphOrder(sts, links, 0);
  assert.equal(order[0], 0, "the struck stitch is depth zero");
  assert.ok(order[1] === 1 && order[2] === 2, "the wave walks thread by thread");
  assert.equal(order[3], -1, "what the weave does not reach, the wave does not reach");
}

// ——— pitch and the standing wave stay audible and monotone ———————————————
{
  let prev = Infinity;
  for (let j = 1; j <= P.SPIN_COLLAPSE; j++) {
    const m = P.spinPitchMidi(j);
    assert.ok(m < prev || j === 1, "heavier loops ring lower — monotone, like a string");
    assert.ok(m >= 48 && m <= 108, "and always inside the register the room sings");
    prev = m;
  }
  assert.ok(P.waveHz(60) > P.waveHz(400), "wider hands hold a deeper mode");
  for (const px of [0, 60, 300, 900]) {
    const hz = P.waveHz(px);
    assert.ok(hz >= 150 && hz <= 1800, `a span of ${px}px must stay audible, got ${hz}`);
  }
}

// ——— persistence round-trips, and an emptied room stays empty ————————————
{
  const sts = [P.bornStitch(1, 10, 0.25, 0.75, 0), P.bornStitch(2, 20, 0.5, 0.5, 0)];
  sts[0].j = 4;
  const kept = P.serializeWeave(sts);
  const back = P.loadWeave(kept, 5000);
  assert.equal(back.length, 2, "what stood is what returns");
  assert.equal(back[0].j, 4, "a stitch returns at the spin it was left at");
  assert.ok(Math.abs(back[0].nx - 0.25) < 0.002, "and where it was left");
  // a hole is not kept — it was already giving itself back
  P.collapseStitch(sts[1], 100);
  assert.equal(P.serializeWeave(sts).stitches.length, 1, "holes are never kept");
  assert.deepEqual(P.loadWeave({ v: 1, stitches: [] }, 0), [], "an emptied weave stays empty");
  assert.deepEqual(P.loadWeave("garbage", 0), [], "a corrupt keep is a fresh floor, not a crash");
}

console.log("plank: ok");
