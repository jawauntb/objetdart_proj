import Foundation
import simd

/// One GPU-ready atomic identity. Every value is a projection of the
/// authoritative atomic ledger; the renderer may stylize shells and light but
/// never invent a different element, bond appetite, or excitation.
public struct AtomRenderBody: Sendable {
  public let position: SIMD2<Float>
  public let velocity: SIMD2<Float>
  public let atomicNumber: UInt32
  public let shellCount: UInt32
  public let valence: UInt32
  public let excitation: Float

  public init(
    position: SIMD2<Float>,
    velocity: SIMD2<Float>,
    atomicNumber: UInt32,
    shellCount: UInt32,
    valence: UInt32,
    excitation: Float
  ) {
    self.position = position
    self.velocity = velocity
    self.atomicNumber = atomicNumber
    self.shellCount = shellCount
    self.valence = valence
    self.excitation = excitation
  }
}

/// A covalent relation in the same bounded atom buffer. Indices, rather than
/// copied positions, keep the relation tied to the exact identities the
/// kernel currently owns.
public struct AtomRenderBond: Sendable {
  public let firstIndex: UInt32
  public let secondIndex: UInt32
  public let order: UInt32

  public init(firstIndex: UInt32, secondIndex: UInt32, order: UInt32) {
    self.firstIndex = firstIndex
    self.secondIndex = secondIndex
    self.order = order
  }
}

/// A borrowed view over the atomic kernel's fixed render records. Pointers are
/// valid only for the duration of `withAtomRenderSnapshot`; a renderer must
/// copy them into storage it already owns before returning.
public struct AtomRenderSnapshot {
  public let tick: Int
  public let elapsedSeconds: Double
  public let secondsPerTick: Double
  public let representation: Int
  public let fusionEnergy: Float
  public let bodies: UnsafeBufferPointer<AtomRenderBody>
  public let bonds: UnsafeBufferPointer<AtomRenderBond>
}

/// The atomic renderer receives real identities and relations rather than a
/// generic scalar field, matching the direct snapshot seam used by Solar.
public protocol AtomSnapshotProviding: AnyObject {
  func withAtomRenderSnapshot<T>(_ body: (AtomRenderSnapshot) -> T) -> T
}
