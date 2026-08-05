import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

// city-pedestrians.ts imports THREE and CITY_HALF from @/lib/city-camera;
// the pure exports the brief pins never touch three's runtime — they are
// number/vector math — so we shim three to opaque placeholders. The
// factory createCityPedestrians() touches THREE.InstancedMesh /
// BufferGeometry and is not exercised here.
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

const mod = loadTsModule("src/lib/city-pedestrians.ts", {
  requireMap: {
    three: threeShim,
  },
});

const {
  MAX_PEDESTRIANS,
  MIN_CAPACITY_PEDESTRIANS,
  WALK_STRIDE_NORM,
  PEDESTRIAN_HEIGHT_M,
  HEAD_DOT_NIGHT_GATE,
  ARC_RESET_JUMP_SQ,
  walkPhaseForArcLength,
  pedestrianYawForHeading,
  pedestrianColorFor,
  headDotEmissiveFor,
  accumulateArcLength,
} = mod;

// ─── constants the brief pins ────────────────────────────────────────────

assert.equal(MAX_PEDESTRIANS, 256, "brief pins the InstancedMesh cap at 256");
assert.equal(MIN_CAPACITY_PEDESTRIANS, 128, "brief pins the floor at 128");
assert.ok(WALK_STRIDE_NORM > 0 && WALK_STRIDE_NORM < 0.1, "stride is a small fraction of city width");
assert.ok(PEDESTRIAN_HEIGHT_M >= 1.6 && PEDESTRIAN_HEIGHT_M <= 2.0, "pedestrian height is human-scale");
assert.equal(HEAD_DOT_NIGHT_GATE, 0.35, "head-dot emissive gate matches lamp gate");
assert.ok(ARC_RESET_JUMP_SQ > 0, "the teleport-reset threshold is positive");

// ─── walkPhaseForArcLength ──────────────────────────────────────────────

// A brand-new pedestrian (arc=0) is in pose A.
assert.equal(walkPhaseForArcLength(0), 0, "arc=0 → pose A");
// Just before the half-stride boundary — still pose A.
assert.equal(walkPhaseForArcLength(WALK_STRIDE_NORM * 0.49), 0, "0.49 stride → pose A");
// Just past the half-stride — pose B.
assert.equal(walkPhaseForArcLength(WALK_STRIDE_NORM * 0.51), 1, "0.51 stride → pose B");
// Just before a full stride — still pose B.
assert.equal(walkPhaseForArcLength(WALK_STRIDE_NORM * 0.99), 1, "0.99 stride → pose B");
// Full stride wraps back to pose A.
assert.equal(walkPhaseForArcLength(WALK_STRIDE_NORM), 0, "one stride → back to pose A");
// Multi-stride wraps too.
assert.equal(walkPhaseForArcLength(WALK_STRIDE_NORM * 5.25), 0, "5.25 strides → pose A");
assert.equal(walkPhaseForArcLength(WALK_STRIDE_NORM * 5.75), 1, "5.75 strides → pose B");

// Nonsense input — pose A.
assert.equal(walkPhaseForArcLength(NaN), 0, "NaN arc → pose A");
assert.equal(walkPhaseForArcLength(-1), 0, "negative arc → pose A");
assert.equal(walkPhaseForArcLength(Infinity), 0, "Infinity arc → pose A");

// Determinism
assert.equal(
  walkPhaseForArcLength(WALK_STRIDE_NORM * 0.3),
  walkPhaseForArcLength(WALK_STRIDE_NORM * 0.3),
  "walkPhaseForArcLength is pure",
);

// The schedule is a square wave — each half-stride flips the pose.
// Sample at 0.25 stride offsets INSIDE each quarter so we never land
// exactly on a boundary (floats round unpredictably there).
let flips = 0;
let prev = walkPhaseForArcLength(WALK_STRIDE_NORM * 0.25);
for (let i = 1; i <= 40; i += 1) {
  const cur = walkPhaseForArcLength(WALK_STRIDE_NORM * (0.25 + i * 0.5));
  if (cur !== prev) flips += 1;
  prev = cur;
}
// 40 half-stride steps → 40 flips (each sample lands cleanly in the
// opposite half of the previous one). Allow a couple of drift.
assert.ok(flips >= 38, `walk cycle flips per half-stride, got ${flips}`);

// ─── pedestrianYawForHeading ────────────────────────────────────────────

// Heading 0 (moving +x in plot space) → world +X → yaw = atan2(1, 0) = π/2
assert.ok(
  Math.abs(pedestrianYawForHeading(0) - Math.PI / 2) < 1e-9,
  "heading=0 (east on 2D canvas) yields yaw=π/2 (facing world +X)",
);
// Heading π/2 (moving +y in plot space) → world +Z → yaw = atan2(0, 1) = 0
assert.ok(
  Math.abs(pedestrianYawForHeading(Math.PI / 2) - 0) < 1e-9,
  "heading=π/2 (south on 2D canvas) yields yaw=0 (facing world +Z)",
);
// Heading π (moving -x) → world -X → yaw = atan2(-1, 0) = -π/2
assert.ok(
  Math.abs(pedestrianYawForHeading(Math.PI) + Math.PI / 2) < 1e-9,
  "heading=π (west) yields yaw=-π/2",
);
// Nonsense input → yaw=0
assert.equal(pedestrianYawForHeading(NaN), 0, "NaN heading yields yaw=0");
assert.equal(pedestrianYawForHeading(Infinity), 0, "Infinity heading yields yaw=0");

// The identity yaw = π/2 - heading holds for arbitrary values.
for (let h = -Math.PI; h <= Math.PI; h += 0.31) {
  assert.ok(
    Math.abs(pedestrianYawForHeading(h) - (Math.PI / 2 - h)) < 1e-9,
    `yaw = π/2 - heading holds at h=${h.toFixed(2)}`,
  );
}

// ─── pedestrianColorFor ─────────────────────────────────────────────────

// Determinism: same seed + flags = same colour.
{
  const a = pedestrianColorFor(42, false, false);
  const b = pedestrianColorFor(42, false, false);
  assert.deepEqual(a, b, "colour is a pure function");
}

// Leaving overrides regular — a leaver is grey regardless of belonging.
{
  const leaverAsRegular = pedestrianColorFor(7, true, true);
  const leaverAsOrdinary = pedestrianColorFor(7, false, true);
  // Grey means R≈G≈B; regular's teal has G > R by ~0.3.
  assert.ok(Math.abs(leaverAsRegular[0] - leaverAsRegular[1]) < 0.05, "leaver reads grey (R≈G)");
  assert.ok(Math.abs(leaverAsRegular[1] - leaverAsRegular[2]) < 0.05, "leaver reads grey (G≈B)");
  assert.ok(Math.abs(leaverAsOrdinary[0] - leaverAsOrdinary[1]) < 0.05, "leaver reads grey regardless");
}

// Regular wears teal — G > R meaningfully.
{
  const reg = pedestrianColorFor(9, true, false);
  assert.ok(reg[1] > reg[0] + 0.2, "regular's coat has G ≫ R (teal)");
  assert.ok(reg[2] > reg[0] + 0.2, "regular's coat has B ≫ R (teal)");
}

// Ordinary settled: varies across seeds — at least three distinct palette
// hits in 32 samples so a crowd doesn't stripe-match.
{
  const seen = new Set();
  for (let s = 0; s < 32; s += 1) {
    const c = pedestrianColorFor(s, false, false);
    seen.add(c.map((n) => n.toFixed(3)).join(","));
  }
  assert.ok(seen.size >= 3, `ordinary coats vary across seeds (${seen.size} distinct in 32)`);
}

// Colours stay in [0,1] so the shader doesn't clamp weirdly.
for (let s = 0; s < 64; s += 1) {
  for (const [reg, leaving] of [[false, false], [true, false], [false, true]]) {
    const c = pedestrianColorFor(s, reg, leaving);
    for (const v of c) {
      assert.ok(v >= 0 && v <= 1, `colour channel in [0,1] for seed=${s} reg=${reg} leaving=${leaving}: got ${v}`);
    }
  }
}

// ─── headDotEmissiveFor ─────────────────────────────────────────────────

assert.equal(headDotEmissiveFor(0), 0, "day emits nothing");
assert.equal(headDotEmissiveFor(0.2), 0, "faint dusk emits nothing");
assert.equal(headDotEmissiveFor(0.34), 0, "just below the gate emits nothing");
assert.equal(headDotEmissiveFor(HEAD_DOT_NIGHT_GATE), 0, "exactly at the gate emits nothing");
assert.ok(headDotEmissiveFor(0.6) >= 0.999, "past the ramp top: fully lit");
assert.equal(headDotEmissiveFor(0.7), 1, "deep night is one");
assert.equal(headDotEmissiveFor(1), 1, "midnight is one");

// Monotone through the ramp
let prevEmit = 0;
for (let n = HEAD_DOT_NIGHT_GATE; n <= 0.61; n += 0.01) {
  const e = headDotEmissiveFor(n);
  assert.ok(e >= prevEmit - 1e-9, `emissive is monotone at n=${n.toFixed(2)}`);
  assert.ok(e >= 0 && e <= 1, `emissive in [0,1] at n=${n.toFixed(2)}`);
  prevEmit = e;
}
// Nonsense input
assert.equal(headDotEmissiveFor(-1), 0, "negative night is zero");
assert.equal(headDotEmissiveFor(NaN), 0, "NaN night is zero");
assert.equal(headDotEmissiveFor(2), 1, "past 1 is clamped to 1");

// ─── accumulateArcLength ────────────────────────────────────────────────

// Small step advances the counter by the euclidean distance.
{
  const next = accumulateArcLength(0, 0.001, 0.001);
  const expected = Math.sqrt(2) * 0.001;
  assert.ok(Math.abs(next - expected) < 1e-9, `arc-length adds euclidean distance: ${next}`);
}
// Zero-motion frame doesn't advance.
assert.equal(accumulateArcLength(0.005, 0, 0), 0.005, "zero-motion frame preserves the arc");

// Teleport-scale jump resets to zero — a pedestrian who just spawned
// begins in pose A.
assert.equal(accumulateArcLength(0.005, 0.5, 0.5), 0, "teleport-scale jump resets arc");
// A jump just under the threshold accumulates as normal.
{
  const small = Math.sqrt(ARC_RESET_JUMP_SQ) * 0.9;
  const next = accumulateArcLength(0, small, 0);
  assert.ok(next > 0 && next < Math.sqrt(ARC_RESET_JUMP_SQ), "sub-threshold jump accumulates");
}

// Bounded — the counter never runs past the wrap-around cap.
{
  let arc = 0;
  for (let i = 0; i < 10_000; i += 1) {
    arc = accumulateArcLength(arc, 0.001, 0);
  }
  assert.ok(Number.isFinite(arc), "arc stays finite over 10k frames");
  assert.ok(arc < WALK_STRIDE_NORM * 4 + 0.01, `arc stays bounded (got ${arc})`);
}

// NaN input → arc resets.
assert.equal(accumulateArcLength(0.005, NaN, 0), 0, "NaN delta resets the arc");

// ─── the brief's pins held together ────────────────────────────────────

// The two-pose walk cycle produces a legible leg swap: at any arc that
// walks the pedestrian across one whole city (0 → 1 in normalized units)
// the pose swaps at least ~180 times. That's the visual metronome of a
// walking body.
{
  let swaps = 0;
  let prev = walkPhaseForArcLength(0);
  for (let i = 1; i <= 1000; i += 1) {
    const arc = i * 0.001; // 0..1 across the whole city
    const cur = walkPhaseForArcLength(arc);
    if (cur !== prev) swaps += 1;
    prev = cur;
  }
  // 1000 arc units / WALK_STRIDE_NORM half-strides expected. With
  // WALK_STRIDE_NORM ≈ 0.011, that's ~180 swaps.
  const expectedSwaps = Math.floor(1 / (WALK_STRIDE_NORM * 0.5));
  assert.ok(
    Math.abs(swaps - expectedSwaps) < 5,
    `swap count near ${expectedSwaps} for one-city walk (got ${swaps})`,
  );
}

// Capacity range: 128–256 is what the brief pins.
assert.ok(MAX_PEDESTRIANS >= 128, "cap is at least the 128 the brief calls for");
assert.ok(MAX_PEDESTRIANS <= 256, "cap is at most the 256 the brief calls for");
assert.ok(MIN_CAPACITY_PEDESTRIANS >= 128, "floor honors the brief");

console.log("test-city-pedestrians: ok");
