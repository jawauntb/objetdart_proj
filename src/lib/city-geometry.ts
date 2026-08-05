/**
 * city-geometry — the compound 3D skyline for /city.
 *
 * Forty-eight plots rise from a horizontal ground plane. Each civic role
 * is assembled from role-shaped Meshes rather than a single unit box, so
 * the settlement finally reads the way the brief calls for it:
 *
 *   home  → BoxGeometry body + a FLAT tarred rooftop with a raised
 *           parapet + optional HVAC condenser + optional wooden water
 *           tower. This is the SF / London / NYC roofline — real homes
 *           in those cities are flat-topped with rooftop equipment; the
 *           old 4-sided pitched cone read as a picture-book cottage and
 *           broke every reference in the brief. HVAC + water-tower
 *           presence are seeded off `hashUnit(seed, k)` with the same
 *           pattern `hasChimneyForSeed` uses, so a row of 48 homes still
 *           reads as 48 individuals — some bare, some cluttered, some
 *           carrying an iconic wooden tank against the sunset.
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
  makeWindowFrameGeometry,
  makeWindowFrameMaterial,
  windowFramePlacement,
  windowsPerPlot,
  WINDOW_FACES,
  WINDOW_FRAME_DEPTH_M,
  WINDOW_GRIDS,
  type FacadeAtlasSet,
  type WindowFace,
} from "@/lib/city-facades";
import { emissiveIntensityForDay, litFractionForDay } from "@/lib/city-windows";
import {
  hashUnit as hashUnitPure,
  eventVariantForSeed as eventVariantForSeedPure,
  type EventVariant as EventVariantPure,
} from "@/lib/city-geometry-pure";
import {
  buildEventTower as buildEventTowerParts,
  disposeBuiltEventTower,
  overlayGherkinDiamondMask,
  type BuiltEventTower,
} from "@/lib/city-towers";
import {
  buildFacadeAtlas,
  buildLeafTexture,
  leafTintForSeason,
  type FacadeAtlas,
  type LeafTexture,
} from "@/lib/city-textures";
import {
  applyCurtainWallShader,
  curtainWallTierFor,
  equatorRadiusForVariant,
  type CurtainWallHandle,
  type CurtainWallTier,
} from "@/lib/city-curtainwall";
import {
  createRooftopScene,
  type RooftopHost,
  type RooftopScene,
} from "@/lib/city-rooftop";
import {
  createStoreExtrasScene,
  type StoreExtraHost,
  type StoreExtrasScene,
} from "@/lib/city-store-extras";

// Re-export the pure helpers so existing importers of city-geometry
// continue to work unchanged — the split into city-geometry-pure.ts
// was a no-op at the module's public surface.
export type EventVariant = EventVariantPure;
export const hashUnit = hashUnitPure;
export const eventVariantForSeed = eventVariantForSeedPure;

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
  /** Update the LOD reference position — the camera, in world coords.
   *  Call this each frame BEFORE `syncPlots` so the next matrix write
   *  picks the correct near/far leaf variant per tree. Passing null
   *  falls back to always-near (matches the pre-LOD behaviour). */
  setLodCamera(pos: THREE.Vector3 | null): void;
  /** Update the seasonal leaf tint that multiplies through the shared
   *  leaf-cluster texture. Called from City.tsx when the season changes
   *  via the 3-finger twist. Spring is yellow-green, summer deep green,
   *  fall ochre, winter near-neutral (paired with treeFoliage(season)
   *  shrinking the canopy scale to bare-branch). */
  setSeason(season: "spring" | "summer" | "fall" | "winter"): void;
  dispose(): void;
};

export type SkylineOptions = {
  maxInstances: number;
  shadows?: boolean;
  /** Curtain-wall shader tier for event towers. Defaults to "high"
   *  when shadows are on (a scene already paying for PCF shadows can
   *  pay for a per-pane hash), "medium" when shadows are off
   *  (mullions only, no per-pane roughness or tint jitter). Pass
   *  explicit "low" to keep the current baked-atlas look. */
  curtainWallTier?: CurtainWallTier;
};

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
/** Whether this home has a chimney. About 55% do.
 *
 *  NOTE: The home's roof itself is now the flat-tarred variant with a
 *  parapet, HVAC box, and optional water tower — this predicate is kept
 *  because `test-city-geometry.mjs` pins its purity and seed-based
 *  distribution, and because `hasHvacForSeed` / `hasWaterTowerForSeed`
 *  reuse the same `hashUnit(seed, k)` shape. Chimneys are no longer
 *  rendered — the equipment on a real SF/London/NYC flat rooftop is
 *  HVAC condensers and wooden water tanks, not brick chimneys. */
export function hasChimneyForSeed(seed: number): boolean {
  return hashUnit(seed, 29) < 0.55;
}
/** Whether this home carries a rooftop HVAC condenser box. About 62% do.
 *
 *  Uses the same `hashUnit(seed, k)` pattern as `hasChimneyForSeed`, but
 *  a fresh k so the predicate is independent — a home with an HVAC unit
 *  may or may not also carry a water tower, and the row of 48 homes
 *  reads as 48 individuals rather than a lockstep on/off pair. */
export function hasHvacForSeed(seed: number): boolean {
  return hashUnit(seed, 31) < 0.62;
}
/** Whether this home carries a wooden rooftop water tower. About 34% do.
 *
 *  Water towers are iconic (NYC, and yes, London and SF too — you can
 *  see them on older mid-rise buildings). Rarer than HVAC, so a tank
 *  reads as a punctuation mark against the skyline rather than uniform
 *  rooftop clutter. Uses `hashUnit(seed, 37)` — same slot the awning
 *  color function reads from, but a different threshold decoding, so
 *  it remains independent of the home/store distinction. */
export function hasWaterTowerForSeed(seed: number): boolean {
  return hashUnit(seed, 41) < 0.34;
}

// EventVariant + eventVariantForSeed have moved to city-geometry-pure.ts
// so both this module and city-towers.ts can import them without a
// circular dep. Re-exported at the top for backward compat.

// The LatheGeometry event-tower profiles used to live here. They now
// live inside src/lib/city-towers.ts, where each profile is one of
// three real silhouettes: Gherkin (a lathe body with a diamond mullion
// mask), Salesforce (a four-step tapered cylinder stack capped by an
// ellipsoid crown), Transamerica (a four-sided pyramid with two wing
// prisms). The tallest 20% carry a spire. See city-towers.ts.

// ── shared PBR sub-materials (roof / awning / plaza / trunk / etc) ───────

/** The flat tar/asphalt roof deck — dark, matte, non-metal. Reads as
 *  a modern-membrane roof at wide zoom and as a tar-and-gravel deck at
 *  close zoom (the bird's-eye Currier & Ives frame catches the color as
 *  a warm-neutral dark against the awning + wall drift). */
function makeRoofDeckMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x2A2622,
    roughness: 0.94,
    metalness: 0.02,
  });
}

/** The home parapet — a raised stone-or-brick ring at the roof edge.
 *  Uses the same PBR profile as the store parapet (0x9C8770) so a row
 *  of homes and a row of stores share the cornice palette at dusk. */
function makeHomeParapetMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x9C8770,
    roughness: 0.86,
    metalness: 0.04,
  });
}

/** HVAC condenser — light metallic grey with a hint of specular. Real
 *  rooftop condensers are painted aluminum housings; the slight metal
 *  bump lets the sunset rake across the panels for a brief highlight
 *  in the composer's bloom pass. */
function makeHvacMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xB6B4AF,
    roughness: 0.55,
    metalness: 0.35,
  });
}

/** Wooden water tower — warm cedar/redwood plank color. Non-metallic,
 *  high-roughness so the tank catches sunset warmth without going
 *  spec-glossy the way a metal tank would. */
function makeWaterTowerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x8A5A34,
    roughness: 0.92,
    metalness: 0.04,
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

// ── flat rooftop geometry helpers (home role) ───────────────────────────
//
// The home flat-tar rooftop is assembled from three "ride-the-body"
// extras. Each is a BufferGeometry pre-translated into the unit-body
// coordinate frame — Y in [0..1] maps to world [0..yScale] once the
// primary body's (sx, yScale, sz) matrix scales the extra through.
// Geometries are shared across every home instance; per-plot variation
// comes from seed-gated presence, not per-instance geometry rewrites.
//
// Placement conventions inside the unit body [-0.5, +0.5] × [0, 1]:
//
//   ROOF DECK: solid slab at y ∈ [0.995, 1.010], covering the full
//              footprint. Sits just above the wall's top face so the
//              wall's facade texture doesn't z-fight the deck. Tar
//              color makes the deck read as a modern-membrane roof
//              from the bird's-eye Currier & Ives zoom.
//
//   PARAPET:   hollow rectangular ring, outer 1.02 × 1.02, inner
//              0.86 × 0.86, height 0.05 (world 0.15..0.35 m depending
//              on wall). Base at y = 1.010 so it sits on the deck.
//              Stone color matches the store parapet.
//
//   HVAC:      light-metal box, ~0.28 × 0.10 × 0.20 in unit space, off-
//              center at (+0.20, +1.06, -0.18) so it doesn't touch the
//              parapet ring or the water tower's tank.
//
//   WATER TWR: merged (tank + cap + 4 legs) rooftop water tank at
//              (-0.20, +1.00.. +1.35, +0.20). Wooden color, ~1.5 m tall
//              in world for a mid-height home. Rarer than HVAC — a
//              punctuation mark against the skyline at dusk.

/** Build the parapet ring as an ExtrudeGeometry with a rectangular hole
 *  in the middle. Outer edge sits slightly outside the wall (1.02 vs
 *  1.00) so from the plaza looking up, the parapet crown reads as a
 *  raised cornice line rather than an invisible edge. Extrudes along
 *  +Y after a -π/2 rotate about X. */
function makeHomeParapetGeometry(): THREE.BufferGeometry {
  const outer = 0.51;
  const inner = 0.43;
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo( outer, -outer);
  shape.lineTo( outer,  outer);
  shape.lineTo(-outer,  outer);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo( inner, -inner);
  hole.lineTo( inner,  inner);
  hole.lineTo(-inner,  inner);
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: false,
    steps: 1,
  });
  // ExtrudeGeometry extrudes the shape (in the XY plane) along +Z. We
  // want the parapet's height to run along +Y, so rotate the shape
  // plane down. After rotateX(-π/2): +Z (depth) → +Y, +Y (shape) → -Z
  // (which is fine — the shape is symmetric about the origin).
  geo.rotateX(-Math.PI / 2);
  // Sit the parapet on top of the roof deck: base at y = 1.010, crown
  // at y = 1.060.
  geo.translate(0, 1.010, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Build the roof-deck slab: a thin box that covers the full wall
 *  footprint and reads as tar/asphalt at close zoom. Y-thickness 0.015
 *  in unit space so it scales to a plausible 0.05..0.10 m in world. */
function makeHomeRoofDeckGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1.00, 0.015, 1.00);
  g.translate(0, 1.0025, 0); // top face at y = 1.010, base at y = 0.995
  return g;
}

/** Build the HVAC condenser: a single BoxGeometry offset toward one
 *  corner of the roof deck. Placed at (+0.20, ~1.06, -0.18) so it never
 *  overlaps the parapet ring (inner 0.86 wide → half 0.43 clearance)
 *  or the water tower's -X/+Z tank position. */
function makeHomeHvacGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.26, 0.10, 0.18);
  g.translate(0.20, 1.060, -0.18);
  return g;
}

/** Local geometry-merge helper — mirrors the tiny merger in
 *  city-pedestrians. Concatenates position + normal buffers of a small
 *  set of BufferGeometries into one flat non-indexed geometry so the
 *  water-tower (tank + cap + 4 legs) can live inside a single
 *  InstancedMesh extra. Cheaper than pulling in BufferGeometryUtils
 *  and avoids the third-party import dance. */
function mergeHomeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed: THREE.BufferGeometry[] = geos.map((g) => {
    const gi = g.index ? g.toNonIndexed() : g;
    if (!gi.attributes.normal) gi.computeVertexNormals();
    return gi;
  });
  let totalVerts = 0;
  for (const g of nonIndexed) totalVerts += g.attributes.position.count;
  const positions = new Float32Array(totalVerts * 3);
  const normals   = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of nonIndexed) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i += 1) {
      positions[(offset + i) * 3 + 0] = p.getX(i);
      positions[(offset + i) * 3 + 1] = p.getY(i);
      positions[(offset + i) * 3 + 2] = p.getZ(i);
      normals[(offset + i) * 3 + 0]   = n.getX(i);
      normals[(offset + i) * 3 + 1]   = n.getY(i);
      normals[(offset + i) * 3 + 2]   = n.getZ(i);
    }
    offset += p.count;
  }
  // Free the sub-geometries; nothing outside this call needs them.
  for (const g of geos) {
    try { g.dispose(); } catch { /* noop */ }
  }
  for (const g of nonIndexed) {
    if (!geos.includes(g)) {
      try { g.dispose(); } catch { /* noop */ }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return out;
}

/** Build the wooden water tower as a merged geometry: cylindrical tank
 *  + conical cap + 4 short leg posts. Sits at (-0.20, ~1.00 → 1.35,
 *  +0.20). The tank is 12-segment (cheap silhouette), the cap 12-
 *  segment matching. Legs are 4 tiny BoxGeometries under the tank so
 *  the tank appears raised — the iconic NYC skyline read. */
function makeHomeWaterTowerGeometry(): THREE.BufferGeometry {
  const cx = -0.20;
  const cz =  0.20;
  const legTop = 1.020;
  const legBase = 1.000;
  const tankBase = legTop;
  const tankTop = 1.300;
  const capTop  = 1.360;

  // Legs — 4 tiny box posts at the corners of a 0.20 square under the
  // tank. Height (legTop - legBase) = 0.020 unit → ~0.10 m world.
  const legOff = 0.11; // distance from tank centre to each leg
  const legGeo = (dx: number, dz: number) => {
    const g = new THREE.BoxGeometry(0.028, legTop - legBase, 0.028);
    g.translate(cx + dx, (legBase + legTop) * 0.5, cz + dz);
    return g;
  };
  const leg1 = legGeo(-legOff, -legOff);
  const leg2 = legGeo( legOff, -legOff);
  const leg3 = legGeo(-legOff,  legOff);
  const leg4 = legGeo( legOff,  legOff);

  // Tank — a 12-segment cylinder. Radius 0.13 in unit space →
  // ~0.4..0.9 m across depending on footprint sx. Height 0.28 unit.
  const tank = new THREE.CylinderGeometry(0.13, 0.13, tankTop - tankBase, 12, 1, false);
  tank.translate(cx, (tankBase + tankTop) * 0.5, cz);

  // Cap — conical roof for the tank. Radius matches the tank at the
  // base and tapers to 0 at capTop. 12 segments to match the tank so
  // the seam reads clean.
  const cap = new THREE.ConeGeometry(0.13, capTop - tankTop, 12);
  cap.translate(cx, (tankTop + capTop) * 0.5, cz);

  return mergeHomeGeometries([leg1, leg2, leg3, leg4, tank, cap]);
}

// ── tree geometry builders (branch skeleton + leaf-cluster quads) ───────
//
// Trees used to be a single flattened icosphere. Every reference photo the
// city is built against — SF's Marina park benches, London City's Postman's
// Park, any dusk-and-window plate the brief is chasing — shows a canopy as
// a cluster of leaf outlines standing on visible branch structure, not a
// smooth green solid. The icosphere read diorama at any zoom past mid
// (verifier R10-3 called it out) and no post-process pass could rescue
// that first read.
//
// The replacement is a real tree: 5 branch cylinders radiating from the
// top of the trunk into a canopy of transparent-alpha leaf-cluster quads,
// cross-oriented so no viewpoint sees the tree edge-on. Everything sits
// in unit space (y in [0, ~1.15]) and rides the plot's (sx, yScale, sz)
// scale matrix through — same convention as home/store extras — so a
// larger tree seed grows both taller AND broader in proportion.
//
// Two LOD steps: `treeLeavesNear` fires below the near threshold with all
// 12 leaf-cluster quads visible; `treeLeavesFar` fires beyond with a
// single Y-aligned billboard quad. The branch skeleton is cheap and stays
// on for every LOD; the leaves are the expensive part.

/** Vertex layout for a merged tree geometry: position, normal, uv. */
function mergeTreeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed: THREE.BufferGeometry[] = geos.map((g) => {
    const gi = g.index ? g.toNonIndexed() : g;
    if (!gi.attributes.normal) gi.computeVertexNormals();
    if (!gi.attributes.uv) {
      // Pad a zero uv so the merged buffer is a rectangle — some sub-
      // geos (cylinders) already have uvs, some (cross-quads authored
      // by hand) already have them too, but any missing uv would break
      // the merge. Compute a default (0,0) uv so the attribute always
      // exists.
      const zeros = new Float32Array(gi.attributes.position.count * 2);
      gi.setAttribute("uv", new THREE.BufferAttribute(zeros, 2));
    }
    return gi;
  });
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const positions = new Float32Array(total * 3);
  const normals   = new Float32Array(total * 3);
  const uvs       = new Float32Array(total * 2);
  let off = 0;
  for (const g of nonIndexed) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    for (let i = 0; i < p.count; i += 1) {
      positions[(off + i) * 3 + 0] = p.getX(i);
      positions[(off + i) * 3 + 1] = p.getY(i);
      positions[(off + i) * 3 + 2] = p.getZ(i);
      normals[(off + i) * 3 + 0] = n.getX(i);
      normals[(off + i) * 3 + 1] = n.getY(i);
      normals[(off + i) * 3 + 2] = n.getZ(i);
      uvs[(off + i) * 2 + 0] = u.getX(i);
      uvs[(off + i) * 2 + 1] = u.getY(i);
    }
    off += p.count;
  }
  for (const g of geos) { try { g.dispose(); } catch { /* noop */ } }
  for (const g of nonIndexed) {
    if (!geos.includes(g)) { try { g.dispose(); } catch { /* noop */ } }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal",   new THREE.BufferAttribute(normals, 3));
  out.setAttribute("uv",       new THREE.BufferAttribute(uvs, 2));
  return out;
}

/**
 * Positions of the leaf-cluster stamps in unit tree space. Six stamps —
 * one crown, five around it — deterministic so a Y-billboard fallback
 * can hit the same footprint the near LOD stakes out.
 */
export const TREE_LEAF_CLUSTER_POSITIONS: readonly {
  x: number; y: number; z: number;
}[] = (() => {
  const out: { x: number; y: number; z: number }[] = [];
  // Crown — one leaf stamp sitting on top of the canopy centre. Reads as
  // the tree's high point when the light rakes across it at dusk.
  out.push({ x: 0.00, y: 0.90, z: 0.00 });
  // Five stamps around the crown at radius ~0.30 in unit space (→ ~1.5m
  // world once (sx = sz ≈ 4-6) multiply through). Angles 72° apart so
  // the canopy reads round from directly above.
  const r = 0.30;
  for (let k = 0; k < 5; k += 1) {
    const th = (k / 5) * Math.PI * 2 + 0.4;
    // Y jitter so the outer clusters don't sit on a perfect ring — the
    // eye reads a slight varying height as "leaves reaching for light".
    const yOffset = 0.55 + (Math.sin(k * 1.7) * 0.5 + 0.5) * 0.28;
    out.push({ x: Math.cos(th) * r, y: yOffset, z: Math.sin(th) * r });
  }
  return out;
})();

/**
 * Build the branch skeleton — trunk stub already exists as `treeTrunk`,
 * but this geometry adds five short branches radiating outward and up
 * from the top of the trunk. The trunk itself is not repeated here so
 * shadow-caster count stays low. Returns a merged BufferGeometry with
 * (position, normal, uv) — bark UVs on each cylinder.
 */
export function buildTreeBranchGeometry(): THREE.BufferGeometry {
  const trunkTopY = 0.42; // where the existing treeTrunk ends
  const pieces: THREE.BufferGeometry[] = [];
  // Five branches. Each branch is a short cylinder from the trunk top
  // out toward the corresponding leaf-cluster position (skip the crown
  // stamp — the trunk itself carries the crown).
  const branchRadius = 0.028;
  for (let k = 0; k < 5; k += 1) {
    const tip = TREE_LEAF_CLUSTER_POSITIONS[k + 1]; // skip crown
    const base = { x: 0, y: trunkTopY, z: 0 };
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const dz = tip.z - base.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    // Cylinder created along +Y from y=0..len. Rotate to align with
    // (dx,dy,dz) then translate to base.
    const g = new THREE.CylinderGeometry(branchRadius * 0.6, branchRadius, len, 6, 1, false);
    // Cylinder is centred at y=len/2 with axis along +Y. Translate so
    // its base sits at y=0, then rotate to align +Y with the tip vector,
    // then move to the trunk top.
    g.translate(0, len / 2, 0);
    // Rotation: find the rotation quaternion from +Y to the tip vector.
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate(base.x, base.y, base.z);
    pieces.push(g);
  }
  return mergeTreeGeometries(pieces);
}

/**
 * Build the "near" leaf-cluster geometry — 12 crossed quads (2 per
 * cluster stamp position) so a viewer at ground level always sees some
 * leaves face-on regardless of yaw around the tree. Each quad carries
 * a full [0,1]² uv so the leaf-cluster texture maps once per quad.
 */
export function buildTreeLeavesNearGeometry(): THREE.BufferGeometry {
  const quadSize = 0.55; // unit space; scaled through by (sx, yScale, sz)
  const pieces: THREE.BufferGeometry[] = [];
  for (const p of TREE_LEAF_CLUSTER_POSITIONS) {
    // Two crossed quads at 90° yaw offset.
    for (let axis = 0; axis < 2; axis += 1) {
      const g = new THREE.PlaneGeometry(quadSize, quadSize, 1, 1);
      // Rotate by axis * 90° around Y so the two quads intersect
      // through the cluster centre — a classic cross-tree cheat.
      g.rotateY(axis === 0 ? 0 : Math.PI / 2);
      g.translate(p.x, p.y, p.z);
      pieces.push(g);
    }
  }
  return mergeTreeGeometries(pieces);
}

/**
 * Build the "far" leaf billboard — one large Y-axis-aligned quad the
 * width of the canopy footprint, painted with the leaf-cluster texture
 * so a tree beyond the LOD threshold still reads as leaves. Centered on
 * the canopy midpoint (unit y ~0.75). Y-billboard, not full-billboard,
 * so it holds its footprint when the camera dolly-zooms.
 */
export function buildTreeLeavesFarGeometry(): THREE.BufferGeometry {
  const w = 0.85;
  const h = 0.95;
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  g.translate(0, 0.75, 0);
  return g;
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
  /** LOD gate. When present, the extra draws only when the plot's
   *  camera-distance LOD tier matches. "near" — draws when the camera
   *  is closer than `TREE_LOD_THRESHOLD_M`; "far" — draws beyond it.
   *  Used to switch the tree canopy between the crossed-quad cluster
   *  (near) and a single Y-billboard (far). Skipping is done by
   *  writing a zero-scale matrix, same convention as `presence`. */
  lodTag?: "near" | "far";
};

/**
 * Camera-distance threshold (world units) at which trees switch from
 * the near LOD (12 crossed leaf-cluster quads) to the far LOD (1
 * Y-billboard). The number sits inside the city's own footprint —
 * CITY_HALF = 40, so a corner-to-corner distance is ~113m; the LOD
 * changes as the camera dollies out from a leaf-close-up to a
 * whole-skyline framing. Trees the camera sits inside always render
 * the full crossed-quad canopy; distant trees drop to a billboard so
 * bloom + DOF still land on a leaf silhouette, not a coin of paint. */
export const TREE_LOD_THRESHOLD_M = 55;

// ── event tower per-plot bookkeeping ─────────────────────────────────────
//
// Each event slot holds a Group into which the compiled tower's meshes
// are parented, plus the last-built `BuiltEventTower` handle (or null
// when the slot has never been populated). A seed change triggers a
// full rebuild — different variants are structurally different (5
// meshes vs 3 vs 1) so a lightweight swap wouldn't work.

type EventPlotSlot = {
  /** The wrapping Group added to the scene once. Position / yaw / scale
   *  are written on this Group, not on the built tower's inner group. */
  group: THREE.Group;
  built: BuiltEventTower | null;
  lastBakeSlot: number;
  /** Handle to the curtain-wall shader patch on this slot's material.
   *  Owned per-plot so the column count and tier stay in step with the
   *  variant's equator radius. Null when tier="low" or before the slot
   *  has been populated. */
  curtainWall: CurtainWallHandle | null;
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

  // ── PBR facade atlas ─────────────────────────────────────────────
  // One 512×512 CanvasTexture atlas, four tiles: brick / plaster /
  // mullion / bark. Fed to every wall material as map + normalMap +
  // roughnessMap. Without this the facades read as untextured Lambert
  // solids under the new sky — with it the eye reads coursing,
  // render lines, curtain-wall mullion rhythm before it reads
  // silhouette. Prime-relative tiling (FACADE_REPEATS in
  // city-textures.ts) kills the obvious repeat.
  //
  // The atlas is built once at scene time. `event` towers still
  // allocate their own per-plot MeshPhysicalMaterial, but the shared
  // atlas feeds every one — a curtain-wall pattern is a curtain-wall
  // pattern; the per-plot difference lives in the emissive canvas.
  // Bake at 512 px per tile — a 1024² master per PBR channel (2K facade
  // atlas). The extra resolution reveals the per-brick chromatic
  // dispersion, weathering streaks, and micro-normal grain that fold
  // 48 extruded prisms into "close-zoom architecture" instead of "flat
  // painted decal".
  const facadeAtlas: FacadeAtlas = buildFacadeAtlas({ tilePx: 512 });
  const atlasSet: FacadeAtlasSet = {
    home:  facadeAtlas.textures.home,
    store: facadeAtlas.textures.store,
    event: facadeAtlas.textures.event,
    tree:  facadeAtlas.textures.tree,
  };

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
    // aoMap in three's WebGL renderer samples from uv2. BoxGeometry
    // only carries a uv attribute by default, so we mirror uv → uv2
    // here — the atlas's per-role aoMap then darkens the mortar valleys
    // and mullion corners in the same window the base map draws.
    const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (uv) {
      g.setAttribute("uv2", new THREE.BufferAttribute(uv.array.slice(), 2));
    }
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

  // ── home role: box body + flat tarred rooftop with rooftop kit ──
  //
  // The old 4-sided pitched cone roof + brick chimney read as picture-
  // book cottage and broke every SF/London/NYC reference in the brief.
  // The flat-tar rooftop kit that replaces it: a dark deck slab (always),
  // a raised stone parapet ring (always), a light-metal HVAC condenser
  // (~62% of homes, seeded), and a wooden water tower (~34% of homes,
  // seeded). Each part is an InstancedMesh keyed to the primary body's
  // instance index — one write per plot per part, done in lockstep by
  // `writeInstancedPlot` (see the extras loop below).
  const homeBodyGeo = unitBoxGeo();
  const homeWallMat = facadeMaterialFor("home", 0, atlasSet) as THREE.MeshStandardMaterial;
  const homeEmiss = primeEmissive(homeWallMat, "home");
  const homeBody = makeInstanced(homeBodyGeo, homeWallMat);
  scene.add(homeBody);

  // Roof deck — always present. Thin dark slab that covers the wall's
  // footprint and gives the bird's-eye zoom a real dark rectangle to
  // read as tarred roofing rather than the wall's brick texture bled
  // upward. Baked in local unit space (top face at y = 1.010) so the
  // extra rides the body's Y-scale like every other flat piece.
  const homeRoofDeckGeo = makeHomeRoofDeckGeometry();
  const homeRoofDeckMat = makeRoofDeckMaterial();
  const homeRoofDeck = makeInstanced(homeRoofDeckGeo, homeRoofDeckMat);
  scene.add(homeRoofDeck);

  // Parapet — always present. Raised hollow rectangular ring around
  // the roof edge; the same stone palette the store parapet uses so
  // the two roles' cornices agree at dusk. Sits on top of the deck.
  const homeParapetGeo = makeHomeParapetGeometry();
  const homeParapetMat = makeHomeParapetMaterial();
  const homeParapet = makeInstanced(homeParapetGeo, homeParapetMat);
  scene.add(homeParapet);

  // HVAC condenser — presence-gated on `hasHvacForSeed` (~62%). A
  // small light-metal box offset to one corner of the roof deck so
  // it never overlaps the parapet ring or the water tower's tank.
  // Metallic-ish so sunset light catches its face for a brief bloom.
  const homeHvacGeo = makeHomeHvacGeometry();
  const homeHvacMat = makeHvacMaterial();
  const homeHvac = makeInstanced(homeHvacGeo, homeHvacMat);
  scene.add(homeHvac);

  // Wooden water tower — presence-gated on `hasWaterTowerForSeed`
  // (~34%). Merged geometry: 4 leg posts + cylindrical tank + conical
  // cap. Warm cedar/redwood color that catches sunset warmth against
  // the cool blue evening sky — the emotional peak of the brief lives
  // on this kind of small detail.
  const homeWaterTowerGeo = makeHomeWaterTowerGeometry();
  const homeWaterTowerMat = makeWaterTowerMaterial();
  const homeWaterTower = makeInstanced(homeWaterTowerGeo, homeWaterTowerMat);
  scene.add(homeWaterTower);

  // ── store role: box body + parapet + optional awning ────────────
  const storeBodyGeo = unitBoxGeo();
  const storeWallMat = facadeMaterialFor("store", 0, atlasSet) as THREE.MeshStandardMaterial;
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

  // ── window-frame lattices (home + store) ─────────────────────────
  //
  // A shared ExtrudeGeometry — a rectangle with a hole — instanced
  // per window position on every home / store plot × 4 wall faces.
  // Home = 3×3 windows × 4 faces = 36 per plot; store = 5×4 × 4 = 80.
  // The lattice is where "windows recess into the wall" finally reads
  // as real geometry: frames protrude ~8cm from the wall face, so
  // sunset light rakes across them and the composer's bloom pass
  // catches genuine self-shadow contact at the frame edge. The
  // emissive canvas still lives on the wall body — the frame is the
  // ring that surrounds it, and the pane reads as backlit glass.
  //
  // Instance layout is dense per plot: plot index `p` writes into
  // slots [p * windowsPerPlot .. p * windowsPerPlot + wPP). Presence
  // is a zero-scale matrix when a plot's role doesn't match the
  // lattice's role (e.g. a plot that flipped from home → store, or
  // a slot never filled).
  const frameGeo = makeWindowFrameGeometry();
  const frameMatShared = makeWindowFrameMaterial();
  const homeWinPerPlot = windowsPerPlot("home");
  const storeWinPerPlot = windowsPerPlot("store");
  const homeFrameMesh = new THREE.InstancedMesh(
    frameGeo, frameMatShared, opts.maxInstances * homeWinPerPlot,
  );
  homeFrameMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  homeFrameMesh.castShadow = shadowsOn;
  homeFrameMesh.receiveShadow = shadowsOn;
  homeFrameMesh.count = 0;
  homeFrameMesh.name = "cityFrame.home";
  scene.add(homeFrameMesh);
  const storeFrameMesh = new THREE.InstancedMesh(
    frameGeo, frameMatShared, opts.maxInstances * storeWinPerPlot,
  );
  storeFrameMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  storeFrameMesh.castShadow = shadowsOn;
  storeFrameMesh.receiveShadow = shadowsOn;
  storeFrameMesh.count = 0;
  storeFrameMesh.name = "cityFrame.store";
  scene.add(storeFrameMesh);

  // ── tree role: plaza disc + trunk + branch skeleton + leaf clusters ──
  //
  // "Tree" is a small park: a paved circular plaza with a real tree in
  // the middle. The tree is:
  //
  //   plaza    — a paved CircleGeometry sitting at ground level.
  //   trunk    — a short bark-textured cylinder rising to y=0.42.
  //   branches — 5 short cylinders radiating from the trunk top into
  //              the canopy, each pointing at a leaf-cluster stamp
  //              position (see `TREE_LEAF_CLUSTER_POSITIONS`).
  //   leavesN  — 12 transparent-alpha leaf-cluster quads at each
  //              stamp, crossed 90° so the canopy reads leaves from
  //              any viewing yaw. Uses `buildLeafTexture` from
  //              city-textures, so grazing sunset light rim-lights
  //              the leaf edge through the normal map — the reading
  //              the icosphere fundamentally could not carry.
  //   leavesF  — 1 large Y-axis billboard for the far LOD (r > 60m in
  //              world units — for a city with CITY_HALF=40 that's
  //              anything near the corners of the settlement).
  //
  // Every part is an InstancedMesh sharing the tree's primary index. A
  // seed change swaps the plot's yaw and per-instance tint but does
  // NOT rebuild geometry — the canopy is the same shape for every
  // seed, and the seeded variety lives in the per-instance leaf tint
  // (which drifts with season).
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

  // Branch skeleton — 5 short cylinders radiating from the trunk top.
  // Bark material shared with the trunk so a viewer close enough to
  // read one reads the other. Cast + receive shadow — a branch's
  // shadow across the plaza is the ground truth read the icosphere
  // never had.
  const treeBranchesGeo = buildTreeBranchGeometry();
  const treeBranches = makeInstanced(treeBranchesGeo, treeTrunkMat);
  treeBranches.name = "cityTree.branches";
  scene.add(treeBranches);

  // Leaf-cluster texture — one 256×256 RGBA tile carrying five pointed-
  // oval leaves with alpha=0 outside the leaf shape, and one normal
  // map that gives every leaf a small dome so grazing light rim-lights
  // the leaf edge. Shared across every tree instance.
  const leafTex: LeafTexture = buildLeafTexture({ tilePx: 256 });

  // Near-LOD leaf material — transparent + alpha-test. alphaTest at 0.5
  // resolves the leaf edge against the depth buffer without the classic
  // transparent sort artefacts; the anti-aliased edge in the texture
  // still gives a soft outline in the alpha-tested silhouette because
  // the texture ramps rather than steps. Double-sided so a viewer
  // seeing the back of a leaf still gets a leaf, not a hole.
  const treeLeavesMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0.02,
    map: leafTex.albedo,
    normalMap: leafTex.normal,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
  });
  treeLeavesMat.name = "cityTree.leaves";

  const treeLeavesNearGeo = buildTreeLeavesNearGeometry();
  const treeLeavesNear = makeInstanced(treeLeavesNearGeo, treeLeavesMat);
  treeLeavesNear.name = "cityTree.leavesNear";
  scene.add(treeLeavesNear);

  const treeLeavesFarGeo = buildTreeLeavesFarGeometry();
  const treeLeavesFar = makeInstanced(treeLeavesFarGeo, treeLeavesMat);
  treeLeavesFar.name = "cityTree.leavesFar";
  scene.add(treeLeavesFar);

  // The `treeLeavesNear` mesh is the InstancedBuildingSlot primary — the
  // per-instance color drift `colorForInstance("tree", seed, sealed)`
  // returns a green tint, which multiplies through the leaf-cluster
  // texture and reads as per-plot leaf-color variety. Branches, trunk,
  // plaza, and far-billboard sit as `perInstanceColor: false` extras so
  // their bark / stone materials keep their own colour.
  //
  // LOD swap: `treeLeavesNear` (primary) and `treeLeavesFar` (extra)
  // both live at all times; `writeInstancedPlot` for tree role writes a
  // zero-scale matrix for whichever LOD is inactive for the plot's
  // camera distance, so exactly one of the two variants draws per plot.
  const treeCanopy = treeLeavesNear;
  const treeCanopyMat = treeLeavesMat;

  // ── assemble instanced-role slots ────────────────────────────────

  const homeSlot: InstancedBuildingSlot = {
    role: "home",
    primaryMesh: homeBody,
    wallMaterial: homeWallMat,
    extras: [
      // Roof deck (always) — thin dark tar slab across the full
      // footprint. Ride-the-body: the extra's local geometry lives in
      // unit space and the primary Y-scale (yScale = wall height in
      // world units) stretches its Y coordinates through. The deck's
      // thickness scales linearly with wall height, which is what a
      // real membrane roof does; the slab always reads as thin.
      {
        mesh: homeRoofDeck, material: homeRoofDeckMat,
        perInstanceColor: false,
      },
      // Parapet (always) — raised hollow ring at the roof edge. Sits
      // on top of the deck. Same convention as the store parapet: the
      // geometry's Y coordinates already carry the placement; only the
      // instance matrix's (sx, yScale, sz) applies here.
      {
        mesh: homeParapet, material: homeParapetMat,
        perInstanceColor: false,
      },
      // HVAC condenser — presence-gated. Small box offset to one
      // corner of the roof deck. Skipped seeds write a zero-scale
      // matrix so the mesh renders as nothing without a per-instance
      // visibility flag on the InstancedMesh.
      {
        mesh: homeHvac, material: homeHvacMat,
        perInstanceColor: false,
        presence: hasHvacForSeed,
      },
      // Water tower — presence-gated. Merged tank + cap + 4 legs at
      // the opposite corner from the HVAC unit.
      {
        mesh: homeWaterTower, material: homeWaterTowerMat,
        perInstanceColor: false,
        presence: hasWaterTowerForSeed,
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

  // Tree's PRIMARY is the near-LOD leaf-cluster canopy — that's what
  // per-instance color drift (ROLE_COLOR.tree = green) should tint on the
  // leaf albedo. Plaza (stone-gray), trunk + branches (bark), and the
  // far-LOD billboard are extras that keep their own material colour;
  // the far billboard is `lodTag: "far"` so writeInstancedPlot only
  // draws it beyond the LOD threshold.
  const treeSlot: InstancedBuildingSlot = {
    role: "tree",
    primaryMesh: treeCanopy,           // treeLeavesNear
    wallMaterial: treeCanopyMat,       // treeLeavesMat
    extras: [
      { mesh: treePlaza,     material: treePlazaMat,   perInstanceColor: false },
      { mesh: treeTrunk,     material: treeTrunkMat,   perInstanceColor: false },
      { mesh: treeBranches,  material: treeTrunkMat,   perInstanceColor: false },
      { mesh: treeLeavesFar, material: treeLeavesMat,  perInstanceColor: false,
        lodTag: "far" },
    ],
    emissiveCanvas: null,
    emissiveTexture: null,
    lastBakeSlot: -1,
    peakIntensity: 0,
  };

  // ── rooftop clutter (shared InstancedMeshes across all hosts) ────
  //
  // Four InstancedMeshes (ac, water, penthouse, vent) sized to a
  // worst-case bound of 6 pieces per plot. Every store + every event
  // routes into this shared pool; syncPlots below collects the host
  // records and hands the batch to syncHosts, which writes one matrix
  // per piece. Draw calls stay constant regardless of settlement size.
  const rooftop: RooftopScene = createRooftopScene({
    maxInstancesPerPart: Math.max(1, opts.maxInstances) * 6,
    shadows: shadowsOn,
  });
  scene.add(rooftop.group);

  // ── store trim extras (shared InstancedMeshes across all stores) ─
  //
  // Three InstancedMeshes (cornice, awning, balcony) sized to a
  // worst-case bound of one piece per store per part. Every store
  // routes into this shared pool; syncPlots below collects the host
  // records in the SAME walk as the rooftop hosts and hands the batch
  // to syncHosts, which writes one matrix per piece. Draw calls stay
  // constant regardless of settlement size.
  const storeExtras: StoreExtrasScene = createStoreExtrasScene({
    maxInstancesPerPart: Math.max(1, opts.maxInstances),
    shadows: shadowsOn,
  });
  scene.add(storeExtras.group);

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
    eventSlots.push({ group, built: null, lastBakeSlot: -1, curtainWall: null });
  }

  // Curtain-wall tier for event towers. Defaults follow shadows —
  // scenes paying for PCF shadows can afford the per-pane hash;
  // shadow-less scenes still get the mullions.
  const curtainWallTier: CurtainWallTier = curtainWallTierFor(shadowsOn, opts.curtainWallTier);

  // Build (or rebuild) the event tower at this slot from the plot's seed.
  // Delegates to `city-towers.buildEventTower` which owns the variant
  // silhouettes. The compiled tower's inner Group is re-parented into
  // this slot's persistent Group so downstream setShadows / dispose can
  // iterate one root per slot.
  function buildEventForSlot(slot: EventPlotSlot, seed: number, shadowsActive: boolean): void {
    if (slot.built) {
      disposeBuiltEventTower(slot.built);
      slot.built = null;
      // The curtain-wall handle points at the now-disposed material,
      // so drop it too. A fresh one is installed below on the new
      // material.
      slot.curtainWall = null;
    }
    // Clear the persistent group before adding the new tower's meshes.
    while (slot.group.children.length) {
      slot.group.remove(slot.group.children[0]);
    }
    const variant = eventVariantForSeed(seed);
    const dims = EMISSIVE_CANVAS_SIZE.event;
    const built = buildEventTowerParts({
      variant,
      seed,
      dayFraction: 0.6,
      shadowsOn: shadowsActive,
      emissiveSize: { w: dims.w, h: dims.h },
      // Shared PBR facade atlas — feeds curtain-wall mullion detail
      // as map + roughnessMap onto the event tower material. The
      // Gherkin variant keeps its own diamond normal (set inside
      // buildEventTower); non-Gherkin variants pick up the atlas
      // normal. Per-plot emissive canvas above still owns the dusk
      // moment.
      atlas: atlasSet.event,
    });
    // Re-parent the built tower's inner meshes into our persistent slot
    // group so world-space transforms live on `slot.group`.
    for (const m of built.meshes) {
      slot.group.add(m);
    }
    slot.built = built;
    slot.lastBakeSlot = -1;

    // Install the curtain-wall shader on this tower's material. Column
    // count derives from the variant's equator radius times the plot's
    // sx (world footprint). Idempotent: a seed swap that rebuilt the
    // tower rebuilds the material through facadeMaterialFor, so we
    // re-install the shader here on the fresh material.
    const equatorLocal = equatorRadiusForVariant(variant);
    const { sx } = footprintForRole("event", seed);
    const equatorWorldM = equatorLocal * sx;
    slot.curtainWall = applyCurtainWallShader(built.material, {
      seed,
      tier: curtainWallTier,
      equatorRadiusM: equatorWorldM,
    });
  }

  // ── temporaries ──────────────────────────────────────────────────
  const _pos = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4();
  const _c = new THREE.Color();
  const _extraColor = new THREE.Color();

  // ── LOD reference position ───────────────────────────────────────
  //
  // Set by `setLodCamera`. When null the tree extras with lodTag="far"
  // are always skipped and lodTag="near" always drawn — matches the
  // pre-LOD behaviour so headless smoke paths still get a canopy.
  let _lodCameraPos: THREE.Vector3 | null = null;

  /** Return the LOD tier — "near" or "far" — for a plot given the
   *  currently-set camera position. When no camera has been set, all
   *  plots are considered "near". */
  function lodTierForPlot(plot: PlotInstance): "near" | "far" {
    if (!_lodCameraPos) return "near";
    const w = normToWorld(plot.x, plot.y);
    const dx = w.x - _lodCameraPos.x;
    const dy = 0 - _lodCameraPos.y;
    const dz = w.z - _lodCameraPos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    return d2 > TREE_LOD_THRESHOLD_M * TREE_LOD_THRESHOLD_M ? "far" : "near";
  }

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

    // Compute the LOD tier once per plot — the primary mesh and every
    // extra with `lodTag` consult the same answer, so a near/far
    // switch flips both InstancedMeshes for the plot in one write.
    // Only the tree role currently uses LOD; other roles ignore it.
    const isTree = plot.role === "tree";
    const lodTier: "near" | "far" = isTree ? lodTierForPlot(plot) : "near";
    const primaryLodOff = isTree && lodTier === "far";

    // Primary body.
    _pos.set(w.x, 0, w.z);
    _q.setFromAxisAngle(_yAxis, yaw);
    if (primaryLodOff) {
      // Tree at far range — the primary is the near-LOD leaf cluster.
      // Zero-scale it out; the "far" extra (Y-billboard) will carry
      // the canopy this frame.
      _s.set(0, 0, 0);
    } else {
      _s.set(sx, yScale, sz);
    }
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
      // LOD gate — an extra tagged "near" is invisible when the plot is
      // in the far tier, and vice versa. Combines with `presence` (both
      // must pass to draw).
      const lodSkip = extra.lodTag ? extra.lodTag !== lodTier : false;
      const skip = lodSkip || (extra.presence ? !extra.presence(plot.seed) : false);
      // Far-LOD billboards Y-face the camera so a distant tree reads as
      // a canopy silhouette from any dolly angle. Only override yaw
      // when a camera is set — otherwise leave the plot's own yaw so
      // the headless smoke path stays deterministic.
      let extraYaw = yaw;
      if (extra.lodTag === "far" && _lodCameraPos) {
        extraYaw = Math.atan2(_lodCameraPos.x - w.x, _lodCameraPos.z - w.z);
      }
      _q.setFromAxisAngle(_yAxis, extraYaw);
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

  // Write one plot's worth of window-frame instances into the shared
  // lattice for home / store. The frames sit on the wall face with a
  // small outward protrusion, oriented per the 4 cardinal faces. This
  // is the geometry that finally lets grazing sunset light rake across
  // a real edge — the emissive canvas alone read as painted wallpaper.
  //
  // Row 0 sits at the ground floor (base of the wall), higher rows
  // climb toward the roof — same convention `drawEmissiveWindowCanvas`
  // uses when it walks the grid top-to-bottom, so the frame ring and
  // the lit-pane canvas cell are in register at every hour.
  function writeWindowsForPlot(
    mesh: THREE.InstancedMesh,
    plotIndex: number,
    perPlot: number,
    plot: PlotInstance | null,
  ): void {
    const base = plotIndex * perPlot;
    if (!plot) {
      _pos.set(0, -1000, 0);
      _s.set(0, 0, 0);
      _q.setFromAxisAngle(_yAxis, 0);
      _m.compose(_pos, _q, _s);
      for (let k = 0; k < perPlot; k += 1) {
        mesh.setMatrixAt(base + k, _m);
      }
      return;
    }
    const w = normToWorld(plot.x, plot.y);
    const fullH = heightForRole(plot.role, plot.seed);
    const { sx, sz } = footprintForRole(plot.role, plot.seed);
    const yScale = Math.max(0.02, plot.bornT) * fullH;
    const yaw = yawFor(plot);
    // `drawEmissiveWindowCanvas` uses canvas row 0 at the TOP of the
    // texture and row (rows-1) at the bottom. The wall in world space
    // maps the top of the canvas to the roof (y=yScale) and the bottom
    // to the ground (y=0). Flipping the row index here keeps a lit
    // canvas cell and its frame ring on the same window.
    const roleGrid = plot.role === "home" || plot.role === "store"
      ? WINDOW_GRIDS[plot.role]
      : null;
    if (!roleGrid) {
      // Zero-scale sweep — this lattice does not carry this role.
      _pos.set(0, -1000, 0);
      _s.set(0, 0, 0);
      _q.setFromAxisAngle(_yAxis, 0);
      _m.compose(_pos, _q, _s);
      for (let k = 0; k < perPlot; k += 1) {
        mesh.setMatrixAt(base + k, _m);
      }
      return;
    }
    const { rows, cols } = roleGrid;
    let k = 0;
    for (const face of WINDOW_FACES) {
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const wallRow = (rows - 1) - r;
          const p = windowFramePlacement(
            w.x, w.z, yaw, sx, sz, yScale, rows, cols,
            face as WindowFace, wallRow, c,
          );
          _pos.set(p.x, p.y, p.z);
          _q.setFromAxisAngle(_yAxis, p.yaw);
          // A newly planted plot is still growing (bornT small) — hide
          // frames until the wall has some height to sit on. Below
          // ~0.15 the wall is a stub and the frames would clip the
          // ground; write a zero-scale matrix instead.
          if (plot.bornT < 0.15) {
            _s.set(0, 0, 0);
          } else {
            _s.set(p.winW, p.winH, WINDOW_FRAME_DEPTH_M);
          }
          _m.compose(_pos, _q, _s);
          mesh.setMatrixAt(base + k, _m);
          k += 1;
        }
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

  // Write one event tower slot. Rebuilds the underlying geometry (via
  // city-towers.buildEventTower) when the plot's seed changes, since a
  // seed change is a variant change and each variant is a distinct
  // Mesh count. On the same seed the existing tower is reused and
  // only the group transform is rewritten.
  function writeEventPlot(slot: EventPlotSlot, plot: PlotInstance, shadowsActive: boolean): void {
    if (!slot.built || slot.built.seed !== plot.seed) {
      buildEventForSlot(slot, plot.seed, shadowsActive);
    }
    const w = normToWorld(plot.x, plot.y);
    const fullH = heightForRole(plot.role, plot.seed);
    const { sx, sz } = footprintForRole(plot.role, plot.seed);
    const yScale = Math.max(0.02, plot.bornT) * fullH;
    const yaw = yawFor(plot);
    slot.group.position.set(w.x, 0, w.z);
    slot.group.rotation.set(0, yaw, 0);
    // Tower parts are authored in a unit-height frame (y in [0,1]).
    // Scale to full world dimensions. sx and sz differ slightly so
    // the tower reads as bespoke architecture rather than a lathe.
    slot.group.scale.set(sx, yScale, sz);
    slot.group.visible = true;
    // Sealed towers brighten a touch — mirrors colorForInstance's rule.
    if (slot.built) {
      _c.copy(colorForInstance("event", plot.seed, plot.sealed));
      slot.built.material.color.copy(_c);
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
      // The window-frame lattices are keyed to the SAME iHome / iStore
      // indices so a plot's body and its window lattice always align.
      let iHome = 0, iStore = 0, iTree = 0;
      let iEvent = 0;
      // Rooftop hosts — collected in the same walk so we can pass a
      // single batch to `rooftop.syncHosts` at the end. Every store
      // and every event contributes one host; empties, homes, and
      // trees do not (a home has a pitched cone roof, a park has no
      // roof, and a home's roof would be too small to read the
      // clutter anyway).
      const rooftopHosts: RooftopHost[] = [];
      // Store-role trim hosts — cornice always, awning ~62%, balcony ~34%.
      // Collected in the same walk as the rooftop hosts so we hand a single
      // batch to `storeExtras.syncHosts` at the end.
      const storeExtraHosts: StoreExtraHost[] = [];
      for (const plot of plots) {
        const r = plot.role;
        if (r === "empty") continue;
        if (r === "home"  && iHome  < opts.maxInstances) {
          writeInstancedPlot(homeSlot, iHome, plot);
          writeWindowsForPlot(homeFrameMesh, iHome, homeWinPerPlot, plot);
          iHome += 1;
          continue;
        }
        if (r === "store" && iStore < opts.maxInstances) {
          writeInstancedPlot(storeSlot, iStore, plot);
          writeWindowsForPlot(storeFrameMesh, iStore, storeWinPerPlot, plot);
          const w = normToWorld(plot.x, plot.y);
          const fullH = heightForRole("store", plot.seed);
          const { sx, sz } = footprintForRole("store", plot.seed);
          const yScale = Math.max(0.02, plot.bornT) * fullH;
          rooftopHosts.push({
            role: "store",
            seed: plot.seed,
            worldX: w.x,
            worldZ: w.z,
            yaw: yawFor(plot),
            sx, sz,
            worldHeight: yScale,
          });
          storeExtraHosts.push({
            seed: plot.seed,
            worldX: w.x,
            worldZ: w.z,
            yaw: yawFor(plot),
            sx, sz,
            worldHeight: yScale,
          });
          iStore += 1;
          continue;
        }
        if (r === "tree"  && iTree  < opts.maxInstances) { writeInstancedPlot(treeSlot,  iTree++,  plot); continue; }
        if (r === "event" && iEvent < opts.maxInstances) {
          writeEventPlot(eventSlots[iEvent], plot, currentShadows);
          const w = normToWorld(plot.x, plot.y);
          const fullH = heightForRole("event", plot.seed);
          const { sx, sz } = footprintForRole("event", plot.seed);
          const yScale = Math.max(0.02, plot.bornT) * fullH;
          rooftopHosts.push({
            role: "event",
            seed: plot.seed,
            variant: eventVariantForSeed(plot.seed),
            worldX: w.x,
            worldZ: w.z,
            yaw: yawFor(plot),
            sx, sz,
            worldHeight: yScale,
          });
          iEvent += 1;
          continue;
        }
      }
      commitInstancedSlot(homeSlot,  iHome);
      commitInstancedSlot(storeSlot, iStore);
      commitInstancedSlot(treeSlot,  iTree);
      // The frame lattices' live count is (plot count × per-plot windows).
      // A plot that's no longer a home still holds its slots but writes
      // zero-scale matrices above, so the buffer stays coherent.
      homeFrameMesh.count = iHome * homeWinPerPlot;
      homeFrameMesh.instanceMatrix.needsUpdate = true;
      storeFrameMesh.count = iStore * storeWinPerPlot;
      storeFrameMesh.instanceMatrix.needsUpdate = true;
      // Hide event slots beyond the live count.
      for (let k = iEvent; k < opts.maxInstances; k += 1) {
        eventSlots[k].group.visible = false;
      }
      // Paint every store + event rooftop's clutter in one batch.
      rooftop.syncHosts(rooftopHosts);
      // Paint every store's cornice + optional awning + optional balcony
      // in one batch (three draw calls total).
      storeExtras.syncHosts(storeExtraHosts);
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
        if (!s.built) continue;
        s.built.material.emissiveIntensity = emitScale * PEAK_EMISSIVE.event;
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
      // seed. Redraw them all when the hour slot advances. Gherkin
      // variants also re-overlay the diamond mullion mask so the
      // curtain-wall crosshatch stays through the rebaked windows.
      for (const s of eventSlots) {
        if (!s.built) continue;
        if (s.lastBakeSlot === hourSlot) continue;
        s.lastBakeSlot = hourSlot;
        drawEmissiveWindowCanvas("event", s.built.seed, day, s.built.emissiveCanvas);
        if (s.built.variant === 0) {
          overlayGherkinDiamondMask(s.built.emissiveCanvas, s.built.seed);
        }
        s.built.emissiveTexture.needsUpdate = true;
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
      flip(homeRoofDeck);
      flip(homeParapet);
      flip(homeHvac);
      flip(homeWaterTower);
      flip(storeSlot.primaryMesh);
      flip(storeParapet);
      flip(storeAwning);
      flip(treeSlot.primaryMesh);        // treeLeavesNear
      flip(treePlaza);
      flip(treeTrunk);
      flip(treeBranches);
      flip(treeLeavesFar);
      flip(homeFrameMesh);
      flip(storeFrameMesh);
      for (const s of eventSlots) {
        if (!s.built) continue;
        for (const m of s.built.meshes) {
          m.castShadow = on;
          m.receiveShadow = on;
        }
      }
      rooftop.setShadows(on);
      storeExtras.setShadows(on);
    },

    setLodCamera(pos: THREE.Vector3 | null) {
      _lodCameraPos = pos;
    },

    setSeason(season: "spring" | "summer" | "fall" | "winter") {
      // The shared leaf material's `.color` is the seasonal multiplier
      // that turns the atlas's mid-green leaf into the season's tint.
      // The per-instance color (from colorForInstance) multiplies on
      // top of this, so each tree still reads as its own seed within
      // the season's palette.
      const tint = leafTintForSeason(season);
      treeLeavesMat.color.setRGB(tint.r, tint.g, tint.b);
      treeLeavesMat.needsUpdate = true;
    },

    dispose() {
      const disposeInstanced = (im: THREE.InstancedMesh) => {
        try { im.geometry.dispose(); } catch { /* noop */ }
      };
      disposeInstanced(homeBody);
      disposeInstanced(homeRoofDeck);
      disposeInstanced(homeParapet);
      disposeInstanced(homeHvac);
      disposeInstanced(homeWaterTower);
      disposeInstanced(storeBody); disposeInstanced(storeParapet); disposeInstanced(storeAwning);
      disposeInstanced(treePlaza); disposeInstanced(treeTrunk);
      disposeInstanced(treeBranches);
      disposeInstanced(treeLeavesNear);
      disposeInstanced(treeLeavesFar);
      // The two window-frame lattices SHARE one ExtrudeGeometry; free
      // it once by disposing the geometry off just one of the meshes.
      try { frameGeo.dispose(); } catch { /* noop */ }
      try { frameMatShared.dispose(); } catch { /* noop */ }
      homeWallMat.dispose();
      homeRoofDeckMat.dispose();
      homeParapetMat.dispose();
      homeHvacMat.dispose();
      homeWaterTowerMat.dispose();
      storeWallMat.dispose(); storeParapetMat.dispose(); storeAwningMat.dispose();
      treePlazaMat.dispose(); treeTrunkMat.dispose();
      // treeLeavesMat is `treeCanopyMat`; also disposes the shared
      // material behind treeLeavesNear + treeLeavesFar.
      try { treeLeavesMat.dispose(); } catch { /* noop */ }
      // Free leaf-cluster texture (RGBA albedo + normal). Its two
      // CanvasTextures fed the leaves material we just disposed.
      try { leafTex.dispose(); } catch { /* noop */ }
      if (homeEmiss.texture) try { homeEmiss.texture.dispose(); } catch { /* noop */ }
      if (storeEmiss.texture) try { storeEmiss.texture.dispose(); } catch { /* noop */ }
      for (const s of eventSlots) {
        if (s.built) {
          disposeBuiltEventTower(s.built);
          s.built = null;
        }
      }
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      if (sun.shadow.map) {
        try { sun.shadow.map.dispose(); } catch { /* noop */ }
      }
      // Free the PBR atlas GL textures. The shared albedo/normal/rough
      // sub-textures are held by every wall material we just disposed;
      // this frees the underlying GPU allocations.
      try { facadeAtlas.dispose(); } catch { /* noop */ }
      // Free the rooftop clutter InstancedMeshes + geometries + mats.
      try { rooftop.dispose(); } catch { /* noop */ }
      // Free the store-extras (cornice / awning / balcony) meshes.
      try { storeExtras.dispose(); } catch { /* noop */ }
    },
  };
}
