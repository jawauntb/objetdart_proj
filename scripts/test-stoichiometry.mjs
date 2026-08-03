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

const { resolveReaction, reactionForPair } = loadTsModule("src/lib/stoichiometry.ts");
const { REACTIONS, COMPOUNDS } = loadTsModule("src/lib/chemistry.ts");

// objects born inside the vm sandbox carry a foreign prototype; strip it
// before deep comparison so assertions test values, not realms
const plain = (v) => JSON.parse(JSON.stringify(v));

// — The canonical case: 2 H₂ near 1 O₂ genuinely yields two waters —
{
  const r = resolveReaction(REACTIONS, "H2", "O2", { H2: 2, O2: 1 });
  assert.ok(r, "hydrogen and oxygen with full stoichiometry must fire");
  assert.deepEqual(
    plain([...r.consumed].sort((a, b) => a.key.localeCompare(b.key))),
    [{ key: "H2", n: 2 }, { key: "O2", n: 1 }],
    "exactly two hydrogens and one oxygen are consumed",
  );
  assert.deepEqual(plain(r.produced), [{ key: "H2O", n: 2 }], "exactly two waters condense");
  assert.ok(r.energy > 0, "combustion releases");
}

// — Half-met equations never half-fire: 1 H₂ + 1 O₂ falls back —
{
  assert.equal(resolveReaction(REACTIONS, "H2", "O2", { H2: 1, O2: 1 }), null);
  assert.equal(resolveReaction(REACTIONS, "CH4", "O2", { CH4: 1, O2: 1 }), null,
    "methane demands two oxygens; one is not enough");
  assert.equal(resolveReaction(REACTIONS, "N2", "H2", { N2: 1, H2: 2 }), null,
    "fixation demands three hydrogens");
}

// — Order independence: the same fate whichever molecule began the ceremony —
{
  const census = { CH4: 1, O2: 2 };
  const ab = resolveReaction(REACTIONS, "CH4", "O2", census);
  const ba = resolveReaction(REACTIONS, "O2", "CH4", census);
  assert.ok(ab && ba, "both orderings fire");
  assert.deepEqual(plain(ab), plain(ba), "resolve(a, b) must equal resolve(b, a)");
}

// — Excess is left standing: one unit only, never a greedy sweep —
{
  const r = resolveReaction(REACTIONS, "H2", "O2", { H2: 7, O2: 5, N2: 3 });
  assert.ok(r);
  const consumedH2 = r.consumed.find((t) => t.key === "H2");
  const consumedO2 = r.consumed.find((t) => t.key === "O2");
  assert.equal(consumedH2.n, 2, "only one unit's hydrogen is taken");
  assert.equal(consumedO2.n, 1, "only one unit's oxygen is taken");
  assert.ok(!r.consumed.some((t) => t.key === "N2"), "bystanders are never consumed");
}

// — Pairs reality has no equation for stay null (the room's fallback path) —
{
  assert.equal(resolveReaction(REACTIONS, "H2O", "NaCl", { H2O: 4, NaCl: 4 }), null);
  assert.equal(reactionForPair(REACTIONS, "H2O", "NaCl"), null);
  assert.equal(resolveReaction(REACTIONS, "H2", "H2", { H2: 9 }), null,
    "two of the same species with no one-species equation must not fire");
}

// — A two-species equation demands the pair name BOTH species: a superset
//   census must not let (H2, N2) fire methane combustion —
{
  assert.equal(resolveReaction(REACTIONS, "H2", "CO2", { H2: 9, O2: 9, CO2: 9 }), null);
}

// — The endothermic sign survives resolution: lightning's work absorbs —
{
  const r = resolveReaction(REACTIONS, "N2", "O2", { N2: 1, O2: 1 });
  assert.ok(r, "N₂ + O₂ → 2 NO fires with one of each");
  assert.ok(r.energy < 0, "nitrogen fixation by fire absorbs energy");
  assert.deepEqual(plain(r.produced), [{ key: "NO", n: 2 }]);
}

// — Conservation, resolver-side: every resolution's consumed atoms equal its
//   produced atoms, for every curated equation given exact counts —
{
  const formulaOf = new Map(COMPOUNDS.map((c) => [c.key, c.formula]));
  const atomCensus = (terms) => {
    const atoms = new Map();
    for (const t of terms) {
      for (const part of formulaOf.get(t.key)) {
        atoms.set(part.z, (atoms.get(part.z) ?? 0) + part.count * t.n);
      }
    }
    return atoms;
  };
  for (const rx of REACTIONS) {
    const keys = [...new Set(rx.reactants.map((t) => t.key))];
    const a = keys[0];
    const b = keys.length === 2 ? keys[1] : keys[0];
    const census = {};
    for (const t of rx.reactants) census[t.key] = t.n;
    const r = resolveReaction(REACTIONS, a, b, census);
    assert.ok(r, `exact counts must fire: ${keys.join(" + ")}`);
    assert.deepEqual(
      plain([...atomCensus(r.consumed).entries()].sort((x, y) => x[0] - y[0])),
      plain([...atomCensus(r.produced).entries()].sort((x, y) => x[0] - y[0])),
      `atoms conserved through resolution: ${keys.join(" + ")}`,
    );
  }
}

console.log(
  `stoichiometry ok: full counts fire one exact unit, half-met equations refuse, resolution commutes, bystanders and excess stand, atoms conserved across all ${REACTIONS.length} curated equations`,
);
