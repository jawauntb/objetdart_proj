import {
  NATIVE_SCALE_ADDRESSES,
  type NativeScaleId,
  type NativeSceneId,
} from "@objet/universe-contracts";
import type { SurfaceCommand } from "../../modules/objet-universe";

export const NATURAL_HISTORY_LIMIT = 120 as const;

export type TrailHistoryKind =
  | "birth"
  | "division"
  | "merge"
  | "collision"
  | "discovery"
  | "branch"
  | "intervention";

export type TrailReturnAnchor = Readonly<{
  scene: NativeSceneId;
  eventId: string;
  recordedAt: number;
}>;

export type ProjectableTrailEntry = Readonly<SurfaceCommand & {
  id: string;
  recordedAt: number;
  scene: NativeSceneId;
  historyKind?: TrailHistoryKind;
  branchId?: string;
  parentEventId?: string | null;
  cause?: string;
  consequence?: string;
  scientificName?: string;
}>;

export type TrailHistoryEvent = Readonly<{
  id: string;
  recordedAt: number;
  scene: NativeSceneId;
  scaleId: NativeScaleId;
  scaleLabel: string;
  kind: TrailHistoryKind;
  branchId: string;
  parentEventId: string | null;
  cause: string;
  consequence: string;
  scientificName: string;
  answered: boolean;
  intensity: number;
  returnAnchor: TrailReturnAnchor;
}>;

export type TrailProjection = Readonly<{
  events: readonly TrailHistoryEvent[];
  scaleOrder: readonly NativeScaleId[];
  emptyMessage: string;
}>;

export type BranchRecord = Readonly<{
  id: string;
  parentId: string | null;
  retired: boolean;
}>;

export type TrailBranchSummary = Readonly<{
  id: string;
  parentId: string | null;
  commonAncestorId: string | null;
  retired: boolean;
  eventCount: number;
  latestEvent: TrailHistoryEvent | null;
}>;

export type RetirementState = "active" | "retired";
export type RetirementResult = RetirementState | "deferred";

const SCALE_BY_SCENE: Readonly<Record<NativeSceneId, NativeScaleId>> = {
  wave: "wave-medium",
  cell: "cellular-colony",
  molecules: "molecular-bond",
  atoms: "atomic-shell",
  solar: "solar-formation",
};

const SCIENTIFIC_NAME_BY_KIND: Readonly<Record<TrailHistoryKind, string>> = {
  birth: "formation",
  division: "cell division",
  merge: "coalescence",
  collision: "collision",
  discovery: "observation",
  branch: "historical branch",
  intervention: "intervention",
};

export function scaleIdForScene(scene: NativeSceneId): NativeScaleId {
  return SCALE_BY_SCENE[scene];
}

export function inferHistoryKind(
  entry: Pick<ProjectableTrailEntry, "scene" | "verb" | "semanticVerb">,
): TrailHistoryKind {
  // The coarse bridge confirms that a semantic command was expressed, but it
  // does not claim a particular scientific outcome. Specific births,
  // collisions, merges, divisions, and branches enter through historyKind
  // only when the authoritative kernel emits that committed projection.
  if (entry.semanticVerb === "ceremony") return "discovery";
  return "intervention";
}

export function describeHistoryEvent(
  entry: Pick<ProjectableTrailEntry, "scene" | "verb" | "semanticVerb" | "answered"> & {
    historyKind?: TrailHistoryKind;
  },
): Readonly<{
  kind: TrailHistoryKind;
  cause: string;
  consequence: string;
  scientificName: string;
}> {
  const kind = entry.historyKind ?? inferHistoryKind(entry);
  const sceneName = sceneNoun(entry.scene);
  const answer = entry.answered
    ? `${sceneName} changed and kept the result`
    : `${sceneName} registered the attempt without changing its durable state`;
  return {
    kind,
    cause: causeFor(entry.semanticVerb, entry.verb),
    consequence: consequenceFor(kind, entry.scene, answer),
    scientificName: SCIENTIFIC_NAME_BY_KIND[kind],
  };
}

export function projectNaturalHistory(
  entries: readonly ProjectableTrailEntry[],
): TrailProjection {
  const ordered = entries
    .filter(isProjectableEntry)
    .slice()
    .sort((a, b) => a.recordedAt - b.recordedAt || a.id.localeCompare(b.id))
    .slice(-NATURAL_HISTORY_LIMIT);
  const events = ordered.map<TrailHistoryEvent>((entry, index) => {
    const description = describeHistoryEvent(entry);
    const scaleId = scaleIdForScene(entry.scene);
    return Object.freeze({
      id: entry.id,
      recordedAt: entry.recordedAt,
      scene: entry.scene,
      scaleId,
      scaleLabel: NATIVE_SCALE_ADDRESSES[scaleId].physical.label,
      kind: description.kind,
      branchId: entry.branchId ?? "local-main",
      parentEventId:
        entry.parentEventId ??
        ordered.slice(0, index).reverse().find((candidate) =>
          (candidate.branchId ?? "local-main") === (entry.branchId ?? "local-main"),
        )?.id ??
        null,
      cause: entry.cause ?? description.cause,
      consequence: entry.consequence ?? description.consequence,
      scientificName: entry.scientificName ?? description.scientificName,
      answered: entry.answered,
      intensity: entry.intensity,
      returnAnchor: Object.freeze({
        scene: entry.scene,
        eventId: entry.id,
        recordedAt: entry.recordedAt,
      }),
    });
  });
  const scaleOrder = Array.from(new Set(events.map((event) => event.scaleId)));
  return Object.freeze({
    events: Object.freeze(events),
    scaleOrder: Object.freeze(scaleOrder),
    emptyMessage: "your first change will become the beginning of this world’s history.",
  });
}

export function branchSummaries(
  events: readonly TrailHistoryEvent[],
  records: readonly BranchRecord[],
): readonly TrailBranchSummary[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  return records.map((record) => {
    const branchEvents = events.filter((event) => event.branchId === record.id);
    return Object.freeze({
      id: record.id,
      parentId: record.parentId,
      commonAncestorId: nearestSharedAncestor(record, records, recordById),
      retired: record.retired,
      eventCount: branchEvents.length,
      latestEvent: branchEvents[branchEvents.length - 1] ?? null,
    });
  });
}

/**
 * Retirement is a reversible visibility change. It cannot target the branch
 * currently being inhabited, and it never shares an API with irreversible
 * purge.
 */
export function retirementTransition(
  current: RetirementState,
  intent: Readonly<{ isCurrent: boolean; confirmed: boolean }>,
): RetirementResult {
  if (intent.isCurrent || !intent.confirmed) return "deferred";
  return current === "active" ? "retired" : "active";
}

function isProjectableEntry(entry: ProjectableTrailEntry): boolean {
  return Boolean(
    entry &&
      entry.answered &&
      typeof entry.id === "string" &&
      entry.id.length > 0 &&
      Number.isFinite(entry.recordedAt) &&
      Object.hasOwn(SCALE_BY_SCENE, entry.scene),
  );
}

function nearestSharedAncestor(
  record: BranchRecord,
  records: readonly BranchRecord[],
  recordById: ReadonlyMap<string, BranchRecord>,
): string | null {
  if (!record.parentId) return null;
  const parentHasSibling = records.some(
    (candidate) => candidate.id !== record.id && candidate.parentId === record.parentId,
  );
  if (parentHasSibling) return record.parentId;
  let cursor = recordById.get(record.parentId);
  while (cursor?.parentId) cursor = recordById.get(cursor.parentId);
  return cursor?.id ?? record.parentId;
}

function sceneNoun(scene: NativeSceneId): string {
  switch (scene) {
    case "wave": return "the wave field";
    case "cell": return "the colony";
    case "solar": return "the forming system";
    case "molecules": return "the molecular field";
    case "atoms": return "the atomic field";
  }
}

function causeFor(semanticVerb: string, verb: string): string {
  switch (semanticVerb) {
    case "grow": return "a sustained touch added matter or structure";
    case "ceremony": return "a long hold committed a noticed state";
    case "lens": return "a two-finger turn changed how the same state was read";
    case "weather": return "a three-finger drag changed the shared environment";
    case "time-dilation": return "a held world gesture changed the rate of becoming";
    case "material": return `the ${verb} gesture intervened in the material`;
    default: return `the ${semanticVerb} action changed the world’s conditions`;
  }
}

function consequenceFor(kind: TrailHistoryKind, scene: NativeSceneId, fallback: string): string {
  switch (kind) {
    case "birth": return scene === "solar" ? "matter gathered into a new persistent body" : "a new persistent structure entered the field";
    case "division": return "one lineage became two related living bodies";
    case "merge": return "separate structures became one conserved result";
    case "collision": return "momentum and matter were reconciled into the surviving system";
    case "discovery": return "the observed relationship became available to the guide";
    case "branch": return "history continued without overwriting its parent";
    case "intervention": return fallback;
  }
}
