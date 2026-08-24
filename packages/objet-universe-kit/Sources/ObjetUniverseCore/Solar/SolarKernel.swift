import Foundation
import simd

/// A bounded deterministic N-body instrument advanced by a fixed symplectic
/// integrator. Physics owns doubles; renderers borrow typed projections and
/// never become authoritative state.
public final class SolarKernel: SurfaceSimulationKernel, SolarSnapshotProviding, SimulationOutcomeProducing {
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
  public private(set) var bodies: [SolarBodyState]
  public private(set) var escapedCount = 0
  public private(set) var consumedCount = 0
  public private(set) var lastFate: SolarBodyFate = .bound

  private let seed: UInt64
  private var centralMass = 1.0
  private var selectedBodyID: UInt64?
  private var nextBodyOrdinal: UInt64 = 1
  private var collisionPulse = 0.0
  private var collisionPosition = SIMD3<Float>.zero
  private var touchPulse = 0.0
  private var touchPosition = SIMD3<Float>.zero
  private var touchKind: SolarTouchKind = .none
  private var pendingAccretion: SemanticContactPayload?
  private struct ActiveGrip {
    let bodyID: UInt64
    let initialState: SolarBodyState
    var previousPreviewPosition: SIMD2<Double>
    var previewPosition: SIMD2<Double>
  }
  private struct PendingOutcome {
    let id: String
    let kind: SimulationOutcomeKind
    let tick: Int
    let intensity: Double
    let bodyIDs: [UInt64]
    let frequencyHz: Double?
  }
  private var activeGrip: ActiveGrip?
  private static let recentAppliedCommandIDCapacity = 512
  private var recentAppliedCommandIDs: Set<String> = []
  private var recentAppliedCommandIDRing = [String?](repeating: nil, count: 512)
  private var recentAppliedCommandIDCursor = 0
  internal private(set) var recentAppliedCommandIDCount = 0
  private var appliedCommandCount: UInt64 = 0
  private var appliedCommandDigest: UInt64 = 0xcbf29ce484222325
  private var pendingOutcomes: [PendingOutcome] = []
  private var surfaceDirty = true
  internal private(set) var scalarProjectionCount = 0

  private var surface: [Float]
  private var accelerationX: [Double]
  private var accelerationY: [Double]
  private var nextAccelerationX: [Double]
  private var nextAccelerationY: [Double]
  private var trailPositions: [SIMD3<Float>]
  private var trailHeads: [Int]
  private var trailCounts: [Int]
  private var renderBodies: [SolarRenderBody] = []
  private var renderTrailPoints: [SolarTrailPoint] = []
  private var renderPredictionPoints: [SolarPredictionPoint] = []
  private var predictionBodies: [SolarBodyState] = []
  private var predictionAccelerationX: [Double]
  private var predictionAccelerationY: [Double]
  private var nextPredictionAccelerationX: [Double]
  private var nextPredictionAccelerationY: [Double]
  private var outcomes: [SimulationOutcome] = []
  private var outcomeOrdinal: UInt64 = 0

  public convenience init(seed: UInt64 = 0x501a12, secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    self.init(seed: seed, bodies: SolarPhysics.seededBodies(seed: seed), secondsPerTick: secondsPerTick)
  }

  /// Fixture seam for conservation, collision and fate tests.
  public init(seed: UInt64, bodies: [SolarBodyState], secondsPerTick: TimeInterval = UniverseClock.defaultStepSeconds) {
    precondition(secondsPerTick > 0 && secondsPerTick.isFinite)
    self.seed = seed
    self.secondsPerTick = secondsPerTick
    self.bodies = Array(bodies.prefix(SolarPhysics.maxBodies))
    self.bodies.reserveCapacity(SolarPhysics.maxBodies)
    surface = [Float](repeating: 0, count: width * height)
    accelerationX = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    accelerationY = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    nextAccelerationX = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    nextAccelerationY = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    predictionAccelerationX = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    predictionAccelerationY = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    nextPredictionAccelerationX = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    nextPredictionAccelerationY = [Double](repeating: 0, count: SolarPhysics.maxBodies)
    trailPositions = [SIMD3<Float>](repeating: .zero, count: SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody)
    trailHeads = [Int](repeating: 0, count: SolarPhysics.maxBodies)
    trailCounts = [Int](repeating: 0, count: SolarPhysics.maxBodies)
    renderBodies.reserveCapacity(SolarPhysics.maxBodies)
    renderTrailPoints.reserveCapacity(SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody)
    renderPredictionPoints.reserveCapacity(SolarPhysics.predictionSampleCount)
    predictionBodies.reserveCapacity(SolarPhysics.maxBodies)
    outcomes.reserveCapacity(32)
    pendingOutcomes.reserveCapacity(8)
    selectedBodyID = self.bodies.first?.id
    nextBodyOrdinal = UInt64(self.bodies.count + 1)
    for index in self.bodies.indices { appendTrail(for: index) }
    updateEnergy()
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

  public func withSurface<T>(_ body: (UnsafePointer<Float>, Int, Int) -> T) -> T {
    ensureSurfaceProjection()
    return surface.withUnsafeBufferPointer { buffer in body(buffer.baseAddress!, width, height) }
  }

  public func setRepresentation(_ rawValue: Int) {
    representation = min(max(rawValue, 0), 3)
    surfaceDirty = true
  }

  public func apply(_ command: SemanticCommand) -> KernelOutput {
    guard recordAppliedCommandID(command.id) else { return output() }
    let destinationTick = tick + 1
    switch command.verb {
    case .material: applyMaterial(command)
    case .grow:
      if let contact = command.payload.contact {
        select(contact.targetBodyID)
        switch contact.phase {
        case .enter, .tick:
          pendingAccretion = contact.targetBodyID == nil ? contact : nil
        case .release:
          if contact.targetBodyID == nil { plantBody(from: command) }
          pendingAccretion = nil
        case .cancel:
          pendingAccretion = nil
        }
      } else if command.payload.drag?.phase == .release || command.payload.drag == nil {
        plantBody(from: command)
      }
    case .ceremony: alignConjunction(at: command.origin ?? command.payload.drag?.point ?? .centre)
    case .tutti, .wake:
      for index in bodies.indices {
        let radial = normalized(bodies[index].position)
        bodies[index].velocity += SIMD2(-radial.y, radial.x) * (0.00025 + command.intensity * 0.0008)
      }
    case .agitate:
      for index in bodies.indices {
        let sign = index.isMultiple(of: 2) ? 1.0 : -1.0
        bodies[index].velocity += SIMD2(sign, -sign) * (0.0001 + command.intensity * 0.0005)
      }
    case .gravity:
      let normalizedGamma = min(max((command.payload.vessel?.gammaDegrees ?? ((command.intensity - 0.5) * 180)) / 90, -1), 1)
      centralMass = 1 + normalizedGamma * 0.5
    case .stepBack: setRepresentation(representation - 1)
    case .lens: setRepresentation((representation + 1) % 4)
    case .train, .scale, .season, .pan, .weather, .timeDilation, .night, .breath: break
    }
    if command.verb != .grow {
      mergeAllCollisionsIfNeeded(outcomeTick: destinationTick)
      consumeSweptStarCrossings(outcomeTick: destinationTick)
      removeUnboundBodies(outcomeTick: destinationTick)
    }
    updateEnergy()
    surfaceDirty = true
    return output()
  }

  public func advance(ticks requestedTicks: Int) -> KernelOutput {
    guard requestedTicks > 0 else { return output() }
    for _ in 0 ..< requestedTicks {
      SolarPhysics.step(
        bodies: &bodies,
        centralMass: centralMass,
        dt: secondsPerTick,
        pinnedBodyID: activeGrip?.bodyID,
        accelerationX: &accelerationX,
        accelerationY: &accelerationY,
        nextAccelerationX: &nextAccelerationX,
        nextAccelerationY: &nextAccelerationY
      )
      let destinationTick = tick + 1
      mergeAllCollisionsIfNeeded(outcomeTick: destinationTick)
      consumeSweptStarCrossings(outcomeTick: destinationTick)
      removeUnboundBodies(outcomeTick: destinationTick)
      for index in bodies.indices where bodies[index].id != activeGrip?.bodyID { appendTrail(for: index) }
      collisionPulse *= 0.92
      if collisionPulse < 0.0001 { collisionPulse = 0 }
      touchPulse *= 0.86
      if touchPulse < 0.0001 {
        touchPulse = 0
        touchKind = .none
      }
      tick = destinationTick
      elapsedSeconds += secondsPerTick
      updateEnergy()
      flushPendingOutcomes()
    }
    surfaceDirty = true
    return output()
  }

  public func solarTargetBody(at materialPoint: SemanticOrigin) -> UInt64? {
    let point = worldPoint(materialPoint)
    var closestID: UInt64?
    var closestDistance = Double.greatestFiniteMagnitude
    for body in bodies {
      let distance = simd_distance(point, body.position)
      let hitRadius = max(0.16, SolarPhysics.radius(ofMass: body.mass) * 1.8)
      if distance <= hitRadius && distance < closestDistance {
        closestDistance = distance
        closestID = body.id
      }
    }
    return closestID
  }

  public func withSolarRenderSnapshot<T>(_ body: (SolarRenderSnapshot) -> T) -> T {
    rebuildRenderBuffers()
    return renderBodies.withUnsafeBufferPointer { bodyBuffer in
      renderTrailPoints.withUnsafeBufferPointer { trailBuffer in
        renderPredictionPoints.withUnsafeBufferPointer { predictionBuffer in
          body(SolarRenderSnapshot(
            tick: tick,
            elapsedSeconds: elapsedSeconds,
            secondsPerTick: secondsPerTick,
            centralMass: Float(centralMass),
            representation: representation,
            selectedBodyID: selectedBodyID,
            collisionPulse: Float(min(max(collisionPulse, 0), 1)),
            collisionPosition: collisionPosition,
            touchPulse: Float(min(max(touchPulse, 0), 1)),
            touchPosition: touchPosition,
            touchKind: touchKind,
            accretionPreview: accretionPreview(),
            bodies: bodyBuffer,
            trailPoints: trailBuffer,
            predictionPoints: predictionBuffer
          ))
        }
      }
    }
  }

  public func drainSimulationOutcomes<T>(_ body: (UnsafeBufferPointer<SimulationOutcome>) -> T) -> T {
    let result = outcomes.withUnsafeBufferPointer(body)
    outcomes.removeAll(keepingCapacity: true)
    return result
  }

  private func applyMaterial(_ command: SemanticCommand) {
    if let drag = command.payload.drag {
      // Targeting is resolved once at contact enter and pinned into the
      // payload. A nil target is intentionally open sky; falling back to the
      // previous selection would make camera gestures move a planet.
      let targetID = drag.targetBodyID
      select(targetID)
      switch drag.phase {
      case .enter:
        guard let targetID, let state = bodies.first(where: { $0.id == targetID }) else { return }
        activeGrip = .init(
          bodyID: targetID,
          initialState: state,
          previousPreviewPosition: state.position,
          previewPosition: state.position
        )
      case .tick:
        guard let targetID, var grip = activeGrip, grip.bodyID == targetID else { return }
        grip.previousPreviewPosition = grip.previewPosition
        grip.previewPosition = worldPoint(drag.point)
        activeGrip = grip
      case .release:
        guard let targetID, activeGrip?.bodyID == targetID,
              let grip = activeGrip,
              let index = bodies.firstIndex(where: { $0.id == targetID }) else { return }
        bodies[index].previousPosition = grip.previewPosition
        bodies[index].position = worldPoint(drag.point)
        bodies[index].velocity = SIMD2(drag.velocity.x, drag.velocity.y) * 0.18
        activeGrip = nil
      case .cancel:
        guard let targetID, let grip = activeGrip, grip.bodyID == targetID,
              let index = bodies.firstIndex(where: { $0.id == targetID }) else { return }
        bodies[index] = grip.initialState
        activeGrip = nil
      }
      return
    }
    if let contact = command.payload.contact {
      guard contact.phase == .release else { return }
      if let target = contact.targetBodyID,
         let index = bodies.firstIndex(where: { $0.id == target }) {
        select(target, emitOutcomeWhenUnchanged: true)
        touchPulse = min(1, 0.45 + max(command.intensity, contact.normalizedPressure) * 0.55)
        touchPosition = projectedPosition(bodies[index])
        touchKind = .dust
      } else {
        registerOpenSkyTouch(at: contact.point, intensity: max(command.intensity, contact.normalizedPressure))
      }
      return
    }
    registerOpenSkyTouch(at: command.origin ?? .centre, intensity: command.intensity)
  }

  private func registerOpenSkyTouch(at point: SemanticOrigin, intensity: Double) {
    let world = worldPoint(point)
    touchPulse = min(1, 0.45 + intensity * 0.55)
    if simd_length(world) <= SolarPhysics.sunRadius * 2 {
      touchKind = .star
      touchPosition = .zero
    } else {
      touchKind = .dust
      touchPosition = SIMD3(Float(world.x), Float(world.y), 0)
    }
  }

  private func plantBody(from command: SemanticCommand) {
    let point = command.payload.contact?.point ?? command.payload.drag?.point ?? command.origin ?? .centre
    var position = worldPoint(point)
    var radius = simd_length(position)
    if radius < SolarPhysics.minimumSemiMajorAxis {
      let angle = point == .centre ? 0 : atan2(position.y, position.x)
      position = SIMD2(cos(angle), sin(angle)) * SolarPhysics.minimumSemiMajorAxis
      radius = SolarPhysics.minimumSemiMajorAxis
    }
    if radius > SolarPhysics.maximumSemiMajorAxis {
      position *= SolarPhysics.maximumSemiMajorAxis / radius
      radius = SolarPhysics.maximumSemiMajorAxis
    }
    let radial = normalized(position)
    let tangent = SIMD2(-radial.y, radial.x)
    let inputVelocity = command.payload.drag.map { SIMD2($0.velocity.x, $0.velocity.y) * 0.12 } ?? .zero
    let massAxis = command.payload.contact.map { min(max($0.durationSeconds / 3, 0), 1) } ?? command.intensity
    let mass = SolarPhysics.minimumMass * pow(SolarPhysics.maximumMass / SolarPhysics.minimumMass, massAxis)
    let commandSeed = stableCommandSeed(command.id)
    let id = (UInt64(commandSeed) << 32) | nextBodyOrdinal
    nextBodyOrdinal &+= 1
    let newBody = SolarBodyState(
      id: id,
      seed: commandSeed,
      kind: .comet,
      position: position,
      velocity: tangent * SolarPhysics.circularSpeed(radius: radius, mu: SolarPhysics.unitMu * centralMass) + inputVelocity,
      mass: mass,
      inclination: (Double(commandSeed & 0xffff) / 65_535 - 0.5) * 0.5,
      size: min(1, 0.12 + pow(mass / SolarPhysics.minimumMass, 1.0 / 3.0) * 0.14)
    )
    let fate = SolarPhysics.fate(of: newBody, mu: SolarPhysics.unitMu * centralMass)
    guard fate == .bound else { lastFate = fate; return }
    if bodies.count == SolarPhysics.maxBodies {
      let removal = bodies.firstIndex(where: { $0.kind == .comet }) ?? bodies.indices.last!
      removeBody(at: removal, fate: .escaped, outcomeTick: tick + 1)
    }
    bodies.append(newBody)
    clearTrail(slot: bodies.count - 1)
    appendTrail(for: bodies.count - 1)
    selectedBodyID = id
    stageOutcome(.created, tick: tick + 1, intensity: command.intensity, bodyIDs: [id])
  }

  private func alignConjunction(at point: SemanticOrigin) {
    let world = worldPoint(point)
    let angle = simd_length_squared(world) > 1e-9 ? atan2(world.y, world.x) : 0
    let direction = SIMD2(cos(angle), sin(angle))
    let tangent = SIMD2(-direction.y, direction.x)
    for index in bodies.indices {
      let radius = min(max(simd_length(bodies[index].position), SolarPhysics.minimumSemiMajorAxis), SolarPhysics.maximumSemiMajorAxis)
      bodies[index].previousPosition = bodies[index].position
      bodies[index].position = direction * radius
      bodies[index].velocity = tangent * SolarPhysics.circularSpeed(radius: radius, mu: SolarPhysics.unitMu * centralMass)
    }
    stageOutcome(.orbitLocked, tick: tick + 1, intensity: 1, bodyIDs: bodies.prefix(2).map(\.id))
  }

  private func consumeSweptStarCrossings(outcomeTick: Int) {
    for index in bodies.indices.reversed() where bodies[index].id != activeGrip?.bodyID {
      if SolarPhysics.crossesStar(bodies[index]) {
        removeBody(at: index, fate: .consumed, outcomeTick: outcomeTick)
      }
    }
  }

  private func removeUnboundBodies(outcomeTick: Int) {
    for index in bodies.indices.reversed() {
      guard bodies[index].id != activeGrip?.bodyID else { continue }
      let fate = SolarPhysics.fate(of: bodies[index], mu: SolarPhysics.unitMu * centralMass)
      if fate != .bound { removeBody(at: index, fate: fate, outcomeTick: outcomeTick) }
    }
  }

  private func mergeAllCollisionsIfNeeded(outcomeTick: Int) {
    while bodies.count > 1 {
      var collision: (first: Int, second: Int)?
      collisionSearch: for first in 0 ..< bodies.count - 1 {
        for second in first + 1 ..< bodies.count {
          guard bodies[first].id != activeGrip?.bodyID, bodies[second].id != activeGrip?.bodyID else { continue }
          if SolarPhysics.sweptCollision(bodies[first], bodies[second]) {
            collision = (first, second)
            break collisionSearch
          }
        }
      }
      guard let collision else { return }
      let parentIDs = [bodies[collision.first].id, bodies[collision.second].id]
      let merged = SolarPhysics.merged(bodies[collision.first], bodies[collision.second])
      collisionPosition = projectedPosition(merged)
      collisionPulse = 1
      bodies[collision.first] = merged
      clearTrail(slot: collision.first)
      appendTrail(for: collision.first)
      removeBody(at: collision.second, fate: nil, outcomeTick: outcomeTick)
      selectedBodyID = merged.id
      stageOutcome(.collision, tick: outcomeTick, intensity: min(1, merged.mass / SolarPhysics.maximumMass), bodyIDs: parentIDs)
    }
  }

  private func removeBody(at index: Int, fate: SolarBodyFate?, outcomeTick: Int) {
    guard bodies.indices.contains(index) else { return }
    let removedID = bodies[index].id
    bodies.remove(at: index)
    if activeGrip?.bodyID == removedID { activeGrip = nil }
    shiftTrailsLeft(startingAt: index)
    if selectedBodyID == removedID { selectedBodyID = bodies.first?.id }
    guard let fate else { return }
    lastFate = fate
    if fate == .escaped { escapedCount += 1 }
    if fate == .consumed { consumedCount += 1 }
    if fate == .escaped { stageOutcome(.escaped, tick: outcomeTick, intensity: 1, bodyIDs: [removedID]) }
    if fate == .consumed { stageOutcome(.consumed, tick: outcomeTick, intensity: 1, bodyIDs: [removedID]) }
  }

  private func shiftTrailsLeft(startingAt index: Int) {
    if index < SolarPhysics.maxBodies - 1 {
      for slot in index ..< SolarPhysics.maxBodies - 1 {
        let source = (slot + 1) * SolarPhysics.trailCapacityPerBody
        let destination = slot * SolarPhysics.trailCapacityPerBody
        for offset in 0 ..< SolarPhysics.trailCapacityPerBody { trailPositions[destination + offset] = trailPositions[source + offset] }
        trailHeads[slot] = trailHeads[slot + 1]
        trailCounts[slot] = trailCounts[slot + 1]
      }
    }
    clearTrail(slot: SolarPhysics.maxBodies - 1)
  }

  private func clearTrail(slot: Int) {
    trailHeads[slot] = 0
    trailCounts[slot] = 0
  }

  private func appendTrail(for index: Int) {
    guard bodies.indices.contains(index), index < SolarPhysics.maxBodies else { return }
    let head = trailHeads[index]
    trailPositions[index * SolarPhysics.trailCapacityPerBody + head] = projectedPosition(bodies[index])
    trailHeads[index] = (head + 1) % SolarPhysics.trailCapacityPerBody
    trailCounts[index] = min(SolarPhysics.trailCapacityPerBody, trailCounts[index] + 1)
  }

  private func rebuildRenderBuffers() {
    renderBodies.removeAll(keepingCapacity: true)
    renderTrailPoints.removeAll(keepingCapacity: true)
    renderPredictionPoints.removeAll(keepingCapacity: true)
    for (index, state) in bodies.enumerated() {
      var renderedState = state
      if let grip = activeGrip, grip.bodyID == state.id {
        renderedState.previousPosition = grip.previousPreviewPosition
        renderedState.position = grip.previewPosition
      }
      let offset = renderTrailPoints.count
      let count = trailCounts[index]
      let oldest = (trailHeads[index] - count + SolarPhysics.trailCapacityPerBody) % SolarPhysics.trailCapacityPerBody
      for order in 0 ..< count {
        let ringIndex = (oldest + order) % SolarPhysics.trailCapacityPerBody
        let age = count == 1 ? 0 : Float(count - 1 - order) / Float(count - 1)
        renderTrailPoints.append(.init(bodyID: state.id, position: trailPositions[index * SolarPhysics.trailCapacityPerBody + ringIndex], age: age))
      }
      renderBodies.append(.init(
        id: renderedState.id,
        materialSeed: renderedState.seed,
        kind: renderedState.kind,
        previousPosition: projectedPosition(renderedState, previous: true),
        position: projectedPosition(renderedState),
        velocity: SIMD2(Float(renderedState.velocity.x), Float(renderedState.velocity.y)),
        mass: Float(renderedState.mass),
        radius: Float(SolarPhysics.radius(ofMass: renderedState.mass)),
        color: SolarPhysics.color(seed: renderedState.seed, kind: renderedState.kind),
        trailOffset: offset,
        trailCount: count,
        isSelected: state.id == selectedBodyID
      ))
    }
    rebuildPrediction()
  }

  private func accretionPreview() -> SolarAccretionPreview? {
    guard let contact = pendingAccretion else { return nil }
    var position = worldPoint(contact.point)
    let length = simd_length(position)
    if length < SolarPhysics.minimumSemiMajorAxis { position = normalized(position) * SolarPhysics.minimumSemiMajorAxis }
    else if length > SolarPhysics.maximumSemiMajorAxis { position *= SolarPhysics.maximumSemiMajorAxis / length }
    let progress = min(max(contact.durationSeconds / 3, 0), 1)
    let mass = SolarPhysics.minimumMass * pow(SolarPhysics.maximumMass / SolarPhysics.minimumMass, progress)
    let previewSeed = SolarPhysics.hashSeed(Int64(truncatingIfNeeded: seed), Int64(nextBodyOrdinal), 0xacc)
    return .init(
      position: SIMD3(Float(position.x), Float(position.y), 0),
      radius: Float(SolarPhysics.radius(ofMass: mass)),
      color: SolarPhysics.color(seed: previewSeed, kind: .comet),
      progress: Float(progress)
    )
  }

  /// Fills a preallocated buffer without mutating authoritative state.
  private func rebuildPrediction() {
    renderPredictionPoints.removeAll(keepingCapacity: true)
    guard let selectedBodyID, let state = bodies.first(where: { $0.id == selectedBodyID }) else { return }
    let mu = SolarPhysics.unitMu * centralMass
    let radius = max(SolarPhysics.sunRadius, simd_length(state.position))
    let semiMajor = SolarPhysics.semiMajorAxis(of: state, mu: mu)
      .map { min(SolarPhysics.maximumSemiMajorAxis, max(SolarPhysics.minimumSemiMajorAxis, $0)) } ?? radius
    let dt = SolarPhysics.period(semiMajorAxis: semiMajor, mu: mu) / Double(SolarPhysics.predictionSampleCount)
    predictionBodies.removeAll(keepingCapacity: true)
    for body in bodies { predictionBodies.append(body) }
    guard let selectedIndex = predictionBodies.firstIndex(where: { $0.id == selectedBodyID }) else { return }
    for _ in 0 ..< SolarPhysics.predictionSampleCount {
      SolarPhysics.step(
        bodies: &predictionBodies,
        centralMass: centralMass,
        dt: dt,
        accelerationX: &predictionAccelerationX,
        accelerationY: &predictionAccelerationY,
        nextAccelerationX: &nextPredictionAccelerationX,
        nextAccelerationY: &nextPredictionAccelerationY
      )
      renderPredictionPoints.append(.init(bodyID: selectedBodyID, position: projectedPosition(predictionBodies[selectedIndex])))
    }
  }

  private func updateEnergy() {
    let mu = SolarPhysics.unitMu * centralMass
    var total = 0.0
    for body in bodies {
      total += body.mass * (simd_length_squared(body.velocity) / 2 - mu / max(1e-12, simd_length(body.position)))
    }
    if bodies.count > 1 {
      for first in 0 ..< bodies.count - 1 {
        for second in first + 1 ..< bodies.count {
          let distance = sqrt(simd_distance_squared(bodies[first].position, bodies[second].position) + SolarPhysics.softening * SolarPhysics.softening)
          total -= SolarPhysics.unitMu * bodies[first].mass * bodies[second].mass / distance
        }
      }
    }
    energy = total
  }

  private func projectSurface() {
    scalarProjectionCount += 1
    surface.withUnsafeMutableBufferPointer { buffer in
      for index in buffer.indices { buffer[index] = 0 }
      if representation == 0 { projectGalaxy(into: &buffer) }
      if representation == 2 {
        rebuildPrediction()
        for point in renderPredictionPoints {
          paint(point: point.position, radius: 1.2, value: 0.16, into: &buffer)
        }
      }
      for body in bodies {
        let gain: Double
        if representation == 0 { gain = 0.45 }
        else if representation == 3 { gain = min(1.4, 0.25 + simd_length(body.velocity) * 90) }
        else { gain = 1 }
        paint(body: body, into: &buffer, gain: gain)
      }
    }
    surfaceDirty = false
  }

  private func ensureSurfaceProjection() {
    if surfaceDirty { projectSurface() }
  }

  private func projectGalaxy(into buffer: inout UnsafeMutableBufferPointer<Float>) {
    let phase = Double(seed % 10_000) / 10_000 * SolarPhysics.tau
    let widthScale = Double(width - 1)
    let heightScale = Double(height - 1)
    for pixelY in 0 ..< height {
      for pixelX in 0 ..< width {
        let x = Double(pixelX) / widthScale * 2 - 1
        let y = Double(pixelY) / heightScale * 2 - 1
        let radius = hypot(x, y)
        let armPhase = atan2(y, x) * 3 + radius * 6.2 + phase
        let arm = exp(-abs(sin(armPhase)) * 11)
        let core = exp(-radius * radius * 6) * 0.8
        let dust = max(0, 1 - radius / 1.15) * arm * 0.45
        buffer[pixelY * width + pixelX] = Float(min(1, core + dust))
      }
    }
  }

  private func paint(body: SolarBodyState, into buffer: inout UnsafeMutableBufferPointer<Float>, gain: Double) {
    paint(point: projectedPosition(body), radius: max(1.8, SolarPhysics.radius(ofMass: body.mass) * 26), value: min(1, body.mass * 180 * gain), into: &buffer)
  }

  private func paint(point: SIMD3<Float>, radius: Double, value: Double, into buffer: inout UnsafeMutableBufferPointer<Float>) {
    let px = (Double(point.x) / (SolarPhysics.maximumSemiMajorAxis * 2) + 0.5) * Double(width - 1)
    let py = (Double(point.y) / (SolarPhysics.maximumSemiMajorAxis * 2) + 0.5) * Double(height - 1)
    let minX = max(0, Int(px - radius)), maxX = min(width - 1, Int(px + radius))
    let minY = max(0, Int(py - radius)), maxY = min(height - 1, Int(py + radius))
    guard minX <= maxX, minY <= maxY else { return }
    for y in minY ... maxY { for x in minX ... maxX {
      let dx = Double(x) - px, dy = Double(y) - py
      let index = y * width + x
      buffer[index] = min(1, buffer[index] + Float(value * exp(-(dx * dx + dy * dy) / max(1, radius * radius))))
    }}
  }

  private func output() -> KernelOutput {
    .init(stable: energy.isFinite && bodies.allSatisfy(isFinite), checkpoint: .init(scene: scene, tick: tick, digest: canonicalDigest()))
  }

  private func canonicalDigest() -> String {
    var hash: UInt64 = 0xcbf29ce484222325
    func feed(_ value: UInt64) { var v = value; for _ in 0 ..< 8 { hash ^= v & 0xff; hash = hash &* 0x100000001b3; v >>= 8 } }
    feed(seed); feed(UInt64(tick)); feed(UInt64(representation)); feed(elapsedSeconds.bitPattern)
    feed(centralMass.bitPattern); feed(selectedBodyID ?? 0); feed(nextBodyOrdinal)
    feed(UInt64(escapedCount)); feed(UInt64(consumedCount)); feed(UInt64(lastFateIndex))
    feed(collisionPulse.bitPattern); feed(UInt64(collisionPosition.x.bitPattern)); feed(UInt64(collisionPosition.y.bitPattern)); feed(UInt64(collisionPosition.z.bitPattern))
    feed(outcomeOrdinal)
    feed(appliedCommandCount); feed(appliedCommandDigest)
    if let activeGrip {
      feed(1); feed(activeGrip.bodyID)
      feed(activeGrip.initialState.id); feed(UInt64(activeGrip.initialState.seed)); feed(UInt64(activeGrip.initialState.kind.rawValue))
      feed(activeGrip.initialState.previousPosition.x.bitPattern); feed(activeGrip.initialState.previousPosition.y.bitPattern)
      feed(activeGrip.initialState.position.x.bitPattern); feed(activeGrip.initialState.position.y.bitPattern)
      feed(activeGrip.initialState.velocity.x.bitPattern); feed(activeGrip.initialState.velocity.y.bitPattern)
      feed(activeGrip.initialState.mass.bitPattern); feed(activeGrip.initialState.inclination.bitPattern); feed(activeGrip.initialState.size.bitPattern)
      feed(activeGrip.previousPreviewPosition.x.bitPattern); feed(activeGrip.previousPreviewPosition.y.bitPattern)
      feed(activeGrip.previewPosition.x.bitPattern); feed(activeGrip.previewPosition.y.bitPattern)
    } else {
      feed(0)
    }
    feed(UInt64(bodies.count))
    for body in bodies {
      feed(body.id); feed(UInt64(body.seed)); feed(UInt64(body.kind.rawValue))
      feed(body.previousPosition.x.bitPattern); feed(body.previousPosition.y.bitPattern)
      feed(body.position.x.bitPattern); feed(body.position.y.bitPattern)
      feed(body.velocity.x.bitPattern); feed(body.velocity.y.bitPattern)
      feed(body.mass.bitPattern); feed(body.inclination.bitPattern); feed(body.size.bitPattern)
    }
    return "solar-v3-" + String(hash, radix: 16)
  }

  private func recordAppliedCommandID(_ id: String) -> Bool {
    guard !recentAppliedCommandIDs.contains(id) else { return false }
    if recentAppliedCommandIDCount == Self.recentAppliedCommandIDCapacity,
       let evicted = recentAppliedCommandIDRing[recentAppliedCommandIDCursor] {
      recentAppliedCommandIDs.remove(evicted)
    } else {
      recentAppliedCommandIDCount += 1
    }
    recentAppliedCommandIDRing[recentAppliedCommandIDCursor] = id
    recentAppliedCommandIDCursor = (recentAppliedCommandIDCursor + 1) % Self.recentAppliedCommandIDCapacity
    recentAppliedCommandIDs.insert(id)
    appliedCommandCount &+= 1
    appliedCommandDigest ^= appliedCommandCount
    appliedCommandDigest = appliedCommandDigest &* 0x100000001b3
    appliedCommandDigest ^= UInt64(id.utf8.count)
    appliedCommandDigest = appliedCommandDigest &* 0x100000001b3
    for byte in id.utf8 {
      appliedCommandDigest ^= UInt64(byte)
      appliedCommandDigest = appliedCommandDigest &* 0x100000001b3
    }
    return true
  }

  private var lastFateIndex: Int {
    switch lastFate { case .bound: 0; case .escaped: 1; case .consumed: 2 }
  }

  private func select(_ id: UInt64?, emitOutcomeWhenUnchanged: Bool = false) {
    if let id, bodies.contains(where: { $0.id == id }), selectedBodyID != id || emitOutcomeWhenUnchanged {
      selectedBodyID = id
      let frequencyHz = bodies.first(where: { $0.id == id })
        .flatMap { SolarPhysics.semiMajorAxis(of: $0, mu: SolarPhysics.unitMu * centralMass) }
        .map { 196_608 / SolarPhysics.period(semiMajorAxis: $0, mu: SolarPhysics.unitMu * centralMass) }
      stageOutcome(.selected, tick: tick + 1, intensity: 0.25, bodyIDs: [id], frequencyHz: frequencyHz)
    }
  }
  private func worldPoint(_ point: SemanticOrigin) -> SIMD2<Double> { SIMD2((point.x * 2 - 1) * SolarPhysics.maximumSemiMajorAxis, (point.y * 2 - 1) * SolarPhysics.maximumSemiMajorAxis) }
  private func projectedPosition(_ body: SolarBodyState, previous: Bool = false) -> SIMD3<Float> { let p = previous ? body.previousPosition : body.position; return SIMD3(Float(p.x), Float(p.y * cos(body.inclination)), Float(p.y * sin(body.inclination))) }
  private func normalized(_ value: SIMD2<Double>) -> SIMD2<Double> { let length = simd_length(value); return length > 1e-12 ? value / length : SIMD2(1, 0) }
  private func isFinite(_ body: SolarBodyState) -> Bool { body.position.x.isFinite && body.position.y.isFinite && body.velocity.x.isFinite && body.velocity.y.isFinite && body.mass.isFinite }

  private func stableCommandSeed(_ id: String) -> UInt32 {
    var hash: UInt32 = 0x811c9dc5
    for byte in id.utf8 { hash ^= UInt32(byte); hash = hash &* 0x01000193 }
    return SolarPhysics.hashSeed(Int64(hash), Int64(truncatingIfNeeded: seed), Int64(nextBodyOrdinal))
  }

  private func stageOutcome(
    _ kind: SimulationOutcomeKind,
    tick: Int,
    intensity: Double,
    bodyIDs: [UInt64],
    frequencyHz: Double? = nil
  ) {
    outcomeOrdinal &+= 1
    pendingOutcomes.append(.init(
      id: "solar-\(tick)-\(outcomeOrdinal)-\(kind.rawValue)",
      kind: kind,
      tick: tick,
      intensity: intensity,
      bodyIDs: bodyIDs,
      frequencyHz: frequencyHz
    ))
  }

  private func flushPendingOutcomes() {
    for pending in pendingOutcomes {
      if outcomes.count == 32 { outcomes.removeFirst() }
      outcomes.append(.init(
        id: pending.id,
        kind: pending.kind,
        tick: pending.tick,
        energy: energy,
        intensity: pending.intensity,
        bodyIDs: pending.bodyIDs,
        frequencyHz: pending.frequencyHz
      ))
    }
    pendingOutcomes.removeAll(keepingCapacity: true)
  }
}
