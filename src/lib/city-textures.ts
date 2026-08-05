/**
 * city-textures — the PBR facade atlas that makes 48 extruded prisms
 * finally read as architecture.
 *
 * Before this module the /city skyline was a set of clean BoxGeometry /
 * LatheGeometry solids in per-role PBR materials. Silhouette held up at
 * a distance, but at the CLOSE zoom (the SF financial district / London
 * City reference plates) the eye reads surface detail before it reads
 * outline: brick coursing on the residential blocks, horizontal render
 * lines on plaster storefronts, curtain-wall mullion rhythm on the
 * glass towers, ridged bark on the park kerb. Without those cues the
 * facades sit as untextured Lambert-ish solids under the new sky, and
 * every downstream pass — sun, bloom, SSR — lands on a surface that
 * looks like a mock-up.
 *
 * The atlas is authored once, procedurally, at scene build time. Four
 * tiles, arranged as a 2×2 quad on one CanvasTexture:
 *
 *   ┌─────────────────┬─────────────────┐
 *   │ home:  brick    │ store: plaster  │
 *   │ 8cm × 24cm      │ 60cm horiz      │
 *   │ running bond    │ render lines    │
 *   ├─────────────────┼─────────────────┤
 *   │ event: mullion  │ tree:  bark     │
 *   │ 1.5m × 3.5m     │ 6cm grooves     │
 *   │ curtain wall    │ park kerb       │
 *   └─────────────────┴─────────────────┘
 *
 * Each tile is rendered three times into three master canvases —
 * albedo (map), tangent-space normal (normalMap), roughness
 * (roughnessMap) — so a single procedural draw fills the whole PBR
 * material graph. Per-role Textures then crop the correct quadrant
 * out of each master and wrap freely, so a home wall can tile brick
 * across itself at 11×7 (prime) without leaking into the store or
 * event tile above. The prime-relative tiling is what breaks the
 * obvious repeat that gives away procedural textures.
 *
 * The DOM-touching drawer sits behind `buildFacadeAtlas`. The pure
 * laws — TILE_LAYOUT, FACADE_REPEATS, the mortar / render-line /
 * mullion / bark predicates — live at the top of the file and stay
 * free of `three` and `document`, so scripts/test-city-textures.mjs
 * can pin them under node without a canvas.
 *
 * Sizes are in *real architectural units* (metres) so the atlas can
 * be re-authored at a higher resolution later without shifting the
 * coursing. A home tile represents a 2m × 2m patch of masonry; a
 * store tile represents a 2m × 2.5m patch of rendered stucco; an
 * event tile represents a 3m × 7m panel of curtain-wall glass (one
 * bay × two floors); a tree tile represents a 0.6m × 0.6m patch of
 * bark and stone kerb.
 *
 * Nothing here changes the city.ts causal laws, the dwell ladder,
 * the emissive-window law, or any test that pins them. This module
 * is additive — it feeds `facadeMaterialFor` new map/normalMap/
 * roughnessMap textures and returns them for the scene to dispose.
 */

import * as THREE from "three";

// ── the four tiles: layout on the master atlas ──────────────────────────
//
// The atlas is a 2×2 grid. Each tile occupies exactly one quadrant.
// UV space is [0,1] on the whole atlas; a tile's slice is a 0.5 × 0.5
// window. TILE_LAYOUT is exported so the geometry side can compute
// per-role UV offsets consistently with the drawer.

export type FacadeTileRole = "home" | "store" | "event" | "tree";

export type TileWindow = {
  /** min UV u (0..1) */
  u0: number;
  /** min UV v (0..1) */
  v0: number;
  /** max UV u (0..1) */
  u1: number;
  /** max UV v (0..1) */
  v1: number;
};

export const TILE_LAYOUT: Record<FacadeTileRole, TileWindow> = {
  home:  { u0: 0.0, v0: 0.0, u1: 0.5, v1: 0.5 },
  store: { u0: 0.5, v0: 0.0, u1: 1.0, v1: 0.5 },
  event: { u0: 0.0, v0: 0.5, u1: 0.5, v1: 1.0 },
  tree:  { u0: 0.5, v0: 0.5, u1: 1.0, v1: 1.0 },
};

// ── prime-relative wall repeats ──────────────────────────────────────────
//
// The dead giveaway of a procedural texture is a repeat count that lands
// on a factor of the wall's own aspect. Set `.repeat` on each per-role
// texture to a pair of primes and the pattern never lands on itself in
// a period the eye can lock onto within a single facade.
//
// The numbers below are all prime. They come from a real-world sanity
// check:
//   home:  a 5m × 8m brownstone wall should read as ~11 brick tiles
//          across and ~7 tiles tall (one tile = 2m × 2m of masonry).
//   store: a wider 8m × 12m storefront reads at 13 × 5 (~2m × 2.5m
//          tiles of rendered stucco; render lines every 60cm land
//          coherent).
//   event: a tall glass panel reads as 17 verticals × 23 horizontals
//          (1.5m × 3.5m mullion cells stacked).
//   tree:  the small plaza kerb tiles at 5 × 5 (a park has one plaza
//          disc; the bark UVs feed the trunk cylinder).
//
// If a change here breaks primality, test-city-textures.mjs fires.

export type UVRepeats = { u: number; v: number };

export const FACADE_REPEATS: Record<FacadeTileRole, UVRepeats> = {
  home:  { u: 11, v: 7 },
  store: { u: 13, v: 5 },
  event: { u: 17, v: 23 },
  tree:  { u: 5,  v: 5 },
};

// ── the physical size each tile represents (metres) ─────────────────────

export type TileSize = { widthM: number; heightM: number };

export const TILE_METRES: Record<FacadeTileRole, TileSize> = {
  home:  { widthM: 2.0, heightM: 2.0 },
  store: { widthM: 2.0, heightM: 2.5 },
  event: { widthM: 3.0, heightM: 7.0 },
  tree:  { widthM: 0.6, heightM: 0.6 },
};

// ── the pure predicates: what is mortar / render line / mullion / groove ─
//
// The atlas is drawn by walking pixels and asking each of these functions
// whether the pixel sits on a surface feature. All predicates take pixel
// coordinates in [0, tilePx) and the tile's own pixel size, so the same
// law drives the albedo canvas, the normal canvas, and the roughness
// canvas — a caller can't accidentally draw mortar in one map without it
// also appearing in the other. The tests pin these directly.

/**
 * Home brick coursing law. A tile is `tilePx` × `tilePx` and represents
 * TILE_METRES.home (2m × 2m) of running-bond masonry with 8cm × 24cm
 * bricks and 1cm mortar. The predicate returns true for pixels that
 * land in the mortar between bricks. Every other course is offset by
 * half a brick — the running bond pattern.
 */
export function homeBrickIsMortar(px: number, py: number, tilePx: number): boolean {
  // 25 courses of 8cm bricks in 2m of tile → row height = tilePx / 25.
  // 8 bricks wide per course at 24cm each → brick width = tilePx / 8.
  const rowH = tilePx / HOME_BRICK_ROWS;
  const colW = tilePx / HOME_BRICK_COLS;
  const mortar = Math.max(1, Math.floor(tilePx / 128)); // ~4px at 512, ~2px at 256
  const row = Math.floor(py / rowH);
  // Offset every other course by half a brick — the running bond.
  const shift = (row & 1) === 0 ? 0 : colW * 0.5;
  const yInRow = py - row * rowH;
  if (yInRow < mortar) return true;
  const xShifted = ((px + shift) % tilePx + tilePx) % tilePx;
  const xInCol = xShifted - Math.floor(xShifted / colW) * colW;
  if (xInCol < mortar) return true;
  return false;
}

export const HOME_BRICK_ROWS = 25;
export const HOME_BRICK_COLS = 8;

/**
 * Store plaster horizontal render line law. Rendered stucco walls in
 * London City / SF financial district have a subtle horizontal seam
 * every ~60cm where the render courses were struck. On a 2.5m tile
 * that lands at rows y = tilePx * n/4 (n = 1..3) — four visible seams
 * across the tile height.
 */
export function storePlasterHasLine(py: number, tilePx: number): boolean {
  const period = tilePx / STORE_RENDER_LINES;
  const thickness = Math.max(1, Math.floor(tilePx / 256));
  const yMod = py - Math.floor(py / period) * period;
  return yMod < thickness;
}

export const STORE_RENDER_LINES = 4;

/**
 * Event mullion grid vertical law. Real curtain-wall glass has narrow
 * vertical aluminium mullions on a ~1.5m spacing. On a 3m-wide tile
 * that lands at columns x = tilePx * n/2 (n = 0..1) — two full-height
 * mullions per tile bay.
 */
export function eventMullionIsVertical(px: number, tilePx: number): boolean {
  const period = tilePx / EVENT_VERTICAL_MULLIONS;
  const half = Math.max(1, Math.floor(tilePx / 128));
  const xMod = px - Math.floor(px / period) * period;
  return xMod < half || xMod > period - half;
}

/**
 * Event mullion grid horizontal law. Floor plates land every 3.5m —
 * on a 7m tile that's two horizontal bands. The horizontal spandrel
 * (the opaque strip covering the floor slab) is a thicker rhythm than
 * the vertical mullion, so bloom at dusk reads it as the floor line
 * separating one lit storey from the next.
 */
export function eventMullionIsHorizontal(py: number, tilePx: number): boolean {
  const period = tilePx / EVENT_HORIZONTAL_FLOORS;
  const thickness = Math.max(2, Math.floor(tilePx / 64));
  const yMod = py - Math.floor(py / period) * period;
  return yMod < thickness;
}

export const EVENT_VERTICAL_MULLIONS = 2;
export const EVENT_HORIZONTAL_FLOORS = 2;

/**
 * Tree bark groove law. A tile is a small 60×60cm patch of bark; the
 * grooves run mostly vertical (bark ridges track the trunk axis) with
 * a small horizontal jitter driven by px. A pixel is in a groove if
 * its column, offset by a slow sine of py, lands under the groove
 * threshold. This is enough to give the trunk texture that reads as
 * bark without a photo.
 */
export function treeBarkHasGroove(px: number, py: number, tilePx: number): boolean {
  const period = tilePx / TREE_BARK_GROOVES;
  const jitter = Math.sin(py * 0.045) * (period * 0.28);
  const xMod = ((px + jitter) % period + period) % period;
  const grooveW = Math.max(2, Math.floor(tilePx / 40));
  return xMod < grooveW;
}

export const TREE_BARK_GROOVES = 6;

// ── the roughness law ────────────────────────────────────────────────────
//
// Each surface feature has a canonical roughness value. Brick and mortar
// are matte (~0.85); render lines on plaster are slightly rougher than
// the flat wall (a scored seam catches dust); mullions are metal-painted
// (~0.30, they read as anodised aluminium against the polished glass at
// ~0.10); bark grooves are the roughest thing in the frame (0.95).

export function roughnessAt(role: FacadeTileRole, px: number, py: number, tilePx: number): number {
  if (role === "home") {
    return homeBrickIsMortar(px, py, tilePx) ? 0.92 : 0.78;
  }
  if (role === "store") {
    return storePlasterHasLine(py, tilePx) ? 0.80 : 0.66;
  }
  if (role === "event") {
    const isMullion =
      eventMullionIsVertical(px, tilePx) || eventMullionIsHorizontal(py, tilePx);
    return isMullion ? 0.34 : 0.09;
  }
  // tree
  return treeBarkHasGroove(px, py, tilePx) ? 0.98 : 0.88;
}

// ── the normal-map height field ─────────────────────────────────────────
//
// Each surface feature displaces the tangent-space normal in a small,
// consistent way. Mortar sinks below the brick face (a valley); render
// lines are scored channels; mullions stand proud of the glass; bark
// grooves are valleys in the trunk. The height field is a scalar in
// [0, 1] where 0.5 is "flat with the wall surface"; the drawer computes
// a normal from finite differences on the height field.

export function normalHeightAt(role: FacadeTileRole, px: number, py: number, tilePx: number): number {
  if (role === "home") {
    return homeBrickIsMortar(px, py, tilePx) ? 0.32 : 0.58;
  }
  if (role === "store") {
    return storePlasterHasLine(py, tilePx) ? 0.42 : 0.54;
  }
  if (role === "event") {
    const v = eventMullionIsVertical(px, tilePx);
    const h = eventMullionIsHorizontal(py, tilePx);
    if (v || h) return 0.66;
    return 0.50;
  }
  // tree
  return treeBarkHasGroove(px, py, tilePx) ? 0.30 : 0.62;
}

/**
 * Finite-difference the height field into a tangent-space normal. The
 * returned vector is normalised; components are in [-1, 1]. This is the
 * value the atlas drawer would encode as (r = (nx+1)/2, g = (ny+1)/2,
 * b = (nz+1)/2) into a normalMap. Pure — a caller can pin the shape
 * without DOM.
 */
export function normalAt(role: FacadeTileRole, px: number, py: number, tilePx: number): {
  nx: number;
  ny: number;
  nz: number;
} {
  const step = 1;
  const hL = normalHeightAt(role, px - step, py, tilePx);
  const hR = normalHeightAt(role, px + step, py, tilePx);
  const hU = normalHeightAt(role, px, py - step, tilePx);
  const hD = normalHeightAt(role, px, py + step, tilePx);
  // Standard central-difference to a tangent normal. The z bump strength
  // controls how deep the surface reads; 4 is a modest displacement.
  const z = 4.0;
  const nx = -(hR - hL);
  const ny = -(hD - hU);
  const nz = 1.0 / z;
  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return { nx: nx / mag, ny: ny / mag, nz: nz / mag };
}

// ── albedo colour law ────────────────────────────────────────────────────
//
// The atlas is a *detail* layer: the material's own base color multiplies
// through, so the albedo values in the atlas are small variations around
// mid-gray. Mortar reads a shade darker than brick; render lines a shade
// darker than plaster; mullions much darker than glass; bark grooves
// darker than the bark itself.

export type AlbedoRGB = { r: number; g: number; b: number };

export function albedoAt(role: FacadeTileRole, px: number, py: number, tilePx: number): AlbedoRGB {
  if (role === "home") {
    // Brick warm red-brown; mortar a cooler mid-gray. Bricks also carry
    // a small per-brick jitter so the wall isn't a uniform swatch —
    // stamp the jitter from the brick index (which brick am I in?).
    const rowH = tilePx / HOME_BRICK_ROWS;
    const colW = tilePx / HOME_BRICK_COLS;
    const row = Math.floor(py / rowH);
    const shift = (row & 1) === 0 ? 0 : colW * 0.5;
    const col = Math.floor(((px + shift) % tilePx + tilePx) % tilePx / colW);
    const brickIdx = row * HOME_BRICK_COLS + col;
    const jitter = ((Math.sin(brickIdx * 12.9898) * 43758.5453) % 1 + 1) % 1;
    if (homeBrickIsMortar(px, py, tilePx)) {
      return { r: 0.42, g: 0.40, b: 0.38 };
    }
    const brickR = 0.62 + jitter * 0.10 - 0.05;
    const brickG = 0.36 + jitter * 0.08 - 0.04;
    const brickB = 0.30 + jitter * 0.06 - 0.03;
    return { r: brickR, g: brickG, b: brickB };
  }
  if (role === "store") {
    if (storePlasterHasLine(py, tilePx)) {
      return { r: 0.72, g: 0.68, b: 0.62 };
    }
    // Very slight vertical striation on the plaster — a tiny sine on
    // px so the wall doesn't stamp flat. The magnitude is small; the
    // eye reads it as "hand-rendered" not "photograph of tile".
    const stria = Math.sin(px * 0.28) * 0.014;
    return {
      r: 0.86 + stria,
      g: 0.82 + stria,
      b: 0.76 + stria,
    };
  }
  if (role === "event") {
    if (eventMullionIsVertical(px, tilePx) || eventMullionIsHorizontal(py, tilePx)) {
      return { r: 0.28, g: 0.30, b: 0.32 };
    }
    // Faint tint on the glass pane; the material color multiplies
    // through and the environment IBL supplies the actual reflection.
    return { r: 0.82, g: 0.86, b: 0.90 };
  }
  // tree — bark. Grooves are deep umber, ridges lighter.
  if (treeBarkHasGroove(px, py, tilePx)) {
    return { r: 0.28, g: 0.20, b: 0.14 };
  }
  return { r: 0.46, g: 0.32, b: 0.22 };
}

// ── primality — checked at import time ──────────────────────────────────
//
// The FACADE_REPEATS numbers are prime by construction; if a change ever
// drops one of them to a composite the test-city-textures.mjs script
// catches it, and this helper is exported so the geometry side can check
// its own footprint values too.

export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

// ── the tiled UV window helpers ─────────────────────────────────────────
//
// A caller building a per-role UV range for a mesh's uv2 attribute (or
// setting a texture's `.offset` and `.repeat` on the master atlas)
// consumes these — the tile's UV rectangle on the atlas plus the
// prime-relative repeat count for that role.

export function tileUVWindowFor(role: FacadeTileRole): TileWindow {
  return TILE_LAYOUT[role];
}

export function tileRepeatsFor(role: FacadeTileRole): UVRepeats {
  return FACADE_REPEATS[role];
}

// ── the atlas — the DOM/three side ──────────────────────────────────────
//
// Everything below this line touches HTMLCanvasElement + THREE.CanvasTexture.
// The test script does not exercise this half — it pins the pure predicates
// above. The drawer walks pixels and calls the same predicates for the
// albedo, normal, and roughness canvas so the three maps stay in sync.

export type FacadeAtlas = {
  /** Full 2×2 albedo canvas (all four tiles). */
  albedoCanvas: HTMLCanvasElement;
  /** Full 2×2 tangent-space normal canvas. */
  normalCanvas: HTMLCanvasElement;
  /** Full 2×2 roughness canvas. */
  roughnessCanvas: HTMLCanvasElement;
  /** Per-role Textures — separate CanvasTextures cropped from each
   *  master canvas so `.wrapS/T = RepeatWrapping` works cleanly without
   *  a neighbouring tile bleeding in. */
  textures: Record<FacadeTileRole, {
    map: THREE.CanvasTexture;
    normalMap: THREE.CanvasTexture;
    roughnessMap: THREE.CanvasTexture;
  }>;
  dispose(): void;
};

export type FacadeAtlasOptions = {
  /** Pixel size of each tile. The full atlas is 2× this on both axes.
   *  Defaults to 256 (a 512×512 master canvas per map). */
  tilePx?: number;
};

/**
 * Build one PBR facade atlas — albedo, tangent-space normal, roughness.
 * Runs at scene-build time; the result is passed to `facadeMaterialFor`
 * which assigns the map/normalMap/roughnessMap slots. Dispose on scene
 * unmount to free the GL textures.
 */
export function buildFacadeAtlas(opts: FacadeAtlasOptions = {}): FacadeAtlas {
  const tilePx = Math.max(32, Math.floor(opts.tilePx ?? 256));
  const atlasPx = tilePx * 2;

  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = atlasPx;
  albedoCanvas.height = atlasPx;
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = atlasPx;
  normalCanvas.height = atlasPx;
  const roughnessCanvas = document.createElement("canvas");
  roughnessCanvas.width = atlasPx;
  roughnessCanvas.height = atlasPx;

  const albedoCtx = albedoCanvas.getContext("2d");
  const normalCtx = normalCanvas.getContext("2d");
  const roughCtx = roughnessCanvas.getContext("2d");

  // Guard for headless environments (SSR paths). Without a 2D context,
  // the atlas is still allocated but blank — the material falls back to
  // its base color, which is the pre-atlas look.
  if (albedoCtx && normalCtx && roughCtx) {
    for (const role of ["home", "store", "event", "tree"] as const) {
      drawTileInto(albedoCtx, normalCtx, roughCtx, role, tilePx);
    }
  }

  // Per-role sub-textures. Each is a fresh CanvasTexture cropped from
  // the correct quadrant of the master canvas. Wrapping is Repeat on
  // both axes so `.repeat` on the texture drives the prime tiling.
  const textures = {} as FacadeAtlas["textures"];
  for (const role of ["home", "store", "event", "tree"] as const) {
    const win = TILE_LAYOUT[role];
    const px0 = Math.floor(win.u0 * atlasPx);
    const py0 = Math.floor(win.v0 * atlasPx);
    const w = Math.floor((win.u1 - win.u0) * atlasPx);
    const h = Math.floor((win.v1 - win.v0) * atlasPx);
    const reps = FACADE_REPEATS[role];

    const map = subTextureFrom(albedoCanvas, px0, py0, w, h, THREE.SRGBColorSpace);
    const normalMap = subTextureFrom(normalCanvas, px0, py0, w, h, THREE.NoColorSpace);
    const roughnessMap = subTextureFrom(roughnessCanvas, px0, py0, w, h, THREE.NoColorSpace);
    for (const t of [map, normalMap, roughnessMap]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(reps.u, reps.v);
      t.anisotropy = 4;
      t.needsUpdate = true;
    }
    textures[role] = { map, normalMap, roughnessMap };
  }

  function dispose(): void {
    for (const role of ["home", "store", "event", "tree"] as const) {
      try { textures[role].map.dispose(); } catch { /* noop */ }
      try { textures[role].normalMap.dispose(); } catch { /* noop */ }
      try { textures[role].roughnessMap.dispose(); } catch { /* noop */ }
    }
  }

  return { albedoCanvas, normalCanvas, roughnessCanvas, textures, dispose };
}

// ── the pixel walker ────────────────────────────────────────────────────
//
// Walk every pixel of the tile once. For each pixel, ask the predicates
// what the surface is, then write the corresponding value into three
// image-data buffers. One shot per role fills all three maps in sync.

function drawTileInto(
  albedoCtx: CanvasRenderingContext2D,
  normalCtx: CanvasRenderingContext2D,
  roughCtx: CanvasRenderingContext2D,
  role: FacadeTileRole,
  tilePx: number,
): void {
  const win = TILE_LAYOUT[role];
  const px0 = Math.floor(win.u0 * tilePx * 2);
  const py0 = Math.floor(win.v0 * tilePx * 2);
  const w = tilePx;
  const h = tilePx;

  const albedoImg = albedoCtx.createImageData(w, h);
  const normalImg = normalCtx.createImageData(w, h);
  const roughImg = roughCtx.createImageData(w, h);

  const aData = albedoImg.data;
  const nData = normalImg.data;
  const rData = roughImg.data;

  let i = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const rgb = albedoAt(role, x, y, tilePx);
      aData[i]     = clamp8(rgb.r * 255);
      aData[i + 1] = clamp8(rgb.g * 255);
      aData[i + 2] = clamp8(rgb.b * 255);
      aData[i + 3] = 255;

      const n = normalAt(role, x, y, tilePx);
      nData[i]     = clamp8((n.nx * 0.5 + 0.5) * 255);
      nData[i + 1] = clamp8((n.ny * 0.5 + 0.5) * 255);
      nData[i + 2] = clamp8((n.nz * 0.5 + 0.5) * 255);
      nData[i + 3] = 255;

      const rough = roughnessAt(role, x, y, tilePx);
      const r8 = clamp8(rough * 255);
      rData[i]     = r8;
      rData[i + 1] = r8;
      rData[i + 2] = r8;
      rData[i + 3] = 255;

      i += 4;
    }
  }

  albedoCtx.putImageData(albedoImg, px0, py0);
  normalCtx.putImageData(normalImg, px0, py0);
  roughCtx.putImageData(roughImg, px0, py0);
}

function subTextureFrom(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  colorSpace: THREE.ColorSpace,
): THREE.CanvasTexture {
  // Copy the tile quadrant into its own canvas so wrap modes on the
  // resulting texture stay inside the tile.
  const sub = document.createElement("canvas");
  sub.width = w;
  sub.height = h;
  const ctx = sub.getContext("2d");
  if (ctx) {
    ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
  }
  const tex = new THREE.CanvasTexture(sub);
  tex.colorSpace = colorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

// ── leaf-cluster texture — the transparent-alpha canopy tile ────────────────
//
// Trees used to be a single flattened icosphere carrying the tree tile of the
// PBR atlas as a green-ish opaque wrap. Read as diorama at any zoom past the
// mid tier. Real trees never present as a smooth green solid — the eye reads
// leaf outlines, sunlight-through-canopy holes, and rim-light on a leaf edge
// long before it reads the silhouette.
//
// The fix is a cluster of transparent-alpha leaf quads standing on a branch
// skeleton. This module authors the leaf-cluster texture: one 256×256 tile
// carrying five pointed-oval leaves in a small sprig arrangement, with alpha
// = 0 outside the leaf shape and a soft anti-aliased edge so the tree reads
// as leaves at any zoom. A companion normal map gives each leaf a rounded
// dome so grazing sunset light rim-lights the canopy edge.
//
// Everything up to `buildLeafTexture` is a pure function of pixel + tile —
// the test file walks the predicates without a canvas.

/** The number of leaves stamped into one cluster tile. */
export const LEAF_LEAVES_PER_TILE = 5;

/**
 * The 5 leaves in a cluster tile. Each entry is
 *   { cx, cy, a, b, rot }
 * where (cx, cy) is the leaf center in [0,1]² of the tile, (a, b) are the
 * half-axes of the leaf ellipse (a = long axis, b = short axis, in the tile's
 * [0,1] coord system), and rot is the leaf's rotation in radians. The layout
 * reads as a small sprig — one central leaf and four fanning around it.
 */
export const LEAF_CLUSTER_LAYOUT: readonly {
  cx: number; cy: number; a: number; b: number; rot: number;
}[] = [
  { cx: 0.50, cy: 0.50, a: 0.38, b: 0.15, rot: 0.00 },
  { cx: 0.32, cy: 0.34, a: 0.24, b: 0.10, rot: -0.85 },
  { cx: 0.68, cy: 0.34, a: 0.24, b: 0.10, rot: 0.85 },
  { cx: 0.32, cy: 0.66, a: 0.24, b: 0.10, rot: -2.30 },
  { cx: 0.68, cy: 0.66, a: 0.24, b: 0.10, rot: 2.30 },
];

/**
 * Squared normalised distance from (px, py) in [0, tilePx) to leaf `k`
 * of LEAF_CLUSTER_LAYOUT. r² <= 1 means the pixel is inside the leaf
 * ellipse. Returns the LARGEST value if the pixel is in NO leaf.
 */
export function leafClusterR2(px: number, py: number, tilePx: number): {
  best: number; leaf: number;
} {
  const u = px / tilePx;
  const v = py / tilePx;
  let best = 1e9;
  let bestLeaf = -1;
  for (let k = 0; k < LEAF_CLUSTER_LAYOUT.length; k += 1) {
    const L = LEAF_CLUSTER_LAYOUT[k];
    const dx = u - L.cx;
    const dy = v - L.cy;
    const cs = Math.cos(-L.rot);
    const sn = Math.sin(-L.rot);
    const rx = dx * cs - dy * sn;
    const ry = dx * sn + dy * cs;
    const r2 = (rx * rx) / (L.a * L.a) + (ry * ry) / (L.b * L.b);
    if (r2 < best) { best = r2; bestLeaf = k; }
  }
  return { best, leaf: bestLeaf };
}

/**
 * Alpha at (px, py) — 1 inside a leaf, 0 outside, smooth on a narrow band
 * around the leaf boundary so the leaf edge anti-aliases without a hard
 * pixel staircase. The band width is ~2% of a leaf's short axis.
 */
export function leafClusterAlphaAt(px: number, py: number, tilePx: number): number {
  const { best } = leafClusterR2(px, py, tilePx);
  // r² in [0,1] is inside the leaf; the smooth band goes from r²=0.92 to
  // r²=1.06 so the alpha ramps down over a couple of pixels.
  if (best <= 0.92) return 1;
  if (best >= 1.06) return 0;
  const t = (1.06 - best) / (1.06 - 0.92);
  return t * t * (3 - 2 * t); // smoothstep
}

/**
 * Height field for the leaf-cluster normal map. Every leaf reads as a small
 * dome — mid-vein high, edges low — so a normal map derived from finite
 * differences puts the rim of every leaf perpendicular to grazing light.
 * Outside a leaf the height falls to 0 (background); the alpha mask hides
 * that region anyway but the normal texture still needs a value.
 */
export function leafClusterHeightAt(px: number, py: number, tilePx: number): number {
  const { best, leaf } = leafClusterR2(px, py, tilePx);
  if (best >= 1.0 || leaf < 0) return 0.3;
  // Height = 0.5 at the leaf's edge (flush with the branch plane), 0.85 at
  // the mid-vein. A subtle mid-vein groove: subtract a narrow negative on
  // the rotated y-axis around 0.
  const L = LEAF_CLUSTER_LAYOUT[leaf];
  const u = px / tilePx;
  const v = py / tilePx;
  const dx = u - L.cx;
  const dy = v - L.cy;
  const cs = Math.cos(-L.rot);
  const sn = Math.sin(-L.rot);
  const ry = dx * sn + dy * cs;
  // Vein groove: |ry / L.b| very small → dip.
  const veinDip = Math.exp(-Math.pow(ry / (L.b * 0.15), 2)) * 0.06;
  const dome = 0.5 + (1 - best) * 0.4;
  return Math.max(0, Math.min(1, dome - veinDip));
}

/**
 * Normal at (px, py) — tangent-space, unit vector. Computed by central
 * differences on `leafClusterHeightAt`, exactly the shape the facade atlas
 * uses so the leaf normal map plugs into a MeshStandardMaterial the same
 * way brick/plaster/mullion/bark maps do.
 */
export function leafClusterNormalAt(px: number, py: number, tilePx: number): {
  nx: number; ny: number; nz: number;
} {
  const step = 1;
  const hL = leafClusterHeightAt(px - step, py, tilePx);
  const hR = leafClusterHeightAt(px + step, py, tilePx);
  const hU = leafClusterHeightAt(px, py - step, tilePx);
  const hD = leafClusterHeightAt(px, py + step, tilePx);
  const z = 5.0;
  const nx = -(hR - hL);
  const ny = -(hD - hU);
  const nz = 1.0 / z;
  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return { nx: nx / mag, ny: ny / mag, nz: nz / mag };
}

/**
 * Leaf-cluster albedo colour. The material's own base tint multiplies
 * through, so the atlas encodes a green mid-tone plus a small per-leaf
 * variation. Outside a leaf the RGB is neutral but alpha=0 anyway.
 */
export function leafClusterAlbedoAt(px: number, py: number, tilePx: number): {
  r: number; g: number; b: number; a: number;
} {
  const { best, leaf } = leafClusterR2(px, py, tilePx);
  const a = leafClusterAlphaAt(px, py, tilePx);
  if (a <= 0.001) return { r: 0.5, g: 0.5, b: 0.5, a: 0 };
  // Base leaf green. Small hue jitter per leaf index so a cluster reads as
  // five leaves not one repeated stamp.
  const per = leaf >= 0 ? (leaf * 0.13) % 1 : 0;
  const rimT = Math.min(1, Math.max(0, (best - 0.3) / 0.7));
  // Interior lighter, edge slightly darker + more saturated.
  const r = 0.42 + per * 0.08 - rimT * 0.12;
  const g = 0.62 + per * 0.05 - rimT * 0.05;
  const b = 0.28 + per * 0.04 - rimT * 0.10;
  return { r, g, b, a };
}

/**
 * The leaf-cluster texture built at scene time. Two CanvasTextures — one
 * RGBA albedo with alpha in the alpha channel, one tangent-space normal.
 * The caller feeds these into a MeshStandardMaterial with
 *   { map, normalMap, alphaTest: 0.5, transparent: true, side: DoubleSide }
 * so the leaf-edge alpha resolves against depth without the classic
 * transparency sort artefacts.
 */
export type LeafTexture = {
  albedoCanvas: HTMLCanvasElement;
  normalCanvas: HTMLCanvasElement;
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  dispose(): void;
};

export type LeafTextureOptions = {
  tilePx?: number;
};

export function buildLeafTexture(opts: LeafTextureOptions = {}): LeafTexture {
  const tilePx = Math.max(64, Math.floor(opts.tilePx ?? 256));
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = tilePx;
  albedoCanvas.height = tilePx;
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = tilePx;
  normalCanvas.height = tilePx;
  const aCtx = albedoCanvas.getContext("2d");
  const nCtx = normalCanvas.getContext("2d");
  if (aCtx && nCtx) {
    const aImg = aCtx.createImageData(tilePx, tilePx);
    const nImg = nCtx.createImageData(tilePx, tilePx);
    const aData = aImg.data;
    const nData = nImg.data;
    let i = 0;
    for (let y = 0; y < tilePx; y += 1) {
      for (let x = 0; x < tilePx; x += 1) {
        const alb = leafClusterAlbedoAt(x, y, tilePx);
        aData[i]     = clamp8(alb.r * 255);
        aData[i + 1] = clamp8(alb.g * 255);
        aData[i + 2] = clamp8(alb.b * 255);
        aData[i + 3] = clamp8(alb.a * 255);
        const n = leafClusterNormalAt(x, y, tilePx);
        nData[i]     = clamp8((n.nx * 0.5 + 0.5) * 255);
        nData[i + 1] = clamp8((n.ny * 0.5 + 0.5) * 255);
        nData[i + 2] = clamp8((n.nz * 0.5 + 0.5) * 255);
        nData[i + 3] = 255;
        i += 4;
      }
    }
    aCtx.putImageData(aImg, 0, 0);
    nCtx.putImageData(nImg, 0, 0);
  }
  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.magFilter = THREE.LinearFilter;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.wrapS = THREE.ClampToEdgeWrapping;
  albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.generateMipmaps = true;
  albedo.anisotropy = 4;
  albedo.needsUpdate = true;

  const normal = new THREE.CanvasTexture(normalCanvas);
  normal.colorSpace = THREE.NoColorSpace;
  normal.magFilter = THREE.LinearFilter;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.wrapS = THREE.ClampToEdgeWrapping;
  normal.wrapT = THREE.ClampToEdgeWrapping;
  normal.generateMipmaps = true;
  normal.needsUpdate = true;

  function dispose(): void {
    try { albedo.dispose(); } catch { /* noop */ }
    try { normal.dispose(); } catch { /* noop */ }
  }
  return { albedoCanvas, normalCanvas, albedo, normal, dispose };
}

// ── seasonal leaf tint law ─────────────────────────────────────────────────
//
// The one input trees answer is the season. The material's `.color` is the
// seasonal multiplier that turns the atlas's mid-green leaf into spring
// yellow-green, summer deep green, fall ochre, winter bare-branch grey. The
// canopy scale rides the same axis via `treeFoliage(season)` in city.ts, so
// winter shrinks the canopy AND desaturates every leaf.

export type LeafSeasonTint = { r: number; g: number; b: number };

export function leafTintForSeason(season: "spring" | "summer" | "fall" | "winter"): LeafSeasonTint {
  switch (season) {
    case "spring": return { r: 1.05, g: 1.15, b: 0.65 }; // yellow-green new growth
    case "summer": return { r: 0.90, g: 1.10, b: 0.65 }; // full deep green
    case "fall":   return { r: 1.35, g: 0.85, b: 0.35 }; // ochre / red-orange
    case "winter": return { r: 0.55, g: 0.50, b: 0.45 }; // bare branches — near-neutral, the alpha carries the "gone" reading
  }
}
