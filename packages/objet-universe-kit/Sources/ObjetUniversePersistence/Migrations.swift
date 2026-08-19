import Foundation
import GRDB

/// Owns the versioned schema for the local universe store. Each migration is
/// additive; a future model or contract bump adds a new numbered migration
/// rather than editing an older one, so the tests can prove that a v1 corpus
/// still reads back after the migrator runs to head.
public enum UniverseSchema {
  public static let head = 1

  public static func migrator() -> DatabaseMigrator {
    var migrator = DatabaseMigrator()

    // The initial schema. Column names match `Records.swift` verbatim; GRDB's
    // `PersistableRecord` conformance maps property name → column name.
    migrator.registerMigration("v1_universe_history") { db in
      try db.create(table: "universes") { table in
        table.column("id", .text).primaryKey()
        table.column("contractVersion", .integer).notNull()
        table.column("seed", .text).notNull()
        table.column("modelVersion", .text).notNull()
        table.column("logicalTick", .integer).notNull()
        table.column("logicalOrdinal", .integer).notNull()
        table.column("inhabitedBranchId", .text).notNull()
        table.column("status", .text).notNull().defaults(to: "active")
        table.column("createdAtEpochMs", .integer).notNull()
      }

      try db.create(table: "branches") { table in
        table.column("id", .text).primaryKey()
        table.column("universeId", .text).notNull().indexed()
          .references("universes", onDelete: .cascade)
        table.column("parentBranchId", .text)
        table.column("forkedAtTick", .integer)
        table.column("forkedAtOrdinal", .integer)
        table.column("writerId", .text).notNull()
        table.column("writerEpoch", .integer).notNull()
        table.column("status", .text).notNull().defaults(to: "active")
        table.column("createdAtEpochMs", .integer).notNull()
      }

      try db.create(table: "domain_events") { table in
        // Event id is globally unique; this is the exactly-once boundary
        // between preview and authoritative apply — INSERT OR IGNORE dedupes.
        table.column("id", .text).primaryKey()
        table.column("universeId", .text).notNull().indexed()
          .references("universes", onDelete: .cascade)
        table.column("branchId", .text).notNull().indexed()
          .references("branches", onDelete: .cascade)
        table.column("contractVersion", .integer).notNull()
        table.column("actionVersion", .integer).notNull()
        table.column("logicalTick", .integer).notNull()
        table.column("logicalOrdinal", .integer).notNull()
        table.column("domainSeconds", .double).notNull()
        table.column("domainScaleId", .text).notNull()
        table.column("verb", .text).notNull()
        table.column("intensity", .double).notNull()
        table.column("payloadJson", .text).notNull()
        table.column("writerId", .text).notNull()
        table.column("writerEpoch", .integer).notNull()
        table.column("appendedAtEpochMs", .integer).notNull()
      }
      try db.create(
        index: "idx_domain_events_branch_order",
        on: "domain_events",
        columns: ["branchId", "logicalTick", "logicalOrdinal"]
      )

      try db.create(table: "checkpoints") { table in
        table.column("id", .text).primaryKey()
        table.column("universeId", .text).notNull().indexed()
          .references("universes", onDelete: .cascade)
        table.column("branchId", .text).notNull().indexed()
          .references("branches", onDelete: .cascade)
        table.column("contractVersion", .integer).notNull()
        table.column("modelVersion", .text).notNull()
        table.column("logicalTick", .integer).notNull()
        table.column("logicalOrdinal", .integer).notNull()
        table.column("stateDigest", .text).notNull()
        table.column("followsEventId", .text)
        // "staged" (not yet promoted, prior checkpoint still authoritative)
        // "promoted" (the current stable checkpoint for that branch)
        // "retired" (previously promoted; still recoverable, no longer current)
        table.column("status", .text).notNull().defaults(to: "staged")
        table.column("createdAtEpochMs", .integer).notNull()
      }

      try db.create(table: "natural_history") { table in
        table.column("id", .text).primaryKey()
        table.column("universeId", .text).notNull().indexed()
          .references("universes", onDelete: .cascade)
        table.column("branchId", .text).notNull().indexed()
          .references("branches", onDelete: .cascade)
        table.column("contractVersion", .integer).notNull()
        table.column("kind", .text).notNull()
        table.column("logicalTick", .integer).notNull()
        table.column("logicalOrdinal", .integer).notNull()
        table.column("domainEventId", .text)
        table.column("subjectIdsJson", .text).notNull()
        table.column("summary", .text).notNull()
        table.column("appendedAtEpochMs", .integer).notNull()
      }

      try db.create(table: "gesture_chunks") { table in
        // A gesture may finalize a chunk more than once as new samples arrive
        // inside the 250 ms window; (gestureId, chunkIndex) is the idempotency
        // key so a repeated write cannot double-count.
        table.column("gestureId", .text).notNull()
        table.column("chunkIndex", .integer).notNull()
        table.column("universeId", .text).notNull()
        table.column("branchId", .text).notNull()
        table.column("kind", .text).notNull()
        table.column("sampleHz", .integer).notNull()
        table.column("chunkMs", .integer).notNull()
        table.column("fromMs", .double).notNull()
        table.column("toMs", .double).notNull()
        table.column("samplesJson", .text).notNull()
        table.column("finalized", .boolean).notNull().defaults(to: false)
        table.column("appendedAtEpochMs", .integer).notNull()
        table.primaryKey(["gestureId", "chunkIndex"])
      }

      try db.create(table: "tombstones") { table in
        table.column("id", .text).primaryKey()
        table.column("universeId", .text).notNull().indexed()
        table.column("branchId", .text)
        table.column("scope", .text).notNull() // "branch" | "universe"
        table.column("status", .text).notNull() // "requested" | "committed"
        table.column("exportPath", .text)
        table.column("committedAtEpochMs", .integer)
        table.column("createdAtEpochMs", .integer).notNull()
      }

      try db.create(table: "sync_state") { table in
        table.column("scope", .text).primaryKey()
        table.column("lastSyncedEventId", .text)
        table.column("lastSyncedAtEpochMs", .integer)
        table.column("writerId", .text).notNull()
        table.column("writerEpoch", .integer).notNull()
      }

      try db.create(table: "model_manifests") { table in
        table.column("sceneId", .text).notNull()
        table.column("modelVersion", .text).notNull()
        table.column("contractVersion", .integer).notNull()
        table.column("manifestJson", .text).notNull()
        table.column("installedAtEpochMs", .integer).notNull()
        table.primaryKey(["sceneId", "modelVersion"])
      }
    }

    return migrator
  }
}
