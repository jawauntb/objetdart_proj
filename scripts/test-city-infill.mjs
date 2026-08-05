import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-infill — the pure-math half of the horizon infill ring.
 *
 * The factory in city-infill.ts is a Three.js scene attach: it builds an
 * InstancedMesh with an emissive shader hook, one big BufferAttribute for
 * per-instance emit-phase, and shares the world scene's fog / env map.
 * The interesting FALSIFIABLE behaviour is upstream of Three — the
 * annulus geometry, the enumerator's determinism and near-first ordering,
 * the height envelope and its distance mask, the emit-phase curve — and
 * that is what these tests pin.
 *
 * A regression like "the ring is now marching into the harbour" or
 * "the near instances are all short and the far ones are all tall"
 * would land here without a WebGL context.
 */

const threeStub = new Proxy(
  {},
  {
    get(_target, key) {
      // Structural stubs for the small handful of classes the factory
      // touches. All of them are noop constructors — we don't exercise
      // the factory from this test.
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
      // Anything else — geometries, materials, meshes, buffers — gets a
      // shape-agnostic stub that swallows setters and returns itself.
      return function stub() {
        return new Proxy({}, {
          get() { return () => undefined; },
          set() { return true; },
        });
      };
    },
  },
);

const cameraStub = { CITY_HALF: 40 };
const windowsStub = {
  emissiveIntensityForDay(f) {
    // The real curve peaks at 1.6 at midnight, 0 at noon; here we
    // only need a stable numeric identity so tests that reach the
    // factory don't crash. Anything continuous will do.
    const wrapped = ((f % 1) + 1) % 1;
    return wrapped < 0.5 ? 0 : 1.6;
  },
};

const mod = loadTsModule("src/lib/city-infill.ts", {
  requireMap: {
    three: threeStub,
    "@/lib/city-camera": cameraStub,
    "@/lib/city-windows": windowsStub,
  },
});

const {
  INFILL_INNER_R,
  INFILL_OUTER_R,
  INFILL_CELL_M,
  INFILL_CELL_JITTER,
  INFILL_COUNT_HIGH,
  INFILL_COUNT_MEDIUM,
  INFILL_COUNT_LOW,
  INFILL_HEIGHT_MIN,
  INFILL_HEIGHT_MAX,
  INFILL_WIDTH_MIN,
  INFILL_WIDTH_MAX,
  DEFAULT_HARBOUR,
  unitHash,
  infillCountForTier,
  annulusContains,
  heightForSeed,
  footprintForSeed,
  yawForSeed,
  colorForSeed,
  emitPhaseForSeed,
  enumerateInfill,
} = mod;

// ─── constants the brief pins ────────────────────────────────────────────

assert.equal(INFILL_INNER_R, 90, "inner radius sits past harbour + settlement");
assert.equal(INFILL_OUTER_R, 500, "outer radius extends past the FogExp2 knee");
assert.ok(INFILL_OUTER_R > INFILL_INNER_R, "outer must be > inner");
assert.ok(INFILL_OUTER_R - INFILL_INNER_R > 200, "annulus is deep enough to matter");

assert.equal(INFILL_COUNT_HIGH, 600, "brief pins the high-tier ring at 600");
assert.equal(INFILL_COUNT_MEDIUM, 300, "brief pins the mid-tier ring at 300");
assert.equal(INFILL_COUNT_LOW, 0, "brief pins low-tier disabled");

assert.ok(INFILL_CELL_M > 0 && INFILL_CELL_M < 40, "cell size stays sub-block");
assert.ok(INFILL_CELL_JITTER > 0 && INFILL_CELL_JITTER < 1, "jitter is a unit fraction");

// Height envelope pins the "no infill towers over an event tower" invariant.
assert.ok(INFILL_HEIGHT_MIN < INFILL_HEIGHT_MAX, "height envelope not inverted");
assert.ok(INFILL_HEIGHT_MAX <= 50, "no ring building overtops the plot event tower");
assert.ok(INFILL_HEIGHT_MIN >= 4, "no ring building is a bump");

assert.ok(INFILL_WIDTH_MIN < INFILL_WIDTH_MAX, "footprint envelope not inverted");

// ─── infillCountForTier ─────────────────────────────────────────────────

assert.equal(infillCountForTier("high"), INFILL_COUNT_HIGH, "high → high count");
assert.equal(infillCountForTier("medium"), INFILL_COUNT_MEDIUM, "medium → medium");
assert.equal(infillCountForTier("low"), INFILL_COUNT_LOW, "low → 0");
assert.equal(infillCountForTier("sleep"), INFILL_COUNT_LOW, "sleep → 0 (same as low)");
// Ordering monotonicity — a regression that scrambled the ladder would land here.
assert.ok(
  infillCountForTier("high") > infillCountForTier("medium"),
  "high draws more than medium",
);
assert.ok(
  infillCountForTier("medium") > infillCountForTier("low"),
  "medium draws more than low",
);

// ─── annulusContains ────────────────────────────────────────────────────

// Origin: inside the plot disk, not in the ring.
assert.equal(annulusContains(0, 0), false, "the origin is inside the inner disk");
// Just outside inner: in the ring.
assert.equal(annulusContains(INFILL_INNER_R + 10, 0), true, "10 m past inner is in the ring");
assert.equal(annulusContains(-(INFILL_INNER_R + 10), 0), true, "and on the other side");
// Just inside outer: in the ring.
assert.equal(annulusContains(INFILL_OUTER_R - 5, 0), true, "5 m short of outer is in the ring");
// Past outer: out.
assert.equal(annulusContains(INFILL_OUTER_R + 10, 0), false, "past outer falls off");
// Just inside the inner boundary: excluded (r² < inner² is the strict test).
assert.equal(annulusContains(INFILL_INNER_R - 1, 0), false, "just inside inner is excluded");

// Harbour cutout — the default harbour sits at centre z=50, half-depth
// 16, so its rectangle lies entirely inside the inner disk (r < 90) and
// never intersects the default annulus. That's *by design*: the cutout
// is a defensive filter so a caller who pushes the inner radius down
// (or shifts the harbour further out) still keeps the ring off the
// water. To exercise the cutout as a live behaviour, we shrink the
// inner radius so the harbour rect now overlaps the ring.
{
  const smallInner = 20; // pulls the ring right up to the plot disk
  // A point at the harbour centre: past smallInner radially, but
  // inside the harbour rectangle → rejected by the cutout.
  assert.equal(
    annulusContains(0, DEFAULT_HARBOUR.centerZ, DEFAULT_HARBOUR, smallInner),
    false,
    "with a small inner radius, the harbour rect rejects the centre",
  );
  // Same z, but outside the harbour halfWidth → kept.
  assert.equal(
    annulusContains(DEFAULT_HARBOUR.halfWidth + 5, DEFAULT_HARBOUR.centerZ, DEFAULT_HARBOUR, smallInner),
    true,
    "outside halfWidth of the harbour, the ring keeps the point",
  );
  // Same x, but past the harbour depth → kept.
  const pastHarbourZ = DEFAULT_HARBOUR.centerZ + DEFAULT_HARBOUR.depth * 0.5 + 5;
  assert.equal(
    annulusContains(0, pastHarbourZ, DEFAULT_HARBOUR, smallInner),
    true,
    "past the harbour depth, the ring keeps the point",
  );
}

// ─── unitHash determinism ───────────────────────────────────────────────

for (let i = 0; i < 8; i += 1) {
  assert.equal(unitHash(i, 0x1234), unitHash(i, 0x1234), "unitHash is pure");
}
const distinct = new Set();
for (let i = 0; i < 128; i += 1) distinct.add(unitHash(i, 0x7e).toFixed(6));
assert.ok(distinct.size > 100, `unitHash spreads (${distinct.size}/128 distinct)`);

// ─── heightForSeed ──────────────────────────────────────────────────────

// Range envelope holds across seeds and radial fractions.
for (let seed = 0; seed < 200; seed += 1) {
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    const h = heightForSeed(seed, r);
    assert.ok(Number.isFinite(h), `height finite for seed ${seed}, r ${r}`);
    assert.ok(h >= INFILL_HEIGHT_MIN - 1e-9, `height ≥ MIN at seed ${seed}, r ${r}, got ${h}`);
    assert.ok(h <= INFILL_HEIGHT_MAX + 1e-9, `height ≤ MAX at seed ${seed}, r ${r}, got ${h}`);
  }
}
// Determinism.
assert.equal(heightForSeed(42, 0.5), heightForSeed(42, 0.5), "heightForSeed pure");
// Distance mask: for a fixed seed, the ceiling grows with r. This is
// the invariant that keeps the plot's event tower the visible peak.
{
  const seed = 0xabc123;
  // Pick a seed whose base draw is near the top of its normalised
  // range — we want to sample the ceiling, not the floor. Try a
  // handful and use the max delta.
  let maxNear = -Infinity;
  let maxFar = -Infinity;
  for (let s = 0; s < 256; s += 1) {
    const near = heightForSeed(s, 0);
    const far = heightForSeed(s, 1);
    if (near > maxNear) maxNear = near;
    if (far > maxFar) maxFar = far;
  }
  assert.ok(
    maxFar > maxNear,
    `far-edge ceiling exceeds inner-edge ceiling (far ${maxFar}, near ${maxNear})`,
  );
}
// Nonsense inputs are clamped.
assert.ok(heightForSeed(1, -5) >= INFILL_HEIGHT_MIN, "negative r clamps to 0");
assert.ok(heightForSeed(1, 99) <= INFILL_HEIGHT_MAX + 1e-9, "huge r clamps to 1");

// ─── footprintForSeed ───────────────────────────────────────────────────

const fpWidths = new Set();
const fpDepths = new Set();
for (let seed = 0; seed < 200; seed += 1) {
  const fp = footprintForSeed(seed);
  assert.ok(fp.width >= INFILL_WIDTH_MIN - 1e-9, `width ≥ MIN at seed ${seed}`);
  assert.ok(fp.width <= INFILL_WIDTH_MAX + 1e-9, `width ≤ MAX at seed ${seed}`);
  assert.ok(fp.depth >= INFILL_WIDTH_MIN - 1e-9, `depth ≥ MIN at seed ${seed}`);
  assert.ok(fp.depth <= INFILL_WIDTH_MAX + 1e-9, `depth ≤ MAX at seed ${seed}`);
  fpWidths.add(fp.width.toFixed(4));
  fpDepths.add(fp.depth.toFixed(4));
}
assert.ok(fpWidths.size > 100, `footprint widths spread across seeds (${fpWidths.size})`);
assert.ok(fpDepths.size > 100, `footprint depths spread across seeds (${fpDepths.size})`);

// ─── yawForSeed ─────────────────────────────────────────────────────────

for (let seed = 0; seed < 100; seed += 1) {
  const y = yawForSeed(seed);
  assert.ok(Math.abs(y) <= Math.PI / 4 + 1e-9, `yaw stays in ±45° at seed ${seed}, got ${y}`);
}
assert.equal(yawForSeed(11), yawForSeed(11), "yawForSeed pure");

// ─── colorForSeed ───────────────────────────────────────────────────────

for (let seed = 0; seed < 100; seed += 1) {
  const c = colorForSeed(seed);
  assert.equal(c.length, 3, "colour has 3 channels");
  for (const ch of c) {
    assert.ok(ch >= 0 && ch <= 1, `channel in [0,1] at seed ${seed}, got ${ch}`);
  }
}
// Distinct palette entries appear across seeds.
const colorKeys = new Set();
for (let seed = 0; seed < 200; seed += 1) {
  const c = colorForSeed(seed);
  colorKeys.add(`${c[0].toFixed(2)}/${c[1].toFixed(2)}/${c[2].toFixed(2)}`);
}
assert.ok(colorKeys.size >= 5, `colour palette covers at least 5 tones (${colorKeys.size})`);

// ─── emitPhaseForSeed ───────────────────────────────────────────────────

let minPhase = Infinity;
let maxPhase = -Infinity;
for (let seed = 0; seed < 1000; seed += 1) {
  const p = emitPhaseForSeed(seed);
  assert.ok(Number.isFinite(p), `emit phase finite at seed ${seed}`);
  assert.ok(p >= 0.15 - 1e-9, `emit phase ≥ 0.15 at seed ${seed}, got ${p}`);
  assert.ok(p <= 1.8 + 1e-9, `emit phase ≤ 1.8 at seed ${seed}, got ${p}`);
  if (p < minPhase) minPhase = p;
  if (p > maxPhase) maxPhase = p;
}
// The distribution actually reaches both ends of the intended range —
// a regression that pinned emit to a constant would land here.
assert.ok(minPhase < 0.5, `some infill sits dark at dusk (min ${minPhase})`);
assert.ok(maxPhase > 1.3, `some infill peaks warm at dusk (max ${maxPhase})`);
assert.equal(emitPhaseForSeed(7), emitPhaseForSeed(7), "emitPhaseForSeed pure");

// ─── enumerateInfill ────────────────────────────────────────────────────

// Determinism: same seed produces the same list.
const listA = enumerateInfill(0xc17c, INFILL_COUNT_HIGH);
const listB = enumerateInfill(0xc17c, INFILL_COUNT_HIGH);
assert.equal(listA.length, listB.length, "same seed → same count");
for (let i = 0; i < listA.length; i += 1) {
  assert.equal(listA[i].x, listB[i].x, `same seed → same x at ${i}`);
  assert.equal(listA[i].z, listB[i].z, `same seed → same z at ${i}`);
  assert.equal(listA[i].seed, listB[i].seed, `same seed → same instance seed at ${i}`);
}

// Different seed → different list (allow overlap but not identical).
const listC = enumerateInfill(0xd17c, INFILL_COUNT_HIGH);
let mismatches = 0;
for (let i = 0; i < Math.min(listA.length, listC.length); i += 1) {
  if (listA[i].x !== listC[i].x || listA[i].z !== listC[i].z) mismatches += 1;
}
assert.ok(mismatches > listA.length / 2, "changing the seed reshuffles the ring");

// Every instance sits inside the annulus and outside the harbour.
for (const inst of listA) {
  assert.ok(
    annulusContains(inst.x, inst.z),
    `instance at (${inst.x.toFixed(1)}, ${inst.z.toFixed(1)}) is inside the annulus`,
  );
}

// Near-first ordering — the visitor's eye is the origin, and dropping
// the tail lowers the count without pulling from the near ring first.
for (let i = 1; i < listA.length; i += 1) {
  const d0 = listA[i - 1].x ** 2 + listA[i - 1].z ** 2;
  const d1 = listA[i].x ** 2 + listA[i].z ** 2;
  assert.ok(d1 >= d0 - 1e-6, `list ordered by distance at index ${i}`);
}

// Capacity clamp — asking for MEDIUM returns at most MEDIUM entries.
const listMedium = enumerateInfill(0xc17c, INFILL_COUNT_MEDIUM);
assert.ok(
  listMedium.length <= INFILL_COUNT_MEDIUM,
  `medium tier respects the cap (${listMedium.length} ≤ ${INFILL_COUNT_MEDIUM})`,
);
// The medium list is a prefix of the high list — the near-first
// ordering means lowering the tier drops the *tail*, not a random
// subset.
for (let i = 0; i < listMedium.length; i += 1) {
  assert.equal(listMedium[i].x, listA[i].x, `medium prefix matches high at ${i}`);
  assert.equal(listMedium[i].z, listA[i].z, `medium prefix matches high at ${i}`);
}

// Capacity zero returns an empty list.
assert.equal(enumerateInfill(0xc17c, 0).length, 0, "capacity 0 returns empty list");

// The ring is dense enough that at high tier we actually fill it —
// a regression that made the annulus too thin, or the cell size too
// large, would land here.
assert.ok(
  listA.length >= INFILL_COUNT_HIGH * 0.5,
  `high-tier ring fills at least half its capacity (${listA.length}/${INFILL_COUNT_HIGH})`,
);

// The ring covers the full angular range — no dead sector.
{
  const buckets = new Array(8).fill(0);
  for (const inst of listA) {
    const a = Math.atan2(inst.z, inst.x); // [-π, π]
    const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8;
    buckets[b] += 1;
  }
  // Some sector may run into the harbour cutout — the buckets
  // covering the harbour direction (positive z, roughly bucket 6) will
  // be light. But every bucket should carry at least *some* buildings.
  for (let i = 0; i < 8; i += 1) {
    assert.ok(buckets[i] > 0, `angular sector ${i} has at least one building (${buckets[i]})`);
  }
}

console.log("test-city-infill: ok");
