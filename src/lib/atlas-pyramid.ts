/**
 * The pyramid: the law that keeps an endless zoom sharp.
 *
 * A generated sheet has a fixed number of pixels. Draw it past its own
 * frame-fit and it is mush, and every deeper view built on top of that
 * mush is mush compounded — which is exactly what a free camera with one
 * hard zoom ceiling produces. The pyramid answers with two moves, and
 * only two:
 *
 *   1. **Detail.** Once the camera magnifies the deepest drawing past
 *      `PYRAMID_DETAIL_MAGNIFICATION`, a child sheet of exactly half that
 *      ground is drawn natively and laid over it. Half the ground with the
 *      same pixel budget is four times the density, so the child is the
 *      better drawing from the instant it lands — `pyramidLayerBlend`
 *      dissolves it in rather than cutting.
 *   2. **Promotion.** The moment a child covers the whole viewport, the
 *      frame is re-expressed around it: the child becomes the unit cell,
 *      its parent becomes a wider rect around it, and the camera's numbers
 *      are rewritten so that *nothing moves on screen*. `promoteView` and
 *      `demoteView` are exact inverses, so descending and ascending are
 *      one reversible map — the site's own law about maps you could in
 *      principle run backwards.
 *
 * Promotion is what makes the zoom endless. Camera zoom never leaves
 * roughly [1, 8] no matter how deep the traveler goes; depth lives in the
 * descent stack, not in a transform scale of four thousand. Twelve layers
 * of real, freshly-drawn ground cost twelve promotions and no float
 * precision at all.
 *
 * Everything here is pure so the sharpness law is checkable under plain
 * node: `scripts/test-atlas.mjs` pins the invariants that a plausible bug
 * (a child that lands blurrier than its parent, a promotion that shifts
 * the ground, a descent that cannot be undone) would break.
 */

import type { AtlasClipRect } from "@/lib/atlas-batch";
import type { PlaneMetrics, PlaneRect, PlaneTile, PlaneView } from "@/lib/atlas-plane";

/** Each level draws exactly half the parent's ground — four times its density. */
export const PYRAMID_RATIO = 0.5;

/**
 * How far past its own frame-fit a drawing may be magnified before the
 * ground under the camera deserves a deeper one. Low, because this is the
 * softness ceiling of everything the traveler ever sees: past 1.15 the
 * child is already dissolving in over the top.
 */
export const PYRAMID_DETAIL_MAGNIFICATION = 1.15;

/**
 * The camera's ceiling inside one plane. Reaching it means the room's
 * answer is to descend, not to smear the sheet — so the residue is spent
 * on the pyramid instead of on the band wall, until the traveler has
 * genuinely run out of depth.
 */
export const PYRAMID_PLANE_ZOOM_CEILING = 8;

/**
 * How many promotions deep the descent may run. Twelve is the promise;
 * this is twice that, so the wall toward the coast is a real floor of the
 * world and not a budget the room ran out of.
 */
export const PYRAMID_MAX_DEPTH = 24;

/** Ancestor levels kept mounted around a promoted sheet, to fill its margins. */
export const PYRAMID_ANCESTOR_LEVELS = 3;

/**
 * The blend window, in units of a freshly-asked child's magnification: a
 * child is fully present at the magnification it was born at, and gone by
 * the time the camera has pulled back this fraction of the way.
 */
export const PYRAMID_BLEND_FLOOR = 0.55;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How far past its own frame-fit a tile is being drawn. 1 means the sheet
 * covers exactly the ground it was drawn for; 2 means every pixel of it is
 * being stretched across four.
 */
export function tileMagnification(rect: PlaneRect, zoom: number): number {
  return zoom * rect.width;
}

/** The camera has outrun this drawing and the ground deserves a deeper one. */
export function pyramidNeedsDetail(
  rect: PlaneRect,
  zoom: number,
  threshold = PYRAMID_DETAIL_MAGNIFICATION,
): boolean {
  return tileMagnification(rect, zoom) >= threshold;
}

/**
 * The clip a child is drawn from: exactly `ratio` of the parent's span,
 * centered on what the camera is looking at, held inside the parent.
 *
 * No buffer margin — this clip is the child's *ground*, not a sample fed
 * back to an image editor, and a buffered clip shrinks by less than the
 * ratio, which flattens the pyramid until each generated layer buys almost
 * no new detail. The generator draws these natively (see
 * `atlasOperationForRequest`), so the only thing the clip must be is true.
 */
export function pyramidClipForFocus(
  focus: { x: number; y: number },
  ratio = PYRAMID_RATIO,
): AtlasClipRect {
  const span = clamp(ratio, 0.05, 1);
  const x = clamp(focus.x - span / 2, 0, 1 - span);
  const y = clamp(focus.y - span / 2, 0, 1 - span);
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    width: span,
    height: span,
  };
}

/**
 * How present a child layer is at this camera zoom, 0..1.
 *
 * A child is asked for when its parent hits `detail` magnification, so it
 * lands already at `ratio × detail` of its own fit — downsampled, and
 * therefore sharper than the parent it covers. It stays fully present from
 * there down; pull the camera back and it dissolves rather than sitting on
 * the parent as a hard-edged rectangle of a different drawing.
 *
 * Level 0 is the plane's own ground and negative levels are its ancestors:
 * both are the floor under everything and never fade.
 */
export function pyramidLayerBlend(
  tile: Pick<PlaneTile, "rect" | "level">,
  zoom: number,
  ratio = PYRAMID_RATIO,
  detail = PYRAMID_DETAIL_MAGNIFICATION,
): number {
  if (tile.level <= 0) return 1;
  const birth = ratio * detail;
  const floor = birth * PYRAMID_BLEND_FLOOR;
  const magnification = tileMagnification(tile.rect, zoom);
  if (magnification >= birth) return 1;
  if (magnification <= floor) return 0;
  return (magnification - floor) / (birth - floor);
}

/** Where the blend ramp starts and how wide it is, for the CSS that runs it per frame. */
export function pyramidBlendWindow(
  ratio = PYRAMID_RATIO,
  detail = PYRAMID_DETAIL_MAGNIFICATION,
): { from: number; span: number } {
  const birth = ratio * detail;
  const from = birth * PYRAMID_BLEND_FLOOR;
  return { from, span: birth - from };
}

/**
 * The camera's ceiling. Inside the pyramid it is the plane ceiling — the
 * room answers a harder pinch by drawing deeper ground, not by stretching
 * the sheet. At the bottom of the descent the deep ceiling opens again so
 * the band wall toward the coast is reachable exactly where the world
 * genuinely ends.
 */
export function pyramidZoomCeiling(
  depth: number,
  deepCeiling: number,
  planeCeiling = PYRAMID_PLANE_ZOOM_CEILING,
  maxDepth = PYRAMID_MAX_DEPTH,
): number {
  if (!Number.isFinite(depth) || depth >= maxDepth) return deepCeiling;
  return Math.min(deepCeiling, planeCeiling);
}

/** A tile's box on screen, in the camera's pixel convention. */
export function tileScreenRect(
  rect: PlaneRect,
  view: PlaneView,
  metrics: PlaneMetrics,
): { left: number; top: number; right: number; bottom: number } {
  const left = view.x + rect.x * metrics.mapWidth * view.zoom;
  const top = view.y + rect.y * metrics.mapHeight * view.zoom;
  return {
    left,
    top,
    right: left + rect.width * metrics.mapWidth * view.zoom,
    bottom: top + rect.height * metrics.mapHeight * view.zoom,
  };
}

/**
 * The tile owns the whole viewport — no ancestor shows around it. This is
 * the promotion moment: the deeper drawing is all the traveler can see, so
 * making it the plane changes the numbers and nothing else. It also
 * guarantees the promoted camera survives `boundViewToBounds` untouched,
 * because a covering cell overflows both axes and is clamped, never
 * re-centered.
 */
export function tileCoversViewport(
  rect: PlaneRect,
  view: PlaneView,
  metrics: PlaneMetrics,
): boolean {
  if (metrics.width <= 0 || metrics.height <= 0) return false;
  const box = tileScreenRect(rect, view, metrics);
  return box.left <= 0.5
    && box.top <= 0.5
    && box.right >= metrics.width - 0.5
    && box.bottom >= metrics.height - 0.5;
}

/**
 * The deepest child that has taken over the frame, or null. Only real
 * children promote: the plane's own ground and its ancestors are already
 * where they belong.
 */
export function promotableTile(
  tiles: PlaneTile[],
  view: PlaneView,
  metrics: PlaneMetrics,
): PlaneTile | null {
  let best: PlaneTile | null = null;
  for (const tile of tiles) {
    if (tile.level <= 0) continue;
    if (!tileCoversViewport(tile.rect, view, metrics)) continue;
    if (!best || tile.level >= best.level) best = tile;
  }
  return best;
}

/**
 * The camera, re-expressed with `anchor` as the new unit cell. Screen
 * positions are preserved exactly: this is a change of coordinates, not a
 * move. Anchors are square in world units by construction (a child is
 * `ratio` of its parent on both axes), so one span serves both.
 */
export function promoteView(
  view: PlaneView,
  metrics: PlaneMetrics,
  anchor: PlaneRect,
): PlaneView {
  const span = anchor.width > 0 ? anchor.width : 1;
  return {
    zoom: view.zoom * span,
    x: view.x + anchor.x * metrics.mapWidth * view.zoom,
    y: view.y + anchor.y * metrics.mapHeight * view.zoom,
  };
}

/** The exact inverse of `promoteView` — the ascent of the same stair. */
export function demoteView(
  view: PlaneView,
  metrics: PlaneMetrics,
  anchor: PlaneRect,
): PlaneView {
  const span = anchor.width > 0 ? anchor.width : 1;
  const zoom = view.zoom / span;
  return {
    zoom,
    x: view.x - anchor.x * metrics.mapWidth * zoom,
    y: view.y - anchor.y * metrics.mapHeight * zoom,
  };
}

/** A world rect, re-expressed with `anchor` as the unit cell. */
export function promoteRect(rect: PlaneRect, anchor: PlaneRect): PlaneRect {
  const span = anchor.width > 0 ? anchor.width : 1;
  return {
    x: (rect.x - anchor.x) / span,
    y: (rect.y - anchor.y) / span,
    width: rect.width / span,
    height: rect.height / span,
  };
}

/**
 * The whole tile set, re-expressed around a promoted anchor. Ancestors are
 * kept — they are what fills the margins while the promoted sheet's own
 * children are still being drawn — down to `ancestorLevels`, and ground
 * that has fallen far outside the promoted neighborhood is dropped: the
 * descent stack holds the parent plane whole, so the live plane does not
 * need to.
 */
export function promoteTiles(
  tiles: PlaneTile[],
  anchor: PlaneRect,
  anchorLevel: number,
  ancestorLevels = PYRAMID_ANCESTOR_LEVELS,
): PlaneTile[] {
  const kept: PlaneTile[] = [];
  for (const tile of tiles) {
    const level = tile.level - anchorLevel;
    if (level < -ancestorLevels) continue;
    const rect = promoteRect(tile.rect, anchor);
    if (
      rect.x > 3
      || rect.y > 3
      || rect.x + rect.width < -2
      || rect.y + rect.height < -2
    ) continue;
    kept.push({ ...tile, level, rect });
  }
  return kept;
}

/**
 * The cartographic register at a given descent depth: what a map *of that
 * scale* is a map of. Zoom and abstraction are different axes — descending
 * must change the subject matter, not just the sharpness, or twelve layers
 * are twelve photographs of the same coastline. Deterministic in depth, so
 * the same descent always reads the same way.
 */
export function pyramidPerspective(depth: number): string {
  const steps = [
    "a continental survey: coastlines, ranges, seas, the largest bodies of this world",
    "a regional chart: provinces, watersheds, roads between distant places",
    "a district map: valleys, forests, the ground between settlements",
    "a settlement plan: towns, walls, harbors, fields, the shape of habitation",
    "a quarter: streets, squares, bridges, individual roofs",
    "a block: single buildings, courtyards, gardens, the material they are made of",
    "a room-scale view: thresholds, stairs, tools, worked surfaces",
    "an object study: single things at arm's length, their joins and wear",
    "a surface: grain, weave, corrosion, the texture of one material",
    "a microscopy: fibers, crystals, cells, structure below the naked eye",
    "a lattice: the repeating order underneath the texture",
    "a granular field: the smallest constituents this world still has names for",
  ];
  const index = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
  return steps[Math.min(index, steps.length - 1)];
}
