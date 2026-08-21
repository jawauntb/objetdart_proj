import Foundation

/// A bounded molecular instrument built from a curated real-compound register.
///
/// The compounds and reactions are intentionally small and explicit. This is
/// enough to make formula, geometry, bond order, reaction energy, and vibration
/// tangible without pretending the app contains a general-purpose chemistry
/// engine. Unsupported pairs stay inert until a curated equation exists.
public final class MoleculeKernel: SurfaceSimulationKernel {
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
    public var compound: Compound
    public var x: Double
    public var y: Double
    public var vx: Double
    public var vy: Double
    public var vibration: Double
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

  private static let curatedReactions: [String: Reaction] = [
    "H2|O2": Reaction(reactants: ["H2", "H2", "O2"], products: ["H2O", "H2O"], energy: 572),
    "CH4|O2": Reaction(reactants: ["CH4", "O2", "O2"], products: ["CO2", "H2O", "H2O"], energy: 890),
    "H2|N2": Reaction(reactants: ["N2", "H2", "H2", "H2"], products: ["NH3", "NH3"], energy: 92),
  ]

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

  private var surface: [Float]
  private let seed: UInt64
  private let maximumMolecules = 18

  public init(seed: UInt64 = 0, secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    precondition(secondsPerTick > 0)
    self.seed = seed
    self.secondsPerTick = secondsPerTick
    surface = [Float](repeating: 0, count: width * height)
    var random = SplitMix64(seed: seed &+ 0xC8E0_2026)
    molecules = []
    for index in 0 ..< 8 {
      let compound = Self.compounds[(index + Int(seed % UInt64(Self.compounds.count))) % Self.compounds.count]
      molecules.append(Molecule(
        compound: compound,
        x: -0.72 + random.nextUnitDouble() * 1.44,
        y: -0.72 + random.nextUnitDouble() * 1.44,
        vx: (random.nextUnitDouble() - 0.5) * 0.12,
        vy: (random.nextUnitDouble() - 0.5) * 0.12,
        vibration: random.nextUnitDouble() * 0.4
      ))
    }
    projectSurface()
  }

  public func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T {
    surface.withUnsafeBufferPointer { body($0.baseAddress!, width, height) }
  }

  public func setRepresentation(_ rawValue: Int) {
    representation = min(max(rawValue, 0), 3)
    projectSurface()
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
      addMolecule(x: point.x * 2 - 1, y: point.y * 2 - 1, intensity: intensity)
    case .ceremony:
      reactNearest(intensity: intensity)
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
    projectSurface()
    return output()
  }

  public func advance(ticks: Int) -> KernelOutput {
    guard ticks > 0 else { return output() }
    for _ in 0 ..< ticks { step() }
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
    projectSurface()
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
    guard molecules.count < maximumMolecules else { seedMolecule(x: x, y: y, intensity: intensity); return }
    let index = molecules.count
    let compound = Self.compounds[(index * 3 + Int(seed % UInt64(Self.compounds.count))) % Self.compounds.count]
    molecules.append(Molecule(compound: compound, x: x, y: y, vx: 0.03 * intensity, vy: -0.02 * intensity, vibration: 0.25 + intensity * 0.55))
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
        if candidate < best { best = candidate; first = i; second = j }
      }
    }
    let a = molecules[first].compound.key
    let b = molecules[second].compound.key
    let reaction = reactionFor(a, b)
    guard !reaction.products.isEmpty, let consumed = inventoryIndices(for: reaction.reactants) else { return }

    let x = consumed.reduce(0.0) { $0 + molecules[$1].x } / Double(consumed.count)
    let y = consumed.reduce(0.0) { $0 + molecules[$1].y } / Double(consumed.count)
    reactions.append(reaction)
    for index in consumed.sorted(by: >) { molecules.remove(at: index) }
    for (index, productKey) in reaction.products.enumerated() {
      guard let product = Self.compounds.first(where: { $0.key == productKey }) else { continue }
      let offset = (Double(index) - Double(reaction.products.count - 1) * 0.5) * 0.08
      molecules.append(Molecule(
        compound: product,
        x: x + offset,
        y: y,
        vx: 0,
        vy: 0,
        vibration: min(1, 0.45 + abs(reaction.energy) / 500 * intensity)
      ))
    }
    if reactions.count > 32 { reactions.removeFirst(reactions.count - 32) }
  }

  public func reactionFor(_ first: String, _ second: String) -> Reaction {
    // The field gesture selects a pair; the ledger records the complete
    // balanced equation so the guide never teaches a visually convenient but
    // chemically impossible atom count. The application path consumes the full
    // reactant inventory before adding the products.
    if let curated = Self.curatedReactions[Self.reactionKey(first, second)] { return curated }
    return Reaction(reactants: [first, second], products: [], energy: 0)
  }

  private static func reactionKey(_ first: String, _ second: String) -> String {
    [first, second].sorted().joined(separator: "|")
  }

  private func inventoryIndices(for keys: [String]) -> [Int]? {
    var available = Set(molecules.indices)
    var selected: [Int] = []
    selected.reserveCapacity(keys.count)
    for key in keys {
      guard let index = available.first(where: { molecules[$0].compound.key == key }) else { return nil }
      available.remove(index)
      selected.append(index)
    }
    return selected
  }

  private func projectSurface() {
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
    energy = molecules.reduce(0) { $0 + $1.vibration } + reactions.suffix(8).reduce(0) { $0 + abs($1.energy) / 500 }
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
