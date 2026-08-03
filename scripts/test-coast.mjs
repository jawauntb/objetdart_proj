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
  tideLine,
  sandWetness,
  spawnFoam,
  stepFoam,
  capFoam,
} = loadTsModule("src/lib/coast.ts");

{
  const samples = Array.from({ length: 80 }, (_, i) => tideLine(i * 0.4, 0.5));
  for (const t of samples) assert.ok(t > 0.4 && t < 0.8);
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.02, "tide moves");
}

{
  assert.equal(sandWetness(0.9, 0.5), 1);
  assert.equal(sandWetness(0.2, 0.5), 0);
  let prev = 1;
  for (let y = 0.42; y <= 0.6; y += 0.01) {
    const w = sandWetness(y, 0.5);
    assert.ok(w >= prev - 1e-9 || y < 0.5, "wetness rises toward the sea");
    prev = w;
  }
}

{
  const foam = spawnFoam(12, 0.5, 0.6, 8);
  assert.equal(foam.length, 8);
  const aged = stepFoam(foam, 2, 0);
  assert.ok(aged.length < foam.length, "foam dissolves with time");
  const capped = capFoam(spawnFoam(1, 0.5, 0.5, 40), 10);
  assert.equal(capped.length, 10);
}

console.log("coast ok");
