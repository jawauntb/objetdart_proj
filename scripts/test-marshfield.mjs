// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.route.
// Filled by phase-6 track A — pins for /marsh's field-invariant physics.

// The /marsh laws. Every assertion names the bug it catches — a
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

const M = loadTsModule("src/lib/marshfield.ts");

const abs = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} (|${a} - ${b}| = ${Math.abs(a - b)} > ${tol})`);

// —— OXYGEN → PITCH IS A TRUE ROUND-TRIP ——————————————————————————
{
  for (const O of [0, 0.1, 0.25, 0.5, 0.75, 1.0]) {
    const hz = M.ringHzFor(O);
    abs(M.oxygenForRingHz(hz), O, 1e-9, `O → hz → O at O = ${O}`);
  }
  for (const hz of [220, 330, 440, 660]) {
    const O = M.oxygenForRingHz(hz);
    if (O >= 0 && O <= 1) {
      abs(M.ringHzFor(O), hz, 1e-9, `hz → O → hz at hz = ${hz}`);
    }
  }
  let lastHz = 0;
  for (let i = 0; i <= 20; i++) {
    const O = i / 20;
    const hz = M.ringHzFor(O);
    assert.ok(hz > lastHz - 1e-9, `ringHzFor monotone increasing at O = ${O.toFixed(2)}`);
    lastHz = hz;
  }
  abs(M.ringHzFor(0), M.PITCH_BASE_HZ, 1e-12, "O = 0 rings at base pitch");
  abs(
    M.ringHzFor(M.PITCH_SCALE_O) / M.PITCH_BASE_HZ,
    2,
    1e-12,
    "one scale of oxygen is one octave up",
  );
}

// —— DIFFUSION CONSERVES OXYGEN MASS ————————————————————————————
// The strongest claim about the field: with no reeds and no mats, mean
// oxygen after advance == before. Pure diffusion is mass-preserving.
{
  const s0 = M.initState(0x1234);
  const bare = {
    ...s0,
    reeds: [],
    mats: [],
    sunlight: 0,
  };
  const mean0 = M.meanOxygen(bare);
  const s1 = M.advanceExact(bare, 1000, { warmth: 0, wet: 0 });
  const mean1 = M.meanOxygen(s1);
  abs(mean1, mean0, 5e-3, "pure diffusion (no reeds/mats/sun) conserves mean oxygen");
}

// —— REEDS PRODUCE OXYGEN, MATS CONSUME IT ——————————————————————
{
  const base = {
    seedKey: 0x111,
    tau: 0,
    sunlight: 1,
    reeds: [{ id: 1, x: 0.5, y: 0.5, height: 1, phase: 0, sealed: true }],
    mats: [],
    oxygen: new Float32Array(M.GRID_SIZE).fill(0.5),
  };
  const beforeMean = M.meanOxygen(base);
  const afterReed = M.advanceExact(base, 60, { warmth: 1, wet: 0 });
  const afterMean = M.meanOxygen(afterReed);
  assert.ok(
    afterMean > beforeMean + 1e-4,
    `reed under sunlight raised mean oxygen (${beforeMean.toFixed(4)} → ${afterMean.toFixed(4)})`,
  );

  const withMat = {
    ...base,
    reeds: [],
    mats: [{ id: 1, x: 0.5, y: 0.5, mass: 1, phase: 0 }],
  };
  const beforeMean2 = M.meanOxygen(withMat);
  const afterMat = M.advanceExact(withMat, 60, { warmth: 0, wet: 1 });
  const afterMean2 = M.meanOxygen(afterMat);
  assert.ok(
    afterMean2 < beforeMean2 - 1e-4,
    `biofilm mat consumed oxygen (${beforeMean2.toFixed(4)} → ${afterMean2.toFixed(4)})`,
  );
}

// —— stirOxygen PRESERVES MEAN EXACTLY, REDUCES VARIANCE ———————————
// The touch-reachable secret: knock stirs the field toward its mean.
{
  const s = M.initState(0xabc);
  const O = new Float32Array(M.GRID_SIZE);
  for (let i = 0; i < M.GRID_SIZE; i++) O[i] = i % 2 === 0 ? 0.2 : 0.8;
  const highVar = { ...s, oxygen: O };
  const meanBefore = M.meanOxygen(highVar);
  const varOf = (st) => {
    const m = M.meanOxygen(st);
    let v = 0;
    for (let i = 0; i < st.oxygen.length; i++) {
      const d = st.oxygen[i] - m;
      v += d * d;
    }
    return v / st.oxygen.length;
  };
  const varBefore = varOf(highVar);
  const stirred = M.stirOxygen(highVar, 1);
  const meanAfter = M.meanOxygen(stirred);
  const varAfter = varOf(stirred);
  // Float32Array precision — mean is preserved to about 1e-6, not 1e-9.
  abs(meanAfter, meanBefore, 1e-6, "stirOxygen preserves mean (Float32Array precision)");
  assert.ok(varAfter < varBefore, `stirOxygen reduced variance (${varBefore.toFixed(4)} → ${varAfter.toFixed(4)})`);
  const stirZero = M.stirOxygen(highVar, 0);
  abs(varOf(stirZero), varBefore, 1e-6, "stirOxygen(intensity=0) leaves variance unchanged");
}

// —— MAX_ELAPSED_S CAPS THE CENTURY BUG ————————————————————————
{
  const s0 = M.initState(0xdead);
  const s1 = M.advanceExact(s0, 100 * 365 * 24 * 3600, { warmth: 0.5, wet: 0.5 });
  for (let i = 0; i < s1.oxygen.length; i++) {
    assert.ok(Number.isFinite(s1.oxygen[i]), `oxygen cell ${i} is finite`);
    assert.ok(s1.oxygen[i] >= 0 && s1.oxygen[i] <= 1, `oxygen cell ${i} bounded`);
  }
  for (const r of s1.reeds) {
    assert.ok(Number.isFinite(r.height), `reed ${r.id} height is finite`);
    assert.ok(r.height <= 1 + 1e-9, `reed ${r.id} height bounded`);
  }
  abs(s1.tau - s0.tau, M.MAX_ELAPSED_S, 1, "advance capped at MAX_ELAPSED_S");
}

// —— SEALED REEDS HOLD AT MAX_HEIGHT ————————————————————————————
{
  let s = M.initState(0x55);
  const sealed = s.reeds.find((r) => r.sealed);
  assert.ok(sealed, "initState creates at least one sealed reed");
  const h0 = sealed.height;
  s = M.deepenReed(s, sealed.id, -0.5);
  const after = s.reeds.find((r) => r.id === sealed.id);
  abs(after.height, h0, 1e-9, "sealed reed refused deepen(-0.5)");
  s = M.advanceExact(s, M.MAX_ELAPSED_S, { warmth: 0, wet: 0 });
  const after2 = s.reeds.find((r) => r.id === sealed.id);
  abs(after2.height, M.MAX_HEIGHT, 1e-9, "sealed reed holds through drought");
}

// —— plantReed REFUSES OUTSIDE BOUNDS, HITS CAP, IS DETERMINISTIC —————
{
  const s0 = M.initState(0x99);
  const before = s0.reeds.length;
  const s1 = M.plantReed(s0, 0.01, 0.5);
  assert.equal(s1.reeds.length, before, "plantReed refused x outside POOL_X_MIN");
  const s2 = M.plantReed(s0, 0.99, 0.5);
  assert.equal(s2.reeds.length, before, "plantReed refused x outside POOL_X_MAX");
  let s = s0;
  for (let i = 0; i < M.MAX_REEDS + 5; i++) {
    s = M.plantReed(s, 0.3 + i * 0.02, 0.3 + i * 0.02);
  }
  assert.ok(s.reeds.length <= M.MAX_REEDS, "population capped at MAX_REEDS");
  const a = M.initState(0x1111);
  const b = M.initState(0x1111);
  for (let i = 0; i < a.oxygen.length; i++) {
    abs(a.oxygen[i], b.oxygen[i], 1e-12, `oxygen cell ${i} deterministic from seed`);
  }
  for (let i = 0; i < a.reeds.length; i++) {
    abs(a.reeds[i].phase, b.reeds[i].phase, 1e-12, `reed ${i} phase deterministic`);
  }
}

// —— oxygenAt BILINEAR SAMPLE MATCHES CELL VALUES AT CORNERS ——————
{
  const s = M.initState(0x77);
  const cell00 = s.oxygen[0];
  const sampled = M.oxygenAt(s, 0, 0);
  abs(sampled, cell00, 1e-6, "oxygenAt(0, 0) matches cell (0, 0)");
  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    for (const y of [0, 0.25, 0.5, 0.75, 1]) {
      const v = M.oxygenAt(s, x, y);
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `oxygenAt(${x}, ${y}) in [0, 1]`);
    }
  }
}

// —— NEAREST REED ————————————————————————————————————————————
{
  const s = M.initState(0x33);
  const target = s.reeds[0];
  const found = M.nearestReed(s, target.x + 0.001, target.y + 0.001, 0.1);
  assert.equal(found?.id, target.id, "nearestReed finds the right reed");
  const missed = M.nearestReed(s, 0, 0, 0.01);
  assert.equal(missed, null, "nearestReed returns null when nothing is close enough");
}

console.log("marshfield: all pins green");
