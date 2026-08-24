#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif

/// The test double for the renderer lifecycle. It counts calls and draws
/// nothing, which is exactly why no shipping surface may install it: a probe
/// behind the persistent view is a blank screen.
public final class RendererProbe: FieldSurfaceRenderer, AtomSystemRenderer, MoleculeSystemRenderer, SolarSystemRenderer, SolarCameraRenderer, ReducedMotionRenderer {
  public let kind: RendererKind
  public private(set) var prepareCount = 0
  public private(set) var resumeCount = 0
  public private(set) var renderCount = 0
  public private(set) var lastInterpolation: Double?
  public private(set) var submittedFieldCount = 0
  public private(set) var lastFieldWidth: Int?
  public private(set) var lastFieldHeight: Int?
  public private(set) var lastExposure: Double?
  public private(set) var submittedAtomCount = 0
  public private(set) var lastAtomBodyCount: Int?
  public private(set) var lastAtomTick: Int?
  public private(set) var submittedMoleculeCount = 0
  public private(set) var lastMoleculeBodyCount: Int?
  public private(set) var lastMoleculeTick: Int?
  public private(set) var submittedSolarCount = 0
  public private(set) var lastSolarBodyCount: Int?
  public private(set) var lastSolarTick: Int?
  public private(set) var solarCameraIntentCount = 0
  public private(set) var reducedMotion: Bool?
  public private(set) var suspendCount = 0
  public private(set) var retireCount = 0

  public init(kind: RendererKind) { self.kind = kind }
  public func prepare() { prepareCount += 1 }
  public func resume() { resumeCount += 1 }
  public func render(interpolation: Double) {
    renderCount += 1
    lastInterpolation = interpolation
  }
  public func submitField(_ submission: FieldSubmission) {
    submittedFieldCount += 1
    lastFieldWidth = submission.width
    lastFieldHeight = submission.height
    lastExposure = submission.exposure
  }
  public func submitAtoms(_ snapshot: AtomRenderSnapshot) {
    submittedAtomCount += 1
    lastAtomBodyCount = snapshot.bodies.count
    lastAtomTick = snapshot.tick
  }
  public func submitMolecules(_ snapshot: MoleculeRenderSnapshot) {
    submittedMoleculeCount += 1
    lastMoleculeBodyCount = snapshot.bodies.count
    lastMoleculeTick = snapshot.tick
  }
  public func submitSolar(_ snapshot: SolarRenderSnapshot) {
    submittedSolarCount += 1
    lastSolarBodyCount = snapshot.bodies.count
    lastSolarTick = snapshot.tick
  }
  public func orientSolarCamera(
    by translation: SemanticVector,
    velocity: SemanticVector,
    phase: SemanticGesturePhase
  ) {
    solarCameraIntentCount += 1
  }
  public func projectSolarMaterialPoint(_ point: SemanticOrigin) -> SemanticOrigin { point }
  public func projectSolarMaterialVector(_ vector: SemanticVector) -> SemanticVector { vector }
  public func setReducedMotion(_ enabled: Bool) { reducedMotion = enabled }

  public func suspend() { suspendCount += 1 }
  public func retire() { retireCount += 1 }
}
