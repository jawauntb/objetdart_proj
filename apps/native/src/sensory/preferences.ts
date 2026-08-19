// Sensory preferences are authoritative on muting. The native audio and
// haptic buses (packages/objet-universe-kit/Sources/ObjetUniverseSensory)
// consult this shape via SensoryModule.setAudioMuted / setHapticsMuted;
// nothing else in the app is allowed to mute a bus.
// Visual scientific feedback stays authoritative regardless — the user
// cannot mute the scene.

import type { Sense } from "@objet/universe-contracts";

export type SensorySense = Sense;

export type SensoryPreferences = Readonly<{
  audioMuted: boolean;
  hapticsMuted: boolean;
}>;

export const DEFAULT_SENSORY_PREFERENCES: SensoryPreferences = Object.freeze({
  audioMuted: false,
  hapticsMuted: false,
});

export function applySensoryPreferences(
  current: SensoryPreferences,
  patch: Partial<SensoryPreferences>,
): SensoryPreferences {
  const audioMuted =
    typeof patch.audioMuted === "boolean" ? patch.audioMuted : current.audioMuted;
  const hapticsMuted =
    typeof patch.hapticsMuted === "boolean" ? patch.hapticsMuted : current.hapticsMuted;
  return Object.freeze({ audioMuted, hapticsMuted });
}

// The senses the bus is permitted to actuate under the current preferences.
// Visual is always present — muting audio or haptics never removes visual
// scientific feedback from the enabled set.
export function enabledSenses(prefs: SensoryPreferences): ReadonlySet<SensorySense> {
  const senses: SensorySense[] = ["visual"];
  if (!prefs.audioMuted) senses.push("audio");
  if (!prefs.hapticsMuted) senses.push("haptic");
  return new Set(senses);
}

export function isSensoryChannelEnabled(
  prefs: SensoryPreferences,
  sense: SensorySense,
): boolean {
  if (sense === "visual") return true;
  if (sense === "audio") return !prefs.audioMuted;
  return !prefs.hapticsMuted;
}

// Mirror of the native `SensoryDispatch` enum's coarse shape. The bridge
// only surfaces bus state at this granularity — never per-event details —
// because per-event authority lives on the native side.
export type SensoryBusState = Readonly<{
  audioMuted: boolean;
  hapticsMuted: boolean;
  hapticEngineAvailable: boolean;
}>;

export function busStateFromPreferences(
  prefs: SensoryPreferences,
  hapticEngineAvailable: boolean,
): SensoryBusState {
  return Object.freeze({
    audioMuted: prefs.audioMuted,
    hapticsMuted: prefs.hapticsMuted,
    hapticEngineAvailable,
  });
}
