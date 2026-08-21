import Foundation
import XCTest
@testable import ObjetUniverseCore

/// U9 — the wave medium's own laws, and the reason the first screen is not
/// blank.
///
/// The first test is the cross-language pin: the committed fixture in
/// `scripts/native/fixtures/wave-reference.json` is produced by the TypeScript
/// law in `src/lib/waves.ts`, and this suite steps the same inputs through the
/// Swift integrator. If either language changes its stencil, its boundary
/// handling, or its rounding, this fails before a device ever sees it.
final class WaveFieldTests: XCTestCase {
  private struct Fixture: Decodable {
    struct Impulse: Decodable {
      let x: Int
      let y: Int
      let amplitude: Double
    }

    struct FiniteDifference: Decodable {
      let width: Int
      let height: Int
      let cSquared: Double
      let damping: Double
      let impulse: Impulse
    }

    struct Inputs: Decodable { let finiteDifference: FiniteDifference }
    struct Expected: Decodable { let nextField: [Double] }
    struct Comparison: Decodable { let tolerance: Double }

    let inputs: Inputs
    let expected: Expected
    let comparison: Comparison
  }

  private static let fixturePath = "scripts/native/fixtures/wave-reference.json"

  private func repoRoot(fromFile file: StaticString = #file) -> URL {
    let start = URL(fileURLWithPath: "\(file)").resolvingSymlinksInPath()
    var current = start.deletingLastPathComponent()
    let manager = FileManager.default
    for _ in 0 ..< 12 {
      if manager.fileExists(atPath: current.appendingPathComponent(Self.fixturePath).path) {
        return current
      }
      let parent = current.deletingLastPathComponent()
      if parent.path == current.path { break }
      current = parent
    }
    return start
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private func loadFixture() throws -> Fixture {
    let url = repoRoot().appendingPathComponent(Self.fixturePath)
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  }

  private func surface(of field: WaveField) -> [Float] {
    field.withSurface { values, width, height in
      Array(UnsafeBufferPointer(start: values, count: width * height))
    }
  }

  private func conservativeField(width: Int, height: Int) -> WaveField {
    WaveField(width: width, height: height, cSquared: 0.25, damping: 1, ambientDrive: 0, seed: 0)
  }

  private func declaredEnergy(
    previous: [Float],
    current: [Float],
    width: Int,
    height: Int,
    cSquared: Double
  ) -> Double {
    var kinetic = 0.0
    var gradient = 0.0
    for y in 0 ..< height {
      for x in 0 ..< width {
        let index = y * width + x
        let value = Double(current[index])
        let velocity = value - Double(previous[index])
        kinetic += velocity * velocity
        if x + 1 < width {
          let slope = Double(current[index + 1]) - value
          gradient += slope * slope
        }
        if y + 1 < height {
          let slope = Double(current[index + width]) - value
          gradient += slope * slope
        }
      }
    }
    return 0.5 * kinetic + 0.5 * cSquared * gradient
  }

  func testOneStepReproducesTheCommittedCrossLanguageFixture() throws {
    let fixture = try loadFixture()
    let inputs = fixture.inputs.finiteDifference
    let field = WaveField(
      width: inputs.width,
      height: inputs.height,
      cSquared: inputs.cSquared,
      damping: inputs.damping,
      ambientDrive: 0,
      seed: 0
    )
    field.displace(
      atX: Double(inputs.impulse.x) / Double(inputs.width - 1),
      y: Double(inputs.impulse.y) / Double(inputs.height - 1),
      amplitude: inputs.impulse.amplitude,
      radiusCells: 0
    )

    field.step(secondsPerStep: UniverseClock.defaultStepSeconds)

    let produced = surface(of: field)
    XCTAssertEqual(produced.count, fixture.expected.nextField.count)
    for (index, expected) in fixture.expected.nextField.enumerated() {
      XCTAssertEqual(
        Double(produced[index]),
        expected,
        accuracy: fixture.comparison.tolerance,
        "cell \(index) drifted from the TypeScript wave law"
      )
    }
  }

  func testDisturbanceTravelsOneCellPerStepAndNoFaster() {
    let field = conservativeField(width: 41, height: 41)
    field.displace(atX: 0.5, y: 0.5, amplitude: 1, radiusCells: 0)
    for _ in 0 ..< 10 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }

    let values = surface(of: field)
    let centre = 20
    var inside = 0.0
    var outside = 0.0
    for y in 0 ..< 41 {
      for x in 0 ..< 41 {
        let reach = abs(x - centre) + abs(y - centre)
        let magnitude = abs(Double(values[y * 41 + x]))
        if reach <= 10 { inside += magnitude } else { outside += magnitude }
      }
    }

    XCTAssertGreaterThan(inside, 0, "ten steps must have moved the medium somewhere")
    XCTAssertEqual(
      outside,
      0,
      "the stencil reaches one cell per step; anything past ten is an indexing leak"
    )
  }

  func testUndampedEnergyStaysBoundedAcrossThousandsOfSteps() {
    let field = conservativeField(width: 64, height: 64)
    field.displace(atX: 0.5, y: 0.5, amplitude: 1, radiusCells: 6)
    for _ in 0 ..< 100 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }
    let settled = field.energy
    XCTAssertGreaterThan(settled, 0)

    for _ in 0 ..< 3_000 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }

    XCTAssertTrue(field.energy.isFinite, "a Courant violation would have run away by now")
    XCTAssertGreaterThan(field.energy, settled * 0.5, "an undamped tank cannot quietly lose its energy")
    XCTAssertLessThan(field.energy, settled * 2, "an undamped tank cannot quietly gain energy either")
  }

  func testDampingRemovesEnergyFromTheTank() {
    let field = WaveField(width: 48, height: 48, cSquared: 0.25, damping: 0.99, ambientDrive: 0, seed: 0)
    field.displace(atX: 0.5, y: 0.5, amplitude: 1, radiusCells: 6)
    field.step(secondsPerStep: UniverseClock.defaultStepSeconds)
    let struck = field.energy

    for _ in 0 ..< 400 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }

    XCTAssertLessThan(field.energy, struck * 0.2, "a damped medium must actually give its energy up")
  }

  func testFusedEnergyLedgerEqualsTheDeclaredDiscreteEnergy() {
    let field = conservativeField(width: 48, height: 48)
    field.displace(atX: 0.48, y: 0.57, amplitude: 0.8, radiusCells: 5)
    let previous = surface(of: field)

    field.step(secondsPerStep: UniverseClock.defaultStepSeconds)

    let current = surface(of: field)
    let declaredEnergy = declaredEnergy(
      previous: previous,
      current: current,
      width: field.width,
      height: field.height,
      cSquared: field.cSquared
    )
    XCTAssertEqual(field.energy, declaredEnergy, accuracy: 1e-10)
  }

  func testDrivenSwellIsIncludedInTheFusedEnergyLedger() {
    let field = WaveField(width: 48, height: 48, seed: 17)
    let previous = surface(of: field)

    field.step(secondsPerStep: UniverseClock.defaultStepSeconds)

    let declaredEnergy = declaredEnergy(
      previous: previous,
      current: surface(of: field),
      width: field.width,
      height: field.height,
      cSquared: field.cSquared
    )
    XCTAssertEqual(field.energy, declaredEnergy, accuracy: 1e-10)
  }

  /// The regression this whole change exists for: an arriving visitor must
  /// find a moving sea, not a black rectangle — on the first frame, and after
  /// minutes of nobody touching anything. A damped tank with no source term
  /// passes the first assertion and fails the second, which is exactly the
  /// failure mode this pins.
  func testTheRestingMediumIsNeverFlat() {
    let field = WaveField(seed: 7)

    XCTAssertGreaterThan(
      surface(of: field).map { abs($0) }.max() ?? 0,
      0.05,
      "the very first frame must already carry the seeded swell"
    )

    for _ in 0 ..< 7_200 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }

    let values = surface(of: field)
    let peak = values.map { abs($0) }.max() ?? 0
    let moving = values.filter { abs($0) > 0.02 }.count
    XCTAssertGreaterThan(peak, 0.05, "a minute of rest must not decay the medium to black")
    XCTAssertGreaterThan(moving, values.count / 10, "the swell must reach the field, not one corner of it")
    XCTAssertTrue(field.energy.isFinite)
  }

  /// A quiet tank on a long horizon. The drive and the damping have to balance
  /// somewhere inside the range the renderer can show: a medium that creeps
  /// past its display reference is a screen of solid ember, and one that sinks
  /// under it is the blank screen again, six minutes later.
  func testTheRestingMediumStaysInsideItsDeclaredDisplayRange() {
    let field = WaveField(width: 64, height: 64, seed: 9_001)
    var lowest = Double.greatestFiniteMagnitude
    var highest = 0.0

    // Six minutes, sampled every thirty seconds. The same tank with its drive
    // switched off falls two orders of magnitude below this floor well inside
    // the window, which is what makes the floor a measurement and not a wish.
    for window in 0 ..< 12 {
      for _ in 0 ..< 3_600 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }
      guard window >= 1 else { continue }
      let peak = Double(surface(of: field).map { abs($0) }.max() ?? 0)
      lowest = min(lowest, peak)
      highest = max(highest, peak)
    }

    XCTAssertGreaterThan(lowest, 0.02, "the resting sea must not run down to black")
    XCTAssertLessThan(highest, 2 * WaveField.displayReferenceAmplitude, "the resting sea must not run away either")
  }

  func testTheSameSeedReturnsTheSameSeaAndADifferentSeedDoesNot() {
    let first = WaveField(seed: 42)
    let second = WaveField(seed: 42)
    let other = WaveField(seed: 43)
    for _ in 0 ..< 240 {
      first.step(secondsPerStep: UniverseClock.defaultStepSeconds)
      second.step(secondsPerStep: UniverseClock.defaultStepSeconds)
      other.step(secondsPerStep: UniverseClock.defaultStepSeconds)
    }

    XCTAssertEqual(surface(of: first), surface(of: second))
    XCTAssertNotEqual(surface(of: first), surface(of: other))
  }

  func testExposureIsDeclaredRatherThanTrackedSoALouderMediumReadsBrighter() {
    let quiet = conservativeField(width: 32, height: 32)
    let loud = conservativeField(width: 32, height: 32)
    loud.displace(atX: 0.5, y: 0.5, amplitude: 4, radiusCells: 6)
    quiet.step(secondsPerStep: UniverseClock.defaultStepSeconds)
    loud.step(secondsPerStep: UniverseClock.defaultStepSeconds)

    XCTAssertEqual(
      quiet.exposure,
      loud.exposure,
      accuracy: 1e-12,
      "a running gain would normalise a big wave back down to the resting sea"
    )
    XCTAssertEqual(quiet.exposure, 1 / WaveField.displayReferenceAmplitude, accuracy: 1e-12)
  }

  func testRestingSeaOccupiesAVisiblePartOfTheDeclaredDisplayRange() {
    let field = WaveField(seed: 0x6F62_6A65_7420_6461)
    for _ in 0 ..< 840 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }

    let visiblePeak = Double(surface(of: field).map { abs($0) }.max() ?? 0) * field.exposure
    XCTAssertGreaterThanOrEqual(
      visiblePeak,
      0.18,
      "the seven-second resting breath must not be mapped into near-black"
    )
  }
}

/// The kernel boundary: what the host promotes, and what a replay compares.
final class WaveKernelTests: XCTestCase {
  func testFrameChunkingCannotChangeAuthoritativeOutput() {
    let single = WaveKernel(seed: 11)
    let chunked = WaveKernel(seed: 11)

    let atOnce = single.advance(ticks: 300)
    var last = chunked.advance(ticks: 0)
    for _ in 0 ..< 300 { last = chunked.advance(ticks: 1) }

    XCTAssertEqual(atOnce.checkpoint, last.checkpoint, "a slow frame must not change the physics")
    XCTAssertEqual(atOnce.checkpoint.tick, 300)
    XCTAssertTrue(atOnce.stable)
  }

  func testTheDigestFollowsThePhysicsRatherThanTheTickCounter() {
    let field = WaveKernel(seed: 5)
    let elsewhere = WaveKernel(seed: 6)

    let mine = field.advance(ticks: 120)
    let theirs = elsewhere.advance(ticks: 120)

    XCTAssertEqual(mine.checkpoint.tick, theirs.checkpoint.tick)
    XCTAssertNotEqual(
      mine.checkpoint.digest,
      theirs.checkpoint.digest,
      "two universes at the same tick with different seas must not agree"
    )
    XCTAssertEqual(mine.checkpoint.scene, .wave)
  }

  /// A quiet tank: no seeded swell and no drive, so a touch is the only thing
  /// in the water and its consequence can be measured on its own.
  private func quietKernel() -> WaveKernel {
    WaveKernel(field: WaveField(width: 48, height: 48, cSquared: 0.25, damping: 1, ambientDrive: 0, seed: 0))
  }

  func testAMaterialTouchRaisesTheMediumInProportionToItsIntensity() {
    let untouched = quietKernel()
    let gentle = quietKernel()
    let firm = quietKernel()

    _ = gentle.apply(SemanticCommand(id: "a", verb: .material, at: 0, intensity: 0.1))
    _ = firm.apply(SemanticCommand(id: "b", verb: .material, at: 0, intensity: 1))
    for kernel in [untouched, gentle, firm] { _ = kernel.advance(ticks: 30) }

    XCTAssertEqual(untouched.energy, 0, "an untouched conservative tank has nothing in it")
    XCTAssertGreaterThan(gentle.energy, 0, "a touch must reach the medium at all")
    XCTAssertGreaterThan(firm.energy, gentle.energy * 2, "intensity is an axis, not a switch")
  }

  func testAVerbTheTankCannotExpressLeavesThePhysicsAlone() {
    let field = quietKernel()
    _ = field.apply(SemanticCommand(id: "a", verb: .material, at: 0, intensity: 1))
    _ = field.advance(ticks: 30)
    let before = field.advance(ticks: 0).checkpoint.digest

    _ = field.apply(SemanticCommand(id: "c", verb: .season, at: 0, intensity: 1))

    XCTAssertEqual(field.advance(ticks: 0).checkpoint.digest, before, "a wave tank has no seasons to invent")
  }
}
