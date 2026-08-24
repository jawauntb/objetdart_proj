#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif

public final class RenderHost {
  public private(set) var clockStarts = 0
  public private(set) var renderedFrameCount = 0
  public private(set) var submittedFieldCount = 0
  public private(set) var submittedSolarCount = 0
  public var activeRendererCount: Int { running ? renderers.count : 0 }

  private var renderers: [RendererKind: UniverseRenderer] = [:]
  private var running = false
  private var reducedMotion = false

  public init() {}

  public func install(_ renderer: UniverseRenderer) {
    renderers[renderer.kind]?.retire()
    renderers[renderer.kind] = renderer
    (renderer as? ReducedMotionRenderer)?.setReducedMotion(reducedMotion)
    renderer.prepare()
    if running { renderer.resume() }
  }

  public func resume() {
    guard !running else { return }
    running = true
    clockStarts += 1
    renderers.values.forEach { $0.resume() }
  }

  /// Hand the frame's authoritative field to every renderer whose material is
  /// that field. Submitting while suspended is a no-op: a suspended renderer
  /// has released its GPU resources and must not be asked to upload into them.
  public func submitField(_ submission: FieldSubmission) {
    guard running else { return }
    for renderer in renderers.values {
      (renderer as? FieldSurfaceRenderer)?.submitField(submission)
    }
    submittedFieldCount += 1
  }

  /// Upload one bounded solar snapshot to the installed solar renderer. As
  /// with field submission, a suspended host rejects the upload because the
  /// renderer may already have released its GPU resources.
  public func submitSolar(_ snapshot: SolarRenderSnapshot) {
    guard running else { return }
    for renderer in renderers.values {
      (renderer as? SolarSystemRenderer)?.submitSolar(snapshot)
    }
    submittedSolarCount += 1
  }

  public func orientSolarCamera(
    by translation: SemanticVector,
    velocity: SemanticVector,
    phase: SemanticGesturePhase
  ) {
    guard running else { return }
    for renderer in renderers.values {
      (renderer as? SolarCameraRenderer)?.orientSolarCamera(
        by: translation,
        velocity: velocity,
        phase: phase
      )
    }
  }

  /// Preserve the kernel's clock while asking motion-aware materials to hold
  /// decorative oscillation at a stable visual detent.
  public func setReducedMotion(_ enabled: Bool) {
    guard reducedMotion != enabled else { return }
    reducedMotion = enabled
    for renderer in renderers.values {
      (renderer as? ReducedMotionRenderer)?.setReducedMotion(enabled)
    }
  }

  public func projectSolarMaterialPoint(_ point: SemanticOrigin) -> SemanticOrigin {
    guard running else { return point }
    for renderer in renderers.values {
      if let camera = renderer as? SolarCameraRenderer {
        return camera.projectSolarMaterialPoint(point)
      }
    }
    return point
  }

  public func projectSolarMaterialVector(_ vector: SemanticVector) -> SemanticVector {
    guard running else { return vector }
    for renderer in renderers.values {
      if let camera = renderer as? SolarCameraRenderer {
        return camera.projectSolarMaterialVector(vector)
      }
    }
    return vector
  }

  public func render(interpolation: Double) {
    guard running else { return }
    let clamped = min(1, max(0, interpolation))
    renderers.values.forEach { $0.render(interpolation: clamped) }
    renderedFrameCount += 1
  }

  public func suspend() {
    guard running else { return }
    running = false
    renderers.values.forEach { $0.suspend() }
  }

  public func retireAll() {
    suspend()
    renderers.values.forEach { $0.retire() }
    renderers.removeAll()
  }
}
