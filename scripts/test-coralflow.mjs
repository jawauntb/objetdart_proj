// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.route.
// One LLM slot below carries the pins; the loader boilerplate is verbatim.

// The /reef laws. Every assertion names the bug it catches — a
// test that only restates a constant back at itself is not a test.

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

const M = loadTsModule("src/lib/coralflow.ts");

const near = (a, b, rel, msg) =>
  assert.ok(
    Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)),
    `${msg} (got ${a}, want ~${b}, diff ${Math.abs(a - b)} > ${rel * Math.max(1, Math.abs(b))})`,
  );

const abs = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} (|${a} - ${b}| = ${Math.abs(a - b)} > ${tol})`);

// —— SIZE → PITCH IS A TRUE ROUND-TRIP ————————————————————————————
// The room's central legibility claim: from the ring alone you recover the
// polyp's size. The bug this catches: a "pitch" that only reacts to size
// instead of encoding it — a colony-timbre map with no inverse.
{
  for (const s of [0, 0.1, 0.4, 0.6, 0.8, 1.0, 0.25, 0.75]) {
    const hz = M.ringHzFor(s);
    abs(M.sizeForRingHz(hz), s, 1e-12, `s → hz → s at s = ${s}`);
    assert.ok(hz > 0, "the pitch is always a real frequency");
  }
  // Only hz in the size ∈ [0, MAX_SIZE] range round-trip cleanly — outside,
  // ringHzFor clamps size to MAX_SIZE and the map folds. That fold is a
  // load-bearing behavior (a polyp cannot ring lower than its ceiling), so
  // the test asserts the fold at the top end instead of denying it.
  for (const hz of [165, 220, 330, 440, 660]) {
    const s = M.sizeForRingHz(hz);
    abs(M.ringHzFor(s), hz, 1e-9, `hz → s → hz at hz = ${hz}`);
  }
  // The fold: hz below ringHzFor(MAX_SIZE) recovers a size above MAX_SIZE,
  // which ringHzFor clamps back to the MAX_SIZE frequency (165).
  const oob = M.sizeForRingHz(110);
  assert.ok(oob > M.MAX_SIZE, "hz below ringHzFor(MAX_SIZE) recovers a size beyond the ceiling");
  abs(M.ringHzFor(oob), M.ringHzFor(M.MAX_SIZE), 1e-9, "and ringHzFor folds it back at MAX_SIZE");
  // Monotone DECREASING across a sweep — a bigger polyp rings LOWER.
  let lastHz = Infinity;
  for (let i = 0; i <= 20; i++) {
    const s = (i / 20) * M.MAX_SIZE;
    const hz = M.ringHzFor(s);
    assert.ok(hz < lastHz, `ringHzFor monotone decreasing at s = ${s.toFixed(2)}`);
    lastHz = hz;
  }
  // Base and octave calibration, computable by hand: hz(0) = base, and every
  // PITCH_SCALE_S of size halves the pitch.
  abs(M.ringHzFor(0), M.PITCH_BASE_HZ, 1e-12, "s = 0 rings at the base pitch");
  abs(
    M.PITCH_BASE_HZ / M.ringHzFor(M.PITCH_SCALE_S),
    2,
    1e-12,
    "one scale of size is one octave down",
  );
}

// —— LOGISTIC GROWTH SATURATES AT MAX_SIZE ——————————————————————
// The strongest claim about growth: no matter how long you wait, an
// unsealed polyp cannot exceed MAX_SIZE. The bug this catches: an Euler
// integrator that overshoots the ceiling under a fast rate.
{
  const s0 = M.initState(0x1234);
  const climate = { warmth: 1, wet: 0.05 }; // bright, calm — the fastest possible growth
  const s1 = M.advanceExact(s0, M.MAX_ELAPSED_S, climate);
  for (const p of s1.polyps) {
    assert.ok(p.size <= M.MAX_SIZE + 1e-12, `polyp ${p.id} did not overshoot the ceiling`);
    assert.ok(p.size >= 0, `polyp ${p.id} stayed non-negative`);
  }
  // A very long run at maximum brightness saturates every unsealed polyp
  // — the closed form gets asymptotically close to MAX_SIZE, so within a
  // fortnight every polyp is essentially at the ceiling.
  const long = M.advanceExact(s1, M.MAX_ELAPSED_S, climate);
  for (const p of long.polyps) {
    assert.ok(p.size > 0.99 * M.MAX_SIZE, `polyp ${p.id} saturated toward MAX_SIZE`);
  }
}

// —— A SEALED POLYP DOES NOT GROW BUT ALSO DOES NOT SHRINK ——————————
// The ceremony's contract: a sealed polyp holds at MAX_SIZE regardless of
// climate — it is a cornerstone, not a living animal. Its size never moves.
{
  let s = M.initState(0x77);
  // Seal every polyp
  for (const p of s.polyps) s = M.sealPolyp(s, p.id);
  for (const p of s.polyps) {
    abs(p.size, M.MAX_SIZE, 1e-12, `sealed polyp ${p.id} sits at MAX_SIZE`);
  }
  // A drought / cold year: does not shrink cornerstones.
  const winter = M.advanceExact(s, 30 * 24 * 3600, { warmth: 0, wet: 0 });
  for (const p of winter.polyps) {
    abs(p.size, M.MAX_SIZE, 1e-12, `sealed polyp ${p.id} did not shrink in a cold spell`);
  }
  // deepenPolyp with a negative delta refuses to narrow a sealed polyp.
  const id = s.polyps[0].id;
  const tried = M.deepenPolyp(s, id, -0.5);
  abs(
    tried.polyps.find((p) => p.id === id).size,
    M.MAX_SIZE,
    1e-15,
    "a sealed polyp does not narrow under a hand",
  );
}

// —— MAX_ELAPSED_S CAPS A CENTURY-BUG ————————————————————————————
// A month away is not a century of drift: the same law that world.ts uses.
{
  const s0 = M.initState(0x33);
  const climate = { warmth: 0.5, wet: 0.5 };
  const capped = M.advanceExact(s0, M.MAX_ELAPSED_S + 3600, climate);
  const atCap = M.advanceExact(s0, M.MAX_ELAPSED_S, climate);
  for (let i = 0; i < capped.polyps.length; i++) {
    abs(
      capped.polyps[i].size,
      atCap.polyps[i].size,
      1e-15,
      `polyp ${i} — advancing past the cap lands where advancing to it lands`,
    );
  }
  abs(capped.tau, s0.tau + M.MAX_ELAPSED_S, 1e-9, "and tau is clamped to the cap");
  // Negative or zero spans are the identity — time does not run backwards.
  assert.equal(M.advanceExact(s0, -5, climate), s0, "a negative span is the identity");
  assert.equal(M.advanceExact(s0, 0, climate), s0, "no span, no change");
}

// —— DEEPEN WIDENS THE POLYP UNDER THE HAND ————————————————————
// The dwell's contract: a longer press is a bigger polyp. And every
// bounded step widens strictly. The bug: a saturating curve that reports
// growth after it has hit the ceiling.
{
  let s = { polyps: [], current: 0, illum: 0.8, tau: 0, seedKey: 0xaa };
  s = M.plantPolyp(s, 0.5, 0.5, 0.05);
  const id = s.polyps[0].id;
  let lastSize = s.polyps[0].size;
  for (const step of [0.1, 0.15, 0.2, 0.25]) {
    s = M.deepenPolyp(s, id, step);
    assert.ok(s.polyps[0].size > lastSize, `deepen strictly widened at +${step}`);
    lastSize = s.polyps[0].size;
  }
  // The ceiling holds: no dSize can push a polyp past MAX_SIZE.
  const filled = M.deepenPolyp(s, id, 999);
  abs(
    filled.polyps[0].size,
    M.MAX_SIZE,
    1e-15,
    "the ceiling holds — a polyp cannot exceed MAX_SIZE",
  );
}

// —— PLANT REFUSES OUTSIDE BOUNDS, RESPECTS THE CAP —————————————————
// The reef has real bounds; a hand cannot anchor a polyp in open water.
{
  const s0 = { polyps: [], current: 0, illum: 0.8, tau: 0, seedKey: 0x2 };
  const above = M.plantPolyp(s0, 0.5, 0.05, 0.2);
  assert.equal(above.polyps.length, 0, "a polyp cannot anchor above the reef bounds");
  const below = M.plantPolyp(s0, 0.5, 0.99, 0.2);
  assert.equal(below.polyps.length, 0, "…and not through the floor of the section");
  // In-bounds: a polyp with a stable id and a deterministic phase.
  const inside = M.plantPolyp(s0, 0.5, 0.5, 0.2);
  assert.equal(inside.polyps.length, 1, "the reef accepts what the hand offered");
  assert.equal(inside.polyps[0].id, 1, "the first polyp has id 1");
  assert.equal(
    inside.polyps[0].phase,
    M.plantPolyp(s0, 0.5, 0.5, 0.2).polyps[0].phase,
    "the same seed grows the same phase",
  );
  // Population cap.
  let capped = s0;
  for (let i = 0; i < M.MAX_POLYPS + 4; i++) {
    capped = M.plantPolyp(
      capped,
      M.POOL_X_MIN + ((i * 0.04) % (M.POOL_X_MAX - M.POOL_X_MIN)),
      M.POOL_Y_MIN + 0.1,
      0.1,
    );
  }
  assert.equal(capped.polyps.length, M.MAX_POLYPS, "the reef holds its population cap");
  assert.equal(
    new Set(capped.polyps.map((p) => p.id)).size,
    M.MAX_POLYPS,
    "every polyp keeps its own id",
  );
}

// —— knockSweep DISLODGES THE YOUNG, SPARES THE CORNERSTONES ——————
// The touch-reachable secret: a hard knock sweeps unsealed polyps under a
// threshold, but sealed cornerstones stand. The bug: a knock that flattens
// the whole colony indiscriminately.
{
  let s = { polyps: [], current: 0, illum: 0.8, tau: 0, seedKey: 0xbb };
  // Plant six polyps: three at size 0.1 (young), three at size 0.8 (mature).
  const setups = [
    { x: 0.2, y: 0.4, size: 0.1, seal: false },
    { x: 0.35, y: 0.5, size: 0.1, seal: false },
    { x: 0.5, y: 0.6, size: 0.1, seal: false },
    { x: 0.65, y: 0.5, size: 0.8, seal: true },
    { x: 0.8, y: 0.4, size: 0.8, seal: true },
    { x: 0.4, y: 0.7, size: 0.8, seal: false }, // mature but not sealed
  ];
  for (const st of setups) {
    s = M.plantPolyp(s, st.x, st.y, st.size);
    if (st.seal) {
      const last = s.polyps[s.polyps.length - 1];
      s = M.sealPolyp(s, last.id);
    }
  }
  const before = s.polyps.length;
  // A soft knock: threshold ≈ DISLODGE_THRESHOLD (~0.45 by default),
  // sweeps the three young polyps but spares the mature-and-unsealed one
  // (0.8 > 0.45) and the sealed cornerstones.
  const soft = M.knockSweep(s, 0);
  assert.equal(soft.dislodged, 3, "a soft knock swept the three young polyps");
  assert.equal(soft.state.polyps.length, before - 3, "and the population count matches");
  for (const p of soft.state.polyps) {
    assert.ok(
      p.sealed || p.size >= M.DISLODGE_THRESHOLD,
      "every survivor is sealed OR sits above the threshold",
    );
  }
  // A maximal knock: threshold is DISLODGE * (1 - KNOCK_KAPPA) which is a
  // fraction of the original — young unsealed AND mature-unsealed both go
  // if they sit below (whereas cornerstones are protected regardless).
  const hard = M.knockSweep(s, 1);
  for (const p of hard.state.polyps) {
    assert.ok(p.sealed, "a maximal knock leaves only cornerstones standing");
  }
}

// —— A BRIGHT SEASON GROWS THE COLONY FASTER —————————————————————
// The illumination axis: a full-warmth climate saturates polyps faster
// than a cold one. The bug: an illumination scalar that decorates without
// entering the growth rate.
{
  const bright = { warmth: 1, wet: 0.1 };
  const dim = { warmth: 0.1, wet: 0.1 };
  const s0 = { polyps: [], current: 0, illum: 1, tau: 0, seedKey: 0xdead };
  const planted = M.plantPolyp(s0, 0.5, 0.4, 0.1);
  // Day-scale span, so the exponential factor separates strongly.
  const brightAfter = M.advanceExact(planted, 24 * 3600, bright);
  const dimAfter = M.advanceExact(planted, 24 * 3600, dim);
  assert.ok(
    brightAfter.polyps[0].size > dimAfter.polyps[0].size,
    "a bright climate grew the polyp more than a dim one",
  );
}

// —— SHEAR SLOWS GROWTH ————————————————————————————————————————
// The current axis: a strong current shears growth. The bug: a shear
// scalar that decorates without entering the rate.
{
  const s0 = { polyps: [], current: 0, illum: 1, tau: 0, seedKey: 0xa1 };
  const withPolyp = M.plantPolyp(s0, 0.5, 0.4, 0.1);
  const calm = { ...withPolyp, current: 0 };
  const strong = { ...withPolyp, current: 0.9 };
  const climate = { warmth: 0.8, wet: 0.5 };
  const dt = 24 * 3600;
  const calmAfter = M.advanceExact(calm, dt, climate);
  const strongAfter = M.advanceExact(strong, dt, climate);
  assert.ok(
    calmAfter.polyps[0].size > strongAfter.polyps[0].size,
    "a calm current grew the polyp more than a strong one",
  );
}

// —— MEAN SIZE ADVANCES WITH THE COLONY ——————————————————————————
// The lens observable meanSize must move as polyps grow — otherwise the
// twist lens lies about the reef's maturity.
{
  const s0 = M.initState(0xc0de);
  const s1 = M.advanceExact(s0, 3 * 24 * 3600, { warmth: 1, wet: 0.1 });
  assert.ok(
    M.meanSize(s1) > M.meanSize(s0),
    "the mean colony size advanced over three bright days",
  );
  // cornerstoneCount is monotone in seal calls.
  const before = M.cornerstoneCount(s1);
  const withSeal = M.sealPolyp(s1, s1.polyps.find((p) => !p.sealed).id);
  assert.equal(
    M.cornerstoneCount(withSeal),
    before + 1,
    "sealing an unsealed polyp raises the cornerstone count by one",
  );
}

// —— determinism ————————————————————————————————————————————————
{
  assert.deepEqual(M.initState(0xabc), M.initState(0xabc), "the same seed makes the same reef");
  assert.notDeepEqual(
    M.initState(1).polyps[0].phase,
    M.initState(2).polyps[0].phase,
    "different seeds produce different phases",
  );
  const rng1 = M.mulberry32(42);
  const rng2 = M.mulberry32(42);
  for (let i = 0; i < 8; i++) abs(rng1(), rng2(), 0, "mulberry32 is stable per seed");
  abs(M.hashSeed(1, 2, 3), M.hashSeed(1, 2, 3), 0, "hashSeed is a function of its inputs");
  assert.notEqual(M.hashSeed(1, 2, 3), M.hashSeed(1, 3, 2), "and order matters");
}

console.log(
  "coralflow ok: size ↔ pitch is a true round-trip; logistic growth saturates at MAX_SIZE; " +
    "sealed polyps hold at MAX_SIZE across a cold spell; MAX_ELAPSED_S caps the away span; " +
    "deepen widens strictly; the reef refuses a polyp outside its bounds; a hard knock sweeps " +
    "the young and spares the cornerstones; bright climate + calm current grow the colony faster.",
);
