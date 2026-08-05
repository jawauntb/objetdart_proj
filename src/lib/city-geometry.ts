/**
 * city-geometry — the role-split 3D skyline scene for /city.
 *
 * Forty-eight extruded prisms rise from a horizontal ground plane. Each civic
 * role (home / store / event / tree) is its own InstancedMesh with its own
 * PBR material — brownstones and mixed-use stucco read as diffuse warm bodies,
 * event towers read as real transmissive glass with iridescence and clearcoat
 * at grazing angles, the park canopy reads as a matte leaf mass. That means:
 *
 *   home   → MeshStandardMaterial (warm off-white plaster, rough)
 *   store  → MeshStandardMaterial (warmer stucco, slightly less rough)
 *   event  → MeshPhysicalMaterial (transmission + iridescence + clearcoat —
 *             the Gherkin/Salesforce/Transamerica lookup)
 *   tree   → MeshStandardMaterial (matte foliage green)
 *
 * The materials come from `facadeMaterialFor` in `city-facades.ts` — the
 * palette lives there, this file only assembles.
 *
 * Every non-tree role also carries an *emissive window atlas* — a small
 * canvas texture set as `material.emissiveMap`, drawn by
 * `drawEmissiveWindowCanvas` at the current dayFraction. As the hour advances
 * the canvas is rebaked (once per "city-hour" — 24 slots per day) so
 * `windowIsLit` decides which cells write warm tungsten and which stay dark.
 * Per-frame we then push a scalar `material.emissiveIntensity =
 * emissiveIntensityForDay(day)` — muted at noon (the sun does the work),
 * rising hard through dusk (where the composer's UnrealBloomPass lowers its
 * threshold to ~0.55 and the warm cells cross it), warm at midnight (a
 * scattering of lit blocks on a sleeping town). This is the dusk-and-glow
 * moment the brief calls the emotional core.
 *
 * Per-plot uniqueness lives in three orthogonal knobs:
 *   - color drift via `colorForInstance` and `mesh.setColorAt(i, …)` —
 *     the InstancedMesh's per-instance color multiplies against the shared
 *     material color, so 48 homes are 48 different browns.
 *   - height/footprint drift via `heightForRole` and `footprintForRole` —
 *     no two plots at the same role are the same size.
 *   - orientation drift (± ~10°) via a per-seed rotation.
 *
 * A future PR can push per-instance UV offsets into the emissiveMap via
 * `material.onBeforeCompile` so each plot samples its own tile from a
 * strip atlas — this file already exposes the infrastructure (the atlas
 * bake is per-role, but the atlas can be widened without touching callers).
 *
 * The dwell ladder (home → store → event → tree) stays pinned to city.ts;
 * this module only reads roles it is given and never mutates the ladder.
 * The tests in `test-city-geometry.mjs` pin the height ladder, footprint
 * ladder, color palette, and hash spread — every change here must keep
 * those green.
 */

import * as THREE from "three";
import type { PlotRole } from "@/lib/city";
import { normToWorld } from "@/lib/city-camera";
import {
  drawEmissiveWindowCanvas,
  facadeMaterialFor,
  WINDOW_GRIDS,
} from "@/lib/city-facades";
import { emissiveIntensityForDay, litFractionForDay } from "@/lib/city-windows";

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

/** A role that has its own InstancedMesh in the skyline. `empty` is not
 *  represented — those plots are simply not rendered. */
export type BuildingRole = "home" | "store" | "event" | "tree";
export const BUILDING_ROLES: readonly BuildingRole[] = ["home", "store", "event", "tree"];

/** Per-role runtime slot. Kept small on purpose — each role owns one
 *  InstancedMesh, one material, one emissive canvas + texture. */
export type SkylineRoleSlot = {
  role: BuildingRole;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  /** The canvas + texture that back the material's `emissiveMap`. Rebaked
   *  when the day slot advances (24 slots per day → once per "city-hour").
   *  Null for tree — no windows on a canopy. */
  emissiveCanvas: HTMLCanvasElement | null;
  emissiveTexture: THREE.CanvasTexture | null;
  /** The last (dayFraction slot, seed) pair the emissive canvas was baked
   *  at. Cheap change-detector — most frames early-out. */
  lastBakeSlot: number;
  /** The peak emissive intensity for this role at dusk. Glass towers push
   *  a little harder than a brownstone so a curtain wall reads. */
  peakIntensity: number;
};

export type SkylineScene = {
  scene: THREE.Scene;
  /** Per-role InstancedMesh + material + emissive atlas. Callers touch the
   *  meshes for `castShadow`/`receiveShadow` toggles and this object for
   *  environment IBL wiring. */
  roles: Record<BuildingRole, SkylineRoleSlot>;
  ground: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  /** Sync the whole plot list into the per-role InstancedMeshes: routes
   *  each plot to its role's mesh, writes the transform matrix and per-
   *  instance color, sets each mesh's `count` to only the live plots for
   *  that role. Replaces the old per-index `updateInstance` API. */
  syncPlots(plots: readonly PlotInstance[]): void;
  /** Advance the sun position / color / intensity for a given dayFraction
   *  (city.ts's 0..1 clock). Also rebakes emissive canvases on hour
   *  boundaries and pushes the per-frame `emissiveIntensity` scalar so
   *  the lit-window contribution rises through dusk. */
  setDayFrac(day: number): void;
  /** Attach a PMREM-prefiltered environment texture (the sky IBL) to the
   *  scene so glass towers reflect the sky and metal facades pick up
   *  ambient. Pass null to clear. */
  setEnvironment(env: THREE.Texture | null): void;
  /** Toggle shadow casting on all building meshes and the ground. Called
   *  from City.tsx on governor tier flips — low tier drops shadows. */
  setShadows(on: boolean): void;
  /** Dispose all owned GL resources. Called on unmount. */
  dispose(): void;
};

export type SkylineOptions = {
  /** Maximum number of building instances (across all roles combined).
   *  Each role gets an InstancedMesh sized to this maximum so a settlement
   *  can be all homes, or all towers, without a reallocation. */
  maxInstances: number;
  /** Whether to cast/receive shadows. Foundation-tier renderers may
   *  disable this for perf (low/sleep). */
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

// ── emissive atlas dims ─────────────────────────────────────────────────
//
// Emissive canvases are drawn at a size proportional to the role's window
// grid so a curtain-wall tower has real pixel density in its atlas and a
// brownstone stays crisp. Kept modest — the whole atlas is a texture
// upload once per hour, we don't want to churn the GPU.
const EMISSIVE_CANVAS_SIZE: Record<Exclude<PlotRole, "empty">, { w: number; h: number }> = {
  home:  { w: 128, h: 128 },
  store: { w: 128, h: 160 },
  event: { w: 128, h: 384 }, // taller because event towers are 14 rows × 6 cols
  tree:  { w: 4,   h: 4   }, // no windows; canvas exists only to keep the shape uniform
};

// Peak emissive intensity per role at dusk. Glass towers push harder so
// the curtain wall's tungsten crosses UnrealBloom's dusk threshold and
// blooms cleanly — the halo the brief calls the emotional peak. Brownstones
// glow more subtly, in keeping with a residential block at dusk.
const PEAK_EMISSIVE: Record<BuildingRole, number> = {
  home:  1.6,
  store: 1.8,
  event: 2.4,
  tree:  0.0,
};

// How many "city-hours" per day the emissive atlas rebakes at. 24 = the
// canvas re-draws once per city-hour of city-time, cheap and enough to
// track the dusk transition smoothly given the atlas is under bloom.
const EMISSIVE_SLOTS_PER_DAY = 24;

/**
 * Create the 3D skyline scene: per-role instanced buildings, ground plane,
 * sun, hemisphere ambient. The scene is a RenderPass in the composer chain
 * (see city-composer.ts). Caller owns the composer wiring; this module
 * owns everything with GL resources.
 */
export function createSkylineScene(opts: SkylineOptions): SkylineScene {
  const shadowsOn = opts.shadows !== false;
  const scene = new THREE.Scene();
  // Fog eases the far edge of the ground plane into the sky, and its
  // color will be driven by dayFraction (or by the sky's horizon sample
  // in a later PR) to match the procedural sky. For now a neutral hazy
  // blue-grey — the world scene's fog is what drives the visible haze.
  scene.fog = new THREE.FogExp2(0x9fbccd, 0.0048);

  // ── ground plane ─────────────────────────────────────────────────
  // A 500×500 world-unit plane centered at origin, sunk 0.02 below y=0
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
  // Stand-in for the world scene's citySun. City.tsx currently drives
  // the frame's single directional light through worldScene.citySun and
  // sets this skyline sun's intensity to 0. Kept around so a future PR
  // can drive a role-specific rim light independently.
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
  // Stand-in for the HDR IBL wiring from citySky.environment — a hemi
  // is what fills the shadowed sides of a facade when environment IBL
  // isn't yet attached. City.tsx will call `setEnvironment` after mount
  // and this hemi drops in intensity accordingly.
  const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x2a2015, 0.7);
  scene.add(hemi);

  // Small ambient fill so the sides the sun misses never crush to black.
  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);

  // ── the per-role InstancedMesh + material + emissive atlas ─────────
  // Each role gets its own box geometry (translated so base=y=0) and its
  // own material from `facadeMaterialFor`. Non-tree roles carry an
  // emissive canvas atlas; the tree carries a stub canvas so the shape
  // stays uniform across the record.

  function buildRoleSlot(role: BuildingRole): SkylineRoleSlot {
    // Box geometry — the base of an unscaled unit box sits at y=0 after
    // the translate(0, 0.5, 0). Height/footprint come from the instance
    // matrix's scale factors, so a tower is a stretched box.
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);

    // Material — the PBR palette lives in city-facades. Seed 0 is a
    // canonical mid-drift base color; per-plot color variety comes from
    // `mesh.setColorAt(i, colorForInstance(...))` and multiplies through.
    const material = facadeMaterialFor(role, 0);
    // The emissive contribution comes from the map times the emissive
    // color times the emissiveIntensity scalar. We want the atlas's
    // warm cells to be the sole color driver (so a lit window reads as
    // warm tungsten, not warm × the material's own emissive tint), so
    // reset emissive to white here. The tree role has no emissive map,
    // so its emissive stays as facadeMaterialFor set it.
    let emissiveCanvas: HTMLCanvasElement | null = null;
    let emissiveTexture: THREE.CanvasTexture | null = null;
    if (role !== "tree") {
      const dims = EMISSIVE_CANVAS_SIZE[role];
      emissiveCanvas = document.createElement("canvas");
      emissiveCanvas.width = dims.w;
      emissiveCanvas.height = dims.h;
      // Draw once at day=0.25 (noon — no windows lit) so the material
      // starts with a clean atlas. The setDayFrac call from the tick
      // loop will rebake as the hour advances.
      drawEmissiveWindowCanvas(role, 0, 0.25, emissiveCanvas);
      emissiveTexture = new THREE.CanvasTexture(emissiveCanvas);
      emissiveTexture.colorSpace = THREE.SRGBColorSpace;
      emissiveTexture.magFilter = THREE.LinearFilter;
      emissiveTexture.minFilter = THREE.LinearMipmapLinearFilter;
      emissiveTexture.generateMipmaps = true;
      emissiveTexture.needsUpdate = true;
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveMap = emissiveTexture;
      material.emissiveIntensity = 0;
      material.needsUpdate = true;
    }

    const mesh = new THREE.InstancedMesh(boxGeo, material, opts.maxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = shadowsOn;
    mesh.receiveShadow = shadowsOn;
    // Prime the instanceColor array. setColorAt allocates the buffer on
    // first call, and we must set at least once before uploading.
    const initColor = new THREE.Color(1, 1, 1);
    for (let i = 0; i < opts.maxInstances; i += 1) {
      mesh.setColorAt(i, initColor);
    }
    mesh.count = 0;
    scene.add(mesh);

    return {
      role,
      mesh,
      material,
      emissiveCanvas,
      emissiveTexture,
      lastBakeSlot: -1,
      peakIntensity: PEAK_EMISSIVE[role],
    };
  }

  const roles: Record<BuildingRole, SkylineRoleSlot> = {
    home:  buildRoleSlot("home"),
    store: buildRoleSlot("store"),
    event: buildRoleSlot("event"),
    tree:  buildRoleSlot("tree"),
  };

  // Reusable temporaries so the sync path never allocates.
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4();
  const _c = new THREE.Color();

  function writeInstance(slot: SkylineRoleSlot, i: number, plot: PlotInstance): void {
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
    slot.mesh.setMatrixAt(i, _m);
    const col = colorForInstance(plot.role, plot.seed, plot.sealed);
    _c.copy(col);
    slot.mesh.setColorAt(i, _c);
  }

  function commit(slot: SkylineRoleSlot, count: number): void {
    slot.mesh.count = Math.max(0, Math.min(opts.maxInstances, count));
    slot.mesh.instanceMatrix.needsUpdate = true;
    if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true;
  }

  return {
    scene,
    roles,
    ground,
    sun,
    hemi,
    ambient,

    syncPlots(plots: readonly PlotInstance[]) {
      // Route each plot to its role's mesh. Per-role write index counts
      // how many of each role have been placed so a settlement of 20
      // homes + 15 stores + 8 events writes into distinct index ranges.
      // Roles missing from `plots` naturally end with count=0.
      const counts: Record<BuildingRole, number> = { home: 0, store: 0, event: 0, tree: 0 };
      for (const plot of plots) {
        const r = plot.role;
        if (r === "empty") continue;
        const slot = roles[r as BuildingRole];
        const i = counts[r as BuildingRole];
        if (i >= opts.maxInstances) continue;
        writeInstance(slot, i, plot);
        counts[r as BuildingRole] = i + 1;
      }
      commit(roles.home,  counts.home);
      commit(roles.store, counts.store);
      commit(roles.event, counts.event);
      commit(roles.tree,  counts.tree);
    },

    setDayFrac(day: number) {
      // ── sun position / color / intensity ────────────────────────
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
      // shader in city-sky.ts feeds a proper horizon color in.
      const fog = scene.fog as THREE.FogExp2;
      const fr = 0.62 * alt + 0.14 * warmMix;
      const fg = 0.74 * alt + 0.20 * warmMix;
      const fb = 0.80 * alt + 0.28 * warmMix;
      fog.color.setRGB(fr, fg, fb);

      // ── emissive intensity per role ────────────────────────────
      // The two dials the brief calls out drive this together. The
      // pure `emissiveIntensityForDay` is a 0..1.6 curve (muted at
      // noon, peaked at midnight) — we normalize it to a 0..1 fraction
      // and scale by the role's peak so a glass tower pushes harder
      // than a brownstone. The `litFractionForDay` is folded in as a
      // baseline gate: on hours where the city-wide lit fraction is
      // very low (mid-morning, deep pre-dawn) the emissive can't
      // exceed that fraction — matches the pinned law that windows
      // don't glow when they aren't lit.
      const eIdx = emissiveIntensityForDay(day) / 1.6;
      const litBaseline = litFractionForDay(day, 0);
      const emitScale = Math.min(1, eIdx) * Math.max(litBaseline, eIdx * 0.35);
      for (const role of BUILDING_ROLES) {
        if (role === "tree") continue;
        const slot = roles[role];
        slot.material.emissiveIntensity = emitScale * slot.peakIntensity;
      }

      // ── rebake the emissive atlases on hour boundaries ────────
      // 24 slots per day → once per city-hour. Cheap change-detector so
      // we don't redraw the canvases every frame; the atlas rebake is a
      // per-role canvas draw + one texture upload.
      const slot = Math.floor(day * EMISSIVE_SLOTS_PER_DAY);
      for (const role of BUILDING_ROLES) {
        if (role === "tree") continue;
        const s = roles[role];
        if (s.lastBakeSlot === slot) continue;
        s.lastBakeSlot = slot;
        if (s.emissiveCanvas && s.emissiveTexture) {
          drawEmissiveWindowCanvas(role, 0, day, s.emissiveCanvas);
          s.emissiveTexture.needsUpdate = true;
        }
      }
    },

    setEnvironment(env: THREE.Texture | null) {
      // Attaching the sky IBL to the skyline scene is what makes the
      // glass towers reflect the sky — the missing piece the brief
      // named: `skyline.scene.environment = citySky.environment` so
      // PMREM reaches the metal/glass event tower. Setting env clears
      // the placeholder hemisphere fill (the sky's low-frequency band
      // is what should fill shadowed sides) — otherwise the hemi
      // double-counts and dusk glass reads too bright.
      scene.environment = env;
      if (env) {
        hemi.intensity = 0.10;
        ambient.intensity = 0.04;
      } else {
        hemi.intensity = 0.70;
        ambient.intensity = 0.12;
      }
    },

    setShadows(on: boolean) {
      // The skyline's own sun is held at intensity 0 in City.tsx (the
      // world scene's citySun is the frame's single directional light),
      // so we do NOT flip sun.castShadow here — that would allocate a
      // shadow atlas the light never writes into. The building meshes
      // still get the castShadow flag flipped in case a future PR lights
      // the skyline scene independently.
      ground.receiveShadow = on;
      for (const role of BUILDING_ROLES) {
        const s = roles[role];
        s.mesh.castShadow = on;
        s.mesh.receiveShadow = on;
      }
    },

    dispose() {
      for (const role of BUILDING_ROLES) {
        const s = roles[role];
        s.mesh.geometry.dispose();
        (s.material as THREE.Material).dispose();
        if (s.emissiveTexture) {
          try { s.emissiveTexture.dispose(); } catch { /* noop */ }
        }
      }
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      if (sun.shadow.map) {
        try { sun.shadow.map.dispose(); } catch { /* noop */ }
      }
    },
  };
}
