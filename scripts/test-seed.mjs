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

const {
  mulberry32,
  morphFromSeed,
  growMorph,
  rattleMorph,
  restingEnergy,
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

console.log("seed ok");
