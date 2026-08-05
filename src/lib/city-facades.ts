/**
 * city-facades — the per-role PBR materials for /city.
 *
 * The brief pins the aesthetic ladder for /city at Disney/Pixar photoreal
 * (SF financial district, London City at dusk, Zootopia). That standard
 * lives in one place — this module — and the render pass consumes it.
 *
 * Each civic role gets a material tuned to what it IS in the world:
 *
 *   home  → MeshStandardMaterial, brick/plaster surface. Rough (0.72),
 *           low metalness (0.04), a warm off-white body — the residential
 *           block from three references down. Bricks read as matte,
 *           windows carry their own emissive.
 *
 *   store → MeshStandardMaterial, warmer plaster/stucco. A shade more
 *           yellow than a home, slightly less rough (0.62) so an awning
 *           edge catches the sun. This is a home densified into commerce —
 *           same footprint, different verb, same material family.
 *
 *   event → MeshPhysicalMaterial with transmission, iridescence, and
 *           clearcoat. This is the Gherkin / Salesforce / Transamerica
 *           lookup: a tall glass tower whose surface refracts the sky,
 *           picks up a faint rainbow at grazing angles, and carries a
 *           clear varnish so the reflections stay disciplined instead of
 *           milky. Metalness low (glass is a dielectric), roughness low
 *           (real curtain-wall glass is polished), transmission 0.2 so
 *           the sky beyond half-shows through the corner panels.
 *
 *   tree  → MeshStandardMaterial. Foliage is a diffuse mass with a
 *           subtle green tint; the trunk uses the same shader family
 *           with a bark roughness value. Kept in the same family so a
 *           park reads as one small biome and not two disjoint props.
 *
 * The window emissive is where the dusk moment lives. Each building gets
 * its own per-instance canvas texture whose cells are gated by
 * `windowIsLit(litFraction, plotSeed, row, col)` from city-windows.ts. The
 * canvas is written once at build time (or once per hour on tier bumps)
 * and read as `emissiveMap` on the material. Bloom in city-composer.ts
 * picks up the emissive above threshold at dusk and produces the halo
 * the brief calls the emotional peak.
 *
 * These are exported as factory functions rather than lazy singletons —
 * a plot's material MUST be its own so the emissive map can be its own,
 * and disposing on unmount is a per-plot loop.
 *
 * Nothing here touches gesture, city.ts laws, or persistence. This is a
 * pure materials palette the next 3D-geometry PR consumes.
 */

import * as THREE from "three";
import { emissiveIntensityForDay as _dropShimEmissive, litFractionForDay, windowIsLit } from "./city-windows";
import type { PlotRole } from "./city";

// Re-export for callers that expect the emissive dial to live alongside
// the material factories. The pure implementation is in city-windows.ts
// (so it stays testable by scripts/test-city-windows.mjs without pulling
// three into the loader), but a caller building a MeshStandardMaterial
// usually wants the dial in the same module — so we re-export it here.
export const emissiveIntensityForDay = _dropShimEmissive;

// ── colors ───────────────────────────────────────────────────────────────
//
// All colors are sRGB. Three's ACESFilmic tonemapping in the renderer
// will slightly darken/saturate them — the values here are what the eye
// should read on a mid-brightness screen, not what the render target
// receives. A future palette test can pin these so a paint refactor
// doesn't drift the residential block from "warm off-white" to grey.

export const FACADE_COLORS = {
  /** Home brick/plaster — warm off-white with a small cream cast. */
  home:  0xE6D9C4,
  /** Store stucco — a touch warmer / more yellow than home. */
  store: 0xE8C89A,
  /** Event glass — cool blue-grey; the material's transmission/clearcoat
   *  will lift color from the sky, so the base stays neutral. */
  event: 0xB8CCD8,
  /** Tree foliage — deep leaf green. */
  tree:  0x2D6B3F,
  /** Tree trunk — a mid brown; the trunk is a small structural stem. */
  trunk: 0x5A3E2A,
} as const;

/** The warm tungsten emissive color for lit windows. Warm at 2700K. */
export const WINDOW_LIT_COLOR = 0xFFC58A;
/** The dark (unlit) window color — a very deep charcoal blue. Lets the
 *  reflection/transmission on event glass carry the corner panels. */
export const WINDOW_DARK_COLOR = 0x1B2028;

// ── PBR materials ────────────────────────────────────────────────────────

/**
 * Build a fresh MeshStandardMaterial for the residential roles. Passing
 * the plot seed lets us drift the base color per-instance so a row of
 * homes reads as forty-eight homes.
 *
 * The material is created without any texture maps here — the geometry
 * pass supplies a normal map for the facade tiles and this material's
 * `emissiveMap` is set to the per-instance window canvas below.
 */
export function facadeMaterialFor(role: PlotRole, plotSeed: number): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const drift = seedHash01(plotSeed);
  switch (role) {
    case "home": {
      const base = tintDrift(FACADE_COLORS.home, drift, 0.06);
      const m = new THREE.MeshStandardMaterial({
        color: base,
        roughness: 0.72,
        metalness: 0.04,
        emissive: new THREE.Color(WINDOW_LIT_COLOR),
        emissiveIntensity: 0.0,
      });
      m.name = "cityFacade.home";
      return m;
    }
    case "store": {
      const base = tintDrift(FACADE_COLORS.store, drift, 0.08);
      const m = new THREE.MeshStandardMaterial({
        color: base,
        roughness: 0.62,
        metalness: 0.06,
        emissive: new THREE.Color(WINDOW_LIT_COLOR),
        emissiveIntensity: 0.0,
      });
      m.name = "cityFacade.store";
      return m;
    }
    case "event": {
      // The tower. Transmission for the glass, iridescence for the
      // grazing-angle rainbow the Salesforce panels show at sunset,
      // clearcoat for the polished curtain wall. These are the four
      // dials the brief calls out by name.
      const base = tintDrift(FACADE_COLORS.event, drift, 0.05);
      const m = new THREE.MeshPhysicalMaterial({
        color: base,
        roughness: 0.10,
        metalness: 0.00,          // glass is a dielectric
        transmission: 0.20,        // the sky reads faintly through corners
        thickness: 0.35,           // the wall has a body — refraction band
        ior: 1.45,                 // architectural glass
        iridescence: 0.15,         // the grazing-angle rainbow
        iridescenceIOR: 1.30,
        clearcoat: 0.60,
        clearcoatRoughness: 0.10,
        emissive: new THREE.Color(WINDOW_LIT_COLOR),
        emissiveIntensity: 0.0,
      });
      m.name = "cityFacade.event";
      return m;
    }
    case "tree": {
      const base = tintDrift(FACADE_COLORS.tree, drift, 0.10);
      const m = new THREE.MeshStandardMaterial({
        color: base,
        roughness: 0.90,
        metalness: 0.0,
      });
      m.name = "cityFacade.tree";
      return m;
    }
    case "empty":
    default: {
      const m = new THREE.MeshStandardMaterial({
        color: 0x2A2A2A,
        roughness: 1.0,
        metalness: 0.0,
      });
      m.name = "cityFacade.empty";
      return m;
    }
  }
}

// ── the emissive window canvas ───────────────────────────────────────────
//
// This is the visible part of the dusk moment. Each building gets its own
// canvas texture where lit cells write the warm tungsten color and unlit
// cells write the deep dark. The canvas is the material's `emissiveMap`;
// as the material's `emissiveIntensity` rises through dusk (driven by
// the room's per-frame update), the lit cells push above the bloom
// threshold and the block starts to glow.
//
// The grid size is tuned so a tall event tower reads as a curtain wall
// and a home reads as a house with a few square windows. Rows scale with
// building height; cols with width.

export type WindowGridSize = {
  rows: number;
  cols: number;
};

export const WINDOW_GRIDS: Record<Exclude<PlotRole, "empty">, WindowGridSize> = {
  // 2–4 stories, 3 windows across — a brownstone.
  home:  { rows: 3, cols: 3 },
  // 4–7 stories, wider footprint — mixed-use storefront above the awning.
  store: { rows: 5, cols: 4 },
  // 20+ stories, curtain wall — the tower reads as a lot of glass.
  event: { rows: 14, cols: 6 },
  // A park has no windows, but we keep the shape uniform for the caller.
  tree:  { rows: 1, cols: 1 },
};

/**
 * Draw the emissive window layer for one plot into a canvas the caller
 * owns. Returns the canvas; the caller is responsible for wrapping it in
 * a THREE.CanvasTexture and setting it as the material's `emissiveMap`.
 *
 * The layout is: dark background, lit rectangles at the per-cell hash.
 * `dayFraction` selects which cells are lit through litFractionForDay.
 * Cells are drawn with a slight fringe of warm color inside a slightly
 * cooler frame so the window read as a real pane, not a flat swatch.
 */
export function drawEmissiveWindowCanvas(
  role: Exclude<PlotRole, "empty">,
  plotSeed: number,
  dayFraction: number,
  canvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const { rows, cols } = WINDOW_GRIDS[role];
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const W = canvas.width;
  const H = canvas.height;

  // Dark base — the deep charcoal-blue frame the lit cells sit in.
  ctx.fillStyle = colorHex(WINDOW_DARK_COLOR);
  ctx.fillRect(0, 0, W, H);

  if (role === "tree") return canvas;

  // The plot's overall lit fraction for this hour. Every cell reads the
  // same fraction and compares its own hash to decide on/off.
  const fraction = litFractionForDay(dayFraction, plotSeed);

  const cellW = W / cols;
  const cellH = H / rows;
  // Windows are inset from the cell so a facade grid shows some wall
  // between panes. The inset is a small fraction of the cell (~15%).
  const insetX = cellW * 0.15;
  const insetY = cellH * 0.18;
  const winW = cellW - insetX * 2;
  const winH = cellH - insetY * 2;

  const litHex = colorHex(WINDOW_LIT_COLOR);
  // Slightly cooler frame color — the pane's edge in a photograph is
  // never as warm as the lit interior.
  const frameHex = colorHex(0x8A6A44);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const isLit = windowIsLit(fraction, plotSeed, r, c);
      if (!isLit) continue;
      const x = c * cellW + insetX;
      const y = r * cellH + insetY;
      // frame first — a 1-pixel-wide ring of a cooler tungsten
      ctx.fillStyle = frameHex;
      ctx.fillRect(x, y, winW, winH);
      // inner pane — the warm interior
      const pad = Math.max(1, Math.floor(Math.min(winW, winH) * 0.14));
      ctx.fillStyle = litHex;
      ctx.fillRect(x + pad, y + pad, Math.max(1, winW - pad * 2), Math.max(1, winH - pad * 2));
    }
  }

  return canvas;
}

/**
 * Convenience: allocate a canvas at (width, height) and draw the window
 * layer into it. Returns both the canvas and a THREE.CanvasTexture that
 * wraps it (colorSpace = SRGBColorSpace, so the emissive reads as sRGB
 * in the linear pipeline).
 *
 * A caller that already has a canvas (a texture atlas, an offscreen
 * pool) should use `drawEmissiveWindowCanvas` directly.
 */
export function makeEmissiveWindowTexture(
  role: Exclude<PlotRole, "empty">,
  plotSeed: number,
  dayFraction: number,
  size: { width: number; height: number },
): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(4, Math.floor(size.width));
  canvas.height = Math.max(4, Math.floor(size.height));
  drawEmissiveWindowCanvas(role, plotSeed, dayFraction, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return { canvas, texture };
}

// ── private helpers ──────────────────────────────────────────────────────

function seedHash01(seed: number): number {
  // Same idiom city-windows uses so the CPU-side canvas draws match the
  // shader's own hash values.
  const s = Math.abs(seed) * 0.101_010_1 + 0.1234;
  return ((Math.sin(s * 12.9898) * 43758.5453) % 1 + 1) % 1;
}

function tintDrift(baseHex: number, drift01: number, envelope: number): number {
  // Nudge the base color's H/S/L subtly. Pure hex math to stay dependency-
  // free; a small oscillation on each channel driven by the seed.
  const r = (baseHex >> 16) & 0xFF;
  const g = (baseHex >> 8) & 0xFF;
  const b = baseHex & 0xFF;
  const shift = (drift01 - 0.5) * envelope * 255;
  const rr = clamp255(r + shift);
  const gg = clamp255(g + shift * 0.8);
  const bb = clamp255(b + shift * 0.6);
  return (rr << 16) | (gg << 8) | bb;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function colorHex(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}
