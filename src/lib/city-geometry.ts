/**
 * city-geometry — the 3D skyline scene for /city.
 *
 * Forty-eight extruded prisms rise from a horizontal ground plane, each
 * one an instance of a single unit-box mesh. The role a plot has climbed
 * to on the dwell ladder (`home → store → event → tree`, whose thresholds
 * live in `src/lib/city.ts`) is what decides its height, footprint, and
 * base color — so a settlement of forty-eight homes reads as forty-eight
 * brownstones, a store row reads as a mixed-use band, and a sealed event
 * plot rises as an iconic tower against the sky.
 *
 * A per-instance seed drives a small orientation drift, a hue jitter
 * inside the role palette, and a brightness roll — 48 plots must read
 * as 48 individuals, not 48 identical prefabs. The seed is the same seed
 * the audio picks off (see `city-audio.ts`) so a plot's look, sound, and
 * behavior are all deterministic reads of the same tiny state vector.
 *
 * This module is the foundation the next PRs hang PBR facades, HDR sky
 * IBL, and lit-window bloom off. It is deliberately minimal here: one
 * InstancedMesh, one MeshStandardMaterial, one directional sun with PCF
 * soft shadows, one hemisphere ambient light. Every knob is a real
 * causal variable of the settlement.
 */

import * as THREE from "three";
import type { PlotRole } from "@/lib/city";
import { normToWorld } from "@/lib/city-camera";

/** The shape of an instance's per-plot state. Matches what `syncSkylineInstances`
 * in City.tsx reads off the `Plot` record — this file does not import Plot to
 * keep the geometry module free of persistence types. */
export type PlotInstance = {
  role: PlotRole;
  seed: number;
  /** Normalized x/y in [0,1] — the city.ts plot coordinate system. */
  x: number;
  y: number;
  sealed: boolean;
  /** Grow-in factor in [0,1]. 0 at plant time, 1 after growMs on the city
   * clock. The instance's Y-scale multiplies through this, so a newborn
   * plot RISES out of the plane rather than popping in. */
  bornT: number;
};

export type SkylineScene = {
  scene: THREE.Scene;
  mesh: THREE.InstancedMesh;
  ground: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  /** Write one instance's transform + color from the plot state.
   * Call in sequence for i = 0..count-1 during syncSkylineInstances. */
  updateInstance(i: number, plot: PlotInstance): void;
  /** Set the number of instances rendered. Must be called once per frame
   * after `updateInstance` writes so instanceMatrix/instanceColor upload. */
  setCount(n: number): void;
  /** Advance the sun position / color / intensity for a given dayFraction
   * (city.ts's 0..1 clock). Foundation for the procedural HDR sky in the
   * next PR — the sun's azimuth already walks the horizon; the light
   * temperature warms toward dawn and dusk. */
  setDayFrac(day: number): void;
  /** Dispose all owned GL resources. Called on unmount. */
  dispose(): void;
};

export type SkylineOptions = {
  /** Maximum number of building instances. Must match MAX_PLOTS in City.tsx. */
  maxInstances: number;
  /** Whether to cast/receive shadows. Foundation-tier renderers may
   * disable this for perf (low/sleep). */
  shadows?: boolean;
};

/**
 * Deterministic unit-float hash from a seed integer and a small salt.
 * Two calls with the same seed and different salts return two nearly
 * independent floats — used for height/footprint/hue/rotation jitter.
 */
export function hashUnit(seed: number, salt: number): number {
  let n = ((seed | 0) ^ (salt * 0x9e3779b1)) >>> 0;
  n = Math.imul(n, 0x85ebca6b) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 0xc2b2ae35) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}

/**
 * The role → height ladder. The dwell ladder in `city.ts` is:
 *   home  → store → event → tree
 * whose *dwell thresholds* stay pinned to the pure laws. Here we set the
 * physical height each role rises to when planted, so the visitor SEES
 * the ladder as a rising skyline:
 *   home  = 3.4..7.0 units  (a brownstone / 2-3 stories)
 *   store = 7.0..15   units  (a mixed-use block / 3-5 stories)
 *   event = 22..38    units  (a Gherkin / Salesforce silhouette)
 *   tree  = 3.0..6.0  units  (a park canopy over a small plaza)
 *
 * Test-city-geometry pins the ordering so a store is always taller than
 * every home and shorter than every event, no matter the seed.
 */
export function heightForRole(role: PlotRole, seed: number): number {
  const t = hashUnit(seed, 3);
  if (role === "home")  return 3.4 + t * 3.6;
  if (role === "store") return 7.0 + t * 8.0;
  if (role === "event") return 22 + t * 16;
  if (role === "tree")  return 3.0 + t * 3.0;
  return 0.5;
}

/**
 * The role → footprint ladder. Homes are the tightest, event towers the
 * boldest, trees a wide canopy. All values in world units. The two
 * dimensions vary independently on separate seed salts so the buildings
 * look like real blocks rather than cubes.
 */
export function footprintForRole(role: PlotRole, seed: number): { sx: number; sz: number } {
  const t1 = hashUnit(seed, 7);
  const t2 = hashUnit(seed, 11);
  if (role === "home")  return { sx: 3.2 + t1 * 1.8, sz: 3.2 + t2 * 1.8 };
  if (role === "store") return { sx: 4.4 + t1 * 2.4, sz: 4.4 + t2 * 2.4 };
  if (role === "event") return { sx: 5.5 + t1 * 2.8, sz: 5.5 + t2 * 2.8 };
  if (role === "tree")  return { sx: 4.2 + t1 * 2.0, sz: 4.2 + t2 * 2.0 };
  return { sx: 1, sz: 1 };
}

/** Base linear-space colors per role. The instance color drifts these
 * around by a small HSL offset so a row of homes reads as a variety of
 * warm brownstones rather than a stamp. */
export const ROLE_COLOR: Record<Exclude<PlotRole, "empty">, [number, number, number]> = {
  home:  [0.72, 0.52, 0.38], // warm brownstone brick
  store: [0.78, 0.63, 0.44], // deeper tan mixed-use facade
  event: [0.72, 0.80, 0.92], // cool glass tower
  tree:  [0.30, 0.46, 0.26], // canopy green
};

/**
 * Compute a per-instance color from role + seed + sealed flag. The tint
 * drifts by a small HSL offset and a small brightness jitter — enough
 * to distinguish 48 individuals without dissolving the role's identity.
 * A sealed plot brightens slightly so the room's one solemn act reads
 * from a distance.
 */
export function colorForInstance(role: PlotRole, seed: number, sealed: boolean): THREE.Color {
  const base = ROLE_COLOR[role === "empty" ? "home" : role];
  const c = new THREE.Color(base[0], base[1], base[2]);
  const hueDrift = (hashUnit(seed, 5) - 0.5) * 0.08;    // ±0.04 in H
  const satDrift = (hashUnit(seed, 17) - 0.5) * 0.10;   // ±0.05 in S
  const lightDrift = (hashUnit(seed, 19) - 0.5) * 0.06; // ±0.03 in L
  c.offsetHSL(hueDrift, satDrift, lightDrift);
  const bright = 0.92 + hashUnit(seed, 9) * 0.16;
  c.multiplyScalar(bright * (sealed ? 1.10 : 1.0));
  return c;
}

/**
 * Create the 3D skyline scene: instanced buildings, ground plane, sun,
 * hemisphere ambient. The scene is the second RenderPass in the composer
 * (the first is the ortho ground/sky shader). Caller owns the composer
 * wiring; this module owns everything with GL resources.
 */
export function createSkylineScene(opts: SkylineOptions): SkylineScene {
  const shadowsOn = opts.shadows !== false;
  const scene = new THREE.Scene();
  // Fog eases the far edge of the ground plane into the sky, and its
  // color will be driven by dayFraction in a later PR to match the
  // procedural sky. For now a neutral hazy blue-grey.
  scene.fog = new THREE.FogExp2(0x9fbccd, 0.0048);

  // ── ground plane ─────────────────────────────────────────────────
  // A 400×400 world-unit plane centered at origin, sunk 0.02 below y=0
  // so the base of a box instance sits FLUSH with the ground rather
  // than z-fighting it. Roughness high so the sun doesn't specular-flash
  // off the ground; metalness low so it reads as earth, not asphalt.
  const groundMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.42, 0.44, 0.40),
    roughness: 0.94,
    metalness: 0.02,
  });
  const groundGeo = new THREE.PlaneGeometry(500, 500);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = shadowsOn;
  scene.add(ground);

  // ── sun (directional light + PCF soft shadows) ───────────────────
  const sun = new THREE.DirectionalLight(0xfff2d4, 1.3);
  sun.position.set(60, 90, 40);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = shadowsOn;
  sun.shadow.mapSize.set(2048, 2048);
  // A slight negative bias eliminates the shadow-acne on the flat side
  // of the taller towers without producing peter-panning at the base.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 400;
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  scene.add(sun);
  scene.add(sun.target);

  // ── hemisphere ambient ───────────────────────────────────────────
  // Stand-in for the HDR IBL a later PR will bake from the procedural
  // sky. Sky color is a soft daylight blue, ground color a warm sepia
  // so the underside of a canopy or a roof edge picks up a hint of
  // reflected earth — cheap, and the eye reads it as "outdoors".
  const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x2a2015, 0.7);
  scene.add(hemi);

  // Small ambient fill so the sides the sun misses never crush to black.
  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);

  // ── instanced buildings ──────────────────────────────────────────
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // Shift the box so its base sits at y=0 (default box centers at 0.5).
  boxGeo.translate(0, 0.5, 0);
  const bldMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // multiplied by per-instance color
    roughness: 0.68,
    metalness: 0.14,
  });
  const mesh = new THREE.InstancedMesh(boxGeo, bldMat, opts.maxInstances);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = shadowsOn;
  mesh.receiveShadow = shadowsOn;
  // Prime the instanceColor array. setColorAt allocates the buffer on
  // first call, and we must set at least once before uploading.
  const _initColor = new THREE.Color(1, 1, 1);
  for (let i = 0; i < opts.maxInstances; i += 1) {
    mesh.setColorAt(i, _initColor);
  }
  mesh.count = 0;
  scene.add(mesh);

  // Reusable temporaries so the updateInstance path never allocates.
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4();
  const _c = new THREE.Color();

  return {
    scene,
    mesh,
    ground,
    sun,
    hemi,
    ambient,
    updateInstance(i: number, plot: PlotInstance) {
      const w = normToWorld(plot.x, plot.y);
      const fullH = heightForRole(plot.role, plot.seed);
      const { sx, sz } = footprintForRole(plot.role, plot.seed);
      // grow-in: y-scale rises with bornT so a newborn plot LIFTS from
      // the plane rather than popping in. Minimum 0.02 so a plot is
      // visible from the frame it lands, not the frame after.
      const yScale = Math.max(0.02, plot.bornT) * fullH;
      _p.set(w.x, 0, w.z);
      const rot = (hashUnit(plot.seed, 13) - 0.5) * 0.35; // ±10°
      _q.setFromAxisAngle(_yAxis, rot);
      _s.set(sx, yScale, sz);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      const col = colorForInstance(plot.role, plot.seed, plot.sealed);
      _c.copy(col);
      mesh.setColorAt(i, _c);
    },
    setCount(n: number) {
      mesh.count = Math.max(0, Math.min(opts.maxInstances, n));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    setDayFrac(day: number) {
      // Distance to noon on the wrapped 0..1 cycle. 0 at noon, 0.5 at
      // midnight — same shape the composer's bloom curve uses.
      const dNoon = Math.min(
        Math.abs(day - 0.25),
        Math.abs(day - 0.25 - 1),
        Math.abs(day - 0.25 + 1),
      );
      const alt = Math.max(0.02, 1 - dNoon * 2); // 1 at noon, 0 at midnight
      // Azimuth walks a full circle across the day; dawn is +X, dusk is -X.
      const ang = day * Math.PI * 2 - Math.PI / 2;
      const sunX = Math.cos(ang) * 90;
      const sunZ = Math.sin(ang) * 90;
      const sunY = 15 + alt * 90;
      sun.position.set(sunX, sunY, sunZ);
      // Sun color warms toward dawn and dusk (low alt), cools at midday.
      const warmMix = 1 - alt; // 0 at noon, 1 at horizon
      const r = 1.0;
      const g = 0.68 + alt * 0.32;
      const b = 0.42 + alt * 0.55;
      sun.color.setRGB(r, g, b);
      sun.intensity = 0.15 + alt * 1.35;
      hemi.intensity = 0.30 + alt * 0.55;
      // Fog cools slightly toward night — a stand-in until the sky
      // shader in the next PR feeds a proper horizon color in.
      const fog = scene.fog as THREE.FogExp2;
      const fr = 0.62 * alt + 0.14 * warmMix;
      const fg = 0.74 * alt + 0.20 * warmMix;
      const fb = 0.80 * alt + 0.28 * warmMix;
      fog.color.setRGB(fr, fg, fb);
    },
    dispose() {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      if (sun.shadow.map) {
        try { sun.shadow.map.dispose(); } catch { /* noop */ }
      }
      // Lights themselves hold no GL buffers directly beyond shadow maps.
    },
  };
}
