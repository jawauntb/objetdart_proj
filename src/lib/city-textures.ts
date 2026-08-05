/**
 * city-textures — the PBR facade atlas that makes 48 extruded prisms
 * finally read as architecture at close zoom.
 *
 * BEFORE this pass the atlas was a set of clean binary predicates —
 * brick / not brick, mullion / glass, groove / ridge — flattened into
 * three luminance ramps: albedo, normal-height, roughness. That reads
 * as "printed decal" at close zoom because a real brick wall is NEVER
 * three luminance levels. It is per-brick chromatic dispersion, sub-
 * brick grain, rain-driven staining below every mortar seam, small
 * chips at the arris, faint efflorescence patches, and a micro-normal
 * that never lies flat. A polished glass pane carries subtle streaks
 * from the cleaning squeegee. A plaster wall carries a decade of
 * capillary staining below every render line.
 *
 * This pass keeps the same four tiles, the same layout, the same
 * prime tiling. What changes is what happens INSIDE each tile:
 *
 *   1. A deterministic 2-D value-noise hash + 4-octave fBm layered on
 *      the raw predicates. Every pixel now carries a continuous grain
 *      that averages to the predicate's mean but never sits at it.
 *
 *   2. Per-brick chromatic dispersion — each brick hashes to its own
 *      (r, g, b) triple around the warm red-brown centroid, so a wall
 *      reads as forty individually-fired bricks rather than one paint
 *      colour with mortar. Includes small chip darkening near the
 *      running-bond corners.
 *
 *   3. Weathering. A vertical staining streak descends from every
 *      mortar seam — capillary water carrying dissolved lime and dust.
 *      Efflorescence spots on masonry. Streaks below the cornice on
 *      plaster. Cleaning-squeegee streaks on glass.
 *
 *   4. A real ambient-occlusion channel — the fourth PBR map, wired
 *      through material.aoMap in city-facades.ts. Occlusion darkens
 *      the mortar valleys, the mullion corners, the bark grooves, and
 *      the render-line seams so the light response reads as recessed
 *      geometry rather than a painted stripe.
 *
 *   5. A micro-normal layer that perturbs the tangent field on FLAT
 *      surfaces — brick faces, plaster fields, glass panes — so the
 *      sun rakes across a wall with a soft grain rather than a mirror.
 *
 * The atlas is authored once at scene-build time (still one bake, still
 * pure GPU-once — never per-frame) at a HIGHER default resolution
 * (512 px per tile, so a 1024² master canvas per map — 2K facade
 * atlas). The per-role subtextures request `anisotropy = 8` so the
 * grazing-angle shots down a street stay crisp instead of blurring.
 *
 * The pure predicates below still exist and still drive the higher-
 * level laws (`homeBrickIsMortar` etc.). Tests in
 * scripts/test-city-textures.mjs pin BOTH the old binary predicates
 * (backwards compatible) AND the new detail layers (FBM determinism,
 * weathering direction, AO ranges). Anything that reads the atlas
 * gets four maps: map / normalMap / roughnessMap / aoMap.
 *
 * Nothing here changes the city.ts causal laws, the dwell ladder, the
 * emissive-window law, or the curtain-wall shader. The atlas is a
 * detail layer the geometry pass consumes; its colours multiply
 * through each material's base tint.
 */

import * as THREE from "three";

// ── the four tiles: layout on the master atlas ──────────────────────────

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

/** Anisotropy set on every atlas subtexture. Grazing-angle shots down
 *  a street need >=8 to stay crisp; 4 blurs the brick coursing at
 *  street level. Kept as an exported constant so a governor tier can
 *  ramp it if the GPU can afford more. */
export const FACADE_ANISOTROPY = 8;

// ── the pure predicates: what is mortar / render line / mullion / groove ─

export function homeBrickIsMortar(px: number, py: number, tilePx: number): boolean {
  const rowH = tilePx / HOME_BRICK_ROWS;
  const colW = tilePx / HOME_BRICK_COLS;
  const mortar = Math.max(1, Math.floor(tilePx / 128));
  const row = Math.floor(py / rowH);
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

export function storePlasterHasLine(py: number, tilePx: number): boolean {
  const period = tilePx / STORE_RENDER_LINES;
  const thickness = Math.max(1, Math.floor(tilePx / 256));
  const yMod = py - Math.floor(py / period) * period;
  return yMod < thickness;
}

export const STORE_RENDER_LINES = 4;

export function eventMullionIsVertical(px: number, tilePx: number): boolean {
  const period = tilePx / EVENT_VERTICAL_MULLIONS;
  const half = Math.max(1, Math.floor(tilePx / 128));
  const xMod = px - Math.floor(px / period) * period;
  return xMod < half || xMod > period - half;
}

export function eventMullionIsHorizontal(py: number, tilePx: number): boolean {
  const period = tilePx / EVENT_HORIZONTAL_FLOORS;
  const thickness = Math.max(2, Math.floor(tilePx / 64));
  const yMod = py - Math.floor(py / period) * period;
  return yMod < thickness;
}

export const EVENT_VERTICAL_MULLIONS = 2;
export const EVENT_HORIZONTAL_FLOORS = 2;

export function treeBarkHasGroove(px: number, py: number, tilePx: number): boolean {
  const period = tilePx / TREE_BARK_GROOVES;
  const jitter = Math.sin(py * 0.045) * (period * 0.28);
  const xMod = ((px + jitter) % period + period) % period;
  const grooveW = Math.max(2, Math.floor(tilePx / 40));
  return xMod < grooveW;
}

export const TREE_BARK_GROOVES = 6;

// ── noise primitives ────────────────────────────────────────────────────
//
// The predicates above give binary structure. The photoreal detail lives
// in what happens INSIDE each region. These are the small building blocks
// every enrichment below stacks on top of the predicates. All pure and
// deterministic — the same (x, y, tilePx, role) reads the same value
// forever, so the atlas bakes identically on every machine and the tests
// can pin exact points.

/** Two-argument hash mapping (nx, ny) → a stable value in [0, 1). */
export function hash21(nx: number, ny: number): number {
  const s = Math.sin(nx * 127.1 + ny * 311.7) * 43758.5453;
  return ((s % 1) + 1) % 1;
}

/** Value noise: bilinear interpolation of hash21 on the integer lattice.
 *  Returns a value in [0, 1). */
export function valueNoise2(nx: number, ny: number): number {
  const ix = Math.floor(nx);
  const iy = Math.floor(ny);
  const fx = nx - ix;
  const fy = ny - iy;
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  // Smoothstep interpolation (Ken Perlin's fade) keeps the tangent
  // continuous so a differentiated height field yields a smooth normal.
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const abx = a * (1 - ux) + b * ux;
  const cdx = c * (1 - ux) + d * ux;
  return abx * (1 - uy) + cdx * uy;
}

/** Fractional Brownian motion: sum of `octaves` value-noise octaves
 *  with lacunarity 2 and gain 0.5. Returns [0, 1] (normalised by the
 *  geometric-sum of gains). Pure — deterministic on (nx, ny, octaves). */
export function fbm2(nx: number, ny: number, octaves: number = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * valueNoise2(nx * freq, ny * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

// ── weathering law ──────────────────────────────────────────────────────
//
// Real building walls have staining. Water enters at the mortar seam,
// runs down the brick face, deposits dissolved lime as it evaporates.
// The result: a vertical, tapering, darker streak below every seam.
// Below a cornice on plaster, the same phenomenon draws long dark
// bands from the render line to the wall's base. On a glass pane, the
// stain reads as a soft cleaning-squeegee stripe.
//
// `weatheringStreak01` returns 0..1: 0 = no staining, 1 = heavy stain.
// The streak descends from every mortar seam / render line / horizontal
// mullion. The amount tapers over ~1/3 of a tile height. FBM modulates
// the streak so it never draws a straight rectangle.

/**
 * Height (in tile pixels) below the nearest horizontal feature. Used
 * by `weatheringStreak01` to drive the vertical taper. Returns 0 if
 * the pixel is *on* a feature, up to `maxDropPx` below the feature.
 */
export function pxBelowFeature(
  role: FacadeTileRole,
  px: number,
  py: number,
  tilePx: number,
): number {
  // Find the y of the last horizontal feature above (or at) py.
  // For each role: mortar seams, render lines, floor plates, or (for
  // tree) the top of the tile.
  let period = tilePx;
  if (role === "home") {
    period = tilePx / HOME_BRICK_ROWS;
  } else if (role === "store") {
    period = tilePx / STORE_RENDER_LINES;
  } else if (role === "event") {
    period = tilePx / EVENT_HORIZONTAL_FLOORS;
  } else {
    period = tilePx;
  }
  const yMod = py - Math.floor(py / period) * period;
  return yMod;
}

/**
 * The staining intensity at a pixel. Ranges [0, 1]. Zero at the top
 * of a period (dry masonry just above the mortar seam), rising sharply
 * to peak a few pixels below the seam, then decaying to zero as the
 * water runs out over the next ~1/3 of a tile. Horizontal position
 * modulates by FBM to break the streak into vertical rivulets.
 *
 * The store's plaster carries stronger staining (Victorian render
 * pulls water for longer); the event's glass carries only a faint
 * squeegee streak; the tree's bark has no water staining (bark is
 * absorbent, not shedding). Home masonry: moderate.
 */
export function weatheringStreak01(
  role: FacadeTileRole,
  px: number,
  py: number,
  tilePx: number,
): number {
  if (role === "tree") return 0;
  const period = role === "home"
    ? tilePx / HOME_BRICK_ROWS
    : role === "store"
      ? tilePx / STORE_RENDER_LINES
      : tilePx / EVENT_HORIZONTAL_FLOORS;
  const drop = pxBelowFeature(role, px, py, tilePx);
  const dropFrac = drop / Math.max(1, period);
  // Peak envelope: rises for the first 8%, then decays over the rest.
  const peakFrac = 0.08;
  const envelope = dropFrac < peakFrac
    ? dropFrac / peakFrac
    : Math.max(0, 1 - (dropFrac - peakFrac) / (1 - peakFrac));
  // Horizontal modulation: two-octave FBM breaks the streak into
  // rivulets. The x-scale is a small number so streaks are ~10cm wide.
  const rivulet = fbm2(px / (tilePx * 0.06), py / (tilePx * 0.24), 3);
  // rivulet in [0,1]; center it so ~half the wall stays clean.
  const rivGate = Math.max(0, rivulet - 0.42) / 0.58;
  // Strength per role.
  const strength = role === "store" ? 1.0 : role === "home" ? 0.7 : 0.35;
  return envelope * rivGate * strength;
}

// ── micro-normal detail ─────────────────────────────────────────────────
//
// Even a flat brick face has grain — sand inclusions, firing scars, tiny
// bloating from the kiln. The old normal map read three discrete levels
// (mortar, flat wall, mullion). The new micro-normal layer adds a small
// FBM height perturbation so the sun's grazing pass reveals the grain.
//
// `microHeight01` returns the perturbation added to `normalHeightAt`.
// It stays small (±0.06) so the coursing structure still dominates the
// finite-difference normal computation.

export function microHeight01(
  role: FacadeTileRole,
  px: number,
  py: number,
  tilePx: number,
): number {
  // Different scales per role. Bricks have coarser grain than glass.
  const scale = role === "home"
    ? tilePx / 24
    : role === "store"
      ? tilePx / 48
      : role === "event"
        ? tilePx / 64
        : tilePx / 12;
  const g = fbm2(px / scale, py / scale, 3);
  // g in [0,1]; centre on 0 with ±0.5 range, then damp to ±0.06.
  return (g - 0.5) * 0.12;
}

// ── the roughness law (enriched) ────────────────────────────────────────

export function roughnessAt(role: FacadeTileRole, px: number, py: number, tilePx: number): number {
  // Base value: the same as before, driven by the binary predicate.
  let base: number;
  if (role === "home") {
    base = homeBrickIsMortar(px, py, tilePx) ? 0.92 : 0.78;
  } else if (role === "store") {
    base = storePlasterHasLine(py, tilePx) ? 0.80 : 0.66;
  } else if (role === "event") {
    const isMullion =
      eventMullionIsVertical(px, tilePx) || eventMullionIsHorizontal(py, tilePx);
    base = isMullion ? 0.34 : 0.09;
  } else {
    base = treeBarkHasGroove(px, py, tilePx) ? 0.98 : 0.88;
  }
  // Weathering: stained regions read rougher (dust settles, film builds).
  const w = weatheringStreak01(role, px, py, tilePx);
  const weatheredBias = role === "event" ? 0.05 : 0.10;
  base += w * weatheredBias;
  // Micro-detail: small hash-driven jitter around the base value. Keep
  // amplitude small so the roughness stays in-family (mortar still >
  // brick, glass still low).
  const noise = fbm2(px / (tilePx * 0.02), py / (tilePx * 0.02), 2);
  base += (noise - 0.5) * 0.04;
  return base < 0 ? 0 : base > 1 ? 1 : base;
}

// ── the normal-map height field (enriched) ──────────────────────────────

export function normalHeightAt(role: FacadeTileRole, px: number, py: number, tilePx: number): number {
  let h: number;
  if (role === "home") {
    h = homeBrickIsMortar(px, py, tilePx) ? 0.32 : 0.58;
  } else if (role === "store") {
    h = storePlasterHasLine(py, tilePx) ? 0.42 : 0.54;
  } else if (role === "event") {
    const v = eventMullionIsVertical(px, tilePx);
    const hz = eventMullionIsHorizontal(py, tilePx);
    h = (v || hz) ? 0.66 : 0.50;
  } else {
    h = treeBarkHasGroove(px, py, tilePx) ? 0.30 : 0.62;
  }
  h += microHeight01(role, px, py, tilePx);
  return h < 0 ? 0 : h > 1 ? 1 : h;
}

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
  const z = 4.0;
  const nx = -(hR - hL);
  const ny = -(hD - hU);
  const nz = 1.0 / z;
  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return { nx: nx / mag, ny: ny / mag, nz: nz / mag };
}

// ── ambient occlusion law ───────────────────────────────────────────────
//
// The AO channel darkens contact zones — the crook between a brick face
// and its mortar bed, the corner where a mullion meets a spandrel, the
// bottom of a bark groove. This is what makes a wall read as recessed
// geometry rather than a painted stripe. Values in [0, 1]: 1 = fully lit,
// 0 = deep contact shadow. The atlas encodes AO as a greyscale channel
// (R=G=B=aoAt*255) and city-facades wires it through material.aoMap.
//
// The AO field is a convolution of the height field with a small
// occluder kernel. We approximate with a cheap: "how many neighbours
// within a small radius sit ABOVE this pixel's height?" — the more
// occluders, the darker. That approximation matches real screen-space AO
// well enough for a static baked map.

export function aoAt(role: FacadeTileRole, px: number, py: number, tilePx: number): number {
  const h0 = normalHeightAt(role, px, py, tilePx);
  // A 4-tap ring at radius 2 pixels: cheap enough to bake but captures
  // the mortar-valley / mullion-corner darkening the eye reads.
  let occluders = 0;
  const R = Math.max(1, Math.floor(tilePx / 128) + 1);
  const samples: [number, number][] = [
    [+R, 0], [-R, 0], [0, +R], [0, -R],
    [+R, +R], [-R, +R], [+R, -R], [-R, -R],
  ];
  for (const [dx, dy] of samples) {
    const hn = normalHeightAt(role, px + dx, py + dy, tilePx);
    if (hn > h0 + 0.02) occluders += 1;
  }
  // Base AO: 1.0 (fully lit), drops proportional to occluders / 8.
  let ao = 1 - (occluders / samples.length) * 0.55;
  // Weathering also darkens (soot + film absorb light).
  const w = weatheringStreak01(role, px, py, tilePx);
  ao -= w * 0.12;
  // Micro-noise for surface irregularity — very small.
  const n = fbm2(px / (tilePx * 0.03), py / (tilePx * 0.03), 2);
  ao += (n - 0.5) * 0.05;
  return ao < 0 ? 0 : ao > 1 ? 1 : ao;
}

// ── albedo colour law (enriched with dispersion + weathering) ───────────
//
// Real fired brick shows chromatic dispersion — each brick fires slightly
// differently in the kiln, so a wall shows a scattered range from paler
// buff through the warm centroid down to deep umber. Efflorescence draws
// pale ghosts on masonry. Weathering deposits darker streaks below every
// seam. Glass panes carry cool squeegee streaks. Plaster reads warmer
// where the sun hits, cooler where it stays damp.

export type AlbedoRGB = { r: number; g: number; b: number };

/** Per-brick chromatic centroid: two hashes drive brightness (all
 *  channels together) and warmth (a subtle hue drift restricted to the
 *  warm axis so r > g > b holds for every fired brick, not just on
 *  average). Exported so tests can verify the wall reads as many
 *  individually-fired bricks rather than one paint colour. */
export function homeBrickChromatic(brickIdx: number): AlbedoRGB {
  // Offsets on both axes guarantee non-zero inputs for brickIdx=0 so
  // the corner brick doesn't collapse to a dark outlier.
  const bright = hash21(brickIdx * 12.9898 + 3.71, brickIdx * 78.233 + 5.13);
  const warmth = hash21(brickIdx * 5.113 + 1.79, brickIdx * 9.131 + 4.91);
  // Brightness offset moves ALL channels together so it can't flip the
  // channel ordering. Warmth offset shifts R most, G a touch, B not at
  // all — a hotter fire never turns a brick blue.
  const b0 = bright * 0.10 - 0.05;
  const w0 = (warmth - 0.5) * 0.06;
  return {
    r: 0.60 + b0 + w0,
    g: 0.36 + b0 + w0 * 0.4,
    b: 0.28 + b0,
  };
}

export function albedoAt(role: FacadeTileRole, px: number, py: number, tilePx: number): AlbedoRGB {
  const w = weatheringStreak01(role, px, py, tilePx);
  const grain = fbm2(px / (tilePx * 0.015), py / (tilePx * 0.015), 3);
  const grainMod = (grain - 0.5) * 0.06;

  if (role === "home") {
    const rowH = tilePx / HOME_BRICK_ROWS;
    const colW = tilePx / HOME_BRICK_COLS;
    const row = Math.floor(py / rowH);
    const shift = (row & 1) === 0 ? 0 : colW * 0.5;
    const col = Math.floor(((px + shift) % tilePx + tilePx) % tilePx / colW);
    const brickIdx = row * HOME_BRICK_COLS + col;
    if (homeBrickIsMortar(px, py, tilePx)) {
      // Mortar: cool mid-gray, weathering deepens it. Keep spread near
      // zero (mortar is deliberately more neutral than brick).
      let r = 0.42 + grainMod;
      let g = 0.40 + grainMod;
      let b = 0.38 + grainMod;
      r -= w * 0.12;
      g -= w * 0.12;
      b -= w * 0.10;
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
    }
    // Brick: per-brick chromatic centroid plus intra-brick grain.
    const c = homeBrickChromatic(brickIdx);
    let r = c.r + grainMod;
    let g = c.g + grainMod * 0.9;
    let b = c.b + grainMod * 0.8;
    // Weathering darkens brick asymmetrically (blue-ish film).
    r -= w * 0.10;
    g -= w * 0.08;
    b -= w * 0.05;
    // Efflorescence: rare pale spots, hash-gated on the brick index.
    if (hash21(brickIdx * 13.7, brickIdx * 17.1) > 0.92) {
      const spot = fbm2(px / (tilePx * 0.02), py / (tilePx * 0.02), 2);
      const gate = Math.max(0, spot - 0.65) * 0.4;
      r += gate; g += gate; b += gate;
    }
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
  }

  if (role === "store") {
    if (storePlasterHasLine(py, tilePx)) {
      let r = 0.72 + grainMod;
      let g = 0.68 + grainMod;
      let b = 0.62 + grainMod;
      r -= w * 0.14; g -= w * 0.14; b -= w * 0.10;
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
    }
    // Plaster body: warm cream with subtle striation + weathering streaks.
    const stria = Math.sin(px * 0.28) * 0.014;
    let r = 0.86 + stria + grainMod;
    let g = 0.82 + stria + grainMod * 0.95;
    let b = 0.76 + stria + grainMod * 0.85;
    // Staining: gray-green cast below cornices (Victorian render tell).
    r -= w * 0.20;
    g -= w * 0.16;
    b -= w * 0.12;
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
  }

  if (role === "event") {
    if (eventMullionIsVertical(px, tilePx) || eventMullionIsHorizontal(py, tilePx)) {
      // Anodised aluminium — cool mid-grey with a hint of blue.
      let r = 0.28 + grainMod * 0.5;
      let g = 0.30 + grainMod * 0.5;
      let b = 0.32 + grainMod * 0.5;
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
    }
    // Glass pane: faint cool tint. Cleaning streaks (weathering * cool tint).
    let r = 0.82 + grainMod * 0.3;
    let g = 0.86 + grainMod * 0.3;
    let b = 0.90 + grainMod * 0.3;
    r -= w * 0.06;
    g -= w * 0.05;
    b -= w * 0.03;
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
  }

  // tree — bark. Grooves deep umber, ridges lighter with per-strip drift.
  if (treeBarkHasGroove(px, py, tilePx)) {
    const drift = fbm2(px / (tilePx * 0.03), py / (tilePx * 0.03), 2) * 0.10;
    return {
      r: clamp01(0.24 + drift),
      g: clamp01(0.18 + drift * 0.9),
      b: clamp01(0.12 + drift * 0.7),
    };
  }
  const drift = fbm2(px / (tilePx * 0.02), py / (tilePx * 0.02), 3);
  return {
    r: clamp01(0.42 + drift * 0.14),
    g: clamp01(0.30 + drift * 0.12),
    b: clamp01(0.20 + drift * 0.10),
  };
}

// ── primality — checked at import time ──────────────────────────────────

export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

// ── the tiled UV window helpers ─────────────────────────────────────────

export function tileUVWindowFor(role: FacadeTileRole): TileWindow {
  return TILE_LAYOUT[role];
}

export function tileRepeatsFor(role: FacadeTileRole): UVRepeats {
  return FACADE_REPEATS[role];
}

// ── the atlas — the DOM/three side ──────────────────────────────────────

export type FacadeAtlas = {
  /** Full 2×2 albedo canvas (all four tiles). */
  albedoCanvas: HTMLCanvasElement;
  /** Full 2×2 tangent-space normal canvas. */
  normalCanvas: HTMLCanvasElement;
  /** Full 2×2 roughness canvas. */
  roughnessCanvas: HTMLCanvasElement;
  /** Full 2×2 ambient occlusion canvas. */
  aoCanvas: HTMLCanvasElement;
  /** Per-role Textures — separate CanvasTextures cropped from each
   *  master canvas so `.wrapS/T = RepeatWrapping` works cleanly. */
  textures: Record<FacadeTileRole, {
    map: THREE.CanvasTexture;
    normalMap: THREE.CanvasTexture;
    roughnessMap: THREE.CanvasTexture;
    aoMap: THREE.CanvasTexture;
  }>;
  dispose(): void;
};

export type FacadeAtlasOptions = {
  /** Pixel size of each tile. The full atlas is 2× this on both axes.
   *  Defaults to 512 — a 1024² master canvas per map (2K facade atlas).
   *  Tests pin the small-tile path at 128 for speed; runtime scenes
   *  bake at 512 so a close-zoom brick reads its grain honestly. */
  tilePx?: number;
  /** Anisotropy set on every subtexture. Defaults to `FACADE_ANISOTROPY`
   *  (8). Set higher only if the governor's inspection reports the GPU
   *  supports 16 — most desktop GL contexts do, mobile clamps at 4. */
  anisotropy?: number;
};

/**
 * Build one PBR facade atlas — albedo, tangent-space normal, roughness,
 * ambient occlusion. Runs at scene-build time; the result is passed to
 * `facadeMaterialFor` which assigns the map/normalMap/roughnessMap/aoMap
 * slots. Dispose on scene unmount to free the GL textures.
 */
export function buildFacadeAtlas(opts: FacadeAtlasOptions = {}): FacadeAtlas {
  const tilePx = Math.max(32, Math.floor(opts.tilePx ?? 512));
  const aniso = Math.max(1, Math.floor(opts.anisotropy ?? FACADE_ANISOTROPY));
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
  const aoCanvas = document.createElement("canvas");
  aoCanvas.width = atlasPx;
  aoCanvas.height = atlasPx;

  const albedoCtx = albedoCanvas.getContext("2d");
  const normalCtx = normalCanvas.getContext("2d");
  const roughCtx = roughnessCanvas.getContext("2d");
  const aoCtx = aoCanvas.getContext("2d");

  if (albedoCtx && normalCtx && roughCtx && aoCtx) {
    for (const role of ["home", "store", "event", "tree"] as const) {
      drawTileInto(albedoCtx, normalCtx, roughCtx, aoCtx, role, tilePx);
    }
  }

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
    const aoMap = subTextureFrom(aoCanvas, px0, py0, w, h, THREE.NoColorSpace);
    for (const t of [map, normalMap, roughnessMap, aoMap]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(reps.u, reps.v);
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
    textures[role] = { map, normalMap, roughnessMap, aoMap };
  }

  function dispose(): void {
    for (const role of ["home", "store", "event", "tree"] as const) {
      try { textures[role].map.dispose(); } catch { /* noop */ }
      try { textures[role].normalMap.dispose(); } catch { /* noop */ }
      try { textures[role].roughnessMap.dispose(); } catch { /* noop */ }
      try { textures[role].aoMap.dispose(); } catch { /* noop */ }
    }
  }

  return { albedoCanvas, normalCanvas, roughnessCanvas, aoCanvas, textures, dispose };
}

// ── the pixel walker ────────────────────────────────────────────────────

function drawTileInto(
  albedoCtx: CanvasRenderingContext2D,
  normalCtx: CanvasRenderingContext2D,
  roughCtx: CanvasRenderingContext2D,
  aoCtx: CanvasRenderingContext2D,
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
  const aoImg = aoCtx.createImageData(w, h);

  const aData = albedoImg.data;
  const nData = normalImg.data;
  const rData = roughImg.data;
  const oData = aoImg.data;

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

      const ao = aoAt(role, x, y, tilePx);
      const o8 = clamp8(ao * 255);
      oData[i]     = o8;
      oData[i + 1] = o8;
      oData[i + 2] = o8;
      oData[i + 3] = 255;

      i += 4;
    }
  }

  albedoCtx.putImageData(albedoImg, px0, py0);
  normalCtx.putImageData(normalImg, px0, py0);
  roughCtx.putImageData(roughImg, px0, py0);
  aoCtx.putImageData(aoImg, px0, py0);
}

function subTextureFrom(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  colorSpace: THREE.ColorSpace,
): THREE.CanvasTexture {
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
