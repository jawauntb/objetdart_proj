import Foundation
import UIKit

/// U5 — Swift half of the semantic input grammar.
///
/// A free-standing service that recognises touch, ordinary Pencil contact,
/// keyboard, and device-motion input and hands the ObjetUniverseModule a
/// stream of `SemanticCommand`s. The module (integrated separately) attaches
/// the recognisers and forwards events. Wiring, not policy, lives here.
///
/// The 15 numeric thresholds are copied verbatim from `src/lib/gesture/core.ts`
/// (via `apps/native/src/universe/actions.ts` NATIVE_GESTURE_THRESHOLDS). The
/// TypeScript accessibility test parses this file and pins every line — do
/// not edit any threshold literal without editing the same literal in both TS
/// modules.
public enum NativeGestureThresholds {
  public static let dwellMs: Double = 900
  public static let ceremonyMs: Double = 2500
  public static let tapMaxMs: Double = 250
  public static let tapTrainMs: Double = 280
  public static let moveTolPx: Double = 12
  public static let flickVel: Double = 0.6
  public static let scrubWinding: Double = 0.75
  public static let pinchDeadzone: Double = 0.03
  public static let twistDeadzoneRad: Double = 0.1
  public static let shakeThresh: Double = 16
  public static let knockThresh: Double = 22
  public static let voiceStaggerMs: Double = 80
  public static let voiceDecideMs: Double = 180
  public static let spanEnterMs: Double = 350
  public static let spanTolPx: Double = 16
}

/// Site-wide grammar verbs mirrored from TypeScript. The Swift enum keeps
/// each verb the router can commit; the router refuses to emit any other.
public enum NativeGrammarVerb: String, CaseIterable, Sendable {
  case tap
  case tap2
  case tap3
  case holdDwell
  case holdCeremony
  case hold3
  case drag
  case drag3
  case flick
  case scrub
  case span
  case twist
  case twist3
  case rhythm
  case drum
  case arpeggio
  case shake
  case tilt
  case knock
  case flip
  case breath
  case pinch
  case pan2
}

public enum NativeActionLayer: String, Sendable {
  case material
  case representation
  case world
  case vessel
  case accessibility
}

public enum NativeActionSource: String, Sendable {
  case touch
  case pencil
  case vessel
  case keyboard
  case assistive
  case system
}

/// Shape of a recogniser emit. Matches the TypeScript `NativeGestureShape`
/// discriminated union. The router normalises every UIKit gesture recogniser
/// into one of these cases before assembling a `SemanticCommand`.
public enum NativeGestureShape: Sendable {
  case tap(fingers: Int, count: Int, x: Double, y: Double, intensity: Double)
  case hold(fingers: Int, elapsedMs: Double, x: Double, y: Double, intensity: Double)
  case drag(fingers: Int, dx: Double, dy: Double, vx: Double, vy: Double, x: Double, y: Double)
  case flick(fingers: Int, speed: Double, angle: Double, x: Double, y: Double)
  case twist(fingers: Int, angleRad: Double, velocity: Double)
  case pinch(scale: Double, velocity: Double)
  case scrub(winding: Double, angularVelocity: Double, cx: Double, cy: Double)
  case span(phase: SpanPhase, spread: Double, elapsedMs: Double, cx: Double, cy: Double)
  case shake(intensity: Double)
  case tilt(beta: Double, gamma: Double)
  case knock(intensity: Double)
  case flip(faceDown: Bool)
  case breath(strength: Double)
}

public enum SpanPhase: String, Sendable {
  case enter
  case tick
  case release
}

/// The router's public sink: what the module attaches to receive normalised
/// input, replacing the raw recogniser stream.
public struct RoutedCommand: Sendable {
  public let verb: NativeGrammarVerb
  public let layer: NativeActionLayer
  public let source: NativeActionSource
  public let intensity: Double
  public let logicalTimeMs: Double
  public let shape: NativeGestureShape

  public init(
    verb: NativeGrammarVerb,
    layer: NativeActionLayer,
    source: NativeActionSource,
    intensity: Double,
    logicalTimeMs: Double,
    shape: NativeGestureShape
  ) {
    self.verb = verb
    self.layer = layer
    self.source = source
    self.intensity = intensity
    self.logicalTimeMs = logicalTimeMs
    self.shape = shape
  }
}

public struct RoutedDiscovery: Sendable {
  public enum Reason: String, Sendable {
    case idle
    case nearMiss
  }
  public let reason: Reason
  public let idleForMs: Double
  public let observedFingers: Int
  public let withdrawnAfterMs: Double
}

/// One sensor subscription, one recogniser policy, one command sink. The
/// module attaches this to a view and calls `route(_:)` for each recogniser
/// state — the router alone decides finger count, tier, and continuity.
public final class GestureRouter: @unchecked Sendable {
  private let queue: DispatchQueue
  private let sink: (RoutedCommand) -> Void
  private let discoverySink: (RoutedDiscovery) -> Void

  // Idle / near-miss discovery state.
  private var lastContactAt: TimeInterval
  private var withdrawnFingers: Int? = nil
  private var withdrawnAfter: TimeInterval = 0
  private let discoveryClock: () -> TimeInterval

  // Tap-train state — capped at 9 so a runaway press doesn't invent a private dialect.
  private var trainCount: Int = 0
  private var trainLastAt: TimeInterval = 0
  private let trainCap: Int = 9

  public init(
    queue: DispatchQueue = .main,
    now: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
    onCommand: @escaping (RoutedCommand) -> Void,
    onDiscovery: @escaping (RoutedDiscovery) -> Void
  ) {
    self.queue = queue
    self.discoveryClock = now
    self.lastContactAt = now()
    self.sink = onCommand
    self.discoverySink = onDiscovery
  }

  /// Rebuild a `RoutedCommand` from a normalised shape. Rooms cannot rebind
  /// verbs — the pure switch here mirrors `resolveVerbFromShape` on the TS
  /// side, and is the ONLY place layer/verb decisions happen in Swift.
  public func route(shape: NativeGestureShape, source: NativeActionSource, logicalTimeMs: Double) {
    let (verb, layer) = Self.resolve(shape: shape)
    let intensity = Self.intensity(from: shape)
    let command = RoutedCommand(
      verb: verb,
      layer: layer,
      source: source,
      intensity: intensity,
      logicalTimeMs: logicalTimeMs,
      shape: shape
    )
    markContact()
    if case let .tap(_, count, _, _, _) = shape {
      trainCount = updatedTrainCount(now: discoveryClock(), incomingCount: count)
      trainLastAt = discoveryClock()
    }
    queue.async { [sink] in
      sink(command)
    }
  }

  /// Report that a chord landed with `fingers` fingers but was withdrawn
  /// before committing after `elapsedMs`. Used by the discovery classifier —
  /// never surfaces as a tutorial, never invents a threshold.
  public func recordNearMiss(fingers: Int, withdrawnAfterMs: Double) {
    guard fingers == 2 || fingers == 3 else { return }
    withdrawnFingers = fingers
    withdrawnAfter = withdrawnAfterMs
  }

  /// Poll the discovery clock. The module calls this from its display link
  /// tick; the router alone decides when a suggestion is warranted.
  public func pumpDiscovery(idleWindowMs: Double = 6_000) {
    let now = discoveryClock()
    let idleMs = (now - lastContactAt) * 1_000
    if let fingers = withdrawnFingers, withdrawnAfter > 0 {
      let discovery = RoutedDiscovery(
        reason: .nearMiss,
        idleForMs: idleMs,
        observedFingers: fingers,
        withdrawnAfterMs: withdrawnAfter
      )
      withdrawnFingers = nil
      withdrawnAfter = 0
      queue.async { [discoverySink] in
        discoverySink(discovery)
      }
      return
    }
    guard idleMs >= idleWindowMs else { return }
    let discovery = RoutedDiscovery(
      reason: .idle,
      idleForMs: idleMs,
      observedFingers: 2,
      withdrawnAfterMs: 0
    )
    // Roll the idle clock forward so we don't fire every tick.
    lastContactAt = now
    queue.async { [discoverySink] in
      discoverySink(discovery)
    }
  }

  private func markContact() {
    lastContactAt = discoveryClock()
  }

  private func updatedTrainCount(now: TimeInterval, incomingCount: Int) -> Int {
    let deltaMs = (now - trainLastAt) * 1_000
    if trainLastAt == 0 || deltaMs > NativeGestureThresholds.tapTrainMs {
      return max(1, incomingCount)
    }
    return min(trainCap, trainCount + max(1, incomingCount))
  }

  /// Pure classifier — mirrors the TypeScript `resolveVerbFromShape`. Kept
  /// static so `GestureRouterTests` can drive it without spinning up a queue
  /// or a UIWindow.
  public static func resolve(shape: NativeGestureShape) -> (NativeGrammarVerb, NativeActionLayer) {
    switch shape {
    case let .tap(fingers, _, _, _, _):
      if fingers >= 3 { return (.tap3, .material) }
      if fingers == 2 { return (.tap2, .representation) }
      return (.tap, .material)
    case let .hold(fingers, elapsedMs, _, _, _):
      if fingers >= 3 { return (.hold3, .world) }
      if elapsedMs >= NativeGestureThresholds.ceremonyMs { return (.holdCeremony, .material) }
      return (.holdDwell, .material)
    case let .drag(fingers, _, _, _, _, _, _):
      if fingers >= 3 { return (.drag3, .world) }
      return (.drag, .material)
    case .flick:
      return (.flick, .material)
    case let .twist(fingers, _, _):
      if fingers >= 3 { return (.twist3, .world) }
      return (.twist, .representation)
    case .pinch:
      return (.pinch, .representation)
    case .scrub:
      return (.scrub, .material)
    case .span:
      return (.span, .material)
    case .shake:
      return (.shake, .vessel)
    case .tilt:
      return (.tilt, .vessel)
    case .knock:
      return (.knock, .vessel)
    case .flip:
      return (.flip, .vessel)
    case .breath:
      return (.breath, .vessel)
    }
  }

  /// Continuous 0..1 intensity per shape kind, mirroring
  /// `intensityFromNativeShape` on the TypeScript side.
  public static func intensity(from shape: NativeGestureShape) -> Double {
    switch shape {
    case let .tap(_, _, _, _, intensity),
         let .hold(_, _, _, _, intensity):
      return clamp01(intensity)
    case let .drag(_, _, _, vx, vy, _, _):
      return clamp01((vx * vx + vy * vy).squareRoot() / 3.0)
    case let .flick(_, speed, _, _, _):
      return clamp01(speed / 3.0)
    case let .twist(_, angleRad, _):
      return clamp01(abs(angleRad) / .pi)
    case let .pinch(scale, _):
      return clamp01(abs(scale - 1))
    case let .scrub(winding, _, _, _):
      return clamp01(abs(winding))
    case let .span(_, _, elapsedMs, _, _):
      return clamp01(elapsedMs / 4_000)
    case let .shake(intensity):
      return clamp01(intensity)
    case let .tilt(beta, gamma):
      return clamp01((beta * beta + gamma * gamma).squareRoot() / 180)
    case let .knock(intensity):
      return clamp01(intensity)
    case let .flip(faceDown):
      return faceDown ? 1 : 0
    case let .breath(strength):
      return clamp01(strength)
    }
  }

  private static func clamp01(_ value: Double) -> Double {
    guard value.isFinite else { return 0 }
    if value < 0 { return 0 }
    if value > 1 { return 1 }
    return value
  }
}
