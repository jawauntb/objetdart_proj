// The field floor (/quanta) — the laws that can lie, pinned.
// Falsifiable only: the mass↔lifetime inverse, conservation through every
// decay chain, the ladder's ordering and affordability, the hand's cap
// under the W pair, E = hf monotone and audible, determinism throughout.

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
  // Same realm as the test — vm.runInNewContext yields string primitives that
  // fail deepStrictEqual against host literals despite identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  PARTICLES,
  PARTICLE_IDS,
  LADDER,
  PHOTON_E_MIN,
  PHOTON_E_MAX,
  HOLD_E_CAP,
  CONFINEMENT_REACH_PX,
  PITCH_MIN_HZ,
  PITCH_MAX_HZ,
  conjugate,
  chargeOf,
  flavorOf,
  ledgerOf,
  symbolOf,
  lifetimeMs,
  betaFor,
  reachPx,
  decayProducts,
  decayChain,
  rungFor,
  birthFor,
  holdEnergy,
  windEnergy,
  photonPitchHz,
  dopplerHz,
  settlePopulation,
  starterKinds,
  annihilates,
  annihilationProducts,
  annihilationPhotonEnergy,
  interference,
  superposedAmplitude,
} = loadTsModule("src/lib/quanta.ts");

// — The one great law: among the unstable massive species, more mass means
//   less time. A drifted lifetime table (or a new species slotted in
//   carelessly) breaks the strict ordering and fails here.
{
  const unstableMassive = PARTICLE_IDS.filter(
    (id) => !PARTICLES[id].stable && id !== "gluon",
  ).sort((a, b) => PARTICLES[a].massMeV - PARTICLES[b].massMeV);
  // Compare as joined strings: vm-loaded modules yield string primitives that
  // can fail deepStrictEqual despite identical content.
  assert.equal(
    unstableMassive.join(","),
    "muon,tau,w,z,higgs",
    "the unstable massive ladder is muon → tau → W → Z → Higgs",
  );
  for (let i = 1; i < unstableMassive.length; i++) {
    const lighter = unstableMassive[i - 1];
    const heavier = unstableMassive[i];
    assert.ok(
      lifetimeMs(lighter) > lifetimeMs(heavier),
      `${lighter} (${PARTICLES[lighter].massMeV} MeV) must outlive ${heavier}`,
    );
  }
  // The muon lingers long enough to watch; the Higgs is gone within a breath.
  assert.ok(lifetimeMs("muon") > 4000, "the muon lives a while");
  assert.ok(lifetimeMs("higgs") < 900, "the higgs dies within a fingertip's breadth");
  // Stability is not a lifetime: the stable cross the field forever.
  for (const id of ["photon", "electron", "nu-e", "nu-mu", "nu-tau"]) {
    assert.equal(lifetimeMs(id), Infinity, `${id} is stable`);
  }
}

// — Reach is inverse to mass twice over (slower at fixed energy, briefer),
//   the photon's reach is unbounded, and the gluon is the pinned exception:
//   massless yet leashed by confinement, never by decay.
{
  const generous = 300000; // MeV — everyone is relativistic at this table
  const seq = ["muon", "tau", "w", "z", "higgs"];
  for (let i = 1; i < seq.length; i++) {
    assert.ok(
      reachPx(seq[i - 1], generous) > reachPx(seq[i], generous),
      `${seq[i - 1]} reaches farther than ${seq[i]}`,
    );
  }
  assert.equal(reachPx("photon", 0.2), Infinity, "a photon crosses the field forever");
  assert.equal(reachPx("nu-tau", 5), Infinity, "a neutrino streams through everything");
  assert.equal(reachPx("gluon", generous), CONFINEMENT_REACH_PX, "the gluon never travels far, at any energy");
  assert.ok(
    reachPx("gluon", generous) < reachPx("muon", generous),
    "confinement leashes the massless gluon below the massive muon's reach",
  );
  // β physics: nothing beats c, energy buys speed, sub-mass energy buys none.
  assert.equal(betaFor(0, 0.01), 1, "massless means exactly c");
  assert.equal(betaFor(105.66, 50), 0, "below rest mass nothing moves");
  const b1 = betaFor(105.66, 200);
  const b2 = betaFor(105.66, 2000);
  assert.ok(b1 > 0 && b2 > b1 && b2 < 1, "beta grows with energy and never reaches c");
}

// — Conservation: every decay, of every species and both orientations,
//   balances charge and all three lepton flavor numbers exactly. The chain
//   version must conserve at every step and end entirely in stable residue.
{
  for (const id of PARTICLE_IDS) {
    for (const anti of [false, true]) {
      const x = { id, anti: anti && !PARTICLES[id].selfConjugate };
      for (let seed = 1; seed <= 40; seed++) {
        const products = decayProducts(x, seed);
        if (products.length === 0) continue;
        const before = ledgerOf([x]);
        const after = ledgerOf(products);
        assert.deepEqual(after, before, `${symbolOf(x)} decay conserves the books (seed ${seed})`);
        // Energy affordability: the products' rest mass fits in the parent's.
        const restBefore = PARTICLES[id].massMeV;
        const restAfter = products.reduce((s, p) => s + PARTICLES[p.id].massMeV, 0);
        assert.ok(restAfter < restBefore, `${symbolOf(x)} decays downhill in mass`);
      }
    }
  }
  // Full chains: terminate, conserve end to end, land on stable species only.
  for (const id of ["muon", "tau", "w", "z", "higgs"]) {
    for (let seed = 1; seed <= 60; seed++) {
      const x = { id, anti: false };
      const residue = decayChain(x, seed);
      assert.ok(residue.length > 0, `${id} chain terminates`);
      for (const r of residue) {
        assert.ok(PARTICLES[r.id].stable, `${id} chain ends stable (got ${r.id})`);
      }
      assert.deepEqual(ledgerOf(residue), ledgerOf([x]), `${id} chain conserves end to end (seed ${seed})`);
    }
  }
  // Determinism: the same seed always decays the same way.
  const a = decayChain({ id: "higgs", anti: false }, 7);
  const b = decayChain({ id: "higgs", anti: false }, 7);
  assert.deepEqual(a, b, "same seed, same chain, forever");
  // The W's flavor choice really uses the seed (a constant would pass
  // conservation but flatten the room): some pair of seeds must differ.
  const flavors = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    flavors.add(decayProducts({ id: "w", anti: false }, seed)[0].id);
  }
  assert.ok(flavors.size > 1, "the W draws its lepton flavor from the seed");
  // The Higgs never draws: always the heaviest pair it can afford.
  for (let seed = 1; seed <= 30; seed++) {
    const p = decayProducts({ id: "higgs", anti: false }, seed);
    assert.deepEqual(p.map((q) => q.id).sort(), ["tau", "tau"], "H → τ⁺τ⁻, always");
  }
  // Conjugation is an involution away from the self-conjugate.
  assert.deepEqual(conjugate(conjugate({ id: "muon", anti: false })), { id: "muon", anti: false });
  assert.deepEqual(conjugate({ id: "photon", anti: false }), { id: "photon", anti: false });
}

// — The ladder: strictly ascending rungs; every birth affordable at its own
//   threshold and neutral in every conserved number; birthFor takes the
//   highest affordable rung and nothing below the first.
{
  for (let i = 1; i < LADDER.length; i++) {
    assert.ok(
      LADDER[i].thresholdMeV > LADDER[i - 1].thresholdMeV,
      `ladder ascends at ${LADDER[i].name}`,
    );
  }
  for (const rung of LADDER) {
    for (let seed = 1; seed <= 10; seed++) {
      const born = rung.birth(seed);
      assert.ok(born.length >= 1, `${rung.name} yields something`);
      const rest = born.reduce((s, p) => s + PARTICLES[p.id].massMeV, 0);
      assert.ok(rest <= rung.thresholdMeV + 1e-9, `${rung.name} is affordable at its threshold`);
      assert.deepEqual(
        ledgerOf(born),
        { charge: 0, e: 0, mu: 0, tau: 0 },
        `${rung.name} is born neutral — the vacuum owes nothing`,
      );
    }
  }
  assert.equal(rungFor(PHOTON_E_MIN / 2), -1, "below the first rung the vacuum keeps still");
  assert.deepEqual(birthFor(PHOTON_E_MIN / 2, 1), [], "no energy, no ripple");
  assert.equal(LADDER[rungFor(0.5)].name, "photon", "a whisper buys a photon");
  assert.equal(LADDER[rungFor(2)].name, "electron pair", "past 2mₑ the pair rung opens");
  assert.equal(LADDER[rungFor(300)].name, "muon pair");
  assert.equal(LADDER[rungFor(5000)].name, "tau pair");
  assert.equal(LADDER[rungFor(100000)].name, "z");
  assert.equal(LADDER[rungFor(126000)].name, "higgs");
  assert.equal(LADDER[rungFor(200000)].name, "w pair");
  // The W pair genuinely costs more than the Higgs — the room's punchline.
  const wRung = LADDER.find((r) => r.name === "w pair");
  const hRung = LADDER.find((r) => r.name === "higgs");
  assert.ok(wRung.thresholdMeV > hRung.thresholdMeV, "a W pair costs more than a Higgs");
}

// — The hold axis IS the mass ladder: monotone, photon at the touch tier,
//   the ceremony crests the Higgs, and the cap stays under the W pair —
//   the hand alone can never make one.
{
  let prev = -1;
  for (let ms = 0; ms <= 4000; ms += 50) {
    const e = holdEnergy(ms);
    assert.ok(e >= prev, "hold energy never falls while the hand stays");
    prev = e;
  }
  assert.equal(LADDER[rungFor(holdEnergy(300))].name, "photon", "a touch-tier hold buys only a photon");
  assert.ok(rungFor(holdEnergy(900)) >= 1, "the dwell tier affords a pair");
  assert.equal(LADDER[rungFor(holdEnergy(2500))].name, "higgs", "the ceremony births the Higgs");
  const wThreshold = LADDER.find((r) => r.name === "w pair").thresholdMeV;
  assert.ok(HOLD_E_CAP < wThreshold, "the hand's cap sits under the W pair");
  assert.ok(holdEnergy(1e9) < wThreshold, "holding forever still never affords a W");
  // The collision wind is the one road past the cap.
  assert.ok(windEnergy(6) >= wThreshold, "a sustained collision wind crests the W pair");
  let wPrev = -1;
  for (let w = 0; w <= 8; w += 0.25) {
    const e = windEnergy(w);
    assert.ok(e >= wPrev, "wind energy is monotone in the sweep");
    wPrev = e;
  }
}

// — E = hf: pitch strictly monotone in energy, five octaves inside the
//   audible register; Doppler bends it the right way and only that way.
{
  let prev = 0;
  for (let e = PHOTON_E_MIN; e <= PHOTON_E_MAX * 2; e *= 1.15) {
    const hz = photonPitchHz(e);
    assert.ok(hz > prev, "hotter photon, higher note");
    assert.ok(hz >= PITCH_MIN_HZ - 1e-9 && hz <= PITCH_MAX_HZ + 1e-9, "the register stays audible");
    prev = hz;
  }
  const base = photonPitchHz(0.4);
  assert.ok(dopplerHz(base, 0.5) > base, "approach brightens the note");
  assert.ok(dopplerHz(base, -0.5) < base, "recession lowers it");
  assert.ok(Math.abs(dopplerHz(base, 0) - base) < 1e-9, "no motion, no shift");
}

// — Housekeeping laws the room leans on —
{
  const { kept, retired } = settlePopulation([1, 2, 3, 4, 5], 3);
  assert.deepEqual(kept, [3, 4, 5], "the cap keeps the newest");
  assert.deepEqual(retired, [1, 2], "and retires the oldest, in order");
  const s1 = starterKinds(11);
  const s2 = starterKinds(11);
  assert.deepEqual(s1, s2, "starters are deterministic in the seed");
  assert.equal(s1[0].id, "photon", "the field opens with light already crossing");
  assert.ok(ledgerOf(s1).charge <= 1 && s1.length === 3, "three starters, at most one charge visible");
}

// — What two excitations do to each other. A particle meeting its own
//   antiparticle must leave TWO photons, never one: a single photon cannot
//   carry off the pair's momentum in the pair's own rest frame. A bug that
//   emitted one photon, or that let a photon "annihilate" another photon
//   (it is self-conjugate — two photons make a brighter photon, not
//   nothing), would pass every other check in this file.
{
  const e = { id: "electron", anti: false };
  const p = { id: "electron", anti: true };
  assert.ok(annihilates(e, p), "a particle and its antiparticle undo each other");
  assert.ok(annihilates(p, e), "and it does not matter which arrived first");
  assert.ok(!annihilates(e, e), "two electrons do not annihilate");
  assert.ok(
    !annihilates({ id: "photon", anti: false }, { id: "photon", anti: false }),
    "the photon is its own antiparticle and does not annihilate itself",
  );
  assert.ok(
    !annihilates({ id: "muon", anti: false }, { id: "electron", anti: true }),
    "different fields do not annihilate, however opposite their charges",
  );
  const out = annihilationProducts(e, p);
  assert.equal(out.length, 2, "annihilation leaves two photons, never one");
  assert.ok(out.every((q) => q.id === "photon"), "and both of them are light");
  const before = ledgerOf([e, p]);
  const after = ledgerOf(out);
  assert.deepEqual(after, before, "every book closes across an annihilation");
  assert.deepEqual(after, { charge: 0, e: 0, mu: 0, tau: 0 }, "and closes at zero");
  assert.deepEqual(annihilationProducts(e, e), [], "a non-pair produces nothing");
  // energy is halved between the two, and never falls under the floor
  assert.ok(
    Math.abs(annihilationPhotonEnergy(4) * 2 - 4) < 1e-9,
    "the two photons split the pair's whole energy",
  );
  assert.ok(annihilationPhotonEnergy(0) >= PHOTON_E_MIN, "even a cold pair rings audibly");
}

// — Interference. In phase reinforces, exactly out of phase cancels to
//   nothing. A bug that used |Δφ| instead of cos, or forgot the half-angle
//   in the superposition, would still look plausible on a screen.
{
  assert.ok(Math.abs(interference(1.3, 1.3) - 1) < 1e-12, "same phase: full reinforcement");
  assert.ok(Math.abs(interference(0, Math.PI) + 1) < 1e-12, "opposite phase: full cancellation");
  assert.ok(Math.abs(interference(0, Math.PI / 2)) < 1e-12, "a quarter turn apart: neither");
  assert.equal(interference(0.4, 2.1), interference(2.1, 0.4), "interference is symmetric");
  assert.ok(Math.abs(superposedAmplitude(2, 2) - 2) < 1e-12, "two in phase make twice the wave");
  assert.ok(superposedAmplitude(0, Math.PI) < 1e-12, "two exactly opposed make none at all");
  let prev = 2;
  for (let d = 0; d <= Math.PI; d += Math.PI / 32) {
    const amp = superposedAmplitude(0, d);
    assert.ok(amp <= prev + 1e-12, "amplitude falls monotonically as the phases part");
    prev = amp;
  }
}

console.log("quanta: ok");
