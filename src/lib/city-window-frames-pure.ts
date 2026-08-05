/**
 * city-window-frames-pure — the pure math for real geometric window
 * openings on home + store facades.
 *
 * The renderer builds an InstancedMesh whose per-instance matrix is a
 * frame-shaped rectangle-with-hole extruded outward from the wall. This
 * module owns the ladder those matrices live on:
 *
 *   - `windowsPerPlot(role)` — how many frames a plot of this role
 *     contributes to the shared lattice. Home = 3×3 × 4 faces = 36;
 *     store = 5×4 × 4 = 80; tree / event / empty = 0.
 *   - `windowFramePlacement(...)` — the world-space (x, y, z, yaw, winW,
 *     winH) for one frame instance on one plot face. The renderer
 *     composes a Matrix4 from this and scales the frame geometry's
 *     Z-axis by `WINDOW_FRAME_DEPTH_M` so the protrusion is a constant
 *     8cm regardless of building height.
 *
 * All functions here are pure: no THREE, no DOM, no wall clock. Pinned
 * by `test-city-windows.mjs` so a refactor that drops a wall's worth of
 * windows or misaligns the pane-in-canvas with the frame ring will
 * fire before it lands.
 */

import type { PlotRole } from "@/lib/city";

/**
 * The window grid per role. Kept in this pure module so the test file
 * can pin it without pulling THREE in. Values MUST match the export in
 * city-facades.ts; see re-export there.
 */
export const WINDOW_GRIDS_PURE: Record<Exclude<PlotRole, "empty">, { rows: number; cols: number }> = {
  home:  { rows: 3, cols: 3 },
  store: { rows: 5, cols: 4 },
  event: { rows: 14, cols: 6 },
  tree:  { rows: 1, cols: 1 },
};

/** All four cardinal wall faces of a rectangular plot. */
export const WINDOW_FACES = [0, 1, 2, 3] as const;
export type WindowFace = (typeof WINDOW_FACES)[number];

/**
 * Outward yaw offset (radians) for each wall face relative to plot yaw.
 * Face 0 = +Z (front), 1 = -Z (back), 2 = +X (right), 3 = -X (left).
 */
export function faceYawFor(face: WindowFace): number {
  return face === 0 ? 0
       : face === 1 ? Math.PI
       : face === 2 ? Math.PI / 2
       :              -Math.PI / 2;
}

/**
 * How many window-frame instances a plot of this role contributes to
 * the shared lattice. Only home + store carry windows; tree / event /
 * empty are 0. The InstancedMesh capacity is (maxInstances * this).
 */
export function windowsPerPlot(role: PlotRole): number {
  if (role === "empty" || role === "tree" || role === "event") return 0;
  const g = WINDOW_GRIDS_PURE[role];
  return g.rows * g.cols * WINDOW_FACES.length;
}

/**
 * The outer size of a window frame as a fraction of its wall cell — a
 * cell is (wallWidth / cols) wide × (yScale / rows) tall, and the frame
 * covers 78% of that so a strip of wall remains between neighbouring
 * windows.
 */
export const WINDOW_FRAME_OUTER = 0.78;
/**
 * The inner opening of the frame as a fraction of its cell. ~56% means
 * the frame is ~11% of cell wide on each side — a generous mullion
 * that reads at eye-level.
 */
export const WINDOW_FRAME_INNER = 0.56;
/**
 * How far the frame protrudes outward from the wall face, in world
 * meters. 8cm is enough for grazing sunset light to cast a legible
 * self-shadow onto the pane's edge without breaking the silhouette
 * at bird's-eye zoom.
 */
export const WINDOW_FRAME_DEPTH_M = 0.08;

/**
 * The mullion cross that splits every pane into four quadrants — the
 * horizontal + vertical bar you see in every real double-hung / casement
 * window. Authored in the frame's LOCAL frame where the outer bounds sit
 * at [-0.5, 0.5]; the caller scales x/y by (winW, winH) so a bar's
 * world thickness = 2 × MULLION_HALF × winW.
 *
 * At the current value 0.010 (2% of window width) a typical 1m home
 * window carries a ~20mm mullion — the same 4mm-per-face reveal the
 * brief calls for, plus a bit of wiggle so the bar reads at pedestrian
 * eye-level without breaking bloom threshold at dusk. Below ~0.005 the
 * bar vanishes on canvas; above ~0.020 it starts to eat the pane. The
 * bar is authored as merged BufferGeometry via `windowFrameQuadrantHoles`,
 * so it extrudes to WINDOW_FRAME_DEPTH_M along +Z just like the outer
 * reveal ring — one silhouette, one draw call, real depth on both.
 *
 * Kept in this pure module so `test-city-windows.mjs` can pin the ratio
 * without pulling THREE in.
 */
export const WINDOW_MULLION_HALF = 0.010;

/**
 * The world-space placement of one window frame on one plot face.
 *
 * Coordinate frame matches `createSkylineScene`:
 *   - plot center at (cx, 0, cz), yaw around Y
 *   - +Z face is the plot's front, -Z the back, +X right, -X left
 *   - the frame's local +Z points outward through the wall's normal
 *
 * Returns the frame center (nudged outward by half the protrusion so
 * the frame's back face lands ON the wall surface) and the window's
 * width/height in world meters. The frame geometry is authored with
 * outer bounds [-0.5..0.5] in X/Y and depth [0..1] in Z, so the caller
 * scales by (winW, winH, WINDOW_FRAME_DEPTH_M).
 */
export function windowFramePlacement(
  cx: number,
  cz: number,
  yaw: number,
  sx: number,
  sz: number,
  yScale: number,
  rows: number,
  cols: number,
  face: WindowFace,
  row: number,
  col: number,
): {
  x: number;
  y: number;
  z: number;
  yaw: number;
  winW: number;
  winH: number;
} {
  const fy = faceYawFor(face);
  // +Z / -Z faces run along the plot's local X (sx wide); +X / -X faces
  // run along the plot's local Z (sz wide). Tangent width and outward
  // half-depth flip together.
  const wallW = (face === 0 || face === 1) ? sx : sz;
  const wallHalfDepth = (face === 0 || face === 1) ? sz / 2 : sx / 2;
  const winW = (wallW / cols) * WINDOW_FRAME_OUTER;
  const winH = (yScale / rows) * WINDOW_FRAME_OUTER;
  // Cell center in the wall's own local frame, before yaw.
  const localX = (col + 0.5) * (wallW / cols) - wallW / 2;
  const localY = (row + 0.5) * (yScale / rows);
  const totalYaw = yaw + fy;
  // Push the frame's back face onto the wall surface, then a half-depth
  // more so the frame's midplane sits (frameDepth/2) past the wall.
  const outDist = wallHalfDepth + WINDOW_FRAME_DEPTH_M / 2;
  const sinT = Math.sin(totalYaw);
  const cosT = Math.cos(totalYaw);
  const outX = sinT * outDist;
  const outZ = cosT * outDist;
  // Tangent along the wall face (perpendicular to outward + up).
  const tanX = cosT * localX;
  const tanZ = -sinT * localX;
  return {
    x: cx + outX + tanX,
    y: localY,
    z: cz + outZ + tanZ,
    yaw: totalYaw,
    winW,
    winH,
  };
}

/**
 * A quadrant hole rectangle in the frame's local frame (outer bounds
 * [-0.5, 0.5]). Four of these — one per pane quadrant — together punch
 * the "one big hole with a + cross through it" pattern into the extruded
 * shape. The strip of shape material left between adjacent holes IS the
 * mullion bar; the strip around all four is the outer reveal ring.
 */
export type WindowQuadrantHole = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * The four quadrant holes that carve a "+" mullion cross into the frame.
 *
 * Layout (in the frame's own local frame):
 *
 *   +outer ──┬───────────┬─────────┬───────────┬── +outer
 *            │  reveal   │  reveal │  reveal   │
 *            │  ring     │  ring   │  ring     │
 *            ├───────────┼─────────┼───────────┤
 *            │  Q_TL     │ mullion │  Q_TR     │
 *            │  (hole)   │         │  (hole)   │
 *            ├───────────┼─────────┼───────────┤
 *            │  mullion  │ mullion │  mullion  │
 *            ├───────────┼─────────┼───────────┤
 *            │  Q_BL     │ mullion │  Q_BR     │
 *            │  (hole)   │         │  (hole)   │
 *            ├───────────┼─────────┼───────────┤
 *   -outer ──┴───────────┴─────────┴───────────┴── -outer
 *
 * The reveal ring is the outer band between ±innerBound and ±outerBound;
 * the mullion is the cross of ExtrudeShape material at |x| ≤ MULLION_HALF
 * and |y| ≤ MULLION_HALF inside the inner rectangle. When the caller
 * scales the geometry by (winW, winH, WINDOW_FRAME_DEPTH_M) the bar's
 * WORLD thickness = 2 × WINDOW_MULLION_HALF × winW.
 *
 * Kept pure so the test can pin the geometry without a THREE dependency.
 */
export function windowFrameQuadrantHoles(): WindowQuadrantHole[] {
  const outer = 0.5;
  const innerRatio = WINDOW_FRAME_INNER / WINDOW_FRAME_OUTER;
  const inner = outer * innerRatio;
  const m = WINDOW_MULLION_HALF;
  // Bottom-left, bottom-right, top-left, top-right — order doesn't
  // affect the resulting shape, but a stable list keeps the test
  // deterministic and readable.
  return [
    { minX: -inner, minY: -inner, maxX: -m,     maxY: -m     }, // Q_BL
    { minX:  m,     minY: -inner, maxX:  inner, maxY: -m     }, // Q_BR
    { minX: -inner, minY:  m,     maxX: -m,     maxY:  inner }, // Q_TL
    { minX:  m,     minY:  m,     maxX:  inner, maxY:  inner }, // Q_TR
  ];
}
