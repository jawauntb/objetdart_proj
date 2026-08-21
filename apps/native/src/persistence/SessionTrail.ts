import * as FileSystem from "expo-file-system/legacy";
import type { NativeSceneId } from "@objet/universe-contracts";
import type { SurfaceCommand } from "../../modules/objet-universe";
import {
  describeHistoryEvent,
  scaleIdForScene,
  type ProjectableTrailEntry,
  type TrailHistoryKind,
} from "../trail/model";

/** The bounded local projection that feeds the natural-history trail. */
export const SESSION_TRAIL_VERSION = 2 as const;
export const SESSION_TRAIL_LIMIT = 120 as const;

export type TrailEntry = Readonly<ProjectableTrailEntry & {
  version: typeof SESSION_TRAIL_VERSION;
  id: string;
  recordedAt: number;
  scene: NativeSceneId;
  scaleId: ReturnType<typeof scaleIdForScene>;
  historyKind: TrailHistoryKind;
  branchId: string;
  parentEventId: string | null;
  cause: string;
  consequence: string;
  scientificName: string;
}>;

type TrailEnvelope = Readonly<{
  version: 1 | typeof SESSION_TRAIL_VERSION;
  entries: readonly TrailEntry[];
}>;

const FILE_NAME = "objet-universe-trail-v1.json";
let writeQueue = Promise.resolve();

function trailUri(): string | null {
  const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  return root ? `${root}${FILE_NAME}` : null;
}

function isSurfaceCommand(value: unknown): value is SurfaceCommand {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SurfaceCommand>;
  return (
    typeof entry.verb === "string" &&
    typeof entry.semanticVerb === "string" &&
    typeof entry.layer === "string" &&
    typeof entry.source === "string" &&
    typeof entry.intensity === "number" &&
    Number.isFinite(entry.intensity) &&
    typeof entry.answered === "boolean"
  );
}

function normalizeEntry(value: unknown): TrailEntry | null {
  if (!value || typeof value !== "object" || !isSurfaceCommand(value)) return null;
  const entry = value as Partial<TrailEntry> & SurfaceCommand;
  if (typeof entry.id !== "string" || typeof entry.recordedAt !== "number" || !Number.isFinite(entry.recordedAt)) {
    return null;
  }
  const id = entry.id;
  const recordedAt = entry.recordedAt;
  const scene = isNativeSceneId(entry.scene) ? entry.scene : "wave";
  const description = describeHistoryEvent({
    scene,
    verb: entry.verb,
    semanticVerb: entry.semanticVerb,
    answered: entry.answered,
    historyKind: entry.historyKind,
  });
  return Object.freeze({
    ...entry,
    version: SESSION_TRAIL_VERSION,
    id,
    recordedAt,
    scene,
    scaleId: scaleIdForScene(scene),
    historyKind: description.kind,
    branchId: typeof entry.branchId === "string" && entry.branchId.length > 0 ? entry.branchId : "local-main",
    parentEventId:
      typeof entry.parentEventId === "string" || entry.parentEventId === null
        ? entry.parentEventId
        : null,
    cause: typeof entry.cause === "string" && entry.cause.length > 0 ? entry.cause : description.cause,
    consequence:
      typeof entry.consequence === "string" && entry.consequence.length > 0
        ? entry.consequence
        : description.consequence,
    scientificName:
      typeof entry.scientificName === "string" && entry.scientificName.length > 0
        ? entry.scientificName
        : description.scientificName,
  });
}

function boundedEntries(entries: readonly unknown[]): readonly TrailEntry[] {
  const normalized: TrailEntry[] = [];
  for (const entry of entries) {
    const valid = normalizeEntry(entry);
    if (valid) normalized.push(valid);
  }
  return normalized.slice(-SESSION_TRAIL_LIMIT).map((entry, index, bounded) => {
    if (entry.parentEventId !== null || index === 0) return entry;
    const parent = bounded.slice(0, index).reverse().find((candidate) => candidate.branchId === entry.branchId);
    return parent ? Object.freeze({ ...entry, parentEventId: parent.id }) : entry;
  });
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
    // Version 1 contained raw commands only. Normalisation preserves those
    // local memories while promoting them into the v2 natural-history shape.
    if ((envelope.version !== 1 && envelope.version !== SESSION_TRAIL_VERSION) || !Array.isArray(envelope.entries)) return [];
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
    if (!uri || !normalizeEntry(entry)) return;
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

export function makeTrailEntry(
  command: SurfaceCommand,
  sequence: number,
  recordedAt = Date.now(),
  context: Readonly<{
    scene?: NativeSceneId;
    branchId?: string;
    parentEventId?: string | null;
    historyKind?: TrailHistoryKind;
  }> = {},
): TrailEntry {
  const scene = context.scene ?? "wave";
  const description = describeHistoryEvent({
    scene,
    verb: command.verb,
    semanticVerb: command.semanticVerb,
    answered: command.answered,
    historyKind: context.historyKind,
  });
  return Object.freeze({
    ...command,
    version: SESSION_TRAIL_VERSION,
    id: `trail-${recordedAt}-${sequence}`,
    recordedAt,
    scene,
    scaleId: scaleIdForScene(scene),
    historyKind: description.kind,
    branchId: context.branchId ?? "local-main",
    parentEventId: context.parentEventId ?? null,
    cause: description.cause,
    consequence: description.consequence,
    scientificName: description.scientificName,
  });
}

function isNativeSceneId(value: unknown): value is NativeSceneId {
  return value === "wave" || value === "cell" || value === "solar" || value === "molecules" || value === "atoms";
}
