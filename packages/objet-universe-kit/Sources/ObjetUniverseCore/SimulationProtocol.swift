import Foundation

public enum SceneID: String, CaseIterable, Codable, Sendable {
  case wave
  case cell
  case solar
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

public struct SemanticCommand: Equatable, Codable, Sendable {
  public let id: String
  public let verb: SemanticVerb
  public let at: TimeInterval
  public let intensity: Double
  public let origin: SemanticOrigin?

  public init(
    id: String,
    verb: SemanticVerb,
    at: TimeInterval,
    intensity: Double = 1,
    origin: SemanticOrigin? = nil
  ) {
    self.id = id
    self.verb = verb
    self.at = at
    self.intensity = intensity
    self.origin = origin
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
