/**
 * UniverseProvider — the React context that hands the tree a live
 * `UniverseRepository`, the recovered snapshot, and the two write paths
 * scenes are allowed to touch: `commit` for one semantic event, and
 * `commitGestureChunk` for a durable 250 ms chunk. The provider itself is
 * a pass-through: scenes never see the storage adapter, only the
 * repository, and even the repository is exposed through a narrow API so
 * a scene cannot accidentally reach into SQLite.
 *
 * This provider does *not* mount into `_layout.tsx` in U4 — that
 * integration lands with the U5 gesture wiring. Here it is a
 * self-contained module that the tests and future integration compose.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  UniverseRepository,
  type CommitAttempt,
  type CommitInjection,
  type CommitOutcome,
  type PersistedGestureChunk,
  type StorageAdapter,
} from "../persistence/UniverseRepository.ts";
import { recoverUniverse, type RecoverySnapshot } from "../persistence/recovery.ts";
import { bootstrapUniverse } from "./branching.ts";
import type {
  ContinuousGestureTransaction,
  DomainEvent,
  UniverseBranch,
  UniverseIdentity,
} from "@objet/universe-contracts";

export type UniverseContextValue = Readonly<{
  repository: UniverseRepository;
  snapshot: RecoverySnapshot | null;
  ready: boolean;
  commit(attempt: CommitAttempt, injection?: CommitInjection): CommitOutcome;
  commitGestureChunk(
    transaction: ContinuousGestureTransaction,
    chunkIndex: number,
    finalized: boolean,
  ): void;
  discardProvisionalGestureTails(gestureId: string): number;
  branch: UniverseBranch | null;
  universe: UniverseIdentity | null;
  events: readonly DomainEvent[];
  chunks(gestureId: string): readonly PersistedGestureChunk[];
}>;

const UniverseContext = createContext<UniverseContextValue | null>(null);

export type UniverseProviderProps = Readonly<{
  storage: StorageAdapter;
  bootstrap: Readonly<{
    universeId: string;
    seed: string;
    modelVersion: string;
    writerId: string;
    rootBranchId: string;
  }>;
  nowMs?: () => number;
  lastSeenMs?: number;
  maxAbsenceHours?: number;
  children: React.ReactNode;
}>;

export function UniverseProvider(props: UniverseProviderProps): React.ReactElement {
  const repositoryRef = useRef<UniverseRepository | null>(null);
  if (repositoryRef.current === null) {
    repositoryRef.current = new UniverseRepository(props.storage);
  }
  const repository = repositoryRef.current;

  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const now = props.nowMs ?? (() => Date.now());

  useEffect(() => {
    // Ensure the universe exists before recovery — the app's first launch
    // creates it from the bootstrap seed. Subsequent launches see it and
    // skip creation via the storage adapter's idempotent semantics.
    if (repository.loadUniverse(props.bootstrap.universeId) === null) {
      const universe = bootstrapUniverse({
        id: props.bootstrap.universeId,
        seed: props.bootstrap.seed,
        modelVersion: props.bootstrap.modelVersion,
        writerId: props.bootstrap.writerId,
        rootBranchId: props.bootstrap.rootBranchId,
      });
      repository.createUniverse(universe.identity, universe.branches[0]);
    }
    const recovered = recoverUniverse(repository, props.bootstrap.universeId, {
      nowMs: now(),
      lastSeenMs: props.lastSeenMs,
      maxAbsenceHours: props.maxAbsenceHours,
    });
    setSnapshot(recovered);
  }, [
    repository,
    props.bootstrap.universeId,
    props.bootstrap.seed,
    props.bootstrap.modelVersion,
    props.bootstrap.writerId,
    props.bootstrap.rootBranchId,
    now,
    props.lastSeenMs,
    props.maxAbsenceHours,
  ]);

  const commit = useCallback(
    (attempt: CommitAttempt, injection?: CommitInjection): CommitOutcome => {
      return repository.commit(attempt, injection ?? {});
    },
    [repository],
  );

  const commitGestureChunk = useCallback(
    (transaction: ContinuousGestureTransaction, chunkIndex: number, finalized: boolean): void => {
      if (!snapshot?.universe || !snapshot.branch) return;
      repository.saveGestureChunkFromTransaction(
        transaction,
        { universeId: snapshot.universe.id, branchId: snapshot.branch.id },
        chunkIndex,
        finalized,
      );
    },
    [repository, snapshot?.universe, snapshot?.branch],
  );

  const discardProvisionalGestureTails = useCallback(
    (gestureId: string): number => repository.discardProvisionalGestureTails(gestureId),
    [repository],
  );

  const chunks = useCallback(
    (gestureId: string) => repository.loadGestureChunks(gestureId),
    [repository],
  );

  const value = useMemo<UniverseContextValue>(() => ({
    repository,
    snapshot,
    ready: snapshot !== null,
    commit,
    commitGestureChunk,
    discardProvisionalGestureTails,
    branch: snapshot?.branch ?? null,
    universe: snapshot?.universe ?? null,
    events: snapshot?.eventsPastCheckpoint ?? [],
    chunks,
  }), [repository, snapshot, commit, commitGestureChunk, discardProvisionalGestureTails, chunks]);

  return React.createElement(UniverseContext.Provider, { value }, props.children);
}

export function useUniverse(): UniverseContextValue {
  const value = useContext(UniverseContext);
  if (value === null) {
    throw new Error("useUniverse must be called inside <UniverseProvider>");
  }
  return value;
}

export { UniverseContext };
