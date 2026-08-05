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
  CLOUD_HORIZON_PINK_R,
  CLOUD_HORIZON_PINK_G,
  CLOUD_HORIZON_PINK_B,
  CLOUD_MS_PEAK,
  CLOUD_SILVER_PEAK,
  CLOUD_UNDERBELLY_PEAK,
  cloudCoverageForDay,
  cloudDensityForDay,
  cloudWindOffset,
  cloudStepsForTier,
  cloudsEnabledForTier,
  cloudHorizonPink,
  cloudMultiScatterForDay,
  cloudSilverLiningForDay,
  cloudUnderbellyLift,
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
  assert.equal(s.primary, 24, "high tier: 24 primary steps");
  assert.equal(s.sun, 4, "high tier: 4 sun steps");
}
{
  const s = cloudStepsForTier("medium");
  assert.equal(s.primary, 8, "medium tier: 8 primary steps");
  assert.equal(s.sun, 2, "medium tier: 2 sun steps");
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

// ── horizon-pink underbelly tint ────────────────────────────────────────
// The r9-0 dusk-pink lift. The peak vec3 constant must land the
// London-reference pink note: red-boosted (>1), muted green (~0.6),
// lifted blue (>0.7). A future refactor that dropped the blue channel
// toward 0.3 would drift the aesthetic back to SF-day orange; the
// three constants pin the tone.

assert.equal(CLOUD_HORIZON_PINK_R, 1.35, "horizon-pink R is 1.35 (Rayleigh-red boost)");
assert.equal(CLOUD_HORIZON_PINK_G, 0.60, "horizon-pink G is 0.60 (warm mid, not gold)");
assert.equal(CLOUD_HORIZON_PINK_B, 0.72, "horizon-pink B is 0.72 (Chappuis pink lift)");
assert.ok(CLOUD_HORIZON_PINK_R > CLOUD_HORIZON_PINK_G, "R > G (reddish)");
assert.ok(CLOUD_HORIZON_PINK_B > CLOUD_HORIZON_PINK_G, "B > G (pink not orange)");

// cloudHorizonPink curve at the four cardinal times.
// dawn+dusk (df=0, 0.5) → peak pink; noon+midnight (df=0.25, 0.75) → neutral.

{
  const p = cloudHorizonPink(0);
  assert.ok(Math.abs(p.r - CLOUD_HORIZON_PINK_R) < 1e-9, `dawn r=${p.r}`);
  assert.ok(Math.abs(p.g - CLOUD_HORIZON_PINK_G) < 1e-9, `dawn g=${p.g}`);
  assert.ok(Math.abs(p.b - CLOUD_HORIZON_PINK_B) < 1e-9, `dawn b=${p.b}`);
}
{
  const p = cloudHorizonPink(0.5);
  assert.ok(Math.abs(p.r - CLOUD_HORIZON_PINK_R) < 1e-9, `dusk r=${p.r}`);
  assert.ok(Math.abs(p.g - CLOUD_HORIZON_PINK_G) < 1e-9, `dusk g=${p.g}`);
  assert.ok(Math.abs(p.b - CLOUD_HORIZON_PINK_B) < 1e-9, `dusk b=${p.b}`);
}
{
  const p = cloudHorizonPink(0.25);
  assert.ok(Math.abs(p.r - 1) < 1e-9, `noon r=${p.r} should be neutral`);
  assert.ok(Math.abs(p.g - 1) < 1e-9, `noon g=${p.g} should be neutral`);
  assert.ok(Math.abs(p.b - 1) < 1e-9, `noon b=${p.b} should be neutral`);
}
{
  const p = cloudHorizonPink(0.75);
  assert.ok(Math.abs(p.r - 1) < 1e-9, `midnight r=${p.r} should be neutral`);
  assert.ok(Math.abs(p.g - 1) < 1e-9, `midnight g=${p.g} should be neutral`);
  assert.ok(Math.abs(p.b - 1) < 1e-9, `midnight b=${p.b} should be neutral`);
}
// Halfway between noon and dusk (df=0.375) — smoothstep midpoint of the
// horizon-proximity ramp. Should land between neutral and peak.
{
  const p = cloudHorizonPink(0.375);
  assert.ok(p.r > 1 && p.r < CLOUD_HORIZON_PINK_R, `df=0.375 r=${p.r} between 1 and peak`);
  assert.ok(p.g < 1 && p.g > CLOUD_HORIZON_PINK_G, `df=0.375 g=${p.g} between neutral and peak`);
  assert.ok(p.b < 1 && p.b > CLOUD_HORIZON_PINK_B, `df=0.375 b=${p.b} between neutral and peak`);
}

// Determinism: same df → same tint. Same df wrapped → same tint.
{
  const a = cloudHorizonPink(0.5);
  const b = cloudHorizonPink(1.5);
  assert.ok(Math.abs(a.r - b.r) < 1e-9, "wrap-around determinism r");
  assert.ok(Math.abs(a.g - b.g) < 1e-9, "wrap-around determinism g");
  assert.ok(Math.abs(a.b - b.b) < 1e-9, "wrap-around determinism b");
}

// ── multi-scatter Taylor lift ────────────────────────────────────────────
// Peaks at dusk to lift the thick-storm cloud interiors from black
// toward pink. Kept bounded at 0.35 so it never blows out the composite.

assert.equal(CLOUD_MS_PEAK, 0.35, "multi-scatter peak is 0.35");
{
  const s = cloudMultiScatterForDay(0.5);
  assert.ok(Math.abs(s - 0.35) < 1e-9, `dusk multi-scatter is peak: got ${s}`);
}
{
  const s = cloudMultiScatterForDay(0.25);
  // noon: sin(2π·0.25 - π/2) = sin(0) = 0 → 0.15
  assert.ok(Math.abs(s - 0.15) < 1e-9, `noon multi-scatter is min: got ${s}`);
}
{
  const s = cloudMultiScatterForDay(0);
  // dawn: sin(-π/2) = -1 → 0.15 - 0.20 = -0.05 → clamped to 0
  assert.equal(s, 0, `dawn multi-scatter clamps to 0: got ${s}`);
}
{
  // All values stay in [0, CLOUD_MS_PEAK].
  for (let i = 0; i <= 200; i += 1) {
    const df = i / 200;
    const s = cloudMultiScatterForDay(df);
    assert.ok(Number.isFinite(s) && s >= 0 && s <= CLOUD_MS_PEAK, `ms clamped; df=${df} s=${s}`);
  }
}

// ── silver-lining boost ──────────────────────────────────────────────────
// Peaks at dusk, whispers at noon, near-zero at dawn. The narrow HG
// lobe at g=0.9 fires when the shoulder of a cloud sits near the sun.

assert.equal(CLOUD_SILVER_PEAK, 0.55, "silver-lining peak is 0.55");
{
  const s = cloudSilverLiningForDay(0.5);
  assert.ok(Math.abs(s - 0.55) < 1e-9, `dusk silver is peak: got ${s}`);
}
{
  const s = cloudSilverLiningForDay(0.25);
  // sin(0) = 0 → 0.30
  assert.ok(Math.abs(s - 0.30) < 1e-9, `noon silver is baseline: got ${s}`);
}
{
  const s = cloudSilverLiningForDay(0);
  // sin(-π/2) = -1 → 0.30 - 0.25 = 0.05
  assert.ok(Math.abs(s - 0.05) < 1e-9, `dawn silver is minimum: got ${s}`);
}
{
  for (let i = 0; i <= 200; i += 1) {
    const df = i / 200;
    const s = cloudSilverLiningForDay(df);
    assert.ok(Number.isFinite(s) && s >= 0 && s <= CLOUD_SILVER_PEAK, `silver in range; df=${df} s=${s}`);
  }
}

// ── underbelly-lift ──────────────────────────────────────────────────────
// Peaks at horizon (dawn, dusk); zero at noon and midnight. The base of
// the cloud slab gets this factor added onto its sun contribution.

assert.equal(CLOUD_UNDERBELLY_PEAK, 1.6, "underbelly peak is 1.6");
{
  const s = cloudUnderbellyLift(0);
  assert.ok(Math.abs(s - 1.6) < 1e-9, `dawn underbelly is peak: got ${s}`);
}
{
  const s = cloudUnderbellyLift(0.5);
  assert.ok(Math.abs(s - 1.6) < 1e-9, `dusk underbelly is peak: got ${s}`);
}
{
  const s = cloudUnderbellyLift(0.25);
  assert.equal(s, 0, `noon underbelly is 0: got ${s}`);
}
{
  const s = cloudUnderbellyLift(0.75);
  assert.equal(s, 0, `midnight underbelly is 0: got ${s}`);
}
// Continuity and range.
for (let i = 0; i <= 200; i += 1) {
  const df = i / 200;
  const s = cloudUnderbellyLift(df);
  assert.ok(Number.isFinite(s) && s >= 0 && s <= 1.6 + 1e-9, `underbelly in range; df=${df} s=${s}`);
}
// Halfway between noon and dusk — lift between 0 and peak.
{
  const s = cloudUnderbellyLift(0.375);
  assert.ok(s > 0 && s < 1.6, `df=0.375 underbelly=${s} between 0 and peak`);
}

// ── shader source carries the raymarch operations ───────────────────────
// A future silent shader edit that removed the HG phase, the sun
// march, the coverage threshold, or the front-to-back composite
// would drain the volumetric read. Names are stamped in the source.

const frag = buildCloudFragmentShader(24, 4);
assert.ok(frag.includes("#define PRIMARY_STEPS 24"), "primary count stamped as GLSL #define");
assert.ok(frag.includes("#define SUN_STEPS 4"), "sun count stamped as GLSL #define");
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
// r9-0 additions: vertical stratification, pink underbelly, multi-scatter,
// silver-lining. Named in the source so a silent removal fails here
// before the pink drains out of the frame.
assert.ok(frag.includes("uHorizonPink"), "fragment tints base samples with horizon-pink");
assert.ok(frag.includes("uUnderbellyLift"), "fragment lifts sun contribution near slab base");
assert.ok(frag.includes("uMsBoost"), "fragment integrates multi-scatter interior lift");
assert.ok(frag.includes("uSilverLining"), "fragment sharpens forward-scatter into silver lining");
assert.ok(frag.includes("basePref"), "fragment computes vertical stratification");
assert.ok(frag.includes("phaseSilver"), "fragment carries the narrow silver-lining lobe");
assert.ok(frag.includes("msLight"), "fragment carries the multi-scatter contribution");
assert.ok(frag.includes("bellyGain"), "fragment applies the underbelly-lift multiplier");

// vertex reconstructs the world ray
assert.ok(cloudVertexShader.includes("uInvViewProj"), "vertex uses the inverse view-projection matrix");
assert.ok(cloudVertexShader.includes("vRayDir"), "vertex passes the world-space ray direction to fragment");
assert.ok(cloudVertexShader.includes("uCamPos"), "vertex reads the camera world position");

// tier-dependent step counts land in the shader
{
  const medium = buildCloudFragmentShader(8, 2);
  assert.ok(medium.includes("#define PRIMARY_STEPS 8"), "medium: 8 primary steps stamped");
  assert.ok(medium.includes("#define SUN_STEPS 2"), "medium: 2 sun steps stamped");
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
    // r9-0 additions
    "uHorizonPink", "uUnderbellyLift", "uMsBoost", "uSilverLining",
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
  // r9-0: dusk update writes the pink-underbelly uniforms.
  assert.ok(Math.abs(uAtDusk.uUnderbellyLift.value - 1.6) < 1e-9, "dusk writes underbelly peak");
  assert.ok(Math.abs(uAtDusk.uMsBoost.value - 0.35) < 1e-9, "dusk writes multi-scatter peak");
  assert.ok(Math.abs(uAtDusk.uSilverLining.value - 0.55) < 1e-9, "dusk writes silver-lining peak");
  // Without an override the analytical pink lands.
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.x - CLOUD_HORIZON_PINK_R) < 1e-9,
    "dusk without override: analytical R");
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.y - CLOUD_HORIZON_PINK_G) < 1e-9,
    "dusk without override: analytical G");
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.z - CLOUD_HORIZON_PINK_B) < 1e-9,
    "dusk without override: analytical B");
  // A caller-provided horizonPink takes precedence over the analytical
  // curve — the Preetham path in City.tsx feeds a physical sample.
  clouds.update({
    dayFraction: 0.5,
    sunDir: new V3(0, 1, 0),
    sunColor: new Color(1, 0.8, 0.6),
    ambientColor: new Color(0.5, 0.6, 0.75),
    cityTimeMs: 12345,
    tier: "high",
    camera,
    horizonPink: { r: 1.2, g: 0.55, b: 0.8 },
  });
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.x - 1.2) < 1e-9, "override R lands");
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.y - 0.55) < 1e-9, "override G lands");
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.z - 0.80) < 1e-9, "override B lands");
  // A noon update collapses the underbelly-lift back to zero — no
  // pink at midday, when the sun is overhead.
  clouds.update({
    dayFraction: 0.25,
    sunDir: new V3(0, 1, 0),
    sunColor: new Color(1, 0.8, 0.6),
    ambientColor: new Color(0.5, 0.6, 0.75),
    cityTimeMs: 12345,
    tier: "high",
    camera,
  });
  assert.equal(uAtDusk.uUnderbellyLift.value, 0, "noon: underbelly lift zeroed");
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.x - 1) < 1e-9, "noon: pink tint neutral R");
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.y - 1) < 1e-9, "noon: pink tint neutral G");
  assert.ok(Math.abs(uAtDusk.uHorizonPink.value.z - 1) < 1e-9, "noon: pink tint neutral B");
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
  "24/8/0 tier ladder, HG g=0.6 for silver-lining phase, raymarch operations named, " +
  "r9-0: horizon-pink (1.35, 0.60, 0.72) peaks at dusk/dawn, underbelly-lift 1.6, " +
  "multi-scatter 0.35, silver-lining 0.55, all four uniforms + shader ops named.",
);
