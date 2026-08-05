/**
 * city-grading — the tone-mapping exposure ramp on dayFraction.
 *
 * A single scalar, `renderer.toneMappingExposure`, decides where the ACES
 * filmic knee sits relative to the linear values the shaders write. Pin it
 * flat and the same value has to serve two opposite jobs at once: at noon
 * it must hold back the sun disk before it clips the highlight roll-off
 * and takes visible detail out of the sky; at midnight it must lift the
 * emissive-window pixels above the tone-mapper's knee so bloom has warm
 * mids to work on rather than tail scraps. A single constant loses both.
 *
 * The remedy is a curve on dayFraction, in the same shape as
 * `bloomParamsForDay` in `city-composer.ts` — the two functions are the
 * dusk moment's two dials. Bloom pulls the emissive mids up into the
 * ember; exposure decides which mids the tone-mapper actually shows.
 * A drop from 1.4 at noon to 0.75 at midnight means the SAME emissive
 * intensity that reads as "warm" at 1.05 exposure reads as "glowing from
 * inside" at 0.75 — the emotional peak lands without touching a single
 * window pixel.
 *
 * The cardinal values are pinned by `test-city-grading.mjs`:
 *   noon     (dayFraction 0.25) → ~1.40  (hold the sky, protect highlights)
 *   horizon  (dayFraction 0/0.5) → ~0.90 (the roll-over, both directions)
 *   midnight (dayFraction 0.75) → ~0.70  (lift the emissive mids for bloom)
 *
 * The curve is piecewise smoothstep on the distance-to-noon axis, so:
 *   – it hits the three cardinal values exactly;
 *   – the derivative is zero at each cardinal point (no chatter as the sun
 *     crosses noon or the horizon);
 *   – the two halves join C1-smoothly at horizon (both smoothsteps have
 *     zero derivative at their shared endpoint).
 *
 * Nothing in this file touches Three.js — it is a pure function, callable
 * from a node test, from the room's per-slot tick, or from anywhere the
 * renderer's exposure needs to know what time of day it is.
 */

/** The exposure at the top of the sun's arc — held high to protect the sky. */
export const EXPOSURE_NOON = 1.4;
/** The exposure at the horizon crossings — the roll-over between day and night. */
export const EXPOSURE_HORIZON = 0.9;
/** The exposure at midnight — held low so lit windows bloom, not scream. */
export const EXPOSURE_MIDNIGHT = 0.7;

/**
 * Return the renderer's tone-mapping exposure for a given point in the day.
 *
 *   `dayFraction` — the same 0..1 clock city.ts already runs on. 0 = dawn,
 *   0.25 = noon, 0.5 = dusk, 0.75 = midnight. Wraps at 1.
 *
 * The value returned is fed straight into `renderer.toneMappingExposure`;
 * the renderer clamps nothing — the caller must not scale it.
 *
 * The curve is C0-continuous everywhere and C1-continuous at the four
 * cardinal points (noon, horizon, midnight, horizon-again). Between them
 * the shape is a smoothstep, so a slow sunrise reads as an ease-in-out
 * roll-over of the whole frame's brightness rather than a linear ramp.
 */
export function exposureForDay(dayFraction: number): number {
  // Wrap into [0,1). Guarding non-finite so a stray NaN from a broken
  // clock never blackens the frame — a paused clock lands at noon.
  if (!Number.isFinite(dayFraction)) return EXPOSURE_NOON;
  let df = dayFraction - Math.floor(dayFraction);
  if (df < 0) df += 1;

  // Distance to noon on the wrapped 0..1 day cycle. 0 at noon, 0.5 at midnight.
  // Same shape city-composer's bloom curve uses; the two dials share an axis.
  const dNoon = Math.min(
    Math.abs(df - 0.25),
    Math.abs(df - 0.25 - 1),
    Math.abs(df - 0.25 + 1),
  );
  // Remap to [0, 1]: 0 at noon, 1 at midnight, 0.5 at either horizon.
  const raw = Math.min(1, dNoon * 2);

  if (raw <= 0.5) {
    // Noon → horizon. Smoothstep in raw*2 blends EXPOSURE_NOON to EXPOSURE_HORIZON.
    const u = raw * 2;
    const s = u * u * (3 - 2 * u);
    return EXPOSURE_NOON + (EXPOSURE_HORIZON - EXPOSURE_NOON) * s;
  }
  // Horizon → midnight. Smoothstep in (raw-0.5)*2 blends horizon to midnight.
  const u = (raw - 0.5) * 2;
  const s = u * u * (3 - 2 * u);
  return EXPOSURE_HORIZON + (EXPOSURE_MIDNIGHT - EXPOSURE_HORIZON) * s;
}
