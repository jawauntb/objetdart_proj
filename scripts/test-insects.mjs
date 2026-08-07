// The swarm (/insects) — the laws that can lie, pinned.
// Falsifiable only: determinism from the seed, the three boid rules with the
// sign each must have, phototaxis that only an imago feels, the metamorphosis
// clock egg→larva→imago (monotone, and advanced by a dwell), a predator that
// pursues and catches prey while the prey flee, mating that makes a third body
// neither parent, speed and walls bounded through the integrator, cap
// retirement oldest-first, and a persistence round-trip that stays empty.

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
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const I = loadTsModule("src/lib/insects.ts");

const input = () => ({
  windX: 0, windY: 0, gravX: 0, gravY: 0, agitation: 0,
  lightX: 0.5, lightY: 0.5, lightStrength: 0,
  scentX: 0.5, scentY: 0.5, scentStrength: 0,
  epoch: 0.5, timeScale: 1, reduced: false,
});

// ——— determinism: the seed is the whole state ———————————————————————————
// Catches: any Math.random or wall-clock leak into birth.
{
  const a = I.bornInsect(1, 0xbee, 0.4, 0.6, 1000, I.IMAGO, I.IMAGO_MS);
  const b = I.bornInsect(1, 0xbee, 0.4, 0.6, 1000, I.IMAGO, I.IMAGO_MS);
  assert.deepEqual(a, b, "the same seed must bear the same body, always");
  const c = I.bornInsect(1, 0xbee + 1, 0.4, 0.6, 1000, I.IMAGO, I.IMAGO_MS);
  assert.ok(c.vx !== a.vx || c.vy !== a.vy, "a different seed must fly differently");
  assert.equal(I.hashSeed(1, 2, 3), I.hashSeed(1, 2, 3), "hashSeed is a function");
  assert.notEqual(I.hashSeed(1, 2, 3), I.hashSeed(3, 2, 1), "hashSeed hears order");
}

// ——— stageOf is monotone and the thresholds are where they claim ——————————
{
  assert.equal(I.stageOf(0), I.EGG, "a fresh clutch is eggs");
  assert.equal(I.stageOf(I.EGG_MS - 1), I.EGG, "just before hatching it is still an egg");
  assert.equal(I.stageOf(I.EGG_MS), I.LARVA, "at EGG_MS it hatches to a larva");
  assert.equal(I.stageOf(I.IMAGO_MS - 1), I.LARVA, "just before it pupates it is a larva");
  assert.equal(I.stageOf(I.IMAGO_MS), I.IMAGO, "at IMAGO_MS it takes the wing");
  let prev = -1;
  for (let m = 0; m <= I.IMAGO_MS + 2000; m += 250) {
    const st = I.stageOf(m);
    assert.ok(st >= prev, "the stage never runs backward as maturity accrues");
    prev = st;
  }
}

// ——— metamorphosis at rest: the clock turns and the clutch grows ——————————
// Catches: eggs that never hatch (a dead room), or a growth that ignores dt.
{
  const egg = I.bornInsect(1, 7, 0.5, 0.5, 0, I.MOTE, 0);
  assert.equal(egg.stage, I.EGG, "born an egg");
  // step long enough (season activity is 1 at dusk) to cross both thresholds
  let t = 0;
  for (let k = 0; k < 400; k++) {
    I.stepSwarm([egg], input(), t, 0.05);
    t += 50;
  }
  assert.equal(egg.stage, I.IMAGO, "left alone through its whole clock, an egg becomes an imago");
  // and it never overshot backward
  const larva = I.bornInsect(2, 8, 0.5, 0.5, 0, I.MOTE, I.EGG_MS);
  assert.equal(larva.stage, I.LARVA, "seeded at EGG_MS it is a larva");
}

// ——— a dwell advances the brood one whole stage at a time ————————————————
{
  const s = I.bornInsect(1, 9, 0.5, 0.5, 0, I.MOTE, 0);
  assert.equal(s.stage, I.EGG, "an egg");
  I.broodAdvance(s);
  assert.equal(s.stage, I.LARVA, "one dwell rung: egg → larva");
  I.broodAdvance(s);
  assert.equal(s.stage, I.IMAGO, "another rung: larva → imago");
  const spd = Math.hypot(s.vx, s.vy);
  assert.ok(spd > 0.03, "an imago the dwell finished is already on the wing");
  I.broodAdvance(s);
  assert.equal(s.stage, I.IMAGO, "an imago has nowhere further to metamorphose");
}

// ——— boids: each of the three rules has the sign it must ——————————————————
// Catches: cohesion that repels, separation that attracts, alignment ignored.
{
  const mk = (x, y, vx, vy) => {
    const s = I.bornInsect(1, 1, x, y, 0, I.MOTE, I.IMAGO_MS);
    s.vx = vx; s.vy = vy;
    return s;
  };
  // cohesion: a lone body sees a cluster to its right → pulled right
  {
    const self = mk(0.4, 0.5, 0, 0);
    const neigh = [mk(0.48, 0.5, 0, 0), mk(0.49, 0.51, 0, 0), mk(0.48, 0.49, 0, 0)];
    const f = I.flockForce(self, neigh);
    assert.ok(f.ax > 0, "cohesion pulls a body toward the flock's centre");
  }
  // alignment: neighbours ringed symmetrically (so cohesion cancels) and set
  // beyond separation reach, all streaming +x → the body is handed +x
  {
    const self = mk(0.5, 0.5, 0, 0);
    const neigh = [mk(0.58, 0.5, 1, 0), mk(0.42, 0.5, 1, 0), mk(0.5, 0.58, 1, 0), mk(0.5, 0.42, 1, 0)];
    const f = I.flockForce(self, neigh);
    assert.ok(f.ax > 0, "alignment steers toward the neighbours' heading when cohesion is balanced");
  }
  // separation dominates at point-blank range: a body sitting almost on top of
  // another is pushed away, cohesion notwithstanding
  {
    const self = mk(0.5, 0.5, 0, 0);
    const neigh = [mk(0.505, 0.5, 0, 0)];
    const f = I.flockForce(self, neigh);
    assert.ok(f.ax < 0, "at point-blank range separation wins and pushes the body off");
  }
  // an egg is not on the wing — no rule moves it
  {
    const egg = I.bornInsect(1, 1, 0.5, 0.5, 0, I.MOTE, 0);
    const neigh = [mk(0.52, 0.5, 1, 0)];
    const f = I.flockForce(egg, neigh);
    assert.equal(f.ax, 0, "an egg does not flock");
    assert.equal(f.ay, 0, "an egg does not flock");
  }
}

// ——— phototaxis: only an imago feels the lantern, and it feels it toward ———
{
  const imago = I.bornInsect(1, 1, 0.3, 0.5, 0, I.MOTE, I.IMAGO_MS);
  const weak = I.phototaxisForce(imago, 0.7, 0.5, 0.4);
  const strong = I.phototaxisForce(imago, 0.7, 0.5, 1.0);
  assert.ok(weak.ax > 0, "an imago left of the lantern accelerates toward it");
  assert.ok(strong.ax > weak.ax, "a brighter lantern pulls harder");
  const egg = I.bornInsect(2, 1, 0.3, 0.5, 0, I.MOTE, 0);
  const none = I.phototaxisForce(egg, 0.7, 0.5, 1.0);
  assert.equal(none.ax, 0, "the light does not move an egg");
  assert.equal(I.phototaxisForce(imago, 0.7, 0.5, 0).ax, 0, "an unlit lantern draws nobody");
}

// ——— the trophic web: predator pursues, prey flees, a catch removes prey ———
{
  const predator = I.bornInsect(1, 1, 0.3, 0.5, 0, I.PREDATOR, I.IMAGO_MS);
  predator.vx = 0; predator.vy = 0;
  const prey = I.bornInsect(2, 2, 0.5, 0.5, 0, I.MOTE, I.IMAGO_MS);
  prey.vx = 0; prey.vy = 0;
  const swarm = [predator, prey];
  const before = predator.nx;
  I.stepSwarm(swarm, input(), 100, 0.05);
  assert.ok(predator.nx > before, "a predator moves toward the prey it can see");
  assert.equal(I.nearestPrey(predator, swarm), 1, "the mote is the nearest prey a predator can see");
  assert.equal(I.nearestPrey(predator, [predator]), -1, "a predator alone finds nothing to hunt");
  // a catch: put the predator on top of the prey
  predator.nx = prey.nx; predator.ny = prey.ny;
  const caught = I.huntCatches(swarm);
  assert.deepEqual(caught, [1], "prey under a predator is caught");
  // a predator does not eat another predator, nor an egg
  const egg = I.bornInsect(3, 3, predator.nx, predator.ny, 0, I.MOTE, 0);
  assert.ok(!I.huntCatches([predator, egg]).length, "an egg on the ground is not caught on the wing");
}

// ——— prey genuinely flee: a mote beside a predator gains velocity away ———
{
  const predator = I.bornInsect(1, 1, 0.5, 0.5, 0, I.PREDATOR, I.IMAGO_MS);
  predator.vx = 0; predator.vy = 0;
  const prey = I.bornInsect(2, 2, 0.56, 0.5, 0, I.MOTE, I.IMAGO_MS);
  prey.vx = 0; prey.vy = 0;
  I.stepSwarm([predator, prey], input(), 100, 0.05);
  assert.ok(prey.vx > 0, "a mote to the predator's right flees further right");
}

// ——— mating makes a third body that is neither parent ————————————————————
{
  const a = I.bornInsect(1, 11, 0.5, 0.5, 0, I.MOTE, I.IMAGO_MS);
  const b = I.bornInsect(2, 22, 0.52, 0.5, 0, I.MOTE, I.IMAGO_MS);
  const pair = I.mateEncounter([a, b], 1e6);
  assert.deepEqual(pair, [0, 1], "two mature motes that meet are an eligible pair");
  const child = I.layEgg(a, b, 9, 1e6);
  assert.equal(child.stage, I.EGG, "what they lay is an egg, not a grown body");
  assert.notEqual(child.seed, a.seed, "the child is neither parent");
  assert.notEqual(child.seed, b.seed, "the child is neither parent");
  assert.ok(child.nx > a.nx && child.nx < b.nx, "the egg is laid between them");
  // the cooldown holds: they cannot breed again at once
  assert.equal(I.mateEncounter([a, b], 1e6), null, "a just-bred pair does not breed again immediately");
  assert.notEqual(I.mateEncounter([a, b], 1e6 + I.BREED_COOLDOWN_MS + 1), null, "past the cooldown they may again");
  // an egg or a larva is not a parent
  const egg = I.bornInsect(3, 33, 0.5, 0.5, 0, I.MOTE, 0);
  assert.equal(I.mateEncounter([a, egg], 0), null, "an egg does not mate");
}

// ——— stepping: dilation slows, agitation stirs, walls hold ————————————————
{
  const a = I.bornInsect(1, 3, 0.5, 0.5, 0, I.MOTE, I.IMAGO_MS);
  a.vx = 0.3; a.vy = 0;
  const b = I.bornInsect(1, 3, 0.5, 0.5, 0, I.MOTE, I.IMAGO_MS);
  b.vx = 0.3; b.vy = 0;
  I.stepSwarm([a], input(), 1000, 0.05);
  I.stepSwarm([b], { ...input(), timeScale: 0.2 }, 1000, 0.05);
  assert.ok(Math.abs(b.nx - 0.5) < Math.abs(a.nx - 0.5), "a three-finger hold slows the swarm");

  // the wall holds even under a launched velocity, and speed stays capped
  const runaway = I.bornInsect(2, 4, 0.95, 0.5, 0, I.MOTE, I.IMAGO_MS);
  runaway.vx = 40;
  for (let k = 0; k < 20; k++) I.stepSwarm([runaway], input(), 1000 + k, 0.05);
  assert.ok(runaway.nx <= 0.97 && runaway.nx >= 0.03, "the meadow's edge holds the swarm in");
  assert.ok(Math.hypot(runaway.vx, runaway.vy) <= I.MAX_SPEED + 1e-6, "no body ever exceeds MAX_SPEED");

  // a whole agitated flock stays inside its frame and inside its speed cap
  const flock = [];
  for (let i = 0; i < 30; i++) {
    const rng = I.mulberry32(I.hashSeed(i, 5));
    flock.push(I.bornInsect(i + 1, I.hashSeed(i, 9), 0.1 + rng() * 0.8, 0.1 + rng() * 0.8, 0, I.MOTE, I.IMAGO_MS));
  }
  const stirred = { ...input(), agitation: 1 };
  for (let k = 0; k < 60; k++) I.stepSwarm(flock, stirred, k * 16, 0.016);
  for (const s of flock) {
    assert.ok(s.nx >= 0.03 && s.nx <= 0.97 && s.ny >= 0.03 && s.ny <= 0.97, "an agitated flock stays in the meadow");
    assert.ok(Math.hypot(s.vx, s.vy) <= I.MAX_SPEED + 1e-6, "agitation never launches a body past the cap");
  }
}

// ——— a retiring body fades on a breath, never blinks ——————————————————————
{
  const s = I.bornInsect(1, 5, 0.5, 0.5, 0, I.MOTE, I.IMAGO_MS);
  s.presence = 0.999;
  I.stepSwarm([s], input(), 1000, 0.1);
  assert.ok(s.presence > 0 && s.presence < 0.999, "fading is an exhale, not a blink");
}

// ——— the cap retires the oldest first ————————————————————————————————————
{
  const swarm = [
    I.bornInsect(1, 1, 0.2, 0.2, 300, I.MOTE, I.IMAGO_MS),
    I.bornInsect(2, 2, 0.4, 0.4, 100, I.MOTE, I.IMAGO_MS),
    I.bornInsect(3, 3, 0.6, 0.6, 200, I.MOTE, I.IMAGO_MS),
  ];
  const idx = I.retireOldest(swarm);
  assert.equal(swarm[idx].id, 2, "the oldest body gives way first");
  assert.equal(I.retireOldest(swarm) === idx, false, "an already-retiring body is not retired twice");
}

// ——— a clutch is n eggs, seeded and near the point ————————————————————————
{
  const eggs = I.layClutch(0.5, 0.5, 0xc10, 0, 6, 100, I.MOTE);
  assert.equal(eggs.length, 6, "a clutch is the count asked for");
  for (const e of eggs) {
    assert.equal(e.stage, I.EGG, "every one of them is an egg");
    assert.ok(Math.hypot(e.nx - 0.5, e.ny - 0.5) < 0.06, "laid within reach of the touch");
  }
  const again = I.layClutch(0.5, 0.5, 0xc10, 0, 6, 100, I.MOTE);
  assert.deepEqual(again.map((e) => e.seed), eggs.map((e) => e.seed), "the same clutch every time — seeded, not rolled");
}

// ——— persistence round-trips, and an emptied meadow stays empty ———————————
{
  const swarm = [
    I.bornInsect(1, 10, 0.25, 0.75, 0, I.POLLINATOR, I.IMAGO_MS),
    I.bornInsect(2, 20, 0.5, 0.5, 0, I.MOTE, I.EGG_MS),
  ];
  const kept = I.serializeSwarm(swarm);
  const back = I.loadSwarm(kept, 5000);
  assert.equal(back.length, 2, "what stood is what returns");
  assert.equal(back[0].role, I.POLLINATOR, "a body returns in the role it was left in");
  assert.equal(back[1].stage, I.LARVA, "and at the stage it was left in");
  assert.ok(Math.abs(back[0].nx - 0.25) < 0.002, "and where it was left");
  // a retiring body is not kept — it was already leaving
  swarm[0].presence = 0.5;
  assert.equal(I.serializeSwarm(swarm).bodies.length, 1, "a fading body is never kept");
  assert.deepEqual(I.loadSwarm({ v: 1, bodies: [] }, 0), [], "an emptied meadow stays empty");
  assert.deepEqual(I.loadSwarm("garbage", 0), [], "a corrupt keep is a fresh meadow, not a crash");
}

console.log("insects: ok");
