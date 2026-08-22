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

export const SENSORY_PREFERENCES_VERSION = 1 as const;

export type SensoryPreferenceStorage = Readonly<{
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}>;

export type SensoryPreferenceBridge = Readonly<{
  apply(preferences: SensoryPreferences): Promise<void>;
  prewarmAudio(): Promise<void>;
}>;

type SensoryPreferenceEnvelope = Readonly<{
  version: typeof SENSORY_PREFERENCES_VERSION;
  audioMuted: boolean;
  hapticsMuted: boolean;
}>;

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

export function toggleSensoryPreference(
  current: SensoryPreferences,
  sense: "audio" | "haptic",
): SensoryPreferences {
  return applySensoryPreferences(
    current,
    sense === "audio"
      ? { audioMuted: !current.audioMuted }
      : { hapticsMuted: !current.hapticsMuted },
  );
}

export function parseSensoryPreferences(raw: string | null): SensoryPreferences {
  if (!raw) return DEFAULT_SENSORY_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<SensoryPreferenceEnvelope>;
    if (parsed.version !== SENSORY_PREFERENCES_VERSION) return DEFAULT_SENSORY_PREFERENCES;
    return applySensoryPreferences(DEFAULT_SENSORY_PREFERENCES, parsed);
  } catch {
    return DEFAULT_SENSORY_PREFERENCES;
  }
}

export function serializeSensoryPreferences(preferences: SensoryPreferences): string {
  const envelope: SensoryPreferenceEnvelope = {
    version: SENSORY_PREFERENCES_VERSION,
    audioMuted: preferences.audioMuted,
    hapticsMuted: preferences.hapticsMuted,
  };
  return JSON.stringify(envelope);
}

/**
 * One serialized owner for startup restoration and later preference changes.
 * A fresh coordinator reading the same storage models an app relaunch; it
 * reapplies the saved values to the process-wide native buses before play.
 */
export function createSensoryPreferenceCoordinator(
  storage: SensoryPreferenceStorage,
  bridge: SensoryPreferenceBridge,
) {
  let current = DEFAULT_SENSORY_PREFERENCES;
  let work = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = work.then(operation, operation);
    work = result.then(() => undefined, () => undefined);
    return result;
  };

  return Object.freeze({
    current: () => current,
    initialize: () => enqueue(async () => {
      current = parseSensoryPreferences(await storage.read());
      await bridge.apply(current);
      await bridge.prewarmAudio();
      return current;
    }),
    update: (patch: Partial<SensoryPreferences>) => enqueue(async () => {
      current = applySensoryPreferences(current, patch);
      await bridge.apply(current);
      await storage.write(serializeSensoryPreferences(current));
      return current;
    }),
  });
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
