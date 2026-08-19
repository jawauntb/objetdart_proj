import Foundation
#if canImport(CoreHaptics)
import CoreHaptics
#endif
#if canImport(UIKit)
import UIKit
#endif

/// One CHHapticEngine per app. Mirrors the singleton discipline of web
/// `src/lib/haptics.ts` and inherits the engine-recovery lessons from
/// `ios/ObjetCoin/ObjetCoin/App/CoinWebView.swift`: stop and reset
/// handlers mark the engine unready; the next scheduled onset lazily
/// restarts it. Never fires a generic buzz on plain "navigation
/// success" — see `SensoryFallbackPolicy`.
public final class HapticBus: @unchecked Sendable {
  public static let shared = HapticBus()

  public typealias Confirmation = @Sendable () -> Void

  private let queue: DispatchQueue
  private var muted = false
  private var appliedEventIDs: [String: Int] = [:]
  private let appliedCapacity: Int
  private var onsetTimes: [String: TimeInterval] = [:]
  private let skewBudget: SensorySkewBudget

  #if canImport(CoreHaptics)
  private var engine: CHHapticEngine?
  private var engineReady = false
  #endif

  internal init(
    queue: DispatchQueue = DispatchQueue(label: "art.objet.haptic-bus", qos: .userInteractive),
    appliedCapacity: Int = 512,
    skewBudget: SensorySkewBudget = SensorySkewBudget()
  ) {
    self.queue = queue
    self.appliedCapacity = appliedCapacity
    self.skewBudget = skewBudget
    installLifecycleObservers()
  }

  public var isMuted: Bool { queue.sync { muted } }
  public var declaredSkewBudget: SensorySkewBudget { skewBudget }

  public var isCoreHapticsSupported: Bool {
    #if canImport(CoreHaptics) && os(iOS)
    return CHHapticEngine.capabilitiesForHardware().supportsHaptics
    #else
    return false
    #endif
  }

  /// User preference (from `apps/native/src/sensory/preferences.ts`) is the
  /// only authority on muting. Muting haptics does not touch audio.
  public func setMuted(_ value: Bool) { queue.sync { muted = value } }

  public func resetAppliedLedger() {
    queue.sync {
      appliedEventIDs.removeAll(keepingCapacity: true)
      onsetTimes.removeAll(keepingCapacity: true)
    }
  }

  @discardableResult
  public func schedule(_ event: SensoryEvent, confirm: Confirmation? = nil) -> SensoryDispatch {
    queue.sync { scheduleLocked(event, confirm: confirm) }
  }

  public func schedule(_ event: SensoryEvent) async -> SensoryDispatch {
    await withCheckedContinuation { (continuation: CheckedContinuation<SensoryDispatch, Never>) in
      let dispatched = self.schedule(event) { /* continuation resumes below */ }
      continuation.resume(returning: dispatched)
    }
  }

  public func skewObserved(for id: String) -> TimeInterval? {
    queue.sync { onsetTimes[id] }
  }

  // MARK: - Locked implementation

  private func scheduleLocked(_ event: SensoryEvent, confirm: Confirmation?) -> SensoryDispatch {
    if appliedEventIDs[event.id] != nil {
      confirm?()
      return .duplicate
    }
    guard event.senses.contains(.haptic) else {
      registerApplied(event, observedDelta: 0)
      confirm?()
      return .muted
    }
    if muted {
      registerApplied(event, observedDelta: 0)
      confirm?()
      return .muted
    }

    #if canImport(CoreHaptics) && os(iOS)
    if isCoreHapticsSupported {
      do {
        try ensureEngineReady()
        try playPattern(for: event)
        registerApplied(event, observedDelta: 0)
        scheduleConfirmation(event: event, confirm: confirm)
        return .scheduled
      } catch {
        engineReady = false
        engine = nil
      }
    }
    if let feedback = SensoryFallbackPolicy.feedback(for: event.signature) {
      playRestrainedFallback(feedback)
    }
    registerApplied(event, observedDelta: 0)
    scheduleConfirmation(event: event, confirm: confirm)
    return .fallback(reason: .coreHapticsUnavailable)
    #else
    registerApplied(event, observedDelta: 0)
    scheduleConfirmation(event: event, confirm: confirm)
    return .unsupported
    #endif
  }

  private func registerApplied(_ event: SensoryEvent, observedDelta: TimeInterval) {
    appliedEventIDs[event.id] = event.clock.logicalTick
    onsetTimes[event.id] = observedDelta
    if appliedEventIDs.count > appliedCapacity {
      let overflow = appliedEventIDs.count - appliedCapacity
      let ordered = appliedEventIDs.sorted { $0.value < $1.value }
      for (key, _) in ordered.prefix(overflow) {
        appliedEventIDs.removeValue(forKey: key)
        onsetTimes.removeValue(forKey: key)
      }
    }
  }

  private func scheduleConfirmation(event: SensoryEvent, confirm: Confirmation?) {
    let delay = max(0, event.clock.wallOffset)
    let requestedAt = ProcessInfo.processInfo.systemUptime
    if delay <= 0 {
      recordOnsetDeviation(for: event.id, requestedAt: requestedAt, delay: delay)
      confirm?()
    } else {
      queue.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.recordOnsetDeviation(for: event.id, requestedAt: requestedAt, delay: delay)
        confirm?()
      }
    }
  }

  private func recordOnsetDeviation(for id: String, requestedAt: TimeInterval, delay: TimeInterval) {
    let now = ProcessInfo.processInfo.systemUptime
    let observed = now - requestedAt
    let deviation = observed - delay
    queue.async { self.onsetTimes[id] = deviation }
  }

  // MARK: - Core Haptics

  #if canImport(CoreHaptics) && os(iOS)
  private func ensureEngineReady() throws {
    if engineReady, engine != nil { return }
    let created = try CHHapticEngine()
    created.stoppedHandler = { [weak self] _ in
      self?.queue.async {
        self?.engineReady = false
        self?.engine = nil
      }
    }
    created.resetHandler = { [weak self] in
      // The engine reset — try to bring it back on the next scheduled
      // onset, but never re-fire past events (ledger is authoritative).
      self?.queue.async {
        self?.engineReady = false
      }
    }
    try created.start()
    engine = created
    engineReady = true
  }

  private func playPattern(for event: SensoryEvent) throws {
    guard let engine else { throw HapticBusError.engineUnavailable }
    let intensity = Float(event.derivation.hapticIntensity)
    let sharpness = Float(event.derivation.hapticIntensity)
    let pattern = try buildPattern(for: event.signature, intensity: intensity, sharpness: sharpness)
    let player = try engine.makePlayer(with: pattern)
    try player.start(atTime: max(0, event.clock.wallOffset))
  }

  private func buildPattern(
    for signature: SensorySignature,
    intensity: Float,
    sharpness: Float
  ) throws -> CHHapticPattern {
    let iP = CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity)
    let sP = CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
    switch signature {
    case .tap, .detent:
      return try CHHapticPattern(events: [
        CHHapticEvent(eventType: .hapticTransient, parameters: [iP, sP], relativeTime: 0),
      ], parameters: [])
    case .ripple:
      return try CHHapticPattern(events: [
        CHHapticEvent(
          eventType: .hapticContinuous,
          parameters: [iP, sP],
          relativeTime: 0,
          duration: 0.08
        ),
      ], parameters: [])
    case .chop:
      return try CHHapticPattern(events: [
        CHHapticEvent(eventType: .hapticTransient, parameters: [iP, sP], relativeTime: 0),
        CHHapticEvent(eventType: .hapticTransient, parameters: [iP, sP], relativeTime: 0.05),
      ], parameters: [])
    case .roll:
      return try CHHapticPattern(events: [
        CHHapticEvent(
          eventType: .hapticContinuous,
          parameters: [iP, sP],
          relativeTime: 0,
          duration: 0.14
        ),
      ], parameters: [])
    case .storm:
      return try CHHapticPattern(events: [
        CHHapticEvent(
          eventType: .hapticContinuous,
          parameters: [iP, sP],
          relativeTime: 0,
          duration: 0.22
        ),
      ], parameters: [])
    case .crossing:
      return try CHHapticPattern(events: [
        CHHapticEvent(eventType: .hapticTransient, parameters: [iP, sP], relativeTime: 0),
        CHHapticEvent(
          eventType: .hapticContinuous,
          parameters: [iP, sP],
          relativeTime: 0.02,
          duration: 0.06
        ),
      ], parameters: [])
    case .lens:
      return try CHHapticPattern(events: [
        CHHapticEvent(eventType: .hapticTransient, parameters: [iP, sP], relativeTime: 0),
        CHHapticEvent(eventType: .hapticTransient, parameters: [iP, sP], relativeTime: 0.09),
      ], parameters: [])
    case .bloom:
      return try CHHapticPattern(events: [
        CHHapticEvent(
          eventType: .hapticContinuous,
          parameters: [iP, sP],
          relativeTime: 0,
          duration: 0.18
        ),
      ], parameters: [])
    }
  }

  private func playRestrainedFallback(_ feedback: SensoryFallbackFeedback) {
    #if canImport(UIKit)
    let generator = UINotificationFeedbackGenerator()
    generator.prepare()
    let style: UINotificationFeedbackGenerator.FeedbackType
    switch feedback {
    case .success: style = .success
    case .warning: style = .warning
    }
    generator.notificationOccurred(style)
    #endif
  }
  #endif

  private func installLifecycleObservers() {
    #if os(iOS)
    let center = NotificationCenter.default
    center.addObserver(
      forName: UIApplication.didEnterBackgroundNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.queue.async {
        #if canImport(CoreHaptics)
        self?.engineReady = false
        #endif
      }
    }
    #endif
  }

  // MARK: - Internal test hooks

  internal func _testAppliedCount() -> Int {
    queue.sync { appliedEventIDs.count }
  }

  #if canImport(CoreHaptics)
  internal func _testForceEngineReset() {
    queue.sync {
      engineReady = false
      engine = nil
    }
  }
  #endif
}

public enum HapticBusError: Error, Equatable {
  case engineUnavailable
}
