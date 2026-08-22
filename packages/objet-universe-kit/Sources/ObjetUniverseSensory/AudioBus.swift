import Foundation
#if canImport(AVFoundation)
import AVFoundation
#endif

/// Deterministic one-shot timbres shared by every scene. A signature chooses
/// shape and pitch; only the authoritative event energy chooses gain.
internal struct AudioToneProfile: Equatable {
  let frequency: Double
  let duration: TimeInterval
  let overtoneMix: Double

  static func forSignature(_ signature: SensorySignature) -> AudioToneProfile {
    switch signature {
    case .tap: .init(frequency: 523.25, duration: 0.08, overtoneMix: 0.12)
    case .ripple: .init(frequency: 220.00, duration: 0.34, overtoneMix: 0.22)
    case .chop: .init(frequency: 659.25, duration: 0.11, overtoneMix: 0.08)
    case .roll: .init(frequency: 164.81, duration: 0.42, overtoneMix: 0.30)
    case .storm: .init(frequency: 110.00, duration: 0.46, overtoneMix: 0.36)
    case .detent: .init(frequency: 783.99, duration: 0.06, overtoneMix: 0.05)
    case .crossing: .init(frequency: 196.00, duration: 0.28, overtoneMix: 0.40)
    case .lens: .init(frequency: 392.00, duration: 0.18, overtoneMix: 0.18)
    case .bloom: .init(frequency: 261.63, duration: 0.48, overtoneMix: 0.32)
    }
  }

  static func gain(forEnergy energy: Double) -> Float {
    guard energy.isFinite else { return 0 }
    // A curved response keeps quiet events delicate while preserving the
    // one shared energy ordering across visual, haptic, and audio channels.
    return Float(pow(min(max(energy, 0), 1), 0.72) * 0.28)
  }
}

internal struct OrbitalPlayback: Equatable {
  let baseFrequency: Double
  let rate: Float

  static let bases: [Double] = [55, 110, 220, 440, 880, 1_760, 3_520, 7_040]

  static func forFrequency(_ frequency: Double) -> OrbitalPlayback? {
    guard frequency.isFinite, frequency >= 20, frequency <= 20_000 else { return nil }
    let base = bases.min { abs(log2(frequency / $0)) < abs(log2(frequency / $1)) } ?? 440
    return OrbitalPlayback(baseFrequency: base, rate: Float(frequency / base))
  }
}

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
  private let stateLock = NSLock()
  private var muted = false
  private var appliedEventIDs: [String: Int] = [:]
  private let appliedCapacity: Int
  private var interruptionActive = false
  private var sessionConfigured = false
  private var prewarmScheduled = false
  private var prewarmReady = false
  private var prewarmWaiters: [Confirmation] = []
  private var performedOnsetCount = 0
  private var onsetTimes: [String: TimeInterval] = [:]
  private let skewBudget: SensorySkewBudget

  #if canImport(AVFoundation)
  private lazy var engine: AVAudioEngine = AVAudioEngine()
  private var voices: [AVAudioPlayerNode] = []
  private var pitchShifters: [AVAudioUnitVarispeed] = []
  private var nextVoice = 0
  private var buffers: [SensorySignature: AVAudioPCMBuffer] = [:]
  private var orbitalBuffers: [Double: AVAudioPCMBuffer] = [:]
  private var graphReady = false
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

  public var isMuted: Bool { withStateLock { muted } }

  public var declaredSkewBudget: SensorySkewBudget { skewBudget }

  /// Prepare the shared session, graph, voices, and immutable tone buffers
  /// away from the first interaction. Calling this repeatedly is cheap and
  /// idempotent; scene mounts may all ask without constructing another graph.
  public func prewarm() {
    prewarm(confirm: nil)
  }

  public func prewarm(confirm: Confirmation?) {
    queue.async {
      if self.prewarmReady {
        confirm?()
        return
      }
      if let confirm { self.prewarmWaiters.append(confirm) }
      guard !self.prewarmScheduled else { return }
      self.prewarmScheduled = true
      var ready = true
      #if canImport(AVFoundation) && os(iOS)
      do {
        try self.activateSessionIfNeeded()
      } catch {
        // A route change or temporary session refusal can recover on the
        // next schedule. Prewarming is latency preparation, not authority.
        self.sessionConfigured = false
        ready = false
      }
      #endif
      self.prewarmReady = ready
      self.prewarmScheduled = false
      let waiters = self.prewarmWaiters
      self.prewarmWaiters.removeAll(keepingCapacity: true)
      waiters.forEach { $0() }
    }
  }

  /// User preference (from `apps/native/src/sensory/preferences.ts`) is the
  /// only authority on muting. Muting audio does not touch haptics.
  public func setMuted(_ value: Bool) {
    withStateLock { muted = value }
    queue.async {
      #if canImport(AVFoundation) && os(iOS)
      if value { self.voices.forEach { $0.stop() } }
      #endif
    }
    if !value { prewarm() }
  }

  /// Reset the applied-event ledger. Used by tests and by the host on a
  /// full scene handoff. Never call this from an interruption handler.
  public func resetAppliedLedger() {
    withStateLock {
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
    let disposition = withStateLock { scheduleStateLocked(event) }
    if disposition == .scheduled {
      dispatchOnset(for: event, confirm: confirm)
    } else {
      confirm?()
    }
    return disposition
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
    withStateLock { onsetTimes[id] }
  }

  // MARK: - Locked implementation

  private func scheduleStateLocked(_ event: SensoryEvent) -> SensoryDispatch {
    if appliedEventIDs[event.id] != nil {
      return .duplicate
    }
    guard event.senses.contains(.audio) else {
      registerAppliedLocked(event, observedDelta: 0)
      return .muted
    }
    if muted {
      registerAppliedLocked(event, observedDelta: 0)
      return .muted
    }
    if interruptionActive {
      registerAppliedLocked(event, observedDelta: 0)
      return .fallback(reason: .audioSessionInterrupted)
    }
    registerAppliedLocked(event, observedDelta: 0)
    return .scheduled
  }

  private func registerAppliedLocked(_ event: SensoryEvent, observedDelta: TimeInterval) {
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
    let delay = max(0, event.clock.wallOffset)
    let requestedAt = ProcessInfo.processInfo.systemUptime
    queue.asyncAfter(deadline: .now() + delay) { [weak self] in
      // User preference, interruption, and route state may have changed
      // since this event was scheduled. Revalidate all three at onset.
      if self?.performOnset(event) == true {
        self?.recordOnsetDeviation(for: event.id, requestedAt: requestedAt, delay: delay)
      }
      confirm?()
    }
  }

  private func performOnset(_ event: SensoryEvent) -> Bool {
    guard withStateLock({ !muted && !interruptionActive }) else { return false }
    #if canImport(AVFoundation) && os(iOS)
    do {
      try activateSessionIfNeeded()
    } catch {
      sessionConfigured = false
      return false
    }
    #endif
    play(event)
    prewarmReady = true
    withStateLock { performedOnsetCount += 1 }
    return true
  }

  private func recordOnsetDeviation(for id: String, requestedAt: TimeInterval, delay: TimeInterval) {
    let now = ProcessInfo.processInfo.systemUptime
    let observed = now - requestedAt
    let deviation = observed - delay
    withStateLock { onsetTimes[id] = deviation }
  }

  @discardableResult
  private func withStateLock<T>(_ body: () throws -> T) rethrows -> T {
    stateLock.lock()
    defer { stateLock.unlock() }
    return try body()
  }

  // MARK: - Session lifecycle

  #if canImport(AVFoundation) && os(iOS)
  private func activateSessionIfNeeded() throws {
    if !sessionConfigured {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
      try session.setPreferredIOBufferDuration(0.005)
      try session.setActive(true, options: [])
      sessionConfigured = true
    }
    try prepareGraphIfNeeded()
  }

  private func prepareGraphIfNeeded() throws {
    if !graphReady {
      let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
      voices = (0 ..< 6).map { _ in AVAudioPlayerNode() }
      pitchShifters = (0 ..< voices.count).map { _ in AVAudioUnitVarispeed() }
      for (voice, pitchShifter) in zip(voices, pitchShifters) {
        engine.attach(voice)
        engine.attach(pitchShifter)
        engine.connect(voice, to: pitchShifter, format: format)
        engine.connect(pitchShifter, to: engine.mainMixerNode, format: format)
      }
      for signature in SensorySignature.allCases {
        buffers[signature] = makeBuffer(profile: AudioToneProfile.forSignature(signature), format: format)
      }
      for base in OrbitalPlayback.bases {
        orbitalBuffers[base] = makeBuffer(
          profile: AudioToneProfile(frequency: base, duration: 0.32, overtoneMix: 0.18),
          format: format
        )
      }
      engine.prepare()
      graphReady = true
    }
    if !engine.isRunning { try engine.start() }
  }

  private func makeBuffer(profile: AudioToneProfile, format: AVAudioFormat) -> AVAudioPCMBuffer {
    let frameCount = AVAudioFrameCount(max(1, Int(format.sampleRate * profile.duration)))
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
    buffer.frameLength = frameCount
    guard let samples = buffer.floatChannelData?[0] else { return buffer }
    for frame in 0 ..< Int(frameCount) {
      let time = Double(frame) / format.sampleRate
      let progress = Double(frame) / Double(max(1, Int(frameCount) - 1))
      let attack = min(1, time / 0.006)
      let release = pow(max(0, 1 - progress), 2.4)
      let fundamental = sin(2 * Double.pi * profile.frequency * time)
      let overtone = sin(2 * Double.pi * profile.frequency * 2.01 * time) * profile.overtoneMix
      samples[frame] = Float((fundamental + overtone) / (1 + profile.overtoneMix) * attack * release)
    }
    return buffer
  }
  #endif

  private func play(_ event: SensoryEvent) {
    #if canImport(AVFoundation) && os(iOS)
    guard !isMuted, graphReady, !voices.isEmpty, voices.count == pitchShifters.count else { return }
    let orbital = event.frequencyHz.flatMap(OrbitalPlayback.forFrequency)
    guard let buffer = orbital.flatMap({ orbitalBuffers[$0.baseFrequency] }) ?? buffers[event.signature] else { return }
    let voice = voices[nextVoice % voices.count]
    let pitchShifter = pitchShifters[nextVoice % pitchShifters.count]
    nextVoice = (nextVoice + 1) % voices.count
    voice.stop()
    pitchShifter.rate = orbital?.rate ?? 1
    voice.volume = AudioToneProfile.gain(forEnergy: event.derivation.audioEnergy)
    voice.scheduleBuffer(buffer, at: nil, options: [.interrupts], completionHandler: nil)
    voice.play()
    #endif
  }

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
        self.withStateLock { self.interruptionActive = true }
        self.sessionConfigured = false
        self.prewarmReady = false
        self.engine.pause()
      case .ended:
        self.withStateLock { self.interruptionActive = false }
        let rawOptions = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
        guard options.contains(.shouldResume), !self.isMuted else { return }
        // Re-arm the graph but never re-fire past events. The applied-event
        // ledger remains authoritative across every recovery path.
        do {
          try self.activateSessionIfNeeded()
          self.prewarmReady = true
        } catch {
          self.sessionConfigured = false
          self.prewarmReady = false
          self.prewarmScheduled = false
        }
      @unknown default:
        break
      }
    }
  }

  private func handleRouteChange() {
    queue.async {
      self.sessionConfigured = false
      self.prewarmReady = false
      self.prewarmScheduled = false
    }
  }
  #endif

  // MARK: - Internal test hooks

  internal func _testForceInterruption(_ active: Bool) {
    withStateLock { interruptionActive = active }
  }

  internal func _testAppliedCount() -> Int {
    withStateLock { appliedEventIDs.count }
  }

  internal func _testPerformedOnsetCount() -> Int {
    withStateLock { performedOnsetCount }
  }
}
