import Foundation

/// The native, renderer-free value types for the bounded H₂ RHF authority.
///
/// These values deliberately contain scientific state and semantic events only.
/// A renderer, audio scheduler, haptic engine, or wall clock must not appear in
/// this file or in an encoded trace.
public typealias H2RHFMatrix = [Double]

public struct H2RHFValidation: Equatable, Codable, Sendable {
  public let ok: Bool
  public let errors: [String]

  public init(ok: Bool, errors: [String] = []) {
    self.ok = ok
    self.errors = errors
  }

  public static let valid = H2RHFValidation(ok: true)
}

public struct H2RHFEnvelope: Equatable, Codable, Sendable {
  public let minAngstrom: Double
  public let maxAngstrom: Double
  public let spacingAngstrom: Double
  public let nodeCount: Int

  public init(minAngstrom: Double, maxAngstrom: Double, spacingAngstrom: Double, nodeCount: Int) {
    self.minAngstrom = minAngstrom
    self.maxAngstrom = maxAngstrom
    self.spacingAngstrom = spacingAngstrom
    self.nodeCount = nodeCount
  }
}

public struct H2RHFSolver: Equatable, Codable, Sendable {
  public let damping: Double
  public let logicalHz: Int
  public let maxIterations: Int
  public let densityTolerance: Double
  public let energyTolerance: Double
  public let electronCountTolerance: Double
  public let fixedPointDensityTolerance: Double
  public let fixedPointEnergyTolerance: Double
  public let consecutiveGateTicks: Int

  public init(
    damping: Double,
    logicalHz: Int,
    maxIterations: Int,
    densityTolerance: Double,
    energyTolerance: Double,
    electronCountTolerance: Double,
    fixedPointDensityTolerance: Double,
    fixedPointEnergyTolerance: Double,
    consecutiveGateTicks: Int
  ) {
    self.damping = damping
    self.logicalHz = logicalHz
    self.maxIterations = maxIterations
    self.densityTolerance = densityTolerance
    self.energyTolerance = energyTolerance
    self.electronCountTolerance = electronCountTolerance
    self.fixedPointDensityTolerance = fixedPointDensityTolerance
    self.fixedPointEnergyTolerance = fixedPointEnergyTolerance
    self.consecutiveGateTicks = consecutiveGateTicks
  }
}

public struct H2RHFInterpolation: Equatable, Codable, Sendable {
  public let matrices: String
  public let nuclearRepulsion: String

  public init(matrices: String, nuclearRepulsion: String) {
    self.matrices = matrices
    self.nuclearRepulsion = nuclearRepulsion
  }
}

public struct H2RHFModelTuple: Equatable, Codable, Sendable {
  public let model: String
  public let modelVersion: String
  public let species: String
  public let charge: Int
  public let multiplicity: Int
  public let basis: String
  public let envelope: H2RHFEnvelope
  public let solver: H2RHFSolver
  public let interpolation: H2RHFInterpolation
  public let bohrPerAngstrom: Double
  public let quantizationVersion: String
  public let traceVersion: Int

  public init(
    model: String,
    modelVersion: String,
    species: String,
    charge: Int,
    multiplicity: Int,
    basis: String,
    envelope: H2RHFEnvelope,
    solver: H2RHFSolver,
    interpolation: H2RHFInterpolation,
    bohrPerAngstrom: Double,
    quantizationVersion: String,
    traceVersion: Int
  ) {
    self.model = model
    self.modelVersion = modelVersion
    self.species = species
    self.charge = charge
    self.multiplicity = multiplicity
    self.basis = basis
    self.envelope = envelope
    self.solver = solver
    self.interpolation = interpolation
    self.bohrPerAngstrom = bohrPerAngstrom
    self.quantizationVersion = quantizationVersion
    self.traceVersion = traceVersion
  }
}

public struct H2RHFUnits: Equatable, Codable, Sendable {
  public let distance: String
  public let energy: String
  public let density: String

  public init(distance: String, energy: String, density: String) {
    self.distance = distance
    self.energy = energy
    self.density = density
  }
}

public struct H2RHFAOConvention: Equatable, Codable, Sendable {
  public let labels: [String]
  public let axis: String
  public let matrixOrder: String
  public let eriNotation: String
  public let eriOrder: [String]
  public let occupiedOrbitals: Int
  public let electronCount: Int

  public init(labels: [String], axis: String, matrixOrder: String, eriNotation: String, eriOrder: [String], occupiedOrbitals: Int, electronCount: Int) {
    self.labels = labels
    self.axis = axis
    self.matrixOrder = matrixOrder
    self.eriNotation = eriNotation
    self.eriOrder = eriOrder
    self.occupiedOrbitals = occupiedOrbitals
    self.electronCount = electronCount
  }
}

public struct H2RHFSCFOptions: Equatable, Codable, Sendable {
  public let convTol: Double
  public let convTolGrad: Double
  public let maxCycle: Int
  public let diisSpace: Int

  public init(convTol: Double, convTolGrad: Double, maxCycle: Int, diisSpace: Int) {
    self.convTol = convTol
    self.convTolGrad = convTolGrad
    self.maxCycle = maxCycle
    self.diisSpace = diisSpace
  }
}

public struct H2RHFBuildOptions: Equatable, Codable, Sendable {
  public let basis: String
  public let charge: Int
  public let spin: Int
  public let unit: String
  public let cart: Bool
  public let verbose: Int
  public let overlapIntegral: String
  public let eriIntegral: String

  public init(basis: String, charge: Int, spin: Int, unit: String, cart: Bool, verbose: Int, overlapIntegral: String, eriIntegral: String) {
    self.basis = basis
    self.charge = charge
    self.spin = spin
    self.unit = unit
    self.cart = cart
    self.verbose = verbose
    self.overlapIntegral = overlapIntegral
    self.eriIntegral = eriIntegral
  }
}

public struct H2RHFProvenance: Equatable, Codable, Sendable {
  public let generator: String
  public let python: String
  public let pyscf: String
  public let numpy: String
  public let scipy: String
  public let blas: String
  public let sourceHash: String
  public let scf: H2RHFSCFOptions
  public let build: H2RHFBuildOptions
  public let sourceIds: [String]

  public init(generator: String, python: String, pyscf: String, numpy: String, scipy: String, blas: String, sourceHash: String, scf: H2RHFSCFOptions, build: H2RHFBuildOptions, sourceIds: [String]) {
    self.generator = generator
    self.python = python
    self.pyscf = pyscf
    self.numpy = numpy
    self.scipy = scipy
    self.blas = blas
    self.sourceHash = sourceHash
    self.scf = scf
    self.build = build
    self.sourceIds = sourceIds
  }
}

public struct H2RHFComparison: Equatable, Codable, Sendable {
  public let densityMatrixMaxAbs: Double
  public let totalEnergyMaxAbs: Double
  public let electronCountMaxAbs: Double
  public let canonicalNumericTolerance: Double

  public init(densityMatrixMaxAbs: Double, totalEnergyMaxAbs: Double, electronCountMaxAbs: Double, canonicalNumericTolerance: Double) {
    self.densityMatrixMaxAbs = densityMatrixMaxAbs
    self.totalEnergyMaxAbs = totalEnergyMaxAbs
    self.electronCountMaxAbs = electronCountMaxAbs
    self.canonicalNumericTolerance = canonicalNumericTolerance
  }
}

public struct H2RHFOracle: Equatable, Codable, Sendable {
  public let nodeReplayMaxDensityError: Double
  public let nodeReplayMaxEnergyError: Double
  public let nodeReplayMaxElectronCountError: Double
  public let midpointMaxDensityError: Double
  public let midpointMaxEnergyError: Double
  public let midpointMaxElectronCountError: Double

  public init(nodeReplayMaxDensityError: Double, nodeReplayMaxEnergyError: Double, nodeReplayMaxElectronCountError: Double, midpointMaxDensityError: Double, midpointMaxEnergyError: Double, midpointMaxElectronCountError: Double) {
    self.nodeReplayMaxDensityError = nodeReplayMaxDensityError
    self.nodeReplayMaxEnergyError = nodeReplayMaxEnergyError
    self.nodeReplayMaxElectronCountError = nodeReplayMaxElectronCountError
    self.midpointMaxDensityError = midpointMaxDensityError
    self.midpointMaxEnergyError = midpointMaxEnergyError
    self.midpointMaxElectronCountError = midpointMaxElectronCountError
  }
}

public struct H2RHFNode: Equatable, Codable, Sendable {
  public let separationAngstrom: Double
  public let overlap: H2RHFMatrix
  public let core: H2RHFMatrix
  public let eri: H2RHFMatrix
  public let enuc: Double
  public let referenceDensity: H2RHFMatrix
  public let referenceEnergy: Double
  public let referenceElectronCount: Double

  public init(separationAngstrom: Double, overlap: H2RHFMatrix, core: H2RHFMatrix, eri: H2RHFMatrix, enuc: Double, referenceDensity: H2RHFMatrix, referenceEnergy: Double, referenceElectronCount: Double) {
    self.separationAngstrom = separationAngstrom
    self.overlap = overlap
    self.core = core
    self.eri = eri
    self.enuc = enuc
    self.referenceDensity = referenceDensity
    self.referenceEnergy = referenceEnergy
    self.referenceElectronCount = referenceElectronCount
  }
}

public struct H2RHFMidpoint: Equatable, Codable, Sendable {
  public let separationAngstrom: Double
  public let overlap: H2RHFMatrix
  public let core: H2RHFMatrix
  public let eri: H2RHFMatrix
  public let enuc: Double
  public let referenceDensity: H2RHFMatrix
  public let referenceEnergy: Double
  public let referenceElectronCount: Double
  public let leftNode: Int
  public let rightNode: Int
  public let densityError: Double
  public let energyError: Double
  public let electronCountError: Double

  public init(separationAngstrom: Double, overlap: H2RHFMatrix, core: H2RHFMatrix, eri: H2RHFMatrix, enuc: Double, referenceDensity: H2RHFMatrix, referenceEnergy: Double, referenceElectronCount: Double, leftNode: Int, rightNode: Int, densityError: Double, energyError: Double, electronCountError: Double) {
    self.separationAngstrom = separationAngstrom
    self.overlap = overlap
    self.core = core
    self.eri = eri
    self.enuc = enuc
    self.referenceDensity = referenceDensity
    self.referenceEnergy = referenceEnergy
    self.referenceElectronCount = referenceElectronCount
    self.leftNode = leftNode
    self.rightNode = rightNode
    self.densityError = densityError
    self.energyError = energyError
    self.electronCountError = electronCountError
  }
}

public struct H2RHFCassette: Equatable, Codable, Sendable {
  public let cassetteVersion: Int
  public let model: String
  public let modelVersion: String
  public let modelTuple: H2RHFModelTuple
  public let units: H2RHFUnits
  public let aoConvention: H2RHFAOConvention
  public let envelope: H2RHFEnvelope
  public let solver: H2RHFSolver
  public let provenance: H2RHFProvenance
  public let comparison: H2RHFComparison
  public let oracle: H2RHFOracle
  public let nodes: [H2RHFNode]
  public let midpoints: [H2RHFMidpoint]
  public let payloadSha256: String

  public init(cassetteVersion: Int, model: String, modelVersion: String, modelTuple: H2RHFModelTuple, units: H2RHFUnits, aoConvention: H2RHFAOConvention, envelope: H2RHFEnvelope, solver: H2RHFSolver, provenance: H2RHFProvenance, comparison: H2RHFComparison, oracle: H2RHFOracle, nodes: [H2RHFNode], midpoints: [H2RHFMidpoint], payloadSha256: String) {
    self.cassetteVersion = cassetteVersion
    self.model = model
    self.modelVersion = modelVersion
    self.modelTuple = modelTuple
    self.units = units
    self.aoConvention = aoConvention
    self.envelope = envelope
    self.solver = solver
    self.provenance = provenance
    self.comparison = comparison
    self.oracle = oracle
    self.nodes = nodes
    self.midpoints = midpoints
    self.payloadSha256 = payloadSha256
  }
}

public struct H2RHFInterpolationResult: Equatable, Sendable {
  public let supported: Bool
  public let rawSeparationAngstrom: Double
  /// A semantic decimal-12 value. The solver always uses the raw request.
  public let separationAngstrom: Double?
  public let matrices: H2RHFMatrixResult?
  public let reason: H2RHFInterpolationFailure?

  public init(supported: Bool, rawSeparationAngstrom: Double, separationAngstrom: Double?, matrices: H2RHFMatrixResult?, reason: H2RHFInterpolationFailure?) {
    self.supported = supported
    self.rawSeparationAngstrom = rawSeparationAngstrom
    self.separationAngstrom = separationAngstrom
    self.matrices = matrices
    self.reason = reason
  }
}

public enum H2RHFInterpolationFailure: String, Codable, Equatable, Sendable {
  case outsideEnvelope = "outside-envelope"
  case referenceUnverified = "reference-unverified"
}

public struct H2RHFMatrixResult: Equatable, Sendable {
  public let overlap: H2RHFMatrix
  public let core: H2RHFMatrix
  public let eri: H2RHFMatrix
  public let enuc: Double
  public let leftNode: Int
  public let rightNode: Int

  public init(overlap: H2RHFMatrix, core: H2RHFMatrix, eri: H2RHFMatrix, enuc: Double, leftNode: Int, rightNode: Int) {
    self.overlap = overlap
    self.core = core
    self.eri = eri
    self.enuc = enuc
    self.leftNode = leftNode
    self.rightNode = rightNode
  }
}

public enum H2RHFContactEpoch: Codable, Equatable, Hashable, Sendable {
  case number(Double)
  case string(String)

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let number = try? container.decode(Double.self) { self = .number(number); return }
    self = .string(try container.decode(String.self))
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .number(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    }
  }
}

public enum H2RHFDisposition: String, Codable, Equatable, Sendable {
  case idle
  case correcting
  case promoted
  case cancelled
  case outsideEnvelope = "outside-envelope"
  case maxIterations = "max-iterations"
  case referenceUnverified = "reference-unverified"
  case numericalFailure = "numerical-failure"
}

public enum H2RHFTraceKind: String, Codable, Equatable, Sendable {
  case referenceUnverified = "reference-unverified"
  case contactBegin = "contact-begin"
  case request
  case requestIgnored = "request-ignored"
  case tick
  case gatePass = "gate-pass"
  case release
  case promotion
  case outsideEnvelope = "outside-envelope"
  case maxIterations = "max-iterations"
  case numericalFailure = "numerical-failure"
  case cancel
}

public struct H2RHFCheckpoint: Codable, Equatable, Sendable {
  public let targetId: String
  public let separationAngstrom: Double
  public let density: H2RHFMatrix
  public let energy: Double
  public let electronCount: Double
  public let promotionGeneration: Int
  public let digest: String

  public init(targetId: String, separationAngstrom: Double, density: H2RHFMatrix, energy: Double, electronCount: Double, promotionGeneration: Int, digest: String) {
    self.targetId = targetId
    self.separationAngstrom = separationAngstrom
    self.density = density
    self.energy = energy
    self.electronCount = electronCount
    self.promotionGeneration = promotionGeneration
    self.digest = digest
  }
}

public struct H2RHFCandidateSnapshot: Codable, Equatable, Sendable {
  public let targetId: String
  public let contactEpoch: H2RHFContactEpoch
  public let status: String
  public let rawSeparationAngstrom: Double
  public let requestSeparationAngstrom: Double
  public let density: H2RHFMatrix
  public let energy: Double
  public let residual: Double?
  public let energyDelta: Double?
  public let electronCount: Double
  public let electronCountError: Double
  public let iteration: Int
  public let gateStreak: Int

  public init(targetId: String, contactEpoch: H2RHFContactEpoch, status: String, rawSeparationAngstrom: Double, requestSeparationAngstrom: Double, density: H2RHFMatrix, energy: Double, residual: Double?, energyDelta: Double?, electronCount: Double, electronCountError: Double, iteration: Int, gateStreak: Int) {
    self.targetId = targetId
    self.contactEpoch = contactEpoch
    self.status = status
    self.rawSeparationAngstrom = rawSeparationAngstrom
    self.requestSeparationAngstrom = requestSeparationAngstrom
    self.density = density
    self.energy = energy
    self.residual = residual
    self.energyDelta = energyDelta
    self.electronCount = electronCount
    self.electronCountError = electronCountError
    self.iteration = iteration
    self.gateStreak = gateStreak
  }
}

public struct H2RHFTraceEvent: Codable, Equatable, Sendable {
  public let kind: H2RHFTraceKind
  public let tick: Int
  public let contactEpoch: H2RHFContactEpoch?
  public let targetId: String?
  public let disposition: H2RHFDisposition
  public let iteration: Int
  public let gateStreak: Int
  public let separationAngstrom: Double?
  public let residual: Double?
  public let energyDelta: Double?
  public let electronCountError: Double?
  public let promotionGeneration: Int
  public let checkpointDigest: String?
  public let gatePass: Bool

  public init(kind: H2RHFTraceKind, tick: Int, contactEpoch: H2RHFContactEpoch?, targetId: String?, disposition: H2RHFDisposition, iteration: Int, gateStreak: Int, separationAngstrom: Double?, residual: Double?, energyDelta: Double?, electronCountError: Double?, promotionGeneration: Int, checkpointDigest: String?, gatePass: Bool) {
    self.kind = kind
    self.tick = tick
    self.contactEpoch = contactEpoch
    self.targetId = targetId
    self.disposition = disposition
    self.iteration = iteration
    self.gateStreak = gateStreak
    self.separationAngstrom = separationAngstrom
    self.residual = residual
    self.energyDelta = energyDelta
    self.electronCountError = electronCountError
    self.promotionGeneration = promotionGeneration
    self.checkpointDigest = checkpointDigest
    self.gatePass = gatePass
  }
}

public typealias H2RHFMilestone = H2RHFTraceEvent

public struct H2RHFSnapshot: Codable, Equatable, Sendable {
  public let tick: Int
  public let contactEpoch: H2RHFContactEpoch?
  public let targetId: String?
  public let contactActive: Bool
  public let outsideEnvelopeLatched: Bool
  public let disposition: H2RHFDisposition
  public let movingCandidate: H2RHFCandidateSnapshot?
  public let frozenCandidate: H2RHFCandidateSnapshot?
  public let candidate: H2RHFCandidateSnapshot?
  public let lastGood: H2RHFCheckpoint?
  public let gateStreak: Int
  public let perRequestIterations: Int
  public let promotionGeneration: Int
  public let traceLength: Int
  public let milestones: [H2RHFMilestone]

  public init(tick: Int, contactEpoch: H2RHFContactEpoch?, targetId: String?, contactActive: Bool, outsideEnvelopeLatched: Bool, disposition: H2RHFDisposition, movingCandidate: H2RHFCandidateSnapshot?, frozenCandidate: H2RHFCandidateSnapshot?, candidate: H2RHFCandidateSnapshot?, lastGood: H2RHFCheckpoint?, gateStreak: Int, perRequestIterations: Int, promotionGeneration: Int, traceLength: Int, milestones: [H2RHFMilestone]) {
    self.tick = tick
    self.contactEpoch = contactEpoch
    self.targetId = targetId
    self.contactActive = contactActive
    self.outsideEnvelopeLatched = outsideEnvelopeLatched
    self.disposition = disposition
    self.movingCandidate = movingCandidate
    self.frozenCandidate = frozenCandidate
    self.candidate = candidate
    self.lastGood = lastGood
    self.gateStreak = gateStreak
    self.perRequestIterations = perRequestIterations
    self.promotionGeneration = promotionGeneration
    self.traceLength = traceLength
    self.milestones = milestones
  }
}

public struct H2RHFContactInput: Codable, Equatable, Sendable {
  public let contactEpoch: H2RHFContactEpoch?
  public let targetId: String?
  public let separationAngstrom: Double
  public let rawSeparationAngstrom: Double?

  public init(separationAngstrom: Double, rawSeparationAngstrom: Double? = nil, targetId: String? = nil, contactEpoch: H2RHFContactEpoch? = nil) {
    self.contactEpoch = contactEpoch
    self.targetId = targetId
    self.separationAngstrom = separationAngstrom
    self.rawSeparationAngstrom = rawSeparationAngstrom
  }
}

public struct H2RHFRequestInput: Codable, Equatable, Sendable {
  public let separationAngstrom: Double
  public let rawSeparationAngstrom: Double?
  public let targetId: String?

  public init(separationAngstrom: Double, rawSeparationAngstrom: Double? = nil, targetId: String? = nil) {
    self.separationAngstrom = separationAngstrom
    self.rawSeparationAngstrom = rawSeparationAngstrom
    self.targetId = targetId
  }
}

public struct H2RHFReleaseInput: Codable, Equatable, Sendable {
  public let separationAngstrom: Double?
  public let rawSeparationAngstrom: Double?

  public init(separationAngstrom: Double? = nil, rawSeparationAngstrom: Double? = nil) {
    self.separationAngstrom = separationAngstrom
    self.rawSeparationAngstrom = rawSeparationAngstrom
  }
}

public struct H2RHFAuthorityTestSeam: Codable, Equatable, Sendable {
  public let forceMaxIterations: Bool
  public let failNumericallyAtTick: Int?

  public init(forceMaxIterations: Bool = false, failNumericallyAtTick: Int? = nil) {
    self.forceMaxIterations = forceMaxIterations
    self.failNumericallyAtTick = failNumericallyAtTick
  }
}

public struct H2RHFAuthorityOptions: Codable, Equatable, Sendable {
  public let initialSeparationAngstrom: Double
  public let initialTargetId: String
  public let maxTraceEntries: Int
  public let testSeam: H2RHFAuthorityTestSeam

  public init(initialSeparationAngstrom: Double = 0.75, initialTargetId: String = "h2-1", maxTraceEntries: Int = 128, testSeam: H2RHFAuthorityTestSeam = .init()) {
    self.initialSeparationAngstrom = initialSeparationAngstrom
    self.initialTargetId = initialTargetId
    self.maxTraceEntries = maxTraceEntries
    self.testSeam = testSeam
  }
}

public enum H2RHFCommand: Codable, Equatable, Sendable {
  case beginContact(H2RHFContactInput)
  case request(H2RHFRequestInput)
  case release(H2RHFReleaseInput?)
  case cancel
}

public struct H2RHFAdapterSnapshot: Codable, Equatable, Sendable {
  public let accumulatorMs: Double
  public let logicalTicks: Int
  public let queuedCommands: Int
  public let rebaseCount: Int

  public init(accumulatorMs: Double, logicalTicks: Int, queuedCommands: Int, rebaseCount: Int) {
    self.accumulatorMs = accumulatorMs
    self.logicalTicks = logicalTicks
    self.queuedCommands = queuedCommands
    self.rebaseCount = rebaseCount
  }
}

public struct H2RHFHoldResult: Codable, Equatable, Sendable {
  public let rawSeparationAngstrom: Double
  public let separationAngstrom: Double
  public let supported: Bool

  public init(rawSeparationAngstrom: Double, separationAngstrom: Double, supported: Bool) {
    self.rawSeparationAngstrom = rawSeparationAngstrom
    self.separationAngstrom = separationAngstrom
    self.supported = supported
  }
}

/// A compact, Codable fixture envelope used only by the cross-language test
/// seam. It intentionally has no presentation or sensory fields.
public struct H2RHFFixtureOutput: Codable, Equatable, Sendable {
  public let scenario: String
  public let snapshot: H2RHFSnapshot
  public let trace: [H2RHFTraceEvent]
  public let milestones: [H2RHFMilestone]
  public let adapter: H2RHFAdapterSnapshot?

  public init(scenario: String, snapshot: H2RHFSnapshot, trace: [H2RHFTraceEvent], milestones: [H2RHFMilestone], adapter: H2RHFAdapterSnapshot? = nil) {
    self.scenario = scenario
    self.snapshot = snapshot
    self.trace = trace
    self.milestones = milestones
    self.adapter = adapter
  }
}
