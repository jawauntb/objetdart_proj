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
  MAX_MOLECULES,
  MOLECULE_FAMILIES,
  COMPOUNDS,
  REACTIONS,
  compoundByKey,
  compoundFromSeed,
  molecularWeight,
  reactionOf,
  moleculeFromSeed,
  reactionProductSeed,
  settlePopulation,
  hashSeed,
} = loadTsModule("src/lib/chemistry.ts");

const SEEDS = Array.from({ length: 90 }, (_, i) => hashSeed(i + 1, 23, 7));

const FELTS = new Set([
  "polar",
  "nonpolar",
  "flammable",
  "oxidizer",
  "greenhouse",
  "inert",
  "toxic",
  "ionic",
  "anomalous",
]);

// helpers over the compound truth
function formulaCounts(c) {
  const map = new Map();
  for (const part of c.formula) map.set(part.z, (map.get(part.z) ?? 0) + part.count);
  return map;
}
function depictedCounts(c) {
  const map = new Map();
  for (const a of c.atoms) map.set(a.z, (map.get(a.z) ?? 0) + 1);
  return map;
}
function angleAt(o, p, q) {
  const v1 = { x: p.x - o.x, y: p.y - o.y };
  const v2 = { x: q.x - o.x, y: q.y - o.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mags = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  return (Math.acos(dot / mags) * 180) / Math.PI;
}

// — The library is real: ≥14 compounds, honest formulas, honest depictions —
// The bugs this catches: a formula that drifts from the drawing, a bond
// pointing at a missing atom, a duplicated bond, a disconnected fragment,
// a made-up element, a felt property outside the vocabulary.
assert.ok(COMPOUNDS.length >= 14, `library holds ≥14 real compounds (${COMPOUNDS.length})`);
{
  const keys = new Set();
  for (const c of COMPOUNDS) {
    assert.ok(!keys.has(c.key), `${c.key} appears once`);
    keys.add(c.key);
    assert.equal(compoundByKey(c.key), c, "compoundByKey finds it");
    assert.ok(FELTS.has(c.felt), `${c.key}: felt property from the vocabulary`);
    assert.ok(c.family >= 0 && c.family < MOLECULE_FAMILIES.length, `${c.key}: valid family`);
    assert.ok(c.abundance > 0, `${c.key}: seedable`);

    const formula = formulaCounts(c);
    const depicted = depictedCounts(c);
    for (const [z, n] of formula) {
      assert.ok(Number.isInteger(z) && z >= 1 && z <= 26, `${c.key}: formula element Z=${z} real`);
      assert.ok(n >= 1, `${c.key}: formula counts positive`);
    }
    for (const [z, n] of depicted) {
      assert.ok(formula.has(z), `${c.key}: depicted element Z=${z} is in the formula`);
      if (z !== 1) {
        assert.equal(n, formula.get(z), `${c.key}: every heavy atom of the formula is drawn`);
      } else {
        assert.ok(n <= formula.get(1), `${c.key}: never more hydrogens drawn than exist`);
      }
    }
    if (!c.skeletal) {
      let formulaTotal = 0;
      for (const [, n] of formula) formulaTotal += n;
      assert.equal(c.atoms.length, formulaTotal, `${c.key}: non-skeletal depiction draws every atom`);
    } else {
      assert.ok(
        (depicted.get(1) ?? 0) < (formula.get(1) ?? 0),
        `${c.key}: skeletal means hydrogens are implicit`,
      );
    }

    // bonds: valid, canonical, unique, connected
    const bondKeys = new Set();
    const adj = c.atoms.map(() => []);
    for (const bd of c.bonds) {
      assert.ok(bd.a >= 0 && bd.b < c.atoms.length && bd.a < bd.b, `${c.key}: bond valid+canonical`);
      assert.ok([1, 2, 3].includes(bd.order), `${c.key}: bond order 1..3`);
      const k = `${bd.a}-${bd.b}`;
      assert.ok(!bondKeys.has(k), `${c.key}: bond ${k} unique`);
      bondKeys.add(k);
      adj[bd.a].push(bd.b);
      adj[bd.b].push(bd.a);
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
    assert.equal(seen.size, c.atoms.length, `${c.key}: one connected piece`);
  }
}

// — Real molecular weights, summed from real element weights —
for (const [key, w] of [["H2O", 18], ["CO2", 44], ["CH4", 16], ["NH3", 17], ["C6H6", 78], ["NaCl", 58]]) {
  assert.equal(molecularWeight(compoundByKey(key)), w, `${key} weighs ${w}`);
}

// — Geometry pins: the shapes are the real shapes —
// The bugs this catches: a water drawn linear, a CO₂ drawn bent, a benzene
// ring that doesn't close or wobbles unevenly, a wrong bond order on the air.
{
  const w = compoundByKey("H2O");
  const ang = angleAt(w.atoms[0], w.atoms[1], w.atoms[2]);
  assert.ok(Math.abs(ang - 104.5) < 0.5, `water bends at 104.5° (got ${ang.toFixed(2)}°)`);
  const oh1 = Math.hypot(w.atoms[1].x - w.atoms[0].x, w.atoms[1].y - w.atoms[0].y);
  const oh2 = Math.hypot(w.atoms[2].x - w.atoms[0].x, w.atoms[2].y - w.atoms[0].y);
  assert.ok(Math.abs(oh1 - oh2) < 1e-9, "the two O–H arms are equal");

  const co2 = compoundByKey("CO2");
  const angC = angleAt(co2.atoms[0], co2.atoms[1], co2.atoms[2]);
  assert.ok(Math.abs(angC - 180) < 0.01, `CO₂ is collinear (got ${angC.toFixed(3)}°)`);

  const bz = compoundByKey("C6H6");
  assert.equal(bz.atoms.length, 6, "benzene draws six carbons");
  assert.equal(bz.bonds.length, 6, "benzene ring closes with six bonds");
  const deg = bz.atoms.map(() => 0);
  const lengths = bz.bonds.map((bd) => {
    deg[bd.a] += 1;
    deg[bd.b] += 1;
    return Math.hypot(bz.atoms[bd.a].x - bz.atoms[bd.b].x, bz.atoms[bd.a].y - bz.atoms[bd.b].y);
  });
  assert.ok(deg.every((d) => d === 2), "every ring carbon holds exactly two neighbors");
  const minL = Math.min(...lengths);
  const maxL = Math.max(...lengths);
  assert.ok(maxL / minL < 1.02, `benzene's six bonds are equal-ish (${minL.toFixed(3)}..${maxL.toFixed(3)})`);

  assert.equal(compoundByKey("H2").bonds[0].order, 1, "H–H single");
  assert.equal(compoundByKey("O2").bonds[0].order, 2, "O=O double");
  assert.equal(compoundByKey("N2").bonds[0].order, 3, "N≡N triple");
  assert.equal(compoundByKey("CO").bonds[0].order, 3, "C≡O triple");
}

// — compoundFromSeed: deterministic, in-library, abundance-honest —
{
  for (const seed of SEEDS.slice(0, 20)) {
    assert.equal(compoundFromSeed(seed), compoundFromSeed(seed), "compoundFromSeed pure");
  }
  const counts = new Map();
  for (let i = 0; i < 4000; i++) {
    const c = compoundFromSeed(hashSeed(i, 41, 11));
    assert.ok(compoundByKey(c.key), "seeded compound is in the library");
    counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
  }
  const water = counts.get("H2O") ?? 0;
  const benzene = counts.get("C6H6") ?? 0;
  assert.ok(water > 20 * Math.max(1, benzene) || (water > 500 && benzene < 60),
    `water common, benzene rare (${water} vs ${benzene})`);
  assert.ok(counts.size >= 10, "the abundance tail still reaches most of the library");
}

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

// — The morph wears its compound: sound structure, real identity —
// The bugs this catches: a morph decoupled from the library, a bond list
// that drifts from the compound's, a ring that isn't benzene, a chain that
// forks, letters off the notation set, atoms fused onto one point.
const LETTERS = new Set(["H", "C", "N", "O", "Na", "S", "Cl"]);
const topologiesSeen = new Set();
const MORPH_SEEDS = Array.from({ length: 700 }, (_, i) => hashSeed(i + 1, 23, 7));
for (const seed of MORPH_SEEDS) {
  const m = moleculeFromSeed(seed);
  topologiesSeen.add(m.topology);
  const c = compoundByKey(m.compound);
  assert.ok(c, `morph names a real compound (${m.compound})`);
  assert.equal(m.felt, c.felt, "morph carries its compound's felt property");
  assert.equal(m.family, c.family, "tint is the compound's family");
  const n = m.atoms.length;
  assert.equal(n, c.atoms.length, "morph depicts every compound atom");
  assert.equal(m.bonds.length, c.bonds.length, "morph carries every compound bond");
  for (let i = 0; i < m.bonds.length; i++) {
    const mb = m.bonds[i];
    assert.ok(mb.a >= 0 && mb.b < n && mb.a < mb.b, `bond ${mb.a}-${mb.b} valid and canonical`);
    assert.ok([1, 2, 3].includes(mb.order), "bond order is 1, 2, or 3");
  }
  if (m.topology === "ring") {
    assert.equal(m.compound, "C6H6", "the only ring in the library is benzene");
    assert.equal(m.bonds.length, n, "a ring has exactly n bonds");
  } else {
    assert.equal(m.bonds.length, n - 1, "an acyclic frame has exactly n-1 bonds");
    const deg = m.atoms.map(() => 0);
    for (const bd of m.bonds) {
      deg[bd.a] += 1;
      deg[bd.b] += 1;
    }
    if (m.topology === "chain") {
      assert.ok(deg.every((d) => d <= 2), "a chain never forks");
      assert.equal(deg.filter((d) => d === 1).length, 2, "a chain has exactly two ends");
    } else {
      assert.ok(Math.max(...deg) >= 3, "branched means at least one fork");
    }
  }

  // geometry: normalized into the unit disc, no two atoms fused together
  for (const a of m.atoms) {
    assert.ok(Math.hypot(a.x, a.y) <= 1 + 1e-9, "atoms stay inside the unit disc");
    assert.ok(a.size > 0.05 && a.size < 0.3, "atom orb size bounded");
    assert.ok(LETTERS.has(a.letter), `letter ${a.letter} from the notation set`);
    assert.ok(a.tone >= 0 && a.tone < MOLECULE_FAMILIES[0].length, "tone indexes the ramp");
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(m.atoms[i].x - m.atoms[j].x, m.atoms[i].y - m.atoms[j].y);
      assert.ok(d > 0.1, `atoms ${i},${j} must not fuse (d=${d.toFixed(3)})`);
    }
  }

  assert.equal(m.modes.length, n, "one vibration phase per atom");
  assert.ok(m.radius > 0.04 && m.radius < 0.14, `radius bounded (${m.radius})`);
  assert.ok(m.jitter.amp > 0 && m.jitter.amp < 0.05, "thermal jitter stays subtle");
  assert.ok(m.flex.amp > 0 && m.flex.amp < 0.12, "conformational flex stays gentle");
}
assert.equal(topologiesSeen.size, 3, "the library reaches all three topologies");

// — Real reactions: every curated equation balances to the atom —
// The falsifiable heart: count every Z on both sides. A single wrong
// coefficient anywhere in the set fails here.
{
  assert.ok(REACTIONS.length >= 6, "a real curated set");
  for (const r of REACTIONS) {
    const count = (side) => {
      const map = new Map();
      for (const { key, n } of side) {
        const c = compoundByKey(key);
        assert.ok(c, `reaction species ${key} exists in the library`);
        assert.ok(Number.isInteger(n) && n >= 1, "stoichiometric coefficients are whole and positive");
        for (const part of c.formula) map.set(part.z, (map.get(part.z) ?? 0) + part.count * n);
      }
      return map;
    };
    const left = count(r.reactants);
    const right = count(r.products);
    assert.equal(left.size, right.size, "no element appears from or into nothing");
    for (const [z, nLeft] of left) {
      assert.equal(right.get(z), nLeft, `Z=${z} conserved exactly across the equation`);
    }
    assert.ok(r.energy !== 0, "every reaction carries an energy sign");
    // no species on both sides — the equation is written reduced
    const reactantKeys = new Set(r.reactants.map((x) => x.key));
    for (const p of r.products) {
      assert.ok(!reactantKeys.has(p.key), "products never include a reactant");
    }
  }

  // combustion releases; lightning's nitrogen fixation absorbs
  for (const [a, b] of [["CH4", "O2"], ["H2", "O2"], ["C2H6", "O2"], ["C6H14", "O2"], ["CH3OH", "O2"]]) {
    const r = reactionOf(a, b);
    assert.ok(r, `${a}+${b} has a curated outcome`);
    assert.ok(r.energy > 0, `${a}+${b} combustion releases energy`);
    assert.ok(r.products.some((p) => p.key === "H2O"), "burning hydrogen-bearers rains water");
  }
  assert.ok(reactionOf("N2", "O2").energy < 0, "N₂+O₂ absorbs energy (endothermic)");
  assert.ok(reactionOf("N2", "H2").products.some((p) => p.key === "NH3"), "N₂+3H₂ makes ammonia");

  // pinned symmetric, and honest about ignorance
  assert.equal(reactionOf("CH4", "O2"), reactionOf("O2", "CH4"), "reactionOf commutes");
  assert.equal(reactionOf("H2O", "NaCl"), null, "no curated equation → null, the fallback's cue");
  assert.equal(reactionOf("H2O", "H2O"), null, "water alone does not react with itself");
}

// — Fallback reaction law: pinned order-independent, deterministic, and
//   productive — the ceremony never dead-ends —
for (let i = 0; i < 40; i++) {
  const a = SEEDS[i];
  const b = SEEDS[i + 40];
  const p = reactionProductSeed(a, b);
  assert.equal(p, reactionProductSeed(b, a), "reactions must be order-independent");
  assert.equal(p, reactionProductSeed(a, b), "reactions must be deterministic");
  assert.notEqual(p, a >>> 0, "the product is not reactant A");
  assert.notEqual(p, b >>> 0, "the product is not reactant B");
  const m = moleculeFromSeed(p);
  assert.ok(m.atoms.length >= 2 && compoundByKey(m.compound), "the product decodes to a real compound");
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
  `chemistry ok: ${COMPOUNDS.length} real compounds, ${REACTIONS.length} balanced reactions (every Z conserved), water bends at 104.5°, benzene closes, fallback commutes, population bounded at ${MAX_MOLECULES}`,
);
