import Foundation
import XCTest
@testable import ObjetUniverseCore

final class H2RHFTests: XCTestCase {
  private let cassette = H2RHFCassette.trusted

  private struct Replay {
    let density: [Double]
    let energy: Double
    let electronCount: Double
    let electronCountError: Double
    let iteration: Int
  }

  private func maxAbs(_ left: [Double], _ right: [Double]) -> Double {
    guard left.count == right.count else { return .infinity }
    return zip(left, right).map { abs($0.0 - $0.1) }.max() ?? 0
  }

  private func replay(_ separation: Double, initial: [Double] = [0, 0, 0, 0]) throws -> Replay {
    let input = interpolateH2Request(separation, cassette: cassette)
    XCTAssertTrue(input.supported)
    let matrices = try XCTUnwrap(input.matrices)
    var density = initial
    var previousEnergy: Double?
    var energy = Double.nan
    var count = Double.nan
    var countError = Double.infinity
    var iteration = 0
    for nextIteration in 1 ... cassette.solver.maxIterations {
      iteration = nextIteration
      let fock = try buildH2Fock(density, matrices.core, matrices.eri)
      let target = try densityFromH2Fock(fock, matrices.overlap)
      let mixed = zip(density, target).map { (1 - cassette.solver.damping) * $0.0 + cassette.solver.damping * $0.1 }
      let nextEnergy = try energyForH2Density(mixed, matrices.core, matrices.eri, matrices.enuc)
      let residual = zip(mixed, density).map { abs($0.0 - $0.1) }.max() ?? 0
      let delta = previousEnergy.map { abs(nextEnergy - $0) } ?? .infinity
      count = try electronCountForH2Density(mixed, matrices.overlap)
      countError = abs(count - Double(cassette.aoConvention.electronCount))
      density = mixed
      energy = nextEnergy
      previousEnergy = nextEnergy
      if residual <= cassette.solver.fixedPointDensityTolerance, delta <= cassette.solver.fixedPointEnergyTolerance, countError <= cassette.solver.electronCountTolerance { break }
    }
    return Replay(density: density, energy: energy, electronCount: count, electronCountError: countError, iteration: iteration)
  }

  func testEigenFockAndKnownNodeDensity() throws {
    let eigen = try symmetricEigen2x2(2, 0.4, 1)
    XCTAssertLessThan(eigen.values.0, eigen.values.1)
    XCTAssertGreaterThan(eigen.vectors.0.0, 0)

    let density = [0.3, 0.1, 0.2, 0.4]
    let core = [-1.2, 0.1, 0.2, -0.8]
    let eri = (1 ... 16).map { Double($0) / 100 }
    let fock = try buildH2Fock(density, core, eri)
    XCTAssertEqual(fock.count, 4)
    for (actual, expected) in zip(fock, [-1.1925, 0.1925, 0.1925, -0.7225]) { XCTAssertEqual(actual, expected, accuracy: 1e-12) }

    let node = cassette.nodes[6]
    let replay = try replay(node.separationAngstrom)
    XCTAssertEqual(replay.electronCount, node.referenceElectronCount, accuracy: cassette.comparison.electronCountMaxAbs)
    XCTAssertEqual(replay.energy, node.referenceEnergy, accuracy: cassette.comparison.totalEnergyMaxAbs)
    XCTAssertEqual(maxAbs(replay.density, node.referenceDensity), 0, accuracy: cassette.comparison.densityMatrixMaxAbs)
    XCTAssertEqual(try electronCountForH2Density(node.referenceDensity, node.overlap), 2, accuracy: 1e-8)
  }

  func testAllNodesAndMidpointOraclesConverge() throws {
    var maxNodeDensity = 0.0
    var maxNodeEnergy = 0.0
    var maxNodeCount = 0.0
    for node in cassette.nodes {
      let actual = try replay(node.separationAngstrom)
      maxNodeDensity = max(maxNodeDensity, maxAbs(actual.density, node.referenceDensity))
      maxNodeEnergy = max(maxNodeEnergy, abs(actual.energy - node.referenceEnergy))
      maxNodeCount = max(maxNodeCount, actual.electronCountError)
      XCTAssertLessThanOrEqual(actual.iteration, cassette.solver.maxIterations)
    }
    XCTAssertLessThanOrEqual(maxNodeDensity, cassette.comparison.densityMatrixMaxAbs)
    XCTAssertLessThanOrEqual(maxNodeEnergy, cassette.comparison.totalEnergyMaxAbs)
    XCTAssertLessThanOrEqual(maxNodeCount, cassette.comparison.electronCountMaxAbs)
    XCTAssertEqual(maxNodeDensity, cassette.oracle.nodeReplayMaxDensityError, accuracy: cassette.comparison.canonicalNumericTolerance)
    XCTAssertEqual(maxNodeEnergy, cassette.oracle.nodeReplayMaxEnergyError, accuracy: cassette.comparison.canonicalNumericTolerance)
    XCTAssertEqual(maxNodeCount, cassette.oracle.nodeReplayMaxElectronCountError, accuracy: cassette.comparison.canonicalNumericTolerance)

    var maxMidpointDensity = 0.0
    var maxMidpointEnergy = 0.0
    var maxMidpointCount = 0.0
    for midpoint in cassette.midpoints {
      let actual = try replay(midpoint.separationAngstrom)
      maxMidpointDensity = max(maxMidpointDensity, maxAbs(actual.density, midpoint.referenceDensity))
      maxMidpointEnergy = max(maxMidpointEnergy, abs(actual.energy - midpoint.referenceEnergy))
      maxMidpointCount = max(maxMidpointCount, actual.electronCountError)
      XCTAssertLessThanOrEqual(abs(actual.electronCount - midpoint.referenceElectronCount), cassette.comparison.electronCountMaxAbs)
    }
    XCTAssertLessThanOrEqual(maxMidpointDensity, cassette.comparison.densityMatrixMaxAbs)
    XCTAssertLessThanOrEqual(maxMidpointEnergy, cassette.comparison.totalEnergyMaxAbs)
    XCTAssertLessThanOrEqual(maxMidpointCount, cassette.comparison.electronCountMaxAbs)
    XCTAssertEqual(maxMidpointDensity, cassette.oracle.midpointMaxDensityError, accuracy: cassette.comparison.canonicalNumericTolerance)
    XCTAssertEqual(maxMidpointEnergy, cassette.oracle.midpointMaxEnergyError, accuracy: cassette.comparison.canonicalNumericTolerance)
    XCTAssertEqual(maxMidpointCount, cassette.oracle.midpointMaxElectronCountError, accuracy: cassette.comparison.canonicalNumericTolerance)
  }

  func testSupportedReleaseRequiresTwoStrictGatesAndPromotesOnce() throws {
    let authority = H2RHFAuthority()
    _ = authority.beginContact(H2RHFContactInput(separationAngstrom: 0.9, targetId: "stable-h2", contactEpoch: .number(4)))
    _ = authority.release()
    for _ in 0 ..< cassette.solver.maxIterations where authority.snapshot().disposition != .promoted { _ = authority.tick() }
    let state = authority.snapshot()
    XCTAssertEqual(state.disposition, .promoted)
    XCTAssertEqual(state.promotionGeneration, 1)
    XCTAssertNil(state.frozenCandidate)
    XCTAssertEqual(state.lastGood?.electronCount ?? -1, 2, accuracy: 1e-8)
    XCTAssertEqual(state.milestones.filter { $0.kind == .promotion }.count, 1)
    let trace = authority.trace()
    XCTAssertEqual(trace.prefix(2).map(\.kind), [.contactBegin, .release])
    let gatePasses = trace.filter { $0.kind == .gatePass }
    XCTAssertEqual(gatePasses.count, cassette.solver.consecutiveGateTicks)
    XCTAssertEqual(gatePasses.map(\.gateStreak), [1, 2])
    XCTAssertEqual(Set(gatePasses.map(\.tick)).count, cassette.solver.consecutiveGateTicks)
    for gate in gatePasses {
      guard let index = trace.firstIndex(where: { $0.kind == .gatePass && $0.tick == gate.tick }) else {
        XCTFail("gate-pass event must be present in the trace")
        continue
      }
      XCTAssertGreaterThan(index, 0)
      XCTAssertEqual(trace[index - 1].kind, .tick)
      XCTAssertEqual(trace[index - 1].tick, gate.tick)
    }
    XCTAssertEqual(trace.last?.kind, .promotion)
    XCTAssertEqual(trace.dropLast().last?.kind, .gatePass)
  }

  func testEnvelopeLatchReleaseAndRetry() {
    let authority = H2RHFAuthority()
    let before = authority.snapshot().lastGood?.digest
    _ = authority.beginContact(H2RHFContactInput(separationAngstrom: cassette.envelope.minAngstrom - 1e-9, targetId: "latch", contactEpoch: .number(10)))
    XCTAssertEqual(authority.snapshot().disposition, .outsideEnvelope)
    XCTAssertTrue(authority.snapshot().outsideEnvelopeLatched)
    _ = authority.requestSeparation(H2RHFRequestInput(separationAngstrom: 0.9))
    XCTAssertEqual(authority.snapshot().disposition, .outsideEnvelope)
    XCTAssertNil(authority.snapshot().movingCandidate)
    _ = authority.release()
    XCTAssertFalse(authority.snapshot().outsideEnvelopeLatched)
    XCTAssertEqual(authority.snapshot().lastGood?.digest, before)
    _ = authority.beginContact(H2RHFContactInput(separationAngstrom: 0.9, targetId: "latch", contactEpoch: .number(11)))
    XCTAssertEqual(authority.snapshot().movingCandidate?.targetId, "latch")
  }

  func testInvalidInitialStateFailsClosedPermanently() {
    let authority = H2RHFAuthority(options: H2RHFAuthorityOptions(initialSeparationAngstrom: 0.4))
    XCTAssertFalse(authority.validation.ok)
    XCTAssertEqual(authority.snapshot().disposition, .referenceUnverified)
    XCTAssertNil(authority.snapshot().lastGood)
    _ = authority.beginContact(separationAngstrom: 0.9, targetId: "late", contactEpoch: .number(99))
    XCTAssertEqual(authority.snapshot().disposition, .referenceUnverified)
    XCTAssertNil(authority.snapshot().candidate)
    XCTAssertNil(authority.snapshot().lastGood)
    XCTAssertEqual(authority.snapshot().traceLength, 1)
  }

  func testExhaustionAndNumericalFailureRetainLastGood() {
    let exhausted = H2RHFAuthority(options: H2RHFAuthorityOptions(testSeam: H2RHFAuthorityTestSeam(forceMaxIterations: true)))
    let exhaustedBefore = exhausted.snapshot().lastGood?.digest
    _ = exhausted.beginContact(separationAngstrom: 0.9, targetId: "exhaust", contactEpoch: .number(40))
    _ = exhausted.release()
    _ = try! exhausted.advanceTicks(cassette.solver.maxIterations)
    XCTAssertEqual(exhausted.snapshot().disposition, .maxIterations)
    XCTAssertEqual(exhausted.snapshot().lastGood?.digest, exhaustedBefore)
    XCTAssertNil(exhausted.snapshot().candidate)

    let failed = H2RHFAuthority(options: H2RHFAuthorityOptions(testSeam: H2RHFAuthorityTestSeam(failNumericallyAtTick: 1)))
    let failedBefore = failed.snapshot().lastGood?.digest
    _ = failed.beginContact(separationAngstrom: 0.9, targetId: "failed", contactEpoch: .number(41))
    _ = failed.release()
    _ = failed.tick()
    XCTAssertEqual(failed.snapshot().disposition, .numericalFailure)
    XCTAssertEqual(failed.snapshot().lastGood?.digest, failedBefore)
    XCTAssertEqual(exhausted.trace().last?.kind, .maxIterations)
    XCTAssertEqual(failed.trace().last?.kind, .numericalFailure)
  }

  func testAdapterCadenceAndRebaseAreLogicalTickInvariant() {
    func run(_ hz: Int, rebase: Bool = false) -> (H2RHFSnapshot, [H2RHFTraceEvent], [H2RHFMilestone], H2RHFAdapterSnapshot, (Int, Int)?) {
      let authority = H2RHFAuthority()
      let adapter = H2RHFAdapter(authority: authority)
      _ = adapter.queue(.beginContact(H2RHFContactInput(separationAngstrom: 0.9, targetId: "cadence", contactEpoch: .number(77))))
      _ = adapter.queue(.release(nil))
      let frameMs = 1000.0 / Double(hz)
      var rebaseTicks: (Int, Int)?
      for frame in 0 ..< hz * 4 {
        if rebase && frame == hz * 2 {
          let before = authority.snapshot().tick
          _ = adapter.rebase()
          rebaseTicks = (before, authority.snapshot().tick)
        }
        _ = try! adapter.advance(frameMs)
      }
      return (authority.snapshot(), authority.trace(), authority.milestones(), adapter.snapshot(), rebaseTicks)
    }
    let runs = [30, 60, 120].map { run($0) }
    func semantic(_ value: (H2RHFSnapshot, [H2RHFTraceEvent], [H2RHFMilestone], H2RHFAdapterSnapshot, (Int, Int)?)) -> ([Int], [H2RHFTraceKind], [H2RHFDisposition], Int, String?) {
      (value.1.filter { $0.kind == .tick }.map(\.tick), value.2.map(\.kind), value.1.map(\.disposition), value.0.promotionGeneration, value.0.lastGood?.digest)
    }
    XCTAssertEqual(semantic(runs[0]).0, semantic(runs[1]).0)
    XCTAssertEqual(semantic(runs[1]).0, semantic(runs[2]).0)
    XCTAssertEqual(semantic(runs[0]).1, semantic(runs[1]).1)
    XCTAssertEqual(semantic(runs[1]).1, semantic(runs[2]).1)
    let rebased = run(60, rebase: true)
    XCTAssertEqual(rebased.4?.0, 40)
    XCTAssertEqual(rebased.4?.1, 40)
    XCTAssertEqual(semantic(rebased).0, semantic(runs[1]).0)
    XCTAssertEqual(rebased.3.accumulatorMs, 0, accuracy: 1e-12)
  }

  func testInvalidTimeInputsThrowBeforeStateChanges() throws {
    let authority = H2RHFAuthority()
    XCTAssertThrowsError(try authority.advanceTicks(-1))
    XCTAssertThrowsError(try authority.advanceTicks(Double.nan))

    let adapter = H2RHFAdapter(authority: authority)
    let before = adapter.snapshot()
    XCTAssertThrowsError(try adapter.advance(.nan))
    XCTAssertThrowsError(try adapter.advance(-1))
    XCTAssertEqual(adapter.snapshot(), before)
  }

  func testCanonicalizationDigestAndTraceRoundTrip() throws {
    let vectors = [
      ("0", "0"),
      ("-0", "0"),
      ("123456789.123456789", "123456789.123456791043"),
      ("0.0000000000004", "0"),
      ("-0.0000000000004", "0"),
      ("999999999999.9999999", "1000000000000"),
    ]
    for (input, expected) in vectors { XCTAssertEqual(try canonicalH2RHFNumber(Double(input)!), expected) }
    let checkpoint = try XCTUnwrap(H2RHFAuthority().snapshot().lastGood)
    XCTAssertEqual(try digestH2RHFCheckpoint(checkpoint), checkpoint.digest)
    XCTAssertEqual(checkpoint.digest, "c40d9ffc")
    for value in [Double.nan, Double.infinity, -Double.infinity] {
      XCTAssertThrowsError(try canonicalH2RHFNumber(value))
      let invalid = H2RHFCheckpoint(targetId: "non-finite", separationAngstrom: 0.9, density: [0, 0, 0, 0], energy: value, electronCount: 2, promotionGeneration: 0, digest: "")
      XCTAssertThrowsError(try digestH2RHFCheckpoint(invalid))
    }
    let authority = H2RHFAuthority()
    _ = authority.beginContact(separationAngstrom: 0.9, targetId: "round-trip", contactEpoch: .string("contact"))
    _ = authority.release()
    _ = authority.tick()
    let snapshot = authority.snapshot()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(snapshot)
    let decoded = try JSONDecoder().decode(H2RHFSnapshot.self, from: data)
    XCTAssertEqual(decoded, snapshot)
    XCTAssertEqual(decoded.traceLength, 3)
  }

  private struct FixtureTolerances: Codable, Equatable {
    let densityMatrixMaxAbs: Double
    let totalEnergyMaxAbs: Double
    let electronCountMaxAbs: Double
    let canonicalNumericTolerance: Double
  }

  private struct FixtureMetadata: Codable, Equatable {
    let fixtureVersion: Int
    let lane: String
    let cassetteVersion: Int
    let model: String
    let modelVersion: String
    let cassettePayloadSha256: String
    let quantizationVersion: String
    let traceVersion: Int
    let tolerances: FixtureTolerances
  }

  private struct FixtureAction: Codable, Equatable {
    let ordinal: Int
    let logicalTick: Int
    let kind: String
    let separationAngstrom: Double?
    let rawSeparationAngstrom: Double?
    let targetId: String?
    let contactEpoch: H2RHFContactEpoch?
    let presentationDeltaMs: Double?
  }

  private struct FixtureInput: Codable {
    let metadata: FixtureMetadata
    let scenario: String
    let actions: [FixtureAction]
  }

  private struct FixtureCheckpoint: Codable {
    let targetId: String
    let separationAngstrom: Double
    let density: [Double]
    let energy: Double
    let electronCount: Double
    let promotionGeneration: Int
    let digest: String

    init(_ value: H2RHFCheckpoint) {
      targetId = value.targetId
      separationAngstrom = value.separationAngstrom
      density = value.density
      energy = value.energy
      electronCount = value.electronCount
      promotionGeneration = value.promotionGeneration
      digest = value.digest
    }
  }

  private struct FixtureCandidate: Codable {
    let targetId: String
    let contactEpoch: H2RHFContactEpoch
    let status: String
    let rawSeparationAngstrom: Double
    let requestSeparationAngstrom: Double
    let density: [Double]
    let energy: Double
    let residual: Double?
    let energyDelta: Double?
    let electronCount: Double
    let electronCountError: Double
    let iteration: Int
    let gateStreak: Int

    private enum CodingKeys: String, CodingKey {
      case targetId, contactEpoch, status, rawSeparationAngstrom, requestSeparationAngstrom, density, energy, residual, energyDelta, electronCount, electronCountError, iteration, gateStreak
    }

    init(_ value: H2RHFCandidateSnapshot) {
      targetId = value.targetId
      contactEpoch = value.contactEpoch
      status = value.status
      rawSeparationAngstrom = value.rawSeparationAngstrom
      requestSeparationAngstrom = value.requestSeparationAngstrom
      density = value.density
      energy = value.energy
      residual = value.residual
      energyDelta = value.energyDelta
      electronCount = value.electronCount
      electronCountError = value.electronCountError
      iteration = value.iteration
      gateStreak = value.gateStreak
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(targetId, forKey: .targetId)
      try container.encode(contactEpoch, forKey: .contactEpoch)
      try container.encode(status, forKey: .status)
      try container.encode(rawSeparationAngstrom, forKey: .rawSeparationAngstrom)
      try container.encode(requestSeparationAngstrom, forKey: .requestSeparationAngstrom)
      try container.encode(density, forKey: .density)
      try container.encode(energy, forKey: .energy)
      try container.encode(residual, forKey: .residual)
      try container.encode(energyDelta, forKey: .energyDelta)
      try container.encode(electronCount, forKey: .electronCount)
      try container.encode(electronCountError, forKey: .electronCountError)
      try container.encode(iteration, forKey: .iteration)
      try container.encode(gateStreak, forKey: .gateStreak)
    }
  }

  private struct FixtureTraceEvent: Codable {
    let kind: String
    let tick: Int
    let contactEpoch: H2RHFContactEpoch?
    let targetId: String?
    let disposition: String
    let iteration: Int
    let gateStreak: Int
    let separationAngstrom: Double?
    let residual: Double?
    let energyDelta: Double?
    let electronCountError: Double?
    let promotionGeneration: Int
    let checkpointDigest: String?
    let gatePass: Bool

    private enum CodingKeys: String, CodingKey {
      case kind, tick, contactEpoch, targetId, disposition, iteration, gateStreak, separationAngstrom, residual, energyDelta, electronCountError, promotionGeneration, checkpointDigest, gatePass
    }

    init(_ value: H2RHFTraceEvent) {
      kind = value.kind.rawValue
      tick = value.tick
      contactEpoch = value.contactEpoch
      targetId = value.targetId
      disposition = value.disposition.rawValue
      iteration = value.iteration
      gateStreak = value.gateStreak
      separationAngstrom = value.separationAngstrom
      residual = value.residual
      energyDelta = value.energyDelta
      electronCountError = value.electronCountError
      promotionGeneration = value.promotionGeneration
      checkpointDigest = value.checkpointDigest
      gatePass = value.gatePass
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(kind, forKey: .kind)
      try container.encode(tick, forKey: .tick)
      try container.encode(contactEpoch, forKey: .contactEpoch)
      try container.encode(targetId, forKey: .targetId)
      try container.encode(disposition, forKey: .disposition)
      try container.encode(iteration, forKey: .iteration)
      try container.encode(gateStreak, forKey: .gateStreak)
      try container.encode(separationAngstrom, forKey: .separationAngstrom)
      try container.encode(residual, forKey: .residual)
      try container.encode(energyDelta, forKey: .energyDelta)
      try container.encode(electronCountError, forKey: .electronCountError)
      try container.encode(promotionGeneration, forKey: .promotionGeneration)
      try container.encode(checkpointDigest, forKey: .checkpointDigest)
      try container.encode(gatePass, forKey: .gatePass)
    }
  }

  private struct FixtureSnapshot: Codable {
    let tick: Int
    let contactEpoch: H2RHFContactEpoch?
    let targetId: String?
    let contactActive: Bool
    let outsideEnvelopeLatched: Bool
    let disposition: String
    let movingCandidate: FixtureCandidate?
    let frozenCandidate: FixtureCandidate?
    let candidate: FixtureCandidate?
    let lastGood: FixtureCheckpoint?
    let gateStreak: Int
    let perRequestIterations: Int
    let promotionGeneration: Int
    let traceLength: Int
    let milestones: [FixtureTraceEvent]

    private enum CodingKeys: String, CodingKey {
      case tick, contactEpoch, targetId, contactActive, outsideEnvelopeLatched, disposition, movingCandidate, frozenCandidate, candidate, lastGood, gateStreak, perRequestIterations, promotionGeneration, traceLength, milestones
    }

    init(_ value: H2RHFSnapshot) {
      tick = value.tick
      contactEpoch = value.contactEpoch
      targetId = value.targetId
      contactActive = value.contactActive
      outsideEnvelopeLatched = value.outsideEnvelopeLatched
      disposition = value.disposition.rawValue
      movingCandidate = value.movingCandidate.map(FixtureCandidate.init)
      frozenCandidate = value.frozenCandidate.map(FixtureCandidate.init)
      candidate = value.candidate.map(FixtureCandidate.init)
      lastGood = value.lastGood.map(FixtureCheckpoint.init)
      gateStreak = value.gateStreak
      perRequestIterations = value.perRequestIterations
      promotionGeneration = value.promotionGeneration
      traceLength = value.traceLength
      milestones = value.milestones.map(FixtureTraceEvent.init)
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(tick, forKey: .tick)
      try container.encode(contactEpoch, forKey: .contactEpoch)
      try container.encode(targetId, forKey: .targetId)
      try container.encode(contactActive, forKey: .contactActive)
      try container.encode(outsideEnvelopeLatched, forKey: .outsideEnvelopeLatched)
      try container.encode(disposition, forKey: .disposition)
      try container.encode(movingCandidate, forKey: .movingCandidate)
      try container.encode(frozenCandidate, forKey: .frozenCandidate)
      try container.encode(candidate, forKey: .candidate)
      try container.encode(lastGood, forKey: .lastGood)
      try container.encode(gateStreak, forKey: .gateStreak)
      try container.encode(perRequestIterations, forKey: .perRequestIterations)
      try container.encode(promotionGeneration, forKey: .promotionGeneration)
      try container.encode(traceLength, forKey: .traceLength)
      try container.encode(milestones, forKey: .milestones)
    }
  }

  private struct FixtureOutput: Codable {
    let metadata: FixtureMetadata
    let scenario: String
    let actions: [FixtureAction]
    let trace: [FixtureTraceEvent]
    let milestones: [FixtureTraceEvent]
    let snapshot: FixtureSnapshot
    let adapter: H2RHFAdapterSnapshot
  }

  func testFixtureReplayWritesOutput() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let inputPath = environment["H2_RHF_FIXTURE_INPUT"], let outputPath = environment["H2_RHF_FIXTURE_OUTPUT"] else {
      return
    }

    let input = try JSONDecoder().decode(FixtureInput.self, from: Data(contentsOf: URL(fileURLWithPath: inputPath)))
    let trusted = H2RHFCassette.trusted
    XCTAssertEqual(input.scenario, "canonical-converged")
    XCTAssertEqual(input.actions.map(\.ordinal), Array(0 ..< input.actions.count))
    XCTAssertEqual(input.actions.map(\.kind), ["queue-begin-contact", "queue-release", "advance"])
    XCTAssertEqual(input.metadata.fixtureVersion, 1)
    XCTAssertEqual(input.metadata.lane, "h2-rhf-cross-language-v1")
    XCTAssertEqual(input.metadata.cassetteVersion, trusted.cassetteVersion)
    XCTAssertEqual(input.metadata.model, trusted.model)
    XCTAssertEqual(input.metadata.modelVersion, trusted.modelVersion)
    XCTAssertEqual(input.metadata.cassettePayloadSha256, trusted.payloadSha256)
    XCTAssertEqual(input.metadata.quantizationVersion, trusted.modelTuple.quantizationVersion)
    XCTAssertEqual(input.metadata.traceVersion, trusted.modelTuple.traceVersion)
    XCTAssertEqual(input.metadata.tolerances.densityMatrixMaxAbs, trusted.comparison.densityMatrixMaxAbs, accuracy: trusted.comparison.canonicalNumericTolerance)
    XCTAssertEqual(input.metadata.tolerances.totalEnergyMaxAbs, trusted.comparison.totalEnergyMaxAbs, accuracy: trusted.comparison.canonicalNumericTolerance)
    XCTAssertEqual(input.metadata.tolerances.electronCountMaxAbs, trusted.comparison.electronCountMaxAbs, accuracy: trusted.comparison.canonicalNumericTolerance)
    XCTAssertEqual(input.metadata.tolerances.canonicalNumericTolerance, trusted.comparison.canonicalNumericTolerance, accuracy: trusted.comparison.canonicalNumericTolerance)

    let authority = H2RHFAuthority()
    let adapter = H2RHFAdapter(authority: authority, tickMs: 1000 / Double(trusted.solver.logicalHz))
    for action in input.actions {
      switch action.kind {
      case "queue-begin-contact":
        let separation = try XCTUnwrap(action.separationAngstrom)
        _ = adapter.queue(.beginContact(H2RHFContactInput(
          separationAngstrom: separation,
          rawSeparationAngstrom: action.rawSeparationAngstrom,
          targetId: action.targetId,
          contactEpoch: action.contactEpoch
        )))
      case "queue-release":
        _ = adapter.queue(.release(nil))
      case "advance":
        _ = try adapter.advance(try XCTUnwrap(action.presentationDeltaMs))
        XCTAssertEqual(adapter.snapshot().logicalTicks, action.logicalTick)
      default:
        XCTFail("unknown H2 RHF fixture action \(action.kind)")
      }
    }

    let output = FixtureOutput(
      metadata: input.metadata,
      scenario: input.scenario,
      actions: input.actions,
      trace: authority.trace().map(FixtureTraceEvent.init),
      milestones: authority.milestones().map(FixtureTraceEvent.init),
      snapshot: FixtureSnapshot(authority.snapshot()),
      adapter: adapter.snapshot()
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
    let data = try encoder.encode(output)
    let outputURL = URL(fileURLWithPath: outputPath)
    try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: outputURL, options: [.atomic])
  }
}
