/**
 * city-composer — the render pipeline for /city.
 *
 * The tick loop used to end in a bare `renderer.clear() + renderer.render()`
 * pair. That works for two ortho quads but has no place for the passes the
 * dusk-and-lit-windows moment needs: no bloom, no output pass in a linear
 * working space, nowhere to hang SSAO / DOF / god-rays in a later PR.
 *
 * This module owns an EffectComposer with:
 *   RenderPass(groundScene)                → the sky/ground
 *   RenderPass(plotScene, clear:false)     → 48 instanced plots on top
 *   UnrealBloomPass                        → the ember at dusk, lit windows at night
 *   OutputPass                             → sRGB write + tonemap
 *
 * Bloom threshold / strength / radius are a function of dayFraction so the
 * ember RISES as the sun sets. At noon the bloom is a whisper; at dusk it is
 * the emotional peak the brief calls the core of the room; at midnight it
 * stays warm on the lit-window pixels.
 *
 * Tiers gate cost, not aesthetic goal:
 *   sleep  → no bloom (composer still runs so the pipeline stays linear)
 *   low    → no bloom
 *   medium → bloom on, tight radius
 *   high   → bloom on, wider radius (softer glow around bright pixels)
 *
 * Nothing here touches gesture, city.ts laws, or persistence — it is the
 * pipeline the aesthetic hangs from.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import type { QualityTier } from "@/lib/room-runtime";

export type CityComposer = {
  /**
   * Draw one frame. `dayFraction` is city.ts's dayFraction (0=dawn, 0.25=noon,
   * 0.5=dusk, 0.75=midnight). `tier` is the current governor tier — the
   * composer decides which passes are alive from it.
   */
  render(dayFraction: number, tier: QualityTier): void;
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
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
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

  // RenderPass 2: the plots, alpha-blended over the ground. Must NOT clear.
  const plotPass = new RenderPass(plotScene, plotCam);
  plotPass.clear = false;
  composer.addPass(plotPass);

  // Bloom: the ember at dusk, the warm halo on lit windows at night.
  // Parameters are updated per-frame from dayFraction inside render().
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(opts.width, opts.height),
    /* strength */ 0.5,
    /* radius   */ 0.6,
    /* threshold*/ 0.75,
  );
  composer.addPass(bloomPass);

  // OutputPass writes the linear working buffer to the canvas as sRGB and
  // applies the renderer's tonemapping (ACESFilmic, set in City.tsx).
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

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

  const composerLike = composer as unknown as {
    render(delta?: number): void;
    setPixelRatio(pr: number): void;
    setSize(w: number, h: number): void;
    passes: unknown[];
    dispose?: () => void;
  };

  return {
    render(dayFraction: number, tier: QualityTier) {
      // Tier gating. Bloom is where the aesthetic budget goes so a low
      // tier drops it; the ground and plots still render through the
      // composer's linear buffer so C's PBR materials will land right
      // when they arrive.
      if (tier !== lastTier) {
        const bloomOn = tier === "medium" || tier === "high";
        bloomPass.enabled = bloomOn;
        lastTier = tier;
        // Force the ember to recompute after a tier flip.
        lastEmberSlot = -1;
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
    },
  };
}
