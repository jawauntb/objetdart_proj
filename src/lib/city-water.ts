/**
 * city-water — a harbour along one edge of /city, and the mirror on it.
 *
 * The brief calls the dusk-and-lit-windows moment the emotional peak of the
 * room; the harbour is what doubles it, because the sky burning behind the
 * tallest sealed plot burns twice — once in the tower's glass, once in the
 * water. This module owns the water world: a small perspective scene with
 * a THREE.Reflector plane on the +z edge, a set of building proxies behind
 * the plane (only visible to the reflector's virtual camera, via layer 1),
 * a hemisphere sky whose tint tracks dayFraction, and a scrolled wave
 * normal that ripples the reflection at ~0.02 uv/s.
 *
 * How it composes into /city:
 *   City.tsx builds this water = createCityWater(...) and hands its scene
 *   and camera to createCityComposer as a third RenderPass, drawn AFTER
 *   the plots and BEFORE bloom. RenderPass runs with clear:false, so the
 *   part of the frame above the water strip keeps the ground+plot output
 *   unchanged, and only the visible strip carries the reflection.
 *
 * Tier gating (the door B/C/D depend on):
 *   high, medium  → Reflector runs; its RT is half the canvas width on
 *                   medium, full on high. The wave normal scrolls; the
 *                   proxies mirror the tallest sealed plots as tiny
 *                   towers on the horizon — a placeholder skyline the
 *                   real C-tier buildings will replace in a later PR.
 *   low           → Reflector is hidden; a cheaper static mirror mesh
 *                   takes its place, painting the sky gradient with a
 *                   wave normal-map highlight but no live reflection.
 *   sleep         → the whole water pass is skipped by the composer.
 *
 * Nothing here touches gesture, city.ts laws, or persistence. The pure
 * bits — `waveScrollFor(dt, prev)`, `skyTintForDay(dayFraction)` — are
 * exported for test-city-water.mjs to pin without a WebGL context.
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
  // Per-seed jitter so 16 boxes read as 16 individuals, not 16 clones.
  // Same mulberry-shape hash city.ts uses; a bit of the seed's low bits
  // shifted so a plot's height is a function of ITS OWN state vector.
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
    // near edge. Add a subtle darkening near the horizon so the water
    // recedes rather than sitting flat, and a mild specular flash where
    // the wave normal points up
    float horizon = smoothstep(0.0, 0.35, vLocalUv.y);
    surface *= mix(0.72, 1.0, horizon);

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

    // sky tint modulated by wave normal — flat mirror hack, no RT
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
// A 64×64 RGB DataTexture whose (r,g) encode a summed-sinusoids surface
// normal. Kept small — it's tiled repeatedly under the scroll — and
// computed once per module load. Same-seed determinism is required so
// SSR and the runtime paint the same waves.
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
      // build a normal: (-dh/du, -dh/dv, 1) then normalize
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
  /** the camera looking out over the harbour */
  camera: THREE.PerspectiveCamera;
  /** feed once per frame before composer.render() */
  update(u: CityWaterUpdate): void;
  /** call from City.tsx's ResizeObserver, alongside renderer.setSize */
  setSize(width: number, height: number): void;
  /** dispose GL resources; call before renderer.dispose() */
  dispose(): void;
};

export type CityWaterOptions = {
  /** initial canvas size in CSS pixels */
  width: number;
  height: number;
  /** initial pixel ratio — matches renderer.getPixelRatio() at mount */
  pixelRatio: number;
};

/**
 * Build the /city harbour. Idempotent per mount — nothing here is global,
 * so a remount produces a fresh Reflector and a fresh RT.
 */
export function createCityWater(opts: CityWaterOptions): CityWater {
  const scene = new THREE.Scene();
  // No `scene.background` — that would fill the pixels above the water
  // strip when this pass runs with clear:false, hiding the ground and
  // plots that the earlier passes wrote there.

  // Perspective view looking across the harbour. Camera sits above and
  // behind the near edge of the water plane, looking down-and-forward
  // at the far edge and the horizon behind it.
  const camera = new THREE.PerspectiveCamera(38, opts.width / Math.max(1, opts.height), 0.1, 60);
  camera.position.set(0, 1.55, 4.5);
  camera.lookAt(0, 0.15, -1.2);
  // Main camera sees only layer 0 (water + fallback). Reflector proxies +
  // sky live on layer 1 so the main pass doesn't render them.
  camera.layers.set(0);

  // Wave normal — one texture shared across the reflector and the static
  // fallback material.
  const normalTex = getWaveNormalTexture();

  // ── Reflector (high/medium tier) ─────────────────────────────────────
  // A 12 × 3.4 plane on the ground. Reflection RT is sized in setSize().
  // NOTE: leave the geometry facing +z and rotate the MESH instead —
  // Reflector.onBeforeRender computes its plane normal from
  // scope.matrixWorld (`normal = (0,0,1).applyMatrix4(rotationMatrix)`),
  // so a geometry-baked rotation would leave the reflection with the
  // wrong plane and a black RT.
  const waterGeo = new THREE.PlaneGeometry(12, 3.4, 1, 1);
  const initialRTWidth = Math.max(64, Math.floor(opts.width * opts.pixelRatio * 0.5));
  const initialRTHeight = Math.max(64, Math.floor(opts.height * opts.pixelRatio * 0.5));
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
  // z = -0.9 places the plane's far edge near z = -2.6 (matches sky dome).
  // The -π/2 rotation lays the plane flat on the ground (XZ), and the
  // reflector reads the mesh rotation to compute its world-space normal.
  reflector.position.set(0, 0, -0.9);
  reflector.rotation.x = -Math.PI / 2;
  reflector.layers.set(0);
  // Reflector's own virtual camera must see the proxies (layer 1) that
  // don't exist on the main view. Reflector inherits the main camera's
  // layers implicitly (none of that in three's code — its virtualCamera
  // was constructed clean), so we enable layer 1 here once and it holds.
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
  const staticGeo = new THREE.PlaneGeometry(12, 3.4, 1, 1);
  const staticMesh = new THREE.Mesh(staticGeo, staticMat);
  staticMesh.position.set(0, 0.001, -0.9);
  staticMesh.rotation.x = -Math.PI / 2;
  staticMesh.layers.set(0);
  staticMesh.visible = false; // reflector is default; tier flip toggles this
  scene.add(staticMesh);

  // ── sky dome (layer 1, mirror-only) ──────────────────────────────────
  // A hemisphere behind the water, only the reflector's virtualCamera
  // sees it. Radius big enough to sit far past the tallest proxy. Two
  // gradient stops: a warmer belt near the horizon, a cooler cap above.
  const skyGeo = new THREE.SphereGeometry(30, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
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
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.set(0, -0.4, -1.5);
  sky.layers.set(1);
  scene.add(sky);

  // ── building proxies (layer 1, mirror-only) ──────────────────────────
  // WATER_PROXY_COUNT boxes sitting behind the water plane. Each frame we
  // read the tallest sealed plots into them, remapping city-normalized x
  // into world X across the harbour's width. The proxies live on layer 1
  // so only the reflection sees them — the main view is unaffected.
  const proxyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.28, 0.30, 0.36),
    metalness: 0.15,
    roughness: 0.55,
    emissive: new THREE.Color(0.0, 0.0, 0.0),
  });
  const proxyGeo = new THREE.BoxGeometry(1, 1, 1);
  const proxyGroup = new THREE.Group();
  proxyGroup.layers.set(1);
  const proxies: THREE.Mesh[] = [];
  for (let i = 0; i < WATER_PROXY_COUNT; i += 1) {
    const m = new THREE.Mesh(proxyGeo, proxyMat.clone());
    m.visible = false;
    m.layers.set(1);
    // spread across x semicircle-ish behind the water
    proxyGroup.add(m);
    proxies.push(m);
  }
  scene.add(proxyGroup);

  // A soft warm directional so the proxy boxes catch a sunset side — the
  // reflection reads as buildings with a lit side rather than flat cubes.
  const sunProxy = new THREE.DirectionalLight(0xffe0b0, 1.4);
  sunProxy.position.set(-8, 6, -4);
  sunProxy.layers.set(1);
  scene.add(sunProxy);
  const ambientProxy = new THREE.AmbientLight(0x8899bb, 0.6);
  ambientProxy.layers.set(1);
  scene.add(ambientProxy);

  // ── state ────────────────────────────────────────────────────────────
  let waveTime = 0;
  let lastTier: QualityTier | null = null;
  // Pre-allocate a sortable buffer so update() allocates zero per frame.
  const sortBuf: Array<{ p: CityWaterProxy; score: number }> = [];

  // ── size + rt sizing ─────────────────────────────────────────────────
  // Reflector's RT is created in its constructor and there is no public
  // resize() method — reach through and rebuild the RT if the canvas
  // grew past what we allocated. We keep the RT at half-res of the
  // canvas on medium tier (via the multiplier below) — the reflection
  // is soft anyway, and this halves the pixel work.
  const reflectorLike = reflector as unknown as {
    getRenderTarget(): THREE.WebGLRenderTarget;
  };
  let currentRTWidth = initialRTWidth;
  let currentRTHeight = initialRTHeight;

  function resizeRT(w: number, h: number, tier: QualityTier | null): void {
    // High tier keeps parity with canvas resolution; medium tier drops to
    // half; low never uses the RT. Sleep is skipped by the composer.
    const scale = tier === "high" ? 0.7 : tier === "medium" ? 0.5 : 0.5;
    const targetW = Math.max(64, Math.floor(w * scale));
    const targetH = Math.max(64, Math.floor(h * scale));
    if (targetW === currentRTWidth && targetH === currentRTHeight) return;
    const rt = reflectorLike.getRenderTarget();
    rt.setSize(targetW, targetH);
    currentRTWidth = targetW;
    currentRTHeight = targetH;
  }

  return {
    scene,
    camera,
    update(u: CityWaterUpdate) {
      waveTime = waveScrollFor(u.dtMs, waveTime);

      const tint = skyTintForDay(u.dayFraction);
      const tintVec = new THREE.Vector3(tint[0], tint[1], tint[2]);
      // Horizon should sit warmer/oranger than zenith through dusk; a
      // simple biased mix pins that without a separate palette.
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

      // Tier flip: which mesh is visible, and (once) rebuild the RT to
      // suit. Sleep tier hides both meshes; the composer also skips this
      // pass entirely, so this is a defence in depth.
      if (u.tier !== lastTier) {
        const isReflect = u.tier === "high" || u.tier === "medium";
        const isStatic  = u.tier === "low";
        reflector.visible = isReflect;
        staticMesh.visible = isStatic;
        lastTier = u.tier;
        if (isReflect) resizeRT(currentRTWidth * 2, currentRTHeight * 2, u.tier);
      }

      // Update reflectable proxies from live plot data. We pick the
      // WATER_PROXY_COUNT plots with the highest proxyHeightFor score;
      // ties are broken by seed so the same set of plots always maps to
      // the same boxes (frame-to-frame stability).
      sortBuf.length = 0;
      for (const p of u.plots) {
        if (p.role === "empty") continue;
        sortBuf.push({ p, score: proxyHeightFor(p.role, p.sealed, p.seed) });
      }
      sortBuf.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.p.seed | 0) - (b.p.seed | 0);
      });

      // Warm dusk emissive so the tallest towers "glow" in the reflection
      // — a placeholder for the real lit-window emissives C-tier brings.
      // Peaks at dusk (f≈0.5), off at noon.
      const f = ((u.dayFraction % 1) + 1) % 1;
      const dNoon = Math.min(Math.abs(f - 0.25), Math.abs(f - 0.25 - 1), Math.abs(f - 0.25 + 1));
      const ember = Math.min(1, dNoon * 2);
      const emissiveWarmth = ember * ember * (3 - 2 * ember);

      for (let i = 0; i < WATER_PROXY_COUNT; i += 1) {
        const mesh = proxies[i];
        const slot = sortBuf[i];
        if (!slot) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        const h = Math.max(0.15, slot.score);
        // Remap normalized x from [0..1] to world [-5.4 .. 5.4]. Spread
        // in z lightly on the plot's y (so plots higher up the field sit
        // further back in the reflection — depth cue for free).
        const worldX = (slot.p.x - 0.5) * 10.8;
        const worldZ = -3.2 - slot.p.y * 1.6;
        // Building width scales with role; events wider.
        const w = slot.p.role === "event" ? 0.55 : slot.p.role === "store" ? 0.42 : 0.3;
        const d = slot.p.role === "event" ? 0.55 : 0.32;
        mesh.scale.set(w, h, d);
        mesh.position.set(worldX, h * 0.5, worldZ);

        // Per-role tint. Bake into the material (each proxy owns its own).
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
        // Sealed plots glow warm; unsealed sit dark. The ember curve
        // amplifies the emission at dusk so the reflection catches fire
        // exactly when the sky does.
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
    setSize(width: number, height: number) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      // The reflector's RT is sized in raw device pixels (canvas × dpr),
      // but City.tsx calls this in CSS pixels — we use CSS pixels here
      // and let resizeRT apply its tier multiplier. The reflection is
      // filtered/blurred anyway; the exact RT resolution is not visible.
      resizeRT(width, height, lastTier);
    },
    dispose() {
      // Reflector owns its RT and material.
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
