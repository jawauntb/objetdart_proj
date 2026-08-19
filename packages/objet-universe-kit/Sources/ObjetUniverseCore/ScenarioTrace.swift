import Foundation

/// Versioned, deterministic recording of a native scenario. Renderer details
/// never cross this boundary; visible frames are proven downstream against
/// the recorded actions, checkpoints, and signposts.
public struct ScenarioTrace: Codable, Equatable, Sendable {
  public static let traceVersion = 1

  public let seed: String
  public let modelVersion: String
  public let scene: SceneID
  public let presentationHz: Int
  public let startedAtLogicalTick: Int
  public private(set) var endedAtLogicalTick: Int
  public private(set) var actions: [RecordedAction]
  public private(set) var checkpoints: [KernelCheckpoint]
  public private(set) var canonicalStateDigest: String

  public init(
    seed: String,
    modelVersion: String,
    scene: SceneID,
    presentationHz: Int,
    startedAtLogicalTick: Int = 0
  ) {
    precondition(presentationHz > 0, "presentation Hz must be positive")
    self.seed = seed
    self.modelVersion = modelVersion
    self.scene = scene
    self.presentationHz = presentationHz
    self.startedAtLogicalTick = startedAtLogicalTick
    self.endedAtLogicalTick = startedAtLogicalTick
    self.actions = []
    self.checkpoints = []
    self.canonicalStateDigest = "empty"
  }

  public var traceVersion: Int { Self.traceVersion }

  public struct RecordedAction: Codable, Equatable, Sendable {
    public let ordinal: Int
    public let atMs: Double
    public let logicalTick: Int
    public let command: SemanticCommand

    public init(ordinal: Int, atMs: Double, logicalTick: Int, command: SemanticCommand) {
      self.ordinal = ordinal
      self.atMs = ScenarioTrace.quantizeMs(atMs)
      self.logicalTick = logicalTick
      self.command = command
    }
  }

  /// Quantize wall-clock intent to 1/1000 ms so cross-device recordings never
  /// disagree on trailing floating-point noise.
  public static func quantizeMs(_ atMs: Double) -> Double {
    guard atMs.isFinite else { return 0 }
    return (atMs * 1000).rounded() / 1000
  }

  public mutating func record(
    command: SemanticCommand,
    at logicalTick: Int,
    atMs: Double
  ) {
    let ordinal = actions.count
    actions.append(.init(ordinal: ordinal, atMs: atMs, logicalTick: logicalTick, command: command))
    if logicalTick > endedAtLogicalTick { endedAtLogicalTick = logicalTick }
  }

  public mutating func record(checkpoint: KernelCheckpoint) {
    if let last = checkpoints.last, last == checkpoint { return }
    checkpoints.append(checkpoint)
    if checkpoint.tick > endedAtLogicalTick { endedAtLogicalTick = checkpoint.tick }
    canonicalStateDigest = checkpoint.digest
  }

  public mutating func finalize(atLogicalTick tick: Int, digest: String) {
    if tick > endedAtLogicalTick { endedAtLogicalTick = tick }
    canonicalStateDigest = digest
  }
}

/// One entry in the bounded 64-slot signpost ring that the host emits along
/// with the trace. Signposts are distinct from `HostBoundary` because they
/// carry logical-tick + wall-time-delta metadata.
public struct HostSignpost: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, CaseIterable, Sendable {
    case actionPreviewed
    case actionDurablyAppended
    case authoritativelyApplied
    case checkpointPromoted
    case uiAcknowledged
    case audioScheduled
    case hapticEmitted
    case sensoryConfirmed
    case outputQuarantined
    case bridgeCrossed
    case memorySnapshot
    case energySnapshot
    case thermalState
  }

  public let kind: Kind
  public let logicalTick: Int
  /// Monotonic wall-clock offset in microseconds from scenario start. Never
  /// derived from `Date()`; must come from `ProcessInfo.systemUptime` or
  /// `mach_absolute_time`.
  public let wallOffsetMicros: Int64
  public let actionId: String?
  public let payload: [String: SignpostPayloadValue]?

  public init(
    kind: Kind,
    logicalTick: Int,
    wallOffsetMicros: Int64,
    actionId: String? = nil,
    payload: [String: SignpostPayloadValue]? = nil
  ) {
    self.kind = kind
    self.logicalTick = logicalTick
    self.wallOffsetMicros = wallOffsetMicros
    self.actionId = actionId
    self.payload = payload
  }
}

/// Minimal payload sum type; kept free of NaN/Inf and free of renderer keys
/// so the schema in `docs/native/evidence-schema.md` survives round-trip.
public enum SignpostPayloadValue: Codable, Equatable, Sendable {
  case string(String)
  case integer(Int64)
  case double(Double)
  case bool(Bool)

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let value = try? container.decode(Int64.self) { self = .integer(value); return }
    if let value = try? container.decode(Double.self) {
      guard value.isFinite else {
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "signpost payload disallows NaN/Inf")
      }
      self = .double(value); return
    }
    if let value = try? container.decode(Bool.self) { self = .bool(value); return }
    let value = try container.decode(String.self)
    self = .string(value)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value): try container.encode(value)
    case .integer(let value): try container.encode(value)
    case .double(let value):
      guard value.isFinite else {
        throw EncodingError.invalidValue(value, .init(codingPath: encoder.codingPath, debugDescription: "signpost payload disallows NaN/Inf"))
      }
      try container.encode(value)
    case .bool(let value): try container.encode(value)
    }
  }
}

/// Bounded signpost ring; matches `UniverseHost.observabilityCapacity`. Overflow
/// is reported once (`overflowed == true`) and dropped rather than losing the
/// most-recent evidence.
public struct SignpostRing: Sendable {
  public private(set) var items: [HostSignpost] = []
  public private(set) var overflowed = false
  public let capacity: Int

  public init(capacity: Int = 64) {
    precondition(capacity > 0)
    self.capacity = capacity
  }

  public mutating func append(_ signpost: HostSignpost) {
    if items.count >= capacity {
      overflowed = true
      items.removeFirst()
    }
    items.append(signpost)
  }

  public func snapshot() -> [HostSignpost] { items }
}

/// Scenario envelope written to disk. The JSON produced by encoding this
/// value is the exact shape `scripts/native/compare-cross-language-fixtures.mjs`
/// consumes.
public struct ScenarioEnvelope: Codable, Equatable, Sendable {
  public let bundleVersion: Int
  public let trace: ScenarioTrace
  public let signposts: [HostSignpost]

  public init(trace: ScenarioTrace, signposts: [HostSignpost]) {
    self.bundleVersion = ScenarioTrace.traceVersion
    self.trace = trace
    self.signposts = signposts
  }

  public func encoded() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
    return try encoder.encode(self)
  }
}
