// The shared forked-bolt geometry — laws pinned by cases a bug would break.
// Not a snapshot suite: each block names the bug it catches (a Math.random
// leak, a branch that inherits into main, a cap that overshoots, a fractal
// that trends flat with depth). If a check is not falsifiable, it does not
// belong here.

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

const L = loadTsModule("src/lib/lightning.ts");
const CFG = L.DEFAULT_BOLT_CFG;

// ——— determinism: the seed is the whole state ———————————————————————————
// Catches: any Math.random or wall-clock leak into buildBolt; a hidden
// counter that advances between calls.
{
  const a = L.buildBolt(0, 0, 800, 600, CFG, 0xa11ce);
  const b = L.buildBolt(0, 0, 800, 600, CFG, 0xa11ce);
  assert.deepEqual(a, b, "the same inputs must return the same bolt, always");
  const c = L.buildBolt(0, 0, 800, 600, CFG, 0xa11ce + 1);
  assert.ok(a.length !== c.length || a.some((s, i) => s.x0 !== c[i].x0 || s.y0 !== c[i].y0),
    "a different seed must draw a different bolt");
}

// ——— the main channel traces start → end as a connected polyline ————————
// Catches: a split that loses the endpoint, a branch that mislabels itself
// main, a walk order that leaves the leaves out of sequence.
{
  const x0 = 40, y0 = 20, x1 = 760, y1 = 580;
  const segs = L.buildBolt(x0, y0, x1, y1, CFG, 42).filter((s) => s.main);
  assert.ok(segs.length > 0, "the main channel emits at least one leaf");
  // first leaf starts at (x0,y0); last leaf ends at (x1,y1)
  assert.equal(segs[0].x0, x0, "the polyline opens at the strike's origin");
  assert.equal(segs[0].y0, y0, "the polyline opens at the strike's origin");
  assert.equal(segs[segs.length - 1].x1, x1, "the polyline closes at the impact");
  assert.equal(segs[segs.length - 1].y1, y1, "the polyline closes at the impact");
  // adjacent leaves share endpoints — the polyline is continuous
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i].x0, segs[i - 1].x1,
      `main leaves ${i - 1}→${i} must share x (a break here means main is disjoint)`);
    assert.equal(segs[i].y0, segs[i - 1].y1,
      `main leaves ${i - 1}→${i} must share y`);
  }
}

// ——— generations pushes segment count upward (on average) ————————————————
// Catches: a depth knob that does nothing; a termination check that fires
// too early and caps the fractal flat.
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const avgFor = (gen) => {
    let sum = 0;
    for (const s of seeds) {
      sum += L.buildBolt(0, 0, 900, 700, { ...CFG, generations: gen }, s).length;
    }
    return sum / seeds.length;
  };
  let prev = avgFor(2);
  for (const gen of [3, 4, 5, 6]) {
    const now = avgFor(gen);
    assert.ok(now > prev,
      `average segment count must grow with generations (${gen}: ${now} vs ${gen - 1}: ${prev})`);
    prev = now;
  }
}

// ——— branchProb: 0 produces no branches ————————————————————————————————
// Catches: a branch that fires unconditionally; a fork-probability check
// that reads a stale variable and slips one through.
{
  for (const seed of [1, 17, 99, 3141, 0xdeadbeef]) {
    const segs = L.buildBolt(0, 0, 900, 700, { ...CFG, branchProb: 0 }, seed);
    const branchCount = segs.filter((s) => !s.main).length;
    assert.equal(branchCount, 0,
      `branchProb=0 must forbid branches (seed ${seed} emitted ${branchCount})`);
  }
  // and at branchProb=1 branches are almost always present given depth
  let anyBranchAt1 = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const segs = L.buildBolt(0, 0, 900, 700, { ...CFG, branchProb: 1 }, seed);
    if (segs.some((s) => !s.main)) anyBranchAt1++;
  }
  assert.ok(anyBranchAt1 >= 4,
    `branchProb=1 with generations ≥ 6 must yield branches on nearly every seed (${anyBranchAt1}/5)`);
}

// ——— maxSegments caps the returned array ————————————————————————————————
// Catches: a cap that is checked before-only-not-during, letting a
// pathological seed overshoot; a cap of zero taken as "no limit".
{
  for (const cap of [1, 4, 16, 64]) {
    const segs = L.buildBolt(0, 0, 800, 600, { ...CFG, maxSegments: cap, generations: 10 }, 7);
    assert.ok(segs.length <= cap,
      `cap ${cap} must hold (got ${segs.length})`);
    assert.ok(segs.length > 0, "the bolt still emits at least one segment under a cap");
  }
}

// ——— minSegLen bounds the fractal's depth per branch —————————————————————
// Catches: a threshold read the wrong way (< vs ≤) that lets segments split
// past the pixel-level of detail; a fractal that grinds sub-pixel forever.
{
  // A very small canvas: any segment shorter than minSegLen must not be
  // further subdivided. We check that the total leaf count is bounded well
  // below the 2^gen ceiling because the length gate cuts recursion short.
  const segs = L.buildBolt(0, 0, 20, 0, { ...CFG, minSegLen: 8, generations: 8 }, 3);
  // 20 pixels between endpoints; even with displacement most sub-segments
  // fall under 8 quickly, so a runaway fractal would be the bug.
  assert.ok(segs.length < 32,
    `minSegLen must stop the recursion (got ${segs.length} on a 20px bolt)`);
}

// ——— zero-length endpoints are handled ——————————————————————————————————
// Catches: a segment of length zero recursing forever; a divide-by-zero.
{
  const segs = L.buildBolt(50, 50, 50, 50, CFG, 1);
  assert.equal(segs.length, 1, "a degenerate bolt is one degenerate segment");
  assert.equal(segs[0].main, true, "and it is marked main — nothing to fork from");
}

// ——— hashSeed and mulberry32 preserve their canonical laws ————————————————
// Catches: a copy-paste drift from src/lib/plank.ts's shape (the tests
// against plank pin the same laws — same laws must pin here too).
{
  assert.equal(L.hashSeed(1, 2, 3), L.hashSeed(1, 2, 3), "hashSeed is a function");
  assert.notEqual(L.hashSeed(1, 2, 3), L.hashSeed(3, 2, 1), "hashSeed hears order");
  const r1 = L.mulberry32(0xbeef);
  const r2 = L.mulberry32(0xbeef);
  for (let i = 0; i < 8; i++) {
    assert.equal(r1(), r2(), `mulberry32 streams from the same seed match at step ${i}`);
  }
}

console.log("lightning: ok");
