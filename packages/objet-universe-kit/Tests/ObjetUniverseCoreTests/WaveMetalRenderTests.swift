#if canImport(Metal)
import Metal
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Compiles and executes the shipping shader against the shipping resting
/// field. Source-string assertions cannot catch a valid-looking shader that
/// fails to compile or maps the whole field to one near-black colour.
final class WaveMetalRenderTests: XCTestCase {
  private struct Uniforms {
    var viewport = SIMD2<Float>(64, 64)
    var fieldSize = SIMD2<Float>(1, 1)
    var elapsed: Float = 7
    var exposure: Float = 1
    var representation: Float = 0
    var materialKind: Float = 0
    var breathSeconds: Float = 7
    var pad: Float = 0
  }

  func testRestingFieldCompilesAndRendersDeterministicVisibleStructureOffscreen() throws {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal; skipping would make the release visibility gate meaningless")
        return
      }
      throw XCTSkip("this local host exposes no Metal device; Native CI remains the mandatory shader gate")
    }

    let field = WaveField(seed: 0x6F62_6A65_7420_6461)
    for _ in 0 ..< 840 { field.step(secondsPerStep: UniverseClock.defaultStepSeconds) }

    let first = try render(field: field, device: device)
    let second = try render(field: field, device: device)
    XCTAssertEqual(first, second, "the same authoritative surface must render byte-for-byte identically")

    let luminance = stride(from: 0, to: first.count, by: 4).map { index -> Double in
      let blue = Double(first[index]) / 255
      let green = Double(first[index + 1]) / 255
      let red = Double(first[index + 2]) / 255
      return 0.0722 * blue + 0.7152 * green + 0.2126 * red
    }
    let mean = luminance.reduce(0, +) / Double(luminance.count)
    let variance = luminance.reduce(0) { sum, value in
      let delta = value - mean
      return sum + delta * delta
    } / Double(luminance.count)

    XCTAssertGreaterThan(mean, 0.035, "the resting field must render above the night ground")
    XCTAssertGreaterThan(variance, 0.0002, "the resting field must contain visible spatial structure")
  }

  private func render(field: WaveField, device: MTLDevice) throws -> [UInt8] {
    let library = try device.makeLibrary(source: WaveShaderSource.metal, options: nil)
    let descriptor = MTLRenderPipelineDescriptor()
    descriptor.vertexFunction = library.makeFunction(name: "objet_wave_vertex")
    descriptor.fragmentFunction = library.makeFunction(name: "objet_wave_fragment")
    descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
    let pipeline = try device.makeRenderPipelineState(descriptor: descriptor)

    let samplerDescriptor = MTLSamplerDescriptor()
    samplerDescriptor.minFilter = .linear
    samplerDescriptor.magFilter = .linear
    samplerDescriptor.sAddressMode = .clampToEdge
    samplerDescriptor.tAddressMode = .clampToEdge
    let sampler = try XCTUnwrap(device.makeSamplerState(descriptor: samplerDescriptor))

    let fieldTextureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .r32Float,
      width: field.width,
      height: field.height,
      mipmapped: false
    )
    fieldTextureDescriptor.storageMode = .shared
    fieldTextureDescriptor.usage = .shaderRead
    let fieldTexture = try XCTUnwrap(device.makeTexture(descriptor: fieldTextureDescriptor))
    field.withSurface { values, width, height in
      fieldTexture.replace(
        region: MTLRegionMake2D(0, 0, width, height),
        mipmapLevel: 0,
        withBytes: values,
        bytesPerRow: width * MemoryLayout<Float>.stride
      )
    }

    let outputDescriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .bgra8Unorm,
      width: 64,
      height: 64,
      mipmapped: false
    )
    outputDescriptor.storageMode = .shared
    outputDescriptor.usage = .renderTarget
    let output = try XCTUnwrap(device.makeTexture(descriptor: outputDescriptor))

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = output
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)

    let queue = try XCTUnwrap(device.makeCommandQueue())
    let commandBuffer = try XCTUnwrap(queue.makeCommandBuffer())
    let encoder = try XCTUnwrap(commandBuffer.makeRenderCommandEncoder(descriptor: pass))
    var uniforms = Uniforms(
      fieldSize: SIMD2<Float>(Float(field.width), Float(field.height)),
      elapsed: Float(field.elapsedSeconds),
      exposure: Float(field.exposure)
    )
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(fieldTexture, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
    XCTAssertEqual(commandBuffer.status, .completed)
    XCTAssertNil(commandBuffer.error)

    var bytes = [UInt8](repeating: 0, count: 64 * 64 * 4)
    output.getBytes(
      &bytes,
      bytesPerRow: 64 * 4,
      from: MTLRegionMake2D(0, 0, 64, 64),
      mipmapLevel: 0
    )
    return bytes
  }
}
#endif
