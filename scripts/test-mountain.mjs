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
  ridgeHeight,
  kickScree,
  stepScree,
  placeCairn,
  snowLine,
  cairnStonesForHold,
  nearestCairnIndex,
  screeCairnHits,
  CAIRN_DWELL_MS,
} = loadTsModule("src/lib/mountain.ts");

{
  for (let i = 0; i <= 20; i++) {
    const h = ridgeHeight(i / 20, 7);
    assert.ok(h >= 0 && h <= 1);
    assert.equal(h, ridgeHeight(i / 20, 7));
  }
  const samples = Array.from({ length: 40 }, (_, i) => ridgeHeight(i / 40, 7));
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.2, "ridge rises");
  assert.ok(ridgeHeight(0.5, 7) > ridgeHeight(0.05, 7), "peak near center");
}

{
  const grains = kickScree(3, 0.5, 0.4, 0.8);
  assert.ok(grains.length >= 4);
  const moved = stepScree(grains, 0.05);
  assert.ok(moved.some((g, i) => g.y !== grains[i]?.y || g.x !== grains[i]?.x));
  let g = grains;
  for (let i = 0; i < 80; i++) g = stepScree(g, 0.05);
  assert.ok(g.length <= grains.length, "scree retires");
}

{
  const c = placeCairn(9, 0.4, 0.5, 12);
  assert.equal(c.stones, 7, "cairn stones are capped");
  assert.ok(placeCairn(1, 0, 0, 1).stones >= 1);
}

{
  const a = snowLine(0, 0);
  const b = snowLine(0, 1);
  assert.ok(b < a, "weather lowers the snow line");
}

// —— the hold is an axis, not a switch ————————————————————————
// The bug: a cairn that is the same cairn at 900ms and at 2400ms. Duration
// is the richest dimension the hand has, and a binding that ignores it is
// the grammar's own named failure (docs/gesture-grammar.md §5).
{
  assert.equal(cairnStonesForHold(0), 0, "a tap builds nothing");
  assert.equal(cairnStonesForHold(CAIRN_DWELL_MS - 1), 0, "and neither does a touch below the dwell");
  assert.equal(cairnStonesForHold(CAIRN_DWELL_MS), 1, "the dwell lands the first stone");
  let prev = -1;
  let grew = 0;
  for (let ms = 0; ms <= 12000; ms += 25) {
    const n = cairnStonesForHold(ms);
    assert.ok(n >= prev, `the cairn never shrinks while the hand stays (${ms}ms)`);
    assert.ok(n <= 7, "and never outgrows what a cairn can carry");
    if (n > prev && prev >= 0) grew++;
    prev = n;
  }
  assert.ok(grew >= 6, `every stone is reachable by holding longer (${grew} steps)`);
  assert.ok(
    cairnStonesForHold(2400) > cairnStonesForHold(900),
    "2400ms is a taller cairn than 900ms — the tier is not the end of the hold",
  );
  // ...and pressure is an axis too: the same second under a harder press
  // builds more, never less.
  for (const ms of [1600, 2400, 3600]) {
    assert.ok(
      cairnStonesForHold(ms, 1) >= cairnStonesForHold(ms, 0),
      `a harder press builds at least as fast (${ms}ms)`,
    );
  }
  assert.ok(cairnStonesForHold(3000, 1) > cairnStonesForHold(3000, 0), "and strictly faster somewhere");
}

// —— reaching an existing cairn, in the frame's own units ————————
// The bug: hit-testing in normalized coordinates without the aspect ratio.
// On a 900x400 frame a cairn a third of the screen away horizontally reads
// as 0.33 in x and 0.33 in y alike — so the ceremony hold would unmake a
// cairn the hand was nowhere near, on desktop only.
{
  const cairns = [placeCairn(1, 0.20, 0.50, 3), placeCairn(2, 0.60, 0.50, 3), placeCairn(3, 0.62, 0.80, 3)];
  assert.equal(nearestCairnIndex(cairns, 0.21, 0.51, 0.06), 0, "the finger finds the cairn under it");
  assert.equal(nearestCairnIndex(cairns, 0.40, 0.50, 0.06), -1, "open ground is open ground");
  assert.equal(nearestCairnIndex(cairns, 0.61, 0.79, 0.06), 2, "and the nearer of two neighbours wins");
  assert.equal(nearestCairnIndex([], 0.5, 0.5, 0.5), -1, "an empty range has nothing to reach");
  // A point 0.05 away in x is inside the radius on a square frame and
  // outside it on a frame twice as wide, because in pixels it is twice as far.
  assert.equal(nearestCairnIndex(cairns, 0.25, 0.50, 0.06, 1), 0, "square frame: still within reach");
  assert.equal(nearestCairnIndex(cairns, 0.25, 0.50, 0.06, 2.25), -1, "wide frame: the same offset is out of reach");
}

// —— the physics between the two populations: scree strikes a cairn ————
// The bug: a falling stone and a standing cairn never touching, so the
// mountain's two populations are two independent decal layers rather than
// one material acting on itself.
{
  const cairns = [placeCairn(1, 0.5, 0.5, 4), placeCairn(2, 0.9, 0.9, 4)];
  const near = [{ x: 0.505, y: 0.5, vx: 0, vy: 0.1, seed: 1, life: 1 }];
  const far = [{ x: 0.1, y: 0.1, vx: 0, vy: 0.1, seed: 2, life: 1 }];
  const hitsNear = screeCairnHits(near, cairns, 1);
  assert.equal(hitsNear.length, 1, "a stone passing right through a cairn strikes it");
  assert.equal(hitsNear[0].cairnIdx, 0, "it strikes the cairn it actually passed, not some other one");
  assert.equal(screeCairnHits(far, cairns, 1).length, 0, "a stone nowhere near a cairn does not strike it");
  // aspect matters here exactly as it does for touch: the same offset reads
  // as a strike on a square frame and a miss on a frame twice as wide
  const side = [{ x: 0.5 + 0.025, y: 0.5, vx: 0, vy: 0.1, seed: 3, life: 1 }];
  assert.equal(screeCairnHits(side, cairns, 1).length, 1, "square frame: within the strike radius");
  assert.equal(screeCairnHits(side, cairns, 2.5).length, 0, "wide frame: the same offset reads further and misses");
  assert.equal(screeCairnHits([], cairns, 1).length, 0, "no falling stones, no strikes");
  assert.equal(screeCairnHits(near, [], 1).length, 0, "no standing cairns, nothing to strike");
}

console.log(
  "mountain ok: ridge deterministic and peaked, scree retiring, cairns capped, the hold continuous in both duration and pressure, cairn reach measured in real pixels, and falling scree actually strikes a standing cairn",
);
