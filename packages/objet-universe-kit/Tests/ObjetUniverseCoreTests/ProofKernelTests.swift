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
    for kernel in [CellKernel(seed: 1) as any SurfaceSimulationKernel, SolarKernel(seed: 1), MoleculeKernel(seed: 1), AtomKernel(seed: 1)] {
      XCTAssertTrue(kernel.expresses(.lens))
      XCTAssertEqual(kernel.representationIndex, 0)
      kernel.setRepresentation(3)
      XCTAssertEqual(kernel.representationIndex, 3)
      kernel.setRepresentation(99)
      XCTAssertEqual(kernel.representationIndex, 3, "lens detents are bounded")
    }
  }

  func testAtomKernelIsDeterministicAndBounded() {
    let first = AtomKernel(seed: 77)
    let second = AtomKernel(seed: 77)
    XCTAssertEqual(first.materialKind, 3)
    XCTAssertEqual(first.atoms, second.atoms)
    XCTAssertTrue(first.atoms.allSatisfy { $0.element.shells.reduce(0, +) == $0.element.z })
    XCTAssertTrue(first.atoms.allSatisfy { $0.nucleons >= $0.element.z })
    XCTAssertTrue(first.atoms.allSatisfy { $0.element.z >= 1 && $0.element.z <= 26 })
    XCTAssertEqual(AtomKernel.elements.count, 26)
    XCTAssertEqual(AtomKernel.elements.last?.symbol, "Fe")
    XCTAssertGreaterThan(AtomKernel.bindingEnergyPerNucleon(2), AtomKernel.bindingEnergyPerNucleon(1))
    XCTAssertGreaterThan(AtomKernel.bindingEnergyPerNucleon(26), AtomKernel.bindingEnergyPerNucleon(2))
    XCTAssertLessThan(AtomKernel.bindingEnergyPerNucleon(30), AtomKernel.bindingEnergyPerNucleon(26))
    XCTAssertLessThan(AtomKernel.bindingEnergyPerNucleon(80), 0)
    let before = surface(first)
    _ = first.apply(SemanticCommand(id: "atom-strike", verb: .material, at: 0, intensity: 1, origin: .centre))
    XCTAssertNotEqual(before, surface(first))
    for lens in 0 ... 3 { first.setRepresentation(lens) }
    XCTAssertLessThanOrEqual(first.atoms.count, 8)
  }

  func testAtomLensesAndFusionLedgerRemainDistinct() {
    let kernel = AtomKernel(seed: 5)
    var projections = [[Float]]()
    for lens in 0 ... 3 {
      kernel.setRepresentation(lens)
      projections.append(surface(kernel))
    }
    for first in 0 ..< 4 {
      for second in (first + 1) ..< 4 {
        XCTAssertNotEqual(projections[first], projections[second], "atom lens \(first) and \(second) must remain distinct")
      }
    }
    let before = kernel.fusionEnergy
    _ = kernel.apply(SemanticCommand(id: "atom-fusion", verb: .ceremony, at: 0, intensity: 1))
    XCTAssertTrue(kernel.fusionEnergy.isFinite)
    XCTAssertNotEqual(kernel.fusionEnergy, before, "fusion ceremony must update its energy ledger")
  }

  func testMoleculeKernelUsesRealCompoundsAndOrderIndependentReactions() {
    let first = MoleculeKernel(seed: 12)
    let second = MoleculeKernel(seed: 12)
    XCTAssertEqual(first.materialKind, 4)
    XCTAssertEqual(first.molecules, second.molecules)
    XCTAssertTrue(first.molecules.allSatisfy { MoleculeKernel.compounds.contains($0.compound) })
    XCTAssertEqual(first.reactionFor("H2", "O2"), first.reactionFor("O2", "H2"))
    XCTAssertEqual(first.reactionFor("H2", "O2").reactants, ["H2", "H2", "O2"])
    XCTAssertEqual(first.reactionFor("H2", "O2").products, ["H2O", "H2O"])
    XCTAssertEqual(first.reactionFor("CH4", "O2").products, ["CO2", "H2O", "H2O"])
    XCTAssertEqual(first.reactionFor("N2", "H2").reactants, ["H2", "H2", "H2", "N2"])
    XCTAssertEqual(MoleculeKernel.compounds.first(where: { $0.key == "H2O" })?.shape, .bent)
    XCTAssertEqual(MoleculeKernel.compounds.first(where: { $0.key == "CH4" })?.shape, .tetrahedral)
    XCTAssertEqual(MoleculeKernel.compounds.first(where: { $0.key == "H2O" })?.atomCount, 3)
    XCTAssertEqual(MoleculeKernel.compounds.first(where: { $0.key == "CH4" })?.atomCount, 5)
    let fallback = first.reactionFor("H2O", "NaCl")
    XCTAssertEqual(fallback, first.reactionFor("NaCl", "H2O"))
    XCTAssertTrue(fallback.products.isEmpty)
    XCTAssertEqual(fallback.energy, 0)
    for index in 0 ..< 100 {
      _ = first.apply(SemanticCommand(id: "molecule-\(index)", verb: .ceremony, at: Double(index), intensity: 1))
    }
    XCTAssertLessThanOrEqual(first.molecules.count, 18)
  }

  func testMoleculeLensesAndReactionChangeTheField() {
    let kernel = MoleculeKernel(seed: 31)
    let before = surface(kernel)
    _ = kernel.apply(SemanticCommand(id: "molecule-grow", verb: .grow, at: 0, intensity: 1, origin: .centre))
    XCTAssertNotEqual(before, surface(kernel))
    var projections = [[Float]]()
    for lens in 0 ... 3 {
      kernel.setRepresentation(lens)
      projections.append(surface(kernel))
    }
    for first in 0 ..< 4 {
      for second in (first + 1) ..< 4 {
        XCTAssertNotEqual(projections[first], projections[second], "molecule lens \(first) and \(second) must remain distinct")
      }
    }
  }

  func testChemistryPopulationCapsAndLedgersStayBoundedAtTheEdges() {
    let atoms = AtomKernel(seed: 123)
    for index in 0 ..< 20 {
      _ = atoms.apply(SemanticCommand(id: "atom-grow-(index)", verb: .grow, at: Double(index), intensity: 1, origin: .centre))
    }
    XCTAssertEqual(atoms.atoms.count, 8)
    _ = atoms.apply(SemanticCommand(id: "atom-edge-fusion", verb: .ceremony, at: 21, intensity: 1))
    XCTAssertLessThanOrEqual(atoms.atoms.count, 8)
    XCTAssertTrue(atoms.fusionEnergy.isFinite)

    let molecules = MoleculeKernel(seed: 321)
    for index in 0 ..< 24 {
      _ = molecules.apply(SemanticCommand(id: "molecule-grow-(index)", verb: .grow, at: Double(index), intensity: 1, origin: .centre))
    }
    XCTAssertEqual(molecules.molecules.count, 18)
    for index in 0 ..< 40 {
      _ = molecules.apply(SemanticCommand(id: "molecule-ceremony-(index)", verb: .ceremony, at: Double(index), intensity: 1))
    }
    XCTAssertLessThanOrEqual(molecules.molecules.count, 18)
    XCTAssertLessThanOrEqual(molecules.reactions.count, 32)
    _ = molecules.apply(SemanticCommand(id: "molecule-one-item", verb: .ceremony, at: 99, intensity: 1))
    XCTAssertGreaterThanOrEqual(molecules.molecules.count, 1)
  }
}
