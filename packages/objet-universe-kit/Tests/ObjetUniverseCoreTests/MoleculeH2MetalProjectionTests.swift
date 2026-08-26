import XCTest
import simd
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Cross-target seam tests for the immutable H₂ record. These stay GPU-free:
/// the Metal fixture owns shader execution, while this file proves that the
/// stable body-scoped record survives the existing RenderHost handoff.
final class MoleculeH2MetalProjectionTests: XCTestCase {
  func testRenderHostForwardsTheStableBodyScopedH2Record() {
    let host = RenderHost()
    let probe = RendererProbe(kind: .metal)
    host.install(probe)
    host.resume()

    let bodyID: UInt64 = 0xABCD_0123_4567_89EF
    let h2 = MoleculeH2RenderSnapshot(
      bodyID: bodyID,
      candidateDensity: SIMD4<Float>(0.70, -0.20, -0.20, 0.70),
      lastGoodDensity: SIMD4<Float>(0.62, -0.11, -0.11, 0.62),
      residual: 0.03,
      separationAngstrom: 0.9,
      disposition: .correcting,
      promotionGeneration: 2,
      active: true
    )
    let records = [MoleculeRenderBody(
      position: .zero,
      velocity: .zero,
      compoundIndex: 6,
      shape: .diatomic,
      atomCount: 2,
      vibration: 0.2,
      id: bodyID,
      seed: 17,
      ordinal: 3
    )]

    records.withUnsafeBufferPointer { bodies in
      host.submitMolecules(MoleculeRenderSnapshot(
        tick: 14,
        elapsedSeconds: 0.7,
        secondsPerTick: 0.05,
        representation: 0,
        reactionEnergy: 0,
        h2: h2,
        bodies: bodies
      ))
    }

    XCTAssertEqual(host.submittedMoleculeCount, 1)
    XCTAssertEqual(probe.lastMoleculeH2BodyID, bodyID)
    host.suspend()
  }

  func testARefusedCoreRecordRetainsItsExplicitDispositionAndLastGoodDensity() {
    let refused = MoleculeH2RenderSnapshot(
      bodyID: 11,
      candidateDensity: SIMD4<Float>(9, 9, 9, 9),
      lastGoodDensity: SIMD4<Float>(0.61, -0.08, -0.08, 0.61),
      residual: 0.000001,
      separationAngstrom: 0.4,
      disposition: .outsideEnvelope,
      promotionGeneration: 1,
      active: true
    )
    XCTAssertEqual(refused.disposition, .outsideEnvelope)
    XCTAssertEqual(refused.promotionGeneration, 1)
    XCTAssertEqual(refused.lastGoodDensity, SIMD4<Float>(0.61, -0.08, -0.08, 0.61))
    XCTAssertEqual(refused.bodyID, 11)
  }

  func testKernelPublishesH2RecordBesideTheImmutableBodySnapshot() {
    let kernel = MoleculeKernel(seed: 109_017_827)
    kernel.withMoleculeRenderSnapshot { snapshot in
      let h2Body = snapshot.bodies.first(where: { $0.compoundIndex == 6 })
      XCTAssertNotNil(h2Body)
      XCTAssertEqual(snapshot.h2?.bodyID, h2Body?.id)
      XCTAssertEqual(snapshot.h2?.disposition, .idle)
      XCTAssertEqual(snapshot.h2?.active, true, "the trusted field remains drawable at rest")
      XCTAssertEqual(snapshot.h2?.lastGoodDensity?.x.isFinite, true)
    }
  }
}
