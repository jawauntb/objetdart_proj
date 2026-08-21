import Foundation

/// A compact reaction–diffusion colony for the first native cell proof.
///
/// A and B are concentrations, not sprites. The Gray–Scott update is bounded
/// to a fixed lattice and seeded from the universe seed, so the same command
/// trace produces the same colony on every device. The renderer receives B as
/// a scalar surface; identity and lineage can grow around this kernel later.
public final class CellKernel: SurfaceSimulationKernel {
  public let scene: SceneID = .cell
  public let materialKind = 1
  public let width = 128
  public let height = 128
  public let secondsPerTick: TimeInterval
  public private(set) var tick = 0
  public private(set) var representation = 0
  public var representationIndex: Int { representation }
  public private(set) var elapsedSeconds = 0.0
  public private(set) var energy = 0.0
  public let exposure = 1.0

  private let seed: UInt64
  private var a: [Float]
  private var b: [Float]
  private var nextA: [Float]
  private var nextB: [Float]
  private var surface: [Float]

  public init(seed: UInt64 = 0, secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    precondition(secondsPerTick > 0)
    self.seed = seed
    self.secondsPerTick = secondsPerTick
    let count = width * height
    a = [Float](repeating: 1, count: count)
    b = [Float](repeating: 0, count: count)
    nextA = [Float](repeating: 1, count: count)
    nextB = [Float](repeating: 0, count: count)
    surface = [Float](repeating: 0, count: count)
    seedColony()
  }

  public func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T {
    surface.withUnsafeBufferPointer { buffer in
      body(buffer.baseAddress!, width, height)
    }
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
    case .material, .grow, .ceremony, .tutti, .agitate, .wake, .stepBack, .lens: true
    case .train, .scale, .season, .pan, .weather, .timeDilation, .gravity, .night, .breath: false
    }
  }

  public func apply(_ command: SemanticCommand) -> KernelOutput {
    let intensity = min(max(command.intensity, 0), 1)
    let point = command.origin ?? .centre
    switch command.verb {
    case .material:
      inject(atX: point.x, y: point.y, amount: Float(0.18 + 0.55 * intensity))
    case .grow:
      inject(atX: point.x, y: point.y, amount: Float(0.35 + 0.45 * intensity))
    case .ceremony:
      inject(atX: 0.5, y: 0.5, amount: Float(0.7 + 0.3 * intensity))
      inject(atX: point.x, y: point.y, amount: Float(0.4 + 0.4 * intensity))
    case .tutti, .agitate, .wake:
      inject(atX: 0.25, y: 0.25, amount: Float(0.25 + 0.3 * intensity))
      inject(atX: 0.75, y: 0.25, amount: Float(0.25 + 0.3 * intensity))
      inject(atX: 0.5, y: 0.75, amount: Float(0.25 + 0.3 * intensity))
    case .stepBack:
      selectRepresentation(representation - 1)
    case .lens:
      selectRepresentation((representation + 1) % 4)
    case .train, .scale, .season, .pan, .weather, .timeDilation, .gravity, .night, .breath:
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
    let feed: Float = 0.036
    let kill: Float = 0.064
    let diffusionA: Float = 1.0
    let diffusionB: Float = 0.5
    var total = 0.0
    for y in 0 ..< height {
      for x in 0 ..< width {
        let i = y * width + x
        let left = y * width + max(0, x - 1)
        let right = y * width + min(width - 1, x + 1)
        let up = max(0, y - 1) * width + x
        let down = min(height - 1, y + 1) * width + x
        let lapA = a[left] + a[right] + a[up] + a[down] - 4 * a[i]
        let lapB = b[left] + b[right] + b[up] + b[down] - 4 * b[i]
        let reaction = a[i] * b[i] * b[i]
        let valueA = min(1, max(0, a[i] + (diffusionA * lapA - reaction + feed * (1 - a[i])) * 0.75))
        let valueB = min(1, max(0, b[i] + (diffusionB * lapB + reaction - (kill + feed) * b[i]) * 0.75))
        nextA[i] = valueA
        nextB[i] = valueB
        if representation == 0 { surface[i] = valueB }
        total += Double(valueB)
      }
    }
    swap(&a, &nextA)
    swap(&b, &nextB)
    elapsedSeconds += secondsPerTick
    tick += 1
    energy = total / Double(width * height)
    if representation != 0 { projectSurface() }
  }

  private func inject(atX x: Double, y: Double, amount: Float) {
    let cx = Int((min(max(x, 0), 1) * Double(width - 1)).rounded())
    let cy = Int((min(max(y, 0), 1) * Double(height - 1)).rounded())
    for dy in -4 ... 4 {
      for dx in -4 ... 4 {
        let px = cx + dx
        let py = cy + dy
        guard px > 0, px < width - 1, py > 0, py < height - 1 else { continue }
        let distance = Float(dx * dx + dy * dy).squareRoot() / 4
        guard distance <= 1 else { continue }
        b[py * width + px] = min(1, b[py * width + px] + amount * (1 - distance))
        a[py * width + px] = max(0, a[py * width + px] - amount * 0.35)
      }
    }
  }

  private func selectRepresentation(_ rawValue: Int) {
    representation = min(max(rawValue, 0), 3)
  }

  private func seedColony() {
    var random = SplitMix64(seed: seed &+ 0xC011_EC7A_2026)
    for _ in 0 ..< 8 {
      inject(atX: 0.15 + random.nextUnitDouble() * 0.7, y: 0.15 + random.nextUnitDouble() * 0.7, amount: 0.45)
    }
    projectSurface()
  }

  /// The colony remains the authority. These three additional readings are
  /// material projections for learning: no second genome or molecular solver
  /// is smuggled in behind the lens.
  private func projectSurface() {
    surface.withUnsafeMutableBufferPointer { output in
      switch representation {
      case 0:
        for index in output.indices { output[index] = b[index] }
      case 1:
        for index in output.indices {
          output[index] = min(1, abs(b[index] - a[index]) * 1.35 + b[index] * 0.22)
        }
      case 2:
        for y in 0 ..< height {
          let ny = Float(y) / Float(max(1, height - 1))
          let phase = ny * Float.pi * 10 + Float(elapsedSeconds * 0.55)
          let offset = 0.18 * sin(phase)
          for x in 0 ..< width {
            let nx = Float(x) / Float(max(1, width - 1))
            let strandA = max(0, 1 - abs(nx - (0.5 + offset)) * 34)
            let strandB = max(0, 1 - abs(nx - (0.5 - offset)) * 34)
            let rung = max(0, 1 - abs(nx - 0.5) * 22) * (0.25 + 0.75 * abs(sin(phase)))
            let expression = b[y * width + x] * 0.35
            output[y * width + x] = min(1, expression + max(strandA, strandB) * 0.72 + rung * 0.22)
          }
        }
      case 3:
        for y in 0 ..< height {
          let ny = Float(y) / Float(max(1, height - 1))
          for x in 0 ..< width {
            let nx = Float(x) / Float(max(1, width - 1))
            let fold = abs(sin(nx * 11 + ny * 7 + Float(elapsedSeconds * 0.18)))
            let pocket = max(0, 1 - abs(fold - 0.62) * 5)
            let local = b[y * width + x]
            output[y * width + x] = min(1, local * 0.42 + pocket * 0.58)
          }
        }
      default:
        break
      }
    }
  }

  private func output() -> KernelOutput {
    .init(stable: energy.isFinite, checkpoint: .init(scene: scene, tick: tick, digest: "cell-v2-\(tick)-\(representation)-\(energy.bitPattern)"))
  }
}
