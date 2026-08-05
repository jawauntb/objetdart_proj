/**
 * city-sun — the diurnal light of /city, as a real DirectionalLight.
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
 * The light casts PCF soft shadows. The shadow camera is an orthographic
 * frustum sized to the settlement (default 260 units — enough to hold the
 * whole visitor-drawable area plus the iconic event tower's cast shadow).
 * Bias values were tuned against a 200-unit-tall placeholder box on a plane
 * at y=0: normalBias 0.05 stops acne at the base of the tower without leaving
 * peter-panning at the rooftop, and bias -0.0002 pulls the ground-plane
 * self-shadow in tight. Shadow-map size follows the tier: 2048 at high,
 * 1024 at medium, 512 at low, off at sleep (the light still casts but the
 * receiver's material won't sample if shadowMap is disabled at renderer
 * level).
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
 * Options for creating the city sun. Any of these may be omitted and
 * sensible defaults land — the room's default camera and its default
 * quality tier are the tuning target.
 */
export type CitySunOptions = {
  /** Half-size of the shadow-camera orthographic frustum, in world units. */
  area?: number;
  /** Shadow map resolution. Round to a power of two. */
  mapSize?: number;
  /** Hemisphere fill light amplitude. 0 disables the fill light entirely. */
  hemiIntensity?: number;
};

/**
 * The bundled sun the city hangs off. `light` is the directional; `hemi`
 * is a hemisphere fill that keeps the shadow side of a facade from going
 * to pure black (adjusting toward the sky/ground colours the city-sky
 * module provides). `target` is the group the shadow camera looks at —
 * moving it lets the shadow frustum follow the camera at wide zooms.
 */
export type CitySun = {
  light: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  target: THREE.Object3D;
  /**
   * Reposition and recolour the sun for a given dayFraction. `centerXZ`
   * is the world-space (x, z) point the shadow frustum should follow;
   * default is (0, 0).
   */
  update(dayFraction: number, centerXZ?: { x: number; z: number }): void;
  /**
   * Adjust shadow map size and quality by tier. Off at sleep / low.
   */
  applyTier(tier: QualityTier): void;
  dispose(): void;
};

/**
 * Build the city's sun and fill light. Adds nothing to any scene — the
 * caller places `light`, `light.target`, `hemi`, and `target` where the
 * scene graph expects them. `light.castShadow` is already true; whether
 * the shadow map actually renders depends on the renderer's shadowMap
 * settings and the tier.
 */
export function createCitySun(opts: CitySunOptions = {}): CitySun {
  const area = opts.area ?? 260;
  const mapSize = opts.mapSize ?? 2048;
  const hemiIntensity = opts.hemiIntensity ?? 0.35;

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  // PCF soft shadow tuning. These values were checked against a placeholder
  // 200-unit tower on a plane at y=0: normalBias handles the slope-scale
  // problem on tall vertical facades, bias handles the ground-plane self-
  // shadow near noon.
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.05;
  light.shadow.radius = 4;
  // Orthographic shadow camera sized to the settlement.
  const cam = light.shadow.camera as THREE.OrthographicCamera;
  cam.left = -area;
  cam.right = area;
  cam.top = area;
  cam.bottom = -area;
  cam.near = 0.5;
  cam.far = CITY_SUN_DISTANCE * 3;
  cam.updateProjectionMatrix();

  const target = new THREE.Object3D();
  light.target = target;

  // Hemisphere fill — sky colour above, ground below. Colours are placed
  // here as the "default day" values; update() rewrites them from the
  // sun's current warmth so dusk falls warmer under the towers.
  const hemi = new THREE.HemisphereLight(0xa9c6ec, 0x3b3226, hemiIntensity);

  const cache = { slot: -1 };

  return {
    light,
    hemi,
    target,
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
      light.position.set(
        cx + dir.x * CITY_SUN_DISTANCE,
        Math.max(2, dir.y * CITY_SUN_DISTANCE),   // never below ground plane
        cz + dir.z * CITY_SUN_DISTANCE,
      );
      const col = sunColorAt(dayFraction);
      light.color.copy(col);
      light.intensity = sunIntensityAt(dayFraction);

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

      light.shadow.camera.updateProjectionMatrix();
    },
    applyTier(tier: QualityTier) {
      const wantMap =
        tier === "high" ? mapSize :
        tier === "medium" ? Math.max(512, Math.floor(mapSize * 0.5)) :
        0;
      if (wantMap === 0) {
        light.castShadow = false;
      } else {
        light.castShadow = true;
        if (light.shadow.mapSize.x !== wantMap) {
          light.shadow.mapSize.set(wantMap, wantMap);
          // Force reallocation of the shadow map at the new size.
          const map = light.shadow.map as { dispose?: () => void } | null;
          if (map && typeof map.dispose === "function") {
            try { map.dispose(); } catch { /* noop */ }
          }
          light.shadow.map = null;
        }
      }
    },
    dispose() {
      const map = light.shadow.map as { dispose?: () => void } | null;
      if (map && typeof map.dispose === "function") {
        try { map.dispose(); } catch { /* noop */ }
      }
      light.shadow.map = null;
    },
  };
}
