/**
 * city-sun — the diurnal light of /city, as a real DirectionalLight with
 *            cascaded shadow maps.
 *
 * The 2D ground shader used to paint a hand-tuned yellow disk on a hand-tuned
 * gradient and call it "the sun". That produced a moving spot on a screen, not
 * a light. Once the room grows PBR materials, glass towers, and receiving
 * ground planes (the "3D prisms" the brief promises), the same disk in the
 * shader cannot cast a shadow, cannot warm a facade, cannot fall as a raking
 * light through a Gherkin at dusk. So the sun becomes a real Three.js
 * DirectionalLight parameterised by dayFraction: azimuth from a fixed heading
 * (south-southwest, so the noon shadow points away from the camera and dusk
 * light rakes across the visible facades), altitude a smooth arc from dawn
 * through noon to dusk, hidden below the horizon at night. The moon replaces
 * it as a much dimmer cold source when the altitude is negative, so the
 * settlement is never lit by nothing.
 *
 * Cascaded shadow maps (R10-4 + R10-8). One 2048² PCF map at a 220m half-
 * frustum was the previous state — a 180 m event tower and a 1.7 m
 * pedestrian could not share one shadow frustum without one going dithered.
 * The v4 sun splits the shadow work across three DirectionalLights, all
 * pointing in the same sun direction, each with its own orthographic
 * frustum sized to a different scale of world detail:
 *
 *   CASCADE 0 (near):  40 m half-radius  — pedestrians, lamp posts, cars
 *   CASCADE 1 (mid):  250 m half-radius  — storefronts, trees, block plots
 *   CASCADE 2 (far): 2000 m half-radius  — event towers, harbour, ring
 *
 * The three lights each carry ONE THIRD of the sun's total color × intensity
 * so their summed lighting is identical to the previous single light, but
 * every pixel gets three shadow samples — the cascade whose frustum
 * covers it at the highest resolution effectively wins for that scale. A
 * pedestrian at ground level sits inside all three frustums, but the near
 * cascade's 4096² map at 40 m gives ~1 cm/texel, which is the resolution
 * required to draw a readable contact shadow under one boot. The event
 * tower at 180 m sits only inside the far cascade's 2000 m frustum, whose
 * 4096² map gives ~49 cm/texel — enough for its self-shadow to read solid
 * at the dusk raking angle.
 *
 * PCSS-style contact hardening (R10-8). Real PCSS requires shader-chunk
 * injection into the built-in materials' shadow test; the approximation
 * we ship here is per-cascade `shadow.radius`: the near cascade uses a
 * small radius (~1.5 texels) so contact shadows harden right at the
 * point of contact, and the far cascade uses a wider radius (~6 texels)
 * so distant occluders read as soft ambient darkening. `bias` and
 * `normalBias` are scaled per cascade — a large frustum needs a larger
 * normalBias to hide slope-scale acne on tall vertical facades, while
 * the near cascade needs the tightest bias so a pedestrian's foot
 * shadow does not peter-pan.
 *
 * All three cascade lights share ONE target Object3D — moving the target
 * with the camera at update() time keeps the entire cascade stack tracking
 * the visitor. The target Object3D itself is exposed so the caller adds
 * it to the scene graph exactly once.
 *
 * Nothing here reads or writes city.ts state. `update(dayFraction)` is the
 * whole interface — the renderer's tick loop calls it with the same
 * dayFraction the 2D shaders read, so the perspective sun and the shader's
 * ember stay in phase.
 */

import * as THREE from "three";

import type { QualityTier } from "@/lib/room-runtime";

/**
 * The sun's fixed heading in the horizon plane, radians clockwise from
 * -Z (looking south). π/4 + π/8 ≈ 67.5° puts noon light coming from
 * roughly south-south-west — the noon shadow points north-north-east,
 * away from the visitor at the default camera, and the dusk sun sinks
 * to the west-north-west where it rakes across the widest facades.
 * Kept a plain constant on purpose: no gesture changes the direction
 * the sun sets, and no future PR should either.
 */
export const CITY_SUN_AZIMUTH_RAD = Math.PI * 0.375;

/**
 * Distance from the shadow-camera target the sun is placed at. Directional
 * lights don't attenuate with distance — this only sets the shadow frustum's
 * origin, so a large number here is fine as long as the shadow.camera.near /
 * far bracket it.
 */
export const CITY_SUN_DISTANCE = 240;

/**
 * The count of cascades. Three is the number the brief pins — near for
 * pedestrians + cars, mid for storefronts + trees, far for towers +
 * harbour + the ring landmarks. A fourth cascade would only add cost
 * without covering a new scale of geometry the room presents.
 */
export const CSM_CASCADE_COUNT = 3;

/**
 * Per-cascade half-radius of the orthographic frustum, in world units
 * (metres). These are the emotional targets the brief pins:
 *   [0] 40 m   — a lamp post's cast shadow, a pedestrian's contact shadow
 *   [1] 250 m  — the storefront block, tree ring canopies, cars in traffic
 *   [2] 2000 m — the tallest event tower and the harbour ring
 * A refactor that tightened cascade 2 to 500 m would drop the outer
 * landmark ring's shadows entirely; a refactor that widened cascade 0
 * past 60 m would dither pedestrian shadows to a resolution the eye
 * reads as diorama. The literals are the spec.
 */
export const CSM_CASCADE_RADII: readonly number[] = [40, 250, 2000];

/**
 * Per-cascade PCSS-approximation shadow radius (texels). Smaller radius
 * hardens the shadow — visible at the contact point where the near
 * cascade covers a pedestrian's foot or a lamp post's base. Larger
 * radius softens — the far cascade's tower shadow spreads its
 * self-shadow across the facade so a hard edge does not stripe the
 * building.
 */
export const CSM_CASCADE_SHADOW_RADII: readonly number[] = [1.5, 3.0, 6.0];

/**
 * Per-cascade normalBias — proportional to the texel size of the shadow
 * map at that frustum size. The near cascade at 40 m / 4096² has ~1 cm
 * texels, so a normalBias of 0.02 keeps a pedestrian's foot shadow
 * touching the ground without acne; the far cascade at 2000 m / 4096²
 * has ~49 cm texels, so its normalBias runs up to 0.3 to hide the
 * slope-scale acne a tall vertical facade shows at dusk raking angles.
 */
export const CSM_CASCADE_NORMAL_BIAS: readonly number[] = [0.02, 0.08, 0.30];

/**
 * Per-cascade bias — the negative offset that pulls the shadow test in
 * so a ground plane does not self-shadow at noon. Scaled the same way
 * as normalBias, roughly proportional to the frustum size.
 */
export const CSM_CASCADE_BIAS: readonly number[] = [-0.00005, -0.0002, -0.001];

/**
 * dayFraction → normalized sun direction (unit vector, y is up).
 *
 * dayFraction runs 0..1 with 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight.
 * The altitude is a sine that peaks at 0.25 and troughs at 0.75. At night
 * the altitude is negative (sun below horizon) — callers can decide
 * whether to substitute the moon or fade the light instead of using it.
 *
 * Exported and pure so a unit test can pin the four cardinal directions.
 */
export function sunDirection(dayFraction: number, azimuth = CITY_SUN_AZIMUTH_RAD): THREE.Vector3 {
  const f = ((dayFraction % 1) + 1) % 1;
  // sin(2π f) peaks at f=0.25, troughs at f=0.75 — perfect for altitude.
  const altitude = Math.sin(f * Math.PI * 2);
  const horizonR = Math.cos(altitude * (Math.PI * 0.5));
  return new THREE.Vector3(
    Math.sin(azimuth) * horizonR,
    Math.sin(altitude * (Math.PI * 0.5)),
    -Math.cos(azimuth) * horizonR,
  ).normalize();
}

/**
 * Signed altitude of the sun in radians. Positive is above the horizon,
 * negative is below. Used to choose day vs moon behaviour and to fade
 * the light near sunrise/sunset.
 */
export function sunAltitude(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  return Math.sin(f * Math.PI * 2) * (Math.PI * 0.5);
}

/**
 * Sun colour as a function of altitude. Warm 2000K at the horizon,
 * cooler 5500K at zenith, indigo moon-colour below the horizon. Approx
 * blackbody, kept in linear-ish sRGB so the tone mapper doesn't have to
 * unwind a marketing gamma.
 */
export function sunColorAt(dayFraction: number): THREE.Color {
  const alt = sunAltitude(dayFraction);
  if (alt < 0) {
    // moon — cold indigo, dim; strengthens as the sun sinks deeper.
    const deep = Math.min(1, -alt / (Math.PI * 0.5));
    return new THREE.Color(0.42, 0.52, 0.78).multiplyScalar(0.55 + deep * 0.15);
  }
  // above horizon — warm at low altitude, hot near noon.
  const t = Math.min(1, alt / (Math.PI * 0.35));
  const warm = new THREE.Color(1.0, 0.52, 0.22);   // ~2000K, sunrise/sunset
  const hot  = new THREE.Color(1.0, 0.97, 0.90);   // ~5500K, noon
  return warm.clone().lerp(hot, t);
}

/**
 * Sun intensity. Rises with altitude; drops off near the horizon so
 * dusk feels red and low, not blown out. At night the returned value
 * corresponds to the moon's intensity — small but not zero, so shadow
 * shapes still exist at midnight.
 */
export function sunIntensityAt(dayFraction: number): number {
  const alt = sunAltitude(dayFraction);
  if (alt < 0) {
    // moon — small band of intensity, peaking at midnight.
    const deep = Math.min(1, -alt / (Math.PI * 0.5));
    return 0.20 + 0.15 * deep;
  }
  // day — smooth cosine-like ramp from 0.7 at the horizon to 3.4 at zenith.
  const t = Math.min(1, alt / (Math.PI * 0.45));
  return 0.7 + 2.7 * (t * t * (3 - 2 * t));
}

/**
 * Per-tier shadow-map resolution. The brief pins 4096² per cascade at
 * high tier — the resolution required to make a pedestrian's contact
 * shadow AND a 180 m tower's self-shadow read solid in the same frame.
 * Weaker tiers step down by powers of two so mid-range hardware does
 * not blow its shadow-atlas budget. Sleep tier disables shadows entirely.
 *
 * The ladder is pure: it does not read any THREE.js state, so the
 * test suite can pin every step.
 */
export function cascadeMapSizeForTier(tier: QualityTier): number {
  if (tier === "high") return 4096;
  if (tier === "medium") return 2048;
  if (tier === "low") return 1024;
  return 0; // sleep — no shadows at all
}

/**
 * Per-cascade half-radius accessor. Guards against an index outside the
 * cascade count returning undefined — clamps to the outermost cascade.
 */
export function cascadeRadiusFor(index: number): number {
  const clamped = Math.max(0, Math.min(CSM_CASCADE_COUNT - 1, Math.floor(index)));
  return CSM_CASCADE_RADII[clamped];
}

/**
 * Per-cascade PCSS-approx shadow radius (texels). Same guard.
 */
export function cascadeShadowRadiusFor(index: number): number {
  const clamped = Math.max(0, Math.min(CSM_CASCADE_COUNT - 1, Math.floor(index)));
  return CSM_CASCADE_SHADOW_RADII[clamped];
}

/**
 * Per-cascade normalBias accessor. Same guard.
 */
export function cascadeNormalBiasFor(index: number): number {
  const clamped = Math.max(0, Math.min(CSM_CASCADE_COUNT - 1, Math.floor(index)));
  return CSM_CASCADE_NORMAL_BIAS[clamped];
}

/**
 * Per-cascade bias accessor. Same guard.
 */
export function cascadeBiasFor(index: number): number {
  const clamped = Math.max(0, Math.min(CSM_CASCADE_COUNT - 1, Math.floor(index)));
  return CSM_CASCADE_BIAS[clamped];
}

/**
 * Options for creating the city sun. Any of these may be omitted and
 * sensible defaults land — the room's default camera and its default
 * quality tier are the tuning target.
 */
export type CitySunOptions = {
  /** Half-size of the FAR cascade's orthographic frustum, in world units.
   *  Retained for backward compat with the pre-CSM caller; if omitted,
   *  the cascade ladder's own CSM_CASCADE_RADII[2] is used. */
  area?: number;
  /** Shadow map resolution for the high tier. Round to a power of two. */
  mapSize?: number;
  /** Hemisphere fill light amplitude. 0 disables the fill light entirely. */
  hemiIntensity?: number;
};

/**
 * The bundled sun the city hangs off.
 *
 * `light` is retained as the FAR cascade — the biggest frustum, the one
 * that shadows event towers and the ring landmarks. Its `position`,
 * `color`, and full contribution can be sampled by godray / cloud
 * effects via the `sunColor` / `sunIntensity` / `sunPosition` accessors
 * (which report the AGGREGATE across all three cascades, so a caller
 * reading them gets the same numbers the single-light version returned).
 *
 * `cascades` is the ordered [near, mid, far] triplet. Each is a real
 * DirectionalLight in the scene, casting its own shadow map from the
 * same sun direction. Adding them to the scene one time at construct
 * (via `addToScene`) is enough; `update()` refreshes their positions
 * and shadow-camera projection every frame.
 *
 * `hemi` is a hemisphere fill that keeps the shadow side of a facade
 * from going to pure black (adjusting toward the sky/ground colours
 * the city-sky module provides).
 *
 * `target` is the single Object3D all three cascade lights point at.
 * Moving it lets the shadow frustums follow the visitor at wide zooms
 * without needing three separate targets.
 */
export type CitySun = {
  light: THREE.DirectionalLight;
  cascades: THREE.DirectionalLight[];
  hemi: THREE.HemisphereLight;
  target: THREE.Object3D;
  /** Aggregate sun colour (linear RGB) — full unattenuated colour, so
   *  cloud / godray sampling gets the numbers that lit the previous
   *  single-light version. */
  readonly sunColor: THREE.Color;
  /** Aggregate sun intensity — the sum across cascades, matching the
   *  pre-CSM single-light value. */
  readonly sunIntensity: number;
  /** World-space position of the sun (the direction is `sunPosition.normalize()`). */
  readonly sunPosition: THREE.Vector3;
  /**
   * Attach the cascades, the hemisphere, and the target to a scene
   * graph node. One-shot; the caller does NOT need to add any of the
   * exposed lights individually.
   */
  addToScene(root: THREE.Object3D): void;
  /**
   * Reposition and recolour the sun for a given dayFraction. `centerXZ`
   * is the world-space (x, z) point the shadow frustums should follow;
   * default is (0, 0).
   */
  update(dayFraction: number, centerXZ?: { x: number; z: number }): void;
  /**
   * Adjust shadow map size and quality by tier. Off at sleep. Reallocates
   * the shadow maps only when the resolution actually changes.
   */
  applyTier(tier: QualityTier): void;
  dispose(): void;
};

/**
 * Build the city's sun and fill light. The three cascade lights are
 * created but NOT yet added to any scene — call `addToScene(worldScene)`
 * exactly once to wire them in. `castShadow` is already true on each
 * cascade; whether the shadow map actually renders depends on the
 * renderer's shadowMap settings and the current tier.
 */
export function createCitySun(opts: CitySunOptions = {}): CitySun {
  // `area` is retained as a compat hook — if the caller pins the FAR
  // cascade's radius, we respect it; otherwise the cascade ladder's
  // own constant [40, 250, 2000] wins.
  const farRadiusOverride = opts.area;
  const highMapSize = opts.mapSize ?? cascadeMapSizeForTier("high");
  const hemiIntensity = opts.hemiIntensity ?? 0.35;

  const target = new THREE.Object3D();

  // Aggregate sun state — updated per-frame from the pure sunColorAt /
  // sunIntensityAt curves; the cascade lights read a THIRD of each so
  // their SUM matches this aggregate.
  const sunColor = new THREE.Color(1, 1, 1);
  const sunPosition = new THREE.Vector3();
  let sunIntensity = 1;

  const cascades: THREE.DirectionalLight[] = [];
  for (let i = 0; i < CSM_CASCADE_COUNT; i += 1) {
    const light = new THREE.DirectionalLight(0xffffff, 1 / CSM_CASCADE_COUNT);
    light.castShadow = true;
    light.shadow.mapSize.set(highMapSize, highMapSize);
    light.shadow.bias = cascadeBiasFor(i);
    light.shadow.normalBias = cascadeNormalBiasFor(i);
    // PCSS-approx contact hardening — per-cascade radius (texels).
    light.shadow.radius = cascadeShadowRadiusFor(i);

    const radius = i === CSM_CASCADE_COUNT - 1 && farRadiusOverride !== undefined
      ? farRadiusOverride
      : cascadeRadiusFor(i);
    const cam = light.shadow.camera as THREE.OrthographicCamera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.5;
    // Far plane must comfortably bracket the sun's placement distance
    // scaled by the cascade radius — the FAR cascade sits 2000 m away
    // from the target, so its shadow camera's far plane runs deeper.
    cam.far = CITY_SUN_DISTANCE * 3 + radius * 2;
    cam.updateProjectionMatrix();

    light.target = target;
    cascades.push(light);
  }

  // `light` alias — the FAR cascade. The legacy accessor for callers
  // that only need one directional light reference (godray projection,
  // cloud sun-direction, external overrides). Its .color / .intensity
  // reflect only 1/3 of the total sun — use the aggregate accessors
  // (`sunColor` / `sunIntensity`) for that.
  const light = cascades[CSM_CASCADE_COUNT - 1];

  // Hemisphere fill — sky colour above, ground below. Colours are placed
  // here as the "default day" values; update() rewrites them from the
  // sun's current warmth so dusk falls warmer under the towers.
  const hemi = new THREE.HemisphereLight(0xa9c6ec, 0x3b3226, hemiIntensity);

  const cache = { slot: -1 };

  return {
    light,
    cascades,
    hemi,
    target,
    get sunColor() { return sunColor; },
    get sunIntensity() { return sunIntensity; },
    get sunPosition() { return sunPosition; },
    addToScene(root: THREE.Object3D) {
      for (const c of cascades) root.add(c);
      root.add(target);
      root.add(hemi);
    },
    update(dayFraction: number, centerXZ?: { x: number; z: number }) {
      // Quantise so we skip identical rewrites within the same 1/128 of a
      // day. The shadow camera's updateMatrixWorld is cheap but the ramp
      // is a curve — nothing about it changes between the frames inside a
      // single slot.
      const slot = Math.floor(((dayFraction % 1) + 1) % 1 * 128);
      const cx = centerXZ?.x ?? 0;
      const cz = centerXZ?.z ?? 0;
      target.position.set(cx, 0, cz);
      target.updateMatrixWorld();

      if (slot === cache.slot) return;
      cache.slot = slot;

      const dir = sunDirection(dayFraction);
      // Aggregate sun state — the value external effects (cloud,
      // godray) read for their own tinting.
      const col = sunColorAt(dayFraction);
      sunColor.copy(col);
      sunIntensity = sunIntensityAt(dayFraction);
      sunPosition.set(
        cx + dir.x * CITY_SUN_DISTANCE,
        Math.max(2, dir.y * CITY_SUN_DISTANCE),   // never below ground plane
        cz + dir.z * CITY_SUN_DISTANCE,
      );

      // Per-cascade updates: same direction, same colour, each carries
      // 1/N of the aggregate intensity. Cascade positions all sit on
      // the same ray toward the sun — the shadow-camera frustum
      // difference is what makes each cover a different scale.
      const perCascadeIntensity = sunIntensity / CSM_CASCADE_COUNT;
      for (let i = 0; i < cascades.length; i += 1) {
        const c = cascades[i];
        c.position.copy(sunPosition);
        c.color.copy(sunColor);
        c.intensity = perCascadeIntensity;
        c.shadow.camera.updateProjectionMatrix();
      }

      // Hemisphere colours track the sun: sky warms at dusk, ground grows
      // cool at midnight so the settlement never reads as a flat monochrome.
      const alt = sunAltitude(dayFraction);
      if (alt > 0) {
        // day — sky blue with a warm tint that peaks at dusk/dawn
        const dawn = Math.max(0, 1 - alt / (Math.PI * 0.25));
        hemi.color.setRGB(
          0.55 + dawn * 0.35,
          0.62 + dawn * 0.10,
          0.86 - dawn * 0.32,
        );
        hemi.groundColor.setRGB(0.22, 0.18, 0.14);
      } else {
        // night — cool indigo above, colder ground
        hemi.color.setRGB(0.08, 0.10, 0.20);
        hemi.groundColor.setRGB(0.04, 0.05, 0.09);
      }
    },
    applyTier(tier: QualityTier) {
      const wantMap = cascadeMapSizeForTier(tier);
      for (const c of cascades) {
        if (wantMap === 0) {
          c.castShadow = false;
        } else {
          c.castShadow = true;
          if (c.shadow.mapSize.x !== wantMap) {
            c.shadow.mapSize.set(wantMap, wantMap);
            // Force reallocation of the shadow map at the new size.
            const map = c.shadow.map as { dispose?: () => void } | null;
            if (map && typeof map.dispose === "function") {
              try { map.dispose(); } catch { /* noop */ }
            }
            c.shadow.map = null;
          }
        }
      }
    },
    dispose() {
      for (const c of cascades) {
        const map = c.shadow.map as { dispose?: () => void } | null;
        if (map && typeof map.dispose === "function") {
          try { map.dispose(); } catch { /* noop */ }
        }
        c.shadow.map = null;
      }
    },
  };
}
