"use client";

import { getTurbulence } from "@/lib/turbulence";

/**
 * Haptics — touch given back.
 *
 * The site already speaks in sight and sound; this is the third sense, the
 * only one that pushes back into the hand. Every pattern here is a little
 * wave: a single swell, broken chop, a long roll. Intensity rides the shared
 * turbulence axis, so a calm sea taps softly and a storm pounds.
 *
 * Reality check: `navigator.vibrate` is an Android/Chromium thing. iOS Safari
 * does not implement it, so on iPhone these are silent no-ops — the visual
 * and audio layers still carry the interaction. Everything is feature-detected
 * and SSR-safe, so calling into here is always free.
 */

let enabled = true;

function canVibrate(): boolean {
  if (!enabled) return false;
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.vibrate !== "function") return false;
  if (typeof window !== "undefined") {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    } catch { /* noop */ }
  }
  return true;
}

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  if (!on && canVibrateRaw()) { try { navigator.vibrate(0); } catch { /* noop */ } }
}

export function hapticsEnabled(): boolean {
  return enabled;
}

function canVibrateRaw(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Low-level escape hatch — fire an arbitrary vibrate pattern, guarded. */
export function haptic(pattern: number | number[]): void {
  if (!canVibrate()) return;
  try { navigator.vibrate(pattern); } catch { /* noop */ }
}

// How hard the current sea is hitting: 0.6 at glass, up to ~1.45 at full
// storm. Applied as a duration multiplier so the same gesture feels heavier
// as turbulence rises.
function gain(extra = 0): number {
  return 0.6 + (getTurbulence() + extra) * 0.85;
}

const ms = (v: number) => Math.max(1, Math.round(v));

/** A glancing contact — hover drift, light tick. */
export function tap(): void {
  haptic(ms(7 * gain()));
}

/**
 * A ripple — the standard "I touched the water" swell. `strength` 0..1 scales
 * the pulse so a hard poke lands more than a graze.
 */
export function ripple(strength = 0.5): void {
  haptic(ms((8 + strength * 16) * gain()));
}

/** Broken water under a moving finger — a short stutter. */
export function chop(): void {
  const g = gain();
  haptic([ms(5 * g), ms(22), ms(7 * g)]);
}

/** A long roll — a bell, a reveal, a swell breaking. */
export function roll(): void {
  const g = gain(0.1);
  haptic([ms(14 * g), ms(26), ms(34 * g)]);
}

/** The storm itself — a chaotic burst, used when turbulence spikes. */
export function storm(): void {
  const g = gain(0.25);
  haptic([ms(30 * g), ms(40), ms(60 * g), ms(30), ms(90 * g)]);
}
