#if canImport(Metal)
import Metal
import XCTest
@testable import ObjetUniverseRender

final class SolarMetalRenderTests: XCTestCase {
  private struct Uniforms {
    var viewport = SIMD2<Float>(128, 128)
    var cameraScale: Float = 3.4
    var cameraRotation: Float = 0
    var cameraPitch: Float = 0.12
    var interpolation: Float = 0.5
    var elapsed: Float = 12
    var centralMass: Float = 1.2
    var collisionPulse: Float = 0.8
    var collisionPosition = SIMD2<Float>(0.45, -0.48)
    var touchPosition = SIMD2<Float>(-0.35, 0.40)
    var touchPulse: Float = 0.7
    var touchKind: UInt32 = 2
    var representation: UInt32 = 0
    var bodyCount: UInt32 = 2
    var trailCount: UInt32 = 3
    var predictionCount: UInt32 = 3
  }

  private struct Body {
    var previousPosition: SIMD4<Float>
    var positionRadius: SIMD4<Float>
    var colourMass: SIMD4<Float>
    var velocityKindSelected: SIMD4<Float>
  }

  private struct Mark {
    var positionAge: SIMD4<Float>
    var colourSize: SIMD4<Float>
  }

  func testBackgroundShaderDoesNotLoopOverBodiesPerFragment() {
    let source = SolarShaderSource.metal
    let background = source
      .components(separatedBy: "fragment float4 objet_solar_background_fragment")[1]
      .components(separatedBy: "vertex OrbitOut objet_solar_orbit_vertex")[0]
    XCTAssertFalse(background.contains("u.bodyCount"))
    XCTAssertTrue(source.contains("objet_solar_orbit_vertex"))
    XCTAssertTrue(source.contains("objet_solar_orbit_fragment"))
  }

  func testSolarInstrumentRendersDeterministicStructuredRegionsOffscreen() throws {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal; skipping would remove the solar visibility gate")
        return
      }
      throw XCTSkip("local host exposes no Metal device; Native CI remains the mandatory shader gate")
    }

    let first = try render(device: device)
    let second = try render(device: device)
    XCTAssertEqual(first, second, "the same solar snapshot must render byte-for-byte deterministically")

    let all = luminance(in: first, x: 0 ..< 128, y: 0 ..< 128)
    let centre = luminance(in: first, x: 54 ..< 74, y: 54 ..< 74)
    let corner = luminance(in: first, x: 0 ..< 20, y: 0 ..< 20)
    let collision = luminance(in: first, x: 66 ..< 86, y: 66 ..< 90)
    XCTAssertGreaterThan(all.mean, 0.012, "the cold orbital dark must remain visible above black")
    XCTAssertGreaterThan(all.variance, 0.0003, "star, paths, and bodies must make spatial structure")
    XCTAssertGreaterThan(centre.mean, corner.mean * 2.0, "the limb-darkened candle star must anchor the centre")
    XCTAssertGreaterThan(collision.maximum, corner.maximum, "the located collision bloom must survive compositing")
  }

  func testAllFourSolarLensesProduceDistinctImages() throws {
    guard let device = MTLCreateSystemDefaultDevice() else {
      throw XCTSkip("local host exposes no Metal device")
    }
    let images = try (0 ... 3).map { try render(device: device, representation: UInt32($0)) }
    for first in 0 ..< images.count {
      for second in first + 1 ..< images.count {
        XCTAssertNotEqual(images[first], images[second], "Solar lens \(first) must not be visually inert beside \(second)")
      }
    }
  }

  private func render(device: MTLDevice, representation: UInt32 = 0) throws -> [UInt8] {
    let library = try device.makeLibrary(source: SolarShaderSource.metal, options: nil)
    let background = try pipeline(
      device: device,
      library: library,
      vertex: "objet_solar_fullscreen_vertex",
      fragment: "objet_solar_background_fragment",
      blending: false
    )
    let marks = try pipeline(
      device: device,
      library: library,
      vertex: "objet_solar_mark_vertex",
      fragment: "objet_solar_mark_fragment",
      blending: true
    )
    let orbits = try pipeline(
      device: device,
      library: library,
      vertex: "objet_solar_orbit_vertex",
      fragment: "objet_solar_orbit_fragment",
      blending: true
    )
    let bodiesPipeline = try pipeline(
      device: device,
      library: library,
      vertex: "objet_solar_body_vertex",
      fragment: "objet_solar_body_fragment",
      blending: true
    )

    var uniforms = Uniforms()
    uniforms.representation = representation
    var bodies = [
      Body(
        previousPosition: SIMD4<Float>(0.70, 0.18, 0, 0),
        positionRadius: SIMD4<Float>(0.76, 0.22, 0, 0.075),
        colourMass: SIMD4<Float>(0.34, 0.61, 0.88, 0.06),
        velocityKindSelected: SIMD4<Float>(-0.18, 0.55, 0, 1)
      ),
      Body(
        previousPosition: SIMD4<Float>(-1.02, -0.24, 0.03, 0),
        positionRadius: SIMD4<Float>(-0.96, -0.19, 0.03, 0.045),
        colourMass: SIMD4<Float>(0.72, 0.42, 0.28, 0.02),
        velocityKindSelected: SIMD4<Float>(0.28, -0.42, 1, 0)
      ),
    ]
    var trail = [
      Mark(positionAge: SIMD4<Float>(0.56, 0.08, 0, 0.75), colourSize: SIMD4<Float>(0.34, 0.61, 0.88, 4)),
      Mark(positionAge: SIMD4<Float>(0.63, 0.13, 0, 0.45), colourSize: SIMD4<Float>(0.34, 0.61, 0.88, 4)),
      Mark(positionAge: SIMD4<Float>(0.70, 0.18, 0, 0.12), colourSize: SIMD4<Float>(0.34, 0.61, 0.88, 4)),
    ]
    var prediction = [
      Mark(positionAge: SIMD4<Float>(0.83, 0.27, 0, 0.12), colourSize: SIMD4<Float>(0.36, 0.90, 0.82, 5)),
      Mark(positionAge: SIMD4<Float>(0.90, 0.34, 0, 0.30), colourSize: SIMD4<Float>(0.36, 0.90, 0.82, 5)),
      Mark(positionAge: SIMD4<Float>(0.95, 0.42, 0, 0.52), colourSize: SIMD4<Float>(0.36, 0.90, 0.82, 5)),
    ]
    var preview = Body(
      previousPosition: SIMD4<Float>(-0.45, 0.65, 0, 0),
      positionRadius: SIMD4<Float>(-0.45, 0.65, 0, 0.13),
      colourMass: SIMD4<Float>(0.48, 0.72, 0.62, 0),
      velocityKindSelected: SIMD4<Float>(0, 0, 3, 0.72)
    )
    let uniformBuffer = try buffer(device: device, value: &uniforms)
    let bodyBuffer = try buffer(device: device, values: &bodies)
    let trailBuffer = try buffer(device: device, values: &trail)
    let predictionBuffer = try buffer(device: device, values: &prediction)
    let previewBuffer = try buffer(device: device, value: &preview)

    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .bgra8Unorm,
      width: 128,
      height: 128,
      mipmapped: false
    )
    descriptor.storageMode = .shared
    descriptor.usage = .renderTarget
    let output = try XCTUnwrap(device.makeTexture(descriptor: descriptor))
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = output
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)

    let queue = try XCTUnwrap(device.makeCommandQueue())
    let command = try XCTUnwrap(queue.makeCommandBuffer())
    let encoder = try XCTUnwrap(command.makeRenderCommandEncoder(descriptor: pass))
    encoder.setRenderPipelineState(background)
    encoder.setFragmentBuffer(uniformBuffer, offset: 0, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.setRenderPipelineState(orbits)
    encoder.setVertexBuffer(trailBuffer, offset: 0, index: 0)
    encoder.setVertexBuffer(uniformBuffer, offset: 0, index: 1)
    encoder.drawPrimitives(type: .lineStrip, vertexStart: 0, vertexCount: trail.count)
    encoder.setRenderPipelineState(marks)
    encoder.setVertexBuffer(trailBuffer, offset: 0, index: 0)
    encoder.setVertexBuffer(uniformBuffer, offset: 0, index: 1)
    encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: trail.count)
    encoder.setVertexBuffer(predictionBuffer, offset: 0, index: 0)
    encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: prediction.count)
    encoder.setRenderPipelineState(bodiesPipeline)
    encoder.setVertexBuffer(previewBuffer, offset: 0, index: 0)
    encoder.setVertexBuffer(uniformBuffer, offset: 0, index: 1)
    encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: 1)
    encoder.setVertexBuffer(bodyBuffer, offset: 0, index: 0)
    encoder.setVertexBuffer(uniformBuffer, offset: 0, index: 1)
    encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: bodies.count)
    encoder.endEncoding()
    command.commit()
    command.waitUntilCompleted()
    XCTAssertEqual(command.status, .completed)
    XCTAssertNil(command.error)

    var pixels = [UInt8](repeating: 0, count: 128 * 128 * 4)
    output.getBytes(&pixels, bytesPerRow: 128 * 4, from: MTLRegionMake2D(0, 0, 128, 128), mipmapLevel: 0)
    return pixels
  }

  private func pipeline(
    device: MTLDevice,
    library: MTLLibrary,
    vertex: String,
    fragment: String,
    blending: Bool
  ) throws -> MTLRenderPipelineState {
    let descriptor = MTLRenderPipelineDescriptor()
    descriptor.vertexFunction = library.makeFunction(name: vertex)
    descriptor.fragmentFunction = library.makeFunction(name: fragment)
    descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
    if blending {
      let attachment = descriptor.colorAttachments[0]!
      attachment.isBlendingEnabled = true
      attachment.sourceRGBBlendFactor = .sourceAlpha
      attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
    }
    return try device.makeRenderPipelineState(descriptor: descriptor)
  }

  private func buffer<T>(device: MTLDevice, value: inout T) throws -> MTLBuffer {
    try withUnsafeBytes(of: &value) { bytes in
      try XCTUnwrap(device.makeBuffer(bytes: bytes.baseAddress!, length: bytes.count, options: .storageModeShared))
    }
  }

  private func buffer<T>(device: MTLDevice, values: inout [T]) throws -> MTLBuffer {
    try values.withUnsafeBytes { bytes in
      try XCTUnwrap(device.makeBuffer(bytes: bytes.baseAddress!, length: bytes.count, options: .storageModeShared))
    }
  }

  private func luminance(
    in pixels: [UInt8],
    x: Range<Int>,
    y: Range<Int>
  ) -> (mean: Double, variance: Double, maximum: Double) {
    var values: [Double] = []
    values.reserveCapacity(x.count * y.count)
    for row in y {
      for column in x {
        let index = (row * 128 + column) * 4
        let blue = Double(pixels[index]) / 255
        let green = Double(pixels[index + 1]) / 255
        let red = Double(pixels[index + 2]) / 255
        values.append(0.0722 * blue + 0.7152 * green + 0.2126 * red)
      }
    }
    let mean = values.reduce(0, +) / Double(values.count)
    let variance = values.reduce(0) { sum, value in
      let delta = value - mean
      return sum + delta * delta
    } / Double(values.count)
    return (mean, variance, values.max() ?? 0)
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
