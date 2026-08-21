import XCTest
@testable import ObjetUniverseCore

/// The first three native destinations must be real, deterministic materials,
/// not probe kernels that only advance a clock. These tests pin the contract
/// the shared Metal renderer relies on: a stable scalar surface and a command
/// that visibly changes it.
final class ProofKernelTests: XCTestCase {
  private func surface(_ kernel: any SurfaceSimulationKernel) -> [Float] {
    kernel.withSurface { values, width, height in
      Array(UnsafeBufferPointer(start: values, count: width * height))
    }
  }

  func testCellIsASeededReactionDiffusionSurface() {
    let first = CellKernel(seed: 42)
    let second = CellKernel(seed: 42)
    let before = surface(first)

    XCTAssertEqual(first.materialKind, 1)
    XCTAssertEqual(before, surface(second), "the same seed must create the same colony")
    XCTAssertGreaterThan(before.filter { $0 > 0.01 }.count, 0, "the first frame cannot be flat")

    _ = first.apply(SemanticCommand(id: "grow", verb: .grow, at: 0, intensity: 1, origin: .centre))
    _ = first.advance(ticks: 3)
    XCTAssertNotEqual(before, surface(first), "growth must alter the authoritative colony")
  }

  func testSolarIsASeededOrbitalSurface() {
    let first = SolarKernel(seed: 42)
    let second = SolarKernel(seed: 42)
    let before = surface(first)

    XCTAssertEqual(first.materialKind, 2)
    XCTAssertEqual(before, surface(second), "the same seed must create the same nursery")
    XCTAssertGreaterThan(before.filter { $0 > 0.01 }.count, 0, "the first frame cannot be flat")

    _ = first.apply(SemanticCommand(id: "gravity", verb: .gravity, at: 0, intensity: 1, origin: .centre))
    _ = first.advance(ticks: 3)
    XCTAssertNotEqual(before, surface(first), "gravity must alter the authoritative orbits")
  }

  func testEveryProofKernelUsesTheSharedProjectionVocabulary() {
    for kernel in [CellKernel(seed: 1) as any SurfaceSimulationKernel, SolarKernel(seed: 1)] {
      XCTAssertTrue(kernel.expresses(.lens))
      XCTAssertEqual(kernel.representationIndex, 0)
      kernel.setRepresentation(3)
      XCTAssertEqual(kernel.representationIndex, 3)
      kernel.setRepresentation(99)
      XCTAssertEqual(kernel.representationIndex, 3, "lens detents are bounded")
    }
  }
}
