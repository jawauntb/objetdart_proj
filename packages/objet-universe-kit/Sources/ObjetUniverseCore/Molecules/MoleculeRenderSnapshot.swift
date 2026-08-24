import Foundation
import simd

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
    vibration: Float
  ) {
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
  public let bodies: UnsafeBufferPointer<MoleculeRenderBody>
}

/// Native renderers receive compound geometry and reaction state directly,
/// rather than attempting to infer it from a low-resolution scalar field.
public protocol MoleculeSnapshotProviding: AnyObject {
  func withMoleculeRenderSnapshot<T>(_ body: (MoleculeRenderSnapshot) -> T) -> T
}
