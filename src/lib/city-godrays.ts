/**
 * city-godrays — volumetric sun shafts at dawn and dusk.
 *
 * The emotional peak reference (London at dusk) reads as photoreal partly
 * because sun shafts scatter through the buildings — that specific dawn/
 * dusk light behaviour is not a texture, it is a screen-space post pass.
 * A radial blur toward the sun's projected screen position, run only on
 * high tier and only in the narrow horizon-crossing windows the sun
 * actually is at the horizon, is what carries the reference forward.
 *
 * The ShaderPass rides in the composer between BokehPass (which softens
 * the wide-zoom read) and the painterly ShaderPass (which shifts the
 * whole register warm at bird's-eye). Placing it AFTER Bokeh means the
 * god-rays scatter follows the diorama blur, so a wide-zoom frame reads
 * as painting-with-shafts, not sharp-shafts-in-a-blurred-frame; placing
 * it BEFORE painterly means the register shift acts on the shaft
 * pixels too, so at bird's-eye the whole scene (including the rays)
 * warms toward the Currier & Ives tint.
 *
 * Gate:
 *   |dayFraction - 0| < 0.08  → the dawn horizon crossing window
 *   |dayFraction - 0.5| < 0.08 → the dusk horizon crossing window
 *
 * Outside those two windows the pass short-circuits at strength=0 and
 * the frame is a pixel-perfect passthrough. The strength ramp is a
 * linear (1 - dNearest/0.08) so the shaft peaks at the exact horizon
 * crossing (sun ON the horizon, longest atmospheric path) and fades
 * over ~15 minutes of the day-fraction axis on either side. Cardinal
 * times pinned in scripts/test-city-godrays.mjs:
 *
 *   dayFraction=0    (dawn horizon)        → strength=1
 *   dayFraction=0.25 (noon)                → strength=0
 *   dayFraction=0.5  (dusk horizon)        → strength=1
 *   dayFraction=0.75 (midnight)            → strength=0
 *
 * Sampling: 24 radial taps between the fragment and the sun's projected
 * UV, geometric decay 0.94 per tap so the near-fragment taps dominate.
 * Each tap contributes only its LUMINANCE-thresholded contribution — a
 * soft smoothstep(0.55, 1.0, lum) clamps against the tone-mapped brights
 * downstream. This is what stops the shafts from washing out a shadowed
 * facade next to a bright window: only sky+sun pixels feed the rays.
 *
 * The warm gold tint the shaft ADDS on top of the source is not a hue
 * rotate — it is a multiply. So a cool cerulean pixel does not become
 * gold; only where the sun's own gold-copper radiance lands does the
 * shaft appear golden. The pass is additive over the source frame; a
 * pixel with no ray contribution reads as identity.
 *
 * The pure-math halves — `godraysStrengthForDay(dayFraction)` and the
 * gate constant — are exported alongside the pass constructor so a node
 * test can pin the curve at the four cardinal times and the horizon
 * crossings without touching WebGL. A future regression that widened
 * the gate to 0.15 would let god-rays fire at noon; a regression that
 * narrowed it to 0.02 would drain them across the whole reference. The
 * test names both.
 *
 * The composer's per-frame writes go into `uSunUv` (the projected sun
 * position in UV space) and `uStrength` (the day-curve strength scaled
 * by the sun's visibility mask). When the sun is off-screen the visit
 * mask goes to zero and the pass turns into a passthrough via the
 * `uStrength <= 0` short-circuit at the top of the fragment shader.
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
 * rays, geometric decay so the near taps dominate, additive gold tint
 * on top of the source.
 *
 * The `GODRAYS_SAMPLES` count is stamped into the GLSL as a compile-time
 * constant because WebGL 1 forbids non-constant loop bounds. If a
 * future PR changes the number, this string must change with it — the
 * test pins the two so a drift shows up here.
 */
const GODRAYS_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform vec2  uSunUv;
  uniform float uStrength;
  uniform vec3  uWarmTint;
  uniform float uDecay;
  uniform float uExposure;

  varying vec2 vUv;

  // Compile-time constant so WebGL 1 accepts the loop bound. Kept in
  // sync with GODRAYS_SAMPLES on the TS side.
  const int SAMPLES = ${GODRAYS_SAMPLES};

  // Rec.709 luminance — matches the painterly pass upstream so the two
  // agree on what "bright" means. A pixel above 0.55 luminance is
  // treated as light-source; below is treated as surface.
  const vec3 LUM_709 = vec3(0.2126, 0.7152, 0.0722);

  void main() {
    vec4 src = texture2D(tDiffuse, vUv);

    // Identity short-circuit — outside the horizon-crossing gate the
    // composer sets uStrength=0 and the fragment shader ships a copy.
    // The ALU below on strength=0 would be wasted; return early.
    if (uStrength <= 0.0) {
      gl_FragColor = src;
      return;
    }

    // Vector from this fragment to the sun's projected UV. The rays
    // walk from the fragment TOWARD the sun, so the accumulator picks
    // up the bright pixels in that direction — same idea as Crytek's
    // 2006 sun-shafts implementation, adapted to WebGL 1.
    vec2 toSun = uSunUv - vUv;

    // Step size — one Nth of the way to the sun per tap. A short
    // clamp on the total sample distance keeps a sun that's projected
    // far off-screen from stretching the taps into nonsense.
    float dist = length(toSun);
    float clamped = min(dist, 0.85);
    vec2 dir = dist > 1e-5 ? (toSun / dist) : vec2(0.0);
    vec2 step = dir * (clamped / float(SAMPLES));

    // Accumulator over the 24 taps. Weight decays geometrically so the
    // near-fragment taps dominate — this is what gives the shafts their
    // characteristic near-bright, far-fade profile, not a flat radial
    // blur.
    vec3 accum  = vec3(0.0);
    float weight = 1.0;
    float totalW = 0.0;
    vec2 sampleUv = vUv;

    for (int i = 0; i < SAMPLES; i++) {
      sampleUv += step;
      // Clamp UV so a step off the edge samples the border pixel, not
      // wraparound. On WebGL 1 the CLAMP_TO_EDGE wrap mode of the
      // composer's target should already do this, but pixel-level
      // safety here keeps the effect stable on any wrap setting.
      vec2 uv2 = clamp(sampleUv, vec2(0.0), vec2(1.0));
      vec3 s = texture2D(tDiffuse, uv2).rgb;
      // Soft luminance clamp — only bright pixels contribute. The
      // smoothstep from 0.55 to 1.0 is the "sun / sky" band; below
      // 0.55 the fragment is a shadowed facade and does not feed
      // rays. This is the "soft clamp against the tone-mapped
      // luminance already downstream" the brief calls out.
      float lum = dot(s, LUM_709);
      float mask = smoothstep(0.55, 1.0, lum);
      accum  += s * weight * mask;
      totalW += weight * mask;
      weight *= uDecay;
    }

    // Normalise so a fully-lit direction reads as its own luminance,
    // not saturated. The max() guards a zero-weight column (no bright
    // taps on this ray) — those pixels see no shaft, which is right.
    vec3 rays = totalW > 1e-4 ? (accum / totalW) : vec3(0.0);

    // Additive gold — the shaft is warm light ADDED over the frame,
    // not a hue rotate. A pixel with no bright taps in its ray keeps
    // its own colour; a pixel whose ray crosses the sun disk gains a
    // gold-copper cast of the disk's own light.
    vec3 shaft = rays * uWarmTint * uStrength * uExposure;

    // Radial fade at the very edge of the frame — the taps far from
    // the sun should not carry a rectangular seam. Distance from the
    // sun in UV, softmax'd to 1 in the corners.
    float radial = 1.0 - clamp(dist * 0.9, 0.0, 1.0);
    shaft *= mix(0.35, 1.0, radial);

    gl_FragColor = vec4(src.rgb + shaft, src.a);
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
 * strength=0, sunUv=(-1,-1) — so a composer that stacked this pass
 * but never wrote its uniforms would still ship a pixel-perfect copy
 * of the source buffer, not a mysterious tinted frame.
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
  return pass;
}
