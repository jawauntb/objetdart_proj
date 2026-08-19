/**
 * Falsifiable unit tests for the JS-side `UniverseRepository` + in-memory
 * storage adapter. Runnable with `node --experimental-strip-types`.
 *
 * Every assertion names an invariant a plausible bug would break — the
 * exactly-once boundary, the 250 ms chunk cadence, checkpoint validation,
 * purge guard. If you have to reach for a snapshot to describe what one
 * of these tests protects, that test does not belong here.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_CONTRACT_VERSION,
  HISTORY_CONTRACT_VERSION,
  UNIVERSE_CONTRACT_VERSION,
  serializeContinuousGesture,
  type Checkpoint,
  type DomainEvent,
  type UniverseIdentity,
  type UniverseBranch,
  type VersionedAction,
} from "@objet/universe-contracts";
import {
  InMemoryStorageAdapter,
  SimulatedCrashError,
  UniverseRepository,
  ValidationFailedError,
  makeCheckpoint,
  makeDomainEvent,
  makeVersionedAction,
} from "../UniverseRepository.ts";
import { commitPurgeTombstone, executePurge } from "../../universe/branching.ts";

const identity: UniverseIdentity = {
  version: UNIVERSE_CONTRACT_VERSION,
  id: "u-test",
  seed: "seed-42",
  modelVersion: "v1",
  logicalTime: { tick: 0, ordinal: 0 },
  inhabitedBranchId: "b-root",
};

const root: UniverseBranch = {
  id: "b-root",
  parentId: null,
  forkedAt: null,
  writerEpoch: { writerId: "writer-a", epoch: 0 },
};

function versionedAction(id: string, logicalTime: number): VersionedAction {
  return makeVersionedAction(
    { verb: "material", layer: "material", source: "touch", intensity: 0.5, payload: {} },
    id,
    logicalTime,
  );
}

function event(id: string, tick: number, ordinal: number = 0, branchId = "b-root"): DomainEvent {
  return makeDomainEvent(
    branchId,
    { tick, ordinal },
    versionedAction(id, tick),
    tick / 120,
    { address: "wave-medium", seconds: tick / 120 } as unknown as DomainEvent["domainTime"]["address"],
  );
}

function checkpoint(id: string, tick: number, followsEventId: string | null, branchId = "b-root"): Checkpoint {
  return makeCheckpoint({
    id,
    branchId,
    modelVersion: "v1",
    time: { tick, ordinal: 0 },
    stateDigest: `digest-${id}`,
    followsEventId,
  });
}

function make() {
  const storage = new InMemoryStorageAdapter();
  const repository = new UniverseRepository(storage);
  repository.createUniverse(identity, root);
  return { repository, storage };
}

test("duplicate event ids never create a second logical time", () => {
  const { repository } = make();
  const e = event("e1", 5);
  assert.equal(repository.appendEvent(e), "inserted");
  assert.equal(repository.appendEvent(e), "duplicate");
  const stored = repository.loadEvents("b-root");
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.id, "e1");
});

test("preview crash leaves no durable event", () => {
  const { repository } = make();
  assert.throws(
    () => repository.commit({ event: event("e1", 5) }, { crashAfter: "previewed" }),
    (error) => error instanceof SimulatedCrashError && error.boundary === "previewed",
  );
  assert.equal(repository.loadEvents("b-root").length, 0);
});

test("durable-append crash keeps the event exactly once on retry", () => {
  const { repository } = make();
  const e = event("e1", 5);
  assert.throws(
    () => repository.commit({ event: e }, { crashAfter: "durablyAppended" }),
    (error) => error instanceof SimulatedCrashError && error.boundary === "durablyAppended",
  );
  assert.equal(repository.loadEvents("b-root").length, 1);
  // Relaunch: the retry lands on the same primary key; still one row.
  repository.commit({ event: e });
  assert.equal(repository.loadEvents("b-root").length, 1);
});

test("checkpoint promotion after a valid follows-event lands atomically", () => {
  const { repository } = make();
  const e = event("e1", 5);
  const cp = checkpoint("c1", 5, "e1");
  const outcome = repository.commit({ event: e, stageCheckpoint: cp });
  assert.equal(outcome.didAppendEvent, true);
  assert.equal(outcome.didPromoteCheckpoint, true);
  assert.equal(repository.loadPromotedCheckpoint("b-root")?.id, "c1");
});

test("invalid checkpoint keeps the prior promoted checkpoint authoritative", () => {
  const { repository } = make();
  repository.commit({ event: event("e1", 5), stageCheckpoint: checkpoint("c1", 5, "e1") });
  // A checkpoint pointing at a missing event is retired; c1 stays current.
  const staged = checkpoint("c-torn", 6, "e-does-not-exist");
  repository.stageCheckpoint(staged);
  assert.equal(repository.promoteCheckpoint("c-torn"), "rejected-follows-event");
  assert.equal(repository.loadPromotedCheckpoint("b-root")?.id, "c1");
});

test("checkpoint that goes backwards is rejected", () => {
  const { repository } = make();
  repository.commit({ event: event("e1", 10), stageCheckpoint: checkpoint("c1", 10, "e1") });
  repository.appendEvent(event("e0", 1));
  const backward = checkpoint("c0", 1, "e0");
  repository.stageCheckpoint(backward);
  assert.equal(repository.promoteCheckpoint("c0"), "rejected-goes-backward");
  assert.equal(repository.loadPromotedCheckpoint("b-root")?.id, "c1");
});

test("continuous gesture chunks are keyed by (gestureId, chunkIndex) and idempotent", () => {
  const { repository } = make();
  const window = { startedAtMs: 0, endedAtMs: 750 };
  const samples = [
    { atMs: 0, x: 0, y: 0, intensity: 0.1 },
    { atMs: 250, x: 0.1, y: 0.1, intensity: 0.2 },
    { atMs: 500, x: 0.2, y: 0.2, intensity: 0.3 },
    { atMs: 750, x: 0.3, y: 0.3, intensity: 0.4 },
  ];
  const tx = serializeContinuousGesture("g-1", "drag", samples, window);
  // Finalize each 250ms chunk in order — twice; the second call is a no-op.
  for (const chunk of tx.chunks) {
    repository.saveGestureChunkFromTransaction(tx, { universeId: "u-test", branchId: "b-root" }, chunk.index, true);
    repository.saveGestureChunkFromTransaction(tx, { universeId: "u-test", branchId: "b-root" }, chunk.index, true);
  }
  const stored = repository.loadGestureChunks("g-1");
  assert.equal(stored.length, tx.chunks.length, "one durable chunk per 250 ms window, no double-count");
  assert.deepEqual(stored.map((c) => c.chunkIndex), tx.chunks.map((c) => c.index));
});

test("provisional (non-finalized) gesture tails are dropped on recovery", () => {
  const { repository, storage } = make();
  const window = { startedAtMs: 0, endedAtMs: 500 };
  const samples = [
    { atMs: 0, x: 0, y: 0, intensity: 0.1 },
    { atMs: 250, x: 0.1, y: 0.1, intensity: 0.2 },
    { atMs: 500, x: 0.2, y: 0.2, intensity: 0.3 },
  ];
  const tx = serializeContinuousGesture("g-2", "drag", samples, window);
  for (const chunk of tx.chunks) {
    repository.saveGestureChunkFromTransaction(tx, { universeId: "u-test", branchId: "b-root" }, chunk.index, true);
  }
  // Simulate a torn tail: a new higher-index chunk landed provisional right
  // before the crash. The storage layer keys on (gestureId, chunkIndex), so
  // it lives on its own row until recovery discards it.
  const tornIndex = tx.chunks[tx.chunks.length - 1]!.index + 5;
  storage.saveGestureChunk({
    gestureId: "g-2",
    chunkIndex: tornIndex,
    universeId: "u-test",
    branchId: "b-root",
    kind: "drag",
    sampleHz: tx.sampleHz,
    chunkMs: tx.chunkMs,
    fromMs: tornIndex * 50,
    toMs: (tornIndex + 5) * 50,
    samplesJson: "[]",
    finalized: false,
  });
  assert.equal(repository.loadGestureChunks("g-2").length, tx.chunks.length + 1);
  const removed = repository.discardProvisionalGestureTails("g-2");
  assert.equal(removed, 1, "exactly one torn tail dropped");
  const stored = repository.loadGestureChunks("g-2");
  assert.equal(stored.length, tx.chunks.length);
  assert.equal(stored.every((c) => c.finalized), true, "no provisional chunks survive recovery");
});

test("purge is refused without a committed tombstone", () => {
  const { repository } = make();
  repository.saveBranch("u-test", {
    id: "b-side",
    parentId: "b-root",
    forkedAt: { tick: 3, ordinal: 0 },
    writerEpoch: { writerId: "writer-a", epoch: 1 },
  });
  assert.throws(
    () => repository.purgeBranch("u-test", "b-side"),
    /purge requires a committed local tombstone/,
  );
});

test("purge succeeds after tombstone commits, and the branch's rows disappear", () => {
  const { repository } = make();
  repository.saveBranch("u-test", {
    id: "b-side",
    parentId: "b-root",
    forkedAt: { tick: 3, ordinal: 0 },
    writerEpoch: { writerId: "writer-a", epoch: 1 },
  });
  repository.commit({ event: event("e-side", 4, 0, "b-side") });
  commitPurgeTombstone(repository, {
    id: "tomb-1",
    universeId: "u-test",
    branchId: "b-side",
    scope: "branch",
    exportPath: "/tmp/export.json",
    nowMs: 1000,
  });
  executePurge(repository, { universeId: "u-test", branchId: "b-side", scope: "branch" });
  assert.equal(repository.listBranches("u-test").find((b) => b.id === "b-side"), undefined);
  assert.equal(repository.loadEvents("b-side").length, 0);
});

test("appendEvent rejects events with an unsupported action version", () => {
  const { repository } = make();
  const bad: DomainEvent = {
    version: HISTORY_CONTRACT_VERSION,
    id: "e-bad",
    branchId: "b-root",
    logicalTime: { tick: 1, ordinal: 0 },
    domainTime: { address: { band: "wave-medium" } as unknown as DomainEvent["domainTime"]["address"], seconds: 0 },
    action: {
      // deliberately wrong version
      version: (ACTION_CONTRACT_VERSION + 99) as unknown as VersionedAction["version"],
      id: "e-bad",
      logicalTime: 1,
      action: { verb: "material", layer: "material", source: "touch", intensity: 0.5, payload: {} },
    } as unknown as VersionedAction,
  };
  assert.throws(() => repository.appendEvent(bad));
});

test("validation failure at the checkpoint stage does not lose the durable event", () => {
  const { repository } = make();
  const e = event("e1", 5);
  assert.throws(
    () => repository.commit({ event: e, stageCheckpoint: checkpoint("c1", 5, "e1") }, { failValidation: true }),
    (error) => error instanceof ValidationFailedError,
  );
  assert.equal(repository.loadEvents("b-root").length, 1, "event survives the checkpoint failure");
  assert.equal(repository.loadPromotedCheckpoint("b-root"), null);
});
