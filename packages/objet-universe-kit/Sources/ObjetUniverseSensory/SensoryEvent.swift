import Foundation

/// The three senses the shared sensory bus knows about. Visual scientific
/// feedback is authoritative — muting audio or haptics never removes it from
/// the enabled set. Matches `Sense` in `@objet/universe-contracts`.
public enum SensorySense: String, CaseIterable, Sendable, Codable {
  case visual
  case audio
  case haptic
}

/// Haptic and audio primitives mirrored from web `src/lib/haptics.ts`. A
/// signature is a *shape*, not an intensity; intensity always comes from
/// event energy, never from a random per-primitive amplitude.
public enum SensorySignature: String, CaseIterable, Sendable, Codable {
  case tap
  case ripple
  case chop
  case roll
  case storm
  case detent
  case crossing
  case lens
  case bloom
}

/// Snapshot of the sole authority clock (`UniverseClock`) at the instant an
/// authoritative kernel output is produced. The host packs one of these into
/// every `SensoryEvent` so state, render, audio, and haptic derive from the
/// same fixed tick + wall-clock offset — never a second clock.
public struct SensoryClock: Equatable, Sendable, Codable {
  /// Fixed-step tick from `UniverseClock.logicalTick` at the moment of the
  /// authoritative output.
  public let logicalTick: Int
  /// Wall-clock lead time (seconds) between "now" and the intended onset.
  /// Zero means "as soon as possible on the audio graph"; positive values
  /// schedule ahead of time so audio + haptic can align to the visual frame.
  public let wallOffset: TimeInterval

  public init(logicalTick: Int, wallOffset: TimeInterval = 0) {
    precondition(wallOffset.isFinite)
    self.logicalTick = logicalTick
    self.wallOffset = wallOffset
  }
}

/// The declared skew budget between the authoritative onset (from the clock)
/// and the measured onset (from the bus). 20 ms is the cross-modal binding
/// window for iPhone speakers and Taptic hardware; larger and the collision
/// stops feeling like a single event.
public struct SensorySkewBudget: Equatable, Sendable {
  public let tolerance: TimeInterval

  public init(tolerance: TimeInterval = 0.020) {
    precondition(tolerance >= 0)
    self.tolerance = tolerance
  }

  public func within(deviation: TimeInterval) -> Bool {
    abs(deviation) <= tolerance
  }
}

/// Normalized event energy projected onto every sensory channel. Amplitude,
/// brightness, audio energy, and haptic intensity are the SAME number by
/// construction; no scene can compute an independent random amplitude for
/// any channel. Web `src/lib/haptics.ts` shared a turbulence multiplier;
/// this is its native successor.
public struct SensoryDerivation: Equatable, Sendable, Codable {
  /// Bounded to `[0, 1]`. NaN and infinities collapse to `0` so downstream
  /// audio + haptic parameters never receive a signalling float.
  public let energy: Double

  public init(energy: Double) {
    let bounded = min(max(energy, 0), 1)
    self.energy = bounded.isFinite ? bounded : 0
  }

  public var amplitude: Double { energy }
  public var brightness: Double { energy }
  public var audioEnergy: Double { energy }
  public var hapticIntensity: Double { energy }
}

/// One authoritative sensory event carried on the shared clock. The bus is
/// not allowed to invent randomness or an independent envelope; if the
/// scene wants a different feel it must ship a different `energy`.
public struct SensoryEvent: Equatable, Sendable {
  public let id: String
  public let signature: SensorySignature
  public let clock: SensoryClock
  public let derivation: SensoryDerivation
  public let senses: Set<SensorySense>

  public init(
    id: String,
    signature: SensorySignature,
    clock: SensoryClock,
    energy: Double,
    senses: Set<SensorySense> = [.visual, .audio, .haptic]
  ) {
    precondition(!id.isEmpty, "sensory event id must not be empty")
    self.id = id
    self.signature = signature
    self.clock = clock
    self.derivation = SensoryDerivation(energy: energy)
    self.senses = senses
  }
}

/// Result of dispatching a sensory event through the bus. Idempotent by
/// event ID — a duplicate returns `.duplicate`, never a second onset —
/// even across audio-session interruption, route change, engine reset,
/// and app suspension recoveries.
public enum SensoryDispatch: Equatable, Sendable {
  /// Onset is queued on the underlying hardware bus.
  case scheduled
  /// User preference (or an event that opts the sense out) silenced this
  /// channel. The applied-event ledger still records the id so a later
  /// re-fire cannot slip past duplicate detection.
  case muted
  /// Same event id has already been observed on this bus.
  case duplicate
  /// The hardware bus is unavailable in a recoverable way (interrupted,
  /// unavailable session, no continuous haptics). A restrained fallback
  /// may have played instead.
  case fallback(reason: FallbackReason)
  /// Platform build does not carry this bus at all (macOS test host).
  case unsupported

  public enum FallbackReason: String, Sendable, Equatable {
    case coreHapticsUnavailable
    case audioSessionUnavailable
    case audioSessionInterrupted
  }
}

/// Restrained fallback the haptic bus is permitted to synthesize when
/// Core Haptics is unavailable. Only a small handful of signatures earn a
/// fallback — a generic buzz on plain navigation success is banned.
public enum SensoryFallbackFeedback: String, Sendable, Equatable {
  case success
  case warning
}

public enum SensoryFallbackPolicy {
  /// Which signatures deserve a system-feedback fallback when Core Haptics
  /// is unavailable, and which shape they take. Signatures that carry no
  /// unambiguous scientific commitment (tap, detent, ripple, chop, roll,
  /// lens) return `nil` so unsupported hardware simply falls silent.
  public static func feedback(for signature: SensorySignature) -> SensoryFallbackFeedback? {
    switch signature {
    case .storm: return .warning
    case .crossing, .bloom: return .success
    case .tap, .ripple, .chop, .roll, .detent, .lens: return nil
    }
  }
}
