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
  MAX_CELLS,
  HERITABLE_MASK,
  CELL_FAMILIES,
  cellFromSeed,
  membraneRadius,
  daughterSeeds: daughterSeedsRaw,
  settlePopulation,
  hashSeed,
  HOUR_MS,
  MAX_CATCHUP_H,
  STEADY_POPULATION,
  VITALITY_FLOOR,
  advanceCulture: advanceCultureRaw,
  validateStoredCulture: validateStoredCultureRaw,
  catchUpCulture: catchUpCultureRaw,
  adhesionBetween,
  signalReach,
  signalAt,
  competeForNutrient,
  canEngulf,
  engulfSeed,
  ENGULF_RATIO,
} = loadTsModule("src/lib/cytology.ts");

// Arrays (and the plain records inside them) born in the vm realm carry a
// foreign prototype that newer Node versions reject in deepStrictEqual (see
// test-routes.mjs) — round-tripping through JSON rehomes everything cheaply,
// which is safe here because every value in play is plain JSON-shaped data.
const rehome = (v) => JSON.parse(JSON.stringify(v));
const daughterSeeds = (seed, gen) => [...daughterSeedsRaw(seed, gen)];
const advanceCulture = (cells, hours) => rehome(advanceCultureRaw(cells, hours));
const validateStoredCulture = (raw, now) => rehome(validateStoredCultureRaw(raw, now));
const catchUpCulture = (stored, now) => rehome(catchUpCultureRaw(stored, now));

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

// — The culture's own clock: catch-up across real elapsed time —

function seedCell(seed, nx, ny, generation = 0, vitality = 1) {
  return { id: `ce-${seed.toString(36)}-${generation}`, seed, nx, ny, generation, vitality };
}

// — Determinism: identical stored culture + identical elapsed hours must
//   produce the identical next culture, every time —
{
  const cells = SEEDS.slice(0, 5).map((s, i) => seedCell(s, 0.3 + i * 0.1, 0.4, 0, 0.6));
  for (const hours of [0, 3, 40, 400, 5000]) {
    assert.deepEqual(
      advanceCulture(cells, hours),
      advanceCulture(cells, hours),
      `advanceCulture must be pure at ${hours}h`,
    );
  }
}

// — Zero elapsed is a true no-op: no drift, no division, no decay. A bug
//   that advances the culture on *session* time rather than *real* time
//   would fail this the moment it ran a frame with hoursAway === 0 —
{
  const cells = SEEDS.slice(5, 9).map((s, i) => seedCell(s, 0.2 + i * 0.15, 0.5, 1, 0.8));
  assert.deepEqual(advanceCulture(cells, 0), rehome(cells), "zero hours away must change nothing");
}

// — An empty dish never spontaneously regrows. Only LetGo may empty a
//   culture, and the emptiness must survive any amount of elapsed time —
{
  for (const hours of [0, 1, 1000, MAX_CATCHUP_H * 10]) {
    assert.deepEqual(advanceCulture([], hours), [], `an empty dish must stay empty at ${hours}h`);
  }
}

// — Growth bound at extreme elapsed time: a returning visitor after six
//   months must not find a million cells, or even close to it. Six months
//   and the MAX_CATCHUP_H cap must saturate to the exact same population —
{
  const lone = [seedCell(SEEDS[10], 0.5, 0.5, 0, 1)];
  const sixMonthsH = 24 * 30 * 6;
  const grown = advanceCulture(lone, sixMonthsH);
  assert.ok(grown.length > lone.length, "a lone healthy cell should have descendants after six months away");
  assert.ok(grown.length <= MAX_CELLS, `population must never exceed MAX_CELLS (${grown.length})`);
  assert.equal(grown.length, STEADY_POPULATION, "six months away saturates exactly at the resting population");
  assert.deepEqual(
    advanceCulture(lone, sixMonthsH),
    advanceCulture(lone, MAX_CATCHUP_H),
    "six months away and the capped catch-up horizon must saturate to the identical culture",
  );
  for (const c of grown) {
    assert.ok(c.vitality >= VITALITY_FLOOR && c.vitality <= 1, "vitality must stay in [floor, 1]");
  }
}

// — Descendants resemble their parent: an offline division must inherit the
//   heritable palette/cilia nibble exactly as a live division does —
{
  const parent = seedCell(SEEDS[11], 0.4, 0.4, 0, 1);
  const grown = advanceCulture([parent], 200);
  assert.ok(grown.length > 1, "sanity: this parent must have divided at least once");
  for (const c of grown) {
    assert.equal(
      c.seed & HERITABLE_MASK,
      parent.seed & HERITABLE_MASK,
      "every descendant must carry the root's heritable nibble",
    );
  }
}

// — Thinning: a dish left well above its own resting point eases back down
//   toward it, never toward zero and never overshooting below it —
{
  const crowded = Array.from({ length: 22 }, (_, i) =>
    seedCell(SEEDS[(i + 20) % SEEDS.length], (i % 8) / 8, 0.3 + (i % 5) * 0.1, 0, 1),
  );
  const settled = advanceCulture(crowded, 24 * 20);
  assert.ok(settled.length < crowded.length, "a crowded dish left alone should thin");
  assert.equal(settled.length, STEADY_POPULATION, "thinning must ease exactly to the resting point, not past it");
}

// — Corrupt or absent stored state degrades to a well-formed empty culture,
//   never a throw. A bad localStorage value must never break the room —
{
  const now = 1_700_000_000_000;
  for (const bad of [null, undefined, 42, "nope", [], {}, { cells: "nope" }, { cells: [1, 2, { seed: "x" }] }]) {
    const decoded = validateStoredCulture(bad, now);
    assert.ok(Array.isArray(decoded.cells), `corrupt input must decode to an array: ${JSON.stringify(bad)}`);
    assert.equal(typeof decoded.lastSeen, "number", "lastSeen must always be a finite number");
  }
}

// — A clock set backwards must read as zero elapsed, never negative, never
//   throw, and self-heal lastSeen to now —
{
  const now = 1_700_000_000_000;
  const stored = { cells: [seedCell(SEEDS[12], 0.5, 0.5, 2, 0.9)], lastSeen: now + 72 * HOUR_MS };
  const result = catchUpCulture(stored, now);
  assert.deepEqual(result.cells, rehome(stored.cells), "a backwards clock must not perturb the culture");
  assert.equal(result.lastSeen, now, "lastSeen must self-heal to the current read, not the corrupt future value");
}

// — Round-trip: encode (JSON.stringify, as the room persists it) then decode
//   (validateStoredCulture) must reproduce the same well-formed culture —
{
  const now = 1_700_000_000_000;
  const original = { cells: SEEDS.slice(13, 17).map((s, i) => seedCell(s, 0.2 * i, 0.5, i, 0.5 + i * 0.1)), lastSeen: now };
  const roundTripped = validateStoredCulture(JSON.parse(JSON.stringify(original)), now);
  assert.deepEqual(roundTripped, rehome(original), "encode → decode must round-trip a well-formed culture exactly");
}

// — What one cell does to another —
// The bug this catches: an "adhesion" that is really just distance, so a
// mixed culture would clump into one indiscriminate blob instead of sorting
// by lineage the way cadherin-bearing cells actually do.
{
  const kin = SEEDS.filter((s) => cellFromSeed(s).family === cellFromSeed(SEEDS[0]).family);
  const alien = SEEDS.filter((s) => cellFromSeed(s).family !== cellFromSeed(SEEDS[0]).family);
  assert.ok(kin.length > 1 && alien.length > 0, "the sample holds both kin and strangers");
  const a = cellFromSeed(SEEDS[0]);
  const b = cellFromSeed(kin[1]);
  const c = cellFromSeed(alien[0]);
  assert.ok(adhesionBetween(a, b) > adhesionBetween(a, c), "like holds like harder than it holds a stranger");
  assert.equal(adhesionBetween(a, c), adhesionBetween(c, a), "adhesion is symmetric — it is one bond, not two");
  for (const s of SEEDS.slice(0, 20)) {
    const v = adhesionBetween(a, cellFromSeed(s));
    assert.ok(v >= 0 && v <= 1, "adhesion stays a fraction");
  }
}

// Signalling reaches a neighbourhood, not the dish: past the reach it is
// exactly zero, or a "signal" would be a global broadcast wearing a falloff.
{
  const m = cellFromSeed(SEEDS[3]);
  const reach = signalReach(m);
  assert.ok(reach > 0, "a cell's signal carries somewhere");
  assert.ok(signalAt(m, 0) > signalAt(m, reach * 0.5), "and weakens with distance");
  assert.equal(signalAt(m, reach), 0, "at the edge of reach, nothing");
  assert.equal(signalAt(m, reach + 5), 0, "and nothing beyond it");
  assert.equal(signalAt(m, -1), 0, "a negative distance is not a nearer neighbour");
}

// A finite supply is divided, not multiplied: the shares must sum to the
// supply exactly, or a crowded dish would quietly feed everyone in full.
{
  const radii = [0.05, 0.1, 0.08, 0.06];
  const shares = competeForNutrient(radii, 12);
  const sum = shares.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 12) < 1e-9, "the dish gives out exactly what it holds");
  assert.ok(shares[1] > shares[0], "the larger cell takes the larger share");
  // the same supply among twice as many mouths feeds each of them less
  const crowded = competeForNutrient([...radii, ...radii], 12);
  assert.ok(crowded[1] < shares[1], "a crowded dish starves each of them proportionally");
  assert.ok(Math.abs(crowded.reduce((x, y) => x + y, 0) - 12) < 1e-9, "and still gives out exactly what it holds");
  assert.deepEqual(competeForNutrient([], 12), [], "an empty dish divides nothing");
  assert.deepEqual(competeForNutrient([0, 0], 12), [0, 0], "and cells with no uptake take nothing");
}

// Phagocytosis needs a real size difference, and makes a third thing.
{
  assert.equal(canEngulf(0.1, 0.099), false, "a cell cannot swallow one its own size");
  assert.equal(canEngulf(0.1, 0.1 / Math.sqrt(ENGULF_RATIO) - 1e-6), true, "past the ratio, it can");
  assert.equal(canEngulf(0.05, 0.1), false, "and the small one never eats the large");
  assert.equal(canEngulf(0, 0.1), false, "nothing swallows anything");
  const pred = SEEDS[5];
  const prey = SEEDS[9];
  const made = engulfSeed(pred, prey);
  assert.notEqual(made, pred >>> 0, "what stands afterwards is not the phagocyte it was");
  assert.notEqual(made, prey >>> 0, "nor the cell it ate");
  assert.equal(made & HERITABLE_MASK, pred & HERITABLE_MASK, "but it is still of the phagocyte's lineage");
  assert.equal(engulfSeed(pred, prey), made, "and the same meal always makes the same cell");
  assert.notEqual(engulfSeed(prey, pred), made, "eating the other way round makes a different cell");
  assert.notDeepEqual(
    cellFromSeed(made),
    cellFromSeed(pred),
    "the morphology is genuinely new, not the phagocyte redrawn",
  );
}

console.log(`cytology ok: ${SEEDS.length} seeds decoded, lineage stable, population bounded at ${MAX_CELLS}`);
console.log(
  "cytology contact ok: adhesion homophilic and symmetric, signalling exactly zero past its reach, " +
    "a finite supply divided to the last crumb, and phagocytosis making a cell that is neither parent",
);
console.log(
  `cytology catch-up ok: growth+thinning relax toward steady population ${STEADY_POPULATION}, ` +
    `bounded at ${MAX_CATCHUP_H}h, corrupt/backwards state handled`,
);
