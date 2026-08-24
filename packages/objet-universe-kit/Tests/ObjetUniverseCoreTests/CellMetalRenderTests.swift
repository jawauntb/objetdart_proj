#if canImport(Metal)
import Foundation
import Metal
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Compiles and executes the dedicated cell material against the authoritative
/// reaction--diffusion field. This is a visual baseline, not a renderer
/// snapshot: it proves the colony stays deterministic, legible above night,
/// and materially different across its lenses.
final class CellMetalRenderTests: XCTestCase {
  private static let outputWidth = 390
  private static let outputHeight = 844

  private final class Fixture {
    private let pipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private let field: MTLTexture
    private let output: MTLTexture
    private let pass = MTLRenderPassDescriptor()
    private let queue: MTLCommandQueue

    init(kernel: CellKernel, device: MTLDevice) throws {
      let library = try MetalPipelineCache.shared.library(
        namespace: "cell-v1",
        device: device,
        source: CellShaderSource.metal
      )
      pipeline = try MetalPipelineCache.shared.pipeline(
        namespace: "cell-v1",
        device: device,
        pixelFormat: .bgra8Unorm
      ) {
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "objet_cell_vertex")
        descriptor.fragmentFunction = library.makeFunction(name: "objet_cell_fragment")
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        return try device.makeRenderPipelineState(descriptor: descriptor)
      }

      let samplerDescriptor = MTLSamplerDescriptor()
      samplerDescriptor.minFilter = .linear
      samplerDescriptor.magFilter = .linear
      samplerDescriptor.sAddressMode = .clampToEdge
      samplerDescriptor.tAddressMode = .clampToEdge
      sampler = try XCTUnwrap(device.makeSamplerState(descriptor: samplerDescriptor))

      let fieldDescriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .r32Float,
        width: kernel.width,
        height: kernel.height,
        mipmapped: false
      )
      fieldDescriptor.storageMode = .shared
      fieldDescriptor.usage = .shaderRead
      field = try XCTUnwrap(device.makeTexture(descriptor: fieldDescriptor))

      let outputDescriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .bgra8Unorm,
        width: CellMetalRenderTests.outputWidth,
        height: CellMetalRenderTests.outputHeight,
        mipmapped: false
      )
      outputDescriptor.storageMode = .shared
      outputDescriptor.usage = .renderTarget
      output = try XCTUnwrap(device.makeTexture(descriptor: outputDescriptor))

      pass.colorAttachments[0].texture = output
      pass.colorAttachments[0].loadAction = .clear
      pass.colorAttachments[0].storeAction = .store
      pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
      queue = try XCTUnwrap(device.makeCommandQueue())
    }

    func render(
      kernel: CellKernel,
      shaderRepresentation: Int? = nil,
      elapsed: Float? = nil,
      reducedMotion: Bool = false,
      frozenElapsed: Float? = nil
    ) throws -> [UInt8] {
      kernel.withSurface { values, width, height in
        field.replace(
          region: MTLRegionMake2D(0, 0, width, height),
          mipmapLevel: 0,
          withBytes: values,
          bytesPerRow: width * MemoryLayout<Float>.stride
        )
      }

      let command = try XCTUnwrap(queue.makeCommandBuffer())
      let encoder = try XCTUnwrap(command.makeRenderCommandEncoder(descriptor: pass))
      var uniforms = CellShaderUniforms()
      uniforms.viewport = SIMD2<Float>(
        Float(CellMetalRenderTests.outputWidth),
        Float(CellMetalRenderTests.outputHeight)
      )
      uniforms.fieldSize = SIMD2<Float>(Float(kernel.width), Float(kernel.height))
      uniforms.elapsed = elapsed ?? Float(kernel.elapsedSeconds)
      uniforms.exposure = Float(kernel.exposure)
      uniforms.representation = UInt32(shaderRepresentation ?? kernel.representationIndex)
      uniforms.reducedMotion = reducedMotion ? 1 : 0
      uniforms.frozenElapsed = frozenElapsed ?? uniforms.elapsed
      encoder.setRenderPipelineState(pipeline)
      encoder.setFragmentTexture(field, index: 0)
      encoder.setFragmentSamplerState(sampler, index: 0)
      encoder.setFragmentBytes(&uniforms, length: MemoryLayout<CellShaderUniforms>.stride, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      encoder.endEncoding()
      command.commit()
      command.waitUntilCompleted()
      XCTAssertEqual(command.status, .completed)
      XCTAssertNil(command.error)

      var bytes = [UInt8](
        repeating: 0,
        count: CellMetalRenderTests.outputWidth * CellMetalRenderTests.outputHeight * 4
      )
      output.getBytes(
        &bytes,
        bytesPerRow: CellMetalRenderTests.outputWidth * 4,
        from: MTLRegionMake2D(
          0,
          0,
          CellMetalRenderTests.outputWidth,
          CellMetalRenderTests.outputHeight
        ),
        mipmapLevel: 0
      )
      return bytes
    }
  }

  func testRestingColonyCompilesAndRendersDeterministicMembraneStructureOffscreen() throws {
    let kernel = CellKernel(seed: 0xC311_C011)
    _ = kernel.advance(ticks: 900)
    let fixture = try Fixture(kernel: kernel, device: metalDevice())

    let first = try fixture.render(kernel: kernel)
    let second = try fixture.render(kernel: kernel)
    XCTAssertEqual(first, second, "the same colony state must render byte-for-byte deterministically")

    assertReadable(first, lens: 0)
  }

  func testCellLensShadersProduceDistinctMaterialReadings() throws {
    let kernel = CellKernel(seed: 0xC311_C011)
    _ = kernel.advance(ticks: 900)
    let fixture = try Fixture(kernel: kernel, device: metalDevice())

    let images = try (0 ... 3).map { representation -> [UInt8] in
      kernel.setRepresentation(representation)
      return try fixture.render(kernel: kernel)
    }
    for first in 0 ..< images.count {
      for second in (first + 1) ..< images.count {
        assertMaterialDifference(
          images[first],
          images[second],
          firstLens: first,
          secondLens: second
        )
      }
    }
  }

  func testEveryCellLensRetainsDarkStructuredMaterialAtDeviceScale() throws {
    let kernel = CellKernel(seed: 0xC311_C011)
    _ = kernel.advance(ticks: 900)
    let fixture = try Fixture(kernel: kernel, device: metalDevice())

    for representation in 0 ... 3 {
      kernel.setRepresentation(representation)
      assertReadable(try fixture.render(kernel: kernel), lens: representation)
    }
  }

  func testReducedMotionDetentsComposedCellLensesWithoutAReleaseSnap() throws {
    for representation in [2, 3] {
      let kernel = CellKernel(seed: 0xC311_C011)
      _ = kernel.advance(ticks: 900)
      kernel.setRepresentation(representation)
      let fixture = try Fixture(kernel: kernel, device: metalDevice())
      var timing = CellBreathTiming()

      let initialElapsed = Float(kernel.elapsedSeconds)
      let immediatelyBeforeToggle = try fixture.render(
        kernel: kernel,
        elapsed: timing.presentationElapsed(for: initialElapsed)
      )
      kernel.setReducedMotion(true)
      timing.setReducedMotion(true)
      let detentAtToggle = try fixture.render(
        kernel: kernel,
        elapsed: timing.presentationElapsed(for: initialElapsed),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )

      // The reaction stays alive while both decorative phase registers hold.
      _ = kernel.advance(ticks: 1_800)
      let heldElapsed = Float(kernel.elapsedSeconds)
      let immediatelyBeforeRelease = try fixture.render(
        kernel: kernel,
        elapsed: timing.presentationElapsed(for: heldElapsed),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )
      kernel.setReducedMotion(false)
      timing.setReducedMotion(false)
      let immediatelyAfterRelease = try fixture.render(
        kernel: kernel,
        elapsed: timing.presentationElapsed(for: heldElapsed),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )

      _ = kernel.advance(ticks: 240)
      let animatedLater = try fixture.render(
        kernel: kernel,
        elapsed: timing.presentationElapsed(for: Float(kernel.elapsedSeconds)),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )

      XCTAssertEqual(
        immediatelyBeforeToggle,
        detentAtToggle,
        "lens \(representation) must not step when reduced motion begins"
      )
      XCTAssertEqual(
        immediatelyBeforeRelease,
        immediatelyAfterRelease,
        "lens \(representation) must resume from its held kernel and shader phases"
      )
      XCTAssertNotEqual(
        immediatelyBeforeRelease,
        animatedLater,
        "lens \(representation) must resume ordinary, living motion after the detent"
      )
      assertReadable(immediatelyBeforeRelease, lens: representation)
    }
  }

  func testReducedMotionCanBeginBeforeTheFirstCellFrameWithoutASnapOnRelease() throws {
    let kernel = CellKernel(seed: 0xC311_C011)
    _ = kernel.advance(ticks: 900)
    let fixture = try Fixture(kernel: kernel, device: metalDevice())
    var timing = CellBreathTiming()

    timing.setReducedMotion(true)
    let held = try fixture.render(
      kernel: kernel,
      elapsed: timing.presentationElapsed(for: Float(kernel.elapsedSeconds)),
      reducedMotion: timing.reducedMotion,
      frozenElapsed: timing.frozenElapsed
    )
    timing.setReducedMotion(false)
    let resumed = try fixture.render(
      kernel: kernel,
      elapsed: timing.presentationElapsed(for: Float(kernel.elapsedSeconds)),
      reducedMotion: timing.reducedMotion,
      frozenElapsed: timing.frozenElapsed
    )

    XCTAssertEqual(held, resumed, "a pre-first-frame detent must resume from the same breath phase")
  }

  private func metalDevice() throws -> MTLDevice {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal; skipping would remove the cell visibility gate")
        throw NSError(domain: "ObjetUniverse", code: 1)
      }
      throw XCTSkip("this local host exposes no Metal device; Native CI remains the mandatory shader gate")
    }
    return device
  }

  private func luminance(of pixels: [UInt8]) -> [Double] {
    stride(from: 0, to: pixels.count, by: 4).map { index in
      let blue = Double(pixels[index]) / 255
      let green = Double(pixels[index + 1]) / 255
      let red = Double(pixels[index + 2]) / 255
      return 0.0722 * blue + 0.7152 * green + 0.2126 * red
    }
  }

  private func assertReadable(_ pixels: [UInt8], lens: Int) {
    let luminance = luminance(of: pixels)
    let mean = luminance.reduce(0, +) / Double(luminance.count)
    let variance = luminance.reduce(0) { sum, value in
      let delta = value - mean
      return sum + delta * delta
    } / Double(luminance.count)
    let brightFraction = Double(luminance.filter { $0 > 0.18 }.count) / Double(luminance.count)
    let darkFraction = Double(luminance.filter { $0 < 0.12 }.count) / Double(luminance.count)
    let range = "mean \(mean), min \(luminance.min() ?? 0), max \(luminance.max() ?? 0), bright \(brightFraction), dark \(darkFraction)"

    XCTAssertGreaterThan(mean, 0.025, "cell lens \(lens) must remain visible above night; \(range)")
    XCTAssertGreaterThan(variance, 0.00045, "cell lens \(lens) must retain legible spatial structure; \(range)")
    XCTAssertGreaterThan(brightFraction, 0.008, "cell lens \(lens) must occupy a visible portion of the frame; \(range)")
    XCTAssertGreaterThan(darkFraction, 0.12, "cell lens \(lens) must retain dark nutrient space; \(range)")
  }

  private func assertMaterialDifference(
    _ first: [UInt8],
    _ second: [UInt8],
    firstLens: Int,
    secondLens: Int
  ) {
    XCTAssertEqual(first.count, second.count)
    var visiblyChangedPixels = 0
    var totalChannelDelta = 0
    for index in stride(from: 0, to: first.count, by: 4) {
      let delta = abs(Int(first[index]) - Int(second[index]))
        + abs(Int(first[index + 1]) - Int(second[index + 1]))
        + abs(Int(first[index + 2]) - Int(second[index + 2]))
      totalChannelDelta += delta
      if delta > 6 { visiblyChangedPixels += 1 }
    }

    let pixelCount = Double(first.count / 4)
    let changedFraction = Double(visiblyChangedPixels) / pixelCount
    let meanNormalisedChannelDelta = Double(totalChannelDelta) / (Double(first.count) * 255)
    let description = "changed \(changedFraction), mean delta \(meanNormalisedChannelDelta)"
    XCTAssertGreaterThan(
      changedFraction,
      0.01,
      "cell lens \(firstLens) must visibly differ from lens \(secondLens); \(description)"
    )
    XCTAssertGreaterThan(
      meanNormalisedChannelDelta,
      0.002,
      "cell lens \(firstLens) must materially differ from lens \(secondLens); \(description)"
    )
  }
}
#endif
