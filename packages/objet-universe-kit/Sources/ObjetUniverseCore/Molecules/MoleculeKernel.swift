import Foundation
import simd

/// A bounded molecular instrument built from a curated real-compound register.
///
/// The compounds and reactions are intentionally small and explicit. This is
/// enough to make formula, geometry, bond order, reaction energy, and vibration
/// tangible without pretending the app contains a general-purpose chemistry
/// engine. Unsupported pairs stay inert until a curated equation exists.
public final class MoleculeKernel: SurfaceSimulationKernel, MoleculeSnapshotProviding, MoleculeH2OutcomeProducing {
  public enum Shape: String, Equatable, Sendable {
    case bent
    case linear
    case tetrahedral
    case trigonal
    case diatomic
    case ionic
  }

  public struct Compound: Equatable, Sendable {
    public let key: String
    public let name: String
    public let formula: String
    public let shape: Shape
    public let atomCount: Int
    public let energy: Double
    public init(key: String, name: String, formula: String, shape: Shape, atomCount: Int, energy: Double) {
      self.key = key
      self.name = name
      self.formula = formula
      self.shape = shape
      self.atomCount = atomCount
      self.energy = energy
    }
  }

  public struct Molecule: Equatable, Sendable {
    /// Stable authority identity. It survives array compaction after a
    /// reaction and is the only identity accepted by a continuous contact.
    public let id: UInt64
    /// Seed and ordinal are persisted alongside the identity so a replay can
    /// reconstruct the same molecule without relying on array position.
    public let seed: UInt64
    public let ordinal: UInt64
    public var compound: Compound
    public var x: Double
    public var y: Double
    public var vx: Double
    public var vy: Double
    public var vibration: Double

    public init(
      compound: Compound,
      x: Double,
      y: Double,
      vx: Double,
      vy: Double,
      vibration: Double,
      id: UInt64 = 0,
      seed: UInt64 = 0,
      ordinal: UInt64 = 0
    ) {
      self.id = id
      self.seed = seed
      self.ordinal = ordinal
      self.compound = compound
      self.x = x
      self.y = y
      self.vx = vx
      self.vy = vy
      self.vibration = vibration
    }
  }

  public struct Reaction: Equatable, Sendable {
    public let reactants: [String]
    public let products: [String]
    /// kJ/mol for the equation as written; positive values are released.
    public let energy: Double
    public init(reactants: [String], products: [String], energy: Double) {
      self.reactants = reactants.sorted()
      self.products = products.sorted()
      self.energy = energy
    }
  }

  public static let compounds: [Compound] = [
    Compound(key: "H2O", name: "water", formula: "H₂O", shape: .bent, atomCount: 3, energy: -286),
    Compound(key: "CO2", name: "carbon dioxide", formula: "CO₂", shape: .linear, atomCount: 3, energy: -394),
    Compound(key: "CH4", name: "methane", formula: "CH₄", shape: .tetrahedral, atomCount: 5, energy: -75),
    Compound(key: "NH3", name: "ammonia", formula: "NH₃", shape: .trigonal, atomCount: 4, energy: -46),
    Compound(key: "O2", name: "oxygen", formula: "O₂", shape: .diatomic, atomCount: 2, energy: 0),
    Compound(key: "N2", name: "nitrogen", formula: "N₂", shape: .diatomic, atomCount: 2, energy: 0),
    Compound(key: "H2", name: "hydrogen", formula: "H₂", shape: .diatomic, atomCount: 2, energy: 0),
    Compound(key: "NaCl", name: "salt", formula: "NaCl", shape: .ionic, atomCount: 2, energy: -411),
  ]
  public static let maximumMolecules = 18
  private static let compoundIndices = Dictionary(
    uniqueKeysWithValues: compounds.enumerated().map { index, compound in
      (compound.key, UInt32(clamping: index))
    }
  )

  private static let curatedReactions: [String: Reaction] = [
    "H2|O2": Reaction(reactants: ["H2", "H2", "O2"], products: ["H2O", "H2O"], energy: 572),
    "CH4|O2": Reaction(reactants: ["CH4", "O2", "O2"], products: ["CO2", "H2O", "H2O"], energy: 890),
    "H2|N2": Reaction(reactants: ["N2", "H2", "H2", "H2"], products: ["NH3", "NH3"], energy: 92),
  ]

  /// Public lookup used by the pure target resolver. Returning an empty
  /// product list is the explicit no-reaction result, never a fallback model.
  public static func reactionForCompoundKeys(_ first: String, _ second: String) -> Reaction {
    curatedReactions[reactionKey(first, second)] ?? Reaction(reactants: [first, second], products: [], energy: 0)
  }

  public let scene: SceneID = .molecules
  public let materialKind = 4
  public let width = 144
  public let height = 144
  public let secondsPerTick: TimeInterval
  public private(set) var tick = 0
  public private(set) var representation = 0
  public var representationIndex: Int { representation }
  public private(set) var elapsedSeconds = 0.0
  public private(set) var energy = 0.0
  public let exposure = 1.0
  public private(set) var molecules: [Molecule]
  public private(set) var reactions: [Reaction] = []
  /// The one H₂ binding is keyed by stable body identity, not by its current
  /// array index. It becomes nil if chemistry retires that body.
  public private(set) var h2Outcome: MoleculeH2Outcome?
  public var h2MoleculeID: UInt64? { canonicalH2Molecule?.id }
  public var h2Binding: MoleculeH2Binding? {
    guard let molecule = canonicalH2Molecule else { return nil }
    return MoleculeH2Binding(bodyID: molecule.id, seed: molecule.seed, ordinal: molecule.ordinal)
  }

  private var surface: [Float]
  private var surfaceNeedsProjection: Bool
  /// Fixed-capacity presentation records rebuilt with authoritative state.
  /// The scalar surface remains for cross-platform compatibility, while native
  /// Metal receives this richer ledger directly.
  private var renderBodies: [MoleculeRenderBody]
  private var presentationReactionEnergy = 0.0
  /// Compact H₂ authority output prepared at the kernel cadence. The render
  /// closure borrows this value; it never snapshots the solver or allocates
  /// scientific arrays on every display frame.
  private var presentationH2Snapshot: MoleculeH2RenderSnapshot?
  private let seed: UInt64
  private var nextMoleculeOrdinal: UInt64 = 1
  private var canonicalH2CreationPending = false
  private var nextInteractionEpoch: UInt64 = 1
  private var activeInteractionEpoch: MoleculeH2InteractionEpoch?
  private let h2TargetingPolicy = MoleculeH2TargetingPolicy()

  public convenience init(seed: UInt64 = 0, secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    self.init(seed: seed, molecules: Self.seededMolecules(seed: seed), secondsPerTick: secondsPerTick)
  }

  /// Fixture and restore seam. Identity fields that are absent in a legacy
  /// record are deterministically filled from `(world seed, ordinal)`; a
  /// duplicate zero/default identity can therefore never cause two bodies to
  /// share one target or one H₂ association.
  public init(seed: UInt64, molecules: [Molecule], secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    precondition(secondsPerTick > 0 && secondsPerTick.isFinite)
    self.seed = seed
    self.secondsPerTick = secondsPerTick
    surface = [Float](repeating: 0, count: width * height)
    surfaceNeedsProjection = true
    renderBodies = []
    renderBodies.reserveCapacity(Self.maximumMolecules)
    let normalized = Self.normalizedMolecules(seed: seed, molecules: molecules)
    self.molecules = normalized
    self.nextMoleculeOrdinal = (normalized.map(\.ordinal).max() ?? 0) &+ 1
    self.canonicalH2CreationPending = !normalized.contains(where: { $0.compound.key == "H2" })
    h2Outcome = nil
    presentationH2Snapshot = nil
    refreshPresentation()
  }

  public func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T {
    materializeSurfaceIfNeeded()
    return surface.withUnsafeBufferPointer { body($0.baseAddress!, width, height) }
  }

  public func withMoleculeRenderSnapshot<T>(_ body: (MoleculeRenderSnapshot) -> T) -> T {
    renderBodies.withUnsafeBufferPointer { bodies in
      body(MoleculeRenderSnapshot(
        tick: tick,
        elapsedSeconds: elapsedSeconds,
        secondsPerTick: secondsPerTick,
        representation: representation,
        reactionEnergy: Float(presentationReactionEnergy),
        h2: presentationH2Snapshot,
        bodies: bodies
      ))
    }
  }

  public func setRepresentation(_ rawValue: Int) {
    representation = min(max(rawValue, 0), 3)
    refreshPresentation()
  }

  public func prepare() {}
  public func activate() {}
  public func freeze() {}
  public func retire() {}

  public func expresses(_ verb: SemanticVerb) -> Bool {
    switch verb {
    case .material, .grow, .ceremony, .tutti, .agitate, .wake, .gravity, .stepBack, .lens: true
    case .train, .scale, .season, .pan, .weather, .timeDilation, .night, .breath: false
    }
  }

  public func apply(_ command: SemanticCommand) -> KernelOutput {
    let intensity = min(max(command.intensity, 0), 1)
    let point = command.origin ?? .centre
    switch command.verb {
    case .material:
      seedMolecule(x: point.x * 2 - 1, y: point.y * 2 - 1, intensity: intensity)
    case .grow:
      if let contact = command.payload.contact, handleH2Contact(command, contact: contact) {
        break
      }
      if command.payload.contact == nil || command.payload.contact?.phase == .release {
        addMolecule(x: point.x * 2 - 1, y: point.y * 2 - 1, intensity: intensity)
      }
    case .ceremony:
      if let contact = command.payload.contact,
         let epoch = activeInteractionEpoch,
         epoch.continuation(in: targetBodies()) == .locked(epoch.intent),
         case .reaction(let primaryID, let partnerID, _) = epoch.intent,
         contact.phase == .release {
        react(primaryID: primaryID, partnerID: partnerID, intensity: intensity)
        activeInteractionEpoch = nil
      } else {
        reactNearest(intensity: intensity)
      }
    case .tutti, .agitate, .wake:
      for index in molecules.indices { molecules[index].vibration = min(1, molecules[index].vibration + 0.2 * intensity) }
    case .gravity:
      for index in molecules.indices { molecules[index].vx *= 1 - 0.12 * intensity; molecules[index].vy *= 1 - 0.12 * intensity }
    case .stepBack:
      representation = max(0, representation - 1)
    case .lens:
      representation = (representation + 1) % 4
    case .train, .scale, .season, .pan, .weather, .timeDilation, .night, .breath:
      break
    }
    refreshPresentation()
    return output()
  }

  public func advance(ticks: Int) -> KernelOutput {
    guard ticks > 0 else { return output() }
    for _ in 0 ..< ticks {
      step()
      // Universe presentation ticks are not H₂ authority ticks. The adapter
      // accumulates this cadence and advances the solver at its fixed 20 Hz
      // seam, preserving identical science across 30/60/120 Hz hosts.
      if let h2Outcome {
        _ = try? h2Outcome.advancePresentation(secondsPerTick * 1_000)
      }
    }
    refreshPresentation()
    return output()
  }

  private func step() {
    let dt = min(secondsPerTick, 1.0 / 60.0) * 0.45
    for index in molecules.indices {
      molecules[index].x += molecules[index].vx * dt
      molecules[index].y += molecules[index].vy * dt
      if abs(molecules[index].x) > 0.92 { molecules[index].vx *= -0.8 }
      if abs(molecules[index].y) > 0.92 { molecules[index].vy *= -0.8 }
      molecules[index].x = min(0.94, max(-0.94, molecules[index].x))
      molecules[index].y = min(0.94, max(-0.94, molecules[index].y))
      molecules[index].vibration *= 0.995
    }
    elapsedSeconds += secondsPerTick
    tick += 1
  }

  /// Resolves one continuous native contact at entry and keeps its meaning
  /// through every later sample. The H₂ branch is intentionally narrow:
  /// existing chemistry, including a docking partner, remains the ceremony
  /// path and never gets silently converted into an electronic perturbation.
  private func handleH2Contact(_ command: SemanticCommand, contact: SemanticContactPayload) -> Bool {
    let point = SIMD2<Double>(contact.point.x * 2 - 1, contact.point.y * 2 - 1)
    switch contact.phase {
    case .enter:
      let epoch = MoleculeH2Targeting.beginEpoch(
        epoch: nextInteractionEpoch,
        at: point,
        bodies: targetBodies(),
        policy: h2TargetingPolicy
      )
      nextInteractionEpoch &+= 1
      activeInteractionEpoch = epoch
      guard let targetID = epoch.targetID else { return false }
      if let suppliedTargetID = contact.targetBodyID, suppliedTargetID != targetID {
        activeInteractionEpoch = nil
        return true
      }
      switch epoch.intent {
      case .h2:
        guard let binding = h2Binding, binding.bodyID == targetID, let h2Outcome else { return true }
        guard let mapped = try? holdDurationToSeparation(0, intensity: max(command.intensity, contact.normalizedPressure)) else { return true }
        _ = h2Outcome.beginContact(
          separationAngstrom: mapped.separationAngstrom,
          rawSeparationAngstrom: mapped.rawSeparationAngstrom,
          contactEpoch: .number(Double(epoch.epoch)),
          targetID: binding.targetID
        )
        return true
      case .reaction, .other:
        return true
      case .openSky:
        return false
      }
    case .tick, .release, .cancel:
      guard let epoch = activeInteractionEpoch else {
        // Accessibility/assistive activation has no preceding pointer-enter.
        // Treat its synthetic release as one complete, retryable contact
        // epoch so it reaches the same H₂ authority path as touch.
        guard contact.phase == .release else { return false }
        return handleAssistiveH2Release(command, contact: contact)
      }
      guard epoch.continuation(in: targetBodies()) == .locked(epoch.intent) else {
        h2Outcome?.cancel()
        activeInteractionEpoch = nil
        return true
      }
      guard let targetID = epoch.targetID,
            contact.targetBodyID == nil || contact.targetBodyID == targetID else { return true }
      switch epoch.intent {
      case .h2:
        guard let binding = h2Binding, binding.bodyID == targetID, let h2Outcome else {
          activeInteractionEpoch = nil
          return true
        }
        if contact.phase == .cancel {
          _ = h2Outcome.cancel()
          activeInteractionEpoch = nil
          return true
        }
        guard let mapped = try? holdDurationToSeparation(
          contact.durationSeconds * 1_000,
          intensity: max(command.intensity, contact.normalizedPressure)
        ) else { return true }
        _ = h2Outcome.request(
          separationAngstrom: mapped.separationAngstrom,
          rawSeparationAngstrom: mapped.rawSeparationAngstrom
        )
        if contact.phase == .release {
          _ = h2Outcome.release(
            separationAngstrom: mapped.separationAngstrom,
            rawSeparationAngstrom: mapped.rawSeparationAngstrom
          )
          activeInteractionEpoch = nil
        }
        return true
      case .reaction, .other:
        if case .other = epoch.intent, contact.phase == .release {
          // Non-H₂ grow retains its original one-shot creation meaning at the
          // release boundary. Enter/tick stay observational; the outer grow
          // path adds exactly one molecule when this returns false.
          activeInteractionEpoch = nil
          return false
        }
        activeInteractionEpoch = contact.phase == .release || contact.phase == .cancel ? nil : epoch
        return true
      case .openSky:
        activeInteractionEpoch = nil
        return false
      }
    }
  }

  private func handleAssistiveH2Release(_ command: SemanticCommand, contact: SemanticContactPayload) -> Bool {
    let point = SIMD2<Double>(contact.point.x * 2 - 1, contact.point.y * 2 - 1)
    let epoch = MoleculeH2Targeting.beginEpoch(
      epoch: nextInteractionEpoch,
      at: point,
      bodies: targetBodies(),
      policy: h2TargetingPolicy
    )
    nextInteractionEpoch &+= 1
    activeInteractionEpoch = epoch
    guard let targetID = epoch.targetID else {
      activeInteractionEpoch = nil
      return false
    }
    if let suppliedTargetID = contact.targetBodyID, suppliedTargetID != targetID {
      activeInteractionEpoch = nil
      return true
    }
    switch epoch.intent {
    case .h2:
      guard let binding = h2Binding, binding.bodyID == targetID, let h2Outcome,
            let mapped = try? holdDurationToSeparation(
              contact.durationSeconds * 1_000,
              intensity: max(command.intensity, contact.normalizedPressure)
            ) else {
        activeInteractionEpoch = nil
        return true
      }
      _ = h2Outcome.beginContact(
        separationAngstrom: mapped.separationAngstrom,
        rawSeparationAngstrom: mapped.rawSeparationAngstrom,
        contactEpoch: .number(Double(epoch.epoch)),
        targetID: binding.targetID
      )
      _ = h2Outcome.request(
        separationAngstrom: mapped.separationAngstrom,
        rawSeparationAngstrom: mapped.rawSeparationAngstrom
      )
      _ = h2Outcome.release(
        separationAngstrom: mapped.separationAngstrom,
        rawSeparationAngstrom: mapped.rawSeparationAngstrom
      )
      activeInteractionEpoch = nil
      return true
    case .reaction:
      // Chemistry owns the H₂ body when a valid partner is present; an
      // assistive grow must not silently turn that ceremony into a field hold.
      activeInteractionEpoch = nil
      return true
    case .other:
      activeInteractionEpoch = nil
      return false
    case .openSky:
      activeInteractionEpoch = nil
      return false
    }
  }

  /// A stable target query for touch, keyboard, and assistive activation. The
  /// resolver sees the same canonical body records irrespective of population
  /// ordering, so array compaction cannot retarget a held contact.
  public func moleculeTargetBodyID(at materialPoint: SemanticOrigin) -> UInt64? {
    MoleculeH2Targeting.nearestTarget(
      at: SIMD2(materialPoint.x * 2 - 1, materialPoint.y * 2 - 1),
      bodies: targetBodies(),
      policy: h2TargetingPolicy
    )
  }

  /// Whether a release at this material point belongs to the canonical H₂
  /// field rather than ordinary molecule growth or a reaction ceremony.
  /// This is a pure read used by the native host to suppress its generic
  /// hold-release cue; the interaction epoch itself remains kernel-owned.
  public func moleculeH2OwnsContact(at materialPoint: SemanticOrigin) -> Bool {
    guard let binding = h2Binding,
          case .h2(let targetID) = MoleculeH2Targeting.resolve(
            at: SIMD2(materialPoint.x * 2 - 1, materialPoint.y * 2 - 1),
            bodies: targetBodies(),
            policy: h2TargetingPolicy
          ) else { return false }
    return targetID == binding.bodyID
  }

  public func moleculeInteractionEpoch(at materialPoint: SemanticOrigin) -> MoleculeH2InteractionEpoch {
    let epoch = MoleculeH2Targeting.beginEpoch(
      epoch: nextInteractionEpoch,
      at: SIMD2(materialPoint.x * 2 - 1, materialPoint.y * 2 - 1),
      bodies: targetBodies(),
      policy: h2TargetingPolicy
    )
    nextInteractionEpoch &+= 1
    return epoch
  }

  public func continuation(of epoch: MoleculeH2InteractionEpoch) -> MoleculeH2Continuation {
    epoch.continuation(in: targetBodies())
  }

  public func drainMoleculeH2Outcomes<T>(_ body: (UnsafeBufferPointer<MoleculeH2OutcomeEvent>) -> T) -> T {
    guard let h2Outcome else {
      return body(UnsafeBufferPointer<MoleculeH2OutcomeEvent>(start: nil, count: 0))
    }
    return h2Outcome.drainOutcomes(body)
  }

  private func targetBodies() -> [MoleculeTargetBody] {
    molecules.map {
      MoleculeTargetBody(
        id: $0.id,
        seed: $0.seed,
        ordinal: $0.ordinal,
        compoundKey: $0.compound.key,
        position: SIMD2($0.x, $0.y)
      )
    }
  }

  private func seedMolecule(x: Double, y: Double, intensity: Double) {
    guard !molecules.isEmpty else { addMolecule(x: x, y: y, intensity: intensity); return }
    var nearest = 0
    var distance = Double.greatestFiniteMagnitude
    for index in molecules.indices {
      let dx = molecules[index].x - x
      let dy = molecules[index].y - y
      let candidate = dx * dx + dy * dy
      if candidate < distance { distance = candidate; nearest = index }
    }
    molecules[nearest].vibration = min(1, molecules[nearest].vibration + 0.4 + intensity * 0.45)
    molecules[nearest].vx += (x - molecules[nearest].x) * 0.05 * intensity
    molecules[nearest].vy += (y - molecules[nearest].y) * 0.05 * intensity
  }

  private func addMolecule(x: Double, y: Double, intensity: Double) {
    if molecules.count >= Self.maximumMolecules {
      // A restored/fixture state with no H₂ is still recoverable through the
      // same grow path. Retire the oldest deterministic body to make room for
      // the canonical H₂ instead of silently turning the gesture into a
      // vibration-only seed.
      guard canonicalH2CreationPending, canonicalH2Molecule == nil,
            let oldestIndex = molecules.indices.min(by: {
              molecules[$0].ordinal == molecules[$1].ordinal
                ? molecules[$0].id < molecules[$1].id
                : molecules[$0].ordinal < molecules[$1].ordinal
            }) else {
        seedMolecule(x: x, y: y, intensity: intensity)
        return
      }
      molecules.remove(at: oldestIndex)
    }
    let ordinal = nextMoleculeOrdinal
    nextMoleculeOrdinal &+= 1
    let moleculeSeed = Self.stableMoleculeSeed(worldSeed: seed, ordinal: ordinal)
    let shouldCreateCanonicalH2 = canonicalH2CreationPending && canonicalH2Molecule == nil
    let compound: Compound
    if shouldCreateCanonicalH2 {
      // The H₂ path is a deterministic recovery seam, not a random choice in
      // the compound cycle. Once present, this flag is cleared and later
      // growth resumes the ordinary seeded register.
      compound = Self.compounds.first(where: { $0.key == "H2" })!
      canonicalH2CreationPending = false
    } else {
      let compoundIndex = Int((ordinal &* 3 &+ seed) % UInt64(Self.compounds.count))
      compound = Self.compounds[compoundIndex]
    }
    molecules.append(Molecule(
      compound: compound,
      x: x,
      y: y,
      vx: 0.03 * intensity,
      vy: -0.02 * intensity,
      vibration: 0.25 + intensity * 0.55,
      id: Self.stableMoleculeID(worldSeed: seed, ordinal: ordinal, moleculeSeed: moleculeSeed),
      seed: moleculeSeed,
      ordinal: ordinal
    ))
  }

  private func reactNearest(intensity: Double) {
    guard molecules.count >= 2 else { return }
    var first = 0
    var second = 1
    var best = Double.greatestFiniteMagnitude
    for i in molecules.indices {
      for j in (i + 1) ..< molecules.count {
        let dx = molecules[i].x - molecules[j].x
        let dy = molecules[i].y - molecules[j].y
        let candidate = dx * dx + dy * dy
        let firstID = min(molecules[i].id, molecules[j].id)
        let currentFirstID = min(molecules[first].id, molecules[second].id)
        let isCloser = candidate < best - MoleculeH2Targeting.distanceTieEpsilonForKernel
        let isStableTie = abs(candidate - best) <= MoleculeH2Targeting.distanceTieEpsilonForKernel && firstID < currentFirstID
        if isCloser || isStableTie { best = candidate; first = i; second = j }
      }
    }
    react(primaryID: molecules[first].id, partnerID: molecules[second].id, intensity: intensity)
  }

  private func react(primaryID: UInt64, partnerID: UInt64, intensity: Double) {
    guard primaryID != partnerID,
          let first = molecules.firstIndex(where: { $0.id == primaryID }),
          let second = molecules.firstIndex(where: { $0.id == partnerID }) else { return }
    let a = molecules[first].compound.key
    let b = molecules[second].compound.key
    let reaction = Self.reactionForCompoundKeys(a, b)
    guard !reaction.products.isEmpty, let consumed = inventoryIndices(for: reaction.reactants) else { return }

    let x = consumed.reduce(0.0) { $0 + molecules[$1].x } / Double(consumed.count)
    let y = consumed.reduce(0.0) { $0 + molecules[$1].y } / Double(consumed.count)
    reactions.append(reaction)
    for index in consumed.sorted(by: >) { molecules.remove(at: index) }
    for (index, productKey) in reaction.products.enumerated() {
      guard let product = Self.compounds.first(where: { $0.key == productKey }) else { continue }
      let offset = (Double(index) - Double(reaction.products.count - 1) * 0.5) * 0.08
      let ordinal = nextMoleculeOrdinal
      nextMoleculeOrdinal &+= 1
      let moleculeSeed = Self.stableMoleculeSeed(worldSeed: seed, ordinal: ordinal)
      molecules.append(Molecule(
        compound: product,
        x: x + offset,
        y: y,
        vx: 0,
        vy: 0,
        vibration: min(1, 0.45 + abs(reaction.energy) / 500 * intensity),
        id: Self.stableMoleculeID(worldSeed: seed, ordinal: ordinal, moleculeSeed: moleculeSeed),
        seed: moleculeSeed,
        ordinal: ordinal
      ))
    }
    if reactions.count > 32 { reactions.removeFirst(reactions.count - 32) }
    presentationReactionEnergy = reactions.suffix(4).reduce(0) { $0 + $1.energy }
  }

  public func reactionFor(_ first: String, _ second: String) -> Reaction {
    // The field gesture selects a pair; the ledger records the complete
    // balanced equation so the guide never teaches a visually convenient but
    // chemically impossible atom count. The application path consumes the full
    // reactant inventory before adding the products.
    return Self.reactionForCompoundKeys(first, second)
  }

  private static func reactionKey(_ first: String, _ second: String) -> String {
    [first, second].sorted().joined(separator: "|")
  }

  private static func stableMoleculeSeed(worldSeed: UInt64, ordinal: UInt64) -> UInt64 {
    var hash: UInt64 = 0xcbf29ce484222325
    for value in [worldSeed, ordinal, 0x4D4F4C4543554C45] {
      var lane = value
      for _ in 0 ..< 8 {
        hash ^= lane & 0xff
        hash = hash &* 0x100000001b3
        lane >>= 8
      }
    }
    return hash
  }

  private static func stableMoleculeID(worldSeed: UInt64, ordinal: UInt64, moleculeSeed: UInt64) -> UInt64 {
    var hash = moleculeSeed ^ worldSeed &* 0x9E3779B97F4A7C15 ^ ordinal &* 0xD1B54A32D192ED03
    hash ^= hash >> 30
    hash &*= 0xBF58476D1CE4E5B9
    hash ^= hash >> 27
    hash &*= 0x94D049BB133111EB
    hash ^= hash >> 31
    return hash == 0 ? ordinal : hash
  }

  private static func seededMolecules(seed: UInt64) -> [Molecule] {
    var random = SplitMix64(seed: seed &+ 0xC8E0_2026)
    var result: [Molecule] = []
    result.reserveCapacity(8)
    for index in 0 ..< 8 {
      let ordinal = UInt64(index + 1)
      let compound = compounds[(index + Int(seed % UInt64(compounds.count))) % compounds.count]
      let moleculeSeed = stableMoleculeSeed(worldSeed: seed, ordinal: ordinal)
      result.append(Molecule(
        compound: compound,
        x: -0.72 + random.nextUnitDouble() * 1.44,
        y: -0.72 + random.nextUnitDouble() * 1.44,
        vx: (random.nextUnitDouble() - 0.5) * 0.12,
        vy: (random.nextUnitDouble() - 0.5) * 0.12,
        vibration: random.nextUnitDouble() * 0.4,
        id: stableMoleculeID(worldSeed: seed, ordinal: ordinal, moleculeSeed: moleculeSeed),
        seed: moleculeSeed,
        ordinal: ordinal
      ))
    }
    return result
  }

  private static func normalizedMolecules(seed: UInt64, molecules: [Molecule]) -> [Molecule] {
    var result: [Molecule] = []
    result.reserveCapacity(min(maximumMolecules, molecules.count))
    var usedIDs = Set<UInt64>()
    var usedOrdinals = Set<UInt64>()
    var fallbackOrdinal: UInt64 = 1
    for (index, molecule) in molecules.prefix(maximumMolecules).enumerated() {
      var ordinal = molecule.ordinal == 0 ? UInt64(index + 1) : molecule.ordinal
      while ordinal == 0 || usedOrdinals.contains(ordinal) {
        ordinal = max(fallbackOrdinal, UInt64(index + 1))
        fallbackOrdinal &+= 1
      }
      usedOrdinals.insert(ordinal)
      fallbackOrdinal = max(fallbackOrdinal, ordinal &+ 1)

      let moleculeSeed = molecule.seed == 0 ? stableMoleculeSeed(worldSeed: seed, ordinal: ordinal) : molecule.seed
      var id = molecule.id == 0 ? stableMoleculeID(worldSeed: seed, ordinal: ordinal, moleculeSeed: moleculeSeed) : molecule.id
      while id == 0 || usedIDs.contains(id) { id &+= 1 }
      usedIDs.insert(id)
      result.append(Molecule(
        compound: molecule.compound,
        x: molecule.x,
        y: molecule.y,
        vx: molecule.vx,
        vy: molecule.vy,
        vibration: molecule.vibration,
        id: id,
        seed: moleculeSeed,
        ordinal: ordinal
      ))
    }
    return result
  }

  private func inventoryIndices(for keys: [String]) -> [Int]? {
    var available = Array(molecules.indices)
    var selected: [Int] = []
    selected.reserveCapacity(keys.count)
    for key in keys {
      guard let position = available.firstIndex(where: { molecules[$0].compound.key == key }) else { return nil }
      let index = available.remove(at: position)
      selected.append(index)
    }
    return selected
  }

  private func refreshPresentation() {
    let binding = h2Binding
    if let h2Outcome, binding?.bodyID != h2Outcome.bodyID {
      self.h2Outcome = nil
      activeInteractionEpoch = nil
    }
    if binding != nil {
      canonicalH2CreationPending = false
    } else {
      canonicalH2CreationPending = true
    }
    if self.h2Outcome == nil, let binding {
      self.h2Outcome = MoleculeH2Outcome(bodyID: binding.bodyID, targetID: binding.targetID)
    }
    presentationH2Snapshot = makeH2RenderSnapshot()
    energy = molecules.reduce(0) { $0 + $1.vibration } + reactions.suffix(8).reduce(0) { $0 + abs($1.energy) / 500 }
    rebuildRenderSnapshot()
    surfaceNeedsProjection = true
  }

  /// Copies the authority's immutable state into the compact render seam at
  /// the kernel cadence. This is presentation plumbing only: the renderer
  /// still selects candidate versus last-good from the explicit disposition.
  private func makeH2RenderSnapshot() -> MoleculeH2RenderSnapshot? {
    guard let binding = h2Binding,
          let projection = h2Outcome?.renderSnapshot,
          projection.bodyID == binding.bodyID else { return nil }
    return projection
  }

  private func materializeSurfaceIfNeeded() {
    guard surfaceNeedsProjection else { return }
    surface.withUnsafeMutableBufferPointer { output in
      for index in output.indices { output[index] = 0 }
      switch representation {
      case 0: projectMixture(into: &output)
      case 1: projectStructure(into: &output)
      case 2: projectReaction(into: &output)
      case 3: projectVibration(into: &output)
      default: break
      }
    }
    surfaceNeedsProjection = false
  }

  private func rebuildRenderSnapshot() {
    renderBodies.removeAll(keepingCapacity: true)
    for molecule in molecules {
      let compoundIndex = Self.compoundIndices[molecule.compound.key] ?? 0
      renderBodies.append(MoleculeRenderBody(
        position: SIMD2<Float>(Float(molecule.x), Float(molecule.y)),
        velocity: SIMD2<Float>(Float(molecule.vx), Float(molecule.vy)),
        compoundIndex: compoundIndex,
        shape: Self.renderShape(for: molecule.compound.shape),
        atomCount: UInt32(clamping: molecule.compound.atomCount),
        vibration: Float(min(max(molecule.vibration, 0), 1)),
        id: molecule.id,
        seed: molecule.seed,
        ordinal: molecule.ordinal
      ))
    }
  }

  /// Canonical H₂ selection is independent of population order. Ordinal is
  /// the replay/migration identity; stable body ID is the final deterministic
  /// tie-break for legacy records that share an ordinal.
  private var canonicalH2Molecule: Molecule? {
    molecules
      .filter { $0.compound.key == "H2" }
      .min {
        $0.ordinal == $1.ordinal
          ? $0.id < $1.id
          : $0.ordinal < $1.ordinal
      }
  }

  private static func renderShape(for shape: Shape) -> MoleculeRenderShape {
    switch shape {
    case .bent: .bent
    case .linear: .linear
    case .tetrahedral: .tetrahedral
    case .trigonal: .trigonal
    case .diatomic: .diatomic
    case .ionic: .ionic
    }
  }

  private func projectMixture(into output: inout UnsafeMutableBufferPointer<Float>) {
    for molecule in molecules { paint(molecule.x, molecule.y, radius: 4 + molecule.vibration * 9, value: 0.22 + molecule.vibration * 0.65, into: &output) }
  }

  private func projectStructure(into output: inout UnsafeMutableBufferPointer<Float>) {
    guard let molecule = molecules.max(by: { $0.vibration < $1.vibration }) else { return }
    if molecule.compound.shape == .diatomic || molecule.compound.shape == .ionic {
      let leftX = molecule.x - 0.08
      let rightX = molecule.x + 0.08
      paint(leftX, molecule.y, radius: 5, value: 0.6, into: &output)
      paint(rightX, molecule.y, radius: 5, value: 0.6, into: &output)
      paintLine(leftX, molecule.y, rightX, molecule.y, into: &output)
      return
    }
    let count = geometrySiteCount(for: molecule.compound.shape)
    for index in 0 ..< count {
      let angle = Double(index) / Double(count) * Double.pi * 2
      paint(molecule.x + cos(angle) * 0.08, molecule.y + sin(angle) * 0.08, radius: 5, value: 0.6, into: &output)
      if index > 0 { paintLine(molecule.x, molecule.y, molecule.x + cos(angle) * 0.08, molecule.y + sin(angle) * 0.08, into: &output) }
    }
  }

  private func projectReaction(into output: inout UnsafeMutableBufferPointer<Float>) {
    let pulse = min(1, reactions.suffix(4).reduce(0) { $0 + abs($1.energy) / 700 })
    paint(0, 0, radius: 12 + pulse * 16, value: 0.25 + pulse * 0.7, into: &output)
    for molecule in molecules { paint(molecule.x, molecule.y, radius: 2 + molecule.vibration * 5, value: molecule.vibration * 0.7, into: &output) }
  }

  private func projectVibration(into output: inout UnsafeMutableBufferPointer<Float>) {
    for molecule in molecules {
      let count = geometrySiteCount(for: molecule.compound.shape)
      for index in 0 ..< count {
        let angle = Double(index) / Double(count) * Double.pi * 2 + elapsedSeconds * (0.7 + molecule.vibration)
        let radius = 0.07 + sin(angle) * molecule.vibration * 0.025
        paint(molecule.x + cos(angle) * radius, molecule.y + sin(angle) * radius, radius: 2.5, value: 0.3 + molecule.vibration * 0.6, into: &output)
      }
    }
  }

  /// Peripheral sites; the central atom is the molecule's field anchor and
  /// is rendered once by the spokes, so formula atom counts remain truthful.
  private func geometrySiteCount(for shape: Shape) -> Int {
    switch shape {
    case .diatomic, .ionic, .linear, .bent: return 2
    case .trigonal: return 3
    case .tetrahedral: return 4
    }
  }

  private func paintLine(_ ax: Double, _ ay: Double, _ bx: Double, _ by: Double, into output: inout UnsafeMutableBufferPointer<Float>) {
    for step in 0 ... 16 {
      let t = Double(step) / 16
      paint(ax * (1 - t) + bx * t, ay * (1 - t) + by * t, radius: 1.8, value: 0.35, into: &output)
    }
  }

  private func paint(_ x: Double, _ y: Double, radius: Double, value: Double, into output: inout UnsafeMutableBufferPointer<Float>) {
    ScalarFieldPainter.gaussian(x: x, y: y, radius: radius, value: value, width: width, height: height, into: &output)
  }

  private func output() -> KernelOutput {
    .init(stable: energy.isFinite, checkpoint: .init(scene: scene, tick: tick, digest: "molecules-v1-\(tick)-\(representation)-\(molecules.count)-\(reactions.count)-\(energy.bitPattern)"))
  }
}
