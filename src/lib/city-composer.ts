/**
 * city-composer — the render pipeline for /city.
 *
 * The tick loop used to end in a bare `renderer.clear() + renderer.render()`
 * pair. That works for two ortho quads but has no place for the passes the
 * dusk-and-lit-windows moment needs: no bloom, no output pass in a linear
 * working space, nowhere to hang SSAO / DOF / god-rays in a later PR.
 *
 * This module owns an EffectComposer with:
 *   RenderPass(worldScene)                 → the Preetham HDR sky + IBL ground
 *   RenderPass(groundScene, clear:false)   → 2D painterly ground shader
 *   RenderPass(plotScene,   clear:false)   → 48 instanced plots as emblems
 *   RenderPass(skylineScene, clear:false)  → the 3D extruded skyline
 *   SSAOPass(skylineScene)                 → contact AO between towers
 *   UnrealBloomPass                        → the ember at dusk, lit windows at night
 *   BokehPass(skylineScene)                → wide-zoom Currier & Ives DOF
 *   OutputPass                             → sRGB write + tonemap
 *
 * Bloom threshold / strength / radius are a function of dayFraction so the
 * ember RISES as the sun sets. At noon the bloom is a whisper; at dusk it is
 * the emotional peak the brief calls the core of the room; at midnight it
 * stays warm on the lit-window pixels.
 *
 * SSAO reads the skyline scene's geometry — the shadowed alley between a home
 * and a store, the shadow band where a tower's footprint meets the ground.
 * That contact-AO ring is what the eye uses to read a photo as photo and a
 * diorama as diorama; without it a settlement of PBR prisms feels floating.
 *
 * BokehPass runs before OutputPass so the tonemapper still gets the blurred
 * linear buffer, not a re-quantised sRGB one. DOF strength ramps in over the
 * eased pitch: at eye-level the frame is razor-sharp (photoreal SF/London
 * read), at bird's-eye the frame gathers a painterly depth blur (Currier &
 * Ives model-scale read). A smoothstep between pitch01 = 0.55 and 0.85 rides
 * the spring — never a hard flip on the boundary.
 *
 * Tiers gate cost, not aesthetic goal:
 *   sleep  → no bloom, no ssao, no dof (composer still runs so the pipeline stays linear)
 *   low    → no bloom, no ssao, no dof
 *   medium → bloom on, ssao on, no dof
 *   high   → bloom on, ssao on, dof on (ramped by pitch)
 *
 * Nothing here touches gesture, city.ts laws, or persistence — it is the
 * pipeline the aesthetic hangs from.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import {
  createCityPainterlyPass,
  painterlyStrengthForPitch,
  type CityPainterlyPass,
} from "@/lib/city-painterly";
import type { QualityTier } from "@/lib/room-runtime";

export type CityComposer = {
  /**
   * Draw one frame.
   *
   *   `dayFraction` — city.ts's dayFraction (0=dawn, 0.25=noon, 0.5=dusk,
   *   0.75=midnight). Drives the bloom curve.
   *   `tier`        — the current governor tier. Decides which passes are
   *   alive from it.
   *   `pitch01`     — the camera's eased pitch in [0..1] (0=eye-level,
   *   1=bird's-eye). Optional so pre-camera callers still compile; when
   *   omitted, DOF stays off. Drives the Bokeh strength ramp.
   */
  render(dayFraction: number, tier: QualityTier, pitch01?: number): void;
  /**
   * Resize the offscreen render targets to (width, height) in CSS pixels
   * and set the renderer pixel ratio. Call from the room's ResizeObserver
   * callback, alongside the renderer's own setSize.
   */
  setSize(width: number, height: number, pixelRatio: number): void;
  /**
   * Dispose composer render targets and the passes' internal buffers. Call
   * on unmount BEFORE `renderer.dispose()` — bloom holds its own targets.
   */
  dispose(): void;
};

/**
 * How bloom should behave at each time of day. Values were tuned by looking
 * at the shader outputs: the ground shader writes sunset oranges up around
 * 1.0..1.2 near dusk, and the plot atlas writes emissive window pixels at
 * ~1.0 for lit-window-tint. A threshold of 0.55 at dusk means the sunset
 * band and lit windows both bloom; a threshold of 0.9 at noon means only
 * true highlights (specular sky corners) bloom.
 *
 * Exported so a test can pin the ember curve at the four cardinal times.
 */
export function bloomParamsForDay(dayFraction: number): {
  threshold: number;
  strength: number;
  radius: number;
} {
  // Distance to noon on the wrapped 0..1 day cycle. 0 at noon, 0.5 at midnight.
  const dNoon = Math.min(
    Math.abs(dayFraction - 0.25),
    Math.abs(dayFraction - 0.25 - 1),
    Math.abs(dayFraction - 0.25 + 1),
  );
  // ember: 0 at noon → 1 at midnight, softened. Peaks broad through dusk.
  const raw = Math.min(1, dNoon * 2);
  const ember = raw * raw * (3 - 2 * raw);
  return {
    // low threshold at dusk/night = warm mids also bloom
    threshold: 0.9 - 0.35 * ember,
    // strength rises hard from noon-whisper to dusk-peak
    strength: 0.15 + 0.75 * ember,
    // radius rises so the ember spreads at dusk, tightens at midday
    radius: 0.35 + 0.45 * ember,
  };
}

/**
 * The DOF strength curve as a function of the camera's pitch01.
 * Read the range as: below `PITCH_DOF_START` the frame is razor-sharp
 * (eye-level, the photoreal SF/London skyline moment) and above
 * `PITCH_DOF_END` the frame is fully blurred (bird's-eye, the Currier &
 * Ives model-scale moment). A smoothstep in between rides the eased
 * spring — a fast pinch never snaps into DOF.
 *
 * `strength01` is the normalised strength returned by this function; the
 * caller multiplies it into the Bokeh pass's `maxblur` and `aperture`
 * uniforms so the ramp is not a light switch but a soft dial.
 *
 * Exported so a test can pin the curve at the two ends and at the middle.
 */
export const PITCH_DOF_START = 0.55;
export const PITCH_DOF_END = 0.85;

export function dofStrengthForPitch(pitch01: number): number {
  const p = pitch01 < 0 ? 0 : pitch01 > 1 ? 1 : pitch01;
  const span = PITCH_DOF_END - PITCH_DOF_START;
  if (span <= 0) return p >= PITCH_DOF_START ? 1 : 0;
  const t = (p - PITCH_DOF_START) / span;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Which post-process passes should be alive at a given tier. The one
 * function of tier the composer consults per-frame; the tick loop passes
 * the current tier and this decides. A test pins the ladder — a future
 * regression that flips SSAO on at low tier would tank frame budget on
 * exactly the devices that most need the budget back.
 *
 *   sleep  → nothing but bloom-less linear composition (pipeline stays lin.)
 *   low    → same as sleep — the composer runs but the aesthetic budget is 0
 *   medium → bloom on + ssao on (photorealistic contact AO, small radius)
 *   high   → bloom on + ssao on (wider radius) + dof on (ramped by pitch)
 */
export function passesForTier(tier: QualityTier): {
  bloom: boolean;
  ssao: boolean;
  dof: boolean;
} {
  switch (tier) {
    case "high":
      return { bloom: true, ssao: true, dof: true };
    case "medium":
      return { bloom: true, ssao: true, dof: false };
    case "low":
    case "sleep":
    default:
      return { bloom: false, ssao: false, dof: false };
  }
}

export type CityComposerOptions = {
  renderer: THREE.WebGLRenderer;
  groundScene: THREE.Scene;
  groundCam: THREE.Camera;
  plotScene: THREE.Scene;
  plotCam: THREE.Camera;
  /**
   * Optional real-perspective world scene rendered BEFORE the 2D ground
   * shader. Contains the Preetham sky (as scene.background), the directional
   * sun light, hemisphere fill, and any future 3D geometry that receives
   * IBL from scene.environment. When present, the composer runs
   * worldScene first (clearing) and the ground2D pass second, non-clearing
   * — the ground shader is expected to write alpha < 1 above the horizon
   * so the real sky shows through.
   */
  worldScene?: THREE.Scene;
  worldCam?: THREE.Camera;
  /** The 3D skyline scene (perspective camera). Rendered after the ortho
   * ground/atlas passes, before bloom, so the extruded prisms rise on
   * top of the ground shader and their highlights feed the bloom curve
   * alongside the sky's ember. Shares its camera with `worldCam` so the
   * sky, IBL-lit ground, and buildings all read the same perspective. */
  skylineScene?: THREE.Scene;
  skylineCam?: THREE.PerspectiveCamera;
  /**
   * Optional harbour water scene (created by src/lib/city-water.ts).
   * Rendered AFTER the skyline pass and BEFORE the SSAO/bloom stack, so
   * the Reflector plane sits in the frame like a strip of water beyond
   * the plot grid. Its `waterCam` MUST be the same `cityCam.camera` the
   * skyline uses — the Reflector's `virtualCamera` derives from whatever
   * camera the water pass runs with, and if the two cameras diverged the
   * mirrored horizon would slide off the water surface at any pitch
   * other than the one the water module was built for.
   */
  waterScene?: THREE.Scene;
  waterCam?: THREE.Camera;
  /** Initial CSS-pixel size; the room will resize us in ResizeObserver. */
  width: number;
  height: number;
  /** Initial pixel ratio; matches renderer.getPixelRatio() at mount. */
  pixelRatio: number;
};

/**
 * Build the /city render pipeline. Idempotent per-mount — creating two
 * composers on the same renderer is fine (they share the WebGL context)
 * but the room only needs one.
 */
export function createCityComposer(opts: CityComposerOptions): CityComposer {
  const { renderer, groundScene, groundCam, plotScene, plotCam } = opts;

  // Composer's default color buffer is HalfFloat when available so the
  // bloom pass has real HDR headroom — the ember at dusk needs values
  // above 1.0 to look like an actual light source, not a bright grey.
  // Depth buffer ON: the 3D skyline pass needs it so a closer tower
  // occludes one behind it. HalfFloat color buffer for HDR headroom.
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const composer = new EffectComposer(renderer, target);

  // Optional RenderPass 0: the perspective world scene — real sky mesh,
  // directional sun, fog, IBL-lit ground and (later) 3D buildings. Runs
  // first and clears the frame so the 2D ground shader that follows can
  // paint on top with alpha < 1 above the horizon and reveal this sky.
  if (opts.worldScene && opts.worldCam) {
    const worldPass = new RenderPass(opts.worldScene, opts.worldCam);
    worldPass.clear = true;
    composer.addPass(worldPass);
  }

  // RenderPass 1: 2D ground/atmosphere. Clears the frame only when there
  // is no world scene in front of it — otherwise it composites over the
  // world scene and its shader alpha decides where the world shows.
  const groundPass = new RenderPass(groundScene, groundCam);
  groundPass.clear = !opts.worldScene;
  composer.addPass(groundPass);

  // RenderPass 2: the plot atlas emblems (ortho). Kept in the chain so
  // the lit-window emissive PR #290 baked into the atlas shader still
  // reads at bird's-eye view (where the emblems shine as painterly
  // rooftop marks). At eye-level the 3D skyline pass draws over them,
  // and the emblems sit on the ground below the tower footprints — the
  // full facade with lit-window emissive lives on the extruded prisms
  // in a follow-up PR (city-facades.ts is already in place).
  const plotPass = new RenderPass(plotScene, plotCam);
  plotPass.clear = false;
  composer.addPass(plotPass);

  // RenderPass 3 (optional): the 3D skyline scene. Perspective camera,
  // real geometry, PCF soft shadows from the sun. Must NOT clear — it
  // overlays the ortho passes and reads the depth buffer from the box
  // instances themselves. Note the plot atlas emblems below sit at the
  // ground plane and are dominated visually by the tower on top, which
  // is intentional at bird's-eye view (the emblem is the plot's crown
  // when seen from above; the tower is its body when seen head-on).
  let skylinePass: RenderPass | null = null;
  if (opts.skylineScene && opts.skylineCam) {
    skylinePass = new RenderPass(opts.skylineScene, opts.skylineCam);
    // Preserve the ortho passes' color output beneath. Clear DEPTH so the
    // 3D geometry starts with a fresh z-buffer — EffectComposer ping-pongs
    // color between passes but the depth buffer belongs to the target and
    // may carry stale values from the previous frame, which would produce
    // ghost occlusion the first tick.
    skylinePass.clear = false;
    (skylinePass as unknown as { clearDepth: boolean }).clearDepth = true;
    composer.addPass(skylinePass);
  }

  // RenderPass 4 (optional): the harbour water scene. Runs with the SAME
  // camera as the skyline (cityCam.camera) so the Reflector's virtualCamera
  // is the mirror of the visitor's eye. Do NOT clear depth — the skyline's
  // depth buffer is what makes tall buildings occlude the water beyond
  // them; a clearDepth here would let the water plane draw over towers
  // that stand in front of it.
  let waterPass: RenderPass | null = null;
  if (opts.waterScene && opts.waterCam) {
    waterPass = new RenderPass(opts.waterScene, opts.waterCam);
    waterPass.clear = false;
    (waterPass as unknown as { clearDepth: boolean }).clearDepth = false;
    composer.addPass(waterPass);
  }

  // SSAOPass — the contact ambient occlusion between adjacent buildings.
  // Only meaningful when a skyline scene is present; the pass renders the
  // skyline through a MeshNormalMaterial into its own depth+normal target,
  // then subtracts a soft AO ring from the read buffer. Because
  // needsSwap=false the color buffer the bloom sees is the same buffer
  // the skyline pass wrote, just darker in the crevices — the emissive
  // dusk-window pixels stay bright and bloom the way they did before.
  //
  // We build the pass in the tier-inactive state and flip `enabled` in
  // render() so the tick loop doesn't pay to construct/tear-down the SSAO
  // material on a tier transition — the flip is a boolean write, that's it.
  let ssaoPass: SSAOPass | null = null;
  if (opts.skylineScene && opts.skylineCam) {
    ssaoPass = new SSAOPass(
      opts.skylineScene,
      opts.skylineCam,
      Math.max(1, opts.width),
      Math.max(1, opts.height),
    );
    // The AO radius was tuned by walking the sample space: 12 world units
    // reads the wall of one tower against its neighbor as one shadow band,
    // not a rim halo. `minDistance`/`maxDistance` are the near/far cutoffs
    // in NDC space; the defaults 0.005/0.1 crush too much on tall towers
    // so we push maxDistance out and keep minDistance small so the ground
    // contact of a footprint still reads.
    ssaoPass.kernelRadius = 12;
    ssaoPass.minDistance = 0.002;
    ssaoPass.maxDistance = 0.16;
    // OUTPUT_DEFAULT (0) — the standard AO composite. `renderToScreen`
    // stays false so the pass writes back into the composer buffer.
    (ssaoPass as unknown as { output: number }).output = 0;
    ssaoPass.enabled = false;
    composer.addPass(ssaoPass);
  }

  // Bloom: the ember at dusk, the warm halo on lit windows at night.
  // Parameters are updated per-frame from dayFraction inside render().
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(opts.width, opts.height),
    /* strength */ 0.5,
    /* radius   */ 0.6,
    /* threshold*/ 0.75,
  );
  composer.addPass(bloomPass);

  // BokehPass — the Currier & Ives model-scale DOF at wide zoom. Only
  // meaningful when a perspective skyline scene is present. The pass
  // re-renders the skyline with a depth-packing material into its own
  // depth target and blurs the color buffer by circle-of-confusion.
  //
  // We drive the pass at high tier only, and RAMP its `maxblur` and
  // `aperture` uniforms from 0 → full as the camera's pitch01 crosses
  // PITCH_DOF_START..PITCH_DOF_END. At eye-level the pass is present but
  // does nothing (maxblur=0) — that keeps the composer chain identical
  // frame-to-frame and only asks the GPU to skip when we set enabled=false.
  //
  // Focus is fixed at the world-space distance from the camera to the
  // ground plane in front of the settlement (~40 units) — the buildings
  // in the middle of the frame are what the eye is meant to fixate on,
  // and the fore/back blur ranges are what we tune with maxblur.
  let bokehPass: BokehPass | null = null;
  const bokehState: { maxblur: number; aperture: number } = {
    maxblur: 0.012,   // full-blur — a soft painterly haze, not a smear
    aperture: 0.0018, // subtle CoC — the diorama read, not the macro read
  };
  if (opts.skylineScene && opts.skylineCam) {
    bokehPass = new BokehPass(opts.skylineScene, opts.skylineCam, {
      focus: 40.0,
      aperture: 0.0,   // ramped by pitch — 0 at eye-level
      maxblur: 0.0,
    });
    bokehPass.enabled = false;
    composer.addPass(bokehPass);
  }

  // Painterly register-shift — the Currier & Ives LUT-like overlay that
  // arrives when the visitor pinches to bird's-eye. Runs between bloom
  // and OutputPass so the ember still catches (bloom writes into the
  // linear buffer this pass samples) but the sRGB tonemap OutputPass
  // performs still gets the painterly buffer, not a re-quantised sRGB
  // one. Cheap enough to keep enabled on every tier — one texture
  // fetch, ~30 ALU ops per fragment. `enabled` is toggled off only when
  // the strength curve is exactly zero (pitch01 <= 0.6) to skip the
  // GPU work when the frame is photoreal.
  const painterlyPass: CityPainterlyPass = createCityPainterlyPass();
  painterlyPass.enabled = false;
  composer.addPass(painterlyPass);

  // OutputPass writes the linear working buffer to the canvas as sRGB and
  // applies the renderer's tonemapping (ACESFilmic, set in City.tsx).
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Time origin for the paper-grain drift. Not wall-clock — we want a
  // monotonic counter that resets with the composer instance so a
  // remount doesn't cause the grain to jump. dtMs is not threaded
  // through the composer's render(), so we use performance.now() with
  // a captured epoch — the delta between successive frames is what
  // the grain reads, and the epoch subtracts out.
  const mountEpochMs =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : 0;

  // First-time sizing — the room resizes us again immediately from its
  // ResizeObserver, but we start off in a reasonable place either way.
  composer.setPixelRatio(opts.pixelRatio);
  composer.setSize(Math.max(1, opts.width), Math.max(1, opts.height));

  // Track the last tier we applied so we can skip DOM-ish `enabled` writes
  // and threshold reads on frames where nothing changed. Frame time in
  // this room is dominated by the plot shader; every microsecond back
  // is a microsecond that pays for B/C/D in the next PRs.
  let lastTier: QualityTier | null = null;
  let lastEmberSlot = -1;
  // Quantised DOF slot — writing the Bokeh uniforms every frame is a JS
  // object write per uniform, cheap but not free. Round pitch01 to
  // eighths (~7° each) so the ramp only touches the uniform when the
  // pitch has visibly advanced. A smoothstep at 8 samples across
  // [0.55..0.85] is still perceptually smooth to a human eye.
  let lastDofSlot = -1;
  // Quantised painterly slot — same trick, same eight-slot resolution.
  // The ramp lives in [0.6..0.9] and eight samples give ~4° of pitch
  // per slot, imperceptible on a human pinch.
  let lastPainterlySlot = -1;

  const composerLike = composer as unknown as {
    render(delta?: number): void;
    setPixelRatio(pr: number): void;
    setSize(w: number, h: number): void;
    passes: unknown[];
    dispose?: () => void;
  };

  return {
    render(dayFraction: number, tier: QualityTier, pitch01?: number) {
      // Tier gating. Passes are pre-constructed in the chain; we only
      // flip their `enabled` bit. The ground and plots still render
      // through the composer's linear buffer at every tier so C's PBR
      // materials land right whatever the governor decided.
      if (tier !== lastTier) {
        const alive = passesForTier(tier);
        bloomPass.enabled = alive.bloom;
        if (ssaoPass) ssaoPass.enabled = alive.ssao;
        if (bokehPass) bokehPass.enabled = alive.dof;
        // The harbour is off on sleep tier — the whole pass skips. The
        // water module still handles its own high/medium/low visible-mesh
        // swap inside update(); this gate is defence in depth.
        if (waterPass) waterPass.enabled = tier !== "sleep";
        // Painterly register-shift keeps living at every non-sleep tier
        // — the brief calls it out as cheap enough to keep at low tier
        // (one full-screen sample; the aesthetic split into two
        // registers matters more than a fraction of a millisecond).
        // Sleep tier skips it entirely because sleep drops all overlays.
        // High tier gets a marginally deeper vignette so the paper-edge
        // halo reads on the big screens that carry the extra headroom.
        painterlyPass.uniforms.uVignette.value = tier === "high" ? 1.15 : 1.0;
        lastTier = tier;
        // Force the ember + DOF + painterly to recompute after a tier flip.
        lastEmberSlot = -1;
        lastDofSlot = -1;
        lastPainterlySlot = -1;
        // When we drop below high tier the Bokeh uniforms must return to
        // zero so a later high-tier re-entry starts from a clean ramp —
        // otherwise the leftover maxblur from the last high-tier frame
        // would flash for one frame on the reentry.
        if (bokehPass && !alive.dof) {
          const u = (bokehPass as unknown as {
            uniforms: {
              maxblur: { value: number };
              aperture: { value: number };
            };
          }).uniforms;
          u.maxblur.value = 0;
          u.aperture.value = 0;
        }
      }

      if (bloomPass.enabled) {
        // Cheap change-detector: quantize dayFraction so we rewrite bloom
        // params only ~100 times per full day, not every frame. The ember
        // curve is smooth on that scale, and the compositor doesn't care.
        const slot = Math.floor(dayFraction * 128);
        if (slot !== lastEmberSlot) {
          const p = bloomParamsForDay(dayFraction);
          // High tier gets a slightly softer, wider ember.
          const radiusMul = tier === "high" ? 1.15 : 1.0;
          bloomPass.threshold = p.threshold;
          bloomPass.strength = p.strength;
          bloomPass.radius = p.radius * radiusMul;
          lastEmberSlot = slot;
        }
      }

      // Painterly register-shift lives outside the tier gate — the pass
      // is cheap enough to keep at low tier per the brief. Sleep tier
      // still disables it (defence in depth against wall-of-black frames
      // the sleep pipeline sometimes chooses to emit). We update the
      // strength ramp and the paper-grain time uniform every tick.
      if (tier !== "sleep") {
        const p = pitch01 == null ? 0 : pitch01;
        const s = painterlyStrengthForPitch(p);
        // Toggle enabled only when strength crosses zero — below 0.6
        // pitch the pass is a no-op; skipping the draw saves the
        // texture fetch AND the JS-side pass invocation.
        painterlyPass.enabled = s > 0;
        if (painterlyPass.enabled) {
          const slot = Math.floor(p * 8);
          if (slot !== lastPainterlySlot) {
            painterlyPass.uniforms.uStrength.value = s;
            lastPainterlySlot = slot;
          }
          // Time uniform advances every frame — the paper grain needs
          // its own realtime axis so the drift reads as a living
          // material, not a frozen texture. This is one number-write
          // per frame; cheap.
          const nowMs =
            typeof performance !== "undefined" &&
            typeof performance.now === "function"
              ? performance.now()
              : 0;
          painterlyPass.uniforms.uTime.value = (nowMs - mountEpochMs) / 1000;
        }
      } else {
        painterlyPass.enabled = false;
      }

      if (bokehPass && bokehPass.enabled) {
        // Ramp DOF strength on the pitch01. At eye-level the maxblur sits
        // at 0 and the pass is essentially a no-op copy; at bird's-eye it
        // hits `bokehState.maxblur`. Quantise to 8 slots across [0..1]
        // so the uniform writes only fire when the pitch has advanced
        // by ~12.5%. A smoothstep at 8 samples across [0.55..0.85]
        // reads as continuous to a human eye.
        const p = pitch01 == null ? 0 : pitch01;
        const slot = Math.floor(p * 8);
        if (slot !== lastDofSlot) {
          const s = dofStrengthForPitch(p);
          const u = (bokehPass as unknown as {
            uniforms: {
              maxblur: { value: number };
              aperture: { value: number };
            };
          }).uniforms;
          u.maxblur.value = bokehState.maxblur * s;
          u.aperture.value = bokehState.aperture * s;
          lastDofSlot = slot;
        }
      }

      composerLike.render();
    },
    setSize(width, height, pixelRatio) {
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      composerLike.setPixelRatio(pixelRatio);
      composerLike.setSize(w, h);
      // UnrealBloom holds its own pyramid targets — this rebuilds them
      // at the right resolution for the new canvas.
      bloomPass.setSize(w, h);
      // SSAO holds a normal render target sized to the canvas; without
      // this the AO would be sampled from a stale 1×1 map after a resize.
      if (ssaoPass) ssaoPass.setSize(w, h);
      // Bokeh holds its own depth target; setSize rebuilds it and
      // updates the aspect uniform.
      if (bokehPass) bokehPass.setSize(w, h);
      // Painterly needs the pixel size for the grain scale — without
      // this the grain would strobe as the browser adjusts DPR.
      painterlyPass.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
    },
    dispose() {
      // Composer.dispose() (three r160+) drops the target + pass buffers.
      if (typeof composerLike.dispose === "function") {
        try {
          composerLike.dispose();
        } catch {
          /* ignore — we still hard-dispose below */
        }
      }
      try {
        target.dispose();
      } catch {
        /* noop */
      }
      // UnrealBloom holds its own targets and materials; the pass has a
      // dispose method on r160+.
      const bl = bloomPass as unknown as { dispose?: () => void };
      if (typeof bl.dispose === "function") {
        try {
          bl.dispose();
        } catch {
          /* noop */
        }
      }
      // SSAO/Bokeh both hold their own render targets and materials.
      if (ssaoPass) {
        const ao = ssaoPass as unknown as { dispose?: () => void };
        if (typeof ao.dispose === "function") {
          try {
            ao.dispose();
          } catch {
            /* noop */
          }
        }
      }
      if (bokehPass) {
        const bo = bokehPass as unknown as { dispose?: () => void };
        if (typeof bo.dispose === "function") {
          try {
            bo.dispose();
          } catch {
            /* noop */
          }
        }
      }
      // Painterly pass holds a ShaderMaterial + FullScreenQuad — the
      // three r160+ dispose method drops both.
      {
        const pa = painterlyPass as unknown as { dispose?: () => void };
        if (typeof pa.dispose === "function") {
          try {
            pa.dispose();
          } catch {
            /* noop */
          }
        }
      }
    },
  };
}
