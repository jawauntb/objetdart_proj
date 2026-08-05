/**
 * city-water — a harbour along one edge of /city, and the SSR mirror on it.
 *
 * The brief calls the dusk-and-lit-windows moment the emotional peak of the
 * room; the harbour is what doubles it, because the sky burning behind the
 * tallest sealed plot burns twice — once in the tower's glass, once in the
 * water. This module owns the water world: a plane along the +z edge of the
 * city footprint, a scrolled wave normal that ripples the surface at
 * ~0.02 uv/s, an offscreen colour+depth render target holding a mirror-camera
 * pass of the extruded skyline, and a screen-space raymarching water shader
 * that reads that RT with correct parallax on every pixel — with a cubemap
 * fallback from the citySky background for rays that escape the frustum at
 * grazing angles.
 *
 * The R10-5 rewrite — real SSR:
 *   Before R10-5 the harbour was a THREE.Reflector planar mirror. Reflector
 *   is a perfect mirror at every pixel: it computes ONE reflected camera,
 *   projects the fragment through a texture matrix, samples the RT, applies
 *   a static wave-normal UV wobble, done. Two things break at close zoom:
 *
 *     1. At grazing angles (eye near the water plane) the reflected ray
 *        exits the mirror-camera frustum for many surface pixels, and the
 *        planar sample returns garbage or clamped-edge sky. Photoreal
 *        harbours at dusk are DOMINATED by grazing angles — that's where
 *        the tower silhouette is doubled and the sunset colour band lies
 *        on the water. Planar mirror can't cover it.
 *
 *     2. Around a boat wake the wave normal is amplified, but Reflector's
 *        wobble is a screen-space UV shift — it doubles the wrong parallax.
 *        A wake fanning behind a boat should split the reflection of the
 *        tower BEHIND the boat with per-pixel depth-correct ripple; the
 *        old shader just smeared the same reflection UV around.
 *
 *   R10-5-C fixes both:
 *     - Custom mirror camera, reflected across the water plane, renders
 *       the skyline scene into a colour+depth WebGLRenderTarget on every
 *       water pass. The depth texture is the key ingredient.
 *     - Water shader raymarches the reflected view direction through that
 *       depth buffer. Every step re-projects a world-space point back into
 *       mirror-clip UV and compares the marched depth against the sampled
 *       scene depth. On hit → sample the colour RT at the correct hit UV,
 *       which carries the tower silhouette's real parallax.
 *     - On miss (ray leaves frustum, or grazing exit) → sample the citySky
 *       background cubemap in the reflected world direction. The horizon
 *       and sun disk read correctly at any grazing angle without any
 *       clamp-to-edge artefact.
 *     - The wave normal jitters the ray DIRECTION, not the sample UV, so
 *       the boat wake's amplified normal breaks the reflected tower's
 *       silhouette per-pixel — you can see the wake through the reflection
 *       exactly where the wake is.
 *     - Fresnel-blend: near-normal (bird's-eye) favours the raymarched
 *       reflection; grazing (eye-level along the surface) favours the
 *       cubemap, which is what real water does under Schlick's approximation.
 *
 *   The mirror camera is built ONCE and reused every frame with matrixWorld
 *   re-derived from the visitor's cityCam.camera; no per-frame allocation.
 *   Rendering into the RT is done inside the water mesh's `onBeforeRender`
 *   so it fires within the composer's water RenderPass without any composer
 *   surgery. renderer state (autoClear, xr, shadowMap.autoUpdate, and the
 *   active render target) is saved and restored around the call.
 *
 * The rebase — cityCam owns the frame:
 *   Before f7543df the water module carried its own fixed perspective
 *   camera because the room had no shared world camera. After f7543df,
 *   `createCityCamera` is the single perspective camera driving the sky
 *   pass, IBL, and the extruded prism skyline. The mirror camera must be
 *   derived from THAT camera every frame or the mirrored horizon slides
 *   off as soon as a pinch climbs from eye-level to bird's-eye. So the
 *   water scene no longer owns a camera: City.tsx hands `cityCam.camera`
 *   to `createCityComposer` as the `waterCam`, the composer's water
 *   RenderPass renders with that camera, and the water mesh's
 *   `onBeforeRender` reads it — the mirror camera is then the reflection
 *   of the same eye the visitor is looking through.
 *
 * How it composes into /city:
 *   City.tsx builds this water = createCityWater({ skylineScene, envMap,
 *   ... }) and hands its scene + cityCam.camera to createCityComposer as
 *   a water RenderPass, drawn AFTER the skyline and BEFORE bloom.
 *   RenderPass runs with clear:false; depth is preserved from the skyline
 *   pass so tall buildings still occlude the water beyond them.
 *
 * Tier gating (the door B/C/D depend on):
 *   high, medium  → SSR runs; its RT is 0.7 × canvas on high, 0.5 × on
 *                   medium. Wave normal scrolls; the raymarch tap count
 *                   is 24 steps on high, 16 on medium.
 *   low           → SSR is hidden; a cheaper static mirror mesh takes its
 *                   place, painting the sky gradient with a wave normal
 *                   highlight but no live reflection.
 *   sleep         → the whole water pass is skipped by the composer.
 *
 * Nothing here touches gesture, city.ts laws, or persistence. The pure
 * bits — `waveScrollFor(dt, prev)`, `skyTintForDay(dayFraction)`,
 * `proxyHeightFor` — are exported for test-city-water.mjs to pin without
 * a WebGL context.
 */

import * as THREE from "three";

import type { QualityTier } from "@/lib/room-runtime";

/** The role symbols this module cares about. Aligned with `PlotRole`
 * from `src/lib/city.ts`, but declared locally so this module has no
 * import edge back into city.ts's laws. */
export type CityWaterRole = "empty" | "home" | "store" | "event" | "tree";

/**
 * A single reflectable proxy: the minimum a plot needs to hand over to
 * the harbour. City.tsx builds these once per frame from the live plot
 * array. The R10-5 rewrite renders the REAL skyline into the mirror RT,
 * so the proxy list is now legacy — kept as a public contract because
 * test-city-water.mjs still pins `proxyHeightFor` and the plot cast in
 * City.tsx still uses the type.
 */
export type CityWaterProxy = {
  role: CityWaterRole;
  sealed: boolean;
  seed: number;
  /** normalized 0..1 across the field width */
  x: number;
  /** normalized 0..1 across the field height */
  y: number;
};

/** Legacy proxy count. The SSR path renders the real skyline into the
 * mirror RT and does not instantiate proxy boxes, but the constant is
 * retained so any test-only sizing math stays stable. */
export const WATER_PROXY_COUNT = 16;

/** Scroll rate of the wave normal — the brief pins this at ~0.02 uv/s. */
export const WAVE_SCROLL_RATE = 0.02;

/**
 * Advance the wave scroll offset by `dt` milliseconds.
 *
 * Kept pure so a test can pin the invariant (monotonic, wraps at 1 to keep
 * float precision). The renderer feeds this into the water shader as
 * `uTime`, which drives two normal-map lookups scrolling in different
 * directions — a cheap approximation of anisotropic wave motion.
 */
export function waveScrollFor(dtMs: number, prev: number): number {
  if (!Number.isFinite(dtMs) || !Number.isFinite(prev)) return prev || 0;
  const next = (prev || 0) + Math.max(0, dtMs) * 0.001 * WAVE_SCROLL_RATE;
  return next - Math.floor(next);
}

/**
 * Sky tint at a given day fraction, matched to the ground shader's own
 * dusk/night ramp. Returned as linear-ish RGB in 0..1.
 *
 *   dawn  (0.00)  → soft pink
 *   noon  (0.25)  → pale blue
 *   dusk  (0.50)  → deep orange-red — the emotional peak
 *   night (0.75)  → cool navy
 *
 * The four cardinal points are pinned by tests; between them we linear-
 * interpolate on the wrapped day cycle.
 */
export function skyTintForDay(dayFraction: number): [number, number, number] {
  const f = ((dayFraction % 1) + 1) % 1;
  const dawn: [number, number, number]  = [0.78, 0.55, 0.52];
  const noon: [number, number, number]  = [0.42, 0.62, 0.85];
  const dusk: [number, number, number]  = [0.92, 0.42, 0.18];
  const night: [number, number, number] = [0.06, 0.09, 0.18];
  const anchors: Array<[number, [number, number, number]]> = [
    [0.00, dawn],
    [0.25, noon],
    [0.50, dusk],
    [0.75, night],
    [1.00, dawn],
  ];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [f0, c0] = anchors[i];
    const [f1, c1] = anchors[i + 1];
    if (f >= f0 && f <= f1) {
      const t = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
      return [
        c0[0] * (1 - t) + c1[0] * t,
        c0[1] * (1 - t) + c1[1] * t,
        c0[2] * (1 - t) + c1[2] * t,
      ];
    }
  }
  return dusk;
}

/**
 * Deterministic "importance" score for a plot, higher = taller in the
 * legacy proxy skyline. Sealed events tower; sealed stores follow; homes
 * and trees take the middle; unsealed plots sit low. Pure and testable.
 * Retained after R10-5 because test-city-water.mjs pins the ladder and
 * the Plot → CityWaterProxy cast in City.tsx keeps the field shape stable.
 */
export function proxyHeightFor(role: CityWaterRole, sealed: boolean, seed: number): number {
  const roleBase: Record<CityWaterRole, number> = {
    empty: 0,
    home:  0.45,
    store: 0.75,
    event: 1.45,
    tree:  0.55,
  };
  const jitter = ((seed | 0) ^ 0x9e37) & 0xff;
  const noise = (jitter / 255) * 0.35;
  const sealBoost = sealed ? 0.9 : 0.15;
  return roleBase[role] * (0.75 + noise) + sealBoost * (role === "event" ? 1.6 : 0.5);
}

// ─── SSR water shader ───────────────────────────────────────────────────
// Vertex: pass world position + world-space normal so the fragment can
// build a reflected view ray in world space; also compute the projective
// UV into the mirror RT via `uTextureMatrix` (the classic Reflector
// technique, used here as the base sample for near-normal rays).
const SSR_VERT = /* glsl */ `
  uniform mat4 uTextureMatrix;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vMirrorUv;
  varying vec2 vLocalUv;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vMirrorUv = uTextureMatrix * wp;
    vLocalUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Fragment: raymarched screen-space reflection against the mirror-camera
// depth buffer, with cubemap fallback for grazing rays and Fresnel mixing.
//
// Steps:
//   1. Perturb the water normal by two scrolled samples of the wave
//      normal map — one primary, one amplified inside the wake mask.
//   2. Compute the reflected view direction in world space.
//   3. Base sample: project current fragment through uTextureMatrix into
//      the mirror RT UV, shifted by the perturbed normal's xy. This is
//      the near-normal (bird's-eye) reflection — same as classic Reflector.
//   4. SSR march: step the reflected ray in world space, at each step
//      project into mirror-clip via uMirrorViewProjMatrix, sample the
//      depth texture, and compare against the ray's clip-space z. First
//      step where scene depth < ray depth is a hit; sample the colour
//      RT at that UV.
//   5. Fallback: on miss or on grazing angle, sample the cubemap env
//      (citySky.background) in the reflected world direction.
//   6. Fresnel: near-normal → SSR result; grazing → cubemap. Schlick.
//   7. Water-body tint from uSkyTint + night crush + horizon darken.
const SSR_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tReflectionColor;
  uniform sampler2D tReflectionDepth;
  uniform sampler2D tNormal;
  #ifdef USE_ENV_CUBE
  uniform samplerCube uEnvMap;
  #endif

  uniform mat4 uMirrorViewProjMatrix;
  uniform vec3 uCameraPos;
  uniform vec3 uSkyTint;
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uWaveStrength;
  uniform float uNight;
  uniform float uReflectMix;
  uniform float uMarchSteps;
  uniform float uMarchDistance;
  uniform float uEnvIntensity;
  uniform float uHasEnv;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vMirrorUv;
  varying vec2 vLocalUv;

  // Two scrolled samples of the wave normal map → summed to approximate
  // anisotropic surface motion. The second sample is scaled by
  // uWaveStrength which the wake mask amplifies.
  vec3 sampleWaveNormal() {
    vec2 uv1 = vLocalUv * 3.0 + vec2(uTime * 1.0, uTime * 0.7);
    vec2 uv2 = vLocalUv * 5.0 + vec2(-uTime * 0.8, uTime * 1.3);
    vec3 n1 = texture2D(tNormal, uv1).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, uv2).xyz * 2.0 - 1.0;
    return normalize(mix(vec3(0.0, 0.0, 1.0), n1 + n2, uWaveStrength));
  }

  // Perturb an up-normal (0,1,0) by the wave map's tangent-space normal.
  // The water plane's normal is +Y in world space, so the wave normal's
  // xy shift bends the world normal in the xz plane.
  vec3 perturbedWorldNormal(vec3 wave) {
    return normalize(vec3(wave.x * uAmplitude, 1.0, wave.y * uAmplitude));
  }

  // Environment sample in world reflection direction. When the cubemap
  // uniform is absent (test/mocks), we synthesize a horizon/zenith gradient
  // from uSkyTint so the surface still reads as sky-coloured water.
  vec3 envSample(vec3 dir) {
    #ifdef USE_ENV_CUBE
    if (uHasEnv > 0.5) {
      return textureCube(uEnvMap, dir).rgb * uEnvIntensity;
    }
    #endif
    // Analytic fallback: three-band gradient across the reflected altitude.
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 horizonC = uSkyTint;
    vec3 zenithC  = uSkyTint * vec3(0.55, 0.72, 1.05);
    return mix(horizonC, zenithC, pow(h, 0.55));
  }

  // Project a world position through the mirror camera's view-projection
  // and return UV (0..1) and clip-space depth (0..1) as {xy, z}.
  vec3 projectToMirrorUV(vec3 worldPos) {
    vec4 clip = uMirrorViewProjMatrix * vec4(worldPos, 1.0);
    vec3 ndc = clip.xyz / max(clip.w, 1e-4);
    vec2 uv = ndc.xy * 0.5 + 0.5;
    float depth = ndc.z * 0.5 + 0.5;
    return vec3(uv, depth);
  }

  // Raymarch the reflected view direction against the mirror depth buffer.
  // Returns rgba: rgb = reflected colour if hit, alpha = 1.0 on hit, 0.0
  // otherwise. Marches uMarchSteps steps over uMarchDistance world units.
  vec4 raymarchReflection(vec3 startPos, vec3 rayDir) {
    float steps = max(4.0, uMarchSteps);
    float stepLen = uMarchDistance / steps;
    // Small offset off the surface so the first step is above the water
    // plane; otherwise the ray self-intersects the water mesh's own row
    // in the depth buffer if the mirror camera can see it.
    vec3 pos = startPos + rayDir * (stepLen * 0.25);
    for (int i = 0; i < 32; i++) {
      if (float(i) >= steps) break;
      pos += rayDir * stepLen;
      vec3 proj = projectToMirrorUV(pos);
      // Skip fragments off-frustum; caller will fall back to envmap.
      if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) {
        return vec4(0.0);
      }
      if (proj.z >= 1.0) {
        // Ray marched past the far plane — clear sky beyond, envmap it.
        return vec4(0.0);
      }
      float sceneDepth = texture2D(tReflectionDepth, proj.xy).r;
      // Hit test: scene surface is closer than the ray at this projection.
      // Small tolerance so we don't self-shadow the pixel of a receding
      // surface (thickness slice).
      if (sceneDepth < proj.z - 1e-4) {
        // Refine: binary-search back over the last step for a tighter hit.
        vec3 prev = pos - rayDir * stepLen;
        for (int j = 0; j < 4; j++) {
          vec3 mid = mix(prev, pos, 0.5);
          vec3 midProj = projectToMirrorUV(mid);
          float midDepth = texture2D(tReflectionDepth, midProj.xy).r;
          if (midDepth < midProj.z - 1e-4) {
            pos = mid;
          } else {
            prev = mid;
          }
        }
        vec3 hitProj = projectToMirrorUV(pos);
        vec3 hitCol = texture2D(tReflectionColor, hitProj.xy).rgb;
        // Fade near the edge of the RT so out-of-frustum hits soften into
        // the envmap fallback instead of clamp-hard-cutting.
        float edge =
          smoothstep(0.0, 0.05, hitProj.x) *
          smoothstep(0.0, 0.05, hitProj.y) *
          smoothstep(0.0, 0.05, 1.0 - hitProj.x) *
          smoothstep(0.0, 0.05, 1.0 - hitProj.y);
        return vec4(hitCol, edge);
      }
    }
    return vec4(0.0);
  }

  void main() {
    // 1. Perturbed surface normal + wave-shifted world normal.
    vec3 wave = sampleWaveNormal();
    vec3 wNormal = perturbedWorldNormal(wave);

    // 2. Reflected view direction in world space.
    vec3 viewDir = normalize(vWorldPos - uCameraPos);
    vec3 reflectDir = normalize(reflect(viewDir, wNormal));

    // 3. Fresnel — Schlick's approximation with F0=0.02 for water.
    float cosTheta = clamp(-dot(viewDir, wNormal), 0.0, 1.0);
    float F0 = 0.02;
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);

    // 4. Base (near-normal) reflection: classic projective sample of the
    //    mirror RT via textureMatrix, wave-perturbed. This is what
    //    Reflector did and it's still the cheapest correct answer near
    //    the surface normal — we keep it as a warm start.
    vec2 baseUv = vMirrorUv.xy / max(vMirrorUv.w, 1e-4);
    vec2 baseUvShift = wave.xy * uAmplitude * 0.5;
    vec3 baseRefl = texture2D(tReflectionColor, baseUv + baseUvShift).rgb;

    // 5. SSR raymarch against the depth buffer for pixels where the
    //    reflected ray goes into the scene (rather than toward the sky).
    vec4 marched = vec4(0.0);
    if (reflectDir.y > 0.02) {
      marched = raymarchReflection(vWorldPos + vec3(0.0, 0.02, 0.0), reflectDir);
    }

    // 6. Cubemap fallback for grazing / off-frustum rays.
    vec3 envCol = envSample(reflectDir);

    // 7. Compose: prefer SSR when it hit (alpha=1), otherwise blend baseRefl
    //    into envmap by how much the ray points upward (up → sky/env, flat
    //    → base planar mirror). Fresnel controls how much reflection vs
    //    body-colour we show at all.
    float rayUp = clamp(reflectDir.y * 2.0, 0.0, 1.0);
    vec3 fallback = mix(baseRefl, envCol, rayUp);
    vec3 refl = mix(fallback, marched.rgb, marched.a);

    // Body tint = current sky tint darkened at night + horizon fade.
    vec3 body = uSkyTint * vec3(0.6, 0.7, 0.85);
    float horizonBand = smoothstep(0.0, 0.35, vLocalUv.y);
    body *= mix(0.72, 1.0, horizonBand);

    // Fresnel blends reflection over body colour; uReflectMix scales the
    // reflection contribution overall so the room can tune "how mirror-y".
    vec3 surface = mix(body, refl, clamp(fresnel * uReflectMix + 0.15, 0.0, 1.0));

    // Night crush toward cool navy — matches the ground shader's ramp.
    vec3 nightTint = vec3(0.10, 0.14, 0.28);
    surface = mix(surface, surface * nightTint * 4.0, uNight * 0.45);

    // Sun-glint sparkle where the wave points up: cheap specular kicker
    // that reads as glitter on the harbour at dusk.
    float spec = smoothstep(0.65, 1.0, wave.z);
    surface += vec3(spec * 0.14) * (1.0 - uNight * 0.6);

    gl_FragColor = vec4(surface, 1.0);
  }
`;

// The low-tier fallback material: no reflection RT, just the sky tint
// modulated by the wave normal for a "sun on water" feel. Cheap and
// still reads as water at a glance.
const STATIC_FRAG = /* glsl */ `
  uniform sampler2D tNormal;
  uniform vec3 uSkyTint;
  uniform float uTime;
  uniform float uNight;

  varying vec2 vLocalUv;

  void main() {
    vec2 uv1 = vLocalUv * 3.0 + vec2(uTime * 1.0, uTime * 0.7);
    vec2 uv2 = vLocalUv * 5.0 + vec2(-uTime * 0.8, uTime * 1.3);
    vec3 n1 = texture2D(tNormal, uv1).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, uv2).xyz * 2.0 - 1.0;
    vec3 nrm = normalize(n1 + n2);

    vec3 sky = uSkyTint;
    float shimmer = 0.55 + 0.45 * smoothstep(0.2, 0.9, nrm.z);
    vec3 surface = sky * shimmer;

    vec3 nightTint = vec3(0.10, 0.14, 0.28);
    surface = mix(surface, surface * nightTint * 4.0, uNight * 0.45);

    float horizon = smoothstep(0.0, 0.35, vLocalUv.y);
    surface *= mix(0.7, 1.0, horizon);

    gl_FragColor = vec4(surface, 1.0);
  }
`;

const STATIC_VERT = /* glsl */ `
  varying vec2 vLocalUv;
  void main() {
    vLocalUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ─── procedural wave normal map ─────────────────────────────────────────
// A 64×64 RGBA DataTexture whose (r,g) encode a summed-sinusoids surface
// normal. Kept small — it's tiled repeatedly under the scroll — and
// computed once per module load.
let cachedNormalTex: THREE.DataTexture | null = null;
function getWaveNormalTexture(): THREE.DataTexture {
  if (cachedNormalTex) return cachedNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const dhdu = Math.cos(u) * Math.cos(v) + Math.cos(2 * u + 1) * Math.cos(3 * v);
      const dhdv = -Math.sin(u) * Math.sin(v) - 1.5 * Math.sin(2 * u + 1) * Math.sin(3 * v);
      const nx = -dhdu * 0.5;
      const ny = -dhdv * 0.5;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const r = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      const g = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      const b = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cachedNormalTex = tex;
  return tex;
}

// ─── world geometry constants ───────────────────────────────────────────
// The water plane's world footprint. Chosen to sit along the +z edge of
// /city's ±40-unit field (CITY_HALF in city-camera.ts): the plane starts
// where the city ends (z=+34) and extends outward to z=+66, wide enough
// to span the full city width.
const WATER_PLANE_WIDTH = 96;
const WATER_PLANE_DEPTH = 32;
const WATER_PLANE_CENTER_Z = 50;
/**
 * World-space Y of the harbour surface. Exported so downstream passes
 * (the participating-media fog raymarch inside city-godrays.ts) can
 * bound their view rays against the SAME plane the water sits on,
 * instead of hard-coding the constant in two places and drifting them
 * silently.
 */
export const WATER_PLANE_Y = 0.05;

// SSR march tuning — steps and distance chosen so a ~40-unit-tall tower
// visible at ~20 units from the harbour resolves at least one hit per
// pixel. Reduced to 16 on medium tier via the update() ramp.
const MARCH_STEPS_HIGH = 24;
const MARCH_STEPS_MEDIUM = 16;
const MARCH_DISTANCE = 120.0;

// ─── mirror-refresh cadence (idle-guard) ───────────────────────────────
// The reflection RT re-renders the entire skyline scene from a mirror
// camera every frame — ~50–100 draw calls that duplicate the primary
// pass. Nothing forces that duplication on an idle frame: if the camera
// hasn't moved and the sky slot hasn't advanced and no plot has toggled,
// the reflection is byte-identical to last frame's, and keeping the
// previous RT is honest. `mirrorRefreshDecision` is the pure kernel of
// that guard — same shape called from `onBeforeRender` and re-called
// from `scripts/test-city-water.mjs` and `scripts/perf-city-water.mjs`
// so the cadence is testable without a WebGL context.
//
// Day slot bucketing — the Preetham sky rebakes on four cardinal
// boundaries (dawn/day/dusk/night), and the reflection tracks it. We
// bucket the day fraction into 24 slots (roughly one per solar hour)
// so a very slow day cycle still refreshes the mirror at a smooth
// cadence even when the visitor is holding perfectly still.
export const MIRROR_DAY_SLOTS = 24;
/** Bucket a 0..1 day fraction into a discrete slot for the idle guard. */
export function mirrorDaySlot(dayFraction: number): number {
  if (!Number.isFinite(dayFraction)) return 0;
  const norm = ((dayFraction % 1) + 1) % 1;
  return Math.floor(norm * MIRROR_DAY_SLOTS);
}

/**
 * A cheap fingerprint over a plot list: length + xor-mix of (seed,
 * sealed, role). Collision-safe enough to catch any add/remove/seal
 * flip in the idle-guard critical path; we do NOT need cryptographic
 * strength here — a false negative (missed change) at worst holds a
 * stale reflection for one frame, and a false positive (missed match)
 * just re-renders when it didn't need to.
 */
export function mirrorPlotSig(plots: ReadonlyArray<{ seed: number; sealed: boolean; role: string }>): number {
  let sig = (plots.length * 2654435761) | 0;
  for (let i = 0; i < plots.length; i += 1) {
    const p = plots[i];
    sig = (sig ^ ((p.seed | 0) + i)) >>> 0;
    sig = (Math.imul(sig, 16777619) >>> 0) ^ (p.sealed ? 0x9e3779b1 : 0x85ebca6b);
    // Fold in a short-hash of the role so a role-flip is caught even
    // when seed and sealed are unchanged.
    const roleTag = p.role.length | (p.role.charCodeAt(0) << 4);
    sig = (sig ^ roleTag) >>> 0;
  }
  return sig | 0;
}

/** Result of the idle-guard decision. */
export type MirrorRefreshOutcome =
  /** first frame or invalidator changed — do a full render. */
  | "render"
  /** medium tier alternate frame — hold the previous RT. */
  | "skip-medium-parity"
  /** camera + epoch identical to the last render — hold the previous RT. */
  | "skip-idle";

export type MirrorRefreshState = {
  /** Whether a mirror render has ever landed. First frame always renders. */
  hasRendered: boolean;
  /** Whether the visitor's camera matrix has moved since the last render. */
  camChanged: boolean;
  /** Whether any invalidator (sky slot, plot sig, tier, RT size) has changed. */
  epochChanged: boolean;
  /**
   * The frame counter's parity (0/1) for the medium-tier every-other-frame
   * cadence. Ignored on high tier. The counter is bumped once per update()
   * regardless of whether we actually rendered.
   */
  mediumFrameParity: 0 | 1;
  /** Current governor tier — decides the parity gate. */
  tier: QualityTier;
};

/**
 * Pure kernel of the water mirror's idle guard. Given the state of the
 * invalidators for one frame, return whether we render the reflection
 * RT or hold the previous one. The reflection is a low-frequency signal:
 * a still visitor at a still hour has no reason to re-render the mirror
 * every frame at 60 Hz. Medium tier caps the refresh at 30 Hz (every
 * other frame) even when the scene is actively changing — the primary
 * scene stays at 60 Hz; only the mirror halves.
 */
export function mirrorRefreshDecision(state: MirrorRefreshState): MirrorRefreshOutcome {
  if (!state.hasRendered) return "render";
  const invalidated = state.camChanged || state.epochChanged;
  if (state.tier === "medium") {
    // On medium, honour parity BEFORE checking invalidation: even a
    // moving camera on medium is served at 30 Hz. This is what caps
    // the mirror's cost on the M1 baseline.
    if (state.mediumFrameParity === 1) return "skip-medium-parity";
    // Even-parity frame: if nothing changed, still skip — a moving
    // scene will hit the parity gate on odd frames and the render
    // path on even ones, giving 30 Hz.
    if (!invalidated) return "skip-idle";
    return "render";
  }
  // high / low / sleep: only skip when nothing has changed.
  if (!invalidated) return "skip-idle";
  return "render";
}

// ─── public API ─────────────────────────────────────────────────────────

export type CityWaterUpdate = {
  dayFraction: number;
  /** night amount 0..1, same variable the ground shader takes */
  night: number;
  /** ms elapsed since last update — advances the wave scroll */
  dtMs: number;
  /** current governor tier — decides which mesh is visible */
  tier: QualityTier;
  /** live plot data; kept for legacy callers, unused by the SSR path */
  plots: ReadonlyArray<CityWaterProxy>;
};

export type CityWater = {
  /** the scene to hand createCityComposer for its water RenderPass */
  scene: THREE.Scene;
  /** feed once per frame before composer.render() */
  update(u: CityWaterUpdate): void;
  /**
   * Resize the reflection RT for a new canvas size and pixel ratio.
   * City.tsx calls this in the SAME ResizeObserver callback that resizes
   * the composer, so the mirror's pixel budget rides the same shape as
   * the frame.
   */
  setSize(width: number, height: number, pixelRatio: number): void;
  /**
   * Set (or clear) the cubemap fallback used for grazing reflections.
   * Handed the citySky.background cube texture by City.tsx.
   */
  setEnvMap(env: THREE.CubeTexture | null): void;
  /** dispose GL resources; call before renderer.dispose() */
  dispose(): void;
  /**
   * Snapshot the idle-guard counters. Used by scripts/perf-city-water.mjs
   * and any devtools poke to prove the mirror is holding stale RTs on
   * idle frames instead of re-rendering the skyline every tick. Not on
   * the render hot path — call once per second or on demand.
   */
  getMirrorStats(): { renders: number; skips: number };
};

/**
 * Perf-probe surface for the mirror render. See src/lib/city-composer.ts
 * for the sibling type on the composer side — kept structurally identical
 * so the tick loop can hand both probes the same ring buffer.
 *
 * The mirror runs INSIDE the composer's water RenderPass (from
 * `water.onBeforeRender`), so `mirror_ms` is a component of `composer_ms`,
 * not additive to it. A future PR that skips the mirror on medium tier
 * needs both numbers so the delta the PR claims is attributable.
 */
export type CityWaterPerfProbe = {
  /**
   * Called once per successful mirror RT render — the wall-clock delta
   * from just before the reflection scene is rendered to the RT to just
   * after. Skipped frames (the idle-guard fast path) do NOT call this;
   * a caller counting them can read `getMirrorStats()` for the same
   * information.
   */
  onMirrorFrame(mirrorMs: number): void;
};

export type CityWaterOptions = {
  /** initial canvas size in CSS pixels */
  width: number;
  height: number;
  /** initial pixel ratio — matches renderer.getPixelRatio() at mount */
  pixelRatio: number;
  /**
   * Optional perf probe. When present, `onBeforeRender` measures the wall
   * time around the mirror `renderer.render(skylineScene, mirrorCam)`
   * call and forwards the delta to `probe.onMirrorFrame(ms)`. Off by
   * default; a null probe costs one property read per non-skipped mirror
   * render.
   */
  perfProbe?: CityWaterPerfProbe;
  /**
   * The real 3D skyline scene the composer already renders in its skyline
   * RenderPass. The SSR path renders this scene from a mirror camera into
   * a colour+depth RT once per water pass. When absent (tests, mocks),
   * the water still runs — its SSR shader gets an empty RT and falls back
   * cleanly to the cubemap / analytic sky sample every fragment.
   */
  skylineScene?: THREE.Scene;
  /**
   * The unfiltered HDR cube of the sky (citySky.background). Sampled as
   * the fallback for grazing / off-frustum reflection rays. Can be swapped
   * later via setEnvMap() when the day-fraction slot flip re-bakes the sky.
   */
  envMap?: THREE.CubeTexture | null;
};

/** Cheap identity check between a Matrix4 and a saved Float64Array of
 * its elements. Called on the render hot path — a manual unrolled
 * compare beats a Float32Array copy + memcmp in Node, and reads the
 * matrix elements directly instead of allocating a Vector3 per axis. */
function matrixEqualsElements(m: THREE.Matrix4, saved: Float64Array): boolean {
  const e = m.elements;
  for (let i = 0; i < 16; i += 1) {
    if (e[i] !== saved[i]) return false;
  }
  return true;
}
function copyMatrixElements(m: THREE.Matrix4, dst: Float64Array): void {
  const e = m.elements;
  for (let i = 0; i < 16; i += 1) {
    dst[i] = e[i];
  }
}

/**
 * Build the /city harbour. Idempotent per mount — nothing here is global,
 * so a remount produces a fresh mirror pipeline and a fresh RT.
 */
export function createCityWater(opts: CityWaterOptions): CityWater {
  const scene = new THREE.Scene();

  const normalTex = getWaveNormalTexture();

  // ── mirror render target (color + depth) ─────────────────────────────
  // The reflection colour buffer is a HalfFloat RT (HDR headroom for the
  // dusk sky in the mirror). The depth is captured to a DepthTexture so
  // the water shader can raymarch against real scene depth.
  const initialRTWidth = Math.max(128, Math.floor(opts.width * opts.pixelRatio * 0.5));
  const initialRTHeight = Math.max(128, Math.floor(opts.height * opts.pixelRatio * 0.5));
  const depthTex = new THREE.DepthTexture(initialRTWidth, initialRTHeight);
  depthTex.format = THREE.DepthFormat;
  depthTex.type = THREE.UnsignedIntType;
  const reflectionRT = new THREE.WebGLRenderTarget(initialRTWidth, initialRTHeight, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: depthTex,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  // ── mirror camera (rebuilt per-frame from main camera) ───────────────
  // A perspective camera whose world matrix is the visitor's cityCam
  // reflected across the water plane. matrixAutoUpdate is off so we
  // control the world matrix directly per frame.
  const mirrorCam = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  mirrorCam.matrixAutoUpdate = false;

  // Reflection matrix for the water plane y = WATER_PLANE_Y with world
  // normal (0, 1, 0). Precomputed once — it's a static of the plane.
  const reflectMatrix = new THREE.Matrix4();
  reflectMatrix.set(
    1, 0, 0, 0,
    0, -1, 0, 2 * WATER_PLANE_Y,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );

  // Clipping plane: don't render anything BELOW the water plane into the
  // mirror RT (that would be visible as the world seen through the water
  // from the wrong side). The plane's world normal is +Y with constant
  // -Y so `n·p + d >= 0` selects points above the water.
  const worldClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_PLANE_Y + 0.001);

  // ── water mesh (SSR) ─────────────────────────────────────────────────
  const waterGeo = new THREE.PlaneGeometry(WATER_PLANE_WIDTH, WATER_PLANE_DEPTH, 1, 1);
  // uTextureMatrix is the classic Reflector projection matrix: it
  // maps world-space fragment position into UV coords in the mirror RT.
  // Rebuilt each frame from the mirror camera's projection+view.
  const textureMatrix = new THREE.Matrix4();

  const ssrUniforms: { [k: string]: THREE.IUniform } = {
    tReflectionColor:      { value: reflectionRT.texture },
    tReflectionDepth:      { value: depthTex },
    tNormal:               { value: normalTex },
    uEnvMap:               { value: opts.envMap ?? null },
    uTextureMatrix:        { value: textureMatrix },
    uMirrorViewProjMatrix: { value: new THREE.Matrix4() },
    uCameraPos:            { value: new THREE.Vector3() },
    uSkyTint:              { value: new THREE.Vector3(0.5, 0.5, 0.6) },
    uTime:                 { value: 0 },
    uAmplitude:            { value: 0.045 },
    uWaveStrength:         { value: 1.0 },
    uNight:                { value: 0 },
    uReflectMix:           { value: 0.85 },
    uMarchSteps:           { value: MARCH_STEPS_HIGH },
    uMarchDistance:        { value: MARCH_DISTANCE },
    uEnvIntensity:         { value: 1.0 },
    uHasEnv:               { value: opts.envMap ? 1.0 : 0.0 },
  };

  const ssrMat = new THREE.ShaderMaterial({
    uniforms: ssrUniforms,
    vertexShader: SSR_VERT,
    fragmentShader: SSR_FRAG,
    defines: opts.envMap ? { USE_ENV_CUBE: "" } : {},
  });

  const water = new THREE.Mesh(waterGeo, ssrMat);
  water.position.set(0, WATER_PLANE_Y, WATER_PLANE_CENTER_Z);
  water.rotation.x = -Math.PI / 2;
  water.layers.set(0);
  scene.add(water);

  // ── static mirror mesh (low tier) ────────────────────────────────────
  const staticMat = new THREE.ShaderMaterial({
    uniforms: {
      tNormal:  { value: normalTex },
      uSkyTint: { value: new THREE.Vector3(0.5, 0.5, 0.6) },
      uTime:    { value: 0 },
      uNight:   { value: 0 },
    },
    vertexShader: STATIC_VERT,
    fragmentShader: STATIC_FRAG,
  });
  const staticGeo = new THREE.PlaneGeometry(WATER_PLANE_WIDTH, WATER_PLANE_DEPTH, 1, 1);
  const staticMesh = new THREE.Mesh(staticGeo, staticMat);
  staticMesh.position.set(0, WATER_PLANE_Y + 0.001, WATER_PLANE_CENTER_Z);
  staticMesh.rotation.x = -Math.PI / 2;
  staticMesh.layers.set(0);
  staticMesh.visible = false;
  scene.add(staticMesh);

  // ── mirror render (onBeforeRender) ──────────────────────────────────
  // Runs inside the composer's water RenderPass, once per frame. The
  // mesh's onBeforeRender fires with the main renderer and the main
  // camera. We derive the mirror camera from that camera, then render
  // the skylineScene into reflectionRT before the water mesh itself
  // draws. State is saved and restored around the call.
  const skylineSceneForMirror = opts.skylineScene ?? null;
  const originalMainViewMatrix = new THREE.Matrix4();
  // Vec3 scratch buffers — allocated once.
  const scratchCamPos = new THREE.Vector3();

  // Idle-guard state — closed over by both update() (bumps sceneEpoch
  // when the invalidators change) and onBeforeRender (compares against
  // the last rendered epoch + camera matrix). See mirrorRefreshDecision
  // above for the pure kernel of the decision.
  const lastCamMatrix = new Float64Array(16);
  let hasCamBaseline = false;
  let sceneEpoch = 0;
  let renderedEpoch = -1;
  let hasEverRendered = false;
  // Counts refreshes across the lifetime of the water — read by the
  // perf harness (scripts/perf-city-water.mjs) to prove the idle-guard
  // is holding the RT. Also useful in the field for a devtools poke.
  let mirrorRenderCount = 0;
  let mirrorSkipCount = 0;

  water.onBeforeRender = function ssrOnBeforeRender(
    renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    // Update the camera-position uniform + build reflected mirror camera.
    scratchCamPos.setFromMatrixPosition(camera.matrixWorld);
    (ssrUniforms.uCameraPos.value as THREE.Vector3).copy(scratchCamPos);

    // Derive mirror camera from the main perspective camera. We assume
    // the input is a PerspectiveCamera; if it isn't (test/mock), we
    // simply skip the render and let the shader run on the last RT.
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      return;
    }
    const mainCam = camera as THREE.PerspectiveCamera;

    // ── idle guard ──────────────────────────────────────────────────
    // If the camera hasn't moved and no invalidator has fired since the
    // last render, keep the previous RT — the mirror is a low-frequency
    // signal and reproducing the same pixels is pure waste. Medium tier
    // additionally caps refresh at 30 Hz (every other frame) even when
    // the scene is actively changing; the primary scene stays at 60 Hz.
    const camMatChanged = hasCamBaseline
      ? !matrixEqualsElements(mainCam.matrixWorld, lastCamMatrix)
      : true;
    const outcome = mirrorRefreshDecision({
      hasRendered: hasEverRendered,
      camChanged: camMatChanged,
      epochChanged: renderedEpoch !== sceneEpoch,
      mediumFrameParity: (frameCounter & 1) as 0 | 1,
      tier: lastTier ?? "high",
    });
    if (outcome !== "render") {
      // Do NOT touch uMirrorViewProjMatrix or textureMatrix on a skipped
      // frame — the water shader must keep projecting against the same
      // mirror camera whose scene lives in the RT, or we'd get parallax
      // mis-registration. The uCameraPos uniform still updated above is
      // safe: it feeds fresnel, not the mirror UV lookup.
      mirrorSkipCount += 1;
      return;
    }

    // Match projection + aspect so the mirror RT frames the same view.
    mirrorCam.projectionMatrix.copy(mainCam.projectionMatrix);
    (
      mirrorCam as unknown as { projectionMatrixInverse: THREE.Matrix4 }
    ).projectionMatrixInverse.copy(
      (
        mainCam as unknown as { projectionMatrixInverse: THREE.Matrix4 }
      ).projectionMatrixInverse,
    );
    mirrorCam.fov = mainCam.fov;
    mirrorCam.aspect = mainCam.aspect;
    mirrorCam.near = mainCam.near;
    mirrorCam.far = mainCam.far;

    // Reflect the main camera's world matrix across the water plane.
    // mirror.worldMatrix = reflectMatrix * mainCam.worldMatrix
    originalMainViewMatrix.copy(mainCam.matrixWorld);
    mirrorCam.matrixWorld.multiplyMatrices(reflectMatrix, originalMainViewMatrix);
    // Because the reflection has determinant -1 (flips one axis), the
    // camera coordinate system's handedness flips. THREE handles this in
    // matrixWorldInverse but we must recompute it from the world matrix.
    mirrorCam.matrixWorldInverse.copy(mirrorCam.matrixWorld).invert();
    // Refresh derived matrices for our uniform + textureMatrix build.
    mirrorCam.updateMatrixWorld(true);
    // Recompose the mirror view-projection: proj * viewInv, where viewInv
    // is matrixWorldInverse (three uses this in renderer.render).
    const mvp = ssrUniforms.uMirrorViewProjMatrix.value as THREE.Matrix4;
    mvp.multiplyMatrices(mirrorCam.projectionMatrix, mirrorCam.matrixWorldInverse);

    // textureMatrix: scale/bias(0.5) * proj * view — the classic Reflector
    // matrix so the water shader can project a world position directly
    // into mirror RT UV.
    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    textureMatrix.multiply(mvp);

    // Render the mirror scene. Only when skylineScene is provided AND
    // the reflected camera is above the water (the visitor is looking
    // DOWN at the surface — if the eye is below the water we don't
    // reflect, we let the shader body colour take over).
    if (!skylineSceneForMirror) return;
    if (scratchCamPos.y < WATER_PLANE_Y) return;

    // Save renderer state
    const prevRT = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevXrEnabled = renderer.xr.enabled;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevClipping = renderer.localClippingEnabled;
    const prevClippingPlanes = renderer.clippingPlanes;

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = true;
    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = [worldClipPlane];

    // Hide the water mesh itself so it can't reflect its own surface.
    const wasVisible = water.visible;
    water.visible = false;

    renderer.setRenderTarget(reflectionRT);
    // Perf probe — measure the wall time around the mirror render. The
    // reflection into `reflectionRT` is the ONE reason this whole hook
    // exists; timing it in isolation lets a "skip mirror on medium tier"
    // claim in a later PR attribute the delta correctly, instead of
    // hiding inside the composer_ms number. The branch is a single
    // property compare when the probe is absent.
    const perfProbe = opts.perfProbe;
    const mirrorStart = perfProbe
      ? (typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : 0)
      : 0;
    renderer.render(skylineSceneForMirror, mirrorCam);
    if (perfProbe) {
      const mirrorEnd = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : mirrorStart;
      try { perfProbe.onMirrorFrame(mirrorEnd - mirrorStart); }
      catch { /* probe error is not a render error */ }
    }

    water.visible = wasVisible;

    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXrEnabled;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.clippingPlanes = prevClippingPlanes;
    renderer.localClippingEnabled = prevClipping;

    // Save the state that gates the next frame's guard.
    copyMatrixElements(mainCam.matrixWorld, lastCamMatrix);
    hasCamBaseline = true;
    renderedEpoch = sceneEpoch;
    hasEverRendered = true;
    mirrorRenderCount += 1;
  };

  // ── state ────────────────────────────────────────────────────────────
  let waveTime = 0;
  let lastTier: QualityTier | null = null;
  let lastCanvasW = opts.width;
  let lastCanvasH = opts.height;
  let lastPixelRatio = opts.pixelRatio;
  let currentRTWidth = initialRTWidth;
  let currentRTHeight = initialRTHeight;
  // Frame counter drives the medium-tier every-other-frame gate. Bumped
  // in update() so the parity is a property of the whole tick, not of
  // whether onBeforeRender was called that tick.
  let frameCounter = 0;
  let lastDaySlot = -1;
  let lastPlotSig = 0;
  let plotSigInitialised = false;

  function resizeRT(tier: QualityTier | null): void {
    const scale = tier === "high" ? 0.7 : tier === "medium" ? 0.5 : 0.5;
    const targetW = Math.max(128, Math.floor(lastCanvasW * lastPixelRatio * scale));
    const targetH = Math.max(128, Math.floor(lastCanvasH * lastPixelRatio * scale));
    if (targetW === currentRTWidth && targetH === currentRTHeight) return;
    reflectionRT.setSize(targetW, targetH);
    depthTex.image = { width: targetW, height: targetH } as unknown as HTMLImageElement;
    depthTex.needsUpdate = true;
    currentRTWidth = targetW;
    currentRTHeight = targetH;
    // Resize is a hard invalidator: the RT dimensions change so the
    // previous contents are stale.
    sceneEpoch = (sceneEpoch + 1) | 0;
  }

  return {
    scene,
    update(u: CityWaterUpdate) {
      waveTime = waveScrollFor(u.dtMs, waveTime);

      const tint = skyTintForDay(u.dayFraction);
      const tintVec = new THREE.Vector3(tint[0], tint[1], tint[2]);

      // SSR uniforms
      ssrUniforms.uTime.value = waveTime;
      ssrUniforms.uNight.value = u.night;
      (ssrUniforms.uSkyTint.value as THREE.Vector3).copy(tintVec);

      // Static fallback uniforms
      staticMat.uniforms.uTime.value = waveTime;
      staticMat.uniforms.uNight.value = u.night;
      (staticMat.uniforms.uSkyTint.value as THREE.Vector3).copy(tintVec);

      // Tier flip: visibility + march-step count + RT size.
      if (u.tier !== lastTier) {
        const isReflect = u.tier === "high" || u.tier === "medium";
        const isStatic = u.tier === "low";
        water.visible = isReflect;
        staticMesh.visible = isStatic;
        ssrUniforms.uMarchSteps.value =
          u.tier === "high" ? MARCH_STEPS_HIGH : MARCH_STEPS_MEDIUM;
        lastTier = u.tier;
        if (isReflect) resizeRT(u.tier);
        // Tier flip is an invalidator — the reflection's step count or
        // RT scale changed, so the previous contents no longer represent
        // "what this tier draws".
        sceneEpoch = (sceneEpoch + 1) | 0;
      }

      // Idle-guard invalidators driven by the update payload.
      //  1. Day slot: the Preetham sky rebakes on cardinal boundaries;
      //     bucketing dayFraction into MIRROR_DAY_SLOTS gives the mirror
      //     a smooth cadence when nothing else changes.
      //  2. Plot signature: a cheap fingerprint over the plots array
      //     catches add/remove/seal/role flips that would change the
      //     skyline scene the mirror draws. On idle the sig is stable.
      const daySlot = mirrorDaySlot(u.dayFraction);
      if (daySlot !== lastDaySlot) {
        sceneEpoch = (sceneEpoch + 1) | 0;
        lastDaySlot = daySlot;
      }
      const plotSig = mirrorPlotSig(u.plots as ReadonlyArray<{ seed: number; sealed: boolean; role: string }>);
      if (!plotSigInitialised || plotSig !== lastPlotSig) {
        if (plotSigInitialised) sceneEpoch = (sceneEpoch + 1) | 0;
        lastPlotSig = plotSig;
        plotSigInitialised = true;
      }
      // Tick the frame counter regardless of render outcome. The medium
      // tier parity gate reads (frameCounter & 1) inside onBeforeRender.
      frameCounter = (frameCounter + 1) | 0;
    },
    setSize(width: number, height: number, pixelRatio: number) {
      lastCanvasW = Math.max(1, Math.floor(width));
      lastCanvasH = Math.max(1, Math.floor(height));
      lastPixelRatio = Math.max(0.25, pixelRatio);
      resizeRT(lastTier);
      // Update the perspective camera aspect so the mirror render matches
      // the main frame's aspect on the next onBeforeRender.
      mirrorCam.aspect = lastCanvasW / Math.max(1, lastCanvasH);
      mirrorCam.updateProjectionMatrix();
    },
    setEnvMap(env: THREE.CubeTexture | null) {
      ssrUniforms.uEnvMap.value = env ?? null;
      ssrUniforms.uHasEnv.value = env ? 1.0 : 0.0;
      // Toggling the define needs a shader recompile — set/clear the
      // define and mark the material dirty.
      const hadDefine = "USE_ENV_CUBE" in (ssrMat.defines ?? {});
      const wantDefine = !!env;
      if (hadDefine !== wantDefine) {
        if (wantDefine) {
          ssrMat.defines = { ...(ssrMat.defines ?? {}), USE_ENV_CUBE: "" };
        } else {
          const next = { ...(ssrMat.defines ?? {}) } as Record<string, string>;
          delete next.USE_ENV_CUBE;
          ssrMat.defines = next;
        }
        ssrMat.needsUpdate = true;
      }
    },
    getMirrorStats() {
      return { renders: mirrorRenderCount, skips: mirrorSkipCount };
    },
    dispose() {
      try { reflectionRT.dispose(); } catch { /* noop */ }
      try { depthTex.dispose(); } catch { /* noop */ }
      try { waterGeo.dispose(); } catch { /* noop */ }
      try { ssrMat.dispose(); } catch { /* noop */ }
      try { staticGeo.dispose(); } catch { /* noop */ }
      try { staticMat.dispose(); } catch { /* noop */ }
      // normalTex is module-cached across mounts — deliberately not
      // disposed. If a future mount lands, it reuses the same GPU upload.
    },
  };
}
