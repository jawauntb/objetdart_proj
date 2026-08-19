import Foundation
import GRDB
import ObjetUniverseCore

// MARK: - Contract versions
//
// These mirror the versioned TypeScript contracts (`@objet/universe-contracts`).
// A stored row carries its contract version so a future model migration can
// keep the old rows readable rather than silently reinterpreting bytes.

public enum PersistenceContract {
  public static let universe: Int = 1
  public static let history: Int = 1
  public static let action: Int = 1
  public static let continuousGesture: Int = 1
  public static let schemaVersion: Int = 1
}

// MARK: - Value types

/// A canonical, replay-safe record of one semantic verb landing at a fixed
/// logical time. The `payload` is the canonical JSON blob emitted by
/// `serializeAction` on the TypeScript side; we do not try to parse it in
/// Swift because a future action version must remain recoverable byte-for-byte.
public struct DomainEventRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "domain_events"

  public var id: String
  public var universeId: String
  public var branchId: String
  public var contractVersion: Int
  public var actionVersion: Int
  public var logicalTick: Int
  public var logicalOrdinal: Int
  public var domainSeconds: Double
  public var domainScaleId: String
  public var verb: String
  public var intensity: Double
  public var payloadJson: String
  public var writerId: String
  public var writerEpoch: Int
  public var appendedAtEpochMs: Int64

  public init(
    id: String,
    universeId: String,
    branchId: String,
    contractVersion: Int = PersistenceContract.history,
    actionVersion: Int = PersistenceContract.action,
    logicalTick: Int,
    logicalOrdinal: Int,
    domainSeconds: Double,
    domainScaleId: String,
    verb: String,
    intensity: Double,
    payloadJson: String,
    writerId: String,
    writerEpoch: Int,
    appendedAtEpochMs: Int64
  ) {
    self.id = id
    self.universeId = universeId
    self.branchId = branchId
    self.contractVersion = contractVersion
    self.actionVersion = actionVersion
    self.logicalTick = logicalTick
    self.logicalOrdinal = logicalOrdinal
    self.domainSeconds = domainSeconds
    self.domainScaleId = domainScaleId
    self.verb = verb
    self.intensity = intensity
    self.payloadJson = payloadJson
    self.writerId = writerId
    self.writerEpoch = writerEpoch
    self.appendedAtEpochMs = appendedAtEpochMs
  }
}

/// A stable point past which future events can safely apply. A checkpoint is
/// staged first, then promoted once the store confirms it followed the last
/// durably appended event — never before.
public struct CheckpointRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "checkpoints"

  public var id: String
  public var universeId: String
  public var branchId: String
  public var contractVersion: Int
  public var modelVersion: String
  public var logicalTick: Int
  public var logicalOrdinal: Int
  public var stateDigest: String
  public var followsEventId: String?
  public var status: String // "staged" | "promoted" | "retired"
  public var createdAtEpochMs: Int64

  public init(
    id: String,
    universeId: String,
    branchId: String,
    contractVersion: Int = PersistenceContract.history,
    modelVersion: String,
    logicalTick: Int,
    logicalOrdinal: Int,
    stateDigest: String,
    followsEventId: String?,
    status: String,
    createdAtEpochMs: Int64
  ) {
    self.id = id
    self.universeId = universeId
    self.branchId = branchId
    self.contractVersion = contractVersion
    self.modelVersion = modelVersion
    self.logicalTick = logicalTick
    self.logicalOrdinal = logicalOrdinal
    self.stateDigest = stateDigest
    self.followsEventId = followsEventId
    self.status = status
    self.createdAtEpochMs = createdAtEpochMs
  }
}

/// One entry in the trail that renders births, mergers, divisions, extinctions,
/// phase changes, discoveries, interventions, and branches. The `subjectIds`
/// column stores a canonical JSON array so the trail keeps a stable order.
public struct NaturalHistoryRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "natural_history"

  public var id: String
  public var universeId: String
  public var branchId: String
  public var contractVersion: Int
  public var kind: String
  public var logicalTick: Int
  public var logicalOrdinal: Int
  public var domainEventId: String?
  public var subjectIdsJson: String
  public var summary: String
  public var appendedAtEpochMs: Int64

  public init(
    id: String,
    universeId: String,
    branchId: String,
    contractVersion: Int = PersistenceContract.history,
    kind: String,
    logicalTick: Int,
    logicalOrdinal: Int,
    domainEventId: String?,
    subjectIdsJson: String,
    summary: String,
    appendedAtEpochMs: Int64
  ) {
    self.id = id
    self.universeId = universeId
    self.branchId = branchId
    self.contractVersion = contractVersion
    self.kind = kind
    self.logicalTick = logicalTick
    self.logicalOrdinal = logicalOrdinal
    self.domainEventId = domainEventId
    self.subjectIdsJson = subjectIdsJson
    self.summary = summary
    self.appendedAtEpochMs = appendedAtEpochMs
  }
}

/// The identity a whole album lineage lives inside. The `inhabitedBranchId`
/// column names the currently visible branch; changing it never destroys the
/// prior branch — a branch retires reversibly instead.
public struct UniverseRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "universes"

  public var id: String
  public var contractVersion: Int
  public var seed: String
  public var modelVersion: String
  public var logicalTick: Int
  public var logicalOrdinal: Int
  public var inhabitedBranchId: String
  public var status: String // "active" | "retired" | "purged"
  public var createdAtEpochMs: Int64

  public init(
    id: String,
    contractVersion: Int = PersistenceContract.universe,
    seed: String,
    modelVersion: String,
    logicalTick: Int,
    logicalOrdinal: Int,
    inhabitedBranchId: String,
    status: String,
    createdAtEpochMs: Int64
  ) {
    self.id = id
    self.contractVersion = contractVersion
    self.seed = seed
    self.modelVersion = modelVersion
    self.logicalTick = logicalTick
    self.logicalOrdinal = logicalOrdinal
    self.inhabitedBranchId = inhabitedBranchId
    self.status = status
    self.createdAtEpochMs = createdAtEpochMs
  }
}

public struct BranchRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "branches"

  public var id: String
  public var universeId: String
  public var parentBranchId: String?
  public var forkedAtTick: Int?
  public var forkedAtOrdinal: Int?
  public var writerId: String
  public var writerEpoch: Int
  public var status: String // "active" | "retired" | "purged"
  public var createdAtEpochMs: Int64

  public init(
    id: String,
    universeId: String,
    parentBranchId: String?,
    forkedAtTick: Int?,
    forkedAtOrdinal: Int?,
    writerId: String,
    writerEpoch: Int,
    status: String,
    createdAtEpochMs: Int64
  ) {
    self.id = id
    self.universeId = universeId
    self.parentBranchId = parentBranchId
    self.forkedAtTick = forkedAtTick
    self.forkedAtOrdinal = forkedAtOrdinal
    self.writerId = writerId
    self.writerEpoch = writerEpoch
    self.status = status
    self.createdAtEpochMs = createdAtEpochMs
  }
}

/// One 250 ms durable chunk from a continuous gesture. The store never writes
/// per-touch samples — writes are batched at the contract's chunk cadence so
/// device sample rate cannot inflate SQLite traffic.
public struct GestureChunkRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "gesture_chunks"

  public var gestureId: String
  public var chunkIndex: Int
  public var universeId: String
  public var branchId: String
  public var kind: String
  public var sampleHz: Int
  public var chunkMs: Int
  public var fromMs: Double
  public var toMs: Double
  public var samplesJson: String
  public var finalized: Bool
  public var appendedAtEpochMs: Int64

  public init(
    gestureId: String,
    chunkIndex: Int,
    universeId: String,
    branchId: String,
    kind: String,
    sampleHz: Int,
    chunkMs: Int,
    fromMs: Double,
    toMs: Double,
    samplesJson: String,
    finalized: Bool,
    appendedAtEpochMs: Int64
  ) {
    self.gestureId = gestureId
    self.chunkIndex = chunkIndex
    self.universeId = universeId
    self.branchId = branchId
    self.kind = kind
    self.sampleHz = sampleHz
    self.chunkMs = chunkMs
    self.fromMs = fromMs
    self.toMs = toMs
    self.samplesJson = samplesJson
    self.finalized = finalized
    self.appendedAtEpochMs = appendedAtEpochMs
  }

  public static func databaseTableName(_ id: String) -> String { databaseTableName }
}

/// A tombstone is the irreversible commit that must precede any local delete
/// or CloudKit purge. Recovery only removes physical rows for a target that
/// already has a `committed` tombstone.
public struct TombstoneRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "tombstones"

  public var id: String
  public var universeId: String
  public var branchId: String?
  public var scope: String // "branch" | "universe"
  public var status: String // "requested" | "committed"
  public var exportPath: String?
  public var committedAtEpochMs: Int64?
  public var createdAtEpochMs: Int64

  public init(
    id: String,
    universeId: String,
    branchId: String?,
    scope: String,
    status: String,
    exportPath: String?,
    committedAtEpochMs: Int64?,
    createdAtEpochMs: Int64
  ) {
    self.id = id
    self.universeId = universeId
    self.branchId = branchId
    self.scope = scope
    self.status = status
    self.exportPath = exportPath
    self.committedAtEpochMs = committedAtEpochMs
    self.createdAtEpochMs = createdAtEpochMs
  }
}

public struct SyncStateRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "sync_state"

  public var scope: String // primary key
  public var lastSyncedEventId: String?
  public var lastSyncedAtEpochMs: Int64?
  public var writerId: String
  public var writerEpoch: Int

  public init(
    scope: String,
    lastSyncedEventId: String?,
    lastSyncedAtEpochMs: Int64?,
    writerId: String,
    writerEpoch: Int
  ) {
    self.scope = scope
    self.lastSyncedEventId = lastSyncedEventId
    self.lastSyncedAtEpochMs = lastSyncedAtEpochMs
    self.writerId = writerId
    self.writerEpoch = writerEpoch
  }
}

public struct ModelManifestRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "model_manifests"

  public var sceneId: String
  public var modelVersion: String
  public var contractVersion: Int
  public var manifestJson: String
  public var installedAtEpochMs: Int64

  public init(
    sceneId: String,
    modelVersion: String,
    contractVersion: Int,
    manifestJson: String,
    installedAtEpochMs: Int64
  ) {
    self.sceneId = sceneId
    self.modelVersion = modelVersion
    self.contractVersion = contractVersion
    self.manifestJson = manifestJson
    self.installedAtEpochMs = installedAtEpochMs
  }
}
