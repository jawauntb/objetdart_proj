"use client";

/**
 * The vessel bus — the device itself as an instrument.
 *
 * One site-wide subscription point for what the body of the phone can say:
 * tilt (gravity), shake (agitation), knock (a rap on the case), flip
 * (face-down night). Like `haptics.ts` this is a client-side singleton;
 * every caller shares one pair of window listeners and one permission
 * lifecycle instead of growing private ones.
 *
 * The permission law (gesture grammar §1): motion is *invited, never
 * demanded*. `requestVessel()` may only be called from inside a real user
 * gesture — on iOS it asks `DeviceMotionEvent.requestPermission()` and
 * `DeviceOrientationEvent.requestPermission()` together, and asking outside
 * a gesture simply fails. The grant is remembered in localStorage so a
 * returning visitor's vessel re-arms silently where the platform allows
 * (Android/desktop always; iOS resolves a prior grant without showing UI,
 * and rejects silently rather than prompting when it can't).
 *
 * Classification (shake windows, knock spikes) uses the shared thresholds
 * in gesture/core — rooms bind meanings, never thresholds.
 *
 * SSR-safe and feature-detected throughout: subscribing is always free, a
 * missing sensor costs a dimension, never a feature.
 */

import { THRESHOLDS, shakeIntensity, type MotionSample } from "@/lib/gesture/core";

export type VesselHandlers = {
  tilt?: (e: { beta: number; gamma: number }) => void;
  shake?: (e: { intensity: number }) => void;
  knock?: (e: { intensity: number }) => void;
  flip?: (e: { faceDown: boolean }) => void;
};

const KEY = "objetdart:vessel:v1";
const isBrowser = typeof window !== "undefined";

type Grant = "granted" | "declined";
type Requestable = { requestPermission?: () => Promise<"granted" | "denied"> };

const handlers = new Set<VesselHandlers>();
let armed = false; // permission settled and sensors flowing (when subscribed)
let listening = false; // window listeners currently attached
let askedThisSession = false; // the never-ask-twice invariant, per session
let rearmTried = false;

// — shared motion state (one classifier for all subscribers) —
const samples: MotionSample[] = [];
let lastShakeAt = 0;
let faceDown = false;
let lastTiltAt = 0;
// Hysteresis for face-down: enter at |beta| > FLIP_ENTER, exit under
// FLIP_EXIT. The wide gap means an ordinary hand tilt cannot cross it.
const FLIP_ENTER_DEG = 150;
const FLIP_EXIT_DEG = 120;

function storedGrant(): Grant | null {
  if (!isBrowser) return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "granted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

function storeGrant(g: Grant): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(KEY, g);
  } catch {
    /* noop */
  }
}

function permissionCtors(): { motion: Requestable | null; orientation: Requestable | null } {
  if (!isBrowser) return { motion: null, orientation: null };
  const w = window as unknown as {
    DeviceMotionEvent?: Requestable;
    DeviceOrientationEvent?: Requestable;
  };
  return { motion: w.DeviceMotionEvent ?? null, orientation: w.DeviceOrientationEvent ?? null };
}

function needsPermission(): boolean {
  const { motion, orientation } = permissionCtors();
  return (
    typeof motion?.requestPermission === "function" ||
    typeof orientation?.requestPermission === "function"
  );
}

/** Ask both permission gates (iOS 13+). True if either sensor family opened. */
async function askPlatform(): Promise<boolean> {
  const { motion, orientation } = permissionCtors();
  const results = await Promise.allSettled([
    motion?.requestPermission?.(),
    orientation?.requestPermission?.(),
  ]);
  return results.some((r) => r.status === "fulfilled" && r.value === "granted");
}

const onMotion = (ev: DeviceMotionEvent) => {
  const now = performance.now();
  const a = ev.acceleration;
  if (a && a.x !== null && a.y !== null && a.z !== null) {
    samples.push({ x: a.x, y: a.y, z: a.z, t: now });
    while (samples.length > 60) samples.shift();
    const intensity = shakeIntensity(samples, now);
    if (intensity > 0 && now - lastShakeAt > 900) {
      lastShakeAt = now;
      for (const h of handlers) h.shake?.({ intensity });
    }
    const mag = Math.hypot(a.x, a.y, a.z);
    if (mag > THRESHOLDS.knockThresh && intensity === 0 && now - lastShakeAt > 400) {
      lastShakeAt = now;
      const knock = { intensity: Math.min(1, mag / (THRESHOLDS.knockThresh * 2)) };
      for (const h of handlers) h.knock?.(knock);
    }
  }
  // Face-down detection moved to onOrient below: DeviceOrientationEvent.beta
  // is the W3C-standardized rotation around x (0 = face-up, ±180 = face-down),
  // while accelerationIncludingGravity.z has a cross-browser sign inconsistency
  // that made a flat *face-up* iPad read as face-down and dim the room — a
  // gyroscope answer to a question the hand never asked.
};

const onOrient = (ev: DeviceOrientationEvent) => {
  const now = performance.now();
  if (now - lastTiltAt < 50) return; // ~20Hz is plenty for gravity
  lastTiltAt = now;
  if (ev.beta !== null && ev.gamma !== null) {
    const tilt = { beta: ev.beta, gamma: ev.gamma };
    for (const h of handlers) h.tilt?.(tilt);
    // Face-down / face-up as an act of the hand, not a resting bias. Hysteresis
    // on |beta| so an ordinary tilt cannot skate across the threshold and the
    // room never turns to night just because the device was set down.
    const absBeta = Math.abs(ev.beta);
    if (!faceDown && absBeta > FLIP_ENTER_DEG) {
      faceDown = true;
      for (const h of handlers) h.flip?.({ faceDown });
    } else if (faceDown && absBeta < FLIP_EXIT_DEG) {
      faceDown = false;
      for (const h of handlers) h.flip?.({ faceDown });
    }
  }
};

/** Listeners live only while the vessel is armed AND someone is listening. */
function syncListeners(): void {
  const want = isBrowser && armed && handlers.size > 0;
  if (want && !listening) {
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrient);
    listening = true;
  } else if (!want && listening) {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrient);
    listening = false;
  }
}

/**
 * Re-arm a previously granted vessel without any UI. On platforms with no
 * permission gate this is free; on iOS a prior grant resolves silently and
 * anything else rejects silently (no dialog can appear outside a gesture).
 */
function maybeRearm(): void {
  if (!isBrowser || armed || rearmTried) return;
  rearmTried = true;
  if (!vesselAvailable() || storedGrant() !== "granted") return;
  if (!needsPermission()) {
    armed = true;
    syncListeners();
    return;
  }
  void askPlatform()
    .then((ok) => {
      if (ok) {
        armed = true;
        syncListeners();
      }
    })
    .catch(() => {
      /* stay dark; the invitation can still be accepted later */
    });
}

/** Does this device expose motion/orientation at all? (SSR: false.) */
export function vesselAvailable(): boolean {
  return (
    isBrowser &&
    (typeof DeviceMotionEvent !== "undefined" || typeof DeviceOrientationEvent !== "undefined")
  );
}

/** Is the vessel armed — permission settled, senses flowing to subscribers? */
export function vesselGranted(): boolean {
  return armed;
}

/**
 * The invitation. MUST be called from inside a real user gesture (a held
 * touch, a click) — iOS shows its dialog only then. Asks at most once per
 * session; a decline is remembered and the candle simply keeps burning.
 * Resolves true when the vessel's senses are flowing.
 */
export async function requestVessel(): Promise<boolean> {
  if (!vesselAvailable()) return false;
  if (armed) return true;
  if (askedThisSession) return armed;
  askedThisSession = true;
  if (needsPermission()) {
    let ok = false;
    try {
      ok = await askPlatform();
    } catch {
      ok = false;
    }
    if (!ok) {
      storeGrant("declined");
      return false;
    }
  }
  storeGrant("granted");
  armed = true;
  syncListeners();
  return true;
}

/**
 * Subscribe to the vessel. Multiplexed: any number of subscribers share the
 * same listeners and classifiers. Safe to call before any grant — events
 * simply start flowing if/when the vessel is armed. Returns detach.
 */
export function onVessel(on: VesselHandlers): () => void {
  if (!isBrowser) return () => {};
  handlers.add(on);
  maybeRearm();
  syncListeners();
  return () => {
    handlers.delete(on);
    syncListeners();
  };
}
