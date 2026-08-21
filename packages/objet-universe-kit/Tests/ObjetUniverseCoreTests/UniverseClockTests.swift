import XCTest
@testable import ObjetUniverseCore

private struct AppliedAction: Equatable {
  let tick: Int
  let ordinal: Int
}

final class UniverseClockTests: XCTestCase {
  func testAuthoritativeTraceIsIndependentOfPresentationRate() {
    let actions = [0.0, 0.35, 1.1, 1.75]
    let thirty = trace(presentationRate: 30, actionTimes: actions)
    let sixty = trace(presentationRate: 60, actionTimes: actions)
    let oneTwenty = trace(presentationRate: 120, actionTimes: actions)

    XCTAssertEqual(thirty, [
      .init(tick: 1, ordinal: 0),
      .init(tick: 43, ordinal: 1),
      .init(tick: 133, ordinal: 2),
      .init(tick: 211, ordinal: 3),
    ])
    XCTAssertEqual(thirty, sixty)
    XCTAssertEqual(sixty, oneTwenty)
  }

  func testResumeDropsPresentationDebtInsteadOfReplayingIt() {
    var clock = UniverseClock(
      stepSeconds: 1.0 / 120.0,
      maxStepsPerFrame: 8,
      maxStallStepsPerFrame: 8
    )
    _ = clock.advance(to: 0)
    _ = clock.advance(to: 1.0 / 60.0)
    let beforePause = clock.logicalTick

    clock.suspend()
    clock.resume(at: 121.0)
    let resumed = clock.advance(to: 121.0 + 1.0 / 60.0)

    XCTAssertEqual(resumed.steps.count, 2)
    XCTAssertLessThanOrEqual(clock.logicalTick - beforePause, 2)
    XCTAssertFalse(resumed.droppedDebt)
  }

  func testStallIsBoundedAndDoesNotAccumulateDebt() {
    var clock = UniverseClock(
      stepSeconds: 1.0 / 120.0,
      maxStepsPerFrame: 8,
      maxStallStepsPerFrame: 8
    )
    _ = clock.advance(to: 0)
    let stalled = clock.advance(to: 10)
    let next = clock.advance(to: 10 + 1.0 / 120.0)

    XCTAssertEqual(stalled.steps.count, 8)
    XCTAssertTrue(stalled.droppedDebt)
    XCTAssertEqual(next.steps.count, 1)
  }

  func testProductionDefaultAdvancesAtBothSupportedPresentationCadences() {
    for presentationRate in [30, 60] {
      var clock = UniverseClock()
      _ = clock.advance(to: 0)
      var droppedDebt = false
      for frame in 1 ... presentationRate {
        droppedDebt = droppedDebt || clock.advance(to: Double(frame) / Double(presentationRate)).droppedDebt
      }

      XCTAssertEqual(clock.logicalTick, 120, "\(presentationRate) Hz presentation must sustain the 120 Hz authority clock")
      XCTAssertFalse(droppedDebt, "a supported display cadence is not a stall")
    }
  }

  func testProductionDefaultCommandsKeepTheirLogicalTicksAtThirtyAndSixtyHertz() {
    let actions = [0.0, 0.35, 0.8]
    let thirty = productionTrace(presentationRate: 30, actionTimes: actions)
    let sixty = productionTrace(presentationRate: 60, actionTimes: actions)

    XCTAssertEqual(thirty, [
      .init(tick: 1, ordinal: 0),
      .init(tick: 43, ordinal: 1),
      .init(tick: 97, ordinal: 2),
    ])
    XCTAssertEqual(thirty, sixty)
  }

  func testProductionDefaultDropsLargeDebtAfterAtMostTwoStallSteps() {
    var clock = UniverseClock()
    _ = clock.advance(to: 0)

    let stalled = clock.advance(to: 10)
    let next = clock.advance(to: 10 + UniverseClock.defaultStepSeconds)

    XCTAssertEqual(stalled.steps.count, 2, "one presentation frame must never monopolise the main thread")
    XCTAssertTrue(stalled.droppedDebt, "discarded wall-clock debt must remain observable")
    XCTAssertEqual(next.steps.count, 1, "discarded debt must not leak into following frames")
  }

  func testCommandEnqueuedImmediatelyAfterAStallLandsOnTheNextFixedStep() {
    var clock = UniverseClock()
    _ = clock.advance(to: 0)
    XCTAssertTrue(clock.advance(to: 10).droppedDebt)

    XCTAssertEqual(clock.enqueue(actionAt: 10), 0)
    let next = clock.advance(to: 10 + UniverseClock.defaultStepSeconds)

    XCTAssertEqual(next.appliedActionOrdinals, [0])
  }

  func testDebtDropRebasesPendingActionsWithoutDiscardingOrReorderingThem() {
    var clock = UniverseClock()
    _ = clock.advance(to: 0)
    XCTAssertEqual(clock.enqueue(actionAt: 0.6), 0)
    XCTAssertEqual(clock.enqueue(actionAt: 0.5), 1)
    XCTAssertEqual(clock.enqueue(actionAt: 20), 2)

    XCTAssertTrue(clock.advance(to: 10).droppedDebt)
    XCTAssertEqual(
      clock.advance(to: 10 + UniverseClock.defaultStepSeconds).appliedActionOrdinals,
      [0, 1],
      "an action inside discarded wall time must coalesce onto the next authoritative tick"
    )
    XCTAssertEqual(clock.pendingActionCount, 1, "future actions survive debt rebasing")
  }

  func testOutOfOrderActionsKeepTimestampOrderAtFixedBoundaries() {
    var clock = UniverseClock(
      stepSeconds: 1.0 / 120.0,
      maxStepsPerFrame: 120,
      maxStallStepsPerFrame: 120
    )
    _ = clock.advance(to: 0)
    XCTAssertEqual(clock.enqueue(actionAt: 1.0), 0)
    XCTAssertEqual(clock.enqueue(actionAt: 0.5), 1)
    XCTAssertEqual(clock.enqueue(actionAt: 1.0), 2)

    XCTAssertEqual(clock.advance(to: 0.5 + 1.0 / 120.0).appliedActionOrdinals, [1])
    XCTAssertEqual(clock.advance(to: 1.0 + 1.0 / 120.0).appliedActionOrdinals, [0, 2])
  }

  func testFutureQueueIsBoundedAndRejectsBackpressure() {
    var clock = UniverseClock(maxPendingActions: 2)
    _ = clock.advance(to: 0)
    XCTAssertEqual(clock.enqueue(actionAt: 100), 0)
    XCTAssertEqual(clock.enqueue(actionAt: 101), 1)
    XCTAssertNil(clock.enqueue(actionAt: 102))
    XCTAssertEqual(clock.pendingActionCount, 2)
  }

  func testFirstCommandCanArriveBeforeTheFirstPresentationFrame() {
    var clock = UniverseClock()
    XCTAssertEqual(clock.enqueue(actionAt: 12), 0)
    _ = clock.advance(to: 12)
    XCTAssertEqual(clock.advance(to: 12 + 1.0 / 120.0).appliedActionOrdinals, [0])
  }

  private func trace(presentationRate: Int, actionTimes: [Double]) -> [AppliedAction] {
    var clock = UniverseClock(
      stepSeconds: 1.0 / 120.0,
      maxStepsPerFrame: 120,
      maxStallStepsPerFrame: 120
    )
    _ = clock.advance(to: 0)
    for action in actionTimes { XCTAssertNotNil(clock.enqueue(actionAt: action)) }
    var trace: [AppliedAction] = []
    let duration = 2.0
    let frames = Int(Double(presentationRate) * duration)

    for frame in 1 ... frames {
      let time = Double(frame) / Double(presentationRate)
      for step in clock.advance(to: time).steps {
        trace.append(contentsOf: step.actionOrdinals.map { .init(tick: step.tick, ordinal: $0) })
      }
    }
    return trace
  }

  private func productionTrace(presentationRate: Int, actionTimes: [Double]) -> [AppliedAction] {
    var clock = UniverseClock()
    _ = clock.advance(to: 0)
    for action in actionTimes { XCTAssertNotNil(clock.enqueue(actionAt: action)) }
    var trace: [AppliedAction] = []
    for frame in 1 ... presentationRate {
      for step in clock.advance(to: Double(frame) / Double(presentationRate)).steps {
        trace.append(contentsOf: step.actionOrdinals.map { .init(tick: step.tick, ordinal: $0) })
      }
    }
    return trace
  }
}
