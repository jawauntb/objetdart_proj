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
  MAX_HADRONS,
  SNAP_RATIO,
  VACUUM_SLOT_MS,
  VACUUM_MAX_LIFE_MS,
  hadronFromSeed,
  tubesOf,
  constituentCount,
  colorCharge,
  isWhite,
  confinementForce,
  shouldSnap,
  snapChildren,
  settlePopulation,
  vacuumPairsAt,
  hashSeed,
} = loadTsModule("src/lib/quarks.ts");

const SEEDS = Array.from({ length: 200 }, (_, i) => hashSeed(i + 1, 47, 5));

// — Decode determinism: same seed → identical hadron; seeds spread —
for (const seed of SEEDS.slice(0, 24)) {
  assert.deepEqual(hadronFromSeed(seed), hadronFromSeed(seed), `hadronFromSeed(${seed}) must be pure`);
}
{
  const distinct = new Set(SEEDS.map((seed) => JSON.stringify(hadronFromSeed(seed))));
  assert.ok(distinct.size > SEEDS.length * 0.9, "different seeds should decode to different hadrons");
  const kinds = new Set(SEEDS.map((seed) => hadronFromSeed(seed).kind));
  assert.deepEqual([...kinds].sort(), ["pair", "triplet"], "the seed space must reach both kinds");
}

// — Structure: the kind lives in the low bit (snapChildren writes child
//   kinds there), constituents match, tubes close the right shape —
// The bugs this catches: decode ignoring the kind bit (silently breaking
// the snap law), a pair with two tubes, a triplet whose loop doesn't close,
// an empty or one-quark hadron.
for (const seed of SEEDS) {
  const m = hadronFromSeed(seed);
  assert.equal(m.kind, (seed & 1) === 1 ? "triplet" : "pair", "kind must be the low seed bit");
  const n = constituentCount(m);
  assert.ok(n >= 2, `a hadron never binds fewer than two (${n})`);
  assert.equal(n, m.kind === "pair" ? 2 : 3, "constituents match the kind");
  assert.equal(m.colors.length, m.antis.length, "one anti flag per constituent");
  const tubes = tubesOf(m.kind);
  assert.equal(m.rest.length, tubes.length, "one rest length per tube");
  for (const r of m.rest) assert.ok(r > 0.05 && r < 0.2, `tube rest bounded (${r})`);
  // every constituent is held by at least one tube — no dangling quark
  const held = new Set(tubes.flat());
  assert.equal(held.size, n, "every constituent is tied into the tube graph");
  assert.ok(m.voice >= 0 && m.voice < 12, "voice chromatic");
  assert.ok(m.core > 0 && m.core < 0.03, "quark cores stay points, not bodies");
}

// — Color law: every seed neutralizes — the assignment always sums to white —
// Recompute the charge here, independently of colorCharge, so a decode that
// hands out arbitrary colors (or drops an anti flag) fails loudly.
for (const seed of SEEDS) {
  const m = hadronFromSeed(seed);
  const q = [0, 0, 0];
  for (let i = 0; i < m.colors.length; i++) {
    assert.ok(m.colors[i] >= 0 && m.colors[i] < 3, "color charge in range");
    q[m.colors[i]] += m.antis[i] ? -1 : 1;
  }
  assert.ok(q[0] === q[1] && q[1] === q[2], `colors must sum to white, got [${q}] for seed ${seed}`);
  assert.deepEqual([...colorCharge(m)], q, "colorCharge must agree with the definition");
  assert.equal(isWhite(m), true, "isWhite must hold for every decoded hadron");
  if (m.kind === "triplet") {
    assert.deepEqual([...m.colors].sort(), [0, 1, 2], "a triplet carries each color exactly once");
    assert.ok(m.antis.every((a) => a === false), "triplet quarks carry plain colors");
  } else {
    assert.equal(m.colors[0], m.colors[1], "a pair shares one color with its anti");
    assert.deepEqual([...m.antis], [false, true], "a pair is quark + antiquark");
  }
}

// — Confinement: force strictly INCREASING with stretch — the anti-spring —
// Pinned against an inverse-square baseline over the same distances: the
// baseline lets go as r grows, confinement pulls harder. A sign flip, a
// plateau, or an accidentally decreasing law all fail here.
{
  const rest = 1;
  assert.equal(confinementForce(0.4, rest), 0, "slack tube: no force (asymptotic freedom)");
  assert.equal(confinementForce(rest, rest), 0, "at rest: no force");
  let prevConf = 0;
  let prevInv = Infinity;
  for (let i = 1; i <= 40; i++) {
    const r = rest * (1 + (i / 40) * (SNAP_RATIO + 1)); // stretch past the snap point
    const f = confinementForce(r, rest);
    const inv = 1 / (r * r);
    assert.ok(f > prevConf, `confinement must grow with stretch (${f} !> ${prevConf} at r=${r})`);
    assert.ok(inv < prevInv, "the inverse-square baseline must decrease (sanity)");
    prevConf = f;
    prevInv = inv;
  }
  // scale invariance: only the RATIO of stretch matters, not the units
  assert.ok(
    Math.abs(confinementForce(3, 2) - confinementForce(1.5, 1)) < 1e-12,
    "force is a function of the stretch ratio",
  );
  assert.equal(shouldSnap(rest * SNAP_RATIO, rest), true, "the snap threshold snaps");
  assert.equal(shouldSnap(rest * SNAP_RATIO * 0.98, rest), false, "just under it holds");
}

// — The snap law: 200 seeded snaps, zero singletons —
// Every snap yields exactly two children; every child decodes to a bound
// hadron of ≥ 2 constituents, color-neutral; a pair snaps into two pairs,
// a triplet into a triplet and a pair. This is confinement's teeth: there
// is no input that isolates a quark.
{
  let singletons = 0;
  let pairSnaps = 0;
  let tripletSnaps = 0;
  for (let i = 0; i < 200; i++) {
    const parentSeed = SEEDS[i % SEEDS.length];
    const parent = hadronFromSeed(parentSeed);
    const breakIndex = i % (parent.kind === "pair" ? 1 : 3);
    const children = snapChildren(parentSeed, breakIndex);
    assert.deepEqual(
      children,
      snapChildren(parentSeed, breakIndex),
      "child seeds must be deterministic in (parent, break)",
    );
    assert.equal(children.length, 2, "a snap always yields exactly two bound systems");
    const kinds = [...children].map((s) => hadronFromSeed(s).kind);
    for (const childSeed of children) {
      const child = hadronFromSeed(childSeed);
      if (constituentCount(child) < 2) singletons += 1;
      assert.equal(isWhite(child), true, "every snap child must be color-neutral");
    }
    if (parent.kind === "pair") {
      pairSnaps += 1;
      assert.deepEqual(kinds, ["pair", "pair"], "a snapped string re-binds both ends: pair → pair + pair");
    } else {
      tripletSnaps += 1;
      assert.deepEqual(kinds.sort(), ["pair", "triplet"], "a torn loop reforms: triplet → triplet + pair");
    }
  }
  assert.equal(singletons, 0, "200 snaps, zero free quarks — confinement holds");
  assert.ok(pairSnaps > 0 && tripletSnaps > 0, "both kinds must have been snapped");
  // different breaks of the same triplet give different offspring
  const tripletSeed = SEEDS.find((s) => hadronFromSeed(s).kind === "triplet");
  const offspring = new Set([0, 1, 2].map((k) => snapChildren(tripletSeed, k).join(",")));
  assert.equal(offspring.size, 3, "each tube of a triplet breaks into its own pair");
}

// — Bounded population under sustained condensation AND snapping —
// A snap replaces one hadron with two (net +1); the cap must hold anyway
// and always retire from the old end.
{
  let field = [{ seed: SEEDS[0], born: 0 }];
  let clock = 1;
  for (let i = 0; i < 150; i++) {
    if (i % 3 === 0) {
      // condense a fresh hadron
      field.push({ seed: hashSeed(SEEDS[i % SEEDS.length], i, 9), born: clock++ });
    } else {
      // snap the youngest: parent out, two children in
      const parent = field.pop();
      for (const childSeed of snapChildren(parent.seed, i)) {
        field.push({ seed: childSeed, born: clock++ });
      }
    }
    const { kept, retired } = settlePopulation(field, MAX_HADRONS);
    for (const r of retired) {
      for (const k of kept) assert.ok(r.born <= k.born, "the oldest annihilates first");
    }
    field = kept;
    assert.ok(field.length <= MAX_HADRONS, "population must stay under the cap");
  }
  assert.equal(field.length, MAX_HADRONS, "a lively vacuum holds the field full");
}

// — The vacuum schedule: deterministic, bounded, alive but restful —
{
  const fieldSeed = 0xf1e1d;
  const SLOTS = 400;
  let restingSlots = 0;
  for (let slot = 0; slot < SLOTS; slot++) {
    const a = vacuumPairsAt(slot, fieldSeed);
    const b = vacuumPairsAt(slot, fieldSeed);
    assert.deepEqual(a, b, "the same slot must always spark the same pairs");
    if (a.length === 0) restingSlots += 1;
    for (const p of a) {
      assert.ok(p.nx > 0 && p.nx < 1 && p.ny > 0 && p.ny < 1, "pairs are born inside the field");
      // A pair that outlives the renderer's lookback window would vanish
      // mid-life instead of annihilating — the window is sized from this.
      assert.ok(
        p.lifeMs > 0 && p.lifeMs <= VACUUM_MAX_LIFE_MS,
        `a virtual pair must die inside the render window (${p.lifeMs})`,
      );
      assert.ok(p.color >= 0 && p.color < 3, "pair color in range");
      assert.ok(p.sep > 0 && p.sep < 0.05, "virtual separation stays subtle");
    }
  }
  assert.ok(restingSlots > 0, "the seethe must be uneven — some slots rest entirely");

  // The density the room actually renders: how many pairs are alive at once.
  // A near-empty vacuum (the old failure — the room read as black) and a
  // cluttered one both fail here; the sine envelope means the visible load is
  // gentler still. Sampled on the same clock the draw loop uses.
  let aliveTotal = 0;
  let samples = 0;
  let peak = 0;
  const back = Math.ceil(VACUUM_MAX_LIFE_MS / VACUUM_SLOT_MS);
  for (let tMs = 20000; tMs < 20000 + SLOTS * VACUUM_SLOT_MS; tMs += 33) {
    const nowSlot = Math.floor(tMs / VACUUM_SLOT_MS);
    let alive = 0;
    for (let slot = nowSlot - back; slot <= nowSlot; slot++) {
      const age = tMs - slot * VACUUM_SLOT_MS;
      if (age < 0) continue;
      for (const p of vacuumPairsAt(slot, fieldSeed)) if (age <= p.lifeMs) alive += 1;
    }
    aliveTotal += alive;
    peak = Math.max(peak, alive);
    samples += 1;
  }
  const meanAlive = aliveTotal / samples;
  assert.ok(
    meanAlive > 6 && meanAlive < 18,
    `the vacuum seethes: alive at once should read as a field, not a dot or a crowd (${meanAlive.toFixed(2)})`,
  );
  assert.ok(peak < 32, `even the busiest instant stays composed (${peak})`);

  const trace = (fs) => JSON.stringify(Array.from({ length: 100 }, (_, i) => vacuumPairsAt(i, fs)));
  assert.notEqual(trace(fieldSeed + 1), trace(fieldSeed), "a different field seethes differently");
}

console.log(
  `quarks ok: ${SEEDS.length} seeds white, force anti-spring past ${SNAP_RATIO}x, 200 snaps → 0 free quarks, population ≤ ${MAX_HADRONS}`,
);
