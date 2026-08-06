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
  mulberry32,
  morphFromSeed,
  growMorph,
  rattleMorph,
  restingEnergy,
  GERMINATION_STAGES,
  stageOf,
  stageIndex,
  advanceStage,
  imbibe,
  offspringSeed,
} = loadTsModule("src/lib/seed.ts");

{
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  const v = mulberry32(1)();
  assert.ok(v >= 0 && v < 1);
}

{
  const m = morphFromSeed(99);
  assert.equal(m.husk, 1);
  assert.equal(m.radicle, 0);
  assert.equal(JSON.stringify(morphFromSeed(99)), JSON.stringify(morphFromSeed(99)));
  assert.notEqual(morphFromSeed(99).hue, morphFromSeed(100).hue);
}

{
  let m = morphFromSeed(7);
  let prev = m.radicle;
  for (let i = 0; i < 40; i++) {
    m = growMorph(m, 0.05, 0.9);
    assert.ok(m.radicle >= prev - 1e-9);
    prev = m.radicle;
  }
  assert.ok(m.radicle > 0.2, "sustained pressure grows a radicle");
  assert.ok(m.husk <= 1 && m.husk >= 0);
}

{
  const m = morphFromSeed(3);
  const rattled = rattleMorph(m, 0.9);
  assert.ok(rattled.husk < m.husk, "a hard shake nicks the husk");
  assert.equal(rattleMorph(m, 0.1).husk, m.husk, "a soft shake leaves it");
}

{
  const m = growMorph(morphFromSeed(1), 1, 1);
  assert.ok(restingEnergy(m) > restingEnergy(morphFromSeed(1)));
}

// —— germination happens in order, or it is not germination ——————————
// The bug this catches: a stage ladder read from a single scalar, so a
// well-watered seed could show cotyledons before the husk had split, or a
// stage could be skipped when two thresholds crossed in the same frame.
{
  let m = morphFromSeed(0x5eed);
  assert.equal(stageOf(m), "dormant", "a fresh seed is dormant");
  const seen = [stageIndex(m)];
  for (let k = 0; k < GERMINATION_STAGES.length - 1; k++) {
    const next = advanceStage(m);
    assert.equal(
      stageIndex(next),
      stageIndex(m) + 1,
      `stage ${stageOf(m)} advances by exactly one, never two`,
    );
    // germination is monotone in every coordinate — nothing un-happens
    assert.ok(next.husk <= m.husk + 1e-9, "the husk never re-forms");
    assert.ok(next.radicle >= m.radicle - 1e-9, "the radicle never retracts");
    assert.ok(next.open >= m.open - 1e-9, "the cotyledons never re-close");
    m = next;
    seen.push(stageIndex(m));
  }
  assert.equal(stageOf(m), "shoot", "the whole ladder ends at the shoot");
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5], "and it passes through every rung, in order");
  assert.deepEqual(advanceStage(m), m, "the shoot is the end of the road");
  // the radicle is always out before the cotyledons — the one order that
  // matters botanically, asserted on the morph rather than on the label
  let n = morphFromSeed(7);
  for (let k = 0; k < 6; k++) {
    n = advanceStage(n);
    if (n.open > 0) assert.ok(n.radicle > 0, "no seed opens leaves before it has a root");
  }
}

// —— water is taken up, saturates, and is what softens the husk ————————
{
  const dry = morphFromSeed(0x11);
  assert.equal(stageOf(dry), "dormant", "a dry seed is dormant however long it sits");
  let wet = dry;
  for (let k = 0; k < 12; k++) wet = imbibe(wet, 0.12);
  assert.ok(wet.water <= 1 + 1e-9, "a seed cannot drink more than it holds");
  assert.ok(wet.mass >= dry.mass, "and swells rather than shrinks doing it");
  assert.ok(wet.husk < dry.husk, "a soaked husk softens — which is why it ever splits");
  assert.deepEqual(imbibe(dry, 0), dry, "no water is no change");
  assert.deepEqual(imbibe(dry, -5), dry, "and neither is negative rain");
  assert.notEqual(stageOf(imbibe(dry, 0.6)), "dormant", "enough water wakes it");
  // saturation really saturates: more rain on a full seed adds nothing
  const full = imbibe(wet, 5);
  assert.equal(full.water, 1, "a full seed is full");
}

// —— a shoot sets seeds that are its own and not itself ————————————
{
  const parent = 0xbeef;
  const a = offspringSeed(parent, 0);
  const b = offspringSeed(parent, 1);
  assert.notEqual(a, parent >>> 0, "a daughter is not its parent");
  assert.notEqual(a, b, "and two daughters are two seeds");
  assert.equal(offspringSeed(parent, 0), a, "the same plant sets the same seed twice over");
  assert.notDeepEqual(morphFromSeed(a), morphFromSeed(parent), "and it grows into a different seed");
}

console.log("seed ok: germination in order with the radicle always before the leaves, water saturating and softening the husk, and a shoot setting seeds that are not itself");
