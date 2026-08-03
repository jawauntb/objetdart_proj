// The /planets laws. The bugs these catch: a latent you could not read
// back off the world it decoded into (which would make the room's central
// claim — the vector IS the world — false), an accretion hold that is a
// tier switch instead of a duration, dust that leaks when worlds are
// forged, grown, or retired, a sculpt that scrambles coordinates it never
// touched, and a tilt convention that lights the winter pole. The
// calibration case (the /organelles precedent) is the midnight sun: at
// the pole in midsummer, insolation must equal sin(tilt) at EVERY hour
// angle — a formula can be smooth, plausible, and exactly backwards.

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

const W = loadTsModule("src/lib/worldforge.ts");

const EPS = 1e-9;
const seeds = [1, 7, 42, 0xbeef, 0xc0ffee, 0x5eed, 991, 2024, 0x1234567, 88];

// —— the latent IS the world: the round trip ————————————————————————
// If latent → world → latent does not return the same point, the decode is
// quantizing or clamping somewhere and the map has become decoration — the
// lens notation would show a vector the world does not actually wear.
{
  const corners = [
    new Array(W.LATENT_DIM).fill(0),
    new Array(W.LATENT_DIM).fill(1),
    new Array(W.LATENT_DIM).fill(0.5),
    Array.from({ length: W.LATENT_DIM }, (_, i) => (i % 2 ? 0.999 : 0.001)),
  ];
  const rng = W.mulberry32(0xf00d);
  const samples = [...corners];
  for (let n = 0; n < 200; n++) {
    samples.push(Array.from({ length: W.LATENT_DIM }, () => rng()));
  }
  for (const l of samples) {
    const w = W.worldFromLatent(l, W.hashSeed(...l.map((v) => Math.round(v * 1e6))));
    const back = W.latentFromWorld(w);
    assert.equal(back.length, W.LATENT_DIM, "the inverse returns the full vector");
    for (let i = 0; i < W.LATENT_DIM; i++) {
      assert.ok(
        Math.abs(back[i] - l[i]) < EPS,
        `dim ${i}: ${l[i]} decoded and read back as ${back[i]} — the map lost structure`,
      );
    }
  }
}

// —— determinism: the same seed is the same world, forever ——————————
// A stray Math.random or hidden time dependence would break re-visits:
// the worlds you kept would come back subtly other than you left them.
for (const s of seeds) {
  assert.equal(
    JSON.stringify(W.worldFromSeed(s)),
    JSON.stringify(W.worldFromSeed(s)),
    `seed ${s} must decode bit-identically every time`,
  );
}
// Different seeds must actually differ — a decoder collapsing every seed
// to one world would pass every other test here.
{
  const a = JSON.stringify(W.worldFromSeed(seeds[0]));
  for (const s of seeds.slice(1)) {
    assert.notEqual(JSON.stringify(W.worldFromSeed(s)), a, `seed ${s} must differ from seed ${seeds[0]}`);
  }
}

// —— validity: every latent in range yields a livable world ————————————
// One NaN in a texture loop paints a black disc; an ocean outside [0,1]
// drowns or desiccates the shader's threshold; moons out of order draw
// through the ring. Swept, not spot-checked.
{
  const rng = W.mulberry32(0xacc7e7e);
  for (let n = 0; n < 500; n++) {
    const seed = Math.floor(rng() * 0xffffffff);
    const w = W.worldFromSeed(seed);
    for (const [k, v] of Object.entries(w)) {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `seed ${seed}: ${k} is not finite`);
    }
    assert.ok(w.radius01 >= W.RADIUS_MIN && w.radius01 <= W.RADIUS_MAX, `seed ${seed}: radius out of range`);
    assert.ok(w.ocean >= 0 && w.ocean <= 1, `seed ${seed}: ocean fraction ${w.ocean} outside [0,1]`);
    assert.ok(w.tiltRad >= 0 && w.tiltRad <= W.TILT_MAX + EPS, `seed ${seed}: tilt out of range`);
    assert.ok(w.dayHours >= W.DAY_MIN && w.dayHours <= W.DAY_MAX, `seed ${seed}: day length out of range`);
    assert.equal(w.moons.length, W.moonCountOf(w.moonField), `seed ${seed}: moon count disagrees with the field`);
    for (let i = 0; i < w.moons.length; i++) {
      const m = w.moons[i];
      assert.ok(m.dist > 1.5, `seed ${seed}: moon ${i} orbits inside the world`);
      if (i > 0) assert.ok(m.dist > w.moons[i - 1].dist, `seed ${seed}: moon orbits out of order`);
      assert.ok(m.size > 0 && m.speed > 0, `seed ${seed}: degenerate moon`);
    }
    const c = W.worldColors(w);
    for (const rgb of Object.values(c)) {
      for (const ch of rgb) {
        assert.ok(Number.isFinite(ch) && ch >= 0 && ch <= 255, `seed ${seed}: palette channel ${ch} out of gamut`);
      }
    }
  }
}

// —— accretion is a duration, not a tier ————————————————————————————
// The law: nothing may fire identically at 900ms and 2400ms. A tier-based
// implementation (small/medium/large buckets) passes a monotone check on
// bucket edges but fails the material-difference and strictness sweeps.
{
  let prev = W.accretionRadius(0);
  assert.ok(Math.abs(prev - W.RADIUS_MIN) < 1e-6, "zero hold starts at the smallest bead");
  for (let ms = 50; ms <= 6000; ms += 50) {
    const r = W.accretionRadius(ms);
    assert.ok(r > prev, `accretion stalled between ${ms - 50} and ${ms}ms — a tier, not a duration`);
    prev = r;
  }
  const span = W.RADIUS_MAX - W.RADIUS_MIN;
  assert.ok(
    W.accretionRadius(2400) - W.accretionRadius(900) > 0.15 * span,
    "900ms and 2400ms must yield materially different worlds",
  );
  assert.ok(W.accretionRadius(1e7) <= W.RADIUS_MAX + EPS, "the curve saturates at the cap");
}

// —— sculpting is monotone and local ————————————————————————————————
// Raising land must never raise the sea; and moving one coordinate must
// leave the other eleven untouched — a sculpt that re-rolls the moons or
// shifts the palette would make every edit a lottery.
{
  for (const s of seeds) {
    let w = W.worldFromSeed(s);
    const before = W.latentFromWorld(w);
    const moonsBefore = JSON.stringify(w.moons);
    let ocean = w.ocean;
    for (let i = 0; i < 40; i++) {
      w = W.raiseLand(w, 0.05);
      assert.ok(w.ocean <= ocean + EPS, `raiseLand raised the ocean on seed ${s}`);
      ocean = w.ocean;
    }
    assert.ok(w.ocean >= 0, "the ocean clamps at dry, never negative");
    assert.ok(w.ocean < EPS, "forty raises must drain any ocean");
    const after = W.latentFromWorld(w);
    for (let i = 0; i < W.LATENT_DIM; i++) {
      if (i === 1) continue;
      assert.ok(Math.abs(after[i] - before[i]) < EPS, `raiseLand moved untouched dim ${i} on seed ${s}`);
    }
    assert.equal(JSON.stringify(w.moons), moonsBefore, `raiseLand re-rolled the moons on seed ${s}`);
  }
  // Away from the clamps, flood undoes raise exactly — sculpting is
  // movement of a point, so the inverse move must return to it.
  const w0 = W.setLatentDim(W.worldFromSeed(7), 1, 0.5);
  const back = W.floodOcean(W.raiseLand(w0, 0.2), 0.2);
  assert.ok(Math.abs(back.ocean - w0.ocean) < EPS, "raise then flood must return the sea level");
  // Tilt clamps at the cap instead of rolling the pole over.
  const tilted = W.tiltAxis(W.worldFromSeed(7), 10);
  assert.ok(tilted.tiltRad <= W.TILT_MAX + EPS, "tilt must clamp at TILT_MAX");
}

// —— conservation: worlds + reserve = DUST_TOTAL, always ————————————
// The bug: forging or growing that mints mass from nothing (reserve
// untouched), or retirement that burns it (mass vanishes with the world).
// Either way the dust field on screen would drift from the truth.
{
  let reserve = W.DUST_TOTAL;
  let worlds = [];
  const total = () => reserve + worlds.reduce((sum, w) => sum + W.massOf(w), 0);
  const rng = W.mulberry32(0xd05e);
  for (let n = 0; n < 12; n++) {
    let forged = W.forgeWorld(reserve, W.hashSeed(n, 77), 300 + rng() * 4000);
    if (!forged) {
      // The dust ran dry — legitimate under conservation, but ONLY when the
      // reserve really is below a mote. Let a world go and its mass must
      // come back whole, enough to forge again.
      assert.ok(reserve < W.MASS_MIN, `forge refused with ${reserve} dust still in reserve`);
      assert.ok(worlds.length > 0, "an empty field with no dust means mass was destroyed");
      const freed = worlds.shift();
      reserve += W.massOf(freed);
      assert.ok(Math.abs(total() - W.DUST_TOTAL) < 1e-6, "letting go must return the mass whole");
      forged = W.forgeWorld(reserve, W.hashSeed(n, 77), 300 + rng() * 4000);
      assert.ok(forged, "returned dust must be enough to forge again");
    }
    reserve = forged.reserve;
    assert.ok(reserve > -EPS, "forging must never overdraw the dust");
    const kept = W.addWorld(worlds, forged.world);
    worlds = kept.worlds;
    for (const r of kept.retired) reserve += W.massOf(r); // dust returns
    assert.ok(Math.abs(total() - W.DUST_TOTAL) < 1e-6, `dust leaked after forging world ${n}: ${total()}`);
  }
  assert.ok(worlds.length <= W.MAX_WORLDS, "the field must cap its population");

  // Growth draws down the reserve by exactly the gained mass.
  const before = total();
  const grown = W.growWorld(worlds[0], reserve, 1200);
  assert.ok(grown.world.radius01 >= worlds[0].radius01, "growth must never shrink a world");
  const afterTotal = grown.reserve + W.massOf(grown.world) + worlds.slice(1).reduce((s, w) => s + W.massOf(w), 0);
  assert.ok(Math.abs(afterTotal - before) < 1e-6, "growth minted or burned dust");

  // A nearly-empty reserve caps the newborn instead of going negative.
  const poor = W.forgeWorld(W.MASS_MIN + 0.004, 123, 10000);
  assert.ok(poor, "a reserve above the mote threshold still forges");
  assert.ok(poor.reserve > -EPS, "a poor forge must not overdraw");
  assert.ok(W.massOf(poor.world) <= W.MASS_MIN + 0.004 + EPS, "the newborn cannot outweigh the dust it came from");
  assert.equal(W.forgeWorld(0.001, 5, 3000), null, "no dust, no world");
}

// —— the population retires oldest-first ————————————————————————————
// Retiring the newest (a push-pop slip) would eat each world the moment
// after the hand made it — the cruelest possible bug in a forge.
{
  let worlds = [];
  const retiredAll = [];
  for (let i = 0; i < 12; i++) {
    const kept = W.addWorld(worlds, { born: i });
    worlds = kept.worlds;
    retiredAll.push(...kept.retired);
  }
  assert.equal(worlds.length, W.MAX_WORLDS, "the cap holds");
  assert.deepEqual(retiredAll.map((w) => w.born), [0, 1, 2], "the oldest leave first, in order");
  assert.equal(worlds[worlds.length - 1].born, 11, "the newborn always survives its own arrival");
}

// —— calibration: the midnight sun (the hand-computable case) ————————
// At the pole in midsummer, cos(zenith) = sin(pole)·sin(subsolarLat) with
// the second term zeroed by cos(pole)=0 — so insolation is sin(tilt)
// exactly, independent of hour angle. A flipped season or tilt sign gives
// a smooth, plausible, dark midsummer pole instead.
{
  const tilt = 0.4;
  const summerPole = Math.sin(tilt);
  for (const hour of [0, 1, 2.5, Math.PI, 5]) {
    assert.ok(
      Math.abs(W.insolation(Math.PI / 2, hour, tilt, 0.25) - summerPole) < 1e-12,
      `midnight sun broken at hour angle ${hour}`,
    );
    assert.ok(
      W.insolation(Math.PI / 2, hour, tilt, 0.75) < 1e-12,
      `the winter pole must stay dark at hour angle ${hour}`,
    );
  }
  // The subsolar point at noon receives exactly 1 — full sun.
  const subLat = Math.asin(Math.sin(tilt) * Math.sin(0.25 * Math.PI * 2));
  assert.ok(Math.abs(W.insolation(subLat, 0, tilt, 0.25) - 1) < 1e-12, "the subsolar point must see full sun");
  // With no tilt the terminator stands at ±90° of hour angle.
  assert.ok(W.insolation(0, Math.PI / 2, 0, 0) < 1e-9, "the untilted terminator must sit at the quarter turn");
  assert.ok(W.insolation(0, 0, 0, 0) > 1 - 1e-9, "the untilted noon equator must see full sun");
}

// —— the world's voice follows its ring ————————————————————————————
// The fifth belongs to ringed worlds only; an airless bead sounding it
// would make every world's chord the same shape and the blind-listening
// discovery impossible.
{
  const ringed = W.setLatentDim(W.worldFromSeed(3), 9, 0.9);
  const bare = W.setLatentDim(W.worldFromSeed(3), 9, 0.1);
  assert.equal(W.worldChord(ringed).length, 3, "a ringed world sounds three notes");
  assert.equal(W.worldChord(bare).length, 2, "a bare world sounds two");
  assert.deepEqual(W.worldChord(ringed), W.worldChord(ringed), "the voice is deterministic");
}

// —— the integrator keeps an orbit an orbit ————————————————————————
// The bug: plain (explicit) Euler, or a sign slip in the kick, which looks
// perfectly fine for two seconds and then spirals every world into the star
// or out of the field. A circular orbit integrated for a full period must
// come back to its own radius.
{
  const star = { x: 0.5, y: 0.5 };
  const r = 0.3;
  const v = W.circularSpeed(W.STAR_MU, r);
  const body = { x: star.x + r, y: star.y, vx: 0, vy: v, mass: 0.1, radius: 0.02 };
  const period = (2 * Math.PI * r) / v;
  const dt = 1 / 240;
  let rMin = Infinity;
  let rMax = 0;
  for (let t = 0; t < period; t += dt) {
    W.stepBodies([body], dt, W.STAR_MU, star);
    const rr = Math.hypot(body.x - star.x, body.y - star.y);
    rMin = Math.min(rMin, rr);
    rMax = Math.max(rMax, rr);
  }
  assert.ok(rMax - rMin < 0.02 * r, `circular orbit breathed ${(rMax - rMin).toFixed(4)} over one period`);
  const back = Math.hypot(body.x - star.x, body.y - star.y);
  assert.ok(Math.abs(back - r) < 0.01 * r, "the orbit did not close on its own radius");
  // And it must have actually gone somewhere — a frozen body would pass
  // every radius assertion above.
  const swept = Math.atan2(body.y - star.y, body.x - star.x);
  assert.ok(Math.abs(swept) < 0.25, `one period should return to the start angle, ended at ${swept}`);
}

// —— mutual gravity conserves momentum exactly ————————————————————————
// The bug: an asymmetric force loop (mass on one side only, or a missing
// equal-and-opposite reaction), which quietly accelerates the whole field
// in one direction — worlds drift off screen and nobody knows why.
{
  const rng = W.mulberry32(0x9ab);
  const bodies = [];
  for (let i = 0; i < 6; i++) {
    bodies.push({
      x: rng(), y: rng(),
      vx: (rng() - 0.5) * 0.1, vy: (rng() - 0.5) * 0.1,
      mass: W.MASS_MIN + rng() * W.MASS_SPAN,
      radius: 0.02,
    });
  }
  const [px0, py0] = W.totalMomentum(bodies);
  for (let n = 0; n < 4000; n++) W.stepBodies(bodies, 1 / 240, 0, { x: 0.5, y: 0.5 });
  const [px1, py1] = W.totalMomentum(bodies);
  assert.ok(Math.abs(px1 - px0) < 1e-9 && Math.abs(py1 - py0) < 1e-9,
    `mutual gravity leaked momentum: ${px0}→${px1}, ${py0}→${py1}`);
}

// —— vis-viva agrees with the circular case ————————————————————————
{
  for (const r of [0.08, 0.2, 0.45]) {
    assert.ok(Math.abs(W.visViva(W.STAR_MU, r, r) - W.circularSpeed(W.STAR_MU, r)) < 1e-12,
      "a circle is the orbit whose semi-major axis is its radius");
  }
  assert.ok(W.circularSpeed(W.STAR_MU, 0.1) > W.circularSpeed(W.STAR_MU, 0.4),
    "inner orbits must run faster — Kepler's third, in one comparison");
}

// —— starlight: temperature and what a world can keep ————————————————
// The bug that matters: a sign flip that makes distant worlds hot, which
// then puts oceans on the outer field and ice at the star.
{
  // Strict across the whole playable span — the interval where a world can
  // actually sit without falling into the star or leaving the field.
  let prev = W.temperature01(0.07);
  for (let r = 0.08; r < 1.7; r += 0.01) {
    const t = W.temperature01(r);
    assert.ok(t < prev, `temperature rose with distance at r=${r}`);
    prev = t;
  }
  assert.ok(W.temperature01(0.07) > 0.85, "hugging the star must be scorching");
  assert.ok(W.temperature01(1.2) < 0.1, "the far field must be frozen");
  // A brighter star heats every orbit — luminosity is the law's other knob.
  assert.ok(W.temperature01(0.3, 4) > W.temperature01(0.3, 1),
    "raising the star's luminosity must warm a fixed orbit");
  // Retention: heavy keeps, hot loses. Strict in both arguments.
  for (const temp of [0, 0.3, 0.7]) {
    let last = -1;
    for (let m = W.MASS_MIN; m <= W.MASS_MAX; m += 0.01) {
      const keep = W.atmosphereRetention(m, temp);
      assert.ok(keep >= last, `retention fell as mass rose at temp ${temp}`);
      last = keep;
    }
  }
  assert.ok(
    W.atmosphereRetention(W.MASS_MAX, 0.1) > W.atmosphereRetention(W.MASS_MAX, 0.9),
    "a hot world must hold less air than a cold one of the same mass",
  );
  assert.equal(W.atmosphereRetention(W.MASS_MIN, 1), 0, "a hot mote keeps nothing");
  // The habitable band really is a band: seas in the middle, not at the ends.
  const mid = W.climateTarget(W.temperature01(0.25), 0.9).ocean;
  const hot = W.climateTarget(W.temperature01(0.05), 0.9).ocean;
  const cold = W.climateTarget(W.temperature01(1.0), 0.9).ocean;
  assert.ok(mid > hot && mid > cold, "the ocean band must sit between boiling and freezing");
  assert.ok(W.climateTarget(W.temperature01(1.0), 0.9).ice > W.climateTarget(W.temperature01(0.25), 0.9).ice,
    "the far world must be the icier one");
}

// —— the climate settle is monotone, bounded, and local ————————————————
// The bug: a settle that overshoots (oscillating seas), or one that moves
// coordinates the orbit has no business touching — moving a world would
// then silently re-roll its terrain family or its ring.
{
  const w0 = W.setLatentDim(W.setLatentDim(W.worldFromSeed(31), 1, 0.1), 11, 0.9);
  const target = { ocean: 0.8, ice: 0.1, atmoDepth: 0.5 };
  const before = W.latentFromWorld(w0);
  let w = w0;
  let lastOcean = w.ocean;
  for (let n = 0; n < 6000; n++) {
    w = W.settleClimate(w, target, 1 / 60);
    assert.ok(w.ocean >= lastOcean - 1e-12, "the settle reversed direction");
    assert.ok(w.ocean <= target.ocean + 1e-12, "the settle overshot its target");
    lastOcean = w.ocean;
  }
  assert.ok(Math.abs(w.ocean - target.ocean) < 1e-3, "the settle must actually arrive");
  const after = W.latentFromWorld(w);
  for (let i = 0; i < W.LATENT_DIM; i++) {
    if (i === 1 || i === 5 || i === 11) continue;
    assert.ok(Math.abs(after[i] - before[i]) < 1e-12, `the climate settle moved untouched dim ${i}`);
  }
  // A zero-length step must change nothing at all.
  assert.deepEqual(W.latentFromWorld(W.settleClimate(w0, target, 0)), before, "a zero step is a no-op");
}

// —— spin: oblateness and tidal braking ————————————————————————————
{
  assert.equal(W.oblateness(0, 0.1), 0, "a still world is a sphere");
  let last = -1;
  for (let s = 0; s < 4; s += 0.05) {
    const f = W.oblateness(s, 0.1);
    assert.ok(f >= last, "oblateness fell as spin rose");
    assert.ok(f <= W.OBLATE_MAX + 1e-12, "oblateness must stay under the cap");
    last = f;
  }
  assert.ok(W.oblateness(2, 0.05) > W.oblateness(2, 0.25),
    "a light world flattens more than a heavy one at the same spin");
  // Braking approaches synchronous from either side and never crosses it.
  for (const [spin, sync] of [[3, 0.4], [0.1, 0.9]]) {
    let s = spin;
    for (let n = 0; n < 20000; n++) {
      const next = W.tidalSpin(s, sync, 0.06, 1 / 60);
      const crossed = (s - sync) * (next - sync) < 0;
      assert.ok(!crossed, `tidal braking overshot synchronous from ${spin}`);
      s = next;
    }
    assert.ok(Math.abs(s - sync) < Math.abs(spin - sync), "close-in worlds must actually spin down");
  }
  // Far worlds keep their day: the sixth-power falloff, made falsifiable.
  const far = W.tidalSpin(3, 0.4, 0.5, 60);
  const near = W.tidalSpin(3, 0.4, 0.06, 60);
  assert.ok(Math.abs(far - 3) < 0.01, "a distant world must keep its day over a minute");
  assert.ok(3 - near > 100 * (3 - far), "the sixth power must make the close world brake far harder");
}

// —— merging conserves mass, with the remainder ejected —————————————
// The bug: a merge that mints mass (child heavier than its parents) or
// burns it (the dust budget quietly shrinking every collision).
{
  const rng = W.mulberry32(0xc0115);
  for (let n = 0; n < 200; n++) {
    const a = W.worldFromSeed(Math.floor(rng() * 0xffffffff));
    const b = W.worldFromSeed(Math.floor(rng() * 0xffffffff));
    const { world, ejecta } = W.mergeWorlds(a, b);
    const before = W.massOf(a) + W.massOf(b);
    assert.ok(Math.abs(W.massOf(world) + ejecta - before) < 1e-9,
      `merge changed the total mass: ${before} → ${W.massOf(world) + ejecta}`);
    assert.ok(ejecta >= 0, "a merge may scatter mass, never borrow it");
    assert.ok(W.massOf(world) >= Math.max(W.massOf(a), W.massOf(b)) - 1e-9,
      "the child must be at least as heavy as its heavier parent");
    // The child wears both parents: every coordinate lies between them.
    const la = W.latentFromWorld(a);
    const lb = W.latentFromWorld(b);
    const lc = W.latentFromWorld(world);
    for (let i = 1; i < W.LATENT_DIM; i++) {
      const lo = Math.min(la[i], lb[i]) - 1e-9;
      const hi = Math.max(la[i], lb[i]) + 1e-9;
      assert.ok(lc[i] >= lo && lc[i] <= hi, `merged dim ${i} landed outside both parents`);
    }
  }
  // Merging is commutative in mass, and the heavier parent's seed survives
  // so its terrain lineage does — swap the arguments and get the same child.
  const a = W.worldFromSeed(11);
  const b = W.worldFromSeed(12);
  assert.equal(JSON.stringify(W.mergeWorlds(a, b)), JSON.stringify(W.mergeWorlds(b, a)),
    "which world you name first must not change what they become");
}

console.log(
  "worldforge ok: latent round-trips, dust conserved, accretion continuous, midnight sun holds, " +
    "orbits close, momentum conserved, climate follows the orbit, merges keep their mass",
);
