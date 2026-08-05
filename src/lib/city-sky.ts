/**
 * city-sky — a procedural Preetham HDR sky for /city.
 *
 * The 2D ground shader used to paint a hand-tuned gradient sky. That worked
 * for the low-frequency painterly feel but has no HDR headroom (values are
 * clamped to LDR before tonemap), no environment map for future PBR glass
 * to reflect, and no principled Rayleigh + Mie scattering — the ember at
 * dusk was hand-tuned per season, not derived from the atmosphere itself.
 *
 * This module owns:
 *   - a procedural sky mesh using the three.js Preetham Sky shader
 *     (Wallner / Upitis / zz85 lineage), which is Preetham "A Practical
 *     Analytic Model for Daylight" with a HG Mie phase. Turbidity, rayleigh,
 *     and mieCoefficient are set from dayFraction so the sky reads clear at
 *     noon, warm at dusk, deep at midnight.
 *   - a WebGLCubeRenderTarget baked from the sky mesh (HalfFloatType so real
 *     HDR values above 1.0 land in the environment map — the sun disk in
 *     Preetham's model is a ~19000-radiance peak that ACESFilmic tonemaps
 *     back into the visible range).
 *   - a PMREMGenerator that prefilters the cube into an IBL environment map,
 *     ready for `scene.environment` so a MeshStandardMaterial or a
 *     MeshPhysicalMaterial (arriving in later PRs for glass towers) has real
 *     reflections and diffuse fill from the sky itself.
 *   - a 64-slot-per-day quantiser so the expensive cube re-render + PMREM
 *     prefilter only run when the sun has moved a perceptible amount, not
 *     every frame — one cube render per ~1.5 minutes of city-time.
 *   - a pure-JS analytical evaluator that samples the same Preetham model
 *     on the CPU for the fog colour (the fog needs one linear RGB per frame,
 *     not a GPU readback), so the exponential fog dissolves the far ground
 *     into the same colour the sky is painting at the horizon.
 *
 * All state lives on the returned CitySky object — no module-level caches.
 * A remount reallocates cleanly; a `dispose()` frees the cube RT, the PMREM,
 * and the sky mesh.
 */

import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/**
 * The atmospheric parameters that the Preetham shader reads. Exposed so
 * that a test can pin the dawn/noon/dusk/midnight cardinal states, and so
 * the CPU-side evaluator uses exactly the same numbers as the GPU shader.
 */
export type SkyState = {
  /** Unit vector pointing from the origin toward the sun (y is up). */
  sunDir: THREE.Vector3;
  /** Sun altitude in radians. Negative when the sun is below the horizon. */
  sunAltitude: number;
  /** Atmospheric turbidity — higher means hazier, warmer horizon. */
  turbidity: number;
  /** Rayleigh scattering strength — higher deepens the blue at noon. */
  rayleigh: number;
  /** Mie scattering coefficient — controls the disc halo and haze. */
  mieCoefficient: number;
  /** Henyey-Greenstein phase g — 0.8 gives a soft directional halo. */
  mieDirectionalG: number;
  /** Sun world-space position at Preetham's "far" — sky mesh consumes this. */
  sunPosition: THREE.Vector3;
};

const SKY_RADIUS = 4.5e5;
const CITY_SUN_AZIMUTH_RAD = Math.PI * 0.375;

/**
 * dayFraction → sky state. Pure. dayFraction runs 0..1 with 0=dawn,
 * 0.25=noon, 0.5=dusk, 0.75=midnight. Same mapping city-sun.ts uses.
 *
 * The turbidity / rayleigh / mie curves are the tuning that makes noon
 * read as a clear blue with a warm disc, dusk read as a soft orange
 * horizon fading to indigo overhead, and midnight read as a deep indigo
 * with the sun below the atmosphere.
 */
export function dayFractionToSkyState(dayFraction: number): SkyState {
  const f = ((dayFraction % 1) + 1) % 1;
  const altitude = Math.sin(f * Math.PI * 2) * (Math.PI * 0.5);
  const horizonR = Math.cos(altitude);
  const sunDir = new THREE.Vector3(
    Math.sin(CITY_SUN_AZIMUTH_RAD) * horizonR,
    Math.sin(altitude),
    -Math.cos(CITY_SUN_AZIMUTH_RAD) * horizonR,
  ).normalize();

  // Turbidity ramps up at dusk/dawn so the horizon gets its warm glow.
  const horizonProx = 1 - Math.min(1, Math.abs(altitude) / (Math.PI * 0.5));
  const turbidity = 2.0 + 6.0 * horizonProx;
  // Rayleigh is high at noon (deep blue), lower at horizon (warmer band).
  const dayness = Math.max(0, Math.sin(altitude));
  const rayleigh = 1.2 + 1.6 * dayness;
  // Mie: a soft halo at all times of day, wider at dusk.
  const mieCoefficient = 0.005 + 0.012 * horizonProx;
  const mieDirectionalG = 0.8;

  const sunPosition = sunDir.clone().multiplyScalar(SKY_RADIUS);

  return {
    sunDir,
    sunAltitude: altitude,
    turbidity,
    rayleigh,
    mieCoefficient,
    mieDirectionalG,
    sunPosition,
  };
}

// ── Preetham analytical evaluator (CPU) ──────────────────────────────────
// A faithful transcript of the fragment-shader math from three's Sky.js
// (Preetham "A Practical Analytic Model for Daylight" + HG Mie phase).
// The sky at direction `viewDir` is composed of an in-scattering integral
// weighted by the Rayleigh and Mie phase functions, plus an extinction
// factor, plus a solar disc term. Kept in linear RGB so callers can
// tonemap or read as-is for fog.

const RAYLEIGH_ZENITH = 8.4e3;
const MIE_ZENITH = 1.25e3;
const TOTAL_RAYLEIGH = new THREE.Vector3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
const MIE_CONST = new THREE.Vector3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
const CUTOFF_ANGLE = 1.6110731556870734;
const STEEPNESS = 1.5;
const EE = 1000.0;
const UP = new THREE.Vector3(0, 1, 0);

function sunIntensityPreetham(zenithAngleCos: number): number {
  const z = Math.min(1, Math.max(-1, zenithAngleCos));
  return EE * Math.max(0, 1 - Math.pow(Math.E, -((CUTOFF_ANGLE - Math.acos(z)) / STEEPNESS)));
}

function rayleighPhase(cosTheta: number): number {
  return 0.05968310365946075 * (1 + cosTheta * cosTheta);
}

function hgPhase(cosTheta: number, g: number): number {
  const g2 = g * g;
  const inv = 1 / Math.pow(1 - 2 * g * cosTheta + g2, 1.5);
  return 0.07957747154594767 * ((1 - g2) * inv);
}

/**
 * Analytical Preetham sky colour for a view direction. Returns linear-space
 * RGB in [0..∞); the caller decides what to do with values above 1.0
 * (tonemap them, average them for fog, etc). Direction must be unit.
 *
 * The formula is Preetham's, matched to the shader in three's Sky.js so the
 * CPU-sampled fog colour agrees with what the sky mesh is painting at the
 * corresponding view direction.
 */
export function sampleSkyColor(state: SkyState, viewDir: THREE.Vector3): THREE.Vector3 {
  const sunfade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(state.sunPosition.y / 450000.0)));
  const rayleighCoefficient = state.rayleigh - (1 * (1 - sunfade));
  const betaR = TOTAL_RAYLEIGH.clone().multiplyScalar(rayleighCoefficient);
  const mieC = 0.2 * state.turbidity * 10e-18;
  const betaM = MIE_CONST.clone().multiplyScalar(0.434 * mieC * state.mieCoefficient);

  const zenithAngle = Math.acos(Math.max(0, UP.dot(viewDir)));
  const inv = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = RAYLEIGH_ZENITH * inv;
  const sM = MIE_ZENITH * inv;

  const Fex = new THREE.Vector3(
    Math.exp(-(betaR.x * sR + betaM.x * sM)),
    Math.exp(-(betaR.y * sR + betaM.y * sM)),
    Math.exp(-(betaR.z * sR + betaM.z * sM)),
  );

  const cosTheta = viewDir.dot(state.sunDir);
  const rPhase = rayleighPhase(cosTheta * 0.5 + 0.5);
  const mPhase = hgPhase(cosTheta, state.mieDirectionalG);

  const sunE = sunIntensityPreetham(state.sunDir.dot(UP));

  // Lin = pow(sunE * ((betaR*rPhase + betaM*mPhase) / (betaR + betaM)) * (1 - Fex), 1.5)
  const combined = new THREE.Vector3(
    (betaR.x * rPhase + betaM.x * mPhase) / (betaR.x + betaM.x),
    (betaR.y * rPhase + betaM.y * mPhase) / (betaR.y + betaM.y),
    (betaR.z * rPhase + betaM.z * mPhase) / (betaR.z + betaM.z),
  );
  const oneMinusFex = new THREE.Vector3(1 - Fex.x, 1 - Fex.y, 1 - Fex.z);
  const Lin = new THREE.Vector3(
    Math.pow(sunE * combined.x * oneMinusFex.x, 1.5),
    Math.pow(sunE * combined.y * oneMinusFex.y, 1.5),
    Math.pow(sunE * combined.z * oneMinusFex.z, 1.5),
  );
  const mixT = Math.min(1, Math.max(0, Math.pow(1 - state.sunDir.dot(UP), 5)));
  const alt = new THREE.Vector3(
    Math.pow(Math.max(0, sunE * combined.x * Fex.x), 0.5),
    Math.pow(Math.max(0, sunE * combined.y * Fex.y), 0.5),
    Math.pow(Math.max(0, sunE * combined.z * Fex.z), 0.5),
  );
  Lin.set(
    Lin.x * (1 - mixT) + alt.x * mixT,
    Lin.y * (1 - mixT) + alt.y * mixT,
    Lin.z * (1 - mixT) + alt.z * mixT,
  );

  const L0 = new THREE.Vector3(0.1 * Fex.x, 0.1 * Fex.y, 0.1 * Fex.z);
  const tex = new THREE.Vector3(
    (Lin.x + L0.x) * 0.04,
    (Lin.y + L0.y) * 0.04 + 0.0003,
    (Lin.z + L0.z) * 0.04 + 0.00075,
  );

  const gamma = 1 / (1.2 + 1.2 * sunfade);
  return new THREE.Vector3(
    Math.pow(Math.max(0, tex.x), gamma),
    Math.pow(Math.max(0, tex.y), gamma),
    Math.pow(Math.max(0, tex.z), gamma),
  );
}

/**
 * Sample the sky in a horizontal band around the observer and average
 * the result — the fog's colour. Callers pass this directly to
 * `scene.fog.color` so distance dissolves into whatever the sky is
 * currently painting at eye level.
 */
export function fogColorFromSky(state: SkyState, samples = 6): THREE.Color {
  const out = new THREE.Vector3();
  const eps = 0.02; // just above the horizon so we sample the ember band
  for (let i = 0; i < samples; i += 1) {
    const a = (i / samples) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(a), eps, -Math.cos(a)).normalize();
    out.add(sampleSkyColor(state, dir));
  }
  out.multiplyScalar(1 / samples);
  // A small floor keeps the fog from going to pure black at midnight —
  // a moonlit haze reads as a barely-there cool grey, not a void.
  return new THREE.Color(Math.max(0.02, out.x), Math.max(0.025, out.y), Math.max(0.03, out.z));
}

// ── the sky object ──────────────────────────────────────────────────────

export type CitySkyOptions = {
  renderer: THREE.WebGLRenderer;
  /**
   * Resolution of each face of the cube render target. 256 is enough for
   * an environment map — PMREM's Gaussian blur pyramid samples it down
   * anyway. 512 helps only if raw reflections of the sun disc are needed.
   */
  resolution?: number;
  /**
   * How many discrete states per day the sky can occupy. The default 64
   * corresponds to a re-bake every ~22 minutes of city-time at the
   * default day length. Higher is smoother; lower is cheaper.
   */
  slotsPerDay?: number;
};

export type CitySky = {
  /**
   * Create a visible Sky mesh the caller can add to a rendered scene.
   * The mesh's material shares uniform values with the internal bake
   * material, so `update()` keeps both in phase without any callback
   * plumbing. The returned mesh's `scale` is pre-set to SKY_RADIUS so
   * it swallows the far clip plane at typical camera distances.
   */
  makeVisibleSky(): Sky;
  /** The prefiltered IBL environment map — assign to `scene.environment`. */
  environment: THREE.Texture;
  /** The unfiltered HDR cube — assign to `scene.background` for a
   * physically-accurate skybox behind the world. */
  background: THREE.CubeTexture;
  /** The Preetham state most recently uploaded. Read-only for callers. */
  currentState: SkyState;
  /**
   * Update the sky to a given dayFraction. Quantised to
   * `slotsPerDay` — most calls are cheap early-outs. Returns the sky
   * state (useful for setting fog colour on the same frame the sky was
   * baked).
   */
  update(dayFraction: number): SkyState;
  /**
   * Same as calling `update` but forces a re-bake regardless of the slot
   * quantiser. Used on resize / tier change so the environment reflects
   * the actual current pixels, not the cache.
   */
  forceUpdate(dayFraction: number): SkyState;
  dispose(): void;
};

/**
 * Build the city's sky. The returned object owns the sky mesh, a cube RT
 * baked from that mesh, and a PMREM-prefiltered environment map. Call
 * `update(dayFraction)` from the render tick — the slot quantiser makes
 * this cheap on frames where the sun has not measurably moved.
 */
export function createCitySky(opts: CitySkyOptions): CitySky {
  const { renderer } = opts;
  const resolution = opts.resolution ?? 256;
  const slotsPerDay = Math.max(4, opts.slotsPerDay ?? 64);

  // Preetham sky mesh — a big inside-out box the shader paints. The mesh
  // itself is not added to any user scene; we render it into a cube RT
  // from a temporary helper scene and hand out the resulting texture.
  // Any visible sky mesh created via `makeVisibleSky()` shares this same
  // ShaderMaterial by reference, so a single uniform update paints both.
  const sky = new Sky();
  sky.scale.setScalar(SKY_RADIUS);

  // Bake scene: contains only the sky mesh, cleared each render so the
  // cube camera sees only the atmosphere.
  const bakeScene = new THREE.Scene();
  bakeScene.add(sky);

  const visibleMeshes: Sky[] = [];

  const cubeRT = new THREE.WebGLCubeRenderTarget(resolution, {
    type: THREE.HalfFloatType,
    // We want linear HDR values in the cube so PMREM produces a real IBL.
    // The Preetham shader writes linear values already.
    colorSpace: THREE.LinearSRGBColorSpace,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  cubeRT.texture.name = "citySky.cube";

  const cubeCamera = new THREE.CubeCamera(1, SKY_RADIUS * 4, cubeRT);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();

  // Slot cache. -1 means "not baked yet" — the first update() call always
  // renders. We store the last dayFraction quantum so a resize can force
  // a re-bake by resetting this to -1.
  const cache: { slot: number; env: THREE.Texture | null } = { slot: -1, env: null };

  let currentState: SkyState = dayFractionToSkyState(0.25);
  applyStateToMaterial(sky, currentState);

  function rebake(dayFraction: number): SkyState {
    const state = dayFractionToSkyState(dayFraction);
    currentState = state;
    applyStateToMaterial(sky, state);

    // Cube-render the sky mesh. Saving/restoring the renderer's state so
    // the room's normal render loop isn't disturbed.
    const prevRT = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevXrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    cubeCamera.update(renderer, bakeScene);

    // Prefilter into the environment IBL. Dispose the previous env so the
    // GPU doesn't accumulate render targets across a whole day.
    const prevEnv = cache.env;
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    cache.env = envRT.texture;
    if (prevEnv) {
      try { prevEnv.dispose(); } catch { /* noop */ }
    }
    // Restore renderer.
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXrEnabled;
    return state;
  }

  // Initial bake so `environment` is never null on first frame.
  rebake(0.25);

  return {
    makeVisibleSky() {
      // Share the shader material so a single applyStateToMaterial call
      // updates every visible sky at once. A fresh BoxGeometry keeps each
      // mesh independently transform-scalable, though we pre-scale here
      // to SKY_RADIUS so the mesh is beyond the working camera far by
      // default (the caller can rescale if needed).
      const visible = new Sky();
      // Swap the visible mesh's freshly-cloned uniforms for our shared ones.
      (visible.material as THREE.ShaderMaterial).uniforms =
        (sky.material as THREE.ShaderMaterial).uniforms;
      visible.scale.setScalar(SKY_RADIUS);
      visibleMeshes.push(visible);
      return visible;
    },
    get environment(): THREE.Texture {
      // The env pointer is written by rebake; between rebakes it is
      // stable. Guarded against the (never-happens-in-practice) case
      // where a caller reads before the first bake.
      const env = cache.env;
      if (!env) throw new Error("citySky: environment read before first bake");
      return env;
    },
    background: cubeRT.texture,
    get currentState(): SkyState { return currentState; },
    update(dayFraction: number): SkyState {
      const f = ((dayFraction % 1) + 1) % 1;
      const slot = Math.floor(f * slotsPerDay);
      if (slot === cache.slot) return currentState;
      cache.slot = slot;
      return rebake(dayFraction);
    },
    forceUpdate(dayFraction: number): SkyState {
      const f = ((dayFraction % 1) + 1) % 1;
      cache.slot = Math.floor(f * slotsPerDay);
      return rebake(dayFraction);
    },
    dispose() {
      try { pmrem.dispose(); } catch { /* noop */ }
      try { cubeRT.dispose(); } catch { /* noop */ }
      const env = cache.env;
      if (env) {
        try { env.dispose(); } catch { /* noop */ }
      }
      for (const m of [sky, ...visibleMeshes]) {
        const geo = (m as unknown as { geometry?: { dispose?: () => void } }).geometry;
        if (geo && typeof geo.dispose === "function") {
          try { geo.dispose(); } catch { /* noop */ }
        }
      }
      // Shared material — dispose once via the bake mesh.
      const mat = (sky as unknown as { material?: { dispose?: () => void } }).material;
      if (mat && typeof mat.dispose === "function") {
        try { mat.dispose(); } catch { /* noop */ }
      }
    },
  };
}

function applyStateToMaterial(sky: Sky, state: SkyState): void {
  const u = (sky.material as THREE.ShaderMaterial).uniforms as Record<string, { value: unknown }>;
  u.turbidity.value = state.turbidity;
  u.rayleigh.value = state.rayleigh;
  u.mieCoefficient.value = state.mieCoefficient;
  u.mieDirectionalG.value = state.mieDirectionalG;
  (u.sunPosition.value as THREE.Vector3).copy(state.sunPosition);
}
