import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

// city-traffic.ts imports THREE and CITY_HALF; the pure exports the brief
// pins never touch three's runtime — they're number/vector math — so we
// shim three to opaque placeholders. The factory createCityTraffic()
// touches THREE.InstancedMesh / DataTexture and is not exercised here.
const threeShim = new Proxy(
  {},
  {
    get() {
      return function stub() {
        return {};
      };
    },
  },
);

const mod = loadTsModule("src/lib/city-traffic.ts", {
  requireMap: {
    three: threeShim,
  },
});

const {
  CAR_COUNT,
  BOAT_COUNT,
  MAX_LAMPS,
  LAMP_SPACING_M,
  CAR_SPEED_MIN,
  CAR_SPEED_MAX,
  BOAT_SPEED_M_S,
  NIGHT_EMISSIVE_GATE,
  carSpeedFor,
  boatSpeedFor,
  nightEmissiveFor,
  lampCountForRoadLength,
  positionAlongRoad,
  roadYawFor,
  roadWorldLength,
} = mod;

// ─── constants the brief pins ────────────────────────────────────────────

assert.equal(CAR_COUNT, 24, "brief pins the fleet at 24 cars");
assert.equal(BOAT_COUNT, 6, "brief pins the harbour at 6 boats");
assert.equal(MAX_LAMPS, 256, "MAX_LAMPS is the capacity, not the used count");
assert.equal(LAMP_SPACING_M, 8, "lamp posts every 8 metres, per the London kerb");
assert.equal(CAR_SPEED_MIN, 4, "brief pins the car speed floor at 4 m/s");
assert.equal(CAR_SPEED_MAX, 6, "brief pins the car speed ceiling at 6 m/s");
assert.equal(BOAT_SPEED_M_S, 1.0, "brief pins the boat speed near 1 m/s");
assert.equal(NIGHT_EMISSIVE_GATE, 0.3, "brief pins the emissive gate at night>0.3");

// ─── carSpeedFor ────────────────────────────────────────────────────────

const carSpeeds = new Set();
for (let seed = 0; seed < 128; seed += 1) {
  const s = carSpeedFor(seed);
  assert.ok(Number.isFinite(s), `car speed is finite for seed ${seed}`);
  assert.ok(
    s >= CAR_SPEED_MIN && s <= CAR_SPEED_MAX,
    `car speed within [${CAR_SPEED_MIN}, ${CAR_SPEED_MAX}] for seed ${seed}, got ${s}`,
  );
  carSpeeds.add(s.toFixed(4));
}
assert.ok(carSpeeds.size > 32, `car speeds vary across seeds (${carSpeeds.size} distinct in 128)`);

// Determinism
assert.equal(carSpeedFor(42), carSpeedFor(42), "carSpeedFor is a pure function");
assert.equal(carSpeedFor(0), carSpeedFor(0), "carSpeedFor(0) is stable");

// ─── boatSpeedFor ───────────────────────────────────────────────────────

for (let seed = 0; seed < 64; seed += 1) {
  const s = boatSpeedFor(seed);
  assert.ok(Number.isFinite(s), `boat speed is finite for seed ${seed}`);
  assert.ok(
    s > 0.5 && s < 1.5,
    `boat speed stays near ${BOAT_SPEED_M_S} for seed ${seed}, got ${s}`,
  );
}
// Determinism
assert.equal(boatSpeedFor(7), boatSpeedFor(7), "boatSpeedFor is a pure function");

// ─── nightEmissiveFor ───────────────────────────────────────────────────

// Below the gate: zero.
assert.equal(nightEmissiveFor(0), 0, "day emits nothing");
assert.equal(nightEmissiveFor(0.1), 0, "faint dusk emits nothing");
assert.equal(nightEmissiveFor(0.29), 0, "just below the gate emits nothing");
assert.equal(nightEmissiveFor(NIGHT_EMISSIVE_GATE), 0, "exactly at the gate emits nothing");

// At and above the ramp top: one.
assert.ok(nightEmissiveFor(0.55) >= 0.999, "past the ramp top: fully lit");
assert.equal(nightEmissiveFor(0.7), 1, "deep night is one");
assert.equal(nightEmissiveFor(1), 1, "midnight is one");

// Monotone through the ramp
let prev = 0;
for (let n = 0.3; n <= 0.56; n += 0.01) {
  const e = nightEmissiveFor(n);
  assert.ok(e >= prev - 1e-9, `emissive is monotone at n=${n.toFixed(2)}`);
  assert.ok(e >= 0 && e <= 1, `emissive in [0,1] at n=${n.toFixed(2)}`);
  prev = e;
}

// Nonsense input
assert.equal(nightEmissiveFor(-1), 0, "negative night is zero");
assert.equal(nightEmissiveFor(NaN), 0, "NaN night is zero");
assert.equal(nightEmissiveFor(2), 1, "past 1 is clamped to 1");

// ─── lampCountForRoadLength ─────────────────────────────────────────────

// The brief's pinning: LAMP_SPACING_M=8 means "one lamp every 8 m"
assert.equal(lampCountForRoadLength(0), 1, "empty road still shows one lamp");
assert.equal(lampCountForRoadLength(1), 1, "sub-spacing road gets one lamp");
assert.equal(lampCountForRoadLength(8), 2, "one spacing → two lamps (endpoints)");
assert.equal(lampCountForRoadLength(16), 3, "two spacings → three lamps");
assert.equal(lampCountForRoadLength(24), 4, "three spacings → four lamps");
assert.equal(lampCountForRoadLength(80), 11, "ten spacings → eleven lamps");
// Runaway clamp
assert.ok(
  lampCountForRoadLength(10_000) <= 24,
  "a pathologically long road is clamped to 24 lamps per kerb",
);
// Bad input
assert.equal(lampCountForRoadLength(-5), 1, "negative length still shows one lamp");
assert.equal(lampCountForRoadLength(NaN), 1, "NaN length still shows one lamp");

// ─── positionAlongRoad ──────────────────────────────────────────────────

const road = { x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.7 };

let p = positionAlongRoad(road, 0);
assert.ok(Math.abs(p.nx - 0.2) < 1e-9, "t=0 lands at road.x1");
assert.ok(Math.abs(p.ny - 0.3) < 1e-9, "t=0 lands at road.y1");
p = positionAlongRoad(road, 1);
// At t=1 the mod wraps to 0
assert.ok(Math.abs(p.nx - 0.2) < 1e-9, "t=1 wraps to road.x1");
p = positionAlongRoad(road, 0.5);
assert.ok(Math.abs(p.nx - 0.5) < 1e-9, "t=0.5 is the midpoint");
assert.ok(Math.abs(p.ny - 0.5) < 1e-9, "t=0.5 is the midpoint");
// Wrap-around
p = positionAlongRoad(road, 1.25);
assert.ok(Math.abs(p.nx - (0.2 + 0.25 * 0.6)) < 1e-9, "t=1.25 wraps to t=0.25");
// Negative wrap
p = positionAlongRoad(road, -0.25);
assert.ok(Math.abs(p.nx - (0.2 + 0.75 * 0.6)) < 1e-9, "t=-0.25 wraps to t=0.75");

// ─── roadYawFor ─────────────────────────────────────────────────────────

// East-going road (increasing x, constant y) → yaw = π/2 (world +X)
const eastRoad = { x1: 0.0, y1: 0.5, x2: 1.0, y2: 0.5 };
assert.ok(Math.abs(roadYawFor(eastRoad) - Math.PI / 2) < 1e-9, "east-going road yaw is +π/2");

// North-going road (constant x, decreasing y in city-normalized coords maps
// to decreasing z, so the world direction is -z → yaw=π)
const southRoad = { x1: 0.5, y1: 0.0, x2: 0.5, y2: 1.0 };
assert.ok(Math.abs(roadYawFor(southRoad) - 0) < 1e-9, "south-going road (+z) yaw is 0");

// ─── roadWorldLength ────────────────────────────────────────────────────

// A road spanning the whole normalized field: (0,0) → (1,0) is 80 m
// (CITY_HALF=40 → total width 80).
assert.ok(
  Math.abs(roadWorldLength({ x1: 0, y1: 0, x2: 1, y2: 0 }) - 80) < 1e-9,
  "full-field horizontal road is 80 world metres",
);
// Diagonal
const diag = roadWorldLength({ x1: 0, y1: 0, x2: 1, y2: 1 });
assert.ok(
  Math.abs(diag - Math.sqrt(2) * 80) < 1e-6,
  "full-field diagonal road is sqrt(2)*80 world metres",
);
// Zero-length
assert.equal(
  roadWorldLength({ x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 }),
  0,
  "zero-length road reports zero",
);

// ─── the four brief pins, held together ─────────────────────────────────

// per-instance count (cars = 24, boats = 6, lamps ≤ MAX_LAMPS=256)
assert.equal(CAR_COUNT, 24);
assert.equal(BOAT_COUNT, 6);
assert.ok(MAX_LAMPS >= 128, "MAX_LAMPS at least 128 as the brief calls for");

// speed range (car in [4,6], boat near 1)
{
  let minSpeed = Infinity;
  let maxSpeed = -Infinity;
  for (let seed = 0; seed < 512; seed += 1) {
    const s = carSpeedFor(seed);
    if (s < minSpeed) minSpeed = s;
    if (s > maxSpeed) maxSpeed = s;
  }
  assert.ok(minSpeed >= CAR_SPEED_MIN, `min speed ≥ ${CAR_SPEED_MIN}`);
  assert.ok(maxSpeed <= CAR_SPEED_MAX, `max speed ≤ ${CAR_SPEED_MAX}`);
  // The set covers most of the range
  assert.ok(
    maxSpeed - minSpeed > (CAR_SPEED_MAX - CAR_SPEED_MIN) * 0.75,
    `sampled speeds cover >75% of the pinned range: [${minSpeed}, ${maxSpeed}]`,
  );
}

// emissive gate holds at 0.3
assert.equal(nightEmissiveFor(0.3), 0, "the gate is exactly 0.3");
assert.ok(nightEmissiveFor(0.31) > 0, "just past the gate lifts off zero");

console.log("test-city-traffic: ok");
