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

  /// Verbs the medium says in its own material.
  ///
  /// A wave tank has no seasons and no weather; those verbs reach this kernel
  /// and change nothing, and the input layer answers them in the hand and the
  /// ear instead of inventing physics for them. Declaring the vocabulary here
  /// is what lets it: `expresses` is asked before a command is committed, and
  /// it is also what tells the guide which phenomena the visitor has actually
  /// caused.
  public func expresses(_ verb: SemanticVerb) -> Bool {
    switch verb {
    case .material, .grow, .ceremony, .tutti, .agitate, .wake: true
    case .stepBack, .train, .scale, .lens, .season, .pan, .weather,
         .timeDilation, .gravity, .night, .breath: false
    }
  }

  /// Every intervention is one displacement of the medium: where the hand
  /// was, how much it brought, how wide it landed. Nothing here is a switch —
  /// amplitude and radius are continuous in `intensity`, so a hold that keeps
  /// deepening keeps arriving, and a harder strike spreads further than a
  /// gentle one.
  ///
  /// A command with no origin was not placed by a hand — a knock on the
  /// vessel, an assistive activation — and rings the middle of the tank.
  public func apply(_ command: SemanticCommand) -> KernelOutput {
    let intensity = min(max(command.intensity, 0), 1)
    let point = command.origin ?? .centre
    switch command.verb {
    case .material:
      // A strike: the amplitude is the hand's, and a decisive one reaches the
      // display's declared top so it burns rather than merely brightening.
      field.displace(
        atX: point.x,
        y: point.y,
        amplitude: 0.25 + 0.75 * intensity,
        radiusCells: WaveKernel.radiusCells(base: 3, intensity: intensity, spread: 5)
      )
    case .grow:
      // A dwell arrives many times while the finger stays down, so each
      // arrival is small and the *charge* is the sum: the source under the
      // fingertip radiates harder the longer it is held.
      field.displace(
        atX: point.x,
        y: point.y,
        amplitude: 0.05 + 0.35 * intensity,
        radiusCells: WaveKernel.radiusCells(base: 2, intensity: intensity, spread: 6)
      )
    case .ceremony:
      // The tank's one decisive act: the seeded sea and the held point ring
      // together, in phase, at the top of the medium's declared range.
      for source in field.sources {
        field.displace(
          atX: Double(source.x) / Double(max(1, field.width - 1)),
          y: Double(source.y) / Double(max(1, field.height - 1)),
          amplitude: (0.3 + 0.5 * intensity) * source.weight,
          radiusCells: WaveKernel.radiusCells(base: 5, intensity: intensity, spread: 6)
        )
      }
      field.displace(
        atX: point.x,
        y: point.y,
        amplitude: 0.5 + 0.5 * intensity,
        radiusCells: WaveKernel.radiusCells(base: 6, intensity: intensity, spread: 8)
      )
    case .tutti, .agitate:
      for source in field.sources {
        field.displace(
          atX: Double(source.x) / Double(max(1, field.width - 1)),
          y: Double(source.y) / Double(max(1, field.height - 1)),
          amplitude: (0.2 + 0.6 * intensity) * source.weight
        )
      }
    case .wake:
      // A knock is on the vessel, not on the water: the whole tank moves as
      // one broad swell rather than as four separate sources.
      field.displace(
        atX: point.x,
        y: point.y,
        amplitude: 0.15 + 0.45 * intensity,
        radiusCells: WaveKernel.radiusCells(base: min(field.width, field.height) / 8, intensity: intensity, spread: 6)
      )
    case .stepBack, .train, .scale, .lens, .season, .pan, .weather,
         .timeDilation, .gravity, .night, .breath:
      break
    }
    return output()
  }

  /// Footprint of an intervention. Continuous in intensity and bounded well
  /// under the tank's own swell radius, so a strike stays a strike and never
  /// heaves the whole medium at once.
  private static func radiusCells(base: Int, intensity: Double, spread: Int) -> Int {
    max(1, base + Int((Double(spread) * min(max(intensity, 0), 1)).rounded()))
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
