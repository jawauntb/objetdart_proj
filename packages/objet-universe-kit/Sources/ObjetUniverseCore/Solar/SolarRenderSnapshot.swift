import Foundation
import simd

public enum SolarBodyKind: UInt8, Codable, Sendable {
  case planet = 0
  case comet = 1
}

/// One GPU-ready body record. All values are projections of authoritative
/// doubles; rendering may interpolate `previousPosition` to `position` but
/// must never write them back into the simulation.
public struct SolarRenderBody: Sendable {
  public let id: UInt64
  /// Stable procedural material identity. It is carried separately from the
  /// palette so a blue world is not merely a differently tinted copy of its
  /// neighbor.
  public let materialSeed: UInt32
  public let kind: SolarBodyKind
  public let previousPosition: SIMD3<Float>
  public let position: SIMD3<Float>
  public let velocity: SIMD2<Float>
  public let mass: Float
  public let radius: Float
  public let color: SIMD3<Float>
  public let trailOffset: Int
  public let trailCount: Int
  public let isSelected: Bool
}

public struct SolarTrailPoint: Sendable {
  public let bodyID: UInt64
  public let position: SIMD3<Float>
  /// Zero is newest; one is the oldest retained point.
  public let age: Float
}

public struct SolarPredictionPoint: Sendable {
  public let bodyID: UInt64
  public let position: SIMD3<Float>
}

/// Non-authoritative body condensation shown while an open-sky contact is
/// still held. It disappears on cancel and becomes one real body on release.
public struct SolarAccretionPreview: Sendable {
  public let position: SIMD3<Float>
  public let radius: Float
  public let color: SIMD3<Float>
  public let progress: Float
}

public enum SolarTouchKind: UInt8, Sendable {
  case none = 0
  case star = 1
  case dust = 2
}

/// A borrowed view over the kernel's preallocated render buffers. The buffer
/// pointers are valid only for the duration of `withSolarRenderSnapshot`.
public struct SolarRenderSnapshot {
  public let tick: Int
  public let elapsedSeconds: Double
  public let secondsPerTick: Double
  public let centralMass: Float
  public let representation: Int
  public let selectedBodyID: UInt64?
  public let collisionPulse: Float
  public let collisionPosition: SIMD3<Float>
  public let touchPulse: Float
  public let touchPosition: SIMD3<Float>
  public let touchKind: SolarTouchKind
  public let accretionPreview: SolarAccretionPreview?
  public let bodies: UnsafeBufferPointer<SolarRenderBody>
  public let trailPoints: UnsafeBufferPointer<SolarTrailPoint>
  public let predictionPoints: UnsafeBufferPointer<SolarPredictionPoint>
}

public protocol SolarSnapshotProviding: AnyObject {
  /// Pure hit testing in the same normalized material frame used by semantic
  /// commands. Input may pin the returned stable ID into a drag payload.
  func solarTargetBody(at materialPoint: SemanticOrigin) -> UInt64?
  func withSolarRenderSnapshot<T>(_ body: (SolarRenderSnapshot) -> T) -> T
}
