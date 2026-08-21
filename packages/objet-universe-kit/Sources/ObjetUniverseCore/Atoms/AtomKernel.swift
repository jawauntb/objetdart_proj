import Foundation

/// A bounded atomic instrument for the first chemistry band.
///
/// The kernel keeps identity and the small ledgers that matter to the scene:
/// atomic number, occupied shells, covalent appetite, excitation, and fusion
/// energy. It is deliberately not a quantum solver. The scalar surface is a
/// projection of those ledgers, so the same atom that glows also names the
/// bond or fusion event in the trail and guide.
public final class AtomKernel: SurfaceSimulationKernel {
  public struct Element: Equatable, Sendable {
    public let z: Int
    public let symbol: String
    public let mass: Int
    public let shells: [Int]
    public let valence: Int
    public let electronegativity: Double

    public init(z: Int, symbol: String, mass: Int, shells: [Int], valence: Int, electronegativity: Double) {
      self.z = z
      self.symbol = symbol
      self.mass = mass
      self.shells = shells
      self.valence = valence
      self.electronegativity = electronegativity
    }
  }

  public struct Atom: Equatable, Sendable {
    public var element: Element
    /// Representative isotope nucleon count carried independently from the
    /// element register's rounded atomic mass.
    public var nucleons: Int
    public var x: Double
    public var y: Double
    public var vx: Double
    public var vy: Double
    public var excitation: Double
  }

  public struct Bond: Equatable, Sendable {
    public let first: Int
    public let second: Int
    public let order: Int

    public init(first: Int, second: Int, order: Int) {
      self.first = min(first, second)
      self.second = max(first, second)
      self.order = order
    }
  }

  public static let elements: [Element] = [
    Element(z: 1, symbol: "H", mass: 1, shells: [1], valence: 1, electronegativity: 2.20),
    Element(z: 2, symbol: "He", mass: 4, shells: [2], valence: 0, electronegativity: 0),
    Element(z: 3, symbol: "Li", mass: 7, shells: [2, 1], valence: 1, electronegativity: 0.98),
    Element(z: 4, symbol: "Be", mass: 9, shells: [2, 2], valence: 2, electronegativity: 1.57),
    Element(z: 5, symbol: "B", mass: 11, shells: [2, 3], valence: 3, electronegativity: 2.04),
    Element(z: 6, symbol: "C", mass: 12, shells: [2, 4], valence: 4, electronegativity: 2.55),
    Element(z: 7, symbol: "N", mass: 14, shells: [2, 5], valence: 3, electronegativity: 3.04),
    Element(z: 8, symbol: "O", mass: 16, shells: [2, 6], valence: 2, electronegativity: 3.44),
    Element(z: 9, symbol: "F", mass: 19, shells: [2, 7], valence: 1, electronegativity: 3.98),
    Element(z: 10, symbol: "Ne", mass: 20, shells: [2, 8], valence: 0, electronegativity: 0),
    Element(z: 11, symbol: "Na", mass: 23, shells: [2, 8, 1], valence: 1, electronegativity: 0.93),
    Element(z: 12, symbol: "Mg", mass: 24, shells: [2, 8, 2], valence: 2, electronegativity: 1.31),
    Element(z: 13, symbol: "Al", mass: 27, shells: [2, 8, 3], valence: 3, electronegativity: 1.61),
    Element(z: 14, symbol: "Si", mass: 28, shells: [2, 8, 4], valence: 4, electronegativity: 1.90),
    Element(z: 15, symbol: "P", mass: 31, shells: [2, 8, 5], valence: 3, electronegativity: 2.19),
    Element(z: 16, symbol: "S", mass: 32, shells: [2, 8, 6], valence: 2, electronegativity: 2.58),
    Element(z: 17, symbol: "Cl", mass: 35, shells: [2, 8, 7], valence: 1, electronegativity: 3.16),
    Element(z: 18, symbol: "Ar", mass: 40, shells: [2, 8, 8], valence: 0, electronegativity: 0),
    Element(z: 19, symbol: "K", mass: 39, shells: [2, 8, 8, 1], valence: 1, electronegativity: 0.82),
    Element(z: 20, symbol: "Ca", mass: 40, shells: [2, 8, 8, 2], valence: 2, electronegativity: 1.00),
    Element(z: 21, symbol: "Sc", mass: 45, shells: [2, 8, 9, 2], valence: 3, electronegativity: 1.36),
    Element(z: 22, symbol: "Ti", mass: 48, shells: [2, 8, 10, 2], valence: 4, electronegativity: 1.54),
    Element(z: 23, symbol: "V", mass: 51, shells: [2, 8, 11, 2], valence: 5, electronegativity: 1.63),
    Element(z: 24, symbol: "Cr", mass: 52, shells: [2, 8, 13, 1], valence: 3, electronegativity: 1.66),
    Element(z: 25, symbol: "Mn", mass: 55, shells: [2, 8, 13, 2], valence: 2, electronegativity: 1.55),
    Element(z: 26, symbol: "Fe", mass: 56, shells: [2, 8, 14, 2], valence: 3, electronegativity: 1.83),
  ]

  public let scene: SceneID = .atoms
  public let materialKind = 3
  public let width = 144
  public let height = 144
  public let secondsPerTick: TimeInterval
  public private(set) var tick = 0
  public private(set) var representation = 0
  public var representationIndex: Int { representation }
  public private(set) var elapsedSeconds = 0.0
  public private(set) var energy = 0.0
  public let exposure = 1.0
  public private(set) var atoms: [Atom]
  public private(set) var bonds: [Bond] = []
  public private(set) var fusionEnergy = 0.0

  private var surface: [Float]
  private let seed: UInt64
  private let maximumAtoms = 8

  public init(seed: UInt64 = 0, secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    precondition(secondsPerTick > 0)
    self.seed = seed
    self.secondsPerTick = secondsPerTick
    surface = [Float](repeating: 0, count: width * height)
    var random = SplitMix64(seed: seed &+ 0xA70A_2026)
    atoms = []
    for index in 0 ..< 4 {
      let element = Self.elements[index % Self.elements.count]
      let angle = random.nextUnitDouble() * Double.pi * 2
      let radius = 0.16 + Double(index) * 0.16
      atoms.append(Atom(
        element: element,
        nucleons: element.mass,
        x: cos(angle) * radius,
        y: sin(angle) * radius,
        vx: -sin(angle) * 0.08,
        vy: cos(angle) * 0.08,
        excitation: 0.15 + random.nextUnitDouble() * 0.25
      ))
    }
    rebuildBonds()
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
      strikeNearest(x: point.x * 2 - 1, y: point.y * 2 - 1, intensity: intensity)
    case .grow:
      addAtom(x: point.x * 2 - 1, y: point.y * 2 - 1, intensity: intensity)
    case .ceremony:
      fuseNearest(intensity: intensity)
    case .tutti, .agitate, .wake:
      for index in atoms.indices { atoms[index].excitation = min(1, atoms[index].excitation + 0.18 * intensity) }
    case .gravity:
      for index in atoms.indices { atoms[index].vx *= 1 - 0.2 * intensity; atoms[index].vy *= 1 - 0.2 * intensity }
    case .stepBack:
      representation = max(0, representation - 1)
    case .lens:
      representation = (representation + 1) % 4
    case .train, .scale, .season, .pan, .weather, .timeDilation, .night, .breath:
      break
    }
    rebuildBonds()
    projectSurface()
    return output()
  }

  public func advance(ticks: Int) -> KernelOutput {
    guard ticks > 0 else { return output() }
    for _ in 0 ..< ticks { step() }
    return output()
  }

  private func step() {
    let dt = min(secondsPerTick, 1.0 / 60.0) * 0.5
    for index in atoms.indices {
      atoms[index].x += atoms[index].vx * dt
      atoms[index].y += atoms[index].vy * dt
      if abs(atoms[index].x) > 0.92 { atoms[index].vx *= -0.75 }
      if abs(atoms[index].y) > 0.92 { atoms[index].vy *= -0.75 }
      atoms[index].x = min(0.94, max(-0.94, atoms[index].x))
      atoms[index].y = min(0.94, max(-0.94, atoms[index].y))
      atoms[index].excitation *= 0.992
    }
    elapsedSeconds += secondsPerTick
    tick += 1
    rebuildBonds()
    projectSurface()
  }

  private func strikeNearest(x: Double, y: Double, intensity: Double) {
    guard !atoms.isEmpty else { return }
    var nearest = 0
    var distance = Double.greatestFiniteMagnitude
    for index in atoms.indices {
      let dx = atoms[index].x - x
      let dy = atoms[index].y - y
      let candidate = dx * dx + dy * dy
      if candidate < distance { distance = candidate; nearest = index }
    }
    atoms[nearest].excitation = min(1, atoms[nearest].excitation + 0.45 + 0.5 * intensity)
    atoms[nearest].vx += (x - atoms[nearest].x) * 0.06 * intensity
    atoms[nearest].vy += (y - atoms[nearest].y) * 0.06 * intensity
  }

  private func addAtom(x: Double, y: Double, intensity: Double) {
    guard atoms.count < maximumAtoms else {
      strikeNearest(x: x, y: y, intensity: intensity)
      return
    }
    let index = atoms.count
    let element = Self.elements[(index + Int(seed % UInt64(Self.elements.count))) % Self.elements.count]
    atoms.append(Atom(element: element, nucleons: element.mass, x: x, y: y, vx: 0.03 * intensity, vy: -0.02 * intensity, excitation: 0.25 + intensity * 0.5))
  }

  private func fuseNearest(intensity: Double) {
    guard atoms.count >= 2 else { addAtom(x: 0, y: 0, intensity: intensity); return }
    var first = 0
    var second = 1
    var best = Double.greatestFiniteMagnitude
    for i in atoms.indices {
      for j in (i + 1) ..< atoms.count {
        let dx = atoms[i].x - atoms[j].x
        let dy = atoms[i].y - atoms[j].y
        let candidate = dx * dx + dy * dy
        if candidate < best { best = candidate; first = i; second = j }
      }
    }
    let z = atoms[first].element.z + atoms[second].element.z
    guard z <= 26, let product = Self.elements.first(where: { $0.z == z }) else {
      atoms[first].excitation = min(1, atoms[first].excitation + 0.2 * intensity)
      return
    }
    let before = Double(atoms[first].nucleons) * Self.bindingEnergyPerNucleon(atoms[first].element.z)
      + Double(atoms[second].nucleons) * Self.bindingEnergyPerNucleon(atoms[second].element.z)
    // The curated element table stores representative isotope masses. Keep
    // the fusion ledger nucleon-conserving by carrying the reactant mass sum
    // through the product binding curve rather than silently swapping in the
    // product's rounded atomic weight.
    let conservedNucleons = atoms[first].nucleons + atoms[second].nucleons
    let after = Double(conservedNucleons) * Self.bindingEnergyPerNucleon(product.z)
    fusionEnergy += after - before
    let midpointX = (atoms[first].x + atoms[second].x) * 0.5
    let midpointY = (atoms[first].y + atoms[second].y) * 0.5
    atoms[first] = Atom(element: product, nucleons: conservedNucleons, x: midpointX, y: midpointY, vx: 0, vy: 0, excitation: min(1, 0.45 + max(0, fusionEnergy) * 0.08))
    atoms.remove(at: second)
  }

  private func rebuildBonds() {
    bonds = []
    for i in atoms.indices {
      for j in (i + 1) ..< atoms.count {
        guard let order = covalentOrder(atoms[i].element, atoms[j].element) else { continue }
        let dx = atoms[i].x - atoms[j].x
        let dy = atoms[i].y - atoms[j].y
        if dx * dx + dy * dy < 0.22 * 0.22 { bonds.append(Bond(first: i, second: j, order: order)) }
      }
    }
  }

  private func covalentOrder(_ first: Element, _ second: Element) -> Int? {
    guard first.valence > 0, second.valence > 0 else { return nil }
    let order = min(3, min(first.valence, second.valence))
    return order > 0 ? order : nil
  }

  /// MeV-flavored semi-empirical binding curve used by the instrument. It is
  /// intentionally the same bounded curve as the web atomic reference: a
  /// steep gain through helium, a shallow maximum near iron, and a declining
  /// return beyond the supported table.
  public static func bindingEnergyPerNucleon(_ z: Int) -> Double {
    let zi = z
    if zi <= 1 { return 0 }
    if zi <= 26 { return (8.8 * Double(zi - 1)) / (Double(zi) - 0.75) }
    let atIron = (8.8 * 25.0) / 25.25
    return atIron - 0.2 * Double(zi - 26)
  }

  private func projectSurface() {
    surface.withUnsafeMutableBufferPointer { output in
      for index in output.indices { output[index] = 0 }
      switch representation {
      case 0: projectOrbit(into: &output)
      case 1: projectPeriodic(into: &output)
      case 2: projectBonds(into: &output)
      case 3: projectFusion(into: &output)
      default: break
      }
    }
    energy = atoms.reduce(0) { $0 + $1.excitation } + max(0, fusionEnergy)
  }

  private func projectOrbit(into output: inout UnsafeMutableBufferPointer<Float>) {
    for atom in atoms {
      paint(atom.x, atom.y, radius: 4 + atom.excitation * 10, value: 0.28 + atom.excitation * 0.72, into: &output)
    }
  }

  private func projectPeriodic(into output: inout UnsafeMutableBufferPointer<Float>) {
    for atom in atoms {
      let column = (atom.element.z - 1) % 7
      let row = min(5, atom.element.shells.count - 1)
      let x = -0.82 + Double(column) * 0.27
      let y = -0.76 + Double(row) * 0.3
      paint(x, y, radius: 5 + atom.excitation * 5, value: 0.35 + atom.excitation * 0.65, into: &output)
    }
  }

  private func projectBonds(into output: inout UnsafeMutableBufferPointer<Float>) {
    for bond in bonds {
      let a = atoms[bond.first]
      let b = atoms[bond.second]
      for step in 0 ... 20 {
        let t = Double(step) / 20
        paint(a.x * (1 - t) + b.x * t, a.y * (1 - t) + b.y * t, radius: 2 + Double(bond.order), value: 0.35 + Double(bond.order) * 0.18, into: &output)
      }
    }
  }

  private func projectFusion(into output: inout UnsafeMutableBufferPointer<Float>) {
    let flash = min(1, max(0, fusionEnergy * 0.12) + atoms.reduce(0) { $0 + $1.excitation } * 0.05)
    paint(0, 0, radius: 12 + flash * 16, value: 0.25 + flash * 0.75, into: &output)
    for atom in atoms { paint(atom.x, atom.y, radius: 2 + atom.excitation * 4, value: atom.excitation, into: &output) }
  }

  private func paint(_ x: Double, _ y: Double, radius: Double, value: Double, into output: inout UnsafeMutableBufferPointer<Float>) {
    ScalarFieldPainter.gaussian(x: x, y: y, radius: radius, value: value, width: width, height: height, into: &output)
  }

  private func output() -> KernelOutput {
    .init(stable: energy.isFinite && fusionEnergy.isFinite, checkpoint: .init(scene: scene, tick: tick, digest: "atoms-v1-\(tick)-\(representation)-\(atoms.count)-\(fusionEnergy.bitPattern)"))
  }
}
