import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-shadows — the pure-math half of the three-cascade sun.
 *
 * The DirectionalLight itself only comes alive against a real WebGL
 * context; this test does not render. It pins the invariants a
 * regression would drift:
 *
 *   CSM_CASCADE_COUNT         — 3 (near/mid/far)
 *   CSM_CASCADE_RADII         — [40, 250, 2000] m half-frustum
 *   CSM_CASCADE_SHADOW_RADII  — [1.5, 3.0, 6.0] texel PCSS approximation
 *   CSM_CASCADE_NORMAL_BIAS   — [0.02, 0.08, 0.30] scaled to texel size
 *   CSM_CASCADE_BIAS          — [-0.00005, -0.0002, -0.001] shadow acne offset
 *   cascadeMapSizeForTier     — 4096 / 2048 / 1024 / 0 across the tier ladder
 *   cascade*For(index)        — clamp accessors that never return undefined
 *   createCitySun             — smoke check that the light stack is wired
 *
 * A regression that tightened the far cascade to 500 m would drop the
 * outer ring's shadows. A regression that widened the near cascade past
 * 60 m would dither pedestrian shadows. A regression that flattened the
 * per-cascade radius to the same value would revert the "3-cascade
 * blend" into a single soft radius. The test names each so any drift
 * shows up before it hits the frame.
 */

// Stubs — the module imports three but the pure functions never
// instantiate any of these. The Three.js constructors are exercised
// in createCitySun below, so we mirror only the surface those calls
// touch (DirectionalLight, HemisphereLight, Object3D, Color, Vector3,
// OrthographicCamera).
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= l; this.y /= l; this.z /= l;
    return this;
  }
}
class V2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class Color {
  constructor(r = 1, g = 1, b = 1) {
    if (typeof r === "number" && g === undefined) {
      this.r = ((r >> 16) & 0xff) / 255;
      this.g = ((r >> 8) & 0xff) / 255;
      this.b = (r & 0xff) / 255;
    } else {
      this.r = r; this.g = g; this.b = b;
    }
  }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color(this.r, this.g, this.b); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  lerp(c, t) {
    this.r = this.r + (c.r - this.r) * t;
    this.g = this.g + (c.g - this.g) * t;
    this.b = this.b + (c.b - this.b) * t;
    return this;
  }
}
class Object3D {
  constructor() {
    this.children = [];
    this.position = new V3();
  }
  add(o) { this.children.push(o); return this; }
  updateMatrixWorld() {}
}
class OrthographicCamera extends Object3D {
  constructor() {
    super();
    this.left = -1; this.right = 1; this.top = 1; this.bottom = -1;
    this.near = 0.1; this.far = 100;
  }
  updateProjectionMatrix() {}
}
class DirectionalLightShadow {
  constructor() {
    this.mapSize = new V2(512, 512);
    this.bias = 0;
    this.normalBias = 0;
    this.radius = 1;
    this.camera = new OrthographicCamera();
    this.map = null;
  }
}
class DirectionalLight extends Object3D {
  constructor(color = 0xffffff, intensity = 1) {
    super();
    this.color = new Color(color);
    this.intensity = intensity;
    this.castShadow = false;
    this.shadow = new DirectionalLightShadow();
    this.target = new Object3D();
  }
}
class HemisphereLight extends Object3D {
  constructor(sky = 0xffffff, ground = 0x444444, intensity = 1) {
    super();
    this.color = new Color(sky);
    this.groundColor = new Color(ground);
    this.intensity = intensity;
  }
}

const threeStub = {
  Vector2: V2,
  Vector3: V3,
  Color,
  Object3D,
  OrthographicCamera,
  DirectionalLight,
  HemisphereLight,
};

const mod = loadTsModule("src/lib/city-sun.ts", {
  requireMap: { three: threeStub },
});

const {
  CITY_SUN_AZIMUTH_RAD,
  CITY_SUN_DISTANCE,
  CSM_CASCADE_COUNT,
  CSM_CASCADE_RADII,
  CSM_CASCADE_SHADOW_RADII,
  CSM_CASCADE_NORMAL_BIAS,
  CSM_CASCADE_BIAS,
  sunDirection,
  sunAltitude,
  sunColorAt,
  sunIntensityAt,
  cascadeMapSizeForTier,
  cascadeRadiusFor,
  cascadeShadowRadiusFor,
  cascadeNormalBiasFor,
  cascadeBiasFor,
  createCitySun,
} = mod;

// ── cascade count and radii ─────────────────────────────────────────────
// The brief pins 3 cascades. A fourth cascade would only add cost
// without covering a new scale of geometry; a second cascade would
// collapse either pedestrians into a coarse tower-scale map or
// towers into an aliased ground-scale map.

assert.equal(CSM_CASCADE_COUNT, 3, "the cascade count is 3 per the brief");
assert.deepEqual(
  [...CSM_CASCADE_RADII],
  [40, 250, 2000],
  "the cascade half-radii are [40m, 250m, 2000m] per the brief",
);

// The radii must be strictly increasing so cascade 0 always covers a
// tighter scale than cascade 1. A regression that flattened them or
// inverted them would break the near→far handoff.
for (let i = 1; i < CSM_CASCADE_RADII.length; i += 1) {
  assert.ok(
    CSM_CASCADE_RADII[i] > CSM_CASCADE_RADII[i - 1],
    `cascade radii must be strictly increasing (i=${i})`,
  );
}

// ── PCSS-approx shadow radius per cascade ───────────────────────────────
// Smaller radius = harder shadow at contact. The near cascade covers
// pedestrian feet and lamp posts — those must land HARD. The far
// cascade covers the event towers — their self-shadow reads better
// soft. The literals are the spec.

assert.deepEqual(
  [...CSM_CASCADE_SHADOW_RADII],
  [1.5, 3.0, 6.0],
  "PCSS-approx shadow radii are [1.5, 3.0, 6.0] texels",
);

// Radius must be monotonically increasing — near is hardest, far is softest.
for (let i = 1; i < CSM_CASCADE_SHADOW_RADII.length; i += 1) {
  assert.ok(
    CSM_CASCADE_SHADOW_RADII[i] > CSM_CASCADE_SHADOW_RADII[i - 1],
    `PCSS-approx radii must be monotonically increasing (i=${i})`,
  );
}

// ── per-cascade bias ladders ────────────────────────────────────────────
// normalBias and bias scale roughly with texel size — bigger frustum
// = bigger normalBias to hide slope-scale acne on tall vertical
// facades at raking dusk angles.

assert.deepEqual(
  [...CSM_CASCADE_NORMAL_BIAS],
  [0.02, 0.08, 0.30],
  "normalBias ladder is [0.02, 0.08, 0.30] across cascades",
);
assert.deepEqual(
  [...CSM_CASCADE_BIAS],
  [-0.00005, -0.0002, -0.001],
  "bias ladder is [-0.00005, -0.0002, -0.001] across cascades",
);

// bias values must all be negative (they pull the shadow test inward).
// normalBias values must all be positive.
for (const b of CSM_CASCADE_BIAS) {
  assert.ok(b < 0, `bias must be negative (got ${b})`);
}
for (const nb of CSM_CASCADE_NORMAL_BIAS) {
  assert.ok(nb > 0, `normalBias must be positive (got ${nb})`);
}

// ── tier ladder ────────────────────────────────────────────────────────
// The brief pins 4096² per cascade at high tier. Weaker tiers step
// down by powers of two so mid-range hardware does not blow its
// shadow-atlas budget. Sleep disables shadows.

assert.equal(cascadeMapSizeForTier("high"), 4096, "high tier maps at 4096²");
assert.equal(cascadeMapSizeForTier("medium"), 2048, "medium tier maps at 2048²");
assert.equal(cascadeMapSizeForTier("low"), 1024, "low tier maps at 1024²");
assert.equal(cascadeMapSizeForTier("sleep"), 0, "sleep tier disables shadows entirely");

// ── clamp accessors ────────────────────────────────────────────────────
// Never return undefined; clamp out-of-range indices to the outermost
// cascade. A future refactor that added a cascade must widen the
// tables in lockstep; if it didn't, the clamps would silently return
// the last cascade's numbers rather than undefined.

assert.equal(cascadeRadiusFor(0), 40, "cascadeRadiusFor(0) → 40 m");
assert.equal(cascadeRadiusFor(1), 250, "cascadeRadiusFor(1) → 250 m");
assert.equal(cascadeRadiusFor(2), 2000, "cascadeRadiusFor(2) → 2000 m");
assert.equal(cascadeRadiusFor(-1), 40, "cascadeRadiusFor negative index clamps to near");
assert.equal(cascadeRadiusFor(999), 2000, "cascadeRadiusFor over-large index clamps to far");
assert.equal(cascadeShadowRadiusFor(0), 1.5, "cascadeShadowRadiusFor(0) → 1.5");
assert.equal(cascadeShadowRadiusFor(2), 6.0, "cascadeShadowRadiusFor(2) → 6.0");
assert.equal(cascadeNormalBiasFor(1), 0.08, "cascadeNormalBiasFor(1) → 0.08");
assert.equal(cascadeBiasFor(2), -0.001, "cascadeBiasFor(2) → -0.001");

// ── azimuth + distance retained from pre-CSM ───────────────────────────
// The brief promises the noon shadow points away from the visitor
// and dusk rakes across the widest facades. Any refactor that flipped
// the azimuth or shrank the distance would drift both.

assert.ok(
  Math.abs(CITY_SUN_AZIMUTH_RAD - Math.PI * 0.375) < 1e-9,
  "azimuth stays at π * 0.375 (south-south-west)",
);
assert.equal(CITY_SUN_DISTANCE, 240, "sun distance stays at 240 m");

// ── sun colour + intensity curves — carried through unchanged ──────────
// The 3-cascade split does not alter the diurnal ramp; the per-cascade
// light gets 1/3 of each frame's intensity, but the AGGREGATE the
// external effects sample matches the pre-CSM value.

{
  const noon = sunIntensityAt(0.25);
  const dusk = sunIntensityAt(0.5);
  const midnight = sunIntensityAt(0.75);
  assert.ok(noon > dusk, "noon intensity > dusk intensity");
  assert.ok(dusk >= 0, "dusk intensity is non-negative");
  assert.ok(midnight > 0, "midnight (moon) intensity is positive, not zero");
  assert.ok(midnight < dusk, "midnight moon dimmer than dusk sun");
}
{
  const dir = sunDirection(0.25);
  assert.ok(dir.y > 0.5, "noon sun is high in the sky");
}
{
  const dir = sunDirection(0.75);
  assert.ok(dir.y < 0, "midnight sun is below the horizon");
}
{
  const alt = sunAltitude(0.25);
  assert.ok(alt > 0, "noon altitude positive");
}
{
  const col = sunColorAt(0.5);
  assert.ok(col.r > col.b, "dusk sun is warmer than blue");
}

// ── createCitySun — real construction against the three stub ───────────
// The full stack — three DirectionalLights, one HemisphereLight, one
// target Object3D — is built and its wiring inspected. Every cascade
// must castShadow=true, carry the expected radius/bias, and its
// shadow-camera must be sized to the cascade's world-space half-radius.

{
  const citySun = createCitySun();
  assert.ok(citySun, "createCitySun returns a bundle");
  assert.equal(citySun.cascades.length, CSM_CASCADE_COUNT, "3 cascade lights");
  assert.ok(citySun.hemi, "hemisphere fill is present");
  assert.ok(citySun.target, "shared target Object3D is present");

  for (let i = 0; i < citySun.cascades.length; i += 1) {
    const c = citySun.cascades[i];
    assert.equal(c.castShadow, true, `cascade ${i} casts shadow by default`);
    assert.equal(
      c.shadow.radius,
      cascadeShadowRadiusFor(i),
      `cascade ${i} carries the PCSS-approx radius`,
    );
    assert.ok(
      Math.abs(c.shadow.normalBias - cascadeNormalBiasFor(i)) < 1e-9,
      `cascade ${i} carries the normalBias ladder value`,
    );
    assert.ok(
      Math.abs(c.shadow.bias - cascadeBiasFor(i)) < 1e-9,
      `cascade ${i} carries the bias ladder value`,
    );
    // Frustum size — the shadow camera's half-radius matches the ladder.
    const radius = cascadeRadiusFor(i);
    assert.equal(c.shadow.camera.left, -radius, `cascade ${i} shadow-cam left`);
    assert.equal(c.shadow.camera.right, radius, `cascade ${i} shadow-cam right`);
    assert.equal(c.shadow.camera.top, radius, `cascade ${i} shadow-cam top`);
    assert.equal(c.shadow.camera.bottom, -radius, `cascade ${i} shadow-cam bottom`);
    // Sun distance sits inside the shadow-camera's near/far bracket.
    assert.ok(c.shadow.camera.far > CITY_SUN_DISTANCE, `cascade ${i} far plane clears sun distance`);
    // Every cascade shares the same target.
    assert.strictEqual(c.target, citySun.target, `cascade ${i} points at the shared target`);
    // Default mapSize matches the high-tier ladder (4096²).
    assert.equal(c.shadow.mapSize.x, 4096, `cascade ${i} defaults to 4096² map`);
    assert.equal(c.shadow.mapSize.y, 4096, `cascade ${i} defaults to 4096² map`);
  }

  // `light` alias must point at the FAR cascade — the biggest frustum,
  // the one that carries the event tower + landmark shadows.
  assert.strictEqual(
    citySun.light,
    citySun.cascades[CSM_CASCADE_COUNT - 1],
    "light alias points at the FAR cascade (index 2)",
  );

  // update() propagates a full sun state through all three cascades.
  // Each cascade sees the SAME direction and colour; the intensity
  // is split evenly (sunIntensity / 3). The aggregate accessors
  // report the pre-CSM totals — cloud / godray sampling relies on
  // this.
  citySun.update(0.25);
  const totalI = citySun.cascades.reduce((s, c) => s + c.intensity, 0);
  assert.ok(
    Math.abs(totalI - citySun.sunIntensity) < 1e-9,
    `cascade intensities sum to aggregate sunIntensity (${totalI} vs ${citySun.sunIntensity})`,
  );
  for (const c of citySun.cascades) {
    assert.ok(
      Math.abs(c.color.r - citySun.sunColor.r) < 1e-9 &&
      Math.abs(c.color.g - citySun.sunColor.g) < 1e-9 &&
      Math.abs(c.color.b - citySun.sunColor.b) < 1e-9,
      "every cascade shares the aggregate sun colour",
    );
    // Same normalized direction from the target — position equals
    // sunPosition (all three cascades sit on the same sun ray).
    assert.ok(
      Math.abs(c.position.x - citySun.sunPosition.x) < 1e-9 &&
      Math.abs(c.position.y - citySun.sunPosition.y) < 1e-9 &&
      Math.abs(c.position.z - citySun.sunPosition.z) < 1e-9,
      "every cascade sits at the same world-space sun position",
    );
  }

  // update() cannot place the sun below the ground plane — even at
  // midnight (below horizon), the y-coordinate is clamped to at
  // least 2 metres so shadow-camera math stays sane.
  citySun.update(0.75);
  assert.ok(citySun.sunPosition.y >= 2, "sun y clamped at ≥2 m even below horizon");

  // applyTier propagates to every cascade. Sleep tier disables all
  // shadows; medium halves the map size; high restores 4096.
  citySun.applyTier("medium");
  for (const c of citySun.cascades) {
    assert.equal(c.castShadow, true, "medium tier still casts");
    assert.equal(c.shadow.mapSize.x, 2048, "medium tier maps to 2048²");
  }
  citySun.applyTier("sleep");
  for (const c of citySun.cascades) {
    assert.equal(c.castShadow, false, "sleep tier disables cascade shadow casting");
  }
  citySun.applyTier("high");
  for (const c of citySun.cascades) {
    assert.equal(c.castShadow, true, "high tier restores cascade shadow casting");
    assert.equal(c.shadow.mapSize.x, 4096, "high tier restores 4096² map");
  }

  // addToScene — every cascade + target + hemi lands in the root's
  // children exactly once. A future refactor that dropped the target
  // add would leave the shadow frustums fixed at the world origin
  // instead of following the visitor's camera.
  const root = new Object3D();
  citySun.addToScene(root);
  for (const c of citySun.cascades) {
    assert.ok(root.children.includes(c), "cascade landed in scene root");
  }
  assert.ok(root.children.includes(citySun.target), "target landed in scene root");
  assert.ok(root.children.includes(citySun.hemi), "hemi landed in scene root");
  // No cascade added twice.
  const seen = new Set();
  for (const child of root.children) {
    assert.ok(!seen.has(child), "no scene-child added twice");
    seen.add(child);
  }

  citySun.dispose();
}

// ── centerXZ follows the camera ────────────────────────────────────────
// The visitor pans the camera; the shadow frustums must ride with it
// so pedestrian shadows near the visitor stay high-res. update()
// receives a { x, z } origin; when we pass one, every cascade's
// position should sit on the same ray offset from that origin.

{
  const citySun = createCitySun();
  citySun.update(0.25, { x: 100, z: -50 });
  assert.equal(citySun.target.position.x, 100, "target x tracks the visitor");
  assert.equal(citySun.target.position.z, -50, "target z tracks the visitor");
  // Every cascade's position sits at (target + sunDir * distance).
  for (const c of citySun.cascades) {
    // The world-space position lies along the sun direction from the
    // target — sunPosition IS the same world-space point.
    const dx = c.position.x - citySun.sunPosition.x;
    const dz = c.position.z - citySun.sunPosition.z;
    assert.ok(Math.hypot(dx, dz) < 1e-9, "cascade position aligned with sun aggregate");
  }
  citySun.dispose();
}

// ── quantised update slot ──────────────────────────────────────────────
// update() early-outs within a slot (1/128 of a day) so the shadow
// projection matrix isn't rewritten every frame. But when the day
// advances by 1/64, the slot changes and the sun repositions. A
// regression that dropped the slot cache would kill throughput; a
// regression that widened it past 1/128 would jitter the sunset.

{
  const citySun = createCitySun();
  citySun.update(0.0);
  const p0 = citySun.sunPosition.clone();
  citySun.update(0.0001);   // same slot — no reposition
  assert.equal(citySun.sunPosition.x, p0.x, "same slot → no reposition");
  // 0.25 (noon) is a different slot AND a very different altitude
  // from 0.0 (dawn horizon) — the sun's y-coordinate must climb.
  citySun.update(0.25);
  assert.ok(citySun.sunPosition.y > p0.y,
    "different slot → sun repositions (noon higher than dawn)");
  citySun.dispose();
}

// ── opts.area still overrides the FAR cascade half-radius ──────────────
// The pre-CSM caller passed `area: 220`; the new code respects
// that as an override on the FAR cascade only. Preserving the
// hook so old callers do not silently drift.

{
  const citySun = createCitySun({ area: 500 });
  const far = citySun.cascades[CSM_CASCADE_COUNT - 1];
  assert.equal(far.shadow.camera.left, -500, "area override lands on the FAR cascade");
  assert.equal(far.shadow.camera.right, 500, "area override lands on the FAR cascade");
  // Near cascade is untouched.
  assert.equal(citySun.cascades[0].shadow.camera.right, 40, "near cascade still 40 m");
  citySun.dispose();
}

console.log("city-shadows: all three cascades read solid — pedestrian and tower in the same frame.");
