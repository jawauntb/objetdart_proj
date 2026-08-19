import type { VersionedAction } from "./actions.ts";
import type { DomainTime, UniverseLogicalTime } from "./universe.ts";

export const HISTORY_CONTRACT_VERSION = 1 as const;

export type DomainEvent = Readonly<{
  version: typeof HISTORY_CONTRACT_VERSION;
  id: string;
  branchId: string;
  logicalTime: UniverseLogicalTime;
  domainTime: DomainTime;
  action: VersionedAction;
}>;

export type Checkpoint = Readonly<{
  version: typeof HISTORY_CONTRACT_VERSION;
  id: string;
  branchId: string;
  logicalTime: UniverseLogicalTime;
  modelVersion: string;
  stateDigest: string;
}>;

export type NaturalHistoryKind = "birth" | "merge" | "division" | "extinction" | "phase-change" | "discovery" | "intervention" | "branch";
export type NaturalHistoryEvent = Readonly<{
  version: typeof HISTORY_CONTRACT_VERSION;
  id: string;
  kind: NaturalHistoryKind;
  branchId: string;
  logicalTime: UniverseLogicalTime;
  domainEventId: string | null;
  subjectIds: readonly string[];
  summary: string;
}>;

export function appendNaturalHistory(history: readonly NaturalHistoryEvent[], event: NaturalHistoryEvent): readonly NaturalHistoryEvent[] {
  if (history.some((item) => item.id === event.id)) return history;
  return [...history, event].sort((a, b) => a.logicalTime.tick - b.logicalTime.tick || a.logicalTime.ordinal - b.logicalTime.ordinal || a.id.localeCompare(b.id));
}

export function checkpointFollowsEvent(checkpoint: Checkpoint, event: DomainEvent): boolean {
  if (checkpoint.branchId !== event.branchId) return false;
  return checkpoint.logicalTime.tick > event.logicalTime.tick || (checkpoint.logicalTime.tick === event.logicalTime.tick && checkpoint.logicalTime.ordinal >= event.logicalTime.ordinal);
}
