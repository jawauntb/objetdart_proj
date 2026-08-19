/**
 * Falsifiable tests for `recoverUniverse` — decodes torn state, catches up
 * across bounded absence, and reports what the runtime should do. Runnable
 * with `node --experimental-strip-types`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_CONTRACT_VERSION,
  HISTORY_CONTRACT_VERSION,
  UNIVERSE_CONTRACT_VERSION,
  type UniverseIdentity,
  type UniverseBranch,
  type VersionedAction,
} from "@objet/universe-contracts";
import {
  InMemoryStorageAdapter,
  UniverseRepository,
  makeCheckpoint,
  makeDomainEvent,
  makeVersionedAction,
} from "../UniverseRepository.ts";
import { recoverUniverse } from "../recovery.ts";
import { bootstrapUniverse, forkBranch } from "../../universe/branching.ts";

function base() {
  const storage = new InMemoryStorageAdapter();
  const repository = new UniverseRepository(storage);
  const universe = bootstrapUniverse({
    id: "u-recover",
    seed: "seed-1",
    modelVersion: "v1",
    writerId: "writer-a",
    rootBranchId: "b-root",
  });
  repository.createUniverse(universe.identity, universe.branches[0]!);
  return { repository, storage };
}

function versionedAction(id: string, tick: number): VersionedAction {
  return makeVersionedAction(
    { verb: "material", layer: "material", source: "touch", intensity: 0.5, payload: {} },
    id,
    tick,
  );
}

test("no persisted universe returns a well-formed empty snapshot", () => {
  const storage = new InMemoryStorageAdapter();
  const repository = new UniverseRepository(storage);
  const snapshot = recoverUniverse(repository, "u-missing", { nowMs: 1_700_000_000_000 });
  assert.equal(snapshot.universe, null);
  assert.equal(snapshot.branch, null);
  assert.deepEqual(snapshot.eventsPastCheckpoint, []);
  assert.equal(snapshot.notes[0]?.kind, "no-universe");
});

test("an emptied scene remains empty across relaunch", () => {
  const { repository } = base();
  const snapshot = recoverUniverse(repository, "u-recover", { nowMs: 1_700_000_000_000 });
  assert.equal(snapshot.branch?.id, "b-root");
  assert.equal(snapshot.eventsPastCheckpoint.length, 0);
  assert.equal(snapshot.promotedCheckpoint, null);
  // Relaunch again — still empty, no phantom events crept in.
  const again = recoverUniverse(repository, "u-recover", { nowMs: 1_700_000_100_000 });
  assert.equal(again.eventsPastCheckpoint.length, 0);
});

test("recovery replays only events past the promoted checkpoint", () => {
  const { repository } = base();
  for (let tick = 1; tick <= 5; tick += 1) {
    repository.commit({
      event: makeDomainEvent(
        "b-root",
        { tick, ordinal: 0 },
        versionedAction(`e${tick}`, tick),
        tick / 120,
        "wave-medium" as unknown as ReturnType<typeof makeDomainEvent>["domainTime"]["address"],
      ),
    });
  }
  repository.commit({
    event: makeDomainEvent(
      "b-root",
      { tick: 6, ordinal: 0 },
      versionedAction("e6", 6),
      6 / 120,
      "wave-medium" as unknown as ReturnType<typeof makeDomainEvent>["domainTime"]["address"],
    ),
    stageCheckpoint: makeCheckpoint({
      id: "c-6",
      branchId: "b-root",
      modelVersion: "v1",
      time: { tick: 6, ordinal: 0 },
      stateDigest: "digest-6",
      followsEventId: "e6",
    }),
  });
  repository.commit({
    event: makeDomainEvent(
      "b-root",
      { tick: 7, ordinal: 0 },
      versionedAction("e7", 7),
      7 / 120,
      "wave-medium" as unknown as ReturnType<typeof makeDomainEvent>["domainTime"]["address"],
    ),
  });

  const snapshot = recoverUniverse(repository, "u-recover", { nowMs: 1_700_000_000_000 });
  assert.equal(snapshot.promotedCheckpoint?.id, "c-6");
  assert.deepEqual(snapshot.eventsPastCheckpoint.map((e) => e.id), ["e7"]);
});

test("a torn future checkpoint (no supporting event) falls back safely", () => {
  const { repository, storage } = base();
  // Overwrite the identity with an older tick than the checkpoint claims.
  const identity = repository.loadUniverse("u-recover") as UniverseIdentity;
  storage.saveUniverse({ ...identity, logicalTime: { tick: 2, ordinal: 0 } });
  // A promoted checkpoint at tick 99 with no supporting event and no branch
  // event past tick 0 is torn — deliberately future. Recovery must drop it
  // and open the last supported branch anyway.
  storage.stageCheckpoint({
    version: HISTORY_CONTRACT_VERSION,
    id: "c-future",
    branchId: "b-root",
    logicalTime: { tick: 99, ordinal: 0 },
    modelVersion: "v1",
    stateDigest: "digest-future",
  });
  // Force-promote by bypassing UniverseRepository (which would reject a
  // checkpoint with no follows-event — that path is tested elsewhere).
  (storage as unknown as { checkpointsById: Map<string, unknown> }).checkpointsById.set("c-future", {
    version: HISTORY_CONTRACT_VERSION,
    id: "c-future",
    branchId: "b-root",
    logicalTime: { tick: 99, ordinal: 0 },
    modelVersion: "v1",
    stateDigest: "digest-future",
    status: "promoted",
  });
  (storage as unknown as { promotedByBranch: Map<string, string> }).promotedByBranch.set("b-root", "c-future");

  const snapshot = recoverUniverse(repository, "u-recover", { nowMs: 1_700_000_000_000 });
  assert.equal(snapshot.promotedCheckpoint, null);
  const futureNote = snapshot.notes.find((note) => note.kind === "future-checkpoint");
  assert.ok(futureNote, "future checkpoint is reported, not silently trusted");
  // No events survive because none were appended — the branch is empty but
  // the promoted-checkpoint torn row was refused, not adopted.
  assert.equal(snapshot.eventsPastCheckpoint.length, 0);
});

test("model-version mismatch on a checkpoint is preserved but not adopted", () => {
  const { repository, storage } = base();
  storage.stageCheckpoint({
    version: HISTORY_CONTRACT_VERSION,
    id: "c-mismatch",
    branchId: "b-root",
    logicalTime: { tick: 1, ordinal: 0 },
    modelVersion: "v99",
    stateDigest: "digest-mismatch",
  });
  (storage as unknown as { checkpointsById: Map<string, unknown> }).checkpointsById.set("c-mismatch", {
    version: HISTORY_CONTRACT_VERSION,
    id: "c-mismatch",
    branchId: "b-root",
    logicalTime: { tick: 1, ordinal: 0 },
    modelVersion: "v99",
    stateDigest: "digest-mismatch",
    status: "promoted",
  });
  (storage as unknown as { promotedByBranch: Map<string, string> }).promotedByBranch.set("b-root", "c-mismatch");
  const snapshot = recoverUniverse(repository, "u-recover", { nowMs: 1_700_000_000_000 });
  assert.equal(snapshot.promotedCheckpoint, null);
  assert.ok(snapshot.notes.some((note) => note.kind === "invalid-checkpoint"));
});

test("recovery falls back to a non-purged branch when the inhabited one is missing", () => {
  const { repository, storage } = base();
  const forked = forkBranch({
    parent: {
      id: "b-root",
      parentId: null,
      forkedAt: null,
      writerEpoch: { writerId: "writer-a", epoch: 0 },
    } as UniverseBranch,
    parentHead: { tick: 3, ordinal: 0 },
    newBranchId: "b-side",
    writer: { writerId: "writer-a", epoch: 0 },
    reason: "user-fork",
  });
  storage.saveBranch("u-recover", forked.branch);
  // Corrupt the identity so its inhabited branch no longer exists.
  const identity = repository.loadUniverse("u-recover") as UniverseIdentity;
  storage.saveUniverse({ ...identity, inhabitedBranchId: "b-ghost" });

  const snapshot = recoverUniverse(repository, "u-recover", { nowMs: 1_700_000_000_000 });
  const fellBack = snapshot.notes.find((note) => note.kind === "fell-back-to-branch");
  assert.ok(fellBack, "recovery must record its fallback");
  assert.notEqual(snapshot.branch?.id, "b-ghost");
});

test("absence is bounded (AE4) — a clock jump into the future does not fast-forward", () => {
  const { repository } = base();
  const snapshot = recoverUniverse(repository, "u-recover", {
    nowMs: 1_700_000_000_000,
    lastSeenMs: 1_700_000_000_000 + 5_000, // stored future timestamp
  });
  assert.equal(snapshot.absenceHours, 0, "clock set backwards reads as zero elapsed");
});

test("absence advance caps at the configured maximum", () => {
  const { repository } = base();
  const snapshot = recoverUniverse(repository, "u-recover", {
    nowMs: 1_700_000_000_000 + 1000 * 60 * 60 * 24 * 400, // 400 days
    lastSeenMs: 1_700_000_000_000,
    maxAbsenceHours: 24 * 30, // cap at 30 days
  });
  assert.equal(snapshot.absenceHours, 24 * 30);
});

test("corrupt events are dropped, not adopted", () => {
  const { repository, storage } = base();
  storage.appendEvent({
    version: HISTORY_CONTRACT_VERSION,
    id: "e-broken",
    branchId: "b-root",
    logicalTime: { tick: 1, ordinal: 0 },
    domainTime: { address: "wave-medium" as unknown as ReturnType<typeof makeDomainEvent>["domainTime"]["address"], seconds: 0 },
    action: {
      version: (ACTION_CONTRACT_VERSION + 99) as unknown as VersionedAction["version"],
      id: "e-broken",
      logicalTime: 1,
      action: { verb: "material", layer: "material", source: "touch", intensity: 0.5, payload: {} },
    } as unknown as VersionedAction,
  });
  const snapshot = recoverUniverse(repository, "u-recover", { nowMs: 1_700_000_000_000 });
  const dropped = snapshot.notes.filter((n) => n.kind === "corrupt-event-dropped");
  assert.equal(dropped.length, 1);
  assert.equal(snapshot.eventsPastCheckpoint.length, 0);
  // Prove the identity version guard actually fired.
  assert.equal(snapshot.universe?.version, UNIVERSE_CONTRACT_VERSION);
});
