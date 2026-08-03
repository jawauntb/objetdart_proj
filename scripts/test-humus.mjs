// The /soil laws. Every assertion below names the bug it catches. The five
// that matter most: a nutrient ledger that leaks (growth, death or
// decomposition inventing or destroying carbon, especially where a clamp or a
// ration bites), a chemistry that drifts with how many steps it was integrated
// in, a growth curve that has to replay elapsed time to know where it got to,
// a timbre you cannot read the soil back out of, and a "mycelium" whose
// connectivity is drawn rather than computed.

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

const H = loadTsModule("src/lib/humus.ts");
const { POOLS } = H;

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} (|${a} - ${b}| = ${Math.abs(a - b)} > ${tol})`);

const sumOf = (m) => POOLS.reduce((s, p) => s + m[p], 0);

const climates = [
  { warmth: 0, wet: 0 },
  { warmth: 1, wet: 0 },
  { warmth: 0, wet: 1 },
  { warmth: 1, wet: 1 },
  { warmth: 0.35, wet: 0.62 },
  { warmth: 0.8, wet: 0.2 },
];

const seeds = [1, 7, 42, 0xbeef, 0x50117, 991, 2026, 0x1234567];
/** A section with its starter lives standing in it — the real shipped state. */
const worlds = seeds.map((seed) => {
  const base = H.starterState(seed >>> 0);
  return H.starterOrganisms(base, seed >>> 0);
});

// —— the climate responses are the real ones ——————————————————————
// The bug: a "temperature" that is really just a slider, or a moisture curve
// that says wetter is always faster — which would make the drowned corner of
// the three-finger weather the fastest soil in the room instead of the sourest.
{
  near(H.tempC(0), H.TEMP_MIN_C, 1e-15, "the cold end of the year is the cold end");
  near(H.tempC(1), H.TEMP_MAX_C, 1e-15, "and the warm end the warm end");
  near(H.q10Factor((H.TEMP_REF_C - H.TEMP_MIN_C) / (H.TEMP_MAX_C - H.TEMP_MIN_C)), 1, 1e-12,
    "the reference temperature is where the factor is one");
  // the law itself: ten degrees doubles it, wherever you stand
  for (const w of [0.1, 0.35, 0.6, 0.85]) {
    const t0 = H.tempC(w);
    const wPlus10 = (t0 + 10 - H.TEMP_MIN_C) / (H.TEMP_MAX_C - H.TEMP_MIN_C);
    if (wPlus10 > 1) continue;
    near(H.q10Factor(wPlus10) / H.q10Factor(w), H.Q10, 1e-12, "ten degrees doubles decomposition");
  }
  near(H.moistureFactor(H.WET_OPT), 1, 1e-15, "the optimum is the optimum");
  assert.ok(
    H.moistureFactor(1) < H.moistureFactor(H.WET_OPT),
    "waterlogged soil rots SLOWER than moist soil — the anaerobic fact this room is built on",
  );
  assert.ok(H.moistureFactor(0) < H.moistureFactor(0.3), "and bone-dry soil is nearly inert");
  assert.ok(H.moistureFactor(0) >= H.MOISTURE_FLOOR, "but never exactly stops");
  // symmetric about the optimum, which is what makes it a response and not a ramp
  near(H.moistureFactor(0.3), H.moistureFactor(0.9), 1e-15, "equal distance either side of the optimum");
}
{
  // rates: humus strictly slower than litter, and the k1 = k2 pole unreachable
  for (const c of climates) {
    const { k1, k2 } = H.decayRates(c);
    assert.ok(k1 > 0 && k2 > 0, "no climate freezes the cascade to a standstill");
    assert.ok(k2 < k1, "humus always turns over slower than fresh litter");
    near(k2 / k1, H.HUMUS_RATE_RATIO, 1e-15, "and by the stated ratio, so the closed form has no pole");
  }
  const ref = H.decayRates({ warmth: (H.TEMP_REF_C - H.TEMP_MIN_C) / (H.TEMP_MAX_C - H.TEMP_MIN_C), wet: H.WET_OPT });
  near(ref.k1, Math.LN2 / H.LITTER_HALFLIFE_S, 1e-18, "at the reference climate litter halves on schedule");
}

// —— CHEMISTRY IS CLOSED FORM AND CONSERVATIVE ————————————————————
// The real bug this catches: a catch-up loop that replays elapsed time in
// frames, so a soil left for a day lands somewhere different depending on how
// many steps the browser happened to take.
{
  const c = { warmth: 0.55, wet: 0.55 };
  const p0 = H.makePools(0.3, 0.2, 0.1, 0.05, 0.07);
  const span = 6 * 3600;
  const one = H.decayStep(p0, span, c);
  let stepped = p0;
  for (let i = 0; i < 21600; i++) stepped = H.decayStep(stepped, 1, c);
  for (const p of POOLS) near(stepped[p], one[p], 1e-9, `${p} after 21600 steps equals ${p} after one`);
  for (const split of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const two = H.decayStep(H.decayStep(p0, span * split, c), span * (1 - split), c);
    for (const p of POOLS) near(two[p], one[p], 1e-15, `splitting the span at ${split} lands in the same soil`);
  }
}
{
  // the hand-computable case: after one litter half-life exactly half the
  // litter is gone. A sign error or a wrong rate misses this by a mile.
  const c = { warmth: 0.6, wet: 0.5 };
  const { k1, k2 } = H.decayRates(c);
  const half = Math.LN2 / k1;
  const p0 = H.makePools(0.4, 0.0, 0.0, 0, 0);
  const after = H.decayStep(p0, half, c);
  near(after.litter, 0.2, 1e-15, "half the litter is gone after one litter half-life");
  // ...and the humus that appeared is the convolution's exact value, not a
  // fraction someone tuned by eye
  const expected = (0.4 * k1 * (Math.exp(-k1 * half) - Math.exp(-k2 * half))) / (k2 - k1);
  near(after.humus, expected, 1e-15, "and the humus is the two-exponential convolution exactly");
  near(after.mineral, 0.4 - after.litter - after.humus, 1e-15, "mineral closes the abiotic sum");
}
{
  // conservation and non-negativity across every climate and span
  for (const { state } of worlds) {
    for (const c of climates) {
      for (const dt of [1, 60, 3600, 12 * 3600, 30 * 24 * 3600]) {
        const after = H.decayStep(state.pools, dt, c);
        near(sumOf(after), sumOf(state.pools), 1e-15, "chemistry moves matter, it never makes or unmakes it");
        for (const p of POOLS) assert.ok(after[p] >= 0, `${p} never goes negative`);
        assert.ok(after.litter <= state.pools.litter + 1e-15, "litter only ever leaves the surface");
        assert.equal(after.root, state.pools.root, "chemistry does not touch the living");
        assert.equal(after.mycelium, state.pools.mycelium, "nor the fungal");
      }
    }
  }
  // the end state of the cascade is all mineral: nothing stalls halfway
  const done = H.decayStep(H.makePools(0.5, 0.3, 0.05, 0, 0), 400 * 24 * 3600, { warmth: 0.9, wet: 0.6 });
  near(done.litter, 0, 1e-6, "given long enough, every leaf is gone");
  near(done.humus, 0, 1e-4, "and every humus mineralized");
  near(done.mineral, 0.85, 1e-4, "into exactly the mineral it was made of");
}

// —— GROWTH IS CLOSED FORM ————————————————————————————————————————
// The bug: replaying the away-span in frames, or a curve that overshoots its
// capacity and then oscillates — either would make "the roots grew while you
// were away" a story rather than a computation.
{
  const K = 0.2;
  const r = 3e-5;
  const m0 = 0.01;
  const span = 5 * 24 * 3600;
  const one = H.logisticStep(m0, K, r, span);
  for (const n of [2, 7, 64, 1000]) {
    let m = m0;
    for (let i = 0; i < n; i++) m = H.logisticStep(m, K, r, span / n);
    near(m, one, 1e-12, `${n} steps of growth land where one step lands`);
  }
  assert.equal(H.logisticStep(K / 2, K, r, 0), K / 2, "no span, no growth");
  // The signature of logistic growth and of nothing else: the log-odds of
  // being grown, ln(m / (K − m)), advances by exactly r·t. A Gompertz curve, a
  // saturating exponential, or an Euler step of the ODE all fail this.
  const logit = (m) => Math.log(m / (K - m));
  for (const dt of [3600, 24 * 3600, 4 * 24 * 3600]) {
    for (const start of [0.002, K / 2, K * 0.9]) {
      near(
        logit(H.logisticStep(start, K, r, dt)) - logit(start),
        r * dt,
        1e-9,
        `the log-odds of being grown advance at exactly r (from ${start} over ${dt}s)`,
      );
    }
  }
  // monotone, saturating, and attracting from ABOVE as well as below
  let last = -1;
  for (const dt of [0, 3600, 6 * 3600, 24 * 3600, 7 * 24 * 3600, 90 * 24 * 3600]) {
    const m = H.logisticStep(m0, K, r, dt);
    assert.ok(m > last, "growth is strictly increasing while below capacity");
    assert.ok(m < K + 1e-12, "and never overshoots what the ground can support");
    last = m;
  }
  assert.ok(H.logisticStep(K * 2, K, r, span) < K * 2, "a life above its capacity shrinks back to it");
  assert.ok(H.logisticStep(K * 2, K, r, 1e9) > K - 1e-6, "settling on the capacity, not past it");
  // no capacity is starvation, not an instant death
  const starved = H.logisticStep(0.05, 0, r, 24 * 3600);
  assert.ok(starved > 0 && starved < 0.05, "with nothing to eat a life fades rather than vanishes");
  near(starved, 0.05 * Math.exp(-r * 24 * 3600), 1e-15, "at exactly the starvation rate");
}

// —— THE LEDGER IS CONSERVED THROUGH EVERYTHING THE ROOM DOES ——————
// The strongest claim this room makes. The bug: growth that adds biomass
// without taking it from a pool, a ration that loses the remainder, or a death
// whose body does not come back as litter. Any of those shows up here at
// 1e-12, nowhere near the float floor.
for (const { state, organisms } of worlds) {
  for (const c of climates) {
    for (const dt of [1, 600, 3600, 24 * 3600, 10 * 24 * 3600]) {
      const before = sumOf(state.pools);
      const res = H.settle(state, organisms, dt, c);
      near(sumOf(res.state.pools), before, 1e-12, "nothing in this room is created or destroyed");
      for (const p of POOLS) assert.ok(res.state.pools[p] >= -1e-15, `${p} never goes negative`);
      assert.equal(res.state.tau, state.tau + dt, "maturity advances by exactly the span lived");
      // the biotic pools ARE the lives — not a number kept alongside them
      let root = 0;
      let myc = 0;
      for (const o of res.organisms) (o.kind === "root" ? (root += o.m) : (myc += o.m));
      near(res.state.pools.root, root, 1e-15, "the root pool is the roots standing in the section");
      near(res.state.pools.mycelium, myc, 1e-15, "and the mycelium pool is the fungi");
      for (const o of res.organisms) {
        assert.ok(o.m >= H.DEATH_MASS, "every survivor is above the death mass");
        assert.equal(o.bornTau, organisms.find((q) => q.id === o.id).bornTau, "a life keeps its birthday");
      }
      assert.equal(
        res.organisms.length + res.died.length,
        organisms.length,
        "every life either survived or is named among the dead",
      );
    }
  }
}
{
  // the ration is where a leak would hide: ask a crowd to grow out of a pool
  // that cannot feed them and the pool must empty EXACTLY, with the shortfall
  // shared rather than conjured.
  // six roots, spread wide enough that none of them crowds another, so the
  // only thing limiting them is the size of the pool itself
  const spots = [
    [0.1, 0.55], [0.5, 0.55], [0.9, 0.55],
    [0.1, 0.95], [0.5, 0.95], [0.9, 0.95],
  ];
  let s = { pools: H.makePools(0.4, 0, 0, 0, 0), tau: 0 };
  let orgs = [];
  for (let i = 0; i < spots.length; i++) {
    const res = H.plant(s, orgs, "root", spots[i][0], spots[i][1], i + 1);
    s = res.state;
    orgs = res.organisms;
  }
  // six small seedlings with a lot of growing to do, and a bare surface so
  // nothing new mineralizes during the span: what is in the mineral pool now
  // is all there will ever be, and between them they want more than that
  orgs = orgs.map((o) => ({ ...o, m: 0.003 }));
  s = H.reconcile(s, orgs);
  s = { pools: { ...s.pools, litter: 0, humus: 0, mineral: 0.05 }, tau: 0 };
  const before = sumOf(s.pools);
  const res = H.settle(s, orgs, 20 * 24 * 3600, { warmth: 0.9, wet: 0.6 });
  near(sumOf(res.state.pools), before, 1e-12, "conserved even when the ground cannot pay everyone");
  assert.ok(res.state.pools.mineral >= 0, "and the rationed pool never goes negative");
  near(res.state.pools.mineral, 0, 1e-16, "the crowd ate every last unit of it");
  near(
    res.state.pools.root - s.pools.root,
    0.05,
    1e-15,
    "and between them they gained exactly what the ground could pay, not what they wanted",
  );
}

// —— COMPETITION AND MUTUALISM ARE REAL, NOT DECORATIVE ————————————
// The bug: neighbours drawn near each other with no consequence. Here two
// roots on top of each other must each end SMALLER than one root alone, and a
// fungus beside a root must make that root BIGGER — the mycorrhizal trade.
{
  const c = { warmth: 0.6, wet: 0.6 };
  const rich = { pools: H.makePools(0.2, 0.2, 0.3, 0, 0), tau: 0 };

  const alone = H.plant(rich, [], "root", 0.5, 0.7, 1);
  const kAlone = H.capacityOf(alone.organisms[0], alone.organisms, H.reconcile(alone.state, alone.organisms), c);

  const pairS = H.plant(alone.state, alone.organisms, "root", 0.52, 0.72, 2);
  const pair = H.reconcile(pairS.state, pairS.organisms);
  const kCrowded = H.capacityOf(pairS.organisms[0], pairS.organisms, pair, c);
  assert.ok(kCrowded < kAlone, "a root planted on top of another gets a smaller share");

  const farS = H.plant(alone.state, alone.organisms, "root", 0.5 + H.COMPETE_R + 0.05, 0.7, 3);
  const far = H.reconcile(farS.state, farS.organisms);
  near(
    H.capacityOf(farS.organisms[0], farS.organisms, far, c),
    H.capacityOf(farS.organisms[0], [farS.organisms[0]], far, c),
    1e-15,
    "and a root beyond the competition radius costs its neighbour nothing at all",
  );

  const mycoS = H.plant(alone.state, alone.organisms, "fungus", 0.52, 0.66, 4);
  const myco = H.reconcile(mycoS.state, mycoS.organisms);
  assert.ok(
    H.capacityOf(mycoS.organisms[0], mycoS.organisms, myco, c) >
      H.capacityOf(mycoS.organisms[0], [mycoS.organisms[0]], myco, c),
    "a fungus beside a root feeds it — the link is worth something, both ways",
  );
  assert.ok(
    H.capacityOf(mycoS.organisms[1], mycoS.organisms, myco, c) >
      H.capacityOf(mycoS.organisms[1], [mycoS.organisms[1]], myco, c),
    "and the fungus is paid too",
  );
  // ...and it plays out over time, not just in the arithmetic
  const withFungus = H.settle(myco, mycoS.organisms, 3 * 24 * 3600, c);
  const withoutFungus = H.settle(
    H.reconcile(alone.state, alone.organisms),
    alone.organisms,
    3 * 24 * 3600,
    c,
  );
  assert.ok(
    withFungus.organisms.find((o) => o.kind === "root").m >
      withoutFungus.organisms.find((o) => o.kind === "root").m,
    "after three days the partnered root is genuinely the larger plant",
  );
}
{
  // depth is a decision: a root belongs in the mineral horizon, a fungus in
  // the litter. The bug: an affinity that ignores where the hand planted.
  const c = { warmth: 0.6, wet: 0.6 };
  const s = { pools: H.makePools(0.2, 0.2, 0.3, 0, 0), tau: 0 };
  const shallowRoot = H.plant(s, [], "root", 0.5, 0.1, 1);
  const deepRoot = H.plant(s, [], "root", 0.5, 0.95, 2);
  assert.ok(
    H.capacityOf(deepRoot.organisms[0], deepRoot.organisms, deepRoot.state, c) >
      H.capacityOf(shallowRoot.organisms[0], shallowRoot.organisms, shallowRoot.state, c),
    "a root reaches the mineral it eats by going down",
  );
  const shallowFungus = H.plant(s, [], "fungus", 0.5, 0.1, 3);
  const deepFungus = H.plant(s, [], "fungus", 0.5, 0.95, 4);
  assert.ok(
    H.capacityOf(shallowFungus.organisms[0], shallowFungus.organisms, shallowFungus.state, c) >
      H.capacityOf(deepFungus.organisms[0], deepFungus.organisms, deepFungus.state, c),
    "and a fungus eats the litter lying on top",
  );
  // a drought starves the roots specifically — water is a root's constraint
  const dry = H.capacityOf(deepRoot.organisms[0], deepRoot.organisms, deepRoot.state, { warmth: 0.6, wet: 0 });
  const wet = H.capacityOf(deepRoot.organisms[0], deepRoot.organisms, deepRoot.state, { warmth: 0.6, wet: 1 });
  assert.ok(dry < wet, "a dry section supports less root than a watered one");
}
{
  // starvation is a real death, and the body comes back. The bug: an organism
  // that quietly disappears, taking its matter out of the ledger with it.
  const barren = { pools: H.makePools(0.05, 0.0, 0.0, 0, 0), tau: 0 };
  const planted = H.plant(barren, [], "root", 0.5, 0.8, 9);
  const s = H.reconcile(planted.state, planted.organisms);
  const before = sumOf(s.pools);
  const res = H.settle(s, planted.organisms, 40 * 24 * 3600, { warmth: 0.7, wet: 0.05 });
  assert.equal(res.organisms.length, 0, "a root with nothing to eat does not survive a month");
  assert.deepEqual(res.died, [planted.organisms[0].id], "and it is named among the dead");
  near(sumOf(res.state.pools), before, 1e-12, "its body is still in the ledger");
  assert.equal(res.state.pools.root, 0, "the root pool empties with the last root");
}

// —— planting and pulling: the two hands ——————————————————————————
{
  const s = { pools: H.makePools(0.2, 0.1, 0.1, 0, 0), tau: 500 };
  const before = sumOf(s.pools);
  const res = H.plant(s, [], "root", 0.4, 0.6, 77);
  assert.ok(res.planted, "there was litter enough to make a seed from");
  near(sumOf(res.state.pools), before, 1e-15, "planting moves matter into a life, it does not import any");
  near(res.state.pools.litter, s.pools.litter - H.SEED_MASS, 1e-15, "and it comes out of the litter");
  near(res.state.pools.root, H.SEED_MASS, 1e-15, "arriving as root");
  assert.equal(res.planted.bornTau, s.tau, "a life knows when it began");

  // the refusal: nothing to make it from
  const bare = { pools: H.makePools(H.SEED_MASS * 0.5, 0.3, 0.3, 0, 0), tau: 0 };
  const refused = H.plant(bare, [], "fungus", 0.5, 0.5, 1);
  assert.equal(refused.planted, null, "a surface with no litter left cannot make a seed");
  assert.equal(refused.state, bare, "and is left exactly as it was");

  // the cap
  let capped = { pools: H.makePools(1, 0, 0, 0, 0), tau: 0 };
  let orgs = [];
  for (let i = 0; i < H.MAX_ORGANISMS + 6; i++) {
    const r = H.plant(capped, orgs, i % 2 ? "fungus" : "root", (i % 7) / 7, 0.5, i);
    capped = r.state;
    orgs = r.organisms;
  }
  assert.equal(orgs.length, H.MAX_ORGANISMS, "the section holds its population cap");
  assert.equal(new Set(orgs.map((o) => o.id)).size, orgs.length, "and every life has its own id");

  // pulling one out
  const grown = { ...res.organisms[0], m: 0.09 };
  const withGrown = H.reconcile(res.state, [grown]);
  const total = sumOf(withGrown.pools);
  const pulled = H.uproot(withGrown, [grown], grown.id);
  assert.equal(pulled.organisms.length, 0, "the life is gone from the ground");
  assert.equal(pulled.pulled.id, grown.id, "and the hand knows which one it took");
  near(sumOf(pulled.state.pools), total, 1e-15, "but its matter is not");
  near(pulled.state.pools.litter, withGrown.pools.litter + 0.09, 1e-15, "it lands back on the surface as litter");
  assert.equal(pulled.state.pools.root, 0, "and the pool it was counted in lets it go");
  assert.equal(H.uproot(withGrown, [grown], 9999).pulled, null, "pulling at nothing pulls nothing");
}
{
  // reconcile is the repair, not a second source of truth
  const orgs = [
    { id: 1, kind: "root", nx: 0.3, ny: 0.6, m: 0.03, bornTau: 0, seed: 1 },
    { id: 2, kind: "fungus", nx: 0.6, ny: 0.3, m: 0.02, bornTau: 0, seed: 2 },
  ];
  const lying = { pools: H.makePools(0.1, 0.1, 0.1, 0.09, 0.11), tau: 0 };
  const fixed = H.reconcile(lying, orgs);
  near(fixed.pools.root, 0.03, 1e-15, "the pools are re-read off the lives");
  near(fixed.pools.mycelium, 0.02, 1e-15, "both of them");
  near(sumOf(fixed.pools), sumOf(lying.pools), 1e-15, "and the orphaned biomass is not lost, only relocated");
  near(fixed.pools.litter, 0.1 + 0.08 + 0.07, 1e-15, "it falls to the surface as litter");
  const honest = H.reconcile(fixed, orgs);
  assert.deepEqual(honest, fixed, "a ledger that already agrees is left alone");
}

// —— nearest, for the hand that pulls ——————————————————————————————
{
  const orgs = [
    { id: 1, kind: "root", nx: 0.2, ny: 0.2, m: 0.01, bornTau: 0, seed: 1 },
    { id: 2, kind: "root", nx: 0.8, ny: 0.8, m: 0.01, bornTau: 0, seed: 2 },
  ];
  assert.equal(H.nearestOrganism(orgs, 0.22, 0.22, 0.18).id, 1, "the hand finds what it reached for");
  assert.equal(H.nearestOrganism(orgs, 0.5, 0.5, 0.18), null, "and finds nothing where there is nothing");
  assert.equal(H.nearestOrganism([], 0.2, 0.2), null, "an empty section has nothing to pull");
}

// —— the away span is bounded, and it is ONE evaluation ————————————
{
  const c = { warmth: 0.5, wet: 0.55 };
  const { state, organisms } = worlds[3];
  const s = H.reconcile(state, organisms);
  const year = H.settleElapsed(s, organisms, 365 * 24 * 3600, c);
  const cap = H.settleElapsed(s, organisms, H.MAX_ELAPSED_S, c);
  for (const p of POOLS) near(year.state.pools[p], cap.state.pools[p], 1e-15, `${p} after a year is ${p} at the cap`);
  assert.equal(H.settleElapsed(s, organisms, -5, c).state, s, "time never runs backwards");
  // ...and the roots really did grow while nobody watched
  const week = H.settleElapsed(s, organisms, 7 * 24 * 3600, c);
  assert.ok(
    week.state.pools.root > s.pools.root,
    "a week away is read off the trajectory as growth, not as nothing",
  );
  assert.ok(
    H.settleElapsed(s, organisms, 2 * 24 * 3600, c).state.pools.root < week.state.pools.root,
    "and a longer absence is more growth, monotonically",
  );
}

// —— roots reach further the bigger they get ————————————————————————
{
  let last = -1;
  for (const m of [0.005, 0.01, 0.03, 0.08, 0.2, 0.6]) {
    const d = H.rootReach({ id: 1, kind: "root", nx: 0.5, ny: 0.5, m, bornTau: 0, seed: 1 });
    assert.ok(d > last, "a heavier root reaches further down");
    assert.ok(d < H.ROOT_DEPTH_MAX, "but never through the floor of the section");
    last = d;
  }
  assert.equal(H.rootReach({ id: 1, kind: "root", nx: 0, ny: 0, m: 0, bornTau: 0, seed: 1 }), 0, "no mass, no reach");
}

// —— layering redistributes the ledger, it does not invent any ————————
{
  const m = H.mixOf({ pools: H.makePools(0.22, 0.3, 0.2, 0.1, 0.18), tau: 0 });
  for (let i = 0; i <= 20; i++) {
    const d = i / 20;
    const at = H.mixAtDepth(m, d);
    near(sumOf(at), 1, 1e-15, `a handful from depth ${d} is still a whole handful`);
    for (const p of POOLS) assert.ok(at[p] >= 0, `${p} never goes negative at depth ${d}`);
  }
  // hand-computable: mid-depth is the bulk mix untouched, and the surface and
  // the floor average back to it exactly. A layering that shaved the ledger
  // would fail this by exactly what it shaved.
  assert.deepEqual(H.mixAtDepth(m, 0.5), m, "mid-depth is the bulk soil itself");
  const top = H.mixAtDepth(m, 0);
  const bot = H.mixAtDepth(m, 1);
  for (const p of POOLS) {
    near((top[p] + bot[p]) / 2, m[p], 1e-15, `${p} at the surface and the floor average to the bulk`);
  }
  let lastLitter = Infinity;
  for (let i = 0; i <= 10; i++) {
    const at = H.mixAtDepth(m, i / 10);
    assert.ok(at.litter < lastLitter, "litter thins with depth, always");
    lastLitter = at.litter;
  }
}

// —— THE MAP: the ledger is heard, and read back ————————————————————
// The bug this catches: a timbre that merely reacts to the soil instead of
// carrying it. If this round trip fails, the room's central claim — that what
// a handful IS can be heard — is decoration.
for (const { state, organisms } of worlds) {
  const s0 = H.reconcile(state, organisms);
  for (const dt of [0, 3600, 3 * 24 * 3600]) {
    const evolved = dt === 0 ? s0 : H.settle(s0, organisms, dt, { warmth: 0.5, wet: 0.5 }).state;
    const mix = H.mixOf(evolved);
    const t = H.timbreOfState(evolved);
    const back = H.mixFromTimbre(t);
    for (const p of POOLS) near(back[p], mix[p], 1e-12, `${p} survives the trip through sound`);
    near(H.totalFromTimbre(t), H.totalOf(evolved), 1e-12, "and so does how much soil there is");
    near(
      H.decompositionFromTimbre(t),
      H.decompositionOf(mix),
      1e-12,
      "how far it has rotted is legible in the centroid alone",
    );
  }
}
{
  // The calibration cases, computable by hand. Half litter must land on the
  // geometric mean of the centroid range, or the map is not the log map it
  // claims to be.
  const half = H.makePools(0.5, 0.5, 0, 0, 0);
  const t = H.timbreOf(half, H.MAX_TOTAL);
  near(t.centroidHz, Math.sqrt(H.CENTROID_LO * H.CENTROID_HI), 1e-9, "half litter is the geometric mean centroid");
  near(t.centroidHz, 440, 1e-9, "which is, by the numbers chosen, concert a");
  near(t.dampHz, Math.sqrt(H.DAMP_LO * H.DAMP_HI), 1e-9, "half humus is the geometric mean cutoff");
  near(t.midi, H.MIDI_LO, 1e-15, "a full section sits at the bottom of the register");
  near(H.timbreOf(half, 0).midi, H.MIDI_HI, 1e-15, "and an empty one at the top");
  near(
    H.timbreOf(H.makePools(0, 0.5, 0.5, 0, 0), 0.5).ringSec,
    (H.RING_LO + H.RING_HI) / 2,
    1e-15,
    "half mineral rings for half the range",
  );
}
{
  // Monotone and bounded in every channel: the bug is a map that saturates or
  // folds, so two different soils sound identical.
  let lastC = -1;
  let lastD = Infinity;
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    const litter = H.timbreOf(H.makePools(f, 1 - f, 0, 0, 0), 0.5);
    assert.ok(litter.centroidHz > lastC, "more litter is strictly brighter");
    assert.ok(litter.centroidHz >= H.CENTROID_LO - 1e-9 && litter.centroidHz <= H.CENTROID_HI + 1e-9, "centroid stays in range");
    lastC = litter.centroidHz;
    const humus = H.timbreOf(H.makePools(1 - f, f, 0, 0, 0), 0.5);
    assert.ok(humus.dampHz < lastD, "more humus damps strictly harder");
    assert.ok(humus.dampHz >= H.DAMP_LO - 1e-9 && humus.dampHz <= H.DAMP_HI + 1e-9, "damping stays in range");
    lastD = humus.dampHz;
  }
  let lastMidi = Infinity;
  for (let i = 0; i <= 10; i++) {
    const t = H.timbreOf(H.makePools(0.2, 0.3, 0.2, 0.1, 0.2), (i / 10) * H.MAX_TOTAL);
    assert.ok(t.midi < lastMidi, "a heavier handful sounds strictly lower");
    lastMidi = t.midi;
  }
}
{
  // ...and the brightness is audible, not notional: a rotted soil is genuinely
  // fewer voices than a fresh one. This is what makes the map perceptible.
  const fresh = H.voiceOf(H.timbreOf(H.makePools(1, 0, 0, 0, 0), 1));
  const rotted = H.voiceOf(H.timbreOf(H.makePools(0, 1, 0, 0, 0), 1));
  assert.ok(rotted.length < fresh.length, "humified soil sounds with strictly fewer partials");
  assert.ok(fresh.length <= H.MAX_PARTIALS + 1, "and no soil ever exceeds the partial budget");
  for (const v of [...fresh, ...rotted]) {
    assert.ok(v.gain >= H.AUDIBLE_GAIN, "an inaudible partial is never scheduled");
    assert.ok(v.sec > 0 && v.sec <= H.RING_HI, "every partial has a real, bounded life");
    assert.ok(v.hz > 0 && v.hz < 20000, "and a frequency an ear could meet");
  }
  const threaded = H.voiceOf(H.timbreOf(H.makePools(0.2, 0.3, 0.1, 0.3, 0.1), 0.6));
  const beat = threaded[threaded.length - 1].hz - threaded[0].hz;
  near(beat, H.BEAT_MAX * 0.3, 1e-9, "the beat rate is the mycelium share, exactly");
  for (const { state, organisms } of worlds) {
    assert.ok(H.voiceOf(H.timbreOfState(H.reconcile(state, organisms))).length >= 1, "no soil is ever silent");
  }
  assert.ok(H.voiceOf(H.timbreOf(H.makePools(0, 0, 1, 0, 0), 0)).length >= 1, "not even bare parent rock");
}

// —— MYCELIUM IS A REAL GRAPH ——————————————————————————————————————
// The bug: threads drawn between whatever looks good, so "connected" means
// nothing. Here connectivity is union-find, and it is checked against an
// independent breadth-first reference.
function bfsComponents(count, edges) {
  const adj = Array.from({ length: count }, () => []);
  for (const e of edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const label = new Array(count).fill(-1);
  let next = 0;
  for (let i = 0; i < count; i++) {
    if (label[i] >= 0) continue;
    const queue = [i];
    label[i] = next;
    while (queue.length) {
      const v = queue.pop();
      for (const w of adj[v]) {
        if (label[w] < 0) {
          label[w] = next;
          queue.push(w);
        }
      }
    }
    next += 1;
  }
  return { label, count: next };
}

const org = (id, kind, nx, ny) => ({ id, kind, nx, ny, m: 0.02, bornTau: 0, seed: id });

{
  // A hypha runs from a fungus, never between two roots. The bug: a "network"
  // that wires the plants directly to each other and calls it mycorrhiza.
  const twoRoots = [org(1, "root", 0.2, 0.5), org(2, "root", 0.25, 0.5)];
  assert.deepEqual(H.threadsBetween(twoRoots, 0.5), [], "roots do not thread to each other");
  const mixed = [org(1, "root", 0.2, 0.5), org(2, "fungus", 0.25, 0.5)];
  assert.deepEqual(H.threadsBetween(mixed, 0.5), [{ a: 0, b: 1 }], "but a fungus reaches a root");

  const line = [org(1, "fungus", 0.2, 0.5), org(2, "fungus", 0.3, 0.5), org(3, "fungus", 0.4, 0.5)];
  const none = H.threadsBetween(line, 0.05);
  assert.equal(none.length, 0, "a reach shorter than the gap joins nothing");
  assert.equal(H.componentCount(3, none), 3, "three lives, three islands");
  const near2 = H.threadsBetween(line, 0.15);
  assert.deepEqual(near2, [{ a: 0, b: 1 }, { a: 1, b: 2 }], "only the neighbours are threaded");
  assert.equal(H.componentCount(3, near2), 1, "and the line is one island");
  const comps = H.componentsOf(3, near2);
  assert.equal(comps[0], comps[2], "the far ends are connected THROUGH the middle — real transitivity");
  assert.equal(H.threadsBetween(line, 0.25).length, 3, "a longer reach finds the far pair too");
  near(H.largestComponentShare(3, near2), 1, 1e-15, "the whole line is one island");
  assert.equal(H.largestComponentShare(3, none), 1 / 3, "and unthreaded, each life is its own");
}
{
  const rng = H.mulberry32(0x501);
  const field = [];
  for (let i = 0; i < 20; i++) field.push(org(i + 1, i % 3 === 0 ? "root" : "fungus", rng(), rng()));
  for (const reach of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.5]) {
    const edges = H.threadsBetween(field, reach);
    for (const e of edges) {
      const d = Math.hypot(field[e.a].nx - field[e.b].nx, field[e.a].ny - field[e.b].ny);
      assert.ok(d <= reach + 1e-12, "no thread outruns the reach");
      assert.ok(field[e.a].kind === "fungus" || field[e.b].kind === "fungus", "and every thread has a fungus in it");
    }
    const mine = H.componentsOf(field.length, edges);
    const ref = bfsComponents(field.length, edges);
    assert.equal(H.componentCount(field.length, edges), ref.count, `component count at reach ${reach}`);
    for (let i = 0; i < field.length; i++) {
      for (let j = 0; j < field.length; j++) {
        assert.equal(
          mine[i] === mine[j],
          ref.label[i] === ref.label[j],
          `lives ${i} and ${j} agree with breadth-first reachability at reach ${reach}`,
        );
      }
    }
    assert.ok(
      edges.length >= field.length - ref.count,
      "a connected island cannot exist without the threads to hold it",
    );
    assert.deepEqual(H.threadsBetween(field, reach), edges, "the same soil grows the same threads");
  }
  // reach only ever adds threads and only ever merges islands
  let lastCount = Infinity;
  let lastEdges = new Set();
  for (const reach of [0.02, 0.06, 0.1, 0.14, 0.2, 0.3]) {
    const edges = H.threadsBetween(field, reach);
    const keys = new Set(edges.map((e) => `${e.a}-${e.b}`));
    for (const k of lastEdges) assert.ok(keys.has(k), "a thread once grown is never un-grown by more reach");
    const c = H.componentCount(field.length, edges);
    assert.ok(c <= lastCount, "more reach never splits an island");
    lastCount = c;
    lastEdges = keys;
  }
}
{
  // The reach itself grows with maturity and with how fungal the ledger is,
  // and it saturates. The bug: threads that keep creeping until they cross the
  // whole section, or that grow in soil with no mycelium in it at all.
  assert.equal(H.reachAt(0, 1), 0, "at the first instant nothing has crept anywhere");
  assert.equal(H.reachAt(1e9, 0), 0, "and soil with no fungus never threads, however long you leave it");
  let last = -1;
  for (const tau of [0, 3600, 6 * 3600, 24 * 3600, 7 * 24 * 3600, 90 * 24 * 3600]) {
    const r = H.reachAt(tau, 0.18);
    assert.ok(r > last, "threads creep further the longer the soil has lived");
    assert.ok(r < H.REACH_MAX + 1e-12, "but never past the reach ceiling");
    last = r;
  }
  assert.equal(H.reachAt(1e9, 0.9), H.reachAt(1e9, 0.2), "the fungal share saturates at its full fraction");
}
{
  // ...so the soil knits itself together while nobody is watching. This is the
  // aliveness claim made falsifiable: same lives, more elapsed time, strictly
  // no more islands than before.
  const { state, organisms } = worlds[1];
  let s = H.reconcile(state, organisms);
  let orgs = organisms;
  const c = { warmth: 0.6, wet: 0.6 };
  let lastComponents = Infinity;
  for (let day = 0; day < 8; day++) {
    const res = H.settle(s, orgs, 24 * 3600, c);
    s = res.state;
    orgs = res.organisms;
    const edges = H.threadsBetween(orgs, H.reachAt(s.tau, H.mixOf(s).mycelium));
    const count = H.componentCount(orgs.length, edges);
    assert.ok(count <= lastComponents, "a day of growing never leaves the soil more broken up");
    lastComponents = count;
  }
  assert.ok(lastComponents < orgs.length, "after a week the threads have found each other");
}

// —— storage, caps, determinism ——————————————————————————————————
{
  const junk = H.normalizePools({ litter: -3, humus: NaN, mineral: 0.2, mycelium: undefined, root: 0.1 });
  for (const p of POOLS) assert.ok(junk[p] >= 0, `${p} is never negative after normalizing`);
  near(junk.mineral, 0.2, 1e-15, "the surviving pools keep their amounts");
  assert.ok(sumOf(H.normalizePools({})) > 0, "an empty record falls back to a real soil");
  const overfull = H.normalizePools({ litter: 5, humus: 5, mineral: 5, mycelium: 5, root: 5 });
  near(sumOf(overfull), H.MAX_TOTAL, 1e-15, "a ledger bigger than the section is scaled to fit");
  near(overfull.litter, H.MAX_TOTAL / 5, 1e-15, "keeping what the soil was");
}
{
  assert.deepEqual(H.starterState(0xabc), H.starterState(0xabc), "a seed is a soil");
  assert.notDeepEqual(H.starterState(1).pools, H.starterState(2).pools, "and different seeds are different soils");
  for (const seed of seeds) {
    const w = H.starterOrganisms(H.starterState(seed), seed);
    const t = sumOf(w.state.pools);
    assert.ok(t > 0 && t <= H.MAX_TOTAL, "every starter sits inside the section's capacity");
    near(t, sumOf(H.starterState(seed).pools), 1e-15, "and its lives were made from it, not added to it");
    assert.ok(w.organisms.length >= 2, "the ground is already inhabited when you arrive");
    assert.ok(w.organisms.some((o) => o.kind === "fungus"), "by both kingdoms");
    assert.ok(w.organisms.some((o) => o.kind === "root"), "so the trade is visible from the first frame");
    for (const o of w.organisms) {
      assert.ok(o.nx >= 0 && o.nx <= 1 && o.ny >= 0 && o.ny <= 1, "every life stands inside the frame");
    }
    assert.deepEqual(H.starterOrganisms(H.starterState(seed), seed), w, "the same seed grows the same ground");
  }
}
{
  // the two doors in the ledger: what falls in, what is carried out
  const s = H.starterState(0x77);
  const before = H.totalOf(s);
  const ask = 0.4;
  const { state: a, accepted } = H.addLitter(s, ask);
  near(accepted, Math.min(ask, H.MAX_TOTAL - before), 1e-15, "the brim refuses the surplus, openly");
  near(H.totalOf(a) - before, accepted, 1e-15, "the total grew by exactly what was accepted");
  near(a.pools.litter, s.pools.litter + accepted, 1e-15, "and all of it arrived as litter");
  const full = { pools: H.makePools(H.MAX_TOTAL, 0, 0, 0, 0), tau: 0 };
  assert.equal(H.addLitter(full, 0.5).accepted, 0, "a full soil accepts nothing");
  assert.equal(H.addLitter(full, 0.5).state, full, "and is left exactly as it was");

  const { state: t, taken } = H.takeAway(s, 0.1);
  near(taken, 0.1, 1e-15, "a handful weighs what it weighs");
  near(H.totalOf(t), before - taken, 1e-14, "and the section is lighter by exactly that");
  const m0 = H.mixOf(s);
  const m1 = H.mixOf(t);
  for (const p of POOLS) near(m1[p], m0[p], 1e-15, `${p}: a handful is a sample of the whole, not a skim`);
  const floorState = { pools: H.makePools(H.MIN_TOTAL, 0, 0, 0, 0), tau: 0 };
  assert.equal(H.takeAway(floorState, 1).taken, 0, "the last of the soil cannot be carried off");
  const partial = H.takeAway({ pools: H.makePools(H.MIN_TOTAL + 0.01, 0, 0, 0, 0), tau: 0 }, 1);
  near(partial.taken, 0.01, 1e-15, "near the floor only the surplus goes");
  near(H.totalOf(partial.state), H.MIN_TOTAL, 1e-15, "leaving exactly the floor");
}
{
  // a hand-made transfer moves what it says and clamps where it must
  const s = { pools: H.makePools(0.1, 0.1, 0.05, 0.02, 0.03), tau: 0 };
  const before = sumOf(s.pools);
  const { state, moved } = H.transfer(s, "litter", "humus", 0.04);
  near(moved, 0.04, 1e-15, "it moved what it was asked to move");
  near(state.pools.litter, 0.06, 1e-15, "out of the source");
  near(state.pools.humus, 0.14, 1e-15, "into the destination");
  near(sumOf(state.pools), before, 1e-15, "and the ledger is unchanged");
  const clamped = H.transfer(s, "mineral", "root", 999);
  near(clamped.moved, 0.05, 1e-15, "it moves everything that was there, and no more");
  near(clamped.state.pools.mineral, 0, 1e-15, "the emptied pool is exactly empty");
  near(sumOf(clamped.state.pools), before, 1e-15, "conserved at the clamp");
  assert.equal(H.transfer(s, "humus", "humus", 0.1).moved, 0, "a pool cannot feed itself");
  assert.equal(H.transfer(s, "humus", "root", -1).moved, 0, "a negative transfer is no transfer");
}

console.log(
  "humus ok: the ledger conserved to 1e-12 through decay, growth, rationing, death, planting and pulling; " +
    "the litter→humus→mineral cascade exact at any step count with a Q10 of 2 and a moisture optimum at 0.6; " +
    "logistic growth landing in the same place in 1 step and in 1000; competition and the mycorrhizal trade " +
    "changing who wins; mix↔timbre a true round trip with the centroid on concert a at half litter; " +
    "and fungal connectivity matching breadth-first reachability at every reach",
);
