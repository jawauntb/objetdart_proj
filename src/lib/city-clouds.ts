/**
 * city-clouds — a raymarched volumetric cloud slab occluding the sun disk.
 *
 * Every reference in the brief carries real clouds. The SF-day photo has
 * a scatter of cumulus above the financial district; the London sunset
 * has pink-lit underbellies drifting past the Gherkin; the London dusk
 * has moody stratocumulus catching sodium-orange from the streetlamps
 * below. The Preetham sky module we ship (city-sky.ts) does an
 * atmospheric scatter tuned by turbidity — a beautiful analytic sky, but
 * a cloudless one. The Preetham dome is the loudest procedural tell in
 * the current frame.
 *
 * This module raymarches a screen-space fragment through a horizontal
 * slab of cloud at ~800 m altitude in world units, computes a single
 * scattering estimator per sample (Henyey-Greenstein phase toward the
 * sun × Beer-Lambert extinction along the sun ray), integrates
 * front-to-back with alpha compositing, and composites the result on
 * top of the Preetham sky. The full-screen mesh lives in the world scene
 * BEHIND the skyline pass (transparent + depthWrite off + renderOrder
 * greater than the sky mesh so it draws OVER the sky but the skyline
 * still occludes it correctly through clearDepth on the skyline pass).
 *
 * Pieces:
 *
 *   1. CLOUD_BASE_ALT / CLOUD_TOP_ALT
 *      A 200 m-thick slab from y=700 to y=900 in world units. Below this
 *      slab the buildings live (max ~180 m for the tallest event tower);
 *      above it is the sky dome (SKY_RADIUS 4.5e5). The choice sits well
 *      above the tallest tower so a cloud can occlude the sun without
 *      grazing a skyscraper.
 *
 *   2. Coverage curve (cloudCoverageForDay)
 *      A slow-changing scalar in [0..1] that acts as a density-noise
 *      threshold. Higher coverage → more cloud. The curve reads noon as
 *      broken-cumulus (0.55), dusk as building (0.65), midnight as
 *      overcast-thin (0.60), dawn as clearing (0.50). Coupled to
 *      dayFraction on a single sinusoid so the drift is monotonically
 *      smooth over a day.
 *
 *   3. Density curve (cloudDensityForDay)
 *      Scales the sampled noise once the coverage threshold is met. Lower
 *      at noon (thin high cumulus), peak at dusk (thick storm) — matches
 *      the emotional peak the brief calls out.
 *
 *   4. Wind (cloudWindOffset)
 *      An easterly wind at 6 m/s advects the noise UV over time. This is
 *      what makes the sky READ as weather-in-motion instead of a frozen
 *      texture. The offset is a pure function of cityTimeMs so a
 *      re-mount at the same city-time gets the same clouds — the world
 *      is deterministic in cityTimeMs, and clouds join that determinism.
 *
 *   5. Tiers (cloudStepsForTier, cloudsEnabledForTier)
 *      high    → 48 primary steps + 6 sun steps (the brief's number)
 *      medium  → 32 primary steps + 4 sun steps
 *      low     → mesh.visible = false, no draw
 *      sleep   → same as low
 *
 *   6. Sun scattering
 *      Along the primary ray we sample a low-frequency 3D noise. At
 *      every non-zero sample we cast a SHORT sun ray (~120 m, 6 steps at
 *      high tier) and sum the density along it; extinction is
 *      exp(-tau * density) per Beer-Lambert. The energy scattered
 *      toward the camera is (phase(mu, g) × transmittance_sun) where
 *      phase is Henyey-Greenstein with g=0.6 — a forward-scattering
 *      lobe that makes cloud EDGES near the sun appear bright rimmed
 *      (silver lining) and BEHIND-sun cloud appear dark. This is the
 *      specific look that makes the London-sunset reference read as
 *      photograph, not diagram.
 *
 *   7. Colour
 *      Each accumulated scatter is tinted by an ambient tone (the
 *      Preetham sky at zenith) plus a sun tone (the sun's own warm
 *      radiance × sun-transmittance × phase). At dusk the sun tone
 *      swings gold → copper → pink; the ambient tone follows the sky
 *      to indigo. The result is pink-lit undersides against a
 *      violet zenith — the London-sunset reference in one shader.
 *
 * Pure-math halves are exported so scripts/test-city-clouds.mjs can pin
 * the curves and constants without touching WebGL:
 *
 *   cloudCoverageForDay(df)      — 0..1 coverage threshold
 *   cloudDensityForDay(df)       — 0.4..1.4 density multiplier
 *   cloudWindOffset(cityTimeMs)  — {x, y} wind offset in UV space
 *   cloudStepsForTier(tier)      — { primary, sun }
 *   cloudsEnabledForTier(tier)   — boolean
 *   CLOUD_BASE_ALT, CLOUD_TOP_ALT, CLOUD_HG_G, CLOUD_WIND_MPS
 *
 * Zero coupling to city.ts laws, gestures, audio, or persistence. The
 * module is a pure post-attach layer inside the world scene. A future
 * refactor that widened the slab to 400 m or shifted the base altitude
 * would drift the aesthetic; the tests pin the four numbers so any drift
 * shows up before it hits the frame.
 */

import * as THREE from "three";
import type { QualityTier } from "@/lib/room-runtime";

// ── constants pinned by the brief ────────────────────────────────────────

/**
 * Cloud slab base altitude in world units.
 *
 * The brief calls for ~800 m; we place the slab from 700 to 900 so the
 * midpoint reads at exactly 800. Below the base the tallest event tower
 * (~180 m in city-geometry) still has a comfortable ~500 m of clear
 * air, so a cloud edge never grazes a rooftop.
 */
export const CLOUD_BASE_ALT = 700;

/**
 * Cloud slab top altitude in world units. A 200 m-thick slab is enough
 * for a raymarch to accumulate meaningful density even with only 48
 * steps, without so thick that the near-sun sample would over-integrate.
 */
export const CLOUD_TOP_ALT = 900;

/**
 * Henyey-Greenstein phase g. Positive g = forward-scattering lobe (light
 * that came from the sun continues toward the camera on a nearby angle),
 * negative g = back-scattering. 0.6 gives the "silver lining" halo the
 * London-sunset reference is about: cloud edges near the sun blaze,
 * cloud interiors darken. A future refactor to 0 (isotropic) would kill
 * the halo; the test pins the value.
 */
export const CLOUD_HG_G = 0.6;

/**
 * Wind speed in metres per second. 6 m/s is a soft easterly — enough
 * that the noise UV drifts visibly across a minute of city-time, not so
 * much that a cloud shape morphs faster than the eye can grasp. Kept as
 * a metres-per-second constant so a future refactor to city-scale wind
 * (a weather system) can plug in via an override.
 */
export const CLOUD_WIND_MPS = 6.0;

/**
 * Peak horizon-pink chroma at dusk / dawn. A dusty pink centred at ~2300 K
 * blackbody with a Rayleigh red-shift pulled through 6 airmasses of
 * atmosphere — this is the colour that the setting sun's remaining light
 * actually is once it has crossed the sideways-longest atmospheric path
 * on the way to a cloud underside. Kept as a linear-space vec3 so it
 * feeds the ShaderMaterial and the tests uniformly.
 *
 *   R = 1.35  → boosted red channel (the horizon flush)
 *   G = 0.60  → mid green, warm not gold
 *   B = 0.72  → lifted blue — this is what tips the tone from ORANGE
 *               toward PINK, matching the London-dusk reference. A pure
 *               orange (0.20-ish blue) would be the SF-noon sun; the
 *               London-sunset reference has a distinctly cool-pink
 *               undertone, and that is what this constant captures.
 *
 * A future refactor that dropped the blue toward 0.2 would drift the
 * aesthetic toward SF-day orange; one that pushed the green above 0.8
 * would flatten the tint toward salmon. Test pins the value.
 */
export const CLOUD_HORIZON_PINK_R = 1.35;
export const CLOUD_HORIZON_PINK_G = 0.60;
export const CLOUD_HORIZON_PINK_B = 0.72;

/**
 * Peak multi-scatter contribution at dusk. Bouthors / Wrenninge use a
 * Taylor-series expansion of the RTE where each order contributes an
 * exponentially-decaying share; we cap the sum at 0.35 (a moderate
 * lift, not a wash-out) at the emotional peak. At noon multi-scatter
 * is negligible because sun-transmittance is already high enough that
 * the interior samples read plausibly bright without the lift.
 *
 * The test pins the peak so a regression that dropped it to zero
 * would return the cloud interiors to pure black at dusk — a diagram,
 * not a photograph.
 */
export const CLOUD_MS_PEAK = 0.35;

/**
 * Peak silver-lining boost at dusk. The forward-scattering lobe uses
 * g=0.6 (the module's HG constant); the silver-lining boost mixes in
 * a much narrower g=0.9 lobe when the sample sits near the sun's
 * horizontal direction. 0.55 is a moderate silver — enough to make
 * cloud edges near the sun BLAZE the way the London reference shows,
 * not so much that a broken cumulus becomes a spotlight.
 */
export const CLOUD_SILVER_PEAK = 0.55;

/**
 * Peak underbelly-lift at dusk. Samples near the slab base get their
 * sun contribution multiplied by (1 + uUnderbellyLift), which is the
 * physical read of horizon light illuminating the underside of a
 * cloud more strongly than the top (the top sees the zenith sky
 * directly, the bottom sees the horizon sun grazing sideways).
 *
 *   df=0.25 (noon)   → 0.0  (sun is overhead; base and top light equally)
 *   df=0.5  (dusk)   → 1.6  (peak — underbelly ignites)
 *   df=0.75 (midnight) → 0.0 (no sun to light the underbelly)
 *
 * Test pins the four cardinals — a regression that flipped noon to peak
 * would render the SF-day photo with lit cloud bottoms and no lit tops,
 * inverting the reference. A regression that dropped dusk to 0 would
 * kill the pink-underbelly read entirely.
 */
export const CLOUD_UNDERBELLY_PEAK = 1.6;

/**
 * Horizon-pink tint as a function of dayFraction. Peaks at dusk
 * (df=0.5) and dawn (df=0) — both moments when the sun crosses the
 * horizon and its light is Rayleigh-reddened through six airmasses
 * of atmosphere. At noon the tint is a neutral (1,1,1) — no pink
 * bias, the sun colour rides straight through.
 *
 * The curve is a triangular ramp on horizon-proximity: 1 at either
 * horizon crossing, 0 at noon and midnight. Multiplied against the
 * peak vec3 constant above so the result is smoothly interpolable
 * between neutral (noon) and full pink (horizon).
 *
 * Exported and pure so scripts/test-city-clouds.mjs can pin the
 * curve at the four cardinal times.
 */
export function cloudHorizonPink(dayFraction: number): {
  r: number;
  g: number;
  b: number;
} {
  const f = ((dayFraction % 1) + 1) % 1;
  // Distance to nearest horizon crossing (df=0 or df=0.5) on wrapped axis.
  const dDawn = Math.min(f, 1 - f);
  const dDusk = Math.abs(f - 0.5);
  const dHoriz = Math.min(dDawn, dDusk);
  // Ramp: 1 at horizon (d=0), 0 at 0.25 away (noon or midnight).
  const t = Math.max(0, 1 - dHoriz * 4);
  // Smoothstep so the ramp is continuous in slope at the horizon.
  const s = t * t * (3 - 2 * t);
  return {
    r: 1 + (CLOUD_HORIZON_PINK_R - 1) * s,
    g: 1 + (CLOUD_HORIZON_PINK_G - 1) * s,
    b: 1 + (CLOUD_HORIZON_PINK_B - 1) * s,
  };
}

/**
 * Multi-scatter Taylor-series lift as a function of dayFraction. The
 * lift is a Wrenninge/Bouthors trick: interior cloud samples where the
 * primary-ray sun-transmittance has dropped to near-zero would normally
 * read pure black, but real cumulus interiors are lit by multi-scatter
 * from surrounding cloud. We approximate that as a bounded additive
 * term whose peak scales with the day's density curve — thicker cloud
 * at dusk feeds a larger multi-scatter reservoir.
 *
 *   df=0.25 (noon)   → 0.10  (thin cumulus — negligible interior lift)
 *   df=0.5  (dusk)   → 0.35  (peak — pink glow through thick storm)
 *   df=0.75 (midnight) → 0.20 (moon-lit cool overcast interior)
 *
 * Test pins the peak.
 */
export function cloudMultiScatterForDay(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  // Broad hump at dusk. Base 0.15, amplitude 0.20.
  const s = 0.15 + 0.20 * Math.sin(f * Math.PI * 2 - Math.PI * 0.5);
  return s < 0 ? 0 : s > CLOUD_MS_PEAK ? CLOUD_MS_PEAK : s;
}

/**
 * Silver-lining boost as a function of dayFraction. The forward
 * scatter lobe (HG g=0.6) is what gives the base of the shader its
 * halo; a secondary narrow lobe (g=0.9) mixed in near the sun turns
 * the halo into a sharp silver edge on cloud shoulders facing the
 * sun.
 *
 *   df=0.25 (noon)   → 0.30  (whisper — sun overhead, halo is a rim)
 *   df=0.5  (dusk)   → 0.55  (peak — the London reference)
 *   df=0.75 (midnight) → 0.10 (moon; a hint of silver on the leading edge)
 *
 * Test pins the peak.
 */
export function cloudSilverLiningForDay(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  const s = 0.30 + 0.25 * Math.sin(f * Math.PI * 2 - Math.PI * 0.5);
  return s < 0 ? 0 : s > CLOUD_SILVER_PEAK ? CLOUD_SILVER_PEAK : s;
}

/**
 * Underbelly-lift as a function of dayFraction. See CLOUD_UNDERBELLY_PEAK
 * for the physics. Curve peaks at dusk, zero at noon and midnight —
 * the underbelly-lift is a horizon-only phenomenon.
 *
 *   df=0.0  (dawn)   → 1.6 (peak — underbelly ignites)
 *   df=0.25 (noon)   → 0.0
 *   df=0.5  (dusk)   → 1.6 (peak — the London reference)
 *   df=0.75 (midnight) → 0.0
 *
 * A future regression that peaked at noon would inverting the reference
 * (bright bottoms of clouds mid-day is not how sunlight works). Test
 * pins the four cardinals.
 */
export function cloudUnderbellyLift(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  const dDawn = Math.min(f, 1 - f);
  const dDusk = Math.abs(f - 0.5);
  const dHoriz = Math.min(dDawn, dDusk);
  // Ramp: peak at horizon (d=0), 0 at 0.25 away (noon or midnight).
  const t = Math.max(0, 1 - dHoriz * 4);
  const s = t * t * (3 - 2 * t);
  return CLOUD_UNDERBELLY_PEAK * s;
}

/**
 * Coverage curve as a function of dayFraction.
 *
 * The curve is a slow sinusoid so the sky reads:
 *   dayFraction=0    (dawn horizon)     → 0.500 (clearing)
 *   dayFraction=0.25 (noon)             → 0.575 (broken cumulus)
 *   dayFraction=0.5  (dusk horizon)     → 0.650 (thick, storm-lit)
 *   dayFraction=0.75 (midnight)         → 0.575 (overcast, moon-thin)
 *
 * Higher = more cloud (the sample noise must exceed 1-coverage to be
 * cloud). Clamped to [0..1] so an over-eager wrap never picks up a
 * negative coverage.
 *
 * Exported so scripts/test-city-clouds.mjs can pin the four cardinal
 * numbers — a future regression that flipped noon to overcast or
 * midnight to clear would drain the reference photos and this test
 * would fail before the frame did.
 */
export function cloudCoverageForDay(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  // A gentle 24 h oscillation biased toward dusk: base 0.575 + amp 0.075
  // where the peak sits at df=0.5 (dusk).
  const c = 0.575 + 0.075 * Math.sin(f * Math.PI * 2 - Math.PI * 0.5);
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/**
 * Density multiplier as a function of dayFraction.
 *
 *   dayFraction=0    → 0.7  (cold thin cirrus at dawn)
 *   dayFraction=0.25 → 1.0  (medium wispy cumulus at noon)
 *   dayFraction=0.5  → 1.3  (thick storm at dusk — the emotional peak)
 *   dayFraction=0.75 → 1.0  (moon-lit overcast at midnight)
 *
 * The value multiplies the raw noise sample after the coverage threshold
 * remaps it into a positive density. A future refactor that flipped
 * noon to peak density would kill the wispy-cumulus SF reference.
 */
export function cloudDensityForDay(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  // Broad hump centered at dusk. Peak 1.3, trough at noon 0.7.
  const d = 1.0 + 0.3 * Math.sin(f * Math.PI * 2 - Math.PI * 0.5);
  return d < 0 ? 0 : d;
}

/**
 * Wind offset in noise-space UV as a function of cityTimeMs.
 *
 * A pure easterly wind: x drifts positive with time, y stays put.
 * cityTimeMs is the visitor's persisted city clock — a re-mount at the
 * same cityTimeMs yields the same wind offset, so the clouds you saw
 * yesterday are the clouds you see today at the same city time.
 *
 * The math is straight advection: offset_x = WIND_MPS * seconds / SCALE
 * where SCALE is the noise unit (we use 300 m so the wind takes ~50 s of
 * city-time to move the noise one full cycle — visible over a minute
 * of watching, not so fast the sky whips).
 *
 * Returns a plain object rather than a THREE.Vector2 so the pure-math
 * tests can run without a Vector2 stub.
 */
export function cloudWindOffset(cityTimeMs: number): { x: number; y: number } {
  const seconds = cityTimeMs / 1000;
  const NOISE_SCALE_M = 300;
  return {
    x: (CLOUD_WIND_MPS * seconds) / NOISE_SCALE_M,
    y: 0,
  };
}

/**
 * Governor tier → step budget.
 *
 *   high    → 48 primary + 6 sun (the brief's number)
 *   medium  → 32 primary + 4 sun
 *   low     → 0 primary + 0 sun (mesh hidden, cost zero)
 *   sleep   → 0 primary + 0 sun (mesh hidden, cost zero)
 *
 * The primary count is stamped into GLSL as a #define at compile time
 * so WebGL 1's constant-loop-bound rule is satisfied. When the tier
 * changes the module rebuilds the shader — cheap on desktop, and a rare
 * event (only on governor transitions).
 */
export function cloudStepsForTier(tier: QualityTier): {
  primary: number;
  sun: number;
} {
  switch (tier) {
    case "high":
      return { primary: 48, sun: 6 };
    case "medium":
      return { primary: 32, sun: 4 };
    case "low":
    case "sleep":
    default:
      return { primary: 0, sun: 0 };
  }
}

/**
 * Boolean sibling of cloudStepsForTier — is the cloud pass drawing at
 * all at this tier. False on low and sleep so the mesh hides entirely
 * and the fragment cost is zero on the slow devices that most need
 * the budget back.
 */
export function cloudsEnabledForTier(tier: QualityTier): boolean {
  return tier === "high" || tier === "medium";
}

// ── the shader ───────────────────────────────────────────────────────────

/**
 * Vertex shader — a full-screen triangle placed at the far NDC plane
 * so the sky mesh is behind and the skyline pass (which clears depth)
 * writes over. The world-space ray direction is reconstructed via the
 * inverse view-projection matrix and passed to the fragment for the
 * raymarch. Camera world position lives in a uniform (Three.js does
 * not expose it as a built-in on ShaderMaterial).
 */
const CLOUD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vRayDir;

  uniform mat4 uInvViewProj;
  uniform vec3 uCamPos;

  void main() {
    vUv = uv;
    // Position from PlaneGeometry(2,2) already lies in [-1..1] on XY.
    // Push z to the far plane so the depth test lets the skyline
    // pass's clearDepth overwrite. w=1 keeps NDC direct.
    vec4 ndcFar = vec4(position.xy, 1.0, 1.0);
    vec4 world = uInvViewProj * ndcFar;
    world /= world.w;
    vRayDir = normalize(world.xyz - uCamPos);
    gl_Position = ndcFar;
  }
`;

/**
 * Fragment shader — the raymarch itself.
 *
 * Steps:
 *
 *   1. Intersect the primary ray with the slab (two horizontal planes at
 *      y=CLOUD_BASE_ALT and y=CLOUD_TOP_ALT). If the ray never enters
 *      the slab (camera above looking up past the top, or below looking
 *      down through the ground) the fragment is a straight identity —
 *      no cloud, no alpha, sky shows through.
 *
 *   2. March N primary samples from tEnter to tExit. At each sample
 *      compute a 3D noise density from world position (with wind offset)
 *      and threshold against (1 - coverage) so most of the slab is
 *      clear air, only the pockets over threshold are cloud.
 *
 *   3. At each non-zero sample compute the single-scatter estimator:
 *
 *        L = phase(cos(theta), g) * transmittance_sun(sample)
 *
 *      where transmittance_sun is exp(-tau * sum(density_along_sun_ray))
 *      integrated over M sun-ray samples on a short march (~120 m).
 *
 *   4. Composite front-to-back with alpha:
 *
 *        alpha    += (1 - alpha) * (1 - exp(-density * dt))
 *        color    += (1 - alpha) * L * (sunTint + ambientTint)
 *
 *      The (1 - alpha) factor is the transmittance to the camera
 *      through cloud already traversed — the near samples occlude the
 *      far ones exactly as light does through a real cloud.
 *
 *   5. Output rgba where alpha is the cloud's total opacity at this
 *      pixel. The material is transparent, so gl_FragColor.rgb is
 *      composited over the sky beneath by GL alpha blend:
 *
 *        final = src.rgb * src.a + dst.rgb * (1 - src.a)
 *
 *      In effect the cloud shader shows through where alpha < 1.
 *
 * The primary sample count is a #define provided by the JS side so
 * WebGL 1's constant-loop rule is respected; a tier change rebuilds
 * the shader. Sun step count is also a #define.
 */
const CLOUD_FRAGMENT_TEMPLATE = /* glsl */ `
  precision highp float;

  // Stamped by JS from cloudStepsForTier — WebGL 1 needs a constant loop bound.
  #define PRIMARY_STEPS __PRIMARY_STEPS__
  #define SUN_STEPS __SUN_STEPS__

  varying vec2 vUv;
  varying vec3 vRayDir;

  uniform vec3  uCamPos;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uAmbientColor;
  uniform float uCoverage;
  uniform float uDensityMul;
  uniform vec2  uWindOffset;
  uniform float uSlabBase;
  uniform float uSlabTop;
  uniform float uHgG;
  /** Multiplier for the whole cloud contribution; used to fade clouds in
      or out under a tier transition without a hard pop. */
  uniform float uStrength;
  /** Horizon Rayleigh-reddened pink tint. Multiplied into the sun's
      light contribution at the BASE of the cloud slab so underbellies
      go pink at dusk. Neutral (1,1,1) at noon. */
  uniform vec3  uHorizonPink;
  /** Extra multiplier on the sun's contribution at the base of the slab
      (0 at top, uUnderbellyLift+1 at base). Peaks at dusk. */
  uniform float uUnderbellyLift;
  /** Multi-scatter Taylor-series contribution scalar. Lifts thick-cloud
      interiors from black toward the ambient/sun cast so a storm doesn't
      read as a black silhouette. Peaks at dusk. */
  uniform float uMsBoost;
  /** Silver-lining boost: mixes in a narrow g=0.9 HG lobe near the sun
      to sharpen the halo on cloud shoulders. Peaks at dusk. */
  uniform float uSilverLining;

  // Cheap 3D hash for value noise. Not a texture — a 32³ noise LUT would
  // read more organically but at the cost of a 32 KB texture the module
  // would have to bake and dispose. The hash suffices for the low-frequency
  // structure the brief calls for; the wind advection keeps it moving.
  float hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  // Trilinearly-interpolated value noise. One octave. The FBM adds
  // detail below.
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f); // smoothstep
    float n000 = hash3(i + vec3(0,0,0));
    float n100 = hash3(i + vec3(1,0,0));
    float n010 = hash3(i + vec3(0,1,0));
    float n110 = hash3(i + vec3(1,1,0));
    float n001 = hash3(i + vec3(0,0,1));
    float n101 = hash3(i + vec3(1,0,1));
    float n011 = hash3(i + vec3(0,1,1));
    float n111 = hash3(i + vec3(1,1,1));
    float nx00 = mix(n000, n100, u.x);
    float nx10 = mix(n010, n110, u.x);
    float nx01 = mix(n001, n101, u.x);
    float nx11 = mix(n011, n111, u.x);
    float nxy0 = mix(nx00, nx10, u.y);
    float nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
  }

  // Two-octave FBM tuned for the low-frequency cumulus shape the brief
  // calls out. The first octave is the settlement-scale drift; the
  // second is the puff. Not three octaves — we want cumulus, not
  // stratocumulus fibre; keep the shader cheap.
  float fbm(vec3 p) {
    float f = 0.0;
    f += 0.60 * noise3(p);
    f += 0.30 * noise3(p * 2.03 + vec3(17.0, 41.0, 23.0));
    return f;
  }

  // Density at a world-space sample. UV wind advects horizontally; y
  // stays put (clouds drift with wind, not upward). Coverage is a
  // threshold — subtract (1 - coverage) so most of the slab is clear
  // air. Vertical shape falls off from centre so cloud edges are soft
  // top/bottom, not razor-cut.
  float densityAt(vec3 wpos) {
    // Advect horizontally by the wind offset. Vertical unchanged.
    vec3 samplePos = vec3(
      (wpos.x / 300.0) + uWindOffset.x,
      wpos.y / 300.0,
      (wpos.z / 300.0) + uWindOffset.y
    );
    float raw = fbm(samplePos);
    // Threshold — everything below (1 - coverage) is clear air.
    float d = max(0.0, raw - (1.0 - uCoverage));
    // Vertical shape falls off from the midpoint of the slab so a
    // cloud has a soft top and a soft bottom. Half-height 100 m.
    float midY = (uSlabBase + uSlabTop) * 0.5;
    float halfH = (uSlabTop - uSlabBase) * 0.5;
    float v = 1.0 - abs(wpos.y - midY) / halfH;
    v = clamp(v, 0.0, 1.0);
    v = v * v * (3.0 - 2.0 * v);
    return d * v * uDensityMul;
  }

  // Henyey-Greenstein phase function. cosTheta is dot(-viewDir, sunDir).
  // g controls the lobe width — 0.6 is a broad forward-scattering
  // lobe that peaks at cosTheta=1 (sun straight ahead). A future
  // change to 0 would flatten the phase into isotropy.
  float hgPhase(float cosTheta, float g) {
    float g2 = g * g;
    float denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return (1.0 / (4.0 * 3.14159265358979)) * (1.0 - g2) / max(denom, 1e-4);
  }

  // Ray-slab intersection. Returns (tEnter, tExit); both zero if the
  // ray never enters the slab. rayDir must be normalised.
  vec2 raySlab(vec3 origin, vec3 rayDir, float yBase, float yTop) {
    // t at which the ray crosses each plane.
    float dy = rayDir.y;
    // Ray parallel to horizontal: entirely inside if origin is inside,
    // otherwise no intersection.
    if (abs(dy) < 1e-4) {
      if (origin.y >= yBase && origin.y <= yTop) return vec2(0.0, 1e5);
      return vec2(0.0);
    }
    float tBase = (yBase - origin.y) / dy;
    float tTop  = (yTop  - origin.y) / dy;
    float tEnter = min(tBase, tTop);
    float tExit  = max(tBase, tTop);
    // Both behind the camera → no intersection.
    if (tExit < 0.0) return vec2(0.0);
    tEnter = max(tEnter, 0.0);
    return vec2(tEnter, tExit);
  }

  void main() {
    // Identity short-circuit — a JS-side tier flip may leave uStrength=0
    // for a frame. Do nothing.
    if (uStrength <= 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec3 rayDir = normalize(vRayDir);
    vec2 tSlab = raySlab(uCamPos, rayDir, uSlabBase, uSlabTop);
    float tEnter = tSlab.x;
    float tExit  = tSlab.y;

    // Clamp the far end so a horizontal ray inside the slab never
    // marches 100 km through empty noise. 8 km is the maximum
    // integration distance for a sensible cumulus march.
    tExit = min(tExit, tEnter + 8000.0);

    if (tExit <= tEnter) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float dt = (tExit - tEnter) / float(PRIMARY_STEPS);
    float cosTheta = dot(rayDir, uSunDir);
    // Primary forward-scattering lobe at g=0.6 — the general halo the
    // reference clouds carry all day. Silver-lining boost mixes in a
    // narrower g=0.9 lobe at dusk so the shoulders near the sun blaze.
    float phaseBase   = hgPhase(cosTheta, uHgG);
    float phaseSilver = hgPhase(cosTheta, 0.9);
    float phase = phaseBase + uSilverLining * phaseSilver;

    // Slab midpoint for the vertical stratification factor. Cached
    // outside the loop so the two arithmetic ops don't repeat per sample.
    float midY = (uSlabBase + uSlabTop) * 0.5;
    float halfH = max(1.0, (uSlabTop - uSlabBase) * 0.5);

    vec3 accumColor = vec3(0.0);
    float accumAlpha = 0.0;

    for (int i = 0; i < PRIMARY_STEPS; i++) {
      // Alpha saturation — bail once the ray is opaque enough that
      // further samples contribute below a JND.
      if (accumAlpha > 0.99) break;
      float t = tEnter + (float(i) + 0.5) * dt;
      vec3 samplePos = uCamPos + rayDir * t;
      float d = densityAt(samplePos);
      if (d <= 1e-4) continue;

      // Vertical stratification factor. basePref = 1 at slab base, 0 at
      // slab top. This is the "underbelly" factor — samples near the
      // base see more grazing horizon light and get the pink tint /
      // underbelly-lift; samples near the top see the zenith sky more
      // directly and get straight ambient. Smoothstep so a sample at
      // the exact midpoint transitions continuously.
      float vRel = (samplePos.y - uSlabBase) / (2.0 * halfH);
      vRel = clamp(vRel, 0.0, 1.0);
      float basePref = 1.0 - vRel;
      basePref = basePref * basePref * (3.0 - 2.0 * basePref);

      // Sun-ray transmittance: short march toward the sun, sum density.
      float sunTau = 0.0;
      float sunDt = 120.0 / float(SUN_STEPS);
      for (int j = 0; j < SUN_STEPS; j++) {
        vec3 sunPos = samplePos + uSunDir * (float(j) + 0.5) * sunDt;
        // Escape when we leave the slab — a sun ray above the top
        // sees clear air, so its contribution to tau ends.
        if (sunPos.y > uSlabTop || sunPos.y < uSlabBase) break;
        sunTau += densityAt(sunPos) * sunDt;
      }
      // Beer-Lambert extinction toward the sun. 0.006 tuned so a
      // sun-ray passing through the thickest cumulus attenuates to
      // ~30% (the copper underbelly at dusk) not to 5% (black).
      float sunT = exp(-sunTau * 0.006);

      // Ambient in-scatter — a fraction of the zenith sky reaches the
      // sample from all directions. We don't march the ambient ray;
      // it is approximated as a fixed transmittance to keep the shader
      // affordable. This is the standard Bouthors / GPU Gems 3
      // simplification.
      float ambT = exp(-d * 40.0);

      // The horizon-pink tint applies most strongly at the BASE of the
      // slab and fades to neutral at the top — the physics is that
      // horizon-crossing light travels sideways under the cloud and lit
      // its underside; the top of the same cloud is lit by the zenith
      // sky, which is not pink.
      vec3 sunTint = mix(vec3(1.0), uHorizonPink, basePref);
      // Underbelly-lift: base samples get an extra multiplier on the sun
      // contribution. At noon uUnderbellyLift is 0 so this collapses to
      // 1 — no lift. At dusk basePref*uUnderbellyLift peaks at ~1.6 at
      // the bottom sample, doubling+ the sun's contribution there.
      float bellyGain = 1.0 + basePref * uUnderbellyLift;

      // Multi-scatter Taylor lift — Wrenninge's approximation of the
      // higher-order scatter that keeps thick cumulus interiors from
      // rendering as black voids. The lift scales with the surviving
      // sun-transmittance so a totally-shadowed sample stays dark
      // (physical), but a partly-lit interior gains a warm pink glow.
      // The 0.6+0.4*basePref factor biases the multi-scatter toward
      // the underbelly — where the light is spectrally pink.
      float msT = exp(-sunTau * 0.001);
      vec3 msLight = uSunColor * sunTint * msT * uMsBoost * (0.6 + 0.4 * basePref);

      // Sample light: (sun × phase × sun-transmittance × pink-tint ×
      // belly-gain) + (ambient × sky-transmittance × 0.35) + (multi-
      // scatter). Physically this is "how much of the sun made it to
      // this sample and scattered toward the camera along a Rayleigh-
      // reddened path" plus "how much of the sky reached and scattered
      // isotropically" plus "how much scattered light bounced through
      // the surrounding cloud and reached us here".
      vec3 lightHere =
          uSunColor * sunTint * bellyGain * phase * sunT
        + uAmbientColor * (1.0 - ambT) * 0.35
        + msLight;

      // Alpha step at this sample from the density and step length.
      float stepAlpha = 1.0 - exp(-d * dt * 0.02);
      // Front-to-back compositing. (1 - accumAlpha) is the remaining
      // transmittance to this sample; it multiplies both the colour
      // and the alpha increment.
      accumColor += (1.0 - accumAlpha) * lightHere * stepAlpha;
      accumAlpha += (1.0 - accumAlpha) * stepAlpha;
    }

    // Distance fade — clouds far below the horizon fade to the sky
    // colour so the ring around the horizon doesn't read as a hard
    // seam. tEnter is the camera-to-cloud distance for this fragment.
    // Both accumColor and accumAlpha scale together because the color
    // channel is already alpha-premultiplied from the front-to-back
    // accumulate — dropping alpha without dropping colour would emit
    // a bright cloud with zero opacity, which composites as an
    // additive light-leak instead of a soft horizon.
    float horizonFade = 1.0 - smoothstep(6000.0, 8000.0, tEnter);
    accumColor *= horizonFade;
    accumAlpha *= horizonFade;

    gl_FragColor = vec4(accumColor * uStrength, accumAlpha * uStrength);
  }
`;

/**
 * Compose the fragment source for a given primary/sun step count.
 *
 * We keep the loop bounds as GLSL #defines so WebGL 1 is happy; a tier
 * change rebuilds the ShaderMaterial with a fresh compiled program.
 * Rebuild is cheap (a shader compile) and rare (only on tier
 * transitions). Exported for the node test so a hash of the source can
 * catch a silent shader edit that changed the visual register.
 */
export function buildCloudFragmentShader(primary: number, sun: number): string {
  return CLOUD_FRAGMENT_TEMPLATE
    .replace("__PRIMARY_STEPS__", String(Math.max(1, primary)))
    .replace("__SUN_STEPS__", String(Math.max(1, sun)));
}

/**
 * The vertex shader source — exported for the same shader-inspection
 * reason as buildCloudFragmentShader.
 */
export const cloudVertexShader = CLOUD_VERTEX;

// ── the object ───────────────────────────────────────────────────────────

/**
 * The dynamic state the tick loop hands to update() each frame. Kept as
 * a plain object so callers can stack-construct it per tick without
 * allocating a Vector3.
 */
export type CloudsUpdate = {
  /** dayFraction in [0..1]. Drives coverage / density / colour. */
  dayFraction: number;
  /** Direction FROM origin TO sun (unit vector, y is up). */
  sunDir: THREE.Vector3;
  /** Sun tone in linear RGB — usually the directional light's colour × intensity. */
  sunColor: THREE.Color;
  /** Ambient tone in linear RGB — the sky zenith at this time of day. */
  ambientColor: THREE.Color;
  /** Persisted city time in ms. Drives wind advection. */
  cityTimeMs: number;
  /** Current governor tier. Selects shader loop bounds. */
  tier: QualityTier;
  /** The world-scene camera. */
  camera: THREE.PerspectiveCamera;
  /**
   * Optional horizon-pink tint the caller has sampled from the Preetham
   * sky at the sun's horizon direction. When present the module trusts
   * this over its analytical cloudHorizonPink curve — the sampled value
   * is what the physical atmosphere actually paints on the underside of
   * a cloud at horizon light. When null / omitted, the module falls back
   * to the analytical curve so no caller receives an unlit underbelly.
   *
   * A plain rgb object rather than a THREE.Color so the pure test suite
   * can drive it without a THREE dependency.
   */
  horizonPink?: { r: number; g: number; b: number } | null;
};

export type CityClouds = {
  /** The full-screen mesh to add to worldScene. */
  mesh: THREE.Mesh;
  /**
   * Update the clouds for this frame. Cheap: writes uniforms. Rebuilds
   * the shader only when the tier changes the step count.
   */
  update(state: CloudsUpdate): void;
  /** Free the geometry, material, and shader compilation. */
  dispose(): void;
};

export type CityCloudsOptions = {
  /** Initial governor tier — the shader compiles for this step count. */
  initialTier?: QualityTier;
};

/**
 * Build the cloud slab. Idempotent per worldScene — creating two
 * cloudslab meshes on the same scene is legal but only one is needed.
 *
 * The mesh uses a PlaneGeometry(2, 2) — a full-screen quad in NDC space
 * — with frustumCulled=false, depthWrite=false, depthTest=false,
 * transparent=true. renderOrder=1 so it draws after the sky mesh (which
 * defaults to renderOrder=0). The skyline pass runs afterwards with
 * clearDepth, so the skyline's z-buffer starts fresh and towers occlude
 * cloud pixels correctly from the visitor's angle even though the cloud
 * pass wrote no depth.
 *
 * The mesh's material is rebuilt when the tier changes the shader step
 * counts — cheap (a shader compile) and rare (only on tier transitions).
 */
export function createCityClouds(opts: CityCloudsOptions = {}): CityClouds {
  const initialTier: QualityTier = opts.initialTier ?? "high";
  let currentTier: QualityTier = initialTier;
  let currentSteps = cloudStepsForTier(currentTier);

  const geometry = new THREE.PlaneGeometry(2, 2);
  // Full-screen mesh — no camera transforms apply because the vertex
  // shader writes gl_Position directly from the position attribute.

  const invViewProj = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const sunDir = new THREE.Vector3(0, 1, 0);
  const sunColor = new THREE.Color(1.0, 0.85, 0.65);
  const ambientColor = new THREE.Color(0.5, 0.6, 0.75);

  function buildMaterial(steps: { primary: number; sun: number }): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name: "cityClouds",
      vertexShader: cloudVertexShader,
      fragmentShader: buildCloudFragmentShader(steps.primary, steps.sun),
      uniforms: {
        uInvViewProj: { value: invViewProj },
        uCamPos: { value: camPos },
        uSunDir: { value: sunDir },
        uSunColor: { value: new THREE.Vector3(sunColor.r, sunColor.g, sunColor.b) },
        uAmbientColor: { value: new THREE.Vector3(ambientColor.r, ambientColor.g, ambientColor.b) },
        uCoverage: { value: cloudCoverageForDay(0.25) },
        uDensityMul: { value: cloudDensityForDay(0.25) },
        uWindOffset: { value: new THREE.Vector2(0, 0) },
        uSlabBase: { value: CLOUD_BASE_ALT },
        uSlabTop: { value: CLOUD_TOP_ALT },
        uHgG: { value: CLOUD_HG_G },
        uStrength: { value: 1.0 },
        // Neutral at construction — the tick loop overwrites once the
        // dayFraction is known. A pass that never receives an update
        // still ships a plausible noon-cumulus frame.
        uHorizonPink: { value: new THREE.Vector3(1, 1, 1) },
        uUnderbellyLift: { value: 0 },
        uMsBoost: { value: cloudMultiScatterForDay(0.25) },
        uSilverLining: { value: cloudSilverLiningForDay(0.25) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // Alpha blend over the sky. The fragment writes premultiplied
      // colour (accumColor is already multiplied by the alpha step
      // during the front-to-back accumulate), so we ask GL to add the
      // source directly and multiply the destination by (1 - alpha).
      // NormalBlending would multiply the source by srcAlpha too, which
      // would double-scale the already-premultiplied colour and dim the
      // pink-lit underbellies at dusk.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
  }

  let material: THREE.ShaderMaterial = buildMaterial(currentSteps);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Draw AFTER the sky mesh (renderOrder=0 by default) so the cloud
  // pixels sit on top of the sky. The skyline pass runs later with
  // clearDepth; its own writes go through as usual.
  mesh.renderOrder = 1;
  mesh.name = "cityClouds";
  // Hide entirely on tiers where the clouds are disabled — the mesh is
  // in the scene graph but skipped by the renderer when visible=false.
  mesh.visible = cloudsEnabledForTier(currentTier);

  // Reusable scratch — Vector3 for sun colour uniform writes.
  const sunColorVec = new THREE.Vector3();
  const ambientColorVec = new THREE.Vector3();
  // Reusable scratch — Vector3 for the horizon-pink tint. Cheaper to
  // rewrite the members of a shared vec3 than to allocate a new one
  // per frame; the uniform pointer never moves.
  const horizonPinkVec = new THREE.Vector3(1, 1, 1);

  return {
    mesh,
    update(state: CloudsUpdate) {
      // Tier gate. Off entirely on low/sleep — mesh.visible=false so the
      // renderer skips the draw call. On high/medium the mesh is
      // visible; a tier change between the two rebuilds the shader
      // because the primary/sun step counts differ.
      const enabled = cloudsEnabledForTier(state.tier);
      mesh.visible = enabled;
      if (!enabled) return;

      if (state.tier !== currentTier) {
        const newSteps = cloudStepsForTier(state.tier);
        if (
          newSteps.primary !== currentSteps.primary ||
          newSteps.sun !== currentSteps.sun
        ) {
          // Rebuild material with new step counts. Old material is
          // disposed to free its compiled program.
          const old = material;
          material = buildMaterial(newSteps);
          mesh.material = material;
          try { old.dispose(); } catch { /* noop */ }
          currentSteps = newSteps;
        }
        currentTier = state.tier;
      }

      // Compose inverse view-projection matrix.
      state.camera.updateMatrixWorld();
      invViewProj.multiplyMatrices(
        state.camera.matrixWorld,
        state.camera.projectionMatrixInverse,
      );
      material.uniforms.uInvViewProj.value = invViewProj;

      camPos.setFromMatrixPosition(state.camera.matrixWorld);
      material.uniforms.uCamPos.value = camPos;

      // Sun direction: clone the incoming vector so the caller can
      // mutate theirs without stomping our uniform.
      sunDir.copy(state.sunDir).normalize();
      material.uniforms.uSunDir.value = sunDir;

      // Sun + ambient tones. Read via a Vector3 uniform (Three.js
      // ShaderMaterial takes vec3 as Vector3, not Color).
      sunColorVec.set(state.sunColor.r, state.sunColor.g, state.sunColor.b);
      material.uniforms.uSunColor.value = sunColorVec;
      ambientColorVec.set(state.ambientColor.r, state.ambientColor.g, state.ambientColor.b);
      material.uniforms.uAmbientColor.value = ambientColorVec;

      // Slow-changing day-driven scalars.
      material.uniforms.uCoverage.value = cloudCoverageForDay(state.dayFraction);
      material.uniforms.uDensityMul.value = cloudDensityForDay(state.dayFraction);

      // Horizon-pink tint. The caller may override with a physically-
      // sampled Preetham horizon colour (city-sky.ts's sampleSkyColor),
      // in which case we take it directly. If the caller passes null
      // (the pre-r9 path) we compute the analytical curve here so a
      // legacy caller still gets pink underbellies. The uniform vec3
      // is reused — mutating its members is cheaper than allocation.
      if (state.horizonPink) {
        horizonPinkVec.set(state.horizonPink.r, state.horizonPink.g, state.horizonPink.b);
      } else {
        const p = cloudHorizonPink(state.dayFraction);
        horizonPinkVec.set(p.r, p.g, p.b);
      }
      material.uniforms.uHorizonPink.value = horizonPinkVec;

      // Underbelly-lift, multi-scatter, silver-lining — all pure
      // functions of dayFraction. Each maps to a single uniform write.
      material.uniforms.uUnderbellyLift.value = cloudUnderbellyLift(state.dayFraction);
      material.uniforms.uMsBoost.value = cloudMultiScatterForDay(state.dayFraction);
      material.uniforms.uSilverLining.value = cloudSilverLiningForDay(state.dayFraction);

      // Wind offset from cityTimeMs — the pure function above.
      const wind = cloudWindOffset(state.cityTimeMs);
      material.uniforms.uWindOffset.value.set(wind.x, wind.y);
    },
    dispose() {
      try { geometry.dispose(); } catch { /* noop */ }
      try { material.dispose(); } catch { /* noop */ }
    },
  };
}
