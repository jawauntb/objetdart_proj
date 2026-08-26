import Foundation

private let h2Epsilon = 1e-12
private let h2CanonicalDecimals = 12
private let h2HoldMaxDurationMs = 2400.0
private let h2DefaultTickMs = 50.0

public struct H2RHFEigen2x2: Equatable, Sendable {
  public let values: (Double, Double)
  public let vectors: ((Double, Double), (Double, Double))

  public init(values: (Double, Double), vectors: ((Double, Double), (Double, Double))) {
    self.values = values
    self.vectors = vectors
  }

  public static func == (lhs: H2RHFEigen2x2, rhs: H2RHFEigen2x2) -> Bool {
    lhs.values.0 == rhs.values.0 && lhs.values.1 == rhs.values.1
      && lhs.vectors.0.0 == rhs.vectors.0.0 && lhs.vectors.0.1 == rhs.vectors.0.1
      && lhs.vectors.1.0 == rhs.vectors.1.0 && lhs.vectors.1.1 == rhs.vectors.1.1
  }
}

private func h2Finite(_ value: Double) -> Bool { value.isFinite }

private func h2Quantize(_ value: Double) -> Double {
  guard value.isFinite else { return value }
  let factor = pow(10.0, Double(h2CanonicalDecimals))
  // JavaScript Math.round is floor(x + 0.5), including for negative values;
  // Swift's default rounded() is ties-away-from-zero and would diverge there.
  let rounded = floor(value * factor + 0.5) / factor
  return rounded == 0 ? 0 : rounded
}

public func canonicalH2RHFNumber(_ value: Double) throws -> String {
  guard value.isFinite else { throw H2RHFError.nonFiniteValue }
  if value == 0 { return "0" }
  // Foundation's locale overload on Darwin treats a variadic Double as a
  // locale argument in this precision edge case; the plain overload preserves
  // the exact decimal-12 representation used by JavaScript's toFixed.
  let formatted = String(format: "%.12f", value)
  var result = formatted
  while result.last == "0" { result.removeLast() }
  if result.last == "." { result.removeLast() }
  return result == "-0" || result.isEmpty ? "0" : result
}

private func canonicalJSONString(_ value: String) -> String {
  var output = "\""
  for scalar in value.unicodeScalars {
    switch scalar.value {
    case 0x22: output += "\\\""
    case 0x5C: output += "\\\\"
    case 0x08: output += "\\b"
    case 0x0C: output += "\\f"
    case 0x0A: output += "\\n"
    case 0x0D: output += "\\r"
    case 0x09: output += "\\t"
    case 0..<0x20: output += String(format: "\\u%04x", scalar.value)
    default: output.append(Character(scalar))
    }
  }
  return output + "\""
}

private func h2CanonicalCheckpointJSON(targetId: String, separation: Double, density: [Double], energy: Double, electronCount: Double, generation: Int) throws -> String {
  // Object keys are lexical in canonicalH2RHFJson: density, electronCount,
  // energy, promotionGeneration, separationAngstrom, targetId.
  let values = try density.map(h2Quantize).map(canonicalH2RHFNumber).joined(separator: ",")
  return "{\"density\":[\(values)],\"electronCount\":\(try canonicalH2RHFNumber(h2Quantize(electronCount))),\"energy\":\(try canonicalH2RHFNumber(h2Quantize(energy))),\"promotionGeneration\":\(generation),\"separationAngstrom\":\(try canonicalH2RHFNumber(h2Quantize(separation))),\"targetId\":\(canonicalJSONString(targetId))}"
}

private func h2FNV1a(_ string: String) -> String {
  var hash: UInt32 = 0x811C9DC5
  // JavaScript charCodeAt iterates UTF-16 code units, not Unicode scalars.
  for unit in string.utf16 {
    hash ^= UInt32(unit)
    hash = hash &* 0x01000193
  }
  return String(format: "%08x", hash)
}

public func digestH2RHFCheckpoint(_ checkpoint: H2RHFCheckpoint) throws -> String {
  h2FNV1a(try h2CanonicalCheckpointJSON(
    targetId: checkpoint.targetId,
    separation: checkpoint.separationAngstrom,
    density: checkpoint.density,
    energy: checkpoint.energy,
    electronCount: checkpoint.electronCount,
    generation: checkpoint.promotionGeneration
  ))
}

private func h2MatrixFinite(_ matrix: [Double], count: Int) -> Bool {
  matrix.count == count && matrix.allSatisfy(\.isFinite)
}

private func h2Symmetric(_ matrix: [Double]) throws -> [Double] {
  guard h2MatrixFinite(matrix, count: 4) else { throw H2RHFError.invalidMatrix }
  let offDiagonal = 0.5 * (matrix[1] + matrix[2])
  guard offDiagonal.isFinite else { throw H2RHFError.numericalFailure }
  return [matrix[0], offDiagonal, offDiagonal, matrix[3]]
}

private func h2CanonicalVector(_ vector: (Double, Double)) -> (Double, Double) {
  let sign = abs(vector.0) > h2Epsilon ? (vector.0 < 0 ? -1.0 : 1.0) : (vector.1 < 0 ? -1.0 : 1.0)
  return (sign * vector.0, sign * vector.1)
}

/// Deterministic symmetric two-by-two eigensolve with a canonical sign and
/// ascending eigenvalues. The same closed form is used by the TypeScript law.
public func symmetricEigen2x2(_ a: Double, _ b: Double, _ d: Double) throws -> H2RHFEigen2x2 {
  guard a.isFinite, b.isFinite, d.isFinite else { throw H2RHFError.numericalFailure }
  let theta = 0.5 * atan2(2 * b, a - d)
  let cosine = cos(theta)
  let sine = sin(theta)
  let first = h2CanonicalVector((cosine, sine))
  let second = h2CanonicalVector((-sine, cosine))
  let firstValue = first.0 * (a * first.0 + b * first.1) + first.1 * (b * first.0 + d * first.1)
  let secondValue = second.0 * (a * second.0 + b * second.1) + second.1 * (b * second.0 + d * second.1)
  guard firstValue.isFinite, secondValue.isFinite else { throw H2RHFError.numericalFailure }
  if firstValue <= secondValue {
    return H2RHFEigen2x2(values: (firstValue, secondValue), vectors: (first, second))
  }
  return H2RHFEigen2x2(values: (secondValue, firstValue), vectors: (second, first))
}

private func h2Multiply(_ left: [Double], _ right: [Double]) -> [Double] {
  [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
  ]
}

private func h2InverseSqrt(_ overlap: [Double]) throws -> [Double] {
  let symmetric = try h2Symmetric(overlap)
  let eigen = try symmetricEigen2x2(symmetric[0], symmetric[1], symmetric[3])
  guard eigen.values.0 > 0, eigen.values.1 > 0 else { throw H2RHFError.nonPositiveOverlap }
  let v0 = eigen.vectors.0
  let v1 = eigen.vectors.1
  let w0 = 1 / sqrt(eigen.values.0)
  let w1 = 1 / sqrt(eigen.values.1)
  let result = [
    w0 * v0.0 * v0.0 + w1 * v1.0 * v1.0,
    w0 * v0.0 * v0.1 + w1 * v1.0 * v1.1,
    w0 * v0.1 * v0.0 + w1 * v1.1 * v1.0,
    w0 * v0.1 * v0.1 + w1 * v1.1 * v1.1,
  ]
  guard h2MatrixFinite(result, count: 4) else { throw H2RHFError.numericalFailure }
  return result
}

public enum H2RHFError: Error, Equatable, Sendable {
  case invalidMatrix
  case numericalFailure
  case nonPositiveOverlap
  case nonFiniteValue
  case outsideEnvelope
  case invalidInput(String)
}

/// Exact F = h + J - 0.5 K in the cassette's chemists' ERI order.
public func buildH2Fock(_ density: [Double], _ core: [Double], _ eri: [Double]) throws -> [Double] {
  guard h2MatrixFinite(density, count: 4), h2MatrixFinite(core, count: 4), h2MatrixFinite(eri, count: 16) else { throw H2RHFError.invalidMatrix }
  var fock = core
  for p in 0 ..< 2 {
    for q in 0 ..< 2 {
      var coulomb = 0.0
      var exchange = 0.0
      for r in 0 ..< 2 {
        for s in 0 ..< 2 {
          let pqrs = ((p * 2 + q) * 2 + r) * 2 + s
          let prqs = ((p * 2 + r) * 2 + q) * 2 + s
          coulomb += density[r * 2 + s] * eri[pqrs]
          exchange += density[r * 2 + s] * eri[prqs]
        }
      }
      fock[p * 2 + q] += coulomb - 0.5 * exchange
    }
  }
  return try h2Symmetric(fock)
}

/// Build the canonical two-electron density from a generalized Fock solve.
public func densityFromH2Fock(_ fock: [Double], _ overlap: [Double]) throws -> [Double] {
  let orthogonalizer = try h2InverseSqrt(overlap)
  let symmetricFock = try h2Symmetric(fock)
  let transformed = try h2Symmetric(h2Multiply(h2Multiply(orthogonalizer, symmetricFock), orthogonalizer))
  let eigen = try symmetricEigen2x2(transformed[0], transformed[1], transformed[3])
  let orbital0 = orthogonalizer[0] * eigen.vectors.0.0 + orthogonalizer[1] * eigen.vectors.0.1
  let orbital1 = orthogonalizer[2] * eigen.vectors.0.0 + orthogonalizer[3] * eigen.vectors.0.1
  let orbital = h2CanonicalVector((orbital0, orbital1))
  let density = [2 * orbital.0 * orbital.0, 2 * orbital.0 * orbital.1, 2 * orbital.1 * orbital.0, 2 * orbital.1 * orbital.1]
  guard h2MatrixFinite(density, count: 4) else { throw H2RHFError.numericalFailure }
  return density
}

public func electronCountForH2Density(_ density: [Double], _ overlap: [Double]) throws -> Double {
  guard h2MatrixFinite(density, count: 4), h2MatrixFinite(overlap, count: 4) else { throw H2RHFError.invalidMatrix }
  return density[0] * overlap[0] + density[1] * overlap[2] + density[2] * overlap[1] + density[3] * overlap[3]
}

public func energyForH2Density(_ density: [Double], _ core: [Double], _ eri: [Double], _ enuc: Double) throws -> Double {
  guard enuc.isFinite else { throw H2RHFError.numericalFailure }
  let fock = try buildH2Fock(density, core, eri)
  var sum = 0.0
  for index in 0 ..< 4 { sum += density[index] * (core[index] + fock[index]) }
  let energy = 0.5 * sum + enuc
  guard energy.isFinite else { throw H2RHFError.numericalFailure }
  return energy
}

public func interpolateH2Request(_ rawSeparationAngstrom: Double, cassette: H2RHFCassette = .trusted) -> H2RHFInterpolationResult {
  guard rawSeparationAngstrom.isFinite else {
    return H2RHFInterpolationResult(supported: false, rawSeparationAngstrom: rawSeparationAngstrom, separationAngstrom: nil, matrices: nil, reason: .outsideEnvelope)
  }
  guard validateH2RHFInput(cassette).ok else {
    return H2RHFInterpolationResult(supported: false, rawSeparationAngstrom: rawSeparationAngstrom, separationAngstrom: nil, matrices: nil, reason: .referenceUnverified)
  }
  let envelope = cassette.envelope
  guard rawSeparationAngstrom >= envelope.minAngstrom, rawSeparationAngstrom <= envelope.maxAngstrom else {
    return H2RHFInterpolationResult(supported: false, rawSeparationAngstrom: rawSeparationAngstrom, separationAngstrom: nil, matrices: nil, reason: .outsideEnvelope)
  }
  let position = (rawSeparationAngstrom - envelope.minAngstrom) / envelope.spacingAngstrom
  let rounded = position.rounded()
  let exactNode = abs(position - rounded) <= h2Epsilon && Int(rounded) >= 0 && Int(rounded) < cassette.nodes.count ? Int(rounded) : nil
  let leftNode = exactNode == nil ? min(envelope.nodeCount - 2, max(0, Int(floor(position)))) : min(envelope.nodeCount - 2, exactNode!)
  let rightNode = exactNode == nil ? leftNode + 1 : max(1, min(envelope.nodeCount - 1, exactNode!))
  func interpolate(_ key: KeyPath<H2RHFNode, [Double]>) -> [Double] {
    let indices: [Int]
    if leftNode <= 0 { indices = [0, 1, 2] }
    else if rightNode >= cassette.nodes.count - 1 { indices = [cassette.nodes.count - 3, cassette.nodes.count - 2, cassette.nodes.count - 1] }
    else { indices = [leftNode - 1, leftNode, leftNode + 1] }
    let weights = indices.map { i -> Double in
      var weight = 1.0
      for j in indices where j != i { weight *= (position - Double(j)) / Double(i - j) }
      return weight
    }
    return (0 ..< cassette.nodes[0][keyPath: key].count).map { entry in
      zip(indices, weights).reduce(0.0) { partial, sample in partial + sample.1 * cassette.nodes[sample.0][keyPath: key][entry] }
    }
  }
  let matrices = exactNode.map { nodeIndex in
    let node = cassette.nodes[nodeIndex]
    return H2RHFMatrixResult(overlap: node.overlap, core: node.core, eri: node.eri, enuc: 1 / (cassette.modelTuple.bohrPerAngstrom * rawSeparationAngstrom), leftNode: nodeIndex, rightNode: nodeIndex)
  } ?? H2RHFMatrixResult(overlap: interpolate(\.overlap), core: interpolate(\.core), eri: interpolate(\.eri), enuc: 1 / (cassette.modelTuple.bohrPerAngstrom * rawSeparationAngstrom), leftNode: leftNode, rightNode: rightNode)
  guard matrices.overlap.allSatisfy(\.isFinite), matrices.core.allSatisfy(\.isFinite), matrices.eri.allSatisfy(\.isFinite), matrices.enuc.isFinite else {
    return H2RHFInterpolationResult(supported: false, rawSeparationAngstrom: rawSeparationAngstrom, separationAngstrom: nil, matrices: nil, reason: .referenceUnverified)
  }
  return H2RHFInterpolationResult(supported: true, rawSeparationAngstrom: rawSeparationAngstrom, separationAngstrom: h2Quantize(rawSeparationAngstrom), matrices: matrices, reason: nil)
}

public func holdDurationToSeparation(_ durationMs: Double, intensity: Double = 1, startSeparationAngstrom: Double = 0.9) throws -> H2RHFHoldResult {
  guard durationMs.isFinite, intensity.isFinite, startSeparationAngstrom.isFinite else { throw H2RHFError.invalidInput("H2 hold mapping requires finite values") }
  let duration = max(0, durationMs)
  let progress = duration / h2HoldMaxDurationMs
  // The evidence envelope is the 2400 ms detent, not a clamp. Deeper holds
  // continue along the same axis so the authority can refuse raw geometry
  // outside its support instead of silently substituting the boundary.
  let eased = progress <= 1
    ? progress * progress * (3 - 2 * progress)
    : 1 + (progress - 1) * 0.5
  let signedIntensity = min(1, max(-1, intensity))
  let travel = (H2RHFCassette.trusted.envelope.maxAngstrom - H2RHFCassette.trusted.envelope.minAngstrom) * 0.5
  let raw = startSeparationAngstrom + signedIntensity * travel * eased
  let supported = raw >= H2RHFCassette.trusted.envelope.minAngstrom && raw <= H2RHFCassette.trusted.envelope.maxAngstrom
  return H2RHFHoldResult(rawSeparationAngstrom: raw, separationAngstrom: h2Quantize(raw), supported: supported)
}

private func h2GeneratedCassette() -> H2RHFCassette {
  let generated = H2RHFCassetteGenerated.self
  let tuple = generated.modelTuple
  let modelTuple = H2RHFModelTuple(model: tuple.model, modelVersion: tuple.modelVersion, species: tuple.species, charge: tuple.charge, multiplicity: tuple.multiplicity, basis: tuple.basis, envelope: H2RHFEnvelope(minAngstrom: tuple.envelope.minAngstrom, maxAngstrom: tuple.envelope.maxAngstrom, spacingAngstrom: tuple.envelope.spacingAngstrom, nodeCount: tuple.envelope.nodeCount), solver: H2RHFSolver(damping: tuple.solver.damping, logicalHz: tuple.solver.logicalHz, maxIterations: tuple.solver.maxIterations, densityTolerance: tuple.solver.densityTolerance, energyTolerance: tuple.solver.energyTolerance, electronCountTolerance: tuple.solver.electronCountTolerance, fixedPointDensityTolerance: tuple.solver.fixedPointDensityTolerance, fixedPointEnergyTolerance: tuple.solver.fixedPointEnergyTolerance, consecutiveGateTicks: tuple.solver.consecutiveGateTicks), interpolation: H2RHFInterpolation(matrices: tuple.interpolation.matrices, nuclearRepulsion: tuple.interpolation.nuclearRepulsion), bohrPerAngstrom: tuple.bohrPerAngstrom, quantizationVersion: tuple.quantizationVersion, traceVersion: tuple.traceVersion)
  let nodes = generated.nodes.map { H2RHFNode(separationAngstrom: $0.separationAngstrom, overlap: $0.overlap, core: $0.core, eri: $0.eri, enuc: $0.enuc, referenceDensity: $0.referenceDensity, referenceEnergy: $0.referenceEnergy, referenceElectronCount: $0.referenceElectronCount) }
  let midpoints = generated.midpoints.map { H2RHFMidpoint(separationAngstrom: $0.separationAngstrom, overlap: $0.overlap, core: $0.core, eri: $0.eri, enuc: $0.enuc, referenceDensity: $0.referenceDensity, referenceEnergy: $0.referenceEnergy, referenceElectronCount: $0.referenceElectronCount, leftNode: $0.leftNode, rightNode: $0.rightNode, densityError: $0.densityError, energyError: $0.energyError, electronCountError: $0.electronCountError) }
  let provenance = generated.provenance
  let provenanceModel = H2RHFProvenance(generator: provenance.generator, python: provenance.python, pyscf: provenance.pyscf, numpy: provenance.numpy, scipy: provenance.scipy, blas: provenance.blas, sourceHash: provenance.sourceHash, scf: H2RHFSCFOptions(convTol: provenance.scf.convTol, convTolGrad: provenance.scf.convTolGrad, maxCycle: provenance.scf.maxCycle, diisSpace: provenance.scf.diisSpace), build: H2RHFBuildOptions(basis: provenance.build.basis, charge: provenance.build.charge, spin: provenance.build.spin, unit: provenance.build.unit, cart: provenance.build.cart, verbose: provenance.build.verbose, overlapIntegral: provenance.build.overlapIntegral, eriIntegral: provenance.build.eriIntegral), sourceIds: provenance.sourceIds)
  return H2RHFCassette(cassetteVersion: generated.cassetteVersion, model: generated.model, modelVersion: generated.modelVersion, modelTuple: modelTuple, units: H2RHFUnits(distance: generated.units.distance, energy: generated.units.energy, density: generated.units.density), aoConvention: H2RHFAOConvention(labels: generated.aoConvention.labels, axis: generated.aoConvention.axis, matrixOrder: generated.aoConvention.matrixOrder, eriNotation: generated.aoConvention.eriNotation, eriOrder: generated.aoConvention.eriOrder, occupiedOrbitals: generated.aoConvention.occupiedOrbitals, electronCount: generated.aoConvention.electronCount), envelope: H2RHFEnvelope(minAngstrom: generated.modelTuple.envelope.minAngstrom, maxAngstrom: generated.modelTuple.envelope.maxAngstrom, spacingAngstrom: generated.modelTuple.envelope.spacingAngstrom, nodeCount: generated.modelTuple.envelope.nodeCount), solver: H2RHFSolver(damping: generated.modelTuple.solver.damping, logicalHz: generated.modelTuple.solver.logicalHz, maxIterations: generated.modelTuple.solver.maxIterations, densityTolerance: generated.modelTuple.solver.densityTolerance, energyTolerance: generated.modelTuple.solver.energyTolerance, electronCountTolerance: generated.modelTuple.solver.electronCountTolerance, fixedPointDensityTolerance: generated.modelTuple.solver.fixedPointDensityTolerance, fixedPointEnergyTolerance: generated.modelTuple.solver.fixedPointEnergyTolerance, consecutiveGateTicks: generated.modelTuple.solver.consecutiveGateTicks), provenance: provenanceModel, comparison: H2RHFComparison(densityMatrixMaxAbs: generated.comparison.densityMatrixMaxAbs, totalEnergyMaxAbs: generated.comparison.totalEnergyMaxAbs, electronCountMaxAbs: generated.comparison.electronCountMaxAbs, canonicalNumericTolerance: generated.comparison.canonicalNumericTolerance), oracle: H2RHFOracle(nodeReplayMaxDensityError: generated.oracle.nodeReplayMaxDensityError, nodeReplayMaxEnergyError: generated.oracle.nodeReplayMaxEnergyError, nodeReplayMaxElectronCountError: generated.oracle.nodeReplayMaxElectronCountError, midpointMaxDensityError: generated.oracle.midpointMaxDensityError, midpointMaxEnergyError: generated.oracle.midpointMaxEnergyError, midpointMaxElectronCountError: generated.oracle.midpointMaxElectronCountError), nodes: nodes, midpoints: midpoints, payloadSha256: generated.payloadSha256)
}

public extension H2RHFCassette {
  static let trusted: H2RHFCassette = h2GeneratedCassette()
}

public func validateH2RHFInput(_ cassette: H2RHFCassette) -> H2RHFValidation {
  let trusted = H2RHFCassette.trusted
  var errors: [String] = []
  if cassette.cassetteVersion != trusted.cassetteVersion { errors.append("unsupported cassette version") }
  if cassette.model != trusted.model { errors.append("unsupported model") }
  if cassette.modelVersion != trusted.modelVersion { errors.append("unsupported model version") }
  if cassette.modelTuple != trusted.modelTuple { errors.append("model tuple drifted") }
  if cassette.envelope != trusted.envelope { errors.append("envelope drifted") }
  if cassette.solver != trusted.solver { errors.append("solver drifted") }
  if cassette.units != trusted.units { errors.append("units drifted") }
  if cassette.aoConvention != trusted.aoConvention { errors.append("AO convention drifted") }
  if cassette.comparison != trusted.comparison { errors.append("comparison policy drifted") }
  if cassette.oracle != trusted.oracle { errors.append("oracle drifted") }
  if cassette.provenance != trusted.provenance { errors.append("provenance drifted") }
  if cassette.nodes.count != trusted.nodes.count { errors.append("cassette must contain 25 nodes") }
  if cassette.midpoints.count != trusted.midpoints.count { errors.append("cassette must contain 24 midpoint checks") }
  if cassette.nodes != trusted.nodes { errors.append("scientific node payload drifted") }
  if cassette.midpoints != trusted.midpoints { errors.append("scientific midpoint payload drifted") }
  for (index, node) in cassette.nodes.enumerated() {
    guard node.overlap.count == 4, node.core.count == 4, node.eri.count == 16, node.referenceDensity.count == 4, node.overlap.allSatisfy(\.isFinite), node.core.allSatisfy(\.isFinite), node.eri.allSatisfy(\.isFinite), node.referenceDensity.allSatisfy(\.isFinite), node.enuc.isFinite else { errors.append("nodes[\(index)] is malformed"); continue }
    let expected = trusted.envelope.minAngstrom + Double(index) * trusted.envelope.spacingAngstrom
    if abs(node.separationAngstrom - expected) > trusted.comparison.canonicalNumericTolerance { errors.append("nodes[\(index)] is out of canonical ordering") }
    if abs(node.enuc - 1 / (trusted.modelTuple.bohrPerAngstrom * node.separationAngstrom)) > trusted.comparison.canonicalNumericTolerance { errors.append("nodes[\(index)].enuc is not exact Coulomb") }
    if abs(node.overlap[1] - node.overlap[2]) > trusted.comparison.canonicalNumericTolerance { errors.append("nodes[\(index)].overlap is not symmetric") }
    if index < trusted.nodes.count - 1, node.separationAngstrom >= cassette.nodes[index + 1].separationAngstrom { errors.append("nodes[\(index)] is not strictly ordered") }
  }
  for (index, midpoint) in cassette.midpoints.enumerated() {
    guard midpoint.leftNode == index, midpoint.rightNode == index + 1 else { errors.append("midpoints[\(index)] joins the wrong nodes"); continue }
    let expected = trusted.envelope.minAngstrom + (Double(index) + 0.5) * trusted.envelope.spacingAngstrom
    if abs(midpoint.separationAngstrom - expected) > trusted.comparison.canonicalNumericTolerance { errors.append("midpoints[\(index)] is out of canonical ordering") }
  }
  if cassette.payloadSha256 != trusted.payloadSha256 { errors.append("payload SHA-256 is not trusted") }
  if let sentinel = cassette.nodes.first(where: { abs($0.separationAngstrom - 0.75) <= trusted.comparison.canonicalNumericTolerance }) {
    if maxAbs(sentinel.referenceDensity, trusted.nodes[6].referenceDensity) > trusted.comparison.canonicalNumericTolerance || abs(sentinel.referenceEnergy - trusted.nodes[6].referenceEnergy) > trusted.comparison.canonicalNumericTolerance { errors.append("trusted sentinel drifted") }
  } else { errors.append("trusted sentinel missing") }
  return H2RHFValidation(ok: errors.isEmpty, errors: errors)
}

private func maxAbs(_ left: [Double], _ right: [Double]) -> Double {
  guard left.count == right.count else { return .infinity }
  return zip(left, right).map { abs($0 - $1) }.max() ?? 0
}

private struct H2InternalCandidate: Sendable {
  let targetId: String
  let contactEpoch: H2RHFContactEpoch
  var rawSeparationAngstrom: Double
  var density: [Double]
  var energy: Double
  var residual: Double
  var energyDelta: Double
  var electronCount: Double
  var electronCountError: Double
  var iteration: Int
  var gateStreak: Int
}

private func h2InitialState(cassette: H2RHFCassette, separation: Double) throws -> (density: [Double], energy: Double, electronCount: Double) {
  let request = interpolateH2Request(separation, cassette: cassette)
  guard request.supported, let matrices = request.matrices else { throw H2RHFError.outsideEnvelope }
  let index = max(0, min(cassette.nodes.count - 1, Int(((separation - cassette.envelope.minAngstrom) / cassette.envelope.spacingAngstrom).rounded())))
  var density = cassette.nodes[index].referenceDensity
  var energy = try energyForH2Density(density, matrices.core, matrices.eri, matrices.enuc)
  for _ in 0 ..< cassette.solver.maxIterations {
    let target = try densityFromH2Fock(try buildH2Fock(density, matrices.core, matrices.eri), matrices.overlap)
    let mixed = zip(density, target).map { (1 - cassette.solver.damping) * $0.0 + cassette.solver.damping * $0.1 }
    let nextEnergy = try energyForH2Density(mixed, matrices.core, matrices.eri, matrices.enuc)
    let residual = maxAbs(mixed, density)
    let delta = abs(nextEnergy - energy)
    density = mixed
    energy = nextEnergy
    if residual <= cassette.solver.fixedPointDensityTolerance, delta <= cassette.solver.fixedPointEnergyTolerance { break }
  }
  let electronCount = try electronCountForH2Density(density, matrices.overlap)
  guard density.allSatisfy(\.isFinite), energy.isFinite, electronCount.isFinite else { throw H2RHFError.numericalFailure }
  return (density, energy, electronCount)
}

/// The renderer-free authority. All mutation happens at logical 20 Hz ticks;
/// snapshots and traces are value copies bounded by `maxTraceEntries`.
public final class H2RHFAuthority: @unchecked Sendable {
  public private(set) var validation: H2RHFValidation
  private var cassette: H2RHFCassette?
  private let traceLimit: Int
  private let seam: H2RHFAuthorityTestSeam
  private var traceEntries: [H2RHFTraceEvent] = []
  private var milestoneEntries: [H2RHFMilestone] = []
  private var tickCount = 0
  private var contactSequence = 0
  private var contactEpoch: H2RHFContactEpoch?
  private var targetId: String?
  private var contactActive = false
  private var outsideEnvelopeLatched = false
  private var disposition: H2RHFDisposition = .idle
  private var movingCandidate: H2InternalCandidate?
  private var frozenCandidate: H2InternalCandidate?
  private var lastGood: H2RHFCheckpoint?
  private var gateStreak = 0
  private var promotionGeneration = 0

  public init(cassette: H2RHFCassette = .trusted, options: H2RHFAuthorityOptions = .init()) {
    let report = validateH2RHFInput(cassette)
    validation = report
    traceLimit = max(8, min(256, options.maxTraceEntries))
    seam = options.testSeam
    if !report.ok {
      self.cassette = nil
      disposition = .referenceUnverified
      record(.referenceUnverified, candidate: nil, separation: nil, gatePass: false)
      return
    }
    self.cassette = cassette
    do {
      let initial = try h2InitialState(cassette: cassette, separation: options.initialSeparationAngstrom)
      lastGood = makeCheckpoint(targetId: options.initialTargetId, separation: options.initialSeparationAngstrom, density: initial.density, energy: initial.energy, electronCount: initial.electronCount, generation: 0)
      targetId = options.initialTargetId
    } catch {
      self.cassette = nil
      validation = H2RHFValidation(ok: false, errors: ["initial state failed: \(error)"])
      lastGood = nil
      targetId = nil
      disposition = .referenceUnverified
      record(.referenceUnverified, candidate: nil, separation: nil, gatePass: false)
    }
  }

  public func beginContact(_ input: H2RHFContactInput) -> H2RHFSnapshot {
    guard let cassette else { return snapshot() }
    let raw = input.rawSeparationAngstrom ?? input.separationAngstrom
    contactSequence += 1
    contactEpoch = input.contactEpoch ?? .number(Double(contactSequence))
    targetId = input.targetId ?? "h2-1"
    contactActive = true
    outsideEnvelopeLatched = false
    movingCandidate = nil
    frozenCandidate = nil
    gateStreak = 0
    let request = interpolateH2Request(raw, cassette: cassette)
    guard request.supported else {
      outsideEnvelopeLatched = request.reason == .outsideEnvelope
      disposition = request.reason == .outsideEnvelope ? .outsideEnvelope : .referenceUnverified
      record(request.reason == .outsideEnvelope ? .outsideEnvelope : .referenceUnverified, candidate: nil, separation: raw, gatePass: false)
      return snapshot()
    }
    movingCandidate = newCandidate(raw: raw, density: lastGood?.density ?? [0, 0, 0, 0], energy: lastGood?.energy ?? 0)
    disposition = .correcting
    record(.contactBegin, candidate: movingCandidate, separation: raw, gatePass: false)
    return snapshot()
  }

  public func beginContact(separationAngstrom: Double, targetId: String = "h2-1", contactEpoch: H2RHFContactEpoch? = nil) -> H2RHFSnapshot {
    beginContact(H2RHFContactInput(separationAngstrom: separationAngstrom, targetId: targetId, contactEpoch: contactEpoch))
  }

  public func requestSeparation(_ input: H2RHFRequestInput) -> H2RHFSnapshot {
    guard let cassette, contactActive, !outsideEnvelopeLatched, frozenCandidate == nil else { return snapshot() }
    if let requestedTarget = input.targetId, requestedTarget != targetId {
      record(.requestIgnored, candidate: movingCandidate, separation: nil, gatePass: false)
      return snapshot()
    }
    let raw = input.rawSeparationAngstrom ?? input.separationAngstrom
    let request = interpolateH2Request(raw, cassette: cassette)
    guard request.supported else {
      outsideEnvelopeLatched = request.reason == .outsideEnvelope
      disposition = request.reason == .outsideEnvelope ? .outsideEnvelope : .referenceUnverified
      movingCandidate = nil
      frozenCandidate = nil
      gateStreak = 0
      record(request.reason == .outsideEnvelope ? .outsideEnvelope : .referenceUnverified, candidate: nil, separation: raw, gatePass: false)
      return snapshot()
    }
    guard var candidate = movingCandidate else { return snapshot() }
    candidate.rawSeparationAngstrom = raw
    candidate.iteration = 0
    candidate.gateStreak = 0
    candidate.residual = .infinity
    candidate.energyDelta = .infinity
    movingCandidate = candidate
    gateStreak = 0
    disposition = .correcting
    record(.request, candidate: movingCandidate, separation: raw, gatePass: false)
    return snapshot()
  }

  public func updateRequest(_ input: H2RHFRequestInput) -> H2RHFSnapshot { requestSeparation(input) }

  public func release(_ input: H2RHFReleaseInput? = nil) -> H2RHFSnapshot {
    guard cassette != nil else { return snapshot() }
    if let input, input.separationAngstrom != nil || input.rawSeparationAngstrom != nil {
      _ = requestSeparation(H2RHFRequestInput(separationAngstrom: input.separationAngstrom ?? input.rawSeparationAngstrom!, rawSeparationAngstrom: input.rawSeparationAngstrom))
    }
    let candidate = movingCandidate
    contactActive = false
    outsideEnvelopeLatched = false
    movingCandidate = nil
    if let candidate {
      frozenCandidate = candidate
      record(.release, candidate: candidate, separation: candidate.rawSeparationAngstrom, gatePass: false)
    } else {
      frozenCandidate = nil
      record(.release, candidate: nil, separation: nil, gatePass: false)
    }
    return snapshot()
  }

  public func cancel() -> H2RHFSnapshot {
    guard cassette != nil else { return snapshot() }
    contactActive = false
    outsideEnvelopeLatched = false
    movingCandidate = nil
    frozenCandidate = nil
    gateStreak = 0
    disposition = .cancelled
    record(.cancel, candidate: nil, separation: nil, gatePass: false)
    return snapshot()
  }

  public func dispatch(_ command: H2RHFCommand) -> H2RHFSnapshot {
    switch command {
    case .beginContact(let input): return beginContact(input)
    case .request(let input): return requestSeparation(input)
    case .release(let input): return release(input)
    case .cancel: return cancel()
    }
  }

  @discardableResult public func tick() -> H2RHFSnapshot {
    tickCount += 1
    guard let cassette else { return snapshot() }
    guard let active = frozenCandidate ?? movingCandidate else { return snapshot() }
    if seam.failNumericallyAtTick == tickCount {
      failNumerically(active)
      return snapshot()
    }
    do {
      let request = interpolateH2Request(active.rawSeparationAngstrom, cassette: cassette)
      guard request.supported, let matrices = request.matrices else { throw H2RHFError.outsideEnvelope }
      let target = try densityFromH2Fock(try buildH2Fock(active.density, matrices.core, matrices.eri), matrices.overlap)
      let mixed = zip(active.density, target).map { (1 - cassette.solver.damping) * $0.0 + cassette.solver.damping * $0.1 }
      let nextEnergy = try energyForH2Density(mixed, matrices.core, matrices.eri, matrices.enuc)
      let residual = maxAbs(mixed, active.density)
      let energyDelta = active.iteration == 0 ? Double.infinity : abs(nextEnergy - active.energy)
      let electronCount = try electronCountForH2Density(mixed, matrices.overlap)
      let electronCountError = abs(electronCount - Double(cassette.aoConvention.electronCount))
      guard mixed.allSatisfy(\.isFinite), nextEnergy.isFinite, residual.isFinite, electronCount.isFinite, electronCountError.isFinite, !energyDelta.isNaN else { throw H2RHFError.numericalFailure }
      var candidate = active
      candidate.density = mixed
      candidate.energy = nextEnergy
      candidate.residual = residual
      candidate.energyDelta = energyDelta
      candidate.electronCount = electronCount
      candidate.electronCountError = electronCountError
      candidate.iteration += 1
      let strictPass = !seam.forceMaxIterations && residual <= cassette.solver.fixedPointDensityTolerance && energyDelta <= cassette.solver.fixedPointEnergyTolerance && electronCountError <= cassette.solver.electronCountTolerance
      candidate.gateStreak = strictPass ? candidate.gateStreak + 1 : 0
      gateStreak = candidate.gateStreak
      if frozenCandidate != nil { frozenCandidate = candidate } else { movingCandidate = candidate }
      record(.tick, candidate: candidate, separation: candidate.rawSeparationAngstrom, gatePass: strictPass)
      if strictPass { record(.gatePass, candidate: candidate, separation: candidate.rawSeparationAngstrom, gatePass: true) }
      if strictPass && candidate.gateStreak >= cassette.solver.consecutiveGateTicks && frozenCandidate != nil {
        promote(candidate)
      } else if candidate.iteration >= cassette.solver.maxIterations && candidate.gateStreak < cassette.solver.consecutiveGateTicks {
        failMaxIterations(candidate)
      }
    } catch {
      failNumerically(active)
    }
    return snapshot()
  }

  @discardableResult public func advanceTicks(_ count: Int) throws -> H2RHFSnapshot {
    guard count >= 0 else { throw H2RHFError.invalidInput("H2 RHF tick count must be non-negative") }
    for _ in 0 ..< count { tick() }
    return snapshot()
  }

  @discardableResult public func advanceTicks(_ count: Double) throws -> H2RHFSnapshot {
    guard count.isFinite, count >= 0 else { throw H2RHFError.invalidInput("H2 RHF tick count must be finite and non-negative") }
    return try advanceTicks(Int(floor(count)))
  }

  public func snapshot() -> H2RHFSnapshot {
    let moving = movingCandidate.map { candidateSnapshot($0, status: "moving") }
    let frozen = frozenCandidate.map { candidateSnapshot($0, status: "frozen") }
    return H2RHFSnapshot(tick: tickCount, contactEpoch: contactEpoch, targetId: targetId, contactActive: contactActive, outsideEnvelopeLatched: outsideEnvelopeLatched, disposition: disposition, movingCandidate: moving, frozenCandidate: frozen, candidate: moving ?? frozen, lastGood: lastGood, gateStreak: gateStreak, perRequestIterations: movingCandidate?.iteration ?? frozenCandidate?.iteration ?? 0, promotionGeneration: promotionGeneration, traceLength: traceEntries.count, milestones: milestoneEntries)
  }

  public func getSnapshot() -> H2RHFSnapshot { snapshot() }
  public func trace() -> [H2RHFTraceEvent] { traceEntries }
  public func getTrace() -> [H2RHFTraceEvent] { trace() }
  public func milestones() -> [H2RHFMilestone] { milestoneEntries }

  private func newCandidate(raw: Double, density: [Double], energy: Double) -> H2InternalCandidate {
    H2InternalCandidate(targetId: targetId ?? "h2-1", contactEpoch: contactEpoch ?? .number(Double(contactSequence)), rawSeparationAngstrom: raw, density: density, energy: energy, residual: .infinity, energyDelta: .infinity, electronCount: 2, electronCountError: 0, iteration: 0, gateStreak: 0)
  }

  private func makeCheckpoint(targetId: String, separation: Double, density: [Double], energy: Double, electronCount: Double, generation: Int) -> H2RHFCheckpoint {
    let base = H2RHFCheckpoint(targetId: targetId, separationAngstrom: h2Quantize(separation), density: density.map(h2Quantize), energy: h2Quantize(energy), electronCount: h2Quantize(electronCount), promotionGeneration: generation, digest: "")
    return H2RHFCheckpoint(targetId: base.targetId, separationAngstrom: base.separationAngstrom, density: base.density, energy: base.energy, electronCount: base.electronCount, promotionGeneration: base.promotionGeneration, digest: try! digestH2RHFCheckpoint(base))
  }

  private func candidateSnapshot(_ candidate: H2InternalCandidate, status: String) -> H2RHFCandidateSnapshot {
    H2RHFCandidateSnapshot(targetId: candidate.targetId, contactEpoch: candidate.contactEpoch, status: status, rawSeparationAngstrom: h2Quantize(candidate.rawSeparationAngstrom), requestSeparationAngstrom: h2Quantize(candidate.rawSeparationAngstrom), density: candidate.density.map(h2Quantize), energy: h2Quantize(candidate.energy), residual: candidate.residual.isFinite ? h2Quantize(candidate.residual) : nil, energyDelta: candidate.energyDelta.isFinite ? h2Quantize(candidate.energyDelta) : nil, electronCount: h2Quantize(candidate.electronCount), electronCountError: h2Quantize(candidate.electronCountError), iteration: candidate.iteration, gateStreak: candidate.gateStreak)
  }

  private func record(_ kind: H2RHFTraceKind, candidate: H2InternalCandidate?, separation: Double?, gatePass: Bool) {
    let event = H2RHFTraceEvent(kind: kind, tick: tickCount, contactEpoch: candidate?.contactEpoch ?? contactEpoch, targetId: candidate?.targetId ?? targetId, disposition: disposition, iteration: candidate?.iteration ?? 0, gateStreak: candidate?.gateStreak ?? gateStreak, separationAngstrom: separation.map(h2Quantize), residual: candidate.flatMap { $0.residual.isFinite ? h2Quantize($0.residual) : nil }, energyDelta: candidate.flatMap { $0.energyDelta.isFinite ? h2Quantize($0.energyDelta) : nil }, electronCountError: candidate.map { h2Quantize($0.electronCountError) }, promotionGeneration: promotionGeneration, checkpointDigest: lastGood?.digest, gatePass: gatePass)
    traceEntries.append(event)
    while traceEntries.count > traceLimit { traceEntries.removeFirst() }
    if kind != .tick && kind != .requestIgnored {
      milestoneEntries.append(event)
      while milestoneEntries.count > traceLimit { milestoneEntries.removeFirst() }
    }
  }

  private func promote(_ candidate: H2InternalCandidate) {
    promotionGeneration += 1
    lastGood = makeCheckpoint(targetId: candidate.targetId, separation: candidate.rawSeparationAngstrom, density: candidate.density, energy: candidate.energy, electronCount: candidate.electronCount, generation: promotionGeneration)
    frozenCandidate = nil
    movingCandidate = nil
    contactActive = false
    outsideEnvelopeLatched = false
    gateStreak = candidate.gateStreak
    disposition = .promoted
    record(.promotion, candidate: nil, separation: candidate.rawSeparationAngstrom, gatePass: true)
  }

  private func failMaxIterations(_ candidate: H2InternalCandidate) {
    movingCandidate = nil
    frozenCandidate = nil
    contactActive = false
    outsideEnvelopeLatched = false
    disposition = .maxIterations
    gateStreak = candidate.gateStreak
    record(.maxIterations, candidate: candidate, separation: candidate.rawSeparationAngstrom, gatePass: false)
  }

  private func failNumerically(_ candidate: H2InternalCandidate) {
    movingCandidate = nil
    frozenCandidate = nil
    contactActive = false
    outsideEnvelopeLatched = false
    disposition = .numericalFailure
    gateStreak = 0
    record(.numericalFailure, candidate: candidate, separation: candidate.rawSeparationAngstrom, gatePass: false)
  }
}

private struct H2PendingCommand: Sendable {
  let command: H2RHFCommand
  let dueTick: Int
  let sequence: Int
}

/// A 50 ms command adapter. Presentation cadence only accumulates time toward
/// fixed logical ticks; rebasing drops suspended time and never catches up.
public final class H2RHFAdapter: @unchecked Sendable {
  private let authority: H2RHFAuthority
  private let tickMs: Double
  private var accumulatorMs = 0.0
  private var logicalTicks = 0
  private var sequence = 0
  private var rebaseCount = 0
  private var queueEntries: [H2PendingCommand] = []

  public init(authority: H2RHFAuthority, tickMs: Double = 50.0) {
    precondition(tickMs > 0 && tickMs.isFinite)
    self.authority = authority
    self.tickMs = tickMs
  }

  @discardableResult public func queue(_ command: H2RHFCommand) -> H2RHFAdapterSnapshot {
    sequence += 1
    queueEntries.append(H2PendingCommand(command: command, dueTick: logicalTicks + 1, sequence: sequence))
    return snapshot()
  }

  @discardableResult public func enqueue(_ command: H2RHFCommand) -> H2RHFAdapterSnapshot { queue(command) }

  @discardableResult public func advance(_ presentationDeltaMs: Double) throws -> H2RHFAdapterSnapshot {
    guard presentationDeltaMs.isFinite, presentationDeltaMs >= 0 else { throw H2RHFError.invalidInput("H2 RHF presentation delta must be finite and non-negative") }
    accumulatorMs += presentationDeltaMs
    let epsilon = tickMs * 1e-9
    while accumulatorMs + epsilon >= tickMs {
      accumulatorMs -= tickMs
      if abs(accumulatorMs) < epsilon { accumulatorMs = 0 }
      logicalTicks += 1
      applyCommands()
      authority.tick()
    }
    return snapshot()
  }

  @discardableResult public func advancePresentation(_ presentationDeltaMs: Double) throws -> H2RHFAdapterSnapshot { try advance(presentationDeltaMs) }

  @discardableResult public func tick() -> H2RHFAdapterSnapshot {
    accumulatorMs = 0
    logicalTicks += 1
    applyCommands()
    authority.tick()
    return snapshot()
  }

  @discardableResult public func rebase() -> H2RHFAdapterSnapshot {
    accumulatorMs = 0
    rebaseCount += 1
    return snapshot()
  }

  @discardableResult public func resume() -> H2RHFAdapterSnapshot { rebase() }

  @discardableResult public func onVisibility(hidden: Bool) -> H2RHFAdapterSnapshot { rebase() }

  public func snapshot() -> H2RHFAdapterSnapshot { H2RHFAdapterSnapshot(accumulatorMs: h2Quantize(accumulatorMs), logicalTicks: logicalTicks, queuedCommands: queueEntries.count, rebaseCount: rebaseCount) }

  private func applyCommands() {
    let due = queueEntries.filter { $0.dueTick <= logicalTicks }.sorted { $0.sequence < $1.sequence }
    guard !due.isEmpty else { return }
    for item in due { _ = authority.dispatch(item.command) }
    let ids = Set(due.map(\.sequence))
    queueEntries.removeAll { ids.contains($0.sequence) }
  }
}

public func createH2RHFAdapter(_ authority: H2RHFAuthority, tickMs: Double = 50.0) -> H2RHFAdapter { H2RHFAdapter(authority: authority, tickMs: tickMs) }
public func createH2RHFAuthority(cassette: H2RHFCassette = .trusted, options: H2RHFAuthorityOptions = .init()) -> H2RHFAuthority { H2RHFAuthority(cassette: cassette, options: options) }
