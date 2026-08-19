import Foundation
#if canImport(AVFoundation)
import AVFoundation
#endif

/// One AVAudioSession, one AVAudioEngine per app. Mirrors the singleton
/// discipline of web `src/lib/audio.ts` — scenes may not construct
/// independent audio graphs. Every onset derives from `SensoryEvent`, so
/// amplitude / brightness / audio energy / haptic intensity share one
/// number and cannot drift apart.
///
/// Interruption + route change + app suspension recovery is idempotent:
/// the applied-event ledger is authoritative and the bus refuses to re-fire
/// a past event under any recovery path.
public final class AudioBus: @unchecked Sendable {
  public static let shared = AudioBus()

  /// Async completion handle. `UniverseHost` will `await` this before
  /// promoting the `sensoryConfirmed` boundary, closing the last hop in
  /// the previewed → durablyAppended → authoritativelyApplied →
  /// checkpointPromoted → uiAcknowledged → sensoryConfirmed chain.
  public typealias Confirmation = @Sendable () -> Void

  private let queue: DispatchQueue
  private var muted = false
  private var appliedEventIDs: [String: Int] = [:]
  private let appliedCapacity: Int
  private var interruptionActive = false
  private var sessionConfigured = false
  private var onsetTimes: [String: TimeInterval] = [:]
  private let skewBudget: SensorySkewBudget

  #if canImport(AVFoundation)
  private lazy var engine: AVAudioEngine = AVAudioEngine()
  #endif

  internal init(
    queue: DispatchQueue = DispatchQueue(label: "art.objet.audio-bus", qos: .userInteractive),
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

  /// User preference (from `apps/native/src/sensory/preferences.ts`) is the
  /// only authority on muting. Muting audio does not touch haptics.
  public func setMuted(_ value: Bool) { queue.sync { muted = value } }

  /// Reset the applied-event ledger. Used by tests and by the host on a
  /// full scene handoff. Never call this from an interruption handler.
  public func resetAppliedLedger() {
    queue.sync {
      appliedEventIDs.removeAll(keepingCapacity: true)
      onsetTimes.removeAll(keepingCapacity: true)
    }
  }

  /// Synchronous schedule. Returns immediately with a `SensoryDispatch`.
  /// The `confirm` closure fires exactly once per unique event id —
  /// including for `.duplicate` and `.muted` so a host awaiting sensory
  /// confirmation never stalls.
  @discardableResult
  public func schedule(_ event: SensoryEvent, confirm: Confirmation? = nil) -> SensoryDispatch {
    queue.sync { scheduleLocked(event, confirm: confirm) }
  }

  /// Awaitable variant for `UniverseHost.promote(...)`.
  public func schedule(_ event: SensoryEvent) async -> SensoryDispatch {
    await withCheckedContinuation { (continuation: CheckedContinuation<SensoryDispatch, Never>) in
      let dispatched = self.schedule(event) { /* no-op — continuation resumes with dispatch */ }
      continuation.resume(returning: dispatched)
    }
  }

  /// Measured deviation between the scheduled wall time and the observed
  /// onset time for `id`, in seconds. Nil if the id has never been
  /// scheduled on this bus.
  public func skewObserved(for id: String) -> TimeInterval? {
    queue.sync { onsetTimes[id] }
  }

  // MARK: - Locked implementation

  private func scheduleLocked(_ event: SensoryEvent, confirm: Confirmation?) -> SensoryDispatch {
    if appliedEventIDs[event.id] != nil {
      confirm?()
      return .duplicate
    }
    guard event.senses.contains(.audio) else {
      registerApplied(event, observedDelta: 0)
      confirm?()
      return .muted
    }
    if muted {
      registerApplied(event, observedDelta: 0)
      confirm?()
      return .muted
    }
    if interruptionActive {
      registerApplied(event, observedDelta: 0)
      confirm?()
      return .fallback(reason: .audioSessionInterrupted)
    }

    #if canImport(AVFoundation) && os(iOS)
    do {
      try activateSessionIfNeeded()
    } catch {
      registerApplied(event, observedDelta: 0)
      confirm?()
      return .fallback(reason: .audioSessionUnavailable)
    }
    #endif

    registerApplied(event, observedDelta: 0)
    dispatchOnset(for: event, confirm: confirm)
    return .scheduled
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

  private func dispatchOnset(for event: SensoryEvent, confirm: Confirmation?) {
    // The real onset — an AVAudioEngine parameter drift keyed off event
    // energy — is wired in when the audio-register glide is ported from
    // web `src/lib/audio-register.ts`. What matters here is that we DO
    // NOT invent an independent amplitude: gain, brightness, and haptic
    // intensity all derive from the same `event.derivation.energy`.
    let gain = Float(event.derivation.audioEnergy)
    _ = gain  // engine wiring is deferred; sensory clock discipline is not
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

  // MARK: - Session lifecycle

  #if canImport(AVFoundation) && os(iOS)
  private func activateSessionIfNeeded() throws {
    if sessionConfigured { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
    try session.setActive(true, options: [])
    sessionConfigured = true
  }
  #endif

  private func installLifecycleObservers() {
    #if canImport(AVFoundation) && os(iOS)
    let center = NotificationCenter.default
    center.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: nil
    ) { [weak self] note in
      self?.handleInterruption(note)
    }
    center.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.handleRouteChange()
    }
    #endif
  }

  #if canImport(AVFoundation) && os(iOS)
  private func handleInterruption(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    queue.async {
      switch type {
      case .began:
        self.interruptionActive = true
      case .ended:
        self.interruptionActive = false
        // Do not re-fire past events. The applied-event ledger is
        // authoritative across every recovery path.
      @unknown default:
        break
      }
    }
  }

  private func handleRouteChange() {
    queue.async { self.sessionConfigured = false }
  }
  #endif

  // MARK: - Internal test hooks

  internal func _testForceInterruption(_ active: Bool) {
    queue.sync { self.interruptionActive = active }
  }

  internal func _testAppliedCount() -> Int {
    queue.sync { appliedEventIDs.count }
  }
}
