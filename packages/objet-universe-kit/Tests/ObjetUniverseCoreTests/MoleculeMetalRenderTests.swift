#if canImport(Metal)
import Metal
#if canImport(QuartzCore)
import QuartzCore
#endif
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Phone-scale visibility tests for the molecule instrument. They execute the
/// shipping shader and packer, making a generic field fallback or an inert
/// register a failing native test rather than a subjective release surprise.
final class MoleculeMetalRenderTests: XCTestCase {
  private static let outputWidth = 780
  private static let outputHeight = 1_688

  private struct Input {
    let elapsed: Double
    let secondsPerTick: Double
    let representation: Int
    let reactionEnergy: Float
    let bodies: [MoleculeRenderBody]

    func withSnapshot<T>(_ body: (MoleculeRenderSnapshot) throws -> T) rethrows -> T {
      try bodies.withUnsafeBufferPointer { bodies in
        try body(MoleculeRenderSnapshot(
          tick: 0,
          elapsedSeconds: elapsed,
          secondsPerTick: secondsPerTick,
          representation: representation,
          reactionEnergy: reactionEnergy,
          bodies: bodies
        ))
      }
    }
  }

  private final class Fixture {
    private let background: MTLRenderPipelineState
    private let body: MTLRenderPipelineState
    private let uniforms: MTLBuffer
    private let bodies: MTLBuffer
    private let output: MTLTexture
    private let pass = MTLRenderPassDescriptor()
    private let queue: MTLCommandQueue

    init(device: MTLDevice) throws {
      let pipelines = try MoleculePipelineCompiler(device: device).makePipelines(pixelFormat: .bgra8Unorm)
      background = pipelines.background
      body = pipelines.body
      uniforms = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<MoleculeShaderUniforms>.stride,
        options: .storageModeShared
      ))
      bodies = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<MoleculeGPUBody>.stride * MoleculeKernel.maximumMolecules,
        options: .storageModeShared
      ))
      let descriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .bgra8Unorm,
        width: MoleculeMetalRenderTests.outputWidth,
        height: MoleculeMetalRenderTests.outputHeight,
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
      let destination = UnsafeMutableBufferPointer(
        start: bodies.contents().bindMemory(to: MoleculeGPUBody.self, capacity: MoleculeKernel.maximumMolecules),
        count: MoleculeKernel.maximumMolecules
      )
      let bodyCount = try input.withSnapshot { snapshot in
        try XCTUnwrap(MoleculeRenderer.pack(snapshot, bodies: destination))
      }
      var state = input.withSnapshot(MoleculeRenderer.makeUniforms)
      state.viewport = SIMD2<Float>(
        Float(MoleculeMetalRenderTests.outputWidth),
        Float(MoleculeMetalRenderTests.outputHeight)
      )
      state.elapsed = elapsed ?? Float(input.elapsed)
      state.frozenElapsed = frozenElapsed ?? state.elapsed
      state.reactionEnergy = input.reactionEnergy
      state.representation = UInt32(clamping: input.representation)
      state.reducedMotion = reducedMotion ? 1 : 0
      memcpy(uniforms.contents(), &state, MemoryLayout<MoleculeShaderUniforms>.stride)

      let command = try XCTUnwrap(queue.makeCommandBuffer())
      let encoder = try XCTUnwrap(command.makeRenderCommandEncoder(descriptor: pass))
      encoder.setRenderPipelineState(background)
      encoder.setFragmentBuffer(uniforms, offset: 0, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      if bodyCount > 0 {
        encoder.setRenderPipelineState(body)
        encoder.setVertexBuffer(bodies, offset: 0, index: 0)
        encoder.setVertexBuffer(uniforms, offset: 0, index: 1)
        encoder.setFragmentBuffer(uniforms, offset: 0, index: 0)
        encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: bodyCount)
      }
      encoder.endEncoding()
      command.commit()
      command.waitUntilCompleted()
      XCTAssertEqual(command.status, .completed)
      XCTAssertNil(command.error)

      var pixels = [UInt8](
        repeating: 0,
        count: MoleculeMetalRenderTests.outputWidth * MoleculeMetalRenderTests.outputHeight * 4
      )
      output.getBytes(
        &pixels,
        bytesPerRow: MoleculeMetalRenderTests.outputWidth * 4,
        from: MTLRegionMake2D(0, 0, MoleculeMetalRenderTests.outputWidth, MoleculeMetalRenderTests.outputHeight),
        mipmapLevel: 0
      )
      return pixels
    }

  }

  func testMolecularReadingsRenderAsDistinctReadablePhoneScaleMaterials() throws {
    let molecule = activeMolecule()
    let fixture = try Fixture(device: metalDevice())
    var images: [[UInt8]] = []
    for representation in 0 ... 3 {
      molecule.setRepresentation(representation)
      let image = try fixture.render(input: input(for: molecule, reactionEnergy: representation == 2 ? 890 : 0))
      assertReadable(image, register: representation)
      images.append(image)
    }
    for first in 0 ..< images.count {
      for second in (first + 1) ..< images.count {
        assertMaterialDifference(images[first], images[second], firstRegister: first, secondRegister: second)
      }
    }
  }

  func testMolecularMaterialIsDeterministicAndCarriesMultipleRealGeometryFamilies() throws {
    let molecule = activeMolecule()
    molecule.setRepresentation(1)
    let input = input(for: molecule)
    XCTAssertGreaterThan(
      Set(input.bodies.map(\.shape)).count,
      3,
      "the material fixture must exercise the bounded compound register, not one repeated decal"
    )
    let fixture = try Fixture(device: metalDevice())
    let first = try fixture.render(input: input)
    let second = try fixture.render(input: input)
    XCTAssertEqual(first, second, "the same molecule snapshot must render byte-for-byte deterministically")
    assertReadable(first, register: 1)
  }

  func testReducedMotionHoldsDecorativeMoleculePhaseWithoutFreezingAuthority() throws {
    let molecule = activeMolecule()
    molecule.setRepresentation(3)
    let input = input(for: molecule)
    let fixture = try Fixture(device: metalDevice())
    let held = try fixture.render(input: input, elapsed: 2, reducedMotion: true, frozenElapsed: 2)
    let sourceAdvanced = try fixture.render(input: input, elapsed: 29, reducedMotion: true, frozenElapsed: 2)
    let animated = try fixture.render(input: input, elapsed: 29, reducedMotion: false, frozenElapsed: 2)
    XCTAssertEqual(held, sourceAdvanced, "reduced motion must keep molecule vibration at a readable detent")
    XCTAssertNotEqual(held, animated, "leaving the detent must restore the living molecular material")
  }

  func testH2MetalProjectionCopiesDensityAndBoundsFixedUniformLanes() {
    var uniforms = MoleculeShaderUniforms()
    let snapshot = MoleculeH2MetalSnapshot(
      bodyID: 0x12_34_56_78,
      candidateDensity: SIMD4<Float>(0.81, -0.22, -0.22, 0.34),
      lastGoodDensity: SIMD4<Float>(0.62, -0.10, -0.10, 0.58),
      residual: 4.0,
      tension: 2.0,
      footprint: -1.0,
      phase: 2.0,
      fieldStrength: 1.4,
      separation: 2.0,
      disposition: .correcting,
      promotionGeneration: 7,
      active: true
    )

    XCTAssertTrue(MoleculeRenderer.packH2(snapshot, into: &uniforms))
    XCTAssertEqual(uniforms.h2Density, SIMD4<Float>(0.81, -0.22, -0.22, 0.34))
    XCTAssertEqual(uniforms.h2Projection, SIMD4<Float>(1, 1, 0, 1))
    XCTAssertEqual(uniforms.h2Presentation, SIMD4<Float>(1, 0.5, 1, 0))
    XCTAssertEqual(uniforms.h2Meta, SIMD4<UInt32>(1, 7, 0x1234_5678, 0))
  }

  func testH2RefusalRendersOnlyLastGoodAndNeverInfersPromotion() {
    var refused = MoleculeShaderUniforms()
    let refusal = MoleculeH2MetalSnapshot(
      bodyID: 0x12_34_56_78,
      candidateDensity: SIMD4<Float>(9, 9, 9, 9),
      lastGoodDensity: SIMD4<Float>(0.61, -0.07, -0.07, 0.61),
      residual: 0.00000001,
      tension: 0.01,
      footprint: 0.5,
      phase: 0.3,
      fieldStrength: 0.7,
      separation: 0.9,
      disposition: .outsideEnvelope,
      promotionGeneration: 3,
      active: true
    )
    XCTAssertTrue(MoleculeRenderer.packH2(refusal, into: &refused))
    XCTAssertEqual(refused.h2Density, SIMD4<Float>(0.61, -0.07, -0.07, 0.61))
    XCTAssertEqual(refused.h2Meta.x, MoleculeH2MetalSnapshot.Disposition.outsideEnvelope.rawValue)
    XCTAssertEqual(refused.h2Meta.y, 3)

    var provisional = MoleculeShaderUniforms()
    let candidate = MoleculeH2MetalSnapshot(
      bodyID: 0x12_34_56_78,
      candidateDensity: SIMD4<Float>(0.70, -0.20, -0.20, 0.70),
      lastGoodDensity: SIMD4<Float>(0.61, -0.07, -0.07, 0.61),
      residual: 0,
      disposition: .correcting,
      promotionGeneration: 3,
      active: true
    )
    XCTAssertTrue(MoleculeRenderer.packH2(candidate, into: &provisional))
    XCTAssertEqual(provisional.h2Density, SIMD4<Float>(0.70, -0.20, -0.20, 0.70))
    XCTAssertEqual(provisional.h2Meta.x, MoleculeH2MetalSnapshot.Disposition.correcting.rawValue)
    XCTAssertEqual(provisional.h2Meta.y, 3)
    XCTAssertNotEqual(provisional.h2Meta.x, MoleculeH2MetalSnapshot.Disposition.promoted.rawValue)
  }

  func testH2ReducedMotionChangesOnlyPresentationPhaseLane() {
    var animated = MoleculeShaderUniforms()
    var held = MoleculeShaderUniforms()
    let snapshot = MoleculeH2MetalSnapshot(
      bodyID: 0x12_34_56_78,
      candidateDensity: SIMD4<Float>(0.64, -0.12, -0.12, 0.64),
      lastGoodDensity: SIMD4<Float>(0.64, -0.12, -0.12, 0.64),
      residual: 0.03,
      tension: 0.3,
      footprint: 0.6,
      phase: 0.17,
      fieldStrength: 0.8,
      separation: 0.9,
      disposition: .correcting,
      promotionGeneration: 0,
      active: true
    )
    XCTAssertTrue(MoleculeRenderer.packH2(snapshot, into: &animated))
    XCTAssertTrue(MoleculeRenderer.packH2(snapshot, into: &held))
    animated.reducedMotion = 0
    held.reducedMotion = 1
    XCTAssertEqual(animated.h2Density, held.h2Density)
    XCTAssertEqual(animated.h2Projection, held.h2Projection)
    XCTAssertEqual(animated.h2Meta, held.h2Meta)
    XCTAssertEqual(animated.h2Presentation.y, held.h2Presentation.y)
    XCTAssertNotEqual(animated.reducedMotion, held.reducedMotion)
  }

  func testH2MetalShaderConsumesExplicitScientificLanesWithoutASecondCadence() {
    let source = MoleculeShaderSource.metal
    XCTAssertTrue(source.contains("h2Density"))
    XCTAssertTrue(source.contains("h2Projection"))
    XCTAssertTrue(source.contains("h2Meta"))
    XCTAssertTrue(source.contains("u.h2Meta.x >= 4u"))
    XCTAssertFalse(source.contains("requestAnimationFrame"))
    XCTAssertFalse(source.contains("setInterval"))
  }

#if canImport(QuartzCore)
  func testMoleculeRendererContextRestoreRearmsItsPipelineWithoutASecondScheduler() throws {
    guard let device = MTLCreateSystemDefaultDevice() else {
      throw XCTSkip("this local host exposes no Metal device")
    }
    let layer = CAMetalLayer()
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.drawableSize = CGSize(width: 64, height: 64)
    let renderer = try XCTUnwrap(MoleculeRenderer(layer: layer))

    renderer.resume()
    renderer.contextDidBecomeAvailable()
    renderer.suspend()
    renderer.retire()
  }
#endif

  func testCoreH2RecordMapsToMetalByStableBodyIDRatherThanArraySlot() throws {
    let bodyID: UInt64 = 0xABCD_0123_4567_89EF
    let records = [
      MoleculeRenderBody(
        position: SIMD2<Float>(-0.4, 0.1),
        velocity: .zero,
        compoundIndex: 0,
        shape: .bent,
        atomCount: 3,
        vibration: 0.2,
        id: 5
      ),
      MoleculeRenderBody(
        position: SIMD2<Float>(0.2, -0.1),
        velocity: .zero,
        compoundIndex: 6,
        shape: .diatomic,
        atomCount: 2,
        vibration: 0.4,
        id: bodyID
      ),
    ]
    let coreH2 = MoleculeH2RenderSnapshot(
      bodyID: bodyID,
      candidateDensity: SIMD4<Float>(0.7, -0.2, -0.2, 0.7),
      lastGoodDensity: SIMD4<Float>(0.6, -0.1, -0.1, 0.6),
      residual: 0.02,
      separationAngstrom: 0.9,
      disposition: .correcting,
      promotionGeneration: 0,
      active: true
    )

    try records.withUnsafeBufferPointer { bodies in
      let snapshot = MoleculeRenderSnapshot(
        tick: 2,
        elapsedSeconds: 0.1,
        secondsPerTick: 0.05,
        representation: 0,
        reactionEnergy: 0,
        h2: coreH2,
        bodies: bodies
      )
      var uniforms = MoleculeRenderer.makeUniforms(for: snapshot)
      XCTAssertTrue(MoleculeRenderer.packH2(MoleculeH2MetalSnapshot(core: coreH2), into: &uniforms))
      XCTAssertEqual(uniforms.h2Meta.z, UInt32(truncatingIfNeeded: bodyID))
      XCTAssertEqual(uniforms.h2Meta.w, UInt32(truncatingIfNeeded: bodyID >> 32))

      var packed = [MoleculeGPUBody](repeating: MoleculeGPUBody(), count: MoleculeKernel.maximumMolecules)
      let count = try XCTUnwrap(packed.withUnsafeMutableBufferPointer {
        MoleculeRenderer.pack(snapshot, bodies: $0)
      })
      XCTAssertEqual(count, 2)
      XCTAssertEqual(packed[0].stableID.x, 5)
      XCTAssertEqual(packed[1].stableID.x, UInt32(truncatingIfNeeded: bodyID))
      XCTAssertEqual(packed[1].stableID.y, UInt32(truncatingIfNeeded: bodyID >> 32))
    }
  }

  private func activeMolecule() -> MoleculeKernel {
    let molecule = MoleculeKernel(seed: 0xC8E0_2026)
    for index in 0 ..< 5 {
      _ = molecule.apply(.init(id: "molecule-grow-\(index)", verb: .grow, at: Double(index), origin: .centre))
      _ = molecule.apply(.init(id: "molecule-tutti-\(index)", verb: .tutti, at: Double(index)))
    }
    _ = molecule.advance(ticks: 48)
    return molecule
  }

  private func input(for molecule: MoleculeKernel, reactionEnergy: Float? = nil) -> Input {
    molecule.withMoleculeRenderSnapshot { snapshot in
      Input(
        elapsed: snapshot.elapsedSeconds,
        secondsPerTick: snapshot.secondsPerTick,
        representation: snapshot.representation,
        reactionEnergy: reactionEnergy ?? snapshot.reactionEnergy,
        bodies: Array(snapshot.bodies)
      )
    }
  }

  private func metalDevice() throws -> MTLDevice {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal; skipping would remove the molecule visibility gate")
        throw NSError(domain: "ObjetUniverse", code: 1)
      }
      throw XCTSkip("this local host exposes no Metal device; Native CI remains the mandatory shader gate")
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
      if luminance > 0.14 { brightCount += 1 }
      if luminance < 0.12 { darkCount += 1 }
    }
    let mean = sum / Double(pixelCount)
    let variance = sumOfSquares / Double(pixelCount) - mean * mean
    let brightFraction = Double(brightCount) / Double(pixelCount)
    let darkFraction = Double(darkCount) / Double(pixelCount)
    let description = "mean \(mean), variance \(variance), bright \(brightFraction), dark \(darkFraction)"
    XCTAssertGreaterThan(mean, 0.013, "molecule register \(register) must stay visible above night; \(description)")
    XCTAssertGreaterThan(variance, 0.00004, "molecule register \(register) must contain readable compound structure; \(description)")
    XCTAssertGreaterThan(brightFraction, 0.0010, "molecule register \(register) must occupy visible phone pixels; \(description)")
    XCTAssertGreaterThan(darkFraction, 0.30, "molecule register \(register) must retain dark breathing space; \(description)")
  }

  private func assertMaterialDifference(
    _ first: [UInt8],
    _ second: [UInt8],
    firstRegister: Int,
    secondRegister: Int
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
    XCTAssertGreaterThan(changedFraction, 0.003, "molecule registers \(firstRegister) and \(secondRegister) must change material; \(description)")
    XCTAssertGreaterThan(meanDelta, 0.0012, "molecule registers \(firstRegister) and \(secondRegister) must have a visible composition difference; \(description)")
  }
}
#endif
