import Foundation

/// A deterministic orbital nursery with four scale-manifold projections.
///
/// Bodies advance with a bounded symplectic Euler step. The Metal material is
/// a density projection of the same bodies, so a changed orbit is visible
/// without making particles the authority.
public final class SolarKernel: SurfaceSimulationKernel {
  private struct PlanetSample {
    let radius: Double
    let landPhase: Double
    let cloudPhase: Double
    let atmosphere: Double
  }

  public struct Body: Sendable {
    var x: Double
    var y: Double
    var vx: Double
    var vy: Double
    var mass: Double
  }

  public let scene: SceneID = .solar
  public let materialKind = 2
  public let width = 160
  public let height = 160
  public let secondsPerTick: TimeInterval
  public private(set) var tick = 0
  public private(set) var representation = 0
  public var representationIndex: Int { representation }
  public private(set) var elapsedSeconds = 0.0
  public private(set) var energy = 0.0
  public let exposure = 1.0
  public private(set) var bodies: [Body]

  private var surface: [Float]
  private var galaxyBase: [Float] = []
  private var planetSamples: [PlanetSample] = []
  private let seed: UInt64
  private let maximumBodyCount = 48
  private let maximumCentralMass = 4.0
  private let maximumPaintRadius = 28.0

  public init(seed: UInt64 = 0, secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    precondition(secondsPerTick > 0)
    self.seed = seed
    self.secondsPerTick = secondsPerTick
    surface = [Float](repeating: 0, count: width * height)
    galaxyBase = Self.makeGalaxyBase(seed: seed, width: width, height: height)
    var random = SplitMix64(seed: seed &+ 0x50_1A_2026)
    bodies = [Body(x: 0, y: 0, vx: 0, vy: 0, mass: 1)]
    for index in 0 ..< 12 {
      let radius = 0.18 + Double(index) * 0.075
      let angle = random.nextUnitDouble() * Double.pi * 2
      let mass = 0.006 + random.nextUnitDouble() * 0.018
      let speed = (1 / max(radius, 0.1)).squareRoot()
      bodies.append(Body(x: cos(angle) * radius, y: sin(angle) * radius, vx: -sin(angle) * speed, vy: cos(angle) * speed, mass: mass))
    }
    planetSamples = Self.makePlanetSamples(seed: seed, width: width, height: height)
    projectSurface()
  }

  public func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T {
    surface.withUnsafeBufferPointer { buffer in body(buffer.baseAddress!, width, height) }
  }

  public func setRepresentation(_ rawValue: Int) {
    selectRepresentation(rawValue)
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
      adjustNearest(toX: point.x * 2 - 1, y: point.y * 2 - 1, impulse: 0.02 + 0.1 * intensity)
    case .grow:
      bodies[0].mass = min(maximumCentralMass, bodies[0].mass + 0.005 + 0.02 * intensity)
    case .ceremony:
      if bodies.count >= maximumBodyCount {
        var leastMassIndex = 1
        for index in 2 ..< bodies.count where bodies[index].mass < bodies[leastMassIndex].mass {
          leastMassIndex = index
        }
        bodies.remove(at: leastMassIndex)
      }
      bodies.append(Body(x: 0.02, y: 0, vx: 0, vy: 1.3, mass: 0.01 + 0.02 * intensity))
    case .tutti, .agitate, .wake:
      for index in bodies.indices where index > 0 { bodies[index].vy += 0.03 * intensity }
    case .gravity:
      for index in bodies.indices where index > 0 { bodies[index].vx *= 1 - 0.05 * intensity }
    case .stepBack:
      selectRepresentation(representation - 1)
    case .lens:
      selectRepresentation((representation + 1) % 4)
    case .train, .scale, .season, .pan, .weather, .timeDilation, .night, .breath:
      break
    }
    projectSurface()
    return output()
  }

  public func advance(ticks: Int) -> KernelOutput {
    guard ticks > 0 else { return output() }
    for _ in 0 ..< ticks {
      integrate()
      projectSurface()
      tick += 1
      elapsedSeconds += secondsPerTick
    }
    return output()
  }

  private func integrate() {
    let dt = min(secondsPerTick, 1.0 / 60.0) * 0.45
    let gravity = 0.12
    var accelerations = [(Double, Double)](repeating: (0, 0), count: bodies.count)
    for i in bodies.indices {
      for j in bodies.indices where i != j {
        let dx = bodies[j].x - bodies[i].x
        let dy = bodies[j].y - bodies[i].y
        let distanceSquared = max(0.0025, dx * dx + dy * dy)
        let scale = gravity * bodies[j].mass / pow(distanceSquared, 1.5)
        accelerations[i].0 += dx * scale
        accelerations[i].1 += dy * scale
      }
    }
    for index in bodies.indices {
      bodies[index].vx += accelerations[index].0 * dt
      bodies[index].vy += accelerations[index].1 * dt
      bodies[index].x += bodies[index].vx * dt
      bodies[index].y += bodies[index].vy * dt
      let radius = (bodies[index].x * bodies[index].x + bodies[index].y * bodies[index].y).squareRoot()
      if radius > 1.6 {
        bodies[index].x *= 0.72
        bodies[index].y *= 0.72
        bodies[index].vx *= -0.55
        bodies[index].vy *= -0.55
      }
    }
  }

  private func adjustNearest(toX x: Double, y: Double, impulse: Double) {
    guard bodies.count > 1 else { return }
    var nearest = 1
    var nearestDistance = Double.greatestFiniteMagnitude
    for index in 1 ..< bodies.count {
      let dx = bodies[index].x - x
      let dy = bodies[index].y - y
      let distance = dx * dx + dy * dy
      if distance < nearestDistance { nearestDistance = distance; nearest = index }
    }
    bodies[nearest].vx += impulse
    bodies[nearest].vy += impulse * 0.5
  }

  private func selectRepresentation(_ rawValue: Int) {
    representation = min(max(rawValue, 0), 3)
  }

  private func projectSurface() {
    surface.withUnsafeMutableBufferPointer { buffer in
      for index in 0 ..< buffer.count { buffer[index] = 0 }
      switch representation {
      case 0:
        projectGalaxy(into: &buffer)
      case 1:
        projectBodies(into: &buffer)
      case 2:
        projectPlanet(into: &buffer, earth: false)
      case 3:
        projectPlanet(into: &buffer, earth: true)
      default:
        break
      }
    }
    energy = bodies.reduce(0) { $0 + 0.5 * $1.mass * ($1.vx * $1.vx + $1.vy * $1.vy) }
  }

  private func projectGalaxy(into buffer: inout UnsafeMutableBufferPointer<Float>) {
    for index in buffer.indices { buffer[index] = galaxyBase[index] }
    // The currently inhabited nursery leaves a few bright, causal anchors in
    // the larger field so returning from the galaxy never loses the system.
    for body in bodies {
      paint(body: body, into: &buffer, scale: 0.62)
    }
  }

  private static func makeGalaxyBase(seed: UInt64, width: Int, height: Int) -> [Float] {
    let seedPhase = Double(seed % 10_000) / 10_000
    var base = [Float](repeating: 0, count: width * height)
    for y in 0 ..< height {
      for x in 0 ..< width {
        let nx = (Double(x) / Double(width - 1) - 0.5) * 2
        let ny = (Double(y) / Double(height - 1) - 0.5) * 2
        let radius = (nx * nx + ny * ny).squareRoot()
        let angle = atan2(ny, nx)
        let arm = exp(-abs(sin(angle * 3 + radius * 6.2 + seedPhase * Double.pi * 2)) * 11)
        let core = exp(-radius * radius * 6)
        let dust = max(0, 1 - radius / 1.15) * arm
        base[y * width + x] = Float(min(1, core * 0.95 + dust * 0.72))
      }
    }
    return base
  }

  private static func makePlanetSamples(seed: UInt64, width: Int, height: Int) -> [PlanetSample] {
    let seedPhase = Double(seed % 997) / 997
    var samples = [PlanetSample]()
    samples.reserveCapacity(width * height)
    for y in 0 ..< height {
      for x in 0 ..< width {
        let nx = (Double(x) / Double(width - 1) - 0.5) * 2
        let ny = (Double(y) / Double(height - 1) - 0.5) * 2
        let radius = (nx * nx + ny * ny).squareRoot()
        let longitude = atan2(ny, nx) + seedPhase * Double.pi * 2
        let latitude = (1 - radius / 0.86) * Double.pi
        let atmosphere = max(0, 1 - abs(radius - 0.78) / 0.1) * 0.25
        samples.append(PlanetSample(
          radius: radius,
          landPhase: longitude * 3 + sin(latitude * 4) * 2.4,
          cloudPhase: longitude * 9 - latitude * 7,
          atmosphere: atmosphere
        ))
      }
    }
    return samples
  }

  private func projectBodies(into buffer: inout UnsafeMutableBufferPointer<Float>) {
    for body in bodies { paint(body: body, into: &buffer, scale: 1) }
  }

  private func paint(body: Body, into buffer: inout UnsafeMutableBufferPointer<Float>, scale: Double) {
    let px = (body.x / 3 + 0.5) * Double(width - 1)
    let py = (body.y / 3 + 0.5) * Double(height - 1)
    let radius = min(maximumPaintRadius, max(1.5, (2.0 + body.mass * 30) * scale))
    let minX = max(1, Int(px - radius))
    let maxX = min(width - 2, Int(px + radius))
    let minY = max(1, Int(py - radius))
    let maxY = min(height - 2, Int(py + radius))
    guard minX <= maxX, minY <= maxY else { return }
    for y in minY ... maxY {
      for x in minX ... maxX {
        let dx = Double(x) - px
        let dy = Double(y) - py
        let falloff = exp(-(dx * dx + dy * dy) / max(1, radius * radius))
        buffer[y * width + x] = min(1, buffer[y * width + x] + Float(body.mass * 18 * falloff))
      }
    }
  }

  private func projectPlanet(into buffer: inout UnsafeMutableBufferPointer<Float>, earth: Bool) {
    let selectedMass = bodies.count > 1 ? bodies[1].mass : 0.01
    for index in buffer.indices {
      let sample = planetSamples[index]
      guard sample.radius <= 0.86 else { continue }
      let land = 0.5 + 0.5 * sin(sample.landPhase + selectedMass * 80)
      let cloud = 0.5 + 0.5 * sin(sample.cloudPhase + elapsedSeconds * 0.025)
      let ocean = earth ? (0.28 + land * 0.18) : (0.2 + land * 0.5)
      let atmosphere = earth ? sample.atmosphere : 0
      buffer[index] = Float(min(1, ocean + max(0, land - 0.58) * 0.35 + cloud * 0.08 + atmosphere))
    }
  }

  private func output() -> KernelOutput {
    .init(stable: energy.isFinite, checkpoint: .init(scene: scene, tick: tick, digest: "solar-v2-\(tick)-\(representation)-\(energy.bitPattern)"))
  }
}
