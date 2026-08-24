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

  func testCellReactionFieldRetainsBoundedTransitionRegions() {
    let kernel = CellKernel(seed: 0xC311_C011)
    _ = kernel.advance(ticks: 900)
    let settled = surface(kernel)
    let transitionCount = settled.filter { $0 > 0.03 && $0 < 0.97 }.count
    let mean = settled.reduce(0, +) / Float(settled.count)
    let variance = settled.reduce(Float.zero) { sum, value in
      let delta = value - mean
      return sum + delta * delta
    } / Float(settled.count)

    XCTAssertTrue(settled.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 })
    XCTAssertGreaterThan(
      transitionCount,
      settled.count / 100,
      "a reaction–diffusion colony needs transition regions; a binary checkerboard cannot form membrane contours"
    )
    XCTAssertGreaterThan(
      variance,
      0.0001,
      "a uniform mid-value field has transitions but cannot produce a legible colony"
    )
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

  func testCellReducedMotionFreezesTimeDerivedLensPhasesWithoutStoppingTheReaction() {
    for lens in [2, 3] {
      let ordinary = CellKernel(seed: 0xC311_C011)
      let reduced = CellKernel(seed: 0xC311_C011)
      ordinary.setRepresentation(lens)
      reduced.setRepresentation(lens)
      reduced.setReducedMotion(true)

      XCTAssertEqual(surface(ordinary), surface(reduced))
      _ = ordinary.advance(ticks: 180)
      _ = reduced.advance(ticks: 180)

      XCTAssertNotEqual(
        surface(ordinary),
        surface(reduced),
        "lens \(lens) must hold its decorative phase when reduced motion is on"
      )

      ordinary.setRepresentation(0)
      reduced.setRepresentation(0)
      XCTAssertEqual(
        surface(ordinary),
        surface(reduced),
        "reduced motion must not pause or alter the authoritative reaction field"
      )
    }
  }

  func testCellReducedMotionCanEnterAndLeaveWithoutProjectionOrStateDrift() {
    for lens in [2, 3] {
      let ordinary = CellKernel(seed: 0xC311_C011)
      let toggled = CellKernel(seed: 0xC311_C011)
      ordinary.setRepresentation(lens)
      toggled.setRepresentation(lens)
      _ = ordinary.advance(ticks: 180)
      _ = toggled.advance(ticks: 180)

      let beforeDetent = surface(toggled)
      toggled.setReducedMotion(true)
      XCTAssertEqual(
        surface(toggled),
        beforeDetent,
        "lens \(lens) must not snap when reduced motion begins at a live phase"
      )

      _ = ordinary.advance(ticks: 180)
      _ = toggled.advance(ticks: 180)
      XCTAssertNotEqual(surface(ordinary), surface(toggled))

      let heldProjection = surface(toggled)
      toggled.setReducedMotion(false)
      XCTAssertEqual(
        surface(toggled),
        heldProjection,
        "lens \(lens) must resume from its held phase without a one-frame projection jump"
      )
      XCTAssertNotEqual(
        surface(toggled),
        surface(ordinary),
        "lens \(lens) must not release all suppressed decorative time at once"
      )

      ordinary.setRepresentation(0)
      toggled.setRepresentation(0)
      XCTAssertEqual(surface(toggled), surface(ordinary))
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

  func testSolarCreationBodyCountStaysBounded() {
    let kernel = SolarKernel(seed: 12)
    for index in 0 ..< 100 {
      _ = kernel.apply(SemanticCommand(id: "grow-\(index)", verb: .grow, at: Double(index), origin: SemanticOrigin(x: 0.75, y: 0.5)))
    }
    XCTAssertEqual(kernel.bodies.count, SolarPhysics.maxBodies)
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

  func testAtomRenderSnapshotCarriesKernelIdentityAndCovalentRelations() {
    let kernel = AtomKernel(seed: 0)
    kernel.withAtomRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.tick, kernel.tick)
      XCTAssertEqual(snapshot.bodies.count, kernel.atoms.count)
      XCTAssertEqual(snapshot.bodies[0].atomicNumber, UInt32(kernel.atoms[0].element.z))
      XCTAssertEqual(snapshot.bodies[0].shellCount, UInt32(kernel.atoms[0].element.shells.count))
      XCTAssertEqual(snapshot.bodies[0].valence, UInt32(kernel.atoms[0].element.valence))
    }

    _ = kernel.apply(SemanticCommand(id: "atom-render-boron", verb: .grow, at: 0, origin: .centre))
    _ = kernel.apply(SemanticCommand(id: "atom-render-carbon", verb: .grow, at: 1, origin: .centre))
    kernel.withAtomRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.bodies.count, kernel.atoms.count)
      XCTAssertFalse(snapshot.bonds.isEmpty, "two compatible kernel atoms at one material point must reach the renderer as a bond")
      for bond in snapshot.bonds {
        XCTAssertLessThan(Int(bond.firstIndex), snapshot.bodies.count)
        XCTAssertLessThan(Int(bond.secondIndex), snapshot.bodies.count)
        XCTAssertGreaterThan(bond.order, 0)
      }
    }

    _ = kernel.apply(SemanticCommand(id: "atom-render-fuse", verb: .ceremony, at: 2, intensity: 1))
    _ = kernel.advance(ticks: 3)
    kernel.setRepresentation(3)
    XCTAssertGreaterThan(kernel.fusionEnergy, 0, "the snapshot must carry a real fusion ledger after the ceremony")
    kernel.withAtomRenderSnapshot { snapshot in
      XCTAssertEqual(snapshot.tick, kernel.tick)
      XCTAssertEqual(snapshot.representation, kernel.representation)
      XCTAssertEqual(snapshot.fusionEnergy, Float(kernel.fusionEnergy), accuracy: 0.0001)
      XCTAssertEqual(snapshot.bodies.count, kernel.atoms.count)
      for (body, atom) in zip(snapshot.bodies, kernel.atoms) {
        XCTAssertEqual(body.position.x, Float(atom.x), accuracy: 0.0001)
        XCTAssertEqual(body.position.y, Float(atom.y), accuracy: 0.0001)
        XCTAssertEqual(body.velocity.x, Float(atom.vx), accuracy: 0.0001)
        XCTAssertEqual(body.velocity.y, Float(atom.vy), accuracy: 0.0001)
        XCTAssertEqual(body.excitation, Float(min(max(atom.excitation, 0), 1)), accuracy: 0.0001)
        XCTAssertEqual(body.atomicNumber, UInt32(atom.element.z))
      }
      for bond in snapshot.bonds {
        XCTAssertLessThan(Int(bond.firstIndex), snapshot.bodies.count)
        XCTAssertLessThan(Int(bond.secondIndex), snapshot.bodies.count)
      }
    }
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
