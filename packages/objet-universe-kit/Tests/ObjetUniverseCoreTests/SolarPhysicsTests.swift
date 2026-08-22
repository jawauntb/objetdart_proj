import XCTest
import simd
@testable import ObjetUniverseCore

final class SolarPhysicsTests: XCTestCase {
  func testCanonicalWebSeedFixtureParity() {
    let bodies = SolarPhysics.seededBodies(seed: 0x501a12)
    XCTAssertEqual(bodies.count, 6)
    XCTAssertEqual(bodies[0].id, 3_775_899_274)
    XCTAssertEqual(bodies[0].mass, 0.00041850200237049785, accuracy: 1e-16)
    XCTAssertEqual(bodies[0].position.x, 0.22677209029484555, accuracy: 1e-13)
    XCTAssertEqual(bodies[0].position.y, 0.4672492227049159, accuracy: 1e-13)
    XCTAssertEqual(bodies[0].velocity.x, -0.014800184407077602, accuracy: 1e-14)
    XCTAssertEqual(bodies[0].velocity.y, 0.003707678994236702, accuracy: 1e-14)
    XCTAssertEqual(bodies[5].id, 1_694_739_043)
    XCTAssertEqual(bodies[5].position.x, 1.4395027390060098, accuracy: 1e-12)
    XCTAssertEqual(bodies[5].position.y, 2.4468683308818013, accuracy: 1e-12)
  }

  func testFixedStepCadenceAndDigestArePartitionIndependent() {
    let single = SolarKernel(seed: 77)
    let partitioned = SolarKernel(seed: 77)
    let singleOutput = single.advance(ticks: 240)
    _ = partitioned.advance(ticks: 73)
    let partitionedOutput = partitioned.advance(ticks: 167)
    XCTAssertEqual(single.bodies, partitioned.bodies)
    XCTAssertEqual(singleOutput.checkpoint, partitionedOutput.checkpoint)
  }

  func testCanonicalTwoBodyOrbitClosesWithBoundedEnergyDrift() {
    let initial = SolarBodyState(
      id: 1,
      seed: 1,
      kind: .planet,
      position: SIMD2(1, 0),
      velocity: SIMD2(0, SolarPhysics.circularSpeed(radius: 1)),
      mass: 0.001
    )
    let kernel = SolarKernel(seed: 1, bodies: [initial], secondsPerTick: 1.0 / 60.0)
    let initialEnergy = kernel.energy
    _ = kernel.advance(ticks: 32_400)
    let relativeEnergyDrift = abs((kernel.energy - initialEnergy) / initialEnergy)
    XCTAssertLessThan(relativeEnergyDrift, 1e-8)
    XCTAssertLessThan(simd_distance(kernel.bodies[0].position, initial.position), 1e-5)
  }

  func testPredictionHas64SamplesAndDoesNotMutateAuthority() {
    let kernel = SolarKernel(seed: 91)
    let before = kernel.advance(ticks: 0).checkpoint
    var predictionCount = 0
    var bodyCount = 0
    kernel.withSolarRenderSnapshot { snapshot in
      predictionCount = snapshot.predictionPoints.count
      bodyCount = snapshot.bodies.count
    }
    let after = kernel.advance(ticks: 0).checkpoint
    XCTAssertEqual(predictionCount, SolarPhysics.predictionSampleCount)
    XCTAssertEqual(bodyCount, SolarPhysics.planetCount)
    XCTAssertEqual(before, after)
  }

  func testTrailRingIsBoundedAndSnapshotSlicesAreOrdered() {
    let kernel = SolarKernel(seed: 21)
    _ = kernel.advance(ticks: SolarPhysics.trailCapacityPerBody * 3)
    kernel.withSolarRenderSnapshot { snapshot in
      XCTAssertLessThanOrEqual(snapshot.trailPoints.count, snapshot.bodies.count * SolarPhysics.trailCapacityPerBody)
      for body in snapshot.bodies {
        XCTAssertEqual(body.trailCount, SolarPhysics.trailCapacityPerBody)
        let slice = snapshot.trailPoints[body.trailOffset ..< body.trailOffset + body.trailCount]
        XCTAssertEqual(slice.first?.bodyID, body.id)
        XCTAssertEqual(slice.last?.bodyID, body.id)
        XCTAssertEqual(slice.first?.age, 1)
        XCTAssertEqual(slice.last?.age, 0)
      }
    }
  }

  func testMergeConservesMassAndLinearMomentumAndKeepsHeavierIdentity() {
    let first = SolarBodyState(id: 10, seed: 10, kind: .planet, position: SIMD2(1, 0), velocity: SIMD2(0.01, 0.02), mass: 0.02)
    let second = SolarBodyState(id: 20, seed: 20, kind: .comet, position: SIMD2(1.01, 0), velocity: SIMD2(-0.03, 0.01), mass: 0.005)
    let beforeMomentum = first.velocity * first.mass + second.velocity * second.mass
    let merged = SolarPhysics.merged(first, second)
    XCTAssertEqual(merged.id, first.id)
    XCTAssertEqual(merged.mass, first.mass + second.mass, accuracy: 1e-15)
    XCTAssertEqual(merged.velocity.x * merged.mass, beforeMomentum.x, accuracy: 1e-15)
    XCTAssertEqual(merged.velocity.y * merged.mass, beforeMomentum.y, accuracy: 1e-15)
  }

  func testKernelCollisionEmitsAuthoritativePulseAndOutcome() {
    let circular = SolarPhysics.circularSpeed(radius: 1)
    let first = SolarBodyState(id: 10, seed: 10, kind: .planet, position: SIMD2(1, 0), velocity: SIMD2(0, circular), mass: 0.01)
    let second = SolarBodyState(id: 20, seed: 20, kind: .comet, position: SIMD2(1.01, 0), velocity: SIMD2(0, circular), mass: 0.005)
    let kernel = SolarKernel(seed: 1, bodies: [first, second])
    _ = kernel.advance(ticks: 1)
    XCTAssertEqual(kernel.bodies.count, 1)
    kernel.withSolarRenderSnapshot { snapshot in
      XCTAssertGreaterThan(snapshot.collisionPulse, 0)
      XCTAssertEqual(snapshot.bodies.count, 1)
    }
    var kinds: [SimulationOutcomeKind] = []
    kernel.drainSimulationOutcomes { outcomes in kinds = outcomes.map(\.kind) }
    XCTAssertEqual(kinds, [.collision])
    kernel.drainSimulationOutcomes { XCTAssertTrue($0.isEmpty) }
  }

  func testBoundEscapeAndConsumedOutcomesHaveNoOuterBounce() {
    let circular = SolarPhysics.circularSpeed(radius: 1)
    let bound = SolarBodyState(id: 1, seed: 1, kind: .planet, position: SIMD2(1, 0), velocity: SIMD2(0, circular), mass: 0.001)
    let escaped = SolarBodyState(id: 2, seed: 2, kind: .comet, position: SIMD2(4, 0), velocity: SIMD2(0, SolarPhysics.escapeSpeed(radius: 4) * 1.01), mass: 0.001)
    let consumed = SolarBodyState(id: 3, seed: 3, kind: .comet, position: SIMD2(0.05, 0), velocity: .zero, mass: 0.001)
    XCTAssertEqual(SolarPhysics.fate(of: bound), .bound)
    XCTAssertEqual(SolarPhysics.fate(of: escaped), .escaped)
    XCTAssertEqual(SolarPhysics.fate(of: consumed), .consumed)
    let kernel = SolarKernel(seed: 2, bodies: [bound, escaped, consumed])
    _ = kernel.advance(ticks: 1)
    XCTAssertEqual(kernel.bodies.map(\.id), [1])
    XCTAssertEqual(kernel.escapedCount, 1)
    XCTAssertEqual(kernel.consumedCount, 1)
  }

  func testOneContactReleaseCreatesExactlyOneBody() {
    let kernel = SolarKernel(seed: 33)
    let before = kernel.bodies.count
    let point = SemanticOrigin(x: 0.72, y: 0.35)
    for (index, phase) in [SemanticGesturePhase.enter, .tick, .tick].enumerated() {
      _ = kernel.apply(.init(id: "hold-\(index)", verb: .grow, at: 0, payload: .init(contact: .init(phase: phase, point: point, durationSeconds: 1.2))))
    }
    XCTAssertEqual(kernel.bodies.count, before)
    kernel.withSolarRenderSnapshot { XCTAssertNotNil($0.accretionPreview) }
    _ = kernel.apply(.init(id: "hold-release", verb: .grow, at: 1.2, payload: .init(contact: .init(phase: .release, point: point, durationSeconds: 1.2))))
    XCTAssertEqual(kernel.bodies.count, before + 1)
    kernel.withSolarRenderSnapshot { XCTAssertNil($0.accretionPreview) }
    XCTAssertEqual(Set(kernel.bodies.map(\.id)).count, kernel.bodies.count)
  }

  func testDuplicateReleaseIDCreatesOneBodyAndOneOutcome() {
    let kernel = SolarKernel(seed: 34)
    let before = kernel.bodies.count
    let command = SemanticCommand(
      id: "one-release",
      verb: .grow,
      at: 1,
      payload: .init(contact: .init(
        phase: .release,
        point: SemanticOrigin(x: 0.72, y: 0.35),
        durationSeconds: 1.2
      ))
    )

    _ = kernel.apply(command)
    _ = kernel.apply(command)
    _ = kernel.advance(ticks: 1)

    XCTAssertEqual(kernel.bodies.count, before + 1)
    kernel.drainSimulationOutcomes { outcomes in
      XCTAssertEqual(outcomes.filter { $0.kind == .created }.count, 1)
    }
  }

  func testApplyOutcomeWaitsForDestinationTickAndPostAdvanceEnergy() {
    let kernel = SolarKernel(seed: 340)
    let host = UniverseHost(initial: kernel, factory: { _ in kernel })
    _ = host.advance(to: 0)
    let command = SemanticCommand(
      id: "destination-outcome",
      verb: .grow,
      at: 0,
      payload: .init(contact: .init(
        phase: .release,
        point: SemanticOrigin(x: 0.72, y: 0.35),
        durationSeconds: 1.2
      ))
    )

    XCTAssertEqual(host.apply(command), .scheduled)
    kernel.drainSimulationOutcomes { XCTAssertTrue($0.isEmpty) }
    _ = host.advance(to: UniverseClock.defaultStepSeconds)

    kernel.drainSimulationOutcomes { outcomes in
      let created = outcomes.first { $0.kind == .created }
      XCTAssertEqual(created?.tick, host.telemetry.logicalTick)
      XCTAssertEqual(created?.energy ?? .nan, kernel.energy, accuracy: 1e-12)
    }
  }

  func testEveryCommandIDIsDeduplicatedWithinABoundedWindow() {
    let kernel = SolarKernel(seed: 341)
    let duplicate = SemanticCommand(id: "same-lens", verb: .lens, at: 0)

    _ = kernel.apply(duplicate)
    _ = kernel.apply(duplicate)
    XCTAssertEqual(kernel.representation, 1)

    for index in 0 ..< 600 {
      _ = kernel.apply(.init(id: "lens-\(index)", verb: .lens, at: Double(index)))
    }
    XCTAssertEqual(kernel.recentAppliedCommandIDCount, 512)

    let beforeRecentRetry = kernel.representation
    _ = kernel.apply(.init(id: "lens-599", verb: .lens, at: 601))
    XCTAssertEqual(kernel.representation, beforeRecentRetry)

    _ = kernel.apply(duplicate)
    XCTAssertEqual(kernel.representation, (beforeRecentRetry + 1) % 4)
  }

  func testCommandDigestRetainsHistoryBeyondTheRecentDeduplicationWindow() {
    let left = SolarKernel(seed: 342)
    let right = SolarKernel(seed: 342)
    for index in 0 ..< 600 {
      let leftID = index < 88 ? "left-prefix-\(index)" : "shared-\(index)"
      let rightID = index < 88 ? "right-prefix-\(index)" : "shared-\(index)"
      _ = left.apply(.init(id: leftID, verb: .train, at: Double(index)))
      _ = right.apply(.init(id: rightID, verb: .train, at: Double(index)))
    }

    XCTAssertEqual(left.recentAppliedCommandIDCount, 512)
    XCTAssertEqual(right.recentAppliedCommandIDCount, 512)
    XCTAssertEqual(left.bodies, right.bodies)
    XCTAssertNotEqual(left.advance(ticks: 0).checkpoint.digest, right.advance(ticks: 0).checkpoint.digest)
  }

  func testNeutralTiltIsNonCumulativeAtTwentyHertz() {
    let kernel = SolarKernel(seed: 35)
    let originalBodies = kernel.bodies
    for index in 0 ..< 200 {
      _ = kernel.apply(.init(
        id: "neutral-tilt-\(index)",
        verb: .gravity,
        at: Double(index) / 20,
        payload: .init(vessel: .init(betaDegrees: 0, gammaDegrees: 0))
      ))
    }

    kernel.withSolarRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.centralMass, 1, accuracy: 1e-6)
    }
    XCTAssertEqual(kernel.bodies, originalBodies)
  }

  func testSignedTiltMapsAbsolutelyAroundNeutral() {
    let kernel = SolarKernel(seed: 36)
    _ = kernel.apply(.init(
      id: "tilt-right",
      verb: .gravity,
      at: 0,
      payload: .init(vessel: .init(betaDegrees: 0, gammaDegrees: 90))
    ))
    kernel.withSolarRenderSnapshot { XCTAssertEqual($0.centralMass, 1.5, accuracy: 1e-6) }

    _ = kernel.apply(.init(
      id: "tilt-left",
      verb: .gravity,
      at: 1,
      payload: .init(vessel: .init(betaDegrees: 0, gammaDegrees: -90))
    ))
    kernel.withSolarRenderSnapshot { XCTAssertEqual($0.centralMass, 0.5, accuracy: 1e-6) }

    _ = kernel.apply(.init(
      id: "tilt-neutral",
      verb: .gravity,
      at: 2,
      payload: .init(vessel: .init(betaDegrees: 0, gammaDegrees: 0))
    ))
    kernel.withSolarRenderSnapshot { XCTAssertEqual($0.centralMass, 1, accuracy: 1e-6) }
  }

  func testCeremonyLocksAConjunctionWithoutCreatingBodies() {
    let kernel = SolarKernel(seed: 55)
    let beforeIDs = kernel.bodies.map(\.id)
    _ = kernel.apply(.init(id: "conjunction", verb: .ceremony, at: 0, origin: SemanticOrigin(x: 0.8, y: 0.5)))
    XCTAssertEqual(kernel.bodies.map(\.id), beforeIDs)
    let angles = kernel.bodies.map { atan2($0.position.y, $0.position.x) }
    XCTAssertTrue(angles.dropFirst().allSatisfy { abs($0 - angles[0]) < 1e-12 })
    _ = kernel.advance(ticks: 1)
    var kinds: [SimulationOutcomeKind] = []
    kernel.drainSimulationOutcomes { kinds = $0.map(\.kind) }
    XCTAssertEqual(kinds, [.orbitLocked])
  }

  func testTargetedBodyHoldSelectsWithoutCreating() {
    let kernel = SolarKernel(seed: 44)
    let target = kernel.bodies[1].id
    let before = kernel.bodies.count
    _ = kernel.apply(.init(id: "inspect", verb: .grow, at: 0, payload: .init(contact: .init(phase: .release, point: .centre, durationSeconds: 2, targetBodyID: target))))
    XCTAssertEqual(kernel.bodies.count, before)
    kernel.withSolarRenderSnapshot { snapshot in XCTAssertEqual(snapshot.selectedBodyID, target) }
  }

  func testMaterialContactSelectsOnlyTheTargetWithoutNearestFallback() {
    let kernel = SolarKernel(seed: 441)
    let before = kernel.bodies
    let target = before[1].id

    _ = kernel.apply(.init(
      id: "body-contact",
      verb: .material,
      at: 0,
      intensity: 0.8,
      payload: .init(contact: .init(
        phase: .release,
        point: SemanticOrigin(x: 0.98, y: 0.02),
        durationSeconds: 0.1,
        targetBodyID: target
      ))
    ))

    XCTAssertEqual(kernel.bodies, before)
    kernel.withSolarRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.selectedBodyID, target)
      XCTAssertEqual(snapshot.touchKind, .dust)
      XCTAssertGreaterThan(snapshot.touchPulse, 0)
    }
  }

  func testOpenSkyMaterialContactFlaresStarOrStirsDustWithoutMovingBodies() {
    let starKernel = SolarKernel(seed: 442)
    let starBodies = starKernel.bodies
    _ = starKernel.apply(.init(
      id: "star-contact",
      verb: .material,
      at: 0,
      payload: .init(contact: .init(phase: .release, point: .centre, durationSeconds: 0.1))
    ))
    XCTAssertEqual(starKernel.bodies, starBodies)
    starKernel.withSolarRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.touchKind, .star)
      XCTAssertGreaterThan(snapshot.touchPulse, 0)
      XCTAssertEqual(snapshot.touchPosition, .zero)
    }

    let dustKernel = SolarKernel(seed: 443)
    let dustBodies = dustKernel.bodies
    let dustPoint = SemanticOrigin(x: 0.9, y: 0.8)
    _ = dustKernel.apply(.init(
      id: "dust-contact",
      verb: .material,
      at: 0,
      payload: .init(contact: .init(phase: .release, point: dustPoint, durationSeconds: 0.1))
    ))
    XCTAssertEqual(dustKernel.bodies, dustBodies)
    var initialPulse: Float = 0
    dustKernel.withSolarRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.touchKind, .dust)
      XCTAssertGreaterThan(snapshot.touchPulse, 0)
      XCTAssertNotEqual(snapshot.touchPosition, .zero)
      initialPulse = snapshot.touchPulse
    }
    _ = dustKernel.advance(ticks: 1)
    dustKernel.withSolarRenderSnapshot { XCTAssertLessThan($0.touchPulse, initialPulse) }
  }

  func testSelectedOutcomeUsesTheTrueOsculatingOrbitalFrequency() throws {
    let kernel = SolarKernel(seed: 444)
    let initialBodies = kernel.bodies
    let selected = initialBodies[1]
    let semiMajor = try XCTUnwrap(SolarPhysics.semiMajorAxis(of: selected))
    let period = SolarPhysics.period(semiMajorAxis: semiMajor)

    _ = kernel.apply(.init(
      id: "frequency-select",
      verb: .material,
      at: 0,
      payload: .init(contact: .init(phase: .release, point: .centre, durationSeconds: 0.1, targetBodyID: selected.id))
    ))
    _ = kernel.advance(ticks: 1)

    kernel.drainSimulationOutcomes { outcomes in
      let frequency = outcomes.first { $0.kind == .selected }?.frequencyHz
      XCTAssertEqual(frequency ?? .nan, 196_608 / period, accuracy: 1e-12)
      XCTAssertGreaterThanOrEqual(frequency ?? 0, 40)
      XCTAssertLessThanOrEqual(frequency ?? .infinity, 8_000)
      XCTAssertEqual((frequency ?? .nan) * period, 196_608, accuracy: 1e-8)
    }
  }

  func testEveryBodyTapEmitsOneSelectedToneIncludingTheCurrentSelection() throws {
    let kernel = SolarKernel(seed: 445)
    let first = kernel.bodies[0]
    let firstPeriod = SolarPhysics.period(semiMajorAxis: try XCTUnwrap(SolarPhysics.semiMajorAxis(of: first)))
    _ = kernel.apply(.init(
      id: "tap-current-selection",
      verb: .material,
      at: 0,
      payload: .init(contact: .init(phase: .release, point: .centre, durationSeconds: 0.1, targetBodyID: first.id))
    ))
    _ = kernel.advance(ticks: 1)
    var firstFrequency = Double.nan
    kernel.drainSimulationOutcomes { outcomes in
      let selections = outcomes.filter { $0.kind == .selected }
      XCTAssertEqual(selections.count, 1)
      firstFrequency = selections[0].frequencyHz ?? .nan
    }

    let second = kernel.bodies[1]
    let secondPeriod = SolarPhysics.period(semiMajorAxis: try XCTUnwrap(SolarPhysics.semiMajorAxis(of: second)))
    _ = kernel.apply(.init(
      id: "tap-new-selection",
      verb: .material,
      at: UniverseClock.defaultStepSeconds,
      payload: .init(contact: .init(phase: .release, point: .centre, durationSeconds: 0.1, targetBodyID: second.id))
    ))
    _ = kernel.advance(ticks: 1)
    var secondFrequency = Double.nan
    kernel.drainSimulationOutcomes { outcomes in
      let selections = outcomes.filter { $0.kind == .selected }
      XCTAssertEqual(selections.count, 1)
      secondFrequency = selections[0].frequencyHz ?? .nan
    }

    XCTAssertEqual(firstFrequency / secondFrequency, secondPeriod / firstPeriod, accuracy: 1e-12)
  }

  func testOpenSkyDragNeverFallsBackToPreviousSelection() {
    let kernel = SolarKernel(seed: 45)
    let before = kernel.bodies
    let beforeDigest = kernel.advance(ticks: 0).checkpoint.digest
    let drag = SemanticDragPayload(
      phase: .tick,
      point: SemanticOrigin(x: 0.05, y: 0.05),
      translation: SemanticVector(x: 0.2, y: 0.1),
      velocity: SemanticVector(x: 0.3, y: 0.2),
      targetBodyID: nil
    )
    let output = kernel.apply(.init(id: "open-sky", verb: .material, at: 0, payload: .init(drag: drag)))
    XCTAssertEqual(kernel.bodies, before)
    XCTAssertNotEqual(output.checkpoint.digest, beforeDigest, "accepted command history participates in replay checkpoints")
  }

  func testTargetedDragMutatesOnlyItsPinnedBody() {
    let speed = SolarPhysics.circularSpeed(radius: 1)
    let first = SolarBodyState(id: 1, seed: 1, kind: .planet, position: SIMD2(1, 0), velocity: SIMD2(0, speed), mass: 0.001)
    let second = SolarBodyState(id: 2, seed: 2, kind: .planet, position: SIMD2(-1, 0), velocity: SIMD2(0, -speed), mass: 0.001)
    let kernel = SolarKernel(seed: 46, bodies: [first, second])
    _ = kernel.apply(.init(
      id: "body-drag-enter",
      verb: .material,
      at: 0,
      payload: .init(drag: .init(phase: .enter, point: .centre, targetBodyID: first.id))
    ))
    let drag = SemanticDragPayload(
      phase: .tick,
      point: SemanticOrigin(x: (1.05 / SolarPhysics.maximumSemiMajorAxis + 1) / 2, y: 0.5),
      translation: SemanticVector(x: 0.01, y: 0),
      velocity: .zero,
      targetBodyID: first.id
    )
    _ = kernel.apply(.init(id: "body-drag", verb: .material, at: 0, payload: .init(drag: drag)))
    XCTAssertEqual(kernel.bodies[0], first)
    XCTAssertEqual(kernel.bodies[1], second)
    kernel.withSolarRenderSnapshot { snapshot in
      XCTAssertNotEqual(snapshot.bodies[0].position.x, Float(first.position.x))
    }
  }

  func testPinnedGripSurvivesPreviewAndCancelRestoresAuthority() {
    let speed = SolarPhysics.circularSpeed(radius: 1)
    let initial = SolarBodyState(
      id: 1,
      seed: 1,
      kind: .planet,
      position: SIMD2(1, 0),
      velocity: SIMD2(0, speed),
      mass: 0.001
    )
    let kernel = SolarKernel(seed: 47, bodies: [initial])
    let target = initial.id

    _ = kernel.apply(.init(
      id: "grip-enter",
      verb: .material,
      at: 0,
      payload: .init(drag: .init(phase: .enter, point: .centre, targetBodyID: target))
    ))
    _ = kernel.apply(.init(
      id: "grip-tick",
      verb: .material,
      at: 0.05,
      payload: .init(drag: .init(
        phase: .tick,
        point: SemanticOrigin(x: (1 - 1 / SolarPhysics.maximumSemiMajorAxis) / 2, y: 0.5),
        targetBodyID: target
      ))
    ))
    _ = kernel.advance(ticks: 8)

    XCTAssertEqual(kernel.bodies.count, 1, "preview must not fate-classify or integrate the gripped body")
    _ = kernel.apply(.init(
      id: "grip-cancel",
      verb: .material,
      at: 0.1,
      payload: .init(drag: .init(phase: .cancel, point: .centre, targetBodyID: target))
    ))
    XCTAssertEqual(kernel.bodies[0], initial)
  }

  func testActiveGripPreviewParticipatesInCheckpointDigest() {
    let initial = SolarBodyState(
      id: 1,
      seed: 1,
      kind: .planet,
      position: SIMD2(1, 0),
      velocity: SIMD2(0, SolarPhysics.circularSpeed(radius: 1)),
      mass: 0.001
    )
    let left = SolarKernel(seed: 470, bodies: [initial])
    let right = SolarKernel(seed: 470, bodies: [initial])
    for kernel in [left, right] {
      _ = kernel.apply(.init(
        id: "grip-enter",
        verb: .material,
        at: 0,
        payload: .init(drag: .init(phase: .enter, point: .centre, targetBodyID: initial.id))
      ))
    }
    _ = left.apply(.init(
      id: "grip-preview",
      verb: .material,
      at: 0.05,
      payload: .init(drag: .init(phase: .tick, point: SemanticOrigin(x: 0.25, y: 0.5), targetBodyID: initial.id))
    ))
    _ = right.apply(.init(
      id: "grip-preview",
      verb: .material,
      at: 0.05,
      payload: .init(drag: .init(phase: .tick, point: SemanticOrigin(x: 0.75, y: 0.5), targetBodyID: initial.id))
    ))

    XCTAssertNotEqual(left.advance(ticks: 0).checkpoint.digest, right.advance(ticks: 0).checkpoint.digest)
  }

  func testGripReleaseCommitsFinalPointAndVelocityAtomically() {
    let initial = SolarBodyState(
      id: 1,
      seed: 1,
      kind: .planet,
      position: SIMD2(1, 0),
      velocity: SIMD2(0, SolarPhysics.circularSpeed(radius: 1)),
      mass: 0.001
    )
    let kernel = SolarKernel(seed: 48, bodies: [initial])
    let finalRadius = 1.2
    let finalPoint = SemanticOrigin(
      x: (finalRadius / SolarPhysics.maximumSemiMajorAxis + 1) / 2,
      y: 0.5
    )
    let inputVelocity = SemanticVector(
      x: 0,
      y: SolarPhysics.circularSpeed(radius: finalRadius) / 0.18
    )
    _ = kernel.apply(.init(
      id: "release-enter",
      verb: .material,
      at: 0,
      payload: .init(drag: .init(phase: .enter, point: .centre, targetBodyID: initial.id))
    ))
    _ = kernel.apply(.init(
      id: "release-final",
      verb: .material,
      at: 0.1,
      payload: .init(drag: .init(
        phase: .release,
        point: finalPoint,
        velocity: inputVelocity,
        targetBodyID: initial.id
      ))
    ))

    XCTAssertEqual(kernel.bodies.count, 1)
    XCTAssertEqual(kernel.bodies[0].position.x, finalRadius, accuracy: 1e-12)
    XCTAssertEqual(kernel.bodies[0].position.y, 0, accuracy: 1e-12)
    XCTAssertEqual(kernel.bodies[0].velocity.y, SolarPhysics.circularSpeed(radius: finalRadius), accuracy: 1e-12)
  }

  func testSweptBodyCollisionMergesBeforeEndpointEscapeClassification() {
    let first = SolarBodyState(
      id: 10, seed: 10, kind: .planet,
      position: SIMD2(-0.2, 1), velocity: SIMD2(20, 0), mass: 0.02
    )
    let second = SolarBodyState(
      id: 20, seed: 20, kind: .comet,
      position: SIMD2(0.2, 1), velocity: SIMD2(-40.033, 0), mass: 0.01
    )
    let kernel = SolarKernel(seed: 49, bodies: [first, second])

    _ = kernel.advance(ticks: 1)

    var outcomes: [SimulationOutcome] = []
    kernel.drainSimulationOutcomes { outcomes = Array($0) }
    XCTAssertTrue(outcomes.contains { $0.kind == .collision })
    XCTAssertEqual(outcomes.first(where: { $0.kind == .collision })?.tick, 1)
  }

  func testAllSweptCollisionsResolveBeforeFateClassification() {
    let bodies = [
      SolarBodyState(id: 10, seed: 10, kind: .planet, position: SIMD2(-1.2, 1), velocity: SIMD2(20, 0), mass: 0.02),
      SolarBodyState(id: 20, seed: 20, kind: .comet, position: SIMD2(-0.8, 1), velocity: SIMD2(-40.033, 0), mass: 0.01),
      SolarBodyState(id: 30, seed: 30, kind: .planet, position: SIMD2(0.8, 1), velocity: SIMD2(20, 0), mass: 0.02),
      SolarBodyState(id: 40, seed: 40, kind: .comet, position: SIMD2(1.2, 1), velocity: SIMD2(-40.033, 0), mass: 0.01),
    ]
    let kernel = SolarKernel(seed: 490, bodies: bodies)

    _ = kernel.advance(ticks: 1)

    XCTAssertEqual(kernel.bodies.count, 2)
    XCTAssertEqual(kernel.escapedCount, 0)
    var outcomes: [SimulationOutcome] = []
    kernel.drainSimulationOutcomes { outcomes = Array($0) }
    XCTAssertEqual(outcomes.filter { $0.kind == .collision }.count, 2)
    XCTAssertFalse(outcomes.contains { $0.kind == .escaped })
  }

  func testSweptStarCrossingIsConsumedBeforeEscapeClassification() {
    let crossing = SolarBodyState(
      id: 30, seed: 30, kind: .comet,
      position: SIMD2(-0.2, 0), velocity: SIMD2(50, 0), mass: 0.001
    )
    let kernel = SolarKernel(seed: 50, bodies: [crossing])

    _ = kernel.advance(ticks: 1)

    XCTAssertTrue(kernel.bodies.isEmpty)
    kernel.drainSimulationOutcomes { outcomes in
      XCTAssertEqual(outcomes.map(\.kind), [.consumed])
      XCTAssertEqual(outcomes.first?.tick, 1)
      XCTAssertEqual(outcomes.first?.energy ?? .nan, kernel.energy, accuracy: 1e-12)
    }
  }

  func testSolarSnapshotsDoNotBuildTheLegacyScalarProjection() {
    let kernel = SolarKernel(seed: 51)
    XCTAssertEqual(kernel.scalarProjectionCount, 0)
    for _ in 0 ..< 600 {
      _ = kernel.advance(ticks: 1)
      kernel.withSolarRenderSnapshot { _ in }
    }
    XCTAssertEqual(kernel.scalarProjectionCount, 0)

    kernel.withSurface { _, _, _ in }
    XCTAssertEqual(kernel.scalarProjectionCount, 1)
    kernel.withSolarRenderSnapshot { _ in }
    XCTAssertEqual(kernel.scalarProjectionCount, 1)
  }

  func testTypedPayloadSanitizesNonFiniteInput() {
    let command = SemanticCommand(
      id: "finite",
      verb: .material,
      at: .nan,
      intensity: .infinity,
      payload: .init(
        contact: .init(phase: .tick, point: .centre, durationSeconds: .nan, normalizedPressure: .infinity, azimuth: .nan, altitude: .infinity),
        drag: .init(phase: .tick, point: .centre, translation: .init(x: .nan, y: .infinity), velocity: .init(x: -.infinity, y: .nan))
      )
    )
    XCTAssertEqual(command.at, 0)
    XCTAssertEqual(command.intensity, 0)
    XCTAssertEqual(command.payload.contact?.durationSeconds, 0)
    XCTAssertEqual(command.payload.contact?.normalizedPressure, 0)
    XCTAssertEqual(command.payload.drag?.translation, .zero)
    XCTAssertEqual(command.payload.drag?.velocity, .zero)
  }
}
