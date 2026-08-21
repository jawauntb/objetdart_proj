import * as FileSystem from "expo-file-system/legacy";
import type { NativeSceneId } from "@objet/universe-contracts";
import type { SurfaceCommand } from "../../modules/objet-universe";
import {
  describeHistoryEvent,
  scaleIdForScene,
  type BranchRecord,
  type ProjectableTrailEntry,
  type TrailHistoryKind,
} from "../trail/model";
import {
  branchStateAfter,
  mergeTrailEntries,
  normalizeSessionBranches,
  type BranchStateAction,
} from "../trail/sessionState";

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
  historyAuthority: "interaction" | "domain";
  logicalTick: number | null;
  checkpointDigest: string | null;
  branchId: string;
  parentEventId: string | null;
  cause: string;
  consequence: string;
  scientificName: string;
}>;

type TrailEnvelope = Readonly<{
  version: 1 | typeof SESSION_TRAIL_VERSION;
  entries: readonly TrailEntry[];
  branches?: readonly BranchRecord[];
  activeBranchId?: string;
}>;

export type SessionTrailState = Readonly<{
  entries: readonly TrailEntry[];
  branches: readonly BranchRecord[];
  activeBranchId: string;
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
  const authoritativeKind = entry.historyAuthority === "domain" && isTrailHistoryKind(entry.historyKind)
    ? entry.historyKind
    : undefined;
  const description = describeHistoryEvent({
    scene,
    verb: entry.verb,
    semanticVerb: entry.semanticVerb,
    answered: entry.answered,
    historyKind: authoritativeKind,
  });
  return Object.freeze({
    ...entry,
    version: SESSION_TRAIL_VERSION,
    id,
    recordedAt,
    scene,
    scaleId: scaleIdForScene(scene),
    historyKind: description.kind,
    historyAuthority: authoritativeKind ? "domain" : "interaction",
    logicalTick: typeof entry.logicalTick === "number" && Number.isFinite(entry.logicalTick)
      ? Math.max(0, Math.floor(entry.logicalTick))
      : null,
    checkpointDigest: typeof entry.checkpointDigest === "string" && entry.checkpointDigest.length > 0
      ? entry.checkpointDigest
      : null,
    branchId: typeof entry.branchId === "string" && entry.branchId.length > 0 ? entry.branchId : "local-main",
    parentEventId:
      typeof entry.parentEventId === "string" || entry.parentEventId === null
        ? entry.parentEventId
        : null,
    cause: authoritativeKind && typeof entry.cause === "string" && entry.cause.length > 0
      ? entry.cause
      : description.cause,
    consequence:
      authoritativeKind && typeof entry.consequence === "string" && entry.consequence.length > 0
        ? entry.consequence
        : description.consequence,
    scientificName:
      authoritativeKind && typeof entry.scientificName === "string" && entry.scientificName.length > 0
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

const EMPTY_STATE: SessionTrailState = Object.freeze({
  entries: Object.freeze([]),
  branches: Object.freeze([{ id: "local-main", parentId: null, retired: false }]),
  activeBranchId: "local-main",
});

async function readSessionTrailState(): Promise<SessionTrailState> {
  const uri = trailUri();
  if (!uri) return EMPTY_STATE;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return EMPTY_STATE;
    const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(uri));
    if (!parsed || typeof parsed !== "object") return EMPTY_STATE;
    const envelope = parsed as Partial<TrailEnvelope>;
    if (
      (envelope.version !== 1 && envelope.version !== SESSION_TRAIL_VERSION) ||
      !Array.isArray(envelope.entries)
    ) return EMPTY_STATE;
    // Older entries did not record whether a specific scientific outcome came
    // from the domain kernel. Missing authority is intentionally treated as a
    // generic intervention rather than presented as an authoritative event.
    const entries = boundedEntries(envelope.entries);
    const records = envelope.version === SESSION_TRAIL_VERSION && Array.isArray(envelope.branches)
      ? envelope.branches.filter(isBranchRecord)
      : [];
    const branchState = normalizeSessionBranches(
      entries,
      records,
      envelope.version === SESSION_TRAIL_VERSION && typeof envelope.activeBranchId === "string"
        ? envelope.activeBranchId
        : "local-main",
    );
    return Object.freeze({ entries, ...branchState });
  } catch {
    // A damaged memory surface must never block the material. The next valid
    // append replaces it with a fresh versioned envelope.
    return EMPTY_STATE;
  }
}

/** Load after prior mutations so readers never observe a half-written envelope. */
export async function loadSessionTrailState(): Promise<SessionTrailState> {
  await writeQueue;
  return readSessionTrailState();
}

export async function loadSessionTrail(): Promise<readonly TrailEntry[]> {
  return (await loadSessionTrailState()).entries;
}

function persistMutation(
  mutate: (state: SessionTrailState) => SessionTrailState,
): Promise<SessionTrailState> {
  let resolved = EMPTY_STATE;
  const operation = writeQueue.then(async () => {
    const prior = await readSessionTrailState();
    resolved = mutate(prior);
    const uri = trailUri();
    if (!uri) throw new Error("trail storage unavailable");
    const envelope: TrailEnvelope = {
      version: SESSION_TRAIL_VERSION,
      entries: resolved.entries,
      branches: resolved.branches,
      activeBranchId: resolved.activeBranchId,
    };
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(envelope));
  });
  // Keep later writes live after a failed mutation, while returning the
  // original rejection to the UI that requested this specific change.
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation.then(() => resolved);
}

/** Append in order, serialising writes so rapid gestures cannot overwrite one another. */
export function appendSessionTrail(entry: TrailEntry): Promise<SessionTrailState> {
  return persistMutation((prior) => {
    const normalized = normalizeEntry(entry);
    if (!normalized) return prior;
    const entries = boundedEntries(mergeTrailEntries(prior.entries, [normalized]));
    const branchState = normalizeSessionBranches(entries, prior.branches, prior.activeBranchId);
    return Object.freeze({ entries, ...branchState });
  });
}

export function switchSessionBranch(branchId: string): Promise<SessionTrailState> {
  return changeBranch({ type: "switch", branchId });
}

export function retireSessionBranch(branchId: string): Promise<SessionTrailState> {
  return changeBranch({ type: "retire", branchId });
}

export function restoreSessionBranch(branchId: string): Promise<SessionTrailState> {
  return changeBranch({ type: "restore", branchId });
}

export function forkSessionBranch(parentBranchId: string): Promise<SessionTrailState> {
  return persistMutation((prior) => {
    const parent = prior.branches.find((branch) => branch.id === parentBranchId && !branch.retired);
    if (!parent) return prior;
    const id = `local-${Date.now()}-${prior.branches.length}`;
    return Object.freeze({
      entries: prior.entries,
      branches: Object.freeze([...prior.branches, Object.freeze({ id, parentId: parent.id, retired: false })]),
      activeBranchId: id,
    });
  });
}

function changeBranch(action: BranchStateAction): Promise<SessionTrailState> {
  return persistMutation((prior) => Object.freeze({
    entries: prior.entries,
    ...branchStateAfter(prior, action),
  }));
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
  const historyKind = command.historyKind ?? context.historyKind;
  const description = describeHistoryEvent({
    scene,
    verb: command.verb,
    semanticVerb: command.semanticVerb,
    answered: command.answered,
    historyKind,
  });
  return Object.freeze({
    ...command,
    version: SESSION_TRAIL_VERSION,
    id: command.eventId ?? `trail-${recordedAt}-${sequence}`,
    recordedAt,
    scene,
    scaleId: scaleIdForScene(scene),
    historyKind: description.kind,
    historyAuthority: historyKind ? "domain" : "interaction",
    logicalTick: typeof command.logicalTick === "number" ? command.logicalTick : null,
    checkpointDigest: command.checkpointDigest ?? null,
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

function isTrailHistoryKind(value: unknown): value is TrailHistoryKind {
  return value === "birth" || value === "division" || value === "merge" || value === "collision" ||
    value === "discovery" || value === "branch" || value === "intervention";
}

function isBranchRecord(value: unknown): value is BranchRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BranchRecord>;
  return typeof record.id === "string" && record.id.length > 0 &&
    (typeof record.parentId === "string" || record.parentId === null) &&
    typeof record.retired === "boolean";
}
