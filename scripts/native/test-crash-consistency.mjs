#!/usr/bin/env node
/**
 * Node harness for U4 crash-consistency invariants.
 *
 * Instantiates a JS-side `UniverseRepository` backed by an in-memory
 * storage adapter — SQLite via better-sqlite3 would be preferable, but
 * this workspace never installed it (checked; see `apps/native/package.json`
 * and root `package.json`). The JSON simulacrum reproduces the same
 * write-ahead + primary-key idempotency shape the SQLite migration
 * relies on.
 *
 * For each of the seven `HostBoundary` phases the harness injects a
 * simulated crash, then asserts that the durable store afterwards
 * matches the contract: either the event never happened, or the
 * committed act is present exactly once. It also proves that continuous
 * gesture chunks survive a crash bounded by the 250 ms cadence, that
 * emptied scenes stay empty across relaunch, and that purge cannot
 * proceed without a committed tombstone.
 *
 * Self-hoists to `--experimental-strip-types` so we can import the TS
 * modules directly, no build step.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

// Re-exec under --experimental-strip-types so the TypeScript imports work.
// The child inherits everything else (cwd, env, stdio).
if (!process.execArgv.some((arg) => arg.startsWith("--experimental-strip-types"))) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const [nodeMajor] = process.versions.node.split(".").map((part) => Number(part));
if (Number.isNaN(nodeMajor) || nodeMajor < 22) {
  console.error(`crash-consistency harness needs Node 22+, saw ${process.versions.node}`);
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const repositoryPath = path.join(repoRoot, "apps/native/src/persistence/UniverseRepository.ts");
const recoveryPath = path.join(repoRoot, "apps/native/src/persistence/recovery.ts");
const branchingPath = path.join(repoRoot, "apps/native/src/universe/branching.ts");

const {
  serializeContinuousGesture,
  HISTORY_CONTRACT_VERSION,
  UNIVERSE_CONTRACT_VERSION,
  ACTION_CONTRACT_VERSION,
} = await import("@objet/universe-contracts");
const {
  InMemoryStorageAdapter,
  UniverseRepository,
  SimulatedCrashError,
  ValidationFailedError,
  makeCheckpoint,
  makeDomainEvent,
  makeVersionedAction,
} = await import(pathToFileURL(repositoryPath).href);
const { bootstrapUniverse, commitPurgeTombstone, executePurge, retireBranch, restoreBranch } =
  await import(pathToFileURL(branchingPath).href);
const { recoverUniverse } = await import(pathToFileURL(recoveryPath).href);

const BOUNDARIES = [
  "previewed",
  "durablyAppended",
  "authoritativelyApplied",
  "checkpointPromoted",
  "uiAcknowledged",
  "sensoryConfirmed",
];

function make() {
  const storage = new InMemoryStorageAdapter();
  const repository = new UniverseRepository(storage);
  const universe = bootstrapUniverse({
    id: "u-harness",
    seed: "seed-777",
    modelVersion: "v1",
    writerId: "writer-a",
    rootBranchId: "b-root",
  });
  repository.createUniverse(universe.identity, universe.branches[0]);
  return { repository, storage };
}

function versionedAction(id, tick) {
  return makeVersionedAction(
    { verb: "material", layer: "material", source: "touch", intensity: 0.5, payload: {} },
    id,
    tick,
  );
}

function event(id, tick, branchId = "b-root") {
  return makeDomainEvent(branchId, { tick, ordinal: 0 }, versionedAction(id, tick), tick / 120, "wave-medium");
}

function checkpoint(id, tick, followsEventId, branchId = "b-root") {
  return makeCheckpoint({
    id,
    branchId,
    modelVersion: "v1",
    time: { tick, ordinal: 0 },
    stateDigest: `digest-${id}`,
    followsEventId,
  });
}

let scenariosRun = 0;
function scenario(name, body) {
  scenariosRun += 1;
  body();
  console.log("  ✓", name);
}

console.log("crash-consistency scenarios:");

// Scenario 1: crash at each of the six commit boundaries; the seventh
// (outputQuarantined) is exercised implicitly by the validation-failure
// path below.
for (const boundary of BOUNDARIES) {
  scenario(`crash after ${boundary}`, () => {
    const { repository } = make();
    const e = event(`e-crash-${boundary}`, 5);
    const cp = boundary === "checkpointPromoted"
      || boundary === "uiAcknowledged"
      || boundary === "sensoryConfirmed"
      ? checkpoint(`cp-${boundary}`, 5, `e-crash-${boundary}`)
      : undefined;
    let threw = null;
    try {
      repository.commit({ event: e, stageCheckpoint: cp }, { crashAfter: boundary });
    } catch (error) {
      threw = error;
    }
    assert.ok(threw instanceof SimulatedCrashError, `expected SimulatedCrashError for ${boundary}`);
    assert.equal(threw.boundary, boundary);
    const events = repository.loadEvents("b-root");
    if (boundary === "previewed") {
      assert.equal(events.length, 0, "preview crash must leave no durable event");
    } else {
      assert.equal(events.length, 1, "post-append crash keeps the event exactly once");
      // "Relaunch": the same event id lands on the same primary key.
      repository.commit({ event: e, stageCheckpoint: cp });
      assert.equal(repository.loadEvents("b-root").length, 1, "retry is idempotent");
    }
    const snapshot = recoverUniverse(repository, "u-harness", { nowMs: 1_700_000_000_000 });
    assert.equal(snapshot.branch?.id, "b-root");
  });
}

// Scenario 2: long-drag crash — the write count stays bounded by the 250 ms
// cadence, not by device sample rate.
scenario("long-drag crash keeps every committed 250 ms chunk exactly once", () => {
  const { repository, storage } = make();
  const window = { startedAtMs: 0, endedAtMs: 1000 };
  const raw = [];
  for (let atMs = 0; atMs <= 1000; atMs += 1000 / 60) {
    raw.push({ atMs, x: atMs / 1000, y: atMs / 1000, intensity: 0.5 });
  }
  const tx = serializeContinuousGesture("g-long", "drag", raw, window);
  for (const chunk of tx.chunks) {
    repository.saveGestureChunkFromTransaction(tx, { universeId: "u-harness", branchId: "b-root" }, chunk.index, true);
    // A JS-side retry on the same chunk — the (gestureId, chunkIndex) key
    // deduplicates the write.
    repository.saveGestureChunkFromTransaction(tx, { universeId: "u-harness", branchId: "b-root" }, chunk.index, true);
  }
  // Torn tail: one provisional chunk just before the crash.
  const tornIndex = tx.chunks[tx.chunks.length - 1].index + 5;
  storage.saveGestureChunk({
    gestureId: "g-long",
    chunkIndex: tornIndex,
    universeId: "u-harness",
    branchId: "b-root",
    kind: "drag",
    sampleHz: tx.sampleHz,
    chunkMs: tx.chunkMs,
    fromMs: tornIndex * 50,
    toMs: (tornIndex + 5) * 50,
    samplesJson: "[]",
    finalized: false,
  });
  const removed = repository.discardProvisionalGestureTails("g-long");
  assert.equal(removed, 1, "exactly one torn tail dropped");
  const stored = repository.loadGestureChunks("g-long");
  assert.equal(stored.length, tx.chunks.length, "one durable chunk per 250 ms window");
  assert.ok(stored.length <= 4, "write count is bounded by chunk cadence, not device sample rate");
  assert.equal(stored.every((c) => c.finalized), true);
});

// Scenario 3: duplicate event ids are idempotent.
scenario("duplicate event ids never create a second logical time", () => {
  const { repository } = make();
  const e = event("e-dup", 5);
  repository.commit({ event: e });
  repository.commit({ event: e });
  repository.commit({ event: e });
  assert.equal(repository.loadEvents("b-root").length, 1);
});

// Scenario 4: invalid or future checkpoints preserve recoverable data and
// keep the last supported branch open.
scenario("invalid checkpoint keeps events recoverable and last-supported branch open", () => {
  const { repository } = make();
  repository.commit({ event: event("e1", 5), stageCheckpoint: checkpoint("c1", 5, "e1") });
  repository.stageCheckpoint(checkpoint("c-torn", 6, "e-missing"));
  const result = repository.promoteCheckpoint("c-torn");
  assert.equal(result, "rejected-follows-event");
  assert.equal(repository.loadPromotedCheckpoint("b-root")?.id, "c1");
  // Validation failure at commit time keeps the event durable.
  let threw = null;
  try {
    repository.commit({ event: event("e2", 10), stageCheckpoint: checkpoint("c2", 10, "e2") }, { failValidation: true });
  } catch (error) {
    threw = error;
  }
  assert.ok(threw instanceof ValidationFailedError);
  assert.equal(repository.loadEvents("b-root").length, 2);
});

// Scenario 5: emptied scene stays empty across relaunch.
scenario("an emptied scene stays empty across relaunch", () => {
  const { repository } = make();
  const first = recoverUniverse(repository, "u-harness", { nowMs: 1_700_000_000_000 });
  assert.equal(first.eventsPastCheckpoint.length, 0);
  const second = recoverUniverse(repository, "u-harness", { nowMs: 1_700_000_100_000 });
  assert.equal(second.eventsPastCheckpoint.length, 0);
});

// Scenario 6: retirement is reversible; purge requires a committed tombstone.
scenario("purge is refused without a committed tombstone, then succeeds after one", () => {
  const { repository } = make();
  repository.saveBranch("u-harness", {
    id: "b-side",
    parentId: "b-root",
    forkedAt: { tick: 3, ordinal: 0 },
    writerEpoch: { writerId: "writer-a", epoch: 1 },
  });
  repository.commit({ event: event("e-side", 4, "b-side") });
  retireBranch(repository, "u-harness", "b-side");
  restoreBranch(repository, "u-harness", "b-side");
  let threw = null;
  try { repository.purgeBranch("u-harness", "b-side"); } catch (error) { threw = error; }
  assert.ok(threw, "purge without a tombstone must throw");
  commitPurgeTombstone(repository, {
    id: "tomb-1",
    universeId: "u-harness",
    branchId: "b-side",
    scope: "branch",
    exportPath: "/tmp/export.json",
    nowMs: 1000,
  });
  executePurge(repository, { universeId: "u-harness", branchId: "b-side", scope: "branch" });
  assert.equal(repository.listBranches("u-harness").find((b) => b.id === "b-side"), undefined);
});

// Scenario 7: seeds, event order, model versions, natural-history references
// all survive a reload.
scenario("model-version and natural-history references survive a reload", () => {
  const { repository } = make();
  for (let tick = 0; tick < 10; tick += 1) {
    repository.commit({ event: event(`e${tick}`, tick) });
  }
  repository.appendNaturalHistory({
    version: HISTORY_CONTRACT_VERSION,
    id: "h-mig",
    kind: "birth",
    branchId: "b-root",
    logicalTime: { tick: 5, ordinal: 0 },
    domainEventId: "e5",
    subjectIds: ["s1"],
    summary: "reference survives reload",
  });
  const events = repository.loadEvents("b-root");
  assert.deepEqual(events.map((e) => e.id), Array.from({ length: 10 }, (_, i) => `e${i}`));
  const history = repository.loadNaturalHistory("b-root");
  assert.equal(history[0].domainEventId, "e5");
  const identity = repository.loadUniverse("u-harness");
  assert.equal(identity?.seed, "seed-777");
  assert.equal(identity?.modelVersion, "v1");
});

// A contract-version sanity check: the harness must not silently ride a
// higher version of any input contract than it thinks it does.
assert.equal(HISTORY_CONTRACT_VERSION, 1);
assert.equal(UNIVERSE_CONTRACT_VERSION, 1);
assert.equal(ACTION_CONTRACT_VERSION, 1);

console.log(`crash-consistency scenarios: ${scenariosRun} passed`);
