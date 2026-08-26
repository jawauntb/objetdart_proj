import XCTest
@testable import ObjetUniverseCore

final class MoleculeH2OutcomeIntegrationTests: XCTestCase {
  private func converge(
    _ outcome: MoleculeH2Outcome,
    epoch: H2RHFContactEpoch = .number(11)
  ) -> [MoleculeH2OutcomeEvent] {
    _ = outcome.beginContact(
      separationAngstrom: 0.9,
      rawSeparationAngstrom: 0.9,
      contactEpoch: epoch
    )
    _ = outcome.release(separationAngstrom: 0.9, rawSeparationAngstrom: 0.9)
    for _ in 0 ..< H2RHFCassette.trusted.solver.maxIterations {
      _ = outcome.tick()
      if outcome.authority.snapshot().disposition == .promoted { break }
    }
    return outcome.drainOutcomes { Array($0) }
  }

  func testAcceptedConvergedAndCorrectingMilestonesAreEachEmittedOnce() {
    let outcome = MoleculeH2Outcome(bodyID: 7, targetID: "molecule-7")
    let first = converge(outcome)
    XCTAssertEqual(first.filter { $0.kind == .correcting }.count, 1)
    XCTAssertEqual(first.filter { $0.kind == .converged }.count, 1)
    XCTAssertEqual(first.filter { $0.kind == .accepted }.count, 0)
    XCTAssertEqual(first.filter(\.isAccepted).count, 1)
    XCTAssertEqual(first.filter { $0.fieldKind == .settled }.count, 1)
    XCTAssertEqual(Set(first.map(\.id)).count, first.count)
    XCTAssertEqual(outcome.drainOutcomes { Array($0) }, [])

    // Snapshotting and retrying a drain cannot replay a cue; the adapter and
    // authority remain the one shared cursor for every consumer.
    _ = outcome.snapshot()
    XCTAssertEqual(outcome.drainOutcomes { Array($0) }, [])
  }

  func testRefusalEmitsOneRefusalAndOneRollbackAndRetainsLastGood() {
    let outcome = MoleculeH2Outcome(
      bodyID: 9,
      targetID: "molecule-9",
      authority: H2RHFAuthority(options: .init(testSeam: .init(forceMaxIterations: true)))
    )
    let before = outcome.authority.snapshot().lastGood?.digest
    _ = outcome.beginContact(separationAngstrom: 0.9, contactEpoch: .number(12))
    _ = outcome.release(separationAngstrom: 0.9)
    _ = outcome.tick()
    _ = try! outcome.authority.advanceTicks(H2RHFCassette.trusted.solver.maxIterations)
    // The direct authority advance above is intentional: collect through a
    // snapshot, as a host would after a bounded tick loop.
    let events = outcome.snapshot().outcomes
    XCTAssertEqual(events.filter { $0.kind == .refused }.count, 1)
    XCTAssertEqual(events.filter { $0.kind == .rollback }.count, 0)
    XCTAssertEqual(events.filter(\.isRollback).count, 1)
    XCTAssertEqual(events.filter { $0.fieldKind == .refused }.count, 1)
    XCTAssertEqual(Set(events.map(\.id)).count, events.count)
    XCTAssertEqual(outcome.authority.snapshot().lastGood?.digest, before)
  }

  func testProvisionalCandidateCannotReplaceLastGoodCheckpoint() {
    let outcome = MoleculeH2Outcome(bodyID: 13, targetID: "molecule-13")
    let before = outcome.authority.snapshot().lastGood?.digest
    _ = outcome.beginContact(separationAngstrom: 0.9, contactEpoch: .number(21))
    _ = outcome.tick()
    XCTAssertEqual(outcome.authority.snapshot().lastGood?.digest, before)
    XCTAssertNotNil(outcome.authority.snapshot().movingCandidate)

    _ = outcome.release(separationAngstrom: 0.9)
    for _ in 0 ..< H2RHFCassette.trusted.solver.maxIterations {
      _ = outcome.tick()
      if outcome.authority.snapshot().disposition == .promoted { break }
    }
    XCTAssertEqual(outcome.authority.snapshot().disposition, .promoted)
    XCTAssertNotEqual(outcome.authority.snapshot().lastGood?.digest, before)
    XCTAssertNil(outcome.authority.snapshot().movingCandidate)
    XCTAssertNil(outcome.authority.snapshot().frozenCandidate)
  }

  func testOutcomeTargetIDAndAdapterCadenceRemainStableAcrossPresentationFrames() throws {
    let outcome = MoleculeH2Outcome(bodyID: 17, targetID: "molecule-17")
    _ = outcome.beginContact(separationAngstrom: 0.9, contactEpoch: .string("epoch"))
    _ = outcome.release(separationAngstrom: 0.9)
    for _ in 0 ..< 10 { _ = try outcome.advancePresentation(1000.0 / 60.0) }
    XCTAssertEqual(outcome.snapshot().bodyID, 17)
    XCTAssertEqual(outcome.snapshot().targetID, "molecule-17")
    XCTAssertEqual(outcome.snapshot().adapter.logicalTicks, 3)
    XCTAssertEqual(outcome.snapshot().authority.tick, 3)
  }

  func testEventIDsIncludeBodyEpochTickAndMilestoneKind() {
    let first = MoleculeH2Outcome(bodyID: 17, targetID: "molecule-17")
    let firstEpoch = converge(first, epoch: .number(11))
    let secondEpoch = converge(first, epoch: .number(12))
    let otherBody = MoleculeH2Outcome(bodyID: 18, targetID: "molecule-18")
    let otherEvents = converge(otherBody, epoch: .number(11))

    let all = firstEpoch + secondEpoch + otherEvents
    XCTAssertEqual(Set(all.map(\.id)).count, all.count)
    XCTAssertTrue(firstEpoch.contains { $0.id.contains("molecule-h2-17-n-11-") })
    XCTAssertTrue(secondEpoch.contains { $0.id.contains("molecule-h2-17-n-12-") })
    XCTAssertTrue(otherEvents.contains { $0.id.contains("molecule-h2-18-n-11-") })
    XCTAssertNotEqual(firstEpoch.last?.id, secondEpoch.last?.id)
    XCTAssertNotEqual(firstEpoch.last?.id, otherEvents.last?.id)
  }

  func testOutcomeDedupeAndPublishedLedgerRemainBoundedAcrossManyEpochs() {
    let outcome = MoleculeH2Outcome(bodyID: 31, targetID: "molecule-31")
    for epoch in 0 ..< 300 {
      _ = outcome.beginContact(
        separationAngstrom: 99,
        contactEpoch: .number(Double(epoch))
      )
    }
    XCTAssertLessThanOrEqual(outcome.dedupeEntryCount, 256)
    XCTAssertLessThanOrEqual(outcome.snapshot().outcomes.count, 64)
  }

  func testKernelPresentationSchedulesShareTheSameTwentyHertzAuthorityTicks() {
    let schedules: [Int] = [30, 60, 120]
    var logicalTicks: [Int] = []
    var authorityTicks: [Int] = []
    for framesPerSecond in schedules {
      let kernel = MoleculeKernel(
        seed: 109_017_827,
        secondsPerTick: 1.0 / Double(framesPerSecond)
      )
      _ = kernel.advance(ticks: framesPerSecond)
      logicalTicks.append(kernel.h2Outcome?.adapter.snapshot().logicalTicks ?? -1)
      authorityTicks.append(kernel.h2Outcome?.authority.snapshot().tick ?? -1)
    }
    XCTAssertEqual(logicalTicks, [20, 20, 20])
    XCTAssertEqual(authorityTicks, [20, 20, 20])
  }
}
