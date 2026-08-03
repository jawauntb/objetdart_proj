/**
 * scene/radial-sprite — the one place a radial falloff gets rasterized.
 *
 * The bug this ends: four rooms each hand-rolled their own "bake a gradient
 * once, stamp it with drawImage" helper (Atlas's cloud shadows, CoastBeach's
 * softSprite, TissueSheet's cell sprite, Waves' pond-life glows) — same shape,
 * four copies, and the paint ledger (`scripts/test-room-paint.mjs`) counts the
 * `createRadialGradient` call textually in each one, whether it runs once a
 * lifetime or — as several of the four secretly still did — once a frame, or
 * once a loop iteration.
 *
 * One baker, cache-keyed by whatever actually distinguishes a sprite's
 * *look* (size, geometry, colour): call it every frame with an unchanged key
 * and it costs one `Map.get`, never a fresh `createRadialGradient` allocation
 * and raster. A room whose stops genuinely change every frame (a background
 * tint riding a smoothed day/night value, say) still wins — key it on the
 * colour actually rendered (rounded to the integer channel values a canvas
 * fillStyle string collapses to anyway) and the bake only repeats when the
 * *visible* colour changes, not every tick a value is still easing toward it.
 *
 * Pure canvas, no React. Guarded the way every 2D room already guards its own
 * bakers: `typeof document === "undefined"` returns null and the caller's
 * existing per-frame fallback (usually: draw nothing this frame) applies.
 */

export type RadialStop = { offset: number; color: string };
export type RadialCircle = { x: number; y: number; r: number };

export type RadialSpriteSpec = {
  /**
   * Sprite raster size, in css pixels. Pick a small logical size (say 128)
   * for a reusable stamp drawn later at any scale via `drawRadialStamp`, or
   * the live canvas's own exact width/height for a whole-surface fill drawn
   * back with a plain, undistorted `drawImage(sprite, 0, 0, width, height)`.
   */
  width: number;
  height: number;
  /** Defaults to a concentric gradient: the sprite's own centre, r = 0. */
  inner?: RadialCircle;
  /** Defaults to a concentric gradient: the sprite's own centre, r = min(w,h)/2. */
  outer?: RadialCircle;
  stops: RadialStop[];
  /**
   * Runs once, immediately after the gradient fill — only on the bake that
   * actually happens; a cache hit skips it along with everything else. For a
   * sprite that layers deterministic extra texture (grain, a rim) onto the
   * same canvas, the way TissueSheet's cell sprite does.
   */
  detail?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
};

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Bake — or, on a repeat key, simply return — a radial-gradient sprite.
 * `createRadialGradient` runs exactly once per distinct key.
 */
export function bakeRadialSprite(key: string, spec: RadialSpriteSpec): HTMLCanvasElement | null {
  const cached = cache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const width = Math.max(1, Math.round(spec.width));
  const height = Math.max(1, Math.round(spec.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const inner = spec.inner ?? { x: width / 2, y: height / 2, r: 0 };
  const outer = spec.outer ?? { x: width / 2, y: height / 2, r: Math.min(width, height) / 2 };
  const gradient = ctx.createRadialGradient(inner.x, inner.y, inner.r, outer.x, outer.y, outer.r);
  for (const stop of spec.stops) gradient.addColorStop(stop.offset, stop.color);
  ctx.fillStyle = gradient;
  // The whole rect, not just the outer circle: past r1 a gradient clamps to
  // its last stop, so this matches a live `fillRect` exactly, and for a
  // stamp sprite whose last stop is transparent the corners come out
  // transparent either way — never a visible square edge.
  ctx.fillRect(0, 0, width, height);
  spec.detail?.(ctx, width, height);
  cache.set(key, canvas);
  return canvas;
}

/**
 * Stamp a baked sprite centred at `(cx, cy)`, scaled so its full width spans
 * `radius * 2`. Multiplies `ctx.globalAlpha` rather than overwriting it, so a
 * caller already inside its own faded `globalAlpha` block (a departing
 * natural, a letting-go fade) composes correctly instead of snapping back to
 * full opacity.
 */
export function drawRadialStamp(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement | null,
  cx: number,
  cy: number,
  radius: number,
  alpha = 1,
): void {
  if (!sprite || !(radius > 0) || !(alpha > 0)) return;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * alpha;
  ctx.drawImage(sprite, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prevAlpha;
}
