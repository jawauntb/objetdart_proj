/** Shared Atlas directional-batch planning (safe for client + server). */

export type AtlasDirection = "north" | "east" | "south" | "west";
export type AtlasDiagonalDirection = "northwest" | "southeast";
export type AtlasBatchDirection = AtlasDirection | AtlasDiagonalDirection;
export type AtlasBatchKind = "cardinal4" | "diagonal2";
export type AtlasBatchRole = "primary" | "neighbor";

export type AtlasClipRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AtlasBatchSlot = {
  direction: AtlasBatchDirection;
  clip: AtlasClipRect;
  role: AtlasBatchRole;
};

export type AtlasBatchPlan = {
  kind: AtlasBatchKind;
  generationDepth: number;
  slots: AtlasBatchSlot[];
};

/** ~12% buffer around edge strips / quadrant samples. */
export const ATLAS_CLIP_BUFFER = 0.12;

const CARDINAL_DIRECTIONS: AtlasDirection[] = ["north", "east", "south", "west"];
const DIAGONAL_DIRECTIONS: AtlasDiagonalDirection[] = ["northwest", "southeast"];

export function resolveAtlasBatchPlan(generationDepth: number): AtlasBatchPlan {
  const depth = Number.isFinite(generationDepth) ? Math.max(0, Math.floor(generationDepth)) : 0;
  if (depth <= 0) {
    return {
      kind: "cardinal4",
      generationDepth: depth,
      slots: CARDINAL_DIRECTIONS.map((direction) => ({
        direction,
        clip: clipRectForBatchDirection(direction),
        role: "neighbor",
      })),
    };
  }
  return {
    kind: "diagonal2",
    generationDepth: depth,
    slots: DIAGONAL_DIRECTIONS.map((direction) => ({
      direction,
      clip: clipRectForBatchDirection(direction),
      role: "neighbor",
    })),
  };
}

export function clipRectForBatchDirection(direction: AtlasBatchDirection): AtlasClipRect {
  const buffer = ATLAS_CLIP_BUFFER;
  switch (direction) {
    case "north":
      return normalizeClipRect({ x: 0, y: 0, width: 1, height: 0.5 + buffer });
    case "south":
      return normalizeClipRect({ x: 0, y: 0.5 - buffer, width: 1, height: 0.5 + buffer });
    case "west":
      return normalizeClipRect({ x: 0, y: 0, width: 0.5 + buffer, height: 1 });
    case "east":
      return normalizeClipRect({ x: 0.5 - buffer, y: 0, width: 0.5 + buffer, height: 1 });
    case "northwest":
      return normalizeClipRect({
        x: 0,
        y: 0,
        width: 0.5 + buffer,
        height: 0.5 + buffer,
      });
    case "southeast":
      return normalizeClipRect({
        x: 0.5 - buffer,
        y: 0.5 - buffer,
        width: 0.5 + buffer,
        height: 0.5 + buffer,
      });
  }
}

/** Focus-centered clip for zoom upsample, with the same ~12% buffer margin. */
export function clipRectForFocus(focus: { x: number; y: number; zoom: number }): AtlasClipRect {
  const zoom = Math.max(1, focus.zoom);
  const base = Math.min(0.72, Math.max(0.28, 1 / zoom + ATLAS_CLIP_BUFFER));
  const width = base;
  const height = base;
  return normalizeClipRect({
    x: focus.x - width / 2,
    y: focus.y - height / 2,
    width,
    height,
  });
}

export function clipRectForShiftDirection(direction: AtlasDirection): AtlasClipRect {
  return clipRectForBatchDirection(direction);
}

export function normalizeClipRect(rect: AtlasClipRect): AtlasClipRect {
  const width = clampUnit(rect.width, 0.08, 1);
  const height = clampUnit(rect.height, 0.08, 1);
  const x = clampUnit(rect.x, 0, 1 - width);
  const y = clampUnit(rect.y, 0, 1 - height);
  return {
    x: roundClip(x),
    y: roundClip(y),
    width: roundClip(width),
    height: roundClip(height),
  };
}

export function formatAtlasClipClause(clip: AtlasClipRect): string {
  const left = Math.round(clip.x * 100);
  const top = Math.round(clip.y * 100);
  const right = Math.round((clip.x + clip.width) * 100);
  const bottom = Math.round((clip.y + clip.height) * 100);
  return `Use the supplied atlas sample covering roughly ${left}%–${right}% from the left and ${top}%–${bottom}% from the top (including a small buffer margin) as the source region to upsample, extend, and reconstruct into a full explorable sheet.`;
}

function clampUnit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundClip(value: number): number {
  return Math.round(value * 1000) / 1000;
}
