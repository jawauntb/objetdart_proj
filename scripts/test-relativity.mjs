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

const { MATTER_CAP, lorentzGamma, tickPeriod, matterSpeed, matterGlow, dopplerShift } =
  loadTsModule("src/lib/relativity.ts");

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

console.log("relativity kernel ok: clocks dilate exactly, matter never wins, color keeps the ledger");
