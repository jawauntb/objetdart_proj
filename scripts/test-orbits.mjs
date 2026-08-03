// The /solar laws. The bugs these catch: an elapsed-time integrator whose
// answer depends on how many steps it took (the catch-up-loop drift that
// would make a week away land the planets somewhere a week doesn't put
// them), a Kepler solver that stalls near-parabolic, a propagator whose
// period disagrees with its own orbit, an anomaly pipeline that quietly
// feeds the mean anomaly where the true one belongs, a velocity map that
// leaks energy, a pitch map you could not read the orbit back out of, a
// conjunction that freezes time instead of re-timing it, and a sun-mass
// knob that teleports the planets it should only re-tempo.

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

const O = loadTsModule("src/lib/orbits.ts");

const TAU = O.TAU;
const MU = O.MU_UNIT;
const system = O.systemFromSeed(0x50a17);

// Angular distance on the circle — errors near the wrap must not read huge.
const angDist = (a, b) => {
  const d = Math.abs(O.wrapAngle(a) - O.wrapAngle(b));
  return Math.min(d, TAU - d);
};

// —— the same span, however many steps ————————————————————————————
// THE bug this room exists to not have: a loop that replays history frame
// by frame drifts with the frame count. The closed form must give the same
// state for one jump of a week and for a thousand ragged steps of it.
{
  const week = 7 * 24 * 3600;
  for (const el of system) {
    const n = O.meanMotionOf(el.a, MU);
    const oneJump = O.wrapAngle(el.phase + n * week);
    // a frame loop's ragged partition: 977 uneven steps, wrapped every step
    let m = el.phase;
    let left = week;
    const steps = 977;
    for (let i = 0; i < steps; i++) {
      const dt = i === steps - 1 ? left : (week / steps) * (0.31 + ((i * 7919) % 100) / 72);
      const used = Math.min(dt, left);
      m = O.wrapAngle(m + n * used);
      left -= used;
    }
    // spend whatever raggedness left over
    m = O.wrapAngle(m + n * left);
    assert.ok(
      angDist(m, oneJump) < 1e-6,
      `a week in 977 steps must equal a week in one (drift ${angDist(m, oneJump)})`,
    );
    // ...and the absence composition helper is the same associativity in ms
    const a1 = O.elapsedSim(O.elapsedSim(100, 3_600_000, 1.5), 604_800_000, 1.5);
    const a2 = O.elapsedSim(100, 3_600_000 + 604_800_000, 1.5);
    assert.ok(Math.abs(a1 - a2) < 1e-6, "absences compose: two visits equal their sum");
  }
}

// —— Kepler's equation is actually solved, at every eccentricity ————————
// The bug: Newton diverging near-parabolic (1 − e·cosE → 0 at periapsis),
// which would freeze or fling a ceremony-planted comet.
{
  for (const e of [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.985, 0.999]) {
    let prevE = -1;
    for (let k = 0; k < 60; k++) {
      const M = (k / 60) * TAU;
      const E = O.solveKepler(M, e);
      const residual = Math.abs(E - e * Math.sin(E) - M);
      assert.ok(
        residual <= O.KEPLER_TOL * 4,
        `Kepler residual ${residual} at e=${e} M=${M} — the solver gave up`,
      );
      assert.ok(E >= prevE - 1e-9, `E must climb with M (e=${e}) — wrong branch otherwise`);
      prevE = E;
    }
  }
  // the anomaly ladder climbs both ways
  for (const e of [0.1, 0.5, 0.9]) {
    for (let k = 1; k < 12; k++) {
      const nu = (k / 12) * TAU;
      const back = O.trueAnomalyOf(O.eccentricAnomalyOf(nu, e), e);
      assert.ok(angDist(back, nu) < 1e-9, `ν → E → ν round trip (e=${e})`);
    }
  }
}

// —— the orbit closes ————————————————————————————————————————————
// The bug: a period formula disagreeing with the propagator, so "one full
// orbit" would not return a body to its place.
for (const el of system) {
  const T = O.periodOf(el.a, MU);
  const t0 = 12345.678;
  const p0 = O.positionAt(el, MU, t0);
  const p1 = O.positionAt(el, MU, t0 + T);
  const err = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  assert.ok(err < 1e-8 * el.a, `one period must close the orbit (gap ${err})`);
  // and half a period later it is NOT home — the closure is earned, not frozen
  const ph = O.positionAt(el, MU, t0 + T / 2);
  assert.ok(Math.hypot(ph.x - p0.x, ph.y - p0.y) > 0.05 * el.a, "half a period is elsewhere");
}

// —— the one case computable by hand ————————————————————————————————
// The organelles lesson: compare against what a pencil gets. At M = 0 and
// M = π the transcendental equation collapses (sin 0 = sin π = 0), so
// periapsis r = a(1−e) and apoapsis r = a(1+e) exactly. A pipeline that
// slips the mean anomaly in for the true one still renders smooth orbits —
// but it puts apoapsis at the wrong r, and this catches it.
{
  const el = { a: 2, e: 0.5, incl: 0, omega: 0, phase: 0, seed: 1, kind: "planet", size: 1, mass: 0.001 };
  const T = O.periodOf(2, MU);
  const peri = O.positionAt(el, MU, 0);
  assert.ok(Math.abs(peri.r - 2 * 0.5) < 1e-9, `periapsis is a(1−e)=1, got ${peri.r}`);
  assert.ok(angDist(peri.angle, 0) < 1e-9, "periapsis stands at ω");
  const apo = O.positionAt(el, MU, T / 2);
  assert.ok(Math.abs(apo.r - 2 * 1.5) < 1e-9, `apoapsis is a(1+e)=3, got ${apo.r}`);
  assert.ok(angDist(apo.angle, Math.PI) < 1e-9, "apoapsis stands opposite ω");
  // a circle by hand: r = a always, and a quarter period is a quarter turn
  const circ = { ...el, e: 0 };
  for (const t of [0, T / 7, T / 3, T * 0.83]) {
    assert.ok(Math.abs(O.positionAt(circ, MU, t).r - 2) < 1e-9, "a circle keeps its radius");
  }
  assert.ok(
    angDist(O.positionAt(circ, MU, T / 4).angle, Math.PI / 2) < 1e-9,
    "a quarter period of a circle is a quarter turn",
  );
}

// —— the propagator conserves what Kepler conserves ————————————————————
// The bug: a velocity map inconsistent with the position map — energy or
// angular momentum sloshing around the orbit instead of standing still.
for (const el of system) {
  const T = O.periodOf(el.a, MU);
  const expectedEnergy = -MU / (2 * el.a);
  const expectedH = Math.sqrt(MU * el.a * (1 - el.e * el.e));
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * T + 7.7;
    const energy = O.specificEnergyAt(el, MU, t);
    const h = O.angularMomentumAt(el, MU, t);
    assert.ok(
      Math.abs(energy - expectedEnergy) < 1e-9 * Math.abs(expectedEnergy),
      `energy must hold at −μ/2a all the way round (t=${t})`,
    );
    assert.ok(
      Math.abs(h - expectedH) < 1e-9 * expectedH,
      `angular momentum must hold at √(μa(1−e²)) all the way round (t=${t})`,
    );
  }
}

// —— the chord IS the third law ————————————————————————————————————
// The bug: an audio map drifting from the dynamics, so the intervals you
// hear would no longer be the period ratios. The read-back goes through the
// propagator, not the formula: waiting one audio-derived period must close
// the orbit, and every pairwise interval must be (a_j/a_i)^{3/2}.
{
  for (const el of system) {
    const f = O.freqForElements(el.a, MU);
    const T = O.periodForFreq(f);
    const p0 = O.positionAt(el, MU, 99.5);
    const p1 = O.positionAt(el, MU, 99.5 + T);
    assert.ok(
      Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-8 * el.a,
      "waiting one sounded period closes the orbit — the pitch tells the truth",
    );
  }
  for (let i = 0; i < system.length; i++) {
    for (let j = i + 1; j < system.length; j++) {
      const ratio = O.freqForElements(system[i].a, MU) / O.freqForElements(system[j].a, MU);
      const kepler = Math.pow(system[j].a / system[i].a, 1.5);
      assert.ok(
        Math.abs(ratio - kepler) < 1e-9 * kepler,
        "every interval in the chord is a Kepler ratio",
      );
    }
  }
}

// —— the map is monotone, bounded, and runs backward ——————————————————
// The bug: a pitch you could not read the element back out of.
{
  let prevF = Infinity;
  for (let k = 0; k <= 40; k++) {
    const a = O.A_MIN + (k / 40) * (O.A_MAX - O.A_MIN);
    const f = O.freqForElements(a, MU);
    assert.ok(f < prevF, "a wider orbit always rings lower");
    prevF = f;
    const back = O.semiMajorForFreq(f, MU);
    assert.ok(Math.abs(back - a) < 1e-9 * a, `the sound gives the element back (a=${a})`);
  }
  // Bounded means SPEAKABLE: the audio bus clamps outside 40–8000 Hz, and a
  // clamped voice is a lie the inverse could not undo. Every reachable
  // orbit under every reachable sun must map strictly inside that band.
  const fLow = O.freqForElements(O.A_MAX, MU * O.MU_FACTOR_MIN);
  const fHigh = O.freqForElements(O.A_MIN, MU * O.MU_FACTOR_MAX);
  assert.ok(fLow > 40 && fHigh < 8000, `the register stays speakable (${fLow}..${fHigh} Hz)`);
  // a heavier sun lifts the whole chord — μ is audible, and recoverable too
  assert.ok(
    O.freqForElements(1, MU * 2) > O.freqForElements(1, MU),
    "more sun, higher chord",
  );
}

// —— determinism from a seed ————————————————————————————————————
{
  assert.deepEqual(O.systemFromSeed(0xa11ce), O.systemFromSeed(0xa11ce), "a seed is a sky");
  assert.notDeepEqual(O.systemFromSeed(1), O.systemFromSeed(2), "different seeds differ");
  for (const el of system) {
    assert.ok(el.a >= O.A_MIN && el.a <= O.A_MAX, "every world inside the walls");
    assert.ok(el.e >= 0 && el.e < 0.45, "planetary eccentricity stays planetary");
  }
  const as = system.map((b) => b.a);
  for (let i = 1; i < as.length; i++) assert.ok(as[i] > as[i - 1], "the ladder climbs outward");
}

// —— the state vector and the elements are the same object ——————————————
// THE hinge of the room: forces live in the state vector, the closed form
// lives in the elements, and every act by the hand or by gravity crosses
// that bridge. A sign slip in the eccentricity vector, a ν measured from
// the wrong axis, or a branch picked off the wrong root of the conic all
// render plausibly and quietly put every kicked body somewhere else.
{
  for (const el of system) {
    for (const t of [0, 811.3, 51234.7]) {
      const s = O.stateVectorAt(el, MU, t);
      const back = O.elementsFromState(el, s, MU, t);
      assert.equal(back.kind, "bound", "a planet's own state is a planet's own orbit");
      const p0 = O.positionAt(el, MU, t);
      const p1 = O.positionAt(back.el, MU, t);
      assert.ok(
        Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-7 * el.a,
        "elements → state → elements lands on the same point",
      );
      assert.ok(Math.abs(back.el.a - el.a) < 1e-7 * el.a, `and the same a (${el.a})`);
      assert.ok(Math.abs(back.el.e - el.e) < 1e-7 + 1e-6 * el.e, "and the same e");
      const v0 = O.velocityAt(el, MU, t);
      const v1 = O.velocityAt(back.el, MU, t);
      assert.ok(
        Math.hypot(v1.vx - v0.vx, v1.vy - v0.vy) < 1e-6 * Math.hypot(v0.vx, v0.vy),
        "and it is still moving the same way",
      );
    }
  }
  // The circular case the conic solver used to get wrong: at ν = π the two
  // roots are e = 0 and e = 1, and picking the larger one turns a planet on
  // a clean circle into a body falling into the sun.
  const circ = { a: 1.5, e: 0, incl: 0, omega: 0, phase: Math.PI, seed: 7, kind: "planet", size: 1, mass: 0.001 };
  const sc = O.stateVectorAt(circ, MU, 0);
  const bc = O.elementsFromState(circ, sc, MU, 0);
  assert.equal(bc.kind, "bound", "a circle read back is still an orbit");
  assert.ok(bc.el.e < 1e-9, `a circle read back is still a circle (got e=${bc.el.e})`);
}

// —— a body condenses exactly under the finger, moving as it was let go ——
// The bug: elements that put the new body somewhere the hand never was, or
// a plant whose "drift" does nothing (a control that is decoration).
{
  const t = 4321.9;
  for (const [r, theta, hold] of [
    [1.6, 1.1, 0],
    [2.8, 4.9, 1400],
    [3.2, 0.2, 2600],
  ]) {
    const out = O.plantBody(0xc0e7, r, theta, hold, { vr: 0, vt: 0 }, MU, t);
    assert.equal(out.kind, "bound", "a still finger drops a keepable world");
    const p = O.positionAt(out.el, MU, t);
    assert.ok(Math.abs(p.r - r) < 1e-8 * r, `it starts at the pressed radius (${r})`);
    assert.ok(angDist(p.angle, theta) < 1e-8, "and at the pressed angle");
    // A still finger means circular speed exactly: the orbit is a circle.
    assert.ok(out.el.e < 1e-7, `a still finger drops a circle (got e=${out.el.e})`);
    assert.ok(
      Math.abs(O.positionAt(out.el, MU, t + 37).r - r) < 1e-7 * r,
      "and a circle keeps its radius as it goes",
    );
  }
  // The drift is a real kick: with the orbit lifts apoapsis, against it
  // drops periapsis sunward. A plant that ignored the drift passes neither.
  const withIt = O.plantBody(1, 2, 0.7, 500, { vr: 0, vt: 0.25 }, MU, 0);
  const against = O.plantBody(1, 2, 0.7, 500, { vr: 0, vt: -0.35 }, MU, 0);
  assert.equal(withIt.kind, "bound");
  assert.equal(against.kind, "bound");
  assert.ok(withIt.el.a > 2, "kicked along its way, the orbit opens outward");
  assert.ok(against.el.a < 2, "kicked against it, the orbit falls inward");
  assert.ok(withIt.el.e > 0.1 && against.el.e > 0.1, "either kick makes an ellipse");
  assert.ok(
    Math.abs(O.positionAt(against.el, MU, 0).r - 2) < 1e-7,
    "however it is kicked, it appears under the finger",
  );
  // Mass is the hold, monotone and walled.
  assert.ok(O.massForHold(2600) > O.massForHold(400), "a longer hold condenses more mass");
  assert.ok(Math.abs(O.massForHold(0) - O.MASS_MIN) < 1e-12, "a touch is the lightest thing");
  assert.ok(Math.abs(O.massForHold(9e9) - O.MASS_MAX) < 1e-12, "and the ceremony caps out");
  const heavy = O.plantBody(2, 2, 0, 3000, { vr: 0, vt: 0 }, MU, 0);
  const light = O.plantBody(2, 2, 0, 0, { vr: 0, vt: 0 }, MU, 0);
  assert.ok(heavy.el.mass > light.el.mass * 10, "the ceremony really is a giant");
  assert.ok(
    Math.abs(heavy.el.a - light.el.a) < 1e-9,
    "but mass does not change where it was put — the sun still rules the orbit",
  );
}

// —— a kick turns the future and never teleports the present ——————————
// The bug: a hand (or a neighbour's gravity) that jumps a body somewhere
// when it should only have changed where it is going.
{
  const el = system[3];
  const t = 2222.2;
  const p0 = O.positionAt(el, MU, t);
  const v0 = O.velocityAt(el, MU, t);
  const dv = 0.002 * Math.hypot(v0.vx, v0.vy);
  const out = O.kicked(el, MU, t, -dv * 0.3, dv);
  assert.equal(out.kind, "bound");
  const p1 = O.positionAt(out.el, MU, t);
  assert.ok(
    Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-7 * el.a,
    "the instant of the kick, the body has not moved",
  );
  const v1 = O.velocityAt(out.el, MU, t);
  assert.ok(
    Math.hypot(v1.vx - (v0.vx - dv * 0.3), v1.vy - (v0.vy + dv)) < 1e-6 * dv + 1e-12,
    "but it is going exactly where the kick sent it",
  );
  assert.ok(Math.abs(out.el.a - el.a) > 1e-9, "and the orbit is genuinely a different orbit");
}

// —— leaving, and falling in ————————————————————————————————————
// The bug: a "throw" that silently clamps the body back into the system
// (nothing can ever be removed), or a plunge that keeps orbiting the sun
// from inside it.
{
  const el = system[2];
  const t = 100;
  const s = O.stateVectorAt(el, MU, t);
  const speed = Math.hypot(s.vx, s.vy);
  const vEsc = O.escapeSpeed(Math.hypot(s.x, s.y), MU);
  // just under escape: still ours
  const held = O.kicked(
    el, MU, t,
    (s.vx / speed) * (vEsc - speed) * 0.9,
    (s.vy / speed) * (vEsc - speed) * 0.9,
  );
  assert.equal(held.kind, "bound", "just under escape speed, the system keeps it");
  // past it: gone, and no clamp may pretend otherwise
  const gone = O.kicked(
    el, MU, t,
    (s.vx / speed) * (vEsc - speed) * 1.2,
    (s.vy / speed) * (vEsc - speed) * 1.2,
  );
  assert.equal(gone.kind, "escaped", "past escape speed, the system lets it go");
  // kill the angular momentum and it falls in
  const stopped = O.kicked(el, MU, t, -s.vx, -s.vy);
  assert.equal(stopped.kind, "consumed", "a body with no angular momentum falls into the sun");
  assert.ok(
    O.circularSpeed(1, MU) * Math.SQRT2 === O.escapeSpeed(1, MU),
    "escape is √2 × circular, exactly",
  );
}

// —— the mutual pull is Newton's, and is a perturbation ————————————————
// Two bugs: an n-body sum that leaks momentum (one-sided forces — the
// system would slowly drift off the sun on its own), and a kick strength
// that either does nothing at all (decorative gravity) or overwhelms the
// Kepler drift the closed form depends on.
{
  const t = 909.1;
  const bodies = system.map((b, i) => ({ ...b, mass: 0.004 + i * 0.002 }));
  const acc = O.mutualAccelerations(bodies, MU, t);
  let px = 0;
  let py = 0;
  let scale = 0;
  for (let i = 0; i < bodies.length; i++) {
    px += bodies[i].mass * acc[i * 2];
    py += bodies[i].mass * acc[i * 2 + 1];
    scale += bodies[i].mass * Math.hypot(acc[i * 2], acc[i * 2 + 1]);
  }
  assert.ok(scale > 0, "the bodies actually pull on each other");
  assert.ok(
    Math.hypot(px, py) < 1e-12 * scale + 1e-18,
    `every pull answers itself — total momentum change is zero (got ${Math.hypot(px, py)})`,
  );
  // A single body feels nothing; a lone system is exactly Kepler.
  const alone = O.mutualAccelerations([bodies[0]], MU, t);
  assert.ok(alone[0] === 0 && alone[1] === 0, "one body pulls on nobody");

  // The split's precondition: over a whole orbit the mutual pull moves the
  // elements a little, not a lot. (If this ever fails the closed-form
  // absence stops being honest, and the room's whole argument with it.)
  let stepped = bodies;
  const T = O.periodOf(bodies[0].a, MU);
  const dt = T / 400;
  for (let k = 0; k < 400; k++) {
    const r = O.perturbed(stepped, MU, t + k * dt, dt);
    stepped = r.bodies;
  }
  assert.equal(stepped.length, bodies.length, "a quiet system loses nobody in one orbit");
  let maxRel = 0;
  let anyMoved = false;
  for (let i = 0; i < bodies.length; i++) {
    const rel = Math.abs(stepped[i].a - bodies[i].a) / bodies[i].a;
    if (rel > 1e-9) anyMoved = true;
    maxRel = Math.max(maxRel, rel);
  }
  assert.ok(anyMoved, "gravity between the worlds is not decoration");
  assert.ok(maxRel < 0.25, `and it stays a perturbation (worst drift ${maxRel})`);
}

// —— a merger keeps the mass and the momentum ————————————————————————
{
  const t = 1500;
  const a = { ...system[1], mass: 0.006 };
  const b = { ...system[1], mass: 0.002, phase: system[1].phase + 0.004, seed: 99, kind: "comet" };
  const sa = O.stateVectorAt(a, MU, t);
  const sb = O.stateVectorAt(b, MU, t);
  const out = O.mergedBody(a, b, MU, t);
  assert.equal(out.kind, "bound", "two worlds that touch make one world");
  assert.ok(
    Math.abs(out.el.mass - (a.mass + b.mass)) < 1e-12,
    "the mass of the two is the mass of the one",
  );
  const sm = O.stateVectorAt(out.el, MU, t);
  const m = a.mass + b.mass;
  const pxWant = a.mass * sa.vx + b.mass * sb.vx;
  const pyWant = a.mass * sa.vy + b.mass * sb.vy;
  const norm = Math.hypot(pxWant, pyWant);
  assert.ok(
    Math.hypot(m * sm.vx - pxWant, m * sm.vy - pyWant) < 1e-6 * norm,
    "and the momentum of the two is the momentum of the one",
  );
  assert.equal(out.el.seed, a.seed, "the heavier body keeps its identity");
  // and they only merge when they actually touch
  assert.deepEqual(O.firstCollision([a, b], MU, t), [0, 1], "touching bodies collide");
  const far = { ...b, a: b.a * 1.8 };
  assert.equal(O.firstCollision([a, far], MU, t), null, "distant bodies do not");
}

// —— resonance is read off the periods, not asserted ————————————————
{
  // a 2:1 pair by construction: T ∝ a^{3/2}, so a_out = a_in · 2^{2/3}
  const inner = { ...system[0], a: 1 };
  const outer = { ...system[1], a: Math.pow(2, 2 / 3) };
  const found = O.resonances([inner, outer], MU);
  assert.equal(found.length, 1, "the 2:1 lock is seen");
  assert.equal(found[0].p, 2, "…as 2:1");
  assert.equal(found[0].q, 1);
  // an ugly ratio is not bent into a pretty one
  const ugly = { ...system[1], a: Math.pow(1.37, 2 / 3) };
  assert.equal(O.resonances([inner, ugly], MU).length, 0, "a detuned pair is left detuned");
  assert.equal(O.nearestRatio(1.4999).p, 3, "3:2 is 3:2");
  assert.equal(O.nearestRatio(1.4999).q, 2);
}

// —— the nudge follows the hand, and pitch follows the nudge ———————————
{
  const el = system[2];
  const t = 777.3;
  const p = O.positionAt(el, MU, t);
  const out = O.nudged(el, MU, t, p.r, p.r * 1.3, p.angle + 0.4);
  const pOut = O.positionAt(out, MU, t);
  assert.ok(angDist(pOut.angle, p.angle + 0.4) < 1e-8, "the body tracks the hand's angle");
  assert.ok(Math.abs(out.a - el.a * 1.3) < 1e-9, "a radial pull rescales the whole orbit");
  assert.equal(out.e, el.e, "the orbit's character survives the nudge");
  assert.ok(
    O.freqForElements(out.a, MU) < O.freqForElements(el.a, MU),
    "pulled outward, the voice falls — Kepler in the hand",
  );
  const clamped = O.nudged(el, MU, t, p.r, p.r * 1e6, p.angle);
  assert.equal(clamped.a, O.A_MAX, "no orbit escapes the walls");
}

// —— the conjunction is a re-timing, not a freeze ————————————————————
// The bug: an "alignment" that pins phases so the sky stops obeying Kepler.
{
  const t = 5000;
  const target = 2.2;
  const phases = O.conjunctionPhases(system, MU, t, target);
  const aligned = system.map((el, i) => ({ ...el, phase: phases[i] }));
  for (const el of aligned) {
    assert.ok(
      angDist(O.positionAt(el, MU, t).angle, target) < 1e-8,
      "every body stands on the appointed ray at the appointed time",
    );
  }
  // ...and then they shear apart at their own rates
  const later = aligned.map((el) => O.positionAt(el, MU, t + 120).angle);
  let spread = 0;
  for (let i = 1; i < later.length; i++) spread = Math.max(spread, angDist(later[i], later[0]));
  assert.ok(spread > 0.05, "two minutes on, the conjunction has already opened");
}

// —— the sun-mass knob re-tempos, never teleports ————————————————————
{
  const t = 3600;
  for (const el of system) {
    const rekeyed = { ...el, phase: O.phaseForContinuity(el, MU, MU * 1.7, t) };
    const before = O.positionAt(el, MU, t);
    const after = O.positionAt(rekeyed, MU * 1.7, t);
    assert.ok(
      Math.hypot(after.x - before.x, after.y - before.y) < 1e-8 * el.a,
      "the instant of the change, nothing moves",
    );
    const drift = angDist(
      O.positionAt(rekeyed, MU * 1.7, t + 60).angle,
      O.positionAt(el, MU, t + 60).angle,
    );
    assert.ok(drift > 1e-4, "but the future runs at the new tempo");
  }
}

// —— periapsis rings once per orbit, whatever the frame rate ————————————
// The bug: a crossing detector double-counting or missing beats when the
// sampling grid and the period share no rhythm.
{
  const el = system[1];
  const T = O.periodOf(el.a, MU);
  for (const steps of [131, 997]) {
    let count = 0;
    let prev = O.meanAnomalyAt(el, MU, 0.13);
    for (let i = 1; i <= steps; i++) {
      const m = O.meanAnomalyAt(el, MU, 0.13 + (i / steps) * 3 * T);
      if (O.crossedPeriapsis(prev, m)) count++;
      prev = m;
    }
    assert.equal(count, 3, `three periods ring exactly three times (grid ${steps})`);
  }
}

// —— the drawn orbit keeps the order of the real one ————————————————————
{
  let prev = 0;
  for (let k = 0; k <= 30; k++) {
    const a = O.A_MIN + (k / 30) * (O.A_MAX - O.A_MIN);
    const d = O.displayRadiusFor(a);
    assert.ok(d > prev && d <= 1, "the compressed map stays strictly monotone and bounded");
    prev = d;
    // ...and the screen can hand the radius back (a press knows its orbit)
    assert.ok(Math.abs(O.worldRadiusForDisplay(d) - a) < 1e-9, "display round-trips to world");
  }
}

// —— population law ————————————————————————————————————————————
{
  let bodies = system;
  for (let i = 0; i < 10; i++) {
    bodies = O.withComet(bodies, O.plantBody(1000 + i, 3, i, 500, { vr: 0, vt: 0 }, MU, 0).el);
  }
  assert.equal(bodies.filter((b) => b.kind === "planet").length, O.PLANET_COUNT,
    "no world is ever retired for a comet");
  assert.equal(bodies.filter((b) => b.kind === "comet").length, O.MAX_COMETS,
    "the wanderers hold their cap, oldest let go first");
  assert.equal(bodies.filter((b) => b.kind === "comet")[0].seed, 1004, "FIFO, exactly");
}

console.log(
  "orbits ok: a week in one jump equals a week in a thousand steps, Kepler solved to tolerance through e=0.999, orbits closing on their sounded periods, apoapsis where the pencil puts it, energy and angular momentum flat around the ellipse, the chord's intervals the third law itself and invertible, the state vector and the elements the same object both ways, a still finger dropping a circle and a drifting one an ellipse, kicks that turn the future without teleporting the present, escape and infall actually removing bodies, mutual gravity that answers itself and stays a perturbation, mergers keeping mass and momentum, resonances read off the periods, conjunctions re-timed not frozen, and the sun-mass knob changing tempo without teleporting anybody",
);
