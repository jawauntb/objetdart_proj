// The laws of /orb. Each assertion names a bug that would be invisible in a
// screenshot and obvious in the hand.

import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const {
  DISC_CAP,
  MIN_RADIUS,
  MAX_RADIUS,
  dwellRadius,
  separate,
  stepDisc,
  seasonPalette,
} = loadTsModule("src/lib/orbfield.ts");

const disc = (over = {}) => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 0.12,
  weight: 0.5,
  seed: 0.37,
  born: 1000,
  flare: 0,
  retire: 0,
  ...over,
});

const world = (over = {}) => ({
  wind: 0,
  gravity: 0,
  agitation: 0,
  aspect: 1.6,
  ...over,
});

// ——— the dwell curve: holding longer must keep deepening it ———————————
// The bug: a dwell that latches at its tier, so 900ms and 2400ms leave the
// same disc. The grammar names that exact failure; this is where it would hide.
{
  assert.ok(dwellRadius(0) >= MIN_RADIUS - 1e-9, "a disc is born at the floor, never smaller");
  let prev = dwellRadius(0);
  for (let ms = 100; ms <= 12000; ms += 100) {
    const r = dwellRadius(ms);
    assert.ok(r > prev, `dwellRadius must strictly increase (flat at ${ms}ms)`);
    assert.ok(r < MAX_RADIUS + 1e-9, "…and never cross the ceiling");
    prev = r;
  }
  assert.ok(
    dwellRadius(2400) - dwellRadius(900) > 0.02,
    "the difference between a 900ms hold and a 2400ms hold must be felt, not nominal",
  );
  assert.ok(dwellRadius(60000) > MAX_RADIUS - 0.001, "a very long hold saturates at the ceiling");
}

// ——— separation: they push each other apart, and the pair holds still ————
// The bug: a sign error that pulls overlapping discs together (they clump into
// one bright blob), or a push that moves the pair's centre (the whole field
// drifts off screen over a minute).
{
  const a = disc({ x: -0.05, radius: 0.14 });
  const b = disc({ x: 0.05, radius: 0.14, seed: 0.8 });
  const before = Math.abs(b.x - a.x);
  const centreBefore = (a.x + b.x) / 2;
  separate([a, b], 1 / 60);
  assert.ok(Math.abs(b.x - a.x) > before, "overlapping discs must move apart, not together");
  assert.ok(
    Math.abs((a.x + b.x) / 2 - centreBefore) < 1e-9,
    "equal discs separate symmetrically — the pair's centre may not drift",
  );

  // a big disc shoulders a small one aside, not the reverse
  const big = disc({ x: 0, radius: 0.3 });
  const small = disc({ x: 0.12, radius: 0.06, seed: 0.2 });
  separate([big, small], 1 / 60);
  assert.ok(
    Math.abs(small.x - 0.12) > Math.abs(big.x - 0),
    "the smaller disc must yield further than the larger one",
  );

  // discs that are already clear of each other are left completely alone
  const far = [disc({ x: -1 }), disc({ x: 1, seed: 0.9 })];
  const snapshot = far.map((d) => ({ ...d }));
  separate(far, 1 / 60);
  assert.deepEqual(far, snapshot, "separation must not touch discs that are not overlapping");

  // a retiring disc is a ghost: it neither pushes nor is pushed
  const alive = disc({ x: 0 });
  const ghost = disc({ x: 0.02, seed: 0.4, retire: 0.3 });
  separate([alive, ghost], 1 / 60);
  assert.equal(alive.x, 0, "a standing disc is not pushed by one that is blooming out");
  assert.equal(ghost.x, 0.02, "…and the blooming one is not pushed either");
}

// ——— drift: bounded, and a wall never adds energy ——————————————————
// The bug: a clamp instead of a reflection (discs stick to the wall and pile
// up), or a bounce that multiplies velocity (a disc that ends up in orbit).
{
  const w = world({ wind: 1 });
  const d = disc({ x: 0, y: 0, radius: 0.1 });
  for (let i = 0; i < 4000; i++) stepDisc(d, 1 / 60, w);
  const wallX = w.aspect - d.radius * 0.55;
  assert.ok(d.x <= wallX + 1e-9 && d.x >= -wallX - 1e-9, "a disc may never leave the frame");
  assert.ok(Math.abs(d.y) <= 1, "…in either axis");

  const fast = disc({ x: 1.4, vx: 3 });
  stepDisc(fast, 1 / 60, world({ aspect: 1.5 }));
  assert.ok(fast.vx < 0, "hitting the right wall reverses the disc");
  assert.ok(Math.abs(fast.vx) < 3, "…and it comes off slower than it went in");

  // with no forces at all, drag alone must bring a disc to rest
  const coasting = disc({ vx: 1, vy: -1 });
  for (let i = 0; i < 1200; i++) stepDisc(coasting, 1 / 60, world());
  assert.ok(Math.hypot(coasting.vx, coasting.vy) < 0.01, "viscous drag must actually settle a disc");

  // determinism: the same state vector and the same world step identically
  const one = disc({ seed: 0.61, born: 4321 });
  const two = disc({ seed: 0.61, born: 4321 });
  for (let i = 0; i < 200; i++) {
    stepDisc(one, 1 / 60, world({ wind: 0.3, gravity: 0.2 }));
    stepDisc(two, 1 / 60, world({ wind: 0.3, gravity: 0.2 }));
  }
  assert.deepEqual(one, two, "a disc is a deterministic function of its state vector and the world");

  // gravity is the vessel's pitch: tipping the phone forward must move them
  const still = disc();
  const pulled = disc();
  for (let i = 0; i < 60; i++) {
    stepDisc(still, 1 / 60, world());
    stepDisc(pulled, 1 / 60, world({ gravity: 1 }));
  }
  assert.ok(pulled.y < still.y, "gravity must actually pull the field down");
}

// ——— the season ring: continuous, and it closes ————————————————————
// The bug: a season that steps between palettes (three-finger twist becomes a
// switch, which the grammar forbids), or a ring that does not close so a full
// turn lands somewhere new.
{
  const zero = seasonPalette(0);
  const round = seasonPalette(1);
  assert.deepEqual(round, zero, "a full turn of the season closes the ring exactly");
  assert.deepEqual(seasonPalette(-0.25), seasonPalette(0.75), "rewinding is winding backwards");

  let maxJump = 0;
  let prev = seasonPalette(0);
  for (let s = 0.005; s <= 1.0001; s += 0.005) {
    const now = seasonPalette(s);
    for (const channel of ["a", "hot", "b", "glow"]) {
      for (let i = 0; i < 3; i++) {
        maxJump = Math.max(maxJump, Math.abs(now[channel][i] - prev[channel][i]));
      }
    }
    prev = now;
  }
  assert.ok(maxJump < 0.02, `the season must be continuous in colour (largest step ${maxJump})`);

  const quarter = seasonPalette(1 / 6); // halfway from season 0 to season 1
  assert.ok(
    quarter.a[0] < seasonPalette(0).a[0] + 1e-9 && quarter.a[2] > seasonPalette(0).a[2],
    "a half-step between palettes really is between them, not snapped to either",
  );
}

assert.ok(DISC_CAP >= 3 && MAX_RADIUS > MIN_RADIUS, "the field holds a population with room to grow");

console.log(
  `orbfield ok: dwell strictly deepens, ${DISC_CAP} discs separate without drifting the pair, ` +
    "walls reflect with loss, the season ring closes",
);
