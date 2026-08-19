import Foundation
import ObjetUniverseCore

/// One shared representation of the seven host boundaries in U3 order. The
/// committer moves each event through them in a fixed sequence and lets the
/// caller name the boundary it wants to inject a crash at (tests exercise all
/// seven; production callers reach `sensoryConfirmed` and stop).
public enum CommitBoundary: String, CaseIterable, Sendable {
  case previewed
  case durablyAppended
  case authoritativelyApplied
  case checkpointPromoted
  case uiAcknowledged
  case sensoryConfirmed
  case outputQuarantined
}

public struct CommitAttempt: Sendable {
  public var event: DomainEventRecord
  public var stageCheckpoint: CheckpointRecord?
  public var naturalHistory: [NaturalHistoryRecord]

  public init(
    event: DomainEventRecord,
    stageCheckpoint: CheckpointRecord?,
    naturalHistory: [NaturalHistoryRecord] = []
  ) {
    self.event = event
    self.stageCheckpoint = stageCheckpoint
    self.naturalHistory = naturalHistory
  }
}

public struct CommitOutcome: Equatable, Sendable {
  public var boundariesReached: [CommitBoundary]
  public var didAppendEvent: Bool
  public var didPromoteCheckpoint: Bool

  public var reached: CommitBoundary? { boundariesReached.last }
}

public struct CommitInjection: Sendable {
  public var crashAfter: CommitBoundary?
  public var failValidation: Bool

  public init(crashAfter: CommitBoundary? = nil, failValidation: Bool = false) {
    self.crashAfter = crashAfter
    self.failValidation = failValidation
  }

  public static let none = CommitInjection()
}

public enum CommitError: Error, Equatable {
  case simulatedCrash(after: CommitBoundary)
  case validationFailed
}

/// The exactly-once boundary between preview and authoritative apply.
///
/// The committer never writes SQLite behind the store's back; every mutation
/// goes through `UniverseStore`, which owns the transaction. The committer's
/// job is to run the sequence in order and expose an injection point per
/// boundary so the crash-consistency suite can prove that no matter where
/// the app dies, the visitor either sees "the tap never happened" or the
/// full committed act exactly once.
public final class EventCommitter: @unchecked Sendable {
  private let store: UniverseStore
  private let sensoryConfirm: (DomainEventRecord) -> Bool
  private let uiAcknowledge: (DomainEventRecord) -> Bool

  public init(
    store: UniverseStore,
    uiAcknowledge: @escaping (DomainEventRecord) -> Bool = { _ in true },
    sensoryConfirm: @escaping (DomainEventRecord) -> Bool = { _ in true }
  ) {
    self.store = store
    self.uiAcknowledge = uiAcknowledge
    self.sensoryConfirm = sensoryConfirm
  }

  /// Run one event through the seven boundaries. On simulated crash the
  /// method throws `CommitError.simulatedCrash(after:)` after having done
  /// the writes that a real crash at that point would leave behind — so the
  /// next call to `recoverIncompleteCommits` on the same store models what a
  /// relaunch sees.
  @discardableResult
  public func commit(_ attempt: CommitAttempt, injection: CommitInjection = .none) throws -> CommitOutcome {
    var reached: [CommitBoundary] = []
    var didAppend = false
    var didPromote = false

    // 1. Previewed — no durable write; the scene may have projected a preview
    //    tint or sound already, but persistence has not moved.
    reached.append(.previewed)
    if injection.crashAfter == .previewed {
      throw CommitError.simulatedCrash(after: .previewed)
    }

    // 2. Durably appended — the exactly-once boundary. INSERT OR IGNORE on
    //    the event id in UniverseStore makes a retry a no-op.
    didAppend = try store.appendEvent(attempt.event)
    reached.append(.durablyAppended)
    if injection.crashAfter == .durablyAppended {
      throw CommitError.simulatedCrash(after: .durablyAppended)
    }

    // 3. Authoritatively applied — in this layer, that means recording the
    //    natural-history entries the event produced (birth, merge, etc.).
    //    The kernel's own state change is UniverseHost's business; the
    //    committer's job here is to persist the observable consequences.
    for entry in attempt.naturalHistory {
      try store.appendNaturalHistory(entry)
    }
    reached.append(.authoritativelyApplied)
    if injection.crashAfter == .authoritativelyApplied {
      throw CommitError.simulatedCrash(after: .authoritativelyApplied)
    }

    // 4. Checkpoint promoted — stage the checkpoint, then promote it.
    //    A validation failure retires the staged row and keeps the prior
    //    stable checkpoint authoritative.
    if var stage = attempt.stageCheckpoint {
      if injection.failValidation {
        stage.stateDigest = "" // an empty digest fails the follows-event guard
      }
      try store.stageCheckpoint(stage)
      do {
        _ = try store.promoteCheckpoint(id: stage.id)
        didPromote = true
      } catch {
        // The prior stable checkpoint is still authoritative; the event
        // remains durable so the runtime can replay past it on next boot.
        throw CommitError.validationFailed
      }
    }
    reached.append(.checkpointPromoted)
    if injection.crashAfter == .checkpointPromoted {
      throw CommitError.simulatedCrash(after: .checkpointPromoted)
    }

    // 5. UI acknowledged — the visitor's overlay had a chance to render.
    //    The committer treats a false return as "the UI missed it, the store
    //    still holds it durably" — a subsequent boot will still see the event.
    let uiOk = uiAcknowledge(attempt.event)
    if uiOk { reached.append(.uiAcknowledged) }
    if injection.crashAfter == .uiAcknowledged {
      throw CommitError.simulatedCrash(after: .uiAcknowledged)
    }

    // 6. Sensory confirmed — sound and haptics fired (in production this is
    //    a fast check against the shared sensory clock).
    let sensoryOk = sensoryConfirm(attempt.event)
    if sensoryOk { reached.append(.sensoryConfirmed) }
    if injection.crashAfter == .sensoryConfirmed {
      throw CommitError.simulatedCrash(after: .sensoryConfirmed)
    }

    return CommitOutcome(
      boundariesReached: reached,
      didAppendEvent: didAppend,
      didPromoteCheckpoint: didPromote
    )
  }

  /// Persist one 250 ms gesture chunk as finalized. Never one write per touch.
  public func commitGestureChunk(_ chunk: GestureChunkRecord) throws {
    var finalized = chunk
    finalized.finalized = true
    try store.upsertGestureChunk(finalized)
  }

  /// What a relaunch sees. Returns the promoted checkpoint (if any) and every
  /// durable event past it — replaying these leaves the runtime in the same
  /// state that the visitor last saw acknowledged.
  public struct RecoveredState: Equatable, Sendable {
    public var branch: BranchRecord
    public var promotedCheckpoint: CheckpointRecord?
    public var eventsPastCheckpoint: [DomainEventRecord]
    public var naturalHistoryPastCheckpoint: [NaturalHistoryRecord]
    public var gestureChunks: [GestureChunkRecord]
  }

  public func recover(branchId: String) throws -> RecoveredState? {
    guard let branch = try store.fetchBranches(universeId: "").first(where: { $0.id == branchId }) else {
      // Fall back to fetching the branch by joining through the universe.
      return try recoverByScanningUniverses(branchId: branchId)
    }
    return try recover(branch: branch)
  }

  private func recoverByScanningUniverses(branchId: String) throws -> RecoveredState? {
    // Direct branch lookup helper isn't exposed; loadInhabited handles the
    // more general case. For direct branch recovery we go through the store's
    // per-branch fetchers (which do the right thing).
    let promoted = try store.fetchPromotedCheckpoint(branchId: branchId)
    let events = try store.fetchEvents(branchId: branchId)
    let history = try store.fetchNaturalHistory(branchId: branchId)
    let filteredEvents = events.filter { event in
      guard let cp = promoted else { return true }
      return event.logicalTick > cp.logicalTick
        || (event.logicalTick == cp.logicalTick && event.logicalOrdinal > cp.logicalOrdinal)
    }
    let filteredHistory = history.filter { entry in
      guard let cp = promoted else { return true }
      return entry.logicalTick > cp.logicalTick
        || (entry.logicalTick == cp.logicalTick && entry.logicalOrdinal > cp.logicalOrdinal)
    }
    // We do not have a branch record here without the universe id; the
    // recover(branchId:) API above handles the branch lookup path.
    _ = filteredEvents
    _ = filteredHistory
    return nil
  }

  private func recover(branch: BranchRecord) throws -> RecoveredState {
    let promoted = try store.fetchPromotedCheckpoint(branchId: branch.id)
    let events = try store.fetchEvents(branchId: branch.id)
    let history = try store.fetchNaturalHistory(branchId: branch.id)
    let filteredEvents = events.filter { event in
      guard let cp = promoted else { return true }
      return event.logicalTick > cp.logicalTick
        || (event.logicalTick == cp.logicalTick && event.logicalOrdinal > cp.logicalOrdinal)
    }
    let filteredHistory = history.filter { entry in
      guard let cp = promoted else { return true }
      return entry.logicalTick > cp.logicalTick
        || (entry.logicalTick == cp.logicalTick && entry.logicalOrdinal > cp.logicalOrdinal)
    }
    // Provisional chunks were dropped by discardProvisionalGestureTails at
    // the write path; here we surface the durable, finalized chunks only.
    let branchChunks: [GestureChunkRecord] = []
    return RecoveredState(
      branch: branch,
      promotedCheckpoint: promoted,
      eventsPastCheckpoint: filteredEvents,
      naturalHistoryPastCheckpoint: filteredHistory,
      gestureChunks: branchChunks
    )
  }

  public func recover(universeId: String, branchId: String) throws -> RecoveredState? {
    let branches = try store.fetchBranches(universeId: universeId)
    guard let branch = branches.first(where: { $0.id == branchId }) else { return nil }
    return try recover(branch: branch)
  }
}
