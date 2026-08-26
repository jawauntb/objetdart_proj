import Foundation
import simd

/// The small, renderer-free identity record used by molecule hit testing.
///
/// Positions are in the molecule material's normalized world (`-1...1`). The
/// stable id, seed, and ordinal travel with the molecule; array position is
/// deliberately not part of identity and therefore cannot become a hidden
/// tie-break after a reaction removes an element.
public struct MoleculeTargetBody: Equatable, Sendable {
  public let id: UInt64
  public let seed: UInt64
  public let ordinal: UInt64
  public let compoundKey: String
  public let position: SIMD2<Double>

  public init(
    id: UInt64,
    seed: UInt64,
    ordinal: UInt64,
    compoundKey: String,
    position: SIMD2<Double>
  ) {
    self.id = id
    self.seed = seed
    self.ordinal = ordinal
    self.compoundKey = compoundKey
    self.position = position
  }
}

/// Stable association between the molecule population and the one H₂
/// subsystem. The authority target string is derived from this identity and
/// must never be inferred from array position or a repeated seed alone.
public struct MoleculeH2Binding: Codable, Equatable, Sendable {
  public let bodyID: UInt64
  public let seed: UInt64
  public let ordinal: UInt64
  public let targetID: String

  public init(bodyID: UInt64, seed: UInt64, ordinal: UInt64, targetID: String? = nil) {
    self.bodyID = bodyID
    self.seed = seed
    self.ordinal = ordinal
    self.targetID = targetID ?? "molecule-\(bodyID)"
  }
}

/// Geometry policy for molecule interaction. A hit selects a body; the
/// larger interaction radius is only used when looking for a chemistry
/// partner. Keeping the two radii distinct prevents a nearby partner from
/// stealing a touch that did not actually land on its target.
public struct MoleculeH2TargetingPolicy: Equatable, Sendable {
  public let hitRadius: Double
  public let interactionRadius: Double

  public init(hitRadius: Double = 0.18, interactionRadius: Double = 0.28) {
    precondition(hitRadius > 0 && interactionRadius >= hitRadius)
    self.hitRadius = hitRadius
    self.interactionRadius = interactionRadius
  }
}

/// The meaning selected once when a continuous material contact enters.
/// Continuation samples must use this value rather than re-running hit test.
public enum MoleculeH2ContactIntent: Equatable, Sendable {
  case h2(targetID: UInt64)
  case reaction(primaryID: UInt64, partnerID: UInt64, reaction: MoleculeKernel.Reaction)
  case other(targetID: UInt64)
  case openSky

  public var targetID: UInt64? {
    switch self {
    case .h2(let id), .other(let id): id
    case .reaction(let primary, _, _): primary
    case .openSky: nil
    }
  }

  public var partnerID: UInt64? {
    if case .reaction(_, let partner, _) = self { return partner }
    return nil
  }

  public var isH2: Bool {
    if case .h2 = self { return true }
    return false
  }
}

/// A locked target for one semantic contact epoch. A missing body is an
/// explicit terminal condition; callers must cancel or refuse, never retarget
/// from a later pointer sample.
public struct MoleculeH2InteractionEpoch: Equatable, Sendable {
  public let epoch: UInt64
  public let intent: MoleculeH2ContactIntent

  public init(epoch: UInt64, intent: MoleculeH2ContactIntent) {
    self.epoch = epoch
    self.intent = intent
  }

  public var targetID: UInt64? { intent.targetID }
  public var partnerID: UInt64? { intent.partnerID }

  public func continuation(in bodies: [MoleculeTargetBody]) -> MoleculeH2Continuation {
    switch intent {
    case .h2(let targetID), .other(let targetID):
      return bodies.contains(where: { $0.id == targetID }) ? .locked(intent) : .targetMissing
    case .reaction(let primaryID, let partnerID, _):
      let hasPrimary = bodies.contains(where: { $0.id == primaryID })
      let hasPartner = bodies.contains(where: { $0.id == partnerID })
      return hasPrimary && hasPartner ? .locked(intent) : .targetMissing
    case .openSky:
      return .locked(intent)
    }
  }
}

public enum MoleculeH2Continuation: Equatable, Sendable {
  case locked(MoleculeH2ContactIntent)
  case targetMissing
}

/// Pure target resolution shared by touch, keyboard, and assistive paths.
/// Every result is a function of the supplied bodies, point, policy, and the
/// curated reaction register; no wall clock or presentation order participates.
public enum MoleculeH2Targeting {
  static let distanceTieEpsilonForKernel = 1e-12

  public static func nearestTarget(
    at point: SIMD2<Double>,
    bodies: [MoleculeTargetBody],
    policy: MoleculeH2TargetingPolicy = .init()
  ) -> UInt64? {
    guard point.x.isFinite, point.y.isFinite else { return nil }
    let hitSquared = policy.hitRadius * policy.hitRadius
    var nearestID: UInt64?
    var nearestDistance = Double.greatestFiniteMagnitude
    for body in bodies {
      let dx = body.position.x - point.x
      let dy = body.position.y - point.y
      let distance = dx * dx + dy * dy
      guard distance.isFinite, distance <= hitSquared else { continue }
      let isCloser = distance < nearestDistance - distanceTieEpsilonForKernel
      let isStableTie = abs(distance - nearestDistance) <= distanceTieEpsilonForKernel
        && body.id < (nearestID ?? UInt64.max)
      if isCloser || isStableTie {
        nearestID = body.id
        nearestDistance = distance
      }
    }
    return nearestID
  }

  public static func resolve(
    at point: SIMD2<Double>,
    bodies: [MoleculeTargetBody],
    policy: MoleculeH2TargetingPolicy = .init()
  ) -> MoleculeH2ContactIntent {
    guard let targetID = nearestTarget(at: point, bodies: bodies, policy: policy),
          let target = bodies.first(where: { $0.id == targetID }) else {
      return .openSky
    }
    guard target.compoundKey == "H2" else { return .other(targetID: targetID) }

    let interactionSquared = policy.interactionRadius * policy.interactionRadius
    var partner: MoleculeTargetBody?
    var partnerDistance = Double.greatestFiniteMagnitude
    for candidate in bodies where candidate.id != target.id {
      let reaction = MoleculeKernel.reactionForCompoundKeys(target.compoundKey, candidate.compoundKey)
      guard !reaction.products.isEmpty else { continue }
      let dx = candidate.position.x - target.position.x
      let dy = candidate.position.y - target.position.y
      let distance = dx * dx + dy * dy
      guard distance.isFinite, distance <= interactionSquared else { continue }
      let isCloser = distance < partnerDistance - distanceTieEpsilonForKernel
      let isStableTie = abs(distance - partnerDistance) <= distanceTieEpsilonForKernel
        && candidate.id < (partner?.id ?? UInt64.max)
      if isCloser || isStableTie {
        partner = candidate
        partnerDistance = distance
      }
    }
    if let partner {
      return .reaction(
        primaryID: target.id,
        partnerID: partner.id,
        reaction: MoleculeKernel.reactionForCompoundKeys(target.compoundKey, partner.compoundKey)
      )
    }
    return .h2(targetID: target.id)
  }

  public static func beginEpoch(
    epoch: UInt64,
    at point: SIMD2<Double>,
    bodies: [MoleculeTargetBody],
    policy: MoleculeH2TargetingPolicy = .init()
  ) -> MoleculeH2InteractionEpoch {
    MoleculeH2InteractionEpoch(epoch: epoch, intent: resolve(at: point, bodies: bodies, policy: policy))
  }
}
