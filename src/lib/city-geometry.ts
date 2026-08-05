/**
 * city-geometry — the compound 3D skyline for /city.
 *
 * Forty-eight plots rise from a horizontal ground plane. Each civic role
 * is assembled from role-shaped Meshes rather than a single unit box, so
 * the settlement finally reads the way the brief calls for it:
 *
 *   home  → BoxGeometry body + a 4-sided pitched roof + optional chimney.
 *           Roof pitch and chimney presence are seeded — a row of homes
 *           reads as a row of separate houses, not 48 identical prefabs.
 *
 *   store → BoxGeometry body + a flat parapet cornice at the top + a
 *           thin awning strip on the +Z face at the ground floor. Awning
 *           color drifts per seed across three cloth palettes.
 *
 *   event → LatheGeometry silhouette per seed variant:
 *             0. Gherkin — barrel taper with a rounded crown.
 *             1. Salesforce — straight shaft with an ellipsoid cap.
 *             2. Transamerica — cylinder into a four-sided pyramid.
 *           MeshPhysicalMaterial with transmission + iridescence +
 *           clearcoat — the SF/London glass. Each event tower carries
 *           its OWN emissive canvas (from `makeEmissiveWindowTexture`)
 *           so the curtain-wall pattern is deterministic per plot; the
 *           dusk moment glows one tower at a time, not all in lockstep.
 *
 *   tree  → CylinderGeometry trunk + Icosahedron canopy + a paved
 *           CircleGeometry plaza disc. A park reads as a park.
 *
 * Home / store / tree are still driven by InstancedMesh for perf: one
 * primary InstancedMesh per role for the body + one or two secondary
 * InstancedMeshes for the compound part (the roof, the parapet, the
 * plaza + canopy). Each secondary InstancedMesh shares the same instance
 * index as its primary body, so a single write in `writeInstance` sets
 * every part of the plot in lockstep.
 *
 * Event towers switch to per-plot Meshes. Their instance count is
 * bounded by MAX_PLOTS and in practice is small (an event is a rare
 * civic center); the freedom to pick a unique LatheGeometry per plot
 * and bind a unique CanvasTexture per plot is worth the draw calls. The
 * per-plot canvas is where the dusk emotional peak actually lives —
 * bloom in the composer catches each tower's warm windows on its own
 * schedule and produces the halo the brief calls the emotional core.
 *
 * Yaw snaps to the visitor-drawn street grid when a plot has a road
 * nearby. `plot.streetYaw` carries the nearest road's angle through
 * into `writeInstance`; when finite, the plot rotates to align its long
 * face along that street with a small ±2° seed jitter (so the field
 * doesn't stamp). Without a road, the plot falls back to the small
 * ±10° seed drift so an isolated plot still reads as organic and not
 * a rigid grid.
 *
 * The pure ladder laws — `heightForRole`, `footprintForRole`,
 * `colorForInstance`, `hashUnit`, `ROLE_COLOR` — do not change. The
 * dwell ladder in city.ts (home → store → event → tree) stays pinned
 * and `test-city-geometry.mjs` keeps the ordering strict.
 */

import * as THREE from "three";
import type { PlotRole } from "@/lib/city";
import { normToWorld } from "@/lib/city-camera";
import {
  drawEmissiveWindowCanvas,
  facadeMaterialFor,
  makeEmissiveWindowTexture,
} from "@/lib/city-facades";
import { emissiveIntensityForDay, litFractionForDay } from "@/lib/city-windows";

/** The shape of an instance's per-plot state. */
export type PlotInstance = {
  role: PlotRole;
  seed: number;
  /** Normalized x/y in [0,1] — the city.ts plot coordinate system. */
  x: number;
  y: number;
  sealed: boolean;
  /** Grow-in factor in [0,1]. 0 at plant time, 1 after growMs. */
  bornT: number;
  /** Nearest street angle in radians (atan2 of a road segment's dy/dx),
   *  or undefined/NaN when no road is close enough. When finite, the
   *  plot's yaw snaps to this axis so streets and buildings agree. */
  streetYaw?: number;
};

/** A role that has a rendered building. `empty` is not represented. */
export type BuildingRole = "home" | "store" | "event" | "tree";
export const BUILDING_ROLES: readonly BuildingRole[] = ["home", "store", "event", "tree"];

/** Per-role runtime slot. Kept flexible: `home / store / tree` use
 *  primary + secondary InstancedMeshes; `event` switches to per-plot
 *  Meshes. Consumers of this module (City.tsx) do NOT touch this shape
 *  directly — the `syncPlots / setDayFrac / setShadows / setEnvironment`
 *  methods on the parent `SkylineScene` are the public surface. */
export type SkylineRoleSlot = {
  role: BuildingRole;
  /** Root Object3D added to the scene. For instanced roles this is the
   *  primary body mesh; for event it is a Group of per-plot Meshes. */
  root: THREE.Object3D;
  peakIntensity: number;
};

export type SkylineScene = {
  scene: THREE.Scene;
  roles: Record<BuildingRole, SkylineRoleSlot>;
  ground: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  syncPlots(plots: readonly PlotInstance[]): void;
  setDayFrac(day: number): void;
  setEnvironment(env: THREE.Texture | null): void;
  setShadows(on: boolean): void;
  dispose(): void;
};

export type SkylineOptions = {
  maxInstances: number;
  shadows?: boolean;
};

/** Deterministic unit-float hash from a seed integer and a small salt. */
export function hashUnit(seed: number, salt: number): number {
  let n = ((seed | 0) ^ (salt * 0x9e3779b1)) >>> 0;
  n = Math.imul(n, 0x85ebca6b) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 0xc2b2ae35) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}

/**
 * The role → height ladder. Pinned by test-city-geometry.mjs:
 *   home  = 3.4..7.0
 *   store = 7.0..15
 *   event = 22..38
 *   tree  = 3.0..6.0
 * The ranges do NOT overlap so the causal ladder reads strictly.
 */
export function heightForRole(role: PlotRole, seed: number): number {
  const t = hashUnit(seed, 3);
  if (role === "home")  return 3.4 + t * 3.6;
  if (role === "store") return 7.0 + t * 8.0;
  if (role === "event") return 22 + t * 16;
  if (role === "tree")  return 3.0 + t * 3.0;
  return 0.5;
}

export function footprintForRole(role: PlotRole, seed: number): { sx: number; sz: number } {
  const t1 = hashUnit(seed, 7);
  const t2 = hashUnit(seed, 11);
  if (role === "home")  return { sx: 3.2 + t1 * 1.8, sz: 3.2 + t2 * 1.8 };
  if (role === "store") return { sx: 4.4 + t1 * 2.4, sz: 4.4 + t2 * 2.4 };
  if (role === "event") return { sx: 5.5 + t1 * 2.8, sz: 5.5 + t2 * 2.8 };
  if (role === "tree")  return { sx: 4.2 + t1 * 2.0, sz: 4.2 + t2 * 2.0 };
  return { sx: 1, sz: 1 };
}

export const ROLE_COLOR: Record<Exclude<PlotRole, "empty">, [number, number, number]> = {
  home:  [0.72, 0.52, 0.38],
  store: [0.78, 0.63, 0.44],
  event: [0.72, 0.80, 0.92],
  tree:  [0.30, 0.46, 0.26],
};

export function colorForInstance(role: PlotRole, seed: number, sealed: boolean): THREE.Color {
  const base = ROLE_COLOR[role === "empty" ? "home" : role];
  const c = new THREE.Color(base[0], base[1], base[2]);
  const hueDrift = (hashUnit(seed, 5) - 0.5) * 0.08;
  const satDrift = (hashUnit(seed, 17) - 0.5) * 0.10;
  const lightDrift = (hashUnit(seed, 19) - 0.5) * 0.06;
  c.offsetHSL(hueDrift, satDrift, lightDrift);
  const bright = 0.92 + hashUnit(seed, 9) * 0.16;
  c.multiplyScalar(bright * (sealed ? 1.10 : 1.0));
  return c;
}

// ── per-seed compound knobs ───────────────────────────────────────────────
//
// Cheap deterministic reads off the plot seed so a settlement's variety
// is legible without touching persistence. Every knob is pure.

/** Home roof pitch bucket: 0 = shallow, 1 = medium, 2 = steep. */
export type RoofPitch = 0 | 1 | 2;
export function roofPitchForSeed(seed: number): RoofPitch {
  const t = hashUnit(seed, 23);
  return t < 0.33 ? 0 : t < 0.72 ? 1 : 2;
}
/** Unit-height factor for the roof cone (roof height / body height). */
export function roofUnitHeightFor(pitch: RoofPitch): number {
  return pitch === 0 ? 0.18 : pitch === 1 ? 0.32 : 0.55;
}
/** Whether this home has a chimney. About 55% do. */
export function hasChimneyForSeed(seed: number): boolean {
  return hashUnit(seed, 29) < 0.55;
}

/** Event tower silhouette variant. 0 = Gherkin, 1 = Salesforce
 *  ellipsoid-cap, 2 = Transamerica four-sided pyramid. */
export type EventVariant = 0 | 1 | 2;
export function eventVariantForSeed(seed: number): EventVariant {
  const t = hashUnit(seed, 31);
  return t < 0.4 ? 0 : t < 0.75 ? 1 : 2;
}

// ── LatheGeometry profiles for event towers ─────────────────────────────
//
// Each profile is an array of Vector2(radius, y) with y in [0, 1]; the
// caller scales the Lathe up to the tower's full height. Bottom → top.

function gherkinProfilePoints(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const N = 20;
  for (let i = 0; i <= N; i += 1) {
    const y = i / N;
    // Sinusoidal swell — narrow base, widest at ~55%, taper to a crown.
    const swell = Math.sin(y * Math.PI) * 0.32;
    const taper = 1 - Math.max(0, (y - 0.85) / 0.15) ** 1.4 * 0.85;
    const r = (0.60 + swell) * taper;
    pts.push(new THREE.Vector2(Math.max(0.02, r), y));
  }
  return pts;
}

function ellipsoidCapProfilePoints(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(0.55, 0.0));
  pts.push(new THREE.Vector2(0.55, 0.05));
  pts.push(new THREE.Vector2(0.58, 0.15));
  pts.push(new THREE.Vector2(0.60, 0.35));
  pts.push(new THREE.Vector2(0.60, 0.60));
  pts.push(new THREE.Vector2(0.58, 0.75));
  pts.push(new THREE.Vector2(0.56, 0.82));
  const capN = 8;
  for (let i = 1; i <= capN; i += 1) {
    const t = i / capN;
    const y = 0.82 + t * 0.18;
    const r = 0.56 * Math.sqrt(Math.max(0, 1 - t * t));
    pts.push(new THREE.Vector2(Math.max(0.02, r), y));
  }
  return pts;
}

function pyramidProfilePoints(): THREE.Vector2[] {
  // Cylinder for 60% of the height, linear taper to a point. Combined
  // with radialSegments=4 in the Lathe this reads as Transamerica.
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(0.55, 0.0));
  pts.push(new THREE.Vector2(0.55, 0.60));
  pts.push(new THREE.Vector2(0.02, 1.0));
  return pts;
}

// ── shared PBR sub-materials (roof / awning / plaza / trunk / etc) ───────

function makeRoofMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x5A3728,
    roughness: 0.88,
    metalness: 0.06,
  });
}

function makeAwningMaterial(): THREE.MeshStandardMaterial {
  // Awning color is picked per-instance via setColorAt against a neutral
  // white base — the color drift below writes crimson/ochre/teal per plot.
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.02,
  });
}

/** Per-plot awning color, one of three cloth palettes chosen by seed. */
function awningColorFor(seed: number, out: THREE.Color): THREE.Color {
  const t = hashUnit(seed, 37);
  if (t < 0.34)      out.setRGB(0.62, 0.20, 0.22); // crimson
  else if (t < 0.68) out.setRGB(0.76, 0.54, 0.22); // ochre
  else               out.setRGB(0.24, 0.44, 0.48); // teal
  return out;
}

function makeParapetMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x9C8770,
    roughness: 0.86,
    metalness: 0.04,
  });
}

function makeChimneyMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x8A6455,
    roughness: 0.88,
    metalness: 0.03,
  });
}

function makePlazaMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x8E8578,
    roughness: 0.92,
    metalness: 0.02,
  });
}

function makeTrunkMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x5A3E2A,
    roughness: 0.95,
    metalness: 0.0,
  });
}

// ── emissive atlas dims (per role) ──────────────────────────────────────

const EMISSIVE_CANVAS_SIZE: Record<Exclude<PlotRole, "empty">, { w: number; h: number }> = {
  home:  { w: 128, h: 128 },
  store: { w: 128, h: 160 },
  event: { w: 128, h: 384 },
  tree:  { w: 4,   h: 4   },
};

const PEAK_EMISSIVE: Record<BuildingRole, number> = {
  home:  1.6,
  store: 1.8,
  event: 2.4,
  tree:  0.0,
};

/** 24 slots per day: the emissive canvas rebakes at each city-hour so
 *  the lit-window pattern shifts through dusk without a per-frame draw. */
const EMISSIVE_SLOTS_PER_DAY = 24;

// ── internal instanced-role bookkeeping ──────────────────────────────────

type InstancedBuildingSlot = {
  role: "home" | "store" | "tree";
  /** The wall-body InstancedMesh. Position/scale come from writeInstance. */
  primaryMesh: THREE.InstancedMesh;
  /** Wall material — shares one emissive canvas across every instance of
   *  the role (per-plot canvases would require onBeforeCompile UV-offset
   *  binding; for the shorter buildings the shared atlas reads fine). */
  wallMaterial: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  /** Extra parts (roof, parapet, awning, trunk, canopy, plaza). Each has
   *  its own InstancedMesh sharing the primary index; writeInstance sets
   *  every entry in lockstep. Some entries can be null (e.g. no awning
   *  for a bare store). */
  extras: ExtraInstanced[];
  emissiveCanvas: HTMLCanvasElement | null;
  emissiveTexture: THREE.CanvasTexture | null;
  lastBakeSlot: number;
  peakIntensity: number;
};

/** A secondary InstancedMesh keyed to the primary's index. */
type ExtraInstanced = {
  mesh: THREE.InstancedMesh;
  material: THREE.Material;
  /** When true, per-instance color is written by writeInstance (via a
   *  role-specific function). Otherwise the instance color stays white. */
  perInstanceColor: boolean;
  /** How to compute this extra's per-instance color from (role, seed). */
  colorFn?: (seed: number, out: THREE.Color) => THREE.Color;
  /** Predicate — return false to skip this extra for the given seed
   *  (e.g. only 55% of homes have chimneys, only 70% of stores have
   *  awnings). Skipping is done by writing a zero-scale matrix so the
   *  mesh is invisible for that instance. */
  presence?: (seed: number) => boolean;
  /** Per-instance Y-scale multiplier. Used for the roof: a home's roof
   *  height depends on the seeded pitch bucket. */
  yScaleFn?: (seed: number) => number;
};

// ── event tower per-plot bookkeeping ─────────────────────────────────────

type EventPlotSlot = {
  group: THREE.Group;
  mesh: THREE.Mesh | null;
  material: THREE.MeshPhysicalMaterial | null;
  emissiveCanvas: HTMLCanvasElement | null;
  emissiveTexture: THREE.CanvasTexture | null;
  seed: number;
  variant: EventVariant;
  lastBakeSlot: number;
};

// ── the scene ────────────────────────────────────────────────────────────

/**
 * Create the 3D skyline scene: compound per-role geometry, ground plane,
 * sun with PCF soft shadows, hemisphere ambient, ambient fill.
 */
export function createSkylineScene(opts: SkylineOptions): SkylineScene {
  const shadowsOn = opts.shadows !== false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fbccd, 0.0048);

  // ── ground plane ─────────────────────────────────────────────────
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

  // ── sun + hemi + ambient ─────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xfff2d4, 1.3);
  sun.position.set(60, 90, 40);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = shadowsOn;
  sun.shadow.mapSize.set(2048, 2048);
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

  const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x2a2015, 0.7);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);

  // ── build the InstancedMesh with the wall/body geometry ──────────
  //
  // BoxGeometry(1,1,1) translated so the base sits at y=0, top at y=1.
  // The instance matrix scales x/y/z to the plot's actual size.
  function unitBoxGeo(): THREE.BoxGeometry {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }

  function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, opts.maxInstances);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadowsOn;
    m.receiveShadow = shadowsOn;
    // Prime the color buffer so setColorAt can write into it later.
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < opts.maxInstances; i += 1) m.setColorAt(i, c);
    m.count = 0;
    return m;
  }

  // Prime a wall material with a shared emissive canvas + texture.
  function primeEmissive(mat: THREE.MeshStandardMaterial, role: BuildingRole)
    : { canvas: HTMLCanvasElement | null; texture: THREE.CanvasTexture | null }
  {
    if (role === "tree") return { canvas: null, texture: null };
    const dims = EMISSIVE_CANVAS_SIZE[role];
    const canvas = document.createElement("canvas");
    canvas.width = dims.w;
    canvas.height = dims.h;
    drawEmissiveWindowCanvas(role, 0, 0.25, canvas);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = texture;
    mat.emissiveIntensity = 0;
    mat.needsUpdate = true;
    return { canvas, texture };
  }

  // ── home role: box body + pitched cone roof + optional chimney ──
  const homeBodyGeo = unitBoxGeo();
  const homeWallMat = facadeMaterialFor("home", 0) as THREE.MeshStandardMaterial;
  const homeEmiss = primeEmissive(homeWallMat, "home");
  const homeBody = makeInstanced(homeBodyGeo, homeWallMat);
  scene.add(homeBody);

  // Roof is a 4-sided pyramidal cone. Base radius covers slightly more
  // than the unit box's half-width so the ridges land ABOVE the wall
  // corners. Rotate 45° about Y so the four ridges point AT the four
  // wall corners rather than midway across the faces. The base of the
  // cone is baked to sit at local y=0 (translate up by 0.5 so the built
  // ConeGeometry, which centers at y=0, has its base at y=0 and tip at
  // y=1). The instance matrix's Y-position then places that base at the
  // top of the plot's wall (world y = yScale) and its Y-scale stretches
  // the cone to the seeded pitch height.
  const homeRoofGeo = new THREE.ConeGeometry(0.72, 1.0, 4);
  homeRoofGeo.rotateY(Math.PI / 4);
  homeRoofGeo.translate(0, 0.5, 0);
  const homeRoofMat = makeRoofMaterial();
  const homeRoof = makeInstanced(homeRoofGeo, homeRoofMat);
  scene.add(homeRoof);

  // Chimney: a small box that sits on top of the roof at one corner.
  // Baked at y in [1.0..1.32] so its base sits at the wall top and its
  // shaft rises ~0.32 units into the roof space. The primary Y-scale
  // multiplies through — a taller house has a taller chimney, which
  // reads as proportional rather than out of place.
  const homeChimneyGeo = new THREE.BoxGeometry(0.12, 0.32, 0.12);
  homeChimneyGeo.translate(0.28, 1.16, 0.28);
  const homeChimneyMat = makeChimneyMaterial();
  const homeChimney = makeInstanced(homeChimneyGeo, homeChimneyMat);
  scene.add(homeChimney);

  // ── store role: box body + parapet + optional awning ────────────
  const storeBodyGeo = unitBoxGeo();
  const storeWallMat = facadeMaterialFor("store", 0) as THREE.MeshStandardMaterial;
  const storeEmiss = primeEmissive(storeWallMat, "store");
  const storeBody = makeInstanced(storeBodyGeo, storeWallMat);
  scene.add(storeBody);

  // Parapet — a thin ring on top. Slightly wider than the wall so it
  // reads as a real cornice rather than a bare box edge.
  const storeParapetGeo = new THREE.BoxGeometry(1.06, 0.08, 1.06);
  storeParapetGeo.translate(0, 1.04, 0); // sit just above the wall top
  const storeParapetMat = makeParapetMaterial();
  const storeParapet = makeInstanced(storeParapetGeo, storeParapetMat);
  scene.add(storeParapet);

  // Awning — a thin box extending past the +Z wall at the ground floor.
  const storeAwningGeo = new THREE.BoxGeometry(1.16, 0.04, 0.30);
  storeAwningGeo.translate(0, 0.16, 0.55);
  const storeAwningMat = makeAwningMaterial();
  const storeAwning = makeInstanced(storeAwningGeo, storeAwningMat);
  scene.add(storeAwning);

  // ── tree role: plaza disc + trunk + canopy ──────────────────────
  //
  // "Tree" is a small park: a paved circular plaza with a single
  // canopy tree in the center. The plot's plot-space is used for the
  // plaza extent; the tree sits on top.
  //
  // The plaza is a very shallow cylinder (or CircleGeometry — we use
  // a flat CircleGeometry so it doesn't cast a suspect z-buffer edge
  // when it sits at y≈0).
  const treePlazaGeo = new THREE.CircleGeometry(0.55, 24);
  treePlazaGeo.rotateX(-Math.PI / 2);
  treePlazaGeo.translate(0, 0.02, 0);
  const treePlazaMat = makePlazaMaterial();
  const treePlaza = makeInstanced(treePlazaGeo, treePlazaMat);
  scene.add(treePlaza);

  const treeTrunkGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.4, 8);
  // Base of trunk at y=0.02 (matches plaza), top at y=0.42.
  treeTrunkGeo.translate(0, 0.22, 0);
  const treeTrunkMat = makeTrunkMaterial();
  const treeTrunk = makeInstanced(treeTrunkGeo, treeTrunkMat);
  scene.add(treeTrunk);

  // Canopy — a slightly flattened icosphere for a natural leaf mass.
  const treeCanopyGeo = new THREE.IcosahedronGeometry(0.42, 1);
  treeCanopyGeo.scale(1.0, 0.85, 1.0);
  treeCanopyGeo.translate(0, 0.72, 0);
  const treeCanopyMat = facadeMaterialFor("tree", 0) as THREE.MeshStandardMaterial;
  const treeCanopy = makeInstanced(treeCanopyGeo, treeCanopyMat);
  scene.add(treeCanopy);

  // ── assemble instanced-role slots ────────────────────────────────

  const homeSlot: InstancedBuildingSlot = {
    role: "home",
    primaryMesh: homeBody,
    wallMaterial: homeWallMat,
    extras: [
      {
        mesh: homeRoof, material: homeRoofMat,
        perInstanceColor: false,
        // Roof height depends on seeded pitch bucket. Base ConeGeometry
        // has y in [-0.5..0.5]; after `rotateY(45°)` its base is at
        // y=-0.5, tip at y=0.5. We want the base at y=1.0 (top of body)
        // and to scale the height. We fold both into a per-instance
        // matrix built from the primary transform combined with
        // yScaleFn * pitchUnitHeight, and a Y translation so the base
        // touches the roof plane.
        yScaleFn: (seed: number) => roofUnitHeightFor(roofPitchForSeed(seed)),
      },
      {
        mesh: homeChimney, material: homeChimneyMat,
        perInstanceColor: false,
        presence: hasChimneyForSeed,
      },
    ],
    emissiveCanvas: homeEmiss.canvas,
    emissiveTexture: homeEmiss.texture,
    lastBakeSlot: -1,
    peakIntensity: PEAK_EMISSIVE.home,
  };

  const storeSlot: InstancedBuildingSlot = {
    role: "store",
    primaryMesh: storeBody,
    wallMaterial: storeWallMat,
    extras: [
      {
        mesh: storeParapet, material: storeParapetMat,
        perInstanceColor: false,
      },
      {
        mesh: storeAwning, material: storeAwningMat,
        perInstanceColor: true,
        colorFn: awningColorFor,
        presence: (seed: number) => hashUnit(seed, 47) < 0.7,
      },
    ],
    emissiveCanvas: storeEmiss.canvas,
    emissiveTexture: storeEmiss.texture,
    lastBakeSlot: -1,
    peakIntensity: PEAK_EMISSIVE.store,
  };

  // Tree's PRIMARY is the canopy — that's what per-instance color drift
  // (ROLE_COLOR.tree = green) should tint. Plaza (stone-gray) and trunk
  // (bark) are extras that keep their material color; they don't take
  // the per-instance color multiplier so the plaza never turns green.
  const treeSlot: InstancedBuildingSlot = {
    role: "tree",
    primaryMesh: treeCanopy,
    wallMaterial: treeCanopyMat,
    extras: [
      { mesh: treePlaza, material: treePlazaMat, perInstanceColor: false },
      { mesh: treeTrunk, material: treeTrunkMat, perInstanceColor: false },
    ],
    emissiveCanvas: null,
    emissiveTexture: null,
    lastBakeSlot: -1,
    peakIntensity: 0,
  };

  // ── event role: per-plot Meshes ─────────────────────────────────
  //
  // The tallest, most visible plots. Each event plot allocates its own
  // LatheGeometry silhouette + its own MeshPhysicalMaterial + its own
  // per-plot emissive canvas via makeEmissiveWindowTexture. Total
  // instance count is bounded by MAX_PLOTS; in practice a settlement
  // rarely has more than a handful of events.
  const eventRoot = new THREE.Group();
  eventRoot.name = "citySkylineEvents";
  scene.add(eventRoot);
  const eventSlots: EventPlotSlot[] = [];
  for (let i = 0; i < opts.maxInstances; i += 1) {
    const group = new THREE.Group();
    group.visible = false;
    eventRoot.add(group);
    eventSlots.push({
      group, mesh: null, material: null,
      emissiveCanvas: null, emissiveTexture: null,
      seed: 0, variant: 0, lastBakeSlot: -1,
    });
  }

  function buildEventTower(slot: EventPlotSlot, seed: number, shadowsActive: boolean): void {
    // Free the previous tower's GL resources so a role/seed change
    // doesn't leak.
    if (slot.mesh) {
      slot.group.remove(slot.mesh);
      slot.mesh.geometry.dispose();
    }
    if (slot.material) slot.material.dispose();
    if (slot.emissiveTexture) slot.emissiveTexture.dispose();

    const variant = eventVariantForSeed(seed);
    slot.seed = seed;
    slot.variant = variant;
    slot.lastBakeSlot = -1;

    const profile = variant === 0 ? gherkinProfilePoints()
                  : variant === 1 ? ellipsoidCapProfilePoints()
                  : pyramidProfilePoints();
    const radial = variant === 2 ? 4 : 24;
    const geo = new THREE.LatheGeometry(profile, radial);

    // Material — MeshPhysicalMaterial via facadeMaterialFor("event").
    const mat = facadeMaterialFor("event", seed) as THREE.MeshPhysicalMaterial;
    const dims = EMISSIVE_CANVAS_SIZE.event;
    const emiss = makeEmissiveWindowTexture("event", seed, 0.6, { width: dims.w, height: dims.h });
    slot.emissiveCanvas = emiss.canvas;
    slot.emissiveTexture = emiss.texture;
    emiss.texture.wrapS = THREE.RepeatWrapping;
    emiss.texture.wrapT = THREE.ClampToEdgeWrapping;
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = emiss.texture;
    mat.emissiveIntensity = 0;
    mat.needsUpdate = true;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadowsActive;
    mesh.receiveShadow = shadowsActive;
    slot.group.add(mesh);
    slot.mesh = mesh;
    slot.material = mat;
  }

  // ── temporaries ──────────────────────────────────────────────────
  const _pos = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4();
  const _c = new THREE.Color();
  const _extraColor = new THREE.Color();

  // Compute the plot's yaw. Snap to street if streetYaw is finite; else
  // fall back to a small ±10° seed drift so an isolated plot reads as
  // organic and not gridded.
  function yawFor(plot: PlotInstance): number {
    const hint = plot.streetYaw;
    if (hint !== undefined && Number.isFinite(hint)) {
      const jitter = (hashUnit(plot.seed, 13) - 0.5) * 0.07; // ±2°
      return hint + jitter;
    }
    return (hashUnit(plot.seed, 13) - 0.5) * 0.35;           // ±10°
  }

  // Write one instance of an instanced-role plot: primary body matrix +
  // per-instance color, then every extra part in lockstep. Extras with
  // a `presence` predicate that returns false get a zero-scale matrix
  // so they render as nothing without needing a separate visibility
  // flag on the InstancedMesh.
  function writeInstancedPlot(
    slot: InstancedBuildingSlot,
    i: number,
    plot: PlotInstance,
  ): void {
    const w = normToWorld(plot.x, plot.y);
    const fullH = heightForRole(plot.role, plot.seed);
    const { sx, sz } = footprintForRole(plot.role, plot.seed);
    const yScale = Math.max(0.02, plot.bornT) * fullH;
    const yaw = yawFor(plot);

    // Primary body.
    _pos.set(w.x, 0, w.z);
    _q.setFromAxisAngle(_yAxis, yaw);
    _s.set(sx, yScale, sz);
    _m.compose(_pos, _q, _s);
    slot.primaryMesh.setMatrixAt(i, _m);
    _c.copy(colorForInstance(plot.role, plot.seed, plot.sealed));
    slot.primaryMesh.setColorAt(i, _c);

    // Extras. Two placement conventions live in the extras array:
    //
    //   (a) "ride-the-body": geometries pre-translated to their correct
    //       position within a unit-height wall (chimney at y≈1.16,
    //       parapet at y≈1.04, awning at y≈0.16, plaza at y≈0.02,
    //       trunk at y≈0.22). These take the plot's full yScale so
    //       taller buildings scale proportionally. yScaleFn = undefined.
    //
    //   (b) "sit-on-top": the roof cone. Base baked at local y=0, tip
    //       at local y=1. Its own Y-scale is the seeded pitch factor
    //       (0.18 / 0.32 / 0.55) times the plot's yScale. The extra's
    //       Y-position is yScale (the top of the wall) so the base
    //       lands there and the tip stretches upward by the pitch.
    //
    // Presence-gated extras (chimney on 55% of homes, awning on 70% of
    // stores) write a zero-scale matrix when skipped so the buffer
    // upload stays coherent — the mesh renders as nothing for that
    // instance without a separate visibility flag.
    for (const extra of slot.extras) {
      const skip = extra.presence ? !extra.presence(plot.seed) : false;
      if (skip) {
        _pos.set(w.x, 0, w.z);
        _s.set(0, 0, 0);
        _m.compose(_pos, _q, _s);
      } else if (extra.yScaleFn) {
        // Sit-on-top (roof).
        const roofY = extra.yScaleFn(plot.seed) * yScale;
        _pos.set(w.x, yScale, w.z);
        _s.set(sx, roofY, sz);
        _m.compose(_pos, _q, _s);
      } else {
        // Ride-the-body.
        _pos.set(w.x, 0, w.z);
        _s.set(sx, yScale, sz);
        _m.compose(_pos, _q, _s);
      }
      extra.mesh.setMatrixAt(i, _m);
      if (extra.perInstanceColor && extra.colorFn) {
        extra.colorFn(plot.seed, _extraColor);
        extra.mesh.setColorAt(i, _extraColor);
      }
    }
  }

  function commitInstancedSlot(slot: InstancedBuildingSlot, count: number): void {
    const c = Math.max(0, Math.min(opts.maxInstances, count));
    slot.primaryMesh.count = c;
    slot.primaryMesh.instanceMatrix.needsUpdate = true;
    if (slot.primaryMesh.instanceColor) slot.primaryMesh.instanceColor.needsUpdate = true;
    for (const extra of slot.extras) {
      extra.mesh.count = c;
      extra.mesh.instanceMatrix.needsUpdate = true;
      if (extra.mesh.instanceColor) extra.mesh.instanceColor.needsUpdate = true;
    }
  }

  // Write one event tower slot. Rebuilds its Lathe geometry if the
  // seed changed since last frame — the profile depends on
  // eventVariantForSeed, so a seed change is a shape change.
  function writeEventPlot(slot: EventPlotSlot, plot: PlotInstance, shadowsActive: boolean): void {
    if (!slot.mesh || slot.seed !== plot.seed) {
      buildEventTower(slot, plot.seed, shadowsActive);
    }
    const w = normToWorld(plot.x, plot.y);
    const fullH = heightForRole(plot.role, plot.seed);
    const { sx, sz } = footprintForRole(plot.role, plot.seed);
    const yScale = Math.max(0.02, plot.bornT) * fullH;
    const yaw = yawFor(plot);
    slot.group.position.set(w.x, 0, w.z);
    slot.group.rotation.set(0, yaw, 0);
    // Lathe profile y is in [0,1]; scale to full height. X/Z use the
    // plot's footprint (Lathe is symmetric so sx and sz produce a
    // slightly elliptical tower — reads as bespoke architecture rather
    // than a perfect cylinder).
    slot.group.scale.set(sx, yScale, sz);
    slot.group.visible = true;
    // Sealed towers brighten a touch — mirrors colorForInstance's rule.
    if (slot.material) {
      _c.copy(colorForInstance("event", plot.seed, plot.sealed));
      slot.material.color.copy(_c);
    }
  }

  let currentShadows = shadowsOn;

  const publicSlots: Record<BuildingRole, SkylineRoleSlot> = {
    home:  { role: "home",  root: homeSlot.primaryMesh,   peakIntensity: PEAK_EMISSIVE.home },
    store: { role: "store", root: storeSlot.primaryMesh,  peakIntensity: PEAK_EMISSIVE.store },
    event: { role: "event", root: eventRoot,              peakIntensity: PEAK_EMISSIVE.event },
    tree:  { role: "tree",  root: treeSlot.primaryMesh,   peakIntensity: PEAK_EMISSIVE.tree },
  };

  return {
    scene,
    roles: publicSlots,
    ground,
    sun,
    hemi,
    ambient,

    syncPlots(plots: readonly PlotInstance[]) {
      // Per-role write index. Home / store / tree route into their
      // InstancedMesh; event plots claim per-plot slots one at a time.
      let iHome = 0, iStore = 0, iTree = 0;
      let iEvent = 0;
      for (const plot of plots) {
        const r = plot.role;
        if (r === "empty") continue;
        if (r === "home"  && iHome  < opts.maxInstances) { writeInstancedPlot(homeSlot,  iHome++,  plot); continue; }
        if (r === "store" && iStore < opts.maxInstances) { writeInstancedPlot(storeSlot, iStore++, plot); continue; }
        if (r === "tree"  && iTree  < opts.maxInstances) { writeInstancedPlot(treeSlot,  iTree++,  plot); continue; }
        if (r === "event" && iEvent < opts.maxInstances) {
          writeEventPlot(eventSlots[iEvent], plot, currentShadows);
          iEvent += 1;
          continue;
        }
      }
      commitInstancedSlot(homeSlot,  iHome);
      commitInstancedSlot(storeSlot, iStore);
      commitInstancedSlot(treeSlot,  iTree);
      // Hide event slots beyond the live count.
      for (let k = iEvent; k < opts.maxInstances; k += 1) {
        eventSlots[k].group.visible = false;
      }
    },

    setDayFrac(day: number) {
      // ── sun position / color / intensity ────────────────────────
      const dNoon = Math.min(
        Math.abs(day - 0.25),
        Math.abs(day - 0.25 - 1),
        Math.abs(day - 0.25 + 1),
      );
      const alt = Math.max(0.02, 1 - dNoon * 2);
      const ang = day * Math.PI * 2 - Math.PI / 2;
      sun.position.set(Math.cos(ang) * 90, 15 + alt * 90, Math.sin(ang) * 90);
      const warmMix = 1 - alt;
      sun.color.setRGB(1.0, 0.68 + alt * 0.32, 0.42 + alt * 0.55);
      sun.intensity = 0.15 + alt * 1.35;
      hemi.intensity = 0.30 + alt * 0.55;
      const fog = scene.fog as THREE.FogExp2;
      const fr = 0.62 * alt + 0.14 * warmMix;
      const fg = 0.74 * alt + 0.20 * warmMix;
      const fb = 0.80 * alt + 0.28 * warmMix;
      fog.color.setRGB(fr, fg, fb);

      // ── emissive intensity per role ─────────────────────────────
      // Same shape as before: an eIdx from emissiveIntensityForDay
      // (0..1 after normalization), gated by litFractionForDay so
      // pre-dawn / mid-morning stay dark.
      const eIdx = emissiveIntensityForDay(day) / 1.6;
      const litBaseline = litFractionForDay(day, 0);
      const emitScale = Math.min(1, eIdx) * Math.max(litBaseline, eIdx * 0.35);
      (homeSlot.wallMaterial as THREE.MeshStandardMaterial).emissiveIntensity =
        emitScale * homeSlot.peakIntensity;
      (storeSlot.wallMaterial as THREE.MeshStandardMaterial).emissiveIntensity =
        emitScale * storeSlot.peakIntensity;
      for (const s of eventSlots) {
        if (!s.material) continue;
        s.material.emissiveIntensity = emitScale * PEAK_EMISSIVE.event;
      }

      // ── rebake emissive atlases on city-hour boundaries ─────────
      const hourSlot = Math.floor(day * EMISSIVE_SLOTS_PER_DAY);
      if (homeSlot.lastBakeSlot !== hourSlot && homeSlot.emissiveCanvas && homeSlot.emissiveTexture) {
        drawEmissiveWindowCanvas("home", 0, day, homeSlot.emissiveCanvas);
        homeSlot.emissiveTexture.needsUpdate = true;
        homeSlot.lastBakeSlot = hourSlot;
      }
      if (storeSlot.lastBakeSlot !== hourSlot && storeSlot.emissiveCanvas && storeSlot.emissiveTexture) {
        drawEmissiveWindowCanvas("store", 0, day, storeSlot.emissiveCanvas);
        storeSlot.emissiveTexture.needsUpdate = true;
        storeSlot.lastBakeSlot = hourSlot;
      }
      // Event towers: each has its OWN per-plot canvas keyed by its own
      // seed. Redraw them all when the hour slot advances.
      for (const s of eventSlots) {
        if (!s.emissiveCanvas || !s.emissiveTexture || !s.mesh) continue;
        if (s.lastBakeSlot === hourSlot) continue;
        s.lastBakeSlot = hourSlot;
        drawEmissiveWindowCanvas("event", s.seed, day, s.emissiveCanvas);
        s.emissiveTexture.needsUpdate = true;
      }
    },

    setEnvironment(env: THREE.Texture | null) {
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
      currentShadows = on;
      ground.receiveShadow = on;
      const flip = (m: THREE.InstancedMesh) => { m.castShadow = on; m.receiveShadow = on; };
      flip(homeSlot.primaryMesh);
      flip(homeRoof);
      flip(homeChimney);
      flip(storeSlot.primaryMesh);
      flip(storeParapet);
      flip(storeAwning);
      flip(treeSlot.primaryMesh);
      flip(treeTrunk);
      flip(treeCanopy);
      for (const s of eventSlots) {
        if (s.mesh) {
          s.mesh.castShadow = on;
          s.mesh.receiveShadow = on;
        }
      }
    },

    dispose() {
      const disposeInstanced = (im: THREE.InstancedMesh) => {
        try { im.geometry.dispose(); } catch { /* noop */ }
      };
      disposeInstanced(homeBody); disposeInstanced(homeRoof); disposeInstanced(homeChimney);
      disposeInstanced(storeBody); disposeInstanced(storeParapet); disposeInstanced(storeAwning);
      disposeInstanced(treePlaza); disposeInstanced(treeTrunk); disposeInstanced(treeCanopy);
      homeWallMat.dispose(); homeRoofMat.dispose(); homeChimneyMat.dispose();
      storeWallMat.dispose(); storeParapetMat.dispose(); storeAwningMat.dispose();
      treePlazaMat.dispose(); treeTrunkMat.dispose(); treeCanopyMat.dispose();
      if (homeEmiss.texture) try { homeEmiss.texture.dispose(); } catch { /* noop */ }
      if (storeEmiss.texture) try { storeEmiss.texture.dispose(); } catch { /* noop */ }
      for (const s of eventSlots) {
        if (s.mesh) { try { s.mesh.geometry.dispose(); } catch { /* noop */ } }
        if (s.material) s.material.dispose();
        if (s.emissiveTexture) try { s.emissiveTexture.dispose(); } catch { /* noop */ }
      }
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      if (sun.shadow.map) {
        try { sun.shadow.map.dispose(); } catch { /* noop */ }
      }
    },
  };
}
