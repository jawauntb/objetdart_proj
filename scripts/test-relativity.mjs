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
  const sandbox = { module, exports: module.exports };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

const {
  MATTER_CAP,
  lorentzGamma,
  tickPeriod,
  matterSpeed,
  matterGlow,
  dopplerShift,
  contractedLength,
  simultaneityGapMs,
  properTimeRatio,
  properTimeOf,
} = loadTsModule("src/lib/relativity.ts");

const C = 680; // px/s — a phone viewport's light speed; arbitrary but fixed

// — The light clock: exact at rest, monotone slowdown, diverging near c —
{
  assert.equal(tickPeriod(0.44, 0, C), 0.44, "a resting clock keeps its exact rest period");
  const speeds = [0, 0.2, 0.4, 0.6, 0.8, 0.92, 0.99].map((f) => f * C);
  const periods = speeds.map((v) => tickPeriod(1, v, C));
  for (let i = 1; i < periods.length; i++) {
    assert.ok(
      periods[i] > periods[i - 1],
      `the faster clock ticks strictly slower (${periods[i - 1]} !< ${periods[i]} at ${speeds[i]})`,
    );
  }
  // pinned values a broken gamma would miss: γ(0.6c) = 1.25, γ(0.8c) = 5/3
  assert.ok(Math.abs(tickPeriod(1, 0.6 * C, C) - 1.25) < 1e-12, "γ(0.6c) = 1.25");
  assert.ok(Math.abs(tickPeriod(1, 0.8 * C, C) - 5 / 3) < 1e-12, "γ(0.8c) = 5/3");
  assert.ok(tickPeriod(1, 0.999 * C, C) > 20, "toward c the tick all but stops");
  // wild inputs stay finite: the render bends, it never breaks
  for (const v of [C, 2 * C, 1e9 * C]) {
    const p = tickPeriod(1, v, C);
    assert.ok(Number.isFinite(p) && p > 1, `period finite and dilated at v = ${v}`);
  }
  assert.equal(lorentzGamma(-0.6 * C, C), lorentzGamma(0.6 * C, C), "dilation is even in v");
}

// — The matter cap: no flick, however hard, reaches light speed —
{
  assert.equal(matterSpeed(0, C), 0, "no flick, no speed");
  assert.equal(matterSpeed(-50, C), 0, "a negative effort is stillness, not motion");
  const efforts = [10, 60, 200, 500, 1200, 4000, 1e6, 1e12];
  let prev = 0;
  for (const u of efforts) {
    const v = matterSpeed(u, C);
    assert.ok(v >= prev, `matter speed monotone in effort (fell at ${u})`);
    assert.ok(v <= MATTER_CAP * C, `matter never beats its cap (v = ${v} at effort ${u})`);
    assert.ok(v < C, `matter never reaches c (v = ${v} at effort ${u})`);
    prev = v;
  }
  // a gentle flick keeps roughly its own speed — the cap is felt, not a tax
  const gentle = matterSpeed(0.02 * C, C);
  assert.ok(Math.abs(gentle - 0.02 * C) < 0.02 * C * 0.01, "gentle throws travel as thrown");
}

// — Energy diverges, speed doesn't: that IS relativity, felt —
{
  const efforts = [0, 100, 400, 1600, 6400];
  const glows = efforts.map((u) => matterGlow(u, C));
  for (let i = 1; i < glows.length; i++) {
    assert.ok(glows[i] > glows[i - 1], `harder flicks glow strictly hotter (flat at ${efforts[i]})`);
  }
  const vHuge = matterSpeed(10 * C, C);
  const gHuge = matterGlow(10 * C, C);
  assert.ok(vHuge <= MATTER_CAP * C, "a ten-c effort still cannot buy speed");
  assert.ok(gHuge > 0.99, `…but it buys nearly all the glow there is (${gHuge})`);
  for (const u of [1e6, 1e12]) {
    const g = matterGlow(u, C);
    assert.ok(Number.isFinite(g) && g < 1, `glow saturates below 1 (${g} at ${u})`);
  }
}

// — Doppler: blue toward, red away, and the retreat undoes the approach —
{
  assert.equal(dopplerShift(0, C), 1, "a resting lantern keeps its own color");
  const betas = [0.1, 0.3, 0.6, 0.9];
  let prevShift = 1;
  for (const b of betas) {
    const toward = dopplerShift(b * C, C);
    const away = dopplerShift(-b * C, C);
    assert.ok(toward > 1, `approach runs blue (${toward} at β=${b})`);
    assert.ok(away < 1, `retreat runs red (${away} at β=${b})`);
    assert.ok(toward > prevShift, "faster approach, bluer light");
    assert.ok(Math.abs(toward * away - 1) < 1e-12, `reciprocity: shift(β)·shift(−β) = 1 at β=${b}`);
    prevShift = toward;
  }
  for (const v of [C, 5 * C, -3 * C]) {
    const s = dopplerShift(v, C);
    assert.ok(Number.isFinite(s) && s > 0, `shift stays finite past the clamp (v = ${v})`);
  }
}

// — Length contraction: the rod is shortest where it moves fastest —
{
  assert.equal(contractedLength(1, 0), 1, "at rest the rod keeps its rest length exactly");
  assert.ok(Math.abs(contractedLength(1, 0.6) - 0.8) < 1e-12, "1/γ(0.6c) = 0.8 exactly");
  assert.ok(Math.abs(contractedLength(1, 0.8) - 0.6) < 1e-12, "1/γ(0.8c) = 0.6 exactly");
  assert.ok(Math.abs(contractedLength(250, 0.6) - 200) < 1e-9, "a 250px car at 0.6c fits in 200px");
  const betas = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.99];
  const lens = betas.map((b) => contractedLength(1, b));
  for (let i = 1; i < lens.length; i++) {
    assert.ok(lens[i] < lens[i - 1], `contraction strictly monotone (flat at β=${betas[i]})`);
  }
  for (const b of [0.99, 0.999999, 1, 7]) {
    const L = contractedLength(1, b);
    assert.ok(Number.isFinite(L) && L > 0, `never zero, never NaN this side of c (β=${b})`);
  }
  // contraction is gamma's inverse: the round trip restores the rod
  for (const b of [0.2, 0.6, 0.8, 0.95]) {
    assert.ok(
      Math.abs(contractedLength(3, b) * lorentzGamma(b, 1) - 3) < 1e-9,
      `contracted·γ = rest (broken at β=${b})`,
    );
  }
  assert.equal(contractedLength(1, -0.6), contractedLength(1, 0.6), "contraction is even in β");
}

// — Simultaneity: one flash, two framings, the gap the room keeps —
{
  assert.equal(simultaneityGapMs(0, 10), 0, "at rest the two framings are one moment");
  const betas = [0.05, 0.15, 0.3, 0.45, 0.6, 0.8];
  let prev = 0;
  for (const b of betas) {
    const gap = simultaneityGapMs(b, 10);
    assert.ok(gap > prev, `the disagreement strictly widens with speed (flat at β=${b})`);
    prev = gap;
  }
  // pinned to the exact law implemented: gap = γ·β·L light-milliseconds
  assert.ok(Math.abs(simultaneityGapMs(0.6, 10) - 7.5) < 1e-12, "γβL at 0.6c: 1.25·0.6·10 = 7.5");
  assert.ok(Math.abs(simultaneityGapMs(0.8, 10) - 40 / 3) < 1e-9, "γβL at 0.8c: (5/3)·0.8·10");
  // and to first order the gap is exactly β·L — the textbook form
  const b0 = 1e-3;
  assert.ok(Math.abs(simultaneityGapMs(b0, 1) / b0 - 1) < 2e-6, "first order: gap ≈ βL as β → 0");
  // linear in the car: twice the car, twice the disagreement
  assert.ok(
    Math.abs(simultaneityGapMs(0.5, 8) - 2 * simultaneityGapMs(0.5, 4)) < 1e-12,
    "gap is linear in rest length",
  );
  assert.equal(simultaneityGapMs(-0.6, 10), simultaneityGapMs(0.6, 10), "gap is even in β");
  for (const b of [1, 40]) {
    const g = simultaneityGapMs(b, 10);
    assert.ok(Number.isFinite(g) && g > 0, `wild β stays finite (${g} at β=${b})`);
  }
}

// — The twin: the bent path is the shorter one, always —
{
  assert.equal(properTimeOf([0, 0, 0], [1, 2, 3]), 6, "a path at rest ages with the room, exactly");
  assert.equal(properTimeRatio(0), 1, "rest trades time one for one");
  assert.ok(Math.abs(properTimeRatio(0.6) - 0.8) < 1e-12, "1/γ(0.6c) = 0.8");
  // constant speed matches 1/γ: forty steps of 0.1s at 0.6c age 3.2s
  const flat = properTimeOf(new Array(40).fill(0.6), new Array(40).fill(0.1));
  assert.ok(Math.abs(flat - 4 * 0.8) < 1e-9, `constant-β path ages T/γ exactly (${flat})`);
  // path dependence: same room time, the faster loop loses more
  const T = 6;
  const tauOf = (b) => properTimeOf(new Array(60).fill(b), new Array(60).fill(T / 60));
  assert.ok(tauOf(0.8) < tauOf(0.6) && tauOf(0.6) < tauOf(0.3) && tauOf(0.3) < T,
    "a faster loop loses strictly more time");
  // the traveler is ALWAYS younger: seeded journeys, none ever comes home old
  for (let seed = 1; seed <= 12; seed++) {
    const betas = [];
    const dts = [];
    let coord = 0;
    let moved = false;
    for (let k = 0; k < 60; k++) {
      const b = MATTER_CAP * Math.abs(Math.sin(k * 12.9898 * seed + seed * 78.233));
      betas.push(b);
      dts.push(0.1);
      coord += 0.1;
      if (b > 1e-6) moved = true;
    }
    const tau = properTimeOf(betas, dts);
    assert.ok(moved, `seed ${seed} journeyed at all`);
    assert.ok(tau > 0, `proper time never goes negative (seed ${seed})`);
    assert.ok(tau < coord, `the traveler comes home younger, every time (seed ${seed}: ${tau} !< ${coord})`);
  }
  // wild inputs bend, never break: β beyond c clamps, negative dt is no time
  assert.ok(Number.isFinite(properTimeOf([2, -3], [1, 1])), "β past c stays finite");
  assert.equal(properTimeOf([0.5], [-1]), 0, "negative dt contributes nothing");
}

console.log(
  "relativity kernel ok: clocks dilate exactly, matter never wins, color keeps the ledger, the room hears the gap the car never feels, the bent path is the shorter one, and the rod fits inside its resting ghost",
);
