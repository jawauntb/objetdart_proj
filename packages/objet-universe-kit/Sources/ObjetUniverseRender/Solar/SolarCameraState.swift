import Foundation
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif

/// Presentation-only camera motion. It is deliberately absent from kernel
/// checkpoints: dragging open sky changes how a system is held, never the
/// system itself.
struct SolarCameraState: Equatable {
  private(set) var yaw = 0.0
  private(set) var pitch = 0.12
  private var enterYaw = 0.0
  private var enterPitch = 0.12
  private var yawVelocity = 0.0
  private var pitchVelocity = 0.0

  private static let yawDecayPerSixtieth = 0.91
  private static let pitchDecayPerSixtieth = 0.88
  private static let yawDecayRate = -log(yawDecayPerSixtieth) * 60
  private static let pitchDecayRate = -log(pitchDecayPerSixtieth) * 60

  mutating func apply(
    translation: SemanticVector,
    velocity: SemanticVector,
    phase: SemanticGesturePhase
  ) {
    switch phase {
    case .enter:
      enterYaw = yaw
      enterPitch = pitch
      yawVelocity = 0
      pitchVelocity = 0
    case .tick:
      yaw = Self.wrapped(enterYaw + translation.x * Double.pi * 0.72)
      pitch = Self.clampedPitch(enterPitch + translation.y * 0.82)
    case .release:
      yaw = Self.wrapped(enterYaw + translation.x * Double.pi * 0.72)
      pitch = Self.clampedPitch(enterPitch + translation.y * 0.82)
      yawVelocity = min(max(velocity.x * 0.018, -0.055), 0.055) * 60
      pitchVelocity = min(max(velocity.y * 0.009, -0.025), 0.025) * 60
    case .cancel:
      yaw = enterYaw
      pitch = enterPitch
      yawVelocity = 0
      pitchVelocity = 0
    }
  }

  mutating func advancePresentationFrame(deltaSeconds rawDelta: TimeInterval) {
    let delta = min(max(rawDelta.isFinite ? rawDelta : 0, 0), 0.1)
    guard delta > 0 else { return }
    let yawDecay = exp(-Self.yawDecayRate * delta)
    let pitchDecay = exp(-Self.pitchDecayRate * delta)
    yaw = Self.wrapped(yaw + yawVelocity * (1 - yawDecay) / Self.yawDecayRate)
    pitch = Self.clampedPitch(pitch + pitchVelocity * (1 - pitchDecay) / Self.pitchDecayRate)
    yawVelocity *= yawDecay
    pitchVelocity *= pitchDecay
    if abs(yawVelocity) < 0.003 { yawVelocity = 0 }
    if abs(pitchVelocity) < 0.003 { pitchVelocity = 0 }
  }

  /// `MaterialProjection` has already applied the viewport's aspect cover.
  /// This step inverts the remaining pitch and yaw from the solar shader.
  func projectMaterialPoint(_ point: SemanticOrigin) -> SemanticOrigin {
    let scale = SolarPhysics.maximumSemiMajorAxis
    let pitched = SIMD2(
      (point.x * 2 - 1) * scale,
      (point.y * 2 - 1) * scale / max(cos(pitch), 0.2)
    )
    let world = Self.rotate(pitched, by: -yaw)
    return SemanticOrigin(
      x: world.x / (scale * 2) + 0.5,
      y: world.y / (scale * 2) + 0.5
    )
  }

  func projectMaterialVector(_ vector: SemanticVector) -> SemanticVector {
    let pitched = SIMD2(vector.x, vector.y / max(cos(pitch), 0.2))
    let world = Self.rotate(pitched, by: -yaw)
    return SemanticVector(x: world.x, y: world.y)
  }

  private static func clampedPitch(_ value: Double) -> Double { min(max(value, -0.42), 0.62) }
  private static func wrapped(_ value: Double) -> Double { atan2(sin(value), cos(value)) }
  private static func rotate(_ value: SIMD2<Double>, by angle: Double) -> SIMD2<Double> {
    let cosine = cos(angle)
    let sine = sin(angle)
    return SIMD2(cosine * value.x - sine * value.y, sine * value.x + cosine * value.y)
  }
}
