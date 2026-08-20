import Foundation

/// The wave scene's authoritative kernel.
///
/// It owns one `WaveField`, turns semantic commands into displacements of that
/// medium, and reports a checkpoint whose digest is a function of the physics
/// rather than of the tick counter. Renderers read the surface through
/// `withSurface`; nothing outside this type may write to it.
///
/// The kernel is deliberately thin. The medium's laws live in `WaveField`
/// beside the fixture that pins them, and the presentation lives in the render
/// target — this file is only the boundary the host talks to.
public final class WaveKernel: SimulationKernel {
  public let scene: SceneID = .wave
  public private(set) var tick = 0

  /// Seconds of authoritative time per tick. Defaults to the one clock's step
  /// so the sources and the integrator cannot disagree about how long a tick
  /// lasted; `UniverseClock.defaultStepSeconds` is the single source.
  public let secondsPerTick: TimeInterval
  private let field: WaveField

  public init(
    seed: UInt64 = 0,
    secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds,
    field: WaveField? = nil
  ) {
    precondition(secondsPerTick > 0)
    self.secondsPerTick = secondsPerTick
    self.field = field ?? WaveField(seed: seed)
  }

  /// Authoritative time the medium has lived, in seconds. The renderer reads
  /// it so the surface's slow light is drawn from the same clock as its waves.
  public var elapsedSeconds: Double { field.elapsedSeconds }

  /// What the renderer multiplies amplitude by before shading it. A declared
  /// constant of the medium, never a running gain — see `WaveField.exposure`.
  public var exposure: Double { field.exposure }

  public var energy: Double { field.energy }

  public func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T {
    field.withSurface(body)
  }

  public func prepare() {}
  public func activate() {}
  public func freeze() {}
  public func retire() {}

  /// Verbs the medium can answer today. A wave tank has no seasons and no
  /// weather, so those verbs land as no-ops here rather than as invented
  /// physics; the layers that own them arrive with the U9 gesture lane, which
  /// also brings the position a `material` touch should carry. Until then a
  /// material touch rings the middle of the tank, and its intensity is the
  /// amplitude — never a switch.
  public func apply(_ command: SemanticCommand) -> KernelOutput {
    let intensity = min(max(command.intensity, 0), 1)
    switch command.verb {
    case .material:
      field.displace(atX: 0.5, y: 0.5, amplitude: 0.25 + 0.75 * intensity)
    case .tutti, .agitate:
      for source in field.sources {
        field.displace(
          atX: Double(source.x) / Double(max(1, field.width - 1)),
          y: Double(source.y) / Double(max(1, field.height - 1)),
          amplitude: (0.2 + 0.6 * intensity) * source.weight
        )
      }
    default:
      break
    }
    return output()
  }

  public func advance(ticks: Int) -> KernelOutput {
    guard ticks > 0 else { return output() }
    for _ in 0 ..< ticks {
      field.step(secondsPerStep: secondsPerTick)
      tick += 1
    }
    return output()
  }

  private func output() -> KernelOutput {
    // Stability is the medium's own report: a Courant violation reaches
    // infinity within a few dozen steps, and the host quarantines the frame
    // instead of promoting a checkpoint nobody can replay.
    .init(
      stable: field.energy.isFinite,
      checkpoint: .init(scene: scene, tick: tick, digest: digest())
    )
  }

  /// The digest covers the tick, the seed, and the field's energy — the scalar
  /// invariant a divergent replay cannot match. It is a determinism check, not
  /// a sync hash: two devices that disagree here have disagreed about physics.
  private func digest() -> String {
    var hash: UInt64 = 0xCBF2_9CE4_8422_2325
    func mix(_ value: UInt64) {
      var remaining = value
      for _ in 0 ..< 8 {
        hash = (hash ^ (remaining & 0xFF)) &* 0x0000_0100_0000_01B3
        remaining >>= 8
      }
    }
    mix(UInt64(bitPattern: Int64(tick)))
    mix(field.seed)
    mix(field.energy.bitPattern)
    return "wave-v1-" + String(hash, radix: 16)
  }
}
