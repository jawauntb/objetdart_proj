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
  MAX_ATOMS,
  MAX_RING,
  MAX_Z,
  SHELL_CAPACITY,
  ATOM_FAMILIES,
  ELEMENTS,
  elementOf,
  elementFromSeed,
  atomFromSeed,
  excitedRing,
  bondSeed,
  covalentBond,
  covalentPair,
  wantsBond,
  canFuse,
  fuseProduct,
  fusionEnergy,
  bindingPerNucleon,
  blastMagnitude,
  settlePopulation,
  hashSeed,
} = loadTsModule("src/lib/atomics.ts");

const SEEDS = Array.from({ length: 80 }, (_, i) => hashSeed(i + 1, 31, 13));

// — The table is real: 26 elements, shells that sum to Z, real ground states —
// The bugs this catches: a mistyped occupancy, a shell over real capacity,
// a Z/index mismatch, a duplicated symbol, a fantasy atomic weight.
assert.equal(ELEMENTS.length, MAX_Z, "the table runs H through Fe");
{
  const symbols = new Set();
  for (let i = 0; i < ELEMENTS.length; i++) {
    const e = ELEMENTS[i];
    assert.equal(e.z, i + 1, `element ${e.symbol} sits at its own Z`);
    symbols.add(e.symbol);
    const sum = e.shells.reduce((s, n) => s + n, 0);
    assert.equal(sum, e.z, `${e.symbol}: shell occupancy sums to Z`);
    for (let k = 0; k < e.shells.length; k++) {
      assert.ok(e.shells[k] >= 1, `${e.symbol}: shell ${k} not empty`);
      assert.ok(e.shells[k] <= SHELL_CAPACITY[k], `${e.symbol}: shell ${k} within real capacity`);
    }
    assert.ok(e.weight >= e.z && e.weight <= 3 * e.z, `${e.symbol}: weight plausible for Z`);
    assert.ok(e.radius > 20 && e.radius < 250, `${e.symbol}: covalent radius in pm range`);
    assert.ok(
      Number.isInteger(e.family) && e.family >= 0 && e.family < ATOM_FAMILIES.length,
      `${e.symbol}: valid family tint`,
    );
    assert.ok(e.abundance > 0, `${e.symbol}: present in the universe`);
  }
  assert.equal(symbols.size, MAX_Z, "no symbol repeats");
}

// Real ground-state configurations, spot-checked against the periodic table
// (K/L/M/N). Chromium is the aufbau exception ([Ar]3d⁵4s¹) — if a naive
// filler replaces the table, this line fails.
const REAL_CONFIGS = {
  H: [1],
  C: [2, 4],
  O: [2, 6],
  Ne: [2, 8],
  Na: [2, 8, 1],
  Cl: [2, 8, 7],
  Ca: [2, 8, 8, 2],
  Cr: [2, 8, 13, 1],
  Fe: [2, 8, 14, 2],
};
for (const [sym, config] of Object.entries(REAL_CONFIGS)) {
  const e = ELEMENTS.find((x) => x.symbol === sym);
  assert.ok(e, `${sym} exists`);
  assert.deepEqual([...e.shells], config, `${sym} carries its real ground state`);
}

// Real chemistry facts: valences and the electronegativity ladder.
const bySym = (s) => ELEMENTS.find((x) => x.symbol === s);
assert.equal(bySym("H").valence, 1, "hydrogen wants one bond");
assert.equal(bySym("O").valence, 2, "oxygen wants two");
assert.equal(bySym("N").valence, 3, "nitrogen wants three");
assert.equal(bySym("C").valence, 4, "carbon wants four");
for (const noble of ["He", "Ne", "Ar"]) {
  assert.equal(bySym(noble).valence, 0, `${noble} wants nothing`);
}
{
  const en = (s) => bySym(s).electronegativity;
  assert.ok(en("F") > en("O"), "fluorine out-pulls oxygen");
  assert.ok(en("O") > en("C"), "oxygen out-pulls carbon");
  assert.ok(en("C") > en("Na"), "carbon out-pulls sodium");
  const maxEn = Math.max(...ELEMENTS.map((e) => e.electronegativity));
  assert.equal(en("F"), maxEn, "fluorine is the hungriest in the table");
}

// — elementFromSeed: deterministic, in-table, hydrogen the cosmic mode —
{
  for (const seed of SEEDS.slice(0, 20)) {
    assert.deepEqual(elementFromSeed(seed), elementFromSeed(seed), "elementFromSeed pure");
  }
  const counts = new Map();
  for (let i = 0; i < 4000; i++) {
    const e = elementFromSeed(hashSeed(i, 17, 5));
    assert.ok(e.z >= 1 && e.z <= MAX_Z, "seeded element is in the table");
    counts.set(e.symbol, (counts.get(e.symbol) ?? 0) + 1);
  }
  const h = counts.get("H") ?? 0;
  for (const [sym, n] of counts) {
    if (sym !== "H") assert.ok(h > n, `H outnumbers ${sym} (${h} vs ${n}) — the cosmic mode`);
  }
  assert.ok(counts.size >= 8, "the abundance tail still reaches many elements");
}

// — Determinism: same seed → identical atom; different seeds differ —
for (const seed of SEEDS.slice(0, 20)) {
  assert.deepEqual(atomFromSeed(seed), atomFromSeed(seed), `atomFromSeed(${seed}) must be pure`);
}
{
  const distinct = new Set(SEEDS.map((seed) => JSON.stringify(atomFromSeed(seed))));
  assert.ok(distinct.size > SEEDS.length * 0.9, "different seeds should decode to different atoms");
}

// — The atom wears its element: real shells, real family, coherent identity —
// The bugs this catches: a morph decoupled from the table, electrons that
// don't sum to z, a shells count that isn't the real occupied-shell count.
const shellsSeen = new Set();
for (const seed of SEEDS) {
  const m = atomFromSeed(seed);
  shellsSeen.add(m.shells);
  const e = elementOf(m.z);
  assert.ok(e, `z bounded (${m.z})`);
  assert.equal(m.symbol, e.symbol, "morph carries its element's symbol");
  assert.equal(m.weight, e.weight, "morph carries its element's weight");
  assert.deepEqual(Array.from(m.electrons), Array.from(e.shells), "electrons are the real ground state");
  assert.equal(m.shells, e.shells.length, "shells = the element's real occupied shells");
  assert.equal(
    m.electrons.reduce((s, n) => s + n, 0),
    m.z,
    "electrons must sum to z",
  );
  assert.ok(m.lobes >= 2 && m.lobes <= 6, `lobe symmetry bounded (${m.lobes})`);
  assert.equal(m.lobes, 2 + (e.valence % 5), "lobes are a function of the covalent valence");
  assert.equal(m.family, e.family, "tint is the element's chemical family");
  assert.ok(m.family >= 0 && m.family < ATOM_FAMILIES.length, "family valid");
  assert.ok(m.radius > 0.1 && m.radius < 0.2, `radius bounded (${m.radius})`);
  assert.ok(m.nucleus > 0.04 && m.nucleus < 0.12, "nucleus stays a bright point, not a body");
  assert.ok(m.hum.amp > 0 && m.hum.amp < 0.08, "cloud shimmer stays subtle");
}
assert.ok(shellsSeen.size >= 2, "the seed space must reach several shell counts");
{
  // heavier element, bigger cloud and heavier nucleus — radius must track the table
  const rH = atomFromSeed([...SEEDS, ...SEEDS.map((s) => s + 1)].find((s) => atomFromSeed(s).z === 1) ?? SEEDS[0]);
  let na = null;
  for (let i = 0; i < 40000 && !na; i++) {
    const m = atomFromSeed(hashSeed(i, 3, 9));
    if (m.z === 11) na = m;
  }
  if (na) assert.ok(na.radius > rH.radius, "sodium's cloud outsizes hydrogen's");
}

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

// — Real covalence: appetites, orders, radii; nobles refuse everything —
// The bugs this catches: a noble gas that bonds, an O=O drawn single, an
// N≡N drawn double, a rest length blind to atomic size.
{
  const H = bySym("H");
  const O = bySym("O");
  const N = bySym("N");
  const C = bySym("C");
  assert.equal(wantsBond(H), 1);
  assert.equal(wantsBond(C), 4);
  for (const noble of ["He", "Ne", "Ar"]) {
    const g = bySym(noble);
    assert.equal(wantsBond(g), 0, `${noble} wants no bonds`);
    for (const other of [H, O, N, C, g]) {
      assert.equal(covalentPair(g, other), null, `${noble} refuses ${other.symbol}`);
      assert.equal(covalentPair(other, g), null, `${other.symbol} cannot force ${noble}`);
    }
  }
  assert.equal(covalentPair(H, H).order, 1, "H–H is single");
  assert.equal(covalentPair(O, O).order, 2, "O=O is double");
  assert.equal(covalentPair(N, N).order, 3, "N≡N is triple");
  assert.equal(covalentPair(H, O).order, 1, "the lesser appetite sets the order");
  const hh = covalentPair(H, H);
  const nacl = covalentPair(bySym("Na"), bySym("Cl"));
  assert.ok(hh.rest > 0 && nacl.rest > 0, "rest lengths positive");
  assert.ok(hh.rest < nacl.rest, "two small atoms rest closer than two large ones");
  const oo = covalentPair(O, O);
  const singleOO = ((O.radius + O.radius) / 152);
  assert.ok(oo.rest < singleOO, "a double bond pulls tighter than the radii sum");
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

// — Fusion: the binding curve rises through He, peaks at Fe, and the ledger
//   closes past iron —
// The bugs this catches: a curve that keeps paying past Fe, an inverted
// gain (heavy fusion out-earning light), a product with the wrong Z, an
// endothermic blast.
{
  // curve shape: strictly rising to iron, falling after
  for (let z = 2; z < MAX_Z; z++) {
    assert.ok(
      bindingPerNucleon(z + 1) > bindingPerNucleon(z),
      `binding per nucleon still climbing at Z=${z}`,
    );
  }
  assert.ok(bindingPerNucleon(30) < bindingPerNucleon(26), "the curve falls past iron");
  assert.equal(bindingPerNucleon(1), 0, "a lone proton holds nothing");
  assert.ok(bindingPerNucleon(2) > 6, "helium already binds hard — the steep first step");

  // Z conservation and reality of the product
  assert.ok(canFuse(1, 1) && canFuse(2, 6) && canFuse(13, 13), "light nuclei fuse");
  assert.ok(!canFuse(13, 14) && !canFuse(26, 26) && !canFuse(0, 1), "no bound product past iron");
  assert.equal(fuseProduct(1, 1).symbol, "He", "H+H makes helium");
  assert.equal(fuseProduct(6, 8).symbol, "Si", "C+O makes silicon");
  assert.equal(fuseProduct(13, 13).symbol, "Fe", "Al+Al lands exactly on iron");
  assert.equal(fuseProduct(20, 20), null, "past iron there is nothing bound to make");
  for (let za = 1; za <= MAX_Z; za++) {
    for (let zb = za; zb <= MAX_Z; zb++) {
      if (canFuse(za, zb)) {
        assert.equal(fuseProduct(za, zb).z, za + zb, "fusion conserves Z");
        assert.ok(fusionEnergy(za, zb) > 0, `fusing ${za}+${zb} below iron releases energy`);
      } else if (za + zb > MAX_Z) {
        assert.ok(fusionEnergy(za, zb) <= 0, `fusing ${za}+${zb} past iron costs (never pays)`);
      }
    }
  }

  // the star's dwindling wage
  const eHH = fusionEnergy(1, 1);
  const eCC = fusionEnergy(6, 6);
  assert.ok(eHH > eCC && eCC > 0, "fusionEnergy(H,H) > fusionEnergy(C,C) > 0");
  const totals = [1, 2, 3, 4, 6].map((z) => fusionEnergy(z, z));
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i] < totals[i - 1], "equal-pair fusion totals dwindle up the light table");
  }
  const perNucleon = [1, 2, 3, 4, 6, 8, 13].map(
    (z) => fusionEnergy(z, z) / (2 * elementOf(z).weight),
  );
  for (let i = 1; i < perNucleon.length; i++) {
    assert.ok(perNucleon[i] < perNucleon[i - 1], "per-nucleon gain shrinks monotonically with Z");
  }

  // the blast the room will radiate
  assert.equal(blastMagnitude(0), 0, "no energy, no blast");
  assert.equal(blastMagnitude(-5), 0, "an endothermic attempt does not bloom");
  const bHH = blastMagnitude(eHH);
  const bCC = blastMagnitude(eCC);
  assert.ok(bHH > 0 && bHH < 1 && bCC > 0 && bCC < 1, "blast magnitude lives in (0,1)");
  assert.ok(bHH > bCC, "the hotter fusion radiates the bigger wave");
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
  `atomics ok: ${ELEMENTS.length} real elements H→Fe, cosmic seeding (H the mode), covalence commutes and nobles refuse, fusion pays to iron and not a proton further, population bounded at ${MAX_ATOMS}`,
);
