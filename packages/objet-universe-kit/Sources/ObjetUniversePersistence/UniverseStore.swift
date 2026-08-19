import Foundation
import GRDB
import ObjetUniverseCore

// MARK: - Public value types

public struct UniverseSeed: Equatable, Sendable {
  public var id: String
  public var seed: String
  public var modelVersion: String
  public var writerId: String
  public var writerEpoch: Int

  public init(id: String, seed: String, modelVersion: String, writerId: String, writerEpoch: Int) {
    self.id = id
    self.seed = seed
    self.modelVersion = modelVersion
    self.writerId = writerId
    self.writerEpoch = writerEpoch
  }
}

/// The full replayable snapshot of one branch's local state at load time.
public struct LoadedBranch: Equatable, Sendable {
  public var universe: UniverseRecord
  public var branch: BranchRecord
  public var promotedCheckpoint: CheckpointRecord?
  public var events: [DomainEventRecord]
  public var naturalHistory: [NaturalHistoryRecord]

  public init(
    universe: UniverseRecord,
    branch: BranchRecord,
    promotedCheckpoint: CheckpointRecord?,
    events: [DomainEventRecord],
    naturalHistory: [NaturalHistoryRecord]
  ) {
    self.universe = universe
    self.branch = branch
    self.promotedCheckpoint = promotedCheckpoint
    self.events = events
    self.naturalHistory = naturalHistory
  }
}

public enum RetirementScope: String, Sendable {
  case branch
  case universe
}

public enum PurgeGuard: Error, Equatable, Sendable {
  /// A purge asked to happen without a committed local tombstone. The store
  /// refuses — the tombstone is the point of no return, and it must land in
  /// its own transaction before rows can go.
  case tombstoneRequired
}

/// A minimal Codable helper: the store exports the whole recoverable branch as
/// canonical JSON before its tombstone commits, so a purge always offers export
/// first and the visitor can save what they are about to lose.
public struct BranchExport: Codable, Equatable, Sendable {
  public var universe: UniverseRecord
  public var branch: BranchRecord
  public var promotedCheckpoint: CheckpointRecord?
  public var events: [DomainEventRecord]
  public var naturalHistory: [NaturalHistoryRecord]
  public var exportedAtEpochMs: Int64
}

// MARK: - Store

/// The one local writer. Every scene-facing event goes through this class;
/// scenes never touch SQLite. `UniverseStore` is intentionally free-standing:
/// it takes a `DatabaseWriter` (in-memory queue in tests, an on-disk queue in
/// production) plus an injectable clock so the tests can freeze wall time.
public final class UniverseStore: @unchecked Sendable {
  private let dbWriter: any DatabaseWriter
  private let clockMs: () -> Int64

  public init(dbWriter: any DatabaseWriter, clockMs: @escaping () -> Int64 = UniverseStore.defaultClockMs) throws {
    self.dbWriter = dbWriter
    self.clockMs = clockMs
    try UniverseSchema.migrator().migrate(dbWriter)
  }

  public static func inMemory(clockMs: @escaping () -> Int64 = UniverseStore.defaultClockMs) throws -> UniverseStore {
    try UniverseStore(dbWriter: DatabaseQueue(), clockMs: clockMs)
  }

  public static func open(at url: URL, clockMs: @escaping () -> Int64 = UniverseStore.defaultClockMs) throws -> UniverseStore {
    try UniverseStore(dbWriter: try DatabaseQueue(path: url.path), clockMs: clockMs)
  }

  public static func defaultClockMs() -> Int64 {
    Int64((Date().timeIntervalSince1970 * 1000.0).rounded())
  }

  // MARK: - Universe / branch creation

  /// Create a brand new universe with a single root branch. Repeated calls
  /// with the same id are no-ops so a JS-side retry cannot double-create.
  @discardableResult
  public func createUniverse(seed: UniverseSeed, rootBranchId: String) throws -> LoadedBranch {
    try dbWriter.write { db in
      let now = self.clockMs()
      if let existing = try UniverseRecord.fetchOne(db, key: seed.id) {
        let branch = try BranchRecord.fetchOne(db, key: existing.inhabitedBranchId)
        guard let branch else {
          throw UniverseStoreError.corruptedInhabitedBranch(existing.id)
        }
        return LoadedBranch(
          universe: existing,
          branch: branch,
          promotedCheckpoint: try Self.promotedCheckpointForBranch(db, branchId: branch.id),
          events: try Self.eventsForBranch(db, branchId: branch.id),
          naturalHistory: try Self.naturalHistoryForBranch(db, branchId: branch.id)
        )
      }
      let universe = UniverseRecord(
        id: seed.id,
        seed: seed.seed,
        modelVersion: seed.modelVersion,
        logicalTick: 0,
        logicalOrdinal: 0,
        inhabitedBranchId: rootBranchId,
        status: "active",
        createdAtEpochMs: now
      )
      try universe.insert(db)
      let branch = BranchRecord(
        id: rootBranchId,
        universeId: seed.id,
        parentBranchId: nil,
        forkedAtTick: nil,
        forkedAtOrdinal: nil,
        writerId: seed.writerId,
        writerEpoch: seed.writerEpoch,
        status: "active",
        createdAtEpochMs: now
      )
      try branch.insert(db)
      return LoadedBranch(
        universe: universe,
        branch: branch,
        promotedCheckpoint: nil,
        events: [],
        naturalHistory: []
      )
    }
  }

  /// Rewind, conflict, or user-authored fork all land here: create a child
  /// branch at a logical time. The parent is never mutated — the trail keeps
  /// its full history and both branches read back independently.
  @discardableResult
  public func createBranch(
    universeId: String,
    id: String,
    parentBranchId: String,
    forkedAt: (tick: Int, ordinal: Int),
    writerId: String,
    writerEpoch: Int
  ) throws -> BranchRecord {
    try dbWriter.write { db in
      let now = self.clockMs()
      if let existing = try BranchRecord.fetchOne(db, key: id) { return existing }
      guard let parent = try BranchRecord.fetchOne(db, key: parentBranchId) else {
        throw UniverseStoreError.missingParentBranch(parentBranchId)
      }
      guard parent.universeId == universeId else {
        throw UniverseStoreError.parentBranchUniverseMismatch
      }
      let branch = BranchRecord(
        id: id,
        universeId: universeId,
        parentBranchId: parentBranchId,
        forkedAtTick: forkedAt.tick,
        forkedAtOrdinal: forkedAt.ordinal,
        writerId: writerId,
        writerEpoch: writerEpoch,
        status: "active",
        createdAtEpochMs: now
      )
      try branch.insert(db)
      return branch
    }
  }

  public func setInhabitedBranch(universeId: String, branchId: String) throws {
    try dbWriter.write { db in
      guard var universe = try UniverseRecord.fetchOne(db, key: universeId) else {
        throw UniverseStoreError.unknownUniverse(universeId)
      }
      guard let branch = try BranchRecord.fetchOne(db, key: branchId), branch.universeId == universeId else {
        throw UniverseStoreError.branchNotInUniverse(branchId: branchId, universeId: universeId)
      }
      universe.inhabitedBranchId = branch.id
      try universe.update(db)
    }
  }

  // MARK: - Event append (the exactly-once boundary)

  /// Append one durable domain event. The primary key on `id` makes this
  /// idempotent; a JS-side retry after preview but before authoritative apply
  /// re-lands on the same row and does not create a second logical time.
  @discardableResult
  public func appendEvent(_ event: DomainEventRecord) throws -> Bool {
    try dbWriter.write { db in
      if try DomainEventRecord.fetchOne(db, key: event.id) != nil { return false }
      var record = event
      record.appendedAtEpochMs = self.clockMs()
      try record.insert(db)
      return true
    }
  }

  /// Bulk append inside one transaction — the whole batch either lands or none
  /// of it does. A duplicate id inside the batch is dedup'd silently.
  @discardableResult
  public func appendEvents(_ events: [DomainEventRecord]) throws -> [String] {
    guard !events.isEmpty else { return [] }
    return try dbWriter.write { db in
      var inserted: [String] = []
      for event in events {
        if try DomainEventRecord.fetchOne(db, key: event.id) != nil { continue }
        var record = event
        record.appendedAtEpochMs = self.clockMs()
        try record.insert(db)
        inserted.append(event.id)
      }
      return inserted
    }
  }

  // MARK: - Continuous gesture chunks

  /// Persist one finalized 250 ms chunk. Repeated calls with the same
  /// (gestureId, chunkIndex) upsert the samples; a mid-chunk provisional
  /// preview is *not* durable — only the finalized chunk is.
  public func upsertGestureChunk(_ chunk: GestureChunkRecord) throws {
    try dbWriter.write { db in
      var record = chunk
      record.appendedAtEpochMs = self.clockMs()
      try record.save(db)
    }
  }

  /// Drop the last provisional (non-finalized) chunk on recovery so a crash
  /// mid-gesture does not leave a torn tail behind.
  public func discardProvisionalGestureTails(gestureId: String) throws {
    try dbWriter.write { db in
      try db.execute(
        sql: "DELETE FROM gesture_chunks WHERE gestureId = ? AND finalized = 0",
        arguments: [gestureId]
      )
    }
  }

  // MARK: - Checkpoint staging and promotion

  /// Stage a checkpoint without promoting it. The prior stable checkpoint
  /// remains authoritative until `promoteCheckpoint` succeeds.
  public func stageCheckpoint(_ checkpoint: CheckpointRecord) throws {
    try dbWriter.write { db in
      var record = checkpoint
      record.status = "staged"
      record.createdAtEpochMs = self.clockMs()
      try record.save(db)
    }
  }

  /// Promote a staged checkpoint. Validates that it references an appended
  /// event on the same branch and that its logical time is not earlier than
  /// the last promoted checkpoint. On failure the staged row is retired and
  /// the previously promoted checkpoint stays authoritative.
  @discardableResult
  public func promoteCheckpoint(id: String) throws -> CheckpointRecord {
    try dbWriter.write { db in
      guard var staged = try CheckpointRecord.fetchOne(db, key: id) else {
        throw UniverseStoreError.unknownCheckpoint(id)
      }
      guard staged.status == "staged" || staged.status == "promoted" else {
        throw UniverseStoreError.checkpointRetired(id)
      }
      if staged.status == "promoted" { return staged } // idempotent
      // Guard against a torn or forged checkpoint: the referenced event must
      // exist on the same branch, and the checkpoint must not step backwards
      // relative to the last promoted one.
      if let followsEventId = staged.followsEventId {
        guard let event = try DomainEventRecord.fetchOne(db, key: followsEventId),
              event.branchId == staged.branchId,
              (event.logicalTick < staged.logicalTick)
                || (event.logicalTick == staged.logicalTick && event.logicalOrdinal <= staged.logicalOrdinal)
        else {
          staged.status = "retired"
          try staged.update(db)
          throw UniverseStoreError.checkpointDoesNotFollowEvent(id)
        }
      }
      if let previous = try Self.promotedCheckpointForBranch(db, branchId: staged.branchId) {
        let compare = Self.compareLogicalTime(
          (previous.logicalTick, previous.logicalOrdinal),
          (staged.logicalTick, staged.logicalOrdinal)
        )
        if compare > 0 {
          staged.status = "retired"
          try staged.update(db)
          throw UniverseStoreError.checkpointGoesBackward(id)
        }
      }
      // Retire the previous stable checkpoint only after this one promotes —
      // if we crash between the two writes, the old one is still authoritative
      // (a checkpoint is safe to keep; nothing depends on there being only one
      // "promoted" row apart from the fetch helper preferring the newest).
      try db.execute(
        sql: "UPDATE checkpoints SET status = 'retired' WHERE branchId = ? AND status = 'promoted' AND id != ?",
        arguments: [staged.branchId, staged.id]
      )
      staged.status = "promoted"
      try staged.update(db)
      return staged
    }
  }

  // MARK: - Natural history

  public func appendNaturalHistory(_ event: NaturalHistoryRecord) throws {
    try dbWriter.write { db in
      if try NaturalHistoryRecord.fetchOne(db, key: event.id) != nil { return }
      var record = event
      record.appendedAtEpochMs = self.clockMs()
      try record.insert(db)
    }
  }

  // MARK: - Load and recovery

  /// Load the inhabited branch of a universe with everything the runtime
  /// needs to resume: the promoted checkpoint plus every event and trail
  /// entry past it. A missing or corrupted checkpoint falls back to the
  /// prior recoverable branch rather than throwing away the data.
  public func loadInhabited(universeId: String) throws -> LoadedBranch? {
    try dbWriter.read { db in
      guard let universe = try UniverseRecord.fetchOne(db, key: universeId),
            universe.status != "purged" else {
        return nil
      }
      let inhabited = try BranchRecord.fetchOne(db, key: universe.inhabitedBranchId)
      let candidate = (inhabited != nil && inhabited?.status != "purged") ? inhabited : nil
      let branch: BranchRecord
      if let candidate {
        branch = candidate
      } else {
        // fall back to the newest non-purged branch — the reader chooses the
        // last supported version rather than a torn one.
        guard let fallback = try BranchRecord
          .filter(Column("universeId") == universeId && Column("status") != "purged")
          .order(Column("createdAtEpochMs").desc)
          .fetchOne(db)
        else { return nil }
        branch = fallback
      }
      let promoted = try Self.promotedCheckpointForBranch(db, branchId: branch.id)
      let events = try Self.eventsForBranch(db, branchId: branch.id)
      let history = try Self.naturalHistoryForBranch(db, branchId: branch.id)
      return LoadedBranch(
        universe: universe,
        branch: branch,
        promotedCheckpoint: promoted,
        events: events,
        naturalHistory: history
      )
    }
  }

  // MARK: - Retirement (reversible) and purge (irreversible)

  /// Reversible retirement. The rows stay; `status` changes.
  public func retireBranch(id: String) throws {
    try dbWriter.write { db in
      guard var branch = try BranchRecord.fetchOne(db, key: id) else {
        throw UniverseStoreError.unknownBranch(id)
      }
      if branch.status == "purged" { return }
      branch.status = "retired"
      try branch.update(db)
    }
  }

  public func restoreBranch(id: String) throws {
    try dbWriter.write { db in
      guard var branch = try BranchRecord.fetchOne(db, key: id) else {
        throw UniverseStoreError.unknownBranch(id)
      }
      if branch.status == "purged" {
        throw UniverseStoreError.branchAlreadyPurged(id)
      }
      branch.status = "active"
      try branch.update(db)
    }
  }

  public func retireUniverse(id: String) throws {
    try dbWriter.write { db in
      guard var universe = try UniverseRecord.fetchOne(db, key: id) else {
        throw UniverseStoreError.unknownUniverse(id)
      }
      if universe.status == "purged" { return }
      universe.status = "retired"
      try universe.update(db)
    }
  }

  public func restoreUniverse(id: String) throws {
    try dbWriter.write { db in
      guard var universe = try UniverseRecord.fetchOne(db, key: id) else {
        throw UniverseStoreError.unknownUniverse(id)
      }
      if universe.status == "purged" {
        throw UniverseStoreError.universeAlreadyPurged(id)
      }
      universe.status = "active"
      try universe.update(db)
    }
  }

  /// Export the whole recoverable branch so purge can offer it first.
  public func exportBranch(id: String) throws -> BranchExport {
    try dbWriter.read { db in
      guard let branch = try BranchRecord.fetchOne(db, key: id) else {
        throw UniverseStoreError.unknownBranch(id)
      }
      guard let universe = try UniverseRecord.fetchOne(db, key: branch.universeId) else {
        throw UniverseStoreError.unknownUniverse(branch.universeId)
      }
      let promoted = try Self.promotedCheckpointForBranch(db, branchId: id)
      let events = try Self.eventsForBranch(db, branchId: id)
      let history = try Self.naturalHistoryForBranch(db, branchId: id)
      return BranchExport(
        universe: universe,
        branch: branch,
        promotedCheckpoint: promoted,
        events: events,
        naturalHistory: history,
        exportedAtEpochMs: self.clockMs()
      )
    }
  }

  /// Commit the tombstone that must land before any purge can proceed. This
  /// row is the point of no return: local and cloud recovery end after it.
  @discardableResult
  public func commitTombstone(
    id: String,
    universeId: String,
    branchId: String?,
    scope: RetirementScope,
    exportPath: String? = nil
  ) throws -> TombstoneRecord {
    try dbWriter.write { db in
      let now = self.clockMs()
      let record = TombstoneRecord(
        id: id,
        universeId: universeId,
        branchId: branchId,
        scope: scope.rawValue,
        status: "committed",
        exportPath: exportPath,
        committedAtEpochMs: now,
        createdAtEpochMs: now
      )
      try record.save(db)
      return record
    }
  }

  /// Physically remove a branch. Refuses unless a committed tombstone exists
  /// for the target — an unguarded purge is impossible.
  public func purgeBranch(id: String) throws {
    try dbWriter.write { db in
      let tombstoneExists = try TombstoneRecord
        .filter(Column("branchId") == id && Column("scope") == RetirementScope.branch.rawValue && Column("status") == "committed")
        .fetchCount(db) > 0
      guard tombstoneExists else { throw PurgeGuard.tombstoneRequired }
      // Cascade FKs drop events/checkpoints/history. Mark the branch purged
      // in case the referenced universe rows are also being purged in a
      // different call sequence.
      try db.execute(sql: "UPDATE branches SET status = 'purged' WHERE id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM branches WHERE id = ?", arguments: [id])
    }
  }

  public func purgeUniverse(id: String) throws {
    try dbWriter.write { db in
      let tombstoneExists = try TombstoneRecord
        .filter(Column("universeId") == id && Column("scope") == RetirementScope.universe.rawValue && Column("status") == "committed")
        .fetchCount(db) > 0
      guard tombstoneExists else { throw PurgeGuard.tombstoneRequired }
      try db.execute(sql: "UPDATE universes SET status = 'purged' WHERE id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM universes WHERE id = ?", arguments: [id])
    }
  }

  // MARK: - Model manifest and sync state

  public func upsertModelManifest(_ manifest: ModelManifestRecord) throws {
    try dbWriter.write { db in
      var record = manifest
      record.installedAtEpochMs = self.clockMs()
      try record.save(db)
    }
  }

  public func recordSyncState(_ state: SyncStateRecord) throws {
    try dbWriter.write { db in
      var record = state
      record.lastSyncedAtEpochMs = self.clockMs()
      try record.save(db)
    }
  }

  // MARK: - Direct read helpers (for tests + JS bridge queries)

  public func fetchEvents(branchId: String) throws -> [DomainEventRecord] {
    try dbWriter.read { db in try Self.eventsForBranch(db, branchId: branchId) }
  }

  public func fetchNaturalHistory(branchId: String) throws -> [NaturalHistoryRecord] {
    try dbWriter.read { db in try Self.naturalHistoryForBranch(db, branchId: branchId) }
  }

  public func fetchPromotedCheckpoint(branchId: String) throws -> CheckpointRecord? {
    try dbWriter.read { db in try Self.promotedCheckpointForBranch(db, branchId: branchId) }
  }

  public func fetchGestureChunks(gestureId: String) throws -> [GestureChunkRecord] {
    try dbWriter.read { db in
      try GestureChunkRecord
        .filter(Column("gestureId") == gestureId)
        .order(Column("chunkIndex").asc)
        .fetchAll(db)
    }
  }

  public func fetchBranches(universeId: String) throws -> [BranchRecord] {
    try dbWriter.read { db in
      try BranchRecord
        .filter(Column("universeId") == universeId)
        .order(Column("createdAtEpochMs").asc)
        .fetchAll(db)
    }
  }

  public func fetchUniverse(id: String) throws -> UniverseRecord? {
    try dbWriter.read { db in try UniverseRecord.fetchOne(db, key: id) }
  }

  public func fetchTombstones(universeId: String) throws -> [TombstoneRecord] {
    try dbWriter.read { db in
      try TombstoneRecord
        .filter(Column("universeId") == universeId)
        .order(Column("createdAtEpochMs").asc)
        .fetchAll(db)
    }
  }

  // MARK: - Internal helpers

  static func promotedCheckpointForBranch(_ db: Database, branchId: String) throws -> CheckpointRecord? {
    try CheckpointRecord
      .filter(Column("branchId") == branchId && Column("status") == "promoted")
      .order(Column("logicalTick").desc, Column("logicalOrdinal").desc)
      .fetchOne(db)
  }

  static func eventsForBranch(_ db: Database, branchId: String) throws -> [DomainEventRecord] {
    try DomainEventRecord
      .filter(Column("branchId") == branchId)
      .order(Column("logicalTick").asc, Column("logicalOrdinal").asc, Column("id").asc)
      .fetchAll(db)
  }

  static func naturalHistoryForBranch(_ db: Database, branchId: String) throws -> [NaturalHistoryRecord] {
    try NaturalHistoryRecord
      .filter(Column("branchId") == branchId)
      .order(Column("logicalTick").asc, Column("logicalOrdinal").asc, Column("id").asc)
      .fetchAll(db)
  }

  private static func compareLogicalTime(_ a: (Int, Int), _ b: (Int, Int)) -> Int {
    if a.0 != b.0 { return a.0 < b.0 ? -1 : 1 }
    if a.1 != b.1 { return a.1 < b.1 ? -1 : 1 }
    return 0
  }
}

// MARK: - Errors

public enum UniverseStoreError: Error, Equatable {
  case unknownUniverse(String)
  case unknownBranch(String)
  case unknownCheckpoint(String)
  case missingParentBranch(String)
  case parentBranchUniverseMismatch
  case branchNotInUniverse(branchId: String, universeId: String)
  case corruptedInhabitedBranch(String)
  case branchAlreadyPurged(String)
  case universeAlreadyPurged(String)
  case checkpointDoesNotFollowEvent(String)
  case checkpointGoesBackward(String)
  case checkpointRetired(String)
}
