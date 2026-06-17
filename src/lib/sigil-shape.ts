import type { ConcernKey } from "@/lib/types";

const RADIAL_ORDER: ConcernKey[] = [
  "prayer", "future", "work", "risk", "body", "love", "memory", "friendship",
];

/**
 * Sigil polygon in local (0..size) coordinates, given concerns 0..100
 * and the size of the bounding box. Identical math to ConcernSigil so
 * the visual polygon and the obstacle silhouette stay in sync.
 */
export function sigilPolygonPoints(
  concerns: Record<ConcernKey, number>,
  size: number,
): Array<{ x: number; y: number }> {
  const cx = size / 2;
  const cy = size / 2;
  const rMax = size * 0.42;
  return RADIAL_ORDER.map((k, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 8;
    const r = ((concerns[k] ?? 50) / 100) * rMax;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

/**
 * Given a closed polygon and a horizontal line at yLocal, return the
 * leftmost intersection (null if the line doesn't cross the polygon).
 * Used to wrap text on the LEFT of a right-anchored sigil.
 */
export function polygonLeftEdgeAt(
  points: Array<{ x: number; y: number }>,
  yLocal: number,
): number | null {
  let minX = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const yLo = Math.min(p1.y, p2.y);
    const yHi = Math.max(p1.y, p2.y);
    if (yLocal < yLo || yLocal > yHi) continue;
    if (p1.y === p2.y) continue;
    const t = (yLocal - p1.y) / (p2.y - p1.y);
    const x = p1.x + t * (p2.x - p1.x);
    if (x < minX) minX = x;
  }
  return minX === Infinity ? null : minX;
}

/**
 * Rightmost intersection of the polygon at yLocal — used to wrap text
 * on the RIGHT of a left-anchored sigil.
 */
export function polygonRightEdgeAt(
  points: Array<{ x: number; y: number }>,
  yLocal: number,
): number | null {
  let maxX = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const yLo = Math.min(p1.y, p2.y);
    const yHi = Math.max(p1.y, p2.y);
    if (yLocal < yLo || yLocal > yHi) continue;
    if (p1.y === p2.y) continue;
    const t = (yLocal - p1.y) / (p2.y - p1.y);
    const x = p1.x + t * (p2.x - p1.x);
    if (x > maxX) maxX = x;
  }
  return maxX === -Infinity ? null : maxX;
}

export type ObstacleShape = {
  /** y in container coords where the obstacle starts. */
  top: number;
  height: number;
  /** Which side of the container the obstacle sits on. */
  side: "left" | "right";
  /**
   * Return the obstacle edge (in container coords) at a given y.
   * For side="right", returns the polygon's leftmost x.
   * For side="left", returns the polygon's rightmost x.
   * null = no obstacle at this y, text gets full width.
   */
  edgeAt: (yContainer: number) => number | null;
  /** Padding to keep between text and obstacle. */
  padding?: number;
};
