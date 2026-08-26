import Foundation
import simd

/// The renderer-free semantic stages exposed by the native H₂ instrument.
/// A presentation or sensory layer may collapse these into its own vocabulary,
/// but it cannot infer them from pixels or from a generic gesture release.
public enum MoleculeH2MilestoneKind: String, Codable, Equatable, Sendable {
  case correcting = "field-correcting"
  case converged = "field-converged"
  case accepted = "checkpoint-accepted"
  case refused = "field-refused"
  case rollback = "checkpoint-rollback"
}

/// A bounded, idempotent scientific event. `id` is a deterministic function of
/// molecule identity, contact epoch, authority tick, and milestone kind. It is
/// therefore safe for a consumer to retry a drain without producing a second
/// cue.
public struct MoleculeH2OutcomeEvent: Codable, Equatable, Sendable {
  public let id: String
  public let bodyID: UInt64
  public let targetID: String
  public let contactEpoch: H2RHFContactEpoch?
  public let tick: Int
  public let kind: MoleculeH2MilestoneKind
  public let disposition: H2RHFDisposition
  public let promotionGeneration: Int
  public let checkpointDigest: String?

  public init(
    id: String,
    bodyID: UInt64,
    targetID: String,
    contactEpoch: H2RHFContactEpoch?,
    tick: Int,
    kind: MoleculeH2MilestoneKind,
    disposition: H2RHFDisposition,
    promotionGeneration: Int,
    checkpointDigest: String?
  ) {
    self.id = id
    self.bodyID = bodyID
    self.targetID = targetID
    self.contactEpoch = contactEpoch
    self.tick = max(0, tick)
    self.kind = kind
    self.disposition = disposition
    self.promotionGeneration = max(0, promotionGeneration)
    self.checkpointDigest = checkpointDigest
  }

  /// The three stable classes permitted at a generic sensory boundary.
  public var fieldKind: MoleculeH2FieldKind {
    switch kind {
    case .correcting: .correcting
    case .converged, .accepted: .settled
    case .refused, .rollback: .refused
    }
  }

  /// Promotion is the single accepted/converged user transition. These
  /// aliases remain facts on that one event rather than separate cues.
  public var isAccepted: Bool { kind == .converged && disposition == .promoted }
  public var isRollback: Bool { kind == .refused && disposition != .promoted && checkpointDigest != nil }
}

public enum MoleculeH2FieldKind: String, Codable, Equatable, Sendable {
  case correcting = "field-correcting"
  case settled = "field-settled"
  case refused = "field-refused"
}

public struct MoleculeH2OutcomeSnapshot: Codable, Equatable, Sendable {
  public let bodyID: UInt64
  public let targetID: String
  public let authority: H2RHFSnapshot
  public let adapter: H2RHFAdapterSnapshot
  public let outcomes: [MoleculeH2OutcomeEvent]

  public init(
    bodyID: UInt64,
    targetID: String,
    authority: H2RHFSnapshot,
    adapter: H2RHFAdapterSnapshot,
    outcomes: [MoleculeH2OutcomeEvent]
  ) {
    self.bodyID = bodyID
    self.targetID = targetID
    self.authority = authority
    self.adapter = adapter
    self.outcomes = outcomes
  }
}

/// Typed molecule seam for the native host. Keeping this separate from the
/// solar `SimulationOutcome` vocabulary preserves H₂'s correcting/settled/
/// refused semantics while still giving the host one bounded drain to consume.
public protocol MoleculeH2OutcomeProducing: AnyObject {
  func drainMoleculeH2Outcomes<T>(_ body: (UnsafeBufferPointer<MoleculeH2OutcomeEvent>) -> T) -> T
}

/// One native H₂ authority, one fixed-tick adapter, and one bounded outcome
/// stream. The molecule kernel owns this value for its one canonical H₂ body;
/// no renderer or sensory consumer creates another solver or another cursor.
public final class MoleculeH2Outcome: @unchecked Sendable {
  public let bodyID: UInt64
  public let targetID: String
  public let authority: H2RHFAuthority
  public let adapter: H2RHFAdapter

  private static let outcomeCapacity = 64
  private static let dedupeCapacity = 256
  private var outcomes: [MoleculeH2OutcomeEvent] = []
  private var emittedIDs: Set<String> = []
  private var emittedIDRing: [String?] = Array(repeating: nil, count: dedupeCapacity)
  private var emittedIDCursor = 0
  private var emittedIDCount = 0
  /// The renderer borrows this compact value rather than asking the authority
  /// for a full scientific snapshot on every display frame. It is refreshed
  /// only after a logical H₂ tick (or at initialization).
  private var cachedRenderSnapshot: MoleculeH2RenderSnapshot?

  public init(
    bodyID: UInt64,
    targetID: String,
    authority: H2RHFAuthority? = nil,
    tickMs: Double = 50.0
  ) {
    precondition(!targetID.isEmpty)
    self.bodyID = bodyID
    self.targetID = targetID
    let selectedAuthority = authority ?? H2RHFAuthority(options: .init(initialTargetId: targetID))
    self.authority = selectedAuthority
    adapter = H2RHFAdapter(authority: selectedAuthority, tickMs: tickMs)
    outcomes.reserveCapacity(Self.outcomeCapacity)
    collectNewMilestones()
    cachedRenderSnapshot = makeRenderSnapshot()
  }

  @discardableResult
  public func queue(_ command: H2RHFCommand) -> H2RHFAdapterSnapshot {
    let result = adapter.queue(command)
    collectNewMilestones()
    return result
  }

  @discardableResult
  public func enqueue(_ command: H2RHFCommand) -> H2RHFAdapterSnapshot { queue(command) }

  @discardableResult
  public func beginContact(
    separationAngstrom: Double,
    rawSeparationAngstrom: Double? = nil,
    contactEpoch: H2RHFContactEpoch,
    targetID requestedTargetID: String? = nil
  ) -> H2RHFAdapterSnapshot {
    queue(.beginContact(.init(
      separationAngstrom: separationAngstrom,
      rawSeparationAngstrom: rawSeparationAngstrom,
      targetId: requestedTargetID ?? targetID,
      contactEpoch: contactEpoch
    )))
  }

  @discardableResult
  public func request(
    separationAngstrom: Double,
    rawSeparationAngstrom: Double? = nil
  ) -> H2RHFAdapterSnapshot {
    queue(.request(.init(
      separationAngstrom: separationAngstrom,
      rawSeparationAngstrom: rawSeparationAngstrom,
      targetId: targetID
    )))
  }

  @discardableResult
  public func release(
    separationAngstrom: Double? = nil,
    rawSeparationAngstrom: Double? = nil
  ) -> H2RHFAdapterSnapshot {
    queue(.release(.init(separationAngstrom: separationAngstrom, rawSeparationAngstrom: rawSeparationAngstrom)))
  }

  @discardableResult
  public func cancel() -> H2RHFAdapterSnapshot {
    queue(.cancel)
  }

  /// Advances exactly one logical authority tick. The presentation clock is
  /// intentionally absent; a host that is already on a logical tick should
  /// call this once, while a frame-rate adapter calls `advancePresentation`.
  @discardableResult
  public func tick() -> H2RHFAdapterSnapshot {
    let result = adapter.tick()
    collectNewMilestones()
    cachedRenderSnapshot = makeRenderSnapshot()
    return result
  }

  @discardableResult
  public func advancePresentation(_ deltaMs: Double) throws -> H2RHFAdapterSnapshot {
    let previousTick = adapter.snapshot().logicalTicks
    let result = try adapter.advancePresentation(deltaMs)
    collectNewMilestones()
    if result.logicalTicks != previousTick {
      cachedRenderSnapshot = makeRenderSnapshot()
    }
    return result
  }

  @discardableResult
  public func rebase() -> H2RHFAdapterSnapshot {
    adapter.rebase()
  }

  @discardableResult
  public func onVisibility(hidden: Bool) -> H2RHFAdapterSnapshot {
    adapter.onVisibility(hidden: hidden)
  }

  /// Compact immutable core → render projection. It is cached at logical
  /// cadence, so callers may borrow it freely without copying candidate and
  /// checkpoint arrays from the authority on every frame.
  public var renderSnapshot: MoleculeH2RenderSnapshot? { cachedRenderSnapshot }

  public func snapshot() -> MoleculeH2OutcomeSnapshot {
    collectNewMilestones()
    return MoleculeH2OutcomeSnapshot(
      bodyID: bodyID,
      targetID: targetID,
      authority: authority.snapshot(),
      adapter: adapter.snapshot(),
      outcomes: outcomes
    )
  }

  /// Number of retained dedupe keys. It is intentionally capped so a long
  /// session cannot turn milestone idempotence into unbounded history.
  public var dedupeEntryCount: Int { emittedIDCount }

  /// Drains only newly published events. Repeated drains are empty, while a
  /// consumer that asks for a snapshot before draining still receives each
  /// event exactly once because the cursor and ID set are shared.
  public func drainOutcomes<T>(_ body: (UnsafeBufferPointer<MoleculeH2OutcomeEvent>) -> T) -> T {
    collectNewMilestones()
    let result = outcomes.withUnsafeBufferPointer(body)
    outcomes.removeAll(keepingCapacity: true)
    return result
  }

  public func drain<T>(_ body: (UnsafeBufferPointer<MoleculeH2OutcomeEvent>) -> T) -> T {
    drainOutcomes(body)
  }

  private func collectNewMilestones() {
    let milestones = authority.milestones()
    // The authority bounds its milestone array by evicting the oldest entry;
    // an integer cursor would then skip a newly appended event after the first
    // eviction. Re-scan the small bounded ledger and let deterministic IDs do
    // the deduplication instead.
    for milestone in milestones {
      appendEvents(for: milestone)
    }
  }

  private func appendEvents(for milestone: H2RHFMilestone) {
    switch milestone.kind {
    case .contactBegin:
      append(kind: .correcting, milestone: milestone)
    case .promotion:
      // Convergence is the one accepted/settled semantic transition. The
      // event exposes `isAccepted` for consumers that need the checkpoint
      // boundary without scheduling a duplicate cue.
      append(kind: .converged, milestone: milestone)
    case .outsideEnvelope, .maxIterations, .numericalFailure, .referenceUnverified:
      // Refusal carries the rollback fact through `isRollback`; it remains a
      // single accessible/sensory transition even when a last-good field is
      // retained.
      append(kind: .refused, milestone: milestone)
    case .request, .requestIgnored, .tick, .gatePass, .release, .cancel:
      break
    }
  }

  private func append(kind: MoleculeH2MilestoneKind, milestone: H2RHFMilestone) {
    let eventID = makeEventID(kind: kind, milestone: milestone)
    guard remember(eventID) else { return }
    if outcomes.count == Self.outcomeCapacity { outcomes.removeFirst() }
    outcomes.append(.init(
      id: eventID,
      bodyID: bodyID,
      targetID: targetID,
      contactEpoch: milestone.contactEpoch,
      tick: milestone.tick,
      kind: kind,
      disposition: milestone.disposition,
      promotionGeneration: milestone.promotionGeneration,
      checkpointDigest: milestone.checkpointDigest
    ))
  }

  private func makeRenderSnapshot() -> MoleculeH2RenderSnapshot? {
    let authoritySnapshot = authority.snapshot()
    func density(_ values: H2RHFMatrix?) -> SIMD4<Float>? {
      guard let values, values.count == 4, values.allSatisfy(\.isFinite) else { return nil }
      return SIMD4<Float>(Float(values[0]), Float(values[1]), Float(values[2]), Float(values[3]))
    }
    let candidate = authoritySnapshot.candidate
    let separation = candidate?.rawSeparationAngstrom ?? authoritySnapshot.lastGood?.separationAngstrom ?? 0
    return MoleculeH2RenderSnapshot(
      bodyID: bodyID,
      candidateDensity: density(candidate?.density),
      lastGoodDensity: density(authoritySnapshot.lastGood?.density),
      residual: candidate?.residual.map(Float.init),
      separationAngstrom: Float(separation),
      disposition: authoritySnapshot.disposition,
      promotionGeneration: UInt32(clamping: authoritySnapshot.promotionGeneration),
      // The trusted field remains visible at rest and after promotion/refusal;
      // contact activity changes its expression, not whether it exists.
      active: authoritySnapshot.lastGood != nil
    )
  }

  private func remember(_ eventID: String) -> Bool {
    guard !emittedIDs.contains(eventID) else { return false }
    if emittedIDCount == Self.dedupeCapacity, let evicted = emittedIDRing[emittedIDCursor] {
      emittedIDs.remove(evicted)
    } else {
      emittedIDCount += 1
    }
    emittedIDRing[emittedIDCursor] = eventID
    emittedIDCursor = (emittedIDCursor + 1) % Self.dedupeCapacity
    emittedIDs.insert(eventID)
    return true
  }

  private func makeEventID(kind: MoleculeH2MilestoneKind, milestone: H2RHFMilestone) -> String {
    "molecule-h2-\(bodyID)-\(epochKey(milestone.contactEpoch))-\(milestone.tick)-\(milestone.promotionGeneration)-\(kind.rawValue)"
  }

  private func epochKey(_ epoch: H2RHFContactEpoch?) -> String {
    guard let epoch else { return "none" }
    switch epoch {
    case .number(let value):
      return "n-" + ((try? canonicalH2RHFNumber(value)) ?? "n-invalid")
    case .string(let value):
      var escaped = ""
      escaped.reserveCapacity(value.utf8.count)
      for scalar in value.unicodeScalars {
        switch scalar.value {
        case 0x2D, 0x2F, 0x5C: escaped.append("_")
        default: escaped.append(Character(scalar))
        }
      }
      return "s-" + escaped
    }
  }
}
