import * as FileSystem from "expo-file-system/legacy";
import type { SurfaceCommand } from "../../modules/objet-universe";

/** The small, local-first memory surface shown by the native trail sheet. */
export const SESSION_TRAIL_VERSION = 1 as const;
export const SESSION_TRAIL_LIMIT = 120 as const;

export type TrailEntry = Readonly<SurfaceCommand & {
  id: string;
  recordedAt: number;
}>;

type TrailEnvelope = Readonly<{
  version: typeof SESSION_TRAIL_VERSION;
  entries: readonly TrailEntry[];
}>;

const FILE_NAME = "objet-universe-trail-v1.json";
let writeQueue = Promise.resolve();

function trailUri(): string | null {
  const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  return root ? `${root}${FILE_NAME}` : null;
}

function isTrailEntry(value: unknown): value is TrailEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<TrailEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.recordedAt === "number" &&
    Number.isFinite(entry.recordedAt) &&
    typeof entry.verb === "string" &&
    typeof entry.semanticVerb === "string" &&
    typeof entry.layer === "string" &&
    typeof entry.source === "string" &&
    typeof entry.intensity === "number" &&
    Number.isFinite(entry.intensity) &&
    typeof entry.answered === "boolean"
  );
}

function boundedEntries(entries: readonly TrailEntry[]): readonly TrailEntry[] {
  return entries.filter(isTrailEntry).slice(-SESSION_TRAIL_LIMIT);
}

/** Load an honest empty trail when the file is absent, corrupt, or too old. */
export async function loadSessionTrail(): Promise<readonly TrailEntry[]> {
  const uri = trailUri();
  if (!uri) return [];
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return [];
    const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(uri));
    if (!parsed || typeof parsed !== "object") return [];
    const envelope = parsed as Partial<TrailEnvelope>;
    if (envelope.version !== SESSION_TRAIL_VERSION || !Array.isArray(envelope.entries)) return [];
    return boundedEntries(envelope.entries);
  } catch {
    // A damaged memory surface must never block the material. The next valid
    // append replaces it with a fresh versioned envelope.
    return [];
  }
}

/** Append in order, serialising writes so rapid gestures cannot overwrite one another. */
export function appendSessionTrail(entry: TrailEntry): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const uri = trailUri();
    if (!uri || !isTrailEntry(entry)) return;
    const prior = await loadSessionTrail();
    const next: TrailEnvelope = {
      version: SESSION_TRAIL_VERSION,
      entries: boundedEntries([...prior, entry]),
    };
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(next));
  }).catch(() => {
    // Persistence is a return-value feature, never a reason to drop a live
    // wave command or surface an unhandled promise rejection.
  });
  return writeQueue;
}

export function makeTrailEntry(command: SurfaceCommand, sequence: number, recordedAt = Date.now()): TrailEntry {
  return {
    ...command,
    id: `trail-${recordedAt}-${sequence}`,
    recordedAt,
  };
}
