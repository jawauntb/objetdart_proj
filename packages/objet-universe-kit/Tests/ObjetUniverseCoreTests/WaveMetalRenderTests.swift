#if canImport(Metal)
import Foundation
import Metal
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Executes the shipping water shader at phone scale. This is a visual
/// baseline rather than a source-string snapshot: it catches an ABI mismatch,
/// a dead lens, or a sea that collapses back into near-black output.
final class WaveMetalRenderTests: XCTestCase {
  private static let outputWidth = 390
  private static let outputHeight = 844

  private final class Fixture {
    private let pipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private let field: MTLTexture
    private let output: MTLTexture
    private let pass = MTLRenderPassDescriptor()
    private let queue: MTLCommandQueue

    init(field: WaveField, device: MTLDevice) throws {
      let library = try MetalPipelineCache.shared.library(
        namespace: "wave-v2",
        device: device,
        source: WaveShaderSource.metal
      )
      pipeline = try MetalPipelineCache.shared.pipeline(
        namespace: "wave-v2",
        device: device,
        pixelFormat: .bgra8Unorm
      ) {
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "objet_wave_vertex")
        descriptor.fragmentFunction = library.makeFunction(name: "objet_wave_fragment")
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
        width: field.width,
        height: field.height,
        mipmapped: false
      )
      fieldDescriptor.storageMode = .shared
      fieldDescriptor.usage = .shaderRead
      self.field = try XCTUnwrap(device.makeTexture(descriptor: fieldDescriptor))

      let outputDescriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .bgra8Unorm,
        width: WaveMetalRenderTests.outputWidth,
        height: WaveMetalRenderTests.outputHeight,
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
      field wave: WaveField,
      representation: Int = 0,
      elapsed: Float? = nil,
      reducedMotion: Bool = false,
      frozenElapsed: Float? = nil
    ) throws -> [UInt8] {
      let spectrum = wave.withSurface { values, width, height -> WaveSpectrumBins? in
        field.replace(
          region: MTLRegionMake2D(0, 0, width, height),
          mipmapLevel: 0,
          withBytes: values,
          bytesPerRow: width * MemoryLayout<Float>.stride
        )
        guard representation == 2 else { return nil }
        return WaveSpectrumBins.make(values: values, width: width, height: height, exposure: Float(wave.exposure))
      }

      let command = try XCTUnwrap(queue.makeCommandBuffer())
      let encoder = try XCTUnwrap(command.makeRenderCommandEncoder(descriptor: pass))
      var uniforms = WaveShaderUniforms()
      uniforms.viewport = SIMD2<Float>(
        Float(WaveMetalRenderTests.outputWidth),
        Float(WaveMetalRenderTests.outputHeight)
      )
      uniforms.fieldSize = SIMD2<Float>(Float(wave.width), Float(wave.height))
      let sourceElapsed = elapsed ?? Float(wave.elapsedSeconds)
      uniforms.state = SIMD4<Float>(
        sourceElapsed,
        Float(wave.exposure),
        Float(representation),
        reducedMotion ? 1 : 0
      )
      uniforms.presentation = SIMD4<Float>(frozenElapsed ?? sourceElapsed, Float(WaveField.breathSeconds), 0, 0)
      spectrum?.write(to: &uniforms)
      encoder.setRenderPipelineState(pipeline)
      encoder.setFragmentTexture(field, index: 0)
      encoder.setFragmentSamplerState(sampler, index: 0)
      encoder.setFragmentBytes(&uniforms, length: MemoryLayout<WaveShaderUniforms>.stride, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      encoder.endEncoding()
      command.commit()
      command.waitUntilCompleted()
      XCTAssertEqual(command.status, .completed)
      XCTAssertNil(command.error)

      var bytes = [UInt8](
        repeating: 0,
        count: WaveMetalRenderTests.outputWidth * WaveMetalRenderTests.outputHeight * 4
      )
      output.getBytes(
        &bytes,
        bytesPerRow: WaveMetalRenderTests.outputWidth * 4,
        from: MTLRegionMake2D(0, 0, WaveMetalRenderTests.outputWidth, WaveMetalRenderTests.outputHeight),
        mipmapLevel: 0
      )
      return bytes
    }
  }

  func testRestingTankCompilesAndRendersDeterministicVisibleWaterOffscreen() throws {
    let field = restedField()
    let fixture = try Fixture(field: field, device: metalDevice())

    let first = try fixture.render(field: field)
    let second = try fixture.render(field: field)
    XCTAssertEqual(first, second, "the same authoritative water surface must render byte-for-byte deterministically")
    assertReadable(first, lens: 0)
  }

  func testWaveLensesProduceDistinctPhysicalReadingsAtPhoneScale() throws {
    let field = restedField()
    let fixture = try Fixture(field: field, device: metalDevice())
    let images = try (0 ... 3).map { try fixture.render(field: field, representation: $0) }

    for first in 0 ..< images.count {
      for second in (first + 1) ..< images.count {
        assertMaterialDifference(images[first], images[second], firstLens: first, secondLens: second)
      }
    }
  }

  func testEveryWaveLensRetainsDarkStructuredMaterialAtPhoneScale() throws {
    let field = restedField()
    let fixture = try Fixture(field: field, device: metalDevice())

    for representation in 0 ... 3 {
      assertReadable(try fixture.render(field: field, representation: representation), lens: representation)
    }
  }

  func testReducedMotionDetentsWaterLensesWithoutAReleaseSnap() throws {
    for representation in [0, 3] {
      let field = restedField()
      let fixture = try Fixture(field: field, device: metalDevice())
      var timing = MetalPresentationTiming()

      let initialElapsed = Float(field.elapsedSeconds)
      let beforeToggle = try fixture.render(
        field: field,
        representation: representation,
        elapsed: timing.presentationElapsed(for: initialElapsed)
      )
      timing.setReducedMotion(true)
      for _ in 0 ..< 30 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }
      let advancedElapsed = Float(field.elapsedSeconds)
      let afterToggle = try fixture.render(
        field: field,
        representation: representation,
        elapsed: timing.presentationElapsed(for: advancedElapsed),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )
      let advancedFieldAtHeldPhase = try fixture.render(
        field: field,
        representation: representation,
        elapsed: initialElapsed
      )

      for _ in 0 ..< 1_800 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }
      let heldElapsed = Float(field.elapsedSeconds)
      let beforeRelease = try fixture.render(
        field: field,
        representation: representation,
        elapsed: timing.presentationElapsed(for: heldElapsed),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )
      timing.setReducedMotion(false)
      let afterRelease = try fixture.render(
        field: field,
        representation: representation,
        elapsed: timing.presentationElapsed(for: heldElapsed),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )

      for _ in 0 ..< 240 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }
      let animatedLater = try fixture.render(
        field: field,
        representation: representation,
        elapsed: timing.presentationElapsed(for: Float(field.elapsedSeconds)),
        reducedMotion: timing.reducedMotion,
        frozenElapsed: timing.frozenElapsed
      )

      XCTAssertGreaterThan(advancedElapsed, initialElapsed, "water lens \(representation) must continue advancing its solver")
      XCTAssertNotEqual(beforeToggle, afterToggle, "water lens \(representation) must keep moving its field while reduced motion holds presentation")
      XCTAssertEqual(afterToggle, advancedFieldAtHeldPhase, "water lens \(representation) must preserve the held decorative phase after its source elapsed advances")
      XCTAssertEqual(beforeRelease, afterRelease, "water lens \(representation) must resume from the held phase")
      XCTAssertNotEqual(beforeRelease, animatedLater, "water lens \(representation) must return to living presentation")
      assertReadable(beforeRelease, lens: representation)
    }
  }

  func testSpectrumReducerChangesWithTheAuthoritativeWaveRatherThanPresentationTime() throws {
    let resting = restedField()
    let restingBins = resting.withSurface { values, width, height in
      WaveSpectrumBins.make(values: values, width: width, height: height, exposure: Float(resting.exposure))
    }

    let struck = restedField()
    struck.displace(atX: 0.5, y: 0.5, amplitude: 0.9, radiusCells: 9)
    for _ in 0 ..< 90 { struck.step(secondsPerStep: UniverseClock.defaultStepSeconds) }
    let struckBins = struck.withSurface { values, width, height in
      WaveSpectrumBins.make(values: values, width: width, height: height, exposure: Float(struck.exposure))
    }

    XCTAssertNotEqual(restingBins, struckBins, "spectrum must be reduced from the submitted physical surface")

    let fixture = try Fixture(field: resting, device: metalDevice())
    let presentationElapsed = Float(resting.elapsedSeconds)
    let restingPixels = try fixture.render(
      field: resting,
      representation: 2,
      elapsed: presentationElapsed
    )
    let struckPixels = try fixture.render(
      field: struck,
      representation: 2,
      elapsed: presentationElapsed
    )
    assertMaterialDifference(restingPixels, struckPixels, firstLens: 2, secondLens: 2)
  }

  private func restedField() -> WaveField {
    let field = WaveField(seed: 0x6F62_6A65_7420_6461)
    for _ in 0 ..< 840 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }
    return field
  }

  private func metalDevice() throws -> MTLDevice {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal; skipping would remove the Wave visibility gate")
        throw NSError(domain: "ObjetUniverse", code: 1)
      }
      throw XCTSkip("this local host exposes no Metal device; Native CI remains the mandatory shader gate")
    }
    return device
  }

  private func assertReadable(_ pixels: [UInt8], lens: Int) {
    var sum = 0.0
    var sumOfSquares = 0.0
    var brightCount = 0
    var darkCount = 0
    var minimum = 1.0
    var maximum = 0.0
    let pixelCount = pixels.count / 4
    for index in stride(from: 0, to: pixels.count, by: 4) {
      let luminance = 0.0722 * Double(pixels[index]) / 255
        + 0.7152 * Double(pixels[index + 1]) / 255
        + 0.2126 * Double(pixels[index + 2]) / 255
      sum += luminance
      sumOfSquares += luminance * luminance
      if luminance > 0.16 { brightCount += 1 }
      if luminance < 0.12 { darkCount += 1 }
      minimum = min(minimum, luminance)
      maximum = max(maximum, luminance)
    }
    let mean = sum / Double(pixelCount)
    let variance = sumOfSquares / Double(pixelCount) - mean * mean
    let brightFraction = Double(brightCount) / Double(pixelCount)
    let darkFraction = Double(darkCount) / Double(pixelCount)
    let range = "mean \(mean), min \(minimum), max \(maximum), bright \(brightFraction), dark \(darkFraction)"

    XCTAssertGreaterThan(mean, 0.022, "wave lens \(lens) must remain visible above night; \(range)")
    XCTAssertGreaterThan(variance, 0.00018, "wave lens \(lens) must retain legible spatial structure; \(range)")
    XCTAssertGreaterThan(brightFraction, 0.003, "wave lens \(lens) must occupy a visible portion of the frame; \(range)")
    XCTAssertGreaterThan(darkFraction, 0.15, "wave lens \(lens) must retain dark water space; \(range)")
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
    XCTAssertGreaterThan(changedFraction, 0.012, "wave lenses \(firstLens) and \(secondLens) must visibly differ; \(description)")
    XCTAssertGreaterThan(meanNormalisedChannelDelta, 0.003, "wave lenses \(firstLens) and \(secondLens) must materially differ; \(description)")
  }
}
#endif
