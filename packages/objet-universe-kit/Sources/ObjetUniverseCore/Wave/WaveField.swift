import Foundation

/// The bounded wave medium the first native screen shows.
///
/// This is the Swift half of `src/lib/waves.ts`: one centred finite-difference
/// update of `u_tt = c²∇²u` with fixed edges, cell for cell and rounding for
/// rounding, so `scripts/native/fixtures/wave-reference.json` constrains both
/// languages. `WaveFieldTests` steps the committed fixture through this type
/// and refuses any drift.
///
/// Everything here is a deterministic function of `(seed, parameters, tick)`.
/// There is no clock read, no entropy, and no allocation in the step path —
/// the three field buffers and the swell footprints are taken once at
/// capacity, and the buffers rotate by pointer.
///
/// Three things are declared rather than implied:
///
///  - **Lattice units.** `dx` is one cell and `dt` is one authoritative step,
///    so `cSquared` is already the squared Courant number. Stability needs
///    `cSquared <= 0.5` in 2D; `WaveField.stableCSquared` sits under it.
///  - **The drive is a stated source term, not a hidden hand.** A damped tank
///    with no source decays to a flat black screen within minutes, and the
///    first screen must be alive at rest. `ambientDrive` breathes a handful of
///    seeded swells into the medium — broad discs, not single cells, so what
///    they raise is water rather than grid noise. Set it to zero and the field
///    is the pure conservative integrator the reference fixture pins.
///  - **The display range is fixed, not auto-gained.** Amplitude reaches the
///    renderer divided by `displayReferenceAmplitude` and nothing else, so a
///    wave a visitor makes is brighter than the resting sea instead of being
///    normalised back down to it.
public final class WaveField {
  /// One seeded standing swell. Position, rate, and phase all come from the
  /// universe seed, so the resting sea of one universe is not the resting sea
  /// of another, and the same seed always returns the same sea.
  public struct Source: Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let radiansPerSecond: Double
    public let phase: Double
    public let weight: Double
  }

  private struct SwellCell {
    let index: Int
    let weight: Float
    let source: Int
  }

  /// The Courant number the release runs at. Under the 2D stability limit of
  /// 0.5, with room left for the source term.
  public static let stableCSquared: Double = 0.25
  /// Per-step amplitude retention. Over 120 steps a second this is a ~26 s
  /// decay constant: a ripple outlives the hand that made it without the tank
  /// ringing forever.
  public static let restingDamping: Double = 0.9997
  /// Amplitude a swell adds per step at its centre. Measured against
  /// `restingDamping`, this holds the resting sea between roughly 0.13 and 1.0
  /// indefinitely — never flat, never clipped.
  public static let restingDrive: Double = 1.0e-3
  /// A swell spans about a twelfth of the tank. Narrower and the medium is
  /// driven at frequencies the grid cannot carry; wider and the whole tank
  /// heaves as one.
  public static let swellRadiusDivisor = 12
  /// The site-wide breath, shared with `MOTION.breathMs` in the native tokens.
  public static let breathSeconds: Double = 7
  /// Grid the release renders. Fixed on purpose: the physics must not change
  /// when the screen does.
  public static let releaseWidth = 160
  public static let releaseHeight = 160
  /// The amplitude the renderer treats as the top of its range. Chosen from
  /// the measured resting band so the sea reads as sea and a decisive crest
  /// still has somewhere to go.
  public static let displayReferenceAmplitude: Double = 0.9
  private static let sourceCount = 4

  public let width: Int
  public let height: Int
  public let cSquared: Double
  public let damping: Double
  public let ambientDrive: Double
  public let seed: UInt64
  public let sources: [Source]

  /// Authoritative time, accumulated from steps alone — never from a clock.
  public private(set) var elapsedSeconds: Double = 0
  /// Discrete lattice energy after the last step: `½Σ(uⁿ⁺¹-uⁿ)² + ½c²Σ(∇uⁿ⁺¹)²`.
  /// Leapfrog conserves a nearby staggered quantity exactly, so this one
  /// oscillates slightly and stays *bounded* — which is the invariant the wave
  /// scene manifest actually declares.
  public private(set) var energy: Double = 0

  private let count: Int
  private let swellCells: [SwellCell]
  private var swellAmplitudes: [Double]
  private var previous: UnsafeMutablePointer<Float>
  private var current: UnsafeMutablePointer<Float>
  private var next: UnsafeMutablePointer<Float>

  public init(
    width: Int = WaveField.releaseWidth,
    height: Int = WaveField.releaseHeight,
    cSquared: Double = WaveField.stableCSquared,
    damping: Double = WaveField.restingDamping,
    ambientDrive: Double = WaveField.restingDrive,
    seed: UInt64 = 0
  ) {
    precondition(width >= 3 && height >= 3, "a wave tank needs an interior")
    self.width = width
    self.height = height
    self.cSquared = cSquared
    self.damping = damping
    self.ambientDrive = ambientDrive
    self.seed = seed
    count = width * height
    previous = .allocate(capacity: count)
    current = .allocate(capacity: count)
    next = .allocate(capacity: count)
    previous.initialize(repeating: 0, count: count)
    current.initialize(repeating: 0, count: count)
    next.initialize(repeating: 0, count: count)

    let driven = ambientDrive > 0
    let seeded = driven ? WaveField.seededSources(width: width, height: height, seed: seed) : []
    sources = seeded
    swellAmplitudes = [Double](repeating: 0, count: seeded.count)
    swellCells = driven
      ? WaveField.makeSwellCells(
          for: seeded,
          width: width,
          height: height,
          radius: max(2, min(width, height) / WaveField.swellRadiusDivisor)
        )
      : []
    if driven { seedRestingSwell() }
  }

  deinit {
    previous.deinitialize(count: count)
    current.deinitialize(count: count)
    next.deinitialize(count: count)
    previous.deallocate()
    current.deallocate()
    next.deallocate()
  }

  /// What the renderer multiplies amplitude by. A declared constant, not a
  /// running gain: the material must brighten when the medium does.
  public var exposure: Double { 1 / WaveField.displayReferenceAmplitude }

  /// Read the authoritative surface without copying it. The pointer is valid
  /// only for the duration of `body` — the renderer uploads from it directly,
  /// which is what keeps the frame path allocation-free.
  public func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T {
    body(UnsafePointer(current), width, height)
  }

  /// Displace the medium at a normalised position. This is the whole physical
  /// intervention surface: a hand raises the surface, and the integrator does
  /// the rest. The bump is a cosine cap rather than a single cell so the grid
  /// does not ring at its own Nyquist frequency — except at radius zero, which
  /// raises exactly one cell and is what the committed fixture is written
  /// against.
  public func displace(atX nx: Double, y ny: Double, amplitude: Double, radiusCells: Int = 4) {
    guard amplitude.isFinite, nx.isFinite, ny.isFinite else { return }
    let cx = Int((min(max(nx, 0), 1) * Double(width - 1)).rounded())
    let cy = Int((min(max(ny, 0), 1) * Double(height - 1)).rounded())
    for cell in WaveField.discCells(centreX: cx, centreY: cy, radius: max(0, radiusCells), width: width, height: height) {
      current[cell.index] += Float(amplitude * Double(cell.weight))
    }
  }

  /// One authoritative step. `secondsPerStep` advances the declared clock the
  /// swells read; it never rescales the integrator, which works in lattice
  /// units by construction.
  public func step(secondsPerStep: Double) {
    let w = width
    let h = height
    var kinetic = 0.0
    var gradient = 0.0

    // Fixed edges: the medium is a bounded tank, exactly as the web law states.
    for x in 0 ..< w {
      next[x] = 0
      next[(h - 1) * w + x] = 0
    }
    for y in 1 ..< (h - 1) {
      let row = y * w
      next[row] = 0
      next[row + w - 1] = 0
      for x in 1 ..< (w - 1) {
        let i = row + x
        let centre = Double(current[i])
        let laplacian = Double(current[i - 1]) + Double(current[i + 1])
          + Double(current[i - w]) + Double(current[i + w]) - 4 * centre
        let value = Float((2 * centre - Double(previous[i]) + cSquared * laplacian) * damping)
        next[i] = value

        // Fold the exact discrete-energy ledger into the stencil while this
        // row is hot. Every lattice edge is counted once: left/up here, then
        // the fixed right and bottom walls below. This is the same quantity
        // as a second full-field scan, without rereading all three buffers.
        let nextValue = Double(value)
        let velocity = nextValue - centre
        kinetic += velocity * velocity
        let leftSlope = nextValue - Double(next[i - 1])
        let upperSlope = nextValue - Double(next[i - w])
        gradient += leftSlope * leftSlope + upperSlope * upperSlope
      }
      let rightSlope = Double(next[row + w - 2])
      gradient += rightSlope * rightSlope
    }

    let bottomInterior = (h - 2) * w
    for x in 1 ..< (w - 1) {
      let bottomSlope = Double(next[bottomInterior + x])
      gradient += bottomSlope * bottomSlope
    }

    elapsedSeconds += secondsPerStep
    if ambientDrive > 0 {
      let breath = 0.55 + 0.45 * sin(2 * Double.pi * elapsedSeconds / WaveField.breathSeconds)
      for (index, source) in sources.enumerated() {
        swellAmplitudes[index] = ambientDrive * source.weight * breath
          * sin(source.radiansPerSecond * elapsedSeconds + source.phase)
      }
      for cell in swellCells {
        let index = cell.index
        let oldValue = Double(next[index])
        let drivenValue = next[index] + Float(swellAmplitudes[cell.source] * Double(cell.weight))
        let newValue = Double(drivenValue)

        let oldVelocity = oldValue - Double(current[index])
        let newVelocity = newValue - Double(current[index])
        kinetic += newVelocity * newVelocity - oldVelocity * oldVelocity

        // The source changes the four edges incident to this cell. Correct
        // their already-counted contributions in place; overlapping swells
        // remain exact because each addition observes the last written value.
        let leftValue = Double(next[index - 1])
        let oldLeftSlope = oldValue - leftValue
        let newLeftSlope = newValue - leftValue
        gradient += newLeftSlope * newLeftSlope - oldLeftSlope * oldLeftSlope

        let rightValue = Double(next[index + 1])
        let oldRightSlope = oldValue - rightValue
        let newRightSlope = newValue - rightValue
        gradient += newRightSlope * newRightSlope - oldRightSlope * oldRightSlope

        let upperValue = Double(next[index - w])
        let oldUpperSlope = oldValue - upperValue
        let newUpperSlope = newValue - upperValue
        gradient += newUpperSlope * newUpperSlope - oldUpperSlope * oldUpperSlope

        let lowerValue = Double(next[index + w])
        let oldLowerSlope = oldValue - lowerValue
        let newLowerSlope = newValue - lowerValue
        gradient += newLowerSlope * newLowerSlope - oldLowerSlope * oldLowerSlope
        next[index] = drivenValue
      }
    }

    energy = 0.5 * kinetic + 0.5 * cSquared * gradient

    let stale = previous
    previous = current
    current = next
    next = stale
  }

  /// A resting sea is not an empty one: the seed writes a few broad swells so
  /// the first frame already carries structure, before any source has rung.
  private func seedRestingSwell() {
    var random = SplitMix64(seed: seed &+ 0x517C_C1B7_2722_0A95)
    for _ in 0 ..< WaveField.sourceCount {
      displace(
        atX: 0.18 + 0.64 * random.nextUnitDouble(),
        y: 0.18 + 0.64 * random.nextUnitDouble(),
        amplitude: 0.22 + 0.5 * random.nextUnitDouble(),
        radiusCells: max(4, min(width, height) / 9)
      )
    }
    // Released from rest rather than struck: with `previous` equal to
    // `current` the swells split symmetrically instead of inheriting a
    // one-step velocity nobody asked for.
    previous.update(from: current, count: count)
  }

  private static func discCells(
    centreX: Int,
    centreY: Int,
    radius: Int,
    width: Int,
    height: Int
  ) -> [(index: Int, weight: Float)] {
    var cells: [(index: Int, weight: Float)] = []
    let radiusSquared = Double(radius * radius)
    for dy in -radius ... radius {
      let y = centreY + dy
      guard y > 0, y < height - 1 else { continue }
      for dx in -radius ... radius {
        let x = centreX + dx
        guard x > 0, x < width - 1 else { continue }
        let distanceSquared = Double(dx * dx + dy * dy)
        guard distanceSquared <= radiusSquared else { continue }
        let reach = radiusSquared > 0 ? (distanceSquared / radiusSquared).squareRoot() : 0
        cells.append((index: y * width + x, weight: Float(0.5 + 0.5 * cos(Double.pi * reach))))
      }
    }
    return cells
  }

  private static func makeSwellCells(
    for sources: [Source],
    width: Int,
    height: Int,
    radius: Int
  ) -> [SwellCell] {
    var cells: [SwellCell] = []
    for (index, source) in sources.enumerated() {
      for cell in discCells(centreX: source.x, centreY: source.y, radius: radius, width: width, height: height) {
        cells.append(SwellCell(index: cell.index, weight: cell.weight, source: index))
      }
    }
    return cells
  }

  private static func seededSources(width: Int, height: Int, seed: UInt64) -> [Source] {
    var random = SplitMix64(seed: seed)
    var sources: [Source] = []
    sources.reserveCapacity(sourceCount)
    for _ in 0 ..< sourceCount {
      // 0.8–2.4 Hz over a 160-cell tank is a 25–75 cell wavelength: ripples a
      // hand can count, not a shimmer and not a single slow heave.
      let hertz = 0.8 + 1.6 * random.nextUnitDouble()
      sources.append(
        Source(
          x: max(1, min(width - 2, Int((0.15 + 0.7 * random.nextUnitDouble()) * Double(width - 1)))),
          y: max(1, min(height - 2, Int((0.15 + 0.7 * random.nextUnitDouble()) * Double(height - 1)))),
          radiansPerSecond: 2 * Double.pi * hertz,
          phase: 2 * Double.pi * random.nextUnitDouble(),
          weight: 0.6 + 0.4 * random.nextUnitDouble()
        )
      )
    }
    return sources
  }
}

/// The one seeded generator the native side uses. Named so a reviewer can see
/// at a glance that nothing here reaches for system entropy.
public struct SplitMix64 {
  private var state: UInt64

  public init(seed: UInt64) { state = seed }

  public mutating func next() -> UInt64 {
    state = state &+ 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }

  /// A double in `[0, 1)` built from the top 53 bits, so the mantissa is used
  /// exactly once and the value is reproducible across architectures.
  public mutating func nextUnitDouble() -> Double {
    Double(next() >> 11) * (1.0 / 9_007_199_254_740_992.0)
  }
}
