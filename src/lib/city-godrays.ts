/**
 * city-godrays — volumetric sun shafts at dawn and dusk, and the
 * participating-media fog they scatter through.
 *
 * The emotional peak reference (London at dusk) reads as photoreal partly
 * because sun shafts scatter through the buildings — that specific dawn/
 * dusk light behaviour is not a texture, it is a screen-space post pass.
 * A radial blur toward the sun's projected screen position, run only on
 * high tier and only in the narrow horizon-crossing windows the sun
 * actually is at the horizon, is what carries the reference forward.
 *
 * On top of that shaft pass, R10-7 asks for participating-media fog: the
 * scene's FogExp2 is a distance-blend applied AFTER shading, so the
 * shafts the pass writes land on top of a FLAT fog wall — the shafts
 * do not scatter THROUGH the fog volume near the water. Both R6/#291's
 * FogExp2 and the shafts are photographically valid on their own, but
 * the sum reads as diorama: the fog is a wall, the shafts are a
 * transparency on top of it.
 *
 * The fix is a thin volumetric raymarch inside this same fragment shader.
 * For each screen pixel we reconstruct the view ray from the inverse
 * projection matrix, ray-plane-intersect against the water surface (or
 * clip at a long march distance for sky rays) to bound the march,
 * jitter the start position by a per-pixel dither so temporal AA cannot
 * band the low sample count, and step 20 taps along the ray. At each
 * step we accumulate:
 *   • density from an exponential HEIGHT profile — thick near the water,
 *     thinning upward, so the harbour reads as damp and the towers
 *     rise out of it,
 *   • in-scattering along the sun direction weighted by the
 *     Henyey-Greenstein phase function so a ray looking near the sun
 *     picks up more in-scatter than a ray looking away,
 *   • extinction via Beer-Lambert so the fog VOLUME occludes the shaft
 *     accumulator computed in the same shader — a shaft that would
 *     have been visible through clear air now dims as it crosses a
 *     thick harbour fog band.
 *
 * The two contributions are then combined:
 *   final = src * transmittance + fogInScatter * (1 - transmittance)
 *   final += rays * transmittance    ← the shafts get FOG-attenuated,
 *                                       so they scatter THROUGH the fog
 *                                       instead of sitting on top of it.
 *
 * This IS a participating medium: shafts and volume are lit by the same
 * sun and share the same extinction. The bloom pass downstream then
 * pulls a warm halo off the FOG-ATTENUATED shafts, so the ember at dusk
 * gathers on the shaft-lit fog volume — the register the London
 * reference actually is.
 *
 * The ShaderPass rides in the composer between the skyline/water render
 * passes and UnrealBloomPass — the shafts feed the bloom curve directly.
 * A dusk shaft crossing a glass tower's lit-window pixels lights those
 * pixels through the additive gold multiplier, and bloom's threshold
 * sieve then pulls a warm halo off the just-shafted pixels: the ember
 * peak the London reference is about is the sum of both, not either
 * alone. Placing the pass after bloom would still glow the shafts
 * themselves but would not extend the ember downstream; placing it
 * before bloom is what carries the emotional peak forward.
 *
 * SSAO sits before this pass in the chain, so the shafts add on top of
 * an already-AO'd frame — the ring of contact shadow under a tower's
 * footprint stays dark under the golden shaft, which is the physical
 * read (a shadow crevice does not glow just because the sun above it
 * shafts). Bloom sits after and pulls a warm halo off the shaft-lit
 * pixels; painterly + DOF sit downstream, so at bird's-eye the
 * register-shift warms the shafts along with the rest of the scene and
 * DOF blurs them along with the diorama.
 *
 * God-ray shaft gate (unchanged from R2):
 *   |dayFraction - 0| < 0.08  → the dawn horizon crossing window
 *   |dayFraction - 0.5| < 0.08 → the dusk horizon crossing window
 *
 * Volumetric fog gate (broader — participating media is present all day,
 * only its density and warmth ride the diurnal curve):
 *   density peaks broadly around dusk (df=0.5) and dawn (df=0),
 *   drops to a low but non-zero floor at noon (the harbour is never
 *   perfectly clear), and drops again at midnight so the emissive
 *   towers cut cleanly through the dark. The curve is a broad
 *   smoothstep on the horizon distance, gate 0.16 — twice the shaft
 *   gate — so the fog haze arrives BEFORE the shafts fire and outlasts
 *   them by a few dayFraction minutes on either side.
 *
 * Outside the shaft gate the shaft accumulator short-circuits to zero
 * and the pass ships fog-only (or, if the fog gate has also closed to
 * its floor and the density is at the noon floor, a near-identity pass
 * that still carries a whisper of harbour haze — the fog floor is not
 * zero because a photorealistic room without any atmospheric density
 * reads as sterile).
 *
 * Sampling:
 *   24 radial taps between the fragment and the sun's projected UV,
 *   geometric decay 0.94 per tap so the near-fragment taps dominate
 *   for the shafts. Each tap contributes only its LUMINANCE-thresholded
 *   contribution — a soft smoothstep(0.55, 1.0, lum) clamps against
 *   the tone-mapped brights downstream.
 *
 *   20 volumetric taps between the camera and the fragment (or the
 *   view-ray/water-plane intersection, whichever is nearer), jittered
 *   by a per-pixel dither so the 20 samples read as continuous under
 *   motion. Height falloff exp(-y/uFogHeightFalloff) times uFogDensity
 *   gives the per-step extinction; Henyey-Greenstein with g=uFogPhaseG
 *   gives the anisotropic in-scatter toward the sun.
 *
 * The warm gold tint the shaft ADDS on top of the source is not a hue
 * rotate — it is a multiply. So a cool cerulean pixel does not become
 * gold; only where the sun's own gold-copper radiance lands does the
 * shaft appear golden. The fog in-scatter is tinted by uFogColor,
 * which the composer feeds from `fogColorFromSky` — the same horizon
 * sample the world scene's FogExp2 already uses. So the volumetric
 * fog reads as the SAME sky the FogExp2 read against — R10-7's
 * complaint about the flat wall is fixed because the wall is now a
 * lit volume, not because the volume switched colour.
 *
 * The pass is additive over the source frame; a pixel with no ray
 * contribution and a fog-clear pixel column reads as identity.
 *
 * The pure-math halves — `godraysStrengthForDay(dayFraction)`,
 * `volumetricFogDensityForDay(dayFraction)`, `henyeyGreensteinPhase`,
 * and the gate constants — are exported alongside the pass constructor
 * so a node test can pin the curves at the four cardinal times and the
 * horizon crossings without touching WebGL. A future regression that
 * widened the shaft gate to 0.15 would let god-rays fire at noon; a
 * regression that removed the fog floor at noon would drop harbour
 * haze on the reference. The test names them.
 *
 * The composer's per-frame writes go into `uSunUv` (the projected sun
 * position in UV space), `uStrength` (the day-curve strength scaled
 * by the sun's visibility mask), `uSunDir` (the world-space sun
 * direction the fog in-scatter reads for its phase function),
 * `uCameraPos` (the world-space camera position the raymarch starts
 * from), `uInverseProjection` + `uInverseView` (the two mat4s that
 * reconstruct a per-pixel view ray), `uFogDensity` + `uFogColor`
 * (density and tint that ride the day curve), and `uWaterY` (the
 * height of the harbour plane, ~0.05, so the raymarch can bound
 * itself against the water instead of running to infinity). When the
 * sun is off-screen the shaft accumulator turns off via the
 * `uStrength <= 0` short-circuit; the fog raymarch still runs, so
 * a visitor rotating past the sun sees the harbour haze thicken
 * before the shafts arrive.
 *
 * This module never touches city.ts laws, gesture, room-runtime, or
 * persistence. It is a post-process register.
 */

import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * The half-width of the horizon-crossing gate, in dayFraction units.
 *
 * The brief pins the gate at 0.08 — narrow enough that god-rays never
 * fire at noon (df=0.25, distance 0.17 from dusk / 0.25 from dawn), wide
 * enough that the effect ramps in ~15 minutes on either side of the
 * horizon crossing so a fast day-scale twist does not pop it. A future
 * refactor that moved this constant would drift the aesthetic; the
 * test pins the value so any drift shows up before it hits the frame.
 */
export const GODRAYS_GATE_HALF_WIDTH = 0.08;

/**
 * Number of radial taps between the fragment and the sun's projected
 * screen position. The brief calls out "~24 radial taps"; 24 is the
 * value that reads as a smooth shaft on desktop and mobile alike
 * without pushing fragment cost past what a high-tier device can
 * afford in the post chain. Kept as a top-level constant so the
 * GLSL loop bound and any future preallocated buffer see the same
 * number, and the test can pin it.
 */
export const GODRAYS_SAMPLES = 24;

/**
 * The half-width of the volumetric-fog gate, in dayFraction units.
 *
 * The fog gate is TWICE the shaft gate — the participating medium is
 * present all day (harbour haze is not a switch), and its density
 * rises broadly on either side of a horizon crossing. R10-7 asked
 * specifically that the fog VOLUME arrive before the shafts fire and
 * outlast them on either side, so the shafts scatter through an
 * already-lit medium instead of through the frame's first fog frame.
 * The test pins 0.16 so a future refactor cannot narrow it.
 */
export const VOLUMETRIC_FOG_GATE_HALF_WIDTH = 0.16;

/**
 * Number of raymarch steps along the view ray for the participating-
 * media fog. The brief calls for "16-24 steps, jittered"; 20 is the
 * middle of that range — enough to smooth the accumulator across a
 * 400m harbour depth, few enough that on a high-tier device the whole
 * fragment (fog + 24 radial taps + composition) fits inside one bloom
 * frame's budget. Kept as a top-level constant so the GLSL loop bound
 * agrees with the JS side and the test pins the count.
 */
export const VOLUMETRIC_FOG_STEPS = 20;

/**
 * Floor density for the volumetric fog at noon and midnight. R10-7 asks
 * for a NON-zero baseline so the harbour never reads as a sterile
 * vacuum — a photograph of a real city always has some atmospheric
 * density, even at the clearest hour. The value is small enough that
 * a mid-day close-zoom onto a tower still reads as razor-sharp, large
 * enough that a wide-shot silhouette rings with a whisper of haze.
 * Pinned by the test.
 */
export const VOLUMETRIC_FOG_FLOOR = 0.06;

/**
 * Peak density at the horizon crossings. R10-7 calls out dusk shafts
 * scattering "through actual fog volume near the harbour" — the peak
 * value is what a dusk pier photograph would read. Kept as an
 * exported constant so a future refactor cannot silently drift the
 * peak while the floor stays pinned by the test.
 */
export const VOLUMETRIC_FOG_PEAK = 0.28;

/**
 * Distance to the nearest horizon crossing on the wrapped 0..1 day cycle.
 *
 * The two crossings are at dayFraction=0 (dawn) and dayFraction=0.5
 * (dusk). Both are wrap-aware — a dayFraction of 0.97 is 0.03 away from
 * dawn, not 0.97 away — so a visitor twisting the day-scale from
 * midnight into dawn sees the shafts arrive as the crossing approaches
 * from either side of zero.
 *
 * Exported and pure so scripts/test-city-godrays.mjs can pin the
 * distance at the cardinal times without touching WebGL.
 */
export function distanceToNearestHorizonCrossing(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  const dDawn = Math.min(f, 1 - f);   // wrap-aware distance to 0
  const dDusk = Math.abs(f - 0.5);    // dusk sits inside the unit interval
  return Math.min(dDawn, dDusk);
}

/**
 * Compute the god-rays strength (0..1) as a function of dayFraction.
 *
 * The curve is a linear ramp anchored at the two horizon crossings and
 * a hard zero everywhere outside the gate window. Deliberately linear
 * (not smoothstep) so the shaft ARRIVES on the horizon crossing like a
 * physical light effect, not like a slow s-curve rising into place —
 * dusk in the London reference does not ease-in-out, it lands.
 *
 * Below the gate:
 *   |dayFraction - 0| >= 0.08 AND |dayFraction - 0.5| >= 0.08 → 0
 * Inside the gate:
 *   strength = 1 - dNearest / GODRAYS_GATE_HALF_WIDTH
 * Clamped at both ends so an overshoot never picks up > 1.
 *
 * Exported so scripts/test-city-godrays.mjs can pin the curve at the
 * four cardinal times AND the horizon crossings — the brief's spec.
 */
export function godraysStrengthForDay(dayFraction: number): number {
  const d = distanceToNearestHorizonCrossing(dayFraction);
  if (d >= GODRAYS_GATE_HALF_WIDTH) return 0;
  const s = 1 - d / GODRAYS_GATE_HALF_WIDTH;
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/**
 * Whether the god-rays gate is open at all at this dayFraction. Handy
 * for the composer to skip the sun projection entirely on the ~84% of
 * the day that lives outside the gate. A pure boolean sibling of
 * godraysStrengthForDay — false wherever the strength curve is 0.
 */
export function godraysGateOpen(dayFraction: number): boolean {
  return distanceToNearestHorizonCrossing(dayFraction) < GODRAYS_GATE_HALF_WIDTH;
}

/**
 * Compute the participating-media fog density (0..1) as a function of
 * dayFraction. The curve is a smoothstep-augmented ramp between
 * VOLUMETRIC_FOG_FLOOR and VOLUMETRIC_FOG_PEAK, gated by
 * VOLUMETRIC_FOG_GATE_HALF_WIDTH — twice the shaft gate width, so the
 * fog haze arrives before the shafts fire and outlasts them on either
 * side. Never drops to zero: a photographic room always has some
 * atmospheric density.
 *
 *   dayFraction=0    (dawn horizon)     → VOLUMETRIC_FOG_PEAK
 *   dayFraction=0.25 (noon)             → VOLUMETRIC_FOG_FLOOR
 *   dayFraction=0.5  (dusk horizon)     → VOLUMETRIC_FOG_PEAK
 *   dayFraction=0.75 (midnight)         → VOLUMETRIC_FOG_FLOOR
 *
 * Exported so scripts/test-city-godrays.mjs can pin the curve without
 * touching WebGL.
 */
export function volumetricFogDensityForDay(dayFraction: number): number {
  const d = distanceToNearestHorizonCrossing(dayFraction);
  if (d >= VOLUMETRIC_FOG_GATE_HALF_WIDTH) return VOLUMETRIC_FOG_FLOOR;
  const t = 1 - d / VOLUMETRIC_FOG_GATE_HALF_WIDTH;
  // Smoothstep so the peak reads as a broad shoulder, not a sharp
  // triangle — the shafts are the sharp curve; the fog is the broad
  // atmospheric envelope they scatter through.
  const s = t * t * (3 - 2 * t);
  return VOLUMETRIC_FOG_FLOOR + s * (VOLUMETRIC_FOG_PEAK - VOLUMETRIC_FOG_FLOOR);
}

/**
 * Henyey-Greenstein phase function — the classical anisotropic
 * scattering distribution for atmospheric media, parameterised by an
 * asymmetry factor g in (-1..1). Positive g is forward-scattering
 * (haze around the sun's direction gets a bright halo); negative g
 * is back-scattering; g=0 collapses to isotropic scattering (1/4π,
 * here normalised to 1 at the isotropic point so the shader can
 * multiply the value directly without dragging the 4π in).
 *
 * Exported pure so the test can pin:
 *   g=0, cosTheta=any → 1 (isotropic)
 *   g=0.7, cosTheta=1 → strong forward peak (>2)
 *   g=0.7, cosTheta=-1 → back-scatter attenuation (<0.5)
 *
 * The shader uses g=0.6 for the harbour fog — moderately forward-
 * scattering, matches the Mie regime of small water droplets.
 */
export function henyeyGreensteinPhase(cosTheta: number, g: number): number {
  const g2 = g * g;
  const denom = 1 + g2 - 2 * g * cosTheta;
  // Full form: (1-g²) / (4π (1+g²-2g cosθ)^(3/2)) — we drop the 4π so
  // an isotropic scattering pass reads as 1.0 rather than 1/(4π), and
  // the shader can multiply the value directly into the in-scatter
  // accumulator without a magic number.
  return (1 - g2) / Math.pow(Math.max(1e-4, denom), 1.5);
}

/**
 * A projected sun position in normalized-device space, as a small
 * ready-to-write value the composer computes each tick and hands to
 * render(). `visible` is false when the sun is behind the camera or
 * out of the near/far clip; the pass reads it and turns into a
 * passthrough when the sun would drag the radial taps toward a point
 * off-screen where there are no bright pixels to gather.
 *
 * Kept as a plain object so callers can construct one on the stack per
 * frame without allocating a Vector — the god-rays hot path is one
 * uniform write per frame in the composer.
 */
export type GodraysSunPosition = {
  /** Projected NDC x in [-1..1]. */
  x: number;
  /** Projected NDC y in [-1..1]. */
  y: number;
  /**
   * True when the sun is in front of the camera (project().z < 1) AND
   * within ~1.5× the frame in either axis. The 1.5× soft margin lets
   * shafts persist for a moment as the visitor pans off-sun, instead
   * of hard-cutting when the sun's projected point steps past the
   * edge of the frame.
   */
  visible: boolean;
};

/**
 * Compute the sun's projected screen position from a world-space sun
 * vector (the direction the sun light points FROM) and a Three.js
 * PerspectiveCamera. Returns a stable NDC pair plus a visibility flag.
 *
 * A directional light's `.position` is a placement in world space at
 * some large distance along the sun direction; passing that position
 * to camera.project() gives the NDC coordinate of the sun disk. When
 * the sun is behind the camera, `project()`'s z component exceeds 1;
 * we clamp visibility off in that case so the shafts do not fire
 * toward a point that isn't in the frame.
 *
 * Exported so the composer OR a future overlay UI could share the
 * same projection, and so the test can pin the visibility rules.
 */
export function projectSunToScreen(
  sunWorldPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera | THREE.Camera,
): GodraysSunPosition {
  const v = sunWorldPos.clone().project(camera);
  const behind = v.z > 1;
  // Soft off-screen margin: 1.5× the frame in either axis. Shafts fade
  // out gracefully as the sun exits the visible frame rather than
  // popping off at the edge.
  const off = Math.abs(v.x) > 1.5 || Math.abs(v.y) > 1.5;
  return { x: v.x, y: v.y, visible: !behind && !off };
}

/**
 * GLSL uniform block for the god-rays ShaderPass. Shared type so the
 * composer (which writes to these per frame) and the pass itself can
 * not drift — a future rename of `uSunUv` to `uSunPos` would break
 * both sides at once, not one side silently.
 */
export type GodraysUniforms = {
  tDiffuse: { value: THREE.Texture | null };
  /** Sun position in UV space [0..1]²; (-1,-1) when off-screen. */
  uSunUv: { value: THREE.Vector2 };
  /** 0..1 shaft strength — the composer writes this per frame. */
  uStrength: { value: number };
  /** Warm gold multiplier the shaft carries. Composer may tune per tier. */
  uWarmTint: { value: THREE.Vector3 };
  /** Density falloff for the geometric per-tap decay. */
  uDecay: { value: number };
  /**
   * Overall exposure/contribution scalar on top of uStrength. Kept
   * separate so a tier can dial the total energy in without also
   * flattening the day-curve — a future medium-tier reduced-samples
   * variant can subtract exposure to match the diminished bloom.
   */
  uExposure: { value: number };
  /**
   * World-space sun direction (unit vector). The volumetric fog
   * reads dot(viewRay, sunDir) into the Henyey-Greenstein phase
   * function so a ray looking near the sun picks up a bright halo
   * of in-scattered light. Composer writes this each tick from
   * `citySun.sunPosition.normalize()`.
   */
  uSunDir: { value: THREE.Vector3 };
  /** World-space camera position. The raymarch starts here. */
  uCameraPos: { value: THREE.Vector3 };
  /**
   * Inverse projection matrix. Multiplied against the fragment's
   * NDC to reconstruct a view-space ray.
   */
  uInverseProjection: { value: THREE.Matrix4 };
  /**
   * Inverse view matrix. Multiplied against the reconstructed view-
   * space ray to lift it into world space, so the raymarch can
   * intersect the water plane (world Y) directly.
   */
  uInverseView: { value: THREE.Matrix4 };
  /**
   * Participating-media density scalar in [0..1]. Feeds the per-step
   * extinction and in-scatter weight. Composer writes this per frame
   * from `volumetricFogDensityForDay(df)`.
   */
  uFogDensity: { value: number };
  /**
   * Fog tint at horizon — the same colour FogExp2 already reads from
   * the sky. Passed as a vec3 so the in-scatter is the SAME colour
   * the world scene's fog reads against; this is what fixes R10-7's
   * complaint that the fog wall doesn't participate.
   */
  uFogColor: { value: THREE.Vector3 };
  /**
   * The world-space height where the fog is densest. WATER_PLANE_Y
   * (~0.05) so the harbour reads as damp and the towers rise out
   * of it. Density falls off exponentially from here upward.
   */
  uFogHeight: { value: number };
  /**
   * Height falloff scale — larger values mean fog reaches higher up
   * the towers before thinning. Tuned to ~40m so the ground floor
   * of a mid-height building sits inside the fog and the roof does
   * not.
   */
  uFogHeightFalloff: { value: number };
  /**
   * Henyey-Greenstein asymmetry g in (-1..1). ~0.6 for harbour Mie
   * scattering. Kept as a uniform so a tier could dial back the
   * anisotropy on a low-cost path (isotropic scattering is cheaper
   * to reason about in a low-tap raymarch).
   */
  uFogPhaseG: { value: number };
  /**
   * Time in seconds since composer mount. Drives the per-pixel jitter
   * so the 20-tap raymarch does not band under motion — a temporal
   * dither that reshuffles the sample offsets frame-to-frame.
   */
  uTime: { value: number };
  /**
   * Maximum march distance in world units, when the view ray does
   * not intersect the water plane (e.g. a ray looking upward into
   * the sky). Bounds the fog integration so a sky ray still
   * accumulates in-scatter and doesn't run to infinity.
   */
  uFogMarchMax: { value: number };
};

/**
 * The vertex shader is the standard full-screen quad — nothing to say.
 */
const GODRAYS_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * The fragment shader — 24 radial taps between the fragment and the sun
 * position in UV, luminance-thresholded so only bright pixels feed the
 * rays, geometric decay so the near taps dominate; PLUS a 20-tap
 * participating-media raymarch along the view ray, jittered, with
 * Henyey-Greenstein in-scatter toward the sun and Beer-Lambert
 * extinction that ALSO attenuates the shaft accumulator so shafts
 * scatter through the fog volume instead of sitting on top of it.
 *
 * The `GODRAYS_SAMPLES` and `VOLUMETRIC_FOG_STEPS` counts are stamped
 * into the GLSL as compile-time constants because WebGL 1 forbids
 * non-constant loop bounds. If a future PR changes the numbers, this
 * string must change with them — the test pins the two so a drift
 * shows up here.
 */
const GODRAYS_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform vec2  uSunUv;
  uniform float uStrength;
  uniform vec3  uWarmTint;
  uniform float uDecay;
  uniform float uExposure;

  // Participating-media uniforms.
  uniform vec3  uSunDir;
  uniform vec3  uCameraPos;
  uniform mat4  uInverseProjection;
  uniform mat4  uInverseView;
  uniform float uFogDensity;
  uniform vec3  uFogColor;
  uniform float uFogHeight;
  uniform float uFogHeightFalloff;
  uniform float uFogPhaseG;
  uniform float uTime;
  uniform float uFogMarchMax;

  varying vec2 vUv;

  // Compile-time constants so WebGL 1 accepts the loop bounds. Kept in
  // sync with GODRAYS_SAMPLES / VOLUMETRIC_FOG_STEPS on the TS side.
  const int SAMPLES = ${GODRAYS_SAMPLES};
  const int FOG_STEPS = ${VOLUMETRIC_FOG_STEPS};

  // Rec.709 luminance — matches the painterly pass upstream so the two
  // agree on what "bright" means. A pixel above 0.55 luminance is
  // treated as light-source; below is treated as surface.
  const vec3 LUM_709 = vec3(0.2126, 0.7152, 0.0722);

  // Cheap hash for the per-pixel jitter — 20 steps banded on a static
  // frame would read as diorama; the hash is refreshed each frame by
  // the time uniform so temporal dither smooths the count out. Not a
  // cryptographic hash; just enough decorrelation for a stochastic
  // raymarch offset.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Henyey-Greenstein phase function — matches the JS-side sibling.
  // Multiplies the in-scatter contribution by an anisotropic weight
  // as a function of the angle between the view ray and the sun
  // direction. Positive g is forward-scattering (bright halo around
  // the sun); g=0 collapses to isotropic (1).
  float phaseHG(float cosT, float g) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * cosT;
    denom = max(1e-4, denom);
    return (1.0 - g2) / pow(denom, 1.5);
  }

  void main() {
    vec4 src = texture2D(tDiffuse, vUv);

    // ── shaft accumulator (unchanged from R2) ─────────────────────────
    // Outside the horizon-crossing gate the composer sets uStrength=0
    // and this whole block short-circuits — the fog raymarch still
    // runs, so a visitor rotating past the sun sees the harbour haze
    // thicken before the shafts arrive.
    vec3 shaft = vec3(0.0);
    if (uStrength <= 0.0) {
      shaft = vec3(0.0);
    } else {
      // Vector from this fragment to the sun's projected UV. The rays
      // walk from the fragment TOWARD the sun, so the accumulator picks
      // up the bright pixels in that direction — same idea as Crytek's
      // 2006 sun-shafts implementation, adapted to WebGL 1.
      vec2 toSun = uSunUv - vUv;

      // Step size — one Nth of the way to the sun per tap. A short
      // clamp on the total sample distance keeps a sun that's
      // projected far off-screen from stretching the taps into
      // nonsense.
      float dist = length(toSun);
      float clamped = min(dist, 0.85);
      vec2 dir = dist > 1e-5 ? (toSun / dist) : vec2(0.0);
      vec2 step = dir * (clamped / float(SAMPLES));

      vec3 accum = vec3(0.0);
      float weight = 1.0;
      float totalW = 0.0;
      vec2 sampleUv = vUv;

      for (int i = 0; i < SAMPLES; i++) {
        sampleUv += step;
        vec2 uv2 = clamp(sampleUv, vec2(0.0), vec2(1.0));
        vec3 s = texture2D(tDiffuse, uv2).rgb;
        float lum = dot(s, LUM_709);
        float mask = smoothstep(0.55, 1.0, lum);
        accum  += s * weight * mask;
        totalW += weight * mask;
        weight *= uDecay;
      }

      vec3 rays = totalW > 1e-4 ? (accum / totalW) : vec3(0.0);
      shaft = rays * uWarmTint * uStrength * uExposure;

      // Radial fade at the very edge of the frame — the taps far from
      // the sun should not carry a rectangular seam.
      float radial = 1.0 - clamp(dist * 0.9, 0.0, 1.0);
      shaft *= mix(0.35, 1.0, radial);
    }

    // ── participating-media raymarch ─────────────────────────────────
    // Reconstruct the world-space view ray for this fragment. NDC point
    // at (vUv*2-1, 1, 1) is the far plane; multiplied by the inverse
    // projection matrix we get a view-space ray direction, and by the
    // inverse view we lift it into world space.
    vec4 ndcFar = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 viewFar = uInverseProjection * ndcFar;
    viewFar /= viewFar.w;
    vec3 worldFar = (uInverseView * vec4(viewFar.xyz, 1.0)).xyz;
    vec3 rayDir = normalize(worldFar - uCameraPos);

    // Ray-plane intersection against the harbour surface (Y = uFogHeight).
    // If the ray goes upward and never hits the plane (rayDir.y > 0
    // and camera above the plane), march to uFogMarchMax. If the ray
    // goes downward and hits the plane in front of the camera, march
    // to that hit distance. This is the ray's TRAVERSED depth through
    // the fog volume.
    float marchLen = uFogMarchMax;
    if (abs(rayDir.y) > 1e-4) {
      float tPlane = (uFogHeight - uCameraPos.y) / rayDir.y;
      if (tPlane > 0.0 && tPlane < marchLen) {
        marchLen = tPlane;
      }
    }
    // Guard against a zero-length march (camera exactly on the plane).
    marchLen = max(1.0, marchLen);

    // Per-pixel jitter — a hash of the fragment position seeded by
    // time. Under motion the seed shifts, so the banding a low tap
    // count would show becomes a per-frame dither that averages out
    // to a smooth gradient over ~4 frames.
    float jitter = hash21(vUv + fract(uTime * 0.61));

    // Fixed step size — jittered start so the effective sample
    // positions differ frame-to-frame. Beer-Lambert over 20 uniform
    // steps is a good approximation to the continuous integral of
    // the density along the ray for a harbour-depth fog.
    float stepLen = marchLen / float(FOG_STEPS);

    // Anisotropic phase weight — a scalar for the entire march since
    // the ray direction doesn't change along the march.
    float cosSun = clamp(dot(rayDir, uSunDir), -1.0, 1.0);
    float phase = phaseHG(cosSun, uFogPhaseG);

    // Accumulators — transmittance walks from 1 (unattenuated) to a
    // small value as the ray crosses dense fog; inScatter picks up
    // per-step in-scattered sun light weighted by density × transmittance.
    float transmittance = 1.0;
    vec3 inScatter = vec3(0.0);

    for (int i = 0; i < FOG_STEPS; i++) {
      float t = (float(i) + jitter) * stepLen;
      vec3 samplePos = uCameraPos + rayDir * t;

      // Height-based density profile. Exp falloff from uFogHeight
      // upward — thick near the harbour, thin at tower rooflines.
      // Camera below the plane (looking up from a boat) still reads
      // full density; camera above (the usual case) reads a smooth
      // falloff.
      float above = max(0.0, samplePos.y - uFogHeight);
      float heightAtten = exp(-above / max(1e-3, uFogHeightFalloff));
      float density = uFogDensity * heightAtten;

      // Per-step Beer-Lambert extinction — the fraction of light
      // that survives THIS step's absorption.
      float stepExtinct = exp(-density * stepLen);

      // In-scatter from this segment: the fog tint × phase × the
      // energy that WAS at this segment before it was absorbed.
      // Uses (1 - stepExtinct) so the segment's contribution is
      // the light it added, not the light that passed through it.
      vec3 stepScatter = uFogColor * phase * density * (1.0 - stepExtinct);
      inScatter += transmittance * stepScatter;

      transmittance *= stepExtinct;
    }

    // Clamp for numerical safety — a NaN in the phase function would
    // paint the whole frame; the max() below turns any bad step into
    // a passthrough for that fragment instead of a screen flash.
    transmittance = clamp(transmittance, 0.0, 1.0);
    inScatter = max(inScatter, vec3(0.0));

    // ── composition ──────────────────────────────────────────────────
    // The source frame is attenuated by transmittance (fog absorbed
    // some of it), and the in-scattered fog radiance is added over
    // the top. This is the standard participating-media compositing
    // equation:  L_out = L_in · T + L_scatter
    vec3 finalRgb = src.rgb * transmittance + inScatter;

    // Shaft accumulator is attenuated by the SAME transmittance so
    // shafts scatter THROUGH the fog volume, not on top of it. A
    // dusk shaft crossing a thick harbour band now dims where the
    // fog is thick — the R10-7 fix.
    finalRgb += shaft * transmittance;

    gl_FragColor = vec4(finalRgb, src.a);
  }
`;

/**
 * The shape ShaderPass accepts. Kept separate so the shader spec is
 * inspectable — a future test could hash the fragment source to catch
 * a silent shader edit that changed the visual register.
 */
export const cityGodraysShader = {
  name: "cityGodrays",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSunUv: { value: new THREE.Vector2(-1, -1) },
    uStrength: { value: 0 },
    uWarmTint: { value: new THREE.Vector3(1.20, 0.94, 0.62) },
    uDecay: { value: 0.94 },
    uExposure: { value: 0.55 },
    // Participating-media defaults — the composer overwrites these
    // per frame. Defaults chosen so a pass that was constructed but
    // never wired to a composer still ships a near-identity frame
    // (density=0 kills the fog contribution; identity mats).
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uCameraPos: { value: new THREE.Vector3(0, 0, 0) },
    uInverseProjection: { value: new THREE.Matrix4() },
    uInverseView: { value: new THREE.Matrix4() },
    uFogDensity: { value: 0 },
    uFogColor: { value: new THREE.Vector3(0.55, 0.62, 0.78) },
    uFogHeight: { value: 0.05 },
    uFogHeightFalloff: { value: 40 },
    uFogPhaseG: { value: 0.6 },
    uTime: { value: 0 },
    uFogMarchMax: { value: 600 },
  },
  vertexShader: GODRAYS_VERTEX,
  fragmentShader: GODRAYS_FRAGMENT,
};

/**
 * A fully-constructed ShaderPass exposing typed uniforms. The composer
 * casts back to `GodraysUniforms` when it writes to them per frame.
 */
export type CityGodraysPass = ShaderPass & {
  uniforms: GodraysUniforms;
};

/**
 * Build the god-rays ShaderPass. Uniform values default to identity:
 * strength=0, sunUv=(-1,-1), fogDensity=0 — so a composer that stacked
 * this pass but never wrote its uniforms would still ship a pixel-
 * perfect copy of the source buffer, not a mysterious tinted frame.
 *
 * Idempotent per composer. Dispose via the standard ShaderPass
 * .dispose() (three r160+); the composer's dispose iterates its passes
 * and calls this automatically.
 */
export function createCityGodraysPass(): CityGodraysPass {
  const pass = new ShaderPass(cityGodraysShader) as CityGodraysPass;
  const u = pass.uniforms;
  u.uStrength.value = 0;
  u.uSunUv.value = new THREE.Vector2(-1, -1);
  u.uWarmTint.value = new THREE.Vector3(1.20, 0.94, 0.62);
  u.uDecay.value = 0.94;
  u.uExposure.value = 0.55;
  // Participating-media defaults — identity until composer writes.
  u.uSunDir.value = new THREE.Vector3(0, 1, 0);
  u.uCameraPos.value = new THREE.Vector3(0, 0, 0);
  u.uInverseProjection.value = new THREE.Matrix4();
  u.uInverseView.value = new THREE.Matrix4();
  u.uFogDensity.value = 0;
  u.uFogColor.value = new THREE.Vector3(0.55, 0.62, 0.78);
  u.uFogHeight.value = 0.05;
  u.uFogHeightFalloff.value = 40;
  u.uFogPhaseG.value = 0.6;
  u.uTime.value = 0;
  u.uFogMarchMax.value = 600;
  return pass;
}
