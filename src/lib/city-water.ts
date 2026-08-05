/**
 * city-water — a harbour along one edge of /city, and the mirror on it.
 *
 * The brief calls the dusk-and-lit-windows moment the emotional peak of the
 * room; the harbour is what doubles it, because the sky burning behind the
 * tallest sealed plot burns twice — once in the tower's glass, once in the
 * water. This module owns the water world: a THREE.Reflector plane along
 * the +z edge of the city footprint, a scrolled wave normal that ripples the
 * reflection at ~0.02 uv/s, and — since R6 — the REAL extruded skyline
 * rendered into the reflector's RT, so what you see doubled on the water is
 * the same towers, lit windows, and moving cars the eye is looking at above
 * the surface.
 *
 * The R6 fix — real skyline in the mirror:
 *   Before R6 the reflection carried a layer-1 field of MeshStandardMaterial
 *   proxy boxes: a tiny surrogate skyline whose warm dusk emissive tried to
 *   stand in for the actual towers. The London-at-dusk brief died at the
 *   waterline because what you saw doubled was a box field, not the actual
 *   city — the emotional peak deflated at the exact place it was meant to
 *   burn twice. R6-C fixes it: `createCityWater` now takes the same
 *   `skylineScene` the composer runs in its RenderPass, and the reflector's
 *   `onBeforeRender` is patched to render THAT scene into the RT after the
 *   sky-dome pass. The layer-1 proxy field is retired (proxyHeightFor still
 *   exported for legacy tests) and the sky dome writes no depth so the real
 *   towers occlude it cleanly at every camera pitch. Traffic — the cars on
 *   the road graph, the boats crossing the strip — lives in that same
 *   skylineScene and rides along for free in the mirror.
 *
 * The rebase — cityCam owns the frame:
 *   Before f7543df the water module carried its own fixed perspective
 *   camera because the room had no shared world camera. After f7543df,
 *   `createCityCamera` is the single perspective camera driving the sky
 *   pass, IBL, and the extruded prism skyline. The Reflector must share
 *   THAT camera or its mirrored horizon slides off as soon as a pinch
 *   climbs from eye-level to bird's-eye. So the water scene no longer
 *   owns a camera: City.tsx hands `cityCam.camera` to `createCityComposer`
 *   as the `waterCam`, the composer's water RenderPass renders with that
 *   camera, and Reflector's onBeforeRender reads it — its virtualCamera
 *   is then the reflection of the same eye the visitor is looking through.
 *
 * How it composes into /city:
 *   City.tsx builds this water = createCityWater({ skylineScene, ... }) and
 *   hands its scene + cityCam.camera to createCityComposer as a water
 *   RenderPass, drawn AFTER the skyline and BEFORE bloom. RenderPass runs
 *   with clear:false (colors from earlier passes stay); depth is preserved
 *   from the skyline pass so tall buildings still occlude the water beyond
 *   them.
 *
 * Tier gating (the door B/C/D depend on):
 *   high, medium  → Reflector runs; its RT is 0.7 × canvas on high, 0.5 ×
 *                   on medium. Wave normal scrolls; the reflector's
 *                   virtualCamera renders the real skylineScene into its
 *                   RT after the sky-dome — the mirror carries the same
 *                   towers, lit windows, and cars the eye sees above.
 *   low           → Reflector is hidden; a cheaper static mirror mesh
 *                   takes its place, painting the sky gradient with a
 *                   wave normal-map highlight but no live reflection.
 *   sleep         → the whole water pass is skipped by the composer.
 *
 * Nothing here touches gesture, city.ts laws, or persistence. The pure
 * bits — `waveScrollFor(dt, prev)`, `skyTintForDay(dayFraction)`,
 * `proxyHeightFor` — are exported for test-city-water.mjs to pin without
 * a WebGL context.
 */

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

import type { QualityTier } from "@/lib/room-runtime";

/** The role symbols this module cares about. Aligned with `PlotRole`
 * from `src/lib/city.ts`, but declared locally so this module has no
 * import edge back into city.ts's laws. */
export type CityWaterRole = "empty" | "home" | "store" | "event" | "tree";

/**
 * A single reflectable proxy: the minimum a plot needs to hand over to
 * the harbour. City.tsx builds these once per frame from the live plot
 * array; the harbour reads them into its N=WATER_PROXY_COUNT boxes.
 *
 * `x` and `y` are normalized 0..1 (same space city.ts uses for plot
 * positions and roads). We remap to world XZ inside the module.
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

/** How many building proxies the reflection carries. Sized to comfortably
 * cover /city's MAX_PLOTS=48 tallest sealed plots without a per-frame
 * geometry rebuild; if the visitor plants more than this we just show
 * the tallest ones, which is what the visitor is looking at anyway. */
export const WATER_PROXY_COUNT = 16;

/** Scroll rate of the wave normal — the brief pins this at ~0.02 uv/s. */
export const WAVE_SCROLL_RATE = 0.02;

/**
 * Advance the wave scroll offset by `dt` milliseconds.
 *
 * Kept pure so a test can pin the invariant (monotonic, wraps at 1 to keep
 * float precision). The renderer feeds this into the Reflector shader as
 * `uTime`, which drives two normal-map lookups scrolling in different
 * directions — a cheap approximation of anisotropic wave motion.
 */
export function waveScrollFor(dtMs: number, prev: number): number {
  if (!Number.isFinite(dtMs) || !Number.isFinite(prev)) return prev || 0;
  const next = (prev || 0) + Math.max(0, dtMs) * 0.001 * WAVE_SCROLL_RATE;
  // Wrap at 1 so the shader's UV never grows past float precision. The
  // normal map tiles, so the wrap is invisible.
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
  // Palette anchors — each row is a linear RGB the reflector shader adds
  // as a base, before it composites the reflection texture on top.
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
 * reflection. Sealed events tower; sealed stores follow; homes and trees
 * take the middle; unsealed plots sit low. Pure and testable.
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

// ─── shader source ──────────────────────────────────────────────────────
// A modified Reflector shader: samples the base reflection through a
// scrolled normal map, adds a sky-color base so the reflection reads as
// water at any time of day, and darkens under the room's night value.
//
// This shader must declare `tDiffuse`, `color`, and `textureMatrix` — the
// Reflector base class writes those uniforms unconditionally. Additional
// uniforms are populated per-frame from City.tsx via the module's update().
const WATER_VERT = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  varying vec2 vLocalUv;

  void main() {
    vLocalUv = uv;
    vUv = textureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tNormal;
  uniform vec3 color;
  uniform vec3 uSkyTint;
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uNight;
  uniform float uReflectMix;

  varying vec4 vUv;
  varying vec2 vLocalUv;

  void main() {
    // two normal samples, scrolling in slightly different directions, to
    // approximate anisotropic wave motion without a real ocean shader
    vec2 uv1 = vLocalUv * 3.0 + vec2(uTime * 1.0, uTime * 0.7);
    vec2 uv2 = vLocalUv * 5.0 + vec2(-uTime * 0.8, uTime * 1.3);
    vec3 n1 = texture2D(tNormal, uv1).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, uv2).xyz * 2.0 - 1.0;
    vec3 nrm = normalize(n1 + n2);

    // distort the projective UV by the wave normal — the reflection
    // ripples exactly where the surface tilts
    vec4 uvOffset = vec4(nrm.xy * uAmplitude, 0.0, 0.0);
    vec4 uv = vUv + uvOffset;

    vec3 refl = texture2DProj(tDiffuse, uv).rgb * color;
    vec3 sky  = uSkyTint;
    vec3 surface = mix(sky, refl, uReflectMix);

    // night darkens toward a cool navy; matches the ground shader's own
    // night ramp and Coin's night-veil layer
    vec3 nightTint = vec3(0.10, 0.14, 0.28);
    surface = mix(surface, surface * nightTint * 4.0, uNight * 0.45);

    // vLocalUv.y = 0 is the FAR edge of the plane (near horizon), 1 is the
    // near edge. Subtle darkening near the horizon so the water recedes.
    float horizon = smoothstep(0.0, 0.35, vLocalUv.y);
    surface *= mix(0.72, 1.0, horizon);

    // Specular sparkle where the wave normal points up.
    float spec = smoothstep(0.65, 1.0, nrm.z);
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
      // gradient of h(u,v) = sin(u)*cos(v) + 0.5*sin(2u+1)*cos(3v)
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
// to span the full city width. The reflector's virtualCamera sees the
// proxies + sky dome layer 1; the main pass sees the plane sitting flat
// like a strip of harbour beyond the plot grid.
const WATER_PLANE_WIDTH = 96;   // spans the full city width plus a margin
const WATER_PLANE_DEPTH = 32;   // ~1/3 the field depth is a plausible harbour
const WATER_PLANE_CENTER_Z = 50; // beyond the +z edge of the ±40 field
const WATER_PLANE_Y = 0.05;      // just above worldGround (y=0) so it draws on top

// Proxies live at world scale behind the plane; the reflector camera
// looking upward from below the plane sees these as a silhouetted skyline.
const PROXY_SPREAD_X = 84;       // spread across the harbour's width
const PROXY_FAR_Z = 72;          // sit past the far edge of the plane
const PROXY_NEAR_Z = 55;         // closest a proxy comes to the plane
const PROXY_HEIGHT_SCALE = 12;   // proxyHeightFor's ~2.5 max → ~30 units tall
const PROXY_WIDTH = 3.4;
const PROXY_WIDTH_EVENT = 5.6;
const PROXY_DEPTH = 3.0;
const PROXY_DEPTH_EVENT = 4.4;
const SKY_RADIUS = 260;

// ─── public API ─────────────────────────────────────────────────────────

export type CityWaterUpdate = {
  dayFraction: number;
  /** night amount 0..1, same variable the ground shader takes */
  night: number;
  /** ms elapsed since last update — advances the wave scroll */
  dtMs: number;
  /** current governor tier — decides which mesh is visible */
  tier: QualityTier;
  /** live plot data; the tallest sealed ones populate the reflection proxies */
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
  /** dispose GL resources; call before renderer.dispose() */
  dispose(): void;
};

export type CityWaterOptions = {
  /** initial canvas size in CSS pixels */
  width: number;
  height: number;
  /** initial pixel ratio — matches renderer.getPixelRatio() at mount */
  pixelRatio: number;
  /**
   * The real 3D skyline scene the composer already renders in its skyline
   * RenderPass. When provided, the reflector renders THIS scene into its
   * RT from the virtualCamera — the same extruded prisms, PBR facades,
   * lit windows, and traffic that live above the water surface show up
   * doubled below it. When absent (tests, mocks), the reflector falls back
   * to sampling only the sky-dome — the mirror stays cheap-and-flat but
   * the pipeline still runs.
   *
   * IMPORTANT: this scene must NOT include the water plane itself, or the
   * reflector would render its own surface into its own reflection.
   * City.tsx satisfies this by keeping the water plane inside water.scene
   * and everything else inside skyline.scene.
   */
  skylineScene?: THREE.Scene;
};

/**
 * Build the /city harbour. Idempotent per mount — nothing here is global,
 * so a remount produces a fresh Reflector and a fresh RT.
 *
 * NOTE: this module owns NO camera. The reflector is driven by whichever
 * camera the composer's water RenderPass runs with — City.tsx passes
 * `cityCam.camera` so the mirror's virtualCamera is the reflection of
 * the same eye the visitor is looking through.
 */
export function createCityWater(opts: CityWaterOptions): CityWater {
  const scene = new THREE.Scene();
  // No `scene.background` — that would fill the pixels above the water
  // strip when this pass runs with clear:false, hiding the ground and
  // plots that the earlier passes wrote there.

  // Wave normal — one texture shared across the reflector and the static
  // fallback material.
  const normalTex = getWaveNormalTexture();

  // ── Reflector (high/medium tier) ─────────────────────────────────────
  // A plane covering the harbour strip. The Reflector base class computes
  // its plane normal from the mesh's world matrix, so we rotate the MESH
  // rather than baking rotation into geometry.
  const waterGeo = new THREE.PlaneGeometry(WATER_PLANE_WIDTH, WATER_PLANE_DEPTH, 1, 1);
  const initialRTWidth = Math.max(128, Math.floor(opts.width * opts.pixelRatio * 0.5));
  const initialRTHeight = Math.max(128, Math.floor(opts.height * opts.pixelRatio * 0.5));
  const reflector = new Reflector(waterGeo, {
    textureWidth: initialRTWidth,
    textureHeight: initialRTHeight,
    color: new THREE.Color(0xa0b0c0),
    clipBias: 0.003,
    multisample: 0,
    shader: {
      uniforms: {
        tDiffuse:      { value: null },
        tNormal:       { value: normalTex },
        color:         { value: null },
        textureMatrix: { value: null },
        uSkyTint:      { value: new THREE.Vector3(0.5, 0.5, 0.6) },
        uTime:         { value: 0 },
        uAmplitude:    { value: 0.045 },
        uNight:        { value: 0 },
        uReflectMix:   { value: 0.72 },
      },
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
    },
  }) as Reflector & { material: THREE.ShaderMaterial };
  reflector.position.set(0, WATER_PLANE_Y, WATER_PLANE_CENTER_Z);
  reflector.rotation.x = -Math.PI / 2;
  reflector.layers.set(0);
  // Reflector's virtualCamera renders whichever scene the reflector lives
  // in from the mirrored viewpoint. We want the mirrored scene to include
  // the proxies + sky dome (layer 1) — the main camera stays on layer 0
  // so those are only visible via reflection.
  reflector.camera.layers.enable(0);
  reflector.camera.layers.enable(1);
  scene.add(reflector);

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
  staticMesh.visible = false; // reflector is default; tier flip toggles this
  scene.add(staticMesh);

  // ── sky dome (layer 1, mirror-only) ──────────────────────────────────
  // A hemisphere behind the water at world scale, only the reflector's
  // virtualCamera sees it. The dome is centered near the proxies so a
  // reflected camera looking upward-and-back catches the horizon tint.
  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uSkyTint:  { value: new THREE.Vector3(0.5, 0.5, 0.6) },
      uZenith:   { value: new THREE.Vector3(0.15, 0.20, 0.35) },
      uHorizon:  { value: new THREE.Vector3(0.9,  0.5,  0.3) },
      uNight:    { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSkyTint;
      uniform float uNight;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        col = mix(col, uSkyTint, 0.35);
        col = mix(col, col * vec3(0.20, 0.25, 0.45), uNight * 0.7);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  // depthWrite off: after the R6 fix we render skylineScene into the same
  // RT as a second pass, and the towers must occlude the sky dome pixel-
  // perfect without fighting a far-plane depth from the dome itself. The
  // dome fills the color buffer but leaves the depth buffer at 1.0, so any
  // tower fragment wins the depth test cleanly. depthTest stays on so
  // early-Z can still skip fragments hidden behind opaque terrain (there
  // is none in the reflection, but keeping the state consistent avoids
  // surprises if a future opaque proxy is re-added).
  skyMat.depthWrite = false;
  const sky = new THREE.Mesh(skyGeo, skyMat);
  // renderOrder = -1 so the dome draws first, painting the background before
  // the (currently empty) reflector scene contents. When we chain a second
  // renderer.render(skylineScene, virtualCamera) with autoClear=false, this
  // is what fills the horizon color the towers stand against.
  sky.renderOrder = -1;
  sky.position.set(0, -5, WATER_PLANE_CENTER_Z + 15);
  sky.layers.set(1);
  scene.add(sky);

  // ── building proxies (layer 1, mirror-only, legacy fallback) ────────
  // Retired by R6: when `skylineScene` is provided, the reflector renders
  // the real extruded prism skyline into its RT (see the onBeforeRender
  // patch below), so no proxy field is needed. When skylineScene is
  // absent — the test-shim path, or a future caller that hasn't wired
  // the skyline yet — we still populate the layer-1 proxy field so the
  // mirror carries a something-shaped-like-a-city rather than an empty
  // sky. The `proxyHeightFor` pure helper stays exported either way, and
  // the ladder it encodes is still exercised by test-city-water.mjs.
  const hasRealSkyline = !!opts.skylineScene;
  const proxyGeo = new THREE.BoxGeometry(1, 1, 1);
  const proxyGroup = new THREE.Group();
  proxyGroup.layers.set(1);
  const proxies: THREE.Mesh[] = [];
  if (!hasRealSkyline) {
    for (let i = 0; i < WATER_PROXY_COUNT; i += 1) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.28, 0.30, 0.36),
        metalness: 0.15,
        roughness: 0.55,
        emissive: new THREE.Color(0.0, 0.0, 0.0),
      });
      const m = new THREE.Mesh(proxyGeo, mat);
      m.visible = false;
      m.layers.set(1);
      proxyGroup.add(m);
      proxies.push(m);
    }
    scene.add(proxyGroup);

    // A soft warm directional so the proxy boxes catch a sunset side — the
    // reflection reads as buildings with a lit side rather than flat cubes.
    const sunProxy = new THREE.DirectionalLight(0xffe0b0, 1.4);
    sunProxy.position.set(-60, 80, 20);
    sunProxy.layers.set(1);
    scene.add(sunProxy);
    const ambientProxy = new THREE.AmbientLight(0x8899bb, 0.6);
    ambientProxy.layers.set(1);
    scene.add(ambientProxy);
  }

  // ── real-skyline mirror (R6-C) ───────────────────────────────────────
  // When City.tsx hands us the same skylineScene the composer runs in its
  // skyline RenderPass, we teach the reflector to render THAT scene into
  // its RT after the default sky-dome pass. The result: the mirror
  // carries the actual extruded prism towers, PBR facades, lit windows,
  // and traffic — exactly what the eye sees above the surface, doubled.
  //
  // Mechanism:
  //   1. Save the default `onBeforeRender` (which sets up the virtualCam,
  //      applies the oblique frustum clip, and renders the water scene —
  //      i.e., the sky dome on layer 1 — into the reflector's RT).
  //   2. Wrap it: after the default runs, the RT has fresh sky pixels and
  //      the virtualCam has been configured. We then bind the RT again,
  //      set autoClear=false (preserve the sky pixels), and call
  //      renderer.render(skylineScene, reflector.camera) — a second pass
  //      that draws the towers on top of the dome. Depth is inherited
  //      from the dome's render (dome writes no depth; buffer stays at
  //      1.0), so any tower fragment wins depth cleanly.
  //   3. shadowMap.autoUpdate is muted for our second pass — the shadow
  //      map was already refreshed by the composer's earlier skyline
  //      RenderPass this frame, and we reuse that map for the mirror.
  //      xr.enabled is muted for symmetry with the default onBeforeRender.
  //
  // The reflector's own mesh (`reflector`) is toggled invisible for the
  // duration of our second pass so the water plane never renders into its
  // own reflection.
  //
  // If skylineScene is absent, this whole patch is skipped and the mirror
  // falls back to the legacy proxy field above.
  const skylineSceneForMirror = opts.skylineScene ?? null;
  if (skylineSceneForMirror) {
    const rt = (reflector as unknown as {
      getRenderTarget(): THREE.WebGLRenderTarget;
    }).getRenderTarget();
    const virtualCam = reflector.camera;
    // The Reflector's default onBeforeRender only reads (renderer, scene,
    // camera) from the six-arg Object3D signature — the trailing geometry,
    // material, and group are unused by its mirror math. We cast to the
    // 3-arg shape we actually invoke, and assign the wrapped fn back
    // through an `any` alias since @types/three insists on the full 6.
    const originalOnBeforeRender = reflector.onBeforeRender as unknown as (
      this: unknown,
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.Camera,
    ) => void;
    const wrapper = function patchedOnBeforeRender(
      this: unknown,
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.Camera,
    ) {
      // Default: run the mirror math, render the water scene (sky dome
      // only, since proxies aren't added on this path) into the RT. This
      // also restores the render target and toggles reflector.visible
      // back on after its own pass.
      originalOnBeforeRender.call(reflector, renderer, scene, camera);

      // Detect "facing away" early-return — same predicate the default
      // uses. If the reflector face isn't pointed at the eye, the RT
      // wasn't refreshed and there's nothing to add to it.
      const reflectorWorldPos = new THREE.Vector3().setFromMatrixPosition(
        reflector.matrixWorld,
      );
      const camWorldPos = new THREE.Vector3().setFromMatrixPosition(
        camera.matrixWorld,
      );
      const normalWs = new THREE.Vector3(0, 0, 1).applyMatrix4(
        new THREE.Matrix4().extractRotation(reflector.matrixWorld),
      );
      const viewDot = normalWs.dot(
        new THREE.Vector3().subVectors(reflectorWorldPos, camWorldPos),
      );
      if (viewDot > 0) return;

      // Second pass: draw the real skyline on top of the sky dome in the
      // same RT. Preserve renderer state around the call.
      const prevRT = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      const prevXrEnabled = renderer.xr.enabled;
      const prevShadowAuto = renderer.shadowMap.autoUpdate;

      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(rt);
      renderer.autoClear = false;

      // Hide the water plane itself for the mirror pass — belt-and-braces,
      // since the reflector is added to `scene` (water scene) and NOT to
      // skylineScene, but if a future rearrange puts the plane into
      // skylineScene by accident this guards against reflecting the
      // mirror into itself.
      const wasVisible = reflector.visible;
      reflector.visible = false;
      renderer.render(skylineSceneForMirror, virtualCam);
      reflector.visible = wasVisible;

      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevAutoClear;
      renderer.xr.enabled = prevXrEnabled;
      renderer.shadowMap.autoUpdate = prevShadowAuto;

      // Restore viewport if the outer camera had one — mirrors the tail
      // of the default onBeforeRender for a compound-render symmetry.
      const outerCam = camera as THREE.Camera & { viewport?: THREE.Vector4 };
      if (outerCam.viewport !== undefined) {
        renderer.state.viewport(outerCam.viewport);
      }
    };
    // Assign through an `any` alias because @types/three declares
    // onBeforeRender as the 6-arg variant; the runtime callback only uses
    // the leading 3 (renderer, scene, camera).
    (reflector as unknown as { onBeforeRender: typeof wrapper }).onBeforeRender = wrapper;
  }

  // ── state ────────────────────────────────────────────────────────────
  let waveTime = 0;
  let lastTier: QualityTier | null = null;
  // Pre-allocated scratch buffer so update() allocates nothing per frame.
  const sortBuf: Array<{ p: CityWaterProxy; score: number }> = [];
  // Last CSS-pixel canvas size received; RT resizes read this.
  let lastCanvasW = opts.width;
  let lastCanvasH = opts.height;
  let lastPixelRatio = opts.pixelRatio;

  // ── size + rt sizing ─────────────────────────────────────────────────
  // Reflector's RT is created in its constructor and there is no public
  // resize() method — we reach through and rebuild the RT if the canvas
  // shape changed or the tier flipped. High tier keeps 0.7× canvas × dpr,
  // medium 0.5×, low doesn't use the RT.
  const reflectorLike = reflector as unknown as {
    getRenderTarget(): THREE.WebGLRenderTarget;
  };
  let currentRTWidth = initialRTWidth;
  let currentRTHeight = initialRTHeight;

  function resizeRT(tier: QualityTier | null): void {
    const scale = tier === "high" ? 0.7 : tier === "medium" ? 0.5 : 0.5;
    const targetW = Math.max(128, Math.floor(lastCanvasW * lastPixelRatio * scale));
    const targetH = Math.max(128, Math.floor(lastCanvasH * lastPixelRatio * scale));
    if (targetW === currentRTWidth && targetH === currentRTHeight) return;
    const rt = reflectorLike.getRenderTarget();
    rt.setSize(targetW, targetH);
    currentRTWidth = targetW;
    currentRTHeight = targetH;
  }

  return {
    scene,
    update(u: CityWaterUpdate) {
      waveTime = waveScrollFor(u.dtMs, waveTime);

      const tint = skyTintForDay(u.dayFraction);
      const tintVec = new THREE.Vector3(tint[0], tint[1], tint[2]);
      // Horizon sits warmer/oranger than zenith through dusk; simple biased
      // mix pins that without a separate palette.
      const horizonVec = new THREE.Vector3(
        Math.min(1, tint[0] * 1.15 + 0.05),
        Math.min(1, tint[1] * 0.9  + 0.02),
        Math.min(1, tint[2] * 0.75),
      );
      const zenithVec = new THREE.Vector3(
        tint[0] * 0.4,
        tint[1] * 0.55 + 0.05,
        Math.min(1, tint[2] * 1.1 + 0.05),
      );

      // Water material uniforms
      const reflectorMat = reflector.material;
      const rUniforms = reflectorMat.uniforms;
      rUniforms.uTime.value = waveTime;
      rUniforms.uNight.value = u.night;
      (rUniforms.uSkyTint.value as THREE.Vector3).copy(tintVec);

      // Static fallback uniforms
      staticMat.uniforms.uTime.value = waveTime;
      staticMat.uniforms.uNight.value = u.night;
      (staticMat.uniforms.uSkyTint.value as THREE.Vector3).copy(tintVec);

      // Sky dome
      (skyMat.uniforms.uSkyTint.value as THREE.Vector3).copy(tintVec);
      (skyMat.uniforms.uHorizon.value as THREE.Vector3).copy(horizonVec);
      (skyMat.uniforms.uZenith.value as THREE.Vector3).copy(zenithVec);
      skyMat.uniforms.uNight.value = u.night;

      // Tier flip: which mesh is visible, and (once) rebuild the RT.
      if (u.tier !== lastTier) {
        const isReflect = u.tier === "high" || u.tier === "medium";
        const isStatic  = u.tier === "low";
        reflector.visible = isReflect;
        staticMesh.visible = isStatic;
        lastTier = u.tier;
        if (isReflect) resizeRT(u.tier);
      }

      // Legacy proxy update — only meaningful when the mirror is running
      // on the fallback (no skylineScene passed). When the R6 real-skyline
      // path is active, `proxies` is empty and this block short-circuits
      // at the first `if (!slot)` check; we skip the sort entirely too.
      // Update reflectable proxies from live plot data. We pick the
      // WATER_PROXY_COUNT plots with the highest proxyHeightFor score;
      // ties broken by seed so the same plots always map to the same
      // boxes (frame-to-frame stability).
      sortBuf.length = 0;
      if (proxies.length > 0) {
        for (const p of u.plots) {
          if (p.role === "empty") continue;
          sortBuf.push({ p, score: proxyHeightFor(p.role, p.sealed, p.seed) });
        }
        sortBuf.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.p.seed | 0) - (b.p.seed | 0);
        });
      }

      // Warm dusk emissive so the tallest towers "glow" in the reflection
      // — a placeholder for the real lit-window emissives C-tier brings.
      // Peaks at dusk (f≈0.5), off at noon. Same ember curve the composer
      // reads for bloom — the reflection catches fire exactly when the
      // sky does.
      const f = ((u.dayFraction % 1) + 1) % 1;
      const dNoon = Math.min(Math.abs(f - 0.25), Math.abs(f - 0.25 - 1), Math.abs(f - 0.25 + 1));
      const ember = Math.min(1, dNoon * 2);
      const emissiveWarmth = ember * ember * (3 - 2 * ember);

      for (let i = 0; i < proxies.length; i += 1) {
        const mesh = proxies[i];
        const slot = sortBuf[i];
        if (!slot) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        // Scale into world height. proxyHeightFor tops out around 2.5 for
        // sealed events; * PROXY_HEIGHT_SCALE puts them ~30 units tall.
        const h = Math.max(1.5, slot.score * PROXY_HEIGHT_SCALE);
        const worldX = (slot.p.x - 0.5) * PROXY_SPREAD_X;
        // Plots further "up" the field (higher y) sit further back behind
        // the water plane — a cheap depth cue in the reflection.
        const worldZ = PROXY_FAR_Z - slot.p.y * (PROXY_FAR_Z - PROXY_NEAR_Z);
        const w = slot.p.role === "event" ? PROXY_WIDTH_EVENT : PROXY_WIDTH;
        const d = slot.p.role === "event" ? PROXY_DEPTH_EVENT : PROXY_DEPTH;
        mesh.scale.set(w, h, d);
        mesh.position.set(worldX, h * 0.5, worldZ);

        const roleColor: Record<CityWaterRole, [number, number, number]> = {
          empty: [0, 0, 0],
          home:  [0.72, 0.60, 0.48],
          store: [0.66, 0.44, 0.28],
          event: [0.90, 0.80, 0.62],
          tree:  [0.34, 0.55, 0.42],
        };
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const c = roleColor[slot.p.role];
        mat.color.setRGB(c[0], c[1], c[2]);
        if (slot.p.sealed) {
          const e = emissiveWarmth * (slot.p.role === "event" ? 0.9 : 0.55);
          mat.emissive.setRGB(e * 1.0, e * 0.55, e * 0.25);
        } else {
          mat.emissive.setRGB(0, 0, 0);
        }
        mat.metalness = slot.p.role === "event" ? 0.42 : 0.12;
        mat.roughness = slot.p.role === "event" ? 0.28 : 0.6;
      }
    },
    setSize(width: number, height: number, pixelRatio: number) {
      lastCanvasW = Math.max(1, Math.floor(width));
      lastCanvasH = Math.max(1, Math.floor(height));
      lastPixelRatio = Math.max(0.25, pixelRatio);
      // City.tsx sets the renderer's pixel ratio just before calling this,
      // and calls composer.setSize on the same ResizeObserver callback, so
      // all three ride one shape.
      resizeRT(lastTier);
    },
    dispose() {
      try { reflector.dispose(); } catch { /* noop */ }
      try { waterGeo.dispose(); } catch { /* noop */ }
      try { staticGeo.dispose(); } catch { /* noop */ }
      try { staticMat.dispose(); } catch { /* noop */ }
      try { skyGeo.dispose(); } catch { /* noop */ }
      try { skyMat.dispose(); } catch { /* noop */ }
      try { proxyGeo.dispose(); } catch { /* noop */ }
      for (const m of proxies) {
        const mat = m.material as THREE.Material;
        try { mat.dispose(); } catch { /* noop */ }
      }
      // normalTex is module-cached across mounts — deliberately not
      // disposed. If a future mount lands, it reuses the same GPU upload.
    },
  };
}
