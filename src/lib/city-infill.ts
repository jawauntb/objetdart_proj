/**
 * city-infill — the horizon ring of extruded silhouettes that turn the
 * settlement from a diorama into a fragment of a real city.
 *
 * The plot disk (48 sealed plots on ±40 metres) reads as a plaza against
 * open sky. Every reference the brief pins (SF financial district,
 * London City at sunset, London City at dusk) reads as *city* because
 * the horizon is filled with more city — a ring of buildings the eye
 * cannot count, dissolving into the sky the further out it goes. That is
 * what this module builds.
 *
 * Approach — a hex-jittered packing, not raw Voronoi:
 *
 *   A true Voronoi packing (Lloyd-relaxed seeds, edge-clipped cells) is
 *   the reference for how a city actually parcels its blocks, but the
 *   distance-fog silhouette at ≥90 metres cannot resolve cell shape.
 *   What the eye *does* read is that neighbouring rooftops sit ~one
 *   block apart (never overlapping, never gridded) and that the count
 *   thins as distance grows. A hex-axial grid with per-cell seeded jitter
 *   inside the cell radius produces exactly that reading in one pass,
 *   deterministically, with no relaxation loop. The pinned tests
 *   (`heightForSeed`, `emitPhaseForSeed`, `annulusContains`, and the
 *   grid enumerator) are the small pure surface a future move to real
 *   Voronoi would replace one function at a time, without touching the
 *   scene wiring.
 *
 * Layout:
 *
 *   INFILL_INNER_R = 90 m — starts past the settlement edge (±40) and
 *                            past the harbour strip (centre z=50, half-
 *                            depth 16, so the far edge sits at z=66).
 *   INFILL_OUTER_R = 500 m — well beyond the FogExp2 (density 0.0035)
 *                            transmittance knee (~200 m for e^-0.5) and
 *                            past where individual silhouettes still
 *                            contribute a distinguishable pixel.
 *   INFILL_CELL_M  = 18 m  — a plausible urban block spacing (SF blocks
 *                            are 30–90 m, London blocks 10–40 m; 18 m is
 *                            the compact London-ish mean at half-block).
 *
 * Populated by walking an axial hex grid inside a bounding square that
 * covers the annulus, jittering each cell centre by up to CELL_JITTER of
 * the cell radius, discarding centres inside the plot disk / harbour
 * bounding box / outside the annulus. Each surviving centre becomes one
 * instance. The list is deterministic from the seed.
 *
 * Tier-gating:
 *
 *   HIGH   = 600 instances (the brief's ceiling for the ring)
 *   MEDIUM = 300
 *   LOW    = 0 (skip the module altogether on the low tier)
 *
 * All instances are packed at high count at construction; the actual
 * draw count is `instanceMesh.count = tierCount` per frame, so lowering
 * the tier is a scalar assignment, not a rebuild.
 *
 * Materials:
 *
 *   One MeshStandardMaterial per InstancedMesh — deliberately not
 *   MeshPhysicalMaterial. Physical transmission + iridescence is what
 *   the plot's event towers use to sell curtain-wall glass at eye level;
 *   at horizon distance the fog swallows the specular signal and PBR
 *   physical is a rendering cost with no visible payoff. Standard PBR
 *   with a low-metallic albedo + emissive-per-instance is what the eye
 *   actually reads at that distance: rooftop silhouettes with warm
 *   window banks blooming at dusk.
 *
 *   Instance colour drives a small palette drift (brick, concrete, pale
 *   glass) so 600 silhouettes read as 600 buildings. Per-instance
 *   emissive phase (`aEmit`) is injected via `onBeforeCompile` — the
 *   material's `emissiveIntensity` sets the whole-city dusk multiplier
 *   (driven by `emissiveIntensityForDay`, the same curve the plot
 *   facades ride) and `aEmit` per instance shifts that up or down by a
 *   factor in [0.15, 1.8] so some silhouettes light early, some hold
 *   their windows dark past midnight. The gestalt from far away is
 *   *the city lighting up window by window*, without a per-window
 *   texture on any horizon instance.
 *
 * Fog dissolve:
 *
 *   The world scene already carries `FogExp2` at density 0.0035, and the
 *   colour is refreshed each 64-th of a day from the Preetham sky's
 *   horizon. This module writes zero fog logic — the ring simply lives
 *   inside the same fog the plots do, and the horizon dissolves for
 *   free. The outer radius is chosen so the ring goes past the fog knee
 *   and no visitor ever sees a bare "end of city" edge.
 *
 * Determinism:
 *
 *   No `Math.random`, no wall clock. The seed the caller passes (the
 *   same `cityGroundSeed ^ 0x1c17f11` City.tsx forwards, so remounts of
 *   the same visit produce the same ring) drives every grid cell, jitter
 *   offset, height, footprint, yaw, colour, and emit-phase.
 *
 * Zero gameplay coupling:
 *
 *   The infill ring is a pure visual field. It does not observe plots,
 *   people, roads, or gestures; it does not write into city.ts state; it
 *   holds no timers of its own beyond the dusk emissive curve. City.tsx
 *   calls `update(dayFraction, tier)` once per tick and hands the group
 *   to the skyline scene. Nothing else touches it.
 */

import * as THREE from "three";
import { CITY_HALF } from "@/lib/city-camera";
import { emissiveIntensityForDay } from "@/lib/city-windows";

// ── constants the tests pin ─────────────────────────────────────────────

/** Inner radius of the annulus (metres). The plot disk lives in ±40 and
 *  the harbour extends to z≈66; 90 m sits clear of both without leaving
 *  a bare "moat" the eye reads as empty. */
export const INFILL_INNER_R = 90;

/** Outer radius (metres). Past the FogExp2 knee at density 0.0035 —
 *  transmittance at 400 m is ~exp(-1.96)=14%, at 500 m is ~exp(-3.06)=5%,
 *  the ring dissolves before it ends. */
export const INFILL_OUTER_R = 500;

/** Hex cell radius (world metres). A compact urban-block spacing. */
export const INFILL_CELL_M = 18;

/** Per-cell jitter as a fraction of the cell radius. 0.55 keeps buildings
 *  from overlapping their neighbours while still breaking the grid read. */
export const INFILL_CELL_JITTER = 0.55;

/** Tier → instance count. Low disables the ring entirely (the low-tier
 *  visitor is on a device where every extra draw call is a frame at
 *  risk); medium halves it; high is the full ring the brief asks for. */
export const INFILL_COUNT_HIGH = 280;
export const INFILL_COUNT_MEDIUM = 120;
/** Low keeps a thin ring so a phone that drops tier still shows a skyline. */
export const INFILL_COUNT_LOW = 60;

/** Building height envelope (metres). The ring keeps the ladder consistent
 *  with the plot skyline: nothing on the horizon towers over a sealed
 *  event tower on the plot disk (which caps ~50 m in city-geometry).
 *  Range 6..44 m so the tallest infill building sits just under the
 *  tallest plot tower — the settlement stays the focal peak. */
export const INFILL_HEIGHT_MIN = 6;
export const INFILL_HEIGHT_MAX = 44;

/** Footprint envelope (metres). Slimmer than plot buildings so the ring
 *  reads as *more, smaller* — a horizon full of ordinary buildings, not
 *  a second skyline. */
export const INFILL_WIDTH_MIN = 6;
export const INFILL_WIDTH_MAX = 14;

/** Harbour cutout (metres, world coordinates). Mirrors the harbour rect
 *  City.tsx passes to city-traffic + city-water. Any candidate centre
 *  inside this rect is discarded so the ring never marches into the
 *  water. */
export type HarbourCutout = {
  centerZ: number;
  halfWidth: number;
  depth: number;
};

export const DEFAULT_HARBOUR: HarbourCutout = {
  centerZ: 44,
  halfWidth: 70,
  depth: 52,
};

/** Governor tier tag City.tsx already passes around. Mirrored here so
 *  this module doesn't need to import the frame governor. */
export type InfillTier = "low" | "medium" | "high" | "sleep";

// ── pure helpers (tested) ────────────────────────────────────────────────

/**
 * Little deterministic 32-bit hash → unit float. Matches the mixer shape
 * city-traffic and city-facades already use so a future consolidation
 * into one shared helper is a rename, not a rewrite.
 */
export function unitHash(seed: number, salt: number): number {
  let x = ((seed | 0) ^ ((salt * 0x9e3779b1) | 0)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 0xffffffff;
}

/**
 * Instance count for a governor tier. Sleep matches low — no reason to
 * hide instances behind a paused frame that is not drawing anyway, but
 * the semantic makes the caller's tier plumbing symmetric.
 */
export function infillCountForTier(tier: InfillTier): number {
  if (tier === "high") return INFILL_COUNT_HIGH;
  if (tier === "medium") return INFILL_COUNT_MEDIUM;
  return INFILL_COUNT_LOW;
}

/**
 * Test whether a (x, z) world point sits inside the infill annulus and
 * outside the harbour cutout. The pure geometry of the ring — used by
 * the enumerator to keep or drop candidate cells, and by the test to
 * pin the ring's edges without touching Three.js.
 */
export function annulusContains(
  x: number,
  z: number,
  harbour: HarbourCutout = DEFAULT_HARBOUR,
  innerR: number = INFILL_INNER_R,
  outerR: number = INFILL_OUTER_R,
): boolean {
  const r2 = x * x + z * z;
  if (r2 < innerR * innerR) return false;
  if (r2 > outerR * outerR) return false;
  // Harbour bounding rect: [-halfWidth, +halfWidth] × [centerZ ± depth/2]
  const halfDepth = harbour.depth * 0.5;
  const inHx = x > -harbour.halfWidth && x < harbour.halfWidth;
  const inHz = z > harbour.centerZ - halfDepth && z < harbour.centerZ + halfDepth;
  if (inHx && inHz) return false;
  return true;
}

/**
 * Height for a per-cell seed. Two dials from the seed:
 *   - a base in [MIN, MAX] with a mild bias toward the low end (the
 *     horizon skews low-rise — most buildings are ordinary)
 *   - a distance mask: the closer the cell is to the plot disk, the
 *     slightly lower the ceiling, so the plot's event tower stays the
 *     visible peak of the frame and the ring builds *out* from the
 *     settlement rather than *around* it in a wall.
 *
 * `radialFrac` is (r - INNER) / (OUTER - INNER), clamped to [0, 1].
 * At the inner edge (radialFrac=0) the ceiling drops to ~50 % of MAX;
 * at radialFrac=1 the ceiling reaches full MAX.
 */
export function heightForSeed(seed: number, radialFrac: number): number {
  const r = Math.max(0, Math.min(1, radialFrac));
  const u = unitHash(seed, 0x3a17c1);
  // Bias low with u^1.6 — the median height sits well below MAX/2.
  const biased = Math.pow(u, 1.6);
  const ceiling = INFILL_HEIGHT_MAX * (0.5 + 0.5 * r);
  return INFILL_HEIGHT_MIN + biased * (ceiling - INFILL_HEIGHT_MIN);
}

/**
 * Footprint width & depth for a per-cell seed. Both are seeded so a
 * building can be a thin slab or a stubby block; the aspect ratio drifts
 * per seed so 600 silhouettes read as 600 shapes.
 */
export function footprintForSeed(seed: number): { width: number; depth: number } {
  const u = unitHash(seed, 0x51b73);
  const v = unitHash(seed, 0x717c9);
  const width = INFILL_WIDTH_MIN + u * (INFILL_WIDTH_MAX - INFILL_WIDTH_MIN);
  const depth = INFILL_WIDTH_MIN + v * (INFILL_WIDTH_MAX - INFILL_WIDTH_MIN);
  return { width, depth };
}

/**
 * Yaw for a per-cell seed. Small jitter around the cardinal axis so the
 * ring reads as an organic mesh, not a grid. ±22.5°.
 */
export function yawForSeed(seed: number): number {
  const u = unitHash(seed, 0x9a11f);
  return (u - 0.5) * (Math.PI / 4);
}

/**
 * Per-instance colour drift. Three-palette mix (brick, concrete, pale
 * curtain-wall glass) plus a small per-seed hue push so a row of similar
 * buildings still reads with variance. Multiplied against the material's
 * base white colour when the InstancedMesh writes instanceColor.
 */
export function colorForSeed(seed: number): [number, number, number] {
  const u = unitHash(seed, 0xc0a1c);
  const palette: Array<[number, number, number]> = [
    // London brick — warm ochre, low chroma.
    [0.52, 0.38, 0.30],
    [0.46, 0.32, 0.24],
    // Concrete / cast stone — cool grey.
    [0.55, 0.55, 0.53],
    [0.62, 0.62, 0.60],
    // Curtain-wall glass — pale steel blue.
    [0.44, 0.52, 0.60],
    [0.40, 0.48, 0.56],
    // Portland stone — bright pale cream (the London mid-tone).
    [0.78, 0.74, 0.66],
  ];
  const idx = Math.floor(u * palette.length);
  const base = palette[Math.max(0, Math.min(palette.length - 1, idx))];
  const j = unitHash(seed, 0xd7c11) - 0.5; // ±0.5
  const push = 0.06 * j;
  return [
    Math.max(0, Math.min(1, base[0] + push)),
    Math.max(0, Math.min(1, base[1] + push * 0.5)),
    Math.max(0, Math.min(1, base[2] + push * 0.3)),
  ];
}

/**
 * Per-instance emissive phase in [0.15, 1.8]. Multiplied against the
 * material's per-frame `emissiveIntensity` inside the fragment shader,
 * so at any given dusk moment some infill buildings glow warmer and
 * some hold dark. The gestalt from far away is *the city lighting up
 * window by window*.
 *
 * The 0.15 floor keeps every building visible at dusk (no fully-dark
 * silhouettes read as gaps); the 1.8 ceiling lets a small number of
 * buildings peak above the baseline for the composer's bloom pyramid
 * to catch as ember halos.
 */
export function emitPhaseForSeed(seed: number): number {
  const u = unitHash(seed, 0xe1b17);
  // Two shifted humps: most buildings sit around 0.7, a small tail
  // reaches into 1.4+, a small tail sits under 0.4. Not uniform — a
  // uniform distribution reads as noise; a bimodal one reads as
  // "some blocks lit, some dark".
  const s = u * u * (3 - 2 * u); // smoothstep(0, 1, u)
  return 0.15 + s * 1.65;
}

/**
 * Enumerate the deterministic list of infill instance descriptors for
 * a given seed, up to `capacity`. Returned in near-first order so
 * dropping the tail lowers the count while keeping the visually most-
 * important instances (the ones closest to the visitor's eye).
 *
 * This is the module's pure geometric core — a test can call it with
 * no Three.js in scope and pin the count, the ordering, and the ring's
 * shape. The factory below simply writes matrices from it.
 */
export type InfillInstance = {
  x: number;
  z: number;
  yaw: number;
  width: number;
  depth: number;
  height: number;
  color: readonly [number, number, number];
  emitPhase: number;
  seed: number;
};

export function enumerateInfill(
  seed: number,
  capacity: number,
  harbour: HarbourCutout = DEFAULT_HARBOUR,
  innerR: number = INFILL_INNER_R,
  outerR: number = INFILL_OUTER_R,
  cellM: number = INFILL_CELL_M,
): InfillInstance[] {
  const out: InfillInstance[] = [];

  // Axial hex grid parameters. `dx` is the horizontal cell spacing
  // (2 * cell * cos(30°) = cell * sqrt(3)); `dz` is the vertical row
  // spacing (cell * 1.5). Even rows sit at column origin, odd rows
  // shift by dx/2 — the classic pointy-top hex layout.
  const dx = cellM * Math.sqrt(3);
  const dz = cellM * 1.5;
  const cols = Math.ceil((outerR * 2) / dx) + 2;
  const rows = Math.ceil((outerR * 2) / dz) + 2;

  const halfCols = Math.floor(cols / 2);
  const halfRows = Math.floor(rows / 2);

  for (let rowIx = -halfRows; rowIx <= halfRows; rowIx += 1) {
    const zBase = rowIx * dz;
    const rowShift = (rowIx & 1) === 0 ? 0 : dx * 0.5;
    for (let colIx = -halfCols; colIx <= halfCols; colIx += 1) {
      const xBase = colIx * dx + rowShift;

      // Fast reject: skip cells whose base is well outside the annulus
      // ring (with a one-cell margin for jitter to spill in).
      const r2Base = xBase * xBase + zBase * zBase;
      const margin = cellM * 2;
      const innerLim = innerR - margin;
      const outerLim = outerR + margin;
      if (r2Base < innerLim * innerLim) continue;
      if (r2Base > outerLim * outerLim) continue;

      // Cell seed folds row + column + user seed. The 0x9e3779b1 is
      // Knuth's multiplicative hash constant — the same one every
      // seeded module in this repo uses.
      const cellSeed = ((seed ^ ((rowIx * 73856093) | 0) ^ ((colIx * 19349663) | 0)) >>> 0);
      const jx = (unitHash(cellSeed, 0x0a) - 0.5) * 2 * cellM * INFILL_CELL_JITTER;
      const jz = (unitHash(cellSeed, 0x0b) - 0.5) * 2 * cellM * INFILL_CELL_JITTER;
      const x = xBase + jx;
      const z = zBase + jz;

      if (!annulusContains(x, z, harbour, innerR, outerR)) continue;

      const rActual = Math.sqrt(x * x + z * z);
      const radialFrac = Math.max(0, Math.min(1, (rActual - innerR) / (outerR - innerR)));
      const height = heightForSeed(cellSeed, radialFrac);
      const footprint = footprintForSeed(cellSeed);
      const yaw = yawForSeed(cellSeed);
      const color = colorForSeed(cellSeed);
      const emitPhase = emitPhaseForSeed(cellSeed);

      out.push({
        x,
        z,
        yaw,
        width: footprint.width,
        depth: footprint.depth,
        height,
        color,
        emitPhase,
        seed: cellSeed,
      });
    }
  }

  // Order by distance from origin — the visitor's eye. Dropping the
  // tail on a tier change removes the least-visible instances first.
  out.sort((a, b) => (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z));

  if (out.length > capacity) out.length = capacity;
  return out;
}

// ── the factory ─────────────────────────────────────────────────────────

export type CityInfillOptions = {
  seed: number;
  /** Maximum instances the InstancedMesh allocates. Defaults to
   *  INFILL_COUNT_HIGH — pack the ring for the highest tier once, then
   *  scale down via `setTier`. */
  capacity?: number;
  harbour?: HarbourCutout;
  /** Cast shadows onto the ground. Cheap for 600 boxes, expensive on
   *  low tier — the caller flips this via the shadowsOn tier signal. */
  shadows?: boolean;
};

export type CityInfill = {
  /** Root group added to the skyline scene. */
  group: THREE.Group;
  /** The single InstancedMesh (BoxGeometry × MeshStandardMaterial). */
  mesh: THREE.InstancedMesh;
  /** Ring descriptors in near-first order. Held so tier changes are a
   *  count assignment, not a re-enumeration. */
  instances: readonly InfillInstance[];
  /** Set the draw count from a tier. Falls to zero on low/sleep. */
  setTier(tier: InfillTier): void;
  /** Set the environment IBL. Called by City.tsx when the sky's PMREM
   *  slot advances so the ring's material samples the same sky IBL the
   *  plot facades do. */
  setEnvironment(env: THREE.Texture | null): void;
  /** Toggle shadow casting. Cheaper than a rebuild — City.tsx wires
   *  this off the same tier signal it uses on the plot skyline. */
  setShadows(on: boolean): void;
  /** Advance the day. Sets material.emissiveIntensity from
   *  emissiveIntensityForDay so the dusk-and-lit-windows moment lands
   *  on the ring on the same schedule as the plot facades. */
  setDayFrac(day: number): void;
  /** Free geometry / material / attribute buffers. Called from the
   *  City.tsx teardown before renderer.dispose(). */
  dispose(): void;
};

export function createCityInfill(opts: CityInfillOptions): CityInfill {
  const seed = opts.seed >>> 0;
  const capacity = Math.max(0, Math.floor(opts.capacity ?? INFILL_COUNT_HIGH));
  const harbour = opts.harbour ?? DEFAULT_HARBOUR;
  const shadows = opts.shadows !== false;

  const group = new THREE.Group();
  group.name = "cityInfill";

  // Pack the ring at full capacity once. Tier changes flip `mesh.count`.
  const instances = enumerateInfill(seed, capacity, harbour);

  // ── geometry ────────────────────────────────────────────────────────
  // Unit box, translated so its base sits at y=0. The compose matrix
  // then scales width/height/depth into world metres and drops the
  // building at (x, height/2, z) — the InstancedMesh's per-instance
  // matrix owns the whole placement.
  const geo = new THREE.BoxGeometry(1, 1, 1);

  // ── material ────────────────────────────────────────────────────────
  // MeshStandardMaterial — see the file header for the reason it isn't
  // MeshPhysicalMaterial. `color` is white so `instanceColor` per
  // instance drives the whole albedo. `emissive` is a warm tungsten
  // colour; `emissiveIntensity` rides the dusk curve; the shader hook
  // below multiplies it by the per-instance `aEmit` phase.
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    metalness: 0.05,
    roughness: 0.82,
    emissive: new THREE.Color(0xffc078),
    emissiveIntensity: 0,
    // Standard PBR fog gets the horizon dissolve for free.
    fog: true,
  });

  // Inject the per-instance emissive phase attribute. Applied via
  // onBeforeCompile so we keep the full PBR pipeline (IBL, sun,
  // shadows, fog) instead of rewriting the material from scratch.
  // The `aEmit` attribute is declared here and multiplied into the
  // material's `totalEmissiveRadiance` in the fragment stage.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aEmit;
varying float vEmit;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vEmit = aEmit;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vEmit;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= vEmit;`,
      );
  };
  // A user-defined `program` cache key so materials that only differ
  // in the hook (there is only one here) still share the compiled
  // program across mounts.
  material.customProgramCacheKey = () => "city-infill/aEmit-v1";

  // ── the instanced mesh ──────────────────────────────────────────────
  const drawCapacity = Math.max(0, instances.length);
  const mesh = new THREE.InstancedMesh(geo, material, drawCapacity);
  mesh.name = "cityInfill-mesh";
  mesh.castShadow = shadows;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  // Frustum culling is on by default. Set a large bounding sphere so a
  // pinch to eye-level (where the camera is inside the annulus) still
  // draws instances behind the visitor's cone — the ring is *around*
  // the eye, not just in front of it.
  mesh.frustumCulled = false;

  // Per-instance colour buffer.
  const colorArr = new Float32Array(Math.max(1, drawCapacity) * 3);
  // Per-instance emit-phase buffer (fed into the shader hook above).
  const emitArr = new Float32Array(Math.max(1, drawCapacity));

  // Compose scratch objects — the InstancedMesh writer expects a
  // matrix and a colour per instance. Kept out of the loop so we
  // allocate none of them per iteration.
  const scratchMat = new THREE.Matrix4();
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const scratchAxis = new THREE.Vector3(0, 1, 0);
  const scratchColor = new THREE.Color();

  for (let i = 0; i < drawCapacity; i += 1) {
    const inst = instances[i];
    scratchPos.set(inst.x, inst.height * 0.5, inst.z);
    scratchScale.set(inst.width, inst.height, inst.depth);
    scratchQuat.setFromAxisAngle(scratchAxis, inst.yaw);
    scratchMat.compose(scratchPos, scratchQuat, scratchScale);
    mesh.setMatrixAt(i, scratchMat);

    scratchColor.setRGB(inst.color[0], inst.color[1], inst.color[2]);
    mesh.setColorAt(i, scratchColor);

    colorArr[i * 3 + 0] = inst.color[0];
    colorArr[i * 3 + 1] = inst.color[1];
    colorArr[i * 3 + 2] = inst.color[2];
    emitArr[i] = inst.emitPhase;
  }

  // Wire the emit-phase attribute onto the geometry. Three.js reads
  // this via the `aEmit` attribute name we declared in the shader hook.
  const emitAttr = new THREE.InstancedBufferAttribute(emitArr, 1);
  emitAttr.setUsage(THREE.StaticDrawUsage);
  geo.setAttribute("aEmit", emitAttr);

  // Mark the InstancedMesh buffers dirty so the first frame ships the
  // matrices we just wrote. instanceColor is only allocated if we set
  // the buffer — which setColorAt does — but the setUsage call keeps
  // it explicit.
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.setUsage(THREE.StaticDrawUsage);
    mesh.instanceColor.needsUpdate = true;
  }

  group.add(mesh);

  // Start hidden until the caller calls setTier — mirrors how the
  // traffic + pedestrian modules handle their tier gate. The composer
  // will still schedule the render pass but the group.visible=false
  // short-circuits it.
  let currentTier: InfillTier = "high";
  mesh.count = infillCountForTier(currentTier);
  group.visible = mesh.count > 0;

  // ── public surface ──────────────────────────────────────────────────

  function setTier(tier: InfillTier): void {
    if (tier === currentTier) return;
    currentTier = tier;
    const wantCount = Math.min(instances.length, infillCountForTier(tier));
    mesh.count = wantCount;
    group.visible = wantCount > 0;
  }

  function setEnvironment(env: THREE.Texture | null): void {
    material.envMap = env;
    material.envMapIntensity = env ? 1.0 : 0.0;
    material.needsUpdate = true;
  }

  function setShadows(on: boolean): void {
    mesh.castShadow = on;
  }

  function setDayFrac(day: number): void {
    // The dusk-and-lit-windows curve, exactly. Peak ~1.6 at midnight,
    // 0 at noon; the per-instance aEmit multiplier scales it up or
    // down so some buildings light early and some hold dark.
    material.emissiveIntensity = emissiveIntensityForDay(day);
  }

  function dispose(): void {
    // The InstancedBufferAttribute rides on the geometry; disposing
    // the geometry drops its GL buffer. Explicit for clarity.
    if (mesh.instanceColor) mesh.instanceColor = null;
    geo.deleteAttribute("aEmit");
    geo.dispose();
    material.dispose();
    group.remove(mesh);
  }

  return {
    group,
    mesh,
    instances,
    setTier,
    setEnvironment,
    setShadows,
    setDayFrac,
    dispose,
  };
}
