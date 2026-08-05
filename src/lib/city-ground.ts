/**
 * city-ground — the baked streets + sidewalks the towers stand on.
 *
 * Before this module, `worldGround` was a 2000×2000 flat MeshStandardMaterial
 * in a mud tone (0x6a614c, roughness 0.95). The road-graph the visitor draws
 * lived only in the 2D overlay canvas — the 3D pass had no roads, no
 * sidewalks, no curb. Every extruded tower read as a prism standing on a
 * cardboard placemat, and the whole diorama unmasked itself the moment the
 * pinch pushed the camera to eye-level.
 *
 * `createCityGround` bakes three procedural textures the plane samples:
 *
 *   albedo    → asphalt on the roads, concrete on the sidewalks, dashed
 *               yellow center lines, a faint noise breakup so a large flat
 *               area stops reading as one uniform swatch.
 *   normal    → curbs raised where sidewalk meets asphalt, a low-frequency
 *               tarmac wobble on the road so grazing sunlight catches at
 *               dusk.
 *   roughness → sidewalks polished ~0.55, asphalt rough ~0.85, so the
 *               PBR pass has real specular contrast across the ground.
 *
 * The block plan (which grid intersections carry a street, how wide the
 * sidewalks are, where the small internal alleys sit) is a deterministic
 * function of the seed the caller passes — the settlement always paints
 * itself the same way for the same visit — and the textures tile across
 * the full 2000×2000 world plane with a `tileWorldSize` unit cell so the
 * settlement's block plan reads consistently near the towers and the
 * generated street grid keeps going out to the horizon.
 *
 * A second overlay texture, sized 1:1 to the settlement area (the
 * (-CITY_HALF..+CITY_HALF) box the plots live in), starts transparent
 * and receives one antialiased asphalt stripe every time the visitor
 * draws a road with a one-finger drag — `addRoad(x1n, y1n, x2n, y2n)`
 * projects the normalized (0..1)² endpoints into the overlay's UV space
 * and stamps a stripe with a subtle center dash. One draw per road, one
 * texture upload per road; no per-frame allocations, and the shader
 * that composes overlay on top of base runs the same cost whether the
 * visitor drew zero roads or thirty-two.
 *
 * All shapes are computed against the seed — no Math.random, no wall
 * clock, no gesture layer. A remount at the same cityTimeMs produces
 * pixel-identical textures. Tests pin the projection math and the block
 * plan's determinism so a later "just tune the sidewalk width" refactor
 * cannot silently move the atlas.
 */

import * as THREE from "three";
import { CITY_HALF } from "./city-camera";

// ── constants the tests read ─────────────────────────────────────────────
//
// The default tile is 200 world units per side — a settlement of
// CITY_HALF=40 fits inside a 4×4 block grid at this scale, which is what
// the SF/London references show (a 200m grid of city blocks, three or
// four blocks visible in the frame at an oblique wide shot). The base
// texture wraps across the 2000×2000 world plane, so ten tiles cover the
// horizon and the grid keeps going past what any camera pitch reveals.

/** World units per repeated tile of the base albedo/normal/roughness. */
export const DEFAULT_TILE_WORLD_SIZE = 200;

/** Resolution of the base tile texture (px per side). */
export const DEFAULT_BASE_RESOLUTION = 1024;

/** Resolution of the settlement-scale road overlay (px per side). */
export const DEFAULT_OVERLAY_RESOLUTION = 1024;

/** Total plane size (world units per side). Matches the placeholder ground. */
export const DEFAULT_PLANE_SIZE = 2000;

/**
 * Block plan the baker walks. A tile is split into a 4×4 grid of blocks;
 * street width, sidewalk width, and lane-line pattern come from these.
 * Widths are fractions of the tile so the same numbers work at any
 * baseResolution.
 */
export type BlockPlan = {
  blocksPerTile: number;      // integer, e.g. 4
  streetFraction: number;     // fraction of tile taken by a street corridor
  sidewalkFraction: number;   // fraction of tile taken by sidewalk on each side of a street
  crosswalkFraction: number;  // fraction of street width the crosswalk stripes cover
};

export const DEFAULT_BLOCK_PLAN: BlockPlan = {
  blocksPerTile: 4,
  streetFraction: 0.14,
  sidewalkFraction: 0.045,
  crosswalkFraction: 0.7,
};

// ── seeded RNG (matches city.ts mulberry family, kept private here so the
// module has no runtime dependency on city.ts) ────────────────────────────
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ── pure UV projection (tested) ──────────────────────────────────────────
//
// The visitor draws a road as two normalized (0..1)² endpoints. The
// overlay texture spans the settlement area 1:1, so the mapping is a
// straight identity — but we expose it so the test can pin the invariant
// and the caller cannot accidentally flip an axis. The Y axis is flipped
// because canvas Y grows downward while the plot's Y grows the same way
// (0 = top of the field), so the identity is correct once but a future
// caller passing world-space Z (which grows the OPPOSITE way from screen
// Y) would need an explicit flip. The projection is the boundary between
// those conventions and lives here.

export type OverlayUv = { u: number; v: number };

/**
 * Normalized plot coord (0..1)² → overlay UV (0..1)². For now the two
 * spaces are the same, but the indirection lets a future refactor (e.g.
 * a padded overlay with margin, or a rotated atlas) change one call
 * site instead of every road-drawer.
 */
export function normToOverlayUv(nx: number, ny: number): OverlayUv {
  return { u: clamp01(nx), v: clamp01(ny) };
}

/**
 * Clamp both endpoints of a road segment into the overlay's UV box, and
 * return a canonical short form the tests can compare exactly. Returns
 * null if the segment is entirely outside the settlement area — the
 * caller should skip drawing (the road would land in the outer tiling
 * pattern and never composite over the plane).
 */
export function projectRoadToOverlayUv(
  x1n: number,
  y1n: number,
  x2n: number,
  y2n: number,
): { a: OverlayUv; b: OverlayUv } | null {
  // A degenerate segment (a road with zero length — the visitor tapped
  // and released without dragging) contributes nothing; the caller
  // already discards these upstream but we belt-and-brace it here.
  if (!Number.isFinite(x1n) || !Number.isFinite(y1n)) return null;
  if (!Number.isFinite(x2n) || !Number.isFinite(y2n)) return null;
  const outside =
    (x1n < 0 && x2n < 0) ||
    (y1n < 0 && y2n < 0) ||
    (x1n > 1 && x2n > 1) ||
    (y1n > 1 && y2n > 1);
  if (outside) return null;
  return {
    a: normToOverlayUv(x1n, y1n),
    b: normToOverlayUv(x2n, y2n),
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── deterministic block-plan sampler (tested) ────────────────────────────
//
// `sampleBlockPlan(u, v, seed, plan)` returns a small tag for what the
// baker should paint at that pixel within a tile. The whole texture is a
// walk over this function — the caller doesn't need to see the seeded
// jitter or the sidewalk math, only the answer.
//
// The tag is a string union so the test can assert cardinal points:
//   'asphalt'   → the road surface (dark grey, roughness 0.85)
//   'sidewalk'  → the concrete apron between road and lot (lighter, 0.55)
//   'lot'       → the interior of a block (compacted dirt / paved plaza)
//   'centerline'→ the yellow dashed lane divider on wide streets

export type GroundTag = "asphalt" | "sidewalk" | "lot" | "centerline";

export function sampleBlockPlan(
  u: number,
  v: number,
  seed: number,
  plan: BlockPlan = DEFAULT_BLOCK_PLAN,
): GroundTag {
  const n = plan.blocksPerTile;
  // Position within the block cell (0..1) — u,v wraps into the tile.
  const bu = ((u * n) % 1 + 1) % 1;
  const bv = ((v * n) % 1 + 1) % 1;
  // The seeded jitter varies which cells are wider streets vs. narrow
  // alleys. Stays subtle — a real city block plan varies by ~15%, not
  // 60%, and the tests pin that the settlement STILL reads as a grid.
  const cellUi = Math.floor(u * n);
  const cellVi = Math.floor(v * n);
  const rand = mulberry((seed >>> 0) ^ (cellUi * 9301) ^ (cellVi * 49297));
  const streetJitter = (rand() - 0.5) * 0.06;
  const sidewalkJitter = (rand() - 0.5) * 0.02;
  const streetHalf = plan.streetFraction * 0.5 + streetJitter;
  const sidewalkOuter = streetHalf + plan.sidewalkFraction + sidewalkJitter;

  // Distance from the nearest cell edge, both axes.
  const du = Math.min(bu, 1 - bu);
  const dv = Math.min(bv, 1 - bv);
  const dEdge = Math.min(du, dv);

  if (dEdge < streetHalf) {
    // Yellow centerline is a thin band right on the cell edge.
    if (dEdge < streetHalf * 0.06) return "centerline";
    return "asphalt";
  }
  if (dEdge < sidewalkOuter) return "sidewalk";
  return "lot";
}

// ── canvas baker ─────────────────────────────────────────────────────────
//
// Everything below this line touches DOM canvases. Tests do not exercise
// these paths — they pin the pure math above. `document.createElement` is
// guarded so a Node smoke-test that accidentally imports the module gets
// a clear error rather than a stack from three's WebGL layer.

function assertBrowser(): void {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new Error(
      "city-ground: baking requires a DOM canvas — call createCityGround from a browser mount, not from a node script.",
    );
  }
}

function bakeBaseCanvas(
  resolution: number,
  seed: number,
  plan: BlockPlan,
): HTMLCanvasElement {
  assertBrowser();
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Fill with lot tone first — everywhere that isn't a street or sidewalk
  // reads as a compacted-plaza tone the extruded lots sit on. The tone is
  // deliberately a hair lighter than the old mud placeholder so the raised
  // sidewalks read against it and the towers stop looking like they float.
  const lotColor = "#7a7364";
  const asphaltColor = "#3a3a3d";
  const sidewalkColor = "#a9a89f";
  const centerlineColor = "#c9a944";

  const img = ctx.createImageData(resolution, resolution);
  const data = img.data;
  const rand = mulberry(seed ^ 0x51ad7e);

  // Precompute noise the walk consumes — one 128×128 tile of low-freq
  // asphalt speckle we sample bilinearly. Keeps the outer loop tight.
  const noiseSide = 128;
  const noise = new Float32Array(noiseSide * noiseSide);
  for (let i = 0; i < noise.length; i += 1) noise[i] = rand();

  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const u = x / resolution;
      const v = y / resolution;
      const tag = sampleBlockPlan(u, v, seed, plan);
      const nx = Math.floor((u * noiseSide * 3) % noiseSide);
      const ny = Math.floor((v * noiseSide * 3) % noiseSide);
      const n = noise[ny * noiseSide + nx];
      let hex: string;
      if (tag === "asphalt") {
        // Asphalt with a small darker peppering — the grazing sun should
        // pick up the texture, and a fully uniform tone would betray the
        // grid at any reasonable resolution.
        const shade = 0.90 + n * 0.20;
        hex = mixHex(asphaltColor, "#1f1f22", 1 - shade);
      } else if (tag === "centerline") {
        // The centerline is a solid dashed swatch — but the dash pattern
        // is baked here so the shader doesn't have to sample dashes.
        // Every third tile-edge lane repeat is a gap.
        const dashPhase = Math.floor(v * plan.blocksPerTile * 8) % 4;
        hex = dashPhase === 3 ? mixHex(asphaltColor, "#1f1f22", 0.1) : centerlineColor;
      } else if (tag === "sidewalk") {
        // Sidewalk with the concrete slab pattern: a very faint square
        // grid + speckle. Slabs are ~3m in the reference (0.015 tile
        // units), we approximate with an 8-slab grid per block.
        const slabU = Math.floor(u * plan.blocksPerTile * 8);
        const slabV = Math.floor(v * plan.blocksPerTile * 8);
        const slabRand = mulberry((seed ^ 0x8e2c) + slabU * 131 + slabV * 71)();
        const shade = 0.94 + slabRand * 0.12;
        hex = mixHex(sidewalkColor, "#5a5a54", 1 - shade);
      } else {
        // Lot interior — the same tone as the placeholder ground, just
        // subtly modulated so a mile of flat plaza doesn't read as fake.
        const shade = 0.93 + n * 0.14;
        hex = mixHex(lotColor, "#5a5347", 1 - shade);
      }
      const rgb = hexToRgb(hex);
      const idx = (y * resolution + x) * 4;
      data[idx] = rgb.r;
      data[idx + 1] = rgb.g;
      data[idx + 2] = rgb.b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function bakeNormalCanvas(
  resolution: number,
  seed: number,
  plan: BlockPlan,
): HTMLCanvasElement {
  assertBrowser();
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const img = ctx.createImageData(resolution, resolution);
  const data = img.data;

  // Sample the tag at neighbors and encode the height gradient into the
  // normal. Sidewalks are the "high" region (~+0.06 world units above
  // the road), asphalt is baseline, lots are baseline. That gradient
  // paints the curb the same way a real curb catches sun.
  const heightOf = (tag: GroundTag): number => {
    if (tag === "sidewalk") return 1;
    if (tag === "centerline") return 0.15;
    return 0;
  };
  const step = 1 / resolution;
  const rand = mulberry(seed ^ 0x11de);

  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const u = x / resolution;
      const v = y / resolution;
      const hR = heightOf(sampleBlockPlan(u + step, v, seed, plan));
      const hL = heightOf(sampleBlockPlan(u - step, v, seed, plan));
      const hD = heightOf(sampleBlockPlan(u, v + step, seed, plan));
      const hU = heightOf(sampleBlockPlan(u, v - step, seed, plan));
      const dx = (hR - hL) * 0.5;
      const dy = (hD - hU) * 0.5;
      // Add a subtle asphalt wobble so grazing sun catches on the tarmac.
      const wobble = (rand() - 0.5) * 0.04;
      const nx = -dx + (sampleBlockPlan(u, v, seed, plan) === "asphalt" ? wobble : 0);
      const ny = -dy + (sampleBlockPlan(u, v, seed, plan) === "asphalt" ? wobble : 0);
      // Encode as tangent-space normal: RGB in [0..1] with Z always ~1.
      const nz = 1;
      const len = Math.max(0.001, Math.hypot(nx, ny, nz));
      const r = ((nx / len) * 0.5 + 0.5) * 255;
      const g = ((ny / len) * 0.5 + 0.5) * 255;
      const b = ((nz / len) * 0.5 + 0.5) * 255;
      const idx = (y * resolution + x) * 4;
      data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function bakeRoughnessCanvas(
  resolution: number,
  seed: number,
  plan: BlockPlan,
): HTMLCanvasElement {
  assertBrowser();
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const img = ctx.createImageData(resolution, resolution);
  const data = img.data;
  const rand = mulberry(seed ^ 0x77e2);
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const u = x / resolution;
      const v = y / resolution;
      const tag = sampleBlockPlan(u, v, seed, plan);
      let r: number;
      if (tag === "asphalt") r = 0.85 + rand() * 0.05;
      else if (tag === "centerline") r = 0.65 + rand() * 0.05;
      else if (tag === "sidewalk") r = 0.55 + rand() * 0.06;
      else r = 0.90 + rand() * 0.04;
      const v255 = Math.max(0, Math.min(255, Math.round(r * 255)));
      const idx = (y * resolution + x) * 4;
      data[idx] = v255;
      data[idx + 1] = v255;
      data[idx + 2] = v255;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ── overlay canvas — the visitor's roads ─────────────────────────────────
//
// The overlay maps 1:1 to the settlement area. It starts fully
// transparent; `addRoad` stamps a stripe of asphalt with a subtle
// dashed centerline over it, and the shader composes overlay.rgb by
// overlay.a on top of the base. Because the overlay is settlement-
// scale (80 world units for CITY_HALF=40), a road at any reasonable
// zoom reads at ~2-4 texels of width.

function makeOverlayCanvas(resolution: number): HTMLCanvasElement {
  assertBrowser();
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, resolution, resolution);
  }
  return canvas;
}

function stampRoadOnOverlay(
  ctx: CanvasRenderingContext2D,
  resolution: number,
  a: OverlayUv,
  b: OverlayUv,
): void {
  // A road is drawn as three concentric strokes:
  //  1. a wide dark asphalt stripe (the roadway itself)
  //  2. a slightly lighter tarmac highlight (subtle tire-wear crown)
  //  3. a dashed yellow centerline (the lane divider)
  const ax = a.u * resolution;
  const ay = a.v * resolution;
  const bx = b.u * resolution;
  const by = b.v * resolution;
  const roadWidth = Math.max(6, resolution * 0.012);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // asphalt stripe
  ctx.strokeStyle = "rgba(38, 38, 42, 0.95)";
  ctx.lineWidth = roadWidth;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // tarmac highlight (a hair lighter, thinner)
  ctx.strokeStyle = "rgba(60, 60, 64, 0.85)";
  ctx.lineWidth = roadWidth * 0.7;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // dashed centerline
  ctx.strokeStyle = "rgba(200, 172, 76, 0.85)";
  ctx.lineWidth = Math.max(1, roadWidth * 0.12);
  ctx.setLineDash([roadWidth * 1.5, roadWidth * 1.2]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── shader injection ─────────────────────────────────────────────────────
//
// The mesh uses MeshStandardMaterial (the same PBR family the buildings
// use, so the ground and towers agree on lighting), and we patch its
// fragment shader with onBeforeCompile to sample the overlay in world
// coordinates. The base map's `repeat` handles the tile pattern; the
// overlay is a one-shot sample against the settlement's world box.

type ShaderPatch = {
  material: THREE.MeshStandardMaterial;
  uniforms: {
    uOverlayMap: { value: THREE.Texture };
    uSettlementHalf: { value: number };
  };
};

function patchGroundMaterial(
  material: THREE.MeshStandardMaterial,
  overlayTexture: THREE.Texture,
  settlementHalf: number,
): ShaderPatch {
  const uniforms = {
    uOverlayMap: { value: overlayTexture },
    uSettlementHalf: { value: settlementHalf },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOverlayMap = uniforms.uOverlayMap;
    shader.uniforms.uSettlementHalf = uniforms.uSettlementHalf;

    // Vertex shader: pass world XZ position to the fragment shader so
    // the overlay's UV can be recomputed from world coordinates. We
    // capture it in a varying rather than reusing `vViewPosition`
    // because that one lives in view space, which shifts every frame.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec2 vGroundWorldXZ;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        // Recompute world position explicitly rather than depending on
        // the worldpos_vertex chunk (which only defines worldPosition
        // when USE_ENVMAP / USE_SHADOWMAP etc are set). One extra mat4
        // multiply per vertex — cheap; the plane is two triangles.
        // Local name has no leading underscores: GLSL ES reserves any
        // identifier containing two consecutive underscores, and ANGLE /
        // Metal / iOS Safari reject the whole shader on that ground.
        vec4 cityGroundWp = modelMatrix * vec4( transformed, 1.0 );
        vGroundWorldXZ = cityGroundWp.xz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uOverlayMap;
        uniform float uSettlementHalf;
        varying vec2 vGroundWorldXZ;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          // Overlay in settlement space: (worldX+half)/(2*half), (worldZ+half)/(2*half).
          vec2 overlayUv = (vGroundWorldXZ + vec2(uSettlementHalf)) / (2.0 * uSettlementHalf);
          if (overlayUv.x >= 0.0 && overlayUv.x <= 1.0 && overlayUv.y >= 0.0 && overlayUv.y <= 1.0) {
            vec4 overlay = texture2D(uOverlayMap, overlayUv);
            diffuseColor.rgb = mix(diffuseColor.rgb, overlay.rgb, overlay.a);
          }
        }`,
      );
  };

  // Force a recompile whenever three notices the material changed;
  // otherwise the first frame uses the un-injected shader.
  material.needsUpdate = true;

  return { material, uniforms };
}

// ── the public factory ────────────────────────────────────────────────────

export type CityGroundOptions = {
  /** World-space side length of the ground plane. Default 2000. */
  size?: number;
  /** Resolution of the base tile texture. Default 1024. */
  baseResolution?: number;
  /** Resolution of the settlement road overlay. Default 1024. */
  overlayResolution?: number;
  /** World units per repeated tile of the base texture. Default 200. */
  tileWorldSize?: number;
  /** Seed for the block plan. Same seed → identical bake. */
  seed?: number;
  /** Half-side of the settlement box the plots live in. Default CITY_HALF. */
  settlementHalf?: number;
  /** Optional override of the block plan. Rarely needed. */
  blockPlan?: BlockPlan;
};

export type CityGround = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Stamp one road segment (normalized 0..1 endpoints) onto the overlay. */
  addRoad(x1n: number, y1n: number, x2n: number, y2n: number): void;
  /** Replace the overlay with the given roads (used when persistence rehydrates). */
  setRoads(roads: Array<{ x1: number; y1: number; x2: number; y2: number }>): void;
  /** Clear all painted roads. */
  clearRoads(): void;
  /** Free GPU + DOM resources. Safe to call from a React unmount. */
  dispose(): void;
};

export function createCityGround(opts: CityGroundOptions = {}): CityGround {
  const size = opts.size ?? DEFAULT_PLANE_SIZE;
  const baseResolution = opts.baseResolution ?? DEFAULT_BASE_RESOLUTION;
  const overlayResolution = opts.overlayResolution ?? DEFAULT_OVERLAY_RESOLUTION;
  const tileWorldSize = opts.tileWorldSize ?? DEFAULT_TILE_WORLD_SIZE;
  const seed = opts.seed ?? 0x9e3779b1;
  const settlementHalf = opts.settlementHalf ?? CITY_HALF;
  const plan = opts.blockPlan ?? DEFAULT_BLOCK_PLAN;

  assertBrowser();

  // Bake the three base tiles.
  const albedoCanvas = bakeBaseCanvas(baseResolution, seed, plan);
  const normalCanvas = bakeNormalCanvas(baseResolution, seed, plan);
  const roughCanvas = bakeRoughnessCanvas(baseResolution, seed, plan);

  const repeatCount = Math.max(1, Math.round(size / tileWorldSize));

  const configureBaseTexture = (tex: THREE.CanvasTexture, isColor: boolean): void => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatCount, repeatCount);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
  };

  const albedoTex = new THREE.CanvasTexture(albedoCanvas);
  configureBaseTexture(albedoTex, true);
  const normalTex = new THREE.CanvasTexture(normalCanvas);
  configureBaseTexture(normalTex, false);
  const roughTex = new THREE.CanvasTexture(roughCanvas);
  configureBaseTexture(roughTex, false);

  // Overlay: settlement-scale, one texel per settlement subdivision.
  const overlayCanvas = makeOverlayCanvas(overlayResolution);
  const overlayCtx = overlayCanvas.getContext("2d");
  const overlayTex = new THREE.CanvasTexture(overlayCanvas);
  overlayTex.wrapS = THREE.ClampToEdgeWrapping;
  overlayTex.wrapT = THREE.ClampToEdgeWrapping;
  overlayTex.magFilter = THREE.LinearFilter;
  overlayTex.minFilter = THREE.LinearFilter;
  overlayTex.generateMipmaps = false;
  overlayTex.colorSpace = THREE.SRGBColorSpace;
  overlayTex.needsUpdate = true;

  // Material — PBR, so the buildings and the ground read as one lit
  // system. Metalness is zero everywhere (streets are dielectric); the
  // rough map handles asphalt vs. sidewalk contrast, the normal map
  // handles curbs and tarmac wobble, the albedo handles the block plan.
  const material = new THREE.MeshStandardMaterial({
    map: albedoTex,
    normalMap: normalTex,
    roughnessMap: roughTex,
    roughness: 1.0,
    metalness: 0.0,
  });
  material.normalScale = new THREE.Vector2(1.4, 1.4);

  patchGroundMaterial(material, overlayTex, settlementHalf);

  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.position.y = 0;
  mesh.name = "cityGround";

  const addRoadInternal = (
    x1n: number,
    y1n: number,
    x2n: number,
    y2n: number,
  ): void => {
    if (!overlayCtx) return;
    const proj = projectRoadToOverlayUv(x1n, y1n, x2n, y2n);
    if (!proj) return;
    stampRoadOnOverlay(overlayCtx, overlayResolution, proj.a, proj.b);
    overlayTex.needsUpdate = true;
  };

  return {
    mesh,
    material,
    addRoad: addRoadInternal,
    setRoads(roads) {
      if (!overlayCtx) return;
      overlayCtx.clearRect(0, 0, overlayResolution, overlayResolution);
      for (const r of roads) {
        const proj = projectRoadToOverlayUv(r.x1, r.y1, r.x2, r.y2);
        if (!proj) continue;
        stampRoadOnOverlay(overlayCtx, overlayResolution, proj.a, proj.b);
      }
      overlayTex.needsUpdate = true;
    },
    clearRoads() {
      if (!overlayCtx) return;
      overlayCtx.clearRect(0, 0, overlayResolution, overlayResolution);
      overlayTex.needsUpdate = true;
    },
    dispose() {
      albedoTex.dispose();
      normalTex.dispose();
      roughTex.dispose();
      overlayTex.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}

// ── color helpers (private, kept dependency-free) ────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function mixHex(aHex: string, bHex: string, t: number): string {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r * (1 - k) + b.r * k);
  const g = Math.round(a.g * (1 - k) + b.g * k);
  const bb = Math.round(a.b * (1 - k) + b.b * k);
  return `#${((r << 16) | (g << 8) | bb).toString(16).padStart(6, "0")}`;
}
