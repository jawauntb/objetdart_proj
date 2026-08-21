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

  func testCellLensStationsAreDistinctProjectionsOfTheSameState() {
    let kernel = CellKernel(seed: 99)
    var projections = [[Float]]()
    for lens in 0 ... 3 {
      kernel.setRepresentation(lens)
      projections.append(surface(kernel))
    }
    XCTAssertEqual(projections.count, 4)
    for first in 0 ..< 4 {
      for second in (first + 1) ..< 4 {
        XCTAssertNotEqual(projections[first], projections[second], "cell lens \(first) and \(second) must remain distinct")
      }
    }
  }

  func testSolarLensStationsAreDistinctCosmicRegisters() {
    let kernel = SolarKernel(seed: 99)
    var projections = [[Float]]()
    for lens in 0 ... 3 {
      kernel.setRepresentation(lens)
      projections.append(surface(kernel))
    }
    for first in 0 ..< 4 {
      for second in (first + 1) ..< 4 {
        XCTAssertNotEqual(projections[first], projections[second], "solar lens \(first) and \(second) must remain distinct")
      }
    }
  }

  func testLensStationsHaveDistinctCheckpointDigests() {
    let cell = CellKernel(seed: 101)
    cell.setRepresentation(0)
    let colonyDigest = cell.apply(SemanticCommand(id: "cell-colony", verb: .material, at: 0, intensity: 0.2)).checkpoint.digest
    cell.setRepresentation(2)
    let genomeDigest = cell.apply(SemanticCommand(id: "cell-genome", verb: .material, at: 0, intensity: 0.2)).checkpoint.digest
    XCTAssertNotEqual(colonyDigest, genomeDigest)

    let solar = SolarKernel(seed: 101)
    solar.setRepresentation(0)
    let galaxyDigest = solar.apply(SemanticCommand(id: "solar-galaxy", verb: .material, at: 0, intensity: 0.2)).checkpoint.digest
    solar.setRepresentation(3)
    let earthDigest = solar.apply(SemanticCommand(id: "solar-earth", verb: .material, at: 0, intensity: 0.2)).checkpoint.digest
    XCTAssertNotEqual(galaxyDigest, earthDigest)
  }

  func testSolarCeremonyBodyCountStaysBounded() {
    let kernel = SolarKernel(seed: 12)
    for index in 0 ..< 100 {
      _ = kernel.apply(SemanticCommand(id: "ceremony-\(index)", verb: .ceremony, at: Double(index)))
    }
    XCTAssertEqual(kernel.bodies.count, 48)
  }

  func testLensCommandsDriveBothKernelsAndNonzeroCellReadingsAdvance() {
    let cell = CellKernel(seed: 24)
    let colony = surface(cell)
    _ = cell.apply(SemanticCommand(id: "cell-lens", verb: .lens, at: 0))
    XCTAssertEqual(cell.representationIndex, 1)
    XCTAssertNotEqual(colony, surface(cell))
    let membrane = surface(cell)
    _ = cell.advance(ticks: 1)
    XCTAssertNotEqual(membrane, surface(cell))
    _ = cell.apply(SemanticCommand(id: "cell-step-back", verb: .stepBack, at: 1))
    XCTAssertEqual(cell.representationIndex, 0)

    let solar = SolarKernel(seed: 24)
    _ = solar.apply(SemanticCommand(id: "solar-lens", verb: .lens, at: 0))
    XCTAssertEqual(solar.representationIndex, 1)
    _ = solar.apply(SemanticCommand(id: "solar-step-back", verb: .stepBack, at: 1))
    XCTAssertEqual(solar.representationIndex, 0)
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
