#if canImport(Metal)
import Metal
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Phone-scale visibility tests for the orbital instrument. They run the
/// shipping packer and the production pipeline bundle, so a scalar fallback,
/// stale ABI, inert lens, or lost reduced-motion detent fails before release.
final class SolarMetalRenderTests: XCTestCase {
  private static let outputWidth = 780
  private static let outputHeight = 1_688

  private struct Input {
    let elapsed: Double
    let secondsPerTick: Double
    let centralMass: Float
    let representation: Int
    let collisionPulse: Float
    let collisionPosition: SIMD3<Float>
    let touchPulse: Float
    let touchPosition: SIMD3<Float>
    let touchKind: SolarTouchKind
    let preview: SolarAccretionPreview?
    let bodies: [SolarRenderBody]
    let trail: [SolarTrailPoint]
    let prediction: [SolarPredictionPoint]

    func withSnapshot<T>(_ body: (SolarRenderSnapshot) throws -> T) rethrows -> T {
      try bodies.withUnsafeBufferPointer { bodies in
        try trail.withUnsafeBufferPointer { trail in
          try prediction.withUnsafeBufferPointer { prediction in
            try body(SolarRenderSnapshot(
              tick: 12,
              elapsedSeconds: elapsed,
              secondsPerTick: secondsPerTick,
              centralMass: centralMass,
              representation: representation,
              selectedBodyID: bodies.first?.id,
              collisionPulse: collisionPulse,
              collisionPosition: collisionPosition,
              touchPulse: touchPulse,
              touchPosition: touchPosition,
              touchKind: touchKind,
              accretionPreview: preview,
              bodies: bodies,
              trailPoints: trail,
              predictionPoints: prediction
            ))
          }
        }
      }
    }
  }

  private final class Fixture {
    private let pipelines: SolarPipelineBundle
    private let uniforms: MTLBuffer
    private let bodies: MTLBuffer
    private let preview: MTLBuffer
    private let trails: MTLBuffer
    private let prediction: MTLBuffer
    private let output: MTLTexture
    private let pass = MTLRenderPassDescriptor()
    private let queue: MTLCommandQueue

    init(device: MTLDevice) throws {
      pipelines = try SolarPipelineCompiler(device: device).makePipelines(pixelFormat: .bgra8Unorm)
      uniforms = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<SolarShaderUniforms>.stride,
        options: .storageModeShared
      ))
      bodies = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<SolarGPUBody>.stride * SolarPhysics.maxBodies,
        options: .storageModeShared
      ))
      preview = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<SolarGPUBody>.stride,
        options: .storageModeShared
      ))
      trails = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<SolarGPUMark>.stride * SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody,
        options: .storageModeShared
      ))
      prediction = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<SolarGPUMark>.stride * SolarPhysics.predictionSampleCount,
        options: .storageModeShared
      ))
      let descriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .bgra8Unorm,
        width: SolarMetalRenderTests.outputWidth,
        height: SolarMetalRenderTests.outputHeight,
        mipmapped: false
      )
      descriptor.storageMode = .shared
      descriptor.usage = .renderTarget
      output = try XCTUnwrap(device.makeTexture(descriptor: descriptor))
      pass.colorAttachments[0].texture = output
      pass.colorAttachments[0].loadAction = .clear
      pass.colorAttachments[0].storeAction = .store
      pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
      queue = try XCTUnwrap(device.makeCommandQueue())
    }

    func render(
      input: Input,
      elapsed: Float? = nil,
      reducedMotion: Bool = false,
      frozenElapsed: Float? = nil
    ) throws -> [UInt8] {
      let bodyDestination = UnsafeMutableBufferPointer(
        start: bodies.contents().bindMemory(to: SolarGPUBody.self, capacity: SolarPhysics.maxBodies),
        count: SolarPhysics.maxBodies
      )
      let previewDestination = UnsafeMutableBufferPointer(
        start: preview.contents().bindMemory(to: SolarGPUBody.self, capacity: 1),
        count: 1
      )
      let trailDestination = UnsafeMutableBufferPointer(
        start: trails.contents().bindMemory(
          to: SolarGPUMark.self,
          capacity: SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody
        ),
        count: SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody
      )
      let predictionDestination = UnsafeMutableBufferPointer(
        start: prediction.contents().bindMemory(to: SolarGPUMark.self, capacity: SolarPhysics.predictionSampleCount),
        count: SolarPhysics.predictionSampleCount
      )
      var pathOffsets = [Int](repeating: 0, count: SolarPhysics.maxBodies)
      var pathCounts = [Int](repeating: 0, count: SolarPhysics.maxBodies)
      let upload = try input.withSnapshot { snapshot in
        try XCTUnwrap(SolarRenderer.pack(
          snapshot,
          bodies: bodyDestination,
          preview: previewDestination,
          trails: trailDestination,
          prediction: predictionDestination,
          pathOffsets: &pathOffsets,
          pathCounts: &pathCounts
        ))
      }
      var state = input.withSnapshot { SolarRenderer.makeUniforms(for: $0, upload: upload) }
      state.viewport = SIMD2<Float>(Float(SolarMetalRenderTests.outputWidth), Float(SolarMetalRenderTests.outputHeight))
      state.elapsed = elapsed ?? Float(input.elapsed)
      state.frozenElapsed = frozenElapsed ?? state.elapsed
      state.reducedMotion = reducedMotion ? 1 : 0
      memcpy(uniforms.contents(), &state, MemoryLayout<SolarShaderUniforms>.stride)

      let command = try XCTUnwrap(queue.makeCommandBuffer())
      let encoder = try XCTUnwrap(command.makeRenderCommandEncoder(descriptor: pass))
      encoder.setRenderPipelineState(pipelines.background)
      encoder.setFragmentBuffer(uniforms, offset: 0, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      if state.representation <= 1 {
        encoder.setRenderPipelineState(pipelines.orbit)
        encoder.setVertexBuffer(trails, offset: 0, index: 0)
        encoder.setVertexBuffer(uniforms, offset: 0, index: 1)
        for index in 0 ..< upload.bodyCount where pathCounts[index] > 1 {
          encoder.drawPrimitives(type: .lineStrip, vertexStart: pathOffsets[index], vertexCount: pathCounts[index])
        }
      }
      if state.representation == 1 {
        encoder.setRenderPipelineState(pipelines.mark)
        encoder.setVertexBuffer(trails, offset: 0, index: 0)
        encoder.setVertexBuffer(uniforms, offset: 0, index: 1)
        if upload.trailCount > 0 {
          encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: upload.trailCount)
        }
        encoder.setVertexBuffer(prediction, offset: 0, index: 0)
        if upload.predictionCount > 0 {
          encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: upload.predictionCount)
        }
      }
      encoder.setRenderPipelineState(pipelines.body)
      encoder.setVertexBuffer(preview, offset: 0, index: 0)
      encoder.setVertexBuffer(uniforms, offset: 0, index: 1)
      encoder.setFragmentBuffer(uniforms, offset: 0, index: 0)
      if upload.previewCount > 0 {
        encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: upload.previewCount)
      }
      encoder.setVertexBuffer(bodies, offset: 0, index: 0)
      if upload.bodyCount > 0 {
        encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: upload.bodyCount)
      }
      encoder.endEncoding()
      command.commit()
      command.waitUntilCompleted()
      XCTAssertEqual(command.status, .completed)
      XCTAssertNil(command.error)

      var pixels = [UInt8](
        repeating: 0,
        count: SolarMetalRenderTests.outputWidth * SolarMetalRenderTests.outputHeight * 4
      )
      output.getBytes(
        &pixels,
        bytesPerRow: SolarMetalRenderTests.outputWidth * 4,
        from: MTLRegionMake2D(0, 0, SolarMetalRenderTests.outputWidth, SolarMetalRenderTests.outputHeight),
        mipmapLevel: 0
      )
      return pixels
    }
  }

  func testSolarReadingsRenderAsDistinctReadablePhoneScaleMaterials() throws {
    let fixture = try Fixture(device: metalDevice())
    var images: [[UInt8]] = []
    for representation in 0 ... 3 {
      let image = try fixture.render(input: input(representation: representation))
      assertReadable(image, register: representation)
      images.append(image)
    }
    for first in 0 ..< images.count {
      for second in (first + 1) ..< images.count {
        assertMaterialDifference(images[first], images[second], firstRegister: first, secondRegister: second)
      }
    }
  }

  func testSolarMaterialIsDeterministicAndUsesSeededSurfaces() throws {
    let fixture = try Fixture(device: metalDevice())
    let source = input(representation: 0)
    XCTAssertGreaterThan(
      Set(source.bodies.map(\.materialSeed)).count,
      3,
      "the fixture must exercise several independently seeded worlds"
    )
    let first = try fixture.render(input: source)
    let second = try fixture.render(input: source)
    XCTAssertEqual(first, second, "the same orbital state must render byte-for-byte deterministically")

    let world = source.bodies[0]
    let materialWorld = SolarRenderBody(
      id: world.id,
      materialSeed: world.materialSeed,
      kind: world.kind,
      previousPosition: world.previousPosition,
      position: world.position,
      velocity: world.velocity,
      mass: world.mass,
      radius: world.radius,
      color: world.color,
      trailOffset: 0,
      trailCount: 0,
      isSelected: world.isSelected
    )
    let alternate = SolarRenderBody(
      id: materialWorld.id,
      materialSeed: materialWorld.materialSeed ^ 0xA11C_E551,
      kind: materialWorld.kind,
      previousPosition: materialWorld.previousPosition,
      position: materialWorld.position,
      velocity: materialWorld.velocity,
      mass: materialWorld.mass,
      radius: materialWorld.radius,
      color: materialWorld.color,
      trailOffset: 0,
      trailCount: 0,
      isSelected: materialWorld.isSelected
    )
    let alternateInput = Input(
      elapsed: source.elapsed,
      secondsPerTick: source.secondsPerTick,
      centralMass: source.centralMass,
      representation: 0,
      collisionPulse: 0,
      collisionPosition: .zero,
      touchPulse: 0,
      touchPosition: .zero,
      touchKind: .none,
      preview: nil,
      bodies: [alternate],
      trail: [],
      prediction: []
    )
    let singleSeedInput = Input(
      elapsed: source.elapsed,
      secondsPerTick: source.secondsPerTick,
      centralMass: source.centralMass,
      representation: 0,
      collisionPulse: 0,
      collisionPosition: .zero,
      touchPulse: 0,
      touchPosition: .zero,
      touchKind: .none,
      preview: nil,
      bodies: [materialWorld],
      trail: [],
      prediction: []
    )
    assertMaterialDifference(
      try fixture.render(input: singleSeedInput),
      try fixture.render(input: alternateInput),
      firstRegister: 0,
      secondRegister: 0,
      minimumChangedFraction: 0.0010,
      minimumMeanDelta: 0.00005
    )
  }

  func testReducedMotionHoldsDecorativeSolarPhaseWithoutFreezingAuthority() throws {
    let fixture = try Fixture(device: metalDevice())
    let source = input(representation: 3)
    var timing = MetalPresentationTiming()
    let sourcePixels = try fixture.render(
      input: source,
      elapsed: timing.presentationElapsed(for: Float(source.elapsed))
    )

    timing.setReducedMotion(true)
    let advanced = advancedInput(from: source)
    let heldAdvanced = try fixture.render(
      input: advanced,
      elapsed: timing.presentationElapsed(for: Float(advanced.elapsed)),
      reducedMotion: timing.reducedMotion,
      frozenElapsed: timing.frozenElapsed
    )
    let advancedAtHeldPhase = try fixture.render(input: advanced, elapsed: timing.frozenElapsed)
    XCTAssertNotEqual(sourcePixels, heldAdvanced, "reduced motion must keep submitted bodies alive")
    XCTAssertEqual(heldAdvanced, advancedAtHeldPhase, "reduced motion must hold only the decorative phase")

    timing.setReducedMotion(false)
    let released = try fixture.render(
      input: advanced,
      elapsed: timing.presentationElapsed(for: Float(advanced.elapsed)),
      reducedMotion: timing.reducedMotion,
      frozenElapsed: timing.frozenElapsed
    )
    let living = try fixture.render(
      input: advanced,
      elapsed: timing.presentationElapsed(for: Float(advanced.elapsed + 18))
    )
    XCTAssertEqual(heldAdvanced, released, "leaving reduced motion must resume from the held phase")
    XCTAssertNotEqual(released, living, "leaving reduced motion must restore the living celestial material")
  }

  func testSolarPackerRejectsMalformedAndOversizedSnapshots() throws {
    let source = input(representation: 0)
    let sourceBody = source.bodies[0]
    let untrailed = body(
      id: sourceBody.id,
      seed: sourceBody.materialSeed,
      kind: sourceBody.kind,
      previous: sourceBody.previousPosition,
      position: sourceBody.position,
      velocity: sourceBody.velocity,
      mass: sourceBody.mass,
      radius: sourceBody.radius,
      color: sourceBody.color,
      trailOffset: 0,
      trailCount: 0,
      selected: sourceBody.isSelected
    )
    let malformed = SolarRenderBody(
      id: 999,
      materialSeed: 1,
      kind: .planet,
      previousPosition: SIMD3<Float>(.nan, 0, 0),
      position: SIMD3<Float>(0, 0, 0),
      velocity: .zero,
      mass: 0.01,
      radius: 0.04,
      color: SIMD3<Float>(0.5, 0.6, 0.7),
      trailOffset: 0,
      trailCount: 0,
      isSelected: false
    )
    let invalidTrailRange = body(
      id: sourceBody.id,
      seed: sourceBody.materialSeed,
      kind: sourceBody.kind,
      previous: sourceBody.previousPosition,
      position: sourceBody.position,
      velocity: sourceBody.velocity,
      mass: sourceBody.mass,
      radius: sourceBody.radius,
      color: sourceBody.color,
      trailOffset: source.trail.count,
      trailCount: 1,
      selected: sourceBody.isSelected
    )
    let oversized = replacing(
      source,
      bodies: Array(repeating: untrailed, count: SolarPhysics.maxBodies + 1),
      trail: []
    )
    XCTAssertTrue(SolarRenderer.acceptsSnapshot(
      bodyCount: source.bodies.count,
      trailCount: source.trail.count,
      predictionCount: source.prediction.count
    ))
    XCTAssertFalse(SolarRenderer.acceptsSnapshot(
      bodyCount: SolarPhysics.maxBodies + 1,
      trailCount: 0,
      predictionCount: 0
    ))
    XCTAssertFalse(SolarRenderer.acceptsSnapshot(
      bodyCount: 0,
      trailCount: SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody + 1,
      predictionCount: 0
    ))
    XCTAssertFalse(SolarRenderer.acceptsSnapshot(
      bodyCount: 0,
      trailCount: 0,
      predictionCount: SolarPhysics.predictionSampleCount + 1
    ))
    XCTAssertNil(pack(oversized))

    let rejected: [(String, Input)] = [
      ("non-finite body", replacing(source, bodies: [malformed], trail: [], prediction: [])),
      ("negative tick duration", replacing(source, secondsPerTick: -0.01)),
      ("non-finite preview", replacing(source, preview: SolarAccretionPreview(
        position: SIMD3<Float>(0.3, -0.2, 0),
        radius: 0.04,
        color: SIMD3<Float>(0.4, 0.6, 0.8),
        progress: .nan
      ))),
      ("invalid trail range", replacing(source, bodies: [invalidTrailRange])),
      ("non-finite trail", replacing(
        source,
        bodies: [untrailed],
        trail: [SolarTrailPoint(bodyID: untrailed.id, position: SIMD3<Float>(.nan, 0, 0), age: 0)],
        prediction: []
      )),
      ("non-finite prediction", replacing(
        source,
        bodies: [untrailed],
        trail: [],
        prediction: [SolarPredictionPoint(bodyID: untrailed.id, position: SIMD3<Float>(.nan, 0, 0))]
      )),
    ]
    for (name, rejectedInput) in rejected {
      XCTAssertNil(pack(rejectedInput), "\(name) must not reach fixed GPU storage")
    }

    let outOfRangeRepresentation = replacing(source, representation: 99)
    let outOfRangeUpload = try XCTUnwrap(pack(outOfRangeRepresentation))
    let outOfRangeUniforms = outOfRangeRepresentation.withSnapshot {
      SolarRenderer.makeUniforms(for: $0, upload: outOfRangeUpload)
    }
    XCTAssertEqual(outOfRangeUniforms.representation, 3, "the renderer must keep its representation lanes bounded")
  }

  func testBackgroundShaderDoesNotLoopOverBodiesPerFragment() {
    let source = SolarShaderSource.metal
    let background = source
      .components(separatedBy: "fragment float4 objet_solar_background_fragment")[1]
      .components(separatedBy: "vertex OrbitOut objet_solar_orbit_vertex")[0]
    XCTAssertFalse(background.contains("u.bodyCount"))
    XCTAssertTrue(background.contains("granulation"))
    XCTAssertTrue(background.contains("starLayer"))
  }

  private func pack(_ input: Input) -> SolarGPUUpload? {
    var bodies = [SolarGPUBody](repeating: .init(), count: SolarPhysics.maxBodies)
    var preview = [SolarGPUBody](repeating: .init(), count: 1)
    var trails = [SolarGPUMark](
      repeating: .init(),
      count: SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody
    )
    var prediction = [SolarGPUMark](repeating: .init(), count: SolarPhysics.predictionSampleCount)
    var pathOffsets = [Int](repeating: 0, count: SolarPhysics.maxBodies)
    var pathCounts = [Int](repeating: 0, count: SolarPhysics.maxBodies)
    return input.withSnapshot { snapshot in
      bodies.withUnsafeMutableBufferPointer { bodies in
        preview.withUnsafeMutableBufferPointer { preview in
          trails.withUnsafeMutableBufferPointer { trails in
            prediction.withUnsafeMutableBufferPointer { prediction in
              SolarRenderer.pack(
                snapshot,
                bodies: bodies,
                preview: preview,
                trails: trails,
                prediction: prediction,
                pathOffsets: &pathOffsets,
                pathCounts: &pathCounts
              )
            }
          }
        }
      }
    }
  }

  private func advancedInput(from source: Input) -> Input {
    let translation = SIMD3<Float>(0.28, -0.21, 0.03)
    let bodies = source.bodies.map { sourceBody in
      SolarRenderBody(
        id: sourceBody.id,
        materialSeed: sourceBody.materialSeed,
        kind: sourceBody.kind,
        previousPosition: sourceBody.previousPosition + translation,
        position: sourceBody.position + translation,
        velocity: sourceBody.velocity,
        mass: sourceBody.mass,
        radius: sourceBody.radius,
        color: sourceBody.color,
        trailOffset: sourceBody.trailOffset,
        trailCount: sourceBody.trailCount,
        isSelected: sourceBody.isSelected
      )
    }
    let preview = source.preview.map {
      SolarAccretionPreview(
        position: $0.position + translation,
        radius: $0.radius,
        color: $0.color,
        progress: $0.progress
      )
    }
    return Input(
      elapsed: source.elapsed + 18,
      secondsPerTick: source.secondsPerTick,
      centralMass: source.centralMass,
      representation: source.representation,
      collisionPulse: source.collisionPulse,
      collisionPosition: source.collisionPosition + translation,
      touchPulse: source.touchPulse,
      touchPosition: source.touchPosition + translation,
      touchKind: source.touchKind,
      preview: preview,
      bodies: bodies,
      trail: source.trail.map { SolarTrailPoint(bodyID: $0.bodyID, position: $0.position + translation, age: $0.age) },
      prediction: source.prediction.map { SolarPredictionPoint(bodyID: $0.bodyID, position: $0.position + translation) }
    )
  }

  private func replacing(
    _ source: Input,
    elapsed: Double? = nil,
    secondsPerTick: Double? = nil,
    representation: Int? = nil,
    collisionPosition: SIMD3<Float>? = nil,
    touchPosition: SIMD3<Float>? = nil,
    preview: SolarAccretionPreview? = nil,
    bodies: [SolarRenderBody]? = nil,
    trail: [SolarTrailPoint]? = nil,
    prediction: [SolarPredictionPoint]? = nil
  ) -> Input {
    Input(
      elapsed: elapsed ?? source.elapsed,
      secondsPerTick: secondsPerTick ?? source.secondsPerTick,
      centralMass: source.centralMass,
      representation: representation ?? source.representation,
      collisionPulse: source.collisionPulse,
      collisionPosition: collisionPosition ?? source.collisionPosition,
      touchPulse: source.touchPulse,
      touchPosition: touchPosition ?? source.touchPosition,
      touchKind: source.touchKind,
      preview: preview ?? source.preview,
      bodies: bodies ?? source.bodies,
      trail: trail ?? source.trail,
      prediction: prediction ?? source.prediction
    )
  }

  private func input(representation: Int) -> Input {
    let bodies = [
      body(
        id: 1,
        seed: 0x20A1_CE71,
        kind: .planet,
        previous: SIMD3<Float>(0.56, 0.08, 0),
        position: SIMD3<Float>(0.70, 0.16, 0),
        velocity: SIMD2<Float>(-0.16, 0.58),
        mass: 0.022,
        radius: 0.078,
        color: SIMD3<Float>(0.34, 0.61, 0.88),
        trailOffset: 0,
        trailCount: 4,
        selected: true
      ),
      body(
        id: 2,
        seed: 0x5522_7BC9,
        kind: .planet,
        previous: SIMD3<Float>(-1.18, -0.34, 0.04),
        position: SIMD3<Float>(-1.06, -0.26, 0.04),
        velocity: SIMD2<Float>(0.31, -0.44),
        mass: 0.011,
        radius: 0.056,
        color: SIMD3<Float>(0.78, 0.47, 0.28),
        trailOffset: 4,
        trailCount: 4,
        selected: false
      ),
      body(
        id: 3,
        seed: 0x903E_C4D1,
        kind: .comet,
        previous: SIMD3<Float>(-0.40, 0.77, -0.02),
        position: SIMD3<Float>(-0.31, 0.69, -0.02),
        velocity: SIMD2<Float>(0.49, -0.31),
        mass: 0.004,
        radius: 0.040,
        color: SIMD3<Float>(0.56, 0.83, 0.77),
        trailOffset: 8,
        trailCount: 4,
        selected: false
      ),
      body(
        id: 4,
        seed: 0xD14A_92E3,
        kind: .planet,
        previous: SIMD3<Float>(1.33, -0.68, -0.07),
        position: SIMD3<Float>(1.22, -0.58, -0.07),
        velocity: SIMD2<Float>(-0.23, 0.39),
        mass: 0.016,
        radius: 0.066,
        color: SIMD3<Float>(0.66, 0.58, 0.90),
        trailOffset: 12,
        trailCount: 4,
        selected: false
      ),
    ]
    let trail = [
      mark(1, SIMD3<Float>(0.34, -0.02, 0), 1), mark(1, SIMD3<Float>(0.44, 0.02, 0), 0.67),
      mark(1, SIMD3<Float>(0.56, 0.08, 0), 0.34), mark(1, SIMD3<Float>(0.70, 0.16, 0), 0),
      mark(2, SIMD3<Float>(-1.40, -0.52, 0.04), 1), mark(2, SIMD3<Float>(-1.31, -0.45, 0.04), 0.67),
      mark(2, SIMD3<Float>(-1.18, -0.34, 0.04), 0.34), mark(2, SIMD3<Float>(-1.06, -0.26, 0.04), 0),
      mark(3, SIMD3<Float>(-0.70, 0.96, -0.02), 1), mark(3, SIMD3<Float>(-0.58, 0.89, -0.02), 0.67),
      mark(3, SIMD3<Float>(-0.40, 0.77, -0.02), 0.34), mark(3, SIMD3<Float>(-0.31, 0.69, -0.02), 0),
      mark(4, SIMD3<Float>(1.53, -0.91, -0.07), 1), mark(4, SIMD3<Float>(1.43, -0.82, -0.07), 0.67),
      mark(4, SIMD3<Float>(1.33, -0.68, -0.07), 0.34), mark(4, SIMD3<Float>(1.22, -0.58, -0.07), 0),
    ]
    let prediction = [
      SolarPredictionPoint(bodyID: 1, position: SIMD3<Float>(0.84, 0.24, 0)),
      SolarPredictionPoint(bodyID: 1, position: SIMD3<Float>(0.98, 0.30, 0)),
      SolarPredictionPoint(bodyID: 1, position: SIMD3<Float>(1.12, 0.34, 0)),
    ]
    return Input(
      elapsed: 13.7,
      secondsPerTick: 1.0 / 60.0,
      centralMass: 1.2,
      representation: representation,
      collisionPulse: 0.82,
      collisionPosition: SIMD3<Float>(0.44, -0.46, 0),
      touchPulse: 0.72,
      touchPosition: SIMD3<Float>(-0.34, 0.39, 0),
      touchKind: .dust,
      preview: SolarAccretionPreview(
        position: SIMD3<Float>(-0.48, 0.58, 0),
        radius: 0.08,
        color: SIMD3<Float>(0.54, 0.73, 0.64),
        progress: 0.72
      ),
      bodies: bodies,
      trail: trail,
      prediction: prediction
    )
  }

  private func body(
    id: UInt64,
    seed: UInt32,
    kind: SolarBodyKind,
    previous: SIMD3<Float>,
    position: SIMD3<Float>,
    velocity: SIMD2<Float>,
    mass: Float,
    radius: Float,
    color: SIMD3<Float>,
    trailOffset: Int,
    trailCount: Int,
    selected: Bool
  ) -> SolarRenderBody {
    SolarRenderBody(
      id: id,
      materialSeed: seed,
      kind: kind,
      previousPosition: previous,
      position: position,
      velocity: velocity,
      mass: mass,
      radius: radius,
      color: color,
      trailOffset: trailOffset,
      trailCount: trailCount,
      isSelected: selected
    )
  }

  private func mark(_ bodyID: UInt64, _ position: SIMD3<Float>, _ age: Float) -> SolarTrailPoint {
    SolarTrailPoint(bodyID: bodyID, position: position, age: age)
  }

  private func metalDevice() throws -> MTLDevice {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal; skipping would remove the solar visibility gate")
        throw NSError(domain: "ObjetUniverse", code: 1)
      }
      throw XCTSkip("local host exposes no Metal device; Native CI remains the mandatory shader gate")
    }
    return device
  }

  private func assertReadable(_ pixels: [UInt8], register: Int) {
    var sum = 0.0
    var sumOfSquares = 0.0
    var brightCount = 0
    var darkCount = 0
    let pixelCount = pixels.count / 4
    for index in stride(from: 0, to: pixels.count, by: 4) {
      let luminance = 0.0722 * Double(pixels[index]) / 255
        + 0.7152 * Double(pixels[index + 1]) / 255
        + 0.2126 * Double(pixels[index + 2]) / 255
      sum += luminance
      sumOfSquares += luminance * luminance
      if luminance > 0.13 { brightCount += 1 }
      if luminance < 0.10 { darkCount += 1 }
    }
    let mean = sum / Double(pixelCount)
    let variance = sumOfSquares / Double(pixelCount) - mean * mean
    let brightFraction = Double(brightCount) / Double(pixelCount)
    let darkFraction = Double(darkCount) / Double(pixelCount)
    let description = "mean \(mean), variance \(variance), bright \(brightFraction), dark \(darkFraction)"
    XCTAssertGreaterThan(mean, 0.012, "solar register \(register) must stay visible above night; \(description)")
    XCTAssertGreaterThan(variance, 0.00008, "solar register \(register) must contain readable celestial structure; \(description)")
    XCTAssertGreaterThan(brightFraction, 0.0010, "solar register \(register) must occupy visible phone pixels; \(description)")
    XCTAssertGreaterThan(darkFraction, 0.22, "solar register \(register) must retain dark breathing space; \(description)")
  }

  private func assertMaterialDifference(
    _ first: [UInt8],
    _ second: [UInt8],
    firstRegister: Int,
    secondRegister: Int,
    minimumChangedFraction: Double = 0.0025,
    minimumMeanDelta: Double = 0.0008
  ) {
    XCTAssertEqual(first.count, second.count)
    var changedPixels = 0
    var totalDelta = 0
    for index in stride(from: 0, to: first.count, by: 4) {
      let delta = abs(Int(first[index]) - Int(second[index]))
        + abs(Int(first[index + 1]) - Int(second[index + 1]))
        + abs(Int(first[index + 2]) - Int(second[index + 2]))
      totalDelta += delta
      if delta > 8 { changedPixels += 1 }
    }
    let pixelCount = Double(first.count / 4)
    let changedFraction = Double(changedPixels) / pixelCount
    let meanDelta = Double(totalDelta) / (Double(first.count) * 255)
    let description = "changed \(changedFraction), mean delta \(meanDelta)"
    XCTAssertGreaterThan(changedFraction, minimumChangedFraction, "solar materials \(firstRegister) and \(secondRegister) must visibly differ; \(description)")
    XCTAssertGreaterThan(meanDelta, minimumMeanDelta, "solar materials \(firstRegister) and \(secondRegister) must differ beyond a tint nudge; \(description)")
  }
}
#else
import XCTest

final class SolarMetalAvailabilityTests: XCTestCase {
  func testNativeCIMustExposeMetal() throws {
    if ProcessInfo.processInfo.environment["CI"] == "true" {
      XCTFail("Native CI must compile and execute the solar Metal visibility gate")
      return
    }
    throw XCTSkip("this non-native local host does not expose Metal")
  }
}
#endif
