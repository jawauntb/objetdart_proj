/**
 * recovery.ts — decodes a persisted universe on relaunch, catches it up
 * across the elapsed absence, and reports what the runtime should do.
 *
 * Modelled on `src/lib/cytology.ts` (`validateStoredCulture` +
 * `catchUpCulture`): a corrupt or partial record degrades to a well-formed
 * empty result rather than throwing, and a clock set backwards reads as
 * zero elapsed — never negative, never a jump. AE4 lives here.
 */

import {
  compareLogicalTime,
  isVersionedAction,
  type Checkpoint,
  type DomainEvent,
  type NaturalHistoryEvent,
  type UniverseBranch,
  type UniverseIdentity,
} from "@objet/universe-contracts";
import type { UniverseRepository } from "./UniverseRepository.ts";

export type RecoveryNote =
  | { kind: "no-universe" }
  | { kind: "invalid-checkpoint"; checkpointId: string }
  | { kind: "future-checkpoint"; checkpointId: string; universeTick: number; checkpointTick: number }
  | { kind: "corrupt-event-dropped"; eventId: string }
  | { kind: "no-active-branch" }
  | { kind: "fell-back-to-branch"; branchId: string; reason: "inhabited-purged" | "inhabited-missing" }
  | { kind: "resumed"; branchId: string; from: "seed" | "checkpoint"; replayCount: number }
  | { kind: "absence-advanced"; branchId: string; hours: number };

export type RecoverySnapshot = Readonly<{
  universe: UniverseIdentity | null;
  branch: UniverseBranch | null;
  promotedCheckpoint: Checkpoint | null;
  eventsPastCheckpoint: readonly DomainEvent[];
  naturalHistoryPastCheckpoint: readonly NaturalHistoryEvent[];
  absenceHours: number;
  notes: readonly RecoveryNote[];
}>;

export type RecoveryOptions = Readonly<{
  nowMs: number;
  lastSeenMs?: number;
  /** Absence advance is bounded by AE4 — a passive gap cannot erase lineage. */
  maxAbsenceHours?: number;
}>;

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_ABSENCE_HOURS = 24 * 365; // one year cap: bounded, not open-ended.

/**
 * Decode + advance the stored universe. Always returns a snapshot — a torn
 * or absent store yields `{ universe: null, branch: null, ... }` with a
 * single `no-universe` note.
 */
export function recoverUniverse(
  repository: UniverseRepository,
  universeId: string,
  options: RecoveryOptions,
): RecoverySnapshot {
  const notes: RecoveryNote[] = [];
  const universe = repository.loadUniverse(universeId);
  if (!universe) {
    return {
      universe: null,
      branch: null,
      promotedCheckpoint: null,
      eventsPastCheckpoint: [],
      naturalHistoryPastCheckpoint: [],
      absenceHours: 0,
      notes: [{ kind: "no-universe" }],
    };
  }

  const branches = repository.listBranches(universeId);
  const inhabited = branches.find((branch) => branch.id === universe.inhabitedBranchId);
  let branch = inhabited ?? null;
  if (!branch) {
    const fallback = pickFallbackBranch(branches);
    if (fallback) {
      notes.push({ kind: "fell-back-to-branch", branchId: fallback.id, reason: "inhabited-missing" });
      branch = fallback;
    }
  }
  if (!branch) {
    notes.push({ kind: "no-active-branch" });
    return {
      universe,
      branch: null,
      promotedCheckpoint: null,
      eventsPastCheckpoint: [],
      naturalHistoryPastCheckpoint: [],
      absenceHours: 0,
      notes,
    };
  }

  const rawPromoted = repository.loadPromotedCheckpoint(branch.id);
  const events = repository.loadEvents(branch.id).filter((event) => {
    if (!isValidEvent(event)) {
      notes.push({ kind: "corrupt-event-dropped", eventId: event.id });
      return false;
    }
    return true;
  });
  const branchHead = events.length === 0 ? universe.logicalTime : events[events.length - 1]!.logicalTime;
  const promotedCheckpoint = validatePromotedCheckpoint(rawPromoted, universe, branchHead, notes);
  const naturalHistory = repository.loadNaturalHistory(branch.id);
  const eventsPastCheckpoint = filterPastCheckpoint(events, promotedCheckpoint);
  const naturalHistoryPastCheckpoint = filterPastCheckpointNatural(naturalHistory, promotedCheckpoint);

  notes.push({
    kind: "resumed",
    branchId: branch.id,
    from: promotedCheckpoint ? "checkpoint" : "seed",
    replayCount: eventsPastCheckpoint.length,
  });

  // AE4 absence advancement: never negative, always bounded.
  const lastSeen = options.lastSeenMs;
  const rawGap = lastSeen === undefined ? 0 : Math.max(0, options.nowMs - lastSeen);
  const cap = options.maxAbsenceHours ?? DEFAULT_MAX_ABSENCE_HOURS;
  const absenceHours = Math.min(rawGap / HOUR_MS, cap);
  if (absenceHours > 0) notes.push({ kind: "absence-advanced", branchId: branch.id, hours: absenceHours });

  return {
    universe,
    branch,
    promotedCheckpoint,
    eventsPastCheckpoint,
    naturalHistoryPastCheckpoint,
    absenceHours,
    notes,
  };
}

function pickFallbackBranch(branches: readonly UniverseBranch[]): UniverseBranch | null {
  // Newest-created active branch wins; the store passes them in creation order.
  const active = branches.slice().reverse();
  return active[0] ?? null;
}

function validatePromotedCheckpoint(
  checkpoint: Checkpoint | null,
  universe: UniverseIdentity,
  branchHead: { tick: number; ordinal: number },
  notes: RecoveryNote[],
): Checkpoint | null {
  if (!checkpoint) return null;
  if (!checkpoint.stateDigest) {
    notes.push({ kind: "invalid-checkpoint", checkpointId: checkpoint.id });
    return null;
  }
  if (checkpoint.modelVersion !== universe.modelVersion) {
    // A future model version is preserved (recoverable) but not adopted.
    notes.push({ kind: "invalid-checkpoint", checkpointId: checkpoint.id });
    return null;
  }
  // A checkpoint whose logical time is ahead of both the universe's own
  // recorded head and the branch's actual event head is "future" — torn or
  // forged. The recovery drops it, keeps the events, and lets the runtime
  // rebuild from seed.
  const aheadOfBranch = compareLogicalTime(checkpoint.logicalTime, branchHead) > 0;
  const aheadOfUniverse = compareLogicalTime(checkpoint.logicalTime, universe.logicalTime) > 0;
  if (aheadOfBranch && aheadOfUniverse) {
    notes.push({
      kind: "future-checkpoint",
      checkpointId: checkpoint.id,
      universeTick: universe.logicalTime.tick,
      checkpointTick: checkpoint.logicalTime.tick,
    });
    return null;
  }
  return checkpoint;
}

function isValidEvent(event: DomainEvent): boolean {
  if (!event || typeof event !== "object") return false;
  if (!event.id || !event.branchId) return false;
  if (!isVersionedAction(event.action)) return false;
  return true;
}

function filterPastCheckpoint(events: readonly DomainEvent[], checkpoint: Checkpoint | null): readonly DomainEvent[] {
  if (!checkpoint) return events;
  return events.filter((event) => compareLogicalTime(event.logicalTime, checkpoint.logicalTime) > 0);
}

function filterPastCheckpointNatural(
  history: readonly NaturalHistoryEvent[],
  checkpoint: Checkpoint | null,
): readonly NaturalHistoryEvent[] {
  if (!checkpoint) return history;
  return history.filter((entry) => compareLogicalTime(entry.logicalTime, checkpoint.logicalTime) > 0);
}
