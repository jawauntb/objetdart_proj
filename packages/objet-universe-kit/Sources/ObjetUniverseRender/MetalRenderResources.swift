import Foundation

/// Publishes a complete immutable pipeline in one lock transition. Rendering
/// sees either a ready pipeline or none at all; it can never observe a
/// partially compiled state.
final class MetalPipelinePublication<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Value?
  private var preparationStarted = false
  private var retired = false

  func beginPreparation() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard value == nil, !preparationStarted, !retired else { return false }
    preparationStarted = true
    return true
  }

  func publish(_ prepared: Value) {
    lock.lock()
    defer { lock.unlock() }
    preparationStarted = false
    if !retired { value = prepared }
  }

  func failPreparation() {
    lock.lock()
    preparationStarted = false
    lock.unlock()
  }

  func snapshot() -> Value? {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  /// Renderer-owned retry policy needs to distinguish a short compiler window
  /// from a compiler that has already declined. The publication owns that
  /// state so the display link never races the preparation queue.
  func isPreparing() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return preparationStarted
  }

  func retire() {
    lock.lock()
    retired = true
    value = nil
    lock.unlock()
  }
}

/// The small terminal policy around asynchronous Metal compilation. A new
/// material keeps the previous coherent drawable while its pipeline is in
/// flight, retries transient failures a bounded number of times, then lets the
/// renderer present its own ground instead of leaving the visitor in the room
/// they just left.
enum MetalPipelineReadinessAction: Equatable {
  case retainCurrentDrawable
  case retryPreparation
  case presentFallback
}

final class MetalPipelineRetryPolicy {
  static let maximumPreparationAttempts = 3
  static let retryBackoffFrames = 2
  static let fallbackRearmFrames = 300
  static let maximumFallbackRearms = 1

  private(set) var preparationAttempts = 0
  private var framesUntilRetry = 0
  private var fallbackFramesUntilRearm: Int?
  private var fallbackRearmCount = 0
  private var hasPresentedFallback = false

  func recordPreparationAttempt() {
    preparationAttempts += 1
    framesUntilRetry = Self.retryBackoffFrames
  }

  func recordPipelineReady() {
    preparationAttempts = 0
    framesUntilRetry = 0
    fallbackFramesUntilRearm = nil
    fallbackRearmCount = 0
    hasPresentedFallback = false
  }

  /// A foreground return gets a fresh, bounded chance to recover from a
  /// compiler-service or allocation failure without making the active frame
  /// loop retry forever.
  func resetAfterSuspend() {
    preparationAttempts = 0
    framesUntilRetry = 0
    fallbackFramesUntilRearm = nil
    fallbackRearmCount = 0
    hasPresentedFallback = false
  }

  func nextAction(isPreparing: Bool) -> MetalPipelineReadinessAction {
    guard !isPreparing else { return .retainCurrentDrawable }
    guard preparationAttempts < Self.maximumPreparationAttempts else {
      return fallbackAction()
    }
    guard framesUntilRetry == 0 else {
      framesUntilRetry -= 1
      return .retainCurrentDrawable
    }
    return .retryPreparation
  }

  private func fallbackAction() -> MetalPipelineReadinessAction {
    guard fallbackRearmCount < Self.maximumFallbackRearms else {
      return presentFallbackOnce()
    }
    if fallbackFramesUntilRearm == nil {
      fallbackFramesUntilRearm = Self.fallbackRearmFrames
      return presentFallbackOnce()
    }
    if let remaining = fallbackFramesUntilRearm, remaining > 0 {
      fallbackFramesUntilRearm = remaining - 1
      return .retainCurrentDrawable
    }

    fallbackRearmCount += 1
    fallbackFramesUntilRearm = nil
    preparationAttempts = 0
    framesUntilRetry = 0
    hasPresentedFallback = false
    return .retryPreparation
  }

  private func presentFallbackOnce() -> MetalPipelineReadinessAction {
    guard !hasPresentedFallback else { return .retainCurrentDrawable }
    hasPresentedFallback = true
    return .presentFallback
  }
}

/// Bounds retries for a scene whose material cannot yet allocate its fixed
/// resources. The scene intent stays available for a foreground return or a
/// fresh route request, but layout churn cannot turn memory pressure into a
/// hot retry loop.
public final class SceneConstructionRetryPolicy {
  public static let maximumAttempts = 3
  public static let retryInterval: TimeInterval = 1

  public private(set) var attempts = 0
  private var nextAttemptAt: TimeInterval = 0

  public init() {}

  /// A foreground return or an explicit route request begins one fresh,
  /// bounded window. It does not silently retry forever while the scene is
  /// hidden or Metal remains under pressure.
  public func reset(at now: TimeInterval) {
    attempts = 0
    nextAttemptAt = now
  }

  /// Returns true exactly for a scheduled construction attempt. Callers keep
  /// their pending intent on false, so a later lifecycle boundary can re-arm
  /// the same route without committing a renderer that never allocated.
  public func beginAttempt(at now: TimeInterval) -> Bool {
    guard attempts < Self.maximumAttempts, now >= nextAttemptAt else { return false }
    attempts += 1
    nextAttemptAt = now + Self.retryInterval
    return true
  }
}

/// A nonblocking pool of exact frame slots. A resource is returned only to
/// its own completion path, so a fast failure cannot make another in-flight
/// slot writable just because a lease became available.
final class MetalFrameSlotPool: @unchecked Sendable {
  private let lock = NSLock()
  private let capacity: Int
  private var freeSlots: [Int]

  init(capacity: Int) {
    precondition(capacity > 0)
    self.capacity = capacity
    freeSlots = Array(0 ..< capacity)
  }

  func tryAcquire() -> Int? {
    lock.lock()
    defer { lock.unlock() }
    return freeSlots.popLast()
  }

  func release(_ slot: Int) {
    lock.lock()
    defer { lock.unlock() }
    guard slot >= 0 && slot < capacity else {
      assertionFailure("released frame slot must belong to this pool")
      return
    }
    guard !freeSlots.contains(slot) else {
      assertionFailure("a frame slot may be released only once")
      return
    }
    freeSlots.append(slot)
  }
}
