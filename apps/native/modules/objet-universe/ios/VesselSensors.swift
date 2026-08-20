import CoreMotion
import Foundation
import UIKit

/// U5 — vessel bus for the native side. Mirrors `src/lib/vessel.ts`:
///
///  - One process-wide `CMMotionManager` subscription, multiplexed to any
///    number of listeners. A missing sensor costs a dimension, never a
///    feature.
///  - The permission choreography is invited, never demanded: `request(...)`
///    asks at most once per session and remembers the outcome. Denials keep
///    every touch equivalent alive.
///  - Classification (shake windows, knock spikes, face-down hysteresis)
///    reads the same numbers `GestureRouter` uses — there is no private
///    threshold anywhere in the vessel.
///  - Backgrounding, rotation, and interruption suspend the sensors cleanly
///    and re-arm silently on foreground when a prior grant already exists.
public final class VesselSensors: @unchecked Sendable {
  public struct Sample: Sendable {
    public let x: Double
    public let y: Double
    public let z: Double
    public let atMs: TimeInterval
  }

  public struct TiltEvent: Sendable {
    public let beta: Double
    public let gamma: Double
  }

  public enum Grant: String, Sendable {
    case unrequested
    case granted
    case declined
  }

  public struct Listener: Sendable {
    public let id: UUID
    public let onShake: (@Sendable (_ intensity: Double) -> Void)?
    public let onKnock: (@Sendable (_ intensity: Double) -> Void)?
    public let onTilt: (@Sendable (_ event: TiltEvent) -> Void)?
    public let onFlip: (@Sendable (_ faceDown: Bool) -> Void)?

    public init(
      id: UUID = UUID(),
      onShake: (@Sendable (Double) -> Void)? = nil,
      onKnock: (@Sendable (Double) -> Void)? = nil,
      onTilt: (@Sendable (TiltEvent) -> Void)? = nil,
      onFlip: (@Sendable (Bool) -> Void)? = nil
    ) {
      self.id = id
      self.onShake = onShake
      self.onKnock = onKnock
      self.onTilt = onTilt
      self.onFlip = onFlip
    }
  }

  // Motion classification — reused from GestureRouter's threshold table.
  private static let shakeWindowMs: Double = 700
  private static let shakeCooldownMs: Double = 900
  private static let knockCooldownMs: Double = 400
  private static let flipEnterDeg: Double = 150
  private static let flipExitDeg: Double = 120
  private static let sampleCap = 60

  private let manager: CMMotionManager
  private let queue: OperationQueue
  private let clock: () -> TimeInterval
  private let grantStore: GrantStore
  private var listeners: [UUID: Listener] = [:]
  private var samples: [Sample] = []
  private var lastShakeAt: TimeInterval = 0
  private var lastTiltAt: TimeInterval = 0
  private var faceDown = false
  private var running = false
  private var lifecycleObservers: [NSObjectProtocol] = []
  private var askedThisSession = false

  public init(
    manager: CMMotionManager = CMMotionManager(),
    queue: OperationQueue = .main,
    now: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
    grantStore: GrantStore = UserDefaultsGrantStore()
  ) {
    self.manager = manager
    self.queue = queue
    self.clock = now
    self.grantStore = grantStore
    self.manager.deviceMotionUpdateInterval = 1.0 / 20.0
    self.manager.accelerometerUpdateInterval = 1.0 / 30.0
    observeLifecycle()
  }

  deinit {
    stop()
    lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
  }

  /// Whether the platform exposes any motion sensor at all. False on
  /// simulator builds without motion or under a hard-off privacy state.
  public var isAvailable: Bool {
    manager.isDeviceMotionAvailable || manager.isAccelerometerAvailable
  }

  /// The remembered permission. Never asks — call `request(...)` for that.
  public var currentGrant: Grant { grantStore.grant }

  /// Multiplexed subscription. Safe to call before a grant exists; events
  /// begin flowing when the vessel is armed. Returns a detach closure so a
  /// caller cannot accidentally leak a listener.
  @discardableResult
  public func subscribe(_ listener: Listener) -> () -> Void {
    listeners[listener.id] = listener
    if isAvailable && currentGrant == .granted {
      startIfNeeded()
    }
    return { [weak self] in
      guard let self else { return }
      self.listeners.removeValue(forKey: listener.id)
      if self.listeners.isEmpty { self.stop() }
    }
  }

  /// The invitation. MUST be called from inside a real user gesture — iOS
  /// does not present its dialog otherwise. Asks at most once per session;
  /// a declined vessel simply stays dark and the touch equivalents keep
  /// answering. `completion` runs on the queue provided to init.
  public func request(_ completion: @escaping (Bool) -> Void) {
    guard isAvailable else {
      completion(false)
      return
    }
    if currentGrant == .granted {
      startIfNeeded()
      completion(true)
      return
    }
    if askedThisSession {
      completion(currentGrant == .granted)
      return
    }
    askedThisSession = true
    // CoreMotion has no explicit `requestPermission` in iOS 17+: the first
    // motion update triggers the system prompt. Kick a single update and
    // interpret the outcome from the delivered sample or error.
    manager.startDeviceMotionUpdates(to: queue) { [weak self] (motion: CMDeviceMotion?, error: Error?) in
      guard let self else { return }
      self.manager.stopDeviceMotionUpdates()
      if error != nil || motion == nil {
        self.grantStore.grant = .declined
        completion(false)
        return
      }
      self.grantStore.grant = .granted
      self.startIfNeeded()
      completion(true)
    }
  }

  /// Suspend the sensors — used by backgrounding and rotation. Touch
  /// equivalents keep working; the router simply loses the vessel channel
  /// until `resume()`.
  public func suspend() {
    guard running else { return }
    manager.stopDeviceMotionUpdates()
    manager.stopAccelerometerUpdates()
    running = false
  }

  /// Resume without prompting. If no grant exists, this is a no-op — the
  /// invitation must arrive from a real user gesture.
  public func resume() {
    guard !listeners.isEmpty, isAvailable, currentGrant == .granted else { return }
    startIfNeeded()
  }

  private func startIfNeeded() {
    guard !running, isAvailable, !listeners.isEmpty else { return }
    running = true
    if manager.isDeviceMotionAvailable {
      manager.startDeviceMotionUpdates(to: queue) { [weak self] (motion: CMDeviceMotion?, error: Error?) in
        guard let self, let motion, error == nil else { return }
        self.consume(motion: motion)
      }
    }
    if manager.isAccelerometerAvailable {
      manager.startAccelerometerUpdates(to: queue) { [weak self] (data: CMAccelerometerData?, error: Error?) in
        guard let self, let data, error == nil else { return }
        self.consume(acceleration: data.acceleration, at: data.timestamp)
      }
    }
  }

  private func stop() {
    guard running else { return }
    manager.stopDeviceMotionUpdates()
    manager.stopAccelerometerUpdates()
    running = false
  }

  private func consume(motion: CMDeviceMotion) {
    let now = clock()
    if now - lastTiltAt >= 0.05 {
      lastTiltAt = now
      let tilt = TiltEvent(beta: motion.attitude.pitch * 180 / .pi, gamma: motion.attitude.roll * 180 / .pi)
      for listener in listeners.values { listener.onTilt?(tilt) }
      let absBeta = abs(tilt.beta)
      if !faceDown && absBeta > VesselSensors.flipEnterDeg {
        faceDown = true
        for listener in listeners.values { listener.onFlip?(true) }
      } else if faceDown && absBeta < VesselSensors.flipExitDeg {
        faceDown = false
        for listener in listeners.values { listener.onFlip?(false) }
      }
    }
  }

  private func consume(acceleration: CMAcceleration, at timestamp: TimeInterval) {
    let now = timestamp
    samples.append(Sample(x: acceleration.x, y: acceleration.y, z: acceleration.z, atMs: now * 1_000))
    if samples.count > VesselSensors.sampleCap { samples.removeFirst(samples.count - VesselSensors.sampleCap) }
    let intensity = shakeIntensity(now: now * 1_000)
    if intensity > 0 && (now * 1_000) - lastShakeAt > VesselSensors.shakeCooldownMs {
      lastShakeAt = now * 1_000
      for listener in listeners.values { listener.onShake?(intensity) }
      return
    }
    let magnitude = sqrt(acceleration.x * acceleration.x + acceleration.y * acceleration.y + acceleration.z * acceleration.z) * 9.81
    if magnitude > NativeGestureThresholds.knockThresh && intensity == 0 && (now * 1_000) - lastShakeAt > VesselSensors.knockCooldownMs {
      lastShakeAt = now * 1_000
      let normalised = min(1, magnitude / (NativeGestureThresholds.knockThresh * 2))
      for listener in listeners.values { listener.onKnock?(normalised) }
    }
  }

  /// Mirror of `shakeIntensity` in `src/lib/gesture/core.ts`: mean magnitude
  /// above 60% of the threshold across the window, normalised.
  private func shakeIntensity(now nowMs: Double) -> Double {
    let recent = samples.filter { nowMs - $0.atMs <= VesselSensors.shakeWindowMs }
    guard recent.count >= 4 else { return 0 }
    var over = 0
    var sum: Double = 0
    let floor = NativeGestureThresholds.shakeThresh * 0.6
    for sample in recent {
      let magnitude = sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z) * 9.81
      if magnitude > floor {
        over += 1
        sum += magnitude
      }
    }
    guard over >= 3 else { return 0 }
    let meanOver = sum / Double(over)
    let raw = (meanOver - floor) / NativeGestureThresholds.shakeThresh
    if raw < 0 { return 0 }
    if raw > 1 { return 1 }
    return raw
  }

  private func observeLifecycle() {
    let center = NotificationCenter.default
    let background = center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.suspend()
    }
    let foreground = center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.resume()
    }
    lifecycleObservers = [background, foreground]
  }
}

/// Isolates the grant memoisation so tests inject an in-memory store instead
/// of touching `UserDefaults`.
public protocol GrantStore: AnyObject, Sendable {
  var grant: VesselSensors.Grant { get set }
}

public final class UserDefaultsGrantStore: GrantStore, @unchecked Sendable {
  private let key = "objetdart:vessel:v1"
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public var grant: VesselSensors.Grant {
    get {
      guard let raw = defaults.string(forKey: key), let value = VesselSensors.Grant(rawValue: raw) else {
        return .unrequested
      }
      return value
    }
    set {
      defaults.set(newValue.rawValue, forKey: key)
    }
  }
}

public final class InMemoryGrantStore: GrantStore, @unchecked Sendable {
  private var stored: VesselSensors.Grant = .unrequested
  public init(initial: VesselSensors.Grant = .unrequested) { self.stored = initial }
  public var grant: VesselSensors.Grant {
    get { stored }
    set { stored = newValue }
  }
}
