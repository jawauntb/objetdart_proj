import Foundation
import simd

/// The immutable compact H₂ record carried alongside the molecule body
/// snapshot. It contains only authority output and stable identity; a Metal
/// renderer may project it, but cannot use it to solve, support-check, or
/// promote a candidate.
public struct MoleculeH2RenderSnapshot: Sendable {
  public let bodyID: UInt64
  public let candidateDensity: SIMD4<Float>?
  public let lastGoodDensity: SIMD4<Float>?
  public let residual: Float?
  public let separationAngstrom: Float
  public let disposition: H2RHFDisposition
  public let promotionGeneration: UInt32
  public let active: Bool

  public init(
    bodyID: UInt64,
    candidateDensity: SIMD4<Float>? = nil,
    lastGoodDensity: SIMD4<Float>?,
    residual: Float? = nil,
    separationAngstrom: Float,
    disposition: H2RHFDisposition,
    promotionGeneration: UInt32 = 0,
    active: Bool
  ) {
    self.bodyID = bodyID
    self.candidateDensity = candidateDensity
    self.lastGoodDensity = lastGoodDensity
    self.residual = residual
    self.separationAngstrom = separationAngstrom
    self.disposition = disposition
    self.promotionGeneration = promotionGeneration
    self.active = active
  }
}

/// The geometry family that gives a molecule its visual grammar. It is a
/// projection of the compound register, not an invented render-only label.
public enum MoleculeRenderShape: UInt32, Equatable, Sendable {
  case bent
  case linear
  case tetrahedral
  case trigonal
  case diatomic
  case ionic
}

/// One GPU-ready molecule, borrowed from the authoritative chemistry ledger.
/// Compound index and shape stay explicit because water, methane, and salt
/// cannot be recovered faithfully from a scalar concentration field.
public struct MoleculeRenderBody: Sendable {
  /// Stable authority identity copied into the immutable render snapshot.
  /// Renderers may use it for focus continuity, but never manufacture a new
  /// identity from a transient array slot.
  public let id: UInt64
  public let seed: UInt64
  public let ordinal: UInt64
  public let position: SIMD2<Float>
  public let velocity: SIMD2<Float>
  public let compoundIndex: UInt32
  public let shape: MoleculeRenderShape
  public let atomCount: UInt32
  public let vibration: Float

  public init(
    position: SIMD2<Float>,
    velocity: SIMD2<Float>,
    compoundIndex: UInt32,
    shape: MoleculeRenderShape,
    atomCount: UInt32,
    vibration: Float,
    id: UInt64 = 0,
    seed: UInt64 = 0,
    ordinal: UInt64 = 0
  ) {
    self.id = id
    self.seed = seed
    self.ordinal = ordinal
    self.position = position
    self.velocity = velocity
    self.compoundIndex = compoundIndex
    self.shape = shape
    self.atomCount = atomCount
    self.vibration = vibration
  }
}

/// A borrowed view over the molecule kernel's fixed presentation records.
/// Pointers are valid only inside `withMoleculeRenderSnapshot`; renderers copy
/// into their preallocated GPU storage before the closure returns.
public struct MoleculeRenderSnapshot {
  public let tick: Int
  public let elapsedSeconds: Double
  public let secondsPerTick: Double
  public let representation: Int
  public let reactionEnergy: Float
  /// The optional H₂ record is part of the same immutable handoff, so a
  /// caller cannot submit molecule geometry while silently dropping the
  /// scientific field.
  public let h2: MoleculeH2RenderSnapshot?
  public let bodies: UnsafeBufferPointer<MoleculeRenderBody>

  public init(
    tick: Int,
    elapsedSeconds: Double,
    secondsPerTick: Double,
    representation: Int,
    reactionEnergy: Float,
    h2: MoleculeH2RenderSnapshot? = nil,
    bodies: UnsafeBufferPointer<MoleculeRenderBody>
  ) {
    self.tick = tick
    self.elapsedSeconds = elapsedSeconds
    self.secondsPerTick = secondsPerTick
    self.representation = representation
    self.reactionEnergy = reactionEnergy
    self.h2 = h2
    self.bodies = bodies
  }
}

/// Native renderers receive compound geometry and reaction state directly,
/// rather than attempting to infer it from a low-resolution scalar field.
public protocol MoleculeSnapshotProviding: AnyObject {
  func withMoleculeRenderSnapshot<T>(_ body: (MoleculeRenderSnapshot) -> T) -> T
}
