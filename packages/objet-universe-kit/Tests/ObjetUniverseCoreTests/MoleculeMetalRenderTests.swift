#if canImport(Metal)
import Metal
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
