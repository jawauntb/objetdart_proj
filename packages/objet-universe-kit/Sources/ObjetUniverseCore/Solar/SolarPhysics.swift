import Foundation
import simd

public enum SolarBodyFate: String, Equatable, Codable, Sendable {
  case bound
  case escaped
  case consumed
}

public struct SolarBodyState: Equatable, Sendable {
  public var id: UInt64
  public var seed: UInt32
  public var kind: SolarBodyKind
  public var previousPosition: SIMD2<Double>
  public var position: SIMD2<Double>
  public var velocity: SIMD2<Double>
  public var mass: Double
  public var inclination: Double
  public var size: Double

  public init(
    id: UInt64,
    seed: UInt32,
    kind: SolarBodyKind,
    position: SIMD2<Double>,
    velocity: SIMD2<Double>,
    mass: Double,
    inclination: Double = 0,
    size: Double = 0.5
  ) {
    self.id = id
    self.seed = seed
    self.kind = kind
    previousPosition = position
    self.position = position
    self.velocity = velocity
    self.mass = mass
    self.inclination = inclination
    self.size = size
  }
}

/// Pure, deterministic orbital laws shared by the native kernel and its
/// fixtures. Constants and seeded construction port `src/lib/orbits.ts`.
public enum SolarPhysics {
  public static let tau = Double.pi * 2
  public static let basePeriodSeconds = 540.0
  public static let unitMu = pow(tau / basePeriodSeconds, 2)
  public static let minimumSemiMajorAxis = 0.36
  public static let maximumSemiMajorAxis = 3.4
  public static let minimumMass = 0.0004
  public static let maximumMass = 0.03
  public static let softening = 0.05
  public static let sunRadius = 0.09
  public static let planetCount = 6
  public static let maxBodies = 14
  public static let trailCapacityPerBody = 32
  public static let predictionSampleCount = 64

  public static func radius(ofMass mass: Double) -> Double {
    0.035 * pow(clamp(mass, minimumMass, maximumMass) / minimumMass, 1.0 / 3.0)
  }

  public static func circularSpeed(radius: Double, mu: Double = unitMu) -> Double {
    sqrt(mu / max(1e-6, radius))
  }

  public static func escapeSpeed(radius: Double, mu: Double = unitMu) -> Double {
    sqrt(2) * circularSpeed(radius: radius, mu: mu)
  }

  public static func period(semiMajorAxis: Double, mu: Double = unitMu) -> Double {
    tau * sqrt(pow(semiMajorAxis, 3) / mu)
  }

  /// Derives the instantaneous osculating semi-major axis from specific
  /// orbital energy. Unbound and non-finite states do not have a closed-orbit
  /// period and therefore return nil.
  public static func semiMajorAxis(of body: SolarBodyState, mu: Double = unitMu) -> Double? {
    let radius = simd_length(body.position)
    guard radius.isFinite, radius > 0, mu.isFinite, mu > 0 else { return nil }
    let specificEnergy = simd_length_squared(body.velocity) / 2 - mu / radius
    guard specificEnergy.isFinite, specificEnergy < 0 else { return nil }
    let result = -mu / (2 * specificEnergy)
    return result.isFinite && result > 0 ? result : nil
  }

  public static func hashSeed(_ parts: Int64...) -> UInt32 {
    var hash: UInt32 = 0x811c9dc5
    for part in parts {
      hash ^= UInt32(truncatingIfNeeded: part)
      hash = hash &* 0x01000193
    }
    return hash
  }

  public static func seededBodies(seed: UInt64) -> [SolarBodyState] {
    var random = Mulberry32(seed: UInt32(truncatingIfNeeded: seed))
    var bodies: [SolarBodyState] = []
    bodies.reserveCapacity(maxBodies)
    let inner = 0.42
    let outer = 3.1
    let ratio = pow(outer / inner, 1.0 / Double(planetCount - 1))
    for index in 0 ..< planetCount {
      let jitter = 0.88 + random.next() * 0.24
      let a = clamp(inner * pow(ratio, Double(index)) * jitter, minimumSemiMajorAxis, maximumSemiMajorAxis)
      let eccentricity = 0.02 + random.next() * 0.24 + (index == planetCount - 1 ? random.next() * 0.09 : 0)
      let inclination = (random.next() - 0.5) * 0.26
      let omega = random.next() * tau
      let phase = random.next() * tau
      let bodySeed = hashSeed(Int64(truncatingIfNeeded: seed), Int64(index), 0x50a1)
      let size = 0.3 + random.next() * 0.7
      let mass = minimumMass * pow(6, random.next())
      let state = stateVector(semiMajorAxis: a, eccentricity: eccentricity, omega: omega, meanAnomaly: phase, mu: unitMu)
      bodies.append(SolarBodyState(
        id: UInt64(bodySeed),
        seed: bodySeed,
        kind: .planet,
        position: state.position,
        velocity: state.velocity,
        mass: mass,
        inclination: inclination,
        size: size
      ))
    }
    return bodies
  }

  /// Classifies a state exactly where a hand releases it. There is no outer
  /// wall: non-negative orbital energy escapes, while a sun crossing or lost
  /// prograde angular momentum is consumed.
  public static func fate(of body: SolarBodyState, mu: Double = unitMu) -> SolarBodyFate {
    let r = simd_length(body.position)
    guard r.isFinite, r > sunRadius else { return .consumed }
    let speedSquared = simd_length_squared(body.velocity)
    guard speedSquared.isFinite else { return .escaped }
    if speedSquared / 2 - mu / r >= 0 { return .escaped }
    let angularMomentum = body.position.x * body.velocity.y - body.position.y * body.velocity.x
    return angularMomentum > 1e-7 ? .bound : .consumed
  }

  /// Symmetric softened accelerations. Pair contributions use one force and
  /// opposite signs, so mutual gravity cannot invent linear momentum.
  public static func accelerations(
    bodies: [SolarBodyState],
    centralMass: Double,
    x: inout [Double],
    y: inout [Double]
  ) {
    precondition(x.count >= maxBodies && y.count >= maxBodies)
    let count = bodies.count
    for index in 0 ..< count {
      let p = bodies[index].position
      let r2 = max(1e-12, simd_length_squared(p))
      let central = -(unitMu * centralMass) / (r2 * sqrt(r2))
      x[index] = p.x * central
      y[index] = p.y * central
    }
    let epsilonSquared = softening * softening
    guard count > 1 else { return }
    for first in 0 ..< count - 1 {
      for second in first + 1 ..< count {
        let delta = bodies[second].position - bodies[first].position
        let d2 = simd_length_squared(delta) + epsilonSquared
        let inverseCube = 1 / (d2 * sqrt(d2))
        let firstScale = unitMu * bodies[second].mass * inverseCube
        let secondScale = unitMu * bodies[first].mass * inverseCube
        x[first] += delta.x * firstScale
        y[first] += delta.y * firstScale
        x[second] -= delta.x * secondScale
        y[second] -= delta.y * secondScale
      }
    }
  }

  /// One fixed velocity-Verlet step. Caller-owned scratch storage means this
  /// function allocates nothing after the kernel is prepared.
  public static func step(
    bodies: inout [SolarBodyState],
    centralMass: Double,
    dt: Double,
    pinnedBodyID: UInt64? = nil,
    accelerationX: inout [Double],
    accelerationY: inout [Double],
    nextAccelerationX: inout [Double],
    nextAccelerationY: inout [Double]
  ) {
    guard dt > 0, dt.isFinite, !bodies.isEmpty else { return }
    accelerations(bodies: bodies, centralMass: centralMass, x: &accelerationX, y: &accelerationY)
    let halfStep = dt * 0.5
    for index in bodies.indices {
      bodies[index].previousPosition = bodies[index].position
      if bodies[index].id == pinnedBodyID { continue }
      bodies[index].velocity.x += accelerationX[index] * halfStep
      bodies[index].velocity.y += accelerationY[index] * halfStep
      bodies[index].position += bodies[index].velocity * dt
    }
    accelerations(bodies: bodies, centralMass: centralMass, x: &nextAccelerationX, y: &nextAccelerationY)
    for index in bodies.indices {
      if bodies[index].id == pinnedBodyID { continue }
      bodies[index].velocity.x += nextAccelerationX[index] * halfStep
      bodies[index].velocity.y += nextAccelerationY[index] * halfStep
    }
  }

  /// Whether a body's swept centre crosses the absorbing star during one
  /// fixed step. Endpoint-only checks let a fast release teleport through the
  /// star and be misreported as an escape.
  public static func crossesStar(_ body: SolarBodyState) -> Bool {
    segmentDistanceSquared(
      from: body.previousPosition,
      to: body.position,
      point: .zero
    ) <= sunRadius * sunRadius
  }

  /// Continuous collision check in relative coordinates. Subtracting the two
  /// swept segments reduces moving-sphere contact to one segment approaching
  /// the origin, and uses the same physical radii as the endpoint test.
  public static func sweptCollision(_ first: SolarBodyState, _ second: SolarBodyState) -> Bool {
    let previousDelta = second.previousPosition - first.previousPosition
    let currentDelta = second.position - first.position
    let touch = radius(ofMass: first.mass) + radius(ofMass: second.mass)
    return segmentDistanceSquared(from: previousDelta, to: currentDelta, point: .zero) <= touch * touch
  }

  public static func merged(_ first: SolarBodyState, _ second: SolarBodyState) -> SolarBodyState {
    let survivor = first.mass >= second.mass ? first : second
    let totalMass = first.mass + second.mass
    let position = (first.position * first.mass + second.position * second.mass) / totalMass
    let velocity = (first.velocity * first.mass + second.velocity * second.mass) / totalMass
    let inclination = (first.inclination * first.mass + second.inclination * second.mass) / totalMass
    let combinedSize = min(1, pow(pow(first.size, 3) + pow(second.size, 3), 1.0 / 3.0))
    return SolarBodyState(
      id: survivor.id,
      seed: survivor.seed,
      kind: survivor.kind,
      position: position,
      velocity: velocity,
      mass: totalMass,
      inclination: inclination,
      size: combinedSize
    )
  }

  public static func color(seed: UInt32, kind: SolarBodyKind) -> SIMD3<Float> {
    var random = Mulberry32(seed: seed)
    let paper = SIMD3<Double>(242, 238, 230) / 255
    let sea = SIMD3<Double>(44, 74, 92) / 255
    let kept = SIMD3<Double>(110, 90, 46) / 255
    let candle = SIMD3<Double>(200, 115, 42) / 255
    let aurora = SIMD3<Double>(124, 172, 150) / 255
    let result: SIMD3<Double>
    if kind == .comet {
      result = mix(paper, aurora, 0.25 + random.next() * 0.3)
    } else {
      let pick = random.next()
      if pick < 0.3 { result = mix(sea, paper, 0.25 + random.next() * 0.35) }
      else if pick < 0.55 { result = mix(kept, paper, 0.3 + random.next() * 0.3) }
      else if pick < 0.8 { result = mix(candle, paper, 0.15 + random.next() * 0.35) }
      else { result = mix(paper, sea, 0.15 + random.next() * 0.2) }
    }
    return SIMD3<Float>(Float(result.x), Float(result.y), Float(result.z))
  }

  private static func stateVector(
    semiMajorAxis: Double,
    eccentricity: Double,
    omega: Double,
    meanAnomaly: Double,
    mu: Double
  ) -> (position: SIMD2<Double>, velocity: SIMD2<Double>) {
    let eccentricAnomaly = solveKepler(meanAnomaly, eccentricity)
    let trueAnomaly = wrapAngle(2 * atan2(
      sqrt(1 + eccentricity) * sin(eccentricAnomaly / 2),
      sqrt(1 - eccentricity) * cos(eccentricAnomaly / 2)
    ))
    let radius = semiMajorAxis * (1 - eccentricity * cos(eccentricAnomaly))
    let angle = wrapAngle(trueAnomaly + omega)
    let h = sqrt(mu * semiMajorAxis * (1 - eccentricity * eccentricity))
    let radialVelocity = (mu / h) * eccentricity * sin(trueAnomaly)
    let tangentVelocity = (mu / h) * (1 + eccentricity * cos(trueAnomaly))
    let cosine = cos(angle)
    let sine = sin(angle)
    return (
      SIMD2(radius * cosine, radius * sine),
      SIMD2(radialVelocity * cosine - tangentVelocity * sine, radialVelocity * sine + tangentVelocity * cosine)
    )
  }

  private static func solveKepler(_ meanAnomaly: Double, _ eccentricity: Double) -> Double {
    let mean = wrapAngle(meanAnomaly)
    guard eccentricity > 0 else { return mean }
    var low = mean < Double.pi ? 0 : Double.pi - 1e-9
    var high = mean < Double.pi ? Double.pi + 1e-9 : tau
    var anomaly = eccentricity < 0.8 ? mean : Double.pi
    for _ in 0 ..< 64 {
      let residual = anomaly - eccentricity * sin(anomaly) - mean
      if abs(residual) <= 1e-11 { return anomaly }
      if residual > 0 { high = anomaly } else { low = anomaly }
      var next = anomaly - residual / (1 - eccentricity * cos(anomaly))
      if !(next > low && next < high) { next = (low + high) / 2 }
      anomaly = next
    }
    return anomaly
  }

  private static func wrapAngle(_ value: Double) -> Double {
    let remainder = value.truncatingRemainder(dividingBy: tau)
    return remainder >= 0 ? remainder : remainder + tau
  }

  private static func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double {
    min(max(value, lower), upper)
  }

  private static func mix(_ first: SIMD3<Double>, _ second: SIMD3<Double>, _ t: Double) -> SIMD3<Double> {
    first + (second - first) * t
  }

  private static func segmentDistanceSquared(
    from start: SIMD2<Double>,
    to end: SIMD2<Double>,
    point: SIMD2<Double>
  ) -> Double {
    let segment = end - start
    let lengthSquared = simd_length_squared(segment)
    guard lengthSquared > 1e-18, lengthSquared.isFinite else {
      return simd_distance_squared(point, start)
    }
    let projection = simd_dot(point - start, segment) / lengthSquared
    let t = min(max(projection, 0), 1)
    return simd_distance_squared(point, start + segment * t)
  }
}

private struct Mulberry32 {
  private var state: UInt32

  init(seed: UInt32) { state = seed }

  mutating func next() -> Double {
    state = state &+ 0x6d2b79f5
    var value = state
    value = (value ^ (value >> 15)) &* (1 | value)
    let firstMix = value
    value = (firstMix &+ ((firstMix ^ (firstMix >> 7)) &* (61 | firstMix))) ^ firstMix
    value ^= value >> 14
    return Double(value) / 4_294_967_296
  }
}
