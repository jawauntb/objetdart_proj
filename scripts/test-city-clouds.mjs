import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-clouds — the pure-math half of the volumetric cloud slab.
 *
 * The ShaderMaterial itself only comes alive against a real WebGL context;
 * this test doesn't try to render. It pins:
 *
 *   CLOUD_BASE_ALT, CLOUD_TOP_ALT       — the ~800 m slab the brief calls for
 *   CLOUD_HG_G                          — 0.6 forward-scattering (silver lining)
 *   CLOUD_WIND_MPS                      — 6 m/s easterly (weather in motion)
 *   cloudCoverageForDay(df)             — 0..1, peaks at dusk, troughs at dawn
 *   cloudDensityForDay(df)              — hump at dusk (the emotional peak)
 *   cloudWindOffset(cityTimeMs)         — pure easterly drift, deterministic
 *   cloudStepsForTier(tier)             — 48 / 32 / 0 (the brief's ladder)
 *   cloudsEnabledForTier(tier)          — mirror of the step ladder
 *   buildCloudFragmentShader(p, s)      — carries the raymarch operations
 *
 * A future regression that flipped noon to overcast, that stripped the
 * silver-lining phase, or that widened the slab to 400 m would drift the
 * reference photos this room is built against. The test names each so
 * any drift shows up before it hits the frame.
 */

// Stubs for the Three.js imports the clouds module carries at load time.
// None of the tested pure functions instantiate any of these — the
// factory createCityClouds is exercised in a live-WebGL context only.
class V2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; } }
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; } clone() { return new V3(this.x, this.y, this.z); } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; } setFromMatrixPosition() { return this; } }
class M4 { multiplyMatrices() { return this; } }
class Color { constructor(r = 1, g = 1, b = 1) { this.r = r; this.g = g; this.b = b; } }
class PlaneGeometry { dispose() {} }
class ShaderMaterial { constructor(o) { this.uniforms = o.uniforms; this.transparent = o.transparent; } dispose() {} }
class Mesh { constructor(g, m) { this.geometry = g; this.material = m; this.frustumCulled = true; this.renderOrder = 0; this.visible = true; } }

const threeStub = {
  Vector2: V2,
  Vector3: V3,
  Matrix4: M4,
  Color,
  PlaneGeometry,
  ShaderMaterial,
  Mesh,
  DoubleSide: 2,
  NormalBlending: 1,
  CustomBlending: 5,
  AddEquation: 100,
  OneFactor: 1,
  OneMinusSrcAlphaFactor: 205,
};

const mod = loadTsModule("src/lib/city-clouds.ts", {
  requireMap: { three: threeStub },
});

const {
  CLOUD_BASE_ALT,
  CLOUD_TOP_ALT,
  CLOUD_HG_G,
  CLOUD_WIND_MPS,
  cloudCoverageForDay,
  cloudDensityForDay,
  cloudWindOffset,
  cloudStepsForTier,
  cloudsEnabledForTier,
  buildCloudFragmentShader,
  cloudVertexShader,
  createCityClouds,
} = mod;

// ── the slab constants ──────────────────────────────────────────────────
// The brief pins ~800 m. Slab base + top literals below carry that. A
// refactor that dropped the base to 300 m would put clouds INSIDE the
// event-tower silhouette; one that raised it to 3 km would push them
// out of the visible frame at bird's-eye zoom.

assert.equal(CLOUD_BASE_ALT, 700, "cloud base sits at 700 m (mid-slab = 800 m)");
assert.equal(CLOUD_TOP_ALT, 900, "cloud top sits at 900 m (mid-slab = 800 m)");
assert.equal(CLOUD_TOP_ALT - CLOUD_BASE_ALT, 200, "slab is 200 m thick");
assert.ok(CLOUD_BASE_ALT > 250, "base is well above the tallest event tower (~180 m)");

// ── the Henyey-Greenstein g ─────────────────────────────────────────────
// The brief calls out "Henyey-Greenstein phase toward the sun". 0.6 is
// the forward-scattering lobe the London-sunset reference is about
// — silver lining at cloud edges near the sun.

assert.equal(CLOUD_HG_G, 0.6, "HG g is 0.6 — forward-scattering silver lining");
assert.ok(CLOUD_HG_G > 0 && CLOUD_HG_G < 1, "g in the physically-plausible forward range");

// ── wind speed ──────────────────────────────────────────────────────────
// 6 m/s: visible drift over a minute of city-time, not so much that a
// cloud shape morphs faster than the eye can grasp.

assert.equal(CLOUD_WIND_MPS, 6.0, "wind is 6 m/s (weather in motion)");

// ── coverage curve at the four cardinal times ───────────────────────────
// dayFraction=0    → 0.50  (clearing at dawn)
// dayFraction=0.25 → 0.575 (broken cumulus at noon)
// dayFraction=0.5  → 0.65  (thick, storm-lit at dusk)
// dayFraction=0.75 → 0.575 (moon-thin overcast at midnight)

{
  const c = cloudCoverageForDay(0);
  assert.ok(Math.abs(c - 0.50) < 1e-9, `dawn coverage 0.50; got ${c}`);
}
{
  const c = cloudCoverageForDay(0.25);
  assert.ok(Math.abs(c - 0.575) < 1e-9, `noon coverage 0.575; got ${c}`);
}
{
  const c = cloudCoverageForDay(0.5);
  assert.ok(Math.abs(c - 0.65) < 1e-9, `dusk coverage 0.65; got ${c}`);
}
{
  const c = cloudCoverageForDay(0.75);
  assert.ok(Math.abs(c - 0.575) < 1e-9, `midnight coverage 0.575; got ${c}`);
}

// coverage stays in [0..1] across the full cycle
for (let i = 0; i < 200; i += 1) {
  const df = i / 200;
  const c = cloudCoverageForDay(df);
  assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `coverage ∈ [0,1]; df=${df} c=${c}`);
}

// coverage is monotone from dawn (df=0) to dusk (df=0.5) — the sky
// thickens as the sun descends toward the ember. A regression that
// flattened the ramp would drain the emotional peak.
{
  let prev = -Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const df = (0.5 * i) / 20;
    const c = cloudCoverageForDay(df);
    assert.ok(c >= prev - 1e-9, `coverage monotone dawn→dusk; df=${df} c=${c} prev=${prev}`);
    prev = c;
  }
}

// ── density curve at the four cardinal times ────────────────────────────
// dayFraction=0    → 0.7   (cold thin cirrus at dawn)
// dayFraction=0.25 → 1.0   (medium wispy cumulus at noon)
// dayFraction=0.5  → 1.3   (thick storm at dusk — the emotional peak)
// dayFraction=0.75 → 1.0   (moon-lit overcast at midnight)

{
  const d = cloudDensityForDay(0);
  assert.ok(Math.abs(d - 0.7) < 1e-9, `dawn density 0.7; got ${d}`);
}
{
  const d = cloudDensityForDay(0.25);
  assert.ok(Math.abs(d - 1.0) < 1e-9, `noon density 1.0 (medium wispy); got ${d}`);
}
{
  const d = cloudDensityForDay(0.5);
  assert.ok(Math.abs(d - 1.3) < 1e-9, `dusk density 1.3 (peak storm); got ${d}`);
}
{
  const d = cloudDensityForDay(0.75);
  assert.ok(Math.abs(d - 1.0) < 1e-9, `midnight density 1.0 (moon overcast); got ${d}`);
}

// density is a positive, finite scalar across the full cycle
for (let i = 0; i < 200; i += 1) {
  const df = i / 200;
  const d = cloudDensityForDay(df);
  assert.ok(Number.isFinite(d) && d >= 0, `density finite and non-negative; df=${df} d=${d}`);
}

// noon is thinner than dusk — the reference SF-day photo is broken wispy
// cumulus, the London-sunset reference is a wall of storm-cloud.
{
  const noonD = cloudDensityForDay(0.25);
  const duskD = cloudDensityForDay(0.5);
  assert.ok(noonD < duskD, `noon (${noonD}) is thinner than dusk (${duskD})`);
  // Dawn (0.7) is also thinner than dusk (1.3) — the coldest moment of
  // the day matches the thinnest cirrus, then the sky builds toward
  // the emotional peak at dusk.
  const dawnD = cloudDensityForDay(0);
  assert.ok(dawnD < duskD, `dawn (${dawnD}) is thinner than dusk (${duskD})`);
}

// ── wind offset is deterministic and drifts easterly ────────────────────
// The offset at t=0 is (0, 0). Wind is 6 m/s over a 300 m noise scale
// = 0.02 UV units per second. y stays at 0.

{
  const w = cloudWindOffset(0);
  assert.equal(w.x, 0, "wind offset at t=0 is 0");
  assert.equal(w.y, 0, "wind is purely east-west");
}
{
  const w = cloudWindOffset(1000);
  const expected = (6 * 1) / 300;
  assert.ok(Math.abs(w.x - expected) < 1e-9, `at t=1000ms: offset ${expected}; got ${w.x}`);
  assert.equal(w.y, 0);
}
{
  const w = cloudWindOffset(60_000);
  // 60 s of wind = 360 m = 1.2 noise units
  assert.ok(Math.abs(w.x - 1.2) < 1e-9, `after 60 s the wind has drifted 1.2 units; got ${w.x}`);
}

// determinism: same cityTimeMs → same offset. A re-mount at the same
// city clock sees the same clouds.
{
  const a = cloudWindOffset(12345);
  const b = cloudWindOffset(12345);
  assert.deepEqual(a, b, "same cityTimeMs → same wind offset");
}

// ── tier ladder ─────────────────────────────────────────────────────────
// The brief spec: high=48, medium=32, low=disabled, sleep=disabled.

{
  const s = cloudStepsForTier("high");
  assert.equal(s.primary, 48, "high tier: 48 primary steps");
  assert.equal(s.sun, 6, "high tier: 6 sun steps");
}
{
  const s = cloudStepsForTier("medium");
  assert.equal(s.primary, 32, "medium tier: 32 primary steps");
  assert.equal(s.sun, 4, "medium tier: 4 sun steps");
}
{
  const s = cloudStepsForTier("low");
  assert.equal(s.primary, 0, "low tier: 0 primary (mesh hidden)");
  assert.equal(s.sun, 0, "low tier: 0 sun (mesh hidden)");
}
{
  const s = cloudStepsForTier("sleep");
  assert.equal(s.primary, 0, "sleep tier: 0 primary (mesh hidden)");
  assert.equal(s.sun, 0, "sleep tier: 0 sun (mesh hidden)");
}

// enabled predicate mirrors the ladder
assert.equal(cloudsEnabledForTier("high"), true, "clouds enabled at high");
assert.equal(cloudsEnabledForTier("medium"), true, "clouds enabled at medium");
assert.equal(cloudsEnabledForTier("low"), false, "clouds off at low");
assert.equal(cloudsEnabledForTier("sleep"), false, "clouds off at sleep");

// ── shader source carries the raymarch operations ───────────────────────
// A future silent shader edit that removed the HG phase, the sun
// march, the coverage threshold, or the front-to-back composite
// would drain the volumetric read. Names are stamped in the source.

const frag = buildCloudFragmentShader(48, 6);
assert.ok(frag.includes("#define PRIMARY_STEPS 48"), "primary count stamped as GLSL #define");
assert.ok(frag.includes("#define SUN_STEPS 6"), "sun count stamped as GLSL #define");
assert.ok(frag.includes("hgPhase"), "fragment carries the Henyey-Greenstein phase");
assert.ok(frag.includes("uSunDir"), "fragment samples the sun direction uniform");
assert.ok(frag.includes("uCoverage"), "fragment thresholds density by coverage");
assert.ok(frag.includes("uDensityMul"), "fragment scales density by day-driven multiplier");
assert.ok(frag.includes("uWindOffset"), "fragment advects noise UV by wind");
assert.ok(frag.includes("fbm"), "fragment carries a low-frequency FBM density field");
assert.ok(frag.includes("noise3"), "fragment carries 3D value noise");
assert.ok(frag.includes("exp("), "fragment carries Beer-Lambert extinction");
assert.ok(frag.includes("raySlab"), "fragment carries the slab-intersection helper");
assert.ok(frag.includes("accumAlpha"), "fragment integrates alpha front-to-back");
assert.ok(frag.includes("accumColor"), "fragment integrates colour front-to-back");
assert.ok(frag.includes("if (uStrength <= 0.0)"), "fragment short-circuits when strength is zero");

// vertex reconstructs the world ray
assert.ok(cloudVertexShader.includes("uInvViewProj"), "vertex uses the inverse view-projection matrix");
assert.ok(cloudVertexShader.includes("vRayDir"), "vertex passes the world-space ray direction to fragment");
assert.ok(cloudVertexShader.includes("uCamPos"), "vertex reads the camera world position");

// tier-dependent step counts land in the shader
{
  const medium = buildCloudFragmentShader(32, 4);
  assert.ok(medium.includes("#define PRIMARY_STEPS 32"), "medium: 32 primary steps stamped");
  assert.ok(medium.includes("#define SUN_STEPS 4"), "medium: 4 sun steps stamped");
}

// step counts under 1 are clamped to 1 so the GLSL loop bound is valid
{
  const clamped = buildCloudFragmentShader(0, 0);
  assert.ok(clamped.includes("#define PRIMARY_STEPS 1"), "0 → 1 primary steps (loop-bound safety)");
  assert.ok(clamped.includes("#define SUN_STEPS 1"), "0 → 1 sun steps (loop-bound safety)");
}

// ── factory smoke test (mesh + update contract) ─────────────────────────
// createCityClouds returns a mesh with the right depth+blend settings.
// A regression that turned depthWrite on would let cloud pixels write
// depth over the sky and occlude everything drawn later; a regression
// that removed transparency would draw a black rectangle.

{
  const clouds = createCityClouds({ initialTier: "high" });
  assert.ok(clouds.mesh, "createCityClouds returns a mesh");
  assert.equal(clouds.mesh.frustumCulled, false, "mesh does not cull (full-screen)");
  assert.equal(clouds.mesh.renderOrder, 1, "mesh draws after the sky (renderOrder=1)");
  assert.equal(clouds.mesh.material.transparent, true, "material is transparent so sky shows through");
  // Uniforms the composer/City.tsx write to per frame — the test names
  // each so a rename can't happen silently.
  const u = clouds.mesh.material.uniforms;
  for (const name of [
    "uInvViewProj", "uCamPos", "uSunDir", "uSunColor", "uAmbientColor",
    "uCoverage", "uDensityMul", "uWindOffset", "uSlabBase", "uSlabTop",
    "uHgG", "uStrength",
  ]) {
    assert.ok(u[name], `uniform ${name} exists`);
  }
  assert.equal(u.uSlabBase.value, CLOUD_BASE_ALT, "uSlabBase seeded from CLOUD_BASE_ALT");
  assert.equal(u.uSlabTop.value, CLOUD_TOP_ALT, "uSlabTop seeded from CLOUD_TOP_ALT");
  assert.equal(u.uHgG.value, CLOUD_HG_G, "uHgG seeded from CLOUD_HG_G");
  assert.equal(u.uStrength.value, 1.0, "initial strength is 1 (full clouds)");
  // Initial visibility matches the initial tier — high is enabled.
  assert.equal(clouds.mesh.visible, true, "mesh visible on high tier at construction");
  clouds.dispose();
}

// low-tier construction hides the mesh out of the gate — the low-power
// device pays no cost until the tier flips back to medium/high.
{
  const clouds = createCityClouds({ initialTier: "low" });
  assert.equal(clouds.mesh.visible, false, "mesh hidden on low tier at construction");
  clouds.dispose();
}
{
  const clouds = createCityClouds({ initialTier: "sleep" });
  assert.equal(clouds.mesh.visible, false, "mesh hidden on sleep tier at construction");
  clouds.dispose();
}

// update() honours a tier drop (visible=false) and a tier lift.
{
  const clouds = createCityClouds({ initialTier: "high" });
  // A fake camera stub — the update path only reads matrixWorld +
  // projectionMatrixInverse and calls setFromMatrixPosition. All the
  // matrix stubs above are safe no-ops.
  const camera = {
    matrixWorld: new M4(),
    projectionMatrixInverse: new M4(),
    updateMatrixWorld() {},
  };
  clouds.update({
    dayFraction: 0.5,
    sunDir: new V3(0, 1, 0),
    sunColor: new Color(1, 0.8, 0.6),
    ambientColor: new Color(0.5, 0.6, 0.75),
    cityTimeMs: 12345,
    tier: "high",
    camera,
  });
  assert.equal(clouds.mesh.visible, true, "high tier: mesh visible after update");
  const uAtDusk = clouds.mesh.material.uniforms;
  assert.ok(Math.abs(uAtDusk.uCoverage.value - 0.65) < 1e-9, "dusk update writes coverage=0.65");
  assert.ok(Math.abs(uAtDusk.uDensityMul.value - 1.3) < 1e-9, "dusk update writes density=1.3");
  // A tier drop to low hides the mesh and does no more work.
  clouds.update({
    dayFraction: 0.5,
    sunDir: new V3(0, 1, 0),
    sunColor: new Color(1, 0.8, 0.6),
    ambientColor: new Color(0.5, 0.6, 0.75),
    cityTimeMs: 12345,
    tier: "low",
    camera,
  });
  assert.equal(clouds.mesh.visible, false, "low tier: mesh hidden after update");
  clouds.dispose();
}

console.log(
  "city-clouds ok: 200 m slab at 800 m altitude, coverage 0.5→0.65 across day, " +
  "density peaks at dusk (1.3), 6 m/s easterly wind is deterministic in cityTimeMs, " +
  "48/32/0 tier ladder, HG g=0.6 for silver-lining phase, raymarch operations named.",
);
