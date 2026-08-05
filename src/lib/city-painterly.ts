/**
 * city-painterly — the Currier & Ives register shift at bird's-eye.
 *
 * The brief's first reference is a hand-drawn painterly bird's-eye of New York:
 * warm red-tiled roofs, low contrast, hand-drawn air. Every other reference is
 * photoreal skyline (SF financial district clear-day, London at dusk, London
 * at night). Two registers, one room.
 *
 * Today the wide-zoom looks the same as the eye-level zoom — ACES tonemap,
 * PBR glass, bloom. When the visitor pinches out to bird's-eye we should
 * *feel* the painting come forward. This ShaderPass rides in the composer
 * between UnrealBloomPass and OutputPass and does four cheap operations in
 * one full-screen sample:
 *
 *   1. small warm hue rotate (~0.05 rad, ≈3°) — pulls greens and blues a
 *      touch toward gold so the tiled-roof memory reads;
 *   2. contrast pull toward mid-grey by ~0.15 — the painting's tonal
 *      compression, the difference between a photograph and a lithograph;
 *   3. soft radial vignette warm-tinted — the paper's edge darkening, a
 *      candle-warm halo that suggests a page in a book;
 *   4. paper-grain noise driven by uTime — a whisper of drift, one or two
 *      levels above pure hash so it doesn't strobe.
 *
 * Everything is gated on a single `uStrength` uniform the composer writes
 * per frame from a smoothstep on the camera's eased pitch01. Below
 * `PAINTERLY_PITCH_START` (0.6) the shader is a pure identity copy; above
 * `PAINTERLY_PITCH_END` (0.9) it is fully painterly. In between, a
 * smoothstep — same curve the DOF pass uses one slot upstream so the two
 * effects rise together and the wide-zoom read arrives as one gesture.
 *
 * Why cheap enough to run at low tier: one texture fetch, ~30 ALU ops per
 * fragment. The shader adds noise via a two-tap value hash, not a
 * multi-octave FBM — the paper reads as paper without a per-pixel
 * mini-benchmark. The composer keeps the pass enabled at every tier and
 * only sets `enabled = false` when strength is exactly zero, which the
 * strength curve guarantees below pitch01 = 0.6.
 *
 * The pure-math half — `painterlyStrengthForPitch` — is exported alongside
 * the pass constructor so a node test can pin the curve without touching
 * WebGL. A future refactor that flattened the ramp would drain the
 * register-shift; the test names the three sample points the composer
 * relies on so any drift shows up before it hits the frame.
 *
 * This module never touches city.ts laws, gesture, room-runtime, or
 * persistence. It is a post-process register-shift.
 */

import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * The painterly register-shift lives above pitch01 = PAINTERLY_PITCH_START.
 * Below that pitch the frame is photoreal (SF/London eye-level read);
 * above PAINTERLY_PITCH_END the frame is fully in the painting
 * (Currier & Ives bird's-eye). Smoothstep between the two.
 *
 * The window is deliberately narrower than the DOF window (which starts
 * at 0.55) so the painting arrives a touch AFTER the diorama blur — the
 * eye first notices the frame softening, then the register turning warm.
 */
export const PAINTERLY_PITCH_START = 0.6;
export const PAINTERLY_PITCH_END = 0.9;

/**
 * Compute the painterly strength (0..1) as a function of camera pitch01.
 *
 * Below PAINTERLY_PITCH_START → 0 (photoreal register).
 * Above PAINTERLY_PITCH_END → 1 (fully painterly).
 * In between, a Hermite smoothstep so the ramp is smooth in both
 * derivatives — a slow pinch never snaps and a fast pinch never chatters.
 *
 * Clamped at both ends so an over-eager spring that undershoots -0.01 or
 * overshoots 1.02 never picks up a negative or > 1 strength.
 *
 * Exported so a node test can pin the curve at 0.5 / 0.75 / 1.0 — the
 * three cliffs the composer relies on for the wide-zoom register.
 */
export function painterlyStrengthForPitch(pitch01: number): number {
  const p = pitch01 < 0 ? 0 : pitch01 > 1 ? 1 : pitch01;
  const span = PAINTERLY_PITCH_END - PAINTERLY_PITCH_START;
  if (span <= 0) return p >= PAINTERLY_PITCH_START ? 1 : 0;
  const t = (p - PAINTERLY_PITCH_START) / span;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * GLSL uniform block for the painterly ShaderPass. Kept in a shared type
 * so the composer (which writes to these per frame) and the pass itself
 * can not drift — a future rename of `uStrength` to `uAmount` would break
 * both sides at once, not one side silently.
 */
export type PainterlyUniforms = {
  tDiffuse: { value: THREE.Texture | null };
  /** 0..1 register-shift strength — the composer writes this per frame. */
  uStrength: { value: number };
  /** Seconds since mount — drives the paper-grain drift. */
  uTime: { value: number };
  /** Vignette multiplier — high tier passes 1.15, other tiers pass 1.0. */
  uVignette: { value: number };
  /** Screen resolution in pixels — used to keep grain scale device-agnostic. */
  uResolution: { value: THREE.Vector2 };
};

/** The vertex shader is the standard full-screen quad — nothing to say here. */
const PAINTERLY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * The fragment shader — four operations behind one `uStrength` gate.
 *
 * Each op is written as (mixIn between the identity color and the
 * effected color) so the strength uniform is a soft dial, not a boolean.
 * The order matters: hue rotate lives in linear working space so its
 * gains match the ACES tonemap that OutputPass applies downstream; then
 * contrast pull; then the vignette (which multiplies luminance); finally
 * the grain (added, not mixed, so it survives even after the vignette
 * darkens the corners).
 */
const PAINTERLY_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform float uStrength;
  uniform float uTime;
  uniform float uVignette;
  uniform vec2  uResolution;

  varying vec2 vUv;

  // ── warm palette constants ──────────────────────────────────────────────
  // The warm tint sits in linear space. Values calibrated against the
  // Currier & Ives reference: the sky reads pale rose, the roofs read
  // burnt-sienna, the shadows read plum. We do NOT saturate the entire
  // frame toward this tint — instead we rotate hue by a small angle and
  // blend a faint warm cast at the vignette edge.
  const vec3 WARM_TINT = vec3(1.035, 0.965, 0.870);
  const float HUE_ROTATE_RADIANS = 0.045;
  const float CONTRAST_PULL = 0.15;

  // Cheap 2D value hash for paper grain. Not a fbm — we want the
  // texture of paper, not the shape of clouds. Two taps at slightly
  // offset positions and a subtract gives a signed high-frequency
  // noise the eye reads as fibre.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Rotate an RGB color's hue by an angle (radians) in the YIQ chroma
  // plane. This is the classic "hue rotate" matrix — cheap, closed-form,
  // and it lives in the same linear space we sample tDiffuse from.
  vec3 hueRotate(vec3 c, float a) {
    float s = sin(a);
    float k = cos(a);
    // luminance axis stays untouched
    vec3 lum = vec3(0.2126, 0.7152, 0.0722);
    float l = dot(c, lum);
    // decompose into luminance + chroma, rotate chroma
    vec3 ch = c - l;
    // 2D rotation on the (r-g, r-b) chroma pair — approximation good
    // enough for a small angle. For 3° we do not need the exact YIQ
    // matrix; the visual difference is under one JND.
    mat3 R = mat3(
      k + (1.0 - k) / 3.0,        (1.0 - k) / 3.0 - s * 0.5774, (1.0 - k) / 3.0 + s * 0.5774,
      (1.0 - k) / 3.0 + s * 0.5774, k + (1.0 - k) / 3.0,         (1.0 - k) / 3.0 - s * 0.5774,
      (1.0 - k) / 3.0 - s * 0.5774, (1.0 - k) / 3.0 + s * 0.5774, k + (1.0 - k) / 3.0
    );
    return l + R * ch;
  }

  void main() {
    vec4 src = texture2D(tDiffuse, vUv);

    // Identity short-circuit — when the composer has enabled us but the
    // strength happens to be exactly zero (a boundary tick) we still owe
    // the buffer a copy, and doing the ALU below on strength=0 is wasted.
    if (uStrength <= 0.0) {
      gl_FragColor = src;
      return;
    }

    vec3 baseCol = src.rgb;
    vec3 col = baseCol;

    // (a) small warm hue rotate — pulls greens/blues a touch toward gold.
    vec3 rotated = hueRotate(col, HUE_ROTATE_RADIANS);
    col = mix(col, rotated, uStrength);

    // (b) contrast pull toward mid-grey. In linear space "mid-grey" is
    // ~0.18, but we pull toward the frame's own local mean so a bright
    // dusk sky doesn't wash out and a moonless midnight doesn't lift
    // toward grey. dot(col, lum) is the perceptual grey of the pixel.
    vec3 lum = vec3(0.2126, 0.7152, 0.0722);
    float l = dot(col, lum);
    vec3 muted = mix(vec3(l), col, 1.0 - CONTRAST_PULL);
    col = mix(col, muted, uStrength);

    // (c) radial vignette with warm tint. Distance from centre is
    // uv-space; we bias the outer band toward the warm tint so the
    // corners of the frame acquire the paper-edge glow of a
    // lithograph, not the black-mask vignette of a lens.
    vec2 d = vUv - 0.5;
    // Aspect-correct the distance so the vignette is a circle, not an
    // ellipse — the sky at wide-zoom is much wider than tall in
    // portrait and we don't want a stretched halo.
    d.x *= uResolution.x / max(1.0, uResolution.y);
    float r = length(d);
    // Smoothstep the vignette from 0 at radius 0.25 to 1 at radius 0.75.
    // uVignette lets high tier bump this to a slightly deeper halo.
    float v = smoothstep(0.25, 0.75, r) * uVignette;
    // The vignette darkens the frame AND warms it — mix toward
    // (baseCol * WARM_TINT * 0.75) at the outer band.
    vec3 vignetted = mix(col, col * WARM_TINT * 0.75, v);
    col = mix(col, vignetted, uStrength);

    // (d) paper grain — a whisper of high-frequency noise driven by
    // uTime so the paper drifts. We sample at ~1.5x pixel scale so the
    // grain isn't per-pixel dither (which strobes) but a visible fibre
    // texture at the read-distance of a phone screen at wide-zoom.
    vec2 grainUv = vUv * (uResolution / 1.5) + vec2(uTime * 0.07, uTime * 0.11);
    float grain = hash21(grainUv) - 0.5;
    // Grain is achromatic and small — 0.035 luma units at full strength.
    col += vec3(grain) * 0.035 * uStrength;

    gl_FragColor = vec4(col, src.a);
  }
`;

/**
 * The shape ShaderPass accepts. We keep the shader description separate
 * from the pass construction so it is inspectable — a future test could
 * import this and hash the fragment source to catch a silent shader edit
 * that changed the visual register.
 */
export const cityPainterlyShader = {
  name: "cityPainterly",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0 },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: PAINTERLY_VERTEX,
  fragmentShader: PAINTERLY_FRAGMENT,
};

/**
 * A fully-constructed ShaderPass exposing typed uniforms. The composer
 * casts back to `PainterlyUniforms` when it writes to them per frame.
 *
 * The pass is idempotent — call once per composer. Dispose via the
 * standard ShaderPass.dispose() (three r160+); the composer's dispose
 * handles that automatically when it iterates its passes.
 */
export type CityPainterlyPass = ShaderPass & {
  uniforms: PainterlyUniforms;
};

/**
 * Build the painterly ShaderPass. Uniform values default to identity:
 * strength=0, time=0, vignette=1.0 — so a composer that stacked this
 * pass but never wrote to its uniforms would still ship a pixel-perfect
 * copy of the source buffer, not a mysterious tinted frame. The composer
 * writes strength/time every tick.
 */
export function createCityPainterlyPass(): CityPainterlyPass {
  const pass = new ShaderPass(cityPainterlyShader) as CityPainterlyPass;
  // ShaderPass clones the uniforms on construct — grab the clone.
  const u = pass.uniforms;
  u.uStrength.value = 0;
  u.uTime.value = 0;
  u.uVignette.value = 1.0;
  u.uResolution.value = new THREE.Vector2(1, 1);
  return pass;
}
