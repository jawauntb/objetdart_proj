// The /organics laws. These assertions catch the bugs that would make the
// room lie: a molecule whose drawn structure disagrees with its stated
// formula, a carbon given a fifth bond, a relaxation that walks uphill, a
// strain→beat map you could not read backwards, and a condensation that
// invents atoms.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  });
  return module.exports;
}

const O = loadTsModule("src/lib/organic.ts");

// —— the structures are not decoration: they ARE the formulas ——————————
// Every target is written out atom by atom AND states a formula. If the two
// disagree, the room draws one molecule and names another. Recomputing one
// from the other is the only assertion that catches a mistyped substituent.
for (const target of O.TARGETS) {
  const chain = { seed: 1, atoms: target.atoms, angles: [], torsions: [], fold: 0 };
  assert.deepEqual(
    O.chainFormula(chain),
    target.formula,
    `${target.key}: the drawn structure must add up to the stated formula`,
  );
  // ...and every valence closes exactly — no dangling bond, no fifth bond
  // on a carbon. A missing hydrogen shows up here before it shows up in
  // the formula check above only when the two errors cancel.
  const n = target.atoms.length;
  for (let i = 0; i < n; i++) {
    assert.equal(
      O.freeValence(target.atoms[i], O.neighborsAt(n, i)),
      0,
      `${target.key}: atom ${i} (${target.atoms[i].el}) must be exactly satisfied`,
    );
  }
  assert.ok(O.isSaturated(chain), `${target.key}: the whole chain is saturated`);
}

// A carbon refuses a fifth bond, and the refusal is by valence, not by luck.
const fullCarbon = { el: "C", subs: ["H", "H", "H"] };
assert.equal(O.freeValence(fullCarbon, 1), 0, "a terminal methyl is full");
const busyChain = { seed: 1, atoms: [fullCarbon, { el: "C", subs: ["H", "H", "H"] }], angles: [], torsions: [], fold: 0 };
assert.equal(O.canAccept(busyChain, 0, "H"), false, "ethane's carbon takes no sixth partner");
assert.equal(O.canAccept(busyChain, 0, "O"), false, "nor a carbonyl it has no room for");
const openCarbon = { seed: 1, atoms: [{ el: "C", subs: ["H"] }, { el: "C", subs: ["H", "H", "H"] }], angles: [], torsions: [], fold: 0 };
assert.equal(O.canAccept(openCarbon, 0, "O"), true, "a carbon with two free bonds takes a carbonyl");
assert.equal(O.freeValence(openCarbon.atoms[0], 1), 2, "and exactly two were free");

// —— relaxation runs downhill, always ————————————————————————————————
// The bug this catches: an integrated (rather than exact) relaxation that
// overshoots on a long frame and leaves the molecule tenser than it was —
// which would make the room's beat rise while the hand does nothing.
{
  let chain = O.chainFromTarget("hexane", 0xc0ffee);
  let prev = O.strainEnergy(chain);
  assert.ok(prev > 0, "a fresh chain arrives strained");
  // deliberately ragged: a dropped frame, a long stall, a 3ms sliver
  const steps = [16, 16, 250, 4000, 3, 900, 16, 9000, 9000];
  for (const dt of steps) {
    chain = O.relaxChain(chain, dt);
    const e = O.strainEnergy(chain);
    assert.ok(e <= prev + 1e-12, `strain never rises (dt=${dt}: ${prev} → ${e})`);
    prev = e;
  }
  assert.ok(prev < 1e-3, "left alone, the chain finds its floor");
  for (const a of chain.angles) {
    assert.ok(Math.abs(a - O.TETRAHEDRAL) < 0.01, "every angle lands on the tetrahedral one");
  }
  for (const t of chain.torsions) {
    assert.ok(
      Math.abs(t - O.nearestStaggered(t)) < 0.01,
      "every torsion falls into a staggered conformer",
    );
  }
}
// Different seeds keep different conformers: relaxation must not collapse
// every chain onto one shape (that would make the room's floor a single
// picture instead of a family of them).
{
  const settle = (seed) => {
    let c = O.chainFromTarget("hexane", seed);
    for (let i = 0; i < 40; i++) c = O.relaxChain(c, 200);
    return c.torsions.map((t) => Math.round(t / O.STAGGER));
  };
  const shapes = new Set([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88].map((s) => settle(s).join(",")));
  assert.ok(shapes.size > 1, "the floor holds more than one conformer");
}
// Heat holds the chain off its floor rather than adding strain to it.
{
  let hot = O.chainFromTarget("hexane", 7);
  let cool = O.chainFromTarget("hexane", 7);
  const e0 = O.strainEnergy(hot);
  for (let i = 0; i < 10; i++) {
    hot = O.relaxChain(hot, 100, 1);
    cool = O.relaxChain(cool, 100, 0);
  }
  assert.ok(O.strainEnergy(hot) <= e0 + 1e-12, "heat never manufactures strain");
  assert.ok(
    O.strainEnergy(hot) > O.strainEnergy(cool),
    "but a hot chain is further from its floor than a cool one",
  );
}
// Determinism: the same seed is the same molecule, every visit.
assert.deepEqual(
  O.chainFromTarget("glucose", 4242),
  O.chainFromTarget("glucose", 4242),
  "a seed is a molecule",
);

// —— strain ↔ beat is a round trip, not a decoration ————————————————
// If this map were one-way the room would merely be noisy about strain
// instead of reporting it. The inverse is what makes hearing the beat the
// same act as reading the geometry.
for (const s of [0, 0.02, 0.11, 0.4, 0.9, 1.7, 3.2, 6]) {
  const back = O.strainFromBeat(O.beatHz(s));
  assert.ok(Math.abs(back - s) < 1e-9, `beat carries strain ${s} back intact (got ${back})`);
}
assert.equal(O.beatHz(0), 0, "at the minimum the beating stops — the room is in tune");
let lastBeat = -1;
for (const s of [0, 0.1, 0.3, 0.8, 2, 5, 12]) {
  const b = O.beatHz(s);
  assert.ok(b > lastBeat, "more strain always beats faster");
  assert.ok(b < O.BEAT_MAX_HZ, "and never past the room's widest beat");
  lastBeat = b;
}
// Longer chains ring lower — monotone, so the ear can order them.
let lastHz = Infinity;
for (const n of [2, 3, 4, 6, 9, 12]) {
  const hz = O.chainHz({ seed: 0, atoms: new Array(n).fill({ el: "C", subs: [] }), angles: [], torsions: [], fold: 0 });
  assert.ok(hz < lastHz, `a ${n}-carbon chain rings below a shorter one`);
  lastHz = hz;
}

// —— the fold is a duration, never a switch ——————————————————————————
assert.equal(O.foldPhase(0), 0, "an untouched chain is unfolded");
assert.equal(O.foldPhase(-50), 0, "and negative time does nothing");
let lastFold = -1;
for (const ms of [1, 120, 400, 900, 2400, 6000, 30000]) {
  const f = O.foldPhase(ms);
  assert.ok(f > lastFold, `holding longer folds further (${ms}ms)`);
  assert.ok(f < 1, "the fold approaches its limit without reaching it");
  lastFold = f;
}
// The law AGENTS.md names outright: nothing fires identically at 900ms and
// 2400ms. A hold quantized to tiers would land these on the same number;
// the gap has to be material, not merely nonzero.
assert.ok(
  O.foldPhase(2400) - O.foldPhase(900) > 0.25,
  "900ms and 2400ms are materially different acts",
);
// All three stages are actually reachable by holding — a boundary set past
// the curve's range would leave one of them unreachable forever.
assert.equal(O.foldStage(O.foldPhase(100)), "extended");
assert.equal(O.foldStage(O.foldPhase(1600)), "nucleated");
assert.equal(O.foldStage(O.foldPhase(9000)), "folded");
// A folded chain is a coil: every torsion crowds onto one turn, which is
// the backbone the ladder above is made of.
{
  const c = O.chainFromTarget("hexane", 99);
  const spreadOf = (fold) => {
    const t = O.coiledTorsions({ ...c, fold });
    return Math.max(...t) - Math.min(...t);
  };
  assert.ok(spreadOf(1) < spreadOf(0) * 0.02, "a fully folded chain has one turn, not many");
  assert.deepEqual(O.coiledTorsions({ ...c, fold: 0 }), c.torsions, "unfolded leaves it alone");
}

// —— condensation conserves atoms ——————————————————————————————————
{
  const glycine = O.targetByKey("glycine").formula;
  const joined = O.peptideCondense(glycine, glycine);
  assert.ok(joined, "two glycines can make a peptide bond");
  assert.deepEqual(
    O.addFormula(joined.product, joined.water),
    O.addFormula(glycine, glycine),
    "the peptide bond invents nothing: product + water = what went in",
  );
  // ...and what it makes is a molecule the room already knows by name.
  const named = O.recognize(joined.product);
  assert.ok(named, "the product is a real compound");
  assert.equal(named.key, "glycylglycine", "two glycines make glycylglycine");
}
assert.equal(
  O.peptideCondense(O.targetByKey("hexane").formula, O.targetByKey("glycine").formula),
  null,
  "hexane has no amine and no acid — the bond refuses",
);
assert.equal(O.recognize({ C: 3, H: 3, N: 0, O: 0 }), null, "nonsense counts name nothing");

// —— geometry: the walk is a pure function of the graph ————————————
{
  const c = O.chainFromTarget("hexane", 0xbeef);
  const pts = O.backbonePoints(c);
  assert.equal(pts.length, c.atoms.length, "one point per backbone atom");
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    assert.ok(Math.abs(d - 1) < 1e-9, "every bond is one bond long — the walk cannot stretch");
  }
  assert.deepEqual(O.backbonePoints(c), pts, "the same graph draws the same chain");
}

// —— the population is capped, oldest first —————————————————————————
{
  const many = Array.from({ length: O.MAX_CHAINS + 5 }, (_, i) => i);
  const kept = O.settlePopulation(many);
  assert.equal(kept.length, O.MAX_CHAINS, "the field never grows past its cap");
  assert.equal(kept[kept.length - 1], many[many.length - 1], "the newest chain stays");
  assert.equal(kept[0], 5, "the oldest are the ones that go");
  assert.deepEqual(O.settlePopulation([1, 2]), [1, 2], "a small field is left alone");
}

// —— polarity decides who reaches for whom ————————————————————————————
// The bug this catches: a "polarity" that is really just chain length, so
// hexane would drift toward glycine and the room's oil-and-water law would
// be a decoration. Hexane must be exactly indifferent.
{
  const hexane = O.chainFromTarget("hexane", 3);
  const glycine = O.chainFromTarget("glycine", 3);
  const glucose = O.chainFromTarget("glucose", 3);
  assert.equal(O.polarity(hexane), 0, "a pure hydrocarbon has no dipole at all");
  assert.ok(O.polarity(glycine) > 0.4, "an amino acid is polar");
  assert.ok(O.polarity(glucose) > O.polarity(glycine), "and a sugar, hung with hydroxyls, more so");
  // no attraction between two nonpolar chains, at any distance
  for (const d of [0.5, 1, 3, 8]) {
    assert.equal(O.dipoleAttraction(hexane, hexane, d), 0, `hexane ignores hexane at ${d}`);
  }
  // dipole–dipole falls off as 1/d³ and is cut cleanly at range
  const near = O.dipoleAttraction(glycine, glucose, 2);
  const far = O.dipoleAttraction(glycine, glucose, 4);
  assert.ok(near > far, "the pull weakens with distance");
  assert.ok(Math.abs(near / far - 8) < 1e-9, "and weakens as the cube of it");
  assert.equal(O.dipoleAttraction(glycine, glucose, O.DIPOLE_RANGE + 0.001), 0, "past range, nothing");
  assert.equal(O.hbondStrength(hexane, hexane), 0, "two hydrocarbons never hydrogen-bond");
  assert.ok(O.hbondStrength(glycine, glycine) > 0.5, "two amino acids do");
}

// —— ligation makes a third thing, and invents no atoms ————————————————
// The bug this catches: a "merge" that concatenates atom lists without
// paying the water — the product would carry two extra hydrogens and one
// extra oxygen, and the room would be manufacturing matter every join.
{
  const a = O.chainFromTarget("glycine", 11);
  const b = O.chainFromTarget("glycine", 22);
  const joined = O.ligateChains(a, b);
  assert.ok(joined, "an acid end and an amine end can be joined");
  assert.deepEqual(
    O.addFormula(O.chainFormula(joined.chain), joined.water),
    O.addFormula(O.chainFormula(a), O.chainFormula(b)),
    "ligation conserves every atom: product + water = the two parents",
  );
  const named = O.recognize(O.chainFormula(joined.chain));
  assert.ok(named && named.key === "glycylglycine", "and the product is a compound with a name");
  assert.notEqual(named.key, "glycine", "the third thing is neither parent");
  // ...and every valence in the product still closes: a join that forgets to
  // spend the hydroxyl leaves a carbon holding five bonds.
  const n = joined.chain.atoms.length;
  for (let i = 0; i < n; i++) {
    assert.equal(
      O.freeValence(joined.chain.atoms[i], O.neighborsAt(n, i)),
      0,
      `the ligated chain's atom ${i} is exactly satisfied`,
    );
  }
  assert.equal(O.ligateChains(O.chainFromTarget("hexane", 1), b), null, "hexane has no acid to give");
  assert.equal(O.ligateChains(a, O.chainFromTarget("hexane", 1)), null, "and none to receive with");
  // the backbone cap is real: nothing ligates past what the room can hold
  const long = { ...a, atoms: new Array(O.MAX_BACKBONE - 1).fill(a.atoms[0]) };
  assert.equal(O.ligateChains(long, b), null, "a product past MAX_BACKBONE refuses");
}

// —— hydrolysis is ligation run backwards ——————————————————————————————
{
  const a = O.chainFromTarget("glycine", 11);
  const b = O.chainFromTarget("glycine", 22);
  const joined = O.ligateChains(a, b).chain;
  const sites = O.peptideSites(joined);
  assert.deepEqual(sites, [3], "glycylglycine has exactly one peptide bond, after the carbonyl");
  const parts = O.hydrolyseChain(joined, sites[0]);
  assert.ok(parts, "water goes back in at the bond");
  assert.deepEqual(
    O.addFormula(O.chainFormula(parts[0]), O.chainFormula(parts[1])),
    O.addFormula(O.chainFormula(joined), O.WATER),
    "hydrolysis pays the water back exactly",
  );
  assert.deepEqual(O.chainFormula(parts[0]), O.chainFormula(a), "and the halves are the parents again");
  assert.deepEqual(O.chainFormula(parts[1]), O.chainFormula(b));
  assert.equal(O.hydrolyseChain(joined, 0), null, "there is no bond before the first atom");
  assert.equal(
    O.peptideSites(O.chainFromTarget("hexane", 5)).length,
    0,
    "a hydrocarbon has no peptide bond to cut",
  );
}

console.log(
  "organic ok: 4 real structures matching their formulas with every valence closed, relaxation monotone downhill under any timestep, strain↔beat a round trip, the fold a duration, the peptide bond conserving every atom, hexane exactly indifferent, and ligation/hydrolysis an atom-for-atom round trip",
);
