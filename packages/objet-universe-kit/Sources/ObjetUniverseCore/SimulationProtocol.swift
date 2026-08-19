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

public struct SemanticCommand: Equatable, Codable, Sendable {
  public let id: String
  public let verb: SemanticVerb
  public let at: TimeInterval
  public let intensity: Double

  public init(id: String, verb: SemanticVerb, at: TimeInterval, intensity: Double = 1) {
    self.id = id
    self.verb = verb
    self.at = at
    self.intensity = intensity
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
