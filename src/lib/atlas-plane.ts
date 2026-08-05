/**
 * The plane frame: geometry for a camera that roams one continuous world
 * of sheets instead of being bound to a single image. Root cells are unit
 * squares — a cell is one full generated sheet at integer address
 * (east = +wx, south = +wy, matching src/lib/atlas-world.ts) — and zoom
 * children occupy fractional rects inside the sheet they deepen, one
 * pyramid level down.
 *
 * The camera keeps Atlas.tsx's screen-pixel convention: {x, y} translate
 * the root cell's origin on screen and zoom scales it, with the sheet's
 * on-screen size at zoom 1 given by metrics.mapWidth × metrics.mapHeight.
 * Everything here is pure so the frame's arithmetic — the difference
 * between a window onto a world and a framed picture — is testable under
 * plain node.
 */

import type { AtlasClipRect, AtlasDirection } from "@/lib/atlas-batch";
import type { AtlasWorldAddress } from "@/lib/atlas-world";

export type PlanePoint = { wx: number; wy: number };
export type PlaneRect = { x: number; y: number; width: number; height: number };
export type PlaneView = { x: number; y: number; zoom: number };
export type PlaneMetrics = {
  width: number;
  height: number;
  mapWidth: number;
  mapHeight: number;
};
export type PlaneTilePhase = "preview" | "final";
export type PlaneTile = {
  id: string;
  rect: PlaneRect;
  level: number;
  image: string;
  phase: PlaneTilePhase;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cellRect(address: AtlasWorldAddress): PlaneRect {
  return { x: address.wx, y: address.wy, width: 1, height: 1 };
}

/** The world point under a screen position, in root-cell units. */
export function worldPointAtScreen(
  view: PlaneView,
  metrics: PlaneMetrics,
  screenX: number,
  screenY: number,
): PlanePoint {
  return {
    wx: (screenX - view.x) / (metrics.mapWidth * view.zoom),
    wy: (screenY - view.y) / (metrics.mapHeight * view.zoom),
  };
}

export function worldCenter(view: PlaneView, metrics: PlaneMetrics): PlanePoint {
  return worldPointAtScreen(view, metrics, metrics.width / 2, metrics.height / 2);
}

/** The integer cell containing a world point (floor handles the negative quadrants). */
export function cellAt(point: PlanePoint): AtlasWorldAddress {
  return { wx: Math.floor(point.wx), wy: Math.floor(point.wy) };
}

/** A camera placing a given world point at the viewport center. */
export function viewForCenter(
  metrics: PlaneMetrics,
  point: PlanePoint,
  zoom: number,
): PlaneView {
  return {
    zoom,
    x: metrics.width / 2 - point.wx * metrics.mapWidth * zoom,
    y: metrics.height / 2 - point.wy * metrics.mapHeight * zoom,
  };
}

/**
 * The bounding rect of explored ground, in world units — the union of the
 * given cells, always including the cell the traveler stands on so the
 * camera has somewhere legal to be even before anything else exists.
 */
export function exploredBounds(
  addresses: AtlasWorldAddress[],
  current: AtlasWorldAddress,
): PlaneRect {
  let minX = current.wx;
  let minY = current.wy;
  let maxX = current.wx + 1;
  let maxY = current.wy + 1;
  for (const address of addresses) {
    if (address.wx < minX) minX = address.wx;
    if (address.wy < minY) minY = address.wy;
    if (address.wx + 1 > maxX) maxX = address.wx + 1;
    if (address.wy + 1 > maxY) maxY = address.wy + 1;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The zoom at which the whole explored rect fits the viewport. */
export function fitZoomForBounds(bounds: PlaneRect, metrics: PlaneMetrics): number {
  if (!metrics.width || !metrics.height || bounds.width <= 0 || bounds.height <= 0) return 1;
  return Math.min(
    metrics.width / (bounds.width * metrics.mapWidth),
    metrics.height / (bounds.height * metrics.mapHeight),
  );
}

/**
 * The camera's overview floor: with one cell explored this is the classic
 * fit-to-sheet zoom of 1; as the world grows the floor drops so the whole
 * walked plane can be surveyed at once, but never past the point where the
 * explored ground fits the frame.
 */
export function dynamicZoomFloor(bounds: PlaneRect, metrics: PlaneMetrics): number {
  return Math.min(1, fitZoomForBounds(bounds, metrics));
}

/**
 * Clamp the camera to explored ground. On an axis where the bounds
 * overflow the viewport the camera stops at the bounds' edges (plus any
 * overscroll allowance); on an axis where they fit, the bounds ride
 * centered — the surveyed world floats in the frame.
 */
export function boundViewToBounds(
  view: PlaneView,
  metrics: PlaneMetrics,
  bounds: PlaneRect,
  minZoom: number,
  maxZoom: number,
  overscroll = 0,
): PlaneView {
  if (!metrics.width) return view;
  const zoom = clamp(view.zoom, minZoom, maxZoom);
  const leftPx = bounds.x * metrics.mapWidth * zoom;
  const rightPx = (bounds.x + bounds.width) * metrics.mapWidth * zoom;
  const topPx = bounds.y * metrics.mapHeight * zoom;
  const bottomPx = (bounds.y + bounds.height) * metrics.mapHeight * zoom;
  const spanX = rightPx - leftPx;
  const spanY = bottomPx - topPx;
  let x: number;
  if (spanX <= metrics.width) {
    x = (metrics.width - (leftPx + rightPx)) / 2;
  } else {
    x = clamp(view.x, metrics.width - rightPx - overscroll, -leftPx + overscroll);
  }
  let y: number;
  if (spanY <= metrics.height) {
    y = (metrics.height - (topPx + bottomPx)) / 2;
  } else {
    y = clamp(view.y, metrics.height - bottomPx - overscroll, -topPx + overscroll);
  }
  return { x, y, zoom };
}

/**
 * The camera's focus expressed in a sheet's own local coordinates, for
 * the generator: where inside this sheet the viewer is looking and at
 * what magnification relative to the sheet's own fit.
 */
export function focusForSheet(
  view: PlaneView,
  metrics: PlaneMetrics,
  sheetRect: PlaneRect,
): { x: number; y: number; zoom: number } {
  const center = worldCenter(view, metrics);
  return {
    x: clamp((center.wx - sheetRect.x) / sheetRect.width, 0, 1),
    y: clamp((center.wy - sheetRect.y) / sheetRect.height, 0, 1),
    zoom: clamp(view.zoom * sheetRect.width, 1, 64),
  };
}

/** Where a child sheet drawn from a clip of its parent lands on the plane. */
export function placeChildRect(sheetRect: PlaneRect, clip: AtlasClipRect): PlaneRect {
  return {
    x: sheetRect.x + clip.x * sheetRect.width,
    y: sheetRect.y + clip.y * sheetRect.height,
    width: clip.width * sheetRect.width,
    height: clip.height * sheetRect.height,
  };
}

function rectContains(rect: PlaneRect, point: PlanePoint): boolean {
  return point.wx >= rect.x
    && point.wx < rect.x + rect.width
    && point.wy >= rect.y
    && point.wy < rect.y + rect.height;
}

/**
 * The deepest tile under a world point — the pyramid's answer to "what
 * ground is the viewer actually looking at". Ties on level break toward
 * the later tile, which is the more recent landing.
 */
export function deepestTileAt(tiles: PlaneTile[], point: PlanePoint): PlaneTile | null {
  let best: PlaneTile | null = null;
  for (const tile of tiles) {
    if (!rectContains(tile.rect, point)) continue;
    if (!best || tile.level >= best.level) best = tile;
  }
  return best;
}

/**
 * Whether the camera has outrun a tile's native detail: the tile is being
 * magnified past its own fit by more than the threshold, so the ground
 * under the viewer deserves a deeper drawing. Landing that child shrinks
 * the deepest rect and the same zoom no longer wants more — the pyramid's
 * termination condition.
 */
export function tileNeedsDetail(tile: PlaneTile, zoom: number, threshold = 1.45): boolean {
  return zoom * tile.rect.width >= threshold;
}

/**
 * Whether landing this child still leaves the camera room to ask for at
 * least one further level in place before its own ceiling makes the next
 * crossing physically unreachable.
 *
 * tileNeedsDetail's threshold recurs every level against a shrinking
 * rect.width, so the zoom required to trigger level N+1 grows
 * geometrically with depth. Left unchecked, that requirement eventually
 * exceeds maxZoom and a tile is stuck over-magnified with no sharper
 * drawing the camera can ever reach — the "endless" zoom quietly stops
 * being endless a few levels down. `headroom` keeps a safety margin
 * against real zoom overshoot during the settle debounce (the camera
 * rarely stops exactly on the threshold), and is deliberately generous
 * since a false "no headroom" only costs one extra plane re-root, while a
 * false "has headroom" costs a tile that can never be resolved.
 */
export function hasZoomHeadroom(
  childRect: PlaneRect,
  maxZoom: number,
  threshold = 1.45,
  headroom = 2,
): boolean {
  return maxZoom * childRect.width >= threshold * headroom;
}

export type PlaneVelocity = { x: number; y: number };

/**
 * Resolve outward travel only at the true frontier — the edge of explored
 * ground. Panning across interior cells of the surveyed world is ordinary
 * movement; only pressing past the bounds asks for new territory. Same
 * scoring shape as resolveAtlasEdgeTravel, generalized to the plane.
 */
export function resolvePlaneEdgeTravel(
  view: PlaneView,
  metrics: PlaneMetrics,
  bounds: PlaneRect,
  velocity: PlaneVelocity,
  edgeMargin: number,
): AtlasDirection | null {
  if (metrics.width <= 0 || metrics.height <= 0) return null;
  const hard = boundViewToBounds(view, metrics, bounds, view.zoom, view.zoom, 0);
  // The camera's legal limits on each axis. Where the explored ground
  // fits inside the viewport there are no limits to stand at — any
  // outward press is already at the frontier.
  const zoom = hard.zoom;
  const leftPx = bounds.x * metrics.mapWidth * zoom;
  const rightPx = (bounds.x + bounds.width) * metrics.mapWidth * zoom;
  const topPx = bounds.y * metrics.mapHeight * zoom;
  const bottomPx = (bounds.y + bounds.height) * metrics.mapHeight * zoom;
  const freeX = rightPx - leftPx <= metrics.width;
  const freeY = bottomPx - topPx <= metrics.height;
  const edgeEpsilon = 1;
  const atWest = freeX || view.x >= -leftPx - edgeEpsilon;
  const atEast = freeX || view.x <= metrics.width - rightPx + edgeEpsilon;
  const atNorth = freeY || view.y >= -topPx - edgeEpsilon;
  const atSouth = freeY || view.y <= metrics.height - bottomPx + edgeEpsilon;
  const scores: Array<[AtlasDirection, number]> = [
    ["west", Math.max(0, view.x - hard.x) + (atWest && velocity.x > 5 ? velocity.x * 3 : 0)],
    ["east", Math.max(0, hard.x - view.x) + (atEast && velocity.x < -5 ? -velocity.x * 3 : 0)],
    ["north", Math.max(0, view.y - hard.y) + (atNorth && velocity.y > 5 ? velocity.y * 3 : 0)],
    ["south", Math.max(0, hard.y - view.y) + (atSouth && velocity.y < -5 ? -velocity.y * 3 : 0)],
  ];
  const best = scores.sort((a, b) => b[1] - a[1])[0];
  return best[1] >= edgeMargin * 0.42 ? best[0] : null;
}
