import type { AtlasDirection } from "@/lib/atlas-batch";
import type { RoomZoomSpec } from "@/lib/scale";

/**
 * /atlas' membership in the scale manifold. zoomMin is fit-to-view — the
 * widest generated chart, with the earth above it; zoomMax is the deepest
 * free zoom the sheet allows, with the coast below it. Atlas derives its
 * own MIN/MAX zoom clamps from this spec so the camera and the band walls
 * can never disagree.
 */
export const ATLAS_ZOOM_SPEC: RoomZoomSpec = {
  band: "atlas",
  zoomMin: 1,
  zoomMax: 64,
};

export type AtlasNavigationView = {
  x: number;
  y: number;
  zoom: number;
};

export type AtlasNavigationMetrics = {
  width: number;
  height: number;
  mapWidth: number;
  mapHeight: number;
};

export type AtlasPanVelocity = {
  x: number;
  y: number;
};

/**
 * Resolve outward travel only when the sheet is actually at an edge.
 * Fast movement through the middle of a zoomed sheet is ordinary panning.
 */
export function resolveAtlasEdgeTravel(
  view: AtlasNavigationView,
  metrics: AtlasNavigationMetrics,
  velocity: AtlasPanVelocity,
  edgeMargin: number,
): AtlasDirection | null {
  if (metrics.width <= 0 || metrics.height <= 0) return null;

  const zoom = Math.max(1, view.zoom);
  const minX = Math.min(0, metrics.width - metrics.mapWidth * zoom);
  const minY = Math.min(0, metrics.height - metrics.mapHeight * zoom);
  const hardX = clamp(view.x, minX, 0);
  const hardY = clamp(view.y, minY, 0);
  const edgeEpsilon = 1;
  const atWest = hardX >= -edgeEpsilon;
  const atEast = hardX <= minX + edgeEpsilon;
  const atNorth = hardY >= -edgeEpsilon;
  const atSouth = hardY <= minY + edgeEpsilon;

  const scores: Array<[AtlasDirection, number]> = [
    ["west", Math.max(0, view.x - hardX) + (atWest && velocity.x > 5 ? velocity.x * 3 : 0)],
    ["east", Math.max(0, hardX - view.x) + (atEast && velocity.x < -5 ? -velocity.x * 3 : 0)],
    ["north", Math.max(0, view.y - hardY) + (atNorth && velocity.y > 5 ? velocity.y * 3 : 0)],
    ["south", Math.max(0, hardY - view.y) + (atSouth && velocity.y < -5 ? -velocity.y * 3 : 0)],
  ];
  const best = scores.sort((a, b) => b[1] - a[1])[0];
  return best[1] >= edgeMargin * 0.42 ? best[0] : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
