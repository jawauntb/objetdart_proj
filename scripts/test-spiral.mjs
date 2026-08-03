// The /galaxy laws. The bugs these catch: a disc that rotates rigidly (no
// differential rotation, so the room's engine is dead), arms that are
// material structures stars stay glued to (the invariant inverted), arms
// that are painted curves rather than an emergent overdensity, a rotation
// curve that falls where the room claims dark matter holds it flat, a
// register map that drifts off the axis's own assignment or reverses under
// the hand, a galaxy that differs between visits, and a population that
// grows without bound.

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

const S = loadTsModule("src/lib/spiral.ts");
const SCALE = loadTsModule("src/lib/scale.ts");

const TAU = Math.PI * 2;
const defaults = () => ({
  patternPhase: 0,
  pitch: S.PITCH_DEFAULT,
  amp: 1,
  bar: 0,
});

// —— calibration: the two cases computable by hand ————————————————
// (The /organelles lesson: a map whose one hand-checkable case is wrong is
// wrong everywhere, just less visibly.)
{
  // Ω at the exact centre is V/Rc — no square roots survive.
  assert.ok(
    Math.abs(S.angularSpeed(0) - S.V_FLAT / S.R_CORE) < 1e-12,
    "Ω(0) = V/Rc exactly — the core is solid-body and finite",
  );
  // A crest is a level set of χ: one e-fold out in R, k/m radians around.
  // If the sign or the wrap of armPhase is wrong, this identity breaks.
  const k = S.waveNumber(S.PITCH_DEFAULT);
  const R = 0.3;
  const chiA = S.armPhase(R, 1.1, 0.4, S.PITCH_DEFAULT);
  const chiB = S.armPhase(R * Math.E, 1.1 + k / S.ARM_M, 0.4, S.PITCH_DEFAULT);
  assert.ok(
    Math.abs(chiA - chiB) < 1e-9,
    "walking one e-fold out and 1/tan(pitch) around stays on the same wave phase",
  );
}

// —— differential rotation is actually differential ————————————————
// A rigid disc (Ω constant) would still *render*; only these numbers know.
{
  const grid = [];
  for (let i = 0; i <= 40; i++) grid.push(0.02 + (i / 40) * 0.98);
  for (let i = 1; i < grid.length; i++) {
    assert.ok(
      S.angularSpeed(grid[i]) < S.angularSpeed(grid[i - 1]),
      `Ω strictly falls with radius (${grid[i - 1]} → ${grid[i]})`,
    );
  }
  // Propagate two real stars and count revolutions: the inner one must
  // genuinely lap the outer, not just claim a bigger Ω.
  const t = 120;
  const inner = S.starState(0.25, 0, t, defaults());
  const outer = S.starState(0.8, 0, t, defaults());
  const revInner = (S.angularSpeed(0.25) * t) / TAU;
  const revOuter = (S.angularSpeed(0.8) * t) / TAU;
  assert.ok(revInner > 2 * revOuter, "the inner disc laps the outer at least twice over");
  // ...and the propagated azimuths actually moved by those amounts.
  assert.ok(
    Math.abs(S.wrapAngle(inner.theta - S.angularSpeed(0.25) * t)) < 0.2,
    "the inner star's azimuth is its own clock plus at most the wave's small excursion",
  );
  assert.ok(
    Math.abs(S.wrapAngle(outer.theta - S.angularSpeed(0.8) * t)) < 0.2,
    "the outer star's azimuth likewise",
  );
}

// —— the rotation curve is flat where the dark matter is claimed ————
// A Keplerian outer disc (v ∝ 1/√R) would fall ~26% from 0.6 to 1.0; the
// halo claim is that it doesn't.
{
  const v06 = S.orbitalSpeed(0.6);
  const v10 = S.orbitalSpeed(1.0);
  assert.ok(
    Math.abs(v10 - v06) / S.V_FLAT < 0.03,
    "v(R) flat to 3% across the outer disc — the halo is doing its work",
  );
  assert.ok(
    S.angularSpeed(0.6) / S.angularSpeed(1.0) > 1.5,
    "…while Ω still falls steeply — flat v is not rigid rotation",
  );
}

// —— the arm is a wave: stars pass through, the crest stands ————————
// This is the room's entire argument. Two failures it catches: (a) stars
// glued to the arm (χ constant for everyone — a material arm), and (b) a
// crest that drifts in the pattern frame (not a standing wave).
{
  const field = S.buildStars(0x9a1a);
  const omegaP = S.OMEGA_P_DEFAULT;
  const pitch = S.PITCH_DEFAULT;
  const params = (t) => ({ patternPhase: omegaP * t, pitch, amp: 1, bar: 0 });

  // (a) one mid-disc star, propagated: its wave phase must wind through
  // full turns — it enters arms and leaves them.
  const R0 = 0.32;
  const drift = S.ARM_M * (S.angularSpeed(R0) - omegaP);
  let unwrapped = 0;
  let prev = S.starState(R0, 1.0, 0, params(0)).chi;
  for (let i = 1; i <= 240; i++) {
    const t = i * 0.5;
    const chi = S.starState(R0, 1.0, t, params(t)).chi;
    let d = chi - prev;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    unwrapped += d;
    prev = chi;
  }
  assert.ok(Math.abs(unwrapped) > TAU, "a mid-disc star crosses clean through more than one arm");
  assert.ok(
    Math.abs(unwrapped - drift * 120) < 0.35,
    "…at the rate m·(Ω − Ωp) the physics names, not some renderer's own speed",
  );

  // ...and a star AT corotation keeps station with the pattern forever.
  const Rc = S.corotationRadius(omegaP);
  const chi0 = S.starState(Rc, 2.0, 0, params(0)).chi;
  const chi1 = S.starState(Rc, 2.0, 200, params(200)).chi;
  assert.ok(Math.abs(S.wrapAngle(chi1 - chi0)) < 0.02, "at corotation the wave phase stands still");

  // (b) bin the REAL displaced positions by measured wave phase, at two
  // times far apart: the crest must be well above the trough (an emergent
  // level set, not a painted curve), and it must sit in the same phase bin
  // both times (a standing wave) even though (a) proved the stars moved.
  const BINS = 24;
  const histogram = (t) => {
    const p = params(t);
    const k = S.waveNumber(pitch);
    const bins = new Array(BINS).fill(0);
    let used = 0;
    for (let i = 0; i < field.count; i++) {
      const R = field.r[i];
      if (R < 0.3 || R > 0.85) continue;
      const st = S.starState(R, field.theta[i], t, p);
      const chiPos = S.wrapAngle(
        S.ARM_M * (st.theta - p.patternPhase) - k * Math.log(st.r / S.R_REF),
      );
      bins[Math.min(BINS - 1, Math.floor(((chiPos + Math.PI) / TAU) * BINS))] += 1;
      used += 1;
    }
    return { bins, used };
  };
  const hA = histogram(6);
  const hB = histogram(66);
  assert.ok(hA.used > 3000, "the annulus holds a real population to measure");
  const crest = (h) => h.bins.indexOf(Math.max(...h.bins));
  const contrast = (h) => Math.max(...h.bins) / Math.max(1, Math.min(...h.bins));
  assert.ok(contrast(hA) > 1.6, "arm crest stands above the inter-arm floor — a real overdensity");
  assert.ok(contrast(hB) > 1.6, "…and still does a minute later");
  const dBin = Math.abs(crest(hA) - crest(hB));
  assert.ok(
    Math.min(dBin, BINS - dBin) <= 1,
    "the crest keeps its place in the pattern frame while the stars that made it moved on",
  );
}

// —— corotation splits the disc the way the physics says ————————————
{
  const omegaP = S.OMEGA_P_DEFAULT;
  const Rc = S.corotationRadius(omegaP);
  assert.ok(Math.abs(S.angularSpeed(Rc) - omegaP) < 1e-9, "Ω(corotation) = Ωp by definition");
  assert.ok(S.angularSpeed(Rc - 0.1) > omegaP, "inside corotation stars overtake the pattern");
  assert.ok(S.angularSpeed(Rc + 0.1) < omegaP, "outside it the pattern overtakes the stars");
  assert.ok(Math.abs(S.armCrossingHz(Rc, omegaP)) < 1e-9, "no arm is ever crossed at corotation");
  assert.ok(
    S.armCrossingHz(0.25, omegaP) > S.armCrossingHz(0.5, omegaP),
    "the crossing beat quickens toward the centre — the mismatch, heard",
  );
}

// —— the register is the axis's, and the law is audible ————————————
{
  const reg = SCALE.spectralRegisterFor(S.GALAXY_SCALE_S);
  assert.ok(
    Math.abs(reg.baseHz - S.GALAXY_BASE_HZ) < 1e-9,
    "the band fundamental agrees with spectralRegisterFor at the band centre, to the digit",
  );
  assert.ok(
    Math.abs(reg.lfoHz - S.GALAXY_LFO_HZ) < 1e-12,
    "…and so does the breath",
  );
  assert.ok(
    Math.abs(S.patternHzFor(S.OMEGA_P_DEFAULT, S.PITCH_DEFAULT) - S.GALAXY_BASE_HZ) < 1e-9,
    "an untouched room sounds exactly where the axis says it lives",
  );
  // Monotone in the hand's two axes — a reversed map would make the law lie.
  let prevW = 0;
  for (let i = 0; i <= 24; i++) {
    const w = S.OMEGA_P_MIN + ((S.OMEGA_P_MAX - S.OMEGA_P_MIN) * i) / 24;
    const hz = S.patternHzFor(w, S.PITCH_DEFAULT);
    if (i > 0) assert.ok(hz > prevW, "faster pattern, higher register — strictly");
    prevW = hz;
  }
  let prevP = 0;
  for (let i = 0; i <= 24; i++) {
    const p = S.PITCH_MIN + ((S.PITCH_MAX - S.PITCH_MIN) * i) / 24;
    const hz = S.patternHzFor(S.OMEGA_P_DEFAULT, p);
    if (i > 0) assert.ok(hz > prevP, "opener spiral, brighter voice — strictly");
    prevP = hz;
  }
  // Bounded even against absurd inputs — the hand cannot push the register
  // off the instrument.
  const lo = S.GALAXY_BASE_HZ * Math.pow(2, -(S.PATTERN_SPAN_OCT + S.PITCH_SPAN_OCT));
  const hi = S.GALAXY_BASE_HZ * Math.pow(2, S.PATTERN_SPAN_OCT + S.PITCH_SPAN_OCT);
  for (const [w, p] of [[1e-9, -5], [1e9, 5], [S.OMEGA_P_MAX * 10, S.PITCH_MAX * 3]]) {
    const hz = S.patternHzFor(w, p);
    assert.ok(hz >= lo - 1e-9 && hz <= hi + 1e-9, `register bounded for (${w}, ${p})`);
  }
  // The tapped disc: inner higher, strictly — the rotation curve as melody.
  let prevOrbit = Infinity;
  for (let i = 0; i <= 20; i++) {
    const R = 0.08 + (i / 20) * 0.9;
    const hz = S.orbitHzFor(R, S.OMEGA_P_DEFAULT, S.PITCH_DEFAULT);
    assert.ok(hz < prevOrbit, "a tap further out rings lower, always");
    prevOrbit = hz;
  }
}

// —— determinism and the cap ————————————————————————————————————
{
  const a = S.buildStars(0xbeef);
  const b = S.buildStars(0xbeef);
  assert.deepEqual([...a.r], [...b.r], "one seed, one galaxy — radii identical");
  assert.deepEqual([...a.theta], [...b.theta], "…azimuths identical");
  assert.deepEqual([...a.pop], [...b.pop], "…populations identical");
  const c = S.buildStars(0xbee0);
  assert.notDeepEqual([...a.r].slice(0, 64), [...c.r].slice(0, 64), "a different seed is a different galaxy");
  assert.ok(S.buildStars(0x1, 10 ** 9).count <= S.STAR_CAP, "the population cap holds against any ask");
  // Radii live in the disc; the sampler's tail rescue must not pile stars
  // at one radius (a visible ring would be a bug a renderer can't hide).
  let edge = 0;
  for (let i = 0; i < a.count; i++) {
    assert.ok(a.r[i] >= 0 && a.r[i] <= S.R_MAX * 1.081, "every star inside the disc");
    if (a.r[i] > S.R_MAX) edge += 1;
  }
  assert.ok(edge / a.count < 0.05, "no artificial rim of clamped stars");
}

// —— what the hand plants obeys the same disc ——————————————————————
// The bugs: a seeded region pinned to the screen instead of caught in the
// shear (so the winding problem never bites), a shell that expands linearly
// or forever (no Sedov deceleration, no fading), and star formation that
// "propagates" to regions the shell never actually reached.
{
  // The winding problem: a planted patch is torn apart, faster further in.
  const spanIn = S.shearedSpan(0.25, S.REGION_HALF_WIDTH, 200);
  const spanOut = S.shearedSpan(0.8, S.REGION_HALF_WIDTH, 200);
  assert.ok(spanIn > spanOut, "the shear tears an inner patch faster than an outer one");
  assert.ok(spanIn > 0.5, "…and after 200s an inner patch is a visible arc, not a dot");
  assert.ok(
    Math.abs(S.shearedSpan(0.5, S.REGION_HALF_WIDTH, 400) - 2 * S.shearedSpan(0.5, S.REGION_HALF_WIDTH, 200)) < 1e-9,
    "shear grows linearly in time — an arm made of matter would wind up without bound",
  );

  // A region rides its own orbit, exactly as its stars do — not the pattern's.
  const reg = { R0: 0.4, theta0: 0.3, born: 0, strength: 1, ignited: -1 };
  const p = S.regionAt(reg, 50);
  assert.ok(
    Math.abs(S.wrapAngle(p.theta - (0.3 + S.angularSpeed(0.4) * 50))) < 1e-12,
    "a seeded region is carried by Ω(R0), the same clock the stars read",
  );
  assert.ok(Math.abs(Math.hypot(p.x, p.y) - 0.4) < 1e-12, "…on a circle, at its guiding radius");

  // Sedov–Taylor: always growing, always decelerating, and finally spent.
  let prevR = -1;
  let prevV = Infinity;
  for (let i = 1; i <= 40; i++) {
    const age = i * 0.5;
    const r = S.shellRadius(age);
    assert.ok(r > prevR || r === S.SHELL_MAX, "the shell never contracts");
    prevR = r;
    const v = S.shellSpeed(age);
    if (v > 0) {
      assert.ok(v < prevV, "…and never speeds up: the blast decelerates from birth");
      prevV = v;
    }
  }
  assert.ok(S.shellRadius(1e6) === S.SHELL_MAX, "a remnant fades into the medium, it does not eat the disc");
  assert.ok(S.shellSpeed(1e6) === 0, "…and a spent shell has stopped");

  // Propagation reaches what the shell reaches, and nothing else.
  const t0 = 10;
  const near = { R0: 0.4, theta0: 0.3 + 0.2 / 0.4, born: 0, strength: 0.5, ignited: -1 };
  const far = { R0: 0.4, theta0: 0.3 + 1.6 / 0.4, born: 0, strength: 0.5, ignited: -1 };
  const src = { R0: 0.4, theta0: 0.3, born: 0, strength: 1, ignited: t0 };
  // co-rotating at one radius, separations are frozen: pure geometry
  const dNear = S.regionSeparation(src, near, t0 + 5);
  const dFar = S.regionSeparation(src, far, t0 + 5);
  assert.ok(dNear < S.SHELL_MAX && dFar > S.SHELL_MAX, "the two neighbours straddle the shell's reach");

  let list = [src, near, far];
  let anyLitFar = false;
  let litNearAt = -1;
  for (let i = 0; i <= 400; i++) {
    const t = t0 + i * 0.25;
    const step = S.propagate(list, t);
    list = step.regions;
    for (const idx of step.lit) {
      if (idx === 1 && litNearAt < 0) litNearAt = t;
      if (idx === 2) anyLitFar = true;
    }
  }
  assert.ok(litNearAt > t0, "the near patch lights — star formation propagates along the shell");
  assert.ok(
    Math.abs(S.shellRadius(litNearAt - t0) - dNear) < 0.02,
    "…and it lights exactly when the shell arrives, not on a timer",
  );
  assert.ok(!anyLitFar, "the far patch is never lit: nothing propagates past the shell's reach");
  assert.equal(list[0].ignited, t0, "the source keeps its own ignition time");

  // Determinism: the same chain, run twice, lights the same way.
  const run = () => {
    let l = [
      { R0: 0.4, theta0: 0.3, born: 0, strength: 1, ignited: t0 },
      { R0: 0.4, theta0: 0.3 + 0.2 / 0.4, born: 0, strength: 0.5, ignited: -1 },
      { R0: 0.42, theta0: 0.3 + 0.38 / 0.4, born: 0, strength: 0.5, ignited: -1 },
    ];
    const order = [];
    for (let i = 0; i <= 600; i++) {
      const t = t0 + i * 0.2;
      const step = S.propagate(l, t);
      l = step.regions;
      for (const idx of step.lit) order.push([idx, Math.round(t * 100)]);
    }
    return order;
  };
  const r1 = run();
  const r2 = run();
  assert.deepEqual(r1, r2, "the same chain lights identically every run");
  assert.ok(r1.length >= 2, "a shell that lights a neighbour lights ITS neighbour in turn — a chain");
  assert.ok(r1[0][1] < r1[1][1], "…and the chain is ordered in time, nearest first");

  // Life: gas burns slowly, a supernova is the shorter brighter death.
  const gas = { R0: 0.5, theta0: 0, born: 0, strength: 1, ignited: -1 };
  const blown = { R0: 0.5, theta0: 0, born: 0, strength: 1, ignited: 0 };
  assert.ok(S.regionLife(gas, S.REGION_LIFE * 0.5) > S.regionLife(blown, S.REGION_LIFE * 0.5),
    "an ignited region fades faster than one left to burn");
  assert.equal(S.regionLife(gas, S.REGION_LIFE * 2), 0, "gas is spent when its life runs out");
  assert.equal(S.regionLife(blown, S.REGION_LIFE * 2), 0, "…and so is a remnant");
}

console.log("spiral ok: the arms are a wave the stars stream through");
