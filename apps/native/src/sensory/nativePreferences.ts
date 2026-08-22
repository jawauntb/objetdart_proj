import { requireNativeModule } from "expo-modules-core";
import * as FileSystem from "expo-file-system/legacy";

import {
  createSensoryPreferenceCoordinator,
  type SensoryPreferences,
} from "./preferences";

type ObjetSensoryModule = Readonly<{
  setAudioMuted(muted: boolean): Promise<void>;
  setHapticsMuted(muted: boolean): Promise<void>;
  prewarmAudio(): Promise<void>;
}>;

const FILE_NAME = "objet-universe-sensory-v1.json";
const nativeSensory = requireNativeModule<ObjetSensoryModule>("ObjetSensory");

function preferenceUri(): string | null {
  const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  return root ? `${root}${FILE_NAME}` : null;
}

const coordinator = createSensoryPreferenceCoordinator(
  {
    async read() {
      const uri = preferenceUri();
      if (!uri) return null;
      try {
        return await FileSystem.readAsStringAsync(uri);
      } catch {
        return null;
      }
    },
    async write(value) {
      const uri = preferenceUri();
      if (!uri) return;
      try {
        await FileSystem.writeAsStringAsync(uri, value);
      } catch {
        // Preference persistence cannot interrupt a live universe. The
        // native buses already hold the requested process-local value.
      }
    },
  },
  {
    async apply(preferences) {
      await Promise.all([
        nativeSensory.setAudioMuted(preferences.audioMuted),
        nativeSensory.setHapticsMuted(preferences.hapticsMuted),
      ]);
    },
    async prewarmAudio() {
      await nativeSensory.prewarmAudio();
    },
  },
);

export function restoreNativeSensoryPreferences(): Promise<SensoryPreferences> {
  return coordinator.initialize();
}

export function updateNativeSensoryPreferences(
  patch: Partial<SensoryPreferences>,
): Promise<SensoryPreferences> {
  return coordinator.update(patch);
}

export function currentNativeSensoryPreferences(): SensoryPreferences {
  return coordinator.current();
}
