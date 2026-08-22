import Foundation

public enum SceneID: String, CaseIterable, Codable, Sendable {
  case wave
  case cell
  case solar
  case molecules
  case atoms
}

/// Mirrors `SemanticVerb` in the versioned TypeScript contracts. Renderer details
/// never cross this semantic boundary.
public enum SemanticVerb: String, CaseIterable, Codable, Sendable {
  case material
  case stepBack = "step-back"
  case tutti
  case train
  case scale
  case lens
  case season
  case pan
  case weather
  case timeDilation = "time-dilation"
  case grow
  case ceremony
  case agitate
  case gravity
  case wake
  case night
  case breath
}

/// Where on the material a command landed, in the material's own normalized
/// frame: `(0, 0)` is its top-left cell and `(1, 1)` its bottom-right. It is
/// not a screen coordinate — the input layer projects through
/// `MaterialProjection` before the command is built, so a renderer's crop
/// never reaches the kernel.
///
/// A command without an origin is a command the hand did not place: a vessel
/// verb, an assistive activation, a system act. Each medium decides for
/// itself what the middle of it means.
public struct SemanticOrigin: Equatable, Codable, Sendable {
  public let x: Double
  public let y: Double

  public init(x: Double, y: Double) {
    self.x = SemanticOrigin.bounded(x)
    self.y = SemanticOrigin.bounded(y)
  }

  /// The middle of whatever medium receives it.
  public static let centre = SemanticOrigin(x: 0.5, y: 0.5)

  private static func bounded(_ value: Double) -> Double {
    guard value.isFinite else { return 0.5 }
    return min(max(value, 0), 1)
  }
}

/// The lifecycle of a continuous semantic contact. The gesture recognizer's
/// private states never cross the action boundary; these four phases are the
/// durable meaning shared by touch, Pencil, keyboard and assistive input.
public enum SemanticGesturePhase: String, Equatable, Codable, Sendable {
  case enter
  case tick
  case release
  case cancel
}

/// Typed data for a contact that persists. Pressure stays normalized, Pencil
/// angles remain finite, and duration is monotone-capable without turning the
/// continuous gesture into a tier switch.
public struct SemanticContactPayload: Equatable, Codable, Sendable {
  public let phase: SemanticGesturePhase
  public let point: SemanticOrigin
  public let durationSeconds: Double
  public let normalizedPressure: Double
  public let azimuth: Double
  public let altitude: Double
  public let targetBodyID: UInt64?

  public init(
    phase: SemanticGesturePhase,
    point: SemanticOrigin,
    durationSeconds: Double,
    normalizedPressure: Double = 0,
    azimuth: Double = 0,
    altitude: Double = 0,
    targetBodyID: UInt64? = nil
  ) {
    self.phase = phase
    self.point = point
    self.durationSeconds = durationSeconds.isFinite ? max(0, durationSeconds) : 0
    self.normalizedPressure = normalizedPressure.isFinite ? min(max(normalizedPressure, 0), 1) : 0
    self.azimuth = azimuth.isFinite ? azimuth : 0
    self.altitude = altitude.isFinite ? min(max(altitude, -Double.pi / 2), Double.pi / 2) : 0
    self.targetBodyID = targetBodyID
  }
}

/// A finite vector in the material's normalized coordinate system. Invalid
/// sensor values resolve to zero at the boundary so NaN can never poison a
/// replay or a physics checkpoint.
public struct SemanticVector: Equatable, Codable, Sendable {
  public let x: Double
  public let y: Double

  public init(x: Double, y: Double) {
    self.x = x.isFinite ? x : 0
    self.y = y.isFinite ? y : 0
  }

  public static let zero = SemanticVector(x: 0, y: 0)
}

/// Typed data carried by a drag. `point` is the current material-space
/// contact, `translation` is measured from its enter point, `velocity` is in
/// material units per second, and `targetBodyID` pins a grip to a stable
/// simulation identity rather than making every tick repeat hit-testing.
public struct SemanticDragPayload: Equatable, Codable, Sendable {
  public let phase: SemanticGesturePhase
  public let point: SemanticOrigin
  public let translation: SemanticVector
  public let velocity: SemanticVector
  public let targetBodyID: UInt64?

  public init(
    phase: SemanticGesturePhase,
    point: SemanticOrigin,
    translation: SemanticVector = .zero,
    velocity: SemanticVector = .zero,
    targetBodyID: UInt64? = nil
  ) {
    self.phase = phase
    self.point = point
    self.translation = translation
    self.velocity = velocity
    self.targetBodyID = targetBodyID
  }
}

/// Signed device attitude in degrees. Keeping both axes preserves the vessel's
/// exact observation for replay even when a particular medium consumes only
/// one calibrated axis. Values are finite and bounded to Core Motion's
/// meaningful attitude range.
public struct SemanticVesselPayload: Equatable, Codable, Sendable {
  public let betaDegrees: Double
  public let gammaDegrees: Double

  public init(betaDegrees: Double, gammaDegrees: Double) {
    self.betaDegrees = Self.boundedDegrees(betaDegrees)
    self.gammaDegrees = Self.boundedDegrees(gammaDegrees)
  }

  private static func boundedDegrees(_ value: Double) -> Double {
    guard value.isFinite else { return 0 }
    return min(max(value, -180), 180)
  }
}

/// Finite, version-one semantic payload. Adding optional typed members keeps
/// the verb vocabulary stable while letting richer rooms replay continuous
/// input without persisting renderer or recognizer implementation details.
public struct SemanticCommandPayload: Equatable, Codable, Sendable {
  public let contact: SemanticContactPayload?
  public let drag: SemanticDragPayload?
  public let vessel: SemanticVesselPayload?

  public init(
    contact: SemanticContactPayload? = nil,
    drag: SemanticDragPayload? = nil,
    vessel: SemanticVesselPayload? = nil
  ) {
    self.contact = contact
    self.drag = drag
    self.vessel = vessel
  }

  public static let empty = SemanticCommandPayload()
}

public struct SemanticCommand: Equatable, Codable, Sendable {
  public let id: String
  public let verb: SemanticVerb
  public let at: TimeInterval
  public let intensity: Double
  public let origin: SemanticOrigin?
  public let payload: SemanticCommandPayload

  public init(
    id: String,
    verb: SemanticVerb,
    at: TimeInterval,
    intensity: Double = 1,
    origin: SemanticOrigin? = nil,
    payload: SemanticCommandPayload = .empty
  ) {
    self.id = id
    self.verb = verb
    self.at = at.isFinite ? at : 0
    self.intensity = intensity.isFinite ? min(max(intensity, 0), 1) : 0
    self.origin = origin
    self.payload = payload
  }
}

public struct KernelCheckpoint: Equatable, Codable, Sendable {
  public let scene: SceneID
  public let tick: Int
  public let digest: String

  public init(scene: SceneID, tick: Int, digest: String) {
    self.scene = scene
    self.tick = tick
    self.digest = digest
  }
}

public struct KernelOutput: Equatable, Sendable {
  public let stable: Bool
  public let checkpoint: KernelCheckpoint

  public init(stable: Bool, checkpoint: KernelCheckpoint) {
    self.stable = stable
    self.checkpoint = checkpoint
  }
}

public enum SimulationOutcomeKind: String, Equatable, Codable, Sendable {
  case created
  case selected
  case orbitLocked = "orbit-locked"
  case collision
  case consumed
  case escaped
}

/// An authoritative, renderer-free result emitted by physics. Sensory buses
/// translate these facts after the step; they never guess them from gestures.
public struct SimulationOutcome: Equatable, Codable, Sendable {
  public let id: String
  public let kind: SimulationOutcomeKind
  public let tick: Int
  public let energy: Double
  public let intensity: Double
  public let bodyIDs: [UInt64]
  public let frequencyHz: Double?

  public init(
    id: String,
    kind: SimulationOutcomeKind,
    tick: Int,
    energy: Double,
    intensity: Double,
    bodyIDs: [UInt64],
    frequencyHz: Double? = nil
  ) {
    self.id = id
    self.kind = kind
    self.tick = max(0, tick)
    self.energy = energy.isFinite ? energy : 0
    self.intensity = intensity.isFinite ? min(max(intensity, 0), 1) : 0
    self.bodyIDs = Array(bodyIDs.prefix(2))
    if let frequencyHz, frequencyHz.isFinite, frequencyHz >= 20, frequencyHz <= 20_000 {
      self.frequencyHz = frequencyHz
    } else {
      self.frequencyHz = nil
    }
  }
}

/// Closure-scoped drain keeps the queue bounded and avoids copying on a frame
/// with no outcomes. Values are ordered exactly as the kernel produced them.
public protocol SimulationOutcomeProducing: AnyObject {
  func drainSimulationOutcomes<T>(_ body: (UnsafeBufferPointer<SimulationOutcome>) -> T) -> T
}

public protocol SimulationKernel: AnyObject {
  var scene: SceneID { get }
  func prepare()
  func activate()
  func freeze()
  func retire()
  func apply(_ command: SemanticCommand) -> KernelOutput
  func advance(ticks: Int) -> KernelOutput
  /// Whether this medium says the verb *in its own material*. A wave tank has
  /// no seasons, so `season` reaches it and changes nothing; the input layer
  /// asks first so it can answer in the hand and the ear instead of leaving
  /// the gesture silent. Mirrors the web fallback in
  /// `src/lib/gesture/defaults.ts`: never nothing, never loud.
  func expresses(_ verb: SemanticVerb) -> Bool
}

/// A simulation that can hand one scalar material field to the shared native
/// renderer. The field is a projection of the kernel state; it is never the
/// authority itself and it never crosses into React Native.
public protocol SurfaceSimulationKernel: SimulationKernel {
  var secondsPerTick: TimeInterval { get }
  var elapsedSeconds: Double { get }
  var exposure: Double { get }
  var materialKind: Int { get }
  /// Integer projection index consumed by the shared renderer. Concrete
  /// kernels may expose a richer enum internally (the wave kernel does).
  var representationIndex: Int { get }
  func setRepresentation(_ rawValue: Int)
  func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T
}

extension SimulationKernel {
  /// A kernel that has not declared its vocabulary expresses nothing. Saying
  /// so is the safe default: an undeclared verb lands as a sensory answer
  /// rather than as physics nobody wrote.
  public func expresses(_ verb: SemanticVerb) -> Bool { false }
}

public enum CommandDisposition: Equatable, Sendable {
  /// The command is durable at the host boundary and will be applied on its fixed tick.
  case scheduled
  case committed
  case quarantined
  case rejected
}

public enum HostBoundary: String, Equatable, Sendable {
  case previewed
  case durablyAppended
  case authoritativelyApplied
  case checkpointPromoted
  case uiAcknowledged
  case sensoryConfirmed
  case outputQuarantined
}

public struct UniverseTelemetry: Equatable, Sendable {
  public internal(set) var logicalTick = 0
  public internal(set) var handoffs = 0
  public internal(set) var quarantinedOutputs = 0
  public internal(set) var droppedFrameDebt = 0
}

public enum UniverseHostError: Error, Equatable {
  case factoryReturnedWrongScene(expected: SceneID, actual: SceneID)
}
