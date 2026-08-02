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
  MAX_CELLS,
  HERITABLE_MASK,
  CELL_FAMILIES,
  cellFromSeed,
  membraneRadius,
  daughterSeeds: daughterSeedsRaw,
  settlePopulation,
  hashSeed,
} = loadTsModule("src/lib/cytology.ts");

// Arrays born in the vm realm carry a foreign Array.prototype that newer
// Node versions reject in deepStrictEqual (see test-routes.mjs) — rehome them.
const daughterSeeds = (seed, gen) => [...daughterSeedsRaw(seed, gen)];

const SEEDS = Array.from({ length: 80 }, (_, i) => hashSeed(i + 1, 11, 5));

// — Determinism: same seed → identical morphology; different seeds differ —
for (const seed of SEEDS.slice(0, 20)) {
  assert.deepEqual(
    cellFromSeed(seed),
    cellFromSeed(seed),
    `cellFromSeed(${seed}) must be pure`,
  );
}
{
  const distinct = new Set(
    SEEDS.map((seed) => JSON.stringify(cellFromSeed(seed))),
  );
  assert.ok(
    distinct.size > SEEDS.length * 0.95,
    "different seeds should decode to different cells",
  );
}

// — Morphology bounds: a decoded cell must always be drawable —
for (const seed of SEEDS) {
  const m = cellFromSeed(seed);
  assert.ok(m.radius >= 0.05 && m.radius <= 0.115, `radius bounded (${m.radius})`);
  assert.ok(m.organelles.length >= 4 && m.organelles.length <= 14, "organelle count bounded");
  assert.ok(m.cilia.count >= 0 && m.cilia.count <= 30, "cilia count bounded");
  assert.ok(m.family >= 0 && m.family < CELL_FAMILIES.length, "palette family valid");
  assert.equal(m.family, seed & 3, "family must be the heritable low bits");
  for (const o of m.organelles) {
    assert.ok(o.orbit > 0 && o.orbit < 1, "organelles stay inside the membrane");
    assert.ok(o.size > 0 && o.size < 0.25, "organelle size bounded");
  }
}

// — Membrane closure: integer harmonics must meet themselves at 2π, and the
//   outline must stay positive and bounded at every angle and time —
for (const seed of SEEDS.slice(0, 30)) {
  const m = cellFromSeed(seed);
  for (const t of [0, 1.37, 9.02, 77.7]) {
    const r0 = membraneRadius(m, 0, t);
    const r2pi = membraneRadius(m, Math.PI * 2, t);
    assert.ok(Math.abs(r0 - r2pi) < 1e-9, "membrane must close (r(0) === r(2π))");
    for (let i = 0; i <= 48; i++) {
      const r = membraneRadius(m, (i / 48) * Math.PI * 2, t);
      assert.ok(Number.isFinite(r), "membrane radius finite");
      assert.ok(r > 0.6 && r < 1.4, `membrane radius bounded (${r})`);
    }
  }
}

// — Division: deterministic lineage, heritable nibble preserved, no folds —
for (const seed of SEEDS) {
  const gen = seed % 7;
  const [a, b] = daughterSeeds(seed, gen);
  assert.deepEqual(daughterSeeds(seed, gen), [a, b], "daughters must be deterministic");
  assert.notEqual(a, seed >>> 0, "daughter must not be the parent");
  assert.notEqual(b, seed >>> 0, "daughter must not be the parent");
  assert.notEqual(a, b, "daughters must differ from each other");
  assert.equal(a & HERITABLE_MASK, seed & HERITABLE_MASK, "daughter A inherits the nibble");
  assert.equal(b & HERITABLE_MASK, seed & HERITABLE_MASK, "daughter B inherits the nibble");
  assert.equal(
    cellFromSeed(a).family,
    cellFromSeed(seed).family,
    "palette family must survive division end-to-end",
  );
  assert.notDeepEqual(
    daughterSeeds(seed, gen),
    daughterSeeds(seed, gen + 1),
    "generation must perturb the daughters",
  );
}

// — Lineage stability over depth: replaying five generations from the same
//   root must reproduce the identical tree —
function lineage(root, depth) {
  let front = [{ seed: root, gen: 0 }];
  const tree = [];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const { seed, gen } of front) {
      const [a, b] = daughterSeeds(seed, gen);
      tree.push(a, b);
      next.push({ seed: a, gen: gen + 1 }, { seed: b, gen: gen + 1 });
    }
    front = next;
  }
  return tree;
}
{
  const root = SEEDS[3];
  const t1 = lineage(root, 5);
  const t2 = lineage(root, 5);
  assert.deepEqual(t1, t2, "the lineage tree must be a pure function of its root");
  assert.ok(
    t1.every((s) => (s & HERITABLE_MASK) === (root & HERITABLE_MASK)),
    "the heritable nibble must survive every generation",
  );
  assert.equal(new Set(t1).size, t1.length, "no two descendants may share a seed (lineage fold)");
}

// — Bounded population: endless division under the cap never overflows and
//   always retires from the old end —
{
  let cells = [{ seed: SEEDS[0], gen: 0, born: 0 }];
  let clock = 1;
  for (let i = 0; i < 200; i++) {
    const parent = cells[cells.length - 1];
    const [a, b] = daughterSeeds(parent.seed, parent.gen);
    cells = cells.filter((c) => c !== parent);
    cells.push(
      { seed: a, gen: parent.gen + 1, born: clock++ },
      { seed: b, gen: parent.gen + 1, born: clock++ },
    );
    const { kept, retired } = settlePopulation(cells, MAX_CELLS);
    for (const r of retired) {
      for (const k of kept) {
        assert.ok(r.born <= k.born, "retirement must take the oldest first");
      }
    }
    cells = kept;
    assert.ok(cells.length <= MAX_CELLS, "population must stay under the cap");
  }
  assert.equal(cells.length, MAX_CELLS, "sustained division should hold the plasm full");
}

console.log(`cytology ok: ${SEEDS.length} seeds decoded, lineage stable, population bounded at ${MAX_CELLS}`);
