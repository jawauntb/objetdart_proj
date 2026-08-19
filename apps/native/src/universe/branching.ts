/**
 * branching.ts — how rewind, conflict, and user forks all land as
 * *branch creation*, never destructive mutation. R19 (concurrent devices)
 * and R21 (reversible retirement vs irreversible purge) live here.
 *
 * The functions are pure decoders over the versioned universe contract;
 * they take an identity and produce the next identity + branch record.
 * No side effects — the caller writes them through `UniverseRepository`.
 */

import {
  createUniverse as createUniverseContract,
  compareLogicalTime,
  nextWriterEpoch,
  UNIVERSE_CONTRACT_VERSION,
  type Universe,
  type UniverseBranch,
  type UniverseIdentity,
  type UniverseLogicalTime,
  type WriterEpoch,
} from "@objet/universe-contracts";
import type { UniverseRepository, TombstoneRecord } from "../persistence/UniverseRepository.ts";

export type BranchReason =
  | "rewind"
  | "conflict-iphone-vs-ipad"
  | "user-fork"
  | "recovery";

export type ForkOutcome = Readonly<{
  branch: UniverseBranch;
  reason: BranchReason;
  summary: string;
}>;

export function bootstrapUniverse(input: {
  id: string;
  seed: string;
  modelVersion: string;
  writerId: string;
  rootBranchId: string;
}): Universe {
  const identity: UniverseIdentity = {
    version: UNIVERSE_CONTRACT_VERSION,
    id: input.id,
    seed: input.seed,
    modelVersion: input.modelVersion,
    logicalTime: { tick: 0, ordinal: 0 },
    inhabitedBranchId: input.rootBranchId,
  };
  const root: UniverseBranch = {
    id: input.rootBranchId,
    parentId: null,
    forkedAt: null,
    writerEpoch: { writerId: input.writerId, epoch: 0 },
  };
  return createUniverseContract(identity, root);
}

/**
 * Fork a branch off a parent at a given logical time. Never mutates parent.
 * If the fork time is ahead of the parent's currently reachable head, the
 * function clamps to the parent's head — a fork cannot pretend to happen in
 * a place the timeline has not reached.
 */
export function forkBranch(input: {
  parent: UniverseBranch;
  parentHead: UniverseLogicalTime;
  newBranchId: string;
  writer: WriterEpoch;
  reason: BranchReason;
  summary?: string;
}): ForkOutcome {
  const clampedForkTime =
    compareLogicalTime(input.parentHead, input.parent.forkedAt ?? input.parentHead) >= 0
      ? input.parentHead
      : (input.parent.forkedAt as UniverseLogicalTime);
  const child: UniverseBranch = {
    id: input.newBranchId,
    parentId: input.parent.id,
    forkedAt: clampedForkTime,
    writerEpoch: nextWriterEpoch(input.writer),
  };
  const summary = input.summary ?? defaultSummary(input.reason, input.parent.id, child.id);
  return { branch: child, reason: input.reason, summary };
}

function defaultSummary(reason: BranchReason, parentId: string, childId: string): string {
  switch (reason) {
    case "rewind":
      return `rewound into a new branch (${parentId} → ${childId})`;
    case "conflict-iphone-vs-ipad":
      return `preserved a device conflict as a branch (${parentId} → ${childId})`;
    case "user-fork":
      return `deliberately forked (${parentId} → ${childId})`;
    case "recovery":
      return `recovered by opening a new branch off the last valid state (${parentId} → ${childId})`;
  }
}

/**
 * Retire is reversible: mark, do not remove. The trail keeps its full body
 * so a visitor can restore a lineage they meant to hide.
 */
export function retireBranch(
  repository: UniverseRepository,
  universeId: string,
  branchId: string,
): void {
  repository.retireBranch(universeId, branchId);
}

export function restoreBranch(
  repository: UniverseRepository,
  universeId: string,
  branchId: string,
): void {
  repository.restoreBranch(universeId, branchId);
}

export type PurgeRequest = Readonly<{
  id: string;
  universeId: string;
  branchId: string | null;
  scope: "branch" | "universe";
  exportPath: string | null;
  nowMs: number;
}>;

/**
 * Commit a purge tombstone. Local and cloud recovery end here — the caller
 * must have already offered export first (`repository.loadNaturalHistory` /
 * `loadEvents` / `loadPromotedCheckpoint` can seed that export).
 */
export function commitPurgeTombstone(
  repository: UniverseRepository,
  request: PurgeRequest,
): TombstoneRecord {
  const record: TombstoneRecord = {
    id: request.id,
    universeId: request.universeId,
    branchId: request.branchId,
    scope: request.scope,
    status: "committed",
    exportPath: request.exportPath,
    committedAtEpochMs: request.nowMs,
    createdAtEpochMs: request.nowMs,
  };
  repository.saveTombstone(record);
  return record;
}

/** Execute a purge after its tombstone has committed. */
export function executePurge(
  repository: UniverseRepository,
  request: Pick<PurgeRequest, "universeId" | "branchId" | "scope">,
): void {
  if (request.scope === "branch") {
    if (!request.branchId) throw new Error("branch purge requires a branchId");
    repository.purgeBranch(request.universeId, request.branchId);
  } else {
    repository.purgeUniverse(request.universeId);
  }
}
