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

const { RIPE_MAX, nodePhenophase } = loadTsModule("src/lib/growth-phenology.ts");
const { BLOOM_PEAK } = loadTsModule("src/lib/botany.ts");

const NODES = [0.42, 0.6, 0.78, 0.94];

// — A bud does not exist before its vine arrives: zero up to the node —
{
  for (const u of NODES) {
    for (const p of [0, u * 0.5, u * 0.99, u]) {
      assert.equal(
        nodePhenophase(p, u),
        0,
        `no phenophase before the vine reaches the node (p=${p}, u=${u})`,
      );
    }
  }
}

// — Monotone: growing the vine never closes a blossom, holding never un-holds —
{
  for (const u of NODES) {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const v = nodePhenophase(i / 200, u);
      assert.ok(v >= prev, `phenophase must not decrease as the vine grows (u=${u})`);
      prev = v;
    }
    let prevHeld = -1;
    for (let i = 0; i <= 100; i++) {
      const v = nodePhenophase(0.8, u, i / 100);
      assert.ok(v >= prevHeld, `phenophase must not decrease as the hold deepens (u=${u})`);
      prevHeld = v;
    }
  }
}

// — Clamped: wild inputs stay in [0,1] —
{
  for (const [p, u, h] of [
    [5, 0.6, 0],
    [-3, 0.6, 0],
    [1, 0, 9],
    [1, 1.7, -4],
    [0.5, -1, 0.5],
  ]) {
    const v = nodePhenophase(p, u, h);
    assert.ok(v >= 0 && v <= 1, `phenophase clamped for (${p}, ${u}, ${h}) → ${v}`);
  }
}

// — The brink law: maturity alone never crosses BLOOM_PEAK, so the bell and
//   haptics.bloom() can only ever be earned by the hand —
{
  assert.ok(RIPE_MAX < BLOOM_PEAK, "RIPE_MAX must sit below botany's BLOOM_PEAK");
  for (const u of NODES) {
    for (let i = 0; i <= 400; i++) {
      const v = nodePhenophase(i / 400, u);
      assert.ok(
        v <= RIPE_MAX + 1e-12 && v < BLOOM_PEAK,
        `unheld maturity must stay short of full bloom (p=${i / 400}, u=${u} → ${v})`,
      );
    }
  }
}

// — And the hand can finish the season: a full hold reaches phenophase 1 —
{
  for (const u of NODES) {
    assert.equal(nodePhenophase(1, u, 1), 1, "a full hold carries the blossom through close");
  }
}

console.log("growth-phenology: all assertions passed");
