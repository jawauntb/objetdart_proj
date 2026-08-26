import simd
import XCTest
@testable import ObjetUniverseCore

final class MoleculeTargetingIntegrationTests: XCTestCase {
  private let policy = MoleculeH2TargetingPolicy(hitRadius: 0.18, interactionRadius: 0.28)

  private func body(
    _ id: UInt64,
    _ compound: String = "H2",
    _ x: Double,
    _ y: Double,
    ordinal: UInt64? = nil
  ) -> MoleculeTargetBody {
    MoleculeTargetBody(
      id: id,
      seed: id &* 17,
      ordinal: ordinal ?? id,
      compoundKey: compound,
      position: SIMD2(x, y)
    )
  }

  func testNearestTargetAndReactionResolutionAreIndependentOfPopulationOrder() {
    let h2 = body(40, "H2", -0.02, 0)
    let oxygen = body(8, "O2", 0.22, 0)
    let other = body(99, "H2O", 0.7, 0)
    let point = SIMD2<Double>(0, 0)

    let forward = [h2, oxygen, other]
    let reverse = forward.reversed()
    XCTAssertEqual(
      MoleculeH2Targeting.nearestTarget(at: point, bodies: forward, policy: policy),
      MoleculeH2Targeting.nearestTarget(at: point, bodies: Array(reverse), policy: policy)
    )
    XCTAssertEqual(
      MoleculeH2Targeting.resolve(at: point, bodies: forward, policy: policy),
      MoleculeH2Targeting.resolve(at: point, bodies: Array(reverse), policy: policy),
      "the hit and partner resolver must not use array position as identity"
    )
  }

  func testStableIDBreaksExactHitTieAndRadiiRemainSeparate() {
    let lowerID = body(7, "H2", -0.1, 0)
    let higherID = body(12, "H2", 0.1, 0)
    XCTAssertEqual(
      MoleculeH2Targeting.nearestTarget(
        at: .zero,
        bodies: [higherID, lowerID],
        policy: policy
      ),
      lowerID.id,
      "an exact distance tie uses stable body identity, not the population order"
    )

    let partnerOutsideHit = body(2, "O2", 0.25, 0)
    let intent = MoleculeH2Targeting.resolve(
      at: .zero,
      bodies: [body(1, "H2", 0, 0), partnerOutsideHit],
      policy: policy
    )
    guard case .reaction(let primary, let partner, _) = intent else {
      return XCTFail("a reaction partner may use interaction radius without becoming the hit target")
    }
    XCTAssertEqual(primary, 1)
    XCTAssertEqual(partner, partnerOutsideHit.id)
  }

  func testInteractionEpochLocksTargetAndFailsClosedWhenItRetires() {
    let first = body(10, "H2", 0, 0)
    let second = body(20, "H2", 0.12, 0)
    let epoch = MoleculeH2Targeting.beginEpoch(
      epoch: 3,
      at: SIMD2<Double>(0, 0),
      bodies: [first, second],
      policy: policy
    )
    XCTAssertEqual(epoch.targetID, first.id)
    XCTAssertEqual(epoch.continuation(in: [second, first]), .locked(epoch.intent))

    let movedPointBodies = [second, first]
    XCTAssertEqual(
      epoch.continuation(in: movedPointBodies),
      .locked(epoch.intent),
      "a later pointer position cannot retarget an active epoch"
    )
    XCTAssertEqual(epoch.continuation(in: [second]), .targetMissing)
  }

  func testReactionPartnerTakesPrecedenceOverH2Hold() {
    let h2 = body(100, "H2", 0, 0)
    let oxygen = body(200, "O2", 0.27, 0)
    let intent = MoleculeH2Targeting.resolve(
      at: SIMD2<Double>(0, 0),
      bodies: [oxygen, h2],
      policy: policy
    )
    guard case .reaction(let primary, let partner, let reaction) = intent else {
      return XCTFail("H2 with a valid docking partner must resolve as chemistry")
    }
    XCTAssertEqual(primary, h2.id)
    XCTAssertEqual(partner, oxygen.id)
    XCTAssertEqual(reaction.products, ["H2O", "H2O"])
  }

  func testKernelSeedsExactlyOneCanonicalH2WithStableIdentity() {
    let first = MoleculeKernel(seed: 109_017_827)
    let second = MoleculeKernel(seed: 109_017_827)
    let firstH2 = first.molecules.filter { $0.compound.key == "H2" }
    XCTAssertEqual(firstH2.count, 1)
    XCTAssertEqual(firstH2, second.molecules.filter { $0.compound.key == "H2" })
    XCTAssertEqual(first.h2Binding?.bodyID, firstH2.first?.id)
    XCTAssertEqual(first.h2Binding?.targetID, "molecule-\(firstH2[0].id)")
    XCTAssertEqual(first.molecules.map(\.ordinal), Array(1 ... first.molecules.count).map(UInt64.init))
    XCTAssertEqual(Set(first.molecules.map(\.id)).count, first.molecules.count)
  }

  func testCanonicalBindingAndAuthorityTargetIgnoreMultipleH2PopulationOrder() {
    let h2 = MoleculeKernel.compounds.first { $0.key == "H2" }!
    let oxygen = MoleculeKernel.compounds.first { $0.key == "O2" }!
    let olderH2 = MoleculeKernel.Molecule(
      compound: h2, x: -0.3, y: 0, vx: 0, vy: 0, vibration: 0,
      id: 80, seed: 800, ordinal: 2
    )
    let newerH2 = MoleculeKernel.Molecule(
      compound: h2, x: 0.3, y: 0, vx: 0, vy: 0, vibration: 0,
      id: 20, seed: 200, ordinal: 5
    )
    let inert = MoleculeKernel.Molecule(
      compound: oxygen, x: 0, y: 0.5, vx: 0, vy: 0, vibration: 0,
      id: 30, seed: 300, ordinal: 3
    )

    let forward = MoleculeKernel(seed: 4, molecules: [newerH2, inert, olderH2])
    let reverse = MoleculeKernel(seed: 4, molecules: [olderH2, newerH2, inert])
    XCTAssertEqual(forward.h2Binding, reverse.h2Binding)
    XCTAssertEqual(forward.h2Binding?.bodyID, olderH2.id)
    XCTAssertEqual(forward.h2Outcome?.bodyID, olderH2.id)
    XCTAssertEqual(
      forward.h2Outcome?.authority.snapshot().targetId,
      "molecule-\(olderH2.id)",
      "the authority must be constructed from the selected stable body, not a default h2-1 target"
    )

    forward.withMoleculeRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.h2?.bodyID, olderH2.id)
      XCTAssertEqual(snapshot.bodies.filter { $0.compoundIndex == 6 }.count, 2)
    }
  }

  func testLegacyDefaultIdentitiesAreNormalizedWithoutDuplicateZeroIDs() {
    let h2 = MoleculeKernel.compounds.first { $0.key == "H2" }!
    let defaults = [
      MoleculeKernel.Molecule(compound: h2, x: -0.1, y: 0, vx: 0, vy: 0, vibration: 0),
      MoleculeKernel.Molecule(compound: h2, x: 0.1, y: 0, vx: 0, vy: 0, vibration: 0),
    ]
    let kernel = MoleculeKernel(seed: 77, molecules: defaults)
    XCTAssertTrue(kernel.molecules.allSatisfy { $0.id != 0 && $0.seed != 0 && $0.ordinal != 0 })
    XCTAssertEqual(Set(kernel.molecules.map(\.id)).count, kernel.molecules.count)
    XCTAssertEqual(Set(kernel.molecules.map(\.ordinal)).count, kernel.molecules.count)
    XCTAssertEqual(kernel.h2Binding?.bodyID, kernel.molecules[0].id)
  }

  func testNoH2StateCreatesCanonicalH2ThroughGrowAndRecoversFromEmptyState() {
    let oxygen = MoleculeKernel.compounds.first { $0.key == "O2" }!
    let existing = MoleculeKernel.Molecule(
      compound: oxygen, x: 0.6, y: 0.6, vx: 0, vy: 0, vibration: 0,
      id: 500, seed: 501, ordinal: 9
    )
    let populated = MoleculeKernel(seed: 13, molecules: [existing])
    XCTAssertNil(populated.h2Binding)
    _ = populated.apply(SemanticCommand(id: "recover-h2", verb: .grow, at: 0, intensity: 1, origin: .centre))
    XCTAssertEqual(populated.molecules.filter { $0.compound.key == "H2" }.count, 1)
    XCTAssertEqual(populated.h2Outcome?.bodyID, populated.h2Binding?.bodyID)
    XCTAssertEqual(populated.h2Outcome?.targetID, populated.h2Binding?.targetID)

    let empty = MoleculeKernel(seed: 13, molecules: [])
    XCTAssertNil(empty.h2Binding)
    _ = empty.apply(SemanticCommand(id: "recover-empty-h2", verb: .grow, at: 0, intensity: 1, origin: .centre))
    XCTAssertEqual(empty.molecules.count, 1)
    XCTAssertEqual(empty.molecules.first?.compound.key, "H2")
    XCTAssertEqual(empty.h2Outcome?.bodyID, empty.molecules.first?.id)
  }

  func testNonH2GrowContactStillCreatesExactlyOnceAtRelease() {
    let oxygen = MoleculeKernel.compounds.first { $0.key == "O2" }!
    let existing = MoleculeKernel.Molecule(
      compound: oxygen, x: 0, y: 0, vx: 0, vy: 0, vibration: 0,
      id: 700, seed: 701, ordinal: 1
    )
    let kernel = MoleculeKernel(seed: 9, molecules: [existing])
    let point = SemanticOrigin(x: 0.5, y: 0.5)
    func command(_ phase: SemanticGesturePhase) -> SemanticCommand {
      SemanticCommand(
        id: "non-h2-\(phase.rawValue)",
        verb: .grow,
        at: 0,
        intensity: 1,
        origin: point,
        payload: SemanticCommandPayload(contact: SemanticContactPayload(
          phase: phase,
          point: point,
          durationSeconds: phase == .release ? 0.4 : 0
        ))
      )
    }
    _ = kernel.apply(command(.enter))
    XCTAssertEqual(kernel.molecules.count, 1)
    _ = kernel.apply(command(.tick))
    XCTAssertEqual(kernel.molecules.count, 1)
    _ = kernel.apply(command(.release))
    XCTAssertEqual(kernel.molecules.count, 2)
    _ = kernel.apply(command(.release))
    XCTAssertEqual(kernel.molecules.count, 3)
  }

  func testAssistiveReleaseAndTouchReleaseReachEquivalentH2Outcomes() {
    let h2 = MoleculeKernel.compounds.first { $0.key == "H2" }!
    let fixture = MoleculeKernel.Molecule(
      compound: h2, x: 0, y: 0, vx: 0, vy: 0, vibration: 0,
      id: 900, seed: 901, ordinal: 1
    )
    let touch = MoleculeKernel(seed: 15, molecules: [fixture], secondsPerTick: 1.0 / 60.0)
    let assistive = MoleculeKernel(seed: 15, molecules: [fixture], secondsPerTick: 1.0 / 60.0)
    let point = SemanticOrigin.centre
    let enter = SemanticContactPayload(phase: .enter, point: point, durationSeconds: 0)
    let release = SemanticContactPayload(phase: .release, point: point, durationSeconds: 0.9)
    _ = touch.apply(SemanticCommand(
      id: "touch-enter", verb: .grow, at: 0, intensity: 1, origin: point,
      payload: SemanticCommandPayload(contact: enter)
    ))
    _ = touch.apply(SemanticCommand(
      id: "touch-release", verb: .grow, at: 0.9, intensity: 1, origin: point,
      payload: SemanticCommandPayload(contact: release)
    ))
    _ = assistive.apply(SemanticCommand(
      id: "assistive-release", verb: .grow, at: 0.9, intensity: 1, origin: point,
      payload: SemanticCommandPayload(contact: release)
    ))
    _ = touch.advance(ticks: 120)
    _ = assistive.advance(ticks: 120)
    let touchEvents = touch.drainMoleculeH2Outcomes { Array($0) }
    let assistiveEvents = assistive.drainMoleculeH2Outcomes { Array($0) }
    XCTAssertEqual(touchEvents.map(\.kind), assistiveEvents.map(\.kind))
    XCTAssertEqual(touchEvents.map(\.fieldKind), assistiveEvents.map(\.fieldKind))
    XCTAssertEqual(touchEvents.map(\.id), assistiveEvents.map(\.id))
    XCTAssertEqual(touch.h2Outcome?.authority.snapshot().disposition, assistive.h2Outcome?.authority.snapshot().disposition)
  }
}
