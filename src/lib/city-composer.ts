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
 *                                            + the billboarded sun disk (renderOrder=0.5)
 *                                            + the raymarched cloud slab (renderOrder=1)
 *   RenderPass(groundScene, clear:false)   → 2D painterly ground shader
 *   RenderPass(plotScene,   clear:false)   → 48 instanced plots as emblems
 *   RenderPass(skylineScene, clear:false)  → the 3D extruded skyline
 *   RenderPass(waterScene,  clear:false)   → the harbour Reflector
 *   CityGodraysPass                        → volumetric sun shafts at dawn/dusk
 *   SSAOPass(skylineScene)                 → contact AO between towers
 *   UnrealBloomPass                        → the ember at dusk, lit windows at night
 *   BokehPass(skylineScene)                → wide-zoom Currier & Ives DOF
 *   CityPainterlyPass                      → bird's-eye warm register-shift
 *   OutputPass                             → sRGB write + tonemap
 *
 * God-rays sit between the water/skyline stack and SSAO+bloom on purpose:
 * the shafts the pass writes into the frame are then read by bloom's
 * threshold sieve, so a dusk shaft crossing a glass tower's lit-window
 * pixels feeds the ember curve twice (once as the shaft's own gold
 * additive, once as the bloom halo bloom pulls off the shafted pixels).
 * Placing the pass after bloom instead would let the shafts glow but
 * would not extend the ember downstream — the emotional peak of the
 * room deserves both.
 *
 * Bloom threshold / strength / radius are a function of dayFraction so the
 * ember RISES as the sun sets. At noon the bloom is a whisper; at dusk it is
 * the emotional peak the brief calls the core of the room; at midnight it
 * stays warm on the lit-window pixels. The city-sun-disk module writes a
 * 4.5× hot-core boost inside its 20 %-radius inner region — that emits a
 * luminance well above the 0.55..0.90 threshold curve so the bloom sieve
 * always sees the sun's core, and the halo it draws around the disk is
 * the characteristic photographic sun-flare every reference the brief
 * pins carries.
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
 *   sleep  → no bloom, no ssao, no dof, no god-rays (composer still runs so the pipeline stays linear)
 *   low    → no bloom, no ssao, no dof, no god-rays
 *   medium → bloom on, ssao on, god-rays on, no dof
 *   high   → bloom on, ssao on, god-rays on, dof on (ramped by pitch)
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
import {
  createCityGodraysPass,
  godraysGateOpen,
  godraysStrengthForDay,
  volumetricFogDensityForDay,
  type CityGodraysPass,
} from "@/lib/city-godrays";
import type { QualityTier } from "@/lib/room-runtime";

/**
 * Per-frame parameters for the participating-media volumetric fog
 * raymarch inside the god-rays pass.
 *
 * The composer needs a world-space sun direction (for the H-G phase
 * function), the camera the raymarch reconstructs its view ray from
 * (its projection + view matrices are inverted every tick), the water
 * plane height (so the march bounds itself against the harbour surface
 * instead of running to infinity), and a fog tint the world scene's
 * FogExp2 also reads from — so the volumetric contribution enters the
 * frame as the SAME sky the flat FogExp2 already reads against, and
 * R10-7's flat-wall complaint dissolves.
 *
 * The composer computes `uFogDensity` itself from `dayFraction`; the
 * frame does NOT carry it. This keeps the diurnal curve in one place
 * — a future refactor cannot silently drift the peak/floor on one
 * side while the test still passes on the other.
 */
export type VolumetricFogFrame = {
  /** The perspective camera the world scene renders through. */
  camera: THREE.PerspectiveCamera;
  /**
   * The sun's world-space position — the raymarch normalises this to
   * a direction. The directional light points TOWARD the origin, so
   * light.position IS the sun direction from the scene's viewpoint.
   */
  sunWorldPos: THREE.Vector3;
  /**
   * Fog tint the volumetric in-scatter carries. City.tsx samples this
   * from the same `fogColorFromSky(citySky.currentState)` the world
   * scene's FogExp2 reads — so the volumetric read is the same colour
   * the wall read was, and the two agree on the horizon hue.
   */
  fogColor: THREE.Color;
  /**
   * World-space Y of the harbour plane. WATER_PLANE_Y from
   * `src/lib/city-water.ts` (~0.05). The raymarch bounds itself
   * against this plane so a ray looking downward from the camera
   * stops at the water surface instead of continuing beneath it.
   */
  waterY: number;
};

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
   *   `sunScreen`   — the projected sun position in NDC ([-1..1]², z<1
   *   when in front of the camera) plus a visibility flag. Optional so
   *   pre-sun callers still compile; when omitted, god-rays are off.
   */
  render(
    dayFraction: number,
    tier: QualityTier,
    pitch01?: number,
    sunScreen?: { x: number; y: number; visible: boolean },
    volFog?: VolumetricFogFrame,
  ): void;
  /**
   * Resize the offscreen render targets to (width, height) in CSS pixels
   * and set the renderer pixel ratio. Call from the room's ResizeObserver
   * callback, alongside the renderer's own setSize.
   */
  setSize(width: number, height: number, pixelRatio: number): void;
  /**
   * Progressive-enablement gates. Each named pass is ANDed with the tier
   * decision inside `render()` — a gate of `false` forces the pass off
   * even at a tier that would normally enable it. Undefined keys keep
   * their previous state (default: all `true` so nothing changes for
   * pre-existing callers).
   *
   * Emergency /city fix uses this to stagger heavy shader compilation
   * across the first ~30 frames: frame 1 renders sky+ground+plots with
   * every gate `false`, then City.tsx re-opens one gate per frame until
   * the full pipeline is live. Without this the composer would compile
   * bloom+SSAO+bokeh+godrays all at once on the first `.render()` call
   * and iOS Safari kills the tab.
   */
  setPassGates(gates: Partial<{
    bloom: boolean;
    ssao: boolean;
    dof: boolean;
    godrays: boolean;
    water: boolean;
  }>): void;
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
 *   medium → bloom on + ssao on + god-rays on (contact AO + dawn/dusk shafts)
 *   high   → bloom on + ssao on + dof on + god-rays on (all four post-passes)
 */
export function passesForTier(tier: QualityTier): {
  bloom: boolean;
  ssao: boolean;
  dof: boolean;
  godrays: boolean;
} {
  switch (tier) {
    case "high":
      return { bloom: true, ssao: true, dof: true, godrays: true };
    case "medium":
      // God-rays ride the same tier gate as SSAO — the brief's spec.
      // A medium-tier device on a sunset frame still gets the London
      // shafts through the towers; only the DOF (BokehPass, wide-zoom
      // painterly blur) is dropped. The fragment cost is bounded: on the
      // ~85% of the day outside the ±0.08 gate the pass short-circuits
      // to a passthrough at one texture fetch, and inside the gate the
      // 24 radial taps are the same budget SSAO's kernel already pays.
      return { bloom: true, ssao: true, dof: false, godrays: true };
    case "low":
    case "sleep":
    default:
      return { bloom: false, ssao: false, dof: false, godrays: false };
  }
}

/**
 * The perf-probe callback surface. When `createCityComposer` is handed a
 * probe, its `render()` measures `performance.now()` around the internal
 * `composer.render()` call and forwards the elapsed milliseconds to
 * `onComposerFrame`. The probe is off by default — callers who do not
 * pass one pay nothing (one property read per render).
 *
 * Kept as a plain callback (not an event emitter) so the composer stays
 * free of listener lists. The room's `?__perf=1` gate builds one probe
 * per mount and drops it in cleanup — see `src/components/City.tsx`.
 *
 * `mirror_ms` and `frame_ms` and the other keys arrive from other modules
 * (city-water.ts, City.tsx tick loop) and land in the same ring the tick
 * loop builds — the composer only owns `composer_ms`.
 */
export type CityComposerPerfProbe = {
  /**
   * Called once per successful `composer.render()`. `composerMs` is the
   * wall-clock delta from just before the internal render() to just
   * after — the number a "composer under 8ms" claim must quote.
   */
  onComposerFrame(composerMs: number): void;
};

/**
 * A rolling window of the last N samples for a given metric, with
 * avg / p50 / p95 / max derived on demand. Pure JS — no THREE, no DOM —
 * so a Node test can pin the aggregation semantics without a browser.
 *
 * The window is fixed-size (120 frames = ~2s at 60Hz per the brief);
 * `push` overwrites the oldest slot in place, so the ring is a
 * zero-alloc write path — the ring lives on the tick's hot line.
 * `snapshot` allocates a temporary sorted copy for the percentile read
 * but the room reads the snapshot at most once per second (devtools /
 * harness poll), never inside the tick. Do NOT call `snapshot` from a
 * frame path — it would defeat the ring's whole point.
 */
export type PerfRing = {
  /** Push a sample. Overwrites the oldest slot when the ring is full. */
  push(value: number): void;
  /** How many samples the ring currently holds (0..capacity). */
  size(): number;
  /** The ring's capacity (fixed at construction). */
  capacity(): number;
  /**
   * Aggregate the current window. `avg` is the arithmetic mean; `p50` /
   * `p95` are the sorted-order quantiles (nearest-rank); `max` is the
   * largest sample. Returns zeros when the ring is empty — a caller
   * polling before the first frame gets stable numbers, not NaNs.
   */
  snapshot(): { avg: number; p50: number; p95: number; max: number; count: number };
};

/**
 * Build a rolling-window ring for a single perf metric. Fixed capacity
 * (120 by default — a two-second window at 60Hz). Allocations happen
 * ONCE at construction; `push` never allocates.
 *
 * Exported so scripts/test-city-perf-probe.mjs can verify the ring
 * aggregates the way every later PR expects — a regression that
 * silently averaged over a larger window would rewrite the meaning of
 * every measured_delta claim.
 */
export function createPerfRing(capacityIn = 120): PerfRing {
  // Clamp to a sane range. A ring of size 0 would divide by zero on avg;
  // an enormous ring would still work but would consume 4 KB per metric
  // for no analytic benefit past a few hundred frames.
  const capacity = Math.max(1, Math.min(4096, Math.floor(capacityIn)));
  const buf = new Float64Array(capacity);
  let head = 0;   // next write index
  let count = 0;  // how many samples we have (up to capacity)
  return {
    push(value: number) {
      // Guard NaN/Infinity — a bad sample would poison the percentile
      // read. We drop silently: a lost frame's timing is less harmful
      // than a NaN turning the whole window into NaN.
      if (!Number.isFinite(value)) return;
      buf[head] = value;
      head = (head + 1) % capacity;
      if (count < capacity) count += 1;
    },
    size() { return count; },
    capacity() { return capacity; },
    snapshot() {
      if (count === 0) return { avg: 0, p50: 0, p95: 0, max: 0, count: 0 };
      // Copy the live window into a scratch typed array, sort, index.
      // The copy is O(n) and cheap; the sort is O(n log n). Both live
      // OUTSIDE the tick loop — see the type doc above.
      const scratch = new Float64Array(count);
      for (let i = 0; i < count; i += 1) scratch[i] = buf[i];
      let sum = 0;
      let max = -Infinity;
      for (let i = 0; i < count; i += 1) {
        const v = scratch[i];
        sum += v;
        if (v > max) max = v;
      }
      scratch.sort();
      // Nearest-rank quantile: floor(q * n) clamped to n-1. For n=1 both
      // p50 and p95 are the sole sample; for n=120 p95 lands at index 114.
      const p50 = scratch[Math.min(count - 1, Math.floor(0.50 * count))];
      const p95 = scratch[Math.min(count - 1, Math.floor(0.95 * count))];
      return { avg: sum / count, p50, p95, max, count };
    },
  };
}

export type CityComposerOptions = {
  renderer: THREE.WebGLRenderer;
  groundScene: THREE.Scene;
  groundCam: THREE.Camera;
  plotScene: THREE.Scene;
  plotCam: THREE.Camera;
  /**
   * Optional perf probe. When present, `render()` measures the wall time
   * around the internal composer.render() call and forwards the delta to
   * `probe.onComposerFrame(ms)`. Off by default — a null probe costs
   * nothing per frame past the one property read.
   */
  perfProbe?: CityComposerPerfProbe;
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
   *
   * R6-C note: city-water.ts's `createCityWater` is now handed the same
   * skylineScene we pass here for the skyline RenderPass. The reflector
   * patches its own onBeforeRender to render that scene into its RT so
   * the mirror carries the real extruded prisms, not a proxy box field.
   * From the composer's angle nothing changes — the water pass still
   * calls into the reflector at the ordered moment; the reflector just
   * paints a truer picture into its own RT before its own shader samples.
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

  // God-rays — volumetric sun shafts through the buildings, gated to the
  // horizon-crossing windows at dawn and dusk. Runs BEFORE bloom so the
  // shaft pixels the pass adds feed the bloom curve — the gold ember at
  // dusk gathers around the shafted sky and the lit-window emissive on
  // any tower whose facade the shaft crosses picks up a warmer halo than
  // it would have without the ray contribution underneath. The pass
  // sits right after the water/skyline scenes and before SSAO so the
  // AO ring the SSAO writes into the crevices doesn't get scattered by
  // the shaft's radial tap accumulator (AO subtracts from the frame; the
  // rays add to it — order matters only in that both need to land before
  // bloom for the ember to peak at dusk). Cheap short-circuit inside the
  // fragment shader on uStrength=0 means outside the ±0.08 dayFraction
  // gate the pass ships a passthrough copy at ~one texture fetch per
  // pixel — the ~85% of the day that lives outside dawn/dusk pays only
  // that single fetch.
  const godraysPass: CityGodraysPass = createCityGodraysPass();
  godraysPass.enabled = false;
  composer.addPass(godraysPass);

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

  // Progressive-enablement gates. All `true` by default so pre-existing
  // callers see no behavior change. City.tsx flips these `false` at mount
  // to skip heavy shader compilation on frame 1, then re-opens them one
  // per frame across the first ~30 frames of the tick loop. A gate of
  // `false` forces the pass off regardless of the tier's decision.
  const gate = {
    bloom: true,
    ssao: true,
    dof: true,
    godrays: true,
    water: true,
  };

  // Track the last tier we applied so we can skip DOM-ish `enabled` writes
  // and threshold reads on frames where nothing changed. Frame time in
  // this room is dominated by the plot shader; every microsecond back
  // is a microsecond that pays for B/C/D in the next PRs.
  let lastTier: QualityTier | null = null;
  // Cached tier decision, refreshed on tier change. The tick loop reads
  // `aliveTier.godrays` per frame instead of running the switch statement
  // every draw — a marginal saving, but worth the closure slot: the tier
  // decision is the same shape for every frame at that tier.
  let aliveTier = passesForTier("high");
  let lastEmberSlot = -1;
  // Quantised god-rays slot — the strength curve is a linear ramp inside
  // a narrow [±0.08] gate, so quantising the day into 128 slots gives us
  // ~10 samples across the ramp, which is imperceptible to the eye.
  // Writing the uniform only when the slot advances saves the JS-side
  // uniform-object churn on the ~99% of frames that don't need it.
  let lastGodraysStrengthSlot = -1;
  // Quantised sun-uv slot — 128×128 slots across the frame. Any finer
  // and the human eye can't tell; any coarser and a slow pan of the
  // camera would step the sun position visibly.
  let lastGodraysSunSlotX = -1;
  let lastGodraysSunSlotY = -1;
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

  // Whenever `setPassGates` runs we mark the enable-bit derivation dirty
  // so the next `render()` re-derives every pass's `enabled` flag from
  // (tier ∧ gate), even if the tier itself did not change. Without this
  // a `setPassGates({ bloom: true })` while sitting at high tier would
  // not take effect until the next tier transition.
  let gatesDirty = false;

  return {
    render(
      dayFraction: number,
      tier: QualityTier,
      pitch01?: number,
      sunScreen?: { x: number; y: number; visible: boolean },
      volFog?: VolumetricFogFrame,
    ) {
      // Tier gating. Passes are pre-constructed in the chain; we only
      // flip their `enabled` bit. The ground and plots still render
      // through the composer's linear buffer at every tier so C's PBR
      // materials land right whatever the governor decided.
      if (tier !== lastTier || gatesDirty) {
        const alive = passesForTier(tier);
        aliveTier = alive;
        bloomPass.enabled = alive.bloom && gate.bloom;
        if (ssaoPass) ssaoPass.enabled = alive.ssao && gate.ssao;
        if (bokehPass) bokehPass.enabled = alive.dof && gate.dof;
        // The harbour is off on sleep tier — the whole pass skips. The
        // water module still handles its own high/medium/low visible-mesh
        // swap inside update(); this gate is defence in depth.
        if (waterPass) waterPass.enabled = tier !== "sleep" && gate.water;
        // Painterly register-shift keeps living at every non-sleep tier
        // — the brief calls it out as cheap enough to keep at low tier
        // (one full-screen sample; the aesthetic split into two
        // registers matters more than a fraction of a millisecond).
        // Sleep tier skips it entirely because sleep drops all overlays.
        // High tier gets a marginally deeper vignette so the paper-edge
        // halo reads on the big screens that carry the extra headroom.
        painterlyPass.uniforms.uVignette.value = tier === "high" ? 1.15 : 1.0;
        // God-rays live at high AND medium tier — the same gate SSAO uses,
        // per the brief. On any drop below medium, mute the strength
        // uniform so a later re-entry starts from a clean ramp —
        // otherwise the leftover uStrength from the last high/medium
        // frame would flash for one frame on re-entry. `gate.godrays`
        // ANDs the tier decision so the progressive-enablement chain can
        // hold the pass off past the tier boundary until its own frame.
        aliveTier = { ...alive, godrays: alive.godrays && gate.godrays };
        if (!aliveTier.godrays) {
          godraysPass.enabled = false;
          godraysPass.uniforms.uStrength.value = 0;
          // Zero the fog density on tier drop so a later re-entry into
          // medium/high starts from a clean ramp — otherwise the
          // leftover density from the last active frame would flash
          // for one frame on re-entry.
          godraysPass.uniforms.uFogDensity.value = 0;
        }
        lastTier = tier;
        gatesDirty = false;
        // Force the ember + DOF + painterly + god-rays to recompute
        // after a tier flip.
        lastEmberSlot = -1;
        lastDofSlot = -1;
        lastPainterlySlot = -1;
        lastGodraysStrengthSlot = -1;
        lastGodraysSunSlotX = -1;
        lastGodraysSunSlotY = -1;
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

      // God-rays: high + medium tier, gated to dawn/dusk horizon-crossings.
      // The pass is enabled ONLY when the gate is open AND the sun's
      // projection is visible in the frame — outside that window we set
      // enabled=false so the composer skips the draw entirely. Inside
      // it, we update the sun UV and the strength curve on quantised
      // slots so the uniform writes only fire when a value has visibly
      // advanced. Uses passesForTier's `godrays` flag rather than a hard
      // `tier === "high"` compare so the tier gate lives in one place —
      // a future refactor that adds god-rays at low tier flips only the
      // ladder.
      // God-rays + participating-media volumetric fog.
      // The pass now carries BOTH the shaft accumulator (gated to the
      // ±0.08 horizon-crossing window) AND a 20-step fog raymarch that
      // runs at a low but non-zero density all day — R10-7's fix. The
      // pass is enabled whenever the tier says godrays are alive AND
      // the fog frame is present; the shaft accumulator inside the
      // shader short-circuits on uStrength=0 so on the ~85% of the day
      // outside the shaft gate the fragment cost is fog-only (20 taps
      // + one composition).
      //
      // If the caller does NOT hand us a `volFog` frame — this is the
      // legacy no-CSM caller path or a pre-fog test bench — we fall
      // back to the previous R2 behaviour: shafts-only, no fog. The
      // check on `volFog` keeps the composer backwards-compatible so
      // an older room can still mount it without hitting undefined
      // matrix dereferences in the shader.
      if (aliveTier.godrays) {
        const gateOpen = godraysGateOpen(dayFraction);
        const sunVisible = sunScreen ? sunScreen.visible : false;
        const shaftActive = gateOpen && sunVisible;
        const fogActive = !!volFog;
        // The pass is enabled whenever the fog frame is present OR the
        // shafts are active. Fog-alone frames still write per-frame
        // matrices so the raymarch reconstructs the current view ray.
        godraysPass.enabled = shaftActive || fogActive;
        if (godraysPass.enabled) {
          // Shaft strength — pinned by test-city-godrays.mjs. When the
          // gate is closed we write 0 so the shader's short-circuit
          // takes the fast path.
          const dfSlot = Math.floor(dayFraction * 128);
          if (dfSlot !== lastGodraysStrengthSlot) {
            const s = shaftActive ? godraysStrengthForDay(dayFraction) : 0;
            godraysPass.uniforms.uStrength.value = s;
            // Fog density rides the same slot so a single day-fraction
            // change updates both curves at once — one JS write per
            // slot for the two coupled uniforms.
            godraysPass.uniforms.uFogDensity.value = fogActive
              ? volumetricFogDensityForDay(dayFraction)
              : 0;
            lastGodraysStrengthSlot = dfSlot;
          } else if (!shaftActive && godraysPass.uniforms.uStrength.value !== 0) {
            // Same-slot but shaft gate just closed: explicit zero so
            // the previous frame's strength doesn't flash for one
            // frame on a fast gate transit.
            godraysPass.uniforms.uStrength.value = 0;
          }

          if (shaftActive) {
            // Sun UV — NDC → UV is (ndc + 1) * 0.5 on both axes; note
            // the y-flip is NOT applied here because both the composer's
            // render target and camera.project() use the same GL-style
            // convention (y-up in NDC, y-up in UV). If a future renderer
            // change flipped the target we would flip here too.
            const sx = sunScreen!.x;
            const sy = sunScreen!.y;
            const slotX = Math.round(((sx + 1) * 0.5) * 128);
            const slotY = Math.round(((sy + 1) * 0.5) * 128);
            if (slotX !== lastGodraysSunSlotX || slotY !== lastGodraysSunSlotY) {
              godraysPass.uniforms.uSunUv.value.set(
                (sx + 1) * 0.5,
                (sy + 1) * 0.5,
              );
              lastGodraysSunSlotX = slotX;
              lastGodraysSunSlotY = slotY;
            }
          }

          // Volumetric fog uniforms — camera-derived quantities update
          // every frame. The three mat4/vec3 writes are cheap: one
          // camera-matrix inversion (Three.js caches internally when
          // safe) and two vector copies. The alternative — quantising
          // these to slots — would band the raymarch on a slow pan
          // and defeat the participating-media illusion.
          if (fogActive) {
            const cam = volFog!.camera;
            // Ensure the projection matrix is fresh; three.js updates
            // it lazily on aspect changes but we want stability under
            // resize.
            cam.updateProjectionMatrix();
            cam.updateMatrixWorld();
            godraysPass.uniforms.uInverseProjection.value.copy(
              cam.projectionMatrixInverse,
            );
            godraysPass.uniforms.uInverseView.value.copy(cam.matrixWorld);
            godraysPass.uniforms.uCameraPos.value.copy(cam.position);
            // Sun direction — the raymarch reads this as a unit vector
            // for the Henyey-Greenstein phase function. sunWorldPos
            // is a placement at some large distance along the sun
            // direction from the origin; normalising it lands the
            // unit direction we need.
            const s = volFog!.sunWorldPos;
            const invLen = 1 / Math.max(1e-6, Math.hypot(s.x, s.y, s.z));
            godraysPass.uniforms.uSunDir.value.set(
              s.x * invLen,
              s.y * invLen,
              s.z * invLen,
            );
            // Fog tint from the world scene's horizon sample — the
            // SAME hue the flat FogExp2 already carries. R10-7's fix
            // requires the volumetric read to agree with the flat
            // read; passing the same colour is what does it.
            const c = volFog!.fogColor;
            godraysPass.uniforms.uFogColor.value.set(c.r, c.g, c.b);
            // Water plane Y — the raymarch bounds itself against this
            // so a downward-looking ray stops at the harbour surface.
            godraysPass.uniforms.uFogHeight.value = volFog!.waterY;
            // Advance the jitter time uniform so temporal dither
            // reshuffles the 20-tap raymarch each frame.
            const nowMs =
              typeof performance !== "undefined" &&
              typeof performance.now === "function"
                ? performance.now()
                : 0;
            godraysPass.uniforms.uTime.value = (nowMs - mountEpochMs) / 1000;
          }
        } else if (godraysPass.uniforms.uStrength.value !== 0) {
          // Pass disabled — explicit zero so a next-frame re-enable
          // (fast gate transit) doesn't flash the previous strength
          // for one frame.
          godraysPass.uniforms.uStrength.value = 0;
        }
      }

      // Perf probe — measure the wall time around composer.render(). The
      // start/end pair straddles the ONLY internal renderer.render()
      // chain that lives inside the composer, so the delta the probe
      // reports is exactly the composer's frame budget (target D). The
      // probe is opt-in per createCityComposer options; the branch is a
      // single property compare on frames where the probe is off.
      const perfProbe = opts.perfProbe;
      const composerStart = perfProbe
        ? (typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : 0)
        : 0;
      composerLike.render();
      if (perfProbe) {
        const composerEnd = typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : composerStart;
        // A negative or non-finite delta would only arise from a clock
        // rewind or a probe misuse — hand the raw number and let the
        // ring's NaN guard drop it, so the room never crashes on a bad
        // sample.
        try { perfProbe.onComposerFrame(composerEnd - composerStart); }
        catch { /* probe error is not a render error */ }
      }
    },
    setPassGates(gates) {
      let changed = false;
      if (gates.bloom !== undefined && gate.bloom !== gates.bloom) {
        gate.bloom = gates.bloom; changed = true;
      }
      if (gates.ssao !== undefined && gate.ssao !== gates.ssao) {
        gate.ssao = gates.ssao; changed = true;
      }
      if (gates.dof !== undefined && gate.dof !== gates.dof) {
        gate.dof = gates.dof; changed = true;
      }
      if (gates.godrays !== undefined && gate.godrays !== gates.godrays) {
        gate.godrays = gates.godrays; changed = true;
      }
      if (gates.water !== undefined && gate.water !== gates.water) {
        gate.water = gates.water; changed = true;
      }
      // Force the next `render()` to re-derive every pass's `enabled` bit
      // from (tier ∧ gate) even when the tier itself did not change.
      if (changed) gatesDirty = true;
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
      // God-rays pass — same ShaderMaterial + FullScreenQuad dispose.
      {
        const gr = godraysPass as unknown as { dispose?: () => void };
        if (typeof gr.dispose === "function") {
          try {
            gr.dispose();
          } catch {
            /* noop */
          }
        }
      }
    },
  };
}
