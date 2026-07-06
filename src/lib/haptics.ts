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
 * does not implement it, but the Objet Coin iOS app installs a native bridge
 * that maps these patterns into Core Haptics. Everything is feature-detected
 * and SSR-safe, so calling into here is always free.
 */

let enabled = true;

type NativeHapticBridge = {
  __objetCoinNative?: {
    haptic?: (pattern: number | number[]) => boolean | void;
  };
  webkit?: {
    messageHandlers?: {
      coinHaptic?: {
        postMessage: (message: unknown) => void;
      };
    };
  };
};

function nativeBridge(): NativeHapticBridge | null {
  if (typeof window === "undefined") return null;
  return window as Window & NativeHapticBridge;
}

function canNativeHaptic(): boolean {
  const bridge = nativeBridge();
  return !!(
    bridge?.__objetCoinNative?.haptic ||
    bridge?.webkit?.messageHandlers?.coinHaptic
  );
}

function sendNativeHaptic(pattern: number | number[]): boolean {
  const bridge = nativeBridge();
  if (!bridge) return false;

  try {
    if (bridge.__objetCoinNative?.haptic) {
      bridge.__objetCoinNative.haptic(pattern);
      return true;
    }
    bridge.webkit?.messageHandlers?.coinHaptic?.postMessage({ type: "haptic", pattern });
    return !!bridge.webkit?.messageHandlers?.coinHaptic;
  } catch {
    return false;
  }
}

function canVibrate(): boolean {
  if (!enabled) return false;
  if (typeof navigator === "undefined") return false;
  if (typeof window !== "undefined") {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    } catch { /* noop */ }
  }
  return typeof navigator.vibrate === "function" || canNativeHaptic();
}

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    if (canVibrateRaw()) { try { navigator.vibrate(0); } catch { /* noop */ } }
    else sendNativeHaptic(0);
  }
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
  if (canVibrateRaw()) {
    try { navigator.vibrate(pattern); return; } catch { /* fall through */ }
  }
  sendNativeHaptic(pattern);
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
