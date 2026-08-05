import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-skyline-ring — the pure-math half of the landmark ring.
 *
 * The factory in `city-skyline-ring.ts` builds four InstancedMeshes with
 * per-instance emissive shader hooks; the interesting FALSIFIABLE
 * behaviour is upstream of Three — the cap picker, the height envelope
 * (comfortably above the plot event tower), the enumerator's determinism
 * and near-first ordering, the annulus + harbour cutout inheritance from
 * the infill ring. A regression that put every landmark in one cell, or
 * pushed a cap-type weight to zero, would land here without a WebGL
 * context.
 */

// ── stubs ────────────────────────────────────────────────────────────────

const threeStub = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === "Color") {
        return class {
          constructor(x = 0) { this.value = x; }
          setRGB() { return this; }
        };
      }
      if (key === "Vector3") {
        return class {
          constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
          set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
        };
      }
      if (key === "Quaternion") {
        return class { setFromAxisAngle() { return this; } };
      }
      if (key === "Matrix4") {
        return class { compose() { return this; } };
      }
      if (key === "BufferAttribute" || key === "InstancedBufferAttribute") {
        return class {
          constructor() {}
          setUsage() { return this; }
        };
      }
      return function stub() {
        return new Proxy({}, {
          get() { return () => undefined; },
          set() { return true; },
        });
      };
    },
  },
);

const windowsStub = {
  emissiveIntensityForDay(f) {
    const wrapped = ((f % 1) + 1) % 1;
    return wrapped < 0.5 ? 0 : 1.6;
  },
};
const cameraStub = { CITY_HALF: 40 };

// city-skyline-ring imports from city-infill (constants + helpers + type).
// Load the real city-infill through the same ts loader so its pure surface
// is exercised inline — the modules share DEFAULT_HARBOUR, annulusContains,
// unitHash. Sharing them here means a break in one lands in both tests.
const infillMod = loadTsModule("src/lib/city-infill.ts", {
  requireMap: {
    three: threeStub,
    "@/lib/city-camera": cameraStub,
    "@/lib/city-windows": windowsStub,
  },
});

const skyMod = loadTsModule("src/lib/city-skyline-ring.ts", {
  requireMap: {
    three: threeStub,
    "@/lib/city-infill": infillMod,
    "@/lib/city-windows": windowsStub,
  },
});

const {
  SKYLINE_INNER_R,
  SKYLINE_OUTER_R,
  SKYLINE_CELL_M,
  SKYLINE_CELL_JITTER,
  SKYLINE_COUNT_HIGH,
  SKYLINE_COUNT_MEDIUM,
  SKYLINE_COUNT_LOW,
  SKYLINE_HEIGHT_MIN,
  SKYLINE_HEIGHT_MAX,
  SKYLINE_WIDTH_MIN,
  SKYLINE_WIDTH_MAX,
  SKYLINE_CAP_WEIGHTS,
  SKYLINE_CAP_HEIGHT_FRAC,
  SKYLINE_CAP_FOOTPRINT_FRAC,
  skylineCountForTier,
  pickCapForSeed,
  landmarkHeightForSeed,
  landmarkFootprintForSeed,
  landmarkYawForSeed,
  landmarkColorForSeed,
  capColorForSeed,
  landmarkEmitPhaseForSeed,
  enumerateSkylineRing,
} = skyMod;

// ── constants the brief pins ─────────────────────────────────────────────

assert.equal(SKYLINE_INNER_R, 90, "shares infill inner radius");
assert.equal(SKYLINE_OUTER_R, 500, "shares infill outer radius");
assert.ok(SKYLINE_CELL_M > 30, "landmark cell is coarser than the infill (18 m)");
assert.ok(SKYLINE_CELL_M < 80, "landmark cell not so coarse the ring goes empty");
assert.ok(SKYLINE_CELL_JITTER > 0 && SKYLINE_CELL_JITTER < 1, "jitter is a fraction");

assert.equal(SKYLINE_COUNT_HIGH, 80, "brief pins the high-tier landmark ring at 80");
assert.equal(SKYLINE_COUNT_MEDIUM, 40, "brief pins the mid tier at 40");
assert.equal(SKYLINE_COUNT_LOW, 0, "low tier disables the landmark ring");

assert.ok(SKYLINE_HEIGHT_MIN < SKYLINE_HEIGHT_MAX, "height envelope not inverted");
assert.ok(
  SKYLINE_HEIGHT_MIN > 20,
  "no landmark is a bungalow — every landmark punctuates the horizon",
);
assert.ok(
  SKYLINE_HEIGHT_MAX >= 60,
  "the tallest landmark reaches past the plot event tower (~50 m)",
);
assert.ok(
  SKYLINE_HEIGHT_MAX <= 80,
  "no landmark towers so high it fights the plot skyline",
);

assert.ok(SKYLINE_WIDTH_MIN < SKYLINE_WIDTH_MAX, "footprint envelope not inverted");

// ── cap weight ladder ────────────────────────────────────────────────────

{
  const total =
    SKYLINE_CAP_WEIGHTS.flat +
    SKYLINE_CAP_WEIGHTS.pitched +
    SKYLINE_CAP_WEIGHTS.water_tank +
    SKYLINE_CAP_WEIGHTS.spire;
  assert.ok(
    Math.abs(total - 1) < 1e-9,
    `cap weights sum to 1 (got ${total})`,
  );
  for (const cap of ["flat", "pitched", "water_tank", "spire"]) {
    assert.ok(
      SKYLINE_CAP_WEIGHTS[cap] > 0,
      `cap ${cap} carries non-zero probability`,
    );
  }
  // Flat should be the majority — landmarks are punctuation, not a
  // costume parade.
  assert.ok(
    SKYLINE_CAP_WEIGHTS.flat >= 0.30,
    `flat majority (got ${SKYLINE_CAP_WEIGHTS.flat})`,
  );
}

// ── cap fractional heights + footprints ──────────────────────────────────

assert.equal(SKYLINE_CAP_HEIGHT_FRAC.flat, 0, "flat cap has no height");
assert.equal(SKYLINE_CAP_FOOTPRINT_FRAC.flat, 0, "flat cap has no footprint");
for (const cap of ["pitched", "water_tank", "spire"]) {
  assert.ok(
    SKYLINE_CAP_HEIGHT_FRAC[cap] > 0,
    `${cap} cap has non-zero height`,
  );
  assert.ok(
    SKYLINE_CAP_HEIGHT_FRAC[cap] < 0.5,
    `${cap} cap doesn't dominate the building`,
  );
  assert.ok(
    SKYLINE_CAP_FOOTPRINT_FRAC[cap] > 0,
    `${cap} cap has a footprint`,
  );
  assert.ok(
    SKYLINE_CAP_FOOTPRINT_FRAC[cap] <= 1,
    `${cap} cap fits on the roof`,
  );
}
// Spires taper hardest — narrower footprint than water tanks or pitched.
assert.ok(
  SKYLINE_CAP_FOOTPRINT_FRAC.spire < SKYLINE_CAP_FOOTPRINT_FRAC.water_tank,
  "spire narrower than water tank",
);
// Spires reach highest.
assert.ok(
  SKYLINE_CAP_HEIGHT_FRAC.spire > SKYLINE_CAP_HEIGHT_FRAC.pitched,
  "spire taller than pitched gable",
);
assert.ok(
  SKYLINE_CAP_HEIGHT_FRAC.spire > SKYLINE_CAP_HEIGHT_FRAC.water_tank,
  "spire taller than water tank",
);

// ── skylineCountForTier ──────────────────────────────────────────────────

assert.equal(skylineCountForTier("high"), SKYLINE_COUNT_HIGH);
assert.equal(skylineCountForTier("medium"), SKYLINE_COUNT_MEDIUM);
assert.equal(skylineCountForTier("low"), SKYLINE_COUNT_LOW);
assert.equal(skylineCountForTier("sleep"), SKYLINE_COUNT_LOW, "sleep → 0");
assert.ok(
  skylineCountForTier("high") > skylineCountForTier("medium"),
  "high draws more than medium",
);

// ── pickCapForSeed determinism + coverage ────────────────────────────────

for (let i = 0; i < 8; i += 1) {
  assert.equal(pickCapForSeed(i), pickCapForSeed(i), "pickCapForSeed is pure");
}
{
  const counts = { flat: 0, pitched: 0, water_tank: 0, spire: 0 };
  const N = 4000;
  for (let seed = 0; seed < N; seed += 1) counts[pickCapForSeed(seed)] += 1;
  // Every cap type actually appears.
  for (const cap of ["flat", "pitched", "water_tank", "spire"]) {
    assert.ok(
      counts[cap] > 0,
      `cap ${cap} appears across ${N} seeds (got ${counts[cap]})`,
    );
  }
  // Roughly follows SKYLINE_CAP_WEIGHTS — within ±5 % is loose enough
  // to survive hash noise but tight enough to catch a regression where
  // a weight collapsed to a single bucket.
  for (const cap of ["flat", "pitched", "water_tank", "spire"]) {
    const observed = counts[cap] / N;
    const expected = SKYLINE_CAP_WEIGHTS[cap];
    assert.ok(
      Math.abs(observed - expected) < 0.05,
      `cap ${cap} observed ${observed.toFixed(3)} vs expected ${expected} (delta ${Math.abs(observed - expected).toFixed(3)})`,
    );
  }
}

// ── landmarkHeightForSeed ────────────────────────────────────────────────

for (let seed = 0; seed < 200; seed += 1) {
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    const h = landmarkHeightForSeed(seed, r);
    assert.ok(Number.isFinite(h), `finite at seed ${seed}, r ${r}`);
    assert.ok(h >= SKYLINE_HEIGHT_MIN - 1e-9, `≥ MIN at seed ${seed}, r ${r}, got ${h}`);
    assert.ok(h <= SKYLINE_HEIGHT_MAX + 1e-9, `≤ MAX at seed ${seed}, r ${r}, got ${h}`);
  }
}
assert.equal(landmarkHeightForSeed(42, 0.5), landmarkHeightForSeed(42, 0.5));
{
  // Distance mask: for a fixed seed the ceiling grows with r.
  let maxNear = -Infinity;
  let maxFar = -Infinity;
  for (let s = 0; s < 512; s += 1) {
    const near = landmarkHeightForSeed(s, 0);
    const far = landmarkHeightForSeed(s, 1);
    if (near > maxNear) maxNear = near;
    if (far > maxFar) maxFar = far;
  }
  assert.ok(maxFar > maxNear, `far ceiling exceeds near (${maxFar} > ${maxNear})`);
}
// Landmarks skew tall by construction — most seeds at r=1 should sit
// above the midpoint of the envelope. A regression toward the infill's
// low-bias curve would land here.
{
  const mid = (SKYLINE_HEIGHT_MIN + SKYLINE_HEIGHT_MAX) / 2;
  let above = 0;
  const N = 500;
  for (let s = 0; s < N; s += 1) {
    if (landmarkHeightForSeed(s, 1) > mid) above += 1;
  }
  assert.ok(
    above > N * 0.5,
    `landmarks skew tall (${above}/${N} above mid)`,
  );
}

// ── landmarkFootprintForSeed ─────────────────────────────────────────────

{
  const widths = new Set();
  const depths = new Set();
  for (let seed = 0; seed < 200; seed += 1) {
    const fp = landmarkFootprintForSeed(seed);
    assert.ok(fp.width >= SKYLINE_WIDTH_MIN - 1e-9);
    assert.ok(fp.width <= SKYLINE_WIDTH_MAX + 1e-9);
    assert.ok(fp.depth >= SKYLINE_WIDTH_MIN - 1e-9);
    assert.ok(fp.depth <= SKYLINE_WIDTH_MAX + 1e-9);
    widths.add(fp.width.toFixed(4));
    depths.add(fp.depth.toFixed(4));
  }
  assert.ok(widths.size > 100, `widths spread (${widths.size})`);
  assert.ok(depths.size > 100, `depths spread (${depths.size})`);
}

// ── landmarkYawForSeed ───────────────────────────────────────────────────

for (let seed = 0; seed < 100; seed += 1) {
  const y = landmarkYawForSeed(seed);
  assert.ok(Math.abs(y) <= Math.PI / 8 + 1e-9, `yaw within ±22.5° at seed ${seed}, got ${y}`);
}
assert.equal(landmarkYawForSeed(11), landmarkYawForSeed(11));

// ── colours ──────────────────────────────────────────────────────────────

for (const fn of [landmarkColorForSeed, capColorForSeed]) {
  const keys = new Set();
  for (let seed = 0; seed < 100; seed += 1) {
    const c = fn(seed);
    assert.equal(c.length, 3);
    for (const ch of c) assert.ok(ch >= 0 && ch <= 1);
    keys.add(`${c[0].toFixed(2)}/${c[1].toFixed(2)}/${c[2].toFixed(2)}`);
  }
  assert.ok(keys.size >= 4, `palette has variety (${keys.size} tones)`);
}

// ── emit phase ───────────────────────────────────────────────────────────

{
  let minP = Infinity;
  let maxP = -Infinity;
  for (let seed = 0; seed < 1000; seed += 1) {
    const p = landmarkEmitPhaseForSeed(seed);
    assert.ok(Number.isFinite(p));
    assert.ok(p >= 0.15 - 1e-9);
    assert.ok(p <= 1.8 + 1e-9);
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }
  assert.ok(minP < 0.5, `some landmarks hold dark (min ${minP})`);
  assert.ok(maxP > 1.3, `some landmarks peak warm (max ${maxP})`);
}

// ── enumerateSkylineRing ─────────────────────────────────────────────────

// Determinism.
{
  const a = enumerateSkylineRing(0x51de, SKYLINE_COUNT_HIGH);
  const b = enumerateSkylineRing(0x51de, SKYLINE_COUNT_HIGH);
  assert.equal(a.length, b.length, "same seed → same count");
  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i].x, b[i].x, `x match at ${i}`);
    assert.equal(a[i].z, b[i].z, `z match at ${i}`);
    assert.equal(a[i].cap, b[i].cap, `cap match at ${i}`);
    assert.equal(a[i].seed, b[i].seed, `seed match at ${i}`);
  }
}

const listA = enumerateSkylineRing(0x51de, SKYLINE_COUNT_HIGH);

// Different seed reshuffles the ring.
{
  const listC = enumerateSkylineRing(0xd51d, SKYLINE_COUNT_HIGH);
  let mismatches = 0;
  for (let i = 0; i < Math.min(listA.length, listC.length); i += 1) {
    if (listA[i].x !== listC[i].x || listA[i].z !== listC[i].z) mismatches += 1;
  }
  assert.ok(
    mismatches > Math.min(listA.length, listC.length) / 2,
    "changing the seed reshuffles the ring",
  );
}

// Every landmark inside annulus, outside harbour — use the same annulusContains
// the infill module exports.
const { annulusContains } = infillMod;
for (const lm of listA) {
  assert.ok(
    annulusContains(lm.x, lm.z),
    `landmark at (${lm.x.toFixed(1)}, ${lm.z.toFixed(1)}) inside the ring`,
  );
}

// Near-first ordering.
for (let i = 1; i < listA.length; i += 1) {
  const d0 = listA[i - 1].x ** 2 + listA[i - 1].z ** 2;
  const d1 = listA[i].x ** 2 + listA[i].z ** 2;
  assert.ok(d1 >= d0 - 1e-6, `list ordered by distance at index ${i}`);
}

// Capacity clamp — medium ≤ MEDIUM entries.
const listMed = enumerateSkylineRing(0x51de, SKYLINE_COUNT_MEDIUM);
assert.ok(listMed.length <= SKYLINE_COUNT_MEDIUM);
// Medium is a prefix of high.
for (let i = 0; i < listMed.length; i += 1) {
  assert.equal(listMed[i].x, listA[i].x, `prefix match at ${i}`);
  assert.equal(listMed[i].z, listA[i].z, `prefix match at ${i}`);
  assert.equal(listMed[i].cap, listA[i].cap, `prefix cap match at ${i}`);
}

// Capacity zero returns empty.
assert.equal(enumerateSkylineRing(0x51de, 0).length, 0);

// The ring fills its capacity meaningfully — a regression that made
// the cell too coarse or the annulus too thin would land here.
assert.ok(
  listA.length >= SKYLINE_COUNT_HIGH * 0.5,
  `ring fills at least half its capacity (${listA.length}/${SKYLINE_COUNT_HIGH})`,
);

// The ring covers the angular range — no dead sector.
{
  const buckets = new Array(8).fill(0);
  for (const lm of listA) {
    const a = Math.atan2(lm.z, lm.x);
    const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8;
    buckets[b] += 1;
  }
  for (let i = 0; i < 8; i += 1) {
    assert.ok(buckets[i] > 0, `angular sector ${i} has at least one landmark (${buckets[i]})`);
  }
}

// Cap distribution across the enumerated ring roughly follows the weight
// table — with only 80 samples we widen the tolerance to ±0.12.
{
  const counts = { flat: 0, pitched: 0, water_tank: 0, spire: 0 };
  for (const lm of listA) counts[lm.cap] += 1;
  for (const cap of ["flat", "pitched", "water_tank", "spire"]) {
    const observed = counts[cap] / listA.length;
    const expected = SKYLINE_CAP_WEIGHTS[cap];
    assert.ok(
      Math.abs(observed - expected) < 0.12,
      `cap ${cap} observed ${observed.toFixed(3)} vs expected ${expected}`,
    );
  }
}

// Every landmark carries a self-consistent descriptor — width, depth,
// height, colour, capColor, cap, emitPhase — none NaN, all in range.
for (const lm of listA) {
  assert.ok(lm.width >= SKYLINE_WIDTH_MIN - 1e-9);
  assert.ok(lm.width <= SKYLINE_WIDTH_MAX + 1e-9);
  assert.ok(lm.depth >= SKYLINE_WIDTH_MIN - 1e-9);
  assert.ok(lm.depth <= SKYLINE_WIDTH_MAX + 1e-9);
  assert.ok(lm.height >= SKYLINE_HEIGHT_MIN - 1e-9);
  assert.ok(lm.height <= SKYLINE_HEIGHT_MAX + 1e-9);
  assert.ok(["flat", "pitched", "water_tank", "spire"].includes(lm.cap));
  assert.ok(lm.emitPhase >= 0.15 - 1e-9 && lm.emitPhase <= 1.8 + 1e-9);
  for (const ch of lm.color) assert.ok(ch >= 0 && ch <= 1);
  for (const ch of lm.capColor) assert.ok(ch >= 0 && ch <= 1);
}

console.log("test-city-skyline-ring: ok");
