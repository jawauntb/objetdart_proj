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
  MAX_ATOMS,
  MAX_RING,
  MAX_Z,
  SHELL_CAPACITY,
  ATOM_FAMILIES,
  atomFromSeed,
  excitedRing,
  bondSeed,
  covalentBond,
  settlePopulation,
  hashSeed,
} = loadTsModule("src/lib/atomics.ts");

const SEEDS = Array.from({ length: 80 }, (_, i) => hashSeed(i + 1, 31, 13));

// — Determinism: same seed → identical atom; different seeds differ —
for (const seed of SEEDS.slice(0, 20)) {
  assert.deepEqual(atomFromSeed(seed), atomFromSeed(seed), `atomFromSeed(${seed}) must be pure`);
}
{
  const distinct = new Set(SEEDS.map((seed) => JSON.stringify(atomFromSeed(seed))));
  assert.ok(distinct.size > SEEDS.length * 0.9, "different seeds should decode to different atoms");
}

// — Shell arithmetic: electrons fill in order, shells are minimal for z —
// The bugs this catches: an overfilled shell, an empty outer shell, a shell
// count that doesn't match the electron count, z out of the periodic range.
const shellsSeen = new Set();
for (const seed of SEEDS) {
  const m = atomFromSeed(seed);
  shellsSeen.add(m.shells);
  assert.ok(m.z >= 1 && m.z <= MAX_Z, `z bounded (${m.z})`);
  assert.ok(m.shells >= 1 && m.shells <= 4, `shell count bounded (${m.shells})`);
  assert.equal(m.electrons.length, m.shells, "one electron count per shell");
  let sum = 0;
  for (let i = 0; i < m.electrons.length; i++) {
    assert.ok(m.electrons[i] >= 1, `shell ${i} must not be empty`);
    assert.ok(m.electrons[i] <= SHELL_CAPACITY[i], `shell ${i} must not overfill`);
    sum += m.electrons[i];
  }
  assert.equal(sum, m.z, "electrons must sum to z");
  // inner shells full: filling is aufbau, not scattered
  for (let i = 0; i < m.electrons.length - 1; i++) {
    assert.equal(m.electrons[i], SHELL_CAPACITY[i], `inner shell ${i} fills before the next opens`);
  }
  assert.ok(m.lobes >= 2 && m.lobes <= 6, `lobe symmetry bounded (${m.lobes})`);
  assert.equal(m.lobes, 2 + (m.electrons[m.shells - 1] % 5), "lobes are a function of the valence");
  assert.ok(m.family >= 0 && m.family < ATOM_FAMILIES.length, "family valid");
  assert.equal(m.family, seed & 3, "family must be the low seed bits");
  assert.ok(m.radius > 0.1 && m.radius < 0.2, `radius bounded (${m.radius})`);
  assert.ok(m.nucleus > 0.04 && m.nucleus < 0.12, "nucleus stays a bright point, not a body");
  assert.ok(m.hum.amp > 0 && m.hum.amp < 0.08, "cloud shimmer stays subtle");
}
assert.ok(shellsSeen.size >= 3, "the seed space must reach several shell counts");

// — Excitation: strictly above ground, capped, monotone in intensity —
for (const seed of SEEDS.slice(0, 30)) {
  const m = atomFromSeed(seed);
  let prev = 0;
  for (const u of [0, 0.2, 0.34, 0.5, 0.67, 0.9, 1]) {
    const ring = excitedRing(m, u);
    assert.ok(ring > m.shells || ring === MAX_RING, `excited ring ${ring} must leave the ground shells`);
    assert.ok(ring <= MAX_RING, "excitation never climbs past the last ring");
    assert.ok(ring >= prev, "a harder touch never jumps less");
    prev = ring;
  }
  assert.equal(excitedRing(m, -5), excitedRing(m, 0), "intensity clamps at 0");
  assert.equal(excitedRing(m, 7), excitedRing(m, 1), "intensity clamps at 1");
}

// — Covalence law: pinned order-independent, deterministic, well-formed —
for (let i = 0; i < 40; i++) {
  const a = SEEDS[i];
  const b = SEEDS[79 - i];
  assert.equal(bondSeed(a, b), bondSeed(b, a), "covalence must be order-independent");
  assert.deepEqual(
    { ...covalentBond(a, b) },
    { ...covalentBond(b, a) },
    "the shared bond must be the same bond from either side",
  );
  const bond = covalentBond(a, b);
  assert.ok(bond.rest > 0.6 && bond.rest < 1.1, `bond rest separation bounded (${bond.rest})`);
  assert.ok(bond.tone >= 0 && bond.tone < 12, "bond tone chromatic");
  assert.ok(bond.gleam > 0 && bond.gleam <= 1, "bond gleam bounded");
}
{
  const bonds = new Set();
  for (let i = 0; i < 40; i++) bonds.add(bondSeed(SEEDS[i], SEEDS[79 - i]));
  assert.ok(bonds.size >= 39, "different pairs must almost always share different bonds");
}

// — Bounded population: endless condensation never overflows and always
//   retires from the old end —
{
  let field = [{ seed: SEEDS[0], born: 0 }];
  let clock = 1;
  for (let i = 0; i < 120; i++) {
    field.push({ seed: hashSeed(SEEDS[i % SEEDS.length], i, 3), born: clock++ });
    const { kept, retired } = settlePopulation(field, MAX_ATOMS);
    for (const r of retired) {
      for (const k of kept) {
        assert.ok(r.born <= k.born, "retirement must take the oldest first");
      }
    }
    field = kept;
    assert.ok(field.length <= MAX_ATOMS, "population must stay under the cap");
  }
  assert.equal(field.length, MAX_ATOMS, "sustained condensation should hold the field full");
}

console.log(
  `atomics ok: ${SEEDS.length} seeds decoded across shells {${[...shellsSeen].sort().join(",")}}, covalence commutes, population bounded at ${MAX_ATOMS}`,
);
