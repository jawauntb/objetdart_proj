// The /birds laws. Every assertion below names a bug it would catch.
//
// The big ones: an integrator that gives a different flock at 60 Hz than at
// 120 Hz (the exact bug the fixed timestep exists to prevent, and the one that
// would make the room's determinism law false); an order parameter that is not
// actually the order (checked against the two cases anybody can compute by
// hand — a regular ring of headings sums to zero, and a pair θ apart has order
// cos(θ/2)); rules wired to the wrong sign, so "cohesion" spreads and
// "alignment" scrambles; birds escaping the sky; and an order→harmonic map you
// could not read back, which would make the sound decoration instead of a
// representation.

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

const F = loadTsModule("src/lib/flock.ts");

const NO_WIND = { x: 0, y: 0, z: 0 };

/**
 * A sky whose headings point everywhere, from a seed. `seedFlock` deliberately
 * arrives coherent (the room opens on a flock already flying), so the rules
 * below that must be shown to CREATE order start from a scramble of their own
 * making rather than trusting the seeding.
 */
function scramble(st, seed) {
  const rng = F.mulberry32(seed);
  const flockAct = F.activityIndex("flock");
  for (let i = 0; i < st.n; i++) {
    const yaw = rng() * Math.PI * 2;
    const pitch = (rng() - 0.5) * 1.2;
    const sp = F.MIN_SPEED + rng() * (F.MAX_SPEED - F.MIN_SPEED);
    st.vel[i * 3] = Math.cos(yaw) * Math.cos(pitch) * sp;
    st.vel[i * 3 + 1] = Math.sin(pitch) * sp;
    st.vel[i * 3 + 2] = Math.sin(yaw) * Math.cos(pitch) * sp;
    // Law tests measure the murmuration: put every bird in the air so
    // the thirteen meadow residents cannot dilute the order under test.
    st.activityOf[i] = flockAct;
  }
  return st;
}
const params = (over = {}) => ({
  separation: 1,
  alignment: 1,
  cohesion: 1,
  wind: NO_WIND,
  goal: { x: 0, y: 0, z: 0 },
  goalPull: 0,
  ...over,
});

// —— the order parameter, checked against arithmetic done by hand ————
// The bug: an "order parameter" that is really a speed average, or that
// forgets to normalise, would still look plausible on screen while making the
// sound say nothing about the flock.
{
  // A regular ring of headings sums to zero exactly — the closed polygon.
  for (const n of [2, 3, 4, 5, 8, 17, 60]) {
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      vel[i * 3] = Math.cos(a) * 9;
      vel[i * 3 + 2] = Math.sin(a) * 9;
    }
    assert.ok(
      F.orderParameter(vel, n) < 1e-6,
      `a ring of ${n} evenly spread headings has no order at all`,
    );
  }
  // One animal: every heading identical, order exactly 1 — and speeds differing
  // must not change it, because order is about direction and nothing else.
  {
    const n = 40;
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const sp = 5 + (i % 7);
      vel[i * 3] = 0.6 * sp;
      vel[i * 3 + 1] = 0;
      vel[i * 3 + 2] = 0.8 * sp;
    }
    assert.ok(Math.abs(F.orderParameter(vel, n) - 1) < 1e-6, "one heading is one animal");
  }
  // A pair θ apart: the mean unit vector is cos(θ/2) long. Closed form,
  // independent of the implementation.
  for (const theta of [0, 0.3, 0.8, 1.4, 2.0, 2.7, Math.PI]) {
    const vel = new Float32Array(6);
    vel[0] = Math.cos(theta / 2) * 7;
    vel[2] = Math.sin(theta / 2) * 7;
    vel[3] = Math.cos(-theta / 2) * 11;
    vel[5] = Math.sin(-theta / 2) * 11;
    assert.ok(
      Math.abs(F.orderParameter(vel, 2) - Math.cos(theta / 2)) < 1e-6,
      `two birds ${theta} rad apart are ordered cos(θ/2)`,
    );
  }
  // Order belongs to the flock, not to the observer: turning the camera (i.e.
  // rotating every velocity together) must not change it. The bug this catches
  // is computing order in screen space, which would make the sound answer the
  // twist gesture instead of the sky.
  {
    const st = F.seedFlock(0xb17d5, 400);
    const before = F.orderParameter(st.vel, st.n);
    const yaw = 0.9;
    const rot = new Float32Array(st.n * 3);
    for (let i = 0; i < st.n; i++) {
      const x = st.vel[i * 3];
      const z = st.vel[i * 3 + 2];
      rot[i * 3] = x * Math.cos(yaw) - z * Math.sin(yaw);
      rot[i * 3 + 1] = st.vel[i * 3 + 1];
      rot[i * 3 + 2] = x * Math.sin(yaw) + z * Math.cos(yaw);
    }
    assert.ok(
      Math.abs(F.orderParameter(rot, st.n) - before) < 1e-6,
      "rotating the observer does not order the flock",
    );
  }
  assert.equal(F.orderParameter(new Float32Array(0), 0), 0, "an empty sky has no order");
}

// —— the fixed timestep: the same elapsed time is the same flock ————
// THE bug: integrating by whatever the frame happened to be, so the room is a
// different room on a 120 Hz phone than on a 60 Hz laptop, and no seed
// reproduces anything.
{
  const p = params({ wind: { x: 0.4, y: 0, z: -0.2 }, goal: F.seasonGoal(1), goalPull: 0.6 });
  const slow = F.seedFlock(0x5eed, 500);
  const fast = F.seedFlock(0x5eed, 500);
  const jerky = F.seedFlock(0x5eed, 500);
  let slowSteps = 0;
  let fastSteps = 0;
  let jerkySteps = 0;
  for (let i = 0; i < 60; i++) slowSteps += F.advanceFlock(slow, p, 1 / 60);
  for (let i = 0; i < 120; i++) fastSteps += F.advanceFlock(fast, p, 1 / 120);
  // ...and a machine that stutters: uneven frames summing to the same second.
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(((i % 5) + 1) / 200);
  const total = frames.reduce((a, b) => a + b, 0);
  for (const f of frames) jerkySteps += F.advanceFlock(jerky, p, (f / total) * 1);

  assert.equal(slowSteps, 60, "a second of 60 Hz frames is sixty fixed steps");
  assert.equal(fastSteps, 60, "and a second of 120 Hz frames is the same sixty");
  assert.deepEqual(fast.pos, slow.pos, "60 Hz and 120 Hz land every bird in the same place");
  assert.deepEqual(fast.vel, slow.vel, "and flying the same way");
  assert.ok(Math.abs(jerkySteps - 60) <= 1, "a stuttering machine spends the same time");
  let worst = 0;
  for (let i = 0; i < slow.pos.length; i++) {
    worst = Math.max(worst, Math.abs(jerky.pos[i] - slow.pos[i]));
  }
  assert.ok(worst < 0.6, `uneven frames still fly the same flock (worst drift ${worst})`);
  // The accumulator carries the remainder rather than dropping it: half a step
  // twice is one step.
  {
    const st = F.seedFlock(7, 200);
    assert.equal(F.advanceFlock(st, params(), F.FIXED_DT * 0.5), 0, "half a step is no step yet");
    assert.equal(F.advanceFlock(st, params(), F.FIXED_DT * 0.5), 1, "the other half spends it");
  }
  // A long stall never spirals: the debt is dropped, not paid all at once.
  {
    const st = F.seedFlock(7, 200);
    assert.ok(
      F.advanceFlock(st, params(), 30) <= F.MAX_STEPS_PER_ADVANCE,
      "a backgrounded tab does not come back and simulate half a minute",
    );
  }
}

// —— determinism from the seed ————————————————————————————————
{
  const a = F.seedFlock(0xf10c, 600);
  const b = F.seedFlock(0xf10c, 600);
  assert.deepEqual(a.pos, b.pos, "a seed is a sky");
  assert.deepEqual(a.vel, b.vel, "headings and all");
  const c = F.seedFlock(0xf10d, 600);
  let same = true;
  for (let i = 0; i < a.pos.length; i++) if (a.pos[i] !== c.pos[i]) same = false;
  assert.ok(!same, "a different seed is a different sky");
  const p = params();
  for (let i = 0; i < 90; i++) {
    F.advanceFlock(a, p, 1 / 60);
    F.advanceFlock(b, p, 1 / 60);
  }
  assert.deepEqual(a.pos, b.pos, "and the same sky flown twice is the same flight");
}

// —— population: a cap that actually caps ————————————————————————
// The bug: a screen big enough to ask for a hundred thousand birds, and a
// phone that drops the frame.
assert.equal(F.flockSize(1e9), F.MAX_BIRDS, "the sky holds no more than its cap");
assert.equal(F.flockSize(3), F.MIN_BIRDS, "nor fewer than a flock");
assert.equal(F.flockSize(NaN), F.MIN_BIRDS, "a screen that measures nothing still gets a flock");
assert.equal(F.seedFlock(1, 1e9).n, F.MAX_BIRDS, "and the seeding obeys the cap");
assert.equal(F.seedFlock(1, 900).pos.length, 900 * 3, "three numbers per bird, no more");

// —— aviary population: small, diverse, mutable ————————————————
// The bug: rebuilding the room as just a smaller point cloud, or letting
// touch creation silently grow back to thousands of birds.
{
  const aviary = F.seedAviary(0xa71, 0.4, 2);
  assert.ok(aviary.n >= F.AVIARY_MIN && aviary.n <= F.AVIARY_MAX, "an aviary starts inside its own readable cap");
  assert.equal(aviary.capacity, F.AVIARY_MAX, "the aviary has room for touch-spawned birds");
  assert.ok(aviary.pos.length === F.AVIARY_MAX * 3, "aviary buffers are capacity-sized, not reallocated per spawn");

  const kinds = new Set();
  let small = Infinity;
  let large = 0;
  for (let i = 0; i < aviary.n; i++) {
    kinds.add(aviary.kindOf[i]);
    small = Math.min(small, aviary.bird[i * 2 + 1]);
    large = Math.max(large, aviary.bird[i * 2 + 1]);
  }
  assert.ok(kinds.size >= F.BIRD_KINDS.length, "the starting aviary covers every catalog kind");
  assert.ok(large - small > 0.7, `individual bird sizes differ enough to read (${small} → ${large})`);

  const before = aviary.n;
  const spawned = F.spawnBird(aviary, "duck", "pond");
  assert.ok(spawned >= 0, "double-tap can create a bird while capacity remains");
  assert.equal(aviary.n, before + 1, "spawn grows the live prefix by one");
  assert.equal(F.BIRD_KINDS[aviary.kindOf[spawned]], "duck", "spawn can choose a species");
  assert.equal(F.ACTIVITIES[aviary.activityOf[spawned]], "swim", "a pond-spawned duck enters swimming");

  const nearest = F.nearestBird(aviary, 0.5, 0.5);
  assert.ok(nearest >= 0 && nearest < aviary.n, "nearestBird addresses the live prefix");
  assert.ok(F.birdAt(aviary, 0.5, 0.5, 1) >= 0, "birdAt hits with a wide enough radius");

  const culled = F.cullBird(aviary, spawned);
  assert.ok(culled >= 0, "triple-tap can cull a bird");
  assert.equal(aviary.n, before, "cull shrinks the live prefix by one");
  const kept = F.clearBirds(aviary);
  assert.ok(kept >= 1 && kept <= 3, "clear leaves a few living witnesses, not a dead screen");
  assert.equal(aviary.n, kept, "clear returns the remaining live population");
}

// —— alignment aligns ————————————————————————————————————————
// The bug: an alignment term with the sign or the normalisation wrong, which
// scrambles the flock while the parameter is called alignment.
{
  const st = scramble(F.seedFlock(0xa11, 500), 0x5c1);
  // pack them close so everyone has neighbours, then align and nothing else
  for (let i = 0; i < st.n; i++) {
    st.pos[i * 3] *= 0.35;
    st.pos[i * 3 + 1] *= 0.35;
    st.pos[i * 3 + 2] *= 0.35;
  }
  const p = params({ separation: 0, cohesion: 0, alignment: 1.6 });
  let prev = F.orderParameter(st.vel, st.n);
  const first = prev;
  for (let c = 0; c < 12; c++) {
    for (let i = 0; i < 10; i++) F.advanceFlock(st, p, 1 / 60);
    const now = F.orderParameter(st.vel, st.n);
    assert.ok(now > prev, `alignment never un-aligns (${prev} → ${now})`);
    prev = now;
  }
  assert.ok(first < 0.35, "a seeded sky starts scattered");
  assert.ok(prev > 0.9, "and a pure alignment rule makes it one animal");
  // ...and with alignment off from the same start, it does not.
  const idle = scramble(F.seedFlock(0xa11, 500), 0x5c1);
  for (let i = 0; i < idle.n; i++) {
    idle.pos[i * 3] *= 0.35;
    idle.pos[i * 3 + 1] *= 0.35;
    idle.pos[i * 3 + 2] *= 0.35;
  }
  const q = params({ separation: 0, cohesion: 0, alignment: 0 });
  for (let i = 0; i < 120; i++) F.advanceFlock(idle, q, 1 / 60);
  assert.ok(
    F.orderParameter(idle.vel, idle.n) < prev - 0.3,
    "the ordering is the rule's doing, not the sky's",
  );
  // and the dial is a dial: more alignment, more order, from the same seed
  const orders = [0.2, 0.7, 1.5].map((w) => {
    const s = scramble(F.seedFlock(0xa11, 500), 0x5c1);
    for (let i = 0; i < s.n; i++) {
      s.pos[i * 3] *= 0.35;
      s.pos[i * 3 + 1] *= 0.35;
      s.pos[i * 3 + 2] *= 0.35;
    }
    const pp = params({ separation: 0, cohesion: 0, alignment: w });
    for (let i = 0; i < 30; i++) F.advanceFlock(s, pp, 1 / 60);
    return F.orderParameter(s.vel, s.n);
  });
  assert.ok(orders[0] < orders[1] && orders[1] < orders[2], "the alignment dial is wired");
}

// —— cohesion gathers ——————————————————————————————————————
// The bug: a cohesion term pointing away from the neighbourhood centre — the
// flock quietly disperses and the room reads as "windy" rather than broken.
// A bird is never still (MIN_SPEED), so cohesion cannot collapse a cloud to a
// point; what it does, and what is asserted here, is HOLD one — the cohesive
// sky settles at a radius while the same sky without it runs to the walls.
{
  const compact = (seed) => {
    const st = F.seedFlock(seed, 700);
    const flockAct = F.activityIndex("flock");
    for (let i = 0; i < st.n; i++) {
      st.activityOf[i] = flockAct;
      st.pos[i * 3] *= 0.4;
      st.pos[i * 3 + 1] *= 0.4;
      st.pos[i * 3 + 2] *= 0.4;
    }
    return st;
  };
  const tight = compact(0xc0);
  const loose = compact(0xc0);
  const withCoh = params({ separation: 0, alignment: 0.3, cohesion: 1.8 });
  const without = params({ separation: 0, alignment: 0.3, cohesion: 0 });
  let held = 0;
  for (let c = 0; c < 10; c++) {
    for (let i = 0; i < 60; i++) {
      F.advanceFlock(tight, withCoh, 1 / 60);
      F.advanceFlock(loose, without, 1 / 60);
    }
    const a = F.spread(tight.pos, tight.n);
    const b = F.spread(loose.pos, loose.n);
    if (c > 0) assert.ok(a < b, `cohesion always holds the flock tighter (${a} vs ${b})`);
    held = Math.max(held, a);
  }
  assert.ok(held < F.WORLD_X * 0.6, `the cohesive flock settles at a radius (${held})`);
  assert.ok(
    F.spread(loose.pos, loose.n) > held * 1.25,
    "without cohesion the flock is looser — the mid-sky well keeps it from roosting on the wall",
  );
  // Center-field law: even the loose sky's centroid stays mid-volume.
  const c = F.centroid(loose.pos, loose.n);
  const cr = Math.hypot(c.x, c.y, c.z);
  assert.ok(cr < F.WORLD_X * 0.45, `loose centroid stays mid-sky (got ${cr})`);
}

// —— separation keeps them off each other ————————————————————————
// The bug: a separation term that does nothing at close range (an inverse
// distance with no floor, a radius test with the wrong comparison), so birds
// pass through one another and the murmuration renders as a solid blob.
{
  // Two birds flown past each other on a near-miss — the case you can picture.
  const nearMiss = (sep) => {
    const st = F.seedFlock(1, F.MIN_BIRDS);
    st.n = 2;
    st.pos.set([-6, -0.4, 0, 6, 0.4, 0]);
    st.vel.set([F.MIN_SPEED, 0, 0, -F.MIN_SPEED, 0, 0]);
    st.activityOf[0] = F.activityIndex("flock");
    st.activityOf[1] = F.activityIndex("flock");
    const p = params({ separation: sep, alignment: 0, cohesion: 0 });
    let min = Infinity;
    for (let i = 0; i < 90; i++) {
      F.advanceFlock(st, p, 1 / 60);
      min = Math.min(min, Math.hypot(st.pos[3] - st.pos[0], st.pos[4] - st.pos[1], st.pos[5] - st.pos[2]));
    }
    return min;
  };
  const off = nearMiss(0);
  const on = nearMiss(1.4);
  assert.ok(off < 0.85, `with separation off two birds nearly touch (${off})`);
  assert.ok(on > off * 1.5, `separation opens the miss (${off} → ${on})`);

  // ...and the same law over a crowd: a cloud packed far tighter than the
  // separation radius must push itself out to a real floor.
  const floorOf = (sep) => {
    const st = F.seedFlock(0x0c1, 300);
    const flockAct = F.activityIndex("flock");
    for (let i = 0; i < st.n; i++) {
      st.activityOf[i] = flockAct;
      st.pos[i * 3] *= 0.03;
      st.pos[i * 3 + 1] *= 0.03;
      st.pos[i * 3 + 2] *= 0.03;
    }
    const p = params({ separation: sep, alignment: 0.4, cohesion: 0.4 });
    for (let i = 0; i < 180; i++) F.advanceFlock(st, p, 1 / 60);
    let min = Infinity;
    for (let i = 0; i < st.n; i++) {
      for (let j = i + 1; j < st.n; j++) {
        min = Math.min(
          min,
          Math.hypot(
            st.pos[j * 3] - st.pos[i * 3],
            st.pos[j * 3 + 1] - st.pos[i * 3 + 1],
            st.pos[j * 3 + 2] - st.pos[i * 3 + 2],
          ),
        );
      }
    }
    return min;
  };
  const packed = floorOf(0);
  const parted = floorOf(1.4);
  assert.ok(parted > packed * 2, `a packed cloud parts under separation (${packed} → ${parted})`);
  assert.ok(parted > 0.1, "and holds a real floor between the closest pair");
}

// —— the hand in the sky: lure, scatter, swirl ————————————————————
// The bug: a lure that pulls the whole sky rather than the birds near it (no
// falloff), or a "scatter" that gathers — the hand would feel like a switch
// instead of a reach.
{
  const lure = { x: 12, y: 3, z: -8 };
  const meanDistTo = (st, p) => {
    let s = 0;
    for (let i = 0; i < st.n; i++) {
      s += Math.hypot(st.pos[i * 3] - p.x, st.pos[i * 3 + 1] - p.y, st.pos[i * 3 + 2] - p.z);
    }
    return s / st.n;
  };
  const fly = (lurePull, swirl) => {
    const st = F.seedFlock(0x123, 500);
    const p = params({ separation: 0.5, alignment: 0.8, cohesion: 0.8, lure, lurePull, swirl });
    for (let i = 0; i < 120; i++) F.advanceFlock(st, p, 1 / 60);
    return st;
  };
  const idle = fly(0, 0);
  const drawn = fly(9, 0);
  const scattered = fly(-9, 0);
  const d0 = meanDistTo(idle, lure);
  assert.ok(meanDistTo(drawn, lure) < d0 - 1, "a held finger gathers the flock to it");
  assert.ok(meanDistTo(scattered, lure) > d0 + 1, "and a scattering one drives it off");
  // The reach is finite: a bird beyond LURE_RADIUS must not feel it at all.
  {
    const far = { x: 0, y: 0, z: 0 };
    const a = F.seedFlock(0x9, 300);
    const b = F.seedFlock(0x9, 300);
    for (let i = 0; i < a.n; i++) {
      // park the whole flock well outside the lure's reach
      a.pos[i * 3] = b.pos[i * 3] = -(F.LURE_RADIUS + 12) + (i % 5) * 0.5;
      a.pos[i * 3 + 1] = b.pos[i * 3 + 1] = 0;
      a.pos[i * 3 + 2] = b.pos[i * 3 + 2] = 0;
    }
    for (let i = 0; i < 20; i++) {
      F.advanceFlock(a, params({ lure: far, lurePull: 40 }), 1 / 60);
      F.advanceFlock(b, params({ lure: far, lurePull: 0 }), 1 / 60);
    }
    assert.deepEqual(a.pos, b.pos, "the lure has a reach, and beyond it nothing is touched");
  }
  // Swirl gives the flock angular momentum about the vertical, in the
  // direction it was turned — the bug is a vortex that spins whichever way.
  const angular = (st, p) => {
    let l = 0;
    for (let i = 0; i < st.n; i++) {
      const rx = st.pos[i * 3] - p.x;
      const rz = st.pos[i * 3 + 2] - p.z;
      l += rx * st.vel[i * 3 + 2] - rz * st.vel[i * 3];
    }
    return l / st.n;
  };
  const still = angular(idle, lure);
  const cw = angular(fly(0, -12), lure);
  const ccw = angular(fly(0, 12), lure);
  assert.ok(ccw > still + 10, `a hand circling one way turns the flock that way (${still} → ${ccw})`);
  assert.ok(cw < still - 10, `and the other way, the other way (${still} → ${cw})`);
}

// —— the wind blows the way it is pointed ————————————————————————
// The bug: wind wired to the wrong axis or sign — the tilt gesture that this
// whole room is built around would push the flock the other way.
{
  // Measured against the same sky with no wind at all: the flock already has
  // a heading of its own, and what the wind must do is move it downwind of
  // where it would otherwise have gone.
  const drift = (w) => {
    const st = F.seedFlock(0x1d, 400);
    const before = F.centroid(st.pos, st.n);
    for (let i = 0; i < 120; i++) F.advanceFlock(st, params({ wind: w }), 1 / 60);
    const after = F.centroid(st.pos, st.n);
    return { x: after.x - before.x, y: after.y - before.y, z: after.z - before.z };
  };
  const calm = drift(NO_WIND);
  for (const w of [
    { x: 6, y: 0, z: 0 },
    { x: -6, y: 0, z: 0 },
    { x: 0, y: 0, z: 6 },
    { x: 0, y: 4, z: -4 },
  ]) {
    const d = drift(w);
    const mag = F.windStrength(w);
    const moved = ((d.x - calm.x) * w.x + (d.y - calm.y) * w.y + (d.z - calm.z) * w.z) / mag;
    assert.ok(moved > 1, `the flock goes downwind (${JSON.stringify(w)} moved ${moved})`);
  }
  // Tilt → wind: level is calm, right is right, and no tilt blows harder than
  // the strength it was given.
  const level = F.windFromTilt(45, 0, 3);
  assert.ok(F.windStrength(level) < 1e-9, "a level device makes no wind");
  assert.ok(F.windFromTilt(45, 30, 3).x > 0, "tilt right, the air goes right");
  assert.ok(F.windFromTilt(45, -30, 3).x < 0, "tilt left, the air goes left");
  for (const [b, g] of [[0, 0], [90, 90], [180, -180], [-90, 400], [45, 12]]) {
    assert.ok(
      F.windStrength(F.windFromTilt(b, g, 3)) <= 3 * Math.sqrt(1 + 1 + 0.35 * 0.35) + 1e-9,
      "no tilt exceeds the wind it was allowed",
    );
  }
}

// —— the sky is closed —————————————————————————————————————
// The bug: birds escaping to infinity under a hard wind — an empty screen,
// and NaN everywhere a moment later.
{
  for (const w of [
    { x: 0, y: 0, z: 0 },
    { x: 40, y: 20, z: -40 },
    { x: -80, y: -80, z: 80 },
  ]) {
    const st = F.seedFlock(0xfa11, 600);
    // The closed-sky speed floor is a murmuration law; meadow residents are
    // allowed to settle. Put every bird in the air for this check.
    const flockAct = F.activityIndex("flock");
    for (let i = 0; i < st.n; i++) st.activityOf[i] = flockAct;
    const p = params({ separation: 2, alignment: 2, cohesion: 2, wind: w, goal: F.seasonGoal(2), goalPull: 8 });
    for (let i = 0; i < 600; i++) F.advanceFlock(st, p, 1 / 60);
    assert.ok(F.withinBounds(st.pos, st.n), `no bird leaves the sky under wind ${JSON.stringify(w)}`);
    for (let i = 0; i < st.n; i++) {
      const sp = Math.hypot(st.vel[i * 3], st.vel[i * 3 + 1], st.vel[i * 3 + 2]);
      assert.ok(
        sp >= F.MIN_SPEED - 1e-3 && sp <= F.MAX_SPEED + 1e-3,
        `a bird is never still and never a bullet (${sp})`,
      );
    }
  }
}

// —— the map: order → the harmonic series, and back ————————————
// The bug this catches is the one INSPIRATION.md §2 names: a rendering of
// state whose map is arbitrary. If the order cannot be read back out of the
// partials, the sound is decoration.
{
  for (let i = 0; i <= 100; i++) {
    const order = i / 100;
    const amps = F.partialsForOrder(order);
    assert.equal(amps.length, F.PARTIALS, "one amplitude per partial");
    let sum2 = 0;
    for (const a of amps) {
      assert.ok(a >= 0 && a <= 1, "every partial is bounded");
      sum2 += a * a;
    }
    assert.ok(Math.abs(sum2 - 1) < 1e-12, "the stack is normalised, so nothing gets loud");
    const read = F.orderFromPartials(amps);
    assert.ok(Math.abs(read - order) < 1e-9, `the partials carry the order back (${order} → ${read})`);
    const f1 = F.partialFreq(400, 1, order);
    const f2 = F.partialFreq(400, 2, order);
    const readF = F.orderFromPartialFreqs(f1, f2);
    assert.ok(Math.abs(readF - order) < 1e-9, "and so does the interval between them");
  }
  // Monotone: more order always means more of the fundamental and less of
  // everything above it. A non-monotone map would be unreadable by ear.
  let prevFirst = -1;
  let prevTop = 2;
  for (let i = 0; i <= 50; i++) {
    const amps = F.partialsForOrder(i / 50);
    assert.ok(amps[0] > prevFirst, "the fundamental only ever grows with order");
    assert.ok(amps[F.PARTIALS - 1] < prevTop, "and the top partial only ever fades");
    prevFirst = amps[0];
    prevTop = amps[F.PARTIALS - 1];
  }
  // The ends, exactly: one animal is one partial; a scattered sky is flat.
  assert.deepEqual(F.partialsForOrder(1), [1, 0, 0, 0, 0, 0], "one animal rings one partial");
  const flat = F.partialsForOrder(0);
  for (const a of flat) {
    assert.ok(Math.abs(a - 1 / Math.sqrt(F.PARTIALS)) < 1e-12, "a scattered sky is a flat stack");
  }
  // At full order the partials ARE the harmonic series — the case computable
  // by hand, and the calibration for everything above it.
  for (let k = 1; k <= F.PARTIALS; k++) {
    assert.ok(
      Math.abs(F.partialFreq(220, k, 1) - 220 * k) < 1e-9,
      `partial ${k} of one animal is exactly ${k}× the fundamental`,
    );
    assert.ok(
      F.partialFreq(220, k, 0) >= 220 * k,
      "disorder only ever stretches the series, never compresses it",
    );
  }
  assert.equal(F.orderFromPartials([0, 0]), null, "a silent stack names no order");
  assert.equal(F.orderFromPartials([1]), null, "and one partial alone is not an interval");
  assert.equal(F.orderFromPartialFreqs(0, 100), null, "nor is a frequency of nothing");
  // The call rate is bounded and monotone: chatter when scattered, one long
  // ring when gathered.
  assert.ok(F.callInterval(0) < F.callInterval(1), "a scattered flock calls more often");
  for (const o of [-3, 0, 0.5, 1, 9]) {
    const ms = F.callInterval(o);
    assert.ok(ms >= F.CALL_MIN_MS && ms <= F.CALL_MAX_MS, "the calling never runs away");
  }
}

// —— the seasons, and the whole loop closing ————————————————————
{
  const dirs = [0, 1, 2, 3].map(F.seasonGoal);
  for (const d of dirs) {
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9, "a heading is a unit vector");
  }
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const dot = dirs[i].x * dirs[j].x + dirs[i].y * dirs[j].y + dirs[i].z * dirs[j].z;
      assert.ok(dot < 0.99, `season ${i} and ${j} do not go the same way`);
    }
  }
  // The year wraps in both directions — three fingers may turn it forever.
  assert.deepEqual(F.seasonGoal(4), F.seasonGoal(0), "the year comes round");
  assert.deepEqual(F.seasonGoal(-1), F.seasonGoal(3), "and turns backwards too");
  assert.equal(F.seasonIndex(-5), 3, "any integer names a season");
  assert.equal(F.SEASON_LABELS.length, F.SEASONS, "every season has its word");
  // ...and the season actually moves the flock: against the same sky with no
  // season pulling at all, each heading carries it its own way.
  const travel = (g, pull) => {
    const st = F.seedFlock(0x5ea, 400);
    const before = F.centroid(st.pos, st.n);
    for (let i = 0; i < 120; i++) F.advanceFlock(st, params({ goal: g, goalPull: pull }), 1 / 60);
    const after = F.centroid(st.pos, st.n);
    return { x: after.x - before.x, y: after.y - before.y, z: after.z - before.z };
  };
  const unled = travel(F.seasonGoal(0), 0);
  for (let s = 0; s < 4; s++) {
    const g = F.seasonGoal(s);
    const d = travel(g, 6);
    const along = (d.x - unled.x) * g.x + (d.y - unled.y) * g.y + (d.z - unled.z) * g.z;
    assert.ok(along > 1, `in season ${s} the flock goes where the season points (${along})`);
  }
}

// —— and the whole chain: a flown flock's order is audible ——————————
// The end-to-end claim of the room, asserted once: fly a scattered sky under a
// strong alignment rule, and the partial stack you would hear at the end reads
// back to the order the sky actually has.
{
  const st = scramble(F.seedFlock(0x1ce, 600), 0xa9);
  for (let i = 0; i < st.n; i++) {
    st.pos[i * 3] *= 0.4;
    st.pos[i * 3 + 1] *= 0.4;
    st.pos[i * 3 + 2] *= 0.4;
  }
  const p = params({ separation: 0.6, alignment: 1.6, cohesion: 1 });
  let best = 0;
  for (let c = 0; c < 40; c++) {
    for (let i = 0; i < 30; i++) F.advanceFlock(st, p, 1 / 60);
    const order = F.orderParameter(st.vel, st.n);
    best = Math.max(best, order);
    // at every moment of the flight, the stack you would hear reads back
    const heard = F.orderFromPartials(F.partialsForOrder(order));
    assert.ok(Math.abs(heard - order) < 1e-9, `what you hear is what it is (${order})`);
  }
  assert.ok(best > 0.8, `the murmuration does form (best ${best})`);
}

// —— the aviary catalog: kinds, activities, places ————————————————
// The bug: a murmuration that forgot the meadow — no parrot on the tree,
// no duck on the pond — or a seed that does not cover the catalog.
{
  for (const need of [
    "parrot",
    "cockatiel",
    "falcon",
    "hawk",
    "duck",
    "chicken",
    "emu",
    "finch",
    "sparrow",
    "hummingbird",
    "red-ibis",
    "peacock",
    "bird-of-paradise",
  ]) {
    assert.ok(F.BIRD_KINDS.includes(need), `missing kind ${need}`);
    assert.ok(F.BIRD_SPECIES[need], `missing species ${need}`);
    assert.ok(F.BIRD_SPECIES[need].activities.length >= 1, `${need} needs activities`);
  }
  assert.equal(F.BIRD_KINDS.length, 13);

  const st = F.seedFlock(0xb17d, 400);
  assert.ok(F.catalogCovered(st), "a seeded flock covers the whole catalog");
  assert.equal(st.kindOf.length, st.n);
  assert.equal(st.activityOf.length, st.n);
  assert.equal(st.tint.length, st.n * 3);

  // Residents stay near their places under a short advance; air birds move.
  let resident = -1;
  for (let i = 0; i < st.n; i++) {
    if (!F.isAirActivity(F.ACTIVITIES[st.activityOf[i]])) {
      resident = i;
      break;
    }
  }
  assert.ok(resident >= 0, "the meadow has at least one resident");
  const rx0 = st.pos[resident * 3];
  const ry0 = st.pos[resident * 3 + 1];
  const rz0 = st.pos[resident * 3 + 2];
  for (let i = 0; i < 30; i++) F.advanceFlock(st, params(), 1 / 60);
  const rMove = Math.hypot(
    st.pos[resident * 3] - rx0,
    st.pos[resident * 3 + 1] - ry0,
    st.pos[resident * 3 + 2] - rz0,
  );
  assert.ok(rMove < 8, `a resident stays near its place (moved ${rMove})`);

  // Flush puts a perched/hopping bird into the air.
  const before = st.activityOf[resident];
  F.flushNear(st, { x: rx0, y: ry0, z: rz0 }, 12);
  assert.ok(
    F.isAirActivity(F.ACTIVITIES[st.activityOf[resident]]) || st.activityOf[resident] !== before,
    "flush changes a nearby bird's activity toward the air",
  );

  // Roost and launch are addressable by the hand.
  const roostIdx = F.roostNearest(st, { x: 0, y: 0, z: 0 });
  assert.ok(roostIdx >= 0 && roostIdx < st.n);
  const roostAct = F.ACTIVITIES[st.activityOf[roostIdx]];
  assert.ok(
    roostAct === "perch" || roostAct === "hop" || roostAct === "strut" || roostAct === "drink",
    `roost lands in a ground activity, got ${roostAct}`,
  );
  const launchIdx = F.launchNearest(st, { x: 0, y: 0, z: 0 }, { x: 1, y: 0.5, z: 0 }, 10);
  assert.ok(F.isAirActivity(F.ACTIVITIES[st.activityOf[launchIdx]]), "launch yields an air activity");
}

// —— the predator field: a real repulsion, not a scripted dodge ————
// The bug: a predator wired with the wrong sign (attracts instead of
// repels), or one so weak/narrow the flock never actually answers it — the
// evasion would then be decoration, exactly what the spec forbids.
{
  const st = F.seedFlock(0x9e4d, 240);
  F.stepFlock(st, params(), 0); // no-op guard: dt<=0 must not throw
  // Scramble to a coherent, centred sky first, then measure only birds that
  // start well inside the predator's reach.
  for (let i = 0; i < 30; i++) F.advanceFlock(st, params(), 1 / 60);
  const predator = { x: 0, y: 0, z: 0 };
  const near = [];
  for (let i = 0; i < st.n; i++) {
    const dx = st.pos[i * 3] - predator.x;
    const dy = st.pos[i * 3 + 1] - predator.y;
    const dz = st.pos[i * 3 + 2] - predator.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < F.PREDATOR_REACH * 0.6 && F.isAirActivity(F.ACTIVITIES[st.activityOf[i]])) near.push(i);
  }
  assert.ok(near.length > 0, "the seeded sky has birds inside the predator's reach to test");
  const d0 = near.map((i) => Math.hypot(
    st.pos[i * 3] - predator.x, st.pos[i * 3 + 1] - predator.y, st.pos[i * 3 + 2] - predator.z,
  ));
  const hunted = params({ predator, predatorStrength: 40 });
  for (let i = 0; i < 20; i++) F.advanceFlock(st, hunted, 1 / 60);
  const d1 = near.map((i) => Math.hypot(
    st.pos[i * 3] - predator.x, st.pos[i * 3 + 1] - predator.y, st.pos[i * 3 + 2] - predator.z,
  ));
  let fled = 0;
  for (let k = 0; k < near.length; k++) if (d1[k] > d0[k]) fled += 1;
  assert.ok(
    fled >= Math.ceil(near.length * 0.6),
    `a predator repels most nearby birds outward (${fled}/${near.length} fled)`,
  );
  // Outside the reach, the field must not act at all — a bird a world away
  // from the predator is untouched, which catches a reach that leaked global.
  const far = F.seedFlock(0x9e4d, 240);
  const untouched = params({ predator: { x: 900, y: 900, z: 900 }, predatorStrength: 40 });
  for (let i = 0; i < 20; i++) F.advanceFlock(far, untouched, 1 / 60);
  const plain = F.seedFlock(0x9e4d, 240);
  for (let i = 0; i < 20; i++) F.advanceFlock(plain, params(), 1 / 60);
  let maxDiff = 0;
  for (let i = 0; i < far.n * 3; i++) maxDiff = Math.max(maxDiff, Math.abs(far.pos[i] - plain.pos[i]));
  assert.ok(maxDiff < 1e-6, `a predator far outside PREDATOR_REACH must not act at all (diff ${maxDiff})`);
}

// —— the thermal: lift, bounded to its column ————————————————————
{
  const st = F.seedFlock(0x71a2, 120);
  for (let i = 0; i < st.n; i++) {
    // put everyone right in the thermal's column so the lift is unambiguous
    st.pos[i * 3] = (i % 5) - 2;
    st.pos[i * 3 + 2] = ((i * 3) % 5) - 2;
    st.pos[i * 3 + 1] = -2;
    st.activityOf[i] = F.activityIndex("flock");
  }
  const y0 = F.centroid(st.pos, st.n).y;
  const lifted = params({ thermal: { x: 0, y: 0, z: 0 }, thermalStrength: 6 });
  for (let i = 0; i < 40; i++) F.advanceFlock(st, lifted, 1 / 60);
  const y1 = F.centroid(st.pos, st.n).y;
  assert.ok(y1 > y0 + 0.5, `a thermal lifts the birds inside its column (${y0} -> ${y1})`);
}

// —— roostSeveral: a roost call lands a group, not a silent no-op ————
{
  const st = F.seedFlock(0x3c11, 300);
  for (let i = 0; i < 20; i++) F.advanceFlock(st, params(), 1 / 60);
  const before = st.n > 0 ? Array.from({ length: st.n }, (_, i) => F.ACTIVITIES[st.activityOf[i]]) : [];
  const landed = F.roostSeveral(st, { x: 0, y: 0, z: 0 }, 5);
  assert.equal(landed.length, 5, "roostSeveral lands exactly the count asked for");
  assert.equal(new Set(landed).size, 5, "roostSeveral never lands the same bird twice");
  let grounded = 0;
  for (const i of landed) if (!F.isAirActivity(F.ACTIVITIES[st.activityOf[i]])) grounded += 1;
  assert.equal(grounded, 5, "every called bird actually lands");
  void before;
}

console.log(
  "flock ok: order checked against the ring, the pair at cos(θ/2) and one animal; 60 Hz and 120 Hz landing every bird in the same place; alignment strictly ordering, cohesion strictly gathering, separation holding a floor, the wind blowing downwind, the sky closed under any wind, the order→harmonic map monotone, bounded and readable back to 1e-9; the aviary catalog (thirteen kinds) covers perch/drink/swim/hop/strut residents the hand can flush, roost and launch; the predator field repels nearby birds outward and never acts past its reach; the thermal lifts a column; and a roost call lands a named group at once",
);
