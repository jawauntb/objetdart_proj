import Foundation

public struct ClockFrame: Equatable, Sendable {
  public let steps: [ClockStep]
  public let interpolation: Double
  public let droppedDebt: Bool
  public let appliedActionOrdinals: [Int]
}

public struct ClockStep: Equatable, Sendable {
  public let tick: Int
  public let actionOrdinals: [Int]
}

private struct ScheduledAction: Comparable, Sendable {
  let targetTick: Int
  let ordinal: Int

  static func < (lhs: ScheduledAction, rhs: ScheduledAction) -> Bool {
    lhs.targetTick == rhs.targetTick ? lhs.ordinal < rhs.ordinal : lhs.targetTick < rhs.targetTick
  }
}

/// The sole authority clock. Presentation cadence changes interpolation, never the
/// number or ordering of authoritative integration steps.
public struct UniverseClock: Sendable {
  /// The authoritative step. Every kernel that converts ticks into seconds
  /// reads it from here rather than restating the number.
  public static let defaultStepSeconds: TimeInterval = 1.0 / 120.0

  public private(set) var logicalTick = 0
  public let stepSeconds: TimeInterval
  public let maxStepsPerFrame: Int
  public let maxPendingActions: Int
  public var pendingActionCount: Int { scheduledActions.count - nextUnappliedAction }

  private var lastPresentationTime: TimeInterval?
  private var schedulingOrigin: (time: TimeInterval, tick: Int)?
  private var accumulator: TimeInterval = 0
  private var suspended = false
  private var nextActionOrdinal = 0
  private var scheduledActions: [ScheduledAction] = []
  private var nextUnappliedAction = 0

  public init(
    stepSeconds: TimeInterval = UniverseClock.defaultStepSeconds,
    maxStepsPerFrame: Int = 2,
    maxPendingActions: Int = 1_024
  ) {
    precondition(stepSeconds > 0)
    precondition(maxStepsPerFrame > 0)
    precondition(maxPendingActions > 0)
    self.stepSeconds = stepSeconds
    self.maxStepsPerFrame = maxStepsPerFrame
    self.maxPendingActions = maxPendingActions
  }

  /// Returns the command ordinal when it can be scheduled. Actions are assigned to
  /// fixed tick boundaries, never to presentation frames.
  public mutating func enqueue(actionAt at: TimeInterval) -> Int? {
    guard at.isFinite, pendingActionCount < maxPendingActions else { return nil }
    if schedulingOrigin == nil { schedulingOrigin = (at, logicalTick) }
    guard let origin = schedulingOrigin else { return nil }
    let elapsed = at - origin.time
    let requestedTick = origin.tick + Int(floor(elapsed / stepSeconds)) + 1
    let action = ScheduledAction(targetTick: max(logicalTick + 1, requestedTick), ordinal: nextActionOrdinal)
    if let last = scheduledActions.last, last <= action {
      scheduledActions.append(action)
    } else {
      let insertion = insertionIndex(for: action)
      scheduledActions.insert(action, at: insertion)
    }
    nextActionOrdinal += 1
    return action.ordinal
  }

  public mutating func suspend() {
    suspended = true
    accumulator = 0
  }

  /// Resume is closed-form: it establishes a fresh presentation origin and never
  /// attempts to replay time spent in the background.
  public mutating func resume(at presentationTime: TimeInterval) {
    lastPresentationTime = presentationTime
    schedulingOrigin = (presentationTime, logicalTick)
    accumulator = 0
    suspended = false
  }

  public mutating func advance(to presentationTime: TimeInterval) -> ClockFrame {
    guard presentationTime.isFinite, !suspended else {
      return .init(steps: [], interpolation: 0, droppedDebt: false, appliedActionOrdinals: [])
    }
    guard let previous = lastPresentationTime else {
      lastPresentationTime = presentationTime
      if schedulingOrigin == nil { schedulingOrigin = (presentationTime, logicalTick) }
      return .init(steps: [], interpolation: 0, droppedDebt: false, appliedActionOrdinals: [])
    }

    let elapsed = max(0, presentationTime - previous)
    lastPresentationTime = presentationTime
    accumulator += elapsed
    // Presentation timestamps are binary floating point; keep an exact fixed-step
    // boundary from becoming a zero-step frame because of a rounding ulp.
    let requestedSteps = Int((accumulator + stepSeconds * 1e-9) / stepSeconds)
    let steps = min(requestedSteps, maxStepsPerFrame)
    accumulator = max(0, accumulator - Double(steps) * stepSeconds)
    let droppedDebt = requestedSteps > maxStepsPerFrame
    if droppedDebt { accumulator = 0 }
    var clockSteps: [ClockStep] = []
    clockSteps.reserveCapacity(steps)
    for _ in 0 ..< steps {
      logicalTick += 1
      let actions = applyActions(through: logicalTick)
      clockSteps.append(.init(tick: logicalTick, actionOrdinals: actions))
    }

    return .init(
      steps: clockSteps,
      interpolation: accumulator / stepSeconds,
      droppedDebt: droppedDebt,
      appliedActionOrdinals: clockSteps.flatMap(\.actionOrdinals)
    )
  }

  private mutating func applyActions(through tick: Int) -> [Int] {
    var end = nextUnappliedAction
    while end < scheduledActions.count, scheduledActions[end].targetTick <= tick {
      end += 1
    }
    let due = scheduledActions[nextUnappliedAction ..< end].map(\.ordinal)
    nextUnappliedAction = end
    if nextUnappliedAction >= 64, nextUnappliedAction * 2 >= scheduledActions.count {
      scheduledActions.removeFirst(nextUnappliedAction)
      nextUnappliedAction = 0
    }
    return due
  }

  private func insertionIndex(for action: ScheduledAction) -> Int {
    var lower = nextUnappliedAction
    var upper = scheduledActions.count
    while lower < upper {
      let middle = (lower + upper) / 2
      if scheduledActions[middle] < action { lower = middle + 1 } else { upper = middle }
    }
    return lower
  }
}
