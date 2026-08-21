import * as FileSystem from "expo-file-system/legacy";
import {
  EMPTY_UNIVERSE_PROGRESS,
  normalizeUniverseProgress,
  type UniverseProgress,
} from "./UniverseProgressLogic";

export * from "./UniverseProgressLogic";

const FILE_NAME = "objet-universe-progress-v2.json";
const LEGACY_FILE_NAME = "objet-universe-progress-v1.json";

function progressUri(fileName = FILE_NAME): string | null {
  const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  return root ? `${root}${fileName}` : null;
}

function parseProgressEnvelope(raw: string): UniverseProgress {
  const value = JSON.parse(raw) as { version?: unknown };
  if (!value || typeof value !== "object" || (value.version !== 1 && value.version !== 2)) {
    throw new Error("unsupported progression envelope");
  }
  return normalizeUniverseProgress(value);
}

/** A damaged or old progression file is safe to replace, never a reason to block play. */
export async function loadUniverseProgress(): Promise<UniverseProgress> {
  const uri = progressUri();
  const legacyUri = progressUri(LEGACY_FILE_NAME);
  if (!uri) return EMPTY_UNIVERSE_PROGRESS;
  try {
    await writeQueue;
    try {
      return parseProgressEnvelope(await FileSystem.readAsStringAsync(uri));
    } catch {
      if (!legacyUri) return EMPTY_UNIVERSE_PROGRESS;
      const migrated = parseProgressEnvelope(await FileSystem.readAsStringAsync(legacyUri));
      void saveUniverseProgress(migrated);
      return migrated;
    }
  } catch {
    return EMPTY_UNIVERSE_PROGRESS;
  }
}

let writeQueue = Promise.resolve();
let pendingProgress: UniverseProgress | null = null;
let writeScheduled = false;

export function saveUniverseProgress(progress: UniverseProgress): Promise<void> {
  pendingProgress = normalizeUniverseProgress(progress);
  if (writeScheduled) return writeQueue;
  writeScheduled = true;
  writeQueue = writeQueue.then(async () => {
    const uri = progressUri();
    if (!uri) return;
    while (pendingProgress) {
      const next = pendingProgress;
      pendingProgress = null;
      try {
        await FileSystem.writeAsStringAsync(uri, JSON.stringify(next));
      } catch {
        // Progress is a convenience surface. A failed write cannot interrupt
        // a live command or make the native material disappear.
        pendingProgress = null;
      }
    }
  }).catch(() => {
    pendingProgress = null;
  }).finally(() => {
    writeScheduled = false;
  });
  return writeQueue;
}
