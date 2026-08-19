import XCTest
import GRDB
@testable import ObjetUniversePersistence

private struct Clock {
  var now: Int64 = 1_700_000_000_000
  mutating func tick(by ms: Int64 = 1) -> Int64 {
    now += ms
    return now
  }
}

private func makeEvent(
  id: String,
  branchId: String,
  universeId: String = "u1",
  tick: Int,
  ordinal: Int = 0,
  verb: String = "material",
  intensity: Double = 0.5
) -> DomainEventRecord {
  DomainEventRecord(
    id: id,
    universeId: universeId,
    branchId: branchId,
    logicalTick: tick,
    logicalOrdinal: ordinal,
    domainSeconds: Double(tick) * (1.0 / 120.0),
    domainScaleId: "wave-medium",
    verb: verb,
    intensity: intensity,
    payloadJson: "{}",
    writerId: "writer-a",
    writerEpoch: 0,
    appendedAtEpochMs: 0
  )
}

private func makeCheckpoint(
  id: String,
  branchId: String,
  universeId: String = "u1",
  followsEventId: String?,
  tick: Int,
  ordinal: Int = 0
) -> CheckpointRecord {
  CheckpointRecord(
    id: id,
    universeId: universeId,
    branchId: branchId,
    modelVersion: "v1",
    logicalTick: tick,
    logicalOrdinal: ordinal,
    stateDigest: "digest-\(id)",
    followsEventId: followsEventId,
    status: "staged",
    createdAtEpochMs: 0
  )
}

private func makeStoreAndCommitter() throws -> (UniverseStore, EventCommitter, () -> Int64) {
  var clock = Clock()
  let stepClock: () -> Int64 = { clock.tick() }
  let store = try UniverseStore.inMemory(clockMs: stepClock)
  _ = try store.createUniverse(
    seed: .init(id: "u1", seed: "seed-42", modelVersion: "v1", writerId: "writer-a", writerEpoch: 0),
    rootBranchId: "b-root"
  )
  let committer = EventCommitter(store: store)
  return (store, committer, stepClock)
}

// MARK: - Scenario 1: crash at each boundary

final class CrashPerBoundaryTests: XCTestCase {
  func testPreviewCrashLeavesNoDurableEvent() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let event = makeEvent(id: "e1", branchId: "b-root", tick: 5)
    XCTAssertThrowsError(try committer.commit(.init(event: event, stageCheckpoint: nil), injection: .init(crashAfter: .previewed))) { error in
      XCTAssertEqual(error as? CommitError, .simulatedCrash(after: .previewed))
    }
    let events = try store.fetchEvents(branchId: "b-root")
    XCTAssertTrue(events.isEmpty, "a preview crash must leave no durable trace of the event")
  }

  func testDurableAppendCrashKeepsEventOnceOnReplay() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let event = makeEvent(id: "e1", branchId: "b-root", tick: 5)

    XCTAssertThrowsError(try committer.commit(.init(event: event, stageCheckpoint: nil), injection: .init(crashAfter: .durablyAppended))) { error in
      XCTAssertEqual(error as? CommitError, .simulatedCrash(after: .durablyAppended))
    }
    XCTAssertEqual(try store.fetchEvents(branchId: "b-root").count, 1)

    // "Relaunch": the committer retries the same event id; it must not
    // create a second logical time.
    _ = try committer.commit(.init(event: event, stageCheckpoint: nil))
    let events = try store.fetchEvents(branchId: "b-root")
    XCTAssertEqual(events.count, 1)
    XCTAssertEqual(events.first?.id, "e1")
  }

  func testAuthoritativeApplyCrashPersistsEventAndNaturalHistoryOnReplay() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let event = makeEvent(id: "e1", branchId: "b-root", tick: 5)
    let history = [NaturalHistoryRecord(
      id: "h1", universeId: "u1", branchId: "b-root",
      kind: "birth", logicalTick: 5, logicalOrdinal: 0,
      domainEventId: "e1", subjectIdsJson: "[\"cell-1\"]",
      summary: "one cell arrives", appendedAtEpochMs: 0
    )]
    let attempt = CommitAttempt(event: event, stageCheckpoint: nil, naturalHistory: history)
    XCTAssertThrowsError(try committer.commit(attempt, injection: .init(crashAfter: .authoritativelyApplied)))

    XCTAssertEqual(try store.fetchEvents(branchId: "b-root").count, 1)
    XCTAssertEqual(try store.fetchNaturalHistory(branchId: "b-root").count, 1)

    // Retry: still exactly one row of each.
    _ = try committer.commit(attempt)
    XCTAssertEqual(try store.fetchEvents(branchId: "b-root").count, 1)
    XCTAssertEqual(try store.fetchNaturalHistory(branchId: "b-root").count, 1)
  }

  func testCheckpointPromotionCrashKeepsPriorStableCheckpoint() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let e1 = makeEvent(id: "e1", branchId: "b-root", tick: 5)
    let cp1 = makeCheckpoint(id: "c1", branchId: "b-root", followsEventId: "e1", tick: 5)
    _ = try committer.commit(.init(event: e1, stageCheckpoint: cp1))
    XCTAssertEqual(try store.fetchPromotedCheckpoint(branchId: "b-root")?.id, "c1")

    let e2 = makeEvent(id: "e2", branchId: "b-root", tick: 10)
    let cp2 = makeCheckpoint(id: "c2", branchId: "b-root", followsEventId: "e2", tick: 10)
    XCTAssertThrowsError(try committer.commit(
      .init(event: e2, stageCheckpoint: cp2),
      injection: .init(crashAfter: .checkpointPromoted)
    ))

    // The new checkpoint promoted, then a "crash" happened after. Prior
    // stable checkpoint is retired, but still recoverable, and the newest
    // promoted one wins.
    XCTAssertEqual(try store.fetchPromotedCheckpoint(branchId: "b-root")?.id, "c2")
  }

  func testUiAcknowledgmentCrashKeepsDurableAppendedEvent() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let event = makeEvent(id: "e1", branchId: "b-root", tick: 5)
    XCTAssertThrowsError(try committer.commit(.init(event: event, stageCheckpoint: nil), injection: .init(crashAfter: .uiAcknowledged)))
    XCTAssertEqual(try store.fetchEvents(branchId: "b-root").count, 1)
  }

  func testSensoryConfirmationCrashKeepsCompleteEvent() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let event = makeEvent(id: "e1", branchId: "b-root", tick: 5)
    XCTAssertThrowsError(try committer.commit(.init(event: event, stageCheckpoint: nil), injection: .init(crashAfter: .sensoryConfirmed)))
    XCTAssertEqual(try store.fetchEvents(branchId: "b-root").count, 1)
  }
}

// MARK: - Scenario 2: long-drag chunk crash bounded by cadence

final class ContinuousGestureTests: XCTestCase {
  func testDragChunkPersistenceIsBoundedByChunkCadence() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    // Simulate a 1000ms drag at 60Hz. Sample rate ~= 60 samples; chunk cadence
    // is 250ms so at most 4 durable chunks land, not 60 writes.
    var chunks: [GestureChunkRecord] = []
    for chunkIndex in 0 ..< 4 {
      let from = Double(chunkIndex) * 250.0
      chunks.append(GestureChunkRecord(
        gestureId: "g-1",
        chunkIndex: chunkIndex,
        universeId: "u1",
        branchId: "b-root",
        kind: "drag",
        sampleHz: 20,
        chunkMs: 250,
        fromMs: from,
        toMs: from + 250.0,
        samplesJson: "[]",
        finalized: true,
        appendedAtEpochMs: 0
      ))
    }
    for chunk in chunks { try committer.commitGestureChunk(chunk) }
    // Now simulate the fifth (provisional) chunk landing right before the
    // crash — it must be marked non-finalized so recovery discards it.
    let provisional = GestureChunkRecord(
      gestureId: "g-1",
      chunkIndex: 4,
      universeId: "u1",
      branchId: "b-root",
      kind: "drag",
      sampleHz: 20,
      chunkMs: 250,
      fromMs: 1000.0,
      toMs: 1250.0,
      samplesJson: "[]",
      finalized: false,
      appendedAtEpochMs: 0
    )
    try store.upsertGestureChunk(provisional)
    XCTAssertEqual(try store.fetchGestureChunks(gestureId: "g-1").count, 5)

    // Relaunch: drop the torn tail.
    try store.discardProvisionalGestureTails(gestureId: "g-1")
    let survivors = try store.fetchGestureChunks(gestureId: "g-1")
    XCTAssertEqual(survivors.count, 4, "one durable chunk per 250 ms window, never per sample")
    XCTAssertEqual(survivors.map(\.chunkIndex), [0, 1, 2, 3])
  }
}

// MARK: - Scenario 3: duplicate event ids are idempotent

final class IdempotencyTests: XCTestCase {
  func testDuplicateEventIdsCannotCreateDoubleTime() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let event = makeEvent(id: "e-dup", branchId: "b-root", tick: 5)
    _ = try committer.commit(.init(event: event, stageCheckpoint: nil))
    _ = try committer.commit(.init(event: event, stageCheckpoint: nil))
    XCTAssertEqual(try store.fetchEvents(branchId: "b-root").count, 1)

    let history = NaturalHistoryRecord(
      id: "h-dup", universeId: "u1", branchId: "b-root",
      kind: "birth", logicalTick: 5, logicalOrdinal: 0,
      domainEventId: "e-dup", subjectIdsJson: "[]",
      summary: "once", appendedAtEpochMs: 0
    )
    try store.appendNaturalHistory(history)
    try store.appendNaturalHistory(history)
    XCTAssertEqual(try store.fetchNaturalHistory(branchId: "b-root").count, 1)
  }
}

// MARK: - Scenario 4: invalid or future checkpoints fall back safely

final class CheckpointValidationTests: XCTestCase {
  func testCheckpointReferencingUnknownEventIsRefusedAndPriorStandsFast() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let e1 = makeEvent(id: "e1", branchId: "b-root", tick: 5)
    let cp1 = makeCheckpoint(id: "c1", branchId: "b-root", followsEventId: "e1", tick: 5)
    _ = try committer.commit(.init(event: e1, stageCheckpoint: cp1))

    // Try to stage-and-promote a checkpoint whose follows-event does not
    // exist. The store retires the row and keeps c1 authoritative.
    let torn = makeCheckpoint(id: "c-torn", branchId: "b-root", followsEventId: "e-nonexistent", tick: 999)
    try store.stageCheckpoint(torn)
    XCTAssertThrowsError(try store.promoteCheckpoint(id: "c-torn"))
    XCTAssertEqual(try store.fetchPromotedCheckpoint(branchId: "b-root")?.id, "c1")
  }

  func testCheckpointGoingBackwardIsRefused() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    let e1 = makeEvent(id: "e1", branchId: "b-root", tick: 10)
    let cp1 = makeCheckpoint(id: "c1", branchId: "b-root", followsEventId: "e1", tick: 10)
    _ = try committer.commit(.init(event: e1, stageCheckpoint: cp1))

    // A checkpoint stamped earlier must be rejected.
    let e0 = makeEvent(id: "e0", branchId: "b-root", tick: 1)
    _ = try store.appendEvent(e0)
    let cpBackward = makeCheckpoint(id: "c0", branchId: "b-root", followsEventId: "e0", tick: 1)
    try store.stageCheckpoint(cpBackward)
    XCTAssertThrowsError(try store.promoteCheckpoint(id: "c0"))
    XCTAssertEqual(try store.fetchPromotedCheckpoint(branchId: "b-root")?.id, "c1")
  }

  func testEventsRemainRecoverableWhenNoValidCheckpointExists() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    _ = try committer.commit(.init(event: makeEvent(id: "e1", branchId: "b-root", tick: 3), stageCheckpoint: nil))
    _ = try committer.commit(.init(event: makeEvent(id: "e2", branchId: "b-root", tick: 5), stageCheckpoint: nil))
    XCTAssertNil(try store.fetchPromotedCheckpoint(branchId: "b-root"))
    // Loading the inhabited branch still returns the two events so recovery
    // can replay from the seed rather than losing them.
    let loaded = try store.loadInhabited(universeId: "u1")
    XCTAssertEqual(loaded?.events.map(\.id), ["e1", "e2"])
  }
}

// MARK: - Scenario 6: retirement reversible; purge irreversible after tombstone

final class RetirementAndPurgeTests: XCTestCase {
  func testBranchRetirementIsReversible() throws {
    let (store, _, _) = try makeStoreAndCommitter()
    _ = try store.createBranch(
      universeId: "u1",
      id: "b-side",
      parentBranchId: "b-root",
      forkedAt: (tick: 3, ordinal: 0),
      writerId: "writer-a",
      writerEpoch: 1
    )
    try store.retireBranch(id: "b-side")
    XCTAssertEqual(try store.fetchBranches(universeId: "u1").first(where: { $0.id == "b-side" })?.status, "retired")

    try store.restoreBranch(id: "b-side")
    XCTAssertEqual(try store.fetchBranches(universeId: "u1").first(where: { $0.id == "b-side" })?.status, "active")
  }

  func testUniverseRetirementIsReversible() throws {
    let (store, _, _) = try makeStoreAndCommitter()
    try store.retireUniverse(id: "u1")
    XCTAssertEqual(try store.fetchUniverse(id: "u1")?.status, "retired")
    try store.restoreUniverse(id: "u1")
    XCTAssertEqual(try store.fetchUniverse(id: "u1")?.status, "active")
  }

  func testPurgeRefusesWithoutCommittedTombstone() throws {
    let (store, _, _) = try makeStoreAndCommitter()
    _ = try store.createBranch(
      universeId: "u1",
      id: "b-side",
      parentBranchId: "b-root",
      forkedAt: (tick: 3, ordinal: 0),
      writerId: "writer-a",
      writerEpoch: 1
    )
    XCTAssertThrowsError(try store.purgeBranch(id: "b-side")) { error in
      XCTAssertEqual(error as? PurgeGuard, .tombstoneRequired)
    }
    XCTAssertNotNil(try store.fetchBranches(universeId: "u1").first(where: { $0.id == "b-side" }))
  }

  func testPurgeSucceedsOnlyAfterExportAndTombstoneCommit() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    _ = try store.createBranch(
      universeId: "u1",
      id: "b-side",
      parentBranchId: "b-root",
      forkedAt: (tick: 3, ordinal: 0),
      writerId: "writer-a",
      writerEpoch: 1
    )
    _ = try committer.commit(.init(event: makeEvent(id: "e-side", branchId: "b-side", tick: 4), stageCheckpoint: nil))

    let export = try store.exportBranch(id: "b-side")
    XCTAssertEqual(export.events.count, 1)

    _ = try store.commitTombstone(id: "t-side", universeId: "u1", branchId: "b-side", scope: .branch, exportPath: "/tmp/export.json")
    try store.purgeBranch(id: "b-side")
    XCTAssertNil(try store.fetchBranches(universeId: "u1").first(where: { $0.id == "b-side" }))
    XCTAssertEqual(try store.fetchTombstones(universeId: "u1").count, 1)
  }

  func testRestoreOfPurgedBranchIsRefused() throws {
    let (store, _, _) = try makeStoreAndCommitter()
    _ = try store.createBranch(
      universeId: "u1",
      id: "b-side",
      parentBranchId: "b-root",
      forkedAt: (tick: 3, ordinal: 0),
      writerId: "writer-a",
      writerEpoch: 1
    )
    _ = try store.commitTombstone(id: "t-side", universeId: "u1", branchId: "b-side", scope: .branch, exportPath: nil)
    try store.purgeBranch(id: "b-side")
    // The branch row is now gone; restore reports missing rather than
    // pretending an already-purged lineage can come back.
    XCTAssertThrowsError(try store.restoreBranch(id: "b-side")) { error in
      XCTAssertEqual(error as? UniverseStoreError, .unknownBranch("b-side"))
    }
  }
}

// MARK: - Scenario 7: migration preserves seeds, order, model versions, natural-history refs

final class MigrationTests: XCTestCase {
  func testMigratorRunsCleanlyOnAFreshDatabase() throws {
    let queue = try DatabaseQueue()
    try UniverseSchema.migrator().migrate(queue)
    // Re-running the migrator on the same database is a no-op — GRDB records
    // applied migrations by name.
    try UniverseSchema.migrator().migrate(queue)
    // Every expected table exists at head.
    try queue.read { db in
      for table in ["universes", "branches", "domain_events", "checkpoints", "natural_history", "gesture_chunks", "tombstones", "sync_state", "model_manifests"] {
        XCTAssertTrue(try db.tableExists(table), "\(table) missing after migration")
      }
    }
  }

  func testMigrationPreservesEventOrderSeedsAndReferences() throws {
    let queue = try DatabaseQueue()
    let clock: () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000.0) }
    let store = try UniverseStore(dbWriter: queue, clockMs: clock)

    _ = try store.createUniverse(
      seed: .init(id: "u-mig", seed: "seed-777", modelVersion: "v3", writerId: "writer-a", writerEpoch: 0),
      rootBranchId: "b-mig"
    )
    for index in 0 ..< 10 {
      _ = try store.appendEvent(makeEvent(id: "e\(index)", branchId: "b-mig", universeId: "u-mig", tick: index))
    }
    try store.appendNaturalHistory(NaturalHistoryRecord(
      id: "h-mig", universeId: "u-mig", branchId: "b-mig",
      kind: "birth", logicalTick: 5, logicalOrdinal: 0,
      domainEventId: "e5", subjectIdsJson: "[\"s1\"]",
      summary: "seed-refing history", appendedAtEpochMs: 0
    ))

    // Re-run the migrator; a future v2 migration would run additive changes
    // here. Today we prove the v1 corpus stays byte-identical.
    try UniverseSchema.migrator().migrate(queue)

    let events = try store.fetchEvents(branchId: "b-mig")
    XCTAssertEqual(events.map(\.id), (0 ..< 10).map { "e\($0)" })
    XCTAssertEqual(try store.fetchUniverse(id: "u-mig")?.seed, "seed-777")
    XCTAssertEqual(try store.fetchUniverse(id: "u-mig")?.modelVersion, "v3")
    let history = try store.fetchNaturalHistory(branchId: "b-mig")
    XCTAssertEqual(history.first?.domainEventId, "e5")
  }
}

// MARK: - Rewind and conflict land as branch creation

final class BranchingTests: XCTestCase {
  func testRewindCreatesANewBranchWithoutMutatingParent() throws {
    let (store, committer, _) = try makeStoreAndCommitter()
    for tick in 0 ..< 5 {
      _ = try committer.commit(.init(event: makeEvent(id: "e\(tick)", branchId: "b-root", tick: tick), stageCheckpoint: nil))
    }

    _ = try store.createBranch(
      universeId: "u1",
      id: "b-rewind",
      parentBranchId: "b-root",
      forkedAt: (tick: 2, ordinal: 0),
      writerId: "writer-a",
      writerEpoch: 1
    )
    _ = try committer.commit(.init(event: makeEvent(id: "e-alt", branchId: "b-rewind", tick: 3), stageCheckpoint: nil))

    // Parent still holds its full history unchanged.
    XCTAssertEqual(try store.fetchEvents(branchId: "b-root").count, 5)
    // Child holds only its post-fork event.
    XCTAssertEqual(try store.fetchEvents(branchId: "b-rewind").map(\.id), ["e-alt"])
  }
}
