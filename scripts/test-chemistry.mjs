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
  MAX_MOLECULES,
  MOLECULE_FAMILIES,
  moleculeFromSeed,
  reactionProductSeed,
  settlePopulation,
  hashSeed,
} = loadTsModule("src/lib/chemistry.ts");

const SEEDS = Array.from({ length: 90 }, (_, i) => hashSeed(i + 1, 23, 7));

// — Determinism: same seed → identical molecule; different seeds differ —
for (const seed of SEEDS.slice(0, 20)) {
  assert.deepEqual(
    moleculeFromSeed(seed),
    moleculeFromSeed(seed),
    `moleculeFromSeed(${seed}) must be pure`,
  );
}
{
  const distinct = new Set(SEEDS.map((seed) => JSON.stringify(moleculeFromSeed(seed))));
  assert.ok(
    distinct.size > SEEDS.length * 0.95,
    "different seeds should decode to different molecules",
  );
}

// — Topology validity: the grammar must only ever emit sound structures —
// The bugs this catches: a bond pointing at a missing atom, a ring that
// doesn't close, a "chain" with a fork in it, a branched tree with a cycle,
// a disconnected fragment, two atoms decoded onto the same point.
function degrees(m) {
  const deg = m.atoms.map(() => 0);
  for (const b of m.bonds) {
    deg[b.a] += 1;
    deg[b.b] += 1;
  }
  return deg;
}

function connected(m) {
  if (m.atoms.length === 0) return false;
  const adj = m.atoms.map(() => []);
  for (const b of m.bonds) {
    adj[b.a].push(b.b);
    adj[b.b].push(b.a);
  }
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    for (const n of adj[stack.pop()]) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === m.atoms.length;
}

const topologiesSeen = new Set();
for (const seed of SEEDS) {
  const m = moleculeFromSeed(seed);
  topologiesSeen.add(m.topology);
  const n = m.atoms.length;
  assert.ok(n >= 2 && n <= 9, `atom count bounded (${n})`);

  // bonds reference real atoms, canonically ordered, never duplicated
  const keys = new Set();
  for (const b of m.bonds) {
    assert.ok(Number.isInteger(b.a) && Number.isInteger(b.b), "bond endpoints are indices");
    assert.ok(b.a >= 0 && b.b < n && b.a < b.b, `bond ${b.a}-${b.b} valid and canonical`);
    assert.ok(b.order === 1 || b.order === 2, "bond order is 1 or 2");
    const key = `${b.a}-${b.b}`;
    assert.ok(!keys.has(key), `bond ${key} must not repeat`);
    keys.add(key);
  }

  assert.ok(connected(m), "molecule must be one connected piece");
  const deg = degrees(m);
  if (m.topology === "ring") {
    assert.equal(m.bonds.length, n, "a ring has exactly n bonds");
    assert.ok(deg.every((d) => d === 2), "every ring atom has exactly two neighbors");
  } else if (m.topology === "chain") {
    assert.equal(m.bonds.length, n - 1, "a chain has exactly n-1 bonds");
    assert.ok(deg.every((d) => d <= 2), "a chain never forks");
    assert.equal(deg.filter((d) => d === 1).length, 2, "a chain has exactly two ends");
  } else {
    assert.equal(m.bonds.length, n - 1, "a branched tree has exactly n-1 bonds");
    assert.ok(Math.max(...deg) >= 3, "branched means at least one fork");
  }

  // geometry: normalized into the unit disc, no two atoms fused together
  for (const a of m.atoms) {
    assert.ok(Math.hypot(a.x, a.y) <= 1 + 1e-9, "atoms stay inside the unit disc");
    assert.ok(a.size > 0.05 && a.size < 0.3, "atom orb size bounded");
    assert.ok(["C", "N", "O", "S"].includes(a.letter), "letters come from the notation set");
    assert.ok(a.tone >= 0 && a.tone < MOLECULE_FAMILIES[0].length, "tone indexes the ramp");
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(m.atoms[i].x - m.atoms[j].x, m.atoms[i].y - m.atoms[j].y);
      assert.ok(d > 0.1, `atoms ${i},${j} must not fuse (d=${d.toFixed(3)})`);
    }
  }

  assert.ok(m.family >= 0 && m.family < MOLECULE_FAMILIES.length, "family valid");
  assert.equal(m.family, seed & 3, "family must be the low seed bits");
  assert.equal(m.modes.length, n, "one vibration phase per atom");
  assert.ok(m.radius > 0.04 && m.radius < 0.14, `radius bounded (${m.radius})`);
  assert.ok(m.jitter.amp > 0 && m.jitter.amp < 0.05, "thermal jitter stays subtle");
  assert.ok(m.flex.amp > 0 && m.flex.amp < 0.12, "conformational flex stays gentle");
}
assert.equal(topologiesSeen.size, 3, "the grammar must produce all three topologies");

// — Reaction law: pinned order-independent, deterministic, and productive —
for (let i = 0; i < 40; i++) {
  const a = SEEDS[i];
  const b = SEEDS[i + 40];
  const p = reactionProductSeed(a, b);
  assert.equal(p, reactionProductSeed(b, a), "reactions must be order-independent");
  assert.equal(p, reactionProductSeed(a, b), "reactions must be deterministic");
  assert.notEqual(p, a >>> 0, "the product is not reactant A");
  assert.notEqual(p, b >>> 0, "the product is not reactant B");
  const m = moleculeFromSeed(p);
  assert.ok(m.atoms.length >= 2 && connected(m), "the product must decode to a sound molecule");
}
{
  const products = new Set();
  for (let i = 0; i < 45; i++) products.add(reactionProductSeed(SEEDS[i], SEEDS[89 - i]));
  assert.ok(products.size >= 44, "different pairs must almost always meet different products");
}

// — Bounded population: endless condensation + reaction never overflows and
//   always retires from the old end —
{
  let field = SEEDS.slice(0, 3).map((seed, i) => ({ seed, born: i }));
  let clock = 3;
  for (let i = 0; i < 160; i++) {
    if (i % 3 === 2 && field.length >= 2) {
      // react the two newest into one product
      const b = field.pop();
      const a = field.pop();
      field.push({ seed: reactionProductSeed(a.seed, b.seed), born: clock++ });
    } else {
      field.push({ seed: hashSeed(SEEDS[i % SEEDS.length], i), born: clock++ });
    }
    const { kept, retired } = settlePopulation(field, MAX_MOLECULES);
    for (const r of retired) {
      for (const k of kept) {
        assert.ok(r.born <= k.born, "retirement must take the oldest first");
      }
    }
    field = kept;
    assert.ok(field.length <= MAX_MOLECULES, "population must stay under the cap");
  }
  assert.equal(field.length, MAX_MOLECULES, "sustained condensation should hold the field full");
}

console.log(
  `chemistry ok: ${SEEDS.length} seeds decoded across ${topologiesSeen.size} topologies, reactions commute, population bounded at ${MAX_MOLECULES}`,
);
