"use client";

/**
 * Turbulence — the calm↔storm axis.
 *
 * One scalar (0 = glass, 1 = storm) that the whole instrument can ride at
 * once: the sea swells harder, the haptics hit heavier, the room can answer
 * with weather. This is Burke's beautiful↔sublime made physical — the same
 * wave, just amplitude and chaos.
 *
 * It lives outside React on purpose. The value is read every animation frame
 * and stirred by raw device motion, so pushing it through a store would mean
 * 60fps re-renders. Instead it's a tiny singleton: callers `get`, sensors
 * `stir`, and whoever owns the frame loop `relax`es it back toward calm.
 */

let level = 0;          // current turbulence, 0..1
let relaxAt = 0;        // last relax timestamp (performance.now ms)

// seconds for the storm to fall to ~37% of its height when left alone.
const DECAY_TAU = 5.5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function getTurbulence(): number {
  return level;
}

export function setTurbulence(v: number): void {
  level = clamp01(v);
}

/** Add an impulse — a shake, a hard press, a chart shock. */
export function stirTurbulence(amount: number): void {
  level = clamp01(level + amount);
}

/**
 * Relax toward calm. Call once per frame from the animation loop that owns
 * the scene; `now` is performance.now(). Idempotent against missed frames —
 * decay is time-based, not per-call.
 */
export function relaxTurbulence(now: number): number {
  if (relaxAt === 0) { relaxAt = now; return level; }
  const dt = Math.max(0, (now - relaxAt) / 1000);
  relaxAt = now;
  level *= Math.exp(-dt / DECAY_TAU);
  if (level < 0.0005) level = 0;
  return level;
}
