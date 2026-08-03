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

console.log("mountain ok");
